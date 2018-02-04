const expect = require('chai').expect;
const sinon = require('sinon');
const testInfra = require('./test-infra');
const { Safya, SafyaConsumer, Partitioner } = require('../src');
const log = require('loglevel');
log.setLevel('debug');

describe('end to end', function () {
  this.timeout(100000);

  let safyaConfig;
  let consumer, safya;
  let mockSns = {
    publishAsync: sinon.spy()
  };

  before(async () => {
    ({ safyaConfig } = await testInfra.describeTestStack());

    safya = new Safya({
      config: safyaConfig,
      maxNotifyLatencyMs: 1000,
      notifications: mockSns
    });

    consumer = new SafyaConsumer({
      name: 'test-consumer',
      config: safyaConfig
    });
  });

  describe('the consumer', () => {
    it('should be able to read events after they are produced', async () => {
      await safya.writeEvent('id-12345', 'foo');

      const partitionId = await consumer.getPartitionId({ partitionKey: 'id-12345' });

      const events = [];
      await consumer.readEvents({ partitionId }, events.push.bind(events));

      expect(events[0].toString('utf8')).to.equal('foo');
    });

    it('should not read the same event twice', async () => {
      await safya.writeEvent('id-12345', 'blah');

      const partitionId = await consumer.getPartitionId({ partitionKey: 'id-12345' });
      await consumer.readEvents({ partitionId });
      const events = [];
      await consumer.readEvents({ partitionId }, events.push.bind(events));

      expect(events).to.be.empty;
    });

    it('should read events in the order they were produced', async () => {
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

      const partitionId = await consumer.getPartitionId({ partitionKey: 'id-12345' });
      await consumer.readEvents({
        partitionId,
        count: 60
      }, event => {
        const { id, i } = JSON.parse(event);
        const expected = (last[id] || 0) + 1;
        expect(i).to.equal(expected);
        last[id] = expected;
      });
    });

    it('should not bork when an item is missing in S3 due to a failed write', async () => {
      const stub = sinon.stub(safya.storage, 'putObjectAsync');
      stub.onFirstCall().throws();

      try {
        await safya.writeEvent('id-12345', 'bingo failed');
      } catch (err) {
        // ignore
      }

      stub.restore();

      await safya.writeEvent('id-12345', 'bingo success');

      const partitionId = await consumer.getPartitionId({ partitionKey: 'id-12345' });
      const events = [];
      await consumer.readEvents({ partitionId }, events.push.bind(events));

      expect(events).to.have.lengthOf(1);
      expect(events[0].toString('utf8')).to.equal('bingo success');
    });

    it('should only allow one consumer thread to read from each partition at a time', async () => {
      for (let i = 0; i < 5; i++) {
        await safya.writeEvent('id-12345', 'dinosaur');
      }

      const consumer2 = new SafyaConsumer({
        name: 'test-consumer',
        config: safyaConfig
      });

      const partitionId = await consumer.getPartitionId({ partitionKey: 'id-12345' });
      const events = []
      await Promise.all([
        consumer.readEvents({ partitionId }, events.push.bind(events)),
        consumer2.readEvents({ partitionId }, events.push.bind(events))
      ]);

      expect(events).to.have.lengthOf(5);
    });
  });

  describe('the producer', () => {
    it('should only notify once in the period of maxLatencyMs milliseconds', async () => {

    });
  });
});
