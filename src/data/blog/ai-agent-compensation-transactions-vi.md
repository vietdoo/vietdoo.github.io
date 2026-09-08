---
title: "Compensation Transaction cho AI Agent: Khôi phục sau Partial Side Effect"
description: "Production playbook cho tình huống AI agent đã thay đổi thế giới một phần: compensation contract, action ledger bền vững, trạng thái không chắc chắn và reconciliation an toàn."
pubDate: 2026-06-07
category: "engineering"
image: "/blog/ai-agent-compensation-transactions/hero.webp"
lang: "vi"
translationKey: "ai-agent-compensation-transactions"
draft: false
---

![AI agent vẽ lại từng side effect và compensation trước khi chạy workflow nghiệp vụ nhiều bước](/blog/ai-agent-compensation-transactions/hero.webp)

Lúc 09:17, agent đã hoàn thành phần tốn kém nhất.

Nó kiểm tra order, reserve sản phẩm cuối cùng trong kho và tạo một payment adjustment cho khách hàng vừa đổi địa chỉ giao hàng. Bước tiếp theo là cập nhật instruction cho hãng vận chuyển. Call đó timeout.

Phản xạ đầu tiên của team vận hành là retry call tới carrier. Phản xạ thứ hai là restart workflow từ đầu. Cả hai đều nguy hiểm. Carrier có thể vẫn đang xử lý request cũ. Inventory reservation là có thật. Payment adjustment đã được queue. Restart có thể reserve cùng một sản phẩm hai lần, tạo adjustment thứ hai hoặc cập nhật một shipment đã chuyển sang state khác.

Agent không “fail” theo nghĩa đơn giản. Nó tạo ra một business process đã hoàn thành một phần, trong khi outcome của bước cuối chưa biết chắc. Hệ thống phải trả lời một câu hỏi khó hơn “Có nên thử lại không?” Nó phải biết: **Effect nào chắc chắn tồn tại, effect nào có thể đã tồn tại, effect nào có thể undo an toàn và ai được phép quyết định bước tiếp theo?**

Điểm này quan trọng vì AI agent không chỉ sinh text. Khi agent có thể gọi tool để reserve, charge, cancel, publish, modify hoặc notify, nó trở thành một participant trong distributed workflow. Model có thể đề xuất plan, nhưng application chịu trách nhiệm khôi phục sau những hệ quả của plan đó.

> **Luận điểm chính:** Plan của agent không phải transaction. Mỗi tool tạo side effect nên khai báo nó thay đổi gì, có thể kiểm tra outcome thế nào và compensation nào an toàn để thử. Runtime cần lưu bền vững các contract đó, phân biệt `failed` với `unknown`, chạy compensation có kiểm soát và chuyển cho con người khi không tồn tại inverse an toàn.

Bài này tập trung vào application-level pattern. Đây không phải phần giới thiệu chung về Saga, cũng không yêu cầu language model tự nghĩ ra một thao tác undo khéo léo giữa lúc incident. Temporal mô tả Saga là chuỗi local transaction với compensating action, gồm cả việc chạy theo thứ tự ngược và đăng ký compensation trước khi activity chạy. Công trình Robust Agent Compensation gần đây áp dụng recovery manager dạng log cho agent framework và formalize cặp action/compensation. Bài học hữu ích cho AI platform là đưa các ý tưởng đó vào tool boundary, nơi chúng có thể được review, test, authorize và observe.

## Timeout không phải rollback

Distributed system vốn đã có một state khó chịu nằm giữa success và failure. HTTP client có thể ngừng chờ trong khi server vẫn chạy. Network có thể làm mất response sau khi database đã commit. Payment provider có thể accept request nhưng caller lại nhìn thấy timeout.

AI agent làm state này xuất hiện thường xuyên hơn vì agent kết hợp reasoning dài với những hệ thống có clock, retry policy và consistency model khác nhau. Model nhìn thấy tool error và có thể hợp lý khi đề xuất retry. Runtime, ngược lại, phải hiểu rằng error của tool không nhất thiết chứng minh side effect chưa từng xảy ra.

Một vocabulary tối thiểu hữu ích cho outcome là:

