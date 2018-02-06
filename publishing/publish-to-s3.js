const { promisifyAll } = require('bluebird');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

const s3 = promisifyAll(new AWS.S3());

const { version } = require('../package');

const exitWithError = (err) => {
  console.error(err);
  process.exitCode = 1;
}

const input = fs.createReadStream(path.resolve(__dirname, '..', 'src', 'stack.yml'));

s3.putObjectAsync({
  Bucket: 'safya',
  Key: `versions/${version}/stack.yml`,
  Body: input
}).catch(exitWithError);
