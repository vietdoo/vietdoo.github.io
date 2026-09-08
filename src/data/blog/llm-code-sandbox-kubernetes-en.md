---
title: "Sandboxing LLM-Generated Code: Running Agent Tools Safely on Kubernetes"
description: "A practical runtime boundary for code agents: process isolation, containers, gVisor or microVMs, network egress, quotas, artifacts, and cleanup."
pubDate: 2026-07-27
category: "security"
image: "/blog/llm-code-sandbox/hero.webp"
lang: "en"
translationKey: "llm-code-sandbox-kubernetes"
draft: false
---

![An LLM-generated code package entering a layered guarded execution chamber](/blog/llm-code-sandbox/hero.webp)

<figure class="blog-video">
  <video controls preload="metadata" playsinline poster="/blog/llm-code-sandbox/hero.webp" aria-label="Explainer video for this article, English version">
    <source src="/blog/llm-code-sandbox-kubernetes/video-en.mp4" type="video/mp4" />
    Your browser does not support HTML5 video.
  </video>
  <figcaption>Deep-dive explainer video: English version.</figcaption>
</figure>

Giving an AI agent a read-only search tool is one thing. Giving it a Python interpreter, a shell, a browser, or the ability to install a package is another.

The code may be useful. It may also contain an accidental infinite loop, an unexpected network call, a dependency with a known vulnerability, a prompt-injected instruction, or a perfectly ordinary library that reads more of the filesystem than the product intended. The model does not need to be malicious for the execution boundary to fail.

This is why “the model is aligned” is not a runtime security strategy. The model chooses code or a tool call. A separate execution environment decides what that code can see, how long it may run, which syscalls it can make, where it can write, and whether its output is allowed back into the application.

This article focuses on running LLM-generated code and agent tools on Kubernetes. It compares process isolation, containers, user-space kernels such as gVisor, and microVMs. It then turns the comparison into a concrete lifecycle with network policy, filesystem rules, CPU and memory quotas, artifact handling, and cleanup.

> **The thesis:** Treat generated code as untrusted input even when it came from your own model. The safety boundary is the runtime, not the prompt, and Kubernetes is an orchestrator—not a complete sandbox by itself.

## What the sandbox is protecting

A sandbox is not only protecting the host kernel. It is protecting several resources with different failure modes.

| Resource | Example failure | Boundary that matters |
|---|---|---|
| Host and cluster | Privilege escalation or kernel exploit | Runtime isolation, pod security, node hardening. |
| Network | Exfiltration, scanning, expensive external calls | Egress policy, DNS control, proxy allowlist. |
| Filesystem | Reading secrets or host-mounted data | Read-only root, empty workspace, explicit mounts. |
| Compute | Infinite loop, fork bomb, GPU starvation | CPU, memory, PID, wall-clock, concurrency quotas. |
| Credentials | Cloud metadata or service-account abuse | No ambient credentials; short-lived scoped identity. |
| Data | Cross-tenant or cross-workflow access | Separate namespace, object scope, and artifact policy. |
| Supply chain | Malicious or vulnerable package | Dependency policy, mirror, scan, and reproducible build. |

A useful threat model includes accidents. An agent may write a loop because the task was ambiguous. A generated data analysis script may read environment variables while trying to discover a file path. A package installation may execute build hooks. The control must work when the code is wrong, not only when the code is adversarial.

## Isolation has layers, and each layer has a different promise

The word “sandbox” hides important differences. A process boundary, a container, gVisor, and a microVM do not provide the same security properties.

![A layered execution boundary blocks network, filesystem, secret, and identity access around generated code](/blog/llm-code-sandbox/isolation-layers.webp)

| Option | What it isolates | Main weakness | Appropriate use |
|---|---|---|---|
| Process restrictions | User, file, CPU, and syscall behavior within the host | Shares the host kernel; a missed capability can be serious. | Low-risk, tightly controlled internal tasks. |
| Container | Filesystem view, namespaces, cgroups, capabilities | Shares the host kernel and may inherit risky configuration. | General workloads with strong pod hardening. |
| gVisor or similar user-space kernel | Interposes a user-space kernel between workload and host | Compatibility and performance trade-offs. | Higher-risk multi-tenant execution where Kubernetes is still useful. |
| MicroVM | A small virtual machine boundary around the workload | Startup time, image management, and operational complexity. | Untrusted code with a stronger blast-radius requirement. |

