---
title: "Policy-as-Code cho AI Agent: Kiểm thử Authorization như Software"
description: "Playbook production biến yêu cầu authorization của AI agent thành policy có thể chạy, test, rollout an toàn và enforce rõ ràng trước mỗi tool call."
pubDate: 2026-01-02
category: "security"
image: "/blog/agent-policy-as-code-authorization-testing/hero.webp"
lang: "vi"
translationKey: "agent-policy-as-code-authorization-testing"
draft: false
---

![AI agent biến một quy tắc tenant thành policy được kiểm thử trước khi đi tới tool gateway](/blog/agent-policy-as-code-authorization-testing/hero.webp)

Incident nhìn giống một vụ rò rỉ dữ liệu, nhưng manh mối đầu tiên nhỏ hơn nhiều: một agent được phép gọi một tool mà không ai nhớ đã từng phê duyệt.

Lúc 14:06, một support agent nhận request từ khách hàng thuộc tenant `tenant_123`. Agent cần đọc subscription record và giải thích vì sao việc gia hạn bị lỗi. Lần đọc này hợp lệ. Khách hàng ở đúng account, role support có đúng scope và response không chứa dữ liệu bất thường.

Đến 14:08, chính agent đó thử export một danh sách customer record để “lấy thêm context”. Model không được yêu cầu export. Nó suy luận rằng dataset rộng hơn sẽ giúp xử lý case. Tool adapter chấp nhận request vì service credential về mặt kỹ thuật có thể gọi reporting endpoint. Query filter bị sai nên export trả về error trước khi tạo file.

Chúng tôi may mắn. Nhưng gọi đó là một request thất bại vô hại cũng là sai. Hệ thống đã vượt qua boundary quan trọng: một model suggestion đã biến thành một tool invocation được authorize mà không có policy decision đủ rõ để giải thích, kiểm thử hoặc rollback.

Không cần prompt injection. Không có provider outage. Model làm điều model thường làm: tìm một con đường để đi tới câu trả lời hữu ích. Application lại làm điều nguy hiểm hơn: coi capability là permission.

> **Luận điểm chính:** Yêu cầu authorization cho AI agent nên là policy có thể chạy và kiểm thử, không phải prose trong prompt, comment đặt cạnh tool hay convention không được ghi lại trong adapter. Model có thể đề xuất action; application code deterministic phải quyết định action đó có được phép hay không, ghi lại lý do, và mặc định từ chối khi bằng chứng chưa đầy đủ.

Bài này trình bày một pattern ở application level cho policy-as-code trong hệ thống agent có tool. OPA, Cedar và OpenFGA được dùng như các điểm tham chiếu hữu ích, không phải lời khuyên rằng team nào cũng phải chọn cùng một engine. Tài liệu OPA mô tả policy-as-code là các rule declarative được đánh giá từ structured input và tách decision khỏi enforcement. Framework testing của OPA cho thấy cả allow case lẫn deny case có thể trở thành regression check lặp lại được. Mô hình validation của Cedar nhắc một điều quan trọng: policy có thể đúng cú pháp nhưng vẫn tham chiếu sai type, action hoặc attribute, vì vậy thay đổi policy cần được validate theo schema trước khi đi vào authorization engine. Tài liệu authorization cho agent của OpenFGA cho thấy permission có scope và gắn với task quan trọng thế nào khi agent hành động thay user hoặc truy cập hệ thống bên thứ ba.

## Permission trong prompt không phải authorization decision

Một prompt có thể nói với agent: “Chỉ đọc customer record trong tenant hiện tại.” Instruction đó có thể giúp model cư xử tốt hơn. Nó không phải authorization control.

Model có thể hiểu sai instruction, nhận một tool description không đáng tin, làm mất tenant identifier trong lúc compact context, hoặc tạo một tool call hoàn toàn đúng format nhưng target nằm ngoài scope của user. Prompt không thể ngăn một code path khác gọi cùng tool. Nó không tạo ra audit record để operator kiểm tra. Nó không chứng minh được policy change không làm mất một deny rule.

Một authorization decision production nên được tạo từ một request envelope có cấu trúc. Ví dụ nhỏ này đủ để cho thấy khác biệt:

```json
{
  "subject": {
    "kind": "agent",
    "id": "support-agent-7",
    "acting_for": "user-204"
  },
  "action": "read",
  "resource": {
    "kind": "customer",
    "id": "cust-456",
    "tenant_id": "tenant-123"
  },
  "context": {
    "tenant_id": "tenant-123",
    "task_id": "task-91f2",
    "policy_version": "support-policy-12"
  }
}
```

