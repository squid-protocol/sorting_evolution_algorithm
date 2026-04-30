// sub_worker_S35.js
// S35 UPGRADE: Implements the S35 "Cascade" physical model.
//
// ===================================================================================
// == VERSION 3.4 BUG FIX: RAMP ANGLE ORIENTATION                                   ==
// ===================================================================================
// - Corrected the `effectiveAngle` calculation, which was inverted.
// - A left-side ramp (`\`) now correctly receives a positive angle for rotation.
// - A right-side ramp (`/`) now correctly receives a negative angle for rotation.
// - This fixes the physics bug where right-side ramps were oriented incorrectly,
//   ensuring the simulation matches the visual representation.
// ===================================================================================

// --- Worker State ---
let workerId;
let sim_config;
let fitnessWeights;
let Matter;

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
            importScripts('https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js');
            Matter = self.Matter;
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
    const sim = new Simulation(sim_config, {});
    sim.setupFullSimulation();
    sim.buildBoard(sim.engine.world, chromosome);
    const { Bodies, World, Engine } = Matter;
    const piece = Bodies.rectangle(sim_config.SIM_CONFIG.MACHINE_WIDTH / 2, 10, 8, 8, { ...sim_config.PIECE_PHYSICS_PROPERTIES, label: 'control' });
    World.add(sim.engine.world, piece);
    
    let initialY = piece.position.y;
    for (let i = 0; i < 1000; i++) {
        Engine.update(sim.engine, sim_config.TIME_STEP);
    }
    
    const detectorY = sim_config.SIM_CONFIG.MACHINE_HEIGHT - (chromosome.detectorHeight || 50);
    if (piece.position.y <= initialY) {
        self.postMessage({ type: 'positive_control_failure', payload: { id: workerId, error: 'gravity_test_failed' } });
    } else if (piece.position.y < detectorY) {
        self.postMessage({ type: 'positive_control_failure', payload: { id: workerId, error: 'detector_line_not_crossed' } });
    } else {
        self.postMessage({ type: 'positive_control_success', payload: { id: workerId } });
    }
}


class Simulation {
    constructor(config, fitnessWeights) {
        this.config = config;
        this.fitnessWeights = fitnessWeights;
        this.Matter = Matter;
        this.pieceLibrary = this.config.PIECE_LIBRARY.map(p => ({
            ...p,
            vertices: this.Matter.Vertices.fromPath(p.vertices)
        }));
    }

    run(chromosome) {
        const isPassable = this.runSacrificialTest(chromosome);
        if (!isPassable) {
            return this.calculateFinalMetrics("SacrificialFailure", [], chromosome);
        }

        try {
            this.setupFullSimulation();
            this.buildBoard(this.engine.world, chromosome);
            const earlyExitReason = this.runFullSimulation(chromosome);
            const piecesInWorld = this.Matter.Composite.allBodies(this.engine.world).filter(b => b.label === 'lego');
            return this.calculateFinalMetrics(earlyExitReason, piecesInWorld, chromosome);
        } catch (error) {
            console.error(`[Sub-Worker ${workerId}] CRITICAL SIMULATION CRASH for chromosome ${chromosome.id}:`, error);
            return this.calculateFinalMetrics("CRASH", [], chromosome, error.message);
        }
    }
    
    runSacrificialTest(chromosome) {
        const { Engine, Composite, Bodies, Body } = this.Matter;
        const testEngine = Engine.create({ gravity: { ...this.config.ENGINE_CONFIG.gravity } });
        const testWorld = testEngine.world;
        this.buildBoard(testWorld, chromosome);

        const sacrificialPieceDef = this.pieceLibrary[this.pieceLibrary.length - 1];
        const sacrificialPiece = Bodies.fromVertices(
            chromosome.conveyorDropX, 10, [sacrificialPieceDef.vertices],
            { label: 'sacrificial', friction: 0, frictionStatic: 0, restitution: 0 }
        );
        Composite.add(testWorld, sacrificialPiece);

        const SACRIFICIAL_TIMEOUT = 30000;
        let simTime = 0;

        while (simTime < SACRIFICIAL_TIMEOUT) {
            BOARD_ANGLE_CALC_FN(testEngine.gravity, chromosome.boardAngle);
            Body.applyForce(sacrificialPiece, sacrificialPiece.position, { x: (Math.random() - 0.5) * 0.01, y: 0 });
            Engine.update(testEngine, this.config.TIME_STEP);
            simTime += this.config.TIME_STEP;

            const detectorY = this.config.SIM_CONFIG.MACHINE_HEIGHT - chromosome.detectorHeight;
            if (sacrificialPiece.position.y > detectorY) {
                return true;
            }
        }
        
        return false;
    }

