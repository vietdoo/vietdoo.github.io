---
title: "Synthetic Users for AI Agents: Scenario Generation Without Evaluation Leakage"
description: "Synthetic users can scale end-to-end agent testing, but a simulator trained on the answer key can make an evaluation look better than it is. This production playbook covers grounded behavior, scenario factories, held-out partitions, leakage controls, fidelity checks, and continuous evaluation."
pubDate: 2026-06-19
category: "engineering"
image: "/blog/synthetic-users-ai-agents/hero.webp"
lang: "en"
translationKey: "synthetic-users-ai-agents"
draft: false
---

![A synthetic user scenario factory creates varied agent tasks while keeping a locked evaluation set behind a boundary](/blog/synthetic-users-ai-agents/hero.webp)

I once watched an agent pass an evaluation suite so convincingly that the team almost promoted a new model the same afternoon. The dashboard was green. The user simulator sounded patient, the tool calls were valid, and the final answers matched the reference outputs.

Then someone changed one sentence in the user prompt.

The simulator stopped asking the follow-up question that the benchmark expected. It accepted an obviously wrong date, never challenged a contradictory policy, and completed the task in fewer turns than a real customer would need. The agent had not become safer. We had accidentally trained the test to be cooperative.

That failure is easy to misdiagnose as a model problem. In reality, it happened at the boundary between **scenario generation** and **evaluation validity**. A synthetic user is not automatically a realistic user, and a large pile of generated prompts is not automatically a difficult benchmark.

> **The thesis:** Use synthetic users to expand the space of agent interactions, not to manufacture evidence that the agent is good. The generator, the simulator, the evaluator, and the locked test set must have different responsibilities—and the final evaluation must remain unknown to the systems being optimized against it.

This article is a production playbook for teams testing tool-using and multi-agent systems. It focuses on end-to-end scenarios: a user has an objective, incomplete information, preferences, constraints, and sometimes a reason to change their mind. The agent must retrieve context, decide whether to ask, call tools, respect policy, recover from failures, and produce an outcome that can be checked.

## A synthetic user is a test instrument, not a fake customer

The phrase “synthetic user” hides several different jobs. A persona used to brainstorm product copy is not the same thing as a simulator that drives an agent through a booking workflow. A generated test case with a reference answer is not the same thing as a multi-turn actor that decides whether the agent has earned enough trust to continue.

Keeping those jobs separate is the first anti-leakage control.

| Artifact | Primary job | What it should know | What it must not know |
|---|---|---|---|
| **Scenario generator** | Create diverse task instances and hidden conditions. | Domain schema, variation rules, safety constraints. | The final model score or the private answer key for locked tests. |
| **User simulator** | Act as a user across multiple turns. | The user goal, available facts, preferences, and behavioral policy. | The evaluator’s exact rubric or the agent’s expected tool trace. |
| **Agent under test** | Solve the task with tools and policies. | The runtime context that a real deployment would expose. | Hidden goals, expected answer, or evaluator annotations. |
| **Evaluator** | Judge observable behavior against invariants. | Ground truth, policy rules, and scoring rubric. | Private reasoning that is not reproducible from the trace. |
| **Human reviewer** | Calibrate the automated judgment and investigate ambiguity. | Sampled traces and the rubric. | A presumption that a high aggregate score means the system is safe. |

This separation matters because a simulator can be fluent while still being a bad test instrument. It may always comply, reveal its hidden goal too early, use the same wording in every run, or stop after the first plausible answer. Those behaviors make the benchmark easy to optimize and poor at predicting deployment performance.

OpenAI’s evaluation guidance recommends task-specific evaluations that reflect real-world distributions, continuous evaluation, automation where possible, and calibration against human feedback.[1] That advice has a direct implication for synthetic users: the generator should model the distribution of situations, not merely produce grammatical prompts.

## Why scenario generation is attractive—and dangerous

Real conversations are expensive to collect, difficult to label, and often contain personal or confidential information. Production traces may also be too sparse in the exact corner cases that matter: a user who changes the destination after approval, a customer who supplies two conflicting identifiers, or a manager who asks the agent to disclose information to the wrong audience.

Synthetic generation can create these combinations quickly. It can vary the account state, time, policy version, tool availability, user frustration, and hidden objective while keeping the underlying task invariant. It can also produce negative cases that would be unethical or impractical to stage with real customers.

The danger is that generation systems tend to optimize for what they can easily describe. They produce polite, explicit, single-intent users with clean data and obvious success conditions. The resulting benchmark measures whether an agent can satisfy a cooperative narrator, not whether it can handle a real interaction.

