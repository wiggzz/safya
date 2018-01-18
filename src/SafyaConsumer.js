const crypto = require('crypto');
const loglevel = require('loglevel');
const s3 = require('./s3-storage');
const Safya = require('./Safya');
const { contentDigest } = require('./helpers');

class PendingObjectError extends Error {
  constructor(...args) {
    super(...args)
    this.message = 'An object is pending creation in this frame, please retry reading this frame.'
    Error.captureStackTrace(this, PendingObject)
  }
}

class SafyaConsumer {
  constructor({bucket, name, storage = s3}) {
    if (!bucket) {
      throw new Error('Parameter bucket is required');
    }

    if (!name) {
      throw new Error('Parameter name is required');
    }

    this.storage = storage
    this.bucket = bucket;
    this.name = name;
    this.safya = new Safya({bucket, storage});
  }

  async getHead() {
    try {
      const obj = await this.storage.getObject({
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

  async commitHead(position) {
    await this.storage.putObject({
      Bucket: this.bucket,
      Key: `consumers/${this.name}`,
      Body: position
    });
  }

  async readEvents() {
    let position = await this.getHead();
    let events = []

    while (true) {
      const { Contents } = await this.storage.listObjects({
        Bucket: this.bucket,
        Prefix: `events/${position}`
      });

      if (Contents.length === 0) {
        break;
      }

      const newEvents = await Promise.all(
        Contents.filter((item) =>
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

  async getNext(position) {
    try {
      const next = await this.storage.getObject({
        Bucket: this.bucket,
        Key: `events/${position}/NEXT`
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
      if (err instanceof PendingObjectError) {
        // retry once to allow a current write to finish...
        return this.readS3Object({ key, digest });
      } else {
        throw err;
      }
    }
  }

  async readS3Object({ key, digest }) {
    const obj = await this.storage.getObject({
      Bucket: this.bucket,
      Key: key
    });

    const md5 = contentDigest(obj.Body);

    if (digest != md5 && obj.Body === 'PENDING') {
      throw new PendingObjectError();
    } else {
      return obj.Body;
    }
  }
}

module.exports = SafyaConsumer;
