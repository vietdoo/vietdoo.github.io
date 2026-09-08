---
title: "Schema Evolution trong Event-Driven System: Compatibility, Rollback và Data Contract"
description: "Playbook production để thay đổi event schema mà không làm hỏng consumer cũ, không mắc kẹt khi replay và không nhầm registry compatibility với một release an toàn."
pubDate: 2026-06-29
category: "architecture"
lang: "vi"
translationKey: "schema-evolution-event-driven-compatibility-rollback"
draft: false
image: "/blog/schema-evolution/hero.webp"
---

Event schema nhìn giống một chi tiết serialization cho tới khi hệ thống thật sự phải thay đổi nó. Khi đó schema trở thành một public API được dùng chung bởi producer, consumer, dashboard, replay job, data warehouse và incident tool, trong khi những thành phần này có thể thuộc các team hoàn toàn khác nhau.

Phần khó của Schema Evolution không phải thêm một field vào JSON object. Phần khó là điều phối consumer cũ, producer mới, event được replay, ownership và rollback trong khi message vẫn tiếp tục chạy qua hệ thống.

![Một event stream đi qua các version gate trong khi consumer cũ và mới vẫn hoạt động theo một contract rõ ràng](/blog/schema-evolution/hero.webp)

<figure class="blog-video">
  <video controls preload="metadata" playsinline poster="/blog/schema-evolution/hero.webp" aria-label="Video giải thích nội dung bài viết, phiên bản tiếng Việt">
    <source src="/blog/schema-evolution-event-driven-compatibility-rollback/video-vi.mp4" type="video/mp4" />
    Trình duyệt của bạn không hỗ trợ video HTML5.
  </video>
  <figcaption>Video giải thích chuyên sâu: phiên bản tiếng Việt.</figcaption>
</figure>

Nguyên tắc tôi thường dùng là: **compatibility là kỷ luật release, không phải một setting trong registry**. Registry có thể từ chối schema rõ ràng incompatible, nhưng không biết mọi consumer có hiểu meaning của field mới hay rollback có tạo ra business behavior đúng hay không.

## Event là public API có trí nhớ dài

Một synchronous API call thường gắn với code gọi nó. Event thì khác. Nó có thể được lưu nhiều ngày, replay nhiều tháng sau, copy sang hệ thống khác hoặc được consume bởi một service mà không ai nhớ tới trong lúc release.

Vì vậy, event contract có ít nhất hai audience. Consumer hiện tại cần hiểu message tiếp theo. Historical consumer và replay job cần hiểu message đã được tạo ra trong quá khứ. Một thay đổi trông vô hại ở live path có thể thất bại khi backfill đọc dữ liệu cũ bằng code mới.

Contract không nên chỉ có field name và type. Nó nên nói rõ purpose của event, ownership, semantic meaning, identity field, assumption về ordering, retention, privacy classification và consumer có được phép bỏ qua unknown field hay không.

```json
{
  "event_type": "order.shipped",
  "event_version": 2,
  "event_id": "evt_9d1a",
  "occurred_at": "2026-08-14T08:10:00Z",
  "producer": "fulfillment-service",
  "data": {
    "order_id": "ord_4821",
    "carrier": "atlas",
    "tracking_number": "AT-8821"
  }
}
```

Envelope giúp consumer có metadata ổn định, trong khi phần `data` được evolve dưới một compatibility policy rõ ràng. Versioning không thay thế compatibility, nhưng làm contract và migration path dễ thảo luận hơn.

## Backward, forward và full compatibility

Compatibility trả lời một câu hỏi cụ thể: một version của application có đọc an toàn data do version khác tạo ra không?

| Mode | Câu hỏi thực tế | Use case thường gặp |
|---|---|---|
| Backward | Consumer mới có đọc được event cũ không? | Deploy consumer trước producer |
| Forward | Consumer cũ có đọc được event mới không? | Deploy producer trước consumer |
| Full | Consumer cũ và mới có đọc được event cũ và mới không? | Rolling migration an toàn hơn |
| Transitive | Rule có đúng với nhiều version lịch sử không? | Topic sống lâu và có replay |

Tên gọi hữu ích, nhưng team thường dùng sai. Schema có thể compatible về mặt cấu trúc trong khi meaning đã đổi. Field vẫn là string nhưng từ “local time” thành “UTC”. Default giúp deserialize thành công nhưng khiến consumer đi vào business branch sai.

Vì thế, schema check phải chạy cùng semantic test. Registry bảo vệ shape; consumer test bảo vệ behavior.

![Một compatibility matrix cho thấy producer và consumer V1/V2 đi qua các cổng backward, forward và full compatibility](/blog/schema-evolution/compatibility-matrix.webp)

## Thay đổi an toàn vẫn là thay đổi

Thêm một optional field thường dễ hơn remove hoặc rename. Nhưng “thường” không phải bảo đảm. Một số consumer reject unknown field. Một số deserialize vào strict class. Một số downstream job giả định số column cố định. Một field trông optional trong schema có thể là bắt buộc với một dashboard không được document.

Rename đặc biệt nguy hiểm vì nó vừa là structural change vừa là semantic change. Consumer có thể hiểu field cũ biến mất là một trạng thái thật chứ không phải rename. Remove field có thể phá replay path nhiều tháng sau release ban đầu.

Với additive change đơn giản, một sequence tolerant thường là:

1. Làm consumer có thể ignore hoặc default field mới một cách an toàn.
2. Deploy consumer change và verify bằng event cũ.
3. Register schema mới đã kiểm tra compatibility.
4. Deploy producer bắt đầu populate field.
5. Đo behavior của consumer và xác nhận meaning mới.
6. Chỉ remove compatibility code sau khi retention và replay window đã qua.