| Outcome | Ý nghĩa | Default an toàn |
|---|---|---|
| `succeeded` | Có bằng chứng authoritative rằng effect mong muốn đã tồn tại. | Ghi output và tiếp tục. |
| `failed` | Có bằng chứng authoritative rằng effect mong muốn không tồn tại. | Chỉ retry theo action policy. |
| `unknown` | Caller không thể xác định effect có tồn tại hay không. | Dừng blind retry; reconcile trước. |
| `compensated` | Một inverse effect đã đăng ký và được xác nhận. | Tiếp tục recovery, đóng ledger entry. |
| `needs_human` | Tự động recovery không an toàn, chưa đầy đủ hoặc nằm ngoài policy. | Tạo reconciliation task có giới hạn. |

State `unknown` không phải implementation detail. Nó là business state. Payment request có outcome unknown không tương đương model call fail. Inventory reservation có outcome unknown không tương đương response rỗng. Hệ thống nên làm các state này hiển thị trong dashboard, audit record và UX cho user.

## Model đề xuất plan; runtime sở hữu ledger

Plan do model tạo ra hữu ích như một intention. Nó không phải durable execution record.

Trước side effect đầu tiên, runtime nên tạo action ledger cho workflow hiện tại. Mỗi entry đại diện cho một action được dự định, contract của nó và evidence mà external system trả về. Ledger có thể nằm trong database, workflow history hoặc durable event log. Property quan trọng là recovery không phụ thuộc vào việc dựng lại hidden reasoning của model từ transcript cuộc trò chuyện.

Một model TypeScript gọn có thể như sau:

```typescript
type ActionStatus =
  | "planned"
  | "running"
  | "succeeded"
  | "failed"
  | "unknown"
  | "compensating"
  | "compensated"
  | "needs_human";

type ActionLedgerEntry = {
  workflowId: string;
  sequence: number;
  actionId: string;
  toolName: string;
  requestHash: string;
  status: ActionStatus;
  effect?: Record<string, unknown>;
  providerReference?: string;
  compensation?: CompensationContract;
  lastError?: { code: string; message: string };
  policyVersion: string;
  createdAt: string;
  updatedAt: string;
};

type CompensationContract = {
  toolName: string;
  inputFrom: "forward_output" | "forward_input" | "reconciliation";
  requiredFields: string[];
  safeWhenForwardOutcome: Array<"succeeded" | "failed" | "unknown">;
  authorizationAction: string;
};
```

![Action ledger bền vững ghi plan, effect, provider reference, outcome, compensation và policy version trước recovery](/blog/ai-agent-compensation-transactions/action-ledger.webp)

Ledger được cố ý thiết kế rất buồn tẻ. Nó không lưu chain-of-thought. Nó lưu các operational fact tối thiểu cần để replay decision: action nào được yêu cầu, tool nào đã nhận, provider reference nào trả về, policy version nào áp dụng và recovery option nào đã được khai báo.

`requestHash` hữu ích để correlate retry, nhưng không nên khiến ta tưởng hash tự nó làm operation trở nên idempotent. Provider reference hữu ích cho reconciliation và compensation, nhưng phải được xem như input chưa đáng tin cho tới khi runtime validate shape và ownership. Compensation contract không phải permission; nó chỉ là mô tả về một inverse có thể có. Authorization vẫn phải approve inverse tại thời điểm thực thi.

## Khai báo effect trước khi execute action

![Compensation contract nối forward inventory reservation với controlled release, kèm outcome probe và authorization check](/blog/ai-agent-compensation-transactions/compensation-contract.webp)

Một tool schema chỉ mô tả parameters là chưa đủ cho agent có hậu quả. Runtime cũng cần biết tool thay đổi business state nào và kiểm tra thay đổi ấy bằng cách nào.

Xét hai tool sau:

```json
{
  "name": "reserve_inventory",
  "effect": {
    "kind": "inventory_reservation",
    "resource": "sku:ABC-123",
    "reversible": true
  },
  "outcome_probe": "get_reservation",
  "compensation": {
    "tool": "release_inventory",
    "input_from": "forward_output",
    "required_fields": ["reservation_id"],
    "safe_when": ["succeeded", "unknown"]
  }
}
```

