---
title: "Zero-Downtime Deployment: Kỹ thuật Canary Release & DB Migration an toàn trên K8s"
description: "Chiến lược thực chiến triển khai hệ thống quy mô lớn không gián đoạn dịch vụ với Kubernetes Canary Deployment và mô hình Expand-Contract Database Migration."
pubDate: 2026-03-16
category: "architecture"
lang: "vi"
translationKey: "zero-downtime-canary-db-migration"
draft: false
image: "/blog/zero-downtime-canary/canary_release_sketch.webp"
---

Mỗi khi hệ thống bước vào giai đoạn nâng cấp lớn, cơn ác mộng lớn nhất của các kỹ sư vận hành (SRE / Backend Engineer) là: **"Liệu lần release này có làm đứt gãy kết nối của khách hàng hay gây mất mát dữ liệu không?"**

Đối với các hệ thống phục vụ hàng triệu người dùng (như dịch vụ viễn thông, dịch vụ công, e-commerce), việc thông báo *“Hệ thống tạm ngưng để bảo trì từ 0h đến 2h sáng”* ngày nay gần như không còn được chấp nhận. Mục tiêu chuẩn mực là **Zero-Downtime Deployment (Triển khai 0-downtime)**.

Bài viết này chia sẻ hai trụ cột cốt lõi để đạt được zero-downtime trên Kubernetes (K8s):
1. **Canary Release Strategy** trên K8s với Traffic Splitting.
2. **Expand-Contract Pattern** để Migration Database an toàn tuyệt đối.

![Phác thảo mô hình Kubernetes Canary Release](/blog/zero-downtime-canary/canary_release_sketch.webp)

---

## 1. Canary Release trên Kubernetes: Điều tiết traffic từng bước

Rolling Update mặc định của Kubernetes rất tiện, nhưng điểm yếu là nó thay thế Pod mới hàng loạt mà chưa biết Pod mới có thực sự ổn định dưới tải thực tế hay không. 

**Canary Release** giải quyết bài toán này bằng cách đẩy chỉ 5% - 10% lượng traffic thực tế sang phiên bản ứng dụng mới ($V_2$). Sau một khoảng thời gian theo dõi (so sánh SLO, error rate, p99 latency), nếu mọi thứ xanh tốt, lượng traffic mới được mở rộng dần lên 50% rồi 100%.

### Cấu hình Ingress / Service Mesh Traffic Splitting

Nếu bạn dùng **Nginx Ingress Controller**, bạn có thể cấu hình Canary vô cùng đơn giản bằng annotation `canary-weight`:

```yaml
# 1. Deployment cho phiên bản Stable (v1)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service-v1
spec:
  replicas: 5
  selector:
    matchLabels:
      app: order-service
      version: v1
  template:
    metadata:
      labels:
        app: order-service
        version: v1
    spec:
      containers:
      - name: app
        image: registry.vndo.vn/order-service:v1.9.0
---
# 2. Ingress chính điều hướng 90% traffic vào v1
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: order-service-main
spec:
  ingressClassName: nginx
  rules:
  - host: api.vndo.vn
    http:
      paths:
      - path: /api/v1/orders
        pathType: Prefix
        backend:
          service:
            name: order-service-v1-svc
            port:
              number: 8080
---
# 3. Ingress Canary gửi 10% traffic vào v2
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: order-service-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"
spec:
  ingressClassName: nginx
  rules:
  - host: api.vndo.vn
    http:
      paths:
      - path: /api/v1/orders
        pathType: Prefix
        backend:
          service:
            name: order-service-v2-svc
            port:
              number: 8080
```

---

## 2. K8s Readiness & Liveness Probes: Người gác cổng không thể thiếu

Dù dùng Canary hay Rolling Update, nếu container khởi động xong mà ứng dụng chưa hoàn tất khởi tạo (chưa sẵn sàng nhận DB connection hay nạp Cache), K8s vẫn có thể dồn traffic vào làm rơi request ($502 / 503$).

![Kỹ thuật cấu hình Probe trong K8s để chặn Traffic hỏng](/blog/zero-downtime-canary/k8s_probes_sketch.webp)

### Quy tắc cấu hình Probe chuẩn Production:

- **Startup Probe**: Cho ứng dụng thời gian khởi động (đặc biệt là JVM/Spring Boot có thể tốn 20-40s). Chặn Liveness probe không ngắt container quá sớm.
- **Readiness Probe**: Kiểm tra ứng dụng có thực sự sẵn sàng nhận request hay chưa (trả về HTTP 200 tại `/healthz/ready`). Nếu rớt Probe này, K8s lập tức rút Pod khỏi Service Endpoint!
- **Graceful Shutdown (`terminationGracePeriodSeconds`)**: Cho phép container hoàn tất các HTTP request đang xử lý trước khi bị dọn dẹp (`SIGTERM` -> `SIGKILL`).

