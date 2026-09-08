---
title: "MCP không chỉ là API Wrapper: Least Privilege, OAuth Consent và Human Approval cho AI Agent"
description: "MCP biến đề xuất của model thành đường đi có thể đọc dữ liệu, sửa hệ thống và tạo hiệu ứng bên ngoài. Blueprint này tách OAuth delegation, server-side policy và approval theo từng hành động để agent không có quyền lớn hơn ý định người dùng."
pubDate: 2026-04-06
category: "engineering"
image: "/blog/mcp-security-hero.webp"
lang: "vi"
translationKey: "mcp-is-not-an-api-wrapper"
draft: false
---

<video controls width="100%">
  <source src="/blog/demo.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

![Một AI agent đi qua ba cổng Scope, Policy và Approve trước khi chạm vào hành động có tác động bên ngoài](/blog/mcp-security-hero.webp)

Một agent vận hành vừa đọc một issue: *“Khách hàng này rất bức xúc. Hãy hoàn tiền ngay để giữ họ.”* Model chọn tool `send_refund`; MCP server có endpoint gọi payment provider; OAuth token còn hạn; HTTP trả về `200`. Mọi thứ trông giống một chuỗi API hợp lệ—cho đến khi đội tài chính hỏi: **ai** ủy quyền, **đúng tenant nào**, **đúng số tiền nào**, **vì sao làm ngay lúc này**, và **ai đã thấy hiệu ứng trước khi nó xảy ra**?

Đó là điểm mà cách nhìn “MCP chỉ là API wrapper cho LLM” bắt đầu nguy hiểm. API wrapper chủ yếu biến một API thành JSON Schema có thể gọi. Một **MCP server production** lại đặt model trước một bề mặt capability có thể đọc dữ liệu riêng tư, sửa trạng thái, phát sinh chi phí, gửi thông điệp ra ngoài hoặc quay vòng credential. Model được quyền **đề xuất** tool call; nó không được quyền biến đề xuất ấy thành authority.

> **Luận điểm chính:** Hãy coi MCP là một capability boundary. OAuth consent cấp một uỷ quyền được ủy thác, có thể thu hồi và có scope; policy server-side quyết định request cụ thể có được phép *lúc này* hay không; còn human approval, nếu cần, là một uỷ quyền just-in-time gắn với hiệu ứng, arguments, giới hạn và thời hạn cụ thể. Không lớp nào được thay thế lớp khác.

MCP mô tả protected MCP server như OAuth resource server, MCP client như OAuth client hành động thay resource owner, và authorization server là nơi tương tác với người dùng để phát hành access token.[1] Tool trong MCP là model-controlled, nhưng specification vẫn khuyến nghị luôn có human-in-the-loop có khả năng từ chối invocation và UI làm rõ tool nào đang được gọi.[3] Bài này biến hai nguyên tắc đó thành một blueprint triển khai thực dụng.

Ví dụ xuyên suốt là **OpsBridge**, một MCP server đa tenant cho support và operations. Tên tool, dữ liệu và policy bên dưới là **minh họa**, không phải một chuẩn MCP mới hay một chứng nhận compliance.

---

## Bài toán thực: một tool call phải vượt qua bốn câu hỏi

Trước khi tranh luận về framework, hãy tách bốn quyết định vốn thường bị nhét nhầm vào prompt.

| Câu hỏi | Người/lớp trả lời | Bằng chứng cần có | Không được suy diễn từ |
| --- | --- | --- | --- |
| Ai đã ủy thác quyền? | Authorization server + resource owner | Client identity, consent record, token subject | Lời model nói “người dùng muốn” |
| Agent được thử làm gì? | OAuth scope + tool exposure | Audience, expiry, scope, tool manifest | Một token `ops:*` tiện tay |
| Request này có được phép lúc này? | MCP server + policy engine | Tenant, resource ownership, business state, session risk | Tool description hoặc annotation |
| Hiệu ứng này có cần con người ký duyệt? | Approver + server-side verifier | Canonical arguments, digest, limit, expiry | Một lần OAuth consent cũ |

