const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);
const PerformanceTester = require('./test-lambdas/src/PerformanceTester');
const { parseConfig } = require('../src/helpers');

describe('unit tests', () => {
  describe('PerformanceTester', () => {
    describe('execute', () => {
      it('should write events to safya and return the number of bytes and events written', async () => {
        const mockSafya = {
          writeEvent: sinon.spy()
        };

        const mockSafyaConsumer = {
        };

        const performanceTester = new PerformanceTester({
          safya: mockSafya,
          safyaConsumer: mockSafyaConsumer
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

  describe('parseConfig', () => {
    it('should parse the config if it is a string', () => {
      const config = '{"this":"is a config object"}';

      const configObject = parseConfig(config);

      expect(configObject).to.deep.equal({this:"is a config object"});
    });

    it('should parse the config if it is an object', () => {
      const config = {this: "is a config object"};

      const configObject = parseConfig(config);

      expect(configObject).to.deep.equal({this:"is a config object"});
    });

    it('should throw if the config is not an object or a string', () => {
      expect(() => parseConfig(1)).to.throw;
    });
  });
});
