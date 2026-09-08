---
title: "AI Agent cần Memory Policy, không chỉ một Vector Database"
description: "Thiết kế thực tế để quyết định AI agent được phép ghi nhớ gì, khi nào memory nên được hợp nhất hoặc quên đi, và cách đánh giá memory mà không biến mọi cuộc trò chuyện thành kho lưu trữ vĩnh viễn."
pubDate: 2026-02-14
category: "engineering"
image: "/blog/agent-memory-policy/hero.webp"
lang: "vi"
translationKey: "agent-memory-policy-lifecycle"
draft: false
---

![Một AI robot nhỏ đang sắp xếp memory theo vòng đời ghi nhận, hợp nhất, suy giảm và xóa](/blog/agent-memory-policy/hero.webp)

Tôi từng thấy nhiều team thêm một vector database vào AI assistant rồi gọi đó là “memory”. Demo thường rất thuyết phục. Assistant nhớ một sở thích từ tuần trước, lấy lại đúng một đoạn thông tin, và trông như ngày càng hiểu người dùng hơn. Vài tuần sau, chính hệ thống đó bắt đầu nhắc lại một quyết định dự án đã lỗi thời, mang thông tin riêng tư sang nhầm workspace, hoặc lặp lại một phỏng đoán yếu như thể đó là sự thật.

Vector database đã làm đúng điều nó được yêu cầu. Phần còn thiếu là policy bao quanh nó.

AI agent memory không chỉ là một document được embedding rồi đem đi search. Đó là một quyết định về **hệ thống được phép giữ lại điều gì, giữ cho ai, với độ tin cậy nào, trong bao lâu, và dưới điều kiện nào memory đó được phép ảnh hưởng đến hành vi về sau**. Vì vậy, memory gần với product capability và data lifecycle hơn là một tính năng lưu trữ.

> **Luận điểm chính:** Production agent cần memory policy trước khi cần một index lớn hơn. Retrieval có thể tìm thấy memory; policy quyết định memory đó có nên tồn tại, có đáng tin, có nên hiển thị hay đã đến lúc quên đi hay chưa.

Bài viết này đề xuất một policy nhỏ nhưng thực tế, có thể triển khai mà không cần xây dựng một cognitive architecture mang tính nghiên cứu. Thiết kế sẽ tách các loại memory, thêm admission gate, định nghĩa lifecycle và đánh giá hành vi ở cấp độ cả cuộc hội thoại.

## Trước hết, hãy gọi đúng loại memory mình cần

Từ “memory” đang che giấu nhiều nhiệm vụ khác nhau. Sở thích như “user thích status update ngắn gọn” không nên chịu cùng policy với một sự kiện như “lần deploy trước thất bại ở 14:05”. Cả hai cũng không nên được xử lý giống một working note chỉ hữu ích trong task hiện tại.

| Loại memory | Ví dụ | Vòng đời kỳ vọng | Rủi ro chính |
|---|---|---:|---|
| **Working context** | File đang chỉnh sửa và mục tiêu tức thời của user | Một turn hoặc một task | Tràn context và vô tình mang sang task khác |
| **Episodic memory** | “Team hoãn migration sau khi staging test thất bại” | Vài ngày đến vài tháng | Sự kiện cũ bị coi là sự thật hiện tại |
| **Semantic memory** | “Service này sở hữu billing webhook” | Nhiều tháng, cần review | Fact sai trở thành folklore của hệ thống |
| **Preference memory** | “User thích ví dụ bằng TypeScript” | Cho đến khi bị đổi hoặc rút lại | Cá nhân hóa quá mức và mất quyền kiểm soát |
| **Procedural memory** | “Trong workflow này, phải validate identifier trước khi ghi state” | Theo vòng đời policy version | Procedure cũ tồn tại sau khi sản phẩm đổi |

Taxonomy này thiên về vận hành. Nó cho team các default khác nhau về retention, confidence và deletion. Nó cũng làm rõ một ranh giới quan trọng: **context hiện tại của agent không tự động trở thành long-term memory**.