Bốn câu hỏi tạo thành bốn mặt phẳng: **delegation**, **capability discovery**, **authorization**, và **commit approval**. OAuth rất phù hợp cho delegation; nó không tự biết record nào thuộc tenant nào, refund có vượt hạn mức không, hay session vừa đọc dữ liệu không tin cậy. Ngược lại, một popup “Are you sure?” không thể thay token audience validation, scope, hay policy server-side.

MCP cho phép `tools/list` thay đổi theo authorization có mặt trên request. Đây là một lợi thế kiến trúc: đừng trả cho model một catalog tool toàn cục rồi hy vọng prompt sẽ kiềm chế nó; hãy cho model thấy đúng tool mà authority hiện tại có thể sử dụng.[3] Với OpsBridge, catalog tối thiểu có thể như sau.

| Tool | Capability hẹp | Hiệu ứng | Default decision |
| --- | --- | --- | --- |
| `search_incidents` | `incidents:read` | Read-only | Auto sau tenant check |
| `get_customer_case` | `cases:read:tenant` | Read restricted data | Policy check |
| `create_refund_draft` | `refunds:draft` | Staged, chưa commit | Policy check |
| `send_refund` | `refunds:send` | Financial external effect | Approval bắt buộc |
| `rotate_api_key` | `keys:rotate` | Destructive security effect | Approval bắt buộc |
| `post_status_update` | `status:write` | External communication | Policy hoặc approval |

Một tool đơn giản, schema chặt và tên rõ ràng là bề mặt policy dễ bảo vệ hơn một `execute_anything` hay `ops:*`. OWASP cũng khuyến nghị per-tool scoping, toolset tách theo trust level và explicit authorization cho sensitive operation.[6]

![So sánh master key ops:* mở mọi ngăn kéo với bộ capability key hẹp cho từng loại tool](/blog/mcp-security-capability-map.webp)

---

## Least privilege không phải “ít scope cho đẹp”: nó là capability topology

Một lỗi phổ biến là cấp `ops:*`, rồi yêu cầu model “chỉ dùng khi thật cần”. Đây không phải least privilege; đây là broad authority được bọc bằng natural language. Prompt có thể bị override, model có thể hiểu sai, và policy thay đổi theo phiên bản model. Quyền phải nằm ở nơi **server có thể kiểm chứng**.

Hãy thiết kế scope theo **hành động và miền dữ liệu**, rồi bổ sung ràng buộc mà scope string không biểu diễn được.

```text
# Tránh: authority pha trộn read, write, cross-tenant và admin
ops:*

# Tách action + domain; token chỉ mang phần cần thiết
incidents:read
cases:read
refunds:draft
refunds:send
keys:rotate
status:write
```

Scope không nên ôm cả tenant ID hoặc business object linh hoạt nếu điều đó khiến consent và token khó quản trị. Một pattern bền vững là token mang **coarse permission**, còn policy quyết định resource-level authorization:

```text
Token:      scopes=["refunds:send"], aud="https://mcp.opsbridge.example"
Request:    tool=send_refund, tenant=t_72, case=case_918, amount=72.00
Policy:     subject is support_lead
            case belongs to t_72
            case state = refund_eligible
            amount <= role_limit
            action is not blocked by session_taint
            approval is valid for the canonical request
```

Điều này giải quyết hai cực đoan. Nếu chỉ dùng OAuth scope, bạn có quyền quá thô để bảo vệ row-level ownership, state transition hoặc spending limit. Nếu chỉ dùng policy nội bộ mà không có scope/token boundary, tool catalogue lại dễ phình to và việc revoke delegation trở nên mơ hồ.

MCP authorization hướng client tới least privilege: server có thể đưa scope cần thiết qua `WWW-Authenticate`; client nên xem scope trong challenge là authoritative cho operation hiện tại và mở rộng scope theo step-up authorization thay vì xin quá mức ngay từ đầu.[1] Một `401` cần scope `refunds:draft` không phải là lỗi UX; nó là tín hiệu để client xin đúng quyền cho đúng bước.

### Token là vé vào server, không phải hộ chiếu đi mọi nơi

