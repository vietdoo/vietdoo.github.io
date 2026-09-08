---
title: "Decision Traces for AI Agents: Event-Sourcing the Action Path Without Logging Chain-of-Thought"
description: "A production guide to event-sourced decision traces for AI agents: audit the action path, replay incidents, preserve privacy, and explain outcomes without treating private chain-of-thought as a log format."
pubDate: 2026-07-29
category: "engineering"
image: "/blog/decision-traces/hero.webp"
lang: "en"
translationKey: "decision-traces-ai-agent-event-sourcing"
draft: false
---

![A hand-drawn whiteboard showing an AI agent decision ledger, evidence references, policy gates, and a replay path](/blog/decision-traces/hero.webp)

I once debugged an automation that had done the technically correct thing for the wrong reason. The final action looked harmless. The request had returned a `200`, the database row had been updated, and the user had received a polite confirmation. Three hours later, someone asked the question that matters after an autonomous system changes the world: **what exactly did the agent see, which policy allowed the action, and what state did it believe it was changing?**

We had traces, but not a decision trace. We could see a model call and a tool call. We could not reconstruct the accepted action as one coherent, ordered story. The logs were useful for latency. They were not sufficient for accountability.

That distinction is becoming important as AI agents move from drafting text to approving requests, mutating records, calling APIs, and coordinating long-running workflows. A normal application log says that something happened. A telemetry span says how long an operation took. A decision trace should answer a stronger question:

> **What decision did the system accept, what evidence and policy references supported it, what state transition followed, and can we prove that the record was not rewritten later?**

This article presents a practical pattern: treat the agent’s accepted action path as an append-only domain event stream. Keep model telemetry, evidence references, policy decisions, approvals, tool outcomes, and state transitions connected by correlation and causation identifiers. Store enough to investigate and replay the decision path, but do not turn private chain-of-thought into a permanent database schema.

## A decision trace is not “more logs”

The first mistake is to put every artifact into one giant JSON blob called `agent_trace`. That object soon becomes a mixture of prompt text, provider metadata, debug statements, business events, and half-redacted secrets. It is difficult to query, impossible to govern consistently, and usually too large to retain safely.

A better design separates four layers. **Telemetry** describes execution: spans, latency, token counts, provider, model, and errors. OpenTelemetry’s GenAI semantic-convention registry includes attributes for agent identity, conversation identity, provider, requested model, input/output messages, and evaluation metadata. **Evidence references** describe the material the agent was allowed to use: document IDs, versions, data classifications, and retrieval timestamps. **Decision events** describe what the system accepted, denied, escalated, or deferred. **Domain events** describe the external state change that followed, such as `RefundApproved` or `TicketAssigned`.

| Layer | Primary question | Example | Retention posture |
|---|---|---|---|
| Telemetry | How did execution behave? | model span, tool span, p95 latency, token usage | operational retention and sampling |
| Evidence reference | What information was available? | document version, row ID, retrieval time, sensitivity class | governed by data policy |
| Decision event | What did the control plane decide? | allow, deny, escalate, defer | append-only audit retention |
| Domain event | What changed in the business world? | `RefundApproved`, `InvoiceHeld` | business system of record |
| Artifact hash | Can we prove which content was used or emitted? | SHA-256 of a stored output | long-lived proof without plaintext |

This separation prevents a common category error: assuming that because an LLM span exists, the system has an audit trail. A span can tell you that a model was called. It does not automatically prove which version of a policy was evaluated, which tool permission was active, or whether the resulting side effect was accepted once or twice.

## The event-sourced action path

Event sourcing is useful here because the decision itself is a state transition. Instead of overwriting `agent_status = approved`, the system appends events that explain how it arrived there. The current status becomes a projection of the event stream, while the stream remains the historical record.

The smallest useful chain often looks like this:

```text
RequestReceived
  -> ContextResolved
  -> EvidenceSelected
  -> PolicyEvaluated
  -> DecisionProposed
  -> HumanApprovalRequested (optional)
  -> DecisionAccepted / DecisionDenied / DecisionEscalated
  -> ToolInvocationStarted
  -> ToolInvocationCompleted
  -> DomainStateChanged
  -> OutcomeRecorded
```

The order matters. An agent may produce a candidate action before a human approves it, but the candidate is not the same thing as an accepted decision. A tool invocation may time out after the remote system committed the change, so `ToolInvocationTimedOut` cannot be treated as proof that nothing happened. A trace should make these distinctions visible instead of flattening them into one success flag.

![A hand-drawn whiteboard event ledger for an AI agent, showing request, evidence, policy, approval, tool execution, and outcome events connected by causation arrows](/blog/decision-traces/decision-ledger.webp)

Streamkap’s decision-trace discussion describes a similar chain from triggering data event through context lookup, reasoning, action, and outcome. The production lesson is not to copy a vendor’s event names. It is to make the chain explicit enough that an incident investigator can follow the same request across data access, policy, agent runtime, and the business system.

### Design the decision envelope, not a chain-of-thought column

