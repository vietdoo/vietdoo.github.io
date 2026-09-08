---
title: "AI Agent có một chiếc đồng hồ: Deadline, Lease và Plan hết hạn"
description: "AI agent không chỉ cần reasoning tốt hơn. Nó cần time semantics: business deadline, execution lease có thời hạn, observation có freshness và một đường refuse khi plan không còn an toàn để thực thi."
pubDate: 2026-03-12
category: "engineering"
image: "/blog/ai-agent-clock/hero.webp"
lang: "vi"
translationKey: "ai-agent-time-semantics"
draft: false
---

![Minh họa AI agent làm việc cạnh đồng hồ, plan và bốn ranh giới thời gian: business deadline, execution lease, observation TTL và stale plan](/blog/ai-agent-clock/hero.webp)

Sự cố không bắt đầu bằng một hallucination.

Agent đã tìm đúng tài liệu, chọn đúng tool và tạo ra một plan hoàn toàn hợp lý. Người dùng yêu cầu cập nhật địa chỉ giao hàng sau khi xác nhận thay đổi. Workflow tạm dừng vì fulfillment service mất kết nối trong chốc lát. Sáu phút sau, worker khôi phục và resume từ plan đã lưu.

Plan vẫn hợp lệ về mặt cú pháp. Địa chỉ vẫn nằm trong tool arguments. Tool call vẫn pass schema validation.

Nhưng đơn hàng lúc đó đã chuyển vào hàng đợi kho bị khóa. Action không còn an toàn để thực thi nếu chưa kiểm tra lại order. Agent nhớ được *mình định làm gì*, nhưng không nhớ được *từ lúc nào quyết định đó không còn đáng tin*.

Đó là failure mode của bài viết này. Nhiều production agent được thiết kế như thể thời gian chỉ là chi tiết vận chuyển: thêm timeout quanh một API call, retry khi lỗi rồi tiếp tục khi process quay lại. Trong workflow thực tế, thời gian làm thay đổi ý nghĩa. Customer confirmation hết hạn. Payment authorization không còn hiệu lực. Quyền sở hữu task của worker kết thúc. Observation về inventory trở nên cũ. Một plan an toàn lúc 10:02 có thể không còn an toàn lúc 10:08.

> **Luận điểm chính:** Hãy coi thời gian là một phần của safety contract của agent. Mỗi run cần một business deadline, mỗi action độc quyền cần một execution lease có giới hạn, mỗi observation quan trọng cần freshness policy, và mỗi plan được resume phải đi qua time-aware revalidation gate.

Đây không phải đề xuất làm agent “nhanh hơn”. Đây là cách để agent phân biệt **chưa làm xong** với **không còn được phép làm xong**.

## Bốn chiếc đồng hồ không nên bị gộp thành một

Từ *timeout* hấp dẫn vì nó có vẻ giải quyết mọi vấn đề chờ đợi bằng một con số. Nhưng nó không làm được như vậy. Một production agent thường có ít nhất bốn chiếc đồng hồ, thuộc về những phần khác nhau của hệ thống.

| Clock | Câu hỏi cần trả lời | Ví dụ | Cách thất bại an toàn khi hết hạn |
|---|---|---|---|
| Business deadline | Đến khi nào thì không nên tiếp tục theo đuổi business outcome? | “Xác nhận booking trước 18:00 theo giờ địa phương” | Dừng, giải thích hết hạn, yêu cầu xác nhận mới |
| Execution lease | Worker/agent được quyền sở hữu action trong bao lâu? | “Checkout task được worker A giữ trong 90 giây” | Lease hết hạn và late write bị chặn |
| Observation freshness | Fact này có thể được tin trong bao lâu? | “Tồn kho được quan sát lúc 10:02, hợp lệ 30 giây” | Đọc lại source trước khi quyết định |
| Plan validity | Điều kiện nào khiến multi-step plan còn áp dụng? | “Refund chỉ thực hiện khi invoice và approval chưa đổi” | Revalidate, replan hoặc refuse |

