---
title: "Chaos Engineering cho AI Agent: Chủ động tiêm những lỗi production chắc chắn sẽ gặp"
description: "Playbook fault injection thực tế cho AI agent: tool timeout, provider outage, response sai cấu trúc, context stale, invariant phục hồi và promotion gate an toàn."
pubDate: 2026-08-31
category: "engineering"
image: "/blog/chaos-engineering-ai-agents/hero.webp"
lang: "vi"
translationKey: "chaos-engineering-ai-agents"
draft: false
---

![Tín hiệu lỗi có kiểm soát đi qua workflow AI agent tới một release gate được bảo vệ](/blog/chaos-engineering-ai-agents/hero.webp)

AI agent trong production hiếm khi hỏng vì model bỗng nhiên không còn biết nói tiếng Anh. Nó hỏng vì dependency timeout sau khi agent đã lập kế hoạch, tool trả về một trang rỗng nhưng HTTP status vẫn là thành công, provider đổi shape của một field, hoặc context tưởng là mới thực ra đã stale.

Những failure này nguy hiểm vì agent vẫn có thể trả lời rất trôi chảy. Thậm chí nó còn có thể báo task đã thành công. Dashboard chỉ theo dõi latency và HTTP error rate vì thế vẫn xanh, trong khi agent đã nhân đôi một action, bịa ra recovery hoặc tiếp tục dựa trên một sự thật đã hết hạn từ mười phút trước.

Đây là lúc chaos engineering trở nên hữu ích. Mục tiêu không phải phá ngẫu nhiên một AI system cho có vẻ “ngầu”. Mục tiêu là đưa vào một failure có giới hạn, quan sát được, rồi kiểm chứng hệ thống vẫn giữ được các property quan trọng: authority không tự mở rộng, external side effect không bị nhân đôi, observation stale không bị xem là fact hiện tại, và workflow đi tới một terminal state có thể nhìn thấy.

> **Luận điểm:** Đừng chỉ hỏi AI agent có hoàn thành happy path hay không. Hãy tiêm những failure khiến quyết định tiếp theo trở nên mơ hồ, sau đó kiểm tra state cuối bằng deterministic oracle.

Sự phân biệt này rất quan trọng. Offline evaluation hỏi agent có giải được task với input đã chọn hay không. Incident response hỏi phải làm gì sau khi failure đã tới người dùng. Chaos testing hỏi một câu vận hành khác trước khi điều đó xảy ra: **nếu dependency này hỏng đúng tại điểm này, agent có fail an toàn và recovery trung thực không?**

## Vì sao test agent thông thường bỏ sót failure nguy hiểm?

Một test thông thường hay mock mọi tool thành nhanh, đầy đủ và trung thực. Model nhận schema sạch, retriever trả đúng document và assertion cuối so sánh text với một câu trả lời kỳ vọng. Cách làm này có ích cho correctness cơ bản, nhưng chưa chạm vào ranh giới giữa reasoning và execution.

ReliabilityBench tách reliability của agent thành consistency, robustness và fault tolerance. Trong đó, fault tolerance bao gồm timeout, rate limit, partial response và schema change; phần đánh giá dùng end-state verification thay vì text similarity.[1] Đây là mental model tốt hơn cho production: hai câu trả lời có thể khác nhau về cách diễn đạt nhưng cùng đúng state, trong khi một câu trả lời rất mượt vẫn có thể che giấu state bị hỏng.

Số bước làm vấn đề nghiêm trọng hơn. Nếu mỗi action có xác suất failure độc lập là năm phần trăm, workflow hai mươi action không “reliable 95%”. Xác suất hoàn thành tất cả bước xấp xỉ 0,95^20, tức khoảng 36%. Hệ thống thực tế có correlated failure và retry nên phép tính này không phải service-level promise. Nó chỉ nhắc rằng một local failure nhỏ sẽ trở thành workflow problem lớn khi agent có quá nhiều cơ hội để hành động.

Hướng dẫn production của MLflow cũng xem agent là distributed system cần runtime governance, deterministic execution cho critical operation, evaluation nhúng trong workflow và shadow deployment cho thay đổi lớn.[2] Chaos experiment biến các nguyên tắc đó thành bằng chứng thay vì giả định.

## Bắt đầu bằng failure model, không phải random fault generator

Một experiment hữu ích bắt đầu bằng hypothesis. “Agent nên xử lý tool error” quá mơ hồ để test. “Nếu inventory tool timeout sau khi agent đã chuẩn bị reservation request, hệ thống không được reserve gì và phải yêu cầu fresh inventory check trước khi retry” đủ cụ thể để tạo oracle.

