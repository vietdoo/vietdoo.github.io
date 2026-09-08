---
title: "Voice Agent khi bị ngắt lời: Turn-Taking, Barge-In và Handoff an toàn"
description: "Playbook production cho voice agent biết nhận diện ranh giới lượt nói, dừng ngay khi người dùng barge-in, sửa intent dang dở và handoff an toàn mà không làm mất context cuộc hội thoại."
pubDate: 2026-07-30
category: "engineering"
image: "/blog/voice-agents-interruption/hero.webp"
lang: "vi"
translationKey: "voice-agents-interruption"
draft: false
---

![Voice agent xử lý interruption bằng turn detection, cancellation, repair và human handoff trong một minh họa vẽ tay](/blog/voice-agents-interruption/hero.webp)

Về mặt kỹ thuật, voice agent vẫn đang nghe. Nhưng nó không lắng nghe người đang nói.

Một khách hàng nói: “Không, đó không phải địa chỉ—” và agent vẫn tiếp tục đọc một đoạn xác nhận dài. Speech recognizer đã nhận được từ. Ứng dụng lại không xem đó là một interruption. Luồng text-to-speech vẫn phát, LLM vẫn generate và người gọi phải nói to hơn để cạnh tranh với một cái máy vốn được tạo ra để giúp mình.

Cuộc gọi kết thúc với hai transcript: một cho những gì agent đã nói và một cho những gì khách hàng cố sửa. Không transcript nào thể hiện rõ intent cuối cùng. Hệ thống phía sau sau đó đặt lịch sai.

Đó là lý do voice reliability không đồng nghĩa với transcription accuracy. Voice agent phải phối hợp audio capture, end-of-turn detection, speech recognition, model generation, speech synthesis, cancellation và state repair dưới áp lực thời gian rất chặt. Chỉ một lần bỏ sót interruption cũng có thể khiến mọi lớp sau đó tự tin đi sai.

> **Luận điểm:** Một voice agent tự nhiên không phải agent nói thật nhanh. Đó là agent biết nhường lời nhanh, giữ lại partial intent, cancel công việc không còn liên quan và biết khi nào human nên tiếp quản.

Tài liệu turn-handling của LiveKit mô tả turn detection là quá trình xác định lúc user bắt đầu hoặc kết thúc một lượt nói, đồng thời phân biệt VAD, endpointing, semantic turn detector, realtime-model detection và manual control. Đây là các lựa chọn triển khai. Câu hỏi production rộng hơn là: state nào được phép đổi khi user nói chồng lên agent, và làm sao ngăn response cũ rò vào lượt nói mới?

## Conversation turn là state transition

Voice conversation thường được vẽ như chuỗi gọn gàng: user nói, model nghĩ, agent trả lời. Lời nói thật thì chồng lấn, dang dở, có sửa lại và chứa nhiều backchannel như “ừm”, “đúng”, “okay”. Hệ thống phải quyết định âm thanh đó là instruction mới, phần tiếp theo, sự xác nhận hay noise.

| Signal | Có thể mang nghĩa | Rủi ro nếu phân loại sai |
|---|---|---|
| Câu ngắn khi agent đang nói | Backchannel hoặc interruption thật | Agent dừng thừa hoặc bỏ qua correction |
| Im lặng sau một phrase | End-of-turn hoặc pause để suy nghĩ | Agent trả lời quá sớm hoặc chờ quá lâu |
| Partial transcript | Correction chưa xong hoặc request mới | Agent commit vào intent dang dở |
| Tiếng lớn ở background | Người khác, TV hoặc user interruption | Agent hành động theo sai speaker |
| User nói “wait” hoặc “no” | Stop/correction rõ ràng | TTS cũ che mất tín hiệu an toàn |

Ứng dụng nên biểu diễn các khả năng này rõ ràng thay vì để một boolean `isSpeaking` điều khiển cả pipeline. Mô hình hữu ích tách việc user đang làm khỏi việc agent đang làm.

