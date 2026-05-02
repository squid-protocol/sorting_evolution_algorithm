// sub_worker_S34.js (Melded S33 & S34, Upgraded to S34 Physics)
// This file combines the robust simulation logic from S33 with S34 improvements.
// S34 UPGRADE: The physics model has been completely refactored to use a "top-down"
// projection. The `boardAngle` gene now correctly scales the magnitude of gravity
// along the y-axis (the board's length) to simulate the effect of a tilt,
// eliminating the incorrect sideways force from the previous model.
// STUCK PIECE FIX: The logic in `checkEarlyExitConditions` has been corrected to
// accurately detect genuinely stuck pieces, resolving the 100% estimation issue.
// FUNCTIONAL ANNOTATION: Implemented the "River of Flow" analysis. The system now
// maps the particle flow path and annotates each component with its position
// and immersion relative to the flow, enriching the dataset for PCA.
// BATCH SIZE FIX: Corrected the logic to treat `batchSize` as a per-batch value,
// not the total number of pieces for the run.
// HIGH-FIDELITY FLOW: The "River of Flow" calculation is now constrained by the
// funnel's physical walls and is extrapolated through the detector for accuracy.
// QUADRILATERAL HEURISTIC: Replaced complex flow analysis with a simple quadrilateral
// heuristic connecting the drop zone to the detector, providing a computationally
// efficient approximation of the flow path.

// --- Worker State ---
let workerId;
let sim_config; // Full config object from main thread
let fitnessWeights; // Will be set for each job
let Matter;

const GA_S34_FEATURE_FLAGS = {
    wallCrossoverTest: true, pinchPointTest: true, detectorConnection: true,
    funnelConstraint: true, sacrificialPieceTest: true, jamDetection: true,
    largeClumpExit: true, stagnationExit: true, physicsViolation: true,
    timeoutCompletion: true,
};

// S34 UPGRADE: Correct "top-down" physics model for gravity.
const BOARD_ANGLE_CALC_FN = (gravity, boardAngleRad) => {
    const baselineGravity = sim_config.ENGINE_CONFIG.gravity.y;
    gravity.x = 0;
    gravity.y = Math.cos(boardAngleRad) * baselineGravity;
};

// --- Main Message Handler ---
self.onmessage = function(e) {
    const { command, payload } = e.data;

    switch (command) {
        case 'init':
            workerId = payload.id;
            sim_config = payload.config;
            
            // FIX: Inject poly-decomp into the isolated worker thread
            importScripts(
                'https://cdn.jsdelivr.net/npm/poly-decomp@0.3.0/build/decomp.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js'
            );
            
            Matter = self.Matter;
            Matter.Common.setDecomp(self.decomp); // Bind the decomposer to the engine
            
            self.postMessage({ type: 'worker_ready', payload: { id: workerId } });
            break;
        case 'run_positive_control':
            runPositiveControlTest(payload.chromosome);
            break;
        case 'run_test':
            fitnessWeights = payload.fitnessWeights;
            const simulation = new Simulation(sim_config, fitnessWeights);
            const result = simulation.run(payload.chromosome);
            self.postMessage({ type: 'test_result', payload: { result, id: payload.id } });
            break;
    }
};

function runPositiveControlTest(chromosome) {
    const sim = new Simulation(sim_config, {}); // empty weights for test
    sim.buildBoard(chromosome);
    const { Bodies, World, Engine } = Matter;
    const piece = Bodies.rectangle(sim_config.SIM_CONFIG.BOARD_WIDTH / 2, 10, 8, 8, { ...sim_config.PIECE_PHYSICS_PROPERTIES, label: 'control' });
    World.add(sim.world, piece);
    let initialY = piece.position.y;
    for (let i = 0; i < 1000; i++) {
        Engine.update(sim.engine, sim_config.TIME_STEP);
    }
    if (piece.position.y <= initialY) {
        self.postMessage({ type: 'positive_control_failure', payload: { id: workerId, error: 'gravity_test_failed' } });
    } else if (piece.position.y < chromosome.machineHeight) {
        self.postMessage({ type: 'positive_control_failure', payload: { id: workerId, error: 'detector_line_not_crossed' } });
    } else {
        self.postMessage({ type: 'positive_control_success', payload: { id: workerId } });
    }
}

