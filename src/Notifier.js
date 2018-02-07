const sns = require('./sns');
const dynamoDb = require('./dynamodb');
const log = require('loglevel');
const Locker = require('./Locker');
const { parseConfig } = require('./helpers');

class Notifier {
  constructor({
    topicArn,
    partitionsTable,
    notifications,
    maxLatencyMs = 1000,
    database,
    config
  }) {
    const configObject = parseConfig(config);

    this.database = database || dynamoDb({ region: configObject.awsRegion });
    this.notifications = notifications || sns({ region: configObject.awsRegion });

    this.partitionsTable = partitionsTable || configObject.partitionsTable;
    this.topicArn = topicArn || configObject.eventsTopicArn;

    if (!this.topicArn) {
      throw new Error('Parameter topicArn is required');
    }

    if (!this.partitionsTable) {
      throw new Error('Parameter partitionsTable is required');
    }

    this.waiterExpirationMs = maxLatencyMs / 2;
    this.locker = new Locker({
      tableName: this.partitionsTable,
      lockExpirationTimeMs: maxLatencyMs,
      config
    });
  }

  async notifyForEvent({ partitionId, sequenceNumber, lock }) {
    if (!this.locker.tableItemLocked(lock)) {
      try {
        await this.locker.withLock(
          { partitionId },
          this._notifyAndWait.bind(this, { partitionId, sequenceNumber })
        );
      } catch (err) {
        if (err.code === Locker.LockFailedExceptionCode) {
          return;
        } else {
          log.debug('Error locking or notifying', err);
          throw err;
        }
      }

      const newSequenceNumber = await this._getSequenceNumber({ partitionId });

      if (newSequenceNumber > sequenceNumber) {
        await this._notify({ partitionId, sequenceNumber: newSequenceNumber });
      }
    } else {
      log.debug('table item locked', lock);
    }
  }

  async _notifyAndWait({ partitionId, sequenceNumber }) {
    await this._notify({ partitionId, sequenceNumber });

    await new Promise(resolve => setTimeout(resolve, this.waiterExpirationMs));
  }

  async _notify({ partitionId, sequenceNumber }) {
    log.debug(`Notifying on topic ${this.topicArn}, ${partitionId}:${sequenceNumber}`);
    await this.notifications.publishAsync({
      TopicArn: this.topicArn,
      Message: JSON.stringify({ partitionId, sequenceNumber })
    });
  }

  async _getSequenceNumber({ partitionId }) {
    log.debug('getting partiton sequence number', partitionId);
    const { Item: { sequenceNumber } } = await this.database.getAsync({
      TableName: this.partitionsTable,
      Key: { partitionId }
    });

    return sequenceNumber - 1;
  }
}

module.exports = Notifier;
