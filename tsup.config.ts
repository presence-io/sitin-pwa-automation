import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { autobot: 'src/main.ts' },
  outDir: 'dist',
  format: ['iife'],
  globalName: 'AutoBot',
  platform: 'browser',
  target: 'es2020',
  minify: false,
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [/.*/],
});
