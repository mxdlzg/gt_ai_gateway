import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules'],
    environment: 'node',
    globalSetup: ['./tests/globalSetup.worker.ts'],
    // Run tests sequentially to avoid database and port conflicts
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['node_modules', '**/*.test.ts', '**/*.spec.ts', 'tests/**'],
    },
    // Increase hookTimeout for wrangler dev startup time
    hookTimeout: 120000,
    // Pass TEST_MODE to forked processes
    poolOptions: {
      forks: {
        execArgv: [],
        env: {
          TEST_MODE: 'worker',
        },
      },
    },
  },
  // Environment variables
  env: {
    TEST_MODE: 'worker',
  },
})
