---
title: "When Agents Disagree: Arbitration Protocols for Conflicting AI Decisions"
description: "A production playbook for resolving conflicting AI decisions with evidence normalization, calibrated confidence, abstention, escalation, and auditable arbitration."
pubDate: 2026-03-19
category: "engineering"
lang: "en"
translationKey: "when-agents-disagree-arbitration-protocols"
draft: false
image: "/blog/agent-arbitration/hero.webp"
---

The first version of a multi-agent system often looks deceptively simple. One agent retrieves evidence. Another evaluates risk. A third proposes an action. A final model reads the outputs and picks the answer that sounds most convincing.

That design works until the agents disagree.

A fraud detector says a payment is suspicious. A customer-context agent says the purchase is consistent with the user’s history. A policy agent says the evidence is incomplete. The final judge receives three plausible explanations, three confidence scores that were never calibrated against one another, and a deadline that makes “ask a human” feel like a failure.

The dangerous response is to make the system vote harder. Majority voting can hide correlated mistakes, reward verbosity, and turn an unresolved conflict into a false sense of certainty. A production system needs something more deliberate: an **arbitration protocol** that defines how disagreement is detected, how evidence is compared, when a decision may be committed, and when the system must abstain or escalate.

![A production AI system routes conflicting specialist decisions through evidence normalization, arbitration, abstention, and human escalation](/blog/agent-arbitration/hero.webp)

> **The thesis:** Arbitration is not the last model call in a multi-agent workflow. It is a policy-bound decision stage with explicit inputs, protected state, calibrated confidence, and a safe outcome when consensus is not justified.

This article is a practical design guide for systems in which several AI components can recommend different outcomes: claims review, support triage, security operations, document classification, code review, procurement approval, and agentic workflows that can change external state.

## Disagreement is a signal, not a bug to hide

A disagreement tells you that the system has encountered uncertainty, competing evidence, different task assumptions, or a boundary between policy and prediction. It does not tell you which agent is correct. It also does not imply that the most confident agent deserves to win.

Before choosing an arbitration method, classify the disagreement. Different conflicts need different remedies.

| Conflict type | What is actually different? | Safe first response |
|---|---|---|
| Evidence conflict | Agents cite incompatible facts or sources. | Normalize evidence, check freshness, and test source authority. |
| Scope conflict | Agents answered different interpretations of the task. | Reconstruct the intent and align the decision contract. |
| Policy conflict | A recommendation is technically plausible but violates a rule. | Let the policy gate override predictive preference. |
| Temporal conflict | Agents used data from different points in time. | Compare timestamps and establish a data cutoff. |
| Granularity conflict | One agent recommends a broad action while another recommends a narrow one. | Decompose the action and arbitrate at the smallest safe unit. |
| Confidence conflict | Agents agree on outcome but disagree about certainty. | Calibrate confidence and inspect the disagreement distribution. |
| Correlated error | Agents appear to agree because they share the same blind spot. | Diversify evidence or add an independent verification path. |

![A hand-drawn conflict matrix compares evidence conflict, scope conflict, policy boundaries, and correlated agreement](/blog/agent-arbitration/conflict-matrix.webp)

The distinction matters because arbitration cannot repair an input contract that was never shared. If one agent interprets “approve the request” as “approve the document” and another interprets it as “approve the payment,” a weighted average of their scores is meaningless.

## Start with a decision contract

A decision contract describes what every participant is being asked to decide. It should be small enough to validate and precise enough to prevent silent scope drift.

```text
DecisionContract {
  decision_id: string
  subject_ref: string
  decision_type: string
  allowed_outcomes: [string]
  evidence_cutoff: timestamp
  required_evidence: [EvidenceRequirement]
  hard_constraints: [PolicyRule]
  reversibility: reversible | partially_reversible | irreversible
  risk_class: low | medium | high | critical
  deadline: timestamp
}
```

The contract belongs to the application, not to any individual model. The model can propose an outcome and explain its reasoning, but the application owns the allowed outcomes, policy constraints, evidence cutoff, and action permissions.

A useful contract also separates prediction from authorization. An agent may predict that a refund is likely valid. That does not authorize the refund. A policy gate can require a particular evidence field, a human approval, or a lower monetary threshold before the recommendation becomes an executable action.

