# Research notes — Agent receipts — 2026-09-05

## Findings

Microsoft's AI Agents for Beginners lesson defines a receipt as a JSON object recording what an agent did and signed with a digital signature. The example includes agent ID, tool name, hashes of arguments and result, policy ID, timestamp, sequence, previous receipt hash, signature algorithm, signature, and public key. It highlights three useful guarantees: attribution, integrity, and ordering. It also explicitly limits the guarantee: a receipt does not prove that the action was correct or that the policy itself was sound.

The lesson distinguishes a signed receipt from an ordinary log by using canonical JSON encoding, Ed25519 signatures, and hash chaining. These implementation details support the proposed article's thesis that a user-facing receipt should be a compact proof of an outcome, not a copy of raw telemetry.

The arXiv paper *Verifiability-First Agents* argues for runtime attestations, lightweight audit agents, and challenge-response protocols for high-risk operations. Its core framing is that production assurance should measure how quickly and reliably misalignment can be detected and remediated, not merely how likely misalignment is. This supports treating receipts as one layer in a broader control plane rather than as a magic explainability feature.

## Sources

[1]: https://microsoft.github.io/ai-agents-for-beginners/18-securing-ai-agents/ — Microsoft, “Securing AI Agents with Cryptographic Receipts.”
[2]: https://arxiv.org/abs/2512.17259 — Abhivansh Gupta, “Verifiability-First Agents: Provable Observability and Lightweight Audit Agents for Controlling Autonomous LLM Systems.”
