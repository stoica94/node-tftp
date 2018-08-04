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
var copydir = require("copy-dir");
var mount = require('./mount-module');
var stream = require('stream');

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

    // The class for which the Raspberry's Boot
    this.class = options.class;

    this._port = options.port;
    this._closed = false;
    this._currFiles = {
        get: {},
        put: {}
    };
    this.mountedPis = {};

    // Store the ID of Raspberry Pi clients that made requests
    this.raspClients = [];

    //Current Raspberry Pi making requests
    this.currentRaspClient = '';

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


util.inherits(Server, events.EventEmitter);

Server.prototype.close = function() {
    if (this._closed) return;
    this._closed = true;
    //Stop the main socket from accepting new connections
    this._socket.close();
};

Server.prototype.listen = function(cb) {
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
    cb();
};

Server.prototype.sanitizeFile = function(filename) {

    // Check if request is for serial_no/start.elf
    // If request matches, it means there is a new Raspberry making requests
    var matched = filename.match(/[0-9a-f]{8}\/start.elf$/g);

    if (matched) {
        this.currentRaspClient = path.dirname(filename);
        this.emit('newClientRequest');
    }
    return filename.split('/').slice(1).join('');

}

// Creates the AUFS fileSystem that the Raspberry client mounts
// The base image is mounted to nfs/client1 from the Raspbian Stretch base .img
Server.prototype.createClientEnvironment = function() {

    // TODO: Make .env variables for paths
    var clientSystem = '/nfs/' + this.currentRaspClient;
    if (fs.existsSync(clientSystem)) {
        var files = fs.readdirSync(clientSystem);
        if (files.length !== 0) return; // System already built
    } else {
        fs.mkdirSync(clientSystem);
    }


    // [TESTING] The user to be mounted will be passed by the main server
    var currentUser = 'voche';
    if (!fs.existsSync('/pi_users/' + currentUser)) {
        currentUser = 'pi';
    }

    var currentClass = '/classes/' + this.class;
    if (!fs.existsSync(currentClass)) {
        var currentClass = '/classes/default_class';
    }

    var files = fs.readdirSync('/images/stretch');

    var fileSystemBranches = [{ path: '/images/stretch', options: 'ro' },
        { path: '/pi_users/' + currentUser },
        { path: currentClass, options: 'ro' }
    ];

    // If /nfs/client1 is not mounted mount the image partitions
    if (files.length === 0) {
        var img = '/home/stoica/Desktop/2018-06-27-raspbian-stretch-lite.img';
        var dest = '/images/stretch';
        var dest2 = '/images/stretch/boot';
        console.log(dest2);
        mount.imgMount(img, dest, { partition: '2' });
        mount.imgMount(img, dest2);

        console.log('Finished mounting partition');

        console.log('Mounting AUFS file system...');
        mount.aufsMount(fileSystemBranches, clientSystem);
        this.mountedPis[this.currentRaspClient] = this.currentUser;
        console.log('Finished mounting AUFS file system');
    } else {

        console.log('Mounting AUFS file system...');
        mount.aufsMount(fileSystemBranches, clientSystem);
        this.mountedPis[this.currentRaspClient] = this.currentUser;
        console.log('Finished mounting AUFS file system');
    }

}

Server.prototype.requestListener = function(req, res) {
    if (this._closed) return;
    if (req._listenerCalled || req._aborted) return;
    req._listenerCalled = true;

    // Remove pi_serial_number from the filename
    // Setting the current Raspberry client that makes requests
    var filename = this.root + "/" + this.sanitizeFile(req.file);

    var method = (req.method === "GET") ? "GET" : "PUT";

    console.log("Got " + method + " request for file " + req.file + ".");


    // Calls appropriate function 
    if (req.method === "GET") {
        this._get(filename, req, res);
    } else {
        this._put(filename, req);
    }
};

Server.prototype._get = function(filename, req, res) {

    // If file is cmdline.txt serve a custom one to tell Raspberry board 
    // from where to mount the file system
    if (filename === this.root + '/cmdline.txt') {
        console.log('GENERATING CMDLINE.TXT for', this.currentRaspClient);
        var customCmdline = 'dwc_otg.lpm_enable=0 console=serial0,115200 console=tty1 root=/dev/nfs nfsroot=192.168.2.8:';
        customCmdline += '/nfs/' + this.currentRaspClient + ',';
        customCmdline += 'vers=3 rw ip=dhcp rootwait elevator=deadline';
        console.log(customCmdline);
        var s = new stream.Readable();
        s.push(customCmdline);
        s.push(null);

        console.log("Sending file " + filename + ".");
        res.setSize(customCmdline.length);
        s.pipe(res);

    } else {

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

            console.log("Sending file " + filename + ".");
            res.setSize(stats.size);
            rs.pipe(res);
        });
    }
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

    console.log("Receiving file " + filename + '.');
    req.pipe(ws);
};