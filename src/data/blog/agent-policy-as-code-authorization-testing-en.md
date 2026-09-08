---
title: "Agent Policy as Code: Testing Authorization Rules Like Software"
description: "A production playbook for turning AI-agent authorization requirements into executable policies, negative tests, safe rollouts, and enforceable decision boundaries."
pubDate: 2026-01-02
category: "security"
image: "/blog/agent-policy-as-code-authorization-testing/hero.webp"
lang: "en"
translationKey: "agent-policy-as-code-authorization-testing"
draft: false
---

![A hand-drawn AI agent turns a tenant rule into tested policy before reaching a tool gateway](/blog/agent-policy-as-code-authorization-testing/hero.webp)

The incident looked like a data leak, but the first clue was smaller: an agent was allowed to call a tool that nobody remembered approving.

At 14:06, a support agent received a request from a customer in tenant `tenant_123`. The agent needed to read a subscription record and explain why a renewal had failed. The read was legitimate. The customer was in the right account, the support role had the right scope, and the response contained no surprising data.

At 14:08, the same agent attempted to export a list of customer records for “additional context.” The model had not been asked to export anything. It inferred that a broader dataset would help it resolve the case. The tool adapter accepted the request because the service credential could technically reach the reporting endpoint. The query filter was malformed, so the export returned an error before a file was produced.

We were lucky. We were also wrong to call it a harmless failed request. The system had already crossed the important boundary: a model suggestion had become an authorized tool invocation without a policy decision that the application could explain, test, or roll back.

No prompt injection was required. No provider outage occurred. The model was doing what models do: searching for a path to a useful answer. The application was doing something more dangerous: treating capability as permission.

> **The thesis:** Authorization requirements for AI agents should be executable, testable policy—not prose in a prompt, a comment beside a tool, or an undocumented convention in an adapter. The model may propose an action; deterministic application code must decide whether that action is allowed, record why, and refuse by default when the evidence is incomplete.

This article presents an application-level pattern for policy-as-code in tool-using agents. It uses Open Policy Agent (OPA), Cedar, and OpenFGA as useful reference points, not as a recommendation that every team adopt one specific engine. OPA describes policy as code as declarative rules evaluated through structured input and decoupled from enforcement.[1] Its testing framework demonstrates how positive and negative authorization cases can become repeatable regression checks.[2] Cedar’s validation model adds an important reminder: a policy can be syntactically valid while still referring to the wrong types, actions, or attributes, so policy changes need schema-aware validation before they reach the authorization engine.[3] OpenFGA’s agent-authorization guidance shows why scoped, task-specific permissions matter when agents act for users or access third-party systems.[4]

## A permission in a prompt is not an authorization decision

A prompt can tell an agent, “Only read customer records from the current tenant.” That instruction may improve the model’s behavior. It is not an authorization control.

The model can misunderstand the instruction, receive an untrusted tool description, lose a tenant identifier during context compaction, or produce a perfectly formatted call with a target outside the user’s scope. A prompt cannot prevent a second code path from calling the same tool. It cannot create an audit record that an operator can inspect. It cannot prove that a policy change did not remove a deny rule.

A production authorization decision should be made from a structured request envelope. A small example is enough to expose the difference:

```json
{
  "subject": {
    "kind": "agent",
    "id": "support-agent-7",
    "acting_for": "user-204"
  },
  "action": "read",
  "resource": {
    "kind": "customer",
    "id": "cust-456",
    "tenant_id": "tenant-123"
  },
  "context": {
    "tenant_id": "tenant-123",
    "task_id": "task-91f2",
    "policy_version": "support-policy-12"
  }
}
```

The important fields are not the exact names. The important property is that the decision input is explicit enough to validate and replay. The application can ask whether the subject is bound to the current user, whether the action is known, whether the resource belongs to the same tenant, whether the task is still valid, and which policy version produced the result.

A free-form model message such as “I’ll look up the customer now” contains none of those guarantees. Even a structured tool call produced by the model is only a proposal until the application evaluates it.

## Start with a decision contract

