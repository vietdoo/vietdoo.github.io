---
title: "Khi model thay đổi: Behavioral contract và quy trình nâng cấp AI agent an toàn trong production"
description: "Playbook production để nâng cấp AI model bằng behavioral contract, shadow traffic, semantic diff, canary promotion, rollback và phát hiện drift sau release."
pubDate: 2026-02-18
category: "engineering"
image: "/blog/model-upgrade/hero.webp"
lang: "vi"
translationKey: "model-upgrade-safe-upgrades"
draft: false
---

![Hai phiên bản AI model được nối với nhau bằng các checkpoint và một cổng release có kiểm soát](/blog/model-upgrade/hero.webp)

Một lần nâng cấp model thường chỉ xuất hiện dưới dạng một thay đổi cấu hình. Thay `model-a` bằng `model-b`, chạy deployment rồi nhìn dashboard chuyển sang màu xanh. Phần diff có thể chỉ một dòng, nhưng hành vi phía sau thì không nhỏ như vậy. Model mới có thể thay đổi cách agent hiểu intent, chọn tool, tạo arguments, từ chối yêu cầu, trích dẫn bằng chứng, tiêu thụ token hoặc phục hồi sau một bước thất bại.

Vì thế, mình không xem nâng cấp model là một lần bump dependency đơn thuần. Mình xem đó là một **behavioral release — một lần phát hành thay đổi hành vi**.

Điểm này quan trọng vì model endpoint không phải một pure function có output contract bất biến. Dù prompt và application code không đổi, phân phối output vẫn có thể dịch chuyển. Một số thay đổi rất đáng hoan nghênh: ít claim không có căn cứ hơn, arguments có cấu trúc tốt hơn, latency thấp hơn. Nhưng cũng có thay đổi chỉ lộ ra khi người dùng phát hiện agent hỏi xin confirmation quá muộn, gọi tool đắt tiền không cần thiết hoặc trả về câu trả lời trông hợp lý nhưng có bằng chứng yếu hơn.

> **Luận điểm:** Một lần nâng cấp model trong production chỉ an toàn khi hệ thống mô tả được hành vi mình cam kết, so sánh candidate với cam kết đó, và khôi phục được release trước mà không phải ứng biến giữa sự cố.

## Lớp còn thiếu giữa eval và deployment

Trong kho bài của folio đã có một ngôn ngữ khá tự nhiên về độ tin cậy của AI: golden set, tool contract, SLO, trace, policy gate và hạ tầng rollback an toàn. Nâng cấp model nằm ở giao điểm của những ý tưởng này. Nó không chỉ là bài toán eval, vì điểm offline tốt không chứng minh được workflow live vẫn giữ nguyên action pattern. Nó không chỉ là bài toán observability, vì trace cho biết chuyện gì đã xảy ra sau khi traffic đi vào. Và nó cũng không chỉ là bài toán routing, vì chọn model khác với chứng minh model mới tương thích với sản phẩm hiện tại.

Một quy trình release hữu ích cần nối các lớp này với nhau:

| Lớp | Câu hỏi cần trả lời trước khi promote | Bằng chứng cần giữ |
| --- | --- | --- |
| Contract | Hành vi nào nhất định phải còn đúng? | Behavioral requirement có version |
| Offline evaluation | Candidate có qua các case đã biết và case đối kháng không? | Kết quả theo từng case và lời giải thích |
| Shadow traffic | Candidate chạy trên input thật đại diện ra sao khi chưa có side effect? | Paired trace và diff đã chuẩn hóa |
| Canary | Candidate có ổn định dưới một nhóm người dùng thật nhỏ không? | Outcome, safety, latency và cost signals |
| Rollback | Có khôi phục nhanh được hành vi known-good không? | Immutable routing pointer và bài test recovery |

Mỗi lớp trả lời một câu hỏi khác nhau. Dùng một pass rate duy nhất cho tất cả các lớp sẽ tạo ra cảm giác an toàn giả.

Báo cáo State of Agent Engineering năm 2026 cho thấy áp lực vận hành phía sau bài toán này. Trong khảo sát hơn 1.300 người làm nghề, 57% cho biết tổ chức của họ đã có agent chạy production, trong khi quality vẫn là rào cản phổ biến nhất. Cùng báo cáo đó cho thấy observability được áp dụng rộng hơn offline eval và online eval, còn việc dùng nhiều model đã trở thành điều bình thường chứ không còn là ngoại lệ. Một đội ngũ có thể sở hữu trace rất tốt và nhiều model để lựa chọn nhưng vẫn chưa trả lời được câu hỏi: **chính xác thì điều gì không được thay đổi khi thay model này bằng model khác?**

