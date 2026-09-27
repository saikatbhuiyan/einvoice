module.exports = {
  displayName: 'user-access',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // @nestjs/axios ships ESM-only ("type": "module") — pulled in transitively via
  // KeycloakAdminService (@libs/auth/keycloak-admin.service). Same fix as apps/bff/jest.config.cts;
  // see the note there for why the pattern has to match inside node_modules/.pnpm specifically.
  transformIgnorePatterns: ['node_modules/\\.pnpm/(?!(@nestjs\\+axios)@)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/user-access',
};
