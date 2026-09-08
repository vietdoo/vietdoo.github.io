---
title: "Context Engineering cho AI Agent chạy dài: Nên Fetch, Nén và Quên điều gì?"
description: "Blueprint production để thiết kế context pipeline cho AI agent chạy dài: retrieval, selection, compaction, tool-result clearing, durable memory, isolation và budget có thể đo lường."
pubDate: 2026-04-11
category: "engineering"
image: "/blog/context-engineering/hero.svg"
lang: "vi"
translationKey: "context-engineering-long-running-ai-agents"
draft: false
---

![Context engineering pipeline nối retrieval, compression, memory và bounded action của AI agent](/blog/context-engineering/hero.svg)

Một agent chạy dài hiếm khi thất bại chỉ vì model không thể viết thêm một câu. Nó thất bại vì inference call tiếp theo nhận phải **working set** sai.

Request có thể đúng. Tool có thể sẵn sàng. Hệ thống retrieval có thể trả về tài liệu liên quan. Model thậm chí đủ năng lực để giải quyết task. Nhưng agent vẫn drift vì context đang chứa năm tool dump đã cũ, hai plan mâu thuẫn, một system instruction quá dài, cuộc hội thoại từ hôm qua và một constraint quan trọng bị chôn gần cuối cửa sổ.

Đó không còn là bài toán prompt-writing đơn thuần. Đó là bài toán **context engineering**.

> **Luận điểm:** Hãy xem context là một resource hữu hạn, chịu sự quản lý của policy và được lắp ráp qua pipeline. Hệ thống phải quyết định nên fetch gì, fetch lúc nào, nén ra sao và quên điều gì trước khi model đưa ra quyết định tiếp theo.

Anthropic mô tả context engineering là việc tuyển chọn và duy trì tập token tối ưu được đưa vào model ở mỗi lần inference. Sourcegraph cũng đẩy cách nhìn này về phía production: khi agent có tool, retrieval và memory, prompt chỉ còn là một thành phần trong pipeline thông tin lớn hơn. Hệ quả thực tế rất đáng giá: ta có thể thiết kế, test và vận hành context giống như một subsystem production khác.

## Context không chỉ là prompt

Prompt là một câu hoặc một nhóm instruction. Context là toàn bộ state được trình bày cho model trong một inference call. Nó gồm system policy, user request, recent conversation, evidence được retrieve, tool definitions, tool results, output schema, workflow state và long-term memory được chọn.

| Layer | Nó đóng góp gì | Failure thường gặp khi không quản lý |
|---|---|---|
| Instructions | Role, policy, boundary và luật hệ thống | Instruction mâu thuẫn hoặc policy quá lớn để được chú ý |
| User intent | Kết quả người dùng thực sự muốn | Intent cũ tiếp tục có hiệu lực sau khi task đã đổi |
| Retrieval | Evidence từ document, database hoặc API | Evidence nhìn có vẻ liên quan nhưng stale hoặc thiếu trust |
| History | Decision, correction và câu hỏi chưa giải quyết | Conversation lớn nhanh hơn signal |
| Tools | Capability và contract có thể gọi | Tool definition ăn budget trước khi công việc bắt đầu |
| Memory | Fact bền vững, preference và project state | Notes trở thành một transcript thứ hai không có governance |
| Output contract | Hình dạng mà hệ thống tiếp theo có thể consume an toàn | Prose tự do đi xuyên qua typed boundary |

Phân biệt này rất quan trọng về mặt vận hành. Chất lượng prompt có thể review trong pull request. Chất lượng context phải được quan sát khi runtime vì nó thay đổi theo user, tenant, tool result, step, thời gian và policy. Chỉ cần đổi thứ hạng retrieval là decision của model có thể đổi, dù system prompt không hề thay đổi.

Đây cũng là lý do context window lớn hơn không phải lời giải trọn vẹn. Nhiều chỗ hơn cho phép hệ thống mang theo nhiều thông tin hơn, nhưng không nói cho agent biết thông tin nào xứng đáng được chú ý. Một window đầy vẫn có thể là một window low-signal. Mục tiêu thực tế không phải sử dụng tối đa token; mục tiêu là giữ tập nhỏ nhất nhưng đủ signal cho **quyết định an toàn tiếp theo**.