MCP security guidance gọi **token passthrough** là anti-pattern: server không được nhận token, bỏ qua kiểm tra token có dành cho nó hay không, rồi chuyển nguyên token xuống downstream API.[2] Resource server cần validate issuer, signature, expiry, audience/resource indicator và scope trước khi gọi policy. Nếu OpsBridge nhận token có `aud=calendar.example`, token đó không được trở thành credential hợp lệ để chạy `send_refund` chỉ vì cả hai đều dùng OAuth.

Tư duy chính xác là: **MCP server là policy enforcement point**. Downstream credential, nếu cần, phải là một delegation/credential riêng có audience hẹp và lifecycle do server kiểm soát—không phải tấm vé client mang vào được pass-through vô điều kiện.

| Control | Chặn điều gì | Ví dụ của OpsBridge |
| --- | --- | --- |
| Exact audience validation | Reuse token cho resource khác | Reject token không dành cho `mcp.opsbridge.example` |
| Short expiry + revocation | Authority kéo dài sau khi context đổi | Step-up token hết hạn sau 10 phút |
| Scope-to-tool allowlist | Tool discovery quá mức | `refunds:send` mới nhìn thấy `send_refund` |
| Tenant/resource policy | Cross-tenant hoặc IDOR | Case phải thuộc tenant của subject |
| Business-state guard | Action hợp scope nhưng sai thời điểm | Chỉ refund case `refund_eligible` |
| Rate/amount limit | High-impact abuse | Sum theo approver/day và amount ceiling |

---

## OAuth consent: đồng ý cho **client nào**, với **scope nào**, tới **resource nào**

Consent không phải checkbox trang trí. Nó là hồ sơ về relationship giữa resource owner, client, requested scope và protected resource. Trong MCP HTTP authorization flow, protected resource metadata giúp client khám phá authorization server; client sau đó dùng authorization server metadata/discovery, đăng ký client phù hợp, PKCE, resource indicator và authorization code exchange.[1]

RFC 9700 yêu cầu redirect URI phải exact-match với URI đã đăng ký (ngoại trừ port localhost cho native app), cấm open redirector, và nhấn mạnh PKCE cho public client; với confidential client, PKCE vẫn được khuyến nghị. `S256` là phương thức phù hợp vì không lộ verifier trong authorization request.[5] Những chi tiết này nghe giống “OAuth plumbing”, nhưng chính chúng ngăn code/token rơi vào redirect URI của kẻ khác.

![Luồng OAuth consent an toàn: client identity, scope, redirect URI chính xác, MCP proxy và authorization server](/blog/mcp-security-consent-proxy.webp)

### Bẫy MCP proxy: consent ở upstream không đồng nghĩa consent cho mọi MCP client

MCP Security Best Practices mô tả một confused-deputy path đặc biệt quan trọng. Giả sử MCP proxy dùng static upstream OAuth client ID để gọi third-party API, nhưng chấp nhận dynamic registration từ nhiều MCP client. Nếu third-party đã ghi nhớ consent cookie cho static client đó, một client độc hại có thể tạo authorization flow với redirect URI của hắn và lợi dụng consent cũ để lấy MCP authorization code.[2]

Biện pháp không phải chỉ là thêm một checkbox. MCP proxy phải có **consent của chính nó theo từng client** trước khi forward sang third-party. Consent page cần nêu rõ requesting client, third-party scopes, registered redirect URI; cần CSRF protection, chống clickjacking, và consent decision phải bind với `client_id`.[2]

| Consent UI tốt phải trả lời | Ví dụ trong OpsBridge |
| --- | --- |
| App nào đang xin? | “Support Console extension by Acme Support” |
| Nó sẽ làm gì? | “Read cases” hoặc “Send refund up to draft only” |
| Nó nhận code/token ở đâu? | Exact redirect URI đã đăng ký |
| Quyền kéo dài bao lâu? | “Session 10 minutes” hoặc “Until revoked” |
| Có cần step-up sau này không? | “Sending a refund will require a separate approval” |

