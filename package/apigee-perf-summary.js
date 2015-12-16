// packages
var xml2js = require('xml2js'),
    colors = require('colors'),
    XmlStream = require('xml-stream'),
    AsciiTable = require('ascii-table'),
    _ = require("lodash"),
    path = require('path'),
    Stats = require('fast-stats').Stats
    ;

var variables = {},
    proxyResponse,
    results = {},
    traceSets = [],
    fs = require('fs'),
    traceResponse = {
        "traceFiles": [],
        "curTraceFile": {}
    },
    config;

print = function(msg) {
    if (msg && (typeof msg === 'object')) console.log(JSON.stringify(msg));
    else console.log(msg);
};

outputTraceDetails = function(traceDetails) {
    var table = new AsciiTable('Trace Details');
    var items = [];
 
    // discover the superset of keys in the package.
    _.forEach(traceDetails.traceFiles, function(tracefile) {
        _.forEach(tracefile.requests, function(request) {
            _.forEach(request.policies, function(policy) {
                _.forEach(policy, function(value, key) {
                    if( ! _.includes(items,key)) {
                        items.push(key);
                    }
                });
            });
        });
    });

    // build the table header
    table
      .setHeading(["trace file","application","env","proxy"].concat(items));
    
    // build the table body
    _.forEach(traceDetails.traceFiles, function(tracefile) {
        _.forEach(tracefile.requests, function(request) {
            var section = [path.basename(tracefile.file), request.application, request.environment, request.proxy];
            table.addRow(section);
            _.forEach(request.policies, function(policy) {
                var data = ['','','',''];
                _.forEach(items, function(itemName) {
                    data.push(policy[itemName]);
                })
                table.addRow(data);
            })
        })
    });

    print(table.toString());
};

outputPolciyNameStats = function(policynamestats) {
    var table = new AsciiTable('Policy Statistics by Name');

    // this data are calculated, and is guaranteed to be this list (I hope)
    table.setHeading('policy','count','min','max','avg','σ');

    // this is the data package values in the order I want to display them
    var dataOrder = ['count','min','max','averageExecutionDurationMs','executionσ'];

    _.forEach(policynamestats, function(stats,policy) {
        var dataDisplay = [policy];
        _.forEach(dataOrder, function(dataItem) {
            dataDisplay.push(stats[dataItem]);
        });
        table.addRow(dataDisplay);
    });

    print(table.toString());
}

finish = function() {
    var ct = countKeys(traceResponse.curTraceFile);
    if (ct === 0) {
        //handle post processing
        var all = (config.output.indexOf('all') > -1);

        if (all || config.output.indexOf('fileCount') > -1) print("processed " + traceResponse.traceFiles.length + " files.");
        if (all || config.output.indexOf('policyCount') > -1) {
            print("number of policies: " + policyCount(traceResponse));
        }
        if (all || config.output.indexOf('policyTypeStats') > -1) {
            print("statistics by policy type: " + JSON.stringify(policyTypeStats(traceResponse)));
        }
        if (all || config.output.indexOf('policyNameStats') > -1) {
            outputPolciyNameStats(policyNameStats(traceResponse));
            //print("statistics by policy name: " + JSON.stringify(policyNameStats(traceResponse)));
        }
        if (all || config.output.indexOf('traceDetails') > -1) {
            //print("trace details: " + JSON.stringify(traceResponse));
            outputTraceDetails(traceResponse);
        }
        if (all || config.output.indexOf('targets') > -1) {
            print("targets: " + JSON.stringify(targets(traceResponse)));
        }

        if (all || config.output.indexOf('all') > -1) print(JSON.stringify(traceResponse));
    }
};

function targets(tr) {
    var result = [];
    tr.traceFiles.forEach(function(tf) {
        tf.requests.forEach(function(req) {
            if (req.target) {
                req.target.requestWireTime = diffTimeStamps(req.target.requestStart, req.target.requestFinish);
                req.target.responseWireTime = diffTimeStamps(req.target.responseStart, req.target.responseFinish);
                //delete req.target.requestStart;
                //delete req.target.requestFinish;
                //delete req.target.responseStart;
                //delete req.target.responseFinished;
                result.push(req.target);
            }
        });
    });

    return result;
}

