import { defineProject } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

/**
 * Vitest workspace configuration for Ceves library testing
 *
 * Dual Test Strategy:
 * - Unit tests: Run in Node environment with mocked Cloudflare bindings (fast, isolated)
 * - Integration tests: Run in Workers runtime with Miniflare bindings (realistic, validates against actual Workers APIs)
 *
 * Test File Naming Convention:
 * - *.test.ts → Unit tests (run in Node)
 * - *.integration.test.ts → Integration tests (run in Workers runtime)
 */
export default [
  // Unit tests project: Fast tests with mocked bindings in Node environment
  defineProject({
    plugins: [
      {
        name: 'cloudflare-workers-mock',
        resolveId(id) {
          if (id === 'cloudflare:workers') {
            return 'virtual:cloudflare-workers';
          }
        },
        load(id) {
          if (id === 'virtual:cloudflare-workers') {
            return 'export class DurableObject {}';
          }
        },
      },
    ],
    test: {
      name: 'unit',
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.ts'],
      exclude: ['src/**/*.integration.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [
          'node_modules/',
          'dist/',
          '**/*.test.ts',
          '**/*.integration.test.ts',
          '**/*.config.ts',
        ],
      },
    },
  }),
  // Integration tests project: Realistic tests with Miniflare bindings in Workers runtime
  defineWorkersProject({
    test: {
      name: 'integration',
      globals: true,
      include: ['src/**/*.integration.test.ts'],
      poolOptions: {
        workers: {
          miniflare: {
            // Automatic in-memory R2 bucket for testing
            r2Buckets: ['TEST_EVENTS_BUCKET'],
            // Automatic in-memory D1 database for testing
            d1Databases: ['TEST_SNAPSHOTS_DB'],
          },
        },
      },
    },
  }),
];