This separation is especially important when the final arbiter is another language model. The arbiter should not be allowed to invent a new outcome because all supplied options look unsatisfactory. It should be able to return `abstain`, `needs_more_evidence`, or `escalate` as first-class outcomes.

## Normalize the evidence before comparing agents

Most multi-agent systems compare text when they should compare claims. A long explanation can sound stronger than a short one even when both rely on the same weak source. Arbitration becomes more reliable when every agent returns a structured decision packet.

```text
DecisionPacket {
  agent_id: string
  agent_version: string
  outcome: string
  confidence: number
  confidence_basis: calibrated | heuristic | unknown
  claims: [Claim]
  supporting_evidence: [EvidenceRef]
  missing_evidence: [EvidenceRequirement]
  policy_flags: [PolicyFlag]
  expires_at: timestamp
  dissent: [string]
}

Claim {
  claim_id: string
  statement: string
  polarity: supports | contradicts | unresolved
  evidence_refs: [EvidenceRef]
  confidence: number
}
```

![An evidence ladder separates unsupported claims from fresh, independent, policy-compliant support](/blog/agent-arbitration/evidence-ladder.webp)

The packet gives the arbiter something more useful than “Agent B thinks yes.” It can ask which claims are shared, which claims are contradictory, which evidence is authoritative, and whether the conflict is material to the decision.

A claim should point to an evidence reference rather than copying an entire document into the arbitration prompt. The reference can include a document identifier, source type, timestamp, extraction span, and access policy. This makes the decision auditable without turning the arbitration record into a second uncontrolled data lake.

The evidence layer should also preserve provenance. Two agents quoting the same stale article are not independent votes. Two agents using different retrieval paths that converge on the same current record provide stronger support, although they are still not proof of correctness.

## Confidence is not a universal currency

A confidence value of `0.92` from a classifier and a confidence value of `0.92` from a generative judge do not automatically mean the same thing. Confidence can be a raw model score, a self-reported feeling, a calibrated probability, or a heuristic assembled from tool results.

Treat the basis as part of the value.

| Confidence basis | Meaning | Can it be compared directly? |
|---|---|---:|
| Calibrated probability | Historical probability of correctness under a defined population and threshold. | Sometimes, if the population and task match. |
| Validation score | A model-specific score correlated with correctness on a benchmark. | Only after mapping and monitoring drift. |
| Self-reported confidence | The model’s language about how certain it feels. | No. Use as a weak feature at most. |
| Evidence coverage | Fraction of required claims with accepted support. | It is a separate dimension, not confidence by itself. |
| Heuristic | A rule such as “two tools succeeded.” | Useful for policy, not a probability. |

The ICLR paper *Trust or Escalate* presents selective evaluation as a way to estimate judge confidence and decide when to trust a judgment or escalate it. It also describes cascaded selective evaluation, where cheaper judges handle suitable cases and stronger judges or humans handle uncertain cases.

That idea translates well to production arbitration. Do not ask the most expensive judge to arbitrate every case. First determine whether the case is eligible for a low-cost decision, then use stronger evaluation only when the risk or uncertainty requires it.

A practical arbitration score can combine several signals without pretending they are all probabilities:

```text
arbitration_score =
    outcome_support
  + evidence_quality
  + evidence_independence
  + calibrated_confidence
  - unresolved_conflict
  - policy_risk
  - stale_data_penalty
```

The formula is a policy aid, not a scientific truth. Each component should be measured against historical outcomes and reviewed when the workload changes. If the team cannot explain how a component relates to correctness, it should not silently control an irreversible action.

## Do not let majority voting erase correlated errors

A three-agent panel can be less trustworthy than one carefully designed verification path. If every agent receives the same retrieved passage, shares the same system prompt, and uses the same model family, their agreement may reflect common input rather than independent confirmation.

Before counting votes, measure independence.

| Independence question | Why it matters |
|---|---|
| Did the agents retrieve from different sources or only different chunks of one source? | Shared retrieval errors can produce unanimous false agreement. |
| Did they use different task formulations? | Identical prompts can reproduce the same blind spot. |
| Did they inspect different modalities or fields? | A text-only panel may miss a visual or structured-data contradiction. |
| Did they run at different times? | Freshness differences can reveal a state transition rather than disagreement. |
| Are their failures historically correlated? | Voting weights should account for observed dependence. |

