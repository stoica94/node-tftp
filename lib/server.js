"use strict";

var util = require("util");
var events = require("events");
var dgram = require("dgram");
var fs = require("fs");
var path = require("path");
var net = require("net");
var createOptions = require("./create-options");
var GetStream = require("./streams/server/get-stream");
var PutStream = require("./streams/server/put-stream");
var Helper = require("./protocol/request").Helper;
var errors = require("./protocol/errors");
var opcodes = require("./protocol/opcodes");

var Server = module.exports = function(options, listener) {
    events.EventEmitter.call(this);

    if (arguments.length === 0) {
        options = {};
    } else if (typeof options === "function") {
        listener = options;
        options = {};
    }

    options = createOptions(options, true);
    this.on("request", listener || this.requestListener);

    this.root = options.root;

    this._port = options.port;
    this._closed = false;
    this._currFiles = {
        get: {},
        put: {}
    };

    var address = options.address;
    if (options.address === "localhost") {
        //IPv4 if localhost
        address = "127.0.0.1";
    }
    var family = net.isIP(address);
    if (!family) throw new Error("Invalid IP address (server)");

    this.host = options.address;
    this.port = options.port;

    var me = this;
    this._socket = dgram.createSocket("udp" + family)
        .on("error", function(error) {
            //The current transfers are not aborted, just wait till all of them
            //finish (unlocking the event loop and finishing the process)
            //The user also can cache the requests an abort them manually
            me.emit("error", error);
        })
        .on("close", function() {
            me.emit("close");
        })
        .on("message", function(message, rinfo) {
            //Create a new socket for communicating with the client, the main socket
            //only listens to new requests
            var helper = new Helper(rinfo, family);

            if (message.length < 9 || message.length > 512) {
                //2 op, at least 1 filename, 4 mode mail, 2 NUL
                //Max 512
                return helper.sendErrorAndClose(errors.EBADMSG);
            }

            //Check if it's RRQ or WRQ
            var op = message.readUInt16BE(0);

            if (op === opcodes.RRQ) {
                if (options.denyGET) {
                    return helper.sendErrorAndClose(errors.ENOGET);
                }

                var gs = new GetStream();
                var ps = new PutStream(me._currFiles, helper, message, options, gs);
                ps.onReady = function() {
                    me.emit("request", gs, ps);
                };
            } else if (op === opcodes.WRQ) {
                if (options.denyPUT) {
                    return helper.sendErrorAndClose(errors.ENOPUT);
                }

                var ps = new PutStream();
                var gs = new GetStream(me._currFiles, helper, message, options, ps);
                gs.onReady = function() {
                    me.emit("request", gs, ps);
                };
            } else {
                return helper.sendErrorAndClose(errors.EBADOP);
            }
        });
};

// Copy a file from source to target
function copyFile(source, target, cb) {
    var cbCalled = false;

    var rd = fs.createReadStream(source);
    rd.on("error", function(err) {
        done(err);
    });
    var wr = fs.createWriteStream(target);
    wr.on("error", function(err) {
        done(err);
    });
    wr.on("close", function(ex) {
        done();
    });
    rd.pipe(wr);

    function done(err) {
        if (!cbCalled) {
            cb(err);
            cbCalled = true;
        }
    }
}

util.inherits(Server, events.EventEmitter);

Server.prototype.close = function() {
    if (this._closed) return;
    this._closed = true;
    //Stop the main socket from accepting new connections
    this._socket.close();
};

Server.prototype.listen = function() {
    var me = this;
    //Validate the root directory
    fs.stat(this.root, function(error, stats) {
        if (error) return me.emit("error", error);
        if (!stats.isDirectory()) return me.emit("error", new Error("The root " +
            "is not a directory"));

        me._socket.bind(me.port, me.host, function() {
            me.emit("listening");
        });
    });
};

Server.prototype.requestListener = function(req, res) {
    if (this._closed) return;
    if (req._listenerCalled || req._aborted) return;
    req._listenerCalled = true;

    var filename = this.root + "/" + req.file;

    // Check if request is for serial_no/start.elf
    var matched = filename.match(/[0-9a-f]{8}\/start.elf$/g);

    if (matched) {
        var serial_no = this.root + "/" + matched[0];
    }

    // Create personal directory if it doesn't exist
    if (serial_no === filename) {
        console.log(serial_no);
        var serial_dir = path.dirname(serial_no);
        console.log(serial_dir);
        if (!fs.existsSync(serial_dir)) {
            fs.mkdirSync(serial_dir);
        }
        var start_elf = this.root + "/start.elf";
        if (!fs.existsSync(serial_no)) {
            copyFile(start_elf, serial_no, function(err) {
                if (err) {
                    console.log(err);
                }
                console.log("Copied start.elf to " + serial_no);
            });
        }
    }

    if (req.method === "GET") {
        this._get(filename, req, res);
    } else {
        this._put(filename, req);
    }
};

// /[0-9a-f]{8}\/start.elf$/g 
Server.prototype._get = function(filename, req, res) {

    fs.stat(filename, function(error, stats) {
        if (error) {
            req.on("abort", function() {
                req.emit("error", error);
            });
            var msg;
            if (error.code === "EACCESS" || error.code === "EPERM") {
                msg = errors.EACCESS.message;
            } else if (error.code === "ENOENT") {
                msg = errors.ENOENT.message;
            } else {
                msg = errors.EIO.message;
            }
            req.abort(msg);
            return;
        }

        var aborted = false;

        var rs = fs.createReadStream(filename)
            .on("error", function(error) {
                req.on("abort", function() {
                    aborted = true;
                    req.emit("error", error);
                });
                req.abort(errors.ENOENT.message);
            });

        req.on("error", function() {
            //Error from the rs
            if (aborted) return;
            rs.destroy();
        });

        res.setSize(stats.size);
        rs.pipe(res);
    });
};

Server.prototype._put = function(filename, req) {
    var open = false;
    var aborted = false;
    var destroy = false;

    req.on("error", function() {
        //Error from the ws
        if (aborted) return;
        if (open) {
            ws.on("close", function() {
                fs.unlink(filename, function() {});
            });
            ws.destroy();
        } else {
            destroy = true;
        }
    });

    var ws = fs.createWriteStream(filename)
        .on("error", function(error) {
            req.on("abort", function() {
                fs.unlink(filename, function() {
                    aborted = true;
                    req.emit("error", error);
                });
            });
            var msg;
            if (error.code === "EACCESS" || error.code === "EPERM") {
                msg = errors.EACCESS.message;
            } else {
                msg = errors.EIO.message;
            }
            req.abort(msg);
        })
        .on("open", function() {
            if (destroy) {
                ws.on("close", function() {
                    fs.unlink(filename, function() {});
                });
                ws.destroy();
            } else {
                open = true;
            }
        });

    req.pipe(ws);
};