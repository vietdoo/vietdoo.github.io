---
title: "AI Agents Have a Clock: Deadlines, Leases, and Stale Plans"
description: "An AI agent does not only need better reasoning. It needs time semantics: business deadlines, expiring execution leases, freshness-aware observations, and a refusal path for plans that are no longer safe to execute."
pubDate: 2026-03-12
category: "engineering"
image: "/blog/ai-agent-clock/hero.webp"
lang: "en"
translationKey: "ai-agent-time-semantics"
draft: false
---

![A hand-drawn AI agent works beside a clock, a plan and four time boundaries: business deadline, execution lease, observation TTL and stale plan](/blog/ai-agent-clock/hero.webp)

The incident did not begin with a hallucination.

The agent had found the right document, selected the right tool and produced a perfectly reasonable plan. It was asked to update a customer's delivery address after the customer had confirmed the change. The workflow paused because the fulfillment service was briefly unavailable. Six minutes later, the worker recovered and resumed from the saved plan.

The plan was still syntactically valid. The address was still in the tool arguments. The tool call still passed schema validation.

But the order had already moved to a locked warehouse queue. The action was no longer safe to execute without checking the order again. The agent had remembered *what* it wanted to do, but not *when* that decision had stopped being trustworthy.

That is the failure mode this article is about. Production agents are often designed as if time were a transport detail: add a timeout around an API call, retry when it fails, and continue when the process comes back. In real workflows, time changes meaning. A customer confirmation expires. A payment authorization becomes invalid. A worker's ownership of a task ends. A retrieved inventory observation goes stale. A plan that was safe at 10:02 may be unsafe at 10:08.

> **The thesis:** Treat time as part of the agent's safety contract. Every run needs a business deadline, every exclusive action needs a bounded lease, every important observation needs a freshness policy, and every resumed plan must pass a time-aware revalidation gate.

This is not a proposal to make an agent “faster.” It is a way to make the agent aware of the difference between **not finished yet** and **no longer allowed to finish**.

## Four clocks that should not be collapsed into one

The word *timeout* is attractive because it appears to solve every waiting problem with one number. It does not. A production agent usually has at least four clocks, owned by different parts of the system.

| Clock | Question it answers | Example | Safe failure when it expires |
|---|---|---|---|
| Business deadline | When must this business outcome stop being attempted? | “Confirm the booking before 18:00 local time” | Stop, explain the expiry, ask for a new confirmation |
| Execution lease | How long may this worker or agent own the right to act? | “This checkout task is reserved for worker A for 90 seconds” | Let the lease expire and prevent a late write |
| Observation freshness | How long may this fact be trusted? | “Stock count was observed at 10:02 and is valid for 30 seconds” | Re-read the source before making a decision |
| Plan validity | Under which conditions is this multi-step plan still applicable? | “Apply the refund only while the invoice and approval are unchanged” | Revalidate, replan or refuse |

These clocks can be related, but they should remain explicit. Martin Fowler's description of a distributed lease captures the key idea: access is granted for a limited period and must be renewed before expiry; a crashed or disconnected node must not retain access forever.[1] Temporal's guidance makes a complementary distinction: timeouts detect failure, while timers implement business logic.[2]

An AI agent adds a fifth concern: its plan is an interpretation of observations. A timer can tell us that five minutes passed. It cannot tell us whether the evidence behind a plan is still applicable. That is why a resumed run needs both mechanical timers and semantic revalidation.

![A timeline separates the business deadline of a run from the acquire, renew, release and stop points of an execution lease](/blog/ai-agent-clock/time-contract.webp)

## Start with a time contract, not a timeout constant

Before implementing a worker loop, write the time contract for the workflow. It should answer four questions in ordinary language.

First, what is the latest moment at which the business outcome is useful? This is the **business deadline**. It is not necessarily the maximum HTTP duration. A support response might be useful for 24 hours, while a one-time password might be useful for five minutes.

