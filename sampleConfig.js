perf_summary = require("apigee-perf-summary");

perf_summary.summarize({
    debug: true,
    org: 'davidwallen2014',
    env: 'test',
    api: '24Solver',
    rev: '17',
    auth: 'Basic ZGFsbGfooFwaWdlZbarjb20nomszbSumITIz',
    //all,fileCount,policyCount,policyTypeStats,policyNameStats,traceDetails
    output: 'fileCount,policyCount,policyNameStats',
    omitAvgThreshold: 0,
    omitMaxThreshold: 0,
    includeDisabled: false
});
