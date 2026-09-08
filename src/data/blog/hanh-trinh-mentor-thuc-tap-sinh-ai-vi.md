---
title: "Mentor một RAG system: những gì production dạy mà tutorial không dạy"
description: "Kiến trúc, sự cố production, và những gì tôi rút ra khi hướng dẫn một thực tập sinh xây chatbot RAG + dashboard trên Cloud — viết cho các kỹ sư khác đọc, không phải để kể lể."
pubDate: 2026-02-06
category: "engineering"
image: "/blog/hanh-trinh-mentor-thuc-tap-sinh-ai/hero.webp"
lang: "vi"
translationKey: "hanh-trinh-mentor-thuc-tap-sinh-ai"
draft: false
---

![Mentor RAG pipeline từ zero đến production](/blog/hanh-trinh-mentor-thuc-tap-sinh-ai/hero.webp)

> **TL;DR** — 8 tuần, 1 thực tập sinh năm cuối, 1 hệ thống RAG + Dashboard được triển khai và chạy thật trên Cloud. Kết quả: 2.639 thủ tục hành chính được index thành 20.916+ vector, độ chính xác retrieval 90,8% trên 308 phiên chat thực tế, latency truy vấn giảm ~70% sau một vòng tối ưu pipeline. Bài viết này không phải retrospective cảm tính — nó là log kỹ thuật của những quyết định đúng, sai, và cách tôi mentor một người mới vào nghề qua từng quyết định đó.

## Bài toán

Đề bài: xây một Trợ lý ảo AI tra cứu thủ tục hành chính công bằng kỹ thuật RAG, đi kèm một Dashboard phân tích hiệu suất xử lý hồ sơ — giao cho một sinh viên năm cuối, trong 8 tuần, triển khai thật trên hạ tầng Cloud chứ không phải demo trên máy cá nhân.

Ràng buộc thực tế khiến bài toán này khác hẳn một side-project: dữ liệu đầu vào là văn bản pháp lý tiếng Việt với cấu trúc hỗn hợp (văn xuôi, bảng biểu, điều khoản), hệ thống phải chạy 24/7 trên Cloud, và người dùng cuối là cán bộ nghiệp vụ — không phải dev, nghĩa là mọi thứ từ UI đến cơ chế cập nhật dữ liệu đều phải "zero-technical-debt cho non-technical user".

## Kiến trúc hệ thống

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────────────┐
│   Next.js    │ HTTP │   FastAPI    │      │        RAG Pipeline      │
│  (Chat + UI) │─────▶│   Backend    │─────▶│  Embed → Retrieve(k=10)  │
└─────────────┘      └──────┬───────┘      │  → Rerank(k=3) → Fallback│
                             │              │  → Gemini 2.5 Flash      │
                             ▼              └─────────────────────────┘
                      ┌──────────────┐
                      │  PostgreSQL   │◀── chat history, api_logs, hồ sơ
                      │  ChromaDB     │◀── 20.916 vector chunks
                      └──────────────┘