Hãy tách workflow thành các boundary nơi action tiếp theo có thể thay đổi. Thường đó là model call, tool call, retrieval read, approval gate, queue, state store và external write API. Ở mỗi boundary, liệt kê failure shape và property cần được bảo toàn.

| Boundary | Fault cần tiêm | Hành vi nguy hiểm của agent | Invariant bắt buộc |
|---|---|---|---|
| Model provider | Timeout, 429, output bị cắt, provider unavailable | Retry với instruction khác và duplicate write | Không có write nếu chưa có action intent hợp lệ, có version. |
| Read tool | Empty result, timestamp cũ, trang thiếu, content type sai | Xem “không có dữ liệu” là bằng chứng hoặc dùng fact hết hạn | Mỗi decision ghi rõ observation age và freshness status. |
| Write tool | Timeout sau khi server đã nhận request | Retry không có idempotency key | Một business operation có nhiều nhất một committed effect. |
| Schema boundary | Thiếu field, dư field, enum sai, JSON hợp lệ nhưng sai nghĩa | Tự suy ra authority còn thiếu từ context | Output invalid hoặc ambiguous trở thành typed refusal. |
| Approval gate | Approval hết hạn, reviewer reject, click trùng | Tiếp tục từ approval cũ | Approval gắn với action hash, actor, scope và expiry cụ thể. |
| Worker và queue | Restart, duplicate delivery, message trễ | Re-plan từ partial state | State transition monotonic và replay an toàn. |
| Context store | Memory stale, record mâu thuẫn, compaction làm mất dữ liệu | Trích dẫn memory cũ như sự thật hiện tại | Phải lộ conflict; destructive action không dùng context chưa phân giải. |

Matrix này có giá trị hơn danh sách dài các HTTP error vì nó nối fault với decision. Cùng là timeout nhưng vô hại với weather lookup chỉ đọc, còn nguy hiểm khi payment provider có thể đã nhận charge.

![Fault matrix định tuyến timeout, rate limit, outage, malformed data, stale context và worker restart qua những agent run có thể quan sát](/blog/chaos-engineering-ai-agents/fault-matrix.webp)

## Định nghĩa safety envelope trước khi tiêm fault

Chaos testing không được trở thành lý do làm hỏng customer account thật. Điểm bắt đầu an toàn nhất là environment cô lập với synthetic identity, fake payment instrument, tool có thể đảo ngược và state store deterministic có thể reset sau mỗi run.

Một safety envelope thực tế có bốn lớp:

1. **Data boundary.** Dùng dữ liệu sinh tự động hoặc đã scrub. Đừng copy production secret vào test cluster chỉ vì agent cần context giống thật.
2. **Authority boundary.** Thay destructive tool bằng simulator hoặc giới hạn tool trong namespace không thể chạm hệ thống thật. Mỗi capability gắn với tenant, workflow và expiry.
3. **Side-effect boundary.** Đưa write qua reversible adapter có thể ghi nhận intended effect và hỗ trợ compensation. Một “mock” nhưng âm thầm gọi API thật không phải mock.
4. **Stop boundary.** Mỗi experiment phải có kill switch, wall-clock limit, maximum action count và abort condition. Experiment controller phải dừng được workflow mà không cần model hợp tác.

Experiment cần được version hóa. Ghi lại agent build, model identifier, prompt và tool version, fault profile, seed hoặc replay input, environment và oracle version. Không có evidence này, một pass khó tái lập còn một failure khó giải thích.

![Synthetic data và reversible tool bao quanh một agent laboratory cô lập, có human approval gate và hard stop](/blog/chaos-engineering-ai-agents/safety-envelope.webp)

## Fault profile phải mô hình hóa semantics, không chỉ transport error

Bộ test chỉ tập trung vào transport thường đánh giá status code quá cao. Agent trải nghiệm ý nghĩa của kết quả, không chỉ HTTP envelope. Response `200 OK` chứa empty page, inventory của ngày hôm qua hoặc amount sai nghĩa nhưng đúng schema có thể nguy hiểm hơn một `500` rõ ràng.

Hãy dùng fault profile đủ thực tế để chạm decision boundary:

```yaml
experiment: reservation-timeout-after-intent
workflow: reserve_inventory
seed_case: synthetic-order-042
faults:
  - boundary: inventory.read
    mode: stale
    age_seconds: 900
  - boundary: reservation.write
    mode: accept_then_timeout
    server_commit: true
    client_response: timeout
safety:
  environment: isolated
  tenant: chaos-lab
  max_actions: 8
  max_wall_clock_ms: 30000
  external_writes: simulated-only
oracle:
  - committed_reservation_count <= 1
  - retry_requires_fresh_inventory
  - final_state in [awaiting_confirmation, completed, safely_failed]
```

