// ga_worker_S35.js
// S35 UPGRADE: The EvolutionEngine is rewritten to generate, breed, and mutate
// S35 'cascade' chromosomes. It implements the new heuristic-driven creation
// and intelligent mutation models from the S35 specification.
//
// ===================================================================================
// == VERSION 9.7 BUG FIX: FITNESS HISTORY TRACKING                                 ==
// ===================================================================================
// - Corrected a logical error where the `bestDesignsHistory` report was not being
//   updated for a reigning champion chromosome after it was re-evaluated.
// - The `runGeneration` function now explicitly checks if the best-of-generation
//   is the same ID as the all-time best.
// - If it is, the system now correctly UPDATES the last entry in the history array
//   with the chromosome's latest data, including its complete, updated fitnessHistory.
// - This ensures the final downloaded report accurately reflects the full evaluation
//   history of a long-reigning champion design.
// ===================================================================================


let masterConfig = null;
let evolutionEngine = null;
let runId;

// --- Helper Functions ---
const getUniqueId = (() => { let id = 0; return () => id++; })();
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
const clamp = (num, min, max) => Math.min(Math.max(num, min), max);


// --- Main Message Handler ---
self.onmessage = function(e) {
    const { command, payload } = e.data;

    if (command === 'init') {
        masterConfig = payload.config;
        runId = payload.runId;
        if (!evolutionEngine) {
            evolutionEngine = new EvolutionEngine();
            evolutionEngine.initWorkers();
        }
        return;
    }

    if (!evolutionEngine) return;

    switch (command) {
        case 'start':
            evolutionEngine.startEvolution(null, false, payload.fitnessWeights);
            break;
        case 'start_with_seed':
            evolutionEngine.startEvolution(payload.seed, false, payload.fitnessWeights);
            break;
        case 'stop':
            evolutionEngine.stopEvolution();
            break;
        case 'pause':
            evolutionEngine.pauseEvolution();
            break;
        case 'resume':
            evolutionEngine.resumeEvolution(null);
            break;
        case 'load':
            evolutionEngine.loadHistory(payload);
            break;
        case 'get_metareport':
            self.postMessage({ type: 'metareport_data', payload: { report: evolutionEngine.metaHistory } });
            break;
    }
};

// --- S35 GA Settings ---
const POPULATION_SIZE = 400;
const ELITISM_COUNT = 8;
const NUM_SUB_WORKERS = navigator.hardwareConcurrency || 4;
const BREEDING_POOL_SIZE_MAX = 20;
const ELITE_RETEST_LIMIT = 20;
const MIN_FINAL_RAMP_DROP = 100;

const BREEDING_POOL_RATIOS = {
    best: 0.95,
    underdog: 0.025,
    newcomer: 0.025
};

const VALIDATED_SEED_TEMPLATE = {
  "channelWidth": 1000,
  "detectorOffset": -350,
  "boardAngle": 0.3101286806229009,
  "shakeAmplitude": 0.627112260908256,
  "cascadingRamps": [
    {
      "side": "right",
      "y_position": 250,
      "angle": 0.102
    },
    {
      "side": "left",
      "y_position": 650,
      "angle": 0.10222554223131992
    },
    {
      "side": "right",
      "y_position": 800,
      "angle": 0.44185870264492827
    },
    {
      "side": "left",
      "y_position": 1300,
      "angle": 0.6
    },
    {
      "side": "right",
      "y_position": 1884.292691697631
    }
  ],
  "batchSize": 50,
  "numBatches": 1,
  "dropDelayTime": 6574,
  "batchDropDuration": 12987,
  "conveyorDropX": 1537,
  "conveyorDropWidth": 81,
  "detectorHeight": 147,
  "finalRampKneeX_factor": 0.9,
  "finalRampKneeY_factor": 0.45854095283704843
};

