---
title: "Failover đa mô hình không phải Route Flapping: Xoay Provider, Phục hồi Stateful và Quality Gate"
description: "Hướng dẫn production về xoay tua AI model và provider mà không biến fallback thành retry storm, đứt tool contract, mất state hội thoại hoặc suy giảm chất lượng âm thầm."
pubDate: 2026-08-19
category: "engineering"
image: "/blog/provider-rotation/hero.webp"
lang: "vi"
translationKey: "provider-rotation-multi-model-failover"
draft: false
---

![Bảng whiteboard vẽ tay mô tả nhiều AI provider, các model pool, circuit breaker, retry budget và đường failover có giữ state](/blog/provider-rotation/hero.webp)

Tôi từng chứng kiến một hệ thống AI trông hoàn toàn khỏe mạnh nhưng làm mất cả cuộc hội thoại mà không hề trả về lỗi 5xx. Provider chính chậm lại, gateway chuyển request sang backup, và backup trả về HTTP 200. Dashboard báo availability tốt. Người dùng thì thấy trợ lý quên mất sáu lượt trao đổi trước đó.

Sự cố ấy thay đổi cách tôi nhìn về hệ thống multi-model. Đặt ba provider sau cùng một API chưa phải resilience. Đó mới chỉ là **optionality**. Resilience xuất hiện khi hệ thống có thể đổi route mà không vi phạm capability contract, chính sách dữ liệu, state hội thoại, ngân sách latency hay quality bar của tác vụ.

Đây là phần mà các sơ đồ “LLM fallback” đơn giản thường che khuất. Provider rotation thực tế có ít nhất hai quyết định độc lập:

1. **Model family nào phù hợp để xử lý tác vụ?**
2. **Provider endpoint nào có thể phục vụ model đó ngay lúc này?**

Không nên gom hai quyết định này vào một vòng round-robin. Model router bảo vệ capability và behavior của sản phẩm. Provider selector thích ứng với capacity, rate limit, sức khỏe khu vực, giá và policy. State layer bảo đảm provider tiếp theo biết những gì cần biết. Quality gate quyết định kết quả có được chấp nhận hay không.

Bài này là phần tiếp theo của [Model Router cho AI Agent](/blog/model-router-ai-agent/), nhưng tập trung vào vấn đề xuất hiện sau khi router đã chọn model: **làm thế nào xoay provider và model khi có áp lực mà không tạo thêm một failure mode mới**.

> **Luận điểm chính:** Fallback an toàn không phải là “thử API kế tiếp”. Đó là một state transition có giới hạn giữa các route tương thích về capability, được điều khiển bởi retry budget, provider health và continuity contract rõ ràng.

## Provider rotation không phải model fallback

Provider và model là hai chiều khác nhau. Cùng một model family có thể được cung cấp bởi vendor của model, cloud endpoint, deployment theo vùng hoặc gateway có capacity và chính sách riêng. Provider có thể unhealthy trong khi model family vẫn là lựa chọn đúng. Ngược lại, tất cả provider của model ưu tiên có thể vẫn khỏe nhưng bản thân model lại không phù hợp cho tác vụ cần long context hoặc structured output.

OpenRouter cũng tách hai lớp này: provider routing cố gắng phục vụ model được yêu cầu thông qua các provider sẵn có, còn model fallback chuyển sang model khác khi provider của model đầu tiên thất bại hoặc từ chối trả lời. Sự khác biệt này quan trọng vì đổi provider thường nên giữ nguyên model contract, trong khi đổi model có thể làm thay đổi tool behavior, context capacity, reasoning style, output format hoặc safety characteristic.

| Lớp quyết định | Câu hỏi | Mặc định an toàn |
|---|---|---|
| Capability route | Loại model nào có thể hoàn thành tác vụ? | Giữ một model family hoặc capability class đã được kiểm thử. |
| Provider route | Endpoint nào có thể phục vụ capability đó ngay bây giờ? | Ưu tiên provider khỏe, đúng policy và còn quota. |
| Session route | Conversation/workflow nên giữ state ở đâu? | Duy trì affinity lease trừ khi health hoặc policy buộc phải chuyển. |
| Recovery route | Làm gì sau kết quả không chắc chắn hoặc stream dở dang? | Reconcile state trước khi retry; timeout không đồng nghĩa side effect chưa xảy ra. |
| Quality route | Response có đạt yêu cầu nghiệp vụ không? | Kiểm tra structure, tool, evidence và outcome, không chỉ HTTP status. |

