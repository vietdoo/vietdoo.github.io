---
title: "The Agent Registry: Discovering, Owning, and Quarantining Shadow AI Agents"
description: "A production playbook for building an inventory of AI agents, assigning accountable owners, enforcing runtime scope, and quarantining unsanctioned automation before it becomes an invisible security boundary."
pubDate: 2026-09-02
category: "security"
lang: "en"
translationKey: "ai-agent-registry-shadow-ai"
draft: false
image: "/blog/agent-registry/hero.png"
---

Most organizations know how many human users have access to a production system. Far fewer can answer the same question about their AI agents.

Which agents are running today? Who owns them? Which model, prompt, tool, skill, memory store, and service account does each one use? What data can it reach? When was its permission last reviewed? Which agent is a sanctioned product, which is an experiment, and which is an employee’s private automation quietly operating outside the security team’s view?

Those questions sound like inventory questions. They are actually control questions.

An agent that can read a customer database, open a ticket, send an email, execute a shell command, or call another agent is not merely a prompt attached to an API. It is a non-human actor with identity, authority, dependencies, and a lifecycle. If the organization cannot identify that actor, it cannot reliably apply least privilege, investigate an incident, or prove that a sensitive action was authorized.

> **Working definition:** an agent registry is an authoritative, continuously reconciled record of the AI agents that exist in an organization, the people accountable for them, the capabilities they possess, the data and systems they touch, and the lifecycle state in which they are allowed to operate.

This is the fleet-level layer that sits above individual agent security. Existing controls such as policy-as-code, observability, memory protection, and incident response remain necessary. The registry makes those controls addressable: they need to know which agent they are protecting, who can change its policy, and whether it is still allowed to run.

![A dark control-plane dashboard maps sanctioned and unsanctioned AI agents across an enterprise](/blog/agent-registry/hero.png)

*The registry is not a catalog page. It is the control plane for non-human actors.*

## Why “we have an agent inventory” is often not enough

Many teams already have a spreadsheet, a CMDB entry, a cloud project, or a list of API keys. None of those is automatically an agent registry.

A useful registry must connect an agent’s **declared identity** to its **observed behavior**. A team may register a support agent as “read-only CRM assistant,” while telemetry shows that it also calls a ticket mutation API through a shared integration. A developer may register a prototype under a temporary name, while its service account continues to run after the experiment ends. A low-code builder may create several copies of an agent, each with a different connector scope, without any central record of ownership.

The difference is reconciliation. A registry that only accepts declarations becomes a compliance form. A registry that compares declarations with runtime evidence becomes a security control.

Microsoft’s 2026 Cyber Pulse discussion describes the organizational blind spot in similarly practical terms: leaders need to know what agents exist, who owns them, what systems and data they touch, and which ones are sanctioned or shadow agents [1]. LangChain’s 2026 survey also shows why this matters now: 57.3% of respondents reported agents in production, while quality remained the largest barrier and observability had become widespread [2]. Visibility is no longer a future concern; it is part of the production surface.

## The four records every agent needs

A registry should not begin with a giant form. Start with four records that answer different questions.

| Record | Question it answers | Examples |
|---|---|---|
| **Identity** | What actor is this? | Stable agent ID, display name, environment, version, owner |
| **Capability** | What may it do? | Tools, skills, model providers, network destinations, autonomy level |
| **Evidence** | What does it actually do? | Observed calls, data classes, destinations, action volume, last seen |
| **Accountability** | Who is responsible for it? | Business owner, technical owner, security reviewer, escalation path |

Keeping these records conceptually separate prevents a common mistake: treating a developer’s declaration as proof of runtime behavior. The declaration is still useful. It gives the system something to compare against.

A minimal registry entry can look like this:

```json
{
  "agent_id": "agt_support_triage_prod",
  "display_name": "Support triage",
  "environment": "production",
  "version": "2026.09.02.3",
  "status": "approved",
  "business_owner": "customer-operations",
  "technical_owner": "support-platform",
  "security_reviewer": "security-oncall",
  "model": {
    "provider": "provider-a",
    "model": "reasoning-large",
    "pinned_revision": "2026-08-18"
  },
  "capabilities": {
    "tools": ["crm.read", "ticket.create"],
    "network_egress": ["crm.internal", "tickets.internal"],
    "autonomy": "draft-and-request-approval"
  },
  "data_classes": ["customer-contact", "support-history"],
  "last_attested_at": "2026-09-02T09:30:00Z",
  "expires_at": "2026-12-02T00:00:00Z"
}
```

The important fields are not the model name or the friendly description. They are the stable identity, the environment, the capability boundary, the owners, the last attestation, and the expiry. Without them, a record becomes stale documentation instead of an enforceable object.

## Discovery: finding agents that were never registered

The first registry rollout will expose an uncomfortable truth: agents rarely appear in one place.

A production discovery pass should combine several signals. Scan deployment manifests, serverless functions, model gateway logs, API keys, OAuth applications, MCP or tool servers, queue consumers, scheduled jobs, low-code platforms, browser automation runners, and repositories containing agent configuration. Then normalize those signals into candidate actors.

Do not treat every model call as a separate agent. A single application may make many model calls. Conversely, a single agent may move across several services. The goal is to identify a durable actor with a purpose, an authority boundary, and a repeatable execution path.

![Multiple telemetry sources converge into one agent registry with confidence and ownership states](/blog/agent-registry/discovery-map.png)

*Discovery is a correlation problem: declarations, credentials, deployments, and observed actions must point to the same actor.*

A useful candidate record includes a confidence level and a reason for discovery:

```text
candidate: unknown-agent-7f31
signals:
  - model_gateway: 18,402 calls in the last 7 days
  - oauth_app: support-export-client
  - tool_server: crm.read, ticket.create
  - repository: github.com/acme/support-automation
confidence: high
owner_hint: support-platform
next_action: require_attestation
```

The registry should never silently turn a candidate into an approved agent. Discovery creates a review queue. Approval is a decision with an owner, a scope, and an expiry.

## Shadow AI is a lifecycle problem, not only a policy violation

“Shadow AI” is often discussed as if it means an employee used an unapproved chatbot. That is one case, but the more operationally important case is an automation that keeps acting without a clear owner.

A shadow agent may begin as a harmless prototype. It may use a personal API key, a copied prompt, or a connector created for a one-day experiment. Over time, other workflows begin to depend on it. Its permissions expand because a quick fix was easier than designing a new integration. Nobody knows who can approve a change, and nobody knows whether it should be retired.

The registry should therefore record **how an agent entered the organization**, not just whether it is currently approved. Useful provenance includes the deployment pipeline, creator, repository, connector installer, first-seen timestamp, and the event that promoted it from experiment to production.

This turns a vague policy problem into a tractable lifecycle problem:

1. A new actor is discovered.
2. Its owner and purpose are identified.
3. Its capabilities are reduced to the minimum needed.
4. It is approved for a bounded environment and time window.
5. Its observed behavior is reconciled with its declaration.
6. It is renewed, restricted, quarantined, or retired.

An agent without a renewal decision should not live forever by default.

## Approval should be about capability, not personality

A registry review should not ask whether the agent “seems safe.” It should ask what the agent can do, what evidence supports that capability, and what happens when it fails.

| Review dimension | Strong question | Weak question |
|---|---|---|
| Purpose | What business outcome does this agent own? | Is this a useful assistant? |
| Authority | Which exact actions may it perform? | Is it low risk? |
| Data | Which data classes can it read or change? | Does it use company data? |
| Reversibility | Can each side effect be undone or reconciled? | Does it have a kill switch? |
| Evidence | What logs and traces prove its behavior? | Does it have monitoring? |
| Ownership | Who can fix or retire it this week? | Which team built it? |
| Expiry | When must the approval be revisited? | Is the approval permanent? |

