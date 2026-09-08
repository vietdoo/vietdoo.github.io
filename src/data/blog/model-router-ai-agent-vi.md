---
title: "Model Router cho AI Agent: Chọn Model theo Capability, Cost và Latency"
description: "Thiết kế production để định tuyến từng bước của agent tới model phù hợp mà không biến chất lượng, độ trễ và chi phí thành phỏng đoán."
pubDate: 2026-07-08
category: "engineering"
image: "/blog/model-router/hero.webp"
lang: "vi"
translationKey: "model-router-ai-agent"
draft: false
---

![Một kỹ sư thiết kế model router để gửi từng tác vụ của agent tới các model có capability, cost và latency khác nhau](/blog/model-router/hero.webp)

<figure class="blog-video">
  <video controls preload="metadata" playsinline poster="/blog/model-router/hero.webp" aria-label="Video giải thích nội dung bài viết, phiên bản tiếng Việt">
    <source src="/blog/model-router-ai-agent/video-vi.mp4" type="video/mp4" />
    Trình duyệt của bạn không hỗ trợ video HTML5.
  </video>
  <figcaption>Video giải thích chuyên sâu: phiên bản tiếng Việt.</figcaption>
</figure>

Trước đây tôi thường nghĩ chọn model chỉ là một quyết định cấu hình. Chọn một model, đặt tên nó vào biến môi trường, rồi chuyển sang phần thú vị hơn: tool, retrieval, orchestration và trải nghiệm người dùng.

Cách nghĩ đó không còn đúng khi agent bắt đầu hữu ích trong thực tế. Một lượt xử lý có thể cần model rẻ để phân loại. Bước kế tiếp lại cần một model có khả năng suy luận cẩn thận trên context dài. Bước sau nữa chỉ là định dạng arguments cho tool. Gửi tất cả bước tới model mạnh nhất sẽ lãng phí tiền và làm tăng latency. Gửi mọi thứ tới model nhỏ nhất tạo ra một hệ thống nhanh, cho tới khi một ca khó âm thầm trở thành một quyết định sai.

Bài toán thực tế không phải là “model nào tốt nhất?”, mà là: **với bước này, context này, tại thời điểm này, trong ngân sách và chính sách lỗi này, model nào đủ tốt?**

Bài viết này xem model router như một thành phần production thay vì một prompt thông minh. Tôi sẽ đi qua các tín hiệu định tuyến, chính sách nhiều tầng, fallback, shadow traffic, observability và những sai lầm khiến router không thể được tin cậy. Mục tiêu không phải tuyên bố rằng routing luôn giảm chi phí hay luôn tăng chất lượng. Mục tiêu là làm cho trade-off trở nên rõ ràng, đo được và có thể đảo ngược.

> **Luận điểm:** Model router nên tối ưu cho outcome có ràng buộc, không tối ưu cho một bảng xếp hạng model. Nó phải biết lúc nào tác vụ là thường lệ, lúc nào độ bất định đang tăng, lúc nào provider không khỏe và lúc nào route rẻ nhất đã trở nên đắt hơn việc escalate.

## Router là lớp admission control cho năng lực suy luận

Một AI agent có nhiều loại công việc: phân loại intent, lập kế hoạch, trích xuất field, gọi tool, diễn giải kết quả tool, viết câu trả lời cho người dùng và đôi khi phục hồi sau lỗi. Những bước đó có yêu cầu capability khác nhau.

Một router hữu ích nằm giữa agent runtime và model gateway. Runtime gửi yêu cầu completion kèm task type, context, tool schema, policy và budget. Router trả về model target cùng decision record. Runtime không cần biết target là frontier model trên cloud, small model chạy nội bộ, endpoint theo vùng hay fallback tạm thời.

Sự tách biệt này quan trọng vì model identifier thay đổi thường xuyên hơn business contract của agent. Nó cũng tạo ra một nơi để áp policy: tenant nhạy cảm có thể yêu cầu một vùng dữ liệu, workflow dài có thể cần session affinity, còn bước phân loại có giá trị thấp có thể chịu hard cost ceiling.

![Các tín hiệu capability, cost, latency và infrastructure hội tụ vào một quyết định định tuyến](/blog/model-router/decision-signals.webp)

Vì vậy, hãy xem router như admission control trong hệ phân tán. Nó quyết định request được vào model pool nào, pool nào phù hợp và điều gì xảy ra khi pool ưu tiên bị bão hòa. Đây không giống việc retry một HTTP request lỗi. Retry nói rằng “hãy thử lại cùng dependency”. Router nói rằng “hãy xem lại dependency nào phù hợp”.

