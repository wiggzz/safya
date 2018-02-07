const AWS = require('aws-sdk');
const { promisifyAll } = require('bluebird');

const s3 = (options) => promisifyAll(new AWS.S3(options));

module.exports = s3;
