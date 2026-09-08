---
title: "Observability cho AI Agent: Trace Prompt, Tool Call, Token và Cost mà không biến Log thành rò rỉ dữ liệu"
description: "Một trace agent cần giải thích được vì sao hệ thống chậm, đắt, sai hoặc nguy hiểm—nhưng không được biến prompt, tool payload và response thành một data lake không kiểm soát. Đây là blueprint metadata-first để quan sát an toàn."
pubDate: 2026-05-06
category: "engineering"
image: "/blog/agent-observability-hero.webp"
lang: "vi"
translationKey: "agent-observability-without-data-leaks"
draft: false
---

![Kỹ sư quan sát trace AI agent trong khi kho dữ liệu nhạy cảm được bảo vệ](/blog/agent-observability-hero.webp)

<figure class="blog-video">
  <video controls preload="metadata" playsinline poster="/blog/agent-observability-hero.webp" aria-label="Video giải thích nội dung bài viết, phiên bản tiếng Việt">
    <source src="/blog/agent-observability-without-data-leaks/video-vi.mp4" type="video/mp4" />
    Trình duyệt của bạn không hỗ trợ video HTML5.
  </video>
  <figcaption>Video giải thích chuyên sâu: phiên bản tiếng Việt.</figcaption>
</figure>

Một support agent vừa khiến bạn tốn tiền, trả lời chậm và đưa ra hướng dẫn sai. Khi bạn mở dashboard, mọi thứ lại xanh: API 200, p95 dưới ngưỡng, không có exception. Một log dòng thì nói `tool=get_customer_profile`, dòng khác nói `retry=1`. Bạn vẫn không biết chuyện gì đã xảy ra: agent đã chọn tool nào trước, tool có trả về lỗi gì, prompt version nào sinh ra hành vi đó, bao nhiêu token bị đốt trong lần retry, hay policy redaction có thực sự chạy.

Phản xạ tự nhiên là **log tất cả**. Prompt, response, tool arguments, tool results, retrieved documents, thậm chí cả “reasoning” nếu framework cho phép. Và đó là lúc observability backend biến thành một data lake thứ hai: một nơi có PII, credential, câu chuyện khách hàng, header authorization, dữ liệu tài chính và payload nội bộ—nhưng thường không có data contract, retention policy hay access review nghiêm bằng database chính.

> **Luận điểm chính:** Một trace là *bằng chứng thực thi*, không phải một transcript hội thoại. Hãy lưu đủ bằng chứng để giải thích đường đi, chi phí, quyền hạn và policy của agent; còn raw content phải đi vào một làn riêng, chỉ bật khi được phê duyệt, có thời hạn và có kiểm soát truy cập.

Đây không phải lời kêu gọi “đừng quan sát agent”. Ngược lại, agent có tool call cần quan sát sâu hơn request-response truyền thống: nó có thể gọi nhiều model, đi qua retrieval, retry, branching và tác động ra thế giới bên ngoài. OpenTelemetry đã chuẩn hóa phần lớn vocabulary cần thiết—model, token input/output, duration, tool call và, **khi opt-in**, cả content. Việc content capture tắt mặc định là một signal kiến trúc quan trọng: visibility không đồng nghĩa với được phép thu thập nội dung.[1]

Bài viết này đưa ra một blueprint production cho trace prompt, tool call, token và cost mà không biến log thành rò rỉ dữ liệu. Ví dụ xuyên suốt là **RelayDesk**, một agent CSKH đa tenant có thể tra knowledge base, đọc trạng thái tài khoản, tạo refund draft và gửi email sau approval. Mọi customer data, token, giá tiền và trace bên dưới đều là **dữ liệu minh họa**.

---

## Bài toán không phải “có log hay không”, mà là “trace phải trả lời câu gì?”

Trước khi chọn vendor, SDK hay schema, hãy viết các câu hỏi mà on-call engineer phải trả lời trong mười phút đầu của incident. Nếu một field không phục vụ ít nhất một câu hỏi, field đó không nên có mặt trong telemetry mặc định.

| Câu hỏi khi incident xảy ra | Bằng chứng cần có | Không cần lưu mặc định |
|---|---|---|
| Agent có đi đúng workflow không? | `trace.id`, agent/version, span tree, route, tool name, result class, retry count | Toàn bộ prompt và toàn bộ tool payload |
| Vì sao chậm? | Duration từng LLM/tool/retrieval span, queue time, timeout reason | Response văn bản đầy đủ |
| Vì sao đắt? | Input/output tokens, model, price-card version, retry/loop count, budget decision | Nội dung context window |
| Agent có vượt quyền không? | Tool capability, auth scope class, allow/deny, approval state, side-effect class | Authorization header hoặc access token |
| Có dữ liệu nhạy cảm đi qua không? | Data class, redaction policy/version, matched category, dropped/redacted count | Giá trị PII hoặc secret ban đầu |
| Cần điều tra một case hiếm không? | Case pointer, retention class, evidence request ID, approver/audit event | Bản copy thô luôn mở cho mọi engineer |

