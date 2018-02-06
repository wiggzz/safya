require('source-map-support').install();
const application = require('./application');

const getProduct = (event, context, callback) => {
  application.getProduct(event.pathParameters.productId)
    .then(product => {
      const response = {
        statusCode: 200,
        body: JSON.stringify(product)
      };

      callback(null, response);
    })
    .catch(err => {
      console.error('Error in getProduct', err);
      const response = {
        statusCode: 500,
        body: 'Internal server error'
      };

      callback(null, response);
    });
};

const updateProductDetails = (event, context, callback) => {
  application.updateProductDetails(JSON.parse(event.body))
    .then(() => {
      const response = {
        statusCode: 204
      };

      callback(null, response);
    })
    .catch(err => {
      console.error('Error in updateProductDetails', err);
      const response = {
        statusCode: 500,
        body: 'Internal server error'
      };

      callback(null, response);
    })
};

const updateProductStock = (event, context, callback) => {
  application.updateProductStock(JSON.parse(event.body))
    .then(() => {
      const response = {
        statusCode: 204
      };

      callback(null, response);
    })
    .catch(err => {
      console.error('Error in updateProductStock', err);
      const response = {
        statusCode: 500,
        body: 'Internal server error'
      };

      callback(null, response);
    })
};

const handleEvent = (event, context, callback) => {
  application.readAndReinvoke(event, context)
    .then(() => callback())
    .catch(err => callback(err));
}

module.exports = {
  handleEvent,
  updateProductDetails,
  updateProductStock,
  getProduct
};
