const crypto = require('crypto');
const loglevel = require('loglevel');
const storage = require('./storage');
const { contentDigest, nextHash } = require('./helpers');

class Safya {
  constructor({bucket}) {
    this.bucket = bucket;
  }

  async writeEvent(data) {
    const head = await this.getHead();
    const digest = contentDigest(data);
    const key = `events/${head}/${digest}`;

    await storage.putObject({
      Bucket: this.bucket,
      Key: key,
      Body: 'PENDING'
    });

    const next = nextHash(head);
    await this.commitHead(next);
    await storage.putObject({
      Bucket: this.bucket,
      Key: `events/${head}/NEXT`,
      Body: next
    });

    await storage.putObject({
      Bucket: this.bucket,
      Key: key,
      Body: data
    });
  }

  async getHead() {
    try {
      const obj = await storage.getObject({
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
    await storage.putObject({
      Bucket: this.bucket,
      Key: `events/HEAD`,
      Body: head
    });
  }

  async getTail() {
    return nextHash(this.bucket);
  }
}

module.exports = Safya;
