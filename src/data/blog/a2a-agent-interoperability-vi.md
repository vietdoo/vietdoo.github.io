---
title: "Beyond Tool Calls: Thiết kế Agent-to-Agent Collaboration đáng tin cậy với A2A"
description: "Góc nhìn system design thực tế về Agent Card, task lifecycle, capability negotiation, streaming, push update và trust boundary trong hệ thống agent-to-agent."
pubDate: 2026-05-26
category: "architecture"
image: "/blog/a2a-agent-interoperability/hero.webp"
lang: "vi"
translationKey: "a2a-agent-interoperability"
draft: false
---

![Client agent ủy quyền một task có giới hạn cho remote agent qua ranh giới giao thức A2A](/blog/a2a-agent-interoperability/hero.webp)

Trước đây, tôi thường mô tả mọi tích hợp AI bằng cụm từ **tool call**. Đây là một cách đơn giản hóa hữu ích: model chọn một function, function trả dữ liệu, rồi model tiếp tục suy luận. Nhưng hệ thống lớn dần lên. Một customer-support agent cần gọi specialist của team khác. Một research agent cần nhờ compliance agent kiểm tra. Một scheduling agent cần yêu cầu booking agent giữ chỗ trong vài phút, trong lúc con người xác nhận thông tin.

Đến lúc đó, gọi hệ thống bên kia là một “tool” bắt đầu che giấu nhiều hơn là giải thích. Remote system có thể có model, memory, policy, user context, runtime và failure mode riêng. Nó có thể không hề chia sẻ chain-of-thought hay danh sách tool nội bộ. Thứ đi qua ranh giới không còn là implementation của một function; đó là một cuộc trao đổi về task, authority, tiến độ và kết quả.

Đó là không gian bài toán mà **Agent2Agent (A2A)** hướng tới: một open protocol cho phép các agentic application có thể cộng tác dù được xây dựng bởi framework hay vendor khác nhau. Thiết kế chính thức nhấn mạnh agent discovery, các transport tiêu chuẩn, enterprise authentication, long-running task, state update và trao đổi dữ liệu đa dạng. Đặc tả mới nhất tổ chức các ý tưởng đó thành operation, data model, cơ chế cập nhật task, capability validation, versioning và security object.

Điểm quan trọng không phải là mọi agent phải lập tức trở thành một phần của “swarm” tự trị khổng lồ. Điểm quan trọng là **một agent-to-agent call chính là một ranh giới của distributed system**. Khi nhìn nó theo cách đó, hàng loạt câu hỏi thiết kế trở nên bắt buộc: Làm sao client biết remote agent thực sự làm được gì? Quyền được ủy quyền bị giới hạn ra sao? “Đang xử lý” có ý nghĩa gì? Điều gì xảy ra khi stream bị ngắt giữa chừng? Client có thể retry an toàn không? Con người hủy một công việc đã bắt đầu như thế nào?

Bài viết này xây dựng một mental model thực tế để trả lời các câu hỏi đó. Đây không phải tutorial về SDK, cũng không phải product announcement. Đây là hướng dẫn theo góc nhìn production về những contract giúp agent collaboration có thể quan sát, kiểm soát và phục hồi.

## Ranh giới này không phải function signature

Một API thông thường thường cho chúng ta mô tả ổn định về một operation. Ta biết endpoint, input schema, output schema và thường cả error code kỳ vọng. Tool call cũng có thể dùng mental model đó vì ta giả định tool nằm trong control plane mà caller kiểm soát.

Agent-to-agent interaction khác ở ba điểm.

Thứ nhất, remote agent có thể là một **hệ thống opaque**. Client không nên giả định nó dùng model nào, lập plan ra sao, gọi tool gì hay lưu intermediate state ở đâu. Client chỉ có thể suy luận về remote agent thông qua protocol surface, chứ không thể phụ thuộc an toàn vào chi tiết implementation bên trong.

