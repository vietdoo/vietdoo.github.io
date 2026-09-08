---
title: "Quản trị thay đổi cho AI Agent: Phát hiện Drift trước khi Action hỏng"
description: "Playbook production để phát hiện drift ở tool, policy, schema, permission và world state trước khi AI agent biến một plan từng hợp lệ thành action hỏng hoặc không an toàn."
pubDate: 2026-04-22
category: "engineering"
image: "/blog/ai-agent-drift/hero.webp"
lang: "vi"
translationKey: "ai-agent-drift-management"
draft: false
---

![AI agent đối chiếu plan đã lưu với tool, policy, permission và world state đang thay đổi trước khi thực hiện action](/blog/ai-agent-drift/hero.webp)

Sự cố nhìn bề ngoài giống như một tool bị lỗi.

AI agent được yêu cầu cập nhật địa chỉ giao hàng của khách. Nó tìm đúng record, chọn đúng tool và tạo ra một plan vượt qua schema validation. Workflow sau đó phải chờ vì một đợt deploy. Khi worker resume, tool vẫn tồn tại và JSON vẫn trông hoàn toàn hợp lệ.

Dù vậy, request vẫn thất bại. Fulfillment service đã thay đổi contract của địa chỉ trong khoảng thời gian từ lúc plan đến lúc execute: field cũ vẫn được chấp nhận, nhưng ý nghĩa đã chuyển từ “địa chỉ giao hàng” thành “địa chỉ ưu tiên”. Agent không hallucinate. Nó đã thực thi một plan trong khi môi trường xung quanh âm thầm drift.

Phân biệt này rất quan trọng. Hallucination là vấn đề trong output của model. **Drift là vấn đề trong mối quan hệ giữa một quyết định từng hợp lệ và hệ thống nơi quyết định đó cuối cùng được thực thi.** Tool thay đổi. Policy đổi. Permission bị thu hồi. Prompt template được chỉnh sửa. Retrieval index được refresh. Cấu hình tenant thay đổi. Payment, order hoặc document chuyển sang state mới trong lúc agent đang suy nghĩ.

> **Luận điểm chính:** Hãy coi mỗi plan của agent là một proposal có version, có thời hạn, có dependency manifest và có preflight check. Đừng bắt model tự nhận biết mọi thay đổi của môi trường. Hãy để application phát hiện drift rồi chọn refresh, replan, downgrade hoặc refuse.

Đây là bài toán change management với một failure mode mang hình dáng AI. Hệ thống không cần đóng băng mọi dependency. Nó cần biết thay đổi nào còn tương thích với action đã đề xuất, thay đổi nào làm plan mất hiệu lực và thay đổi nào cần con người quyết định.

## Drift không chỉ có một loại

Nhiều team dùng “drift” như từ đồng nghĩa với việc chất lượng model suy giảm. Với một agent có thể gọi tool và thay đổi external state, cách hiểu đó quá hẹp. Một taxonomy hữu ích nên bắt đầu từ dependency đã thay đổi.

| Loại drift | Điều gì đã thay đổi? | Ví dụ | Mặc định an toàn |
|---|---|---|---|
| Tool-contract drift | Tên, schema, enum, validation hoặc semantics của side effect thay đổi. | `address` giờ có nghĩa là địa chỉ đã lưu, không phải đích giao hàng. | Reject hoặc chuyển qua adapter tương thích. |
| Policy drift | Rule, threshold, yêu cầu approval hoặc effective date thay đổi. | Refund vượt ngưỡng mới cần human approval. | Đánh giá policy lại trước khi commit. |
| Permission drift | Identity, tenant scope, token, role hoặc delegation thay đổi. | User bị mất quyền trong lúc run đang pause. | Từ chối action và ghi nhận kết quả authorization mới. |
| Prompt/model drift | Model version, system instruction, tool description hoặc routing policy thay đổi. | Cùng request nhưng được plan dưới instruction mới. | Gắn nhãn run và chạy eval hoặc replan. |
| Data/retrieval drift | Evidence, index, source version hoặc freshness thay đổi. | Sản phẩm bị ngừng bán sau retrieval nhưng trước purchase. | Refresh evidence cho quyết định quan trọng. |
| World-state drift | Target resource bị hệ thống khác thay đổi. | Order chuyển từ `editable` sang `locked`. | So sánh version và revalidate ở write boundary. |
| Operational drift | Latency, capacity, region, queue hoặc outage thay đổi. | Tool chỉ còn chạy được qua fallback đang degraded. | Chạy capability và risk gate trước khi tiếp tục. |

