---
title: "Idempotent AI Actions: Making Tool Calls Safe to Retry"
description: "AI agents retry when networks fail, providers time out, and workers restart. This production playbook shows how to make write-oriented tool calls safe with idempotency keys, deduplication, outbox records, reconciliation, and compensating actions."
pubDate: 2026-01-13
category: "engineering"
image: "/blog/idempotent-ai-actions/hero.webp"
lang: "en"
translationKey: "idempotent-ai-actions"
draft: false
---

![A retry-safe AI action passes through an idempotency key and produces one committed effect](/blog/idempotent-ai-actions/hero.webp)

I once watched an assistant create a support ticket twice for the same customer request. The model had made one perfectly reasonable tool call. The worker sent it to the ticketing API. Then the network went quiet.

The worker could not tell whether the request had failed or whether the ticketing service had created the record and lost only the response. Its timeout handler did what most timeout handlers do: it retried. The second request looked identical. The customer received two ticket numbers, two notifications, and a very reasonable question: “Which one should I use?”

Nothing about the language model was spectacularly wrong. The failure happened at the boundary between **probabilistic intent** and **deterministic side effects**.

> **The thesis:** A tool call is not retry-safe because the model generated the same JSON twice. It is retry-safe when the application gives one logical action a stable identity, stores that identity with the result, and can distinguish a new intention from another delivery attempt of the old one.

This article is a production playbook for write-oriented AI tools: creating a payment, sending an email, opening a ticket, updating a CRM record, provisioning a resource, or scheduling a meeting. The same design applies to non-AI workers, but agents make the problem more visible because an LLM may generate the next call, an orchestrator may replay a step, and a human may press “try again” without knowing what happened to the first attempt.

## A retry is not a second intention

In distributed systems, a client can lose a response after the server has already committed the operation. The client then has an uncomfortable choice. If it does nothing, the user may wait forever. If it sends the request again, it may create a second side effect. AWS describes this exact tension in its guidance on idempotent APIs: retries simplify recovery only when the service can identify a repeat of the same request and avoid adding another effect.[1]

The important word is **same**. Two requests can have identical parameters and still represent two separate intentions. A user may legitimately want two identical calendar events or two identical compute instances. Conversely, the same logical intention may arrive with different transport metadata, a different HTTP connection, or a regenerated LLM tool-call identifier.

An idempotency key makes the intention explicit. It says: “These attempts belong to one logical action.” It is not a hash of every request in the universe, and it is not a permission token. It is a durable correlation identity with a carefully defined scope.

| Concept | Meaning | What it does not promise |
|---|---|---|
| **Idempotent action** | Repeating the same logical request does not add another intended side effect. | It does not guarantee that the first attempt succeeded. |
| **At-most-once execution** | The server tries to execute an operation no more than once. | It may lose the effect when the process crashes. |
| **At-least-once delivery** | A message or retry may be delivered more than once. | It does not prevent duplicates by itself. |
| **Exactly-once outcome** | The externally visible business result appears once. | It is usually a system-level outcome assembled from durable state, deduplication, and reconciliation—not a magical transport property. |

HTTP semantics already distinguish idempotent methods because a request may be repeated automatically after a communication failure.[2] An AI action usually arrives as a `POST`-like command, however, so the application must add an explicit contract rather than hoping that the verb will save it.

## Why AI agents make the old retry problem harder

A conventional service client usually knows which operation it is retrying. An AI agent adds several layers that can independently decide to try again:

1. The network client can retry after a connection reset.
2. The tool gateway can retry after a 502 or rate limit.
3. The workflow engine can replay a step after a worker restart.
4. The model can emit another tool call after seeing a timeout message.
5. The user can click “try again” while the first run is still unresolved.

Those are not five independent business actions. They may all be attempts to complete one intent such as “refund order `ord_4821` once.” If each layer invents a new key, deduplication becomes impossible. If every layer reuses a key without checking parameters, a stale key can accidentally bind a new intention to an old result.

There is also a semantic trap. Two model calls may use slightly different JSON but still mean the same action:

```json
{
  "customer_id": "cus_42",
  "amount": 149000,
  "currency": "VND",
  "reason": "duplicate charge"
}
```

and:

```json
{
  "currency": "VND",
  "reason": "duplicate charge",
  "amount": 149000,
  "customer_id": "cus_42"
}
```

A canonical request fingerprint can treat harmless ordering differences as equivalent. It should not silently treat a changed amount, customer, destination, or authorization scope as equivalent. For a write action, ambiguity must fail closed.

## Start with an action envelope, not a raw tool call

A useful design is to wrap the model-generated arguments in an application-owned action envelope. The model may propose the business parameters, but the application assigns the logical identity, actor scope, policy context, and retry budget.

