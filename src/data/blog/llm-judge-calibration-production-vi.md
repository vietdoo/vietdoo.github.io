---
title: "Hiệu chỉnh LLM-as-a-Judge trong Production: Human Agreement, Drift và ranh giới Needs Review"
description: "Playbook production để hiệu chỉnh LLM judge với nhãn của con người, phát hiện bias và drift có hệ thống, đồng thời quyết định khi nào evaluator phải abstain thay vì tự đưa ra quyết định release."
pubDate: 2026-09-06
category: "engineering"
image: "/blog/llm-judge-calibration/hero.png"
lang: "vi"
translationKey: "llm-judge-calibration-production"
draft: false
---

Một support agent được release với dashboard màu xanh. Điểm chất lượng nằm trên ngưỡng, latency vẫn trong SLO, và judge đánh dấu gần như mọi trace được lấy mẫu là “pass”. Hai ngày sau, reviewer phát hiện agent thường bỏ qua bước verification bắt buộc mỗi khi người dùng viết câu hỏi lịch sự và chi tiết.

Judge không hỏng theo cách dễ nhận ra. Nó trả về JSON hợp lệ, tuân thủ rubric, thậm chí còn khớp với nhãn trung bình của con người đủ nhiều để trông có vẻ khỏe mạnh. Vấn đề là lỗi của nó có cấu trúc: nó thưởng cho câu trả lời dài, thích một vị trí trong pairwise comparison, và gần như không bao giờ dùng nhãn không chắc chắn. Một điểm trung bình duy nhất đã che mất failure.

**LLM judge không phải oracle. Nó là một production component có error rate, bias profile, bề mặt drift, owner và đường escalates sang con người.** Calibration là quá trình đo những đặc tính đó so với quyết định mà judge thực sự phải điều khiển.

Điều này quan trọng vì một judge có thể đủ tốt cho việc này nhưng không an toàn cho việc khác. Model xếp hạng tốt mười bản tóm tắt chưa chắc là release gate tốt cho support agent liên quan đến thanh toán. Judge ổn định trên golden set tháng trước có thể drift sau khi provider đổi model mặc định. Score có ích cho monitoring có thể quá nhiễu để routing tự động.

## Câu trả lời ngắn

Nếu LLM judge điều khiển một quyết định production, đừng validate nó bằng vài prompt example và một con số agreement trung bình. Hãy xây một reference set nhỏ nhưng đại diện, được gắn nhãn bởi con người; giữ một holdout set bất biến; đo agreement theo từng failure class; kiểm tra các bias đã biết; theo dõi abstention và độ ổn định qua các lần chạy; đồng thời định nghĩa ranh giới **needs-review** cho những trường hợp evidence thiếu hoặc judge không chắc chắn.

Vòng lặp thực tế là:

1. Xác định chính xác quyết định judge phải đưa ra.
2. Tạo human labels bằng rubric rõ ràng và quy trình adjudication.
3. So sánh judge với con người trên holdout set đã phân tầng.
4. Chẩn đoán lỗi có hệ thống, không chỉ nhìn mean score.
5. Đặt threshold cho phép abstain.
6. Kiểm tra lại calibration sau mỗi thay đổi về model, prompt, rubric hoặc traffic.

## Calibration khác validation và monitoring thế nào?

Ba khái niệm này thường bị trộn lẫn:

| Lớp | Câu hỏi chính | Evidence điển hình |
|---|---|---|
| **Validation** | Judge có khớp với reference đáng tin trên một sample xác định không? | Human labels, holdout set, confusion matrix |
| **Calibration** | Score và threshold của judge có mang ý nghĩa đúng với quyết định không? | Agreement theo class, threshold curve, abstention, bias analysis |
| **Monitoring** | Judge còn hoạt động như component đã được calibrate khi chạy production không? | Cohort trend, drift signal, spot check, change event |

Validation cho biết judge có thể làm task trong một evaluation setup. Calibration nối kết performance đó với một hành động vận hành. Monitoring kiểm tra các giả định có còn đúng khi traffic, model, policy và người dùng thay đổi hay không.

