"use strict";
var fs = require('fs');
var execSync = require('child_process').execSync;
var path = require('path');

var Branch = /** @class */ (function() {
    function Branch(path, options) {
        this.path = path;
        this.options = options;
    }
    return Branch;
}());

// Function to mount through AUFS.
// Arguments: Array of branches with additional access permissions
// and a destination for the merging of branches
function aufsMount(branches, merged) {
    var command = "sudo mount -t aufs -o br=";
    for (var _i = 0, branches_1 = branches; _i < branches_1.length; _i++) {
        var branch = branches_1[_i];
        if (!fs.existsSync(branch.path)) {
            throw new Error("Invalid path: " + branch.path);
        }
        command += branch.path;
        if (branch.options) {
            command += "=" + branch.options;
        }
        if (branches.indexOf(branch) !== branches.length - 1) {
            command += ":";
        }
    }

    command += " none " + merged;
    execSync(command);
};
// Function that mounts a .img file to a target with extra option of which partition
// to mount
function imgMount(image, target, options) {
    if (!fs.existsSync(image)) {
        throw new Error("Invalid path for image: " + image);
    }
    if (!fs.existsSync(target)) {
        throw new Error("Invalid path for target mount " + target);
    }
    image = path.resolve(image);
    target = path.resolve(target);
    // TODO: Please for the love of god change this
    var mountFile = '/home/stoica/workspace/node-tftp/lib/mount-module/index.sh';
    var command = 'sudo bash ' + mountFile + ' ' + image + ' ' + target;
    if (typeof options !== 'undefined' && options.hasOwnProperty('partition')) {
        command += ' -p ' + options.partition;
    }
    console.log(command);
    execSync(command);
}

function mountPiStretch(image, target) {
    if (!fs.existsSync(image)) {
        throw new Error("Invalid path for image: " + image);
    }
    if (!fs.existsSync(target)) {
        throw new Error("Invalid path for target mount " + target);
    }
    image = path.resolve(image);
    target = path.resolve(target);
    var mountFile = '/home/stoica/workspace/node-tftp/lib/mount-module/index.sh';
    var command = 'sudo bash ' + mountFile + ' ' + image + ' ' + target + ' --partition 2';
    var command2 = 'sudo bash ' + mountFile + ' ' + image + ' ' + target + '/boot';
    execSync(command);
    execSync(command2);
}
module.exports.mountPiStretch = mountPiStretch;
module.exports.aufsMount = aufsMount;
module.exports.imgMount = imgMount;