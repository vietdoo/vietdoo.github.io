---
title: "Thiết kế AI System theo Evals: Từ Golden Set nhỏ đến Rollout theo KPI"
description: "Playbook dành cho senior engineer để biến một golden set nhỏ thành release gate, KPI kinh doanh và vòng lặp học tập cho AI system production."
pubDate: 2026-07-05
category: "engineering"
image: "/blog/eval-driven-ai-system-design/hero.webp"
lang: "vi"
translationKey: "eval-driven-ai-system-design"
draft: false
---

![Minh họa nét vẽ tay về vòng lặp đánh giá AI production nối golden set, trace, release gate và kết quả kinh doanh](/blog/eval-driven-ai-system-design/hero.webp)

AI system đầu tiên khiến tôi thực sự yên tâm không phải system có demo ấn tượng nhất. Đó là system mà cả team có thể trả lời một câu hỏi kém hào nhoáng hơn: **điều gì sẽ khiến chúng ta dừng một release?**

Câu hỏi này thay đổi toàn bộ tư duy engineering. Demo hỏi model có thể tạo ra một câu trả lời thuyết phục hay không. Production hỏi câu trả lời đó có còn hữu ích khi input thiếu, retrieval index đã cũ, tool timeout, model được nâng cấp, khách hàng thuộc tenant khác, và hóa đơn token xuất hiện cuối tháng hay không.

Không thể giải quyết khác biệt ấy chỉ bằng cách viết system prompt dài hơn. Cách đúng là đưa evaluation vào trong kiến trúc.

Hướng dẫn eval-driven system design của OpenAI mô tả một con đường thực tế: bắt đầu từ một tập dữ liệu có nhãn nhỏ, dựng initial evals, nối kết quả với KPI và chi phí, sau đó cải tiến lặp lại cả trước lẫn sau khi deploy. Điều quan trọng không nằm ở framework cụ thể. Điều quan trọng là biến sự không chắc chắn thành một vòng lặp quyết định có thể chạy lại.

> **Luận điểm:** Một AI release nên được promote vì system tạo ra đủ bằng chứng chống lại một contract, không phải vì reviewer có cảm giác demo mới trông tốt hơn.

## Bắt đầu bằng golden set nhỏ, đừng chờ một dataset hoàn hảo trong tưởng tượng

Phần lớn team không khởi đầu với benchmark sạch sẽ. Họ có mười hai support ticket, một file spreadsheet xuất từ hệ thống cũ, vài transcript production và một product manager hiểu failure mode tốt hơn database.

Đó không phải lý do để trì hoãn evaluation. Ngược lại, đó là lý do phải thiết kế evaluation một cách trung thực.

**Golden set** là một tập case được chọn có chủ đích, trong đó mỗi case có đủ context để chấm một hành vi quan trọng. Nó không cần đại diện cho mọi user ngay từ ngày đầu. Nhiệm vụ đầu tiên của nó là làm lộ ra những quyết định mà team vẫn đang để ngầm. Hai mươi case được mô tả rõ có thể hữu ích hơn một nghìn mẫu gắn nhãn lỏng lẻo, nếu mỗi case đều nói rõ success là gì, điều gì tuyệt đối không được xảy ra, và bằng chứng nào là nguồn sự thật.

Với một procurement agent nội bộ, một case có thể như sau:

```yaml
id: invoice_duplicate_candidate
risk: high
input: "Kiểm tra invoice INV-1042 và cho tôi biết nó đã được thanh toán chưa."
fixtures:
  invoice: { id: INV-1042, amount: 1840, currency: USD }
  ledger: { status: PAID, paymentId: PAY-7781 }
expected:
  answerIncludes: ["đã thanh toán", "PAY-7781"]
  databaseMutations: []
  forbiddenTools: [issue_refund, change_payment_status]
budgets:
  maxToolCalls: 3
  maxModelTurns: 2
```

Case này chính xác hơn một prompt test thông thường. Nó mô tả world ban đầu, outcome kỳ vọng, authority bị cấm và operational budget. Nếu agent trả lời đúng câu chữ nhưng đã thử gọi refund, case vẫn phải fail.

Golden set đầu tiên cần có nhiều hơn happy path. Nên trộn các task phổ biến, task rủi ro cao, câu nói mơ hồ, dữ liệu thiếu, dữ liệu stale, tool failure và request có tính adversarial hoặc nhạy cảm về policy. Tỷ lệ chính xác bao nhiêu không quan trọng bằng việc nó buộc team phải nói chuyện với nhau về failure mode.