Điều quan trọng không phải tên field cụ thể. Điều quan trọng là decision input phải đủ rõ để validate và replay. Application có thể hỏi subject có được bind với user hiện tại hay không, action có được biết hay không, resource có thuộc tenant hiện tại hay không, task còn hiệu lực hay không, và policy version nào đã tạo ra kết quả.

Một model message tự do như “Tôi sẽ tra customer ngay” không có bảo đảm nào trong số đó. Ngay cả structured tool call do model tạo ra cũng chỉ là proposal cho tới khi application evaluate nó.

## Bắt đầu từ decision contract

Trước khi chọn policy engine, hãy định nghĩa authorization decision trong hệ thống của bạn phải có nghĩa gì. Nhiều team nhảy thẳng vào viết rule vì rule có vẻ cụ thể. Contract mới là phần quan trọng hơn syntax.

Với AI agent, decision contract nên trả lời ít nhất những câu hỏi sau:

| Câu hỏi | Vì sao quan trọng | Ví dụ |
|---|---|---|
| Ai đang yêu cầu action? | Identity của agent không tự động là identity của user. | `support-agent-7` acting for `user-204` |
| Action nào đang được yêu cầu? | “Dùng CRM” quá rộng để authorize. | `customer.read` |
| Target là resource cụ thể nào? | Scope phải được evaluate với resource, không phải tool name chung chung. | `customer:cust-456` |
| Resource thuộc tenant, project hay account nào? | Boundary multi-tenant cần là input hạng nhất. | `tenant-123` |
| Action xảy ra trong task hoặc workflow nào? | Grant của một task không nên biến thành capability vĩnh viễn. | `task-91f2` |
| Context nào ảnh hưởng tới quyết định? | Time, environment, risk, approval và data classification có thể thay đổi kết quả. | `environment=production` |
| Deny có ý nghĩa vận hành gì? | Denial phải chặn side effect và trả recovery path có type rõ ràng. | `policy_denied` |
| Policy version nào đã quyết định? | Không có version thì replay và incident review chỉ là phỏng đoán. | `support-policy-12` |

Contract nên ổn định ngay cả khi model, tool provider hoặc policy implementation thay đổi. Model có thể đề xuất `customer.read`; tool adapter có thể chuyển request đó sang API riêng của provider; policy layer vẫn evaluate cùng action, resource và context.

Sự tách biệt này làm hệ thống dễ test hơn. Bạn có thể tạo request envelope mà không cần gọi model. Bạn có thể replay authorization decision mà không chạy lại cuộc trò chuyện với khách hàng. Bạn có thể so sánh hai policy version trên cùng một request set trước khi promote version mới.

## Deny-by-default không phải policy hoàn chỉnh, nhưng là điểm bắt đầu an toàn

Default-deny thường được nói như một khẩu hiệu. Trong thực tế, đó là một hành vi phải quan sát được ở mọi enforcement point.

Một policy tối thiểu hữu ích có ba phần:

1. Một vocabulary hữu hạn của action và resource đã biết.
2. Allow rule rõ ràng cho những điều product thật sự hỗ trợ.
3. Deny result rõ ràng cho input unknown, incomplete, expired hoặc contradictory.

Đây là ví dụ Rego-like cố ý nhỏ cho customer-support agent:

```rego
package agent.authz

default decision := {
  "allow": false,
  "reason": "default_deny"
}

decision := {
  "allow": true,
  "reason": "same_tenant_customer_read"
} if {
  input.action == "customer.read"
  input.subject.kind == "agent"
  input.resource.kind == "customer"
  input.resource.tenant_id == input.context.tenant_id
  input.context.task_id != null
  input.context.environment == "production"
}
```

Đây chưa phải security policy hoàn chỉnh. Nó chưa kiểm tra task có thuộc subject hay không, user có được đọc resource hay không, hoặc customer record có được phân loại là restricted hay không. Nó vẫn có giá trị vì làm cho điều kiện còn thiếu lộ ra. Một policy giả vờ hoàn chỉnh có thể che giấu nhiều rủi ro hơn một policy nhỏ nhưng mô tả rõ boundary của nó.

