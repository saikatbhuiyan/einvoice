const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/pdf-generator'),
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
      // EJS templates are read from disk at runtime by ejs.renderFile() — same non-JS-asset
      // bundling gap as libs/rate-limit's ratelimit.lua and libs/transports' .proto files:
      // webpack won't bundle a .ejs file into main.js just because TypeScript references its path
      // as a string, so it has to be copied into dist/ explicitly. The leading `./` on `input`
      // is load-bearing, not stylistic — Nx's own asset-path normalization only resolves a
      // relative `input` against this project's root when the string starts with `.`; without it
      // (a bare `'src/templates'`), it silently resolves against the *workspace* root instead
      // (where nothing exists), and `noErrorOnMissing: true` swallows the failure without a
      // warning — confirmed by checking dist/apps/pdf-generator/templates/ after a real build,
      // not assumed from the config alone, the same verification discipline the .proto assets in
      // the gRPC series were held to.
      assets: [{ input: './src/templates', output: 'templates', glob: '*.ejs' }],
    }),
  ],
};
