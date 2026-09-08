---
title: "The Queue Is a Policy: Admission Control, Backpressure, and Fairness for Multi-Tenant AI Agents"
description: "A production guide to treating the queue as an AI-agent policy: admission control, backpressure, fair scheduling, tail-SLO protection, and graceful load shedding."
pubDate: 2026-07-03
category: "engineering"
image: "/blog/ai-admission-control/hero.webp"
lang: "en"
translationKey: "ai-admission-control-backpressure-fairness"
draft: false
---

![A hand-drawn whiteboard showing an AI agent gateway, a fair queue, admission gates, backpressure signals, and graceful load shedding](/blog/ai-admission-control/hero.webp)

A queue looks harmless in an architecture diagram. It is usually drawn as a small rectangle between an API gateway and a worker pool, with an arrow entering from the left and another leaving on the right. The drawing suggests that the queue is passive: it stores work until the system has time to process it.

For a multi-tenant AI agent platform, that mental model is too weak. The queue decides who is allowed to start, who waits, who gets degraded, who is rejected, and how much of the system’s scarce model and tool capacity a tenant can consume. It also decides whether a provider slowdown becomes a controlled 429 or a cascading outage.

That is why the queue is not merely a buffer. **The queue is a policy.**

This matters more for agents than for ordinary request/response APIs. A single agent run may call a model several times, invoke tools, wait for a database, fan out into parallel subtasks, and then join the results. Admitting one user request can therefore create ten downstream operations. If the platform accepts work based only on the first HTTP request, it may promise capacity that the rest of the workflow does not have.

> **The thesis:** A reliable AI-agent platform admits work according to estimated cost, tenant fairness, deadline, risk, and downstream capacity—not merely according to whether the front door is accepting connections.

This article focuses on the control plane around agent execution. It is not another model-routing guide, and it is not a multi-tenant isolation overview. The question here is narrower and more operational: **when demand exceeds safe capacity, how should an agent platform decide what to admit, what to delay, what to degrade, and what to shed?**

## Existing folio context: a different layer of the system

The folio already covers model routing and provider failover, semantic caching, multi-tenant isolation, idempotent tool calls, decision traces, contract testing, and observability. Those systems remain important. Admission control sits one layer earlier: it decides whether a workflow should consume any of those resources in the first place.

| Layer | Primary question | Typical failure if missing |
|---|---|---|
| Admission | Should this run start now? | Queue explosion and work accepted without capacity. |
| Scheduling | Which admitted run goes next? | Noisy neighbors and priority inversion. |
| Routing | Which model/provider should serve it? | Bad capability match or route flapping. |
| Execution | How should tools and state transitions run? | Duplicate side effects or lost progress. |
| Quality | Is the result acceptable? | HTTP 200 responses that fail the product contract. |
| Observability | Can we explain what happened? | Incidents that cannot be reconstructed. |

The distinction prevents an easy mistake: using the provider router as a substitute for a workload scheduler. Switching from provider A to provider B can find another endpoint, but it does not answer whether the tenant should be admitted, whether the workflow has enough budget, or whether ten parallel tool calls will overload a shared dependency.

## Admission is a promise, not a boolean

A naive admission check often looks like this:

```python
def admit(request):
    return queue_depth < MAX_QUEUE_DEPTH
```

That check is better than nothing, but it treats every request as equal. A short classification call, a 100,000-token document analysis, and a write-capable agent run all consume different resources. A queue with 500 small jobs may be healthier than a queue with 20 giant jobs waiting for the same GPU or database.

A production admission decision should consider at least five dimensions:

1. **Work estimate:** expected input tokens, output tokens, tool calls, fan-out, and execution time.
2. **Resource class:** model family, GPU pool, database, search index, browser worker, or external API.
3. **Tenant policy:** quota, priority tier, fairness share, and budget remaining.
4. **Deadline and user value:** interactive request, background workflow, scheduled batch, or best-effort task.
5. **Risk and side effects:** read-only analysis, reversible mutation, financial action, or irreversible external write.

The result should be a decision object rather than a bare `true` or `false`:

```json
{
  "decision": "admit",
  "request_id": "run_01J8Q8K6",
  "tenant_id": "team-vietdoo",
  "queue": "interactive-agent",
  "estimated_work": {
    "input_tokens": 8200,
    "output_tokens_p95": 1800,
    "tool_calls_p95": 4,
    "fanout": 2,
    "critical_path_ms_p95": 4200
  },
  "reservation": {
    "model_tokens": 10000,
    "tool_concurrency": 2,
    "deadline_ms": 6000
  },
  "policy": "interactive-v3",
  "reason": "capacity_available_and_fair_share_remaining"
}
```

