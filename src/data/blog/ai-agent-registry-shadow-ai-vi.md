---
title: "Agent Registry: Phát hiện, sở hữu và cách ly Shadow AI Agent"
description: "Playbook production để lập danh mục AI agent, gán owner chịu trách nhiệm, giới hạn runtime scope và cách ly automation không được phê duyệt trước khi nó trở thành một vùng rủi ro vô hình."
pubDate: 2026-09-02
category: "security"
lang: "vi"
translationKey: "ai-agent-registry-shadow-ai"
draft: false
image: "/blog/agent-registry/hero.png"
---

Phần lớn tổ chức biết có bao nhiêu người dùng có quyền truy cập vào một hệ thống production. Nhưng rất ít tổ chức trả lời được câu hỏi tương tự cho AI agent.

Hiện tại có bao nhiêu agent đang chạy? Ai chịu trách nhiệm? Mỗi agent dùng model, prompt, tool, skill, memory store và service account nào? Nó có thể chạm vào dữ liệu nào? Lần cuối quyền hạn của nó được review là khi nào? Agent nào là sản phẩm đã được phê duyệt, agent nào chỉ là thử nghiệm, và agent nào là automation cá nhân của một nhân viên nhưng vẫn âm thầm chạy ngoài tầm nhìn của đội security?

Nghe giống những câu hỏi về inventory. Thực ra đây là những câu hỏi về **control**.

Một agent có thể đọc customer database, mở ticket, gửi email, chạy shell command hoặc gọi agent khác không chỉ là một prompt gắn vào API. Nó là một non-human actor có identity, authority, dependency và lifecycle. Nếu tổ chức không nhận diện được actor đó, tổ chức cũng không thể áp dụng least privilege một cách đáng tin cậy, điều tra incident hay chứng minh một action nhạy cảm đã được authorize.

> **Định nghĩa làm việc:** agent registry là bản ghi có thẩm quyền và được reconcile liên tục về những AI agent đang tồn tại trong tổ chức, người chịu trách nhiệm, capability mà chúng sở hữu, dữ liệu và hệ thống chúng chạm tới, cùng lifecycle state mà chúng được phép vận hành.

Đây là lớp fleet-level nằm phía trên security của từng agent. Những control như policy-as-code, observability, memory protection và incident response vẫn cần thiết. Registry làm cho các control đó có địa chỉ rõ ràng: chúng đang bảo vệ agent nào, ai được đổi policy của agent, và agent đó còn được phép chạy hay không.

![Bảng điều khiển control plane nền tối lập bản đồ các AI agent được phê duyệt và chưa được phê duyệt trong doanh nghiệp](/blog/agent-registry/hero.png)

*Registry không phải một trang catalog. Nó là control plane dành cho các non-human actor.*

## Vì sao “chúng tôi đã có inventory agent” vẫn thường chưa đủ

Nhiều đội đã có spreadsheet, CMDB entry, cloud project hoặc danh sách API key. Không thứ nào trong số đó tự động trở thành agent registry.

Một registry hữu ích phải nối **identity được khai báo** của agent với **behavior được quan sát**. Một team có thể đăng ký support agent là “CRM assistant chỉ đọc”, trong khi telemetry cho thấy nó còn gọi ticket mutation API thông qua một integration dùng chung. Một developer có thể đăng ký prototype bằng tên tạm thời, nhưng service account của prototype vẫn chạy sau khi thử nghiệm kết thúc. Một low-code builder có thể tạo nhiều bản sao của một agent, mỗi bản sao có connector scope khác nhau, mà không có bản ghi ownership tập trung.

Điểm khác biệt là reconciliation. Registry chỉ tiếp nhận declaration sẽ biến thành một compliance form. Registry so sánh declaration với runtime evidence mới có thể trở thành security control.

Báo cáo Cyber Pulse 2026 của Microsoft mô tả điểm mù ở cấp tổ chức bằng những câu hỏi rất thực tế: có agent nào đang tồn tại, ai sở hữu chúng, chúng chạm vào hệ thống và dữ liệu nào, và agent nào được sanction hay đang là shadow agent [1]. Khảo sát State of Agent Engineering 2026 của LangChain cũng cho thấy lý do chủ đề này quan trọng: 57,3% người trả lời cho biết họ đã có agent chạy production, trong khi quality vẫn là rào cản lớn nhất và observability đã trở nên phổ biến [2]. Visibility không còn là vấn đề của tương lai; nó đã là một phần của production surface.