Thứ hai, công việc có thể **chạy trong thời gian dài**. Một request có thể hoàn tất ngay, hoặc tạo ra một task cần thêm input, phát ra artifact trung gian, chờ hệ thống thứ ba, hay giữ trạng thái trong lúc con người review quyết định. Một HTTP response đơn lẻ không đủ mô tả lifecycle đó.

Thứ ba, kết quả có thể **không chỉ là text**. Remote agent có thể trả về JSON có cấu trúc, file, link, status update hoặc nhiều artifact sinh ra ở các thời điểm khác nhau. Vì vậy client cần hiểu không chỉ câu trả lời, mà cả delivery mode và trạng thái của công việc.

Một cách tóm tắt hữu ích là:

> Tool call hỏi: “Tôi nên gọi function nào?” Agent-to-agent call hỏi: “Tôi có thể ủy quyền capability tự trị nào, theo contract nào, với những update nào và trong giới hạn authority nào?”

Sự khác biệt đó làm thay đổi kiến trúc. Agent gọi trở thành client. Remote agent trở thành server với policy và runtime riêng. Message là intent, nhưng task là một protocol object có thể sống lâu hơn một request. Artifact là kết quả của công việc, không chỉ là return value.

![Luồng discovery và delegation biến Agent Card thành capability contract trước khi task được gửi đi](/blog/a2a-agent-interoperability/agent-card.webp)

_Hình 1. Discovery phải thu hẹp ranh giới delegation trước khi client gửi task._

## Agent Card là capability contract, không phải hồ sơ marketing

Client không thể ủy quyền có trách nhiệm nếu chỉ biết một remote endpoint đang tồn tại. Nó cần một mô tả machine-readable về identity, skill, interface, authentication requirement và capability mà remote agent hỗ trợ. A2A gọi mô tả này là **Agent Card**.

Ta rất dễ xem Agent Card như một entry trong catalogue: tên, mô tả và danh sách những việc agent tuyên bố có thể làm. Production cần nhiều hơn thế. Một card hữu ích gần với capability contract. Nó giúp client trả lời bốn câu hỏi thực tế trước khi gửi dữ liệu người dùng sang boundary bên kia.

| Câu hỏi                               | Client cần biết                                                              | Vì sao quan trọng                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Agent này có làm được việc không?** | Skill, input/output modality và kiểu task được hỗ trợ                        | Tránh route request đến agent tạo ra output nghe hợp lý nhưng không dùng được.    |
| **Tôi kết nối bằng cách nào?**        | Interface và transport được hỗ trợ                                           | Cho phép chọn synchronous, streaming hay asynchronous delivery một cách có chủ ý. |
| **Agent cần authority gì?**           | Authentication scheme, scope, audience và consent                            | Ngăn capability match biến thành lỗi authorization.                               |
| **Làm sao biết chuyện gì đã xảy ra?** | Hỗ trợ task, streaming, push notification, cancellation và artifact behavior | Khiến failure và recovery trở thành một phần của thiết kế tích hợp.               |

Agent Card cũng phải được xem là **untrusted input**. Remote agent có thể quảng cáo một skill có thật về mặt kỹ thuật nhưng không phù hợp với tenant, user, data classification hay budget hiện tại. Discovery không phải authorization. Capability matching không phải consent. Client vẫn cần local policy layer để lọc card theo authority của user và các rule rủi ro của application.

Đây là điểm A2A khác một service registry đơn giản. Registry trả lời: “Service nằm ở đâu?” Agent Card giúp trả lời: “Agent hỗ trợ kiểu interaction nào?” Còn client vẫn phải tự quyết định: “Request này có được phép sử dụng agent đó không?”

### Capability negotiation phải rõ ràng

Hãy tưởng tượng một `TravelOps Agent` muốn hỏi `Policy Agent` ở xa xem một loại vé có được hoàn tiền hay không. Policy agent có thể hỗ trợ text và structured JSON nhưng không nhận file upload. Nó có thể trả lời đồng bộ cho câu hỏi đơn giản, nhưng tạo task cho policy analysis cần human review. Nó có thể yêu cầu OAuth với một audience cụ thể. Nếu client bỏ qua những thông tin này, incompatibility sẽ chỉ lộ ra sau khi request được gửi — hoặc tệ hơn, sau khi dữ liệu không nên rời khỏi hệ thống đã vượt qua boundary.

