---
title: "Agent Receipt: Bằng chứng dễ đọc về những gì AI đã thay đổi"
description: "Thiết kế thực tế để đưa cho người dùng một bản tường trình ngắn gọn, có thể xác minh về những gì AI agent đã thay đổi, vì sao được phép làm và receipt không thể chứng minh điều gì."
pubDate: 2026-09-03
category: "engineering"
lang: "vi"
translationKey: "agent-receipts-user-readable-proof"
draft: false
image: "/blog/agent-receipts/hero.png"
---

Câu hỏi đầu tiên sau khi một AI agent thay đổi hồ sơ khách hàng hiếm khi là “Tôi có thể tìm trace ở đâu?”. Câu hỏi thường đơn giản hơn nhiều: **đã thay đổi điều gì, vì sao thay đổi và ai đã cho phép?**

Trace có thể trả lời những câu hỏi đó, nhưng chỉ sau khi ai đó biết phải mở trace nào, hiểu execution graph và tách quyết định quan trọng khỏi retry, model call và telemetry nội bộ. Raw log còn khó dùng hơn. Nó có thể chứa mọi event nhưng vẫn không đưa cho người bị ảnh hưởng một lời giải thích có thể sử dụng được.

Đó là vai trò của **agent receipt**: một bằng chứng ngắn gọn, dễ đọc về một outcome quan trọng do agent tạo ra. Receipt không phải transcript, dashboard, bản dump chain-of-thought hay sự thay thế cho audit trail. Nó là lớp cuối cùng nối một workflow tự động phức tạp với người cần hiểu tác động của nó.

![AI agent biến một action thành receipt dễ đọc với shield, timestamp, action summary và các evidence liên kết](/blog/agent-receipts/hero.png)

> **Luận điểm chính:** Agent receipt phải làm cho state đã thay đổi, authority, evidence và uncertainty trở nên dễ hiểu trong cùng một nơi. Người đọc có thể quyết định chấp nhận, điều tra, hoàn tác hoặc chuyển escalation mà không cần đọc toàn bộ execution trace.

Bài học thực hành về cryptographic receipt của Microsoft định nghĩa receipt là một JSON object ghi lại agent đã làm gì và được ký bằng chữ ký số. Tài liệu này nhấn mạnh ba bảo đảm hữu ích: attribution, integrity và ordering, đồng thời đặt ra một giới hạn quan trọng: receipt không chứng minh action là đúng hay policy đứng phía sau là hợp lý.[1] Chính giới hạn này phân biệt một thiết kế accountability trung thực với một chiếc badge “verified” chỉ để trang trí.

## Receipt không phải một log đẹp hơn

Log và trace được tối ưu cho operator. Receipt được tối ưu cho người đang có câu hỏi về một outcome.

Một trace có thể chứa 180 span: lắp prompt, retrieval, routing, tool selection, retry, cache miss, policy check và database call. Những chi tiết đó rất quan trọng khi debug. Nhưng chúng không phải giao diện đầu tiên phù hợp với khách hàng chỉ muốn biết địa chỉ giao hàng trên order có bị thay đổi hay không.

Receipt nén execution thành một outcome contract. Nó nói điều gì đã thay đổi, actor nào thực hiện hoặc phê duyệt, bằng chứng nào hỗ trợ, policy nào cho phép và người đọc có thể xác minh hoặc khiếu nại claim bằng cách nào.

| Artifact | Người đọc chính | Câu hỏi chính | Không nên giả vờ là |
|---|---|---|---|
| Log | Service operator | Những event nào đã xảy ra? | Một lời giải thích hoàn chỉnh cho khách hàng. |
| Trace | Engineer hoặc SRE | Thời gian, chi phí hay lỗi tích tụ ở đâu? | Bằng chứng rằng action là chính đáng. |
| Policy decision | Security hoặc platform owner | Action có được phép theo rule không? | Bằng chứng rằng action thực sự đã xảy ra. |
| Citation hoặc source list | Reviewer | Answer dựa vào nguồn nào? | Bằng chứng rằng side effect đã được áp dụng. |
| **Agent receipt** | User bị ảnh hưởng, reviewer, auditor | Điều gì đã đổi, theo authority nào, có evidence gì? | Bằng chứng rằng quyết định là sáng suốt hoặc policy là đúng. |

Phân biệt này quan trọng vì receipt là một **projection** của các record sâu hơn. Nó nên liên kết đến evidence và giữ stable identifier, nhưng không nên copy toàn bộ prompt và payload vào một data leak mới. Receipt dễ đọc nhưng không nối được với evidence authoritative chỉ là summary. Receipt chứa mọi secret lại là một sự cố đang chờ xảy ra.

## Bắt đầu từ state đã thay đổi