| Nhóm case              | Nó giúp phát hiện gì?                | Ví dụ                                               |
| ---------------------- | ------------------------------------ | --------------------------------------------------- |
| Common path            | Core capability có hoạt động không   | Tìm invoice đã trả và tóm tắt                       |
| Ambiguity              | System có hỏi lại thay vì đoán không | “Hủy subscription cũ” trong khi có hai subscription |
| Missing evidence       | Uncertainty có được nói rõ không     | Ledger không có payment tương ứng                   |
| Tool failure           | System có recover an toàn không      | Payment service trả timeout                         |
| Authorization boundary | Capability có hẹp hơn intent không   | User được xem nhưng không được refund               |
| Regression seed        | Bug đã sửa có quay lại không         | Tool bị gọi trước lookup bắt buộc                   |

Golden set không phải bảo tàng. Nó là bản đồ rủi ro sống. Mỗi defect lọt ra production nên trở thành một case mới hoặc khiến một case cũ được mô tả chính xác hơn.

## Tách capability evaluation khỏi regression evaluation

Hai team có thể chạy cùng một tập case nhưng đi đến hai kết luận trái ngược, vì họ đang trả lời hai câu hỏi khác nhau.

**Capability evaluation** hỏi: “System làm được bao nhiêu?” Đây là bức tường để leo. Một system mới có thể score thấp nhưng vẫn đang đi đúng hướng nếu các case fail chỉ ra khoản đầu tư engineering tiếp theo.

**Regression evaluation** hỏi: “Những behavior đã hứa có còn được giữ không?” Đây là lan can bảo vệ. Một regression case quan trọng không được phép hy sinh safety chỉ vì model mới làm average helpfulness tốt hơn.

Điều này đặc biệt quan trọng với agentic system. Một model upgrade có thể cải thiện answer quality nhưng lại thay đổi tool selection, retry behavior hoặc lượng dữ liệu đưa vào prompt. Nếu dashboard gộp mọi thứ thành một score, team không biết mình đã được gì và âm thầm làm hỏng gì.

![Minh họa nét vẽ tay: capability test leo lên cao còn regression test bảo vệ con đường release](/blog/eval-driven-ai-system-design/capability-regression.webp)

Release suite nên có ít nhất các lane sau:

| Lane       | Câu hỏi chính                                                | Gate điển hình                                                    |
| ---------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Capability | System có giải được task khó hoặc rộng hơn không?            | Theo dõi trend và error budget                                    |
| Regression | Behavior đã cam kết có còn nguyên không?                     | Zero critical violation; soft quality có floor                    |
| Safety     | Authority, privacy và policy boundary có còn được giữ không? | Forbidden action, data leak hoặc unapproved mutation là hard fail |
| Operations | Latency, cost và retry có nằm trong budget không?            | Threshold theo risk tier và traffic class                         |

Regression suite chỉ thật sự hữu ích khi engineer nhìn thấy case đỏ và biết cần kiểm tra prompt, model, tool schema, fixture, evaluator hay product contract.

## Chấm đúng ba bề mặt: run, trace và outcome

Final answer chỉ là một bề mặt của AI system. Với tool-using agent, một mô hình evaluation hữu ích nên tách **run**, **trace** và **outcome**.

Run là một model call hoặc tool invocation. Đây là nơi kiểm tra schema, token budget, provider error và quyết định cục bộ một cách rẻ. Trace là toàn bộ đường đi của một task: model call, retrieval, tool call, guardrail, retry và response cuối. Outcome là trạng thái thật của thế giới sau khi chạy: một database row, file được tạo, ticket được chuyển trạng thái, hoặc chủ đích không có mutation nào.

| Bề mặt  | Nên chấm deterministic                                   | Nên chấm semantic                             |
| ------- | -------------------------------------------------------- | --------------------------------------------- |
| Run     | JSON schema, tool được phép, argument shape, token count | Một quyết định cục bộ có hợp lý không         |
| Trace   | Constraint về thứ tự, forbidden tool, retry count        | Groundedness, độ đầy đủ, cách nói uncertainty |
| Outcome | State diff, event phát ra, approval status               | Tính hữu ích và mức chấp nhận của business    |

Tách như vậy giúp tránh một lỗi phổ biến: dùng LLM để chấm những fact mà code có thể kiểm tra chính xác. Nếu database đã thay đổi, hãy so sánh database. Nếu tool bị cấm, hãy match tool name. Nếu response phải có policy version, hãy assert trực tiếp. Chỉ dùng model-based judge cho những phẩm chất thật sự cần diễn giải.

Contract cho evaluation có thể đơn giản như sau:

```ts
type EvaluationResult = {
  caseId: string;
  hardFailures: string[];
  softScore: number;
  outcome: "pass" | "fail" | "review";
  traceId: string;
  costUsd: number;
  latencyMs: number;
};

function decide(result: EvaluationResult) {
  if (result.hardFailures.length > 0) return "fail";
  if (result.softScore < 0.82) return "review";
  return "pass";
}
```

