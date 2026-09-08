---
title: "Langfuse giữa các môi trường: Đồng bộ Prompt, Trace và Evaluation từ Dev đến Production"
description: "Production playbook triển khai Langfuse giữa dev, staging và production với prompt có version, evaluation tái lập được, trace an toàn và các cổng promotion trong CI/CD."
pubDate: 2026-02-24
category: "engineering"
lang: "vi"
translationKey: "langfuse-dev-prod-prompt-trace-eval-cicd"
draft: false
image: "/blog/langfuse-dev-prod-cicd/hero.webp"
---

Dấu hiệu đầu tiên cho thấy một team AI đã vượt qua giai đoạn thử nghiệm tự phát thường không phải là một model bị lỗi. Đó là một câu hỏi xuất hiện trong incident channel: “Production đang dùng prompt nào vậy?”

Câu hỏi nghe có vẻ đơn giản cho đến khi team phát hiện một developer đã sửa prompt trên dashboard dùng chung, service staging fetch `latest`, production fetch `production`, dataset evaluation đã thay đổi từ tuần trước, còn trace thì không ghi lại commit hoặc prompt version đã tạo ra câu trả lời. Ai cũng có một lời giải thích hợp lý. Nhưng không ai có thể tái lập chính xác hành vi đó.

Langfuse thường được đưa vào hệ thống như một nơi để xem trace và so sánh output của model. Điều đó hữu ích, nhưng chưa giải quyết toàn bộ bài toán vận hành. Một AI system trưởng thành cần release path nối được thay đổi prompt hoặc model với bằng chứng, phê duyệt, deployment, quan sát và rollback. Langfuse cung cấp nhiều mảnh ghép quan trọng qua prompt versioning, label, dataset, experiment, score, tracing, API và tích hợp CI/CD.[1](https://langfuse.com/docs/prompt-management/features/prompt-version-control) [2](https://langfuse.com/docs/evaluation/experiments/datasets) [3](https://langfuse.com/docs/prompt-management/features/github-integration)

![Một hệ thống release Langfuse kết nối prompt version, trace, dataset, evaluation, CI/CD gate và rollback production](/blog/langfuse-dev-prod-cicd/hero.webp)

> **Luận điểm chính:** Langfuse không nên chỉ là dashboard production đứng cạnh release system. Nó nên là một phần của AI release system, trong khi Git, runtime của ứng dụng và data boundary vẫn chịu trách nhiệm cho những thứ mà chúng phù hợp nhất để quản lý.

Bài viết này trình bày một operating model thực tế cho team sử dụng Langfuse ở development và production. Trọng tâm là bài toán đồng bộ: thứ gì nên di chuyển giữa các môi trường, thứ gì nên được promotion bằng reference, thứ gì phải redaction hoặc recreate, và thứ gì tuyệt đối không được copy. Bài viết cũng chỉ ra cách xây dựng một CI/CD path có thể chặn prompt release trước khi nó trở thành production incident.

## Bài toán môi trường thực chất là bài toán kiểm soát

Nhiều team mô tả dev, staging và production đơn giản là ba URL. Như vậy là chưa đủ. Một environment là tập hợp các control xoay quanh code, secret, data, model access, prompt version, quyền xem trace và quyền phát hành.

Development được phép thay đổi nhanh. Nó có thể dùng dữ liệu synthetic hoặc đã redaction, prompt thử nghiệm, tool mock và nhiều trường debug hơn. Production có nghĩa vụ khác: phải giữ tenant boundary, giới hạn quyền truy cập trace nhạy cảm, dùng model và prompt version đã được phê duyệt, đồng thời giải thích được hành vi sau khi sự việc đã xảy ra.

Staging chỉ có giá trị khi nó là một buổi diễn tập có ý nghĩa. Nếu staging fetch label khác, dùng tool schema khác hoặc có masking policy khác production, một lần chạy xanh ở staging có thể chỉ là bằng chứng về một hệ thống khác.

Mục tiêu không phải làm cho mọi môi trường giống hệt nhau. Mục tiêu là làm cho mọi **khác biệt có chủ đích đều được khai báo rõ ràng**.

| Control plane | Development | Staging | Production |
|---|---|---|---|
| Application code | Branch hoặc pull request build | Commit của release candidate | Immutable release đã được phê duyệt |
| Langfuse boundary | Project của developer hoặc team | Project validation chung hoặc staging project riêng | Production project với RBAC hạn chế |
| Prompt selection | `latest` hoặc label theo branch để khám phá | Candidate version hoặc label `staging` | Label `production` được bảo vệ hoặc version pin rõ ràng |
| Dataset | Synthetic, redacted hoặc curated test data | Regression và edge-case set có version | Chỉ tham chiếu read-only; mặc định không copy raw production data |
| Credential | Key theo developer, quyền thấp | Key CI/staging giới hạn scope | Production key lưu trong secret manager |
| Trace payload | Nhiều trường debug nhưng phải mask | Đủ chẩn đoán với quyền kiểm soát | Chỉ ghi dữ liệu cần thiết, masking và retention chặt hơn |
| Quyền promotion | Tác giả hoặc reviewer trong team | Release owner và evaluation gate | Approver hoặc change policy được bảo vệ |

Langfuse quản lý prompt version trong phạm vi một project, và tài liệu chính thức mô tả label như một cơ chế có thể đại diện cho environment, tenant hoặc experiment. Label `latest` trỏ tới version mới nhất, trong khi label production rõ ràng xác định version đã được chọn để chạy production. Có thể rollback bằng cách chuyển label production về version trước đó; protected label giới hạn người được phép thay đổi pointer này.[1](https://langfuse.com/docs/prompt-management/features/prompt-version-control)

Điều đó tạo ra một lựa chọn thiết kế quan trọng. Label là một deployment pointer, không phải bằng chứng release. Ứng dụng nên ghi lại prompt name, version, label sau khi resolve và release ID trong trace metadata. Nếu không, việc di chuyển label sau này có thể khiến việc tái dựng hành vi trong quá khứ trở nên khó khăn.

## Xác định source of truth

Thiết kế đồng bộ nguy hiểm nhất là thiết kế có hai source of truth nhưng không nói rõ hệ thống nào thắng. Prompt có thể được sửa trong Langfuse, copy vào repository, template lại ở runtime rồi tiếp tục bị feature flag thay đổi. Khi có incident, team không biết repository, registry hay runtime configuration mới là nguồn có thẩm quyền.

Có ba ownership pattern hợp lý.

Pattern thứ nhất là **registry-first**. Langfuse sở hữu việc authoring và versioning prompt. Reviewer tạo prompt version mới, ghi change description, chạy experiment rồi chuyển environment label sau khi được phê duyệt. GitHub Actions có thể được trigger khi prompt thay đổi thông qua Repository Dispatch integration được Langfuse tài liệu hóa.[3](https://langfuse.com/docs/prompt-management/features/github-integration) Pattern này thuận tiện cho team chủ yếu chỉnh prompt trong Langfuse, nhưng đòi hỏi webhook security chặt và audit rule ngăn những thay đổi production không được ghi nhận.

Pattern thứ hai là **Git-first**. Prompt template, configuration và evaluation definition nằm trong repository. CI validate rồi publish prompt version mới vào Langfuse. Langfuse trở thành runtime registry và observation surface, còn Git vẫn là source thay đổi có thể review. Mô hình này hợp lý khi prompt gắn chặt với application code hoặc phải đi qua cùng pull-request process như code.

Pattern thứ ba là **hybrid ownership**. Prompt content ổn định và test fixture được review trong Git; Langfuse giữ label, experiment run, score và production observation. CI publish một version bất biến rồi ghi Langfuse version ID vào release manifest. Product hoặc operations team có thể dùng Langfuse để so sánh version, nhưng chỉ promotion workflow mới được di chuyển protected production label.

Hybrid thường là mô hình thực tế nhất vì tách content review khỏi runtime assignment. Recommendation cụ thể ít quan trọng hơn contract:

```text
Git sở hữu:
  prompt source, application code, schema, evaluator code, release manifest

Langfuse sở hữu:
  prompt version, label, trace, observation, score, experiment record

Promotion workflow sở hữu:
  version nào nhận label staging hoặc production sau khi đã pass gate
```

Không được âm thầm sync hai chiều. Nếu Langfuse webhook commit vào Git và Git workflow publish ngược lại Langfuse, phải định nghĩa loop-prevention field và ownership rule. Nếu không, một edit có thể tạo webhook, commit, CI run, prompt version thứ hai và webhook tiếp theo trông như một thay đổi độc lập.

## Coi prompt version là release artifact

Prompt không chỉ là một chuỗi text. Nó là runtime artifact gồm name, type, version, model configuration, variable contract, tool assumption, evaluator expectation và owner vận hành.

Một release manifest hữu ích có thể đủ nhỏ để review trong pull request:

```yaml
release:
  id: support-agent-2026-02-24.1
  git_sha: 8f31c2a
  application_version: 2026.02.24.1
  owner: ai-platform
  change_type: prompt

langfuse:
  project: support-production
  prompt_name: support/answer
  prompt_version: 27
  staging_label: staging
  production_label: production

model:
  provider: approved-provider
  name: approved-model-alias
  parameters:
    temperature: 0.2
    max_tokens: 900

evaluation:
  dataset: regression/support-golden
  dataset_version: 2026-02-21T09:15:00Z
  experiment: support-agent-2026-02-24.1
  gates:
    correctness: ">= 0.90"
    policy_violation: "<= 0.01"
    p95_latency_ms: "<= 2500"

rollback:
  previous_prompt_version: 26
  previous_application_version: 2026.02.17.2
```

Manifest không nhằm duplicate mọi trace. Nó là tuyên bố cô đọng về release dự kiến dùng gì và bằng chứng nào cho phép nó đi tiếp. Ở runtime, trace nên mang manifest ID hoặc release ID, còn manifest trỏ lại prompt và dataset version chính xác.

Khi ứng dụng fetch prompt theo label, hãy dùng SDK retrieval path của Langfuse, vốn hỗ trợ client-side caching, retry và fallback, thay vì tự xây lại logic quanh một raw request.[6](https://langfuse.com/docs/api-and-data-platform/features/public-api) Ở production, ưu tiên environment label rõ ràng hoặc version đã resolve. Dùng `latest` cho exploration, không dùng như một dependency production chưa review.

Fetch contract an toàn có thể như sau:

```text
resolve prompt:
  name = support/answer
  label = production

record in trace:
  prompt_name = support/answer
  prompt_version = resolved_version
  prompt_label = production
  release_id = support-agent-2026-02-24.1
  git_sha = 8f31c2a
```

Nếu registry tạm thời không sẵn sàng, fallback cũng phải observable. Cached prompt có thể giúp hệ thống sẵn sàng hơn, nhưng trace phải cho biết ứng dụng đã dùng cached hoặc bundled version, thay vì tạo ấn tượng rằng nó vừa resolve production label hiện tại.

## Đồng bộ project mà không copy nhầm dữ liệu

Trong nhiều kịch bản self-hosted, Langfuse khuyến nghị bắt đầu với một deployment duy nhất, sử dụng organization, project và RBAC để tách logic. Nhiều deployment có thể cần thiết nếu có yêu cầu nghiêm ngặt về regulatory hoặc infrastructure, nhưng chúng làm tăng chi phí vận hành và khiến việc đồng bộ prompt, dataset khó hơn.[7](https://langfuse.com/self-hosting/security/deployment-strategies)

Team vì thế cần chọn boundary có chủ đích. Một deployment duy nhất với project tách biệt có thể đủ cho dev, staging và production nếu access control, network policy và retention phù hợp. Instance riêng có thể cần thiết khi production data phải nằm ở network hoặc jurisdiction khác, hoặc compliance policy yêu cầu physical separation.

Project separation cũng ảnh hưởng tới việc di chuyển prompt. Vì prompt nằm trong phạm vi project, không thể mặc định rằng prompt version tồn tại ở project khác chỉ vì name giống nhau.[1](https://langfuse.com/docs/prompt-management/features/prompt-version-control) Promotion giữa các project nên dùng một publish hoặc export/import step rõ ràng, ghi lại source version, destination version, checksum và actor.

Hãy dùng synchronization policy sau:

| Object | Chiến lược sync | Lý do |
|---|---|---|
| Prompt source | Promote qua Git hoặc controlled Langfuse API workflow | Có thể review và tái lập |
| Prompt version ID | Ghi như source metadata; không giả định ID giống nhau giữa project | Project scope có thể tạo destination ID khác |
| Prompt label | Chỉ di chuyển qua promotion action đã duyệt | Label là deployment pointer |
| Dataset definition | Version và promote một snapshot được chọn | Thay đổi item tạo dataset version mới |
| Synthetic test item | Copy hoặc recreate | An toàn cho CI và portable giữa boundary |
| Production trace | Query có chọn lọc, redact, rồi biến thành case đã duyệt | Raw trace có thể chứa dữ liệu nhạy cảm |
| Production secret | Tuyệt đối không copy | Credential thuộc về từng environment |
| Score và experiment result | Export summary hoặc reproduce theo dataset version đã khai báo | Tránh trộn bằng chứng từ những data state khác nhau |

Thay đổi item trong Langfuse dataset tạo ra version được theo dõi bằng timestamp, và dataset có thể được fetch tại một version cụ thể để chạy experiment tái lập được.[2](https://langfuse.com/docs/evaluation/experiments/datasets) Điều này đặc biệt hữu ích khi team cần giải thích vì sao prompt pass trong tháng 2 nhưng fail khi chạy lại với dataset mới có thêm edge case.

Không dùng production làm training ground mặc định cho development. Thay vào đó, tạo controlled path từ production observation thành regression item đã redaction. Path này cần data owner approval, PII check, tenant authorization và record giải thích tại sao example đó cần thiết. Production trace là bằng chứng, không tự động trở thành test fixture hợp lệ.

![Environment promotion tách release artifact portable khỏi dữ liệu đã redaction và secret riêng của từng môi trường](/blog/langfuse-dev-prod-cicd/environment-promotion.webp)

## Xây trace contract trước khi thêm dashboard

Trace hữu ích nhất khi nó trả lời được câu hỏi mà incident responder hoặc evaluator sẽ đặt ra sau này. Nhiều field hơn không tự động làm trace tốt hơn. Một trace tốt có identity ổn định, hierarchy có ý nghĩa, ranh giới input/output rõ ràng và đủ release context để tái hiện đường đi.

Với một AI workflow production, hãy chuẩn hóa một nhóm field nhỏ:

```text
trace_id
session_id
request_id
tenant_id_hash
workflow_name
workflow_version
environment
release_id
git_sha
prompt_name
prompt_version
prompt_label
model_provider
model_name
tool_schema_version
evaluation_dataset_version
sampling_policy
masking_policy
```

Giá trị phải do application kiểm soát và nhất quán giữa các service. Gateway có thể tạo request và trace identity, còn generation và tool span con kế thừa release và workflow context. Tenant identifier nên opaque hoặc hash theo data policy; đừng đưa raw customer email vào trace chỉ vì tìm kiếm tiện hơn.

Trace contract cũng cần một negative definition. Hãy quy định các field không được ghi: access token, payment detail đầy đủ, private key, health information chưa redaction và secret thô nằm trong tool response. Khi có thể, application nên tránh tạo những attribute đó ngay từ đầu.

Langfuse hỗ trợ masking trace input, output, metadata và OpenTelemetry attribute trước khi export. Với Python SDK hiện tại, tài liệu khuyến nghị `mask_otel_spans` cho masking ở export stage; các SDK hoặc OpenTelemetry configuration khác có hook riêng.[4](https://langfuse.com/docs/observability/features/masking) Masking function phải deterministic và nhanh. Một masking implementation làm nghẽn export hoặc bất ngờ fail-open có thể tạo cảm giác an toàn giả.

Trong self-hosted deployment, Langfuse mô tả cả client-side masking và server-side ingestion masking. Client-side masking là boundary nên dùng khi data không được phép rời application. Server-side masking có thể làm centralized safety net, nhưng có thể yêu cầu Enterprise và không thay thế client-side protection.[5](https://langfuse.com/self-hosting/security/data-masking)

Trace cũng nên ghi version của masking policy. Về sau, investigator cần phân biệt “answer sai” với “evaluator không nhìn thấy evidence vì đã redaction”. Observability và privacy không phải hai dự án tách rời; trace contract là nơi chúng gặp nhau.

## Dùng dataset như release test, không phải gallery screenshot

Dataset có giá trị khi được duy trì như một test suite. Một tập các ví dụ ấn tượng là chưa đủ. Dataset nên có input đại diện, expected output hoặc evaluation criteria, edge case, negative case, case nhạy cảm về policy và ví dụ từ các incident trước.

Hãy tổ chức dataset theo mục đích thay vì theo người tạo:

| Dataset family | Mục đích | Gate thường dùng |
|---|---|---|
| Golden | Case đại diện ổn định | Correctness và required behavior |
| Safety | Refusal, privacy, policy và tool-boundary case | Violation rate và escalation behavior |
| Regression | Incident và failure đã từng sửa | Không tái xuất hiện failure đã biết |
| Performance | Long context, concurrency và path đắt | Latency, token và cost |
| Adversarial | Input mơ hồ, mâu thuẫn hoặc thao túng | Robustness và abstention |

Tên dataset nên thể hiện contract của nó. `support/golden` ít thông tin hơn `support/golden/v3` nếu team không định nghĩa rõ suffix là semantic release, dataset folder hay application version. Langfuse hỗ trợ folder qua tên dataset có dấu slash, còn thay đổi dataset item tạo version theo timestamp.[2](https://langfuse.com/docs/evaluation/experiments/datasets)

Mỗi CI run phải ghi dataset name và exact version timestamp. Nếu CI fetch “latest dataset”, kết quả không tái lập được: đồng đội có thể chạy lại cùng commit vào ngày mai với test set khác và nhận gate outcome khác.

Evaluation không nên chỉ so sánh một score. Prompt có thể cải thiện helpfulness nhưng làm tăng unsupported claim. Nó có thể giảm token cost nhưng tăng escalation. Vì vậy release gate nên định nghĩa minimum quality score, maximum safety violation rate, latency budget và điều kiện fail khi trace thiếu hoặc malformed.

Dùng gate đủ cụ thể để có thể fail build:

```text
correctness_score >= 0.90
safety_violation_rate <= 0.01
required_citation_rate >= 0.95
p95_latency_ms <= 2500
trace_completeness >= 0.98
missing_prompt_version = 0
```

Các threshold trên chỉ là ví dụ, không phải default áp dụng cho mọi hệ thống. Team phải calibrate chúng với human label và business risk. Automated evaluator score là bằng chứng có bất định, không phải lý do để bỏ qua critical failure.

Langfuse experiment có thể chạy qua SDK workflow trên local hoặc hosted dataset; khả năng dùng versioned dataset giúp so sánh candidate với một data state đã biết.[2](https://langfuse.com/docs/evaluation/experiments/datasets) CI system nên lưu experiment identifier, evaluator code version, model dùng để evaluate và summary result vào release record.

## CI/CD phải promote bằng chứng

Thay đổi prompt nên đi qua kỷ luật tương tự code change, nhưng loại test sẽ khác. Syntax validation bắt malformed variable. Contract test bắt thiếu field trong tool. Dataset evaluation bắt quality regression. Staging smoke test bắt integration failure. Production canary monitoring bắt hành vi mà offline data không đại diện được.

Một pipeline thực tế có năm gate:

```text
1. Validate
   prompt variable, schema, policy metadata, required ownership

2. Evaluate
   Langfuse dataset version đã pin, regression và safety experiment

3. Stage
   publish candidate, gắn staging label, deploy application release

4. Approve
   xem score, latency, cost, trace và change diff

5. Promote
   di chuyển protected production label, canary, monitor, rollback khi cần
```

Langfuse tài liệu hóa hai pattern tích hợp GitHub: Repository Dispatch có thể trigger workflow khi prompt thay đổi, còn Prompt Version Webhook có thể đồng bộ prompt version vào repository thông qua webhook server.[3](https://langfuse.com/docs/prompt-management/features/github-integration) Đây là integration primitive, chưa phải release policy hoàn chỉnh. Workflow vẫn cần signature verification, idempotency, credential tối thiểu, dataset pinning và rule xử lý khi CI fail.

Một GitHub Actions workflow tối thiểu có thể có hình dạng như sau:

```yaml
name: AI release gate

on:
  pull_request:
    paths:
      - "prompts/**"
      - "evaluators/**"
      - "release-manifest.yaml"
  repository_dispatch:
    types: [langfuse-prompt-update]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./ci/validate-prompts.sh
      - run: ./ci/check-release-manifest.sh

  evaluate:
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./ci/run-langfuse-experiment.sh
      - run: ./ci/check-evaluation-gates.sh results.json

  stage:
    needs: evaluate
    if: github.event_name == 'push' || github.event_name == 'repository_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./ci/publish-candidate.sh
      - run: ./ci/smoke-test-staging.sh

  promote:
    needs: stage
    environment: production-approval
    runs-on: ubuntu-latest
    steps:
      - run: ./ci/promote-production-label.sh
      - run: ./ci/start-canary.sh
```

Các command chỉ là placeholder có chủ đích. Implementation production nên gọi Langfuse API hoặc CLI đã được tài liệu hóa và validate response theo API reference, thay vì tự đoán endpoint hoặc field name.[5](https://langfuse.com/docs/api-and-data-platform/features/cli) [6](https://langfuse.com/docs/api-and-data-platform/features/public-api)

Workflow tuyệt đối không được in `LANGFUSE_SECRET_KEY`, prompt content có customer data hoặc raw webhook payload vào public CI log. Dùng key riêng theo project cho từng environment, lưu chúng trong CI secret manager và chỉ cấp operation mà job cần. Langfuse CLI dùng cùng project API key pair với SDK/public API, đồng thời hỗ trợ base URL theo region hoặc self-hosted thông qua environment variable.[5](https://langfuse.com/docs/api-and-data-platform/features/cli)

## Promotion là một state transition

Quy trình promotion đáng tin cậy không copy “thứ hiện đang latest”. Nó đưa một version đã biết qua các state rõ ràng.

```text
candidate v27
    ↓ offline evaluation passed
staging v27
    ↓ smoke trace và approval passed
production v27
    ↓ canary monitoring passed
stable v27
```

State transition phải idempotent. Nếu CI job retry sau network timeout, nó không được tạo release thứ hai mơ hồ hoặc đưa production sang version khác với version reviewer đã duyệt. Dùng release ID và source checksum làm deduplication key trong promotion service hoặc workflow.

Một release approval phải gồm diff, không chỉ score. Reviewer cần thấy prompt variable nào đổi, tool contract có đổi không, model parameter nào đổi, dataset version nào được dùng, candidate so với production hiện tại ra sao và rollback target là gì.

Protected production label hữu ích vì biến convention thành permission boundary. Label nên được di chuyển bởi release identity và operator đã được phê duyệt, không phải bởi mọi developer có quyền edit prompt.[1](https://langfuse.com/docs/prompt-management/features/prompt-version-control)

![CI/CD gate so sánh các prompt version trên dataset đã pin trước khi staging, approval, promotion production và rollback](/blog/langfuse-dev-prod-cicd/ci-cd-gates.webp)

## Rollback là label move cộng với application check

Rollback prompt chưa hoàn tất khi label thay đổi. Application đang chạy có thể cache giá trị cũ, giữ giá trị mới trong memory hoặc dùng bundled fallback vì registry không sẵn sàng. Vì vậy rollback procedure phải verify runtime path.

Một rollback sequence an toàn:

```text
1. Freeze mọi promotion mới.
2. Chuyển protected production label về prompt version đã biết là tốt.
3. Verify application resolve version đó trong process mới.
4. Xác nhận trace mới ghi rollback release ID và prompt version.
5. Monitor quality, safety, latency và error rate.
6. Giữ failed release và tạo regression case.
```

Không nên xóa failed release chỉ vì nó không an toàn. Trace sample, evaluation result, prompt diff và incident context của nó là bằng chứng quan trọng. Xóa lịch sử sẽ phá hủy dữ liệu cần để hiểu tại sao thay đổi đó từng được promotion.

Rollback cũng cần compatibility check. Nếu prompt version đòi variable hoặc tool schema mới, chỉ di chuyển label có thể biến một incident thành incident khác. Release manifest nên khai báo application compatibility; rollback command phải verify prompt cũ chạy được với code đang deploy.

## Truy ngược production behavior về pull request

Production trace có giá trị vận hành khi nối được với release manifest rồi nối tiếp về change đã tạo ra nó.

```text
trace_id
  → release_id
      → git_sha
          → pull request
              → prompt diff
                  → dataset version
                      → experiment result
```

Có thể triển khai join qua trace metadata, deployment annotation, release table hoặc cả ba. Property quan trọng không phải vị trí lưu trữ, mà là investigator không phải đoán release từ timestamp.

Nếu user báo một câu trả lời sai, phản ứng đầu tiên nên là capture trace và freeze context. Sau đó hỏi prompt version, model, retrieval state, tool response, masking policy và application release đã biết hay chưa. Nếu thiếu một trong các giá trị đó, observability gap trở thành engineering task mới.

Chỉ biến incident thành dataset item sau khi data boundary được review. Redact hoặc transform input, giữ nguyên failure property, định nghĩa expected behavior và assign owner. Một regression item không còn đại diện cho failure gốc còn tệ hơn không có item vì nó tạo false confidence.

![Production trace trở thành regression case đã redaction, được evaluate với candidate và liên kết ngược về release decision](/blog/langfuse-dev-prod-cicd/trace-to-regression.webp)

## Những failure mode thường gặp

Failure mode thứ nhất là **dùng `latest` ở production**. Nó xóa approval boundary và biến dashboard edit thành deployment action. Hãy dùng label hoặc version rõ ràng và ghi lại kết quả resolve.

Thứ hai là **dùng chung một API key cho mọi environment**. Điều này làm yếu attribution, tăng khả năng accidental write và khiến rotation phức tạp. Dùng key theo project với permission riêng cho từng environment.

Thứ ba là **copy production trace về dev mà không có policy**. Cách này có thể làm lộ PII và context riêng của customer. Hãy tạo redaction và approval path thay thế.

Thứ tư là **evaluate trên dataset đang thay đổi**. CI result khó tái lập. Pin dataset version và giữ experiment metadata.

Thứ năm là **coi score là release decision**. Score có thể che giấu safety regression, latency increase hoặc trace thiếu. Kết hợp quality, safety, performance, completeness và cost check.

Thứ sáu là **cho rằng label move đã là rollback hoàn chỉnh**. Phải verify cache, application compatibility, trace mới và runtime resolution.

Thứ bảy là **tạo bidirectional sync loop**. Nếu Langfuse ghi vào Git và Git ghi ngược vào Langfuse mà không có ownership rule rõ ràng, một thay đổi có thể nhân thành nhiều version. Hãy thêm loop prevention và chỉ định một hệ thống authoritative cho từng artifact.

Thứ tám là **chỉ masking ở dashboard**. Dữ liệu không được phép rời application phải được mask trước export. Viewer permission không thể sửa một ingestion boundary không an toàn.[4](https://langfuse.com/docs/observability/features/masking) [5](https://langfuse.com/self-hosting/security/data-masking)

## Rollout plan cho team nhỏ

Team nhỏ không cần triển khai mọi control ngay ngày đầu tiên. Nhưng cần xác lập thứ tự mà các control trở thành non-negotiable.

Ở vòng đầu, tách project key, thêm `environment`, `release_id`, `git_sha`, prompt name, resolved prompt version và model name vào mọi trace. Dừng dùng `latest` ở production. Tạo một golden dataset và một regression dataset, sau đó pin version của chúng trong CI.

Ở vòng hai, làm cho prompt change có thể review. Chọn Git-first, registry-first hoặc hybrid ownership. Thêm release manifest, offline evaluation gate và staging smoke test. Bảo vệ production label và viết rollback procedure mà người không phải tác giả ban đầu cũng có thể thực hiện.

Ở vòng ba, thêm workflow production-to-regression có redaction, canary monitoring, cost/latency gate và trace completeness check. Đưa deployment logic dùng chung vào reusable workflow hoặc release service. Review ai được đọc production trace và ai được sửa prompt.

Mục tiêu không phải tạo nghi thức quan liêu. Mục tiêu là làm cho một thay đổi nhỏ, nhanh trở nên an toàn hơn một dashboard edit không được ghi nhận.

## Operational checklist

Trước khi merge prompt hoặc model change, pull request phải trả lời được các câu hỏi sau:

| Câu hỏi | Bằng chứng |
|---|---|
| Đã thay đổi gì? | Prompt diff, model/config diff, tool/schema diff |
| Version nào sẽ chạy? | Release manifest với prompt version hoặc controlled label |
| Đã evaluate gì? | Dataset name và exact version timestamp |
| Điều gì đã pass? | Quality, safety, latency, completeness và cost result |
| Dùng dữ liệu nào? | Synthetic, redacted hoặc production-derived case đã duyệt |
| Ai approve promotion? | Protected environment approval và audit record |
| Rollback ra sao? | Known-good prompt/application version và compatibility check |
| Làm sao biết đã live? | Production trace mới có release metadata |

Sau deployment, team phải kiểm tra runtime có emit các field được cam kết trong trace contract hay không. Một release pass offline evaluation nhưng production không ghi prompt version thì chưa observable đầy đủ; nó mới chỉ được ship một phần.

## Kết luận

Sử dụng Langfuse giữa nhiều environment không chủ yếu là bài toán đồng bộ. Đó là bài toán về authority, reproducibility và controlled state transition.

Prompt cần version và protected deployment label. Dataset cần snapshot có thể fetch và rerun. Trace cần release metadata và privacy boundary có chủ đích. CI/CD phải promotion bằng evidence thay vì mutable pointer. Production incident cần path quay về regression case đã redaction và pull request. Rollback cần runtime verification, không chỉ label update.

Thiết lập mạnh nhất thường là thiết lập ít “ma thuật” nhất: Git ghi nhận change, Langfuse ghi version và behavior, CI ghi quyết định, còn production trace chứng minh thứ thực sự đã chạy. Khi các boundary này rõ ràng, Langfuse không chỉ là nơi xem failure. Nó trở thành một phần đáng tin cậy của release discipline cho AI system.

## References

[1] [Langfuse — Prompt Version Control](https://langfuse.com/docs/prompt-management/features/prompt-version-control)

[2] [Langfuse — Datasets and Versioned Experiments](https://langfuse.com/docs/evaluation/experiments/datasets)

[3] [Langfuse — GitHub Integration for Prompts](https://langfuse.com/docs/prompt-management/features/github-integration)

[4] [Langfuse — Masking Sensitive LLM Data](https://langfuse.com/docs/observability/features/masking)

[5] [Langfuse — Data Masking for Self-Hosted Deployments](https://langfuse.com/self-hosting/security/data-masking)

[6] [Langfuse — Public API](https://langfuse.com/docs/api-and-data-platform/features/public-api)

[7] [Langfuse — Deployment Strategies for Self-Hosted Environments](https://langfuse.com/self-hosting/security/deployment-strategies)

[8] [Langfuse — Experiments in CI/CD](https://langfuse.com/docs/evaluation/experiments/experiments-ci-cd)
