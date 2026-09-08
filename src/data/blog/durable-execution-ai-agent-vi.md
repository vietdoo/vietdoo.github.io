---
title: "Durable Execution cho AI Agent: Checkpoint, Resume và Retry an toàn"
description: "Cách giúp workflow AI dài hạn sống sót qua crash, timeout, duplicate delivery và thời gian chờ human mà không biến recovery thành một ứng dụng thứ hai."
pubDate: 2026-07-14
category: "engineering"
image: "/blog/durable-agent/hero.webp"
lang: "vi"
translationKey: "durable-execution-ai-agent"
draft: false
---

![Workflow AI agent tiếp tục từ checkpoint bền vững sau khi worker bị crash](/blog/durable-agent/hero.webp)

<figure class="blog-video">
  <video controls preload="metadata" playsinline poster="/blog/durable-agent/hero.webp" aria-label="Video giải thích nội dung bài viết, phiên bản tiếng Việt">
    <source src="/blog/durable-execution-ai-agent/video-vi.mp4" type="video/mp4" />
    Trình duyệt của bạn không hỗ trợ video HTML5.
  </video>
  <figcaption>Video giải thích chuyên sâu: phiên bản tiếng Việt.</figcaption>
</figure>

Một chatbot thường đủ ngắn để nằm trong một HTTP timeout. Một agent hữu ích trong production thì thường không.

Agent có thể phải đọc nhiều hệ thống, chờ approval, retry provider, ngủ tới một deadline, xử lý tài liệu lớn hoặc tiếp tục sau một lần deploy. Khi agent vượt qua ranh giới đó, một `try/catch` quanh model call không còn là thiết kế reliability. Nó chỉ là phản ứng cục bộ với một lỗi.

Câu hỏi khó chịu nhưng rất đơn giản là: **nếu process biến mất sau bước thứ tư, điều gì nói cho hệ thống biết phải resume ở đâu, công việc nào đã xảy ra và effect nào an toàn để lặp lại?**

Đây là bài toán durable execution. Temporal định nghĩa khái niệm này là “crash-proof execution”: một abstraction cho phép application work tiếp tục sau khi process hoặc machine lỗi, đồng thời giữ state cần thiết để đi tiếp.[1] Khái niệm đó hữu ích, nhưng agent có thêm nhiều phức tạp. Model response không deterministic, tool call có side effect, context có thể bị compact và người dùng có thể đợi hàng giờ hoặc nhiều ngày giữa hai bước.

Bài viết xem durable execution như một kiến trúc workflow cho AI agent. Đây không phải product tutorial và cũng không phải lời hứa rằng workflow engine loại bỏ mọi failure. Thiết kế vẫn cần idempotent effect, timeout rõ ràng, retry budget, lease, versioning và reconciliation.

> **Luận điểm:** Hãy làm workflow durable, nhưng làm side effect thật tường minh. Checkpoint state và decision của agent; đừng bao giờ giả định rằng replay một model call tương đương replay một database write, email, payment hay external API request.

## Process không phải workflow

Trong một process bình thường, local variable, call stack và in-memory queue biến mất khi process biến mất. Nếu application đã hoàn thành A và B, crash trong C và không có durable record, process tiếp theo không thể biết B đã commit, mới làm dở hay chưa bao giờ bắt đầu.

Durable workflow thay đổi abstraction. Worker có thể thay thế; workflow history thì không. Worker mới có thể reconstruct state cần thiết và tiếp tục từ một điểm đã biết.

![Event history của workflow giữ checkpoint và cho worker mới replay các bước đã hoàn thành](/blog/durable-agent/checkpoint-ledger.webp)

Với AI agent, durable state nên phân biệt ít nhất bốn lớp:

| Lớp | Nên chứa gì | Không nên giả định |
|---|---|---|
| Intent | User request, tenant, authority, deadline, policy version | Prompt ban đầu luôn còn sẵn. |
| Workflow state | Step hiện tại, fact đã hoàn thành, decision chờ xử lý, retry counter | In-memory agent object là source of truth. |
| Evidence | Tool result, reference retrieval, validation outcome, hash | Model có thể tái tạo observation cũ y hệt. |
| Effect | Email, ticket, payment, mutation, outbound message | Retry vô hại chỉ vì request có cùng text. |

