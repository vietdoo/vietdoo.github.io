---
title: "Agent Receipts: A User-Readable Proof of What Changed"
description: "A practical design for giving people a concise, verifiable account of what an AI agent changed, why it was allowed, and what the receipt cannot prove."
pubDate: 2026-09-03
category: "engineering"
lang: "en"
translationKey: "agent-receipts-user-readable-proof"
draft: false
image: "/blog/agent-receipts/hero.png"
---

The first question after an AI agent changes a customer record is rarely “Can I search the trace?” It is usually much simpler: **What changed, why did it change, and who allowed it?**

A trace can answer those questions, but only after someone knows which trace to open, understands the orchestration graph, and separates the meaningful decision from retries, model calls, and internal telemetry. A raw log is even less helpful. It may contain every event and still fail to give an affected person a usable account of the outcome.

That is the job of an **agent receipt**: a compact, user-readable proof of an important agent outcome. It is not a transcript, a dashboard, a chain-of-thought dump, or a replacement for an audit trail. It is the last mile between a complex automated workflow and the person who needs to understand its effect.

![An AI agent action becomes a compact, human-readable receipt with a shield, timestamp, action summary, and linked evidence](/blog/agent-receipts/hero.png)

> **The thesis:** An agent receipt should make the changed state, authority, evidence, and uncertainty legible in one place. It should help a human decide whether to accept, investigate, reverse, or escalate an outcome without reading the entire execution trace.

Microsoft’s practical lesson on cryptographic receipts describes a receipt as a signed JSON object that records what an agent did. It highlights attribution, integrity, and ordering as useful guarantees, while also drawing an important boundary: a receipt does not prove that an action was correct or that the policy itself was sound.[1] That boundary is the difference between an honest accountability design and a decorative “verified” badge.

## A receipt is not a prettier log

Logs and traces are optimized for operators. Receipts are optimized for a reader who has a question about an outcome.

A trace might contain 180 spans: prompt assembly, retrieval, routing, tool selection, retries, cache misses, policy checks, and database calls. Those details matter during debugging. They are not the right first interface for a customer who wants to know whether the shipping address on an order was changed.

A receipt compresses the execution into an outcome contract. It says what changed, which actor performed or authorized the change, what evidence was used, which policy permitted it, and how the reader can verify or challenge the claim.

| Artifact | Primary reader | Main question | What it should not pretend to be |
|---|---|---|---|
| Log | Service operator | What events occurred? | A complete explanation for a customer. |
| Trace | Engineer or SRE | Where did time, cost, or failure accumulate? | Proof that an action was justified. |
| Policy decision | Security or platform owner | Was this action allowed under a rule? | Evidence that the action actually happened. |
| Citation or source list | Reviewer | What sources informed the answer? | Proof that a side effect was applied. |
| **Agent receipt** | Affected user, reviewer, auditor | What changed, under whose authority, with what evidence? | Proof that the decision was wise or the policy was correct. |

The distinction matters because a receipt is a **projection** of deeper records. It should link to evidence and preserve stable identifiers, but it should not copy every prompt and payload into a new data leak. A receipt that is easy to read but impossible to connect to authoritative evidence is only a summary. A receipt that contains every secret is an incident waiting to happen.

## Start from the changed state

The most useful receipt begins with the state transition, not the model’s prose.

Suppose a support agent changes a ticket priority from `normal` to `urgent`. The receipt should show the before value, the after value, the target record, the time of the change, and the action status. It should also make clear whether the agent changed the record directly, prepared a draft, or requested a human approval that another system applied.

```text
Change
  target: ticket://support/48291
  field: priority
  before: normal
  after: urgent
  status: applied
  applied_at: 2026-09-03T10:14:22Z
```

This sounds obvious, but many agent systems record only a final natural-language answer: “I escalated the ticket because the customer reported a service outage.” That sentence is not enough. It does not identify the exact mutation, distinguish an attempted action from a committed one, or tell the user whether the agent had authority to perform it.

A receipt should separate **intent**, **authorization**, **execution**, and **observed result**. These can diverge. An agent may intend to update a ticket, receive approval, time out while calling the ticket system, and later discover that the update actually succeeded. A trustworthy receipt should not collapse that sequence into a confident sentence.

## A practical receipt envelope

A useful design has two representations: a human-facing view and a machine-verifiable envelope. They share identifiers and facts, but they serve different readers.

![An exploded receipt envelope assembles action summary, actor and scope, evidence hashes, policy decision, and verification seal](/blog/agent-receipts/receipt-envelope.png)

The human-facing view can be rendered as a small card, email section, activity entry, or downloadable artifact. The envelope can be stored and verified independently.

