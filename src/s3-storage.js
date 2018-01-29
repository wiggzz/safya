const AWS = require('aws-sdk');
const { promisifyAll } = require('bluebird');

const s3 = promisifyAll(new AWS.S3());

module.exports = s3;