The review should produce an explicit capability contract. For example, “may draft a ticket and request approval” is materially different from “may close a ticket and notify the customer.” An autonomy label without an action-level contract is too vague to enforce.

MLflow’s production guidance makes a related point: runtime governance belongs beneath the model layer, deterministic controls should prevent disallowed actions before they reach the wire, and skill or plugin boundaries deserve special attention [3]. The registry is where those runtime controls acquire a stable subject.

## Quarantine: the middle state that most inventories lack

A binary status—approved or blocked—is too crude for discovery. New agents need a place where they can be inspected without receiving production authority.

A practical lifecycle has six states:

```text
observed -> candidate -> attested -> approved -> restricted -> retired
                    \-> quarantined -/
```

**Observed** means telemetry has found an actor but no owner has accepted responsibility. **Candidate** means the actor has enough information for review. **Attested** means an owner has declared purpose, capabilities, and dependencies. **Approved** means policy has granted a bounded runtime scope. **Restricted** means the agent can run only in a reduced mode while a problem is investigated. **Quarantined** means execution or egress is blocked while evidence is preserved. **Retired** means the agent is no longer allowed to run, though its registry and audit records remain.

![The lifecycle of an AI agent moves from observation through approval, restriction, quarantine, and retirement](/blog/agent-registry/lifecycle-state-machine.png)

*Lifecycle states turn an inventory into an operational decision system.*

![A quarantine funnel blocks unowned agents while preserving evidence for review and recovery](/blog/agent-registry/quarantine-funnel.png)

*Quarantine should reduce authority without destroying the evidence needed to understand why the agent appeared.*

Quarantine is especially useful when discovery confidence is high but intent is unclear. It is also useful when observed behavior exceeds the declared contract. For example, an agent registered as read-only should enter restricted or quarantine state if it attempts a write, even if the write is rejected by a downstream API.

The quarantine action itself must be deterministic. A language model can summarize why an agent looks suspicious, but it should not be the sole authority deciding whether a discovered service account may continue running.

## Reconciliation: compare declared and observed behavior

The registry becomes valuable when it can answer “what changed?” without asking an engineer to inspect five systems manually.

At a minimum, reconcile these pairs:

| Declared | Observed |
|---|---|
| Registered tools | Actual tool calls |
| Approved data classes | Fields or datasets touched |
| Allowed destinations | Network and API destinations |
| Declared owner | Repository, deployment, and on-call signals |
| Pinned model revision | Model gateway usage |
| Approved autonomy | Human approvals, mutations, and external messages |
| Expected schedule | Actual invocation frequency |

A reconciliation result should be a semantic finding, not a noisy log diff:

```json
{
  "agent_id": "agt_support_triage_prod",
  "finding": "undeclared_capability",
  "severity": "high",
  "declared": "ticket.create",
  "observed": "customer_email.send",
  "first_seen": "2026-09-02T11:07:14Z",
  "recommended_state": "restricted",
  "requires": ["owner_review", "capability_contract_update"]
}
```

The system should suppress harmless implementation details but surface changes that alter authority, data exposure, cost, or user impact. A new model patch may deserve an attestation. A new outbound email destination deserves a stronger gate.

## Ownership must survive team changes

An owner field that points only to a person is fragile. People change roles, leave teams, or go on call rotation. An owner field that points only to a team is too vague when an incident needs a decision in minutes.

Use layered accountability:

| Layer | Responsibility |
|---|---|
| Business owner | Defines purpose, acceptable outcomes, and user impact |
| Technical owner | Maintains code, prompts, tools, dependencies, and runbooks |
| Security reviewer | Approves risk controls, data scope, and exception handling |
| Runtime operator | Responds to alerts, quarantine events, and kill-switch actions |

Each layer should have a durable group identity plus a current escalation route. The registry should reject an approval if the technical owner has no runbook or if the escalation route resolves to a deactivated account.

Ownership is not a contact card. It is a prerequisite for continued operation.

