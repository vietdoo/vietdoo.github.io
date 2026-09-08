---
title: "Thiết kế SLO cho AI Agent: Đo Success Rate, Latency, Cost và Safety như thế nào?"
description: "Một framework hướng production để đo AI Agent theo bốn chiều success, latency, cost và safety thay vì che giấu độ tin cậy sau một con số pass rate."
pubDate: 2026-05-28
category: "engineering"
lang: "vi"
translationKey: "ai-agent-slo-success-latency-cost-safety"
draft: false
image: "/blog/ai-agent-slo/hero.webp"
---

Một API thông thường có contract khá rõ. Nó nhận request, trả response và expose những tín hiệu quen thuộc như error rate, latency và availability. AI Agent thì khác. Nó có thể gọi nhiều model, retrieve document, retry tool, hỏi lại người dùng rồi vẫn tạo ra một câu trả lời nghe có vẻ hợp lý.

Vì vậy, “request trả về 200” là một định nghĩa rất kém cho reliability. Agent có thể nhanh nhưng sai, đúng nhưng quá đắt, hoặc hoàn thành task trong khi vi phạm policy. Một SLO hữu ích phải đại diện cho công việc mà người dùng thật sự quan tâm.

![Một engineer theo dõi bốn đồng hồ success, latency, cost và safety xoay quanh một AI Agent production](/blog/ai-agent-slo/hero.webp)

<figure class="blog-video">
  <video controls preload="metadata" playsinline poster="/blog/ai-agent-slo/hero.webp" aria-label="Video giải thích nội dung bài viết, phiên bản tiếng Việt">
    <source src="/blog/ai-agent-slo-success-latency-cost-safety/video-vi.mp4" type="video/mp4" />
    Trình duyệt của bạn không hỗ trợ video HTML5.
  </video>
  <figcaption>Video giải thích chuyên sâu: phiên bản tiếng Việt.</figcaption>
</figure>

Mô hình tôi thường dùng là một scorecard bốn chiều: **success, latency, cost và safety**. Bốn chiều này nên được đo từ cùng một trace, vì một task chỉ thực sự khỏe khi kết quả đúng, đến trong khoảng thời gian chấp nhận được, nằm trong ngân sách và không tạo ra risk không thể chấp nhận.

## Availability cần thiết nhưng chưa đủ

Availability trả lời câu hỏi service có phản hồi hay không. Nó không trả lời agent có hoàn thành task hay không.

Ví dụ, người dùng yêu cầu agent đổi lịch giao hàng. Agent trả về một câu xác nhận lịch sự, nhưng calendar tool đã timeout và không có reservation nào thay đổi. Nhìn từ HTTP, request thành công. Nhìn từ phía người dùng, request thất bại.

Bước đầu tiên vì thế là định nghĩa task-level outcome. Một task nên kết thúc bằng status có cấu trúc như `completed`, `partially_completed`, `needs_user_input`, `blocked_by_policy` hoặc `failed`. Nhãn này phải được suy ra từ state và tool result đã quan sát, không chỉ từ câu cuối cùng mà model viết ra.

| Dimension | Câu hỏi | Tín hiệu SLO ví dụ |
|---|---|---|
| Success | Task dự kiến có hoàn thành đúng không? | Valid completed task / eligible task |
| Latency | Task có hoàn thành trong khoảng người dùng chờ được không? | p95 thời gian end-to-end |
| Cost | Task có nằm trong ngân sách không? | p95 cost và tỷ lệ vượt budget |
| Safety | Agent có tuân policy và tránh side effect nguy hiểm không? | Safe completion / eligible task |

Denominator rất quan trọng. Nếu các request bị block bị loại khỏi success calculation, con số có thể đẹp hơn trong khi người dùng gặp nhiều friction hơn. Hãy định nghĩa eligibility và exclusion rõ ràng, đồng thời giữ chúng đủ ổn định để so sánh các release.

## Success cần contract, không cần cảm giác

Success rate thường được trình bày như một phần trăm duy nhất do một judge model tạo ra. Nó có thể là một signal hữu ích, nhưng quá mơ hồ để trở thành SLO duy nhất.

