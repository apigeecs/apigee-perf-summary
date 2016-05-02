apigee-perf-summary
===================

[![Codacy Badge](https://api.codacy.com/project/badge/Grade/7aa88006f019454c84eec8b85d06a92e)](https://www.codacy.com/app/dallen/apigee-perf-summary?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=apigeecs/apigee-perf-summary&amp;utm_campaign=Badge_Grade)

A  library providing utility methods to support the offline analysis of trace files to determine relative performance aspects of proxies focused primarily on policy execution.

A future version will include analysis of target calls as well.

Features include:
* summarize performance of proxies with min, max, and average execution times.
* summarize by policy type
* summarize by policy name


## Installation

The only prerequisites not handled during the installation are a functional Node environment, the availability of npm, and sufficient priviledges to run commands as adminstrator. The steps below are applicable to a Mac OS X environment, similar steps work under Linux or Windows. 
	
Clone the apigee-perf-summary repository to your local machine:

	ApigeeCorporation$ git clone https://github.com/apigeecs/apigee-perf-summary.git

Alternatively you can download the zip file via the GitHub home page and unzip the archive.

Navigate to the package directory:

	ApigeeCorporation$ cd path/to/apigee-perf-summary/package/

Install globally:

	ApigeeCorporation$ sudo npm install . -g

## Usage

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

ApigeeCorporation$ node ./summarize-foo.js

Where summarize-foo.js is a script as outlined above.

Output from the script includes a detailed information and JSON results objects of the form:

	processed 3 files.
	number of policies: 21
	statistics by policy type: {
	    "JavascriptStepExecution": {
	        "count": 3,
	        "min": 0,
	        "max": 130,
	        "averageExecutionDurationMs": 72.66666666666667
	    }
	}
	statistics by policy name: {
	    "jsCalculate": {
	        "count": 3,
	        "min": 0,
	        "max": 130,
	        "averageExecutionDurationMs": 72.66666666666667
	    }
	}

Remote sessions may be initiated by supplying connection information including the org, environment, api, revision, and credentials authorized to execute trace sessions in the org. Sample:

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

Note that remote sessions capture a percentage of traffic - it is not capable of nore intended to capture all traffic in a given run. Consider it as sampling as much as 90% or as low as 60% of traffic depending on the speed of your local machine, local network, and rate of traffic in your proxy.


Output is now available in a tabular format, which is readable to humans

    .-------------------------------------------------.
    |            Policy Statistics by Name            |
    |-------------------------------------------------|
    |   policy    | count | min | max |  avg  |   σ   |
    |-------------|-------|-----|-----|-------|-------|
    | jsCalculate |     3 |  31 | 130 | 72.67 | 41.91 |
    '-------------------------------------------------'

## Tests

  none yet

## Samples

You will find sample trace files in the trace-files folder and a sample config in sampleConfig.js.

## Security Thoughts

Think twice about putting trace files into a repository. We include them in our sample as a means of demonstrating the framework, but consider that tracefiles may have a wealth of implementation details including API keys, target credentials, and the like. 

## Installtion Issue on Windows

node-gyp rebuild errors are typicall resolvable by visiting https://www.robertkehoe.com/2015/03/fix-node-gyp-rebuild-error-on-windows/

## Contributing

In lieu of a formal style guide, take care to maintain the existing coding style.
Add unit tests for any new or changed functionality. Lint and test your code.

## Release History

* 0.1.0 Initial release