## Bốn câu hỏi mọi context pipeline phải trả lời

Một context pipeline tốt có thể được giải thích bằng bốn câu hỏi.

**Ta fetch gì?** Fetch là một quyết định policy, không phải phản xạ. Hệ thống cần biết step hiện tại cần customer record, project constraint, decision cũ, tool result hay không cần evidence bổ sung. Fetch tất cả thường chỉ là cách trì hoãn câu hỏi khó hơn.

**Ta fetch lúc nào?** Một số fact nên có ngay trong context ban đầu. Những fact khác chỉ nên được retrieve just-in-time khi agent chạm tới decision boundary. Payment policy có thể cần trước khi đề xuất refund, nhưng không nhất thiết cần trong lúc phân loại message của user. Retrieve quá sớm làm tăng cost và cho stale information nhiều thời gian cạnh tranh với task hiện tại.

**Ta nén như thế nào?** Compression không chỉ là rút ngắn text. Đó là việc giữ lại fact, decision, constraint và unresolved question có ảnh hưởng tới action sau này, đồng thời bỏ narration lặp lại và payload có thể fetch lại. Một summary tốt là một **loss contract**: nó nói rõ step tiếp theo được phép giả định điều gì.

**Khi nào ta bỏ nó đi?** Information nên rời active context khi stale, có thể fetch lại, đã bị thay thế, nằm ngoài scope hoặc không còn liên quan tới decision tiếp theo. Forgetting không phải lỗi nếu hệ thống vẫn giữ durable reference và có thể fetch evidence lại dưới đúng policy.

Bốn câu hỏi này biến context từ một chuỗi string nối tình cờ thành một resource flow được thiết kế.

## Bắt đầu bằng một context contract

Trước khi thêm memory store hoặc retrieval call mới, hãy định nghĩa contract cho một model invocation. Contract phải inspect được trong trace và đủ nhỏ để một kỹ sư có thể reason về nó.

```ts
type ContextPacket = {
  runId: string;
  step: string;
  intent: string;
  authority: {
    tenantId: string;
    actorId: string;
    allowedActions: string[];
  };
  instructions: {
    policyVersion: string;
    systemRules: string[];
  };
  evidence: Array<{
    sourceId: string;
    kind: "retrieval" | "tool" | "memory";
    trust: "verified" | "user-provided" | "unverified";
    freshness: string;
    excerpt: string;
  }>;
  decisions: Array<{
    decision: string;
    rationale: string;
    status: "confirmed" | "open" | "superseded";
  }>;
  toolSurface: string[];
  outputSchema: string;
  budget: {
    inputTokens: number;
    toolCallsRemaining: number;
    timeMsRemaining: number;
  };
};
```

Type cụ thể không phải điều quan trọng nhất. Boundary mới quan trọng. Packet này giúp ta hỏi: output có dùng verified evidence không, model có nhìn thấy approval đã hết hạn không, tool surface có rộng hơn mức cần thiết không và budget bị tiêu cho history hay cho fact hữu ích.

Context contract cũng tạo ra quan hệ rõ ràng với [kiến trúc agent handover](/blog/agent-handover-architecture). Handover ledger giữ intent và decision qua nhiều session. Context packet là projection nhỏ hơn, gắn với từng step, dành cho một inference call. Hai thứ liên quan nhưng không phải cùng một object.

## Retrieval: chọn cho decision tiếp theo, không chọn cho đủ

Retrieval system thường được đánh giá qua việc tìm được material liên quan. Agent cần tiêu chuẩn chặt hơn: material phải liên quan tới **decision tiếp theo**, đủ trust cho action sắp làm, đủ mới đối với domain và đủ nhỏ để nằm cạnh các layer còn lại trong packet.

![Retrieval funnel lọc nhiều source thành một context packet nhỏ nhưng có signal cao](/blog/context-engineering/retrieval-selection.svg)

Anti-pattern phổ biến là context dump. Agent nhận toàn bộ customer profile, mọi document match, tất cả tool result trước đó và danh sách tool definition dài. Cách này trông an toàn vì dường như không bỏ sót fact nào. Nhưng nó không an toàn vì model phải tự suy ra priority từ volume, trong khi constraint quan trọng nhất có thể trông không khác background noise.

