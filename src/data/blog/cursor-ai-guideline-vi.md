---
title: "Làm Chủ Cursor AI: Quy Trình 3 Lớp, UI Pipeline & Zero Trust Security"
description: "Cẩm nang thực chiến để 'thu phục' Cursor AI bằng mô hình 3 lớp, pipeline UI 3 bước và Zero Trust Security, giúp dev không phải đi dọn rác code AI."
pubDate: 2026-02-26
category: "engineering"
image: "/blog/cursor-ai-guideline/hero.webp"
lang: "vi"
translationKey: "cursor-ai-guideline"
draft: false
---

![Meme Cursor AI: Khi AI sinh rác code và dev phải đi dọn](/blog/cursor-ai-guideline/hero.webp)

> **TL;DR** — Cấp tài khoản Cursor AI cho dev mà không kèm "luật chơi" cũng giống như đưa một chiếc Ferrari cho người chưa có bằng lái: sướng được 5 phút đầu, sau đó là nát bét. Mã AI sinh ra trông có vẻ chạy được, nhưng bên dưới là một bãi rác kiến trúc, logic nghiệp vụ "ảo tưởng" (hallucination), và rủi ro rò rỉ API key nội bộ cực kỳ cao. Bài viết này trình bày một cẩm nang engineering thực chiến: từ chiến lược phân lớp công cụ, quy trình Backend/Frontend song song, cơ chế Zero Trust cho đến hệ thống phân cấp Rules & Skills giúp AI sinh mã chuẩn đét ngay từ cú gõ đầu tiên.

---

## 1. Cạm bẫy "Bánh xèo Code": Khi AI biến Dev thành Kẻ dọn rác

Đã bao giờ bạn rơi vào cảnh này chưa? 

Bạn gõ một prompt dài ngoẵng vào Cursor: *"Hãy viết cho tôi một service quản lý hóa đơn thanh toán hỗ trợ Kafka và Redis cache"*. Cursor nháy mắt vài giây, nhả ra 500 dòng code hoành tráng. Bạn sướng tê người bấm **Accept**. Nhưng 10 phút sau, khi ấn `run`, server nổ tung với 40 lỗi syntax, class import bậy bạ, và luồng trừ tiền trong DB bị bypass sạch sẽ!

![Quy trình song song Cursor vs IDE](/blog/cursor-ai-guideline/dual-window-loop.webp)

### Bản chất vấn đề nằm ở đâu?
Cursor **KHÔNG PHẢI** là một Senior Engineer ngồi trong máy tính của bạn. Bản chất của LLM là một cỗ máy dự đoán từ vựng tiếp theo dựa trên xác suất trên GitHub. Khi bạn hỏi một câu mơ hồ, nó sẽ "chém gió" ra một giải pháp generic nhất — thứ chắc chắn vỡ vụn khi đụng vào hệ thống Microservices phức tạp thực tế.

Mã do AI sinh ra bắt buộc phải trải qua 3 bước sinh tồn: **Review ➔ Tinh chỉnh ➔ Tích hợp logic nghiệp vụ** trước khi dám bấm lệnh `git commit`.

Để định hình lại tư duy cho toàn bộ đội ngũ, chúng tôi thiết lập **Mô hình 3 lớp công cụ (Layered Tooling Strategy)**:

| Lớp công cụ | Công cụ chính | Vai trò | Trách nhiệm chính |
|---|---|---|---|
| **Lớp 1 — AI-Native Dev** | Cursor AI | Công cụ phát triển cốt lõi | Soạn thảo mã nguồn, refactor đa tệp, sinh unit test, tự động hóa tác vụ lặp |
| **Lớp 2 — UI Prototyping** | Lovable, v0.dev, Stitch | Nguồn mẫu thiết kế frontend | Tạo prototype UI nhanh, layout dựng sẵn, component mẫu bằng ngôn ngữ tự nhiên |
| **Lớp 3 — Execution** | IntelliJ, VS, Rider | Thực thi & Xác thực | Chạy build, đính kèm Debugger, theo dõi heap/thread, profiling trước khi deploy |

> 📌 **Nguyên tắc nằm lòng**: Cursor là nơi *viết mã*, IDE truyền thống là nơi *chạy và debug*. Hai cửa sổ này phải luôn mở song song 50/50 trên màn hình của kỹ sư.

---

## 2. Quy trình Backend thực chiến: Vòng lặp song song 3 bước

