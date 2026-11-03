# TD Browser 1.2.2: tài khoản và hồ sơ Cloud

## Cài đặt trên Supabase

1. Mở đúng project Supabase đang được cấu hình trong `main.js`.
2. Vào **SQL Editor**, chạy toàn bộ file `supabase/migrations/202610120001_accounts_and_cloud_profiles.sql`.
3. Bật **Email provider** trong **Authentication → Providers**. Nếu bật xác nhận email, cấu hình SMTP trước khi gửi cho nhiều người dùng.
4. Mở TD Browser, đăng ký tài khoản của chủ app với mật khẩu ít nhất 9 ký tự và xác nhận email nếu được yêu cầu.
5. Trong SQL Editor, cấp quyền admin cho email chủ app:

   ```sql
   update public.app_users
   set role = 'admin', status = 'active'
   where lower(email) = lower('owner@example.com');
   ```

6. Đăng xuất rồi đăng nhập lại. Hai mục **Quản lý người dùng** và **Hồ sơ người dùng** sẽ xuất hiện ở thanh bên.

Migration tạo bucket private `td-browser-profile-data` với giới hạn 50 MB mỗi object. App chia gói thành các phần 12 MB nên không cần mở bucket public hay đưa `service_role` key vào app.

## Cấp và dùng hồ sơ

- Người dùng đăng ký bằng email. Admin có thể đổi vai trò, khóa/mở tài khoản và bật/tắt quyền chia sẻ giữa các tài khoản.
- Admin luôn có thể chia sẻ và quản lý hồ sơ Cloud. Admin có thể tạo hồ sơ cho email đã đăng ký; hồ sơ sẽ xuất hiện trên máy admin để admin mở Chrome và tự đăng nhập các website cần thiết. Khi đóng Chrome, bản mã hóa được đẩy lên Cloud.
- Người nhận đăng nhập TD Browser, mở **Hồ sơ Cloud**, tải hồ sơ về máy và mở. Chỉ một tài khoản/thiết bị được mở cùng một hồ sơ tại một thời điểm; app dùng khóa thuê có thời hạn để tránh ghi đè đồng thời.
- Hồ sơ mới được đồng bộ tự động nếu khóa Cloud đã mở khóa trong phiên đăng nhập; nếu phiên được khôi phục mà chưa mở khóa, người dùng chọn nút đám mây tại dòng hồ sơ. Hồ sơ cục bộ có từ trước cần được đồng bộ thủ công. Chia sẻ giữa người dùng chỉ hoạt động khi admin bật cài đặt tương ứng.
- Admin mới được thêm sau này cần được cấp khóa cho các hồ sơ cũ. Admin đã có quyền mở hồ sơ vào **Hồ sơ người dùng → Cấp khóa cho admin mới** và chạy thao tác này sau khi thêm admin.

## Chia sẻ hồ sơ và giữ chủ sở hữu

Trong **Hồ sơ người dùng**, admin bấm **Chia sẻ**, nhập email tài khoản đã đăng ký. Người nhận vào **Hồ sơ Cloud → Tải về / mở**. Chủ sở hữu giữ nguyên và tiếp tục sử dụng hồ sơ. Các tài khoản dùng chung hồ sơ Cloud và đồng bộ các thay đổi; mỗi thời điểm chỉ mở trên một thiết bị. Đây là quyền dùng chung, không tạo một bản hồ sơ độc lập.

Chức năng chia sẻ dùng migration 1.2.0. Để gỡ quyền nhận chia sẻ trong bản 1.2.1, chạy thêm `supabase/migrations/202610120002_admin_revoke_profile_share.sql` một lần trên SQL Editor.

## Bảo vệ dữ liệu

Nội dung thư mục Chrome, cấu hình proxy và cookie được đóng gói rồi mã hóa AES-256-GCM trên máy trước khi tải lên. Khóa dữ liệu được bọc bằng RSA-OAEP cho chủ hồ sơ và admin hiện hành. App không gửi mật khẩu Google/website lên Supabase; admin đăng nhập dịch vụ trực tiếp trong Chrome của hồ sơ. Phiên đăng nhập được lưu trong dữ liệu Chrome đã mã hóa, không lưu trong bảng hồ sơ dạng rõ.

