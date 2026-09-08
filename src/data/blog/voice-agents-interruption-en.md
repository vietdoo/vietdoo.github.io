---
title: "Voice Agents Under Interruption: Turn-Taking, Barge-In, and Safe Handoffs"
description: "A production playbook for voice agents that can detect turn boundaries, stop speaking when a person barges in, repair partial intent, and hand off safely without losing the conversation state."
pubDate: 2026-07-30
category: "engineering"
image: "/blog/voice-agents-interruption/hero.webp"
lang: "en"
translationKey: "voice-agents-interruption"
draft: false
---

![A hand-drawn voice agent handles an interruption through turn detection, cancellation, repair, and human handoff](/blog/voice-agents-interruption/hero.webp)

The voice agent was technically listening. It was not listening to the person.

A customer said, “No, that is not the address—” and the agent continued reading a long confirmation script. The speech recognizer had detected the words. The application had not treated them as an interruption. The text-to-speech stream kept playing, the LLM kept generating, and the caller started speaking louder to compete with a machine that was supposed to help.

The call ended with two transcripts: one for what the agent said and one for what the customer tried to correct. Neither represented the final intent clearly. The downstream system then scheduled the wrong appointment.

This is why voice reliability is not the same as transcription accuracy. A voice agent has to coordinate audio capture, end-of-turn detection, speech recognition, model generation, speech synthesis, cancellation, and state repair under tight timing. A single missed interruption can make every layer after it confidently wrong.

> **The thesis:** A natural voice agent is not one that talks quickly. It is one that yields quickly, preserves partial intent, cancels work that is no longer relevant, and knows when a human should take over.

LiveKit’s turn-handling documentation describes turn detection as the process of determining when a user begins or ends a turn, and distinguishes VAD, endpointing, semantic turn detectors, realtime-model detection, and manual control. Those are implementation choices. The production design question is broader: what state may change when the user speaks over the agent, and how do we prevent the old response from leaking into the new one?

## Conversation turns are state transitions

A voice conversation is often drawn as a neat sequence: user speaks, model thinks, agent responds. Real speech is overlapping, unfinished, corrected, and full of backchannels such as “mm-hm,” “right,” or “okay.” The system must decide whether a sound is a new instruction, a continuation, a confirmation, or noise.

| Signal | Possible meaning | Risk if classified incorrectly |
|---|---|---|
| Short utterance during agent speech | Backchannel or true interruption | The agent stops unnecessarily or ignores a correction |
| Silence after a phrase | End of turn or thinking pause | The agent responds too early or waits too long |
| Partial transcript | Incomplete correction or new request | The agent commits to an unfinished intent |
| Loud background speech | Another person, TV, or user interruption | The agent acts on the wrong speaker |
| User says “wait” or “no” | Explicit stop/correction | Old TTS continues and masks the safety signal |

The application should represent these possibilities explicitly rather than letting a single boolean called `isSpeaking` control the whole pipeline. A useful state model separates what the user is doing from what the agent is doing.

![A voice-agent state machine moves through listening, thinking, speaking, interrupted, repair, and handoff](/blog/voice-agents-interruption/turn-state-machine.webp)

```ts
type TurnState =
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "repairing"
  | "handoff";

type ConversationTurn = {
  id: string;
  state: TurnState;
  partialTranscript: string;
  committedIntent?: string;
  cancelGeneration?: () => Promise<void>;
  stopAudio?: () => Promise<void>;
};
```

The state transition from `speaking` to `interrupted` must be fast and authoritative. It should stop or drain the TTS stream, cancel model generation when possible, mark the old response as superseded, and preserve the audio and transcript evidence that triggered the transition. “Stop talking” is not enough if the old token stream continues to enqueue audio.

## Turn detection is a control loop, not a threshold

Voice activity detection is useful because it detects speech and silence quickly. It cannot always tell whether a person has finished a thought. Endpointing adds a delay, but a fixed delay is a compromise: too short causes premature responses, too long makes the agent feel slow. Semantic turn detection can use the meaning of speech in addition to acoustics. Realtime models may provide their own server-side detection.

LiveKit documents these modes and supporting options, including endpointing delay, adaptive interruption handling, VAD, and noise cancellation. The correct choice depends on language, channel quality, latency budget, and whether the session is a phone call, browser microphone, push-to-talk tool, or meeting with multiple speakers.