Sai lầm phổ biến là nhét cả năm quyết định vào một mảng `fallbacks: [...]`. Mảng đó có thể tiện, nhưng không phải reliability policy. Một route phải giải thích được candidate đủ điều kiện vì sao, lỗi nào kích hoạt transition, và invariant nào phải còn đúng sau transition.

![Minh họa vẽ tay so sánh provider rotation, giữ nguyên model capability, với model fallback, chỉ đổi capability khi thực sự cần](/blog/provider-rotation/provider-pools.webp)

Sự khác biệt này đáng được giữ trong architecture documentation vì nó ngăn một ambiguity rất đắt: ta chỉ đang chuyển traffic, hay đang thay đổi thứ mà trợ lý có thể làm?

## Provider switch phải giữ được capability envelope

Provider-neutral interface chỉ hữu ích khi nó chuẩn hóa những khác biệt có thể chuẩn hóa an toàn, đồng thời để lộ những khác biệt không thể che giấu. “Chat completion” chưa phải một contract đầy đủ. Tác vụ production có thể cần tool calling, JSON nghiêm ngặt, vision, context window tối thiểu, reasoning mode, region, retention policy hoặc refusal behavior đã biết.

Hãy tạo capability envelope cho từng route. Envelope có thể được lưu trong configuration và kiểm thử ở CI, nhưng cũng nên xuất hiện trong decision record lúc runtime:

```json
{
  "capability_class": "support_tool_agent_v2",
  "required": {
    "tool_calling": true,
    "structured_output": "strict-json",
    "context_tokens": 24000,
    "streaming": true,
    "region": "eu-approved"
  },
  "preferred_model_family": "reasoning-balanced",
  "allowed_provider_pools": ["primary-eu", "backup-eu"],
  "fallback_policy": "provider-only-before-model-change"
}
```

Envelope không hứa hai provider sẽ hoạt động y hệt nhau. Nó chỉ nói rằng cả hai đã vượt qua contract test tối thiểu của tác vụ. Đây là abstraction trung thực hơn nhiều so với việc giả định mọi endpoint tương thích OpenAI đều hoán đổi được về behavior.

Ví dụ, provider có thể nhận JSON schema nhưng vẫn trả argument khiến parser lỗi. Provider khác hỗ trợ tool nhưng serialize parallel call theo cách khác. Provider thứ ba có đủ context cho prompt nhưng không đủ cho reasoning ẩn hoặc output. Những khác biệt này phải nằm trong route metadata, không nằm trong hiểu biết truyền miệng của người viết retry handler.

## Xoay theo evidence, không xoay theo timer

Blind rotation rất dễ viết: request thứ nhất vào provider A, request thứ hai vào provider B, rồi tiếp tục vòng lặp. Nó có thể phân tán traffic nhưng bỏ qua việc provider có failure domain và rate-limit dimension khác nhau. Xoay theo đồng hồ thậm chí có thể tạo burst đồng bộ đúng lúc hệ thống đang chịu tải.

Selector nên kết hợp ít nhất năm tín hiệu: **admission**, **health**, **latency**, **policy** và **recent quality**. Các giá trị không cần hoàn hảo; chúng cần đủ mới để không định tuyến dựa trên provider đã khỏe từ mười phút trước.

| Tín hiệu | Cần quan sát | Ảnh hưởng đến rotation |
|---|---|---|
| Admission | Request/token budget còn lại, concurrency, queue depth | Không gửi traffic tới provider không thể nhận request. |
| Health | 5xx, timeout, connection error, 429, circuit state | Giảm hoặc mở provider pool khi lỗi kéo dài. |
| Latency | Time to first token, total latency, p95/p99 | Ưu tiên route có thể đáp ứng tail budget. |
| Policy | Region, retention, data class, tenant restriction | Loại provider không hợp lệ trước khi chấm điểm. |
| Quality | Schema validity, tool success, evidence check, business outcome | Tránh route có response “thành công” nhưng luôn cần sửa. |

Tài liệu OpenAI khuyến nghị tôn trọng `Retry-After` khi có, thêm jitter, giới hạn số attempt và tổng thời gian retry, đồng thời không retry quota hoặc billing error cần người vận hành xử lý. Anthropic cung cấp tín hiệu remaining/reset cho request, token, input token và output token, đồng thời cảnh báo traffic tăng đột ngột có thể chạm acceleration limit riêng. Lớp provider rotation nên chuẩn hóa các tín hiệu này thành admission interface chung, nhưng vẫn lưu raw header để chẩn đoán.

