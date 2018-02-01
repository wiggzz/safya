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

Currently, this code is a work in progress which means it'll be hard for you to use it, but feel free to check out the concepts and ideas and take what you need.

# Discussion

The PUT operation will be:

 1. Get sequence number for partition from DynamoDB
 2. Atomically increment sequence number for partition.
 3. Write /events/{partitionId}/{sequenceNumber}

Issues with this: if step 3 fails, we have an empty item. Is that an issue? Not really

For consumption of any given partition we have:

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