Rất nhiều dev mới dùng Cursor mắc sai lầm là bắt AI tự mở terminal, tự gõ command build, rồi lại hỏi AI xem tại sao build thất bại. Việc này không chỉ tốn token vô ích mà còn vô cùng chậm.

Cách chuẩn nhất là thiết lập môi trường song song (Dual-window Workflow):

```
┌──────────────────────────────────────┐        ┌──────────────────────────────────────┐
│          CURSOR AI (Viết mã)         │        │    IDE: IntelliJ / VS / Rider        │
├──────────────────────────────────────┤        ├──────────────────────────────────────┤
│ ➔ Soạn thảo toàn bộ mã nguồn         │        │ ➔ Khởi động server & gắn Debugger    │
│ ➔ Sinh Boilerplate (Controller/Repo) │        │ ➔ Theo dõi log runtime, heap/thread  │
│ ➔ Refactor đa tệp qua Agent Mode    │        │ ➔ Chạy test suite, kiểm tra coverage │
│ ➔ Phân tích Stack Trace export được  │ ◄────► │ ➔ Export Stack Trace khi gặp Crash   │
└──────────────────────────────────────┘        └──────────────────────────────────────┘
```

### Vòng lặp 3 bước "thần thánh":

1. **Setup môi trường song song**: Mở IntelliJ/VS/Rider lên, khởi động Server ở chế độ Debug mode. Sau đó mở Cursor đúng thư mục dự án đó. Trong suốt buổi làm việc, IDE truyền thống giữ nguyên trạng thái ứng dụng đang chạy.
2. **Development Loop (Viết & Quan sát)**: 
   - Trên Cursor: Yêu cầu AI sinh Controller, Service hoặc Refactor code.
   - Bấm Save ➔ IDE truyền thống tự động Hot-reload / Rebuild lại app trong 1-2 giây.
   - Quan sát log runtime ngay trên IDE. Nếu ngon lành ➔ Tiếp tục. Nếu lỗi ➔ Sửa tiếp trên Cursor.
3. **Debug nâng cao (Khi gặp bug 3 giờ sáng)**:
   - Khi dính lỗi runtime hoặc bug logic phức tạp: Đừng ngồi tự đoán prompt! Đặt ngay Breakpoint trên IDE, step-through từng dòng để xem giá trị thực tế của biến (`null`, `undefined` hay sai type).
   - Copy nguyên văn đoạn **Stack Trace** bị sập từ Console của IDE, quăng vào cửa sổ chat của Cursor kèm câu lệnh: `"Phân tích root cause của stack trace này và đề xuất patch tối giản nhất"`. AI sẽ tìm ra ngay lập tức dòng code bị hỏng!

---

## 3. Quy trình Frontend: Pipeline 3 bước biến UI Demo thành Code Production

Thảm họa Frontend bằng AI thường chia làm 2 kịch bản:
1. Nâng cấp CSS bằng prompt khiến giao diện vỡ nát trên mobile.
2. Thấy trang Lovable/v0 dựng UI đẹp quá, copy thẳng toàn bộ code HTML/React rác vào dự án, làm nhân bản 50 dòng CSS trùng lặp và vỡ sạch convention dự án.

![Pipeline 3 bước chuyển đổi UI](/blog/cursor-ai-guideline/ui-pipeline.webp)

Để giải quyết triệt để, chúng tôi áp dụng **Pipeline 3 bước chuyển đổi UI**:

### Phần A — Tác vụ nhỏ / Fix bug UI
Viết mã trực tiếp trên Cursor bằng cách đính kèm context (ví dụ: mô tả file component hiện tại + paste đoạn CSS spec hoặc screenshot bug).

### Phần B — Giao diện mới hoàn toàn / Refactor lớn (Pipeline 3 bước)

#### Bước 1: Tạo UI mẫu từ Lovable / v0.dev / Stitch
Dùng ngôn ngữ tự nhiên tả giao diện mong muốn. Đầu ra của bước này chỉ là **Visual Artifact (bản vẽ tham chiếu)** — Tuyệt đối KHÔNG bê thẳng mã nguồn này vào codebase production!

#### Bước 2: Context Extraction (Trích xuất ngữ cảnh kỹ thuật)
Kỹ sư đọc bản mẫu visual và bóc tách thành các thông số chuẩn hóa:
* **Màu sắc, Font, Spacing**: Chuyển thành CSS custom properties hoặc Design Tokens của dự án (Tailwind config, SCSS variables).
* **Phân rã Component**: Thành phần nào tạo mới? Thành phần nào xài lại từ thư viện UI có sẵn (AntD, Shadcn, MUI)?
* **Luồng dữ liệu (State)**: State nào là local trong component? State nào cần đẩy lên Store chung (Redux, Signals, Zustand)?
* **Bố cục (Layout)**: Ghi chú cách dùng Flexbox / Grid để tái tạo đúng layout trong framework thực tế.

