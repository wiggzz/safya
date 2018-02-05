const { promisifyAll } = require('bluebird');
const AWS = require('aws-sdk');

const s3 = promisifyAll(new AWS.S3());

const { version } = require('../package');

const exitWithError = (err) => {
  console.error(err);
  process.exitCode = 1;
}

s3.putObjectAsync({
  Bucket: 'safya',
  Key: `versions/${version}/stack.yml`
}).catch(exitWithError);
