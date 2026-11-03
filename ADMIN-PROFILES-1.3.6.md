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
