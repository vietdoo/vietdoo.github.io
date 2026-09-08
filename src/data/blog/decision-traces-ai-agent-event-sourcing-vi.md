---
title: "Decision Trace cho AI Agent: Event Sourcing đường đi của Action mà không log Chain-of-Thought"
description: "Hướng dẫn production về decision trace theo mô hình event sourcing cho AI Agent: audit đường đi của action, điều tra incident, bảo vệ privacy và giải thích kết quả mà không biến chain-of-thought riêng tư thành schema log."
pubDate: 2026-07-29
category: "engineering"
image: "/blog/decision-traces/hero.webp"
lang: "vi"
translationKey: "decision-traces-ai-agent-event-sourcing"
draft: false
---

![Whiteboard vẽ tay mô tả decision ledger của AI Agent, evidence reference, policy gate và đường replay](/blog/decision-traces/hero.webp)

Tôi từng debug một automation đã làm đúng về mặt kỹ thuật, nhưng lại làm đúng vì một lý do sai. Action cuối cùng nhìn khá vô hại. Request trả về `200`, một dòng trong database đã được cập nhật, người dùng nhận được tin nhắn xác nhận lịch sự. Ba tiếng sau, có người đặt câu hỏi quan trọng nhất sau khi một hệ thống tự động đã thay đổi thế giới:

**Agent thực sự đã nhìn thấy gì, policy nào cho phép action đó, và nó nghĩ mình đang thay đổi state nào?**

Chúng tôi có trace, nhưng chưa có decision trace. Có thể nhìn thấy model call và tool call. Không thể dựng lại toàn bộ action đã được chấp nhận thành một câu chuyện có thứ tự, liền mạch. Log hữu ích cho việc đo latency, nhưng chưa đủ cho accountability.

Sự khác biệt này ngày càng quan trọng khi AI Agent đi từ việc soạn thảo văn bản sang phê duyệt yêu cầu, thay đổi record, gọi API và điều phối workflow chạy dài. Application log thông thường nói rằng một việc đã xảy ra. Telemetry span nói một operation mất bao lâu. Decision trace cần trả lời câu hỏi mạnh hơn:

> **Hệ thống đã chấp nhận quyết định nào, evidence và policy reference nào hỗ trợ quyết định đó, state transition nào xảy ra sau đó, và làm sao chứng minh record chưa bị viết lại về sau?**

Bài viết này trình bày một pattern thực dụng: coi đường đi của action mà agent đã chấp nhận như một append-only domain event stream. Telemetry của model, evidence reference, policy decision, approval, tool outcome và state transition được nối với nhau bằng correlation ID và causation ID. Ta lưu đủ để điều tra và replay decision path, nhưng không biến chain-of-thought riêng tư thành một schema database bắt buộc.

## Decision trace không phải là “log nhiều hơn”

Sai lầm đầu tiên là nhét mọi artifact vào một JSON blob khổng lồ tên `agent_trace`. Object đó rất nhanh trở thành hỗn hợp của prompt text, provider metadata, debug statement, business event và secret được redact nửa vời. Nó khó query, khó governance nhất quán và thường quá lớn để retention an toàn.

Một thiết kế tốt hơn tách bốn lớp. **Telemetry** mô tả execution: span, latency, token count, provider, model và error. Registry semantic convention cho GenAI của OpenTelemetry có các attribute cho agent identity, conversation identity, provider, requested model, input/output message và evaluation metadata. **Evidence reference** mô tả tài liệu mà agent được phép sử dụng: document ID, version, data classification và thời điểm retrieval. **Decision event** mô tả điều hệ thống đã accept, deny, escalate hay defer. **Domain event** mô tả state change bên ngoài, chẳng hạn `RefundApproved` hoặc `TicketAssigned`.

