'use strict';

var checksum = require('checksum')
  , debug = require('debug')('hashbot:lib')
  , _ = require('lodash')
  , crypto = require('crypto')
  , request = require('request')
  , conf = require('nconf')
  , cluster = require('cluster');

/**
 * Create HashBot object to hook functions on.
 */

var HashBot = {};

/**
 * Respond to Cluster Master Message.
 * @param {object} msg
 * @api public
 */

HashBot.handleMessage = function(msg, callback) {
  var verifyURL = conf.get('hashbox:host') + conf.get('hashbox:verify');
  if (msg.cmd === 'hashFile') {
    HashBot.processFile(msg.file, function(err, hash) {
      if (err) {
        callback(err, null);
      } else {
        request.post(verifyURL, { form: hash },
          function (err) {
            if (err) {
              callback(err, null);
            } else {
              callback(err, {cmd: 'ready', msg: 'ready'});
            }
          });
      }
    });
  } else {
    callback('invalid msg', null);
  }
};

/**
 * Verify the configured Hashing Algorithm
 *
 * @param {string} algo
 * @api public
 */

HashBot.verifyAlgorithm = function(algo) {
  return _.contains(crypto.getHashes(), algo);
};

/**
 * Verify the HashBox Availability/Health status.
 *
 * @param {function} callback
 * @api public
 */

HashBot.healthCheck = function(callback) {
  var healthURL = conf.get('hashbox:host') + conf.get('hashbox:health');
  request.get(healthURL,
    function (err, res, body) {
      // Catch request errors or non 200 status
      if (err || res.statusCode !== 200) {
        if (!err) {
          err = 'status code error: ' + res.statusCode;
        }
        debug(err);
        debug(body);
        callback(err, null);
      } else {
        callback(err, res);
      }
    });
};

/**
 * Display number of files remaining to be processed
 *
 * @param {array} files
 * @api public
 */

HashBot.progressDisplay = function(files) {
  // If enabled display a progress status to the console
  if (conf.get('progress:display')) {
    var interval = conf.get('progress:interval') || 1000;
    debug('Files to start: ' + files.length);
    setInterval(function() {
      debug('Files left to process: ' + files.length);
      // unref this timer so it doesn't keep the program running
      this.unref();
    }, interval);
  }
};

/**
 * Setup a HashBot Cluster
 *
 * @param {array} files
 * @api public
 */

HashBot.startCluster = function() {
  debug('Setting up Cluster');

  // Start workers and listen for messages
  var numWorkers = conf.get('hashbot:workers') || 1;
  debug('Starting ' + numWorkers + ' hashbot workers');
  _.times(numWorkers,
    function() {
      cluster.fork();
    }
  );

  var scandir = require('scandir').create();
  var files = [];
  var scanComplete = false;
  // If enabled display progress count
  HashBot.progressDisplay(files);

  scandir.on('file', function(file) { files.push(file); });
  scandir.on('error', function(err) { console.error(err); });

  scandir.on('end', function() {
    debug('Scanning Complete');
    scanComplete = true;
  });

  debug('Scanning ' +  conf.get('scandir:filter') + ' files in ' + conf.get('scandir:dir'));
  scandir.scan({
    dir: conf.get('scandir:dir'),
    recursive: conf.get('scandir:recursive'),
    filter: new RegExp(conf.get('scandir:filter'))
  });

  _.forEach(cluster.workers, function(worker) {
    worker.on('message', function() {
      if (!_.isEmpty(files)) {
        worker.send({
          cmd: 'hashFile',
          file: files.pop()
        });
      } else {
        if (scanComplete) {
          worker.send({ cmd: 'shutdown' });
          //Disconnect the workers after we are done processing all files
          //Don't .kill since the requests might be pending in the requests pool
          debug('killing work: ' + worker.id);
          //worker.disconnect();
        } else {
          debug('scan not complete');
        }
      }
    });
  });
};

/**
 * Hash a given file.
 *
 * @param {string} file
 * @param {function} callback
 * @api public
 */

HashBot.processFile = function(file, callback) {
  var options = { algorithm: conf.get('hashbot:algorithm') };
  var location = conf.get('hashbot:location') || 'default';
  checksum.file(file, options, function (err, hash) {
    if (err) {
      callback(err, null);
    } else {
      callback(null, {key: location + ':' + file, hash: hash});
    }
  });
};


/**
 * Spin up a HashBot Worker.
 *
 * @api public
 */

HashBot.worker = function() {
  var processFile = false;
  var heartbeatInterval = 10000;

  debug('Starting Worker:' + cluster.worker.id);
  process.send({cmd: 'ready', msg: 'ready'});

  // Handle scandir delays by letting master know we are available
  setInterval(function(){
    // Don't send the worker heartbeat if we are currently working on hashing a file
    if (processFile === false) {
      process.send({cmd: 'still_ready', msg: 'ready'});
    }
  }, heartbeatInterval);

  process.on('message', function(msg) {
    if (msg.cmd === 'hashFile') {
      processFile = true;
      HashBot.handleMessage(msg, function(err, resMsg) {
        processFile = false;
        process.send(resMsg);
      });
    } else if ( msg.cmd === 'shutdown') {
      debug('shutting down');
      process.exit();
    }
  });
};

/**
 * Export `HashBot`.
 */

module.exports = HashBot;