Một sequence an toàn hơn sẽ là:

1. Lấy hoặc resolve Agent Card qua một discovery path đáng tin cậy.
2. Kiểm tra origin, signature hoặc transport trust, độ mới và schema version của card.
3. Đối chiếu skill và modality với task hiện tại.
4. Áp dụng local policy về tenant, user, data classification, budget và consent.
5. Chọn interface ít quyền nhất nhưng vẫn hoàn tất được công việc.
6. Chỉ gửi context tối thiểu cần thiết cho task được ủy quyền.

Bước thứ sáu quan trọng hơn vẻ bề ngoài. Remote agent không cần toàn bộ conversation history của caller chỉ vì về mặt kỹ thuật client có thể gửi nó. Client nên tạo một delegation envelope hẹp: objective mà user đã cho phép, facts liên quan, constraints và form kết quả kỳ vọng. Boundary như vậy dễ audit hơn và giảm nguy cơ rò rỉ context ngoài ý muốn.

## Task là state machine có owner

Thay đổi thiết kế quan trọng nhất là ngừng xem delegated request như một response đơn lẻ. Remote agent có thể trả về một **Task**, một object có state và đi qua lifecycle được định nghĩa. Từ vựng chính xác của protocol không quan trọng bằng kỷ luật engineering phía sau: client cần biết công việc đã được accept, đang chạy, cần thêm input, hoàn tất, thất bại hay đã bị hủy.

![Task đi qua các trạng thái rõ ràng thay vì bị biểu diễn bằng một response mơ hồ](/blog/a2a-agent-interoperability/task-lifecycle.webp)

_Hình 2. Task state rõ ràng giúp client phân biệt progress, failure, cancellation và yêu cầu thêm input._

Task nên có identity ổn định và ownership rõ ràng. Client sở hữu mối quan hệ với user; remote agent sở hữu execution của task; protocol nối hai phía. Nếu client mất network connection, điều đó không tự động có nghĩa remote work biến mất. Ngược lại, remote agent cũng không nên mặc định client bị bỏ rơi vẫn muốn task chạy vô hạn.

Từ đó phát sinh những câu hỏi contract hữu ích:

| Câu hỏi về lifecycle          | Quyết định cần làm rõ                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Ai tạo task identifier?       | Server cấp, client gửi idempotency key, hay giữ cả hai loại identifier?                    |
| Ai được đổi task state?       | Remote agent báo execution state; client chỉ request cancellation khi có quyền.            |
| `input-required` nghĩa là gì? | Loại response nào được chấp nhận và task được chờ trong bao lâu?                           |
| Trạng thái nào là terminal?   | `completed`, `failed`, `rejected`, `canceled` và việc terminal state có được mở lại không. |
| Artifact nằm ở đâu?           | Nằm trực tiếp trong task, được tham chiếu hay phát ra như update?                          |

State machine không phải thủ tục rườm rà. Nó là lượng thông tin tối thiểu để UI không nói dối. Không có state rõ ràng, application biến mọi non-final response thành “loading”, mọi timeout thành “failed”, và mọi connection loss thành “unknown”. Những shortcut ấy có thể vô hại trong demo nhưng rất đắt trong production.

### `input-required` là một outcome hạng nhất

Nhiều thiết kế agent xem yêu cầu làm rõ như một exception. Trong collaboration chạy lâu, đó là chuyện bình thường. Remote agent có thể cần ngày tháng còn thiếu, quyết định consent, document hoặc confirmation rằng side effect được phép thực hiện.

Client không nên âm thầm trả lời thay user. Nó phải hiển thị câu hỏi, giữ nguyên task identity và resume interaction bằng một response có giới hạn. Điều đó yêu cầu task state tồn tại qua nhiều turn, còn UI phải phân biệt “hệ thống đang suy nghĩ” với “hệ thống đang chờ bạn”.

