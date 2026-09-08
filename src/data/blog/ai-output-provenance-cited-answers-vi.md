---
title: "Từ RAG Chunk đến Câu trả lời có trích dẫn: Xây dựng Provenance cho AI Output"
description: "Một lớp provenance thực tế kết nối source được retrieve, các bước biến đổi, claim và citation để AI answer có thể được kiểm tra thay vì chỉ được tin."
pubDate: 2026-05-23
category: "engineering"
image: "/blog/ai-output-provenance/hero.webp"
lang: "vi"
translationKey: "ai-output-provenance-cited-answers"
draft: false
---

![Kỹ sư và AI robot truy nguyên một câu trả lời về các document, table và source evidence](/blog/ai-output-provenance/hero.webp)

Một RAG demo thường kết thúc bằng một câu khá yên tâm: “Câu trả lời được ground bằng document của bạn.” Câu đó có thể đúng, nhưng vẫn rất khó kiểm tra.

Một retrieved chunk có thể đến từ document cũ. Parser có thể làm mất header của bảng. Reranker có thể chọn một paragraph nằm gần figure nhưng bỏ qua figure vốn làm thay đổi ý nghĩa. Sau đó model ghép ba mảnh evidence thành một claim mà không source nào thực sự nói. Final answer có citation, nhưng citation không giải thích claim được hình thành như thế nào.

Đó là lúc **provenance** trở nên hữu ích. Observability cho biết hệ thống đã làm gì: model nào chạy, request mất bao lâu, retriever trả về những ID nào. Provenance hỏi một câu khác: **những entity, activity và agent nào đã góp phần tạo ra claim này, và reviewer có thể lần theo lineage về source hay không?** Mô hình W3C PROV dùng chính những khái niệm đó để suy luận về chất lượng, độ tin cậy và trustworthiness của dữ liệu được tạo ra.

> **Luận điểm chính:** Citation là một pointer. Provenance là chain of custody đứng phía sau pointer đó.

Phân biệt này quan trọng bất cứ khi nào user cần kiểm tra, phản biện hoặc cập nhật câu trả lời. Nó hữu ích với research assistant, internal knowledge search, financial analysis, support tooling và mọi sản phẩm mà “hãy tin tôi” chưa phải một interface đủ tốt.

## Chỉ một citation là quá nhỏ

Giả sử assistant trả lời: “Migration window là bốn giờ.” Nó trích page 18 của operations guide. Reviewer mở page 18 và thấy một table có hai cột: migration thông thường mất bốn giờ, nhưng migration có data backfill mất tám giờ. Answer đã dùng một cell trong table nhưng làm mất header lúc extract.

Vấn đề không chỉ là citation sai. Vấn đề là lineage bị thiếu. Reviewer cần biết region nào được chọn, nó được parse thế nào, có bị transform không, và model đã gắn evidence đó vào claim nào.

| Layer | Entity hoặc activity ví dụ | Câu hỏi cho reviewer |
|---|---|---|
| **Source** | PDF version 7, page 18, table region | Material gốc là gì? |
| **Extraction** | Layout parser tạo ra một table object | Cấu trúc có được giữ lại không? |
| **Retrieval** | Hybrid search chọn row 3 | Vì sao evidence này được trả về? |
| **Transformation** | Reranker và context formatter | Điều gì bị xóa, ghép hoặc sắp xếp lại? |
| **Claim** | “Migration window là bốn giờ” | Answer đang khẳng định chính xác điều gì? |
| **Citation** | Page anchor và table cell range | Có mở được evidence chính xác không? |

Mô hình này chi tiết hơn một trace span, nhưng không thay thế trace. Trace giải thích runtime behavior; provenance giải thích lineage của một artifact được tạo ra. Một request có thể có một execution trace và nhiều claim-level provenance graph.

## Hãy model answer như các claim, không phải một blob text

Bước đầu thực tế là biểu diễn answer thành một tập các claim. Claim có thể là một sentence, một table value, một recommendation hoặc một statement về uncertainty. Mỗi claim nhận một hoặc nhiều evidence link và một status.

![Provenance lineage map nối source document qua extraction và model transformation đến final claim](/blog/ai-output-provenance/lineage-map.webp)

```ts
type Claim = {
  claimId: string;
  text: string;
  status: "supported" | "partially_supported" | "unsupported" | "uncertain";
  evidence: EvidenceRef[];
  generatedBy: string;
};

type EvidenceRef = {
  sourceId: string;
  locator: {
    page?: number;
    paragraph?: string;
    table?: { row?: number; column?: number };
    boundingBox?: [number, number, number, number];
  };
  extractionVersion: string;
  retrievedAt: string;
};
```

