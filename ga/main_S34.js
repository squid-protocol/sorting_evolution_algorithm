// main_S34.js (Melded S33 & S34)
// This file orchestrates the UI and worker communication. It combines the
// S34 ES Module architecture and new UI controls with the comprehensive
// message handling and UI update logic from S33.
// S33 HEURISTICS ADDED: Flexible Seed Loading.
// DECOUPLED PIPELINE MODIFICATION: This script now handles the new data workflow.
// It receives per-generation data from the worker, accumulates it in chunks,
// and provides a "Download Log & Clear" function to manage memory.
// RIVER OF FLOW VISUALIZATION:
// - `updateDetailedUI` now passes the `bestResult` to the visualizer so it can
//   draw the functional annotations (drop zone, flow path).
// TRAVERSAL TIME UI: Added UI elements and logic to display the new traversal
// time metrics from the functional annotation simulation.

import * as configModule from '../simulation_config.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- Global State & UI References ---
    let gaWorker;
    let visualizer;
    let clumpChart = null;
    let timingChart = null;
    let evolutionHistory = [];
    const runId = new Date().getTime();

    let surveyDataChunks = [];

    // --- UI Element References (MODIFIED) ---
    const startButton = document.getElementById('startGAButton');
    const stopButton = document.getElementById('stopGAButton');
    const startWithSeedButton = document.getElementById('startWithSeedButton');
    const downloadHistoryButton = document.getElementById('downloadHistoryButton');
    const loadHistoryButton = document.getElementById('loadHistoryButton');
    const downloadMetaReportButton = document.getElementById('downloadMetaReportButton');
    const historyFileInput = document.getElementById('historyFileInput');
    const seedFileInput = document.getElementById('seedFileInput');
    const resumeDirectivesButton = document.getElementById('resumeDirectivesButton');
    const downloadLogAndClearButton = document.getElementById('downloadLogAndClearButton');
    const surveyChunkCountSpan = document.getElementById('surveyChunkCount');
    const directivesFileInput = document.getElementById('directivesFileInput');
    const screenshotButton = document.getElementById('screenshotButton');
    const runCountSpan = document.getElementById('runCount');
    const generationCountSpan = document.getElementById('generationCount');
    const bestFitnessSpan = document.getElementById('bestFitness');
    const mutationRateSpan = document.getElementById('mutationRate');
    const gaStatusTextSpan = document.getElementById('gaStatusText');
    const directiveNameSpan = document.getElementById('directiveName');
    const clumpHistogramCanvas = document.getElementById('clumpHistogram');
    const timingHistogramCanvas = document.getElementById('timingHistogram');
    const throughputScoreSpan = document.getElementById('throughputScore');
    const jamPenaltySpan = document.getElementById('jamPenalty');
    const simultaneousPenaltySpan = document.getElementById('simultaneousPenalty');
    const intervalZonePenaltySpan = document.getElementById('intervalZonePenalty');
    const physicsViolationCountSpan = document.getElementById('physicsViolationCount');
    const consistencyRewardRatioSpan = document.getElementById('consistencyRewardRatio');
    const iqrPenaltyRatioSpan = document.getElementById('iqrPenaltyRatio');
    const symmetryScoreSpan = document.getElementById('symmetryScore');
    const activePegFieldsSpan = document.getElementById('activePegFieldsSpan');
    const activeComplexRampsSpan = document.getElementById('activeComplexRamps');
    const probeTraverseTimeSpan = document.getElementById('probeTraverseTime');
    const sacrificialPieceTimeSpan = document.getElementById('sacrificialPieceTime');
    const paramBoardAngleSpan = document.getElementById('paramBoardAngle');
    const paramDetectorOffsetSpan = document.getElementById('paramDetectorOffset');
    const paramFreeFallTimeSpan = document.getElementById('paramFreeFallTime');
    const paramConveyorDropXSpan = document.getElementById('paramConveyorDropX');
    const paramConveyorDropWidthSpan = document.getElementById('paramConveyorDropWidth');
    const paramBatchDropDurationSpan = document.getElementById('paramBatchDropDuration');
    const paramNumBatchesSpan = document.getElementById('paramNumBatches');
    const paramBatchSizeSpan = document.getElementById('paramBatchSize');
    const paramDropDelaySpan = document.getElementById('paramDropDelay');
    const paramShakeAmpSpan = document.getElementById('paramShakeAmp');
    const paramShakeNormalTimeSpan = document.getElementById('paramShakeNormalTime');
    const paramShakeAmpHarshSpan = document.getElementById('paramShakeAmpHarsh');
    const paramShakeHarshTimeSpan = document.getElementById('paramShakeHarshTime');
    const ledWallCrossover = document.getElementById('led-wall-crossover');
    const ledPinchPoint = document.getElementById('led-pinch-point');
    const ledSacrificialPiece = document.getElementById('led-sacrificial-piece');
    const ledJamDetection = document.getElementById('led-jam-detection');
    const ledLargeClump = document.getElementById('led-large-clump');
    const ledStagnation = document.getElementById('led-stagnation');
    const ledPhysicsViolation = document.getElementById('led-physics-violation');
    const ledTimeoutCompletion = document.getElementById('led-timeout-completion');
    const weightInputs = {
        W_TP_EXP: document.getElementById('w_tp_exp'), W_TP_LIN: document.getElementById('w_tp_lin'), W_TC: document.getElementById('w_tc'),
        W_CON_EXP: document.getElementById('w_con_exp'), W_CON_LIN: document.getElementById('w_con_lin'),
        W_SYM_EXP: document.getElementById('w_sym_exp'), W_SYM_LIN: document.getElementById('w_sym_lin'),
        W_PREF_COUNT: document.getElementById('w_pref_count'), W_PREF_RATIO_EXP: document.getElementById('w_pref_ratio_exp'), W_PREF_RATIO_LIN: document.getElementById('w_pref_ratio_lin'),
        W_J: document.getElementById('w_j'), W_S: document.getElementById('w_s'), W_IQR: document.getElementById('w_iqr'),
        W_PV: document.getElementById('w_pv'),
        W_ZONE_REJECT: document.getElementById('w_zone_reject'), W_ZONE_LOW: document.getElementById('w_zone_low'),
        W_ZONE_HIGH: document.getElementById('w_zone_high'), W_ZONE_JAM: document.getElementById('w_zone_jam'),
    };

    // --- Helper Functions ---
    const safeUpdate = (element, value, suffix = '') => {
        if (element) {
            if (value === null || typeof value === 'undefined') {
                element.textContent = 'N/A';
            } else {
                element.textContent = value + suffix;
            }
        }
    };

    function getFitnessWeightsFromUI() {
        const weights = {};
        for (const key in weightInputs) {
            if (weightInputs[key]) {
                weights[key] = parseFloat(weightInputs[key].value);
            }
        }
        return weights;
    }

    // --- MODIFIED UI STATUS HANDLER ---
    function updateUIStatus(status, directiveName = "N/A") {
        const statusString = status || "Idle";
        safeUpdate(gaStatusTextSpan, statusString);
        safeUpdate(directiveNameSpan, directiveName);

        const isRunning = statusString.startsWith("Running");
        const isPaused = statusString.startsWith("Paused");
        const isStopped = statusString.startsWith("Stopped");
        const hasHistory = evolutionHistory.length > 0;
        const hasChunks = surveyDataChunks.length > 0;

        if (isStopped && hasHistory) {
            startButton.disabled = false;
            startButton.textContent = "Resume Evolution";
            stopButton.disabled = true;
            loadHistoryButton.disabled = false;
            startWithSeedButton.disabled = false;
            downloadHistoryButton.disabled = false;
            downloadMetaReportButton.disabled = false;
            downloadLogAndClearButton.disabled = !hasChunks;
            resumeDirectivesButton.disabled = false;
        } else {
            startButton.disabled = isRunning || isPaused;
            startButton.textContent = "Start Evolution";
            stopButton.disabled = !isRunning;
            loadHistoryButton.disabled = isRunning || isPaused;
            startWithSeedButton.disabled = isRunning || isPaused;
            downloadHistoryButton.disabled = !isStopped || !hasHistory;
            downloadMetaReportButton.disabled = !isStopped || !hasHistory;
            downloadLogAndClearButton.disabled = !isStopped || !hasChunks;
            resumeDirectivesButton.disabled = !isStopped;
        }

        Object.values(weightInputs).forEach(input => {
            if(input) input.disabled = isRunning || isPaused;
        });
    }

    function updateHeuristicStatus(flags) {
        if (!flags) {
            const allLeds = [ledWallCrossover, ledPinchPoint, ledSacrificialPiece, ledJamDetection, ledLargeClump, ledStagnation, ledPhysicsViolation, ledTimeoutCompletion];
            allLeds.forEach(led => { if(led) led.className = 'led led-off'; });
            return;
        }
        const setLed = (led, status) => { if(led) led.className = status ? 'led led-active' : 'led led-inactive'; };

        setLed(ledWallCrossover, flags.wallCrossoverTest);
        setLed(ledPinchPoint, flags.pinchPointTest);
        setLed(ledSacrificialPiece, flags.sacrificialPieceTest);
        setLed(ledJamDetection, flags.jamDetection);
        setLed(ledLargeClump, flags.largeClumpExit);
        setLed(ledStagnation, flags.stagnationExit);
        setLed(ledPhysicsViolation, flags.physicsViolation);
        setLed(ledTimeoutCompletion, flags.timeoutCompletion);
    }

    function updateDetailedUI(bestIndividual, bestResult, mutationRate) {
        if (!bestIndividual) return;
        
        visualizer.drawStaticBoard(bestIndividual, bestResult);

        safeUpdate(bestFitnessSpan, bestIndividual.fitness?.toFixed(2));
        safeUpdate(mutationRateSpan, `${(mutationRate * 100).toFixed(2)}%`);
        safeUpdate(paramBoardAngleSpan, (bestIndividual.boardAngle * 180 / Math.PI).toFixed(1), '°');
        safeUpdate(paramDetectorOffsetSpan, bestIndividual.detectorOffset.toFixed(1), 'px');
        safeUpdate(paramNumBatchesSpan, bestIndividual.numBatches);
        safeUpdate(paramBatchSizeSpan, bestIndividual.batchSize);
        safeUpdate(paramDropDelaySpan, (bestIndividual.dropDelayTime).toFixed(0), 'ms');
        safeUpdate(paramFreeFallTimeSpan, (bestIndividual.freeFallTime || 0).toFixed(0), 'ms');
        safeUpdate(paramConveyorDropXSpan, bestIndividual.conveyorDropX.toFixed(1), 'px');
        safeUpdate(paramConveyorDropWidthSpan, bestIndividual.conveyorDropWidth.toFixed(1), 'px');
        safeUpdate(paramBatchDropDurationSpan, bestIndividual.batchDropDuration.toFixed(0), 'ms');
        safeUpdate(paramShakeAmpSpan, bestIndividual.shakeAmplitude.toFixed(3));
        safeUpdate(paramShakeNormalTimeSpan, `${bestIndividual.shakeTimeOn.toFixed(0)} / ${bestIndividual.shakeTimeOff.toFixed(0)} ms`);
        safeUpdate(paramShakeAmpHarshSpan, bestIndividual.shakeAmplitude_harsh.toFixed(3));
        safeUpdate(paramShakeHarshTimeSpan, `${bestIndividual.shakeTimeOn_harsh.toFixed(0)} / ${bestIndividual.shakeTimeOff_harsh.toFixed(0)} ms`);

        if (activePegFieldsSpan && bestIndividual.pegMatrices) {
            const activeCount = bestIndividual.pegMatrices.filter(p => p.isActive).length;
            safeUpdate(activePegFieldsSpan, `${activeCount} / ${bestIndividual.pegMatrices.length}`);
        }
        if (activeComplexRampsSpan && bestIndividual.complexRamps) {
            const activeRamps = bestIndividual.complexRamps.filter(p => p.isActive).length;
            safeUpdate(activeComplexRampsSpan, `${activeRamps} / ${bestIndividual.complexRamps.length}`);
        }

        if (bestResult) {
            let throughputText = `${bestResult.throughputScore} / ${bestResult.totalPieces}`;
            if (bestResult.isEstimated) throughputText += `* (est. ${bestResult.exitReason})`;
            safeUpdate(throughputScoreSpan, throughputText);
            safeUpdate(jamPenaltySpan, bestResult.jamPenalty);
            safeUpdate(simultaneousPenaltySpan, bestResult.simultaneousPenalty);
            safeUpdate(intervalZonePenaltySpan, bestResult.intervalZonePenalty?.toFixed(2));
            safeUpdate(physicsViolationCountSpan, bestResult.physicsViolationCount);
            safeUpdate(consistencyRewardRatioSpan, `${bestResult.consistencyRewardRatio.toFixed(5)}`);
            safeUpdate(iqrPenaltyRatioSpan, `${bestResult.normalizedIQR.toFixed(5)}`);
            safeUpdate(symmetryScoreSpan, `${bestResult.symmetryRewardRatio.toFixed(3)}`);
            
            if (bestResult.functionalAnnotations) {
                const probeTime = bestResult.functionalAnnotations.probeTraversalTime;
                const pieceTime = bestResult.functionalAnnotations.sacrificialPieceTraversalTime;
                safeUpdate(probeTraverseTimeSpan, probeTime ? probeTime.toFixed(0) : 'FAIL', 'ms');
                safeUpdate(sacrificialPieceTimeSpan, pieceTime ? pieceTime.toFixed(0) : 'FAIL', 'ms');
            }

            updateClumpHistogram(bestResult.clumpHistogram);
            updateTimingHistogram(bestResult.intervals);
            updateFitnessBreakdown(bestResult);
            updateHeuristicStatus(bestResult.featureFlags);
        }
    }

    function updateFitnessBreakdown(result) {
        if (!result || !result.fitnessBreakdown) {
            const allIds = ['tp-exp', 'tp-lin', 'tc', 'con-exp', 'con-lin', 'sym-exp', 'sym-lin', 'pref-count', 'pref-ratio-exp', 'pref-ratio-lin', 'j', 's', 'iqr', 'pv', 'zone-reject', 'zone-low', 'zone-high', 'zone-jam'];
            allIds.forEach(id => {
                 const wEl = document.getElementById(`w-${id}`), mEl = document.getElementById(`m-${id}`), iEl = document.getElementById(`i-${id}`);
                 if(wEl) wEl.textContent = ''; if(mEl) mEl.textContent = ''; if(iEl) iEl.textContent = '';
            });
            return;
        }

        const weights = getFitnessWeightsFromUI();
        const breakdown = result.fitnessBreakdown;
        const throughputRatio = result.totalPieces > 0 ? result.throughputScore / result.totalPieces : 0;

        const updateRow = (id, w, m, i) => {
            const wEl = document.getElementById(`w-${id}`), mEl = document.getElementById(`m-${id}`), iEl = document.getElementById(`i-${id}`);
            if (!wEl || !mEl || !iEl) return;
            wEl.textContent = w;
            mEl.textContent = m;
            const isPositive = i >= 0;
            iEl.textContent = `${isPositive ? '+' : ''}${i.toFixed(2)}`;
            iEl.className = isPositive ? 'impact-positive' : 'impact-negative';
        };

        updateRow('tp-exp', weights.W_TP_EXP.toExponential(1), `(${throughputRatio.toFixed(3)})^6`, breakdown.impact_tp_exp);
        updateRow('tp-lin', weights.W_TP_LIN.toFixed(0), throughputRatio.toFixed(3), breakdown.impact_tp_lin);
        updateRow('tc', weights.W_TC.toFixed(0), result.throughputScore, breakdown.impact_tc);
        updateRow('con-exp', weights.W_CON_EXP.toExponential(1), `(${result.consistencyRewardRatio.toFixed(5)})^6`, breakdown.impact_con_exp);
        updateRow('con-lin', weights.W_CON_LIN.toFixed(0), result.consistencyRewardRatio.toFixed(5), breakdown.impact_con_lin);
        updateRow('sym-exp', weights.W_SYM_EXP.toExponential(1), `(${result.symmetryRewardRatio.toFixed(3)})^6`, breakdown.impact_sym_exp);
        updateRow('sym-lin', weights.W_SYM_LIN.toFixed(0), result.symmetryRewardRatio.toFixed(3), breakdown.impact_sym_lin);
        updateRow('pref-count', weights.W_PREF_COUNT.toFixed(0), result.preferredIntervalCount, breakdown.impact_pref_count);
        updateRow('pref-ratio-exp', weights.W_PREF_RATIO_EXP.toExponential(1), `(${result.preferredIntervalRatio.toFixed(3)})^6`, breakdown.impact_pref_ratio_exp);
        updateRow('pref-ratio-lin', weights.W_PREF_RATIO_LIN.toFixed(0), result.preferredIntervalRatio.toFixed(3), breakdown.impact_pref_ratio_lin);
        updateRow('j', weights.W_J.toFixed(0), result.jamPenalty, breakdown.impact_j);
        updateRow('s', weights.W_S.toFixed(0), result.simultaneousPenalty, breakdown.impact_s);
        updateRow('iqr', weights.W_IQR.toFixed(0), result.normalizedIQR.toFixed(5), breakdown.impact_iqr);
        updateRow('pv', weights.W_PV.toFixed(0), result.physicsViolationCount, breakdown.impact_pv);
        updateRow('zone-reject', weights.W_ZONE_REJECT.toFixed(0), result.rejectCount, breakdown.impact_zone_reject);
        updateRow('zone-low', weights.W_ZONE_LOW.toFixed(0), result.lowCount, breakdown.impact_zone_low);
        updateRow('zone-high', weights.W_ZONE_HIGH.toFixed(0), result.highCount, breakdown.impact_zone_high);
        updateRow('zone-jam', weights.W_ZONE_JAM.toFixed(0), result.jamCount, breakdown.impact_zone_jam);
    }

    function updateClumpHistogram(histogramData) {
        if (!histogramData || !clumpHistogramCanvas) return;
        const labels = Object.keys(histogramData).sort((a, b) => parseInt(a) - parseInt(b));
        const data = labels.map(label => histogramData[label]);
        if (clumpChart) {
            clumpChart.data.labels = labels; clumpChart.data.datasets[0].data = data; clumpChart.update();
        } else {
            clumpChart = new Chart(clumpHistogramCanvas.getContext('2d'), { type: 'bar', data: { labels, datasets: [{ label: 'Clump Count', data, backgroundColor: 'rgba(52, 152, 219, 0.5)' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Clump Size' } }, y: { beginAtZero: true } } } });
        }
    }

    function updateTimingHistogram(intervals) {
        if (!intervals || !timingHistogramCanvas) return;
        const binSize = 50, maxTime = 2000, binCount = Math.ceil(maxTime / binSize);
        const bins = new Array(binCount).fill(0);
        const labels = Array.from({length: binCount}, (_, i) => `${i * binSize}`);
        intervals.forEach(interval => { if (interval < maxTime) bins[Math.floor(interval / binSize)]++; });
        if (timingChart) {
            timingChart.data.labels = labels; timingChart.data.datasets[0].data = bins; timingChart.update();
        } else {
            timingChart = new Chart(timingHistogramCanvas.getContext('2d'), { type: 'bar', data: { labels, datasets: [{ label: 'Interval Count', data: bins, backgroundColor: 'rgba(46, 204, 113, 0.5)' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Time (ms)' } }, y: { beginAtZero: true } } } });
        }
    }

    function downloadJSON(data, filename) {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", filename);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    }

    function downloadJSONL(data, filename) {
        const flattenedData = data.flat();
        const jsonlContent = flattenedData.map(obj => JSON.stringify(obj)).join('\n');
        const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // --- Worker Communication ---
    function handleWorkerMessage(event) {
        const { type, payload } = event.data;
        switch (type) {
            case 'engine_ready':
                updateUIStatus("Ready");
                break;
            case 'status':
                updateUIStatus(payload.status, payload.directiveName);
                break;
            case 'progress_update':
                updateUIStatus(`Running... (Simulating ${payload.completed} / ${payload.total})`);
                break;
            case 'update':
                safeUpdate(generationCountSpan, payload.generation);
                safeUpdate(runCountSpan, payload.runCount);
                if (payload.bestIndividual) {
                    updateDetailedUI(payload.bestIndividual, payload.bestResult, payload.mutationRate);
                }
                evolutionHistory = payload.history;
                break;
            case 'paused':
                updateUIStatus("Paused.", payload.directiveName);
                if (payload.bestIndividual) {
                    updateDetailedUI(payload.bestIndividual, payload.bestResult, payload.mutationRate);
                }
                break;
            case 'stopped':
                 updateUIStatus("Stopped.");
                 if (payload.bestIndividual) {
                    updateDetailedUI(payload.bestIndividual, payload.bestResult, payload.mutationRate);
                }
                evolutionHistory = payload.history;
                break;
            case 'loaded':
                evolutionHistory = payload.history;
                safeUpdate(generationCountSpan, `Loaded (G${payload.generation})`);
                updateDetailedUI(payload.bestIndividual, null, 0);
                updateUIStatus("Ready");
                break;
            case 'generation_survey_data':
                surveyDataChunks.push(payload);
                safeUpdate(surveyChunkCountSpan, `(${surveyDataChunks.length})`);
                if (downloadLogAndClearButton.disabled) {
                    downloadLogAndClearButton.disabled = false;
                }
                break;
            case 'history_data':
                downloadJSON(payload.history, `plinko_history_S34_Run${payload.runCount}.json`);
                break;
            case 'metareport_data':
                downloadJSON(payload.report, `plinko_metareport_S34_Run${payload.runCount}.json`);
                break;
            case 'autosave':
                downloadJSON(payload.chromosome, `plinko_best_S34_G${payload.generation}_Run${payload.runCount}.json`);
                break;
            case 'error':
                console.error("[Main] Received error from worker:", payload);
                updateUIStatus(`Worker Error! Check Console.`);
                break;
        }
    }

    function initializeGAWorker() {
        gaWorker = new Worker(`ga_worker_S34.js?run=${runId}`);
        gaWorker.onmessage = handleWorkerMessage;
        gaWorker.onerror = (e) => {
            console.error("CRITICAL WORKER ERROR:", e);
            updateUIStatus("Worker Failed!");
        };

        updateUIStatus("Initializing...");
        const configForWorker = {
            ENGINE_CONFIG: configModule.ENGINE_CONFIG,
            TIME_STEP: configModule.TIME_STEP,
            PIECE_PHYSICS_PROPERTIES: configModule.PIECE_PHYSICS_PROPERTIES,
            PIECE_LIBRARY: configModule.PIECE_LIBRARY,
            SIM_CONFIG: configModule.SIM_CONFIG,
            SENSOR_CONFIG: configModule.SENSOR_CONFIG,
            MAX_SIM_TIME: configModule.MAX_SIM_TIME,
        };
        gaWorker.postMessage({ command: 'init', payload: { config: configForWorker, runId: runId } });
    }

    // --- Initialization Sequence (MODIFIED) ---
    try {
        visualizer = new Visualizer(document.getElementById('simulation-container'), configModule);
        initializeGAWorker();

        startButton.addEventListener('click', () => {
            if (startButton.textContent === "Resume Evolution") {
                gaWorker.postMessage({ command: 'resume' });
            } else {
                surveyDataChunks = [];
                safeUpdate(surveyChunkCountSpan, '(0)');
                gaWorker.postMessage({ command: 'start', payload: { fitnessWeights: getFitnessWeightsFromUI() } });
            }
        });

        stopButton.addEventListener('click', () => {
            gaWorker.postMessage({ command: 'stop' });
        });
        downloadHistoryButton.addEventListener('click', () => gaWorker.postMessage({ command: 'get_history' }));
        downloadMetaReportButton.addEventListener('click', () => gaWorker.postMessage({ command: 'get_metareport' }));
        loadHistoryButton.addEventListener('click', () => historyFileInput.click());
        historyFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const history = JSON.parse(ev.target.result);
                    gaWorker.postMessage({ command: 'load', payload: history });
                } catch (error) { alert("Error parsing history file: " + error.message); }
            };
            reader.readAsText(file);
            historyFileInput.value = '';
        });
        startWithSeedButton.addEventListener('click', () => seedFileInput.click());

        seedFileInput.addEventListener('change', (e) => {
             const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    let seedChromosome = null;

                    if (Array.isArray(data) && data.length > 0) {
                        seedChromosome = data[data.length - 1];
                    } else if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
                        seedChromosome = data;
                    }

                    if (seedChromosome) {
                        surveyDataChunks = [];
                        safeUpdate(surveyChunkCountSpan, '(0)');
                        gaWorker.postMessage({
                            command: 'start_with_seed',
                            payload: { seed: seedChromosome, fitnessWeights: getFitnessWeightsFromUI() }
                        });
                    } else {
                        alert("Invalid file format. Expected a single chromosome object or a history array.");
                    }
                } catch (error) { alert("Error parsing seed file: " + error.message); }
            };
            reader.readAsText(file);
            seedFileInput.value = '';
        });

        downloadLogAndClearButton.addEventListener('click', () => {
            if (surveyDataChunks.length > 0) {
                const currentRun = runCountSpan.textContent || 'X';
                downloadJSONL(surveyDataChunks, `plinko_survey_S34_Run${currentRun}_chunked.jsonl`);
                surveyDataChunks = [];
                safeUpdate(surveyChunkCountSpan, '(0)');
                downloadLogAndClearButton.disabled = true;
            }
        });

        resumeDirectivesButton.addEventListener('click', () => {
            directivesFileInput.click();
        });
        directivesFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const directives = JSON.parse(ev.target.result);
                    gaWorker.postMessage({ command: 'resume_with_directives', payload: { directives } });
                } catch (error) { alert("Error parsing directives file: " + error.message); }
            };
            reader.readAsText(file);
            directivesFileInput.value = '';
        });

        screenshotButton.addEventListener('click', () => {
            visualizer.takeScreenshot(`plinko_S34_G${generationCountSpan.textContent}_Run${runCountSpan.textContent}.png`);
        });

    } catch (error) {
        console.error("CRITICAL INITIALIZATION FAILURE:", error);
        document.body.innerHTML = `<h1>Fatal Error During Initialization</h1><pre>${error.stack}</pre>`;
    }
});