Before choosing a policy engine, define what an authorization decision must mean in your system. Teams often jump directly to rules because rules feel concrete. The contract is more important than the syntax.

For an AI agent, the decision contract should answer at least these questions:

| Question | Why it matters | Example |
|---|---|---|
| Who is requesting the action? | An agent identity is not automatically the user’s identity. | `support-agent-7` acting for `user-204` |
| What action is being requested? | “Use the CRM” is too broad to authorize. | `customer.read` |
| Which exact resource is targeted? | Scope must be evaluated against a resource, not a vague tool name. | `customer:cust-456` |
| Which tenant, project, or account contains it? | Multi-tenant boundaries need a first-class input. | `tenant-123` |
| Under which task or workflow? | A grant that was valid for one task should not become a permanent capability. | `task-91f2` |
| Which context can affect the result? | Time, environment, risk, approval, and data classification may change the decision. | `environment=production` |
| What does deny mean operationally? | A denial should stop the side effect and provide a typed recovery path. | `policy_denied` |
| Which policy version decided? | Without a version, replay and incident review become guesswork. | `support-policy-12` |

The contract should be stable even if the model, tool provider, or policy implementation changes. The model can propose `customer.read`; a tool adapter can translate that request to a provider-specific API; the policy layer can still evaluate the same action, resource, and context.

This separation makes the system easier to test. You can generate a request envelope without invoking a model. You can replay an authorization decision without repeating a customer conversation. You can compare two policy versions against the same request set before promoting the new one.

## Deny by default is not a complete policy, but it is a safe starting point

A default-deny rule is often presented as a slogan. In practice, it is a behavior that must be observable at every enforcement point.

The minimum useful policy has three parts:

1. A finite vocabulary of known actions and resources.
2. Explicit allow rules for conditions the product actually supports.
3. An explicit deny result for unknown, incomplete, expired, or contradictory input.

Here is a deliberately small Rego-like example for a customer-support agent:

```rego
package agent.authz

default decision := {
  "allow": false,
  "reason": "default_deny"
}

decision := {
  "allow": true,
  "reason": "same_tenant_customer_read"
} if {
  input.action == "customer.read"
  input.subject.kind == "agent"
  input.resource.kind == "customer"
  input.resource.tenant_id == input.context.tenant_id
  input.context.task_id != null
  input.context.environment == "production"
}
```

This is not a finished security policy. It does not check whether the task belongs to the subject, whether the user can read the resource, or whether the customer record is classified as restricted. It is valuable because it makes the missing conditions visible. A policy that pretends to be complete can hide more risk than a small policy that clearly describes its boundary.

The default should also cover missing fields. If `tenant_id` disappears during a serialization step, the policy must not interpret an absent value as an unrestricted value. If the action is `customer.export` and no rule describes it, the application should not discover permission by finding a tool with a similar name.

There is a difference between an authorization engine returning a deny decision and an adapter ignoring the decision. The first is a policy outcome. The second is a bypass. The shared action gateway must make it impossible for a tool execution path to proceed without a decision that explicitly permits the exact request envelope.

## Test the negative cases first

The most useful authorization tests are often the ones that should never succeed.

A happy-path test proves that one intended workflow works. A negative test defines a boundary. It says that a cross-tenant read must remain denied, that an unknown tool must not become callable because a model invented its name, and that a missing task grant must not inherit a stale permission from a previous turn.

I prefer to design a request matrix before writing the final allow rule:

| Subject | Action | Resource scope | Expected | Why the case exists |
|---|---|---|---|---|
| Support agent | `customer.read` | Same tenant | Allow | Legitimate support lookup. |
| Support agent | `customer.read` | Other tenant | Deny | Core tenant-isolation boundary. |
| Support agent | `customer.export` | Same tenant | Deny | A read capability must not imply export. |
| Unknown agent | `customer.read` | Same tenant | Deny | Identity must be known, not merely well-shaped. |
| Support agent | `unknown.tool` | Any | Deny | Tool vocabulary is closed by default. |
| Expired task | `customer.read` | Same tenant | Deny | Permissions should not outlive their task. |
| Missing tenant context | `customer.read` | Unknown | Deny | Missing scope must not become global scope. |
| Support agent | `customer.update` | Same tenant | Require stronger policy | Read and write are different risk classes. |

