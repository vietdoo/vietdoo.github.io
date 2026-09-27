---
title: "Jev và System One: Khi AI trả về quyết định typed thay vì một đoạn văn"
description: 'Giới thiệu mô hình System One của TypeSafe AI, cách Jev biến state và câu hỏi thành các quyết định có kiểu, cùng hướng dẫn chạy demo Wiki Speedrunner và Quiz Solver tại S:\\jev-vndo.'
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

Bài viết này vừa là phần giải thích kiến trúc ở mức thực dụng, vừa là nhật ký chạy demo của tôi trong `S:\\jev-vndo`. Demo có hai POC: Wiki Speedrunner dùng Jev để chọn bước nhảy tiếp theo giữa các trang Wikipedia, còn 15Min Math Quiz Solver dùng Jev trong vòng lặp Playwright để hỗ trợ chọn đáp án.

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

TypeSafe mô tả stack của họ gồm kiến trúc model mới, parallel sampler và một phương pháp huấn luyện gọi là **Reinforcement Learning for Calibrated Decisions (RLCD)**. Đây là mô tả ở cấp sản phẩm/research; bài demo này không giả vờ suy ra các chi tiết nội bộ mà API không công bố. Điều đáng quan tâm ở phía developer là contract: ta gửi nhiều câu hỏi cho cùng một state và nhận lại các giá trị typed để code tiếp tục xử lý.

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

## Demo trong `S:\\jev-vndo`

Repo demo là một ứng dụng Node.js nhỏ dùng Express, WebSocket và Playwright. `server.js` phục vụ dashboard ở port `3000`, còn các engine gửi event realtime về UI để hiển thị telemetry. Phía Wiki gọi `@typesafe-ai/sdk`, tiền xử lý ứng viên bằng heuristic rồi đưa top contenders cho Jev chọn bằng primitive `choice`.

### Chuẩn bị

1. Mở PowerShell và chuyển tới repo:

```powershell
Set-Location S:\jev-vndo
npm install
```

2. Cấu hình key trong session hiện tại, hoặc nhập key ở màn hình Settings của dashboard. Không đưa key đang hoạt động vào source control hay bất kỳ bản ghi công khai nào:

```powershell
$env:TYPESAFE_API_KEY = "<your-typesafe-api-key>"
```

3. Khởi động dashboard:

```powershell
npm start
```

Mở [http://localhost:3000](http://localhost:3000). Nếu terminal in ra port khác vì `PORT` đã được set, dùng port đó.

### POC 1 — Wiki Speedrunner

Chọn tab **POC 1: Wiki Speedrunner**, nhập trang bắt đầu và trang đích, sau đó bấm **Start Race**. Một run điển hình có thể bắt đầu từ `Hanoi` và đặt đích là `ChatGPT`. Dashboard sẽ hiển thị navigation route, số hop, scanned links, scan rate và decision log.

Luồng xử lý có ba lớp dễ quan sát:

1. Playwright/browser runner đọc trang và gom các link có thể click.
2. Heuristic giảm danh sách về một nhóm ứng viên gần nhất với target.
3. Jev thực hiện `choice` trên nhóm đó; engine lấy lựa chọn, probability và confidence để quyết định hop tiếp theo.

Tách heuristic khỏi Jev là một quyết định thiết kế đáng giữ. Không phải mọi link đều cần gửi lên model, và code vẫn kiểm soát budget, stop condition, exact match và các lỗi browser. Jev làm phần judgment; engine làm phần orchestration.

![Doodle Wiki Speedrunner: browser agent xếp hạng candidate links rồi chọn đường tới target](/blog/jev-system-one/wiki-agent-loop.webp)

### POC 2 — 15Min Math Quiz Solver

POC thứ hai kết nối với một instance 15Min chạy riêng tại `http://localhost:4200`. Đây không phải benchmark về độ đúng của quiz, mà là một trace cụ thể cho mô hình “decision-in-the-loop”: runner đọc câu hỏi hiện tại, dựng state có cấu trúc, yêu cầu Jev chọn trong tập đáp án hữu hạn rồi mới thực thi thao tác trên trình duyệt.

<figure class="blog-demo-gif my-6 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60">
  <img src="/blog/jev-system-one/demo.gif" alt="15Min Math Quiz Solver đang chạy với Jev" width="640" height="273" loading="lazy" decoding="async" />
</figure>

URL quiz mặc định trong repo là:

```text
http://localhost:4200/lesson/2379791/quiz?difficulty=easy
```

Trong **Settings**, chọn URL quiz và dùng tài khoản local/test được cấp cho môi trường đó. README của demo có các giá trị mặc định; không nên sao chép credential test vào một bài blog public nếu chúng còn hoạt động.

Khi bấm chạy, Playwright đăng nhập, mở quiz, đọc câu hỏi cùng lựa chọn, gửi state cho Jev và click đáp án do engine chọn. Giá trị của ví dụ không nằm ở việc tự động chọn một đáp án, mà ở ranh giới vận hành nó phơi bày: quyền thực thi, validation, audit trail, giới hạn retry và cơ chế chuyển sang human review phải được quyết định bởi hệ thống bao quanh model.

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

- Jev là hosted model được gọi qua API, không phải model local trong repo demo.
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
