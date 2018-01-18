const expect = require('chai').expect;
const { Safya, SafyaConsumer } = require('../src');

const BUCKET = 'safya-e2e-test-bucket';

describe('end to end', () => {
  let consumer, safya;

  before(async () => {
    safya = new Safya({ bucket: BUCKET })

    consumer = new SafyaConsumer({ name: 'test-consumer', bucket: BUCKET });
  });

  describe('the consumer', () => {
    it('should be able to read events after they are produced', async () => {
      await safya.writeEvent('foo');

      const events = await consumer.readEvents();

      expect(events[0].toString('utf8')).to.equal('foo');
    }).timeout(20000);
  });
});
