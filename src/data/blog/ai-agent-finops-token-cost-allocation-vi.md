---
title: "AI Agent FinOps: Phân bổ Token Cost theo Tenant, Workflow và Outcome"
description: "Playbook FinOps thực tế cho AI agent: biến token usage, model call, tool work và shared infrastructure thành tín hiệu cost và value có owner."
pubDate: 2026-06-04
category: "engineering"
lang: "vi"
translationKey: "ai-agent-finops-token-cost-allocation"
draft: false
image: "/blog/ai-agent-finops/hero.webp"
---

Bản AI cost report đầu tiên mình thường thấy là một con số theo tháng: model spend tăng 37 phần trăm. Con số đó đủ chính xác để finance lo lắng, nhưng quá mơ hồ để engineering biết phải sửa gì.

Tenant nào làm chi phí tăng? Workflow nào đắt hơn? Phần spend thêm đó mua được outcome tốt hơn hay chỉ bị một retry loop âm thầm tiêu hết? Nguyên nhân là context lớn hơn, model mới, tool failure, prompt phình to, cache miss hay pricing update?

Monthly total không trả lời được các câu hỏi đó. AI agent không phải một API call duy nhất với một owner duy nhất. Nó là một workflow có thể route qua nhiều model, retrieve context, gọi tool, retry sau timeout, hỏi clarification, chờ human và tạo ra outcome có business value rất khác với chi phí token đã dùng để đi đến đó.

![AI Agent FinOps ledger nối tenant và workflow với token usage, tool call, shared infrastructure, budget và business outcome](/blog/ai-agent-finops/hero.webp)

> **Luận điểm chính:** AI FinOps trở nên hữu ích khi cost được phân bổ theo đúng những dimension mà business dùng để quản lý công việc: tenant, workflow, outcome và owner. Token usage là meter, nhưng accountable unit economics mới là sản phẩm.

