---
title: "Sandbox cho Code do LLM tạo: Chạy Tool và Code Agent an toàn trên Kubernetes"
description: "Thiết kế runtime boundary thực tế cho code agent: process isolation, container, gVisor hoặc microVM, network egress, quota, artifact và cleanup."
pubDate: 2026-07-27
category: "security"
image: "/blog/llm-code-sandbox/hero.webp"
lang: "vi"
translationKey: "llm-code-sandbox-kubernetes"
draft: false
---

![Một gói code do LLM tạo đi vào execution chamber nhiều lớp được bảo vệ](/blog/llm-code-sandbox/hero.webp)

<figure class="blog-video">
  <video controls preload="metadata" playsinline poster="/blog/llm-code-sandbox/hero.webp" aria-label="Video giải thích nội dung bài viết, phiên bản tiếng Việt">
    <source src="/blog/llm-code-sandbox-kubernetes/video-vi.mp4" type="video/mp4" />
    Trình duyệt của bạn không hỗ trợ video HTML5.
  </video>
  <figcaption>Video giải thích chuyên sâu: phiên bản tiếng Việt.</figcaption>
</figure>

Cho AI agent một read-only search tool là một chuyện. Cho nó Python interpreter, shell, browser hoặc quyền cài package là chuyện hoàn toàn khác.

Code có thể hữu ích. Nó cũng có thể chứa vòng lặp vô hạn do tình huống mơ hồ, network call ngoài dự kiến, dependency có lỗ hổng, instruction bị prompt injection hoặc một thư viện bình thường đọc nhiều filesystem hơn product dự định. Model không cần có ý đồ xấu thì execution boundary mới thất bại.

Vì vậy, “model đã aligned” không phải runtime security strategy. Model chọn code hoặc tool call. Một execution environment riêng quyết định code nhìn thấy gì, chạy bao lâu, được syscall nào, ghi ở đâu và output có được phép quay lại application hay không.

Bài viết tập trung vào cách chạy code do LLM tạo và agent tool trên Kubernetes. Tôi so sánh process isolation, container, user-space kernel như gVisor và microVM. Sau đó chuyển so sánh thành lifecycle cụ thể với network policy, filesystem rule, CPU/memory quota, artifact handling và cleanup.

> **Luận điểm:** Hãy xem generated code là untrusted input dù nó đến từ model của chính bạn. Security boundary là runtime, không phải prompt, và Kubernetes là orchestrator—not a complete sandbox by itself.

## Sandbox đang bảo vệ điều gì?

Sandbox không chỉ bảo vệ host kernel. Nó bảo vệ nhiều resource với failure mode khác nhau.

| Resource | Failure ví dụ | Boundary quan trọng |
|---|---|---|
| Host và cluster | Privilege escalation hoặc kernel exploit | Runtime isolation, pod security, node hardening. |
| Network | Exfiltration, scan, external call tốn kém | Egress policy, DNS control, proxy allowlist. |
| Filesystem | Đọc secret hoặc host-mounted data | Read-only root, workspace rỗng, mount explicit. |
| Compute | Infinite loop, fork bomb, GPU starvation | CPU, memory, PID, wall-clock, concurrency quota. |
| Credential | Cloud metadata hoặc service-account abuse | Không ambient credential; identity ngắn hạn, scoped. |
| Data | Cross-tenant hoặc cross-workflow access | Namespace, object scope và artifact policy riêng. |
| Supply chain | Package độc hoặc vulnerable | Dependency policy, mirror, scan và reproducible build. |

Threat model hữu ích phải bao gồm cả accident. Agent có thể viết vòng lặp vì task không rõ. Script phân tích dữ liệu có thể đọc environment variable khi tìm file. Package installation có thể chạy build hook. Control phải hoạt động khi code sai, không chỉ khi code có tính adversarial.

## Isolation có nhiều lớp và mỗi lớp hứa một điều khác

Từ “sandbox” che giấu những khác biệt quan trọng. Process boundary, container, gVisor và microVM không cung cấp cùng một security property.

![Execution boundary nhiều lớp chặn network, filesystem, secret và identity quanh generated code](/blog/llm-code-sandbox/isolation-layers.webp)