Một mental model hữu ích là **AIMD admission**. Sau khi thành công, tăng capacity từ từ; sau rate-limit hoặc overload, giảm admission theo cấp số nhân. Sierra mô tả một selector có nhận biết congestion để tránh việc traffic dao động giữa provider, cùng với priority-aware shedding khi capacity bị giới hạn. Hệ số cụ thể tùy sản phẩm, nhưng nguyên tắc có thể dùng rộng rãi: phục hồi phải từ từ, không phải một đợt flood đồng bộ.

Một hàm quyết định đơn giản có thể như sau:

```python
def eligible(route, request, now):
    return (
        route.policy_allows(request.data_class, request.region)
        and route.supports(request.capability_envelope)
        and route.circuit.is_closed_or_probe_allowed(now)
        and route.admission.can_accept(request.estimated_tokens)
    )


def score(route, request):
    return (
        0.30 * route.health_score
        + 0.25 * route.quality_score(request.task_kind)
        + 0.20 * route.latency_score(request.latency_budget_ms)
        + 0.15 * route.capacity_score(request.estimated_tokens)
        + 0.10 * route.affinity_score(request.session_id)
    )

candidates = [r for r in routes if eligible(r, request, now)]
selected = max(candidates, key=lambda r: score(r, request)) if candidates else None
```

Các trọng số trên không phải default phổ quát. Với voice assistant, tail latency có thể quan trọng nhất. Với invoice extraction, structured-output validity và evidence check có thể đáng giá hơn first token nhanh. Điều quan trọng là policy phải có tên, có version, đo được và có thể rollback.

## Circuit breaker cần half-open probe, không phải lưu đày vĩnh viễn

Circuit breaker bảo vệ provider pool khỏi bị dội request khi đang lỗi. Nó không nên biến thành lệnh cấm vĩnh viễn chỉ vì một timeout nhất thời. Một circuit thực dụng có ba trạng thái:

| Trạng thái | Cách hoạt động | Chuyển trạng thái |
|---|---|---|
| Closed | Nhận traffic theo score bình thường. | Mở sau ngưỡng lỗi đã phân loại. |
| Open | Từ chối traffic thường ở local, chọn pool khác. | Sang half-open sau cool-down. |
| Half-open | Cho phép một probe budget nhỏ, có kiểm soát. | Đóng sau probe khỏe; mở lại nếu probe lỗi. |

Failure classifier rất quan trọng. Connection reset, timeout, 429, 401, context overflow, content refusal, schema error và business validation failure không có cùng ý nghĩa. 401 thường cần xử lý credential hoặc configuration. Context overflow có thể khắc phục bằng compact hoặc model có context lớn hơn, không phải lặp nguyên request sang provider khác. Schema failure có thể chỉ ra capability drift chứ không phải provider health.

![Minh họa vẽ tay về AI gateway resilient với các trạng thái circuit breaker, retry budget có giới hạn, jittered backoff và cảnh báo retry storm](/blog/provider-rotation/circuit-breaker-retry-budget.webp)

Hình này cố ý mang tính vận hành hơn là trang trí: breaker, admission budget và backoff policy là ba control khác nhau. Gộp chúng thành một công tắc “retry” sẽ khiến incident khó khoanh vùng hơn.

Dùng breaker cho từng failure domain riêng. Embedding endpoint của provider lỗi không nên mở breaker cho chat endpoint. Quota của một tenant không nên loại provider khỏi mọi tenant. Structured-output regression của một model family không nên bị ngụy trang thành transport outage.

## Retry budget ngăn rotation biến thành retry storm

Fallback nguy hiểm nhất là loop retry mọi lỗi trên mọi provider. Nếu 100 request lỗi cùng lúc, mỗi request thử ba provider năm lần, hệ thống tạo ra 1.500 attempt trong khi outage bên dưới vẫn chưa hết. Fallback traffic trở thành chính incident.

Retry policy cần ba budget:

1. **Attempt budget:** số lần thử tối đa cho một logical request.
2. **Time budget:** wall-clock time tối đa trước khi trả kết quả, queue hoặc yêu cầu human recovery.
3. **Blast-radius budget:** lượng tải thêm tối đa mà failover được phép đẩy vào một provider pool.

