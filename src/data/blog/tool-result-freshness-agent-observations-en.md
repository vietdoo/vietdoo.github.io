---
title: "Tool Result Freshness: Preventing Agents from Acting on Expired Observations"
description: "A production playbook for treating tool results as expiring observations—with freshness budgets, version checks, action-time revalidation, fail-closed behavior, and metrics for safe AI-agent actions."
pubDate: 2026-04-20
category: "engineering"
image: "/blog/tool-result-freshness/hero.webp"
lang: "en"
translationKey: "tool-result-freshness-agent-observations"
draft: false
---

![A hand-drawn AI agent checks a tool observation against a freshness gate before acting](/blog/tool-result-freshness/hero.webp)

The agent did not misunderstand the customer. It misunderstood the age of the answer.

At 10:12, a shopping assistant called `inventory.lookup` and learned that five units of a camera were available. The model compared the result with the customer’s request, selected the right SKU, and prepared a purchase action. The workflow paused for a few seconds while the customer confirmed the delivery address. At 10:17, the agent submitted the order.

There was only one unit left by then. Another checkout had won the race. The tool returned an error, so the system tried a fallback path that used the earlier observation. The customer received a message saying the order was confirmed. A human operator had to cancel it later.

No model outage caused this incident. The model selected the right tool, read a plausible result, and followed the plan. The failure happened because the application treated a **snapshot** as if it were a **promise about the present**.

That distinction matters everywhere an AI agent can observe one system and act on it later. An agent can read a balance before initiating a transfer, inspect a calendar before booking a meeting, check a ticket status before sending a reply, or retrieve a price before creating an order. Between the read and the action, another user, worker, policy, or provider may change the world.

> **The thesis:** A tool result is an observation with an age, scope, version, and purpose. It may be safe for explanation while already unsafe for an irreversible action. Production agents need a freshness contract and an action-time revalidation gate—not another instruction telling the model to “use the latest data.”

This article presents an application-level pattern for tool-using agents. It borrows useful vocabulary from HTTP caching, where a stored response is fresh only for a defined lifetime and may need validation before reuse. It also borrows the idea of request preconditions from HTTP semantics: a write can be conditional on the representation still matching the one the client observed. The pattern is not an HTTP implementation requirement, and it is not a replacement for database transactions. It is a way to make time and state explicit at the boundary where an agent wants to cause an effect.

## An observation is not the world

A tool result often looks authoritative because it arrives in a structured envelope. Consider this response:

```json
{
  "sku": "CAM-42",
  "available": 5,
  "currency": "VND",
  "observed_at": "2026-04-20T10:12:04.118Z",
  "version": "inventory-8841",
  "scope": "warehouse-hcm-01"
}
```

The JSON is precise. It tells us what the inventory service reported, when it reported it, which version it read, and which warehouse it describes. But it does not say that five units will still be available when the agent later creates an order. The result is evidence about a state at a time, not a reservation.

This is the first design move: call the object what it really is. In the runtime, store it as an **observation**, not as a generic `tool_output` that every downstream step can treat as current truth.

An observation should carry at least these fields:

| Field | Question it answers | Example |
|---|---|---|
| `observed_at` | When was the source state measured? | `2026-04-20T10:12:04Z` |
| `source_version` | Which version or revision produced it? | `inventory-8841` |
| `scope` | Which tenant, account, region, or resource does it describe? | `warehouse-hcm-01` |
| `purpose` | What decision was this observation gathered for? | `quote_shipping` |
| `freshness_class` | How quickly can this fact become unsafe? | `strict_write` |
| `provenance` | Which tool call and parameters produced it? | `inventory.lookup(CAM-42)` |
| `confidence` | Did the tool return a complete, authoritative result? | `authoritative` |

The point is not to add metadata for its own sake. The metadata gives the next policy decision something inspectable to evaluate. Without it, the orchestrator has no reliable way to distinguish “the answer came back two seconds ago” from “the answer came back before the customer changed the account.”

## Freshness is a contract, not one global TTL

