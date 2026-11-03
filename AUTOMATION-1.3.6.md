# Quản lý và xóa hồ sơ người dùng — cập nhật 1.3.6

- Đã bỏ nút chia sẻ và công tắc chia sẻ trong TD. Chức năng Admin quản lý tài khoản, xem hồ sơ, sửa cấu hình và xóa hồ sơ vẫn giữ. Không tự thu hồi các quyền đã cấp trước đây.
- Admin vào Quản lý người dùng → Hồ sơ để xem từng tài khoản; phần Hồ sơ người dùng vẫn xem nguồn Cloud.
- Xóa một nguồn Cloud: xóa nguồn trên hệ thống và lưu lệnh xóa mọi bản có cùng nguồn, gồm bản tải độc lập. Máy ngoại tuyến nhận lệnh khi mở TD, đăng nhập và có mạng.
- Hồ sơ chỉ lưu trên máy có nút yêu cầu xóa theo đúng tài khoản, thiết bị và mã hồ sơ. Nút này chỉ xóa bản trên thiết bị được chọn; nếu hồ sơ không có nguồn Cloud thì không có dữ liệu Cloud để xóa.
- App kiểm tra lệnh khi tải danh sách, trước mở hồ sơ và khoảng 30 giây/lần. Nhận lệnh thì lưu trạng thái chặn mở/khôi phục, hủy tác vụ của hồ sơ, đóng Chrome do TD quản lý rồi xóa dữ liệu và bản sao lưu của đúng hồ sơ trong BrowserData. Khi tệp còn bị giữ hoặc tác vụ đang dừng thì chờ và thử lại; không xóa qua liên kết thư mục. Không đụng video tải lên hoặc hồ sơ Chrome ngoài TD.
- Lệnh xóa không mất khi nguồn Cloud đã bị xóa. Các tệp Cloud mã hóa được Admin dọn qua hàng đợi có retry. Các thay đổi trình duyệt chưa tải Cloud trong bản độc lập vẫn ở riêng trên máy cho đến khi Admin xóa.

## Cần làm để dùng chức năng mới

1. Admin chạy **SUPABASE-ADMIN-DELETE-1.3.6.sql** một lần trong Supabase SQL Editor. Đây là migration thêm hàng đợi xóa, quyền RPC, chặn ghi dữ liệu vào nguồn đã xóa và tắt tạo chia sẻ mới. Migration không tự xóa hồ sơ hiện có.
2. Cài lại bộ cài 1.3.6 mới cho **cả Admin và người dùng**. Cùng số phiên bản nên các máy đã cài 1.3.6 trước đó cần cài thủ công bản mới. App cũ chưa có bộ nhận lệnh xóa bản độc lập.
3. Admin bấm xóa trong bảng và xác nhận đúng phạm vi. Thông báo “Đã gửi lệnh” chưa có nghĩa máy ngoại tuyến đã xóa xong. Nếu hồ sơ đang dùng, app sẽ chờ đóng tác vụ/tệp trước khi xóa.

SQL chưa được áp dụng trong lần đóng gói này. Chưa chạy thử xóa thật giữa hai máy, Supabase/RLS/RPC thật hoặc kiểm tra chức năng mới. Chỉ biên dịch cú pháp nguồn, rà soát mã và đối chiếu gói cài. 195 kiểm tra bảo trì trước được giữ nguyên làm mốc lịch sử, không xác nhận thay đổi mới. Các hướng dẫn chia sẻ ở tài liệu cũ không còn áp dụng.


---

# Tự động hóa — TD Browser 1.3.6

Giữ Flow no-code, Playwright, HTTP API và MCP. Admin cấp quyền Dùng Flow riêng từng tài khoản; mặc định người dùng chưa được cấp quyền. Service và server kiểm tra quyền, giới hạn hai hồ sơ có tác vụ đồng thời, hủy khi quyền/tài khoản thay đổi. Flow thường, lịch, biến bảo mật, import/export và vòng đời Cloud Chrome giữ cơ chế hiện có.

Khối youtubeUpload chỉ chạy riêng một hồ sơ mỗi lượt, một khối gốc, chạy thủ công. 1.3.6 chỉ nhận YOUTUBE_ENGINE=api (mặc định), PRIVATE/UNLISTED/PUBLIC và 1–1.000 ID video đã quét từ thư mục được chọn bằng hộp thoại. Các flow cũ yêu cầu studio/DRAFT bị từ chối; không chuyển sang công khai ngầm định. Không lồng upload vào vòng lặp/điều kiện hoặc lên lịch. Tự chia hàng đợi thành các lượt tối đa 15 video; chờ toàn lượt kết thúc trước khi chạy lượt kế tiếp. Mỗi kênh chỉ có một hàng đợi đang chạy/chờ trên app. Tiến trình chỉ hiển thị tối đa 15 video của lượt hiện tại. Tải các video trong lượt đồng thời qua Google API, không điều khiển DOM của Studio. Tiêu đề tính lại từ tên tệp; no thumbnail/no description/no kids theo cấu hình native đã yêu cầu.

Liên kết Google đồng bộ mã hóa theo hồ sơ Cloud và quyền truy cập hiện có. Admin quản lý client Desktop chung; người dùng có quyền chỉ liên kết kênh riêng trong hồ sơ được cấp. Liên kết đã tồn tại được trả về từ cache/server, không khởi động OAuth lần nữa. File grants, nhật ký upload và session resume vẫn riêng tài khoản/máy. Xem các hướng dẫn YouTube và Google API.

HTTP/MCP mặc định tắt, loopback, Bearer token mã hóa, kiểm tra Host/Origin/quyền tài khoản và readonly. API/MCP không tự cấp quyền đọc thư mục bất kỳ hoặc mở hồ sơ ngoài danh sách. Schedules chỉ chạy khi app mở/đăng nhập. Không tự chạy SQL, cài bộ cài hoặc đăng release lên GitHub.

## Hàng đợi tải cuốn chiếu

YOUTUBE_UPLOAD_ORDER=PARALLEL sử dụng toàn bộ hàng đợi (tối đa 1.000 tệp) qua nhóm 15 worker. Hoàn tất một tệp là lấy tệp tiếp theo; tối đa 15 tệp đang tải và 15 thẻ tiến trình. Khi lỗi/hủy thì dừng lấy thêm; phiên chưa hoàn tất giữ để tiếp tục. SEQUENTIAL giữ thứ tự hoàn tất, tải từng tệp.
