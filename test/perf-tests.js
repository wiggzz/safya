const expect = require('chai').expect;
const sinon = require('sinon');
const testInfra = require('./test-infra');
const { runProducerTest, runConsumerTest } = require('./test-lambdas/invoke');
const log = require('loglevel');

const prettyPrintBytes = (bytes) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024*1024) {
    return `${Math.floor(bytes / 1024)} KB`;
  } else if (bytes < 1024*1024*1024) {
    return `${Math.floor(bytes / 1024 / 1024)} MB`;
  } else {
    return `${Math.floor(bytes / 1024 / 1024 / 1024)} GB`;
  }
}

describe('performance', function () {
  this.timeout(100000);

  let producerTestFunction, consumerTestFunction, safyaConfig;

  before(async () => {
    (
      { producerTestFunction,
        consumerTestFunction,
        safyaConfig
      } = await testInfra.describeTestStack()
    );
  });

  describe('parameterized producer tests', () => {
    const data = [
      {
        eventSize: 256,
        threadCount: 1,
        eventsPerSecond: 1,
        timeoutSeconds: 5
      },
      {
        eventSize: 4096,
        threadCount: 150,
        eventsPerSecond: 3,
        timeoutSeconds: 10
      }
    ]

    data.forEach(item => {
      const dataRate = item.eventSize * item.threadCount * item.eventsPerSecond;

      it(`should manage production of approximately ${ prettyPrintBytes(dataRate) }/s for ${item.timeoutSeconds} seconds`, async () => {
        const expectedEvents = item.eventsPerSecond * item.threadCount * item.timeoutSeconds;

        const report = await runProducerTest({
          functionName: producerTestFunction,
          eventSizeBytes: item.eventSize,
          eventsPerSecond: item.eventsPerSecond,
          timeoutMs: item.timeoutSeconds * 1000,
          threadCount: item.threadCount
        });

        log.debug('report', report);
        log.debug('data rate (MB/s)', report.totalBytes / report.totalTimeMs / (1024*1024) * 1000)

        const percentageOfExpected = report.eventsWritten / expectedEvents;

        expect(report.totalTimeMs).to.be.lessThan(1.5 * item.timeoutSeconds * 1000);
        expect(percentageOfExpected).to.be.above(0.9);
      });
    });
  });

  describe('consumer tests', () => {
    it.only('should read as many events as possible (yea i need a better test)', async () => {
      const report = await runConsumerTest({
        functionName: consumerTestFunction,
        safyaConfig,
        readCountPerLambda: 100
      });

      log.debug('report', report);
      log.debug('data rate (MB/s', report.totalBytes / report.totalTimeMs / (1024*1024) * 1000);
    });
  })
});