A common first implementation adds a single `ttl_seconds` field to every tool. That is better than ignoring time, but it still makes freshness sound like a storage optimization. In an agent system, freshness is a **decision contract** between an observation and the action that consumes it.

The same observation can have different acceptable ages depending on what the agent wants to do next. A weather observation may be fine for answering “Was it rainy this morning?” but not for opening an airport disruption workflow. A support ticket status may be acceptable for a summary while being too old to close the ticket. An exchange rate may be adequate for a rough estimate and unacceptable for a payment.

Define freshness by action class, not only by tool name:

| Action class | Typical tolerance | Required behavior |
|---|---:|---|
| Explanation | Minutes or hours | Label the observation time and allow bounded staleness. |
| Recommendation | Seconds or minutes | Prefer a fresh read; disclose age when it affects the decision. |
| Reversible write | Short window | Check the observation version or re-read before writing. |
| Irreversible or high-impact write | As close to execution as possible | Revalidate immediately and fail closed on uncertainty. |
| Security or authorization decision | Policy-defined | Recheck scope and authority together with freshness. |

This lets a product make an honest promise. Instead of saying “the agent always uses current data,” it can say, “the agent will not submit a high-impact action from an observation older than the action’s freshness budget, and it will stop when the source cannot confirm the version.”

### Soft stale and hard expired

A useful model has more than two states. I use three:

1. **Fresh:** the observation is within the contract for the next action.
2. **Soft stale:** the observation may still help the agent explain, compare, or form a new read request, but it cannot authorize a write.
3. **Hard expired:** the observation must not be used to make a decision; the system must refresh or ask the user to try again.

![The lifecycle of an AI agent tool observation from capture to fresh, soft-stale, and hard-expired states](/blog/tool-result-freshness/observation-lifecycle.webp)

The soft-stale state is important for user experience. If a user asks, “What did the inventory look like when I checked earlier?”, an old observation is exactly what they want. If the user asks, “Buy the remaining units,” the same observation is not enough. Reusing it for explanation and reusing it for authorization are different operations.

The policy can be represented as data:

```json
{
  "freshness_policy": "inventory_write_v2",
  "action": "create_order",
  "max_age_ms": 3000,
  "requires_version_match": true,
  "allow_soft_stale_for": ["explanation", "recheck_request"],
  "on_unknown": "fail_closed"
}
```

The values are examples, not universal defaults. A three-second budget for inventory may be too relaxed for a scarce ticket and too strict for a slow-changing catalog. The important part is that the budget belongs to the action contract and is versioned like other production policy.

## The action gate belongs outside the model

The model can suggest that an action should happen. It should not be the final authority on whether its supporting observation is still valid. The decision must be enforced by deterministic application code immediately before the side effect.

A minimal flow looks like this:

```text
user intent
   -> model proposes action
   -> orchestrator loads supporting observations
   -> freshness + scope + version + authority checks
   -> tool revalidation, if required
   -> action executes only after the gate passes
```

![An action gate checks freshness, scope, version, and authority before revalidation and a safe action](/blog/tool-result-freshness/revalidation-gate.webp)

The gate should receive a structured action envelope rather than a free-form model message:

```json
{
  "action": "inventory.reserve",
  "target": { "sku": "CAM-42", "warehouse": "warehouse-hcm-01" },
  "arguments": { "quantity": 1, "customer_id": "cust_18" },
  "supports": ["observation:obs_7d91"],
  "risk": "high",
  "requested_by": "user_204",
  "policy_version": "inventory_write_v2"
}
```

The orchestrator then evaluates the envelope. Notice that the model’s prose is not in the critical path. The model may explain why it chose the SKU, but the gate checks the target, the supporting observation, the policy version, the authority, and the source state.

```python
def can_execute(action, observations, now):
    if not policy_allows(action):
        return Deny("policy_denied")

    if not authority_allows(action.requested_by, action.target):
        return Deny("authority_changed")

    for observation in action.supports:
        if observation.is_hard_expired(now):
            return Deny("observation_expired")
        if not observation.scope_matches(action.target):
            return Deny("scope_mismatch")

    if action.requires_revalidation:
        return Revalidate()

    return Allow()
```

