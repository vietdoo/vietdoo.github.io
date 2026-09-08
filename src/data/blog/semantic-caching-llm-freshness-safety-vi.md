---
title: "Semantic Caching cho LLM App: Freshness, Safety và Evaluation Playbook"
description: "Semantic caching giúp LLM app nhanh và rẻ hơn, nhưng một cache hit không chứng minh câu trả lời đúng. Playbook production này đi qua freshness, invalidation, scope, poisoning, intermediate context và cách đánh giá chất lượng."
pubDate: 2026-07-03
category: "engineering"
image: "/blog/semantic-caching/hero.webp"
lang: "vi"
translationKey: "semantic-caching-llm-freshness-safety"
draft: false
---

![Semantic cache bảo vệ LLM app bằng các lớp freshness, authorization và evaluation](/blog/semantic-caching/hero.webp)

Tôi từng xem một support assistant trả lời câu hỏi của khách hàng trong chưa tới 100 milliseconds. Biểu đồ latency rất đẹp. Chi phí token giảm rõ rệt. Cache hit rate đủ cao để dashboard trông giống một câu chuyện thành công.

Sau đó, đội policy sửa một câu trong quy định hoàn tiền.

Assistant vẫn trả lời theo quy định cũ, bởi câu hỏi mới có ý nghĩa rất gần với một câu hỏi đã được cache từ tuần trước. Không có service nào sập. Không có API nào trả về 500. Embedding search làm chính xác điều nó được yêu cầu làm. Hệ thống nhanh, rẻ và sai theo một cách rất khó nhìn thấy nếu chỉ quan sát metric hạ tầng.

Đó là bài toán production của semantic caching. Nó không chỉ là một key-value store thông minh hơn nhờ vector. Nó là **một hệ thống ra quyết định, quyết định khi nào một phần “lao động của model” trong quá khứ đủ an toàn để được dùng lại**.

> **Luận đề:** Semantic cache chỉ nên tối ưu một response sau khi xác nhận ba điều: request nằm trong cùng policy scope, evidence đã cache vẫn đủ mới cho request hiện tại, và rủi ro chất lượng khi reuse nằm dưới ngưỡng mà application chấp nhận được.

Bài viết này xây dựng một playbook thực tế cho LLM và RAG application. Phần đầu giải thích cơ chế cơ bản, nhưng trọng tâm nằm ở những thứ quyết định cache là một performance feature hay một correctness bug âm thầm: freshness, invalidation, authorization, poisoning, intermediate context, evaluation và rollout.

## Semantic caching là similarity cộng với một lớp policy

Caching truyền thống dùng một key xác định. Request như `GET /products/4821?currency=VND` ánh xạ tới một cache key đã biết, rồi hệ thống hoặc tìm thấy representation chính xác đó, hoặc cache miss. Contract tương đối đơn giản: key mô tả request và expiration policy mô tả thời gian representation được phép reuse.

LLM request thường không lặp lại ở cấp độ chuỗi ký tự. Một khách hàng có thể hỏi “Tôi có được trả lại món hàng này không?”, “Thời hạn hoàn tiền cho đơn này là bao lâu?” hoặc “Tôi đổi ý thì có bao nhiêu ngày để gửi hàng trở lại?”. Cách diễn đạt khác nhau, nhưng intent có thể tương tự. Embedding biến một chuỗi văn bản thành một vector, còn similarity search có thể tìm những request trước đó gần về mặt ý nghĩa. Tài liệu OpenAI mô tả embedding là biểu diễn vector dùng để đo mức độ liên quan giữa các chuỗi văn bản, trong đó cosine similarity là một cách so sánh phổ biến.

Redis mô tả semantic-cache flow cơ bản gồm embedding query mới, tìm kiếm vector đã lưu, trả cached response khi similarity vượt threshold, và gọi LLM khi cache miss. Đây là điểm bắt đầu hữu ích. Nó chưa phải production contract.

![Request đi qua normalization, scope check, semantic lookup và freshness validation trước khi được phép cache hit hoặc chạy model mới](/blog/semantic-caching/pipeline.webp)

