---
title: "Thử nghiệm Release cho AI Agent: Shadow Traffic, Counterfactual Replay và Promotion Gate"
description: "Production playbook cho việc thay đổi model, prompt, tool, retrieval và policy mà không biến người dùng thật thành bộ phận kiểm thử. Bài viết trình bày offline eval, shadow traffic, counterfactual replay, canary cohort và promotion gate theo hướng abort-first."
pubDate: 2026-07-24
category: "engineering"
image: "/blog/ai-agent-release-experiments/hero.webp"
lang: "vi"
translationKey: "ai-agent-release-experiments"
draft: false
---

![Bảng release vẽ tay dẫn AI agent qua production, shadow traffic, replay, canary và các cổng promote hoặc abort](/blog/ai-agent-release-experiments/hero.webp)

Lần đầu tôi thấy một lần release model đi sai, dashboard vẫn xanh.

Latency giảm. Token usage giảm. Prompt mới tạo ra câu trả lời ngắn hơn, còn tỷ lệ thumbs-up chưa thay đổi đủ nhiều để bật cảnh báo. Chúng tôi promote cho toàn bộ người dùng.

Vài giờ sau, support bắt đầu nhận ticket. Agent vẫn lịch sự và vẫn trả lời được phần lớn câu hỏi. Nó chỉ trở nên ít sẵn sàng hơn trong việc hỏi một câu clarifying trước khi thay đổi account. Một thay đổi nhỏ trong prompt đã dịch chuyển ranh giới giữa “tôi hiểu intent” và “tôi đang đoán.” System metrics xanh vì hệ thống nhanh hơn. Business behavior thì không.

Incident đó thay đổi cách tôi nhìn về release cho AI product. Release không chỉ là container mới hay một model name mới. Nó có thể là prompt revision, retrieval index, tool schema, routing policy, safety classifier, memory rule, hoặc một tổ hợp của tất cả những thứ đó. Mỗi thay đổi đều làm xác suất agent hành động theo một cách khác đi.

> **Thesis:** Đừng để người dùng thật phát hiện một thay đổi AI có an toàn hay không. Hãy coi behavior là một release artifact, so sánh nó qua những experiment ngày càng gần production, và biến promotion thành một quyết định có thể đảo ngược với safety gate rõ ràng.

Bài viết này trình bày một chuỗi thực dụng: offline evaluation, shadow traffic không tạo side effect, counterfactual replay, canary cohort nhỏ và promotion có kiểm soát. Mục tiêu không phải biến agent thành deterministic. Mục tiêu là làm uncertainty lộ ra trước khi nó trở thành customer incident.

## Release unit lớn hơn model

Ngôn ngữ deployment truyền thống thường khuyến khích một câu hỏi hẹp: binary nào đang chạy? Với AI agent, câu trả lời đó là chưa đủ. Behavior người dùng nhìn thấy có thể phụ thuộc vào một bundle gồm nhiều version và runtime decision.

| Thành phần release | Điều có thể thay đổi | Failure thường đi kèm |
|---|---|---|
| Model | reasoning style, tool selection, refusal boundary, độ dài câu trả lời | Request an toàn bị từ chối, hoặc request rủi ro lại được chấp nhận |
| Prompt và policy | thứ tự ưu tiên, định nghĩa, hướng dẫn escalation | Agent ngừng hỏi thông tin còn thiếu |
| Retrieval index | chunk, ranking, freshness, metadata filter | Câu trả lời nghe hợp lý nhưng dựa trên evidence cũ |
| Tool schema | name, required field, description, enum value | Agent chọn nhầm capability hoặc gửi argument sai format |
| Router | model/provider được chọn, fallback rule, budget | Request khó âm thầm chạy bằng route yếu hơn |
| Memory policy | thứ gì được recall, summarize, expire hoặc scope | Context cũ lấn át intent hiện tại |
| Safety layer | classifier, allowlist, approval threshold | Cùng một output nhưng action decision khác nhau |

Vì vậy release identifier nên là một bundle bất biến, không phải một model label rời rạc.