This check is deliberately boring. It should be easy to test, easy to log, and difficult to bypass accidentally by adding another agent path. A prompt can encourage good behavior; only the action boundary can enforce it.

## Revalidation is different from fetching more context

When an observation is too old for an action, the safe response is not always “retrieve more documents.” Revalidation asks the source of truth whether the particular state that justified the action still holds.

For a read-only answer, a new RAG retrieval may be enough. For a write, the revalidation should be tied to the action’s target and, when possible, to the version the agent observed. Examples include:

| Source type | Revalidation signal | Safe failure |
|---|---|---|
| HTTP resource | `ETag`, `Last-Modified`, or a domain revision | Return a version mismatch and do not write. |
| Database row | Revision column, compare-and-set, or transaction check | Abort the write and reload the row. |
| Inventory service | Reservation check for the exact SKU and location | Offer the current quantity or ask again. |
| Calendar | Event version plus attendee/slot availability | Show the changed slot before booking. |
| Authorization service | Current policy decision and grant expiry | Deny and request fresh authorization. |
| External provider | Provider-side confirmation or idempotent reservation | Mark the outcome unknown and reconcile. |

HTTP caching gives a helpful conceptual distinction. A cached response can be fresh for reuse during its freshness lifetime; once it needs validation, the client checks with the origin rather than assuming that the stored representation is still valid. A similar distinction works for agent observations, but the policy must be stricter for actions with side effects.

A revalidation call should be narrow. It should not ask the model to repeat the whole conversation or re-run every tool. It should confirm the smallest state necessary for the proposed action:

```json
{
  "check": "inventory.reserve_precondition",
  "sku": "CAM-42",
  "warehouse": "warehouse-hcm-01",
  "expected_version": "inventory-8841",
  "quantity": 1
}
```

If the source supports a conditional write, combine the check and the write where possible. The equivalent of an `If-Match` precondition means: perform the write only if the server’s current representation still matches the version observed earlier. This closes a race that would remain if the agent performed a separate “read latest” call and then waited before writing.

## The race window is the real bug

Teams often say, “We already refresh the data before the action.” That may still leave a race window:

1. The agent reads inventory version 42.
2. Another process updates inventory to version 43.
3. The agent sends a write based on version 42.
4. The write overwrites or contradicts the newer state.

The extra read improved the odds but did not create a guarantee. The precondition must be evaluated at the write boundary, not merely somewhere earlier in the workflow.

![A timeline shows an AI agent reading inventory version 42, a concurrent update to version 43, a version mismatch, and a safe refresh](/blog/tool-result-freshness/race-window.webp)

This is where freshness and concurrency control meet. Freshness answers, “Is this observation young enough for this class of action?” Version checking answers, “Is the target still the same version that produced the decision?” For high-impact writes, you usually need both.

A practical write contract might look like:

```typescript
type ActionPrecondition = {
  observationId: string;
  observedAt: string;
  expectedVersion?: string;
  maxAgeMs: number;
  scope: string;
};

type ConditionalAction = {
  name: string;
  target: string;
  args: Record<string, unknown>;
  precondition: ActionPrecondition;
};
```

The server should reject a failed precondition with a typed result, not a generic “tool error” that invites an uncontrolled retry:

```json
{
  "ok": false,
  "kind": "precondition_failed",
  "reason": "source_version_changed",
  "current_version": "inventory-8842",
  "recovery": "refresh_and_reprice"
}
```

The agent may then explain the change, refresh the relevant state, or ask for confirmation. It should not silently reuse the old observation because the old answer is still present in the context window.

## Soft stale data needs a capability boundary

One of the most subtle bugs is allowing a soft-stale observation to flow through a generic context object. The model sees a correct-looking record and may use it for a new tool call, even if the application intended to permit it only for explanation.