Một cache production phải trả lời những câu hỏi mà similarity không thể tự trả lời:

| Câu hỏi | Vì sao vector score chưa đủ |
|---|---|
| Request có cùng tenant, user, product hoặc permission scope không? | Hai câu hỏi có thể giống hệt ý nghĩa nhưng không được dùng chung câu trả lời. |
| Source material còn mới không? | Similarity cao không nói gì về document version hay tuổi của policy. |
| Cached answer được tạo bởi cùng prompt, model và policy không? | Thay đổi instruction hoặc tool semantics có thể làm answer cũ không còn tương thích. |
| Đây là giải thích read-only hay một quyết định có side effect? | Reuse FAQ ít rủi ro không tương đương replay approval decision. |
| Cache record có bị poisoning hoặc nhiễm dữ liệu không? | Cache trở thành storage lâu dài cho mọi sai lầm lọt qua write path. |

Thay đổi mental model là điều quan trọng nhất: hãy coi vector score là **một tín hiệu bên trong cache admission policy**, không phải bản thân policy.

## Chọn đúng thứ để cache

Nhiều team bắt đầu bằng cách cache final text vì nó dễ lưu và dễ trả về. Cách này hợp lý với FAQ ổn định. Nó không phải default tốt cho mọi RAG hay agentic workflow.

Có ít nhất bốn cache boundary:

| Boundary | Thứ được lưu | Phù hợp với | Rủi ro chính |
|---|---|---|---|
| **Embedding lookup** | Query vector hoặc normalized intent | Tránh tạo lại embedding cho các request lặp | Vector không phải answer và vẫn cần retrieval policy an toàn. |
| **Retrieved context** | Document chunk, summary hoặc ranked evidence | RAG nơi source thay đổi độc lập với generation | Evidence cũ hoặc trái quyền có thể bị reuse. |
| **Intermediate computation** | Query rewrite, classification, extraction hoặc contextual summary | Pipeline nhiều bước có các subproblem lặp lại | Một lỗi có thể lan sang nhiều answer phía sau. |
| **Final answer** | Model text đi kèm evidence và metadata | Câu hỏi read-only, ổn định, ít rủi ro | Answer có thể cũ, sai scope hoặc không tương thích với policy mới. |

Một nguyên tắc thực dụng là cache **lớp thấp nhất vừa tốn chi phí vừa đủ an toàn để recompute vào request hiện tại**. Nếu product catalog thay đổi thường xuyên, hãy cache retrieval result đã normalized cùng document version thay vì một câu cuối cùng nói “sản phẩm có giá 599.000 VND”. Nếu classification ổn định và không phụ thuộc tenant, có thể cache classification. Nếu output cấp credit, thay đổi account state hoặc làm lộ dữ liệu cá nhân, đừng xem final answer là object có thể chia sẻ tự do.

Nghiên cứu về semantic caching cho contextual summary cũng đi đến một hướng tương tự: intermediate result có thể được reuse giữa các request liên quan và chịu được partial document update cùng thay đổi access pattern tốt hơn việc chỉ cache end-to-end answer. Hệ quả thực tế là cache boundary là một quyết định kiến trúc, không phải một tối ưu storage.

## Mỗi entry cần có cache envelope

Một cache record phải mang đủ thông tin để read path tự quyết định việc reuse có an toàn không. Lưu đơn giản `{query, answer, embedding}` là chưa đủ cho production.

```ts
type CacheEnvelope = {
  id: string;
  queryFingerprint: string;
  embedding: number[];
  answer?: string;
  context?: Array<{
    documentId: string;
    version: string;
    chunkId: string;
    contentHash: string;
  }>;
  tenantId: string;
  subjectScope: string;
  model: string;
  promptVersion: string;
  policyVersion: string;
  retrievalVersion: string;
  createdAt: string;
  expiresAt: string;
  riskClass: "low" | "medium" | "high";
  provenance: "human-reviewed" | "generated" | "imported";
  status: "active" | "stale" | "revoked";
};
```

