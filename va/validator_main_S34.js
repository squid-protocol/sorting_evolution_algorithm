// validator_main_S34.js - The Conductor for the S34 Validator.
import * as configModule from './simulation_config.js';
import { Visualizer } from './validator_simulation_viz_S34.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- UI Element References ---
    const validateButton = document.getElementById('validateButton');
    const seedFileInput = document.getElementById('seedFileInput');
    const replayButton = document.getElementById('replayButton');
    const snapshotButton = document.getElementById('snapshotButton');
    const saveDesignButton = document.getElementById('saveDesignButton');
    const runCountSpan = document.getElementById('runCount');
    const totalRunsSpan = document.getElementById('totalRuns');
    const gaStatusTextSpan = document.getElementById('gaStatusText');
    const visualizer = new Visualizer(document.getElementById('simulation-container'), configModule);
    
    let gaWorker;
    let currentSeedChromosome = null;
    let lastReplayData = null;
    let isWorkerReady = false; // New flag to track worker status

    function initializeWorker() {
        if (gaWorker) gaWorker.terminate();
        const runId = new Date().getTime();
        const workerUrl = `validator_worker_S34.js?run=${runId}`;
        gaWorker = new Worker(workerUrl);

        gaWorker.onmessage = handleWorkerMessage;
        gaWorker.onerror = (e) => {
            gaStatusTextSpan.textContent = `CRITICAL WORKER ERROR: ${e.message}`;
            console.error(`[Main-Validator] Received error from GA worker:`, e);
            validateButton.disabled = false;
        };
        
        const configPayload = {
            ENGINE_CONFIG: configModule.ENGINE_CONFIG,
            TIME_STEP: configModule.TIME_STEP,
            PIECE_PHYSICS_PROPERTIES: configModule.PIECE_PHYSICS_PROPERTIES,
            PIECE_LIBRARY: configModule.PIECE_LIBRARY,
            SIM_CONFIG: configModule.SIM_CONFIG,
            SENSOR_CONFIG: configModule.SENSOR_CONFIG,
            MAX_SIM_TIME: configModule.MAX_SIM_TIME,
        };

        gaWorker.postMessage({ command: 'init', payload: { runId: runId, config: configPayload } });
    }
    
    initializeWorker();

    function handleWorkerMessage(e) {
        const { type, payload } = e.data;
        switch(type) {
            // New case to handle the worker's ready signal
            case 'ready_for_validation':
                isWorkerReady = true;
                gaStatusTextSpan.textContent = 'Ready. Load a design to validate.';
                break;
            case 'progress':
                runCountSpan.textContent = `${payload.completed}`;
                totalRunsSpan.textContent = `${payload.total}`;
                updateDetailedUI(payload.lastResult);
                break;
            case 'validation_complete':
                gaStatusTextSpan.textContent = 'Validation Complete! Generating report...';
                generateAndOpenReport(payload);
                validateButton.disabled = false;
                break;
            case 'status':
                 gaStatusTextSpan.textContent = payload;
                 break;
            case 'replay_data':
                lastReplayData = payload;
                replayButton.disabled = false;
                snapshotButton.disabled = false;
                break;
            case 'error':
                gaStatusTextSpan.textContent = `Worker Error: ${payload}`;
                validateButton.disabled = false;
                break;
        }
    }
    
    function generateAndOpenReport(reportData) { /* ... same as before ... */ }
    function downloadJSON(data, filename) { /* ... same as before ... */ }

    validateButton.addEventListener('click', () => seedFileInput.click());
    replayButton.addEventListener('click', () => { /* ... replay logic ... */ });
    snapshotButton.addEventListener('click', async () => { /* ... snapshot logic ... */ });
    saveDesignButton.addEventListener('click', () => { /* ... save logic ... */ });

    seedFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const loadedJSON = JSON.parse(ev.target.result);

                if (Array.isArray(loadedJSON) && loadedJSON.length > 0) {
                    currentSeedChromosome = loadedJSON[loadedJSON.length - 1];
                } else if (typeof loadedJSON === 'object' && loadedJSON.funnel_profile) {
                    currentSeedChromosome = loadedJSON;
                } else {
                     throw new Error("Invalid file. Must be a valid S34 chromosome object or a history array.");
                }
                
                lastReplayData = null;
                replayButton.disabled = true;
                snapshotButton.disabled = true;
                saveDesignButton.disabled = false;
                gaStatusTextSpan.textContent = 'Initializing Validation...';
                validateButton.disabled = true;
                
                visualizer.drawStaticBoard(currentSeedChromosome);
                updateUIDisplayWithChromosome(currentSeedChromosome);

                // Wait for the worker to be ready before sending the start command
                const startValidationWhenReady = () => {
                    if (isWorkerReady) {
                        const fitnessWeights = {
                            W_TP_EXP: 300000, W_TP_LIN: 5000, W_TC: 50,
                            W_CON_EXP: 300000, W_CON_LIN: 2000,
                            W_SYM_EXP: 2000, W_SYM_LIN: 500,
                            W_J: 5, W_S: 500, W_IQR: 10,
                            W_ZONE_REJECT: 15.0, W_ZONE_LOW: 0.0, W_ZONE_HIGH: 2.0, W_ZONE_JAM: 5.0
                        };
                        gaWorker.postMessage({
                            command: 'start_validation',
                            payload: { seed: currentSeedChromosome, fitnessWeights }
                        });
                    } else {
                        // If worker isn't ready, check again shortly
                        setTimeout(startValidationWhenReady, 100);
                    }
                };
                startValidationWhenReady();

            } catch (error) {
                gaStatusTextSpan.textContent = `Error: ${error.message}`;
                validateButton.disabled = false;
            }
        };
        reader.readAsText(file);
        seedFileInput.value = '';
    });

    function updateDetailedUI(data) { /* ... UI update logic ... */ }
    function updateUIDisplayWithChromosome(chromo) { /* ... UI update logic ... */ }
});
