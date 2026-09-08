---
title: "AI Agent Release Experiments: Shadow Traffic, Counterfactual Replay, and Promotion Gates"
description: "A production playbook for changing models, prompts, tools, retrieval, and policies without making real users the test harness. Learn how to combine offline evals, shadow traffic, counterfactual replay, canary cohorts, and abort-first promotion gates."
pubDate: 2026-07-24
category: "engineering"
image: "/blog/ai-agent-release-experiments/hero.webp"
lang: "en"
translationKey: "ai-agent-release-experiments"
draft: false
---

![A hand-drawn release board routes an AI agent through production, shadow traffic, replay, canary, and promote-or-abort gates](/blog/ai-agent-release-experiments/hero.webp)

The first time I saw a model release go wrong, the dashboard looked healthy.

Latency was down. Token usage was down. The new prompt produced shorter answers, and the thumbs-up rate had not moved enough to trigger an alert. We promoted it to everyone.

A few hours later, support tickets started arriving. The agent was still polite and still answered most questions. It had simply become less willing to ask one clarifying question before changing an account. A small change in the prompt had changed the boundary between “I understand your intent” and “I am guessing.” The system metrics were green because the system was fast. The business behavior was not.

That incident changed how I think about releases for AI products. A release is not only a new container or a new model name. It can be a prompt revision, a retrieval index, a tool schema, a routing policy, a safety classifier, a memory rule, or a combination of all of them. Each one changes what the agent is likely to do.

> **The thesis:** Do not ask real users to discover whether an AI change is safe. Treat behavior as a release artifact, compare it through increasingly realistic experiments, and make promotion a reversible decision with explicit safety gates.

This article presents a practical sequence: offline evaluation, side-effect-free shadow traffic, counterfactual replay, a small canary cohort, and controlled promotion. The goal is not to make an agent deterministic. The goal is to make uncertainty visible before it becomes a customer incident.

## The release unit is larger than the model

Traditional deployment language encourages a narrow question: which binary is running? For an AI agent, the answer is incomplete. The behavior users experience may depend on a bundle of versions and runtime decisions.

| Release component | What can change | Typical failure that follows |
|---|---|---|
| Model | reasoning style, tool selection, refusal boundary, verbosity | A safe request is rejected, or a risky request is accepted |
| Prompt and policy | priorities, definitions, escalation instructions | The agent stops asking for missing information |
| Retrieval index | chunks, ranking, freshness, metadata filters | A plausible answer is grounded in stale evidence |
| Tool schema | names, required fields, descriptions, enum values | The agent chooses the wrong capability or sends malformed arguments |
| Router | model/provider selection, fallback rules, budgets | Difficult requests silently use a weaker route |
| Memory policy | what is recalled, summarized, expired, or scoped | Old context wins over the current user intent |
| Safety layer | classifiers, allowlists, approval thresholds | The same output receives a different action decision |

The release identifier should therefore be an immutable bundle, not a loose model label.

```ts
type AgentRelease = {
  releaseId: string;          // e.g. agent-2026-07-24.3
  model: string;
  promptRevision: string;
  toolSchemaRevision: string;
  retrievalRevision: string;
  policyRevision: string;
  routerRevision: string;
};
```

When an incident is reported, “we upgraded the model” is not enough information to reproduce it. The system must be able to answer which bundle saw the request, which evidence was retrieved, which tools were available, which policy made the decision, and which outcome was committed.

This does not mean every release needs a heavyweight platform. It means the release boundary has to be named before the experiment begins. Otherwise, the team compares two moving targets and calls the result a test.

## Five modes, five different questions

Offline evals, shadow traffic, replay, canary, and full rollout are often described as one progressive ladder. They are related, but they answer different questions.

![Three experiment modes separate fixed offline tasks, side-effect-free shadow traffic, and guarded canary writes](/blog/ai-agent-release-experiments/experiment-modes.webp)

| Mode | Question | What is real | What must be isolated |
|---|---|---|---|
| Offline eval | Can the candidate satisfy known contracts? | Dataset and graders | Production identity, live writes, private data |
| Shadow traffic | How does it behave on the shape of live requests? | Request distribution and timing | User-visible response and side effects |
| Counterfactual replay | What would the candidate have done under the same recorded evidence? | Context, tool results, policy state | External calls and new world state |
| Canary | Does it hold up with a small group of real users? | User experience and carefully scoped effects | Blast radius, high-risk actions, irreversible writes |
| Full rollout | Is the candidate the new default? | Normal production | Rollback path and stable reference |

A useful discipline is to write the exit condition for each mode before running it. “The new model feels better” is not an exit condition. “No critical safety invariant regressed, p95 latency is within budget, and the candidate improves task completion on the target slice” is measurable, even if the measurements remain imperfect.

