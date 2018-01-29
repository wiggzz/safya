const crypto = require('crypto');
const log = require('loglevel');
const s3 = require('./s3-storage');
const dynamoDb = require('./dynamodb');
const { contentDigest, nextHash, Placeholder } = require('./helpers');

class Safya {
  constructor({ eventsBucket, partitionsTable, storage = s3 }) {
    this.bucket = eventsBucket;
    this.storage = storage;
    this.partitionsTable = partitionsTable;
  }

  async writeEvent(partitionKey, data) {
    if (!data instanceof String || !data instanceof Buffer) {
      throw new Error('Event data must either be string or buffer');
    }

    const partitionId = 'dummy'; // 1 partition for now

    const sequenceNumber = await this.reserveSequenceNumber({ partitionId });

    const key = `events/${partitionId}/${sequenceNumber}`;

    await this.storage.putObjectAsync({
      Bucket: this.bucket,
      Key: key,
      Body: data
    });

    return key;
  }

  async reserveSequenceNumber({ partitionId, retries = 10 }) {
    try {
      const sequenceNumber = await this.getSequenceNumber({ partitionId });
      await this.incrementSequenceNumber({ partitionId, sequenceNumber });
      return sequenceNumber || 0;
    } catch (err) {
      log.debug(err);
      if (err.code === 'ConditionalCheckFailedException') {
        if (retries > 0) {
          return this.reserveSequenceNumber({ partitionId, retries: retries - 1 });
        } else {
          throw new Error('Unable to obtain a sequence number, maximum retries reached');
        }
      } else {
        throw err;
      }
    }
  }

  async getSequenceNumber({ partitionId }) {
    const params = {
      TableName: this.partitionsTable,
      Key: {
        partitionId
      }
    };

    const { Item } = await dynamoDb.getAsync(params);

    console.log('partition info', Item);

    if (Item) {
      return Item.sequenceNumber;
    }

    return undefined;
  }

  async incrementSequenceNumber({ partitionId, sequenceNumber }) {
    if (sequenceNumber !== undefined) {
      const params = {
        TableName: this.partitionsTable,
        Key: {
          partitionId
        },
        UpdateExpression: 'set sequenceNumber = sequenceNumber + :ONE',
        ConditionExpression: 'sequenceNumber = :CURRENT',
        ExpressionAttributeValues: {
          ':CURRENT': sequenceNumber,
          ':ONE': 1
        }
      }
      log.debug('update params', params);

      await dynamoDb.updateAsync(params);
    } else {
      await this.initializeSequenceNumber({ partitionId });
    }
  }

  async initializeSequenceNumber({ partitionId }) {
    const params = {
      TableName: this.partitionsTable,
      Key: {
        partitionId
      },
      ConditionExpression: 'attribute_not_exists(partitionId)',
      Item: {
        partitionId,
        sequenceNumber: 0
      }
    };
    await dynamoDb.putAsync(params);
  }
}

module.exports = Safya;
