---
title: "AI Code Supply Chains: Provenance, SBOMs, and Policy Gates for Agent-Generated Changes"
description: "AI coding agents can accelerate delivery without making the software supply chain trustworthy by default. This practical guide designs a chain-of-custody from agent change to signed build, SBOM, and release policy."
pubDate: 2026-04-09
category: "security"
image: "/blog/ai-code-supply-chain-policy-gates/ai-code-supply-chain-cover.webp"
lang: "en"
translationKey: "ai-code-supply-chain-policy-gates"
draft: false
---

![A hand-drawn software supply chain showing an AI coding agent, source commit, SBOM inspection, signed provenance, and a production release gate](/blog/ai-code-supply-chain-policy-gates/ai-code-supply-chain-cover.webp)

AI coding agents have changed the shape of a software change. A developer can describe a feature, let an agent inspect a repository, ask it to modify several files, run tests, and open a pull request before the coffee gets cold. The productivity gain is real. The security assumption is not.

The important question is no longer only, “Does this diff look correct?” It is also, “Can we explain where this change came from, what it depended on, which build produced the artifact, and why the release system allowed it to ship?”

> **The thesis:** Do not treat an AI-generated change as trusted because a human glanced at the final diff. Treat it as a supply-chain event that needs a verifiable path from agent activity to source, dependencies, build artifact, and release decision.

This is not an argument for banning coding agents or recording every private prompt forever. It is a design for keeping useful evidence without turning the engineering workflow into surveillance. The goal is to establish enough chain-of-custody that a team can answer an incident question months later: which change entered the system, through which agent or automation, with which inputs, and under which controls?

## The agent is a new contributor, not a new trust boundary

A coding agent is often described as an assistant, but operationally it behaves more like a contributor with unusually high throughput. It can read source files, infer conventions, select dependencies, invoke tools, execute tests, and propose changes across boundaries that would normally be separated by human attention.

That does not mean the agent deserves a human identity. It means the system needs to record the contribution context and constrain the permissions around it. A useful model separates three questions that are frequently collapsed into one:

| Question                 | Evidence to preserve                                                   | What it does not prove                     |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------ |
| **What changed?**        | Diff, commit, review decision, test results                            | That the code is safe in every environment |
| **How was it built?**    | Builder identity, inputs, timestamps, dependency lock, artifact digest | That the builder itself was uncompromised  |
| **Why was it released?** | Policy evaluation, approvals, exceptions, risk thresholds              | That the business decision was wise        |

SLSA defines provenance as verifiable information about where, when, and how a software artifact was produced, with the purpose of allowing consumers to verify expectations and, where useful, rebuild the artifact. That concept maps naturally to agent-generated changes, but with an important boundary: build provenance can show how an artifact was produced; it does not certify that the model’s reasoning was correct.

The distinction is healthy. It prevents a signed artifact from becoming a magical “AI approved” stamp. A signature proves control of a signing key and integrity of the signed statement. It does not prove that a dependency is benign, a generated function has no logic flaw, or a human reviewer understood the risk.

## The chain-of-custody model

The practical supply chain is a sequence of evidence-producing transitions. Each transition should either create a durable record or deliberately state why no record is retained. The exact tools can vary; the contract should not.

![A hand-drawn chain-of-custody map from AI agent change through reviewed diff, SBOM and scans, signed build, and release gate](/blog/ai-code-supply-chain-policy-gates/supply-chain-map.webp)

A minimal chain looks like this:

```text
agent session or task
        ↓
reviewable diff + commit metadata
        ↓
locked dependencies + SBOM + security scans
        ↓
reproducible or controlled build
        ↓
attestation binding source, builder, inputs, and artifact digest
        ↓
policy decision and release record
```

The first transition is the one most teams omit. An agent can create a commit that looks indistinguishable from a manually written commit. That is convenient until an incident responder needs to find all changes generated under a compromised instruction, a vulnerable tool version, or an unsafe repository context.

The record does not need to contain the full prompt. A contribution envelope can capture a stable task identifier, agent or client class, tool configuration version, repository and base revision, changed files, model provider if policy permits, and a hash of any sensitive session record held under a separate retention policy.

```ts
type AgentContribution = {
  contributionId: string;
  repository: string;
  baseRevision: string;
  resultingCommit: string;
  agentClass: "coding-agent" | "human" | "automation";
  clientVersion?: string;
  toolPolicyVersion: string;
  changedPaths: string[];
  sessionEvidenceHash?: string;
  createdAt: string;
};
```

This is deliberately modest. It makes the origin queryable without pretending that a prompt transcript is a complete explanation of the resulting code. If the team needs deeper forensics, it can retain the session evidence in an access-controlled store and link it by hash rather than copying sensitive content into Git history.

