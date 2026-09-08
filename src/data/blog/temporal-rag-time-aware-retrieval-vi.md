---
title: "Temporal RAG: Dạy hệ thống truy hồi hiểu điều gì đúng ở từng thời điểm"
description: "Hướng dẫn xây dựng retrieval có nhận thức về thời gian: valid-time, transaction-time, xử lý mâu thuẫn và đánh giá câu hỏi lịch sử trong production."
pubDate: 2026-07-07
category: "engineering"
image: "/blog/temporal-rag-time-aware-retrieval/hero.webp"
lang: "vi"
translationKey: "temporal-rag-time-aware-retrieval"
draft: false
---

![Minh họa nét vẽ tay về hệ thống RAG nhận thức thời gian nối tài liệu có ngày, timeline và câu trả lời có bằng chứng](/blog/temporal-rag-time-aware-retrieval/hero.webp)

Một hệ thống RAG thông thường trả lời câu hỏi: “Tài liệu nào có ngữ nghĩa giống query này nhất?” Nhưng một knowledge system production thường phải trả lời câu hỏi khó hơn: **tài liệu nào đúng tại thời điểm mà user đang nói đến?**

Khác biệt này rất dễ bị bỏ qua vì vector search tạo cảm giác thông minh. Đưa vào query “Chính sách hoàn tiền của chúng ta vào tháng 3 là gì?”, hệ thống có thể tìm ra những tài liệu chứa từ _refund_ và _March_. Nhưng semantic similarity không tự hiểu rằng policy phát hành tháng 6 đã thay thế policy từng có hiệu lực tháng 3. Nó có thể trả về câu trả lời mới hơn, trau chuốt hơn nhưng sai về lịch sử.

Đây là bài toán của **Temporal Retrieval-Augmented Generation**. Thách thức không phải thêm một trường `published_at` vào chunk rồi hy vọng model tự chú ý. System cần temporal model rõ ràng, luật retrieval, cách hiển thị bằng chứng và bộ eval phân biệt “đúng bây giờ” với “đúng vào lúc đó”. Nghiên cứu gần đây về diachronic question answering cũng xem time-aware retrieval là một bài toán riêng, không chỉ là biến thể nhỏ của semantic search thông thường.[1]

> **Luận điểm:** Nếu câu trả lời có tham chiếu thời gian, time là một phần của retrieval contract, không phải một chi tiết trang trí trong prompt.

## Vì sao semantic similarity làm sai lịch sử?

Hãy xem một timeline policy đơn giản:

| Tài liệu         | Published | Valid from | Valid until | Nội dung                         |
| ---------------- | --------: | ---------: | ----------: | -------------------------------- |
| Refund Policy v1 |     08/01 |      08/01 |       30/04 | Cho phép hoàn tiền trong 14 ngày |
| Refund Policy v2 |     01/05 |      01/05 |       31/08 | Cho phép hoàn tiền trong 30 ngày |
| Refund Policy v3 |     01/09 |      01/09 |          Mở | Cho phép hoàn tiền trong 7 ngày  |

User hỏi: “Ngày 20/04 khách hàng có thể yêu cầu refund theo policy khi đó không?” Tài liệu mới nhất là authoritative cho hiện tại nhưng sai với câu hỏi. Semantic retriever có thể xếp v3 cao vì nó chứa cùng product term và giải thích ngắn gọn. Keyword filter cũng có thể fail nếu câu hỏi nói “lúc đó” thay vì nêu ngày cụ thể.

Temporal correctness có ít nhất ba chiều:

| Chiều thời gian  | Câu hỏi                                            | Ví dụ failure                               |
| ---------------- | -------------------------------------------------- | ------------------------------------------- |
| Valid time       | Fact đúng trong thế giới được mô hình hóa khi nào? | Áp policy 30 ngày cho giao dịch tháng 4     |
| Transaction time | Hệ thống biết hoặc ghi nhận fact khi nào?          | Correction đến muộn ghi đè record cũ        |
| Reference time   | User đang hỏi về mốc thời gian nào?                | “Lúc incident xảy ra” bị hiểu thành hôm nay |

Ba clock này không thể hoán đổi. Một tài liệu viết tháng 6 có thể mô tả sự kiện xảy ra tháng 4. Database có thể ingest một hợp đồng cũ vào tháng 9. Support agent có thể hỏi policy “khi khách hàng đăng ký”, không phải ngày publish và cũng không phải ngày hiện tại.

