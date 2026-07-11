import { defineConfig } from 'vitest/config'

// Unit tests for the framework packages. Node environment (no DOM) — these
// cover pure logic: the client core state machine, server helpers, and
// protocol guards. React-hook/component tests (bindings.tsx) are a separate
// effort needing an RN test env (see issue #10).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    // apps/ hold the e2e/device suites, not unit tests.
    exclude: ['**/node_modules/**', 'apps/**'],
  },
})
