var tftp = require("./lib/index");
var path = require("path");
var fs = require("fs");
var errors = require("./lib/protocol/errors");

var server = tftp.createServer({
    host: '192.168.2.8',
    root: '/tftpboot',
    class: 'USO'
}, function(req, res) {
    req.on("error", function(error) {
        //Error from the request
        console.error("[" + req.stats.remoteAddress + ":" + req.stats.remotePort +
            "] (" + req.file + ") " + error.message);
    });

    //Call the default request listener
    this.requestListener(req, res);
});

server.on("error", function(error) {
    console.log(error);
});

// When there's a new request for serial_no/start.elf
server.on('newClientRequest', function() {
    console.log('CREATING CLIENT ENVIRONMENT')
    this.createClientEnvironment();
});

server.listen(() => {
    console.log('TFTP Server started');
});