# TD Browser 1.4.0 - cập nhật LAN và kích hoạt

- Cập nhật: app đọc `version.json` trong thư mục cập nhật trên mạng LAN (hỏi chọn thư mục ở lần kiểm tra đầu tiên, lưu ở
  `%APPDATA%\td-browser\update.json`). File cài đặt được kiểm tra SHA-256 rồi mới cài (dùng luồng "Cài đặt cập nhật" sẵn có).
  Không còn dùng GitHub Releases/electron-updater.
- Kích hoạt: chưa nhập đúng mã thì không vào được app (hộp nhập mã, chữ hiện dấu chấm). Trong code chỉ có mã băm PBKDF2
  (`licensing.js`). Tạo mã băm mới: `node tools/make-hash.js`.
- Chỉ cho tài khoản quản trị quyền GHI vào thư mục chia sẻ (ai ghi được là đẩy được chương trình tới mọi máy).

## Phát hành bản mới

1. Tăng `version` trong `package.json`.
2. `npx electron-builder --win --x64 --publish never` (ra `dist/TD-Browser-Setup-<phiên bản>.exe`).
3. `node tools/make-release.js dist/TD-Browser-Setup-<phiên bản>.exe <phiên bản> D:\Code\CAP_NHAT\TD-Browser "ghi chú"`.
4. Thư mục `D:\Code\CAP_NHAT` được chia sẻ mạng (máy khác chỉ đọc). Ghi đè 2 file là xong.
