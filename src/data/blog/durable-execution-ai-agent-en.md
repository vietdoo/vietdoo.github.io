---
title: "Durable Execution for AI Agents: Checkpoints, Resume, and Safe Retries"
description: "How to make a long-running AI workflow survive crashes, timeouts, duplicate delivery, and human waiting without turning recovery into a second application."
pubDate: 2026-07-14
category: "engineering"
image: "/blog/durable-agent/hero.webp"
lang: "en"
translationKey: "durable-execution-ai-agent"
draft: false
---

![An AI agent workflow continues from durable checkpoints after a worker crash](/blog/durable-agent/hero.webp)

<figure class="blog-video">
  <video controls preload="metadata" playsinline poster="/blog/durable-agent/hero.webp" aria-label="Explainer video for this article, English version">
    <source src="/blog/durable-execution-ai-agent/video-en.mp4" type="video/mp4" />
    Your browser does not support HTML5 video.
  </video>
  <figcaption>Deep-dive explainer video: English version.</figcaption>
</figure>

A chatbot request is short enough to fit inside one HTTP timeout. A useful agent workflow often is not.

It may need to inspect several systems, wait for an approval, retry a provider, sleep until a deadline, process a large document, or resume after a deployment. The moment an agent crosses that boundary, the usual `try/catch` around a model call is no longer a reliability design. It is only a local reaction to one failure.

The uncomfortable question is simple: **if the process disappears after step four, what exactly tells the system where to resume, which work has already happened, and which effects are safe to repeat?**

This is the problem that durable execution addresses. Temporal defines it as “crash-proof execution”: an abstraction that allows application work to resume after process or machine failure while preserving the state required to continue.[1] The phrase is useful, but an agent adds complications. Model responses are nondeterministic, tool calls may have side effects, context can be compacted, and the user may wait hours or days between steps.

This article treats durable execution as a workflow architecture for AI agents. It is not a product tutorial and it is not a claim that a workflow engine removes all failure. The design still needs idempotent effects, explicit timeouts, retry budgets, leases, versioning, and reconciliation.

> **The thesis:** Make the workflow durable, but make side effects explicit. Checkpoint the agent’s state and decisions; never assume that replaying a model call is equivalent to replaying a database write, email, payment, or external API request.

## A process is not a workflow

In a normal process, local variables, call stacks, and in-memory queues disappear when the process disappears. If the application completed steps A and B, crashed during C, and had no durable record, the next process cannot know whether B was committed, partially completed, or never started.

A durable workflow changes the abstraction. The worker is replaceable; the workflow history is not. A new worker can reconstruct the state that matters and continue from a known point.

![A workflow event history preserves checkpoints and lets a new worker replay completed steps](/blog/durable-agent/checkpoint-ledger.webp)

For an AI agent, the durable state should distinguish at least four layers:

| Layer | What belongs there | What should not be assumed |
|---|---|---|
| Intent | User request, tenant, authority, deadline, policy version | That the original prompt will remain available forever. |
| Workflow state | Current step, completed facts, pending decisions, retry counters | That an in-memory agent object is the source of truth. |
| Evidence | Tool results, retrieved references, validation outcomes, hashes | That a model can reproduce an old observation exactly. |
| Effects | Emails, tickets, payments, mutations, outbound messages | That a retry is harmless merely because the request has the same text. |

The distinction between state and evidence is important. A model can be asked to summarize a previous tool result, but the result itself should be stored as a durable artifact or a reference to one. Otherwise recovery may silently query a changed system and make a different decision from the original run.

## Checkpoints are semantic boundaries

A checkpoint is not necessarily a snapshot of every token in a model context. It is a durable record at a point where the workflow can be reconstructed without ambiguity.

Good checkpoint boundaries usually happen after a meaningful unit of work:

* the task has been classified and policy-checked;
* a read-only tool returned a validated result;
* a plan was approved or frozen for the next stage;
* a human decision was received;
* an external effect returned an idempotent receipt;
* a failure was classified and a retry budget was decremented.

A useful checkpoint record might look like this:

```json
{
  "workflow_id": "wf_2026_07_14_0042",
  "version": 3,
  "step": "prepare_case_reply",
  "status": "waiting_for_effect",
  "tenant_id": "tenant-17",
  "policy_version": "policy-2026-06-02",
  "facts": ["case_exists", "documents_missing"],
  "evidence_refs": ["obj://evidence/7b2..."],
  "next_action": "create_draft",
  "retry_budget": {"model": 2, "tool": 1},
  "updated_at": "2026-07-14T10:20:00Z"
}
```