function policyCount(tr) {
    var ct = 0;
    tr.traceFiles.forEach(function(tf) {
        tf.requests.forEach(function(req) {
            ct += req.policies.length;
        });
    });
    return ct;
}

function policyTypeStats(tr) {
    var result = {};
    tr.traceFiles.forEach(function(tf) {
        tf.requests.forEach(function(req) {
            req.policies.forEach(function(p) {
                if (!result[p.type]) result[p.type] = {
                    'count': 0,
                    'min': 0,
                    'max': 0,
                    'totalExecutionDurationMs': 0
                };
                if (config.includeDisabled || p.enabled) {
                    result[p.type].count++;
                    result[p.type].totalExecutionDurationMs += p.executionDurationMs;
                    result[p.type].averageExecutionDurationMs = result[p.type].totalExecutionDurationMs / result[p.type].count;
                    if (p.executionDurationMs < result[p.type].min) result[p.type].min = p.executionDurationMs;
                    if (p.executionDurationMs > result[p.type].max) result[p.type].max = p.executionDurationMs;
                }
            });
        });
    });

    return cleanupStats(result);
}

function policyNameStats(tr) {
    var result = {};
    var stats = {};
    try {
        tr.traceFiles.forEach(function(tf) {
            tf.requests.forEach(function(req) {
                req.policies.forEach(function(p) {
                    if (!stats[p.name]) stats[p.name] = new Stats({ bucket_precision: 10 });
                    if (config.includeDisabled || p.enabled) {
                        stats[p.name].push(p.executionDurationMs);
                    }
                });
            });
        });
    } catch (e) {
        print("error in policyNameStats");
        var stack = getStackTrace(e);
        print(JSON.stringify(e));
        print(stack);
    }

    _.forEach(stats, function(stats,policy) {
        var range = stats.range();
        result[policy] = {
            "count": stats.length,
            "min":range[0],
            "max":range[1],
            "averageExecutionDurationMs":stats.μ().toFixed(2),
            "executionσ":stats.σ().toFixed(2)
        };
    });

    return cleanupStats(result);
}

function cleanupStats(result) {
    var key, overAvgThreshold, overMaxThreshold, deleteKey;
    try {
        for (key in result) {
            overAvgThreshold = false;
            overMaxThreshold = false;
            deleteKey = true,
            hasAvgThreshold=('omitAvgThreshold' in config),
            hasMaxThreshold=('omitMaxThreshold' in config);

            //overly expressive for clarity sake

            if (hasAvgThreshold && result[key].averageExecutionDurationMs >= config.omitAvgThreshold) overAvgThreshold = true;
            if (hasAvgThreshold && result[key].max >= config.omitMaxThreshold) overAvgThreshold = true;
            if (hasAvgThreshold && hasMaxThreshold && (overAvgThreshold || overMaxThreshold)) deleteKey = false;
            if (hasAvgThreshold && !hasMaxThreshold && overAvgThreshold) deleteKey = false;
            if (!hasAvgThreshold && hasMaxThreshold && overMaxThreshold) deleteKey = false;

            if (deleteKey) {
                delete result[key];
            } else delete result[key].totalExecutionDurationMs;

        }
    } catch (e) {
        print("error in cleanupStats");
        var stack = getStackTrace(e);
        print(JSON.stringify(e));
        print(stack);
    }
    return result
}


var summarize = function(aConfig) {
    config = aConfig;
    if (config.traceFile) {
        if (config.debug) print("loading xml tracefile");
        try {
            processXMLTraceFiles(config);
        } catch (e) {
            print(JSON.stringify(e));
        }
    }
};

function processXMLTraceFiles(config) {
    var files;
    if (fs.statSync(config.traceFile).isDirectory()) files = getFiles(config.traceFile);
    else files = [config.traceFile];
    files.forEach(function(file) {
        processXMLTraceFile(file, traceResponse);
    });
}