## Bốn loại record mà mỗi agent cần có

Đừng bắt đầu registry bằng một form khổng lồ. Hãy bắt đầu bằng bốn loại record trả lời bốn câu hỏi khác nhau.

| Record | Câu hỏi cần trả lời | Ví dụ |
|---|---|---|
| **Identity** | Actor này là ai? | Agent ID ổn định, tên hiển thị, environment, version, owner |
| **Capability** | Nó được phép làm gì? | Tool, skill, model provider, network destination, autonomy level |
| **Evidence** | Thực tế nó đang làm gì? | Call đã quan sát, data class, destination, action volume, last seen |
| **Accountability** | Ai chịu trách nhiệm? | Business owner, technical owner, security reviewer, escalation path |

Tách riêng về mặt khái niệm giúp tránh một lỗi phổ biến: xem declaration của developer là bằng chứng cho runtime behavior. Declaration vẫn rất hữu ích. Nó tạo ra thứ để hệ thống đối chiếu.

Một registry entry tối thiểu có thể như sau:

```json
{
  "agent_id": "agt_support_triage_prod",
  "display_name": "Support triage",
  "environment": "production",
  "version": "2026.09.02.3",
  "status": "approved",
  "business_owner": "customer-operations",
  "technical_owner": "support-platform",
  "security_reviewer": "security-oncall",
  "model": {
    "provider": "provider-a",
    "model": "reasoning-large",
    "pinned_revision": "2026-08-18"
  },
  "capabilities": {
    "tools": ["crm.read", "ticket.create"],
    "network_egress": ["crm.internal", "tickets.internal"],
    "autonomy": "draft-and-request-approval"
  },
  "data_classes": ["customer-contact", "support-history"],
  "last_attested_at": "2026-09-02T09:30:00Z",
  "expires_at": "2026-12-02T00:00:00Z"
}
```

Những field quan trọng không phải model name hay phần mô tả thân thiện. Đó là identity ổn định, environment, capability boundary, owner, lần attestation gần nhất và expiry. Thiếu các field này, record sẽ trở thành tài liệu cũ thay vì một object có thể enforce.

## Discovery: tìm những agent chưa từng được đăng ký

Lần rollout registry đầu tiên sẽ phơi bày một sự thật hơi khó chịu: agent hiếm khi chỉ xuất hiện ở một nơi.

Một discovery pass cho production nên kết hợp nhiều signal. Hãy scan deployment manifest, serverless function, model gateway log, API key, OAuth application, MCP hoặc tool server, queue consumer, scheduled job, low-code platform, browser automation runner và repository chứa agent configuration. Sau đó normalize các signal này thành những actor ứng viên.

Không nên xem mọi model call là một agent riêng. Một application có thể tạo nhiều model call. Ngược lại, một agent có thể đi qua nhiều service. Mục tiêu là nhận diện một actor bền vững, có purpose, authority boundary và execution path có thể lặp lại.

![Nhiều nguồn telemetry hội tụ về một agent registry với trạng thái confidence và ownership](/blog/agent-registry/discovery-map.png)

*Discovery là bài toán correlation: declaration, credential, deployment và action được quan sát phải trỏ về cùng một actor.*

Một candidate record hữu ích nên có confidence level và lý do vì sao agent được phát hiện:

```text
candidate: unknown-agent-7f31
signals:
  - model_gateway: 18,402 calls trong 7 ngày gần nhất
  - oauth_app: support-export-client
  - tool_server: crm.read, ticket.create
  - repository: github.com/acme/support-automation
confidence: high
owner_hint: support-platform
next_action: require_attestation
```

Registry không được âm thầm biến candidate thành approved agent. Discovery tạo ra review queue. Approval là một quyết định có owner, scope và expiry.

## Shadow AI là vấn đề lifecycle, không chỉ là policy violation

“Shadow AI” thường được nói như thể nó chỉ có nghĩa là một nhân viên dùng chatbot chưa được duyệt. Đó là một trường hợp, nhưng trường hợp quan trọng hơn về mặt vận hành là một automation tiếp tục hành động mà không còn owner rõ ràng.

