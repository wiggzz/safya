const dynamoDb = require('./dynamodb');
const log = require('loglevel');
const { generateThreadId } = require('./helpers');

class Locker {
  constructor({ tableName, lockExpirationTimeMs, database = dynamoDb }) {
    if (!tableName) {
      throw new Error('Parameter tableName is required');
    }

    if (!lockExpirationTimeMs) {
      throw new Error('Parameter lockExpirationTimeMs is required');
    }

    this.tableName = tableName;
    this.lockExpirationTimeMs = lockExpirationTimeMs
    this.threadId = generateThreadId();
    this.database = database;
  }

  async withLock(key, closure) {
    try {
      await this.obtainLock(key);
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        log.debug('Couldn\'t obtain lock', this.threadId.slice(0, 6), key);
        const error = new Error('Unable to obtain lock. Another thread is operating on this table key.');
        error.code = Locker.LockFailedExceptionCode;
        throw error;
      } else {
        throw err;
      }
    }

    log.debug('successfully obtained lock', this.threadId.slice(0, 6), key);

    try {
      return await closure();
    } catch (err) {
      throw err;
    } finally {
      await this.releaseLock(key);
    }
  }

  tableItemLocked({ lockThreadId, lockExpiration }) {
    return lockThreadId && lockExpiration > Date.now();
  }

  async obtainLock(key) {
    log.debug('obtaining lock', this.threadId.slice(0, 6), key);
    const now = Date.now();
    const params = {
      TableName: this.tableName,
      Key: key,
      UpdateExpression: 'SET lockThreadId = :threadId, lockExpiration = :lockExpiration',
      ConditionExpression: 'attribute_not_exists(lockThreadId) OR lockExpiration < :timestamp',
      ExpressionAttributeValues: {
        ':threadId': this.threadId,
        ':timestamp': now,
        ':lockExpiration': now + this.lockExpirationTimeMs
      }
    }

    await this.database.updateAsync(params);
  }

  async releaseLock(key) {
    log.debug('releasing lock', this.threadId.slice(0, 6), key);
    const params = {
      TableName: this.tableName,
      Key: key,
      UpdateExpression: 'REMOVE lockThreadId, lockExpiration',
      ConditionExpression: 'lockThreadId = :threadId',
      ExpressionAttributeValues: {
        ':threadId': this.threadId
      }
    }

    await this.database.updateAsync(params);
  }
}

Locker.LockFailedExceptionCode = 'LockFailedException';

module.exports = Locker;
