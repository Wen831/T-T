import { defineConfig } from 'tsdown'

export default defineConfig({
  // Root barrel + i18n metadata barrel + one entry per locale (lazy-load chunks)
  // + the road-trip planner barrel, exposed as @trek/shared/roadtrip (4.3.0)
  entry: ['src/index.ts', 'src/roadtrip/planning.ts', 'src/i18n/index.ts', 'src/i18n/*/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  deps: {
    neverBundle: ['zod'],
  },
  target: false,
})