Payment tool tương ứng có thể có property an toàn khác:

```json
{
  "name": "queue_payment_adjustment",
  "effect": {
    "kind": "payment_adjustment",
    "resource": "order:ORD-4821",
    "reversible": "conditional"
  },
  "outcome_probe": "get_payment_adjustment",
  "compensation": {
    "tool": "void_payment_adjustment",
    "input_from": "forward_output",
    "required_fields": ["adjustment_id"],
    "safe_when": ["succeeded"]
  }
}
```

Sự khác biệt này là có chủ ý. Inventory reservation có thể được release sau unknown result nếu provider hỗ trợ lookup an toàn và release operation được thiết kế để không gây hại khi reservation đã biến mất. Payment adjustment có thể cần provider reference đã xác nhận và một authorization level khác. Nếu không có inverse an toàn, contract nên nói rõ điều đó. “Model chắc sẽ nghĩ ra cách refund” không phải recovery strategy.

Tool contract nên trả lời năm câu hỏi trước khi rollout production:

| Câu hỏi của contract | Vì sao quan trọng | Ví dụ |
|---|---|---|
| Action tạo ra effect gì? | Recovery phải suy luận từ business state, không chỉ HTTP status. | `inventory_reservation` |
| Kiểm tra effect bằng cách nào? | Outcome unknown cần read hoặc provider inquiry. | `get_reservation` |
| Có inverse nào? | Compensation phải explicit và reviewable. | `release_inventory` |
| Outcome forward nào cho phép inverse? | Request fail vẫn có thể cần compensation. | `unknown`, `succeeded` |
| Cần authority nào? | Compensation có thể nhạy cảm hơn forward action. | `payment.adjustment.void` |

## Đăng ký compensation trước forward action

Thời điểm đăng ký là một chi tiết implementation nhỏ nhưng có hệ quả safety lớn.

Nếu runtime chỉ ghi compensation sau khi forward call trả success, nó sẽ bỏ sót trường hợp remote system commit nhưng response bị mất. Compensation cần được đăng ký trước khi action bắt đầu, với đủ thông tin để locate effect sau đó.

Action runner có thể làm thứ tự này thật rõ ràng:

```typescript
async function runAction(
  workflowId: string,
  action: PlannedAction,
): Promise<ActionLedgerEntry> {
  const entry = await ledger.plan({
    workflowId,
    actionId: action.id,
    toolName: action.tool.name,
    requestHash: hash(action.input),
    compensation: action.tool.compensation,
    policyVersion: action.policyVersion,
  });

  await ledger.markRunning(entry.actionId);

  try {
    const output = await invokeTool(action.tool.name, action.input);
    const verified = await verifyOutcome(action.tool, action.input, output);

    if (!verified.confirmed) {
      return ledger.markUnknown(entry.actionId, {
        lastError: { code: "OUTCOME_NOT_CONFIRMED", message: verified.reason },
      });
    }

    return ledger.markSucceeded(entry.actionId, {
      effect: verified.effect,
      providerReference: verified.providerReference,
    });
  } catch (error) {
    if (isDefinitiveFailure(error)) {
      return ledger.markFailed(entry.actionId, normalizeError(error));
    }

    return ledger.markUnknown(entry.actionId, {
      lastError: normalizeError(error),
    });
  }
}
```

Điểm quan trọng không nằm ở syntax. Nó nằm ở sequence: plan và register, mark running, invoke, verify rồi mới classify. Runner không được biến mọi exception thành `failed`, vì timeout thường nói nhiều hơn về observation của caller so với state của provider.

## Compensation không phải retry với một verb khác

Retry yêu cầu hệ thống ban đầu thực hiện lại cùng forward action. Compensation yêu cầu hệ thống tạo ra một state mới để offset business effect trước đó. Hai operation có thể có permission, cost, validation rule và failure mode hoàn toàn khác nhau.

Với reservation, compensation có thể là `release`. Với payment adjustment, nó có thể là `void`, `reverse` hoặc manual finance review tùy settlement đã bắt đầu hay chưa. Với email, có thể không tồn tại true inverse. Email đã gửi không thể unsend; compensation tốt nhất có thể chỉ là correction message, support task hoặc policy-defined stop để không gửi thêm.

