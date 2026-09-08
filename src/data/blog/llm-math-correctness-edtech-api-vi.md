---
title: "LLM sinh Toán đáng tin cho EdTech: Kiến trúc Verification-First khi dùng API"
description: "Production playbook xây dựng hệ thống sinh bài toán và phản hồi học tập bằng LLM API nhưng vẫn kiểm soát tính đúng, tính giải được, tính sư phạm và an toàn phát hành bằng verifier độc lập."
pubDate: 2026-07-28
category: "engineering"
lang: "vi"
translationKey: "llm-math-correctness-edtech-api"
draft: false
image: "/blog/llm-math-correctness-edtech/hero.webp"
---

Đầu ra nguy hiểm nhất của một AI tutor dạy toán không phải là một đáp án vô lý nhìn qua đã thấy sai. Nguy hiểm hơn là một lời giải được viết rất trôi chảy, có giọng điệu giống giáo viên, chỉ chứa một bước biến đổi đại số không hợp lệ, nhưng lại đủ thuyết phục để học sinh ghi nhớ nhầm lẫn đó.

Failure mode này làm thay đổi câu hỏi engineering. Câu hỏi không chỉ là LLM có thể sinh một bài toán, giải một phương trình hoặc giải thích phân số hay không. Câu hỏi đúng phải là: **sản phẩm EdTech có biết khi nào artifact được sinh ra là đúng, giải được, phù hợp sư phạm và đủ an toàn để publish hay không**.

