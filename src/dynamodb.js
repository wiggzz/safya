const AWS = require('aws-sdk');
const { promisifyAll } = require('bluebird');

const dynamoDb = promisifyAll(new AWS.DynamoDB.DocumentClient());

module.exports = dynamoDb;