const SOLUTION_SPACE_CONFIG = {
    boardAngle: { min: 0.01, max: 0.8 },
    shakeAmplitude: { min: 0.45, max: 0.65 },
    batchSize: { min: 50, max: 150 },
    numBatches: { min: 1, max: 3 },
    dropDelayTime: { min: 500, max: 100000 },
    batchDropDuration: { min: 1000, max: 5000 },
    conveyorDropX: { min: 1200, max: 2000 },
    conveyorDropWidth: { min: 50, max: 300 },
    detectorHeight: { min: 20, max: 150 }, // Max is dynamically constrained
    finalRampKneeX_factor: { min: 0.1, max: 0.9 },
    finalRampKneeY_factor: { min: 0.1, max: 0.9 },
    ramps: [
        { y_pos: { min: 100, max: 600 }, angle: { min: 0.09, max: 0.9 } },
        { y_pos: { min: 400, max: 1400 }, angle: { min: 0.09, max: 0.9 } },
        { y_pos: { min: 1000, max: 1900 }, angle: { min: 0.1, max: 0.9 } },
        { y_pos: { min: 1500, max: 2500 }, angle: { min: 0.1, max: 0.9 } },
        { y_pos: { min: 2100, max: 2700 } }
    ]
};


class EvolutionEngine {
    constructor() {
        this.subWorkers = [];
        this.population = [];
        this.generation = 0;
        this.bestDesignsHistory = [];
        this.metaHistory = [];
        this.isRunning = false;
        this.isPaused = false;
        this.stagnationCounter = 0;
        this.currentMutationRate = 0.1;
        this.workersInitialized = false;
        this.jobQueue = null;
        this.allTimeBest = { fitness: -Infinity, chromosome: { id: null } };
        this.fitnessWeights = null;
        this.generationStartTime = 0;
        this.lastGenerationDuration = 0;
        this.lateToDinnerWorkerCount = 5;
        this.PINCH_POINT_THRESHOLD = masterConfig?.SENSOR_CONFIG?.DETECTOR_WIDTH || 200;
    }

    initWorkers() {
        return new Promise((resolve, reject) => {
            this.workersInitialized = false;
            this.subWorkers.forEach(w => w.terminate());
            this.subWorkers = [];
            let workersReadyCount = 0;

            const onWorkerReady = (workerId) => this.runPositiveControlTest(this.subWorkers.find(w => w.id === workerId));
            const onPositiveControlSuccess = (workerId) => {
                const worker = this.subWorkers.find(w => w.id === workerId);
                if (worker) worker.isReady = true;
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
                reject(new Error(`Sub-worker ${id} failed Positive Control Test.`));
            };

            for (let i = 0; i < NUM_SUB_WORKERS; i++) {
                const worker = new Worker(`./sub_worker_S35.js?run=${runId}`);
                worker.id = i;
                worker.isReady = false;
                worker.onmessage = (e) => {
                    const {type, payload} = e.data;
                    if (type === 'worker_ready') onWorkerReady(payload.id);
                    else if (type === 'positive_control_success') onPositiveControlSuccess(payload.id);
                    else if (type === 'positive_control_failure') onPositiveControlFailure(payload);
                    else if (type === 'test_result') this.processWorkerResult(e);
                };
                worker.onerror = (e) => {
                    console.error(`[GA-Worker] CRITICAL ERROR in sub_worker ${i}:`, e);
                    this.stopEvolution();
                };
                this.subWorkers.push(worker);
                worker.postMessage({ command: 'init', payload: { id: i, config: masterConfig } });
            }
        });
    }

    runPositiveControlTest(worker) {
        if (!worker || worker.isReady) return;
        const nullChromosome = { id: -1, channelWidth: 1000, detectorOffset: -350, conveyorDropX: 1625, conveyorDropWidth: 150, boardAngle: 0.2, cascadingRamps: [], detectorHeight: 50, finalRampKneeX_factor: 0.6, finalRampKneeY_factor: 0.4 };
        worker.postMessage({ command: 'run_positive_control', payload: { chromosome: nullChromosome } });
    }

