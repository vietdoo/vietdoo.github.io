---
title: "AI Action có tính Idempotent: Retry Tool Call mà không nhân đôi Side Effect"
description: "AI agent sẽ retry khi mạng lỗi, provider timeout hoặc worker restart. Playbook production này trình bày cách làm cho tool call ghi dữ liệu trở nên an toàn với idempotency key, deduplication, outbox, reconciliation và compensating action."
pubDate: 2026-01-13
category: "engineering"
image: "/blog/idempotent-ai-actions/hero.webp"
lang: "vi"
translationKey: "idempotent-ai-actions"
draft: false
---

![AI action đi qua idempotency key và tạo ra đúng một side effect đã commit](/blog/idempotent-ai-actions/hero.webp)

Tôi từng thấy một assistant tạo hai support ticket cho cùng một yêu cầu của khách hàng. Model đã sinh ra một tool call hoàn toàn hợp lý. Worker gửi request tới ticketing API. Sau đó mạng im lặng.

Worker không biết request đã thất bại, hay ticketing service đã tạo record nhưng chỉ làm mất response. Timeout handler làm điều mà phần lớn timeout handler vẫn làm: retry. Request thứ hai trông giống hệt request đầu tiên. Khách hàng nhận được hai ticket number, hai notification, rồi hỏi một câu rất hợp lý: “Tôi nên dùng cái nào?”

Không có gì đặc biệt sai ở phần ngôn ngữ của model. Lỗi xảy ra tại ranh giới giữa **ý định mang tính xác suất** và **side effect mang tính tất định**.

> **Luận điểm chính:** Một tool call không an toàn để retry chỉ vì model sinh ra cùng một JSON hai lần. Nó an toàn khi application gán cho một logical action một identity ổn định, lưu identity đó cùng kết quả, và phân biệt được một ý định mới với một delivery attempt khác của ý định cũ.

Bài viết này là một playbook production cho các AI tool có khả năng ghi dữ liệu hoặc tạo side effect: tạo payment, gửi email, mở ticket, cập nhật CRM, provision resource hoặc đặt lịch họp. Cách thiết kế này cũng áp dụng cho worker thông thường, nhưng agent làm vấn đề lộ rõ hơn: LLM có thể sinh tool call tiếp theo, orchestrator có thể replay một step, còn người dùng có thể bấm “thử lại” mà không biết attempt đầu tiên đã đi tới đâu.

## Retry không đồng nghĩa với một ý định thứ hai

Trong distributed system, client có thể mất response sau khi server đã commit operation. Client khi đó đứng trước một lựa chọn khó chịu. Nếu không làm gì, người dùng có thể chờ vô hạn. Nếu gửi request lần nữa, hệ thống có thể tạo thêm một side effect. AWS mô tả chính xác sự giằng co này trong hướng dẫn về idempotent API: retry chỉ làm cho việc recovery đơn giản hơn khi service nhận diện được đây là lần lặp của cùng một request và không cộng thêm một effect mới.[1]

Từ quan trọng ở đây là **cùng**. Hai request có parameter giống hệt nhau vẫn có thể là hai ý định riêng biệt. Người dùng có thể thực sự muốn tạo hai calendar event giống nhau hoặc hai compute instance giống nhau. Ngược lại, cùng một logical intent có thể đến với transport metadata khác, một HTTP connection khác, hoặc một LLM tool-call identifier mới được sinh lại.

Idempotency key làm cho ý định được biểu đạt rõ ràng. Nó nói rằng: “Các attempt này thuộc về cùng một logical action.” Nó không phải hash của mọi request trong vũ trụ, cũng không phải permission token. Nó là một correlation identity bền vững với scope được định nghĩa cẩn thận.

| Khái niệm | Ý nghĩa | Điều nó không cam kết |
|---|---|---|
| **Idempotent action** | Lặp lại cùng một logical request không tạo thêm side effect dự kiến. | Không đảm bảo attempt đầu tiên đã thành công. |
| **At-most-once execution** | Server cố gắng thực thi một operation không quá một lần. | Có thể mất effect nếu process crash. |
| **At-least-once delivery** | Message hoặc retry có thể được giao nhiều hơn một lần. | Tự nó không ngăn được duplicate. |
| **Exactly-once outcome** | Business result nhìn từ bên ngoài xuất hiện một lần. | Thường là kết quả ở cấp hệ thống, được ghép từ durable state, deduplication và reconciliation; không phải một thuộc tính kỳ diệu của transport. |

