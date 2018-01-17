const crypto = require('crypto');

const contentDigest = (content) => {
  const hash = crypto.createHash('md5');
  hash.update(content);
  const digest = hash.digest('hex');
  return digest;
}

const nextHash = (current) => {
  const hash = crypto.createHash('sha256');
  hash.update(current);
  return hash.digest('hex');
}

module.exports = {
  contentDigest,
  nextHash
};