Envelope này cố tình rất “nhàm chán”. Metadata nhàm chán giúp ngăn những incident thú vị.

`tenantId` và `subjectScope` ngăn response tạo cho khách hàng này trở thành answer của khách hàng bên cạnh. `promptVersion`, `policyVersion` và `retrievalVersion` ngăn cache hit âm thầm vượt qua release boundary. Document version và content hash khiến invalidation có thể giải thích được. `riskClass` cho phép dùng policy thận trọng hơn với answer liên quan đến tài chính, identity, y tế hoặc thay đổi state.

Cache key nên được tạo từ các field có ý nghĩa về policy, không chỉ từ raw user question. Một shape có thể là:

```text
semantic-cache:v3:
  tenant={tenantId}:
  scope={subjectScope}:
  model={model}:
  prompt={promptVersion}:
  policy={policyVersion}:
  retrieval={retrievalVersion}:
  boundary={cacheBoundary}
```

Semantic index vẫn có thể tìm bằng embedding, nhưng mọi candidate phải đi qua deterministic scope filter trước khi similarity score được xem xét. Similarity không bao giờ được trở thành con đường vượt qua authorization boundary.

## Freshness không đồng nghĩa với TTL

Time-to-live hữu ích, nhưng TTL chỉ là một cách biểu đạt freshness. RFC 9111 phân biệt khá rõ với HTTP cache: response là fresh khi age còn nằm trong freshness lifetime, còn stale response có thể cần được validation trước khi reuse. Mental model này áp dụng tốt cho LLM cache, với một bổ sung quan trọng: **origin thường là document store, policy service, database hoặc tool — không chỉ là web server**.

Hãy tưởng tượng policy answer được tạo lúc 09:00 với `policyVersion=41`. Đến 09:05, policy service publish version 42. Cached answer có thể mang TTL một giờ, nhưng nó không còn fresh so với policy source. Chờ đến 10:00 không phải freshness policy; đó là cách trì hoãn việc phát hiện bug.

Nên kết hợp nhiều freshness signal:

| Signal | Ý nghĩa | Hành động thường dùng |
|---|---|---|
| TTL | Tuổi tối đa làm fallback | Reject hoặc revalidate sau khi hết hạn. |
| Source version | Version chính xác của policy, document, price list hoặc schema | Invalidate khi version thay đổi. |
| Content hash | Material dùng cho answer có thay đổi không | Recompute các entry bị ảnh hưởng. |
| Event timestamp | Source phát update lúc nào | Trigger targeted invalidation. |
| Risk class | Answer cũ sẽ gây tốn kém đến đâu | TTL ngắn hơn hoặc không reuse final answer ở risk cao. |
| Validation result | Candidate còn khớp current evidence không | Allow, hạ xuống context-only hoặc miss. |

![Freshness matrix kết hợp source version, TTL, risk class và validation result trước khi cho phép reuse](/blog/semantic-caching/freshness-matrix.webp)

Một invalidation rule tốt thường cụ thể hơn “mỗi giờ xóa hết một lần”. Nếu `refund-policy-v42` thay đổi, hãy invalidate những entry có provenance chứa document đó. Nếu role của user bị revoke, invalidate entry scoped theo subject ấy. Nếu prompt đổi từ `support-v7` sang `support-v8`, hoặc namespace cache rõ ràng, hoặc chạy migration job để regrade entry cũ một cách có chủ đích.

Với RAG, có thể biểu diễn dependency edge tường minh:

```text
cache_entry_9f2
  depends_on -> refund-policy:v42#chunk-7
  depends_on -> return-form:v12#chunk-2
  generated_by -> support-prompt:v7
  constrained_by -> policy-bundle:v19
```

Entry không nhất thiết phải bị xóa ngay lập tức sau mọi update. Stale marker có thể route entry sang revalidation, background refresh hoặc intermediate-context reuse. Điều quan trọng là hệ thống biết *vì sao* entry stale và có thể thể hiện lý do đó trong trace.

