# Coding ecosystem

A three-seat crew on the [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript):

1. **Cartographer** reads the tree and writes a brief. Local runs give it only read tools.
2. **Implementer** applies that brief.
3. **Reviewer** inspects the result and ends with `VERDICT: pass` or `VERDICT: revise`.

The dispatcher allows one revision. It disposes every agent, logs `agent` and `run` ids, and uses separate exit codes for a run that never started and a run that started and failed.

Local is the default. The three agents share `--cwd`. Cloud is one agent and three turns on a fresh clone, because each cloud agent has its own VM. A cloud run opens a pull request and does not request the caller as a reviewer.

## Run

```bash
cd coding-ecosystem
npm ci
export CURSOR_API_KEY=cursor_...
npm run build
node dist/src/cli.js --cwd /path/to/repo "Describe the change"
node dist/src/cli.js --cloud --repo https://github.com/org/repo "Describe the change"
node dist/src/cli.js --dry-run "Describe the change"
```

`--dry-run` prints the crew order and does not load the SDK. A live run passes `apiKey` explicitly and loads `@cursor/sdk` only after the arguments check out. Local agents load no ambient Cursor settings (`settingSources: []`). The cartographer's local tool list is `read`, `grep`, `glob`, and `ls`. The reviewer's local list adds `shell` so it can run `git diff`. Cloud runs omit that list; the cloud API rejects a local tool allowlist.

Exit `0` is a pass or a dry run. Exit `1` means the run never started (`CursorAgentError`, bad arguments, or a missing key). Exit `2` means a seat ran and failed, the reviewer omitted a verdict, or the reviewer still asked for changes after the one revision.
