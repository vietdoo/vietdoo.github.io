---
title: "Triển khai AI On-Prem dưới 100 GB VRAM: Production Playbook cho Doanh nghiệp"
description: "Cách doanh nghiệp lựa chọn, quantize, serve và vận hành các mô hình ngôn ngữ nhỏ–trung trong giới hạn khoảng 100 GB VRAM mà không nhầm kích thước model với năng lực production."
pubDate: 2026-05-12
category: "engineering"
lang: "vi"
translationKey: "onprem-ai-100gb-vram-enterprise"
draft: false
image: "/blog/onprem-ai-100gb/hero.webp"
---

Hầu hết đề xuất AI on-premise đều bắt đầu bằng tên model. Có người hỏi doanh nghiệp có thể chạy model 32B, 70B hay một mô hình mixture-of-experts hay không, rồi cuộc thảo luận lập tức biến thành danh sách GPU cần mua.

Đó là câu hỏi sai ở bước đầu tiên.

Câu hỏi đầu tiên phải là hệ thống cần làm gì, phải phục vụ bao nhiêu request đồng thời, prompt dài đến đâu, người dùng chấp nhận độ trễ nào và cần bằng chứng gì trước khi một câu trả lời được xem là kết quả nghiệp vụ hợp lệ. Chỉ sau khi các ràng buộc đó rõ ràng, team mới nên quyết định một model nhỏ, model trung hay model lớn đã quantize có phù hợp với server hay không.

![Một AI stack on-prem production đặt model nhỏ và trung, routing, memory budget, security control và workload doanh nghiệp trong giới hạn VRAM cố định](/blog/onprem-ai-100gb/hero.webp)

> **Luận điểm chính:** khoảng 100 GB VRAM tổng không phải lời hứa rằng doanh nghiệp có thể chạy model 100 tỷ tham số. Đó là một capacity envelope phải được chia cho weight, runtime buffer, KV cache, concurrency và operational headroom. Production thành công nhờ sizing theo workload, không phải nhồi đầy mọi byte bằng trọng số model.

