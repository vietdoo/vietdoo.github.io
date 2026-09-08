---
title: "Context Engineering for Long-Running AI Agents: What to Fetch, Compress, and Forget"
description: "A production blueprint for designing the context pipeline of long-running AI agents: retrieval, selection, compaction, tool-result clearing, durable memory, isolation, and measurable budgets."
pubDate: 2026-04-11
category: "engineering"
image: "/blog/context-engineering/hero.svg"
lang: "en"
translationKey: "context-engineering-long-running-ai-agents"
draft: false
---

![A context engineering pipeline connecting retrieval, compression, memory, and a bounded agent action](/blog/context-engineering/hero.svg)

A long-running agent rarely fails because the model cannot produce another sentence. It fails because the next inference call receives the wrong working set.

The request may be correct. The tools may be available. The retrieval system may return relevant documents. The model may even be capable enough to solve the task. Yet the agent still drifts because the context contains five stale tool dumps, two contradictory plans, a broad system instruction, a conversation from yesterday, and one critical fact buried near the end of the window.

That is not primarily a prompt-writing problem. It is a context engineering problem.

> **Thesis:** Treat context as a finite, policy-governed resource assembled by a pipeline. Decide what to fetch, when to fetch it, how to compress it, and what to forget before the model has to make its next decision.

Anthropic describes context engineering as the work of curating and maintaining the optimal set of tokens available during inference. Sourcegraph makes the same shift practical: once an agent has tools, retrieval and memory, the prompt is only one input to a larger pipeline that must manage information flow. The useful consequence is that we can design, test and operate context in the same way we design any other production subsystem.

## Context is more than a prompt

A prompt is a sentence or a group of instructions. Context is the complete state presented to the model on one inference call. It includes the system policy, user request, recent conversation, retrieved evidence, tool definitions, tool results, output schema, workflow state and selected long-term memory.

| Layer | What it contributes | Typical failure when unmanaged |
|---|---|---|
| Instructions | Rules, role, policy and boundaries | Conflicting instructions or a policy that is too large to notice |
| User intent | The outcome the person actually wants | Old intent remains active after the task changes |
| Retrieval | Evidence from documents, databases or APIs | Relevant-looking but low-trust or stale evidence |
| History | Decisions, corrections and unresolved questions | Conversation grows faster than signal |
| Tools | Available capabilities and their contracts | Tool definitions consume the budget before work begins |
| Memory | Durable facts, preferences and project state | Notes become a second ungoverned transcript |
| Output contract | The shape the next system can safely consume | Free-form prose crosses a typed boundary |

The distinction matters operationally. Prompt quality can be reviewed in a pull request. Context quality must be observed at runtime because it changes with the user, tenant, tool result, step, time and policy. A small change to retrieval ranking can alter the model's decision even when the system prompt has not changed.

This is also why a larger context window is not a complete solution. More room lets the system carry more information, but it does not tell the agent which information deserves attention. A full window can still be a low-signal window. In practice, the objective is not maximum token utilization; it is the smallest high-signal set that supports the next safe decision.

## The four questions every context pipeline should answer

A useful context pipeline can be explained with four questions.

**What do we fetch?** Fetching is a policy decision, not a reflex. The system should know whether the current step needs a customer record, a project constraint, an earlier decision, a tool result or no additional evidence at all. Fetching everything is often a way of avoiding the harder question.

**When do we fetch it?** Some facts belong in the initial context. Others should be retrieved just in time when the agent reaches a decision boundary. A payment policy may be needed before proposing a refund but not while the agent is classifying the user's message. Early retrieval increases cost and gives stale information more time to compete with the current task.

**How do we compress it?** Compression is not simply shortening text. It is preserving the facts, decisions, constraints and unresolved questions that affect future actions while removing repeated narration and re-fetchable payloads. A good summary is a loss contract: it explicitly states what the next step is allowed to assume.

**When do we throw it away?** Information should leave active context when it is stale, re-fetchable, superseded, outside the current scope, or no longer relevant to the next decision. Forgetting is not a defect when the system retains a durable reference and can fetch the evidence again under the right policy.

