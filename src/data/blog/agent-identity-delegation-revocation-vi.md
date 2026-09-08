---
title: "Identity của AI Agent không phải User ID: Thiết kế Delegation, Scope và Revocation"
description: "Hướng dẫn production để tách user, client và AI agent identity, thực thi delegated authority bằng token giới hạn, giữ attribution xuyên service và thu hồi quyền an toàn."
pubDate: 2026-06-18
category: "security"
image: "/blog/agent-identity-delegation-revocation/hero-playwright.webp"
lang: "vi"
translationKey: "agent-identity-delegation-revocation"
draft: false
---

![Sơ đồ identity triangle kết nối user, client, AI agent, authorization server và protected resource](/blog/agent-identity-delegation-revocation/hero-playwright.webp)

Một AI agent không nên biến thành user ID chỉ vì người dùng vừa bấm “Run”. Đây là shortcut rất dễ chọn: ứng dụng đã có session, downstream API đã nhận bearer token, và demo đầu tiên chạy được mà không cần thiết kế thêm identity model. Vấn đề xuất hiện khi agent phải diễn giải ngôn ngữ tự nhiên, gọi nhiều tool và tiếp tục làm việc sau khi người dùng đã rời mắt khỏi màn hình.

Một senior engineer có thể được phép xoá replica production. Một support agent có thể được phép đọc lịch sử ticket của một khách hàng. Một finance analyst có thể được phép export báo cáo nhưng không được thay đổi tài khoản ngân hàng. Những permission đó mô tả con người có thể làm gì. Chúng không tự động mô tả một phần mềm nên được làm gì thay cho con người ấy.

> **Luận điểm:** AI agent là một principal độc lập. Delegation chỉ nên chuyển phần authority cần cho task hiện tại, giữ lại identity của người khởi tạo, giới hạn role riêng của agent và có thể revoke khi run vẫn đang diễn ra.

Đây đang trở thành bài toán identity và authorization chứ không còn chỉ là bài toán viết prompt. NCCoE thuộc NIST đã kêu gọi nghiên cứu về identification, authorization, auditing và non-repudiation cho software agent. Một Internet-Draft của IETF đề xuất OAuth extension có thể ghi nhận user, client application và agent trong flow delegated authorization. Các sáng kiến này không loại bỏ quyết định thiết kế cục bộ, nhưng hướng đi đã khá rõ: identity của agent phải được biểu diễn có chủ đích.

## Identity triangle: user, client và agent

Một agent run trong production thường có ít nhất ba principal. **User** khởi tạo hoặc phê duyệt công việc. **Client application** hiển thị giao diện và bắt đầu authorization flow. **Agent** lập kế hoạch và thực thi, thường thông qua tool hoặc service khác. Bên thứ tư là **resource server**, nơi enforce quyền truy cập vào database, repository, ticket system, cloud account hoặc MCP server.

Client và agent không nhất thiết là một. Web application có thể host agent, trong khi một worker process với credential riêng thực sự chạy task. Một workflow orchestrator có thể gọi specialist agent, rồi specialist agent gọi downstream API. Nếu tất cả tầng này bị nén thành một `sub` claim, audit trail sẽ mất sự khác biệt giữa “ai yêu cầu”, “ứng dụng nào khởi tạo”, “agent nào chọn action” và “resource nào chấp nhận”.

| Principal | Trách nhiệm | Câu hỏi về identity | Sai lầm thường gặp |
|---|---|---|---|
| User | Yêu cầu, approve, sở hữu hoặc delegate công việc | Ai khởi tạo task? | Xem toàn bộ permission của user là permission của agent |
| Client | Host tương tác và authorization flow | Ứng dụng nào xin delegation? | Cho rằng client là executor |
| Agent | Lập kế hoạch, chọn tool và thực thi | Phần mềm actor nào đưa ra quyết định? | Cấp shared service account quá rộng |
| Resource server | Enforce policy ở boundary | Call này có đúng audience và scope không? | Tin lời giải thích bằng ngôn ngữ tự nhiên của agent |