## Viết behavioral contract trước khi viết test case

Behavioral contract không phải yêu cầu model phải tạo ra cùng một đoạn văn. Exact string equality thường là một phép thử sai. Contract mô tả những thuộc tính mà hệ thống xung quanh phụ thuộc vào, đồng thời chỉ ra nơi variation được chấp nhận.

Mình thường chia contract thành năm chiều.

| Chiều | Ví dụ contract | Điều được phép thay đổi |
| --- | --- | --- |
| Answer | Câu trả lời phải trích dẫn evidence đã retrieve và nói rõ uncertainty khi evidence thiếu. | Cách diễn đạt, thứ tự đoạn, ví dụ vô hại |
| Action | Refund vượt ngưỡng policy không được gọi write tool trực tiếp. | Lời giải thích trước khi escalation |
| Structure | Tool arguments phải đúng JSON schema và giữ nguyên identifier. | Thứ tự optional field và whitespace |
| Safety | Action có tác động lớn cần fresh approval và preview effect. | Tone của lời nhắc xin approval |
| Operations | P95 latency và cost trên mỗi task thành công phải nằm trong ngân sách. | Phân phối trong khoảng tolerance đã thống nhất |

Contract giúp tách hai việc rất dễ bị trộn lẫn: **invariant** là điều bắt buộc còn đúng; **tolerance** mô tả mức dao động có thể chấp nhận. Model dùng câu khác nhưng vẫn giữ evidence và action boundary có thể tương thích. Model tạo câu văn mượt hơn nhưng âm thầm bỏ qua approval gate thì không.

Contract nên nằm trong version control, cạnh prompt, tool schema và model reference. Nó có thể được biểu diễn như data thay vì ẩn trong test harness:

```yaml
contract: support-agent-v3
owner: customer-operations
invariants:
  - id: evidence-required
    rule: every_policy_claim_has_source_id
    severity: block
  - id: approval-before-write
    rule: refund_write_requires_fresh_user_approval
    severity: block
  - id: tool-schema
    rule: arguments_validate_against_refund_v2
    severity: block
tolerances:
  answer_quality:
    minimum: 0.86
  p95_latency_ms:
    maximum: 4500
  cost_per_success_usd:
    maximum: 0.045
review:
  sample_rate: 0.02
  owner: ai-platform
```

Các con số trên chỉ là ví dụ, không phải ngưỡng dùng chung cho mọi hệ thống. Chatbot hỗ trợ khách hàng, code agent và workflow lâm sàng không thể chia sẻ cùng một tolerance. Quyết định quan trọng là threshold phải rõ ràng, có owner và có thể review.

![Ma trận behavioral contract so sánh model baseline màu xanh với model candidate màu hổ phách](/blog/model-upgrade/contract-matrix.webp)

## So sánh hành vi, đừng chỉ diff raw text

Cách thử đầu tiên phổ biến nhất là gửi cùng prompt cho hai version rồi diff string. Cách này hữu ích khi debug, nhưng là compatibility test kém. Ngôn ngữ tự nhiên có nhiều cách thể hiện hợp lệ; câu trả lời dài hơn cũng không mặc nhiên tốt hơn.

Một pipeline so sánh tốt hơn sẽ chuẩn hóa mỗi lần chạy thành các observable event. Với một agent task, record so sánh có thể trông như sau:

```json
{
  "task_id": "refund-042",
  "model": "candidate-2026-02",
  "intent": "refund_request",
  "retrieval": {
    "source_ids": ["policy-v2"],
    "evidence_coverage": 0.94
  },
  "actions": [
    {
      "tool": "refund_preview",
      "arguments_valid": true,
      "side_effect": "none"
    }
  ],
  "outcome": "needs_approval",
  "safety": {
    "approval_required": true,
    "approval_shown": true
  },
  "latency_ms": 2140,
  "estimated_cost_usd": 0.018
}
```

Sau đó diff được thực hiện ở nhiều tầng.

