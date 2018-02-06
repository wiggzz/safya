const expect = require('chai').expect;
const sinon = require('sinon');
const testInfra = require('./test-infra');
const { Safya, SafyaConsumer, Partitioner } = require('../src');
const log = require('loglevel');
const tests = require('./common-tests');

log.setLevel('debug');

describe('end to end', function () {
  this.timeout(100000);

  const testConfiguration = async () => {
    const { safyaConfig } = await testInfra.describeTestStack();

    const safyaFactory = (params) => new Safya({
      config: safyaConfig,
      ...params
    });

    const consumerFactory = (params) => new SafyaConsumer({
      config: safyaConfig,
      ...params
    });

    return { safyaFactory, consumerFactory };
  };

  const configPromise = testConfiguration();

  tests(configPromise);
});
