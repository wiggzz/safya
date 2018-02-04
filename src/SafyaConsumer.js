const crypto = require('crypto');
const log = require('loglevel');
const s3 = require('./s3-storage');
const dynamoDb = require('./dynamodb');
const _ = require('lodash');
const Safya = require('./Safya');
const { contentDigest } = require('./helpers');

class SafyaConsumer {
  constructor({
    eventsBucket,
    partitionsTable,
    consumersTable,
    name,
    config = '{}',
    storage = s3,
    lastActiveExpirationMs = 5000
  } = {}) {
    const configObject = JSON.parse(config);

    this.bucket = eventsBucket || configObject.eventsBucket;
    this.consumersTable = consumersTable || configObject.consumersTable;
    this.partitionsTable = partitionsTable || configObject.partitionsTable;
    this.consumerName = name;

    if (!this.bucket) {
      throw new Error('Parameter eventsBucket is required');
    }

    if (!this.consumersTable) {
      throw new Error('Parameter consumersTable is required');
    }

    if (!this.partitionsTable) {
      throw new Error('Parameter partitionsTable is required')
    }

    if (!this.consumerName) {
      throw new Error('Parameter name is required');
    }

    this.storage = storage
    this.lastActiveExpirationMs = lastActiveExpirationMs;
    this.safya = new Safya({
      eventsBucket: this.bucket,
      partitionsTable: this.partitionsTable,
      config,
      storage });
    this.threadId = crypto.randomBytes(32).toString('hex');
  }

  async getPartitionIds() {
    const partitioner = await this.safya.getPartitioner();

    return partitioner.getPartitionIds();
  }

  async getPartitionId({ partitionKey }) {
    return await this.safya.getPartitionId({ partitionKey });
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

  async readEvents({ partitionId, count = 20 } = {}, eventProcessor) {
    const noOpProcessor = () => {};
    const processEvent = eventProcessor || noOpProcessor;

    // i hate exception handling in javascript.
    try {
      const {
        sequenceNumber,
        consumptionCount
      } = await this._withConsumerLock(
        { partitionId, count, processEvent },
        this._readEventsUnsafe.bind(this, { partitionId, count, processEvent })
      );

      const partitionSequenceNumber = await this.safya.getSequenceNumber({ partitionId });
      const eventsRemaining = partitionSequenceNumber ?
        partitionSequenceNumber - sequenceNumber - consumptionCount
        : 0;

      return {
        eventsRead: consumptionCount,
        done: eventsRemaining === 0
      };
    } catch (err) {
      if (err.code === 'ConsumerLockFailedException') {
        return {
          done: true,
          eventsRead: 0
        };
      } else {
        throw err
      }
    }
  }

  async _setSequenceNumber({ partitionId, sequenceNumber }) {
    const params = {
      TableName: this.consumersTable,
      Key: {
        consumerId: this.consumerName,
        partitionId
      },
      UpdateExpression: 'SET sequenceNumber = :sequenceNumber, activeExpiration = :activeExpiration',
      ConditionExpression: 'activeThreadId = :threadId',
      ExpressionAttributeValues: {
        ':activeExpiration': Date.now() + this.lastActiveExpirationMs,
        ':sequenceNumber': sequenceNumber,
        ':threadId': this.threadId
      }
    }

    await dynamoDb.updateAsync(params);
  }

  async _readEventsUnsafe({ partitionId, count, processEvent } = {}) {
    let consumptionCount = 0;
    const sequenceNumber = await this.getSequenceNumber({ partitionId });

    while (consumptionCount < count) {
      const shouldContinue = await this._readOnce({
          partitionId,
          sequenceNumber: sequenceNumber + consumptionCount,
          processEvent
        });

      if (shouldContinue) {
        consumptionCount++;
        await this._setSequenceNumber({ partitionId, sequenceNumber: sequenceNumber + consumptionCount });
      } else {
        break;
      }
    }

    return { sequenceNumber, consumptionCount };
  }

  async _withConsumerLock({ partitionId }, closure) {
    try {
      await this._obtainConsumerLock({ partitionId });
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        log.debug('Couldn\'t obtain consumer lock', this.threadId.slice(0, 6), partitionId);
        const error = new Error('Unable to obtain consumer lock. Another consumer thread is operating on this partition.');
        error.code = 'ConsumerLockFailedException';
        throw error;
      } else {
        throw err;
      }
    }

    log.debug('successfully obtained consumer lock', this.threadId.slice(0, 6), partitionId);

    try {
      return await closure();
    } catch (err) {
      throw err;
    } finally {
      await this._releaseConsumerLock({ partitionId });
    }
  }

  async _obtainConsumerLock({ partitionId }) {
    log.debug('obtaining consumer lock', this.threadId.slice(0, 6), partitionId);
    const now = Date.now();
    const params = {
      TableName: this.consumersTable,
      Key: {
        consumerId: this.consumerName,
        partitionId
      },
      UpdateExpression: 'SET activeThreadId = :threadId, activeExpiration = :activeExpiration',
      ConditionExpression: 'attribute_not_exists(activeThreadId) OR activeExpiration < :timestamp',
      ExpressionAttributeValues: {
        ':threadId': this.threadId,
        ':timestamp': now,
        ':activeExpiration': now + this.lastActiveExpirationMs
      }
    }

    await dynamoDb.updateAsync(params);
  }

  async _releaseConsumerLock({ partitionId }) {
    log.debug('releasing consumer lock', this.threadId.slice(0, 6), partitionId);
    const params = {
      TableName: this.consumersTable,
      Key: {
        consumerId: this.consumerName,
        partitionId
      },
      UpdateExpression: 'REMOVE activeThreadId, activeExpiration',
      ConditionExpression: 'activeThreadId = :threadId',
      ExpressionAttributeValues: {
        ':threadId': this.threadId
      }
    }

    await dynamoDb.updateAsync(params);
  }

  async _readOnce({ partitionId, sequenceNumber, processEvent }) {
    try {
      const event = await this._readEventFromS3({ partitionId, sequenceNumber });

      await processEvent(event);

      return true;
    } catch (err) {
      if (err.code === 'NoSuchKey') {
        const partitionSequenceNumber = await this.safya.getSequenceNumber({ partitionId });
        if (!partitionSequenceNumber || partitionSequenceNumber <= sequenceNumber) {
          log.debug(`${partitionId}:${sequenceNumber} doesn\'t exist yet`);
          return false;
        } else {
          log.warn(`${partitionId}:${sequenceNumber} is corrupted, ignoring it.`);
          return true;
        }
      } else {
        throw err
      }
    }
  }

  async _readEventFromS3({ partitionId, sequenceNumber }) {
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
