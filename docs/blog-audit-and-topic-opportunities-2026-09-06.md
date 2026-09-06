# Folio AI blog audit and topic opportunities — 2026-09-06

## Audit summary

The current Folio archive is unusually strong in production AI-agent engineering. It already covers agent identity and authorization, policy-as-code, prompt injection, MCP security, memory lifecycle and poisoning, observability, incident response, evals, drift, deletion guarantees, multi-tenant isolation, admission control, provider rotation, schema evolution, semantic caching, multimodal RAG, A2A interoperability, model upgrades, FinOps, provenance, agent registries, and user-readable receipts. The newest published topics are the agent registry, memory poisoning, and agent receipts, so those are excluded below.

The clearest unoccupied layer is **the data boundary before inference**. Existing posts discuss what the agent does, how it is traced, and how outputs are evidenced; fewer explain how a system should decide which source fields may enter context, how sensitive values are transformed, how tenant and purpose constraints survive retrieval, and how to make that decision testable. This gap motivates the selected post, **The Context Firewall**.

## Ten non-duplicative opportunities

| Rank | Proposed post | Reader problem solved | Why it fits Folio | Duplication risk | Potential |
|---:|---|---|---|---|---:|
| 1 | **The Context Firewall: Redaction, Tokenization, and Data Lineage Before the Prompt** | Prevent sensitive, stale, cross-tenant, or unjustified fields from entering model context | Adds a pre-inference data plane above existing RAG, provenance, observability, and prompt-injection work | Low | 9.5/10 |
| 2 | **AI Coding Agent Verification: From Patch Generation to Merge Confidence** | Decide whether an AI-generated patch is safe to merge | Extends Cursor guidance into repository invariants, risk-based tests, mutation checks, and review evidence | Low–Medium | 9.1/10 |
| 3 | **Agent Capacity Planning: Turning Task Mix into GPU and Queue Demand** | Forecast concurrency, token demand, tool latency, and capacity reservations | Connects routing, FinOps, queues, and serving without repeating admission control | Low | 8.9/10 |
| 4 | **Evidence Retention for AI Decisions: Keeping Proof Without Keeping Sensitive Payloads** | Reconstruct why a decision happened without retaining raw private data forever | Bridges provenance, privacy, deletion guarantees, and audit reconstruction | Low–Medium | 8.8/10 |
| 5 | **Replayable Agent Sandboxes: Testing Side Effects Without Touching Production** | Test realistic workflows with state snapshots and fake tools | Connects evals to stateful side-effect replay while avoiding generic model-release testing | Medium | 8.7/10 |
| 6 | **Runtime Capability Negotiation for MCP and A2A Agents** | Avoid assuming that every tool or peer supports the same capability set | Protocol-focused follow-up on expiry, downgrade, compatibility, and attestation | Medium | 8.6/10 |
| 7 | **Referential Integrity for AI Agents** | Prevent orphaned actions when an agent changes linked records, permissions, or workflows | A precise database-systems angle distinct from schema evolution and compensation | Low–Medium | 8.5/10 |
| 8 | **Skill Supply-Chain Security for Tool-Using Agents** | Verify provenance, signatures, permissions, and revocation for skills and plugins | Moves beyond prompt-injection framing into the tool-bundle supply chain | Medium | 8.5/10 |
| 9 | **Agentic Feature Flags: Disable Behaviors Without Killing the Agent** | Roll back one tool, autonomy level, or approval path without taking down the whole agent | Practical runtime control distinct from policy-as-code and release experiments | Medium | 8.4/10 |
| 10 | **Verifiable Automation: Choosing Agent Tasks by Proof, Not Hype** | Decide which work is safe to automate based on reversibility, evidence, and recovery | Strategic, decision-oriented complement to Folio's implementation playbooks | Low | 8.3/10 |

## Selection

**Selected post:** *The Context Firewall: Redaction, Tokenization, and Data Lineage Before the Prompt*.

This is the strongest next post because it occupies a clear architectural boundary that is not owned by any existing Folio article. It is also useful to both builders and reviewers: engineers can implement a context manifest and policy gate, while security and product teams can ask what data entered the prompt, for what purpose, under which tenant, and after which transformations. The post will avoid generic privacy advice and instead provide a concrete pipeline, schemas, failure modes, tests, and rollout checklist.

The publication date is randomly selected from September 4, 5, and 6, 2026: **2026-09-05**.

## References

[1]: https://www.langchain.com/state-of-agent-engineering — LangChain, “State of AI Agents,” 2026.
[2]: https://genai.owasp.org/resource/state-of-agentic-ai-security-and-governance/ — OWASP Gen AI Security Project, “State of Agentic AI Security and Governance 2.01,” June 1, 2026.