Một quyết định khởi đầu hữu ích là cho phép long-term memory theo từng class, thay vì bật toàn bộ. Working context có thể được tạo tự động. Preference memory có thể yêu cầu tín hiệu rõ ràng từ user. Procedural memory thường nên đến từ application configuration có version, không phải từ một bản tóm tắt tình cờ của model sau cuộc trò chuyện.

## Memory cần một admission gate

Memory an toàn nhất nhiều khi là memory chưa từng được ghi. Trước khi lưu một candidate, agent nên trả lời một số câu hỏi có tính xác định. Đây không phải một prompt thứ hai bảo model “hãy cẩn thận”. Đây là một policy component nhỏ với kết quả quan sát được.

![Admission gate kiểm tra relevance, confidence, scope và consent trước khi memory được lưu](/blog/agent-memory-policy/admission-gate.webp)

Với mỗi candidate memory, admission gate nên xem xét:

| Tín hiệu | Câu hỏi | Hành động có thể có |
|---|---|---|
| **Relevance** | Điều này có giúp cho task lặp lại trong tương lai không, hay chỉ hữu ích lúc này? | Giữ trong working context hoặc đề xuất lưu dài hạn |
| **Confidence** | Đây là điều được nói trực tiếp, được quan sát hay chỉ được suy ra? | Chỉ lưu fact trực tiếp hoặc hạ mức tin cậy |
| **Scope** | Nó thuộc về user, team, project, tenant hay task nào? | Gắn scope key và từ chối nếu scope mơ hồ |
| **Sensitivity** | Có chứa secret, dữ liệu sức khỏe, credential hoặc identifier riêng tư không? | Từ chối, redact hoặc yêu cầu consent |
| **Freshness** | Fact này có thể nhanh chóng trở nên sai không? | Thêm expiry hoặc bắt buộc revalidation |
| **Provenance** | Memory đến từ đâu? | Lưu source turn, tool hoặc document reference |

Candidate có thể được biểu diễn như một policy object thay vì một ghi chú tự do:

```ts
type MemoryCandidate = {
  kind: "episodic" | "semantic" | "preference";
  subject: string;
  value: string;
  scope: { tenantId: string; projectId?: string; userId?: string };
  source: { turnId: string; author: "user" | "tool" | "model" };
  confidence: "stated" | "observed" | "inferred";
  sensitivity: "normal" | "personal" | "secret";
  expiresAt?: string;
};
```

Field quan trọng không phải embedding, mà là metadata giúp bước retrieval về sau quyết định item còn đủ điều kiện hay không. Nếu memory không có owner, source, scope hoặc freshness signal, việc debug sẽ khó và việc xóa chính xác gần như bất khả thi.

### Đừng để model là người có tiếng nói cuối cùng

LLM có thể đề xuất memory, tóm tắt cuộc trò chuyện hoặc phân loại candidate. Nhưng model không nên là component duy nhất quyết định một câu nói chưa được kiểm chứng trở thành durable fact. Application có thể enforce các hard rule với chi phí thấp: reject secret, bắt buộc tenant key, giới hạn số lần write trong mỗi turn, và từ chối memory có source là một memory khác do model tạo ra.

Model phù hợp với các câu hỏi ngữ nghĩa như “đây có phải recurring preference không?”. Deterministic code nên sở hữu các câu hỏi như “candidate có chứa access token không?” và “user có quyền với scope này không?”.

## Consolidation không chỉ là viết một bản tóm tắt lớn hơn

Khi memory tăng dần, nhiều hệ thống chạy nightly job để summarize. Cách này giảm số record nhưng cũng có thể xóa mất uncertainty và provenance vốn khiến record gốc an toàn khi diễn giải.

Vì vậy, consolidation nên được coi là một **versioned transformation**. Summary mới cần trỏ đến các memory mà nó thay thế, giữ lại source reference mạnh nhất và có thể revert trong thời gian team còn kiểm tra kết quả.

