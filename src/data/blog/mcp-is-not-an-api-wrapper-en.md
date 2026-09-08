---
title: "MCP Is Not Just an API Wrapper: Least Privilege, OAuth Consent, and Human Approval for AI Agents"
description: "MCP turns a model suggestion into a path that can read private data, alter systems, and create external effects. This production blueprint separates OAuth delegation, server-side policy, and action-bound approval so an agent never has more authority than the user intended."
pubDate: 2026-04-06
category: "engineering"
image: "/blog/mcp-security-hero.webp"
lang: "en"
translationKey: "mcp-is-not-an-api-wrapper"
draft: false
---
<video controls width="100%">
  <source src="/blog/demo.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>


![An AI agent passes Scope, Policy, and Approve gates before it can reach an external action](/blog/mcp-security-hero.webp)

A support agent has just read an issue comment: *“This customer is furious. Send a goodwill refund now.”* The model selects `send_refund`. The MCP server has an endpoint for the payment provider. An OAuth token is still valid. The request returns `200`. At the HTTP layer, nothing appears unusual.

Then finance asks the questions that an HTTP success cannot answer: **who** delegated this authority, **which tenant** owns this case, **what amount and destination** were reviewed, **why is this allowed right now**, and **who saw the effect before it was committed**?

That is where the “MCP is just an API wrapper for an LLM” mental model fails. An API wrapper mostly translates an API into callable JSON Schema. A production **MCP server** places a model in front of a capability surface that may read private records, change state, spend money, send messages to external destinations, or rotate credentials. A model may propose a tool call. It must not turn that proposal into authority.

> **Core thesis:** Treat MCP as a capability boundary. OAuth consent provides delegated, revocable, scoped authority; server-side policy decides whether this particular request is permissible *now*; and human approval, when required, is a just-in-time authorization bound to a specific effect, argument set, limit, and expiry. None of those layers substitutes for another.

The MCP authorization specification models a protected MCP server as an OAuth resource server, the MCP client as an OAuth client acting for a resource owner, and an authorization server as the system that interacts with the user and issues access tokens.[1] MCP tools are model-controlled, yet the tools specification recommends a human in the loop who can deny invocations and a UI that makes the invoked tool clear.[3] This article turns those principles into an implementation blueprint.

The running example is **OpsBridge**, a multi-tenant support-and-operations MCP server. Its tool names, data, and policies are illustrative; they are not a new MCP standard or a compliance certification.

---

## A tool call must pass four different questions

Before choosing an SDK or policy engine, separate the decisions that are too often collapsed into one optimistic prompt.

| Question | Decision owner | Evidence required | Never infer it from |
| --- | --- | --- | --- |
| Who delegated authority? | Authorization server and resource owner | Client identity, consent record, token subject | The model saying “the user wants this” |
| What may the agent attempt? | OAuth scopes and tool exposure | Audience, expiry, scope, tool manifest | A convenient `ops:*` token |
| Is this request allowed now? | MCP server and policy engine | Tenant, resource ownership, business state, session risk | Tool description or annotation |
| Must a person approve this effect? | Approver and server-side verifier | Canonical arguments, limit, expiry, audit evidence | A prior OAuth consent screen |

These correspond to four planes: **delegation**, **capability discovery**, **runtime authorization**, and **commit approval**. OAuth is excellent at delegated authorization. It does not, by itself, know whether a row belongs to the caller’s tenant, whether a refund is eligible, whether an amount breaches a role limit, or whether the session has just ingested untrusted content.

MCP permits `tools/list` to vary according to authorization present in the request. That is a significant architectural advantage: do not expose a global tool catalog to a model and hope a prompt restrains it. Show the model only tools the current authority can plausibly use.[3] OpsBridge can start with this narrow surface.

| Tool | Narrow capability | Effect | Default decision |
| --- | --- | --- | --- |
| `search_incidents` | `incidents:read` | Read-only | Auto after tenant check |
| `get_customer_case` | `cases:read:tenant` | Reads restricted data | Policy check |
| `create_refund_draft` | `refunds:draft` | Staged, not committed | Policy check |
| `send_refund` | `refunds:send` | Financial external effect | Approval required |
| `rotate_api_key` | `keys:rotate` | Destructive security effect | Approval required |
| `post_status_update` | `status:write` | External communication | Policy or approval |