The estimate will be imperfect. That is acceptable if the system records the estimate, compares it with actual work, and updates the model. A bad estimate hidden inside a queue is difficult to correct; an explicit estimate can be measured and calibrated.

## Backpressure is a conversation between stages

Backpressure is often described as “slow down when the consumer is slower than the producer.” In an agent platform, it must travel across more than one boundary.

The API gateway can signal that the admission queue is full. The scheduler can signal that a tenant has used its fair share. The model router can signal that a provider has little token budget left. A tool executor can signal that the database pool is saturated. A durable workflow worker can signal that the critical path deadline is no longer achievable.

If those signals remain local, the system accepts work at one stage while another stage quietly accumulates an impossible backlog. A useful control path looks like this:

```text
client
  -> gateway admission
  -> tenant fair queue
  -> workflow reservation
  -> model/provider admission
  -> tool concurrency gate
  -> execution
       ^       ^       ^
       |       |       |
   deadline  quota   dependency health
```

The most important rule is **do not hide backpressure behind latency**. If a run cannot begin within its product deadline, waiting silently is not a neutral choice. It turns a visible capacity problem into a user-facing timeout and may trigger a retry from the client.

A useful response taxonomy is:

| Condition | Preferred response | Why |
|---|---|---|
| Queue is healthy | Admit | Start within the promised budget. |
| Queue is briefly busy | Delay with explicit position or retry hint | Preserve work without pretending it is immediate. |
| Deadline is no longer feasible | Reject or convert to async | Avoid wasting work that cannot satisfy the request. |
| Optional capability is unavailable | Degrade | Return a smaller or slower-quality path with disclosure. |
| Tenant budget is exhausted | Fair-share throttle | Protect other tenants without ejecting the entire platform. |
| Dependency is failing | Shed or isolate | Prevent a local outage from becoming a retry storm. |

## Fairness requires a unit of work

A global FIFO queue is easy to explain and often unfair. A tenant that submits 10,000 small tasks can occupy the front of the queue while a tenant with five urgent tasks waits behind the burst. Priority alone does not solve the problem; a high-priority tenant can still monopolize capacity if there is no per-tenant share.

Cohere’s description of multi-tenant LLM serving is useful here. It combines admission control, performance tiers, Deficit Round Robin, and priority/deadline ordering. The important design choice is the unit of fairness: a request is not always the same amount of work. For variable-size generative requests, token-based or measured-cost budgeting is often more faithful than counting requests.

![A hand-drawn whiteboard showing per-tenant fair queues, weighted quanta, token budgets, and priority inside each tenant lane](/blog/ai-admission-control/fair-queue-token-budget.webp)

A simplified weighted fair scheduler might look like this:

```python
def cost_of(job):
    return (
        job.input_tokens
        + job.output_tokens_p95
        + 800 * job.tool_calls_p95
        + 1200 * max(job.fanout - 1, 0)
    )


def choose_next(tenants):
    eligible = [t for t in tenants if t.queue and t.admitted]
    for tenant in rotate_by_deficit(eligible):
        job = tenant.peek_priority_deadline()
        if tenant.deficit >= cost_of(job):
            tenant.deficit -= cost_of(job)
            return job
    return replenish_deficits_and_retry(eligible)
```

The constants are not universal. The principle is: **charge for work, not only for envelopes**. A 1,000-token request and a 100,000-token request should not consume the same fair-share budget simply because both arrived as one HTTP request.

Fairness also needs boundaries. Consider at least these queues separately:

- Interactive, latency-sensitive runs.
- Background or batch runs.
- High-risk write-capable actions.
- Retrieval and embedding workloads.
- Evaluation and shadow traffic.
- Provider or region-specific capacity pools.

Putting every workload into one “AI queue” creates hidden priority inversion. A large batch job can delay a small interactive request; an evaluation run can consume the same provider quota as a paying user; a write-capable action can compete with read-only summarization despite having a different risk profile.

## Admission control should protect tail SLOs

Average latency is a poor admission signal for AI systems. Averages hide the long prompts, slow tool calls, cold caches, and multi-step workflows that dominate user frustration. TTFT, time to first useful tool call, total completion time, and p95/p99 deadline success are more actionable.

The QUARTZ research on quantile-aware routing makes an important point: prompt length, uncertain decode length, prefix locality, and router-side queueing can amplify tail latency. A request-cost point estimate can look safe while the high-percentile path is already impossible.

A practical admission check should ask:

```python
def can_meet_deadline(job, state):
    predicted_wait = state.queue_wait_p95(job.queue, job.cost_class)
    predicted_exec = state.execution_p95(job.resource_class, job.cost_class)
    predicted_downstream = state.tool_path_p95(job.tool_plan)
    return predicted_wait + predicted_exec + predicted_downstream <= job.deadline_ms
```

This is not a promise that every request will finish on time. It is a refusal to knowingly start work whose deadline is already unattainable.

![A hand-drawn whiteboard showing deadline-aware admission using queue wait p95, model execution p95, tool-path p95, and a defer-or-reject gate](/blog/ai-admission-control/tail-slo-scheduler.webp)

The system should also separate **admission SLOs** from **completion SLOs**:

| SLO | Measures | Control |
|---|---|---|
| Admission latency | Time until accepted, deferred, or rejected | Gateway and queue policy |
| TTFT | Time until first meaningful model output | Model queue and prefill capacity |
| Tool-start latency | Time until first external action | Tool concurrency gate |
| Completion latency | Total run duration | Workflow and dependency budgets |
| Deadline success | Fraction completed before product deadline | Admission + scheduling + degradation |

When the system cannot meet a deadline, rejecting early can be kinder than accepting and timing out after 30 seconds. The user can choose an asynchronous run, a smaller model, a reduced context, or a later retry. The platform preserves trust by making the trade-off visible.

## Load shedding needs a ladder

“Reject everything” is not a load-shedding strategy. It is an emergency brake. Production systems need a ladder that protects the most valuable work first and removes optional work before critical work.

![A hand-drawn whiteboard showing a graceful degradation ladder from full agent execution to async handoff, bounded rejection, and recovery](/blog/ai-admission-control/admission-backpressure-ladder.webp)

One possible ladder is:

1. Stop admitting shadow traffic and nonessential evaluations.
2. Reduce background concurrency and extend batch windows.
3. Disable optional enrichment, long-context retrieval, or speculative branches.
4. Route to a lower-cost or smaller capability-compatible path.
5. Convert interactive work to an explicit asynchronous handoff.
6. Apply per-tenant fair-share throttling.
7. Reject new work with a clear retry or queue token.
8. Open a global circuit only when the dependency or platform is unsafe.

The order is product-specific. A financial action should not be degraded into a guess. A search summary may tolerate fewer retrieved passages. A nightly embedding job may wait. An interactive support request may receive a concise answer without optional personalization.

Envoy’s admission-control filter offers a concrete pattern: use a sliding success window, begin shedding below a configured threshold, control the aggressiveness of rejection, and cap the maximum rejection probability. The exact algorithm is not the point. The point is gradual, measurable shedding rather than a binary switch that oscillates between “accept everything” and “drop everything.”

## Retries are a second workload class

A queue can be healthy until retries arrive. If a provider times out and every caller immediately retries, the retry traffic competes with new work and makes the original problem worse. The platform should treat retries as a distinct class with its own budget and admission policy.

```python
def retry_allowed(attempt, error, job, now):
    return (
        error.retryable
        and attempt < job.retry_budget.max_attempts
        and now < job.retry_budget.deadline
        and job.retry_budget.remaining_tokens > 0
        and not retry_already_exceeds_queue_slo(job)
    )
```

A retry should carry its original causation ID, not become a new user request. The scheduler should know whether it is retrying a safe read, a partially completed workflow, or a write whose side effect is uncertain. Idempotency and decision traces remain necessary, but admission control determines whether another attempt is allowed to compete for capacity.

Backoff needs jitter, but jitter alone is not enough. A thousand requests with independent exponential backoff can still create a large wave if the retry window is long and the provider recovers simultaneously. Use retry budgets, per-dependency breakers, and a small half-open probe pool. Do not let a recovering provider receive the full backlog at once.

## The queue needs a reservation model for agent fan-out

Agent workflows make concurrency amplification easy to miss. Suppose one user request performs three model calls, two retrievals, and four tool calls in parallel. The gateway sees one request. The platform sees nine downstream operations, with a join point that cannot complete until the slowest branch returns.

A useful reservation model is:

```json
{
  "workflow": "support-investigation-v4",
  "max_parallel_branches": 4,
  "reserved": {
    "model_tokens": 14000,
    "retrieval_qps": 2,
    "tool_slots": 3,
    "wall_clock_ms": 8000
  },
  "release_rules": {
    "cancel_on_deadline": true,
    "release_unused_tokens": true,
    "do_not_start_optional_branch_after_budget": true
  }
}
```

The reservation does not have to be exact. It creates a ceiling. Without a ceiling, fan-out is an unpriced form of concurrency and the queue is forced to discover the cost after the work has started.

