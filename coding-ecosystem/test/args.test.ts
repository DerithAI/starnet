import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArgError, parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("defaults to a local crew and reads the key from the environment", () => {
    const args = parseArgs(["explain the sidecar"], { CURSOR_API_KEY: "cursor_test" }, "/workspace");
    assert.equal(args.runtime, "local");
    assert.equal(args.cwd, "/workspace");
    assert.equal(args.model, "composer-2.5");
    assert.equal(args.apiKey, "cursor_test");
    assert.equal(args.task, "explain the sidecar");
  });

  it("requires a repo for a live cloud run", () => {
    assert.throws(() => parseArgs(["--cloud", "ship it"], { CURSOR_API_KEY: "cursor_test" }), ArgError);
  });

  it("accepts a cloud repo and an explicit key", () => {
    const args = parseArgs(
      ["--cloud", "--repo", "https://github.com/acme/app", "--ref", "main", "--api-key", "cursor_explicit", "ship it"],
      {},
    );
    assert.equal(args.runtime, "cloud");
    assert.equal(args.repo, "https://github.com/acme/app");
    assert.equal(args.ref, "main");
    assert.equal(args.apiKey, "cursor_explicit");
  });

  it("lets a dry run omit the key", () => {
    const args = parseArgs(["--dry-run", "map the crew"], {});
    assert.equal(args.dryRun, true);
    assert.equal(args.apiKey, undefined);
  });

  it("rejects an empty task", () => {
    assert.throws(() => parseArgs(["--dry-run"], {}), /task is required/);
  });
});