Một team có thể sở hữu judge đã validate nhưng chưa calibrate cho gate. Ví dụ judge đạt human agreement trung bình 86% trên thang điểm năm bậc. Nếu release policy block mọi score dưới 3, câu hỏi quan trọng không phải là mean. Câu hỏi là: **bao nhiêu trace thực sự không an toàn vẫn bị judge đánh dấu từ 3 trở lên?** False-negative rate này mới là rủi ro mà gate tạo ra.

## Bắt đầu từ quyết định, không phải prompt

Trước khi viết prompt cho judge, hãy viết decision contract. Judge chỉ trả về `score: 0.83` thì chưa có trách nhiệm rõ ràng. Một contract tốt phải nêu input, output, consumer, cost của từng loại lỗi và evidence bắt buộc.

Với một support agent giả lập, contract có thể là:

```json
{
  "decision": "release_gate",
  "unit": "completed_agent_trace",
  "labels": ["safe_pass", "quality_fail", "policy_fail", "needs_review"],
  "critical_failures": ["missing_verification", "unauthorized_disclosure"],
  "minimum_evidence": ["user_request", "retrieved_sources", "tool_trace", "final_answer"],
  "abstain_when": ["missing_trace_evidence", "conflicting_policy", "judge_confidence_below_threshold"]
}
```

Contract này ngăn một failure mode phổ biến: yêu cầu judge tự suy luận một tiêu chí ẩn từ câu “hãy chấm helpfulness từ một đến năm”. Helpful với ai? Câu trả lời có được phép thực hiện action đó không? Agent đã gọi đúng tool chưa? Nó có làm lộ dữ liệu của tenant khác không? Đây là những dimension khác nhau, cần evidence khác nhau.

Dùng deterministic check cho fact deterministic. Code có thể kiểm tra required tool đã được gọi, schema có hợp lệ không, permission check trả về allow hay không, latency có vượt budget không. LLM judge nên xử lý câu hỏi semantic cần diễn giải, chẳng hạn câu trả lời đã thực sự giải quyết intent chưa hoặc phần giải thích có mâu thuẫn với evidence không.

## Xây human reference set như một thiết bị đo

Human label không tự động trở thành ground truth. Đó là một quy trình đo và cũng cần được thiết kế.

### Lấy mẫu những case quan trọng

Random sample hữu ích để ước lượng case phổ biến, nhưng có thể bỏ sót hành vi rủi ro hiếm. Hãy tạo **stratified reference set** theo những chiều làm thay đổi quyết định:

- intent và product area;
- model và prompt version;
- ngôn ngữ, tone và độ dài;
- tool-use path và số bước;
- policy hoặc risk class;
- case dễ, borderline và failure đã biết;
- traffic cohort và loại tenant.

Cố ý đưa vào hard negative. Nếu mọi calibration example đều sạch, judge có thể trông chính xác trong khi thất bại đúng ở nơi hệ thống cần nó nhất.

### Tách calibration set khỏi holdout set

Dùng một set để chỉnh rubric, anchor và threshold. Giữ một set khác bất biến cho đến khi quyết định hoàn tất. Dùng lại cùng example để tune judge rồi báo cáo chất lượng sẽ biến calibration thành overfitting.

Holdout cần được version như software fixture. Ghi lại dataset identity, label policy, annotator instruction, judge model, judge prompt, tool-trace schema và thời điểm evaluation. Nếu rubric đổi, tạo version mới thay vì âm thầm sửa lịch sử.

### Đo human–human agreement trước

Nếu hai reviewer có kinh nghiệm thường xuyên bất đồng, judge không thể được kỳ vọng khớp với một đáp án hoàn hảo tưởng tượng. Đo human–human ceiling và chỉ adjudicate các case mà policy yêu cầu nhãn cuối cùng. Nhờ vậy disagreement hiện ra thay vì bị nén thành một giá trị “ground truth”.