```ts
type AgentRelease = {
  releaseId: string;          // e.g. agent-2026-07-24.3
  model: string;
  promptRevision: string;
  toolSchemaRevision: string;
  retrievalRevision: string;
  policyRevision: string;
  routerRevision: string;
};
```

Khi có incident, câu “chúng tôi vừa upgrade model” không đủ để reproduce. Hệ thống phải trả lời được request đã đi qua bundle nào, evidence nào được retrieve, tool nào có thể dùng, policy nào đưa ra quyết định và outcome nào đã được commit.

Điều đó không có nghĩa mọi release đều cần một platform nặng nề. Nó có nghĩa ranh giới release phải được đặt tên trước khi experiment bắt đầu. Nếu không, team sẽ so sánh hai moving target rồi gọi kết quả đó là test.

## Năm mode, năm câu hỏi khác nhau

Offline eval, shadow traffic, replay, canary và full rollout thường được mô tả như một chiếc thang progressive. Chúng liên quan với nhau, nhưng mỗi mode trả lời một câu hỏi khác.

![Ba experiment mode tách fixed offline task, shadow traffic không side effect và canary có guarded write](/blog/ai-agent-release-experiments/experiment-modes.webp)

| Mode | Câu hỏi | Thứ gì là thật | Thứ gì phải cô lập |
|---|---|---|---|
| Offline eval | Candidate có thỏa contract đã biết không? | Dataset và grader | Production identity, live write, private data |
| Shadow traffic | Nó phản ứng thế nào với hình dạng request ngoài đời? | Phân phối request và timing | Response người dùng nhìn thấy và side effect |
| Counterfactual replay | Cùng evidence đã ghi nhận, candidate lẽ ra sẽ làm gì? | Context, tool result, policy state | External call và world state mới |
| Canary | Nó có đứng vững với một nhóm user nhỏ không? | User experience và effect được scope kỹ | Blast radius, high-risk action, irreversible write |
| Full rollout | Candidate đã đủ làm default mới chưa? | Production bình thường | Rollback path và stable reference |

Một kỷ luật hữu ích là viết exit condition cho từng mode trước khi chạy. “Model mới có vẻ tốt hơn” không phải exit condition. “Không có critical safety invariant nào regression, p95 latency nằm trong budget và candidate cải thiện task completion trên target slice” thì có thể đo được, dù phép đo vẫn không hoàn hảo.

Hướng dẫn eval của OpenAI nhấn mạnh task-specific test, data có hình dạng production, continuous evaluation và human calibration thay vì một score chung chung. Hướng dẫn đánh giá agent của Anthropic cũng tách transcript khỏi final environment outcome, đồng thời khuyến nghị kết hợp code-based, model-based và human grader. Những ý tưởng đó quan trọng ở đây vì release có thể nghe hay hơn nhưng vẫn để lại database state sai.

## Bắt đầu với release ledger

Trước khi gửi traffic đi đâu đó, hãy tạo release ledger. Đây là tài liệu hơi buồn tẻ nhưng giúp một rollout đầy tự tin không biến thành một cuộc khảo cổ.

```ts
type ReleaseLedger = {
  releaseId: string;
  baselineReleaseId: string;
  owner: string;
  hypothesis: string;
  targetSlices: string[];
  excludedSlices: string[];
  allowedEffects: "none" | "reversible" | "scoped";
  hardStops: string[];
  softSignals: string[];
  samplePlan: string;
  startAt: string;
  expiresAt: string;
};
```

Hypothesis phải đủ cụ thể để có thể thất bại. Ví dụ: “Trên billing question bằng tiếng Việt, với policy document hiện tại, release `agent-2026-07-24.3` sẽ giảm escalation không cần thiết mà không làm tăng unsupported claim hoặc unauthorized tool call.” Câu này hữu ích hơn nhiều so với “prompt mới cải thiện quality.”

Hãy định nghĩa slice trước khi xem kết quả. Language, tenant tier, request type, tool surface, risk class và conversation length đều có thể làm thay đổi kết luận. Nếu team tạo slice sau khi thấy chart, lúc nào cũng có thể tìm ra một segment xanh.

