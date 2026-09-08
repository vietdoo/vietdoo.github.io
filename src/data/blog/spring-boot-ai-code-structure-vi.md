---
title: "Kiến trúc mã nguồn Spring Boot tối ưu token"
description: "Hướng dẫn tổ chức mã nguồn giúp AI hiểu nhanh, sinh đúng, và giảm chi phí token trong vòng đời phát triển sản phẩm với Java 21 và Spring Boot 3.x."
pubDate: 2026-03-06
category: "architecture"
image: "/blog/spring-boot-ai-code-structure/springboot-ai-cover.webp"
lang: "vi"
translationKey: "spring-boot-ai-code-structure"
draft: false
---

![Kiến trúc mã nguồn Java Spring Boot AI SDLC](/blog/spring-boot-ai-code-structure/springboot-ai-cover.webp)

* **Đối tượng**: Developer & Tech Lead
* **Tech Stack**: Java 21 · Spring Boot 3.x

---

## PHẦN 01 · BỐI CẢNH

### VẤN ĐỀ: Token là chi phí mới của vòng đời phát triển

Mã nguồn truyền thống buộc AI phải đọc quá nhiều file để hiểu một thay đổi nhỏ.

* **Context Window**: Mỗi prompt có giới hạn. File rải rác = nhiều file phải nạp = ít chỗ cho suy luận.
* **Chi phí lặp lại**: AI sinh sai → lặp lại prompt → token nhân đôi. Cấu trúc rõ ràng giảm vòng lặp này.
* **Độ chính xác**: Khi context loãng, AI suy đoán nhiều hơn. Cấu trúc tốt = output đáng tin hơn.
* **Onboarding AI**: AI mới mỗi phiên. Codebase phải tự mô tả để không cần giải thích lại mỗi lần.

---

### TRIẾT LÝ: AI-First Code Organization

Tổ chức mã nguồn sao cho AI chỉ cần đọc một vùng nhỏ, đúng chỗ, là có thể sửa đúng.

> **LOCALITY**: Mọi thứ liên quan đến một tính năng nằm cạnh nhau.

1. **01 Self-describing**: Tên file, package, lớp tự nói chức năng — không cần ngữ cảnh ngoài.
2. **02 Bounded context**: Mỗi tính năng có ranh giới rõ; AI biết chính xác phải đọc gì.
3. **03 Stable contracts**: Cổng giao tiếp ổn định; thay đổi nội bộ không lan ra ngoài.

---

## PHẦN 02 · NGUYÊN TẮC

### 06 NGUYÊN TẮC CỐT LÕI

Quy tắc tổ chức mã nguồn cho AI. Áp dụng đồng thời. Mỗi nguyên tắc giảm số token cần để AI hiểu một tác vụ.

1. **Feature-based, không Layer-based**: Gom theo nghiệp vụ, không gom theo loại file.
2. **Một file một trách nhiệm**: File ngắn, tên rõ — AI có thể đọc trọn vẹn.
3. **Public API tường minh**: Một file `api/` mô tả mọi thứ ngoài có thể gọi.
4. **Collocation triệt để**: DTO, mapper, exception, test ở cạnh logic dùng nó.
5. **Tài liệu cạnh code**: README ngắn trong mỗi feature làm cọc neo ngữ cảnh.
6. **Quy ước trên cấu hình**: Đặt tên dự đoán được; bỏ wiring thủ công khi có thể.

---

### MÔ HÌNH 01: Vertical Slice — Gom theo tính năng

Mỗi tính năng là một lát cắt dọc tự đủ: `controller` → `service` → `repository` → `DTO` → `test`.

#### FIG. 02 — Feature slice (`features/billing/`)
* `BillingController`
* `BillingService`
* `BillingRepository`
* `Invoice`, `Payment` (DTO + Entity)
* `BillingMapper` · `BillingException`
* `BillingServiceTest`

#### VÌ SAO TIẾT KIỆM TOKEN?
* AI chỉ cần nạp một thư mục để hiểu trọn nghiệp vụ.
* Không phải lùng tìm DTO ở `dto/`, exception ở `exception/`.
* Đổi logic trong một feature không kéo file ngoài vào prompt.
* Test ngay cạnh code → AI sinh test bám sát hành vi hiện tại.

> *"Đọc một thư mục — sửa được một tính năng."*

---

### SO SÁNH: Layered (Truyền thống) vs Feature-based

![So sánh Layered Architecture truyền thống vs Feature-based AI-Friendly](/blog/spring-boot-ai-code-structure/layered-vs-feature.webp)

Cùng một thay đổi nghiệp vụ — số file AI phải nạp khác hẳn nhau.

