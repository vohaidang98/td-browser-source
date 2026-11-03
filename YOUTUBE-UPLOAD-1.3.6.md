# YouTube Upload — TD Browser 1.3.6

1. Vào Tự động hóa → YouTube Upload, chọn hồ sơ cần dùng. Chọn trong danh sách không mở Chrome.
2. Nếu đã có liên kết dùng chung, app hiện Đã liên kết và ẩn nút liên kết. Nếu chưa có, bấm Liên kết Google, chọn đúng kênh trong Chrome của hồ sơ và xác nhận quyền.
3. Bấm **+ Thêm thư mục**, chọn thư mục video bằng hộp thoại Windows. Video tự nạp vào danh sách chung. Bấm lại để thêm thư mục khác; các thư mục và video đã chọn được giữ lại, không thêm trùng cùng đường dẫn. Cột Thư mục nguồn phân biệt các tệp trùng tên. Nút × gỡ thư mục khỏi danh sách, không xóa tệp. Danh sách thư mục và chế độ hiển thị được nhớ riêng theo hồ sơ/tài khoản trên máy. Có thể nạp video trước khi liên kết Google; cần liên kết hợp lệ để bắt đầu tải. Tối đa 100 thư mục được cấp quyền và 1.000 video trong danh sách. Không tự quét thư mục con; muốn lấy video ở thư mục con, thêm riêng thư mục đó. Tiêu đề lấy từ tên tệp bỏ phần mở rộng, tối đa 100 ký tự. Không thêm thumbnail, mô tả hay Google Sheet. Video không dành cho trẻ em theo lựa chọn đã xác nhận.
4. Chọn Riêng tư, Không công khai hoặc Công khai; mặc định Riêng tư. Bản nháp đã bỏ. Mọi video trong một lượt dùng cùng chế độ.
5. Tích video muốn tải hoặc bấm **Chọn tất cả video**, rồi **Bắt đầu tải video**. Có thể chọn tối đa 1.000 video. **Cuốn chiếu, tối đa 15 video** lấy tối đa 15 video đầu theo danh sách; một video hoàn tất thì lấy ngay video tiếp theo vào chỗ trống, không chờ cả nhóm. Khi danh sách còn ít hơn 15 video sẽ tải số video còn lại. Thứ tự hoàn tất có thể khác tên tệp. **Lần lượt theo danh sách** là lựa chọn mặc định hiện có, tải từng video để giữ thứ tự hoàn tất. Video đã tải vẫn chọn được để tải lại thành video mới; mỗi lần tải lại có phiên riêng và giữ nhật ký cũ.

## Theo dõi

Ở chế độ cuốn chiếu, panel chỉ hiện tối đa 15 video đang tải, số đang tải/15 và số video còn chờ. Video hoàn tất rời panel để video mới vào. Chế độ lần lượt tiếp tục hiển thị theo lượt. Phần trăm/dung lượng tổng tính cho toàn bộ hàng đợi đã chọn. Panel hiển thị phần trăm/dung lượng tổng được Google xác nhận nhận, số video xác nhận lưu và từng video với phần trăm/trạng thái/lỗi. Dữ liệu đã nhận 100% chưa đồng nghĩa Google đã xác nhận lưu video; chỉ mục Đã lưu mới được tính hoàn tất. Ở chế độ cuốn chiếu, một video lỗi ngừng lấy thêm video nhưng không tự ngắt những video khác đang tải; chế độ lần lượt dừng trước video tiếp theo.

Dừng cả lượt ngắt các yêu cầu đang chạy và dừng hàng đợi, không khởi chạy các lượt tiếp theo. Phiên còn hiệu lực được giữ mã hóa trên máy và đánh dấu Có thể tiếp tục. Chọn lại đúng tệp, hồ sơ, kênh và chế độ để tiếp tục. Không tự tạo phiên khác nếu Google báo hết hạn hoặc kết quả không rõ; kiểm tra Studio để tránh tải trùng. Mỗi video có thời hạn mặc định 180 phút; thời hạn toàn tác vụ được tính theo số video và chế độ tải để tránh ngắt hàng đợi nhiều video sau 360 phút. Quota Google, hạn mức kênh, tốc độ mạng và giới hạn kết nối proxy vẫn áp dụng. Có thể chọn ít hơn 15 video khi cần.

## Liên kết chung

