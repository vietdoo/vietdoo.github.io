---
title: "Khi AI chỉ trả lời được một phần: Thiết kế UX cho sự không chắc chắn"
description: "Một sản phẩm AI đáng tin không che giấu sự không chắc chắn sau một đoạn văn trôi chảy. Nó làm rõ phần thiếu bằng chứng, chọn đường phục hồi an toàn và giúp người dùng biết bước tiếp theo."
pubDate: 2026-04-19
category: "engineering"
image: "/blog/ai-partial-answer-uncertainty/hero.webp"
lang: "vi"
translationKey: "ai-partial-answer-uncertainty-ux"
draft: false
---

![Khay bằng chứng đi qua cổng quyết định để dẫn tới câu trả lời, câu hỏi làm rõ hoặc chuyển cho con người](/blog/ai-partial-answer-uncertainty/hero.webp)

Tôi từng thấy một trợ lý tạo ra một câu trả lời được viết rất đẹp nhưng đáng lẽ không bao giờ được hiển thị như một kết quả hoàn chỉnh.

Người dùng yêu cầu tóm tắt một thay đổi trong chính sách. Hệ thống tìm thấy hai tài liệu liên quan, không lấy được phần phụ lục chứa ngoại lệ, rồi vẫn viết ra một đoạn văn đầy tự tin. Không chi tiết nào trong câu chữ cho thấy có phần bị thiếu. Câu trả lời không hoàn toàn bịa đặt, nhưng lại nguy hiểm hơn một lỗi dễ nhận biết vì nó trông như đã hoàn tất.

Đó là vấn đề sản phẩm nằm phía sau sự không chắc chắn. Một mô hình có thể hữu ích dù chưa đầy đủ. Nó có đủ bằng chứng cho phần này của yêu cầu, không có bằng chứng cho phần khác, và gặp hai nguồn mâu thuẫn ở phần thứ ba. Nếu giao diện chỉ có hai trạng thái là đang tải và đã xong, hệ thống sẽ bị đẩy vào việc biến mọi tình huống mơ hồ thành một câu trả lời trôi chảy.

> **Luận điểm chính:** Câu trả lời một phần không chỉ là một completion yếu hơn. Đó là một trạng thái sản phẩm độc lập, có hợp đồng bằng chứng, ngôn ngữ, đường phục hồi và tiêu chí đánh giá riêng.

Bài viết này trình bày một cách tiếp cận thực tế cho failure UX trong sản phẩm AI. Mục tiêu không phải là đặt một điểm confidence khó hiểu cạnh từng câu. Mục tiêu là làm rõ ranh giới của hệ thống, giữ quyền chủ động cho người dùng và tạo ra con đường ngắn nhất, an toàn nhất để đi tới kết quả tốt hơn.

## Câu trả lời trôi chảy không phải toàn bộ trạng thái

Phần mềm truyền thống thường có điều kiện thành công tương đối rõ. Truy vấn cơ sở dữ liệu trả về các dòng hoặc một lỗi. Biểu mẫu được chấp nhận hoặc bị từ chối. Tệp tải lên hoàn tất hoặc thất bại. Hệ thống sinh nội dung thì khác: nó có thể trả về một artifact có vẻ hợp lý ngay cả khi ngữ cảnh hỗ trợ mỏng, mâu thuẫn hoặc nằm ngoài phạm vi của mô hình.

Điều đó làm thay đổi ý nghĩa của “đã xong”. Câu trả lời không hoàn tất chỉ vì luồng token đi tới stop condition. Nó hoàn tất khi hệ thống có thể giải thích, ở mức phù hợp với tác vụ, phần nào được hỗ trợ, phần nào chưa chắc chắn và người dùng có thể làm gì tiếp theo.

Điểm này quan trọng vì con người sẽ điều chỉnh hành vi dựa trên thông điệp của AI. Nghiên cứu về selective prediction cho thấy quyết định defer của hệ thống và cách quyết định đó được truyền đạt có thể thay đổi hiệu quả của con người. Trong một nghiên cứu của AAAI, khi được cho biết AI đã chuyển một trường hợp cho con người—nhưng không đơn giản là phơi ra dự đoán thiếu chắc chắn của mô hình—nhóm người và AI đạt kết quả tốt hơn.[1] Như vậy, giao diện là một phần của cơ chế tin cậy chứ không phải lớp trang trí thêm vào sau mô hình.

![Bốn trạng thái bằng chứng tiến tới quyết định trả lời mà không giả vờ rằng mọi trạng thái đều hoàn chỉnh](/blog/ai-partial-answer-uncertainty/evidence-states.webp)