Các fault family hữu ích gồm omission, delay, value corruption và duplication. Omission xóa một field hoặc result. Delay buộc agent reasoning dưới deadline. Value corruption thay currency, timestamp, status hoặc identity nhưng vẫn giữ outer schema. Duplication phát cùng một event hai lần. Family thứ năm là **semantic contradiction**: trả về hai observation riêng lẻ đều hợp lệ nhưng không thể cùng đúng.

Đừng tiêm mọi fault vào mọi run. Bắt đầu bằng một fault tại một boundary, sau đó chỉ ghép các tổ hợp tương ứng với incident có thể xảy ra. Matrix ngẫu nhiên quá lớn sẽ tạo noise và làm failure khó triage.

## Recovery contract phải nằm ngoài model

Model có thể đề xuất recovery, nhưng runtime phải quyết định recovery đó có được phép hay không. Recovery contract nên trả lời năm câu hỏi:

| Câu hỏi | Contract ví dụ |
|---|---|
| Operation có retry được không? | Chỉ khi outcome của attempt trước là unknown và request mang cùng idempotency key. |
| Cần đọc lại điều gì? | Inventory và price phải fresh trong 60 giây. |
| Authority nào còn hiệu lực? | Read access còn; write authority hết hạn sau 5 phút. |
| Cần evidence gì? | Tool result, request hash, state version và policy decision. |
| Khi nào workflow phải dừng? | Sau hai recovery attempt thất bại hoặc bất kỳ invariant violation nào. |

Đây không phải prompt wording. Đây là executable policy nằm quanh agent. Hệ thống phải reject tool call vi phạm contract dù model có giải thích rằng call đó hợp lý.

Với write-oriented tool, adapter nên tách ba trạng thái: “request sent”, “server accepted” và “client observed response”. Timeout không cho biết operation đã fail hay chưa. State đúng thường là **unknown**, và state này cần reconciliation thay vì blind retry ngay.

```text
planned -> dispatched -> outcome_unknown -> reconcile
                                      \\-> committed
                                      \\-> not_committed
                                      \\-> unresolved_manual_review
```

Đây là nơi chaos testing kết nối với idempotency nhưng không thay thế playbook idempotency hiện có. Experiment hỏi hệ thống có thật sự dùng contract khi outcome không chắc chắn hay không, chứ không chỉ hỏi design document có nhắc tới key hay chưa.

## Dùng state-based oracle, không chỉ dùng LLM judge

Một recovery message trôi chảy không phải bằng chứng recovery đã xảy ra. Mỗi experiment cần deterministic oracle có thể đọc state trước và sau run. Oracle có thể so sánh database snapshot, event count, object version, authorization decision, queue offset hoặc signed action ledger.

Action metamorphic relation trong ReliabilityBench gợi ý một pattern tốt: sau fault hoặc perturbation tương đương, correctness được quyết định bằng end-state equivalence thay vì wording giống nhau.[1] Ví dụ agent có thể nói “Tôi không thể hoàn tất reservation” hoặc “Reservation đang pending trong lúc inventory được refresh.” Cả hai đều có thể chấp nhận nếu state là pending, không có duplicate reservation và user nhận được next step trung thực.

![State snapshot, invariant check, evidence capture và release gate xác minh agent có thật sự recover sau fault hay không](/blog/chaos-engineering-ai-agents/verification-oracle.webp)

Một oracle record tối thiểu có thể như sau:

```json
{
  "experiment_id": "exp_01J...",
  "initial_state_hash": "sha256:...",
  "final_state_hash": "sha256:...",
  "observed_actions": 4,
  "committed_effects": 0,
  "freshness_violations": 0,
  "authority_expansions": 0,
  "terminal_state": "awaiting_confirmation",
  "verdict": "pass"
}
```

Oracle nên độc lập với model path đang được test. Nếu model tự quyết định câu trả lời của nó đúng hay không, experiment có thể báo confidence trong khi database báo damage.

## Đo resilience như một surface, không phải một pass rate duy nhất

Một success percentage duy nhất che giấu nhiều khác biệt. Ít nhất hãy theo dõi ba chiều:

| Dimension | Cần đo gì | Câu hỏi ví dụ |
|---|---|---|
| Consistency | Cùng scenario, nhiều seed, cùng invariant outcome | Cùng fault nhưng có lúc trigger write, có lúc refusal không? |
| Robustness | Input tương đương, constraint đảo thứ tự, context không liên quan | Paraphrase có làm thay đổi safety decision không? |
| Fault tolerance | Timeout, rate limit, partial result, restart, dữ liệu stale | Workflow có hội tụ về safe terminal state không? |

