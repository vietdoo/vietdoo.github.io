---
title: "Browser Agent hiểu State: Xác minh thế giới trước mỗi lần click"
description: "Thiết kế production cho browser agent biết DOM, URL, account, visible text và page version đều có thể thay đổi, thay vì tin vào screenshot cũ trước một action không thể hoàn tác."
pubDate: 2026-06-20
category: "engineering"
image: "/blog/state-aware-browser-agents/hero.webp"
lang: "vi"
translationKey: "state-aware-browser-agents"
draft: false
---

![Browser agent quan sát một trang web đang thay đổi, revalidate target và xin xác nhận trước khi action](/blog/state-aware-browser-agents/hero.webp)

Browser agent không bị nhầm với cái button. Nó bị nhầm bởi thời gian.

Lúc 10:15:00, nó kiểm tra trang order và tìm thấy button “Add to cart” cho đúng sản phẩm người dùng nói đến. Lúc 10:15:47, nó click đúng tọa độ đó. Trong khoảng thời gian ở giữa, trang đã refresh, account đăng nhập đã đổi và một banner khuyến mãi làm layout dịch chuyển. Click là thật. Target thì không còn đúng nữa.

Không có gì crash. Browser trả về event thành công. Agent báo rằng sản phẩm đã được thêm vào giỏ. Sau đó người dùng phát hiện action đã xảy ra trong một account khác.

Đây là failure mode làm browser agent khác với một API tool caller thông thường. API request thường mang theo target có cấu trúc và server-side contract. Browser agent hành động trên một thế giới thay đổi liên tục: DOM mutate, modal mở, session hết hạn, A/B test đổi label hoặc một người khác cập nhật cùng record.

> **Luận điểm:** Một browser action chỉ an toàn khi state đã biện minh cho action đó vẫn khớp với state tại thời điểm thực thi. Hãy observe, fingerprint, revalidate rồi mới act. Nếu fingerprint stale, dừng thay vì đoán.

Những benchmark web agent thực tế như WebArena hữu ích vì đánh giá agent trong môi trường chức năng với task nhiều bước, không chỉ trên câu trả lời văn bản riêng lẻ.[1] Production cần thêm một lớp: hệ thống phải chứng minh page và authority context vẫn ổn định trước mỗi click không thể hoàn tác.

## Screenshot là observation, không phải contract

Cách triển khai dễ nhất là một loop: chụp screenshot hoặc đọc DOM, hỏi model nên click gì, thực hiện click và lặp lại. Loop này hoạt động trong demo vì môi trường yên tĩnh. Ứng dụng web production thì không.

Một observation của browser nên được xem như một fact có version và lifetime giới hạn. Nó nói rằng: “Tại thời điểm này, dưới URL, account, page version và visible state này, target trông giống như đại diện cho intent của user.” Nó không nói target sẽ còn hợp lệ sau một network request khác.

| Thành phần browser state | Điều có thể thay đổi | Vì sao agent phải quan tâm |
|---|---|---|
| URL và route | Redirect, query parameter, tenant path | Cùng button có thể mutate resource khác |
| DOM target | Re-render, reorder, virtualized list | Coordinate hoặc index có thể trỏ sang chỗ khác |
| Visible text | Localization, experiment, status update | Ý nghĩa của control có thể đổi |
| Account và role | Session expiry, account switch, impersonation | Authority có thể không còn khớp request ban đầu |
| Time và freshness | Price, stock, token, approval window | Action chỉ hợp lệ trong một khoảng ngắn |
| Page hoặc API version | Deployment, feature flag, stale cache | Cùng selector có thể map sang behavior khác |

State fingerprint không cần hash toàn bộ trang. Full-page hash nhiều noise và dễ tạo false mismatch. Thay vào đó, hãy chọn những field giải thích vì sao action được phép: route, authenticated principal, target identity, relevant text, resource version và freshness timestamp.

