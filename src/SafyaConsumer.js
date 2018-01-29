const crypto = require('crypto');
const log = require('loglevel');
const s3 = require('./s3-storage');
const dynamoDb = require('./dynamodb');
const _ = require('lodash');
const Safya = require('./Safya');
const { contentDigest } = require('./helpers');

class SafyaConsumer {
  constructor({eventsBucket, partitionsTable, consumersTable, name, storage = s3}) {
    if (!eventsBucket) {
      throw new Error('Parameter bucket is required');
    }

    if (!name) {
      throw new Error('Parameter name is required');
    }

    this.storage = storage
    this.bucket = eventsBucket;
    this.consumerName = name;
    this.partitionTable = partitionsTable;
    this.consumersTable = consumersTable;
    this.safya = new Safya({bucket, partitionsTable, storage});
  }

  async getSequenceNumber({ partitionId }) {
    const params = {
      TableName: this.consumersTable,
      Key: {
        partitionId,
        consumerId: this.consumerId
      }
    };

    const { Item } = await dynamoDb.get(params);

    if (Item) {
      return Item.sequenceNumber;
    }

    return 0;
  }

  async setSequenceNumber({ partitionId, sequenceNumber }) {
    const params = {
      TableName: this.consumersTable,
      Item: {
        partitionId,
        consumerId: this.consumerId,
        sequenceNumber
      }
    }

    await dynamoDb.put(params);
  }

  async readEvent({ partitionId, eventProcessor } = {}) {
    let sequenceNumber = await this.getSequenceNumber({ partitionId });

    log.debug('sequence number', sequenceNumber);

    const events = [];
    const defaultProcessor = async (event) => {
      events.push(event);
    }
    const processEvent = eventProcessor || defaultProcessor;

    const event = await this.readEvent({ partitionId, sequenceNumber });

    await processEvent(event);

    await this.setSequenceNumber({ partitionId, sequenceNumber});

    return events;
  }

  async readEvent({ partitionId, sequenceNumber }) {
    const key = `/events/${partitionId}/${sequenceNumber}`;

    const obj = await this.storage.getObject({
      Bucket: this.bucket,
      Key: key
    });

    return obj.Body;
  }
}

module.exports = SafyaConsumer;
