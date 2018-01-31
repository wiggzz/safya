const expect = require('chai').expect;
const sinon = require('sinon');
const testInfra = require('./test-infra');
const invokePerformanceTest = require('./perf-lambda/invoke');
const log = require('loglevel');
log.setLevel('debug');

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

  let performanceTestFunction = 'safya-perf-tests-PerformanceTestFunction-EW53KJU3E4QK';

  before(async () => {
    ({ performanceTestFunction } = await testInfra.deployPerfStack());
  });

  describe('initial testing', () => {
    const data = [
      {
        eventSize: 256,
        threadCount: 1,
        eventsPerSecond: 1,
        timeoutSeconds: 5
      },
      {
        eventSize: 4096,
        threadCount: 100,
        eventsPerSecond: 3,
        timeoutSeconds: 10
      }
    ]

    data.forEach(item => {
      const dataRate = item.eventSize * item.threadCount * item.eventsPerSecond;

      it(`should manage production of approximately ${ prettyPrintBytes(dataRate) }/s for ${item.timeoutSeconds} seconds`, async () => {
        const expectedEvents = item.eventsPerSecond * item.threadCount * item.timeoutSeconds;

        const report = await invokePerformanceTest({
          functionName: performanceTestFunction,
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
});

