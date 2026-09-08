---
title: "Multi-Tenant AI Agent Platform: Cô lập Prompt, Tool, Memory và Cost giữa các Tenant"
description: "Thiết kế platform phục vụ nhiều tenant mà không để prompt, tool, memory, trace hay noisy neighbor vượt qua ranh giới."
pubDate: 2026-07-21
category: "architecture"
image: "/blog/multi-tenant-agent/hero.webp"
lang: "vi"
translationKey: "multi-tenant-ai-agent-platform"
draft: false
---

![Multi-tenant AI platform với các workspace tenant riêng biệt kết nối tới shared control plane](/blog/multi-tenant-agent/hero.webp)

<figure class="blog-video">
  <video controls preload="metadata" playsinline poster="/blog/multi-tenant-agent/hero.webp" aria-label="Video giải thích nội dung bài viết, phiên bản tiếng Việt">
    <source src="/blog/multi-tenant-ai-agent-platform/video-vi.mp4" type="video/mp4" />
    Trình duyệt của bạn không hỗ trợ video HTML5.
  </video>
  <figcaption>Video giải thích chuyên sâu: phiên bản tiếng Việt.</figcaption>
</figure>

<video controls width="100%" src="/blog/multi-tenant-agent/MultiTenantPlatform.mp4"></video>

Phiên bản đầu tiên của một AI agent platform thường có một khách hàng, một workspace, một vector index, một nhóm tool và một hóa đơn. Kiến trúc có vẻ sạch vì các boundary phần lớn được ngầm hiểu bởi application process.

Rồi khách hàng thứ hai xuất hiện.

Platform phải trả lời những câu hỏi mà prototype single-tenant từng được phép bỏ qua. Prompt của tenant A có thể ảnh hưởng tới lựa chọn tool cho tenant B không? Memory search có thể trả về kết quả của workspace khác không? Ai trả tiền khi một model call dùng chung phải mở rộng context ba lần? Điều gì xảy ra khi một khách hàng tạo burst chiếm toàn bộ queue?

Đây không chỉ là câu hỏi authorization. Đây là **câu hỏi về boundary của hệ thống**. Một platform có thể authenticate request đúng nhưng vẫn làm lộ dữ liệu qua cache key, trace attribute, prompt template dùng chung, vector filter, retry queue hoặc cost dashboard.

Bài viết này xem multi-tenancy như một thuộc tính end-to-end của AI agent platform. Trọng tâm là prompt, tool, memory, model routing, observability, rate limit, secret và billing attribution. Mục tiêu không phải áp một isolation tier cho mọi khách hàng. Mục tiêu là làm boundary rõ ràng để team biết chỗ nào có thể share và chỗ nào phải tách.

> **Luận điểm:** Tenant isolation không phải một column thêm vào request table. Đó là invariant phải sống qua mọi hop từ ingress tới model context, tool execution, memory retrieval, trace storage, retry và invoice.

## Tenant boundary đi qua toàn bộ request

Request envelope nên mang tenant identity và policy context từ edge tới mọi component có thể đọc, ghi, execute hoặc observe dữ liệu.

```json
{
  "request_id": "req_01J...",
  "tenant_id": "tenant-17",
  "workspace_id": "workspace-3",
  "actor_id": "user-42",
  "data_class": "restricted",
  "region": "approved-eu",
  "policy_version": "tenant-policy-8",
  "budget": {"tokens": 24000, "usd": 0.12}
}
```

Envelope không tự nó là security boundary. Nó là carrier cho các decision phải được enforce ở downstream. Mỗi service phải nhận verified envelope hoặc reject request. Việc reconstruct `tenant_id` từ một header không đáng tin giữa request không phải propagation; đó là confused-deputy risk.

![Control plane quản lý onboarding, policy, routing, audit và billing trong khi workspace tenant vẫn được cô lập](/blog/multi-tenant-agent/control-plane.webp)

Một platform thường có hai plane:

| Plane | Trách nhiệm | Kỳ vọng isolation |
|---|---|---|
| Control plane | Tenant lifecycle, plan, policy version, model catalog, feature flag, billing rule | Metadata dùng chung có thể chấp nhận, nhưng record phải tenant-scoped hoặc explicitly global. |
| Data và execution plane | Prompt, memory, tool, secret, model request, trace, artifact | Mặc định deny giữa tenant; share phải explicit và test được. |