Các nhóm này có thể chồng lên nhau. Một policy deployment có thể làm thay đổi permission cần thiết. Một schema change có thể mở ra side effect mới. Một retrieval refresh có thể cho thấy recommendation cũ không còn đúng. Mục đích của taxonomy không phải là tạo bảy dashboard. Mục đích là buộc hệ thống khai báo rõ **thay đổi nào sẽ invalidate plan**.

![Bản đồ drift nhiều lớp nối tool contract, policy, permission, data, model và world state vào một agent plan](/blog/ai-agent-drift/drift-map.webp)

## Plan cần một dependency manifest

Phần lớn agent system checkpoint message và tool arguments. Như vậy chưa đủ để plan có thể reproducible. Plan là hàm của input và environment, vì thế phải lưu các version có thể làm thay đổi ý nghĩa của nó.

```ts
type DependencyManifest = {
  toolContracts: Array<{
    tool: string;
    contractVersion: string;
    semanticHash: string;
  }>;
  policyBundles: Array<{
    policyId: string;
    version: string;
    effectiveAt: string;
  }>;
  permissionSnapshot: {
    principalId: string;
    tenantId: string;
    scopes: string[];
    delegationVersion: string;
  };
  modelContext: {
    modelId: string;
    systemPromptVersion: string;
    routerPolicyVersion: string;
  };
  evidence: Array<{
    evidenceId: string;
    sourceVersion: string;
    observedAt: string;
    expiresAt: string;
  }>;
  targetVersions: Array<{
    resource: string;
    version: string;
  }>;
};

type AgentPlan = {
  planId: string;
  createdAt: string;
  validUntil: string;
  riskClass: "low" | "medium" | "high" | "critical";
  dependencyManifest: DependencyManifest;
  steps: Array<{ tool: string; args: unknown }>;
  revalidation: Array<RevalidationRule>;
};
```

Manifest không phải là prompt transcript. Nó là tuyên bố cô đọng về những gì application phải kiểm tra trước khi cho phép side effect. Hạn chế đưa nội dung nhạy cảm vào manifest trừ khi chính nội dung đó là dependency. Với schema hoặc policy lớn, có thể lưu hash; nhưng vẫn phải giữ version identifier có thể truy xuất để operator xem được artifact chính xác.

Semantic Versioning là một quy ước hữu ích cho public API: thay đổi không tương thích nên tăng major version, còn bổ sung và sửa lỗi tương thích có thể dùng minor hoặc patch version.[1] Tuy nhiên, agent platform không nên mặc định rằng version number tự chứng minh compatibility. Tool có thể giữ nguyên JSON schema nhưng đổi semantics của side effect. Vì thế, hãy lưu cả declared contract version và machine-checkable semantic fingerprint cho các phần thực sự ảnh hưởng đến action.

## Compatibility là một matrix, không phải boolean

Một plan không chỉ đơn giản là match hoặc mismatch với environment hiện tại. Mỗi loại thay đổi có hậu quả khác nhau đối với từng step.

| Thay đổi quan sát được | Read-only lookup | Draft response | Reversible write | Irreversible action |
|---|---:|---:|---:|---:|
| Thêm optional field vào tool | Thường tương thích | Thường tương thích | Tương thích sau adapter test | Revalidate |
| Đổi tên hoặc đổi nghĩa field | Replan | Replan | Reject plan cũ | Reject plan cũ |
| Threshold của policy mới | Refresh policy | Refresh policy | Re-authorize | Human hoặc policy gate |
| Permission scope bị thu hẹp | Re-check | Re-check | Refuse nếu thiếu scope | Refuse |
| Target version thay đổi | Refresh nếu material | Refresh nếu material | Compare-and-swap | Refuse hoặc escalate |
| Model hoặc prompt version đổi | Chỉ tag | Re-evaluate nếu nhạy về quality | Replan nếu risk cao | Replan và approve lại |
| Evidence hết hạn | Refresh | Refresh | Refresh ngay lập tức | Refresh và final invariant |

Matrix này cố ý thận trọng với các thay đổi của external state. Plan chỉ format một response thường có thể sống qua prompt patch. Plan charge card hoặc delete data không nên được hưởng cùng mức tolerance.

