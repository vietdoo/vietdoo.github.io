---
title: "Deletion Guarantee cho AI Agent: Xóa Memory, Tombstone và Audit Evidence"
description: "Playbook production để thực hiện yêu cầu xóa xuyên qua memory, vector index, cache, trace và dữ liệu dẫn xuất của AI agent—chặn retrieval ngay và tạo bằng chứng có thể kiểm chứng."
pubDate: 2026-07-15
category: "engineering"
image: "/blog/ai-agent-deletion-guarantees/hero.webp"
lang: "vi"
translationKey: "ai-agent-deletion-guarantees"
draft: false
---

![Deletion graph vẽ tay cho AI agent truyền yêu cầu xóa từ source record qua memory, vector index, cache, trace và audit evidence](/blog/ai-agent-deletion-guarantees/hero.webp)

Yêu cầu xóa đầu tiên đến dưới dạng một ticket support rất bình thường.

Một khách hàng không yêu cầu chúng tôi cải thiện assistant. Họ yêu cầu assistant quên một cuộc hội thoại, những preference được suy ra từ cuộc hội thoại đó, và các tài liệu họ đã upload trong lúc dùng thử sản phẩm. Nhân viên support bấm “delete”. Dòng chat biến mất. Vài phút sau, assistant vẫn trả lời bằng một preference cũ của khách hàng.

Không có điều gì kỳ bí xảy ra. Source row đã bị xóa, nhưng những bản sao “trông có vẻ hữu ích” thì chưa. Một bản nằm trong bảng long-term memory. Một bản khác đã được embedding vào vector index. Một cached retrieval result vẫn còn nóng. Trace giữ đủ payload để dựng lại văn bản gốc. Nút xóa đã thành công ở một storage layer và thất bại ở cấp độ toàn hệ thống.

Đó là khác biệt không dễ chịu giữa **xóa một record** và **thực hiện đúng một deletion guarantee**.

> **Luận điểm chính:** AI system nên coi deletion là một propagation protocol, không phải một database button. Hãy chặn retrieval ngay lập tức, xóa hoặc vô hiệu hóa mọi projection dẫn xuất, và tạo bằng chứng cho thấy phạm vi đã được xử lý mà không chép dữ liệu đã xóa vào audit log.

Đây là playbook về kiến trúc, không phải tư vấn pháp lý cho từng trường hợp. Nghĩa vụ privacy còn phụ thuộc vào jurisdiction, mục đích xử lý, lawful basis, hợp đồng, chính sách lưu trữ và tình tiết của từng request. GDPR Article 17 mô tả quyền xóa trong các trường hợp cụ thể, đồng thời liệt kê những ngoại lệ như nghĩa vụ pháp lý, tự do biểu đạt, lưu trữ hoặc nghiên cứu vì lợi ích công và việc bảo vệ quyền lợi pháp lý.[1] Bài học kiến trúc vẫn có tính tổng quát: nếu hệ thống hứa sẽ quên, hệ thống cần có scope, state machine và cách chứng minh completion.

## Deletion là một graph, không phải một row

Một sản phẩm conversational AI hiếm khi chỉ lưu “dữ liệu của user” ở một nơi. Nó lưu một chuỗi representation cho những công việc khác nhau. Original message phục vụ hiển thị và export. Summary phục vụ context ở phiên sau. Embedding phục vụ nearest-neighbor retrieval. Cache phục vụ latency. Trace phục vụ debug. Evaluation fixture có thể phục vụ regression testing. Analytics table có thể giữ lại một aggregate hoặc một event đã được redaction.

Hệ thống không nhất thiết xem mọi bản sao có cùng mức độ nhạy cảm, nhưng deletion workflow phải biết chúng tồn tại. Nếu không, workflow sẽ báo thành công ngay tại storage layer đầu tiên trả về `200 OK`.

