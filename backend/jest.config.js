/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        target: 'ES2021',
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strictPropertyInitialization: false,
        strictNullChecks: false,
      }
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@nestjs|@google|openai|bullmq|ioredis)/)',
  ],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../jest.setup.js'],
};