Bảng này buộc team bỏ một giả định nguy hiểm: **“biết nội dung” là cách duy nhất để debug**. Nhiều incident không cần content để xác định nguyên nhân. Nếu `tool.get_customer_profile` có p99 4,8 giây, được retry ba lần vì `UPSTREAM_429`, và output đã bị policy gắn `restricted`, bạn đã có đủ hướng điều tra mà không cần nhìn địa chỉ hay bearer token của khách hàng.

NIST mô tả monitoring sau triển khai của AI không chỉ là operational uptime. Nó còn chạm vào functionality, human factors, security và compliance; các team trong thực tế gặp rào cản như logging phân mảnh, drift khó phát hiện và cân bằng giữa automation với human-validated monitoring.[5] Với agent, một dashboard latency đơn thuần không giải được những lớp câu hỏi đó.

---

## Bốn mặt phẳng telemetry: đừng nhét mọi thứ vào span attributes

Một hệ thống lành mạnh tách các loại bằng chứng theo câu hỏi, access và retention. Nếu mọi thứ bị nhét vào một span JSON, bạn sẽ hoặc không có đủ dữ liệu để vận hành, hoặc có quá nhiều dữ liệu để bảo vệ.

![Ma trận bốn mặt phẳng telemetry với chính sách raw content, quyền truy cập và retention khác nhau](/blog/agent-observability-telemetry-matrix.webp)

| Mặt phẳng | Dùng để trả lời | Đơn vị dữ liệu | Default raw content | Người nên xem |
|---|---|---|---|---|
| **Trace spans** | Đường đi, dependency, lỗi, latency của một run | Span có parent/child, attributes low-cardinality | Không; chỉ metadata, fingerprint, safe summary | Engineering, SRE |
| **Metrics** | Hệ thống có khỏe và nằm trong budget không? | Counter, histogram, gauge đã aggregate | Không bao giờ | Ops rộng hơn |
| **Events / audit logs** | Policy, retry, approval hay side effect nào đã xảy ra? | Event có schema cứng | Không; chỉ evidence của quyết định | SRE + Security |
| **Restricted evidence** | Fragment chính xác nào tạo ra incident? | Snapshot đã sanitize / reference mã hóa | Chỉ explicit sample, theo policy | Break-glass, hai người phê duyệt |

OpenTelemetry khuyến nghị data minimization và nhắc rõ rằng instrumentation library không thể tự biết dữ liệu nào nhạy cảm với business của bạn. Người triển khai phải review telemetry được phát ra, chỉ giữ dữ liệu có mục đích quan sát rõ ràng, và cân nhắc aggregate/anonymize thay cho attribute gốc.[2] Vì vậy, “cài auto-instrumentation rồi xem sau” không phải production architecture.

### Một nguyên tắc gọn: spans để giải thích *shape*, không phải để mang *payload*

Với RelayDesk, root span có thể mang:

```text
agent.name                  = relaydesk.support
agent.version               = 2026.08.13.3
agent.route                 = account_issue
agent.policy.version        = privacy-v7
session.correlation_id      = hmac:9f2b…
trace.content.mode          = metadata_only
agent.final.outcome_class   = refund_draft_created
```

Một child LLM span có thể mang model, temperature band, prompt template version, token usage, finish reason và cost. Một tool span mang tool name, capability class, schema version, argument **shape**, result **class**, duration, retry count và effect. Không field nào ở trên cần chứa tên khách hàng, nguyên câu prompt hay JSON tool result.

![Bản đồ trace cho thấy agent root span, LLM, retrieval và tool call được quan sát qua metadata an toàn](/blog/agent-observability-trace-map.webp)

Cách này vẫn cho bạn đúng hierarchy: `invoke_agent → plan → retrieve_policy → get_customer_profile → draft_refund`. Bài viết về GenAI telemetry của OpenTelemetry cũng minh họa đúng cấu trúc root agent span với child chat và execute-tool spans, cùng token count, model và finish reason. Khi content capture được bật, prompt/tool content có thể xuất hiện—đó phải là một quyết định policy, không phải side effect mặc định.[1]

---

## Trace model tối thiểu cho một tool-calling agent