**Semantic diff** hỏi liệu answer có đi tới cùng một kết luận được evidence hỗ trợ không, và các claim quan trọng có còn grounded không. Nó phải phát hiện caveat bị mất hoặc claim mới không có nguồn, chứ không phạt một câu hợp lệ chỉ vì viết khác.

**Action diff** so sánh tool được chọn, giá trị arguments, thứ tự gọi, retry và side effect. Đây thường là phần quan trọng hơn prose. Nếu baseline preview refund còn candidate execute refund, đó là thay đổi phải block dù phần giải thích của cả hai đều nghe hợp lý.

**Policy diff** kiểm tra approval, refusal, escalation và data boundary. Candidate có thể hữu ích hơn trong các trường hợp thông thường nhưng lại bớt thận trọng ở chính những trường hợp rủi ro cao.

**Operational diff** so sánh latency, token use, cache behavior, provider error và cost. Candidate đạt quality nhưng làm p99 latency tăng gấp đôi vẫn có thể vi phạm product contract.

Một scorecard thực tế nên giữ từng chiều riêng thay vì gộp quá sớm:

| Signal | Baseline | Candidate | Quyết định |
| --- | ---: | ---: | --- |
| Câu trả lời có evidence hỗ trợ | 0.91 | 0.93 | Pass |
| Unsafe direct write | 0.00 | 0.01 | Block |
| Tool arguments hợp lệ | 0.998 | 0.997 | Pass |
| Hiển thị approval khi bắt buộc | 1.00 | 0.99 | Review/block theo policy |
| P95 latency | 3.4 s | 3.8 s | Pass |
| Cost trên task thành công | $0.031 | $0.036 | Pass |

Scorecard làm lộ một failure quan trọng. Weighted average có thể che một unsafe write phía sau hàng nghìn conversational turn thành công. Quyết định release nên dùng **hard gate cho safety và correctness**, sau đó dùng soft threshold cho quality và operations.

## Shadow traffic: quan sát candidate nhưng không trao quyền

Offline test là cần thiết nhưng hẹp. Chúng thường chứa các case được chọn kỹ, không phản ánh hết phân phối request thật: context thiếu, identifier lạ, user lặp lại, history dài và tool failure xuất hiện đúng lúc tệ nhất.

Shadow traffic tạo ra cây cầu giữa hai thế giới. Production system gửi một bản copy của request đủ điều kiện cho candidate, nhưng chỉ baseline được phép tạo response nhìn thấy bởi user hoặc thực hiện side effect. Candidate chạy trong path bị sandbox, với tool được thay bằng simulator read-only, response đã ghi lại hoặc adapter no-op.

![Luồng request được tách giữa model production màu xanh và model shadow màu hổ phách trước cổng canary có kiểm soát](/blog/model-upgrade/shadow-canary.webp)

Shadow nghe đơn giản cho đến khi privacy và determinism xuất hiện. Candidate có thể nhìn thấy dữ liệu cá nhân, secret trong tool result hoặc nội dung mà đội ngũ không được phép lưu. Vì vậy comparison pipeline cần định nghĩa data policy trước khi thu shadow trace:

1. Redact hoặc tokenize field không cần cho hành vi đang test.
2. Giữ raw payload trong retention window ngắn, còn aggregate result có thể lưu lâu hơn.
3. Tắt real write, outbound message, purchase, thay đổi tài khoản và mọi effect khác.
4. Lưu contract version, prompt version, tool definition, model identifier và runtime configuration cùng mỗi comparison.
5. Sample theo workflow và risk class, không chỉ sample theo volume.

Chỉ random traffic có thể bỏ sót case quan trọng nhất. Hai phần trăm request thông thường có thể tạo ra báo cáo rất đẹp trong khi không thu được ví dụ nào về high-impact action hiếm gặp. Hãy dùng stratified policy: một sample liên tục nhỏ để đo volume, replay có mục tiêu cho workflow rủi ro cao và holdout set gồm case adversarial hoặc từng gây lỗi.

## Canary promotion là bài toán tích lũy bằng chứng

Sau khi offline và shadow pass, canary không nên được hiểu như một công tắc nhị phân. Nó là chuỗi quan sát ngày càng tốn kém hơn.

Bắt đầu với một cohort nhỏ hoặc một workflow có đường recovery rõ ràng. Giữ baseline để so sánh, đồng thời định nghĩa promotion rule và abort rule trước khi traffic di chuyển. Một canary controller có thể đánh giá các window như sau:

