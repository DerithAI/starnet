import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exitCodeFor, runCrew, type Seats, type TextResult } from "../src/crew.js";
import { StartupFailure } from "../src/errors.js";

function result(seat: string, text: string, status: TextResult["status"] = "finished"): TextResult {
  return { agentId: `agent-${seat}`, runId: `run-${seat}-${text.length}`, status, text };
}

function fakeSeats(reviewTexts: string[]): { seats: Seats; sends: string[]; closed: { value: boolean } } {
  const sends: string[] = [];
  const closed = { value: false };
  const reviews = [...reviewTexts];
  const seats: Seats = {
    runtime: "local",
    async map(prompt) {
      sends.push("map:" + prompt.slice(0, 12));
      return result("cartographer", "FILES:\nREADME.md\nBRIEF: touch the readme");
    },
    async openImplementer() {
      return {
        agentId: "agent-implementer",
        async send(prompt) {
          sends.push(prompt.includes("one revision") ? "revise" : "implement");
          return result("implementer", "edited README.md");
        },
      };
    },
    async review() {
      sends.push("review");
      return result("reviewer", reviews.shift() ?? "VERDICT: pass");
    },
    async close() {
      closed.value = true;
    },
  };
  return { seats, sends, closed };
}

describe("runCrew", () => {
  it("stops after a pass and closes the seats", async () => {
    const { seats, sends, closed } = fakeSeats(["notes\nVERDICT: pass"]);
    const report = await runCrew("document the crew", seats);
    assert.equal(report.kind, "pass");
    assert.deepEqual(sends.filter((item) => item === "review" || item === "implement" || item === "revise"), ["implement", "review"]);
    assert.equal(closed.value, true);
    assert.equal(exitCodeFor(report), 0);
  });

  it("allows one revision and then a second review", async () => {
    const { seats, sends } = fakeSeats(["needs a heading\nVERDICT: revise", "VERDICT: pass"]);
    const report = await runCrew("document the crew", seats);
    assert.equal(report.kind, "pass");
    assert.deepEqual(sends.filter((item) => !item.startsWith("map")), ["implement", "review", "revise", "review"]);
  });

  it("does not revise a second time", async () => {
    const { seats, sends } = fakeSeats(["VERDICT: revise", "still wrong\nVERDICT: revise"]);
    const report = await runCrew("document the crew", seats);
    assert.equal(report.kind, "unresolved");
    assert.equal(sends.filter((item) => item === "revise").length, 1);
    assert.equal(exitCodeFor(report), 2);
  });

  it("fails closed when the reviewer omits a verdict", async () => {
    const { seats } = fakeSeats(["looks fine"]);
    const report = await runCrew("document the crew", seats);
    assert.equal(report.kind, "run-error");
    if (report.kind === "run-error") assert.match(report.message, /verdict/);
  });

  it("retries a retryable startup failure once", async () => {
    let calls = 0;
    const seats: Seats = {
      runtime: "cloud",
      async map() {
        calls += 1;
        if (calls === 1) throw new StartupFailure("timeout", true);
        return result("cartographer", "BRIEF: ok");
      },
      async openImplementer() {
        return { agentId: "agent-implementer", async send() { return result("implementer", "done"); } };
      },
      async review() { return result("reviewer", "VERDICT: pass"); },
      async close() {},
    };
    const lines: string[] = [];
    const report = await runCrew("task", seats, (line) => lines.push(line));
    assert.equal(report.kind, "pass");
    assert.equal(calls, 2);
    assert.match(lines.join("\n"), /retrying once/);
  });

  it("does not retry a non-retryable startup failure", async () => {
    let calls = 0;
    const seats: Seats = {
      runtime: "local",
      async map() {
        calls += 1;
        throw new StartupFailure("invalid api key", false);
      },
      async openImplementer() { throw new Error("should not open"); },
      async review() { throw new Error("should not review"); },
      async close() {},
    };
    const report = await runCrew("task", seats);
    assert.equal(report.kind, "startup");
    assert.equal(calls, 1);
    assert.equal(exitCodeFor(report), 1);
  });
});