## Model time trước khi index text

Quyết định đầu tiên không phải embedding model. Đó là temporal contract của từng source.

Với document corpus, tối thiểu cần lưu effective interval và metadata quan sát. Trong relational store, schema có thể như sau:

```sql
CREATE TABLE policy_versions (
  policy_id       text NOT NULL,
  version         text NOT NULL,
  body            text NOT NULL,
  valid_from      timestamptz NOT NULL,
  valid_until     timestamptz,
  recorded_at     timestamptz NOT NULL,
  supersedes      text,
  source_uri      text NOT NULL,
  PRIMARY KEY (policy_id, version)
);
```

`valid_from` và `valid_until` mô tả policy áp dụng khi nào. `recorded_at` mô tả hệ thống nhận hoặc ghi nhận bằng chứng khi nào. `supersedes` hữu ích để giải thích lineage nhưng không nên là nguồn sự thật temporal duy nhất; repository thật có backfill, correction và những policy chồng lấn.

Chunk phải mang cùng metadata với parent document. Nếu ingestion làm mất effective interval, retriever rất khó khôi phục thông tin đó đáng tin cậy từ prose về sau.

```json
{
  "chunk_id": "refund-v2-section-03",
  "text": "Customers may request a refund within 30 days...",
  "embedding": "...",
  "valid_from": "2026-05-01T00:00:00Z",
  "valid_until": "2026-08-31T23:59:59Z",
  "recorded_at": "2026-05-01T09:12:00Z",
  "source_version": "refund-v2"
}
```

Một invariant hữu ích là: **mọi historical claim có thể trả lời phải truy ngược được về một evidence interval**. Nếu source không có temporal metadata, system nên đánh dấu nó là current-only, timeless hoặc unknown thay vì âm thầm coi nó có hiệu lực cho mọi ngày.

## Giải quyết reference time của câu hỏi một cách tường minh

User hiếm khi nói bằng timestamp database. Họ nói “quý trước”, “trước migration”, “khi tôi mới vào”, “lúc outage xảy ra” hoặc “quy định hiện tại là gì?”. Temporal query planner phải chuyển ngôn ngữ đó thành reference interval nhưng vẫn giữ uncertainty.

Planner có thể dùng conversation context, user profile, event đã biết và clock service. Nó không được tự bịa độ chính xác mà user chưa cung cấp.

```ts
type TemporalIntent = {
  query: string;
  referenceStart?: string;
  referenceEnd?: string;
  relation: "at" | "before" | "after" | "between" | "current" | "unknown";
  confidence: number;
  needsClarification: boolean;
};
```

“Dùng policy lúc đó” có thể suy ra từ transaction date trong case. “Policy quý trước là gì?” có thể chuyển thành calendar interval. “Trước incident” có thể cần timestamp của incident. Nếu nhiều cách hiểu còn hợp lý và mỗi cách cho một câu trả lời khác nhau, hãy hỏi lại thay vì tự chọn tài liệu mới nhất.

Retrieval query nên công khai temporal assumption cho các bước sau:

```text
semantic query: refund eligibility
reference interval: [2026-04-20, 2026-04-20]
mode: valid-at
required evidence: policy version effective on reference date
```

## Retrieval theo nhiều tầng: lọc thời gian, xếp hạng ngữ nghĩa, kiểm tra mâu thuẫn

Pipeline bền vững thường kết hợp structured filtering với semantic retrieval thay vì bắt một vector query làm mọi việc.

Tầng đầu tiên thu hẹp candidate theo temporal relation. Với câu hỏi tại một thời điểm, chọn chunk có `valid_from <= t` và (`valid_until` rỗng hoặc `t <= valid_until`). Với câu hỏi theo khoảng, chọn tài liệu có validity interval overlap với khoảng được hỏi. Với “hiện tại”, dùng clock của hệ thống và currentness policy, không dùng chunk cuối cùng mà vector database trả về.

Tầng thứ hai xếp hạng các candidate hợp lệ theo semantic relevance, source authority, granularity và coverage. Tầng thứ ba kiểm tra candidate có mâu thuẫn, overlap mơ hồ hoặc có khoảng trống không.

![Minh họa nét vẽ tay về pipeline lọc evidence theo thời gian trước khi semantic ranking và contradiction review](/blog/temporal-rag-time-aware-retrieval/pipeline.webp)

