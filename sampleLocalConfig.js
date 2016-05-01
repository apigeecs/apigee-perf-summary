var perf_summary = require("./package/apigee-perf-summary");

perf_summary.summarize({
    debug: true,
    traceFile: "./trace-files/",
    //all,fileCount,policyCount,policyTypeStats,policyNameStats,traceDetails
    output: "fileCount,policyCount,policyNameStats",
    omitAvgThreshold: 0,
    omitMaxThreshold: 0,
    includeDisabled: false
});
