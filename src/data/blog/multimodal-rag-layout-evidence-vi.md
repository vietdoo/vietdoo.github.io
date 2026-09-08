---
title: "Multimodal RAG hiểu Bảng, Hình và Bố cục Trang như thế nào?"
description: "Text-only chunking thường làm hỏng các workflow AI dùng nhiều document. Đây là thiết kế layout-aware retrieval thực tế cho prose, table, figure, caption và page-level evidence."
pubDate: 2026-07-11
category: "engineering"
image: "/blog/multimodal-rag-layout/hero.webp"
lang: "vi"
translationKey: "multimodal-rag-layout-evidence"
draft: false
---

![Một AI robot đưa paragraph, table, figure và page layout vào một câu trả lời có grounding](/blog/multimodal-rag-layout/hero.webp)

Một document có thể chứa câu trả lời trong paragraph, exception trong table, definition trong caption, còn ý nghĩa của chart lại nằm ở layout xung quanh nó. Text-only RAG pipeline biến document thành một chuỗi chunk rồi hy vọng các mối quan hệ quan trọng vẫn còn nguyên.

Đôi khi chúng còn. Rất thường xuyên thì không.

Failure này dễ bị bỏ qua vì text được retrieve trông vẫn hợp lý. Một row trong bảng không có column header vẫn đọc được. Figure caption không có figure vẫn nghe có vẻ nhiều thông tin. Một paragraph được extract từ trang hai cột thậm chí có thể bị trả về sai thứ tự đọc. Model nhận các fragment trôi chảy và tạo ra một answer cũng trôi chảy, trong khi cấu trúc của document đã âm thầm biến mất.

> **Luận điểm chính:** Multimodal RAG không phải là “đặt image embedding cạnh text embedding”. Đó là một retrieval system giữ lại các mối quan hệ evidence mà người đọc dùng để hiểu một page.

Bài viết tập trung vào document-heavy workflow: technical manual, policy pack, incident report, research paper, financial statement và slide export. Mục tiêu không phải áp đặt một vendor stack. Mục tiêu là làm rõ ingestion contract, retrieval unit, citation và evaluation criteria.

## Vì sao page là một evidence graph

Page không chỉ là một túi token. Nó là một evidence graph nhỏ. Heading định nghĩa scope cho paragraph bên dưới. Table header cho biết ý nghĩa của giá trị trong cell. Figure có caption, legend, axis và explanation gần đó. Footnote có thể thu hẹp claim được nêu ở phần thân.

![Layout-aware index tách document page thành paragraph, table, figure, caption và sidebar trước khi retrieval](/blog/multimodal-rag-layout/layout-aware-index.webp)

Hãy hình dung page có cấu trúc sau:

| Region | Đóng góp | Naive text chunking làm mất gì |
|---|---|---|
| Heading | Scope và topic | Chunk có thể tách khỏi context |
| Paragraph | Explanation và definition | Thường được giữ lại nhưng reading order có thể hỏng |
| Table | Exact value, category và exception | Header, merged cell và quan hệ giữa các row |
| Figure | Shape, trend, spatial relation hoặc process | Visual meaning và label |
| Caption | Interpretation và scope của figure | Caption có thể tách khỏi image |
| Footnote | Qualifier hoặc limitation | Exception quan trọng có thể bị bỏ qua |

Vì vậy, useful unit không phải lúc nào cũng là chunk 500 token. Nó có thể là một **layout bundle**: table kèm header và caption, figure kèm legend và paragraph giải thích, hoặc heading kèm section mà nó quản lý.

## Giữ cấu trúc ngay từ lúc ingestion

Retrieval problem thường được quyết định trước khi embedding đầu tiên được tạo. Nếu ingestion bỏ coordinates, hierarchy, table structure hoặc source version, component phía sau không thể khôi phục đáng tin.

Một ingestion record thực tế có thể giữ raw source và normalized region cùng lúc:

```ts
type PageRegion = {
  regionId: string;
  documentId: string;
  version: string;
  page: number;
  type: "heading" | "paragraph" | "table" | "figure" | "caption" | "footnote";
  bbox: [number, number, number, number];
  text?: string;
  assetUri?: string;
  parentRegionId?: string;
  relatedRegionIds: string[];
};
```

Field `relatedRegionIds` quan trọng hơn vẻ ngoài của nó. Nó có thể nối figure với caption, table với heading và footnote với claim mà nó qualify. Retrieval khi đó có thể expand hit thành một neighborhood có kiểm soát thay vì đẩy cả page vào prompt.

### Giữ nhiều representation

Một region có thể cần nhiều hơn một representation. Table có thể được lưu thành structured grid, textual serialization và rendered image. Figure có thể có pixel, OCR text, caption và visual embedding. Paragraph có normalized text cộng với original page crop để citation.