## Threshold phải được tune bằng outcome, không phải cảm giác

Similarity threshold là một control hữu ích nhưng không có một giá trị đúng cho mọi nơi. Threshold thấp thường tạo nhiều hit hơn và nhiều false positive hơn. Threshold cao an toàn hơn nhưng có thể bỏ lỡ những cơ hội reuse tốt. Giá trị phù hợp phụ thuộc vào ngôn ngữ, domain, embedding model, query distribution, risk và lượng context được giữ trong cached record. Nghiên cứu về semantic caching xem threshold là trade-off giữa utility và hit rate, không phải một công thức một con số.

Hãy xây một threshold set offline từ traffic thật đã được sanitize. Gắn nhãn các cặp query theo những nhóm như sau:

| Nhãn | Ý nghĩa |
|---|---|
| **Safe reuse** | Cùng intent, cùng scope, cùng evidence liên quan và answer tương đương. |
| **Context reuse only** | Câu hỏi gần nhau nhưng final answer phải generate lại trên evidence hiện tại. |
| **Miss required** | Intent, authority hoặc source đã khác; hoặc ambiguity có risk cao. |
| **Adversarial** | Similarity được tạo ra để dụ cache vượt boundary hoặc reuse dữ liệu poisoned. |

Sau đó đánh giá nhiều thứ hơn hit rate. Scorecard nên có cache precision, cache recall, answer correctness, stale-answer rate, unauthorized reuse rate, p50/p95 latency, token savings và cost trên mỗi successful task.

```text
cache_precision = safe_reuses / all_cache_hits
cache_recall    = safe_reuses / all_requests_that_could_reuse
stale_rate      = stale_hits / all_cache_hits

quality_adjusted_savings =
  (baseline_cost - cache_cost) * correct_answer_rate
```

Metric cuối cố tình bảo thủ. Một câu trả lời sai nhưng rẻ không phải là một tối ưu thành công. Nếu cache giảm 60% model spend nhưng tạo unauthorized reuse rate 2% trong workflow nhạy cảm, dashboard không nên ăn mừng khoản tiết kiệm thô đó.

Dùng threshold riêng cho từng risk class. Public product FAQ có thể chấp nhận threshold thấp hơn identity-verification assistant. Final answer có thể cần threshold cao hơn context candidate vì final answer đã commit vào một kết luận.

## Bảo vệ cache trước poisoning và replay

Semantic cache làm tăng “thời gian sống” của một sai lầm từ model. Không có cache, answer xấu có thể biến mất sau request kế tiếp hoặc prompt update. Có cache, sai lầm có thể được retrieve liên tục và trông như đã được xác nhận vì nó nhất quán. Nhất quán không phải bằng chứng của tính đúng.

Có một số đường poisoning phổ biến:

1. Malicious user gửi prompt khiến model tạo answer nguy hiểm, với hy vọng request tương tự sau đó sẽ nhận lại answer ấy.
2. Retrieved document chứa instruction nhưng bị đối xử như trusted answer content rồi được lưu cùng kết quả.
3. Operator import cache snapshot từ nhầm environment hoặc nhầm tenant.
4. Prompt hoặc policy đã đổi nhưng namespace cũ vẫn còn searchable.

Mitigation phải nằm ở kiến trúc. Tách quyền ghi cache khỏi quyền đọc cache. Đánh dấu entry chưa review là generated chứ không phải trusted. Đừng cache authorization decision của tool như thể đó là một fact độc lập với user. Lưu provenance và luôn có đường revocation. Với flow risk cao, chỉ dùng cache để retrieve evidence rồi buộc current policy/model đưa ra quyết định mới.

Điều này liên quan trực tiếp tới prompt-injection defense. Cached response vẫn là model-produced data. Nếu một document độc hại tác động được vào cached answer, user sau đó có thể gặp payload mà không hề gửi original malicious query. Hãy coi cached text là untrusted input ở prompt boundary kế tiếp, giữ source identifier và áp dụng cùng cách tách data khỏi instruction như trong agent system nói chung.

