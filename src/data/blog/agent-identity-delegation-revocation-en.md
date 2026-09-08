---
title: "AI Agent Identity Is Not a User ID: Designing Delegation, Scope, and Revocation"
description: "A production guide to separating user, client, and AI agent identities, enforcing delegated authority with scoped tokens, preserving attribution across services, and revoking access safely."
pubDate: 2026-06-18
category: "security"
image: "/blog/agent-identity-delegation-revocation/hero-playwright.webp"
lang: "en"
translationKey: "agent-identity-delegation-revocation"
draft: false
---

![An identity triangle connecting user, client, AI agent, authorization server, and protected resource](/blog/agent-identity-delegation-revocation/hero-playwright.webp)

An AI agent should not become a user ID simply because a user clicked “Run.” That shortcut is attractive: the application already has a session, the downstream API already accepts a bearer token, and the first demo works without a new identity model. The trouble starts when the agent is allowed to interpret natural language, call several tools, and continue working after the user has stopped watching.

A senior engineer may be allowed to delete a production replica. A support agent may be allowed to read one customer’s ticket history. A finance analyst may be allowed to export a report but not to change a bank account. Those human permissions describe what the person can do. They do not automatically describe what a software agent should be able to do on that person’s behalf.

> **Thesis:** An AI agent is a distinct principal. Delegation should transfer only the authority required for the current task, preserve the identity of the person who initiated the work, constrain the agent’s own role, and remain revocable while the run is in progress.

This distinction is becoming an identity and authorization problem rather than a prompt-writing problem. NIST’s NCCoE has explicitly called for work on the identification, authorization, auditing and non-repudiation of software agents. An IETF Internet-Draft proposes an OAuth extension that records the user, client application and agent in a delegated authorization flow. These efforts do not eliminate local design decisions, but they make the direction clear: agent identity must be represented deliberately.

## The identity triangle: user, client, and agent

A production agent run usually involves at least three principals. The **user** starts or approves work. The **client application** presents the interface and initiates the authorization flow. The **agent** plans and executes actions, often by calling tools or other services. A fourth party, the **resource server**, enforces access to a database, repository, ticket system, cloud account or MCP server.

The client and the agent are not necessarily the same thing. A web application may host an agent, while a worker process with its own credentials executes the run. A workflow orchestrator may call a specialist agent, which then calls a downstream API. If all of these layers are collapsed into one `sub` claim, the audit trail loses the difference between “who asked,” “which application started this,” “which agent chose the action,” and “which resource accepted it.”

| Principal | Responsibility | Identity question | Typical mistake |
|---|---|---|---|
| User | Requests, approves, owns or delegates work | Who initiated the task? | Treating the user’s full permission set as agent permission |
| Client | Hosts the interaction and authorization flow | Which application requested delegation? | Assuming the client is the executor |
| Agent | Plans, selects tools and performs work | Which software actor made the decision? | Giving it a shared service account with broad access |
| Resource server | Applies policy at the boundary | Is this call allowed for this audience and scope? | Trusting an upstream agent’s natural-language explanation |

The separation matters even when one organization operates every component. A token should make the relationship legible to the next service, not force the next service to infer it from a free-form prompt or an internal trace ID.

This is complementary to the folio’s existing [agent handover architecture](/blog/agent-handover-architecture) and [observability without data leaks](/blog/agent-observability-without-data-leaks). Handover explains how work moves between agents; identity explains who is authorized to make the next call. Observability explains how to inspect the run; delegation explains what the inspected actor was permitted to do.

## Delegation is not impersonation

OAuth token exchange makes a useful distinction between **delegation** and **impersonation**. In impersonation, principal A is given a token that makes A indistinguishable from principal B in the receiving system. In delegation, A keeps its own identity while acting for B. RFC 8693 describes these as different semantics and supports tokens that carry information about both the subject and the actor.

