---
title: "Queue cũng là Policy: Admission Control, Backpressure và Fairness cho Multi-Tenant AI Agent"
description: "Hướng dẫn production về cách xem queue như một policy của AI agent: admission control, backpressure, fair scheduling, bảo vệ tail-SLO và graceful load shedding."
pubDate: 2026-07-03
category: "engineering"
image: "/blog/ai-admission-control/hero.webp"
lang: "vi"
translationKey: "ai-admission-control-backpressure-fairness"
draft: false
---

![Whiteboard vẽ tay mô tả AI agent gateway, fair queue, admission gate, tín hiệu backpressure và load shedding có kiểm soát](/blog/ai-admission-control/hero.webp)

Trong một sơ đồ kiến trúc, queue thường chỉ là một hình chữ nhật nhỏ nằm giữa API gateway và worker pool. Một mũi tên đi vào bên trái, một mũi tên đi ra bên phải. Cách vẽ đó dễ khiến chúng ta nghĩ queue chỉ là nơi cất request tạm thời, đợi hệ thống rảnh thì xử lý.

Với một nền tảng AI agent nhiều tenant, cách nghĩ ấy quá đơn giản. Queue quyết định ai được bắt đầu, ai phải chờ, ai được giảm chất lượng, ai bị từ chối và mỗi tenant được dùng bao nhiêu model capacity, tool capacity hay database capacity. Queue cũng quyết định việc một provider chậm lại sẽ trở thành một HTTP 429 có kiểm soát hay một sự cố lan truyền toàn hệ thống.

Vì vậy, queue không chỉ là buffer. **Queue là một policy.**

Điều này đặc biệt quan trọng với agent. Một request có thể gọi model nhiều lần, gọi tool, chờ database, fan-out thành nhiều nhánh rồi join kết quả. Gateway nhìn thấy một request; hệ thống phía sau có thể phải xử lý mười operation. Nếu chỉ kiểm tra capacity ở cửa vào, nền tảng có thể nhận lời với một khối lượng mà các bước còn lại không đủ khả năng hoàn tất.

> **Luận điểm chính:** Một nền tảng AI agent đáng tin cậy phải admission dựa trên work estimate, fairness giữa tenant, deadline, risk và downstream capacity; không thể chỉ nhìn xem cửa trước còn nhận connection hay không.

Bài này không lặp lại hướng dẫn về model routing hay provider failover, cũng không phải một bài tổng quan về multi-tenant isolation. Câu hỏi hẹp và thực tế hơn là: **khi nhu cầu vượt quá capacity an toàn, hệ thống nên cho việc gì vào, trì hoãn việc gì, giảm cấp độ việc gì và bỏ việc gì?**

## Bài này đứng ở đâu trong hệ thống folio?

Folio đã có các bài về model routing, provider failover, semantic caching, cô lập multi-tenant, idempotent tool call, decision trace, contract testing và observability. Admission control nằm sớm hơn một tầng: nó quyết định workflow có được tiêu thụ các tài nguyên đó ngay bây giờ hay không.

| Tầng | Câu hỏi chính | Lỗi thường gặp nếu thiếu |
|---|---|---|
| Admission | Run này có nên bắt đầu ngay không? | Queue phình to và nhận việc vượt capacity. |
| Scheduling | Trong các run đã nhận, run nào đi trước? | Noisy neighbor và priority inversion. |
| Routing | Model/provider nào sẽ phục vụ? | Sai capability hoặc route flapping. |
| Execution | Tool và state transition chạy thế nào? | Side effect lặp hoặc mất tiến trình. |
| Quality | Kết quả có đạt contract không? | HTTP 200 nhưng không dùng được. |
| Observability | Có giải thích được điều gì xảy ra không? | Incident không thể tái dựng. |

Phân biệt này giúp tránh một sai lầm phổ biến: dùng provider router thay cho workload scheduler. Chuyển từ provider A sang B có thể tìm endpoint khác, nhưng không trả lời được tenant này có nên được admission không, workflow còn đủ budget không, hay mười tool call song song có làm nghẽn database chung không.

## Admission không phải boolean

