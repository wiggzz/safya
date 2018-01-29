const crypto = require('crypto');
const loglevel = require('loglevel');
const s3 = require('./s3-storage');
const dynamoDb = require('./dynamodb');
const { contentDigest, nextHash, Placeholder } = require('./helpers');

class Safya {
  constructor({ bucket, partitionsTable, storage = s3 }) {
    this.bucket = bucket;
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

    await this.storage.putObject({
      Bucket: this.bucket,
      Key: key,
      Body: data
    });

    return key;
  }

  async reserveSequenceNumber({ partitionId, retries = 3 }) {
    try {
      const sequenceNumber = await this.getSequenceNumber({ partitionId });
      await this.incrementSequenceNumber({ partitionId, sequenceNumber });
      return sequenceNumber;
    } catch (err) {
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

    const { Item } = await dynamoDb.get(params);

    if (Item) {
      return Item.sequenceNumber;
    }

    return 0;
  }

  async incrementSequenceNumber({ partitionId, sequenceNumber }) {
    const params = {
      TableName: this.partitionsTable,
      Key: {
        partitionId
      },
      UpdateExpression: 'set sequenceNumber = sequenceNumber + 1',
      ConditionExpression: 'sequenceNumber = :CURRENT',
      ExpressionAttributeValues: {
        ':CURRENT': sequenceNumber
      }
    }

    await dynamoDb.update(params);
  }
}

module.exports = Safya;