The Korea and Singapore AI Safety Institutes reported a related lesson in their joint testing. Earlier benchmarks used overtly synthetic data and local websites, which encouraged agents to behave as if the task was artificial. Their later methodology increased realism through mirrored MCP servers, realistic test data, multi-turn interaction, and interconnected applications.[2]

Synthetic users therefore need two kinds of realism:

1. **World realism:** the task state, data, policies, tools, and consequences resemble the deployment environment.
2. **Behavioral realism:** the user’s turns, uncertainty, corrections, impatience, and willingness to continue resemble plausible human behavior.

Neither kind requires copying a real person. It requires defining what can vary, what must remain invariant, and how the scenario exposes only the information a real user would have at that point.

## Start with a scenario contract

Do not begin with “generate 10,000 user prompts.” Begin with a scenario contract that can be validated before an LLM writes any prose.

```ts
type ScenarioContract = {
  scenarioId: string;
  domain: "support" | "commerce" | "hr" | "finance" | "healthcare";
  userGoal: string;
  hiddenConstraints: string[];
  availableFacts: Record<string, unknown>;
  forbiddenFacts: string[];
  policyVersion: string;
  allowedTools: string[];
  expectedInvariants: string[];
  riskTags: string[];
  difficulty: "routine" | "ambiguous" | "adversarial";
  provenance: {
    generatorVersion: string;
    templateVersion: string;
    sourceFamily: string;
  };
};
```

The contract is the stable object. The natural-language conversation is one rendering of that object. This distinction lets the team test many phrasings without changing the underlying ground truth, and lets an evaluator check whether a scenario is internally coherent before it reaches the agent.

A useful contract records both visible and hidden state. Suppose the user asks an HR assistant to schedule an interview. The visible state may contain the candidate’s name and two available time windows. The hidden constraint may be that the user cannot share the candidate’s medical information with an external interviewer. The task is not complete merely because a calendar event is created. The agent must preserve the policy boundary while acting.

The contract should also name the **negative space**: facts the user does not know, facts the agent must not reveal, tools that are unavailable, and actions that require clarification. Without this negative space, a generator will fill every gap with convenient context and quietly remove the uncertainty the agent is supposed to handle.

## Build a scenario factory, not a prompt spinner

A scenario factory has controlled dimensions. Each dimension describes a meaningful change in the world or the interaction, not a cosmetic rewrite.

| Dimension | Example values | Invariant to preserve |
|---|---|---|
| User objective | Refund, exchange, explain, cancel, escalate | The business outcome that defines success. |
| Information state | Complete, partial, contradictory, stale | The agent must not invent missing facts. |
| Emotional state | Neutral, rushed, frustrated, skeptical | The user’s tone can change; policy requirements cannot. |
| Conversation behavior | Cooperative, corrects details, asks why, changes mind | The hidden goal remains traceable across turns. |
| Environment | Tool healthy, slow, unavailable, partially authorized | Failure handling must be observable. |
| Policy context | Standard, stricter tenant, version transition | The applicable policy is explicit and versioned. |
| Risk | Low, financial, privacy, irreversible action | Approval and escalation rules are testable. |
| Language surface | Short, verbose, indirect, typo-heavy | Semantic intent stays within the same contract. |

The factory should sample combinations deliberately. Pure random sampling usually overproduces the center of the distribution and underproduces the dangerous intersections. Pairwise coverage is a reasonable starting point; risk-weighted coverage is better when some combinations have a much larger blast radius.

For example, “frustrated user” alone is not a valuable scenario dimension. “Frustrated user + ambiguous identity + tool timeout + request to send a document externally” is a meaningful compound case because it tests whether the agent trades safety for speed under pressure.

Generate the structured state first, then render the initial user turn. If the LLM writes the state and the conversation in one pass, it will often repair contradictions by inventing facts. A deterministic validator should reject a scenario whose user goal, available facts, policy, and expected invariants do not agree.

![A scenario factory separates stable task invariants from controlled user, world, policy, and tool variations](/blog/synthetic-users-ai-agents/scenario-factory.webp)

## Ground the user simulator in behavior without copying the test

A user simulator needs a behavioral policy, but a long persona paragraph is not a behavioral policy. “You are an impatient customer who hates bureaucracy” is too vague to be reproducible and too easy to overinterpret. It can produce theatrical anger in one model and endless compliance in another.

A better simulator receives a small state machine:

```ts
type UserState = {
  goal: string;
  knownFacts: Record<string, unknown>;
  withheldFacts: string[];
  trust: number;
  patience: number;
  turn: number;
  correctionBudget: number;
  exitConditions: string[];
};

type UserPolicy = {
  answerWhenAsked: string[];
  refuseWhenAsked: string[];
  revealOnlyAfter: string[];
  correctionTriggers: string[];
  escalationTriggers: string[];
  terminationRules: string[];
};
```