Hãy phân biệt ba thứ thường bị trộn lẫn:

1. **Identity và phiên bản**: agent, prompt template, tool schema, model deployment, policy version. Đây là điều kiện để so sánh hai run.
2. **Hành vi**: route, tool sequence, retry, guardrail decision, side-effect class. Đây là điều kiện để biết agent đã làm gì.
3. **Payload**: prompt, retrieved documents, tool args/results, response. Đây là nội dung có rủi ro cao và không thuộc default path.

Dưới đây là schema thực dụng. Prefix có thể tùy stack; điều quan trọng là data contract và phân loại rõ ràng.

| Span / event | Attribute an toàn để giữ | Payload nên xử lý riêng |
|---|---|---|
| `agent.run` | `agent.name`, `agent.version`, `route`, `outcome_class`, `risk_tier` | Conversation history, memory text |
| `llm.generate` | `model`, `prompt.template.version`, `input_tokens`, `output_tokens`, `finish_reason`, `cost.usd`, `content_fingerprint` | System prompt, user message, completion |
| `retrieval.search` | `index.version`, `query.class`, `k`, `result_count`, `relevance_band`, `document_ids_hmac` | Query text, document chunks |
| `tool.call` | `tool.name`, `tool.schema.version`, `capability`, `argument.shape`, `result.class`, `effect`, `retry_count` | Arguments, result body, HTTP header |
| `policy.redaction` | `policy.version`, `data.class`, `action`, `match.category`, `field_count` | Giá trị bị match |
| `approval` | `approval.required`, `approval.state`, `approver.role`, `decision.latency_ms` | Lý do chứa thông tin khách hàng |

### Case study: một lỗi thật sẽ trông như thế nào?

Giả sử RelayDesk nhận câu: *“Tài khoản của tôi bị trừ phí hai lần. Kiểm tra và hoàn tiền nếu đúng.”* Agent gọi `get_customer_profile`, sau đó `lookup_billing_events`, rồi tạo refund draft. Tool billing gặp timeout và retry.

Trace production metadata-first có thể cho thấy:

```text
trace.id=7b4e…  agent.version=2026.08.13.3  tenant.tier=regulated
├─ policy.classify           8ms   class=restricted  action=redact
├─ llm.plan                 91ms  model=… input=1840 output=436 cost=$0.0048
├─ tool.get_customer_profile 68ms capability=customer.read result=found effect=read_only
├─ tool.lookup_billing       61ms capability=billing.read result=upstream_timeout retry=1
├─ tool.lookup_billing       54ms capability=billing.read result=found effect=read_only
└─ tool.create_refund_draft  39ms capability=refund.draft approval=required effect=staged
```

Bạn biết retry đã xảy ra, có một pending approval, và cost tăng vì một LLM turn cùng tool retry. Bạn **không** biết số thẻ, email, địa chỉ hay header upstream—và ở đa số incident vận hành, bạn không cần biết.

![Timeline trace minh họa nested span, event redaction, token, latency, cost và budget check](/blog/agent-observability-span-timeline.webp)

> **Điểm cần nhớ:** `trace.id` là correlation key. Nó không phải quyền truy cập vào raw content. Khi team coi một ID là “vé xem transcript”, họ đã phá ranh giới observability và evidence vault.

---

## Data classification trước capture: allow, summarize, hash, redact hay drop?

Redaction không phải regex cuối pipeline. Nó là một quyết định data contract thực hiện **trước khi** exporter gửi span ra khỏi process. Mỗi field có thể đi qua năm action khác nhau.

| Data class ví dụ | Default action | Ví dụ evidence còn lại | Lý do |
|---|---|---|---|
| Public / technical metadata | **Allow** | Tool name, model alias, status code class | Không định danh trực tiếp, cần cho vận hành |
| Internal low-risk text | **Summarize** | `intent=duplicate_charge`, `response_topic=refund_policy` | Giữ ý nghĩa vận hành, bỏ wording gốc |
| Join key cần correlation | **HMAC / tokenize** | `customer_ref=hmac:…`, `document_ref=tok:…` | Liên kết run mà không bộc lộ ID gốc |
| PII / credentials / confidential content | **Redact** | `match_category=authorization_header`, `redacted_fields=1` | Chứng minh policy chạy mà không giữ secret |
| Không phục vụ observability | **Drop** | Không có field | Bề mặt tấn công nhỏ nhất |