A useful rule is **independent evidence before additional opinions**. When two agents disagree, calling five more agents that read the same context may create noise. A targeted lookup, schema validation, deterministic calculation, or human confirmation may reduce uncertainty more effectively.

## The arbitration cascade

A reliable arbitration path usually has several levels. Each level should be cheaper and faster than the next, but no level should bypass a hard policy constraint.

![A layered arbitration cascade moves from deterministic checks to evidence review, stronger judging, and human escalation](/blog/agent-arbitration/escalation-cascade.webp)

### Level 0: deterministic checks

First run checks that do not require a language model. Validate required fields, schema compatibility, timestamps, identity scope, duplicate records, policy deny lists, and arithmetic. A deterministic failure should not be “outvoted” by a persuasive explanation.

### Level 1: evidence alignment

Next compare claims and evidence references. If the disagreement is caused by a missing field or a stale record, retrieve the specific evidence needed to resolve it. The system should prefer a targeted information request to a broad debate.

### Level 2: calibrated judge

If the conflict remains, use a judge that receives the decision contract, normalized packets, evidence references, and an explicit set of allowed outcomes. The judge should produce a structured result with a reason code, not only a paragraph.

```text
ArbitrationResult {
  outcome: allowed_outcome | abstain | needs_more_evidence | escalate
  confidence: number
  reason_code: evidence_conflict | scope_conflict | policy_conflict |
                stale_state | insufficient_independence | unresolved
  winning_claims: [claim_id]
  rejected_claims: [claim_id]
  next_action: string
  expires_at: timestamp
}
```

### Level 3: stronger judge or adversarial review

A stronger model can review the case when the expected value of improved confidence exceeds its cost and latency. Give it the disagreement explicitly. Do not hide the dissenting packet because the judge may need it to detect a false consensus.

An adversarial reviewer can be useful here, but it must have a bounded role. Ask it to find a counterexample, missing evidence, or policy violation. Do not treat a generated objection as proof that the original decision is wrong.

### Level 4: human escalation

Escalate when the decision is high-risk, irreversible, materially ambiguous, or outside the calibrated operating region. The escalation package should be concise: the decision contract, competing outcomes, evidence differences, policy flags, confidence basis, and the exact question the human must answer.

A human queue that receives an unstructured transcript is not an arbitration protocol. It is a transfer of confusion.

## Abstention is a valid outcome

The TACL survey *Know Your Limits* frames abstention as a way for language models to refuse an answer in order to reduce hallucination and improve safety. It organizes abstention research around the query, the model, and human values, while emphasizing that methods and evaluation depend on context.

In an agent system, abstention should not be a vague “I am not sure.” It should be a typed state with a reason and a next step.

| Abstention state | Meaning | Product behavior |
|---|---|---|
| `needs_more_evidence` | The decision could be resolved with a specific missing fact. | Retrieve or ask for that fact. |
| `insufficient_independence` | The panel agrees, but the evidence is too correlated to trust the consensus. | Run an independent check or escalate. |
| `outside_calibration` | The case is unlike the data used to calibrate the judge. | Use a stronger evaluator or human review. |
| `policy_boundary` | The recommendation crosses a protected rule. | Block the action and route to policy owner. |
| `irreversible_ambiguity` | The outcome cannot be safely undone and the evidence is unresolved. | Require explicit human confirmation. |

The goal is not to maximize the number of automatic decisions. The goal is to maximize safe coverage: the share of eligible cases that can be decided within an accepted error and risk budget.

## Separate arbitration from execution

An arbitration result should not directly call a side-effecting tool. It should create a decision record that a policy gate and an execution layer can consume.

```text
agent proposals
      |
      v
normalized decision packets
      |
      v
arbitration result
      |
      +--> abstain / escalate ------------------> human queue
      |
      v
policy gate + authorization check
      |
      +--> blocked ------------------------------ audit record
      |
      v
execution intent
      |
      v
idempotent action boundary
```

This boundary complements the design in [Idempotent AI Actions](/blog/idempotent-ai-actions). Arbitration decides whether an action is justified. Idempotency makes the eventual tool call safe to retry. They solve different failure modes and should not be collapsed into one “agent reliability” step.

