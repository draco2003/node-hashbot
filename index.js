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
        request.post(verifyURL, { form:hash },
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

HashBot.setupCluster = function(files) {
  debug('Setting up Cluster');
  // If enabled display progress count
  HashBot.progressDisplay(files);

  // Start workers and listen for messages
  var numWorkers = conf.get('hashbot:workers') || 1;
  debug('Starting ' + numWorkers + ' hashbot workers');
  _.times(numWorkers,
    function() {
      cluster.fork();
    }
  );

  _.forEach(cluster.workers, function(worker) {
    worker.on('message', function() {
      if (!_.isEmpty(files)) {
        worker.send({
          cmd: 'hashFile',
          file: files.pop()
        });
      } else {
        //Disconnect the workers after we are done processing all files
        //Don't .kill since the requests might be pending in the resquests pool
        debug('killing work: ' + worker.id);
        worker.disconnect();
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
  var options = {
    algorithm: conf.get('hashbot:algorithm') || 'sha1'
  };

  checksum.file(file, options, function (err, hash) {
    if (err) {
      callback(err, null);
    } else {
      callback(null, {key: file, hash: hash});
    }
  });
};

/**
 * Export `HashBot`.
 */

module.exports = HashBot;