A simple tool with a tight schema and an explicit effect is easier to protect than `execute_anything` or `ops:*`. OWASP similarly recommends per-tool scoping, separation of toolsets by trust level, and explicit authorization for sensitive operations.[6]

![An oversized ops:* master key opens every drawer while narrow capability keys open only one appropriate tool](/blog/mcp-security-capability-map.webp)

---

## Least privilege is capability topology, not decorative scope minimization

A common failure is to grant `ops:*` and instruct the model to use it “only when necessary.” That is not least privilege. It is broad authority wrapped in natural language. Prompts can be overridden, models can misunderstand, and model behavior changes over time. Authority must live where the server can verify it.

Design scopes around **actions and domains**, then add constraints that a scope string cannot safely express.

```text
# Avoid: blended read, write, cross-tenant, and administrative authority
ops:*

# Separate action from domain; grant only what a workflow needs
incidents:read
cases:read
refunds:draft
refunds:send
keys:rotate
status:write
```

Do not force arbitrary tenant IDs and business-object conditions into a scope grammar if that makes consent and token management brittle. A durable pattern uses a token for **coarse permission** and a policy decision for resource-level authorization:

```text
Token:      scopes=["refunds:send"], aud="https://mcp.opsbridge.example"
Request:    tool=send_refund, tenant=t_72, case=case_918, amount=72.00
Policy:     subject has support_lead role
            case belongs to t_72
            case state is refund_eligible
            amount is within the role limit
            session taint does not block the action
            approval matches the canonical request
```

That avoids both extremes. OAuth scope alone is usually too coarse for row ownership, state transitions, destination trust, or spending limits. An internal policy layer alone, without a scope and token boundary, tends to inflate the tool catalog and make revocation of delegation ambiguous.

MCP’s authorization guidance supports least privilege: a resource server can signal required scopes with `WWW-Authenticate`; a client should treat challenge scopes as authoritative for the current operation and use step-up authorization rather than requesting broad rights upfront.[1] A `401` requesting `refunds:draft` is not necessarily a bad user experience. It can be the correct signal to request only the authority needed for the next step.

### A token is admission to this server, not a passport everywhere

MCP security guidance calls **token passthrough** an anti-pattern: a server must not accept a token, skip checking whether the token was meant for it, and blindly forward that token to a downstream API.[2] A resource server validates issuer, signature, expiry, audience/resource indicator, and scope before calling its policy layer. A token whose audience is `calendar.example` must not become a credential for `send_refund` merely because both systems use OAuth.

The practical consequence is straightforward: the **MCP server is the policy enforcement point**. If a downstream credential is necessary, it should be a separate, narrowly-audienced delegation or service credential whose lifecycle the server controls—not an unrestricted token passed through from an MCP client.

| Control | What it prevents | OpsBridge example |
| --- | --- | --- |
| Exact audience validation | Reusing a token at another resource | Reject a token not issued for `mcp.opsbridge.example` |
| Short expiry and revocation | Authority surviving a changed context | A step-up token expires after ten minutes |
| Scope-to-tool allowlist | Excessive capability discovery | Only `refunds:send` exposes `send_refund` |
| Tenant/resource policy | Cross-tenant and IDOR-style access | The case must belong to the subject’s tenant |
| Business-state guard | An in-scope action at the wrong moment | Refund only a `refund_eligible` case |
| Amount and rate limit | High-impact abuse | Enforce a role ceiling and daily aggregate |

---

## OAuth consent answers: which client, which scope, which resource?

Consent is not decorative UI. It is an auditable relationship among a resource owner, a client, a requested scope, and a protected resource. In the MCP HTTP authorization flow, protected resource metadata helps a client discover the authorization server; the client then uses authorization-server metadata/discovery, appropriate client registration, PKCE, a resource indicator, and authorization-code exchange.[1]

