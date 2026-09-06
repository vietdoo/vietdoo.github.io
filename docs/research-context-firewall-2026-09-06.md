# Research notes — Context Firewall — 2026-09-06

## Why this is a timely gap

LangChain's 2026 State of AI Agents reports that observability is already broadly adopted, with 89% of surveyed organizations implementing some form of observability and 62% reporting detailed tracing. The same report says quality remains the biggest production barrier, followed by latency, and that offline evaluation is more common than online evaluation. This supports choosing a topic that is not another tracing explainer: a pre-inference data boundary that improves correctness, privacy, and testability before a prompt reaches a model.

OWASP's State of Agentic AI Security and Governance 2.01 (June 2026) frames agentic AI security as a governance problem involving frameworks, governance models, and regulatory standards. That supports a practical treatment of context as a governed data plane rather than an unexamined string assembled by an orchestrator.

## Working distinction

The proposed post, **The Context Firewall: Redaction, Tokenization, and Data Lineage Before the Prompt**, should stay distinct from Folio's existing prompt-injection posts, observability posts, output provenance posts, and RAG posts. Its center is the boundary before inference: classify sources, minimize fields, transform sensitive values, preserve lineage, enforce tenant and purpose constraints, and emit a testable context manifest.

## Sources

[1]: https://www.langchain.com/state-of-agent-engineering — LangChain, “State of AI Agents,” 2026.
[2]: https://genai.owasp.org/resource/state-of-agentic-ai-security-and-governance/ — OWASP Gen AI Security Project, “State of Agentic AI Security and Governance 2.01,” June 1, 2026.
