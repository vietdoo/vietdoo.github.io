---
title: "AI Agent Compensation Transactions: Recovering from Partial Side Effects"
description: "A production playbook for recovering when an AI agent has already changed the world: compensation contracts, durable action ledgers, unknown outcomes, and safe reconciliation."
pubDate: 2026-06-07
category: "engineering"
image: "/blog/ai-agent-compensation-transactions/hero.webp"
lang: "en"
translationKey: "ai-agent-compensation-transactions"
draft: false
---

![A hand-drawn AI agent records each side effect and its compensation before executing a multi-step business workflow](/blog/ai-agent-compensation-transactions/hero.webp)

At 09:17, the agent had already done the expensive part.

It checked the order, reserved the last item in a warehouse, and created a payment adjustment for a customer whose delivery address had changed. The next step was to update the carrier instructions. That call timed out.

The first operational instinct was to retry the carrier call. The second was to restart the workflow from the beginning. Both instincts were dangerous. The carrier might still be processing the original request. The inventory reservation was real. The payment adjustment was queued. A restart could reserve the same item twice, create a second adjustment, or update a shipment that had already moved to a different state.

The agent had not “failed” in the simple sense. It had produced a partially completed business process with an uncertain final step. The system needed to answer a harder question than “Should we try again?” It needed to answer: **Which effects exist, which effects might exist, what can be safely undone, and who is allowed to decide what happens next?**

This distinction matters because an AI agent is not only generating text. Once it can call tools that reserve, charge, cancel, publish, modify, or notify, it becomes a participant in a distributed workflow. The model may propose the plan, but the application is responsible for recovering from the plan’s consequences.

> **The thesis:** An agent plan is not a transaction. Every side-effecting tool should declare what it changes, how its outcome can be checked, and which compensation is safe to attempt. The runtime should record those contracts durably, distinguish `failed` from `unknown`, compensate in a controlled order, and escalate when no safe inverse exists.

This article focuses on the application-level pattern. It is not a generic introduction to the Saga pattern, and it does not ask a language model to invent a clever undo operation during an incident. Temporal describes a Saga as a sequence of local transactions with compensating actions, including reverse-order execution and compensation registration before an activity runs. The recent Robust Agent Compensation work applies a log-based recovery manager to agent frameworks and formalizes action/compensation pairs. The useful lesson for an AI platform is to make those ideas explicit at the tool boundary, where they can be reviewed, tested, authorized, and observed.

## A timeout is not a rollback

Distributed systems have always had an awkward state between success and failure. An HTTP client can stop waiting even though the server is still working. A network can drop the response after the database commits. A payment provider can accept a request while the caller sees a timeout.

AI agents make this state more common because they combine long-running reasoning with calls to systems that have different clocks, retry policies, and consistency models. The model sees a tool error and may reasonably propose a retry. The runtime, however, must know that the tool’s error is not necessarily evidence that its side effect did not happen.

A useful minimum outcome vocabulary is:

| Outcome | Meaning | Safe default |
|---|---|---|
| `succeeded` | The system has authoritative evidence that the intended effect exists. | Record the output and continue. |
| `failed` | The system has authoritative evidence that the intended effect does not exist. | Retry only under the action policy. |
| `unknown` | The caller cannot determine whether the effect exists. | Stop blind retries; reconcile first. |
| `compensated` | A registered inverse effect has been confirmed. | Continue recovery and close the ledger entry. |
| `needs_human` | Automated recovery is unsafe, incomplete, or outside policy. | Create a bounded reconciliation task. |

The `unknown` state is not an implementation detail. It is a business state. A payment request with an unknown outcome is not equivalent to a failed model call. An inventory reservation with an unknown outcome is not equivalent to an empty response. The system should make those states visible in dashboards, audit records, and the user experience.

## The model proposes a plan; the runtime owns the ledger

A plan produced by a model is useful as an intention. It is not a durable execution record.

