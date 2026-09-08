---
title: "Human-in-the-Loop không phải nút “Approve”: Thiết kế Action Gate và chống Consent Fatigue"
description: "Cách thiết kế human oversight cho AI Agent bằng action envelope, risk tier, approval còn hiệu lực, preview rõ ràng, escalation và auditability."
pubDate: 2026-06-18
category: "architecture"
lang: "vi"
translationKey: "human-in-loop-action-gate-consent-fatigue"
draft: false
image: "/blog/human-action-gate/hero.webp"
---

“Human-in-the-loop” thường được triển khai thành một nút **Approve**. Agent đề xuất một việc, con người click một lần rồi hệ thống chạy tiếp. Trên diagram, thiết kế này trông có trách nhiệm. Trong production, nó rất dễ trở thành một nghi thức mà người ta thực hiện mà không đọc.

Vấn đề không phải con người bất cẩn. Vấn đề là approval request chung chung đòi hỏi quá nhiều trust nhưng cung cấp quá ít context. Nếu cùng một người nhìn thấy năm mươi prompt đều có chữ “approve agent action”, hành vi an toàn nhất có thể biến thành click cho xong.

![Một reviewer đứng trước action gate rõ ràng, nhìn thấy target, effect, risk và expiry trước khi action được execute](/blog/human-action-gate/hero.webp)

<figure class="blog-video">
  <video controls preload="metadata" playsinline poster="/blog/human-action-gate/hero.webp" aria-label="Video giải thích nội dung bài viết, phiên bản tiếng Việt">
    <source src="/blog/human-in-loop-action-gate-consent-fatigue/video-vi.mp4" type="video/mp4" />
    Trình duyệt của bạn không hỗ trợ video HTML5.
  </video>
  <figcaption>Video giải thích chuyên sâu: phiên bản tiếng Việt.</figcaption>
</figure>

Một human gate hữu ích không chỉ là một khoảng dừng trong workflow. Nó là một decision boundary. Reviewer phải hiểu **điều gì sẽ xảy ra, xảy ra với target nào, bằng authority nào và approval còn hiệu lực bao lâu**.

## Vì sao nút approve chung chung thất bại

Approval chung chung che giấu object của consent. Nó có thể không hiển thị arguments cụ thể, nguồn của data, external side effect hoặc khác biệt giữa draft và action không thể undo.

Nó còn tạo ra cảm giác an toàn giả. Có một human click không chứng minh human đã hiểu action. Nếu agent đổi amount, destination, tenant hoặc tool sau khi click, approval có thể không còn liên quan đến thứ thực sự được execute.

Thiết kế tốt hơn bắt đầu bằng một bounded action envelope:

```json
{
  "effect": "send_email",
  "recipient": "finance@example.com",
  "subject": "Refund summary for order 4821",
  "attachments": ["refund-summary.pdf"],
  "data_classification": "internal",
  "risk": "medium",
  "requested_by": "support-agent",
  "expires_at": "2026-08-14T10:15:00Z"
}
```

Approval phải bind vào chính envelope này. Nếu recipient hoặc attachment thay đổi, action phải quay lại policy evaluation.

## Risk nên quyết định mức friction

Không phải action nào cũng cần trải nghiệm approval giống nhau. Bắt human approve mọi read-only lookup sẽ tạo noise. Không yêu cầu approval trước một transfer có impact cao lại là thiết kế liều lĩnh.

Risk tier giúp rule trở nên rõ ràng:

| Tier | Effect ví dụ | Control mặc định |
|---|---|---|
| Low | Đọc public document, tính toán draft | Automatic theo policy |
| Medium | Tạo draft, cập nhật record không critical | Policy check, review tùy chọn |
| High | Gửi message ra ngoài, đổi permission | Contextual approval rõ ràng |
| Critical | Chuyển tiền, xóa data, vượt tenant boundary | Approval mạnh, identity mới, có thể cần hai người |

