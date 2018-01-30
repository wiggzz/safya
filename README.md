
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

Finally, we will have issues with reading back the entire stream if we have many partitions. If we have a fixed number of partitions, this is easy because we simply iterate over the partitions and read back everything. But if we want to change the number of partitions we have as we go (some kind of auto-scaling) then we'll need to store items against their partition key, not the partition id of the time of production. Or, do we? If we change the number of partitions, that is fine if items are still in their old buckets - right? No, because we need to indicate ordering of the partitions if there is a change. I.e. if a partition splits, we need to know that the child partitions come after the parent partition for consumption purposes.

Really, partitioning isn't important for production, only for consumption. In fact, we don't know when we produce the data if our consumers can handle the data-rate we are putting out.

It would be nice to be able to store data in the true partition key, and then on consumption be able to find the keys that are relevant to a particular consumer.

We need a way of splitting the partitions among consumers for catch-up mode. Reading in real-time is easy because for each event, we trigger a consumer on that partition key. Ideally there would be a way to query the consumers. Oh, there should be. We switch the consumerId to be the primary HASH key for the table, and the partitionID is the RANGE key. Then we can query the partitions with 'startsWith' and make sure we are matching our relevant partition keys. Boom.

We need a deterministic algorithm for determining the begins_with to split the stream up by consumer.

BLAH. Except, before we have any consumer information, we need to be able to read the events in the partitions table, which are not ordered for us to be able to do so. We'll need to index the partitions table so we can sort by partition id. The real issue is that with an arbitrarily high number of partitions which are not indexed on how they will be read, we will need to check every partition to determine if this one matches our consumer and if we should read from it.
