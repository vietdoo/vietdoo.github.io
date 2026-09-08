---
title: "Contract Testing for AI Tools: Proving an Agent Can Safely Call the Same Capability Across Providers"
description: "A production guide to testing AI tool compatibility across models, providers, MCP servers, and implementation versions—with schema contracts, semantic invariants, negative paths, and release gates."
pubDate: 2026-07-06
category: "engineering"
image: "/blog/ai-tool-contract-testing/hero.webp"
lang: "en"
translationKey: "ai-tool-contract-testing"
draft: false
---

![A hand-drawn whiteboard showing an AI agent calling the same tool through two providers, with contract gates between the model and the side effect](/blog/ai-tool-contract-testing/hero.webp)

I once watched an agent pass every happy-path test and still fail in production on its first provider change. The tool schema was valid. The JSON parsed. The HTTP request returned 200. Yet the assistant sent a date in the wrong timezone, treated a business rejection as a transport error, and retried an operation that had already been accepted by the downstream system.

Nothing in the dashboard looked dramatic. There was no model outage and no obvious exception. The failure lived in the gap between **“this payload is valid JSON”** and **“this provider can safely perform the capability our agent depends on.”**

That gap deserves its own engineering discipline: **contract testing for AI tools**.

Traditional contract testing asks whether a consumer and provider agree on the messages exchanged between them. Pact describes this as testing an integration point in isolation against a shared understanding, rather than relying only on expensive, brittle end-to-end integration tests.[1] For AI systems, the consumer is not just a frontend or service client. It may be an agent runtime that asks a model to select a tool, a gateway that translates provider formats, an MCP client that discovers tools, or a workflow engine that interprets structured results.

The provider is not just an HTTP server either. It may be a model family, a hosted endpoint, an MCP server, a tool implementation, or a versioned adapter. The contract must therefore cover more than field names. It must cover **what the tool means, when it may be called, how it fails, what side effect it creates, and what the next model is allowed to believe about the result**.

> **The thesis:** A tool schema proves that a payload can be shaped correctly. A production contract proves that an agent can use the capability safely, predictably, and reversibly enough for the task.

This article is not about making every provider behave identically. That goal is unrealistic and often undesirable. It is about proving that each route satisfies the minimum capability envelope required by a particular task—and making incompatibility fail before it reaches a user or an external side effect.

## Why schema validation is necessary but not sufficient

A JSON Schema is an excellent starting point. It can describe types, required properties, constraints, arrays, references, and other machine-readable rules.[3] An MCP tool definition uses an `inputSchema` for expected parameters and may provide an `outputSchema` for structured results. The MCP specification says that servers providing an output schema must return structured results that conform to it, while clients should validate those results.[2]

That gives us a **shape contract**. It catches a missing `customer_id`, a number serialized as an object, or an output that omits a required `status`. But many production failures remain valid according to the schema.

Consider a tool called `schedule_delivery`:

```json
{
  "type": "object",
  "properties": {
    "customer_id": { "type": "string", "minLength": 1 },
    "delivery_date": { "type": "string", "format": "date" },
    "timezone": { "type": "string" },
    "notify_customer": { "type": "boolean" }
  },
  "required": ["customer_id", "delivery_date", "timezone", "notify_customer"],
  "additionalProperties": false
}
```

The payload may validate while still violating the product contract:

| Valid payload failure | Why schema validation misses it | Contract dimension needed |
|---|---|---|
| Date is interpreted in UTC instead of the customer’s timezone | Both values are valid strings | Semantic invariant |
| Tool schedules a second delivery when called twice | The schema says nothing about side effects | Idempotency and reconciliation |
| `notify_customer: true` sends a message before approval | Boolean type does not encode policy | Authorization and action gate |
| Provider returns `isError: false` with a business rejection | The envelope is structurally valid | Error taxonomy |
| Tool accepts a deprecated enum silently | The value still matches a broad string type | Version and compatibility policy |
| Model sees a success-shaped result with stale inventory | The JSON is correct but the fact is not current | Freshness and outcome semantics |

This is why AI tool contracts should be layered instead of collapsed into one giant schema. A schema protects structure. A behavioral contract protects meaning. A policy contract protects authority. A side-effect contract protects the outside world.

## The five-layer tool contract

A practical contract for an AI capability has at least five layers. Each layer should be testable in isolation and linked to a release gate.

![A hand-drawn whiteboard matrix separating schema, semantic, policy, side-effect, and operational contracts for an AI tool](/blog/ai-tool-contract-testing/contract-matrix.webp)