Với nhãn categorical, hãy xem confusion matrix thay vì chỉ nhìn raw agreement. Với score ordinal, có thể dùng weighted agreement hoặc rank correlation. Cohen’s kappa hữu ích nhưng cũng có thể trông thấp bất ngờ khi một class chiếm đa số. Metric là công cụ chẩn đoán, không phải huy hiệu.

## Judge cần một output contract ổn định

Ưu tiên một nhóm nhãn nhỏ, quan sát được, thay vì precision giả tạo. Rubric như sau dễ audit hơn:

| Label | Ý nghĩa | Hành động tự động |
|---|---|---|
| `safe_pass` | Đạt contract và evidence đủ hỗ trợ quyết định | Tiếp tục hoặc đưa vào release sample |
| `quality_fail` | Câu trả lời thiếu hoặc sai ở mức đáng kể | Block sample và tạo failure record |
| `policy_fail` | Agent vi phạm rule về safety, privacy hoặc authority | Block và escalate ngay |
| `needs_review` | Evidence thiếu, mâu thuẫn hoặc nằm ngoài rubric | Chuyển cho người; không auto-promote |

Hãy yêu cầu evidence reference, không yêu cầu hidden chain-of-thought. Judge có thể trả về trace event ID, rubric criterion và lý do ngắn gọn hỗ trợ label. Đừng biến private reasoning text thành dependency vận hành.

Schema hữu ích có thể là:

```json
{
  "label": "needs_review",
  "dimension_results": [
    {"dimension": "required_verification", "result": "unknown", "evidence": ["tool-17"]}
  ],
  "confidence_band": "low",
  "missing_evidence": ["policy-version"],
  "rubric_version": "support-v4"
}
```

Điểm quan trọng không phải số lượng field. Reviewer phải hiểu vì sao judge abstain và evidence nào có thể giải quyết case.

## Chẩn đoán bias có hệ thống, không chỉ average accuracy

LLM judge có thể thất bại theo những cách mà aggregate metric che mất. Trong một evaluation, judge trông chính xác vì phần lớn sample dễ, trong khi nó thất bại có hệ thống ở một cohort quan trọng.

![Ma trận bias phơi bày các ô mismatch theo dimension evaluation trước khi judge âm thầm điều khiển quyết định production](/blog/llm-judge-calibration/bias-matrix.png)

### Position và order bias

Trong pairwise comparison, việc đổi vị trí câu trả lời có thể làm verdict đổi theo. Hãy randomize answer order trong calibration và đo flip rate. Nếu chỉ đổi vị trí mà answer được chọn đổi, judge chưa đo quality một cách độc lập.

### Bias với độ dài và phong cách

Câu trả lời dài có thể trông thoughtful hơn nhưng không đúng hơn. Tạo các cặp có cùng fact, một bản ngắn và một bản dài. Kiểm tra format, heading, confidence language và sự lịch sự tách khỏi substantive correctness.

### Self-preference và model-family effect

Judge có thể thích câu trả lời do model cùng họ tạo ra hoặc thích một style quen thuộc. Nếu có thể, đừng cho judge biết provider identity. So sánh label giữa các model family và đừng coi agreement với style của judge là correctness.

### Bias theo domain và ngôn ngữ

Judge được calibrate trên English customer support có thể hành xử khác trên tiếng Việt, code-mixed, legal hoặc technical request. Theo dõi agreement theo language và domain. Nếu cohort có quá ít human label, đó là lý do để abstain hoặc lấy thêm sample, không phải lý do để mặc định parity.

### Bias do evidence và trace

Judge có thể thưởng cho final answer bóng bẩy dù agent bỏ qua required tool. Hãy đưa đúng evidence cần thiết: user request, retrieved source, tool event, authorization result và final answer. Ngược lại, đừng đưa field không liên quan khiến judge có thể shortcut hoặc nhìn thấy label.

## Đặt ranh giới needs-review

Tính năng calibration quan trọng nhất thường bị bỏ quên là judge phải được phép nói **“Tôi không có đủ evidence.”**

