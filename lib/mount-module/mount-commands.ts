var fs = require('fs');
var execSync = require('child_process').execSync;
var path = require('path');

class Branch {
    path: String;
    options? : String;
    constructor (path: String, options?: String) {
        this.path = path;
        this.options = options;
    }
}

// Function to mount through AUFS.
// Arguments: Array of branches with additional access permissions
// and a destination for the merging of branches
export function aufsMount(branches: Branch[], merged: string) {
    var command: string = "sudo mount -t aufs -o br=";
    for (var _i = 0, branches_1 = branches; _i < branches_1.length; _i++) {
        var branch = branches_1[_i];
        if (!fs.existsSync(branch.path)) {
            throw new Error(`Invalid path: ${branch.path}`);
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
    console.log(command);
    execSync(command);
};

// Function that mounts a .img file to a target with extra option of which partition
// to mount
export function imgMount(image: String, target: String, options: any) {
    if (!fs.existsSync(image)) {
        throw new Error(`Invalid path for image: ${image}`);
    }
    if (!fs.existsSync(target)) {
        throw new Error(`Invalid path for target mount ${target}`);
    }

    image = path.resolve(image);
    target = path.resolve(target);




    // TODO: Please for the love of god change this
    var mountFile = '/home/stoica/workspace/node-tftp/lib/mount-module/index.sh';




    var command: String = 'sudo bash ' + mountFile + ' ' + image + ' ' + target;
    
    if (typeof options !== 'undefined' && options.hasOwnProperty('partition')) {
        command += ' -p ' + options.partition;
    }

    console.log(command);

    execSync(command);
}

export function mountPiStretch(image: String, target: String){
    if (!fs.existsSync(image)) {
        throw new Error(`Invalid path for image: ${image}`);
    }
    if (!fs.existsSync(target)) {
        throw new Error(`Invalid path for target mount ${target}`);
    }

    image = path.resolve(image);
    target = path.resolve(target);


    var mountFile = '/home/stoica/workspace/node-tftp/lib/mount-module/index.sh';


    var command: String = 'sudo bash ' + mountFile + ' ' + image + ' ' + target + ' --partition 2';
    var command2: String = 'sudo bash ' + mountFile + ' ' + image + ' ' + target + '/boot';
    execSync(command);
    execSync(command2);
}