Một admission check đơn giản có thể trông như sau:

```python
def admit(request):
    return queue_depth < MAX_QUEUE_DEPTH
```

Cách này tốt hơn không kiểm tra gì, nhưng xem mọi request là giống nhau. Một request phân loại ngắn, một tài liệu 100.000 token và một agent có quyền ghi dữ liệu dùng các loại tài nguyên hoàn toàn khác nhau. Queue có 500 job nhỏ đôi khi còn khỏe hơn queue có 20 job lớn cùng chờ một GPU hoặc một database pool.

Một quyết định admission production nên xét ít nhất năm chiều:

1. **Work estimate:** input token, output token, số tool call, fan-out và thời gian chạy dự kiến.
2. **Resource class:** model family, GPU pool, database, search index, browser worker hoặc external API.
3. **Tenant policy:** quota, priority tier, fairness share và ngân sách còn lại.
4. **Deadline và user value:** interactive, background, scheduled batch hay best-effort.
5. **Risk và side effect:** đọc dữ liệu, mutation có thể hoàn tác, financial action hay external write không thể đảo ngược.

Kết quả nên là một decision object thay vì `true` hoặc `false`:

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

Estimate chắc chắn không hoàn hảo. Điều đó chấp nhận được nếu hệ thống lưu estimate, so sánh với work thực tế và cập nhật mô hình. Estimate ẩn trong queue rất khó sửa; estimate được ghi nhận có thể đo, calibrate và cải thiện.

## Backpressure là cuộc hội thoại giữa các stage

Backpressure thường được giải thích là “consumer chậm hơn producer thì yêu cầu producer giảm tốc”. Trong agent platform, tín hiệu này phải đi qua nhiều boundary.

Gateway có thể báo admission queue đầy. Scheduler có thể báo tenant đã dùng hết fair share. Model router có thể báo provider gần cạn token budget. Tool executor có thể báo database pool đang bão hòa. Durable worker có thể báo critical path không còn khả năng đạt deadline.

Nếu các tín hiệu này chỉ tồn tại cục bộ, một stage vẫn nhận việc trong khi stage khác âm thầm tích lũy backlog bất khả thi. Control path hữu ích sẽ giống như sau:

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

Quy tắc quan trọng nhất là **đừng giấu backpressure bên trong latency**. Nếu run không thể bắt đầu trong deadline của sản phẩm, chờ im lặng không phải lựa chọn trung lập. Nó biến một vấn đề capacity có thể nhìn thấy thành timeout phía người dùng, rồi kích hoạt retry từ client.

| Tình trạng | Phản hồi nên dùng | Lý do |
|---|---|---|
| Queue khỏe | Admit | Bắt đầu trong budget đã hứa. |
| Queue bận trong thời gian ngắn | Delay kèm vị trí hoặc retry hint | Giữ việc mà không giả vờ là xử lý ngay. |
| Deadline không còn khả thi | Reject hoặc chuyển async | Không tiêu thêm tài nguyên cho việc chắc chắn trễ. |
| Capability tùy chọn tạm unavailable | Degrade | Trả đường đi nhỏ hơn và nói rõ trade-off. |
| Tenant hết budget | Fair-share throttle | Bảo vệ tenant khác mà không làm sập cả platform. |
| Dependency đang lỗi | Shed hoặc isolate | Ngăn lỗi cục bộ biến thành retry storm. |

## Fairness cần một đơn vị work

Global FIFO dễ hiểu nhưng thường không công bằng. Tenant gửi 10.000 task nhỏ có thể chiếm đầu queue trong khi tenant chỉ gửi năm task khẩn cấp phải chờ sau burst đó. Chỉ dùng priority cũng chưa đủ; một tenant priority cao vẫn có thể độc chiếm capacity nếu không có fair share theo tenant.

Mô tả của Cohere về LLM serving nhiều tenant đưa ra một pattern đáng chú ý: admission control, performance tier, Deficit Round Robin và priority/deadline ordering. Lựa chọn cốt lõi là đơn vị fairness. Một request không phải lúc nào cũng tương đương với một lượng work. Với request generative kích thước khác nhau, token hoặc measured cost thường trung thực hơn số request.