Second, what authority is being granted temporarily? This is the **execution lease**. A lease is appropriate when two workers must not perform the same exclusive action, or when a worker must prove that it still owns the right to continue. The lease is not a promise that the action will succeed. It is a bounded permission to attempt it.

Third, which observations can change underneath the agent? This is the **freshness policy**. A static policy document may have a long validity window. A delivery slot or account balance may need a short one. The right TTL is a domain decision, not a universal infrastructure default.

Fourth, what must be true at the final side-effect boundary? This is the **revalidation predicate**. The agent may plan from a snapshot, but the write path should check the assumptions that make the write safe.

A small contract might look like this:

```ts
type TimeContract = {
  runDeadline: string;
  leaseTtlMs: number;
  observationTtlMs: Record<string, number>;
  revalidateBefore: string[];
  onExpiry: "revalidate" | "pause" | "refuse" | "escalate";
};

const addressChangeContract: TimeContract = {
  runDeadline: "2026-03-12T18:00:00+07:00",
  leaseTtlMs: 90_000,
  observationTtlMs: {
    order_state: 30_000,
    customer_confirmation: 300_000,
    policy_document: 86_400_000,
  },
  revalidateBefore: ["order_state", "customer_confirmation"],
  onExpiry: "revalidate",
};
```

The point is not the exact data structure. The point is that expiry behavior belongs beside the workflow contract, where engineers and reviewers can inspect it. If expiry is hidden in a queue client or an SDK default, the product has an accidental policy.

## Deadline is not the same as timeout

A network timeout answers: “How long do we wait for this particular call?” A business deadline answers: “How long are we willing to keep pursuing this outcome?” The first is local to an attempt. The second spans the whole run, including queue delay, model calls, tool calls, retries and human pauses.

Consider an agent that has 120 seconds to cancel a shipment. It spends 25 seconds waiting for a worker, 20 seconds generating a plan, 30 seconds retrying a carrier API and 35 seconds waiting for a confirmation screen. The final tool call may still have a 30-second HTTP timeout, but only 10 seconds of business time remain. Starting another 30-second attempt would be technically possible and operationally wrong.

Carry an absolute deadline through every layer rather than recomputing a fresh duration at every retry.

```ts
function remainingMs(deadlineMs: number, nowMs = Date.now()) {
  return Math.max(0, deadlineMs - nowMs);
}

async function callWithBudget<T>(
  deadlineMs: number,
  operation: (timeoutMs: number) => Promise<T>,
) {
  const budget = remainingMs(deadlineMs);
  if (budget <= 0) throw new Error("business_deadline_exceeded");

  const timeoutMs = Math.min(budget, 20_000);
  return operation(timeoutMs);
}
```

This distinction also clarifies retries. A retry policy describes how to try again after a failure; it should not quietly create an unlimited business obligation. Temporal documents exponential backoff and separate limits for an individual attempt and the total scheduled effort.[3] The same principle applies even when the agent runtime is home-grown: cap the whole outcome, not only each request.

The expiry path should be a product decision. Some workflows can pause and wait for the user. Some should return a partial result. Some must refuse because acting late is worse than doing nothing. A deadline without an explicit expiry outcome is only a timestamp.

## A lease protects ownership, not truth

Leases are useful when an action must have one current owner. They are common in distributed systems because a worker can crash or become partitioned; a time-bounded lease prevents that worker from holding a resource indefinitely.[1]

For an agent, the resource might be a task, a customer conversation, a browser session, a shopping cart or a reconciliation job. The lease should be attached to an owner and checked at the point where the side effect is committed.

```ts
type Lease = {
  leaseId: string;
  resourceId: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
  fencingToken: number;
};

function assertLease(lease: Lease, now = Date.now()) {
  if (Date.parse(lease.expiresAt) <= now) {
    throw new Error("lease_expired");
  }
}
```

The `fencingToken` is important. A late worker may wake up after its lease has expired and still believe it is the owner. A monotonically increasing token lets the storage layer reject writes from an older lease. Checking only in the worker is not enough; the write boundary needs to enforce the ownership rule.

