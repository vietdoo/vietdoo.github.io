# Research notes — Memory poisoning in LLM agents

Date checked: 2026-09-03.

## Sources verified

1. Dash et al., *From Untrusted Input to Trusted Memory: A Systematic Study of Memory Poisoning Attacks in LLM Agents*, arXiv:2606.04329v1 (2026-06-03): https://arxiv.org/html/2606.04329v1
   - Persistent memory can let a single adversarial write influence later agent behavior.
   - The paper identifies four memory write channels and nine structural vulnerabilities across model capability, system prompt, and agent architecture.
   - It proposes six classes of memory poisoning attacks and MPBench for evaluation.
   - Agents that write/retrieve memory more aggressively are more exploitable.
   - Existing prompt-injection defenses do not fully cover memory poisoning.

2. OWASP Agent Memory Guard: https://owasp.org/www-project-agent-memory-guard/
   - Frames persistent agent memory as mutable runtime state containing goals, user context, conversation history, and permissions.
   - Describes runtime controls: SHA-256 integrity baselines, injection/data-leak/protected-key/rapid-change/size anomaly detection, declarative YAML read/write policies, snapshots, rollback, forensic analysis, and framework middleware.
   - Maps the risk to ASI06: Memory Poisoning in the OWASP Top 10 for Agentic Applications.

## Editorial angle selected

Working title: "Your AI Agent's Memory Is an Attack Surface: A Practical Playbook for Poisoning, Quarantine, and Safe Recall" / "Memory của AI Agent cũng là Attack Surface: Playbook chống Poisoning, Quarantine và Recall an toàn".

Why it is distinct from existing folio content: the repo already covers memory lifecycle, context firewall, prompt injection, tool poisoning, deletion guarantees, and provenance separately; no current post is dedicated to the security boundary between untrusted writes and trusted long-term memory, including quarantine and retrieval-time enforcement.