// --- Simulation Class (Melded) ---
class Simulation {
    constructor(config, fitnessWeights) {
        this.config = config;
        // --- CONFIG BULLETPROOFING: Ensure BOARD_WIDTH exists to prevent NaN wall rendering ---
        if (!this.config.SIM_CONFIG) this.config.SIM_CONFIG = {};
        if (!this.config.SIM_CONFIG.BOARD_WIDTH) this.config.SIM_CONFIG.BOARD_WIDTH = 1000;
        // --------------------------------------------------------------------------------------
        this.fitnessWeights = fitnessWeights;
        this.Matter = Matter;
        const { Engine } = this.Matter;
        this.engine = Engine.create({
            gravity: { ...this.config.ENGINE_CONFIG.gravity },
            positionIterations: this.config.ENGINE_CONFIG.positionIterations,
            velocityIterations: this.config.ENGINE_CONFIG.velocityIterations
        });
        this.world = this.engine.world;
        this.simulationTime = 0;
        this.exitedPieceIDs = new Set();
        this.exitTimes = [];
        this.exitClumps = [];
        this.physicsViolationCount = 0;
        this.timeOfLastExit = 0;
        this.pieceLibrary = this.config.PIECE_LIBRARY.map(p => ({
            ...p,
            vertices: this.Matter.Vertices.fromPath(p.vertices)
        }));
    }

    run(chromosome) {
        try {
            const annotations = this.performFunctionalAnnotation(chromosome);

            this.buildBoard(chromosome);
            const earlyExitReason = this.runSimulationLoop(chromosome);
            const piecesInWorld = this.Matter.Composite.allBodies(this.world).filter(b => b.label === 'lego');
            const results = this.calculateFinalMetrics(earlyExitReason, piecesInWorld, chromosome);

            return { ...results, functionalAnnotations: annotations, featureFlags: GA_S34_FEATURE_FLAGS };
        } catch (error) {
            console.error(`[Sub-Worker ${workerId}] SIMULATION ABORTED for chromosome ${chromosome.id}. Engine halted.`);
            // Return a score of 0 so the GA learns this configuration is deadly
            return this.calculateFinalMetrics("CRASH", [], chromosome, error.message);
        }
    }

    buildBoard(chromosome) {
        const { World } = this.Matter;
        const boardBodies = this.createBoardFromFunctionalProfile(chromosome);
        if (chromosome.complexRamps) {
            chromosome.complexRamps.forEach(rampGene => {
                if (rampGene.isActive) boardBodies.push(...this.createComplexRampWithPegs(rampGene));
            });
        }
        if (chromosome.pegMatrices) {
            chromosome.pegMatrices.forEach(matrix => {
                if (matrix.isActive) boardBodies.push(...this.createPegsFromMatrix(matrix));
            });
        }

        // --- QUARANTINE SHIELD ---
        // If a legacy seed generated a corrupted body (NaN position/angle), delete it so it can't crash the engine.
        const safeBodies = boardBodies.filter(b => b && b.position && !isNaN(b.position.x) && !isNaN(b.position.y) && !isNaN(b.angle));
        
        World.add(this.world, safeBodies);
    }

