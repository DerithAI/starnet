import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cartographerPrompt, implementerPrompt, parseVerdict, reviewerPrompt, revisionPrompt } from "../src/seats.js";

describe("seat prompts", () => {
  it("keeps the cartographer off the editor", () => {
    const prompt = cartographerPrompt("rename the health route");
    assert.match(prompt, /Do not edit files/);
    assert.match(prompt, /rename the health route/);
  });

  it("hands the cartographer brief to the implementer", () => {
    const prompt = implementerPrompt("rename the health route", "FILES:\nsidecar/index.js");
    assert.match(prompt, /sidecar\/index.js/);
    assert.match(prompt, /limited to the task/);
  });

  it("requires an exact reviewer verdict line", () => {
    assert.match(reviewerPrompt("ship it"), /VERDICT: pass/);
    assert.match(reviewerPrompt("ship it"), /VERDICT: revise/);
  });
});

describe("parseVerdict", () => {
  it("reads the last verdict and keeps the notes", () => {
    const parsed = parseVerdict("looks good\nVERDICT: pass\n");
    assert.equal(parsed.verdict, "pass");
    assert.equal(parsed.notes, "looks good");
  });

  it("uses the last verdict when the model mentions both", () => {
    const parsed = parseVerdict("not VERDICT: pass yet\nVERDICT: revise");
    assert.equal(parsed.verdict, "revise");
    assert.match(parsed.notes, /not VERDICT: pass yet/);
  });

  it("reports a missing verdict", () => {
    assert.equal(parseVerdict("no line here").verdict, "missing");
    assert.equal(parseVerdict(undefined).verdict, "missing");
  });

  it("puts reviewer notes into the one revision", () => {
    assert.match(revisionPrompt("drop the extra file"), /drop the extra file/);
  });
});
