#!/usr/bin/env node
import { ArgError, helpText, parseArgs } from "./args.js";
import { exitCodeFor, runCrew } from "./crew.js";
import { dispatcherBrief } from "./seats.js";

function write(line: string): void {
  process.stderr.write(line.endsWith("\n") ? line : line + "\n");
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(helpText() + "\n");
    return 0;
  }
  if (args.dryRun) {
    process.stdout.write(dispatcherBrief(args.task, args.runtime) + "\n");
    process.stdout.write("seats: cartographer, implementer, reviewer\n");
    process.stdout.write("revision budget: 1\n");
    return 0;
  }
  const { createSeats } = await import("./runtime.js");
  const report = await runCrew(args.task, createSeats(args, write), write);
  if (report.kind === "pass") {
    process.stdout.write(report.summary + "\n");
    return 0;
  }
  write(report.kind === "startup" ? `startup failed: ${report.message}` : report.message);
  return exitCodeFor(report);
}

const entry = process.argv[1] && /cli\.(js|ts)$/.test(process.argv[1]);
if (entry) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err: unknown) => {
      if (err instanceof ArgError) {
        process.stderr.write(err.message + "\n" + helpText() + "\n");
        process.exitCode = 1;
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(message + "\n");
      process.exitCode = 1;
    });
}
