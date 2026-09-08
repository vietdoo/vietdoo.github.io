---
title: "Semantic Diff cho AI Agent: Review Intent, không chỉ JSON"
description: "Thiết kế production để biến tool call của AI agent thành semantic diff dễ review: entity bị ảnh hưởng, before/after, invariant, mức rủi ro và write boundary an toàn."
pubDate: 2026-09-01
category: "engineering"
image: "/blog/semantic-diff-agents/hero.webp"
lang: "vi"
translationKey: "semantic-diff-agents"
draft: false
---
![AI agent và người review đối chiếu một semantic change giữa hai trạng thái của hệ thống](/blog/semantic-diff-agents/hero.webp)

Màn hình approval hiển thị JSON hoàn toàn hợp lệ. Mọi field bắt buộc đều có mặt, schema validator trả về màu xanh và phần giải thích của agent nghe rất hợp lý. Người review bấm **Approve**.

Customer record đã thay đổi, nhưng không theo cách người review nghĩ. Tool call cập nhật billing profile, chép địa chỉ mới vào order và đồng thời xóa delivery preference cũ như một side effect. Không điều gì trong raw payload làm mối quan hệ đó lộ rõ. Payload đúng cú pháp; quá trình review lại mù về ngữ nghĩa.

Đây là khoảng trống giữa một tool call và một action an toàn. JSON cho chúng ta biết **agent yêu cầu tool nhận gì**. Nó không nhất thiết cho biết sau khi tool chạy, hệ thống sẽ mang ý nghĩa gì. Với một agent có thể sửa record, gửi message, đổi permission hoặc kích hoạt payment, “arguments hợp lệ” là một tiêu chuẩn quá thấp.

> **Luận điểm chính:** AI agent nên đề xuất một semantic change set, không chỉ một tool call. Runtime cần hiển thị entity bị ảnh hưởng, giá trị before/after, side effect đã biết, invariant được giữ hoặc bị vi phạm và mức approval trước khi vượt qua write boundary.

Đây không phải một prompt technique khác. Đây là application-layer contract bao quanh output của model. Model có thể gợi ý thay đổi, nhưng code deterministic phải normalize, compare, classify và authorize thay đổi đó. Người review cần trả lời được câu hỏi cụ thể: **“Tôi có approve ý nghĩa của thay đổi này không?”**, thay vì phải đoán ý nghĩa từ một object lồng nhau.

## Vì sao raw JSON là bề mặt review tệ

Tool call được tối ưu cho machine. Nó thường chứa ID, enum, default, reference khó đọc và những field chỉ có ý nghĩa với service nhận request. Reviewer thì suy nghĩ theo entity và consequence: “Chuyển order này từ pending sang shipped”, “cấp quyền read-only cho contractor” hoặc “đổi due date của invoice nhưng không đổi amount”.

Vấn đề lớn hơn khi một call chạm vào nhiều aggregate. Một operation `update_customer` có thể đồng thời invalidate fraud check, trigger email, tính lại subscription hoặc tạo audit event. Nếu UI chỉ render arguments, reviewer phải biết chi tiết triển khai của mọi downstream service. Đó không phải safety mechanism có thể mở rộng.

Semantic diff là một translation layer. Nó giữ lại machine request, nhưng bổ sung mô tả canonical về state transition sắp xảy ra. Diff cần trả lời năm câu hỏi:

| Câu hỏi khi review | Field trong semantic diff |
|---|---|
| Target là gì? | Entity type, stable identifier và version hiện tại |
| Điều gì sẽ đổi? | Giá trị before, giá trị đề xuất và operation type |
| Còn ai hoặc gì có thể bị ảnh hưởng? | Related entity, event phát ra và side-effect estimate |
| Điều gì bắt buộc phải còn đúng? | Invariant và policy check |
| Ai hoặc hệ thống nào được approve? | Risk class, authority cần có và thời điểm hết hạn |

![Raw tool-call card được chuyển thành semantic change map ở cấp entity, field, relationship và state transition](/blog/semantic-diff-agents/semantic-diff-map.webp)

## Bắt đầu bằng canonical change set