![A hand-drawn policy test matrix shows allow paths, deny paths, unknown tools, expired grants, and missing tenant context](/blog/agent-policy-as-code-authorization-testing/policy-test-matrix.webp)

The names will vary by system, but the shape is durable. Each test supplies a complete request input and asserts a decision plus a reason. The test should not merely assert that “some rule matched.” It should state the safety property the product depends on.

A test written for an OPA-style engine might look like this:

```rego
package agent.authz_test

import data.agent.authz

test_same_tenant_customer_read_allowed if {
  authz.decision with input as {
    "action": "customer.read",
    "subject": {"kind": "agent", "id": "support-agent-7"},
    "resource": {"kind": "customer", "tenant_id": "tenant-123"},
    "context": {
      "tenant_id": "tenant-123",
      "task_id": "task-91f2",
      "environment": "production"
    }
  }
  decision.allow
}

test_cross_tenant_customer_read_denied if {
  decision := authz.decision with input as {
    "action": "customer.read",
    "subject": {"kind": "agent", "id": "support-agent-7"},
    "resource": {"kind": "customer", "tenant_id": "tenant-999"},
    "context": {
      "tenant_id": "tenant-123",
      "task_id": "task-91f2",
      "environment": "production"
    }
  }
  not decision.allow
  decision.reason == "default_deny"
}

test_export_is_not_implied_by_read if {
  decision := authz.decision with input as {
    "action": "customer.export",
    "subject": {"kind": "agent", "id": "support-agent-7"},
    "resource": {"kind": "customer", "tenant_id": "tenant-123"},
    "context": {
      "tenant_id": "tenant-123",
      "task_id": "task-91f2",
      "environment": "production"
    }
  }
  not decision.allow
}
```

OPA’s documentation describes test rules with a `test_` prefix and the `opa test` command for executing them.[2] The specific engine is less important than the habit: authorization changes should produce a diff in executable tests, and CI should fail when a deny boundary disappears.

Do not let an empty test run count as success. A renamed package, a broken path, or a misspelled test selector can create a green build that executed nothing. The test command and CI wrapper should fail when the expected test set is empty, and the result should be exported in a machine-readable form for the release system.

## Schema validation catches a different class of mistake

A policy can be logically wrong even when all of its tests pass. It can also be structurally invalid before the first request arrives.

Suppose a rule refers to `customer.tenantId`, while the application sends `customer.tenant_id`. The rule may simply never match. Suppose an action is named `customer.read` in the schema but `customer.read_record` in one policy file. The policy can look plausible in code review while becoming dead logic in production.

Cedar’s validation documentation makes this distinction explicit. A policy can be well-formed according to syntax rules while containing typos, undefined attributes, or invalid comparisons. Cedar uses a schema describing entity types, attributes, relationships, actions, and request component types to validate policies before they are used by the authorization engine.[3]

That suggests a three-layer check:

| Layer | Question | Typical failure caught |
|---|---|---|
| Parse | Is the policy valid in its language? | Broken syntax, invalid rule shape. |
| Schema | Does the policy refer to the application’s real actions and entities? | Misspelled action, wrong attribute type, missing relationship. |
| Behavior | Does the policy produce the intended decision for representative requests? | Cross-tenant allow, expired grant accepted, export implied by read. |

The layers should run in that order, but they should not be collapsed into one check. A parser cannot know whether a rule is too permissive. A schema validator cannot know whether the business intended to deny an action. A happy-path behavior test cannot prove that all adjacent deny cases remain denied.

Treat policy input as a versioned API. If the application changes its request envelope, the policy schema and behavior suite should change in the same review. If the action vocabulary changes, the old policy should be revalidated before it is allowed to remain active.

## The model proposes; the application enforces

The enforcement boundary should be visible in the architecture, not implied by trust in a framework.

A safe request path looks like this:

```text
user intent
   -> model proposes a tool call
   -> adapter normalizes the proposal into a request envelope
   -> application validates shape and scope
   -> policy engine returns allow or deny
   -> gateway records the decision
   -> tool executes only after an explicit allow
```

