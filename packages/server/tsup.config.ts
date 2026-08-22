import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  external: ['@mock-knight/core', '@mock-knight/adapter-wiremock', 'better-sqlite3'],
})