![Deletion graph của AI nối conversation data với durable memory, summary, embedding, cache, trace, export và evaluation artifact dẫn xuất](/blog/ai-agent-deletion-guarantees/deletion-graph.webp)

Một inventory hữu ích sẽ phân loại mỗi node theo khả năng tái tạo hoặc ảnh hưởng đến thông tin đã xóa:

| Node | Lý do tồn tại | Hành động xóa hoặc vô hiệu hóa | Tín hiệu hoàn tất |
|---|---|---|---|
| Conversation store | Hiển thị, export, lịch sử support | Hard-delete hoặc chuyển sang retention đã được policy cho phép | Source record vắng mặt hoặc được giữ với lý do được ghi nhận |
| Agent memory | Personalization ở tương lai | Xóa, tạo tombstone hoặc đánh dấu unusable | Memory lookup không thể trả về item |
| Vector index | Semantic retrieval | Xóa point theo source ID ổn định và tenant scope | Fetch/search verification không trả về point hợp lệ |
| Summary hoặc profile | Context dẫn xuất dạng ngắn | Tạo lại không dùng source hoặc xóa artifact | Rebuild job ghi lại input set mới |
| Semantic cache | Tránh lặp lại model work | Evict exact và semantic entry trong policy scope | Cache key/version không còn phục vụ kết quả cũ |
| Trace và payload log | Debug và evaluation | Xóa payload hoặc áp dụng transform bất khả nghịch đã được duyệt | Retention job báo cáo trace family đã xử lý |
| Export và backup | Recovery và portability | Expire, cô lập hoặc xóa theo backup policy | Backup inventory ghi nhận expiry tương ứng |
| Audit evidence | Chứng minh workflow đã chạy | Giữ metadata, hash, scope và timestamp—không giữ content đã xóa | Signed evidence có terminal state |

Bước thiết kế quan trọng là tạo quan hệ ổn định giữa từng projection và source. Một embedding ID ngẫu nhiên như `vec_8f2...` là chưa đủ. Hãy dùng source reference có thể được resolve mà không cần đặt original text vào vector payload:

```ts
type DataRef = {
  tenantId: string;
  subjectId: string;
  sourceKind: "conversation" | "upload" | "memory" | "trace";
  sourceId: string;
  version: number;
};

type Projection = DataRef & {
  projectionKind: "summary" | "embedding" | "cache" | "export";
  projectionId: string;
  status: "active" | "tombstoned" | "deleted";
};
```

Reference này là index cho deletion workflow, không phải giấy phép để giữ một bản sao thứ hai của content. Hãy giữ payload ở mức tối thiểu. Nếu support dashboard cần cho biết vì sao một projection bị xóa, hãy hiển thị `sourceKind`, `sourceId` và policy reason—không hiển thị prompt, transcript hoặc embedding.

## Chặn sử dụng ngay phải xảy ra trước cleanup hoàn chỉnh

Một distributed deletion operation có thể mất vài giây hoặc vài giờ. Vector index có thể xử lý write bất đồng bộ. Backup có thể chỉ hết hạn theo lịch. Downstream export có thể đang offline. Độ trễ đó chỉ chấp nhận được nếu subject đã bị loại khỏi retrieval ngay khi deletion request được chấp nhận.

Vì vậy, hãy tách hai guarantee:

1. **Retrieval revocation:** không có agent run mới nào được dùng dữ liệu sau khi deletion request được chấp nhận.
2. **Projection cleanup:** mọi storage và hệ thống dẫn xuất cuối cùng phải xóa, expire hoặc biến đổi dữ liệu theo cách bất khả nghịch trong policy đã duyệt.

Đừng nhầm guarantee thứ nhất với guarantee thứ hai. Retrieval revocation giảm exposure trong lúc cleanup hội tụ. Cleanup mà không có revocation vẫn để lại khoảng thời gian assistant tiếp tục dùng dữ liệu mà user đã yêu cầu nó quên.