Với support agent, success có thể yêu cầu câu trả lời dùng đúng order state, refund được tạo đúng amount và không vi phạm policy. Với research agent, success có thể là report có đủ section cần thiết và vượt qua factual review. Với operational agent, outcome thật có thể là một state transition trong hệ thống khác.

Tôi thích định nghĩa success bằng một contract nhỏ gồm các check có thể quan sát:

```text
success =
  task_intent_matched
  AND required_fields_present
  AND tool_result_consistent
  AND expected_state_transition_observed
  AND no_policy_violation
```

Điều này không loại bỏ hoàn toàn judgment. Một số task vẫn cần human review hoặc graded quality score. Nhưng nó giúp team nhìn thấy behavior và phân biệt “câu trả lời nghe hợp lý” với “workflow đã thực sự hoàn thành”.

[Regression suite cho agent](/blog/agent-evals-regression-suite) có thể cung cấp contract trước release. Production SLO sau đó quan sát cùng những chiều này trên traffic thật, với privacy control phù hợp cho evidence.

## Latency là ngân sách chia theo stage

End-to-end latency là con số người dùng cảm nhận, nhưng engineer cần biết thời gian đã tiêu ở đâu. Một agent thường mất thời gian cho routing, retrieval, model call, tool execution, retry và đôi khi cả việc chờ người dùng.

![Một agent trace chia request thành routing, retrieval, model, tool, retry và final response với latency budget rõ ràng](/blog/ai-agent-slo/trace-timeline.webp)

Một budget có thể bắt đầu như sau:

| Stage | Budget | Khi tăng thì kiểm tra gì |
|---|---:|---|
| Initial routing | 300 ms | Model selection, queueing, cold start |
| Retrieval | 800 ms | Index latency, filter, fan-out |
| Reasoning và tool selection | 2 s | Model latency, context size, loop |
| Tool execution | 1.5 s | Downstream API, retry, connection pool |
| Final response | 1 s | Output length, streaming |

Con số cụ thể phụ thuộc product. Điều quan trọng là dành một budget rõ cho uncertainty. Nếu agent hỏi clarification, đó chưa chắc là latency failure; có thể đó là cách an toàn nhất để tránh action sai. Ngược lại, agent tự loop qua năm tool có thể vừa chậm vừa nguy hiểm.

Hãy đo p50 cho trải nghiệm bình thường, p95 cho SLO và một tail indicator như p99 để bắt runaway behavior. Cắt dữ liệu theo task type, model, tool, tenant và việc human gate có tham gia hay không. Một p95 tổng thể có thể che giấu một workflow luôn chậm đến mức không dùng được.

## Cost cũng là một phần của reliability

Một task hoàn thành nhưng tốn gấp mười lần dự kiến không thể xem là khỏe về mặt vận hành. Cost ảnh hưởng khả năng scale, tính dự đoán của trải nghiệm và nguy cơ một prompt nhỏ kích hoạt một loop đắt đỏ.

Hãy track cost ở task level, không chỉ ở model-call level. Một task có thể gồm input token, output token, cached context, embedding call, retrieval operation, tool execution và retry. Trace cần nối mọi event đó với cùng một task identifier.

Một policy đơn giản có thể dùng soft threshold và hard threshold. Khi gần soft threshold, agent chuyển sang model rẻ hơn, giảm context hoặc hỏi user thu hẹp yêu cầu. Khi chạm hard threshold, agent dừng và trả partial result rõ ràng thay vì âm thầm loop tiếp.

![Một agent nhỏ chạy vòng quanh các đồng hồ token, latency và cost cho tới khi budget gate dừng loop và ghi nhận partial outcome an toàn](/blog/ai-agent-slo/budget-guardrail.webp)

Đừng tối ưu cost bằng cách che giấu work. Nếu bỏ bước summarization và người dùng nhận câu trả lời kém hơn, success metric phải cho thấy trade-off đó. Cost là một chiều của SLO vì nó cần được cân bằng với quality, không phải tối thiểu hóa một cách cô lập.

## Safety cũng cần error budget

Safety thường bị xem như một checklist nằm ngoài reliability engineering. Trong một agent, safety failure chính là production failure.