Các clock có thể liên quan, nhưng nên được biểu diễn riêng. Mô tả của Martin Fowler về distributed lease nắm đúng ý cốt lõi: quyền truy cập được cấp trong một khoảng thời gian hữu hạn và cần được renew trước khi hết hạn; node đã crash hoặc bị ngắt kết nối không được giữ quyền mãi mãi. Tài liệu Temporal bổ sung một phân biệt quan trọng: timeout dùng để phát hiện failure, còn timer dùng để thực hiện business logic.

AI agent còn thêm một vấn đề thứ năm: plan là cách diễn giải các observation. Timer có thể nói rằng năm phút đã trôi qua. Nó không thể nói evidence đứng sau plan còn áp dụng hay không. Vì vậy, một run được resume cần cả timer cơ học lẫn semantic revalidation.

![Timeline tách business deadline của run khỏi các mốc acquire, renew, release và stop của execution lease](/blog/ai-agent-clock/time-contract.webp)

## Bắt đầu bằng time contract, không phải timeout constant

Trước khi viết worker loop, hãy viết time contract cho workflow. Nó nên trả lời bốn câu hỏi bằng ngôn ngữ đời thường.

Thứ nhất, thời điểm muộn nhất mà business outcome còn có ích là khi nào? Đó là **business deadline**. Nó không nhất thiết là HTTP duration tối đa. Một câu trả lời support có thể còn hữu ích trong 24 giờ, trong khi one-time password chỉ hữu ích trong năm phút.

Thứ hai, hệ thống đang cấp tạm thời quyền hạn nào? Đó là **execution lease**. Lease phù hợp khi hai worker không được cùng thực hiện một exclusive action, hoặc worker phải chứng minh rằng nó vẫn sở hữu quyền tiếp tục. Lease không phải lời hứa action sẽ thành công. Nó chỉ là quyền được thử trong một khoảng thời gian hữu hạn.

Thứ ba, observation nào có thể thay đổi trong lúc agent đang chạy? Đó là **freshness policy**. Static policy document có thể có validity window dài. Delivery slot hoặc account balance có thể cần window rất ngắn. TTL đúng là quyết định của domain, không phải một default chung của infrastructure.

Thứ tư, điều gì bắt buộc phải đúng tại final side-effect boundary? Đó là **revalidation predicate**. Agent có thể lập plan từ một snapshot, nhưng write path phải kiểm tra lại các giả định khiến write đó an toàn.

Một contract nhỏ có thể trông như sau:

```ts
type TimeContract = {
  runDeadline: string;
  leaseTtlMs: number;
  observationTtlMs: Record<string, number>;
  revalidateBefore: string[];
  onExpiry: "revalidate" | "pause" | "refuse" | "escalate";
};

const addressChangeContract: TimeContract = {
  runDeadline: "2026-03-12T18:00:00+07:00",
  leaseTtlMs: 90_000,
  observationTtlMs: {
    order_state: 30_000,
    customer_confirmation: 300_000,
    policy_document: 86_400_000,
  },
  revalidateBefore: ["order_state", "customer_confirmation"],
  onExpiry: "revalidate",
};
```

Điểm quan trọng không nằm ở exact data structure. Điểm quan trọng là expiry behavior phải nằm cạnh workflow contract, nơi engineer và reviewer có thể đọc được. Nếu expiry bị giấu trong queue client hoặc SDK default, sản phẩm đang sở hữu một policy tình cờ.

## Deadline không giống timeout

Network timeout trả lời câu hỏi: “Chờ bao lâu cho riêng call này?” Business deadline trả lời câu hỏi: “Chúng ta sẵn sàng theo đuổi outcome này trong bao lâu?” Cái đầu thuộc về một attempt. Cái sau bao phủ cả run, bao gồm queue delay, model call, tool call, retry và thời gian người dùng chờ.

Hãy tưởng tượng agent có 120 giây để hủy một shipment. Nó mất 25 giây chờ worker, 20 giây tạo plan, 30 giây retry carrier API và 35 giây chờ màn hình xác nhận. Final tool call vẫn có thể có HTTP timeout 30 giây, nhưng business time chỉ còn 10 giây. Bắt đầu thêm một attempt 30 giây là đúng về mặt kỹ thuật nhưng sai về mặt nghiệp vụ.

Hãy truyền một absolute deadline qua mọi layer thay vì tính lại một duration mới ở mỗi retry.