Một lưu ý quan trọng: hash không tự động biến dữ liệu thành anonymous. OpenTelemetry nêu rõ hash có thể bị đảo ngược trong thực tế nếu không gian input nhỏ hoặc dự đoán được, ví dụ numeric user ID.[2] Nếu cần correlation, dùng HMAC với secret được quản lý, scope theo tenant hoặc rotation window; và vẫn xem kết quả như dữ liệu nhạy cảm dưới access policy. Đừng đưa email SHA-256 thô lên dashboard rồi gọi đó là privacy.

### Metadata-first wrapper trong TypeScript

Mục tiêu của wrapper không phải “redact sau khi đã tạo full object”. Nó tạo ra telemetry-safe envelope ngay từ đầu. Ví dụ dưới đây là pattern minh họa; tên attribute cần map theo SDK và semantic convention bạn dùng.

```ts
import crypto from "node:crypto";

type DataClass = "public" | "internal" | "restricted" | "secret";
type SafeAction = "allow" | "summarize" | "tokenize" | "redact" | "drop";

type SafeField = {
  dataClass: DataClass;
  action: SafeAction;
  fingerprint?: string;
  summary?: string;
  redactedFields?: number;
};

const key = Buffer.from(process.env.TELEMETRY_HMAC_KEY!, "base64");

function fingerprint(value: string): string {
  // Correlation key only: rotate key/scope by tenant and do not treat this as anonymization.
  return crypto.createHmac("sha256", key).update(value).digest("base64url").slice(0, 20);
}

function inspectForTelemetry(input: string, kind: "prompt" | "tool_result"): SafeField {
  if (/authorization:\s*bearer/i.test(input) || /(?:api[_-]?key|password)=/i.test(input)) {
    return { dataClass: "secret", action: "redact", redactedFields: 1 };
  }
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(input) || /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(input)) {
    return { dataClass: "restricted", action: "redact", redactedFields: 1 };
  }
  return {
    dataClass: "internal",
    action: "summarize",
    fingerprint: fingerprint(input),
    summary: kind === "prompt" ? "intent:account_support" : "result:customer_profile_found",
  };
}

function traceToolCall(span: { setAttribute(k: string, v: string | number | boolean): void }, req: {
  toolName: string;
  schemaVersion: string;
  capability: "read" | "draft" | "write";
  argumentsJson: string;
  resultJson: string;
  durationMs: number;
}) {
  const args = inspectForTelemetry(req.argumentsJson, "prompt");
  const result = inspectForTelemetry(req.resultJson, "tool_result");

  span.setAttribute("agent.tool.name", req.toolName);
  span.setAttribute("agent.tool.schema.version", req.schemaVersion);
  span.setAttribute("agent.tool.capability", req.capability);
  span.setAttribute("agent.tool.duration_ms", req.durationMs);
  span.setAttribute("agent.tool.arguments.action", args.action);
  span.setAttribute("agent.tool.result.action", result.action);
  span.setAttribute("agent.tool.result.class", result.summary ?? "content_redacted");
  span.setAttribute("agent.policy.redacted_fields", (args.redactedFields ?? 0) + (result.redactedFields ?? 0));

  // Deliberately absent: argumentsJson, resultJson, Authorization header, raw prompt.
}
```

Pattern này không thay thế DLP hay semantic PII detection. Nó đặt một **default safe shape**: kể cả khi exporter down, retry, sample hay vendor backend thay đổi, code path bình thường cũng chưa từng attach raw payload vào span. Grafana mô tả cùng tinh thần qua SDK-side secret sanitizer: sanitize message, system prompt, tool call và result **trước khi** generation data được export; server-side guard là lớp bổ sung cho policy tập trung.[3]

---

## Redaction pipeline: phải có nhiều lớp vì mỗi lớp đều có blind spot

![Conveyor belt đưa prompt và tool payload qua classify, redact, allowlist, collector và vault trước khi vào telemetry](/blog/agent-observability-data-boundaries.webp)

Một thiết kế production thường cần ít nhất năm checkpoint.

| Boundary | Việc phải làm | Nếu chỉ làm ở đây thì còn thiếu gì? |
|---|---|---|
| **1. Application SDK** | Classify + sanitize trước `span.setAttribute` hoặc exporter | Có thể bỏ sót framework auto-instrumentation / lib mới |
| **2. Instrumentation review** | Review field names, callback hooks, auto-capture flags trong CI | Không chặn dynamic payload từ dependency runtime |
| **3. Collector allowlist** | Chỉ cho keys đã duyệt đi qua; delete/transform phần còn lại | Đã muộn nếu raw content đã vào local buffer/memory dump |
| **4. Backend routing & RBAC** | Tách standard trace store khỏi restricted evidence, encrypt, access log | Không phát hiện semantic PII mà classifier bỏ sót |
| **5. Detection & test** | Canary secret, DLP scan, adversarial fixtures, alert khi policy bypass | Không thay thế preventive control |