Vì thế, gọi là “undo” dễ gây hiểu lầm. Compensation không đưa vũ trụ trở lại đúng state cũ. Nó tạo ra một state mới, có kiểm soát, đủ an toàn để business tiếp tục.

Runtime vì vậy nên coi compensation là first-class action:

```typescript
type RecoveryDecision =
  | { kind: "compensate"; actionId: string; reason: string }
  | { kind: "reconcile"; actionId: string; probe: string; reason: string }
  | { kind: "escalate"; actionId: string; queue: string; reason: string };

function chooseRecovery(entry: ActionLedgerEntry): RecoveryDecision {
  if (!entry.compensation) {
    return {
      kind: "escalate",
      actionId: entry.actionId,
      queue: "workflow-reconciliation",
      reason: "no_registered_compensation",
    };
  }

  if (entry.status === "unknown") {
    return {
      kind: "reconcile",
      actionId: entry.actionId,
      probe: entry.compensation.inputFrom === "forward_output"
        ? "provider_reference_lookup"
        : "business_state_lookup",
      reason: "forward_outcome_unknown",
    };
  }

  return {
    kind: "compensate",
    actionId: entry.actionId,
    reason: "later_step_failed",
  };
}
```

Trong thực tế, reconciliation thường phải đứng trước compensation. Nếu payment request unknown thật ra đã success, void có thể phù hợp. Nếu request chưa từng thành công, gửi void có thể tạo provider error khó hiểu hoặc tiêu tốn một action one-time. Probe phải được authorize, bounded và ghi vào ledger như mọi tool call khác.

## Recovery theo thứ tự ngược, nhưng đừng mặc định mọi bước đều reversible

Giả sử workflow của agent có các bước:

1. Reserve inventory.
2. Queue payment adjustment.
3. Update shipping instructions.
4. Submit exception for approval.

Nếu bước ba definitive fail, recovery manager có thể cần compensate bước hai rồi bước một. Thứ tự ngược giúp bảo vệ dependency: payment adjustment có thể tham chiếu order state cần được ổn định trước khi inventory release.

State machine đơn giản có thể như sau:

![State machine recovery của AI agent tách definitive failure, unknown outcome, probe, compensation và human escalation](/blog/ai-agent-compensation-transactions/unknown-state-machine.webp)

```text
planned
  |
  v
running ---- definitive failure ----> failed
  |                                      |
  | response lost / timeout              | registered inverse
  v                                      v
unknown -- probe --> succeeded      compensating
  |                   |                  |
  | no proof          |                  | confirmed
  v                   v                  v
needs_human        compensated <------ compensated
```

Sơ đồ này cố ý không phải một vòng lặp “error -> retry” thẳng. Recovery path phụ thuộc vào evidence. Later workflow failure có thể kích hoạt compensation cho các step đã hoàn thành, nhưng recovery manager phải bỏ qua action chưa đăng ký, đã hết hạn, chưa được authorize hoặc không an toàn trong state hiện tại.

Parallel action cần rule nghiêm hơn nữa. Hai branch tạo effect độc lập chỉ nên compensate đồng thời khi contract explicit cho phép. Nếu một branch phụ thuộc output của branch kia, compensation phải tôn trọng dependency thay vì đảo list theo timestamp một cách mù quáng.

## Phải authorize chính compensation

Một shortcut nguy hiểm là coi compensation mặc nhiên đáng tin vì forward action đã được authorize. Giả định này thường sai.

Forward action có thể là “reserve inventory”, còn inverse là “release scarce reservation”. Forward action có thể được assistant cho phép, trong khi refund hoặc deletion đòi hỏi human-approved scope. Compensation có thể chạy vài phút sau, trong một user session khác, khi policy version đã thay đổi.

Authorization request nên bao gồm mối quan hệ giữa forward action và recovery đang được đề xuất:

```json
{
  "action": "inventory.release",
  "resource": "reservation:res-9012",
  "context": {
    "workflow_id": "order-exception-4821",
    "caused_by_action": "reserve_inventory",
    "forward_status": "unknown",
    "policy_version": "fulfillment-18",
    "requires_human": false
  }
}
```