    createBoardFromFunctionalProfile(chromosome) {
        const { Bodies } = this.Matter;
        const { funnel_profile, machineHeight, detectorOffset } = chromosome;
        const wallThickness = this.config.SIM_CONFIG.INTERNAL_WALL_THICKNESS || 8;
        const allBodies = [];
        if (!funnel_profile) return allBodies;

        const verticesL = [];
        const verticesR = [];

        const topY = 50;
        funnel_profile.forEach((slice, i) => {
            const t = i / (funnel_profile.length - 1);
            const y = topY + t * (machineHeight - topY);
            const centerX = (this.config.SIM_CONFIG.BOARD_WIDTH / 2) + slice.offset;
            verticesL.push({ x: centerX - slice.width / 2, y });
            verticesR.push({ x: centerX + slice.width / 2, y });
        });

        const sensorCenterX = (this.config.SIM_CONFIG.BOARD_WIDTH / 2) + detectorOffset;
        const sensorWidth = this.config.SENSOR_CONFIG.SENSOR_WIDTH;
        verticesL[verticesL.length - 1] = { x: sensorCenterX - sensorWidth / 2, y: machineHeight };
        verticesR[verticesR.length - 1] = { x: sensorCenterX + sensorWidth / 2, y: machineHeight };

        for (let i = 0; i < verticesL.length - 1; i++) {
            const startL = verticesL[i], endL = verticesL[i+1];
            const lengthL = Math.hypot(endL.x - startL.x, endL.y - startL.y);
            const angleL = Math.atan2(endL.y - startL.y, endL.x - startL.x);
            const centerXL = (startL.x + endL.x) / 2, centerYL = (startL.y + endL.y) / 2;
            allBodies.push(Bodies.rectangle(centerXL, centerYL, lengthL, wallThickness, { isStatic: true, angle: angleL }));

            const startR = verticesR[i], endR = verticesR[i+1];
            const lengthR = Math.hypot(endR.x - startR.x, endR.y - startR.y);
            const angleR = Math.atan2(endR.y - startR.y, endR.x - startR.x);
            const centerXR = (startR.x + endR.x) / 2, centerYR = (startR.y + endR.y) / 2;
            allBodies.push(Bodies.rectangle(centerXR, centerYR, lengthR, wallThickness, { isStatic: true, angle: angleR }));
        }

        return allBodies;
    }

    createComplexRampWithPegs(rampGene) {
        const { Bodies, Vector } = this.Matter;
        const rampBodies = [];
        const thickness = this.config.SIM_CONFIG.INTERNAL_WALL_THICKNESS || 8;
        const pegRadius = 4;
        const ramp = Bodies.rectangle(rampGene.x, rampGene.y, rampGene.length, thickness, { isStatic: true, angle: rampGene.rotation });
        rampBodies.push(ramp);
        const center = Vector.create(rampGene.x, rampGene.y), axis = Vector.rotate(Vector.create(1, 0), rampGene.rotation);
        const halfLength = rampGene.length / 2;
        const v1 = Vector.add(center, Vector.mult(axis, -halfLength)), v2 = Vector.add(center, Vector.mult(axis, halfLength));
        const p1Offset = Vector.rotate(Vector.create(rampGene.peg1.radius, 0), rampGene.peg1.angle), p1Pos = Vector.add(v1, p1Offset);
        rampBodies.push(Bodies.circle(p1Pos.x, p1Pos.y, pegRadius, { isStatic: true, restitution: 0.5 }));
        const p2Offset = Vector.rotate(Vector.create(rampGene.peg2.radius, 0), rampGene.peg2.angle), p2Pos = Vector.add(v2, p2Offset);
        rampBodies.push(Bodies.circle(p2Pos.x, p2Pos.y, pegRadius, { isStatic: true, restitution: 0.5 }));
        return rampBodies;
    }

    createPegsFromMatrix(matrix) {
        const { Bodies, Vector } = this.Matter;
        const newPegs = [];
        if (!matrix.gridX || !matrix.gridY) return [];
        const { gridX, gridY, startSpacingX, endSpacingX, spacingY, rotation, staggerOffset, x, y } = matrix;
        const pegRadius = 4;
        let localPositions = [];
        let totalWidth = 0;
        for (let r = 0; r < gridY; r++) {
            let currentX = r * staggerOffset;
            for (let c = 0; c < gridX; c++) {
                localPositions.push(Vector.create(currentX, r * spacingY));
                currentX += startSpacingX + ((gridX > 1) ? c / (gridX - 1) : 0) * (endSpacingX - startSpacingX);
            }
            if (currentX > totalWidth) totalWidth = currentX;
        }
        const centerOffset = Vector.create(totalWidth / 2, (gridY - 1) * spacingY / 2);
        localPositions.forEach(pos => {
            const finalPos = Vector.add(Vector.rotate(Vector.sub(pos, centerOffset), rotation), {x, y});
            const peg = Bodies.circle(finalPos.x, finalPos.y, pegRadius, { isStatic: true, restitution: 0.5 });
            newPegs.push(peg);
        });
        return newPegs;
    }