![A hand-drawn enforcement boundary separates untrusted model output from the trusted application policy decision before a tool side effect](/blog/agent-policy-as-code-authorization-testing/enforcement-boundary.webp)

The model output is not authority. A tool description is not authority. A previously allowed call is not authority for a different resource. The decision must be made again when the application is about to cross the side-effect boundary.

A TypeScript gateway can keep that rule deliberately boring:

```typescript
type AuthorizationRequest = {
  subject: { kind: "agent"; id: string; actingFor?: string };
  action: string;
  resource: { kind: string; id: string; tenantId?: string };
  context: {
    tenantId?: string;
    taskId?: string;
    policyVersion: string;
    environment: "development" | "staging" | "production";
  };
};

type PolicyDecision =
  | { allow: true; reason: string; policyVersion: string }
  | { allow: false; reason: string; policyVersion: string };

async function executeTool(
  request: AuthorizationRequest,
  tool: (input: AuthorizationRequest) => Promise<unknown>,
): Promise<unknown> {
  const shape = validateRequestShape(request);
  if (!shape.ok) {
    throw new PolicyDenied("invalid_request", request.context.policyVersion);
  }

  const decision = await policyEngine.evaluate(request);
  await recordDecision({ request, decision });

  if (!decision.allow) {
    throw new PolicyDenied(decision.reason, decision.policyVersion);
  }

  return tool(request);
}
```

This code does not make the policy correct. It makes the enforcement point hard to miss. The gateway should be shared by direct tool calls, delegated agent calls, scheduled runs, recovery paths, and administrative replays. If one path can reach the side effect without passing the gateway, the policy is advisory in that path.

The tool adapter still needs its own input validation. Authorization asks whether the action is permitted; validation asks whether the request can be safely executed. Both should run before a side effect. Neither should assume the other has checked everything.

## Policy decisions should be explainable without exposing private reasoning

An audit record does not need a chain-of-thought transcript. It needs enough evidence to explain the decision and reproduce its inputs safely.

A privacy-aware record might include:

```json
{
  "decision_id": "dec-78c1",
  "task_id": "task-91f2",
  "subject_id": "support-agent-7",
  "acting_for": "user-204",
  "action": "customer.read",
  "resource_kind": "customer",
  "resource_id_hash": "sha256:...",
  "tenant_id": "tenant-123",
  "policy_version": "support-policy-12",
  "input_schema_version": "authz-request-v4",
  "decision": "deny",
  "reason": "scope_mismatch",
  "enforcement_point": "tool-gateway",
  "created_at": "2026-01-02T14:08:13Z"
}
```

The exact identifiers depend on retention and privacy requirements. The principle is to record the decision inputs that matter while avoiding a second copy of sensitive payloads. A denial reason such as `scope_mismatch`, `task_expired`, or `unknown_action` is more useful than `false`, but it should not reveal information the requester is not allowed to learn.

Keep the user-facing message separate from the internal reason. An operator may need the policy version and the failed field; a customer may only need, “I can read records from your workspace, but I cannot access that other workspace.” Clear recovery language reduces the pressure to add a dangerous “retry with broader access” button.

## Treat policy changes like production code

The first version of policy-as-code is usually a file in a repository. The second version needs a lifecycle.

A useful policy pull request should show more than the rule being added. It should make the intended authorization change reviewable:

| Review artifact | What it answers |
|---|---|
| Policy diff | Which allow or deny conditions changed? |
| Schema diff | Did the action or entity contract change? |
| Positive test diff | Which new workflows should now succeed? |
| Negative test diff | Which boundaries must remain denied? |
| Decision replay | How did old and new policies differ on a fixed request set? |
| Rollout plan | Where will the new policy run first? |
| Rollback pointer | Which known-good policy version can be restored? |

The policy version should be immutable once promoted. If a rule changes, create a new version and retain the old one long enough to explain historical decisions. “Policy v12” should mean one thing in an incident report, even if the human-readable file is later reorganized.