| Tầng                  | Input                         | Output                       | Failure chính được ngăn               |
| --------------------- | ----------------------------- | ---------------------------- | ------------------------------------- |
| Temporal planner      | Query và context              | Reference interval, relation | Trả lời nhầm thời điểm                |
| Candidate filter      | Source metadata               | Chunk đủ điều kiện thời gian | Tài liệu mới lấn át lịch sử           |
| Semantic ranker       | Chunk đủ điều kiện            | Evidence set liên quan       | Trả text hợp lệ nhưng không liên quan |
| Contradiction checker | Evidence và lineage           | Conflict/gap signal          | Trộn các version không tương thích    |
| Generator             | Evidence và temporal contract | Câu trả lời có citation      | Biến uncertainty thành certainty      |

Thứ tự này không phải công thức duy nhất. Trong một số domain, semantic retrieval trước có thể giúp tìm event định nghĩa temporal interval. Nguyên tắc engineering là thứ tự phải rõ ràng và có thể kiểm thử.

## Mâu thuẫn là dữ liệu, không phải noise

Temporal corpus tự nhiên chứa các statement xung đột vì thực tế đã thay đổi. System không nên tự động “sửa” xung đột bằng cách để language model chọn đoạn văn trôi chảy nhất.

Ví dụ:

```text
2026-04-10: Service hỗ trợ password login.
2026-06-02: Password login đã bị tắt cho tài khoản mới.
```

Hai statement chưa chắc mâu thuẫn. Chúng có thể nói về hai population khác nhau và hai effective date khác nhau. Một cặp khác có thể là correction thật:

```text
2026-04-10: Dữ liệu được giữ trong 30 ngày.
2026-04-12 correction: Retention trước đó sai; dữ liệu chỉ được giữ 7 ngày.
```

Contradiction layer nên phân loại quan hệ: supersedes, narrows scope, expands scope, corrects, coexists hoặc unresolved. Giữ classification gần evidence để generator giải thích vì sao source này được ưu tiên.

| Loại xung đột | Cách xử lý                                     | Cách trả lời                   |
| ------------- | ---------------------------------------------- | ------------------------------ |
| Supersession  | Chọn source valid tại reference time           | Cite đúng version áp dụng      |
| Khác scope    | Lọc theo tenant, product hoặc population       | Nêu rõ scope                   |
| Correction    | Ưu tiên record đã sửa trong interval tương ứng | Nhắc correction nếu quan trọng |
| Overlap       | Dùng precedence của domain hoặc hỏi lại        | Không âm thầm trộn             |
| Unresolved    | Escalate hoặc qualify                          | Nói rõ evidence đang xung đột  |

Generator không nên nói “policy là X” nếu evidence chỉ hỗ trợ “policy là X trong khoảng 1/4 đến 30/4”. Temporal qualifier là một phần của correctness.

## Đánh giá câu hỏi lịch sử, không chỉ chấm chất lượng câu trả lời

RAG benchmark thông thường có thể chấm relevance, groundedness và answer correctness. Temporal benchmark cần thêm các nhãn:

1. System có nhận diện đúng reference interval không?
2. Có lấy evidence valid trong interval ấy không?
3. Có tránh dùng evidence mới để viết lại quá khứ không?
4. Có phân biệt correction với policy mới không?
5. Có thể hiện uncertainty khi interval hoặc lineage mơ hồ không?

Một test matrix nhỏ có thể bao phủ phần lớn bug rủi ro cao:

| Test             | Query                                 | Behavior kỳ vọng                          |
| ---------------- | ------------------------------------- | ----------------------------------------- |
| Point lookup     | “Ngày 20/4 quy định nào áp dụng?”     | Trả version valid ngày 20/4               |
| Before/after     | “Sau migration đã thay đổi gì?”       | So sánh hai interval và cite cả hai       |
| Late ingestion   | Tài liệu tháng 4 đến hệ thống tháng 6 | Giữ valid time, lưu ingestion time        |
| Contradiction    | Hai policy overlap                    | Surface conflict hoặc dùng precedence rõ  |
| Current fallback | “Bây giờ quy định gì?”                | Dùng currentness policy và clock hiện tại |
| Missing time     | “Quy định cũ là gì?”                  | Hỏi lại hoặc qualify, không chọn tùy tiện |