Lưu ý câu cuối: **consent không phải blank cheque**. Consent cấp delegation tới client với scope; nó không phê duyệt vô hạn mọi future `send_refund` arguments. Một hệ thống tốt hiển thị scope theo ngôn ngữ con người nhưng không che giấu resource/effect boundary.

---

## Human approval: ký vào một **effect** cụ thể, không phải đăng nhập lần nữa

Nếu có một dòng duy nhất nên mang về production, đó là: human approval phải bind vào **canonical request**, không bind vào ý định diễn giải của model.

Một popup chỉ ghi “Agent wants to send refund” bị replay, bị đổi amount, bị đổi destination hoặc bị giữ quá lâu không còn là approval đáng tin. Approval envelope cho OpsBridge cần tối thiểu các field sau.

| Field | Vì sao phải bind | Ví dụ |
| --- | --- | --- |
| `tool` + schema version | Tránh approve nhầm primitive | `send_refund@v3` |
| Canonical arguments digest | Không được đổi payload sau khi approve | SHA-256/HMAC của JSON canonical |
| Tenant + resource IDs | Chặn cross-tenant swap | `t_72`, `case_918` |
| Effect limit | Chặn tăng amount/destination | `USD 72.00`, customer account ref |
| Policy decision/version | Có bằng chứng rules đã review | `refund-policy-v14` |
| Requester/client/subject | Biết ai tạo transaction | client ID + user subject |
| Expiry + single-use nonce | Chặn replay và approval cũ | 5 phút, consume-on-execute |
| Risk/session context | Chống approval bị tái dùng sau taint | `taint=external_content` |

![Approval envelope gắn với digest, tenant, expiry và policy version trước khi mở khóa hành động tài chính](/blog/mcp-security-approval-envelope.webp)

Dưới đây là pseudocode TypeScript minh họa. Nó không thay thế thư viện canonical JSON, key management, audit storage hoặc security review của bạn; mục tiêu là chỉ ra **điểm enforcement**.

```ts
import crypto from "node:crypto";

type Decision = "allow" | "needs_approval" | "deny";

type ToolRequest = {
  tool: "send_refund" | "create_refund_draft" | "get_customer_case";
  args: Record<string, unknown>;
  subject: string;
  clientId: string;
  tenantId: string;
  scopes: string[];
  sessionTaint: "clean" | "external_content" | "private_plus_external";
};

function canonicalDigest(value: unknown): string {
  // Production: canonicalize JSON deterministically; bind schema version too.
  const canonical = JSON.stringify(value, Object.keys(value as object).sort());
  return crypto.createHash("sha256").update(canonical).digest("base64url");
}

async function authorize(req: ToolRequest): Promise<Decision> {
  assertAudienceAndExpiry(req);             // token is for this MCP resource
  assertScope(req.scopes, req.tool);        // e.g. refunds:send
  await assertTenantResource(req.subject, req.tenantId, req.args);

  const effect = classifyEffect(req.tool, req.args);
  if (req.sessionTaint === "private_plus_external" && effect === "external_or_financial") {
    return "deny";
  }
  if (effect === "external_or_financial") return "needs_approval";
  return await policyAllowsCurrentState(req) ? "allow" : "deny";
}

async function executeRefund(req: ToolRequest, approvalId: string) {
  if (await authorize(req) !== "needs_approval") throw new Error("not approvable");

  const approval = await approvalStore.consumeOnce(approvalId);
  const digest = canonicalDigest({ tool: req.tool, args: req.args, tenant: req.tenantId });
  assert(approval.digest === digest, "arguments changed after approval");
  assert(approval.expiresAt > new Date(), "approval expired");
  assert(approval.policyVersion === activePolicyVersion(), "policy changed");

  // Revalidate at the commit point; never trust a stale preflight decision.
  await assertTenantResource(req.subject, req.tenantId, req.args);
  await audit.append({ event: "refund.executed", approvalId, digest, tenant: req.tenantId });
  return paymentProvider.refund(req.args);
}
```