```yaml
readinessProbe:
  httpGet:
    path: /healthz/ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 3
  failureThreshold: 2
livenessProbe:
  httpGet:
    path: /healthz/liveness
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 10
terminationGracePeriodSeconds: 30
```

---

## 3. Thách thức lớn nhất: Database Migration mà KHÔNG Downtime

Deploy ứng dụng Stateless (API backend) rất dễ, nhưng **Stateful (Database)** mới là nơi dễ rớt kết nối nhất. 

Giả sử phiên bản ứng dụng $V_1$ đang dùng bảng `users` với cột `full_name`. Ở $V_2$, bạn quyết định tách thành `first_name` và `last_name`. Nếu bạn chạy script `ALTER TABLE DROP COLUMN full_name` ngay khi vừa deploy $V_2$, các Pod $V_1$ chưa kịp tắt sẽ bị lỗi SQL `Column not found` ngay lập tức!

Để giải quyết, chúng ta sử dụng **Expand-Contract Pattern (hoặc Parallel Change Pattern)** gồm 3 giai đoạn:

![Mô hình Expand-Contract Database Migration 3 giai đoạn](/blog/zero-downtime-canary/db_migration_sketch.webp)

### Giai đoạn 1: Expand (Mở rộng Schema)
- Thêm cột mới `first_name` và `last_name` (allow NULL).
- Chưa xóa cột cũ `full_name`.
- Deploy $V_2$ ứng dụng: Đọc từ `first_name`/`last_name` nếu có, nếu chưa có thì fallback về `full_name`.
- **Ghi dữ liệu (Dual-write)**: Khi có bản ghi mới, ứng dụng ghi song song vào cả cột cũ và cột mới.

### Giai đoạn 2: Backfill (Đồng bộ dữ liệu cũ)
- Chạy một script background để convert dữ liệu cũ từ `full_name` sang `first_name` + `last_name`.
- Vì dữ liệu ghi mới đã có ở cả 2 nơi, bước Backfill này có thể chạy thong thả mà không ảnh hưởng tới kết nối live.

### Giai đoạn 3: Contract (Thu hẹp / Thu dọn)
- Khi 100% traffic đã chuyển sang $V_2$ và toàn bộ dữ liệu cũ đã được Backfill thành công.
- Cập nhật ứng dụng bỏ code đọc/ghi ở cột cũ `full_name`.
- Cuối cùng mới chạy SQL Migration để `DROP COLUMN full_name`.

---

## 4. Tự động hóa Rollback khi gặp chỉ số bất thường (Automated Rollback)

Đừng bắt kíp trực (On-call Engineer) ngồi nhìn dashboard Grafana bằng mắt thường để bấm nút Rollback bằng tay lúc 2h sáng.

Hệ thống nên tự động đo đạc chỉ số Prometheus và kích hoạt Rollback tự động khi vi phạm ngưỡng an toàn (SLA Breach).

![Mô hình Tự động Rollback với Grafana/Prometheus Alerting](/blog/zero-downtime-canary/auto_rollback_sketch.webp)

Khi tích hợp công cụ như **Argo Rollouts** hoặc **Flagger**, bạn có thể khai báo chiến lược phân tích Metric tự động:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
spec:
  metrics:
  - name: success-rate
    interval: 30s
    successCondition: result[0] >= 0.99
    failureLimit: 3
    provider:
      prometheus:
        address: http://prometheus-k8s.monitoring:9090
        query: |
          sum(rate(http_requests_total{status!~"5.*",app="order-service"}[2m]))
          /
          sum(rate(http_requests_total{app="order-service"}[2m]))
```

Nếu tỷ lệ thành công giảm xuống dưới **99%** trong 3 lần kiểm tra liên tiếp, Argo Rollouts sẽ **lập tức hủy bỏ Canary** và kéo 100% traffic trở lại $V_1$ trong vài giây!

---

## Bảng tóm tắt Checklist Zero-Downtime Deployment

| Mục kiểm tra | Trạng thái chuẩn | Thao tác cần tránh |
| :--- | :--- | :--- |
| **API Backward Compatibility** | API mới giữ tương thích với client cũ | Đổi tên field JSON làm vỡ app Mobile/Client |
| **K8s Health Probes** | Khai báo đủ Startup, Readiness, Liveness | Bỏ qua Readiness Probe khiến Pod chưa rảnh đã nhận traffic |
| **DB Migration** | Tuân thủ 3 bước Expand - Backfill - Contract | Chạy `DROP COLUMN` hoặc `RENAME COLUMN` trực tiếp |
| **Graceful Shutdown** | Catch signal `SIGTERM` và chờ drain connection | Kill process ngay tức thì làm đứt request dở dang |
| **Observability** | Cấu hình Alerting theo SLO & Auto Rollback | Release thả nổi không có chỉ số đo đạc |

Zero-downtime deployment không phải là một công nghệ đơn lẻ, mà là sự kết hợp nhuần nhuyễn giữa **Kubernetes Infrastructure**, **Thiết kế API tương thích ngược**, và **Tư duy Migration dữ liệu an toàn**.
