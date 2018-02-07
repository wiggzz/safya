# Safya

## Why would you want it

Safya is a simple, scalable, unified log using S3 and DynamoDB. Its goal is to provide a no-configuration, serverless unified log solution which has these characteristics:

  - guaranteed at least once delivery
  - ALCAP (as little configuration as possible)
  - persistent, cost effective storage (stores objects in S3)
  - moderate through-put (although, if you need massive throughput, probably just use kafka)

## How does it work

Safya is modeled on Kafka, although it currently only supports a single topic, but adding additional topics should not be a large extension (or, just spin up multiple Safya stacks). Events in Safya are split into multiple partitions, which are determined by a partition key which is associated with each event. Event data can be arbitrary binary blobs (or whatever you want).

When an event is written to Safya, the producer determines the partition to write it, obtains a sequence number for the given partition (via dynamo DB) and then writes the event to `/events/${partitionId}/${sequenceNumber}` in S3.

Consumers just need to track a single sequence number in each partition they are reading from (this is also managed by DynamoDB). In addition, consumers obtain a lock to the partition they are reading from to ensure no more than one consumer reads at once. This lock has an expiration time in case they fail, which allows another consumer to take over should the consumer fail.

## Getting started

The set up is not as simple as I would love it to be, but here's some basic steps to get started. Please check the `demo/` folder for an example set up.

First, launch the Safya cloudformation template (https://s3.amazonaws.com/safya/versions/0.2.8/stack.yml)

[![Launch Safya Stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)][ https://console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=safya&templateURL=https://s3.amazonaws.com/safya/versions/0.2.8/stack.yml ]

Once that is launched, you can use Safya in your code. First, install

```shell
yarn add safya
```

Grab the Safya Config string from the stack output parameters:

```shell
aws cloudformation describe-stacks --stack-name safya --query 'Stacks[0].Outputs[?OutputKey==`ConfigString`].OutputValue' --output text
```

And then produce some events:

```javascript
const { Safya } = require('safya');

const safya = new Safya({ config: '<config string from above>' });

safya.writeEvent('partition-key', 'i am an event, i will be written in binary to s3')
  .then(() => console.log('event written'));

// event written
```

Then, you can read back events from a partition:

```javascript
const { SafyaConsumer } = require('safya');

const safyaConsumer = new SafyaConsumer({ config: '<config string from above>' });

safyaConsumer.getPartitionId({ partitionKey: 'partition-key' })
  .then(partitionId => {
    return safyaConsumer.readEvents({ partitionId }, (event) => {
      console.log('Got an event:', event.toString('utf8'));
    });
  });

// Got an event: i am an event, i will be written in binary to S3
```

Check out the source code for more details.


# Discussion

The PRODUCE operation will be:

1. Get sequence number for partition from DynamoDB
2. Atomically increment sequence number for partition.
3. Write /events/{partitionId}/{sequenceNumber}

Issues with this: if step 3 fails, we have an empty item. Is that an issue? Not really

The CONSUME operation of any given partition is:

1. Get consumer state for this consumer and this partition (seq. number, whether the consumer is Active or Inactive)
2. If the consumer is Inactive, we know no one else is currently reading from the stream. If the consumer is Active (and the last updated is within a reasonable expiration time), someone else is reading currently, so stop.
3. Check if the consumer is up to date (is the partition sequence number the same as the consumer sequence number). If the consumer is up to date, mark as Inactive, and stop
4. If the consumer is not up to date, read next item(s).
5. On successful processing of the item(s), increment the sequence number. Go back to 3.
6. On completion of reading, mark consumer Inactive.

We'll still have orchestration issues for long running consumer process, but it can be handled by at the end of a consumer lambda finishing, if we still haven't caught up, trigger a notification for initiating another consumer.

Additionally, on any new items in a partition, trigger a new consumer for that partition.

So, items in the Partitions table will be of the form
{
  "partitionId": "[partition-id]",
  "sequenceNumber": "[sequence-number]"
}

With a primary key of Id and no sort/range key.

Items in the Consumers table will be of the form
{
  "partitionId": "[partition-id]",
  "consumerId": "[consumer-id]",
  "sequenceNumber": "[sequence-number]",
  "activeThreadId": "[thread id of active consumer]",
  "activeExpiration": "[time that the active consumer should be considered expired]"
}

with a primary key of Id and a sort/range key of ConsumerId

## Real-time consumption

There are several ways of thinking about this. Ideally, as soon as an event is produced, the consumers should be informed, and they can read from the stream and get themselves up to date. In practice, this is more difficult to achieve across a scalable architecture. Kafka has a long-poll solution which I really like. Kinesis has a 1 second poll which isn't as good in my opinion. I would like to be able to trigger a consumer lambda in a configurable way - i.e. the user can specify what the maximum latency is. The trick is to be able to debounce incoming messages and trigger the consumers at the right point in time. Doing a distributed debounce though will require essentially doubling the write/read load on dynamodb - or does it?

Can we put some info in the production partitions table which will help us debounce the message triggers? Debounce requires waiting. One way to implement would be to have each production of a message kick of a debounce check - if it has been longer than X ms since the last 'trigger', trigger immediately. If it has been less, we need to wait - but we only want one waiter so we'll need a way to tell other new waiters who are created when new messages are created inside the wait time that we wont need them.

We could put a `triggerTime` entry in the production table, against partitionId, which is a timestamp when we want the next trigger to occur. If a message arrives and the previous `triggerTime` value was less than now (ie the previous message has been triggered), then we set the `triggerTime` to now + some delay, and wait until that point in time. If more messages have entered in that time, we trigger again. Otherwise, we stop. So, thinking through that a bit more, in pseudo code, the TRIGGER operation is (which will be interleaved with PRODUCE):

1. We should have `notifyWaitStartTime` from the PRODUCE operation above (the last event time before this event).
2. If `notifyWaitStartTime` is less than `maxLatencyMs` ago, we know the previous waiter is still waiting for new events, and they will capture our event when they finish. We don't update `notifyWaitStartTime`.
3. If `notifyWaitStartTime` is greater than `maxLatencyMs` ago, we know that the previous waiter has stopped waiting. Therefore, trigger a new notification on this partition, update `notifyWaitStartTime` to now, and wait for `maxLatencyMs`.
4. After waiting, check for any new messages. If there are more, trigger a notification, and stop.

Are there race conditions here? Yes. If after the timer finishes, we have an event produced. Then the producer of that event will check the time, and determine that they need to trigger a notification. They will then trigger a notification, but the waiter may also trigger a new notification because the timer has just ended. This isn't too big a deal because one of the consumer threads on the other side of the notification will get a lock and begin reading, and I suppose it is better to have two notifications than none.

The other issue is, if a consumer fails during consumption, then that event won't be read in real-time - although SNS will provide retrying on lambdas, so that should be ok - it will most likely only happen as a result of a logic error (not operational error).

Let's test it!
