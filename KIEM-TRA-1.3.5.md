# Phạm vi kiểm tra — 1.3.5

Theo yêu cầu kiểm tra và bảo trì của người dùng, đã chạy 195 kiểm tra hồi quy riêng cho Proxy, múi giờ/CDP, vòng đời Chrome, service/API/MCP, đồng bộ trước chia sẻ và giao diện chọn người nhận/tab mặc định. Tất cả qua. Cloud, Chrome/CDP, IPC và OAuth trong các kiểm tra này dùng mô phỏng; các bộ Proxy dùng server cục bộ. Chi tiết trong maintenance-reports.

Đã kiểm tra kết nối thực tế qua Proxy của hồ sơ được báo lỗi, kết nối thành công tại thời điểm kiểm tra. Thử Chrome riêng bằng thư mục tạm bị môi trường chặn mở tiến trình (spawn EPERM); không mở hồ sơ khách hàng. Chưa xác nhận app/Chrome thật đã hết lỗi.

281 kiểm tra cũ được giữ làm mốc lịch sử, không dùng làm bằng chứng cho thay đổi mới. Báo cáo mới có hash nguồn riêng.

Chưa thử tải video/OAuth thật, Supabase/RLS/RPC thật, chia sẻ giữa hai máy, hoặc xác nhận trực quan Electron. Migration chưa được chạy trên Supabase. Không gửi video thật trong lần bảo trì.

Đối chiếu hash nguồn giữa staging, project, ZIP và ASAR trích từ bộ cài; kiểm tra phiên bản, dependency, Unicode và metadata cập nhật. Đóng gói không thay thế thử app thật.

Sau cài: thử mở hồ sơ từng báo lỗi; nếu lặp lại, gửi thông báo cùng diagnostics/chrome-startup.json trong thư mục dữ liệu app. Thử chia sẻ hồ sơ đã đóng: đồng bộ xong mới cấp quyền; người nhận tải tại Hồ sơ Cloud. Admin chạy SQL danh sách người nhận một lần nếu chưa chạy. Thử một video ngắn Riêng tư trước khi tải hàng loạt. BKT do bạn tự cài trong Studio.


## Sắp xếp vị trí hồ sơ trong bảng — 1.3.5

- Vào Hồ sơ, chọn “Thứ tự tùy chỉnh”; giữ tay nắm sáu chấm cạnh số thứ tự rồi kéo lên/xuống. Vạch màu cho biết vị trí thả.
- Hoặc đặt con trỏ bàn phím vào tay nắm và nhấn Alt + mũi tên lên/xuống.
- Lưu tự động theo từng tài khoản trên máy hiện tại, dùng lại khi mở app. Hồ sơ mới nằm cuối; hồ sơ ẩn bởi bộ lọc giữ vị trí.
- Chọn “Thứ tự tạo ban đầu”, “Tên A → Z” hoặc “Mới tạo trước” để xem theo cách khác; quay về “Thứ tự tùy chỉnh” để tiếp tục kéo thả.
- Phần này chỉ thay đổi cách hiển thị. Không có migration SQL mới.

Phạm vi xác nhận cho lần sửa này: đã biên dịch cú pháp nguồn và đối chiếu bản đóng gói; chưa chạy thử kéo thả trong Electron thật, chưa chạy thêm kiểm tra chức năng. 195 kiểm tra bảo trì trước đó được giữ nguyên báo cáo và hash nguồn làm mốc lịch sử; không xác nhận thay đổi sắp xếp mới.