Before the first side effect, the runtime should create an action ledger for the current workflow. Each entry represents an intended action, its contract, and the evidence returned by the external system. The ledger can live in a database, workflow history, or durable event log. The important property is that recovery does not depend on reconstructing the model’s hidden reasoning from a conversation transcript.

A compact TypeScript model might look like this:

```typescript
type ActionStatus =
  | "planned"
  | "running"
  | "succeeded"
  | "failed"
  | "unknown"
  | "compensating"
  | "compensated"
  | "needs_human";

type ActionLedgerEntry = {
  workflowId: string;
  sequence: number;
  actionId: string;
  toolName: string;
  requestHash: string;
  status: ActionStatus;
  effect?: Record<string, unknown>;
  providerReference?: string;
  compensation?: CompensationContract;
  lastError?: { code: string; message: string };
  policyVersion: string;
  createdAt: string;
  updatedAt: string;
};

type CompensationContract = {
  toolName: string;
  inputFrom: "forward_output" | "forward_input" | "reconciliation";
  requiredFields: string[];
  safeWhenForwardOutcome: Array<"succeeded" | "failed" | "unknown">;
  authorizationAction: string;
};
```

![A durable action ledger records the plan, effect, provider reference, outcome, compensation, and policy version before recovery](/blog/ai-agent-compensation-transactions/action-ledger.webp)

The ledger is deliberately boring. It does not store chain-of-thought. It stores the minimum operational facts required to replay a decision: which action was requested, which tool received it, which provider reference came back, which policy version applied, and what recovery options were declared.

The `requestHash` is useful for correlating retries without pretending that a hash alone makes an operation idempotent. The provider reference is useful for reconciliation and compensation, but it must be treated as untrusted input until the runtime validates its shape and ownership. A compensation contract is not permission; it is a description of a possible inverse. Authorization still has to approve the inverse at execution time.

## Declare the effect before executing the action

![An AI agent compensation contract connects a forward inventory reservation to a controlled release, with an outcome probe and authorization check](/blog/ai-agent-compensation-transactions/compensation-contract.webp)

A tool schema that describes only parameters is incomplete for a consequential agent. The runtime also needs to know what the tool changes and how the change can be verified.

Consider two tools:

```json
{
  "name": "reserve_inventory",
  "effect": {
    "kind": "inventory_reservation",
    "resource": "sku:ABC-123",
    "reversible": true
  },
  "outcome_probe": "get_reservation",
  "compensation": {
    "tool": "release_inventory",
    "input_from": "forward_output",
    "required_fields": ["reservation_id"],
    "safe_when": ["succeeded", "unknown"]
  }
}
```

The corresponding payment tool may not have the same safety properties:

```json
{
  "name": "queue_payment_adjustment",
  "effect": {
    "kind": "payment_adjustment",
    "resource": "order:ORD-4821",
    "reversible": "conditional"
  },
  "outcome_probe": "get_payment_adjustment",
  "compensation": {
    "tool": "void_payment_adjustment",
    "input_from": "forward_output",
    "required_fields": ["adjustment_id"],
    "safe_when": ["succeeded"]
  }
}
```

The difference is intentional. An inventory reservation may be released after an unknown result if the provider supports a safe lookup and the release operation is designed to be harmless when the reservation is already gone. A payment adjustment may require a confirmed provider reference and a different authorization level. If no safe inverse exists, the contract should say so. “The model can probably refund it” is not a recovery strategy.

A tool contract should answer five questions before a production rollout:

| Contract question | Why it matters | Example |
|---|---|---|
| What effect does the action create? | Recovery must reason about business state, not only HTTP status. | `inventory_reservation` |
| How can the effect be checked? | Unknown outcomes require a read or provider inquiry. | `get_reservation` |
| What inverse is available? | Compensation must be explicit and reviewable. | `release_inventory` |
| Which forward outcomes permit the inverse? | A failed request may still need compensation. | `unknown`, `succeeded` |
| What authority is needed? | Compensation can be more sensitive than the forward action. | `payment.adjustment.void` |

## Register compensation before the forward action