## Mô hình hóa trạng thái bằng chứng thay vì một con số confidence chung chung

Một xác suất duy nhất rất hấp dẫn vì nó dễ hiển thị. Nhưng nó thường quá mơ hồ cho một quyết định sản phẩm. “Confidence 0,72” có thể nghĩa là classifier đã được calibration trên một phân phối quen thuộc, điểm retrieval vừa vượt threshold, hoặc đơn giản là language model tạo ra một chuỗi có xác suất cao. Đó là những sự thật khác nhau.

Một lớp đầu tiên hữu ích hơn là một nhóm nhỏ các trạng thái bằng chứng. Chúng mô tả hệ thống có thể nói gì một cách có trách nhiệm, thay vì giả vờ phơi ra một xác suất nội tại chính xác.

| Trạng thái | Hệ thống biết gì | Cách phản hồi an toàn | Hành động tiếp theo thường gặp |
|---|---|---|---|
| **Được hỗ trợ** | Câu trả lời dựa trên bằng chứng liên quan, đủ mới và không có mâu thuẫn đang hoạt động. | Trả lời trực tiếp, chỉ rõ nguồn hoặc ranh giới suy luận và giữ phạm vi chính xác. | Tiếp tục hoặc hoàn tất tác vụ. |
| **Một phần** | Một số claim được hỗ trợ nhưng một hoặc nhiều phần chưa có đủ bằng chứng. | Tách claim đã có căn cứ khỏi phần chưa giải quyết. Không dùng giọng văn tự tin để lấp khoảng trống. | Hỏi phần còn thiếu hoặc đưa ra câu trả lời giới hạn. |
| **Thiếu** | Hệ thống không nhận được bằng chứng đủ để hỗ trợ claim được hỏi. | Nói rõ bằng chứng hiện không có. Không biến phỏng đoán thành bản tóm tắt. | Làm rõ yêu cầu, tìm nguồn khác hoặc chuyển cho người phụ trách. |
| **Mâu thuẫn** | Hai nguồn, quan sát hoặc phiên bản chính sách đáng tin không đồng nhất. | Hiển thị mâu thuẫn và nói rõ quyết định nào đang bị chặn. Không âm thầm chọn một nguồn. | Xác định thứ tự ưu tiên nguồn, hỏi người có thẩm quyền hoặc dùng policy có ngày hiệu lực. |

Trạng thái nên được tính từ các tín hiệu theo từng tác vụ: độ bao phủ retrieval, độ mới của nguồn, kiểm tra mâu thuẫn, kết quả tool, phạm vi quyền và khả năng đảo ngược của hành động. Không nên suy ra nó chỉ từ giọng văn của mô hình.

## Bốn phản hồi tốt hơn một completion bị ép buộc

Một trợ lý đáng tin cần nhiều hơn một nhánh `answer()`. Trong thực tế, bốn phản hồi bao phủ phần lớn tình huống không chắc chắn.

**Trả lời kèm bằng chứng** phù hợp khi hệ thống có đủ căn cứ cho phạm vi được hỏi. Phản hồi vẫn nên làm rõ ranh giới: “Dựa trên phiên bản chính sách hiện tại, có ngày 4 tháng 5…” hữu ích hơn một đoạn văn nghe như đúng trong mọi thời điểm.

**Đặt câu hỏi làm rõ** phù hợp khi hệ thống có thể thành công nếu người dùng cung cấp một biến còn thiếu. Câu hỏi nên hẹp và giải thích vì sao biến đó quan trọng. “Bạn muốn áp dụng chính sách thuế của quốc gia nào?” có thể hành động được. “Bạn có thể cung cấp thêm thông tin không?” chỉ đẩy gánh nặng chẩn đoán về phía người dùng.

**Đưa ra câu trả lời giới hạn** phù hợp khi một phần yêu cầu hữu ích và an toàn để trả lời ngay. Phản hồi phải tách rõ claim được hỗ trợ và claim chưa giải quyết. Phần chưa rõ không được giấu trong một footnote sau một đoạn giải thích dài đầy tự tin.

**Chuyển cho con người** phù hợp khi bằng chứng mâu thuẫn, hậu quả cao, người dùng không có quyền giải quyết hoặc bước tiếp theo cần phán đoán thay vì retrieval. Handoff phải mang theo ngữ cảnh; câu “vui lòng liên hệ hỗ trợ” mà không có bằng chứng đã thu thập không phải là một đường phục hồi.