```ts
type BrowserObservation = {
  url: string;
  principalId: string;
  target: {
    role: string;
    accessibleName: string;
    resourceId?: string;
  };
  relevantText: string[];
  pageVersion?: string;
  observedAt: string;
};

type StateFingerprint = {
  url: string;
  principalId: string;
  targetKey: string;
  textHash: string;
  pageVersion?: string;
  observedAt: string;
};
```

Fingerprint không tự nó là security boundary. Nó là input cho revalidation. Execution layer vẫn cần authorization và action policy. Fingerprint khớp chỉ nói rằng “target được observe vẫn trông giống target mong muốn”; nó không nói “agent được phép submit form này.”

![State fingerprint so sánh URL, DOM, text, account, time và version trước khi cho phép click](/blog/state-aware-browser-agents/state-fingerprint.webp)

## Locate theo intent, không theo vị trí

Coordinate và ordinal index hấp dẫn vì đơn giản. Chúng cũng mong manh. Browser agent nói “click button thứ ba” đang encode layout, không encode intent. Ngay cả CSS selector cũng có thể quá yếu nếu nó xác định một button chung cho nhiều record.

Target tốt hơn nên kết hợp semantic role, accessible name, resource identity gần đó và expected effect. Ví dụ: “button có tên `Add to cart` bên trong card của product ID `42`.” Agent cũng nên ghi lại điều nó mong đợi sau action, như cart count tăng hoặc server xác nhận line item.

```ts
type ActionIntent = {
  kind: "click" | "fill" | "select" | "submit" | "delete";
  resourceId: string;
  expectedControl: {
    role: string;
    name: string;
  };
  expectedEffect: {
    event: string;
    resourceId: string;
  };
  reversibility: "reversible" | "irreversible";
};

function targetStillMatches(
  intent: ActionIntent,
  current: BrowserObservation,
): boolean {
  return (
    current.target.resourceId === intent.resourceId &&
    current.target.role === intent.expectedControl.role &&
    current.target.accessibleName === intent.expectedControl.name
  );
}
```

Điều này không có nghĩa mọi ứng dụng web phải có accessibility tree hoàn hảo. Nó có nghĩa khi action quan trọng, hệ thống cần target contract giàu thông tin hơn. Nếu locator duy nhất là pixel coordinate, hệ thống nên xếp action vào nhóm uncertainty cao và yêu cầu confirmation mạnh hơn.

## Tách exploration có thể hoàn tác khỏi mutation không thể hoàn tác

Browser agent thường giỏi exploration: mở trang, đọc policy, so sánh sản phẩm, filter danh sách hoặc chuẩn bị draft. Nó trở nên nguy hiểm khi exploration và mutation dùng chung một action loop không bị giới hạn.

Hãy phân loại action theo effect lên thế giới. Đọc trang thường có thể hoàn tác. Sửa draft có thể khôi phục. Gửi email, submit payment, xóa record hoặc đổi quyền truy cập thì không. Browser agent phải đi qua boundary rõ ràng trước khi bước vào nhóm irreversible.

![Browser action được chia thành reversible exploration và irreversible mutation với confirmation gate](/blog/state-aware-browser-agents/action-boundaries.webp)

| Nhóm action | Ví dụ | Control mặc định |
|---|---|---|
| Observe | Đọc trang, xem status, lấy metadata | Cho phép theo session policy bình thường |
| Explore | Search, filter, mở detail, compare | Cho phép với giới hạn rate và navigation |
| Prepare | Điền draft, stage selection, preview | Revalidate target và field |
| Commit | Submit, purchase, send, publish | Fresh state và confirmation hoặc policy proof |
| Destruct | Delete, revoke, cancel, overwrite | Fresh state, confirmation rõ ràng, audit record |

Confirmation phải mô tả effect bằng ngôn ngữ người dùng, không phải locator nội bộ của agent. “Submit refund cho order 42 trong account Finance” có ý nghĩa. “Click `button:nth-child(3)`” thì không. Nếu principal, resource, amount, destination hoặc irreversible effect thay đổi giữa preview và commit, confirmation cũ mất hiệu lực và phải xin lại.