No option is “secure” in the abstract. The right choice depends on code capability, tenant sensitivity, expected package behavior, latency budget, and how much failure the platform can tolerate. A calculation over a sanitized table has a different risk profile from arbitrary shell execution with network access.

Kubernetes adds valuable controls: namespaces, service accounts, admission policy, resource quotas, network policy, secrets management, scheduling, and lifecycle events. It does not automatically convert a pod into a complete security boundary. A privileged container, host path mount, broad service account, unrestricted egress, or untrusted image can defeat the design around it.

## Define an execution contract before writing YAML

The sandbox should receive an explicit execution contract. The contract is created by the application policy layer, not by the model.

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

The model can propose code, but it cannot expand this contract. If a task genuinely needs network access, the application should choose a named capability such as `http.read:weather.example` with a small time and response limit. “Enable internet because the script failed” is not a recovery strategy.

The contract should be immutable for the execution attempt. If the agent needs more authority, it should create a new request that passes policy evaluation and, for sensitive actions, a human or service approval gate. This prevents a generated script from negotiating with the sandbox while it is already running.

## The Kubernetes pod is a disposable envelope

A basic pod hardening profile should be treated as a minimum, not a final architecture:

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

The example intentionally removes ambient service-account credentials and makes the root filesystem read-only. It also gives the workload a small ephemeral workspace rather than a host path. In practice, use admission policies to reject pods that request privileged mode, host networking, host PID, host paths, unsafe capabilities, or images outside an approved registry.

`emptyDir` is not automatically private from every other process on the node, and a memory-backed volume is not a data deletion guarantee. The platform needs node hardening, appropriate runtime isolation, and a cleanup policy for artifacts and logs.

## Network egress is a first-class permission

Many sandbox designs focus on files and forget the network. That is backwards for code execution. A script with no access to `/etc/secrets` can still exfiltrate data if it can reach arbitrary hosts. It can also download packages, scan internal services, call cloud metadata endpoints, or create an expensive external workload.

Start with deny-by-default egress. If an execution needs network access, route it through a controlled proxy or egress gateway that enforces destination, method, response size, timeout, and audit policy. Block metadata endpoints and private address ranges unless a named capability explicitly allows them.

```text
sandbox -> network policy -> egress proxy -> approved destination
       \
        -> DNS policy and audit record
```

DNS deserves attention. Allowing DNS to the public internet while blocking direct egress can still leak information through queries, resolve a malicious destination, or make policy interpretation inconsistent. Use a controlled resolver and record the decision.

Network policy is not a substitute for application authorization. A destination allowlist should not be the only thing deciding whether a tenant can read a document or call a write API. The sandbox should receive only the data and credentials that the specific task requires.

## Filesystem, secrets, and artifacts

The safest workspace starts empty. Mount only the input files selected by the application, ideally as read-only objects or copied into an isolated workspace after malware and type checks. Do not mount the application source tree, the Docker socket, host paths, Kubernetes credentials, or a broad shared volume.

Secrets should not be environment variables in the runner. Even if the process cannot read another file, it can often print its environment, include it in an artifact, or send it through an allowed channel. If a capability needs a credential, inject a short-lived token through a narrow broker and redact it from logs and returned output.

Artifacts are another boundary. Generated code can produce a large file, a malicious archive, a script with a misleading extension, or output that contains sensitive input. The platform should enforce:

| Artifact control | Purpose |
|---|---|
| Maximum count and size | Prevent storage and response exhaustion. |
| Allowed media types | Avoid treating arbitrary bytes as safe documents. |
| Content scan | Detect secrets, malware indicators, and disallowed data. |
| Provenance | Record execution, tenant, code hash, and policy version. |
| Quarantine | Hold risky files before they enter downstream workflows. |
| Expiry | Delete temporary artifacts according to retention policy. |

The application should return a small structured result rather than piping the entire workspace back to the model. A result reference can be inspected by a later, authorized step.

## Time, memory, and process limits are correctness controls

A sandbox that can run forever is a denial-of-service tool. Set wall-clock timeout, CPU quota, memory limit, PID limit, output limit, file-size limit, and concurrency limit. Enforce them outside the process as well as inside it. A process may ignore its own timer; the supervisor should not.

Distinguish time to schedule, time to start, execution time, and time to collect artifacts. If a workload is waiting for an image or a package download, the wall-clock budget should still apply. Otherwise a queue of “almost finished” jobs can consume the cluster.