## Ba tín hiệu cần thiết nhưng chưa đủ

Bài viết của NVIDIA về model routing production nhóm các tín hiệu quan trọng thành **capability của model, cost profile của model và trạng thái hạ tầng**. Đây là điểm bắt đầu tốt, nhưng platform agent thường cần chiều thứ tư: authority và chính sách dữ liệu.

| Tín hiệu | Router cần biết gì | Ví dụ quyết định |
|---|---|---|
| Capability | Model nào có khả năng giải đúng tác vụ? | Dùng model mạnh hơn sau nhiều lần tool lỗi. |
| Cost | Chi phí biên của route, gồm output dài và tool call là bao nhiêu? | Giữ extraction thường lệ trên model nhỏ. |
| Latency | Bước này chịu được bao lâu? | Chọn endpoint gần và đang ấm cho lượt tương tác. |
| Infrastructure | Model có khỏe, quá tải, bị rate-limit hay timeout không? | Tránh pool đang tăng queue time. |
| Policy | Context có được gửi tới provider hoặc vùng này không? | Dữ liệu tenant hạn chế phải vào endpoint được duyệt. |
| Session state | Các lượt sau có cần cùng route hoặc model không? | Giữ affinity khi workflow phụ thuộc state đang làm việc. |

Router không nên giả vờ rằng các giá trị này chính xác tuyệt đối. Capability là một ước lượng, không phải thuộc tính có thể đọc đơn giản từ model card. Cost phụ thuộc input, output, caching, retry và vòng lặp tool. Latency gồm queue time, time to first token, thời gian stream và thời gian agent diễn giải kết quả.

Một decision record thực tế giúp nhìn thấy sự không chắc chắn:

```json
{
  "route_id": "rt_01J9...",
  "task_kind": "tool_argument_generation",
  "candidate_pool": ["small-fast", "balanced", "frontier"],
  "selected": "balanced",
  "signals": {
    "estimated_difficulty": 0.61,
    "context_tokens": 18400,
    "queue_ms": 42,
    "remaining_budget_usd": 0.018,
    "policy_region": "approved-eu"
  },
  "reason": "medium difficulty; balanced pool meets p95 latency budget",
  "fallback": "small-fast"
}
```

Đừng log raw prompt chỉ để làm routing dễ giải thích. Route record có thể chứa classification, hash, token count, policy label và model outcome mà không biến thành một kênh rò rỉ dữ liệu thứ hai. Điều này nối tự nhiên với thực hành observability bảo vệ quyền riêng tư trong [bài về agent observability](/blog/agent-observability-without-data-leaks).

## Bắt đầu bằng policy, không phải machine-learning router

Nhiều team nhảy thẳng vào learned router. Cách đó có thể hữu ích về sau, nhưng khiến failure production đầu tiên rất khó giải thích. Hãy bắt đầu bằng policy mà con người có thể đọc và review.

Một policy bốn tầng thường đã đủ hữu dụng:

1. **Lọc candidate theo policy.** Loại model không được nhận dữ liệu của tenant, không hỗ trợ tool format, hoặc không đáp ứng yêu cầu vùng và retention.
2. **Ước lượng độ khó.** Dùng feature deterministic, classifier nhỏ hoặc agent stage. Bước extraction ngắn và bước recovery không nên rơi vào cùng một bucket một cách ngẫu nhiên.
3. **Lọc theo operational budget.** Loại candidate có queue time, cost hoặc context window dự đoán vượt budget.
4. **Xếp hạng và giám sát.** Chọn expected utility cao nhất, đồng thời lưu fallback và escalation rule.

Có thể biểu diễn quyết định dưới dạng constrained score thay vì nhãn “model tốt nhất” mơ hồ:

```python
def choose_model(request, candidates, state):
    allowed = [m for m in candidates if policy_allows(request, m)]
    viable = [m for m in allowed if (
        m.context_window >= request.context_tokens and
        predicted_latency(m, request, state) <= request.latency_budget_ms and
        predicted_cost(m, request) <= request.remaining_budget_usd
    )]

    if not viable:
        return emergency_route(request, allowed, state)

    return max(viable, key=lambda m: (
        expected_quality(m, request) -
        0.35 * normalized_cost(m, request) -
        0.25 * normalized_latency(m, request, state)
    ))
```