Các representation phục vụ những nhiệm vụ khác nhau:

| Representation | Phù hợp nhất cho | Failure thường gặp nếu dùng một mình |
|---|---|---|
| **Text** | Keyword search, exact term, citation | Mất visual và relational meaning |
| **Structured table** | Câu hỏi về row/column và calculation | Có thể bỏ qua visual emphasis hoặc merged layout |
| **Rendered crop** | Chart, diagram và spatial relation | Khó search chính xác |
| **Caption và metadata** | Scope và interpretation | Có thể đơn giản hóa image quá mức |
| **Embedding** | Semantic similarity giữa nhiều modality | Similarity không chứng minh factual support |

Hệ thống không cần expose mọi representation cho model. Nó cần chọn representation rẻ nhất có thể trả lời câu hỏi và vẫn giữ đường dẫn về original page.

## Route query theo evidence type

Multimodal query không phải lúc nào cũng là câu hỏi về image. “Timeout là bao nhiêu?” có thể trả lời bằng text. “Quarter nào có value cao nhất?” có thể cần table hoặc chart. “Mũi tên màu đỏ chỉ điều gì?” về bản chất là câu hỏi visual và spatial.

Router có thể phân loại query thành evidence need trước khi retrieval:

```text
question → evidence plan

numbers / comparison      → table + surrounding heading
trend / spatial relation  → figure + legend + caption
definition / procedure    → paragraph + heading + footnote
mixed explanation         → text + table or figure bundle
```

Điều này không có nghĩa phải dùng một LLM riêng để quyết định mọi route. Tín hiệu nhẹ như numeric pattern, comparison word, “shown in the figure” hoặc reference đến page region có thể tạo first pass. Model chỉ cần refine plan khi còn ambiguity.

Router cũng phải được phép yêu cầu thêm evidence. Nếu table result không có header, bước đúng không phải là trả lời từ row đó. Bước đúng là mở rộng retrieval neighborhood hoặc hỏi đến source page.

## Retrieve bundle, không retrieve fragment cô lập

Sai lầm phổ biến nhất của multimodal RAG là retrieve một text paragraph và một image độc lập, rồi kỳ vọng model tự dựng lại mối quan hệ giữa chúng. Index nên biến các quan hệ hữu ích thành một unit có thể retrieve.

Một bundle có thể gồm:

1. Primary hit, chẳng hạn table row, figure hoặc paragraph.
2. Governing heading và caption.
3. Related region nhỏ nhất cần để diễn giải hit.
4. Page crop hoặc source locator để verify.
5. Version và freshness field.

Bundle phải có giới hạn. Trả về mọi thành phần trên page làm tăng token cost và có thể chôn evidence quan trọng. Expansion policy nên explicit: include table header, figure legend, nearest heading và footnote chỉ khi region có link đến nó.

![Robot trả lời câu hỏi về table bằng cách kết hợp row được highlight, header và explanation gần đó thay vì dùng row một mình](/blog/multimodal-rag-layout/table-evidence.webp)

### Đừng nhầm visual retrieval với visual reasoning

Visual embedding có thể tìm image trông tương đồng về ngữ nghĩa. Điều đó hữu ích cho recall. Nó không bảo đảm image được retrieve có câu trả lời, hoặc model đã đọc đúng axis.

Với câu hỏi về số liệu và compliance, hãy giữ structured representation nếu có thể. Dùng rendered image như supporting evidence và để citation, không dùng nó làm source of truth duy nhất. Với chart, lưu axis label, series name, unit và data point nếu extract được đáng tin. Nếu extraction còn không chắc, hãy cho thấy uncertainty thay vì biến visual estimate thành exact number.

## Ground answer ở đúng level

Citation ở cấp document không đủ cho multimodal evidence. User phải mở được page 7, thấy vùng table hoặc figure và hiểu phần nào đã support claim. Provenance record có thể chứa region ID và bounding box bên cạnh textual citation.

Một evidence envelope có thể trông như sau:

```json
{
  "claim": "The peak occurs in Q3.",
  "evidence": [
    {
      "document": "quarterly-report.pdf",
      "version": "2026-06-30",
      "page": 7,
      "region": "figure_7a",
      "bbox": [0.18, 0.24, 0.82, 0.71],
      "support": "direct"
    },
    {
      "document": "quarterly-report.pdf",
      "version": "2026-06-30",
      "page": 7,
      "region": "figure_7a_caption",
      "support": "interpretive"
    }
  ]
}
```

Điều này cũng giúp correction. Nếu chart được thay thế, sản phẩm có thể xác định claim nào dùng region cũ rồi chỉ re-run các claim đó. Citation không chỉ là decorative link; nó trở thành một dependency edge.

## Đánh giá relationship, không chỉ answer similarity