Tombstone là một statement nhỏ, bền vững, nói rằng source hoặc projection không được phép sử dụng. Nó không phải dữ liệu đã xóa và không nên chứa một bản mô tả dài về lý do. Nhiệm vụ của nó là thắng cuộc đua với stale index, worker chạy trễ và replica:

```ts
type DeletionTombstone = {
  tombstoneId: string;
  tenantId: string;
  subjectId: string;
  sourceId: string;
  requestedAt: string;
  reasonCode: "user_request" | "retention" | "admin_policy";
  state: "active" | "superseded";
};

async function canRetrieve(ref: DataRef): Promise<boolean> {
  const tombstone = await tombstones.findActive(ref.tenantId, ref.subjectId, ref.sourceId);
  return tombstone === undefined;
}
```

Check này phải nằm ở retrieval boundary, không chỉ trong UI. Cached result, vector search response hoặc memory lookup đều phải bị từ chối nếu source reference đã có tombstone. Nếu một component không thể evaluate tombstone, component đó nên fail closed với dữ liệu rủi ro cao hoặc trả về empty result kèm lý do có thể quan sát.

![Tombstone chặn retrieval tức thời trong khi worker bất đồng bộ xóa vector, cache, summary, trace và export](/blog/ai-agent-deletion-guarantees/tombstone-retrieval-gate.webp)

## Delete API của provider chỉ xử lý một projection

Vector database thường cung cấp cách xóa point theo ID hoặc metadata filter. Pinecone mô tả việc xóa theo ID, metadata filter, toàn bộ record trong namespace hoặc cả namespace; tài liệu cũng ghi rõ delete tiêu thụ write units.[3] Qdrant mô tả xóa theo point ID hoặc filter, đồng thời phân biệt xóa cả point với xóa riêng vector hoặc payload.[4]

Các API đó rất hữu ích, nhưng chúng không phải end-to-end erasure protocol. Chúng chỉ hoạt động trên một index. Chúng không biết source đó đã được summary vào bảng khác, copy vào cache, đưa vào trace hay export sang data warehouse hay chưa.

Vì vậy, một adapter an toàn nên nhận `DataRef`, không nhận natural-language request của user, và phải ghi lại chính xác scope đã thử xử lý:

```ts
type DeleteAttempt = {
  operationId: string;
  projection: Projection["projectionKind"];
  tenantId: string;
  subjectId: string;
  sourceId: string;
  startedAt: string;
  finishedAt?: string;
  outcome: "deleted" | "not_found" | "retryable" | "blocked" | "failed";
  providerRequestHash?: string;
};

async function removeEmbedding(ref: DataRef): Promise<DeleteAttempt> {
  const startedAt = new Date().toISOString();
  try {
    await pinecone.delete({
      filter: {
        tenant_id: { $eq: ref.tenantId },
        source_id: { $eq: ref.sourceId },
        source_version: { $eq: ref.version },
      },
      namespace: ref.subjectId,
    });
    return {
      operationId: crypto.randomUUID(),
      projection: "embedding",
      ...ref,
      startedAt,
      finishedAt: new Date().toISOString(),
      outcome: "deleted",
    };
  } catch (error) {
    return {
      operationId: crypto.randomUUID(),
      projection: "embedding",
      ...ref,
      startedAt,
      finishedAt: new Date().toISOString(),
      outcome: isRetryable(error) ? "retryable" : "failed",
    };
  }
}
```

Adapter phải idempotent. Worker có thể nhận cùng một deletion task hai lần, restart sau khi provider đã nhận request hoặc timeout trong lúc provider vẫn đang xử lý. Với một projection cụ thể, `not_found` thường nên là terminal state thành công. Còn timeout không rõ kết quả nên được retry và reconcile, thay vì bị báo failed vĩnh viễn.

Index payload cũng cần đủ thông tin để verification mà không lưu original text. Tenant scope, source ID ổn định, source version và projection version thường có giá trị hơn việc copy một chunk:

```json
{
  "id": "memory-42-v3",
  "vector": "<embedding>",
  "metadata": {
    "tenant_id": "tenant_7",
    "source_id": "conversation_42",
    "source_version": 3,
    "projection": "embedding",
    "policy_version": "memory-policy-2026-01"
  }
}
```

## Dữ liệu dẫn xuất cần policy, không cần phỏng đoán

Câu hỏi khó nhất thường không phải “transcript nằm ở đâu?” mà là “dữ liệu dẫn xuất nào được xem là personal data?” Một summary nói rằng user thích đặt lịch buổi sáng có thể hữu ích hơn câu gốc, nhưng nó vẫn có thể ảnh hưởng đến action kế tiếp. Một cache answer có thể không tự nhận diện một người, nhưng nếu được phục vụ nhầm tenant, nó vẫn tạo ra privacy incident. Một trace đã redact vẫn có thể chứa unique identifier đủ để tái dựng dữ liệu.

Hãy phân loại từng projection trước khi xây deletion worker. Một policy thực tế có thể có ba kết quả:

| Classification | Ví dụ | Hành động mặc định |
|---|---|---|
| Reconstructive | Transcript, raw upload, full prompt payload | Xóa hoặc đặt dưới retention rule được giải thích rõ |
| Influential | Preference memory, profile field, embedding, cached answer | Xóa hoặc tombstone trước retrieval kế tiếp; rebuild nếu cần |
| Evidentiary | Operation ID, timestamp, policy version, result hash | Giữ metadata tối thiểu để có thể chứng minh completion |

Đừng dùng từ “anonymized” như một chiếc đũa thần. Một transformation bất khả nghịch phải được đánh giá dựa trên dữ liệu, attacker model và các field xung quanh. Hash một email ổn định trong audit table vẫn có thể cho phép correlation. Thay content bằng một secret token ngắn vẫn có thể cho phép operator có quyền tái nhận diện. Nếu evidence cần được giữ, hãy minimize nó và tách quyền truy cập evidence khỏi product data.

NIST mô tả AI RMF là hướng dẫn tự nguyện giúp đưa các yếu tố trustworthiness vào thiết kế, phát triển, sử dụng và đánh giá AI product, service và system.[2] NIST không quy định một cách triển khai deletion duy nhất. Với engineering team, hệ quả hữu ích là xem deletion như một risk control có governance, owner, outcome có thể test và residual risk được ghi chép.

## Evidence ledger phải chứng minh scope mà không biến thành shadow archive

Một audit record nên trả lời năm câu hỏi:

- Request bao phủ subject và source scope nào?
- Retrieval bị block lúc nào?
- Đã phát hiện những projection nào?
- Worker nào đã complete, retry hoặc đi đến một retention exception có tài liệu?
- Terminal decision được policy nào hoặc ai phê duyệt?

Nó không nên trả lời bằng cách copy deleted text vào một log lâu dài. Hãy lưu reference, count, hash của canonical identifier khi phù hợp, timestamp, worker version, policy version và terminal outcome. Có thể giữ evidence ledger append-only nếu phù hợp với audit model, nhưng ledger cũng phải có retention policy riêng.

![Evidence ledger dạng append-only ghi deletion scope, worker outcome, retry, policy version và completion mà không giữ content đã xóa](/blog/ai-agent-deletion-guarantees/evidence-ledger.webp)

```ts
type DeletionEvidence = {
  requestId: string;
  subjectHash: string;
  scopeHash: string;
  policyVersion: string;
  tombstoneActivatedAt: string;
  projectionCounts: Record<string, number>;
  failures: Array<{
    projection: string;
    code: string;
    retryAfter?: string;
  }>;
  terminalState: "complete" | "complete_with_exception" | "failed";
  workerVersion: string;
  recordedAt: string;
};
```