```text
candidate nhận 1% eligible request
quan sát 15 phút hoặc 500 task hoàn tất
nếu bất kỳ safety invariant blocking nào fail: abort ngay
nếu quality delta < -0.03 hoặc p95 latency vượt budget trong hai window: pause
nếu success, safety, cost đều trong contract ở ba window: promote lên 10%
lặp lại với cohort lớn hơn
```

Phần trăm và window thực tế phụ thuộc traffic volume. Sản phẩm ít traffic có thể cần window theo thời gian; hệ thống nhiều traffic có thể dùng số task hoàn tất. Điều quan trọng là controller phải phân biệt được **chưa đủ evidence** với **evidence cho thấy failure**.

So sánh cũng cần công bằng. Route các workflow tương tự cho cả hai version, tránh thay prompt và model cùng lúc, đồng thời ghi nhận external dependency có thể giải thích sự dịch chuyển. Nếu retrieval index, tool schema, policy file và model cùng thay đổi trong một release, hệ thống có thể phát hiện regression nhưng không biết nguyên nhân nằm ở đâu.

## Rollback là một product capability, không phải nghi thức khi pager reo

Một rollback plan chỉ nói “restore environment variable cũ” là chưa đủ. Trong sự cố, model cũ có thể không còn khả dụng, provider của nó có thể đang degraded, credential đã hết hạn hoặc version mới đã sửa shared prompt và tool contract.

Rollback đáng tin cậy cần giữ nhiều thành phần immutable và có thể address độc lập:

| Thành phần | Vì sao phải nằm trong release pointer |
| --- | --- |
| Model identifier và provider | Chỉ tên model có thể chưa xác định đúng behavior hoặc endpoint thực tế. |
| System prompt và policy bundle | Model luôn được đánh giá trong context mà nó nhận ở production. |
| Tool schema và adapter | Behavior cũ có thể phụ thuộc argument contract cũ. |
| Retrieval configuration | Chunking, reranking và filter có thể làm dịch chuyển output distribution. |
| Feature flag và cohort rule | Rollback phải dừng exposure của candidate, không chỉ đổi model string. |
| Contract và eval version | Đội ngũ phải biết “known good” được định nghĩa thế nào ở thời điểm đó. |

Hãy test rollback trước khi promote. Sau deployment, route một synthetic workflow nhỏ qua baseline và xác minh path cũ vẫn có credential hoạt động, tool tương thích và capacity khỏe. Rollback chưa từng được diễn tập chỉ là hy vọng, chưa phải control.

## Phát hiện drift sau khi release đã xanh

Candidate có thể pass mọi pre-release check rồi vẫn xuống chất lượng sau đó. User behavior thay đổi. Provider điều chỉnh serving behavior. Surface mới gửi context dài hơn. Tool failure trở nên thường xuyên. Phân phối task đi ra ngoài sample shadow.

Vì vậy post-release monitoring phải so candidate với baseline behavior kỳ vọng, không chỉ nhìn infrastructure health. Ít nhất nên theo dõi bốn nhóm signal:

| Nhóm signal | Ví dụ | Phản ứng thường gặp |
| --- | --- | --- |
| Outcome | Task completion, escalation, correction, abandonment | Điều tra workflow hoặc prompt change |
| Evidence | Citation coverage, retrieval disagreement, unsupported claim | Bổ sung case hoặc siết evidence gate |
| Action | Tool choice, argument repair, retry, approval rate | Pause hoặc rollback khi risk tăng |
| Operations | Latency, token, provider error, cost | Điều chỉnh budget, capacity hoặc routing |

Công trình evaluation probes của NIST cũng đi theo hướng này: automated verifier có thể được tích hợp trực tiếp vào agent workflow, và kết quả được tích lũy thành machine-readable audit trail nối decision với evidence hỗ trợ. Ý tưởng quan trọng không nằm ở một judge model cụ thể. Nó nằm ở feedback loop: release system tiếp tục kiểm tra contract sau khi buổi deploy kết thúc.

![Vòng lặp phát hiện drift và rollback sau release, nối quality signal, human review với baseline model ổn định](/blog/model-upgrade/drift-rollback.webp)