HTTP semantics vốn đã phân biệt các method có tính idempotent vì request có thể được tự động lặp lại sau lỗi truyền thông.[2] Tuy nhiên, AI action thường đến dưới dạng command giống `POST`, vì vậy application cần thêm một contract rõ ràng thay vì hy vọng HTTP verb sẽ giải quyết mọi thứ.

## Vì sao AI agent làm bài toán retry cũ khó hơn

Một service client thông thường thường biết operation nào đang được retry. AI agent thêm nhiều lớp có thể độc lập quyết định thử lại:

1. Network client retry sau khi connection reset.
2. Tool gateway retry sau `502` hoặc rate limit.
3. Workflow engine replay một step sau khi worker restart.
4. Model sinh thêm tool call sau khi thấy thông báo timeout.
5. Người dùng bấm “thử lại” trong khi run đầu tiên vẫn chưa rõ kết quả.

Năm việc đó không phải năm business action độc lập. Có thể tất cả chỉ là những attempt để hoàn thành một intent như “refund order `ord_4821` đúng một lần”. Nếu mỗi lớp tự tạo một key mới, deduplication sẽ bất khả thi. Nếu mọi lớp đều dùng lại key mà không kiểm tra parameter, một key cũ có thể vô tình gắn một ý định mới vào kết quả cũ.

Có một bẫy semantic khác. Hai model call có thể dùng JSON hơi khác nhau nhưng vẫn có cùng ý nghĩa:

```json
{
  "customer_id": "cus_42",
  "amount": 149000,
  "currency": "VND",
  "reason": "duplicate charge"
}
```

và:

```json
{
  "currency": "VND",
  "reason": "duplicate charge",
  "amount": 149000,
  "customer_id": "cus_42"
}
```

Canonical request fingerprint có thể coi khác biệt về thứ tự key là vô nghĩa. Nhưng nó không được tự động coi amount, customer, destination hoặc authorization scope thay đổi là tương đương. Với write action, ambiguity phải fail closed.

## Bắt đầu bằng action envelope, không phải raw tool call

Một thiết kế hữu ích là bọc các argument do model sinh ra trong một action envelope do application sở hữu. Model có thể đề xuất business parameter, nhưng application phải gán logical identity, actor scope, policy context và retry budget.

```ts
type ActionEnvelope<T> = {
  actionId: string;              // ổn định qua mọi attempt
  actionType: string;            // ví dụ: "refund.create"
  actor: {
    userId: string;
    tenantId: string;
    sessionId: string;
  };
  arguments: T;
  requestFingerprint: string;    // canonical arguments + protected scope
  idempotencyKey: string;        // opaque, duy nhất cho intent này
  policyVersion: string;
  createdAt: string;
  expiresAt: string;
};
```

Key nên được tạo khi application chấp nhận một logical intent, không phải mỗi lần transport retry. Nếu model được generate lại trong cùng workflow, hệ thống thường nên dùng lại `actionId` sau khi xác định đó vẫn là cùng một ý định. Một instruction mới của người dùng như “thực ra hãy gửi tới địa chỉ khác” phải tạo action mới, dù nó xảy ra trong cùng conversation turn.

Record phía server cần giữ đủ thông tin để trả lời một retry trong tương lai mà không gọi external tool thêm lần nữa.

```ts
type IdempotencyRecord = {
  tenantId: string;
  actorId: string;
  key: string;
  actionType: string;
  requestFingerprint: string;
  status: "started" | "committed" | "failed" | "unknown" | "expired";
  response?: unknown;
  resourceId?: string;
  externalRequestId?: string;
  createdAt: string;
  expiresAt: string;
};
```

