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

# Phạm vi kiểm tra — 1.3.6

Theo yêu cầu kiểm tra và bảo trì của người dùng, đã chạy 195 kiểm tra hồi quy riêng cho Proxy, múi giờ/CDP, vòng đời Chrome, service/API/MCP, đồng bộ trước chia sẻ và giao diện chọn người nhận/tab mặc định. Tất cả qua. Cloud, Chrome/CDP, IPC và OAuth trong các kiểm tra này dùng mô phỏng; các bộ Proxy dùng server cục bộ. Chi tiết trong maintenance-reports.

Đã kiểm tra kết nối thực tế qua Proxy của hồ sơ được báo lỗi, kết nối thành công tại thời điểm kiểm tra. Thử Chrome riêng bằng thư mục tạm bị môi trường chặn mở tiến trình (spawn EPERM); không mở hồ sơ khách hàng. Chưa xác nhận app/Chrome thật đã hết lỗi.

281 kiểm tra cũ được giữ làm mốc lịch sử, không dùng làm bằng chứng cho thay đổi mới. Báo cáo mới có hash nguồn riêng.

Chưa thử tải video/OAuth thật, Supabase/RLS/RPC thật, chia sẻ giữa hai máy, hoặc xác nhận trực quan Electron. Migration chưa được chạy trên Supabase. Không gửi video thật trong lần bảo trì.

Đối chiếu hash nguồn giữa staging, project, ZIP và ASAR trích từ bộ cài; kiểm tra phiên bản, dependency, Unicode và metadata cập nhật. Đóng gói không thay thế thử app thật.

Sau cài: thử mở hồ sơ từng báo lỗi; nếu lặp lại, gửi thông báo cùng diagnostics/chrome-startup.json trong thư mục dữ liệu app. Thử chia sẻ hồ sơ đã đóng: đồng bộ xong mới cấp quyền; người nhận tải tại Hồ sơ Cloud. Admin chạy SQL danh sách người nhận một lần nếu chưa chạy. Thử một video ngắn Riêng tư trước khi tải hàng loạt. BKT do bạn tự cài trong Studio.


## Sắp xếp vị trí hồ sơ trong bảng — 1.3.6

- Vào Hồ sơ, chọn “Thứ tự tùy chỉnh”; giữ tay nắm sáu chấm cạnh số thứ tự rồi kéo lên/xuống. Vạch màu cho biết vị trí thả.
- Hoặc đặt con trỏ bàn phím vào tay nắm và nhấn Alt + mũi tên lên/xuống.
- Lưu tự động theo từng tài khoản trên máy hiện tại, dùng lại khi mở app. Hồ sơ mới nằm cuối; hồ sơ ẩn bởi bộ lọc giữ vị trí.
- Chọn “Thứ tự tạo ban đầu”, “Tên A → Z” hoặc “Mới tạo trước” để xem theo cách khác; quay về “Thứ tự tùy chỉnh” để tiếp tục kéo thả.
- Phần này chỉ thay đổi cách hiển thị. Không có migration SQL mới.

Phạm vi xác nhận cho lần sửa này: đã biên dịch cú pháp nguồn và đối chiếu bản đóng gói; chưa chạy thử kéo thả trong Electron thật, chưa chạy thêm kiểm tra chức năng. 195 kiểm tra bảo trì trước đó được giữ nguyên báo cáo và hash nguồn làm mốc lịch sử; không xác nhận thay đổi sắp xếp mới.


## Bản tải độc lập và khóa thiết bị — 1.3.6

- Trong Hồ sơ Cloud hoặc Hồ sơ người dùng, “Tải bản độc lập” lấy dữ liệu của phiên bản Cloud tại lúc bấm tải. Cookie, đăng nhập, cấu hình và proxy được sao chép sang một mã hồ sơ riêng trên máy.
- Bản tải có nhãn “Bản tải”, không giành khóa mở Cloud, không kéo dữ liệu Cloud mới, không tự đăng ký/đẩy dữ liệu lên Cloud. Hai máy đã tải có thể mở cùng nguồn hồ sơ đồng thời. Việc website chấp nhận các phiên đăng nhập đồng thời còn do website quyết định.
- Bấm tải lại khi bản độc lập còn tồn tại sẽ dùng bản đã có, không ghi đè. Muốn dữ liệu mới, đóng và xóa bản ở tab Hồ sơ (không xóa nguồn Cloud), rồi tải lại.
- Hồ sơ liên kết Cloud đã có từ bản cũ giữ chế độ hiện tại. Bấm nút ⇩ cạnh nút Cloud để chuyển dữ liệu trên máy thành bản độc lập, hoặc chọn chuyển khi mở gặp lỗi khóa. Chuyển giữ nguyên thư mục, tên và ID trên máy, không đụng bản Cloud hoặc khóa của máy khác.
- Sau khi chuyển, thay đổi cookie/đăng nhập nằm riêng trên máy. Bản đã tải không bị xóa theo việc thu hồi chia sẻ nguồn Cloud; tài khoản TD vẫn phải đăng nhập và dùng hồ sơ thuộc tài khoản của mình.
- Liên kết kênh YouTube API vẫn dùng nguồn Cloud để kiểm tra quyền và dùng chung OAuth; đây là liên kết API, không đồng bộ dữ liệu trình duyệt của bản tải. Nếu quyền nguồn bị thu hồi, API dùng chung có thể không dùng được.
- Hồ sơ vẫn đồng bộ Cloud giữ một mã khóa cố định theo thư mục dữ liệu trên máy, thay cho mã ngẫu nhiên mỗi lần mở app. Nhờ đó khởi động lại có thể nhận lại khóa của chính máy. Khóa từ bản cũ trước 1.3.6 chưa có mã đã lưu thì không thể tự nhận lại: dùng bản độc lập hoặc đợi khóa cũ hết hạn (tối đa 2 giờ). Không tự xóa khóa máy khác.
- Không cần SQL mới. Cập nhật cả hai máy lên 1.3.6; không tự chuyển toàn bộ dữ liệu hiện có.

Phạm vi lần này: đã biên dịch cú pháp 28 script và đối chiếu nội dung đóng gói. Chưa chạy thử app/Chrome trên hai máy, chưa tải hồ sơ Cloud thật hoặc thử OAuth thật. 195 kiểm tra trước ở bản 1.3.5 được lưu làm báo cáo lịch sử, không xác nhận chức năng bản tải mới.
