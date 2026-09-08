---
title: "Khi các Agent bất đồng: Arbitration Protocol cho những quyết định AI xung đột"
description: "Playbook production cho việc xử lý các quyết định AI xung đột bằng chuẩn hóa evidence, calibrated confidence, abstention, escalation và arbitration có thể audit."
pubDate: 2026-03-19
category: "engineering"
lang: "vi"
translationKey: "when-agents-disagree-arbitration-protocols"
draft: false
image: "/blog/agent-arbitration/hero.webp"
---

Phiên bản đầu tiên của một multi-agent system thường trông đơn giản đến mức đáng ngờ. Một agent truy xuất evidence. Một agent khác đánh giá risk. Agent thứ ba đề xuất action. Một model cuối đọc toàn bộ output rồi chọn câu trả lời nghe thuyết phục nhất.

Thiết kế đó hoạt động cho đến khi các agent bất đồng.

Fraud detector nói một giao dịch đáng ngờ. Agent hiểu customer context nói giao dịch phù hợp với lịch sử của người dùng. Policy agent nói evidence chưa đủ. Final judge nhận được ba cách giải thích đều có vẻ hợp lý, ba confidence score chưa từng được calibrate với nhau, và một deadline khiến “hỏi người thật” bị xem như thất bại.

Phản ứng nguy hiểm là bắt hệ thống vote mạnh hơn. Majority voting có thể che giấu lỗi tương quan, thưởng cho câu trả lời dài và biến một conflict chưa được giải quyết thành cảm giác chắc chắn giả. Production system cần một thứ có chủ đích hơn: **arbitration protocol** xác định cách phát hiện bất đồng, cách so sánh evidence, khi nào được commit decision và khi nào hệ thống phải abstain hoặc escalate.

![Production AI system đưa các quyết định xung đột qua chuẩn hóa evidence, arbitration, abstention và human escalation](/blog/agent-arbitration/hero.webp)

> **Luận điểm chính:** Arbitration không phải là model call cuối cùng trong multi-agent workflow. Nó là một decision stage bị ràng buộc bởi policy, có input rõ ràng, state được bảo vệ, confidence đã calibrate và outcome an toàn khi consensus không đủ cơ sở.

Bài viết này là một hướng dẫn thiết kế thực tế cho các hệ thống có nhiều AI component cùng đưa ra recommendation khác nhau: claims review, support triage, security operations, document classification, code review, procurement approval và những agent workflow có thể thay đổi state bên ngoài.

## Bất đồng là một tín hiệu, không phải lỗi cần che giấu

Bất đồng cho biết hệ thống vừa gặp uncertainty, evidence cạnh tranh, khác biệt trong cách hiểu task hoặc ranh giới giữa policy và prediction. Nó không cho biết agent nào đúng. Nó cũng không có nghĩa agent tự tin nhất xứng đáng chiến thắng.

Trước khi chọn cách arbitration, hãy phân loại conflict. Mỗi loại xung đột cần một cách xử lý khác nhau.

| Loại conflict | Thực sự đang khác nhau ở đâu? | Phản ứng an toàn đầu tiên |
|---|---|---|
| Evidence conflict | Các agent trích dẫn fact hoặc source không tương thích. | Chuẩn hóa evidence, kiểm tra freshness và authority của source. |
| Scope conflict | Các agent trả lời những cách hiểu khác nhau của task. | Dựng lại intent và thống nhất decision contract. |
| Policy conflict | Recommendation có thể hợp lý về kỹ thuật nhưng vi phạm rule. | Để policy gate override predictive preference. |
| Temporal conflict | Các agent dùng dữ liệu ở những thời điểm khác nhau. | So sánh timestamp và đặt data cutoff. |
| Granularity conflict | Một agent đề xuất action rộng, agent khác đề xuất action hẹp. | Tách action và arbitrate ở đơn vị nhỏ nhất an toàn. |
| Confidence conflict | Các agent cùng chọn outcome nhưng khác nhau về mức chắc chắn. | Calibrate confidence và xem phân bố bất đồng. |
| Correlated error | Các agent có vẻ đồng ý vì cùng mắc một blind spot. | Đa dạng hóa evidence hoặc thêm đường kiểm chứng độc lập. |

![Conflict matrix vẽ tay so sánh evidence conflict, scope conflict, policy boundary và correlated agreement](/blog/agent-arbitration/conflict-matrix.webp)

