const PerformanceTester = require('./PerformanceTester');

const producerTestThread = function(event, context, callback) {
  const performanceTester = new PerformanceTester();

  console.log('Beginning performance testing instance', event);

  performanceTester.execute({
    contextId: context.awsRequestId,
    threadCount: event.threadCount,
    delayMs: event.delayMs,
    timeoutMs: event.timeoutMs,
    eventSizeBytes: event.eventSizeBytes
  })
  .then((result) => callback(null, result))
  .catch((err) => callback(err));
}

const consumerTestThread = function(event, context, callback) {
  const performanceTester = new PerformanceTester();

  console.log('Beginning performance test consumption thread', event);

  performanceTester.consume({
    partitionId: event.partitionId,
    count: event.count
  })
  .then((result) => callback(null, result))
  .catch((err) => callback(err));
}

module.exports = {
  producerTestThread,
  consumerTestThread
}
