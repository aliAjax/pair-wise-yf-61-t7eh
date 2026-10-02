import { build } from 'esbuild';
await build({
  entryPoints: ['.simtest/run.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.simtest/run.mjs',
  logLevel: 'warning',
  alias: { '@ngrx/store': './.simtest/ngrx-shim.mjs' }
});
