const crypto = require("crypto");
const log = require("loglevel");
const s3 = require("./s3-storage");
const dynamoDb = require("./dynamodb");
const Partitioner = require("./Partitioner");
const { contentDigest, retryOnFailure } = require("./helpers");

const PARTITIONER_KEY = "meta_partitioner";

class Safya {
  constructor({
    eventsBucket,
    partitionsTable,
    storage = s3,
    preferredPartitioner
  }) {
    this.bucket = eventsBucket;
    this.storage = storage;
    this.partitionsTable = partitionsTable;
    this.preferredPartitioner = preferredPartitioner;
    this.partitioner = null;
    this.stats = {
      consistencyFailures: 0
    };
  }

  async writeEvent(partitionKey, data) {
    if (!data instanceof String || !data instanceof Buffer) {
      throw new Error("Event data must either be string or buffer");
    }

    const partitionId = await this.getPartitionId({ partitionKey, createIfNotExists: true });

    const sequenceNumber = await this.reserveSequenceNumber({ partitionId });

    const key = `events/${partitionId}/${sequenceNumber}`;

    await this.storage.putObjectAsync({
      Bucket: this.bucket,
      Key: key,
      Body: data
    });

    return key;
  }

  async getPartitionId({ partitionKey, createIfNotExists = false }) {
    return retryOnFailure(
      async () => {
        const partitioner = await this.getPartitioner({ createIfNotExists });
        return partitioner.partitionIdForKey(partitionKey);
      },
      {
        retries: 10,
        predicate: err => err.code === "ConditionalCheckFailedException",
        messageOnFailure:
          "Unable to obtain partition id, maximum retries reached"
      }
    );
  }

  async getSequenceNumber({ partitionId }) {
    const params = {
      TableName: this.partitionsTable,
      Key: {
        partitionId
      }
    };

    const { Item } = await dynamoDb.getAsync(params);

    if (Item) {
      return Item.sequenceNumber;
    } else {
      return undefined;
    }
  }

  async reserveSequenceNumber({ partitionId }) {
    const params = {
      TableName: this.partitionsTable,
      Key: {
        partitionId
      },
      UpdateExpression: "ADD sequenceNumber :one",
      ExpressionAttributeValues: {
        ":one": 1
      },
      ReturnValues: "UPDATED_NEW"
    };

    const { Attributes: { sequenceNumber } } = await dynamoDb.updateAsync(
      params
    );

    return sequenceNumber - 1;
  }

  async getPartitioner({ createIfNotExists = false } = {}) {
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

      if (
        this.preferredPartitioner &&
        !this.partitioner.isEquivalentTo(this.preferredPartitioner)
      ) {
        log.warn(
          "The partitioner currently installed in your Safya stack is not the same as your specified preferred partitioner."
        );
      }
    } else if (createIfNotExists) {
      this.partitioner = await this.initializePartitioner();
    } else {
      throw new Error('Unable to obtain partitioner: No partitioner has been initialized yet for this Safya stack.');
    }

    return this.partitioner;
  }

  async initializePartitioner() {
    if (!this.preferredPartitioner) {
      log.warn(
        "You did not specify a partitioner, so we will use a default partitioner."
      );
      this.preferredPartitioner = new Partitioner();
    }

    const partitioner = this.preferredPartitioner;

    const params = {
      TableName: this.partitionsTable,
      ConditionExpression: "attribute_not_exists(partitionId)",
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
