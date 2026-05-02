// ga_worker_S34.js (Melded S33 & S34, Upgraded to S34 Physics)
// This file combines the robust, feature-complete EvolutionEngine from S33
// with the S34 architecture, supporting functional chromosomes and the
// human-in-the-loop "Cartographer" workflow with directives.
// S34 UPGRADE: The boardAngle gene is now initialized over its full physical
// range (0 to PI/2) to allow the GA to explore all possible tilts.
// DECOUPLED PIPELINE MODIFICATION: The worker no longer accumulates the full
// survey log. It now sends per-generation data to the main thread to be
// handled in chunks, preventing memory overload.
// WIDER V-SHAPE: The initial funnel width is now generated to be much wider,
// encouraging exploration closer to the board's physical limits.
// BATCH SIZE FIX: The BATCH_SIZE_CONFIG has been retuned to reflect that
// `batchSize` is now a per-batch value, not a total for the run.
// FITNESS AVERAGING FIX: Corrected the elitism logic to ensure the `fitnessHistory`
// of elite chromosomes is properly preserved across generations.
// VERSION 12 FIX: Reverted mutation logic to stable S34 state (no y-mutation)
// and implemented a dedicated, robust normalizeAndSortFunnelAfterCrossover
// function to handle height mismatches during breeding.

let masterConfig = null;
let evolutionEngine = null;
let runId;

self.onmessage = function(e) {
    const { command, payload } = e.data;

    if (command === 'init') {
        masterConfig = payload.config;
        // --- CONFIG BULLETPROOFING: Ensure BOARD_WIDTH exists so math doesn't result in NaN ---
        if (!masterConfig.SIM_CONFIG) masterConfig.SIM_CONFIG = {};
        if (!masterConfig.SIM_CONFIG.BOARD_WIDTH) masterConfig.SIM_CONFIG.BOARD_WIDTH = 1000;
        // -------------------------------------------------------------------------------------
        runId = payload.runId;
        if (!evolutionEngine) {
            evolutionEngine = new EvolutionEngine();
            evolutionEngine.initWorkers();
        }
        return;
    }

    if (!evolutionEngine) {
        console.error("[GA-Worker] Received command before initialization was complete.");
        return;
    }

    switch (command) {
        case 'start':
            evolutionEngine.startEvolution(null, false, payload.fitnessWeights);
            break;
        case 'start_with_seed':
            evolutionEngine.startEvolution(payload.seed, false, payload.fitnessWeights);
            break;
        case 'pause_and_analyze':
            evolutionEngine.pauseEvolution(true);
            break;
        case 'resume_with_directives':
            evolutionEngine.resumeEvolution(payload.directives);
            break;
        case 'stop':
            evolutionEngine.stopEvolution();
            break;
        case 'pause':
            evolutionEngine.pauseEvolution(false);
            break;
        case 'resume':
            evolutionEngine.resumeEvolution(null);
            break;
        case 'load':
            evolutionEngine.stopEvolution();
            evolutionEngine.bestDesignsHistory = payload;
            evolutionEngine.generation = payload.length;
            const bestDesign = payload[payload.length - 1];
            self.postMessage({ type: 'loaded', payload: { generation: evolutionEngine.generation, bestIndividual: bestDesign, history: payload } });
            break;
        case 'get_history':
            self.postMessage({ type: 'history_data', payload: { history: evolutionEngine.bestDesignsHistory, runCount: evolutionEngine.runCount } });
            break;
        case 'get_metareport':
            self.postMessage({ type: 'metareport_data', payload: { report: evolutionEngine.metaHistory, runCount: evolutionEngine.runCount } });
            break;
        default:
            console.error(`[GA-Worker] Unknown command: ${command}`);
            break;
    }
};

// --- GA Settings & Heuristics ---
const POPULATION_SIZE = 120;
const breedingPoolSizeMax = 40;
const ELITISM_COUNT = 8;
const NUM_SUB_WORKERS = navigator.hardwareConcurrency || 4;
const AUTOSAVE_INTERVAL = 50;
const LONGEST_LEGO_LENGTH = 32;
const FUNNEL_PROFILE_CONFIG = {
    NUM_SLICES: 8,
    PINCH_POINT_THRESHOLD: LONGEST_LEGO_LENGTH * 5,
    INITIAL_TOP_WIDTH_RANGE: { MIN: 800, MAX: 1200 },
    INITIAL_BOTTOM_WIDTH_RANGE: { MIN: 170, MAX: 400 }
};
const MACHINE_HEIGHT_CONFIG = { MIN: 800, MAX: 1600 };
const DETECTOR_OFFSET_CONFIG = { MIN: -400, MAX: 400 };
const ANGLE_CONSTRAINT = { MAX_HORIZONTAL_RADIANS: 1.4, MIN_HORIZONTAL_RADIANS: -1.4 };
// Change the MIN and MAX in the COMPLEX_RAMP object
const LATENT_GENE_CONFIG = {
    // 1. Increase total genetic capacity so the GA has more latent genes to play with
    NUM_PEG_MATRICES: 15, 
    NUM_COMPLEX_RAMPS: 15, 
    
    // 2. Force the algorithm to turn on 8 of these obstacles right at Generation 1
    MIN_ACTIVE_OBSTACLES: 8, 
    
    COMPLEX_RAMP: { PEG_MAX_RADIUS: 20, INITIAL_LENGTH: { MIN: 45, MAX: 400 } }
};
const BATCH_SIZE_CONFIG = { MIN: 150, MAX: 500 };
const NUM_BATCHES_CONFIG = { MIN: 2, MAX: 5 };
const DROP_DELAY_CONFIG = { MIN: 0, MAX: 200000 };
const BATCH_DROP_DURATION_CONFIG = { MIN: 50, MAX: 5000 };
const FREE_FALL_TIME_CONFIG = { MIN: 20, MAX: 500 };
const CONVEYOR_DROP_CONFIG = { DROP_X: { MIN: 800, MAX: 1200 }, DROP_WIDTH: { MIN: 200, MAX: 600 } };
const SHAKE_CONFIG = {
    MAX_AMP: 0.7, MAX_TIME_ON: 50, MAX_TIME_OFF: 100,
    MAX_AMP_HARSH: 0.8, MAX_TIME_ON_HARSH: 20, MAX_TIME_OFF_HARSH: 500, MIN_TIME_OFF_HARSH: 200,
    BIAS_PROBABILITY: 0.8,
    BIASED_AMP_RANGE: { MIN: 0.15, MAX: 0.3 },
    BIASED_TIME_ON_RANGE: { MIN: 10, MAX: 30 },
    BIASED_TIME_OFF_RANGE: { MIN: 1, MAX: 5 }
};
const PEG_MATRIX_CONFIG = {
    MAX_GRID_DIM: 4, SPACING: { MIN: 15, MAX: 40 }, // Stop making 1000px wide walls
    STAGGER: { MIN: -20, MAX: 20 }, ROTATION: { MIN: -Math.PI / 4, MAX: Math.PI / 4 },
};