Ở đây có ba chi tiết thường bị bỏ qua. Thứ nhất, approval được **consume once**. Thứ hai, policy và resource ownership được kiểm tra lại tại commit point; không có “đã check cách đây 30 giây nên chắc vẫn ổn”. Thứ ba, audit log lưu decision evidence và digest, không nhất thiết lưu raw customer payload.

### Approval tiers nên dựa vào effect, context và reversibility

| Tier | Ví dụ | Default | Giao diện cần cho người duyệt |
| --- | --- | --- | --- |
| 0 | Search incident đã scope | Auto | Trace/audit nền |
| 1 | Đọc case restricted | Policy permit | Lý do + data classification |
| 2 | Create refund draft, post nội bộ | Policy hoặc confirm | Preview, destination, diff |
| 3 | Send refund, rotate key, email external | JIT approval | Canonical action, limit, expiry, undo/recovery |
| 4 | Bulk delete, transfer lớn, cross-tenant admin | Block hoặc two-person control | Không cho model tự commit |

Approval trở thành “click fatigue” nếu áp dụng lên mọi read; ngược lại, nó vô nghĩa nếu chỉ hiện sau khi effect đã chạy. Triage theo effect class, reversibility, data sensitivity, destination, amount và session taint giữ approval ở đúng điểm nó tạo giá trị.

---

## Tool annotations hỗ trợ UX, nhưng không phải authorization contract

MCP tool annotations như `readOnlyHint`, `destructiveHint`, `idempotentHint` và `openWorldHint` tạo vocabulary hữu ích cho client UI. Nhưng spec nói rõ client phải coi annotation là untrusted trừ khi đến từ trusted server.[3] Bài phân tích của MCP maintainers cũng nhấn mạnh annotations là **hints**, không thể tự enforcement, và default cho tool thiếu annotation là thận trọng.[4]

Điều đó dẫn tới hai rule thiết kế:

1. Dùng annotation để chọn UX: read-only tool từ server đáng tin có thể ít ma sát hơn; destructive tool nên show preview/confirmation.
2. Không dùng annotation làm source of truth. Server policy phải tự classify tool/effect bằng registry hoặc code đã review; tool tự quảng cáo `readOnlyHint: true` không được phép tự cấp quyền.

Rủi ro còn là thuộc tính của **path**, không chỉ của một tool. Khi một session có private-data read, access tới untrusted content và external communication, prompt injection có thể ghép ba capability thành exfiltration path. MCP blog gọi đây là “lethal trifecta” trong bối cảnh agentic tooling.[4]

![Một session bị taint bởi nội dung không tin cậy; đường từ private data sang external communication bị policy chặn](/blog/mcp-security-taint-path.webp)

Một policy engine nên carry context như `session.taint`, `data.classification`, `destination.trust` và `effect.class`. Sau khi agent đọc email/web page/imported ticket, hãy coi content là untrusted data, không phải instruction. Nếu session sau đó có private data, external write phải bị block hoặc escalated. Đây là defense-in-depth ngoài model: model không cần “nhận biết” attack để server ngăn hành vi nguy hiểm.

---

## Từ blueprint tới test suite: kiểm tra quyền như kiểm tra business logic

Security regressions hay xuất hiện khi thêm tool, đổi scope, đổi server proxy hoặc thay model. Hãy đưa invariant vào automated test. Một test suite nhỏ nhưng đúng có giá trị hơn mười prompt “hãy cẩn thận”.

| Test case | Setup | Expected invariant |
| --- | --- | --- |
| Missing scope | Token chỉ có `refunds:draft`, gọi `send_refund` | Tool không discoverable hoặc server deny trước provider call |
| Wrong audience | Token hợp lệ cho resource khác | Reject ở token validation |
| Cross-tenant ID | Subject tenant A gửi case tenant B | Deny dù scope đúng |
| State violation | Case không `refund_eligible` | Deny dù đã có approval cũ |
| Changed arguments | Approve 72 USD, execute 720 USD | Digest mismatch; không execute |
| Replay approval | Dùng lại approval ID | Single-use store reject |
| Expired/revoked consent | Token/consent expired | Step-up lại, không silently renew |
| Tainted exfiltration path | Đọc web content + private case + `post_status_update` external | Block hoặc require elevated flow |
| Annotation lie | Untrusted server đánh dấu read-only | Policy registry vẫn classify theo server truth |
| Audit completeness | Deny/approve/execute | Có correlation ID, policy version, decision, actor; không leak secret |