A lease also does not make old information true. Worker A can hold a valid lease while the order state changes because a human operator or another system updated it. The lease says “you may attempt this resource,” not “your plan is still correct.” That is the job of revalidation.

Renewal deserves the same skepticism. Do not renew forever because the model is still thinking. Set a maximum lease horizon tied to the business deadline. If a run needs more time, create a new decision point rather than silently extending an old authority.

## Observations need a freshness policy

The phrase “the agent saw X” is incomplete. We need to know when it saw X, when the source produced X, and how long X is acceptable for the decision being made.

```ts
type Observation<T> = {
  value: T;
  source: string;
  observedAt: string;
  sourceUpdatedAt?: string;
  expiresAt: string;
  evidenceId: string;
};

function isFresh<T>(observation: Observation<T>, now = Date.now()) {
  return Date.parse(observation.expiresAt) > now;
}
```

Freshness is not identical to recency. A policy that changed yesterday may still be valid if versioned and approved. A stock count from ten seconds ago may already be unsafe if the item is being sold concurrently. Data readiness work for agentic systems increasingly treats freshness SLAs, data contracts and traceability as part of the data layer rather than as optional metadata.[4]

The useful question is not “Is this data fresh?” It is “Fresh enough for what action?” A stale observation might support a draft answer but not a purchase. It might support ranking options but not committing a reservation.

| Action class | Example | Typical freshness posture |
|---|---|---|
| Inform | Explain a product policy | Versioned document and known effective date |
| Recommend | Suggest a delivery slot | Short TTL and visible “checked at” timestamp |
| Reserve | Hold inventory or a meeting slot | Re-read immediately before reservation |
| Commit | Charge, delete, publish or change account state | Fresh source plus final invariant check |

Do not make the language model infer freshness from prose. Put freshness in a machine-checkable envelope and make the tool gateway reject expired evidence for high-impact operations.

![A plan becomes stale as the clock advances; a decision gate routes it to revalidation or refusal instead of executing blindly](/blog/ai-agent-clock/stale-plan.webp)

## The resumed plan must earn the right to continue

Checkpointing is valuable, but resuming a plan is not the same as replaying a function. The world may have changed while the agent was paused. A safe resume path should load the plan, load its evidence references, calculate the current time, and evaluate the assumptions before allowing the next side effect.

```ts
type Plan = {
  planId: string;
  steps: Array<{ tool: string; args: unknown }>;
  assumptions: Array<{ key: string; expected: unknown }>;
  createdAt: string;
  validUntil: string;
};

async function resume(plan: Plan, now = Date.now()) {
  if (Date.parse(plan.validUntil) <= now) {
    return { kind: "revalidate", reason: "plan_expired" } as const;
  }

  const current = await readCurrentState(plan.assumptions);
  if (!assumptionsStillHold(plan.assumptions, current)) {
    return { kind: "replan", reason: "assumption_changed" } as const;
  }

  return { kind: "continue", plan } as const;
}
```

This gate should be deliberately boring. It does not ask the model to write a persuasive explanation for why an expired plan is probably still fine. It checks typed predicates: order status is still `editable`, approval has not been revoked, the tenant has not changed, the account version matches, and the relevant evidence is within its TTL.

When a predicate fails, preserve the plan as historical evidence but do not execute it. The user can be told: “The previous plan expired while the carrier service was unavailable. I rechecked the order and need your confirmation before trying again.” That is a better experience than a silent duplicate change or an opaque “something went wrong.”

## A state machine makes expiry visible

Time-related transitions should appear in the workflow state machine, not only in logs. A minimal action lifecycle might include `PROPOSED`, `LEASED`, `EXECUTING`, `COMMITTED`, and `EXPIRED_RECONCILE`. The expiry state is not a generic error bucket. It tells operators and recovery code that the agent lost the right to continue with the old assumptions.

