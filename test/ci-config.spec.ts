import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("CI configuration", () => {
  it("runs the required validation stages with a locked dependency install", async () => {
    const workflow = await readFile(resolve(__dirname, "../.github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm test -- --runInBand");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("node-version: 22");
  });

  it("keeps Nest incremental metadata inside the disposable build output", async () => {
    const tsconfig = JSON.parse(
      await readFile(resolve(__dirname, "../tsconfig.build.json"), "utf8"),
    );
    expect(tsconfig.compilerOptions.tsBuildInfoFile).toBe("./dist/tsconfig.build.tsbuildinfo");
  });
});