Ledger cũng phải ghi rõ candidate không được làm gì. Shadow run có thể gửi email thì không phải shadow run; đó là một production system chạy song song. Replay query giá cổ phiếu của hôm nay thì không phải counterfactual replay; đó là một quan sát external mới có thể làm thay đổi kết luận.

## Offline eval là bộ lọc, không phải lời tiên tri

Offline evaluation là nơi rẻ nhất để reject một release. Nó cũng là nơi dễ tạo cảm giác tự tin quá mức nhất.

Một suite nhỏ có thể kiểm tra tool selection, argument validity, policy adherence, groundedness, end-state correctness, latency, token use và cost. Contract deterministic thì dùng deterministic check. Khi nhiều câu trả lời đều có thể chấp nhận, dùng rubric hoặc pairwise comparison. Với case mà false pass rất đắt, hãy thêm human review.

```yaml
release: agent-2026-07-24.3
baseline: agent-2026-07-08.2
suite:
  - name: billing-intent
    graders:
      - type: classification
        expect: billing_question
      - type: tool_calls
        forbid: refund_payment
      - type: rubric
        require: asks_for_missing_invoice_id
  - name: grounded-answer
    graders:
      - type: citation_check
      - type: state_check
        expect: no_external_write
  - name: safety-boundary
    graders:
      - type: policy_invariant
        require: high_risk_action_requires_approval
thresholds:
  critical_safety_regressions: 0
  task_success_delta: ">= 0"
  p95_latency_delta: "<= 15%"
```

Đừng thu gọn release decision thành một average score. Một release cải thiện FAQ dễ thêm hai điểm nhưng tạo ra một unauthorized side effect thì không phải net improvement. Hãy đặt invariant không thể thương lượng cao hơn weighted quality score.

Repeated trial quan trọng vì agent behavior thay đổi giữa các lần chạy. Candidate có thể pass một task nhờ chọn đúng route một cách may mắn rồi fail ở lần kế tiếp. Với task high-stakes, hãy theo dõi cả outcome trung bình lẫn độ nhất quán. Nếu financial action cần thành công ổn định, pass-at-least-once đẹp mắt là chưa đủ.

Offline eval cho biết candidate xử lý thế nào với những case ta đã biết. Nó không cho biết candidate phản ứng ra sao với cách diễn đạt dài đuôi trong production, context cũ, tool result kỳ quặc, retry hoặc tổ hợp policy riêng của một tenant. Vì vậy bước tiếp theo là một live-shaped experiment không tạo user impact.

## Shadow traffic là traffic thật nhưng effect đã bị gỡ bỏ

Một shadow test đúng nghĩa copy input sang candidate, trong khi chỉ stable route trả response cho calling application. AWS mô tả shadow testing là cách so sánh một variant đã deploy với infrastructure hiện tại, gồm cả operational metric như latency và error rate, mà không gây end-user impact.

Với agent, “không gây user impact” cần được định nghĩa chặt hơn việc “không hiển thị candidate answer.” Candidate không được gửi email, sửa CRM, reserve inventory, charge tiền hay để tool result riêng tư rơi vào shared log. Side-effect boundary phải nằm ở tool gateway, không chỉ ở UI.

```ts
async function handleRequest(input: UserInput) {
  const stable = runAgent({
    input,
    release: stableRelease,
    mode: "production",
    effects: "allowed",
  });

  void runAgent({
    input: redactForExperiment(input),
    release: candidateRelease,
    mode: "shadow",
    effects: "disabled",
    toolAdapter: replayOrStubTools,
  }).catch((error) => recordShadowFailure(error));

  return stable;
}
```

Shadow path nên nhận đủ context để lộ behavior thật, nhưng không nhận nhiều dữ liệu hơn mức experiment cần. Dùng tenant-aware sampling, redaction, retention limit và experiment identifier. Shadow request vẫn xử lý content có nguồn từ customer; việc không trả response cho user không biến dữ liệu đó thành vô hại.

