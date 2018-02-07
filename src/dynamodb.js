const AWS = require('aws-sdk');
const { promisifyAll } = require('bluebird');

const dynamoDb = (options) => promisifyAll(new AWS.DynamoDB.DocumentClient(options));

module.exports = dynamoDb;