The decision record should include the arbitration policy version, input packet hashes, evidence references, judge version, confidence basis, reason code, and expiry. If the case is reopened, the system should know whether it is replaying the same decision or creating a new one under a changed state.

## Design for state changes during arbitration

A conflict can be resolved correctly and still become stale before execution. Inventory can change, a user can revoke consent, a policy can be updated, or a downstream record can be modified while the human queue is processing the case.

Attach an expiry and a revalidation rule to every decision.

```text
if now > decision.expires_at:
    re-evaluate

if state_version != decision.state_version:
    revalidate_required_evidence

if policy_version != decision.policy_version:
    policy_gate_again
```

The longer the arbitration delay, the more important this becomes. A low-risk classification can tolerate a wider window. A payment, access grant, deletion, or safety action may require re-checking immediately before execution.

## Measure the protocol, not just the final answer

A single accuracy number hides the behavior that matters operationally. Track the arbitration process as a set of measurable outcomes.

| Metric | Question it answers |
|---|---|
| Conflict rate | How often do agents disagree on the same contract? |
| Material conflict rate | How often does disagreement change the permitted action? |
| Automatic decision coverage | What share of eligible cases is decided without escalation? |
| Escalation precision | How often does escalation reveal meaningful uncertainty or risk? |
| Abstention correctness | When the system abstains, was abstention justified? |
| Consensus error rate | How often are agreeing agents jointly wrong? |
| Evidence resolution rate | How often does targeted evidence resolve conflict? |
| Time to decision | How long does each arbitration level add? |
| Cost per resolved conflict | What does the cascade cost, including human review? |
| Policy violation escape rate | How often does a blocked condition reach execution? |

Review these metrics by tenant, workflow, risk class, model version, and evidence source. Aggregate performance can conceal a dangerous subpopulation. A judge that is reliable on support summaries may be unsuitable for access-control decisions.

## A rollout plan that does not begin with autonomy

Start with shadow arbitration. Let multiple agents produce packets, run the arbitration protocol, and record what it would have decided without changing production state. Have reviewers label the contract, evidence quality, final outcome, and whether escalation was appropriate.

Next, enable low-risk automatic outcomes with a narrow calibration region. Preserve every abstention and escalation reason. Do not reward the system for reducing escalation until you know whether escalations are useful or merely inconvenient.

Then add targeted evidence retrieval and deterministic checks. These often resolve conflicts more cheaply than another model call. Only after the lower levels are stable should the team introduce a stronger judge or adversarial review.

For high-risk actions, keep a human gate even when the judge is accurate. The gate can become lighter over time, but it should not disappear because the system has produced a convincing average score.

## Rules to carry into production

A multi-agent system does not become reliable when every agent agrees. It becomes reliable when the system can explain why agreement is sufficient, detect when agreement is correlated, and stop when the evidence does not justify action.

The model proposes. The contract defines the question. Evidence normalization makes proposals comparable. Calibration turns confidence into an operational signal. Arbitration chooses among allowed outcomes. Abstention protects the boundary of knowledge. Policy and authorization decide whether a recommendation may become an action. Execution remains a separate, idempotent boundary.

That is the difference between a panel of agents and a decision system that can be trusted when its agents disagree.

## Read next in the production AI series

For safe side effects after an arbitration decision, read [Idempotent AI Actions: Making Tool Calls Safe to Retry](/blog/idempotent-ai-actions). For measuring task-level quality and safety, continue with [Designing SLOs for AI Agents](/blog/ai-agent-slo-success-latency-cost-safety). For traceable explanations of what an agent decided and why, see [Decision Traces for AI Agents](/blog/decision-traces-ai-agent-event-sourcing).

## References

[1]: https://proceedings.iclr.cc/paper_files/paper/2025/hash/08dabd5345b37fffcbe335bd578b15a0-Abstract-Conference.html "Trust or Escalate: LLM Judges with Provable Guarantees for Human Agreement — ICLR 2025"
[2]: https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00754/131566/Know-Your-Limits-A-Survey-of-Abstention-in-Large "Know Your Limits: A Survey of Abstention in Large Language Models — TACL 2025"
