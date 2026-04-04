<!-- docmeta
role: leaf
layer: 2
parent: docs/INDEX.md
children: []
summary: design for automatically resuming the same agent run after recoverable transient interruptions such as fetch failed
read_when:
  - the agent stops mid-task with a recoverable fetch or network error and should continue without manual "continue"
  - the implementation needs resume state, retry policy, UI copy, or scratchpad rules
skip_when:
  - the task is about crash recovery, process resurrection, or cross-run replay
source_of_truth:
  - user-reported recoverable "fetch failed" interruption behavior
  - current same-run manual continue behavior in the local runtime
-->

# 6cx3b Agent Auto-Resume Design

## Problem

In the current runtime, the agent sometimes stops mid-task because of a transient interruption such as `fetch failed`, a stream disconnect, or an unstable network/provider edge. In many of these cases, the run is not actually finished: the user can type `continue` and the agent resumes in the same conversation.

That means the system does not need full crash recovery for this class of failures. It needs a same-run auto-resume mechanism that can safely replace the user's manual `continue` step.

## Scope

This design only covers the following situation:

- the agent is in the middle of a task
- the run/thread/session still exists
- the interruption is recoverable and transient
- the current behavior shows that a manual `continue` can resume the task

Examples:

- `fetch failed`
- temporary network instability
- provider stream interruption
- short-lived gateway/proxy failure
- timeout-like interruptions where the same run is still resumable

## Non-goals

This design does not try to solve:

- worker/process crash recovery
- rebuilding lost context from checkpoints after a restart
- replaying unknown side effects after a write tool may or may not have completed
- starting a new agent to replace the current run
- general multi-agent recovery orchestration

## Design summary

Treat this class of failure as a **recoverable transient interruption**, not as task completion and not as a terminal failure.

When such an interruption happens:

1. keep the same run alive
2. mark it as recoverably interrupted
3. auto-trigger the same internal resume path that manual `continue` would use
4. resume the same run with a structured internal resume prompt
5. include a lightweight scratchpad so the model continues from the previous step instead of re-reading source unnecessarily
6. stop auto-resuming after a small bounded number of attempts and fall back to a paused/manual-continue state

The key principle is:

> Do not create a new run for this problem. Resume the existing run.

## Why this is the right abstraction

If the user can often recover the task just by sending `continue`, then the failure is not primarily a state-loss problem. It is a control-flow interruption problem.

The practical implication:

- the system should preserve the current run/thread
- the system should not treat the interruption as completed work
- the system should avoid re-synthesizing the task from scratch

## State model

Recommended run states:

- `running`
- `recoverable_error`
- `auto_resuming`
- `waiting_user`
- `completed`
- `paused`

Typical state flow:

1. `running`
2. transient error occurs, such as `fetch_failed`
3. transition to `recoverable_error`
4. scheduler invokes auto-resume
5. transition to `auto_resuming`
6. send internal resume message to the same run
7. return to `running`

If bounded retries are exhausted:

- transition to `paused`
- surface a visible manual continue control in the UI

## What should trigger auto-resume

### Primary trigger: structured recoverable error

Prefer structured runtime/provider events over UI-text parsing.

Examples:

- `fetch_failed`
- `network_error`
- `stream_disconnected`
- `provider_timeout`
- `connection_reset`

### Guard conditions

Only auto-resume when all of the following are true:

- the run was previously `running`
- the run is not `completed`
- the run is not `waiting_user`
- the run has not exceeded its auto-resume limit
- there is no known reason that the run must wait for explicit user input

### Fallback trigger

If the runtime cannot access structured error events and only has UI text, use a fallback matcher for phrases like:

- `fetch failed`
- `network error`
- `stream disconnected`
- `timeout`

This should be a fallback, not the preferred mechanism.

## Manual continue and auto-resume must share one path

Do not maintain separate logic for:

- user manually typing `continue`
- system automatically trying to continue after a recoverable interruption

Both should call the same internal operation, for example:

```ts
resumeRun(runId, reason)
```

Examples:

- manual user action -> `resumeRun(runId, "user_manual")`
- recoverable fetch failure -> `resumeRun(runId, "fetch_failed")`

This keeps behavior consistent and avoids one path drifting from the other.

## Resume the same run, not a new run

The implementation should explicitly preserve:

- the same `runId`
- the same conversation/thread context
- the same in-memory task state where available
- the same scratchpad/working memory

It should **not**:

- spawn a replacement run for the interruption
- re-submit the entire task as a new prompt
- re-scan the repository just because the stream dropped

## Scratchpad: minimum state to preserve continuity

A lightweight scratchpad is enough for this problem. Full checkpointing is not required.

Recommended fields:

```ts
interface ResumeScratchpad {
  goal: string
  phase: string
  lastCompletedStep?: string
  nextAction?: string
  readFiles: string[]
  findings: string[]
}
```

Example:

```json
{
  "goal": "Design dashboard implementation",
  "phase": "inspect project structure",
  "lastCompletedStep": "outlined verification checklist",
  "nextAction": "continue inspecting dashboard-related files",
  "readFiles": ["src/dashboard.tsx", "src/ws.ts"],
  "findings": [
    "the dashboard contains interval-based history views",
    "live updates depend on WebSocket events"
  ]
}
```