Control plane có thể dùng chung mà không khiến execution plane dùng chung. Ngược lại, database tách riêng cũng không giúp nếu prompt compiler hoặc trace exporter chung đã merge dữ liệu trước khi lưu.

## Bốn isolation tier tốt hơn một khẩu hiệu

“Multi-tenant” mô tả hình dạng sản phẩm, không phải một kiến trúc duy nhất. Các tenant khác nhau có thể cần isolation tier khác nhau.

| Tier | Hình dạng thường gặp | Điểm mạnh | Trade-off vận hành |
|---|---|---|---|
| Shared tables | Database chung với tenant key bắt buộc và row-level policy | Hiệu quả cho nhiều tenant nhỏ | Thiếu một filter có thể thành cross-tenant incident. |
| Shared database, schema/index riêng | Tách logic bằng schema, collection hoặc index | Boundary dữ liệu rõ hơn | Nhiều migration và catalog management hơn. |
| Dedicated execution namespace | Queue, secret, worker hoặc Kubernetes namespace riêng | Kiểm soát noisy-neighbor và runtime tốt hơn | Cần capacity planning và deployment automation. |
| Dedicated environment | Account, cluster hoặc region riêng | Giảm blast radius mạnh nhất | Đắt; đòi hỏi automation trưởng thành. |

Tier đúng phụ thuộc độ nhạy dữ liệu, yêu cầu hợp đồng, workload shape và failure cần containment. Đừng gọi shared vector index là “isolated” chỉ vì mọi query đều có filter. Filter cần thiết, nhưng correctness của nó phải được test, monitor và bảo vệ khỏi bypass path.

Thiết kế thực tế nên bắt đầu bằng isolation matrix: với mỗi resource, ghi key, owner, read path, write path, cache behavior, retention và audit event. Resource nào không có owner rõ sẽ dần trở thành shared một cách tình cờ.

## Prompt isolation bao gồm template và history

Rủi ro dễ thấy là prompt injection từ một tenant. Rủi ro khó thấy hơn là tái sử dụng nhầm context riêng của tenant.

Prompt assembly có thể ghép system instruction, product policy, tenant config, user message, memory, retrieved document, tool description và previous turn. Mỗi nguồn cần provenance label và authority level. Custom instruction của tenant không được override platform safety rule chỉ vì nó xuất hiện sau trong string.

Hãy namespaced và versioned prompt template:

```text
system/platform/v4
policy/tenant-17/v8
agent/support/v3
memory/tenant-17/user-42
retrieval/tenant-17/case-4821
user/request-01J...
```

Tên chỉ là ví dụ, nhưng nguyên tắc quan trọng: prompt compiler phải trả lời được mỗi block đến từ đâu, tenant nào sở hữu và block đó có được phép vào model request hiện tại không. Đây liên quan tới [context engineering](/blog/model-router-ai-agent), nhưng câu hỏi tenant phải đứng trước: context relevant không có nghĩa là được phép dùng.

Đừng dùng global semantic cache nếu cache key không bao gồm mọi dimension liên quan tới policy. Hai câu hỏi semantically giống nhau của hai tenant không được share answer nếu data, tool, policy hoặc contract khác nhau. Trong nhiều hệ thống, exact cache với tenant và policy key đầy đủ an toàn hơn semantic cache thông minh nhưng key thiếu.

## Tool isolation là authority isolation

Tenant không chỉ nhận một danh sách tool đã lọc. Platform phải bind tool authority với tenant, actor, workflow, data class và step hiện tại.

Hai khách hàng có thể cùng dùng `search_cases`, nhưng data scope và maximum page size khác nhau. Một tenant chỉ có CRM integration read-only; tenant khác có write capability đã được approve. Tên tool không thể mang đầy đủ ý nghĩa bảo mật.

Tool invocation envelope có thể làm các dimension bị thiếu trở nên rõ ràng:

```json
{
  "tenant_id": "tenant-17",
  "actor_id": "user-42",
  "workflow_id": "wf-88",
  "capability": "case.search",
  "scope": {"workspace_id": "workspace-3"},
  "side_effect": "none",
  "deadline_ms": 1800,
  "idempotency_key": null
}
```