A policy diff also needs semantic review. A one-line change from `read` to `read | export` may look small while widening the most sensitive capability in the product. The review system should make action-set expansion visible, especially when a rule changes from a resource-specific condition to a tool-wide condition.

## Shadow evaluation makes changes observable before they are authoritative

A new policy should not immediately control every agent because its tests pass. Tests cover known examples; production traffic reveals unknown combinations of task, tenant, resource, and model behavior.

Shadow evaluation runs the candidate policy beside the active policy without allowing the candidate to change the outcome. For each eligible request, the system records whether the candidate would have returned the same decision, a stricter decision, or a more permissive decision.

The comparison should be risk-aware:

| Candidate result | Active result | Interpretation | Default response |
|---|---|---|---|
| Allow | Allow | No observed behavior change. | Continue sampling. |
| Deny | Deny | Existing boundary remains intact. | Continue sampling. |
| Deny | Allow | Candidate is stricter. | Review user impact and recovery UX. |
| Allow | Deny | Candidate is more permissive. | Block promotion until explained. |
| Error | Any | Candidate cannot decide reliably. | Fail closed for protected actions. |

Do not use shadow mode as a reason to expose sensitive data to the candidate engine. Redact or hash fields that are not required for the decision, and make sure a shadow evaluator cannot execute tools. Shadow mode should observe decisions, not create a second side-effect path.

The candidate comparison also benefits from a stable replay corpus. Include recent production-shaped requests, carefully constructed negative cases, and cases from previous incidents. Keep the corpus versioned and privacy-safe. If the request set only contains successful examples, the policy can become more permissive without anyone noticing.

## Roll out with a promotion gate, not a global switch

A policy is code, but it is also a control plane for real actions. A safe rollout has an explicit promotion gate.

![A hand-drawn policy rollout moves from version 12 through a semantic diff, shadow evaluation, a promotion gate, a 5% canary, and rollback](/blog/agent-policy-as-code-authorization-testing/policy-rollout-diff.webp)

A practical sequence is:

1. **Validate.** Parse the policy, validate it against the request schema, and reject unknown actions or entity fields.
2. **Test.** Run positive, negative, boundary, property-based, and replay tests. Fail if the expected test suite is empty.
3. **Shadow.** Compare the candidate with the active version on a fixed corpus and a privacy-safe sample of live requests.
4. **Review.** Require a human to examine every newly allowed high-impact action and every removed deny boundary.
5. **Canary.** Apply the candidate to a small, identifiable cohort of low-risk tasks or agents.
6. **Promote.** Increase exposure only when decision parity, denial reasons, latency, and recovery UX meet thresholds.
7. **Rollback.** Keep the previous policy version available as a single-step, auditable change.

The canary cohort should be sticky enough that the same workflow does not bounce between policy versions mid-task. A long-running task should either pin a policy version intentionally or reauthorize at a defined boundary when the version changes. The choice should be explicit; silently mixing decisions from two versions makes an incident difficult to reconstruct.

Promotion gates should watch for more than error rates. A policy can be technically healthy while denying every request, or it can have a low denial rate while permitting a dangerous new path. Track the shape of decisions:

| Metric | What it reveals |
|---|---|
| Allow and deny rate by action | Whether a rule changed more traffic than expected. |
| Newly allowed request count | Whether a candidate widened access. |
| Deny reason distribution | Whether missing context or scope mismatches are increasing. |
| Policy evaluation latency | Whether the gate becomes a user-visible bottleneck. |
| Decision error rate | Whether the policy engine or input contract is unhealthy. |
| Bypass attempts | Whether a path tried to execute without an authorization record. |
| Recovery completion rate | Whether denied users can complete the legitimate task safely. |

## Common failure modes

Policy-as-code does not automatically produce good authorization. It creates a place where mistakes can become visible earlier.

### The policy checks the tool, not the target

A rule such as “the support agent may use `crm.search`” says little about which tenant, fields, or search modes are allowed. Authorize the action-resource pair and the relevant context. Tool names are implementation details, not business permissions.

### The policy trusts model-provided context