The timing of registration is a small implementation detail with a large safety consequence.

If the runtime records a compensation only after the forward call returns success, it misses the case where the remote system commits and the response is lost. The compensation needs to be registered before the action begins, with enough information to locate the effect later.

The action runner can make that ordering explicit:

```typescript
async function runAction(
  workflowId: string,
  action: PlannedAction,
): Promise<ActionLedgerEntry> {
  const entry = await ledger.plan({
    workflowId,
    actionId: action.id,
    toolName: action.tool.name,
    requestHash: hash(action.input),
    compensation: action.tool.compensation,
    policyVersion: action.policyVersion,
  });

  await ledger.markRunning(entry.actionId);

  try {
    const output = await invokeTool(action.tool.name, action.input);
    const verified = await verifyOutcome(action.tool, action.input, output);

    if (!verified.confirmed) {
      return ledger.markUnknown(entry.actionId, {
        lastError: { code: "OUTCOME_NOT_CONFIRMED", message: verified.reason },
      });
    }

    return ledger.markSucceeded(entry.actionId, {
      effect: verified.effect,
      providerReference: verified.providerReference,
    });
  } catch (error) {
    if (isDefinitiveFailure(error)) {
      return ledger.markFailed(entry.actionId, normalizeError(error));
    }

    return ledger.markUnknown(entry.actionId, {
      lastError: normalizeError(error),
    });
  }
}
```

The important part is not the syntax. It is the sequence: plan and register, mark running, invoke, verify, then classify. The runner must not convert every exception into `failed`, because a timeout usually says more about the caller’s observation than the provider’s state.

## Compensation is not a retry with a different verb

A retry asks the original system to perform the same forward action again. Compensation asks the system to create a new state that offsets a previous business effect. Those operations can have different permissions, costs, validation rules, and failure modes.

For a reservation, compensation may be `release`. For a payment adjustment, it may be `void`, `reverse`, or a manual finance review depending on whether settlement has started. For an email, there may be no true inverse at all. A sent email cannot be unsent; the best available compensation might be a correction message, a support task, or a policy-defined stop before more messages are sent.

This is why “undo” is a misleading word. Compensation does not restore the universe to its previous state. It creates a new, controlled state that makes the business outcome safe enough to continue.

The runtime should therefore treat compensation as a first-class action:

```typescript
type RecoveryDecision =
  | { kind: "compensate"; actionId: string; reason: string }
  | { kind: "reconcile"; actionId: string; probe: string; reason: string }
  | { kind: "escalate"; actionId: string; queue: string; reason: string };

function chooseRecovery(entry: ActionLedgerEntry): RecoveryDecision {
  if (!entry.compensation) {
    return {
      kind: "escalate",
      actionId: entry.actionId,
      queue: "workflow-reconciliation",
      reason: "no_registered_compensation",
    };
  }

  if (entry.status === "unknown") {
    return {
      kind: "reconcile",
      actionId: entry.actionId,
      probe: entry.compensation.inputFrom === "forward_output"
        ? "provider_reference_lookup"
        : "business_state_lookup",
      reason: "forward_outcome_unknown",
    };
  }

  return {
    kind: "compensate",
    actionId: entry.actionId,
    reason: "later_step_failed",
  };
}
```

In practice, reconciliation often comes before compensation. If an unknown payment request actually succeeded, a void may be appropriate. If it did not, sending a void request may create a confusing provider error or consume a one-time action. The probe must be authorized, bounded, and recorded just like any other tool call.

## Recover in reverse order, but do not assume every step is reversible

Suppose an agent workflow contains these steps:

1. Reserve inventory.
2. Queue a payment adjustment.
3. Update shipping instructions.
4. Submit the exception for approval.

If step three fails definitively, the recovery manager may need to compensate step two and then step one. The reverse order protects dependencies: a payment adjustment may refer to an order state that should be stabilized before the inventory is released.

A simple state machine looks like this:

![An AI agent recovery state machine separates definitive failure, unknown outcomes, probes, compensation, and human escalation](/blog/ai-agent-compensation-transactions/unknown-state-machine.webp)