| Lớp | Câu hỏi chính | Ví dụ | Cách retention |
|---|---|---|---|
| Telemetry | Execution đã chạy như thế nào? | model span, tool span, p95 latency, token usage | retention vận hành và sampling |
| Evidence reference | Thông tin nào đã có sẵn? | document version, row ID, retrieval time | theo data policy |
| Decision event | Control plane đã quyết định gì? | allow, deny, escalate, defer | audit retention dạng append-only |
| Domain event | Thế giới nghiệp vụ đã thay đổi gì? | `RefundApproved`, `InvoiceHeld` | business system of record |
| Artifact hash | Có thể chứng minh content nào đã được dùng hoặc sinh ra không? | SHA-256 của output được lưu | proof dài hạn mà không cần plaintext |

Việc tách lớp này ngăn một lỗi nhận thức phổ biến: nghĩ rằng vì đã có LLM span nên hệ thống đã có audit trail. Span có thể nói model đã được gọi. Nó không tự động chứng minh policy version nào được đánh giá, tool permission nào đang active, hay side effect đã được accept một lần hay hai lần.

## Event-sourced action path

Event sourcing phù hợp vì decision chính là một state transition. Thay vì ghi đè `agent_status = approved`, hệ thống append các event giải thích trạng thái đã hình thành như thế nào. Status hiện tại trở thành projection của event stream, còn stream là historical record.

Một chuỗi nhỏ nhưng hữu ích thường có dạng:

```text
RequestReceived
  -> ContextResolved
  -> EvidenceSelected
  -> PolicyEvaluated
  -> DecisionProposed
  -> HumanApprovalRequested (optional)
  -> DecisionAccepted / DecisionDenied / DecisionEscalated
  -> ToolInvocationStarted
  -> ToolInvocationCompleted
  -> DomainStateChanged
  -> OutcomeRecorded
```

Thứ tự có ý nghĩa. Agent có thể tạo candidate action trước khi con người approve, nhưng candidate không giống accepted decision. Tool invocation có thể timeout sau khi hệ thống remote đã commit thay đổi, vì vậy `ToolInvocationTimedOut` không thể được coi là bằng chứng rằng chưa có gì xảy ra. Trace phải làm rõ các khác biệt này, thay vì ép mọi thứ vào một success flag.

![Whiteboard vẽ tay event ledger cho AI Agent, nối request, evidence, policy, approval, tool execution và outcome bằng các mũi tên nhân quả](/blog/decision-traces/decision-ledger.webp)

Bài viết về decision trace của Streamkap mô tả một chuỗi tương tự, bắt đầu từ data event, đi qua context lookup, reasoning, action rồi tới outcome. Bài học production không phải là copy nguyên tên event của một vendor. Điều quan trọng là chuỗi phải đủ rõ để người điều tra incident lần theo cùng một request qua data access, policy layer, agent runtime và business system.

### Hãy thiết kế decision envelope, không phải cột chain-of-thought

Decision event nên lưu basis có ý nghĩa bên ngoài đối với action. Nó không cần lưu mọi intermediate thought ẩn mà model tạo ra. Thực tế, coi chain-of-thought riêng tư là audit artifact bắt buộc có thể tạo ra vấn đề privacy, retention và security mà vẫn không bảo đảm explanation trung thực.

Một decision envelope thực dụng có thể như sau:

```json
{
  "event_id": "evt_01JX7M8M4A6P",
  "event_type": "DecisionAccepted",
  "occurred_at": "2026-07-29T09:14:03.280Z",
  "tenant_id": "tenant_42",
  "trace_id": "trc_01JX7M4Q2K9N",
  "causation_id": "evt_01JX7M7ZB1D2",
  "actor": {
    "kind": "ai_agent",
    "agent_id": "refund-agent",
    "agent_version": "2026.07.4"
  },
  "capability": "refund_approval_v2",
  "policy": {
    "policy_id": "refund-policy",
    "policy_version": "17",
    "decision": "allow",
    "rules_fired": ["under_limit", "identity_verified"]
  },
  "evidence": [
    {"kind": "order", "id": "ord_1842", "version": "9", "sensitivity": "internal"},
    {"kind": "payment_status", "id": "pay_1842", "observed_at": "2026-07-29T09:14:02Z"}
  ],
  "proposed_action": {
    "tool": "issue_refund",
    "arguments_hash": "sha256:...",
    "idempotency_key": "refund:ord_1842:v1"
  },
  "approval": {"required": false, "actor": null},
  "privacy": {"content_stored": false, "redaction_profile": "payments-v3"},
  "previous_hash": "sha256:..."
}
```