    async startEvolution(seed = null, isDirected = false, fitnessWeights) {
        if (this.isRunning) return;
        if (!this.workersInitialized) await this.initWorkers();
        
        this.isRunning = true;
        this.isPaused = false;
        this.generation = 0;
        this.bestDesignsHistory = [];
        this.metaHistory = [];
        this.allTimeBest = { fitness: -Infinity, chromosome: { id: null } };
        this.fitnessWeights = fitnessWeights;
        
        this.createInitialPopulation(seed);
        this.runGeneration();
    }

    async runGeneration() {
        if (!this.isRunning) return;
        this.generationStartTime = performance.now();
        
        const individualsToEvaluate = this.population.filter(c => 
            c && !c.fullResult && (!c.fitnessHistory || c.fitnessHistory.length < ELITE_RETEST_LIMIT)
        );

        if (individualsToEvaluate.length > 0) {
            const requiredResults = individualsToEvaluate.length;
            const mainJobs = individualsToEvaluate.map(c => ({ c }));
            
            const lateToDinnerJobs = [];
            for (let i = 0; i < this.lateToDinnerWorkerCount; i++) {
                const randomJob = mainJobs[Math.floor(Math.random() * mainJobs.length)];
                lateToDinnerJobs.push({ ...randomJob });
            }

            const allJobs = [...mainJobs, ...lateToDinnerJobs];
            allJobs.sort(() => Math.random() - 0.5);

            await new Promise((resolve, reject) => {
                this.jobQueue = {
                    queue: allJobs,
                    resultsReceived: 0,
                    requiredResults: requiredResults,
                    isResolved: false,
                    resolve,
                    reject
                };
                this.subWorkers.forEach(worker => {
                    if (worker.isReady && this.jobQueue.queue.length > 0) {
                        this.dispatchJob(this.jobQueue.queue.shift(), worker);
                    }
                });
            }).catch(err => {
                if (err !== 'STOP' && err !== 'PAUSE') console.error("Job queue error:", err);
            });
        }
        
        if (!this.isRunning) return;

        this.lastGenerationDuration = performance.now() - this.generationStartTime;

        this.population.forEach(p => {
            if (p && p.fullResult) {
                if (!p.fitnessHistory) p.fitnessHistory = [];
                p.fitnessHistory.push(p.fullResult.finalScore);
            }
            if (p && p.fitnessHistory && p.fitnessHistory.length > 0) {
                p.fitness = p.fitnessHistory.reduce((a, b) => a + b, 0) / p.fitnessHistory.length;
            }
        });

        this.population = this.population.filter(p => p && p.fitness !== undefined);
        this.population.sort((a, b) => (b.fitness || -Infinity) - (a.fitness || -Infinity));
        
        // ========================================================================
        // == S9.7 FIX: Correct Fitness History Tracking                         ==
        // ========================================================================
        const bestOfGen = this.population[0];
        if (bestOfGen) {
            // CASE 1: A new, better chromosome has become the all-time best.
            if (bestOfGen.fitness > this.allTimeBest.fitness) {
                this.allTimeBest = { 
                    fitness: bestOfGen.fitness, 
                    result: bestOfGen.fullResult, 
                    chromosome: JSON.parse(JSON.stringify(bestOfGen)) 
                };
                this.bestDesignsHistory.push(JSON.parse(JSON.stringify(this.allTimeBest.chromosome)));
                this.stagnationCounter = 0;
            } 
            // CASE 2 (THE FIX): The same champion was re-evaluated.
            else if (bestOfGen.id === this.allTimeBest.chromosome.id) {
                this.allTimeBest = { 
                    fitness: bestOfGen.fitness, 
                    result: bestOfGen.fullResult, 
                    chromosome: JSON.parse(JSON.stringify(bestOfGen)) 
                };
                // Crucially, UPDATE the LAST entry in the history array with this new data.
                if (this.bestDesignsHistory.length > 0) {
                    this.bestDesignsHistory[this.bestDesignsHistory.length - 1] = JSON.parse(JSON.stringify(this.allTimeBest.chromosome));
                }
                this.stagnationCounter++; // Still counts as stagnation, as no NEW design emerged.
            }
            // CASE 3: A different, worse chromosome is at the top this generation.
            else {
                this.stagnationCounter++;
            }
        }
        // ========================================================================

        this.adaptHyperparameters();
        this.generateMetareport();
        
        self.postMessage({
            type: 'update',
            payload: { generation: this.generation, bestIndividual: this.allTimeBest.chromosome, bestResult: this.allTimeBest.result, mutationRate: this.currentMutationRate, history: this.bestDesignsHistory }
        });

        this.createNewGeneration();
        this.generation++;
        if (this.isRunning) setTimeout(() => this.runGeneration(), 0);
    }
    