Model không nhất thiết phải emit cấu trúc này hoàn hảo. Một post-processing step có thể split answer thành các candidate claim, map citation vào span và đánh dấu claim không có source. Điểm quan trọng là giữ khác biệt giữa **text model viết ra** và **evidence mà hệ thống có thể bảo vệ**.

Một claim có thể được nhiều evidence hỗ trợ. Nó cũng có thể chỉ được support một phần. Ví dụ, một policy document support time limit nhưng không support exception. Status đó trung thực hơn việc ép một match chưa đầy đủ vào nhãn “grounded” nhị phân.

### Dùng source region, không chỉ document ID

Citation ở cấp document rất tiện nhưng thường chưa đủ. Một page dài có thể chứa nhiều version, table, footnote và exception. Nếu ingestion giữ được layout, locator nên cụ thể đến mức source cho phép: page, section, paragraph, table cell, figure hoặc bounding box.

Precision không được biến thành certainty giả. Nếu parser không map đáng tin một sentence vào table cell, UI nên nói “page 18, table region” thay vì bịa ra tọa độ cell chính xác. Provenance có giá trị vì nó ghi nhận giới hạn hiểu biết của hệ thống, không phải vì nó tạo ảo giác chính xác.

## Ghi lại transformation như first-class activity

Phần lớn RAG stack lưu final text và list retrieved chunk. Chúng thường bỏ qua transformation nằm giữa hai điểm đó: OCR cleanup, table reconstruction, chunking, metadata filtering, deduplication, reranking, context packing và answer synthesis.

Mỗi transformation đều có thể làm thay đổi meaning. Provenance record vì vậy nên làm activity hiện ra:

```json
{
  "claimId": "claim_07",
  "entity": {
    "type": "answer_claim",
    "text": "The migration window is four hours."
  },
  "wasDerivedFrom": ["source_page_18_region_b"],
  "wasGeneratedBy": [
    { "activity": "hybrid_retrieval", "version": "retriever-2026-05-04" },
    { "activity": "context_packing", "version": "pack-3" },
    { "activity": "answer_generation", "model": "model-release-id" }
  ],
  "confidence": "partial"
}
```

Mục tiêu không phải lưu mọi token mãi mãi. Mục tiêu là giữ đủ lineage theo risk level của claim. Low-stakes answer có thể giữ reference compact trong thời gian ngắn. Workflow regulated có thể cần immutable evidence snapshot, model version, parser version và reviewer action.

Đây cũng là lý do provenance không nên được triển khai như “thêm thật nhiều field vào OpenTelemetry span”. Span rất tốt cho runtime correlation. Provenance record cần stable identifier cho entity và transformation, có thể được inspect sau khi request ban đầu kết thúc. Hai hệ thống có thể share ID nhưng phục vụ các query khác nhau.

## Hãy đo citation coverage

“Every answer has citations” là một quality metric yếu. Hệ thống có thể gắn một citation vào một answer năm sentence và vẫn pass. Metric tốt hơn phải hoạt động ở claim level.

| Metric | Định nghĩa | Failure được phát hiện |
|---|---|---|
| **Claim coverage** | Tỷ lệ material claim có ít nhất một evidence reference | Assertion không được support |
| **Locator precision** | Tỷ lệ citation mở đúng source region liên quan | Link quá rộng hoặc gây hiểu nhầm |
| **Evidence sufficiency** | Tỷ lệ claim mà evidence bao phủ toàn bộ statement, gồm cả exception | Partial grounding bị trình bày như full support |
| **Freshness compliance** | Tỷ lệ claim có evidence nằm trong policy window | Policy cũ và answer lỗi thời |
| **Transformation completeness** | Tỷ lệ claim có ingestion và model lineage cần thiết | Output không thể reproduce |
| **Contradiction visibility** | Tỷ lệ conflict được show ra thay vì âm thầm merge | Consensus giả |

Team nên định nghĩa material claim. Date, number, name, permission và recommendation có thể cần coverage nghiêm ngặt hơn conversational filler. Một answer ngắn có ba claim được support an toàn hơn answer dài với một citation ở cuối.

### Đánh giá cả negative path

Provenance system thường chỉ được test khi retrieval thành công. Những test quan trọng hơn gồm evidence bị thiếu, stale, conflicting hoặc locator kém chính xác. Khi source không mở được hoặc citation trỏ đến document đã xóa, answer phải degrade gracefully: qualify claim, hỏi source khác hoặc abstain.