The four questions turn context from an accidental concatenation of strings into a designed resource flow.

## Start with a context contract

Before adding another memory store or retrieval call, define the contract for one model invocation. The contract should be inspectable in a trace and small enough for an engineer to reason about.

```ts
type ContextPacket = {
  runId: string;
  step: string;
  intent: string;
  authority: {
    tenantId: string;
    actorId: string;
    allowedActions: string[];
  };
  instructions: {
    policyVersion: string;
    systemRules: string[];
  };
  evidence: Array<{
    sourceId: string;
    kind: "retrieval" | "tool" | "memory";
    trust: "verified" | "user-provided" | "unverified";
    freshness: string;
    excerpt: string;
  }>;
  decisions: Array<{
    decision: string;
    rationale: string;
    status: "confirmed" | "open" | "superseded";
  }>;
  toolSurface: string[];
  outputSchema: string;
  budget: {
    inputTokens: number;
    toolCallsRemaining: number;
    timeMsRemaining: number;
  };
};
```

The exact type is not important. The boundaries are. The packet makes it possible to ask whether an output used verified evidence, whether the model saw an expired approval, whether the tool surface was broader than necessary and which part of the budget was consumed by history rather than useful facts.

A context contract also creates a clean relationship with an existing [agent handover architecture](/blog/agent-handover-architecture). A handover ledger preserves intent and decisions across sessions. A context packet is the smaller, step-specific projection of that state for one inference call. They are related, but they are not the same object.

## Retrieval: select for the next decision, not for completeness

Retrieval systems are usually rewarded for finding relevant material. Agents need a stricter property: the material must be relevant to the **next decision**, trustworthy enough for the action being considered, fresh enough for the domain and small enough to fit beside the rest of the packet.

![A retrieval funnel filters many available sources into a compact high-signal context packet](/blog/context-engineering/retrieval-selection.svg)

The common anti-pattern is the context dump. The agent receives the whole customer profile, every matching document, all previous tool results and a long list of tool definitions. It looks safe because no fact was omitted. It is unsafe because the model has to infer priority from volume, and the most important constraint may be visually indistinguishable from background noise.

A better retrieval layer returns evidence with provenance and a reason for inclusion. It should be possible to explain, “This record entered the packet because the current step is refund eligibility, it was updated two minutes ago, and the source is the billing system.” If that explanation is impossible, ranking is probably doing too much hidden work.

Useful selection signals include task relevance, source trust, freshness, tenant scope, authority scope, contradiction with confirmed facts and the cost of re-fetching later. Recency should not automatically beat authority. A user message may be recent but not sufficient to override a verified policy. A cached policy may be trustworthy but too old for a time-sensitive decision.

A retrieval result should also be bounded. Set a per-source and per-step budget rather than one global “retrieve top 20” rule. A classification step might need three short facts. A final action proposal may need the exact policy clause, the current record and one decision history entry. The right size follows the decision, not the database.

This is different from the chunking lessons in the [RAG production mentoring article](/blog/hanh-trinh-mentor-thuc-tap-sinh-ai). Chunking determines how a knowledge source can be retrieved. Context engineering decides whether that result should enter this particular model call, in what form, with which authority and for how long.

## Compression is a semantic operation

Long conversations and tool-heavy workflows eventually produce more material than the next call can use. Compression should therefore be a first-class operation, not an emergency string truncation.

Anthropic's production guidance describes compaction as a high-fidelity summary that carries architectural decisions, unresolved bugs and implementation details into a new context window. The important phrase is high-fidelity. A summary that sounds fluent but drops a constraint is not a successful compression; it is a data-loss event with good grammar.

A practical compaction record can preserve four groups of information:

| Preserve | Example |
|---|---|
| Confirmed facts | “The account is on the annual plan; refund window ends on 2026-04-18.” |
| Decisions and rationale | “Do not call the cancellation tool until the user confirms the prorated amount.” |
| Open loops | “Waiting for the invoice identifier; billing API returned two candidates.” |
| References | “Full API response stored as artifact `toolrun_1842`; re-fetch allowed after policy check.” |

