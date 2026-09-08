---
title: "Từ Feature Branch đến Production: Cách My Company Ship Feature Dịch vụ công an toàn"
description: "Playbook quản lý Git và release enterprise qua ví dụ thêm nút gửi email cho công dân ở bước 3 của quy trình iGate, với authorization, audit, CI/CD, canary và rollback rõ ràng."
pubDate: 2026-08-26
category: "architecture"
image: "/blog/enterprise-git-feature-to-production/branch-flow.webp"
lang: "vi"
translationKey: "enterprise-git-feature-to-production"
draft: false
---

![Enterprise Git workflow đưa feature gửi email cho công dân ở bước 3 iGate từ feature branch qua review, integration, release và production được kiểm chứng](/blog/enterprise-git-feature-to-production/branch-flow.webp)

Ở my company, một yêu cầu feature đôi khi trông nhỏ đến mức dễ đánh giá thấp.

“Thêm một nút để cán bộ gửi email cho công dân khi hồ sơ đang được xử lý.”

Cái nút có thể chỉ mất một buổi chiều. Nhưng production feature thì không. Trong một quy trình dịch vụ công, câu hỏi quan trọng không chỉ là nút có hiển thị đúng hay mail provider có nhận request hay không. Chúng tôi còn phải biết ai được phép gửi, hồ sơ có thật sự đang ở bước 3 không, email có bị gửi hai lần không, action có audit được không, thay đổi có tương thích với database hiện tại không, và có thể tắt feature mà không làm cả dịch vụ ngừng hoạt động hay không.

Đó là lý do source control không chỉ là nơi lưu code. Nó là một phần của operating model tạo ra sự tin cậy.

> **Luận điểm chính:** Một feature branch chỉ an toàn khi toàn bộ đường đi từ lúc tạo branch đến production đều được kiểm soát: change set nhỏ, review rõ ràng, automated evidence, immutable artifact, promotion theo từng environment, release có thể đảo ngược và owner chịu trách nhiệm rollback.

Bài viết dùng một quy trình iGate được fictionalize. Nội dung không mô tả topology, dữ liệu công dân, production system hay policy nội bộ của bất kỳ tổ chức riêng tư nào. Tên và identifier trong ví dụ đều là dữ liệu tổng hợp. Đây là hướng dẫn engineering tổng quát, không thay thế các yêu cầu cụ thể về security, privacy, records management hoặc change management của từng hệ thống dịch vụ công.

## Bắt đầu bằng một production branch duy nhất

Doanh nghiệp lớn thường kế thừa một hỗn hợp tên branch: `dev`, `develop`, `staging`, `release/*`, `main` và `master`. Vấn đề không nằm ở việc repository có chính xác bao nhiêu branch. Vấn đề là sự mơ hồ. Nếu hai branch đều được gọi là “production”, sớm muộn team sẽ phải hỏi branch nào là authoritative, branch nào nhận hotfix và deployment pipeline tin branch nào.

Quy tắc của chúng tôi khá đơn giản: chọn một canonical production branch. Với repository mới, branch đó có thể là `main`; với repository legacy, nó vẫn có thể là `master`. Tên ít quan trọng hơn contract. Production branch phải được bảo vệ, review, validate liên tục và là branch duy nhất từ đó production release được promotion. Nếu `main` và `master` cùng tồn tại trong giai đoạn migration, một branch phải là canonical còn branch kia được đánh dấu rõ là transitional. Không được coi chúng là hai production truth độc lập.

Short-lived feature branch vẫn đem lại isolation và review surface cho developer. Nhưng nó không được trở thành một private development environment tách khỏi sản phẩm trong nhiều tuần. DORA mô tả trunk-based development là cách tích hợp các batch nhỏ vào trunk dùng chung với tần suất cao, đồng thời liên hệ cách làm này với continuous integration; hướng dẫn cũng nhấn mạnh việc giữ trunk luôn green và tránh các giai đoạn integration quá lớn. Điều đó không có nghĩa mọi tổ chức regulated đều phải deploy trực tiếp từ trunk. Ý nghĩa thực tế là khoảng cách giữa một thay đổi và shared truth nên càng nhỏ càng tốt.

