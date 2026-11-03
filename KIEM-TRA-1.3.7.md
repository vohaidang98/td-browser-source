> Chế độ tạm thời 22/10/2026: app mở thẳng không cần đăng nhập. Supabase và quản lý/xóa từ xa tạm dừng. Cơ chế đăng nhập vẫn được giữ để bật lại ở bản sau. Các mô tả tài khoản bên dưới chỉ áp dụng khi bật lại chế độ tài khoản. Xem BAO-TRI-1.3.7.md.

# Kiểm tra TD Browser 1.3.7

Đạt 225 kiểm tra, 0 lỗi, 13 nhóm. Nguồn được biên dịch kiểm tra cú pháp: 29 script.

- app-quit: 6 kiểm tra. Actual manager lifecycle module and startup callback, Electron/Cloud/window/process calls mocked; no customer process ended.
- backend: 58 kiểm tra. Real TD service/HTTP/official MCP SDK; browser, auth, cloud and safeStorage are test doubles
- default-tab: 6 kiểm tra. Actual automation and upload navigation DOM in jsdom; IPC/state mocked. No real browser launch.
- lifecycle: 38 kiểm tra. Actual main profile/pool functions; Chrome spawn, CDP timezone application, cloud and network probe are mocked. No real profile touched.
- local-admin: 19 kiểm tra. Actual local inventory and Admin deletion controller with isolated browser file fixtures, mocked Supabase RPCs; no customer data or live server changed.
- profile-picker: 5 kiểm tra. Actual automation UI and YouTube UI together in jsdom; delayed native state/IPC mocked; no real browser or Cloud.
- profile-runtime-ui: 11 kiểm tra. Full current HTML and frontend scripts in jsdom with IPC doubles; no real account, Chrome or visual layout verification.
- proxy-library: 20 kiểm tra. Actual proxy-library parser, importer, tags, cancellation and persistence; network probes and accounts are test doubles.
- proxy: 32 kiểm tra. Real Node TCP HTTP CONNECT and SOCKS5 routing with synthetic geolocation fixtures; no external or customer network used. Chrome launch remains blocked.
- quit-ui: 3 kiểm tra. Actual shutdown UI in jsdom; native actions mocked; no user app closed.
- timezone: 14 kiểm tra. Actual CDP setup function against protocol double; no real Chrome or JavaScript timezone measured.
- upload-order: 10 kiểm tra. Actual Google uploader, folder scanner and journal; Google HTTP, encryption and browser mocked. No live Google upload.
- upload-queue: 3 kiểm tra. Actual runYouTubeQueue function; Google upload and Cloud/auth callbacks mocked. No real upload.

Các kiểm tra chạy với tệp thử riêng và máy chủ/RPC/Chrome giả lập; bài kiểm tra Proxy dùng TCP/HTTP CONNECT/SOCKS/TLS thực trên loopback. Không mở/đóng Chrome thật của người dùng, không tải YouTube thật, không thay đổi máy chủ Supabase. Các kết quả này không thay thế chạy thử trên máy khách sau khi cài. Báo cáo chi tiết ở maintenance-reports/maintenance-summary.json.

SQL quản lý/xóa hồ sơ không đổi so với Admin Delete 1.3.6/1.3.7 đã cung cấp. Nếu chưa áp dụng cần chạy riêng trong Supabase SQL Editor.