Một shadow agent có thể bắt đầu như một prototype vô hại. Nó dùng personal API key, prompt được copy lại hoặc connector tạo ra cho một thử nghiệm kéo dài một ngày. Sau đó các workflow khác bắt đầu phụ thuộc vào nó. Quyền hạn của nó tăng dần vì sửa nhanh dễ hơn thiết kế integration mới. Không ai biết ai có thể approve thay đổi, và cũng không ai biết khi nào nên retire nó.

Vì vậy registry cần lưu **cách agent đi vào tổ chức**, chứ không chỉ lưu agent hiện đang approved hay không. Provenance hữu ích gồm deployment pipeline, creator, repository, connector installer, first-seen timestamp và event đã promote nó từ experiment lên production.

Điều này biến một policy problem mơ hồ thành một lifecycle problem có thể xử lý:

1. Một actor mới được phát hiện.
2. Owner và purpose của nó được xác định.
3. Capability của nó được giảm xuống mức tối thiểu cần thiết.
4. Nó được approved cho một environment và time window giới hạn.
5. Behavior quan sát được được reconcile với declaration.
6. Nó được renew, restrict, quarantine hoặc retire.

Một agent không có quyết định renewal không nên mặc định được sống mãi.

## Approval nên tập trung vào capability, không phải personality

Một registry review không nên hỏi agent “có vẻ an toàn không”. Nó nên hỏi agent được làm gì, bằng chứng nào hỗ trợ capability đó, và điều gì xảy ra khi agent thất bại.

| Khía cạnh review | Câu hỏi mạnh | Câu hỏi yếu |
|---|---|---|
| Purpose | Agent sở hữu business outcome nào? | Đây có phải assistant hữu ích không? |
| Authority | Nó được thực hiện chính xác action nào? | Nó có low risk không? |
| Data | Nó có thể đọc hoặc sửa data class nào? | Nó có dùng dữ liệu công ty không? |
| Reversibility | Side effect nào có thể undo hoặc reconcile? | Nó có kill switch không? |
| Evidence | Trace và log nào chứng minh behavior? | Nó có monitoring không? |
| Ownership | Ai có thể sửa hoặc retire trong tuần này? | Team nào đã xây nó? |
| Expiry | Khi nào approval phải được review lại? | Approval có permanent không? |

Review cần tạo ra một capability contract rõ ràng. “Có thể draft ticket và xin approval” khác bản chất với “có thể close ticket và thông báo cho khách hàng”. Một autonomy label không đi kèm action-level contract quá mơ hồ để enforce.

Hướng dẫn production của MLflow cũng nhấn mạnh một điểm liên quan: runtime governance nên nằm bên dưới model layer, deterministic control phải ngăn action không được phép trước khi action ra wire, và boundary của skill hoặc plugin cần được chú ý đặc biệt [3]. Registry là nơi các runtime control đó có được một subject ổn định.

## Quarantine: trạng thái trung gian mà phần lớn inventory còn thiếu

Một status nhị phân—approved hoặc blocked—quá thô đối với discovery. Agent mới cần một nơi có thể được kiểm tra mà chưa nhận production authority.

Một lifecycle thực tế có thể gồm sáu state:

```text
observed -> candidate -> attested -> approved -> restricted -> retired
                    \\-> quarantined -/
```

**Observed** nghĩa là telemetry đã tìm thấy actor nhưng chưa có owner nhận trách nhiệm. **Candidate** nghĩa là đã có đủ thông tin cho review. **Attested** nghĩa là owner đã khai báo purpose, capability và dependency. **Approved** nghĩa là policy đã cấp runtime scope có giới hạn. **Restricted** nghĩa là agent chỉ được chạy ở reduced mode trong khi vấn đề được điều tra. **Quarantined** nghĩa là execution hoặc egress bị block nhưng evidence vẫn được giữ. **Retired** nghĩa là agent không còn được phép chạy, dù registry và audit record vẫn được lưu.

![Lifecycle của AI agent đi từ quan sát qua approval, restriction, quarantine và retirement](/blog/agent-registry/lifecycle-state-machine.png)

*Lifecycle state biến một inventory thành một hệ thống ra quyết định có thể vận hành.*

