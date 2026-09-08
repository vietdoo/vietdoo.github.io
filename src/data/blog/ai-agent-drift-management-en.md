---
title: "AI Agent Change Management: Detecting Drift Before Actions Break"
description: "A production playbook for detecting tool, policy, schema, permission, and world-state drift before an AI agent turns a previously valid plan into a broken or unsafe action."
pubDate: 2026-04-22
category: "engineering"
image: "/blog/ai-agent-drift/hero.webp"
lang: "en"
translationKey: "ai-agent-drift-management"
draft: false
---

![A hand-drawn AI agent compares a saved plan with changing tools, policies, permissions, and world state before taking action](/blog/ai-agent-drift/hero.webp)

The incident looked like a tool failure.

An AI agent had been asked to update a customer’s delivery address. It found the right record, selected the right tool, and produced a plan that passed schema validation. The workflow then waited behind a deployment. When the worker resumed, the tool still existed and the JSON still looked correct.

The request failed anyway. The fulfillment service had changed the address contract between planning and execution: the old field was still accepted, but its meaning had moved from “delivery address” to “preferred address.” The agent had not hallucinated. It had acted on a plan whose environment had drifted underneath it.

That distinction matters. A hallucination is a problem in the model’s output. **Drift is a problem in the relationship between a once-valid decision and the system in which that decision is eventually executed.** Tools evolve. Policies change. permissions are revoked. Prompt templates are edited. Retrieval indexes refresh. Tenants change configuration. A payment, order, or document moves to a new state while the agent is thinking.

> **The thesis:** Treat every agent plan as a versioned proposal with an expiry window, a dependency manifest, and a preflight check. Do not ask the model to notice every environmental change. Let the application detect drift and choose whether to refresh, replan, downgrade, or refuse.

This is a change-management problem with an AI-shaped failure mode. The system does not need to freeze every dependency. It needs to know which changes are compatible with the proposed action, which changes invalidate the plan, and which changes require a human decision.

## Drift is not one thing

Teams often use “drift” as a synonym for model quality degradation. That is too narrow for an agent that can call tools and change external state. A useful drift taxonomy starts with the dependency that moved.

| Drift type | What changed? | Example | Safe default |
|---|---|---|---|
| Tool-contract drift | Name, schema, enum, validation, or side-effect semantics changed. | `address` now means a saved preference rather than a shipment destination. | Reject or route to a compatible adapter. |
| Policy drift | A rule, threshold, approval requirement, or effective date changed. | Refunds above a new threshold now need a human approval. | Re-evaluate policy before committing. |
| Permission drift | Identity, tenant scope, token, role, or delegation changed. | The user loses access while the run is paused. | Refuse the action and record the new authorization result. |
| Prompt or model drift | Model version, system instruction, tool description, or routing policy changed. | The same request is planned under a new instruction set. | Tag the run and re-run evaluation or replan. |
| Data or retrieval drift | Evidence, index, source version, or freshness changed. | The product is discontinued after retrieval but before purchase. | Refresh evidence for material decisions. |
| World-state drift | The target resource changed outside the agent. | An order moved from editable to locked. | Compare versions and revalidate at the write boundary. |
| Operational drift | Latency, capacity, region, queue, or outage conditions changed. | A tool becomes available only through a degraded fallback. | Apply capability and risk gates before continuing. |

These categories can overlap. A policy deployment may change the required permission. A tool schema change may expose a new side effect. A retrieval refresh may reveal that an earlier recommendation is no longer valid. The point of the taxonomy is not to create seven dashboards. It is to make the invalidation rule explicit.

![A layered drift map connects tool contracts, policies, permissions, data, models, and world state to one agent plan](/blog/ai-agent-drift/drift-map.webp)

## A plan needs a dependency manifest

Most agent systems checkpoint messages and tool arguments. That is not enough to make a plan reproducible. A plan is a function of its inputs and environment, so persist the versions that can change its meaning.