// --- Helper Functions ---
let nextChromosomeId = 0;
const getUniqueId = () => nextChromosomeId++;
const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
function randn_bm(min, max, skew = 1) {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    num = num / 10.0 + 0.5;
    if (num > 1 || num < 0) return randn_bm(min, max, skew);
    num = Math.pow(num, skew);
    num *= max - min;
    num += min;
    return num;
}

class EvolutionEngine {
    constructor() {
        this.subWorkers = [];
        this.population = [];
        this.generation = 0;
        this.runCount = 1;
        this.metaHistory = [];
        this.bestDesignsHistory = [];
        this.isRunning = false;
        this.isPaused = false;
        this.stagnationCounter = 0;
        this.currentMutationRate = 0.05;
        this.workersInitialized = false;
        this.jobQueue = null;
        this.allTimeBest = { chromosome: null, result: null, fitness: -Infinity };
        this.currentDirectives = null;
        this.fitnessWeights = null;
        
        // --- CIRCUIT BREAKER STATE ---
        this.consecutiveFailures = 0;
        this.MAX_CONSECUTIVE_FAILURES = 25; 
        this.lastFailureReason = "";
    }

    initWorkers() {
        return new Promise((resolve, reject) => {
            this.workersInitialized = false;
            this.subWorkers.forEach(w => w.terminate());
            this.subWorkers = [];
            let workersReadyCount = 0;

            const onWorkerReady = (workerId) => {
                const worker = this.subWorkers.find(w => w.id === workerId);
                if (!worker || worker.isReady) return;
                this.runPositiveControlTest(worker);
            };

            const onPositiveControlSuccess = (workerId) => {
                const worker = this.subWorkers.find(w => w.id === workerId);
                if (!worker || worker.isReady) return;
                worker.isReady = true;
                workersReadyCount++;
                if (workersReadyCount === NUM_SUB_WORKERS) {
                    this.workersInitialized = true;
                    self.postMessage({ type: 'engine_ready' });
                    resolve();
                }
            };

            const onPositiveControlFailure = ({id, error}) => {
                console.error(`[GA-Worker] CRITICAL: Positive Control Test FAILED for sub_worker ${id}. Reason: ${error}`);
                this.stopEvolution();
                self.postMessage({ type: 'error', payload: `Worker ${id} failed init test. Halting.` });
                reject(new Error(`Sub-worker ${id} failed Positive Control Test.`));
            };

            for (let i = 0; i < NUM_SUB_WORKERS; i++) {
                const worker = new Worker(`sub_worker_S34.js?run=${runId}`);
                worker.id = i;
                worker.isReady = false;

                worker.onmessage = (e) => {
                    const {type, payload} = e.data;
                    switch (type) {
                        case 'worker_ready': onWorkerReady(payload.id); break;
                        case 'positive_control_success': onPositiveControlSuccess(payload.id); break;
                        case 'positive_control_failure': onPositiveControlFailure(payload); break;
                        case 'test_result': this.processWorkerResult(e); break;
                    }
                };
                worker.onerror = (e) => {
                    console.error(`[GA-Worker] CRITICAL ERROR in sub_worker ${i}:`, e);
                    this.stopEvolution();
                    reject(new Error(`Sub-worker ${i} crashed.`));
                };

                this.subWorkers.push(worker);
                worker.postMessage({ command: 'init', payload: { id: i, config: masterConfig } });
            }
        });
    }

    runPositiveControlTest(worker) {
        const nullChromosome = {
            id: -1,
            funnel_profile: [{ y_position: 0, width: 800, offset: 0 }, { y_position: 1600, width: 100, offset: 0 }],
            detectorOffset: 0, machineHeight: 1600, boardAngle: 0,
            complexRamps: [], pegMatrices: [],
            batchSize: 1, numBatches: 1, dropDelayTime: 0, batchDropDuration: 1, freeFallTime: 100,
            conveyorDropX: 1000, conveyorDropWidth: 10,
            shakeAmplitude: 0, shakeTimeOn: 0, shakeTimeOff: 0,
            shakeAmplitude_harsh: 0, shakeTimeOn_harsh: 0, shakeTimeOff_harsh: 0,
        };
        worker.postMessage({ command: 'run_positive_control', payload: { chromosome: nullChromosome } });
    }

    async startEvolution(seed = null, isDirected = false, fitnessWeights) {
        if (this.isRunning) return;
        if (!this.workersInitialized) {
            await this.initWorkers().catch(err => { console.error("Worker init failed.", err); return; });
        }
        if (!this.workersInitialized) return;

        this.isRunning = true;
        this.isPaused = false;
        if (this.generation > 0) this.runCount++;
        this.generation = 0;
        this.metaHistory = [];
        this.bestDesignsHistory = [];
        this.allTimeBest = { chromosome: null, result: null, fitness: -Infinity };

        this.fitnessWeights = fitnessWeights;
        if(!this.fitnessWeights){
            console.error("CRITICAL: Fitness weights not provided. Halting evolution.");
            this.stopEvolution();
            self.postMessage({ type: 'error', payload: 'Fitness Weights were not received from UI.' });
            return;
        }

        if (!isDirected) {
            this.currentDirectives = [{
                type: 'bootstrap',
                name: 'Bootstrap',
                population_share: 1.0,
                breeding_pool_ratios: { best: 0.95, straggler: 0.025, newcomer: 0.025 }
            }];
        }

        self.postMessage({ type: 'status', payload: { status: 'Running...', directiveName: this.currentDirectives[0].name } });
        this.createInitialPopulation(seed);
        this.runGeneration();
    }

