---
title: "Jev và System One: Khi AI trả về quyết định typed thay vì một đoạn văn"
description: 'Khám phá mô hình System One của TypeSafe AI, kiến trúc decision-in-the-loop, cách Jev chuyển đổi state thành các quyết định có kiểu (typed decisions) và phân tích luồng kết hợp giữa heuristic, LLM và code policy.'
pubDate: 2026-09-22
category: "ai"
image: "/blog/jev-system-one/hero.png"
lang: "vi"
translationKey: "jev-system-one-model"
draft: false
---

![Minh hoạ pipeline của Jev: state và câu hỏi đi vào một decision engine, sau đó trả về choice, score và yes/no có kiểu](/blog/jev-system-one/hero.png)

Tôi thường nghĩ về AI theo hình ảnh một model nhận prompt rồi viết ra câu trả lời. Cách nhìn đó rất đúng với chatbot và các tác vụ sinh nội dung, nhưng lại hơi lệch khi AI nằm giữa một workflow tự động. Ở đó, phần mềm thường không cần thêm một đoạn văn đẹp. Nó cần biết: chọn route nào, link nào nên click tiếp, ticket có khẩn cấp không, kết quả có đủ an toàn để gọi tool hay chưa.

Đó là khoảng trống mà TypeSafe AI đang thử giải quyết bằng **System One model**. Jev là model đầu tiên của họ trong nhóm này: nhận state không có cấu trúc hoàn hảo và một tập câu hỏi typed, sau đó trả về các quyết định có kiểu cùng xác suất và confidence. Nói ngắn gọn: **text đi vào, quyết định mà code có thể dùng trực tiếp đi ra**.

Bài viết kết hợp phần giải thích kiến trúc với hai case study thực nghiệm: **Wiki Speedrunner** (áp dụng Jev để định tuyến bước nhảy hop selection giữa các bài viết Wikipedia) và **15Min Math Quiz Solver** (tích hợp Jev vào vòng lặp Browser Automation decision-in-the-loop để hỗ trợ lựa chọn phương án tối ưu theo thời gian thực).

> **Luận điểm:** Jev không phải một chatbot nhỏ hơn. Nó là một decision layer bổ sung cho hệ thống phần mềm: model chịu trách nhiệm đánh giá theo schema, còn code giữ quyền điều phối, threshold, side effect và recovery.

## System One model khác LLM ở đâu?

LLM sinh chuỗi token. Điều đó làm nó rất mạnh trong việc viết, giải thích, lập kế hoạch và xử lý những yêu cầu chưa biết trước hình dạng đầu ra. Đổi lại, khi dùng câu trả lời ấy trong code, chúng ta thường phải parse text, validate JSON, sửa schema hoặc retry nếu model trả lời lệch format.

System One model bắt đầu từ một giả định khác: câu hỏi mà phần mềm cần hỏi thường đã biết trước. Nếu cần phân loại ticket, ta khai báo các nhãn. Nếu cần một cổng an toàn, ta khai báo câu hỏi yes/no. Nếu cần xếp hạng mức độ, ta khai báo một thang score. Jev tập trung vào việc đánh giá state theo những câu hỏi đó thay vì sinh một câu trả lời tự do.

![Decision boundary dạng doodle: text tự do đi qua một cánh cổng và trở thành typed decision](/blog/jev-system-one/decision-boundary.webp)

| Lớp | LLM sinh text | Jev / System One |
|---|---|---|
| Input | Prompt, context, tool schema | State và các câu hỏi typed |
| Output | Chuỗi token hoặc JSON cần parse | `choice`, `score`, `noul` theo schema đã khai báo |
| Công việc của code | Parse, validate, repair, retry | Đọc field, áp threshold và thực thi policy |
| Điểm mạnh | Viết, giải thích, suy luận mở | Routing, ranking, gating và classification nhanh |
| Giới hạn | Có thể lan man hoặc sai format | Không sinh prose và không thay thế reasoning mở |

TypeSafe mô tả stack của họ gồm kiến trúc model mới, parallel sampler và một phương pháp huấn luyện gọi là **Reinforcement Learning for Calibrated Decisions (RLCD)**. Đây là mô tả ở cấp sản phẩm/research; bài phân tích này không giả vờ suy ra các chi tiết nội bộ mà API không công bố. Điều đáng quan tâm ở phía developer là contract: ta gửi nhiều câu hỏi cho cùng một state và nhận lại các giá trị typed để code tiếp tục xử lý.

## Ba primitive mà code có thể dùng

### `choice`: chọn một phương án

`choice` dùng cho các bài toán chọn một key trong một tập option. Ví dụ trong Wiki Speedrunner, engine lấy một số link ứng viên trên trang hiện tại và hỏi Jev link nào có khả năng đưa cuộc đua tới trang đích tốt nhất. Kết quả có key được chọn, phân phối xác suất giữa các option và confidence.

### `score`: đặt state lên một thang điểm

