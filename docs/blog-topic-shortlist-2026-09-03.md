# Blog topic shortlist — 2026-09-03

## Audit summary

The current folio contains 47 Markdown entries, mostly paired EN/VI translations, covering agent memory lifecycle, context engineering, prompt injection, MCP/tool poisoning, identity and delegation, policy-as-code, evals, release experiments, SLOs, FinOps, observability, temporal RAG, multimodal RAG, browser agents, voice interruption, durable execution, compensation transactions, provider failover, semantic diffs, chaos engineering, and event-driven systems. The latest published pair is **Semantic Diffs for AI Agents** on 2026-09-01; the previous pair is **Chaos Engineering for AI Agents** on 2026-08-31.

A topic is treated as “not duplicated” only when its core problem, threat boundary, and primary engineering artifact are materially different from existing posts. Topics that merely rename prompt injection, generic RAG, generic observability, or generic multi-agent orchestration were rejected.

## Ten candidate topics

| # | Proposed topic | Distinction from existing posts | Reader value | Potential |
|---:|---|---|---|---:|
| 1 | **Memory của AI Agent cũng là Attack Surface: Poisoning, Quarantine và Safe Recall** / *Your AI Agent’s Memory Is an Attack Surface* | Focuses on the boundary from untrusted memory writes to trusted recall; unlike memory lifecycle, context firewall, or prompt injection posts, it gives a dedicated threat model and quarantine design. | High: persistent memory makes one bad write durable across sessions. | **9.7/10** |
| 2 | **Agent Checkpoint Forensics: Reconstructing Why an Autonomous Workflow Changed Its Mind** | Forensic reconstruction of state transitions, not general decision traces or durable execution. | High for incident responders and platform teams. | 9.1/10 |
| 3 | **AI Agent Data Retention: TTL, Legal Hold và Purpose Limitation cho Memory** | Privacy/retention policy for agent memory, separated from deletion guarantees and memory lifecycle mechanics. | High for enterprise governance. | 8.8/10 |
| 4 | **Capability Leasing: Cấp quyền Tool Có Thời Hạn Cho AI Agent** | Expiring capability tokens and lease renewal as a narrower authorization primitive than identity/delegation and policy-as-code. | High for autonomous actions with narrow blast radius. | 8.7/10 |
| 5 | **Agent Workload Identity Across Async Boundaries: Trace Context, Queue và Human Handoff** | Identity propagation across queues and handoffs, not identity basics or event-driven timeouts. | High for distributed agent platforms. | 8.6/10 |
| 6 | **RAG Corpus Change Management: Detecting Silent Knowledge Regressions Before Release** | Corpus/version regression testing, distinct from RAG retrieval design, temporal RAG, and eval-driven rollout. | High for teams whose source documents change daily. | 8.6/10 |
| 7 | **AI Agent Rate Limits Are Not Enough: Fairness Budgets for Tool Calls** | Per-capability fairness and starvation prevention, extending but not duplicating admission control/backpressure. | High for multi-tenant systems. | 8.4/10 |
| 8 | **Synthetic PII for Agent Testing: Realistic Data Without Copying Production Secrets** | Privacy-preserving test data for agent/eval pipelines, distinct from synthetic users and context firewall. | High and practical for regulated teams. | 8.3/10 |
| 9 | **The Human Handoff Packet: Designing Context Transfer Between Agent and Operator** | Information architecture for handoff packets and operator load, not approval gates or voice handoffs. | High for production operations and support. | 8.2/10 |
| 10 | **Agentic Search Result Ranking: Evidence Diversity, Not Just Top-k Similarity** | Retrieval result diversity and evidence portfolio design, distinct from provenance and multimodal/temporal RAG. | High for search-heavy AI products. | 8.1/10 |

## Selection

Selected topic: **Memory của AI Agent cũng là Attack Surface: Playbook chống Poisoning, Quarantine và Recall an toàn** / **Your AI Agent’s Memory Is an Attack Surface: A Practical Playbook for Poisoning, Quarantine, and Safe Recall**.

The topic is timely, technically specific, and strongly aligned with the author’s existing focus on production AI systems and security. It also has a crisp editorial thesis: *a memory write should be treated like a privileged side effect, not like a harmless cache update*. The article will cover a concrete attack path, a write-time quarantine pipeline, retrieval-time trust checks, rollback, testing, and operational metrics without rehashing the existing memory-policy article.

## Random publication date

Chosen randomly from the three-day window including today (2026-09-01, 2026-09-02, 2026-09-03): **2026-09-02**.