Phân biệt state và evidence rất quan trọng. Có thể yêu cầu model tóm tắt tool result cũ, nhưng chính result đó nên được lưu thành artifact durable hoặc reference tới artifact. Nếu không, recovery có thể âm thầm query hệ thống đã thay đổi và đưa ra quyết định khác với lần chạy ban đầu.

Điều này không giống [agent handover](/blog/agent-handover-architecture). Handover chuyển trách nhiệm giữa agent hoặc session. Durable execution giữ một runtime workflow để công việc tiếp tục sau crash, timeout, deploy hoặc thời gian human chờ.

## Checkpoint là semantic boundary

Checkpoint không nhất thiết là snapshot của mọi token trong context. Nó là durable record tại một điểm mà workflow có thể reconstruct mà không mơ hồ.

Các ranh giới tốt thường xuất hiện sau một đơn vị công việc có ý nghĩa:

* task đã được phân loại và kiểm tra policy;
* read-only tool trả về result đã validate;
* plan được approve hoặc freeze cho stage tiếp theo;
* nhận được quyết định của con người;
* external effect trả về idempotent receipt;
* failure được phân loại và retry budget đã giảm.

Một checkpoint record có thể như sau:

```json
{
  "workflow_id": "wf_2026_07_14_0042",
  "version": 3,
  "step": "prepare_case_reply",
  "status": "waiting_for_effect",
  "tenant_id": "tenant-17",
  "policy_version": "policy-2026-06-02",
  "facts": ["case_exists", "documents_missing"],
  "evidence_refs": ["obj://evidence/7b2..."],
  "next_action": "create_draft",
  "retry_budget": {"model": 2, "tool": 1},
  "updated_at": "2026-07-14T10:20:00Z"
}
```

Record này cố ý lưu state gọn thay vì một prompt transcript khổng lồ. Full input và output có thể nằm trong encrypted evidence store với retention control. Workflow history trỏ tới artifact, lưu content hash và capture schema version cần để diễn giải artifact.

## Resume là bài toán state machine

Agent đáng tin cậy nên được thiết kế như state machine, dù code thực tế dùng function thông thường. State nên mô tả business progress, không mô tả tâm trạng của model.

```text
RECEIVED
  -> POLICY_CHECKED
  -> CONTEXT_READY
  -> PLAN_RECORDED
  -> TOOL_READ_COMPLETED
  -> DECISION_VALIDATED
  -> EFFECT_REQUESTED
  -> EFFECT_CONFIRMED
  -> COMPLETED
```

Mỗi transition cần precondition và evidence. `EFFECT_CONFIRMED` không thể suy ra từ việc model nói “done”; nó cần provider receipt, database version hoặc reconciliation result. Nếu worker crash sau khi gửi email nhưng trước khi ghi confirmation, recovery phải kiểm tra effect ledger trước khi gửi lại.

![Worker lỗi biến mất, worker thay thế replay durable state và resume từ checkpoint an toàn cuối cùng](/blog/durable-agent/replay-recovery.webp)

Resume algorithm nên nhàm chán:

```python
def resume(workflow_id):
    state = history.load_latest(workflow_id)
    verify_schema(state.version)
    verify_policy_still_allows(state)

    if state.status == "waiting_for_effect":
        receipt = effects.lookup(state.effect_key)
        if receipt:
            return advance_from_receipt(state, receipt)
        return retry_or_reconcile_effect(state)

    if state.status == "waiting_for_human":
        return wait_for_decision(state)

    return run_next_deterministic_step(state)
```

Function không nên gọi model trước khi biết workflow state nghĩa là gì. Nó không nên giả định worker trước đã có đủ thời gian ghi checkpoint. Nó cũng phải có quyền từ chối resume khi workflow version hoặc policy đã không còn tương thích.

## Mặc định retry model call, không retry business effect

AI system khiến retry trở nên hấp dẫn. Provider timeout, response malformed hoặc tool result bị mất. Nhưng retry toàn bộ workflow là không an toàn.