Safety SLO có thể gồm policy violation, unauthorized tool call, lộ sensitive data, destination không an toàn, action bỏ qua approval bắt buộc và action dùng authorization đã stale. Bộ chỉ số cụ thể tùy domain, nhưng nguyên tắc giống nhau: định nghĩa bad outcome có thể quan sát và đưa chúng vào release decision.

Một số event nên có zero-tolerance policy. Unauthorized transfer, secret disclosure hoặc cross-tenant read không nên được trung bình hóa vào một tỷ lệ tháng rồi xem là lỗi nhỏ. Những event khác có thể đo theo rate, chẳng hạn tỷ lệ low-risk task bị escalation không cần thiết.

Safety telemetry phải được thiết kế cẩn thận. Team cần đủ structured evidence để điều tra, nhưng raw prompt, tool argument hoặc customer record không nên tự động biến thành searchable log. Cách tiếp cận privacy-aware trong bài [observability cho agent không làm lộ dữ liệu](/blog/agent-observability-without-data-leaks) là một companion phù hợp: ghi metadata và evidence được kiểm soát, không ghi content vô hạn.

## Một trace nên nối cả bốn dimension

Scorecard chỉ thật sự có giá trị khi success, latency, cost và safety có thể được join qua cùng một trace.

Root task span có thể mang task type, tenant class, model route, outcome status, policy version và release version. Child span đại diện cho retrieval, model call, tool proposal, policy decision, human approval, tool execution và state verification.

Với mỗi task, hệ thống nên trả lời được:

- User yêu cầu agent hoàn thành điều gì?
- Agent đã đi qua route nào?
- Tool call nào được propose và tool call nào được execute?
- Mỗi stage mất bao lâu?
- Task tốn bao nhiêu?
- Policy decision hoặc human gate nào đã ảnh hưởng outcome?
- External state nào chứng minh task thật sự hoàn thành?

Điều này hữu ích hơn một dashboard có bốn counter không liên quan. Engineer có thể thấy success giảm vì retrieval index chậm, cost tăng vì fallback model được gọi sau một tool retry, hoặc safety block tăng sau khi policy đổi.

## Alert nên bảo vệ budget, không tạo noise

Một alert tốt phải mô tả decision team có thể đưa ra. “Agent quality đang giảm” là chưa đủ. Một alert tốt hơn sẽ nói workflow refund rơi dưới target completed-task SLO trong hai window liên tiếp, đồng thời unauthorized-action attempt tăng sau khi prompt version mới được triển khai.

Hãy dùng tư duy burn rate cho error budget. Burn nhanh thì page team phụ trách; burn chậm thì tạo ticket hoặc trigger review. Tách budget cho availability-like failure, quality failure, cost overrun và safety event. Gộp hết thành một con số làm remediation path trở nên mơ hồ.

Đừng alert trên mọi variation của model. Mục tiêu SLO là bảo vệ user-visible promise, không phải phạt mọi thay đổi nội bộ vô hại. Ngược lại, dashboard chẩn đoán vẫn nên đủ chi tiết để tìm regression nhanh.

## Một scorecard thực tế để bắt đầu

Với production version đầu tiên, tôi sẽ chọn một task family và dùng scorecard nhỏ:

| Target | Objective ví dụ | Khi nào review |
|---|---|---|
| Completed task | Ít nhất 95% eligible task hoàn thành đúng | Burn vượt target trong hai window |
| End-to-end latency | p95 dưới budget người dùng chấp nhận | Tail latency tăng sau route change |
| Task cost | p95 dưới budget, hard stop hiếm | Tỷ lệ vượt budget tăng |
| Safety | Không có high-impact action trái quyền | Incident review ngay lập tức |

Các con số trên chỉ là ví dụ, không phải default cho mọi hệ thống. Điều quan trọng là mỗi target có denominator rõ, evidence path và owner. Bắt đầu với workflow hẹp, kiểm chứng measurement rồi mới mở rộng scorecard.

AI Agent không đáng tin chỉ vì nó nói chuyện tự tin hay endpoint luôn available. Nó đáng tin khi hệ thống chứng minh được task đã hoàn thành đúng, trong khoảng thời gian và chi phí chấp nhận được, mà không vượt qua safety boundary. SLO biến định nghĩa đó thành engineering practice: đo được, review được và khó bị che giấu sau một phần trăm success duy nhất.
