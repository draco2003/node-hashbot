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
 * Hash a given file and send the results to #Box
 *
 * @param {string} msg        : an object with cmd and optional file and msg properties
 * @param {function} callback : passes back the message to be sent to the master process
 * @api public
 */

HashBot.processFile = function(msg, callback) {
  var verifyURL = conf.get('hashbox:host') + conf.get('hashbox:verify');
  var options = { algorithm: conf.get('hashbot:algorithm') };
  var location = conf.get('hashbot:location') || 'default';
  checksum.file(msg.file, options, function (err, hash) {
    if (err) {
      callback(err, null);
    } else {
      var postData = {key: location + ':' + msg.file, hash: hash};
      request.post(verifyURL, { form: postData },
        function (err) {
          if (err) {
            callback(err, null);
          } else {
            callback(err, {cmd: 'ready', msg: 'ready'});
          }
        });
    }
  });
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
 * @param {function} callback : passes back the request response
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
    console.log('Files to start: ' + files.length);
    setInterval(function() {
      console.log('Files left to process: ' + files.length);
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

  // Catch invalid algorithm before processing files.
  if (!HashBot.verifyAlgorithm(conf.get('hashbot:algorithm'))) {
    console.error('Please choose a valid Hashing Algorithm');
    process.exit(1);
  }

  HashBot.healthCheck(function(err) {
    if (err){
      console.error('Healthcheck Failed, process exiting');
      process.exit(1);
    } else {
      // Start workers and listen for messages
      var numWorkers = conf.get('hashbot:workers') || 1;
      debug('Starting ' + numWorkers + ' hashbot workers');
      _.times(numWorkers,
        function() {
          cluster.fork();
        }
      );

      var scandir = require('scandir').create()
        , files = []
        , scanComplete = false;

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
              debug('killing worker: ' + worker.id);
              worker.send({ cmd: 'shutdown' });
            } else {
              debug('scan not complete');
            }
          }
        });
      });
    }
  });
};

/**
 * Spin up a HashBot Worker.
 *
 * @api public
 */

HashBot.startWorker = function() {
  var processingFile = false;
  var heartbeatInterval = 10000;

  debug('Starting Worker:' + cluster.worker.id);
  process.send({cmd: 'ready', msg: 'ready'});

  // Handle scandir delays by letting master know we are available
  setInterval(function(){
    // Don't send the worker heartbeat if we are currently working on hashing a file
    if (processingFile === false) {
      process.send({cmd: 'still_ready', msg: 'ready'});
    }
    this.unref();
  }, heartbeatInterval);

  process.on('message', function(msg) {
    if (msg.cmd === 'hashFile') {
      processingFile = true;
      HashBot.processFile(msg, function(err, resMsg) {
        processingFile = false;
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