```text
planned
  |
  v
running ---- definitive failure ----> failed
  |                                      |
  | response lost / timeout              | registered inverse
  v                                      v
unknown -- probe --> succeeded      compensating
  |                   |                  |
  | no proof          |                  | confirmed
  v                   v                  v
needs_human        compensated <------ compensated
```

The diagram is intentionally not a straight “error -> retry” loop. The recovery path depends on evidence. A later workflow failure may trigger compensation for completed steps, but the recovery manager must skip actions that are not registered, expired, unauthorized, or unsafe in the current state.

Parallel actions require an even stricter rule. If two branches create independent effects, they can be compensated concurrently only when their contracts explicitly allow it. If one branch depends on the output of another, compensation should respect that dependency rather than blindly reverse the list by timestamp.

## Authorize the compensation itself

A dangerous shortcut is to treat compensation as automatically trusted because the forward action was authorized. That assumption is often wrong.

The forward action may have been “reserve inventory,” while the inverse is “release a scarce reservation.” The forward action may have been allowed for an assistant, while a refund or deletion requires a human-approved scope. The compensation may run minutes later, under a different user session, after the policy version has changed.

The authorization request should include the relationship between the forward action and the proposed recovery:

```json
{
  "action": "inventory.release",
  "resource": "reservation:res-9012",
  "context": {
    "workflow_id": "order-exception-4821",
    "caused_by_action": "reserve_inventory",
    "forward_status": "unknown",
    "policy_version": "fulfillment-18",
    "requires_human": false
  }
}
```

The policy can then deny a compensation when its evidence is incomplete, its provider reference belongs to another tenant, its time window has expired, or the action crosses a stronger approval boundary. An allowed forward path is not a permanent grant for every future recovery path.

## What the user should see when recovery is incomplete

Recovery is also a UX problem. Telling a customer “Your order failed” may be false if inventory is still reserved. Telling them “Everything is fine” may be worse. The user-facing state should describe the business truth at the right level without exposing sensitive internal payloads.

A useful message might be: “We could not confirm the delivery update yet. Your order is being reconciled; we will not create a duplicate payment adjustment.” That sentence communicates uncertainty, a safety guarantee, and the next step. It avoids pretending that a provider timeout is a definitive failure.

The internal record can be more precise:

| User-facing state | Internal state | Next action |
|---|---|---|
| Processing safely | `unknown` with an active probe | Query provider and wait within SLA. |
| Recovered | `compensated` | Close workflow or continue from a safe checkpoint. |
| Needs review | `needs_human` | Route to a bounded queue with evidence. |
| Failed before effect | `failed` | Retry if policy allows and no effect is possible. |

The agent may help draft the explanation, but the runtime should choose the status. Otherwise the model can turn a partial side effect into a confident but incorrect sentence.

## Test the awkward cases first

A compensation design is not production-ready because the happy path works. The tests should begin with the situations that are hardest to explain after an incident.

| Scenario | Expected classification | Expected recovery |
|---|---|---|
| Tool rejects validation before touching the provider | `failed` | Retry only after fixing input. |
| Provider commits but response is lost | `unknown` | Probe by request or provider reference. |
| Probe confirms the forward effect | `succeeded` | Compensate if a later step failed. |
| Probe confirms no forward effect | `failed` | Do not issue a blind inverse. |
| Compensation runs after the effect was already removed | `compensated` or safe no-op | Verify and close the entry. |
| Compensation requires a stronger permission | `needs_human` | Escalate with action evidence. |
| Compensation tool is unavailable | `compensating` | Retry compensation under its own policy. |
| Two branches partially complete | Mixed | Use dependency-aware recovery, not timestamp order. |
| The model suggests an unregistered inverse | Not admissible | Deny and route to reconciliation. |

For every case, assert more than a final status. Assert that the ledger contains the right evidence, that a compensation was registered before the forward call, that the authorization decision names the policy version, and that a user-visible message does not overstate certainty.