The simulator should decide whether to answer, clarify, correct, object, or exit based on the state and the agent’s last observable action. It should not be told “make the agent fail.” That instruction produces adversarial theater rather than realistic pressure. It should instead follow a goal and a set of rules that naturally make some agent behaviors succeed and others fail.

Recent work on grounded user simulation makes the same distinction. RealUserSim reports that unconstrained LLM simulators can be poor proxies for human behavior, while hand-crafted directives can cause “directive amplification,” where the simulator exaggerates its instructions into unnatural behavior. The paper grounds simulation in observed human–LLM conversations and evaluates fidelity separately from agent task success.[3]

The practical lesson is not to scrape conversations and paste them into a prompt. It is to extract reusable behavioral patterns—how users correct a misunderstanding, when they add context, how they react to friction—and keep those patterns separate from the private goals and answer keys of the benchmark.

A simulator should be scored on at least two axes:

| Axis | Question | Example signal |
|---|---|---|
| **Task pressure** | Does the user create the information and decision pressure the scenario requires? | The user withholds the second identifier until the agent explains why it is needed. |
| **Behavioral fidelity** | Does the interaction resemble the intended class of user behavior without becoming theatrical? | Turn length, correction frequency, escalation timing, and exit behavior stay within calibrated ranges. |

High fidelity does not mean matching a particular person word for word. It means preserving the behavioral constraints that make the test meaningful.

## The evaluation firewall: keep the answer key out of generation

Evaluation leakage is broader than “the model saw the final answer.” It includes any information that lets the generator or simulator optimize toward the locked test: exact rubrics, hidden goals, canonical tool traces, rare scenario identifiers, reference outputs, evaluator comments, or even a distinctive template that appears only in the test set.

Use separate partitions with explicit access rules.

```text
scenario source families
          |
          v
   generator partition  ----> development scenarios ----> prompt/model iteration
          |
          +----> quarantine and deduplication
          |
          +----> locked evaluation partition ----> evaluator only
                                             |
                                             v
                                       final report
```

![The evaluation firewall keeps generator and development artifacts away from the locked test set and evaluator-only annotations](/blog/synthetic-users-ai-agents/split-and-lock.webp)

A practical partitioning policy looks like this:

| Partition | Used for | May be regenerated? | Who may see hidden labels? |
|---|---|---:|---|
| **Generation** | Create scenario families, paraphrases, and controlled variants. | Yes. | Generator owners, but not final answer keys. |
| **Development** | Tune prompts, tools, policies, and simulator behavior. | Yes, with versioned provenance. | Engineers may inspect labels. |
| **Shadow** | Detect drift and estimate performance on fresh scenarios. | Periodically. | Limited reviewers. |
| **Locked evaluation** | Produce release evidence. | No during the release candidate window. | Evaluator and approved reviewers only. |
| **Production sample** | Compare benchmark assumptions with real traffic. | Continuously, with privacy controls. | Only authorized analysts. |

The locked set is not made valid merely by putting it in a different folder. Protect it operationally. Do not send it to the same prompt optimizer that edits the agent. Do not use evaluator comments as simulator instructions. Do not let a failed test automatically become a new training example without recording why it failed and which partition it belongs to.

LatestEval describes a dynamic construction approach that uses recent materials and removes answer-bearing text from context to reduce contamination risk.[6] The general principle is useful, but no method can prove that a closed model has never encountered a scenario. Report the limitation honestly. Use fresh source families, rotate scenario templates, maintain provenance, and check for near-duplicates rather than claiming mathematical purity.

## Add a leakage budget to the pipeline

Teams often discuss leakage as a binary property: clean or contaminated. A more useful operational model is a leakage budget. Every shortcut that exposes information about the final evaluation consumes part of that budget.

Examples include:

- Reusing the same rare phrase in both development and locked scenarios.
- Letting the simulator see the evaluator’s exact “must mention” rubric.
- Feeding a previous failure trace directly into a generator without masking the expected fix.
- Choosing the final test cases after inspecting which ones produce low scores.
- Using a model family to generate scenarios and then treating its own preferred phrasing as the natural distribution.

The budget is not a formal probability. It is a review mechanism that forces the team to ask what information crossed the firewall and why. A scenario record should include a lineage trail:

```json
{
  "scenario_id": "scn_7e91",
  "partition": "locked_eval",
  "source_family": "policy-transition-04",
  "generator_version": "factory-2.3.1",
  "simulator_version": "user-state-1.6.0",
  "template_hash": "sha256:...",
  "dedupe_cluster": "cluster_118",
  "label_visibility": "evaluator-only",
  "approved_at": "2026-06-19T09:30:00Z"
}
```

If the team cannot explain how a scenario was created, transformed, selected, and labeled, it cannot explain why the score should be trusted.

## Quality gates before an agent ever sees a scenario

Generated content should pass structural gates before semantic evaluation. The first gate is not an LLM judge; it is a validator that catches impossible data.

At minimum, validate:

1. The user goal is compatible with the available facts and tools.
2. Hidden constraints do not contradict the policy version.
3. Expected invariants are testable from observable events.
4. No secret, real personal record, or production credential appears in the fixture.
5. The scenario is not a near-duplicate of an existing development or locked case.
6. The conversation can terminate under a bounded turn budget.
7. The scenario has a clear owner, provenance, risk class, and partition.

Then apply semantic checks. A second model can critique whether the conversation sounds plausible, but it should not be the only judge. Sample cases for human review and measure agreement on concrete yes/no conditions.

The AISI methodology used task-specific correctness and safety conditions, often expressed as granular questions, and marked some safety conditions as not applicable when their prerequisite action never occurred.[2] That is a useful pattern for agent benchmarks. If the agent never sent an email, do not pretend you measured whether the email leaked a secret. Record the prerequisite as unmet and score the task according to the rubric’s defined semantics.

NVIDIA’s synthetic benchmark workflow similarly emphasizes domain-specific generation, quality scoring and filtering, ground truth pairing, and reproducible evaluation in CI/CD.[4] The important part is the chain, not the product name: generated examples must be inspected, labeled, and replayable before they become evidence.

## Evaluate the whole trace, not just the final answer

An agent can produce a correct final sentence after making an unsafe tool call. It can also produce a cautious sentence while failing to complete the user’s legitimate task. Final-answer grading alone hides both cases.

Capture the full observable trace:

```text
scenario=scn_7e91
  user_turn_1 -> asks to move a meeting
  agent       -> asks for timezone
  user_turn_2 -> provides timezone, withholds private note
  agent       -> calendar.lookup()
  tool        -> returns two candidates
  agent       -> asks clarification instead of guessing
  user_turn_3 -> selects candidate B
  agent       -> calendar.update()
  outcome     -> one event moved, private note never disclosed
```

Score separate dimensions and preserve the trace behind each score.

| Dimension | Example invariant |
|---|---|
| Goal completion | The requested event is updated exactly once. |
| Information discipline | The agent does not reveal a withheld or unauthorized fact. |
| Clarification quality | The agent asks only for information needed to resolve ambiguity. |
| Tool correctness | Arguments match the selected resource and current policy. |
| Recovery behavior | A timeout leads to lookup or escalation, not blind repetition. |
| User experience | The user receives a comprehensible explanation of the next step. |
| Trace integrity | The record contains enough evidence to reproduce the judgment. |

AgentLeak demonstrates why this matters for multi-agent systems: sensitive data can travel through inter-agent messages, shared memory, and tool arguments even when the final answer looks safe.[5] A synthetic-user harness should therefore log and evaluate the channels that the deployment actually exposes, subject to privacy minimization. Output-only audits are not enough for systems whose behavior is distributed across internal channels.

## Avoid self-confirming synthetic loops

There is a subtle failure mode in which every component agrees because they were built from the same assumptions. The generator writes the scenario. The simulator acts from the generator’s persona. The evaluator rewards the generator’s preferred answer. A model from the same family critiques the output using the same vocabulary. The resulting score is internally consistent and externally wrong.

Break the loop deliberately.

| Component | Useful separation |
|---|---|
| Generator | Use multiple templates, seed families, or model providers. |
| Simulator | Vary the simulator model or policy implementation during calibration. |
| Agent | Test the release candidate with its real tool and policy stack. |
| Evaluator | Combine deterministic invariants, model-based grading, and human review. |
| Data source | Mix synthetic, human-curated, production-sampled, and domain-expert cases where privacy permits. |
| Release decision | Require evidence from a locked set not used during iteration. |

Do not interpret disagreement as noise to be averaged away. If two simulators produce materially different turn counts or escalation rates, that is a signal to inspect the behavioral contract. If two graders disagree on whether a disclosure was authorized, the rubric may be underspecified.

A good benchmark exposes uncertainty instead of hiding it in one decimal score. Report confidence intervals or repeated-run ranges where appropriate, segment results by scenario family and risk tag, and preserve enough traces to investigate regressions.

## Continuous evaluation without contaminating the future

