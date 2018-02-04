const AWS = require('aws-sdk');
const { promisifyAll } = require('bluebird');

const sns = promisifyAll(new AWS.SNS());

module.exports = sns;