function processXMLTraceFile(file, traceResponse) {
    try {
        traceResponse.curTraceFile[file] = {
            "file": file,
            "requests": []
        };

        var stream = fs.createReadStream(file),
            xml = new XmlStream(stream),
            prevStop;

        xml.preserve('Point', true);
        xml.preserve('DebugInfo', true);
        xml.preserve('Properties', true);
        xml.preserve('Property', true);
        xml.preserve('Headers', true);
        xml.preserve('Header', true);
        xml.collect('Property');
        xml.collect('Headers');
        xml.collect('Header');
        xml.collect('Get');
        xml.collect('Set');

        xml.on('endElement: Point', function(point) {
            try {
                if (isMessageStart(point)) {
                    if (traceResponse.curTraceFile[file].curMessage) traceResponse.curTraceFile[file].requests.push(traceResponse.curTraceFile[file].curMessage);
                    traceResponse.curTraceFile[file].curMessage = getMessage(point);
                } else if (isTargetReqStart(point)) {
                    traceResponse.curTraceFile[file].curMessage.target = getTargetReqStart(point);
                } else if (isTargetReqSent(point)) {
                    var res = getTargetReqSent(point);
                    traceResponse.curTraceFile[file].curMessage.target.requestFinish = res.requestFinished;
                    traceResponse.curTraceFile[file].curMessage.target.requestSize = res.requestSize;
                    traceResponse.curTraceFile[file].curMessage.target.statusCode = res.statusCode;
                } else if (isTargetRespStart(point)) {
                    var res = getTargetRespStart(point);
                    //note that status code can change throught he cycle
                    traceResponse.curTraceFile[file].curMessage.target.responseStart = res.responseStarted;
                    traceResponse.curTraceFile[file].curMessage.target.statusCode = res.statusCode;
                } else if (isTargetRespRecvd(point)) {
                    var res = getTargetRespRecvd(point);
                    traceResponse.curTraceFile[file].curMessage.target.responseFinish = res.responseFinished;
                    traceResponse.curTraceFile[file].curMessage.target.responseSize = res.responseSize;
                    traceResponse.curTraceFile[file].curMessage.target.statusCode = res.statusCode;
                } else if (isFlowChange(point)) {
                    //print("in isFlowChange");
                } else if (isExecution(point)) {
                    if (!traceResponse.curTraceFile[file].curMessage.policies) traceResponse.curTraceFile[file].curMessage.policies = [];
                    traceResponse.curTraceFile[file].curMessage.policies.push(getExecution(point, prevStop));
                }
                if (point.DebugInfo && point.DebugInfo.Timestamp) prevStop = point.DebugInfo.Timestamp.$text;
            } catch (e) {
                var stack = getStackTrace(e);
            }
        });

        xml.on('end', function() {
            if (traceResponse.curTraceFile[file].curMessage) traceResponse.curTraceFile[file].requests.push(traceResponse.curTraceFile[file].curMessage);
            delete traceResponse.curTraceFile[file].curMessage;

            //if (config.debug) print(file + "=\n" + JSON.stringify(traceResponse.curTraceFile[file]));

            traceResponse.traceFiles.push(traceResponse.curTraceFile[file]);
            delete(traceResponse.curTraceFile[file]);
            finish();
        });
    } catch (e) {
        var stack = getStackTrace(e);
        print('error:');
        print(JSON.stringify(e));
        print(stack);

    }
}

function isMessageStart(point) {
    var result = false;
    if (point.$.id === "StateChange") {
        if (point.DebugInfo) {
            point.DebugInfo.Properties.Property.some(function(property) {
                if (property.$.name === "From" && property.$text === "REQ_START") {
                    result = true;
                    return;
                }
            });
        }
    }
    return result;
}

function getMessage(point) {
    var result = {};
    if (point.$.id === "StateChange") {
        if (point.RequestMessage) {
            point.RequestMessage.Headers[0].Header.forEach(function(header) {
                if (header.$.name === "X-Apigee.application") {
                    result.application = header.$text;
                } else if (header.$.name === "X-Apigee.environment") {
                    result.environment = header.$text;
                } else if (header.$.name === "X-Apigee.proxy") {
                    result.proxy = header.$text;
                } else if (header.$.name === "X-Apigee.version") {
                    result.version = header.$text;
                }
            });
        }
    }
    return result;
}

