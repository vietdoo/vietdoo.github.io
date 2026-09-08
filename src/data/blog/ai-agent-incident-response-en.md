---
title: "AI Agent Incident Response: Kill Switches, Evidence Packs, and Safe Degradation"
description: "A production playbook for containing AI agent incidents with layered kill switches, evidence packs, safe degradation, and recovery paths that reduce blast radius without erasing the facts needed to learn."
pubDate: 2026-02-21
category: "engineering"
image: "/blog/ai-agent-incident-response/hero.webp"
lang: "en"
translationKey: "ai-agent-incident-response"
draft: false
---

![A hand-drawn AI incident-response control room with containment switches, evidence notes, and safe-degradation paths](/blog/ai-agent-incident-response/hero.webp)

The first sign that our customer-support agent was having a bad morning was not a red dashboard. It was a sentence in a ticket: “It told me the refund was complete, but nothing changed.”

The agent had not crashed. The API was healthy. The model provider had normal latency. The trace existed, although it was spread across four services and three different identifiers. The agent had interpreted a tool error as a successful write, composed a reassuring answer, and moved on. By the time we understood what had happened, hundreds of users had received a confident statement about a state transition that had never occurred.

The recovery mistake came next. We disabled the model endpoint, but the worker queue kept retrying. Then we revoked one tool credential, but a second route still had permission to call the same backend. We had a kill switch in the architecture, technically. We did not have a **containment system**.

> **The thesis:** An AI agent incident is not solved by stopping inference alone. A useful response system must stop the dangerous path, preserve enough evidence to reconstruct the decision, degrade to a lower-authority mode, and give operators a deliberate route back to normal.

This playbook treats an incident as an operational state machine rather than a dramatic button. It focuses on four questions: what should stop first, what evidence must survive, how can the agent remain useful without remaining dangerous, and how do we know it is safe to resume?

## Why agent incidents need a different response model

Traditional services usually fail in recognizable ways: a process exits, a request returns an error, or a dependency times out. An agent can fail while continuing to produce valid HTTP responses. Its failure may be semantic, cumulative, or hidden behind a successful tool call. It may choose the wrong tool, use a valid credential for an invalid purpose, write an incorrect state, or describe an uncommitted action as complete.

OWASP’s agentic-AI guidance frames these systems as autonomous combinations of models, tools, data, and actions, with risks that require threat modeling and mitigations rather than a single filter at the model boundary. That framing changes the incident question. We are not only asking whether the model is available. We are asking whether the entire action path still deserves authority.

The most useful distinction is between **availability** and **authority**. Availability asks whether the agent can answer. Authority asks what the agent is still allowed to change. During an incident, preserving read-only assistance may be reasonable even when writes must stop. A global outage is not the only safe outcome.

| Incident signal | What may be wrong | First response question |
|---|---|---|
| Tool-error rate rises | Dependency failure, schema drift, or credential issue | Can we prevent retries from creating more effects? |
| Write/read mismatch appears | The agent claims success without committed state | Which action boundary needs to be paused? |
| Policy-denial rate falls suddenly | A classifier, prompt, or policy path changed | Are risky requests being accepted more often? |
| Repeated identical actions | Retry loop, stale state, or missing idempotency | Which workflow and tenant need isolation? |
| Sensitive data appears in output | Retrieval, memory, or authorization leak | Can we stop exposure without deleting evidence? |

## The five containment layers

A kill switch should be layered because incidents do not all require the same radius of interruption. Start with the smallest switch that stops the dangerous effect, then widen containment if the signal is ambiguous or spreading. The layers below are ordered from broadest to most targeted, but the correct activation order depends on the incident.

![Five containment layers move from a global stop through tenant pause, tool revocation, fallback, and human escalation](/blog/ai-agent-incident-response/containment-layers.webp)

### 1. Global stop

The global stop prevents new agent runs from entering the action path. It is appropriate when the candidate release is clearly unsafe, when a credential is compromised, or when the blast radius is unknown. It should be independent of the model so that the agent cannot reason its way around it. A flag in the same prompt or configuration store that the agent can influence is not a kill switch; it is a suggestion.

The global stop must also address work already in flight. New requests can be rejected, but workers may continue processing queued tasks. A robust design marks the system as stopping, rejects new leases, cancels cancellable model calls, and prevents the commit phase from starting. It should be safe to activate from a second control plane with separate credentials.

### 2. Tenant or workflow pause

Many incidents are local. A broken customer-data connector may affect one workflow but not an internal knowledge assistant. A tenant pause limits the blast radius while preserving useful service elsewhere. The pause must be evaluated at the worker and tool gateway, not only at the HTTP edge, because queued work can outlive the request that created it.

