const crypto = require('crypto');
const loglevel = require('loglevel');
const storage = require('./storage');
const Safya = require('./Safya');
const { contentDigest } = require('./helpers');

class SafyaConsumer {
  constructor({bucket, name}) {
    if (!bucket) {
      throw new Error('Parameter bucket is required');
    }

    if (!name) {
      throw new Error('Parameter name is required');
    }

    this.bucket = bucket;
    this.name = name;
    this.safya = new Safya({bucket});
  }

  async getHead() {
    try {
      const obj = await storage.getObject({
        Bucket: this.bucket,
        Key: `consumers/${this.name}`
      });

      return obj.Body;
    } catch (err) {
      if (err.code === 'NoSuchKey') {
        return this.safya.getTail();
      }
    }
  }

  async commitHead(head) {
    await storage.putObject({
      Bucket: this.bucket,
      Key: `consumers/${this.name}`,
      Body: head
    });
  }

  async readEvents() {
    let position = await this.getHead();
    let events = []

    while (true) {
      const items = await storage.listObjects({
        Bucket: this.bucket,
        Prefix: `events/${position}`
      });

      if (items.Contents.length === 0) {
        break;
      }

      const newEvents = await Promise.all(
        items.Contents.filter((item) =>
          item.Key.split('/').pop() !== 'NEXT'
        ).map((item) => {
          return this.readEvent(item.Key);
        }));

      events.push(newEvents);

      position = await this.getNext(position);

      if (!position) {
        throw new Error('Unexpected lack of next pointer with non-empty dataset.');
      }
    }

    await this.commitHead(position);

    return events;
  }

  async getNext(head) {
    try {
      const next = await storage.getObject({
        Bucket: this.bucket,
        Key: `events/${head}/NEXT`
      });
      return next.Body;
    } catch (err) {
      if (err.code === 'NoSuchKey') {
        return null;
      } else {
        throw err;
      }
    }
  }

  async readEvent(key) {
    const digest = key.split('/').pop();

    try {
      return this.readS3Object({ key, digest });
    } catch (err) {
      if (err.message === 'OBJECT_HASH_MISMATCH') {
        // retry once to allow a current write to finish...
        return this.readS3Object({ key, digest });
      } else {
        throw err;
      }
    }
  }

  async readS3Object({ key, digest }) {
    const obj = await storage.getObject({
      Bucket: this.bucket,
      Key: key
    });

    const md5 = contentDigest(obj.Body);

    if (digest != md5) {
      throw new Error('OBJECT_HASH_MISMATCH');
    } else {
      return obj.Body;
    }
  }
}

module.exports = SafyaConsumer;
