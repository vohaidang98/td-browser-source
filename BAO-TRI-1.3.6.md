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

# Bảo trì TD Browser 1.3.6

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

195 kiểm tra hồi quy qua. Kiểm tra Proxy thực tế qua. Chrome riêng bị chặn spawn EPERM; chưa thử hồ sơ khách hàng thật, Google và Supabase thật. Xem KIEM-TRA-1.3.6.md và maintenance-reports.

## Thoát app và tải lại video

Đóng cửa sổ bắt đầu dừng tác vụ, đóng Chrome có kiểm soát rồi chờ đồng bộ. Cửa sổ được giữ với số hồ sơ/tác vụ còn lại; mở biểu tượng app lần nữa sẽ hiện lại cửa sổ. Khi cần Thoát ngay, app hỏi xác nhận gián đoạn và chỉ dừng Chrome do TD đang quản lý. Cài cập nhật từ app sẽ đợi tiến trình TD kết thúc trước khi mở bộ cài. Mạng/đồng bộ lâu vẫn phải chờ hoặc chủ động Thoát ngay; chưa kiểm tra trên Electron/Windows thật.

Video đã tải không tự được tích để tránh gửi trùng ngoài ý muốn; bạn tự tích hoặc Chọn tất cả rồi bấm Bắt đầu. Mỗi lần tải lại có mã lượt/phiên riêng; giữ nhật ký lần trước và hỗ trợ tiếp tục phiên mới bị gián đoạn. Chọn lại thư mục đã có sẽ quét lại danh sách.

## Các yêu cầu hoàn thiện cùng bản này

Chia sẻ có danh sách tài khoản và tự đồng bộ dữ liệu cục bộ trước cấp quyền. Mỗi lần vào Tự động hóa mở YouTube Upload và cuộn về đầu trang, giữ tiến trình tải. Bỏ mục BKT; tải video vẫn dùng API. Video đã tải có thể chọn để tải lại; tạo lượt/session riêng và giữ lịch sử. Tải video mặc định lần lượt theo danh sách đã đánh số, thứ tự thư mục thêm rồi tên tệp dạng số; vẫn chia mỗi lượt tối đa 15 tập. Chế độ Cuốn chiếu giữ tối đa 15 video đang tải; video xong sẽ lấy video tiếp theo mà không chờ cả nhóm. Tiến trình hiển thị tối đa 15 video đang tải. Thứ tự hoàn tất có thể khác danh sách. Có lỗi thì dừng lấy thêm, giữ các video chưa bắt đầu. Gặp lỗi ở chế độ lần lượt thì dừng trước tập tiếp theo. Ô chọn hồ sơ cập nhật khi dữ liệu đến chậm hoặc danh sách thay đổi, giữ lựa chọn, không tự mở Chrome; thiếu hồ sơ trên máy thì hướng dẫn tải từ Cloud. Version 1.3.6.


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
