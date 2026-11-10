import { Agent, CursorAgentError, type AgentOptions, type SDKAgent, type SDKMessage } from "@cursor/sdk";
import type { ImplementerHandle, Seats, TextResult } from "./crew.js";
import { StartupFailure } from "./errors.js";
import type { CrewArgs } from "./args.js";

const READ_ONLY_TOOLS = ["read", "grep", "glob", "ls"] as const;
const REVIEW_TOOLS = ["read", "grep", "glob", "ls", "shell"] as const;

export function assistantDelta(event: SDKMessage): string {
  if (event.type === "assistant") {
    return event.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
  if (event.type === "thinking") return "";
  return "";
}

function failureFrom(err: unknown): StartupFailure {
  if (err instanceof CursorAgentError) return new StartupFailure(err.message, err.isRetryable);
  const message = err instanceof Error ? err.message : String(err);
  return new StartupFailure(message, false);
}

function baseOptions(args: CrewArgs, name: string): AgentOptions {
  return {
    apiKey: args.apiKey!,
    name,
    model: { id: args.model },
    local: {
      cwd: args.cwd,
      settingSources: [],
    },
  };
}

async function runSend(agent: SDKAgent, prompt: string, log: (line: string) => void): Promise<TextResult> {
  let run;
  try {
    run = await agent.send(prompt);
  } catch (err) {
    throw failureFrom(err);
  }
  log(`agent ${agent.agentId} run ${run.id}`);
  try {
    if (run.supports("stream")) {
      for await (const event of run.stream()) {
        const text = assistantDelta(event);
        if (text) log(text);
      }
    }
    const result = await run.wait();
    return {
      agentId: agent.agentId,
      runId: result.id,
      status: result.status,
      text: result.result ?? "",
      errorMessage: result.error?.message,
    };
  } catch (err) {
    throw failureFrom(err);
  }
}

async function dispose(agent: SDKAgent): Promise<void> {
  await agent[Symbol.asyncDispose]();
}

export function createSeats(args: CrewArgs, log: (line: string) => void): Seats {
  if (args.runtime === "cloud") return cloudSeats(args, log);
  return localSeats(args, log);
}

function localSeats(args: CrewArgs, log: (line: string) => void): Seats {
  let implementer: Awaited<ReturnType<typeof Agent.create>> | undefined;
  return {
    runtime: "local",
    async map(prompt) {
      const agent = await Agent.create({
        ...baseOptions(args, "coding-ecosystem cartographer"),
        tools: [...READ_ONLY_TOOLS],
      }).catch((err: unknown) => { throw failureFrom(err); });
      try {
        return await runSend(agent, prompt, log);
      } finally {
        await dispose(agent);
      }
    },
    async openImplementer(): Promise<ImplementerHandle> {
      implementer = await Agent.create({
        ...baseOptions(args, "coding-ecosystem implementer"),
      }).catch((err: unknown) => { throw failureFrom(err); });
      const agent = implementer;
      return {
        agentId: agent.agentId,
        send: (prompt) => runSend(agent, prompt, log),
      };
    },
    async review(prompt) {
      const agent = await Agent.create({
        ...baseOptions(args, "coding-ecosystem reviewer"),
        tools: [...REVIEW_TOOLS],
      }).catch((err: unknown) => { throw failureFrom(err); });
      try {
        return await runSend(agent, prompt, log);
      } finally {
        await dispose(agent);
      }
    },
    async close() {
      if (implementer) await dispose(implementer);
      implementer = undefined;
    },
  };
}

function cloudSeats(args: CrewArgs, log: (line: string) => void): Seats {
  let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
  const ensure = async () => {
    if (agent) return agent;
    agent = await Agent.create({
      apiKey: args.apiKey!,
      name: "coding-ecosystem",
      model: { id: args.model },
      cloud: {
        repos: [{ url: args.repo!, ...(args.ref ? { startingRef: args.ref } : {}) }],
        autoCreatePR: true,
        skipReviewerRequest: true,
      },
    }).catch((err: unknown) => { throw failureFrom(err); });
    return agent;
  };
  return {
    runtime: "cloud",
    map: async (prompt) => runSend(await ensure(), prompt, log),
    openImplementer: async () => {
      const held = await ensure();
      return { agentId: held.agentId, send: (prompt) => runSend(held, prompt, log) };
    },
    review: async (prompt) => runSend(await ensure(), prompt, log),
    async close() {
      if (agent) await dispose(agent);
      agent = undefined;
    },
  };
}
