---
title: "Synthetic User cho AI Agent: Sinh Scenario mà không làm rò rỉ Evaluation"
description: "Synthetic user giúp mở rộng kiểm thử end-to-end cho AI agent, nhưng simulator được huấn luyện từ answer key có thể khiến evaluation trông tốt hơn thực tế. Playbook production này trình bày grounded behavior, scenario factory, held-out partition, leakage control, fidelity check và continuous evaluation."
pubDate: 2026-06-19
category: "engineering"
image: "/blog/synthetic-users-ai-agents/hero.webp"
lang: "vi"
translationKey: "synthetic-users-ai-agents"
draft: false
---

![Scenario factory tạo nhiều agent task khác nhau nhưng giữ locked evaluation set sau một lớp bảo vệ](/blog/synthetic-users-ai-agents/hero.webp)

Tôi từng thấy một agent vượt qua evaluation suite thuyết phục đến mức cả team gần như promote model mới ngay trong buổi chiều hôm đó. Dashboard xanh. User simulator nghe có vẻ kiên nhẫn, tool call hợp lệ, còn final answer khớp với reference output.

Sau đó có người thay một câu trong user prompt.

Simulator không còn hỏi follow-up question mà benchmark mong đợi. Nó chấp nhận một ngày tháng sai rõ ràng, không phản biện policy mâu thuẫn, và hoàn thành task trong ít turn hơn nhiều so với một khách hàng thật. Agent không hề an toàn hơn. Chúng tôi đã vô tình train bài test trở nên quá hợp tác.

Failure này rất dễ bị chẩn đoán nhầm là vấn đề của model. Thực ra nó xảy ra ở ranh giới giữa **scenario generation** và **evaluation validity**. Một synthetic user không tự động là user realistic, và một đống prompt được generate cũng không tự động trở thành benchmark khó.

> **Luận điểm chính:** Hãy dùng synthetic user để mở rộng không gian tương tác của agent, không phải để sản xuất bằng chứng rằng agent đang hoạt động tốt. Generator, simulator, evaluator và locked test set phải có các trách nhiệm khác nhau; final evaluation phải vẫn nằm ngoài tầm biết của những hệ thống đang được tối ưu.

Bài viết này là một production playbook cho team kiểm thử tool-using agent và multi-agent system. Trọng tâm là end-to-end scenario: user có objective, thông tin chưa đầy đủ, preference, constraint và đôi khi có lý do để đổi ý. Agent phải retrieve context, quyết định có cần hỏi hay không, gọi tool, tuân thủ policy, recovery sau failure và tạo outcome có thể kiểm tra.

## Synthetic user là một test instrument, không phải khách hàng giả

Cụm từ “synthetic user” đang che giấu nhiều công việc khác nhau. Persona dùng để brainstorm product copy không giống simulator điều khiển agent qua một booking workflow. Một generated test case có reference answer cũng không giống một multi-turn actor quyết định liệu agent đã tạo đủ niềm tin để tiếp tục hay chưa.

Tách các công việc đó là lớp anti-leakage đầu tiên.

| Artifact | Công việc chính | Nó nên biết gì | Nó không được biết gì |
|---|---|---|---|
| **Scenario generator** | Tạo task instance và hidden condition đa dạng. | Domain schema, variation rule, safety constraint. | Final model score hoặc private answer key của locked test. |
| **User simulator** | Đóng vai user qua nhiều turn. | User goal, available fact, preference và behavioral policy. | Exact rubric của evaluator hoặc expected tool trace của agent. |
| **Agent under test** | Giải quyết task bằng tool và policy. | Runtime context mà deployment thật sẽ cung cấp. | Hidden goal, expected answer hoặc evaluator annotation. |
| **Evaluator** | Chấm observable behavior theo invariant. | Ground truth, policy rule và scoring rubric. | Private reasoning không thể tái tạo từ trace. |
| **Human reviewer** | Calibrate automated judgment và điều tra ambiguity. | Sampled trace và rubric. | Giả định rằng aggregate score cao đồng nghĩa hệ thống an toàn. |

