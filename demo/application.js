const { Safya, SafyaConsumer } = require('safya');
const { promisifyAll } = require('bluebird');
const AWS = require('aws-sdk');
const dynamoDb = promisifyAll(new AWS.DynamoDB.DocumentClient({ region: 'us-east-1' }));
const lambda = promisifyAll(new AWS.Lambda({ region: 'us-east-1' }), { suffix: 'Promise' });

const PRODUCT_DETAILS_UPDATED = 'PRODUCT_DETAILS_UPDATED';
const PRODUCT_STOCK_UPDATED = 'PRODUCT_STOCK_UPDATED';

const safya = new Safya({ config: process.env.SAFYA_CONFIG });
const safyaConsumer = new SafyaConsumer({ name: 'demo-consumer', config: process.env.SAFYA_CONFIG });

const updateProductDetails = async ({ productId, details }) => {
  const payload = JSON.stringify({
    type: PRODUCT_DETAILS_UPDATED,
    productId,
    details
  });

  await safya.writeEvent(productId, payload);
}

const updateProductStock = async ({ productId, stock }) => {
  const payload = JSON.stringify({
    type: PRODUCT_STOCK_UPDATED,
    productId,
    stock
  });

  await safya.writeEvent(productId, payload);
}

const processEvent = async (rawEvent) => {
  const event = rawEvent.toString('utf8');
  console.log('Processing event', event);
  const payload = JSON.parse(event);
  if (payload.type === PRODUCT_DETAILS_UPDATED) {
    await dynamoDb.updateAsync({
      TableName: process.env.PRODUCT_TABLE,
      Key: {
        id: payload.productId
      },
      UpdateExpression: 'set details = :details',
      ExpressionAttributeValues: {
        ':details': payload.details
      }
    });
  } else if (payload.type === PRODUCT_STOCK_UPDATED) {
    await dynamoDb.updateAsync({
      TableName: process.env.PRODUCT_TABLE,
      Key: {
        id: payload.productId
      },
      UpdateExpression: 'set stock = :stock',
      ExpressionAttributeValues: {
        ':stock': payload.stock
      }
    });
  }
}

const getProduct = async (id) => {
  const { Item } = await dynamoDb.getAsync({
    TableName: process.env.PRODUCT_TABLE,
    Key: {
      id
    }
  });

  return Item;
}

const readAndReinvoke = async (event, context) => {
  const { Records: [ { Sns: { Message }}]} = event;

  const { partitionId } = JSON.parse(Message);

  const { done, eventsRead } = await safyaConsumer.readEvents({ partitionId }, processEvent);

  if (!done) {
    console.log(`Read ${eventsRead} events, but not finished. Reinvoking ${context.functionName}.`);
    await lambda.invokePromise({
      FunctionName: context.functionName,
      InvocationType: 'Event',
      Payload: event
    });
  }
}

module.exports = {
  updateProductDetails,
  updateProductStock,
  readAndReinvoke,
  getProduct
};