![Whiteboard vẽ tay mô tả fair queue theo tenant, weighted quantum, token budget và priority trong từng lane](/blog/ai-admission-control/fair-queue-token-budget.webp)

Một fair scheduler đơn giản có thể như sau:

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

Các hằng số không phải default chung cho mọi hệ thống. Nguyên tắc mới quan trọng: **tính phí theo work, không chỉ theo envelope**. Request 1.000 token và request 100.000 token không nên dùng cùng một phần fair-share chỉ vì cả hai đều đến dưới dạng một HTTP request.

Fairness cũng cần boundary. Nên tách tối thiểu các queue sau:

- Interactive, nhạy với latency.
- Background hoặc batch.
- Action có quyền ghi dữ liệu.
- Retrieval và embedding.
- Evaluation và shadow traffic.
- Capacity pool theo provider hoặc region.

Đẩy tất cả vào một “AI queue” tạo ra priority inversion ẩn. Job batch lớn có thể chặn request interactive nhỏ; evaluation có thể dùng chung provider quota với user trả phí; action có side effect có thể tranh capacity với summarization chỉ đọc dữ liệu dù risk hoàn toàn khác nhau.

## Admission phải bảo vệ tail SLO

Latency trung bình là tín hiệu admission kém cho AI system. Average che mất prompt dài, tool chậm, cache cold và workflow nhiều bước—những thứ thường tạo ra trải nghiệm tệ nhất. TTFT, thời điểm bắt đầu tool call đầu tiên, completion time và tỷ lệ đạt deadline ở p95/p99 hữu ích hơn.

Nghiên cứu QUARTZ về quantile-aware routing chỉ ra rằng prompt length, decode length không chắc chắn, prefix locality và router-side queueing có thể khuếch đại tail latency. Point estimate nhìn an toàn nhưng high-percentile path đã không còn khả thi.

Admission nên kiểm tra:

```python
def can_meet_deadline(job, state):
    predicted_wait = state.queue_wait_p95(job.queue, job.cost_class)
    predicted_exec = state.execution_p95(job.resource_class, job.cost_class)
    predicted_downstream = state.tool_path_p95(job.tool_plan)
    return predicted_wait + predicted_exec + predicted_downstream <= job.deadline_ms
```

Đây không phải lời hứa rằng mọi request đều hoàn thành đúng hạn. Đây là nguyên tắc không chủ động bắt đầu một việc mà hệ thống đã biết là không thể đáp ứng deadline.

![Minh họa whiteboard về admission theo deadline, gồm queue wait p95, model execution p95, tool path p95 và cổng defer hoặc reject](/blog/ai-admission-control/tail-slo-scheduler.webp)

Hãy tách **admission SLO** khỏi **completion SLO**:

| SLO | Đo gì | Control |
|---|---|---|
| Admission latency | Thời gian tới khi accept, defer hoặc reject | Gateway và queue policy |
| TTFT | Thời gian tới token hữu ích đầu tiên | Model queue và prefill capacity |
| Tool-start latency | Thời gian tới external action đầu tiên | Tool concurrency gate |
| Completion latency | Tổng thời gian run | Workflow và dependency budget |
| Deadline success | Tỷ lệ xong trước deadline sản phẩm | Admission + scheduling + degradation |

Nếu không thể đạt deadline, reject sớm đôi khi tử tế hơn nhận việc rồi timeout sau 30 giây. Người dùng có thể chọn async run, model nhỏ hơn, context ngắn hơn hoặc thử lại sau. Platform giữ được niềm tin vì làm rõ trade-off.

## Load shedding cần một cái thang

“Reject tất cả” không phải load-shedding strategy. Đó là emergency brake. Production cần một cái thang để bảo vệ việc quan trọng nhất trước và loại bỏ việc tùy chọn trước việc critical.

![Whiteboard vẽ tay mô tả graceful degradation ladder từ full agent execution tới async handoff, bounded rejection và recovery](/blog/ai-admission-control/admission-backpressure-ladder.webp)

Một ladder có thể gồm:

1. Dừng shadow traffic và evaluation không thiết yếu.
2. Giảm background concurrency, kéo dài batch window.
3. Tắt enrichment tùy chọn, long-context retrieval hoặc nhánh speculative.
4. Chuyển sang capability-compatible path nhỏ hoặc rẻ hơn.
5. Chuyển interactive work thành async handoff rõ ràng.
6. Throttle theo fair share của từng tenant.
7. Reject work mới với retry hoặc queue token rõ ràng.
8. Mở global circuit chỉ khi dependency hoặc platform không còn an toàn.

Thứ tự phụ thuộc sản phẩm. Financial action không nên degrade thành một phỏng đoán. Search summary có thể chấp nhận ít passage hơn. Nightly embedding có thể chờ. Support request interactive có thể trả câu trả lời ngắn hơn mà không có personalization tùy chọn.

Admission-control filter của Envoy đưa ra một pattern cụ thể: dùng success window trượt, bắt đầu shed dưới một threshold, điều chỉnh độ aggressiveness và giới hạn rejection probability. Không cần sao chép nguyên thuật toán. Điều cần học là shedding dần, có thể đo, thay vì một công tắc nhị phân dao động giữa “nhận tất cả” và “drop tất cả”.

## Retry là một workload class riêng

Queue có thể đang khỏe cho tới khi retry xuất hiện. Provider timeout và mọi caller lập tức retry sẽ khiến traffic retry tranh capacity với work mới, làm lỗi ban đầu tệ hơn. Platform nên xem retry là một class riêng, có budget và admission policy riêng.

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

Retry phải mang causation ID gốc, không trở thành một user request mới. Scheduler cần biết đó là read an toàn, workflow đã chạy dở hay write action có side effect chưa rõ. Idempotency và decision trace vẫn cần thiết, nhưng admission control quyết định attempt tiếp theo có được tranh capacity hay không.

Backoff cần jitter, nhưng jitter chưa đủ. Một nghìn request với exponential backoff độc lập vẫn có thể tạo wave lớn khi provider hồi phục cùng lúc. Cần retry budget, breaker theo dependency và một probe pool half-open nhỏ. Đừng ném toàn bộ backlog vào provider vừa hồi phục.

## Agent fan-out cần reservation

Agent workflow dễ tạo concurrency amplification. Một request có thể gọi ba model, hai retrieval và bốn tool song song. Gateway thấy một request; hệ thống thấy chín downstream operations, với join point chỉ hoàn tất khi nhánh chậm nhất quay về.

Một reservation model hữu ích là:

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

Reservation không cần tuyệt đối chính xác. Nó tạo ra một ceiling. Không có ceiling, fan-out là concurrency không được định giá và queue chỉ phát hiện chi phí sau khi work đã bắt đầu.

Cancellation phải truyền qua cả graph. Khi user đóng trang hoặc deadline hết, hệ thống nên cancel model call đang chờ, dừng nhánh tùy chọn, release queue reservation và đánh dấu external write chưa chắc chắn để reconciliation. Nếu không, request không còn người chờ vẫn tiêu capacity ngang với request active.

## Kubernetes là một analogy tốt, không phải lời giải hoàn chỉnh

Kubernetes API Priority and Fairness cho thấy một pattern đáng mượn: phân loại request, gán priority level và chia concurrency theo flow thay vì một global max-inflight. AI agent platform có thể mượn ý tưởng này, nhưng flow identity cần nhiều hơn API identity.

Một flow key thực tế có thể là:

```text
tenant + workload_class + resource_class + risk_class + deadline_bucket
```

Cùng một tenant có thể có interactive request khẩn cấp và background export lớn. Gom thành một flow sẽ quá thô. Ngược lại, nếu workflow tự phát minh flow key, fairness sẽ bị phá bằng cách tạo vô hạn lane. Flow classification phải được quản trị tập trung và observable.

## Nên đo gì?

Queue policy chỉ thực sự tồn tại khi quyết định của nó đo được. Tối thiểu nên lưu:

- Admission decision và reason.
- Estimate so với actual token, tool, fan-out và wall-clock cost.
- Queue wait theo tenant, workload class và resource class.
- Fair-share deficit và budget đã dùng.
- Tỷ lệ reject, degrade, defer và cancel.
- p50, p95, p99 của wait và completion latency.
- Retry attempts và capacity do retry tiêu thụ.
- Deadline success và SLO violation.
- Dependency saturation và queue đã phát tín hiệu.

Không cần log prompt nhạy cảm chỉ để giải thích queue decision. Decision record có thể mang classification, cost estimate, policy version và hash reference tới input. Như vậy đủ để phân tích fairness mà không biến queue thành hệ thống lưu trữ dữ liệu ngoài ý muốn.

Dashboard cũng không nên chỉ có “queue depth”. Nên xem queue depth theo flow, backlog theo work-weight, tuổi của item lâu nhất, tỷ lệ còn khả năng đạt deadline, shed percentage, retry share và sai khác giữa estimated/actual cost. Queue 100 request nhỏ và queue 100 request lớn không nên có cùng một màu cảnh báo.

## Checklist production ngắn gọn

| Câu hỏi | Câu trả lời tối thiểu |
|---|---|
| Hệ thống có reject trước expensive work không? | Có, kèm reason code và hướng retry/async. |
| Fairness được định nghĩa bằng đơn vị work thật không? | Token, measured cost hoặc approximation có tài liệu. |
| Một tenant có thể burst độc chiếm model/tool không? | Không; có per-flow limit và fair scheduling. |
| Admission có bảo vệ p95/p99 deadline không? | Có; dùng wait/execution estimate theo quantile. |
| Optional work có được loại bỏ trước không? | Có; có degradation ladder được ghi rõ. |
| Retry có budget riêng không? | Có; giới hạn attempt, time và resource cost. |
| Fan-out có reservation downstream không? | Có; nhánh có concurrency và deadline ceiling. |
| Decision có observable mà không lưu prompt riêng tư không? | Có; lưu policy, estimate, reason và reference. |
| Có test noisy-neighbor burst không? | Có; load test có fairness và tail-SLO assertion. |

Câu cuối là câu nhiều team bỏ qua nhất. Queue policy phải được test với traffic có tính đối kháng: một tenant burst lớn, tenant khác gửi request khẩn, tenant thứ ba dùng prompt khổng lồ, trong lúc provider trả 429. Test không chỉ kiểm tra hệ thống còn sống; nó phải xác minh đúng loại work vẫn tiến lên.

## Kết luận: reliability bắt đầu trước model call

AI system thường xem reliability là việc xảy ra trong model gateway: chọn provider, retry timeout, mở circuit và ghi trace. Những control đó cần thiết, nhưng bắt đầu quá muộn nếu platform đã admission nhiều work hơn những dependency có thể hoàn tất.

Queue là nơi hệ thống đưa ra quyết định reliability đầu tiên. Nó có thể bảo vệ capacity, duy trì fairness, tôn trọng deadline và làm rõ degradation. Nó cũng có thể che giấu overload, khuếch đại retry và biến burst của một tenant thành incident của tất cả mọi người.

Một agent platform trưởng thành vì vậy phải xem admission như một product contract. Contract nói rõ platform nhận gì ngay bây giờ, trì hoãn gì, đơn giản hóa gì và từ chối gì. Nó đo chi phí của các quyết định đó, rồi học từ chênh lệch giữa estimated work và actual work.

**Queue chỉ lưu request là infrastructure. Queue biết quyết định an toàn là một phần behavior của AI system.**

## Đọc thêm

- [Model Router cho AI Agent](/blog/model-router-ai-agent/)
- [Multi-Model Failover không phải Route Flapping](/blog/provider-rotation-multi-model-failover/)
- [Contract Testing cho AI Tool](/blog/ai-tool-contract-testing/)
- [Decision Traces cho AI Agent](/blog/decision-traces-ai-agent-event-sourcing/)
- [Envoy Admission Control](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/admission_control_filter)
- [Cohere: LLM Serving Fairness](https://cohere.com/blog/serving-fairness)
- [Google SRE: Handling Overload](https://sre.google/sre-book/handling-overload/)
