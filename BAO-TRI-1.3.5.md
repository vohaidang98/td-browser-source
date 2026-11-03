# Bảo trì TD Browser 1.3.5

## Nguyên nhân và bằng chứng

Proxy của hồ sơ người dùng báo lỗi đã kết nối thành công tại thời điểm kiểm tra. Nhánh báo lỗi trong mã mở Chrome gộp lỗi kết nối CDP và lỗi múi giờ, thời gian chờ ngắn, không thử lại tab đang chuyển trang; lỗi khởi động dẫn đến đóng Chrome. Đây là điểm lỗi được xác định từ mã nguồn; chưa thu được nguyên nhân chính xác của lần lỗi trên máy người dùng.

## Điều chỉnh

- Chờ Chrome sẵn sàng lâu hơn, thử lại kết nối trên cùng tiến trình.
- Thử lại lỗi tạm khi tab/context chưa sẵn sàng; bỏ qua tab hệ thống/extension và tab đã biến mất.
- Chỉ chấp nhận timezone override có sẵn sau khi đo đúng múi giờ.
- Chrome đóng khi khởi động không được xử lý như lần đóng bình thường và không tự publish dữ liệu dang dở lên Cloud.
- Giảm thông báo lỗi trùng; lưu mã chẩn đoán không chứa tài khoản/mật khẩu Proxy.
- Giữ kiểm tra đúng Proxy/múi giờ trước khi báo mở thành công. Nếu hết lượt thử vẫn lỗi, hồ sơ chưa được mở.

## Kiểm tra

195 kiểm tra hồi quy qua. Kiểm tra Proxy thực tế qua. Chrome riêng bị chặn spawn EPERM; chưa thử hồ sơ khách hàng thật, Google và Supabase thật. Xem KIEM-TRA-1.3.5.md và maintenance-reports.

## Thoát app và tải lại video

Đóng cửa sổ bắt đầu dừng tác vụ, đóng Chrome có kiểm soát rồi chờ đồng bộ. Cửa sổ được giữ với số hồ sơ/tác vụ còn lại; mở biểu tượng app lần nữa sẽ hiện lại cửa sổ. Khi cần Thoát ngay, app hỏi xác nhận gián đoạn và chỉ dừng Chrome do TD đang quản lý. Cài cập nhật từ app sẽ đợi tiến trình TD kết thúc trước khi mở bộ cài. Mạng/đồng bộ lâu vẫn phải chờ hoặc chủ động Thoát ngay; chưa kiểm tra trên Electron/Windows thật.

Video đã tải không tự được tích để tránh gửi trùng ngoài ý muốn; bạn tự tích hoặc Chọn tất cả rồi bấm Bắt đầu. Mỗi lần tải lại có mã lượt/phiên riêng; giữ nhật ký lần trước và hỗ trợ tiếp tục phiên mới bị gián đoạn. Chọn lại thư mục đã có sẽ quét lại danh sách.

## Các yêu cầu hoàn thiện cùng bản này

Chia sẻ có danh sách tài khoản và tự đồng bộ dữ liệu cục bộ trước cấp quyền. Mỗi lần vào Tự động hóa mở YouTube Upload và cuộn về đầu trang, giữ tiến trình tải. Bỏ mục BKT; tải video vẫn dùng API. Video đã tải có thể chọn để tải lại; tạo lượt/session riêng và giữ lịch sử. Tải video mặc định lần lượt theo danh sách đã đánh số, thứ tự thư mục thêm rồi tên tệp dạng số; vẫn chia mỗi lượt tối đa 15 tập. Chế độ Cuốn chiếu giữ tối đa 15 video đang tải; video xong sẽ lấy video tiếp theo mà không chờ cả nhóm. Tiến trình hiển thị tối đa 15 video đang tải. Thứ tự hoàn tất có thể khác danh sách. Có lỗi thì dừng lấy thêm, giữ các video chưa bắt đầu. Gặp lỗi ở chế độ lần lượt thì dừng trước tập tiếp theo. Ô chọn hồ sơ cập nhật khi dữ liệu đến chậm hoặc danh sách thay đổi, giữ lựa chọn, không tự mở Chrome; thiếu hồ sơ trên máy thì hướng dẫn tải từ Cloud. Version 1.3.5.


## Sắp xếp vị trí hồ sơ trong bảng — 1.3.5

- Vào Hồ sơ, chọn “Thứ tự tùy chỉnh”; giữ tay nắm sáu chấm cạnh số thứ tự rồi kéo lên/xuống. Vạch màu cho biết vị trí thả.
- Hoặc đặt con trỏ bàn phím vào tay nắm và nhấn Alt + mũi tên lên/xuống.
- Lưu tự động theo từng tài khoản trên máy hiện tại, dùng lại khi mở app. Hồ sơ mới nằm cuối; hồ sơ ẩn bởi bộ lọc giữ vị trí.
- Chọn “Thứ tự tạo ban đầu”, “Tên A → Z” hoặc “Mới tạo trước” để xem theo cách khác; quay về “Thứ tự tùy chỉnh” để tiếp tục kéo thả.
- Phần này chỉ thay đổi cách hiển thị. Không có migration SQL mới.

Phạm vi xác nhận cho lần sửa này: đã biên dịch cú pháp nguồn và đối chiếu bản đóng gói; chưa chạy thử kéo thả trong Electron thật, chưa chạy thêm kiểm tra chức năng. 195 kiểm tra bảo trì trước đó được giữ nguyên báo cáo và hash nguồn làm mốc lịch sử; không xác nhận thay đổi sắp xếp mới.