![Lifecycle loop biến memory thô thành knowledge đã review, sau đó làm suy giảm hoặc xóa theo policy](/blog/agent-memory-policy/lifecycle-loop.webp)

Một lifecycle đơn giản có thể gồm:

1. **Candidate:** agent đề xuất memory sau một turn hoặc tool result.
2. **Admitted:** policy checks thành công và memory được lưu kèm provenance, scope.
3. **Reinforced:** bằng chứng độc lập ở những lần sau ủng hộ cùng fact.
4. **Stale:** memory chạm review window hoặc mâu thuẫn với evidence mới.
5. **Archived hoặc deleted:** item bị loại khỏi retrieval, chỉ giữ lại nếu audit policy yêu cầu, hoặc xóa hoàn toàn.

Reinforcement không nên có nghĩa là “model lặp lại câu đó hai lần”. Bằng chứng tốt hơn đến từ các sự kiện độc lập: user xác nhận rõ preference, trusted tool trả về cùng quan hệ ownership, hoặc document mới thay thế document cũ. Hệ thống nên ghi lại lý do confidence thay đổi.

Decay hữu ích vì nhiều memory trở nên kém tin cậy mà chưa chắc đã sai hiển nhiên. Project owner có thể đổi, team có thể migrate, preference về format có thể tiến hóa. Thay vì giả định mọi vector luôn có relevance như nhau, hãy đưa freshness vào retrieval:

```text
retrievalScore = semanticSimilarity
               × scopeMatch
               × confidenceWeight
               × freshnessWeight
               × policyEligibility
```

Công thức cụ thể không quan trọng bằng việc tách các tín hiệu. Một memory hết hạn nhưng có similarity cao không nên đứng trên một fact mới được xác nhận dù similarity thấp hơn một chút.

## Retrieval nên trả về evidence, không chỉ text

Khi memory được đưa vào prompt, agent cần biết mình đang nhìn thấy loại dữ liệu nào. Retrieval result có thể mang theo một envelope ngắn:

```json
{
  "memoryId": "mem_82f1",
  "kind": "preference",
  "content": "The user prefers concise incident updates.",
  "scope": "user:u_17",
  "confidence": "stated",
  "sourceTurn": "turn_2026_02_01_04",
  "observedAt": "2026-02-01T09:42:00Z",
  "reviewAfter": "2026-08-01T00:00:00Z",
  "allowedUses": ["formatting", "summarization"]
}
```

Điều này làm lộ ra một phân biệt quan trọng: memory có thể **retrievable** nhưng chưa chắc **authoritative**. Prompt nên hướng dẫn agent dùng preference memory cho formatting, không dùng nó làm evidence cho business fact. Procedural memory có thể định hướng workflow nhưng không được override authorization check hiện tại.

Retrieval layer cũng nên hỗ trợ negative result. “Không tìm thấy memory đủ điều kiện” an toàn hơn việc trả về item gần nhất nhưng đã stale rồi bắt model tự quyết định nó có còn đúng không. Trong workflow có ảnh hưởng lớn, fallback đúng có thể là hỏi lại hoặc gọi tool để lấy dữ liệu mới.

## Đánh giá memory qua nhiều thread

Không thể đánh giá memory feature chỉ bằng các cặp hỏi–đáp một turn. Feature tồn tại để thay đổi hành vi về sau, nên test cần ít nhất hai giai đoạn: write hoặc update, rồi retrieve hoặc chủ động từ chối retrieve.

![Bộ đánh giá memory so sánh đường đi có bằng chứng với đường đi dùng stale memory trước khi release](/blog/agent-memory-policy/evaluation-matrix.webp)

| Nhóm test | Ví dụ | Cần grade điều gì |
|---|---|---|
| **Admission** | User nói rõ một preference về format | Lưu đúng scope và source |
| **Refusal** | User dán secret rồi yêu cầu ghi nhớ | Không lưu hoặc surface secret |
| **Conflict** | User thay đổi preference | Evidence mới thắng, item cũ được retire |
| **Freshness** | Project owner thay đổi sau sáu tháng | Revalidate thay vì khẳng định fact cũ |
| **Isolation** | Hai tenant nhắc cùng một tên project | Không có cross-tenant retrieval |
| **Deletion** | User yêu cầu quên preference | Item biến mất khỏi retrieval và index |
| **Use restriction** | Preference được retrieve trong authorization task | Agent không dùng nó như permission |