Cách đặt vấn đề này khác với câu “mô hình đang không chắc chắn”. Câu hỏi đúng là: **Trạng thái hữu ích và an toàn nhất mà hệ thống có thể cung cấp lúc này là gì?**

## Làm rõ answer contract

Giao diện có thể đơn giản, nhưng kết quả nội bộ nên giữ đủ cấu trúc cho policy, analytics và evaluation. Một envelope gọn có thể trông như sau:

```json
{
  "status": "partial",
  "scope": {
    "supported": ["policy_effective_date", "affected_plan"],
    "unresolved": ["regional_exception"]
  },
  "evidence": [
    {
      "sourceId": "policy-2026-05",
      "version": "17",
      "freshness": "current",
      "supports": ["policy_effective_date", "affected_plan"]
    }
  ],
  "nextAction": {
    "kind": "clarify",
    "question": "Which region should the exception check cover?"
  },
  "risk": "medium",
  "handoff": null
}
```

Envelope này không có nghĩa là mọi người dùng đều phải nhìn thấy JSON nội bộ. Nó là hợp đồng giữa retrieval, policy, generation, interface và measurement. Renderer có thể chỉ hiển thị một lời giải thích ngắn cùng một nút hành động, trong khi hệ thống vẫn ghi lại ranh giới bằng chứng và quyết định phục hồi.

Một quy tắc triển khai hữu ích là tách **sinh claim** khỏi **đóng gói response**. Trước hết, hệ thống xác định claim nào được hỗ trợ. Sau đó, nó quyết định tập claim đó đã đủ cho tác vụ hay chưa. Chỉ sau bước này model mới viết prose. Nhờ vậy, generator trôi chảy không thể xóa nhầm khác biệt giữa “chưa retrieve được” và “đã retrieve nhưng bị mâu thuẫn”.

## Thiết kế đường phục hồi trước khi viết câu xin lỗi

Nhiều sản phẩm AI xem failure UX như một câu: “Xin lỗi, tôi không thể trả lời câu hỏi đó.” Câu này có thể lịch sự nhưng không làm giảm sự không chắc chắn và cũng không giúp người dùng phục hồi. Một trạng thái lỗi tốt là một workflow nhỏ.

Đường phục hồi nên trả lời bốn câu hỏi. Hệ thống đã hiểu phần nào? Phần nào đang bị chặn? Vì sao bị chặn theo cách người dùng có thể hành động? Bước tiếp theo ít tốn công nhất có thể làm thay đổi trạng thái là gì?

![Vòng phục hồi biến một câu trả lời bị chặn thành làm rõ, bổ sung bằng chứng, phản hồi giới hạn hoặc handoff](/blog/ai-partial-answer-uncertainty/recovery-loop.webp)

Một trình tự thực tế gồm:

1. **Gọi tên ranh giới.** Nói rõ claim hoặc hành động nào chưa thể được hỗ trợ, thay vì tuyên bố cả cuộc hội thoại là thất bại.
2. **Giữ lại phần hữu ích.** Hiển thị phần trả lời đã có căn cứ, nguồn đã retrieve, bản nháp hoặc các trường đã trích xuất.
3. **Đưa ra một hoặc hai hành động tiếp theo.** Hỏi một câu hẹp, tìm nguồn được phê duyệt, yêu cầu tải tài liệu còn thiếu hoặc gửi review.
4. **Bắt buộc xác minh sau phục hồi.** Bằng chứng mới làm thay đổi trạng thái; hệ thống không nên âm thầm nối thêm nó vào câu trả lời cũ.

Hành động phục hồi cũng phải tôn trọng authority. Người dùng có thể cung cấp ngày còn thiếu nhưng không có quyền quyết định giữa hai phiên bản policy mâu thuẫn. Nhân viên hỗ trợ có thể được phép xác định nguồn nào có hiệu lực, còn khách hàng chỉ nên nhìn thấy mâu thuẫn và trạng thái handoff.

## Đừng nhầm abstention với refusal

Abstention là quyết định về bằng chứng hoặc năng lực: hệ thống không đưa ra claim vì điều kiện cho một claim có trách nhiệm chưa đủ. Refusal là quyết định policy: hệ thống từ chối một yêu cầu đã hiểu vì nó không được phép hoặc không an toàn. Giao diện có thể dùng ngôn ngữ gần nhau, nhưng nguyên nhân nội bộ và đường phục hồi phải khác.