Đừng dựa vào “redact ở backend sau khi ingest”. Nếu raw prompt đã qua network, queue, retry buffer hoặc SaaS backend, bạn đã mở nhiều bề mặt lưu trữ. OpenTelemetry cung cấp collector processors để modify, filter, redact hoặc transform data—nhưng đồng thời nhấn mạnh cách tốt nhất để không thu thập dữ liệu nhạy cảm là không collect nó ngay từ đầu.[2]

Một pseudo-config có chủ đích **allowlist-first** có thể được review như sau. Hãy kiểm tra syntax chính xác theo phiên bản Collector của bạn trước khi deploy.

```yaml
# policy intent, not drop-in configuration
telemetry_policy:
  trace_attributes_allowlist:
    - service.name
    - service.version
    - agent.name
    - agent.version
    - agent.route
    - agent.tool.name
    - agent.tool.capability
    - agent.tool.duration_ms
    - gen_ai.usage.input_tokens
    - gen_ai.usage.output_tokens
    - agent.cost.usd
    - agent.policy.version
    - agent.policy.redacted_fields
  delete_attribute_patterns:
    - ".*prompt.*"
    - ".*message.*"
    - ".*authorization.*"
    - ".*cookie.*"
    - ".*tool.*arguments.*"
    - ".*tool.*result.*"
  export:
    standard_trace_store: metadata_only
    restricted_evidence_store: explicit_break_glass_only
```

### “Tôi sẽ truncate 1.000 ký tự” cũng không an toàn

Truncate giảm volume, không giảm bản chất nhạy cảm. Token có thể nằm ở 20 ký tự đầu; tên, email hay case number cũng vậy. Tương tự, redaction dựa vào regex chỉ mạnh ở pattern đã biết. Tài liệu Grafana phân biệt secret pattern sanitizer với evaluator/guard semantically phát hiện PII—mỗi loại có coverage và trade-off khác nhau; response side, streaming và reasoning block có thể cần control khác.[3]

Đó là lý do cần test pipeline bằng dữ liệu **synthetic nhưng độc hại**: fake bearer token, email giả, số định danh giả, nested JSON, base64-like string, payload tool chứa header, response streaming. Test không phải để chứng minh redactor “đẹp”; test để chứng minh không có raw value nào xuất hiện trong export mock, dead-letter queue và restricted-store audit ngoài expected lane.

```ts
it("never exports a synthetic bearer token in standard telemetry", async () => {
  const fakeSecret = "Bearer test_only_9Qf7r2Kp";
  const span = new MemorySpan();

  traceToolCall(span, {
    toolName: "get_customer_profile",
    schemaVersion: "v4",
    capability: "read",
    argumentsJson: JSON.stringify({ accountRef: "demo-42" }),
    resultJson: JSON.stringify({ upstreamError: `Authorization: ${fakeSecret}` }),
    durationMs: 68,
  });

  const serialized = JSON.stringify(span.attributes);
  expect(serialized).not.toContain(fakeSecret);
  expect(span.attributes["agent.tool.result.action"]).toBe("redact");
  expect(span.attributes["agent.policy.redacted_fields"]).toBe(1);
});
```

---

## Prompt trace: lưu version, shape và fingerprint; không mặc định lưu transcript

Prompt là nơi teams dễ rơi vào hai cực. Một cực là không lưu gì và không thể reproduce regression. Cực kia là store nguyên system prompt, user input, retrieved chunks, tool schemas và full completion cho mọi request.

Thay vì vậy, hãy tách **prompt provenance** khỏi **prompt content**.

| Cần biết để debug / compare | Cách lưu an toàn hơn |
|---|---|
| Prompt template nào? | `prompt.template.id`, `prompt.template.version`, git SHA hoặc registry revision |
| Có retrieval/context không? | `context.sources_count`, `context.token_budget`, `context.policy_class` |
| Input có đổi không? | Intent class + HMAC fingerprint có scope, không phải raw text |
| Prompt quá dài không? | Token count, truncation flag, context-window utilization band |
| Prompt bị policy xử lý không? | `policy.action`, `policy.version`, match category/count |
| Có cần exact content để điều tra? | Tạo evidence request riêng, có justification + TTL + audit |

Nếu final output bị groundedness regression, hãy bắt đầu với prompt template version, retriever index version, document IDs tokenized, source count, token budget và eval score. Chỉ khi các bằng chứng này không đủ, mới mở restricted evidence theo break-glass workflow. Đây là slow path có chủ đích: nó tạo ma sát trước một hành động privacy-sensitive.

