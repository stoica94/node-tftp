var tftp = require("./lib/index");
var path = require("path");
var fs = require("fs");
var errors = require("./lib/protocol/errors");

var server = tftp.createServer({
        host: "192.168.2.8",
        root: "/tftpboot"
    })
    /*, function(req, res) {
    if (path.dirname(req.file) !== this.root) return req.abort("Invalid path");
    if (this._closed) return;
    if (req._listenerCalled || req._aborted) return;
    req._listenerCalled = true;

    var filename = path.resolve(this.root, req.file);

    if (req.method === "GET") {
        console.log("[Custom] Got GET request for " + req.file);
        // GET 
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
    } else {
        // PUT
        console.log("[Custom] Got PUT request for " + req.file);
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
    }
});
*/

server.on("error", function(error) {
    console.log(error);
});

server.on("request", function(req, res) {
    req.on("error", function(error) {
        //Error from the request
        //The connection is already closed
        console.error("[" + req.stats.remoteAddress + ":" + req.stats.remotePort +
            "] (" + req.file + ") " + error.message);
    });
    console.log("We got request for file " + req.file);
});

server.listen();
console.log("TFTP Server started on port " + server.port);