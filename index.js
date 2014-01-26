var cluster = require('cluster')
  , debug = require('debug')('hashbot:cluster')
  , conf = require('nconf')
  , env = process.env.NODE_ENV || 'development';

conf.add( env , { type: 'file', file: __dirname + '/config/' + env + '.json' });
conf.add('all', { type: 'file', file: __dirname + '/config/global.json' });

//For testing you can use this to fill the hashbox with hashes.
//var hashbox_url = nconf.get("hashbox:host") + nconf.get("create");
var hashbox_url = conf.get("hashbox:host") + conf.get("hashbox:verify");

if (cluster.isMaster) {
  var scandir = require('scandir').create()
    , files = [];

  scandir.on('file', function(file, stats) {
    files.push(file);
  });

  scandir.on('error', function(err){
    console.error(err);
  });

  scandir.on('end', function(){
    // Start workers and listen for messages containing notifyRequest
    var numWorkers = conf.get("hash:threads") || require('os').cpus().length;
    for (var i = 0; i < numWorkers; i++) {
      cluster.fork();
    }

    // If enabled display a progress status to the console
    if (conf.get('progress:display')) {
      var interval = conf.get('progress:interval') || 1000;
      console.log("files to process", files.length);
      setInterval(function() {
        var files_left = files.length;
        if (files_left === 0) {
          clearInterval(this);
        } else {
          console.log("files remaining", files.length);
        }
      }, interval);
    }

    Object.keys(cluster.workers).forEach(function(id) {
      cluster.workers[id].on('message', function(worker) {
        if (files.length > 0) {
          var next_file = files.pop();
          cluster.workers[id].send({
            cmd: 'hashFile',
            data: next_file
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
  var checksum = require('checksum')
    , request = require('request');

  process.send({cmd: "ready", msg: "ready"});
  process.on('message', function(msg) {
    if (msg.cmd === 'hashFile') {
      process_file(msg.data, function(err, hash) {
        if (err) {
          console.log(err);
        } else {
          debug(JSON.stringify(hash));
          send_results(hash, function(err, response) {
            if (err) {
              //console.log(err);
            }
          });
        }
        process.send({cmd: "ready", msg: "ready"});
      });
    }
  });

  function process_file(file, callback) {
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

  function send_results(hash, callback) {
    request.post(hashbox_url, { form:hash },
      function (err, response, body) {
        if (err) {
          console.log(err);
        }
        callback(err, response.toJSON());
    });
  }
}
