apigee-perf-summary
===================

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

## Tests

  none yet

## Samples

You will find sample trace files in the trace-files folder and a sample config in sampleConfig.js.

## Security Thoughts

Think twice about putting trace files into a repository. We include them in our sample as a means of demonstrating the framework, but consider that tracefiles may have a wealth of implementation details including API keys, target credentials, and the like. 

## Contributing

In lieu of a formal style guide, take care to maintain the existing coding style.
Add unit tests for any new or changed functionality. Lint and test your code.

## Release History

* 0.1.0 Initial release