[FinOps Foundation trong phần tổng quan FinOps for AI](https://www.finops.org/wg/finops-for-ai-overview/) mô tả cả tính liên tục lẫn thay đổi. Công thức cơ bản `Price × Quantity = Cost` vẫn đúng, nhưng AI thêm vào pricing biến động, SKU mới, token meter, GPU scarcity, native tagging hạn chế và một quality dimension kéo dài trong suốt vòng đời.[1](https://www.finops.org/wg/finops-for-ai-overview/) Bài viết này chuyển các nguyên tắc đó thành một thiết kế ở application level cho team xây agent.

## AI spend là một workflow, không phải một line item

Một conventional service thường có quan hệ tương đối trực tiếp giữa request count và cost. Agent workflow phá vỡ quan hệ đó.

Một user request có thể tạo ra trace như sau:

```text
request received
  -> intent classification
  -> model routing
  -> retrieval query x 3
  -> context compression
  -> planner call
  -> tool call: CRM lookup
  -> tool call: ticket update
  -> timeout
  -> retry
  -> human approval wait
  -> final response
```

Mỗi stage có thể dùng một meter khác nhau. Có input token, output token, cached token, embedding request, reranking, GPU second và external SaaS call. Có stage được shared bởi nhiều tenant. Có stage phát sinh vì workflow failure chứ không phải useful work.

Nếu accounting boundary chỉ là final model request, hệ thống sẽ undercount real cost và gán cost cho sai owner. Nếu boundary chỉ là monthly provider invoice, team không thể tối ưu workflow.

Quyết định thiết kế đầu tiên vì vậy là xác định **cost-bearing unit**. Với agent platform, unit đó thường không phải “một token”. Nó gần với:

```text
one completed workflow outcome
= model usage
+ retrieval and context work
+ tool execution
+ orchestration overhead
+ shared platform allocation
+ failure and retry cost
```

Cost-bearing unit có thể tinh chỉnh theo product. Support platform có thể track cost per resolved ticket. Document pipeline track cost per accepted document. Coding agent track cost per merged change, review cycle hoặc reverted patch.

## Bắt đầu bằng allocation key

Mỗi workflow run cần một allocation key do application sở hữu trước khi thực hiện model call đầu tiên. Key phải ổn định qua retry và model hop, nhưng không được chứa sensitive data.

```text
CostContext {
  cost_trace_id: string
  tenant_id: string
  workspace_id: string
  product_id: string
  workflow_id: string
  workflow_version: string
  outcome_id: string | null
  actor_scope: string
  cost_center: string
  environment: dev | staging | production
  budget_policy: string
  started_at: timestamp
}
```

Context không chỉ là logging convenience. Nó là join key nối provider usage, tool work, platform overhead, budget và business outcome. Không có nó, allocation sẽ biến thành một phỏng đoán định kỳ dựa trên invoice category.

Giữ context tách khỏi prompt. Tenant identifier có thể cần cho accounting và access control, nhưng không nên copy vào model input nếu task không cần. Cost attribution không được trở thành một đường mới làm lộ customer data.

Key cũng phải tồn tại qua internal model routing. Nếu router chuyển workflow từ provider này sang provider khác, cost trace vẫn giữ nguyên trong khi mỗi provider attempt nhận một child span.

## Xây cost ledger, đừng chỉ làm dashboard metric

Dashboard cho thấy total. Ledger giải thích total. Hãy lưu một cost event immutable hoặc append-only cho mỗi billable hay allocable unit.

![Append-only cost ledger ghi provider usage, token meter, tool call, shared cost, adjustment và final workflow outcome](/blog/ai-agent-finops/cost-spine.png)

```text
CostEvent {
  event_id: string
  cost_trace_id: string
  tenant_id: string
  workflow_id: string
  outcome_id: string | null
  provider: string
  model_or_service: string
  meter_type: input_tokens | output_tokens | cached_tokens |
               embeddings | rerank | gpu_seconds | tool_call |
               storage | human_review | shared_overhead
  quantity: decimal
  unit: string
  unit_price: decimal
  amount: decimal
  currency: string
  allocation_method: direct | proportional | fixed | usage_weighted
  occurred_at: timestamp
  pricing_version: string
}
```

![Allocation ledger nối tenant, workflow, model, tool và shared platform usage với direct cost và shared cost bucket](/blog/ai-agent-finops/allocation-ledger.webp)

Ledger event phải giữ quantity và price version dùng để tính amount. Pricing của provider có thể thay đổi. Historical report vẫn phải reproducible kể cả sau khi provider công bố rate card mới.

Khi invoice về, đừng overwrite estimate. Hãy ghi một adjustment event trỏ đến estimate gốc. Nhờ vậy hệ thống giải thích được vì sao cost của hôm qua thay đổi mà không giả vờ con số ban đầu là chính xác tuyệt đối.

Ledger có thể được project thành reporting table, nhưng reporting table không nên là source of truth duy nhất. Cost attribution là một accounting problem có late-arriving data, correction và shared resource.

## Phân bổ ở ba level hữu ích

Ba dimension tenant, workflow và outcome trả lời ba câu hỏi quản trị khác nhau. Không nên gộp chúng thành một flat label.

| Dimension | Câu hỏi của owner | Quyết định điển hình |
|---|---|---|
| Tenant | Ai sử dụng capacity và ai sở hữu budget? | Showback, chargeback, quota, contract hoặc account review. |
| Workflow | Product path nào tạo cost và waste nằm ở đâu? | Tối ưu prompt, routing, retrieval, retry hoặc architecture. |
| Outcome | Spend có tạo ra useful work không? | Unit economics, quality threshold và investment theo value. |
| Model/service | Provider hoặc SKU nào đắt hay hiệu quả? | Rate negotiation, placement, routing và commitment. |
| Environment | Cost thuộc production, experiment hay platform overhead? | Tách product economics khỏi R&D và shared operations. |

Tenant report không có workflow detail sẽ tạo blame mà không tạo fix. Workflow report không có tenant detail sẽ che mất owner cần trao đổi budget. Outcome report không có raw usage trace khiến quality-adjusted cost không thể audit.

Hãy dùng hierarchy thay vì một tag phẳng duy nhất:

```text
tenant:acme
  -> product:support-agent
      -> workflow:refund-review
          -> outcome:refund-approved
              -> trace:tr_01
                  -> model_call:mc_01
                  -> tool_call:tc_07
```

Hierarchy cho phép finance hỏi “ai trả?” trong khi engineering hỏi “path nào cần thay đổi?”.

## Tách direct cost khỏi shared cost

Không phải AI expense nào cũng assign trực tiếp được. Model call thuộc về một workflow. Shared retrieval index, gateway, observability stack, reserved GPU pool hoặc platform team thì không.

Hãy chọn allocation method có chủ ý và công khai method đó.

| Cost category | Allocation method ưu tiên | Cảnh báo |
|---|---|---|
| Model input/output token | Direct usage theo trace, workflow và tenant. | Khi có thể, giữ input, output, cached và reasoning meter riêng. |
| Tool API call | Direct usage, sau đó reconcile với provider invoice. | Gồm cả failed call nếu call đã tiêu capacity hoặc tiền. |
| Shared retrieval index | Usage-weighted theo query, storage hoặc indexed volume. | Đừng mặc định dồn cho tenant lớn nhất. |
| Gateway và orchestration | Proportional theo request, duration hoặc compute. | Phải làm rõ denominator. |
| Reserved GPU capacity | Fixed baseline cộng variable share theo usage. | Đừng tính idle experimental capacity vào product consumption. |
| Human review | Direct tới workflow/outcome khi bị run kích hoạt. | Tách review bắt buộc khỏi escalation có thể tránh. |
| Platform engineering | Fixed shared allocation hoặc platform cost center riêng. | Đừng giấu engineering investment trong token price. |

Không có một allocation key đúng cho mọi trường hợp. Mục tiêu là một method explainable, đủ ổn định để ra quyết định và có thể cải thiện khi measurement tốt hơn.

Khi không thể allocation công bằng, hãy đánh dấu cost là shared thay vì bịa false precision. Một dòng “shared platform overhead” minh bạch hữu ích hơn một tenant invoice cộng surcharge 18,7 phần trăm mà không có giải thích.

## Usage meter không thể hoán đổi cho nhau

Token accounting phức tạp hơn đếm character trong user prompt. Billed input có thể khác visible input sau templating, retrieval, compression, tool schema expansion hoặc provider-side processing. FinOps Foundation lưu ý AI service có thể có các token meter khác nhau và user input không luôn là quantity được tính phí tại endpoint.[1](https://www.finops.org/wg/finops-for-ai-overview/)

Khi provider expose meter, hãy ghi riêng:

```text
input_tokens_user
input_tokens_system
input_tokens_retrieved
input_tokens_tool_schema
input_tokens_cached
input_tokens_billed
output_tokens_visible
output_tokens_reasoning_or_hidden
provider_adjustment
```

Đừng tự bịa hidden-token measurement nếu provider không expose. Lưu `unknown` hoặc provider-reported aggregate value và giữ uncertainty đó rõ ràng.

Rule tương tự áp dụng cho tool cost. Tool call trả empty result vẫn có thể tốn paid API request. Failed request vẫn có thể tạo bill. Retry có thể cần thiết về operational, nhưng phải hiển thị như retry cost thay vì trộn vào “successful work”.

## Failure cost là một phần của product economics

Agent có thể rẻ khi thành công và đắt khi loop. Vì vậy average cost per request là target tối ưu kém.

Hãy theo dõi ít nhất bốn cost path:

```text
productive_cost
  = usage đóng góp vào accepted outcome

recovery_cost
  = retry, fallback model, reconciliation và extra retrieval

avoidable_cost
  = loop, duplicate call, cache miss, prompt quá lớn và invalid tool attempt

shared_cost
  = infrastructure và operations phân bổ cho nhiều workload
```

Các category không phải lúc nào cũng observe hoàn hảo. Điều đó chấp nhận được nếu classification rule được document và cải thiện theo thời gian. Quan trọng là không coi mọi token có giá trị như nhau.

Workflow tốn 0,04 dollar nhưng resolve một issue giá trị cao có thể khỏe mạnh hơn workflow tốn 0,01 dollar và tạo ra câu trả lời vô dụng. Cost phải join với outcome quality thay vì tối ưu riêng lẻ.

## Định nghĩa outcome-aware unit economics

Một unit metric hữu ích có denominator đại diện cho value hoàn tất, không chỉ traffic.

```text
cost_per_accepted_outcome =
  total_allocated_cost / number_of_accepted_outcomes

quality_adjusted_cost =
  total_allocated_cost /
  (accepted_outcomes * quality_score)

cost_of_failure =
  retry_cost + fallback_cost + human_cost + downstream_repair_cost
```

Quality score cần một contract rõ. Nó có thể là verified state transition, human-accepted resolution, code change pass test hoặc document pass required checks. Đừng dùng câu “looks good” cuối cùng của model làm proof duy nhất của outcome.

Khung [AI Agent SLO](/blog/ai-agent-slo-success-latency-cost-safety) xem cost là một operational dimension bên cạnh success, latency và safety. FinOps bổ sung bằng cách trả lời câu hỏi khác: **ai sở hữu cost, work nào tạo ra cost và business unit of value nào được tạo ra?** SLO cho biết workflow vượt cost budget; FinOps giải thích vì sao và phân bổ tác động.

## Allocation ledger trong thực tế

Giả sử một tenant chạy workflow `refund-review`. Trace tạo hai planner call, một retrieval query, một CRM lookup, một payment-provider lookup và một human approval. Payment lookup đầu tiên timeout rồi được retry.

Ledger có thể trông như sau:

| Event | Meter | Direct amount | Allocation | Quan hệ với outcome |
|---|---|---:|---|---|
| Planner call 1 | Input/output token | $0.006 | Direct tới tenant/workflow | Productive candidate work |
| Retrieval | Embedding/rerank/query | $0.002 | Direct tới workflow | Evidence cho decision |
| CRM lookup | Tool request | $0.001 | Direct tới workflow | Evidence |
| Payment lookup 1 | Tool request | $0.003 | Direct tới workflow | Recovery/failure path |
| Payment lookup retry | Tool request | $0.003 | Direct tới workflow | Recovery cost |
| Planner call 2 | Input/output token | $0.005 | Direct tới workflow | Reconciliation |
| Human approval | Review minutes | $0.018 | Direct tới outcome | Required gate |
| Gateway overhead | Compute/time | $0.002 | Proportional | Shared platform |
| **Total** |  | **$0.040** |  | Accepted refund decision |

Insight quan trọng không nằm ở số tiền tuyệt đối. Nó nằm ở hình dạng của câu trả lời. Workflow thấy retry path chiếm 15 phần trăm run, human gate đắt hơn planner và final outcome được accept. Model migration tiết kiệm 20 phần trăm planner token có thể kém giá trị hơn việc sửa timeout tạo duplicate lookup cost.

## Budget envelope phải tồn tại lúc runtime

Monthly budget xem sau invoice không phải control. Agent cần budget envelope có thể ảnh hưởng behavior trong lúc run.

```text
BudgetEnvelope {
  tenant_limit: money
  workflow_limit: money
  run_limit: money
  token_limit: integer
  tool_call_limit: integer
  human_review_limit: money
  soft_threshold: number
  hard_threshold: number
  fallback_policy: string
  created_at: timestamp
  expires_at: timestamp
}
```

![Budget envelope lúc runtime bao quanh AI workflow bằng soft limit, hard limit, optional work stop và protected safety path](/blog/ai-agent-finops/budget-envelope.webp)

Envelope có thể trigger behavior ở nhiều threshold.

| Threshold | Behavior ví dụ |
|---|---|
| 70 phần trăm | Ưu tiên cached context, retrieval ngắn hơn hoặc model nhỏ hơn cho low-risk step. |
| 85 phần trăm | Dừng enrichment không bắt buộc, giảm fan-out và hỏi confirmation trước work đắt. |
| 100 phần trăm | Block call không thiết yếu, trả pending state hoặc escalate tới owner. |
| Exception | Cho phép overage khi workflow high-value, được policy approve và có record. |

Budget enforcement phải hiểu risk. Support summary có thể degrade sang model rẻ hơn. Safety review không nên âm thầm downgrade vì token budget gần cạn. Budget policy phải nói rõ step nào optional, step nào protected và step nào cần human decision.

## Showback trước chargeback

Showback báo usage cho owner mà chưa chuyển tiền trực tiếp. Chargeback gắn allocation vào financial responsibility hoặc contract. Nhiều team nên bắt đầu bằng showback.

Showback cho thấy taxonomy có dễ hiểu không và owner có hành động được trên data không. Nếu product team không reproduce được workflow total, chargeback invoice chỉ tạo dispute.

Một report hữu ích gồm:

```text
tenant
  spend
  runs
  accepted_outcomes
  cost_per_accepted_outcome
  retry_share
  cache_hit_rate
  top_workflows
  budget_breaches
  shared_cost_allocated
  confidence_and_data_completeness
```

Field cuối rất quan trọng. Report allocation coverage 100 phần trăm không đồng nghĩa report đáng tin nếu một nửa usage được phân bổ bằng proportional rule thô. Hãy track data completeness và allocation confidence cạnh con số.

Chargeback cũng cần dispute process. Tenant phải có thể hỏi trace nào tạo cost, pricing version nào được áp dụng và shared-cost rule nào được dùng. Điều đó không có nghĩa expose prompt hay customer data. Nó có nghĩa là expose một cost explanation privacy-safe.

## Tối ưu đúng layer trước

AI cost optimization không chỉ là đổi model. Nó là chuỗi quyết định qua nhiều layer của workflow.

![Optimization frontier so sánh model quality, latency, token spend, cache reuse, tool fan-out và accepted outcome rate](/blog/ai-agent-finops/optimization-frontier.webp)

### Loại bỏ work không nên xảy ra

Sửa duplicate request, invalid tool call, retry storm, context thừa, retrieval không cần thiết và loop tiếp tục sau khi outcome đã rõ. Token rẻ nhất là token không bao giờ được gửi.

### Cải thiện request shape

Dùng structured context, system instruction ổn định, selective retrieval và tool schema không lặp detail không liên quan. Compression có thể giảm input quantity, nhưng phải đánh giá quality loss và rework cost.

### Route theo risk và task

Model nhỏ có thể đủ cho classification, formatting, extraction hoặc deterministic follow-up. Model mạnh hơn có thể đáng giá cho ambiguous high-value reasoning. Router cần quality floor, không chỉ price table.

### Tăng cache value một cách an toàn

Semantic caching có thể tiết kiệm cost khi freshness và authorization cho phép reuse. Cache key phải gồm dimension làm thay đổi meaning: tenant scope, policy version, retrieval cutoff, workflow version và input fingerprint liên quan.

### Giảm fan-out và kiểm soát concurrency

Parallel agent call giảm latency nhưng tăng cost và correlated-error risk. Đặt maximum fan-out rồi đo xem additional opinion có thật sự cải thiện accepted outcome không.

### Tối ưu placement và commitment

Workload predictable có thể hưởng lợi từ reserved capacity hoặc placement tốt hơn. Workload volatile có thể coi flexibility đáng giá hơn discount. Quyết định này phải nằm trong cùng ledger với usage và outcome value.

## Đừng tối ưu bằng cách làm mất quality

Run rẻ hơn không tự động là run tốt hơn. Hãy so sánh alternative trên frontier gồm cost, latency, quality, safety và accepted outcome rate.

```text
candidate_is_better_if:
  cost_per_accepted_outcome decreases
  AND quality_floor remains satisfied
  AND safety_constraints remain satisfied
  AND latency_budget remains satisfied
```

Nếu model nhỏ hơn giảm token spend nhưng làm human review hoặc downstream repair tăng gấp đôi, saving đó là giả. Nếu compression tiết kiệm input token nhưng khiến agent retrieve lại cùng evidence, hệ thống chỉ chuyển cost chứ chưa loại bỏ cost.

Giữ optimization experiment gắn với workflow version. Nếu không, price change, prompt change và model change có thể bị trộn thành một improvement không ai reproduce được.

## Data quality và privacy boundary

Cost observability có thể vô tình collect nhiều sensitive data hơn application gốc. Prompt có thể chứa customer identifier, financial detail, code hoặc private document. FinOps ledger không nên cần raw prompt storage.

Ưu tiên các control sau:

| Control | Mục đích |
|---|---|
| Stable opaque trace ID | Join event mà không nhúng customer data vào tag. |
| Hashed hoặc tokenized tenant reference | Giữ allocation nhưng hạn chế exposure. |
| Meter-only provider record | Lưu usage và price fact mà không lưu prompt content. |
| Restricted outcome taxonomy | Báo category của value mà không lộ case detail. |
| Retention policy | Xóa trace chi tiết nhưng giữ aggregated accounting. |
| Access separation | Finance thấy cost, owner thấy workflow evidence, không phải ai cũng có prompt access. |
| Pricing version | Reconcile history mà không copy secret hay credential của provider. |

Data minimization càng quan trọng khi chargeback làm report cost được nhiều người xem. Owner cần hiểu bill, không cần đọc mọi customer conversation tạo ra bill đó.

## Rollout plan cho AI Agent FinOps

Bắt đầu với một workflow có owner rõ, outcome lặp lại được và đủ volume để lộ cost variation. Định nghĩa cost context rồi record model usage, tool call, retry và outcome status.

Tiếp theo reconcile trace-level estimate với provider invoice. Đo gap. Gap không tự động là defect: provider có thể có delayed adjustment, rounding, cached meter hoặc aggregated charge. Hãy document reconciliation rule.

Sau đó thêm tenant và workflow showback. Cho owner đủ detail để nhận ra một optimization action. Đừng mở chargeback trước khi taxonomy, allocation rule và dispute process được tin cậy.

Tiếp đó đưa runtime budget envelope vào các control low-risk: optional retrieval, model fallback, fan-out và retry. Giữ safety-critical work khỏi silent degradation.

Cuối cùng thêm outcome economics. Đo cost per accepted result, failure recovery cost, human review cost và quality floor theo workflow version. Dùng dữ liệu để quyết định nên tối ưu prompt, routing, retrieval, tool, capacity hay product expectation.

## Các quy tắc cần mang vào production

Đừng hỏi “model cost bao nhiêu?”. Hãy hỏi “workflow này tạo ra work gì, ai sở hữu, phần nào là shared và spend có tạo accepted outcome không?”.

Coi mỗi agent run là một economic unit có thể trace. Gán allocation context ổn định trước call đầu tiên. Ghi usage như một ledger thay vì chỉ một dashboard total. Tách direct cost khỏi shared cost. Giữ price version và late adjustment. Enforce budget lúc runtime. So sánh cost với outcome quality. Expose đủ detail cho showback mà không biến finance thành hệ thống mới có quyền đọc mọi prompt.

FinOps cho AI không phải bài tập hằng tháng nhằm làm model bill trông nhỏ hơn. Nó là operating discipline nối engineering choice với product value, tenant responsibility và agent behavior bền vững.

## Đọc tiếp trong series production AI

Để xem success, latency, cost và safety ở cấp workflow, đọc [Designing SLOs for AI Agents](/blog/ai-agent-slo-success-latency-cost-safety). Để retry an toàn sau một action đã được budget approve, đọc [Idempotent AI Actions: Making Tool Calls Safe to Retry](/blog/idempotent-ai-actions). Để tìm hiểu provider selection và failover, đọc tiếp [Provider Rotation for Multi-Model Failover](/blog/provider-rotation-multi-model-failover).

## References

[1]: https://www.finops.org/wg/finops-for-ai-overview/ "FinOps for AI Overview — FinOps Foundation"