Do not treat the detector as a universal truth. Treat it as a signal with confidence and a policy around it. For a low-risk informational query, an early endpoint can be repaired conversationally. Before an irreversible action, an uncertain endpoint should not be enough to trigger a commit.

A practical policy has three moments:

1. **Candidate end:** the detector believes the user may have finished.
2. **Commit end:** the system decides it has enough stable intent to start or continue generation.
3. **Action end:** the system decides the intent is sufficiently confirmed for an external effect.

These moments may be separated by milliseconds or by a human confirmation. Collapsing them into one event is how a partial sentence becomes a complete order.

## Barge-in must cancel the whole response path

Barge-in is not merely lowering the agent’s volume. It is a cancellation transaction across audio, synthesis, generation, and queued actions.

![The real-time voice pipeline routes microphone audio through VAD, turn detection, STT, LLM, and TTS, with a fast cancellation path for interruption](/blog/voice-agents-interruption/audio-pipeline.webp)

When user speech crosses the interruption policy, the system should:

| Step | Required behavior | Failure if skipped |
|---|---|---|
| Detect | Mark the new audio as possible interruption | The agent keeps speaking over the person |
| Stop audio | Cancel TTS and clear buffered playback | Old words continue after the correction |
| Cancel compute | Cancel or supersede the current generation | Stale tokens are synthesized later |
| Preserve partial input | Keep the transcript and timestamps | Repair loses what the user actually said |
| Reconcile intent | Decide whether it is correction, new task, or backchannel | The wrong plan survives the interruption |
| Resume or hand off | Return to listening, repair, or human queue | The call becomes a dead end |

Cancellation must be idempotent. An interruption can arrive while a cancellation is already in progress. Multiple stop signals should not create an error that prevents the agent from listening again. The old turn should carry a cancellation reason such as `user_barge_in`, `policy_stop`, or `system_timeout`.

```ts
async function interrupt(turn: ConversationTurn, reason: string) {
  if (turn.state !== "speaking" && turn.state !== "thinking") return;

  turn.state = "interrupted";
  await Promise.allSettled([
    turn.stopAudio?.(),
    turn.cancelGeneration?.(),
  ]);

  await appendEvent({
    type: "turn_interrupted",
    turnId: turn.id,
    reason,
    at: new Date().toISOString(),
  });
}
```

The response queue should use turn IDs so that audio from an old turn cannot be played after the conversation has moved on. If the synthesis provider cannot cancel already-buffered audio, the client should gate playback using the current turn ID and discard stale chunks.

## Preserve partial intent, not just partial text

A partial transcript is not automatically a partial intent. “No, make that tomorrow morning” may correct a date, change a time, or start a new request depending on what came before. The repair layer needs the previous committed intent, the current partial transcript, and the conversation context that is safe to reuse.

The repair decision should be explicit:

```ts
type RepairDecision =
  | { kind: "backchannel" }
  | { kind: "correction"; fields: Record<string, string> }
  | { kind: "new_intent"; text: string }
  | { kind: "uncertain"; prompt: string };
```

If the user interrupts with a clear correction, the system can acknowledge briefly and rebuild the plan. If the signal is ambiguous, ask a short question rather than guessing. A voice interface has less room for a long clarification because the user cannot scan a screen and compare alternatives at the same time.

The agent should not repeat the entire previous answer after every interruption. It should repair the smallest affected unit: “Got it — tomorrow morning, not today. Which time works?” That is both more natural and safer because it makes the changed field visible.

## Design the latency budget around yielding

Voice latency is usually discussed as time to first response. For interruption handling, time to yield matters just as much. A slow first response is awkward; a slow stop after a person says “no” is a trust failure.

![A conceptual voice latency timeline shows stop, endpoint, partial STT, first token, first audio, and agent response, with a fast barge-in cancellation path](/blog/voice-agents-interruption/latency-budget.webp)

Measure at least four intervals:

| Interval | Meaning | Design pressure |
|---|---|---|
| Speech-to-detection | User starts or stops speaking to detector signal | Noise handling and VAD choice |
| Detection-to-stop | Interruption signal to silent agent audio | Client buffering and cancellation path |
| Stop-to-listen | Agent silence to accepting new user input | State reset and audio pipeline readiness |
| End-to-first-audio | User turn end to agent audio | STT, model, TTS, and streaming overlap |