Sự tách biệt này quan trọng ngay cả khi mọi thành phần do cùng một tổ chức vận hành. Token phải làm cho mối quan hệ trở nên rõ ràng với service tiếp theo, thay vì bắt service đó suy luận từ prompt tự do hoặc một trace ID nội bộ.

Điều này bổ sung cho [kiến trúc agent handover](/blog/agent-handover-architecture) và bài [observability không làm lộ dữ liệu](/blog/agent-observability-without-data-leaks) hiện có trên folio. Handover giải thích work chuyển giữa các agent như thế nào; identity giải thích ai có quyền thực hiện call tiếp theo. Observability giúp quan sát run; delegation giải thích actor được quan sát có quyền gì.

## Delegation không phải impersonation

OAuth token exchange phân biệt khá rõ **delegation** và **impersonation**. Trong impersonation, principal A nhận token khiến A gần như không thể phân biệt với principal B trong hệ thống nhận request. Trong delegation, A vẫn giữ identity riêng nhưng hành động thay mặt B. RFC 8693 mô tả hai semantics này khác nhau và hỗ trợ token mang thông tin về cả subject lẫn actor.

Đối với AI agent, khác biệt này rất thực tế. Nếu agent impersonate user, downstream API có thể chỉ thấy `user:alice`. Nó không biết Alice trực tiếp tạo request, client gọi agent hay agent thứ hai đã rewrite task. Nếu agent delegate thay mặt Alice, downstream API có thể enforce policy trên cả hai identity: “Alice khởi tạo, nhưng `agent:ticket-assistant` là actor; token chỉ hợp lệ cho ticket read đến 14:00.”

Mô hình đơn giản:

```text
user:alice  --delegates-->  agent:ticket-assistant
                              |
                              +-- calls --> api:tickets
```

Agent chịu trách nhiệm cho action, còn Alice vẫn là nguồn của delegated authority. Nhờ vậy security team trả lời được hai câu hỏi khác nhau: “Request này thuộc về yêu cầu của ai?” và “Thành phần phần mềm nào thực sự thực hiện action?”

Sự khác biệt này cũng giúp incident response tốt hơn. Nếu một tool bị compromise, team có thể revoke credential của agent hoặc task grant mà không cần giả vờ rằng toàn bộ identity của user phải bị vô hiệu hóa. Nếu user rời tổ chức, authorization server có thể từ chối các exchange mới của user đó trong khi agent vẫn hoạt động bình thường.

## Intersection rule: effective authority là phần giao nhau

Quy tắc hữu ích nhất có thể nói ngắn gọn như sau: effective authority của agent phải là phần giao của nhiều ràng buộc, không phải hợp của mọi permission mà hệ thống nhìn thấy.

```text
Effective authority =
  permission hiện tại của user
  ∩ role của agent
  ∩ scope của task
  ∩ audience của resource
  ∩ policy tenant và environment
  ∩ thời gian và trạng thái run
```

Giả sử một engineer có quyền đọc deployment, rollback release và xoá cloud resource. Deployment assistant có thể chỉ được cấu hình cho post-deploy check dạng read-only. Authority của user rộng, nhưng role của agent hẹp. Token hiệu lực chỉ nên chứa phần giao nhau. Ngược lại, nếu role của agent cho phép rollback nhưng role hiện tại của user không cho phép, call vẫn phải bị từ chối.

![Phần giao của user permission, agent role, task scope, audience và environment](/blog/agent-identity-delegation-revocation/intersection-authority-playwright.webp)

WorkOS gọi đây là intersection rule: permission của user là một ceiling, không phải toàn bộ grant. Scope riêng của agent là ceiling thứ hai. Cách này ngăn failure mode phổ biến trong đó một nhân viên có quyền cao vô tình cấp cho general-purpose agent khả năng thực hiện mọi privileged action mà nhân viên đó có thể làm.