```json
{
  "type": "agent.change_receipt.v1",
  "receipt_id": "rcpt_01J7Q9K3M2",
  "workflow_id": "wf_support_triage",
  "agent": {
    "agent_id": "agt_support_triage_prod",
    "version": "2026.09.03.2"
  },
  "actor": {
    "subject": "support-automation",
    "authority": "ticket:write",
    "delegated_by": "customer-operations"
  },
  "change": {
    "target_ref": "ticket://support/48291",
    "field": "priority",
    "before_hash": "sha256:...",
    "after_hash": "sha256:...",
    "status": "applied"
  },
  "evidence": [
    {"ref": "case_note:8812", "role": "reported_outage"},
    {"ref": "policy:support-escalation-v4", "role": "authorization"}
  ],
  "verification": {
    "canonicalization": "JCS",
    "signature_algorithm": "EdDSA",
    "signature": "base64:...",
    "key_id": "gateway-key-2026-09"
  },
  "created_at": "2026-09-03T10:14:22Z"
}
```

The example intentionally stores hashes rather than raw sensitive values. The UI can display “normal → urgent” to an authorized user while the signed envelope preserves tamper-evident references without duplicating customer data.

A receipt schema should be boring. Stable field names, explicit status values, versioning, and predictable identifiers matter more than an expressive prose field. The system should be able to answer, “Which exact receipt format was used?” several years later.

## The five questions every receipt should answer

A good receipt does not need to expose the agent’s private reasoning. It does need to answer five operational questions.

| Question | Receipt field | Example |
|---|---|---|
| What changed? | State transition | Ticket priority changed from normal to urgent. |
| Which actor did it? | Agent and delegated authority | Support triage agent under `ticket:write`. |
| Why was it allowed? | Policy and approval reference | Escalation policy v4, approval ID if required. |
| What supports the claim? | Evidence references | Case note, source record, tool result hash. |
| Can I verify or challenge it? | Verification and recovery links | Signature status, trace ID, undo request, appeal path. |

The “why” should be expressed as a decision summary, not generated justification. For example: “The action matched policy `support-escalation-v4` because the case contained an outage signal and the account was in an affected region.” The receipt can link to the policy evaluation and evidence without claiming that the model’s internal explanation is a faithful causal account.

This is where receipts improve the human experience. They turn an investigation from “search through everything the model saw” into “inspect the five facts that determine whether this outcome should stand.” The detailed trace remains available when the summary is insufficient.

## Separate proof from confidence

A signature can prove that a trusted gateway signed a particular payload. It cannot prove that the gateway was right. A hash can show that an evidence object has not changed. It cannot prove that the evidence was relevant. A policy ID can identify the rule used. It cannot prove that the rule captured the organization’s intent.

The receipt should therefore expose different kinds of status instead of one green “verified” label.

| Status | Meaning | Safe user interpretation |
|---|---|---|
| Signed and linked | The envelope verifies and its evidence references resolve. | The record is intact and attributable. |
| Signed, evidence pending | The signature verifies but one or more evidence systems are unavailable. | The claim is attributable, but review is incomplete. |
| Unsigned summary | A UI summary exists without a verifiable envelope. | Treat it as a convenience view, not proof. |
| Verification failed | Signature, ordering, or hash checks failed. | Stop relying on the receipt and investigate. |
| Outcome uncertain | The execution result is unknown or still reconciling. | Do not describe the action as completed. |

This vocabulary prevents a common failure mode: using cryptography to create false certainty. The arXiv work on verifiability-first agents makes a similar point from a broader control perspective: assurance should help detect and remediate misalignment, not merely produce a plausible explanation after the fact.[2]

## Make the receipt privacy-aware

Receipts often travel farther than the underlying system. A user may forward one to support. A reviewer may export it to a ticket. An auditor may retain it for years. That makes data minimization part of receipt design.

Use stable references instead of copying raw prompts, full tool payloads, secrets, access tokens, or unrelated conversation history. Redact fields according to the reader’s scope, not according to a single global redaction rule. A customer may see that an address changed but not an internal fraud score. A support agent may see the source ticket. A security reviewer may see the policy evaluation metadata.

A redacted receipt should say that something was redacted and why. Silent omission creates ambiguity: did the agent not use that evidence, or is the reader not authorized to see it?

```text
Evidence: 3 references
  visible: customer_case:8812
  visible: policy:support-escalation-v4
  restricted: risk_signal:••••
  restriction_reason: security.review scope required
```

Do not use the receipt as a side channel for sensitive data. Even a hash can become identifying when an attacker can guess the underlying value. Hashing is an integrity technique, not a universal privacy technique.

## Verification should be a normal product path

