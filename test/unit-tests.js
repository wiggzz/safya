const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);
const PerformanceTester = require('./perf-lambda/src/PerformanceTester');

describe('unit tests', () => {
  describe('PerformanceTester', () => {
    describe('execute', () => {
      it('should write events to safya and return the number of bytes and events written', async () => {
        const mockSafya = {
          writeEvent: sinon.spy()
        };

        const performanceTester = new PerformanceTester({
          safya: mockSafya
        });

        const results = await performanceTester.execute({
          contextId: '1',
          threadCount: 1,
          delayMs: 500,
          timeoutMs: 1000,
          eventSizeBytes: 256
        });

        expect(mockSafya.writeEvent).to.have.callCount(2);
        expect(results.totalBytes).to.equal(256 * 2);
        expect(results.eventsWritten).to.equal(2);
      });
    });
  });
});
