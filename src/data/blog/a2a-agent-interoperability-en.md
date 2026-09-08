---
title: "Beyond Tool Calls: Designing Reliable Agent-to-Agent Collaboration with A2A"
description: "A practical system-design guide to Agent Cards, task lifecycles, capability negotiation, streaming, push updates, and trust boundaries in agent-to-agent systems."
pubDate: 2026-05-26
category: "architecture"
image: "/blog/a2a-agent-interoperability/hero.webp"
lang: "en"
translationKey: "a2a-agent-interoperability"
draft: false
---

![A client agent delegates a bounded task to a remote agent through an A2A protocol boundary](/blog/a2a-agent-interoperability/hero.webp)

I used to describe every AI integration as a tool call. It was a useful simplification: the model chooses a function, the function returns data, and the model continues. Then the system grows. A customer-support agent needs a specialist from another team. A research agent needs a compliance agent. A scheduling agent needs to ask a booking agent to hold an option for several minutes while a human confirms the details.

At that point, calling the other system a “tool” starts to hide more than it explains. The remote system may have its own model, memory, policies, user context, runtime, and failure modes. It may not expose its internal chain of thought or its tools at all. What crosses the boundary is not a function implementation; it is a conversation about a task, its authority, its progress, and its result.

That is the problem space addressed by **Agent2Agent (A2A)**, an open protocol for collaboration between agentic applications that may be built by different vendors or frameworks. The official design emphasizes agent discovery, standard transports, enterprise authentication, long-running tasks, state updates, and multimodal data exchange.[1] The latest specification organizes those ideas into operations, a data model, task update mechanisms, capability validation, versioning, and security objects.[2]

The important idea is not that every agent should suddenly become part of a giant autonomous swarm. The important idea is that **an agent-to-agent call is a distributed-systems boundary**. Once we treat it that way, several design questions become unavoidable: How does a client discover what the remote agent can actually do? How is delegated authority constrained? What does “in progress” mean? What happens when a stream disconnects halfway through? Can the client safely retry? How does a human cancel work that has already started?

This article develops a practical mental model for answering those questions. It is not an SDK tutorial and it is not a product announcement. It is a production-oriented guide to the contracts that make agent collaboration understandable and recoverable.

## The boundary is not a function signature

A conventional API usually gives us a stable description of an operation. We know the endpoint, the input schema, the output schema, and often the expected error codes. A tool call can use the same mental model because the tool is assumed to be a capability inside the caller’s control plane.

An agent-to-agent interaction is different in three ways.

First, the remote agent may be **opaque**. The client should not assume which model it uses, how it plans, which tools it calls, or where it stores intermediate state. It can reason about the remote agent through the protocol surface, but it cannot safely depend on an internal implementation detail.

Second, the work may be **long-running**. A request may finish immediately, or it may create a task that needs more input, emits intermediate artifacts, waits for a third-party system, or remains active while a human reviews a decision. A single HTTP response is not enough to describe that lifecycle.

Third, the result may be **more than text**. A remote agent might return a structured JSON object, a file, a link, a status update, or several artifacts produced at different points in the task. The client therefore needs a way to understand not only the answer, but also the delivery mode and the state of the work.

A useful abstraction is:

> A tool call asks, “Which function should I invoke?” An agent-to-agent call asks, “Which autonomous capability may I delegate to, under which contract, with which updates, and with what authority?”

That difference changes the architecture. The calling agent becomes a client. The remote agent becomes a server with its own policy and runtime. The message is an intent, but the task is a durable protocol object. The artifact is the result of work, not merely a return value.

![The discovery and delegation path turns an Agent Card into a capability contract before a task begins](/blog/a2a-agent-interoperability/agent-card.webp)

_Figure 1. Discovery should narrow the delegation boundary before the client sends the task._

## Agent Cards are capability contracts, not marketing profiles

A client cannot delegate responsibly if it knows only that a remote endpoint exists. It needs a machine-readable description of the remote agent’s identity, skills, interfaces, authentication requirements, and supported capabilities. A2A calls this description an **Agent Card**.[1] [2]

It is tempting to treat an Agent Card as a catalogue entry: a name, a description, and a list of impressive things the agent claims to do. That is not enough for production. A useful card is closer to a capability contract. It should help the client answer four practical questions before it sends user data across the boundary.

