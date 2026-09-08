---
title: "Incident Response cho AI Agent: Kill Switch, Evidence Pack và Degradation an toàn"
description: "Playbook production để cô lập sự cố AI agent bằng kill switch nhiều lớp, evidence pack, degradation an toàn và quy trình phục hồi giảm blast radius mà không xóa mất dữ kiện cần để học hỏi."
pubDate: 2026-02-21
category: "engineering"
image: "/blog/ai-agent-incident-response/hero.webp"
lang: "vi"
translationKey: "ai-agent-incident-response"
draft: false
---

![Phòng điều phối sự cố AI được vẽ tay với công tắc cô lập, sổ ghi evidence và các nhánh degradation an toàn](/blog/ai-agent-incident-response/hero.webp)

Dấu hiệu đầu tiên cho thấy agent hỗ trợ khách hàng của chúng tôi đang có một buổi sáng tệ hại không phải là một dashboard đỏ. Đó là một câu trong ticket: “Nó nói hoàn tiền đã xong, nhưng tài khoản của tôi chưa thay đổi.”

Agent không crash. API vẫn khỏe. Latency từ model provider bình thường. Trace vẫn tồn tại, dù bị chia ra ở bốn service và ba loại identifier khác nhau. Agent đã diễn giải lỗi của tool như một lần ghi dữ liệu thành công, tạo một câu trả lời trấn an, rồi tiếp tục. Khi chúng tôi hiểu chuyện gì xảy ra, hàng trăm người dùng đã nhận được một khẳng định tự tin về một state transition chưa từng được commit.

Sai lầm khi khôi phục đến ngay sau đó. Chúng tôi tắt model endpoint, nhưng worker queue vẫn retry. Chúng tôi revoke một credential của tool, nhưng một route thứ hai vẫn có quyền gọi cùng backend. Về mặt kỹ thuật, kiến trúc có kill switch. Về mặt vận hành, chúng tôi chưa có một **hệ thống containment**.

> **Luận điểm:** Một sự cố AI agent không được giải quyết chỉ bằng việc dừng inference. Hệ thống response hữu ích phải dừng đúng đường dẫn nguy hiểm, giữ lại đủ evidence để tái dựng quyết định, hạ xuống một mode có authority thấp hơn và cung cấp lối quay lại có kiểm soát.

Playbook này xem incident như một state machine vận hành thay vì một nút bấm đầy kịch tính. Nó tập trung vào bốn câu hỏi: điều gì phải dừng trước, evidence nào phải sống sót, làm sao agent vẫn hữu ích mà không còn nguy hiểm, và dựa vào đâu ta biết hệ thống đủ an toàn để hoạt động lại?

## Vì sao incident của agent cần một mô hình response khác

Service truyền thống thường fail theo những cách dễ nhận biết: process exit, request trả error hoặc dependency timeout. Agent có thể fail trong khi vẫn trả HTTP response hợp lệ. Failure có thể là semantic, tích lũy theo thời gian hoặc bị che sau một tool call thành công. Agent có thể chọn nhầm tool, dùng credential hợp lệ cho mục đích không hợp lệ, ghi sai state hoặc mô tả một action chưa commit như đã hoàn tất.

Hướng dẫn về agentic AI của OWASP xem các hệ thống này là tổ hợp tự chủ của model, tool, data và action, với rủi ro cần threat modeling và mitigation chứ không phải một bộ lọc đơn ở ranh giới model. Cách nhìn đó làm thay đổi câu hỏi về incident. Ta không chỉ hỏi model có sẵn sàng hay không. Ta hỏi toàn bộ đường dẫn action còn xứng đáng có authority hay không.

Phân biệt hữu ích nhất là giữa **availability** và **authority**. Availability hỏi agent có thể trả lời hay không. Authority hỏi agent còn được phép thay đổi điều gì. Trong incident, giữ lại hỗ trợ read-only có thể hợp lý dù mọi write đều phải dừng. Không phải sự cố nào cũng cần biến thành outage toàn hệ thống.

| Tín hiệu sự cố | Điều có thể sai | Câu hỏi response đầu tiên |
|---|---|---|
| Tỷ lệ tool error tăng | Dependency hỏng, schema drift hoặc credential lỗi | Có thể ngăn retry tạo thêm effect không? |
| Xuất hiện mismatch giữa write và read | Agent báo thành công nhưng state không đổi | Action boundary nào cần pause? |
| Tỷ lệ policy denial giảm đột ngột | Classifier, prompt hoặc policy path đã đổi | Request rủi ro có đang được chấp nhận nhiều hơn? |
| Action giống nhau lặp lại | Retry loop, state cũ hoặc thiếu idempotency | Workflow và tenant nào cần cô lập? |
| Output lộ dữ liệu nhạy cảm | Rò retrieval, memory hoặc authorization | Có thể dừng exposure mà vẫn giữ evidence không? |