#### Bước 3: Chuyển đổi qua Cursor
Mang toàn bộ bộ context kỹ thuật vừa bóc tách ở Bước 2 nạp vào Cursor:
> `"Xây dựng component BillingCard bằng Angular 17 Standalone dựa trên Tailwind config hiện tại. Sử dụng Signals cho local state và inject BillingService để gọi API."`

Kết quả: AI sinh ra đoạn code đúng 100% style, đúng convention và sạch bóng technical debt!

---

## 4. Cấu hình Bảo mật Zero Trust: Đừng để mất cấy vì sướng tay gõ Prompt

Trong môi trường doanh nghiệp (Viễn thông, Tài chính, Y tế, Chính phủ), bảo mật là sinh mệnh. Một kỹ sư vô tình paste đoạn code chứa `JWT_SECRET` hay `DB_PASSWORD` vào prompt AI có thể khiến toàn bộ hệ thống bị tuột quần trên internet.

![Bảo mật Zero Trust trong Cursor AI](/blog/cursor-ai-guideline/zero-trust.webp)

Chúng tôi áp dụng mô hình **Zero Trust Security** khắt khe khi cấu hình Cursor cho toàn bộ máy tính kỹ sư:

```
                          ┌───────────────────────────┐
                          │   CURSOR SECURITY MODEL   │
                          └─────────────┬─────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
   ┌───────────────────┐      ┌───────────────────┐      ┌───────────────────┐
   │   Privacy Mode    │      │    MCP Server     │      │ Secret Management │
   │  BẬT (Bắt buộc)   │      │  Deny All Default │      │   Zero Hardcode   │
   │ Ngăn gửi code cho │      │ Quản lý nghiêm ngặt│      │ Dùng env vars &   │
   │ LLM bên thứ 3     │      │  qua mcp.json     │      │ .cursorignore     │
   └───────────────────┘      └───────────────────┘      └───────────────────┘
```

1. **Privacy Mode = BẬT (Bắt buộc 100%)**: Đảm bảo toàn bộ mã nguồn gửi lên LLM không bị lưu vết (zero-data retention) và không bị dùng để train các mô hình AI thế hệ tiếp theo.
2. **Codebase Indexing = BẬT**: Cho phép Cursor tạo index dự án **cục bộ (Local Indexing)** trên máy tính dev. AI hiểu toàn bộ cấu trúc project nhưng dữ liệu không rời khỏi hạ tầng được kiểm soát.
3. **MCP (Model Context Protocol) Server**: Mặc định **Từ chối tất cả**. Nghiêm cấm dev tự ý cài các MCP Server trôi nổi trên mạng có quyền đọc ghi file system. Chỉ danh sách MCP Server trong file `mcp.json` do Tech Lead review mới được phép hoạt động.
4. **Quản lý Secrets**: **Nghiêm cấm tuyệt đối** việc hardcode API key, Password, Secret Key trong code hoặc prompt. Mọi file cấu hình nhạy cảm (`.env`, `credentials.json`, `keystore`) bắt buộc phải được đưa vào danh sách `.cursorignore`.

---

## 5. Chuẩn hóa Tài liệu Kiến trúc Microservices (*.md)

Khi dự án phình to lên hàng chục microservices, việc thiếu tài liệu khiến các dev tốn hàng giờ đồng hồ chỉ để hỏi nhau: *"Endpoint này truyền cái gì?", "Service này chạy local kiểu gì?"*.

Chúng tôi biến Cursor thành một máy tự động viết docs chuẩn xác bằng các prompt chuẩn:

```
┌─────────────────┬──────────────────────────────────┬───────────────────────────────────────────┐
│ File Tài Liệu   │ Nội dung bắt buộc                │ Prompt Cursor mẫu                         │
├─────────────────┼──────────────────────────────────┼───────────────────────────────────────────┤
│ README.md       │ Cách chạy local, envvars, stack  │ "Đọc toàn bộ project và tạo README.md"    │
│ API.md          │ List REST endpoints, req/res     │ "Liệt kê REST endpoints kèm HTTP status"  │
│ ARCHITECTURE.md │ Dataflow, Message Queue, DB      │ "Mô tả kiến trúc nội bộ & dependencies"   │
└─────────────────┴──────────────────────────────────┴───────────────────────────────────────────┘
```