| Question                           | What the client needs to learn                                                   | Why it matters                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Can this agent do the job?**     | Skills, input modalities, output modalities, and supported task patterns         | Prevents routing a request to an agent that can produce plausible but unusable output.     |
| **How can I reach it?**            | Supported interfaces and transport details                                       | Allows the client to select synchronous, streaming, or asynchronous delivery deliberately. |
| **What authority does it expect?** | Authentication schemes, scopes, audience, and required consent                   | Prevents a capability match from becoming an authorization mistake.                        |
| **How will I know what happened?** | Task support, streaming, push notifications, cancellation, and artifact behavior | Makes failure and recovery part of the integration design.                                 |

The card should also be treated as **untrusted input**. A remote agent can advertise a skill that is technically real but operationally unsuitable for the current tenant, user, data classification, or budget. Discovery is not authorization. Capability matching is not consent. A client still needs a local policy layer that filters the card through the current user’s authority and the application’s risk rules.

This is where A2A differs from a simple service registry. The registry answers, “Where is the service?” The Agent Card helps answer, “What kind of interaction can this agent support?” The client must still decide, “Should this particular request be allowed to use it?”

### Capability negotiation should be explicit

Imagine a `TravelOps Agent` that wants to ask a remote `Policy Agent` whether a fare is refundable. The policy agent may support text and structured JSON, but not file uploads. It may support synchronous replies for simple questions and tasks for policy analysis that requires a human review. It may require OAuth with a specific audience. If the client ignores those details, it will discover incompatibility after sending the request—or worse, after sending data that should never have crossed the boundary.

A safer decision sequence looks like this:

1. Fetch or resolve the Agent Card through a trusted discovery path.
2. Validate the card’s origin, signature or transport trust, freshness, and schema version.
3. Match the requested skill and modality against the client’s task.
4. Apply local policy: tenant, user, data classification, budget, and consent.
5. Select the least powerful interface that can complete the work.
6. Send only the minimum context needed for the delegated task.

The sixth step matters more than it first appears. A remote agent does not need the caller’s entire conversation history merely because it is technically available. The client should construct a narrow delegation envelope: the user’s authorized objective, relevant facts, constraints, and the expected form of the result. This makes the boundary easier to audit and reduces accidental context leakage.

## A Task is a state machine with an owner

The most important design shift is to stop treating a delegated request as a single response. The remote agent may return a **Task**, a stateful object that progresses through a defined lifecycle. The exact protocol vocabulary is less important than the engineering discipline behind it: the client needs to know whether the work was accepted, is active, needs input, completed, failed, or was canceled.[2]

![A task moves through explicit states instead of being represented as one ambiguous response](/blog/a2a-agent-interoperability/task-lifecycle.webp)

_Figure 2. Explicit task states let the client distinguish progress, failure, cancellation, and a request for more input._

A task should have a stable identity and a clear ownership model. The client owns the relationship with the user; the remote agent owns the execution of its task; the protocol connects the two. If the client loses its network connection, that should not automatically imply that the remote work disappeared. Conversely, the remote agent should not assume that an abandoned client still wants the task to continue indefinitely.

This creates several useful questions for the contract:

| Lifecycle question               | Design decision to make                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Who creates the task identifier? | Define whether the server assigns it, the client supplies an idempotency key, or both identifiers are retained. |
| Who can change task state?       | The remote agent reports execution state; the client can request cancellation when authorized.                  |
| What does `input-required` mean? | Specify what kind of user or client response is acceptable and how long the task may wait.                      |
| What is terminal?                | Define completed, failed, rejected, and canceled states, and whether any terminal state can be reopened.        |
| Where do artifacts live?         | Decide whether the task contains them directly, references them, or emits them as updates.                      |

A state machine is not bureaucracy. It is the minimum information needed to prevent the UI from lying. Without explicit states, an application turns every non-final response into “loading,” every timeout into “failed,” and every lost connection into “unknown.” Those shortcuts are harmless in a demo and expensive in production.

### `input-required` is a first-class outcome

Many agent designs treat a request for clarification as an exception. In a long-running collaboration, it is normal. The remote agent may need a missing date, a consent decision, a document, or confirmation that a side effect is permitted.

The client should not silently answer on the user’s behalf. It should surface the question, preserve the task identity, and resume the interaction with a bounded response. That means the task state needs to survive across turns, and the UI needs to distinguish “the system is thinking” from “the system is waiting for you.”

This distinction also improves cost control. A client can stop polling while a task waits for a human, set an expiration policy, and avoid repeatedly sending the same context. A good asynchronous design saves both tokens and confusion.

## Choose delivery semantics deliberately