Policy có thể deny compensation khi evidence chưa đủ, provider reference thuộc tenant khác, time window đã hết hoặc action chạm vào approval boundary mạnh hơn. Forward path được allow không phải grant vĩnh viễn cho mọi recovery path sau đó.

## User nên thấy gì khi recovery chưa hoàn tất?

Recovery cũng là UX problem. Nói với khách hàng “Order của bạn thất bại” có thể sai nếu inventory vẫn đang bị giữ. Nói “Mọi thứ ổn” còn tệ hơn. User-facing state nên mô tả business truth ở đúng mức, không phơi bày payload nội bộ nhạy cảm.

Một message hữu ích có thể là: “Chúng tôi chưa thể xác nhận cập nhật giao hàng. Đơn hàng đang được đối soát; chúng tôi sẽ không tạo payment adjustment trùng.” Câu này truyền đạt uncertainty, safety guarantee và next step. Nó không giả vờ rằng provider timeout là definitive failure.

Internal record có thể chi tiết hơn:

| User-facing state | Internal state | Next action |
|---|---|---|
| Đang xử lý an toàn | `unknown` với probe đang hoạt động | Query provider và chờ trong SLA. |
| Đã khôi phục | `compensated` | Đóng workflow hoặc tiếp tục từ checkpoint an toàn. |
| Cần review | `needs_human` | Route vào queue có evidence tối thiểu. |
| Fail trước khi có effect | `failed` | Retry nếu policy cho phép và chắc chắn chưa có effect. |

Agent có thể giúp draft explanation, nhưng runtime nên chọn status. Nếu không, model có thể biến partial side effect thành một câu trả lời tự tin nhưng không đúng.

## Ưu tiên test các case khó giải thích

Thiết kế compensation chưa sẵn sàng cho production chỉ vì happy path chạy được. Test nên bắt đầu bằng tình huống khó giải thích nhất sau incident.

| Scenario | Classification kỳ vọng | Recovery kỳ vọng |
|---|---|---|
| Tool reject validation trước khi chạm provider | `failed` | Sửa input rồi mới retry. |
| Provider commit nhưng response bị mất | `unknown` | Probe bằng request hoặc provider reference. |
| Probe xác nhận forward effect | `succeeded` | Compensate nếu later step fail. |
| Probe xác nhận không có forward effect | `failed` | Không phát hành blind inverse. |
| Compensation chạy sau khi effect đã bị xóa | `compensated` hoặc safe no-op | Verify rồi đóng entry. |
| Compensation cần permission mạnh hơn | `needs_human` | Escalate kèm action evidence. |
| Compensation tool unavailable | `compensating` | Retry compensation theo policy riêng. |
| Hai branch complete một phần | Mixed | Dependency-aware recovery, không chỉ đảo timestamp. |
| Model đề xuất inverse chưa đăng ký | Không admissible | Deny và route tới reconciliation. |

Với mỗi case, hãy assert nhiều hơn final status. Assert ledger có đúng evidence, compensation được register trước forward call, authorization decision chỉ rõ policy version và user-facing message không nói quá mức certainty.

Một property nhỏ đáng test lặp lại là: **Recovery không được tạo side effect mới chỉ vì outcome trước đó là unknown**. Nếu provider hỗ trợ idempotency key, dùng nó cho forward action. Nếu có status probe, dùng probe trước compensation. Nếu cả hai không có, câu trả lời an toàn có thể là human queue thay vì một model call khác.

## Metric vận hành để nhìn thấy partial work bị che giấu

Team có thể có tool error rate thấp nhưng vẫn tích tụ một recovery problem lớn. Hãy đo những state nằm giữa request và business outcome cuối cùng.

Các metric hữu ích gồm tỷ lệ tool call bị classify là `unknown`, thời gian từ unknown đến resolution authoritative, compensation success rate, compensation retry count, tỷ lệ workflow vào `needs_human`, tỷ lệ action không có inverse đã đăng ký và số duplicate effect phát hiện trong reconciliation. Nên breakdown theo tool, provider, tenant, workflow type và policy version.

