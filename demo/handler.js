'use strict';
const { Safya, SafyaConsumer } = require('../src');

const safya = new Safya({ bucket: process.env.SAFYA_BUCKET });

module.exports.postEvent = (event, context, callback) => {
  safya.writeEvent(event.body).then(key => {
    const response = {
      statusCode: 200,
      body: JSON.stringify({
        status: 'success',
        key
      }),
    };

    callback(null, response);
  })
};