Client phải tôn trọng `Retry-After` hợp lệ, sau đó thêm jitter có giới hạn. Nếu header thiếu, dùng exponential backoff có cap. Đừng để mỗi tầng application, gateway, queue và agent runtime tự cộng thêm retry mà không biết nhau; hãy ghép tất cả thành một budget cho cùng logical request.

```python
async def call_with_rotation(request, route_plan):
    deadline = monotonic() + request.time_budget_ms / 1000
    attempts = 0
    last_error = None

    for route in route_plan:
        if attempts >= request.max_attempts or monotonic() >= deadline:
            break

        if not route.admission.reserve(request.estimated_tokens):
            continue

        attempts += 1
        try:
            response = await route.call(request, timeout=deadline - monotonic())
            result = validate_response(response, request.contract)
            if result.ok:
                return result
            last_error = result.error
            if not result.retryable_quality_failure:
                break
        except ProviderError as error:
            last_error = error
            route.record(error)
            if not error.retryable:
                break

        await bounded_backoff(last_error, deadline)

    return recover_or_escalate(request, last_error)
```

Điều đáng chú ý là code không làm ba việc. Nó không retry side effect chỉ vì response timeout. Nó không xem mọi 429 là permission để dội request vào fallback. Nó không retry vô hạn schema mismatch. Logical request, route plan và stopping condition đều được mô tả rõ.

Với agent dùng tool, cần kết hợp cơ chế này với [Idempotent AI Actions](/blog/idempotent-ai-actions/). Provider switch chỉ an toàn khi request có thể replay mà không nhân đôi external action, hoặc runtime có thể reconcile outcome trước khi replay.

## Stateful failover: availability không phải continuity

Fallback có thể trả response nhưng vẫn làm mất task. Điều này dễ thấy ở chat và voice, nhưng cũng xảy ra trong agent nhiều bước. Nếu provider mới chỉ nhận message cuối cùng, nó không biết plan, tool result, constraint hay quyết định đã tạo ra turn hiện tại.

ContinuityBench mô tả đây là khác biệt đo được giữa availability và conversational continuity. Nghiên cứu đề xuất forward state đủ để tái dựng hội thoại trên các endpoint khác nhau, và báo cáo Continuity Preservation Rate 99,20% trong chính evaluation với 750 failover event. Kết quả này cho thấy continuity có thể đo được; nó không phải lời bảo đảm mọi implementation sẽ đạt cùng con số.

![Minh họa vẽ tay về stateful failover với immutable tool event, state hash, route lease và stream boundary bị ngắt](/blog/provider-rotation/stateful-failover.webp)

Đối tượng quan trọng trong hình không phải mũi tên giữa các provider. Đó là state hash và event trail bất biến, giúp mũi tên ấy trở nên an toàn.

Thiết kế stateful failover nên định nghĩa một **continuity envelope**:

| Thành phần state | Câu hỏi tối thiểu trước khi chuyển |
|---|---|
| Conversation history | Provider mới có nhận đúng các turn liên quan, không nhất thiết toàn transcript? |
| System policy | System/developer instruction có được giữ cùng version và integrity metadata? |
| Tool state | Tool result và pending action có được biểu diễn như immutable event? |
| Working memory | Summary, retrieved evidence và constraint nào còn hợp lệ? |
| Output boundary | Có token nào đã được stream tới người dùng chưa? |
| Route identity | Provider mới có được phép thấy state theo tenant và region policy? |

Forward toàn bộ transcript không luôn đúng. Nó làm tăng latency và có thể làm lộ dữ liệu không liên quan. Thiết kế an toàn hơn là lưu canonical event history, sau đó dựng provider-specific context projection cùng state hash ổn định. Projection có thể được compact, nhưng runtime phải giải thích được event nào được đưa vào và event nào bị bỏ qua có chủ đích.

Provider switch sau khi stream bắt đầu cần rule riêng. Nếu người dùng đã nhìn thấy nửa câu, việc lặng lẽ tiếp tục bằng model khác có thể tạo discontinuity về giọng điệu hoặc sự thật. Hãy dừng stream và retry nếu sản phẩm có thể đánh dấu boundary rõ, hoặc giữ route hiện tại cho đến khi turn kết thúc. Sierra cũng lưu ý rằng chuyển model sau khi user-visible streaming đã bắt đầu có thể không phù hợp nếu behavior hoặc consistency thay đổi.

## Model rotation cần quality gate, không chỉ health check

