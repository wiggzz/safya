const crypto = require('crypto');
const loglevel = require('loglevel');
const s3 = require('./s3-storage');
const { contentDigest, nextHash, Placeholder } = require('./helpers');

class Safya {
  constructor({bucket, storage = s3, estimatedMaximumWriteTimeMs = 2000}) {
    this.bucket = bucket;
    this.storage = storage;
    this.estimatedMaximumWriteTimeMs = estimatedMaximumWriteTimeMs;
  }

  async writeEvent(data) {
    if (!data instanceof String || !data instanceof Buffer) {
      throw new Error('Event data must either be string or buffer');
    }
    const head = await this.getHead();
    const digest = contentDigest(data);
    const key = `events/${head}/${digest}`;

    await this.storage.putObject({
      Bucket: this.bucket,
      Key: key,
      Body: new Placeholder(this.estimatedMaximumWriteTimeMs).serialize()
    });

    const next = nextHash(head);
    await this.commitHead(next);
    await this.commitNext(head, next);

    await this.storage.putObject({
      Bucket: this.bucket,
      Key: key,
      Body: data
    });
  }

  async getHead() {
    try {
      const obj = await this.storage.getObject({
        Bucket: this.bucket,
        Key: `events/HEAD`
      });

      return obj.Body;
    } catch (err) {
      if (err.code === 'NoSuchKey') {
        return this.getTail();
      } else {
        loglevel.error(err);
        throw err;
      }
    }
  }

  async commitHead(head) {
    await this.storage.putObject({
      Bucket: this.bucket,
      Key: `events/HEAD`,
      Body: head
    });
  }

  async commitNext(current, next) {
    await this.storage.putObject({
      Bucket: this.bucket,
      Key: `events/${current}/NEXT`,
      Body: next
    });
  }

  async getTail() {
    return nextHash(this.bucket);
  }
}

module.exports = Safya;