Hãy để ý những gì có mặt: policy có version, evidence đã chọn, capability, action intent, idempotency key và privacy profile. Hãy để ý những gì vắng mặt: không có tuyên bố rằng hidden reasoning của model là một explanation đầy đủ và ổn định. Event chứng minh control decision cùng những input mà control plane đã tham chiếu. Nếu cần explanation cho con người, hãy tạo explanation từ các structured fact này và gọi đúng tên nó là explanation, không phải internal thought process được phục hồi.

## Causation, correlation và ordering là reliability layer

Trace ID gom các event của một request hoặc workflow logic. Causation ID nói event nào trực tiếp gây ra event hiện tại. Correlation ID có thể nối các trace liên quan, chẳng hạn customer request, background reconciliation job và human approval về sau. Đây không phải metadata trang trí. Chúng giúp người điều tra phân biệt retry với một business action mới.

| Identifier | Ý nghĩa | Ví dụ sử dụng |
|---|---|---|
| `trace_id` | Một agent request hoặc workflow logic | gom toàn bộ event của refund decision |
| `causation_id` | Event tiền nhiệm trực tiếp | nối `PolicyEvaluated` với `DecisionAccepted` |
| `correlation_id` | Ngữ cảnh nghiệp vụ hoặc incident rộng hơn | nối user request với reconciliation run |
| `event_id` | Identity duy nhất, bất biến của event | deduplicate consumer và chứng minh event identity |
| `sequence` | Vị trí tăng dần trong stream | phát hiện event bị mất hoặc đảo thứ tự |

At-least-once delivery thường là default trung thực. Nếu consumer nhìn thấy `ToolInvocationCompleted` hai lần, projection phải chỉ xử lý một lần dựa trên `event_id`. Nếu tool call có idempotency key, action executor có thể reconcile timeout trước khi tạo side effect lần thứ hai. Đây là điểm pattern kết nối với bài idempotent AI actions trong folio: trace không thay thế idempotency, nhưng cung cấp evidence để runtime quyết định replay có an toàn hay không.

Để tạo tamper evidence, có thể chain mỗi event với hash của event trước đó hoặc định kỳ anchor stream hash vào một trust boundary khác. Hash chaining không tự động biến payload thành sự thật; nó chỉ khiến việc âm thầm sửa lịch sử khó bị che giấu hơn. Event producer, key management, clock source và access policy vẫn rất quan trọng.

## Replay không phải re-execution

Câu hỏi “có thể replay agent không?” vốn không rõ nghĩa. Có ít nhất ba operation khác nhau:

1. **Projection replay:** dựng lại read model từ immutable event stream. Không cần model call và không cần external side effect.
2. **Decision-path replay:** tái dựng evidence, policy, route, approval và tool outcome đã được ghi nhận tại thời điểm đó. Đây là operation điều tra.
3. **Re-execution:** gọi lại model hoặc tool. Thế giới có thể đã thay đổi, provider có thể trả lời khác, operation có thể tạo side effect.

![Whiteboard vẽ tay so sánh projection replay và decision-path replay an toàn với model re-execution và duplicate side effect có rủi ro](/blog/decision-traces/replay-vs-reexecute.webp)