Phân biệt này cũng giúp kiểm soát cost. Khi task chờ con người, client có thể dừng polling, đặt expiration policy và tránh gửi lại cùng một context nhiều lần. Thiết kế asynchronous tốt tiết kiệm cả token lẫn sự bối rối.

## Chọn delivery semantics một cách có chủ ý

A2A hỗ trợ nhiều cách giao progress và result. Client có thể nhận response ngay, subscribe vào stream update hoặc cấu hình push notification cho công việc asynchronous. Đây không chỉ là lựa chọn transport. Mỗi kiểu kéo theo một UX và failure mode khác nhau.

Synchronous delivery phù hợp với task ngắn, có giới hạn và ít khả năng cần con người. Nó giữ request path đơn giản nhưng không phù hợp với công việc kéo dài vài phút hay vài giờ. Streaming hữu ích khi client cần status hoặc artifact tăng dần trong lúc task chạy. Nó làm hệ thống phản hồi nhanh hơn, nhưng đưa vào bài toán reconnect, event ordering và duplicate event. Push notification hữu ích khi client không nên giữ connection mở, nhưng yêu cầu callback handler an toàn, replay protection và chiến lược fetch authoritative task state sau khi nhận notification.

Client nên định nghĩa delivery policy thay vì để model chọn tùy ý. Ví dụ:

| Tình huống                                 | Mode ưu tiên                  | Guardrail cần thêm                                                           |
| ------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------- |
| Policy lookup ngắn với JSON nhỏ            | Synchronous                   | Timeout chặt và giới hạn output size                                         |
| Report được ghép từ nhiều specialist agent | Streaming                     | Event ordering, cursor hoặc resubscription và semantics của partial artifact |
| Task chờ human approval                    | Push hoặc task polling        | Expiration, identity binding và resume action rõ ràng                        |
| Booking hoặc thay đổi state                | Task kèm confirmation rõ ràng | Idempotency, cancellation, audit trail và kế hoạch compensation              |

Điểm cốt lõi là tách **delivery state** khỏi **task state**. Stream có thể ngắt trong khi task vẫn `working`. Push notification có thể được giao hai lần trong khi task chỉ tiến lên một lần. Client phải reconnect hoặc retrieve task được mà không cần đoán chuyện gì xảy ra dựa trên message cuối cùng nó nhìn thấy.

## Retry là quyết định của protocol, không phải thói quen HTTP chung chung

Retry nguy hiểm khi delegated operation có thể tạo side effect. Nếu client timeout sau khi gửi “hãy giữ itinerary này”, nó không biết remote agent chưa nhận gì, đã accept task hay đã hoàn tất hold trước khi response bị mất. Retry mù có thể tạo duplicate reservation, duplicate message hoặc task xung đột.

Client cần chiến lược idempotency. Phiên bản đơn giản nhất là một key ổn định được tạo từ logical operation, không phải từ từng network attempt. Remote agent dùng key đó để nhận diện replay và trả lại task/result hiện có thay vì tạo side effect thứ hai. Scope và lifetime của key phải rõ: theo user request, theo task, theo tenant hay một boundary khác do application chọn.

Idempotency không khiến mọi operation tự động an toàn. Nó chỉ giúp nhận diện request lặp. Remote agent vẫn cần business rule cho partial completion, hold đã hết hạn, external system không hỗ trợ idempotency và retry sau terminal failure. Client nên cho user thấy semantics đó thay vì biến chúng thành một câu trả lời tự tin nhưng mơ hồ.

Cancellation cũng có sắc thái tương tự. Cancellation request có thể đến sau khi công việc đã hoàn tất, trong lúc side effect đang chạy hoặc sau khi external system đã commit thay đổi. Vì thế “cancel” nên được model như một request có result, không phải phép xóa kỳ diệu lịch sử. Task record cần giữ lại chuyện đã xảy ra và có cần compensation hay không.

## Hãy tin vào boundary, không phải lời văn của agent