    dispatchJob(job, worker) {
        worker.postMessage({ command: 'run_test', payload: { chromosome: job.c, id: job.c.id, fitnessWeights: this.fitnessWeights } });
    }

    processWorkerResult(e) {
        if (!this.jobQueue || this.jobQueue.isResolved) {
            return;
        }

        const { result, id } = e.data.payload;
        const individual = this.population.find(p => p && p.id === id);

        if (result && individual && !individual.fullResult) {
            individual.fullResult = result;
            this.jobQueue.resultsReceived++;
        }

        self.postMessage({ type: 'progress_update', payload: { completed: this.jobQueue.resultsReceived, total: this.jobQueue.requiredResults } });

        const worker = e.target;
        if (this.jobQueue.queue.length > 0) {
            this.dispatchJob(this.jobQueue.queue.shift(), worker);
        }

        if (this.jobQueue.resultsReceived >= this.jobQueue.requiredResults) {
            this.jobQueue.isResolved = true;
            this.jobQueue.resolve();
        }
    }
    
    getRampTipPosition(ramp, channelWidth) {
        const rampLength = channelWidth * 0.85;
        const attachY = ramp.y_position;
        const effectiveAngle = ramp.angle;

        const channelCenterX = masterConfig.SIM_CONFIG.MACHINE_WIDTH / 2;
        const wallThickness = masterConfig.SIM_CONFIG.WALL_THICKNESS;
        
        let attachX;
        if (ramp.side === 'left') {
            const leftWallX = channelCenterX - (channelWidth / 2);
            attachX = leftWallX + (wallThickness / 2);
        } else {
            const rightWallX = channelCenterX + (channelWidth / 2);
            attachX = rightWallX - (wallThickness / 2);
        }
        
        const tipOffsetX = (ramp.side === 'left' ? 1 : -1) * rampLength * Math.cos(effectiveAngle);
        const tipOffsetY = rampLength * Math.sin(effectiveAngle);

        return { x: attachX + tipOffsetX, y: attachY + tipOffsetY };
    }

    getYOnRampAtX(ramp, xPos, channelWidth) {
        const attachY = ramp.y_position;
        const effectiveAngle = ramp.angle;
        
        const channelCenterX = masterConfig.SIM_CONFIG.MACHINE_WIDTH / 2;
        const wallThickness = masterConfig.SIM_CONFIG.WALL_THICKNESS;

        let attachX;
        if (ramp.side === 'left') {
            const leftWallX = channelCenterX - (channelWidth / 2);
            attachX = leftWallX + (wallThickness / 2);
        } else {
            const rightWallX = channelCenterX + (channelWidth / 2);
            attachX = rightWallX - (wallThickness / 2);
        }

        const slope = (ramp.side === 'left' ? 1 : -1) * Math.tan(effectiveAngle);
        return slope * (xPos - attachX) + attachY;
    }