Default cũng phải bao phủ field bị thiếu. Nếu `tenant_id` biến mất trong một bước serialization, policy không được hiểu giá trị vắng mặt là giá trị không giới hạn. Nếu action là `customer.export` nhưng không rule nào mô tả nó, application không nên phát hiện permission chỉ vì có một tool tên gần giống.

Có khác biệt giữa authorization engine trả về deny decision và adapter bỏ qua decision đó. Cái đầu là policy outcome. Cái sau là bypass. Shared action gateway phải khiến một tool execution path không thể chạy nếu không có decision cho phép rõ ràng chính xác request envelope.

## Ưu tiên test deny case

Những authorization test hữu ích nhất thường là những test lẽ ra không bao giờ được pass.

Happy-path test chứng minh một workflow dự định có thể chạy. Negative test định nghĩa boundary. Nó nói rằng cross-tenant read phải tiếp tục bị deny, unknown tool không thể gọi chỉ vì model tự nghĩ ra tên, và task grant bị thiếu không được thừa hưởng permission cũ từ turn trước.

Tôi thường thiết kế request matrix trước khi viết allow rule cuối cùng:

| Subject | Action | Resource scope | Expected | Vì sao có case này |
|---|---|---|---|---|
| Support agent | `customer.read` | Cùng tenant | Allow | Tra cứu support hợp lệ. |
| Support agent | `customer.read` | Tenant khác | Deny | Boundary cô lập tenant cốt lõi. |
| Support agent | `customer.export` | Cùng tenant | Deny | Read capability không được tự động bao gồm export. |
| Unknown agent | `customer.read` | Cùng tenant | Deny | Identity phải được biết, không chỉ đúng shape. |
| Support agent | `unknown.tool` | Bất kỳ | Deny | Vocabulary của tool mặc định phải đóng. |
| Task đã hết hạn | `customer.read` | Cùng tenant | Deny | Permission không nên sống lâu hơn task. |
| Thiếu tenant context | `customer.read` | Không biết | Deny | Scope thiếu không được biến thành global scope. |
| Support agent | `customer.update` | Cùng tenant | Cần policy mạnh hơn | Read và write thuộc hai risk class khác nhau. |

![Ma trận test policy vẽ tay thể hiện allow path, deny path, unknown tool, grant hết hạn và tenant context bị thiếu](/blog/agent-policy-as-code-authorization-testing/policy-test-matrix.webp)

Tên action sẽ khác tùy hệ thống, nhưng hình dạng của matrix rất bền vững. Mỗi test cung cấp một input hoàn chỉnh và assert cả decision lẫn reason. Test không chỉ nên hỏi “rule nào đó có match không”; nó phải nói rõ safety property mà product đang phụ thuộc.

Một test theo kiểu OPA có thể trông như sau:

```rego
package agent.authz_test

import data.agent.authz

test_same_tenant_customer_read_allowed if {
  authz.decision with input as {
    "action": "customer.read",
    "subject": {"kind": "agent", "id": "support-agent-7"},
    "resource": {"kind": "customer", "tenant_id": "tenant-123"},
    "context": {
      "tenant_id": "tenant-123",
      "task_id": "task-91f2",
      "environment": "production"
    }
  }
  decision.allow
}

test_cross_tenant_customer_read_denied if {
  decision := authz.decision with input as {
    "action": "customer.read",
    "subject": {"kind": "agent", "id": "support-agent-7"},
    "resource": {"kind": "customer", "tenant_id": "tenant-999"},
    "context": {
      "tenant_id": "tenant-123",
      "task_id": "task-91f2",
      "environment": "production"
    }
  }
  not decision.allow
  decision.reason == "default_deny"
}

test_export_is_not_implied_by_read if {
  decision := authz.decision with input as {
    "action": "customer.export",
    "subject": {"kind": "agent", "id": "support-agent-7"},
    "resource": {"kind": "customer", "tenant_id": "tenant-123"},
    "context": {
      "tenant_id": "tenant-123",
      "task_id": "task-91f2",
      "environment": "production"
    }
  }
  not decision.allow
}
```

Tài liệu OPA mô tả test rule với prefix `test_` và command `opa test` để chạy chúng. Engine cụ thể ít quan trọng hơn thói quen: mọi authorization change nên tạo ra một diff trong executable test, và CI phải fail khi deny boundary biến mất.

