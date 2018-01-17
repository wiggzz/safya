const expect = require('chai').expect;
const { Safya, SafyaConsumer } = require('../src');

const BUCKET = 'safya-e2e-test-bucket';

describe('end to end', () => {
  let consumer, safya;

  before(async () => {
    safya = new Safya({ bucket: BUCKET })

    consumer = new SafyaConsumer({ name: 'test-consumer', bucket: BUCKET });
  });

  describe('after an event is produced by a producer', () => {
    before(async function () {
      this.timeout(20000);
      await safya.writeEvent('foo');
    });

    it('should become available to consumers', async () => {
      const events = await consumer.readEvents();

      expect(events[0].toString('utf8')).to.equal('foo');
    }).timeout(20000);
  });
});
