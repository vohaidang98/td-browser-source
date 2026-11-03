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

# TD Browser 1.3.6 — cập nhật

## Thay đổi

- Chia sẻ hồ sơ: danh sách tài khoản đã đăng ký, tìm email, chọn người nhận; đánh dấu Đã chia sẻ và khóa tài khoản chưa sẵn sàng.

- Thêm nhiều thư mục video lần lượt, nạp vào một danh sách chung, giữ lựa chọn cũ; có cột thư mục nguồn và nút gỡ thư mục không xóa tệp. Nhớ thư mục riêng theo từng hồ sơ trên máy.

- YouTube Upload chỉ dùng Google API; bỏ lựa chọn Bản nháp và đường thao tác tải trong Studio.
- Chọn nhiều video vào hàng đợi; app tự chia lượt tối đa 15 video tải đồng thời. Tiến trình chỉ hiện tối đa 15 video của lượt hiện tại, có số lượt và số video còn chờ. Có Gỡ video đã tích và Làm sạch danh sách, không xóa tệp trên máy. Có tiến trình tổng, từng video, Dừng cả lượt và tiếp tục phiên bị gián đoạn.
- Kênh đã liên kết hiện Đã liên kết và ẩn nút liên kết. Admin và người dùng được cấp quyền trên cùng hồ sơ Cloud dùng chung liên kết mã hóa.
- Chọn hồ sơ không mở Chrome. Nút Mở kênh hoặc Liên kết Google mới mở/đưa đúng hồ sơ lên; cửa sổ đã mở được dùng lại.
- Chỉ Admin cấu hình Google API và ngắt liên kết dùng chung. Người dùng được cấp Dùng Flow chỉ liên kết kênh khi chưa có liên kết dùng chung hoặc quyền Google không còn hiệu lực.

## Admin triển khai một lần

1. Vào SQL Editor của dự án Supabase hiện tại, chạy toàn bộ SUPABASE-UPDATE-1.3.6.sql. Tệp có phần phân quyền 1.3.1, cấu hình Admin 1.3.2, liên kết mã hóa từ 1.3.3 và danh sách tài khoản nhận hồ sơ. Không xóa tài khoản, hồ sơ hoặc đặt lại các quyền đã cấp.
2. Đóng hồ sơ Chrome, chờ đồng bộ xong và thoát TD Browser. Cài TD-Browser-Setup-1.3.6.exe từ release-1.3.6.
3. Nếu đã cấu hình Google API dùng chung trong 1.3.2 thì dùng lại. Nếu chưa có, Admin vào Tự động hóa → YouTube Upload → Cấu hình Google API và chọn OAuth Desktop JSON đang có trong D:\Code\TD-Browser.
4. Quản lý người dùng → bật Dùng Flow cho tài khoản cần dùng. Cấp quyền hồ sơ Cloud cho người dùng theo cơ chế chia sẻ hiện có. Admin và người nhận cần khóa mở hồ sơ Cloud; nếu khóa chưa mở, đăng nhập TD bằng mật khẩu hoặc dùng chức năng hỗ trợ khôi phục khóa hiện có.
5. Trong YouTube Upload, chọn hồ sơ. Liên kết Google chỉ xuất hiện khi cần cấp quyền; chọn đúng kênh và xác nhận Google một lần. Liên kết API đã lưu cục bộ từ 1.3.2 sẽ được app đồng bộ mã hóa khi có SQL, mạng và khóa hồ sơ.

Các máy người dùng chỉ cài app và đăng nhập TD; không chạy SQL hoặc nhập OAuth JSON. Cùng hồ sơ Cloud sẽ nhận liên kết trong lần đồng bộ tiếp theo, khoảng 15 giây khi màn hình hoạt động và có mạng.

## Phát hành

Đưa đủ ba tệp cùng lần build lên GitHub Release v1.3.6, đặt Latest: TD-Browser-Setup-1.3.6.exe, TD-Browser-Setup-1.3.6.exe.blockmap, latest.yml. Chưa đăng release hoặc tự cài bằng công việc này.

Xem YOUTUBE-UPLOAD-1.3.6.md, GOOGLE-API-1.3.6.md và KIEM-TRA-1.3.6.md. Chưa thử Google/Supabase thật cho các thay đổi 1.3.6; lần đầu nên dùng video ngắn ở chế độ Riêng tư.

## Chọn người nhận hồ sơ

Bấm Chia sẻ ở hồ sơ → danh sách tài khoản mở ngay → tìm email nếu cần → chọn người nhận → Đồng bộ và chia sẻ. Chủ sở hữu giữ nguyên. Người nhận tải tại Hồ sơ Cloud. Mỗi lần chọn một tài khoản; tài khoản đã được chia sẻ được đánh dấu và không cấp lặp. Không liệt kê tài khoản hiện tại/chủ sở hữu, tài khoản bị khóa. Tài khoản chưa sẵn sàng được hiển thị nhưng không chọn được. Danh sách tải 50 tài khoản một lần, có Xem thêm.