Model không nên chịu trách nhiệm tạo ra representation cuối cùng dùng để review. Model có thể đề xuất intent bằng structured output, nhưng adapter cần resolve reference và fetch current state. Sau đó adapter phát ra một `ChangeSet` canonical để các lớp phía sau validate và render nhất quán.

```ts
type ChangeSet = {
  id: string;
  actor: { userId: string; agentId: string; tenantId: string };
  operation: "create" | "update" | "delete" | "transition";
  targets: Array<{
    entity: string;
    id: string;
    version: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    changedPaths: string[];
  }>;
  relations: Array<{
    entity: string;
    id: string;
    relationship: string;
    impact: "read" | "write" | "event" | "unknown";
  }>;
  invariants: Array<{
    name: string;
    status: "preserved" | "violated" | "unknown";
    evidence?: string;
  }>;
  risk: "low" | "medium" | "high" | "critical";
  authorization: { required: string; expiresAt: string };
};
```

Chi tiết quan trọng nhất là `before`. Một proposal không có before-state đáng tin không phải diff; nó chỉ là một assertion. Runtime nên đọc target tại một version xác định, lưu version đó trong change set và từ chối commit nếu write boundary nhìn thấy version khác, trừ khi operation được thiết kế để merge an toàn.

`changedPaths` cũng cần được thiết kế cẩn thận. Path như `customer.preferences.deliveryAddress` hữu ích cho machine, nhưng reviewer cần thêm domain label: “địa chỉ giao hàng dùng cho các shipment tương lai”. Hãy giữ cả hai. Path cho precision; semantic label cho comprehension.

## Diff là mô hình impact, không phải lời tiên tri

Rất dễ yêu cầu model liệt kê mọi side effect có thể có. Kết quả thường là một đoạn giải thích dài, nhiều suy đoán, nhìn có vẻ đầy đủ nhưng không thể kiểm chứng. Thay vào đó, hãy tách **declared impact** khỏi **observed impact**.

Declared impact đến từ contract: update order status sẽ phát event, đổi role sẽ invalidate session, còn xóa workspace sẽ thu hồi quyền truy cập file. Observed impact đến từ adapter hoặc dry-run endpoint. Unknown impact phải tiếp tục hiển thị là unknown. Không được âm thầm biến nó thành “không có impact”.

Một impact record hữu ích nên nhỏ và rõ ràng:

```json
{
  "target": "order:8472",
  "change": "status: processing -> shipped",
  "related": [
    {"entity": "shipment:5521", "impact": "write", "confidence": "declared"},
    {"entity": "customer:91", "impact": "event", "confidence": "observed"}
  ],
  "unknowns": ["carrier pickup timestamp"],
  "invariants": [
    {"name": "payment_captured", "status": "preserved"},
    {"name": "shipment_has_tracking_number", "status": "violated"}
  ]
}
```

Sự hiện diện của unknown không phải lỗi UI. Đó là ranh giới trung thực về điều hệ thống có thể chứng minh. Unknown có impact cao nên chuyển cho người hoặc block write. Unknown có impact thấp có thể được chấp nhận kèm audit note. Policy, không phải model confidence, quyết định việc này.

![Impact panel hiển thị target entity, record liên quan, invariant, unknown và vùng blast radius được reviewer đánh dấu](/blog/semantic-diff-agents/impact-panel.webp)

## Tính diff bên ngoài model

Model giỏi chuyển yêu cầu tự nhiên thành candidate operation. Model không phải authority phù hợp để quyết định hai record có bằng nhau không, version đã tăng chưa hoặc role change có vượt tenant boundary không. Những check đó thuộc deterministic code.

Một pipeline thực tế có sáu stage:

| Stage | Trách nhiệm của runtime | Trách nhiệm của model |
|---|---|---|
| Interpret | Trích xuất candidate intent và thông tin còn thiếu | Giải thích request và đề xuất operation |
| Resolve | Map tên sang stable ID và fetch version hiện tại | Hỏi lại khi resolution mơ hồ |
| Normalize | Chuyển proposal thành typed change set | Bổ sung field-level intent khi contract cho phép |
| Compare | Tính before/after change và impact | Giải thích vì sao change đáp ứng mục tiêu |
| Authorize | Áp dụng policy, invariant, expiry và actor scope | Không được override rejection |
| Commit | Write với version check và idempotency | Báo kết quả sau khi hệ thống xác nhận |