## Browser action là một transaction nhỏ

Browser không cung cấp database transaction xuyên suốt page, network và intent của user. Ta vẫn có thể thiết kế một transactional boundary quanh action:

1. Observe state hiện tại.
2. Resolve target theo intent và resource identity.
3. Ghi fingerprint có lifetime ngắn.
4. Chuẩn bị action mà chưa commit nếu có thể.
5. Re-observe ngay trước bước irreversible.
6. So sánh các field quan trọng của fingerprint.
7. Execute thông qua browser capability được phép.
8. Verify effect bằng trusted result, không phải click event.

Click event chỉ có nghĩa browser đã nhận input. Nó không có nghĩa server đã commit mutation mong muốn. Sau submit, hãy verify resource, status hoặc confirmation message. Nếu không verify được, báo “chưa thể xác nhận” thay vì “đã xong”.

Compare nên strict với field rủi ro cao và tolerant với thay đổi vô hại. Timestamp đổi vài giây có thể bình thường; account ID đổi thì không bao giờ vô hại. Banner marketing đổi có thể không quan trọng với thao tác đọc, nhưng price đổi là quan trọng trước khi mua.

```ts
type Risk = "low" | "medium" | "high";

function needsRevalidation(
  before: StateFingerprint,
  after: StateFingerprint,
  risk: Risk,
): boolean {
  if (before.principalId !== after.principalId) return true;
  if (before.url !== after.url) return true;
  if (before.targetKey !== after.targetKey) return true;
  if (risk === "high" && before.textHash !== after.textHash) return true;
  if (risk === "high" && before.pageVersion !== after.pageVersion) return true;
  return false;
}
```

## State stale phải dẫn đến safe stop

Khi fingerprint không khớp, agent có ba lựa chọn rất hấp dẫn: cứ click, tìm target tương tự hoặc hỏi model tự improvisation. Cả ba chỉ có thể chấp nhận trong một recovery policy có giới hạn. Với irreversible action, mặc định nên là stop, observe lại và re-plan.

![Recovery loop của browser agent phát hiện stale state, dừng, observe lại, re-plan, confirm rồi retry hoặc abort](/blog/state-aware-browser-agents/recovery-loop.webp)

Recovery loop không được âm thầm dùng lại plan cũ. Trang mới có thể hiển thị account khác, price khác hoặc object khác. Re-plan từ state mới là một quyết định mới. Nếu hệ thống không giải thích được vì sao target mới tương đương intent cũ, nó nên hỏi user hoặc abort.

Đây cũng là nơi cần loop budget. Trang stale làm re-observe lặp đi lặp lại có thể trở thành denial-of-service đối với user hoặc website. Hãy đặt giới hạn cho navigation step, refresh, retry và thời gian recovery. Khi hết budget, handoff với một lời giải thích ngắn.

## Session và authority là một phần của page state

Browser agent thừa hưởng authority từ session, nhưng session không phải một fact tĩnh. Token hết hạn. Các tab dùng chung cookie. User đổi account. Support operator mở elevated view trong một tab còn agent tiếp tục ở tab khác. Nếu agent chỉ ghi URL và DOM, nó có thể hành động trong sai authority context.

Browser capability nên cung cấp principal identifier ổn định và session version cho action policy. Trước action nhạy cảm, xác minh principal vẫn khớp request ban đầu và session chưa đi qua boundary nâng quyền. Đừng để model quyết định account mới “có lẽ ổn”.

Quy tắc hữu ích là: **authority đổi thì plan mất hiệu lực**. Hệ thống có thể tiếp tục đọc sau session refresh, nhưng không nên mang plan cũ qua principal change nếu chưa có re-authorization rõ ràng.

## Đánh giá environment outcome, không chỉ transcript

