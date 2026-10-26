import { isStartupFailure } from "./errors.js";
import {
  cartographerPrompt,
  implementerPrompt,
  parseVerdict,
  reviewerPrompt,
  revisionPrompt,
} from "./seats.js";

export interface TextResult {
  agentId: string;
  runId: string;
  status: "finished" | "error" | "cancelled";
  text: string;
  errorMessage?: string;
}

export interface ImplementerHandle {
  agentId: string;
  send(prompt: string): Promise<TextResult>;
}

export interface Seats {
  runtime: "local" | "cloud";
  map(prompt: string): Promise<TextResult>;
  openImplementer(): Promise<ImplementerHandle>;
  review(prompt: string): Promise<TextResult>;
  close(): Promise<void>;
}

export type CrewReport =
  | { kind: "pass"; runtime: "local" | "cloud"; summary: string; runs: TextResult[] }
  | { kind: "startup"; message: string; runs: TextResult[] }
  | { kind: "run-error"; seat: string; message: string; runs: TextResult[] }
  | { kind: "unresolved"; message: string; runs: TextResult[] };

export function exitCodeFor(report: CrewReport): number {
  if (report.kind === "pass") return 0;
  if (report.kind === "startup") return 1;
  return 2;
}

async function attempt<T>(label: string, op: () => Promise<T>, log: (line: string) => void): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (isStartupFailure(err) && err.isRetryable) {
      log(`${label} did not start (${err.message}); retrying once`);
      return await op();
    }
    throw err;
  }
}

function unfinished(seat: string, result: TextResult): CrewReport {
  return {
    kind: "run-error",
    seat,
    message: result.errorMessage || result.text || `${seat} ended ${result.status}`,
    runs: [result],
  };
}

export async function runCrew(task: string, seats: Seats, log: (line: string) => void = () => {}): Promise<CrewReport> {
  const runs: TextResult[] = [];
  let implementer: ImplementerHandle | undefined;
  try {
    const mapped = await attempt("cartographer", () => seats.map(cartographerPrompt(task)), log);
    runs.push(mapped);
    log(`cartographer agent ${mapped.agentId} run ${mapped.runId} ${mapped.status}`);
    if (mapped.status !== "finished") return { ...unfinished("cartographer", mapped), runs };

    implementer = await attempt("implementer", () => seats.openImplementer(), log);
    const implemented = await attempt(
      "implementer",
      () => implementer!.send(implementerPrompt(task, mapped.text)),
      log,
    );
    runs.push(implemented);
    log(`implementer agent ${implemented.agentId} run ${implemented.runId} ${implemented.status}`);
    if (implemented.status !== "finished") return { ...unfinished("implementer", implemented), runs };

    let review = await attempt("reviewer", () => seats.review(reviewerPrompt(task)), log);
    runs.push(review);
    log(`reviewer agent ${review.agentId} run ${review.runId} ${review.status}`);
    if (review.status !== "finished") return { ...unfinished("reviewer", review), runs };

    let verdict = parseVerdict(review.text);
    if (verdict.verdict === "revise") {
      const revised = await attempt("implementer", () => implementer!.send(revisionPrompt(verdict.notes)), log);
      runs.push(revised);
      log(`implementer agent ${revised.agentId} run ${revised.runId} ${revised.status}`);
      if (revised.status !== "finished") return { ...unfinished("implementer", revised), runs };
      review = await attempt("reviewer", () => seats.review(reviewerPrompt(task)), log);
      runs.push(review);
      log(`reviewer agent ${review.agentId} run ${review.runId} ${review.status}`);
      if (review.status !== "finished") return { ...unfinished("reviewer", review), runs };
      verdict = parseVerdict(review.text);
    }

    if (verdict.verdict === "pass") {
      return { kind: "pass", runtime: seats.runtime, summary: review.text.trim(), runs };
    }
    if (verdict.verdict === "missing") {
      return { kind: "run-error", seat: "reviewer", message: "reviewer did not report a verdict", runs };
    }
    return { kind: "unresolved", message: verdict.notes || "reviewer still requested a revision", runs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "startup", message, runs };
  } finally {
    await seats.close().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log(`close failed: ${message}`);
    });
  }
}