Health check trả lời câu hỏi “có nhận được response không?”. Nó không trả lời “model có hoàn tất đúng task không?”. Model có thể online trong khi tool-call argument drift, structured output kém ổn định hoặc refusal behavior thay đổi sau một update phía provider.

Mỗi fallback candidate cần quality gate riêng. Gate có thể kiểm tra JSON schema, field bắt buộc, citation, tool-call validity, policy label hoặc business invariant. Với agent, hãy kiểm tra cả việc chọn đúng tool và state transition tiếp theo có hợp lệ không.

| Loại route | Acceptance gate tối thiểu |
|---|---|
| Extraction | Schema validation, field confidence và source-span check. |
| Tool call | Tool name, argument schema, authorization và idempotency key. |
| Retrieval answer | Evidence coverage, freshness policy và unsupported-claim check. |
| Planning | Không có forbidden action, step count có giới hạn và dependency hợp lệ. |
| User-facing response | Safety policy, state coherence và stream boundary rõ ràng. |

Đây là lúc shadow traffic và canary hữu ích hơn status page của provider. Gửi một mẫu giới hạn, đã lọc privacy, tới route candidate nhưng không cho phép nó execute tool hay mutate state. So sánh task outcome, không chỉ token cost hoặc câu trả lời được thích hơn. Bộ [agent regression suite](/blog/agent-evals-regression-suite/) hiện có là nơi phù hợp để lưu route-pair test.

Thay đổi route phải có thể đảo ngược. Lưu policy version, candidate set, provider, model, error class, validation result và final business outcome trong record có bảo vệ dữ liệu. Bài [agent observability](/blog/agent-observability-without-data-leaks/) đã trình bày cách trace prompt, tool call, token và cost mà không biến trace thành nguồn rò rỉ thứ hai.

## Route lease ngăn session flapping

Nếu selector chọn độc lập ở từng turn, một conversation có thể nhảy liên tục giữa provider. Latency trở nên nhiễu, prompt cache mất hiệu lực, debug khó hơn và giọng trợ lý thay đổi. Nhưng sticky vĩnh viễn lại lãng phí capacity khỏe và làm recovery chậm.

Hãy dùng **route lease**. Lease gắn session hoặc workflow với model/provider pool tương thích trong một khoảng thời gian hoặc số step giới hạn. Lease được gia hạn sau outcome khỏe và bị thu hồi khi circuit mở, policy đổi hoặc route vi phạm quality SLO.

```text
session_id -> capability_class -> route_pool -> lease_expiry -> state_hash
```

Lease không nên chứa secret hoặc raw prompt. Nó là routing hint được policy bảo vệ. Khi lease bị revoke, route mới phải nhận continuity envelope và reason code như `provider_429`, `p95_latency_breach`, `policy_change` hoặc `quality_regression`.

## Đo gì sau khi rotation

Một dự án provider rotation không thành công chỉ vì error rate giảm. Nó thành công khi hệ thống sống sót qua failure mà không tạo ra một failure lớn hơn và khó nhìn thấy hơn.

Hãy theo dõi các chỉ số sau như một joint outcome, thay vì chia thành những dashboard rời rạc:

| Metric | Ý nghĩa |
|---|---|
| Provider failover rate | Preferred dependency thường xuyên unavailable hoặc bị giới hạn đến đâu. |
| Failover success rate | Phân biệt route transition với một HTTP response đơn thuần. |
| Continuity Preservation Rate | Conversation/workflow state có sống sót qua switch không. |
| Retry amplification | Số attempt thêm trên mỗi logical request trong incident. |
| Route flapping rate | Số lần route đổi trong một session/workflow. |
| Cost per successful outcome | Bao gồm retry, repair, escalation và tool loop. |
| Quality delta theo route pair | Phát hiện behavior thay đổi âm thầm giữa primary và fallback. |
| p95/p99 recovery latency | Tail latency người dùng thực sự cảm nhận trong sự cố. |
| Policy rejection rate | Candidate filtering quá muộn hay quá lỏng. |

Mẫu số quan trọng thường là **logical request**, không phải HTTP attempt. Hệ thống trả 99% HTTP 200 sau khi tăng gấp ba số attempt có thể kém reliable và đắt hơn hệ thống fail fast rồi yêu cầu làm rõ.

## Trình tự rollout thực tế

Bắt đầu bằng route matrix tĩnh, đọc được bởi con người. Liệt kê task class, capability envelope, provider pool được phép, model fallback policy, maximum attempt và terminal behavior. Đừng bắt đầu bằng learned router khi team chưa giải thích được một route decision.