## Năm lớp containment

Kill switch nên có nhiều lớp vì không phải incident nào cũng cần cùng một bán kính gián đoạn. Hãy bắt đầu bằng switch nhỏ nhất đủ dừng effect nguy hiểm, sau đó mở rộng nếu tín hiệu mơ hồ hoặc đang lan. Các lớp dưới đây đi từ rộng nhất đến cụ thể nhất, nhưng thứ tự kích hoạt thực tế phụ thuộc incident.

![Năm lớp containment đi từ global stop qua tenant pause, tool revoke, fallback đến human escalation](/blog/ai-agent-incident-response/containment-layers.webp)

### 1. Global stop

Global stop ngăn các agent run mới đi vào action path. Nó phù hợp khi release mới rõ ràng không an toàn, credential bị compromise hoặc blast radius chưa biết. Switch này phải độc lập với model để agent không thể “lý luận” vượt qua nó. Một flag nằm trong cùng prompt hoặc config store mà agent có thể ảnh hưởng không phải kill switch; đó chỉ là một lời đề nghị.

Global stop cũng phải xử lý work đang chạy. Request mới có thể bị reject, nhưng worker vẫn có thể tiếp tục xử lý task trong queue. Kiến trúc tốt sẽ chuyển hệ thống sang trạng thái stopping, từ chối lease mới, cancel model call có thể cancel và không cho phép commit phase bắt đầu. Nó nên có thể được kích hoạt từ một control plane thứ hai với credential riêng.

### 2. Tenant hoặc workflow pause

Nhiều incident chỉ có phạm vi cục bộ. Connector dữ liệu khách hàng lỗi có thể ảnh hưởng một workflow mà không ảnh hưởng knowledge assistant nội bộ. Tenant pause giới hạn blast radius mà vẫn giữ các dịch vụ khác hoạt động. Pause phải được kiểm tra ở worker và tool gateway, không chỉ ở HTTP edge, vì queued work có thể sống lâu hơn request đã tạo ra nó.

Workflow pause đặc biệt hữu ích khi vấn đề gắn với một lớp action cụ thể như hoàn tiền, đổi tài khoản, provisioning, xóa dữ liệu hoặc gửi message ra ngoài. Agent có thể tiếp tục ở draft mode trong khi nhánh irreversible bị khóa.

### 3. Revoke quyền gọi tool

Revoke một tool mạnh hơn việc xóa tên tool khỏi context của model. Execution gateway phải reject call kể cả khi model còn tool definition cũ, plan đã cache hoặc có route trực tiếp đến backend. Đây là nơi identity và policy trở thành control của incident thay vì chỉ là tài liệu. Denial cần được ghi lại cùng request, agent release, tenant, tool và policy version.

Credential nên được scope để revoke một capability không buộc phải invalidate mọi capability. Nếu tất cả tool dùng chung một service account quá rộng, response sẽ chỉ có hai lựa chọn: cho tất cả chạy hoặc tắt tất cả. Authority hẹp giúp ta dừng chính xác hơn.

### 4. Fallback có authority thấp hơn

Fallback không tự động an toàn. Đổi sang model khác có thể giữ nguyên tool permission nguy hiểm và context cũ. Fallback an toàn hơn phải thay đổi **authority envelope**: retrieval read-only, tạo draft hoặc route FAQ bị giới hạn. Model thay thế là yếu tố thứ hai. Thay đổi quan trọng là hệ thống còn được phép commit gì.

### 5. Human escalation

Escalation là product path chứ không phải một error message chung chung. Operator cần intent của người dùng, state cuối cùng đã được xác nhận, action đã thử, lý do bị dừng và evidence để quyết định bước tiếp. Gửi transcript của agent vào queue mà không có owner, priority hoặc policy redaction an toàn chỉ chuyển incident sang một hệ thống chậm hơn.

## Đóng gói evidence trước khi dọn dẹp

Trong incident, đội ngũ thường muốn xóa trace nhạy cảm ngay lập tức. Đôi khi xóa là cần thiết, nhưng xóa trước có thể làm failure không thể tái dựng. Hãy tách **containment** khỏi **quyết định retention**. Đóng băng và phân loại evidence trước khi áp dụng cleanup policy thông thường, sau đó giới hạn quyền truy cập vào incident bundle.

![Evidence pack gom request, version, policy, tool, context, response và timeline thành một bundle được niêm phong](/blog/ai-agent-incident-response/evidence-pack.webp)