Incident console tốt nên có các button tách biệt cho ba operation này. “Rebuild projection” phải an toàn. “Show decision path” phải read-only. “Re-run tool” phải yêu cầu authorization rõ ràng, idempotency key mới hoặc reconciliation step, cùng cảnh báo blast radius dễ nhìn.

Phân biệt này cũng giúp tránh hứa hẹn sai về tính deterministic. Decision trace đã ghi có thể nói hệ thống đã accept gì lúc đó. Nó không bảo đảm một model call mới hôm nay sẽ trả lời giống vậy. Nếu cần reproducibility, hãy lưu model/provider version, prompt template version, sampling configuration, tool schema, evidence version, policy version và content hash liên quan. Dù vậy, coi re-execution là một experiment mới, không phải historical fact.

## Privacy boundary: chứng minh event mà không giữ secret

Audit system dễ xây nhất thường là hệ thống kém an toàn nhất: copy mọi prompt và model response vào log sink rồi hứa sẽ redact sau. Sensitive content có thể lan qua collector, index, backup, support export và laptop của developer trước khi job redact chạy.

Hướng dẫn minimum audit trail của ARMO phân biệt infrastructure log với application-layer agent-action log. Nguồn này khuyến nghị redact tại source và lưu data shape, sensitivity classification, semantic tag, byte count hoặc hash thay vì plaintext khi content không thực sự cần thiết.

![Whiteboard vẽ tay privacy boundary giữa prompt/tool content riêng tư và decision ledger đã redact, với hash và sensitivity label đi qua ranh giới](/blog/decision-traces/privacy-boundary.webp)

Retention đúng phụ thuộc domain. Healthcare workflow, public-sector service và developer sandbox không có cùng nghĩa vụ. Thiết kế nên trả lời bốn câu hỏi cho từng field:

| Câu hỏi | Quyết định mẫu |
|---|---|
| Field có cần để chứng minh control decision không? | Giữ policy ID, version, outcome và rule identifier. |
| Field có cần để dựng business state không? | Giữ domain event ID và source record version. |
| Plaintext có bắt buộc cho regulated investigation không? | Lưu encrypted content trong governed vault riêng, không đưa vào event stream chung. |
| Hash hoặc reference có đủ chứng minh content tồn tại mà không tiết lộ không? | Lưu content hash, destination reference, classification và retention pointer. |

Hash không phải deletion mechanism và cũng không tự động là anonymous. Nó vẫn có thể nhạy cảm nếu attacker đoán được input hoặc correlate với database khác. Hãy coi hash, identifier và metadata đều là governed data.

## Nên instrument gì trước?

Đừng bắt đầu bằng việc instrument từng token. Hãy bắt đầu từ những thời điểm làm thay đổi authority hoặc state. Bộ event tối thiểu hữu ích cho action-taking agent thường gồm request intake, identity assertion, data access, policy evaluation, decision outcome, human approval, tool invocation, tool result, error classification và domain state change.

OpenTelemetry cung cấp vocabulary hữu ích để correlate agent, conversation, provider/model, input/output và evaluation data. Dùng span cho các câu hỏi vận hành như latency và token cost. Dùng decision event cho các câu hỏi như “rule nào đã cho phép?” và “action này đã được accept một lần chưa?”. Dùng evidence reference cho câu hỏi “version nào của order hoặc policy đã hiển thị tại thời điểm đó?”.

Có thể bắt đầu bằng transactional outbox. Ghi domain change và audit event trong cùng một database transaction, publish event bất đồng bộ, sau đó làm consumer idempotent. Với workflow đi qua nhiều hệ thống, dùng append-only event store hoặc durable log có ordering và retention rõ. Pattern không nằm ở việc chọn Kafka hay Postgres. Nó nằm ở việc không để audit record phụ thuộc vào một lệnh `logger.info()` best-effort chạy sau side effect.

## Những failure mode nên test

