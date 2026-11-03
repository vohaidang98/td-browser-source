> Chế độ tạm thời 22/10/2026: app mở thẳng không cần đăng nhập. Supabase và quản lý/xóa từ xa tạm dừng. Cơ chế đăng nhập vẫn được giữ để bật lại ở bản sau. Các mô tả tài khoản bên dưới chỉ áp dụng khi bật lại chế độ tài khoản. Xem BAO-TRI-1.3.7.md.

# TD Browser 1.3.7 — Hồ sơ trên máy

## Hồ sơ trình duyệt
- Hồ sơ, cookie, phiên đăng nhập, tiện ích và cấu hình trình duyệt được giữ trong BrowserData trên máy đang dùng.
- Hồ sơ cũ có mã Cloud vẫn mở bằng dữ liệu cục bộ; không lấy khóa Cloud, không tự tải bản mới và không tải dữ liệu trình duyệt lên máy chủ khi tạo/mở/đóng/đổi tên.
- Mục Hồ sơ Cloud, nút tải/đồng bộ/chia sẻ hồ sơ và thao tác cấp hồ sơ Cloud đã tắt cả giao diện và IPC.
- Khi đóng Chrome, chờ nút Đang đóng… trở về Mở. Mở nhiều lần cùng hồ sơ không tạo nhiều phiên.
- Nếu dữ liệu hồ sơ cũ không còn trên máy, app báo thiếu dữ liệu. Cần khôi phục từ bản sao lưu cục bộ, không tự tạo một hồ sơ trống thay thế.
- Tài khoản TD vẫn phải đăng nhập và chịu quyền của Admin. Tài khoản không tự hết hạn.

## Quản lý của Admin
Admin mở Quản lý người dùng → Hồ sơ hoặc Hồ sơ người dùng để xem danh sách theo tài khoản và thiết bị. Có nút xóa từng hồ sơ. Khi máy người dùng ngoại tuyến, lệnh chờ đến khi app mở, đăng nhập và kết nối mạng. Xem ADMIN-PROFILES-1.3.7.md.

Danh sách tên/ID hồ sơ và trạng thái được gửi khoảng 30 giây/lần; không gửi cookie, mật khẩu proxy, lịch sử hay tệp trình duyệt. Supabase vẫn dùng cho đăng nhập, phân quyền và lệnh quản lý.

## Proxy và tự động hóa
- Proxy từng hồ sơ được kiểm tra trước khi mở. Múi giờ tự động lấy từ IP thoát, có lựa chọn thủ công. Proxy lỗi không tự chuyển sang mạng trực tiếp.
- Có thể kéo sắp xếp danh sách hồ sơ hoặc dùng Alt + mũi tên.
- Admin cấp quyền Flow riêng cho tài khoản; người dùng mới mặc định chưa được dùng.
- YouTube Upload là trang đầu của Tự động hóa: chọn hồ sơ, liên kết Google một lần, thêm thư mục và chọn video.
- Tiêu đề lấy theo tên tệp; không thêm thumbnail/mô tả. Chế độ Riêng tư, Không công khai hoặc Công khai.
- Mặc định tải lần lượt theo thứ tự tên số và thứ tự thêm thư mục. Tùy chọn tải đồng thời giữ tối đa 15 video và bổ sung ngay khi có chỗ trống.
- Có thể tải lại video đã hoàn tất, gỡ video đã tích và làm sạch danh sách; không xóa tệp nguồn.
- Chỉ Admin cấu hình Google API. Liên kết kênh và token bảo mật là dữ liệu API riêng, không phải đồng bộ dữ liệu Chrome.

## Cập nhật
Cài bộ cài 1.3.7 mới cho cả Admin và người dùng. Nếu chưa chạy migration xóa hồ sơ, xem SUPABASE-ADMIN-DELETE-1.3.7.sql. Nếu đã chạy SQL Admin Delete 1.3.6/1.3.7 thì không cần chạy lại.