Đừng xem một test run rỗng là thành công. Package bị rename, path sai hoặc test selector đánh máy nhầm có thể tạo một build màu xanh nhưng thực tế không chạy test nào. Command test và CI wrapper nên fail khi test set kỳ vọng là rỗng; kết quả cũng nên được export ở dạng machine-readable cho release system.

## Schema validation bắt một nhóm lỗi khác

Policy có thể sai về logic dù toàn bộ test đều pass. Nó cũng có thể sai về cấu trúc trước khi request đầu tiên xuất hiện.

Giả sử rule tham chiếu `customer.tenantId`, còn application gửi `customer.tenant_id`. Rule có thể chỉ đơn giản là không bao giờ match. Giả sử action trong schema là `customer.read`, nhưng một policy file lại ghi `customer.read_record`. Policy trông hợp lý trong code review nhưng sẽ trở thành dead logic khi chạy production.

Tài liệu validation của Cedar làm rõ khác biệt này. Policy có thể đúng theo syntax nhưng chứa typo, undefined attribute hoặc phép so sánh không hợp lệ. Cedar dùng schema mô tả entity type, attribute, relationship, action và type của các thành phần trong request để validate policy trước khi authorization engine sử dụng nó.

Điều đó gợi ý một bộ kiểm tra ba lớp:

| Lớp | Câu hỏi | Lỗi thường bắt được |
|---|---|---|
| Parse | Policy có đúng ngôn ngữ hay không? | Syntax hỏng, rule có shape sai. |
| Schema | Policy có tham chiếu action và entity thật của application không? | Action đánh máy sai, attribute sai type, relationship bị thiếu. |
| Behavior | Với request đại diện, policy có tạo ra decision đúng ý định không? | Cross-tenant allow, grant hết hạn vẫn được nhận, read tự động thành export. |

Ba lớp nên chạy theo thứ tự đó, nhưng không nên gộp thành một check duy nhất. Parser không biết rule có quá rộng hay không. Schema validator không biết business muốn deny action nào. Happy-path behavior test không thể chứng minh mọi deny case lân cận vẫn bị từ chối.

Hãy coi policy input như một versioned API. Nếu application đổi request envelope, policy schema và behavior suite cũng phải đổi trong cùng review. Nếu action vocabulary thay đổi, policy cũ cần được revalidate trước khi tiếp tục active.

## Model đề xuất; application enforce

Enforcement boundary phải hiện rõ trên architecture, không được chỉ ngầm hiểu rằng framework là đáng tin.

Một request path an toàn trông như sau:

```text
user intent
   -> model đề xuất tool call
   -> adapter normalize proposal thành request envelope
   -> application validate shape và scope
   -> policy engine trả allow hoặc deny
   -> gateway ghi lại decision
   -> tool chỉ chạy sau explicit allow
```

![Ranh giới enforcement vẽ tay tách model output không đáng tin khỏi policy decision của application trước khi tool tạo side effect](/blog/agent-policy-as-code-authorization-testing/enforcement-boundary.webp)

Model output không phải authority. Tool description không phải authority. Một call từng được allow không phải authority cho resource khác. Decision phải được tạo lại lúc application sắp vượt qua side-effect boundary.

Một TypeScript gateway có thể cố ý giữ sự nhàm chán:

```typescript
type AuthorizationRequest = {
  subject: { kind: "agent"; id: string; actingFor?: string };
  action: string;
  resource: { kind: string; id: string; tenantId?: string };
  context: {
    tenantId?: string;
    taskId?: string;
    policyVersion: string;
    environment: "development" | "staging" | "production";
  };
};

type PolicyDecision =
  | { allow: true; reason: string; policyVersion: string }
  | { allow: false; reason: string; policyVersion: string };

async function executeTool(
  request: AuthorizationRequest,
  tool: (input: AuthorizationRequest) => Promise<unknown>,
): Promise<unknown> {
  const shape = validateRequestShape(request);
  if (!shape.ok) {
    throw new PolicyDenied("invalid_request", request.context.policyVersion);
  }

  const decision = await policyEngine.evaluate(request);
  await recordDecision({ request, decision });

  if (!decision.allow) {
    throw new PolicyDenied(decision.reason, decision.policyVersion);
  }

  return tool(request);
}
```

Code này không làm policy tự nhiên trở nên đúng. Nó làm enforcement point khó bị bỏ quên. Gateway nên được dùng chung cho direct tool call, delegated agent call, scheduled run, recovery path và administrative replay. Nếu một path có thể đi tới side effect mà không qua gateway, policy ở path đó chỉ là lời khuyên.

