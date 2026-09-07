# Blog Topic Review — 2026-09-07

## Scope

The Folio repository was reviewed on 2026-09-07. The inventory contained 134 blog entries, including English/Vietnamese pairs and recent production-AI articles covering evaluation, observability, security, memory poisoning, drift, RAG, browser agents, voice agents, failover, SLOs, idempotency, and event-driven systems. Candidate topics were rejected when their core thesis materially duplicated an existing post, even when the title or framework changed.

## Ten candidate topics

| Rank | Candidate | Score | Distinctiveness decision | Editorial note |
|---:|---|---:|---|---|
| 1 | LLM-as-a-Judge Calibration in Production | 8.5/10 | **Recommend** | Focus on human agreement, judge bias, drift, stratified sampling, abstention, and when to recalibrate. Distinct from the existing eval/regression/SLO articles because the judge itself is the production component under test. |
| 2 | Durable Execution for Long-Running AI Agents | 8.4/10 | Recommend, but adjacent | Strong runtime topic. Keep it provider-neutral and avoid repeating idempotency, compensation, and time-semantics posts. |
| 3 | Authorization Before Retrieval for Multi-Tenant RAG | 8.4/10 | Recommend | Clear security boundary: unauthorized chunks must never reach the model. Different from general tenant isolation and provenance articles. |
| 4 | Multimodal Document Change Detection | 8.4/10 | Recommend | Compare visual, structural, and semantic document diffs for production ingestion and re-indexing. |
| 5 | Model Artifact Provenance and AI Supply Chain | 8.2/10 | Recommend with narrow scope | Focus on weights, adapters, quantization, attestations, and verified deployment; do not repeat code supply-chain content. |
| 6 | Safe Snapshot and Restore for Stateful Agents | 7.8/10 | Recommend with caution | Center restore correctness and external-world revalidation, not generic memory or durable execution. |
| 7 | Deterministic Replay for Agent Workflows | 7.8/10 | Recommend with caution | Make record/replay the debugging substrate and distinguish it from release experiments and durable execution. |
| 8 | Cost SLO and Budget Admission for Agents | 7.6/10 | Adjacent | Valuable enforcement bridge, but overlaps with existing SLO, admission-control, and FinOps posts. |
| 9 | Exactly-Once Side Effects for Agents | 7.4/10 | Companion only | Strong thesis but overlaps directly with idempotency and compensation articles. |
| 10 | Capability Discovery and Negotiation between Agents | 5.8/10 | Reject as standalone | Directly overlaps the existing A2A interoperability article; update that article instead. |

## Selected article

**English:** LLM-as-a-Judge Calibration in Production: Human Agreement, Drift, and the Needs-Review Boundary  
**Vietnamese:** Hiệu chỉnh LLM-as-a-Judge trong Production: Human Agreement, Drift và ranh giới Needs Review  
**Translation key:** `llm-judge-calibration-production`  
**Publication date:** 2026-09-06 (randomly selected from 2026-09-05, 2026-09-06, and 2026-09-07, inclusive)

The article is the strongest choice because it extends Folio's evaluation cluster without duplicating it. Existing posts explain how to build regression suites, SLOs, and release gates; this article asks whether the evaluator making those decisions is calibrated, stable, and allowed to abstain. It also offers a human-like engineering narrative: a green dashboard can still hide a judge that systematically rewards verbosity, prefers one answer position, or silently drifts after a model or rubric change.

## Research anchors

- [OpenAI Evals](https://github.com/openai/evals) — evaluation framework and examples.
- [LangSmith evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts) — comparative and trajectory evaluation terminology.
- [Arize LLM-as-a-Judge](https://arize.com/llm-as-a-judge/) — practical judge design and failure modes.
- [G-Eval](https://arxiv.org/abs/2303.16634) — rubric-based model evaluation.
- [Position bias in LLM judges](https://aclanthology.org/2025.findings-ijcnlp.72/) — evidence that answer order can affect judgement.

The article intentionally avoids presenting any one vendor or judge model as an oracle. All examples use synthetic support-agent traces.