Một aggregate score duy nhất che giấu quá nhiều thứ. System có 94% helpfulness và một unauthorized write không khỏe hơn system có 87% helpfulness nhưng không vi phạm authority. Gate phải phản ánh risk chứ không chỉ average sentiment.

## Nối eval với business outcome nhưng đừng giả vờ đã chứng minh nhân quả

Team kỹ thuật thường dừng ở câu “judge score tăng từ 0.71 lên 0.78.” Con số ấy chỉ hữu ích nếu nó thay đổi một quyết định. Product team cần biết system có giảm handling time, tăng resolution, giảm escalation hay tạo thêm rework đắt đỏ không.

Cầu nối không phải là ép mọi response vào một nhãn doanh thu đơn giản. Cách tốt hơn là gắn một **business observation** vào chính case hoặc cohort đã tạo ra technical trace.

Ví dụ một support agent tạo reply draft. Measurement chain có thể là:

```text
case -> trace -> technical graders -> reviewer action -> customer outcome
```

Technical grader kiểm tra citation coverage, policy compliance và tool behavior. Reviewer action ghi nhận accepted, edited, rejected hay escalated. Customer outcome ghi nhận ticket reopen, time to resolution hoặc satisfaction signal. Chuỗi này chưa phải bằng chứng rằng model gây ra mọi business result, nhưng nó giúp team kiểm tra xem cải thiện kỹ thuật có sống sót khi đi vào công việc thật hay không.

![Minh họa nét vẽ tay nối model trace với reviewer action, operational metric và business outcome](/blog/eval-driven-ai-system-design/kpi-bridge.webp)

| Technical signal          | Operational signal         | Câu hỏi business                                      |
| ------------------------- | -------------------------- | ----------------------------------------------------- |
| Groundedness score        | Reviewer edit rate         | Người dùng có đang sửa cùng một factual gap không?    |
| Tool-contract pass rate   | Escalation rate            | Agent đã đủ an toàn để xử lý tier dự kiến chưa?       |
| Median và p95 latency     | Handle time                | System có làm công việc nhanh hơn không?              |
| Cost trên successful task | Cost trên resolved case    | Capability có bền vững về kinh tế không?              |
| Regression failure        | Rollback hoặc hotfix count | Chất lượng release có cải thiện theo thời gian không? |

Có hai cái bẫy. Một là tối ưu proxy chỉ vì nó dễ đo. Hai là chờ attribution hoàn hảo rồi mới instrument. Hãy bắt đầu với một cohort hẹp, liên quan đến quyết định thật, và ghi rõ metric có thể cũng như không thể kết luận điều gì.

## Thiết kế release gate dạng ma trận, đừng dùng một con số thần kỳ

Release gate phải phụ thuộc vào risk của behavior. Internal summarizer rủi ro thấp và agent có quyền authorize payment không nên dùng cùng threshold.

Dùng hard gate cho property không thể thương lượng. Dùng soft threshold cho phẩm chất có thể cải thiện dần. Những kết quả mơ hồ nên đi vào review thay vì bị biến thành một false pass.

![Minh họa nét vẽ tay về release-gate matrix nối risk tier với hard failure, quality threshold và review path](/blog/eval-driven-ai-system-design/release-gate-matrix.webp)

| Risk tier | Hard gate                                            | Soft gate                                | Promotion policy                      |
| --------- | ---------------------------------------------------- | ---------------------------------------- | ------------------------------------- |
| Low       | Không schema hoặc privacy violation                  | Helpful score cao hơn baseline           | Tự động nếu cost và latency ổn định   |
| Medium    | Không forbidden tool hoặc unsupported claim          | Quality không thấp hơn floor             | Canary kèm sampled review             |
| High      | Không unauthorized mutation, leak hoặc policy bypass | Domain score và human review đạt ngưỡng  | Manual approval và rollback plan      |
| Critical  | Zero critical failure trong protected cases          | Không thay thế hard safety bằng điểm mềm | Không promote chỉ dựa aggregate score |

Gate cũng phải nói rõ baseline so sánh. “Model mới tốt hơn” không phải test. “Model mới không có critical regression, tăng accepted-draft rate ít nhất ba điểm trên cùng cohort và vẫn nằm trong cost envelope” mới là decision rule.

## Làm evaluation đủ rẻ để chạy liên tục

Một evaluation suite hoàn hảo nhưng chạy mất sáu tiếng sẽ bị bypass. Câu trả lời thực tế là tiered suite.

Pull-request lane nên chạy deterministic case giá rẻ: schema validation, tool allowlist, state invariant, prompt-injection fixture và một tập golden trace nhỏ. Pre-release lane chạy replay rộng hơn, nhiều trial cho mỗi case và một số judge-based grader. Post-deployment lane sample traffic thật với privacy control, so sánh cohort và theo dõi drift.

