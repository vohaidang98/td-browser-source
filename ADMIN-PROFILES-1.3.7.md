> Chế độ tạm thời 22/10/2026: app mở thẳng không cần đăng nhập. Supabase và quản lý/xóa từ xa tạm dừng. Cơ chế đăng nhập vẫn được giữ để bật lại ở bản sau. Các mô tả tài khoản bên dưới chỉ áp dụng khi bật lại chế độ tài khoản. Xem BAO-TRI-1.3.7.md.

# Quản lý và xóa hồ sơ cục bộ — TD Browser 1.3.7

1. Admin vào Quản lý người dùng, chọn Hồ sơ của tài khoản; hoặc vào Hồ sơ người dùng để xem tất cả.
2. Mỗi bản trên mỗi thiết bị là một hàng riêng: tên, người dùng, trạng thái, mã thiết bị và thời điểm nhận danh sách.
3. Nút thùng rác gửi lệnh cho đúng tài khoản, thiết bị và ID hồ sơ. Admin xác nhận trước khi gửi.
4. Máy người dùng nhận lệnh khi app mở, đăng nhập và có mạng (thường ở lượt kiểm tra tiếp theo, khoảng 30 giây).
5. App ghi nhận lệnh xóa trước khi dừng hồ sơ/tự động hóa. Hồ sơ bị thu hồi không mở hoặc khôi phục từ thùng rác được nữa.
6. Khi mọi tác vụ đã ngừng dùng tệp, app xóa thư mục dữ liệu, các bản before-cloud của chính hồ sơ đó và mục hồ sơ trong thùng rác, rồi xác nhận với máy chủ. Nếu tệp bị khóa, app thử lại ở lượt kiểm tra sau.

Hồ sơ ngoại tuyến hiển thị trạng thái gần nhất và thời điểm cập nhật. Không có khả năng xóa ngay tệp trên máy đang tắt hoặc chưa kết nối. Admin xem danh sách và xóa; không cần tải dữ liệu trình duyệt của người dùng.

Supabase chỉ dùng cho tài khoản, quyền và danh sách/lệnh quản lý; cookie, mật khẩu proxy và tệp Chrome không được gửi trong danh sách. Các liên kết YouTube API vẫn dùng cơ chế mã hóa và phân quyền riêng.

## SQL
Nếu chưa cấu hình tính năng xóa trên máy: chạy SUPABASE-ADMIN-DELETE-1.3.7.sql trong Supabase SQL Editor. Migration giống bản Admin Delete 1.3.6/1.3.7 trước; đã chạy thì không cần lặp lại. Bộ cài không tự thay đổi cơ sở dữ liệu. Các máy người dùng cần cập nhật app để nhận lệnh.
