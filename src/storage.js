const AWS = require('aws-sdk');
const log = require('loglevel');

const s3 = new AWS.S3();

const getObject = (params) => {
  return new Promise((resolve, reject) => {
    log.debug('getting object', params);
    s3.getObject(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

const putObject = (params) => {
  return new Promise((resolve, reject) => {
    log.debug('putting object', params);
    s3.putObject(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

const listObjects = (params) => {
  return new Promise((resolve, reject) => {
    log.debug('listing objects', params);
    s3.listObjects(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

const deleteObject = (params) => {
  return new Promise((resolve, reject) => {
    log.debug('deleting object', params);
    s3.deleteObject(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

module.exports = {
  getObject,
  putObject,
  listObjects,
  deleteObject
}