Sự phân biệt này quan trọng vì arbitration không thể sửa một input contract chưa từng tồn tại. Nếu một agent hiểu “approve the request” là duyệt document còn agent khác hiểu là duyệt payment, weighted average của hai score là vô nghĩa.

## Bắt đầu bằng decision contract

Decision contract mô tả chính xác điều mọi participant được yêu cầu quyết định. Contract phải đủ nhỏ để validate và đủ cụ thể để ngăn scope drift âm thầm.

```text
DecisionContract {
  decision_id: string
  subject_ref: string
  decision_type: string
  allowed_outcomes: [string]
  evidence_cutoff: timestamp
  required_evidence: [EvidenceRequirement]
  hard_constraints: [PolicyRule]
  reversibility: reversible | partially_reversible | irreversible
  risk_class: low | medium | high | critical
  deadline: timestamp
}
```

Contract thuộc về application, không thuộc về một model cụ thể. Model có thể đề xuất outcome và giải thích reasoning, nhưng application sở hữu allowed outcomes, policy constraint, evidence cutoff và action permission.

Một contract hữu ích cũng tách prediction khỏi authorization. Agent có thể dự đoán refund có khả năng hợp lệ. Điều đó không tự authorize refund. Policy gate có thể yêu cầu một evidence field cụ thể, human approval hoặc một monetary threshold thấp hơn trước khi recommendation trở thành executable action.

Tách biệt này đặc biệt quan trọng khi final arbiter cũng là language model. Arbiter không được tự phát minh outcome mới chỉ vì mọi option có sẵn đều không hoàn hảo. Nó phải có quyền trả về `abstain`, `needs_more_evidence` hoặc `escalate` như những outcome chính thức.

## Chuẩn hóa evidence trước khi so sánh agent

Nhiều multi-agent system đang so sánh text trong khi lẽ ra phải so sánh claim. Một lời giải thích dài có thể nghe mạnh hơn một lời giải thích ngắn dù cả hai đều dựa trên một source yếu. Arbitration sẽ đáng tin cậy hơn khi mọi agent trả về structured decision packet.

```text
DecisionPacket {
  agent_id: string
  agent_version: string
  outcome: string
  confidence: number
  confidence_basis: calibrated | heuristic | unknown
  claims: [Claim]
  supporting_evidence: [EvidenceRef]
  missing_evidence: [EvidenceRequirement]
  policy_flags: [PolicyFlag]
  expires_at: timestamp
  dissent: [string]
}

Claim {
  claim_id: string
  statement: string
  polarity: supports | contradicts | unresolved
  evidence_refs: [EvidenceRef]
  confidence: number
}
```

![Evidence ladder tách unsupported claim khỏi evidence mới, độc lập và phù hợp policy](/blog/agent-arbitration/evidence-ladder.webp)

Packet cho arbiter thứ hữu ích hơn câu “Agent B nghĩ yes”. Arbiter có thể hỏi claim nào được chia sẻ, claim nào mâu thuẫn, evidence nào có authority và conflict có thực sự ảnh hưởng đến decision hay không.

Mỗi claim nên trỏ đến evidence reference thay vì copy toàn bộ document vào arbitration prompt. Reference có thể gồm document identifier, source type, timestamp, extraction span và access policy. Cách này giúp decision audit được mà không biến arbitration record thành một data lake thứ hai, mất kiểm soát.

Evidence layer cũng phải giữ provenance. Hai agent cùng trích dẫn một bài viết cũ không phải là hai phiếu độc lập. Hai agent dùng hai retrieval path khác nhau rồi cùng hội tụ vào một current record là tín hiệu mạnh hơn, dù vẫn không phải bằng chứng tuyệt đối.

## Confidence không phải một loại tiền tệ dùng chung

Confidence `0.92` của một classifier và confidence `0.92` của một generative judge không tự động có cùng ý nghĩa. Confidence có thể là raw model score, self-reported feeling, calibrated probability hoặc heuristic ghép từ tool result.

Hãy coi basis là một phần của value.

| Confidence basis | Ý nghĩa | Có thể so sánh trực tiếp không? |
|---|---|---:|
| Calibrated probability | Xác suất đúng trong lịch sử trên một population và threshold được định nghĩa. | Chỉ đôi khi, nếu population và task tương đồng. |
| Validation score | Score của model có tương quan với correctness trên benchmark. | Chỉ sau khi mapping và theo dõi drift. |
| Self-reported confidence | Cách model diễn đạt cảm giác chắc chắn. | Không. Chỉ nên là feature yếu nếu dùng. |
| Evidence coverage | Tỷ lệ required claim đã có support được chấp nhận. | Đây là dimension riêng, không phải confidence. |
| Heuristic | Rule như “hai tool cùng thành công”. | Hữu ích cho policy, không phải probability. |