## Metrics that reveal registry health

Counting registered agents is a vanity metric. A healthy registry measures coverage and freshness.

Track the percentage of observed actors with a stable ID, the percentage with a current owner, the percentage whose declared capabilities match observed behavior, the median age of an unreviewed candidate, the number of agents with expired approvals still making calls, and the time between first discovery and quarantine.

Also track **negative space**: agents that disappear from telemetry without a retirement event, credentials that remain active after an agent is retired, and agents that continue to receive data after their declared purpose has ended.

| Metric | What it tells you |
|---|---|
| Discovery-to-attestation time | How quickly the organization can turn an unknown actor into an accountable one |
| Unowned runtime minutes | How long agents operate without a responsible owner |
| Contract drift rate | How often reality diverges from approval |
| Expired approval calls | Whether lifecycle controls are actually enforced |
| Quarantine recovery time | Whether the organization can investigate without improvising |
| Retirement residue | Whether credentials, schedules, and data paths are fully removed |

These metrics should be sliced by environment and data sensitivity. A small number of unowned development agents is a different risk from one unowned production agent with payment access.

## A rollout that does not require a perfect platform

You can start with a registry table and a daily reconciliation job. The first version does not need to replace every security product.

**Phase one: establish identity.** Create a stable ID for every known agent, record its deployment source, and map service accounts, repositories, schedules, and model gateway keys to that ID.

**Phase two: establish accountability.** Require a business owner, technical owner, purpose, data classes, tools, environment, and expiry for every agent that can access non-public data.

**Phase three: establish evidence.** Compare declarations with model calls, tool calls, network destinations, mutation events, and human approval events. Preserve the raw evidence so a later reviewer can reproduce the finding.

**Phase four: enforce quarantine.** Route unknown or drifting actors into a reduced mode. Block new high-impact actions, preserve evidence, and notify the owner candidates. Do not destroy the actor before understanding its dependencies.

**Phase five: make renewal real.** Expired approvals should cause restriction or quarantine, not merely an overdue dashboard badge. Renewal should review changes since the previous attestation instead of asking the owner to retype the entire form.

A registry succeeds when the safe path is easier than the invisible path. If registering an agent takes days while copying an API key takes seconds, the organization will create shadow systems faster than governance can discover them.

## What the registry must not become

The registry should not become a surveillance dashboard that collects every prompt forever. It should not become a second CMDB with no enforcement path. It should not require a human to approve every low-risk model call. It should not declare an agent safe because its description sounds reasonable.

Collect the minimum evidence needed for accountability, security, and debugging. Separate sensitive payloads from operational metadata. Apply retention and access controls to registry evidence. Let low-risk, reversible operations use policy-driven automation, while high-impact actions require stronger review.

The goal is not to slow down every agent. It is to make the boundary visible enough that speed does not depend on ignorance.

## The fleet-level boundary

An individual agent can be well designed and still become an organizational risk when nobody knows it exists. A policy can be correct and still fail when it is attached to an identity that has expired. An incident runbook can be excellent and still be useless when responders cannot tell which service account belongs to the affected agent.

The agent registry closes that gap. It gives non-human actors a stable identity, an accountable owner, a bounded capability contract, an observed-behavior record, and a lifecycle that can end.

> **A mature AI program does not only ask whether an agent can act safely. It can also answer which agents are acting, on whose authority, with what evidence, and how to stop them without losing the truth.**

## References

[1]: https://www.microsoft.com/en-us/security/blog/2026/02/10/80-of-fortune-500-use-active-ai-agents-observability-governance-and-security-shape-the-new-frontier/ "Microsoft Security — Active AI Agents, Observability, Governance, and Security"
[2]: https://www.langchain.com/state-of-agent-engineering "LangChain — State of Agent Engineering"
[3]: https://mlflow.org/articles/building-production-ready-ai-agents-in-2026/ "MLflow — Building Production-Ready AI Agents in 2026"
