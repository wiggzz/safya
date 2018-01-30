const crypto = require('crypto');
const log = require('loglevel');
const s3 = require('./s3-storage');
const dynamoDb = require('./dynamodb');
const Partitioner = require('./Partitioner');
const { contentDigest, retryOnFailure } = require('./helpers');

const PARTITIONER_KEY = 'meta_partitioner';

class Safya {
  constructor({ eventsBucket, partitionsTable, storage = s3, preferredPartitioner = new Partitioner() }) {
    this.bucket = eventsBucket;
    this.storage = storage;
    this.partitionsTable = partitionsTable;
    this.preferredPartitioner = preferredPartitioner;
    this.partitioner = null;
  }

  async writeEvent(partitionKey, data) {
    if (!data instanceof String || !data instanceof Buffer) {
      throw new Error('Event data must either be string or buffer');
    }

    const partitionId = await this.getPartitionId({ partitionKey });

    const sequenceNumber = await this.reserveSequenceNumber({ partitionId });

    const key = `events/${partitionId}/${sequenceNumber}`;

    await this.storage.putObjectAsync({
      Bucket: this.bucket,
      Key: key,
      Body: data
    });

    return key;
  }

  async getPartitionId({ partitionKey }) {
    return retryOnFailure(async () => {
      const partitioner = await this.getPartitioner();
      return partitioner.partitionIdForKey(partitionKey);
    }, {
      retries: 10,
      predicate: (err) => err.code === 'ConditionalCheckFailedException',
      messageOnFailure: 'Unable to obtain partition id, maximum retries reached'
    });
  }

  async reserveSequenceNumber({ partitionId }) {
    return retryOnFailure(async () => {
      const sequenceNumber = await this.getSequenceNumber({ partitionId });
      await this.incrementSequenceNumber({ partitionId, sequenceNumber });
      return sequenceNumber;
    }, {
      retries: 10,
      predicate: (err) => err.code === 'ConditionalCheckFailedException',
      messageOnFailure: 'Unable to obtain a sequence number, maximum retries reached'
    });
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
    } else {
      return this.initializeSequenceNumber({ partitionId });
    }
  }

  async incrementSequenceNumber({ partitionId, sequenceNumber }) {
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
  }

  async initializeSequenceNumber({ partitionId }) {
    const sequenceNumber = 0;

    const params = {
      TableName: this.partitionsTable,
      ConditionExpression: 'attribute_not_exists(partitionId)',
      Item: {
        partitionId,
        sequenceNumber
      }
    };
    await dynamoDb.putAsync(params);

    return sequenceNumber;
  }

  async getPartitioner() {
    if (this.partitioner) {
      return this.partitioner;
    }

    const params = {
      TableName: this.partitionsTable,
      Key: {
        partitionId: PARTITIONER_KEY
      }
    };

    const { Item } = await dynamoDb.getAsync(params);

    if (Item) {
      this.partitioner = Partitioner.fromString(Item.partitioner);
    } else {
      this.partitioner = await this.initializePartitioner();
    }

    return this.partitioner;
  }

  async initializePartitioner() {
    const partitioner = this.preferredPartitioner;

    const params = {
      TableName: this.partitionsTable,
      ConditionExpression: 'attribute_not_exists(partitionId)',
      Item: {
        partitionId: PARTITIONER_KEY,
        partitioner: partitioner.toString()
      }
    };

    await dynamoDb.putAsync(params);

    return partitioner;
  }
}

module.exports = Safya;