Boundary này cũng giúp test dễ hơn. Bạn có thể đưa current state cố định và operation đề xuất vào normalizer rồi assert semantic diff luôn giống nhau. Bạn có thể test policy độc lập với prompt wording. Bạn có thể review renderer mà không cấp production credential cho nó.

## Risk phải đi theo ý nghĩa, không đi theo tên tool

Một shortcut phổ biến là coi `update_customer` là low risk và `delete_workspace` là high risk. Tên tool không đủ. Một update thay đổi display label có thể vô hại; cũng endpoint đó có thể đổi legal name hoặc tax identifier. Risk phải nằm trên semantic operation và field của target.

Một policy matrix khả dụng có thể như sau:

| Semantic change | Route mặc định | Gate bổ sung |
|---|---|---|
| Thêm internal note | Tự động, có audit | Không gửi notification ra ngoài |
| Đổi delivery address của customer | Review hoặc tự động tùy tenant policy | Version mới và address validation |
| Đổi permission scope | Human approval | Actor identity và scope diff |
| Xóa data hoặc revoke access | Human approval hoặc block | Deletion evidence và recovery plan |
| Chuyển tiền hoặc tạo cam kết ràng buộc | Mặc định block | Strong authorization và explicit confirmation |

Review surface không nên giấu noise ít rủi ro sau một bức tường thông tin của action rủi ro cao. Hãy hiển thị summary ngắn trước, sau đó cho reviewer mở rộng để xem field, relationship, evidence và policy decision. Mục tiêu không phải là nhiều thông tin nhất, mà là **thông tin phục vụ quyết định**.

![Approval ladder theo rủi ro tách low-risk change tự động, human review và action high-risk bị block](/blog/semantic-diff-agents/approval-ladder.webp)

## Bảo toàn intent mà không giả vờ đọc suy nghĩ

“Review intent” có thể khiến người đọc nghĩ đến việc phơi bày reasoning ẩn. Không phải vậy. Hệ thống không cần private chain-of-thought. Nó cần một statement ngắn, có thể test, về outcome mong muốn và mutation được phép.

Ví dụ agent có thể trả về: “User muốn chuyển order 8472 sang shipped vì carrier đã xác nhận pickup.” Application sau đó có thể verify status transition có hợp lệ không, tracking number đã tồn tại chưa và actor có authority không. Explanation là evidence cho reviewer, không phải proof rằng model đã reasoning đúng.

Hãy lưu decision fact, không lưu inner narration đầy suy đoán:

```ts
type ReviewSummary = {
  requestedOutcome: string;
  proposedMutation: string;
  evidenceIds: string[];
  rejectedAlternatives?: string[];
  uncertainty: string[];
};
```

`requestedOutcome` phải bắt nguồn từ user request hoặc workflow objective. `proposedMutation` nên được sinh từ canonical change set, không copy mù quáng từ model. Cách này ngăn mismatch khi prose nói “update delivery address” nhưng payload lại sửa billing address.

## Write boundary phải kiểm tra lại mọi thứ

Semantic diff hữu ích trước approval, nhưng không phải authorization vĩnh viễn. Thế giới có thể đổi trong lúc con người review. Worker khác có thể update record, permission của user có thể bị revoke hoặc policy mới có thể bắt đầu có hiệu lực. Final adapter phải recompute hoặc revalidate diff ngay trước side effect.

![Write boundary được bảo vệ bằng before/after state, invariant check, audit receipt và commit cuối cùng](/blog/semantic-diff-agents/write-boundary.webp)