For AI agents, the difference is practical. If an agent impersonates the user, a downstream API may see only `user:alice`. It cannot tell whether Alice directly made the request, whether a client invoked an agent, or whether a second agent rewrote the task. If the agent delegates on Alice’s behalf, the downstream API can enforce a policy over both identities: “Alice initiated this, but `agent:ticket-assistant` is the actor, and this token is valid only for ticket reads until 14:00.”

A simple model looks like this:

```text
user:alice  --delegates-->  agent:ticket-assistant
                              |
                              +-- calls --> api:tickets
```

The agent is accountable for the action, while Alice remains the source of the delegated authority. This gives security teams a meaningful answer to two different questions: “Which person’s request is this?” and “Which software component actually performed it?”

The distinction also improves incident response. If a tool is compromised, security can revoke the agent’s credentials or task grants without pretending that the user’s entire identity must be disabled. If the user leaves the organization, the authorization server can deny new exchanges for that user even when the agent itself remains healthy.

## The intersection rule: effective authority is the overlap

The most useful design rule is simple to state: the agent’s effective authority should be the intersection of several constraints, not the union of every permission visible to the system.

```text
Effective authority =
  user’s current permissions
  ∩ agent role
  ∩ requested task scope
  ∩ resource audience
  ∩ tenant and environment policy
  ∩ time and run state
```

Suppose an engineer can read deployments, roll back a release and delete cloud resources. A deployment assistant may be configured only for read-only post-deploy checks. The user’s authority is broad, but the agent’s role is narrow. The effective token should contain only the overlap. Conversely, if the agent role allows a rollback but the user’s current role does not, the call must still be denied.

![The intersection of user permission, agent role, task scope, audience, and environment](/blog/agent-identity-delegation-revocation/intersection-authority-playwright.webp)

WorkOS describes this as an intersection rule: the user’s permissions are a ceiling, not a complete grant. The agent’s own configured scope is a second ceiling. This prevents a common failure mode in which a privileged employee unintentionally gives a general-purpose agent the ability to perform every privileged action the employee can perform.

The intersection should be evaluated at the policy boundary, ideally at every sensitive tool call. Do not ask the model to decide whether an action is allowed. The model can propose an action; a policy engine or resource server must decide whether the action is authorized. This is also the direction recommended by OWASP’s guidance on excessive agency: minimize functionality and permissions, execute extensions in the user’s context, require approval for high-impact operations, and enforce complete mediation downstream.

A useful policy input has more structure than a scope string:

```ts
type AuthorizationInput = {
  userId: string;
  agentId: string;
  clientId: string;
  tenantId: string;
  taskId: string;
  audience: string;
  requestedActions: string[];
  resourceIds: string[];
  environment: "sandbox" | "staging" | "production";
  policyVersion: string;
  expiresAt: string;
};
```

The policy decision should return an explicit result, not a vague boolean hidden inside an agent trace:

```ts
type AuthorizationDecision = {
  effect: "allow" | "deny";
  allowedActions: string[];
  reasonCode: string;
  decisionId: string;
  policyVersion: string;
  expiresAt: string;
};
```

A denied decision is useful data. It tells the system whether the agent requested a capability outside its role, whether the user lost access, whether the target audience was wrong, or whether the run exceeded its time boundary.

## Token exchange: create a task-shaped credential

The agent should not forward the user’s browser session token to every downstream service. It should exchange an authenticated subject token for a new credential that is specific to the resource, audience and task. RFC 8693 defines an OAuth-based token exchange protocol for obtaining a token that can be more narrowly scoped for a downstream service.

A simplified request might look like this:

```http
POST /oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange&
subject_token=<user_access_token>&
subject_token_type=urn:ietf:params:oauth:token-type:access_token&
requested_token_type=urn:ietf:params:oauth:token-type:access_token&
resource=https%3A%2F%2Ftickets.example.com&
scope=tickets%3Aread&
actor_token=<agent_identity_token>&
actor_token_type=urn:ietf:params:oauth:token-type:jwt
```