| Branch hoặc environment | Mục đích | Ai được thay đổi | Không được biến thành |
|---|---|---|---|
| `feature/*` | Một change, bug fix hoặc experiment có scope rõ | Feature owner và collaborator | Bản sao sản phẩm sống lâu |
| `dev` | Shared integration và contract testing | Merge qua PR | Production validation vĩnh viễn |
| `staging` / UAT | Kiểm tra gần production với external dependency an toàn | Pipeline và operator được duyệt | Server bị patch thủ công |
| `main` hoặc `master` | Canonical production source và release record | Protected PR hoặc merge queue | Branch ai cũng push trực tiếp được |
| `release/*` | Snapshot ổn định cho một release train nếu cần | Release team theo policy | Nơi phát triển feature mới thứ hai |

Mô hình này tương thích với cả short-lived feature branch lẫn flow promotion kiểu legacy. Tên branch không phải safety mechanism. Safety mechanism là bằng chứng cần có để đi từ branch này sang branch khác.

## Feature này là một workflow change, không chỉ là một cái nút

Hãy hình dung một hồ sơ của công dân đang đi qua một thủ tục đã định nghĩa. Ở **bước 3 — thụ lý hồ sơ**, cán bộ đang xem xét và xử lý hồ sơ. Product request là thêm nút **Gửi email trạng thái** để cán bộ thông báo rằng hồ sơ đang được xử lý hoặc công dân cần bổ sung thông tin.

Thiết kế đầu tiên rất dễ nghĩ đến nhưng không an toàn:

```text
Browser button -> POST /send-email -> mail provider
```

Browser không được tự quyết định action có được phép hay không, hồ sơ nào nằm trong scope, hoặc workflow hiện tại có phải bước 3 không. Thiết kế an toàn hơn coi browser là request surface, còn authority nằm ở backend:

![Feature email ở bước 3 kiểm tra cán bộ, scope hồ sơ, workflow state, outbox event, idempotency, provider delivery và audit trail](/blog/enterprise-git-feature-to-production/email-feature-flow.webp)

```text
Cán bộ bấm nút
        |
        v
Backend kiểm tra identity, role, scope hồ sơ và step = 3
        |
        v
Transactional outbox ghi email_requested
        |
        v
Worker gửi qua provider với idempotency key
        |
        v
Delivery status và audit event được ghi nhận
```

Feature contract nên được viết trước khi tạo branch. Một contract hữu ích có thể là:

| Contract | Quyết định cho feature |
|---|---|
| Actor | Cán bộ đã đăng nhập, được phân công hồ sơ hoặc supervisory role được cấp quyền rõ ràng |
| Scope | Một hồ sơ, một người nhận là công dân, một workflow instance |
| State precondition | Hồ sơ đang ở bước 3 và chưa đóng, hủy hoặc đi qua action boundary được phép |
| Message | Template có version, subject được duyệt và safe variable; browser không gửi arbitrary HTML |
| Side effect | Tối đa một request được chấp nhận cho cùng hồ sơ, template và business event, trừ khi có policy resend rõ ràng |
| Audit | Actor, reference hồ sơ, step, template version, request ID, result và timestamp; mặc định không log full citizen message body |
| Recovery | Retry lỗi tạm thời của provider, hiển thị lỗi vĩnh viễn và cho phép resend có quyền mà không che giấu attempt đầu tiên |

Bảng nhỏ này ngăn một lỗi rất phổ biến: developer hoàn thiện visible interaction nhưng hệ thống lại không có định nghĩa rõ “ai được phép gửi”.

## Tạo branch nói đúng sự thật

