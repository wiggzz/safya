
# Discussion

Ok, we're going to move to a DynamoDB based sequencing model, which will be significantly more reliable and easier to control consistency.

Potentially the PUT operation will be:

 1. Get sequence number for partition from DynamoDB
 2. Atomically increment sequence number for partition. On failure, go to 1
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
  "active": true | false
}

with a primary key of Id and a sort/range key of ConsumerId
