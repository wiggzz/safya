const crypto = require('crypto');
const log = require('loglevel');
const AWS = require('aws-sdk');
const s3 = require('./s3');
const dynamoDb = require('./dynamodb');
const Partitioner = require('./Partitioner');
const Notifier = require('./Notifier');
const { contentDigest, retryOnFailure, generateThreadId, parseConfig } = require('./helpers');

const PARTITIONER_KEY = 'meta_partitioner';

class Safya {
  constructor({
    eventsBucket,
    partitionsTable,
    config,
    storage,
    database,
    preferredPartitioner,
    notifier
  }) {
    const configObject = parseConfig(config);

    this.storage = storage || s3({ region: configObject.awsRegion });
    this.database = database || dynamoDb({ region: configObject.awsRegion });

    this.bucket = eventsBucket || configObject.eventsBucket;
    this.partitionsTable = partitionsTable || configObject.partitionsTable;

    if (!this.bucket) {
      throw new Error('Parameter eventsBucket is required');
    }

    if (!this.partitionsTable) {
      throw new Error('Parameter partitionsTable is required');
    }

    const configPartitioner = configObject.preferredPartitionCount ? new Partitioner({partitionCount: configObject.preferredPartitionCount}) : undefined;
    this.preferredPartitioner = preferredPartitioner || configPartitioner;
    this.notifier = notifier || new Notifier({ config });
    this.partitioner = null;
    this.asyncActions = Promise.resolve();
  }

  async writeEvent(partitionKey, data) {
    if (!data instanceof String || !data instanceof Buffer) {
      throw new Error('Event data must either be string or buffer');
    }

    const partitionId = await this.getPartitionId({ partitionKey, createIfNotExists: true });

    const { sequenceNumber, lock } = await this.reserveSequenceNumber({ partitionId });

    const key = `events/${partitionId}/${sequenceNumber}`;

    log.debug(`writing event to key ${key}`);
    await this.storage.putObjectAsync({
      Bucket: this.bucket,
      Key: key,
      Body: data
    });

    const promise = this.notifier.notifyForEvent({ partitionId, sequenceNumber, lock })
      .catch(err => {
        log.error('error during notification of event', err);
      });

    this.asyncActions = this.asyncActions.then(() => promise);
  }

  async getPartitionId({ partitionKey, createIfNotExists = false }) {
    const partitioner = await this.getPartitioner({ createIfNotExists });
    return partitioner.partitionIdForKey(partitionKey);
  }

  async getSequenceNumber({ partitionId }) {
    log.debug('getting partition sequence number');
    const params = {
      TableName: this.partitionsTable,
      Key: {
        partitionId
      }
    };

    const { Item } = await this.database.getAsync(params);

    if (Item) {
      return Item.sequenceNumber;
    } else {
      return undefined;
    }
  }

  async reserveSequenceNumber({ partitionId }) {
    log.debug(`reserving sequence number ${partitionId}`);
    const params = {
      TableName: this.partitionsTable,
      Key: {
        partitionId
      },
      UpdateExpression: 'ADD sequenceNumber :one',
      ExpressionAttributeValues: {
        ':one': 1
      },
      ReturnValues: 'ALL_NEW'
    };

    const { Attributes: { sequenceNumber, lock } } = await this.database.updateAsync(
      params
    );

    return {
      sequenceNumber: sequenceNumber - 1,
      lock
    }
  }

  async getPartitioner({ createIfNotExists = false } = {}) {
    log.debug('getting partitioner');
    if (this.partitioner) {
      return this.partitioner;
    }

    const params = {
      TableName: this.partitionsTable,
      Key: {
        partitionId: PARTITIONER_KEY
      }
    };

    const { Item } = await this.database.getAsync(params);

    if (Item) {
      this.partitioner = Partitioner.fromString(Item.partitioner);

      if (
        this.preferredPartitioner &&
        !this.partitioner.isEquivalentTo(this.preferredPartitioner)
      ) {
        log.warn(
          'The partitioner currently installed in your Safya stack is not the same as your specified preferred partitioner.'
        );
      }
    } else if (createIfNotExists) {
      await retryOnFailure(
        async () => {
          this.partitioner = await this.initializePartitioner();
        },
        {
          retries: 10,
          predicate: err => err.code === 'ConditionalCheckFailedException',
          messageOnFailure:
            'Unable to initialize partitioner, maximum retries reached'
        }
      );
    } else {
      throw new Error('Unable to obtain partitioner: No partitioner has been initialized yet for this Safya stack.');
    }

    return this.partitioner;
  }

  async initializePartitioner() {
    log.debug('initializing partitioner');
    if (!this.preferredPartitioner) {
      log.warn(
        'You did not specify a partitioner, so we will use a default partitioner.'
      );
      this.preferredPartitioner = new Partitioner();
    }

    const partitioner = this.preferredPartitioner;

    const params = {
      TableName: this.partitionsTable,
      ConditionExpression: 'attribute_not_exists(partitionId)',
      Item: {
        partitionId: PARTITIONER_KEY,
        partitioner: partitioner.toString()
      }
    };

    await this.database.putAsync(params);

    return partitioner;
  }
}

module.exports = Safya;