Trong vận hành, bổ sung recovery latency, số model/tool call thêm, duplicate-effect rate, stale-context acceptance rate, human-escalation rate và evidence completeness. Một recovery giữ được state nhưng tiêu tốn gấp mười budget thông thường vẫn có thể không chấp nhận được.

Đừng tối ưu cho việc “agent luôn refusal”. Hệ thống từ chối mọi request có thể có safety metric hoàn hảo nhưng không có utility. Mục tiêu là calibrated response: tiếp tục khi operation an toàn và evidence đủ, pause khi outcome unknown, và refuse khi không thể chứng minh authority hoặc correctness.

## Promotion gate biến experiment thành engineering practice

Ban đầu, chạy experiment như pull-request check cho policy và adapter change, sau đó chạy scheduled suite trên production-like environment. Giữ một canary set nhỏ để hoàn tất nhanh và một suite lớn hơn bao phủ compounded fault chạy qua đêm.

Promotion gate có thể viết rõ ràng:

```text
promote only if:
  no invariant violation
  duplicate_effect_rate == 0
  authority_expansion_rate == 0
  stale_context_acceptance_rate == 0
  evidence_completeness >= 99%
  recovery_p95 <= workflow_budget
  unresolved_unknown_outcomes <= approved_threshold
```

Threshold phải phụ thuộc risk. Support-ticket agent có thể chấp nhận human handoff; payment hoặc deletion workflow có thể yêu cầu zero ambiguous write. Exception phải rõ ràng, có thời hạn và có người hoặc team sở hữu. Một exception tồn tại vĩnh viễn thường chỉ là assumption chưa test nhưng được gọi bằng cái tên đẹp hơn.

Khi test fail, hãy lưu trọn evidence pack: trace identifier, fault timeline, state snapshot, tool request/response sau redaction, policy decision, model/tool version và input nhỏ nhất có thể replay. Mục tiêu không phải đổ lỗi cho model. Mục tiêu là làm boundary đã hỏng đủ rõ để sửa.

## Những điều không nên làm

Đừng bắt đầu bằng live failure injection trên customer traffic. Đừng xem lời xin lỗi do model sinh ra là rollback. Đừng chỉ dùng `500`, timeout và rate-limit response mà bỏ qua stale hoặc semantically wrong data. Đừng chỉ so final text. Đừng để agent tự mở rộng authority để recovery. Đừng gọi test environment là safe nếu nó dùng chung production credential, queue, bucket hoặc webhook endpoint.

Quan trọng nhất, đừng nhầm chaos engineering với một chiến dịch reliability làm một lần. Tool, provider, schema, prompt, memory policy và orchestration code mới đều tạo failure surface mới. Fault matrix phải tiến hóa cùng hệ thống và nằm trong release evidence.

## Một trình tự bắt đầu thực tế

Hãy bắt đầu với một workflow có thể tạo external effect và một workflow chỉ đọc nhưng phụ thuộc freshness. Capture một known-good trace. Thêm simulator quanh tool boundary quan trọng nhất. Tiêm một timeout sau khi intent được hình thành, một stale result và một malformed response. Viết state oracle trước khi chạy experiment. Sau đó thêm worker restart và duplicate event.

Mục tiêu đầu tiên không phải tạo benchmark hoàn hảo. Mục tiêu là phát hiện hệ thống có phân biệt được **failed**, **not started** và **outcome unknown** hay không. Ba state này dẫn tới ba recovery action khác nhau. Khi phân biệt đó đã đáng tin, hãy thêm provider outage, rate-limit burst, semantic contradiction và compounded fault.

Một agent sẵn sàng cho production không phải agent chưa bao giờ gặp error. Đó là agent vẫn giữ được authority, state và lời hứa với user trong giới hạn rõ ràng khi thế giới không còn vận hành như demo.

## Tài liệu tham khảo

[1]: https://arxiv.org/html/2601.06112v1 "ReliabilityBench: Evaluating LLM Agent Reliability Under Production-Like Stress Conditions"
[2]: https://mlflow.org/articles/building-production-ready-ai-agents-in-2026/ "Building Production-Ready AI Agents in 2026"
[3]: https://redis.io/blog/ai-agent-architecture/ "AI Agent Architecture: Build Systems That Work in 2026"
[4]: https://principlesofchaos.org/ "Principles of Chaos Engineering"
