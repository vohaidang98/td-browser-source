# Bảo trì TD Browser 1.3.7

## Nguyên nhân và thay đổi
Luồng cũ buộc hồ sơ liên kết Cloud lấy khóa và có thể tải phiên bản dữ liệu mới trước khi mở; khi đóng lại nén/mã hóa/tải lên. Giao diện có lúc hiện Mở trước khi việc này kết thúc. Theo yêu cầu mới, toàn bộ vòng đồng bộ dữ liệu trình duyệt đã được tắt.

Hồ sơ mở, đóng, tạo và đổi tên bằng dữ liệu cục bộ; không bị khóa Cloud cũ hoặc máy chủ Storage chặn. Kiểm tra lệnh Admin chạy nền, không giữ việc mở hoặc nạp danh sách hồ sơ. Phần bảo vệ lệnh xóa đã lưu vẫn được kiểm tra trước khi mở.

Native giữ trạng thái Đang mở/Đang đóng cho giao diện; cửa sổ nạp lại nhận đúng trạng thái. Lệnh mở trùng dùng chung một tác vụ. Proxy được dừng có thời hạn; lỗi khởi động trả trạng thái để thử lại. Không đổi tuyến mạng khi proxy lỗi.

Danh sách Admin chuyển sang thông tin theo thiết bị, không cần hồ sơ Cloud có bản nén. Việc xóa tuân thủ đúng quyền và thiết bị, chờ tác vụ dừng trước khi xóa tệp, giữ lệnh thu hồi qua lần khởi động lại và tránh vòng chờ giữa mở hồ sơ và xử lý lệnh Admin.

Bản đang cài được đọc trong lần kiểm tra là 1.3.6; mã nguồn và bộ cài sửa giữ phiên bản 1.3.7. Cần cài bộ cài mới để nhận thay đổi.

## Kiểm tra
Xem KIEM-TRA-1.3.7.md và maintenance-reports/maintenance-summary.json trong thư mục bộ cài. Kiểm tra dùng dữ liệu thử riêng; chưa chạy mở Chrome trên hồ sơ thật, OAuth thật, tải YouTube thật hoặc áp dụng SQL lên Supabase.

Bổ sung: tách điều hướng trang web ban đầu khỏi xác nhận Chrome/múi giờ. Trang web chậm hoặc Page.navigate hết thời gian chờ không làm đóng một hồ sơ đã khởi động và kiểm tra múi giờ thành công. App báo cảnh báo tải trang để người dùng thử lại trong Chrome.


## Chế độ cục bộ tạm thời — 22/10/2026
Bản này mở vào không gian cục bộ mà không cần đăng nhập hoặc kết nối Supabase. Cơ chế tài khoản nguyên bản được giữ trong main.js; main-entry.js chọn main-local.js bằng hằng TEMPORARY_LOCAL_MODE. Muốn phục hồi phải đổi hằng trong mã nguồn và đóng gói lại, không cung cấp nút chuyển ở phía người dùng.

Chế độ cục bộ không gửi danh sách thiết bị, không nhận lệnh xóa từ xa, không đồng bộ OAuth qua Supabase. Hồ sơ và tệp đăng nhập TD cũ được giữ. ID chủ không gian cũ được dùng lại khi đọc được để tiếp tục tìm Flow và liên kết Google đã lưu trên máy. Nếu Google API chưa có cấu hình trên máy, cần nhập OAuth Desktop JSON trong Tự động hóa. Không lấy được token chỉ tồn tại trên Supabase trong thời gian dịch vụ bị hạn chế; có thể phải liên kết Google lại.

Các kiểm tra 225 mục được ghi trước thay đổi chế độ này; không được coi là kiểm tra runtime của chế độ cục bộ mới. Đợt này kiểm tra cú pháp và đối chiếu các tệp đóng gói, chưa chạy hồ sơ thật.

## 29/10/2026 — Bố cục thông tin Proxy
Tách tài khoản và mật khẩu thành hai dòng riêng ở cấu hình Proxy và tạo hồ sơ. Giới hạn kích thước flex để phần bọc nút Hiện không làm tràn chiều ngang; nhãn trỏ đúng ô nhập. Giữ nguyên ID trường và xử lý lưu/kiểm tra Proxy. Không chạy kiểm tra runtime trong lần sửa bố cục này.

## 03/11/2026 — Trang mở hồ sơ
Mặc định mở tab trống (about:blank), không tự vào ScanBrowser. URL chỉ định bởi Flow/YouTube vẫn được giữ. Áp dụng cả chế độ cục bộ tạm thời và chế độ tài khoản được lưu lại.
