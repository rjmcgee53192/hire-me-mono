// Plain-object config (no "vitest/config" import) so `npx vitest` works
// without a local vitest install; vitest accepts this shape directly.
export default {
  test: {
    include: ["src/**/*.test.ts"],
  },
};