Do not optimize by removing the pause that lets a person finish a thought. Optimize by making cancellation independent of the slower reasoning path. The fast path should be able to stop audio before the model has finished deciding what the interruption means.

## Backchannels are part of the design

A person may say “yeah” while the agent is talking without asking it to stop. If every short sound triggers barge-in, the system feels brittle. If no short sound triggers interruption, the system ignores real corrections.

Adaptive interruption handling can use acoustic features, lexical cues, timing, and the current response type. A backchannel during a low-stakes explanation may be ignored. “No,” “stop,” “wait,” or a correction of an entity should receive a stronger interrupt weight. The policy can also learn from user repair: if the user repeats the same correction, the detector was too conservative.

Keep this learning separate from the live action policy. The agent should not change its own interruption threshold during a high-risk call without an auditable configuration change. Tune from aggregated outcomes, replayed audio, and human review.

## Handoff is a continuation, not a transfer button

A human handoff should preserve the conversation without forcing the human to listen to every second of audio. The handoff packet should contain the current intent, confirmed fields, uncertain fields, action state, user sentiment only when necessary, and the exact reason for escalation.

A good handoff makes the boundary visible: “The assistant stopped before changing the appointment because the date was corrected during speech. Please confirm tomorrow morning with the caller.” It should not claim that the appointment was changed when the system only prepared a request.

Handoff can be triggered by repeated interruption repair, high-risk action, low detector confidence, language mismatch, abusive audio conditions, or a user request for a person. These triggers should be part of policy and metrics rather than hidden in a prompt.

## Evaluate voice agents in slices

A single “conversation success” score hides the failure that matters. Evaluate interruptions by position, duration, noise level, language, channel, response length, and whether the interruption was a backchannel or correction.

| Slice | Question |
|---|---|
| Early interruption | Can the agent stop before producing a misleading sentence? |
| Mid-action interruption | Does it cancel the external plan before commit? |
| Entity correction | Does it update only the changed field? |
| Backchannel | Can it continue without forcing an unnecessary restart? |
| Repeated interruption | Does it escalate rather than loop forever? |
| Handoff | Does the human receive a compact, truthful state? |

Review both audio and state. A transcript may look correct while the user heard stale audio. A model response may look polite while the appointment backend received the old date. The final evaluation unit is the conversation plus the external effect.

## A safer rollout path

Start with an agent that can listen and answer without side effects. Add barge-in cancellation and measure time to silence before tuning voice style. Introduce repair for a small set of structured fields. Add draft mode for external actions. Only then allow commits, with explicit confirmation and post-action verification.

Keep the old turn’s events available for debugging, but never let old audio or old plans remain executable. Route high-risk actions through a human or a separate confirmation surface. Test with realistic pauses, accents, background noise, overlapping speakers, and users who change their mind halfway through a sentence.

## The habit that makes voice feel human

The most human voice agents are not the ones that imitate emotion most aggressively. They are the ones that respect the rhythm of a real conversation. They stop when someone needs to correct them. They keep the useful part of a sentence. They ask one small question instead of forcing a person to restart. They hand off without pretending the work is complete.

Interruption is not an edge case in voice. It is the conversation. Once the system treats turn-taking as state management, barge-in becomes a controlled cancellation path, repair becomes a first-class transition, and handoff becomes a truthful continuation of the same task.

## References

[1]: https://docs.livekit.io/agents/logic/turns/ "LiveKit Documentation, Turns Overview"
[2]: https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/ "LiveKit Documentation, Adaptive Interruption Handling"
[3]: https://docs.livekit.io/agents/start/testing/ "LiveKit Documentation, Testing Voice Agents"
[4]: https://arxiv.org/html/2606.13544v1 "Adaptive Turn-Taking for Real-time Multi-Party Voice Agents"

## Related reading

- [When AI Gives a Partial Answer: Designing Failure UX for Uncertainty](/blog/ai-partial-answer-uncertainty-ux)
- [Human-in-the-Loop Is Not an Approve Button: Designing Action Gates Without Consent Fatigue](/blog/human-in-loop-action-gate-consent-fatigue)
- [Durable Execution for AI Agents: Checkpoints, Resume, and Safe Retries](/blog/durable-execution-ai-agent)