OpenAI’s evaluation guidance emphasizes task-specific tests, production-shaped data, continuous evaluation, and human calibration rather than generic scores. Anthropic’s agent evaluation guidance makes a similar distinction between the transcript and the final environment outcome, and recommends combining code-based, model-based, and human graders. Those ideas matter here because a release can sound better while leaving the wrong database state behind.

## Start with a release ledger

Before sending traffic anywhere, create a release ledger. It is the boring document that prevents a confident rollout from becoming an archaeological dig.

```ts
type ReleaseLedger = {
  releaseId: string;
  baselineReleaseId: string;
  owner: string;
  hypothesis: string;
  targetSlices: string[];
  excludedSlices: string[];
  allowedEffects: "none" | "reversible" | "scoped";
  hardStops: string[];
  softSignals: string[];
  samplePlan: string;
  startAt: string;
  expiresAt: string;
};
```

The hypothesis should be specific enough to fail. For example: “On Vietnamese billing questions with current policy documents, release `agent-2026-07-24.3` will reduce unnecessary escalation without increasing unsupported claims or unauthorized tool calls.” That is much more useful than “the new prompt improves quality.”

Define slices before looking at the results. Language, tenant tier, request type, tool surface, risk class, and conversation length can all change the apparent outcome. If the team invents slices after seeing the chart, it can always find a green segment.

The ledger should also name what the candidate is not allowed to do. A shadow run that can send an email is not a shadow run; it is a parallel production system. A replay that queries today’s stock price is not a counterfactual replay; it is a new external observation that may change the conclusion.

## Offline evals are a filter, not a prophecy

Offline evaluation is the cheapest place to reject a release. It is also the easiest place to become overconfident.

A small suite can check tool selection, argument validity, policy adherence, groundedness, end-state correctness, latency, token use, and cost. Use deterministic checks where the contract is deterministic. Use a rubric or pairwise comparison where several answers can be acceptable. Use human review for the cases where the cost of a false pass is high.

```yaml
release: agent-2026-07-24.3
baseline: agent-2026-07-08.2
suite:
  - name: billing-intent
    graders:
      - type: classification
        expect: billing_question
      - type: tool_calls
        forbid: refund_payment
      - type: rubric
        require: asks_for_missing_invoice_id
  - name: grounded-answer
    graders:
      - type: citation_check
      - type: state_check
        expect: no_external_write
  - name: safety-boundary
    graders:
      - type: policy_invariant
        require: high_risk_action_requires_approval
thresholds:
  critical_safety_regressions: 0
  task_success_delta: ">= 0"
  p95_latency_delta: "<= 15%"
```

Do not reduce the release decision to one average score. A release that improves easy FAQ cases by two points while adding one unauthorized side effect is not a net improvement. Put non-negotiable invariants above weighted quality scores.

Repeated trials matter because agent behavior varies. A candidate may pass a task once by choosing a lucky route and fail it on the next run. Track both the average outcome and the consistency of the outcome for high-stakes tasks. If a financial action needs to succeed reliably, an attractive pass-at-least-once number is not enough.

Offline evals tell you whether the candidate can handle the cases you already know. They do not tell you how it reacts to the long tail of production phrasing, stale context, odd tool results, retries, or a tenant-specific policy combination. That is why the next step is a live-shaped experiment with no user impact.

## Shadow traffic is real traffic with the effects removed

A proper shadow test copies the input to a candidate while only the stable route returns a response to the calling application. AWS describes shadow testing as a way to compare a deployed variant against the current infrastructure, including operational metrics such as latency and error rate, without end-user impact.

For an agent, “no user impact” needs a stricter definition than “we do not display the candidate answer.” The candidate must not send an email, mutate a CRM record, reserve inventory, charge money, or leak a private tool result into a shared log. The side-effect boundary belongs in the tool gateway, not only in the UI.

```ts
async function handleRequest(input: UserInput) {
  const stable = runAgent({
    input,
    release: stableRelease,
    mode: "production",
    effects: "allowed",
  });

  void runAgent({
    input: redactForExperiment(input),
    release: candidateRelease,
    mode: "shadow",
    effects: "disabled",
    toolAdapter: replayOrStubTools,
  }).catch((error) => recordShadowFailure(error));

  return stable;
}
```

The shadow path should receive enough context to expose real behavior, but no more data than the experiment requires. Use tenant-aware sampling, redaction, retention limits, and an experiment identifier. A shadow request is still processing customer-derived content; hiding the response from the user does not make the data harmless.

Record the candidate’s tool intent even when execution is blocked. “Would have called `refund_payment` with amount 149000” is useful evidence. “The candidate produced a response” is not enough to explain a safety regression.