Model completion thường là một phép tính ứng viên. Nếu lặp lại, application có thể validate result và quyết định khác biệt có quan trọng không. Email, refund, account mutation hay ticket creation là effect. Lặp lại có thể gây hại.

Dùng policy khác nhau cho từng boundary:

| Boundary | Failure thường gặp | Cách retry |
|---|---|---|
| Model call | Timeout, rate limit, structured output sai | Retry có backoff và giới hạn; validate mỗi result. |
| Read-only tool | Dependency tạm thời lỗi | Retry kèm timeout và circuit breaker. |
| Human wait | Chưa có phản hồi | Không retry; lưu timer hoặc subscription. |
| Write effect | Kết quả network mơ hồ | Query bằng idempotency key và reconcile trước khi retry. |
| Workflow transition | Version conflict | Reload state và transition deterministic. |

Retry budget phải là một phần của durable state. Nếu không, process restart có thể reset counter và tạo infinite loop qua nhiều worker. Backoff nên có jitter, đồng thời phân biệt transient error với permanent contract error. Tool argument sai không được sửa bằng cách gửi lại cùng request mười lần.

Điều này gần với bài toán exactly-once effects nhưng không đồng nhất. Durable execution cho workflow biết nó đang ở đâu. Idempotency và effect ledger cho thế giới bên ngoài biết effect đã xảy ra chưa. Cần cả hai.

## Lease ngăn hai worker cùng hành động

Durable storage không tự ngăn duplicate worker. Timeout có thể khiến queue nghĩ worker đã chết trong khi worker cũ vẫn chạy. Deploy có thể khởi động worker mới trước khi worker cũ giải phóng tài nguyên. Khi đó hai worker cùng xử lý một step.

Dùng lease gồm owner, expiry và fencing token. Worker phải renew lease khi chạy và gửi token khi commit checkpoint hoặc effect intent. Worker cũ có thể hoàn tất local computation, nhưng storage layer từ chối commit của nó.

```sql
UPDATE workflow_steps
SET status = 'completed', result_ref = :result, fencing_token = :token
WHERE workflow_id = :id
  AND step = :step
  AND lease_owner = :owner
  AND fencing_token = :token
  AND lease_expires_at > CURRENT_TIMESTAMP;
```

Cách này không biến external provider thành transaction. Nó chỉ ngăn worker cũ advance state của workflow. External effect vẫn cần idempotency key, provider lookup hoặc reconciliation job.

## Thời gian chờ dài cũng là một phần workflow

Agent có thể phải chờ human approval, tài liệu, ngày đã định hoặc external process chậm. Giữ một worker thread sống là tốn kém và dễ lỗi. Durable execution cho workflow ngủ mà không xem sleep như một process đang chạy.

![Các agent job dài hạn chờ, thức dậy, retry và di chuyển qua worker pool trong khi dùng chung durable history](/blog/durable-agent/worker-pool.webp)

Workflow nên lưu điều kiện thức dậy, không chỉ đặt timer trong memory:

| Kiểu chờ | Durable representation | Trigger resume |
|---|---|---|
| Human approval | Decision pending với approver và expiry | Signed decision event. |
| External job | Correlation ID và terminal state kỳ vọng | Webhook hoặc polling result. |
| Time deadline | UTC timestamp và timezone policy | Scheduler event. |
| Missing data | Field cần có và owner | Document mới hoặc user response. |
| Rate limit | Retry-after và budget | Timer cộng provider health check. |

Workflow cũng phải định nghĩa khi thời gian chờ hết. Timeout nên dẫn đến state có tên như cancelled, escalated hoặc needs-information, không phải exception ẩn biến mất khỏi tầm nhìn người dùng.

## Replay không đồng nghĩa deterministic miễn phí

Một durable engine có thể replay workflow code để reconstruct state. Vì vậy workflow layer phải deterministic. Tránh đọc current time trực tiếp, tạo random identifier trong logic replay, gọi network từ workflow code hoặc phụ thuộc global state mutable.