A decision event should capture the system’s externally meaningful basis for action. It does not need to store every hidden intermediate thought produced by a model. In fact, treating private chain-of-thought as a required audit artifact creates privacy, retention, and security problems without guaranteeing a faithful explanation.

A practical decision envelope can look like this:

```json
{
  "event_id": "evt_01JX7M8M4A6P",
  "event_type": "DecisionAccepted",
  "occurred_at": "2026-07-29T09:14:03.280Z",
  "tenant_id": "tenant_42",
  "trace_id": "trc_01JX7M4Q2K9N",
  "causation_id": "evt_01JX7M7ZB1D2",
  "actor": {
    "kind": "ai_agent",
    "agent_id": "refund-agent",
    "agent_version": "2026.07.4"
  },
  "capability": "refund_approval_v2",
  "policy": {
    "policy_id": "refund-policy",
    "policy_version": "17",
    "decision": "allow",
    "rules_fired": ["under_limit", "identity_verified"]
  },
  "evidence": [
    {"kind": "order", "id": "ord_1842", "version": "9", "sensitivity": "internal"},
    {"kind": "payment_status", "id": "pay_1842", "observed_at": "2026-07-29T09:14:02Z"}
  ],
  "proposed_action": {
    "tool": "issue_refund",
    "arguments_hash": "sha256:...",
    "idempotency_key": "refund:ord_1842:v1"
  },
  "approval": {"required": false, "actor": null},
  "privacy": {"content_stored": false, "redaction_profile": "payments-v3"},
  "previous_hash": "sha256:..."
}
```

Notice what is present: versioned policy, selected evidence, capability, action intent, idempotency key, and privacy profile. Notice what is absent: a claim that the model’s hidden reasoning is a stable, complete explanation. The event proves the control decision and the inputs referenced by the control plane. If a human-readable explanation is needed, generate one from these structured facts and label it as an explanation, not as a recovered internal thought process.

## Causation, correlation, and ordering are the reliability layer

A trace ID groups events belonging to one request or workflow. A causation ID says which event directly caused the current event. A correlation ID can connect related traces, such as a customer request, a background reconciliation job, and a later human approval. These identifiers are not decorative metadata. They are what lets an investigator distinguish a retry from a new business action.

| Identifier | Meaning | Example use |
|---|---|---|
| `trace_id` | One logical agent request or workflow | group all events for a refund decision |
| `causation_id` | Immediate predecessor event | link `PolicyEvaluated` to `DecisionAccepted` |
| `correlation_id` | Wider business or incident context | connect a user request to a reconciliation run |
| `event_id` | Unique immutable event identity | deduplicate consumers and prove ordering |
| `sequence` | Monotonic position within a stream | detect missing or reordered events |

At-least-once delivery is often the honest default. If a consumer sees the same `ToolInvocationCompleted` twice, it should project the event once by `event_id`. If a tool call has an idempotency key, the action executor can reconcile a timeout before issuing a second side effect. This is where the pattern connects to the existing folio guidance on idempotent AI actions: the trace is not a substitute for idempotency, but it gives the runtime evidence needed to decide whether replay is safe.

For tamper evidence, chain each event to the previous event’s hash or periodically anchor a stream hash in a separate trust boundary. Hash chaining does not make the payload truthful by magic; it makes later silent rewriting easier to detect. The event producer, key management, clock source, and access policy still matter.

## Replay is not re-execution

“Can we replay the agent?” is an ambiguous question. There are at least three different operations:

1. **Projection replay:** rebuild a read model from the immutable event stream. No model call and no external side effect are required.
2. **Decision-path replay:** reconstruct what evidence, policy, route, approval, and tool outcome were recorded at the time. This is an investigation operation.
3. **Re-execution:** call the model or tool again. The world may have changed, the provider may return a different answer, and the operation may have a side effect.

![A hand-drawn whiteboard comparing safe projection replay and decision-path replay against risky model re-execution and duplicate side effects](/blog/decision-traces/replay-vs-reexecute.webp)

A good incident console makes these operations separate buttons. “Rebuild projection” should be safe. “Show decision path” should be read-only. “Re-run tool” should require explicit authorization, a new idempotency key or reconciliation step, and a visible blast-radius warning.

This distinction is also how to avoid a false promise of determinism. A recorded decision trace can tell us what the system accepted then. It cannot guarantee that a fresh model call today will produce the same answer. If deterministic reproduction is important, store the relevant model/provider version, prompt template version, sampling configuration, tool schemas, evidence versions, policy version, and a content hash. Even then, treat re-execution as a new experiment, not as a historical fact.

## Privacy boundaries: prove the event without retaining the secret

The easiest audit system to build is the least safe one: copy every prompt and model response into a log sink and promise to redact it later. Sensitive content tends to spread across collectors, indexes, backups, support exports, and developer laptops before the redaction job runs.

ARMO’s minimum-audit-trail guidance makes a useful distinction between infrastructure logs and the application-layer agent-action log. It recommends redacting at the source and retaining data shape, sensitivity classification, semantic tags, byte counts, and hashes rather than plaintext when the content itself is not required.

