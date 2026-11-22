import { defineConfig } from 'vitest/config';

// This Termux/aarch64 host has 8 logical CPUs but only ~1.9 GiB of available
// RAM. Several suites spawn real `node --import tsx src/index.ts` children
// (tests/helpers/raw-stdio.ts) via RawStdioClient in beforeAll. With Vitest's
// default `maxWorkers = CPUs - 1` every test file gets its own worker, so a
// full run spawned 33 forks, each of which can launch a tsx child: CPU + memory
// contention pushed cold starts past the 20 s per-test timeout even though the
// same files pass in isolation. Cap concurrency so at most a handful of tsx
// children exist at once, and give each test a ceiling that tolerates the
// occasional GC/scheduling pause on this constrained host. Assertions are
// unchanged; only scheduling and the deadline are adjusted.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 45000,
    hookTimeout: 45000,
    pool: 'forks',
    maxWorkers: 4,
    minWorkers: 1,
  },
});