Sự tách biệt này quan trọng vì simulator có thể fluent nhưng vẫn là một test instrument tệ. Nó có thể luôn comply, tiết lộ hidden goal quá sớm, dùng cùng một cách diễn đạt trong mọi run hoặc dừng sau câu trả lời đầu tiên có vẻ hợp lý. Những hành vi đó làm benchmark dễ bị optimize và kém khả năng dự báo deployment.

Hướng dẫn evaluation của OpenAI khuyến nghị task-specific evaluation phản ánh real-world distribution, continuous evaluation, automation khi phù hợp và calibration với human feedback.[1] Hệ quả trực tiếp với synthetic user là generator phải model distribution của các tình huống, không chỉ sinh ra prompt đúng ngữ pháp.

## Vì sao scenario generation hấp dẫn—và nguy hiểm

Conversation thật tốn kém để thu thập, khó label và thường chứa thông tin cá nhân hoặc confidential. Production trace cũng có thể quá ít ở đúng những corner case quan trọng: user đổi destination sau approval, customer cung cấp hai identifier mâu thuẫn, hoặc manager yêu cầu agent tiết lộ thông tin cho sai audience.

Synthetic generation có thể tạo các tổ hợp này rất nhanh. Nó có thể thay đổi account state, time, policy version, tool availability, user frustration và hidden objective trong khi vẫn giữ business invariant của task. Nó cũng tạo được negative case vốn không phù hợp hoặc không an toàn để dàn dựng với khách hàng thật.

Nguy cơ là hệ thống generation thường tối ưu cho thứ chúng dễ mô tả. Chúng tạo ra user lịch sự, nói rõ một intent duy nhất, dữ liệu sạch và success condition hiển nhiên. Benchmark sau đó đo xem agent có thể làm hài lòng một narrator hợp tác hay không, chứ không đo xem agent xử lý một tương tác thật thế nào.

Korea và Singapore AI Safety Institutes đã ghi nhận một bài học tương tự trong joint testing. Các benchmark trước đó dùng dữ liệu lộ rõ tính synthetic và local website, khiến agent có xu hướng hành xử như thể task là giả lập. Phương pháp sau này tăng realism bằng mirrored MCP server, realistic test data, multi-turn interaction và các application kết nối với nhau.[2]

Vì vậy, synthetic user cần hai loại realism:

1. **World realism:** task state, data, policy, tool và consequence giống môi trường deployment.
2. **Behavioral realism:** turn của user, sự không chắc chắn, correction, impatience và willingness to continue giống hành vi có thể xảy ra ở người thật.

Không loại nào đòi hỏi sao chép một người cụ thể. Điều cần thiết là định nghĩa thứ gì được phép thay đổi, thứ gì phải giữ invariant và scenario chỉ tiết lộ thông tin mà user thật có thể biết ở thời điểm đó.

## Bắt đầu bằng scenario contract

Đừng bắt đầu bằng câu “generate 10.000 user prompt”. Hãy bắt đầu bằng một scenario contract có thể được validate trước khi LLM viết prose.

```ts
type ScenarioContract = {
  scenarioId: string;
  domain: "support" | "commerce" | "hr" | "finance" | "healthcare";
  userGoal: string;
  hiddenConstraints: string[];
  availableFacts: Record<string, unknown>;
  forbiddenFacts: string[];
  policyVersion: string;
  allowedTools: string[];
  expectedInvariants: string[];
  riskTags: string[];
  difficulty: "routine" | "ambiguous" | "adversarial";
  provenance: {
    generatorVersion: string;
    templateVersion: string;
    sourceFamily: string;
  };
};
```

Contract là stable object. Natural-language conversation chỉ là một cách render object đó. Phân biệt này cho phép team test nhiều cách diễn đạt mà không đổi ground truth, đồng thời cho evaluator kiểm tra scenario có coherent trước khi đưa tới agent.