---

## Tool calls: quan sát *effect* và *capability*, không chỉ HTTP status

Tool calling là nơi agent observability cần đi xa hơn API logging. `HTTP 200` không có nghĩa là an toàn: agent có thể gọi write tool sai tenant; tool trả về PII quá mức; agent có thể loop read tool và tạo denial-of-wallet; hoặc tool success nhưng action phải chờ approval.

OWASP liệt kê tool abuse, excessive autonomy, data exfiltration, prompt injection, denial-of-wallet và sensitive data exposure trong context/logs như rủi ro đặc trưng của agent. Khuyến nghị nền tảng là least privilege, per-tool permission scope, control cho high-impact action, monitoring và data classification.[4]

Một tool span tốt nên mang đủ “hành vi”:

```text
agent.tool.name                 = create_refund_draft
agent.tool.capability            = draft
agent.tool.auth_scope_class      = tenant_limited
agent.tool.argument_shape        = {account_ref: tokenized, amount: bucketed}
agent.tool.result_class          = draft_created
agent.tool.effect                = staged_no_external_side_effect
agent.tool.approval_required     = true
agent.tool.approval_state        = pending
agent.tool.retry_count           = 0
agent.tool.policy_action         = allow
```

`argument_shape` không phải JSON raw. Nó là schema classification, ví dụ keys có mặt, type, size bucket và cách xử lý. `amount` có thể bucket theo range nếu business cần cost/risk insight, thay vì exact amount. `account_ref` có thể tokenized. Nếu tool là email sender, lưu domain category, recipient count và approval state; đừng lưu email body hoặc recipient address trong default span.

---

## Token, latency và cost: đo tại span, aggregate sau policy

Cost của một agent không nằm ở một model call. Nó nằm ở orchestration: plan, retry, retrieval expansion, tool loop, fallback model và context growth. Vì vậy, mọi LLM span cần có token input/output, model deployment, response finish reason, latency và **price-card version**; còn root agent span chỉ giữ aggregation đã kiểm soát cardinality.

Một công thức minh họa:

```text
span_cost_usd = (input_tokens / 1_000_000 × input_price_per_million)
              + (output_tokens / 1_000_000 × output_price_per_million)

trace_cost_usd = Σ span_cost_usd + tool_metered_cost_usd
```

Không hardcode price trong dashboard query. Hãy version hóa price card, capture `billing.price_card_version`, và coi cost là estimate nếu provider billing hoặc cache semantics không đồng nhất. Numeric cost trong chart bài này là **minh họa**, không phải claim về giá model.

![Robot agent chạy quanh token meter, latency stopwatch, cost gauge và một guardrail chặn loop](/blog/agent-observability-budget-loop.webp)

### Ba budget phải tách riêng

| Budget | Chặn failure mode | Ví dụ policy minh họa |
|---|---|---|
| **Per-turn** | Prompt bloat hoặc output runaway | Cảnh báo khi context utilization vượt band định nghĩa |
| **Per-trace** | Agent loop, retry storm, fallback chain đắt | Stop khi vượt `max_model_turns`, `max_tool_calls`, `max_cost_estimate` |
| **Per-tenant / period** | Denial-of-wallet, rollout bad, abuse | Quota và anomaly alert theo tenant tier + route |

`cost` không được gắn với user email, raw prompt hay full tool args để “giải thích billing”. Hãy dùng route, model class, prompt version, tool name, tenant tier và risk tier—các dimension đã được xem xét cardinality và access. LangChain cũng nhấn mạnh trace có ích để attribute token usage và latency theo step, còn scale production cần sampling/retention policy vì con người không thể review mọi trace.[6]

---

## Sampling và retention: retention dài không phải quan sát tốt hơn

Nếu lưu full payload cho 100% traffic, bạn vừa tăng chi phí vừa mở blast radius. Nếu drop 100% content, đội điều tra hiếm khi bị mù. Câu trả lời không phải một sampling rate cố định, mà là policy dựa theo risk và outcome.

| Lớp run | Standard trace | Restricted evidence | Retention minh họa |
|---|---|---|---|
| Happy path, low risk | Metadata + aggregate metrics | Không | 14 ngày trace, 90 ngày metric |
| Error / timeout / budget breach | 100% metadata, policy events | Không mặc định | 30 ngày event |
| High-risk action / approval denial | 100% metadata + audit | Chỉ theo explicit evidence request | 30 ngày audit, evidence 24h |
| Regression / security canary | 100% trong môi trường test | Synthetic fixture, không dùng customer content | Theo CI artifact policy |
| Customer-reported incident | Metadata pin | Break-glass, reason + two-person approval | TTL ngắn và deletion verified |