Tool adapter vẫn cần input validation riêng. Authorization hỏi action có được phép không; validation hỏi request có thể được execute an toàn không. Cả hai nên chạy trước side effect. Không lớp nào nên giả định lớp kia đã kiểm tra mọi thứ.

## Policy decision cần explainable, nhưng không cần lộ private reasoning

Audit record không cần chain-of-thought transcript. Nó cần đủ bằng chứng để giải thích decision và reproduce input theo cách an toàn.

Một record có ý thức về privacy có thể gồm:

```json
{
  "decision_id": "dec-78c1",
  "task_id": "task-91f2",
  "subject_id": "support-agent-7",
  "acting_for": "user-204",
  "action": "customer.read",
  "resource_kind": "customer",
  "resource_id_hash": "sha256:...",
  "tenant_id": "tenant-123",
  "policy_version": "support-policy-12",
  "input_schema_version": "authz-request-v4",
  "decision": "deny",
  "reason": "scope_mismatch",
  "enforcement_point": "tool-gateway",
  "created_at": "2026-01-02T14:08:13Z"
}
```

Identifier cụ thể phụ thuộc vào yêu cầu retention và privacy. Nguyên tắc là ghi lại decision input cần thiết nhưng tránh tạo thêm bản sao của sensitive payload. Reason như `scope_mismatch`, `task_expired` hoặc `unknown_action` hữu ích hơn `false`, nhưng cũng không nên tiết lộ thông tin mà requester không được phép biết.

Hãy tách user-facing message khỏi internal reason. Operator có thể cần policy version và field bị fail; customer có thể chỉ cần nghe: “Tôi có thể đọc record trong workspace của bạn, nhưng không thể truy cập workspace kia.” Recovery language rõ ràng sẽ giảm áp lực phải thêm nút “retry với quyền rộng hơn”.

## Coi policy change như production code

Phiên bản đầu của policy-as-code thường là một file trong repository. Phiên bản thứ hai cần có lifecycle.

Một policy pull request hữu ích nên cho thấy nhiều hơn rule được thêm. Nó phải khiến authorization change có thể review:

| Review artifact | Nó trả lời câu hỏi gì |
|---|---|
| Policy diff | Điều kiện allow hoặc deny nào đã đổi? |
| Schema diff | Action hoặc entity contract có đổi không? |
| Positive test diff | Workflow mới nào được kỳ vọng sẽ pass? |
| Negative test diff | Boundary nào bắt buộc vẫn deny? |
| Decision replay | Policy cũ và mới khác nhau thế nào trên cùng request set? |
| Rollout plan | Policy mới sẽ chạy ở đâu trước? |
| Rollback pointer | Policy version tốt trước đó có thể restore bằng cách nào? |

Policy version nên immutable sau khi promote. Nếu rule đổi, tạo version mới và giữ version cũ đủ lâu để giải thích historical decision. “Policy v12” phải luôn có một nghĩa duy nhất trong incident report, kể cả khi file human-readable sau này được sắp xếp lại.

Policy diff cũng cần semantic review. Một thay đổi một dòng từ `read` thành `read | export` có thể rất nhỏ trên màn hình nhưng lại mở rộng capability nhạy cảm nhất của product. Review system nên làm rõ action-set expansion, nhất là khi rule đổi từ resource-specific condition thành tool-wide condition.

## Shadow evaluation giúp quan sát change trước khi nó có authority

Policy mới không nên lập tức điều khiển mọi agent chỉ vì test pass. Test bao phủ các ví dụ đã biết; production traffic cho thấy những kết hợp task, tenant, resource và model behavior mà team không nghĩ tới.

Shadow evaluation chạy candidate policy bên cạnh active policy nhưng không cho candidate thay đổi outcome. Với mỗi request đủ điều kiện, hệ thống ghi lại candidate sẽ trả cùng decision, strict hơn hay permissive hơn so với active policy.

Comparison nên có risk awareness:

| Candidate result | Active result | Diễn giải | Phản hồi mặc định |
|---|---|---|---|
| Allow | Allow | Không thấy behavior change. | Tiếp tục sampling. |
| Deny | Deny | Boundary hiện tại vẫn còn. | Tiếp tục sampling. |
| Deny | Allow | Candidate strict hơn. | Review user impact và recovery UX. |
| Allow | Deny | Candidate permissive hơn. | Chặn promotion cho tới khi giải thích được. |
| Error | Bất kỳ | Candidate không quyết định đáng tin cậy. | Fail closed với protected action. |

