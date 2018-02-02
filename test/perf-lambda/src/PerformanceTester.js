const { Safya, SafyaConsumer, Partitioner } = require('../../../src');
const crypto = require('crypto');

const safyaFactory = () => new Safya({
  config: process.env.SAFYA_CONFIG,
  preferredPartitioner: new Partitioner({ partitionCount: 10 })
});

const safyaConsumerFactory = () => new SafyaConsumer({
  config: process.env.SAFYA_CONFIG,
  name: 'performance-test-lambda-consumer'
});

class PerformanceTester {
  constructor({ safya = safyaFactory(), safyaConsumer = safyaConsumerFactory() } = {}) {
    this.safya = safya;
    this.safyaConsumer = safyaConsumer;
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

  async consume({ partitionId, count }) {
    let totalBytes = 0;
    let eventsRead = 0;

    const results = await this.safyaConsumer.readEvents({
        partitionId,
        count
      },
      (event) => {
        eventsRead += 1;
        totalBytes += event.length;
        console.log(`Read ${event.length} bytes from partition ${partitionId}.`);
      },
    );

    const done = results.eventsRemaining === 0;

    return {
      totalBytes,
      eventsRead,
      done
    };
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