```ts
type DependencyManifest = {
  toolContracts: Array<{
    tool: string;
    contractVersion: string;
    semanticHash: string;
  }>;
  policyBundles: Array<{
    policyId: string;
    version: string;
    effectiveAt: string;
  }>;
  permissionSnapshot: {
    principalId: string;
    tenantId: string;
    scopes: string[];
    delegationVersion: string;
  };
  modelContext: {
    modelId: string;
    systemPromptVersion: string;
    routerPolicyVersion: string;
  };
  evidence: Array<{
    evidenceId: string;
    sourceVersion: string;
    observedAt: string;
    expiresAt: string;
  }>;
  targetVersions: Array<{
    resource: string;
    version: string;
  }>;
};

type AgentPlan = {
  planId: string;
  createdAt: string;
  validUntil: string;
  riskClass: "low" | "medium" | "high" | "critical";
  dependencyManifest: DependencyManifest;
  steps: Array<{ tool: string; args: unknown }>;
  revalidation: Array<RevalidationRule>;
};
```

The manifest is not a prompt transcript. It is a compact statement of what the application must check before allowing a side effect. Keep sensitive content out of it unless the content itself is the dependency. Hash large schemas and policies where a hash is sufficient; retain a resolvable version identifier so an operator can inspect the exact artifact later.

Semantic Versioning is a useful starting convention for public APIs: incompatible changes should increment the major version, while compatible additions and fixes can use minor or patch increments. An agent platform should not blindly assume that a version number proves compatibility, however. A tool may preserve its JSON schema and still change side-effect semantics. Record both a declared contract version and a machine-checkable semantic fingerprint for the parts that matter to the action.

## Compatibility is a matrix, not a boolean

A plan does not simply match or mismatch the current environment. Different changes have different consequences for different steps.

| Change observed | Read-only lookup | Draft response | Reversible write | Irreversible action |
|---|---:|---:|---:|---:|
| Add optional tool field | Usually compatible | Usually compatible | Compatible after adapter test | Revalidate |
| Rename or reinterpret a field | Replan | Replan | Reject old plan | Reject old plan |
| New policy threshold | Refresh policy | Refresh policy | Re-authorize | Human or policy gate |
| Permission scope reduced | Re-check | Re-check | Refuse if scope is missing | Refuse |
| Target version changed | Refresh if material | Refresh if material | Compare-and-swap | Refuse or escalate |
| Model or prompt version changed | Tag only | Re-evaluate if quality-sensitive | Replan for high risk | Replan and re-approve |
| Evidence expired | Refresh | Refresh | Refresh immediately | Refresh plus final invariant |

This matrix is deliberately conservative around external state changes. A plan that only formats a response can often survive a prompt patch. A plan that charges a card or deletes data should not inherit the same tolerance.

The result of compatibility checking should be structured. “Looks fine” is not a useful production state.

```ts
type DriftDecision =
  | { kind: "continue"; checkedAt: string }
  | { kind: "refresh"; dependencies: string[]; reason: string }
  | { kind: "replan"; changed: string[]; reason: string }
  | { kind: "downgrade"; allowedAction: string; reason: string }
  | { kind: "refuse"; reasonCode: string; humanMessage: string };
```

The application should own this decision. The model may explain a refusal or propose a new plan, but it should not be able to override a failed policy, permission, version, or fencing check by producing more confident prose.

## Detect drift at the boundaries that matter

There is no value in comparing every dependency before every token. There is value in checking the dependencies that can invalidate the next meaningful transition.

The first boundary is **before planning**. Load the current tool catalog, policy bundle, identity scope, and relevant evidence contract. This prevents the agent from planning with a stale description of its capabilities.

The second boundary is **after planning**. Store the dependency manifest alongside the plan. This creates an audit record and gives the executor a precise comparison target.

The third boundary is **before each high-impact tool call**. A long workflow may contain safe reads followed by one irreversible write. Rechecking only at the start is not enough. The final side-effect boundary should verify permission, policy, resource version, freshness, lease ownership, and tool semantics.

The fourth boundary is **after a pause or retry**. A resumed worker is not continuing in the same world. It is re-entering a world that may have changed while it was absent.

```ts
async function preflight(plan: AgentPlan): Promise<DriftDecision> {
  const current = await loadCurrentEnvironment(plan.dependencyManifest);
  const changed = compareManifest(plan.dependencyManifest, current);

  if (changed.some((item) => item.blocks(plan.riskClass))) {
    return { kind: "replan", changed: changed.map((item) => item.name), reason: "blocking_drift" };
  }

  const expired = changed.filter((item) => item.requiresRefresh);
  if (expired.length > 0) {
    return { kind: "refresh", dependencies: expired.map((item) => item.name), reason: "refreshable_drift" };
  }

  return { kind: "continue", checkedAt: new Date().toISOString() };
}
```