Đừng biến shadow mode thành lý do để expose sensitive data cho candidate engine. Redact hoặc hash field không cần cho decision, và chắc chắn shadow evaluator không thể execute tool. Shadow mode chỉ quan sát decision, không tạo side-effect path thứ hai.

Candidate comparison cũng cần stable replay corpus. Hãy đưa vào đó production-shaped request gần đây, negative case được tạo có chủ đích và case từ incident cũ. Corpus cần versioned và privacy-safe. Nếu request set chỉ có example thành công, policy có thể permissive hơn mà không ai nhận ra.

## Rollout với promotion gate, không phải global switch

Policy là code, nhưng nó cũng là control plane cho action thật. Rollout an toàn cần một promotion gate rõ ràng.

![Rollout policy vẽ tay đi từ version 12 qua semantic diff, shadow evaluation, promotion gate, canary 5% và rollback](/blog/agent-policy-as-code-authorization-testing/policy-rollout-diff.webp)

Một sequence thực tế có thể là:

1. **Validate.** Parse policy, validate theo request schema, reject action hoặc entity field không biết.
2. **Test.** Chạy positive, negative, boundary, property-based và replay test. Fail nếu test suite kỳ vọng là rỗng.
3. **Shadow.** So sánh candidate với active version trên corpus cố định và một sample live request đã được bảo vệ privacy.
4. **Review.** Yêu cầu human xem xét mọi high-impact action mới được allow và mọi deny boundary bị xóa.
5. **Canary.** Áp dụng candidate cho một cohort nhỏ, xác định được, gồm low-risk task hoặc agent.
6. **Promote.** Chỉ tăng exposure khi decision parity, denial reason, latency và recovery UX đạt ngưỡng.
7. **Rollback.** Giữ policy version trước đó để restore bằng một thay đổi đơn bước có audit.

Canary cohort nên đủ sticky để cùng workflow không nhảy qua lại giữa hai policy version ở giữa task. Long-running task hoặc phải pin policy version một cách có chủ ý, hoặc phải reauthorize tại boundary đã định khi version thay đổi. Lựa chọn nào cũng phải rõ ràng; trộn decision từ hai version một cách im lặng sẽ làm incident khó reconstruct.

Promotion gate nên theo dõi nhiều hơn error rate. Policy có thể hoàn toàn khỏe về mặt kỹ thuật nhưng deny mọi request, hoặc có denial rate thấp trong khi cho phép một path nguy hiểm mới. Hãy theo dõi hình dạng của decision:

| Metric | Nó cho biết điều gì |
|---|---|
| Allow và deny rate theo action | Rule thay đổi nhiều traffic hơn dự kiến hay không. |
| Newly allowed request count | Candidate có mở rộng access hay không. |
| Deny reason distribution | Missing context hoặc scope mismatch có tăng không. |
| Policy evaluation latency | Gate có trở thành bottleneck nhìn thấy được với user không. |
| Decision error rate | Policy engine hoặc input contract có khỏe không. |
| Bypass attempts | Có path nào cố execute mà không có authorization record không. |
| Recovery completion rate | User bị deny có thể hoàn thành task hợp lệ an toàn không. |

## Các failure mode thường gặp

Policy-as-code không tự động tạo ra authorization tốt. Nó chỉ tạo một nơi để sai lầm lộ ra sớm hơn.

### Policy kiểm tra tool, không kiểm tra target

Rule kiểu “support agent được dùng `crm.search`” nói rất ít về tenant, field hoặc search mode nào được phép. Hãy authorize cặp action-resource cùng context liên quan. Tool name là implementation detail, không phải business permission.

### Policy tin context do model cung cấp

Nếu model được phép tự set `tenant_id` trong request, nó có thể tạo request có vẻ đúng scope nhưng không chứng minh tenant đó thuộc user hoặc task. Context nên được derive từ authenticated application state nếu có thể, rồi truyền vào policy engine như trusted input.

### Một allow rule tự động cho quá nhiều quyền

Read rule không được âm thầm grant export, bulk search, write hoặc delete. Dùng action vocabulary đóng và test rõ các action lân cận. Capability expansion phải hiện ra trong review.

### Deny bị biến thành retry

