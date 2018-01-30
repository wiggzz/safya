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
        return await retryOnFailure(fn, { retries: retries - 1, predicate });
      } else {
        throw new Error(messageOnFailure);
      }
    } else {
      throw err;
    }
  }
}

module.exports = {
  contentDigest,
  retryOnFailure
};