Retrieval layer tốt hơn nên trả evidence kèm provenance và lý do được đưa vào. Ta cần giải thích được: “Record này vào packet vì step hiện tại là kiểm tra refund eligibility, record được update hai phút trước và source là billing system.” Nếu không thể giải thích, ranking có lẽ đang làm quá nhiều việc trong bóng tối.

Các signal hữu ích gồm task relevance, source trust, freshness, tenant scope, authority scope, mâu thuẫn với fact đã confirm và cost của việc fetch lại sau. Recency không nên tự động thắng authority. User message có thể mới hơn nhưng không đủ quyền override policy đã verify. Policy trong cache có thể đáng tin nhưng đã quá cũ cho một quyết định nhạy cảm với thời gian.

Retrieval result cũng phải có giới hạn. Đặt budget theo từng source và từng step thay vì một luật toàn cục kiểu “lấy top 20”. Step phân loại có thể chỉ cần ba fact ngắn. Final action proposal có thể cần đúng policy clause, record hiện tại và một entry trong decision history. Kích thước đúng phải đi theo decision, không đi theo database.

Điều này khác với bài học chunking trong [bài RAG production mentoring](/blog/hanh-trinh-mentor-thuc-tap-sinh-ai). Chunking quyết định một knowledge source có thể được retrieve như thế nào. Context engineering quyết định result đó có nên bước vào model call này không, ở dạng nào, cùng authority nào và tồn tại bao lâu.

## Compression là một semantic operation

Conversation dài và workflow nhiều tool cuối cùng sẽ tạo ra nhiều material hơn mức call tiếp theo có thể dùng. Vì vậy compression phải là operation hạng nhất, không phải thao tác cắt chuỗi khi đã sát hard limit.

Hướng dẫn production của Anthropic mô tả compaction như một high-fidelity summary mang theo architectural decision, unresolved bug và implementation detail vào context window mới. Cụm “high-fidelity” rất quan trọng. Một summary nghe trôi chảy nhưng làm mất constraint không phải compression thành công; đó là data-loss event được viết bằng văn phong tốt.

Một compaction record thực tế nên giữ bốn nhóm information:

| Nên giữ | Ví dụ |
|---|---|
| Fact đã confirm | “Account dùng annual plan; refund window kết thúc ngày 2026-04-18.” |
| Decision và rationale | “Chưa gọi cancellation tool cho tới khi user xác nhận prorated amount.” |
| Open loop | “Đang chờ invoice identifier; billing API trả về hai candidate.” |
| Reference | “API response đầy đủ lưu ở artifact `toolrun_1842`; được phép fetch lại sau policy check.” |

Tool-result clearing là operation nhẹ hơn. Nếu một result lớn có thể fetch lại và active state đã chứa decision được suy ra từ nó, hãy bỏ raw payload khỏi window nhưng giữ reference và freshness. [Claude Cookbook] giải thích khác biệt này rất rõ: compaction nén toàn bộ window, clearing bỏ dữ liệu cũ có thể fetch lại, còn memory đưa thông tin bền vững ra ngoài active window.

![Active context dài được compaction thành summary có fidelity cao, trong khi durable notes nằm ngoài window](/blog/context-engineering/compaction-memory.svg)

Đừng biến “giữ N message gần nhất” thành policy compaction duy nhất. Message cuối có thể là một tool dump dài, trong khi message cũ hơn chứa authority của user hoặc safety constraint. Hãy đánh giá compaction bằng loss checklist: objective hiện tại còn không, actor và tenant còn không, fact confirm còn không, approval pending còn không, constraint còn không, tool outcome còn không, unresolved question còn không và reference để recover evidence còn không?

Summary do model tạo vẫn cần validation. Hãy xem nó là một transformation không đáng tin cho tới khi deterministic checker xác nhận required field tồn tại, reference resolve được và summary không sinh ra claim bị cấm. Nếu summary không đáp ứng contract, giữ checkpoint trước đó và yêu cầu một pass compaction hẹp hơn.

## Memory không phải transcript thứ hai

Persistent memory hữu ích khi agent phải tiếp tục qua nhiều session. Nhưng “save everything” chỉ biến memory thành một context window ồn ào khác. Durable memory cần có purpose, owner, scope và luật invalidation.

