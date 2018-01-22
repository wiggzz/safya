const crypto = require('crypto');
const log = require('loglevel');
const s3 = require('./s3-storage');
const _ = require('lodash');
const Safya = require('./Safya');
const { contentDigest, Placeholder } = require('./helpers');

class PendingObjectError extends Error {
  constructor(...args) {
    super(...args)
    this.message = 'An object is pending creation in this frame, please retry reading this frame.'
    Error.captureStackTrace(this, PendingObjectError)
  }
}

class ExpiredPendingObjectError extends Error {
  constructor(...args) {
    super(...args)
    this.message = 'This object doesn\'t exist (it was never written as intended, due to an error).';
    Error.captureStackTrace(this, ExpiredPendingObjectError);
  }
}

class Pointer {
  constructor(position, processed = []) {
    this.position = position;
    this.processed = processed;
  }
}

class ProcessingState {
  constructor(item, success) {
    this.item = item;
    this.success = success;
  }
}

class ProcessingSuccess extends ProcessingState {
  constructor(item) {
    super(item, true);
  }
}

class ProcessingFailure extends ProcessingState {
  constructor(item, error) {
    super(item, false);
    this.error = error;
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

      return JSON.parse(obj.Body.toString());
    } catch (err) {
      if (err.code === 'NoSuchKey') {
        return new Pointer(await this.safya.getTail());
      }
    }
  }

  async commitHead(pointer) {
    await this.storage.putObject({
      Bucket: this.bucket,
      Key: `consumers/${this.name}`,
      Body: JSON.stringify(pointer)
    });
  }

  async readEvents(processEvent, { maxConcurrency, maxRetries = 3, maxFrames } = {}) {
    let pointer = await this.getHead();

    log.debug('pointer', pointer);

    const events = [];
    const defaultProcessor = async (event) => {
      events.push(event);
    }
    processEvent = processEvent || defaultProcessor;

    const failureCounts = {};
    let frameCount = 0;

    while (!maxFrames || frameCount < maxFrames) {
      frameCount++;

      const { Contents } = await this.storage.listObjects({
        Bucket: this.bucket,
        Prefix: `events/${pointer.position}/`
      });

      if (Contents.length === 0) {
        break;
      }

      const processingStates = await Promise.all(
        Contents
          .map(item => item.Key)
          .filter(key =>
            !pointer.processed.includes(key)
          )
          .slice(0, maxConcurrency)
          .map(async key => {
            try {
              const event = await this.readEvent(key);

              await processEvent(event);

              return new ProcessingSuccess(key);
            } catch (err) {
              if (err instanceof ExpiredPendingObjectError) {
                return new ProcessingSuccess(key);
              } else {
                return new ProcessingFailure(key, err);
              }
            }
          })
      );

      processingStates.forEach(state => {
        if (!state.success) {
          failureCounts[state.item] = (failureCounts[state.item] || 0) + 1;
          if (failureCounts[state.item] > maxRetries) {
            throw new Error(`Maximum retries reached for processing item ${state.item}: ${state.error}`);
          }
        }
      });

      pointer = await this.getNext(pointer, processingStates);

      if (!pointer) {
        throw new Error('Unexpected lack of next pointer with non-empty dataset.');
      }

      await this.commitHead(pointer);
    }

    return events;
  }

  async getNext(pointer, processingStates) {
    try {
      const successfulItems = processingStates.filter(s => s.success).map(s => s.item);

      if (successfulItems.length !== processingStates.length) {
        return new Pointer(pointer.position, successfulItems);
      }

      const next = await this.storage.getObject({
        Bucket: this.bucket,
        Key: `events/${pointer.position}.NEXT`
      });

      return new Pointer(next.Body.toString());
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

    const readAndRetryPending = () => {
      return this.readS3Object({ key, digest })
        .catch(err => {
          if (err instanceof PendingObjectError) {
            readAndRetryPending()
          } else {
            throw err;
          }
        });
    }

    return readAndRetryPending();
  }

  async readS3Object({ key, digest }) {
    const obj = await this.storage.getObject({
      Bucket: this.bucket,
      Key: key
    });

    const md5 = contentDigest(obj.Body);

    if (digest != md5) {
      const placeholder = Placeholder.deserialize(obj.Body);
      if (placeholder.isExpired()) {
        throw new ExpiredPendingObjectError();
      } else {
        throw new PendingObjectError();
      }
    } else {
      return obj.Body;
    }
  }
}

module.exports = SafyaConsumer;