RFC 9700 requires exact matching of registered redirect URIs, with a limited localhost-port exception for native apps, prohibits open redirectors, and recommends PKCE for confidential clients while requiring it for public clients. `S256` is the appropriate PKCE method because the verifier is not exposed in the authorization request.[5] Those details are not incidental OAuth plumbing. They stop authorization codes and tokens from being delivered to an attacker-controlled redirect endpoint.

![A secure OAuth consent flow binds client identity, selected scopes, exact redirect URI, MCP proxy, and authorization server](/blog/mcp-security-consent-proxy.webp)

### The MCP proxy trap: upstream consent is not consent for every MCP client

MCP Security Best Practices highlights an important confused-deputy path. Imagine an MCP proxy that uses a static upstream OAuth client ID for a third-party API but accepts dynamic registration from many MCP clients. If the third party remembers a consent cookie for the proxy’s static client, a malicious client can initiate a flow with its own redirect URI and leverage the old consent to obtain an MCP authorization code.[2]

The remedy is not merely another checkbox. The MCP proxy needs **its own consent per client** before it forwards a user to the third party. The proxy consent page must identify the requesting client, requested third-party scopes, and registered redirect URI; it must use CSRF protection, prevent clickjacking, and bind the decision to the actual `client_id`.[2]

| A good consent view answers | OpsBridge example |
| --- | --- |
| Which application is asking? | “Support Console extension by Acme Support” |
| What will it be allowed to do? | “Read cases” or “Create refund drafts” |
| Where may it receive a code/token? | The registered, exact redirect URI |
| How long does this delegation last? | “This session: 10 minutes” or “Until revoked” |
| Will an additional decision be needed later? | “Sending a refund needs separate approval” |

That final line matters. **Consent is not a blank check.** It delegates a client authority with scopes. It does not approve unlimited future `send_refund` argument sets. A good system presents scopes in language a person can understand without concealing resource and effect boundaries.

---

## Human approval is authorization for a specific effect—not another login

The production rule worth remembering is simple: human approval must bind to a **canonical request**, not to a model’s natural-language interpretation of intent.

A dialog that says “Agent wants to send refund” can be replayed, have its amount changed, be redirected, or remain valid too long. An OpsBridge approval envelope should bind at least the following fields.

| Field | Why it is bound | Example |
| --- | --- | --- |
| Tool and schema version | Prevent approval of the wrong primitive | `send_refund@v3` |
| Canonical argument digest | Prevent post-approval payload mutation | SHA-256/HMAC of canonical JSON |
| Tenant and resource IDs | Prevent cross-tenant substitution | `t_72`, `case_918` |
| Effect limit | Prevent an amount or destination swap | `USD 72.00`, customer-account reference |
| Policy decision and version | Preserve evidence of reviewed rules | `refund-policy-v14` |
| Requester, client, and subject | Establish who initiated the transaction | client ID and user subject |
| Expiry and single-use nonce | Prevent replay and stale approval | five minutes, consume on execution |
| Risk/session context | Prevent reuse after a taint change | `taint=external_content` |

![A just-in-time approval envelope is tied to an argument digest, tenant, expiry, and policy version before a financial action unlocks](/blog/mcp-security-approval-envelope.webp)

The TypeScript pseudocode below is illustrative. It is not a replacement for a canonical JSON library, key management, durable audit storage, idempotency design, or a security review. The point is to make the enforcement point unmistakable.

