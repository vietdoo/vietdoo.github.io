---
title: "Software Supply Chain cho Code do AI tạo: Provenance, SBOM và Policy Gate trước Production"
description: "Coding agent giúp tăng tốc delivery nhưng không tự động làm software supply chain đáng tin cậy. Bài viết thiết kế chain-of-custody từ thay đổi do agent tạo đến build có chữ ký, SBOM và quyết định release."
pubDate: 2026-04-09
category: "security"
image: "/blog/ai-code-supply-chain-policy-gates/ai-code-supply-chain-cover.webp"
lang: "vi"
translationKey: "ai-code-supply-chain-policy-gates"
draft: false
---

![Sơ đồ supply chain phần mềm vẽ tay, thể hiện coding agent, source commit, kiểm tra SBOM, provenance có chữ ký và release gate trước production](/blog/ai-code-supply-chain-policy-gates/ai-code-supply-chain-cover.webp)

Coding agent đã thay đổi hình dạng của một software change. Developer có thể mô tả một feature, để agent đọc repository, yêu cầu sửa nhiều file, chạy test và mở pull request trước khi kịp uống hết một tách cà phê. Lợi ích năng suất là có thật. Nhưng giả định về bảo mật thì không tự nhiên đúng theo.

Câu hỏi quan trọng bây giờ không chỉ là: “Diff này có vẻ đúng không?” Mà còn là: “Chúng ta có giải thích được thay đổi này bắt đầu từ đâu, phụ thuộc vào những gì, artifact được tạo bởi build nào, và vì sao hệ thống release cho phép nó đi vào production hay không?”

> **Luận điểm chính:** Đừng coi một thay đổi do AI tạo là đáng tin chỉ vì một người đã lướt qua diff cuối cùng. Hãy coi nó là một sự kiện trong software supply chain, cần có đường đi có thể kiểm chứng từ hoạt động của agent đến source, dependency, build artifact và quyết định release.

Đây không phải là lời kêu gọi cấm coding agent hay lưu toàn bộ prompt riêng tư mãi mãi. Mục tiêu là giữ đủ bằng chứng mà không biến quy trình engineering thành hệ thống giám sát. Một chain-of-custody tốt giúp team trả lời được câu hỏi khi có sự cố, kể cả nhiều tháng sau: thay đổi nào đã đi vào hệ thống, thông qua agent hoặc automation nào, với input nào và dưới các lớp kiểm soát nào?

## Agent là contributor mới, không phải trust boundary mới

Coding agent thường được gọi là một assistant, nhưng về mặt vận hành, nó giống một contributor có throughput rất cao hơn. Nó có thể đọc source file, suy ra convention, chọn dependency, gọi tool, chạy test và đề xuất thay đổi vượt qua nhiều ranh giới mà trước đây được ngăn cách bằng sự chú ý của con người.

Điều đó không có nghĩa agent cần được cấp danh tính như một con người. Nó có nghĩa hệ thống cần ghi nhận context của contribution và giới hạn quyền xung quanh nó. Một mô hình hữu ích là tách ba câu hỏi thường bị gộp làm một:

| Câu hỏi                   | Bằng chứng nên giữ                                                   | Điều bằng chứng đó không chứng minh |
| ------------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| **Đã thay đổi gì?**       | Diff, commit, review decision, test result                           | Code an toàn trong mọi môi trường   |
| **Đã build như thế nào?** | Builder identity, input, timestamp, dependency lock, artifact digest | Builder không bị compromise         |
| **Vì sao được release?**  | Policy evaluation, approval, exception, risk threshold               | Quyết định kinh doanh là sáng suốt  |

SLSA định nghĩa provenance là thông tin có thể kiểm chứng về nơi, thời điểm và cách một software artifact được tạo ra; mục đích là để consumer xác minh artifact được build theo kỳ vọng và, khi phù hợp, có thể build lại. Khái niệm này phù hợp tự nhiên với thay đổi do agent tạo, nhưng cần giữ một ranh giới: build provenance cho biết artifact được tạo như thế nào; nó không chứng nhận reasoning của model là đúng.

Đây là một ranh giới lành mạnh. Nó ngăn việc biến artifact có chữ ký thành con dấu “AI đã approve”. Chữ ký chứng minh quyền kiểm soát signing key và tính toàn vẹn của statement đã ký. Nó không chứng minh dependency là vô hại, function được sinh ra không có lỗi logic, hay reviewer đã hiểu đầy đủ rủi ro.

## Mô hình chain-of-custody