Intersection nên được đánh giá ở policy boundary, tốt nhất là tại mỗi tool call nhạy cảm. Đừng yêu cầu model tự quyết định action có được phép hay không. Model có thể đề xuất action; policy engine hoặc resource server phải quyết định action có được authorize không. Đây cũng là hướng OWASP khuyến nghị trong phần excessive agency: giảm functionality và permission, chạy extension trong user context, yêu cầu approval cho action có tác động lớn và enforce complete mediation ở downstream.

Input cho policy cần nhiều cấu trúc hơn một scope string:

```ts
type AuthorizationInput = {
  userId: string;
  agentId: string;
  clientId: string;
  tenantId: string;
  taskId: string;
  audience: string;
  requestedActions: string[];
  resourceIds: string[];
  environment: "sandbox" | "staging" | "production";
  policyVersion: string;
  expiresAt: string;
};
```

Policy decision cũng nên trả về kết quả rõ ràng thay vì một boolean mơ hồ ẩn trong agent trace:

```ts
type AuthorizationDecision = {
  effect: "allow" | "deny";
  allowedActions: string[];
  reasonCode: string;
  decisionId: string;
  policyVersion: string;
  expiresAt: string;
};
```

Một decision bị deny là dữ liệu có giá trị. Nó cho biết agent xin capability ngoài role, user đã mất quyền, target audience sai hay run đã vượt quá time boundary.

## Token exchange: tạo credential có hình dạng của task

Agent không nên forward browser session token của user tới mọi downstream service. Nó nên exchange subject token đã được authenticate để nhận credential mới, gắn với resource, audience và task cụ thể. RFC 8693 định nghĩa OAuth-based token exchange để lấy token có thể được scope hẹp hơn cho downstream service.

Request đơn giản có thể trông như sau:

```http
POST /oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange&
subject_token=<user_access_token>&
subject_token_type=urn:ietf:params:oauth:token-type:access_token&
requested_token_type=urn:ietf:params:oauth:token-type:access_token&
resource=https%3A%2F%2Ftickets.example.com&
scope=tickets%3Aread&
actor_token=<agent_identity_token>&
actor_token_type=urn:ietf:params:oauth:token-type:jwt
```

Đây là ví dụ minh hoạ, không phải cấu hình copy-paste cho mọi provider. Authorization server phải validate client, subject token, actor token, audience, task scope và policy cục bộ trước khi cấp token. Session credential gốc của user không nên trở thành tấm vé universal cho mọi tool.

![Flow bốn bước từ user delegation tới resource API enforcement](/blog/agent-identity-delegation-revocation/token-exchange-playwright.webp)


Token hoặc authorization context được cấp nên làm mối quan hệ có thể inspect. Tên claim cụ thể phụ thuộc provider và profile, nhưng semantics nên gần như sau:

```json
{
  "iss": "https://auth.example.com",
  "sub": "agent:ticket-assistant",
  "aud": "https://tickets.example.com",
  "scope": "tickets:read",
  "act": { "sub": "user:alice" },
  "client_id": "support-console",
  "task_id": "run_01JX9...",
  "tenant_id": "acme-support",
  "environment": "production",
  "policy_version": "support-agent-v4",
  "iat": 1781784000,
  "exp": 1781784300
}
```

Điểm quan trọng không phải exact JSON shape. Resource server phải nhận diện được agent thực thi, attribution được user delegate, audience bị giới hạn, task boundary rõ ràng và credential bị từ chối khi hết hạn hoặc không còn phù hợp policy. ScaleKit mô tả cùng nhu cầu này qua dual identity enforcement, scoped permission, cross-service attribution, expiry/revocation check và auditability ở quy mô lớn.

## Delegation chain cần có maximum depth

Quan hệ user-to-agent đơn lẻ đã giàu thông tin hơn user ID. Trong hệ thống thật, workflow còn có thể đi xa hơn. Coordinator agent gọi specialist agent để kiểm tra deployment, rồi specialist gọi resource service.

```text
user:alice
  -> client:release-console
    -> agent:release-coordinator
      -> agent:deployment-checker
        -> api:deployments
```

