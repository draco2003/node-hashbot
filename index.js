'use strict';

var cluster = require('cluster')
  , checksum = require('checksum')
  , debug = require('debug')('hashbot:cluster')
  , conf = require('nconf')
  , env = process.env.NODE_ENV || 'development';

conf.add( env , { type: 'file', file: __dirname + '/config/' + env + '.json' });
conf.add('all', { type: 'file', file: __dirname + '/config/global.json' });

//For testing you can use this to fill the hashbox with hashes.
//var hashbox_url = nconf.get("hashbox:host") + nconf.get("create");
var hashboxURL = conf.get('hashbox:host') + conf.get('hashbox:verify');

if (cluster.isMaster) {
  var scandir = require('scandir').create()
    , files = [];

  scandir.on('file', function(file) {
    files.push(file);
  });

  scandir.on('error', function(err){
    console.error(err);
  });

  scandir.on('end', function(){
    // Start workers and listen for messages containing notifyRequest
    var numWorkers = conf.get('hash:threads') || require('os').cpus().length;
    for (var i = 0; i < numWorkers; i++) {
      cluster.fork();
    }

    // If enabled display a progress status to the console
    if (conf.get('progress:display')) {
      var interval = conf.get('progress:interval') || 1000;
      console.log('files to process', files.length);
      setInterval(function() {
        var filesLeft = files.length;
        if (filesLeft === 0) {
          clearInterval(this);
        } else {
          console.log('files remaining', files.length);
        }
      }, interval);
    }

    Object.keys(cluster.workers).forEach(function(id) {
      cluster.workers[id].on('message', function() {
        if (files.length > 0) {
          var nextFile = files.pop();
          cluster.workers[id].send({
            cmd: 'hashFile',
            data: nextFile
          });
        } else {
          //Disconnect the workers after we are done processing all files
          //Don't .kill since the requests might be pending in the resquests pool
          debug('killing work: ' + id);
          cluster.workers[id].disconnect();
        }
      });
    });
  });

  scandir.scan({
    dir: conf.get('scandir:dir'),
    recursive: conf.get('scandir:recursive'),
    filter: new RegExp(conf.get('scandir:filter'))
  });

} else {
  // Only the works need these and this creates a new request pool per worker.
  var request = require('request');

  process.send({cmd: 'ready', msg: 'ready'});
  process.on('message', function(msg) {
    if (msg.cmd === 'hashFile') {
      processFile(msg.data, function(err, hash) {
        if (err) {
          console.log(err);
        } else {
          debug(JSON.stringify(hash));
          request.post(hashboxURL, { form:hash },
            function (err, response, body) {
              if (err) {
                console.log(err);
                console.log(response);
                console.log(body);
              }
              process.send({cmd: 'ready', msg: 'ready'});
            });
        }
      });
    }
  });
}

function processFile(file, callback) {
  debug('file:' + file);
  var options = {
    algorithm: conf.get('hash:algorithm') || 'sha1'
  };

  checksum.file(file, options, function (err, hash) {
    if (err) {
      console.log(err);
    }
    callback(err, {key: file, hash: hash});
  });
}