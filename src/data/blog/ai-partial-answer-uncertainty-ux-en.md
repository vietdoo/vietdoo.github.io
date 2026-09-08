---
title: "When AI Gives a Partial Answer: Designing Failure UX for Uncertainty"
description: "A trustworthy AI product does not hide uncertainty behind a fluent paragraph. It makes missing evidence visible, chooses a safe recovery path, and helps people decide what to do next."
pubDate: 2026-04-19
category: "engineering"
image: "/blog/ai-partial-answer-uncertainty/hero.webp"
lang: "en"
translationKey: "ai-partial-answer-uncertainty-ux"
draft: false
---

![A hand-drawn evidence tray flows through a decision gate into an answer, clarification, or human handoff](/blog/ai-partial-answer-uncertainty/hero.webp)

I have watched an assistant produce a beautifully written answer that should never have been shown as complete.

The user asked for a summary of a policy change. The system found two relevant documents, failed to retrieve the appendix that contained the exception, and then wrote a confident paragraph anyway. Nothing in the prose revealed the missing piece. The answer was not completely fabricated, but it was more dangerous than an obvious failure because it looked finished.

That is the product problem behind uncertainty. A model can be useful while incomplete. It can have enough evidence for one part of a request, no evidence for another part, and conflicting evidence for a third. If the interface offers only two states—loading and done—it pressures the system to turn every ambiguous situation into a fluent final answer.

> **The thesis:** A partial answer is not merely a weaker completion. It is a first-class product state with its own evidence contract, language, recovery path, and evaluation criteria.

This article describes a practical failure UX for AI features. The goal is not to display a mysterious confidence score beside every sentence. The goal is to make the system’s boundary visible, preserve the user’s agency, and provide the shortest safe route to a better outcome.

## The fluent answer is not the whole state

Traditional software often has a crisp success condition. A database query returns rows or an error. A form is accepted or rejected. An upload completes or fails. Generative systems are different: they can return a plausible artifact even when the supporting context is thin, contradictory, or outside the model’s scope.

That changes what “done” means. The answer is not done merely because a token stream reached its stop condition. It is done when the system can explain, at the level required by the task, which parts are supported, which parts are uncertain, and what the user can do next.

The distinction matters because people adapt their behavior around AI messages. Research on selective prediction shows that a system’s decision to defer, and the way that decision is communicated, can change human performance. In an AAAI study, informing people that the AI had deferred—without simply exposing the model’s uncertain prediction—improved the performance of the human-AI team. The interface is therefore part of the reliability mechanism, not a decorative layer added after the model.

![Four evidence states move toward a final answer decision without pretending that every state is complete](/blog/ai-partial-answer-uncertainty/evidence-states.webp)

## Model evidence states, not one generic confidence number

A single probability is tempting because it is easy to render. It is also often too ambiguous for a product decision. “0.72 confidence” might mean that the classifier is calibrated on a known distribution, that a retrieval score crossed a threshold, or simply that a language model generated a high-probability continuation. Those are different facts.

A more useful first layer is a small set of evidence states. They describe what the system can responsibly say, rather than pretending to expose an exact internal probability.

| Evidence state | What the system knows | Safe user-facing behavior | Typical next action |
|---|---|---|---|
| **Supported** | The answer is grounded in relevant, sufficiently fresh evidence and no known contradiction is active. | Answer directly, show the supporting source or reasoning boundary, and keep the scope precise. | Continue or finish the task. |
| **Partial** | Some requested claims are supported, but one or more parts lack adequate evidence. | Separate supported claims from unknowns. Do not fill the gap with stylistic confidence. | Ask for the missing input or offer a bounded partial answer. |
| **Missing** | The system did not retrieve or receive evidence that can support the requested claim. | Say that the evidence is unavailable. Avoid a guess disguised as a summary. | Clarify the request, search another source, or hand off. |
| **Conflicting** | Two credible sources, observations, or policy versions disagree. | Surface the conflict and identify which decision is blocked. Do not silently choose one. | Resolve source priority, request a human decision, or use a dated policy. |

The state should be computed from task-specific signals: retrieval coverage, source freshness, contradiction checks, tool results, permission scope, and whether the requested action is reversible. It should not be inferred only from the model’s tone.

## Four responses are better than a forced completion

A reliable assistant needs more than an `answer()` branch. In practice, four responses cover most uncertainty cases.

**Answer with evidence** is appropriate when the system has enough support for the requested scope. The response should still make the boundary visible: “Based on the current policy version dated May 4…” is more useful than a timeless-sounding paragraph.

**Ask a clarifying question** is appropriate when the system could succeed if the user supplied one missing variable. The question should be narrow and explain why it matters. “Which country’s tax policy should I use?” is actionable. “Can you provide more details?” pushes the diagnostic burden back to the user.

