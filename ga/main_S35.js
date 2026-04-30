// main_S35.js
// S35 UPGRADE: Orchestrates the S35 UI and worker communication.
//
// ===================================================================================
// == VERSION 5.1 UPDATE: POLYLINE UI                                               ==
// ===================================================================================
// The UI has been updated to display the new final ramp knee factors.
//
// - Added new UI element references for the knee factors.
// - updateDetailedUI() now populates these new fields.
// ===================================================================================

import * as configModule from '../simulation_config.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let gaWorker;
    let visualizer;
    let clumpChart = null;
    let timingChart = null;
    let evolutionHistory = [];
    const runId = new Date().getTime();

    // --- UI Element References ---
    const startButton = document.getElementById('startGAButton');
    const stopButton = document.getElementById('stopGAButton');
    const pauseButton = document.getElementById('pauseGAButton');
    const resumeButton = document.getElementById('resumeGAButton');
    const startWithSeedButton = document.getElementById('startWithSeedButton');
    const screenshotButton = document.getElementById('screenshotButton');
    const downloadHistoryButton = document.getElementById('downloadHistoryButton');
    const downloadMetareportButton = document.getElementById('downloadMetareportButton');
    const loadHistoryButton = document.getElementById('loadHistoryButton');
    const historyFileInput = document.getElementById('historyFileInput');
    const seedFileInput = document.getElementById('seedFileInput');
    
    const generationCountSpan = document.getElementById('generationCount');
    const bestFitnessSpan = document.getElementById('bestFitness');
    const mutationRateSpan = document.getElementById('mutationRate');
    const gaStatusTextSpan = document.getElementById('gaStatusText');
    const throughputScoreSpan = document.getElementById('throughputScore');
    const jamPenaltySpan = document.getElementById('jamPenalty');
    const simultaneousPenaltySpan = document.getElementById('simultaneousPenalty');
    const physicsViolationCountSpan = document.getElementById('physicsViolationCount');
    const consistencyRewardRatioSpan = document.getElementById('consistencyRewardRatio');
    const iqrPenaltyRatioSpan = document.getElementById('iqrPenaltyRatio');
    
    const paramChannelWidthSpan = document.getElementById('paramChannelWidth');
    const paramBoardAngleSpan = document.getElementById('paramBoardAngle');
    const paramShakeAmplitudeSpan = document.getElementById('paramShakeAmplitude');
    const paramDetectorHeightSpan = document.getElementById('paramDetectorHeight');
    const paramConveyorDropXSpan = document.getElementById('paramConveyorDropX');
    const paramConveyorDropWidthSpan = document.getElementById('paramConveyorDropWidth');
    const paramBatchSizeSpan = document.getElementById('paramBatchSize');
    const paramNumBatchesSpan = document.getElementById('paramNumBatches');
    const paramDropDelayTimeSpan = document.getElementById('paramDropDelayTime');
    const paramBatchDropDurationSpan = document.getElementById('paramBatchDropDuration');
    const paramKneeXSpan = document.getElementById('paramKneeX');
    const paramKneeYSpan = document.getElementById('paramKneeY');
    const rampDetailsContainer = document.getElementById('ramp-details-container');
    
    const clumpHistogramCanvas = document.getElementById('clumpHistogram');
    const timingHistogramCanvas = document.getElementById('timingHistogram');
    const fitnessBreakdownBody = document.getElementById('fitness-breakdown-body');

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
        if (element) element.textContent = (value === null || typeof value === 'undefined') ? 'N/A' : value + suffix;
    };

    function getFitnessWeightsFromUI() {
        const weights = {};
        for (const key in weightInputs) {
            if (weightInputs[key]) weights[key] = parseFloat(weightInputs[key].value);
        }
        return weights;
    }

    function updateUIStatus(status) {
        safeUpdate(gaStatusTextSpan, status);
        const isRunning = status.startsWith("Running") || status.startsWith("Simulating");
        const isPaused = status.startsWith("Paused");
        const isStopped = !isRunning && !isPaused;
        
        startButton.disabled = isRunning || isPaused;
        stopButton.disabled = isStopped;
        pauseButton.disabled = !isRunning;
        resumeButton.disabled = !isPaused;
        startWithSeedButton.disabled = isRunning || isPaused;
        loadHistoryButton.disabled = isRunning || isPaused;
        downloadHistoryButton.disabled = isStopped && evolutionHistory && evolutionHistory.length > 0 ? false : true;
        downloadMetareportButton.disabled = isStopped && evolutionHistory && evolutionHistory.length > 0 ? false : true;
        Object.values(weightInputs).forEach(input => { if(input) input.disabled = isRunning || isPaused; });
    }
    
    function updateDetailedUI(bestIndividual, bestResult, mutationRate) {
        if (!bestIndividual) return;
        
        visualizer.drawStaticBoard(bestIndividual);

        safeUpdate(bestFitnessSpan, bestIndividual.fitness?.toFixed(2));
        safeUpdate(mutationRateSpan, `${(mutationRate * 100).toFixed(2)}%`);
        
        safeUpdate(paramChannelWidthSpan, bestIndividual.channelWidth.toFixed(1), 'px');
        safeUpdate(paramBoardAngleSpan, (bestIndividual.boardAngle * 180 / Math.PI).toFixed(1), '°');
        safeUpdate(paramShakeAmplitudeSpan, bestIndividual.shakeAmplitude.toFixed(3));
        safeUpdate(paramDetectorHeightSpan, bestIndividual.detectorHeight.toFixed(1), 'px');
        safeUpdate(paramConveyorDropXSpan, bestIndividual.conveyorDropX.toFixed(1), 'px');
        safeUpdate(paramConveyorDropWidthSpan, bestIndividual.conveyorDropWidth.toFixed(1), 'px');
        safeUpdate(paramBatchSizeSpan, bestIndividual.batchSize);
        safeUpdate(paramNumBatchesSpan, bestIndividual.numBatches);
        safeUpdate(paramDropDelayTimeSpan, bestIndividual.dropDelayTime, 'ms');
        safeUpdate(paramBatchDropDurationSpan, bestIndividual.batchDropDuration, 'ms');
        safeUpdate(paramKneeXSpan, bestIndividual.finalRampKneeX_factor?.toFixed(3));
        safeUpdate(paramKneeYSpan, bestIndividual.finalRampKneeY_factor?.toFixed(3));


        if (bestResult) {
            let throughputText = `${bestResult.throughputScore} / ${bestResult.totalPieces}`;
            if (bestResult.isEstimated) throughputText += `* (est. ${bestResult.exitReason})`;
            safeUpdate(throughputScoreSpan, throughputText);
            safeUpdate(jamPenaltySpan, bestResult.jamPenalty);
            safeUpdate(simultaneousPenaltySpan, bestResult.simultaneousPenalty);
            safeUpdate(physicsViolationCountSpan, bestResult.physicsViolationCount);
            safeUpdate(consistencyRewardRatioSpan, bestResult.consistencyRewardRatio?.toFixed(5));
            safeUpdate(iqrPenaltyRatioSpan, bestResult.normalizedIQR?.toFixed(5));

            updateClumpHistogram(bestResult.clumpHistogram);
            updateTimingHistogram(bestResult.intervals);
            updateFitnessBreakdown(bestResult);
        }
        
        let tableHTML = '<table class="ramp-table"><thead><tr><th>#</th><th>Side</th><th>Y Pos</th><th>Angle</th></tr></thead><tbody>';
        bestIndividual.cascadingRamps.forEach((ramp, i) => {
            const angleDisplay = (ramp.angle === undefined) ? 'AUTO' : (ramp.angle * 180 / Math.PI).toFixed(1) + '°';
            tableHTML += `<tr><td>${i+1}</td><td>${ramp.side}</td><td>${ramp.y_position.toFixed(0)}</td><td>${angleDisplay}</td></tr>`;
        });
        tableHTML += '</tbody></table>';
        rampDetailsContainer.innerHTML = tableHTML;
    }
    
    function updateClumpHistogram(histogramData) {
        if (!histogramData || !clumpHistogramCanvas) return;
        const labels = Object.keys(histogramData).sort((a, b) => parseInt(a) - parseInt(b));
        const data = labels.map(label => histogramData[label]);
        if (clumpChart) {
            clumpChart.data.labels = labels; clumpChart.data.datasets[0].data = data; clumpChart.update();
        } else {
            clumpChart = new Chart(clumpHistogramCanvas.getContext('2d'), { 
                type: 'bar', 
                data: { labels, datasets: [{ label: 'Clump Count', data, backgroundColor: 'rgba(52, 152, 219, 0.5)' }] }, 
                options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Clump Size' } }, y: { beginAtZero: true } } } 
            });
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
            timingChart = new Chart(timingHistogramCanvas.getContext('2d'), { 
                type: 'bar', 
                data: { labels, datasets: [{ label: 'Interval Count', data: bins, backgroundColor: 'rgba(46, 204, 113, 0.5)' }] }, 
                options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Time (ms)' } }, y: { beginAtZero: true } } } 
            });
        }
    }

    function updateFitnessBreakdown(result) {
        if (!result || !result.fitnessBreakdown || !fitnessBreakdownBody) return;
        const breakdown = result.fitnessBreakdown;
        const weights = getFitnessWeightsFromUI();
        const throughputRatio = result.totalPieces > 0 ? result.throughputScore / result.totalPieces : 0;
        const preferredIntervalRatio = result.preferredIntervalRatio || 0;

        const rows = [
            { label: 'TP Ratio (Exp)', w: weights.W_TP_EXP, m: `(${throughputRatio.toFixed(3)})^6`, i: breakdown.impact_tp_exp },
            { label: 'TP Ratio (Lin)', w: weights.W_TP_LIN, m: throughputRatio.toFixed(3), i: breakdown.impact_tp_lin },
            { label: 'TP Count', w: weights.W_TC, m: result.throughputScore, i: breakdown.impact_tc },
            { label: 'Consistency (Exp)', w: weights.W_CON_EXP, m: `(${result.consistencyRewardRatio.toFixed(3)})^6`, i: breakdown.impact_con_exp },
            { label: 'Consistency (Lin)', w: weights.W_CON_LIN, m: result.consistencyRewardRatio.toFixed(3), i: breakdown.impact_con_lin },
            { label: 'Symmetry (Exp)', w: weights.W_SYM_EXP, m: `(${result.symmetryRewardRatio.toFixed(3)})^6`, i: breakdown.impact_sym_exp },
            { label: 'Symmetry (Lin)', w: weights.W_SYM_LIN, m: result.symmetryRewardRatio.toFixed(3), i: breakdown.impact_sym_lin },
            { label: 'Pref. Ratio (Exp)', w: weights.W_PREF_RATIO_EXP, m: `(${preferredIntervalRatio.toFixed(3)})^3`, i: breakdown.impact_pref_ratio_exp },
            { label: 'Pref. Ratio (Lin)', w: weights.W_PREF_RATIO_LIN, m: preferredIntervalRatio.toFixed(3), i: breakdown.impact_pref_ratio_lin },
            { label: 'Pref. Count', w: weights.W_PREF_COUNT, m: result.preferredIntervalCount, i: breakdown.impact_pref_count },
            { label: 'Jam Penalty', w: weights.W_J, m: result.jamPenalty, i: breakdown.impact_j },
            { label: 'Simultaneous Penalty', w: weights.W_S, m: result.simultaneousPenalty, i: breakdown.impact_s },
            { label: 'IQR Penalty', w: weights.W_IQR, m: result.normalizedIQR.toFixed(3), i: breakdown.impact_iqr },
            { label: 'Physics Violation', w: weights.W_PV, m: result.physicsViolationCount, i: breakdown.impact_pv },
            { label: 'Zone Reject (<200ms)', w: weights.W_ZONE_REJECT, m: result.rejectCount, i: breakdown.impact_zone_reject },
            { label: 'Zone Low (200-250ms)', w: weights.W_ZONE_LOW, m: result.lowCount, i: breakdown.impact_zone_low },
            { label: 'Zone High (750-1500ms)', w: weights.W_ZONE_HIGH, m: result.highCount, i: breakdown.impact_zone_high },
            { label: 'Zone Jam (>1500ms)', w: weights.W_ZONE_JAM, m: result.jamCount, i: breakdown.impact_zone_jam },
        ];
        
        let html = '';
        rows.forEach(row => {
            const impact = row.i || 0;
            const weight = row.w || 0;
            const measure = row.m || 0;
            const isPositive = impact >= 0;
            html += `<tr><td>${row.label}</td><td>${weight.toExponential(1)}</td><td>${measure}</td><td class="${isPositive ? 'impact-positive' : 'impact-negative'}">${isPositive ? '+' : ''}${impact.toFixed(2)}</td></tr>`;
        });
        fitnessBreakdownBody.innerHTML = html;
    }

    function downloadJSON(data, filename) {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const a = document.createElement('a');
        a.setAttribute("href", dataStr);
        a.setAttribute("download", filename);
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function handleWorkerMessage(event) {
        const { type, payload } = event.data;
        switch (type) {
            case 'engine_ready': 
                updateUIStatus("Ready"); 
                break;
            case 'progress_update':
                updateUIStatus(`Simulating ${payload.completed} / ${payload.total}`);
                break;
            case 'update':
                evolutionHistory = payload.history || [];
                updateUIStatus("Running...");
                safeUpdate(generationCountSpan, payload.generation);
                if (payload.bestIndividual) {
                    updateDetailedUI(payload.bestIndividual, payload.bestResult, payload.mutationRate);
                }
                break;
            case 'stopped': 
                evolutionHistory = (payload && payload.history) ? payload.history : [];
                updateUIStatus("Stopped."); 
                break;
            case 'paused': 
                updateUIStatus("Paused."); 
                break;
            case 'metareport_data':
                downloadJSON(payload.report, `plinko_s35_metareport_run${runId}.json`);
                break;
            case 'loaded':
                evolutionHistory = payload.history;
                safeUpdate(generationCountSpan, `Loaded (G${payload.generation})`);
                updateDetailedUI(payload.bestIndividual, null, 0);
                updateUIStatus("Ready");
                break;
        }
    }

    function initializeGAWorker() {
        gaWorker = new Worker(`./ga_worker_S35.js?run=${runId}`);
        gaWorker.onmessage = handleWorkerMessage;
        gaWorker.onerror = (e) => {
            console.error("CRITICAL WORKER ERROR:", e);
            updateUIStatus("Worker Failed!");
        };
        
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

    // --- Initialization Sequence ---
    try {
        visualizer = new Visualizer(document.getElementById('simulation-container'), configModule);
        initializeGAWorker();

        startButton.addEventListener('click', () => gaWorker.postMessage({ command: 'start', payload: { fitnessWeights: getFitnessWeightsFromUI() } }));
        stopButton.addEventListener('click', () => gaWorker.postMessage({ command: 'stop' }));
        pauseButton.addEventListener('click', () => gaWorker.postMessage({ command: 'pause' }));
        resumeButton.addEventListener('click', () => gaWorker.postMessage({ command: 'resume' }));
        downloadHistoryButton.addEventListener('click', () => {
            if (evolutionHistory && evolutionHistory.length > 0) {
                downloadJSON(evolutionHistory, `plinko_s35_best_designs_run${runId}.json`);
            } else {
                alert("No history data available to download.");
            }
        });
        downloadMetareportButton.addEventListener('click', () => gaWorker.postMessage({ command: 'get_metareport' }));
        screenshotButton.addEventListener('click', () => visualizer.takeScreenshot(`s35_G${generationCountSpan.textContent}.png`));
        
        loadHistoryButton.addEventListener('click', () => historyFileInput.click());
        historyFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try { gaWorker.postMessage({ command: 'load', payload: JSON.parse(ev.target.result) }); }
                catch (error) { alert("Error parsing history file."); }
            };
            reader.readAsText(file);
            historyFileInput.value = '';
        });

        startWithSeedButton.addEventListener('click', () => seedFileInput.click());
        seedFileInput.addEventListener('change', (e) => {
             const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    const seed = Array.isArray(data) ? data[data.length - 1] : data;
                    gaWorker.postMessage({ command: 'start_with_seed', payload: { seed, fitnessWeights: getFitnessWeightsFromUI() } });
                } catch (error) { alert("Error parsing seed file."); }
            };
            reader.readAsText(file);
            seedFileInput.value = '';
        });

    } catch (error) {
        console.error("CRITICAL INITIALIZATION FAILURE:", error);
        document.body.innerHTML = `<h1>Fatal Error During Initialization</h1><pre>${error.stack}</pre>`;
    }
});
