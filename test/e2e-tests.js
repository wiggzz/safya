const expect = require('chai').expect;
const sinon = require('sinon');
const testInfra = require('./test-infra');
const { Safya, SafyaConsumer, Partitioner } = require('../src');
const log = require('loglevel');
log.setLevel('debug');

describe('end to end', function () {
  this.timeout(100000);

  let eventsBucket, partitionsTable, consumersTable;
  let consumer, safya;

  before(async () => {
    ({ eventsBucket, partitionsTable, consumersTable } = await testInfra.describeE2EStack());

    safya = new Safya({
      eventsBucket,
      partitionsTable,
      preferredPartitioner: new Partitioner({ partitionCount: 1 })
    });

    consumer = new SafyaConsumer({
      name: 'test-consumer',
      eventsBucket,
      consumersTable,
      partitionsTable
    });
  });

  after(async () => {
    const [ partitionId ] = await consumer.getPartitionIds();
    await consumer.readEvents({ partitionId });
  });

  describe('the consumer', () => {
    it('should be able to read events after they are produced', async () => {
      await safya.writeEvent('id-12345', 'foo');

      const [ partitionId ] = await consumer.getPartitionIds();

      const events = await consumer.readEvents({ partitionId });

      expect(events[0].toString('utf8')).to.equal('foo');
    });

    it('should not read the same event twice', async () => {
      await safya.writeEvent('id-12345', 'blah');

      const [ partitionId ] = await consumer.getPartitionIds();
      await consumer.readEvents({ partitionId });
      const events = await consumer.readEvents({ partitionId });

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

      const [ partitionId ] = await consumer.getPartitionIds();
      await consumer.readEvents({
        partitionId,
        eventProcessor: event => {
          const { id, i } = JSON.parse(event);
          const expected = (last[id] || 0) + 1;
          expect(i).to.equal(expected);
          last[id] = expected;
        },
        count: 60
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

      const [ partitionId ] = await consumer.getPartitionIds();
      const events = await consumer.readEvents({ partitionId });

      expect(events).to.have.lengthOf(1);
      expect(events[0].toString('utf8')).to.equal('bingo success');
    });

    it('should only allow one consumer thread to read from each partition at a time', async () => {
      for (let i = 0; i < 5; i++) {
        await safya.writeEvent('id-12345', 'dinosaur');
      }

      const consumer2 = new SafyaConsumer({
        name: 'test-consumer',
        eventsBucket,
        consumersTable,
        partitionsTable
      });

      const [ partitionId ] = await consumer.getPartitionIds();
      const [ events1, events2 ] = await Promise.all([
        consumer.readEvents({ partitionId }),
        consumer2.readEvents({ partitionId })
      ]);

      if (events1.length > 0) {
        expect(events1).to.have.lengthOf(5);
        expect(events2).to.have.lengthOf(0);
      } else {
        expect(events2).to.have.lengthOf(5);
        expect(events1).to.have.lengthOf(0);
      }
    });
  });
});