Một contract hữu ích lưu cả visible và hidden state. Giả sử user yêu cầu HR assistant đặt lịch phỏng vấn. Visible state có thể chứa tên candidate và hai time window còn trống. Hidden constraint có thể là user không được chia sẻ thông tin y tế của candidate với interviewer bên ngoài. Task không hoàn tất chỉ vì calendar event đã được tạo. Agent còn phải giữ đúng policy boundary trong lúc hành động.

Contract cũng nên gọi tên **negative space**: fact mà user không biết, fact agent không được tiết lộ, tool không khả dụng và action cần clarification. Nếu không có negative space, generator sẽ lấp đầy mọi khoảng trống bằng context tiện lợi và âm thầm xóa bỏ uncertainty mà agent đáng lẽ phải xử lý.

## Xây scenario factory, không xây prompt spinner

Scenario factory có các controlled dimension. Mỗi dimension mô tả một thay đổi có ý nghĩa trong world hoặc interaction, không phải một cách viết lại mang tính mỹ phẩm.

| Dimension | Ví dụ giá trị | Invariant cần giữ |
|---|---|---|
| User objective | Refund, exchange, explain, cancel, escalate | Business outcome định nghĩa success. |
| Information state | Complete, partial, contradictory, stale | Agent không được bịa fact còn thiếu. |
| Emotional state | Neutral, rushed, frustrated, skeptical | Tone user có thể đổi; policy requirement không đổi. |
| Conversation behavior | Cooperative, corrects detail, asks why, changes mind | Hidden goal vẫn traceable qua các turn. |
| Environment | Tool healthy, slow, unavailable, partially authorized | Failure handling phải observable. |
| Policy context | Standard, stricter tenant, version transition | Policy áp dụng phải explicit và versioned. |
| Risk | Low, financial, privacy, irreversible action | Approval và escalation rule phải testable. |
| Language surface | Short, verbose, indirect, typo-heavy | Semantic intent vẫn nằm trong cùng contract. |

Factory nên sample combination một cách có chủ đích. Pure random sampling thường tạo quá nhiều case ở trung tâm distribution và quá ít dangerous intersection. Pairwise coverage là điểm bắt đầu hợp lý; risk-weighted coverage tốt hơn khi một số tổ hợp có blast radius lớn hơn nhiều.

Ví dụ, “frustrated user” một mình không phải scenario dimension có giá trị. “Frustrated user + ambiguous identity + tool timeout + yêu cầu gửi document ra ngoài” là compound case có ý nghĩa, vì nó test agent có đánh đổi safety để lấy speed dưới áp lực hay không.

Hãy generate structured state trước, rồi render initial user turn. Nếu LLM viết state và conversation trong cùng một pass, nó thường tự sửa contradiction bằng cách bịa fact. Deterministic validator nên reject scenario khi user goal, available facts, policy và expected invariant không khớp.

![Scenario factory tách stable task invariant khỏi các variation có kiểm soát về user, world, policy và tool](/blog/synthetic-users-ai-agents/scenario-factory.webp)

## Ground user simulator bằng behavior, nhưng không copy test

User simulator cần behavioral policy, nhưng một đoạn persona dài không phải behavioral policy. “Bạn là một customer thiếu kiên nhẫn và ghét bureaucracy” quá mơ hồ để reproducible và quá dễ bị diễn giải quá mức. Model này có thể tạo cơn giận kịch tính, model khác lại comply vô hạn.

Simulator tốt hơn nên nhận một state machine nhỏ:

```ts
type UserState = {
  goal: string;
  knownFacts: Record<string, unknown>;
  withheldFacts: string[];
  trust: number;
  patience: number;
  turn: number;
  correctionBudget: number;
  exitConditions: string[];
};

type UserPolicy = {
  answerWhenAsked: string[];
  refuseWhenAsked: string[];
  revealOnlyAfter: string[];
  correctionTriggers: string[];
  escalationTriggers: string[];
  terminationRules: string[];
};
```

Simulator nên quyết định có answer, clarify, correct, object hay exit dựa trên state và observable action gần nhất của agent. Nó không nên được dặn “hãy làm agent fail”. Instruction đó tạo ra adversarial theater thay vì pressure realistic. Thay vào đó, simulator nên follow goal và các rule khiến một số agent behavior tự nhiên thành công còn các behavior khác thất bại.

