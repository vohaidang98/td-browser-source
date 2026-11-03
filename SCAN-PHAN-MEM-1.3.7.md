# Chẩn đoán scan — 1.3.7

# Chẩn đoán cảnh báo Phần mềm trên scanbrowser.net

Ảnh người dùng gửi báo đỏ tại Port scan, kèm tên nhiều ứng dụng và cổng 3690. Chưa thực hiện thay đổi riêng để xử lý cảnh báo này; người dùng yêu cầu nêu lý do trước khi sửa. IP/proxy/múi giờ được giữ nguyên trong bản cập nhật này.

## Bằng chứng đã đọc

- Đọc trang `https://scanbrowser.net/vi` và tài nguyên JavaScript công khai, không thực thi bundle tải về.
- Mã kiểm tra dùng RTCPeerConnection với TCP ICE candidate hướng tới 127.0.0.1; suy đoán cổng từ trạng thái/thời gian chờ ICE. Nhánh kiểm tra coi trạng thái `checking` kéo dài khoảng 3 giây là tín hiệu dương tính. Đây không phải xác nhận giao thức của từng ứng dụng.
- API công khai `https://api.scanbrowser.net/api/portscan/ports` trả danh sách: 3389, 5900, 44960, 36912, 55550, 3690, 45001, 9495, 2222, 35353.
- Đọc nội dung tab scan đang mở qua kết nối CDP có sẵn: xác nhận nội dung Port scan giống ảnh. Không bấm Kiểm tra lại, không điều hướng, không sửa kết quả trang.
- Tại lần kiểm tra khi hồ sơ còn mở, TD lắng nghe 127.0.0.1:65033 (cầu nối proxy, xác nhận phản hồi HTTP proxy) và Chrome 127.0.0.1:65036 (CDP). Không có cổng trong danh sách trên đang LISTENING. Sau đó hồ sơ đã đóng, hai cổng này không còn lắng nghe. AnyDesk có cổng 7070, không nằm trong danh sách trên.

## Kết luận có giới hạn

Chưa đủ bằng chứng kết luận TD mở cổng 3690 hoặc các ứng dụng được liệt kê đều đang chạy. Kết quả có thể là suy đoán sai do hành vi WebRTC/thời gian chờ, nhưng chưa tái hiện đối chứng với Chrome thường cùng điều kiện mạng nên chưa kết luận chắc chắn.

Không đóng cầu nối proxy hoặc CDP cần thiết để làm mất cảnh báo: các cổng này phục vụ proxy, áp dụng múi giờ và tự động hóa. API/MCP mặc định tắt, chỉ lắng nghe localhost khi người có quyền bật; phiên bản 1.3.2 bổ sung kiểm tra quyền phía service.

## Đối chứng tiếp theo

So sánh một lần scan mới trong Chrome thường và hồ sơ TD cùng máy/cùng điều kiện, đồng thời ghi trạng thái LISTENING. Nếu xuất hiện cổng thật thuộc TD không cần thiết, sửa vòng đời dịch vụ đó rồi kiểm tra lại proxy, múi giờ và Flow. Chưa thực hiện đối chứng hay đảm bảo mục Phần mềm chuyển xanh.

1.3.7 không thực hiện sửa cảnh báo Port scan/IP/mạng và không xác nhận đã xanh. Thay đổi API transport chỉ tái sử dụng HTTPS qua proxy chọn cho các lượt tải, không sửa cấu hình Chrome/proxy/timezone chung.