function isTargetReqStart(point) {
    try {
        if (point.$.id === "StateChange" && point.DebugInfo && propertiesContains(point.DebugInfo.Properties.Property, "To", "TARGET_REQ_FLOW")) {
            return true;
        }
    } catch (e) {
        print("error in isTargetRequest");
        print(JSON.stringify(e));
    }
    return false;
}

function isTargetReqSent(point) {
    try {
        if (point.$.id === "StateChange" && point.DebugInfo && propertiesContains(point.DebugInfo.Properties.Property, "To", "REQ_SENT")) {
            return true;
        }
    } catch (e) {
        print("error in isTargetRequest");
        print(JSON.stringify(e));
    }
    return false;
}

function isTargetRespStart(point) {
    try {
        if (point.$.id === "StateChange" && point.DebugInfo && propertiesContains(point.DebugInfo.Properties.Property, "To", "RESP_START")) {
            return true;
        }
    } catch (e) {
        print("error in isTargetRequest");
        print(JSON.stringify(e));
    }
    return false;
}

function isTargetRespRecvd(point) {
    try {
        if (point.$.id === "StateChange" && point.DebugInfo && propertiesContains(point.DebugInfo.Properties.Property, "From", "RESP_START")) {
            return true;
        }
    } catch (e) {
        print("error in isTargetRequest");
        var stack = getStackTrace(e);
        print(JSON.stringify(e));
        print(stack);
    }
    return false;
}

function getStateChangeTDS(point) {
    var result;
    try {
        if (point.$.id === "StateChange") {
            if (point.DebugInfo) {
                result = point.DebugInfo.Timestamp.$text;
            }
        }
    } catch (e) {
        print(JSON.stringify(e));
    }
    return result;
}

function isTargetRequest(point) {
    try {
        if (point.$.id === "FlowInfo" && point.DebugInfo && propertiesContains(point.DebugInfo.Properties.Property, "loadbalancing.targetserver")) {
            return true;
        }
    } catch (e) {
        print("error in isTargetRequest");
        print(JSON.stringify(e));
    }
    return false;
}

function getTargetReqStart(point) {
    var result = {};
    try {
        result.requestStart = point.DebugInfo.Timestamp.$text;
        result.URI = point.RequestMessage.URI.$text;
        result.verb = point.RequestMessage.Verb.$text;
    } catch (e) {
        print(JSON.stringify(e));
    }
    return result;
}

function getTargetReqSent(point) {
    var result = {};
    try {
        result.requestFinished = point.DebugInfo.Timestamp.$text;
        result.requestSize = getHeaderValue(point.ResponseMessage.Headers[0].Header, "Content-Length");
        result.statusCode = point.ResponseMessage.ReasonPhrase.$text;
    } catch (e) {
        print(JSON.stringify(e));
    }
    return result;
}

function getTargetRespStart(point) {
    var result = {};
    try {
        result.responseStarted = point.DebugInfo.Timestamp.$text;
        result.statusCode = point.ResponseMessage.ReasonPhrase.$text;
    } catch (e) {
        print(JSON.stringify(e));
    }
    return result;
}


function getTargetRespRecvd(point) {
    var result = {};
    try {
        result.responseFinished = point.DebugInfo.Timestamp.$text;
        result.responseSize = getHeaderValue(point.ResponseMessage.Headers[0].Header, "Content-Length");
        result.statusCode = point.ResponseMessage.ReasonPhrase.$text;
    } catch (e) {
        print(JSON.stringify(e));
    }
    return result;
}

function isFlowChange(point) {
    var result = false;
    try {
        if (point.$.id === "FlowInfo") {
            if (point.DebugInfo) {
                point.DebugInfo.Properties.Property.some(function(property) {
                    if (property.$.name === "current.flow.name") {
                        result = true;
                        return;
                    }
                });
            }
        }
    } catch (e) {
        var stack = getStackTrace(e);
        print(JSON.stringify(e));
        print(stack);
    }
    return result;
}

