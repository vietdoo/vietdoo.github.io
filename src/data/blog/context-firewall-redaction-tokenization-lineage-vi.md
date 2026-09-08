---
title: "Context Firewall: Redaction, Tokenization và Data Lineage trước khi vào Prompt"
description: "Playbook production để xem context của AI như một data plane có governance—minimize theo field, redaction, tokenization, kiểm tra tenant và purpose, giữ lineage, freshness và fail-closed trước inference."
pubDate: 2026-09-05
category: "engineering"
image: "/blog/context-firewall/hero.webp"
lang: "vi"
translationKey: "context-firewall-redaction-tokenization-lineage"
draft: false
---

Một AI agent hiếm khi chỉ nhận một input sạch duy nhất. Trước khi model nhìn thấy prompt, orchestrator có thể đã trộn user message, tài liệu được retrieve, record từ CRM, kết quả tool, conversation memory, policy snippet và metadata đến từ nhiều tenant. Từng nguồn có thể hợp lệ nếu xét riêng, nhưng vẫn không phù hợp để đưa vào context của workflow hiện tại.

Ranh giới này thường bị bỏ quên vì nó chỉ được triển khai bằng vài phép nối chuỗi bên trong hàm retrieval hoặc orchestration. Khi hệ thống chạy đúng, prompt trông có vẻ hữu ích. Khi lỗi xảy ra, incident thường được mô tả là “model đã nhìn thấy dữ liệu nhạy cảm”, “RAG trả nhầm dữ liệu khác tenant”, hoặc “agent dùng context đã cũ”. Trong cả ba tình huống, abstraction còn thiếu là như nhau: **context cần một firewall trước khi trở thành input của model**.

Context firewall không phải prompt-injection filter, không phải DLP scanner gắn vào cuối request, cũng không phải một dashboard observability khác. Nó là một data plane có policy, chịu trách nhiệm quyết định field nào được vào context, vào vì mục đích gì, cần được biến đổi ra sao, thuộc tenant nào, còn fresh trong bao lâu, và quyết định đó có thể được dựng lại như thế nào.

> **Context firewall là ranh giới có kiểm soát cuối cùng trước khi dữ liệu không tin cậy hoặc dữ liệu nhạy cảm trở thành thứ model có thể nhìn thấy.**

Điều này càng đáng chú ý khi tracing đang dần trở thành tiêu chuẩn nhưng chất lượng production vẫn khó giải. Báo cáo *State of AI Agents* năm 2026 của LangChain cho biết 89% tổ chức được khảo sát đã có một dạng observability cho agent, trong khi quality vẫn là rào cản lớn nhất khi đưa agent vào production.[1] Nhìn thấy một context xấu sau khi sự việc xảy ra là hữu ích. Ngăn field không có căn cứ đi vào context ngay từ đầu còn tốt hơn.

## Context là data plane, không phải một string

Một mental model thực tế là xem mỗi context item như một data object có type và có quyết định đi kèm. Firewall không nên chỉ nhận `text`. Nó nên nhận một candidate item có origin, owner, sensitivity, purpose, tenant, freshness và lịch sử transformation.

| Câu hỏi | Cách làm yếu | Cách làm với context firewall |
|---|---|---|
| Đây là gì? | Một đoạn text | Một item ở cấp field với source reference ổn định |
| Vì sao nó ở đây? | Retriever trả về | Một purpose và policy decision được khai báo |
| Ai được nhìn thấy? | Ai gọi agent thì thấy | Kiểm tra tenant, subject, role và scope |
| Có thể biến đổi không? | Thường copy nguyên trạng | Redact, mask, tokenize, summarize hoặc reject |
| Còn hợp lệ không? | Timestamp retrieval bị ẩn | Freshness budget và expiry rõ ràng |
| Có giải thích được không? | Search score và trace | Decision, rule version, lineage và transformation record |

Điểm khác biệt này ngăn một lỗi suy luận rất phổ biến. Retrieval relevance trả lời câu hỏi “Nó có liên quan không?”. Nó không trả lời “Field này có được phép disclosure cho agent này, vì purpose này không?”. Một document có similarity cao vẫn có thể nằm ngoài tenant của caller, nằm ngoài purpose của workflow, hoặc nhạy cảm đến mức không nên đưa vào raw context.

## Pipeline năm bước của firewall

