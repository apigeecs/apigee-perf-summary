var perf_summary = require("./package/apigee-perf-summary");

perf_summary.summarize({
    debug: true,
    org: 'davidwallen2014',
    env: 'test',
    api: '24Solver',
    rev: '17',
    auth: 'Basic ZyouGVuQGrandom5jb206UDfakelKLRS1WsampleSHU1',
    //all,fileCount,policyCount,policyTypeStats,policyNameStats,traceDetails
    output: 'fileCount,policyCount,policyNameStats',
    omitAvgThreshold: 0,
    omitMaxThreshold: 0,
    includeDisabled: false
});
