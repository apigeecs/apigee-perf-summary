perf_summary = require("./package/apigee-perf-summary");

perf_summary.summarize({
    traceFile: "./trace-files/",
    debug: true,
    //all,fileCount,policyCount,policyTypeStats,policyNameStats,traceDetails
    output: 'fileCount,policyCount,policyNameStats,traceDetails',
    omitAvgThreshold: 4,
    omitMaxThreshold: 8,
    includeDisabled: false
});
