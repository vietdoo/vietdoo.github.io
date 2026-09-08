---
title: "Contract Testing cho AI Tool: Chứng minh Agent gọi cùng một capability an toàn qua nhiều Provider"
description: "Hướng dẫn production về cách kiểm thử compatibility của AI tool qua model, provider, MCP server và nhiều phiên bản implementation bằng schema contract, semantic invariant, negative path và release gate."
pubDate: 2026-07-06
category: "engineering"
image: "/blog/ai-tool-contract-testing/hero.webp"
lang: "vi"
translationKey: "ai-tool-contract-testing"
draft: false
---

![Whiteboard vẽ tay mô tả AI agent gọi cùng một tool qua hai provider với các contract gate trước side effect](/blog/ai-tool-contract-testing/hero.webp)

Tôi từng chứng kiến một agent vượt qua toàn bộ happy-path test nhưng vẫn thất bại ngay lần đầu đổi provider. Tool schema hợp lệ. JSON parse được. HTTP trả về 200. Thế nhưng assistant gửi ngày tháng ở sai timezone, coi một business rejection là lỗi transport, rồi retry một operation mà hệ thống phía sau đã tiếp nhận.

Không có dashboard nào trông quá nghiêm trọng. Không có model outage rõ ràng, cũng không có exception nổi bật. Lỗi nằm trong khoảng cách giữa **“payload này là JSON hợp lệ”** và **“provider này có thể thực hiện capability mà agent đang phụ thuộc một cách an toàn.”**

Khoảng cách đó cần một kỷ luật kỹ thuật riêng: **contract testing cho AI tool**.

Contract testing truyền thống hỏi consumer và provider có thống nhất về các message trao đổi hay không. Pact mô tả đây là cách kiểm thử một integration point trong isolation dựa trên một shared understanding, thay vì chỉ dựa vào các end-to-end integration test đắt đỏ và dễ vỡ. Với AI system, consumer không chỉ là frontend hay service client. Nó có thể là agent runtime yêu cầu model chọn tool, gateway chuyển đổi format giữa các provider, MCP client discovery tool, hoặc workflow engine diễn giải structured result.

Provider cũng không chỉ là một HTTP server. Nó có thể là model family, hosted endpoint, MCP server, tool implementation hoặc versioned adapter. Vì vậy contract phải bao phủ nhiều hơn tên field. Nó phải trả lời được **tool có ý nghĩa gì, được gọi khi nào, thất bại ra sao, tạo side effect nào, và model ở bước sau được phép tin điều gì về kết quả**.

> **Luận điểm chính:** Schema chứng minh payload có thể được định hình đúng. Production contract chứng minh agent có thể dùng capability một cách an toàn, có thể dự đoán và đủ khả năng phục hồi cho task cụ thể.

Bài này không nhằm biến mọi provider thành giống hệt nhau. Mục tiêu đó vừa không thực tế vừa không phải lúc nào cũng tốt. Mục tiêu là chứng minh từng route đáp ứng **capability envelope tối thiểu** của task, đồng thời khiến incompatibility thất bại trước khi chạm tới user hoặc external side effect.

## Vì sao schema validation cần thiết nhưng chưa đủ

JSON Schema là điểm bắt đầu rất tốt. Nó mô tả type, required field, constraint, array, reference và các rule máy có thể kiểm tra. MCP tool definition dùng `inputSchema` cho parameter đầu vào và có thể cung cấp `outputSchema` cho structured result. MCP specification nói rằng nếu server cung cấp output schema thì structured result phải tuân theo schema đó, còn client nên validate kết quả.

Đó là **shape contract**. Nó bắt được lỗi thiếu `customer_id`, số bị serialize thành object, hoặc output thiếu `status` bắt buộc. Nhưng nhiều lỗi production vẫn hoàn toàn hợp lệ theo schema.

Hãy xét tool `schedule_delivery`:

```json
{
  "type": "object",
  "properties": {
    "customer_id": { "type": "string", "minLength": 1 },
    "delivery_date": { "type": "string", "format": "date" },
    "timezone": { "type": "string" },
    "notify_customer": { "type": "boolean" }
  },
  "required": ["customer_id", "delivery_date", "timezone", "notify_customer"],
  "additionalProperties": false
}
```

Payload có thể validate nhưng vẫn vi phạm product contract:

| Lỗi dù payload hợp lệ | Vì sao schema không bắt được | Cần thêm contract nào |
|---|---|---|
| Ngày được hiểu theo UTC thay vì timezone của khách | Cả hai đều là string hợp lệ | Semantic invariant |
| Tool tạo delivery thứ hai khi bị gọi hai lần | Schema không nói gì về side effect | Idempotency và reconciliation |
| `notify_customer: true` gửi tin trước khi được duyệt | Boolean không biểu diễn policy | Authorization và action gate |
| Provider trả HTTP success nhưng business rejection | Envelope có thể vẫn đúng cấu trúc | Error taxonomy |
| Tool âm thầm nhận enum đã deprecated | Giá trị vẫn khớp kiểu string rộng | Version và compatibility policy |
| Tool trả inventory đã cũ nhưng JSON hoàn toàn đúng | Dữ liệu không còn fresh | Freshness và outcome semantics |

Đó là lý do AI tool contract nên được chia thành nhiều lớp, thay vì nhồi mọi thứ vào một schema khổng lồ. Schema bảo vệ structure. Behavioral contract bảo vệ meaning. Policy contract bảo vệ authority. Side-effect contract bảo vệ thế giới bên ngoài.

## Năm lớp của một tool contract

Một contract thực tế cho AI capability có ít nhất năm lớp. Mỗi lớp nên được kiểm thử độc lập và gắn với một release gate.

![Whiteboard vẽ tay phân tách schema, semantic, policy, side-effect và operational contract của một AI tool](/blog/ai-tool-contract-testing/contract-matrix.webp)

### 1. Shape contract

Shape contract định nghĩa input và output tối thiểu hợp lệ. Nó gồm required field, allowed type, range, enum, `additionalProperties`, reference và serialization rule. Contract phải được version hóa, được validate bởi cả tool implementation lẫn agent runtime.

Đừng để schema do model sinh ra trở thành source of truth duy nhất. Hãy giữ canonical schema trong code hoặc registry, sinh format riêng cho từng provider từ schema đó, rồi từ chối route nếu adapter không bảo toàn được constraint quan trọng.

Với output, nên dùng một status envelope rõ ràng thay vì message tự nhiên mơ hồ:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": ["completed", "rejected", "needs_confirmation", "not_found", "retryable_error"]
    },
    "operation_id": { "type": ["string", "null"] },
    "reason_code": { "type": ["string", "null"] },
    "data": { "type": ["object", "null"] },
    "observed_at": { "type": "string", "format": "date-time" }
  },
  "required": ["status", "operation_id", "reason_code", "data", "observed_at"],
  "additionalProperties": false
}
```

`status` không phải field để trang trí. Nó đưa cho bước tiếp theo một state machine có giới hạn, thay vì một đoạn văn phải tự diễn giải.

### 2. Semantic contract

Semantic contract mô tả ý nghĩa của field và các quan hệ bắt buộc giữa chúng. Đây là nơi nhiều lần thay provider thất bại.

Với `schedule_delivery`, các invariant có thể là:

- Ngày phải được diễn giải theo IANA timezone được gửi vào, không phải timezone của server provider.
- Kết quả `completed` luôn có `operation_id` bền vững.
- Kết quả `rejected` không bao giờ tuyên bố delivery đã được schedule.
- `needs_confirmation` không được agent planner coi là success.
- `observed_at` do tool implementation tạo ra, không phải model tự bịa.
- Amount, date hay identifier trả về phải được copy từ system of record, không được suy ra từ user text.

Các rule này thường được diễn tả bằng executable invariant:

```python
def assert_schedule_semantics(result, request):
    assert result.status in {
        "completed",
        "rejected",
        "needs_confirmation",
        "not_found",
        "retryable_error",
    }

    if result.status == "completed":
        assert result.operation_id is not None
        assert result.data["timezone"] == request.timezone

    if result.status in {"rejected", "not_found", "retryable_error"}:
        assert result.operation_id is None
