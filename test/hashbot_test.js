var assert = require('assert')
  , nock = require('nock')
  , conf = require('nconf')
  , qs = require('querystring')
  , HashBot = require('..');

//Pull in example config
conf.add('all', { type: 'file', file: __dirname + '/../example.config.json' });

//Disable Network Requets for tests
nock.disableNetConnect();

//Uncomment below and comment out above when adding new tests to get example request code snippet
//nock.recorder.rec();

var testFile = './test/fixtures/testfile.txt'
  , testFileHash = '0b26e313ed4a7ca6904b0e9369e5b957'
  , testLocation = conf.get('hashbot:location')
  , testFileKey = testLocation + ":" + testFile
  , testFilePost = qs.stringify({ key: testFileKey, hash: testFileHash})
  , hashboxURL = conf.get("hashbox:host")
  , hashboxVerify = conf.get("hashbox:verify")
  , hashboxHealth = conf.get("hashbox:health");

var healthCheck_404 = nock(hashboxURL).get(hashboxHealth).reply(404);
var healthCheck_200 = nock(hashboxURL).get(hashboxHealth).reply(200);

var handleMessage_testfile = nock(hashboxURL)
  .post(hashboxVerify, testFilePost)
  .reply(400, '{ "status": "failure", "data": "Hash not accepted, doesn\'t exist" }');

describe('HashBot', function() {
  describe('healthCheck', function() {
    it('should handle 404', function(done) {
      HashBot.healthCheck(function(err, res) {
        assert.equal(res, null);
        assert.equal(err, 'status code error: 404');
        done();
      });
    });
    it('should handle 200', function(done) {
      HashBot.healthCheck(function(err, res) {
        assert.equal(res.statusCode, 200);
        assert.equal(err, null);
        done();
      });
    });
  });

  describe('verifyAlgorithm', function() {
    it('handle valid algorithm', function() {
      var valid_algo = HashBot.verifyAlgorithm('md5');
      assert.equal(valid_algo, true);
    });
    it('handle invalid algorithm', function() {
      var invalid_algo = HashBot.verifyAlgorithm('noshuchalgo');
      assert.equal(invalid_algo, false);
    });
  });

  describe('processFile', function() {
    it('should hash test file', function(done) {
      HashBot.processFile({msg: 'hashFile', file: testFile }, function(err, resMsg) {
        assert.equal(err, null);
        assert.equal(resMsg.cmd, 'ready');
        assert.equal(resMsg.msg, 'ready');
        done();
      });
    });
    it('should error on handle missing file', function(done) {
      HashBot.processFile({msg: 'hashFile', file: './nosuchfile' }, function(err, resMsg) {
        // Errno 34 is no such file
        assert.equal(err.errno, "34");
        assert.equal(resMsg, null);
        done();
      });
    });
  });
});