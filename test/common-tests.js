const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
chai.use(sinonChai);
const log = require('loglevel');

module.exports = (configPromise) => {
  describe('Safya', () => {
    let safya, consumer, safyaFactory, consumerFactory, partitionId;

    let partitionKey = 'id-12345';

    before(async () => {
      ({ safyaFactory, consumerFactory } = await configPromise);

      safya = safyaFactory();

      consumer = consumerFactory({ name: 'test-consumer' });

      partitionId = await consumer.getPartitionId({ partitionKey });

      await consumer.skipToEnd({ partitionId });
    });

    describe('the consumer', () => {
      it('should be able to read events after they are produced', async () => {
        await safya.writeEvent(partitionKey, 'foo');

        const events = [];
        await consumer.readEvents({ partitionId }, events.push.bind(events));

        expect(events[0].toString('utf8')).to.equal('foo');
      });

      it('should not read the same event twice', async () => {
        await safya.writeEvent(partitionKey, 'blah');

        await consumer.readEvents({ partitionId });
        const events = [];
        await consumer.readEvents({ partitionId }, events.push.bind(events));

        expect(events).to.be.empty;
      });

      it('should read events in the order they were produced', async () => {
        const thread = (threadId) => async () => {
          for (let i = 1; i < 5; i++) {
            await safya.writeEvent(partitionKey, JSON.stringify({ id: threadId, i }));
          }
        }

        const last = {};

        await Promise.all([
          thread('1')(),
          thread('2')(),
          thread('3')()
        ]);

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
          await safya.writeEvent(partitionKey, 'bingo failed');
        } catch (err) {
          // ignore
        }

        stub.restore();

        await safya.writeEvent(partitionKey, 'bingo success');

        const events = [];
        await consumer.readEvents({ partitionId }, events.push.bind(events));

        expect(events).to.have.lengthOf(1);
        expect(events[0].toString('utf8')).to.equal('bingo success');
      });

      it('should only allow one consumer thread to read from each partition at a time', async () => {
        for (let i = 0; i < 5; i++) {
          await safya.writeEvent(partitionKey, 'dinosaur');
        }

        const consumer2 = consumerFactory({ name: 'test-consumer' });

        const events = []
        await Promise.all([
          consumer.readEvents({ partitionId }, events.push.bind(events)),
          consumer2.readEvents({ partitionId }, events.push.bind(events))
        ]);

        expect(events).to.have.lengthOf(5);
      });
    });

    describe('the producer', () => {
      let stub;

      beforeEach(() => {
        stub = sinon.stub(safya.notifier.notifications, 'publishAsync');
        stub.returns(Promise.resolve());
      });

      afterEach(() => {
        stub.restore();
      });

      it('should reduce the number of notifications for quickly produced events', async () => {
        const count = 10;

        await Promise.all([...Array(count)].map(() =>
          safya.writeEvent(partitionKey, 'monster')
        ));

        await safya.asyncActions;

        expect(stub.callCount).to.be.below(count);
      });

      it('should not notify on the same event twice', async () => {
        await safya.writeEvent(partitionKey, 'monster');

        await safya.asyncActions;

        expect(stub.callCount).to.equal(1);
      });
    });
  });
};