Supply chain thực tế là một chuỗi các bước chuyển tạo ra bằng chứng. Mỗi bước nên tạo một record bền vững, hoặc nói rõ tại sao không giữ record. Tool có thể thay đổi; contract thì không nên thay đổi.

![Sơ đồ chain-of-custody vẽ tay từ AI agent change qua reviewed diff, SBOM và security scan, signed build đến release gate](/blog/ai-code-supply-chain-policy-gates/supply-chain-map.webp)

Một chain tối thiểu có thể là:

```text
agent session hoặc task
        ↓
reviewable diff + commit metadata
        ↓
locked dependency + SBOM + security scan
        ↓
controlled hoặc reproducible build
        ↓
attestation gắn source, builder, input và artifact digest
        ↓
policy decision và release record
```

Transition đầu tiên là nơi nhiều team bỏ sót nhất. Agent có thể tạo một commit nhìn không khác gì commit do developer viết tay. Điều đó thuận tiện cho đến khi incident responder cần tìm tất cả thay đổi được tạo dưới một instruction bị compromise, một phiên bản tool dễ tổn thương hoặc một repository context không an toàn.

Record này không cần chứa toàn bộ prompt. Một contribution envelope có thể lưu task ID ổn định, agent hoặc client class, phiên bản tool policy, repository và base revision, các file bị thay đổi, model provider nếu policy cho phép, cùng hash của session record nhạy cảm đang được lưu theo một retention policy riêng.

```ts
type AgentContribution = {
  contributionId: string;
  repository: string;
  baseRevision: string;
  resultingCommit: string;
  agentClass: "coding-agent" | "human" | "automation";
  clientVersion?: string;
  toolPolicyVersion: string;
  changedPaths: string[];
  sessionEvidenceHash?: string;
  createdAt: string;
};
```

Thiết kế này cố ý vừa đủ. Nó làm cho origin có thể truy vấn mà không giả vờ rằng transcript của prompt là lời giải thích đầy đủ cho code cuối cùng. Nếu team cần forensic sâu hơn, session evidence có thể được lưu trong kho có kiểm soát quyền truy cập và liên kết bằng hash, thay vì copy dữ liệu nhạy cảm vào Git history.

## SBOM là dependency view, không phải toàn bộ câu chuyện

Software bill of materials trả lời câu hỏi: “Artifact này chứa những gì?” Nó cần thiết cho vulnerability response, license review và dependency inventory. Nó không trả lời: “Vì sao thay đổi này tồn tại?” hoặc “Policy nào cho phép nó vào production?”

Với thay đổi do AI tạo, SBOM nên được sinh từ build output hoặc chính dependency lock được dùng để tạo artifact. Sinh SBOM từ working tree chưa build có thể tạo ra mismatch giữa thứ được kiểm tra và thứ được ship. Artifact digest là join key giúp các bằng chứng nối với nhau.

![Thẻ evidence vẽ tay gồm source, build, artifact, commit SHA, agent change ID, dependency lock, builder, timestamp, artifact digest và tài liệu SBOM](/blog/ai-code-supply-chain-policy-gates/provenance-sbom-evidence.webp)

Một evidence envelope hữu ích kết hợp source view và artifact view:

```json
{
  "subject": {
    "name": "registry.example.com/payments-api",
    "digest": "sha256:..."
  },
  "source": {
    "repository": "payments-api",
    "commit": "7f3c9ad",
    "agentContributionId": "agt_01J..."
  },
  "build": {
    "builder": "ci-runner-prod-17",
    "workflow": "release.yml@v4",
    "sourceSnapshot": "sha256:...",
    "dependencyLock": "sha256:..."
  },
  "materials": ["sbom:sha256:...", "container-base:sha256:..."]
}
```

Mô hình provenance của SLSA hữu ích ở đây vì nó cung cấp vocabulary cho source material, build definition, builder, metadata và subject được tạo ra. Các field riêng cho AI nên mở rộng evidence envelope một cách cẩn trọng, không thay thế metadata chuẩn của build.

## Policy gate biến evidence thành quyết định release

Evidence chỉ có giá trị khi hệ thống có thể hành động dựa trên nó. Policy gate là điểm release process đánh giá evidence và quyết định promote, hold hoặc reject artifact.

Gate nên deterministic nếu có thể. “Agent nghe có vẻ tự tin” không phải một control. “Artifact có signature hợp lệ, provenance trỏ tới builder được phép, không có critical vulnerability vượt exception policy, có review bắt buộc và SBOM được đính kèm” là một control có thể test.