```

Hai quyết định kiến trúc đáng nói nhất, vì cả hai đều là bài học cho chính tôi khi review:

**1. Reranker là bước bắt buộc, không phải optional.** Similarity search thuần trên embedding trả về top-10 chunk "gần" về mặt toán học, nhưng không chắc "đúng" về mặt ngữ nghĩa câu hỏi. Thêm cross-encoder reranker (`ms-marco-MiniLM`) để lọc top-10 xuống top-3 là thứ tạo ra khác biệt lớn nhất về chất lượng câu trả lời — lớn hơn cả việc đổi LLM.

**2. Fallback handler là contract, không phải nice-to-have.** Ngưỡng similarity score được set cứng: dưới ngưỡng, hệ thống trả lời "không tìm thấy thông tin" thay vì đẩy context rỗng vào LLM. Không có bước này, hallucination trên một hệ thống hành chính công là rủi ro không thể chấp nhận — sai một câu trả lời về thủ tục pháp lý có hậu quả thật với người dùng thật.

## Vấn đề kỹ thuật khó nhất: chunking không phải bài toán one-size-fits-all

Chunking theo fixed character count — cách phổ biến nhất trong hầu hết tutorial RAG — thất bại ngay lập tức với văn bản hành chính, vì nó cắt ngang bảng "thành phần hồ sơ" hoặc tách rời một điều khoản pháp lý khỏi số hiệu văn bản của nó.

Giải pháp cuối cùng — do thực tập sinh tự nghiên cứu sau khi tôi chỉ nêu vấn đề, không đưa đáp án — là section-based chunking phân luồng theo 3 loại nội dung:

| Loại nội dung | Chiến lược | Kích thước |
|---|---|---|
| Văn xuôi (trình tự thực hiện) | `RecursiveCharacterTextSplitter` | ~350 token, overlap 50 |
| Bảng biểu (hồ sơ, lệ phí) | Serialize thành text, giữ nguyên 1 bảng = 1 chunk | Không giới hạn cứng |
| Điều khoản pháp lý | 1 văn bản = 1 chunk, gắn kèm số hiệu | ~100–150 token |

Mỗi chunk được enrich thêm metadata (`ma_thu_tuc`, `section_type`, `so_van_ban`, `cap_thuc_hien`) — cho phép filter trước khi vector search thay vì search toàn bộ corpus, vừa nhanh hơn vừa giảm nhiễu.

## Khi hệ thống chạm production: log các sự cố thật

![Sự cố production 3h sáng](/blog/hanh-trinh-mentor-thuc-tap-sinh-ai/production-incident.webp)

Đây là phần tôi nghĩ có giá trị nhất cho dev đọc, vì nó không nằm trong sách nào cả:

| Sự cố | Nguyên nhân gốc | Cách xử lý |
|---|---|---|
| Mất toàn bộ vector DB sau restart server | Image ChromaDB đổi default storage path, bind mount trỏ sai | Cấu hình lại volume path tường minh, rebuild index từ nguồn |
| Crawler bị chặn giữa chừng | Request rate quá cao, không có delay + rotate IP | Thêm throttling, kiểm tra `robots.txt` trước khi crawl |
| Lỗi ghi PostgreSQL ngẫu nhiên | NULL character (`\x00`) lẫn trong text crawl được | Sanitize input trước insert, không tin dữ liệu nguồn 100% |
| Kết quả tìm kiếm sai ngữ cảnh (kết hôn trong nước vs. nước ngoài) | Query expansion không đủ specific | Thêm trọng số ưu tiên theo ngữ cảnh, mở rộng câu hỏi có kiểm soát |

Với mỗi sự cố, quy trình mentor của tôi giống nhau: không sửa hộ ngay. Để thực tập sinh tự đọc log, tự đặt giả thuyết, tự verify trước khi tôi xác nhận hướng đi đúng hay sai. Debug độc lập trên production là kỹ năng không có bài tập nào dạy được ngoài chính production.

## Kết quả đo lường được

| Metric | Giá trị |
|---|---|
| Thủ tục hành chính được index | 2.639 (từ 6 bộ ngành) |
| Vector chunks trong ChromaDB | 20.916 |
| Độ chính xác retrieval (thực tế) | 90,8% trên 308 phiên chat |
| Giảm latency sau tối ưu pipeline | ~70% |
| Hồ sơ demo tích hợp Dashboard | 801 |
| Uptime hệ thống | 24/7 trên GCP Compute Engine + Vercel |

Con số quan trọng nhất với tôi không phải 90,8% — mà là **Dashboard Bộ/Ngành cho phép cán bộ nghiệp vụ tự thêm nguồn dữ liệu qua file Excel, không cần đội kỹ thuật can thiệp**. Một hệ số chính xác cao vô nghĩa nếu hệ thống chết ngay khi thực tập sinh rời đi vì không ai vận hành được nó.

## Bài học mentor kỹ thuật, rút gọn còn 4 điều

1. **Đưa constraint, không đưa solution.** "Chunking cho tài liệu hành chính cần tối ưu riêng, em nghiên cứu thêm" tạo ra một giải pháp tốt hơn bất kỳ đáp án nào tôi có thể đưa sẵn.
2. **Để sự cố production tự dạy.** Sửa hộ một lỗi tiết kiệm 20 phút hôm nay, nhưng lấy đi một bài học debug độc lập mà tuần sau sẽ cần lại.
3. **Tách rõ "báo cáo cho trường" và "báo cáo cho doanh nghiệp".** Cấu trúc slide đồ án tốt nghiệp (sơ lược bản thân → kết quả → kỹ năng tích lũy) sai hoàn toàn đối tượng khi trình bày trước lãnh đạo, nơi cần kết luận trước – bằng chứng sau, và bắt buộc phải có slide "đề xuất tiếp theo".
4. **Feedback lặp lại không phải dấu hiệu thất bại — nó là tín hiệu người học đang nghiêm túc.** Cách phản ứng với vòng góp ý thứ 5 quan trọng hơn chất lượng của bản nộp đầu tiên.

## Kết

![Mentor và thực tập sinh hoàn thành hành trình](/blog/hanh-trinh-mentor-thuc-tap-sinh-ai/ending.webp)

Điểm cuối tôi chấm: 8.x/10. Không phải điểm tuyệt đối — vẫn còn latency cần tối ưu thêm, vẫn còn vài chi tiết trình bày cần rà soát. Nhưng tôi tin một đánh giá trung thực, có cả điểm mạnh lẫn điểm cần cải thiện cụ thể, có giá trị hơn nhiều so với một bảng điểm đẹp không phản ánh đúng thực tế.

Nếu có dev nào đang cân nhắc nhận mentor một thực tập sinh: hãy làm, nhưng đừng làm nó thay vì em đó làm. Giá trị lớn nhất không phải sản phẩm cuối cùng chạy được — mà là năng lực tự debug, tự nghiên cứu, và tự phản biện mà người học mang theo sau khi rời đi.