Record này là một **business safety boundary**. Nó cần được scope theo tenant và actor khi cần, được bảo vệ bằng unique constraint, và được giữ ít nhất lâu bằng khoảng thời gian một late retry có thể xuất hiện. Tài liệu API của Stripe mô tả một contract tương tự: kết quả đầu tiên được lưu cho một key, request sau với cùng key nhận lại cùng kết quả, còn parameter mismatch bị reject thay vì được coi là một operation mới.[3]

![Ba transport attempt hội tụ vào một idempotency record được bảo vệ, còn parameter mismatch bị từ chối](/blog/idempotent-ai-actions/dedup-record.webp)

### Quy tắc của một idempotency key tốt

Key nên opaque, có khả năng tránh collision cao, và không chứa dữ liệu nhạy cảm. UUID là một lựa chọn phổ biến. Không nên chỉ tạo key từ email người dùng, order number hoặc natural-language prompt. Những giá trị đó có thể hữu ích trong fingerprint, nhưng chưa đủ để biểu đạt hai request lặp lại có phải cùng một action hay không.

Service cần so sánh fingerprint mới với fingerprint đã lưu. Cùng key và cùng protected parameter có thể trả về response gốc. Cùng key nhưng parameter khác phải trả về conflict, chẳng hạn `409 Conflict`, đồng thời phát event chẩn đoán để operator phát hiện lỗi reuse key.

Contract có thể tóm tắt như sau:

| Request đến | Record đang lưu | Hành vi đúng |
|---|---|---|
| Key mới | Không có | Atomically reserve key và bắt đầu action. |
| Cùng key, cùng fingerprint, `committed` | Có kết quả cũ | Trả về kết quả đã lưu; không gọi tool lần nữa. |
| Cùng key, cùng fingerprint, `started` | Có thể vẫn đang chạy | Trả về trạng thái pending hoặc chờ trong một budget hữu hạn. |
| Cùng key, cùng fingerprint, `unknown` | Kết quả bên ngoài chưa rõ | Reconcile trước; không blind replay một tool non-idempotent. |
| Cùng key, fingerprint khác | Conflict | Reject và alert; không ghi đè intent gốc. |
| Key hết hạn | Record đã bị xóa theo retention policy | Yêu cầu một action rõ ràng mới hoặc lookup reconciliation trước khi tạo gì thêm. |

## Timeout là unknown outcome, không phải bằng chứng của failure

Đây là khác biệt quan trọng nhất trong state machine của agent workflow. Validation error thường có nghĩa external operation chưa bắt đầu. `401` hoặc policy denial có thể là terminal. Timeout sau khi request đã được accept lại là chuyện khác: client không biết chuyện gì đã xảy ra.

Coi mọi error là “retry” là cách tạo ra duplicate charge, duplicate email và duplicate record. Coi mọi error là “stop” lại khiến workflow bị kẹt. Con đường an toàn là phân loại outcome rồi biến reconciliation thành fork trước một retry nguy hiểm.

![Retry-safe state machine tách unknown outcome khỏi confirmed failure và reconcile trước khi retry](/blog/idempotent-ai-actions/retry-state-machine.webp)

```text
intent_created
      |
      v
key_reserved ---> validation_failed ----> terminal_failure
      |
      v
sent_to_tool ---> response_received ----> committed
      |
      +--------> timeout / disconnect --> unknown
                                             |
                                             v
                                      reconcile_external_state
                                      /                    \
                                found result          not found
                                     |                     |
                                  committed       retry only if safe
```

Không phải provider nào cũng có reconciliation lookup. Nếu provider hỗ trợ query bằng client request ID của bạn, hãy dùng capability đó. Nếu nó trả về một resource có metadata của bạn, hãy gắn resource vào action gốc. Nếu provider không thể nói operation đã xảy ra hay chưa, workflow cần một product-level policy: chờ, chuyển cho human, hoặc thực hiện compensating action. Lựa chọn đúng phụ thuộc vào side effect và khả năng đảo ngược của nó.

## Làm cho write đầu tiên có tính atomic

Server phải tránh race trong đó hai worker cùng thấy key mới rồi cả hai cùng gọi tool. Cách bảo vệ phổ biến là unique database constraint cộng với transaction để reserve key trước khi worker tiếp tục.