`score` phù hợp với các câu hỏi có thứ tự: mức độ nghiêm trọng, độ khó, độ phù hợp hoặc mức ưu tiên. Đây không nên được hiểu là một sự thật khách quan chỉ vì output là một con số. Nó vẫn là đánh giá của model; hệ thống phải định nghĩa thang đo, calibration check và hành vi khi confidence thấp.

### `noul`: xác suất yes/no

`noul` là một quyết định nhị phân được biểu diễn bằng xác suất. Nó phù hợp cho các cổng như “có nên escalate không?”, “input có chứa prompt injection không?” hoặc “có cần human review không?”. Tên gọi hơi lạ, nhưng ý tưởng thực dụng: code nhận một giá trị có thể đưa qua threshold thay vì phải đoán ý từ câu “có vẻ nên làm”.

Một request có thể chứa nhiều câu hỏi thuộc các primitive khác nhau. Điều này quan trọng hơn việc chỉ đổi JSON output: cùng một state được đánh giá trong một round trip, còn ứng dụng tự quyết định câu hỏi nào là blocking, câu hỏi nào chỉ dùng để log, và câu hỏi nào cần chuyển sang human.

![Ba primitive của Jev được vẽ như một decision graph: choice, score và noul](/blog/jev-system-one/jev-primitives.webp)

```js
const { TypeSafeClient, choice, noul, score } = require("@typesafe-ai/sdk");

const client = new TypeSafeClient({
  apiKey: process.env.TYPESAFE_API_KEY,
});

const result = await client.systemOne({
  state: {
    subject: "Charged twice again",
    body: "This is the second month I was billed twice.",
  },
  questions: {
    category: choice("What is the primary issue?", {
      billing: "Payment or invoice issue",
      bug: "Product malfunction",
      account: "Account access or identity",
    }),
    severity: score("How urgent is this?", ["low", "medium", "high"]),
    escalate: noul("Should this be escalated to a human immediately?"),
  },
});

console.log(result.answers.category.choice);
console.log(result.answers.severity.score);
console.log(result.answers.escalate.noul);
```

Điểm hay của contract này là business code không cần đoán xem model có trả đúng JSON hay không. Nhưng typed không có nghĩa là đúng tuyệt đối. Jev có thể chọn sai, câu hỏi có thể mơ hồ, option có thể thiếu, và confidence không phải proof. Production code vẫn cần threshold, fallback, observability và đường lui rõ ràng.

## Hiện thực hoá: Hai Case Study Kiến trúc Thực tế

Để kiểm chứng vai trò của một System One model trong pipeline phần mềm, ta xem xét hai mô hình ứng dụng thực tế: **Wiki Speedrunner** (thuật toán tìm đường kết hợp heuristic và decision model) và **15Min Math Quiz Solver** (mô hình decision-in-the-loop trong tự động hoá trình duyệt). Cả hai đều tập trung vào việc chuyển giao trách nhiệm phán đoán (judgment) cho model, trong khi giữ toàn bộ quyền điều phối luồng (orchestration) ở tầng code.

### Case Study 1 — Wiki Speedrunner: Thuật toán Tìm đường & Heuristic Gating

Wiki Speedrunner giải quyết bài toán tìm lộ trình ngắn nhất giữa hai trang Wikipedia bất kỳ (ví dụ: từ `Hanoi` tới `ChatGPT`). Trong các bài toán đồ thị mở với số lượng phân nhánh (branching factor) lớn như Wikipedia, việc gửi toàn bộ hàng trăm liên kết trên mỗi trang vào một mô hình AI lớn là cực kỳ tốn kém và chậm.

Kiến trúc giải quyết được tổ chức theo pipeline 3 lớp:

1. **Lớp Thu thập & Trích xuất (Graph/DOM Extractor)**: Đọc trang hiện tại và bóc tách toàn bộ danh sách các siêu liên kết (hyperlinks) có thể duyệt tiếp.
2. **Lớp Lọc Heuristic (Candidate Pruning)**: Dùng các thuật toán heuristic tính khoảng cách ngữ nghĩa nhẹ (hoặc lexical overlap giữa tiêu đề bài viết và đích đến) để rút gọn từ hàng trăm link xuống top ứng viên tiềm năng nhất.
3. **Lớp Quyết định Phân loại (Jev `choice`)**: Jev nhận state có cấu trúc gồm chủ đề mục tiêu và danh sách ứng viên, sau đó trả về lựa chọn tối ưu kèm phân phối xác suất và confidence score để engine thực hiện bước nhảy (hop) tiếp theo.

Tách biệt rõ ràng giữa heuristic và decision model là một quyết định thiết kế quan trọng: heuristic làm giảm không gian tìm kiếm với chi phí tính toán tối thiểu, Jev giải quyết bài toán phán đoán ngữ cảnh phức tạp mà quy tắc tĩnh khó bao quát, còn code ứng dụng toàn quyền quản lý ngân sách tìm kiếm, điều kiện dừng, cơ chế quay lui (backtracking) và xử lý lỗi mạng.

