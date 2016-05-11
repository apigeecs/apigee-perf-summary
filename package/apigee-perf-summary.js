// packages
var XmlStream = require("xml-stream"),
    AsciiTable = require("ascii-table"),
    _ = require("lodash"),
    path = require("path"),
    Stats = require("fast-stats").Stats,
    fs = require("fs"),
    Stream = require("stream"),
    https = require("https"),
    traceResponse = {
        "traceFiles": [],
        "curTraceFile": {}
    },
    traceMessages = {},
    config;

function print(msg) {
    try {
        if (msg && (typeof msg === "object")) {
            console.log(JSON.stringify(msg));
        } else {
            console.log(msg);
        }
    } catch (error) {
        console.log(error);
    }
}

function debugPrint(msg) {
    if (config.debug) {
        print(msg);
    }
}

function getStackTrace(e) {
    return e.stack.replace(/^[^\(]+?[\n$]/gm, "")
        .replace(/^\s+at\s+/gm, "")
        .replace(/^Object.<anonymous>\s*\(/gm, "{anonymous}()@")
        .split("\n");
}

function cleanupStats(result) {
    var key, overAvgThreshold, overMaxThreshold, deleteKey, hasAvgThreshold, hasMaxThreshold;
    try {
        for (key in result) {
            if ({}.hasOwnProperty.call(result, key)) {
                overAvgThreshold = false;
                overMaxThreshold = false;
                deleteKey = true,
                    hasAvgThreshold = ("omitAvgThreshold" in config),
                    hasMaxThreshold = ("omitMaxThreshold" in config);

                //overly expressive for clarity sake
                if (hasAvgThreshold && result[key].averageExecutionDurationMs >= config.omitAvgThreshold) {
                    overAvgThreshold = true;
                }
                if (hasAvgThreshold && result[key].max >= config.omitMaxThreshold) {
                    overAvgThreshold = true;
                }
                if (hasAvgThreshold && hasMaxThreshold && (overAvgThreshold || overMaxThreshold)) {
                    deleteKey = false;
                }
                if (hasAvgThreshold && !hasMaxThreshold && overAvgThreshold) {
                    deleteKey = false;
                }
                if (!hasAvgThreshold && hasMaxThreshold && overMaxThreshold) {
                    deleteKey = false;
                }
                if (deleteKey) {
                    delete result[key];
                } else {
                    delete result[key].totalExecutionDurationMs;
                }
            }
        }
    } catch (e) {
        print("error in cleanupStats");
        var stack = getStackTrace(e);
        print(JSON.stringify(e));
        print(stack);
    }
    return result;
}

function policyTypeStats(tr) {
    var result = {};
    tr.traceFiles.forEach(function(tf) {
        tf.requests.forEach(function(req) {
            req.policies.forEach(function(p) {
                result[p.type] = result[p.type] || {
                    "count": 0,
                    "min": 0,
                    "max": 0,
                    "totalExecutionDurationMs": 0
                };

                if (config.includeDisabled || p.enabled) {
                    result[p.type].count++;
                    result[p.type].totalExecutionDurationMs += p.executionDurationMs;
                    result[p.type].averageExecutionDurationMs = result[p.type].totalExecutionDurationMs / result[p.type].count;
                    result[p.type].min = Math.min(p.executionDurationMs, result[p.type].min);
                    result[p.type].max = Math.max(p.executionDurationMs, result[p.type].max);
                }
            });
        });
    });
    return cleanupStats(result);
}

function outputPolciyTypeStats(policytypestats) {
    var table = new AsciiTable("Policy Statistics by Type");

    // this data are calculated, and is guaranteed to be this list (I hope)
    table.setHeading("policy type", "count", "min", "max", "avg");

    // this is the data package values in the order I want to display them
    var dataOrder = ["count", "min", "max", "averageExecutionDurationMs"];

    _.forEach(policytypestats, function(stats, policy) {
        var dataDisplay = [policy];
        _.forEach(dataOrder, function(dataItem) {
            dataDisplay.push(stats[dataItem]);
        });
        table.addRow(dataDisplay);
    });

    print(table.toString());
}

function policyNameStats(tr) {
    var result = {};
    var stats = {};
    try {
        tr.traceFiles.forEach(function(tf) {
            tf.requests.forEach(function(req) {
                req.policies.forEach(function(p) {
                    if (!stats[p.name]) {
                        stats[p.name] = new Stats({
                            bucket_precision: 10
                        });
                    }
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

    _.forEach(stats, function(stats, policy) {
        var range = stats.range();
        result[policy] = {
            "count": stats.length,
            "min": range[0],
            "max": range[1],
            "averageExecutionDurationMs": stats.μ().toFixed(2),
            "executionσ": stats.σ().toFixed(2)
        };
    });
    return cleanupStats(result);
}

function outputTraceDetails(traceDetails) {
    var table = new AsciiTable("Trace Details");
    var items = [];

    // discover the superset of keys in the package.
    _.forEach(traceDetails.traceFiles, function(tracefile) {
        _.forEach(tracefile.requests, function(request) {
            _.forEach(request.policies, function(policy) {
                _.forEach(policy, function(value, key) {
                    if (!_.includes(items, key)) {
                        items.push(key);
                    }
                });
            });
        });
    });

    // build the table header
    table
        .setHeading(["trace file", "application", "env", "proxy"].concat(items));

    // build the table body
    _.forEach(traceDetails.traceFiles, function(tracefile) {
        _.forEach(tracefile.requests, function(request) {
            var section = [path.basename(tracefile.file), request.application, request.environment, request.proxy];
            table.addRow(section);
            _.forEach(request.policies, function(policy) {
                var data = ["", "", "", ""];
                _.forEach(items, function(itemName) {
                    data.push(policy[itemName]);
                });
                table.addRow(data);
            });
        });
    });
    print(table.toString());
}

function outputPolciyNameStats(policynamestats) {
    var table = new AsciiTable("Policy Statistics by Name");

    // this data are calculated, and is guaranteed to be this list (I hope)
    table.setHeading("policy", "count", "min", "max", "avg", "σ");

    // this is the data package values in the order I want to display them
    var dataOrder = ["count", "min", "max", "averageExecutionDurationMs", "executionσ"];

    _.forEach(policynamestats, function(stats, policy) {
        var dataDisplay = [policy];
        _.forEach(dataOrder, function(dataItem) {
            dataDisplay.push(stats[dataItem]);
        });
        table.addRow(dataDisplay);
    });

    print(table.toString());
}

function countEEKeys(obj) {
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

function countKeys(obj) {
    if (typeof obj.__count__ !== "undefined") { // Old FF
        return obj.__count__;
    }
    if (Object.keys) { // ES5 
        return Object.keys(obj).length;
    }
    return countEEKeys(obj);
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

function diffTimeStamps(start, stop) {
    //inputs are strings
    //09-11-15 18:23:14:687

    if (!start || !stop) {
        return "nan";
    }

    var startArray = start.split(":");
    var stopArray = stop.split(":");

    //seconds are in element 2
    //miliseconds in element 3
    return ((stopArray[1] - startArray[1]) * 60000 + (stopArray[2] - startArray[2]) * 1000 + (stopArray[3] - startArray[3]));
}

function targets(tr) {
    var result = [];
    tr.traceFiles.forEach(function(tf) {
        tf.requests.forEach(function(req) {
            if (req.target) {
                req.target.requestWireTime = diffTimeStamps(req.target.requestStart, req.target.requestFinish);
                req.target.responseWireTime = diffTimeStamps(req.target.responseStart, req.target.responseFinish);
                result.push(req.target);
            }
        });
    });

    return result;
}

function finishFileCount(all) {
    if (all || config.output.indexOf("fileCount") > -1) {
        print("processed " + traceResponse.traceFiles.length + " files/messages.");
    }
}

function finishPolicyCount(all) {
    if (all || config.output.indexOf("policyCount") > -1) {
        print("number of policies: " + policyCount(traceResponse));
    }
}

function finishPolicyTypeStats(all) {
    if (all || config.output.indexOf("policyTypeStats") > -1) {
        outputPolciyTypeStats(policyTypeStats(traceResponse));
    }
}

function finishPolicyNameStats(all) {
    if (all || config.output.indexOf("policyNameStats") > -1) {
        outputPolciyNameStats(policyNameStats(traceResponse));
    }
}

function finishTraceDetails(all) {
    if (all || config.output.indexOf("traceDetails") > -1) {
        //print("trace details: " + JSON.stringify(traceResponse));
        outputTraceDetails(traceResponse);
    }
}

function finishTargets(all) {
    if (all || config.output.indexOf("targets") > -1) {
        print("targets: " + JSON.stringify(targets(traceResponse)));
    }
}

function finishAll(all) {
    if (all) {
        print(JSON.stringify(traceResponse));
    }
}

function finish() {
    var ct = countKeys(traceResponse.curTraceFile);
    if (ct === 0) {
        //handle post processing
        var all = (config.output.indexOf("all") > -1);
        finishFileCount(all);
        finishPolicyCount(all);
        finishPolicyTypeStats(all);
        finishPolicyNameStats(all);
        finishTraceDetails(all);
        finishTargets(all);
        finishAll(all);
    }
}

function getFiles(dir, files_) {
    files_ = files_ || [];
    var files = fs.readdirSync(dir);
    for (var i in files) {
        if ({}.hasOwnProperty.call(files, i)) {
            var name = dir + "/" + files[i];
            if (fs.statSync(name).isDirectory()) {
                getFiles(name, files_);
            } else {
                files_.push(name);
            }
        }
    }
    return files_;
}

var mkdirSync = function(path) {
    try {
        fs.existsSync(path) || fs.mkdirSync(path);
    } catch (e) {
        if (e.code !== "EEXIST") {throw e;}
    }
}

var mkdirpSync = function(dirpath) {
    var parts = dirpath.split(path.sep);
    for (var i = 1; i <= parts.length; i++) {
        mkdirSync(path.join.apply(null, parts.slice(0, i)));
    }
}

function writeTraceFile(id, data) {
    //file exists? If not create
    //append to it
    if (config.traceFileCapture) {
        fs.existsSync(config.traceFileCapture) || mkdirpSync(config.traceFileCapture);
        fs.writeFile(config.traceFileCapture + "/" + id + ".xml", data, function(err) {
            if (err) { console.error(err); }
        });
    }
}

function processTraceTransaction(trans) {
    var data = "",
        id = trans.id;

    var options = {
        host: "api.enterprise.apigee.com",
        port: 443,
        path: "/v1/organizations/" + config.org + "/environments/" + config.env + "/apis/" + config.api + "/revisions/" + config.rev + "/debugsessions/" + config.debugSessionId + "/data/" + id,
        method: "GET",
        headers: {
            Accept: "application/xml",
            Authorization: config.auth
        }
    };

    var req = https.request(options, function(res) {
        res.on("data", function(d) {
            data += d;
        });
        res.on("end", function() {
            if (data.indexOf("<Completed>true</Completed>") > -1) {
                trans.inProcess = true;
                processXMLTraceString(id, data);
                trans.processed = true;
                writeTraceFile(id, data);
            } else {
                debugPrint("ignoring " + JSON.stringify(trans) + " will retry later.");
                trans.inProcess = false;
            }
        });
    });

    req.on("error", function(e) {
        print("error in the https call");
        console.error(e);
        trans.processed = false;
    });
    req.end();

}

function uuid() {
    var d = new Date().getTime();
    var theUuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
        var r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);
        return (c === "x" ? r : (r & 0x7 | 0x8)).toString(16);
    });
    return theUuid;
}

function isJson(blob) {
    return (/^[\],:{}\s]*$/.test(blob.replace(/\\["\\\/bfnrtu]/g, "@").replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]").replace(/(?:^|:|,)(?:\s*\[)+/g, "")));
}

function processDebugSession() {
    var options = {
        host: "api.enterprise.apigee.com",
        port: 443,
        path: "/v1/organizations/" + config.org + "/environments/" + config.env + "/apis/" + config.api + "/revisions/" + config.rev + "/debugsessions?session=" + config.debugSessionId,
        method: "POST",
        headers: {
            //Accept: "application/json",
            Authorization: config.auth,
            "Content-Type": "application/x-www-url-form-encoded"
        }
    };

    var req = https.request(options, function(res) {
        res.setEncoding("utf8");
        if (res.statusCode >= 300) {
            console.error(res.statusCode + ": " + res.statusMessage + " with " + JSON.stringify(options));
        }
        res.on("data", function(d) {
            d = JSON.parse(d);
            config.debugSessionId = d.name;
            config.debugStart = new Date();
            //now we want to call the retrieval loop
            processTraceTransactions();
        });
    });

    req.on("error", function(e) {
        console.error(e);
        console.error("error in creating a debug session with " + JSON.stringify(options));
    });
    req.end();
}

function processTraceMessages() {
    for (var id in traceMessages) {
        if ({}.hasOwnProperty.call(traceMessages, id)) {
            if (!traceMessages[id].processed && !traceMessages[id].inProcess) {
                traceMessages[id].inProcess = true;
                processTraceTransaction(traceMessages[id]);

            }
        }
    }
}

function processTransactionPayload(str) {
    var d = JSON.parse(str);
    /*"{
            "code" : "distribution.DebugSessionNotFound",
            "message" : "DebugSession bdbfa0a5-3dc3-4971-edfb-25a277f5d7bd not found",
            "contexts" : [ ]
    }"*/

    if (d.code === "distribution.DebugSessionNotFound" || d.length >= 20 || ((new Date() - config.debugStart) > 10 * 60 * 1000)) {
        config.debugSessionId = uuid();
        processDebugSession();
    } else {
        for (var i = d.length; i-- > 0;) {
            traceMessages[d[i]] = traceMessages[d[i]] || {
                id: d[i],
                processed: false,
                inProcess: false
            };
        }
        processTraceMessages();
        processTraceTransactions();
    }
}

function processTraceTransactions() {
    var options = {
            host: "api.enterprise.apigee.com",
            port: 443,
            path: "/v1/organizations/" + config.org + "/environments/" + config.env + "/apis/" + config.api + "/revisions/" + config.rev + "/debugsessions/" + config.debugSessionId + "/data",
            method: "GET",
            headers: {
                Accept: "application/json",
                Authorization: config.auth
            }
        },
        data = "";

    var req = https.request(options, function(res) {
        res.setEncoding("utf8");
        res.on("data", function(d) {
            data += d;
        });
        res.on("end", function() {
            if (isJson(data)) {
                processTransactionPayload(data);
            } else {
                print("error in the the response - JSON not found");
                print(data);
            }
        });
    });

    req.setTimeout(30000, function() {
        //when timeout, this callback will be called
    });

    req.on("error", function(e) {
        print("error in the https call");
        console.error(e);
    });
    req.end();
}

function buildAuth() {
    var user = process.env.Apigee_User,
        secret = process.env.Apigee_Secret;
    if (!user || !secret) {
        var errMsg = "no authorization provided and no env variable(s) for Apigee_User and/or Apigee_Secret";
        print(errMsg);
        print(process.env);
        throw new Error(errMsg);
    }
    return ("Basic " + (new Buffer(user + ":" + secret)).toString("base64"));
}

var summarize = function(aConfig) {
    config = aConfig;
    try {
        if (config.traceFile) {
            debugPrint("loading xml tracefile");
            processXMLTraceFiles(config);
        } else {
            debugPrint("loading live trace data");
            config.debugSessionId = config.debugSessionId || uuid();
            config.auth = config.auth || buildAuth();
            processDebugSession();
        }
    } catch (e) {
        var stack = getStackTrace(e);
        print("error:");
        print(e);
        print(stack);
    }
};

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

function mapProperty(property, match, result, field) {
    if (property.$.name === match) {
        result[field] = property.$text;
    }
    return result;
}

function getMessage(point) {
    var result = {};
    if (point.$.id === "StateChange") {
        if (point.RequestMessage) {
            point.RequestMessage.Headers[0].Header.forEach(function(header) {
                result = mapProperty(header, "X-Apigee.application", result, "application");
                result = mapProperty(header, "X-Apigee.environment", result, "environment");
                result = mapProperty(header, "X-Apigee.proxy", result, "proxy");
                result = mapProperty(header, "X-Apigee.version", result, "version");
            });
        }
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
                    //if we don"t have a value to compare to
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

/*function getStateChangeTDS(point) {
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
}*/

/*function isTargetRequest(point) {
    try {
        if (point.$.id === "FlowInfo" && point.DebugInfo && propertiesContains(point.DebugInfo.Properties.Property, "loadbalancing.targetserver")) {
            return true;
        }
    } catch (e) {
        print("error in isTargetRequest");
        print(JSON.stringify(e));
    }
    return false;
}*/

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

function getHeaderValue(headers, name) {
    var result = "";
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
            if (point.DebugInfo && point.DebugInfo.Properties && point.DebugInfo.Properties.Property) {
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

/*function getFlow(point, prevStop) {
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
}*/

function isExecution(point) {
    return (point.$.id === "Execution");
}

function getExecution(point, prevStop) {
    var result = {};
    try {
        if (point.$.id === "Execution" && point.DebugInfo) {
            result.timestamp = point.DebugInfo.Timestamp.$text;
            point.DebugInfo.Properties.Property.some(function(property) {
                result = mapProperty(property, "type", result, "type");
                result = mapProperty(property, "stepDefinition-name", result, "name");
                result = mapProperty(property, "stepDefinition-enabled", result, "enabled");
                result = mapProperty(property, "expression", result, "expression");
                result = mapProperty(property, "expressionResult", result, "expressionResult");
            });
            //get the timing
            result.executionDurationMs = diffTimeStamps(prevStop, result.timestamp);
            if (result.expression) {
                result.name += "(cond=" + result.expressionResult + ")";
            }
        }
    } catch (e) {
        var stack = getStackTrace(e);
        print("exception: " + JSON.stringify(e));
        print(stack);
        print(JSON.stringify(point.$));
    }
    return result;
}

function processXMLTraceStream(id, stream) {
    try {
        var xml = new XmlStream(stream),
            prevStop;

        xml.preserve("Point", true);
        xml.preserve("DebugInfo", true);
        xml.preserve("Properties", true);
        xml.preserve("Property", true);
        xml.preserve("Headers", true);
        xml.preserve("Header", true);
        xml.collect("Property");
        xml.collect("Headers");
        xml.collect("Header");
        xml.collect("Get");
        xml.collect("Set");

        xml.on("endElement: Point", function(point) {
            try {
                if (isMessageStart(point)) {
                    if (traceResponse.curTraceFile[id].curMessage) {
                        traceResponse.curTraceFile[id].requests.push(traceResponse.curTraceFile[id].curMessage);
                    }
                    traceResponse.curTraceFile[id].curMessage = getMessage(point);
                } else if (isTargetReqStart(point)) {
                    traceResponse.curTraceFile[id].curMessage.target = getTargetReqStart(point);
                } else if (isTargetReqSent(point)) {
                    var theRes1 = getTargetReqSent(point);
                    traceResponse.curTraceFile[id].curMessage.target.requestFinish = theRes1.requestFinished;
                    traceResponse.curTraceFile[id].curMessage.target.requestSize = theRes1.requestSize;
                    traceResponse.curTraceFile[id].curMessage.target.statusCode = theRes1.statusCode;
                } else if (isTargetRespStart(point)) {
                    var theRes2 = getTargetRespStart(point);
                    //note that status code can change throught he cycle
                    traceResponse.curTraceFile[id].curMessage.target.responseStart = theRes2.responseStarted;
                    traceResponse.curTraceFile[id].curMessage.target.statusCode = theRes2.statusCode;
                } else if (isTargetRespRecvd(point)) {
                    var theRes3 = getTargetRespRecvd(point);
                    traceResponse.curTraceFile[id].curMessage.target.responseFinish = theRes3.responseFinished;
                    traceResponse.curTraceFile[id].curMessage.target.responseSize = theRes3.responseSize;
                    traceResponse.curTraceFile[id].curMessage.target.statusCode = theRes3.statusCode;
                } else if (isFlowChange(point)) {
                    //print("in isFlowChange");
                } else if (isExecution(point)) {
                    if (!traceResponse.curTraceFile[id].curMessage.policies) {
                        traceResponse.curTraceFile[id].curMessage.policies = [];
                    }
                    traceResponse.curTraceFile[id].curMessage.policies.push(getExecution(point, prevStop));
                }
                if (point.DebugInfo && point.DebugInfo.Timestamp) {
                    prevStop = point.DebugInfo.Timestamp.$text;
                }
            } catch (e) {
                var stack = getStackTrace(e);
                print("error:");
                print(e);
                print(stack);
            }
        });

        xml.on("end", function() {
            if (traceResponse.curTraceFile[id].curMessage) {
                traceResponse.curTraceFile[id].requests.push(traceResponse.curTraceFile[id].curMessage);
            }
            delete traceResponse.curTraceFile[id].curMessage;
            traceResponse.traceFiles.push(traceResponse.curTraceFile[id]);
            delete(traceResponse.curTraceFile[id]);
            finish();
        });
    } catch (e) {
        var stack = getStackTrace(e);
        print("error:");
        print(e);
        print(stack);
    }
}

function processXMLTraceFile(file) {
    traceResponse.curTraceFile[file] = {
        file,
        "requests": []
    };
    var stream = fs.createReadStream(file);
    processXMLTraceStream(file, stream);

}

function processXMLTraceFiles(config) {
    var files;
    if (fs.statSync(config.traceFile).isDirectory()) {
        files = getFiles(config.traceFile);
    } else {
        files = [config.traceFile];
    }
    files.forEach(function(file) {
        processXMLTraceFile(file);
    });
}

function processXMLTraceString(id, str) {

    traceResponse.curTraceFile[id] = {
        "file": id,
        "requests": []
    };

    var myStream = new Stream.Readable();
    myStream._read = function noop() {};
    myStream.push(str);
    myStream.push(null);
    processXMLTraceStream(id, myStream);
}

/*function interval(func, wait, times) {
    var interv = (function(w, t) {
        return function() {
            if (typeof t === "undefined" || t-- > 0) {
                setTimeout(interv, w);
                try {
                    func.call(null);
                } catch (e) {
                    t = 0;
                    throw e.toString();
                }
            }
        };
    }(wait, times));

    setTimeout(interv, wait);
}*/

module.exports = {
    summarize
};