```ts
type ActionEnvelope<T> = {
  actionId: string;              // stable across every attempt
  actionType: string;            // e.g. "refund.create"
  actor: {
    userId: string;
    tenantId: string;
    sessionId: string;
  };
  arguments: T;
  requestFingerprint: string;    // canonical arguments + protected scope
  idempotencyKey: string;        // opaque, unique for this intent
  policyVersion: string;
  createdAt: string;
  expiresAt: string;
};
```

The key should be created when the application accepts a logical intent—not every time the transport retries. A model regeneration inside the same workflow should normally reuse the existing `actionId` after the system decides that it is still the same intention. A new user instruction such as “actually, send it to another address” must create a new action, even if it occurs in the same conversation turn.

The server-side record needs to preserve enough information to answer a future retry without calling the external tool again.

```ts
type IdempotencyRecord = {
  tenantId: string;
  actorId: string;
  key: string;
  actionType: string;
  requestFingerprint: string;
  status: "started" | "committed" | "failed" | "unknown" | "expired";
  response?: unknown;
  resourceId?: string;
  externalRequestId?: string;
  createdAt: string;
  expiresAt: string;
};
```

The record is a **business safety boundary**. It should be scoped by tenant and actor where necessary, protected by a unique constraint, and retained for at least as long as a late retry can arrive. Stripe’s API documentation describes a similar contract: the first result is saved for a key, later requests with that key return the same result, and a parameter mismatch is rejected rather than treated as a new operation.[3]

![Three transport attempts converge on one protected idempotency record, while a parameter mismatch is rejected](/blog/idempotent-ai-actions/dedup-record.webp)

### The rules of a good idempotency key

A key should be opaque, collision-resistant, and free of sensitive data. A UUID is a common choice. The key should not be derived only from the user’s email address, an order number, or the natural-language prompt. Those values may be useful inside a fingerprint, but they are not enough to express whether two repeated requests were intended to be one action.

The service should compare the incoming fingerprint with the stored fingerprint. The same key with the same protected parameters can return the original response. The same key with different parameters should return a conflict such as `409 Conflict`, with a diagnostic event that helps the operator discover key reuse bugs.

The contract can be summarized like this:

| Incoming request | Stored record | Correct behavior |
|---|---|---|
| New key | None | Atomically reserve the key and start the action. |
| Same key, same fingerprint, `committed` | Existing result | Return the stored result; do not call the tool again. |
| Same key, same fingerprint, `started` | Work may still be running | Return a pending state or wait within a bounded budget. |
| Same key, same fingerprint, `unknown` | External outcome is unresolved | Reconcile first; do not blindly replay a non-idempotent tool. |
| Same key, different fingerprint | Conflict | Reject and alert; never overwrite the original intent. |
| Expired key | Retention policy says record is gone | Require a new explicit action or a reconciliation lookup before creating anything. |

## A timeout is an unknown outcome, not proof of failure

This is the most important state-machine distinction in an agent workflow. A validation error usually means the external operation did not begin. A `401` or policy denial may be terminal. A timeout after the request was accepted is different: the client does not know what happened.

Treating every error as “retry” is how duplicate charges, duplicate emails, and duplicate records happen. Treating every error as “stop” produces stuck workflows. The safe path is to classify the outcome and make reconciliation the fork before a dangerous retry.

![A retry-safe state machine separates unknown outcomes from confirmed failures and reconciles before retrying](/blog/idempotent-ai-actions/retry-state-machine.webp)

```text
intent_created
      |
      v
key_reserved ---> validation_failed ----> terminal_failure
      |
      v
sent_to_tool ---> response_received ----> committed
      |
      +--------> timeout / disconnect --> unknown
                                             |
                                             v
                                      reconcile_external_state
                                      /                    \
                                found result          not found
                                     |                     |
                                  committed       retry only if safe
```

A reconciliation lookup is not always available. If the provider supports querying by your client request ID, use that capability. If it returns a resource with your metadata, attach the resource to the original action. If the provider cannot reveal whether the operation happened, the workflow needs a product-level policy: wait, escalate to a human, or execute a compensating action. The correct choice depends on the side effect and its reversibility.

## Make the first write atomic

The server must avoid a race in which two workers both observe that a key is new and then both execute the tool. The usual protection is a unique database constraint plus a transaction that reserves the key before the worker proceeds.

```sql
CREATE TABLE ai_action_idempotency (
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action_type TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  response_json JSONB,
  resource_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key)
);
```

The critical operation is not “check, then insert” in application memory. It is an atomic insert or compare-and-set at the database boundary. A simplified flow looks like this:

```ts
async function handleAction(action: ActionEnvelope<RefundArgs>) {
  const record = await idempotency.reserveOrRead(action);

  if (record.kind === "conflict") {
    throw new HttpError(409, "Idempotency key reused with different arguments");
  }
  if (record.status === "committed") {
    return record.response;
  }
  if (record.status === "unknown") {
    return await reconcileBeforeRetry(action, record);
  }
  if (record.status === "started") {
    return { status: "pending", actionId: action.actionId };
  }

  return await executeReservedAction(action);
}
```

The reservation must also prevent a second worker from racing past a `started` record. Use a lock, lease, or ownership token with a clear expiry. A lease is not permission to duplicate the work after expiry; it is permission to take responsibility for reconciliation and recovery.

## Use the outbox to separate the database commit from delivery

Many AI actions update local state and then call an external tool. For example, a scheduling agent may create a `booking_intent` row and then call a calendar API. If the database commit succeeds but the process crashes before the API call, the action is incomplete. If the API call succeeds but the process crashes before the local commit, the application may forget what it created.

A transactional outbox reduces one half of this uncertainty. The application writes the business state and an outbox event in the same database transaction. A relay then delivers the event to the external system. The outbox pattern exists because a database and a message broker generally cannot share a practical two-phase transaction; it also acknowledges that the relay may publish an event more than once, so consumers still need idempotency.[4]

![The agent intent is committed with an outbox event, relayed to an external API, then reconciled into a commit or compensation](/blog/idempotent-ai-actions/outbox-reconciliation.webp)

```ts
await db.transaction(async (tx) => {
  await tx.insert("refund_intent", {
    actionId: action.actionId,
    orderId: action.arguments.orderId,
    amount: action.arguments.amount,
    status: "pending",
  });

  await tx.insert("outbox", {
    eventId: action.actionId,
    topic: "refund.requested",
    payload: action,
    status: "ready",
  });
});
```

The outbox does not magically make the external API exactly once. It gives the system a durable place to record what it intended to send. The relay should include the same idempotency key when calling the provider, and it should persist the provider’s request ID and response. If the provider does not support idempotency, the relay needs a reconciliation strategy before replaying the call.

## Reconciliation is a first-class workflow

Reconciliation is often treated as an emergency script. For AI actions, it should be a normal state transition with an owner, a deadline, and a visible result.

A useful reconciliation algorithm is:

1. Load the idempotency record and verify the actor, tenant, action type, and fingerprint.
2. Query the external system using the provider request ID, client reference, or a narrowly scoped business lookup.
3. If the expected resource exists, attach it to the original action and mark the action `committed`.
4. If the resource does not exist and the provider contract guarantees that a retry is safe, retry with the same key.
5. If the outcome cannot be established, pause and escalate rather than creating a second effect.
6. If a partial effect must be undone, create a separate compensating action with its own key and audit trail.

A compensating action is not the same as a rollback. A database rollback can undo an uncommitted local change. Once an email has been sent or a payment has been accepted, the system may only be able to send a correction, issue a refund, cancel a booking, or ask a human to resolve the case. Compensation itself must be idempotent; otherwise, the recovery workflow creates a second incident.

| Side effect | Preferred recovery | Human escalation trigger |
|---|---|---|
| Create a support ticket | Lookup by client reference; reuse the found ticket. | Provider search is incomplete or multiple candidates match. |
| Send an email | Use a provider message key or an application send ledger. | Delivery state is unknown and a duplicate email is harmful. |
| Charge or refund money | Provider idempotency key plus payment lookup. | Amount, currency, or account scope cannot be reconciled. |
| Update a CRM record | Use an external version or upsert key; verify the final record. | Concurrent edits make the target version ambiguous. |
| Provision a resource | Lookup by client token or deterministic tag. | Two resources already exist or ownership is unclear. |
| Cancel or compensate | Create a new, explicitly named action with its own key. | Compensation is irreversible or requires legal/business judgment. |

## Guard the boundary from the model

The model should not be allowed to choose the idempotency scope by itself. It can propose `orderId`, `amount`, or `recipient`, but the application must derive the tenant, authenticated actor, policy version, and action identity from trusted context.

Before a write tool is called, validate at least:

- The user is allowed to perform the action in the target tenant and resource scope.
- The arguments are canonicalized and validated against the current schema.
- The amount, currency, destination, and resource identifiers are explicit.
- The action risk class determines whether automatic retry is permitted.
- The tool contract says how to query, deduplicate, or compensate the side effect.
- The action key is not recycled across conversations or users.

This is also where human approval belongs. Approval should bind to a concrete action envelope and fingerprint, not to a vague sentence such as “the agent wants to fix the account.” If the model changes the amount or destination after approval, it is a new action and needs a new gate.