State `complete_with_exception` tốt hơn một green checkmark không trung thực. Ví dụ, backup có thể còn tồn tại đến documented expiry, hoặc legal hold có thể ngăn xóa một record cụ thể. User-facing workflow có thể giải thích ranh giới đó mà không lộ content nội bộ. Hệ thống không bao giờ nên gọi request là complete trong khi một projection vẫn còn active và có thể được retrieval.

## Reconciliation là cách để guarantee sống sót qua thực tế

Lượt chạy đầu tiên của worker không phải bằng chứng. Distributed system có thể fail giữa mọi hai dòng code. Provider có thể nhận delete nhưng làm mất response. Một projection mới có thể được tạo bởi stale queue message sau khi deletion worker đã hoàn tất. Backup được restore có thể mang record cũ trở lại. Một config change có thể làm source ID biến mất khỏi discovery query.

Hãy chạy reconciliation như một control loop định kỳ:

```ts
async function reconcileDeletion(requestId: string) {
  const request = await deletionRequests.get(requestId);
  const tombstone = await tombstones.findByRequest(requestId);
  if (!tombstone) throw new Error("retrieval block is missing");

  const expected = await projectionRegistry.listForScope(request.scope);
  const active = [];

  for (const projection of expected) {
    if (await projectionIsStillUsable(projection, tombstone)) {
      active.push(projection.projectionKind);
      await enqueueDelete(requestId, projection);
    }
  }

  await evidence.append({
    requestId,
    event: active.length === 0 ? "reconciled_clear" : "reconciled_pending",
    activeProjectionKinds: active,
    at: new Date().toISOString(),
  });
}
```

Reconciliation nên kiểm tra cả registry lẫn provider nếu có thể. Chỉ kiểm tra registry có thể nói dối nếu discovery path bỏ sót một projection mồ côi. Chỉ quét provider có thể quá đắt hoặc bất khả thi nếu provider không thể scan mọi tenant-scoped record. Hãy dùng reference ổn định, sampling định kỳ và một confidence boundary được tài liệu hóa.

Control loop tương tự nên chạy sau backup restoration, index migration, re-embedding và schema change. Deletion chưa kết thúc nếu maintenance job tiếp theo có thể âm thầm tạo lại memory đã xóa.

## Hãy test negative path

Phần lớn hệ thống test việc delete endpoint trả về success. Điều đó cần thiết nhưng chưa đủ. Acceptance test phải cố gắng sử dụng dữ liệu sau mỗi boundary quan trọng.

| Scenario | Kết quả mong đợi |
|---|---|
| User yêu cầu xóa trong lúc agent run đang chờ | Run đang chờ không thể retrieve source đã tombstone |
| Vector delete timeout sau khi provider đã nhận | Retry và reconciliation hội tụ mà không tạo failure noise trùng lặp |
| Stale queue message đến sau cleanup | Projection write bị từ chối hoặc lập tức bị tombstone |
| Semantic cache chứa answer cũ | Cache lookup miss hoặc fail tombstone check |
| Summary được tạo từ source đã xóa | Summary bị xóa hoặc rebuild từ tập còn lại được phép |
| Backup nằm dưới retention hoặc legal hold | Hệ thống ghi nhận exception có scope và block product retrieval |
| Cùng request được submit hai lần | Lần hai trả về operation state đã tồn tại |
| Operator search theo source ID đã xóa | Chỉ evidence tối thiểu và đúng quyền mới hiển thị |

Cũng cần test tenant isolation. Deletion request cho một subject không được xóa projection của subject khác chỉ vì metadata filter được ghép quá rộng. Hãy test version boundary: xóa version 3 không được vô tình xóa version 4 độc lập nếu policy không nói toàn bộ source lineage nằm trong scope.

## Một rollout path không bắt đầu bằng “xóa tất cả”