Một transcript trôi chảy có thể che giấu browser task thất bại. Agent nói “tôi đã cập nhật địa chỉ” trong khi lỗi validation vẫn nằm dưới fold. Nó nói “đơn hàng đã bị hủy” sau một click chỉ mở confirmation modal. Evaluation phải kiểm tra final environment state, không chỉ text model tạo ra.

Với mỗi task, hãy ghi xem resource mong muốn có thật sự đổi không, thay đổi có được authorize không, user có được thông báo chính xác không và có bao nhiêu lần recovery vì stale state. Hãy chia theo browser, site, account type, page version, action risk và nguồn interruption.

| Metric | Cho biết điều gì | Cách hiểu sai cần tránh |
|---|---|---|
| Intended-state success | Mutation được yêu cầu có thật sự xảy ra không | Xem click success là task success |
| Wrong-target rate | Agent có tác động nhầm resource không | Giấu trong pass rate tổng |
| Revalidation stop rate | Thế giới đổi trước action bao nhiêu lần | Xem mọi stop là agent failure |
| Confirmation burden | User phải approve lại bao nhiêu lần | Tối ưu để xóa mất safety cần thiết |
| Recovery loop count | Site bất ổn hay locator yếu | Đổ lỗi cho model mà không xét site |
| Side-effect leakage | Exploration có vô tình mutate state không | Nghĩ read action mặc định luôn an toàn |

Cách WebArena đặt vấn đề là điểm khởi đầu tốt cho task có thể verify, nhưng production evaluation cần state oracle và authorization model của chính ứng dụng.[1] Browser reliability không chỉ là “agent có hoàn tất không?” mà là “đúng principal có tạo đúng state transition không, và ta có chứng minh được không?”

## Checklist rollout thực tế

Trước khi cấp write access, bắt đầu bằng read-only task và ghi lại các state field có thể đã ngăn những lỗi cũ. Thêm draft mode tiếp theo. Đưa irreversible action vào từng capability một, với fresh-state check và human confirmation. Giữ safe stop hiển thị được cho cả user lẫn operator.

Agent nên phát ra action ledger gọn: intent, target resource, principal, observation time, fingerprint, policy decision, action result và post-action verification. Ledger này bổ sung cho các bài về tool contract, agent identity và failure UX mà không biến toàn bộ trang web thành một log stream vô hạn.

## Thói quen ngăn bug đắt giá

Trước mỗi click quan trọng, hãy hỏi một câu không hào nhoáng: **từ lúc tôi nhìn thấy nó đến giờ, điều gì đã thay đổi?**

Câu trả lời có thể là “không có gì đáng kể”, nhưng hệ thống phải kiếm được câu trả lời đó bằng revalidation. Browser agent không cần đóng băng web. Nó cần tôn trọng việc web đang sống. Page update, con người hành động, permission thay đổi và intent có time boundary.

Vì vậy, browser agent đáng tin giống một operator thận trọng hơn là một macro recorder: locate theo meaning, kiểm tra principal, verify target, pause ở action boundary, xác nhận effect và dừng khi thế giới không còn khớp plan.

## Tài liệu tham khảo

[1]: https://webarena.dev/ "WebArena, A Realistic Web Environment for Autonomous Agents"
[2]: https://arxiv.org/html/2511.19477v1 "Building Browser Agents: Architecture, Security, and Reliability"
[3]: https://webarena.dev/webarena-infinity/ "WebArena-Infinity, Verifiable Browser-Agent Environments"
[4]: https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/ "OWASP, Agentic AI — Threats and Mitigations"

## Đọc thêm

- [Contract Testing for AI Tools: Proving an Agent Can Safely Call the Same Capability Across Providers](/blog/ai-tool-contract-testing)
- [AI Agent Identity Is Not a User ID: Designing Delegation, Scope, and Revocation](/blog/agent-identity-delegation-revocation)
- [When AI Gives a Partial Answer: Designing Failure UX for Uncertainty](/blog/ai-partial-answer-uncertainty-ux)