| Cấu trúc Layered (Truyền thống) | Cấu trúc Feature-based (AI-Friendly) |
| :--- | :--- |
| **`src/`**<br>• `controller/` ← 1 file ở đây<br>• `service/` ← 1 file ở đây<br>• `repository/` ← 1 file ở đây<br>• `dto/` ← 2 file ở đây<br>• `mapper/` ← 1 file ở đây<br>• `exception/` ← 1 file ở đây | **`features/billing/`**<br>• `BillingController.java`<br>• `BillingService.java`<br>• `BillingRepository.java`<br>• `dto/` `Invoice.java`, `Payment.java`<br>• `BillingMapper.java`<br>• `BillingException.java` |
| ⚠️ **Token để hiểu 1 feature**: ~ 7 file rải 6 thư mục | ✅ **Token để hiểu 1 feature**: 1 thư mục duy nhất |

---

## PHẦN 03 · CẤU TRÚC

### CẤU TRÚC THƯ MỤC ĐỀ XUẤT: Spring Boot project layout

Ba vùng rõ ràng: `app` (khởi động), `features` (nghiệp vụ), `shared` (dùng chung).

```text
FIG. 03 — src/main/java/com/company/app

app/
  Application.java           · main + @SpringBootApplication
  config/                    · 1 file cho mỗi mối quan tâm
features/
  billing/                   · 1 bounded context = 1 thư mục
    api/                     · public DTO + cổng nội bộ
    web/                     · Controller, request/response
    domain/                  · Service, Entity, business rules
    data/                    · Repository, JPA mappings
    BillingModule.java       · public Spring config
  auth/                      · ...
shared/
  error/ result/ time/       · code-free từ nghiệp vụ
```

#### QUY ƯỚC ĐẶT TÊN
* 1 thư mục feature = 1 từ danh từ nghiệp vụ.
* Suffix bắt buộc: `Controller`, `Service`, `Repository`.
* Module class export bean public ra ngoài.
* `shared/` chỉ chứa utility không biết về nghiệp vụ.

> 💡 **MẸO PROMPT**:  
> *"Sửa logic trong `features/billing/domain` — không động vào `api/`."*

---

### QUY ƯỚC ĐẶT TÊN: Tên là tài liệu rẻ nhất cho AI

Mỗi tên là một gợi ý ngữ nghĩa giúp AI tìm đúng file mà không cần đọc nội dung.

| FILE / CLASS | Ý NGHĨA | METHOD | Ý NGHĨA |
| :--- | :--- | :--- | :--- |
| `InvoiceController` | Endpoint HTTP cho hóa đơn | `createInvoice(...)` | Hành động + danh từ chính |
| `InvoiceService` | Use-case logic | `findInvoiceById(...)` | Có prefix `find` / `get` / `list` |
| `InvoiceRepository` | Truy cập dữ liệu | `assertPaid(...)` | Kiểm tra invariant nghiệp vụ |
| `InvoiceCreateRequest` | DTO input cụ thể | `toResponse(...)` | Mapper rõ chiều dữ liệu |
| `InvoiceMapper` | Chuyển Entity ↔ DTO | `onPaymentReceived(...)` | Event handler có prefix `on` |

---

### GRANULARITY: Một file — một việc

File nhỏ nạp vào prompt rẻ hơn; file lớn buộc AI bỏ qua hoặc đọc lướt.

* **≤ 200 dòng/file**: Vừa một context cục bộ; tránh chia quá nhỏ thành file rác.
* **≤ 7 method/class**: Class có > 7 method là dấu hiệu cần tách trách nhiệm.
* **1 lý do thay đổi**: SRP nguyên gốc: một file đổi vì một lý do nghiệp vụ.
* **0 phụ thuộc ngoài feature**: Logic feature không gọi trực tiếp feature khác — qua `api/`.

---

## PHẦN 04 · TÀI LIỆU

### CONTEXT ANCHORS: Tài liệu sống cạnh mã nguồn

Vài file Markdown ngắn — AI đọc một lần, hiểu cả module mà không cần lùng repo.

```text
FIG. 04 — features/billing/

README.md              · 1 đoạn mô tả mục đích + danh sách use-case.
ARCHITECTURE.md        · Sơ đồ luồng dữ liệu, ranh giới với feature khác.
DECISIONS.md           · ADR ngắn — vì sao chọn cách này.
api/package-info.java  · Mô tả public contract bằng Javadoc.
CHANGELOG.md           · Lịch sử thay đổi public API.
```

#### VAI TRÒ CỦA TỪNG FILE
* `README.md` là cọc neo: tóm 5 dòng cho AI prime nhanh ngữ cảnh.
* `ARCHITECTURE.md` giữ sơ đồ ASCII — AI đọc được không cần ảnh.
* `DECISIONS.md` ngăn AI gợi ý lại phương án đã bị bác bỏ.
* Javadoc trên `api/` trở thành hợp đồng AI buộc phải tôn trọng.

---

### BOUNDARY CONTRACT: Module có cổng vào duy nhất