## Scope là security property, không phải chi tiết hiệu năng

Cache hit có thể hoàn hảo về ngữ nghĩa nhưng vẫn là data breach. Hãy xét hai nhân viên cùng hỏi “Reimbursement của tôi đang ở trạng thái nào?”. Hai câu hỏi gần nhau trong vector space. Answer của họ không được dùng chung, trừ khi cache record thực sự trỏ tới một public source giống nhau.

Tối thiểu, hãy quyết định cache boundary thuộc scope nào:

| Scope | Ví dụ | Default an toàn |
|---|---|---|
| Public | Published return policy | Shared, kèm source-version validation. |
| Tenant | Internal handbook của một công ty | Chỉ shared trong tenant. |
| User | Order history của một người | Key theo user và subject. |
| Session | Assumption tạm trong một conversation | Key theo session/thread, sống ngắn. |
| Action | Decision hoặc authorization | Không reuse như answer chung; recompute hoặc revalidate. |

Scope phải được kiểm tra trước vector similarity. Điều này tương tự double-keying trong web cache để giảm privacy risk: identity context là một phần của lookup contract chứ không phải việc sửa sau cùng.

Đừng để model tự suy ra scope từ câu hỏi. Scope phải đến từ authenticated request context, server-side policy và authorization snapshot hiện tại. Nếu user hiện tại không truy cập được source document, cache không được tiết lộ summary của document đó, dù summary trông có vẻ vô hại.

## Quan sát cache như một quality system

Dashboard chỉ có hit rate và latency là lời mời tối ưu nhầm thứ. Hãy thêm cache-specific telemetry vào cùng trace với model và retrieval step. Những event tối thiểu hữu ích gồm:

| Event | Field nên ghi nhận |
|---|---|
| `cache.lookup` | boundary, tenant hash, candidate count, top score, threshold, scope result |
| `cache.reject` | reason: scope, stale, policy version, low score, risk, missing provenance |
| `cache.hit` | entry age, source age, model, prompt version, answer reuse hay context reuse |
| `cache.miss` | miss reason và downstream latency/cost |
| `cache.write` | provenance, risk class, source dependencies, review status |
| `cache.invalidate` | dependency, actor, reason, số entry bị ảnh hưởng |
| `cache.feedback` | user correction, grader outcome, incident link, regrade result |

Không nên đưa raw private prompt và answer vào mọi trace theo mặc định. Các nguyên tắc observability đang có trên folio vẫn đúng ở đây: ưu tiên shape, version, ID, hash, count và policy decision; giữ content phía sau restricted access cùng một break-glass path rõ ràng.

![Cache-quality dashboard theo dõi hit, safe-reuse precision, stale response, invalidation và cost saving trong cùng một nơi](/blog/semantic-caching/quality-dashboard.webp)

Một cache hit chỉ nên được coi là thành công khi downstream quality signal đồng ý. Feedback loop có thể gồm user correction, citation check, deterministic policy validator, sampled human review và regression case. Khi cache hit fail, hãy lưu một failure fixture tối giản: query shape, scope, entry metadata, source version, score và observed outcome. Answer text có thể bị hạn chế hoặc redact, nhưng failure vẫn phải trở thành thứ có thể test.

## Rollout không bắt đầu bằng câu “bật lên đi”

Một rollout an toàn có thể hoàn thành trong một tuần nếu cache boundary nhỏ và domain ít rủi ro.

**Ngày 1: xác định surface đủ điều kiện.** Chọn một read-only workflow có câu hỏi lặp lại. Viết rõ thứ gì được cache, scope nào được phép, source nào quyết định freshness và answer nào luôn phải miss.

**Ngày 2: instrument shadow lookup.** Tạo embedding và tìm candidate nhưng không trả cached answer. Đo score distribution, candidate scope, source age và các cặp có khả năng reuse.