**Offer a bounded partial answer** is appropriate when part of the request is useful and safe to answer now. It should explicitly partition supported and unresolved claims. The unresolved portion must not be hidden in a footnote after a long confident explanation.

**Defer to a human** is appropriate when the evidence is conflicting, the consequences are high, the user lacks authority to resolve the issue, or the next step requires judgment rather than retrieval. A handoff should carry context forward; “Please contact support” without the gathered evidence is not a recovery path.

This is a different framing from “the model is uncertain.” It asks: **What is the safest useful state available right now?**

## Make the answer contract explicit

The user interface can be simple, but the internal result should preserve enough structure for policy, analytics, and evaluation. A compact envelope might look like this:

```json
{
  "status": "partial",
  "scope": {
    "supported": ["policy_effective_date", "affected_plan"],
    "unresolved": ["regional_exception"]
  },
  "evidence": [
    {
      "sourceId": "policy-2026-05",
      "version": "17",
      "freshness": "current",
      "supports": ["policy_effective_date", "affected_plan"]
    }
  ],
  "nextAction": {
    "kind": "clarify",
    "question": "Which region should the exception check cover?"
  },
  "risk": "medium",
  "handoff": null
}
```

The envelope is not a request to expose internal JSON to every user. It is a contract between retrieval, policy, generation, interface, and measurement. The renderer may show a short explanation and one button while the system records the evidence boundary and the recovery decision.

A useful implementation rule is to separate **claim generation** from **response packaging**. First decide which claims are supported. Then decide whether the set is sufficient for the requested task. Only after that should the model write the prose. This prevents a fluent generator from erasing the distinction between “not retrieved” and “retrieved but contradicted.”

## Design the recovery path before the apology copy

Many AI products treat failure UX as a sentence: “I’m sorry, I couldn’t answer that.” The sentence may be polite, but it does not reduce uncertainty or help the user recover. A good failure state is a small workflow.

The recovery loop should answer four questions. What part did the system understand? What part is blocked? Why is it blocked in terms the user can act on? What is the next lowest-effort step that can change the state?

![A recovery loop turns a blocked answer into clarification, more evidence, a bounded response, or a human handoff](/blog/ai-partial-answer-uncertainty/recovery-loop.webp)

A practical sequence is:

1. **Name the boundary.** Say which claim or action cannot be supported, instead of declaring the entire conversation a failure.
2. **Preserve useful work.** Keep the supported answer, retrieved sources, draft, or extracted fields visible.
3. **Offer one or two next actions.** Ask a focused question, search an approved source, upload the missing document, or request review.
4. **Require verification after recovery.** New evidence changes the state; it should not silently append to a previously generated answer.

The recovery action should also respect authority. A user may be able to supply a missing date but not override two conflicting policy versions. A support agent may be allowed to decide which source governs, while a customer should only see the conflict and the handoff status.

## Do not confuse abstention with refusal

Abstention is a decision about evidence or capability: the system chooses not to make a claim because the conditions for a responsible claim are not met. Refusal is a policy decision: the system declines an otherwise understood request because it is disallowed or unsafe. The interface can use similar language, but the internal causes and recovery paths are different.

An abstention may be recoverable with a better query, a new document, a permission grant, or a human review. A refusal may require no further retrieval at all. If both are reduced to “I can’t help with that,” operators cannot measure the system’s real limitations and users cannot tell whether a different next step will work.

This distinction also improves evaluation. A system that abstains too often may be safe but unhelpful. A system that almost never abstains may look productive while silently converting missing evidence into invented certainty. The target is not maximum answer rate; it is appropriate completion under the product’s risk and evidence constraints.

## Evaluate the human-AI team, not just the model

A partial-answer design needs metrics that connect system state to user outcome. A dashboard that reports only answer acceptance or thumbs-up rate will reward confident completion even when the interface hides uncertainty.

| Metric | What it measures | Failure signal |
|---|---|---|
| **Supported-claim precision** | How often claims labelled supported are actually supported by the available evidence. | The system over-labels claims as safe. |
| **Appropriate abstention rate** | How often the system withholds a claim when evidence is insufficient or conflicting. | The system guesses through known gaps, or refuses routine work. |
| **Recovery completion** | Whether a user can resolve the blocked state through the offered next action. | The system asks vague questions or creates dead ends. |
| **False-confidence rate** | How often users treat a partial or conflicting answer as complete. | The visual hierarchy makes caveats invisible. |
| **Human-AI joint quality** | The quality of the final decision after people interact with the uncertainty state. | The message anchors people to a wrong prediction or causes needless distrust. |
| **Handoff completeness** | Whether a human receives the relevant request, evidence, conflict, and attempted steps. | The handoff restarts the investigation from zero. |