Hãy ghi lại candidate tool intent ngay cả khi execution bị block. “Candidate có lẽ sẽ gọi `refund_payment` với amount 149000” là evidence hữu ích. “Candidate tạo ra một response” không đủ để giải thích safety regression.

Shadow traffic đặc biệt tốt trong việc tìm operational difference: latency tail, token spike, prompt quá lớn, provider error, tool-schema incompatibility và route selection ngoài dự kiến. Nó yếu hơn trong việc đo user satisfaction vì user chưa từng nhìn thấy candidate. Nó cũng không phải bằng chứng rằng write sẽ đúng; write đã bị cố ý block.

## Counterfactual replay đặt câu hỏi “nếu như?” mà không đổi thế giới

Production trace không tự động replay được. Nó có thể chứa prompt nhưng thiếu retrieved context chính xác, có tool call nhưng thiếu tool response, hoặc có response mà không có policy version đã cho phép. Một replay envelope hữu ích ghi lại các input quyết định behavior, đồng thời bỏ secret và identifier không ổn định.

![Recorded envelope đưa candidate agent qua các tool result được replay và comparison ledger, trong khi no-external-writes boundary ngăn side effect mới](/blog/ai-agent-release-experiments/counterfactual-replay.webp)

```ts
type ReplayEnvelope = {
  traceId: string;
  intentClass: string;
  redactedInput: unknown;
  retrievedEvidence: Evidence[];
  toolResults: Record<string, unknown>;
  policyRevision: string;
  baselineRelease: string;
  baselineOutcome: Outcome;
  recordedAt: string;
};
```

Từ “counterfactual” hữu ích vì candidate đang trả lời một câu hỏi về một thế giới thay thế: release này sẽ làm gì nếu nhìn thấy cùng request và cùng tool observation? Replay không được âm thầm thay recorded data bằng current data. Nếu làm vậy, experiment đang trộn release behavior với world change.

Hãy so sánh ở bốn lớp.

| Lớp so sánh | Ví dụ kiểm tra | Ý nghĩa cho quyết định |
|---|---|---|
| Deterministic | JSON schema, required field, forbidden tool | Hard contract đã đổi hoặc bị phá |
| Semantic | Intent, answer coverage, citation support | Candidate có thể tốt hoặc kém hơn về meaning |
| Safety | Approval requirement, tenant scope, effect class | Critical invariant được giữ hay bị vi phạm |
| Operational | Số turn, latency ước tính, token, cost band | Candidate có thể quá chậm hoặc quá đắt |

Với semantic check, hãy dùng rubric hẹp và giữ một sample đã được human calibrate. Evaluator có thể ưu tiên câu trả lời dài, nhầm confidence với correctness hoặc bỏ lỡ final state sai. So sánh candidate với baseline trên cùng envelope, và giữ disagreement để review thay vì nén mọi thứ thành một “quality score.”

Replay cũng là nơi team phát hiện mình chưa lưu đủ evidence. Đó không phải lý do để log mọi thứ mãi mãi. Đó là lý do phải định nghĩa minimum replay contract: redacted input, evidence reference hoặc snapshot liên quan, tool result class, policy và release version, cùng business outcome cuối cùng.

## Canary user không phải vật hy sinh ngẫu nhiên

Sau offline và shadow check, canary expose candidate cho một cohort có kiểm soát. Cohort có thể chọn theo tenant, feature flag, internal user, geography, request class hoặc stable hash. Quy tắc chọn cohort là một phần của experiment vì canary chỉ gồm internal prompt thân thiện sẽ không đại diện cho traffic khó nhất.

Các hệ thống progressive delivery thường biểu diễn canary bằng chuỗi traffic weight và pause, trong đó analysis quyết định rollout có đi tiếp hay bị abort. Ý tưởng này dùng được cho agent, nhưng metric phải bao gồm behavior và effect, không chỉ HTTP health.

```text
candidate  ->  1%  -> pause + analyze
                 | green
                 v
              5%   -> pause + analyze
                 | green
                 v
             25%   -> pause + analyze
                 | green
                 v
            100%   -> keep rollback reference
```

