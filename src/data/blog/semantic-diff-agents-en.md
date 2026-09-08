---
title: "Semantic Diffs for AI Agents: Review Intent, Not Just JSON"
description: "A production design for turning an AI agent’s proposed tool call into a human-readable semantic diff: affected entities, invariants, risk, and a safe write boundary."
pubDate: 2026-09-01
category: "engineering"
image: "/blog/semantic-diff-agents/hero.webp"
lang: "en"
translationKey: "semantic-diff-agents"
draft: false
---
![An AI agent and a human reviewer compare a proposed semantic change across before and after system diagrams](/blog/semantic-diff-agents/hero.webp)

The approval screen showed valid JSON. Every required field was present, the schema validator returned green, and the agent’s explanation sounded reasonable. A reviewer clicked **Approve**.

The customer record changed, but not in the way the reviewer thought. The tool call updated the billing profile, copied a new address into an order, and removed an existing delivery preference as a side effect. Nothing in the raw payload made that relationship obvious. The payload was syntactically correct; the review was semantically blind.

This is the gap between a tool call and a safe action. A JSON object tells us **what the agent asked a tool to receive**. It does not necessarily tell us what the system will mean after the tool runs. For an agent that can edit records, send messages, change permissions, or trigger payments, “valid arguments” is a very low bar.

> **The thesis:** An AI agent should propose a semantic change set, not only a tool call. The runtime should show the affected entities, before-and-after values, inferred side effects, violated or preserved invariants, and approval level before it crosses the write boundary.

This pattern is not another prompt technique. It is an application-layer contract around model output. The model may suggest a change, but deterministic code should normalize, compare, classify, and authorize that change. A reviewer should be able to answer a concrete question: **“Do I approve this meaning?”**, rather than trying to infer meaning from nested arguments.

## Why raw JSON is a poor review surface

A tool call is optimized for machines. It tends to contain IDs, enum values, defaults, opaque references, and fields that are meaningful only to the service receiving them. A reviewer, however, thinks in entities and consequences: “Move this order from pending to shipped,” “grant this contractor read-only access,” or “change the invoice due date without changing its amount.”

The problem gets worse when a single call touches more than one aggregate. An `update_customer` operation might also invalidate a fraud check, trigger an email, recalculate a subscription, or create an audit event. If the UI renders only the arguments, the reviewer is forced to know the implementation details of every downstream service. That is not a scalable safety mechanism.

A semantic diff is a translation layer. It preserves the machine request, but adds a canonical description of the proposed state transition. The diff should answer five questions:

| Review question | Semantic diff field |
|---|---|
| What is the target? | Entity type, stable identifier, and current version |
| What will change? | Before value, proposed value, and operation type |
| What else may be affected? | Related entities, emitted events, and side-effect estimates |
| What must remain true? | Invariants and policy checks |
| Who or what may approve it? | Risk class, required authority, and expiry |

![A raw tool-call card transforms into an entity-level semantic change map with fields, relationships, and state transitions](/blog/semantic-diff-agents/semantic-diff-map.webp)

## Start with a canonical change set

The model should not be responsible for producing the final review representation. It can propose intent in structured output, but an adapter should resolve references and fetch the current state. The adapter then emits a canonical `ChangeSet` that downstream code can validate and render consistently.

```ts
type ChangeSet = {
  id: string;
  actor: { userId: string; agentId: string; tenantId: string };
  operation: "create" | "update" | "delete" | "transition";
  targets: Array<{
    entity: string;
    id: string;
    version: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    changedPaths: string[];
  }>;
  relations: Array<{
    entity: string;
    id: string;
    relationship: string;
    impact: "read" | "write" | "event" | "unknown";
  }>;
  invariants: Array<{
    name: string;
    status: "preserved" | "violated" | "unknown";
    evidence?: string;
  }>;
  risk: "low" | "medium" | "high" | "critical";
  authorization: { required: string; expiresAt: string };
};
```

The important detail is `before`. A proposal without a trusted before-state is not a diff; it is an assertion. The runtime should read the target at a known version, record that version in the change set, and refuse to commit if the write boundary observes a different version unless the operation explicitly supports a safe merge.

`changedPaths` also deserves care. A path such as `customer.preferences.deliveryAddress` is useful for machines, but reviewers need a domain label as well: “delivery address used for future shipments.” Keep both. The path provides precision; the semantic label provides comprehension.

