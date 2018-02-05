const sns = require('./sns');
const dynamoDb = require('./dynamodb');
const log = require('loglevel');
const Locker = require('./Locker');

class Notifier {
  constructor({ topicArn, partitionsTable, notifications = sns, maxLatencyMs = 1000 }) {
    if (!topicArn) {
      throw new Error('Parameter topicArn is required');
    }

    if (!partitionsTable) {
      throw new Error('Parameter partitionsTable is required');
    }

    this.topicArn = topicArn;
    this.partitionsTable = partitionsTable;
    this.waiterExpirationMs = maxLatencyMs / 2;
    this.locker = new Locker({ tableName: partitionsTable, lockExpirationTimeMs: maxLatencyMs });
    this.notifications = notifications;
  }

  async notifyForEvent({ partitionId, sequenceNumber, ...otherAttributes }) {
    if (!this.locker.tableItemLocked(otherAttributes)) {
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
      log.debug('table item locked', otherAttributes);
    }
  }

  async _notifyAndWait({ partitionId, sequenceNumber }) {
    await this._notify({ partitionId, sequenceNumber });

    await new Promise(resolve => setTimeout(resolve, this.waiterExpirationMs));
  }

  async _notify({ partitionId, sequenceNumber }) {
    log.debug(`Notifying on topic ${this.topicArn}, partition ${partitionId}, sequence no. ${sequenceNumber}.`);
    await this.notifications.publishAsync({
      TopicArn: this.topicArn,
      Message: JSON.stringify({ partitionId, sequenceNumber })
    });
  }

  async _getSequenceNumber({ partitionId }) {
    const { Item: { sequenceNumber } } = await dynamoDb.getAsync({
      TableName: this.partitionsTable,
      Key: { partitionId }
    });

    return sequenceNumber - 1;
  }
}

module.exports = Notifier;