    setupFullSimulation() {
        const { Engine } = this.Matter;
        this.engine = Engine.create({
            gravity: { ...this.config.ENGINE_CONFIG.gravity },
            positionIterations: this.config.ENGINE_CONFIG.positionIterations,
            velocityIterations: this.config.ENGINE_CONFIG.velocityIterations
        });
        this.simulationTime = 0;
        this.exitedPieceIDs = new Set();
        this.exitTimes = [];
        this.exitClumps = [];
        this.physicsViolationCount = 0;
        this.timeOfLastExit = 0;
    }

    buildBoard(world, chromosome) {
        const { World } = this.Matter;
        const boardBodies = this.createBoardFromS35Chromosome(chromosome);
        World.add(world, boardBodies);
    }

    createBoardFromS35Chromosome(chromosome) {
        const { Bodies, Vector } = this.Matter;
        const allBodies = [];
        const wallOptions = { isStatic: true };
        const { channelWidth, cascadingRamps, detectorOffset, detectorHeight, finalRampKneeX_factor, finalRampKneeY_factor } = chromosome;
        const channelCenterX = this.config.SIM_CONFIG.MACHINE_WIDTH / 2;
        const leftWallX = channelCenterX - (channelWidth / 2);
        const rightWallX = channelCenterX + (channelWidth / 2);

        allBodies.push(Bodies.rectangle(leftWallX, this.config.SIM_CONFIG.MACHINE_HEIGHT / 2, this.config.SIM_CONFIG.WALL_THICKNESS, this.config.SIM_CONFIG.MACHINE_HEIGHT, wallOptions));
        allBodies.push(Bodies.rectangle(rightWallX, this.config.SIM_CONFIG.MACHINE_HEIGHT / 2, this.config.SIM_CONFIG.WALL_THICKNESS, this.config.SIM_CONFIG.MACHINE_HEIGHT, wallOptions));
        
        const detectorX = channelCenterX + detectorOffset;

        cascadingRamps.forEach((ramp, index) => {
            const isLastRamp = index === cascadingRamps.length - 1;
            const rampThickness = this.config.SIM_CONFIG.RAMP_THICKNESS;
            const attachX = ramp.side === 'left' ? leftWallX + (this.config.SIM_CONFIG.WALL_THICKNESS / 2) : rightWallX - (this.config.SIM_CONFIG.WALL_THICKNESS / 2);

            if (isLastRamp) {
                const p0 = Vector.create(attachX, ramp.y_position);
                const p2 = Vector.create(detectorX + (this.config.SENSOR_CONFIG.DETECTOR_WIDTH / 2), this.config.SIM_CONFIG.MACHINE_HEIGHT - detectorHeight);
                const totalVector = Vector.sub(p2, p0);
                const p1 = Vector.add(p0, { x: totalVector.x * finalRampKneeX_factor, y: totalVector.y * finalRampKneeY_factor });
                const points = [p0, p1, p2];
                for (let i = 0; i < points.length - 1; i++) {
                    const start = points[i];
                    const end = points[i+1];
                    const segmentVector = Vector.sub(end, start);
                    const length = Vector.magnitude(segmentVector);
                    const angle = Vector.angle(segmentVector, {x: 1, y: 0});
                    const center = Vector.add(start, Vector.mult(Vector.normalise(segmentVector), length / 2));
                    if (length > 1) {
                         allBodies.push(Bodies.rectangle(center.x, center.y, length, rampThickness, { isStatic: true, angle: angle }));
                    }
                }
            } else {
                const rampLength = channelWidth * 0.85;
                // CORRECTED: A left ramp (\) needs a positive angle, a right ramp (/) needs a negative one.
                const effectiveAngle = (ramp.side === 'left') ? ramp.angle : -ramp.angle;
                
                const centerOffsetX = (rampLength / 2) * Math.cos(ramp.angle);
                const centerOffsetY = (rampLength / 2) * Math.sin(ramp.angle);
                
                const rampCenterX = attachX + (ramp.side === 'left' ? centerOffsetX : -centerOffsetX);
                const rampCenterY = ramp.y_position + centerOffsetY;

                if (rampLength > 1) {
                    allBodies.push(Bodies.rectangle(rampCenterX, rampCenterY, rampLength, rampThickness, { isStatic: true, angle: effectiveAngle }));
                }
            }
        });
        return allBodies;
    }
    