A receipt that is technically verifiable but practically impossible to verify has failed its audience. The product should offer a simple “view evidence,” “verify integrity,” “request review,” or “undo” path, depending on the action’s risk.

![A verification flow moves from an agent gateway through canonicalization and hash checks to a human reviewer who sees pass, warning, or unverifiable outcomes](/blog/agent-receipts/verification-flow.png)

The verification service should operate independently enough that the same team or process that produced the action cannot silently rewrite the evidence. A typical flow is:

```text
receipt received
  -> parse version and identifiers
  -> canonicalize signed fields
  -> verify signature
  -> verify hash and sequence links
  -> resolve evidence references by access scope
  -> compare claimed status with authoritative state
  -> return verified, warning, failed, or unknown
```

Canonicalization matters because two JSON serializers can represent the same logical object with different bytes. Microsoft’s lesson uses JSON Canonicalization Scheme and Ed25519 signing, then adds a previous-receipt hash to make ordering tamper-evident.[1] Teams do not need to copy that exact stack, but they should choose a reproducible encoding, a managed key lifecycle, and a verification procedure that can be implemented by more than one component.

The final step is especially important: **verify the claimed state against the source of truth**. A valid receipt may say that a database update was applied while the record was later changed by a human or another agent. Integrity of the receipt is not freshness of the world.

## Receipts for uncertain outcomes

Distributed systems produce awkward moments. A tool call times out after the remote service accepted the request. A queue acknowledges delivery but the worker crashes before emitting a result. A browser agent loses its session after clicking “submit.”

An agent receipt should make uncertainty explicit:

```text
Action: refund request
Execution: accepted by payment provider
Local observation: timeout before confirmation
Receipt status: outcome-uncertain
Next step: reconcile with provider reference pay_8f2...
```

This is more useful than either “failed” or “completed.” The first may trigger a duplicate action. The second may cause a user to believe money moved when it did not. A receipt can point to a reconciliation task, retry policy, or human review queue without pretending that the system knows more than it does.

The same design applies to reversals. If the action is reversible, the receipt should show whether an undo operation exists, until when it is available, and whether the undo itself will produce a new receipt. Never edit the original receipt to make the history look clean. Append a correction or reversal receipt that points back to the original.

## The receipt is the end of a chain, not the whole chain

A mature agent platform may already have identity, policy, observability, evidence, and recovery systems. The receipt should join those systems at a stable boundary.

![A human reviews a receipt beside a before-and-after customer record, evidence trail, and visible uncertainty boundary](/blog/agent-receipts/receipt-ux.png)

The most useful implementation pattern is to generate the receipt only after the system has an authoritative action result—or to issue an explicitly provisional receipt when the result is not yet known. The receipt generator should consume structured events, not ask the model to summarize its own behavior from memory.

A practical production sequence looks like this:

1. The orchestrator creates an immutable workflow and action identifier.
2. The policy layer records the decision and the authority scope.
3. The tool adapter records the requested mutation and the authoritative result.
4. The evidence service assigns stable references and access classifications.
5. The receipt service renders a human view and signs the machine envelope.
6. The product exposes verification, review, and recovery paths.
7. A later correction creates a new linked receipt rather than rewriting history.

This design also gives teams a useful test surface. Test that a receipt is not emitted for an uncommitted action. Test that a timeout produces `outcome-uncertain`, not a false success. Test that a user without evidence scope sees a redaction marker rather than an accidental payload. Test that a changed policy version is visible in the receipt. Test that tampering breaks verification and triggers an operational alert.

## What receipts do not solve

Receipts do not solve poor authorization, unsafe tools, weak evidence, hallucinated claims, or badly designed business policies. They do not make an agent reliable merely because a gateway signs its output. They do not replace a trace for debugging, a ledger for accounting, a policy engine for authorization, or a recovery system for partial side effects.

They solve a narrower but important problem: **making an agent outcome legible and accountable at the point where a human needs to act on it**.

That narrowness is a strength. When every artifact tries to be the complete history, the result becomes unreadable and overexposed. A receipt should be small enough to share, precise enough to verify, honest enough to show uncertainty, and connected enough to support deeper investigation.

The best receipt does not ask a person to trust the agent’s explanation. It gives them a clear answer to what changed, a path to the evidence, a record of authority, and a way to challenge the outcome. That is a practical foundation for trust—not because the receipt makes automation infallible, but because it makes the boundary between action and accountability visible.

## References

[1]: https://microsoft.github.io/ai-agents-for-beginners/18-securing-ai-agents/ "Microsoft — Securing AI Agents with Cryptographic Receipts"
[2]: https://arxiv.org/abs/2512.17259 "Abhivansh Gupta — Verifiability-First Agents: Provable Observability and Lightweight Audit Agents for Controlling Autonomous LLM Systems"
