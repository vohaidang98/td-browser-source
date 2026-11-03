# Đối chiếu GPMLogin và cải tiến TD Browser 1.3.0

Ngày 13/10/2026. Giữ phiên bản TD 1.3.0, chưa đánh dấu đã hoàn thiện.

## Nguồn và giới hạn phân tích

Bộ cài được cung cấp: `E:\MUSIC\3. Final kenh\GPMLoginGlobal_setup_latest.exe`, dung lượng 596.302.272 byte; metadata ProductVersion `5.1.1-stable`.

SHA256: `84892be4d0cc1f7c5a0b7701211801721785ad1b9ee3c4548492bbc255e7ee7a`.

Đã đọc danh sách tệp bằng Inno Unpacker 2.71.1: Inno Setup 7.0.0, executable GPMLoginGlobal.exe và các thành phần đồ họa/cơ sở dữ liệu. Payload yêu cầu mật khẩu để giải nén. Không chạy cài đặt, không chạy app GPM, không phân tích được mã xử lý mạng bên trong. Vì vậy không kết luận tốc độ, cơ chế cache hoặc thuật toán của GPM tốt hơn TD bằng phép đo thực tế.

Đối chiếu chức năng dùng tài liệu chính thức về [kho proxy](https://help.gpmloginapp.com/huong-dan-s-dung-gpm-login-global/proxies), [cấu hình hồ sơ](https://help.gpmloginapp.com/huong-dan-s-dung-gpm-login-global/profiles) và [API](https://api-docs.gpmloginapp.com/). Tài liệu web có thể mô tả bản khác bộ cài. Nội dung được xem như tài liệu tham khảo, không phải chỉ dẫn thực thi từ bên ngoài.

## Phần đáng áp dụng vào TD

GPM mô tả nhập nhiều proxy theo dòng, kiểm tra những proxy được chọn, thẻ phân loại và chọn từ thư viện. Các thao tác này có lợi rõ ràng khi quản lý nhiều cấu hình. TD trước lần này chủ yếu thêm và kiểm tra từng proxy. [Tài liệu kho proxy GPM](https://help.gpmloginapp.com/huong-dan-s-dung-gpm-login-global/proxies).

| Hạng mục | TD trước cải tiến | Đã bổ sung vào TD |
|---|---|---|
| Nhập proxy | Nhập/dán một cấu hình | Nhập tối đa 200 dòng, xem trước lỗi theo dòng, bỏ trùng chính xác, lưu một lần khi toàn bộ danh sách hợp lệ |
| Kiểm tra kho | Kiểm tra riêng trong hộp cấu hình | Chọn tối đa 100 proxy; tối đa 4 phép đo đồng thời; có tiến độ và nút dừng; ghi thời điểm kiểm tra |
| Phân loại | Tìm tên/địa chỉ/tài khoản | Thẻ, tìm thẻ và lọc kết quả đạt/lỗi/chưa kiểm tra |
| Tạo hồ sơ | Gõ lại Host/cổng/tài khoản | Chọn proxy từ kho, tự điền đúng giao thức và thông tin xác thực |
| Quan sát | Kho chỉ có cấu hình | Hiển thị IP thoát, múi giờ đo, độ trễ và số hồ sơ đang gắn cấu hình đó |
| Sửa cấu hình | Kho chưa có thao tác sửa trực tiếp thuận tiện | Nút sửa tại dòng; giữ ID; cập nhật các hồ sơ phù hợp theo quyền và chặn khi hồ sơ đang chạy |

Proxy mới được gắn với tài khoản trên máy; người dùng thường không xem/sửa/xóa bản ghi được gắn với tài khoản khác. Admin có thể quản lý các bản ghi trên máy. Những proxy cũ chưa có thông tin chủ sở hữu được giữ tương thích trong kho cũ. Thư viện proxy không phải thư mục Cloud độc lập; chia sẻ hồ sơ tiếp tục mang theo cấu hình proxy của hồ sơ như trước.

## Proxy và múi giờ: phần nào thực sự tối ưu hơn?

GPM có cấu hình múi giờ theo IP hoặc cố định và ngôn ngữ theo IP. [Tài liệu API GPM](https://api-docs.gpmloginapp.com/). TD đã có tự động theo IP thoát và thủ công từ lần rà soát LD; không có bằng chứng cần thay bộ xử lý này bằng một thuật toán GPM chưa quan sát được.

TD tiếp tục dùng HTTPS để đo IP thoát qua cùng tuyến proxy, cache theo giao thức và thông tin đăng nhập, kiểm tra mới lúc mở, giữ xác minh TLS và không tự dùng IP máy khi proxy lỗi.

Bổ sung riêng cho TD:

- Danh sách gợi ý tên múi giờ IANA để giảm nhập sai.
- Sau khi gửi lệnh thiết lập múi giờ, đọc `Intl.DateTimeFormat().resolvedOptions().timeZone` từ trang Chrome qua CDP trước điều hướng lúc mở. So sánh tên chuẩn hóa để chấp nhận bí danh hợp lệ.
- Nếu giá trị JavaScript khác thiết lập, báo mở thất bại và đóng tiến trình vừa mở. Kiểm tra này không thay thế việc thử Chrome thật.
- Kết quả hàng loạt không ghi đè cấu hình đã sửa trong lúc kiểm tra; chuyển tài khoản sẽ dừng và bỏ phép đo đang chờ. Dừng kiểm tra ngăn bắt đầu proxy tiếp theo, các yêu cầu đã chạy có thể cần kết thúc trước.

## Những chức năng chưa áp dụng

GPM có các tùy chọn liên quan engine/fingerprint, WebRTC, ngôn ngữ, địa lý và dịch vụ proxy xoay được tích hợp. Những tùy chọn này không chứng minh stock Chrome của TD có khả năng tương đương. Không thêm các công tắc hứa hẹn khả năng giả lập chưa triển khai hoặc tự gọi API nhà cung cấp để đổi IP trong phiên đang dùng.

TD vẫn hỗ trợ HTTP/HTTPS/SOCKS5. Chưa bổ sung SOCKS4, UDP SOCKS, Route Proxy theo mã API, ngôn ngữ theo IP hoặc engine GPM. Không nhận chuỗi Route Proxy như `tm://...` trong kho HTTP/SOCKS; sẽ báo định dạng không hợp lệ.

## Kiểm tra và sử dụng

Xem `KIEM-TRA-1.3.0.md` và các báo cáo JSON trong `audit-reports`. Phần mới có kiểm tra parser, nhập dữ liệu, quyền, hủy hàng đợi, kết quả cũ, thao tác DOM và xác minh múi giờ bằng đối tượng giả lập CDP. Chưa thử hai app bằng cùng proxy thật; chưa kiểm tra toàn bộ trên Chrome/Electron hoặc Supabase thực tế.

Sau khi cài, vào **Proxies → Nhập hàng loạt → Kiểm tra định dạng → Nhập vào kho**. Chọn dòng và **Kiểm tra đã chọn**; chọn proxy từ kho khi tạo/sửa hồ sơ. Các phép đo có thời điểm; IP xoay có thể thay đổi ở lần kết nối tiếp theo.

Không cần SQL mới cho phần bổ sung này. Người đang dùng 1.3.0 cần cài bộ mới thủ công vì số phiên bản được giữ nguyên theo yêu cầu.