Hãy bắt đầu với cohort nhỏ nhưng có ý nghĩa, thay vì một con số quá bé không thể tạo ra evidence. Canary một phần trăm của workflow volume thấp có thể cần nhiều ngày mới nói được điều gì. Ngược lại, một phần trăm của financial action high-risk vẫn có thể quá lớn nếu effect không thể đảo ngược.

Guarded write cần policy riêng. Trong canary, chỉ cho phép reversible effect với compensating action rõ ràng, giữ high-risk action sau approval, và block bất cứ action nào chưa có reconciliation path. Đừng để safety của canary phụ thuộc vào việc mọi người có nhớ click đúng UI button hay không.

Stable release phải đủ “ấm” để nhận rollback ngay lập tức. Rollback không chỉ là đổi một model name. Có thể phải phục hồi prompt, router, tool schema, retrieval index và policy bundle đã tạo nên behavior trước đó.

## Promotion gate nên bất đối xứng

Quality thường là gradual signal. Safety thường không phải vậy. Một cải thiện nhỏ về helpfulness không thể bù cho một unauthorized write.

![Release decision board tách quality, safety, latency-cost và health gate; UNKNOWN đi tới human review, critical violation đi thẳng tới ABORT](/blog/ai-agent-release-experiments/promotion-gates.webp)

Mỗi gate nên có ít nhất ba outcome: continue, abort và unknown. “Unknown” không phải green. Nó có nghĩa evidence chưa đủ, data đến trễ hoặc hệ thống không thể xác nhận candidate an toàn. Hãy pause và giao cho một human owner có tên.

| Signal | Ví dụ promotion rule | Nếu fail |
|---|---|---|
| Critical safety invariant | Không có unauthorized side effect; không có cross-tenant evidence leak | Abort ngay |
| Task outcome | Protected task slice không regression; target slice đạt cải thiện đã nêu | Pause, inspect hoặc reject |
| Groundedness | Unsupported-claim rate dưới contract threshold | Pause và review sample |
| User experience | Resolution, escalation hoặc rework cải thiện trong confidence band | Continue thận trọng hoặc hold |
| Latency và cost | p95 và cost trên mỗi task thành công nằm trong budget | Pause, tune hoặc reject |
| Operational health | Không có pattern lỗi mới ở provider, tool, queue hay memory | Pause và điều tra |

Gate model này tránh được một lỗi phổ biến: biến mọi metric thành weighted average. Câu hỏi đúng không phải “score có tăng không?” mà là “invariant nào được phép đánh đổi với signal nào?”

Một decision record thực dụng có thể trông như sau:

```json
{
  "release": "agent-2026-07-24.3",
  "baseline": "agent-2026-07-08.2",
  "stage": "canary-5pct",
  "decision": "pause",
  "reason": "semantic_quality_unknown",
  "hardStops": { "unauthorized_effects": 0, "tenant_leaks": 0 },
  "observed": { "unauthorized_effects": 0, "tenant_leaks": 0 },
  "owner": "oncall-ai-platform",
  "nextAction": "human_review_40_sampled_traces"
}
```

Record nên append-only hoặc ít nhất phải audit được. Nếu team chỉnh threshold sau khi thấy một kết quả khó chịu, experiment đã thay đổi và phải được gắn nhãn như một decision mới.

## Abort trước, sau đó mới tìm hiểu nguyên nhân

Một release process không trưởng thành chỉ vì nó promote trơn tru. Nó trưởng thành khi abort không gây drama và để lại đủ evidence để giải thích quyết định.

Hãy định nghĩa hard stop trước khi experiment bắt đầu. Ví dụ: tool call trái phép, cross-tenant retrieval, data class bị cấm đi vào model context, high-risk approval tăng đột biến, external effect trùng lặp hoặc tool result không thể reconcile. Các điều kiện này phải dừng candidate ngay cả khi quality chart trông rất đẹp.