Chain không được trở thành cách nhân authority. Mỗi hop nên nhận scope hẹp hơn hoặc bằng scope trước, audience mới nếu cần và actor relationship rõ ràng. Specialist agent không nên nhận toàn bộ tool catalog của coordinator chỉ vì nó được coordinator gọi.

| Delegation field | Kỳ vọng an toàn | Red flag |
|---|---|---|
| Actor identity | Mỗi hop có principal ổn định, verify được | Mọi hop đều log là original user |
| Audience | Token chỉ hợp lệ cho resource boundary dự kiến | Một token được chấp nhận ở service không liên quan |
| Scope | Scope con là subset của scope cha | Child nhận permission mở rộng |
| Lifetime | Hạn child không muộn hơn grant cha | Child token sống lâu hơn run tạo ra nó |
| Depth | Policy giới hạn chain ở độ sâu nhỏ | Agent-to-agent delegation vô hạn |
| Attribution | Log giữ full chain hoặc reference bền vững | Chỉ agent cuối cùng được ghi nhận |

Một mặc định thực tế là đưa delegation depth thành policy field rõ ràng. Nếu run chỉ được gọi một specialist, đặt `maxDelegationDepth: 1`. Nếu workflow hai hop thực sự cần thiết, hãy approve có chủ đích và test thêm audit/revocation behavior. “Model có thể gọi agent khác” không phải là security policy.

## Scope không chỉ là read hay write

Scope như `tickets:read` hữu ích nhưng hiếm khi đủ cho agent nhạy cảm. Một grant production nên trả lời ít nhất sáu câu hỏi:

1. **Audience nào?** Credential hợp lệ với ticket API, deployment API hay object store?
2. **Resource nào?** Một ticket, một repository, một project hay toàn bộ tenant?
3. **Action nào?** Read, comment, update, approve, delete hay export?
4. **Environment nào?** Capability có giống nhau ở sandbox, staging và production không?
5. **Time window nào?** Hết hạn sau năm phút, sau task hiện tại hay theo user session?
6. **Policy version nào?** Rule authorization nào đã tạo ra decision?

Scope nên cố tình “nhàm chán”. Grant hẹp như `deployments:read project:folio env:production exp:5m` dễ review hơn permission chung chung kiểu “deployment assistant”. Model vẫn có thể reasoning linh hoạt bên trong boundary; còn boundary phải explicit và machine-enforced.

Token cũng không phải hệ thống revocation. Expiry ngắn giới hạn damage window, nhưng hệ thống vẫn cần cách dừng active run khi user offboard, agent bị compromise, task bị cancel hoặc policy rollout làm grant cũ không còn hợp lệ.

## Revocation là một runtime state transition

Revocation nên được model như một state transition, không phải một nút admin bị giấu trong identity console. Authorization service và downstream resource boundary cần trả lời rõ câu hỏi: “Delegation này còn hợp lệ ngay lúc này không?”

![Timeline revocation gồm task cancel, role change, token expiry, policy deny và safe stop](/blog/agent-identity-delegation-revocation/revocation-timeline-playwright.webp)

Một thiết kế vững thường kết hợp nhiều control:

| Control | Bảo vệ khỏi | Ghi chú thiết kế |
|---|---|---|
| Short-lived access token | Credential bị lộ và grant cũ | Expiry nên theo task, không phải cả ngày |
| Fresh exchange mỗi sensitive call | Role đổi giữa long-running run | Re-evaluate user và agent policy ở boundary |
| Revocation status check | Cancel rõ ràng hoặc compromise | Chỉ cache trong safety window ngắn đã ghi rõ |
| Run cancellation | Work tiếp tục sau khi intent đổi | Propagate cancel tới worker và child agent |
| Policy versioning | Grant tạo dưới rule đã lỗi thời | Reject hoặc re-authorize khi version không phù hợp |
| Downstream deny | Upstream mistake hoặc context cũ | Resource server vẫn là enforcement point cuối |

