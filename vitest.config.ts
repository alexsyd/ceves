import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for Ceves library testing
 *
 * This file imports the workspace configuration which defines:
 * - Unit tests (Node environment with mocks)
 * - Integration tests (Workers runtime with Miniflare)
 *
 * See vitest.workspace.ts for the full configuration.
 */
export default defineConfig({
  test: {
    globals: true,
  },
});
