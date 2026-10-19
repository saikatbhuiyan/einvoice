module.exports = {
  displayName: 'auth',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // Same pnpm-aware ESM allowlist as apps/bff/jest.config.cts — @nestjs/passport, @nestjs/axios,
  // jwks-rsa and jose ship "type": "module"; see that file for why the pattern targets .pnpm.
  transformIgnorePatterns: ['node_modules/\\.pnpm/(?!(@nestjs\\+passport|@nestjs\\+axios|jwks-rsa|jose)@)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/auth',
};
