---
title: "LLM Math Students Can Trust: A Verification-First Architecture for EdTech APIs"
description: "A production playbook for generating mathematical problems and tutoring feedback with LLM APIs while keeping correctness, solvability, pedagogy, and release safety outside the model."
pubDate: 2026-07-28
category: "engineering"
lang: "en"
translationKey: "llm-math-correctness-edtech-api"
draft: false
image: "/blog/llm-math-correctness-edtech/hero.webp"
---

The most dangerous output from an AI math tutor is not an obviously absurd answer. It is a polished explanation that looks like something a teacher would say, contains one invalid algebraic step, and gives a student enough confidence to remember the mistake.

That failure mode changes the engineering question. The question is not whether an LLM can generate a problem, solve an equation, or explain a fraction. It often can. The question is whether an EdTech product can **know when the generated artifact is correct, solvable, pedagogically appropriate, and safe to publish**.

An LLM API is a useful generator, paraphraser, and tutor interface. It is not a mathematical source of truth. Research on LLM tutoring has found that responses can be aligned with pedagogical best practices while still containing frequent inaccuracies, and that plausible errors can create misconceptions for learners.[1](https://arxiv.org/html/2503.16460v1) Research on stepwise verification similarly finds that identifying the first incorrect step in a student solution is difficult for current models, while an independent verifier can improve the correctness and targeting of feedback.[2](https://aclanthology.org/2024.emnlp-main.478/)

![An LLM math candidate enters independent verification gates before an EdTech release can publish it](/blog/llm-math-correctness-edtech/hero.webp)

> **The thesis:** Let the LLM propose mathematical content, but let deterministic computation, symbolic reasoning, curriculum rules, and human review decide whether that content is publishable.

This article presents a verification-first architecture for an EdTech system that uses an LLM API to generate practice questions, answer keys, worked solutions, hints, and feedback. It is designed for teams building a production content pipeline, not for a one-off prompt in a chat window.

## Correctness is a stack, not a single boolean

A generated math item can fail in several independent ways. The final number may be correct while the explanation is invalid. The algebra may be valid while the question is ambiguous. The problem may be solvable while the requested grade level is wrong. A JSON response may pass schema validation while the answer field contradicts the solution steps.

Treating all of these as `correct: true/false` hides the real failure. A better design gives every artifact a set of explicit claims and verifies each claim with the cheapest reliable mechanism available.

| Property | The question to verify | Preferred verifier |
|---|---|---|
| Schema validity | Does the API response contain the required fields and types? | JSON Schema or typed parser |
| Solvability | Does the problem have at least one valid solution under its stated domain? | Symbolic solver, constraint solver, or enumerator |
| Answer correctness | Does the proposed answer satisfy the equation or computation? | Exact arithmetic, SymPy, Z3, or domain-specific engine |
| Step validity | Does every transformation preserve the stated relationship? | Symbolic equivalence and step-level checker |
| Domain safety | Are denominators non-zero, square-root arguments valid, and units consistent? | Constraint and invariant checks |
| Problem quality | Is the wording unambiguous and internally consistent? | Rule checks plus evaluator and human sampling |
| Pedagogical fit | Does the item match grade, skill, difficulty, and hint policy? | Curriculum rubric and trained reviewer |
| Release safety | Did quality, safety, cost, and latency stay within thresholds? | Regression suite and release gate |

The distinction matters because a structured response is not automatically a correct response. Structured Outputs can constrain an API response to a supplied JSON Schema and make refusals detectable, but the documentation also warns that structured outputs can still contain mistakes.[3](https://developers.openai.com/api/docs/guides/structured-outputs) Schema compliance is the first gate, not the mathematical proof.

## Separate the generation contract from the mathematics contract

The LLM should not return an unstructured paragraph that another service must reverse-engineer. Ask it for a typed candidate artifact with enough information for a verifier to recompute the claims.

A useful internal representation might look like this:

```json
{
  "item_id": "alg-linear-000184",
  "skill": "solve_one_step_linear_equations",
  "grade_band": "6-7",
  "prompt": "A number increased by 7 is 19. What is the number?",
  "variables": [{"name": "x", "domain": "integers"}],
  "constraints": ["x + 7 = 19"],
  "expected_answers": [{"value": "12", "form": "integer"}],
  "solution_steps": [
    {"claim": "x + 7 = 19", "operation": "given"},
    {"claim": "x = 19 - 7", "operation": "subtract 7 from both sides"},
    {"claim": "x = 12", "operation": "evaluate"}
  ],
  "hint_policy": "scaffold_without_revealing_answer",
  "pedagogical_intent": "isolate a variable using inverse operations"
}
```

The `constraints` field is not a decorative explanation. It is the machine-checkable problem statement. The `expected_answers` field is not trusted merely because the model generated it. The verifier derives its own answer and compares the two using an equivalence rule appropriate to the domain.

The contract should also represent failure states. A model refusal, malformed response, missing variable domain, ambiguous unit, or unsolved symbolic expression should not be converted into an empty string and published. It should become a typed rejection that the pipeline can count, retry, quarantine, or route to review.

```text
CandidateStatus =
  ACCEPTED
  REJECTED_SCHEMA
  REJECTED_UNSOLVABLE
  REJECTED_MATH
  REJECTED_PEDAGOGY
  NEEDS_HUMAN_REVIEW
  GENERATION_REFUSED
```

## The verification pipeline

A reliable pipeline is intentionally asymmetric. Generation can be probabilistic and creative; acceptance must be conservative and reproducible.

```text
LLM API generation
        ↓
Structured parse + schema validation
        ↓
Canonicalize expressions, units, and answer forms
        ↓
Solve or execute independently
        ↓
Verify answer, constraints, and every solution step
        ↓
Run adversarial and metamorphic tests
        ↓
Check curriculum and pedagogy
        ↓
Sample for human review
        ↓
Publish, monitor, or quarantine
```

The pipeline should fail closed. If the solver times out, if a required assumption is missing, or if a checker cannot determine equivalence, the item should not silently pass. A safe fallback is either regeneration with a narrower task, a simpler item type, or a human review queue.

![A structured math contract is checked by parser, symbolic solver, domain invariants, and pedagogical rules](/blog/llm-math-correctness-edtech/structured-math-contract.webp)

## Layer one: parse and canonicalize before solving

Mathematical strings are deceptively hard to compare. `0.5`, `1/2`, and `50%` may be equivalent in one context but not in another. `x^2 - 1` and `(x - 1)(x + 1)` are algebraically equivalent over the reals, but a text comparison will mark them different. A decimal answer can also hide rounding assumptions.

Before verification, canonicalize the artifact. Normalize Unicode minus signs, parse numbers as exact rational values where possible, identify units, and convert equivalent expression forms into an internal representation. Do not use floating-point equality for an exact algebra problem unless the product explicitly defines a tolerance.

A canonicalizer should preserve the original student-facing text for display while producing a separate machine-facing form. This avoids a common mistake: rewriting the learner's explanation into a normalized expression and then losing the context needed for pedagogical feedback.

## Layer two: recompute with an independent engine

The simplest useful rule is to compute the answer twice using different mechanisms. If the LLM says that `3/4 + 2/3 = 17/12`, an exact rational library can verify the result without asking another model. For algebra, a symbolic system can solve the equation and substitute the candidate answer back into the original constraints. SymPy documents symbolic equation solving through tools such as `solveset` and related solver APIs.[4](https://docs.sympy.org/latest/modules/solvers/solvers.html)

For constraint-heavy problems, an SMT solver can express variables, domains, inequalities, and logical relationships. Z3's programming guide presents a practical API for solving arithmetic and logical constraints.[5](https://theory.stanford.edu/~nikolaj/programmingz3.html) The point is not that every school problem needs a theorem prover. The point is that the final answer should be checked by a system whose operation is not the same as the language model's token prediction.

A minimal verification routine for a linear equation might follow this shape:

```python
from sympy import Eq, Integer, Symbol, solveset, S, simplify

x = Symbol("x", integer=True)
constraint = Eq(x + Integer(7), Integer(19))
solutions = solveset(constraint, x, domain=S.Integers)

candidate = Integer(12)
answer_ok = candidate in solutions
substitution_ok = simplify(constraint.lhs.subs(x, candidate) - constraint.rhs) == 0

assert answer_ok and substitution_ok
```

This code does not prove that the English wording is unambiguous or that the problem is appropriate for a sixth-grade learner. It proves a narrower claim: under the parsed constraint and integer domain, 12 satisfies the equation. Keeping that boundary explicit prevents a solver from being treated as a universal judge.

## Layer three: verify the path, not only the destination

A correct final answer can be reached through an invalid step. Consider a generated solution that divides both sides of an equation by `x - 2` without proving that `x ≠ 2`. The final answer may happen to be right for the specific instance, but the transformation rule is unsafe as a teaching pattern.

Represent each step as a claim plus an operation. The step verifier checks whether the next claim follows from the previous claim under the operation and its side conditions. For an equation transformation, it can compare the solution sets before and after the step. For a numerical computation, it can recompute both sides exactly. For geometry or word problems, it may require a domain-specific checker or a constrained template.

Research on formal verification for LLM-based mathematical problem solving uses a formalizer and critic design, converting natural-language reasoning into a structured language and checking statements with tools such as a computer algebra system and an SMT solver.[6](https://arxiv.org/html/2505.20869v1) That pattern is valuable for EdTech because it makes the verifier inspect a dependency graph of claims rather than merely asking a second LLM whether the paragraph sounds correct.

## Layer four: verify the problem itself

Many teams verify only the answer key. That is too late. A flawed prompt can have no solution, multiple unintended solutions, contradictory units, or a diagram that is inconsistent with the text.

Run problem-level checks before accepting a solution:

| Check | Example failure |
|---|---|
| Existence | “Find the positive integer” but every solution is negative |
| Uniqueness | A question expects one answer but the constraints allow many |
| Boundaries | A probability exceeds 1 or a length is negative |
| Units | A rate in kilometers per hour is added directly to a distance in meters |
| Wording | “Increase by 20%” is confused with “increase to 20%” |
| Diagram contract | Text says an isosceles triangle while supplied coordinates are not isosceles |
| Difficulty | A grade-5 item silently requires quadratic roots |
| Answer leakage | The hint or explanation gives away the final answer before the learner attempts the task |

The generator should declare assumptions explicitly. If a word problem depends on “all prices are in dollars,” “time is measured in hours,” or “answers must be integers,” those constraints belong in the artifact, not only in the prose.

## Generation needs adversarial and metamorphic tests

A small set of happy-path examples does not test a generator. Math content benefits from transformations that preserve or predictably change the answer.

A metamorphic test can rename variables, reorder irrelevant facts, scale all lengths by the same factor, convert units, or perturb a coefficient while preserving the expected relationship. The verifier should confirm that the generated answer changes as predicted. For a linear equation, adding the same constant to both sides should not change the solution set after canonicalization. For a percentage problem, converting dollars to cents should preserve the percentage result while changing the numerical representation.

Adversarial tests target the places where language models are most likely to sound confident: zero denominators, negative quantities, boundary probabilities, repeated units, nested fractions, large numbers, ambiguous pronouns, and problems whose natural-language assumptions are inconsistent.

![Metamorphic and adversarial cases probe boundary values, equivalent forms, units, and ambiguous assumptions before publication](/blog/llm-math-correctness-edtech/adversarial-tests.webp)

Do not report only the average pass rate. Track the failure taxonomy. A generator with 98% answer validity but 12% unit errors may be unsafe for a science curriculum. A tutor with 95% correct final answers but poor first-error localization may give harmful feedback to students who made a near-correct attempt.

## Evaluate tutoring quality separately from answer correctness

Tutoring is not a multiple-choice answer key. A response can be mathematically correct and educationally poor if it reveals the answer immediately, ignores the learner's mistake, uses vocabulary beyond the target grade, or praises an incorrect step.

Use at least four evaluation dimensions:

| Dimension | Example metric |
|---|---|
| Mathematical correctness | Answer-equivalence rate, step validity, constraint satisfaction |
| Diagnostic accuracy | First incorrect step localized, misconception label correct |
| Instructional quality | Hint scaffolding, explanation clarity, no premature answer reveal |
| Product safety | PII leakage, policy violations, latency, cost and refusal handling |

Human review remains important for claims that are difficult to formalize, especially wording ambiguity, diagram interpretation, cultural context, and pedagogical tone. It should not be the only line of defense, because reviewers cannot inspect every generated item at scale. The right design is a layered sample: deterministic checks for every item, model-based or rule-based critics for many items, and human review for a statistically designed sample plus all high-risk cases.

## A production release gate

Treat generated content as a release artifact. A content batch should carry the model identifier, prompt version, generator code commit, verifier version, dataset version, curriculum mapping, and reviewer status. Without those fields, a team cannot reproduce why an item was accepted or explain why a later rerun differs.

A practical manifest could look like this:

```yaml
release:
  id: algebra-practice-2026-07-28.1
  generator_model: approved-llm-alias
  generator_prompt_version: 14
  code_sha: 91d8e22
  verifier_version: math-checker-3.4.0
  dataset_version: algebra-golden-2026-07-25
  owner: learning-platform

gates:
  schema_validity: ">= 0.995"
  problem_solvable: "= 1.0"
  answer_equivalence: "= 1.0"
  step_validity: ">= 0.995"
  curriculum_alignment: ">= 0.95"
  high_risk_human_review: "= 1.0"
  pii_leakage: "= 0.0"

rollout:
  mode: shadow_then_canary
  canary_percent: 5
  rollback_on:
    - verifier_disagreement
    - safety_violation
    - quality_regression
```

![A verification-first release loop connects generation, independent checks, pedagogy review, publication, monitoring, and quarantine](/blog/llm-math-correctness-edtech/release-loop.webp)

The thresholds should be calibrated using the product's own benchmark, not copied from another team. For high-stakes assessment or answer keys, a single invalid item may be unacceptable even if the batch average is excellent. For low-risk draft generation, the product may accept a review queue rather than blocking every candidate.

## CI/CD for math generation

A content pipeline can run the same way as a software release:

```text
Pull request changes prompt, generator, rubric, or verifier
        ↓
Schema and static contract checks
        ↓
Golden problems + edge-case suite
        ↓
Independent solver verification
        ↓
Metamorphic and adversarial tests
        ↓
Curriculum and pedagogy evaluation
        ↓
Staging batch with full audit metadata
        ↓
Human review for sampled/high-risk items
        ↓
Canary publication
        ↓
Post-release sampling and rollback/quarantine
```

The key is to version the verifier as carefully as the generator. A new solver rule can reject previously accepted artifacts, while a new prompt can produce content that passes an old checker but fails a new curriculum rubric. Store both versions with the batch and re-run a representative historical corpus before promotion.

A production incident should create a regression item. If a student reports that a generated fraction explanation is wrong, preserve the redacted artifact, identify the first invalid claim, add the case to the golden set, fix the prompt or verifier, and rerun the release gate. Do not only patch the single visible answer. The incident is evidence of a missing test class.

## When a verifier cannot decide

Not every mathematical statement is easy to formalize. Geometry diagrams, open-ended proofs, modeling assumptions, graph interpretations, and natural-language word problems can exceed a narrow symbolic engine.

The correct response is abstention, not confidence theater. A verifier should return `unknown` when its assumptions are incomplete, when parsing is ambiguous, or when a solver times out. The product can then ask the LLM to produce a simpler artifact, switch to a constrained template, or route the item to a teacher. “No proof of failure” is not the same as “proof of correctness.”

This is also where product design matters. Use deterministic templates for arithmetic and algebra families that can be fully checked. Reserve free-form generation for areas where the product has a review and escalation path. A smaller reliable surface is more valuable than a broad generator that quietly teaches incorrect mathematics.

## What to measure after launch

Monitor the complete reliability funnel, not only API latency:

```text
request → parse → solve → step-check → pedagogy-check → review → publish → learner outcome
```

Useful metrics include candidate rejection rate by reason, solver timeout rate, answer-equivalence rate, first-error localization accuracy, hint answer-leak rate, human disagreement rate, post-publication defect rate, cost per accepted item, and time from incident to regression coverage.

Segment these metrics by skill, grade band, language, model, prompt version, and generator release. An aggregate score can hide a weak subgroup. For example, a system may perform well on integer arithmetic while failing on fractions in Vietnamese wording or on problems with unit conversion.

The product should also measure learning behavior. A mathematically correct hint is not necessarily a useful hint. Check whether learners attempt the next step, whether repeated errors decrease, and whether a correction makes the misconception clearer rather than merely replacing the answer.

## A practical adoption sequence

Start with a narrow problem family whose semantics are easy to formalize: one-step equations, arithmetic word problems with explicit units, or multiple-choice distractors generated from known misconception patterns. Build the contract, deterministic verifier, adversarial set, and release gate before expanding the domain.

Next, add step-level feedback and a redacted human-review loop. Only after the team can reproduce and quarantine failures should it move to more open-ended tutoring, geometry, proofs, or multimodal diagrams.

The implementation is intentionally conservative:

1. **Generate a candidate, never a final truth.**
2. **Parse into a typed artifact with explicit assumptions.**
3. **Recompute with an independent solver or exact execution.**
4. **Check every important transformation, not just the final number.**
5. **Run adversarial, metamorphic, curriculum, and safety tests.**
6. **Abstain when the verifier cannot decide.**
7. **Publish only through a versioned release gate.**
8. **Turn every production defect into a regression test.**

An EdTech product earns trust not when its model sounds like a teacher, but when the system can show why a generated item was accepted, which assumptions were checked, which version created it, and how the team will prevent the same error from reaching another learner.

## References

[1] Gupta et al., “Beyond Final Answers: Evaluating Large Language Models for Math Tutoring,” arXiv, 2025: <https://arxiv.org/html/2503.16460v1>

[2] Daheim et al., “Stepwise Verification and Remediation of Student Reasoning Errors with Large Language Model Tutors,” EMNLP 2024: <https://aclanthology.org/2024.emnlp-main.478/>

[3] OpenAI, “Structured model outputs,” API documentation: <https://developers.openai.com/api/docs/guides/structured-outputs>

[4] SymPy Documentation, “Solvers”: <https://docs.sympy.org/latest/modules/solvers/solvers.html>

[5] Nikolaj Bjørner, “Programming Z3,” Microsoft Research / Stanford-hosted guide: <https://theory.stanford.edu/~nikolaj/programmingz3.html>

[6] Zhou and Zhang, “Step-Wise Formal Verification for LLM-Based Mathematical Problem Solving,” arXiv, 2025: <https://arxiv.org/html/2505.20869v1>