Branch name là routing hint cho con người và automation. Nó nên mô tả change mà không nhúng thông tin riêng tư của công dân:

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/igate-step3-citizen-email
```

Một naming convention hợp lý:

```text
feature/<bounded-change>
fix/<bounded-defect>
chore/<maintenance>
release/<version-or-train>
hotfix/<production-defect>
```

Tránh các tên như `feature/new-button-final-final`, `john-test`, hoặc branch chứa tên công dân hay mã hồ sơ. Source-control metadata có thể searchable, mirrored và thường được giữ lâu hơn chính feature.

Chuỗi commit hợp lý có thể là:

```text
feat(workflow): add step-3 email command contract
feat(workflow): authorize citizen status email action
feat(notification): persist email request in outbox
feat(notification): send idempotent status email
feat(ui): expose email action for eligible step-3 cases
test(notification): cover duplicate and retry paths
```

Các commit này không phải nghi thức hình thức. Chúng làm cho change dễ review. Reviewer có thể hiểu contract, authorization, side effect, UI condition và negative test mà không phải dựng lại một diff khổng lồ.

Nếu feature quá lớn để review trong một PR có scope thống nhất, hãy tách thành các increment backward-compatible. Ví dụ, merge backend command và feature flag trước, sau đó worker, rồi UI exposure. Những increment chưa hoàn chỉnh phải vô hại khi bị disable. Feature flag chỉ hữu ích khi old path vẫn an toàn và được support; nó không phải giấy phép để merge code hỏng vào shared branch.

## Local validation là một phần của branch contract

Trước khi mở pull request, feature owner nên chạy những high-value check giống CI. Lệnh chính xác phụ thuộc repository, nhưng tối thiểu nên có:

```bash
pnpm lint
pnpm test
pnpm check
pnpm build
```

Với Java/Spring service, tương đương có thể là:

```bash
./mvnw verify
./mvnw test -Dtest=CitizenEmailCommandTest
./mvnw spring-javaformat:validate
```

Điểm quan trọng không nằm ở package manager. Điểm quan trọng là feature owner phải reproduce được quality gate trên máy local và đính kèm evidence có ý nghĩa trong PR.

Với feature iGate, test matrix cần nhiều hơn “button xuất hiện”. Nó phải kiểm tra authorization, state, side effect và recovery khi lỗi:

| Test slice | Kết quả mong đợi |
|---|---|
| Cán bộ được phép, hồ sơ ở bước 3 | Command được chấp nhận và tạo đúng một outbox event |
| Cán bộ không được phân công hoặc không có quyền | `403` hoặc domain denial; không có outbox row và không có email attempt |
| Hồ sơ ở bước 2 hoặc bước 4 | Domain rejection; UI không thể bypass backend rule |
| Hồ sơ đã đóng hoặc hủy | Không gửi; trả về lý do trung thực cho operator |
| Duplicate request ID | Trả về result cũ; không tạo provider request thứ hai |
| Worker timeout sau khi provider đã nhận | Reconciliation ngăn accidental duplicate send |
| Template variable không hợp lệ | Build/test hoặc command validation chặn request trước delivery |
| Mail provider tạm thời outage | Bounded retry và trạng thái pending/failed rõ; không loop vô hạn |
| Reference hồ sơ khác tenant | Request bị từ chối dù cán bộ đoán đúng ID |
| Audit persistence lỗi | Hệ thống tuân thủ policy đã khai báo; không claim gửi thành công nếu thiếu evidence |

Code review nên hỏi mỗi dòng trong bảng đã được thể hiện bằng code hoặc test rõ ràng chưa. “Happy path chạy được” không phải release argument cho một side effect trong dịch vụ công.

## Backend phải sở hữu authorization và idempotency

Một command tối giản thường biểu đạt business boundary rõ hơn controller trộn lẫn authorization, state check, database write và provider call:

```ts
type SendCitizenStatusEmail = {
  requestId: string;
  applicationId: string;
  template: "processing_started" | "additional_information_required";
  actorId: string;
};