Nghiên cứu gần đây về grounded user simulation cũng phân biệt hai điều này. RealUserSim báo cáo rằng LLM simulator không bị ràng buộc có thể là proxy kém cho behavior của con người, còn directive viết thủ công có thể gây “directive amplification”, khi simulator phóng đại instruction thành hành vi không tự nhiên. Nghiên cứu grounding simulation bằng observed human–LLM conversation và đánh giá fidelity tách biệt với agent task success.[3]

Bài học thực tế không phải scrape conversation rồi paste vào prompt. Hãy trích xuất behavioral pattern có thể tái sử dụng—user sửa hiểu nhầm thế nào, lúc nào thêm context, phản ứng ra sao với friction—và giữ các pattern đó tách khỏi private goal và answer key của benchmark.

Simulator nên được chấm ít nhất trên hai trục:

| Trục | Câu hỏi | Tín hiệu ví dụ |
|---|---|---|
| **Task pressure** | User có tạo đúng information pressure và decision pressure mà scenario yêu cầu không? | User chỉ cung cấp identifier thứ hai sau khi agent giải thích vì sao cần nó. |
| **Behavioral fidelity** | Interaction có giống class behavior của user dự kiến mà không trở nên theatrical không? | Turn length, correction frequency, escalation timing và exit behavior nằm trong range đã calibrate. |

High fidelity không có nghĩa khớp từng từ với một người cụ thể. Nó có nghĩa giữ được behavioral constraint làm cho test có ý nghĩa.

## Evaluation firewall: giữ answer key bên ngoài generation

Evaluation leakage rộng hơn việc “model nhìn thấy final answer”. Nó bao gồm mọi thông tin giúp generator hoặc simulator tối ưu về phía locked test: exact rubric, hidden goal, canonical tool trace, reference output, evaluator comment, thậm chí một template đặc biệt chỉ xuất hiện trong test set.

Hãy dùng partition có access rule rõ ràng.

```text
scenario source families
          |
          v
   generator partition  ----> development scenarios ----> prompt/model iteration
          |
          +----> quarantine and deduplication
          |
          +----> locked evaluation partition ----> evaluator only
                                             |
                                             v
                                       final report
```

![Evaluation firewall giữ generator và development artifact cách xa locked test set cùng evaluator-only annotation](/blog/synthetic-users-ai-agents/split-and-lock.webp)

Một partitioning policy thực tế có thể như sau:

| Partition | Dùng cho | Có được regenerate không? | Ai được thấy hidden label? |
|---|---|---:|---|
| **Generation** | Tạo scenario family, paraphrase và controlled variant. | Có. | Generator owner, nhưng không có final answer key. |
| **Development** | Tune prompt, tool, policy và simulator behavior. | Có, với provenance được version hóa. | Engineer có thể inspect label. |
| **Shadow** | Phát hiện drift và ước lượng performance trên scenario mới. | Định kỳ. | Reviewer giới hạn. |
| **Locked evaluation** | Tạo release evidence. | Không trong release-candidate window. | Chỉ evaluator và reviewer được duyệt. |
| **Production sample** | So sánh benchmark assumption với traffic thật. | Liên tục, có privacy control. | Chỉ analyst có quyền. |

Locked set không trở nên valid chỉ vì được bỏ vào folder khác. Hãy bảo vệ nó ở cấp vận hành. Đừng gửi nó cho prompt optimizer đang edit agent. Đừng dùng evaluator comment làm simulator instruction. Đừng để failed test tự động trở thành training example mới mà không ghi lại vì sao nó fail và thuộc partition nào.

LatestEval mô tả cách dynamic construction dùng recent material và loại phần chứa answer khỏi context để giảm contamination risk.[6] Nguyên tắc tổng quát này hữu ích, nhưng không phương pháp nào chứng minh được closed model chưa từng gặp một scenario. Hãy báo limitation một cách trung thực. Dùng source family mới, rotate scenario template, giữ provenance và kiểm tra near-duplicate thay vì tuyên bố benchmark có độ tinh khiết tuyệt đối.