Sequence quan trọng hơn tooling cụ thể. Hệ thống phải dễ hiểu trong giai đoạn message cũ và mới cùng tồn tại.

## Xem migration là contract giữa các team

Event owner phải trả lời được ai có quyền đổi schema, consumer nào đang tồn tại, compatibility mode nào áp dụng và rollback hoạt động ra sao. Nếu câu trả lời là “registry sẽ báo cho chúng ta”, contract vẫn chưa đủ.

Một change proposal nhẹ có thể ghi lại:

| Câu hỏi | Decision cần lưu |
|---|---|
| Đã thay đổi gì? | Add, rename, remove, type hoặc semantic change |
| Ai consume? | Service, job, dashboard, external integration |
| Version nào cùng tồn tại? | Producer và consumer rollout order |
| Compatibility rule là gì? | Backward, forward, full hoặc custom policy |
| Dữ liệu cũ được xử lý ra sao? | Replay, backfill, quarantine hoặc ignore |
| Bằng chứng thành công? | Consumer test, metric, state check |
| Rollback thế nào? | Code rollback, stop producer, bridge hoặc data repair |

Document này không phải bureaucracy thừa. Nó là shared memory để một quyết định schema không chỉ nằm trong một pull request.

## Compatibility CI phải test consumer thật

Registry check là first gate quan trọng. Nó nên reject thay đổi vi phạm structural policy trước khi schema chạm topic. Nhưng production safety cần gate thứ hai: chạy old event qua consumer hiện tại và chạy new event qua consumer cũ nếu rollout yêu cầu.

Test corpus nên gồm event bình thường, boundary value, optional field bị thiếu, unknown field, old version, malformed record và event được tạo trong partial deployment. Với workflow có impact cao, assertion phải kiểm tra state transition, không chỉ việc deserialize có thành công hay không.

Cách này bắt được những lỗi như enum value mới parse được nhưng rơi vào dangerous default branch, hoặc timestamp đúng type nhưng làm lệch ngày billing.

## Rollback không chỉ là deploy lại producer cũ

Code rollback và data rollback là hai việc khác nhau. Nếu producer mới đã emit event có field hoặc meaning mới, dừng producer không xóa được event đã xuất hiện. Consumer cũ vẫn có thể đọc chúng, hoặc fail khi replay chạm tới.

Rollback plan phải trả lời ba câu hỏi:

1. Consumer cũ có đọc an toàn các event đã được producer mới ghi không?
2. Producer có quay về schema cũ mà không đổi meaning của record đã emit không?
3. Nếu event sai đã làm state thay đổi, state sẽ được repair như thế nào?

Đôi khi hành động an toàn nhất không phải schema rollback ngay. Có thể cần dừng write mới, quarantine một consumer, deploy bridge normalize version hoặc replay event sang topic mới sau khi sửa data.

![Một rollback conveyor dừng producer, quarantine event incompatible, normalize record an toàn và replay qua consumer đã verify](/blog/schema-evolution/rollback-replay.webp)

Điểm quan trọng là phân biệt reverse code với reverse fact. Fact đã publish vào event log cần một correction strategy rõ ràng.

## Versioning phải giải thích meaning, không được dùng để biện minh breaking change

Field `event_version` hữu ích khi consumer cần chọn parser hoặc business rule khác. Nó không hữu ích nếu mỗi breaking change chỉ được gắn một số mới rồi team ngừng suy nghĩ về migration.

Hãy chọn một trong hai hướng rõ ràng. Hoặc giữ một event type ổn định với compatibility policy phù hợp, hoặc tạo event type mới khi business meaning thật sự thay đổi. Tránh bắt consumer đoán `order.updated.v2` là additive change nhỏ hay một fact hoàn toàn khác.

Nếu field đổi meaning, hãy đổi cả tên field. Tên mới làm semantic break hiển thị rõ trong code review, dashboard và vận hành. Chỉ dùng version number có thể che giấu một assumption nguy hiểm sau một field quen thuộc.

## Data contract cần ownership và lifecycle

Data contract tồn tại chừng nào event còn có thể được consume. Nó cần owner, change process, compatibility policy và retirement plan.

Owner không cần approve mọi consumer implementation. Nhưng owner cần publish meaning dự kiến và thông báo thay đổi ảnh hưởng downstream behavior. Consumer nên khai báo mình strict hay tolerant, có hỗ trợ historical replay không và thật sự phụ thuộc vào field nào.

Điều này tạo ra cuộc nói chuyện trung thực về coupling. Consumer âm thầm phụ thuộc vào behavior chưa document vốn đã coupled; contract chỉ làm coupling đó lộ ra trước khi producer thay đổi.

## Checklist production

Trước khi merge schema change, hãy xác nhận business meaning đã được viết rõ, consumer đã biết đã được inventory, structural compatibility đã được check, old và new event representative đã được test, rollout order đã rõ. Hãy xác nhận partial deployment sẽ hoạt động thế nào, compatibility code phải sống bao lâu và bad event sẽ được quarantine hoặc repair ra sao.

Câu hỏi cuối nên đủ khó chịu nhưng đủ cụ thể: **nếu chúng ta publish một triệu event với meaning sai, chính xác bước tiếp theo là gì?** Nếu câu trả lời có replay hoặc repair path đã test, hệ thống đã sẵn sàng cho thay đổi. Nếu chỉ có “chúng ta rollback được”, data contract vẫn còn thiếu.

Event-driven architecture trở nên mạnh khi team có thể evolve nó mà không sợ hãi. Sự tự tin đó không đến từ việc không bao giờ đổi schema. Nó đến từ việc compatibility, ownership, rollout và rollback được làm rõ đến mức một thay đổi thật sự reversible trong thực tế, không chỉ reversible trên deployment dashboard.
