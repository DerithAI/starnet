import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");

function run(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env });
}

describe("cli", () => {
  it("prints the crew order without a key", () => {
    const env = { ...process.env };
    delete env.CURSOR_API_KEY;
    const result = run(["--dry-run", "document the crew"], env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /document the crew/);
    assert.match(result.stdout, /seats: cartographer, implementer, reviewer/);
    assert.match(result.stdout, /revision budget: 1/);
  });

  it("refuses a live run when the key is missing", () => {
    const env = { ...process.env };
    delete env.CURSOR_API_KEY;
    const result = run(["document the crew"], env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CURSOR_API_KEY/);
  });

  it("does not load the SDK for a dry run", () => {
    const env = { ...process.env };
    delete env.CURSOR_API_KEY;
    const probe = `
      import { registerHooks } from "node:module";
      const seen = [];
      registerHooks({
        load(url, context, nextLoad) {
          seen.push(url);
          return nextLoad(url, context);
        },
      });
      const { main } = await import(${JSON.stringify(pathToFileURL(cli).href)});
      const code = await main(["--dry-run", "document the crew"]);
      if (seen.some((url) => url.includes("@cursor/sdk"))) {
        console.error("sdk loaded during dry run");
        process.exit(3);
      }
      process.exit(code);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
  });
});