Một test tốt không chỉ assert prose cuối cùng. Nó kiểm tra memory write, metadata, retrieval scope, source reference và action thực tế. Điều này đặc biệt quan trọng với long-running conversation: hệ thống có thể trả lời từng turn nghe hợp lý nhưng vẫn mang một giả định cũ xuyên suốt thread.

Metric nên có **memory precision**, không chỉ recall. Retrieve được nhiều memory hơn không đồng nghĩa tốt hơn. Một dashboard thực tế có thể theo dõi tỷ lệ memory được retrieve mà thực sự eligible, đúng scope, còn fresh và hữu ích cho task. Hãy tách riêng false memory, stale memory, unauthorized memory và deletion failure.

## Hãy cho user thấy memory contract

Memory policy không hoàn chỉnh nếu user không hiểu hoặc thay đổi được nó. UI không cần phơi bày cả database. Nhưng UI cần trả lời bằng ngôn ngữ rõ ràng: đã nhớ gì, vì sao nhớ, áp dụng ở đâu, khi nào review và xóa bằng cách nào.

Sản phẩm nên tránh biến “tôi chỉ nhắc điều này một lần” thành profile vĩnh viễn. Một xác nhận nhỏ như “Tôi có thể nhớ preference này cho các lần format sau. Lưu lại không?” thường đáng tin hơn silent write. Với preference ít rủi ro và xuất hiện thường xuyên, sản phẩm có thể cho phép auto-admission nhưng phải có memory history và undo dễ thấy. Lựa chọn nào cũng cần được cân nhắc và ghi thành policy.

Deletion cũng phải chạm đến mọi representation. Xóa row ở primary database là chưa đủ nếu vector index, cache, derived summary, evaluation fixture hoặc backup vẫn có thể trả lại text cũ. Deletion contract cần nói rõ những store nào được bao phủ và eventual-consistency window user nên chờ là bao lâu.

## Một policy nhỏ tốt hơn một architecture gây ấn tượng

Bạn không cần một chục loại memory để bắt đầu. Production version đầu tiên có thể chỉ cần ba class, một admission gate, một review job và một nhóm cross-thread test. Điều quan trọng là hệ thống giải thích được quyết định của mình.

| Câu hỏi policy | Câu trả lời tối thiểu |
|---|---|
| Được phép lưu gì? | Preference và recurring project fact; không lưu secret hoặc sensitive data chưa xác minh |
| Ai sở hữu? | Tenant cộng với user và project scope nếu có |
| Vì sao đáng tin? | Source turn hoặc trusted tool, confidence label và timestamp |
| Khi nào review? | Review date theo class hoặc explicit version change |
| Xóa thế nào? | Primary record, vector index, cache và derived summary |
| Test ra sao? | Admission, conflict, isolation, freshness, deletion và restricted-use case |

Lợi ích của thiết kế này không phải khiến agent nhớ nhiều hơn. Nó giúp agent nhớ **ít liều lĩnh hơn**. Một memory subsystem tốt khiến retention có chủ đích, retrieval có thể giải thích và forgetting có thể kiểm thử. Khi nền móng đó đã có, embedding tốt hơn hay context window lớn hơn chỉ còn là optimization, không phải vật thay thế cho product judgment.

## References

[1]: https://arxiv.org/html/2601.01743v1 "AI Agent Systems: Architectures, Applications, and Evaluation"
[2]: https://www.w3.org/TR/prov-overview/ "W3C PROV Overview"
[3]: https://arxiv.org/abs/2310.08560 "MemGPT: Towards LLMs as Operating Systems"
[4]: https://www.anthropic.com/research/building-effective-agents "Building Effective Agents — Anthropic"