Hãy xét một run kéo dài hai mươi phút. Ở phút thứ hai, user có quyền update ticket. Ở phút thứ tám, admin gỡ quyền đó. Nếu agent nhận một token dài hạn ngay lúc invocation, run có thể tiếp tục write thêm mười hai phút. Nếu mỗi sensitive operation exchange credential ngắn hạn và resource server check policy hiện tại, write tiếp theo sẽ bị deny. Đây không phải edge case; nó là khác biệt giữa “có nút revoke” và “revoke thực sự có hiệu lực”.

Safe failure mode là deny rõ ràng với lý do có thể resume: `delegation_revoked`, `user_permission_changed`, `agent_scope_exceeded`, `task_cancelled` hoặc `token_expired`. Đừng để model tự ứng biến sau revocation error. Orchestrator nên dừng branch liên quan, persist reason và xin authorization mới nếu product cho phép retry.

Điều này bổ sung cho bài [human action gate và consent fatigue](/blog/human-in-loop-action-gate-consent-fatigue). Approval phù hợp với high-impact action, nhưng approval không thay thế identity và revocation. User có thể approve deploy rồi cancel task; resource boundary vẫn phải biết grant trước đó không còn hợp lệ.

## Confused deputy và excessive agency

Agent có thể trở thành confused deputy dù credential của nó hợp lệ. Một document, tool result hoặc downstream agent có thể chứa instruction khiến agent bị hướng sang resource ngoài ý định của user. Nếu agent có shared service account rộng, instruction độc hại có thể biến authority đó thành data access hoặc destructive action.

Phòng thủ phải có nhiều lớp. Xem external content là untrusted input, giữ tool permission hẹp, enforce intersection rule ở resource boundary và yêu cầu approval riêng cho high-impact action. Chỉ thêm một câu vào system prompt là chưa đủ. Prompt có thể định hướng behavior; nó không thể là authorization mechanism cuối cùng.

Bài [MCP tool poisoning](/blog/mcp-tool-poisoning-description-payload) và [prompt injection boundaries](/blog/prompt-injection-tool-boundaries) trên folio đã đi sâu hơn vào attack path. Bài này tập trung vào identity: ngay cả khi agent bị đánh lừa, credential của nó phải làm cho blast radius nhỏ, có attribution và có thể revoke.

## Audit delegation, không chỉ audit API call

Một API log thông thường có thể ghi `agent:ticket-assistant called GET /tickets/123`. Như vậy chưa đủ để xây hệ thống agent có accountability. Log cần giữ mối quan hệ đã authorize call và decision đã allow nó.

```json
{
  "event": "tool_call.authorized",
  "request_id": "req_01JX9...",
  "task_id": "run_01JX9...",
  "user_id": "user:alice",
  "client_id": "support-console",
  "agent_id": "agent:ticket-assistant",
  "delegation_chain": ["user:alice", "agent:ticket-assistant"],
  "audience": "tickets-api",
  "action": "ticket.read",
  "resource": "ticket:123",
  "decision": "allow",
  "reason_code": "intersection_match",
  "policy_version": "support-agent-v4",
  "delegation_depth": 0,
  "expires_at": "2026-06-18T10:05:00Z"
}
```

Không đưa raw secret, full user prompt hoặc nội dung document nhạy cảm vào audit event. Lưu stable reference tới task và evidence khi cần, rồi áp dụng cùng kỷ luật privacy như trong [observability guide](/blog/agent-observability-without-data-leaks). Audit trail phải trả lời được ai khởi tạo, agent nào hành động, request yêu cầu gì, policy decision nào áp dụng và action được allow hay deny.

Các metric hữu ích gồm tỷ lệ tool call bị deny theo reason code, phần trăm token có task-level scope, delegation depth trung bình, thời gian từ revoke đến effective deny, stale-token rejection rate và số action thiếu attribution. Những số đo này biến identity design thành subsystem có thể vận hành thay vì chỉ là một diagram trong architecture document.

## Lộ trình migration khỏi shared service account

Nhiều team không thể thay shared service account trong một release. Migration theo giai đoạn giúp giảm rủi ro mà không giả vờ rằng model cũ an toàn.