Một memory model thực tế nên tách ít nhất ba loại note. **Project state** mô tả agent đang cố hoàn thành điều gì. **Stable facts** là thông tin dự kiến sống qua session, chẳng hạn convention của repository hoặc user preference đã confirm. **Working hypotheses** là niềm tin có thể hữu ích nhưng không được coi như sự thật đã verify.

Mỗi note nên có provenance, timestamp, scope, confidence và replacement key. Khi fact mới mâu thuẫn với note cũ, hệ thống nên supersede note cũ thay vì âm thầm nối thêm một sự thật thứ hai. Khi tenant, project hoặc user đổi, scope filtering phải xảy ra trước retrieval—không phải sau khi note đã vào model context.

Structured note-taking có thể rất đơn giản. Một file `NOTES.md`, một table nhỏ trong database hoặc object store đều có thể dùng nếu write path có governance. Phần khó không phải nơi lưu mà là quyết định cái gì đáng persist. Candidate tốt là decision đã confirm, durable constraint, reference tới artifact và next step nếu không lưu sẽ biến mất khi reset. Candidate tệ là raw tool output, model prose còn suy đoán và summary trùng lặp.

Điều này liên quan tới durable execution, nhưng boundary cần giữ rõ. Durable execution lưu workflow state và evidence để một run recover sau crash. Memory lưu knowledge đã chọn để assemble context cho tương lai. Nếu dùng cùng một record cho cả hai mà không có type hoặc retention policy, recovery state có thể rò vào conversation sau này; preference cũ cũng có thể bị nhầm thành workflow truth hiện tại.

## Context isolation: để specialist explore mà không làm bẩn lead

Một số task cần exploration sâu: đọc repository, so sánh nhiều document, thử vài hypothesis hoặc inspect trace lớn. Gửi mọi observation trung gian về một lead agent vừa tốn token vừa khiến lead kém quyết đoán.

![Lead agent điều phối các specialist có context riêng và nhận về các summary card nhỏ gọn](/blog/context-engineering/subagent-isolation.svg)

Sub-agent architecture giải quyết bằng cách cấp cho specialist một context window sạch. Researcher có thể đọc hàng chục source, implementer làm việc với code và test, còn verifier thách thức assumption. Lead agent chỉ nhận result có giới hạn thay vì toàn bộ exploration history. Anthropic mô tả pattern này như cách cô lập search context chi tiết để lead tập trung vào synthesis.

Isolation không có nghĩa là parallelism vô hạn. Mỗi specialist cần role, input contract, tool allow-list, exploration budget tối đa và output schema. Summary nên có conclusion, evidence reference, uncertainty, failed approach và next action đề xuất. Specialist trả về đúng chữ “done” đã tiết kiệm token nhưng phá hỏng observability.

Đừng dùng sub-agent để né việc thiết kế main context contract. Mục tiêu là giảm working set, không phải tạo swarm không thể trace. Lead agent vẫn giữ authority, policy và final action boundary. Summary của specialist là evidence, không phải permission.

## Đo context, không chỉ đo câu trả lời

Không thể suy ra chất lượng context pipeline từ một response thành công. Model có thể trả lời đúng nhờ may mắn, hoặc tạo câu trả lời trôi chảy trong khi đã dùng một fact unsafe hay stale. [Bài về agent evals](/blog/agent-evals-regression-suite) bao phủ behavioral regression. Context engineering bổ sung các phép đo về information đã làm behavior đó có thể xảy ra.

| Metric | Nó cho biết điều gì |
|---|---|
| Input token theo layer | History, tool hay retrieval đang ăn budget nhiều nhất |
| Retained-signal ratio | Bao nhiêu phần active context sống sót thành state có thể hành động |
| Re-fetch rate | Hệ thống có bỏ information quá tay không |
| Stale-evidence rate | Note hoặc tool result hết hạn có lọt vào decision không |
| Contradiction rate | Packet có claim mâu thuẫn chưa resolve không |
| Context-to-action latency | Build context có chiếm phần lớn thời gian run không |
| Summary contract failure | Compaction có làm mất required field không |
| Decision success theo packet version | Thay đổi retrieval/compaction có cải thiện behavior không |

Hãy nối metric này với [AI agent SLO scorecard](/blog/ai-agent-slo-success-latency-cost-safety). Context size ảnh hưởng latency và cost, nhưng safety và success cần slice riêng. Packet nhỏ hơn không tự động tốt hơn nếu nó làm tăng refusal sai, retrieval lặp hoặc assumption không an toàn.