| Lựa chọn | Cô lập gì | Điểm yếu chính | Trường hợp phù hợp |
|---|---|---|---|
| Process restriction | User, file, CPU và syscall trong host | Dùng chung host kernel; bỏ sót capability có thể nghiêm trọng. | Task nội bộ rủi ro thấp, được kiểm soát chặt. |
| Container | Filesystem view, namespace, cgroup, capability | Dùng chung host kernel và có thể kế thừa config nguy hiểm. | Workload chung với pod hardening tốt. |
| gVisor hoặc user-space kernel | Chèn user-space kernel giữa workload và host | Trade-off compatibility và performance. | Multi-tenant execution rủi ro cao nhưng vẫn cần Kubernetes. |
| MicroVM | Virtual machine boundary nhỏ quanh workload | Startup, image management và vận hành phức tạp. | Untrusted code cần blast-radius mạnh hơn. |

Không lựa chọn nào “secure” trong mọi hoàn cảnh. Quyết định phụ thuộc capability của code, độ nhạy tenant, hành vi package, latency budget và mức failure platform chịu được. Tính toán trên bảng dữ liệu đã sanitize khác hẳn arbitrary shell execution có network.

Kubernetes cung cấp namespace, service account, admission policy, resource quota, network policy, secret management, scheduling và lifecycle event. Nó không tự biến pod thành security boundary hoàn chỉnh. Privileged container, host path mount, service account rộng, egress không giới hạn hoặc image không tin cậy có thể phá hỏng kiến trúc xung quanh.

## Định nghĩa execution contract trước khi viết YAML

Sandbox nên nhận một execution contract rõ ràng. Contract được tạo bởi application policy layer, không phải bởi model.

```json
{
  "execution_id": "exec_01J...",
  "tenant_id": "tenant-17",
  "language": "python",
  "entrypoint": "main.py",
  "wall_clock_ms": 8000,
  "cpu_millis": 500,
  "memory_bytes": 536870912,
  "pids": 64,
  "network": "deny",
  "filesystem": "workspace-readwrite-only",
  "packages": "approved-mirror-only",
  "artifacts": {"max_bytes": 10485760, "types": ["text", "image"]}
}
```

Model có thể đề xuất code nhưng không được mở rộng contract. Nếu task thực sự cần network, application phải chọn capability có tên như `http.read:weather.example` với giới hạn thời gian và response nhỏ. “Bật internet vì script lỗi” không phải recovery strategy.

Contract nên immutable trong execution attempt. Nếu agent cần thêm authority, nó phải tạo request mới đi qua policy evaluation và, với hành động nhạy cảm, human hoặc service approval gate. Như vậy generated script không thể thương lượng với sandbox trong lúc nó đang chạy.

## Kubernetes pod là disposable envelope

Pod hardening cơ bản phải được xem là minimum, không phải kiến trúc hoàn chỉnh:

```yaml
apiVersion: v1
kind: Pod
metadata:
  labels:
    workload: llm-sandbox
spec:
  automountServiceAccountToken: false
  restartPolicy: Never
  containers:
    - name: runner
      image: registry.example/sandbox-python:2026.07
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
        seccompProfile:
          type: RuntimeDefault
      resources:
        requests:
          cpu: "250m"
          memory: "256Mi"
        limits:
          cpu: "500m"
          memory: "512Mi"
      volumeMounts:
        - name: workspace
          mountPath: /workspace
  volumes:
    - name: workspace
      emptyDir:
        medium: Memory
        sizeLimit: 64Mi
```

Ví dụ cố ý bỏ ambient service-account credential và làm root filesystem read-only. Workload cũng có ephemeral workspace nhỏ thay vì host path. Trong thực tế, dùng admission policy để reject pod đòi privileged mode, host networking, host PID, host path, capability nguy hiểm hoặc image ngoài approved registry.

`emptyDir` không tự động là private với mọi process trên node, và memory-backed volume không phải data deletion guarantee. Platform vẫn cần node hardening, runtime isolation phù hợp và cleanup policy cho artifact với log.

## Network egress là một permission độc lập

Nhiều sandbox tập trung vào file và quên network. Với code execution, điều đó ngược lại. Script không đọc được `/etc/secrets` vẫn có thể exfiltrate nếu được gọi host tùy ý. Nó có thể download package, scan internal service, gọi cloud metadata endpoint hoặc tạo external workload đắt tiền.

