const AWS = require('aws-sdk');
const { promisifyAll } = require('bluebird');

const sns = (options) => promisifyAll(new AWS.SNS(options));

module.exports = sns;