Tool service phải tự verify envelope. Đừng tin model sẽ tôn trọng tenant boundary và đừng dựa vào câu trong prompt như “chỉ truy cập workspace này”. Model có thể chọn tool; service quyết định call có được phép không.

Điều này khác bài toán MCP least-privilege trong [bài về MCP security](/blog/mcp-is-not-an-api-wrapper). Bài đó tập trung capability và protocol boundary. Multi-tenancy thêm câu hỏi thứ hai: ngay cả khi capability được phép, **dữ liệu và credential của tenant nào được phép bị chạm tới?**

Secret cũng cần cách xử lý tương tự. Resolve secret lúc execution qua tenant-aware secret broker; đừng inject toàn bộ secret của khách hàng vào shared worker environment; không đặt secret trong model context hoặc general-purpose trace. Tool chỉ nên nhận credential tối thiểu cho operation cụ thể.

## Memory và retrieval là đường rò phổ biến

Memory khiến agent có cảm giác nhất quán. Nó cũng là nơi tenant isolation thường trở nên ngầm hiểu.

Hãy tách ít nhất các scope sau:

| Memory scope | Ví dụ | Quy tắc isolation |
|---|---|---|
| Platform | Global safety policy hoặc product documentation công khai | Explicitly global, versioned và reviewed. |
| Tenant | Customer config và organization fact | Chỉ share trong tenant boundary. |
| Workspace | Knowledge của project | Không trả ra ngoài workspace. |
| User | Preference và history cá nhân | Không promote vào tenant memory nếu chưa consent. |
| Task | Fact tạm thời của một workflow | Expire theo workflow hoặc retention policy. |

Vector filter phải được tạo từ verified authorization context, không phải từ string do model tạo. Retrieval service nên reject query thiếu tenant scope và record scope đã dùng cho từng result. Nguyên tắc tương tự áp dụng cho reranking, summary, embedding job, deletion và reindexing.

Platform cũng cần deletion semantics. Nếu tenant xóa document, source biến mất nhưng embedding còn không? Summary còn chứa fragment không? Cached answer có còn visible không? Data lifecycle là một phần của isolation vì bản sao cũ có thể vượt qua contractual boundary dù primary database đúng.

## Noisy neighbor là vấn đề correctness

Tenant gửi batch lớn có thể ảnh hưởng mọi người qua model concurrency, queue depth, vector search, GPU memory hoặc database connection. Đây thường được gọi là noisy-neighbor problem, nhưng gọi là “performance issue” thì quá nhẹ. Dưới áp lực, team có thể tắt limit, tăng timeout hoặc đi fallback path làm yếu data và policy control.

![Fair scheduling, budget theo tenant, queue và rate limit bảo vệ platform trước tenant tạo burst](/blog/multi-tenant-agent/noisy-neighbor.webp)

Dùng nhiều control cùng lúc:

| Control | Bảo vệ gì | Chi tiết quan trọng |
|---|---|---|
| Admission limit | Capacity toàn hệ thống | Reject hoặc defer trước stage tốn kém. |
| Per-tenant concurrency | Fairness | Đếm model work và tool work riêng. |
| Token budget | Cost và model capacity | Tính input, output, retry và context expansion. |
| Priority queue | User-facing latency | Định nghĩa ai được preempt batch work và vì sao. |
| Load shedding | Sự sống còn của platform | Trả retry/queue state rõ ràng, không timeout im lặng. |
| Fair billing | Trách nhiệm khách hàng | Gán shared overhead bằng rule công bố được. |

Limit phải áp dụng cho retry và background job, không chỉ request đầu tiên. Nếu không, tenant có thể nằm trong request rate nhưng task lỗi của họ vẫn tiếp tục tiêu thụ platform ở background.

Cost dashboard nên hiển thị direct cost và allocated cost. Direct cost gồm token, storage, tool usage. Allocated cost có thể gồm shared worker, retrieval infrastructure, cache miss và failed attempt. Công thức phân bổ không cần hoàn hảo, nhưng phải ổn định và giải thích được. “Platform tháng này tốn hơn” không phải tenant policy.

## Observability phải giữ boundary

Trace có thể làm lộ dữ liệu giống database query. Shared trace system cần tenant-aware access control, field-level redaction, retention policy và correlation ID an toàn.

Ít nhất hãy có tenant identity trong authorization context khi đọc trace, nhưng đừng xem tenant label là free-text attribute. Normalize, validate và đảm bảo dashboard không query xuyên tenant trừ khi operator có platform-level role.

