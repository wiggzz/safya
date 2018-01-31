const PerformanceTester = require('./PerformanceTester');

module.exports.performanceTestThread = function(event, context, callback) {
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