    captureTelemetrySnapshot(chromosome, triggerReason) {
        const pieces = this.Matter.Composite.allBodies(this.world).filter(b => b.label === 'lego');
        let extremeX = 0, extremeY = 0, maxSpeed = 0, nanCount = 0;

        pieces.forEach(p => {
            if (isNaN(p.position.x) || isNaN(p.position.y)) nanCount++;
            if (Math.abs(p.position.x) > extremeX) extremeX = Math.abs(p.position.x);
            if (Math.abs(p.position.y) > extremeY) extremeY = Math.abs(p.position.y);
            if (p.speed > maxSpeed) maxSpeed = p.speed;
        });

        const telemetryDump = {
            TRIGGER: triggerReason,
            chromosome_id: chromosome.id,
            boardAngle_degrees: (chromosome.boardAngle * (180 / Math.PI)).toFixed(2),
            gravity_vector: { x: this.engine.gravity.x.toFixed(4), y: this.engine.gravity.y.toFixed(4) },
            simulation_time_ms: this.simulationTime,
            active_pieces: pieces.length,
            nan_pieces_detected: nanCount,
            physics_extremes: {
                max_x_position: extremeX.toFixed(2),
                max_y_position: extremeY.toFixed(2),
                max_speed: maxSpeed.toFixed(2)
            }
        };

        console.error(`\n🚨 [Sub-Worker ${workerId}] FATAL PHYSICS ANOMALY DETECTED 🚨`);
        console.table(telemetryDump);
        
        return telemetryDump;
    }