![Pipeline release vẽ tay gồm DIFF, TEST, ATTEST và PROMOTE, có barrier BLOCK khi một kiểm tra thất bại](/blog/ai-code-supply-chain-policy-gates/policy-gate-pipeline.webp)

Một policy có thể có hình dạng như sau:

```yaml
policy: production-release-v1
subject:
  requireArtifactDigest: true
source:
  requireReview: true
  requireContributionEnvelope: true
build:
  allowedBuilders:
    - ci://release-runner
  requireSignedProvenance: true
  requireDependencyLock: true
security:
  blockOn:
    - secret-found
    - critical-vulnerability
    - unsigned-artifact
  allowHighSeverityOnlyWith:
    - security-owner-approval
  requireSbom: true
exceptions:
  maxDurationHours: 72
  requireTicket: true
```

Đây chưa phải một security program hoàn chỉnh. Nó là release contract. Contract phải làm failure hiển thị, tạo decision record và phân biệt release bị block với exception được approve. Policy engine âm thầm bỏ qua evidence bị thiếu còn nguy hiểm hơn một engine đơn giản nhưng block rõ ràng.

## Tách pre-commit check khỏi system of record

Agent-side check rất hữu ích vì rút ngắn feedback loop. Tài liệu GitHub mô tả secret scanning qua remote MCP server như một cách scan thay đổi hiện tại trước khi secret chạm vào repository. Tài liệu cũng nêu rõ một giới hạn quan trọng: finding từ MCP là ephemeral và không trở thành GitHub alert bền vững; nó là pre-commit safety check, không phải system of record.

Ranh giới này nên xuất hiện trong kiến trúc. Developer hoặc agent có thể chạy scan nhanh ở local hay trong interactive session, nhưng repository và CI vẫn phải enforce durable gate. Nếu không, một IDE khác, một tool bị tắt hoặc agent config bị thay đổi sẽ tạo ra một đường vòng vô hình quanh control.

| Lớp control                    | Phù hợp nhất cho                              | Failure mode nếu coi là đủ                                    |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------- |
| Agent hoặc IDE scan            | Feedback nhanh khi đang sửa code              | Có thể bị bỏ qua, cấu hình sai hoặc chỉ tồn tại trong session |
| Pull request checks            | Review, test, SAST, dependency check          | Merge path có quyền cao có thể bypass                         |
| Build attestation              | Gắn source, builder, material và artifact     | Không chứng minh source logic là đúng                         |
| Registry hoặc deploy admission | Enforce signature, provenance, SBOM và policy | Policy yếu biến gate thành hình thức                          |
| Incident archive               | Tái dựng decision và phạm vi ảnh hưởng        | Lưu mọi thứ tạo rủi ro privacy và chi phí                     |

GitHub cũng mô tả workflow bảo mật cho AI coding agent có thể phát hiện secret, vulnerability và insecure dependency từ agent mode và tool tương thích MCP. Bài học thực tế không phải là giao toàn bộ chain cho một platform. Đó là xếp lớp interactive assistance với control được enforce ở repository và deployment.

## Nên ghi nhận gì về AI contribution?

Câu trả lời phụ thuộc vào rủi ro và retention. Một thay đổi documentation rủi ro thấp có thể chỉ cần origin label và review bình thường. Một thay đổi về payment authorization, authentication rule hoặc infrastructure policy xứng đáng có evidence mạnh hơn, thậm chí bắt buộc một human owner.

Minimum record hợp lý gồm contribution ID, base revision, resulting commit, changed paths, agent/client class, tool policy version và timestamp. Record assurance cao hơn có thể thêm model family, configuration hash, tool được enable, external retrieval reference, test environment và protected session-evidence hash. Hệ thống không nên lưu secret, customer data hoặc toàn bộ prompt trong commit metadata thông thường.

Dự án SSDF của NIST hiện trỏ tới SP 800-218A, một community profile bổ sung các practice, task, recommendation và consideration dành cho AI vào secure software development lifecycle. Đây là cách framing hữu ích: code do AI tạo nên được đưa vào các outcome của secure development, không nên bị quản lý bởi một “AI checklist” tách rời khỏi các control engineering bình thường.

## Rollout mà không làm team đứng yên

Một supply chain trưởng thành không được cài bằng một cuộc migration lớn duy nhất. Hãy bắt đầu bằng evidence trả lời được các câu hỏi incident có giá trị cao nhất, sau đó mới thêm enforcement khi signal đã đủ tin cậy.