If the model can set `tenant_id` in the request, it can produce a request that looks properly scoped without proving that the tenant belongs to the user or task. Context should be derived from authenticated application state wherever possible, then passed to the policy engine as trusted input.

### One allow rule implies too much

A read rule should not silently grant export, bulk search, write, or delete. Use a closed action vocabulary and test neighboring actions explicitly. Capability expansion should be visible in review.

### Deny is converted into a retry

A policy denial is not a transient tool failure. Retrying the same request, changing only the wording, creates noise and can turn a clear boundary into a brute-force search for an allow path. A retry should require new authority, new scope, a new task grant, or a user-visible recovery step.

### Policy evaluation happens too early

A workflow can be authorized when it starts and execute after the user, tenant, task, or resource has changed. Re-evaluate at the action boundary for high-impact tools. Long-running workflows may need a fresh decision after approval, escalation, or context changes.

### Tests only cover the happy path

A green test suite that contains no cross-tenant, missing-field, expired-grant, unknown-action, or malformed-input cases is not evidence of a safe policy. Negative cases are not extra coverage; they are the definition of the boundary.

### The policy engine becomes a bypassable side service

If one tool adapter calls the engine while another calls the provider directly, authorization is inconsistent by construction. Put a shared gateway in front of side effects and make direct provider credentials unavailable to model-facing code.

## A compact production checklist

Before allowing an agent to execute a tool call, ask:

| Question | Evidence to require |
|---|---|
| Is the model output still only a proposal? | A normalized request envelope created by application code. |
| Is the action from a closed, versioned vocabulary? | Schema validation and unknown-action denial. |
| Is the exact resource identified? | Resource kind, stable ID, tenant/account scope. |
| Is authority derived from trusted state? | Authenticated subject, task grant, and server-owned context. |
| Are missing and contradictory fields fail-closed? | Negative tests for absent, null, malformed, and conflicting input. |
| Do read and export have separate permissions? | Explicit action-level rules and neighboring deny cases. |
| Is there one enforcement gateway? | All side-effect paths pass through the same decision boundary. |
| Can a policy change be replayed? | Immutable version, decision record, and fixed request corpus. |
| Was the change shadow-tested and canaried? | Candidate comparison, promotion gate, and rollback pointer. |
| Can a user recover from denial? | Typed reason, safe explanation, and a legitimate next step. |

The central question is not “Did the agent choose the correct tool?” It is “Could the application prove that this exact subject, action, resource, and context were allowed at the moment the tool could change the world?”

## Closing thought

AI agents make authorization feel deceptively flexible. A person may understand that “help with this customer” means “read the record in the current account.” A model may interpret the same goal as permission to search broadly, export a report, or call a neighboring tool that appears useful.

The solution is not to write a longer prompt and hope the boundary survives every context window. It is to move the boundary into code that can be parsed, validated, tested, reviewed, observed, and rolled back.

A good policy-as-code system is not one that denies everything unfamiliar. It is one that makes the unfamiliar explicit. It gives legitimate actions a narrow path to success, gives dangerous actions a deterministic stop, and gives engineers evidence when a rule changes behavior.

The agent can remain creative inside the task. The permission to cross a side-effect boundary should remain boring.

## Related reading in the production AI series

For agent identity, delegation, and revocation, see [AI Agent Identity Is Not a User ID](/blog/agent-identity-delegation-revocation/). For tool capability contracts across providers, see [Contract Testing for AI Tools](/blog/ai-tool-contract-testing/). For human approval boundaries, see [Human-in-the-Loop Is Not an Approve Button](/blog/human-in-loop-action-gate-consent-fatigue/). For the data boundary before inference, see [The Context Firewall](/blog/context-firewall-pre-inference-data-governance/).

## References

[1]: https://www.openpolicyagent.org/docs "Open Policy Agent — Official Documentation"
[2]: https://www.openpolicyagent.org/docs/policy-testing "Open Policy Agent — Policy Testing"
[3]: https://docs.cedarpolicy.com/policies/validation.html "Cedar — Policy validation"
[4]: https://openfga.dev/docs/modeling/agents "OpenFGA — Authorization for Agents"