Không dùng tính năng này như một kho lưu trữ mật khẩu có thể khôi phục: mật khẩu TD Browser dùng để mở khóa khóa riêng. Ứng dụng hiện chưa có quy trình khôi phục khóa. Nếu đặt lại mật khẩu TD Browser, người dùng có thể mất quyền mở các hồ sơ Cloud đã mã hóa; admin hiện hành vẫn có thể mở các bản mà admin được cấp khóa. Hãy giữ an toàn mật khẩu và bản Chrome cục bộ trước khi đặt lại mật khẩu.

Chrome trên Windows có thể bảo vệ một số cookie/phiên theo tài khoản Windows hoặc thiết bị. Vì vậy, dữ liệu hồ sơ sẽ được chuyển nguyên vẹn nhưng website có thể yêu cầu đăng nhập lại khi chuyển sang máy hoặc tài khoản Windows khác. Các bản Chrome khác phiên bản cũng có thể không dùng chung được thư mục hồ sơ.

## Đóng gói ứng dụng

Trên Windows, trong thư mục dự án chạy:

```powershell
npm ci
npm run build
```

Bộ cài NSIS được tạo trong `dist`. Chạy migration và cấp admin trước khi phát hành cho người dùng.

## Quản lý danh sách của từng người dùng (1.2.1)

- Mở **Quản lý người dùng → Xem hồ sơ** để xem hồ sơ sở hữu và hồ sơ được chia sẻ.
- **Sửa** tải dữ liệu mới nhất, cho sửa tên, ghi chú, User-Agent và proxy, rồi mã hóa và đồng bộ. Nếu có người sửa phiên bản mới trong lúc mở biểu mẫu, app yêu cầu tải lại trước khi lưu.
- **Xóa hồ sơ** ở hồ sơ sở hữu sẽ xóa bản Cloud và thu hồi quyền của mọi người nhận. **Gỡ khỏi tài khoản** ở hồ sơ được chia sẻ chỉ gỡ quyền của người nhận đó. Các máy cần chạy bản 1.2.1 và kết nối mạng để cập nhật danh sách. Máy đang mở hồ sơ cần đóng hồ sơ trước khi sửa/xóa/gỡ quyền.
- Sau khi đăng nhập và mở khóa Cloud, app tự đăng ký danh sách hồ sơ cục bộ rồi lần lượt đồng bộ dữ liệu. Hồ sơ chưa tải xong hiển thị Chờ dữ liệu; có thể đổi tên hoặc xóa, chỉ sửa đầy đủ khi đã tải xong. Hồ sơ chỉ ở máy đang tắt hoặc chưa dùng bản mới chưa thể xuất hiện trong danh sách admin.
- Hồ sơ bị xóa hoặc thu hồi quyền sẽ được gỡ khỏi danh sách cục bộ khi app kết nối hệ thống. Dữ liệu Chrome cũ được giữ trong máy và thông tin hồ sơ được đưa vào thùng rác để khôi phục, không xóa dữ liệu trên ổ đĩa từ xa.

## Báo cáo danh sách tự động (1.2.2)

- Máy người dùng tự gửi danh sách khoảng 30 giây/lần khi app còn chạy, kể cả thu nhỏ. Việc gửi tên hồ sơ/trạng thái độc lập với tải dữ liệu Chrome lớn, không cần mở khóa mật khẩu Cloud để báo cáo danh sách. Các tệp Chrome vẫn dùng luồng mã hóa riêng.
- Tạo/sửa/xóa hồ sơ kích hoạt gửi sớm. Khi có mạng lại, đưa app lên trước hoặc máy thức dậy, app yêu cầu cập nhật ngay. Nếu mạng lỗi, app tự thử lại, không chạy nhiều lần gửi song song.
- Admin vào Quản lý người dùng để xem số hồ sơ trên các máy, thời điểm nhận danh sách, phiên bản và số máy. Trạng thái tự làm mới khoảng 15 giây/lần. Hơn 90 giây không có tín hiệu hoặc đăng xuất được đánh dấu chưa phản hồi; đây là tín hiệu app đã báo cáo gần đây, không khẳng định máy đang hoạt động liên tục.
- Xem hồ sơ cho thấy cả tên hồ sơ cục bộ chưa đăng ký Cloud. Những hồ sơ này chờ đăng ký trước khi quản lý dữ liệu. Thời điểm cập nhật dữ liệu Chrome và thời điểm nhận danh sách là hai thông tin riêng.
- Chạy thêm supabase/migrations/202610120003_profile_catalog_heartbeat.sql trên Supabase. Tệp SUPABASE-UPDATE-1.2.2.sql đi kèm bộ cài gộp cả bước gỡ quyền của 1.2.1 và bước báo cáo mới, có thể chạy lại. Không cần chạy lại migration gốc 1.2.0 nếu đã cài.
- App tắt hoàn toàn, máy ngủ hoặc mất mạng thì chưa gửi được danh sách mới; admin vẫn thấy bản cuối và thời gian nhận. Tài khoản chưa dùng bản mới chưa có báo cáo. Danh sách cục bộ do app gửi, không phải công cụ quản lý tệp trên toàn máy.


