import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { rtlTextAlias } from './rtlTextAlias.js';

export default defineConfig({
  plugins: [react()],
  test: {
    alias: [rtlTextAlias],
    root: '.',
    globals: true,
    environment: './tests/environment/jsdom-native-abort.ts',
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: 'forks',
    // Default is one fork per core minus one — on a 12-core dev box that is 11
    // jsdom forks each running the setup file at once, which pins every core
    // and freezes the machine mid-run. Four keeps the box responsive.
    poolOptions: {
      forks: { maxForks: 4, minForks: 1 },
    },
    silent: false,
    reporters: ['verbose'],
    // A component whose request outlives its test dispatches setState after the
    // jsdom globals are gone, and react-dom reads `window` to pick an update lane —
    // the rejection then fails the whole run even with every test green. In React 18
    // a post-unmount setState is a no-op in production, so only that exact signature
    // is dropped here; anything else still fails the run. Components are still
    // expected to cancel their own requests (BackgroundTasksWidget, PlaceFormModal).
    onUnhandledError(error) {
      const err = error as { message?: string; stack?: string };
      return !(
        err?.message === 'window is not defined' &&
        typeof err.stack === 'string' &&
        err.stack.includes('react-dom')
      );
    },
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      // All .d.ts, not just vite-env: declaration files carry no executable
      // code, and their lcov entries can't resolve on the Sonar side (its
      // **/*.d.ts exclusion removes them from analysis), which surfaced as
      // "Could not resolve 2 file paths" warnings in every scan.
      exclude: ['src/main.tsx', 'src/**/*.d.ts'],
      // Without these the Client Tests job produced a report, uploaded it and
      // passed no matter what the number was — which is how coverage drifted
      // down to ~48% unnoticed. 85 across the board is the floor we do not want
      // to fall through, not a target: the suite currently sits well above it.
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
    css: false,
  },
});
