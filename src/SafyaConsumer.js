const crypto = require('crypto');
const log = require('loglevel');
const s3 = require('./s3');
const dynamoDb = require('./dynamodb');
const _ = require('lodash');
const Safya = require('./Safya');
const { contentDigest, generateThreadId } = require('./helpers');
const Locker = require('./Locker');

class SafyaConsumer {
  constructor({
    eventsBucket,
    partitionsTable,
    consumersTable,
    name,
    config = '{}',
    storage = s3,
    database = dynamoDb,
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

    this.storage = storage;
    this.database = database;
    this.safya = new Safya({
      eventsBucket: this.bucket,
      partitionsTable: this.partitionsTable,
      config,
      storage });
    this.locker = new Locker({ tableName: this.consumersTable, lockExpirationTimeMs: lastActiveExpirationMs });
  }

  async getPartitionIds() {
    const partitioner = await this.safya.getPartitioner();

    return partitioner.getPartitionIds();
  }

  async getPartitionId({ partitionKey }) {
    return await this.safya.getPartitionId({ partitionKey });
  }

  async skipToEnd({ partitionId }) {
    await this.locker.withLock({ partitionId, consumerId: this.consumerName }, async () => {
      const sequenceNumber = await this.safya.getSequenceNumber({ partitionId });
      await this._setSequenceNumber({ partitionId, sequenceNumber });
    });
  }

  async getSequenceNumber({ partitionId }) {
    log.debug('getting consumer sequence number', partitionId);
    const params = {
      TableName: this.consumersTable,
      Key: {
        consumerId: this.consumerName,
        partitionId
      }
    };

    const { Item } = await this.database.getAsync(params);

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
      } = await this.locker.withLock(
        { partitionId, consumerId: this.consumerName },
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
      if (err.code === Locker.LockFailedExceptionCode) {
        return {
          done: true,
          eventsRead: 0
        };
      } else {
        log.debug('error reading events', err);
        throw err
      }
    }
  }

  async _setSequenceNumber({ partitionId, sequenceNumber }) {
    log.debug(`setting sequence number ${partitionId}:${sequenceNumber}`);
    const params = {
      TableName: this.consumersTable,
      Key: {
        consumerId: this.consumerName,
        partitionId
      },
      UpdateExpression: 'SET sequenceNumber = :sequenceNumber, #lock = :lock',
      ConditionExpression: '#lock.threadId = :threadId',
      ExpressionAttributeValues: {
        ':sequenceNumber': sequenceNumber,
        ':threadId': this.locker.threadId,
        ':lock': {
          threadId: this.locker.threadId,
          expiration: Date.now() + this.locker.lockExpirationTimeMs
        }
      },
      ExpressionAttributeNames: {
        '#lock': 'lock'
      }
    }

    await this.database.updateAsync(params);
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
        log.debug('Error reading from S3', err);
        throw err;
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