Agent có thể nói rằng nó đã hoàn tất booking, revoke token hoặc đính kèm file. Client không nên xem câu nói đó là bằng chứng. Protocol result cần gắn với structured task state, identifier, artifact và — khi phù hợp — authoritative system of record.

Điều này đặc biệt quan trọng khi remote agent là opaque. Client có thể không inspect được tool call bên trong nó, vì vậy cần kiểm tra những thứ có thể kiểm tra ở boundary:

| Bằng chứng ở boundary | Ví dụ validation                                                       |
| --------------------- | ---------------------------------------------------------------------- |
| Task state            | Task đã tới `completed`, không chỉ sinh ra một câu văn tự tin.         |
| Artifact identity     | File hoặc JSON có stable identifier và schema kỳ vọng.                 |
| Authorization         | Request sang remote dùng đúng audience và scope.                       |
| Business outcome      | Source system xác nhận reservation, case update hoặc policy decision.  |
| Audit metadata        | Trace ghi caller, remote agent, task ID, policy decision và timestamp. |

Đây không phải lời kêu gọi phải expose hidden reasoning. Đây là yêu cầu expose **observable contract**. Client cần đủ evidence để quyết định nên nói với user “đã xong”, “đang chờ”, “thất bại” hay “tôi cần bạn hỗ trợ”.

## Các production gate cho agent-to-agent call

Khi phần cơ bản đã chạy, team thường phát hiện protocol không phải phần khó nhất. Phần khó là vận hành một boundary nơi hai autonomous system đều có thể hợp lý ở local level nhưng vẫn tạo ra kết quả không an toàn ở global level.

![Production path kiểm tra capability, authorization, retry safety, bounded work và traceability trước delegation](/blog/a2a-agent-interoperability/reliability-gates.webp)

_Hình 3. Reliability là chuỗi gate trước delegation, không phải một prompt pass/fail duy nhất._

Một production gate thực tế nên trả lời những câu hỏi sau trước khi request rời client.

**Capability.** Agent Card của remote có skill, modality, interface và task behavior cần thiết không? Card còn đủ mới so với mức rủi ro của request không? Capability hoặc endpoint có thay đổi từ lần approval trước không?

**Authorization.** Caller có được phép gửi loại dữ liệu và action này tới agent cụ thể này không? Audience, scope, tenant, user consent có khớp nhau không? Remote agent có chứng minh được nó đang hành động thay principal nào không?

**Context minimization.** Payload có chỉ chứa facts cần cho task không? Secret, conversation turn không liên quan và internal instruction có bị loại ra không? Artifact có được phân loại trước khi gửi qua boundary không?

**Reliability.** Operation có idempotent hay ít nhất retry-safe không? Timeout, cancellation và maximum task duration đã định nghĩa chưa? Client có phục hồi task sau network failure được không? Remote agent có terminal state rõ ràng không?

**Observability.** Team có correlate được client trace, remote task ID, artifact, policy decision và user-visible outcome mà không log sensitive payload không? Operator có dựng lại timeline mà không phải đọc từng token không?

**Human control.** State nào cần human decision? User có pause, cancel, reject hoặc amend task được không? UI có làm pending approval hiện rõ thay vì giấu sau một spinner không?

Các gate này nên dùng deterministic check ở nơi fact có thể kiểm tra được. Model có thể hỗ trợ hiểu intent của user, nhưng không nên là authority cuối cùng để quyết định OAuth audience có khớp không, idempotency key có tồn tại không, task có vượt budget không hay user đã consent chưa.

## Một reference pattern: TravelOps ủy quyền nhưng không buông quyền kiểm soát

Hãy xem một nền tảng du lịch nhỏ có ba agent. `TravelOps Agent` nói chuyện với user. `Policy Agent` giải thích fare rule. `Booking Agent` có thể tạo temporary hold nhưng không thể finalize purchase nếu chưa có approval riêng.