Đây là retention **minh họa**; luật thực tế phải bám data classification, jurisdiction, contract, threat model và incident policy của tổ chức. Điều không nên thương lượng là mỗi store có owner, access path, TTL và deletion semantics rõ ràng. “Backend observability lưu mãi” không phải retention policy.

---

## Break-glass debugging: nếu cần content, hãy biến nó thành sự kiện audit

Có incident mà metadata không đủ. Có thể tool provider encode lỗi không mong đợi, hoặc prompt injection chỉ thấy rõ trong document fragment. Lúc đó đừng thêm `CAPTURE_CONTENT=true` toàn cục rồi hứa sẽ tắt sau.

Thiết kế một flow nhỏ, có chủ đích:

1. Engineer mở evidence request với `trace.id`, lý do và scope field cần xem.
2. Policy engine kiểm tra incident severity, data class, tenant restriction và approver role.
3. Hai principal độc lập phê duyệt nếu content thuộc restricted/secret tier.
4. Chỉ snapshot đã sanitize được decrypt trong viewer chuyên biệt; download/export bị chặn hoặc audit riêng.
5. Access, fields viewed, thời điểm và operator được log; TTL hết thì delete có bằng chứng.
6. Kết quả điều tra được chuẩn hóa thành safe summary và, nếu phù hợp, regression/eval case synthetic.

![Tủ debug khóa bằng break-glass, approval hai người và time-boxed access cho evidence nhạy cảm](/blog/agent-observability-break-glass.webp)

Cách làm này nghe “nặng”, nhưng nó tạo một boundary có thể audit. Nó cũng ngăn incident response bình thường trở thành pretext xem customer conversation hàng loạt. Tài liệu về redaction của Grafana nêu rõ SDK sanitizer và server guard có coverage khác nhau; không layer nào tự động bảo đảm response, streaming hay model thinking block đều đã được xử lý.[3] Break-glass không thay thế prevention, nhưng là cách thừa nhận nhu cầu điều tra mà không bình thường hóa raw-content access.

---

## Dashboard, alert và runbook: đừng alert trên “token cao” mà không có hành động

Một dashboard tốt không phải gallery của mọi attribute. Nó trả lời cho owner một hành động cụ thể.

| Signal | Nhìn theo dimension nào? | Alert khi | Runbook bước đầu |
|---|---|---|---|
| `trace_error_rate` | agent version, route, tool name | Lệch baseline sau rollout | Compare version, inspect tool result class, pause canary nếu cần |
| `tool_retry_count` | tool name, provider, region | Retry surge / loop budget breach | Check upstream; verify circuit breaker và idempotency |
| `estimated_cost_per_trace` | route, model class, tenant tier | Exceeds budget band | Inspect turn count, context utilization, fallback use |
| `redaction_action_count` | policy version, tool name, route | Sudden drop về 0 hoặc spike bất thường | Verify SDK/collector pipeline; search deploy diff |
| `break_glass_requests` | data class, team, incident code | Volume bất thường | Security review access pattern |
| `approval_denied_rate` | capability class, route | Unexpected increase | Check policy/routing regression, not raw content first |

Nếu redaction count đột ngột về 0 sau release, đó thường nghiêm trọng hơn latency +100ms. Đừng dựng alert bằng raw payload; alert bằng **policy evidence**. Một hệ thống observability an toàn phải đo được chính nó: policy version nào xử lý trace, có field nào bị drop, exporter nào bypass, restricted-store access có tăng không.

---

## Các anti-pattern khiến log thành rò rỉ dữ liệu

| Anti-pattern | Vì sao fail | Thay bằng |
|---|---|---|
| `captureContent=true` ở production vì “debug gấp” | Incident mode trở thành trạng thái vĩnh viễn; không có data contract | Metadata-first + break-glass explicit |
| Redact sau khi vendor đã ingest | Data đã qua network, queue, retry, backup | Sanitize in-process trước export, rồi collector allowlist |
| Hash email/user ID và gọi đó là anonymous | Small input space có thể re-identify | HMAC scoped/rotated + access control; giảm nhu cầu join |
| Lưu raw tool result vì `200 OK` | Tool result dễ chứa PII, headers, database records | Result class, effect, schema shape, synthetic replay fixture |
| Metric có `user_id` hoặc prompt text label | Cardinality explosion + privacy leak | Route/version/risk tier buckets |
| Redact input nhưng quên output/streaming | Model/tool có thể echo secret hoặc PII | Separate response-side policy and stream-aware design |
| Treat agent trace như APM trace bình thường | Mất tool choice, policy, retries, cost và governance | Agent-specific spans/events + eval feedback loop |

