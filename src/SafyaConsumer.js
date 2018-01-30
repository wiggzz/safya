const crypto = require('crypto');
const log = require('loglevel');
const s3 = require('./s3-storage');
const dynamoDb = require('./dynamodb');
const _ = require('lodash');
const Safya = require('./Safya');
const { contentDigest } = require('./helpers');

class SafyaConsumer {
  constructor({ eventsBucket, partitionsTable, consumersTable, name, storage = s3 }) {
    if (!eventsBucket) {
      throw new Error('Parameter eventsBucket is required');
    }

    if (!name) {
      throw new Error('Parameter name is required');
    }

    this.storage = storage
    this.bucket = eventsBucket;
    this.consumerName = name;
    this.partitionTable = partitionsTable;
    this.consumersTable = consumersTable;
    this.safya = new Safya({ eventsBucket, partitionsTable, storage });
  }

  async getPartitionIds() {
    const partitioner = await this.safya.getPartitioner();

    return partitioner.getPartitionIds();
  }

  async getSequenceNumber({ partitionId }) {
    const params = {
      TableName: this.consumersTable,
      Key: {
        consumerId: this.consumerName,
        partitionId
      }
    };

    const { Item } = await dynamoDb.getAsync(params);

    if (Item && Item.sequenceNumber) {
      return Item.sequenceNumber;
    }

    return 0;
  }

  async setSequenceNumber({ partitionId, sequenceNumber }) {
    const params = {
      TableName: this.consumersTable,
      Item: {
        consumerId: this.consumerName,
        partitionId,
        sequenceNumber
      }
    }

    await dynamoDb.putAsync(params);
  }

  async readEvents({ partitionId, eventProcessor, count = 20 } = {}) {
    const sequenceNumber = await this.getSequenceNumber({ partitionId });
    // TODO - record that we are active on this partition

    log.debug('sequence number', sequenceNumber);

    const events = [];
    const defaultProcessor = async (event) => {
      events.push(event);
    }
    const processEvent = eventProcessor || defaultProcessor;

    let step;
    for (step = 0; step < count; step++) {
      const shouldContinue = await this.readOnce({
        partitionId,
        sequenceNumber: sequenceNumber + step,
        processEvent
      });

      if (!shouldContinue) { break; }
    }

    await this.setSequenceNumber({ partitionId, sequenceNumber: sequenceNumber + step});

    return events;
  }

  async readOnce({ partitionId, sequenceNumber, retries = 3, processEvent }) {
    try {
      const event = await this.readEventFromS3({ partitionId, sequenceNumber });

      await processEvent(event);

      return true;
    } catch (err) {
      if (err.code === 'NoSuchKey') {
        log.debug(`seq. no. ${sequenceNumber} doesn\'t exist yet`);
        return false;
      } else {
        log.debug(err);
        if (retries > 0) {
          return this.readOnce({ partitionId, sequenceNumber, retries: retries - 1, processEvent });
        } else {
          throw err;
        }
      }
    }
  }

  async readEventFromS3({ partitionId, sequenceNumber }) {
    const key = `events/${partitionId}/${sequenceNumber}`;

    log.debug('s3 get object', key, 'from bucket', this.bucket);
    const obj = await this.storage.getObjectAsync({
      Bucket: this.bucket,
      Key: key
    });

    return obj.Body;
  }
}

module.exports = SafyaConsumer;
