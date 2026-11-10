export const DEFAULT_MODEL = "composer-2.5";

export const SEAT_NAMES = ["cartographer", "implementer", "reviewer"] as const;

export type SeatName = (typeof SEAT_NAMES)[number];

export function cartographerPrompt(task: string): string {
  return [
    "You are the cartographer in a three-seat coding crew.",
    "Read the repository and map the task. Do not edit files, do not commit, and do not open a pull request.",
    "",
    "Task:",
    task.trim(),
    "",
    "Reply with these sections:",
    "FILES: the paths that matter, one per line",
    "BRIEF: what to change and what to leave alone",
    "RISKS: one short paragraph",
  ].join("\n");
}

export function implementerPrompt(task: string, brief: string): string {
  return [
    "You are the implementer in a three-seat coding crew.",
    "Apply the cartographer's brief. Keep the change limited to the task.",
    "Do not widen the diff, and do not invent a follow-up task.",
    "",
    "Task:",
    task.trim(),
    "",
    "Cartographer:",
    brief.trim() || "(no brief)",
  ].join("\n");
}

export function reviewerPrompt(task: string): string {
  return [
    "You are the reviewer in a three-seat coding crew.",
    "Inspect the working tree against the task. Do not edit files.",
    "Use git diff and git status when a shell is available. Otherwise read the files the implementer named.",
    "",
    "Task:",
    task.trim(),
    "",
    "Put notes first. End with a single line that is exactly one of:",
    "VERDICT: pass",
    "VERDICT: revise",
    "A revise verdict is the only follow-up the implementer will see.",
  ].join("\n");
}

export function revisionPrompt(notes: string): string {
  return [
    "The reviewer asked for one revision. Apply only these notes, then stop:",
    notes.trim() || "(no notes)",
  ].join("\n");
}

export type Verdict = "pass" | "revise" | "missing";

export function parseVerdict(text: string | undefined): { verdict: Verdict; notes: string } {
  const body = text ?? "";
  const lines = body.split(/\r?\n/);
  let idx = -1;
  let verdict: Verdict = "missing";
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = /^VERDICT:\s*(pass|revise)\s*$/i.exec(lines[i].trim());
    if (match) {
      idx = i;
      verdict = match[1].toLowerCase() as "pass" | "revise";
      break;
    }
  }
  if (idx < 0) return { verdict: "missing", notes: body.trim() };
  return { verdict, notes: lines.slice(0, idx).join("\n").trim() };
}

export function dispatcherBrief(task: string, runtime: "local" | "cloud"): string {
  const handoff = runtime === "local"
    ? "Local seats are separate agents on one working tree. The reviewer reads the implementer's files."
    : "Cloud seats are turns on one agent, so they share one clone. Do not assume a second VM.";
  return [
    `Coding crew (${runtime}). ${handoff}`,
    "Order: cartographer, implementer, reviewer. At most one revision.",
    "",
    "Task:",
    task.trim(),
  ].join("\n");
}
