import { defineConfig } from 'tsup';

export default defineConfig([
  {
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
    esbuildOptions(options) {
      options.outfile = 'dist/autobot.js';
      delete options.outdir;
    },
  },
  {
    entry: { dashboard: 'src/dashboard/app.ts' },
    outDir: 'dist',
    format: ['iife'],
    globalName: 'AutoBotDashboard',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    noExternal: [/.*/],
    esbuildOptions(options) {
      options.outfile = 'dist/dashboard.js';
      delete options.outdir;
    },
  },
]);