```ts
function remainingMs(deadlineMs: number, nowMs = Date.now()) {
  return Math.max(0, deadlineMs - nowMs);
}

async function callWithBudget<T>(
  deadlineMs: number,
  operation: (timeoutMs: number) => Promise<T>,
) {
  const budget = remainingMs(deadlineMs);
  if (budget <= 0) throw new Error("business_deadline_exceeded");

  const timeoutMs = Math.min(budget, 20_000);
  return operation(timeoutMs);
}
```

Phân biệt này cũng làm rõ retry. Retry policy mô tả cách thử lại sau một failure; nó không được âm thầm tạo ra một business obligation vô hạn. Temporal mô tả exponential backoff và các giới hạn tách biệt cho từng attempt với tổng thời gian effort. Nguyên tắc tương tự áp dụng ngay cả khi agent runtime là code tự xây: hãy giới hạn toàn bộ outcome, không chỉ từng request.

Expiry path phải là một product decision. Có workflow có thể pause và chờ người dùng. Có workflow nên trả về partial result. Có workflow phải refuse vì làm muộn còn tệ hơn không làm. Deadline không đi kèm expiry outcome rõ ràng thì chỉ là một timestamp.

## Lease bảo vệ ownership, không bảo đảm truth

Lease hữu ích khi một action cần có đúng một owner hiện tại. Lease phổ biến trong distributed systems vì worker có thể crash hoặc bị network partition; lease giới hạn thời gian ngăn worker đó giữ resource vô thời hạn.

Với agent, resource có thể là task, customer conversation, browser session, shopping cart hoặc reconciliation job. Lease phải gắn với owner và được kiểm tra ở nơi side effect được commit.

```ts
type Lease = {
  leaseId: string;
  resourceId: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
  fencingToken: number;
};

function assertLease(lease: Lease, now = Date.now()) {
  if (Date.parse(lease.expiresAt) <= now) {
    throw new Error("lease_expired");
  }
}
```

`fencingToken` rất quan trọng. Worker đến muộn có thể thức dậy sau khi lease hết hạn nhưng vẫn tin rằng mình là owner. Một token tăng dần cho phép storage layer từ chối write của lease cũ. Chỉ check ở worker là chưa đủ; write boundary phải enforce ownership rule.

Lease cũng không làm cho thông tin cũ trở thành đúng. Worker A có thể đang giữ lease hợp lệ trong khi order state đã đổi vì human operator hoặc hệ thống khác cập nhật. Lease nói rằng “bạn được thử trên resource này”, chứ không nói rằng “plan của bạn vẫn đúng”. Đó là công việc của revalidation.

Renewal cũng cần được nghi ngờ. Đừng renew mãi chỉ vì model vẫn đang suy nghĩ. Hãy đặt maximum lease horizon gắn với business deadline. Nếu run cần thêm thời gian, tạo một decision point mới thay vì âm thầm kéo dài một authority cũ.

## Observation cần freshness policy

Câu “agent đã thấy X” là chưa đủ. Ta cần biết nó thấy X khi nào, source tạo ra X khi nào và X được chấp nhận trong bao lâu cho decision đang xét.

```ts
type Observation<T> = {
  value: T;
  source: string;
  observedAt: string;
  sourceUpdatedAt?: string;
  expiresAt: string;
  evidenceId: string;
};

function isFresh<T>(observation: Observation<T>, now = Date.now()) {
  return Date.parse(observation.expiresAt) > now;
}
```

Freshness không đồng nghĩa với recency. Một policy đổi từ hôm qua vẫn có thể hợp lệ nếu có version và được approve. Một stock count từ mười giây trước đã có thể không an toàn nếu sản phẩm đang được bán đồng thời. Các bài viết gần đây về data readiness cho agentic system cũng coi freshness SLA, data contract và traceability là một phần của data layer, thay vì metadata tùy chọn.

Câu hỏi hữu ích không phải “Data có fresh không?” mà là “Fresh đủ cho action nào?” Observation cũ có thể đủ để tạo draft answer nhưng không đủ để mua hàng. Nó có thể đủ để xếp hạng lựa chọn nhưng không đủ để commit reservation.