Kết quả của compatibility check phải có cấu trúc. “Trông có vẻ ổn” không phải là production state hữu ích.

```ts
type DriftDecision =
  | { kind: "continue"; checkedAt: string }
  | { kind: "refresh"; dependencies: string[]; reason: string }
  | { kind: "replan"; changed: string[]; reason: string }
  | { kind: "downgrade"; allowedAction: string; reason: string }
  | { kind: "refuse"; reasonCode: string; humanMessage: string };
```

Application phải sở hữu quyết định này. Model có thể giải thích refusal hoặc đề xuất plan mới, nhưng không được override policy, permission, version hay fencing check đã fail chỉ bằng cách tạo ra những đoạn prose tự tin hơn.

## Phát hiện drift ở boundary quan trọng

Không có lợi ích gì khi so sánh mọi dependency trước mỗi token. Có lợi ích khi kiểm tra những dependency có thể invalidate transition có ý nghĩa tiếp theo.

Boundary đầu tiên là **trước khi planning**. Load tool catalog, policy bundle, identity scope và evidence contract hiện tại. Nhờ vậy agent không plan dựa trên mô tả capability đã cũ.

Boundary thứ hai là **sau khi planning**. Lưu dependency manifest cùng plan. Đây vừa là audit record, vừa là target chính xác cho executor so sánh.

Boundary thứ ba là **trước mỗi high-impact tool call**. Workflow dài có thể gồm nhiều read an toàn rồi mới đến một irreversible write. Chỉ check ở đầu workflow là chưa đủ. Side-effect boundary cuối cùng phải verify permission, policy, resource version, freshness, lease ownership và tool semantics.

Boundary thứ tư là **sau pause hoặc retry**. Worker resume không tiếp tục trong cùng một thế giới. Nó quay lại một thế giới có thể đã thay đổi trong lúc vắng mặt.

```ts
async function preflight(plan: AgentPlan): Promise<DriftDecision> {
  const current = await loadCurrentEnvironment(plan.dependencyManifest);
  const changed = compareManifest(plan.dependencyManifest, current);

  if (changed.some((item) => item.blocks(plan.riskClass))) {
    return { kind: "replan", changed: changed.map((item) => item.name), reason: "blocking_drift" };
  }

  const expired = changed.filter((item) => item.requiresRefresh);
  if (expired.length > 0) {
    return { kind: "refresh", dependencies: expired.map((item) => item.name), reason: "refreshable_drift" };
  }

  return { kind: "continue", checkedAt: new Date().toISOString() };
}
```

Check nên đủ nhẹ để chạy thường xuyên và đủ chặt để chặn unsafe transition. Điều đó thường có nghĩa là duy trì version record nhỏ, queryable cho tool contract, policy bundle, permission và target resource thay vì diff toàn bộ database mỗi lần execute.

## Tool description cần release discipline

Tool description là một phần của executable interface của agent. Nó nói cho model biết tool làm gì, nhận argument nào, error có nghĩa gì và operation có reversible hay không. Vì vậy, sửa description gần với đổi API contract hơn là sửa copy trong help center.

Với mỗi tool, hãy duy trì release record tối thiểu gồm:

| Field | Vì sao quan trọng |
|---|---|
| Stable tool identifier | Cho phép plan tham chiếu capability mà không phụ thuộc display text. |
| Contract version | Tạo compatibility anchor rõ ràng. |
| Input/output schema hash | Phát hiện structural change. |
| Side-effect classification | Phân biệt read, reversible write và irreversible action. |
| Error taxonomy version | Ngăn retry logic hiểu sai failure mode mới. |
| Rollout state | Cho phép shadow, canary, tenant allowlist và rollback. |
| Deprecation deadline | Ngăn plan cũ chạy vô thời hạn. |

Schema change tương thích không tự động đồng nghĩa với behavior change tương thích. Hãy thêm contract test cho semantic invariant: lookup không được mutate state; cancellation không được target resource khác; empty result không được hiểu là success; retryable error phải phân biệt với committed-but-unknown outcome.

Các bài viết về tool contract testing đã có trên folio là phần đọc song hành tự nhiên. Điểm mới ở đây không phải provider có thể gọi tool hôm nay hay không. Câu hỏi mới là: **plan tạo hôm qua còn được phép gọi tool hôm nay hay không?**