This example is illustrative rather than a drop-in provider configuration. The authorization server must validate the client, the subject token, the actor token, the requested audience, the task scope and local policy before issuing anything. The user’s original session credential should not become a universal pass for every tool.

![A four-step token exchange flow from user delegation to resource API enforcement](/blog/agent-identity-delegation-revocation/token-exchange-playwright.webp)


An issued token or equivalent authorization context should make the relationship inspectable. Exact claim names vary by provider and profile, but the semantics should resemble this:

```json
{
  "iss": "https://auth.example.com",
  "sub": "agent:ticket-assistant",
  "aud": "https://tickets.example.com",
  "scope": "tickets:read",
  "act": { "sub": "user:alice" },
  "client_id": "support-console",
  "task_id": "run_01JX9...",

  "task_id": "run_01JX9...",
  "tenant_id": "acme-support",
  "environment": "production",
  "policy_version": "support-agent-v4",
  "iat": 1781784000,
  "exp": 1781784300
}
```

The important properties are not the exact JSON shape. They are that the resource server can identify the executing agent, attribute the delegation to a user, restrict the audience, see the task boundary, and reject an expired or policy-incompatible credential. ScaleKit describes the same need as dual identity enforcement, scoped permissions, cross-service attribution, expiry and revocation checks, and auditability at scale.

## Delegation chains need a maximum depth

A single user-to-agent relationship is already more expressive than a user ID. Real systems often go one step further. A coordinator agent may ask a specialist agent to inspect a deployment, and the specialist may call a resource service.

```text
user:alice
  -> client:release-console
    -> agent:release-coordinator
      -> agent:deployment-checker
        -> api:deployments
```

The chain must not become a way to multiply authority. Every hop should receive a narrower or equal scope, a new audience where appropriate, and a clear actor relationship. A specialist agent should not receive the coordinator’s entire tool catalog simply because it was invoked by the coordinator.

| Delegation field | Safe expectation | Red flag |
|---|---|---|
| Actor identity | Each hop has a stable, verifiable principal | Every hop is logged as the original user |
| Audience | Token is valid for one intended resource boundary | One token is accepted by unrelated services |
| Scope | Child scope is a subset of the parent scope | A child receives an expanded permission set |
| Lifetime | Expiry is no later than the parent grant | A child token outlives the run that created it |
| Depth | Policy enforces a small maximum chain length | Unlimited agent-to-agent delegation |
| Attribution | Logs preserve the full chain or a durable reference | Only the last agent is recorded |

A practical default is to make delegation depth an explicit policy field. If the run is allowed to call one specialist, set `maxDelegationDepth: 1`. If a second-hop workflow is genuinely required, approve it deliberately and test the added audit and revocation behavior. “The model may call another agent” is not a security policy.

## Scope is more than read versus write

A scope such as `tickets:read` is useful, but it is rarely enough for a sensitive agent. A production-quality grant should answer at least six questions:

1. **Which audience?** Is the credential valid for the ticket API, deployment API or object store?
2. **Which resource?** Does it cover one ticket, one repository, one project or an entire tenant?
3. **Which action?** Is the agent allowed to read, comment, update, approve, delete or export?
4. **Which environment?** Is the same capability valid in sandbox, staging and production?
5. **Which time window?** Does it expire after five minutes, the current task, or the user session?
6. **Which policy version?** Which authorization rules produced the decision?

The scope should be intentionally boring. A narrow grant like `deployments:read project:folio env:production exp:5m` is easier to review than a generic “deployment assistant” permission. The model can still reason creatively inside the boundary; the boundary itself should remain explicit and machine-enforced.

A token is also not a revocation system by itself. A short expiry limits the damage window, but the system still needs a way to stop an active run when the user is offboarded, the agent is compromised, the task is cancelled, or a policy rollout invalidates the grant.

