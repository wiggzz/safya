const expect = require('chai').expect;
const memoryStorage = require('./memory-storage');
const { Safya, SafyaConsumer } = require('../src');
const log = require('loglevel');

const BUCKET = 'safya-e2e-test-bucket';
const STORAGE = memoryStorage;

describe('end to end', () => {
  let consumer, safya;

  before(async () => {
    memoryStorage.createBucket({ Bucket: BUCKET });

    safya = new Safya({ bucket: BUCKET, storage: STORAGE })

    consumer = new SafyaConsumer({ name: 'test-consumer', bucket: BUCKET, storage: STORAGE });
  });

  describe('the consumer', () => {
    it('should be able to read events after they are produced', async () => {
      await safya.writeEvent('foo');

      const events = await consumer.readEvents();

      expect(events[0].toString('utf8')).to.equal('foo');
    }).timeout(20000);

    it('should not read the same event twice', async () => {
      await safya.writeEvent('blah');

      await consumer.readEvents();
      const events = await consumer.readEvents();

      expect(events).to.be.empty;
    }).timeout(20000);

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

      await consumer.readEvents(event => {
        const { id, i } = JSON.parse(event);
        const expected = (last[id] || 0) + 1;
        expect(i).to.equal(expected);
        last[id] = expected;
      });
    }).timeout(20000);

    it('should keep track of when the consumer fails to process an event and allow retrying', async () => {
      await safya.writeEvent('a');
      await safya.writeEvent('b');
      await safya.writeEvent('c');

      let string = '';
      let error = true;

      await consumer.readEvents(event => {
        if (error) {
          error = false;
          throw new Error('random error');
        }
        string = string + event;
      });

      expect(string).to.equal('abc');
    }).timeout(20000);
  });
});