    validateAndCorrectPinchPoints(chromosome) {
        for (let i = 0; i < chromosome.cascadingRamps.length - 1; i++) {
            const upperRamp = chromosome.cascadingRamps[i];
            const lowerRamp = chromosome.cascadingRamps[i + 1];

            const upperTipPos = this.getRampTipPosition(upperRamp, chromosome.channelWidth);
            const yOnLowerRamp = this.getYOnRampAtX(lowerRamp, upperTipPos.x, chromosome.channelWidth);
            const verticalClearance = yOnLowerRamp - upperTipPos.y;

            if (verticalClearance < this.PINCH_POINT_THRESHOLD) {
                const requiredCorrection = this.PINCH_POINT_THRESHOLD - verticalClearance;
                const targetY = lowerRamp.y_position + requiredCorrection;
                
                const rampConfig = SOLUTION_SPACE_CONFIG.ramps[i + 1];
                if (rampConfig) {
                    if (targetY <= rampConfig.y_pos.max) {
                        lowerRamp.y_position = targetY;
                    } else {
                        lowerRamp.y_position = rampConfig.y_pos.max;
                    }
                }
            }
        }
        return chromosome;
    }
    
    createInitialPopulation(seed = null) {
        this.population = [];
        if (seed) {
            const eliteSeed = JSON.parse(JSON.stringify(seed));
            eliteSeed.id = getUniqueId();
            this.population.push(eliteSeed);
        }
        while (this.population.length < POPULATION_SIZE) {
            this.population.push(this.createRandomChromosome());
        }
    }

    createNewGeneration() {
        const newPopulation = [];
        for (let i = 0; i < ELITISM_COUNT; i++) {
            if (this.population[i]) {
                const newElite = JSON.parse(JSON.stringify(this.population[i]));
                delete newElite.fullResult;
                delete newElite.fitness;
                newPopulation.push(newElite);
            }
        }
        
        const breedingPoolSize = Math.min(this.population.length, BREEDING_POOL_SIZE_MAX);
        const breedingPopulation = this.population.slice(0, breedingPoolSize);

        const breedingPool = [];
        const bestCount = Math.floor(breedingPopulation.length * BREEDING_POOL_RATIOS.best);
        const underdogCount = Math.floor(breedingPopulation.length * BREEDING_POOL_RATIOS.underdog);

        for (let i = 0; i < bestCount; i++) {
            breedingPool.push(breedingPopulation[i]);
        }
        const bottomHalfStartIndex = Math.floor(breedingPopulation.length / 2);
        for (let i = 0; i < underdogCount; i++) {
            if (bottomHalfStartIndex < breedingPopulation.length) {
                const underdogIndex = randInt(bottomHalfStartIndex, breedingPopulation.length - 1);
                breedingPool.push(breedingPopulation[underdogIndex]);
            }
        }

        if (breedingPool.length === 0 && breedingPopulation.length > 0) {
            breedingPool.push(breedingPopulation[0]);
        }

        while (newPopulation.length < POPULATION_SIZE) {
            let child;
            if (Math.random() < BREEDING_POOL_RATIOS.newcomer) {
                child = this.createRandomChromosome();
            } else {
                const parentA = breedingPool[randInt(0, breedingPool.length - 1)];
                const parentB = breedingPool[randInt(0, breedingPool.length - 1)];
                child = this.crossover(parentA, parentB);
                this.mutate(child);
            }
            newPopulation.push(child);
        }
        this.population = newPopulation;
    }