```ts
import crypto from "node:crypto";

type Decision = "allow" | "needs_approval" | "deny";

type ToolRequest = {
  tool: "send_refund" | "create_refund_draft" | "get_customer_case";
  args: Record<string, unknown>;
  subject: string;
  clientId: string;
  tenantId: string;
  scopes: string[];
  sessionTaint: "clean" | "external_content" | "private_plus_external";
};

function canonicalDigest(value: unknown): string {
  // Production code must use a deterministic JSON canonicalization scheme.
  const canonical = JSON.stringify(value, Object.keys(value as object).sort());
  return crypto.createHash("sha256").update(canonical).digest("base64url");
}

async function authorize(req: ToolRequest): Promise<Decision> {
  assertAudienceAndExpiry(req);            // Token is for this MCP resource.
  assertScope(req.scopes, req.tool);       // Example: refunds:send.
  await assertTenantResource(req.subject, req.tenantId, req.args);

  const effect = classifyEffect(req.tool, req.args);
  if (req.sessionTaint === "private_plus_external" && effect === "external_or_financial") {
    return "deny";
  }
  if (effect === "external_or_financial") return "needs_approval";
  return await policyAllowsCurrentState(req) ? "allow" : "deny";
}

async function executeRefund(req: ToolRequest, approvalId: string) {
  if (await authorize(req) !== "needs_approval") throw new Error("not approvable");

  const approval = await approvalStore.consumeOnce(approvalId);
  const digest = canonicalDigest({ tool: req.tool, args: req.args, tenant: req.tenantId });
  assert(approval.digest === digest, "arguments changed after approval");
  assert(approval.expiresAt > new Date(), "approval expired");
  assert(approval.policyVersion === activePolicyVersion(), "policy changed");

  // Revalidate at the commit point. A stale preflight decision is not enough.
  await assertTenantResource(req.subject, req.tenantId, req.args);
  await audit.append({ event: "refund.executed", approvalId, digest, tenant: req.tenantId });
  return paymentProvider.refund(req.args);
}
```

Three details are easy to miss. First, the approval is **consumed once**. Second, policy and resource ownership are checked again at the commit point; “we checked thirty seconds ago” is not an authorization decision. Third, an audit log can retain decision evidence and a digest without retaining raw customer payloads.

### Approval tiers should follow effect, context, and reversibility

| Tier | Example | Default | What the reviewer needs to see |
| --- | --- | --- | --- |
| 0 | Scoped incident search | Auto | Background trace and audit record |
| 1 | Read a restricted case | Policy permit | Purpose and data classification |
| 2 | Create refund draft, post internally | Policy or confirm | Preview, destination, and diff |
| 3 | Send refund, rotate key, external email | JIT approval | Canonical action, limit, expiry, recovery path |
| 4 | Bulk delete, large transfer, cross-tenant admin | Block or two-person control | No model-only commit path |

Approval becomes click fatigue if it guards every read. It becomes meaningless if it appears only after the effect ran. Triage on effect class, reversibility, data sensitivity, destination, amount, and session taint puts human attention where it creates accountability.

---

## Tool annotations improve UX; they are not an authorization contract

MCP tool annotations such as `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` are useful vocabulary for client UX. But the specification says clients should treat annotations as untrusted unless they come from a trusted server.[3] An MCP maintainer explainer makes the same point: annotations are **hints**, cannot self-enforce, and missing annotations should lead to conservative handling.[4]

That produces two engineering rules.

1. Use annotations to choose interaction design. A read-only tool from a trusted server can be lower friction; a destructive tool should show a preview or confirmation.
2. Never use annotations as the source of truth. A server-side policy registry must classify tool and effect using reviewed configuration or code. A tool claiming `readOnlyHint: true` must not grant itself authority.

Risk is also a property of the **path**, not merely of one tool. A session that combines private-data access, untrusted content, and external communication can form an exfiltration path through prompt injection. MCP’s tooling guidance describes this combination as a “lethal trifecta” for agentic systems.[4]

![A session tainted by untrusted content has its path from private data to external communication blocked by policy and human approval](/blog/mcp-security-taint-path.webp)

A policy engine should carry context such as `session.taint`, `data.classification`, `destination.trust`, and `effect.class`. After an agent reads a web page, email, imported ticket, or document, treat that content as untrusted data—not as privileged instruction. If the same session subsequently reads private data, external write should be blocked or escalated. This is defense in depth: the server can prevent dangerous behavior even when the model does not recognize an attack.

---

## Turn the blueprint into a regression suite

Authorization regressions arrive with new tools, changed scopes, proxy modifications, and model upgrades. Put invariants into automated tests. Ten correct enforcement tests are more useful than ten prompts asking an agent to “be careful.”