Liên kết dùng chung theo cùng cloudProfileId và cùng OAuth client do Admin cấu hình. Admin/người dùng có quyền truy cập hồ sơ nhận cùng liên kết; các hồ sơ Cloud khác nhau không tự nhận quyền kênh của nhau. Máy nhận cần mở khóa hồ sơ và kết nối mạng. Token Google được mã hóa bằng khóa dẫn xuất từ khóa hồ sơ, không gửi dạng đọc được lên Supabase. Liên kết trước đây qua Studio không thay thế OAuth API; OAuth API đã có ở 1.3.2 được chuyển sang liên kết chung khi đồng bộ được.

Admin ngắt liên kết dùng chung sẽ làm app gỡ liên kết khỏi các tài khoản nhận sau khi đồng bộ. Thao tác này không gọi Google thu hồi token hay xóa video đã gửi. Muốn thu hồi Google grant thực tế, dùng phần bảo mật tài khoản Google. Google hết hiệu lực/revoked sẽ hiện cần xác nhận quyền và cho phép liên kết lại.

Nhật ký video/phiên tải vẫn lưu riêng theo tài khoản TD trên máy. Không chạy cùng bộ tệp trên nhiều máy nếu không muốn có bản tải trùng. Đổi tên/sửa tệp tạo nhận dạng mới; app không so sánh nội dung toàn bộ video. Đường tải API không cần đóng/mở Chrome hoặc đồng bộ dữ liệu Chrome sau từng video.

Tài liệu: [YouTube upload](https://support.google.com/youtube/answer/57407?hl=vi&co=GENIE.Platform%3DDesktop), [API visibility](https://developers.google.com/youtube/v3/docs/videos#status.privacyStatus).

## Dọn danh sách

- **Gỡ video đã tích**: bỏ các video được tích khỏi danh sách tải, giữ thư mục và các video còn lại. Các mục đã gỡ được nhớ riêng theo hồ sơ trên máy.
- **Làm sạch danh sách**: bỏ toàn bộ video và thư mục đã thêm khỏi danh sách của hồ sơ hiện tại.
- Hai thao tác không xóa tệp trên ổ đĩa, không xóa video trên YouTube và không xóa nhật ký tải. Các nút bị khóa khi hồ sơ đang tải.
- **Quét lại** khôi phục các mục đã gỡ còn tồn tại trong những thư mục đang thêm; video đã tải vẫn được đánh dấu và không tự tải trùng. Sau khi làm sạch, thêm lại thư mục để nạp lại.

## Bảo trì và màn hình mặc định

Mỗi lần bấm Tự động hóa, YouTube Upload mở đầu tiên và cuộn về đầu trang. Ô chọn hồ sơ cập nhật sau khi danh sách tải về, giữ hồ sơ đang chọn khi làm mới. Nếu chưa có hồ sơ trên máy, thêm ở mục Hồ sơ hoặc tải từ Hồ sơ Cloud. Tiến trình tải đang chạy được giữ. Mục Kiếm tiền (BKT) đã được bỏ. Video đã tải vẫn chọn được để tải lại thành video mới; app giữ lịch sử và tách riêng phiên tải mới. Tải video qua Google API. Mặc định tải lần lượt theo danh sách đã đánh số; thứ tự thư mục được thêm trước rồi tên tệp (1, 2, 3… 10). Mỗi lượt tối đa 15 tập; chọn nhiều video sẽ chia lượt tự động. Cuốn chiếu tự bổ sung video tiếp theo vào chỗ trống, tối đa 15 video đang tải; không chờ hoàn tất cả nhóm và không bảo đảm thứ tự hoàn tất. Có lỗi thì ngừng lấy thêm video, chờ các video đã chạy kết thúc. Nếu một tập lỗi ở chế độ lần lượt, app dừng trước các tập còn lại. YouTube có thể hiển thị video mới nhất trước, theo kiểu sắp xếp của Studio. API này không có trường bật/tắt kiếm tiền: https://developers.google.com/youtube/v3/docs/videos

Đã sửa các nhánh khởi động Chrome/CDP/múi giờ và chạy kiểm tra hồi quy riêng. Cần xác nhận trên Chrome thực tế sau cài; xem BAO-TRI-1.3.6.md và KIEM-TRA-1.3.6.md.


Bản tải độc lập ở 1.3.6 dùng cùng danh tính nguồn Cloud cho liên kết YouTube API khi tài khoản vẫn được cấp quyền. Không tạo hồ sơ Cloud mới, không đẩy cookie hoặc dữ liệu trình duyệt của bản tải lên Cloud.