![State machine của voice agent đi qua listening, thinking, speaking, interrupted, repair và handoff](/blog/voice-agents-interruption/turn-state-machine.webp)

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

Transition từ `speaking` sang `interrupted` phải nhanh và có authority. Nó cần stop hoặc drain TTS stream, cancel model generation nếu có thể, đánh dấu response cũ là superseded và giữ audio/transcript evidence đã kích hoạt transition. “Dừng nói” là chưa đủ nếu token stream cũ vẫn tiếp tục đẩy audio vào queue.

## Turn detection là control loop, không phải một threshold

Voice activity detection hữu ích vì phát hiện speech và silence nhanh. Nó không luôn biết một người đã nói xong ý hay chưa. Endpointing thêm delay, nhưng fixed delay là một thỏa hiệp: quá ngắn tạo response sớm, quá dài làm agent chậm. Semantic turn detection có thể dùng meaning của speech bên cạnh acoustic. Realtime model có thể cung cấp detection phía server.

LiveKit ghi lại các mode này và các option hỗ trợ như endpointing delay, adaptive interruption handling, VAD và noise cancellation. Lựa chọn đúng phụ thuộc ngôn ngữ, chất lượng kênh, latency budget và session là phone call, browser microphone, push-to-talk hay cuộc họp nhiều người.

Đừng xem detector là sự thật tuyệt đối. Hãy xem nó là signal đi cùng confidence và policy. Với câu hỏi thông tin ít rủi ro, endpoint sớm có thể được sửa trong hội thoại. Trước irreversible action, endpoint không chắc chắn không đủ để trigger commit.

Policy thực tế nên có ba thời điểm:

1. **Candidate end:** detector tin user có thể đã nói xong.
2. **Commit end:** hệ thống quyết định đã có intent đủ ổn định để bắt đầu hoặc tiếp tục generation.
3. **Action end:** hệ thống quyết định intent đủ rõ để tạo external effect.

Ba thời điểm có thể chỉ cách nhau vài mili-giây hoặc một human confirmation. Gộp chúng thành một event là cách một câu nói dở dang biến thành một order hoàn chỉnh.

## Barge-in phải cancel toàn bộ response path

Barge-in không chỉ là hạ volume của agent. Nó là một cancellation transaction xuyên qua audio, synthesis, generation và action đang xếp hàng.

![Audio pipeline đi từ microphone qua VAD, turn detection, STT, LLM, TTS với cancellation path nhanh khi có interruption](/blog/voice-agents-interruption/audio-pipeline.webp)

Khi user speech vượt qua interruption policy, hệ thống nên:

| Bước | Hành vi bắt buộc | Failure nếu bỏ qua |
|---|---|---|
| Detect | Đánh dấu audio là possible interruption | Agent tiếp tục nói đè user |
| Stop audio | Cancel TTS và clear playback buffer | Từ cũ tiếp tục phát sau correction |
| Cancel compute | Cancel hoặc supersede generation hiện tại | Token cũ được synthesize về sau |
| Giữ partial input | Giữ transcript và timestamp | Repair mất điều user thực sự nói |
| Reconcile intent | Phân biệt correction, task mới hay backchannel | Plan sai tiếp tục sống |
| Resume hoặc handoff | Trở lại listening, repair hoặc human queue | Cuộc gọi thành dead end |

Cancellation phải idempotent. Interruption có thể đến trong lúc cancellation đang chạy. Nhiều stop signal không nên tạo error khiến agent không thể nghe lại. Turn cũ nên có cancellation reason như `user_barge_in`, `policy_stop` hoặc `system_timeout`.

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

Response queue nên dùng turn ID để audio của turn cũ không thể phát sau khi hội thoại đã chuyển tiếp. Nếu synthesis provider không cancel được audio đã buffer, client phải gate playback bằng current turn ID và loại bỏ stale chunk.

