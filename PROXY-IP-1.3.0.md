# Proxy và IP trong TD Browser 1.3.0

## Thiết lập

1. Bấm proxy của hồ sơ, chọn đúng **HTTP**, **HTTPS** hoặc **SOCKS5** theo nhà cung cấp.
2. Nhập Host/cổng và tài khoản/mật khẩu. Có thể dán URL như `socks5://user:password@host:1080`; IPv6 dùng dấu ngoặc vuông trong URL.
3. Bấm **Test Proxy** để xem IP thoát, múi giờ, ISP và thời gian phản hồi.
4. Chọn **Tự lấy theo IP thoát khi mở hồ sơ**; chỉ chọn **Thủ công** nếu cần chỉ định múi giờ như `Asia/Ho_Chi_Minh`.
5. Lưu cấu hình. Đóng hồ sơ trước khi sửa proxy hoặc múi giờ.

Host/cổng là máy chủ kết nối; IP thoát là địa chỉ website nhìn thấy. Hai địa chỉ có thể khác nhau. Múi giờ lấy từ IP thoát, không lấy từ địa chỉ Host.

## IP thay đổi sau khi mở lại

Bấm **Kiểm tra IP xoay** để đo hai yêu cầu mới. Nếu chúng khác nhau, proxy có thể xoay theo kết nối. Hai kết quả giống nhau cũng không đảm bảo IP cố định lâu dài.

TD không thể khóa IP của một proxy xoay. Muốn giữ IP, dùng proxy cố định hoặc thông tin phiên sticky từ nhà cung cấp. Không bật xoay IP tùy ý giữa phiên đăng nhập.

## Kết quả và lỗi

- Thời gian ms là thời gian yêu cầu kiểm tra, không phải ping ICMP hoặc tốc độ tải xuống.
- Kiểm tra nền dùng cache tối đa 120 giây; bấm Test hoặc mở hồ sơ sẽ kiểm tra mới.
- Lỗi xác thực: kiểm tra tài khoản, mật khẩu và whitelist IP bên nhà cung cấp.
- Lỗi DNS/cổng/timeout: kiểm tra Host, giao thức, cổng và tình trạng proxy.
- Lỗi TLS: kiểm tra chứng chỉ proxy HTTPS và giờ máy; TD không tắt xác minh chứng chỉ.
- Có IP nhưng chưa có múi giờ: thử lại hoặc chọn múi giờ thủ công hợp lệ. TD không tự điền New York.

Dịch vụ geo dùng [ipwho.is qua HTTPS](https://ipwhois.io/documentation), có giới hạn và không đảm bảo luôn hoạt động. Khi geo không phản hồi, app thử lấy riêng IP qua HTTPS bằng cùng tuyến proxy. Đây không phải chuyển sang mạng trực tiếp.

Muốn bỏ proxy, chọn **Dùng mạng trực tiếp** rồi lưu. Khi proxy được cấu hình nhưng lỗi, app sẽ báo lỗi thay vì tự dùng IP máy.

Trong API/MCP: `GET /v1/profiles/:id/network`, `POST /v1/profiles/:id/proxy-check` với `{"samples":2}`; tool `td_profile_network`, `td_proxy_check`. Kết quả là phép đo tại thời điểm kiểm tra, không chứng minh mọi kết nối Chrome có cùng IP nếu proxy xoay.

## Thư viện proxy

Vào Proxies → Nhập hàng loạt. Dán tối đa 200 dòng, chọn giao thức mặc định và thẻ, kiểm tra định dạng rồi nhập. Không lưu nếu còn dòng sai; proxy trùng chính xác được bỏ qua.

Chọn tối đa 100 proxy → Kiểm tra đã chọn. App đo tối đa 4 proxy đồng thời, có tiến độ và nút Dừng. Yêu cầu đang chạy sẽ kết thúc trước khi dừng hoàn toàn. Kết quả có thời điểm, không bảo đảm IP xoay giữ nguyên.

Gắn thẻ bằng ô thẻ và nút Gắn thẻ; để trống để gỡ. Tìm theo thẻ, tên, địa chỉ hoặc tài khoản và lọc trạng thái. Tạo/sửa hồ sơ có thể chọn từ kho proxy. Nút xóa kho chỉ xóa bản ghi thư viện, không gỡ cấu hình đang gắn trong hồ sơ.

Múi giờ thủ công có gợi ý tên IANA. Khi mở, TD đọc lại múi giờ JavaScript qua CDP để phát hiện giá trị không khớp. Chưa xác minh phần này trên Chrome thật trong phiên kiểm tra.
