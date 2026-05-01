// validator_worker_S34.js - Manages a validation run of a single design.
let runId;
let CONFIG = {};
const VALIDATION_RUNS = 80;
const NUM_SUB_WORKERS = navigator.hardwareConcurrency || 4;

let subWorkers = [];
let jobQueue = [];
let results = [];
let jobsCompleted = 0;
let fitnessWeights;

self.onmessage = function(e) {
    const { command, payload } = e.data;

    if (command === 'init') {
        runId = payload.runId;
        CONFIG = payload.config;
        initializeSubWorkers();
    } else if (command === 'start_validation') {
        fitnessWeights = payload.fitnessWeights;
        startValidation(payload.seed);
    }
};

function initializeSubWorkers() {
    self.postMessage({ type: 'status', payload: `[Validator] Initializing ${NUM_SUB_WORKERS} workers...` });
    let workersReadyCount = 0;

    for (let i = 0; i < NUM_SUB_WORKERS; i++) {
        const subWorkerUrl = `validator_sub_worker_S34.js?run=${runId}`;
        const worker = new Worker(subWorkerUrl);
        worker.id = i;
        
        worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === 'worker_ready') {
                workersReadyCount++;
                if (workersReadyCount === NUM_SUB_WORKERS) {
                    // All sub-workers are ready, so the main worker is ready.
                    self.postMessage({ type: 'ready_for_validation' });
                }
            } else {
                handleJobResult(e);
            }
        };

        worker.onerror = (e) => {
             console.error(`[Validator-Worker] Sub-worker ${i} crashed:`, e);
             self.postMessage({ type: 'error', payload: `Worker ${i} crashed: ${e.message}` });
        };
        subWorkers.push(worker);
        worker.postMessage({ command: 'init', payload: { id: i, runId: runId, config: CONFIG } });
    }
}

function startValidation(seedChromosome) {
    jobQueue = [];
    results = [];
    jobsCompleted = 0;

    for (let i = 0; i < VALIDATION_RUNS; i++) {
        jobQueue.push({ chromosome: seedChromosome, id: i });
    }
    dispatchJobs();
}

function dispatchJobs() {
    subWorkers.forEach(worker => {
        if (jobQueue.length > 0) {
            const job = jobQueue.shift();
            worker.postMessage({ command: 'run_test', payload: { ...job, fitnessWeights } });
        }
    });
}

function handleJobResult(e) {
    const { type, payload } = e.data;
    if (type !== 'test_result') return;

    results[payload.id] = payload.result;
    jobsCompleted++;
    
    self.postMessage({ type: 'progress', payload: { completed: jobsCompleted, total: VALIDATION_RUNS, lastResult: payload.result } });

    if (jobQueue.length > 0) {
        // Find the worker that just finished by its original message's payload.id
        const worker = subWorkers.find(w => w.id === payload.workerId); // Assuming sub_worker sends its ID back
        if (worker) {
            const newJob = jobQueue.shift();
            worker.postMessage({ command: 'run_test', payload: { ...newJob, fitnessWeights } });
        }
    }

    if (jobsCompleted === VALIDATION_RUNS) {
        generateAndSendReport();
    }
}

function generateAndSendReport() {
    self.postMessage({ type: 'status', payload: `[Validator] All runs complete. Generating report.` });
    const statistics = {};
    const keysToAnalyze = [
        'finalScore', 'throughputScore', 'jamPenalty', 'simultaneousPenalty', 
        'consistencyRewardRatio', 'symmetryRewardRatio', 'normalizedIQR',
        'rejectCount', 'lowCount', 'highCount', 'jamCount', 'simTime'
    ];
    
    keysToAnalyze.forEach(key => {
        const values = results.map(r => r ? r[key] : 0).filter(v => typeof v === 'number' && isFinite(v));
        if (values.length > 0) {
            const sum = values.reduce((a, b) => a + b, 0);
            const mean = sum / values.length;
            const stdDev = Math.sqrt(values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / values.length);
            statistics[key] = { mean, stdDev, sum };
        } else {
            statistics[key] = { mean: 0, stdDev: 0, sum: 0 };
        }
    });

    const allWarnings = results.flatMap(r => r && r.warnings ? r.warnings : []);
    statistics.warningCounts = allWarnings.reduce((acc, warning) => {
        acc[warning] = (acc[warning] || 0) + 1;
        return acc;
    }, {});

    self.postMessage({
        type: 'validation_complete',
        payload: { statistics: statistics, results: results }
    });
}