## Policy cần có effective time và precedence

Policy drift đặc biệt nguy hiểm vì plan cũ vẫn có thể execute về mặt kỹ thuật. Hệ thống có thể chấp nhận request trong khi vi phạm rule đã có hiệu lực giữa workflow.

Hãy biểu diễn policy dưới dạng versioned, effective-dated bundle thay vì chỉ lưu plain text.

```ts
type PolicyBundle = {
  policyId: string;
  version: string;
  effectiveAt: string;
  expiresAt?: string;
  priority: number;
  rules: Array<{
    action: string;
    condition: string;
    effect: "allow" | "deny" | "require_approval";
  }>;
  supersedes?: { policyId: string; version: string };
};
```

Khi execute, hãy evaluate policy có hiệu lực tại commit timestamp của action, không chỉ policy tồn tại lúc model bắt đầu suy nghĩ. Nếu policy bundle đã đổi, giữ quyết định cũ trong history nhưng không âm thầm dùng authorization cũ cho side effect mới.

Policy precedence cũng phải deterministic. Tenant-specific restriction không được biến mất chỉ vì general product policy được load sau. Deny rule không được biến thành model suggestion. Nếu hệ thống không giải thích được policy nào thắng và tại sao, policy layer chưa sẵn sàng để điều khiển autonomous action.

## World-state drift cần compare-and-swap

Agent plan thường có assumption như “order version là 18” hoặc “document status là `pending_review`”. Hãy mang assumption đó đến write boundary và để storage layer enforce nó.

```sql
UPDATE orders
SET delivery_address = :new_address,
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = :order_id
  AND version = :expected_version
  AND status = 'editable';
```

Nếu số affected row bằng zero, action chưa chứng minh được precondition. Đừng bắt model đoán xem update có lẽ đã thành công. Hãy trả về typed conflict, load resource lại và quyết định xem plan mới có an toàn hay không.

Pattern này không chỉ là database optimization. Nó biến world-state drift thành một state transition có giới hạn. Agent có thể thông minh trong việc chọn path mới, nhưng commit boundary vẫn nên boring và deterministic.

![Preflight gate so sánh plan fingerprint và version hiện tại trước khi route run sang continue, refresh, replan, downgrade hoặc refuse](/blog/ai-agent-drift/preflight-gate.webp)

## Không phải drift nào cũng cần full replan

Phản ứng thái quá với mọi thay đổi sẽ tạo thêm latency và cost không cần thiết. Phản ứng quá nhẹ với thay đổi quan trọng lại tạo unsafe execution. Hãy dùng graduated response.

**Continue** khi thay đổi được chứng minh là tương thích, action có risk thấp và evidence liên quan vẫn fresh. Ghi nhận những gì đã được check.

**Refresh** khi dependency stale nhưng intent và action contract của plan vẫn còn hợp lệ. Retrieve policy hiện tại, đọc lại target hoặc fetch tool metadata mới, sau đó chạy lại validation bị ảnh hưởng.

**Replan** khi dependency thay đổi ảnh hưởng đến nghĩa của argument, allowed outcome, target resource hoặc action sequence. Replan phải tạo plan version mới thay vì mutate plan cũ.

**Downgrade** khi hệ thống có thể cung cấp một action ít quyền lực hơn nhưng vẫn an toàn. Ví dụ, nếu purchase commitment không thể validate, agent có thể trình bày các lựa chọn hoặc lưu draft thay vì submit order.

**Refuse hoặc escalate** khi action irreversible, authorization bị thiếu, policy mơ hồ hoặc hệ thống không chứng minh được current state đáng tin.

![Response ladder gồm continue, refresh, replan, downgrade và refuse, tăng dần mức thận trọng trước drift](/blog/ai-agent-drift/response-ladder.webp)

UX nên làm cho các kết quả này dễ hiểu. “Tôi dừng lại vì order đã thay đổi trong lúc chờ; đây là state hiện tại” tốt hơn một tool error chung chung. Thông báo không cần lộ policy nội bộ nhạy cảm, nhưng phải cho user biết bước tiếp theo hữu ích.

## Đo drift như một operational signal

Drift detector chỉ biết block action rồi sẽ bị disable vì “quá ồn”. Hãy đo nó như một reliability signal cấp một.