```sql
CREATE TABLE ai_action_idempotency (
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action_type TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  response_json JSONB,
  resource_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key)
);
```

Operation quan trọng không phải là “check rồi insert” trong application memory. Nó phải là atomic insert hoặc compare-and-set ở database boundary. Một flow rút gọn có thể như sau:

```ts
async function handleAction(action: ActionEnvelope<RefundArgs>) {
  const record = await idempotency.reserveOrRead(action);

  if (record.kind === "conflict") {
    throw new HttpError(409, "Idempotency key reused with different arguments");
  }
  if (record.status === "committed") {
    return record.response;
  }
  if (record.status === "unknown") {
    return await reconcileBeforeRetry(action, record);
  }
  if (record.status === "started") {
    return { status: "pending", actionId: action.actionId };
  }

  return await executeReservedAction(action);
}
```

Reservation cũng phải ngăn worker thứ hai chạy vượt qua record `started`. Hãy dùng lock, lease hoặc ownership token có expiry rõ ràng. Lease không phải giấy phép để duplicate work sau khi hết hạn; nó là quyền tiếp quản trách nhiệm reconciliation và recovery.

## Dùng outbox để tách database commit khỏi delivery

Nhiều AI action vừa cập nhật local state vừa gọi external tool. Ví dụ, scheduling agent có thể tạo một dòng `booking_intent` rồi gọi calendar API. Nếu database commit thành công nhưng process crash trước API call, action chưa hoàn tất. Nếu API call thành công nhưng process crash trước local commit, application có thể quên resource đã tạo.

Transactional outbox giảm một nửa sự không chắc chắn này. Application ghi business state và outbox event trong cùng database transaction. Sau đó relay giao event tới external system. Outbox tồn tại vì database và message broker thường không thể dùng một two-phase transaction thực tế; pattern này cũng thừa nhận relay có thể publish event nhiều lần, nên consumer vẫn cần idempotency.[4]

![Agent intent được commit cùng outbox event, relay tới external API, rồi reconcile thành commit hoặc compensation](/blog/idempotent-ai-actions/outbox-reconciliation.webp)

```ts
await db.transaction(async (tx) => {
  await tx.insert("refund_intent", {
    actionId: action.actionId,
    orderId: action.arguments.orderId,
    amount: action.arguments.amount,
    status: "pending",
  });

  await tx.insert("outbox", {
    eventId: action.actionId,
    topic: "refund.requested",
    payload: action,
    status: "ready",
  });
});
```

Outbox không tự động biến external API thành exactly once. Nó cung cấp một nơi bền vững để lưu lại hệ thống đã định gửi gì. Relay nên gửi cùng idempotency key khi gọi provider, đồng thời lưu provider request ID và response. Nếu provider không hỗ trợ idempotency, relay cần reconciliation strategy trước khi replay call.

## Reconciliation phải là một workflow hạng nhất

Reconciliation thường bị xem như một emergency script. Với AI action, nó nên là một state transition bình thường, có owner, deadline và kết quả hiển thị rõ.

Một reconciliation algorithm hữu ích gồm các bước:

1. Load idempotency record và kiểm tra actor, tenant, action type cùng fingerprint.
2. Query external system bằng provider request ID, client reference hoặc một business lookup có scope hẹp.
3. Nếu resource mong đợi tồn tại, gắn nó vào action gốc và đánh dấu action là `committed`.
4. Nếu resource không tồn tại và provider contract đảm bảo retry an toàn, retry bằng cùng key.
5. Nếu không thể xác định outcome, pause và escalate thay vì tạo side effect thứ hai.
6. Nếu đã có partial effect cần undo, tạo một compensating action riêng với key và audit trail riêng.

Compensating action không giống rollback. Database rollback có thể undo một local change chưa commit. Một khi email đã gửi hoặc payment đã được accept, hệ thống chỉ có thể gửi correction, refund, cancel booking hoặc nhờ human xử lý. Bản thân compensation cũng phải idempotent; nếu không, recovery workflow lại tạo ra incident thứ hai.

