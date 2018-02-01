
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

Ok, so we have a bit of performance now. 1MB/s isn't bad, and it could scale much further I believe. However, we do have the issue that we needed to create a lot of partitions to prevent re-reads. Is there a way to design the partitions table so that we don't have this issue?

What about:
{
  "partitionId": "[partition-id]",
  "partitionKey": "[partition-key]",
  "sequenceNumber": "[sequence-Number]"
}

with a primary key as the partitionId, and partitionKey as the SORT key, because we only care about ordering for partitionKey. Then when we write, we increment the sequencNumber for the partitionKey, but on reading, we can simply scan the partitionId for items that need to be read.

Blah. Except, again, same problem as above. But, are these problems not all the same? With the way we write to dynamoDb, we will need a lot of partitions. With a lot of partitions, we will have difficulty scanning them.

So, maybe the process for reading needs to be better defined.

To read every event:

 1. Get a list of partitions
 2. For each partition, get a list of sorted partitionKeys (potentially billions of these if we are being scalable)
 3. For partitionKey, read all the events.

What happens if a new partitionKey is added to a partition while we are reading? How do we know we have read it?

Better to have many many partitions.

Then, to read:

 1. Get list of partitions (potentially many, like hundreds of thousands to millions)
 2. For each partition, read every event.

For an over-partitioned Safya, we will have many empty partitions if we start with some large default. Although, I guess we wont have an entry in the DB for any empty partition, so that will prevent over-reading.

For catch-up it isn't a problem to have to scan every item because we'd need to do it anyway. However, it's in the middle ground we might have issues. This is where the Active flag comes in for the consumer. We need to know when we receive a new event on a partition, if we can start a new consumer on that partition. If the partition consumer is Active, it should mean, we're guaranteed they will read the event that we have just been triggered for. If they are inactive, it means we need to read the event or it may never get read (because catch-up should only need to happen once since it is expensive). It would be nice to have an index of which consumer partitions are "caught-up".

Catch-up becomes even more problematic with lambda - it is difficult to have a long running process to manage the catch-up, so how do we keep state of the catch-up through time? We want to limit concurrency, so we cant kick off a lambda for every partition, and then each time it runs out of time, have it restart itself.

For facilitating catch-up, it might be possible to split the partitions in time as well as in key space. This way, when catching up, some partitions will be 'sealed' and we can progress logically through them with an assurance that no new items will be added to ones we have already processed.

OH Sick, dynamodb does support add and return values in a strongly consistent way! So we don't need tons of partitions.