Hãy bắt đầu bằng deny-by-default egress. Nếu execution cần network, route qua controlled proxy hoặc egress gateway enforce destination, method, response size, timeout và audit policy. Block metadata endpoint và private address range trừ khi named capability cho phép.

```text
sandbox -> network policy -> egress proxy -> approved destination
       \
        -> DNS policy and audit record
```

DNS cần được chú ý. Cho public DNS nhưng block direct egress vẫn có thể làm rò thông tin qua query, resolve malicious destination hoặc khiến policy không nhất quán. Dùng controlled resolver và record decision.

Network policy không thay application authorization. Destination allowlist không nên là nơi duy nhất quyết định tenant được đọc document hoặc gọi write API. Sandbox chỉ nên nhận data và credential cần cho task cụ thể.

## Filesystem, secret và artifact

Workspace an toàn nhất bắt đầu rỗng. Chỉ mount input file do application chọn, tốt nhất read-only hoặc copy vào workspace cô lập sau khi malware và type check. Không mount application source tree, Docker socket, host path, Kubernetes credential hay shared volume rộng.

Secret không nên là environment variable trong runner. Dù process không đọc được file khác, nó vẫn có thể print environment, đưa secret vào artifact hoặc gửi qua channel được phép. Nếu capability cần credential, inject short-lived token qua broker hẹp và redact khỏi log cùng output trả về.

Artifact cũng là boundary. Generated code có thể tạo file rất lớn, archive độc, script đuôi đánh lừa hoặc output chứa input nhạy cảm. Platform nên enforce:

| Artifact control | Mục đích |
|---|---|
| Số lượng và kích thước tối đa | Ngăn storage và response exhaustion. |
| Media type được phép | Không xem arbitrary bytes là document an toàn. |
| Content scan | Tìm secret, malware indicator và data không được phép. |
| Provenance | Lưu execution, tenant, code hash và policy version. |
| Quarantine | Giữ file rủi ro trước khi đưa vào workflow khác. |
| Expiry | Xóa artifact tạm theo retention policy. |

Application nên trả structured result nhỏ thay vì pipe toàn bộ workspace ngược vào model. Result reference có thể được inspect ở step sau nếu step đó được authorize.

## Time, memory và process limit là correctness control

Sandbox chạy vô hạn là một denial-of-service tool. Hãy đặt wall-clock timeout, CPU quota, memory limit, PID limit, output limit, file-size limit và concurrency limit. Enforce bên ngoài process cũng như bên trong. Process có thể bỏ qua timer của chính nó; supervisor thì không.

Phân biệt thời gian schedule, start, execution và collect artifact. Nếu workload đang chờ image hoặc package download, wall-clock budget vẫn phải chạy. Nếu không, queue gồm những job “gần xong” có thể ăn hết cluster.

Cleanup phải chạy trên mọi terminal path: success, timeout, cancellation, admission rejection, node drain, worker crash và policy violation. Dùng finalizer hoặc controller có thể tìm execution mồ côi theo execution ID và tenant. Đừng dựa vào model để nói job đã hoàn tất.

![Lifecycle đi từ code request qua policy check, ephemeral runtime, quota, artifact scan và teardown](/blog/llm-code-sandbox/policy-lifecycle.webp)

## Tool call cũng cần runtime boundary

Code sandbox không chỉ dành cho Python interpreter. Browser automation, shell command, data connector, notebook kernel và package manager đều là runtime surface.

Định nghĩa mỗi loại như capability với input/output limit rõ ràng:

```text
python.execute:
  input: approved files only
  network: deny
  max_runtime: 8s
  output: structured text plus approved images

http.read:
  destinations: weather.example only
  methods: GET
  response: 1 MiB maximum
  credentials: none

browser.fetch:
  domains: approved documentation sites
  downloads: disabled
  cookies: isolated per execution
```

Model không được chuyển từ `python.execute` sang `shell.execute` chỉ vì Python thiếu package. Runtime phải reject nỗ lực gọi tool ngoài authority envelope hiện tại. Đây là lớp khác với prompt-injection defense: kể cả model theo instruction xấu, execution boundary vẫn giới hạn kết quả.

## Observability nhưng không biến log thành data leak

