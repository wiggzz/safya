const expect = require('chai').expect;
const sinon = require('sinon');
const { Safya, SafyaConsumer } = require('../src');
const log = require('loglevel');
const testInfra = require('./test-infra');
log.setLevel('debug');

const STORAGE = undefined;//memoryStorage;

describe('end to end', function () {
  this.timeout(100000);

  let eventsBucket, partitionsTable, consumersTable;
  let consumer, safya;

  before(async () => {
    ({ eventsBucket, partitionsTable, consumersTable } = await testInfra.deploy());

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
      await safya.writeEvent('id-12345', 'foo');

      const events = await consumer.readEvents({ partitionId: 'dummy' });

      expect(events[0].toString('utf8')).to.equal('foo');
    });

    it('should not read the same event twice', async () => {
      await safya.writeEvent('id-12345', 'blah');

      await consumer.readEvents({ partitionId: 'dummy' });
      const events = await consumer.readEvents({ partitionId: 'dummy' });

      expect(events).to.be.empty;
    });

    it('events that are produced in order should stay in order when consumed', async () => {
      const thread = (threadId) => async () => {
        for (let i = 1; i < 5; i++) {
          await safya.writeEvent('id-12345', JSON.stringify({ id: threadId, i }));
        }
      }

      const last = {};

      await Promise.all([
        thread('1')(),
        thread('2')(),
        thread('3')()
      ]);

      await consumer.readEvents({
        partitionId: 'dummy',
        eventProcessor: event => {
          const { id, i } = JSON.parse(event);
          const expected = (last[id] || 0) + 1;
          expect(i).to.equal(expected);
          last[id] = expected;
        },
        count: 60
      });
    });

    it('should keep track of when the consumer fails to process an event and allow retrying', async () => {
      await safya.writeEvent('id-12345', 'a');
      await safya.writeEvent('id-12345', 'b');
      await safya.writeEvent('id-12345', 'c');

      let string = '';
      let error = true;

      await consumer.readEvents({
        partitionId: 'dummy',
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