    runFullSimulation(chromosome) {
        const { Engine, Composite, Bodies } = this.Matter;
        const { MAX_SIM_TIME, TIME_STEP } = this.config;
        const TURBO_FACTOR = 100;

        const numBatches = chromosome.numBatches;
        const piecesPerBatch = chromosome.batchSize;
        const totalPieces = piecesPerBatch * numBatches;

        const batches = Array.from({length: numBatches}, (_, i) => ({
            startTime: i * (chromosome.dropDelayTime), hasStarted: false, piecesSpawned: 0, dropStartTime: 0
        }));

        let lastTime = performance.now();
        let accumulator = 0;

        while (this.simulationTime < MAX_SIM_TIME) {
            const currentTime = performance.now();
            accumulator += (currentTime - lastTime) * TURBO_FACTOR;
            lastTime = currentTime;

            if (Composite.allBodies(this.engine.world).filter(b => b.label === 'lego').length === 0 && batches.every(b => b.piecesSpawned >= piecesPerBatch)) {
                return "Completed";
            }

            while (accumulator >= TIME_STEP) {
                batches.forEach((batch) => {
                    if (!batch.hasStarted && this.simulationTime >= batch.startTime) {
                        batch.hasStarted = true; batch.dropStartTime = this.simulationTime;
                    }
                    if (batch.hasStarted && batch.piecesSpawned < piecesPerBatch) {
                        const elapsedDropTime = this.simulationTime - batch.dropStartTime;
                        const dropProgress = Math.min(1, elapsedDropTime / (chromosome.batchDropDuration));
                        const easedProgress = 0.5 * (1 - Math.cos(dropProgress * Math.PI));
                        const expectedSpawns = Math.floor(easedProgress * piecesPerBatch);
                        const newSpawns = Math.min(piecesPerBatch, expectedSpawns) - batch.piecesSpawned;
                        if (newSpawns > 0) {
                            for (let i = 0; i < newSpawns; i++) {
                                const shapeDef = this.pieceLibrary[Math.floor(Math.random() * this.pieceLibrary.length)];
                                const spawnX = chromosome.conveyorDropX + (Math.random() - 0.5) * chromosome.conveyorDropWidth;
                                const piece = Bodies.fromVertices(spawnX, 10, [shapeDef.vertices], { label: 'lego', ...this.config.PIECE_PHYSICS_PROPERTIES });
                                Composite.add(this.engine.world, piece);
                            }
                            batch.piecesSpawned += newSpawns;
                        }
                    }
                });

                BOARD_ANGLE_CALC_FN(this.engine.gravity, chromosome.boardAngle);

                this.engine.gravity.x = (Math.random() - 0.5) * (chromosome.shakeAmplitude || 0);

                Engine.update(this.engine, TIME_STEP);
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
        const STAGNATION_DURATION = 75000;
        const STUCK_PIECE_DURATION_MS = 20000;
        const MOVEMENT_THRESHOLD = 0.5;

        if (this.exitedPieceIDs.size > 0 && this.simulationTime - this.timeOfLastExit > STAGNATION_DURATION) {
            return "Stagnation";
        }

        const piecesInWorld = this.Matter.Composite.allBodies(this.engine.world).filter(b => b.label === 'lego');
        let currentStuckCount = 0;
        const stuckPieceCountThreshold = Math.max(1, Math.ceil(totalPieces * 0.25));

        piecesInWorld.forEach(body => {
            if (!body.lastMobilePosition) {
                body.lastMobilePosition = { x: body.position.x, y: body.position.y };
                body.stuckTimer = 0;
            }
            const displacement = this.Matter.Vector.magnitude(this.Matter.Vector.sub(body.position, body.lastMobilePosition));
            if (displacement < MOVEMENT_THRESHOLD) {
                body.stuckTimer += this.config.TIME_STEP;
            } else {
                body.stuckTimer = 0;
                body.lastMobilePosition = { x: body.position.x, y: body.position.y };
            }
            if (body.stuckTimer > STUCK_PIECE_DURATION_MS) currentStuckCount++;
        });

        if (currentStuckCount >= stuckPieceCountThreshold) return "StuckPiece";
        return null;
    }

    checkExitedPieces(chromosome) {
        const { Composite } = this.Matter;
        const piecesInWorld = Composite.allBodies(this.engine.world).filter(b => b.label === 'lego');
        let currentFrameExits = 0;
        const main_sensor_y = this.config.SIM_CONFIG.MACHINE_HEIGHT - chromosome.detectorHeight;
        const channelCenterX = this.config.SIM_CONFIG.MACHINE_WIDTH / 2;
        const main_sensor_x_center = channelCenterX + chromosome.detectorOffset;
        const main_sensor_start = main_sensor_x_center - (this.config.SENSOR_CONFIG.DETECTOR_WIDTH / 2);
        const main_sensor_end = main_sensor_x_center + (this.config.SENSOR_CONFIG.DETECTOR_WIDTH / 2);

        for (let i = piecesInWorld.length - 1; i >= 0; i--) {
            const body = piecesInWorld[i];
            if (body.position.y > main_sensor_y && body.position.x >= main_sensor_start && body.position.x <= main_sensor_end) {
                if (!this.exitedPieceIDs.has(body.id)) {
                    this.exitedPieceIDs.add(body.id);
                    this.exitTimes.push(this.simulationTime);
                    this.timeOfLastExit = this.simulationTime;
                    currentFrameExits++;
                }
                Composite.remove(this.engine.world, body);
            }
        }
        if (currentFrameExits > 0) this.exitClumps.push(currentFrameExits);
    }
    
    calculateFinalMetrics(exitReason, piecesInWorld, chromosome, error = null) {
        if (exitReason === "SacrificialFailure") {
            return { finalScore: -1e9, exitReason, throughputScore: 0, totalPieces: chromosome.numBatches * chromosome.batchSize, jamPenalty: chromosome.numBatches * chromosome.batchSize, fitnessBreakdown: {} };
        }
        
        const { W_TP_EXP, W_TP_LIN, W_TC, W_J, W_S, W_IQR, W_CON_EXP, W_CON_LIN, W_SYM_EXP, W_SYM_LIN, W_ZONE_REJECT, W_ZONE_LOW, W_ZONE_HIGH, W_ZONE_JAM, W_PREF_COUNT, W_PREF_RATIO_EXP, W_PREF_RATIO_LIN, W_PV } = this.fitnessWeights;
        const totalPieces = chromosome.numBatches * chromosome.batchSize;
        let throughputScore = this.exitedPieceIDs.size;
        let isEstimated = false;

        if (exitReason === "StuckPiece" || exitReason === "StragglerTimeout") {
            isEstimated = true;
            const piecesAlreadyExited = throughputScore;
            if (piecesAlreadyExited > 0) {
                const stuckPieces = piecesInWorld.filter(p => p.stuckTimer > 20000).length;
                const piecesStillMoving = piecesInWorld.filter(p => !p.stuckTimer || p.stuckTimer < 5000).length;
                const stateBasedEstimate = piecesAlreadyExited + piecesStillMoving - stuckPieces;
                throughputScore = Math.max(piecesAlreadyExited, Math.min(totalPieces, Math.round(stateBasedEstimate)));
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
                else if (i >= 250 && i <= 750) preferredIntervalCount++;
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
            impact_pref_ratio_exp: (W_PREF_RATIO_EXP || 0) * Math.pow(preferredIntervalRatio, 3),
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

        return {
            finalScore, throughputScore, totalPieces, jamPenalty, simultaneousPenalty, consistencyRewardRatio, symmetryRewardRatio,
            normalizedIQR, intervals, clumpHistogram, exitReason, isEstimated, error,
            physicsViolationCount: this.physicsViolationCount,
            fitnessBreakdown, preferredIntervalCount, preferredIntervalRatio,
            rejectCount, lowCount, highCount, jamCount,
        };
    }
}