Soft signal có thể pause thay vì abort: latency tăng vừa phải, semantic comparison chưa rõ, cost tăng nhẹ hoặc escalation rate lệch baseline. Sự phân biệt này quan trọng vì không phải regression nào cũng cần cùng một blast-radius response.

Khi abort, hãy giữ candidate release và evidence của nó. Đừng xóa trace giải thích failure, nhưng cũng đừng giữ raw customer content vô thời hạn chỉ vì rollout đã fail. Lưu một evidence pack đã redact gồm release ledger, input hoặc reference được sample, policy decision, tool intent, outcome diff và gate chính xác đã bị kích hoạt.

## Trình tự rollout có thể dùng ngoài đời

Đầu tiên, đặt tên cho bundle và viết một hypothesis có thể bị bác bỏ. Đưa release ledger vào cùng change review với model, prompt, tool, retrieval hoặc policy change.

Tiếp theo, chạy offline suite nhỏ. Reject hard contract failure ngay. Dùng protected regression slice để team không thể cải thiện target behavior bằng cách âm thầm phá một behavior cũ quan trọng.

Sau đó, chạy shadow traffic với side-effect firewall chặt. Đo operational behavior và candidate tool intent, nhưng đừng giả vờ shadow result là user satisfaction.

Bước thứ tư là replay recorded envelope. So sánh baseline và candidate trên cùng evidence. Tách deterministic và safety check khỏi semantic judgment, đồng thời gắn nhãn unknown cho evidence còn thiếu.

Bước thứ năm, bắt đầu canary với cohort có ý nghĩa, guarded write rõ ràng, rollback target luôn sẵn sàng và pause window đủ dài để quan sát outcome đến trễ.

Bước thứ sáu, promote theo từng nấc chỉ khi hard gate xanh và soft signal đã được hiểu. Ở mỗi nấc, giữ bundle trước đó để rollback ngay.

Cuối cùng, đưa các canary case hữu ích trở lại regression suite. Release system phải học từ incident, user feedback và các sample disagreement. Một test suite không bao giờ thay đổi không phải safety net; nó là bảo tàng.

## Quy tắc tôi dùng từ đó

Model upgrade không an toàn chỉ vì benchmark tăng. Prompt không an toàn chỉ vì demo nghe hay hơn. Canary không an toàn chỉ vì chỉ một tỷ lệ nhỏ user nhìn thấy nó.

Một release đủ an toàn để promote khi team nói rõ được điều gì đã thay đổi, user và behavior nào đã được test, external effect nào là bất khả thi hoặc đã được guard, invariant nào không thể thương lượng, evidence nào hỗ trợ decision và làm sao quay lại bundle known-good gần nhất.

Kỷ luật này không xóa uncertainty của AI system. Nó đặt uncertainty vào một experiment có kiểm soát thay vì giao nó cho customer tiếp theo, người vô tình hỏi một câu khó.

## Đọc tiếp

Để hiểu regression layer đứng sau workflow này, đọc [Đừng đưa AI Agent lên Production khi chưa có Evals](/blog/agent-evals-regression-suite). Với production contract cho những write action lặp lại, xem [AI Action có tính Idempotent: Retry Tool Call mà không nhân đôi Side Effect](/blog/idempotent-ai-actions). Với telemetry boundary, đọc [Observability cho AI Agent: Trace Prompt, Tool Call, Token và Cost mà không biến Log thành rò rỉ dữ liệu](/blog/agent-observability-without-data-leaks). Với behavior của model/provider khi failure, xem [Failover đa mô hình không phải Route Flapping](/blog/provider-rotation-multi-model-failover).

## Tài liệu tham khảo

[1]: https://developers.openai.com/api/docs/guides/evaluation-best-practices "OpenAI — Evaluation best practices"
[2]: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents "Anthropic — Demystifying evals for AI agents"
[3]: https://docs.aws.amazon.com/sagemaker/latest/dg/shadow-tests.html "AWS SageMaker AI — Shadow tests"
[4]: https://argo-rollouts.readthedocs.io/en/stable/features/canary/ "Argo Rollouts — Canary Deployment Strategy"