The check should be cheap enough to run frequently and strict enough to stop unsafe transitions. That usually means keeping a small, queryable version record for tool contracts, policy bundles, permissions, and target resources rather than diffing entire databases during execution.

## Tool descriptions need release discipline

A tool description is part of the agent’s executable interface. It tells the model what the tool does, what arguments it accepts, what errors mean, and whether the operation is reversible. Editing the description is therefore closer to changing an API contract than changing copy in a help center.

For every tool, maintain a release record with at least:

| Field | Why it matters |
|---|---|
| Stable tool identifier | Lets plans refer to a capability without relying on display text. |
| Contract version | Provides an explicit compatibility anchor. |
| Input and output schema hash | Detects structural changes. |
| Side-effect classification | Separates reads, reversible writes, and irreversible actions. |
| Error taxonomy version | Prevents retry logic from misreading a new failure mode. |
| Rollout state | Allows shadow, canary, tenant allowlist, and rollback decisions. |
| Deprecation deadline | Stops old plans from running indefinitely. |

A compatible schema change is not automatically a compatible behavior change. Add contract tests that assert semantic invariants: a lookup must not mutate state; a cancellation must not target a different resource; an empty result must not be interpreted as success; and a retryable error must be distinguishable from a committed-but-unknown outcome.

Existing folio guidance on tool contract testing is the natural companion here. The new concern is not whether a provider can call the tool today. It is whether a plan created yesterday is still allowed to call the tool today.

## Policies should carry effective time and precedence

Policy drift is especially dangerous because the old plan can remain technically executable. The system may accept the request while violating a rule that became effective during the run.

Represent policies as versioned, effective-dated bundles rather than unstructured text alone.

```ts
type PolicyBundle = {
  policyId: string;
  version: string;
  effectiveAt: string;
  expiresAt?: string;
  priority: number;
  rules: Array<{
    action: string;
    condition: string;
    effect: "allow" | "deny" | "require_approval";
  }>;
  supersedes?: { policyId: string; version: string };
};
```

At execution time, evaluate the policy that is effective for the action’s commit timestamp, not merely the policy that was present when the model started thinking. If the policy bundle has changed, preserve the old decision as history, but do not silently apply its authorization to a new side effect.

Policy precedence must also be deterministic. A tenant-specific restriction should not disappear because a general product policy was loaded later. A deny rule should not be converted into a model suggestion. If the system cannot explain which policy won and why, the policy layer is not ready to govern an autonomous action.

## World-state drift needs compare-and-swap

An agent plan often includes an assumption such as “order version is 18” or “document status is `pending_review`.” Carry that assumption to the write boundary and make the storage layer enforce it.

```sql
UPDATE orders
SET delivery_address = :new_address,
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = :order_id
  AND version = :expected_version
  AND status = 'editable';
```

If the affected-row count is zero, the action did not prove its preconditions. Do not ask the model to guess whether the update probably happened. Return a typed conflict, reload the resource, and decide whether a new plan is safe.

This pattern is more than a database optimization. It turns world-state drift into a bounded state transition. The agent can be smart about choosing a new path, but the commit boundary remains boring and deterministic.

![A preflight gate compares plan fingerprints and current versions before routing the run to continue, refresh, replan, downgrade, or refuse](/blog/ai-agent-drift/preflight-gate.webp)

## Not every drift requires a full replan

Overreacting to every change creates unnecessary latency and cost. Underreacting to material change creates unsafe execution. Use a graduated response.

**Continue** when the change is demonstrably compatible, the action is low risk, and the relevant evidence remains fresh. Record what was checked.

**Refresh** when a dependency is stale but the plan’s intent and action contract remain valid. Retrieve the current policy, re-read the target, or fetch the latest tool metadata, then re-run the affected validation.

**Replan** when the changed dependency affects the meaning of an argument, the allowed outcome, the target resource, or the action sequence. A replan should create a new plan version rather than mutating the old one.

**Downgrade** when the system can safely offer a less powerful action. For example, if a purchase commitment cannot be validated, the agent may present options or save a draft instead of submitting the order.

