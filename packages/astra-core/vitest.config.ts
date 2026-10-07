// Minimal vitest config. Plain object (no "vitest/config" import) so the
// config loads even when vitest is executed via `npx -y vitest` without a
// local install.
// @ts-nocheck
export default {
  test: {
    include: ["src/**/*.test.ts"],
  },
};