    createInitialPopulation(seed = null) {
        this.population = [];
        let cleanBaseSeed = null;

        if (seed) {
            // 1. Create a master cleaned version of the seed ONCE
            cleanBaseSeed = JSON.parse(JSON.stringify(seed));
            this.sanitizeChromosome(cleanBaseSeed);

            // 2. Push the exact clean seed as our first elite
            const eliteSeed = JSON.parse(JSON.stringify(cleanBaseSeed));
            eliteSeed.id = getUniqueId();
            this.population.push(eliteSeed);

            // 3. Clone the CLEAN seed for all mutations, NOT the raw broken seed
            const permutatedCount = Math.floor(POPULATION_SIZE / 2) -1;
            for (let i = 0; i < permutatedCount; i++) {
                const child = this.createAndValidateChromosome(() => {
                    const c = JSON.parse(JSON.stringify(cleanBaseSeed)); // <-- THE VITAL FIX
                    this.mutate(c);
                    c.id = getUniqueId();
                    delete c.fitness;
                    delete c.fitnessHistory;
                    return c;
                });
                this.population.push(child);
            }
        }

        if (this.currentDirectives) {
            this.currentDirectives.forEach(directive => {
                const share = directive.population_share || 0;
                const count = Math.floor(POPULATION_SIZE * share);
                for (let i = 0; i < count && this.population.length < POPULATION_SIZE; i++) {
                    const creationFn = () => this.createRandomChromosome(directive);
                    this.population.push(this.createAndValidateChromosome(creationFn));
                }
            });
        }
        while (this.population.length < POPULATION_SIZE) {
            const creationFn = () => this.createRandomChromosome({ type: 'random_unconstrained' });
            this.population.push(this.createAndValidateChromosome(creationFn));
        }
    }

    async runGeneration() {
        if (!this.isRunning) return;
        const genStartTime = performance.now();
        const individualsToEvaluate = this.population.filter(c => !c.fullResult);

        if (individualsToEvaluate.length > 0) {
            await new Promise((resolve, reject) => {
                this.jobQueue = {
                    queue: [...individualsToEvaluate.map(c => ({ c, i: this.population.indexOf(c) }))],
                    totalJobs: individualsToEvaluate.length, resultsReceived: 0, resolve, reject
                };
                this.subWorkers.forEach(worker => {
                    if (this.jobQueue && this.jobQueue.queue.length > 0) this.dispatchJob(this.jobQueue.queue.shift(), worker);
                });
            }).catch(err => { if (err !== 'STOP' && err !== 'PAUSE') console.error("Job queue error:", err); });
        }

        if (!this.isRunning) return;

        this.population.forEach(p => {
            if (p.fullResult && typeof p.fullResult.finalScore === 'number' && isFinite(p.fullResult.finalScore)) {
                if (!p.fitnessHistory) p.fitnessHistory = [];
                p.fitnessHistory.push(p.fullResult.finalScore);
                p.fitness = p.fitnessHistory.reduce((a, b) => a + b, 0) / p.fitnessHistory.length;
            } else { p.fitness = -Infinity; }
        });

        this.population.sort((a, b) => (b.fitness || -Infinity) - (a.fitness || -Infinity));
        const genEndTime = performance.now();
        const bestOfGen = this.population[0];
        if (bestOfGen && bestOfGen.fitness > this.allTimeBest.fitness) {
            this.allTimeBest = { fitness: bestOfGen.fitness, result: bestOfGen.fullResult, chromosome: JSON.parse(JSON.stringify(bestOfGen)) };
            delete this.allTimeBest.chromosome.fullResult;
            this.bestDesignsHistory.push(JSON.parse(JSON.stringify(this.allTimeBest.chromosome)));
            this.stagnationCounter = 0;
        } else {
            this.stagnationCounter++;
        }

        this.logAndSendSurveyData();
        this.adaptHyperparameters();
        this.generateMetareport(genEndTime - genStartTime);

        // UI VISIBILITY FIX: Always show the best of the CURRENT generation, even if it sucks.
        const currentGenBest = JSON.parse(JSON.stringify(bestOfGen));
        delete currentGenBest.fullResult; // Clean up payload
        
        postMessage({
            type: 'update',
            payload: {
                generation: this.generation, runCount: this.runCount,
                bestIndividual: currentGenBest, bestResult: bestOfGen.fullResult,
                mutationRate: this.currentMutationRate, history: this.bestDesignsHistory
            }
        });

        if ((this.generation + 1) % AUTOSAVE_INTERVAL === 0) {
            postMessage({ type: 'autosave', payload: { chromosome: this.allTimeBest.chromosome, generation: this.generation + 1, runCount: this.runCount } });
        }

        this.createNewGeneration();
        this.generation++;
        if (this.isRunning) setTimeout(() => this.runGeneration(), 0);
    }

    triggerEmergencyHalt(suspectId) {
        this.isRunning = false;
        this.isPaused = false;
        if (this.jobQueue) {
            this.jobQueue.reject('EMERGENCY_HALT');
            this.jobQueue = null;
        }
        
        const badChromosome = this.population.find(p => p.id === suspectId) || this.population[0];
        
        self.postMessage({
            type: 'emergency_halt',
            payload: {
                message: `Circuit Breaker Tripped! ${this.consecutiveFailures} consecutive physics failures.`,
                reason: this.lastFailureReason,
                generation: this.generation,
                suspectChromosome: badChromosome
            }
        });
    }

    stopEvolution() {
        this.isRunning = false;
        this.isPaused = false;
        if (this.jobQueue) {
            this.jobQueue.reject('STOP');
            this.jobQueue = null;
        }
        self.postMessage({ type: 'stopped', payload: { bestIndividual: this.allTimeBest.chromosome, bestResult: this.allTimeBest.result, mutationRate: this.currentMutationRate, history: this.bestDesignsHistory }});
    }

    pauseEvolution(isForAnalysis) {
        if (!this.isRunning || this.isPaused) return;
        this.isPaused = true;
        this.isRunning = false;
        if (this.jobQueue) {
            this.jobQueue.reject('PAUSE');
        }
        const directiveName = isForAnalysis ? "Paused for Analysis" : "User Paused";
        self.postMessage({ type: 'paused', payload: { directiveName, bestIndividual: this.allTimeBest.chromosome, bestResult: this.allTimeBest.result, mutationRate: this.currentMutationRate } });
    }