![Doodle Wiki Speedrunner: browser agent xếp hạng candidate links rồi chọn đường tới target](/blog/jev-system-one/wiki-agent-loop.webp)

### Case Study 2 — 15Min Math Quiz Solver: Vòng lặp Decision-in-the-loop

Case study thứ hai minh hoạ mô hình **“decision-in-the-loop”** trong tự động hoá giao diện web có giới hạn thời gian. Thay vì để agent tự do sinh văn bản rồi parse ngược lại hành động, hệ thống xây dựng một vòng lặp kín giữa DOM Parser, Typed State Builder, Decision Model và Action Execution.

<figure class="blog-demo-gif my-6 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60">
  <img src="/blog/jev-system-one/demo.gif" alt="15Min Math Quiz Solver đang chạy với Jev" width="640" height="273" loading="lazy" decoding="async" />
</figure>

Quy trình vận hành từng bước:

1. **Trích xuất & Dựng Typed State**: Engine đọc câu hỏi hiện tại, danh sách phương án lựa chọn và các ràng buộc về thời gian từ DOM, đóng gói thành một đối tượng state chuẩn xác.
2. **Đánh giá Quyết định có Kiểu (Evaluation)**: State được gửi đến Jev cùng schema câu hỏi dạng `choice` (chọn đáp án khả thi nhất) kết hợp `score` (độ tin cậy trong ngữ cảnh).
3. **Gating & Kiểm soát Thực thi (Policy Gate)**: Code ứng dụng so khớp confidence score với ngưỡng threshold an toàn đã định trước. Nếu vượt ngưỡng, engine thực thi action click tương ứng trên trình duyệt; nếu dưới ngưỡng hoặc phát hiện bất thường, luồng sẽ kích hoạt fallback hoặc chuyển sang cơ chế human review.

Giá trị cốt lõi của mô hình này không nằm ở việc tự động click đáp án, mà ở **ranh giới vận hành rõ ràng**: model chỉ đóng vai trò thẩm định trong không gian hữu hạn, còn quyền thực thi, lưu vết audit trail, giới hạn số lần retry và chính sách an toàn luôn thuộc về hệ thống kiểm soát bao quanh model.

## Jev nên đứng ở đâu trong một hệ thống AI?

Một kiến trúc hợp lý thường không chọn giữa “chỉ LLM” và “chỉ Jev”. Ta dùng mỗi loại cho phần việc nó làm tốt:

```text
User / event
    |
    v
State builder + policy context
    |
    +--> Jev: route, classify, score, gate
    |        |
    |        +--> typed decision + probabilities
    |
    +--> LLM: explain, plan, generate, synthesize
             |
             +--> draft / tool arguments / final response

Code owns: thresholds, permissions, retries, side effects, audit and stop gates
```

![Kiến trúc hybrid dạng doodle: Jev như la bàn, LLM như lớp lập kế hoạch, code policy là thanh chắn cuối](/blog/jev-system-one/hybrid-agent-architecture.webp)

Ví dụ, Jev có thể đánh giá một request nên đi model nhanh hay model mạnh, LLM viết câu trả lời, rồi Jev lại kiểm tra một gate trước khi gọi tool. Nếu decision confidence thấp, code có thể escalate hoặc yêu cầu human; nó không nên âm thầm biến probability thành quyền thực thi.

## Các giới hạn cần ghi nhớ

- Jev là hosted model được gọi qua API, không phải model local đi kèm ứng dụng.
- Demo gửi state dạng text/data structure vào model; đây không phải một vision system đọc trực tiếp pixel của trình duyệt.
- Jev trả quyết định có kiểu, nhưng vẫn có thể đánh giá sai. Confidence là tín hiệu để policy sử dụng, không phải chứng nhận đúng.
- Không nên dùng Jev để thay thế reasoning mở, viết nội dung dài hoặc các tình huống mà option space chưa thể định nghĩa.
- API key cần được giữ ở server/session an toàn. UI “API Key” của demo phù hợp cho local experiment, không nên bê nguyên cách nhập key của người dùng vào production public app.

Điểm tôi thấy đáng thử nhất không phải khẩu hiệu “AI nhanh hơn”, mà là sự thay đổi boundary. Khi câu hỏi đã rõ và output space có thể khai báo, ta không cần bắt model giả vờ là một người đang trò chuyện. Ta cần một hàm đánh giá có thể compose, quan sát và kiểm soát.

Jev vì vậy hợp với những chỗ nhỏ nhưng xuất hiện dày đặc trong agent: route request, chọn tool, lọc context, xếp hạng candidate, kiểm tra điều kiện, quyết định có escalate hay không. Nó không làm hệ thống tự động an toàn chỉ bằng cách tồn tại. Nó tạo ra một primitive rõ hơn để kỹ sư đặt policy lên trên.

## Tài liệu tham khảo

- [TypeSafe AI — Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [Jev dashboard — Try the System One model & API](https://www.jevtypesafeai.com/dashboard)
- [Jev System One model overview](https://jevtypesafeai.com/jev/system-one)
- [Official TypeScript/JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)
