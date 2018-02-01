const bigInt = require('big-integer');
const crypto = require('crypto');
const log = require('loglevel');
const _ = require('lodash');

const METHOD_MOD = 'mod';

const HIGHEST_SUPPORTED_VERSION = 1;
const SUPPORTED_METHODS = [METHOD_MOD];

class Partitioner {
  constructor({ version = 1, method = METHOD_MOD, partitionCount = 1 } = {}) {
    if (this.version > HIGHEST_SUPPORTED_VERSION) {
      throw new Error(`Please update your Safya SDK to support this Safya stack, requested version (${version}) > highest supported version (${HIGHEST_VERSION}).`);
    }
    if (!_.includes(SUPPORTED_METHODS, method)) {
      throw new Error(`Method '${method}' is not supported. Supported methods: ${_.join(SUPPORTED_METHODS, ', ')}`);
    }

    this.version = version;
    this.method = method;
    this.partitionCount = partitionCount;
  }

  partitionIdForKey(key) {
    if (this.method === METHOD_MOD) {
      const hash = this.hashForKey(key);
      const int = bigInt(hash, 16);
      const partition = int.mod(this.partitionCount);
      return partition.toString();
    } else {
      throw new Error(`Unknown method '${this.method}'.`);
    }
  }

  getPartitionIds() {
    if (this.method === METHOD_MOD) {
      return [...Array(this.partitionCount).keys()].map(e => e.toString());
    } else {
      throw new Error(`Unknown method '${this.method}'.`);
    }
  }

  hashForKey(key) {
    const hash = crypto.createHash('sha256');
    hash.update(key);
    return hash.digest('hex');
  }

  toString() {
    return JSON.stringify({
      version: this.version,
      method: this.method,
      partitionCount: this.partitionCount
    });
  }

  static fromString(str) {
    try {
      const obj = JSON.parse(str);
      return new Partitioner(obj);
    } catch (err) {
      log.debug('partitioner parser error', err);
      throw new Error('Unable to parse Partitioner object from string.');
    }
  }

  isEquivalentTo(otherPartitioner) {
    return this.partitionCount === otherPartitioner.partitionCount
      && this.method === otherPartitioner.method
      && this.version === otherPartitioner.version;
  }
}

module.exports = Partitioner;
