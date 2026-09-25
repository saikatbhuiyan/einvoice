module.exports = {
  displayName: 'bff',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // @nestjs/passport, @nestjs/axios, jwks-rsa, and jose (jwks-rsa's own dependency) all ship
  // ESM-only ("type": "module") — Jest's default node_modules exclusion would otherwise leave
  // their `export`/`import` syntax untransformed and fail every spec that imports anything from
  // @libs/auth. pnpm's virtual store nests the real files under
  // `node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>`, so the pattern has to match inside
  // `.pnpm`, not the top-level `node_modules/<pkg>` symlink — a plain `node_modules/(?!<pkg>)`
  // only inspects the outermost `node_modules` segment and never reaches the real path.
  transformIgnorePatterns: ['node_modules/\\.pnpm/(?!(@nestjs\\+passport|@nestjs\\+axios|jwks-rsa|jose)@)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/bff',
};
