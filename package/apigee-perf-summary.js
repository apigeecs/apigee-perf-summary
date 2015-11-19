var variables = {},
    proxyResponse,
    results = {},
    traceSets = [],
    fs = require('fs'),
    xml2js = require('xml2js'),
    colors = require('colors'),
    XmlStream = require('xml-stream'),
    traceResponse = {
        "traceFiles": [],
        "curTraceFile": {}
    },
    config;


print = function(msg) {
    console.log(msg);
};

finish = function() {
    var ct = countKeys(traceResponse.curTraceFile);
    if (ct === 0) {
        //handle post processing
        var all = (config.output.indexOf('fileCount') > -1);

        if (all || config.output.indexOf('fileCount') > -1) print("processed " + traceResponse.traceFiles.length + " files.");
        if (all || config.output.indexOf('policyCount') > -1) {
            print("number of policies: " + policyCount(traceResponse));
        }
        if (all || config.output.indexOf('policyTypeStats') > -1) {
            print("statistics by policy type: " + JSON.stringify(policyTypeStats(traceResponse)));
        }
        if (all || config.output.indexOf('policyNameStats') > -1) {
            print("statistics by policy name: " + JSON.stringify(policyNameStats(traceResponse)));
        }
        if (all || config.output.indexOf('traceDetails') > -1) {
            print("trace details: " + JSON.stringify(traceResponse));
        }

        if (all || config.output.indexOf('all') > -1) print(JSON.stringify(traceResponse));
    }
};

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
    tr.traceFiles.forEach(function(tf) {
        tf.requests.forEach(function(req) {
            req.policies.forEach(function(p) {
                if (!result[p.name]) result[p.name] = {
                    'count': 0,
                    'min': 0,
                    'max': 0,
                    'totalExecutionDurationMs': 0
                };
                if (config.includeDisabled || p.enabled) {
                    result[p.name].count++;
                    result[p.name].totalExecutionDurationMs += p.executionDurationMs;
                    result[p.name].averageExecutionDurationMs = result[p.name].totalExecutionDurationMs / result[p.name].count;
                    if (p.executionDurationMs < result[p.name].min) result[p.name].min = p.executionDurationMs;
                    if (p.executionDurationMs > result[p.name].max) result[p.name].max = p.executionDurationMs;
                }
            });
        });
    });

    return cleanupStats(result);
}

function cleanupStats(result) {
    var key, overAvgThreshold, overMaxThreshold, deleteKey;
    for (key in result) {
        overAvgThreshold = false;
        overMaxThreshold = false;
        deleteKey = true;

        //overly expressive for clarity sake
        if (config.omitAvgThreshold && result[key].averageExecutionDurationMs >= config.omitAvgThreshold) overAvgThreshold = true;
        if (config.omitMaxThreshold && result[key].max >= config.omitMaxThreshold) overAvgThreshold = true;
        if (config.omitAvgThreshold && config.omitMaxThreshold && (overAvgThreshold || overMaxThreshold)) deleteKey = false;
        if (config.omitAvgThreshold && !config.omitMaxThreshold && overAvgThreshold) deleteKey = false;
        if (!config.omitAvgThreshold && config.omitMaxThreshold && overMaxThreshold) deleteKey = false;

        if (deleteKey) delete result[key];
        else delete result[key].totalExecutionDurationMs;
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
                } else if (isTargetRequest(point)) {
                    if (!traceResponse.curTraceFile[file].curMessage.targets) traceResponse.curTraceFile[file].curMessage.targets = [];
                    traceResponse.curTraceFile[file].curMessage.targets.push(getTargetRequest(point, prevStop));
                } else if (isFlowChange(point)) {
                    //print("in isFlowChange");
                } else if (isExecution(point)) {
                    if (!traceResponse.curTraceFile[file].curMessage.policies) traceResponse.curTraceFile[file].curMessage.policies = [];
                    traceResponse.curTraceFile[file].curMessage.policies.push(getExecution(point, prevStop));
                }
                if (point.DebugInfo && point.DebugInfo.Timestamp) prevStop = point.DebugInfo.Timestamp.$text;
            } catch (e) {
                var stack = e.stack.replace(/^[^\(]+?[\n$]/gm, '')
                    .replace(/^\s+at\s+/gm, '')
                    .replace(/^Object.<anonymous>\s*\(/gm, '{anonymous}()@')
                    .split('\n');
                print('error:');
                print(JSON.stringify(e));
                print(stack);

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
        var stack = e.stack.replace(/^[^\(]+?[\n$]/gm, '')
            .replace(/^\s+at\s+/gm, '')
            .replace(/^Object.<anonymous>\s*\(/gm, '{anonymous}()@')
            .split('\n');
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

function isTargetRequest(point) {
    try {
        if (point.$.id === "StateChange" && point.DebugInfo && propertiesContains(point.DebugInfo.Properties.Property, "From", "REQ_SENT")) {
            return true;
        }
    } catch (e) {
        print("error in isTargetRequest");
        print(JSON.stringify(e));
    }
    return false;
}

function isTargetFlow(point) {
    try {
        if (point.$.id === "StateChange" && point.DebugInfo && propertiesContains(point.DebugInfo.Properties.Property, "From", "REQ_SENT")) {
            return true;
        }
    } catch (e) {
        print("error in isTargetRequest");
        print(JSON.stringify(e));
    }
    return false;
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

function getTargetRequest(point) {
    var result = {};
    try {
        if (point.$.id === "FlowInfo") {
            if (point.DebugInfo) {
                result.timestamp = point.DebugInfo.Timestamp.$text;
                point.DebugInfo.Properties.Property.some(function(property) {
                    if (property.$.name === "loadbalancing.targetserver") {
                        result.name = property.$text;
                        return;
                    }
                });
            }
        }
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
        print(JSON.stringify(e));
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
        print(JSON.stringify(e));
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
        print(JSON.stringify(e));
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
        print(JSON.stringify(e));
    }
    return result;
}

function diffTimeStamps(start, stop) {
    //inputs are strings
    //09-11-15 18:23:14:687

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

module.exports = {
    summarize: summarize
};