---

## Kế hoạch 30 ngày: từ console.log đến observability có thể defend

### Tuần 1: viết telemetry contract

Inventory mọi field hiện có: SDK auto-capture, custom logs, tool middleware, proxy headers, queue payload và vendor exporter. Với mỗi field, ghi owner, purpose, data class, default action, retention, backend và ai có quyền xem. Nếu field không có purpose, drop nó. Đồng thời xác định 10 câu hỏi incident quan trọng nhất và map mỗi câu sang safe evidence.

### Tuần 2: instrument đường nóng

Thêm root agent span, LLM span, retrieval span và tool span. Bật model/version/tokens/duration/tool effect/policy decision; tắt raw content default. Gắn cost card version, retry count, approval state và safe result class. Dựng dashboard cho error, cost, duration, redaction and budget decisions.

### Tuần 3: thêm enforcement và tests

Tạo SDK sanitizer, Collector allowlist và canary fixtures. Viết tests chứng minh synthetic secrets không xuất hiện trong exported spans. Test tool error, nested JSON, header, stream chunk và auto-instrumentation. Security và privacy owner review đặc biệt các fields mới.

### Tuần 4: vận hành feedback loop

Định nghĩa sampling/retention, mở break-glass process, đưa policy bypass alert vào on-call, và biến safe summaries từ incident thành case cho regression eval. MLflow mô tả observability của agent như tổ hợp tracing, evaluation, monitoring, cost/latency, feedback và governance—đó là feedback loop cần có, không phải các tính năng rời rạc.[7]

---

## Checklist trước khi bật production content tracing

| Câu hỏi | Pass khi |
|---|---|
| Có data inventory cho auto-instrumentation không? | Bạn biết library nào có thể capture prompt/tool data và flag nào tắt nó |
| Default spans có raw prompt, tool args/result, header, memory text không? | Không; mọi raw content path là explicit và được test |
| Có thể giải thích slow/expensive/wrong run bằng metadata không? | Có root/span tree, version, tokens, duration, retry, effect, policy evidence |
| Cost có thể reproduce theo price-card version không? | Có, và estimate được label rõ |
| Redaction chạy trước export không? | Có SDK/in-process control; collector chỉ là defense-in-depth |
| Có test secret/PII canary không? | Có, test scan export mock và pipeline integration |
| Restricted evidence có RBAC, justification, TTL, audit không? | Có, và access không mặc định cho toàn bộ engineering |
| Incidents có quay về eval suite không? | Có safe summary/fixture và owner cho regression case |

### Kết luận

Agent observability trưởng thành không phải là “mọi thứ đều searchable”. Nó là khả năng trả lời nhanh, có bằng chứng: **agent đã làm gì, vì sao, tốn bao nhiêu, có vượt policy không và thay đổi nào gây ra hành vi đó**—mà không phải nạp prompt, customer data và tool payload vào một kho log rộng mở.

Hãy bắt đầu bằng dữ liệu ít hơn nhưng có cấu trúc hơn: version, trace shape, token/cost, tool effect, policy action và fingerprint có kiểm soát. Sau đó xây restricted evidence lane thật hẹp cho số ít tình huống cần raw context. Nếu không thể nói rõ một field tồn tại để trả lời incident question nào, hãy coi đó là data leak chưa xảy ra, không phải observability chưa hoàn thiện.

---

## Tài liệu tham khảo

[1] [OpenTelemetry — *Inside the LLM Call: GenAI Observability with OpenTelemetry*](https://opentelemetry.io/blog/2026/genai-observability/)

[2] [OpenTelemetry — *Handling sensitive data*](https://opentelemetry.io/docs/security/handling-sensitive-data/)

[3] [Grafana Cloud documentation — *PII and secrets redaction*](https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/privacy-and-security/pii-and-secrets-redaction/)

[4] [OWASP Cheat Sheet Series — *AI Agent Security Cheat Sheet*](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)

[5] [NIST — *Challenges to the Monitoring of Deployed AI Systems*](https://www.nist.gov/news-events/news/2026/03/new-report-challenges-monitoring-deployed-ai-systems)

[6] [LangChain — *AI Agent Observability: Tracing, Testing, and Improving Agents*](https://www.langchain.com/resources/agent-observability)

[7] [MLflow — *AI Observability for LLMs and Agents*](https://mlflow.org/ai-observability)