Policy denial không phải transient tool failure. Retry cùng request và chỉ đổi wording sẽ tạo noise, thậm chí biến boundary rõ ràng thành brute-force search để tìm allow path. Retry phải cần authority mới, scope mới, task grant mới hoặc recovery step có user nhìn thấy.

### Policy evaluation xảy ra quá sớm

Workflow có thể được authorize lúc bắt đầu và execute sau khi user, tenant, task hoặc resource đã đổi. Với tool high-impact, hãy evaluate lại tại action boundary. Long-running workflow có thể cần decision mới sau approval, escalation hoặc context change.

### Test chỉ có happy path

Một test suite xanh nhưng không có cross-tenant, missing-field, expired-grant, unknown-action hoặc malformed-input case không phải bằng chứng policy an toàn. Negative case không phải coverage thêm; nó là định nghĩa của boundary.

### Policy engine trở thành side service có thể bypass

Nếu một tool adapter gọi engine còn adapter khác gọi provider trực tiếp, authorization đã không nhất quán theo thiết kế. Đặt shared gateway trước side effect và không cho model-facing code giữ provider credential trực tiếp.

## Checklist production ngắn gọn

Trước khi cho agent execute một tool call, hãy hỏi:

| Câu hỏi | Bằng chứng cần có |
|---|---|
| Model output còn chỉ là proposal không? | Request envelope được application code normalize. |
| Action thuộc vocabulary đóng và có version không? | Schema validation và unknown-action denial. |
| Resource cụ thể đã được xác định chưa? | Resource kind, stable ID, tenant/account scope. |
| Authority được derive từ trusted state chưa? | Authenticated subject, task grant và server-owned context. |
| Field thiếu hoặc mâu thuẫn có fail-closed không? | Negative test cho input absent, null, malformed và conflicting. |
| Read và export có permission riêng không? | Action-level rule rõ và deny case lân cận. |
| Chỉ có một enforcement gateway không? | Mọi side-effect path đi qua cùng decision boundary. |
| Policy change có replay được không? | Immutable version, decision record và fixed request corpus. |
| Change đã shadow-test và canary chưa? | Candidate comparison, promotion gate và rollback pointer. |
| User có recover được sau denial không? | Typed reason, explanation an toàn và next step hợp lệ. |

Câu hỏi trung tâm không phải “Agent có chọn đúng tool không?” mà là: “Application có chứng minh được subject, action, resource và context chính xác này được phép ở thời điểm tool có thể làm thay đổi thế giới hay không?”

## Lời kết

AI agent khiến authorization có vẻ linh hoạt một cách đánh lừa. Một người có thể hiểu “giúp với customer này” là “đọc record trong account hiện tại”. Model có thể hiểu cùng mục tiêu đó là quyền search rộng hơn, export report hoặc gọi tool bên cạnh vì thấy hữu ích.

Giải pháp không phải viết prompt dài hơn rồi hy vọng boundary sống sót qua mọi context window. Hãy đưa boundary vào code có thể parse, validate, test, review, observe và rollback.

Một policy-as-code system tốt không phải system deny mọi thứ lạ. Đó là system làm cho điều lạ trở nên rõ ràng. Nó cho action hợp lệ một đường đi hẹp để thành công, cho action nguy hiểm một điểm dừng deterministic, và cho engineer bằng chứng khi rule làm thay đổi behavior.

Agent vẫn có thể sáng tạo bên trong task. Quyền vượt qua side-effect boundary nên tiếp tục thật nhàm chán.

## Đọc tiếp trong series production AI

Về identity, delegation và revocation của agent, xem [AI Agent Identity không phải User ID](/blog/agent-identity-delegation-revocation/). Về capability contract của tool giữa các provider, xem [Contract Testing cho AI Tool](/blog/ai-tool-contract-testing/). Về boundary của human approval, xem [Human-in-the-Loop không phải nút Approve](/blog/human-in-loop-action-gate-consent-fatigue/). Về data boundary trước inference, xem [Context Firewall](/blog/context-firewall-pre-inference-data-governance/).

## References

[1]: https://www.openpolicyagent.org/docs "Open Policy Agent — Official Documentation"
[2]: https://www.openpolicyagent.org/docs/policy-testing "Open Policy Agent — Policy Testing"
[3]: https://docs.cedarpolicy.com/policies/validation.html "Cedar — Policy validation"
[4]: https://openfga.dev/docs/modeling/agents "OpenFGA — Authorization for Agents"