    runSimulationLoop(chromosome) {
        const { Engine, Composite, Bodies, Body } = this.Matter;
        const { MAX_SIM_TIME, TIME_STEP } = this.config;
        const TURBO_FACTOR = 100;

        const numBatches = chromosome.numBatches || 1;
        const piecesPerBatch = chromosome.batchSize;
        const totalPieces = piecesPerBatch * numBatches;

        const batches = Array.from({length: numBatches}, (_, i) => ({
            startTime: i * chromosome.dropDelayTime, hasStarted: false, piecesSpawned: 0, dropStartTime: 0
        }));

        let lastTime = performance.now();
        let accumulator = 0;

        while (this.simulationTime < MAX_SIM_TIME) {
            const currentTime = performance.now();
            accumulator += (currentTime - lastTime) * TURBO_FACTOR;
            lastTime = currentTime;

            if (Composite.allBodies(this.world).filter(b => b.label === 'lego').length === 0 && batches.every(b => b.piecesSpawned >= piecesPerBatch)) {
                return "Completed";
            }

            while (accumulator >= TIME_STEP) {
                batches.forEach((batch) => {
                    if (!batch.hasStarted && this.simulationTime >= batch.startTime) {
                        batch.hasStarted = true; batch.dropStartTime = this.simulationTime;
                    }
                    if (batch.hasStarted && batch.piecesSpawned < piecesPerBatch) {
                        const elapsedDropTime = this.simulationTime - batch.dropStartTime;
                        const dropProgress = Math.min(1, elapsedDropTime / (chromosome.batchDropDuration || 1));
                        const easedProgress = 0.5 * (1 - Math.cos(dropProgress * Math.PI));
                        const expectedSpawns = Math.floor(easedProgress * piecesPerBatch);
                        const newSpawns = Math.min(piecesPerBatch, expectedSpawns) - batch.piecesSpawned;
                        if (newSpawns > 0) {
                            for (let i = 0; i < newSpawns; i++) {
                                let spawnX = chromosome.conveyorDropX + (Math.random() - 0.5) * chromosome.conveyorDropWidth;
                                let startVY = this.engine.gravity.y * (chromosome.freeFallTime / TIME_STEP);
                                
                                // SILENT BULLETPROOFING: If the GA hands us a corrupted NaN coordinate, 
                                // do not crash and do not spam the console. Just silently force it to the center of the board.
                                if (isNaN(spawnX)) {
                                    spawnX = this.config.SIM_CONFIG.BOARD_WIDTH / 2;
                                }
                                if (isNaN(startVY)) {
                                    startVY = 0;
                                }

                                const piece = Bodies.rectangle(spawnX, 10, 12, 12, { label: 'lego', ...this.config.PIECE_PHYSICS_PROPERTIES });
                                Body.setVelocity(piece, { x: 0, y: startVY });
                                Composite.add(this.world, piece);
                            }
                            batch.piecesSpawned += newSpawns;
                        }
                    }
                });

                BOARD_ANGLE_CALC_FN(this.engine.gravity, chromosome.boardAngle);

                let shakeX = 0;
                const { shakeAmplitude, shakeTimeOn, shakeTimeOff, shakeAmplitude_harsh, shakeTimeOn_harsh, shakeTimeOff_harsh } = chromosome;
                if (shakeAmplitude > 0 && (shakeTimeOn + shakeTimeOff) > 0 && this.simulationTime % (shakeTimeOn + shakeTimeOff) < shakeTimeOn) shakeX += (Math.random() - 0.5) * shakeAmplitude;
                if (shakeAmplitude_harsh > 0 && (shakeTimeOn_harsh + shakeTimeOff_harsh) > 0 && this.simulationTime % (shakeTimeOn_harsh + shakeTimeOff_harsh) < shakeTimeOn_harsh) shakeX += (Math.random() - 0.5) * shakeAmplitude_harsh;
                this.engine.gravity.x = shakeX;

                try {
                    // Pre-crash speed check: Are pieces moving impossibly fast?
                    const pieces = Composite.allBodies(this.world).filter(b => b.label === 'lego');
                    const explosivePiece = pieces.find(p => p.speed > 500); // 500 px per tick is an explosion
                    if (explosivePiece) {
                        this.captureTelemetrySnapshot(chromosome, "Speed Exceeded 500px/tick (Pre-Crash)");
                        return "PhysicsViolation"; // Force the GA to fail this board safely
                    }

                    // Advance the physics engine
                    Engine.update(this.engine, TIME_STEP);

                    // Post-crash NaN check: Did the update corrupt the math?
                    const corruptedPiece = pieces.find(p => isNaN(p.position.x) || isNaN(p.position.y));
                    if (corruptedPiece) {
                        this.captureTelemetrySnapshot(chromosome, "NaN Coordinates Detected (Math Corrupted)");
                        return "CRASH";
                    }

                } catch (engineError) {
                    // If matter.js throws the 'index' error, catch it immediately
                    this.captureTelemetrySnapshot(chromosome, `Matter.js threw: ${engineError.message}`);
                    throw engineError; // Re-throw to be caught by the outer loop
                }

                this.simulationTime += TIME_STEP;
                accumulator -= TIME_STEP;

                const earlyExitReason = this.checkEarlyExitConditions(totalPieces);
                if (earlyExitReason) return earlyExitReason;

                this.checkExitedPieces(chromosome);
            }
        }
        return "Timeout";
    }

    checkEarlyExitConditions(totalPieces) {
        const STAGNATION_DURATION = 15000;
        const LARGE_CLUMP_THRESHOLD = 75;
        const STUCK_PIECE_DURATION_MS = 20000;
        const STUCK_PIECE_PERCENTAGE_THRESHOLD = 0.25;
        const MOVEMENT_THRESHOLD = 0.5;

        if (this.simulationTime - this.timeOfLastExit > STAGNATION_DURATION) {
            return "Stagnation";
        }
        if (this.exitClumps.length > 0 && this.exitClumps[this.exitClumps.length - 1] > LARGE_CLUMP_THRESHOLD) {
            return "CatastrophicClump";
        }

        const piecesInWorld = this.Matter.Composite.allBodies(this.world).filter(b => b.label === 'lego');
        let currentStuckCount = 0;
        const stuckPieceCountThreshold = Math.max(1, Math.ceil(totalPieces * STUCK_PIECE_PERCENTAGE_THRESHOLD));

        piecesInWorld.forEach(body => {
            if (!body.lastMobilePosition) {
                body.lastMobilePosition = { x: body.position.x, y: body.position.y };
                body.stuckTimer = 0;
            }

            const displacement = this.Matter.Vector.magnitude(
                this.Matter.Vector.sub(body.position, body.lastMobilePosition)
            );

            if (displacement < MOVEMENT_THRESHOLD) {
                body.stuckTimer += this.config.TIME_STEP;
            } else {
                body.stuckTimer = 0;
                body.lastMobilePosition = { x: body.position.x, y: body.position.y };
            }

            const timeSinceLastMobile = body.stuckTimer > 0 ? body.stuckTimer : this.config.TIME_STEP;
            body.lastVelocity = displacement / (timeSinceLastMobile / 1000);

            if (body.stuckTimer > STUCK_PIECE_DURATION_MS) {
                currentStuckCount++;
            }
        });

        if (currentStuckCount >= stuckPieceCountThreshold) {
            return "StuckPiece";
        }

        return null;
    }