Một contract hữu ích là:

```text
Nếu material claim không có eligible evidence,
answer phải đánh dấu uncertain,
yêu cầu clarification, hoặc từ chối nói claim đó như một fact.
```

Contract này không bắt model trở nên nhút nhát. Nó bắt interface phân biệt grounded answer với plausible completion.

## Cho user một chain of custody dễ đọc

Provenance record có thể có dạng graph nhưng UI không cần phơi bày cả graph database. Citation drawer có thể show claim, source region, document version và một summary ngắn “nó được hình thành thế nào”. Với table hoặc figure, sản phẩm có thể highlight đúng region được dùng.

![Provenance envelope đóng gói claim, source, transformation, timestamp và confidence thành một artifact có thể inspect](/blog/ai-output-provenance/provenance-envelope.webp)

Interface nên làm ba state khác nhau rõ ràng:

| State | Hành vi hướng đến user |
|---|---|
| **Supported** | Show citation và cho phép mở trực tiếp source region |
| **Partially supported** | Giải thích phần nào được support và qualify phần còn lại |
| **Uncertain hoặc unsupported** | Hỏi source, show uncertainty hoặc bỏ claim |

Không nên giấu mọi uncertainty sau một confidence percentage. Một con số không giải thích khiến user coi probability như proof. Lý do ngắn như “được support bởi policy table, nhưng exception column chưa được extract” hữu ích hơn nhiều.

## Provenance phải sống qua các lần cập nhật

Source thay đổi. Document có thể bị thay thế, web page có thể bị sửa, index có thể được rebuild bằng parser mới. Nếu provenance chỉ lưu URL hoặc document ID, việc reproduce answer cũ sẽ trở nên bất khả thi.

Hệ thống vững hơn sẽ lưu source version hoặc content hash, capture time, parser version và locator. Khi source update, sản phẩm có thể mark claim cũ là stale thay vì âm thầm trình bày như current. Khi document bị xóa, sản phẩm phân biệt “source unavailable” với “claim disproven”. Hai sự kiện đó không giống nhau.

Transformation cũng cần nguyên tắc tương tự. Nếu OCR version mới làm thay đổi một table cell, ta phải biết claim nào được tạo ra từ extraction đó. Nhờ vậy provenance trở thành change-impact tool: thay vì kiểm tra lại mọi answer, team chỉ review claim set bị ảnh hưởng.

## Một lộ trình triển khai nhỏ

Có thể đưa provenance vào từng bước. Bắt đầu bằng claim-and-evidence envelope cho một workflow có giá trị cao. Giữ page và section locator trong lúc ingest. Thêm metric material-claim coverage. Sau đó ghi transformation version ở nơi cần reproducibility.

| Phase | Deliverable | Release gate |
|---|---|---|
| **1. Capture** | Source version, locator, retrieval timestamp và answer claim ID | Mọi material claim có evidence reference hoặc explicit unsupported status |
| **2. Link** | Claim-to-source mapping với parser và retriever version | Reviewer mở được source region liên quan |
| **3. Qualify** | Supported, partial, contradiction, stale và uncertain state | UI không còn trình bày partial support như fact |
| **4. Monitor** | Coverage, locator precision, freshness và contradiction metric | Regression chặn workflow release |
| **5. Impact** | Source-version update invalidate claim bị ảnh hưởng | Team chỉ cần revalidate answer set bị tác động |

Thiết kế này cố ý vừa phải. Provenance không phải lời hứa rằng mọi sentence được generate đều đúng. Nó là cơ chế khiến mối quan hệ giữa hệ thống và evidence trở nên visible, queryable và correctable.

Khi user hỏi “Câu này đến từ đâu?”, câu trả lời không nên chỉ là một citation dán ở cuối paragraph. Nó nên là một chain giải thích source nói gì, hệ thống đã transform gì, model đã claim gì và uncertainty còn nằm ở đâu. Đó là khác biệt giữa một RAG answer trông có vẻ grounded và một answer có thể đứng vững trước việc kiểm tra.

## References

[1]: https://www.w3.org/TR/prov-overview/ "W3C PROV Overview"
[2]: https://opentelemetry.io/docs/specs/semconv/gen-ai/ "OpenTelemetry Generative AI semantic conventions"
[3]: https://arxiv.org/abs/2005.11401 "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"
[4]: https://www.nist.gov/itl/ai-risk-management-framework "NIST AI Risk Management Framework"
[5]: https://www.anthropic.com/research/building-effective-agents "Building Effective Agents — Anthropic"