## Revocation is a runtime state transition

Revocation should be modeled as a state transition, not as an administrative button hidden in an identity console. The authorization service and downstream resource boundary need a clear answer to the question: “Is this delegation still valid right now?”

![A revocation timeline showing task cancel, role change, token expiry, policy denial, and safe stop](/blog/agent-identity-delegation-revocation/revocation-timeline-playwright.webp)

A robust design usually combines several controls:

| Control | What it protects against | Design note |
|---|---|---|
| Short-lived access token | Credential theft and stale grants | Keep expiry aligned with the task, not an entire day |
| Fresh exchange per sensitive call | Role changes during a long run | Re-evaluate user and agent policy at the boundary |
| Revocation status check | Explicit cancellation or compromise | Cache only within a documented, short safety window |
| Run cancellation | Continued work after user intent changes | Propagate cancellation to workers and child agents |
| Policy versioning | Grants created under invalid rules | Reject or re-authorize when the version is incompatible |
| Downstream deny | Upstream mistakes or stale context | The resource server remains the final enforcement point |

Consider a twenty-minute agent run. At minute two, the user can update tickets. At minute eight, an administrator removes that permission. If the agent received a single long-lived token at invocation, the run may continue writing for another twelve minutes. If each sensitive operation exchanges a short-lived credential and the resource server checks current policy, the next write is denied. That is not an edge case; it is the difference between “revocation exists” and “revocation is effective.”

The safe failure mode is explicit denial with a resumable explanation: `delegation_revoked`, `user_permission_changed`, `agent_scope_exceeded`, `task_cancelled`, or `token_expired`. Do not ask the model to improvise around a revocation error. The orchestrator should stop the relevant branch, persist the reason, and request fresh authorization if the product allows a retry.

This complements the folio’s [human action gate and consent fatigue](/blog/human-in-loop-action-gate-consent-fatigue). Approval is appropriate for high-impact actions, but approval does not replace identity and revocation. A user may approve a deploy and then cancel the task; the resource boundary still needs to know that the earlier grant is no longer valid.

## The confused deputy problem

An agent can be a confused deputy even when it has valid credentials. A document, tool result or downstream agent may contain an instruction that redirects the agent toward a resource outside the user’s intent. If the agent has a broad service account, the malicious instruction can turn that authority into data access or destructive action.

The defense is layered. Treat external content as untrusted input, keep tool permissions narrow, enforce the intersection rule at the resource boundary, and make high-impact actions require a separate approval path. This is different from simply adding a sentence to the system prompt. The prompt can guide behavior; it cannot be the final authorization mechanism.

The folio’s [MCP tool poisoning article](/blog/mcp-tool-poisoning-description-payload) and [prompt injection boundaries](/blog/prompt-injection-tool-boundaries) cover the attack paths in more detail. The identity lesson here is narrower: even if an agent is tricked, the credential it holds should make the blast radius small, attributable and revocable.

## Audit the delegation, not just the API call

A conventional API log may record `agent:ticket-assistant called GET /tickets/123`. That is not enough for an accountable agent system. The log should preserve the relationship that authorized the call and the decision that allowed it.

```json
{
  "event": "tool_call.authorized",
  "request_id": "req_01JX9...",
  "task_id": "run_01JX9...",
  "user_id": "user:alice",
  "client_id": "support-console",
  "agent_id": "agent:ticket-assistant",
  "delegation_chain": ["user:alice", "agent:ticket-assistant"],
  "audience": "tickets-api",
  "action": "ticket.read",
  "resource": "ticket:123",
  "decision": "allow",
  "reason_code": "intersection_match",
  "policy_version": "support-agent-v4",
  "delegation_depth": 0,
  "expires_at": "2026-06-18T10:05:00Z"
}
```