    createRandomChromosome() {
        const c = JSON.parse(JSON.stringify(VALIDATED_SEED_TEMPLATE));
        c.id = getUniqueId();
        
        const cfg = SOLUTION_SPACE_CONFIG;
        c.boardAngle = rand(cfg.boardAngle.min, cfg.boardAngle.max);
        c.shakeAmplitude = rand(cfg.shakeAmplitude.min, cfg.shakeAmplitude.max);
        c.batchSize = randInt(cfg.batchSize.min, cfg.batchSize.max);
        c.numBatches = randInt(cfg.numBatches.min, cfg.numBatches.max);
        c.dropDelayTime = randInt(cfg.dropDelayTime.min, cfg.dropDelayTime.max);
        c.batchDropDuration = randInt(cfg.batchDropDuration.min, cfg.batchDropDuration.max);
        c.conveyorDropX = randInt(cfg.conveyorDropX.min, cfg.conveyorDropX.max);
        c.conveyorDropWidth = randInt(cfg.conveyorDropWidth.min, cfg.conveyorDropWidth.max);

        c.cascadingRamps.forEach((ramp, i) => {
            const rampConfig = cfg.ramps[i];
            if (i < c.cascadingRamps.length - 1) {
                ramp.y_position = rand(rampConfig.y_pos.min, rampConfig.y_pos.max);
                 if (rampConfig.angle) {
                    ramp.angle = rand(rampConfig.angle.min, rampConfig.angle.max);
                }
            }
        });
        
        c.detectorHeight = randInt(cfg.detectorHeight.min, cfg.detectorHeight.max);
        const detectorY = masterConfig.SIM_CONFIG.MACHINE_HEIGHT - c.detectorHeight;

        const lastRampConfig = cfg.ramps[cfg.ramps.length - 1];
        const lastRampMaxY = detectorY - MIN_FINAL_RAMP_DROP;
        const lastRampMinY = lastRampConfig.y_pos.min;
        
        c.cascadingRamps[c.cascadingRamps.length - 1].y_position = rand(lastRampMinY, lastRampMaxY);

        c.finalRampKneeY_factor = rand(cfg.finalRampKneeY_factor.min, cfg.finalRampKneeY_factor.max);
        c.finalRampKneeX_factor = rand(c.finalRampKneeY_factor, cfg.finalRampKneeX_factor.max);

        return this.validateAndCorrectPinchPoints(c);
    }

    crossover(parentA, parentB) {
        const child = JSON.parse(JSON.stringify(VALIDATED_SEED_TEMPLATE));
        child.id = getUniqueId();

        child.boardAngle = Math.random() < 0.5 ? parentA.boardAngle : parentB.boardAngle;
        child.shakeAmplitude = Math.random() < 0.5 ? parentA.shakeAmplitude : parentB.shakeAmplitude;
        child.batchSize = Math.random() < 0.5 ? parentA.batchSize : parentB.batchSize;
        child.numBatches = Math.random() < 0.5 ? parentA.numBatches : parentB.numBatches;
        child.dropDelayTime = Math.random() < 0.5 ? parentA.dropDelayTime : parentB.dropDelayTime;
        child.batchDropDuration = Math.random() < 0.5 ? parentA.batchDropDuration : parentB.batchDropDuration;
        child.conveyorDropX = Math.random() < 0.5 ? parentA.conveyorDropX : parentB.conveyorDropX;
        child.conveyorDropWidth = Math.random() < 0.5 ? parentA.conveyorDropWidth : parentB.conveyorDropWidth;
        child.detectorHeight = Math.random() < 0.5 ? parentA.detectorHeight : parentB.detectorHeight;
        child.finalRampKneeX_factor = Math.random() < 0.5 ? parentA.finalRampKneeX_factor : parentB.finalRampKneeX_factor;
        child.finalRampKneeY_factor = Math.random() < 0.5 ? parentA.finalRampKneeY_factor : parentB.finalRampKneeY_factor;
        
        for (let i = 0; i < child.cascadingRamps.length; i++) {
            child.cascadingRamps[i].y_position = Math.random() < 0.5 ? parentA.cascadingRamps[i].y_position : parentB.cascadingRamps[i].y_position;
            if (child.cascadingRamps[i].angle !== undefined) {
                const inheritedAngle = Math.random() < 0.5 ? parentA.cascadingRamps[i].angle : parentB.cascadingRamps[i].angle;
                child.cascadingRamps[i].angle = Math.abs(inheritedAngle);
            }
        }

        const lastRampIndex = child.cascadingRamps.length - 1;
        const lastRamp = child.cascadingRamps[lastRampIndex];
        const lastRampConfig = SOLUTION_SPACE_CONFIG.ramps[lastRampIndex];

        const detectorY = masterConfig.SIM_CONFIG.MACHINE_HEIGHT - child.detectorHeight;
        const maxRampY = detectorY - MIN_FINAL_RAMP_DROP;

        if (lastRamp.y_position >= maxRampY) {
            lastRamp.y_position = maxRampY;
        }
        lastRamp.y_position = Math.max(lastRamp.y_position, lastRampConfig.y_pos.min);
        
        if (child.finalRampKneeX_factor < child.finalRampKneeY_factor) {
            [child.finalRampKneeX_factor, child.finalRampKneeY_factor] = [child.finalRampKneeY_factor, child.finalRampKneeX_factor];
        }

        return this.validateAndCorrectPinchPoints(child);
    }

