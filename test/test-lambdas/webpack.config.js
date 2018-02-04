const path = require('path');

module.exports = {
  entry: path.resolve(__dirname, 'src', 'handler.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'handler.js',
    libraryTarget: 'commonjs2'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /(node_modules)/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { "targets": { "node": "6.10" } }]
            ]
          }
        }
      }
    ]
  },
  target: 'node'
};
