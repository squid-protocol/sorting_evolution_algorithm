// validator_report_generator_S34.js
document.addEventListener('DOMContentLoaded', () => {
    const reportDataString = sessionStorage.getItem('validationReportData');
    if (!reportDataString) {
        document.getElementById('report-content').innerHTML = '<h1>Error: No report data found.</h1>';
        return;
    }

    const reportData = JSON.parse(reportDataString);
    const { statistics, results, chromosome } = reportData;

    document.getElementById('downloadJson').addEventListener('click', () => {
        // ... download logic ...
    });

    populateChromosomeTable(chromosome);
    populateSummaryTable(statistics);
    populateWarningsTable(statistics, results.length);
    populateLog(results);
    renderAllCharts(results);
});

function populateChromosomeTable(chromosome) {
    const table = document.getElementById('chromosome-table');
    let tableHtml = `<thead><tr><th>Parameter</th><th>Value</th><th>Parameter</th><th>Value</th></tr></thead><tbody>`;
    // This will need to be expanded to show all S34 parameters, including funnel_profile
    table.innerHTML = tableHtml + `</tbody>`;
}

function populateSummaryTable(statistics) {
    // ... logic to populate the main summary table ...
}

function populateWarningsTable(statistics, totalRuns) {
    const warningsTable = document.getElementById('warnings-table');
    let warningsHtml = `<thead><tr><th>Warning Type</th><th>Total Occurrences</th><th>Frequency</th></tr></thead><tbody>`;
    if (statistics.warningCounts && Object.keys(statistics.warningCounts).length > 0) {
        for (const [warning, count] of Object.entries(statistics.warningCounts)) {
            const frequency = (count / totalRuns) * 100;
            warningsHtml += `<tr><td>${warning}</td><td>${count}</td><td>${frequency.toFixed(1)}%</td></tr>`;
        }
    } else {
        warningsHtml += `<tr><td colspan="3">No warnings triggered in any run.</td></tr>`;
    }
    warningsTable.innerHTML = warningsHtml + `</tbody>`;
}

function populateLog(results) {
    // ... logic to populate the detailed run log ...
}

function renderAllCharts(results) {
    // ... logic to render all Chart.js charts based on S34 metrics ...
}