### 1. Shape contract

The shape contract defines the minimum valid input and output. It includes required fields, allowed types, ranges, enum values, `additionalProperties`, references, and serialization rules. It should be versioned and validated by both the tool implementation and the agent runtime.

Do not let the model-generated schema become the only source of truth. Keep a canonical schema in code or a registry, generate provider-specific formats from it, and reject a route whose adapter cannot preserve the constraints that matter.

For outputs, prefer an explicit status envelope over an ambiguous natural-language message:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": ["completed", "rejected", "needs_confirmation", "not_found", "retryable_error"]
    },
    "operation_id": { "type": ["string", "null"] },
    "reason_code": { "type": ["string", "null"] },
    "data": { "type": ["object", "null"] },
    "observed_at": { "type": "string", "format": "date-time" }
  },
  "required": ["status", "operation_id", "reason_code", "data", "observed_at"],
  "additionalProperties": false
}
```

The `status` is not cosmetic. It gives the next step a bounded state machine instead of a paragraph to interpret.

### 2. Semantic contract

The semantic contract describes what fields mean and which relationships must hold. This is where many provider substitutions fail.

For `schedule_delivery`, examples include:

- The date is interpreted in the supplied IANA timezone, not in the provider’s server timezone.
- A completed result contains a durable `operation_id`.
- A rejected result never claims that a delivery was scheduled.
- `needs_confirmation` cannot be treated as success by the agent planner.
- `observed_at` is generated by the tool implementation, not invented by the model.
- A returned amount, date, or identifier is copied from the system of record rather than inferred from user text.

These are often expressed as executable invariants:

```python
def assert_schedule_semantics(result, request):
    assert result.status in {
        "completed",
        "rejected",
        "needs_confirmation",
        "not_found",
        "retryable_error",
    }

    if result.status == "completed":
        assert result.operation_id is not None
        assert result.data["timezone"] == request.timezone

    if result.status in {"rejected", "not_found", "retryable_error"}:
        assert result.operation_id is None