## Test failure modes, not just happy-path tool calls

A basic integration test that sends a tool call and checks a `200` response proves very little. The valuable tests are the cases where the system cannot tell whether it succeeded.

| Failure injected | Expected invariant |
|---|---|
| Connection closes after provider commit | A retry returns the original resource, not a second resource. |
| Two workers receive the same key concurrently | Only one external action is started. |
| Same key arrives with a changed amount | The request is rejected as a conflict. |
| Worker dies after local reservation | Another worker reconciles or safely resumes after the lease expires. |
| Outbox relay crashes after publish | The consumer deduplicates the repeated event. |
| Provider returns a delayed result | The action remains `unknown` until a lookup resolves it. |
| User clicks retry twice | Both UI requests map to one logical action. |
| Model emits reordered JSON fields | The canonical fingerprint remains equivalent. |
| Model changes a protected argument | A new fingerprint and new approval are required. |

Property-based tests are particularly useful for canonicalization. Generate permutations of JSON key order, insignificant whitespace, and normalized numeric representations, then verify that equivalent requests share a fingerprint. Separately generate changed values and verify that they never collide.

Chaos tests should include delays between “provider committed” and “response returned,” not only connection failures before the request reaches the provider. That is the uncertainty window where naive retry logic is most dangerous.

## Observe one logical action across many attempts

A retry-safe system needs both action-level and attempt-level telemetry. If every attempt is counted as a new business action, dashboards exaggerate volume and hide duplication. If attempts are invisible, operators cannot explain why a user waited three minutes for one refund.

Use a stable `actionId` for the logical intent and a unique `attemptId` for each delivery attempt. A useful trace shape is:

```text
actionId=act_9f2
  attemptId=att_1  -> timeout
  attemptId=att_2  -> provider lookup: found
  outcome          -> committed, resource=refund_771
```

Track at least the following measurements:

| Measurement | Why it matters |
|---|---|
| `actions.started` | Business intent volume. |
| `attempts.sent` | Transport and worker pressure. |
| `actions.unknown` | Exposure to unresolved outcomes. |
| `reconciliations.resolved` | Whether recovery is working. |
| `duplicate_requests_suppressed` | Safety wins from the idempotency layer. |
| `conflicting_key_reuse` | Client or orchestration bugs. |
| `compensations.created` | Real-world partial-effect rate. |
| `time_to_resolution` | User impact of unknown outcomes. |

Do not log full prompts, payment details, or personal data just to make retries debuggable. Log the action type, scoped identifiers, fingerprints or hashes, state transitions, provider request IDs, and policy decisions. The trace should explain the outcome without becoming a second data-leak surface.

## A practical rollout sequence

Start with one high-value write tool that has a clear lookup API and a small blast radius. Define the action envelope and fingerprint before adding automatic retries. Persist the idempotency record, implement the unique constraint, and return the original response for a repeated committed key. Only then add worker retries.

Next, introduce an explicit `unknown` state and a reconciliation job. Measure how often the state occurs and how long it takes to resolve. Add the outbox when local database state and delivery must move together. Add compensation only after the team can describe the business invariant it repairs.

Finally, make the behavior visible in the product. A user should see “processing; checking whether the action completed” rather than a generic “something went wrong.” The copy matters because it prevents users from issuing a second intention while the first one is still unresolved.

## The design rule to carry forward

AI agents do not need fewer retries. They need retries that are attached to the right identity and bounded by the right contract.

The model decides what it would like to do. The application decides whether the request is authorized, what logical action identity it receives, whether the side effect is safe to repeat, and how to reconcile uncertainty. Once those responsibilities are separated, a timeout stops being an invitation to duplicate work. It becomes a known state with a safe next step.

That is the difference between an agent that merely calls tools and an agent system that can be trusted with real-world effects.

## Related reading

This article is the side-effect boundary in a broader production-agent series. For the workflow mechanics around checkpoints and resuming work, read [Durable Execution for AI Agents](/blog/durable-execution-ai-agent). For the evidence and regression layer, continue with [Do Not Ship a Tool-Calling AI Agent Without Evals](/blog/agent-evals-regression-suite). For the telemetry boundary around prompts, tool calls, tokens, and cost, see [AI Agent Observability Without Data Leaks](/blog/agent-observability-without-data-leaks).

## References

[1]: https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/ "AWS Builders' Library — Making retries safe with idempotent APIs"
[2]: https://www.rfc-editor.org/rfc/rfc9110.html "RFC 9110 — HTTP Semantics"
[3]: https://docs.stripe.com/api/idempotent_requests "Stripe API — Idempotent requests"
[4]: https://microservices.io/patterns/data/transactional-outbox.html "Microservices.io — Transactional outbox pattern"