**Refuse or escalate** when the action is irreversible, authorization is missing, policy is ambiguous, or the system cannot establish a trustworthy current state.

![A five-path response ladder shows continue, refresh, replan, downgrade, and refuse as increasingly conservative responses to drift](/blog/ai-agent-drift/response-ladder.webp)

The user experience should make these outcomes understandable. “I stopped because the order changed while I was waiting; here is the current state” is better than a generic tool error. The message should not expose sensitive policy internals, but it should give the user a useful next step.

## Measure drift as an operational signal

A drift detector that only blocks actions will eventually be disabled as “too noisy.” Measure it as a first-class reliability signal.

| Metric | What it reveals |
|---|---|
| Drift detection rate per workflow | Which workflows depend on unstable contracts or long waits. |
| Blocking drift rate | How often a plan would have crossed an unsafe boundary. |
| Refresh success rate | Whether drift can be resolved without a full replan. |
| Replan conversion rate | How often a changed dependency alters the action path. |
| Safe downgrade rate | Whether the product has useful non-committing fallbacks. |
| Refusal and escalation rate | Where policy, authorization, or evidence remains ambiguous. |
| Stale-plan execution attempts | Whether a worker is bypassing the preflight gate. |
| Time from dependency release to agent rollout | Whether tool and policy changes have controlled propagation. |

The goal is not to drive drift to zero. Change is normal in a production system. The goal is to make change visible, classify it correctly, and prevent the dangerous subset from becoming an unreviewed side effect.

This matters because controlled evaluations do not fully predict behavior in a changing environment. The International AI Safety Report 2026 describes an evaluation gap: pre-deployment tests do not reliably establish real-world utility or risk, while autonomous operation makes intervention harder when failures occur. Drift management is one practical response to that gap. It adds checks at the point where the agent meets the live system rather than assuming that a successful test permanently proves compatibility.

## A rollout sequence that does not freeze the platform

Start with observation mode. Compute manifests, compare versions, and emit decisions without blocking low-risk actions. Use the findings to identify which dependencies actually change and which alerts are noise.

Next, enforce hard gates for high-impact writes. Require current permissions, effective policy, target version, fresh evidence, and tool-contract compatibility before committing. Keep the old plan immutable for audit and create a new plan when re-planning.

Then add release integration. A tool or policy deployment should publish its contract version, compatibility notes, affected workflows, and rollback status. The agent platform should be able to answer: which active plans depend on this artifact, and which of them must be paused?

Finally, test the negative paths. Change a policy while a run waits. Revoke a delegated scope. Replace a tool with a backward-incompatible contract. Modify the target resource after planning. Expire the evidence. Kill the worker before the final write. The expected outcome should be a typed refresh, replan, downgrade, refusal, or escalation—not a best-effort action.

## Closing: the plan is not the authority

An agent plan is useful because it captures intent. It is dangerous when the system mistakes captured intent for current authority.

The production boundary should remain clear: the model proposes, the manifest records dependencies, the detector compares versions, the policy layer decides what is allowed, and the storage or tool gateway enforces the final invariant. That separation lets an agent remain adaptive without making every environmental change a prompt-engineering problem.

The most reliable agent is not the one that insists its original plan is still correct. It is the one that can say, with evidence, **“the world changed; here is the safest next step.”**

## References

[1]: https://semver.org/ "Semantic Versioning 2.0.0"
[2]: https://kubernetes.io/docs/concepts/workloads/pods/probes/ "Kubernetes Documentation — Liveness, Readiness, and Startup Probes"
[3]: https://internationalaisafetyreport.org/publication/international-ai-safety-report-2026 "International AI Safety Report 2026"

## Related reading

- [State-Aware Browser Agents: Verifying the World Before Every Click](/blog/state-aware-browser-agents)
- [AI Agents Have a Clock: Deadlines, Leases, and Stale Plans](/blog/ai-agent-time-semantics)
- [Contract Testing for AI Tools: Proving an Agent Can Safely Call the Same Capability Across Providers](/blog/contract-testing-ai-tools)
- [Human-in-the-Loop Is Not an Approve Button: Designing Action Gates Without Consent Fatigue](/blog/human-in-the-loop-action-gates)
