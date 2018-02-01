const crypto = require('crypto');
const log = require('loglevel');
const s3 = require('./s3-storage');
const dynamoDb = require('./dynamodb');
const _ = require('lodash');
const Safya = require('./Safya');
const { contentDigest } = require('./helpers');

class SafyaConsumer {
  constructor({ eventsBucket, partitionsTable, consumersTable, name, storage = s3, lastActiveExpirationMs = 5000 } = {}) {
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
    this.lastActiveExpirationMs = lastActiveExpirationMs;
    this.safya = new Safya({ eventsBucket, partitionsTable, storage });
    this.threadId = crypto.randomBytes(32).toString('hex');
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

  async readEvents({ partitionId, count = 20 } = {}, eventProcessor) {
    // i hate exception handling in javascript.
    try {
      return await this.withConsumerLock({ partitionId }, async () => {

        const sequenceNumber = await this.getSequenceNumber({ partitionId });

        log.debug('sequence number', sequenceNumber);

        const noOpProcessor = () => {};
        const processEvent = eventProcessor || noOpProcessor;

        let consumptionCount = 0;
        while (consumptionCount < count) {
          const shouldContinue = await this.readOnce({
              partitionId,
              sequenceNumber: sequenceNumber + consumptionCount,
              processEvent
            });

          if (shouldContinue) {
            consumptionCount++;
            await this.setSequenceNumber({ partitionId, sequenceNumber: sequenceNumber + consumptionCount });
          } else {
            break;
          }
        }

        const partitionSequenceNumber = await this.safya.getSequenceNumber({ partitionId });

        return {
          eventsRemaining: partitionSequenceNumber - sequenceNumber - consumptionCount
        };
      });
    } catch (err) {
      if (err.code === 'ConsumerLockFailedException') {
        return [];
      } else {
        throw err;
      }
    }
  }

  async withConsumerLock({ partitionId }, closure) {
    try {
      await this.obtainConsumerLock({ partitionId });
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
      await this.releaseConsumerLock({ partitionId });
    }
  }

  async obtainConsumerLock({ partitionId }) {
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

  async releaseConsumerLock({ partitionId }) {
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

  async readOnce({ partitionId, sequenceNumber, retries = 3, processEvent }) {
    try {
      const event = await this.readEventFromS3({ partitionId, sequenceNumber });

      await processEvent(event);

      return true;
    } catch (err) {
      if (err.code === 'NoSuchKey') {
        const partitionSequenceNumber = await this.safya.getSequenceNumber({ partitionId });
        if (partitionSequenceNumber <= sequenceNumber) {
          log.debug(`${partitionId}:${sequenceNumber} doesn\'t exist yet`);
          return false;
        } else {
          log.warn(`${partitionId}:${sequenceNumber} is corrupted, ignoring it.`);
          return true;
        }
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