Một pipeline production có thể gồm năm bước. Tên gọi không quan trọng bằng invariant: mọi item được accept phải mang theo ngữ cảnh quyết định, còn mọi item bị reject phải observable nhưng không được làm lộ payload bị từ chối.

![Minh họa ba bước từ raw record đi qua filter và tokenization để trở thành model context an toàn](/blog/context-firewall/redaction-tokenization.webp)

### 1. Classify trước khi retrieve rộng

Classification nên diễn ra ngay khi ingest và được refine ở request time. Một customer record có thể chứa account metadata công khai, internal note, payment identifier, thông tin sức khỏe hoặc free-form text chưa rõ độ nhạy. Xem cả record như một sensitivity class duy nhất khiến đường an toàn hoặc quá dễ dãi, hoặc quá hạn chế.

Taxonomy tối thiểu không phải một danh sách label đúng cho mọi công ty. Nó là tập quyết định mà firewall có thể enforce: `public`, `internal`, `confidential`, `restricted` và `unknown`. `Unknown` không được tự động biến thành public. Nó nên đi qua conservative path cho tới khi classifier, owner hoặc human process cung cấp evidence tốt hơn.

Metadata classification cần có version. Nếu record được admit dưới classifier `cls_17`, rồi policy classification đổi về sau, hệ thống phải phân biệt được decision cũ và decision mới thay vì rewrite lịch sử.

### 2. Minimize ở cấp field

Firewall phải tìm representation nhỏ nhất nhưng vẫn đủ cho task. Một support agent trả lời câu hỏi “Khách hàng này đã báo cùng outage chưa?” có thể cần incident identifier, sản phẩm bị ảnh hưởng và timestamp. Nó có lẽ không cần full address, payment token hay internal account note.

Minimize ở cấp field bền vững hơn prompt instruction kiểu “đừng tiết lộ thông tin riêng tư”. Model không thể đáng tin cậy unsee dữ liệu đã được đưa cho nó. Decision phải xảy ra trước tokenization và trước prompt assembly.

Một allow decision thực tế có thể viết như sau:

```text
allow(item) =
  tenant_ok
  AND purpose_ok
  AND subject_scope_ok
  AND freshness_ok
  AND sensitivity <= purpose_ceiling
  AND transformation_available
```

Policy phải nói rõ điều gì xảy ra khi một input là unknown. Với high-impact action, `unknown purpose`, `unknown tenant` hoặc `unknown classification` thường nên trở thành block hoặc human-review state, chứ không phải implicit allow.

### 3. Transform giá trị nhạy cảm

Redaction, masking, tokenization và controlled summarization phục vụ các mục đích khác nhau.

| Transformation | Model nhận được | Khi hữu ích | Failure mode chính |
|---|---|---|---|
| Redaction | Không gì hoặc một placeholder | Giá trị không cần thiết cho task | Xóa nhầm thông tin cần để phân biệt case |
| Masking | Một phần giá trị như `•••• 4821` | So sánh thân thiện với người dùng | Partial value vẫn có thể định danh trong dataset nhỏ |
| Tokenization | Surrogate ổn định như `cust_tok_91` | Giữ reference xuyên các bước mà không lộ raw value | Detokenization service trở thành target có giá trị cao |
| Bucketing | Khoảng hoặc category | Suy luận số mà không cần con số chính xác | Mất precision và lỗi ở ranh giới bucket |
| Controlled summary | Derived fact có provenance | Workflow cần ý nghĩa chứ không cần payload | Summary có thể sinh claim không có evidence |

Tokenization không phải anonymization. Một token ổn định vẫn có thể được join qua nhiều request, và lookup table vẫn có thể khôi phục giá trị gốc. Vì vậy firewall phải mang theo token scope, purpose, expiry và authority cho detokenization. Token được tạo cho fraud investigation không nên tự động dùng được trong workflow chăm sóc khách hàng.

### 4. Giữ lineage và context manifest

Prompt gửi cho model không cần chứa toàn bộ chi tiết audit, nhưng hệ thống cần một manifest gọn ghi lại item nào được admit và vì sao. Manifest là cầu nối giữa prompt an toàn và hệ thống có thể giải thích.