async function requestCitizenEmail(command: SendCitizenStatusEmail) {
  const actor = await identity.requireAuthenticated(command.actorId);
  const application = await applications.getForActor(
    command.applicationId,
    actor,
  );

  if (application.workflowStep !== 3) {
    throw new DomainError("EMAIL_ACTION_REQUIRES_STEP_3");
  }

  await policy.require(actor, "send_citizen_status_email", application);

  return db.transaction(async (tx) => {
    const existing = await tx.outbox.findByRequestId(command.requestId);
    if (existing) return existing.result;

    const event = await tx.outbox.insert({
      requestId: command.requestId,
      type: "citizen_status_email_requested",
      aggregateId: application.id,
      template: command.template,
      templateVersion: await templates.currentVersion(command.template),
      actorId: actor.id,
    });

    await tx.audit.append({
      action: "citizen_status_email_requested",
      actorId: actor.id,
      applicationId: application.id,
      workflowStep: application.workflowStep,
      requestId: command.requestId,
    });

    return event;
  });
}
```

Browser có thể ẩn button với hồ sơ không đủ điều kiện, nhưng đó chỉ là usability optimization, không phải authorization boundary. API phải kiểm tra lại vì client, URL và cached screen không thể được tin là phản ánh workflow state hiện tại.

Email worker cũng không được coi network timeout là bằng chứng chắc chắn email chưa được gửi. Worker cần provider request identifier, bounded retry policy, delivery status và reconciliation path. Có thể dùng một idempotency key theo business event:

```text
igate:<application-id>:<workflow-step>:<template-version>:<business-event-id>
```

Đừng tạo key từ display text có thể thay đổi. Nếu cán bộ chỉnh template về sau, event identity vẫn phải dễ hiểu và audit được.

## Pull request review là control, không phải cuộc thi popularity

Khi branch sẵn sàng, hãy mở PR vào `dev` nếu `dev` là integration branch. PR description phải đủ để reviewer có thể thực sự review change:

```markdown
## What changed
Adds the step-3 citizen status email command, outbox event, worker handling,
and a feature-flagged action in the processing screen.

## Invariants
- Backend requires authorized actor and workflowStep = 3.
- Browser visibility is not used as authorization.
- Duplicate requestId does not create a second outbox event.
- No citizen message body is written to ordinary application logs.

## Validation
- Unit tests: passed
- Integration tests: passed
- Contract tests: passed
- Build image digest: sha256:...

## Rollback
Disable `igate.step3.citizen_email` first; then roll back the image if needed.

