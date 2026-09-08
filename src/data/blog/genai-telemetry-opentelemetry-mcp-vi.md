---
title: "Telemetry cho GenAI có thể di chuyển: OpenTelemetry Semantics cho Agent và MCP"
description: "Cách thiết kế trace vendor-neutral cho model call, retrieval, tool use, MCP session, privacy control và cost accounting mà không bị khóa vào một provider."
pubDate: 2026-07-28
category: "engineering"
image: "/blog/genai-telemetry-opentelemetry-mcp/hero.webp"
lang: "vi"
translationKey: "genai-telemetry-opentelemetry-mcp"
draft: false
---

![Minh họa nét vẽ tay về bản đồ observability gồm AI agent, MCP server, model provider, retrieval store và telemetry trace portable](/blog/genai-telemetry-opentelemetry-mcp/hero.webp)

Trace AI đầu tiên tôi nhìn thấy trong production đầy đủ về mặt kỹ thuật nhưng gần như vô dụng khi vận hành.

Nó có request ID, status 200 và một con số latency. Nó không nói model version nào đã ra quyết định, passage nào được retrieval chọn, tool nào được gọi, có MCP server tham gia không, đã tiêu thụ bao nhiêu token, hay trace có vô tình copy secret của khách hàng vào log line không.

Đó là khoảng trống observability của nhiều AI system. Team thêm logging xung quanh một LLM call, nhưng production agent không phải một LLM call. Nó là một distributed decision path đi qua model provider, retrieval system, tool server, policy gate, queue, human approval và external side effect.

Công việc về GenAI semantic conventions của OpenTelemetry đáng chú ý vì xem những signal này như một vocabulary dùng chung thay vì một dashboard feature của từng provider.[1] Giá trị cốt lõi là portability: trace phát ra từ model gateway này vẫn phải hiểu được sau khi team đổi provider, router, orchestration framework hoặc MCP server.

> **Luận điểm:** Telemetry là contract giữa các system boundary. Nếu vocabulary đổi mỗi lần model provider đổi, tổ chức chưa thật sự sở hữu observability của mình.

## Bắt đầu từ execution graph, không bắt đầu từ dashboard

Trước khi chọn attribute, hãy vẽ đường đi của một user task qua system. Một agent turn điển hình có thể là:

```text
request
  -> policy và tenant context
  -> model decision
  -> retrieval
  -> MCP initialize
  -> tool call
  -> external service
  -> model synthesis
  -> response và outcome
```

Mỗi boundary có một câu hỏi khác nhau. Model span hỏi model và parameter nào được dùng. Retrieval span hỏi index, query và document nào được chọn. MCP span hỏi server, protocol version và capability nào được negotiate. Tool span hỏi operation nào chạy và có mutation state không. Outcome span hỏi điều gì thật sự xảy ra bên ngoài prose của model.

Dashboard chỉ hiện “LLM latency” không thể trả lời các câu đó. Trace hiện mọi prompt ở plaintext có thể trả lời, nhưng lại tạo data leak. Bài toán engineering là ghi đủ structure để debug behavior mà không copy toàn bộ thế giới vào logging system.

![Minh họa nét vẽ tay về execution graph tách model, retrieval, MCP, tool, policy và outcome span](/blog/genai-telemetry-opentelemetry-mcp/execution-graph.webp)

| Boundary    | Câu hỏi cốt lõi                      | Signal hữu ích                                         |
| ----------- | ------------------------------------ | ------------------------------------------------------ |
| Model       | Inference decision nào đã xảy ra?    | Provider, model, operation, token usage, finish reason |
| Retrieval   | Evidence nào được đưa vào?           | Index, query hash, result count, document ID, score    |
| MCP session | Protocol context nào được negotiate? | Server identity, protocol version, capability, outcome |
| Tool        | Authority nào đã được sử dụng?       | Tool name, schema version, approval, mutation class    |
| Policy      | Guardrail nào đã quyết định?         | Policy ID, decision, reason code, redaction count      |
| Outcome     | Thế giới bên ngoài đã thay đổi gì?   | State diff, event ID, external request status          |

Boundary map nên tồn tại trước instrumented code. Nó là architecture artifact, không phải việc phụ thêm cho SRE dashboard.

## Dùng stable core và extensible attributes

Semantic convention hoạt động tốt nhất khi tách stable core khỏi domain-specific detail. Core phải đủ nhỏ để triển khai qua nhiều provider và đủ chặt để query cross-system. Extension có thể thêm router, MCP, retrieval hoặc business attribute mà không bắt mọi consumer phải hiểu mọi field.

Một model call span tối thiểu có thể mang:

```json
{
  "span.name": "gen_ai.chat",
  "gen_ai.operation.name": "chat",
  "gen_ai.system": "provider-gateway",
  "gen_ai.request.model": "model-family-a",
  "gen_ai.response.finish_reasons": ["tool_call"],
  "gen_ai.usage.input_tokens": 1380,
  "gen_ai.usage.output_tokens": 92,
  "gen_ai.response.id": "resp_7d2"
}
```

