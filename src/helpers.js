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

class Placeholder {
  constructor(expirationTimeoutMs) {
    this.expiration = Date.now() + expirationTimeoutMs;
  }

  serialize() {
    return JSON.stringify({
      status: 'PENDING',
      expiration: this.expiration
    });
  }

  static deserialize(data) {
    const payload = JSON.parse(data);
    if (payload.status === 'PENDING') {
      const placeholder = new Placeholder();
      placeholder.expiration = payload.expiration;
      return placeholder;
    } else {
      throw new Error('Unable to deserialize placeholder');
    }
  }

  isExpired() {
    return Date.now() < this.expiration;
  }
}

module.exports = {
  contentDigest,
  nextHash,
  Placeholder,
};