![A hand-drawn state machine shows an agent moving from proposed to leased, executing and committed, with timeout transitions into expired and reconcile](/blog/ai-agent-clock/lease-state-machine.webp)

```text
PROPOSED
   | acquire lease + validate evidence
   v
LEASED  ---- lease expires ----> EXPIRED_RECONCILE
   | start before deadline
   v
EXECUTING ---- deadline/freshness failure -> EXPIRED_RECONCILE
   |
   | final invariant check + fenced write
   v
COMMITTED
```

The transition into `COMMITTED` should be the narrowest part of the system. It should verify the lease, the business deadline, the freshness of required observations and the expected version of the target resource. If one check fails, the system should produce a structured reason rather than letting the model decide whether to “try anyway.”

## Common designs that look reasonable and fail later

The first anti-pattern is **one timeout for the entire agent**. It conflates transport, worker capacity, user waiting and business validity. The result is either premature cancellation or late action after the useful window has closed.

The second is **refreshing every timestamp on resume**. A resumed plan that sets `createdAt = now` is not fresh; it is hiding its age. Preserve original observation times and issue new observations explicitly.

The third is **lease checked only before model generation**. A model can think for longer than the lease, or a queued tool call can execute after the lease expires. Check ownership at the commit boundary and use a fencing token where the storage system supports it.

The fourth is **retrying an expired action because the error is transient**. Network failure may be transient, but business authority is not necessarily renewable. Separate retryable transport errors from expired permissions, stale evidence and changed state.

The fifth is **treating expiry as a silent background failure**. Users and operators need to distinguish “the agent is still working,” “the world changed,” and “the agent stopped because it was no longer authorized to continue.” Those states need different UI, metrics and recovery actions.

## A practical rollout sequence

Start with one workflow that can create a costly or embarrassing late action: a refund, a booking, an account change, a fulfillment update or a browser automation task. Do not instrument every agent at once.

Write the time contract in a small, reviewable document. Name the business deadline, lease owner, maximum lease horizon, observation TTLs, final invariants and expiry outcome. Add an immutable identifier to every run so that a late action can be traced back to the contract that authorized it.

Next, enforce deadlines in the orchestration layer and leases in the resource or tool gateway. Add `observedAt`, `expiresAt`, `evidenceId` and `fencingToken` to the structured envelopes that cross those boundaries. Log the decision reasons, not private prompt payloads by default.

Then test the uncomfortable cases: the worker sleeps past its lease, the user changes the record during model generation, the evidence expires between planning and execution, the clock moves across a daylight-saving boundary, the retry budget is exhausted, and the external API returns an unknown outcome after the deadline. The expected answer for each case should be a state transition, not a vague hope that the model will recover.

Finally, measure the system with signals that reveal whether time semantics are working. Track late-write attempts rejected by fencing, plans invalidated on resume, revalidation rate, expiry reason, time spent waiting for workers, and actions that were safely refused. A rise in refusals may be a quality improvement if the previous baseline was acting on stale authority.

## Closing thought

An AI agent does not become reliable merely because it can remember a plan. It becomes reliable when it knows the limits around that plan.

A deadline says when persistence stops being useful. A lease says when ownership stops being valid. A freshness policy says how long an observation can support a decision. A revalidation gate says the agent must meet the world again before it changes the world.

These are ordinary distributed-systems ideas, but agents make their absence more visible because the “client” is capable of producing a plausible next step even after the original conditions have disappeared. Give the agent a clock, not to make it anxious, but to make its authority legible.

## References

[1]: https://martinfowler.com/articles/patterns-of-distributed-systems/lease.html "Martin Fowler — Lease"
[2]: https://temporal.io/blog/timers-timeouts-and-the-art-of-waiting-in-temporal "Temporal — Timers, Timeouts, and the Art of Waiting"
[3]: https://docs.temporal.io/encyclopedia/retry-policies "Temporal — Retry Policies"
[4]: https://www.martinfowler.com/articles/making-data-ready-for-agentic-ai.html "Martin Fowler — Making Your Data Ready for Agentic AI"