| Side effect | Recovery ưu tiên | Khi nào cần chuyển cho human |
|---|---|---|
| Tạo support ticket | Lookup bằng client reference; dùng lại ticket đã tìm thấy. | Provider search không đầy đủ hoặc có nhiều candidate. |
| Gửi email | Dùng provider message key hoặc application send ledger. | Delivery state không rõ và email trùng gây hại. |
| Charge hoặc refund tiền | Provider idempotency key cộng payment lookup. | Không reconcile được amount, currency hoặc account scope. |
| Cập nhật CRM record | Dùng external version hoặc upsert key; verify record cuối. | Concurrent edit khiến target version không rõ. |
| Provision resource | Lookup bằng client token hoặc deterministic tag. | Đã tồn tại hai resource hoặc ownership không rõ. |
| Cancel hoặc compensate | Tạo action mới, được đặt tên rõ, với key riêng. | Compensation không thể đảo ngược hoặc cần phán đoán business/pháp lý. |

## Bảo vệ boundary khỏi model

Không nên cho model tự chọn idempotency scope. Model có thể đề xuất `orderId`, `amount` hoặc `recipient`, nhưng application phải lấy tenant, authenticated actor, policy version và action identity từ trusted context.

Trước khi gọi write tool, tối thiểu hãy validate:

- User có quyền thực hiện action trong tenant và resource scope đích.
- Argument đã được canonicalize và validate theo schema hiện tại.
- Amount, currency, destination và resource identifier được nêu rõ.
- Risk class của action quyết định retry tự động có được phép hay không.
- Tool contract nói rõ cách query, deduplicate hoặc compensate side effect.
- Action key không bị tái sử dụng giữa các conversation hoặc user.

Đây cũng là nơi human approval nên xuất hiện. Approval cần bind vào một action envelope và fingerprint cụ thể, không phải một câu mơ hồ như “agent muốn sửa tài khoản”. Nếu model thay đổi amount hoặc destination sau approval, đó là action mới và cần gate mới.

## Test failure mode, không chỉ happy path

Một integration test gửi tool call rồi kiểm tra response `200` chứng minh rất ít. Các test có giá trị là trường hợp hệ thống không biết nó đã thành công hay chưa.

| Failure được inject | Invariant cần giữ |
|---|---|
| Connection đóng sau khi provider commit | Retry trả về resource gốc, không tạo resource thứ hai. |
| Hai worker nhận cùng một key đồng thời | Chỉ một external action được bắt đầu. |
| Cùng key nhưng amount thay đổi | Request bị reject như một conflict. |
| Worker chết sau local reservation | Worker khác reconcile hoặc resume an toàn sau khi lease hết hạn. |
| Outbox relay crash sau publish | Consumer deduplicate event lặp lại. |
| Provider trả kết quả muộn | Action vẫn ở `unknown` cho tới khi lookup resolve. |
| User bấm retry hai lần | Hai UI request map vào một logical action. |
| Model đổi thứ tự field JSON | Canonical fingerprint vẫn tương đương. |
| Model đổi protected argument | Cần fingerprint mới và approval mới. |

Property-based test đặc biệt hữu ích cho canonicalization. Hãy tạo các permutation của JSON key order, whitespace không có ý nghĩa và numeric representation đã normalize, rồi kiểm tra các request tương đương có cùng fingerprint. Sau đó tạo các giá trị đã thay đổi và kiểm tra chúng không bao giờ collision.

Chaos test nên bao gồm delay giữa thời điểm “provider đã commit” và “response được trả về”, không chỉ connection failure trước khi request tới provider. Đó là uncertainty window khiến retry ngây thơ nguy hiểm nhất.

## Quan sát một logical action qua nhiều attempt

Một hệ thống retry-safe cần cả telemetry cấp action lẫn cấp attempt. Nếu mọi attempt đều được đếm như một business action mới, dashboard sẽ phóng đại volume và che giấu duplicate. Nếu attempt bị ẩn, operator không thể giải thích vì sao khách hàng chờ ba phút cho một refund.

Hãy dùng `actionId` ổn định cho logical intent và `attemptId` duy nhất cho từng delivery attempt. Một trace hữu ích có thể trông như sau:

```text
actionId=act_9f2
  attemptId=att_1  -> timeout
  attemptId=att_2  -> provider lookup: found
  outcome          -> committed, resource=refund_771
```

Nên theo dõi ít nhất các measurement sau:

| Measurement | Ý nghĩa |
|---|---|
| `actions.started` | Volume của business intent. |
| `attempts.sent` | Áp lực lên transport và worker. |
| `actions.unknown` | Mức độ phơi nhiễm với outcome chưa resolve. |
| `reconciliations.resolved` | Recovery có hoạt động không. |
| `duplicate_requests_suppressed` | Số duplicate được idempotency layer chặn. |
| `conflicting_key_reuse` | Lỗi ở client hoặc orchestration. |
| `compensations.created` | Tần suất partial effect ngoài đời thực. |
| `time_to_resolution` | User impact của unknown outcome. |

Đừng log toàn bộ prompt, payment detail hoặc dữ liệu cá nhân chỉ để retry dễ debug hơn. Hãy log action type, identifier đã scope, fingerprint hoặc hash, state transition, provider request ID và policy decision. Trace cần giải thích được kết quả mà không trở thành một data-leak surface thứ hai.

## Trình tự rollout thực tế

Hãy bắt đầu với một write tool có giá trị cao, có lookup API rõ ràng và blast radius nhỏ. Định nghĩa action envelope và fingerprint trước khi thêm automatic retry. Persist idempotency record, thêm unique constraint, rồi trả về response gốc khi committed key được lặp lại. Chỉ sau đó mới thêm worker retry.

Tiếp theo, đưa state `unknown` vào hệ thống và xây reconciliation job rõ ràng. Đo xem state này xuất hiện bao nhiêu lần và mất bao lâu để resolve. Thêm outbox khi local database state và delivery cần tiến triển cùng nhau. Chỉ thêm compensation sau khi team mô tả được business invariant mà nó có nhiệm vụ sửa.

Cuối cùng, làm cho hành vi này rõ ràng trong sản phẩm. User nên thấy “đang xử lý; hệ thống đang kiểm tra action đã hoàn tất chưa” thay vì một thông báo chung chung “đã có lỗi xảy ra”. Copy này quan trọng vì nó ngăn user tạo một ý định thứ hai trong khi ý định đầu tiên vẫn chưa rõ kết quả.

## Quy tắc thiết kế cần mang theo

AI agent không cần ít retry hơn. Nó cần retry được gắn vào đúng identity và bị giới hạn bởi đúng contract.

Model quyết định nó muốn làm gì. Application quyết định request có được authorize không, logical action identity là gì, side effect có được phép lặp lại không, và uncertainty sẽ được reconcile thế nào. Khi các trách nhiệm này được tách ra, timeout không còn là lời mời gọi duplicate work. Nó trở thành một state đã biết với một next step an toàn.

Đó là khác biệt giữa một agent chỉ biết gọi tool và một agent system có thể được tin cậy khi tác động vào thế giới thật.

## Đọc tiếp trong series production AI

Bài viết này là lớp side effect trong một series lớn hơn về production agent. Nếu muốn đi sâu vào checkpoint và resume workflow, hãy đọc [Durable Execution cho AI Agent](/blog/durable-execution-ai-agent). Với lớp kiểm chứng và regression, xem tiếp [Đừng đưa AI Agent lên Production khi chưa có Evals](/blog/agent-evals-regression-suite). Còn nếu cần thiết kế telemetry cho prompt, tool call, token và cost, hãy đọc [Observability cho AI Agent mà không biến Log thành Data Leak](/blog/agent-observability-without-data-leaks).

## References

[1]: https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/ "AWS Builders' Library — Making retries safe with idempotent APIs"
[2]: https://www.rfc-editor.org/rfc/rfc9110.html "RFC 9110 — HTTP Semantics"
[3]: https://docs.stripe.com/api/idempotent_requests "Stripe API — Idempotent requests"
[4]: https://microservices.io/patterns/data/transactional-outbox.html "Microservices.io — Transactional outbox pattern"