# TD Browser 1.2.3 — cài đặt và sử dụng

## 1. Cập nhật Supabase (làm một lần)

1. Mở dự án TD-Browser trên Supabase → SQL Editor → New query.
2. Mở tệp `SUPABASE-UPDATE-1.2.3.sql` đi kèm bộ cài, chép toàn bộ và bấm Run. Tệp gộp migration 002, 003, 004; có thể chạy lại. Dự án phải đã chạy schema gốc 1.2.0 (001) như trước.
3. Vào Authentication → Email Templates (một số giao diện nằm dưới Notifications) → Reset password.
4. Đặt tiêu đề: `Mã xác nhận đặt lại mật khẩu TD Browser`.
5. Thay toàn bộ nội dung mẫu bằng mã HTML trong `RESET-PASSWORD-EMAIL.html`, rồi Save.
6. Mẫu phải chứa đúng `{{ .Token }}` để email có mã OTP. Luồng này nhập mã ngay trong app, không cần máy chủ localhost hay trang callback.
7. Kiểm tra cấu hình gửi email/SMTP của dự án cho các địa chỉ người dùng thực tế. Nếu Supabase báo giới hạn gửi hoặc email không đến, cần cấu hình SMTP của bạn. Không đưa mật khẩu SMTP hoặc service_role vào app.

Tài liệu Supabase: https://supabase.com/docs/guides/auth/auth-email-templates
và https://supabase.com/docs/guides/auth/auth-smtp

## 2. Cài bản mới

Đóng các hồ sơ Chrome rồi đóng TD Browser. Chạy `TD-Browser-Setup-1.2.3.exe` trên máy admin và máy người dùng. Dữ liệu app được giữ trong thư mục dữ liệu hiện tại; không cần xóa hồ sơ cũ.

Nên cập nhật mọi máy lên 1.2.3: các thao tác cấp khóa mới có kiểm tra khóa người nhận để tránh dùng khóa cũ trong lúc khôi phục. Bản cũ có thể báo lỗi khi chia sẻ hoặc đồng bộ sau migration mới.

## 3. Nhớ mật khẩu và duy trì đăng nhập

- **Nhớ mật khẩu:** lưu email/mật khẩu bằng kho mã hóa của Windows trên máy này, tự điền khi đăng nhập. Bỏ chọn sẽ xóa mật khẩu đã lưu. Chỉ lưu mật khẩu sau khi đăng nhập thành công.
- **Duy trì đăng nhập:** lưu phiên và khóa mở Cloud bằng kho mã hóa Windows để mở lại app không phải đăng nhập/mở khóa lại, khi phiên còn hợp lệ và tài khoản còn được phép hoạt động. Bỏ chọn thì lần mở app sau cần đăng nhập.
- Đăng xuất xóa phiên và khóa mở Cloud đã lưu. Mật khẩu chỉ còn nếu đã chọn Nhớ mật khẩu. Tùy chọn độc lập với duy trì đăng nhập. Thông tin đã lưu chỉ dùng trên máy/tài khoản Windows hiện tại; không có phương án lưu dạng rõ khi Windows không cấp mã hóa.

## 4. Đổi mật khẩu khi còn nhớ mật khẩu hiện tại

Đăng nhập → bấm **Đổi mật khẩu** ở cuối thanh bên → nhập mật khẩu hiện tại, mật khẩu mới và xác nhận. Mật khẩu mới ít nhất 9 ký tự. Đóng hồ sơ và chờ đồng bộ trước khi đổi.