Code ngoài chỉ thấy `api/` — phần còn lại là hộp đen với cả developer và AI.

![Module Boundary Contract Architecture Diagram](/blog/spring-boot-ai-code-structure/module-boundary-contract.webp)

```text
OrderModule ──> billing/api ──> [ billing (internal) ]
                                ├── domain/
                                ├── data/
                                ├── web/
                                └── mapper/
```

> **AI chỉ cần đọc `api/` để gọi đúng — không phải nạp 20 file nội bộ.**

#### QUY TẮC CỔNG
* Chỉ interface + DTO bất biến nằm trong `api/`.
* Không leak Entity JPA ra ngoài feature.
* Cross-feature gọi qua Module bean, không inject Service nội bộ.
* ArchUnit test bảo vệ ranh giới.

---

## PHẦN 05 · CODE PATTERNS

### PATTERNS: Mẹo cấu trúc tiết kiệm token

Áp dụng tại từng class — giúp AI ít token mà vẫn sinh đúng.

* **Self-contained DTO**: Request/Response định nghĩa cạnh Controller (`record`). AI thấy I/O ngay tại endpoint.
* **Result type rõ ràng**: Trả về `Result<T,Error>` hoặc `sealed class` — AI biết toàn bộ kết cục có thể.
* **Static factory**: `Invoice.draft(...)`, `Invoice.finalize(...)` — đặt tên use-case, không cần đọc constructor.
* **Annotation tối thiểu**: Dùng `@RestController`, `@Transactional` ở mức cao nhất; tránh stack 5 annotation/method.
* **Inline test data builder**: Builder ở cuối test file — AI sinh test mới không phải lùng `fixtures/`.
* **Comment 'WHY', không 'WHAT'**: Code đã nói WHAT. Comment chỉ ghi quyết định nghiệp vụ AI không suy ra được.

---

### ANTI-PATTERNS: Những thứ buộc AI đốt token vô ích

Mỗi anti-pattern dưới đây kéo theo nhiều file phải nạp vào context.

| ANTI-PATTERN | VÌ SAO TỐN TOKEN? |
| :--- | :--- |
| **God Service** | Service hơn 1000 dòng — AI luôn phải nạp full file để sửa một dòng. |
| **DTO toàn cục** | Thư mục `dto/` chứa 200 record dùng chéo — AI không biết cái nào hợp. |
| **Util chung mù mờ** | `StringUtils`, `CommonUtils` — AI đoán method và sinh trùng lặp. |
| **Reflection / magic** | Logic phụ thuộc tên field runtime — AI không suy được hành vi. |
| **Cấu hình XML rải rác** | Wiring tách rời class — AI phải đọc nhiều nơi mới hiểu bean. |
| **Vòng phụ thuộc giữa feature** | Phải nạp đệ quy nhiều module — context bùng nổ. |

---

## PHẦN 06 · VẬN HÀNH

### WORKFLOW: Quy trình prompting trên cấu trúc mới

Tận dụng feature folder để giảm token ở mọi bước.

![Workflow 5 bước prompting giảm token cho AI](/blog/spring-boot-ai-code-structure/ai-prompting-workflow.webp)

1. **Locate**: Chỉ feature folder cần đổi — không paste cả repo.
2. **Anchor**: Đính kèm `README.md` + `ARCHITECTURE.md` của feature đó.
3. **Constrain**: Liệt kê `api/` và `shared/` được phép dùng. Cấm vùng khác.
4. **Generate**: Yêu cầu output theo file path tuyệt đối trong feature.
5. **Verify**: Chạy ArchUnit + test cạnh code. AI sửa loop trong cùng folder.

> 🚀 **KẾT QUẢ THƯỜNG THẤY**: Giảm **40–70% token** mỗi prompt khi cấu trúc đã chuẩn hoá.

---

### CHECKLIST · KẾT LUẬN: Rà soát và Áp dụng

Mười bước cụ thể để đưa codebase Spring Boot vào trạng thái AI-friendly:

- [ ] **1.** Tách project hiện tại theo feature folder.
- [ ] **2.** Thêm `api/` cho từng feature, ẩn nội bộ.
- [ ] **3.** Viết `README.md` ≤ 10 dòng/feature.
- [ ] **4.** Đặt ArchUnit kiểm tra ranh giới.
- [ ] **5.** Chuẩn hoá suffix `Controller`/`Service`/`Repository`.
- [ ] **6.** Gom DTO theo feature, xoá `dto/` chung.
- [ ] **7.** Thay util chung bằng helper feature-local.
- [ ] **8.** Bổ sung `ARCHITECTURE.md` với sơ đồ ASCII.
- [ ] **9.** Cập nhật prompt template để chỉ trỏ feature.
- [ ] **10.** Đo token trung bình mỗi PR — đặt mục tiêu giảm.

> ### *"Cấu trúc tốt là prompt tốt nhất."*