LLM API là một generator, paraphraser và giao diện tutor hữu ích. Nó không phải nguồn sự thật toán học. Nghiên cứu về LLM trong vai trò math tutor cho thấy response có thể trông phù hợp với nguyên tắc sư phạm nhưng vẫn chứa nhiều inaccuracies; những lỗi nghe hợp lý có thể tạo misconception cho người học.[1](https://arxiv.org/html/2503.16460v1) Nghiên cứu về stepwise verification cũng chỉ ra rằng việc tìm đúng bước sai đầu tiên trong lời giải của học sinh là bài toán khó với các model hiện tại, trong khi verifier độc lập có thể giúp feedback chính xác và có mục tiêu hơn.[2](https://aclanthology.org/2024.emnlp-main.478/)

![Một candidate toán do LLM sinh ra đi qua các cổng verification độc lập trước khi được hệ thống EdTech phát hành](/blog/llm-math-correctness-edtech/hero.webp)

> **Luận điểm chính:** Hãy để LLM đề xuất nội dung toán, nhưng để tính toán xác định, symbolic reasoning, luật chương trình học và human review quyết định nội dung đó có được publish hay không.

Bài viết này trình bày một kiến trúc verification-first cho hệ thống EdTech dùng LLM API để sinh câu hỏi luyện tập, đáp án, lời giải từng bước, hint và feedback. Đây là production playbook cho team xây content pipeline, không phải một prompt dùng thử trong cửa sổ chat.

## Tính đúng không phải một boolean duy nhất

Một math item được sinh tự động có thể sai theo nhiều cách độc lập. Con số cuối cùng có thể đúng nhưng lời giải thích lại sai. Đại số có thể hợp lệ nhưng câu hỏi mơ hồ. Bài toán có thể giải được nhưng không phù hợp grade level. Response JSON có thể pass schema trong khi field answer mâu thuẫn với các bước giải.

Nếu gom tất cả thành `correct: true/false`, ta sẽ che mất failure mode thực sự. Thiết kế tốt hơn là biểu diễn các claim rõ ràng và dùng cơ chế đáng tin cậy, ít tốn kém nhất để kiểm tra từng claim.

| Thuộc tính | Câu hỏi cần kiểm tra | Verifier ưu tiên |
|---|---|---|
| Schema validity | Response API có đủ field và đúng type không? | JSON Schema hoặc typed parser |
| Solvability | Bài toán có ít nhất một nghiệm hợp lệ trong domain đã nêu không? | Symbolic solver, constraint solver hoặc enumerator |
| Answer correctness | Đáp án có thỏa phương trình hay phép tính không? | Exact arithmetic, SymPy, Z3 hoặc engine chuyên biệt |
| Step validity | Mỗi phép biến đổi có bảo toàn quan hệ ban đầu không? | Symbolic equivalence và step-level checker |
| Domain safety | Mẫu số có khác 0, biểu thức dưới căn có hợp lệ, đơn vị có nhất quán không? | Constraint và invariant checks |
| Problem quality | Câu chữ có rõ và nhất quán nội tại không? | Rule checks, evaluator và human sampling |
| Pedagogical fit | Item có đúng grade, skill, difficulty và hint policy không? | Curriculum rubric và reviewer |
| Release safety | Quality, safety, cost và latency có nằm trong ngưỡng không? | Regression suite và release gate |

Phân biệt này rất quan trọng vì structured response không tự động trở thành response đúng. Structured Outputs có thể ràng buộc response API theo JSON Schema và giúp phát hiện refusal bằng chương trình, nhưng tài liệu cũng cảnh báo rằng structured output vẫn có thể chứa lỗi.[3](https://developers.openai.com/api/docs/guides/structured-outputs) Schema compliance chỉ là cổng đầu tiên, không phải bằng chứng toán học.

## Tách generation contract khỏi mathematics contract

Không nên yêu cầu LLM trả về một đoạn văn không cấu trúc rồi bắt service khác reverse-engineer lại nội dung. Hãy yêu cầu model sinh một candidate artifact có type rõ ràng và đủ thông tin để verifier tính lại các claim.

Một internal representation hữu ích có thể như sau:

```json
{
  "item_id": "alg-linear-000184",
  "skill": "solve_one_step_linear_equations",
  "grade_band": "6-7",
  "prompt": "Một số cộng thêm 7 bằng 19. Số đó là bao nhiêu?",
  "variables": [{"name": "x", "domain": "integers"}],
  "constraints": ["x + 7 = 19"],
  "expected_answers": [{"value": "12", "form": "integer"}],
  "solution_steps": [
    {"claim": "x + 7 = 19", "operation": "given"},
    {"claim": "x = 19 - 7", "operation": "trừ 7 ở cả hai vế"},
    {"claim": "x = 12", "operation": "tính toán"}
  ],
  "hint_policy": "scaffold_without_revealing_answer",
  "pedagogical_intent": "cô lập biến bằng phép toán ngược"
}
```

Field `constraints` không phải phần giải thích để trang trí. Đây là problem statement mà máy có thể kiểm tra. Field `expected_answers` cũng không được tin chỉ vì model đã sinh ra nó. Verifier phải tự suy ra đáp án rồi so sánh bằng một equivalence rule phù hợp với domain.

Contract cũng phải biểu diễn failure state. Model refusal, response sai schema, thiếu domain của biến, đơn vị mơ hồ hoặc biểu thức chưa giải được không được biến thành empty string rồi publish. Chúng phải trở thành rejection có type để pipeline có thể đếm, retry, quarantine hoặc chuyển sang review.

```text
CandidateStatus =
  ACCEPTED
  REJECTED_SCHEMA
  REJECTED_UNSOLVABLE
  REJECTED_MATH
  REJECTED_PEDAGOGY
  NEEDS_HUMAN_REVIEW
  GENERATION_REFUSED
```

## Verification pipeline

Pipeline đáng tin cậy phải bất đối xứng có chủ đích. Generation có thể probabilistic và sáng tạo; acceptance phải conservative và reproducible.

```text
LLM API generation
        ↓
Structured parse + schema validation
        ↓
Canonicalize expression, unit và answer form
        ↓
Solve hoặc execute độc lập
        ↓
Verify answer, constraint và từng solution step
        ↓
Chạy adversarial test và metamorphic test
        ↓
Kiểm tra curriculum và pedagogy
        ↓
Human review theo sample và risk
        ↓
Publish, monitor hoặc quarantine
```

Pipeline nên fail closed. Nếu solver timeout, assumption bắt buộc bị thiếu hoặc checker không quyết định được equivalence, item không được âm thầm pass. Fallback an toàn là regenerate với task hẹp hơn, chuyển sang template đơn giản hơn hoặc đưa vào hàng đợi human review.

![Math contract có cấu trúc được kiểm tra bởi parser, symbolic solver, domain invariant và pedagogical rule](/blog/llm-math-correctness-edtech/structured-math-contract.webp)

## Lớp một: parse và canonicalize trước khi solve

Chuỗi biểu diễn toán học khó so sánh hơn vẻ ngoài. `0.5`, `1/2` và `50%` có thể tương đương trong một ngữ cảnh nhưng không tương đương trong ngữ cảnh khác. `x^2 - 1` và `(x - 1)(x + 1)` tương đương đại số trên tập số thực, nhưng text comparison sẽ đánh dấu là khác. Decimal answer cũng có thể ẩn giả định rounding.

Trước verification, hãy canonicalize artifact. Chuẩn hóa Unicode minus, parse số thành rational exact nếu có thể, nhận diện unit và chuyển expression tương đương về một internal representation. Không dùng floating-point equality cho bài đại số exact trừ khi sản phẩm định nghĩa rõ tolerance.

Canonicalizer phải giữ nguyên student-facing text để hiển thị, đồng thời tạo machine-facing form riêng. Điều này tránh một lỗi phổ biến: rewrite explanation của học sinh thành expression chuẩn hóa rồi làm mất context cần cho pedagogical feedback.

## Lớp hai: tính lại bằng engine độc lập

Rule hữu ích đơn giản nhất là tính đáp án hai lần bằng hai cơ chế khác nhau. Nếu LLM nói `3/4 + 2/3 = 17/12`, một rational library exact có thể kiểm tra mà không cần hỏi model thứ hai. Với đại số, symbolic system có thể solve phương trình rồi substitute candidate answer vào constraint ban đầu. Tài liệu SymPy mô tả symbolic equation solving qua `solveset` và các solver API liên quan.[4](https://docs.sympy.org/latest/modules/solvers/solvers.html)

Với bài có nhiều constraint, SMT solver có thể biểu diễn biến, domain, bất đẳng thức và quan hệ logic. Programming Z3 guide trình bày API thực tế để giải các constraint số học và logic.[5](https://theory.stanford.edu/~nikolaj/programmingz3.html) Không phải bài toán cấp phổ thông nào cũng cần theorem prover. Điểm cốt lõi là đáp án cuối được kiểm tra bởi một hệ thống không hoạt động giống token prediction của language model.

Một verification routine tối thiểu cho phương trình tuyến tính có thể có dạng:

```python
from sympy import Eq, Integer, Symbol, solveset, S, simplify

x = Symbol("x", integer=True)
constraint = Eq(x + Integer(7), Integer(19))
solutions = solveset(constraint, x, domain=S.Integers)

candidate = Integer(12)
answer_ok = candidate in solutions
substitution_ok = simplify(constraint.lhs.subs(x, candidate) - constraint.rhs) == 0

assert answer_ok and substitution_ok
```

Code này không chứng minh câu tiếng Việt hay tiếng Anh là không mơ hồ, cũng không chứng minh bài phù hợp học sinh lớp 6. Nó chỉ chứng minh một claim hẹp: dưới constraint đã parse và integer domain đã nêu, 12 thỏa phương trình. Giữ ranh giới này rõ ràng giúp ta không biến solver thành universal judge.

## Lớp ba: kiểm tra cả con đường, không chỉ đích đến

Final answer đúng vẫn có thể được suy ra bằng một bước sai. Ví dụ, solution do model sinh ra chia hai vế của phương trình cho `x - 2` nhưng không chứng minh `x ≠ 2`. Với instance cụ thể, đáp án cuối có thể tình cờ đúng, nhưng transformation rule này không an toàn để dạy học sinh.

Hãy biểu diễn mỗi step dưới dạng claim cộng operation. Step verifier kiểm tra claim tiếp theo có theo sau claim trước dưới operation đó và các side condition hay không. Với equation transformation, verifier có thể so sánh solution set trước và sau step. Với numerical computation, nó tính lại hai vế exact. Với geometry hoặc word problem, có thể cần domain-specific checker hoặc constrained template.

Nghiên cứu về formal verification cho LLM-based mathematical problem solving sử dụng thiết kế formalizer và critic: chuyển reasoning bằng ngôn ngữ tự nhiên sang structured language rồi kiểm tra statement bằng computer algebra system và SMT solver.[6](https://arxiv.org/html/2505.20869v1) Pattern này hữu ích cho EdTech vì verifier kiểm tra dependency graph của các claim thay vì chỉ hỏi một LLM thứ hai xem đoạn văn có nghe đúng hay không.

## Lớp bốn: kiểm tra chính bài toán

Nhiều team chỉ verify answer key. Như vậy là quá muộn. Prompt có thể flawed, không có nghiệm, có nhiều nghiệm ngoài dự kiến, unit mâu thuẫn hoặc diagram không nhất quán với text.

Chạy các kiểm tra problem-level trước khi chấp nhận solution:

| Kiểm tra | Ví dụ lỗi |
|---|---|
| Existence | Yêu cầu “tìm số nguyên dương” nhưng mọi nghiệm đều âm |
| Uniqueness | Câu hỏi mong một đáp án nhưng constraint cho phép nhiều đáp án |
| Boundary | Xác suất lớn hơn 1 hoặc độ dài âm |
| Unit | Cộng tốc độ km/h trực tiếp với khoảng cách mét |
| Wording | Nhầm “tăng 20%” với “tăng lên 20%” |
| Diagram contract | Text nói tam giác cân nhưng tọa độ không tạo tam giác cân |
| Difficulty | Item lớp 5 âm thầm yêu cầu căn bậc hai của phương trình bậc hai |
| Answer leakage | Hint hoặc explanation nói luôn đáp án trước khi học sinh thử |

Generator phải khai báo assumption. Nếu word problem phụ thuộc vào “mọi giá tính bằng dollar”, “thời gian tính bằng giờ” hoặc “đáp án phải là số nguyên”, constraint đó phải nằm trong artifact, không chỉ nằm trong prose.

## Generation cần adversarial test và metamorphic test

Một vài happy-path example không thể kiểm tra generator. Nội dung toán phù hợp với các transformation bảo toàn hoặc làm thay đổi đáp án theo cách dự đoán được.

Metamorphic test có thể đổi tên biến, đổi thứ tự các fact không liên quan, scale toàn bộ độ dài cùng một factor, đổi unit hoặc perturb một coefficient trong khi vẫn giữ quan hệ mong đợi. Verifier phải xác nhận đáp án thay đổi đúng dự đoán. Với phương trình tuyến tính, cộng cùng một hằng số vào hai vế không được thay đổi solution set sau canonicalization. Với bài phần trăm, đổi dollar sang cent phải giữ nguyên kết quả phần trăm dù representation số thay đổi.

Adversarial test nhắm vào những chỗ language model rất dễ nói với giọng tự tin: mẫu số bằng 0, đại lượng âm, xác suất ở boundary, unit lặp, phân số lồng nhau, số lớn, đại từ mơ hồ và assumption tự nhiên mâu thuẫn.

![Metamorphic và adversarial case kiểm tra boundary value, expression tương đương, unit và assumption mơ hồ trước khi publish](/blog/llm-math-correctness-edtech/adversarial-tests.webp)

Đừng chỉ báo cáo average pass rate. Hãy theo dõi failure taxonomy. Generator có answer validity 98% nhưng unit error 12% có thể không an toàn cho curriculum khoa học. Tutor có final answer đúng 95% nhưng first-error localization kém sẽ đưa feedback có hại cho học sinh đang làm gần đúng.

## Đánh giá chất lượng tutoring riêng với answer correctness

Tutoring không phải answer key trắc nghiệm. Response có thể đúng về toán nhưng kém về giáo dục nếu lộ đáp án ngay, bỏ qua lỗi của học sinh, dùng vocabulary quá grade hoặc khen một bước sai.

Nên có ít nhất bốn nhóm evaluation:

| Dimension | Metric ví dụ |
|---|---|
| Mathematical correctness | Answer-equivalence rate, step validity, constraint satisfaction |
| Diagnostic accuracy | First incorrect step được định vị, misconception label đúng |
| Instructional quality | Hint scaffolding, explanation clarity, không lộ đáp án sớm |
| Product safety | PII leakage, policy violation, latency, cost và refusal handling |

Human review vẫn quan trọng với các claim khó formalize, đặc biệt là ambiguity của wording, diễn giải diagram, context văn hóa và pedagogical tone. Nhưng human review không nên là tuyến phòng thủ duy nhất vì reviewer không thể đọc mọi item ở quy mô lớn. Thiết kế đúng là layered sampling: deterministic check cho mọi item, rule/model critic cho nhiều item, human review theo sample thống kê và toàn bộ high-risk case.

## Production release gate

Hãy coi generated content là release artifact. Mỗi content batch cần mang theo model identifier, prompt version, generator code commit, verifier version, dataset version, curriculum mapping và reviewer status. Thiếu các field này, team không thể tái hiện vì sao item được accept hoặc giải thích vì sao lần chạy sau cho kết quả khác.

Một manifest thực tế có thể như sau:

```yaml
release:
  id: algebra-practice-2026-07-28.1
  generator_model: approved-llm-alias
  generator_prompt_version: 14
  code_sha: 91d8e22
  verifier_version: math-checker-3.4.0
  dataset_version: algebra-golden-2026-07-25
  owner: learning-platform

gates:
  schema_validity: ">= 0.995"
  problem_solvable: "= 1.0"
  answer_equivalence: "= 1.0"
  step_validity: ">= 0.995"
  curriculum_alignment: ">= 0.95"
  high_risk_human_review: "= 1.0"
  pii_leakage: "= 0.0"

rollout:
  mode: shadow_then_canary
  canary_percent: 5
  rollback_on:
    - verifier_disagreement
    - safety_violation
    - quality_regression
```

![Verification-first release loop nối generation, kiểm tra độc lập, review sư phạm, publish, monitoring và quarantine](/blog/llm-math-correctness-edtech/release-loop.webp)

Threshold phải được calibrate bằng benchmark của chính sản phẩm, không copy từ team khác. Với high-stakes assessment hoặc answer key, một item sai có thể là không chấp nhận được dù batch average rất cao. Với draft generation rủi ro thấp, sản phẩm có thể chọn review queue thay vì block mọi candidate.

## CI/CD cho math generation

Content pipeline có thể vận hành giống software release:

```text
Pull request thay đổi prompt, generator, rubric hoặc verifier
        ↓
Schema và static contract checks
        ↓
Golden problem + edge-case suite
        ↓
Independent solver verification
        ↓
Metamorphic và adversarial tests
        ↓
Curriculum và pedagogy evaluation
        ↓
Staging batch với audit metadata đầy đủ
        ↓
Human review cho sample/high-risk item
        ↓
Canary publication
        ↓
Post-release sampling và rollback/quarantine
```

Điểm quan trọng là phải version verifier cẩn thận như generator. Một solver rule mới có thể reject artifact từng được accept; prompt mới có thể sinh content pass checker cũ nhưng fail curriculum rubric mới. Lưu cả hai version với batch và chạy lại representative historical corpus trước khi promote.

Một production incident phải tạo ra regression item. Nếu học sinh báo lời giải phân số được sinh ra là sai, hãy giữ artifact đã redact, xác định claim sai đầu tiên, thêm case vào golden set, sửa prompt hoặc verifier rồi chạy lại release gate. Đừng chỉ sửa một đáp án đang lộ ra. Incident là bằng chứng rằng một test class còn thiếu.

## Khi verifier không thể quyết định

Không phải mọi statement toán đều dễ formalize. Geometry diagram, open-ended proof, modeling assumption, diễn giải graph và word problem tự nhiên có thể vượt quá một symbolic engine hẹp.

Câu trả lời đúng là abstention, không phải confidence theater. Verifier nên trả về `unknown` khi assumption chưa đầy đủ, parse mơ hồ hoặc solver timeout. Product có thể yêu cầu LLM sinh artifact đơn giản hơn, chuyển sang constrained template hoặc route item tới giáo viên. “Chưa chứng minh được sai” không đồng nghĩa với “đã chứng minh đúng”.

Đây cũng là nơi product design quan trọng. Dùng deterministic template cho arithmetic và algebra family có thể kiểm tra đầy đủ. Chỉ dùng free-form generation ở khu vực có review và escalation path. Một surface nhỏ nhưng đáng tin có giá trị hơn một generator bao phủ rộng nhưng âm thầm dạy toán sai.

## Nên đo gì sau khi launch

Theo dõi toàn bộ reliability funnel, không chỉ API latency:

```text
request → parse → solve → step-check → pedagogy-check → review → publish → learner outcome
```

Các metric hữu ích gồm candidate rejection rate theo reason, solver timeout rate, answer-equivalence rate, first-error localization accuracy, hint answer-leak rate, human disagreement rate, post-publication defect rate, cost per accepted item và thời gian từ incident đến regression coverage.

Segment metric theo skill, grade band, language, model, prompt version và generator release. Aggregate score có thể che giấu một subgroup yếu. Ví dụ, hệ thống làm tốt integer arithmetic nhưng thất bại với phân số trong wording tiếng Việt hoặc bài đổi đơn vị.

Sản phẩm cũng nên đo learner behavior. Một hint đúng về toán chưa chắc là hint hữu ích. Kiểm tra học sinh có thử bước tiếp theo không, error lặp có giảm không và correction có làm misconception rõ hơn hay chỉ thay đáp án.

## Lộ trình áp dụng thực tế

Bắt đầu với một problem family hẹp, có semantics dễ formalize: phương trình một bước, word problem số học với unit rõ ràng hoặc distractor trắc nghiệm được sinh từ misconception đã biết. Xây contract, deterministic verifier, adversarial set và release gate trước khi mở rộng domain.

Tiếp theo, thêm step-level feedback và redacted human-review loop. Chỉ sau khi team reproduce và quarantine được failure mới nên mở rộng sang tutoring tự do hơn, geometry, proof hoặc multimodal diagram.

Cách triển khai nên conservative có chủ đích:

1. **Sinh candidate, không sinh final truth.**
2. **Parse thành typed artifact với assumption rõ ràng.**
3. **Tính lại bằng independent solver hoặc exact execution.**
4. **Kiểm tra từng transformation quan trọng, không chỉ con số cuối.**
5. **Chạy adversarial, metamorphic, curriculum và safety test.**
6. **Abstain khi verifier không quyết định được.**
7. **Chỉ publish qua versioned release gate.**
8. **Biến mọi production defect thành regression test.**

Một sản phẩm EdTech tạo được niềm tin không phải khi model nói giống giáo viên, mà khi hệ thống có thể chỉ ra vì sao item được accept, assumption nào đã được kiểm tra, version nào đã tạo ra nó và team sẽ ngăn lỗi tương tự đến với học sinh tiếp theo bằng cách nào.

## Tài liệu tham khảo

[1] Gupta et al., “Beyond Final Answers: Evaluating Large Language Models for Math Tutoring,” arXiv, 2025: <https://arxiv.org/html/2503.16460v1>

[2] Daheim et al., “Stepwise Verification and Remediation of Student Reasoning Errors with Large Language Model Tutors,” EMNLP 2024: <https://aclanthology.org/2024.emnlp-main.478/>

[3] OpenAI, “Structured model outputs,” API documentation: <https://developers.openai.com/api/docs/guides/structured-outputs>

[4] SymPy Documentation, “Solvers”: <https://docs.sympy.org/latest/modules/solvers/solvers.html>

[5] Nikolaj Bjørner, “Programming Z3,” Microsoft Research / Stanford-hosted guide: <https://theory.stanford.edu/~nikolaj/programmingz3.html>

[6] Zhou and Zhang, “Step-Wise Formal Verification for LLM-Based Mathematical Problem Solving,” arXiv, 2025: <https://arxiv.org/html/2505.20869v1>