Give observations capabilities rather than one undifferentiated “usable” flag:

```json
{
  "observation_id": "obs_7d91",
  "state": "soft_stale",
  "capabilities": {
    "explain": true,
    "summarize": true,
    "recommend": false,
    "authorize_write": false,
    "execute_write": false
  }
}
```

The model can be shown that the source was checked earlier, but the tool registry or orchestrator must still reject an action that requires `authorize_write`. This is especially important when the same context is reused across a long-running workflow. Context compaction can preserve the observation while accidentally dropping its age or capability metadata. The runtime should treat a missing freshness field as unknown, not as fresh.

That fail-closed rule may feel conservative. It is also easier to reason about than a system where every missing field acquires a different default in a different tool adapter.

## Freshness and approval are related, but not identical

A human approval does not make stale evidence current. Suppose a reviewer approves “refund order 4821 for 2,000,000 VND” after looking at a fresh account balance. The agent waits five minutes, the order changes state, and the payment destination is updated. A generic approval flag cannot tell whether the approved facts still match the action being executed.

Bind approval to the same action envelope and preconditions:

```json
{
  "approval": {
    "reviewer": "operator_17",
    "approved_at": "2026-04-20T10:12:09Z",
    "action_hash": "sha256:8c...",
    "expires_at": "2026-04-20T10:13:00Z"
  },
  "preconditions": {
    "account_version": "acct-991",
    "order_version": "order-4821-v6"
  }
}
```

At execution time, the system should verify both the approval envelope and the current versions. If either one no longer matches, the correct result is not “the human already said yes.” The correct result is “the reviewed action is no longer the action we are about to perform.” Ask again with a fresh, concrete preview.

## Observability: measure decisions, not just ages

A dashboard that reports average tool latency will not reveal a freshness incident. The relevant questions are about how observations moved through the action policy:

| Metric | What it reveals |
|---|---|
| Observation age at proposed action | How much time workflows spend between read and decision. |
| Freshness-denial rate | Whether policies are too strict, too loose, or frequently reached too late. |
| Revalidation success rate | Whether the source can cheaply confirm the proposed action. |
| Version-mismatch rate | How often concurrent changes invalidate agent decisions. |
| Stale reuse by capability | Whether soft-stale observations leak into recommendation or write paths. |
| Unknown-outcome rate | How often a timeout leaves the external state uncertain. |
| User rework after stale denial | Whether the recovery UX helps people complete the task. |
| Side effects prevented | The number of potentially unsafe writes stopped by the gate. |

Log a privacy-aware decision record for each gate evaluation. Keep the observation ID, action class, policy version, age bucket, scope result, version result, revalidation result, and terminal decision. Avoid copying the full prompt or sensitive tool payload into every record; the existing provenance and observability patterns in this folio are useful companions here.

The most useful denominator is usually **proposed actions**, not tool calls. A system can have excellent tool latency and still be unsafe if it lets a large share of proposed writes rely on observations that are already outside their action contract.

## Testing the time dimension

A normal unit test often executes the read and write back to back, so the race disappears. Tests need to make time and concurrency explicit.

| Test case | Expected result |
|---|---|
| Fresh observation, matching version | Action is allowed. |
| Soft-stale observation used for explanation | Explanation includes age; no write capability is granted. |
| Soft-stale observation used for write | Action is denied or revalidated. |
| Hard-expired observation | Refresh is required before any decision. |
| Missing timestamp or version | Treat as unknown and fail closed for high-risk action. |
| Scope changed between read and action | Deny, even if the value is still fresh. |
| Version changed after revalidation | Conditional write fails; surface the new state. |
| Revalidation timeout | Do not guess; return an explicit unknown outcome. |
| Retry after precondition failure | Retry only with a new observation and bounded attempts. |
| Context compaction drops metadata | Runtime rejects the observation rather than assuming freshness. |

Property-based tests are useful for the invariant: **no action classified as high-impact may execute when its supporting observation is expired, out of scope, or version-unknown**. Chaos tests can add delay between the observation and the action, inject concurrent updates, and drop the revalidation response.