A small property is worth testing repeatedly: **recovery must never create a new side effect merely because the previous outcome is unknown**. If the provider supports an idempotency key, use it for the forward action. If it supports a status probe, use it before compensation. If neither exists, the safe answer may be a human queue rather than another model call.

## Operational metrics that reveal hidden partial work

A team can have a low tool error rate and still accumulate a large recovery problem. Measure the states between request and final business outcome.

Useful metrics include the percentage of tool calls classified as `unknown`, time from unknown to authoritative resolution, compensation success rate, compensation retry count, workflows entering `needs_human`, percentage of actions without a registered inverse, and the number of duplicate effects detected during reconciliation. Break these down by tool, provider, tenant, workflow type, and policy version.

Do not optimize only for automatic compensation. A high compensation rate can mean that the forward workflow is too eager to create effects before validation. A low human-escalation rate can mean the system is hiding uncertainty instead of resolving it. The goal is not to erase the recovery queue; the goal is to make every recovery decision explainable and bounded.

The action ledger also creates a useful audit trail without storing the model’s private reasoning. Operators can see the user intent identifier, action names, effect references, outcome probes, authorization results, and compensation decisions. That is enough to reconstruct what the system did and why it was allowed to do it, while avoiding a promise that a chain-of-thought transcript is an accurate or appropriate audit record.

## A practical rollout plan

Start with one workflow whose effects are important but whose recovery contracts are understood. Inventory each tool’s side effect, authoritative lookup, forward idempotency behavior, compensation, and escalation queue. Do not begin with a vague requirement to “make the agent transactional.” Begin with a table that a reviewer can challenge.

Then run the ledger in shadow mode. Let the existing workflow execute, but record whether each tool could have declared an effect, probe, and inverse. Compare the proposed classification with real provider outcomes. This step usually exposes tools that return ambiguous errors, omit stable references, or have an inverse that is only safe under a narrow business condition.

Next, enforce registration before execution and default-deny any consequential tool without a valid contract. Enable automatic compensation only for a small allowlist. Keep unknown outcomes on a reconciliation path until the probes and permissions are trustworthy. Finally, introduce failure injection: drop responses after provider commits, delay callbacks, reject compensation calls, and change policy versions between forward action and recovery.

The system is ready for a broader rollout when the team can answer, for every side-effecting tool:

- What changes if this call succeeds?
- How will we know if the response is lost?
- What compensation is safe in each possible outcome?
- Which policy authorizes that compensation?
- What happens when the inverse does not exist?
- What evidence will a human receive if automation stops?

## The recovery boundary is where trust becomes engineering

AI agents are good at proposing a sequence of useful actions. They are not a substitute for a ledger, a provider reference, a state probe, or a business policy. Those controls exist because the world can change after a model has formed its plan and because a network error does not erase a side effect.

Compensation transactions make that reality explicit. They force the team to say what an action does, how it can be checked, how it can be offset, and when a human must take over. They also prevent a common category mistake: treating the model’s next suggestion as if it were a rollback protocol.

The strongest agent systems will not be the ones that never encounter partial failure. They will be the ones that can stop at an uncertain boundary, preserve the evidence, avoid duplicate effects, and recover with a decision that a different engineer can understand six months later.

## References

[1]: https://docs.temporal.io/design-patterns/saga-pattern "Temporal Documentation — Saga Pattern"

[2]: https://arxiv.org/html/2605.03409v2 "Perera et al. — Robust Agent Compensation (RAC): Teaching AI Agents to Compensate"

[3]: https://blogs.oracle.com/database/ai-agents-enterprise-reality-workflows-transactions-runtime-controls "Oracle Database Insider — When AI Agents Meet Enterprise Reality: Workflows, Transactions, and Runtime Controls"

[4]: https://www.rfc-editor.org/rfc/rfc9110.html "RFC 9110 — HTTP Semantics"

[5]: https://www.rfc-editor.org/rfc/rfc9111.html "RFC 9111 — HTTP Caching"
