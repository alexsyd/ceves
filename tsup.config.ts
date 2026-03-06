import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true, // Re-enable to check errors
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  minify: false,
  external: ['cloudflare:workers'],
});