Tiếp theo, thêm health và admission signal mà chưa đổi traffic. Quan sát rate-limit header, queue depth, p95 latency và error class. Sau đó chạy contract probe cho tool, structured output, context limit, streaming và privacy filter. Provider không “ready” chỉ vì endpoint `/health` trả 200.

Sau đó giới thiệu route lease và provider-only failover có giới hạn. Chỉ bật model fallback sau khi đã kiểm thử capability equivalence. Chạy shadow evaluation cho model route candidate, rồi canary các task class có quality gate rõ. Cuối cùng chaos-test provider outage, partial stream failure, 429 storm, credential stale, context overflow và state-reconstruction bug.

Thứ tự an toàn là:

| Giai đoạn | Điều thay đổi | Điều phải chứng minh |
|---|---|---|
| Contract | Capability envelope và provider adapter | Minimum behavior tương đương có thể kiểm thử. |
| Admission | Health, quota, latency và circuit state | Route xấu bị loại trước khi gửi traffic. |
| Recovery | Retry budget và provider-only failover | Một logical request không tạo storm vô hạn. |
| Continuity | State projection và route lease | Conversation giữ được task state sau switch. |
| Quality | Model fallback và shadow/canary gate | Model khác không làm outcome giảm âm thầm. |
| Optimization | Learned score, price/latency tuning | Policy vẫn giải thích và rollback được. |

## Checklist nâng cao

Trước khi xoay model hoặc provider trong production, tôi muốn có câu trả lời cho các câu hỏi sau:

| Câu hỏi | Bằng chứng cần có |
|---|---|
| Provider rotation và model fallback có tách biệt không? | Hai policy layer và route record riêng. |
| Candidate có đáp ứng capability envelope không? | Contract test cho tool, JSON, context, streaming và policy. |
| 429 có ý nghĩa gì trong hệ thống này? | Raw header, admission state chuẩn hóa và response có giới hạn. |
| Failover có giữ được state không? | Continuity envelope, state hash và reconstruction test. |
| Hệ thống có dừng retry được không? | Attempt, time và blast-radius budget. |
| Provider có phục hồi từ từ được không? | Half-open probe, AIMD-style admission và priority shedding. |
| Quality drift âm thầm có bị phát hiện không? | Route-pair eval, shadow traffic và business-outcome metric. |
| Sáu giờ sau có giải thích được route change không? | Decision record bảo vệ dữ liệu, policy version và reason code. |

Mục tiêu không phải làm hệ thống coi provider nào cũng như nhau. Provider khác nhau, và chính sự khác nhau ấy có ích. Provider này có thể mạnh về tool calling, provider kia có capacity tốt theo vùng, provider thứ ba hữu ích như emergency route. Mục tiêu là làm cho khác biệt đủ rõ để hệ thống dùng chúng mà không khiến người dùng bất ngờ.

Một kiến trúc multi-model tốt không hứa rằng provider failure sẽ vô hình. Nó hứa điều thực tế hơn: failure được giới hạn, state được giữ khi có thể, fallback hiểu capability, và hệ thống biết lúc nào phải dừng việc giả vờ rằng thêm một retry chính là recovery.

## Đọc tiếp trong series production AI

Để hiểu lớp chọn model, đọc [Model Router cho AI Agent](/blog/model-router-ai-agent/). Để xử lý side effect replay an toàn, đọc [Idempotent AI Actions](/blog/idempotent-ai-actions/). Với retry có state, xem [Durable Execution cho AI Agent](/blog/durable-execution-ai-agent/). Với evaluation và trace, đọc tiếp [Agent Evals](/blog/agent-evals-regression-suite/) và [Agent Observability](/blog/agent-observability-without-data-leaks/).

## Tài liệu tham khảo

[1]: https://openrouter.ai/docs/guides/routing/provider-selection "OpenRouter — Provider Routing"
[2]: https://developers.openai.com/api/docs/guides/rate-limits "OpenAI — Rate limits"
[3]: https://platform.claude.com/docs/en/api/rate-limits "Anthropic — Claude API rate limits"
[4]: https://sierra.ai/blog/model-failover "Sierra AI — Preserving agent behavior while serving LLMs reliably"
[5]: https://arxiv.org/html/2607.15899v1 "ContinuityBench: A Benchmark and Systems Study of Stateful Failover in Multi-Provider LLM Routing"