```

Mục tiêu không phải là biến mọi business rule thành test. Mục tiêu là xác định một nhóm invariant nhỏ nhưng phải sống sót qua thay đổi model hoặc provider.

### 3. Policy contract

Một tool có thể đúng về structure và semantics nhưng vẫn không được phép gọi. Policy contract định nghĩa ai được invoke, data class nào được đi qua boundary, có cần human confirmation không, và hạn chế tenant hoặc region nào áp dụng.

MCP tools specification khuyến nghị validate input, thực thi access control, rate-limit invocation, sanitize tool output và duy trì human-in-the-loop với operation nhạy cảm. Đây là trách nhiệm runtime, nhưng cũng nên xuất hiện trong test.

Một policy test nên hỏi:

| Tình huống | Kết quả mong muốn |
|---|---|
| Read-only agent gọi write tool | Bị từ chối trước provider call |
| Tenant A gửi resource ID của Tenant B | Bị từ chối bằng policy code ổn định |
| Dữ liệu nhạy cảm bị route tới region không được phép | Route bị loại trước khi dựng prompt |
| Tool cần approval nhưng thiếu approval token | `needs_confirmation`, không có side effect |
| Tool description đổi từ read thành write | Compatibility gate fail |

Description và annotation là gợi ý, không phải authority. MCP specification cảnh báo tool annotation phải được coi là không đáng tin nếu không đến từ trusted server. Policy phải được enforce từ metadata được ký hoặc quản lý tập trung, không phải từ đoạn prose model đọc được.

### 4. Side-effect contract

Side-effect contract nói rõ điều gì có thể xảy ra bên ngoài process và runtime chứng minh outcome bằng cách nào. Đây là lớp ngăn timeout biến thành payment, ticket hoặc notification bị nhân đôi.

Với mỗi mutating tool, hãy mô tả:

1. Operation là read-only, idempotent, conditionally idempotent hay non-repeatable.
2. Field nào là idempotency key.
3. Runtime reconcile timeout không chắc outcome ra sao.
4. Có partial completion hay không.
5. Event hoặc operation record nào dùng để truy vấn outcome.
6. Có compensating action nào nếu operation không rollback được.

Contract test nên gọi implementation hai lần với cùng một logical request và kiểm tra outcome đúng với promise. Đồng thời mô phỏng response bị mất sau khi downstream đã accept operation. Tool chỉ pass test đầu tiên chưa an toàn để expose sau một automatic retry.

Đây là điểm AI tool testing gặp distributed-systems discipline. Model có thể quyết định gọi tool hai lần, nhưng tool contract—không phải sự tự tin của model—mới quyết định lần gọi thứ hai có an toàn không.

### 5. Operational contract

Operational contract định nghĩa failure và latency behavior mà agent runtime được phép dựa vào. Nó nên gồm timeout class, retryability, rate-limit signal, maximum response size, pagination, freshness guarantee và observability field.

Đừng chỉ trả `success: false`. Hãy dùng error taxonomy ổn định:

```json
{
  "status": "retryable_error",
  "reason_code": "UPSTREAM_TIMEOUT",
  "retryable": true,
  "safe_to_retry": false,
  "reconcile_before_retry": true,
  "operation_id": null
}
```

`retryable` và `safe_to_retry` cố ý khác nhau. Network error có thể retryable về mặt transport nhưng không an toàn để replay trước khi reconcile vì downstream có thể đã commit side effect.

## Consumer-driven test cho AI agent

Mô hình consumer-driven của Pact phù hợp với AI tool vì agent runtime biết chính xác những interaction nào nó thật sự phụ thuộc. Contract nên được sinh từ consumer example đại diện, không phải từ mọi response có thể tưởng tượng.

Consumer là agent runtime. Nó có thể kỳ vọng:

- Tool name và description có meaning ổn định.
- Input schema hỗ trợ field planner phát ra.
- Structured result envelope map được vào agent state machine.
- Error code ổn định cho retry, escalation, rejection và reconciliation.
- Operation identifier xuất hiện khi side effect có thể đã xảy ra.
- Maximum response size hoặc pagination behavior rõ ràng.

Provider là tool server hoặc adapter. Provider verification chạy consumer contract với implementation thật, test environment hoặc deterministic simulator. Đây là cách bắt một loại regression khó chịu: provider vẫn “hợp lệ” theo schema riêng nhưng phá đúng interaction mà agent đang sử dụng.

![Whiteboard vẽ tay mô tả pipeline từ consumer examples tới provider verification, semantic assertion và release gate trước production](/blog/ai-tool-contract-testing/contract-test-pipeline.webp)

Một consumer contract đơn giản có thể được biểu diễn như fixture:

```json
{
  "consumer": "support-agent-v2",
  "provider": "ticketing-tool",
  "contract_version": "2026-07-01",
  "interaction": {
    "request": {
      "name": "create_ticket",
      "arguments": {
        "tenant_id": "tenant_demo",
        "title": "Cannot reset password",
        "priority": "normal"
      }
    },
    "expected": {
      "status": "completed",
      "operation_id": "opaque-id",
      "data": {
        "ticket_id": "opaque-id",
        "priority": "normal"
      }
    }
  },
  "invariants": [
    "completed_requires_operation_id",
    "tenant_id_is_not_rewritten",
    "priority_is_preserved"
  ]
}
```

Fixture không nên assert chi tiết không ổn định như timestamp chính xác, provider request ID hay câu natural-language. Hãy match structure và meaning, không match formatting tình cờ.

## Capability matrix thực tế hơn universal adapter

Một lỗi kiến trúc phổ biến là cố làm mọi provider trông giống nhau ở gateway boundary. Adapter hữu ích, nhưng có thể che giấu khác biệt quan trọng. Provider này hỗ trợ strict tool schema; provider khác chấp nhận schema nhưng đôi lúc trả thêm property. Provider này stream partial tool arguments; provider khác trả một call hoàn chỉnh. Có provider phân biệt tool execution error và protocol error; provider khác bọc cả hai trong text.

Hãy ghi nhận khác biệt trong capability matrix:

| Capability | Provider A | Provider B | Provider C | Quyết định contract |
|---|---:|---:|---:|---|
| Strict input schema | Có | Có | Một phần | Loại C khỏi write tool |
| Structured tool output | Có | Cần adapter | Không | Chỉ dùng C cho read-only text tool |
| Parallel tool calls | Có | Không | Có | Planner phải hỗ trợ sequential fallback |
| Native cancellation | Có | Không | Một phần | Dùng gateway timeout và reconcile |
| Stable error code | Có | Một phần | Không | Normalize A/B; quarantine C |
| Region/data policy | EU | EU/US | US | Filter trước route selection |

Matrix không phải documentation để trưng. Nó phải cấp dữ liệu cho eligibility test. Nếu task cần strict structured output, route planner không được chọn provider mà adapter chỉ hy vọng sửa malformed output sau đó.

Dùng **minimum capability envelope** cho từng tool class:

```yaml
capability_class: ticket_write_v2
required:
  input_schema: strict
  output_schema: strict
  error_taxonomy: stable
  side_effect_reconciliation: true
  idempotency: required
  region: eu-approved
