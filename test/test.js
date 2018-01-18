const expect = require('chai').expect;
const memoryStorage = require('./memory-storage');
const { Safya, SafyaConsumer } = require('../src');
const log = require('loglevel');
log.setLevel('debug');

const BUCKET = 'safya-e2e-test-bucket';

describe('end to end', () => {
  let consumer, safya;

  before(async () => {
    memoryStorage.createBucket({ Bucket: BUCKET });

    safya = new Safya({ bucket: BUCKET, storage: memoryStorage })

    consumer = new SafyaConsumer({ name: 'test-consumer', bucket: BUCKET, storage: memoryStorage });
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
  });
});