## Đưa leakage budget vào pipeline

Team thường nói về leakage theo kiểu nhị phân: clean hoặc contaminated. Mô hình vận hành hữu ích hơn là leakage budget. Mỗi shortcut làm lộ thông tin về final evaluation sẽ tiêu tốn một phần budget.

Ví dụ gồm:

- Reuse cùng một rare phrase trong development và locked scenario.
- Cho simulator xem exact “must mention” rubric của evaluator.
- Đưa failure trace trước đó trực tiếp vào generator mà không mask expected fix.
- Chọn final test case sau khi xem case nào tạo score thấp.
- Dùng một model family để generate scenario rồi coi phrasing mà nó thích là natural distribution.

Budget không phải một xác suất formal. Nó là review mechanism buộc team hỏi thông tin nào đã đi qua firewall và vì sao. Mỗi scenario record nên có lineage trail:

```json
{
  "scenario_id": "scn_7e91",
  "partition": "locked_eval",
  "source_family": "policy-transition-04",
  "generator_version": "factory-2.3.1",
  "simulator_version": "user-state-1.6.0",
  "template_hash": "sha256:...",
  "dedupe_cluster": "cluster_118",
  "label_visibility": "evaluator-only",
  "approved_at": "2026-06-19T09:30:00Z"
}
```

Nếu team không giải thích được scenario được tạo, transform, select và label như thế nào, team cũng không thể giải thích vì sao score của nó đáng tin.

## Quality gate trước khi agent nhìn thấy scenario

Generated content nên đi qua structural gate trước semantic evaluation. Gate đầu tiên không phải LLM judge; đó là validator bắt impossible data.

Tối thiểu hãy validate:

1. User goal tương thích với available fact và tool.
2. Hidden constraint không mâu thuẫn với policy version.
3. Expected invariant test được từ observable event.
4. Fixture không chứa secret, real personal record hoặc production credential.
5. Scenario không phải near-duplicate của development hoặc locked case có sẵn.
6. Conversation có thể terminate trong bounded turn budget.
7. Scenario có owner, provenance, risk class và partition rõ ràng.

Sau đó áp dụng semantic check. Model thứ hai có thể critique conversation có plausible không, nhưng không nên là judge duy nhất. Hãy sample case để human review và đo agreement trên các condition yes/no cụ thể.

Phương pháp của AISI dùng correctness và safety condition theo từng task, thường viết thành câu hỏi granular, đồng thời đánh dấu một số safety condition là not applicable khi prerequisite action chưa xảy ra.[2] Đây là pattern hữu ích cho agent benchmark. Nếu agent chưa bao giờ gửi email, đừng giả vờ rằng đã đo email có làm lộ secret hay chưa. Hãy ghi prerequisite chưa đạt và chấm theo semantics đã định nghĩa trong rubric.

Synthetic benchmark workflow của NVIDIA cũng nhấn mạnh domain-specific generation, quality scoring và filtering, pairing với ground truth và evaluation reproducible trong CI/CD.[4] Phần quan trọng là chain, không phải product name: generated example phải được inspect, label và replay trước khi trở thành evidence.

## Đánh giá full trace, không chỉ final answer

Agent có thể tạo một câu cuối đúng sau khi đã thực hiện unsafe tool call. Nó cũng có thể tạo một câu trả lời thận trọng trong khi không hoàn thành legitimate task của user. Chỉ chấm final answer sẽ che giấu cả hai trường hợp.

Hãy capture full observable trace:

```text
scenario=scn_7e91
  user_turn_1 -> asks to move a meeting
  agent       -> asks for timezone
  user_turn_2 -> provides timezone, withholds private note
  agent       -> calendar.lookup()
  tool        -> returns two candidates
  agent       -> asks clarification instead of guessing
  user_turn_3 -> selects candidate B
  agent       -> calendar.update()
  outcome     -> one event moved, private note never disclosed
```

Chấm các dimension riêng và giữ trace phía sau mỗi score.