    checkExitedPieces(chromosome) {
        const { Composite } = this.Matter;
        const piecesInWorld = Composite.allBodies(this.world).filter(b => b.label === 'lego');
        let currentFrameExits = 0;

        const main_sensor_y = chromosome.machineHeight;
        const lost_piece_sensor_y = main_sensor_y + 100;
        const main_sensor_x_center = (this.config.SIM_CONFIG.BOARD_WIDTH / 2) + chromosome.detectorOffset;
        const main_sensor_start = main_sensor_x_center - (this.config.SENSOR_CONFIG.SENSOR_WIDTH / 2);
        const main_sensor_end = main_sensor_x_center + (this.config.SENSOR_CONFIG.SENSOR_WIDTH / 2);

        for (let i = piecesInWorld.length - 1; i >= 0; i--) {
            const body = piecesInWorld[i];
            
            // X-Axis Kill Plane added to prevent horizontal explosions
            const isWayOffScreenX = body.position.x < -1000 || body.position.x > this.config.SIM_CONFIG.BOARD_WIDTH + 1000;
            
            if (body.position.y > lost_piece_sensor_y || isWayOffScreenX) {
                 this.physicsViolationCount++;
                 Composite.remove(this.world, body);
                 continue;
            }
            if (body.position.y > main_sensor_y && body.position.x >= main_sensor_start && body.position.x <= main_sensor_end) {
                if (!this.exitedPieceIDs.has(body.id)) {
                    this.exitedPieceIDs.add(body.id);
                    this.exitTimes.push(this.simulationTime);
                    this.timeOfLastExit = this.simulationTime;
                    currentFrameExits++;
                }
                Composite.remove(this.world, body);
            }
        }
        if (currentFrameExits > 0) this.exitClumps.push(currentFrameExits);
    }

