const AWS = require('aws-sdk');
const { promisifyAll } = require('bluebird');
const log = require('loglevel');
const { SafyaConsumer } = require('../../src');

const lambda = promisifyAll(new AWS.Lambda(), { suffix: 'Promise' });

const MAX_THREADS_PER_LAMBDA = 10;

const runProducerTest = async ({ functionName, eventSizeBytes, eventsPerSecond, timeoutMs, threadCount }) => {
  const startTime = Date.now();

  const requiredLambdas = Math.ceil(threadCount / MAX_THREADS_PER_LAMBDA);

  const { promises } = [...Array(requiredLambdas)].reduce(({ promises, remainingThreads }) => {
    const threadsInThisLambda = Math.min(MAX_THREADS_PER_LAMBDA, remainingThreads);

    const payload = {
      threadCount: threadsInThisLambda,
      delayMs: 1000 / eventsPerSecond, // this is approximate
      timeoutMs: timeoutMs,
      eventSizeBytes
    };

    const promise = lambda.invokePromise({
      FunctionName: functionName,
      Payload: JSON.stringify(payload)
    });

    return {
      promises: [promise, ...promises],
      remainingThreads: remainingThreads - threadsInThisLambda
    }
  }, {
    promises: [],
    remainingThreads: threadCount
  });

  const responses = await Promise.all(promises);

  const finishTime = Date.now();

  const stats = responses.reduce((memo, response) => {
    const result = JSON.parse(response.Payload);
    return {
      totalBytes: memo.totalBytes + result.totalBytes,
      eventsWritten: memo.eventsWritten + result.eventsWritten,
    };
  }, {
    totalBytes: 0,
    eventsWritten: 0
  });

  return {
    totalTimeMs: finishTime - startTime,
    ...stats
  };
};

const runConsumerTest = async ({ functionName, safyaConfig, readCountPerLambda }) => {
  const startTime = Date.now();

  const consumer = new SafyaConsumer({
    config: safyaConfig,
    name: 'performance-test-lambda-consumer'
  });

  const partitionIds = await consumer.getPartitionIds();

  const results = await Promise.all(partitionIds.map(async partitionId => {
    let done = false;

    const payload = {
      partitionId,
      count: readCountPerLambda
    };

    let totalBytes = 0;
    let eventsRead = 0;

    while (!done) {
      const { Payload } = await lambda.invokePromise({
        FunctionName: functionName,
        Payload: JSON.stringify(payload)
      });

      const result = JSON.parse(Payload);

      totalBytes += result.totalBytes;
      eventsRead += result.eventsRead;
      done = result.done;
    }

    return {
      totalBytes,
      eventsRead
    };
  }));

  const finishTime = Date.now();

  const stats = results.reduce((memo, result) => {
    return {
      totalBytes: memo.totalBytes + result.totalBytes,
      eventsRead: memo.eventsRead + result.eventsRead,
    };
  }, {
    totalBytes: 0,
    eventsRead: 0
  });

  return {
    totalTimeMs: finishTime - startTime,
    ...stats
  }
}

module.exports = {
  runProducerTest,
  runConsumerTest
};
