---
title: "Freshness của Tool Result: Ngăn Agent hành động trên Observation hết hạn"
description: "Playbook production để xem kết quả từ tool như một observation có thời hạn—với freshness budget, version check, revalidation ngay trước action, fail-closed và các metric cho AI agent an toàn."
pubDate: 2026-04-20
category: "engineering"
image: "/blog/tool-result-freshness/hero.webp"
lang: "vi"
translationKey: "tool-result-freshness-agent-observations"
draft: false
---

![AI agent kiểm tra tool observation qua freshness gate trước khi thực hiện action](/blog/tool-result-freshness/hero.webp)

Agent không hiểu sai yêu cầu của khách hàng. Nó hiểu sai **tuổi của câu trả lời**.

Lúc 10:12, một shopping assistant gọi `inventory.lookup` và biết rằng còn năm chiếc camera. Model chọn đúng SKU sau khi đối chiếu kết quả với yêu cầu của khách hàng, rồi chuẩn bị action mua hàng. Workflow dừng vài giây để khách hàng xác nhận địa chỉ giao. Đến 10:17, agent submit order.

Nhưng lúc đó chỉ còn một chiếc. Một phiên checkout khác đã thắng cuộc đua. Tool trả về lỗi, nên hệ thống thử một fallback path dựa trên observation cũ. Khách hàng nhận được thông báo rằng order đã được xác nhận. Sau đó một operator phải xử lý hủy đơn.

Không có model outage nào gây ra incident này. Model chọn đúng tool, đọc một kết quả hợp lý và đi đúng theo plan. Failure xảy ra vì application xem một **snapshot** như thể đó là **lời hứa về trạng thái hiện tại**.

Sự khác biệt này quan trọng ở bất kỳ nơi nào AI agent quan sát một hệ thống rồi mới hành động sau đó. Agent có thể đọc số dư trước khi chuyển tiền, xem lịch trước khi đặt cuộc họp, kiểm tra trạng thái ticket trước khi gửi phản hồi, hoặc lấy giá trước khi tạo order. Trong khoảng thời gian giữa lần đọc và action, một user, worker, policy hoặc provider khác có thể đã thay đổi thế giới.

> **Luận điểm chính:** Tool result là một observation có tuổi, phạm vi, version và mục đích sử dụng. Nó có thể an toàn cho việc giải thích nhưng đã không còn an toàn cho một action không thể đảo ngược. Production agent cần freshness contract và action-time revalidation gate—không phải thêm một instruction bảo model “luôn dùng dữ liệu mới nhất”.

Bài viết này trình bày một pattern ở application level cho agent sử dụng tool. Pattern mượn vocabulary hữu ích từ HTTP caching, nơi một stored response chỉ được xem là fresh trong một lifetime xác định và có thể cần validation trước khi dùng lại.[1] Nó cũng mượn ý tưởng request precondition trong HTTP semantics: một write có thể phụ thuộc vào điều kiện representation vẫn khớp với thứ client đã quan sát.[2] Đây không phải yêu cầu phải triển khai HTTP, cũng không thay thế database transaction. Đây là cách làm cho time và state trở nên rõ ràng ở ranh giới nơi agent muốn tạo ra một effect.

## Observation không phải là thế giới

Tool result thường trông có vẻ authoritative vì nó đến dưới dạng một envelope có cấu trúc. Hãy xem response này:

```json
{
  "sku": "CAM-42",
  "available": 5,
  "currency": "VND",
  "observed_at": "2026-04-20T10:12:04.118Z",
  "version": "inventory-8841",
  "scope": "warehouse-hcm-01"
}
```

JSON này rất chính xác. Nó cho biết inventory service đã báo gì, báo vào lúc nào, đọc version nào và mô tả warehouse nào. Nhưng nó không nói rằng năm chiếc vẫn sẽ còn khi agent tạo order sau đó. Result là bằng chứng về state tại một thời điểm, không phải reservation.

Đây là bước thiết kế đầu tiên: hãy gọi object bằng đúng bản chất của nó. Trong runtime, hãy lưu nó như một **observation**, không phải một `tool_output` chung chung mà mọi downstream step đều có thể xem như current truth.

Một observation nên có tối thiểu các field sau:

| Field | Câu hỏi được trả lời | Ví dụ |
|---|---|---|
| `observed_at` | Source state được đo vào lúc nào? | `2026-04-20T10:12:04Z` |
| `source_version` | Version hoặc revision nào đã tạo ra result? | `inventory-8841` |
| `scope` | Nó mô tả tenant, account, region hoặc resource nào? | `warehouse-hcm-01` |
| `purpose` | Observation được thu thập để phục vụ quyết định nào? | `quote_shipping` |
| `freshness_class` | Fact này có thể trở nên không an toàn nhanh đến đâu? | `strict_write` |
| `provenance` | Tool call và parameter nào đã tạo ra nó? | `inventory.lookup(CAM-42)` |
| `confidence` | Tool có trả về result đầy đủ và authoritative không? | `authoritative` |

Mục tiêu không phải là thêm metadata cho đủ. Metadata cho policy decision tiếp theo những dữ kiện có thể inspect. Nếu thiếu chúng, orchestrator không có cách đáng tin cậy để phân biệt “answer trả về cách đây hai giây” với “answer trả về trước khi khách hàng thay đổi account”.

## Freshness là contract, không phải một TTL dùng cho mọi nơi

Một implementation đầu tiên thường thêm một field `ttl_seconds` vào mỗi tool. Cách này tốt hơn việc bỏ qua time, nhưng nó vẫn khiến freshness nghe giống một storage optimization. Trong agent system, freshness là một **decision contract** giữa observation và action sử dụng observation đó.

Cùng một observation có thể chịu được tuổi khác nhau tùy theo việc agent muốn làm gì tiếp theo. Một weather observation có thể đủ để trả lời “Sáng nay trời có mưa không?”, nhưng chưa đủ để mở airport disruption workflow. Trạng thái support ticket có thể dùng cho summary, nhưng đã quá cũ để đóng ticket. Exchange rate có thể phù hợp cho một estimate sơ bộ nhưng không phù hợp cho payment.

Hãy định nghĩa freshness theo action class, không chỉ theo tên tool:

| Action class | Mức chấp nhận điển hình | Hành vi bắt buộc |
|---|---:|---|
| Explanation | Vài phút hoặc vài giờ | Hiển thị thời điểm observation và cho phép bounded staleness. |
| Recommendation | Vài giây hoặc vài phút | Ưu tiên read mới; nói rõ age khi nó ảnh hưởng tới quyết định. |
| Reversible write | Cửa sổ ngắn | Kiểm tra observation version hoặc read lại trước khi write. |
| Irreversible hoặc high-impact write | Gần thời điểm execute nhất có thể | Revalidate ngay và fail closed khi không chắc chắn. |
| Security hoặc authorization decision | Do policy quy định | Kiểm tra lại scope và authority cùng với freshness. |

Cách này giúp product đưa ra một lời hứa trung thực. Thay vì nói “agent luôn dùng dữ liệu hiện tại”, product có thể nói: “agent sẽ không submit một high-impact action dựa trên observation cũ hơn freshness budget của action; agent cũng sẽ dừng khi source không thể xác nhận version”.

### Soft stale và hard expired

Một model hữu ích nên có nhiều hơn hai trạng thái. Tôi thường dùng ba trạng thái:

1. **Fresh:** observation nằm trong contract của action tiếp theo.
2. **Soft stale:** observation vẫn có thể giúp agent giải thích, so sánh hoặc tạo một read request mới, nhưng không thể authorize write.
3. **Hard expired:** observation không được dùng để ra quyết định; hệ thống phải refresh hoặc yêu cầu user thử lại.

![Vòng đời của một AI agent tool observation từ lúc capture đến fresh, soft-stale và hard-expired](/blog/tool-result-freshness/observation-lifecycle.webp)

Soft-stale state quan trọng cho user experience. Nếu user hỏi “Inventory trông như thế nào lúc tôi kiểm tra khi nãy?”, một observation cũ chính là thứ họ muốn. Nếu user hỏi “Hãy mua những sản phẩm còn lại”, observation đó không đủ. Reuse cho explanation và reuse để authorization là hai operation khác nhau.

Policy có thể được biểu diễn dưới dạng data:

```json
{
  "freshness_policy": "inventory_write_v2",
  "action": "create_order",
  "max_age_ms": 3000,
  "requires_version_match": true,
  "allow_soft_stale_for": ["explanation", "recheck_request"],
  "on_unknown": "fail_closed"
}
```