Sandbox cần đủ evidence để debug execution lỗi, nhưng capture tất cả sẽ tạo một sensitive-data store mới. Hãy lưu metadata có cấu trúc: execution ID, tenant, code hash, image digest, policy version, timestamp, exit reason, resource peak, egress decision, artifact reference và cleanup status.

Mặc định không log source code, environment variable, raw file content hay full network payload. Nếu khách hàng opt-in debug, áp retention và redaction policy explicit. Correlate execution với agent trace bằng internal ID và vẫn giữ tenant-scoped access control.

Metric nên gồm rejection rate, queue time, startup time, runtime, timeout rate, OOM rate, artifact scan result, cleanup lag, egress denial và resource usage theo tenant. Timeout tăng có thể do generated code xấu; startup tăng có thể do cluster pressure; egress denial tăng có thể do capability contract sai. Metric nên giúp phân biệt ba trường hợp.

## Test boundary bằng code hostile và accidental

Test suite nên có code không nhất thiết độc nhưng cư xử tệ:

```python
while True:
    pass
```

```python
import os
print(dict(os.environ))
```

```python
from pathlib import Path
print([str(p) for p in Path('/').rglob('*')][:1000])
```

Ngoài ra hãy test network probing, fork attempt, oversized output, archive bomb, package build hook, symlink traversal, signal handling, child-process creation, cancellation, duplicate cleanup event và node biến mất giữa execution. Kết quả kỳ vọng không nhất thiết là error message đẹp. Invariant là execution không vượt authority đã khai báo và platform đi tới terminal state nhìn thấy được.

Chạy test trên đúng runtime image, admission policy, network policy, node class và Kubernetes version dùng ở production. Local Docker demo không phải bằng chứng cho production cluster boundary.

## Chọn điểm bắt đầu

| Workload | Điểm bắt đầu hợp lý |
|---|---|
| Transformation nội bộ, deterministic, rủi ro thấp | Hardened container, không network, quota chặt. |
| Phân tích dữ liệu khách hàng | Hardened container cộng runtime mạnh hơn và storage scoped theo tenant. |
| Arbitrary package execution | gVisor hoặc microVM, approved package mirror, scan và egress proxy. |
| Code execution multi-tenant nhạy cảm | Namespace hoặc environment riêng, runtime isolation mạnh và secret độc lập. |
| Browser hoặc shell có external access | Capability service riêng, proxy, cookie cô lập và domain policy explicit. |

Điểm quan trọng không phải ngay lập tức chọn option cô lập nhất. Là team có thể nêu threat model và chứng minh boundary đã chọn xử lý được nó hay không. Một capability nhỏ nhưng an toàn tốt hơn sandbox lớn mà không ai từng test giới hạn.

## Kết luận

LLM-generated code là input của runtime. Nó không phải teammate đáng tin, kể cả khi model chạy private và prompt do kỹ sư viết. Runtime phải giả định mistake, ambiguity, dependency độc, data access tình cờ và failure ở mọi lifecycle stage.

Kubernetes có thể điều phối lifecycle, quota, policy, scheduling và observability. Nó không tự quyết định code nào an toàn. Container giảm blast radius nhưng không biến egress mở hoặc ambient credential thành thiết kế an toàn. gVisor và microVM làm mạnh hơn kernel boundary, nhưng vẫn cần data, identity, network, artifact và cleanup policy đúng.

Câu hỏi production không phải “agent có thể chạy code không?” mà là **execution này nhận authority chính xác nào, trong bao lâu, trên resource nào, và evidence nào chứng minh authority đã kết thúc?**

Nếu câu trả lời rõ, có giới hạn, test được và revoke được, code execution có thể trở thành capability hữu ích. Nếu câu trả lời là “prompt bảo model cẩn thận”, hệ thống vẫn chưa được sandbox đúng nghĩa.

## Tài liệu tham khảo

[1]: [Kubernetes — Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
[2]: [Kubernetes — Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
[3]: [gVisor — A container sandbox](https://gvisor.dev/docs/)
[4]: [Firecracker — Secure and fast microVMs](https://firecracker-microvm.github.io/)
[5]: [Kubernetes — Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
[6]: [Do Quoc Viet — MCP is not an API wrapper](https://vietdoo.vndo.vn/blog/mcp-is-not-an-api-wrapper)