A workflow pause is especially useful when the problem is tied to a particular action class: refunds, account changes, provisioning, deletion, or external messaging. The agent can remain available in draft mode while the irreversible branch is closed.

### 3. Tool authorization revoke

Revoking a tool is stronger than hiding its name from the model. The execution gateway must reject the call even if the model has an old tool definition, a cached plan, or a direct route to the backend. This is where identity and policy become incident controls rather than documentation. The denial should be recorded with the request, agent release, tenant, tool, and policy version.

Credentials should be scoped so that revoking one capability does not require invalidating every capability. If all tools share one broad service account, response becomes an all-or-nothing outage. Narrow authority makes a precise stop possible.

### 4. Lower-authority fallback

A fallback is not automatically safe. Switching to another model may preserve the same dangerous tool permissions and the same stale context. A safer fallback changes the **authority envelope**: read-only retrieval, draft generation, or a bounded FAQ route. The replacement model is secondary. The important change is what the system may commit.

### 5. Human escalation

Escalation is a product path, not a generic error message. The operator needs the user’s intent, the last confirmed state, the attempted action, the reason for the stop, and the evidence needed to decide what happens next. Sending an agent transcript to a queue without ownership, priority, or a safe redaction policy simply moves the incident into a slower system.

## Capture an evidence pack before cleaning anything up

During an incident, teams often want to delete sensitive traces immediately. Sometimes deletion is necessary, but deleting first can make the failure impossible to reconstruct. Separate **containment** from **retention decisions**. Freeze and classify evidence before applying the normal cleanup policy, then restrict access to the incident bundle.

![An evidence pack assembles request, version, policy, tool, context, response, and timeline records into a sealed incident bundle](/blog/ai-agent-incident-response/evidence-pack.webp)

An evidence pack should answer “what did the agent know and what did it attempt?” without pretending that a private chain-of-thought transcript is required. The minimum useful set is usually:

| Evidence | Why it matters | Privacy treatment |
|---|---|---|
| Request and correlation IDs | Joins gateway, worker, model, and tool records | Keep identifiers; hash direct user fields where possible |
| Agent release bundle | Reproduces model, prompt, tools, router, and policy | Store immutable revision references |
| Policy decision | Shows why an action was allowed, denied, or escalated | Record rule ID and decision inputs, not unnecessary payloads |
| Tool request and result | Separates attempted effect from committed effect | Redact secrets; retain structured status and object IDs |
| Retrieved context | Explains stale, missing, or unauthorized evidence | Store provenance and access decision |
| User-visible response | Establishes what was promised | Preserve exact response under incident access control |
| Timeline | Shows ordering, retries, pauses, and recovery | Use server timestamps and monotonic event IDs |

A useful event model distinguishes `planned`, `requested`, `accepted`, `committed`, and `reported`. The sentence “refund complete” should never be derived from `requested`. The agent may report success only after a trusted system confirms `committed`. This rule is small, but it prevents a large class of semantic incidents.

```ts
type ActionEvidence = {
  actionId: string;
  state: "planned" | "requested" | "accepted" | "committed" | "failed";
  tool: string;
  releaseId: string;
  policyDecisionId: string;
  observedAt: string;
  committedObjectId?: string;
};

function userMessage(evidence: ActionEvidence): string {
  if (evidence.state !== "committed") {
    return "I could not confirm that this change was completed.";
  }
  return `The change was completed: ${evidence.committedObjectId}`;
}
```

The evidence pack should be append-only from the incident responder’s perspective. Operators may annotate it, but the original event sequence must remain distinguishable from later interpretation. This makes the post-incident review less dependent on memory and less vulnerable to a well-intentioned cleanup script.

## Safe degradation is an authority ladder

The safest degraded mode is not the one that keeps the most features. It is the one that keeps the most useful behavior **without crossing the uncertain boundary**. A support agent may answer policy questions from verified documents while refusing to mutate account state. A coding agent may prepare a patch while disabling merge and deployment. A browser agent may collect information while stopping before submit.

![A safe-degradation decision tree moves from full action to read-only, draft, handoff, and safe stop as uncertainty rises](/blog/ai-agent-incident-response/safe-degradation.webp)

Model uncertainty is only one input. The system should consider tool health, context freshness, authorization confidence, action reversibility, and whether the target state can be verified. A high-confidence model can still be unsafe when the database is stale or the tool result is ambiguous.