The test suite should also verify the recovery language. “The action could not be completed because the inventory changed from version 42 to version 43” is materially better than “Something went wrong.” A safety boundary that users cannot understand will eventually be bypassed by support staff or hidden behind a retry button.

## Rollout: start with writes that are easy to bound

Do not begin by adding freshness metadata to every string returned by every tool. Start with a small set of actions where stale state has a visible cost: payments, reservations, account changes, publishing, ticket closure, and deletion.

A staged rollout keeps the policy measurable:

| Stage | Change | Exit evidence |
|---|---|---|
| Inventory | Register observations with timestamp, scope, and source version. | Every protected action can name its supporting observation. |
| Observe | Log would-deny decisions without blocking traffic. | The team understands age distributions and main denial reasons. |
| Gate | Block hard-expired and scope-mismatched high-risk actions. | No bypass path executes the same action without the gate. |
| Revalidate | Add source-specific version checks or conditional writes. | Version mismatches are typed and recoverable. |
| Expand | Add soft-stale capabilities and policy tiers to more workflows. | Explanation and action paths are measurably separated. |
| Enforce | Make unknown freshness fail closed for protected actions. | Incident drills show bounded behavior and useful recovery. |

Keep the policy close to the tool contract, but enforce it in one shared action gateway as well. Duplicated freshness logic drifts quickly: one adapter may interpret a missing timestamp as “now,” another may use local machine time, and a third may silently accept a stale version. Central policy evaluation does not remove tool-specific knowledge; it makes the final decision consistent.

## A practical checklist

Before allowing an agent to perform a state-changing tool call, ask:

| Question | Evidence to require |
|---|---|
| What observation justified this action? | Stable observation ID and provenance. |
| When and where was it observed? | Timestamp, source, scope, and account/tenant binding. |
| How old may it be for this action? | Versioned freshness policy and action class. |
| Can the source prove the version is unchanged? | Revision, validator, or conditional write. |
| What happens if the source is unavailable? | Explicit unknown result and fail-closed behavior. |
| Can soft-stale data reach a write path? | Capability-based observation permissions and negative tests. |
| Is the approval bound to the exact action? | Action hash, expiry, target, arguments, and preconditions. |
| Can an operator explain a denial? | User-facing reason and a recovery path. |
| Can the team measure prevented side effects? | Gate metrics with proposed-action denominators. |

The most important question is not “Did the agent call the right tool?” It is “Did the state that justified the call remain valid at the moment the call could change the world?”

## Closing thought

Agents make stale data feel more dangerous because they turn observations into plans. A dashboard can tolerate a number that is five minutes old. A human can notice that a price looks suspicious and ask again. An agent may treat the same number as a reason to reserve, pay, publish, delete, or reassure a customer.

The solution is not to pretend every observation is live, or to force every workflow into a serial transaction. It is to make the boundary explicit. Give each observation an age, scope, version, provenance, and capability. Give each action a freshness contract. Revalidate as close as possible to the side effect. Bind the write to the version it was based on. When the system cannot prove continuity, stop and explain instead of inventing confidence.

A reliable agent is not one that always acts quickly. It is one that knows when an old answer is still useful—and when using it would be a new incident.

## Related reading in the production AI series

For cache reuse and invalidation, see [Semantic Caching for LLM Apps](/blog/semantic-caching-llm-freshness-safety/). For historical truth and valid-time retrieval, see [Temporal RAG](/blog/temporal-rag-time-aware-retrieval/). For state changes in a browser world, see [State-Aware Browser Agents](/blog/state-aware-browser-agents/). For replay-safe side effects, see [Idempotent AI Actions](/blog/idempotent-ai-actions/).

## References

[1]: https://www.rfc-editor.org/rfc/rfc9111.html "RFC 9111 — HTTP Caching"
[2]: https://www.rfc-editor.org/rfc/rfc9110.html "RFC 9110 — HTTP Semantics"