**Bước một, inventory.** Ghi lại mọi agent, tool, service account, downstream audience, action và environment. Xác định credential nào đang đi qua ranh giới user, tenant hoặc production.

**Bước hai, observe.** Chạy shadow policy song song với authorization path hiện tại. Tính intersection decision và log những gì lẽ ra bị deny, nhưng chưa block. Nhờ vậy team thấy được tool nào đang phụ thuộc vào accidental privilege.

**Bước ba, bind identity.** Đăng ký identity ổn định cho agent và truyền `user_id`, `client_id`, `agent_id`, `task_id` xuyên execution context. Missing attribution phải trở thành error có thể thấy, không được âm thầm fallback về generic principal.

**Bước bốn, downscope.** Bắt đầu với tool read-only và resource rủi ro thấp. Exchange credential ngắn hạn cho từng audience. Chỉ giữ path cũ như fallback có đo lường trong thời gian validate path mới.

**Bước năm, canary và deny.** Bật enforcement cho một nhóm agent nhỏ hoặc một tenant. Theo dõi denial, latency, token exchange failure, revocation effectiveness và friction người dùng. Chỉ mở rộng sau khi hiểu failure mode.

**Cuối cùng, xoá escape hatch.** Xoá broad service-account permission không còn cần. Fallback tồn tại vĩnh viễn thường chính là production path thật.

## Checklist review identity của agent

Trước khi ship một agent có thể gọi hệ thống được bảo vệ, hãy kiểm tra thiết kế có trả lời được các câu hỏi sau không:

- Agent có identity riêng, tách khỏi user và client application không?
- Effective grant có là giao của user permission, agent role, task scope, audience và environment policy không?
- Downstream service có phân biệt được agent thực thi với user delegate không?
- Token có short-lived, audience-bound và cấp cho task hiện tại không?
- Mỗi delegation hop có giữ attribution và tránh mở rộng scope không?
- User, admin hoặc orchestrator có thể revoke active run không?
- Resource server có enforce policy thay vì tin decision của model không?
- Denial reason, policy version và delegation depth có nằm trong audit trail không?
- Có kế hoạch migration đã test để rời shared credential quyền cao không?

Nếu nhiều câu trả lời là “chưa”, feature tiếp theo có lẽ không nên là một tool khác. Nó nên là một identity boundary.

## Kết luận

Câu “agent hành động thay mặt user” chỉ có ý nghĩa khi hệ thống giải thích được nó ở authorization boundary. Nó nên có nghĩa rằng một agent có tên, được một client có tên khởi tạo, nhận bounded grant từ một user có tên, cho một task có tên, với một audience có tên, tới một thời điểm expiry hoặc revocation có tên.

Mức chính xác đó không làm agent kém hữu ích. Nó khiến hệ thống trung thực hơn về nguồn authority và có khả năng dừng lại khi authority thay đổi. User ID trả lời user là ai. Production agent identity model còn phải trả lời ai đã hành động, thay mặt ai, với scope nào, dưới policy nào và grant đó còn sống không.

## References

[1]: https://www.nccoe.nist.gov/news-insights/new-concept-paper-identity-and-authority-software-agents "NIST NCCoE — New Concept Paper on Identity and Authority of Software Agents"

[2]: https://www.ietf.org/archive/id/draft-oauth-ai-agents-on-behalf-of-user-00.html "IETF — OAuth 2.0 Extension: On-Behalf-Of User Authorization for AI Agents"

[3]: https://www.rfc-editor.org/rfc/rfc8693 "RFC 8693 — OAuth 2.0 Token Exchange"

[4]: https://workos.com/blog/delegated-access-ai-agents "WorkOS — Delegated access for AI agents: The intersection rule explained"

[5]: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/ "OWASP GenAI — LLM06:2025 Excessive Agency"

[6]: https://www.scalekit.com/blog/delegated-agent-access "ScaleKit — Understanding On-Behalf-Of in AI agent authentication"