function getFlow(point, prevStop) {
    var result;
    try {
        if (point.$.id === "StateChange") {
            if (point.DebugInfo) {
                result.timestamp = point.DebugInfo.Timestamp.$text;
                point.DebugInfo.Properties.Property.some(function(property) {
                    if (property.$.name === "To") {
                        result.to = property.$text;
                        return;
                    }
                });
                //get the timing
                result.executionDurationMs = diffTimeStamps(prevStop, result.timestamp);
            }
        }
    } catch (e) {
        var stack = getStackTrace(e);
        print(JSON.stringify(e));
        print(stack);
    }
    return result;
}

function isExecution(point) {
    return (point.$.id === "Execution");
}

function getExecution(point, prevStop) {
    var result = {};
    try {
        if (point.$.id === "Execution") {
            if (point.DebugInfo) {
                result.timestamp = point.DebugInfo.Timestamp.$text;
                point.DebugInfo.Properties.Property.some(function(property) {
                    if (property.$.name === "type") {
                        result.type = property.$text;
                        return;
                    }
                    if (property.$.name === "stepDefinition-name") {
                        result.name = property.$text;
                        return;
                    }
                    if (property.$.name === "stepDefinition-enabled") {
                        result.enabled = property.$text;
                        return;
                    }
                });
                //get the timing
                result.executionDurationMs = diffTimeStamps(prevStop, result.timestamp);
            }
        }
    } catch (e) {
        var stack = getStackTrace(e);
        print(JSON.stringify(e));
        print(stack);
    }
    return result;
}

function getHeaderValue(headers, name) {
    var result = '';
    try {
        headers.some(function(header) {
            if (header.$.name === name) {
                result = header.$text;
                return;
            }
        });
    } catch (e) {
        print("error in getHeaderValue");
        var stack = getStackTrace(e);
        print(JSON.stringify(e));
        print(stack);
    }
    return result;
}

function propertiesContains(props, name, value) {
    var result = false;
    try {
        props.some(function(property) {
            if (property.$.name === name) {
                if (value) {
                    if (property.$text === value) {
                        result = true;
                    }
                } else {
                    //if we don't have a value to compare to
                    result = true;
                }
                return;
            }
        });
    } catch (e) {
        print("error in propertiesContains");
        var stack = getStackTrace(e);
        print(JSON.stringify(e));
        print(stack);
    }
    return result;
}

function diffTimeStamps(start, stop) {
    //inputs are strings
    //09-11-15 18:23:14:687

    if (!start || !stop) return 'nan';

    var startArray = start.split(':');
    var stopArray = stop.split(':');

    //seconds are in element 2
    //miliseconds in element 3
    return ((stopArray[1] - startArray[1]) * 60000 + (stopArray[2] - startArray[2]) * 1000 + (stopArray[3] - startArray[3]));
}

function getFiles(dir, files_) {
    files_ = files_ || [];
    var files = fs.readdirSync(dir);
    for (var i in files) {
        var name = dir + '/' + files[i];
        if (fs.statSync(name).isDirectory()) {
            getFiles(name, files_);
        } else {
            files_.push(name);
        }
    }
    return files_;
}

function countKeys(obj) {
    if (obj.__count__ !== undefined) { // Old FF
        return obj.__count__;
    }
    if (Object.keys) { // ES5 
        return Object.keys(obj).length;
    }
    // Everything else:
    var c = 0,
        p;
    for (p in obj) {
        if (obj.hasOwnProperty(p)) {
            c += 1;
        }
    }
    return c;
}

function getStackTrace(e) {
    return e.stack.replace(/^[^\(]+?[\n$]/gm, '')
        .replace(/^\s+at\s+/gm, '')
        .replace(/^Object.<anonymous>\s*\(/gm, '{anonymous}()@')
        .split('\n');
}

module.exports = {
    summarize: summarize
};