Receipt hữu ích nhất bắt đầu bằng state transition, không phải prose của model.

Giả sử support agent đổi mức ưu tiên của ticket từ `normal` thành `urgent`. Receipt cần hiển thị giá trị trước và sau, record mục tiêu, thời điểm thay đổi và status của action. Nó cũng phải nói rõ agent đã trực tiếp thay đổi record, tạo draft hay chỉ yêu cầu human approval để một hệ thống khác áp dụng.

```text
Change
  target: ticket://support/48291
  field: priority
  before: normal
  after: urgent
  status: applied
  applied_at: 2026-09-03T10:14:22Z
```

Điều này nghe hiển nhiên, nhưng nhiều hệ thống agent chỉ lưu câu trả lời cuối: “Tôi đã escalate ticket vì khách hàng báo sự cố dịch vụ.” Câu đó chưa đủ. Nó không xác định mutation chính xác, không phân biệt action đã được thử với action đã commit, cũng không cho người dùng biết agent có authority để làm việc đó hay không.

Receipt nên tách **intent**, **authorization**, **execution** và **observed result**. Bốn thứ này có thể khác nhau. Agent có thể định update ticket, nhận approval, timeout khi gọi hệ thống ticket rồi sau đó phát hiện update thực ra đã thành công. Receipt đáng tin không nên gom cả chuỗi này thành một câu tự tin.

## Receipt envelope thực tế

Một thiết kế hữu ích có hai representation: view dành cho người đọc và machine-verifiable envelope. Chúng dùng chung identifier và fact, nhưng phục vụ hai nhóm người khác nhau.

![Receipt envelope được tách lớp gồm action summary, actor và scope, evidence hash, policy decision cùng verification seal](/blog/agent-receipts/receipt-envelope.png)

View cho người đọc có thể được render thành card nhỏ, một phần của email, activity entry hoặc file tải về. Envelope có thể được lưu trữ và verify độc lập.

```json
{
  "type": "agent.change_receipt.v1",
  "receipt_id": "rcpt_01J7Q9K3M2",
  "workflow_id": "wf_support_triage",
  "agent": {
    "agent_id": "agt_support_triage_prod",
    "version": "2026.09.03.2"
  },
  "actor": {
    "subject": "support-automation",
    "authority": "ticket:write",
    "delegated_by": "customer-operations"
  },
  "change": {
    "target_ref": "ticket://support/48291",
    "field": "priority",
    "before_hash": "sha256:...",
    "after_hash": "sha256:...",
    "status": "applied"
  },
  "evidence": [
    {"ref": "case_note:8812", "role": "reported_outage"},
    {"ref": "policy:support-escalation-v4", "role": "authorization"}
  ],
  "verification": {
    "canonicalization": "JCS",
    "signature_algorithm": "EdDSA",
    "signature": "base64:...",
    "key_id": "gateway-key-2026-09"
  },
  "created_at": "2026-09-03T10:14:22Z"
}
```

Ví dụ cố ý lưu hash thay vì raw value nhạy cảm. UI có thể hiển thị “normal → urgent” cho người dùng có quyền, trong khi signed envelope giữ reference chống sửa đổi mà không nhân bản dữ liệu khách hàng.

Schema của receipt nên nhàm chán. Tên field ổn định, status rõ ràng, versioning và identifier dễ đoán quan trọng hơn một field prose giàu cảm xúc. Nhiều năm sau, hệ thống vẫn phải trả lời được câu hỏi: “Receipt này dùng format chính xác nào?”.

## Năm câu hỏi mọi receipt nên trả lời

Receipt tốt không cần phơi bày private reasoning của agent. Nó cần trả lời năm câu hỏi vận hành.

| Câu hỏi | Field trong receipt | Ví dụ |
|---|---|---|
| Điều gì đã thay đổi? | State transition | Ticket priority đổi từ normal thành urgent. |
| Actor nào thực hiện? | Agent và delegated authority | Support triage agent với `ticket:write`. |
| Vì sao được phép? | Policy và approval reference | Escalation policy v4, kèm approval ID nếu cần. |
| Claim dựa vào gì? | Evidence reference | Case note, source record, tool result hash. |
| Có thể verify hoặc challenge không? | Verification và recovery link | Signature status, trace ID, undo request, appeal path. |

Phần “vì sao” nên là decision summary, không phải một justification được model tự sinh. Ví dụ: “Action khớp với policy `support-escalation-v4` vì case có outage signal và account nằm trong khu vực bị ảnh hưởng.” Receipt có thể link đến policy evaluation và evidence mà không tuyên bố explanation nội bộ của model là nguyên nhân trung thực, đầy đủ.