| Dimension | Invariant ví dụ |
|---|---|
| Goal completion | Event được yêu cầu được update đúng một lần. |
| Information discipline | Agent không tiết lộ fact bị withheld hoặc unauthorized. |
| Clarification quality | Agent chỉ hỏi thông tin cần để xử lý ambiguity. |
| Tool correctness | Argument khớp resource đã chọn và policy hiện tại. |
| Recovery behavior | Timeout dẫn tới lookup hoặc escalation, không blind repeat. |
| User experience | User nhận được giải thích dễ hiểu về next step. |
| Trace integrity | Record có đủ evidence để reproduce judgment. |

AgentLeak cho thấy vì sao điều này quan trọng với multi-agent system: sensitive data có thể đi qua inter-agent message, shared memory và tool argument dù final answer trông an toàn.[5] Vì vậy synthetic-user harness nên log và evaluate những channel mà deployment thực sự expose, với privacy minimization phù hợp. Output-only audit không đủ cho system có behavior phân tán qua internal channel.

## Tránh self-confirming synthetic loop

Có một failure mode tinh vi khi mọi component đồng ý vì chúng được xây từ cùng assumption. Generator viết scenario. Simulator hành động theo persona của generator. Evaluator thưởng cho answer mà generator thích. Model cùng family critique output bằng vocabulary tương tự. Score kết quả internally consistent nhưng externally wrong.

Hãy chủ động phá loop.

| Component | Separation hữu ích |
|---|---|
| Generator | Dùng nhiều template, seed family hoặc model provider. |
| Simulator | Thay đổi simulator model hoặc policy implementation trong lúc calibrate. |
| Agent | Test release candidate với tool và policy stack thật. |
| Evaluator | Kết hợp deterministic invariant, model-based grading và human review. |
| Data source | Mix synthetic, human-curated, production-sampled và domain-expert case khi privacy cho phép. |
| Release decision | Yêu cầu evidence từ locked set không được dùng trong iteration. |

Đừng xem disagreement là noise cần average away. Nếu hai simulator tạo turn count hoặc escalation rate khác nhau rõ rệt, đó là tín hiệu cần inspect behavioral contract. Nếu hai grader bất đồng về việc disclosure có được authorize không, rubric có thể đang underspecified.

Benchmark tốt expose uncertainty thay vì giấu nó trong một decimal score. Hãy report confidence interval hoặc repeated-run range khi phù hợp, segment result theo scenario family và risk tag, đồng thời giữ đủ trace để điều tra regression.

## Continuous evaluation mà không làm ô nhiễm tương lai

Synthetic scenario có giá trị nhất khi trở thành test system được duy trì, không phải dataset dùng một lần. Mọi thay đổi ở prompt, model, tool, policy hoặc orchestration đều có thể đổi behavior. Hướng dẫn của OpenAI khuyến nghị continuous evaluation và bổ sung case mới từ production feedback.[1]

Một safe update loop có thể như sau:

1. Mine candidate failure pattern từ production trace sau privacy review và redaction.
2. Chuyển pattern thành scenario contract mà không copy nguyên văn của customer.
3. Generate controlled variant rồi chạy structural, semantic và near-duplicate check.
4. Đưa case vào development hoặc shadow trước; không promote thẳng vào locked set.
5. Calibrate rubric với human reviewer và record decision.
6. Freeze release candidate rồi chạy locked evaluation mà không để agent hoặc optimizer thấy label.
7. Sau release, so sánh benchmark segment với production outcome và retire scenario không còn đại diện cho world.

Locked set nên stable đủ lâu để so sánh release, nhưng không tĩnh đến mức team memorise nó. Hãy rotate shadow set từ source family mới và giữ rotation process độc lập với release score. Fresh scenario chưa đủ trusted vẫn hữu ích như drift signal mà chưa cần trở thành pass/fail gate chính thức.

![Continuous evaluation loop đưa production pattern đã redact vào development và shadow set trong khi bảo vệ locked release gate](/blog/synthetic-users-ai-agents/fidelity-loop.webp)