Binary pass/fail ép uncertainty vào một class đầy tự tin. Điều này nguy hiểm khi false pass có cost cao. Định nghĩa rõ điều kiện abstain:

- required trace event bị thiếu;
- hai policy source mâu thuẫn;
- case nằm ngoài calibration distribution;
- score nằm sát threshold;
- repeated run cho kết quả khác nhau;
- bias slice đã biết được lấy mẫu quá ít;
- judge không thể trích evidence cho critical criterion.

Hãy xem `needs_review` là một state được kiểm soát, không phải lỗi của hệ thống. Đo rate, review latency và outcome sau review. Judge abstain trên 4% case high-risk có thể khỏe mạnh hơn judge tự tin label 100% và che giấu uncertainty.

Threshold phải khớp với decision. Release gate có thể tối ưu precision cao cho `safe_pass` và chấp nhận nhiều review hơn. Incident monitor có thể ưu tiên recall cho policy failure. Routing cần ranking ổn định thay vì categorical truth. Không có một “good score” áp dụng cho mọi nơi.

![Judge đã hiệu chỉnh chia trace vào các nhánh release, monitoring và human review dựa trên evidence và threshold](/blog/llm-judge-calibration/decision-gates.png)

## Dùng judge đúng với khả năng của nó

Mỗi consumer cần một calibration objective khác nhau:

| Use case | Tối ưu cho | Mặc định an toàn |
|---|---|---|
| Release gate | False-negative rate thấp với critical failure | Block hoặc review nếu evidence chưa đủ |
| Regression monitoring | Phát hiện trend ổn định | Giữ canary set có người kiểm tra |
| Model routing | Ranking hữu ích và tie dễ đoán | Ưu tiên abstain thay vì chọn đại |
| Data curation | Chọn positive sample chất lượng cao | Lấy mẫu disagreement để human review |
| Incident triage | Ưu tiên xử lý nhanh | Không coi judge priority là severity truth |

Bảng này cũng giải thích vì sao copy một judge threshold vào mọi dashboard là sai. Cùng một score có thể dẫn tới hành động khác nhau tùy error budget và mức độ nghiêm trọng khi dự đoán sai.

## Vòng lặp calibration trong production

Calibration phải là một quy trình vận hành lặp lại, không phải notebook chạy một lần.

1. **Tạo canary set.** Giữ một set nhỏ, bất biến, đại diện cho case bình thường và adversarial.
2. **Chạy sau mỗi thay đổi quan trọng.** Trigger khi judge model, provider, prompt, rubric, tool schema, policy, retrieval system hoặc answer model thay đổi.
3. **Lấy mẫu production trace.** Phân tầng theo risk, language, model và outcome; không chỉ lấy trace mà judge đã đánh dấu khỏe mạnh.
4. **Thu human correction.** Cho một sample được gắn nhãn độc lập và adjudicate disagreement.
5. **So sánh theo cohort.** Báo cáo confusion matrix, critical-failure recall, abstention, repeated-run stability và human–judge agreement.
6. **Xác định thứ đã đổi.** Shift có thể do judge drift, traffic drift, application regression, policy change hoặc evidence bị thiếu.
7. **Cập nhật có chủ đích.** Version hóa rubric và threshold, chạy lại holdout, ghi lại quyết định phê duyệt.

Mỗi thay đổi nên có change receipt ghi judge model, prompt, rubric, dataset version, metric, reviewer và effective date. Không có record này, incident sau đó sẽ không phân biệt được model change với label-policy change.

## Cần test gì trước khi tin judge?

Một pre-production suite thực tế nên có:

- cặp câu trả lời khác vị trí;
- bản ngắn và bản dài nhưng cùng fact;
- câu đúng nhưng style yếu và câu bóng bẩy nhưng sai fact;
- trace thiếu tool hoặc gọi tool trái quyền;
- retrieval evidence mâu thuẫn;
- input đa ngôn ngữ và code-mixed;
- nhiều lần chạy cùng một input;
- score borderline quanh mọi automated threshold;
- trace không đầy đủ và evidence malformed;
- prompt injection nằm trong retrieved content;
- judge timeout, failure và provider fallback.