The AAAI evidence on selective prediction is a reminder that the message itself can change the joint outcome. Human testing should therefore compare not only model outputs but also alternative presentations: a raw confidence score, a categorical state, an explicit defer signal, and a bounded partial answer. The test should include people with different levels of domain expertise, because a phrase that helps an engineer may mislead a customer.

Human-AI interaction guidance recommends showing contextually relevant information and scoping services when the system is uncertain. In practical terms, this means showing the smallest piece of evidence needed to make the next decision—not dumping a trace, not hiding the boundary, and not forcing the user to interpret statistical jargon.

![A four-part evaluation board compares correctness, abstention, recovery usefulness, and human decision quality](/blog/ai-partial-answer-uncertainty/evaluation-matrix.webp)

## An implementation pattern for production systems

A simple architecture can keep the boundary explicit without turning every response into a research project.

First, retrieval or tools return evidence objects with source identity, version, timestamp, scope, and known conflicts. Second, a policy layer maps those objects to claim-level support. Third, a decision layer chooses `answer`, `clarify`, `partial`, or `handoff`. Fourth, a response writer packages the decision into language appropriate for the user and risk level. Finally, the interface renders the state and records whether the user recovered, abandoned, or escalated.

```ts
type AnswerState = "supported" | "partial" | "missing" | "conflicting";
type NextAction = "answer" | "clarify" | "retrieve" | "handoff";

type ClaimAssessment = {
  claim: string;
  state: AnswerState;
  sourceIds: string[];
  reason?: string;
};

function chooseNextAction(
  claims: ClaimAssessment[],
  risk: "low" | "medium" | "high",
): NextAction {
  if (claims.some((claim) => claim.state === "conflicting")) {
    return risk === "high" ? "handoff" : "clarify";
  }

  if (claims.every((claim) => claim.state === "supported")) {
    return "answer";
  }

  if (claims.some((claim) => claim.state === "missing")) {
    return "retrieve";
  }

  return "clarify";
}
```

The code is intentionally modest. The hard part is not the enum; it is deciding what evidence means for each product. A travel assistant may answer with a partial itinerary. A medical workflow may need a human handoff when one critical field is missing. A developer tool may provide a draft patch but require verification before applying it. The state machine must follow consequence, reversibility, and authority—not a universal confidence threshold.

Operationally, log the decision and the evidence references, not just the final prose. That allows teams to answer questions such as: Did the system know the evidence was missing? Did the interface show the user? Did the user have a workable recovery path? Did a later source update invalidate a previously supported answer?

## Failure patterns worth rejecting in review

The first anti-pattern is **the confidence badge as camouflage**. A small “72%” chip beside a large paragraph does not communicate uncertainty if the paragraph visually dominates and the number has no defined meaning.

The second is **the universal apology**. If every blocked state produces the same message, the product loses the distinction between missing evidence, policy refusal, permission failure, tool outage, and source conflict.

The third is **the hidden partial**. The response answers the easy half and quietly omits the difficult half. Users often interpret omission as “nothing important was missing.” The unresolved scope must be named.

The fourth is **the dead-end handoff**. Sending a user to a queue without the evidence, attempted steps, or reason for escalation shifts the cost of failure to a person. A handoff should be a transfer of state, not a reset.

The fifth is **the untested recovery path**. Teams test whether the model can answer, but not whether a user can provide the missing variable, correct a source conflict, or understand what the system needs. Recovery is a product capability and deserves regression cases.

## The uncomfortable but useful contract

A trustworthy AI assistant does not promise to complete every request. It promises to be legible when completion is not justified.

That promise has a technical shape: claim-level evidence, explicit states, bounded language, reversible next actions, authority-aware handoffs, and joint human-AI evaluation. It also has a design shape: a hierarchy that makes the boundary visible without making the interface feel broken.

The best partial answer is not the one with the most words. It is the one that gives the user the most useful supported work, tells them exactly what remains unresolved, and offers a next step that can genuinely change the result.

## References

[1] [Elizabeth Bondi et al., “Role of Human-AI Interaction in Selective Prediction,” AAAI-22](https://ojs.aaai.org/index.php/AAAI/article/view/20465/20224)

[2] [Saleema Amershi et al., “Guidelines for Human-AI Interaction,” ACM CHI 2019](https://dl.acm.org/doi/10.1145/3290605.3300233)

[3] [NIST, Artificial Intelligence Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)

[4] [Google PAIR, People + AI Guidebook](https://pair.withgoogle.com/guidebook/)

[5] [Microsoft HAX Toolkit](https://www.microsoft.com/en-us/haxtoolkit/)