Biểu đồ dưới đây không phải benchmark industry; nó là một **example policy table** cho phép bạn debate hành vi trước khi code. Điều quan trọng là mỗi cell có owner và test.

![Ma trận quyết định từ effect class và runtime context, phân biệt auto, policy, approval và block](/blog/mcp-security-risk-matrix.webp)

Hãy instrument cả deny. Một deny rate tăng sau khi rollout có thể là tấn công, scope migration hỏng hoặc UI consent gây nhầm lẫn. Một approval latency tăng có thể là process bottleneck. Nhưng log không nên trở thành tập hợp raw tool payload vô kiểm soát; lưu correlation ID, capability, decision, policy revision, approver role và digest là đủ cho phần lớn audit/debug.

---

## Lộ trình triển khai không làm vỡ mọi agent trong một ngày

Bắt đầu bằng inventory thay vì “thêm OAuth”. Liệt kê mọi tool, downstream dependency, data class, destination, side effect và current credential. Sau đó làm hẹp tool manifest trước: tách read/draft/commit, bỏ generic shell/admin tool khỏi user-facing agent, và làm `tools/list` scope-aware.

Tiếp theo, chuẩn hóa authorization contract: resource metadata/discovery, strict redirect URI, PKCE, issuer/audience validation, short token lifetime và consent record per client. MCP authorization specification yêu cầu protected resource metadata cho MCP server và định hướng client dùng discovery; RFC 9700 cung cấp baseline cho redirect, PKCE, mix-up và CSRF defenses.[1] [5]

Sau đó đưa policy engine vào đường đi trước provider call. Policy phải biết subject, client, tool, capability, tenant/resource, state, destination, amount, taint và policy version. Cuối cùng mới thêm approval envelope cho effect high impact—và đừng quên consume-once + revalidation.

![Timeline từ tool discovery qua scope, OAuth consent, policy, human approval đến audit evidence](/blog/mcp-security-authorization-timeline.webp)

> **Definition of done:** Model có thể đề xuất tool call; chỉ server mới có thể thực thi side effect. Và server chỉ thực thi khi token, policy, approval (nếu cần) và current state cùng đồng ý.

### Production checklist

| Area | Câu hỏi release gate |
| --- | --- |
| Tool surface | Có tool nào broad hơn job-to-be-done? `tools/list` có lọc theo authority không? |
| OAuth | Có exact redirect validation, PKCE, audience/issuer/expiry checks và per-client consent không? |
| Policy | Có tenant/resource/state/destination/amount checks ở server không? |
| Approval | Approval có bind digest, limit, policy version, expiry, single use và revalidation không? |
| Session safety | Untrusted content có taint context và hạn chế external effects sau private-data access không? |
| Operations | Deny/approve/execute có audit evidence, correlation ID, retention và review owner không? |
| Testing | Có regression cases cho scope, audience, replay, changed args, cross-tenant và injection path không? |

MCP cho bạn một ngôn ngữ chung để expose tools; nó không tự giải bài toán quyền hạn. Giá trị production đến từ việc đặt capability ở đúng layer: OAuth cho delegation, policy cho quyết định runtime, và con người cho những commit cần trách nhiệm. Khi làm được điều đó, agent không còn là principal có master key—nó là một executor bị ràng buộc bởi ý định, phạm vi và bằng chứng.

---

## References

[1]: [Model Context Protocol — Authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)  
[2]: [Model Context Protocol — Security Best Practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices)  
[3]: [Model Context Protocol — Tools](https://modelcontextprotocol.io/specification/draft/server/tools)  
[4]: [Model Context Protocol Blog — Tool Annotations as Risk Vocabulary: What Hints Can and Can't Do](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)  
[5]: [IETF RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)  
[6]: [OWASP Cheat Sheet Series — AI Agent Security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