## Rollout plan cho team nhỏ

Team không cần một nghìn scenario ngay từ ngày đầu. Hãy bắt đầu bằng một workflow và làm cho evidence đáng tin.

**Tuần một: define contract.** Chọn workflow có business outcome rõ và blast radius giới hạn. Viết mười scenario bởi con người, xác định invariant và liệt kê thông tin user/agent không được thấy. Xây deterministic validation trước khi thêm synthetic generation.

**Tuần hai: thêm controlled variation.** Tạo dimension cho user behavior, world state, policy, tool health và risk. Generate một development set nhỏ, inspect duplicate và record provenance. Ở giai đoạn này hãy giữ locked set do human curate.

**Tuần ba: thêm simulator.** Implement stateful user policy với bounded turn, correction rule và exit condition. So sánh behavior của simulator với một sample nhỏ từ interaction thật hoặc do con người viết. Đo fidelity tách biệt với agent success.

**Tuần bốn: thêm firewall.** Tách quyền generation, development, shadow và locked evaluation. Thêm template hash, partition check, label access log và review step cho mỗi lần promote. Chạy cùng release qua deterministic invariant, model-based grader và human calibration.

Sau đó tăng coverage dựa trên failure mode đã quan sát, không dựa trên vanity target như “một triệu prompt”. Một suite nhỏ hơn nhưng có invariant traceable và partition trung thực có giá trị hơn suite khổng lồ mà answer key xuất hiện ở khắp nơi.

## Quy tắc thiết kế cần mang theo

Synthetic user mạnh chính vì nó cho engineering team khám phá những interaction quá đắt, quá riêng tư, quá hiếm hoặc quá rủi ro để stage với khách hàng thật. Sức mạnh đó trở nên nguy hiểm khi simulator bị coi là oracle hoặc benchmark được optimize tới mức nhận ra chính fingerprint của mình.

Hãy giữ scenario contract ổn định, user behavior có state, evaluator dựa trên evidence và locked set khó tiếp cận một cách có chủ đích. Đo simulator có tạo đúng pressure trước khi tin agent score nói lên điều gì. Theo dõi provenance để generated case không bị nhầm thành observed fact. So sánh benchmark với production để realism của synthetic vẫn là một câu hỏi thực nghiệm.

Mục tiêu không phải làm user simulator thông minh. Mục tiêu là làm evaluation khó bị đánh lừa.

Đó là khác biệt giữa việc generate thêm test case và xây một evaluation system mà team có thể tin cậy.

## Đọc tiếp

Về thiết kế regression suite, xem [Do Not Ship a Tool-Calling AI Agent Without Evals](/blog/agent-evals-regression-suite). Về product behavior khi không chắc chắn, đọc tiếp [When AI Gives a Partial Answer](/blog/ai-partial-answer-uncertainty-ux). Về privacy risk qua internal agent channel, đối chiếu methodology này với [AI Agent Identity Is Not a User ID](/blog/agent-identity-delegation-revocation).

## References

[1]: https://developers.openai.com/api/docs/guides/evaluation-best-practices "OpenAI API — Evaluation best practices"
[2]: https://sgaisi.sg/resources/testing-ai-agents-for-data-leakage-risks-in-realistic-tasks/ "AISI — Testing AI Agents for Data Leakage Risks in Realistic Tasks"
[3]: https://arxiv.org/abs/2605.20204 "RealUserSim: Bridging the Reality Gap in Agent Benchmarking via Grounded User Simulation"
[4]: https://developer.nvidia.com/blog/how-to-build-privacy-preserving-evaluation-benchmarks-with-synthetic-data/ "NVIDIA Technical Blog — How to Build Privacy-Preserving Evaluation Benchmarks with Synthetic Data"
[5]: https://arxiv.org/html/2602.11510v2 "AgentLeak: A Full-Stack Benchmark for Privacy Leakage in Multi-Agent LLM Systems"
[6]: https://arxiv.org/html/2312.12343v1 "Avoiding Data Contamination in Language Model Evaluation: Dynamic Test Construction with Latest Materials"
