module.exports = {
  displayName: 'invoice:integration',
  // Real infrastructure (Testcontainers / Chromium): opt-in via `nx run invoice:integration`,
  // never part of the default `nx test` run, which stays fast and Docker-free.
  testMatch: ['<rootDir>/src/**/*.int-spec.ts'],
  testTimeout: 180_000,
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/invoice-integration',
};