---

## 6. Quản trị Tri thức qua Skills & Rules 2 Cấp

Để AI không "múa rìu qua mắt thợ" hay viết code lệch chuẩn dự án, bạn cần đưa cho nó một cuốn "Luật rừng". Chúng tôi quản trị tri thức AI bằng 2 vũ khí: **Skills** và **Cursor Rules**.

### 6.1. Quản lý Skills (`.cursor/skills/`)
Skills là các file `*.md` chứa tri thức chuyên biệt theo domain hoặc tech stack.

```
.cursor/
└── skills/
    ├── enterprise/             # [Phòng Quản lý — Chỉ đọc]
    │   ├── security-forbidden.md
    │   └── code-conventions.md
    ├── team/                   # [Tech Lead quản lý — Theo dự án]
    │   ├── billing-rules.md
    │   ├── kafka-schema.md
    │   └── springboot-conventions.md
    └── personal/               # [Từng kỹ sư — Không commit lên repo]
        └── my-shortcuts.md
```

* **Cách dùng**: Kéo thả file `*.md` vào cửa sổ chat Cursor khi cần xử lý nghiệp vụ liên quan, hoặc gọi `@file` trực tiếp trong `.cursorrules` để nạp tự động khi mở project.

### 6.2. Hệ thống Cursor Rules 2 Cấp (`.cursorrules` & `.mdc`)

File `.cursorrules` chính là **Hiến pháp** ép AI phải tuân thủ nghiêm ngặt mọi quy chuẩn lập trình của dự án.

#### Cấp 1: Enterprise Rules (`~/.cursor/rules/enterprise.mdc`)
Áp dụng cho toàn bộ kỹ sư trong công ty, không ai được phép ghi đè:

```markdown
# TTKDGP Enterprise Rules – Phòng DLS
## Ngôn ngữ & Giao tiếp
- Luôn phản hồi bằng tiếng Việt trong comment và giải thích.
- Tên biến, hàm, class dùng tiếng Anh theo camelCase / PascalCase.
- Commit message theo chuẩn Conventional Commits (feat/fix/refactor...).

## Bảo mật — NGHIÊM CẤM tuyệt đối
- KHÔNG hardcode API key, password, token, secret trong bất kỳ file nào.
- KHÔNG tự ý viết luồng xác thực, phân quyền, mã hóa — báo Senior.
- KHÔNG log thông tin nhạy cảm (số điện thoại, CMND, dữ liệu khách hàng).

## Chất lượng mã
- Mỗi hàm không quá 50 dòng. Tách nhỏ nếu vượt.
- Luôn thêm Javadoc / Docstring cho public method.
- Không dùng magic number — khai báo constant có tên rõ nghĩa.
```

#### Cấp 2: Team Rules (`.cursor/rules/*.mdc`)
Được Tech Lead thiết lập riêng cho từng tech stack của dự án (Spring Boot, Angular, React...):

```markdown
# Team Rules — Backend Java/Spring Boot
- Dùng Repository Pattern. Không gọi DB trực tiếp từ Controller hay Service.
- Exception handling tập trung qua @ControllerAdvice — không try/catch lẻ tẻ.
- Response luôn bọc trong ApiResponse<T> wrapper chuẩn của team.

# Team Rules — Frontend Angular
- KHÔNG dùng React, JSX, Vue. Chỉ Angular + TypeScript + HTML template.
- State management: RxJS BehaviorSubject hoặc Angular Signals (Angular 17+).
- Lazy loading bắt buộc cho mọi feature module.
- Standalone component theo Angular 17+ convention.
```

---

## Tóm lại

Dùng Cursor AI cũng giống như việc bạn quản lý một người thực tập sinh cực kỳ thông minh nhưng thiếu kinh nghiệm thực tế. Nếu bạn thả rông, người đó sẽ quậy nát codebase của bạn. Nhưng nếu bạn đưa ra quy trình 3 lớp rõ ràng, xiết chặt bảo mật Zero Trust và thiết lập bộ Rules 2 cấp vững chắc — bạn sẽ sở hữu một "siêu trợ lý" giúp tăng tốc độ sản xuất phần mềm lên gấp nhiều lần.

Hãy nhớ: **AI sinh code, nhưng lập trình viên mới là người chịu trách nhiệm cho từng dòng code được push lên Production!**
