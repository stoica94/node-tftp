var mount = require('./mount-commands');
var img = '/home/stoica/Desktop/2018-06-27-raspbian-stretch-lite.img';
var dest = './test';
mount.aufsMount([{ path: "/tmp/pi_img", options: "rw" }, { path: '/nfs/client1' }], '/tmp/aufs_pi_img');
mount.imgMount(img, dest, { partition: '2' });