## SBOM is the dependency view, not the whole story

A software bill of materials answers, “What is inside this artifact?” It is essential for vulnerability response, license review, and dependency inventory. It does not answer, “Why did this code change exist?” or “Which policy allowed it to reach production?”

For an AI-generated change, the SBOM should be created from the build output or the exact dependency lock used to produce it. Generating an SBOM from an unbuilt working tree can create a mismatch between what was inspected and what was shipped. The artifact digest is the join key that keeps the evidence connected.

![A hand-drawn evidence card with source, build, artifact, commit SHA, agent change ID, dependency lock, builder, timestamp, artifact digest, and an SBOM document](/blog/ai-code-supply-chain-policy-gates/provenance-sbom-evidence.webp)

A useful evidence envelope combines source and artifact views:

```json
{
  "subject": {
    "name": "registry.example.com/payments-api",
    "digest": "sha256:..."
  },
  "source": {
    "repository": "payments-api",
    "commit": "7f3c9ad",
    "agentContributionId": "agt_01J..."
  },
  "build": {
    "builder": "ci-runner-prod-17",
    "workflow": "release.yml@v4",
    "sourceSnapshot": "sha256:...",
    "dependencyLock": "sha256:..."
  },
  "materials": ["sbom:sha256:...", "container-base:sha256:..."]
}
```

SLSA’s provenance model is useful here because it gives teams a vocabulary for source materials, build definition, builder, metadata, and the produced subject. The AI-specific fields should extend the evidence envelope carefully rather than replace standard build metadata.

## Policy gates turn evidence into a release decision

Evidence is valuable only when a system can act on it. A policy gate is the point at which the release process evaluates evidence and chooses to promote, hold, or reject an artifact.

The gate should be deterministic where possible. “The agent sounded confident” is not a control. “The artifact has a valid signature, its provenance points to an allowed builder, no critical vulnerability exceeds the exception policy, the required review exists, and the SBOM is attached” is a control that can be tested.

![A hand-drawn release pipeline with DIFF, TEST, ATTEST, and PROMOTE stations, including a BLOCK barrier for failed checks](/blog/ai-code-supply-chain-policy-gates/policy-gate-pipeline.webp)

One possible policy shape is:

```yaml
policy: production-release-v1
subject:
  requireArtifactDigest: true
source:
  requireReview: true
  requireContributionEnvelope: true
build:
  allowedBuilders:
    - ci://release-runner
  requireSignedProvenance: true
  requireDependencyLock: true
security:
  blockOn:
    - secret-found
    - critical-vulnerability
    - unsigned-artifact
  allowHighSeverityOnlyWith:
    - security-owner-approval
  requireSbom: true
exceptions:
  maxDurationHours: 72
  requireTicket: true
```

This is not a complete security program. It is a release contract. The contract should make failure visible, produce a decision record, and distinguish a blocked release from an approved exception. A policy engine that silently ignores missing evidence is worse than a simpler engine that blocks loudly.

## Separate pre-commit checks from system-of-record controls

Agent-side checks are useful because they shorten feedback loops. GitHub’s documentation describes secret scanning through its remote MCP server as a way to scan current changes before secrets reach a repository. It also makes a crucial limitation explicit: MCP findings are ephemeral and do not become persistent GitHub alerts; they are a pre-commit safety check, not a system of record.

That distinction should appear in the architecture. A developer or agent may run a fast local or interactive scan, but the repository and CI must enforce the durable gate. Otherwise a skipped tool, a different IDE, or a changed agent configuration creates an invisible path around the control.

| Control layer                | Best use                                         | Failure mode if treated as sufficient                     |
| ---------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| Agent or IDE scan            | Fast feedback while editing                      | It can be skipped, misconfigured, or ephemeral            |
| Pull request checks          | Review, tests, SAST, dependency checks           | A privileged merge path may bypass them                   |
| Build attestation            | Bind source, builder, materials, and artifact    | It does not prove the source logic is correct             |
| Registry or deploy admission | Enforce signatures, provenance, SBOM, and policy | A weak policy can turn the gate into theatre              |
| Incident archive             | Reconstruct decisions and scope                  | Retaining everything can create privacy and cost problems |

GitHub also documents that its AI coding-agent security workflow can catch secrets, vulnerabilities, and insecure dependencies from agent mode and MCP-compatible tools. The practical lesson is not to outsource the whole chain to one platform. It is to layer interactive assistance with repository-enforced and deployment-enforced controls.

## What should be recorded about the AI contribution?

The answer depends on risk and retention. A low-risk documentation change may need only an origin label and normal review. A payment authorization change, authentication rule, or infrastructure policy deserves stronger evidence and possibly a mandatory human owner.