    mutate(chromosome) {
        const cfg = SOLUTION_SPACE_CONFIG;
        const rate = this.currentMutationRate;

        if (Math.random() < rate) chromosome.boardAngle = clamp(chromosome.boardAngle + randn_bm(-0.05, 0.05), cfg.boardAngle.min, cfg.boardAngle.max);
        if (Math.random() < rate) chromosome.shakeAmplitude = clamp(chromosome.shakeAmplitude + randn_bm(-0.05, 0.05), cfg.shakeAmplitude.min, cfg.shakeAmplitude.max);
        if (Math.random() < rate) chromosome.batchSize = clamp(Math.round(chromosome.batchSize + randn_bm(-20, 20)), cfg.batchSize.min, cfg.batchSize.max);
        if (Math.random() < rate) chromosome.numBatches = clamp(Math.round(chromosome.numBatches + randn_bm(-1, 1)), cfg.numBatches.min, cfg.numBatches.max);
        if (Math.random() < rate) chromosome.dropDelayTime = clamp(Math.round(chromosome.dropDelayTime + randn_bm(-500, 500)), cfg.dropDelayTime.min, cfg.dropDelayTime.max);
        if (Math.random() < rate) chromosome.batchDropDuration = clamp(Math.round(chromosome.batchDropDuration + randn_bm(-300, 300)), cfg.batchDropDuration.min, cfg.batchDropDuration.max);
        if (Math.random() < rate) chromosome.conveyorDropX = clamp(Math.round(chromosome.conveyorDropX + randn_bm(-50, 50)), cfg.conveyorDropX.min, cfg.conveyorDropX.max);
        if (Math.random() < rate) chromosome.conveyorDropWidth = clamp(Math.round(chromosome.conveyorDropWidth + randn_bm(-20, 20)), cfg.conveyorDropWidth.min, cfg.conveyorDropWidth.max);
        if (Math.random() < rate) chromosome.finalRampKneeX_factor = clamp(chromosome.finalRampKneeX_factor + randn_bm(-0.1, 0.1), cfg.finalRampKneeX_factor.min, cfg.finalRampKneeX_factor.max);
        if (Math.random() < rate) chromosome.finalRampKneeY_factor = clamp(chromosome.finalRampKneeY_factor + randn_bm(-0.1, 0.1), cfg.finalRampKneeY_factor.min, cfg.finalRampKneeY_factor.max);

        const lastRampIndex = chromosome.cascadingRamps.length - 1;
        
        if (Math.random() < rate) {
            const lastRampY = chromosome.cascadingRamps[lastRampIndex].y_position;
            const maxDetectorHeight = masterConfig.SIM_CONFIG.MACHINE_HEIGHT - (lastRampY + MIN_FINAL_RAMP_DROP);
            const dynamicMax = Math.min(cfg.detectorHeight.max, maxDetectorHeight);
            chromosome.detectorHeight = clamp(Math.round(chromosome.detectorHeight + randn_bm(-10, 10)), cfg.detectorHeight.min, dynamicMax);
        }

        chromosome.cascadingRamps.forEach((ramp, i) => {
            const rampConfig = cfg.ramps[i];
            if (i === lastRampIndex) {
                 if (Math.random() < rate) {
                    const detectorY = masterConfig.SIM_CONFIG.MACHINE_HEIGHT - chromosome.detectorHeight;
                    const maxRampY = detectorY - MIN_FINAL_RAMP_DROP;
                    const dynamicMax = Math.min(rampConfig.y_pos.max, maxRampY);
                    ramp.y_position = clamp(ramp.y_position + randn_bm(-25, 25), rampConfig.y_pos.min, dynamicMax);
                 }
            } else {
                if (Math.random() < rate) {
                    ramp.y_position = clamp(ramp.y_position + randn_bm(-25, 25), rampConfig.y_pos.min, rampConfig.y_pos.max);
                }
                if (rampConfig.angle && Math.random() < rate) {
                    const mutatedAngle = ramp.angle + randn_bm(-0.05, 0.05);
                    ramp.angle = clamp(Math.abs(mutatedAngle), rampConfig.angle.min, rampConfig.angle.max);
                }
            }
        });
        
        if (chromosome.finalRampKneeX_factor < chromosome.finalRampKneeY_factor) {
            [chromosome.finalRampKneeX_factor, chromosome.finalRampKneeY_factor] = [chromosome.finalRampKneeY_factor, chromosome.finalRampKneeX_factor];
        }
        
        return this.validateAndCorrectPinchPoints(chromosome);
    }
    