Tool-result clearing is a lighter operation. If a large result can be fetched again and the active state already contains the decision derived from it, remove the raw payload from the window while retaining a reference and its freshness. The [Claude Cookbook] explains the distinction clearly: compaction compresses the whole window, clearing drops stale re-fetchable data, and memory moves durable information outside the active window.

![A long active context is compacted into a high-fidelity summary while durable notes remain outside the window](/blog/context-engineering/compaction-memory.svg)

Never make “keep the last N messages” the only compaction policy. The last message may be a verbose tool dump, while an earlier message contains the user's authority or a safety constraint. Compaction should be evaluated against a loss checklist: did it retain the current objective, actor and tenant, confirmed facts, pending approvals, constraints, tool outcomes, unresolved questions and the references needed to recover evidence?

A model-generated summary still needs validation. Treat it as an untrusted transformation until a deterministic checker confirms that required fields exist, references resolve and prohibited claims were not introduced. If the summary cannot satisfy the contract, keep the previous checkpoint and ask for a narrower compaction pass.

## Memory is not a second transcript

Persistent memory is useful when an agent must continue across sessions, but “save everything” turns memory into another noisy context window. Durable memory should have a purpose, an owner, a scope and an invalidation rule.

A practical memory model separates at least three kinds of notes. **Project state** describes what the agent is currently trying to finish. **Stable facts** describe information expected to survive a session, such as a repository convention or a confirmed user preference. **Working hypotheses** capture a belief that may be useful but must not be treated as verified truth.

Each note should carry provenance, timestamp, scope, confidence and a replacement key. When a new fact contradicts an old note, the system should supersede the old note instead of silently appending a second truth. When a tenant, project or user changes, scope filtering must happen before retrieval—not after the note has entered the model context.

Structured note-taking can be simple. A `NOTES.md` file, a small database table or an object store can work if the write path is governed. The hard part is deciding what deserves persistence. Good write candidates include a confirmed decision, a durable constraint, a reference to an artifact and a next step that would otherwise be lost during reset. Bad candidates include raw tool output, speculative model prose and duplicate summaries.

This connects to durable execution, but the boundary is worth keeping explicit. Durable execution stores workflow state and evidence so a run can recover after a crash. Memory stores selected knowledge for future context assembly. If the same record is used for both without a type or retention policy, recovery state can leak into future user conversations and stale preference can be mistaken for current workflow truth.

## Context isolation: let specialists explore without polluting the lead

Some tasks require deep exploration: reading a repository, comparing many documents, testing several hypotheses or inspecting a large trace. Sending every intermediate observation back to one lead agent wastes tokens and makes the lead less decisive.

![A lead agent coordinates isolated specialist contexts and receives compact summary cards](/blog/context-engineering/subagent-isolation.svg)

Sub-agent architectures solve this by giving specialist workers clean context windows. The researcher can inspect dozens of sources, the implementer can work with code and tests, and the verifier can challenge assumptions. The lead agent receives a bounded result rather than the entire exploration history. Anthropic describes this pattern as a way to keep detailed search context isolated while the lead focuses on synthesis.

Isolation does not mean unlimited parallelism. Each specialist needs a role, an input contract, a tool allow-list, a maximum exploration budget and an output schema. The summary should include conclusions, evidence references, uncertainty, failed approaches and recommended next action. A specialist that returns only “done” has saved tokens but destroyed observability.

Do not use sub-agents to avoid designing the main context contract. They should reduce working-set size, not create an untraceable swarm. The lead still owns authority, policy and the final action boundary. Specialist summaries are evidence, not permission.

## Measure the context, not only the answer

The quality of a context pipeline cannot be inferred from one successful response. A model may answer correctly by luck, or produce a polished answer while using an unsafe or stale fact. The existing [agent evals article](/blog/agent-evals-regression-suite) covers behavioral regression. Context engineering adds measurements about the information that made the behavior possible.