Đây là nơi Temporal RAG nối tự nhiên với eval-driven system design. Mỗi temporal case không chỉ lưu prose cuối cùng, mà còn lưu interval được suy ra, source version và evidence chain.

![Minh họa nét vẽ tay về benchmark timeline gồm historical query, validity window chồng lấn và evidence kỳ vọng](/blog/temporal-rag-time-aware-retrieval/benchmark.webp)

Hard grader có thể kiểm tra interval inclusion và source ID. Semantic grader đánh giá giải thích về thay đổi có dễ hiểu không. Nếu system chọn source không valid tại reference time, đó phải là hard failure dù câu trả lời nghe rất thuyết phục.

## UI phải hiển thị thời gian thay vì giấu nó

Retrieval contract sẽ mất giá trị nếu UI chỉ hiện một đoạn văn không có phạm vi thời gian. Temporal answer cần làm cho scope nhìn thấy được.

Citation card hữu ích có thể hiển thị source version, valid interval, recorded time và trạng thái superseded. Comparison view có thể đặt “then” và “now” cạnh nhau. Nếu system suy ra ngày từ context thay vì user nói trực tiếp, hãy hiển thị assumption đó theo cách nhẹ nhưng dễ đọc.

```text
Answer for: 20 April 2026
Evidence: Refund Policy v1
Valid: 8 January–30 April 2026
Recorded: 8 January 2026
Status: Superseded by v2 on 1 May 2026
```

Đây không phải metadata để trang trí. Nó cho người đọc cơ hội bắt lỗi một assumption sai trước khi hành động dựa trên câu trả lời.

## Những failure mode trông rất thông minh trong demo

**Latest-document bias** xảy ra khi retriever xếp policy mới nhất cao vì nó ngắn gọn và gần semantic. Fix không phải prompt instruction; đó là temporal filter hoặc currentness rule rõ ràng.

**Date mention bias** xảy ra khi chunk có từ “April” nhưng được publish tháng 6. System coi việc prose nhắc đến ngày là bằng chứng document valid vào ngày ấy. Effective interval phải được lưu riêng với prose.

**Time-zone drift** xảy ra khi event gần nửa đêm bị gán nhầm business day. Hãy normalize timestamp nhưng vẫn giữ local calendar của domain nếu policy được định nghĩa theo giờ địa phương.

**Retroactive correction confusion** xảy ra khi correction đến sau được dùng để đánh giá lại một quyết định vốn hợp lệ với thông tin cũ. Trả lời “điều gì đã đúng” hay “điều gì đáng lẽ phải được biết” là product decision và phải được ghi rõ.

**Temporal hallucination** xảy ra khi model bịa một ngày chính xác vì evidence mơ hồ. Interval `unknown` phải tiếp tục là unknown.

## Checklist trước khi ship

Trước khi ship time-aware RAG, hãy xác nhận mọi loại source đều có định nghĩa về validity, observation và precedence. Xác nhận ingestion giữ temporal metadata ở cấp chunk. Xác nhận query planner biểu diễn được point, range, before, after, current và unknown. Xác nhận contradiction được surface thay vì âm thầm trộn.

Sau đó replay golden set với historical question, late-arriving document, policy overlap, timezone edge và reference mơ hồ. Instrument trace để engineer nhìn thấy interval được suy ra, source được chọn, source bị loại và evidence cuối. Theo dõi temporal error budget riêng với answer quality thông thường.

## Kết luận

Vector database giỏi tìm ngôn ngữ tương tự. Nó không tự động giỏi ghi nhớ sự thật nào đã áp dụng vào lúc nào. Khác biệt ấy là bài toán system design liên quan đến data modeling, query planning, source lineage, contradiction handling, UI evidence và evaluation.

Temporal RAG trở nên thực tế khi time được xem như first-class contract. Kết quả không chỉ là câu trả lời chính xác hơn. Đó là câu trả lời có thể giải thích **nó đang nói về thực tại nào, bằng chứng nào hỗ trợ nó, và ranh giới chắc chắn nằm ở đâu**.

## Tài liệu tham khảo

[1]: https://arxiv.org/html/2507.22917v1 "RAG for Answering Diachronic Questions"
[2]: https://openreview.net/forum?id=kwro5432AI "Right Answer at the Right Time — Temporal Retrieval-Augmented Generation"
[3]: https://github.com/open-telemetry/semantic-conventions-genai "OpenTelemetry Semantic Conventions for Generative AI"
