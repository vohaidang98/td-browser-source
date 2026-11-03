# Tự động hóa — TD Browser 1.3.5

Giữ Flow no-code, Playwright, HTTP API và MCP. Admin cấp quyền Dùng Flow riêng từng tài khoản; mặc định người dùng chưa được cấp quyền. Service và server kiểm tra quyền, giới hạn hai hồ sơ có tác vụ đồng thời, hủy khi quyền/tài khoản thay đổi. Flow thường, lịch, biến bảo mật, import/export và vòng đời Cloud Chrome giữ cơ chế hiện có.

Khối youtubeUpload chỉ chạy riêng một hồ sơ mỗi lượt, một khối gốc, chạy thủ công. 1.3.5 chỉ nhận YOUTUBE_ENGINE=api (mặc định), PRIVATE/UNLISTED/PUBLIC và 1–1.000 ID video đã quét từ thư mục được chọn bằng hộp thoại. Các flow cũ yêu cầu studio/DRAFT bị từ chối; không chuyển sang công khai ngầm định. Không lồng upload vào vòng lặp/điều kiện hoặc lên lịch. Tự chia hàng đợi thành các lượt tối đa 15 video; chờ toàn lượt kết thúc trước khi chạy lượt kế tiếp. Mỗi kênh chỉ có một hàng đợi đang chạy/chờ trên app. Tiến trình chỉ hiển thị tối đa 15 video của lượt hiện tại. Tải các video trong lượt đồng thời qua Google API, không điều khiển DOM của Studio. Tiêu đề tính lại từ tên tệp; no thumbnail/no description/no kids theo cấu hình native đã yêu cầu.

Liên kết Google đồng bộ mã hóa theo hồ sơ Cloud và quyền truy cập hiện có. Admin quản lý client Desktop chung; người dùng có quyền chỉ liên kết kênh riêng trong hồ sơ được cấp. Liên kết đã tồn tại được trả về từ cache/server, không khởi động OAuth lần nữa. File grants, nhật ký upload và session resume vẫn riêng tài khoản/máy. Xem các hướng dẫn YouTube và Google API.

HTTP/MCP mặc định tắt, loopback, Bearer token mã hóa, kiểm tra Host/Origin/quyền tài khoản và readonly. API/MCP không tự cấp quyền đọc thư mục bất kỳ hoặc mở hồ sơ ngoài danh sách. Schedules chỉ chạy khi app mở/đăng nhập. Không tự chạy SQL, cài bộ cài hoặc đăng release lên GitHub.

## Hàng đợi tải cuốn chiếu

YOUTUBE_UPLOAD_ORDER=PARALLEL sử dụng toàn bộ hàng đợi (tối đa 1.000 tệp) qua nhóm 15 worker. Hoàn tất một tệp là lấy tệp tiếp theo; tối đa 15 tệp đang tải và 15 thẻ tiến trình. Khi lỗi/hủy thì dừng lấy thêm; phiên chưa hoàn tất giữ để tiếp tục. SEQUENTIAL giữ thứ tự hoàn tất, tải từng tệp.