Một abstention có thể được giải quyết bằng câu hỏi tốt hơn, tài liệu mới, quyền truy cập hoặc human review. Một refusal có thể không cần retrieval thêm. Nếu cả hai đều bị rút gọn thành “Tôi không thể giúp việc đó”, operator không đo được giới hạn thật của hệ thống và người dùng không biết hành động khác có thể làm tình hình thay đổi hay không.

Phân biệt này cũng cải thiện evaluation. Một hệ thống abstain quá thường xuyên có thể an toàn nhưng không hữu ích. Một hệ thống gần như không bao giờ abstain có thể trông rất năng suất trong khi âm thầm biến thiếu bằng chứng thành certainty được bịa ra. Mục tiêu không phải là tối đa hóa answer rate; đó là hoàn thành đúng mức trong ràng buộc rủi ro và bằng chứng của sản phẩm.

## Đánh giá đội ngũ người và AI, không chỉ đánh giá model

Thiết kế partial-answer cần các metric nối trạng thái hệ thống với kết quả của người dùng. Dashboard chỉ báo answer acceptance hoặc lượt thumbs-up sẽ thưởng cho completion tự tin, kể cả khi giao diện che giấu sự không chắc chắn.

| Metric | Đo lường điều gì | Tín hiệu thất bại |
|---|---|---|
| **Supported-claim precision** | Bao nhiêu claim được gắn nhãn supported thực sự được bằng chứng hỗ trợ. | Hệ thống gắn nhãn an toàn cho quá nhiều claim. |
| **Appropriate abstention rate** | Bao nhiêu lần hệ thống không đưa claim khi bằng chứng thiếu hoặc mâu thuẫn. | Hệ thống đoán qua khoảng trống, hoặc từ chối cả việc thường lệ. |
| **Recovery completion** | Người dùng có giải quyết được trạng thái bị chặn bằng hành động được gợi ý không. | Hệ thống hỏi mơ hồ hoặc tạo ngõ cụt. |
| **False-confidence rate** | Bao nhiêu lần người dùng tưởng câu trả lời partial hoặc conflicting là hoàn chỉnh. | Thứ bậc hình ảnh làm phần cảnh báo trở nên vô hình. |
| **Human-AI joint quality** | Chất lượng quyết định cuối sau khi con người tương tác với trạng thái không chắc chắn. | Thông điệp neo người dùng vào dự đoán sai hoặc tạo distrust không cần thiết. |
| **Handoff completeness** | Handoff có chuyển request, evidence, conflict và các bước đã thử cho con người không. | Người phụ trách phải điều tra lại từ đầu. |

Kết quả từ nghiên cứu selective prediction của AAAI nhắc chúng ta rằng chính message có thể thay đổi kết quả chung.[1] Vì vậy, human testing không chỉ nên so sánh output của model mà còn so sánh các cách trình bày: raw confidence, trạng thái phân loại, tín hiệu defer rõ ràng và bounded partial answer. Nên thử với người có mức độ chuyên môn khác nhau, vì một câu hữu ích với kỹ sư có thể gây hiểu lầm cho khách hàng.

Các hướng dẫn về human-AI interaction khuyến nghị hiển thị thông tin phù hợp với ngữ cảnh và giới hạn phạm vi dịch vụ khi hệ thống không chắc chắn.[2] Trong thực tế, điều đó nghĩa là hiển thị mẩu bằng chứng nhỏ nhất cần thiết cho quyết định tiếp theo—không đổ cả trace, không giấu ranh giới và không bắt người dùng giải mã jargon thống kê.

![Bảng evaluation bốn phần so sánh correctness, abstention, độ hữu ích của recovery và chất lượng quyết định của con người](/blog/ai-partial-answer-uncertainty/evaluation-matrix.webp)

## Một pattern triển khai cho hệ thống production

Một kiến trúc đơn giản có thể giữ cho ranh giới rõ ràng mà không biến mọi response thành một dự án nghiên cứu.

Đầu tiên, retrieval hoặc tool trả về các evidence object có source identity, version, timestamp, scope và conflict đã biết. Tiếp theo, policy layer ánh xạ các object đó vào mức hỗ trợ theo từng claim. Decision layer chọn `answer`, `clarify`, `partial` hoặc `handoff`. Response writer đóng gói quyết định thành ngôn ngữ phù hợp với người dùng và mức rủi ro. Cuối cùng, interface hiển thị trạng thái và ghi nhận người dùng đã phục hồi, bỏ dở hay escalate.