Các value này chỉ là ví dụ, không phải default dùng cho mọi hệ thống. Budget ba giây cho inventory có thể quá rộng với một chiếc vé khan hiếm và quá chặt với một catalog thay đổi chậm. Điều quan trọng là budget thuộc về action contract và được version như các production policy khác.

## Action gate phải nằm bên ngoài model

Model có thể đề xuất một action nên xảy ra. Nó không nên là authority cuối cùng quyết định observation hỗ trợ action đó còn hợp lệ hay không. Quyết định phải được enforce bằng application code deterministic ngay trước side effect.

Một flow tối thiểu trông như sau:

```text
user intent
   -> model đề xuất action
   -> orchestrator tải supporting observation
   -> kiểm tra freshness + scope + version + authority
   -> tool revalidation nếu cần
   -> chỉ execute action sau khi gate pass
```

![Action gate kiểm tra freshness, scope, version và authority trước khi revalidate rồi mới safe action](/blog/tool-result-freshness/revalidation-gate.webp)

Gate nên nhận một action envelope có cấu trúc thay vì một model message tự do:

```json
{
  "action": "inventory.reserve",
  "target": { "sku": "CAM-42", "warehouse": "warehouse-hcm-01" },
  "arguments": { "quantity": 1, "customer_id": "cust_18" },
  "supports": ["observation:obs_7d91"],
  "risk": "high",
  "requested_by": "user_204",
  "policy_version": "inventory_write_v2"
}
```

Sau đó orchestrator đánh giá envelope. Lưu ý rằng prose của model không nằm trong critical path. Model có thể giải thích vì sao chọn SKU, nhưng gate kiểm tra target, supporting observation, policy version, authority và source state.

```python
def can_execute(action, observations, now):
    if not policy_allows(action):
        return Deny("policy_denied")

    if not authority_allows(action.requested_by, action.target):
        return Deny("authority_changed")

    for observation in action.supports:
        if observation.is_hard_expired(now):
            return Deny("observation_expired")
        if not observation.scope_matches(action.target):
            return Deny("scope_mismatch")

    if action.requires_revalidation:
        return Revalidate()

    return Allow()
```

Check này cố ý rất nhàm chán. Nó phải dễ test, dễ log và khó bị bypass khi ai đó thêm một agent path mới. Prompt có thể khuyến khích hành vi tốt; chỉ action boundary mới có thể enforce được nó.

## Revalidation khác với việc nạp thêm context

Khi observation đã quá cũ cho một action, câu trả lời an toàn không phải lúc nào cũng là “retrieve thêm document”. Revalidation hỏi source of truth xem chính state đã làm cơ sở cho action còn đúng hay không.

Với một read-only answer, một RAG retrieval mới có thể đủ. Với một write, revalidation nên gắn với target của action và, nếu có thể, với version mà agent đã quan sát. Một số ví dụ:

| Source type | Revalidation signal | Safe failure |
|---|---|---|
| HTTP resource | `ETag`, `Last-Modified` hoặc domain revision | Trả về version mismatch và không write. |
| Database row | Revision column, compare-and-set hoặc transaction check | Abort write và load lại row. |
| Inventory service | Reservation check cho đúng SKU và location | Đưa ra quantity hiện tại hoặc hỏi lại. |
| Calendar | Event version cùng attendee/slot availability | Hiển thị slot đã thay đổi trước khi book. |
| Authorization service | Policy decision hiện tại và grant expiry | Deny và yêu cầu authorization mới. |
| External provider | Provider-side confirmation hoặc idempotent reservation | Đánh dấu outcome là unknown rồi reconcile. |

HTTP caching đưa ra một distinction hữu ích về mặt khái niệm. Cached response có thể fresh để reuse trong freshness lifetime; sau khi cần validation, client phải kiểm tra với origin thay vì giả định representation được lưu vẫn còn hợp lệ.[1] Distinction tương tự hoạt động với agent observation, nhưng policy phải nghiêm ngặt hơn với action có side effect.

Revalidation call nên hẹp. Nó không nên yêu cầu model lặp lại toàn bộ conversation hoặc chạy lại mọi tool. Nó chỉ nên xác nhận lượng state nhỏ nhất cần thiết cho proposed action:

```json
{
  "check": "inventory.reserve_precondition",
  "sku": "CAM-42",
  "warehouse": "warehouse-hcm-01",
  "expected_version": "inventory-8841",
  "quantity": 1
}
```

Nếu source hỗ trợ conditional write, hãy gộp check và write khi có thể. Tương đương với một `If-Match` precondition có nghĩa là: chỉ thực hiện write nếu current representation của server vẫn khớp với version client đã quan sát trước đó.[2] Cách này đóng race mà một read “latest” riêng lẻ vẫn để lại nếu agent chờ một khoảng thời gian rồi mới write.

## Race window mới là bug thật sự

Team thường nói: “Chúng tôi đã refresh data trước action rồi.” Điều đó vẫn có thể để lại một race window:

1. Agent đọc inventory version 42.
2. Process khác update inventory lên version 43.
3. Agent gửi write dựa trên version 42.
4. Write overwrite hoặc mâu thuẫn với state mới hơn.

Read thêm một lần giúp tăng xác suất đúng nhưng chưa tạo ra guarantee. Precondition phải được evaluate ở write boundary, không chỉ ở một bước nào đó sớm hơn trong workflow.

![Timeline mô tả AI agent đọc inventory version 42, concurrent update lên version 43, version mismatch và refresh an toàn](/blog/tool-result-freshness/race-window.webp)

Đây là nơi freshness gặp concurrency control. Freshness trả lời: “Observation này có đủ mới cho action class này không?” Version check trả lời: “Target còn là version đã tạo ra decision không?” Với high-impact write, thường cần cả hai.

Một practical write contract có thể trông như sau:

```typescript
type ActionPrecondition = {
  observationId: string;
  observedAt: string;
  expectedVersion?: string;
  maxAgeMs: number;
  scope: string;
};

type ConditionalAction = {
  name: string;
  target: string;
  args: Record<string, unknown>;
  precondition: ActionPrecondition;
};
```

Server nên reject failed precondition bằng một typed result, không phải một “tool error” chung chung khiến hệ thống muốn retry không giới hạn:

```json
{
  "ok": false,
  "kind": "precondition_failed",
  "reason": "source_version_changed",
  "current_version": "inventory-8842",
  "recovery": "refresh_and_reprice"
}
```

Agent có thể giải thích thay đổi, refresh state liên quan hoặc hỏi user xác nhận. Nó không được âm thầm reuse observation cũ chỉ vì old answer vẫn đang nằm trong context window.

## Dữ liệu soft stale cần capability boundary

Một trong các bug tinh vi nhất là cho phép soft-stale observation chảy qua một context object chung. Model nhìn thấy một record trông hoàn toàn đúng và có thể dùng nó cho tool call mới, dù application chỉ định cho phép observation đó dùng trong explanation.

Hãy trao capability cho observation thay vì một flag “usable” không phân biệt:

```json
{
  "observation_id": "obs_7d91",
  "state": "soft_stale",
  "capabilities": {
    "explain": true,
    "summarize": true,
    "recommend": false,
    "authorize_write": false,
    "execute_write": false
  }
}
```

Model có thể được cho biết source từng được kiểm tra, nhưng tool registry hoặc orchestrator vẫn phải reject action yêu cầu `authorize_write`. Điều này đặc biệt quan trọng khi cùng một context được dùng lại trong long-running workflow. Context compaction có thể giữ observation nhưng vô tình bỏ age hoặc capability metadata. Runtime nên xem freshness field bị thiếu là unknown, không phải fresh.

Quy tắc fail-closed này có vẻ bảo thủ. Nó vẫn dễ reason hơn một system mà mỗi field bị thiếu lại nhận một default khác nhau trong từng tool adapter.

## Freshness và approval liên quan, nhưng không giống nhau

Human approval không làm cho evidence cũ trở nên mới. Giả sử reviewer approve “refund order 4821 với số tiền 2.000.000 VND” sau khi xem account balance còn fresh. Agent chờ năm phút, order đổi state và payment destination được cập nhật. Một approval flag chung chung không thể cho biết evidence đã duyệt còn khớp với action sắp execute hay chưa.

Hãy bind approval vào cùng action envelope và preconditions:

```json
{
  "approval": {
    "reviewer": "operator_17",
    "approved_at": "2026-04-20T10:12:09Z",
    "action_hash": "sha256:8c...",
    "expires_at": "2026-04-20T10:13:00Z"
  },
  "preconditions": {
    "account_version": "acct-991",
    "order_version": "order-4821-v6"
  }
}
```

Ở thời điểm execution, hệ thống phải kiểm tra cả approval envelope và current version. Nếu một trong hai không còn khớp, kết quả đúng không phải là “human đã đồng ý rồi”. Kết quả đúng là “action đã được review không còn là action chúng ta sắp thực hiện”. Hãy hỏi lại bằng một preview cụ thể và fresh.

## Observability: đo decision, không chỉ đo age

Dashboard báo average tool latency sẽ không phát hiện freshness incident. Các câu hỏi cần quan tâm là observation đã đi qua action policy như thế nào:

| Metric | Điều nó cho biết |
|---|---|
| Observation age tại proposed action | Workflow mất bao lâu từ read đến decision. |
| Freshness-denial rate | Policy quá chặt, quá lỏng hay thường xuyên chỉ được chạm tới quá muộn. |
| Revalidation success rate | Source có thể xác nhận proposed action với chi phí thấp không. |
| Version-mismatch rate | Bao nhiêu decision của agent bị concurrent change làm mất hiệu lực. |
| Stale reuse theo capability | Soft-stale observation có rò rỉ vào recommendation hoặc write path không. |
| Unknown-outcome rate | Bao nhiêu timeout khiến external state không rõ ràng. |
| User rework sau stale denial | Recovery UX có giúp user hoàn thành task không. |
| Side effects prevented | Có bao nhiêu write nguy hiểm tiềm tàng đã bị gate chặn. |

Hãy log một decision record có cân nhắc privacy cho mỗi gate evaluation. Giữ observation ID, action class, policy version, age bucket, scope result, version result, revalidation result và terminal decision. Tránh copy toàn bộ prompt hoặc sensitive tool payload vào mọi record; các pattern provenance và observability hiện có trong folio là companion phù hợp cho phần này.

Denominator hữu ích nhất thường là **proposed actions**, không phải tool calls. Một system có thể có tool latency rất tốt nhưng vẫn không an toàn nếu một tỷ lệ lớn proposed write dùng observation đã nằm ngoài action contract.

## Test chiều time

Một unit test thông thường thường execute read và write ngay sát nhau, nên race biến mất. Test phải làm time và concurrency trở nên explicit.

| Test case | Expected result |
|---|---|
| Observation fresh, version khớp | Action được allow. |
| Observation soft-stale dùng cho explanation | Explanation có age; không cấp write capability. |
| Observation soft-stale dùng cho write | Action bị deny hoặc phải revalidate. |
| Observation hard-expired | Phải refresh trước mọi decision. |
| Timestamp hoặc version bị thiếu | Xem là unknown và fail closed với high-risk action. |
| Scope thay đổi giữa read và action | Deny, ngay cả khi value vẫn fresh. |
| Version thay đổi sau revalidation | Conditional write fail; hiển thị state mới. |
| Revalidation timeout | Không đoán; trả về explicit unknown outcome. |
| Retry sau precondition failure | Chỉ retry với observation mới và attempt bị giới hạn. |
| Context compaction làm mất metadata | Runtime reject observation thay vì giả định freshness. |

Property-based test hữu ích cho invariant: **không high-impact action nào được execute khi supporting observation đã expired, out of scope hoặc không biết version**. Chaos test có thể thêm delay giữa observation và action, inject concurrent update và drop revalidation response.

Test suite cũng nên kiểm tra recovery language. “Action không thể hoàn tất vì inventory đã đổi từ version 42 sang version 43” tốt hơn đáng kể so với “Something went wrong”. Một safety boundary mà user không hiểu sẽ sớm bị support staff bypass hoặc bị che sau một retry button.

## Rollout: bắt đầu từ những write dễ giới hạn

Đừng bắt đầu bằng việc thêm freshness metadata vào mọi string mà mọi tool trả về. Hãy bắt đầu với một nhóm action mà stale state có chi phí rõ ràng: payment, reservation, thay đổi account, publish, đóng ticket và delete.

Một staged rollout giúp policy có thể đo được:

| Stage | Thay đổi | Exit evidence |
|---|---|---|
| Inventory | Đăng ký observation với timestamp, scope và source version. | Mọi protected action đều gọi tên được supporting observation. |
| Observe | Log would-deny decision nhưng chưa block traffic. | Team hiểu age distribution và nguyên nhân denial chính. |
| Gate | Block hard-expired và scope-mismatch high-risk action. | Không có bypass path nào execute cùng action mà thiếu gate. |
| Revalidate | Thêm version check hoặc conditional write theo từng source. | Version mismatch có type rõ và recovery được. |
| Expand | Mở soft-stale capability và policy tier cho nhiều workflow hơn. | Explanation path và action path được tách bằng metric. |
| Enforce | Unknown freshness fail closed cho protected action. | Incident drill cho thấy behavior bị giới hạn và recovery hữu ích. |

Hãy giữ policy gần tool contract, nhưng đồng thời enforce nó ở một shared action gateway. Logic freshness bị duplicate sẽ drift rất nhanh: adapter này có thể hiểu timestamp thiếu là “now”, adapter khác dùng local machine time, adapter thứ ba âm thầm chấp nhận stale version. Central policy evaluation không loại bỏ tool-specific knowledge; nó khiến final decision nhất quán hơn.

## Practical checklist

Trước khi cho phép agent thực hiện một state-changing tool call, hãy hỏi:

| Câu hỏi | Evidence cần có |
|---|---|
| Observation nào đã làm cơ sở cho action? | Stable observation ID và provenance. |
| Nó được quan sát khi nào và ở đâu? | Timestamp, source, scope và account/tenant binding. |
| Nó được phép cũ bao lâu cho action này? | Versioned freshness policy và action class. |
| Source có thể chứng minh version chưa đổi không? | Revision, validator hoặc conditional write. |
| Điều gì xảy ra nếu source unavailable? | Explicit unknown result và fail-closed behavior. |
| Soft-stale data có thể đi vào write path không? | Capability-based observation permission và negative test. |
| Approval có gắn với chính xác action không? | Action hash, expiry, target, arguments và preconditions. |
| Operator có giải thích được denial không? | User-facing reason và recovery path. |
| Team có đo được side effect đã ngăn không? | Gate metric với proposed-action denominator. |

Câu hỏi quan trọng nhất không phải “Agent đã gọi đúng tool chưa?” mà là “State làm cơ sở cho tool call còn hợp lệ ở thời điểm call có thể thay đổi thế giới hay không?”

## Lời kết

Agent khiến stale data nguy hiểm hơn vì nó biến observation thành plan. Dashboard có thể chịu được một con số cũ năm phút. Con người có thể nhận ra một price bất thường và hỏi lại. Agent có thể xem đúng con số đó là lý do để reserve, pay, publish, delete hoặc trấn an khách hàng.

Giải pháp không phải giả vờ mọi observation đều live, cũng không phải ép mọi workflow thành một serial transaction. Hãy làm cho boundary trở nên rõ ràng. Mỗi observation cần age, scope, version, provenance và capability. Mỗi action cần freshness contract. Hãy revalidate gần side effect nhất có thể. Bind write với version mà decision đã dựa vào. Khi hệ thống không chứng minh được continuity, hãy dừng và giải thích thay vì bịa ra sự tự tin.

Một agent đáng tin không phải agent luôn hành động nhanh. Đó là agent biết khi nào một answer cũ vẫn còn hữu ích—và khi nào dùng nó sẽ tạo ra incident mới.

## Related reading trong production AI series

Về cache reuse và invalidation, xem [Semantic Caching for LLM Apps](/blog/semantic-caching-llm-freshness-safety/). Về historical truth và valid-time retrieval, xem [Temporal RAG](/blog/temporal-rag-time-aware-retrieval/). Về state change trong browser world, xem [State-Aware Browser Agents](/blog/state-aware-browser-agents/). Về replay-safe side effect, xem [Idempotent AI Actions](/blog/idempotent-ai-actions/).

## References

[1]: https://www.rfc-editor.org/rfc/rfc9111.html "RFC 9111 — HTTP Caching"
[2]: https://www.rfc-editor.org/rfc/rfc9110.html "RFC 9110 — HTTP Semantics"