Lưu metadata hữu ích mà không copy secret hay raw user content theo mặc định:

```text
tenant_id: tenant-17
workflow_id: wf-88
route_id: rt-01J...
tool: case.search
input_tokens: 1840
policy_version: tenant-policy-8
result: allowed
redaction: applied
```

Trace join là một bẫy khác. Request ID của tenant này không được tái sử dụng làm public correlation ID cho tenant khác. Background job nên có internal job ID mới nhưng giữ parent relationship đã authorize.

Incident response cũng cần tenant-impact query: tenant nào nằm trong queue, cache, worker, index hoặc provider route bị ảnh hưởng? Không có dimension này, team không thể xác định blast radius nhanh.

## Test isolation như một distributed invariant

Đừng chỉ dựa vào unit test happy path kiểm tra `tenant_id` xuất hiện trong một SQL query. Hãy test các cách dữ liệu vượt boundary:

* bỏ tenant filter khỏi một repository call và kiểm tra policy test có fail không;
* đưa token của tenant A trong prompt qua worker đang được gán cho tenant B;
* tạo request semantically giống nhau ở hai tenant và kiểm tra cache;
* replay retry sau khi worker lease hết hạn;
* xóa document và query mọi memory, summary, embedding, cache path;
* chạy batch tenant tới khi queue và token limit hoạt động;
* đọc trace bằng operator account chỉ scoped cho một tenant;
* rotate secret trong khi một tool call đang chờ trong queue.

Production test phải assert cả positive và negative property: tenant A đọc được dữ liệu được phép của mình, và tenant A không thể đọc dữ liệu tenant B ngay cả khi tool argument, vector query, cache key, retry path hoặc trace filter bị malformed.

## Rollout theo trình tự để platform trung thực

| Phase | Công việc | Bằng chứng |
|---|---|---|
| Inventory | Liệt kê mọi resource và path có tenant. | Isolation matrix được engineering và security review. |
| Envelope | Thêm verified tenant/policy context vào mọi call. | Contract test reject context thiếu hoặc không nhất quán. |
| Storage | Enforce scope ở database, vector, cache và object layer. | Negative cross-tenant test pass. |
| Execution | Thêm tool authorization, secret broker, queue limit và lease. | Load/failure test giữ isolation và fairness. |
| Observability | Tenant-aware trace access và redaction. | Operator điều tra được mà không overexpose. |
| Canary | Migrate một cohort tenant nhỏ. | Không có regression data, cost, latency khó giải thích. |

Quyết định quan trọng nhất là viết invariant vào code và tài liệu: **request không được khiến component đọc, ghi, execute, cache, trace hoặc bill resource ngoài tenant scope đã verify**. Khi viết như vậy, các khoảng trống sẽ dễ nhìn thấy hơn.

## Kết luận

Multi-tenancy thường được trình bày như một lựa chọn partition database. Với AI agent, nó rộng hơn. Model nhìn thấy context đã compile; tool nhìn thấy authority envelope; memory service nhìn thấy retrieval scope; worker nhìn thấy queue budget; finance system nhìn thấy attribution record. Mỗi lớp có thể giữ boundary hoặc âm thầm làm nó yếu đi.

Shared platform an toàn không phải platform có nhiều sơ đồ isolation nhất. Đó là platform có boundary rõ, được enforce bởi service độc lập, được test dưới retry và load, và có thể nhìn thấy khi incident xảy ra. Hãy share compute ở nơi an toàn. Tách credential, memory, policy, trace và effect ở nơi một lỗi có thể thay đổi blast radius.

Tenant boundary thành công khi platform trả lời được bằng evidence hai câu hỏi: **tenant này đã access gì, và nó chưa từng có authority access gì?**

## Tài liệu tham khảo

[1]: [AWS SaaS Lens — Tenant isolation strategies](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html)
[2]: [AWS Prescriptive Guidance — SaaS tenant isolation models](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-api-access-authorization/tenant-isolation.html)
[3]: [Do Quoc Viet — MCP is not an API wrapper](https://vietdoo.vndo.vn/blog/mcp-is-not-an-api-wrapper)
[4]: [Do Quoc Viet — Agent observability without data leaks](https://vietdoo.vndo.vn/blog/agent-observability-without-data-leaks)