Tên attribute cụ thể nên theo OpenTelemetry convention đã được platform team pin version. Nguyên tắc bền vững hơn mọi field riêng lẻ là: **meaning ổn định, cardinality rõ ràng, sensitivity được document**.

Đừng đưa unbounded user text, full prompt hay toàn bộ retrieved document vào low-cardinality metric label. Prompt hash, template ID, content classification và redaction count thường hữu ích cho vận hành hơn raw prompt. Chỉ lưu evidence phong phú trong controlled trace store khi policy cho phép.

| Loại signal    | Phù hợp với                          | Lỗi phổ biến                                  |
| -------------- | ------------------------------------ | --------------------------------------------- |
| Span attribute | Structured context của một operation | Đưa full prompt vào indexed attribute         |
| Span event     | Event có ý nghĩa tại một thời điểm   | Emit từng token thành high-volume event       |
| Metric         | Aggregated trend và alerting         | Label bằng user ID, prompt hoặc document text |
| Log            | Diagnostic detail cho người đọc      | Lặp lại secret đã có trong trace              |
| Link           | Nối asynchronous work liên quan      | Ép queue và child span thành một trace        |

Observability schema nên có sensitivity classification. Field an toàn trong local debug trace có thể không an toàn trong metrics backend dùng chung.

## Instrument MCP như một protocol boundary

MCP không chỉ là một HTTP endpoint khác. Specification của nó định nghĩa lifecycle và capability exchange, đồng thời coi tools, resources, prompts, roots, sampling và elicitation là những protocol concept riêng.[2] Telemetry nên giữ nguyên hình dạng đó.

Khi initialize session, ghi nhận server identity, protocol version, capability đã negotiate, transport class và outcome. Khi list tool, ghi schema version hoặc fingerprint thay vì copy tool description có thể nhạy cảm vào mọi trace. Khi invoke tool, ghi logical name, validation result, approval state và mutation class. Khi đọc resource, ghi stable identifier và access decision.

```text
mcp.session
  ├── mcp.initialize        protocol=2025-06-18, caps=tools/resources
  ├── mcp.tool.list         schema_fingerprint=sha256:...
  ├── mcp.tool.call         name=lookup_case, mutation=read
  └── policy.decision       decision=allow, reason=least_privilege
```

Nhờ vậy, một câu hỏi production trở nên có thể trả lời: “Behavior của agent đổi vì model đổi, vì MCP server advertise capability mới, hay vì tool schema thay đổi?” Không có protocol-level span, mọi nguyên nhân sẽ bị nén thành một model trace mơ hồ.

Mặc định đừng ghi tool argument. Hãy classify argument, redact field nhạy cảm và giữ deterministic hash khi cần correlation. Với high-risk write, link agent span đến approval record và external request ID, nhưng đừng biến model text thành audit artifact duy nhất.

## Trace evidence path mà không làm rò rỉ evidence

RAG system tạo ra một trade-off observability khó. Nếu response sai, engineer cần biết model đã thấy evidence nào. Nếu lưu mọi retrieved chunk vào trace backend dùng chung, system có thể biến thành bản sao của knowledge base công ty.

Thiết kế an toàn hơn là lưu **retrieval manifest** trong trace và giữ raw content dưới một policy access-controlled riêng:

```json
{
  "retrieval.index": "support-policy-v4",
  "retrieval.query_hash": "sha256:9a1...",
  "retrieval.result_count": 6,
  "retrieval.documents": [
    {
      "id": "policy-v2-section-03",
      "score": 0.84,
      "classification": "internal"
    }
  ],
  "retrieval.redacted": true
}
```

Manifest trả lời document và score nào đã tham gia. Privileged investigation path có thể resolve document ID nếu incident cần. Dashboard thông thường không cần paragraph text.

Đây cũng là nơi provenance và temporal retrieval trở nên hữu ích về vận hành. Nếu answer phải valid tại một historical date, trace nên lưu interval được suy ra và validity interval của document được chọn. Nếu source stale hoặc superseded, trace phải làm điều đó nhìn thấy được.

![Minh họa nét vẽ tay về evidence manifest gồm document ID, score, time interval và redaction state mà không lộ raw content](/blog/genai-telemetry-opentelemetry-mcp/evidence-manifest.webp)

## Nối cost và latency với quality

Token usage không phải finance report. Latency không phải user value. Nhưng cả hai trở nên hữu ích khi nối với cùng workflow và outcome.

Hãy ghi input và output token, cache hit, model route, retry count, queue wait, tool latency và end-to-end duration. Sau đó tính cost bằng một pricing table có version bên ngoài trace schema. Đừng hard-code price vào historical span; pricing của model và rule phân bổ nội bộ có thể thay đổi.

Một workflow-level cost record có thể như sau:

```json
{
  "workflow.id": "case-4821-turn-09",
  "model.cost_usd": 0.0124,
  "retrieval.cost_usd": 0.0003,
  "tool.cost_usd": 0.0041,
  "workflow.cost_usd": 0.0168,
  "outcome": "draft_created",
  "quality.bucket": "accepted_with_minor_edit"
}
```

Câu hỏi hữu ích không phải “model nào dùng nhiều token nhất?” mà là “một safe outcome thành công của workflow và tenant này tốn bao nhiêu?” Muốn trả lời phải có correlation ID ổn định và định nghĩa success độc lập với response của model.

| Metric                      | Nối với                     | Quyết định hỗ trợ                 |
| --------------------------- | --------------------------- | --------------------------------- |
| Cost mỗi trace              | Outcome và tenant           | Budget, showback, route selection |
| p95 model latency           | Tool và queue span          | Timeout và UX policy              |
| Retry rate                  | Error class và provider     | Backoff, failover, chọn provider  |
| Citation coverage           | Retrieved document manifest | Thay đổi retrieval và prompt      |
| Unauthorized-action attempt | Policy decision             | Safety hardening và release gate  |

## Privacy là một phần của telemetry design

OWASP xem sensitive information disclosure là rủi ro lớn của LLM application và khuyến nghị sanitization, strict access controls, tokenization, redaction cùng system configuration cẩn thận.[3] Các kiểm soát này không thể gắn thêm sau khi trace schema đã bị copy vào năm backend.

Hãy định nghĩa capture policy theo field và environment. Development có thể ghi một prompt ngắn, synthetic. Staging có thể ghi template đã redact và hash. Production có thể chỉ ghi metadata cho high-risk tenant. Incident mode có thể cấp quyền có thời hạn vào encrypted payload kèm approval record rõ ràng.

```text
field -> classification -> capture mode -> retention -> access owner
prompt -> confidential -> hash + template ID -> 7 days -> AI platform
tool args -> restricted -> schema + redacted values -> 30 days -> tool owner
raw document -> sensitive -> no default capture -> source policy -> data owner
```

Redaction phải observable mà không lộ value. Ghi nhận có ba field bị redact, policy nào thực hiện và redaction có làm thay đổi model input không. Engineer nhờ đó chẩn đoán được quality regression mà không biến telemetry store thành kho dữ liệu nhạy cảm.

## Dùng trace làm release evidence, không chỉ incident evidence

Portable semantic contract giúp ích cho evaluation. Một release case có thể assert agent đã emit MCP initialization span với capability kỳ vọng, retrieval span có document manifest, write tool có approval link và không có raw secret trong exported trace.

Như vậy observability cũng trở thành thứ có thể test. Team không còn chỉ hỏi dashboard có đủ dữ liệu không; team assert rằng evidence cần để debug một AI decision có tồn tại và an toàn để lưu giữ.

Telemetry test matrix nên có missing span, sai parent-child relationship, cardinality explosion, sensitive-field leak, model name không nhất quán và trace break qua asynchronous queue. Những lỗi này nên làm instrumentation test fail trước khi biến thành incident investigation.

## Thiết kế để chịu được provider change

Provider abstraction thường được bàn như một API interface. Yêu cầu sâu hơn là semantic continuity. Khi router chuyển request từ provider A sang provider B, trace phải giữ nguyên workflow ID, operation name, evaluation cohort, policy decision và outcome field. Provider-specific attribute có thể nằm bên dưới stable core.

Nếu dashboard query có nghĩa “successful tool-calling workflow theo model family và tenant”, nó phải sống qua một provider migration. Nếu không, tổ chức đã couple observability vào vocabulary của vendor.

Hãy pin semantic-convention version, document extension được phép và review schema change giống API change. Đổi tên field có thể phá incident query chắc chắn như breaking endpoint làm hỏng client.

## Kết luận

AI trace có giá trị nhất không phải trace dài nhất. Đó là trace cho phép engineer tái dựng decision path, kiểm tra evidence đúng, hiểu authority đã sử dụng, định lượng operational cost và làm tất cả điều ấy mà không tạo thêm một data-leak channel.

Định hướng GenAI của OpenTelemetry cho team một standards anchor hữu ích. MCP cho trace một protocol boundary giàu ngữ nghĩa hơn HTTP request. Production discipline hoàn thiện phần còn lại: vocabulary ổn định, sensitivity rõ, cardinality có giới hạn, evidence manifest, cost signal có thể nối và test chứng minh telemetry sống sót sau system change.

Hãy xây telemetry có thể di chuyển. Model provider, router, orchestration library và MCP server tiếp theo nên thay đổi implementation, không thay đổi ý nghĩa của operational evidence.

## Tài liệu tham khảo

[1]: https://github.com/open-telemetry/semantic-conventions-genai "OpenTelemetry Semantic Conventions for Generative AI"
[2]: https://modelcontextprotocol.io/specification/2025-06-18 "Model Context Protocol Specification 2025-06-18"
[3]: https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/ "OWASP LLM02:2025 Sensitive Information Disclosure"
