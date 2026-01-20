import { describe, it, expect } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CodeAnalyzer } from "../../documentation/CodeAnalyzer.js";

describe("CodeAnalyzer", () => {
  it("collects code files and applies filters", async () => {
    const root = mkdtempSync(join(tmpdir(), "cccmemory-code-"));

    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
      mkdirSync(join(root, "dist"), { recursive: true });

      writeFileSync(join(root, "README.md"), "# Readme");
      writeFileSync(join(root, "src", "index.ts"), "export const value = 1;");
      writeFileSync(join(root, "src", "notes.txt"), "ignore");
      writeFileSync(join(root, "node_modules", "dep", "index.js"), "ignore");
      writeFileSync(join(root, "dist", "bundle.js"), "ignore");

      const analyzer = new CodeAnalyzer();
      const result = await analyzer.analyze(root);
      const paths = result.files.map((file) => file.path).sort();

      expect(paths).toEqual(["README.md", "src/index.ts"]);

      const filtered = await analyzer.analyze(root, "src");
      const filteredPaths = filtered.files.map((file) => file.path);
      expect(filteredPaths).toEqual(["src/index.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