## Giữ partial intent, không chỉ partial text

Partial transcript không tự động là partial intent. “Không, để ngày mai buổi sáng” có thể sửa date, đổi time hoặc mở một request mới tùy phần trước đó. Repair layer cần previous committed intent, partial transcript hiện tại và context hội thoại an toàn để reuse.

Repair decision nên rõ ràng:

```ts
type RepairDecision =
  | { kind: "backchannel" }
  | { kind: "correction"; fields: Record<string, string> }
  | { kind: "new_intent"; text: string }
  | { kind: "uncertain"; prompt: string };
```

Nếu user interruption là correction rõ ràng, hệ thống có thể acknowledge ngắn và dựng lại plan. Nếu signal mơ hồ, hãy hỏi một câu ngắn thay vì đoán. Voice interface có ít chỗ cho clarification dài vì user không thể vừa nghe vừa scan màn hình để so sánh nhiều lựa chọn.

Agent không nên lặp lại toàn bộ câu trả lời cũ sau mỗi interruption. Hãy repair phần nhỏ nhất bị ảnh hưởng: “Đã rõ — sáng mai, không phải hôm nay. Bạn muốn mấy giờ?” Cách này tự nhiên hơn và an toàn hơn vì làm field thay đổi hiện ra rõ ràng.

## Đặt latency budget quanh việc nhường lời

Latency voice thường được nói đến như time to first response. Với interruption, time to yield cũng quan trọng không kém. Response đầu tiên chậm thì khó chịu; dừng chậm sau khi user nói “không” là mất niềm tin.

![Timeline latency voice mang tính khái niệm gồm stop, endpoint, partial STT, first token, first audio và agent response cùng barge-in cancellation path](/blog/voice-agents-interruption/latency-budget.webp)

Ít nhất hãy đo bốn khoảng thời gian:

| Khoảng thời gian | Ý nghĩa | Áp lực thiết kế |
|---|---|---|
| Speech-to-detection | User bắt đầu/kết thúc nói đến detector signal | Noise handling và lựa chọn VAD |
| Detection-to-stop | Interruption signal đến audio agent im lặng | Client buffer và cancellation path |
| Stop-to-listen | Agent im lặng đến lúc nhận input mới | Reset state và audio pipeline readiness |
| End-to-first-audio | User hết lượt đến audio agent đầu tiên | STT, model, TTS và streaming overlap |

Đừng tối ưu bằng cách bỏ khoảng pause giúp người nói hoàn tất ý. Hãy làm cancellation độc lập với reasoning path chậm hơn. Fast path phải dừng audio trước khi model quyết định xong interruption có nghĩa gì.

## Backchannel cũng là một phần thiết kế

Một người có thể nói “ừ” khi agent đang nói mà không yêu cầu agent dừng. Nếu âm thanh ngắn nào cũng trigger barge-in, hệ thống sẽ cứng nhắc. Nếu không âm thanh ngắn nào trigger interruption, hệ thống sẽ bỏ qua correction thật.

Adaptive interruption handling có thể dùng acoustic feature, lexical cue, timing và loại response hiện tại. Backchannel trong một giải thích ít rủi ro có thể được bỏ qua. “Không”, “dừng lại”, “chờ” hoặc correction của entity nên có interrupt weight cao hơn. Policy cũng có thể học từ repair của user: nếu user lặp lại cùng correction, detector đã quá bảo thủ.

Hãy tách việc học này khỏi live action policy. Agent không nên tự đổi interruption threshold giữa một cuộc gọi rủi ro cao nếu không có configuration change có audit. Tune từ outcome aggregate, audio replay và human review.

## Handoff là continuation, không phải transfer button

Human handoff phải giữ được conversation mà không bắt human nghe từng giây audio. Handoff packet nên có intent hiện tại, field đã xác nhận, field còn uncertain, action state, user sentiment chỉ khi cần và lý do escalation chính xác.