Evidence pack phải trả lời được “agent đã biết gì và đã thử làm gì?” mà không giả định cần lưu chain-of-thought riêng tư. Bộ tối thiểu hữu ích thường gồm:

| Evidence | Vì sao quan trọng | Cách xử lý privacy |
|---|---|---|
| Request và correlation ID | Nối gateway, worker, model và tool | Giữ identifier; hash field trực tiếp của user nếu có thể |
| Agent release bundle | Tái hiện model, prompt, tool, router và policy | Lưu revision bất biến |
| Policy decision | Cho biết vì sao action được allow, deny hoặc escalate | Lưu rule ID và input quyết định, không lưu payload thừa |
| Tool request và result | Tách effect đã thử khỏi effect đã commit | Redact secret; giữ status có cấu trúc và object ID |
| Context được retrieve | Giải thích evidence cũ, thiếu hoặc không được phép | Lưu provenance và access decision |
| Response nhìn thấy bởi user | Xác định hệ thống đã hứa điều gì | Giữ nguyên response trong vùng incident access control |
| Timeline | Thể hiện thứ tự, retry, pause và recovery | Dùng server timestamp và monotonic event ID |

Event model hữu ích nên phân biệt `planned`, `requested`, `accepted`, `committed` và `reported`. Câu “đã hoàn tiền xong” không bao giờ nên được sinh ra chỉ từ `requested`. Agent chỉ được báo thành công sau khi hệ thống đáng tin cậy xác nhận `committed`. Quy tắc nhỏ này chặn được một lớp lớn semantic incident.

```ts
type ActionEvidence = {
  actionId: string;
  state: "planned" | "requested" | "accepted" | "committed" | "failed";
  tool: string;
  releaseId: string;
  policyDecisionId: string;
  observedAt: string;
  committedObjectId?: string;
};

function userMessage(evidence: ActionEvidence): string {
  if (evidence.state !== "committed") {
    return "Chưa thể xác nhận thay đổi đã hoàn tất.";
  }
  return `Thay đổi đã hoàn tất: ${evidence.committedObjectId}`;
}
```

Evidence pack nên append-only từ góc nhìn incident responder. Operator có thể thêm annotation, nhưng event sequence gốc phải vẫn phân biệt được với diễn giải thêm về sau. Nhờ vậy post-incident review ít phụ thuộc vào trí nhớ và ít bị phá bởi một cleanup script có thiện ý.

## Degradation an toàn là một authority ladder

Degraded mode an toàn nhất không phải mode giữ lại nhiều feature nhất. Đó là mode giữ lại nhiều hành vi hữu ích nhất **mà không vượt qua boundary đang chưa chắc chắn**. Support agent có thể trả lời câu hỏi policy từ tài liệu đã verify trong khi từ chối mutate account state. Coding agent có thể chuẩn bị patch nhưng tắt merge và deployment. Browser agent có thể thu thập thông tin nhưng dừng trước submit.

![Cây quyết định degradation an toàn đi từ full action đến read-only, draft, handoff và safe stop khi uncertainty tăng](/blog/ai-agent-incident-response/safe-degradation.webp)

Model uncertainty chỉ là một input. Hệ thống cần xét tool health, độ mới của context, độ tin cậy của authorization, tính reversible của action và khả năng verify target state. Model có confidence cao vẫn có thể không an toàn khi database stale hoặc tool result mơ hồ.

| Mode | Hành vi được phép | Evidence bắt buộc |
|---|---|---|
| Full action | Read, write, execute trong policy | State mới và xác nhận result đã commit |
| Read only | Retrieve và giải thích; không mutate bên ngoài | Provenance nguồn và access decision |
| Draft | Chuẩn bị response hoặc action để review | Trạng thái “chưa thực thi” rõ ràng |
| Handoff | Đóng gói context cho human quyết định | Evidence tối thiểu, liên quan và có access control |
| Safe stop | Không thực hiện action tiếp | Incident ID và recovery path cho user |

Downgrade trong một run nên đơn điệu theo một chiều. Nếu agent chuyển từ full action sang draft vì dependency không còn chắc chắn, model turn sau không được âm thầm khôi phục quyền write. Authority chỉ được cấp lại bằng policy decision mới sau khi state được revalidate.

## State machine cho response

Quy trình response dễ vận hành hơn khi có state và owner rõ ràng. Một state machine có thể là:

```text
NORMAL
  -> SUSPECTED khi signal vượt threshold
SUSPECTED
  -> CONTAINED khi path nguy hiểm bị pause
  -> NORMAL khi signal được giải thích và giới hạn
CONTAINED
  -> INVESTIGATING khi evidence được đóng băng
INVESTIGATING
  -> RECOVERING khi có fix và kế hoạch verify
RECOVERING
  -> MONITORING khi fix chạy trong scope hẹp
MONITORING
  -> NORMAL sau khi exit gate đạt
ANY STATE
  -> SAFE_STOP khi impact hoặc uncertainty vượt envelope
```

Model không nên là owner của các transition này. Model có thể phát hiện signal, nhưng control plane, policy service hoặc human operator phải quyết định authority có đổi hay không. Đây cũng là lý do một service không nên được phép sửa policy quyết định service đó có được chạy hay không.

## Runbook: cô lập, giải thích, phục hồi

Mười phút đầu tiên nên cố tình nhàm chán. Xác nhận signal, xác định effect nguy hiểm và dừng effect đó. Đừng bắt đầu bằng việc chỉnh prompt. Đừng rollout thêm model thứ hai khi incident đầu tiên còn chưa được giới hạn. Đừng yêu cầu người dùng cung cấp thêm ví dụ trước khi ngăn hệ thống tạo thêm harm.

Trong giai đoạn điều tra, hãy tạo evidence pack, xác định cohort nhỏ nhất bị ảnh hưởng, so sánh action đã thử với state đã commit và kiểm tra xem vấn đề là release change, dependency failure, stale context, authorization drift hay retry behavior. Nguyên nhân có thể là một tổ hợp. Một con số trên dashboard không phải root cause.

Trong recovery, dùng cùng authority ladder theo chiều ngược lại. Bắt đầu bằng read-only hoặc draft, replay các case đại diện trên snapshot cố định, sau đó cho một cohort nội bộ nhỏ dùng action path. Bật lại từng tool hoặc workflow. Giữ safe path cũ cho đến khi path mới chứng minh rằng nó có thể tự xác nhận effect của chính mình.

![Vòng lặp recovery dừng, quan sát lại, lập kế hoạch, xác nhận rồi retry an toàn hoặc abort](/blog/ai-agent-incident-response/recovery-loop.webp)

Recovery gate cần rõ ràng:

| Gate | Điều kiện đạt |
|---|---|
| Containment | Không có high-risk action mới đi qua path bị ảnh hưởng |
| Evidence | Responder có thể tái dựng một incident đại diện từ đầu đến cuối |
| State truth | Success được báo khớp với state backend đã commit |
| Scope | Candidate giới hạn trong cohort và action set đã biết |
| User recovery | User bị ảnh hưởng có đường correction hoặc escalation |
| Monitoring | Semantic signal liên quan có owner và threshold |

## Bài học khó chịu

Kill switch không phải nút bấm khiến incident biến mất. Nó là lời hứa rằng hệ thống có thể giảm authority nhanh hơn tốc độ agent tạo ra effect mới. Evidence pack không phải giấy phép thu thập mọi thứ. Nó là bản ghi được giới hạn cẩn thận về những sự thật cần để giải thích và sửa failure. Safe degradation không phải một lời xin lỗi được bọc bằng model nhỏ hơn. Đó là product decision về capability nào vẫn còn đáng tin.

Đội ngũ xây những control này trước incident đầu tiên thường nhận ra chúng cũng cải thiện thiết kế hằng ngày. Tool permission trở nên hẹp hơn. State transition trở nên rõ hơn. Copy cho user không còn tuyên bố thành công trước khi có confirmation. Operator có thể trả lời không chỉ “agent có đang up không?” mà còn “hiện giờ agent được phép làm gì?”

Đó là tiêu chuẩn vận hành đáng theo đuổi: một agent có thể fail rõ ràng, dừng an toàn, giữ đúng evidence và quay lại phục vụ mà không biến người dùng thật thành test harness.

## Tài liệu tham khảo

[1]: https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/ "OWASP, Agentic AI — Threats and Mitigations"
[2]: https://www.nist.gov/itl/ai-risk-management-framework "NIST, AI Risk Management Framework"
[3]: https://sre.google/sre-book/handling-overload/ "Google SRE Book, Handling Overload"
[4]: https://developers.openai.com/api/docs/guides/evaluation-best-practices "OpenAI, Evaluation Best Practices"

## Đọc thêm

- [AI Agent Identity Is Not a User ID: Designing Delegation, Scope, and Revocation](/blog/agent-identity-delegation-revocation)
- [AI Agent Observability: Trace Prompts, Tool Calls, Tokens, and Cost Without Turning Logs into a Data Leak](/blog/agent-observability-without-data-leaks)
- [Human-in-the-Loop Is Not an Approve Button: Designing Action Gates Without Consent Fatigue](/blog/human-in-loop-action-gate-consent-fatigue)