**Ngày 3: xây envelope và invalidation path.** Thêm version, provenance, source dependency, risk class và cách đánh dấu entry stale. Nếu invalidation không giải thích được, cache chưa sẵn sàng.

**Ngày 4: thêm offline và adversarial evaluation.** Test paraphrase, câu hỏi mơ hồ, document đã đổi, access bị revoke, prompt version thay đổi, poisoned record và cross-tenant collision.

**Ngày 5: bật context-only reuse.** Cho cache cung cấp evidence hoặc summary, nhưng dùng prompt và policy hiện tại để tạo final answer mới. Đây thường là chiến thắng đầu tiên an toàn hơn việc trả về final text cũ.

**Ngày 6: bật final-answer reuse cho risk thấp.** Dùng threshold bảo thủ, traffic nhỏ và kill switch tức thời. Ghi nhận mọi lý do reject, không chỉ hit.

**Ngày 7: xem xét quality-adjusted savings.** Chỉ promote khi cache cải thiện latency hoặc cost mà không phá vỡ correctness, freshness, privacy và safety budget.

## Production checklist

Trước khi bật final-answer reuse, hãy chắc rằng hệ thống có thể trả lời câu hỏi “Tại sao answer này được reuse?” bằng evidence chứ không phải chỉ bằng một similarity score.

| Khu vực | Câu hỏi production |
|---|---|
| Boundary | Ta đang cache final answer, context, classification hay embedding? |
| Scope | Candidate có thể vượt tenant, user, session hoặc authorization boundary không? |
| Freshness | Source version, event, hash, TTL hay validator nào quyết định reuse? |
| Compatibility | Model, prompt, policy, retrieval và tool-schema version đã được ghi chưa? |
| Risk | Decision có tác động lớn có bypass final-answer reuse không? |
| Poisoning | Entry có thể quarantine, revoke, regrade và truy ngược provenance không? |
| Evaluation | Có đo safe-reuse precision, stale hit và unauthorized reuse không? |
| Privacy | Raw prompt/answer có được bảo vệ, redact và giới hạn retention không? |
| Operations | Có kill switch, namespace rollback và owner cho invalidation không? |
| User experience | UI có thể giải thích uncertainty hoặc refresh khi cache chưa đủ không? |

## Kết luận: cache nằm trong trust boundary của answer

Semantic caching hấp dẫn vì cùng lúc tấn công hai đặc tính khó chịu của LLM system: công việc lặp lại và latency khó đoán. Embedding giúp nhận ra các request liên quan ngay cả khi câu chữ thay đổi. Vector search làm lookup thực tế hơn. Nhưng không thứ nào trong đó tạo ra correctness guarantee.

Thiết kế production-grade là một policy pipeline. Trước hết, giới hạn candidate theo tenant và authority. Tiếp đó validation model, prompt, policy, retrieval và source version. Áp dụng threshold đã được calibration bằng outcome, không phải bằng anecdote. Ưu tiên intermediate context reuse khi final-answer reuse có thể đóng băng một kết luận cũ. Theo dõi provenance và giữ đường revocation. Cuối cùng, đánh giá cache bằng quality-adjusted savings thay vì raw hit rate.

Cache hit không phải điểm kết thúc của quyết định. Đó là khoảnh khắc hệ thống phải chứng minh rằng reuse một phần intelligence cũ an toàn hơn làm lại từ đầu.

## Tài liệu tham khảo

[1]: https://developers.openai.com/api/docs/guides/embeddings "OpenAI — Vector embeddings"
[2]: https://redis.io/blog/what-is-semantic-caching/ "Redis — What is semantic caching? Guide to faster, smarter LLM apps"
[3]: https://arxiv.org/html/2505.11271v1 "Couturier et al. — Semantic Caching of Contextual Summaries for Efficient Question-Answering with Language Models"
[4]: https://www.rfc-editor.org/rfc/rfc9111 "RFC 9111 — HTTP Caching"
[5]: https://genai.owasp.org/llmrisk/llm01-prompt-injection/ "OWASP Gen AI Security Project — LLM01:2025 Prompt Injection"