Tier nên mô tả effect, không phải confidence của model. Model tự tin vẫn có thể sai. Một read có confidence thấp có thể vô hại, trong khi một delete có confidence cao vẫn là high impact.

![Một risk ladder đưa action ít impact đi tự động, action trung bình tới policy review và action impact cao tới human approval có context](/blog/human-action-gate/risk-ladder.webp)

Risk cũng nên tính target, data classification, khả năng reverse, blast radius và action có mới với user hoặc tenant không. Cùng một tool có thể low risk ở context này nhưng critical ở context khác.

## Hiển thị decision, không cần hiển thị cả transcript

Reviewer không cần đọc toàn bộ agent trace. Nhưng họ cần một decision view ngắn gọn trả lời được những câu hỏi quan trọng.

Preview nên hiển thị effect dự kiến, target chính xác, normalized arguments, identity được dùng, data sẽ rời hệ thống, policy reason, expiry và điều gì xảy ra nếu action fail. Nếu là một change, hãy hiển thị diff. Nếu là message, hiển thị body cuối và danh sách recipient. Nếu là delete, hiển thị record bị ảnh hưởng và recovery path.

Đây không chỉ là bài toán UI. Agent phải tạo structured proposal để gate render nhất quán. Một đoạn giải thích bằng prose được tạo sau đó chưa đủ vì prose có thể bỏ sót argument nguy hiểm.

Nguyên tắc này cũng áp dụng cho MCP capability. [Tool description](/blog/mcp-tool-poisoning-description-payload) có thể giúp model lập kế hoạch, nhưng human phải approve một action envelope cụ thể, không phải một lời hứa mơ hồ rằng tool an toàn.

## Approval freshness rất quan trọng

Approval là một statement về context. Nếu context thay đổi, statement đó có thể không còn hợp lệ.

Hãy tạo approval digest từ action envelope, actor, tenant, policy version và evidence liên quan. Lưu digest cùng approval. Khi execute, hệ thống tính lại digest. Nếu digest khác, cần decision mới.

```text
approval_digest = hash(
  action,
  normalized_arguments,
  target,
  actor,
  tenant,
  policy_version,
  evidence_version
)
```

Hãy thêm expiry. Một người có thể approve refund $42 khi order đang ở trạng thái này, nhưng retry bị trễ có thể chạy sau khi order đã thay đổi. Approval ngắn hạn an toàn hơn việc xem một click là permission vĩnh viễn.

Freshness không nên chỉ là một timeout tùy ý. Action impact cao có thể cần revalidation ngay cả khi approval ban đầu chưa hết hạn, nếu target state đã đổi.

## Batch approval giảm fatigue mà không che giấu risk

Consent fatigue không có nghĩa phải xóa mọi approval. Nó có nghĩa hệ thống nên group các decision low-risk tương tự, đồng thời giữ high-risk action hiển thị rõ.

Batch approval phù hợp khi scope chính xác: “gửi mười hai notification đã được approve tới recipient của campaign này, dùng template này, trước 17:00.” Nó không phù hợp với câu “approve tất cả action agent muốn làm trong chiều nay”.

Batch envelope nên có maximum count, action type được phép, target set, data class, time window và stop condition. Reviewer phải inspect sample và reject batch mà không làm mất audit trail.

## Escalation phải là một path được thiết kế

Khi reviewer đầu tiên không thể quyết định, agent không nên chỉ hỏi lại với giọng khẩn cấp hơn. Nó nên escalate cùng missing context, policy reason và authority tiếp theo cần có.

Một escalation path tốt có thể gồm:

- hỏi lại user khi request mơ hồ;
- chuyển tới operator có đúng tenant hoặc data scope;
- dual approval cho effect critical;
- break-glass có thời hạn cho tình huống khẩn cấp;
- partial completion an toàn khi action không thể approve.

