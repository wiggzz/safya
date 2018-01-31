const expect = require('chai').expect;
const sinon = require('sinon');
const testInfra = require('./test-infra');
const { Safya, SafyaConsumer } = require('../src');
const log = require('loglevel');
log.setLevel('debug');

describe('end to end', function () {
  this.timeout(100000);

  let eventsBucket, partitionsTable, consumersTable;
  let consumer, safya;

  before(async () => {
    ({ eventsBucket, partitionsTable, consumersTable } = await testInfra.deployE2EStack());

    safya = new Safya({
      eventsBucket,
      partitionsTable
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
  });
});