```

The point is not to encode every business rule in a test. The point is to identify the small number of invariants that must survive a model or provider change.

### 3. Policy contract

A tool may be structurally and semantically correct while still being unauthorized. The policy contract defines who may invoke it, which data classes may cross the boundary, whether human confirmation is required, and which tenant or region restrictions apply.

The MCP tools specification recommends validating inputs, implementing access controls, rate-limiting invocations, sanitizing tool outputs, and keeping a human in the loop for sensitive operations.[2] Those are runtime responsibilities, but they should also appear in tests.

A policy test should ask questions such as:

| Scenario | Expected result |
|---|---|
| Read-only agent invokes a write tool | Denied before provider call |
| Tenant A sends Tenant B’s resource ID | Denied with a stable policy code |
| Sensitive data is routed to a non-approved region | Route rejected before prompt construction |
| Tool requires approval but approval token is absent | `needs_confirmation`, no side effect |
| Tool description changes from read to write | Compatibility gate fails |

Descriptions and annotations are useful hints, not authority. The MCP specification explicitly warns that tool annotations should be treated as untrusted unless they come from trusted servers.[2] Enforce policy from signed or centrally managed metadata, not from prose the model can read.

### 4. Side-effect contract

A side-effect contract states what can happen outside the process and how the runtime can prove the outcome. It is the layer that keeps a timeout from becoming a duplicate payment, duplicate ticket, or duplicate notification.

For each mutating tool, document:

1. Whether the operation is read-only, idempotent, conditionally idempotent, or non-repeatable.
2. Which request field acts as the idempotency key.
3. How the runtime reconciles an uncertain timeout.
4. Whether partial completion is possible.
5. What event or operation record can be used to query the outcome.
6. Which compensating action exists if the operation cannot be rolled back.

A contract test should call the implementation twice with the same logical request and verify the promised outcome. It should also simulate a lost response after the downstream system accepts the operation. A tool that passes only the first test is not safe to expose behind automatic retry.

This is where AI-specific testing meets ordinary distributed-systems discipline. The model may decide to call a tool twice, but the tool contract—not the model’s confidence—must determine whether the second call is safe.

### 5. Operational contract

The operational contract defines the failure and latency behavior that the agent runtime is allowed to depend on. It should include timeout classes, retryability, rate-limit signals, maximum response size, pagination rules, freshness guarantees, and observability fields.

Do not return only `success: false`. Use a stable error taxonomy:

```json
{
  "status": "retryable_error",
  "reason_code": "UPSTREAM_TIMEOUT",
  "retryable": true,
  "safe_to_retry": false,
  "reconcile_before_retry": true,
  "operation_id": null
}
```

`retryable` and `safe_to_retry` are deliberately different. A network error may be retryable from a transport perspective while unsafe to replay before reconciliation because the downstream system may already have committed the side effect.

## Consumer-driven tests for an AI agent

Pact’s consumer-driven model is useful for AI tools because the agent runtime knows which interactions it actually relies on. The contract should be generated from representative consumer examples, not from every theoretically possible response.

The consumer is the agent runtime. It might expect:

- A tool name and description with stable meaning.
- An input schema that supports the fields the planner emits.
- A structured result envelope that can be mapped into the agent state machine.
- Stable error codes for retry, escalation, rejection, and reconciliation.
- An operation identifier whenever a side effect may have occurred.
- A maximum response size or pagination behavior.

The provider is the tool server or adapter. Provider verification then runs the consumer contract against the real implementation, a test environment, or a deterministic simulator. This catches a subtle class of regressions: the tool provider may remain “valid” according to its own schema while breaking the exact interaction the agent uses.

![A hand-drawn whiteboard pipeline showing consumer examples, provider verification, semantic assertions, and a release gate before production](/blog/ai-tool-contract-testing/contract-test-pipeline.webp)

A simple consumer contract can be represented as a fixture:

```json
{
  "consumer": "support-agent-v2",
  "provider": "ticketing-tool",
  "contract_version": "2026-07-01",
  "interaction": {
    "request": {
      "name": "create_ticket",
      "arguments": {
        "tenant_id": "tenant_demo",
        "title": "Cannot reset password",
        "priority": "normal"
      }
    },
    "expected": {
      "status": "completed",
      "operation_id": "opaque-id",
      "data": {
        "ticket_id": "opaque-id",
        "priority": "normal"
      }
    }
  },
  "invariants": [
    "completed_requires_operation_id",
    "tenant_id_is_not_rewritten",
    "priority_is_preserved"
  ]
}
```

The fixture should not assert unstable details such as an exact timestamp, provider request ID, or natural-language sentence. Match structure and meaning, not incidental formatting.

## Provider matrices are more honest than universal adapters

A common architecture mistake is to make every provider look identical at the gateway boundary. Adapters are useful, but they can hide important differences. One provider may support strict tool schemas; another may accept the schema but occasionally emit additional properties. One may stream partial tool arguments; another may return one complete call. One may distinguish a tool execution error from a protocol error; another may wrap both in text.

Record the differences in a capability matrix:

| Capability | Provider A | Provider B | Provider C | Contract decision |
|---|---:|---:|---:|---|
| Strict input schema | Yes | Yes | Partial | Reject C for write tools |
| Structured tool output | Yes | Adapter required | No | Use C only for read-only text tools |
| Parallel tool calls | Yes | No | Yes | Planner must support sequential fallback |
| Native cancellation | Yes | No | Partial | Apply gateway timeout and reconcile |
| Stable error codes | Yes | Partial | No | Normalize A/B; quarantine C |
| Region/data policy | EU | EU/US | US | Filter before route selection |

The matrix is not documentation theater. It should feed eligibility tests. If a task requires strict structured output, the route planner should not select a provider whose adapter merely hopes to repair malformed output afterward.

Use a **minimum capability envelope** per tool class:

```yaml
capability_class: ticket_write_v2
required:
  input_schema: strict
  output_schema: strict
  error_taxonomy: stable
  side_effect_reconciliation: true
  idempotency: required
  region: eu-approved
allowed_adapters:
  - provider_a_native
  - provider_b_gateway_v3
forbidden:
  - freeform_text_only
  - unknown_error_mapping
