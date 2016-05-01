var perfSummary = require("./package/apigee-perf-summary");

perfSummary.summarize({
    debug: true,
    traceFile: "./trace-files/",
    //all,fileCount,policyCount,policyTypeStats,policyNameStats,traceDetails
    output: "fileCount,policyCount,policyNameStats",
    omitAvgThreshold: 0,
    omitMaxThreshold: 0,
    includeDisabled: false
});