Cancellation must propagate through the graph. If the user closes the page or the deadline expires, the system should cancel pending model calls, stop optional branches, release queue reservations, and mark uncertain external writes for reconciliation. Otherwise, a request that no longer has a user waiting can continue consuming the same scarce capacity as an active request.

## Kubernetes is a useful analogy, not a complete solution

Kubernetes API Priority and Fairness demonstrates a valuable pattern: classify requests, assign priority levels, and allocate concurrency across flows rather than relying on a single global max-inflight number. An AI-agent platform can borrow the idea, but its flow identifiers must include more than API identity.

A practical flow key may combine:

```text
tenant + workload_class + resource_class + risk_class + deadline_bucket
```

The same tenant may legitimately have an urgent interactive request and a large background export. Treating them as one flow would make fairness too coarse. Conversely, allowing every workflow to invent its own flow key can defeat fairness by creating unlimited lanes. Flow classification must be centrally governed and observable.

## What to measure

A queue policy is only real when its decisions are measurable. At minimum, record:

- Admission decision and reason.
- Estimated versus actual token, tool, fan-out, and wall-clock cost.
- Queue wait by tenant, workload class, and resource class.
- Fair-share deficit and budget consumption.
- Rejection, degradation, deferral, and cancellation rates.
- p50, p95, and p99 wait and completion latency.
- Retry attempts and retry-induced capacity.
- Deadline success and SLO violations.
- Dependency saturation and the queue that propagated the signal.

Do not log sensitive prompts merely to explain a queue decision. A decision record can carry a classification, cost estimate, policy version, and hashed references to the inputs. This is enough to analyze fairness and control behavior without turning the queue into an accidental data-retention system.

A useful dashboard is not only “queue depth.” Show queue depth by flow, work-weighted backlog, oldest admitted age, deadline-feasible fraction, shed percentage, retry share, and the difference between estimated and actual cost. A queue of 100 small requests and a queue of 100 large requests should not look identical.

## A compact production checklist

Before shipping an AI-agent queue, ask:

| Question | Minimum acceptable answer |
|---|---|
| Can the system reject before expensive work starts? | Yes, with a reason code and retry/async guidance. |
| Is fairness defined in a real unit of work? | Tokens, measured cost, or a documented approximation. |
| Can a tenant burst monopolize a shared model or tool? | No; per-flow limits and fair scheduling exist. |
| Does admission protect p95/p99 deadlines? | Yes; it uses quantile-aware wait and execution estimates. |
| Can optional work be removed first? | Yes; a documented degradation ladder exists. |
| Are retries budgeted separately? | Yes; attempts, time, and resource cost are bounded. |
| Does fan-out reserve downstream capacity? | Yes; branches have concurrency and deadline ceilings. |
| Are decisions observable without storing private prompts? | Yes; policy, estimates, reasons, and references are recorded. |
| Can the policy be tested under a noisy-neighbor burst? | Yes; load tests include fairness and tail-SLO assertions. |

The last question is the one most teams skip. A queue policy should be tested with adversarial traffic: one tenant sends a burst, another sends urgent work, a third consumes huge prompts, and a provider begins returning 429s. The test should verify not only that the system remains alive, but that the right work continues to make progress.

## Closing: reliability starts before the model call

AI systems often treat reliability as something that happens inside the model gateway: choose a provider, retry a timeout, open a circuit, and record a trace. Those controls are necessary, but they begin too late if the platform has already admitted more work than its dependencies can finish.

The queue is where the system makes its first reliability decision. It can protect capacity, preserve fairness, respect deadlines, and make degradation explicit. It can also hide overload, amplify retries, and turn one tenant’s burst into everyone’s incident.

A mature agent platform therefore treats admission as a product contract. The contract says what the platform will accept now, what it will defer, what it will simplify, and what it will refuse. It measures the cost of those decisions and learns from the difference between estimated and actual work.

**A queue that only stores requests is infrastructure. A queue that decides safely is part of the AI system’s behavior.**

## Further reading

- [Model Router for AI Agents](/blog/model-router-ai-agent/)
- [Multi-Model Failover Without Route Flapping](/blog/provider-rotation-multi-model-failover/)
- [Contract Testing for AI Tools](/blog/ai-tool-contract-testing/)
- [Decision Traces for AI Agents](/blog/decision-traces-ai-agent-event-sourcing/)
- [Envoy Admission Control](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/admission_control_filter)
- [Cohere: LLM Serving Fairness](https://cohere.com/blog/serving-fairness)
- [Google SRE: Handling Overload](https://sre.google/sre-book/handling-overload/)
