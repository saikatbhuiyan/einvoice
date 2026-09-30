const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/authorizer'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
      // @grpc/proto-loader needs a real .proto file on disk at runtime — grpc.config.ts resolves
      // its path relative to __dirname *at runtime*, which after bundling is this app's own
      // dist/apps/authorizer directory, not libs/transports' source tree. Without this, the
      // ENOENT only shows up when the gRPC server actually tries to start, not at build time.
      assets: [{ input: '../../libs/transports/src/proto', output: 'proto', glob: '*.proto' }],
    }),
  ],
};