Reviewer không nên bị gây áp lực bằng countdown giả che giấu consequence của việc chờ. Timeout phải tạo ra state an toàn như `not_executed` hoặc `expired`, không phải implicit approval.

## Break-glass không phải đường tắt để bỏ accountability

Emergency access đôi khi cần thiết. Nó cũng phải visible hơn normal access, không phải ít visible hơn.

Break-glass action nên cần reason, actor rõ ràng, scope hẹp, expiry ngắn và telemetry mạnh hơn. Nếu không kịp có người thứ hai approve, hệ thống có thể ghi nhận điều đó và yêu cầu retrospective review. Emergency path không được âm thầm disable policy hoặc xóa evidence về việc nó đã được dùng.

Điều này đặc biệt quan trọng khi agent có thể truy cập customer data hoặc external system. Emergency path phải nói rõ nó được làm gì, không được làm gì và tổ chức sẽ phát hiện misuse ra sao.

## Đo chất lượng của gate

Approval workflow cần metric riêng. Approval rate cao không nhất thiết có nghĩa hệ thống được trust. Có thể đó chỉ là dấu hiệu người dùng click cho qua.

Hãy track tỷ lệ approval execute thành công, tỷ lệ approval bị đổi hoặc hết hạn, thời gian reviewer dành cho mỗi decision, số action bị reject, số action escalate và tỷ lệ reversal sau approval. Hãy sample decision view để kiểm tra reviewer có dự đoán đúng điều sắp xảy ra hay không.

Một signal có giá trị là sự khác nhau giữa approved envelope và executed effect. Với gate tốt, con số này phải bằng zero. Một signal khác là nhiều approval lặp lại cho cùng low-risk action; nó có thể chỉ ra cơ hội đưa decision vào policy automation thay vì tạo thêm prompt.

Nối các metric này với [scorecard SLO của AI Agent](/blog/ai-agent-slo-success-latency-cost-safety). Gate có thể làm unsafe action giảm nhưng latency tăng, hoặc friction giảm nhưng risky automation tăng. Cả hai đều thuộc reliability conversation.

## Một bảng action gate thực tế

| Action | Context hiển thị | Approval rule | Expiry |
|---|---|---|---|
| Đọc public document | Source và query | Automatic | Không áp dụng |
| Draft reply cho customer | Recipient, draft, data class | Policy hoặc review tùy chọn | 30 phút |
| Gửi message ra ngoài | Body cuối, recipient, attachment | Explicit approval | 10 phút |
| Đổi account permission | Subject, permission cũ/mới, reason | Strong approval | 5 phút |
| Xóa hoặc transfer | Object chính xác, effect, recovery path | Dual approval hoặc break-glass | Ngay lập tức |

Các giá trị chỉ là ví dụ. Nguyên tắc là friction phải tương xứng potential effect, trong khi reviewer luôn nhìn thấy một consent object có boundary rõ và ổn định.

## Human oversight phải giúp hệ thống tốt hơn

Human gate cũng là một feedback loop. Rejected action cần được phân loại. Request có mơ hồ không? Risk classification có sai không? Preview có bỏ sót fact quan trọng không? Policy có block nhầm thứ nên automatic không?

Hãy đưa những phát hiện này vào policy change, training fixture và evaluation case. Đừng biến mọi rejection thành một prompt tweak. Nhiều vấn đề thuộc authorization, state validation hoặc product design.

Human-in-the-loop tốt khiến công việc của human nhỏ hơn nhưng meaningful hơn theo thời gian. Decision lặp lại và low-risk trở thành policy-controlled automation. Decision high-risk vẫn visible, cụ thể và accountable.

Không nên hỏi human approve một agent. Hãy hỏi human approve một action cụ thể, có thời hạn và đủ context để hiểu consequence. Chính sự khác biệt đó biến một nút trang trí thành một control boundary thật, đồng thời ngăn responsible oversight suy thoái thành consent fatigue.