Hãy trace **hình dạng** packet, không nhất thiết log toàn bộ sensitive payload. Ghi source identifier, version, token count, selection reason, policy decision, hash và kết quả redaction. [Hướng dẫn observability cho agent](/blog/agent-observability-without-data-leaks) đặc biệt liên quan ở đây: trace tốt phải giải thích được vì sao decision có thể xảy ra mà không biến hệ thống thành một data lake thứ hai.

## Những failure mode nên thiết kế trước

| Failure mode | Nó biểu hiện thế nào | Thiết kế tốt hơn |
|---|---|---|
| Kitchen-sink retrieval | Mọi document match đều vào window | Rank theo decision tiếp theo, trust, freshness và scope |
| Silent truncation | Phần cuối history biến mất không có record | Compact theo required-field contract |
| Summary hallucination | Compression tự tạo decision hoặc làm mất constraint | Validate field và giữ evidence reference |
| Memory pollution | Suy đoán quay lại như một stable fact | Type note, thêm provenance và supersession |
| Tool-definition overload | Model thấy capability không an toàn hoặc không cần | Chỉ expose tool surface nhỏ nhất cho step |
| Context leakage | Note của tenant này xuất hiện ở tenant khác | Filter scope trước retrieval và log decision |
| Premature forgetting | Result bị bỏ khiến system phải fetch liên tục | Giữ durable reference và đo re-fetch rate |
| Unbounded sub-agent output | Exploration quay về dưới dạng raw transcript | Ép summary schema và evidence ledger |

Đây không chỉ là model failure. Đây là boundary failure. Model chỉ có thể chọn từ information và authority mà hệ thống đưa ra. Vì vậy context engineering thuộc về platform và application architecture, không nên bị nhốt riêng trong một folder prompt.

## Một lộ trình triển khai thực tế

Hãy bắt đầu bằng một workflow chạy dài đang có pain rõ: coding agent sửa nhiều file, support agent phải chờ khách hàng hoặc research agent dùng nhiều tool. Đừng cố redesign mọi prompt ngay từ đầu.

Ở vòng đầu, log packet shape với payload đã redacted. Đếm token theo layer, tìm các tool result lớn lặp lại và đánh dấu fact nào thực sự được dùng trong decision cuối. Baseline này cho thấy vấn đề mà chưa cần đổi behavior.

Tiếp theo, thêm context contract và budget theo step. Đưa selection reason vào retrieval result và reference vào tool artifact. Sau đó thêm một compaction trigger có kiểm soát, tốt nhất trước hard context limit, rồi test với trace chứa correction, approval, contradiction và tool call thất bại.

Sau đó mới thêm structured memory cho những fact phải đi qua session boundary. Thêm supersession và scope check trước khi mở rộng recall. Cuối cùng, cô lập một exploration step tốn kém sau specialist summary contract và so sánh context size, latency, cost cùng decision quality của lead agent.

Lộ trình nên kết thúc bằng các case đối kháng: policy stale, message user mâu thuẫn, tool result bị duplicate, approval hết hạn, tenant mismatch, summary malformed và recovery buộc agent fetch evidence lại. Những case này nên nằm cùng repository và CI pipeline với regression test khác của agent.

## Kết luận

Agent chạy dài không cần nhớ tất cả. Nó cần nhớ **đúng thứ, đúng boundary**, chứng minh được những thứ đó đến từ đâu và bỏ được điều không còn hỗ trợ decision an toàn tiếp theo.

Context engineering là kỷ luật giúp điều đó xảy ra. Nó biến retrieval thành selection, biến summarization thành loss contract, biến memory thành state có governance và biến sub-agent thành working set được cô lập. Kết quả không phải một prompt thông minh hơn. Đó là một system tạo cơ hội tốt hơn cho model có năng lực giữ được coherence khi task dài, nhiều tool và thật sự đi vào production.

## References

[1]: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents "Anthropic — Effective context engineering for AI agents"
[2]: https://sourcegraph.com/blog/context-engineering "Sourcegraph — Context Engineering: A Practical Guide for AI Agents"
[3]: https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools "Claude Cookbook — Context engineering: memory, compaction, and tool clearing"