allowed_adapters:
  - provider_a_native
  - provider_b_gateway_v3
forbidden:
  - freeform_text_only
  - unknown_error_mapping
```

Như vậy provider selection trở thành compatibility check thay vì cuộc thi popularity.

## Negative path mới là contract thật

Happy-path test hấp dẫn vì dễ demo. Incident production nằm ở negative path: thiếu permission, input cũ, partial tool output, duplicate invocation, provider timeout, malformed argument, tenant bị revoke, enum bị đổi, hoặc upstream trả response technically success nhưng semantically sai.

Với mỗi tool, hãy tạo failure table:

| Failure | Tool response | Agent behavior | Có được side effect không? |
|---|---|---|---:|
| Invalid argument | `INVALID_ARGUMENT` | Hỏi user sửa lại | Không |
| Thiếu approval | `NEEDS_CONFIRMATION` | Hiển thị action gate | Không |
| Downstream timeout trước acknowledgement | `UNKNOWN_OUTCOME` | Reconcile, không retry mù | Chưa biết |
| Downstream timeout trước dispatch | `RETRYABLE_ERROR` | Retry trong budget | Chưa biết lần đầu |
| Business rule rejection | `REJECTED` | Giải thích hoặc đổi plan | Không |
| Tool schema mismatch | Compatibility failure | Loại route khỏi eligibility | Không |
| Provider trả field thừa | Validation failure hoặc strict strip | Ghi drift và quarantine | Không |
| Output vi phạm semantic invariant | Contract failure | Dừng và escalate | Không |

Provider trả lỗi nhanh hơn chưa chắc tốt hơn provider mất thêm thời gian. Câu hỏi quan trọng là agent có classify được error và chọn safe next state hay không.

## Property-based và metamorphic testing

AI tool contract hưởng lợi từ test sinh nhiều input và kiểm tra relationship thay vì chỉ dùng fixed answer. Property-based test có thể thay đổi optional field, date boundary, Unicode name, pagination size và tenant identifier trong khi vẫn giữ invariant tool không bao giờ vượt tenant boundary.

Metamorphic test đặc biệt hữu ích khi exact answer không deterministic. Thay vì assert một output string, hãy assert rằng transformation giữ nguyên hoặc thay đổi một property đã biết:

- Đổi thứ tự property độc lập trong JSON không được đổi tool result.
- Gọi lại read-only call không tạo side effect.
- Thêm context không liên quan không được đổi tenant được chọn.
- Chuyển date sang representation tương đương vẫn giữ cùng instant sau normalize.
- Đổi giữa các provider tương thích vẫn giữ operation state và error classification.
- Bỏ approval bắt buộc không bao giờ biến write thành completed result.

Những test này không thay golden example. Chúng là lớp lưới thứ hai bắt các bug mà fixture cố định không bao phủ.

## Shadow execution và release gate

Đừng đợi provider hoặc tool implementation chạy live mới biết contract sai. Khi migration, hãy gửi một phần request tới candidate route ở shadow mode nhưng ngăn nó tạo external side effect. So sánh shape, semantic field, error classification, latency, token use và redaction behavior.

Release gate có thể kết hợp hard failure với soft signal được theo dõi:

```python
def release_allowed(report):
    return all([
        report.schema_failures == 0,
        report.unauthorized_side_effects == 0,
        report.tenant_boundary_violations == 0,
        report.unknown_outcome_without_operation_id == 0,
        report.semantic_invariant_failures == 0,
        report.error_mapping_failures == 0,
        report.p95_latency_ms <= report.contract.max_p95_latency_ms,
    ])