Text-only evaluator có thể đánh giá answer đúng vì final sentence giống reference answer. Nó có thể bỏ qua wrong table row, mất unit hoặc citation đúng page nhưng sai region.

![Evaluation board so sánh answer được ground bằng paragraph, table và figure với answer chỉ dựa vào text](/blog/multimodal-rag-layout/evidence-evaluation.webp)

Multimodal evaluation nên kết hợp deterministic và semantic check:

| Dimension | Check ví dụ | Grader phù hợp |
|---|---|---|
| **Region retrieval** | Table, figure hoặc paragraph kỳ vọng nằm trong top-k | Region ID matcher |
| **Structural integrity** | Header, unit và row relationship của table còn đủ | Schema và invariant check |
| **Evidence sufficiency** | Region được cite support toàn bộ claim | Rubric judge cộng sampled human review |
| **Numerical accuracy** | Giữ đúng value, unit và hướng so sánh | Deterministic calculation |
| **Locator correctness** | Citation mở đúng region được dùng | Page và bounding-box check |
| **Cross-modal consistency** | Text, table và figure không mâu thuẫn | Conflict detector và review |
| **Abstention quality** | Hỏi hoặc qualify khi evidence chưa đủ | Policy assertion |

Hãy xây adversarial case xoay quanh structure loss: bỏ table header, đổi chỗ hai column, tách caption, đổi unit hoặc đặt footnote ở region xa. Một system chỉ pass clean PDF chưa sẵn sàng cho document người dùng thật sự upload.

Metric hữu ích là **evidence relationship recall**: tỷ lệ các relationship bắt buộc còn tồn tại sau ingestion và retrieval. Với câu hỏi về chart, nó có thể nghĩa là figure, legend, axis unit và caption đều đến được answer context. Score cụ thể không quan trọng bằng việc biến relationship thành release criterion có thể nhìn thấy.

## Kiểm soát cost và context size

Multimodal retrieval có thể đắt nếu mọi candidate đều được render, OCR, embed và gửi đến vision-capable model. Staged design giúp common path rẻ hơn:

1. Search text và structured metadata để có high-recall candidate.
2. Chỉ expand candidate khi question thực sự cần layout hoặc visual evidence.
3. Dùng rendered crop cho verification hoặc visual reasoning.
4. Pack bundle nhỏ nhất vẫn giữ đủ interpretation.
5. Giữ page-level locator cho citation và review sau này.

Nguyên tắc tương tự áp dụng cho indexing. Không phải page nào cũng cần high-resolution visual embedding. Policy manual nhiều text có thể hưởng lợi nhiều nhất từ structured table và source anchor. Runbook nhiều diagram mới đáng rich visual representation. Hãy đo theo query class thay vì dùng một representation cho mọi page.

## Lộ trình rollout thực tế

Bắt đầu với một document family và một question pattern, chẳng hạn “tìm value trong quarterly table” hoặc “giải thích architecture diagram”. Định nghĩa layout contract, giữ region và viết test cho các relationship mà answer cần.

| Phase | Deliverable | Gate |
|---|---|---|
| **1. Inventory** | Region type, source version, coordinate và related-region link | Không header, caption hoặc footnote quan trọng nào bị drop âm thầm |
| **2. Index** | Text, structured, visual và metadata representation | Mọi representation resolve về cùng source region |
| **3. Route** | Evidence plan dựa trên query need | Table, figure và mixed question đi đúng path |
| **4. Bundle** | Bounded neighborhood expansion | Model nhận đủ context mà không phải cả page |
| **5. Cite** | Region-level evidence envelope | User mở được supporting page region |
| **6. Evaluate** | Relationship recall, structural integrity, accuracy và abstention | Structure-loss regression chặn release |

Multimodal RAG trở nên đáng tin khi hệ thống coi layout là data. Table không phải paragraph được chèn dấu pipe. Figure không phải decorative image. Caption và footnote không phải prose phụ. Chúng là những relationship giúp người đọc quyết định source có nghĩa gì.

Lợi ích thực tế không chỉ là image search tốt hơn. Đó là một answer có thể nói: “Value này đến từ row ba dưới cột completed-orders, và footnote giới hạn nó ở paid account.” Mức specificity đó biến multimodal retrieval từ flashy demo thành infrastructure mà team có thể tin.

## References

[1]: https://arxiv.org/abs/2005.11401 "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"
[2]: https://arxiv.org/abs/2406.08819 "ColPali: Efficient Document Retrieval with Vision Language Models"
[3]: https://www.w3.org/TR/prov-overview/ "W3C PROV Overview"
[4]: https://www.nist.gov/itl/ai-risk-management-framework "NIST AI Risk Management Framework"
[5]: https://opentelemetry.io/docs/specs/semconv/gen-ai/ "OpenTelemetry Generative AI semantic conventions"