## Risk / data change
No destructive schema change. Adds an outbox index and a nullable delivery-status field.
```

Với các branch quan trọng, GitHub hỗ trợ những protected-branch setting như required pull-request review, required status checks, conversation resolution, signed commits, linear history, merge queue, successful deployments và giới hạn quyền push. Cấu hình chính xác là quyết định governance của từng repository, nhưng nguyên tắc có tính phổ quát: protected production branch không nên phụ thuộc vào trí nhớ cá nhân hoặc thiện chí của người đang giữ admin token.

Code owner nên review authorization, data handling và external side effect. UI reviewer kiểm tra trải nghiệm operator. Service owner kiểm tra compatibility và operational load. Số lượng approval nên phản ánh risk, không nên trở thành nghi thức khiến một thay đổi nhỏ phải chờ nhiều ngày.

## Merge vào `dev`: integration, chưa phải production

Target merge đầu tiên thường là shared integration branch:

```bash
git fetch origin
git rebase origin/dev
git push --force-with-lease origin feature/igate-step3-citizen-email
```

PR chỉ nên merge sau khi required check pass trên base hiện tại. Nếu repository có nhiều PR, merge queue an toàn hơn việc nhiều PR xanh cùng cạnh tranh merge. GitHub mô tả merge queue là cách validate change trên bản mới nhất của target branch cùng với những change đã ở trong queue, thông qua temporary merge-group branch và required check.

Sự khác biệt này rất quan trọng. Một feature có thể xanh trên branch riêng nhưng fail khi ghép với change khác chạm vào workflow transition, notification template hoặc database index. Integration branch là nơi contract test, service-to-service test và fixture flow thực tế phát hiện incompatibility.

Sau khi merge vào `dev`, pipeline nên publish một immutable build artifact. Không build lại từ cùng một Git commit riêng cho staging và production. Hãy build một lần, ghi nhận commit SHA và image digest, rồi promotion đúng artifact đó:

```text
source commit -> build once -> image digest -> staging -> UAT -> production
```

Hai artifact khác nhau sinh ra từ cùng source không mặc nhiên là cùng một release. Dependency, timestamp, build flag hoặc generated file có thể khác. Digest giúp release có một identity cụ thể.

## Promotion qua staging và UAT với dependency an toàn

Staging nên giống production ở những yếu tố ảnh hưởng đến feature: authentication claim, workflow state transition, database compatibility, queue behavior, template rendering, audit permission và timeout handling. Mail provider phải chạy sandbox hoặc route vào controlled sink. Không test nào được gửi message thật đến công dân thật.

UAT nên đi theo hành trình của cán bộ và công dân, không chỉ gọi endpoint:

1. Tạo một hồ sơ tổng hợp, được đánh dấu rõ đang ở bước 3.
2. Đăng nhập bằng tài khoản cán bộ được phép và kiểm tra action có hiển thị.
3. Gửi notification qua mail sandbox và kiểm tra template đã render.
4. Gửi lại request và xác nhận UI hiển thị trạng thái duplicate hoặc already sent một cách trung thực.
5. Đổi workflow step và xác nhận backend từ chối action.
6. Kiểm tra audit evidence nhưng không hiển thị dữ liệu cá nhân không cần thiết.
7. Tắt feature flag và xác nhận phần xử lý hồ sơ còn lại vẫn hoạt động.

Nếu cần database change, thay đổi phải tương thích với cả application version cũ và mới. Có thể deploy trước một outbox index dạng additive hoặc delivery field nullable. Việc xóa column mang tính destructive nên để ở contract phase sau, khi mọi old pod và worker đã biến mất. Kubernetes hỗ trợ thay pod dần bằng `RollingUpdate` và giữ revision history cho rollback, nhưng deployment controller không thể biết workflow của công dân có đúng về mặt nghiệp vụ hay không.

## Promotion lên `main` hoặc `master`, không đi vòng qua nó

Sau khi `dev`, staging và UAT đã có evidence, hãy promotion đúng change đã review lên canonical production branch. Có hai pattern an toàn:

| Pattern | Khi phù hợp | Risk control |
|---|---|---|
| PR từ `dev` vào `main`/`master` | Integration branch đại diện release candidate | Review complete diff và chạy lại required check trên production base |
| Release branch từ commit đã biết | Nhiều change cần stabilize trong một release train | Chỉ fix được duyệt mới vào branch; merge ngược về canonical branch |

Đừng xử lý production release thất bại bằng cách push trực tiếp vào `main` hoặc `master`. Hotfix vẫn nên có branch, PR, check, incident/change reference và follow-up merge về normal line. Tốc độ khẩn cấp nên rút ngắn ceremony, không xóa traceability.

Một repository có cả `main` lẫn `master` cần migration rule. Ví dụ:

```text
Trước migration: master là canonical production; main chỉ là transition read-only.
Sau migration: main là canonical production; master được bảo vệ và trỏ đến release legacy cuối.
```

Trạng thái tệ nhất là hai branch đều nhận manual fix và đều có thể được chọn để deploy.

## Merge không phải deploy, và deploy không phải release

Ba từ này mô tả ba sự kiện khác nhau:

| Event | Điều đã xảy ra | Điều chưa xảy ra |
|---|---|---|
| Commit | Một source snapshot tồn tại | Chưa được review hoặc build |
| Merge | Change đã vào target branch | Chưa chắc đã đến environment nào |
| Build | Artifact đã được tạo | Chưa được chứng minh ở production |
| Deploy | Artifact đã được đặt vào environment | User có thể vẫn bị giữ sau flag hoặc traffic split |
| Release | Capability được chủ động mở cho user | Monitoring và rollback ownership vẫn còn cần thiết |

Production pipeline phải làm rõ các boundary này. Một sequence điển hình:

![Deployment pipeline có cổng CI, immutable artifact, staging/UAT, approval, canary hoặc rolling rollout, smoke test, metrics và rollback](/blog/enterprise-git-feature-to-production/deploy-gates.webp)

```text
PR checks
  -> build và scan
  -> immutable artifact
  -> deploy staging
  -> UAT và smoke test
  -> change approval
  -> canary hoặc rolling production
  -> readiness và smoke check
  -> business và technical metrics
  -> promote hoặc abort