A2A supports more than one way to deliver progress and results. The client may receive an immediate response, subscribe to a stream of updates, or configure push notifications for asynchronous work.[1] [2] These are not interchangeable transport preferences. They imply different user experiences and failure modes.

Synchronous delivery is appropriate when the task is short, bounded, and unlikely to require a human. It keeps the request path simple, but it is a poor fit for work that may take minutes or hours. Streaming is useful when the client needs incremental status or artifacts while the task is active. It improves responsiveness, but it introduces reconnect, ordering, and duplicate-event concerns. Push notifications are useful when the client should not hold an open connection, but they require secure callback handling, replay protection, and a strategy for fetching the authoritative task state after a notification.

The client should define a delivery policy rather than letting the model choose casually. For example:

| Situation                                         | Preferred mode                  | Additional guardrail                                                     |
| ------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| A short policy lookup with a small JSON answer    | Synchronous                     | Strict timeout and bounded output size                                   |
| A report assembled from several specialist agents | Streaming                       | Event ordering, cursor or resubscription, and partial-artifact semantics |
| A task waiting for a human approval               | Push or task polling            | Expiration, identity binding, and explicit resume action                 |
| A booking or state change                         | Task plus explicit confirmation | Idempotency, cancellation, audit trail, and compensation plan            |

The key is to keep **delivery state** separate from **task state**. A stream can disconnect while the task remains `working`. A push notification can be delivered twice while the task has advanced only once. A client must be able to reconnect or retrieve the task without guessing what happened from the last message it saw.

## Retries are a protocol decision, not a generic HTTP habit

Retries are dangerous when the delegated operation can create side effects. If a client times out after sending “hold this itinerary,” it does not know whether the remote agent received nothing, accepted the task, or completed the hold before the response was lost. Retrying blindly can create duplicate reservations, duplicate messages, or conflicting tasks.

The client needs an idempotency strategy. The simplest version is a stable key derived from the logical operation, not from the network attempt. The remote agent should use that key to recognize a replay and return the existing task or result instead of creating a second side effect. The scope and lifetime of the key must be explicit: per user request, per task, per tenant, or another boundary chosen by the application.

Idempotency does not make every operation safe. It only makes a repeated request recognizable. The remote agent still needs business rules for partial completion, expired holds, external systems that do not support idempotency, and retries after a terminal failure. The client should expose those semantics to the user rather than converting them into a confident but ambiguous sentence.

Cancellation is similarly nuanced. A cancellation request may arrive after work has completed, while a side effect is in flight, or after an external system has committed a change. “Cancel” must therefore be modeled as a request with a result, not as a magical deletion of history. The task record should preserve what happened and whether compensation was required.

## Trust the boundary, not the agent’s prose

An agent can say that it completed a booking, revoked a token, or attached a file. The client should not treat that sentence as proof. The protocol result needs to be tied to structured task state, artifacts, identifiers, and—where relevant—the authoritative system of record.

This is especially important when the remote agent is opaque. The client may not be able to inspect its internal tool calls, so it should verify what can be verified at the boundary:

| Boundary evidence | Example validation                                                                    |
| ----------------- | ------------------------------------------------------------------------------------- |
| Task state        | The task reached `completed`, not merely produced a confident sentence.               |
| Artifact identity | The returned file or JSON object has a stable identifier and expected schema.         |
| Authorization     | The remote request used the intended audience and scope.                              |
| Business outcome  | The source system confirms the reservation, case update, or policy decision.          |
| Audit metadata    | The trace records the caller, remote agent, task ID, policy decision, and timestamps. |

This is not an argument for exposing hidden reasoning. It is an argument for exposing **observable contracts**. A client needs enough evidence to decide whether it may tell the user “done,” “waiting,” “failed,” or “I need your help.”

## Production gates for agent-to-agent calls

Once the basics work, teams usually discover that the protocol is not the hard part. The hard part is operating a boundary where two autonomous systems can each be locally reasonable and still produce a globally unsafe result.

![The production path gates delegation on capability, authorization, retry safety, bounded work, and traceability](/blog/a2a-agent-interoperability/reliability-gates.webp)

_Figure 3. Reliability is a sequence of gates before delegation, not a single pass/fail prompt._

A practical production gate should answer the following questions before a request leaves the client:

**Capability.** Does the remote Agent Card advertise the needed skill, modality, interface, and task behavior? Is the card fresh enough for the risk of the request? Has a capability or endpoint changed since the last approval?

**Authorization.** Is the caller allowed to delegate this particular data and action to this particular agent? Are the token audience, scope, tenant, and user consent aligned? Can the remote agent prove which principal it is acting for?