```json
{
  "context_id": "ctx_01J9FIREWALL",
  "workflow_id": "wf_support_triage",
  "tenant": "tenant_acme",
  "purpose": "duplicate_incident_detection",
  "policy_version": "ctx-policy-2026.09.1",
  "items": [
    {
      "source_ref": "incident://48291",
      "field": "product_and_timestamp",
      "decision": "allow",
      "transform": "direct",
      "classification": "internal",
      "fresh_until": "2026-09-05T10:20:00Z"
    },
    {
      "source_ref": "customer://8841",
      "field": "email",
      "decision": "allow",
      "transform": "tokenize",
      "token_scope": "support_case_48291",
      "classification": "confidential",
      "fresh_until": "2026-09-05T10:20:00Z"
    },
    {
      "source_ref": "account://8841",
      "field": "payment_instrument",
      "decision": "deny",
      "reason_code": "purpose_not_authorized"
    }
  ]
}
```

Nếu dùng cho audit, manifest nên append-only hoặc content-addressed. Nó không nên copy rejected payload vào một log mới. Một denial record an toàn có thể chứa source reference ổn định, rule code, policy version và hash của field identifier mà không lưu raw value nhạy cảm.

![Minh họa source record nối qua lineage ledger để tạo context manifest có purpose, tenant, transformation và expiry](/blog/context-firewall/lineage-manifest.webp)

## Purpose cũng là security boundary

Permission và purpose liên quan nhưng không đồng nhất. Một nhân viên support có thể được phép xem account của khách hàng nhưng vẫn không được dùng payment detail cho marketing recommendation. Một tool có thể được quyền đọc ticket nhưng không được gửi attachment riêng tư đến third-party model.

Vì vậy purpose nên là input hạng nhất của firewall, không phải comment trong caller code. Request có thể mang purpose như `resolve_support_case`, `draft_internal_summary` hoặc `verify_refund_status`. Policy sau đó quy định field nào chấp nhận được cho từng purpose và model provider nào được approve cho từng data class.

Điều này còn tạo ra cách thực tế để xử lý model routing. Context public, rủi ro thấp có thể dùng provider pool rộng hơn. Context restricted có thể yêu cầu region được phê duyệt, private endpoint hoặc local model. Firewall nên tạo ra route constraint, thay vì để router đoán privacy từ nội dung text.

## Freshness phải đứng cạnh sensitivity

Một field có thể an toàn để disclosure nhưng vẫn không an toàn để dùng. Inventory, entitlement, credit status, incident state và approval status đều thay đổi. Context firewall nên gắn freshness budget cho mỗi item và enforce khi admission; với action có ảnh hưởng lớn, nên kiểm tra lại ngay trước execution.

Item stale không nhất thiết phải biến mất mà không có lời giải thích. Firewall có thể trả về state có cấu trúc như `expired`, `refresh_required` hoặc `uncertain`. Orchestrator nhờ vậy chỉ refresh source bị ảnh hưởng, thay vì rebuild mù toàn bộ prompt. Cách này cũng tránh biến stale context thành correctness bug im lặng.

## Fail closed, nhưng phải fail hữu ích

“Fail closed” không có nghĩa là trả về một prompt rỗng và để người dùng tự đoán. Nó có nghĩa là từ chối inclusion không an toàn nhưng vẫn trả về đủ structured information để workflow recover.

![Ba panel minh họa chặn cross-tenant, context hết hạn và đường fail-closed sạch dẫn tới human review](/blog/context-firewall/failure-modes.webp)

Một response envelope hữu ích có thể như sau:

```json
{
  "status": "needs_review",
  "allowed_items": 7,
  "blocked_items": 2,
  "refresh_items": 1,
  "next_step": "request_owner_approval",
  "reason_codes": ["cross_tenant", "purpose_not_authorized", "expired"]
}
```

Thông điệp cho người dùng có thể là: “Tôi chưa thể dùng một account note vì workflow này không có purpose scope cần thiết. Tôi có thể tiếp tục với bảy item đã được approve hoặc gửi yêu cầu review.” Cách này trung thực và hữu ích hơn việc âm thầm bỏ qua note, hoặc lộ nó ra chỉ vì model yêu cầu thêm context.

## Test firewall như một product boundary

Context firewall cần nhiều hơn unit test cho hàm redaction. Test quan trọng phải kết hợp tenant, purpose, sensitivity, freshness, transformation và downstream provider.

