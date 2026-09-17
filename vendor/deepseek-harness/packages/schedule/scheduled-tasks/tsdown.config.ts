import { defineConfig } from 'tsdown'

/**
 * Node-only Host service. Bundles the tsc-emitted runtime into the package-main
 * `lib/index.js` the Loader resolves when a cordis.yml names this package.
 */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
