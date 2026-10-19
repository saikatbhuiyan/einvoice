module.exports = {
  displayName: 'pdf-generator:integration',
  // Real infrastructure (Testcontainers / Chromium): opt-in via `nx run pdf-generator:integration`,
  // never part of the default `nx test` run, which stays fast and Docker-free.
  testMatch: ['<rootDir>/src/**/*.int-spec.ts'],
  testTimeout: 180_000,
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // puppeteer-core 25 ships ESM only (its "require" export is ESM too). The app's webpack bundle
  // copes; Jest's module system needs it transformed — same pnpm-aware pattern as apps/bff.
  transformIgnorePatterns: ['node_modules/\\.pnpm/(?!(puppeteer-core|@puppeteer\\+browsers|chromium-bidi)@)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/pdf-generator-integration',
};
