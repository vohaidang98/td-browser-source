# Google API và liên kết dùng chung — 1.3.5

Admin dùng dự án Google hiện có livepilot-510813 và OAuth Desktop JSON đã tải trong D:\Code\TD-Browser. Không sửa OAuth client Web/callback của LiveVPS. Bật YouTube Data API v3, cấp youtube.upload và youtube.readonly. API key riêng không đủ quyền tải video. Nếu OAuth đang Testing, cấu hình danh sách test users theo Google Cloud.

Chỉ Admin được nhập/đổi cấu hình client Desktop dùng chung: kiểm tra ở UI, native IPC, service và RPC Supabase. Tham số client Desktop được phân phối cho app có quyền Flow; không đưa OAuth client Web hoặc service account vào đây. Các access/refresh token của kênh được mã hóa bằng AES-256-GCM với khóa HKDF-SHA256 dẫn xuất từ khóa hồ sơ Cloud, ràng buộc thêm profile/client/channel bằng AAD. Chỉ tài khoản có quyền hồ sơ và có phong bì khóa RSA riêng mới mở được token. Server lưu ciphertext, IV, tag, client/channel ID và revision, không lưu token rõ. Direct table access bị thu hồi; RPC kiểm tra quyền Flow và quyền hồ sơ, cập nhật có kiểm tra revision.

Admin hoặc người dùng được cấp quyền liên kết Google một lần cho cùng hồ sơ Cloud. Chrome của đúng hồ sơ dùng cookie/proxy hiện có; cửa sổ mở được dùng lại. OAuth có PKCE, random state, callback loopback một lần. Callback riêng này được chuyển về app qua CDP; không thay đổi bypass/proxy của Chrome nói chung. Kênh đã có liên kết sẽ lấy lại bản mã hóa từ Supabase và không mở lại Google để xin quyền. Token hết hiệu lực thực sự mới yêu cầu xác nhận lại.

Google API chỉ có private/unlisted/public, không có draft của Studio. 1.3.5 chỉ dùng API; chọn Riêng tư để kiểm tra video trước khi tự công khai. Chia lượt tối đa 15 video, tải lần lượt mặc định hoặc đồng thời khi chọn, mỗi video có phiên resumable riêng. Mỗi phần tối đa 1 MB; HTTP tái sử dụng kết nối qua proxy đã chọn và được đóng khi xong. Không tự chuyển sang mạng trực tiếp khi proxy lỗi.

Đổi client ID của Admin yêu cầu cấp quyền Google lại. Không đổi cấu hình giữa lượt tải. Nếu Google400 ở màn hình đăng nhập/cấp quyền, đóng tab lỗi và bắt đầu phiên liên kết mới; nguyên nhân lỗi 400 trong ảnh chưa được xác minh đã khắc phục. Chưa thử OAuth, tải 15 video hoặc đồng bộ token trên hai tài khoản thật.

Triển khai bằng SUPABASE-UPDATE-1.3.5.sql một lần. Nếu Google API chung đã cấu hình trong 1.3.2 thì giữ lại; app tự đồng bộ các liên kết API cục bộ khi hồ sơ được đăng ký Cloud, có quyền và khóa mở. Hồ sơ chưa chia sẻ cho người nhận không cấp quyền Google cho người đó.

Tài liệu: [Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol), [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert).