## Why scratchpad matters

Without a scratchpad, the resumed model turn is much more likely to:

- reopen the task from the beginning
- re-read previously opened source files
- restate already-known conclusions

With a scratchpad, the runtime can steer the model toward continuation instead of re-onboarding.

## Internal resume prompt

Do not send a bare `continue` when the system resumes automatically. Use a structured internal prompt.

Recommended template:

```text
Continue the current unfinished task.

Interruption reason:
{reason}

This is the same run, not a new task.

Current goal:
{goal}

Current phase:
{phase}

Last completed step:
{lastCompletedStep}

Next action:
{nextAction}

Already read files:
{readFiles}

Confirmed findings:
- ...

Rules:
1. Resume from the interruption point.
2. Do not restart the task from scratch.
3. Do not re-scan the repository unless necessary.
4. Do not re-read already opened files unless precise edits or verification require it.
5. Only stop when the task is complete or user input is actually required.
```

## Retry policy

Use a small bounded retry budget.

Recommended default:

- max auto-resume attempts: `3`
- delay schedule: `[0ms, 1000ms, 3000ms]`

Behavior:

- first recoverable interruption: retry immediately
- second recoverable interruption: retry after a short delay
- third recoverable interruption: retry after a slightly longer delay
- beyond limit: move to `paused`

Manual user continue should not be blocked by the auto-resume budget.

## UI behavior

The UI should not imply final failure immediately if the interruption is recoverable.

Recommended copy during retries:

- `Connection interrupted. Auto-resuming… (1/3)`
- `Connection interrupted. Auto-resuming… (2/3)`
- `Connection interrupted. Auto-resuming… (3/3)`

When budget is exhausted:

- `Run paused after repeated interruptions. Click continue to resume.`

If resume succeeds:

- show a lightweight inline status such as `Run resumed`

## Safety rules

For the user-reported target case, the main assumption is that manual `continue` already works. That makes this design intentionally lightweight.

Still, a few safety rules are useful:

- do not mark the run complete on a recoverable fetch/network interruption
- do not auto-resume if the runtime is explicitly waiting for user input
- if the system knows it is in an unresolved stateful tool transition, prefer pausing instead of blindly retrying

This keeps the design focused on the common same-run recoverable case without pretending to solve every edge case.

## Suggested implementation structure

### 1. Extend run state

Add:

- `status`
- `autoResumeCount`
- `lastRecoverableError`
- `scratchpad`

Example:

```ts
interface RunState {
  id: string
  status: "running" | "recoverable_error" | "auto_resuming" | "waiting_user" | "completed" | "paused"
  autoResumeCount: number
  lastRecoverableError?: string
  scratchpad: ResumeScratchpad
}
```

### 2. Add a recoverable-error classifier

```ts
function isRecoverableInterruption(event: RuntimeErrorEvent): boolean {
  return [
    "fetch_failed",
    "network_error",
    "stream_disconnected",
    "provider_timeout",
    "connection_reset",
  ].includes(event.code)
}
```

### 3. Add the shared resume path

```ts
async function resumeRun(runId: string, reason: string, source: "auto" | "manual") {
  const run = loadRun(runId)

  if (run.status === "completed" || run.status === "waiting_user") return

  if (source === "auto" && run.autoResumeCount >= 3) {
    run.status = "paused"
    return
  }

  if (source === "auto") {
    run.autoResumeCount += 1
  }

  run.status = "auto_resuming"
  const prompt = buildResumePrompt(run.scratchpad, reason)
  await sendInternalMessageToSameRun(runId, prompt)
  run.status = "running"
}
```

### 4. Wire provider/runtime error events into resume

```ts
function onRunError(runId: string, event: RuntimeErrorEvent) {
  const run = loadRun(runId)
  if (!isRecoverableInterruption(event)) return
  if (run.status !== "running") return

  run.status = "recoverable_error"
  run.lastRecoverableError = event.code

  scheduleAutoResume(runId, event.code)
}
```

### 5. Update scratchpad continuously

After each meaningful step, refresh:

- current phase
- last completed step
- next action
- read files
- durable findings

## Recommended acceptance criteria

The feature is successful when:

- a `fetch failed` interruption no longer requires the user to manually type `continue` in common same-run cases
- resumed turns continue the same task instead of starting a new one
- source re-reading is reduced because scratchpad state is preserved
- repeated interruptions eventually pause cleanly instead of looping forever
- manual continue still works and uses the same resume path

## Explicitly rejected approach

Do not solve this by only sending the model a larger history transcript.

Why not:

- transcript growth is noisy and unstable
- it does not reliably preserve next-step intent
- it makes the model more likely to reopen the task from the top

For this problem, lightweight structured run memory is higher leverage than raw conversation replay.

## Bottom line

For task `6cx3b`, the right solution is a **same-run auto-resume design for recoverable transient interruptions**.

The system should treat `fetch failed`-style interruptions as resumable control-flow breaks, not as finished runs and not as crash-recovery events. The implementation should preserve the existing run, invoke a shared resume path, include a lightweight scratchpad, and bound retries before falling back to a paused/manual-continue state.