    calculateFinalMetrics(exitReason, piecesInWorld, chromosome, error = null) {
        const { W_TP_EXP, W_TP_LIN, W_TC, W_J, W_S, W_IQR, W_CON_EXP, W_CON_LIN, W_SYM_EXP, W_SYM_LIN, W_ZONE_REJECT, W_ZONE_LOW, W_ZONE_HIGH, W_ZONE_JAM, W_PREF_COUNT, W_PREF_RATIO_EXP, W_PREF_RATIO_LIN, W_PV } = this.fitnessWeights;

        const piecesPerBatch = chromosome.batchSize;
        const numBatches = chromosome.numBatches || 1;
        const totalPieces = piecesPerBatch * numBatches;

        let throughputScore = this.exitedPieceIDs.size;
        let isEstimated = false;

        if (exitReason === "StuckPiece") {
            isEstimated = true;
            const piecesAlreadyExited = throughputScore;
            if (piecesAlreadyExited > 0) {
                const stuckPieces = piecesInWorld.filter(p => p.stuckTimer > 20000).length;
                const piecesStillMoving = piecesInWorld.filter(p => p.lastVelocity > 6.0).length;
                
                const stateBasedEstimate = piecesAlreadyExited + piecesStillMoving - stuckPieces;
                
                const exitRatePerMs = piecesAlreadyExited / this.simulationTime;
                const remainingTime = this.config.MAX_SIM_TIME - this.simulationTime;
                const remainingPiecesToExit = totalPieces - piecesAlreadyExited;
                const JAM_PENALTY_FACTOR = 0.1;

                const potentialExits = exitRatePerMs * remainingTime;
                const cappedExtrapolatedExits = Math.min(potentialExits, remainingPiecesToExit);
                const extrapolatedExits = cappedExtrapolatedExits * JAM_PENALTY_FACTOR;
                const rateBasedEstimate = piecesAlreadyExited + extrapolatedExits - stuckPieces;

                const deepPessimismEstimate = piecesAlreadyExited;

                const averageEstimate = (stateBasedEstimate + rateBasedEstimate + deepPessimismEstimate) / 3;
                
                throughputScore = Math.max(piecesAlreadyExited, Math.min(totalPieces, Math.round(averageEstimate)));
            } else {
                 throughputScore = 0;
            }
        }

        const jamPenalty = totalPieces - throughputScore;
        const throughputRatio = (totalPieces > 0) ? throughputScore / totalPieces : 0;
        let simultaneousPenalty = 0; const clumpHistogram = {};
        this.exitClumps.forEach(c => { simultaneousPenalty += c > 1 ? (c*c) : 0; clumpHistogram[c] = (clumpHistogram[c] || 0) + 1; });
        let consistencyRewardRatio = 0, symmetryRewardRatio = 0, normalizedIQR = 0;
        let rejectCount = 0, lowCount = 0, highCount = 0, jamCount = 0, preferredIntervalCount = 0;
        const intervals = [];
        if (this.exitTimes.length > 1) {
            this.exitTimes.sort((a,b) => a - b);
            for (let i = 1; i < this.exitTimes.length; i++) intervals.push(this.exitTimes[i] - this.exitTimes[i-1]);
        }
        if (intervals.length > 5) {
            const sortedIntervals = [...intervals].sort((a, b) => a - b);
            const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const stdDev = Math.sqrt(intervals.map(x => Math.pow(x - meanInterval, 2)).reduce((a, b) => a + b) / intervals.length);
            consistencyRewardRatio = Math.max(0, 1 - (meanInterval > 0 ? stdDev / meanInterval : 10));
            normalizedIQR = meanInterval > 0 ? (sortedIntervals[Math.floor(sortedIntervals.length*3/4)] - sortedIntervals[Math.floor(sortedIntervals.length/4)]) / meanInterval : 10;
            symmetryRewardRatio = 1 - Math.abs(1 - ((intervals.filter(v => v > meanInterval).length / intervals.length) / 0.5));
            intervals.forEach(i => {
                if (i < 200) rejectCount++;
                else if (i < 250) lowCount++;
                else if (i >= 250 && i <= 400) preferredIntervalCount++;
                else if (i > 1500) jamCount++;
                else if (i > 750) highCount++;
            });
        } else { normalizedIQR = 10; }

        const potentialIntervals = totalPieces > 1 ? totalPieces - 1 : 0;
        const preferredIntervalRatio = potentialIntervals > 0 ? preferredIntervalCount / potentialIntervals : 0;

        const fitnessBreakdown = {
            impact_tp_exp: (W_TP_EXP || 0) * Math.pow(throughputRatio, 6),
            impact_tp_lin: (W_TP_LIN || 0) * throughputRatio,
            impact_tc: (W_TC || 0) * throughputScore,
            impact_con_exp: (W_CON_EXP || 0) * Math.pow(consistencyRewardRatio, 6),
            impact_con_lin: (W_CON_LIN || 0) * consistencyRewardRatio,
            impact_sym_exp: (W_SYM_EXP || 0) * Math.pow(symmetryRewardRatio, 6),
            impact_sym_lin: (W_SYM_LIN || 0) * symmetryRewardRatio,
            impact_pref_count: (W_PREF_COUNT || 0) * preferredIntervalCount,
            impact_pref_ratio_exp: (W_PREF_RATIO_EXP || 0) * Math.pow(preferredIntervalRatio, 6),
            impact_pref_ratio_lin: (W_PREF_RATIO_LIN || 0) * preferredIntervalRatio,
            impact_j: -(W_J || 0) * jamPenalty,
            impact_s: -(W_S || 0) * simultaneousPenalty,
            impact_iqr: -(W_IQR || 0) * normalizedIQR,
            impact_pv: -(W_PV || 0) * this.physicsViolationCount,
            impact_zone_reject: -(W_ZONE_REJECT || 0) * rejectCount,
            impact_zone_low: -(W_ZONE_LOW || 0) * lowCount,
            impact_zone_high: -(W_ZONE_HIGH || 0) * highCount,
            impact_zone_jam: -(W_ZONE_JAM || 0) * jamCount,
        };
        const finalScore = Object.values(fitnessBreakdown).reduce((sum, val) => sum + (val || 0), 0);

        const intervalZonePenalty = (fitnessBreakdown.impact_zone_reject + fitnessBreakdown.impact_zone_low + fitnessBreakdown.impact_zone_high + fitnessBreakdown.impact_zone_jam);

        return {
            finalScore, throughputScore, totalPieces, jamPenalty, simultaneousPenalty, consistencyRewardRatio, symmetryRewardRatio,
            normalizedIQR, intervals, clumpHistogram, exitReason, isEstimated, error,
            physicsViolationCount: this.physicsViolationCount,
            fitnessBreakdown, preferredIntervalCount, preferredIntervalRatio,
            rejectCount, lowCount, highCount, jamCount, intervalZonePenalty,
        };
    }