| Nhóm test | Invariant cần giữ |
|---|---|
| Tenant isolation | Item của tenant B không bao giờ vào manifest của tenant A, kể cả khi nó đứng đầu retrieval ranking |
| Purpose limitation | Payment field bị deny cho purpose marketing-summary |
| Transformation | Restricted identifier không còn xuất hiện dưới dạng raw trong prompt bytes sau tokenization |
| Lineage | Mọi item được admit đều resolve được về source ổn định và policy decision |
| Freshness | Entitlement hết hạn phải trigger refresh hoặc review trước action |
| Fail closed | Classification unknown không được âm thầm đi vào workflow high-impact |
| Provider routing | Restricted context không được gửi tới provider chưa approve |
| Redaction safety | Denial log chỉ có reason code, không có rejected payload |
| Adversarial retrieval | Instruction giống prompt nằm trong document không làm thay đổi firewall decision |

Test cuối giúp giữ ranh giới rõ. Prompt-injection defense có thể kiểm tra nội dung để tìm instruction nguy hiểm. Context firewall quyết định nội dung đó có đủ điều kiện xuất hiện hay không. Hai lớp bổ sung cho nhau, nhưng không lớp nào thay thế lớp kia.

## Rollout mà không làm hỏng mọi workflow

Đừng bắt đầu bằng việc enforce mọi rule trên mọi path. Hãy bắt đầu ở shadow mode: tạo manifest và decision, đo các would-be block, rồi sample case để reviewer xem. Mục tiêu là biết metadata nào đang thiếu và transformation nào vẫn giữ được task quality.

Sau đó enforce những control có độ chắc chắn cao nhất: tenant boundary, restricted field, provider restriction và hard expiry cho state quyết định action. Giữ escape hatch bằng owner approval rõ ràng và expiry ngắn, không dùng global bypass flag. Mọi exception phải visible trong manifest và quy được về người hoặc service identity.

Các metric nên theo dõi gồm block rate theo reason, tỷ lệ context có classification unknown, refresh success rate, số request detokenization, false-positive review rate và task quality sau transformation. Allow rate tăng không tự động là tín hiệu tốt. Hệ thống có thể chỉ đang học cách gắn mọi thứ thành internal. Hãy ghép policy metric với content review có sampling và downstream task metric.

## Context firewall không chứng minh được điều gì

Firewall có thể chứng minh rằng một field đã đi qua một admission policy cụ thể tại một thời điểm cụ thể. Nó không chứng minh field đó là sự thật, source không bị compromise, model tuân thủ instruction, hay action cuối cùng là đúng. Nó cũng không thể biến một purpose definition yếu thành một authorization boundary có ý nghĩa.

Những giới hạn này là một phần của thiết kế trung thực. Firewall là một layer trong control plane. Nó nên kết nối với identity, retrieval, provider routing, observability, evals và action approval, nhưng giữ contract của mình đủ hẹp: **kiểm soát thứ trở thành model-visible, giữ lại lý do, và từ chối thứ không thể biện minh**.

## Checklist thực tế

Trước khi gọi model, hãy hỏi mọi context item đã có source reference ổn định, classification, tenant, purpose, policy version, transformation record và freshness deadline hay chưa. Xác nhận unknown đi theo fail-closed path rõ ràng. Xác nhận provider route tương thích với item nhạy cảm nhất đã được admit. Xác nhận reviewer có thể mở manifest mà không phải copy raw payload sang một leak surface mới.

Sau khi deploy, hãy sample cả decision được allow và deny. Test cross-tenant retrieval, stale state, partial outage, nhầm token scope và exception hết hạn. Đo xem hệ thống còn hữu ích sau minimization hay không; firewall chặn tất cả không phải product đáng tin, còn firewall cho tất cả chỉ là một cánh cổng trang trí.

Context firewall tốt nhất không phải firewall có nhiều rule nhất. Đó là firewall khiến input của model trở nên **có chủ đích, có giới hạn, có thể quy trách nhiệm và có thể phục hồi**.

## References

[1]: https://www.langchain.com/state-of-agent-engineering — LangChain, “State of AI Agents,” 2026.
[2]: https://genai.owasp.org/resource/state-of-agentic-ai-security-and-governance/ — OWASP Gen AI Security Project, “State of Agentic AI Security and Governance 2.01,” ngày 1 tháng 6 năm 2026.