| Metric | Nó cho biết điều gì? |
|---|---|
| Drift detection rate theo workflow | Workflow nào phụ thuộc vào contract không ổn định hoặc thời gian chờ dài. |
| Blocking drift rate | Bao nhiêu plan suýt vượt qua unsafe boundary. |
| Refresh success rate | Drift có thể được giải quyết mà không cần full replan hay không. |
| Replan conversion rate | Dependency thay đổi thường làm action path đổi đến mức nào. |
| Safe downgrade rate | Product có fallback hữu ích mà không commit hay không. |
| Refusal và escalation rate | Policy, authorization hoặc evidence đang mơ hồ ở đâu. |
| Stale-plan execution attempts | Worker có bypass preflight gate hay không. |
| Time từ dependency release đến agent rollout | Tool và policy change có propagation được kiểm soát không. |

Mục tiêu không phải đưa drift về zero. Change là bình thường trong production system. Mục tiêu là làm change visible, phân loại đúng và ngăn phần nguy hiểm trở thành side effect không được review.

Điều này quan trọng vì controlled evaluation không dự đoán đầy đủ behavior trong environment đang thay đổi. International AI Safety Report 2026 mô tả một evaluation gap: pre-deployment test không đủ đáng tin để xác lập utility hoặc risk trong thế giới thực, trong khi autonomous operation làm việc intervention khó hơn khi failure xảy ra.[3] Drift management là một phản hồi thực tế cho khoảng trống đó. Nó bổ sung check ở nơi agent gặp live system thay vì giả định rằng một test thành công sẽ chứng minh compatibility vĩnh viễn.

## Rollout mà không đóng băng platform

Bắt đầu bằng observation mode. Tính manifest, compare version và emit decision nhưng chưa block low-risk action. Dùng kết quả để nhận ra dependency nào thực sự thường thay đổi và alert nào chỉ là noise.

Tiếp theo, enforce hard gate cho high-impact write. Yêu cầu permission hiện tại, policy đang có hiệu lực, target version, evidence fresh và tool-contract compatibility trước khi commit. Giữ plan cũ immutable cho audit và tạo plan mới khi replan.

Sau đó tích hợp với release. Mỗi tool hoặc policy deployment nên publish contract version, compatibility note, workflow bị ảnh hưởng và rollback status. Agent platform phải trả lời được: active plan nào đang phụ thuộc artifact này, và plan nào cần pause?

Cuối cùng, test negative path. Đổi policy trong lúc run đang chờ. Thu hồi delegated scope. Thay tool bằng contract không tương thích ngược. Sửa target resource sau khi planning. Làm evidence hết hạn. Kill worker trước final write. Kết quả kỳ vọng phải là typed refresh, replan, downgrade, refusal hoặc escalation—not best-effort action.

## Kết luận: plan không phải authority

Agent plan hữu ích vì nó ghi lại intent. Nó trở nên nguy hiểm khi hệ thống nhầm captured intent với current authority.

Production boundary nên rõ ràng: model đề xuất, manifest ghi nhận dependency, detector so sánh version, policy layer quyết định điều được phép và storage hoặc tool gateway enforce invariant cuối cùng. Sự phân tách đó cho phép agent thích nghi mà không biến mọi environmental change thành một bài toán prompt engineering.

Agent đáng tin cậy nhất không phải agent nhất quyết bảo vệ plan ban đầu. Đó là agent có thể nói, dựa trên evidence: **“Thế giới đã thay đổi; đây là bước tiếp theo an toàn nhất.”**

## References

[1]: https://semver.org/ "Semantic Versioning 2.0.0"
[2]: https://kubernetes.io/docs/concepts/workloads/pods/probes/ "Kubernetes Documentation — Liveness, Readiness, and Startup Probes"
[3]: https://internationalaisafetyreport.org/publication/international-ai-safety-report-2026 "International AI Safety Report 2026"

## Đọc thêm

- [State-Aware Browser Agents: Verifying the World Before Every Click](/blog/state-aware-browser-agents)
- [AI Agents Have a Clock: Deadlines, Leases, and Stale Plans](/blog/ai-agent-time-semantics)
- [Contract Testing for AI Tools: Proving an Agent Can Safely Call the Same Capability Across Providers](/blog/contract-testing-ai-tools)
- [Human-in-the-Loop Is Not an Approve Button: Designing Action Gates Without Consent Fatigue](/blog/human-in-the-loop-action-gates)