    performFunctionalAnnotation(chromosome) {
        const annotations = { components: [], riverPath: [], floodZoneVertices: [] };
        
        // --- START: Quadrilateral Heuristic ---
        const topY = 50;
        const bottomY = chromosome.machineHeight;

        // Define the four corners of the flood zone
        const dropLeftX = chromosome.conveyorDropX - chromosome.conveyorDropWidth / 2;
        const dropRightX = chromosome.conveyorDropX + chromosome.conveyorDropWidth / 2;

        const sensorCenterX = (this.config.SIM_CONFIG.BOARD_WIDTH / 2) + chromosome.detectorOffset;
        const sensorWidth = this.config.SENSOR_CONFIG.SENSOR_WIDTH;
        const detectorLeftX = sensorCenterX - sensorWidth / 2;
        const detectorRightX = sensorCenterX + sensorWidth / 2;

        const topLeft = { x: dropLeftX, y: topY };
        const topRight = { x: dropRightX, y: topY };
        const bottomLeft = { x: detectorLeftX, y: bottomY };
        const bottomRight = { x: detectorRightX, y: bottomY };

        annotations.floodZoneVertices = [topLeft, topRight, bottomRight, bottomLeft];

        // Define the centerline as a straight line between midpoints
        const topCenter = { x: chromosome.conveyorDropX, y: topY };
        const bottomCenter = { x: sensorCenterX, y: bottomY };
        annotations.riverPath = [
            { y: topY, centerline_x: topCenter.x },
            { y: bottomY, centerline_x: bottomCenter.x }
        ];
        // --- END: Quadrilateral Heuristic ---

        const allActiveComponents = [
            ...(chromosome.complexRamps || []),
            ...(chromosome.pegMatrices || [])
        ].filter(c => c.isActive);

        allActiveComponents.forEach((comp, i) => {
            // Interpolate centerline position at the component's Y-level
            const t = (comp.y - topY) / (bottomY - topY);
            const centerlineX = topCenter.x + t * (bottomCenter.x - topCenter.x);
            
            // Interpolate flood zone width at the component's Y-level
            const riverLeftX = topLeft.x + t * (bottomLeft.x - topLeft.x);
            const riverRightX = topRight.x + t * (bottomRight.x - topRight.x);

            const object_x = comp.x;
            const object_width = comp.length || (comp.gridX * comp.startSpacingX);
            const object_min_x = object_x - object_width / 2;
            const object_max_x = object_x + object_width / 2;

            const distanceFromCenterline = object_x - centerlineX;
            const isInRiver = (object_min_x < riverRightX) && (object_max_x > riverLeftX);
            const overlap_width = Math.max(0, Math.min(object_max_x, riverRightX) - Math.max(object_min_x, riverLeftX));
            const inRiverProportion = object_width > 0 ? overlap_width / object_width : 0;

            annotations.components.push({
                id: `comp_${i}`, distanceFromCenterline, isInRiver, inRiverProportion: Math.min(1, Math.max(0, inRiverProportion))
            });
        });

        return annotations;
    }
}
