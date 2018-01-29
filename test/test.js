const expect = require('chai').expect;
const sinon = require('sinon');
const { Safya, SafyaConsumer } = require('../src');
const log = require('loglevel');
const testInfra = require('test-infra');

const BUCKET = 'safya-e2e-test-bucket';
const PARTITIONS_TABLE = 'safya-e2e-partitions';
const CONSUMERS_TABLE = 'safya-e2e-consumers';
const STORAGE = undefined;//memoryStorage;

describe('end to end', () => {
  let consumer, safya;
  let eventsBucket, partitionsTable, consumersTable;

  before(async () => {
    { eventsBucket, partitionsTable, consumersTable } = await testInfra.deploy();

    safya = new Safya({
      eventsBucket,
      partitionsTable,
      storage: STORAGE
    });

    consumer = new SafyaConsumer({
      name: 'test-consumer',
      eventsBucket,
      consumersTable,
      partitionsTable,
      storage: STORAGE
    });
  });

  describe('the consumer', () => {
    it('should be able to read events after they are produced', async () => {
      await safya.writeEvent('foo');

      const events = await consumer.readEvents();

      expect(events[0].toString('utf8')).to.equal('foo');
    });

    it('should not read the same event twice', async () => {
      await safya.writeEvent('blah');

      await consumer.readEvents();
      const events = await consumer.readEvents();

      expect(events).to.be.empty;
    });

    it('events that are written in order should stay in order when consumed', async () => {
      const thread = (threadId) => async () => {
        for (let i = 1; i < 20; i++) {
          await safya.writeEvent(JSON.stringify({ id: threadId, i }));
        }
      }

      const last = {};

      await Promise.all([
        thread('1')(),
        thread('2')(),
        thread('3')()
      ]);

      await consumer.readEvents({
        eventProcessor: event => {
          const { id, i } = JSON.parse(event);
          const expected = (last[id] || 0) + 1;
          expect(i).to.equal(expected);
          last[id] = expected;
        }
      });
    });

    it('should keep track of when the consumer fails to process an event and allow retrying', async () => {
      await safya.writeEvent('a');
      await safya.writeEvent('b');
      await safya.writeEvent('c');

      let string = '';
      let error = true;

      await consumer.readEvents({
        eventProcessor: event => {
          if (error) {
            error = false;
            throw new Error('random error');
          }
          string = string + event;
        }
      });

      expect(string).to.equal('abc');
    });
  });
});