Cleanup should happen on every terminal path: success, timeout, cancellation, admission rejection, node drain, worker crash, and policy violation. Use a finalizer or controller that can find orphaned executions by execution ID and tenant. Do not rely on the model to say that the job is complete.

![The execution lifecycle moves from code request through policy checks, ephemeral runtime, quotas, artifact scan, and teardown](/blog/llm-code-sandbox/policy-lifecycle.webp)

## Tool calls need a runtime boundary too

A code sandbox is not only for a Python interpreter. Browser automation, shell commands, data connectors, notebook kernels, and package managers are all runtime surfaces.

Define each as a capability with explicit input and output limits:

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

The model should not be able to switch from `python.execute` to `shell.execute` because Python lacks a package. The runtime should reject an attempt to call a tool that is not in the current authority envelope. This is a different layer from prompt-injection defense: even if the model follows a malicious instruction, the execution boundary should limit the result.

## Observability without turning logs into a data leak

A sandbox needs enough evidence to debug a failed execution, but capturing everything creates a new sensitive-data store. Record structured metadata: execution ID, tenant, code hash, image digest, policy version, start and end timestamps, exit reason, resource peaks, egress decisions, artifact references, and cleanup status.

Do not log source code, environment variables, raw file contents, or full network payloads by default. If a customer opts into debugging, apply an explicit retention and redaction policy. Correlate the execution with the agent trace using an internal ID, while keeping tenant-scoped access controls.

Metrics should include rejection rate, queue time, startup time, runtime, timeout rate, OOM rate, artifact scan result, cleanup lag, egress denials, and per-tenant resource usage. A rising timeout rate may mean bad generated code; a rising startup time may mean cluster pressure; a rising egress denial rate may mean the capability contract is wrong. The metrics should help distinguish those cases.

## Test the boundary with hostile and accidental code

The test suite should include code that is not malicious but behaves badly:

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

Also test network probing, fork attempts, oversized output, archive bombs, package build hooks, symlink traversal, signal handling, child-process creation, cancellation, duplicate cleanup events, and a node disappearing during execution. The expected result is not necessarily a clean error message. The invariant is that the execution cannot escape its declared authority and that the platform reaches a visible terminal state.

Run these tests against the exact runtime image, admission policy, network policy, node class, and Kubernetes version used in production. A local Docker demo is not evidence for a production cluster boundary.

## Choosing a starting point

| Workload | Reasonable starting point |
|---|---|
| Internal, low-risk deterministic transformations | Hardened container, no network, strict quotas. |
| Customer-provided data analysis | Hardened container plus stronger runtime and tenant-scoped storage. |
| Arbitrary package execution | gVisor or microVM, approved package mirror, scan and egress proxy. |
| Sensitive multi-tenant code execution | Dedicated namespace or environment with stronger runtime isolation and independent secrets. |
| Browser or shell with external access | Separate capability service, proxy, isolated cookies, and explicit domain policy. |

The important decision is not whether to adopt the most isolated option immediately. It is whether the team can state the threat model and prove that the selected boundary addresses it. A small safe capability is better than a large sandbox whose limits nobody has tested.

## Closing perspective

LLM-generated code is an input to a runtime. It is not a trusted teammate, even when the model is hosted privately and the prompt was written by an engineer. The runtime must assume mistakes, ambiguity, malicious dependencies, accidental data access, and failure at every lifecycle stage.

Kubernetes can coordinate the lifecycle, quotas, policy, scheduling, and observability. It cannot decide what code is safe by itself. Containers can reduce the blast radius. They cannot turn unrestricted egress or ambient credentials into a safe design. gVisor and microVMs can strengthen the kernel boundary. They still need correct data, identity, network, artifact, and cleanup policies.

The production question is therefore not “can the agent run code?” It is **what exact authority does this execution receive, for how long, against which resources, and what evidence proves that the authority ended?**

If the answer is explicit, bounded, testable, and revocable, code execution can become a useful capability. If the answer is “the prompt tells the model to be careful,” the system is not sandboxed yet.

## References

[1]: [Kubernetes — Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
[2]: [Kubernetes — Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
[3]: [gVisor — A container sandbox](https://gvisor.dev/docs/)
[4]: [Firecracker — Secure and fast microVMs](https://firecracker-microvm.github.io/)
[5]: [Kubernetes — Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
[6]: [Do Quoc Viet — MCP is not an API wrapper](https://vietdoo.vndo.vn/blog/mcp-is-not-an-api-wrapper)