Đây là nơi receipt cải thiện human experience. Điều tra không còn bắt đầu bằng “hãy tìm trong mọi thứ model từng thấy”, mà bằng “hãy kiểm tra năm fact quyết định outcome này có nên tồn tại hay không”. Trace chi tiết vẫn còn đó khi summary chưa đủ.

## Tách proof khỏi confidence

Chữ ký có thể chứng minh một gateway đáng tin đã ký payload cụ thể. Nó không chứng minh gateway đúng. Hash cho thấy evidence object không bị thay đổi. Nó không chứng minh evidence liên quan. Policy ID nhận diện rule được dùng. Nó không chứng minh rule phản ánh đúng ý định của tổ chức.

Vì vậy receipt nên hiển thị nhiều status khác nhau thay vì một nhãn “verified” màu xanh.

| Status | Ý nghĩa | Cách người dùng nên hiểu |
|---|---|---|
| Signed and linked | Envelope verify được và evidence reference đều resolve được. | Record còn nguyên và có attribution. |
| Signed, evidence pending | Signature đúng nhưng một hoặc nhiều evidence system đang unavailable. | Claim có attribution, nhưng review chưa hoàn tất. |
| Unsigned summary | Có UI summary nhưng không có envelope để verify. | Chỉ xem như convenience view, không phải proof. |
| Verification failed | Signature, ordering hoặc hash check thất bại. | Dừng dựa vào receipt và điều tra. |
| Outcome uncertain | Execution result chưa biết hoặc đang reconcile. | Không mô tả action là đã hoàn thành. |

Cách gọi status này tránh một lỗi phổ biến: dùng cryptography để tạo ra certainty giả. Nghiên cứu về verifiability-first agent cũng đặt vấn đề ở cấp độ rộng hơn: assurance nên giúp phát hiện và xử lý misalignment, không chỉ tạo ra một lời giải thích nghe hợp lý sau sự kiện.[2]

## Thiết kế receipt có ý thức về privacy

Receipt thường đi xa hơn hệ thống gốc. Người dùng có thể forward receipt cho support. Reviewer có thể export nó vào ticket. Auditor có thể giữ nó trong nhiều năm. Vì vậy data minimization phải là một phần của thiết kế receipt.

Dùng reference ổn định thay vì copy raw prompt, full tool payload, secret, access token hay toàn bộ conversation history không liên quan. Redact field theo scope của người đọc, không theo một rule redaction toàn cục. Khách hàng có thể thấy địa chỉ đã đổi nhưng không thấy điểm fraud nội bộ. Support agent có thể thấy source ticket. Security reviewer có thể thấy metadata của policy evaluation.

Receipt bị redact nên nói rõ có thứ bị redact và lý do. Bỏ im lặng tạo ra ambiguity: agent không dùng evidence đó, hay người đọc không có quyền xem?

```text
Evidence: 3 references
  visible: customer_case:8812
  visible: policy:support-escalation-v4
  restricted: risk_signal:••••
  restriction_reason: security.review scope required
```

Đừng biến receipt thành side channel cho dữ liệu nhạy cảm. Ngay cả hash cũng có thể làm lộ thông tin nếu attacker đoán được giá trị gốc. Hash là kỹ thuật integrity, không phải kỹ thuật privacy vạn năng.

## Verification phải là product path bình thường

Receipt có thể verify về mặt kỹ thuật nhưng vẫn thất bại nếu trên giao diện không ai biết cách verify. Sản phẩm nên có đường dẫn rõ ràng như “xem evidence”, “verify integrity”, “request review” hoặc “undo”, tùy risk của action.

![Verification flow đi từ agent gateway qua canonicalization và hash check đến reviewer, với các kết quả pass, warning và unverifiable](/blog/agent-receipts/verification-flow.png)

Verification service nên đủ độc lập để cùng team hoặc cùng process tạo action không thể âm thầm viết lại evidence. Một flow điển hình là:

```text
receipt received
  -> parse version and identifiers
  -> canonicalize signed fields
  -> verify signature
  -> verify hash and sequence links
  -> resolve evidence references by access scope
  -> compare claimed status with authoritative state
  -> return verified, warning, failed, or unknown
```

Canonicalization quan trọng vì hai JSON serializer có thể biểu diễn cùng một object logic thành các byte khác nhau. Bài học của Microsoft dùng JSON Canonicalization Scheme và Ed25519 signing, sau đó thêm hash của receipt trước để làm cho thứ tự trở nên tamper-evident.[1] Team không nhất thiết phải copy nguyên stack đó, nhưng cần chọn encoding có thể tái lập, key lifecycle được quản lý và procedure verify có thể được thực hiện bởi nhiều hơn một component.

Bước cuối đặc biệt quan trọng: **đối chiếu state được claim với source of truth**. Receipt hợp lệ có thể nói database update đã apply, trong khi record sau đó đã bị người khác hoặc agent khác thay đổi. Integrity của receipt không đồng nghĩa với freshness của thế giới.