Nếu đã chạy SQL 1.3.3 trước lần bổ sung danh sách người nhận, Admin chạy thêm SUPABASE-SHARE-RECIPIENTS-1.3.6.sql một lần trên Supabase SQL Editor. Máy người dùng không chạy SQL. Admin có đường đọc tương thích qua RPC Admin cũ nếu chưa chạy SQL mới; người dùng thường cần SQL mới và công tắc cho phép chia sẻ. RPC mới kiểm tra quyền hồ sơ, chỉ cho chủ hồ sơ/Admin xem danh sách, không gửi khóa mã hóa hay thông tin quản trị về giao diện.

## Đồng bộ trước khi chia sẻ

Nút Đồng bộ và chia sẻ giữ hộp thoại mở, khóa nút trong khi xử lý và báo lỗi ngay trong hộp thoại. Nếu có bản cục bộ của hồ sơ trên tài khoản hiện tại, app giữ khóa Cloud, đóng gói/mã hóa/tải bản dữ liệu mới rồi mới cấp quyền người nhận. Đồng bộ thất bại thì chưa cấp quyền. Cần đóng hồ sơ và đợi tác vụ/đồng bộ đang chạy hoàn tất; app không tự đóng trình duyệt. Bản cục bộ có revision khác Cloud bị chặn để tránh ghi đè bản mới của máy khác; tải bản mới nhất trước khi thử lại.

Nếu Admin chia sẻ hồ sơ chỉ có trên Cloud, app kiểm tra bản Cloud đã hoàn chỉnh và chia sẻ bản mới nhất đang có; không thể lấy dữ liệu chưa được tải lên từ máy người dùng khác. Hồ sơ mới chỉ có metadata chưa có dữ liệu phải được máy đang giữ dữ liệu đồng bộ trước. Người nhận vẫn vào Hồ sơ Cloud → Tải về / mở một lần. Chức năng đồng bộ trước chia sẻ dùng khóa/publish RPC hiện có, không yêu cầu SQL bổ sung ngoài SQL danh sách người nhận ở trên.

## Bảo trì và màn hình mặc định

Mỗi lần bấm Tự động hóa, YouTube Upload mở đầu tiên và cuộn về đầu trang. Ô chọn hồ sơ cập nhật sau khi danh sách tải về, giữ hồ sơ đang chọn khi làm mới. Nếu chưa có hồ sơ trên máy, thêm ở mục Hồ sơ hoặc tải từ Hồ sơ Cloud. Tiến trình tải đang chạy được giữ. Mục Kiếm tiền (BKT) đã được bỏ. Video đã tải vẫn chọn được để tải lại thành video mới; app giữ lịch sử và tách riêng phiên tải mới. Tải video qua Google API. Mặc định tải lần lượt theo danh sách đã đánh số; thứ tự thư mục được thêm trước rồi tên tệp (1, 2, 3… 10). Mỗi lượt tối đa 15 tập; chọn nhiều video sẽ chia lượt tự động. Cuốn chiếu tự bổ sung video tiếp theo vào chỗ trống, tối đa 15 video đang tải; không chờ hoàn tất cả nhóm và không bảo đảm thứ tự hoàn tất. Có lỗi thì ngừng lấy thêm video, chờ các video đã chạy kết thúc. Nếu một tập lỗi ở chế độ lần lượt, app dừng trước các tập còn lại. YouTube có thể hiển thị video mới nhất trước, theo kiểu sắp xếp của Studio. API này không có trường bật/tắt kiếm tiền: https://developers.google.com/youtube/v3/docs/videos

Đã sửa các nhánh khởi động Chrome/CDP/múi giờ và chạy kiểm tra hồi quy riêng. Cần xác nhận trên Chrome thực tế sau cài; xem BAO-TRI-1.3.6.md và KIEM-TRA-1.3.6.md.

## Nâng từ 1.3.3/1.3.4 lên 1.3.6

Nếu đã chạy đầy đủ SQL 1.3.3 gồm migration danh sách người nhận thì không cần SQL mới cho 1.3.6. Nếu thiếu danh sách người nhận, Admin chỉ chạy SUPABASE-SHARE-RECIPIENTS-1.3.6.sql một lần. Nếu chưa triển khai quyền Flow/API/liên kết dùng chung thì dùng SUPABASE-UPDATE-1.3.6.sql đầy đủ. Các migration giữ nguyên tên/định nghĩa và chạy lại an toàn; không đặt lại dữ liệu/quyền hiện có. Máy người dùng chỉ cập nhật app.


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