Shadow traffic is especially good at finding operational differences: latency tails, token spikes, prompt-size surprises, provider errors, tool-schema incompatibilities, and unexpected route selection. It is weaker at measuring user satisfaction because the user never sees the candidate. It is also not proof that a write would have been correct; the write was intentionally blocked.

## Counterfactual replay asks “what if?” without changing the world

A production trace is not automatically replayable. It may contain a prompt without the exact retrieved context, a tool call without the tool response, or a response without the policy version that allowed it. A useful replay envelope captures the inputs that determined the decision, while removing secrets and unstable identifiers.

![A recorded envelope feeds the candidate agent with replayed tool results and a comparison ledger, while a no-external-writes boundary prevents new side effects](/blog/ai-agent-release-experiments/counterfactual-replay.webp)

```ts
type ReplayEnvelope = {
  traceId: string;
  intentClass: string;
  redactedInput: unknown;
  retrievedEvidence: Evidence[];
  toolResults: Record<string, unknown>;
  policyRevision: string;
  baselineRelease: string;
  baselineOutcome: Outcome;
  recordedAt: string;
};
```

The phrase “counterfactual” is useful because the candidate is answering a question about an alternative world: what would this release have done if it had seen the same request and the same tool observations? The replay must not silently substitute current data for recorded data. If it does, the experiment mixes release behavior with world changes.

Compare at four layers.

| Comparison layer | Example check | Decision meaning |
|---|---|---|
| Deterministic | JSON schema, required field, forbidden tool | A hard contract changed or broke |
| Semantic | Intent, answer coverage, citation support | The candidate may be better or worse in meaning |
| Safety | Approval requirement, tenant scope, effect class | A critical invariant was preserved or violated |
| Operational | Turns, latency estimate, tokens, cost band | The candidate may be too expensive or slow |

For semantic checks, use narrow rubrics and keep a human-calibrated sample. An evaluator can prefer a longer answer, mistake confidence for correctness, or miss that the final state is wrong. Compare the candidate to the baseline on the same envelope, and keep the disagreements for review instead of collapsing them into a single “quality score.”

Replay is also where teams discover that they did not store enough evidence. That is not a reason to log everything forever. It is a reason to define the minimum replay contract: redacted input, relevant evidence references or snapshots, tool result classes, policy and release versions, and the final business outcome.

## Canary users are not a random sacrifice

After offline and shadow checks, a canary exposes the candidate to a controlled cohort. A cohort can be selected by tenant, feature flag, internal users, geography, request class, or a stable hash. The selection rule is part of the experiment because a canary made only of friendly internal prompts will not represent the hardest traffic.

Progressive delivery systems commonly express a canary as a sequence of traffic weights and pauses, with analysis deciding whether the rollout proceeds or is aborted. The same idea works for agents, but the metrics must include behavior and effects, not only HTTP health.

```text
candidate  ->  1%  -> pause + analyze
                 | green
                 v
              5%   -> pause + analyze
                 | green
                 v
             25%   -> pause + analyze
                 | green
                 v
            100%   -> keep rollback reference
```

Start with a small, meaningful cohort rather than a tiny number that cannot produce enough evidence. A one-percent canary of a low-volume workflow may take days to reveal anything. Conversely, a one-percent canary of a high-risk financial action can still be too large if the action is irreversible.

Guarded writes need their own policy. During a canary, allow reversible effects with a clear compensating action, keep high-risk actions behind approval, and block any action whose reconciliation path is not ready. Do not make the safety of a canary depend on everyone remembering to click the right UI button.

The stable release should remain warm enough to receive an immediate rollback. A rollback is not merely switching a model name. It may require restoring the prompt, router, tool schema, retrieval index, and policy bundle that defined the previous behavior.

## Promotion gates should be asymmetric

Quality is usually a gradual signal. Safety is often not. A small improvement in answer helpfulness cannot compensate for an unauthorized write.

![A release decision board separates quality, safety, latency-cost, and health gates, with UNKNOWN routed to human review and critical violations routed to ABORT](/blog/ai-agent-release-experiments/promotion-gates.webp)

Use at least three outcomes for a gate: continue, abort, and unknown. “Unknown” is not green. It means the evidence is insufficient, the data is delayed, or the system cannot establish whether the candidate is safe. Route it to a pause or a named human owner.

| Signal | Example promotion rule | If it fails |
|---|---|---|
| Critical safety invariant | Zero unauthorized side effects; zero cross-tenant evidence leaks | Abort immediately |
| Task outcome | No regression on protected task slices; improvement on stated target slice | Pause, inspect, or reject |
| Groundedness | Unsupported-claim rate stays below the contract threshold | Pause and review samples |
| User experience | Resolution, escalation, or rework improves within a confidence band | Continue cautiously or hold |
| Latency and cost | p95 and cost per successful task remain within budget | Pause, tune, or reject |
| Operational health | No new provider, tool, queue, or memory failure pattern | Pause and investigate |