**Context minimization.** Is the payload limited to the facts needed for the task? Are secrets, unrelated conversation turns, and hidden internal instructions excluded? Are artifacts classified before they are sent across the boundary?

**Reliability.** Is the operation idempotent or otherwise retry-safe? Are timeouts, cancellation, and maximum task duration defined? Can the client recover the task after a network failure? Does the remote agent provide a clear terminal state?

**Observability.** Can the team correlate the client trace, remote task ID, artifacts, policy decisions, and user-visible outcome without logging sensitive payloads? Can an operator reconstruct the timeline without reading every token?

**Human control.** Which states require a human decision? Can the user pause, cancel, reject, or amend the task? Does the interface make a pending approval visible instead of hiding it behind a spinner?

These gates should be implemented as deterministic checks wherever the fact is checkable. A model can help interpret a user’s intent, but it should not be the final authority for whether an OAuth audience matches, an idempotency key exists, a task exceeded its budget, or a user gave consent.

## A reference pattern: TravelOps delegates without surrendering control

Consider a small travel platform with three agents. `TravelOps Agent` talks to the user. `Policy Agent` explains fare rules. `Booking Agent` can place a temporary hold, but it cannot finalize a purchase without a separate approval.

The user asks, “Find me a refundable evening flight and hold the best option while I check with my manager.” TravelOps first resolves the cards for the policy and booking agents. It learns that Policy supports structured policy answers and that Booking supports a long-running task with a hold artifact. Local policy permits TravelOps to send the route, date, traveler constraints, and budget, but not the user’s full conversation history.

TravelOps asks Policy for the refundability constraints. That request can be synchronous. It then asks Booking to create a hold task. The request includes a logical idempotency key and a response preference for task updates. Booking reports `working`, emits candidate artifacts, and eventually reaches `input-required` because the selected fare requires confirmation of a passenger detail. TravelOps surfaces that question to the user rather than guessing.

If the user confirms, TravelOps resumes the existing task. If the user cancels, TravelOps requests cancellation and shows the resulting state. If the network fails after the task was created, TravelOps retrieves the task by its identifier rather than creating a new hold. If Booking reports `completed`, TravelOps still checks that the returned hold identifier exists in the booking system before telling the user that the option is held.

Nothing in this flow requires the client to know which model Booking uses or which internal tools it calls. The collaboration remains useful precisely because the contract is about capability, state, authority, and evidence—not implementation trivia.

## What to test before shipping

A2A integrations deserve tests at three surfaces. First, test discovery: can the client parse the Agent Card, reject incompatible versions, apply local policy, and select the least powerful supported interface? Second, test protocol behavior: does the client handle synchronous replies, task creation, streaming updates, push notifications, resubscription, cancellation, duplicate delivery, and terminal errors? Third, test business outcomes: does the source system confirm the result, and does the UI tell the truth when the remote agent is uncertain or unavailable?

A useful test case should include the initial user intent, the expected capability match, allowed and forbidden data fields, the delivery mode, the idempotency key, the maximum duration, expected task transitions, and the evidence required for success. Do not grade only the final sentence. A remote agent that says “the booking is held” while returning no hold identifier should fail the contract even if the prose sounds perfect.

The most valuable negative tests are often mundane. Send a stale Agent Card. Remove the required scope. Disconnect the stream after the task starts. Deliver the same push notification twice. Return a task that waits for input for too long. Retry a request after a timeout. Ask the client to send an unrelated secret in the delegation context. A system that survives these cases is more trustworthy than one that merely demonstrates a clean happy path.

## Closing perspective

Agent-to-agent interoperability will not eliminate the complexity of agentic systems. It makes the complexity visible at a boundary where engineers can reason about it. That is a good trade.

The durable design pattern is straightforward: discover capabilities through a contract, filter them through local policy, delegate the smallest useful context, represent work as a task with an explicit lifecycle, choose delivery semantics deliberately, make retries and cancellation safe, and verify outcomes with evidence stronger than the agent’s prose.

The promise of A2A is not that agents can talk to one another. They already can, in improvised ways. The promise is that collaboration can become **inspectable, negotiable, and recoverable** across independent systems. That is the standard worth designing for.

## References

[1]: https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/ "Announcing the Agent2Agent Protocol (A2A) - Google Developers Blog"
[2]: https://a2a-protocol.org/latest/specification/ "Agent2Agent (A2A) Protocol Specification"
[3]: https://github.com/a2aproject/A2A "Agent2Agent official repository"
