const crypto = require('crypto');

const contentDigest = (content) => {
  const hash = crypto.createHash('md5');
  hash.update(content);
  const digest = hash.digest('hex');
  return digest;
}

const retryOnFailure = async (fn, { retries = 10, predicate = (err) => true, messageOnFailure = 'Maximum retries reached.' }) => {
  try {
    return await fn();
  } catch (err) {
    if (predicate(err)) {
      if (retries > 0) {
        return await retryOnFailure(fn, { retries: retries - 1, predicate, messageOnFailure });
      } else {
        throw new Error(messageOnFailure);
      }
    } else {
      throw err;
    }
  }
}

const generateThreadId = () => {
  return crypto.randomBytes(32).toString('hex');
}

const parseConfig = (config) => {
  if (typeof config === 'object') {
    return config;
  } else if (typeof config === 'string') {
    try {
      return JSON.parse(config);
    } catch (err) {
      throw new Error('Couldn\'t parse config string.');
    }
  } else {
    throw new Error('Couldn\'t parse config string: it should be an object or a string as found in the Safya cloudformation outputs.');
  }
}

module.exports = {
  contentDigest,
  retryOnFailure,
  generateThreadId,
  parseConfig
};