![A hand-drawn whiteboard showing the privacy boundary between private prompt/tool content and the redacted decision ledger, with hashes and sensitivity labels crossing the boundary](/blog/decision-traces/privacy-boundary.webp)

The right retention policy depends on the domain. A healthcare workflow, a public-sector service, and a developer sandbox do not have the same obligations. The design should answer four questions for every field:

| Question | Example decision |
|---|---|
| Is the field needed to prove the control decision? | Keep policy ID, version, outcome, and rule identifiers. |
| Is the field needed to reconstruct the business state? | Keep domain event ID and source record version. |
| Is plaintext required for a regulated investigation? | Store encrypted content in a separate governed vault, not the general event stream. |
| Can a hash or reference prove existence without disclosure? | Store a content hash, destination reference, classification, and retention pointer. |

A hash is not a deletion mechanism and it is not automatically anonymous. It can still be sensitive if an attacker can guess the input or correlate it with another database. Treat hashes, identifiers, and metadata as governed data too.

## What to instrument first

Do not start by instrumenting every token. Start with the moments that change authority or state. The minimum useful event set for an action-taking agent usually includes request intake, identity assertion, data access, policy evaluation, decision outcome, human approval, tool invocation, tool result, error classification, and domain state change.

OpenTelemetry gives a useful vocabulary for correlating agent, conversation, provider/model, input/output, and evaluation data. Use spans for operational questions such as latency and token cost. Use decision events for questions such as “which rule allowed this?” and “was this action accepted once?” Use evidence references for “what version of the order or policy was visible then?”

An implementation can begin as a transactional outbox. Write the domain change and the corresponding audit event in one database transaction, publish the event asynchronously, and make consumers idempotent. For workflows that span several systems, use an append-only event store or a durable log with explicit ordering and retention. The pattern is less about choosing Kafka versus Postgres than about refusing to let the audit record depend on a best-effort `logger.info()` call after the side effect.

## Failure modes worth testing

| Failure mode | What a weak system reports | What a decision trace should preserve |
|---|---|---|
| Model timeout after a tool side effect | “request failed” | tool intent, idempotency key, remote receipt state, reconciliation outcome |
| Policy version changed during a retry | “retry succeeded” | policy version for each attempt and the accepted decision |
| Evidence was stale | “agent made a bad choice” | evidence IDs, versions, observed timestamps, freshness classification |
| Human approval was bypassed | “tool call completed” | required approval, approval event, actor, policy result, override reason |
| Duplicate event delivery | “two refunds created” | event IDs, projection dedupe, domain idempotency result |
| Prompt/output contained PII | “logs unavailable for compliance” | redaction profile, sensitivity tags, content hash or governed reference |

The purpose of this table is not to encourage more logging. It is to make failure semantics explicit. A trace should help you answer what happened without pretending that every problem can be solved by replaying a model call.

## A practical rollout plan

Start with one high-consequence workflow rather than the entire agent platform. Choose a workflow that already has an incident or a manual review process. Define its capability, policy, evidence, action, approval, and outcome events. Add trace, causation, and event IDs. Project a read model that shows the action path in human language. Then run a shadow audit for two weeks before changing autonomy or retention policy.

Next, add contract tests for the event schema. Test that every accepted action has a policy version, evidence references, an actor, and a correlation ID. Test that a denied action cannot emit a domain mutation. Test that a timeout produces a recoverable uncertainty state instead of an automatic duplicate retry. Test redaction with realistic payloads, not only synthetic strings.

Finally, measure usefulness rather than volume. Useful metrics include the percentage of actions whose decision path can be reconstructed, time to answer an incident’s five questions, duplicate-side-effect rate, stale-evidence rate, policy-override rate, and the percentage of events rejected because required fields were missing. A million spans are not success if the investigator still cannot tell why the agent was allowed to act.

## Closing thought

Autonomous systems do not become trustworthy because they produce more confident explanations. They become trustworthy when their authority is bounded, their actions are observable, their evidence is versioned, their state changes are attributable, and their history is difficult to rewrite.

Event-sourced decision traces are a practical middle ground. They give engineers an ordered, replayable action path without requiring the system to store private chain-of-thought as if it were an API contract. They also create a seam between model behavior and business accountability: the model can remain probabilistic, while the accepted action must still pass a named policy, reference known evidence, and produce a traceable state transition.

That is the standard I want from an AI agent that can change production data: not “show me what the model was thinking,” but **show me what the system accepted, why that acceptance was allowed, what changed next, and whether I can prove it later.**

## References

[1]: https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/ "OpenTelemetry GenAI semantic-convention attribute registry"
[2]: https://streamkap.com/resources-and-guides/decision-traces-ai-agents "Streamkap — Decision Traces: Building Audit Trails for Autonomous AI Agents"
[3]: https://www.armosec.io/blog/minimum-viable-audit-trail/ "ARMO — What to Log for AI Agent Activity: The Minimum Viable Audit Trail"
[4]: https://www.nist.gov/itl/ai-risk-management-framework "NIST — AI Risk Management Framework"