| Mode | Allowed behavior | Required evidence |
|---|---|---|
| Full action | Read, write, execute within policy | Fresh state and committed-result confirmation |
| Read only | Retrieve and explain; no external mutation | Source provenance and access decision |
| Draft | Prepare a response or action for review | Clear “not executed” status |
| Handoff | Package context for a human decision | Minimal, relevant, access-controlled evidence |
| Safe stop | No further action | Incident ID and user-facing recovery path |

The downgrade should be monotonic during one run. If the agent moves from full action to draft because a dependency becomes uncertain, a later model turn should not silently restore write authority. Authority can be re-granted only by a new policy decision after the state is revalidated.

## A response state machine

An incident response process becomes easier to operate when it names states and transition owners. One possible state machine is:

```text
NORMAL
  -> SUSPECTED when a signal crosses a threshold
SUSPECTED
  -> CONTAINED when the dangerous path is paused
  -> NORMAL when the signal is explained and bounded
CONTAINED
  -> INVESTIGATING when evidence is frozen
INVESTIGATING
  -> RECOVERING when a fix and verification plan exist
RECOVERING
  -> MONITORING when the fix is running in a narrow scope
MONITORING
  -> NORMAL after exit gates pass
ANY STATE
  -> SAFE_STOP when impact or uncertainty exceeds the response envelope
```

The model should not be the owner of these transitions. It may surface a signal, but a control plane, policy service, or human operator must decide whether authority changes. This is the same reason a service should not be allowed to edit the policy that determines whether it is allowed to run.

## Incident runbook: contain, explain, recover

The first ten minutes should be deliberately boring. Confirm the signal, identify the dangerous effect, and stop that effect. Do not begin by tuning the prompt. Do not roll out a second model while the first incident is still unbounded. Do not ask users to provide more examples before preventing additional harm.

During investigation, build the evidence pack, identify the smallest affected cohort, compare attempted actions with committed state, and check whether the issue is a release change, dependency failure, stale context, authorization drift, or retry behavior. The cause may be a combination. One dashboard number is not a root cause.

During recovery, use the same authority ladder in reverse. Start with read-only or draft mode, replay representative cases against a fixed snapshot, then allow a small internal cohort to use the action path. Re-enable one tool or workflow at a time. Keep the old safe path available until the new path proves that it can confirm its own effects.

![An incident recovery loop stops, re-observes, re-plans, confirms, and either retries safely or aborts](/blog/ai-agent-incident-response/recovery-loop.webp)

A recovery gate should be explicit. For example:

| Gate | Passing condition |
|---|---|
| Containment | No new high-risk actions can pass through the affected path |
| Evidence | A responder can reconstruct a representative incident end to end |
| State truth | Reported success matches committed backend state |
| Scope | The candidate is limited to a known cohort and action set |
| User recovery | Affected users have a correction or escalation path |
| Monitoring | The relevant semantic signals have owners and thresholds |

## The uncomfortable lesson

A kill switch is not a button that makes an incident disappear. It is a promise that the system can reduce authority faster than the agent can create new effects. An evidence pack is not a permission slip to collect everything. It is a carefully scoped record of the facts needed to explain and repair a failure. Safe degradation is not an apology wrapped in a smaller model. It is a product decision about which capabilities remain trustworthy.

Teams that build these controls before the first incident usually discover that they also improve everyday design. Tool permissions become narrower. State transitions become explicit. User-facing copy stops claiming success before confirmation. Operators can answer not only “is the agent up?” but “what is it allowed to do right now?”

That is the operational standard worth aiming for: an agent that can fail loudly, stop safely, preserve the right evidence, and return to service without asking real users to be the test harness.

## References

[1]: https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/ "OWASP, Agentic AI — Threats and Mitigations"
[2]: https://www.nist.gov/itl/ai-risk-management-framework "NIST, AI Risk Management Framework"
[3]: https://sre.google/sre-book/handling-overload/ "Google SRE Book, Handling Overload"
[4]: https://developers.openai.com/api/docs/guides/evaluation-best-practices "OpenAI, Evaluation Best Practices"

## Related reading

- [AI Agent Identity Is Not a User ID: Designing Delegation, Scope, and Revocation](/blog/agent-identity-delegation-revocation)
- [AI Agent Observability: Trace Prompts, Tool Calls, Tokens, and Cost Without Turning Logs into a Data Leak](/blog/agent-observability-without-data-leaks)
- [Human-in-the-Loop Is Not an Approve Button: Designing Action Gates Without Consent Fatigue](/blog/human-in-loop-action-gate-consent-fatigue)