Đặt phần nondeterministic sau activity hoặc task boundary. Lưu result và replay result đã lưu thay vì gọi provider lại trong lúc reconstruct. Với model call, lưu request metadata, model target, prompt/context reference liên quan, response, validation result và policy version theo retention policy.

Model nondeterminism ảnh hưởng semantic replay. Dù resume từ cùng checkpoint, model call mới có thể tạo plan khác. Điều đó chỉ chấp nhận được nếu step được thiết kế như một decision mới với constraint rõ. Không chấp nhận nếu hệ thống xem replay là bằng chứng để side effect xảy ra lần nữa.

Schema và workflow version phải rõ ràng. Deploy có thể đổi state name, thêm field bắt buộc hoặc đổi nghĩa tool result. Hãy hỗ trợ history cũ bằng compatibility code hoặc pin workflow version tới khi các run cũ hoàn tất.

## Failure injection mới là tutorial thật

Workflow durable chưa hoàn thành khi happy path chạy xong. Hãy test tại những điểm kỹ sư thường nói “process chắc không chết đúng lúc đó đâu.” Kill worker sau model response nhưng trước checkpoint. Kill sau effect request nhưng trước receipt. Delay webhook, duplicate webhook, reorder event, expire lease, deploy workflow version mới và trả malformed tool result.

Test phải assert invariant của outcome, không chỉ assert workflow cuối cùng trả về một string.

| Failure injection | Invariant kỳ vọng |
|---|---|
| Crash trước checkpoint | Step có thể chạy lại nhưng không duplicate effect không bảo vệ. |
| Crash sau effect request | Recovery query effect ledger trước khi retry. |
| Duplicate webhook | Chỉ một transition được accept; duplicate vô hại. |
| Worker lease hết hạn | Worker cũ không thể commit result bị fence. |
| Provider trả JSON sai | Retry có giới hạn và workflow vào failure state nhìn thấy được. |
| Workflow version đổi | Run cũ vẫn tương thích hoặc được migrate rõ ràng. |

Cách test này bổ sung cho [agent regression suite](/blog/agent-evals-regression-suite). Regression eval hỏi behavior của agent còn chấp nhận được không. Failure injection hỏi runtime có giữ được behavior khi time, worker và dependency cư xử xấu không.

## Checklist production

| Khu vực | Câu hỏi cần trả lời trước launch |
|---|---|
| State | Worker mới có reconstruct được next safe step không? |
| Evidence | Tool result và decision có reference, hash, retention rule không? |
| Effect | Mọi write action có idempotency key và reconciliation path không? |
| Retry | Model, read, human-wait và write-effect có policy khác nhau không? |
| Concurrency | Worker cũ có bị fence khỏi commit state không? |
| Waiting | Delay dài có được biểu diễn bằng durable event hoặc timer không? |
| Versioning | History cũ có sống sót sau deploy không? |
| Recovery | Operator có thấy workflow stuck, expired, escalated và cancelled không? |

Durable execution không phải một lớp thần kỳ làm agent đúng. Nó là cách có kỷ luật để giữ runtime state tồn tại trong khi mọi thứ xung quanh thay đổi. Khi workflow có thể resume, cuộc trao đổi kỹ thuật trở nên rõ hơn: decision nào đã xảy ra, evidence nào hỗ trợ, effect nào đã confirm và step nào an toàn để thử tiếp.

Distributed system sẽ lỗi. Provider sẽ lỗi. Worker sẽ biến mất. Con người sẽ mất nhiều ngày mới trả lời. Agent đáng tin cậy không phải agent tránh được mọi sự thật đó. Nó là agent biến chúng thành state rõ ràng, transition có giới hạn và công việc có thể phục hồi.

## Tài liệu tham khảo

[1]: [Temporal — The definitive guide to Durable Execution](https://temporal.io/blog/what-is-durable-execution)
[2]: [Do Quoc Viet — Agent handover architecture](/blog/agent-handover-architecture)
[3]: [Do Quoc Viet — Exactly-once effects for AI agents](/blog/agent-evals-regression-suite)
[4]: [Do Quoc Viet — Regression evals for tool-calling agents](/blog/agent-evals-regression-suite)
