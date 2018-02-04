const sns = require('./sns');
const log = require('loglevel');

class Notifier {
  constructor({ topicArn }) {
    if (!topicArn) {
      throw new Error('Topic is required for publishing notifications about new events.');
    }

    this.topicArn = topicArn;
  }

  async notifyForEvent({ partitionKey }) {
    log.debug(`Notifying on topic ${this.topicArn}.`);
    await sns.publishAsync({
      TopicArn: this.topicArn,
      Message: JSON.stringify({ partitionKey })
    });
  }
}

module.exports = Notifier;