    adaptHyperparameters() {
        if (this.stagnationCounter > 10) this.currentMutationRate = Math.min(0.25, this.currentMutationRate * 1.5);
        else this.currentMutationRate = Math.max(0.1, this.currentMutationRate * 0.98);
    }
    
    generateMetareport() {
        if (!this.population || this.population.length === 0) return;

        const bestOfGen = this.population[0];
        if (!bestOfGen) return;

        const fitnessScores = this.population.map(p => p.fitness).filter(f => f !== undefined);
        const meanFitness = fitnessScores.length > 0 ? fitnessScores.reduce((a, b) => a + b, 0) / fitnessScores.length : 0;
        const stdDev = fitnessScores.length > 0 ? Math.sqrt(fitnessScores.map(x => Math.pow(x - meanFitness, 2)).reduce((a, b) => a + b) / fitnessScores.length) : 0;
        
        const top10PercentIndex = Math.floor(fitnessScores.length * 0.1);
        const top10Scores = this.population.slice(0, top10PercentIndex).map(p => p.fitness);
        const top10PercentMeanFitness = top10Scores.length > 0 ? top10Scores.reduce((a, b) => a + b, 0) / top10Scores.length : 0;

        const exitReasonCounts = this.population.reduce((acc, p) => {
            if (p.fullResult) {
                const reason = p.fullResult.exitReason || "Unknown";
                acc[reason] = (acc[reason] || 0) + 1;
            }
            return acc;
        }, {});

        const report = {
            generation: this.generation,
            generationDuration: this.lastGenerationDuration,
            mutationRate: this.currentMutationRate,
            allTimeBestChromosomeId: this.allTimeBest.chromosome.id,
            bestFitness: bestOfGen.fitness,
            meanFitness: meanFitness,
            top10PercentMeanFitness: top10PercentMeanFitness,
            stdDev: stdDev,
            exitReasonCounts: exitReasonCounts,
            bestOfGenResult: bestOfGen.fullResult,
        };
        this.metaHistory.push(report);
    }
    
    stopEvolution() {
        this.isRunning = false;
        this.isPaused = false;
        if(this.jobQueue) this.jobQueue.reject('STOP');
        this.subWorkers.forEach(w => w.terminate());
        this.workersInitialized = false;
        self.postMessage({ type: 'stopped', payload: { history: this.bestDesignsHistory } });
    }

    pauseEvolution() {
        if (!this.isRunning) return;
        this.isRunning = false; this.isPaused = true;
        if(this.jobQueue) this.jobQueue.reject('PAUSE');
        self.postMessage({ type: 'paused' });
    }

    resumeEvolution() {
        if (!this.isPaused) return;
        this.isRunning = true; this.isPaused = false;
        this.runGeneration();
    }

    loadHistory(history) {
        this.stopEvolution();
        this.bestDesignsHistory = history;
        this.generation = history.length;
        const bestDesign = history[history.length - 1];
        self.postMessage({ type: 'loaded', payload: { generation: this.generation, bestIndividual: bestDesign } });
    }
}