## Receipt cho outcome không chắc chắn

Distributed system tạo ra những khoảnh khắc rất khó chịu. Tool call timeout sau khi remote service đã nhận request. Queue acknowledge delivery nhưng worker crash trước khi phát result. Browser agent mất session ngay sau khi click “submit”.

Agent receipt phải làm uncertainty trở nên rõ ràng:

```text
Action: refund request
Execution: accepted by payment provider
Local observation: timeout before confirmation
Receipt status: outcome-uncertain
Next step: reconcile with provider reference pay_8f2...
```

Cách này hữu ích hơn “failed” hoặc “completed”. “Failed” có thể khiến hệ thống gửi duplicate action. “Completed” có thể khiến người dùng tin tiền đã chuyển trong khi chưa biết. Receipt có thể trỏ đến reconciliation task, retry policy hoặc human review queue mà không giả vờ hệ thống biết nhiều hơn thực tế.

Điều tương tự áp dụng với reversal. Nếu action có thể hoàn tác, receipt cần cho biết undo có tồn tại không, còn hiệu lực đến khi nào và bản thân undo có tạo receipt mới không. Đừng sửa receipt gốc để lịch sử trông sạch hơn. Hãy append một correction hoặc reversal receipt trỏ về receipt cũ.

## Receipt là điểm cuối của một chuỗi, không phải toàn bộ chuỗi

Một agent platform trưởng thành có thể đã có identity, policy, observability, evidence và recovery system. Receipt nên nối các hệ thống đó ở một boundary ổn định.

![Một người dùng review receipt bên cạnh customer record trước và sau khi thay đổi, evidence trail và vùng uncertainty hiển thị rõ](/blog/agent-receipts/receipt-ux.png)

Pattern triển khai hữu ích nhất là chỉ generate receipt sau khi hệ thống có authoritative action result — hoặc phát provisional receipt một cách rõ ràng khi result chưa biết. Receipt generator nên đọc structured event, không nên yêu cầu model tự nhớ và tóm tắt hành vi của chính nó.

Một sequence thực tế trong production có thể là:

1. Orchestrator tạo immutable workflow ID và action ID.
2. Policy layer ghi lại decision cùng authority scope.
3. Tool adapter ghi requested mutation và authoritative result.
4. Evidence service gán reference ổn định và access classification.
5. Receipt service render human view và ký machine envelope.
6. Product mở verification, review và recovery path.
7. Correction về sau tạo linked receipt mới thay vì rewrite history.

Thiết kế này cũng tạo ra một test surface hữu ích. Hãy test rằng receipt không được phát cho action chưa commit. Hãy test timeout phải tạo `outcome-uncertain`, không phải false success. Hãy test user không có evidence scope sẽ thấy marker redact thay vì payload tình cờ bị lộ. Hãy test policy version thay đổi phải hiển thị trong receipt. Hãy test tampering làm verification fail và tạo operational alert.

## Receipt không giải quyết được điều gì

Receipt không giải quyết authorization kém, tool nguy hiểm, evidence yếu, claim hallucinated hay business policy được thiết kế tệ. Agent không tự trở nên đáng tin chỉ vì gateway ký output. Receipt không thay thế trace để debug, ledger để accounting, policy engine để authorization hay recovery system cho partial side effect.

Nó giải quyết một vấn đề hẹp nhưng rất quan trọng: **làm cho outcome của agent trở nên dễ hiểu và có trách nhiệm ở đúng điểm con người cần hành động**.

Sự hẹp này là ưu điểm. Khi mọi artifact đều cố trở thành toàn bộ history, kết quả sẽ khó đọc và phơi bày quá nhiều dữ liệu. Receipt nên đủ nhỏ để chia sẻ, đủ chính xác để verify, đủ trung thực để thể hiện uncertainty và đủ liên kết để hỗ trợ điều tra sâu hơn.

Receipt tốt nhất không yêu cầu người dùng tin explanation của agent. Nó đưa ra câu trả lời rõ về điều đã thay đổi, đường dẫn đến evidence, record về authority và cách challenge outcome. Đó là nền tảng thực tế cho trust — không phải vì receipt biến automation thành không thể sai, mà vì nó làm cho boundary giữa action và accountability trở nên nhìn thấy được.

## References

[1]: https://microsoft.github.io/ai-agents-for-beginners/18-securing-ai-agents/ "Microsoft — Securing AI Agents with Cryptographic Receipts"
[2]: https://arxiv.org/abs/2512.17259 "Abhivansh Gupta — Verifiability-First Agents: Provable Observability and Lightweight Audit Agents for Controlling Autonomous LLM Systems"