| Lane       | Tần suất                               | Case                                      | Mục đích                     |
| ---------- | -------------------------------------- | ----------------------------------------- | ---------------------------- |
| PR         | Mỗi thay đổi                           | Regression nhỏ, deterministic, risk cao   | Chặn breakage rõ ràng từ sớm |
| Release    | Khi đổi model, prompt, tool hoặc index | Full golden set với nhiều trial           | Quyết định promotion         |
| Production | Sample liên tục                        | Trace thật đã sanitize và business cohort | Phát hiện drift và cost ẩn   |
| Incident   | Khi cần                                | Failure đã replay cùng case lân cận       | Ngăn lỗi tái diễn            |

Chi phí của một case không chỉ là token. Nó còn là công sức bảo trì fixture, grader, thời gian review và cognitive cost để hiểu failure. Giữ suite đủ nhỏ để có owner rõ ràng. Chỉ xóa case khi contract bên dưới không còn ý nghĩa, đừng xóa chỉ vì test đỏ gây khó chịu.

## Vòng lặp production: observe, label, change, replay

Eval system trở nên có giá trị nhất sau launch. Production failure cho thấy cách diễn đạt, workflow và tổ hợp trạng thái mà team không thể tưởng tượng trong ngày đầu. Vòng lặp nên biến phát hiện ấy thành kiến thức engineering bền vững.

```text
observe -> sanitize -> cluster -> label -> add or refine case
      -> change system -> replay -> compare -> promote or revert
```

Bước `sanitize` rất quan trọng. Trace thường chứa customer data, secret hoặc proprietary prompt. Record evaluation cần giữ lại failure signal nhưng giảm tối đa việc sao chép dữ liệu nhạy cảm. OWASP khuyến nghị sanitization, least-privilege access, tokenization và redaction để giảm nguy cơ sensitive information disclosure.

Bước `cluster` ngăn một trăm ticket tương tự biến thành một trăm test case nhiễu. Hãy gom failure theo invariant: sai tenant, policy cũ, action không được hỗ trợ, citation thiếu, retry storm hoặc clarification kém. Test suite nên encode behavior chứ không encode đúng một câu chữ của khách hàng.

Cuối cùng, hãy lưu lý do case được thay đổi. Một regression case không có lịch sử sẽ dần mất niềm tin. Case ghi “thêm sau incident double-refund của INV-1042” mang theo institutional memory mà aggregate score không thể thay thế.

## Ba dấu hiệu senior engineer nên từ chối ship

Dấu hiệu thứ nhất là team không thể định nghĩa outcome độc lập với final text của model. Nếu system thay đổi state, tạo file, gửi message hoặc đưa ra recommendation, outcome phải observable bên ngoài response.

Dấu hiệu thứ hai là suite chỉ có happy path. Không có ambiguity, missing evidence, tool failure, authorization và regression case nghĩa là suite đang đo một demo chứ không đo system.

Dấu hiệu thứ ba là release decision chỉ dựa trên một score không phân rã theo risk. Average có ích để xem trend, nhưng không thể thay thế authority boundary, data protection và operational budget.

Mục tiêu không phải làm AI system deterministic. Mục tiêu là khiến tính biến thiên của nó trở nên **có thể nhìn thấy, có giới hạn và có hành động tiếp theo**.

## Kết luận

Evaluation thường được giới thiệu như một testing task do ML engineer sở hữu. Trong production AI system, nó rộng hơn: đó là nơi product intent, architecture, security, operations và economics trở thành các contract đủ rõ để có thể kiểm tra và thậm chí mâu thuẫn với nhau.

Hãy bắt đầu bằng một golden set nhỏ. Tách capability khỏi regression. Chấm run, trace và outcome riêng biệt. Dùng code cho fact cứng, judge cho semantic. Nối technical evidence với business observation. Dựng gate theo risk. Sau đó để production failure làm giàu suite thay vì biến mất trong support queue.

Team AI trưởng thành không phải team tuyên bố model hiếm khi fail. Đó là team có thể chỉ ra **failure nào không thể chấp nhận, failure nào đang cải thiện, ai chịu trách nhiệm, và vì sao release tiếp theo xứng đáng được đưa lên production**.

## Tài liệu tham khảo

[1]: https://developers.openai.com/cookbook/examples/partners/eval_driven_system_design/receipt_inspection "OpenAI, Eval Driven System Design - From Prototype to Production"
[2]: https://github.com/openai/evals "OpenAI Evals repository"
[3]: https://modelcontextprotocol.io/specification/2025-06-18 "Model Context Protocol Specification 2025-06-18"
[4]: https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/ "OWASP LLM02:2025 Sensitive Information Disclosure"
