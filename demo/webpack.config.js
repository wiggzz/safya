const path = require('path');

const defaultConfig = (filename) => ({
  entry: filename,
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: filename,
    libraryTarget: 'commonjs2'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /(node_modules|bower_components)/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                "targets": {
                  "node": "6.10"
                }
              }]
            ]
          }
        }
      }
    ]
  },
  target: 'node'
})

module.exports = [
  defaultConfig('application.js'),
  defaultConfig('safya-rest.js')
]