Một handoff tốt làm boundary hiện rõ: “Assistant đã dừng trước khi đổi lịch vì date bị sửa trong lúc nói. Vui lòng xác nhận sáng mai với caller.” Nó không được claim lịch đã đổi khi hệ thống mới chỉ chuẩn bị request.

Handoff có thể trigger bởi interruption repair lặp lại, high-risk action, detector confidence thấp, language mismatch, audio condition xấu hoặc user yêu cầu gặp người. Các trigger này nên thuộc policy và metrics thay vì ẩn trong prompt.

## Đánh giá voice agent theo slice

Một điểm “conversation success” duy nhất che mất failure quan trọng. Hãy đánh giá interruption theo vị trí, độ dài, noise, ngôn ngữ, channel, độ dài response và interruption là backchannel hay correction.

| Slice | Câu hỏi |
|---|---|
| Interruption sớm | Agent dừng trước khi tạo câu gây hiểu lầm không? |
| Interruption giữa action | Agent cancel external plan trước commit không? |
| Correction entity | Agent chỉ cập nhật field đổi không? |
| Backchannel | Agent tiếp tục mà không restart thừa không? |
| Interruption lặp lại | Agent escalate thay vì loop vô hạn không? |
| Handoff | Human nhận được state gọn và trung thực không? |

Hãy review cả audio và state. Transcript có thể đúng trong khi user đã nghe audio cũ. Model response có thể lịch sự trong khi appointment backend nhận date cũ. Evaluation unit cuối cùng là conversation cộng với external effect.

## Lộ trình rollout an toàn hơn

Bắt đầu bằng agent có thể nghe và trả lời nhưng không có side effect. Thêm barge-in cancellation và đo time to silence trước khi tune voice style. Đưa repair vào một nhóm structured field nhỏ. Thêm draft mode cho external action. Chỉ sau đó mới cho phép commit, kèm confirmation rõ ràng và post-action verification.

Giữ event của turn cũ cho debug, nhưng không bao giờ để audio hoặc plan cũ còn executable. High-risk action nên đi qua human hoặc confirmation surface riêng. Hãy test bằng pause thực tế, accent, background noise, speaker chồng lấn và user đổi ý giữa câu.

## Thói quen làm voice nghe giống con người

Voice agent tự nhiên nhất không phải agent cố bắt chước cảm xúc thật mạnh. Đó là agent tôn trọng nhịp của hội thoại. Nó dừng khi người kia cần sửa. Nó giữ phần hữu ích của câu nói. Nó hỏi một câu nhỏ thay vì buộc người dùng bắt đầu lại. Nó handoff mà không giả vờ công việc đã xong.

Interruption không phải edge case của voice. Nó chính là hội thoại. Khi hệ thống xem turn-taking là state management, barge-in trở thành cancellation path có kiểm soát, repair trở thành transition hạng nhất và handoff trở thành continuation trung thực của cùng task.

## Tài liệu tham khảo

[1]: https://docs.livekit.io/agents/logic/turns/ "LiveKit Documentation, Turns Overview"
[2]: https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/ "LiveKit Documentation, Adaptive Interruption Handling"
[3]: https://docs.livekit.io/agents/start/testing/ "LiveKit Documentation, Testing Voice Agents"
[4]: https://arxiv.org/html/2606.13544v1 "Adaptive Turn-Taking for Real-time Multi-Party Voice Agents"

## Đọc thêm

- [When AI Gives a Partial Answer: Designing Failure UX for Uncertainty](/blog/ai-partial-answer-uncertainty-ux)
- [Human-in-the-Loop Is Not an Approve Button: Designing Action Gates Without Consent Fatigue](/blog/human-in-loop-action-gate-consent-fatigue)
- [Durable Execution for AI Agents: Checkpoints, Resume, and Safe Retries](/blog/durable-execution-ai-agent)