```ts
async function commit(changeSet: ChangeSet) {
  await assertActorStillAuthorized(changeSet.actor);
  await assertPolicyStillAllows(changeSet);
  const current = await readTargets(changeSet.targets);
  const freshDiff = diff(current, changeSet);

  if (!freshDiff.sameTargetVersions) {
    return { status: "stale", action: "replan" };
  }
  if (freshDiff.invariants.some((x) => x.status === "violated")) {
    return { status: "rejected", action: "escalate" };
  }
  if (freshDiff.risk === "critical") {
    return { status: "blocked", action: "explicit_confirmation" };
  }

  return await writeWithIdempotencyKey(changeSet.id, freshDiff);
}
```

Write adapter cần phân biệt “request được accept”, “side effect đã hoàn thành” và “client quan sát thấy response”. Nếu network fail sau khi server đã commit, change set ở trạng thái unknown và cần reconciliation. Semantic diff không thay thế action ledger, idempotency hay compensation strategy; nó làm mutation sắp diễn ra trở nên dễ hiểu trước khi các cơ chế đó hoạt động.

## Nên log gì và không nên log gì

Change set có thể review cũng là một audit artifact, nhưng giữ mọi prompt và tool payload mãi mãi không phải privacy strategy. Chỉ giữ phần tối thiểu cần để dựng lại decision boundary: change-set ID, actor identity, target version, changed path, invariant result, policy version, approval event, evidence reference và commit outcome. Redact before/after value nhạy cảm khi field-level hash hoặc classification đã đủ.

Renderer phải cho reviewer biết vì sao change được cho phép mà không phơi secret cho mọi support operator. Tách quyền xem raw value khỏi quyền xem semantic summary. Bản thân diff cũng là dữ liệu nhạy cảm vì nó có thể tiết lộ customer state ngay cả khi prompt gốc đã bị xóa.

## Rollout mà không biến mọi action thành một cuộc họp

Hãy bắt đầu bằng read-only preview. Với một mẫu workflow thật, tạo semantic diff song song với tool call hiện tại rồi so sánh diff với điều reviewer nghĩ tool sẽ làm. Đo missing relationship, false side effect, unknown field và review time. Đừng bắt đầu bằng việc block production write bằng một formatter mới chưa được kiểm chứng.

Sau đó chọn một domain có invariant rõ, chẳng hạn order status hoặc access scope. Bắt buộc diff cho mutation medium- và high-risk, trong khi low-risk update vẫn được chạy tự động kèm audit record. Khi diff bị reject, lưu lý do như một policy signal có cấu trúc thay vì bảo model “thử lại” mà không cung cấp context mới.

Một first release tốt nên có các thuộc tính sau:

| Thuộc tính | Acceptance test |
|---|---|
| Stable | Cùng state và operation tạo ra cùng một diff |
| Grounded | Mọi field thay đổi map được tới target version thật |
| Honest | Unknown impact vẫn hiển thị |
| Actionable | Reviewer có thể approve, edit, reject hoặc yêu cầu replan |
| Enforced | Write adapter recompute diff |
| Auditable | Approval và commit liên kết bằng một immutable ID |

## Kết luận: hãy để approval nói về consequence

AI agent không an toàn hơn chỉ vì JSON hợp lệ hoặc explanation nghe tự tin. Nó an toàn hơn khi application biến một proposal mơ hồ thành một state transition có ranh giới mà system khác hoặc con người đều có thể kiểm tra.

Semantic diff là một interface nhỏ nhưng mạnh giữa probabilistic intent và deterministic authority. Nó gọi đúng target, chỉ ra change, phơi blast radius, nói rõ phần chưa biết và cho policy một object cụ thể để approve. Khi object đó tồn tại, phần còn lại của hệ thống có thể làm đúng vai trò: evaluate invariant, enforce scope, xử lý stale version, lưu evidence và chỉ commit khi ý nghĩa của proposal vẫn khớp với thực tế.

Nút review tốt nhất không phải nút ghi **Approve JSON**. Đó là nút khiến consequence trở nên dễ hiểu.

## References

[1]: https://www.langchain.com/state-of-agent-engineering "LangChain — State of Agent Engineering"
[2]: https://www.oreilly.com/radar/signals-for-2026/ "O’Reilly — Signals for 2026"
[3]: https://arxiv.org/abs/2607.13111 "SemaDiff: Identifying Semantic-Changing Commits with Generated Code and Tests"