This gate model avoids a common mistake: treating every metric as a weighted average. The right question is not “did the score go up?” It is “which invariants are allowed to trade against which other signals?”

A practical decision record might look like this:

```json
{
  "release": "agent-2026-07-24.3",
  "baseline": "agent-2026-07-08.2",
  "stage": "canary-5pct",
  "decision": "pause",
  "reason": "semantic_quality_unknown",
  "hardStops": { "unauthorized_effects": 0, "tenant_leaks": 0 },
  "observed": { "unauthorized_effects": 0, "tenant_leaks": 0 },
  "owner": "oncall-ai-platform",
  "nextAction": "human_review_40_sampled_traces"
}
```

The record should be append-only or otherwise auditable. If the team edits the threshold after seeing an inconvenient result, the experiment has changed and must be labeled as a new decision.

## Abort first, then learn why

A release process is not mature because it promotes smoothly. It is mature when it aborts without drama and leaves enough evidence to explain the decision.

Define hard stops before the experiment begins. Examples include a new unauthorized tool call, cross-tenant retrieval, a forbidden data class entering the model context, a surge in high-risk approvals, duplicate external effects, or a tool result that cannot be reconciled. These conditions should stop the candidate even if the response quality chart looks excellent.

Soft signals can pause rather than abort: a moderate latency increase, an uncertain semantic comparison, a small cost rise, or a drift in escalation rate. The distinction is important because not every regression deserves the same blast-radius response.

When aborting, preserve the candidate release and its evidence. Do not delete the traces that explain the failure, but do not retain raw customer content indefinitely just because the rollout failed. Store a redacted evidence pack with the release ledger, sampled inputs or references, policy decisions, tool intents, outcome diffs, and the exact gate that fired.

## A rollout sequence that works in practice

First, name the bundle and write a falsifiable hypothesis. Add the release ledger to the same change review as the model, prompt, tool, retrieval, or policy change.

Second, run a small offline suite. Reject hard contract failures immediately. Use a protected regression slice so the team cannot improve the target behavior by silently breaking an important old behavior.

Third, run shadow traffic with a strict side-effect firewall. Measure operational behavior and candidate tool intent, but do not pretend shadow results are user satisfaction.

Fourth, replay recorded envelopes. Compare the baseline and candidate under the same evidence. Keep deterministic and safety checks separate from semantic judgments, and label missing evidence as unknown.

Fifth, start a meaningful canary with explicit cohort selection, guarded writes, a warm rollback target, and pause windows long enough to observe delayed outcomes.

Sixth, promote in steps only when hard gates are green and soft signals are understood. At every step, keep the previous bundle available for immediate rollback.

Finally, graduate useful canary cases into the regression suite. The release system should learn from incidents, user feedback, and disagreement samples. A test suite that never changes is not a safety net; it is a museum.

## The rule I now use

A model upgrade is not safe because the benchmark improved. A prompt is not safe because the demo sounded better. A canary is not safe because only a small percentage of users saw it.

A release is safe enough to promote when the team can state what changed, which users and behaviors were tested, which external effects were impossible or guarded, which invariants were non-negotiable, what evidence supported the decision, and how to return to the last known-good bundle.

That discipline does not remove the uncertainty of AI systems. It puts the uncertainty in a controlled experiment instead of outsourcing it to the next customer who asks a difficult question.

## Related reading

For the regression layer behind this workflow, read [Do Not Ship a Tool-Calling AI Agent Without Evals](/blog/agent-evals-regression-suite). For the production contract around repeated write actions, see [Idempotent AI Actions: Making Tool Calls Safe to Retry](/blog/idempotent-ai-actions). For the telemetry boundary, continue with [AI Agent Observability: Trace Prompts, Tool Calls, Tokens, and Cost Without Turning Logs into a Data Leak](/blog/agent-observability-without-data-leaks). For model/provider behavior under failure, read [Multi-Model Failover Without Route Flapping](/blog/provider-rotation-multi-model-failover).

## References

[1]: https://developers.openai.com/api/docs/guides/evaluation-best-practices "OpenAI — Evaluation best practices"
[2]: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents "Anthropic — Demystifying evals for AI agents"
[3]: https://docs.aws.amazon.com/sagemaker/latest/dg/shadow-tests.html "AWS SageMaker AI — Shadow tests"
[4]: https://argo-rollouts.readthedocs.io/en/stable/features/canary/ "Argo Rollouts — Canary Deployment Strategy"