| Test case | Setup | Expected invariant |
| --- | --- | --- |
| Missing scope | Token has `refunds:draft`; call `send_refund` | Tool is hidden or server denies before provider call |
| Wrong audience | Token is valid for another resource | Reject during token validation |
| Cross-tenant ID | Tenant A subject submits tenant B case | Deny despite correct scope |
| State violation | Case is not `refund_eligible` | Deny even with older approval |
| Changed arguments | Approve 72 USD, execute 720 USD | Digest mismatch; no execution |
| Approval replay | Reuse an approval ID | Single-use store rejects it |
| Expired or revoked consent | Token/consent is no longer active | Step up again; never silently renew |
| Tainted exfiltration path | Read web content + private case + external post | Block or require elevated flow |
| Annotation lie | Untrusted tool marks itself read-only | Registry remains server-authoritative |
| Audit completeness | Deny, approve, execute | Correlation ID, policy version, decision, actor; no secret leakage |

The matrix below is not an industry benchmark. It is an **example policy table** designed to force an engineering discussion before code is shipped. Each cell needs an owner and a test.

![An example action policy matrix distinguishes auto, policy, approval, and block decisions based on effect and context](/blog/mcp-security-risk-matrix.webp)

Instrument denials as carefully as permits. A post-rollout denial-rate spike may indicate an attack, a broken scope migration, or confusing consent UX. Approval latency may reveal an operational bottleneck. However, operational evidence must not become an uncontrolled raw-payload repository: a correlation ID, capability, decision, policy revision, approver role, and digest are usually enough for audit and debugging.

---

## Roll out without breaking every agent in a week

Start with inventory, not “add OAuth.” List every tool, downstream dependency, data class, destination, side effect, and current credential. Then narrow the manifest: split read, draft, and commit actions; remove generic shell or administrative tools from user-facing agents; make `tools/list` scope-aware.

Next, standardize the authorization contract: protected-resource metadata and discovery, strict redirect URI handling, PKCE, issuer/audience validation, short token lifetime, and a per-client consent record. MCP’s authorization specification defines protected-resource metadata and steers clients toward discovery; RFC 9700 supplies the OAuth baseline for redirect, PKCE, mix-up, and CSRF defenses.[1] [5]

Then put the policy engine on the path before every provider call. It needs subject, client, tool, capability, tenant/resource, business state, destination, amount, taint, and policy version. Only after that should you add approval envelopes for high-impact effects—and they must be single-use and revalidated.

![A timeline from tool discovery through OAuth consent, policy, human approval, execution, and audit evidence](/blog/mcp-security-authorization-timeline.webp)

> **Definition of done:** A model can propose a tool call; only the server can execute a side effect. The server executes only when the token, policy, approval when needed, and current state all agree.

### Production release checklist

| Area | Release-gate question |
| --- | --- |
| Tool surface | Is any tool broader than its job to be done? Is `tools/list` authority-aware? |
| OAuth | Do you have exact redirect validation, PKCE, issuer/audience/expiry checks, and per-client consent? |
| Policy | Are tenant, resource, state, destination, and amount checked server-side? |
| Approval | Does approval bind digest, limit, policy version, expiry, single use, and revalidation? |
| Session safety | Does untrusted content taint context and restrict external effects after private-data access? |
| Operations | Do deny/approve/execute paths have audit evidence, correlation IDs, retention, and an accountable owner? |
| Testing | Do regressions cover scope, audience, replay, changed arguments, cross-tenant access, and injection paths? |

MCP gives teams a shared language for exposing tools. It does not solve authority by itself. Production value comes from locating each control at the right layer: OAuth for delegation, policy for runtime decisions, and people for commits that require responsibility. With that design, an agent is not a principal holding a master key. It is a constrained executor bounded by intent, scope, and evidence.

---

## References

[1]: [Model Context Protocol — Authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)  
[2]: [Model Context Protocol — Security Best Practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices)  
[3]: [Model Context Protocol — Tools](https://modelcontextprotocol.io/specification/draft/server/tools)  
[4]: [Model Context Protocol Blog — Tool Annotations as Risk Vocabulary: What Hints Can and Can't Do](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)  
[5]: [IETF RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)  
[6]: [OWASP Cheat Sheet Series — AI Agent Security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