A sensible minimum record includes the contribution ID, base revision, resulting commit, changed paths, agent/client class, tool policy version, and timestamps. A higher-assurance record may add the model family, configuration hash, enabled tools, external retrieval references, test environment, and a protected session-evidence hash. The system should avoid storing secrets, raw customer data, or full prompts in ordinary commit metadata.

NIST’s SSDF project now points to SP 800-218A, a community profile that adds AI-specific practices, tasks, recommendations, and considerations to the secure software development lifecycle. That is a useful framing: AI-generated code should be integrated into secure development outcomes, not managed by an isolated “AI checklist” disconnected from ordinary engineering controls.

## A rollout that does not stop the team

A mature supply chain is not installed in one dramatic migration. Start with evidence that answers the highest-value incident questions, then add enforcement when the signal is trustworthy.

| Phase            | Add                                                                     | Measure before advancing                                                    |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **1. Observe**   | Contribution ID, commit labels, build metadata, artifact digest         | Can the team trace a release back to source and builder?                    |
| **2. Inventory** | SBOM from the shipped artifact, dependency lock, scan results           | Does the SBOM match the artifact and remain available after release?        |
| **3. Attest**    | Signed provenance and immutable evidence storage                        | Can an independent verifier validate the subject and builder?               |
| **4. Enforce**   | Policy gates for signatures, critical findings, reviews, and exceptions | Are false positives and bypasses visible and owned?                         |
| **5. Optimize**  | Risk tiers, selective retention, faster feedback, automated remediation | Does the control reduce response time without creating unsafe shadow paths? |

The first metric should not be “percentage of code written by AI.” That number encourages teams to optimize for volume and can create the wrong incentives. Better metrics are provenance coverage, percentage of releases with an attached SBOM, time to identify the source of a vulnerable artifact, gate bypass rate, and mean time to revoke or quarantine an artifact.

## Common designs that look safe but are not

**“A human reviewed the diff.”** Review is necessary, but a diff is only one view. It may not reveal a dependency selected by the agent, a build-time script, a transitive package, or the fact that the artifact was produced by an untrusted runner.

**“The commit is signed, so the code is trusted.”** A commit signature can authenticate a key holder. It does not prove that the source was built as expected or that the resulting artifact corresponds to the reviewed commit. Source signing, build provenance, artifact signing, and policy evaluation answer different questions.

**“The SBOM is attached to the repository.”** An SBOM tied to a branch or working tree can drift from the deployed image. Bind it to the artifact digest and preserve the exact generation input.

**“The agent ran the security scan.”** Interactive scans shorten the path to feedback. They should not be the only gate. GitHub’s own documentation distinguishes ephemeral MCP scan results from persistent repository security records.

**“We will keep every prompt for future audits.”** Full transcripts can contain credentials, customer data, proprietary code, or unrelated personal information. Use a tiered retention design: stable metadata by default, protected evidence only for higher-risk tasks, and explicit deletion and access rules.

## The practical definition of trust

The point of a supply-chain design is not to prove that AI is safe. It is to make uncertainty inspectable. When an agent-generated change reaches production, the team should be able to identify the source revision, the contribution context, the dependency set, the builder, the artifact digest, the policy result, and any exception that altered the normal path.

That evidence gives engineers options. They can compare releases, quarantine an artifact, rotate a dependency, identify affected changes, reproduce a build, or explain a decision to a security reviewer. Without it, an AI-generated change is just another opaque input moving through a fast pipeline.

The best outcome is not a slower process with more paperwork. It is a system in which low-risk changes move quickly because the evidence is automated, while high-risk changes encounter deliberate friction before they can become production incidents.

> **A coding agent can be fast without becoming invisible. The supply chain is trustworthy when every important transition leaves evidence that the next control can verify.**

## References

[1]: https://www.langchain.com/state-of-agent-engineering "LangChain — State of Agent Engineering"
[2]: https://cloud.google.com/resources/content/ai-agent-trends-2026 "Google Cloud — AI agent trends 2026 report"
[3]: https://slsa.dev/spec/v1.2/build-provenance "SLSA v1.2 — Build: Provenance"
[4]: https://csrc.nist.gov/projects/ssdf "NIST CSRC — Secure Software Development Framework"
[5]: https://docs.github.com/en/code-security/how-tos/use-ghas-with-ai-coding-agents "GitHub Docs — Use GitHub Advanced Security with AI coding agents"
[6]: https://docs.github.com/en/code-security/how-tos/use-ghas-with-ai-coding-agents/scan-for-secrets-with-github-mcp-server "GitHub Docs — Scanning for secrets with the GitHub MCP server"
