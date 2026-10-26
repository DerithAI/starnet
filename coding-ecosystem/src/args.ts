import { DEFAULT_MODEL } from "./seats.js";

export interface CrewArgs {
  task: string;
  cwd: string;
  runtime: "local" | "cloud";
  repo?: string;
  ref?: string;
  model: string;
  apiKey?: string;
  dryRun: boolean;
  help: boolean;
}

export class ArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgError";
  }
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): CrewArgs {
  let taskParts: string[] = [];
  let dir = cwd;
  let runtime: "local" | "cloud" = "local";
  let repo: string | undefined;
  let ref: string | undefined;
  let model = DEFAULT_MODEL;
  let apiKey = env.CURSOR_API_KEY;
  let dryRun = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new ArgError(`${arg} needs a value`);
      return value;
    };
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--cloud") runtime = "cloud";
    else if (arg === "--local") runtime = "local";
    else if (arg === "--cwd") dir = next();
    else if (arg === "--repo") repo = next();
    else if (arg === "--ref") ref = next();
    else if (arg === "--model") model = next();
    else if (arg === "--api-key") apiKey = next();
    else if (arg === "--") {
      taskParts = taskParts.concat(argv.slice(i + 1));
      break;
    } else if (arg.startsWith("--")) throw new ArgError(`unknown argument ${arg}`);
    else taskParts.push(arg);
  }

  const task = taskParts.join(" ").trim();
  if (!help && !task) throw new ArgError("a task is required");
  if (runtime === "cloud" && !help && !dryRun && !repo) throw new ArgError("--cloud requires --repo");
  if (!help && !dryRun && !apiKey) throw new ArgError("set CURSOR_API_KEY or pass --api-key");

  return { task, cwd: dir, runtime, repo, ref, model, apiKey, dryRun, help };
}

export function helpText(): string {
  return [
    "coding-ecosystem — cartographer, implementer, and reviewer on the Cursor SDK",
    "",
    "usage:",
    "  coding-ecosystem [--cwd dir] [--model id] [--dry-run] <task>",
    "  coding-ecosystem --cloud --repo <url> [--ref branch] <task>",
    "",
    "Local is the default: three agents share one working tree.",
    "Cloud is one agent and three turns on a fresh clone, and it opens a pull request.",
    "A live run needs CURSOR_API_KEY. --dry-run prints the crew order and does not call the SDK.",
  ].join("\n");
}