| Action class | Ví dụ | Freshness posture thường gặp |
|---|---|---|
| Inform | Giải thích product policy | Versioned document và effective date rõ ràng |
| Recommend | Gợi ý delivery slot | TTL ngắn và hiển thị “đã kiểm tra lúc” |
| Reserve | Giữ inventory hoặc meeting slot | Đọc lại ngay trước khi reserve |
| Commit | Charge, delete, publish hoặc đổi account state | Source còn fresh và final invariant check |

Đừng bắt language model tự suy freshness từ prose. Hãy đặt freshness vào một envelope máy đọc được và để tool gateway reject evidence hết hạn với các operation có impact cao.

![Plan trở nên stale khi đồng hồ chạy; decision gate đưa plan về revalidation hoặc refusal thay vì thực thi mù quáng](/blog/ai-agent-clock/stale-plan.webp)

## Plan được resume phải giành lại quyền được tiếp tục

Checkpoint có ích, nhưng resume một plan không giống replay một function. Thế giới có thể đã đổi trong lúc agent pause. Resume path an toàn cần load plan, load evidence references, tính current time và đánh giá assumptions trước khi cho phép side effect tiếp theo.

```ts
type Plan = {
  planId: string;
  steps: Array<{ tool: string; args: unknown }>;
  assumptions: Array<{ key: string; expected: unknown }>;
  createdAt: string;
  validUntil: string;
};

async function resume(plan: Plan, now = Date.now()) {
  if (Date.parse(plan.validUntil) <= now) {
    return { kind: "revalidate", reason: "plan_expired" } as const;
  }

  const current = await readCurrentState(plan.assumptions);
  if (!assumptionsStillHold(plan.assumptions, current)) {
    return { kind: "replan", reason: "assumption_changed" } as const;
  }

  return { kind: "continue", plan } as const;
}
```

Gate này nên cố tình buồn tẻ. Nó không hỏi model viết một lời giải thích thuyết phục rằng plan hết hạn “có lẽ vẫn ổn”. Nó kiểm tra predicate có kiểu: order status vẫn là `editable`, approval chưa bị revoke, tenant chưa đổi, account version vẫn match và evidence liên quan còn trong TTL.

Khi predicate fail, hãy giữ plan làm historical evidence nhưng không thực thi nó. User có thể được thông báo: “Plan trước đã hết hạn trong lúc carrier service không khả dụng. Tôi đã kiểm tra lại order và cần bạn xác nhận trước khi thử lại.” Trải nghiệm đó tốt hơn một duplicate change âm thầm hoặc thông báo mơ hồ kiểu “đã xảy ra lỗi”.

## State machine khiến expiry trở nên nhìn thấy được

Các time-related transition nên xuất hiện trong state machine của workflow, không chỉ trong log. Một action lifecycle tối thiểu có thể gồm `PROPOSED`, `LEASED`, `EXECUTING`, `COMMITTED` và `EXPIRED_RECONCILE`. Expiry state không phải generic error bucket. Nó nói cho operator và recovery code biết agent đã mất quyền tiếp tục với các assumption cũ.

![State machine dạng sketch cho thấy agent đi từ proposed đến leased, executing và committed, với timeout transition sang expired và reconcile](/blog/ai-agent-clock/lease-state-machine.webp)

```text
PROPOSED
   | acquire lease + validate evidence
   v
LEASED  ---- lease expires ----> EXPIRED_RECONCILE
   | start before deadline
   v
EXECUTING ---- deadline/freshness failure -> EXPIRED_RECONCILE
   |
   | final invariant check + fenced write
   v
COMMITTED
```

Transition sang `COMMITTED` nên là phần hẹp nhất của hệ thống. Nó phải verify lease, business deadline, freshness của observation bắt buộc và expected version của target resource. Nếu một check fail, hệ thống phải tạo structured reason thay vì để model tự quyết định có nên “thử luôn” hay không.

## Những thiết kế nghe hợp lý nhưng sẽ hỏng về sau

Anti-pattern đầu tiên là **một timeout cho toàn bộ agent**. Nó trộn transport, worker capacity, user waiting và business validity. Kết quả là hệ thống hoặc cancel quá sớm, hoặc action quá muộn sau khi useful window đã đóng.