Khi drift xuất hiện, đừng tự động đổ lỗi cho model. Retrieval coverage, user mix, tool availability hoặc policy configuration thay đổi cũng có thể tạo cùng một triệu chứng. Hãy giữ comparison record để incident review trả lời được: **observable behavior nào đã dịch chuyển, nó dịch chuyển từ khi nào, và dependency nào thay đổi cùng lúc?**

## Những failure mode trông rất có trách nhiệm trên dashboard

**Bẫy average score** xảy ra khi candidate cải thiện điểm trung bình nhưng regression ở một nhóm high-risk nhỏ. Cách sửa là đặt gate theo workflow và risk class.

**Bẫy string diff** xem mọi thay đổi câu chữ là regression. Hãy chuẩn hóa claim, action, evidence và policy outcome trước khi so prose.

**Bẫy shadow có side effect** trao credential thật cho candidate vì test harness tiện hơn. Hãy thay write tool bằng simulator và làm cho effect trái phép trở nên bất khả thi về mặt cấu trúc.

**Bẫy baseline chuyển động** so candidate với baseline đang thay đổi trong lúc test. Hai phía phải được pin vào prompt, tool, retrieval setting và provider configuration bất biến.

**Bẫy canary không có abort** đưa một phần nhỏ user thật vào candidate nhưng không có điều kiện dừng tự động. Canary không có abort rule thực chất chỉ là rollout chậm.

**Bẫy rollback chỉ nằm trong config** cho rằng chỉ cần nhớ model cũ. Thực tế prompt, tool schema, retrieval policy và capacity plan cũ cũng có thể là một phần của known-good behavior.

## Checklist release thực tế

Trước khi approve một lần nâng cấp model, mình muốn đội ngũ trả lời bằng văn bản các câu hỏi sau:

- Invariant là những hành vi nào, và thay đổi nào nằm trong tolerance?
- Workflow rủi ro cao nào đã có case riêng và negative path?
- Candidate có chạy được mà không tạo side effect thật dưới shadow traffic không?
- Model, prompt, tool, retrieval, policy và contract version đã được pin cùng nhau chưa?
- Comparison có phân biệt semantic, action, safety và operational difference không?
- Threshold release đã tách blocking gate với review threshold chưa?
- Controller có thể pause hoặc abort canary mà không chờ con người phát hiện không?
- Rollback đã được chạy thử với đúng release bundle chưa?
- Signal sau release nào phát hiện drift trước khi user escalation trở thành cảnh báo đầu tiên?

Một team nhỏ không cần ngay lập tức xây một platform khổng lồ. Contract file có version, test set replay được, shadow runner không side effect, structured diff record và traffic pointer có thể đảo chiều đã đủ để tạo control loop đầu tiên. Sau đó hệ thống mới lớn dần.

## Góc nhìn kết

Nâng cấp model là điều không thể tránh. Sai lầm không nằm ở việc thay model; sai lầm là thay nó mà không làm rõ hành vi mình cam kết.

Đội ngũ an toàn không hỏi model mới “thông minh hơn” một cách trừu tượng. Họ hỏi nó có còn tương thích với công việc mà sản phẩm được tin cậy để làm không. Họ định nghĩa action boundary, evidence requirement, quality tolerance và operational budget. Họ so candidate theo những chiều đó, đưa nó vào từ từ và giữ một đường đã được test để quay lại release known-good.

Cách tiếp cận này biến model change từ một cú nhảy niềm tin thành một hoạt động engineering bình thường. Model có thể tốt lên. Hệ thống có thể học. Và khi hành vi đi sai hướng, đội ngũ đủ evidence để nhìn thấy — cùng đủ quyền kiểm soát để dừng nó lại.

## References

[1]: https://www.langchain.com/state-of-agent-engineering "State of Agent Engineering — LangChain, 12 June 2026"
[2]: https://www.nist.gov/programs-projects/building-evaluation-probes-agentic-ai "Building Evaluation Probes into Agentic AI — NIST"
[3]: https://www.ibm.com/think/news/ai-tech-trends-predictions-2026 "The trends that will shape AI and tech in 2026 — IBM Think"
[4]: https://mlflow.org/articles/building-production-ready-ai-agents-in-2026 "Building Production-Ready AI Agents in 2026 — MLflow"
[5]: https://github.com/open-telemetry/semantic-conventions-genai "Generative AI Semantic Conventions — OpenTelemetry"