Đừng chỉ tối ưu automatic compensation. Compensation rate cao có thể nghĩa là forward workflow đang tạo effect quá sớm, trước khi validation xong. Human-escalation rate thấp có thể nghĩa là hệ thống che giấu uncertainty thay vì giải quyết nó. Mục tiêu không phải xóa sạch recovery queue; mục tiêu là làm mọi recovery decision có thể giải thích và có giới hạn.

Action ledger cũng tạo audit trail hữu ích mà không cần lưu private reasoning của model. Operator có thể thấy user intent identifier, action name, effect reference, outcome probe, authorization result và compensation decision. Chừng đó đủ để reconstruct hệ thống đã làm gì và vì sao được phép làm, mà không hứa rằng chain-of-thought transcript là audit record chính xác hoặc phù hợp.

## Kế hoạch rollout thực tế

Hãy bắt đầu với một workflow có effect quan trọng nhưng recovery contract đã hiểu rõ. Inventory từng tool: side effect, authoritative lookup, forward idempotency behavior, compensation và escalation queue. Đừng bắt đầu bằng yêu cầu mơ hồ “làm agent có tính transaction”. Hãy bắt đầu bằng một bảng mà reviewer có thể chất vấn.

Sau đó chạy ledger ở shadow mode. Để workflow hiện tại tiếp tục execute, nhưng record xem mỗi tool có thể khai báo effect, probe và inverse hay không. So sánh classification được đề xuất với outcome thật từ provider. Bước này thường phơi ra tool trả ambiguous error, thiếu stable reference hoặc có inverse chỉ an toàn dưới một business condition rất hẹp.

Tiếp theo, enforce việc registration trước execution và default-deny mọi consequential tool không có contract hợp lệ. Chỉ bật automatic compensation cho một allowlist nhỏ. Giữ unknown outcome ở reconciliation path cho tới khi probe và permission đủ đáng tin. Cuối cùng, đưa failure injection vào quy trình: drop response sau khi provider commit, delay callback, reject compensation call và đổi policy version giữa forward action với recovery.

Hệ thống sẵn sàng rollout rộng hơn khi team trả lời được, với mọi side-effecting tool:

- Nếu call success, nó thay đổi gì?
- Nếu response mất, làm sao biết điều gì đã xảy ra?
- Với từng outcome, compensation nào an toàn?
- Policy nào authorize compensation đó?
- Khi inverse không tồn tại, điều gì xảy ra?
- Nếu automation dừng, human nhận được evidence nào?

## Recovery boundary là nơi trust biến thành engineering

AI agent giỏi đề xuất một chuỗi action hữu ích. Agent không thay thế được ledger, provider reference, state probe hoặc business policy. Những control này tồn tại vì thế giới có thể thay đổi sau khi model hình thành plan, và network error không xóa một side effect.

Compensation transaction làm thực tế đó trở nên explicit. Nó buộc team nói rõ action làm gì, kiểm tra thế nào, offset ra sao và khi nào phải bàn giao cho con người. Nó cũng ngăn một category mistake phổ biến: coi suggestion tiếp theo của model như thể đó là rollback protocol.

Những agent system mạnh nhất sẽ không phải hệ thống chưa từng gặp partial failure. Đó sẽ là hệ thống biết dừng ở boundary chưa chắc chắn, giữ evidence, tránh duplicate effect và recovery bằng một decision mà một engineer khác vẫn hiểu được sau sáu tháng.

## References

[1]: https://docs.temporal.io/design-patterns/saga-pattern "Temporal Documentation — Saga Pattern"

[2]: https://arxiv.org/html/2605.03409v2 "Perera et al. — Robust Agent Compensation (RAC): Teaching AI Agents to Compensate"

[3]: https://blogs.oracle.com/database/ai-agents-enterprise-reality-workflows-transactions-runtime-controls "Oracle Database Insider — When AI Agents Meet Enterprise Reality: Workflows, Transactions, and Runtime Controls"

[4]: https://www.rfc-editor.org/rfc/rfc9110.html "RFC 9110 — HTTP Semantics"

[5]: https://www.rfc-editor.org/rfc/rfc9111.html "RFC 9111 — HTTP Caching"
