// Plain-object config (no `vitest/config` import) so `npx -y vitest run`
// works even when the package's devDependencies aren't installed locally.
export default {
  test: {
    include: ["src/**/*.test.ts"],
  },
};
