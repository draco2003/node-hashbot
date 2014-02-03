var assert = require('assert')
  , nock = require('nock')
  , conf = require('nconf')
  , HashBot = require('..');

//Pull in example config
conf.add('all', { type: 'file', file: __dirname + '/../example.config.json' });

//Disable Network Requets for tests
nock.disableNetConnect();

//Uncomment below and comment out above when adding new tests to get example request code snippet
//nock.recorder.rec();

var testfile = './test/fixtures/testfile.txt';

var healthCheck_404 = nock('http://127.0.0.1:9999')
                  .get('/api/health')
                  .reply(404);

var healthCheck_200 = nock('http://127.0.0.1:9999')
                  .get('/api/health')
                  .reply(200);

var handleMessage_testfile = nock('http://127.0.0.1:9999')
  .post('/api/hash_verify', "key=.%2Ftest%2Ffixtures%2Ftestfile.txt&hash=0b26e313ed4a7ca6904b0e9369e5b957")
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
      HashBot.processFile(testfile ,function(err, hash) {
        assert.equal(err, null);
        assert.equal(hash.hash, "0b26e313ed4a7ca6904b0e9369e5b957");
        assert.equal(hash.key, testfile);
        done();
      });
    });
    it('should error on handle missing file', function(done) {
      HashBot.processFile('./nosuchfile', function(err, hash) {
        // Errno 34 is no such file
        assert.equal(err.errno, "34");
        assert.equal(hash, null);
        done();
      });
    });
  });

  describe('handleMessage', function() {
    it('should handle non-command msg', function(done) {
      HashBot.handleMessage({msg: 'somemsg'} ,function(err, response) {
        assert.equal(err, 'invalid msg');
        assert.equal(response, null);
        done();
      });
    });
    it('should handle valid msg', function(done) {
      HashBot.handleMessage({cmd: 'hashFile', file: testfile} ,function(err, res) {
        assert.equal(err, null);
        assert.equal(res.cmd, 'ready');
        assert.equal(res.msg, 'ready');
        done();
      });
    });
  });
});