```ts
type AnswerState = "supported" | "partial" | "missing" | "conflicting";
type NextAction = "answer" | "clarify" | "retrieve" | "handoff";

type ClaimAssessment = {
  claim: string;
  state: AnswerState;
  sourceIds: string[];
  reason?: string;
};

function chooseNextAction(
  claims: ClaimAssessment[],
  risk: "low" | "medium" | "high",
): NextAction {
  if (claims.some((claim) => claim.state === "conflicting")) {
    return risk === "high" ? "handoff" : "clarify";
  }

  if (claims.every((claim) => claim.state === "supported")) {
    return "answer";
  }

  if (claims.some((claim) => claim.state === "missing")) {
    return "retrieve";
  }

  return "clarify";
}
```

Đoạn code này cố ý khiêm tốn. Phần khó không nằm ở enum; nó nằm ở việc xác định evidence nghĩa là gì trong từng sản phẩm. Trợ lý du lịch có thể đưa ra itinerary một phần. Workflow y tế có thể cần handoff khi thiếu một trường critical. Công cụ cho developer có thể tạo patch nháp nhưng yêu cầu verify trước khi apply. State machine phải bám vào consequence, khả năng đảo ngược và authority, không phải một confidence threshold dùng chung cho mọi nơi.

Về vận hành, hãy log quyết định và reference tới evidence chứ không chỉ log prose cuối. Nhờ đó team có thể trả lời các câu hỏi: Hệ thống có biết bằng chứng đang thiếu không? Giao diện có cho người dùng thấy điều đó không? Người dùng có đường phục hồi khả dụng không? Một source update về sau có làm câu trả lời từng được hỗ trợ trở nên stale không?

## Những failure pattern nên bị loại ngay trong review

Anti-pattern đầu tiên là **confidence badge để ngụy trang**. Một chip “72%” nhỏ cạnh một đoạn văn lớn không truyền đạt uncertainty nếu đoạn văn chiếm toàn bộ thứ bậc thị giác và con số không có định nghĩa rõ.

Thứ hai là **lời xin lỗi dùng cho mọi tình huống**. Nếu mọi trạng thái bị chặn đều có cùng một message, sản phẩm mất khả năng phân biệt thiếu evidence, policy refusal, permission failure, tool outage và source conflict.

Thứ ba là **partial answer bị giấu**. Response trả lời phần dễ rồi âm thầm bỏ qua phần khó. Người dùng thường hiểu sự im lặng là “không có gì quan trọng bị thiếu”. Phạm vi chưa giải quyết phải được gọi tên.

Thứ tư là **handoff cụt**. Đẩy người dùng vào một queue mà không chuyển evidence, các bước đã thử hoặc lý do escalation chỉ chuyển chi phí lỗi sang một con người. Handoff phải là chuyển trạng thái chứ không phải reset.

Thứ năm là **đường phục hồi không được test**. Team kiểm tra model có trả lời được không, nhưng không kiểm tra người dùng có cung cấp được biến còn thiếu, sửa được conflict hay hiểu hệ thống cần gì không. Recovery là một capability của sản phẩm và cần có regression case riêng.

## Hợp đồng khó chịu nhưng hữu ích

Một trợ lý AI đáng tin không hứa hoàn thành mọi yêu cầu. Nó hứa rằng sẽ dễ hiểu khi việc hoàn thành chưa được biện minh bằng bằng chứng.

Lời hứa đó có hình dạng kỹ thuật: evidence theo claim, trạng thái rõ ràng, ngôn ngữ có giới hạn, hành động tiếp theo có thể đảo ngược, handoff biết authority và đánh giá chung người-AI. Nó cũng có hình dạng thiết kế: thứ bậc thị giác làm lộ ranh giới mà không khiến giao diện trông như bị hỏng.

Câu trả lời một phần tốt nhất không phải câu có nhiều chữ nhất. Đó là câu đem lại nhiều phần việc có căn cứ nhất, nói chính xác phần nào còn bỏ ngỏ và đưa ra một bước tiếp theo thực sự có thể thay đổi kết quả.

## Tài liệu tham khảo

[1] [Elizabeth Bondi và cộng sự, “Role of Human-AI Interaction in Selective Prediction,” AAAI-22](https://ojs.aaai.org/index.php/AAAI/article/view/20465/20224)

[2] [Saleema Amershi và cộng sự, “Guidelines for Human-AI Interaction,” ACM CHI 2019](https://dl.acm.org/doi/10.1145/3290605.3300233)

[3] [NIST, Artificial Intelligence Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)

[4] [Google PAIR, People + AI Guidebook](https://pair.withgoogle.com/guidebook/)

[5] [Microsoft HAX Toolkit](https://www.microsoft.com/en-us/haxtoolkit/)