```

GitHub environment có thể gắn protection rule vào từng deployment target; job tham chiếu environment phải vượt qua các rule trước khi chạy hoặc truy cập environment secret. Ở nền tảng CI/CD khác, control tương đương có thể gọi là approval gate, protected environment, change window hoặc deployment policy. Tên gọi ít quan trọng hơn việc tách build credential, staging credential và production credential.

Với feature email, production gate phải trả lời được:

- Artifact có được build từ đúng commit đã review không?
- Authorization và duplicate-event test có pass không?
- Template version có được duyệt và tồn tại trong production config không?
- Mail provider sandbox có chỉ được tắt đúng trong production environment không?
- Queue depth, provider error rate, delivery latency và audit-write failure có quan sát được không?
- Feature flag có default off cho đến khi smoke verification hoàn tất không?
- Ai là owner quyết định promote, pause hoặc rollback?

## Dùng flag để giảm blast radius, không che giấu code chưa xong

Production deploy có thể chứa code chưa mở cho mọi operator. Điều đó hữu ích khi code đang disable vẫn backward-compatible và đã được test. Rollout có thể đi như sau:

```text
0% enabled -> internal test account -> one office or cohort -> 5% -> 25% -> 100%
```

Flag phải có scope, audit và khả năng reverse. Nó không được trở thành một điều kiện vĩnh viễn khiến hệ thống không thể reasoning. Mỗi flag cần owner, expiry hoặc cleanup issue, default value và kill-switch procedure.

Với action gửi email trong dịch vụ công, cohort có thể an toàn hơn random percentage. Bắt đầu bằng synthetic account hoặc internal account, sau đó một đơn vị vận hành nhỏ đã đồng ý quan sát workflow. Không mở feature ngay cho nhóm hồ sơ có template đặc biệt hoặc câu chữ pháp lý chưa qua UAT.

## Rolling update, canary và rollback là ba control khác nhau

Rolling update thay đổi instance theo từng phần. Canary expose một traffic slice hoặc user cohort nhỏ cho version mới. Feature flag điều khiển capability exposure độc lập với process rollout. Ba control có thể kết hợp, nhưng không cái nào thay thế hoàn toàn hai cái còn lại.

Kubernetes tài liệu hóa `RollingUpdate`, readiness, rollout status, revision history và rollback về revision trước. Các primitive đó trả lời pod có được thay dần không và deployment có đang tiến triển không. Chúng không chứng minh đúng công dân đã nhận đúng message. Business metrics cũng phải là một phần của release signal.

Với feature này, hãy định nghĩa abort threshold trước khi deploy:

| Signal | Cách diễn giải | Hành động |
|---|---|---|
| Authorization-denied rate | Tăng bất thường có thể cho thấy policy hoặc claim regression | Pause, điều tra, không mở rộng cohort |
| Duplicate provider request rate | Regression ở idempotency hoặc retry | Tắt flag và dừng promotion worker |
| Mail provider 4xx/5xx | Lỗi template, credential, quota hoặc provider | Chuyển pending/failed; retry có giới hạn |
| Outbox-to-delivery latency | Queue hoặc worker bị quá tải | Giữ rollout; scale hoặc sửa trước khi mở rộng |
| Audit write failure | Evidence boundary đang suy giảm | Chặn side effect hoặc thực hiện fail-safe policy đã định nghĩa |
| Citizen support complaint | Vấn đề ngữ nghĩa/template không thấy được qua hạ tầng | Dừng feature và review content path |

Rollback có nhiều lớp:

1. **Tắt feature flag** để cán bộ mới không tạo thêm side effect.
2. **Dừng hoặc drain worker** nếu queued event không còn an toàn để xử lý.
3. **Rollback application artifact** nếu code có lỗi.
4. **Reconcile accepted event** với provider và audit store.
5. **Giao tiếp trung thực** về những notification đã được accepted hoặc delivered.

Rollback code không thể thu hồi một email đã gửi. Vì vậy, business event, delivery status và audit trail phải được thiết kế trước khi button được merge.

## Enterprise checklist

| Gate | Evidence cần có | Anti-pattern |
|---|---|---|
| Tạo branch | Short-lived branch, scope bounded | Một branch chứa nhiều feature không liên quan |
| Design | Contract cho actor, state, side effect, audit và recovery | UI-first, authorization ngầm |
| Local validation | Lint, test, type check và build có thể reproduce | “CI sẽ bắt được” sau một diff khổng lồ |
| Review | Domain, security, operations và code-owner review khi cần | Approval nhưng không đọc negative path |
| Integration | PR vào `dev`, check trên current base, contract test | Merge branch xanh nhưng không queue/rebase validation |
| Artifact | Commit SHA, image digest, dependency/security evidence | Build lại riêng cho từng environment |
| Staging/UAT | Synthetic citizen data, mail sandbox, operator journey | Gửi test notification đến recipient thật |
| Production promotion | Protected `main`/`master`, approval, change record | Push vòng qua branch protection |
| Rollout | Flag, canary/rolling, readiness và smoke check | Enable 100% ngay sau deploy |
| Verification | Technical, business, delivery và audit metrics | Chỉ xem HTTP 200 và CPU |
| Recovery | Flag-off, worker control, artifact rollback, reconciliation | Nghĩ rollback đảo ngược được external side effect |

Mục tiêu không phải làm mọi thay đổi nhỏ trở nên chậm. Mục tiêu là làm risk lộ diện trước khi biến thành incident. Branch nhỏ, test nhanh, branch được bảo vệ, artifact immutable và exposure có thể reverse giúp team đi nhanh mà không giả vờ rằng một workflow dịch vụ công chỉ là một CRUD screen.

Ở my company, “done” không có nghĩa button đã hiển thị. Nó có nghĩa đúng actor chỉ dùng được action ở đúng workflow state, event có thể retry mà không tạo duplicate side effect, release truy được về source snapshot đã duyệt, và team biết chính xác cách dừng feature khi thực tế không giống kế hoạch.

Đó mới là con đường từ feature branch đến production: không phải một chuỗi Git command, mà là một chuỗi quyết định có người chịu trách nhiệm.

## Tài liệu tham khảo

[1]: https://dora.dev/capabilities/trunk-based-development/ "DORA — Trunk-based development"
[2]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches "GitHub Docs — About protected branches"
[3]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue "GitHub Docs — Managing a merge queue"
[4]: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments "GitHub Docs — Managing environments for deployment"
[5]: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ "Kubernetes Documentation — Deployments"

## Đọc thêm

- [Zero-Downtime Deployment: Kỹ thuật Canary Release & DB Migration an toàn trên K8s](/blog/zero-downtime-canary-db-migration)
- [Schema Evolution trong Event-Driven System: Compatibility, Rollback và Data Contract](/blog/schema-evolution-event-driven-compatibility-rollback)
- [AI Action có tính Idempotent: Retry Tool Call mà không nhân đôi Side Effect](/blog/idempotent-ai-actions)
- [Incident Response cho AI Agent: Kill Switch, Evidence Pack và Degradation an toàn](/blog/ai-agent-incident-response)