App xác thực mật khẩu hiện tại, giữ nguyên cặp khóa hồ sơ, mã hóa lại khóa riêng bằng mật khẩu mới. Mật khẩu Auth và metadata khóa được cập nhật trong cùng giao dịch phía Supabase; không tải lại các dữ liệu Chrome lớn. Hồ sơ sở hữu và quyền chia sẻ giữ nguyên. Các máy khác có thể cần đăng nhập lại sau thay đổi.

## 5. Quên mật khẩu

1. Tại màn hình đăng nhập, bấm **Quên mật khẩu?**.
2. Nhập email → **Gửi mã xác nhận**.
3. Mở email mới nhất, nhập mã trong email vào app, nhập mật khẩu mới và xác nhận.
4. App tự đăng nhập sau khi cập nhật thành công. Nếu máy còn khóa được mã hóa hợp lệ, app dùng lại khóa đó. Nếu không còn khóa, app tạo khóa mới; hồ sơ và quyền chia sẻ vẫn giữ nguyên, khóa mở các hồ sơ Cloud cũ cần được admin cấp lại.
5. Nếu mã hết hạn, yêu cầu mã mới; chờ ít nhất 60 giây giữa các lần gửi. Nếu cập nhật thất bại sau xác nhận email, app cho thử lại trong phiên xác nhận ngắn. Đóng hộp thoại sẽ hủy phiên xác nhận và cần gửi mã mới.

## 6. Admin khôi phục quyền mở hồ sơ

Sau khi người dùng đặt lại mật khẩu: **Quản lý người dùng** → bấm **▸ Hồ sơ** bên cạnh tài khoản → **Khôi phục quyền mở hồ sơ**. Admin cần mở khóa Cloud của mình trước. Kết quả báo rõ số hồ sơ khôi phục và hồ sơ chưa thể cấp khóa.

Chỉ cấp lại khóa cho hồ sơ còn sở hữu hoặc còn được chia sẻ; không khôi phục quyền đã thu hồi. Chủ sở hữu giữ nguyên. Không cần biết mật khẩu người dùng và không tải/nén lại dữ liệu Chrome. Người dùng mở lại hồ sơ bằng mật khẩu mới sau khi cấp khóa.

Giới hạn: admin phải có khóa mở được hồ sơ đó. Hồ sơ chưa đồng bộ dữ liệu Chrome lên Cloud không thể phục hồi dữ liệu từ Cloud. Nếu admin duy nhất quên mật khẩu, không còn khóa đã lưu trên máy và không có admin dự phòng giữ khóa, hệ thống chặn thay khóa để tránh mất khả năng giải mã. Cần giữ phiên trên máy tin cậy hoặc chuẩn bị admin dự phòng và dùng nút **Cấp khóa cho admin mới** trước khi xảy ra sự cố. Hệ thống không thể khôi phục dữ liệu đã mất mọi khóa giải mã.

## 7. Quản lý người dùng gọn hơn

Thanh bật chia sẻ chỉ chiếm chiều cao cần thiết. Bấm **▸ Hồ sơ** để xổ danh sách ngay dưới dòng người dùng, bấm **▾ Thu gọn** để đóng. Có thể mở nhiều tài khoản cùng lúc. Danh sách xổ tự làm mới khoảng 30 giây khi đang xem, giữ nguyên các ô chọn vai trò/trạng thái đang sửa.

Trong từng danh sách vẫn có tải/mở, sửa, chia sẻ, xóa hồ sơ sở hữu hoặc gỡ quyền của riêng người nhận. Thu gọn và mở lại không chuyển sang trang khác.

## 8. Phát hành cập nhật

Tạo GitHub Release `v1.2.3`, đính kèm cả ba tệp:

- `TD-Browser-Setup-1.2.3.exe`
- `TD-Browser-Setup-1.2.3.exe.blockmap`
- `latest.yml`

Các tệp chưa được tự đăng lên GitHub. Tệp SQL và mẫu email dùng để cấu hình dự án của bạn, không phải bộ cài cho người dùng.

## Phạm vi kiểm tra

Mã JavaScript được kiểm tra cú pháp; các tệp đóng gói được đối chiếu với mã nguồn và tính mã băm bộ cài. Chưa chạy SQL trên dự án thật và chưa thử luồng email/đổi mật khẩu/khôi phục giữa hai tài khoản trên máy thật. Sau cấu hình Supabase, cần kiểm tra bằng tài khoản thử trước khi phát hành cho mọi người.