Kết quả mong muốn không phải mọi test đều pass. Kết quả mong muốn là mỗi failure đã biết đều có policy rõ: reject bằng code, judge abstain, human review hoặc residual risk được chấp nhận.

## Các lỗi phổ biến

**Chỉ dùng một con số agreement trung bình.** Average che khuất critical class và cohort failure.

**Để judge tự định nghĩa ground truth.** Human label cần một quy trình độc lập, dù judge có thể giúp ưu tiên sample.

**Coi confidence là calibration.** Field confidence của model không chứng minh xác suất của nó khớp thực tế.

**Xóa nhãn uncertain.** Forced decision biến evidence thiếu thành certainty giả.

**Đổi rubric nhưng không version.** Score lịch sử trở nên không thể diễn giải.

**Đưa mọi semantic check vào LLM.** Dùng code cho schema, permission, tool call và timing; dùng judge ở nơi interpretation thực sự thêm giá trị.

**Chỉ calibrate case dễ.** Hard negative và rare-risk slice mới là nơi release policy được quyết định.

## Kết luận

Một production LLM judge nên được vận hành như service, không phải được ngưỡng mộ như một prompt thông minh. Nó cần decision contract, human-labeled reference set, frozen holdout, output schema ổn định, bias test, drift detection, needs-review boundary và owner có quyền approve hoặc rollback thay đổi.

Mục tiêu không phải làm judge khớp với con người 100% thời gian. Mục tiêu là biết **nó khớp ở đâu, sai ở đâu, mỗi lỗi tốn bao nhiêu, và khi nào nó nên dừng việc giả vờ là mình biết**. Đó là cách biến một automated score thành engineering evidence có thể bảo vệ được.

## FAQ

### LLM-as-a-Judge có đủ đáng tin để dùng production không?

Có thể dùng cho quyết định production nếu judge được calibrate với human label đại diện, được kiểm tra theo cohort và được phép abstain. Không nên coi nó là oracle hoặc thay thế cho deterministic policy và schema check.

### Cần bao nhiêu human label để calibrate một LLM judge?

Không có con số chung cho mọi hệ thống. Hãy bắt đầu với set đủ để bao phủ intent, ngôn ngữ, risk class và failure đã biết; sau đó dùng uncertainty và disagreement để quyết định lấy thêm ở đâu. Một set nhỏ nhưng đại diện có giá trị hơn set lớn nhưng đồng nhất.

### LLM judge nên trả về score hay label?

Dùng label cho decision và chỉ dùng score khi scale có diễn giải rõ. Luôn có trạng thái `needs_review` hoặc abstention khi evidence có thể thiếu hoặc false pass gây rủi ro cao.

### Phát hiện LLM judge drift bằng cách nào?

Chạy immutable canary set sau mỗi thay đổi quan trọng, lấy mẫu production trace độc lập với kết quả của judge, rồi so sánh agreement, critical-failure recall, abstention và confusion matrix theo cohort theo thời gian. Theo dõi judge model, prompt, rubric, provider và application change cùng với metric.

### LLM judge có thay thế được human review không?

Nó có thể giảm lượng review thường lệ nhưng không nên thay thế con người ở case mơ hồ, high-impact hoặc ít được đại diện trong dữ liệu. Hệ thống calibrate tốt dùng judge để tự động hóa case rõ ràng và route uncertainty kèm evidence.

## Sources

1. [G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment](https://arxiv.org/abs/2303.16634)
2. [Position Bias in Large Language Model-Based Evaluators](https://aclanthology.org/2025.findings-ijcnlp.72/)
3. [LangSmith evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts)
4. [OpenAI Evals](https://github.com/openai/evals)
5. [Arize: LLM-as-a-Judge](https://arize.com/llm-as-a-judge/)