```

Đừng biến mọi quality signal thành deployment blocker dạng binary. Latency tăng nhẹ có thể chỉ cần pause canary; cross-tenant leak hoặc unauthorized side effect phải dừng release ngay lập tức. Severity phải được định nghĩa rõ.

Artifact hữu ích nhất là compatibility report trả lời bốn câu hỏi:

1. Contract version nào đã được test?
2. Tổ hợp model/provider/adapter nào pass?
3. Case nào fail, và đó là structural, semantic, policy, side-effect hay operational failure?
4. Với từng failure, fallback hoặc escalation an toàn là gì?

## Nên log gì—và không nên log gì

Contract testing không cần lưu private chain-of-thought. Thông thường test artifact chỉ cần safe envelope mà runtime cần: contract version, tool name, redacted input shape, policy decision, provider/adapter version, output status, error code, operation ID, latency class và invariant result.

Tránh đưa secret thô, toàn bộ customer record hoặc model internal reasoning vào shared contract registry. Dùng synthetic fixture cho phần lớn test, encrypted reference cho case nhạy cảm và retention rule rõ ràng cho production replay. Mục tiêu là reproducibility mà không biến hệ thống test thành data lake thứ hai.

## Lộ trình triển khai thực tế

Hãy bắt đầu với một read-only tool có output schema rõ. Thêm strict input/output validation, sau đó viết ba semantic invariant và năm negative-path test. Tiếp theo thêm provider capability metadata và chạy cùng consumer contract trên hai adapter. Chỉ khi read path ổn định mới kiểm thử mutating tool với idempotency và reconciliation.

Một contract nhỏ nhưng được chạy đều có giá trị hơn catalog khổng lồ không ai mở. Contract nên xuất hiện trong CI, trong route eligibility layer và trong incident workflow. Khi provider đổi behavior, engineer phải thấy một incompatibility có tên rõ ràng, không phải một biểu đồ chung chung với nhãn “agent failures” tăng lên.

Đích đến trưởng thành không phải là universal AI adapter. Đó là một hệ thống có thể nói bằng evidence: **tool này tương thích với agent contract này, qua provider này, dưới policy này, cho side-effect class này**.

Câu đó hữu ích hơn rất nhiều so với “endpoint này hỗ trợ function calling”.

## Tài liệu tham khảo

[1] [Pact Docs — Introduction to Contract Testing](https://docs.pact.io/)

[2] [Model Context Protocol — Tools Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

[3] [JSON Schema — Creating Your First Schema](https://json-schema.org/learn/getting-started-step-by-step)

## Đọc tiếp

Nếu bạn đang thiết kế hệ thống xung quanh tool contract, có thể đọc tiếp [Model Router cho AI Agent](/blog/model-router-ai-agent/), [AI Action có tính Idempotent](/blog/idempotent-ai-actions/), [Prompt Injection trong Agent có Tool](/blog/prompt-injection-tool-boundaries/) và [Failover đa mô hình không phải Route Flapping](/blog/provider-rotation-multi-model-failover/).