User hỏi: “Tìm cho tôi chuyến bay buổi tối có thể hoàn tiền và giữ option tốt nhất trong lúc tôi hỏi ý kiến manager.” TravelOps trước tiên resolve card của Policy và Booking agent. Nó biết Policy hỗ trợ structured policy answer, còn Booking hỗ trợ long-running task với hold artifact. Local policy cho phép TravelOps gửi route, date, traveler constraint và budget, nhưng không gửi toàn bộ conversation history.

TravelOps hỏi Policy về điều kiện refundability. Request này có thể chạy synchronous. Sau đó nó yêu cầu Booking tạo hold task. Request có logical idempotency key và response preference cho task update. Booking báo `working`, phát ra candidate artifact và cuối cùng chuyển sang `input-required` vì fare được chọn cần xác nhận một chi tiết của passenger. TravelOps hiển thị câu hỏi cho user thay vì tự đoán.

Nếu user xác nhận, TravelOps resume task hiện có. Nếu user hủy, TravelOps request cancellation và hiển thị state kết quả. Nếu network lỗi sau khi task đã được tạo, TravelOps retrieve task bằng identifier thay vì tạo một hold mới. Nếu Booking báo `completed`, TravelOps vẫn kiểm tra hold identifier có tồn tại trong booking system trước khi nói với user rằng option đã được giữ.

Không bước nào trong flow này yêu cầu client biết Booking dùng model nào hay gọi tool nội bộ nào. Collaboration hữu ích chính vì contract tập trung vào capability, state, authority và evidence — không phụ thuộc vào implementation trivia.

## Cần test gì trước khi ship?

A2A integration nên được test ở ba bề mặt. Thứ nhất là discovery: client có parse Agent Card được không, có reject version không tương thích không, có áp dụng local policy và chọn interface ít quyền nhất không? Thứ hai là protocol behavior: client có xử lý synchronous reply, task creation, streaming update, push notification, resubscription, cancellation, duplicate delivery và terminal error không? Thứ ba là business outcome: source system có xác nhận kết quả không, và UI có nói đúng sự thật khi remote agent không chắc chắn hoặc không khả dụng không?

Một test case hữu ích nên gồm user intent ban đầu, capability match kỳ vọng, field được phép và bị cấm, delivery mode, idempotency key, maximum duration, task transition kỳ vọng và evidence cần cho success. Đừng chỉ chấm câu cuối cùng. Remote agent nói “booking đã được giữ” nhưng không trả hold identifier thì phải fail contract, dù prose nghe hoàn hảo.

Những negative test đáng giá nhất thường rất đời thường. Gửi một Agent Card cũ. Bỏ scope bắt buộc. Ngắt stream sau khi task bắt đầu. Giao cùng một push notification hai lần. Trả về task chờ input quá lâu. Retry request sau timeout. Yêu cầu client gửi một secret không liên quan vào delegation context. Một hệ thống sống sót qua các case này đáng tin hơn hệ thống chỉ trình diễn happy path sạch sẽ.

## Kết luận

Agent-to-agent interoperability không xóa bỏ độ phức tạp của agentic system. Nó làm complexity hiện lên ở một boundary nơi engineer có thể reasoning về nó. Đó là một trade-off đáng giá.

Design pattern bền vững khá rõ: discover capability bằng contract, lọc qua local policy, delegate context nhỏ nhất nhưng đủ dùng, biểu diễn công việc như task có lifecycle rõ, chọn delivery semantic có chủ ý, làm retry và cancellation an toàn, rồi verify outcome bằng evidence mạnh hơn lời văn của agent.

Giá trị của A2A không nằm ở việc các agent có thể nói chuyện với nhau. Chúng vốn đã làm được điều đó bằng những cách tự phát. Giá trị nằm ở khả năng biến collaboration thành thứ **có thể inspect, negotiate và recover** giữa các hệ thống độc lập. Đó mới là tiêu chuẩn đáng để thiết kế.

## Tài liệu tham khảo

[1]: https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/ "Announcing the Agent2Agent Protocol (A2A) - Google Developers Blog"
[2]: https://a2a-protocol.org/latest/specification/ "Agent2Agent (A2A) Protocol Specification"
[3]: https://github.com/a2aproject/A2A "Agent2Agent official repository"