    resumeEvolution(directives) {
        if (this.isRunning) return;

        this.isPaused = false;
        this.isRunning = true;
        if (directives) {
            this.currentDirectives = directives;
        }
        const directiveName = directives ? directives[0].name : (this.currentDirectives ? this.currentDirectives[0].name : "Resumed");
        self.postMessage({ type: 'status', payload: { status: 'Running...', directiveName } });
        this.runGeneration();
    }

    processWorkerResult(e) {
        if (!this.jobQueue || !this.jobQueue.resolve) return;
        const { result, id } = e.data.payload;
        const individual = this.population.find(p => p.id === id);
        
        // --- CIRCUIT BREAKER LOGIC ---
        if (result && (result.exitReason === "CRASH" || result.exitReason === "PhysicsViolation")) {
            this.consecutiveFailures++;
            this.lastFailureReason = result.error || result.exitReason;
        } else {
            // If we get a good result, cool off the breaker slowly
            this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
        }

        if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
            this.triggerEmergencyHalt(id);
            return; // Abort processing this queue immediately
        }
        // -----------------------------

        if (result && individual) {
            individual.fullResult = result;
        }
        this.jobQueue.resultsReceived++;

        self.postMessage({
            type: 'progress_update',
            payload: {
                completed: this.jobQueue.resultsReceived,
                total: this.jobQueue.totalJobs
            }
        });

        const worker = e.target;
        if (this.jobQueue && this.jobQueue.queue.length > 0) {
            this.dispatchJob(this.jobQueue.queue.shift(), worker);
        }