| Metric | What it tells you |
|---|---|
| Input tokens by layer | Whether history, tools or retrieval consume the budget |
| Retained-signal ratio | How much active context survives selection or compaction as actionable state |
| Re-fetch rate | Whether the system discarded information too aggressively |
| Stale-evidence rate | Whether expired notes or tool results enter decisions |
| Contradiction rate | Whether the packet contains unresolved conflicting claims |
| Context-to-action latency | Whether building context dominates the run |
| Summary contract failures | Whether compaction loses required fields |
| Decision success by packet version | Whether a retrieval or compaction change improves behavior |

Connect these metrics to the [AI agent SLO scorecard](/blog/ai-agent-slo-success-latency-cost-safety). Context size affects latency and cost, but safety and success need their own slices. A smaller packet is not automatically better if it increases refusal errors, repeated retrieval or unsafe assumptions.

Trace the **shape** of the packet, not necessarily every sensitive payload. Record source identifiers, versions, token counts, selection reasons, policy decisions, hashes and redaction outcomes. The [agent observability guidance](/blog/agent-observability-without-data-leaks) is relevant here: a useful trace should explain why a decision was possible without becoming a second data lake.

## Failure modes worth designing against

| Failure mode | What it looks like | Better design |
|---|---|---|
| Kitchen-sink retrieval | Every matching document enters the window | Rank by next decision, trust, freshness and scope |
| Silent truncation | The last part of history disappears without a record | Compact against a required-field contract |
| Summary hallucination | Compression invents a decision or drops a constraint | Validate fields and preserve evidence references |
| Memory pollution | Speculation returns as if it were a stable fact | Type notes, add provenance and support supersession |
| Tool-definition overload | The model sees capabilities it cannot safely use | Expose the smallest tool surface for the step |
| Context leakage | One tenant's notes appear in another tenant's packet | Filter scope before retrieval and log the decision |
| Premature forgetting | A discarded result must be fetched repeatedly | Keep a durable reference and measure re-fetch rate |
| Unbounded sub-agent output | Specialist exploration returns as raw transcript | Require a summary schema and an evidence ledger |

These are not purely model failures. They are boundary failures. The model can only choose from the information and authority the system presents. That is why context engineering belongs with platform and application architecture rather than in a prompt-only folder.

## A pragmatic rollout plan

Start with one long-running workflow that already has visible pain: a coding agent that touches many files, a support agent that waits for customer information or a research agent that uses several tools. Do not attempt to redesign every prompt first.

In the first iteration, log the packet shape with payload redaction. Count tokens by layer, identify the largest recurring tool results and mark which facts were actually used in the final decision. This gives the team a baseline without changing behavior.

Next, introduce a context contract and a per-step budget. Add selection reasons to retrieval results and references to tool artifacts. Then add one controlled compaction trigger, preferably before the hard context limit, and test it against traces containing corrections, approvals, contradictions and failed tool calls.

After that, add structured memory only for facts that must cross a session boundary. Add supersession and scope checks before adding more recall. Finally, isolate one expensive exploration step behind a specialist summary contract and compare the lead agent's context size, latency, cost and decision quality.

The rollout should end with adversarial cases: stale policy, contradictory user messages, duplicate tool results, an expired approval, a tenant mismatch, a malformed summary and a recovery where the agent must re-fetch evidence. These cases belong in the same repository and CI pipeline as the agent's other regression tests.

## Closing thought

Long-running agents do not need to remember everything. They need to remember the right things at the right boundary, prove where those things came from and let go of what no longer supports the next safe decision.

Context engineering is the discipline that makes that possible. It turns retrieval into selection, summarization into a loss contract, memory into governed state and sub-agents into isolated working sets. The result is not a smarter prompt. It is a system that gives a capable model a better chance to stay coherent when the task becomes long, tool-heavy and real.

## References

[1]: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents "Anthropic — Effective context engineering for AI agents"
[2]: https://sourcegraph.com/blog/context-engineering "Sourcegraph — Context Engineering: A Practical Guide for AI Agents"
[3]: https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools "Claude Cookbook — Context engineering: memory, compaction, and tool clearing"