```

This turns provider selection into a compatibility check rather than a popularity contest.

## Negative paths are the real contract

Happy-path tests are attractive because they are easy to demo. Production incidents live in negative paths: missing permission, stale input, partial tool output, duplicate invocation, provider timeout, malformed arguments, revoked tenant, changed enum, and an upstream response that is technically successful but semantically wrong.

For every tool, build a failure table:

| Failure | Tool response | Agent behavior | Side effect allowed? |
|---|---|---|---:|
| Invalid argument | `INVALID_ARGUMENT` | Ask for correction | No |
| Missing approval | `NEEDS_CONFIRMATION` | Show approval gate | No |
| Downstream timeout before acknowledgement | `UNKNOWN_OUTCOME` | Reconcile, do not blindly retry | Unknown |
| Downstream timeout before dispatch | `RETRYABLE_ERROR` | Retry within budget | No first attempt known |
| Business rule rejection | `REJECTED` | Explain or choose another plan | No |
| Tool schema mismatch | Compatibility failure | Remove route from eligibility | No |
| Provider returns extra fields | Validation failure or strict strip | Record drift and quarantine | No |
| Output violates semantic invariant | Contract failure | Stop and escalate | No |

A provider that returns an error quickly is not necessarily better than one that takes longer. The question is whether the agent can classify the error and choose a safe next state.

## Property-based and metamorphic tests

AI tool contracts benefit from tests that generate many inputs and test relationships rather than fixed answers. Property-based tests can vary optional fields, boundary dates, Unicode names, pagination sizes, and tenant identifiers while preserving the invariant that the tool must never cross a tenant boundary.

Metamorphic tests are especially helpful when an exact answer is nondeterministic. Instead of asserting one output string, assert that a transformation preserves or changes a known property:

- Reordering independent JSON properties should not change the tool result.
- Repeating a read-only call should not create a side effect.
- Adding irrelevant context should not change the selected tenant.
- Converting a date to an equivalent representation should preserve the instant after normalization.
- Switching between compatible providers should preserve the operation state and error classification.
- Removing a required approval should never turn a write into a completed result.

These tests are not substitutes for golden examples. They are a second net for bugs that fixed fixtures do not cover.

## Shadow execution and release gates

Do not wait until a provider or tool implementation is live to discover that the contract is wrong. During a migration, send a sampled request to the candidate route in shadow mode, but prevent it from producing external side effects. Compare shape, semantic fields, error classification, latency, token use, and redaction behavior.

A release gate can combine hard failures and monitored soft signals:

```python
def release_allowed(report):
    return all([
        report.schema_failures == 0,
        report.unauthorized_side_effects == 0,
        report.tenant_boundary_violations == 0,
        report.unknown_outcome_without_operation_id == 0,
        report.semantic_invariant_failures == 0,
        report.error_mapping_failures == 0,
        report.p95_latency_ms <= report.contract.max_p95_latency_ms,
    ])
```

Do not turn every quality signal into a binary deployment blocker. A small latency regression may trigger a canary pause; a cross-tenant leak or unauthorized side effect should stop the release immediately. Make the severity explicit.

The most useful artifact is a compatibility report that answers four questions:

1. Which tool contract version was tested?
2. Which model/provider/adapter combinations passed?
3. Which cases failed, and were they structural, semantic, policy, side-effect, or operational failures?
4. What is the safe fallback or escalation behavior for each failure?

## What to log—and what not to log

Contract testing does not require storing private chain-of-thought. In fact, the test artifact should normally contain the same safe envelope that the runtime needs: contract version, tool name, redacted input shape, policy decision, provider/adapter version, output status, error code, operation ID, latency class, and invariant results.

Avoid putting raw secrets, full customer records, or model internal reasoning into a shared contract registry. Use synthetic fixtures for most tests, encrypted references for sensitive cases, and explicit retention rules for any production replay. The goal is reproducibility without turning the test system into a second data lake.

## A practical adoption sequence

Start with one read-only tool that has a clear output schema. Add strict input and output validation, then write three semantic invariants and five negative-path tests. Next, add provider capability metadata and run the same consumer contract against two adapters. Only after the read path is stable should you test a mutating tool with idempotency and reconciliation.

A small first contract is more valuable than a giant catalog nobody runs. The contract should sit in CI, in the route eligibility layer, and in the incident workflow. When a provider changes behavior, engineers should see a named incompatibility rather than a vague increase in “agent failures.”

The mature outcome is not a universal AI adapter. It is a system that can say, with evidence: **this tool is compatible with this agent contract, through this provider, under these policies, for this class of side effect**.

That sentence is much more useful than “the endpoint supports function calling.”

## References

[1] [Pact Docs — Introduction to Contract Testing](https://docs.pact.io/)

[2] [Model Context Protocol — Tools Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

[3] [JSON Schema — Creating Your First Schema](https://json-schema.org/learn/getting-started-step-by-step)

## Read next

If you are designing the surrounding system, continue with [Model Router for AI Agents](/blog/model-router-ai-agent/), [Idempotent AI Actions](/blog/idempotent-ai-actions/), [Prompt Injection in Tool-Using Agents](/blog/prompt-injection-tool-boundaries/), and [Multi-Model Failover Without Route Flapping](/blog/provider-rotation-multi-model-failover/).