Avoid putting raw secrets, full user prompts or sensitive document contents into the audit event. Store a stable reference to the task and evidence when needed, then apply the same privacy discipline described in the folio’s [observability guide](/blog/agent-observability-without-data-leaks). The audit trail should answer who initiated the work, which agent acted, what was requested, which policy decision applied, and whether the action was allowed or denied.

Useful metrics include the rate of denied tool calls by reason code, the percentage of tokens issued with task-level scope, average delegation depth, time from revocation to effective denial, stale-token rejection rate and the number of actions with incomplete attribution. These measures turn identity design into an operable subsystem rather than a diagram in an architecture document.

## A safe migration path from shared service accounts

Many teams cannot replace a shared service account in one release. A staged migration reduces risk without pretending that the old model is safe.

**First, inventory.** Record every agent, tool, service account, downstream audience, action and environment. Identify where a single credential crosses tenant, user or production boundaries.

**Second, observe.** Run a shadow policy beside the existing authorization path. Calculate the intersection decision and log what would have been denied, but do not block yet. This reveals which tools and workflows rely on accidental privilege.

**Third, bind identity.** Register stable agent identities and thread `user_id`, `client_id`, `agent_id` and `task_id` through the execution context. Make missing attribution a visible error instead of silently falling back to a generic principal.

**Fourth, downscope.** Start with read-only tools and low-risk resources. Exchange short-lived credentials for one audience at a time. Keep the existing path as a measured fallback only while the new path is being validated.

**Fifth, canary and deny.** Enable enforcement for a small agent cohort or one tenant. Track denials, latency, token exchange failures, revocation effectiveness and user-visible friction. Expand only when the failure modes are understood.

**Finally, remove the escape hatch.** Delete broad service-account permissions that are no longer needed. A fallback that remains permanently available is usually the real production path.

## Checklist for an agent identity review

Before shipping an agent that can call protected systems, ask whether the design can answer these questions:

- Does the agent have a distinct identity from the user and the client application?
- Is the effective grant the intersection of user permissions, agent role, task scope, audience and environment policy?
- Can a downstream service distinguish the executing agent from the user who delegated authority?
- Are tokens short-lived, audience-bound and issued for the current task?
- Does each delegation hop preserve attribution and avoid expanding scope?
- Can a user, administrator or orchestrator revoke an active run?
- Does the resource server enforce policy instead of trusting the model’s decision?
- Are denial reasons, policy versions and delegation depth available in the audit trail?
- Is there a tested migration plan away from shared, high-privilege credentials?

If the answer to several questions is “not yet,” the next feature should probably not be another tool. It should be an identity boundary.

## Closing thought

The phrase “the agent acts on behalf of the user” is useful only when the system can explain what that means at the authorization boundary. It should mean that a named agent, launched by a named client, received a bounded grant from a named user, for a named task, against a named audience, until a named expiry or revocation event.

That level of precision does not make an agent less useful. It makes the system more honest about where authority comes from and more capable of stopping when authority changes. A user ID answers who someone is. A production agent identity model must also answer who acted, for whom, with what scope, under which policy, and whether the grant is still alive.

## References

[1]: https://www.nccoe.nist.gov/news-insights/new-concept-paper-identity-and-authority-software-agents "NIST NCCoE — New Concept Paper on Identity and Authority of Software Agents"

[2]: https://www.ietf.org/archive/id/draft-oauth-ai-agents-on-behalf-of-user-00.html "IETF — OAuth 2.0 Extension: On-Behalf-Of User Authorization for AI Agents"

[3]: https://www.rfc-editor.org/rfc/rfc8693 "RFC 8693 — OAuth 2.0 Token Exchange"

[4]: https://workos.com/blog/delegated-access-ai-agents "WorkOS — Delegated access for AI agents: The intersection rule explained"

[5]: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/ "OWASP GenAI — LLM06:2025 Excessive Agency"

[6]: https://www.scalekit.com/blog/delegated-agent-access "ScaleKit — Understanding On-Behalf-Of in AI agent authentication"