The record intentionally stores a compact state rather than a giant prompt transcript. Full inputs and outputs may live in an encrypted evidence store with retention controls. The workflow history should point to those artifacts, record their content hashes, and capture the schema version needed to interpret them.

This is not the same as [agent handover](/blog/agent-handover-architecture). Handover transfers responsibility between agents or sessions. Durable execution preserves a runtime workflow so that the same work can continue after a crash, timeout, deployment, or long human wait.

## Resume is a state-machine problem

A reliable agent should be designed as a state machine even if the implementation uses ordinary functions. The states should describe business progress, not model mood.

```text
RECEIVED
  -> POLICY_CHECKED
  -> CONTEXT_READY
  -> PLAN_RECORDED
  -> TOOL_READ_COMPLETED
  -> DECISION_VALIDATED
  -> EFFECT_REQUESTED
  -> EFFECT_CONFIRMED
  -> COMPLETED
```

Each transition needs a precondition and an evidence requirement. `EFFECT_CONFIRMED` must not be inferred from the model saying “done”; it needs a provider receipt, a database version, or a reconciliation result. If a worker crashes after sending an email but before writing the confirmation, recovery must consult the effect ledger before sending again.

![A failed worker disappears, then a replacement worker replays the durable state and resumes from the last safe checkpoint](/blog/durable-agent/replay-recovery.webp)

The resume algorithm should be boring:

```python
def resume(workflow_id):
    state = history.load_latest(workflow_id)
    verify_schema(state.version)
    verify_policy_still_allows(state)

    if state.status == "waiting_for_effect":
        receipt = effects.lookup(state.effect_key)
        if receipt:
            return advance_from_receipt(state, receipt)
        return retry_or_reconcile_effect(state)

    if state.status == "waiting_for_human":
        return wait_for_decision(state)

    return run_next_deterministic_step(state)
```

The function should not call a model before it knows what the workflow state means. It should not assume that the most recent worker had enough time to write a checkpoint. It should also be able to refuse resume when the workflow version or policy has become incompatible.

## Retry model calls, not business effects, by default

AI systems make retry tempting. A provider times out, the response is malformed, or a tool result is lost. Yet retrying all workflow logic is unsafe.

A model completion is usually a candidate computation. If it is repeated, the application can validate the result and decide whether the difference matters. An email, refund, account mutation, or ticket creation is an effect. Repeating it may create harm.

Use different retry policies for different boundaries:

| Boundary | Typical failure | Retry posture |
|---|---|---|
| Model call | Timeout, rate limit, invalid structured output | Bounded retry with backoff; validate every result. |
| Read-only tool | Temporary dependency failure | Retry with timeout and circuit breaker. |
| Human wait | No response yet | Do not retry; persist a timer or subscription. |
| Write effect | Ambiguous network result | Query by idempotency key and reconcile before retry. |
| Workflow transition | Version conflict | Reload state and apply a deterministic transition. |

A retry budget should be part of durable state. Otherwise a process restart can reset the counter and create an infinite loop over many workers. Backoff should include jitter, and the system should distinguish transient errors from permanent contract errors. A malformed tool argument is not repaired by sending the same request ten more times.

This is adjacent to, but distinct from, the exact-once effects problem. Durable execution tells the workflow where it was. Idempotency and an effect ledger tell the external world whether an effect already happened. You need both.

## Leases prevent two workers from acting at once

Durable storage alone does not prevent duplicate workers. A timeout may convince the queue that a worker is dead while the original worker is still running. A deployment may start a replacement before the old process has released its resources. Two workers can then attempt the same step.

Use a lease with an owner, expiry, and fencing token. The worker must renew it while executing and include the token when committing a checkpoint or effect intent. A stale worker may still finish its local computation, but the storage layer rejects its commit.

```sql
UPDATE workflow_steps
SET status = 'completed', result_ref = :result, fencing_token = :token
WHERE workflow_id = :id
  AND step = :step
  AND lease_owner = :owner
  AND fencing_token = :token
  AND lease_expires_at > CURRENT_TIMESTAMP;
```

This does not make external providers transactional. It only prevents stale workers from advancing the workflow’s own state. The external effect still needs an idempotency key, a provider-side lookup, or a reconciliation job.

## Long waits are part of the workflow

An agent may need to wait for a human approval, a document, a scheduled date, or a slow external process. Keeping a worker thread alive is wasteful and fragile. Durable execution lets the workflow sleep without treating the sleep as a running process.