Phân biệt này rất quan trọng vì một model load được vẫn có thể không dùng được. Nó có thể không còn chỗ cho context window thực tế, xếp hàng request chỉ vì một prompt dài, OOM khi graph capture hoặc trả lời đủ tốt nhưng quá chậm khi nhiều phòng ban cùng sử dụng. Hướng dẫn triển khai của vLLM cũng tách rõ trường hợp model vừa một GPU, tensor parallelism trên nhiều GPU trong một node và việc kết hợp tensor/pipeline parallelism khi cần nhiều node.[1](https://docs.vllm.ai/en/stable/serving/parallelism_scaling/) Đây là quyết định về serving, không chỉ là thủ thuật để load model.

## Bắt đầu từ workload, không phải số parameter

Workload doanh nghiệp là một phân phối, không phải một câu trung bình. Một classifier cho help desk có thể nhận hàng nghìn request ngắn, trong khi trợ lý hợp đồng chỉ nhận ít request nhưng mỗi request có tài liệu và evidence dài. Coding agent có thể sinh một patch ngắn nhưng phải gọi tool và chạy verification nhiều lần. Trợ lý tri thức nội bộ nhìn có vẻ rẻ cho đến khi retrieval bổ sung một lượng context lớn vào mọi prompt.

Trước khi chọn model, hãy ghi lại năm con số cho từng workload: request mỗi phút, số request đồng thời, phân phối input token, phân phối output token và latency target. Thêm con số thứ sáu về quality: thế nào là accepted, rejected hoặc escalated?

| Workload | Vai trò model phù hợp | Áp lực capacity chính | Quality gate |
|---|---|---|---|
| Classification và extraction | Model nhỏ, nhanh | Concurrency và thời gian trong queue | Schema validity, field-level accuracy, abstention rate |
| Q&A nội bộ có retrieval | Model nhỏ hoặc trung | Retrieved context và KV cache | Độ phủ citation, groundedness, từ chối khi thiếu evidence |
| Soạn thảo tài liệu | Model trung | Output token và prompt dài | Human acceptance, thuật ngữ, tuân thủ policy |
| Coding và tool use | Model trung hoặc lớn | Context nhiều lượt và tool schema | Test, static check, review acceptance |
| Decision support nhạy cảm | Model trung kèm verifier | Evidence, auditability, escalation | Policy check và human approval |

Một capacity contract hữu ích không phải là “chạy model X.” Nó gần với: “phục vụ 40 request extraction ngắn đồng thời, p95 time-to-first-token dưới hai giây, cho phép input tối đa 8.192 token, output tối đa 512 token và abstain khi confidence hoặc evidence không đủ.” Contract như vậy có thể kiểm thử. Chỉ một tên model thì không.

## 100 GB thực sự có nghĩa gì?

Cụm “100 GB VRAM” thường mô tả tổng memory vật lý trên nhiều GPU. Nó không nói rằng toàn bộ số đó dành cho weight. Một phần memory bị dùng cho inference runtime, temporary allocation, CUDA graph, communication buffer, allocator fragmentation và KV cache lưu attention state của các request đang hoạt động.

Công thức planning thực tế có thể viết như sau:

```text
serving memory có thể sử dụng
= VRAM vật lý
  - runtime và framework reserve
  - communication và temporary buffer
  - safety headroom

memory dành cho weight và KV cache
= serving memory có thể sử dụng
```

Để chọn model sơ bộ, weight memory xấp xỉ bằng số parameter nhân với số byte mỗi weight. FP16 hoặc BF16 gần hai byte mỗi parameter, INT8 gần một byte và INT4 gần nửa byte trước khi tính scale, metadata, padding và runtime overhead. Tài liệu Hugging Face mô tả quantization là lưu weight ở precision thấp hơn để giảm memory requirement trong khi cố gắng giữ nhiều accuracy nhất có thể, đồng thời nhấn mạnh mỗi phương pháp có trade-off và yêu cầu phần cứng khác nhau.[2](https://huggingface.co/docs/transformers/quantization/overview)

Phép tính này hữu ích để loại bỏ các kế hoạch bất khả thi. Nó chưa đủ chính xác để phê duyệt một capacity target production.

![Một VRAM budget tách model weight, KV cache, runtime buffer, communication overhead và safety headroom thay vì coi toàn bộ GPU memory là capacity cho model](/blog/onprem-ai-100gb/vram-budget.webp)

| Nhóm model | Raw weight size xấp xỉ | Vai trò khả thi trong envelope 100 GB | Rủi ro chính |
|---|---:|---|---|
| 7–8B ở BF16/FP16 | 14–18 GB | Classification, extraction, routing và Q&A ngắn với volume cao | Quality có thể chưa đủ cho tool use phức tạp |
| 14–15B ở BF16/FP16 | 28–34 GB | General assistant nội bộ hoặc structured generation | Context dài và concurrency ăn phần budget còn lại |
| 24B ở INT4 | 14–18 GB trước runtime overhead | Model trung mạnh trên một GPU 48 GB-class | Phải đo quality quantization và context budget |
| 30–32B ở INT4 | 18–24 GB trước runtime overhead | Reasoning, coding hoặc document workflow mức trung | KV cache và output dài có thể trở thành bottleneck |
| 70B ở INT4 | 40–50 GB trước runtime overhead | Tier chuyên biệt chất lượng cao với multi-GPU serving | Tensor parallelism, concurrency thấp hơn và interconnect trở thành yếu tố chính |

Bảng trên cố ý chỉ mang tính xấp xỉ. Nó chưa bao gồm KV cache, vốn tăng theo số sequence đang hoạt động, context length, số layer và attention dimension. vLLM báo capacity của KV cache và ước tính maximum concurrency theo sequence length đã cấu hình; vì vậy `max-model-len` là một capacity control, không chỉ là công tắc bật tính năng context dài.[1](https://docs.vllm.ai/en/stable/serving/parallelism_scaling/)

Do đó, team cần reserve memory trước khi chọn mức quantization. Nhồi weight vào một card 48 GB đến 47,9 GB có thể trông rất hiệu quả trong model summary tĩnh nhưng sẽ thất bại ngay khi server nhận request dài thứ hai.

## Hiểu đúng các phương án phần cứng

Có nhiều cách tiếp cận envelope khoảng 100 GB. Một cặp GPU 48 GB-class cho data center hoặc workstation cho tổng VRAM danh nghĩa 96 GB. Hai NVIDIA L40S là ví dụ tự nhiên: NVIDIA liệt kê L40S có công suất tối đa 350 W và công bố các con số hiệu năng FP32, FP16 Tensor Core và FP8 Tensor Core trên trang sản phẩm.[3](https://www.nvidia.com/en-us/data-center/l40s/) Điểm quan trọng không phải FLOPS được quảng cáo, mà là hai card có thể trở thành hai serving slot độc lập hoặc một pool tensor-parallel, tùy workload.

H100 SXM có 80 GB memory và băng thông 3,35 TB/s, trong khi H100 NVL được liệt kê ở mức 94 GB và 3,9 TB/s.[4](https://www.nvidia.com/en-us/data-center/h100/) Một GPU lớn có thể đơn giản hơn về vận hành khi model vừa một card, nhưng nó không tự động đem lại nhiều capacity tổng hơn, redundancy hay concurrency hơn. Thiết kế một card cũng tạo ra failure domain lớn hơn.

| Topology | Memory danh nghĩa | Phù hợp nhất | Không giải quyết được |
|---|---:|---|---|
| 2 × GPU 48 GB-class | 96 GB | Hai tier độc lập hoặc một replica tensor-parallel | Memory không tự động được pool; communication giữa GPU có thể giới hạn latency |
| 1 × H100 SXM | 80 GB | Serving một model với latency thấp và memory bandwidth cao | Không có redundancy cấp GPU và ít memory hơn 96 GB |
| 1 × H100 NVL | 94 GB | Mục tiêu memory lớn trên một GPU enterprise | Vẫn là một logical serving slot nếu application không multiplex workload |
| 4 × GPU 24 GB | 96 GB | Tận dụng inventory workstation hoặc lab có sẵn | Fragmentation, communication và headroom trên từng GPU kém thoải mái hơn |

Phương án hai GPU đặc biệt hữu ích khi doanh nghiệp có hai nhóm workload khác nhau. Một GPU có thể chạy model nhỏ luôn sẵn sàng cho classification, extraction, routing và fallback. GPU còn lại chạy model quantized 14B, 24B hoặc 32B cho tác vụ generation khó hơn. Router chỉ chuyển request thực sự cần model lớn sang tier thứ hai, còn admission control ngăn context dài làm nghẽn các tác vụ vận hành ngắn.

Cách này thường bền vững hơn chạy một model 70B duy nhất trên cả hai GPU cho mọi request. Tensor parallelism giúp model vừa memory, nhưng đồng thời ghép sức khỏe, scheduler và latency của hai thiết bị thành một hệ thống. Chỉ dùng khi yêu cầu quality biện minh cho sự ghép nối đó, không phải vì con số tổng memory trông hấp dẫn.

## Chọn model ladder, không chọn một model duy nhất

Triển khai AI on-premise cho doanh nghiệp nên có một model ladder và promotion rule rõ ràng. Model nhỏ không phải phiên bản rẻ tiền của model lớn; nó là một service có contract khác.

Tier đầu tiên hợp lý là model instruct 7B–8B ở BF16, FP16 hoặc định dạng 8-bit đã được validate kỹ. Nó xử lý classification, extraction, routing, tóm tắt ngắn và structured transformation. Giá trị của nó là latency dễ đoán và concurrency cao. Nếu workload chủ yếu bị giới hạn bởi schema, một model nhỏ kèm validation tốt có thể vượt model lớn thường xuyên phải retry vì output khó parse.

Tier thứ hai là model 14B–32B. Model card của Qwen3-14B ghi nhận đây là model 14,8B parameter, native context 32.768 token và đã validate khả năng mở rộng đến 131.072 token bằng YaRN; model card cũng xác định license Apache-2.0 và các hướng triển khai qua vLLM, SGLang và llama.cpp.[5](https://huggingface.co/Qwen/Qwen3-14B) Mistral Small 3.1 24B là một đại diện khác cho nhóm model trung; model card xác định license Apache-2.0 và khuyến nghị vLLM cho serving.[6](https://huggingface.co/mistralai/Mistral-Small-3.1-24B-Instruct-2503)

Đây là tier mà đa số doanh nghiệp nên bắt đầu. Nó đem lại bước nhảy quality đáng kể mà chưa bắt mọi request đi qua multi-GPU model parallelism. Chỉ quantize xuống INT4 hoặc INT8 sau khi đo các task quan trọng. Model ít bit nhưng mất thuật ngữ công ty, kỷ luật tool call hoặc hành vi từ chối sẽ không rẻ hơn nếu nó làm tăng human review và retry.

Tier thứ ba là model lớn hơn đã quantize, chẳng hạn model 70B-class, chỉ dành cho request khó. Model 70B INT4 có thể vừa hai GPU 48 GB-class trên giấy tờ, nhưng contract vận hành chặt hơn.

![Model ladder chuyển workload volume cao đến model nhỏ, tác vụ khó đến model trung quantized và request ngoại lệ đến tier chuyên biệt multi-GPU](/blog/onprem-ai-100gb/model-ladder.webp)

Context dài, nhiều sequence đồng thời và communication tensor-parallel có thể nhanh chóng ăn hết margin. Hãy coi tier này là exception path, không phải endpoint mặc định cho mọi nhân viên.

## Quantization là quyết định về quality

Quantization phải được chọn theo workload và kiểm chứng bằng evaluation. FP16 hoặc BF16 là baseline đơn giản nhất khi model vừa memory. Nó thường cho hành vi số học dễ đoán nhất nhưng dùng khoảng gấp đôi weight memory so với INT8 và gấp bốn so với INT4 trước overhead.

INT8 có thể là điểm cân bằng hữu ích khi model gần vừa một card hoặc cần thêm chỗ cho KV cache. INT4 giúp model 24B hoặc 32B khả thi trên GPU 48 GB-class, nhưng tác động quality không đồng đều. Tool selection, output đa ngôn ngữ, code generation, retrieval context dài, arithmetic và refusal behavior có thể suy giảm theo các cách khác nhau.

AWQ và GPTQ là các hướng weight quantization có calibration. Bitsandbytes cung cấp đường đi dễ tiếp cận cho việc load 8-bit và 4-bit trong các stack tương thích. FP8 có thể hấp dẫn trên phần cứng và engine hỗ trợ tốt. Không nhãn nào trong số này thay thế được benchmark với đúng model, tokenizer, prompt và serving engine mục tiêu.

Hãy xây một acceptance suite nhỏ trước khi quantize:

| Nhóm test | Đo lường | Tín hiệu thất bại |
|---|---|---|
| Structured extraction | Exact-match field và JSON validity | Nhiều repair loop hoặc schema invalid hơn |
| Retrieval Q&A | Citation coverage và grounded answer rate | Câu trả lời trôi chảy nhưng không có evidence |
| Tool use | Chọn đúng tool và argument hợp lệ | Chọn nhầm tool, thiếu field hoặc argument không an toàn |
| Coding | Test pass và review acceptance | Regression hoặc correction thủ công tăng |
| Safety và policy | Hành vi refusal và escalation | Over-compliance, leakage hoặc giấu uncertainty |
| Language quality | Thuật ngữ và nhất quán song ngữ | Thuật ngữ bị dịch hoặc normalize sai |

Giữ một reference path full-precision hoặc precision cao hơn để so sánh. Mục tiêu không phải “model quantized nghe có vẻ giống.” Mục tiêu là “model quantized đạt acceptance threshold của workload và đồng thời cải thiện memory headroom hoặc throughput.”

## KV cache là biến capacity bị che khuất

Weight là tĩnh. KV cache là động. Mỗi sequence đang hoạt động lưu attention state, và lượng memory tăng khi prompt hoặc output dài hơn. Một server nhìn rất thoải mái với một request ngắn có thể mất ổn định khi pipeline retrieval thêm 10.000 token hoặc coding agent giữ lại lịch sử tool dài trong context.

Hãy đặt context limit theo workload thay vì mở maximum context của model cho mọi caller. Request context dài nên có budget, queue hoặc model tier riêng. Model card Qwen3 phân biệt native context với context mở rộng bằng YaRN, nhắc chúng ta rằng context dài cần cấu hình và validation riêng.[5](https://huggingface.co/Qwen/Qwen3-14B)

Theo dõi đồng thời bốn tín hiệu: GPU memory utilization, KV-cache utilization, active sequence và queue wait. GPU memory tăng mà active sequence không tăng có thể là fragmentation hoặc temporary buffer. Queue wait tăng trong khi memory ổn định có thể là scheduler limit. OOM sau prompt dài không được giải quyết bằng cách tăng request timeout.

Admission policy thực tế khá đơn giản. Từ chối hoặc downgrade request vượt context budget, reserve capacity cho short high-priority work, giới hạn maximum output token và chuyển tài liệu dài sang workflow bất đồng bộ. Policy phải trả về lý do hữu ích thay vì generic 500 error.

## Serving topology cho envelope hai GPU

Một topology production có thể nhỏ nhưng không đơn giản:

```text
ứng dụng doanh nghiệp
        |
identity, policy, audit gateway
        |
request classifier + model router
        |-------------------------------|
small-model pool                 medium-model pool
classification, extraction       14B–32B quantized
routing, fallback                vLLM hoặc SGLang
        |                               |
validation + safety checks ---- shared observability
        |
accepted outcome / abstention / human escalation
```

Chạy một serving process trên mỗi GPU khi model vừa độc lập. Dùng tensor parallelism khi một model cần nhiều memory hơn một card và benchmark communication path. vLLM mô tả tensor parallelism cho multi-GPU trong một node và pipeline parallelism khi model vượt khả năng một node.[1](https://docs.vllm.ai/en/stable/serving/parallelism_scaling/)

Dùng internal API tương thích OpenAI để application không bị khóa chặt vào serving engine. Model card Qwen3 chỉ ra vLLM, SGLang và llama.cpp là các lựa chọn local hoặc deployment.[5](https://huggingface.co/Qwen/Qwen3-14B) Lựa chọn cuối cùng nên dựa trên model architecture được hỗ trợ, batching behavior, observability, quantization path và mức quen thuộc của team vận hành.

Đừng để router che mất evidence cần thiết để vận hành hệ thống. Propagate model ID, quantization format, prompt/output token count, queue time, time to first token, inter-token latency, finish reason, safety decision và outcome ID. Các bài model-router và SLO hiện có của folio là tài liệu liên quan: routing chọn đường đi, còn serving contract chứng minh đường đi có khỏe hay không.

## Enterprise control phải có ngay từ release đầu

On-premise không tự động đồng nghĩa với an toàn. Một GPU server vẫn có thể làm lộ data qua log, model cache, package download, shell access, debug endpoint hoặc nhóm administrator quá rộng.

Release đầu tiên cần định nghĩa outbound network policy, artifact provenance, model-license review, secrets boundary, audit retention và patch process. Pin container và model version. Ghi lại chính xác quantization artifact và calibration set. Nếu có thể, tách hạ tầng download model khỏi runtime serving. Không log raw prompt mặc định; dùng trace đã redact và replay có kiểm soát access cho incident.

Multi-tenancy cần nhiều hơn một tenant header. Enforce tenant identity ở gateway, áp dụng concurrency/token budget theo tenant, cô lập retrieval index và bảo đảm output model chịu cùng authorization rule với source data. Model riêng tư không biến một câu trả lời không được cấp quyền thành câu trả lời hợp lệ.

Availability cũng thay đổi khi chạy on-premise. Team sở hữu GPU failure, driver compatibility, disk pressure, temperature, power limit, firmware và việc khôi phục model artifact. Nếu chỉ có một server, hãy mô tả failure mode trung thực. Một warm standby CPU path, model fallback nhỏ hơn hoặc degraded mode có kiểm soát có thể hữu ích hơn việc giả vờ một box duy nhất đã là high availability.

## Benchmark hệ thống mà bạn thực sự sẽ vận hành

Con số tokens-per-second trong môi trường rỗng không phải capacity plan. Hãy xây benchmark matrix từ production trace đã loại dữ liệu nhạy cảm. Bao gồm prompt ngắn và dài, hội thoại một và nhiều lượt, tool schema, retrieval payload, structured output và cancellation.

![Một on-prem AI rollout đi từ workload trace đã ẩn danh qua benchmark gate, shadow traffic, production rollout có kiểm soát, fallback và human review](/blog/onprem-ai-100gb/benchmark-rollout.webp)

Đo time to first token, inter-token latency, end-to-end latency, throughput, queue wait, peak VRAM, KV-cache occupancy, error rate, OOM rate và quality acceptance. Chạy ở nhiều mức concurrency. Lặp lại sau khi thay đổi quantization, context cap, batch limit và model routing.

| Giai đoạn benchmark | Câu hỏi được trả lời | Quyết định release |
|---|---|---|
| Correctness baseline | Model có đạt task contract trước optimization không? | Loại model fail quality hoặc policy gate |
| Memory fit | Model load được với headroom và context target không? | Loại config cần memory setting khẩn cấp |
| Saturation test | Từ concurrency nào p95 latency và queue wait không chấp nhận được? | Đặt concurrency và admission limit |
| Failure test | OOM, timeout, GPU loss hoặc output invalid sẽ xử lý thế nào? | Bắt buộc fallback, retry hoặc abstention |
| Replay test | Model optimized có giữ outcome đại diện không? | Phê duyệt quantization và routing change |
| Soak test | Service có ổn định nhiều giờ hoặc nhiều ngày không? | Phê duyệt rollout production |

Một report tốt phải kết thúc bằng quyết định. Ví dụ: “Tier 24B INT4 đạt p95 TTFT dưới bốn giây ở tám request đồng thời với context tối đa 8k; tier 32B dành cho document job bất đồng bộ; tier 70B không được admit vì p95 queue time của tensor-parallel vi phạm interactive SLO.” Kết luận như vậy có giá trị hơn một chart tuyên bố 120 token mỗi giây trong server rỗng.

## Rollout plan phù hợp với thực tế doanh nghiệp

Bắt đầu bằng một workload có acceptance criteria đo được và có lý do rõ ràng để đặt dữ liệu on-premise. Freeze model artifact, tokenizer, engine version, quantization format, prompt template và evaluation set. Deploy sau internal gateway có authentication, per-tenant limit, observability đã redact và kill switch.

Chạy shadow traffic trước khi chuyển response đến người dùng. So sánh model on-premise với path hiện tại về quality, latency, cost và failure recovery. Chỉ promote các workload slice vượt gate. Giữ model nhỏ làm fallback nhưng đừng âm thầm downgrade tác vụ rủi ro cao; khi fallback không đạt contract, trả về trạng thái escalation hoặc human review rõ ràng.

Sau khi launch, review capacity theo workload chứ không chỉ theo GPU utilization. GPU ở mức 70% vẫn có thể queue latency không chấp nhận được, trong khi utilization thấp có thể là trạng thái khỏe nếu hệ thống giữ burst reserve lớn. Trước khi mua thêm hardware, xem lại context cap và routing rule. Nhiều team phát hiện vấn đề capacity thật sự nằm ở prompt phình to, retrieval trùng lặp hoặc tool history không giới hạn.

## Khung ra quyết định

Với đa số doanh nghiệp có khoảng 100 GB VRAM tổng, thiết kế đầu tiên mạnh nhất không phải “một local model khổng lồ.” Đó là platform hai tier: model nhỏ cho volume và control, model trung đã quantize cho tác vụ nhạy cảm về quality. Khi có thể, giữ một GPU cho small tier, đặt tier 14B–32B trên card còn lại và chỉ dùng multi-GPU serving cho request mà quality requirement biện minh cho sự ghép nối vận hành.

Chỉ chọn model quantized lớn hơn sau khi benchmark chứng minh tier trung không đạt task contract. Nếu model phải trải trên nhiều GPU, đặt concurrency budget riêng và queue riêng. Coi long context là tài nguyên khan hiếm. Đo outcome, không chỉ token. Giữ reference path precision cao hơn để evaluation. Hệ thống on-premise tốt nhất không phải hệ thống load được model lớn nhất, mà là hệ thống tạo ra business work được chấp nhận một cách ổn định trong ranh giới dữ liệu, latency và capacity của doanh nghiệp.

## References

[1] [vLLM — Parallelism and Scaling](https://docs.vllm.ai/en/stable/serving/parallelism_scaling/)

[2] [Hugging Face Transformers — Quantization Overview](https://huggingface.co/docs/transformers/quantization/overview)

[3] [NVIDIA — L40S GPU for AI and Graphics Performance](https://www.nvidia.com/en-us/data-center/l40s/)

[4] [NVIDIA — H100 GPU](https://www.nvidia.com/en-us/data-center/h100/)

[5] [Qwen — Qwen3-14B Model Card](https://huggingface.co/Qwen/Qwen3-14B)

[6] [Mistral AI — Mistral Small 3.1 24B Instruct Model Card](https://huggingface.co/mistralai/Mistral-Small-3.1-24B-Instruct-2503)

[7] [vLLM — Quantized KV Cache](https://docs.vllm.ai/en/latest/features/quantization/quantized_kvcache/)

[8] [NVIDIA — TensorRT-LLM Overview](https://nvidia.github.io/TensorRT-LLM/overview.html)

## Đọc thêm

- [Model Router cho AI Agent: Chọn Model theo Capability, Cost và Latency](/blog/model-router-ai-agent)
- [AI Agent SLO: Đo Success, Latency, Cost và Safety](/blog/ai-agent-slo-success-latency-cost-safety)
- [AI Agent FinOps: Phân bổ Token Cost theo Tenant, Workflow và Outcome](/blog/ai-agent-finops-token-cost-allocation)
- [LLM Code Sandbox trên Kubernetes: Isolation, Resource Limit và Safe Execution](/blog/llm-code-sandbox-kubernetes)