Các con số trên không phải default chung cho mọi sản phẩm. Chúng chỉ nhắc rằng trọng số phải thuộc về constraint của sản phẩm. Câu trả lời customer support có thể ưu tiên latency. Legal extraction có thể ưu tiên quality. Batch enrichment có thể ưu tiên cost và throughput. Một global score duy nhất thường kém trung thực hơn một vài route policy có tên rõ ràng.

## Định tuyến theo agent stage, không chỉ theo user prompt

Prompt classifier nhìn thấy câu chữ của người dùng. Agent runtime nhìn thấy nhiều hơn: số tool call lỗi, kích thước working context, loại action kế tiếp và workflow có đang tiến bộ không.

Vì vậy, stage router có thể chọn model nhỏ ở phần việc thường lệ và escalate khi trajectory trở nên khó. Exploration có thể cần reasoning mạnh; format một kết quả đã được validate có thể dùng model nhanh hơn. Một tool error lặp lại là tín hiệu escalation mạnh hơn một câu phức tạp trong prompt đầu tiên.

![Model cascade escalate các route khó hoặc không khỏe nhưng vẫn giữ đường rẻ cho tác vụ thường lệ](/blog/model-router/fallback-cascade.webp)

Các tín hiệu escalation hữu ích gồm:

| Tín hiệu | Vì sao quan trọng | Phản ứng an toàn |
|---|---|---|
| Arguments cho tool sai nhiều lần | Model hiện tại không khớp contract. | Escalate một lần, sau đó dừng nếu vẫn sai. |
| Không có tiến bộ qua nhiều lượt | Agent đang lặp hoặc khám phá mà không giảm bất định. | Đổi model hoặc hỏi lại người dùng. |
| Uncertainty hoặc disagreement cao | Câu trả lời không ổn định giữa các lần kiểm tra. | Dùng judge mạnh hơn hoặc yêu cầu evidence. |
| Queue tăng | Model rẻ đã trở nên chậm dưới tải. | Chuyển sang pool khỏe hoặc load shed. |
| Provider error | Dependency đang hỏng, không chỉ trả kết quả yếu. | Mở circuit và dùng fallback được policy duyệt. |
| Context overflow | Route không thể nhìn thấy state đầy đủ. | Compact, retrieve có chọn lọc hoặc escalate. |

Escalation phải có giới hạn. Nếu mọi lỗi đều chuyển lên model lớn hơn, một tool schema sai có thể biến thành retry storm đắt đỏ. Router cần giới hạn số lần chuyển, tổng budget và terminal behavior như hỏi người dùng, xếp hàng review hoặc trả partial result an toàn.

## Fallback không chỉ là retry một lần

Provider fallback hữu ích nhưng cần semantics. Có ít nhất ba trường hợp khác nhau:

* **Transport failure:** request không tạo ra response dùng được. Thử provider khác có thể an toàn.
* **Quality failure:** model đã trả kết quả nhưng validation từ chối. Model mạnh hơn có thể giúp, nhưng replay nguyên prompt dễ lặp lỗi.
* **Policy failure:** route không được phép cho tenant hoặc data class. Retry sang endpoint cũng bị cấm không phải recovery.

Runtime nên lưu route decision và lý do của từng transition. Với response streaming, phải định nghĩa điều gì xảy ra sau partial output. Người dùng có thể đã nhìn thấy token trước khi provider lỗi. Hành vi an toàn có thể là đóng stream, hiện ranh giới retry hoặc tiếp tục bằng route khác nếu sản phẩm đánh dấu rõ việc chuyển route.

Circuit breaker nên đặt quanh provider pool, không đặt quanh toàn bộ agent. Một model không khỏe không nên làm sập các task không liên quan. Ngược lại, fallback không được âm thầm bỏ qua data residency hoặc safety policy chỉ vì endpoint chính tạm thời unavailable.

## Đo route bằng counterfactual evidence

Dashboard đầu tiên phải trả lời câu hỏi vận hành, không chỉ ăn mừng average cost giảm.

Hãy theo dõi route choice, model outcome, validation result, time to first token, total latency, input/output token, retry count, escalation count, provider error và business outcome cuối. Tách theo task kind, tenant, region, workflow stage và model pair. Average che giấu đúng những ca làm người dùng khó chịu, vì vậy cần p50, p95 và tail error rate.

![Kỹ sư so sánh kết quả route bằng latency, cost, health và tín hiệu shadow evaluation](/blog/model-router/route-dashboard.webp)

Shadow traffic là cầu nối giữa trực giác và quyết định production. Model chính phục vụ người dùng; candidate thứ hai nhận bản sao đã bảo vệ quyền riêng tư và được đánh giá mà không ảnh hưởng outcome. Shadow evaluation phải giới hạn cost và tuyệt đối không được vô tình execute tool hoặc mutate state. Có thể so sánh structured output, rubric score, latency, token và failure mode.