| Failure mode | Weak system thường báo | Decision trace cần giữ |
|---|---|---|
| Model timeout sau khi tool đã tạo side effect | “request failed” | tool intent, idempotency key, remote receipt state, reconciliation outcome |
| Policy version thay đổi trong lúc retry | “retry succeeded” | policy version của từng attempt và accepted decision |
| Evidence bị stale | “agent chọn sai” | evidence ID, version, observed timestamp, freshness classification |
| Human approval bị bypass | “tool call completed” | approval requirement, approval event, actor, policy result, override reason |
| Duplicate event delivery | “tạo hai refund” | event ID, projection dedupe, domain idempotency result |
| Prompt/output có PII | “không thể đưa log cho compliance” | redaction profile, sensitivity tag, content hash hoặc governed reference |

Mục tiêu của bảng này không phải khuyến khích log nhiều hơn. Nó giúp làm rõ failure semantics. Trace phải giúp trả lời điều gì đã xảy ra, nhưng không được giả vờ rằng mọi vấn đề đều giải quyết được bằng cách gọi lại model.

## Lộ trình triển khai thực dụng

Hãy bắt đầu với một workflow có consequence cao thay vì toàn bộ agent platform. Chọn workflow đã từng có incident hoặc manual review. Định nghĩa event cho capability, policy, evidence, action, approval và outcome. Thêm trace ID, causation ID và event ID. Dựng một read model hiển thị action path bằng ngôn ngữ mà con người đọc được. Sau đó chạy shadow audit trong hai tuần trước khi thay đổi autonomy hoặc retention policy.

Tiếp theo, thêm contract test cho event schema. Test rằng mọi accepted action đều có policy version, evidence reference, actor và correlation ID. Test rằng denied action không thể emit domain mutation. Test rằng timeout tạo ra trạng thái uncertainty có thể recover thay vì tự động retry trùng side effect. Test redaction bằng payload gần thực tế, không chỉ bằng vài string giả lập.

Cuối cùng, đo usefulness thay vì volume. Metrics có ích gồm tỷ lệ action dựng lại được decision path, thời gian trả lời năm câu hỏi của một incident, duplicate-side-effect rate, stale-evidence rate, policy-override rate và tỷ lệ event bị reject vì thiếu field bắt buộc. Một triệu span không phải thành công nếu investigator vẫn không biết vì sao agent được phép hành động.

## Lời kết

Autonomous system không đáng tin hơn chỉ vì nó đưa ra explanation tự tin hơn. Nó đáng tin hơn khi authority được giới hạn, action có thể quan sát, evidence có version, state change có thể quy trách nhiệm và lịch sử khó bị viết lại.

Event-sourced decision trace là một điểm cân bằng thực dụng. Nó cho engineer một action path có thứ tự và có thể replay mà không bắt hệ thống lưu chain-of-thought riêng tư như một API contract. Nó cũng tạo ra ranh giới giữa model behavior và business accountability: model có thể vẫn probabilistic, nhưng accepted action phải đi qua policy được đặt tên, tham chiếu evidence đã biết và tạo ra state transition có thể truy vết.

Đó là tiêu chuẩn tôi muốn ở một AI Agent có quyền thay đổi production data: không phải “cho tôi xem model đã nghĩ gì”, mà là **cho tôi xem hệ thống đã accept gì, vì sao acceptance được phép, điều gì thay đổi tiếp theo và tôi có thể chứng minh điều đó về sau hay không.**

## Tài liệu tham khảo

[1]: https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/ "OpenTelemetry GenAI semantic-convention attribute registry"
[2]: https://streamkap.com/resources-and-guides/decision-traces-ai-agents "Streamkap — Decision Traces: Building Audit Trails for Autonomous AI Agents"
[3]: https://www.armosec.io/blog/minimum-viable-audit-trail/ "ARMO — What to Log for AI Agent Activity: The Minimum Viable Audit Trail"
[4]: https://www.nist.gov/itl/ai-risk-management-framework "NIST — AI Risk Management Framework"