Bài *Trust or Escalate* tại ICLR trình bày selective evaluation: ước lượng confidence của judge rồi quyết định khi nào trust judgment và khi nào escalate. Bài cũng mô tả cascaded selective evaluation, trong đó judge rẻ xử lý case phù hợp còn evaluator mạnh hơn hoặc human xử lý case không chắc chắn.[1](https://proceedings.iclr.cc/paper_files/paper/2025/hash/08dabd5345b37fffcbe335bd578b15a0-Abstract-Conference.html)

Ý tưởng này chuyển rất tự nhiên vào production arbitration. Không nên gọi judge đắt nhất để xử lý mọi case. Trước hết hãy xác định case có nằm trong vùng mà một decision rẻ và an toàn có thể xử lý hay không, sau đó chỉ dùng evaluator mạnh khi risk hoặc uncertainty thực sự yêu cầu.

Một arbitration score thực tế có thể ghép nhiều tín hiệu mà không giả vờ tất cả đều là probability:

```text
arbitration_score =
    outcome_support
  + evidence_quality
  + evidence_independence
  + calibrated_confidence
  - unresolved_conflict
  - policy_risk
  - stale_data_penalty
```

Công thức này là policy aid, không phải chân lý khoa học. Mỗi component phải được đo trên historical outcome và xem xét khi workload thay đổi. Nếu team không giải thích được component liên hệ thế nào với correctness, component đó không nên âm thầm điều khiển một irreversible action.

## Đừng để majority voting xóa mất correlated error

Một panel ba agent có thể kém tin cậy hơn một verification path được thiết kế cẩn thận. Nếu mọi agent nhận cùng một retrieved passage, dùng cùng system prompt và cùng model family, agreement của họ có thể phản ánh lỗi chung thay vì independent confirmation.

Trước khi đếm vote, hãy đo independence.

| Câu hỏi về independence | Vì sao quan trọng |
|---|---|
| Các agent retrieve từ source khác nhau hay chỉ từ các chunk khác nhau của một source? | Retrieval error dùng chung có thể tạo false agreement tuyệt đối. |
| Agent dùng task formulation khác nhau không? | Prompt giống nhau có thể tái tạo cùng một blind spot. |
| Agent kiểm tra modality hoặc field khác nhau không? | Panel chỉ đọc text có thể bỏ qua mâu thuẫn trong hình ảnh hoặc structured data. |
| Agent chạy ở các thời điểm khác nhau không? | Freshness difference có thể cho thấy state transition thay vì disagreement. |
| Failure của các agent có tương quan theo lịch sử không? | Vote weight phải tính đến dependence quan sát được. |

Một rule hữu ích là **independent evidence trước additional opinions**. Khi hai agent bất đồng, gọi thêm năm agent cùng đọc một context có thể tạo noise. Một targeted lookup, schema validation, deterministic calculation hoặc human confirmation thường giảm uncertainty hiệu quả hơn.

## Arbitration cascade

Một arbitration path đáng tin cậy thường có nhiều level. Mỗi level nên rẻ và nhanh hơn level tiếp theo, nhưng không level nào được bypass hard policy constraint.

![Arbitration cascade nhiều lớp đi từ deterministic check qua evidence review, stronger judge đến human escalation](/blog/agent-arbitration/escalation-cascade.webp)

### Level 0: deterministic checks

Trước hết hãy chạy các check không cần language model: required field, schema compatibility, timestamp, identity scope, duplicate record, policy deny list và arithmetic. Deterministic failure không nên bị “outvote” bởi một lời giải thích có sức thuyết phục.

### Level 1: evidence alignment

Tiếp theo, so sánh claim và evidence reference. Nếu conflict đến từ missing field hoặc stale record, hãy retrieve đúng evidence cần thiết để giải quyết. Hệ thống nên ưu tiên targeted information request thay vì một cuộc debate lan rộng.

### Level 2: calibrated judge

Nếu conflict vẫn còn, dùng một judge nhận decision contract, normalized packet, evidence reference và tập allowed outcome rõ ràng. Judge phải trả về structured result cùng reason code, không chỉ một đoạn văn.

```text
ArbitrationResult {
  outcome: allowed_outcome | abstain | needs_more_evidence | escalate
  confidence: number
  reason_code: evidence_conflict | scope_conflict | policy_conflict |
                stale_state | insufficient_independence | unresolved
  winning_claims: [claim_id]
  rejected_claims: [claim_id]
  next_action: string
  expires_at: timestamp
}
```

### Level 3: stronger judge hoặc adversarial review

Một model mạnh hơn có thể review case khi expected value của confidence improvement lớn hơn cost và latency. Hãy đưa dissenting packet vào context. Đừng giấu ý kiến trái chiều vì chính nó có thể giúp judge phát hiện false consensus.

Adversarial reviewer cũng hữu ích ở đây, nhưng phải có role giới hạn. Hãy yêu cầu nó tìm counterexample, missing evidence hoặc policy violation. Đừng coi một objection được sinh ra là bằng chứng rằng decision gốc chắc chắn sai.

### Level 4: human escalation

Escalate khi decision high-risk, irreversible, materially ambiguous hoặc nằm ngoài calibrated operating region. Escalation package phải ngắn gọn: decision contract, competing outcome, khác biệt evidence, policy flag, confidence basis và câu hỏi chính xác mà human cần trả lời.

Một human queue nhận transcript không cấu trúc không phải arbitration protocol. Đó chỉ là chuyển sự bối rối sang người khác.

## Abstention là một outcome hợp lệ

Survey *Know Your Limits* trên TACL xem abstention là việc language model từ chối trả lời để giảm hallucination và tăng safety. Bài tổ chức nghiên cứu abstention theo query, model và human values, đồng thời nhấn mạnh phương pháp và evaluation phụ thuộc vào context.[2](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00754/131566/Know-Your-Limits-A-Survey-of-Abstention-in-Large)

Trong agent system, abstention không nên là câu “tôi không chắc”. Nó phải là một typed state có reason và next step.

| Abstention state | Ý nghĩa | Product behavior |
|---|---|---|
| `needs_more_evidence` | Có thể resolve decision nếu lấy được một fact cụ thể còn thiếu. | Retrieve hoặc hỏi fact đó. |
| `insufficient_independence` | Panel đồng ý nhưng evidence tương quan quá cao để tin consensus. | Chạy independent check hoặc escalate. |
| `outside_calibration` | Case khác với dữ liệu dùng để calibrate judge. | Dùng evaluator mạnh hơn hoặc human review. |
| `policy_boundary` | Recommendation chạm vào protected rule. | Block action và route tới policy owner. |
| `irreversible_ambiguity` | Outcome chưa rõ và không thể undo an toàn. | Yêu cầu human confirmation rõ ràng. |

Mục tiêu không phải tối đa hóa số quyết định tự động. Mục tiêu là tối đa hóa safe coverage: tỷ lệ case eligible có thể quyết định trong error budget và risk budget chấp nhận được.

## Tách arbitration khỏi execution

Arbitration result không nên trực tiếp gọi side-effecting tool. Nó nên tạo decision record để policy gate và execution layer sử dụng.

```text
agent proposals
      |
      v
normalized decision packets
      |
      v
arbitration result
      |
      +--> abstain / escalate ------------------> human queue
      |
      v
policy gate + authorization check
      |
      +--> blocked ------------------------------ audit record
      |
      v
execution intent
      |
      v
idempotent action boundary
```

Ranh giới này bổ sung cho thiết kế trong [Idempotent AI Actions](/blog/idempotent-ai-actions). Arbitration quyết định action có đủ cơ sở hay không. Idempotency khiến tool call cuối cùng an toàn khi retry. Hai cơ chế xử lý hai failure mode khác nhau và không nên gộp thành một bước “agent reliability”.

Decision record nên gồm policy version của arbitration, hash của input packet, evidence reference, judge version, confidence basis, reason code và expiry. Khi case được mở lại, hệ thống phải biết đang replay cùng decision hay tạo decision mới trên state đã thay đổi.

## Thiết kế cho state change trong lúc arbitration

Conflict có thể được resolve đúng nhưng trở nên stale trước khi execution. Inventory thay đổi, user revoke consent, policy update hoặc downstream record bị sửa trong lúc case nằm ở human queue.

Hãy gắn expiry và revalidation rule vào mọi decision.

```text
if now > decision.expires_at:
    re-evaluate

if state_version != decision.state_version:
    revalidate_required_evidence

if policy_version != decision.policy_version:
    policy_gate_again
```

Arbitration càng chậm, điều này càng quan trọng. Classification rủi ro thấp có thể chịu cửa sổ rộng hơn. Payment, access grant, deletion hoặc safety action có thể cần check lại ngay trước execution.

## Đo protocol, không chỉ đo final answer

Một accuracy number duy nhất che giấu hành vi operational quan trọng. Hãy theo dõi arbitration process như một tập outcome có thể đo.

| Metric | Câu hỏi cần trả lời |
|---|---|
| Conflict rate | Các agent bất đồng trên cùng contract thường xuyên đến đâu? |
| Material conflict rate | Bao nhiêu conflict làm thay đổi action được phép? |
| Automatic decision coverage | Bao nhiêu case eligible được quyết định không cần escalation? |
| Escalation precision | Escalation có thực sự phát hiện uncertainty hoặc risk đáng kể không? |
| Abstention correctness | Khi abstain, hệ thống có lý do chính đáng không? |
| Consensus error rate | Các agent đồng ý nhưng cùng sai bao nhiêu lần? |
| Evidence resolution rate | Targeted evidence resolve conflict bao nhiêu phần trăm? |
| Time to decision | Mỗi arbitration level thêm bao nhiêu thời gian? |
| Cost per resolved conflict | Một conflict được resolve tốn bao nhiêu, gồm cả human review? |
| Policy violation escape rate | Điều kiện bị block lọt tới execution bao nhiêu lần? |

Review metric theo tenant, workflow, risk class, model version và evidence source. Aggregate performance có thể che giấu một subpopulation nguy hiểm. Một judge đáng tin với support summary chưa chắc phù hợp cho access-control decision.

## Rollout plan không bắt đầu bằng autonomy

Hãy bắt đầu với shadow arbitration. Cho nhiều agent tạo packet, chạy protocol và ghi lại hệ thống sẽ quyết định gì mà không thay đổi production state. Reviewer đánh nhãn contract, evidence quality, final outcome và escalation có phù hợp hay không.

Tiếp theo, bật automatic outcome cho low-risk case trong calibrated region hẹp. Giữ lại mọi abstention và escalation reason. Đừng thưởng hệ thống vì giảm escalation trước khi biết escalation hữu ích hay chỉ gây bất tiện.

Sau đó thêm targeted evidence retrieval và deterministic check. Hai lớp này thường resolve conflict rẻ hơn một model call mới. Chỉ khi lower level ổn định mới thêm stronger judge hoặc adversarial review.

Với high-risk action, giữ human gate ngay cả khi judge có accuracy cao. Gate có thể nhẹ hơn theo thời gian, nhưng không nên biến mất chỉ vì hệ thống sinh ra một average score nghe rất thuyết phục.

## Các quy tắc cần mang vào production

Multi-agent system không trở nên đáng tin khi mọi agent đồng ý. Nó trở nên đáng tin khi hệ thống giải thích được vì sao agreement đủ, phát hiện được khi agreement có tương quan và dừng lại khi evidence không đủ justify action.

Model đề xuất. Contract định nghĩa câu hỏi. Evidence normalization khiến các proposal có thể so sánh. Calibration biến confidence thành operational signal. Arbitration chọn giữa allowed outcome. Abstention bảo vệ ranh giới hiểu biết. Policy và authorization quyết định recommendation có thể trở thành action hay không. Execution vẫn là một idempotent boundary độc lập.

Đó là khác biệt giữa một panel agent và một decision system có thể được tin tưởng khi các agent bất đồng.

## Đọc tiếp trong series production AI

Để xử lý side effect an toàn sau arbitration decision, đọc [Idempotent AI Actions: Making Tool Calls Safe to Retry](/blog/idempotent-ai-actions). Để đo quality và safety ở cấp task, đọc tiếp [Designing SLOs for AI Agents](/blog/ai-agent-slo-success-latency-cost-safety). Để ghi lại agent quyết định gì và tại sao, xem [Decision Traces for AI Agents](/blog/decision-traces-ai-agent-event-sourcing).

## References

[1]: https://proceedings.iclr.cc/paper_files/paper/2025/hash/08dabd5345b37fffcbe335bd578b15a0-Abstract-Conference.html "Trust or Escalate: LLM Judges with Provable Guarantees for Human Agreement — ICLR 2025"
[2]: https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00754/131566/Know-Your-Limits-A-Survey-of-Abstention-in-Large "Know Your Limits: A Survey of Abstention in Large Language Models — TACL 2025"