Một rollout đơn giản có thể đi qua bốn bước:

| Giai đoạn | Exposure | Điều kiện đi tiếp |
|---|---:|---|
| Offline replay | Trace lịch sử hoặc synthetic | Candidate đạt quality và policy gate. |
| Shadow | 1–5% request được sample | Không có regression không chấp nhận được về data, cost, latency. |
| Guarded canary | 5–10% traffic đủ điều kiện | Tail latency và tool error nằm trong budget. |
| Default route | Phần traffic còn lại | Vẫn có automatic rollback. |

Đừng chỉ so model mới bằng answer preference. Hãy so sánh toàn bộ agent trajectory: nó gọi đúng tool không, giữ state invariant không, hoàn thành trong budget không và tạo ra outcome người dùng có thể hành động không? Đó cũng là khác biệt giữa demo dễ chịu và agent đủ điều kiện release trong [bài về regression suite](/blog/agent-evals-regression-suite).

## Những cách model router thất bại

Router trở nên nguy hiểm khi abstraction che giấu khác biệt giữa các model. Tool calling, cách hiểu JSON schema, context window và verbosity có thể khác nhau. Provider-neutral interface nên normalize những gì có thể normalize và phơi bày những gì không thể.

Một lỗi khác là route flapping. Nếu mỗi lượt đều chọn độc lập, workflow nhiều bước có thể nhảy giữa các provider, mất affinity và khó debug. Dùng session route lease khi cần continuity, nhưng cho phép escalation có chủ đích khi route hiện tại không còn khỏe hoặc đủ capability.

Lỗi thứ ba là tối ưu cost cục bộ nhưng làm tăng tổng công việc. Model rẻ sinh arguments lỗi khiến hệ thống retry nhiều lần và gọi model thứ hai. Hãy đo **cost trên mỗi outcome thành công**, không chỉ cost trên mỗi request. Latency cũng vậy: first token nhanh không có ích nếu agent phải mất thêm ba lượt để sửa.

Cuối cùng, đừng biến router thành nơi phát minh business policy. Router có thể enforce tenant phải dùng region được duyệt hoặc task có budget. Nó không nên quyết định refund có được phép không, một người có đủ điều kiện không hay state transition có hợp lệ về pháp lý không. Những quy tắc đó thuộc domain service và action gate rõ ràng.

## Checklist production

Trước khi bật model router, tôi muốn có câu trả lời rõ cho các câu hỏi sau:

| Câu hỏi | Bằng chứng tối thiểu |
|---|---|
| Có giải thích được route không? | Decision record gồm candidate, signal, policy và reason. |
| Có giới hạn escalation không? | Maximum transition, retry budget và terminal behavior. |
| Có giữ được quy tắc dữ liệu nhạy cảm không? | Candidate filtering và test region, tenant, data class. |
| Có phát hiện route xuống cấp không? | Metric quality, latency, cost, provider error và outcome theo route. |
| Có rollback được không? | Static policy hoặc route version trước có thể khôi phục nhanh. |
| Có đánh giá không side effect được không? | Replay và shadow harness không thể gọi write tool. |

Model router không phải lý do để ngừng cải thiện prompt, tool, retrieval hay agent state. Nó chỉ thừa nhận một sự thật khó chịu: bên trong AI system có nhiều workload khác nhau, và không nên định giá, tính thời gian hay tin cậy chúng theo cùng một cách.

Router tốt nhất đôi khi sẽ chọn model mạnh nhất. Nó cũng biết khi nào lựa chọn đó không cần thiết, khi nào đã quá muộn và khi nào hành động đúng là dừng lại. Đó là lúc “multi-model” trở thành một discipline kỹ thuật thay vì một khẩu hiệu tiết kiệm chi phí.

## Tài liệu tham khảo

[1]: [NVIDIA Technical Blog — Route AI Agent Workloads Across Models with NVIDIA NeMo Switchyard](https://developer.nvidia.com/blog/route-ai-agent-workloads-across-models-with-nvidia-nemo-switchyard/)
[2]: [LangChain — State of AI Agents](https://www.langchain.com/state-of-agent-engineering)
[3]: [Do Quoc Viet — Agent observability without data leaks](/blog/agent-observability-without-data-leaks)
[4]: [Do Quoc Viet — Regression evals for tool-calling agents](/blog/agent-evals-regression-suite)