Bắt đầu bằng inventory. Liệt kê mọi nơi agent đọc, ghi, copy, summary, embed, cache, export hoặc log dữ liệu do user tạo ra. Gán owner và deletion adapter cho từng projection. Nếu một projection không có owner, hãy coi đó là production risk thay vì giấu nó khỏi bản đồ.

Tiếp theo, đưa tombstone check vào retrieval boundary ở shadow mode. Đo xem request sẽ block bao nhiêu result, component nào không thể evaluate tombstone và stale writer có tạo projection mới sau request hay không. Đừng chờ cleanup worker hoàn hảo mới ngăn việc sử dụng dữ liệu.

Sau đó bật asynchronous deletion cho một memory class có rủi ro thấp. Ghi nhận duration, retry rate, not-found outcome, orphan discovery và kích thước evidence. Thêm reconciliation job trước khi mở rộng scope. Chỉ sau khi negative-path test pass mới bao phủ trace, cache, export và backup policy.

Cuối cùng, biến deletion thành một phần của mọi feature review có tạo dữ liệu. Một “helpful” memory field chưa hoàn chỉnh khi write path chạy tốt. Nó chỉ hoàn chỉnh khi team trả lời được điều gì sẽ xảy ra nếu user yêu cầu field đó biến mất.

## Product promise phải khớp với state machine

Có một cám dỗ là hiển thị một nhãn duy nhất: “Dữ liệu của bạn đã được xóa.” Câu đó đơn giản và thường mạnh hơn những gì hệ thống biết chắc. Một product contract tốt hơn sẽ phân biệt các state mà backend thật sự hỗ trợ:

| State hiển thị cho user | Ý nghĩa ở hệ thống |
|---|---|
| Request received | Scope đã được validate; chưa tuyên bố completion |
| Use blocked | Tombstone active tại retrieval boundary |
| Cleanup in progress | Một hoặc nhiều projection vẫn đang được xử lý |
| Deleted | Mọi retrievable projection trong scope đã biến mất hoặc được transform theo policy |
| Completed with exception | Một retention/hold boundary có tài liệu còn tồn tại, nhưng product retrieval đã bị block |
| Needs review | Discovery hoặc provider verification thất bại và cần operator quyết định |

Mục tiêu không phải làm privacy screen phức tạp. Mục tiêu là giữ cho UI trung thực với điều backend thực sự biết. Một assistant nói chuyện trôi chảy có thể làm lời hứa xóa nghe như đã hoàn tất từ lâu trước khi distributed system kiếm được quyền nói câu đó.

AI system đáng tin không phải là hệ thống tuyên bố mình không nhớ gì. Đó là hệ thống có thể giải thích mình lưu gì, vì sao lưu, chặn việc sử dụng nhanh đến đâu và dựa vào đâu để biết deletion request đã thực sự hoàn tất.

Nếu memory là product feature, thì forgetting cũng là product feature. Hãy xây nó như một protocol.

## Tài liệu tham khảo

[1]: https://gdpr-info.eu/art-17-gdpr/ "GDPR Article 17 — Right to erasure (‘right to be forgotten’)"
[2]: https://www.nist.gov/itl/ai-risk-management-framework "NIST AI Risk Management Framework"
[3]: https://docs.pinecone.io/guides/manage-data/delete-data "Pinecone Docs — Delete records"
[4]: https://qdrant.tech/documentation/manage-data/points/ "Qdrant Documentation — Points"

## Đọc thêm

- [AI Agent cần Memory Policy, không chỉ một Vector Database](/blog/agent-memory-policy-lifecycle)
- [Observability cho AI Agent: Trace Prompt, Tool Call, Token và Cost mà không biến Log thành rò rỉ dữ liệu](/blog/agent-observability-without-data-leaks)
- [Identity của AI Agent không phải User ID: Thiết kế Delegation, Scope và Revocation](/blog/agent-identity-delegation-revocation)
- [AI Action có tính Idempotent: Retry Tool Call mà không nhân đôi Side Effect](/blog/idempotent-ai-actions)
