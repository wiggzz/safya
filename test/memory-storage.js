const _ = require('lodash');
const log = require('loglevel');
const DATA = {};

const createBucket = async (params) => {
  log.debug('creating bucket', params);
  if (!params.Bucket) throw new Error('Bucket is required');
  DATA[params.Bucket] = {};
}

const getObject = async (params) => {
  log.debug('getting object', params);
  if (!params.Bucket) throw new Error('Bucket is required');
  if (!params.Key) throw new Error('Key is required');

  const object = DATA[params.Bucket][params.Key];
  if (object) {
    return object
  } else {
    const err = new Error('No such key')
    err.code = 'NoSuchKey';
    throw err;
  }
}

const putObject = async (params) => {
  log.debug('putting object', params);
  if (!params.Bucket) throw new Error('Bucket is required');
  if (!params.Key) throw new Error('Key is required');
  if (!params.Body) throw new Error('Body is required');

  DATA[params.Bucket][params.Key] = {
    Body: params.Body
  };
}

const listObjects = async (params) => {
  log.debug('listing objects', params);
  if (!params.Bucket) throw new Error('Bucket is required');
  params.Prefix = params.Prefix || '';

  const Contents = _(DATA[params.Bucket])
    .pickBy((v, k) => k.startsWith(params.Prefix))
    .map((v, k) => ({
      Key: k
    })).value();

  return {
    Contents
  };
}

const deleteObject = async (params) => {
  log.debug('deleting object', params);
  throw new Error('Not implemented');
}

module.exports = {
  getObject,
  putObject,
  listObjects,
  deleteObject,
  createBucket
}