Synthetic scenarios are most useful when they become a maintained test system rather than a one-time dataset. Every prompt, model, tool, policy, and orchestration change can alter behavior. OpenAI recommends continuous evaluation and growing the set with new cases from production feedback.[1]

A safe update loop can look like this:

1. Mine candidate failure patterns from production traces after privacy review and redaction.
2. Convert the pattern into a scenario contract without copying the customer’s exact wording.
3. Generate controlled variants and run structural, semantic, and near-duplicate checks.
4. Place the case in development or shadow first; do not promote it directly into the locked set.
5. Calibrate the rubric with a human reviewer and record the decision.
6. Freeze the release candidate and run the locked evaluation without exposing labels to the agent or optimizer.
7. After release, compare benchmark segments with production outcomes and retire scenarios that no longer represent the world.

The locked set should be stable long enough to compare releases, but not so static that the team memorizes it. Rotate a shadow set from new source families and keep the rotation process independent from the release score. A fresh scenario that is not yet trusted can be useful as a drift signal without becoming an official pass/fail gate immediately.

## A rollout plan for a small team

A team does not need a thousand scenarios on day one. Start with one workflow and make the evidence trustworthy.

**Week one: define the contract.** Choose a workflow with a clear business outcome and limited blast radius. Write ten human-readable scenarios, identify invariants, and list the information the user and agent must not see. Build deterministic validation before adding synthetic generation.

**Week two: add controlled variation.** Create dimensions for user behavior, world state, policy, tool health, and risk. Generate a small development set, inspect duplicates, and record provenance. Keep the locked set human-curated at this stage.

**Week three: add the simulator.** Implement a stateful user policy with bounded turns, correction rules, and exit conditions. Compare its behavior with a small sample of real or human-authored interactions. Measure fidelity separately from agent success.

**Week four: add the firewall.** Separate generation, development, shadow, and locked evaluation permissions. Add template hashes, partition checks, label access logs, and a review step for every promotion. Run the same release through deterministic invariants, model-based graders, and human calibration.

After that, increase coverage based on observed failure modes rather than a vanity target such as “one million prompts.” A smaller suite with traceable invariants and honest partitions is more valuable than a huge suite whose answer key is everywhere.

![A continuous evaluation loop feeds redacted production patterns into development and shadow sets while protecting the locked release gate](/blog/synthetic-users-ai-agents/fidelity-loop.webp)

## The design rule to carry forward

Synthetic users are powerful precisely because they let an engineering team explore interactions that are too expensive, private, rare, or risky to stage with real customers. That power becomes dangerous when the simulator is treated as an oracle or when the benchmark is optimized until it recognizes its own fingerprints.

Keep the scenario contract stable, the user behavior stateful, the evaluator evidence-based, and the locked set boringly inaccessible. Measure whether the simulator creates the right pressure before trusting what the agent score means. Track provenance so that a generated case is not mistaken for an observed fact. Compare the benchmark with production so that synthetic realism remains an empirical question.

The goal is not to make the user simulator clever. The goal is to make the evaluation difficult to fool.

That is the difference between generating more test cases and building an evaluation system you can trust.

## Related reading

For regression-suite design, read [Do Not Ship a Tool-Calling AI Agent Without Evals](/blog/agent-evals-regression-suite). For uncertainty-aware product behavior, continue with [When AI Gives a Partial Answer](/blog/ai-partial-answer-uncertainty-ux). For privacy risks across internal agent channels, compare the methodology here with [AI Agent Identity Is Not a User ID](/blog/agent-identity-delegation-revocation).

## References

[1]: https://developers.openai.com/api/docs/guides/evaluation-best-practices "OpenAI API — Evaluation best practices"
[2]: https://sgaisi.sg/resources/testing-ai-agents-for-data-leakage-risks-in-realistic-tasks/ "AISI — Testing AI Agents for Data Leakage Risks in Realistic Tasks"
[3]: https://arxiv.org/abs/2605.20204 "RealUserSim: Bridging the Reality Gap in Agent Benchmarking via Grounded User Simulation"
[4]: https://developer.nvidia.com/blog/how-to-build-privacy-preserving-evaluation-benchmarks-with-synthetic-data/ "NVIDIA Technical Blog — How to Build Privacy-Preserving Evaluation Benchmarks with Synthetic Data"
[5]: https://arxiv.org/html/2602.11510v2 "AgentLeak: A Full-Stack Benchmark for Privacy Leakage in Multi-Agent LLM Systems"
[6]: https://arxiv.org/html/2312.12343v1 "Avoiding Data Contamination in Language Model Evaluation: Dynamic Test Construction with Latest Materials"