![Phễu quarantine chặn agent không có owner nhưng vẫn giữ evidence để review và recovery](/blog/agent-registry/quarantine-funnel.png)

*Quarantine phải giảm authority mà không phá hủy evidence cần thiết để hiểu agent xuất hiện vì sao.*

Quarantine đặc biệt hữu ích khi discovery confidence cao nhưng intent chưa rõ. Nó cũng hữu ích khi observed behavior vượt declared contract. Ví dụ, agent được đăng ký là read-only nên đi vào restricted hoặc quarantine state nếu nó thử write, ngay cả khi downstream API từ chối write đó.

Hành động quarantine phải deterministic. Language model có thể tóm tắt vì sao agent đáng ngờ, nhưng không nên là authority duy nhất quyết định một service account mới được phát hiện có tiếp tục chạy hay không.

## Reconciliation: so sánh declared behavior với observed behavior

Registry trở nên có giá trị khi có thể trả lời “điều gì đã thay đổi?” mà không cần engineer tự kiểm tra năm hệ thống.

Tối thiểu, hãy reconcile các cặp sau:

| Declared | Observed |
|---|---|
| Tool đã đăng ký | Tool call thực tế |
| Data class đã approved | Field hoặc dataset đã chạm tới |
| Destination được phép | Network và API destination |
| Owner đã khai báo | Repository, deployment và on-call signal |
| Model revision đã pin | Model gateway usage |
| Autonomy đã approved | Human approval, mutation và external message |
| Schedule kỳ vọng | Invocation frequency thực tế |

Kết quả reconcile nên là semantic finding, không phải một log diff ồn ào:

```json
{
  "agent_id": "agt_support_triage_prod",
  "finding": "undeclared_capability",
  "severity": "high",
  "declared": "ticket.create",
  "observed": "customer_email.send",
  "first_seen": "2026-09-02T11:07:14Z",
  "recommended_state": "restricted",
  "requires": ["owner_review", "capability_contract_update"]
}
```

Hệ thống nên bỏ qua implementation detail vô hại nhưng phải surface những thay đổi làm đổi authority, data exposure, cost hoặc user impact. Một model patch mới có thể cần attestation. Một outbound email destination mới cần gate mạnh hơn.

## Ownership phải sống sót sau khi team thay đổi

Owner field chỉ trỏ tới một người sẽ rất mong manh. Người đó có thể đổi vai trò, rời team hoặc không còn trong on-call rotation. Owner field chỉ trỏ tới một team lại quá mơ hồ khi incident cần quyết định trong vài phút.

Hãy dùng accountability nhiều lớp:

| Layer | Trách nhiệm |
|---|---|
| Business owner | Xác định purpose, acceptable outcome và user impact |
| Technical owner | Bảo trì code, prompt, tool, dependency và runbook |
| Security reviewer | Approve risk control, data scope và exception handling |
| Runtime operator | Phản ứng với alert, quarantine event và kill-switch action |

Mỗi layer nên có durable group identity cùng escalation route hiện tại. Registry nên từ chối approval nếu technical owner không có runbook hoặc escalation route trỏ tới một account đã bị deactivate.

Ownership không phải một contact card. Nó là điều kiện để agent được tiếp tục vận hành.

## Metrics cho thấy registry có khỏe hay không

Đếm số agent đã đăng ký là vanity metric. Một registry khỏe phải đo coverage và freshness.

Hãy theo dõi tỷ lệ actor quan sát được có stable ID, tỷ lệ có owner hiện tại, tỷ lệ declared capability khớp observed behavior, median age của candidate chưa được review, số agent đã hết approval nhưng vẫn đang gọi, và thời gian từ first discovery tới quarantine.

Cũng cần đo **negative space**: agent biến mất khỏi telemetry mà không có retirement event, credential vẫn active sau khi agent retired, và agent tiếp tục nhận data sau khi purpose đã kết thúc.

| Metric | Nó cho biết điều gì |
|---|---|
| Discovery-to-attestation time | Tổ chức biến actor unknown thành actor có accountability nhanh đến đâu |
| Unowned runtime minutes | Agent chạy không owner trong bao lâu |
| Contract drift rate | Reality lệch khỏi approval thường xuyên thế nào |
| Expired approval calls | Lifecycle control có thật sự được enforce không |
| Quarantine recovery time | Tổ chức điều tra mà không improvisation nhanh đến đâu |
| Retirement residue | Credential, schedule và data path đã được gỡ sạch chưa |