![Long-running agent jobs wait, wake, retry, and move across a worker pool while sharing durable history](/blog/durable-agent/worker-pool.webp)

The workflow should persist the wake-up condition, not merely set an in-memory timer:

| Wait type | Durable representation | Resume trigger |
|---|---|---|
| Human approval | Pending decision with approver and expiry | Signed decision event. |
| External job | Correlation ID and expected terminal states | Webhook or polling result. |
| Time deadline | UTC timestamp and timezone policy | Scheduler event. |
| Missing data | Required fields and owner | New document or user response. |
| Rate limit | Retry-after and budget | Timer plus provider health check. |

The workflow must also define what happens when the wait expires. A timeout should lead to a named state—cancelled, escalated, or needs-information—not to a hidden exception that disappears from the user’s view.

## Replay is not free determinism

A durable engine may replay workflow code to reconstruct state. That code must therefore be deterministic at the workflow layer. Avoid reading the current time directly, generating random identifiers inside replayed logic, making network calls from workflow code, or depending on mutable global state.

Put nondeterministic work behind activities or task boundaries. Record the result and replay the recorded result rather than calling the provider again during reconstruction. For model calls, store the request metadata, model target, relevant prompt or context reference, response, validation result, and policy version according to your retention policy.

Model nondeterminism also affects semantic replay. Even when the workflow resumes from the same checkpoint, a new model call can produce a different plan. That is acceptable only if the step is designed as a new decision with explicit constraints. It is not acceptable if the system treats replay as proof that the same side effect should happen again.

Schema and workflow versions should be explicit. A deployment may change a state name, add a required field, or alter the meaning of a tool result. Either support old histories with compatibility code or pin the workflow to a version until all old runs have drained.

## Failure injection is the real tutorial

A durable workflow is not finished when the happy path completes. Test the points where engineers normally say “the process probably will not die there.” Kill the worker after a model response but before the checkpoint. Kill it after an effect request but before the receipt. Delay a webhook, duplicate it, reorder events, expire a lease, deploy a new workflow version, and return a malformed tool result.

The test should assert outcomes, not only that the workflow eventually returns a final string.

| Failure injection | Expected invariant |
|---|---|
| Crash before checkpoint | The step may run again, but no unprotected effect is duplicated. |
| Crash after effect request | Recovery queries the effect ledger before retrying. |
| Duplicate webhook | One transition is accepted; duplicates are harmless. |
| Worker lease expiry | The stale worker cannot commit a fenced result. |
| Provider returns malformed JSON | Retry is bounded and the workflow reaches a visible failure state. |
| Workflow version changes | Existing runs remain compatible or are explicitly migrated. |

This testing style complements the [agent regression suite](/blog/agent-evals-regression-suite). A regression eval asks whether the agent’s behavior remains acceptable. Failure injection asks whether the runtime preserves that behavior when time, workers, and dependencies behave badly.

## A production checklist

| Area | Question to answer before launch |
|---|---|
| State | Can a new worker reconstruct the next safe step without the old process? |
| Evidence | Are tool results and decisions stored with references, hashes, and retention rules? |
| Effects | Does every write action have an idempotency key and reconciliation path? |
| Retries | Are model, read, human-wait, and write-effect retries different? |
| Concurrency | Can stale workers be fenced from committing state? |
| Waiting | Are long delays represented as durable events or timers? |
| Versioning | Can old histories survive a deployment? |
| Recovery | Do operators see stuck, expired, escalated, and cancelled workflows? |

Durable execution is not a magic layer that makes an agent correct. It is a disciplined way to keep runtime state alive while everything around it changes. Once the workflow can resume, the engineering conversation becomes clearer: which decisions were made, which evidence supports them, which effects are confirmed, and which step is safe to attempt next.

That clarity is more valuable than a promise that failures will never happen. Distributed systems fail. Providers fail. Workers disappear. People take days to answer. The reliable agent is not the one that avoids all of those facts. It is the one that turns them into explicit states, bounded transitions, and recoverable work.

## References

[1]: [Temporal — The definitive guide to Durable Execution](https://temporal.io/blog/what-is-durable-execution)
[2]: [Do Quoc Viet — Agent handover architecture](/blog/agent-handover-architecture)
[3]: [Do Quoc Viet — Exactly-once effects for AI agents](/blog/agent-evals-regression-suite)
[4]: [Do Quoc Viet — Regression evals for tool-calling agents](/blog/agent-evals-regression-suite)