| Giai đoạn        | Bổ sung                                                            | Cần đo trước khi tiến lên                                         |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| **1. Observe**   | Contribution ID, commit label, build metadata, artifact digest     | Team có trace được release về source và builder không?            |
| **2. Inventory** | SBOM từ artifact đã ship, dependency lock, scan result             | SBOM có khớp artifact và còn truy cập được sau release không?     |
| **3. Attest**    | Signed provenance và immutable evidence storage                    | Verifier độc lập có validate được subject và builder không?       |
| **4. Enforce**   | Gate cho signature, critical finding, review và exception          | False positive và bypass có hiển thị, có owner không?             |
| **5. Optimize**  | Risk tier, retention chọn lọc, feedback nhanh, remediation tự động | Control có rút ngắn response time mà không tạo shadow path không? |

Metric đầu tiên không nên là “bao nhiêu phần trăm code được viết bởi AI”. Con số đó khuyến khích team tối ưu volume và có thể tạo incentive sai. Metric tốt hơn là provenance coverage, tỷ lệ release có SBOM, thời gian xác định source của artifact dễ tổn thương, bypass rate của gate và mean time để revoke hoặc quarantine artifact.

## Những thiết kế trông an toàn nhưng chưa đủ

**“Con người đã review diff.”** Review là cần thiết, nhưng diff chỉ là một view. Nó có thể không cho thấy dependency agent đã chọn, build-time script, transitive package hoặc việc artifact được tạo bởi runner không đáng tin.

**“Commit đã sign nên code được trust.”** Commit signature có thể xác thực người giữ key. Nó không chứng minh source được build theo kỳ vọng hay artifact cuối cùng tương ứng với commit đã review. Source signing, build provenance, artifact signing và policy evaluation trả lời các câu hỏi khác nhau.

**“SBOM đã đính kèm trong repository.”** SBOM gắn với branch hoặc working tree có thể drift so với image đã deploy. Hãy bind nó với artifact digest và giữ lại chính input được dùng để sinh SBOM.

**“Agent đã chạy security scan.”** Interactive scan rút ngắn feedback loop. Nó không nên là gate duy nhất. Tài liệu GitHub phân biệt rõ ephemeral MCP scan result với security record bền vững trong repository.

**“Chúng ta sẽ giữ mọi prompt để audit sau này.”** Transcript đầy đủ có thể chứa credential, customer data, proprietary code hoặc thông tin cá nhân không liên quan. Hãy dùng retention theo tầng: metadata ổn định mặc định, protected evidence chỉ cho task rủi ro cao, cùng quy tắc access và deletion rõ ràng.

## Định nghĩa thực tế của trust

Mục tiêu của supply-chain design không phải chứng minh AI an toàn. Mục tiêu là làm cho uncertainty có thể kiểm tra. Khi thay đổi do agent tạo đi vào production, team cần xác định được source revision, contribution context, dependency set, builder, artifact digest, policy result và exception đã làm lệch path bình thường nếu có.

Evidence đó cho engineer nhiều lựa chọn. Họ có thể so sánh các release, quarantine artifact, thay dependency, tìm các thay đổi bị ảnh hưởng, build lại hoặc giải thích quyết định với security reviewer. Không có evidence, thay đổi do AI tạo chỉ là một input opaque khác đang chạy qua một pipeline nhanh.

Kết quả tốt nhất không phải quy trình chậm hơn với nhiều giấy tờ hơn. Đó là hệ thống trong đó thay đổi rủi ro thấp đi nhanh vì evidence được tự động hóa, còn thay đổi rủi ro cao gặp friction có chủ ý trước khi biến thành production incident.

> **Coding agent có thể nhanh mà không trở nên vô hình. Supply chain đáng tin khi mọi transition quan trọng đều để lại bằng chứng mà control kế tiếp có thể kiểm chứng.**

## References

[1]: https://www.langchain.com/state-of-agent-engineering "LangChain — State of Agent Engineering"
[2]: https://cloud.google.com/resources/content/ai-agent-trends-2026 "Google Cloud — AI agent trends 2026 report"
[3]: https://slsa.dev/spec/v1.2/build-provenance "SLSA v1.2 — Build: Provenance"
[4]: https://csrc.nist.gov/projects/ssdf "NIST CSRC — Secure Software Development Framework"
[5]: https://docs.github.com/en/code-security/how-tos/use-ghas-with-ai-coding-agents "GitHub Docs — Use GitHub Advanced Security with AI coding agents"
[6]: https://docs.github.com/en/code-security/how-tos/use-ghas-with-ai-coding-agents/scan-for-secrets-with-github-mcp-server "GitHub Docs — Scanning for secrets with the GitHub MCP server"