        if (this.jobQueue && this.jobQueue.resultsReceived >= this.jobQueue.totalJobs) {
            this.jobQueue.resolve();
        }
    }

    dispatchJob(job, worker) {
        worker.postMessage({
            command: 'run_test',
            payload: { chromosome: job.c, id: job.c.id, fitnessWeights: this.fitnessWeights }
        });
    }

    logAndSendSurveyData() {
        const generationSurveyLog = [];
        this.population.forEach(ind => {
            if (ind.fullResult) {
                const chromosomeCopy = { ...ind };
                delete chromosomeCopy.fullResult;

                const logEntry = {
                    chromosome: chromosomeCopy,
                    result: ind.fullResult
                };
                generationSurveyLog.push(logEntry);
            }
        });

        if (generationSurveyLog.length > 0) {
            self.postMessage({
                type: 'generation_survey_data',
                payload: generationSurveyLog
            });
        }
    }

    // --- ADDED MISSING METHODS HERE ---
    adaptHyperparameters() {
        if (this.stagnationCounter >= 5) {
            this.currentMutationRate = Math.min(0.50, this.currentMutationRate * 1.1);
        } else if (this.stagnationCounter === 0) {
            this.currentMutationRate = 0.05; 
        }
    }

    generateMetareport(durationMs) {
        this.metaHistory.push({
            generation: this.generation,
            bestFitness: this.allTimeBest.fitness,
            mutationRate: this.currentMutationRate,
            stagnation: this.stagnationCounter,
            duration_ms: durationMs
        });
    }
    // ----------------------------------

    createNewGeneration() {
        const newPopulation = [];
        for (let i = 0; i < ELITISM_COUNT; i++) {
            if (this.population[i]) {
                const oldElite = this.population[i];
                const newElite = JSON.parse(JSON.stringify(oldElite));
                newElite.fullResult = undefined;
                newElite.fitness = -Infinity;
                newPopulation.push(newElite);
            }
        }

        const primaryDirective = this.currentDirectives[0] || {};
        const ratios = primaryDirective.breeding_pool_ratios || { best: 0.95, straggler: 0.025, newcomer: 0.025 };
        const breedingPoolSize = Math.min(this.population.length, breedingPoolSizeMax);

        const breedingPool = [];
        const bestPoolSize = Math.floor(breedingPoolSize * ratios.best);
        for (let i = 0; i < bestPoolSize; i++) {
            breedingPool.push(this.population[i % this.population.length]);
        }

        const stragglerPoolSize = Math.floor(breedingPoolSize * ratios.straggler);
        const stragglerSource = this.population.slice(bestPoolSize);
        if (stragglerSource.length > 0) {
            for (let i = 0; i < stragglerPoolSize; i++) {
                breedingPool.push(stragglerSource[Math.floor(Math.random() * stragglerSource.length)]);
            }
        }

        while (newPopulation.length < POPULATION_SIZE) {
            if (Math.random() < ratios.newcomer) {
                 const newcomer = this.createAndValidateChromosome(() => this.createRandomChromosome(primaryDirective));
                 newPopulation.push(newcomer);
                 continue;
            }

            const parentA = breedingPool[Math.floor(Math.random() * breedingPool.length)];
            const parentB = breedingPool[Math.floor(Math.random() * breedingPool.length)];
            const child = this.createAndValidateChromosome(() => {
                const c = this.crossover(parentA, parentB);
                this.mutate(c, primaryDirective);
                return c;
            });
            newPopulation.push(child);
        }
        this.population = newPopulation;
    }

    createAndValidateChromosome(creationFn) {
        const c = creationFn();
        this.sanitizeChromosome(c);
        return c;
    }

    sanitizeChromosome(chromosome) {
        if (!chromosome) return;

        // 1. Sanitize Drop Zone & Timing
        if (chromosome.conveyorDropX == null || isNaN(chromosome.conveyorDropX)) {
            chromosome.conveyorDropX = 500; // Hard fallback to 500 center
        }
        if (chromosome.conveyorDropWidth == null || isNaN(chromosome.conveyorDropWidth)) {
            chromosome.conveyorDropWidth = 400; 
        }
        if (chromosome.freeFallTime == null || isNaN(chromosome.freeFallTime)) {
            chromosome.freeFallTime = 100;
        }
        
        // 2. Sanitize Funnel Profile
        if (chromosome.funnel_profile) {
            chromosome.funnel_profile.forEach(slice => {
                if (slice.offset == null || isNaN(slice.offset)) slice.offset = 0;
                if (slice.width == null || isNaN(slice.width)) slice.width = 400;
            });
        }
        if (chromosome.detectorOffset == null || isNaN(chromosome.detectorOffset)) {
            chromosome.detectorOffset = 0;
        }

        // 3. Sanitize Obstacles
        if (chromosome.complexRamps) {
            chromosome.complexRamps.forEach(ramp => {
                if (ramp.x == null || isNaN(ramp.x)) ramp.x = 500; // Hard fallback
            });
        }
        if (chromosome.pegMatrices) {
            chromosome.pegMatrices.forEach(matrix => {
                if (matrix.x == null || isNaN(matrix.x)) matrix.x = 500; // Hard fallback
            });
        }
    }

    validateFunnelProfile(chromosome) {
        const { funnel_profile } = chromosome;
        if (!funnel_profile || funnel_profile.length < 2) return true;

        // 1. Verify that the funnel slices are sorted vertically and do not fold back on themselves.
        for (let i = 0; i < funnel_profile.length - 1; i++) {
            if (funnel_profile[i].y_position >= funnel_profile[i+1].y_position) {
                return false; // Vertical order violation
            }
        }

        // 2. Check all EVOLVABLE slices (all but the last one) for pinch points and wall crossover.
        const evolvableProfile = funnel_profile.slice(0, -1);
        for (const slice of evolvableProfile) {
            const leftX = (masterConfig.SIM_CONFIG.BOARD_WIDTH / 2) + slice.offset - slice.width / 2;
            const rightX = (masterConfig.SIM_CONFIG.BOARD_WIDTH / 2) + slice.offset + slice.width / 2;
            if (leftX >= rightX) {
                return false; // Wall crossover violation
            }
            if (slice.width < FUNNEL_PROFILE_CONFIG.PINCH_POINT_THRESHOLD) {
                return false; // Pinch point violation
            }
        }

        // 3. For the very LAST slice, only check for wall crossover. Its width is fixed to the sensor
        // and is exempt from the pinch point rule.
        const lastSlice = funnel_profile[funnel_profile.length - 1];
        const last_leftX = (masterConfig.SIM_CONFIG.BOARD_WIDTH / 2) + lastSlice.offset - lastSlice.width / 2;
        const last_rightX = (masterConfig.SIM_CONFIG.BOARD_WIDTH / 2) + lastSlice.offset + lastSlice.width / 2;
        if (last_leftX >= last_rightX) {
            return false; // Wall crossover violation on the final segment
        }

        return true; // The chromosome is valid.
    }

    normalizeAndSortFunnelAfterCrossover(chromosome) {
        const { funnel_profile, machineHeight, detectorOffset } = chromosome;
        if (!funnel_profile || funnel_profile.length < 2) return;

        // --- DEEP GENOME HEALER: Fix missing legacy S33 properties (including nulls) ---
        funnel_profile.forEach(slice => {
            if (slice.offset == null || isNaN(slice.offset)) slice.offset = 0;
            if (slice.width == null || isNaN(slice.width)) slice.width = 400;
        });
        if (chromosome.detectorOffset == null || isNaN(chromosome.detectorOffset)) chromosome.detectorOffset = 0;
        // -------------------------------------------------------------

        // 1. Separate the evolvable slices from the final sensor slice
        const evolvableSlices = funnel_profile.slice(0, -1);
        const sensorSlice = funnel_profile[funnel_profile.length - 1];

        // 2. Find min/max Y of ONLY the evolvable slices
        let minY = Infinity, maxY = -Infinity;
        evolvableSlices.forEach(slice => {
            if (slice.y_position < minY) minY = slice.y_position;
            if (slice.y_position > maxY) maxY = slice.y_position;
        });

        // 3. Rescale evolvable slices to fit safely within the board
        const oldRange = maxY - minY;
        const newRange = (machineHeight - 100) - 50; 
        
        evolvableSlices.forEach((slice, i) => {
            if (oldRange <= 0) { // If flat, distribute evenly
                slice.y_position = 50 + ((i / (evolvableSlices.length - 1)) * newRange);
            } else {
                const t = (slice.y_position - minY) / oldRange;
                slice.y_position = 50 + (t * newRange);
            }
        });

        // 4. Sort ONLY the evolvable slices by Y-position
        evolvableSlices.sort((a, b) => a.y_position - b.y_position);

        // FIX: Force a minimum 1px gap so slices never perfectly overlap and trigger validation failures
        for (let i = 0; i < evolvableSlices.length - 1; i++) {
            if (evolvableSlices[i+1].y_position <= evolvableSlices[i].y_position) {
                evolvableSlices[i+1].y_position = evolvableSlices[i].y_position + 1;
            }
        }

        // 5. Reconstruct the profile: Evolvable slices + Anchored Sensor Slice
        sensorSlice.y_position = machineHeight;
        sensorSlice.width = masterConfig.SENSOR_CONFIG.SENSOR_WIDTH; 
        sensorSlice.offset = detectorOffset;

        chromosome.funnel_profile = [...evolvableSlices, sensorSlice];
    }


    createRandomChromosome(directive = { type: 'random_unconstrained' }) {
        const search_space = directive.search_space || {};
        const getRange = (key, defaultConfig) => ({
            min: search_space[key]?.min ?? defaultConfig.MIN,
            max: search_space[key]?.max ?? defaultConfig.MAX,
        });

        const machineHeight = rand(getRange('machineHeight', MACHINE_HEIGHT_CONFIG).min, getRange('machineHeight', MACHINE_HEIGHT_CONFIG).max);

        const funnel_profile = [];

        const topWidth = rand(masterConfig.SIM_CONFIG.BOARD_WIDTH * 0.85, masterConfig.SIM_CONFIG.BOARD_WIDTH * 0.98);
        const bottomWidthRange = getRange('funnel_profile.width.bottom', FUNNEL_PROFILE_CONFIG.INITIAL_BOTTOM_WIDTH_RANGE);
        const bottomWidth = rand(bottomWidthRange.min, bottomWidthRange.max);

        for (let i = 0; i < FUNNEL_PROFILE_CONFIG.NUM_SLICES; i++) {
            const t = i / (FUNNEL_PROFILE_CONFIG.NUM_SLICES - 1);
            const baseWidth = topWidth + t * (bottomWidth - topWidth);
            
            // FIX 1: Dramatically reduce the noise so the walls are a relatively smooth V-shape to start
            const noise = (i > 0 && i < FUNNEL_PROFILE_CONFIG.NUM_SLICES - 1) ? randn_bm(-5, 5) : 0;
            let finalWidth = baseWidth + noise;

            finalWidth = Math.max(finalWidth, FUNNEL_PROFILE_CONFIG.PINCH_POINT_THRESHOLD);

            // FIX 2: Force the offset to 0 so the funnel is perfectly centered instead of wildly zigzagging
            const finalOffset = 0;

            funnel_profile.push({
                y_position: 50 + t * (machineHeight - 50),
                width: finalWidth,
                offset: finalOffset
            });
        }

        const createComplexRamps = () => {
             const ramps = [];
             for (let i = 0; i < LATENT_GENE_CONFIG.NUM_COMPLEX_RAMPS; i++) {
                 
                 // Generate a steep angle: either pointing sharply left-down or right-down
                 const steepLeft = rand(-1.4, -0.9);
                 const steepRight = rand(0.9, 1.4);
                 const steepRotation = Math.random() < 0.5 ? steepLeft : steepRight;

                 ramps.push({
                     isActive: Math.random() < 0.1,
                     x: rand(masterConfig.SIM_CONFIG.BOARD_WIDTH * 0.2, masterConfig.SIM_CONFIG.BOARD_WIDTH * 0.8),
                     y: rand(150, machineHeight * 0.8),
                     rotation: steepRotation, // <-- Replaced standard horizontal constraint
                     length: rand(LATENT_GENE_CONFIG.COMPLEX_RAMP.INITIAL_LENGTH.MIN, LATENT_GENE_CONFIG.COMPLEX_RAMP.INITIAL_LENGTH.MAX),
                     peg1: { angle: rand(0, 2 * Math.PI), radius: rand(0, LATENT_GENE_CONFIG.COMPLEX_RAMP.PEG_MAX_RADIUS) },
                     peg2: { angle: rand(0, 2 * Math.PI), radius: rand(0, LATENT_GENE_CONFIG.COMPLEX_RAMP.PEG_MAX_RADIUS) }
                 });
             }
             return ramps;
        };
        const createPegMatrices = () => {
            const matrices = [];
            for (let i = 0; i < LATENT_GENE_CONFIG.NUM_PEG_MATRICES; i++) {
                matrices.push({
                    isActive: Math.random() < 0.1,
                    gridX: randInt(2, PEG_MATRIX_CONFIG.MAX_GRID_DIM),
                    gridY: randInt(2, PEG_MATRIX_CONFIG.MAX_GRID_DIM),
                    startSpacingX: rand(PEG_MATRIX_CONFIG.SPACING.MIN, PEG_MATRIX_CONFIG.SPACING.MAX),
                    endSpacingX: rand(PEG_MATRIX_CONFIG.SPACING.MIN, PEG_MATRIX_CONFIG.SPACING.MAX),
                    spacingY: rand(PEG_MATRIX_CONFIG.SPACING.MIN, PEG_MATRIX_CONFIG.SPACING.MAX),
                    rotation: rand(PEG_MATRIX_CONFIG.ROTATION.MIN, PEG_MATRIX_CONFIG.ROTATION.MAX),
                    staggerOffset: rand(PEG_MATRIX_CONFIG.STAGGER.MIN, PEG_MATRIX_CONFIG.STAGGER.MAX),
                    x: rand(masterConfig.SIM_CONFIG.BOARD_WIDTH * 0.25, masterConfig.SIM_CONFIG.BOARD_WIDTH * 0.75),
                    y: rand(100, machineHeight * 0.75)
                });
            }
            return matrices;
        };

        let shakeAmp, shakeOn, shakeOff;
        if (Math.random() < SHAKE_CONFIG.BIAS_PROBABILITY) {
            shakeAmp = rand(SHAKE_CONFIG.BIASED_AMP_RANGE.MIN, SHAKE_CONFIG.BIASED_AMP_RANGE.MAX);
            shakeOn = rand(SHAKE_CONFIG.BIASED_TIME_ON_RANGE.MIN, SHAKE_CONFIG.BIASED_TIME_ON_RANGE.MAX);
            shakeOff = rand(SHAKE_CONFIG.BIASED_TIME_OFF_RANGE.MIN, SHAKE_CONFIG.BIASED_TIME_OFF_RANGE.MAX);
        } else {
            shakeAmp = rand(0, SHAKE_CONFIG.MAX_AMP);
            shakeOn = rand(0, SHAKE_CONFIG.MAX_TIME_ON);
            shakeOff = rand(0, SHAKE_CONFIG.MAX_TIME_OFF);
        }

        const newChromosome = {
            id: getUniqueId(),
            funnel_profile,
            machineHeight,
            detectorOffset: rand(getRange('detectorOffset', DETECTOR_OFFSET_CONFIG).min, getRange('detectorOffset', DETECTOR_OFFSET_CONFIG).max),
            boardAngle: rand(0, 1.2),
            complexRamps: createComplexRamps(),
            pegMatrices: createPegMatrices(),
            batchSize: randInt(BATCH_SIZE_CONFIG.MIN, BATCH_SIZE_CONFIG.MAX),
            numBatches: randInt(NUM_BATCHES_CONFIG.MIN, NUM_BATCHES_CONFIG.MAX),
            dropDelayTime: rand(DROP_DELAY_CONFIG.MIN, DROP_DELAY_CONFIG.MAX),
            batchDropDuration: rand(BATCH_DROP_DURATION_CONFIG.MIN, BATCH_DROP_DURATION_CONFIG.MAX),
            freeFallTime: rand(FREE_FALL_TIME_CONFIG.MIN, FREE_FALL_TIME_CONFIG.MAX),
            // FIX 3: Force the drop zone to be perfectly centered over our new V-funnel
            conveyorDropX: masterConfig.SIM_CONFIG.BOARD_WIDTH / 2,
            conveyorDropWidth: rand(CONVEYOR_DROP_CONFIG.DROP_WIDTH.MIN, CONVEYOR_DROP_CONFIG.DROP_WIDTH.MAX),
            shakeAmplitude: shakeAmp,
            shakeTimeOn: shakeOn,
            shakeTimeOff: shakeOff,
            shakeAmplitude_harsh: rand(0, SHAKE_CONFIG.MAX_AMP_HARSH),
            shakeTimeOn_harsh: rand(0, SHAKE_CONFIG.MAX_TIME_ON_HARSH),
            shakeTimeOff_harsh: rand(SHAKE_CONFIG.MIN_TIME_OFF_HARSH, SHAKE_CONFIG.MAX_TIME_OFF_HARSH),
            fitness: -Infinity,
            fitnessHistory: []
        };
        const finalSlice = newChromosome.funnel_profile[FUNNEL_PROFILE_CONFIG.NUM_SLICES - 1];
        finalSlice.width = masterConfig.SENSOR_CONFIG.SENSOR_WIDTH;
        finalSlice.offset = newChromosome.detectorOffset;

        let activeObstacles = (newChromosome.complexRamps.filter(r => r.isActive).length) + (newChromosome.pegMatrices.filter(p => p.isActive).length);
        const allObstacles = [...newChromosome.complexRamps, ...newChromosome.pegMatrices];
        while(activeObstacles < LATENT_GENE_CONFIG.MIN_ACTIVE_OBSTACLES && allObstacles.length > activeObstacles) {
            let inactiveObstacles = allObstacles.filter(o => !o.isActive);
            if (inactiveObstacles.length === 0) break;
            let obstacleToActivate = inactiveObstacles[Math.floor(Math.random() * inactiveObstacles.length)];
            obstacleToActivate.isActive = true;
            activeObstacles++;
        }

        return newChromosome;
    }

    crossover(parentA, parentB) {
        const child = this.granularCrossoverHelper({}, parentA, parentB);
        child.id = getUniqueId();
        child.fitness = -Infinity;
        child.fitnessHistory = [];
        delete child.fullResult;
        
        this.normalizeAndSortFunnelAfterCrossover(child);

        return child;
    }

    granularCrossoverHelper(child, parentA, parentB) {
        for (const key in parentA) {
            if (key === 'id' || key === 'fitness' || key === 'fitnessHistory' || key === 'fullResult') continue;
            if (Object.prototype.hasOwnProperty.call(parentA, key)) {
                const valA = parentA[key];
                const valB = parentB[key];
                if (Array.isArray(valA)) {
                    child[key] = [];
                    for (let i = 0; i < valA.length; i++) {
                        if (valA[i] !== undefined && valB && valB[i] !== undefined) {
                            child[key][i] = this.granularCrossoverHelper({}, valA[i], valB[i]);
                        } else if (valA[i] !== undefined) {
                            child[key][i] = JSON.parse(JSON.stringify(valA[i]));
                        }
                    }
                } else if (typeof valA === 'object' && valA !== null) {
                    child[key] = this.granularCrossoverHelper({}, valA, valB);
                } else {
                    child[key] = Math.random() < 0.5 ? valA : valB;
                }
            }
        }
        return child;
    }

    mutate(chromosome, directive = { type: 'random_unconstrained' }) {
        const rate = this.currentMutationRate * (directive.mutation_magnitude || 1);

        if (Math.random() < rate) chromosome.boardAngle += randn_bm(-0.2, 0.2);
        chromosome.boardAngle = Math.max(0, Math.min(1.2, chromosome.boardAngle));
        
        // --- DETECTOR OFFSET: Let it swing wildly, but clamp it 150px from the edges ---
        if (Math.random() < rate) chromosome.detectorOffset += randn_bm(-250, 250); 
        const maxDetectorOffset = (masterConfig.SIM_CONFIG.BOARD_WIDTH / 2) - 150;
        chromosome.detectorOffset = Math.max(-maxDetectorOffset, Math.min(maxDetectorOffset, chromosome.detectorOffset));
        
        if (Math.random() < rate) chromosome.machineHeight += randn_bm(-100, 100);
        chromosome.machineHeight = Math.max(MACHINE_HEIGHT_CONFIG.MIN, Math.min(MACHINE_HEIGHT_CONFIG.MAX, chromosome.machineHeight));

        chromosome.funnel_profile.forEach((slice, i) => {
            if (i > 0 && i < chromosome.funnel_profile.length - 1) {
                if (Math.random() < rate) {
                    slice.width += randn_bm(-80, 80);
                }
                if (Math.random() < rate) {
                    slice.offset += randn_bm(-80, 80);
                }
                
                slice.width = Math.max(slice.width, FUNNEL_PROFILE_CONFIG.PINCH_POINT_THRESHOLD);
                
                const maxOffset = (masterConfig.SIM_CONFIG.BOARD_WIDTH / 2) - (slice.width / 2);
                slice.offset = Math.max(-maxOffset, Math.min(slice.offset, maxOffset));
            }
        });

        this.normalizeAndSortFunnelAfterCrossover(chromosome);

        chromosome.complexRamps.forEach(ramp => {
            if (Math.random() < rate) ramp.isActive = !ramp.isActive;
            if (Math.random() < rate) ramp.x += randn_bm(-100, 100);
            if (Math.random() < rate) ramp.y += randn_bm(-100, 100);
            if (Math.random() < rate) {
                ramp.rotation += randn_bm(-Math.PI/8, Math.PI/8);
                ramp.rotation = Math.max(ANGLE_CONSTRAINT.MIN_HORIZONTAL_RADIANS, Math.min(ANGLE_CONSTRAINT.MAX_HORIZONTAL_RADIANS, ramp.rotation));
            }
            if (Math.random() < rate) ramp.length += randn_bm(-20, 20);
            if (Math.random() < rate) ramp.peg1.radius += randn_bm(-5, 5);
            if (Math.random() < rate) ramp.peg1.angle += randn_bm(-Math.PI / 4, Math.PI / 4);
            if (Math.random() < rate) ramp.peg2.radius += randn_bm(-5, 5);
            if (Math.random() < rate) ramp.peg2.angle += randn_bm(-Math.PI / 4, Math.PI / 4);

            ramp.length = Math.max(10, ramp.length);
            ramp.peg1.radius = Math.max(1, ramp.peg1.radius);
            ramp.peg2.radius = Math.max(1, ramp.peg2.radius);
        });

        chromosome.pegMatrices.forEach(matrix => {
            if (Math.random() < rate) matrix.isActive = !matrix.isActive;
            if (Math.random() < rate) matrix.x += randn_bm(-100, 100);
            if (Math.random() < rate) matrix.y += randn_bm(-100, 100);
            if (Math.random() < rate) matrix.gridX += randn_bm(-2, 2);
            if (Math.random() < rate) matrix.gridY += randn_bm(-2, 2);
            if (Math.random() < rate) matrix.startSpacingX += randn_bm(-10, 10);
            if (Math.random() < rate) matrix.endSpacingX += randn_bm(-10, 10);
            if (Math.random() < rate) matrix.spacingY += randn_bm(-10, 10);
            if (Math.random() < rate) matrix.rotation += randn_bm(-Math.PI / 8, Math.PI / 8);
            if (Math.random() < rate) matrix.staggerOffset += randn_bm(-5, 5);

            matrix.gridX = Math.max(2, Math.round(matrix.gridX));
            matrix.gridY = Math.max(2, Math.round(matrix.gridY));
            matrix.startSpacingX = Math.max(10, matrix.startSpacingX);
            matrix.endSpacingX = Math.max(10, matrix.endSpacingX);
            matrix.spacingY = Math.max(10, matrix.spacingY);
        });

        if (Math.random() < rate) chromosome.batchSize += randn_bm(-50, 50);
        if (Math.random() < rate) chromosome.numBatches += randn_bm(-1, 1);
        if (Math.random() < rate) chromosome.dropDelayTime += randn_bm(-250, 250);
        if (Math.random() < rate) chromosome.batchDropDuration += randn_bm(-250, 250);
        if (Math.random() < rate) chromosome.freeFallTime += randn_bm(-20, 20);
        
        // --- SPAWNER LOCATION: Allow massive horizontal leaps, but keep it on screen ---
        if (Math.random() < rate) chromosome.conveyorDropX += randn_bm(-250, 250);
        chromosome.conveyorDropX = Math.max(150, Math.min(masterConfig.SIM_CONFIG.BOARD_WIDTH - 150, chromosome.conveyorDropX));
        
        if (Math.random() < rate) chromosome.conveyorDropWidth += randn_bm(-50, 50);

        chromosome.batchSize = Math.max(BATCH_SIZE_CONFIG.MIN, Math.min(BATCH_SIZE_CONFIG.MAX, Math.round(chromosome.batchSize)));
        chromosome.numBatches = Math.max(NUM_BATCHES_CONFIG.MIN, Math.min(NUM_BATCHES_CONFIG.MAX, Math.round(chromosome.numBatches)));

        chromosome.batchSize = Math.max(1, Math.round(chromosome.batchSize));
        chromosome.numBatches = Math.max(1, Math.round(chromosome.numBatches));
        chromosome.dropDelayTime = Math.max(0, chromosome.dropDelayTime);
        chromosome.batchDropDuration = Math.max(1, chromosome.batchDropDuration);
        chromosome.freeFallTime = Math.max(1, chromosome.freeFallTime);

        if (Math.random() < rate) chromosome.shakeAmplitude += randn_bm(-0.05, 0.05);
        if (Math.random() < rate) chromosome.shakeTimeOn += randn_bm(-5, 5);
        if (Math.random() < rate) chromosome.shakeTimeOff += randn_bm(-10, 10);
        if (Math.random() < rate) chromosome.shakeAmplitude_harsh += randn_bm(-0.1, 0.1);
        if (Math.random() < rate) chromosome.shakeTimeOn_harsh += randn_bm(-5, 5);
        if (Math.random() < rate) chromosome.shakeTimeOff_harsh += randn_bm(-50, 50);

        chromosome.shakeAmplitude = Math.max(0, chromosome.shakeAmplitude);
        chromosome.shakeTimeOn = Math.max(0, chromosome.shakeTimeOn);
        chromosome.shakeTimeOff = Math.max(0, chromosome.shakeTimeOff);
        chromosome.shakeAmplitude_harsh = Math.max(0, chromosome.shakeAmplitude_harsh);
        chromosome.shakeTimeOn_harsh = Math.max(0, chromosome.shakeTimeOn_harsh);
        chromosome.shakeTimeOff_harsh = Math.max(0, chromosome.shakeTimeOff_harsh);

        const finalSlice = chromosome.funnel_profile[chromosome.funnel_profile.length - 1];
        // Added fallback to DETECTOR_WIDTH for config safety
        finalSlice.width = masterConfig.SENSOR_CONFIG.SENSOR_WIDTH || masterConfig.SENSOR_CONFIG.DETECTOR_WIDTH || 300;
        finalSlice.offset = chromosome.detectorOffset;
        finalSlice.y_position = chromosome.machineHeight;

        return chromosome;
    }

    adaptHyperparameters() {
        if (this.stagnationCounter > 10) {
            this.currentMutationRate = Math.min(0.20, this.currentMutationRate * 1.5);
        } else {
            this.currentMutationRate = Math.max(0.05, this.currentMutationRate * 0.98);
        }
    }

    generateMetareport(duration) {
        const fitnessValues = this.population.map(p => p.fitness).filter(f => isFinite(f));
        if (fitnessValues.length === 0) return;

        const meanFitness = fitnessValues.reduce((a, b) => a + b, 0) / fitnessValues.length;

        const stdDev = Math.sqrt(fitnessValues.map(x => Math.pow(x - meanFitness, 2)).reduce((a, b) => a + b) / fitnessValues.length);

        const top20 = this.population.slice(0, 20);
        const top20MeanFitness = top20.reduce((sum, p) => sum + p.fitness, 0) / top20.length;
        const exitReasons = {};
        this.population.forEach(ind => {
            const reason = ind.fullResult?.exitReason || 'Unknown';
            exitReasons[reason] = (exitReasons[reason] || 0) + 1;
        });
        const bestResult = this.population[0].fullResult || {};
        const report = {
            generation: this.generation, run: this.runCount, duration: duration.toFixed(0),
            bestFitness: this.population[0].fitness, meanFitness, stdDev, top20MeanFitness,
            earlyExitCounts: exitReasons, mutationRate: this.currentMutationRate,
            bestOfGenMetrics: {
                throughput: bestResult.throughputScore, jamPenalty: bestResult.jamPenalty,
                simultaneousPenalty: bestResult.simultaneousPenalty, consistencyRewardRatio: bestResult.consistencyRewardRatio,
                symmetryRewardRatio: bestResult.symmetryRewardRatio || 0
            }
        };
        this.metaHistory.push(report);
    }
}
