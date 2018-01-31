const { promisify, promisifyAll } = require('bluebird');
const webpack = promisify(require('webpack'));
const archiver = require('archiver');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');
const log = require('loglevel');
const crypto = require('crypto');
const config = require('./webpack.config');

const build = async () => {
  log.debug('Building');
  const stats = await webpack(config);
  const info = stats.toJson();

  if (stats.hasErrors()) {
    const error = new Error('Compilation failed');
    log.error(info.errors);
    error.errors = info.errors;
    throw error;
  }
}

const DEPLOYMENT_PACKAGE_PATH = path.resolve(__dirname, 'deployment-package.zip');

const package = () => {
  log.debug('Packaging')
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(DEPLOYMENT_PACKAGE_PATH);
    const archive = archiver('zip');

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(path.resolve(__dirname, 'dist'), false);
    archive.finalize();
  });
}

const upload = async (deploymentBucket, packageKey) => {
  log.debug(`Uploading to ${deploymentBucket}, ${packageKey}`);
  const s3 = promisifyAll(new AWS.S3());
  const input = fs.createReadStream(DEPLOYMENT_PACKAGE_PATH);
  const { ETag } = await s3.putObjectAsync({
    Bucket: deploymentBucket,
    Key: packageKey,
    Body: input
  });
  return ETag;
}

const cleanup = () => {
  log.debug('Cleaning up');
  fs.unlinkSync(DEPLOYMENT_PACKAGE_PATH);
}

const getDigest = (file) => {
  const stream = fs.createReadStream(file);
  const hash = crypto.createHash('md5');
  stream.pipe(hash);
  return new Promise((resolve, reject) => {
    hash.on('data', resolve);
    hash.on('error', reject);
  }).then(data => data.toString('hex'));
}

const getPackageHash = () => {
  return getDigest(path.resolve(__dirname, 'dist', 'handler.js'));
}


module.exports = async (deploymentBucket, packageKey) => {
  const previousHash = await getPackageHash();

  await build();

  const currentHash = await getPackageHash();

  if (currentHash === previousHash) {
    return false;
  }

  await package();
  await upload(deploymentBucket, packageKey);

  cleanup();

  return true;
}