Anti-pattern thứ hai là **refresh mọi timestamp khi resume**. Một resumed plan gán `createdAt = now` không hề fresh; nó chỉ đang che giấu tuổi của plan. Hãy giữ nguyên observation time ban đầu và tạo observation mới một cách tường minh.

Anti-pattern thứ ba là **chỉ check lease trước model generation**. Model có thể suy nghĩ lâu hơn lease, hoặc queued tool call có thể execute sau khi lease hết hạn. Hãy check ownership ở commit boundary và dùng fencing token nếu storage system hỗ trợ.

Anti-pattern thứ tư là **retry action đã hết hạn vì error là transient**. Network failure có thể transient, nhưng business authority không nhất thiết còn được renew. Tách transport error có thể retry khỏi expired permission, stale evidence và changed state.

Anti-pattern thứ năm là **coi expiry như một background failure im lặng**. User và operator cần phân biệt “agent vẫn đang làm”, “thế giới đã đổi” và “agent dừng vì không còn được phép tiếp tục”. Ba trạng thái này cần UI, metric và recovery action khác nhau.

## Một lộ trình triển khai thực tế

Hãy bắt đầu với một workflow có thể tạo ra late action tốn kém hoặc gây khó xử: refund, booking, thay đổi tài khoản, fulfillment update hoặc browser automation. Đừng instrument mọi agent cùng lúc.

Viết time contract trong một tài liệu nhỏ, dễ review. Nêu business deadline, lease owner, maximum lease horizon, observation TTL, final invariant và expiry outcome. Gắn immutable identifier vào mỗi run để một late action có thể truy ngược về contract đã cấp quyền.

Tiếp theo, enforce deadline trong orchestration layer và lease trong resource hoặc tool gateway. Thêm `observedAt`, `expiresAt`, `evidenceId` và `fencingToken` vào các structured envelope đi qua boundary đó. Mặc định hãy log decision reason, không log toàn bộ private prompt payload.

Sau đó test các trường hợp khó chịu: worker ngủ quá lease, user đổi record trong lúc model generation, evidence hết hạn giữa planning và execution, clock đi qua daylight-saving boundary, retry budget cạn, và external API trả unknown outcome sau deadline. Expected answer của mỗi case nên là một state transition, không phải hy vọng mơ hồ rằng model sẽ tự recovery.

Cuối cùng, đo hệ thống bằng các signal cho thấy time semantics có thực sự hoạt động. Theo dõi late-write attempt bị fencing từ chối, plan bị invalid khi resume, revalidation rate, expiry reason, thời gian chờ worker và số action được refuse an toàn. Refusal tăng chưa chắc là xấu; nếu baseline trước đây hành động trên authority cũ, đó có thể là một cải thiện chất lượng.

## Lời kết

AI agent không đáng tin chỉ vì nó có thể nhớ một plan. Nó đáng tin khi biết các giới hạn quanh plan đó.

Deadline nói persistence không còn hữu ích từ lúc nào. Lease nói ownership không còn hợp lệ từ lúc nào. Freshness policy nói observation có thể hỗ trợ decision trong bao lâu. Revalidation gate nói agent phải gặp lại thế giới trước khi thay đổi thế giới.

Đây đều là các ý tưởng quen thuộc của distributed systems, nhưng agent khiến sự thiếu vắng chúng lộ rõ hơn vì “client” có đủ năng lực tạo ra một next step hợp lý ngay cả khi điều kiện ban đầu đã biến mất. Hãy cho agent một chiếc đồng hồ, không phải để nó lo lắng, mà để authority của nó trở nên rõ ràng.

## Tài liệu tham khảo

[1]: https://martinfowler.com/articles/patterns-of-distributed-systems/lease.html "Martin Fowler — Lease"
[2]: https://temporal.io/blog/timers-timeouts-and-the-art-of-waiting-in-temporal "Temporal — Timers, Timeouts, and the Art of Waiting"
[3]: https://docs.temporal.io/encyclopedia/retry-policies "Temporal — Retry Policies"
[4]: https://www.martinfowler.com/articles/making-data-ready-for-agentic-ai.html "Martin Fowler — Making Your Data Ready for Agentic AI"
