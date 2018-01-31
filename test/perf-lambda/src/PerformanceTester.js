const { Safya, Partitioner } = require('../../../src');
const crypto = require('crypto');

const safyaFactory = () => new Safya({
  eventsBucket: process.env.EVENTS_BUCKET,
  partitionsTable: process.env.PARTITIONS_TABLE,
  preferredPartitioner: new Partitioner({ partitionCount: 10000 })
});

class PerformanceTester {
  constructor({ safya = safyaFactory() } = {}) {
    this.safya = safya;
  }

  async execute({ contextId, threadCount, delayMs, timeoutMs, eventSizeBytes }) {
    const start = Date.now();

    const results = await Promise.all([...Array(threadCount)].map(async (_, threadId) => {
      let bytes = 0;
      let events = 0;
      let activeTime = 0;
      while (Date.now() < start + timeoutMs) {
        const actionStartTimeMs = Date.now();
        bytes += await this.performanceAction(eventSizeBytes, contextId, threadId);
        events += 1;
        const now = Date.now();
        activeTime += (now - actionStartTimeMs);
        const nextTimeFromNow = actionStartTimeMs + delayMs - now;
        if (nextTimeFromNow > 0) {
          await new Promise((resolve) => setTimeout(resolve, nextTimeFromNow));
        }
      }

      return { bytes, events, activeTime };
    }));

    const elapsedTime = Date.now() - start;

    const summary = results.reduce((memo, r) => {
      return {
        totalBytes: memo.totalBytes + r.bytes,
        eventsWritten: memo.eventsWritten + r.events,
        activeTime: memo.activeTime + r.activeTime
      };
    }, {
      totalBytes: 0,
      eventsWritten: 0,
      activeTime: 0
    });

    return summary
  }

  async performanceAction(eventSizeBytes, requestId, threadId) {
    const partitionKey = `thread-${requestId}-${threadId}`;
    console.log(`Writing ${eventSizeBytes} bytes to partition ${partitionKey}.`);
    const data = crypto.randomBytes(eventSizeBytes);
    await this.safya.writeEvent(partitionKey, data);
    return eventSizeBytes;
  }
}

module.exports = PerformanceTester;