## A diff is a model of impact, not a prediction of everything

It is tempting to ask the model to list every possible side effect. That creates a long, speculative explanation that looks complete while being impossible to verify. Instead, separate **declared impact** from **observed impact**.

Declared impact comes from contracts: updating an order status emits an event, changing a role invalidates a session, and deleting a workspace removes access to its files. Observed impact comes from the adapter or a dry-run endpoint. Unknown impact must stay visible as unknown. It should never be silently converted into “no impact.”

A useful impact record is small and explicit:

```json
{
  "target": "order:8472",
  "change": "status: processing -> shipped",
  "related": [
    {"entity": "shipment:5521", "impact": "write", "confidence": "declared"},
    {"entity": "customer:91", "impact": "event", "confidence": "observed"}
  ],
  "unknowns": ["carrier pickup timestamp"],
  "invariants": [
    {"name": "payment_captured", "status": "preserved"},
    {"name": "shipment_has_tracking_number", "status": "violated"}
  ]
}
```

The presence of an unknown is not a defect in the UI. It is an honest boundary around what the system can prove. A high-impact unknown should route to a human or block the write. A low-impact unknown may be accepted with an audit note. The policy, not the model’s confidence, makes that decision.

![An impact panel shows one target entity, related records, invariants, unknowns, and a reviewer marking the blast radius](/blog/semantic-diff-agents/impact-panel.webp)

## Compute the diff outside the model

The model is good at translating a natural-language request into a candidate operation. It is not the right authority for deciding whether two records are equal, whether a version has advanced, or whether a role change violates a tenant boundary. Those checks belong in deterministic code.

A practical pipeline has six stages:

| Stage | Runtime responsibility | Model responsibility |
|---|---|---|
| Interpret | Extract a candidate intent and missing information | Explain the request and propose an operation |
| Resolve | Map names to stable IDs and fetch current versions | Ask for clarification when resolution is ambiguous |
| Normalize | Convert the proposal into a typed change set | Supply field-level intent where the contract permits |
| Compare | Calculate before/after changes and impact | Explain why the change satisfies the user’s goal |
| Authorize | Apply policy, invariants, expiry, and actor scope | Never override a rejection |
| Commit | Write using version checks and idempotency | Report the result after the system confirms it |

This boundary also makes testing easier. You can feed a fixed current state and a proposed operation into the normalizer and assert that the same semantic diff appears every time. You can test policy independently from prompt wording. You can review a renderer without giving it production credentials.

## Risk should follow meaning, not tool names

A common shortcut is to classify `update_customer` as low risk and `delete_workspace` as high risk. Tool names are not enough. An update that changes a display label may be harmless; the same endpoint may also change a legal name or tax identifier. Risk belongs on the semantic operation and its target fields.

One workable policy matrix looks like this:

| Semantic change | Default route | Additional gate |
|---|---|---|
| Add an internal note | Automatic, audited | No external notification |
| Change a customer’s delivery address | Review or automatic by tenant policy | Fresh version and address validation |
| Change a permission scope | Human approval | Actor identity and scope diff |
| Delete data or revoke access | Human approval or block | Deletion evidence and recovery plan |
| Move money or create a binding commitment | Block by default | Strong authorization and explicit confirmation |

The review surface should not hide low-risk noise behind a wall of high-risk details. It should show a compact summary first, then let the reviewer expand the exact fields, relationships, evidence, and policy decisions. The goal is not maximal information. It is **decision-relevant information**.

![A risk-weighted approval ladder separates automatic low-risk changes, human review, and blocked high-risk actions](/blog/semantic-diff-agents/approval-ladder.webp)

## Preserve intent without pretending to read thoughts

“Review intent” can sound like a request to expose hidden reasoning. It is not. The system does not need private chain-of-thought. It needs a concise, testable statement of the desired outcome and the authorized mutation.

For example, the agent can return: “The user asked to move order 8472 to shipped because the carrier pickup was confirmed.” The application can then verify whether the proposed status transition is legal, whether a tracking number exists, and whether the actor has authority. The explanation is evidence for a reviewer, not proof that the model reasoned correctly.

Store decision facts, not speculative inner narration:

```ts
type ReviewSummary = {
  requestedOutcome: string;
  proposedMutation: string;
  evidenceIds: string[];
  rejectedAlternatives?: string[];
  uncertainty: string[];
};
```

`requestedOutcome` should be grounded in the user request or workflow objective. `proposedMutation` should be generated from the canonical change set, not copied blindly from the model. This prevents a mismatch where the prose says “update the delivery address” while the payload edits a billing address.

## The write boundary must re-check everything

A semantic diff is useful before approval, but it is not a permanent authorization. The world can change while a person is reviewing a request. Another worker may update the record, the user’s permission may be revoked, or a policy may become effective. The final adapter must recompute or revalidate the diff immediately before the side effect.

![A guarded write boundary compares before and after state, checks invariants, creates an audit receipt, and only then commits](/blog/semantic-diff-agents/write-boundary.webp)

```ts
async function commit(changeSet: ChangeSet) {
  await assertActorStillAuthorized(changeSet.actor);
  await assertPolicyStillAllows(changeSet);
  const current = await readTargets(changeSet.targets);
  const freshDiff = diff(current, changeSet);

  if (!freshDiff.sameTargetVersions) {
    return { status: "stale", action: "replan" };
  }
  if (freshDiff.invariants.some((x) => x.status === "violated")) {
    return { status: "rejected", action: "escalate" };
  }
  if (freshDiff.risk === "critical") {
    return { status: "blocked", action: "explicit_confirmation" };
  }

  return await writeWithIdempotencyKey(changeSet.id, freshDiff);
}
```

The write adapter should distinguish “request accepted,” “side effect completed,” and “client observed the response.” If the network fails after the server commits, the change set remains in an unknown state and needs reconciliation. A semantic diff does not replace an action ledger, idempotency, or compensation strategy; it makes the proposed mutation understandable before those mechanisms operate.

## What to log and what not to log

A reviewable change set is also an audit artifact, but retaining every prompt and tool payload forever is not a privacy strategy. Keep the minimum needed to reconstruct the decision boundary: change-set ID, actor identities, target versions, changed paths, invariant results, policy version, approval event, evidence references, and commit outcome. Redact sensitive before-and-after values when a field-level hash or classification is sufficient.

The renderer should be able to show a reviewer why a change was allowed without exposing secrets to every support operator. Separate access to raw values from access to the semantic summary. Treat the diff itself as sensitive because it may reveal customer state even when the original prompt has been deleted.

## Rollout without turning every action into a meeting

Start with read-only previews. For a sample of real workflows, generate semantic diffs beside the existing tool calls and compare them with what reviewers believe the tool will do. Measure missing relationships, false side effects, unknown fields, and review time. Do not begin by blocking production writes on a new formatter that has not earned trust.

Then choose one domain with clear invariants, such as order status or access scope. Make the diff mandatory for medium- and high-risk mutations, while allowing low-risk updates to flow automatically with an audit record. When a diff is rejected, store the reason as a structured policy signal rather than asking the model to “try again” without context.

A strong first release has these properties:

| Property | Acceptance test |
|---|---|
| Stable | Same state and operation produce the same diff |
| Grounded | Every changed field maps to a real target version |
| Honest | Unknown impact remains visible |
| Actionable | A reviewer can approve, edit, reject, or request replan |
| Enforced | The write adapter recomputes the diff |
| Auditable | Approval and commit are linked by one immutable ID |

## Closing: make approval about consequences

AI agents do not become safe because their JSON is valid, nor because an explanation sounds confident. They become safer when the application turns a vague proposal into a bounded state transition that another system—or a human—can inspect.

A semantic diff is a small but powerful interface between probabilistic intent and deterministic authority. It names the target, shows the change, exposes the blast radius, reports what remains unknown, and gives policy a concrete object to approve. Once that object exists, the rest of the system can do its job: evaluate invariants, enforce scope, handle stale versions, record evidence, and commit only when the proposed meaning still matches reality.

The best review button is not the one that says **Approve JSON**. It is the one that makes the consequence legible.

## References

[1]: https://www.langchain.com/state-of-agent-engineering "LangChain — State of Agent Engineering"
[2]: https://www.oreilly.com/radar/signals-for-2026/ "O’Reilly — Signals for 2026"
[3]: https://arxiv.org/abs/2607.13111 "SemaDiff: Identifying Semantic-Changing Commits with Generated Code and Tests"