Các metric này nên được slice theo environment và data sensitivity. Một vài development agent không owner là câu chuyện khác với một production agent không owner nhưng có payment access.

## Rollout mà không cần một platform hoàn hảo

Bạn có thể bắt đầu bằng một registry table và daily reconciliation job. Version đầu tiên không cần thay thế mọi security product.

**Phase một: thiết lập identity.** Tạo stable ID cho mọi agent đã biết, ghi deployment source và map service account, repository, schedule cùng model gateway key vào ID đó.

**Phase hai: thiết lập accountability.** Bắt buộc business owner, technical owner, purpose, data class, tool, environment và expiry cho mọi agent có thể truy cập dữ liệu non-public.

**Phase ba: thiết lập evidence.** So sánh declaration với model call, tool call, network destination, mutation event và human approval event. Giữ raw evidence để reviewer có thể reproduce finding sau này.

**Phase bốn: enforce quarantine.** Đưa actor unknown hoặc actor bị drift vào reduced mode. Block action mới có impact cao, giữ evidence và notify owner candidate. Đừng destroy actor trước khi hiểu dependency của nó.

**Phase năm: biến renewal thành hành động thật.** Approval hết hạn phải gây restriction hoặc quarantine, không chỉ tạo một badge quá hạn trên dashboard. Renewal nên review thay đổi từ lần attestation trước thay vì bắt owner điền lại toàn bộ form.

Registry chỉ thành công khi safe path dễ hơn invisible path. Nếu đăng ký agent mất nhiều ngày còn copy API key chỉ mất vài giây, tổ chức sẽ tạo shadow system nhanh hơn tốc độ governance có thể phát hiện.

## Registry không nên biến thành thứ gì

Registry không nên là surveillance dashboard lưu mọi prompt mãi mãi. Nó không nên là một CMDB thứ hai nhưng không có enforcement path. Nó không nên buộc con người approve mọi model call low-risk. Nó không nên kết luận agent an toàn chỉ vì phần mô tả nghe hợp lý.

Chỉ thu thập evidence tối thiểu cần cho accountability, security và debugging. Tách sensitive payload khỏi operational metadata. Áp dụng retention và access control cho registry evidence. Cho phép low-risk, reversible operation đi qua policy-driven automation, trong khi high-impact action cần review mạnh hơn.

Mục tiêu không phải làm mọi agent chậm đi. Mục tiêu là làm boundary đủ rõ để tốc độ không còn phụ thuộc vào sự thiếu hiểu biết.

## Fleet-level boundary

Một agent riêng lẻ có thể được thiết kế rất tốt nhưng vẫn trở thành rủi ro ở cấp tổ chức nếu không ai biết nó tồn tại. Một policy có thể đúng nhưng vẫn thất bại khi gắn vào identity đã hết hạn. Một incident runbook có thể rất tốt nhưng vô dụng nếu responder không biết service account nào thuộc về agent đang gặp sự cố.

Agent registry đóng khoảng trống đó. Nó cho non-human actor một identity ổn định, owner chịu trách nhiệm, capability contract có giới hạn, record về behavior thực tế và một lifecycle có thể kết thúc.

> **Một chương trình AI trưởng thành không chỉ hỏi agent có thể hành động an toàn hay không. Nó còn trả lời được agent nào đang hành động, dưới authority của ai, với bằng chứng nào, và làm thế nào để dừng agent mà không đánh mất sự thật.**

## Tài liệu tham khảo

[1]: https://www.microsoft.com/en-us/security/blog/2026/02/10/80-of-fortune-500-use-active-ai-agents-observability-governance-and-security-shape-the-new-frontier/ "Microsoft Security — Active AI Agents, Observability, Governance, and Security"
[2]: https://www.langchain.com/state-of-agent-engineering "LangChain — State of Agent Engineering"
[3]: https://mlflow.org/articles/building-production-ready-ai-agents-in-2026/ "MLflow — Building Production-Ready AI Agents in 2026"
