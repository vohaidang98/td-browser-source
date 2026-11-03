Unicode true
ManifestDPIAware true
RequestExecutionLevel user
Name "TD Browser"
Caption "Cài đặt TD Browser"
BrandingText "TD Browser 1.3.7"
InstallDir "$LOCALAPPDATA\Programs\TD Browser"
SetCompressor /FINAL zlib

ShowInstDetails nevershow
ShowUninstDetails show

!define APP_GUID "be89ad1d-ec03-5b5b-a68a-13289e065bd2"
!define INSTALL_KEY "Software\${APP_GUID}"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}"
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!define MUI_ICON "${__FILEDIR__}\installer-assets\td-browser.ico"
!define MUI_UNICON "${__FILEDIR__}\installer-assets\td-browser.ico"
!define MUI_BGCOLOR "FFFFFF"
!define MUI_TEXTCOLOR "17233B"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${__FILEDIR__}\installer-assets\header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${__FILEDIR__}\installer-assets\wizard.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${__FILEDIR__}\installer-assets\wizard.bmp"
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Bạn muốn dừng cài đặt TD Browser?"
!define MUI_WELCOMEPAGE_TITLE "Chào mừng đến với$\r$\nTD Browser"
!define MUI_WELCOMEPAGE_TEXT "Không gian làm việc cho từng hồ sơ trình duyệt."
!define MUI_PAGE_CUSTOMFUNCTION_SHOW WelcomeDesign
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_HEADER_TEXT "Chọn nơi cài đặt"
!define MUI_PAGE_HEADER_SUBTEXT "TD Browser 1.3.7  /  Windows 64 bit"
!define MUI_DIRECTORYPAGE_TEXT_TOP "Chọn thư mục cài TD Browser. Khi cập nhật, hãy giữ thư mục đang sử dụng."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Thư mục cài đặt"
!define MUI_DIRECTORYPAGE_BGCOLOR "F4F6FA"
!insertmacro MUI_PAGE_DIRECTORY
!define MUI_PAGE_HEADER_TEXT "Đang cài đặt TD Browser"
!define MUI_PAGE_HEADER_SUBTEXT "Đang chuẩn bị không gian làm việc của bạn. Vui lòng chờ."
!define MUI_INSTFILESPAGE_COLORS "17233B F4F6FA"
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Cài đặt hoàn tất"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "TD Browser đã sẵn sàng để sử dụng."
!define MUI_INSTFILESPAGE_ABORTHEADER_TEXT "Cài đặt chưa hoàn tất"
!define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "Kiểm tra thông báo bên dưới trước khi thử lại."
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Sẵn sàng bắt đầu!"
!define MUI_FINISHPAGE_TEXT "TD Browser đã được cài đặt.$\r$\n$\r$\nĐăng nhập để sử dụng hồ sơ của bạn, nhận hồ sơ được chia sẻ và làm việc cùng đội nhóm.$\r$\n$\r$\nDữ liệu hồ sơ hiện có được giữ lại khi cập nhật."
!define MUI_FINISHPAGE_RUN "$INSTDIR\TD Browser.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Mở TD Browser ngay"
!define MUI_FINISHPAGE_BUTTON "Hoàn tất"
!insertmacro MUI_PAGE_FINISH
!define MUI_UNCONFIRMPAGE_TEXT_TOP "Gỡ TD Browser khỏi máy tính này. Dữ liệu hồ sơ của bạn được lưu riêng với thư mục chương trình."
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Vietnamese"
SetFont /LANG=1066 "Segoe UI" 9

Function WelcomeDesign
  ShowWindow $mui.WelcomePage.Text ${SW_HIDE}
  SetCtlColors $mui.WelcomePage.Title "17233B" "FFFFFF"
  ${NSD_CreateLabel} 120u 47u 195u 31u "Không gian làm việc gọn gàng cho từng hồ sơ trình duyệt."
  Pop $R0
  SetCtlColors $R0 "748097" "FFFFFF"
  ${NSD_CreateLabel} 120u 86u 195u 57u ""
  Pop $R0
  SetCtlColors $R0 "17233B" "F0F3FF"
  ${NSD_CreateLabel} 127u 93u 181u 43u "Hồ sơ riêng, dễ sắp xếp$\r$\nProxy linh hoạt theo công việc$\r$\nChia sẻ và quản lý cùng đội nhóm"
  Pop $R0
  SetCtlColors $R0 "334FC4" "F0F3FF"
  ${NSD_CreateLabel} 120u 155u 195u 31u "Trước khi cập nhật: đóng hồ sơ và dừng tác vụ rồi thoát TD Browser."
  Pop $R0
  SetCtlColors $R0 "748097" "FFFFFF"
FunctionEnd

Function EnsureProgramWritable
  td_check_program:
    IfFileExists "$INSTDIR\TD Browser.exe" 0 td_program_ready
    ; Probe write access without changing or deleting the executable.
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\TD Browser.exe", i 0x40000000, i 7, p 0, i 3, i 0, p 0) p .r0'
    ${If} $0 == -1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Chưa thể cập nhật TD Browser.$\r$\n$\r$\nHãy đóng các hồ sơ Chrome, dừng tác vụ rồi thoát TD Browser.$\r$\n$\r$\nBấm Thử lại để tiếp tục. Nếu ứng dụng đã đóng, hãy kiểm tra quyền ghi vào thư mục cài đặt." /SD IDCANCEL IDRETRY td_check_program
      SetErrorLevel 2
      Abort "Chưa thể ghi vào thư mục cài đặt."
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
  td_program_ready:
FunctionEnd

VIProductVersion "1.3.7.0"
VIAddVersionKey /LANG=1033 "ProductName" "TD Browser"
VIAddVersionKey /LANG=1033 "ProductVersion" "1.3.7"
VIAddVersionKey /LANG=1033 "FileDescription" "TD Browser Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "1.3.7.0"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright TD"
OutFile "D:\Code\TD-Browser\release-1.3.7\TD-Browser-Setup-1.3.7.exe"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "TD Browser yêu cầu Windows 64 bit."
    Abort
  ${EndIf}
  SetShellVarContext current
  SetRegView 64
  ReadRegStr $R0 HKCU "${INSTALL_KEY}" "InstallLocation"
  ${If} $R0 != ""
    StrCpy $INSTDIR $R0
  ${EndIf}
FunctionEnd

Function .onVerifyInstDir
  ${GetRoot} "$INSTDIR" $R0
  ${If} $INSTDIR == "$R0\"
  ${OrIf} $INSTDIR == "$R0"
  ${OrIf} $INSTDIR == "$LOCALAPPDATA"
  ${OrIf} $INSTDIR == "$APPDATA"
  ${OrIf} $INSTDIR == "$PROFILE"
  ${OrIf} $INSTDIR == "$WINDIR"
  ${OrIf} $INSTDIR == "$PROGRAMFILES"
    Abort
  ${EndIf}
FunctionEnd

Function .onInstSuccess
  ; Interactive installs launch from the finish-page checkbox only.
  IfSilent 0 td_success_done
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    ExecShell "open" "$INSTDIR\TD Browser.exe" "--updated"
  ${EndIf}
  td_success_done:
FunctionEnd

Section "TD Browser"
  Call EnsureProgramWritable
  SetShellVarContext current
  SetRegView 64
  SetOutPath "$INSTDIR"
  File /r "D:\Code\TD-Browser\release-1.3.7\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Uninstall TD Browser.exe"
  CreateDirectory "$SMPROGRAMS\TD Browser"
  CreateShortCut "$SMPROGRAMS\TD Browser\TD Browser.lnk" "$INSTDIR\TD Browser.exe"
  CreateShortCut "$DESKTOP\TD Browser.lnk" "$INSTDIR\TD Browser.exe"
  WriteRegStr HKCU "${INSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "TD Browser"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "1.3.7"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "TD"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\TD Browser.exe,0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall TD Browser.exe$\" /currentuser'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall TD Browser.exe$\" /currentuser /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  Delete "$DESKTOP\TD Browser.lnk"
  Delete "$SMPROGRAMS\TD Browser\TD Browser.lnk"
  RMDir "$SMPROGRAMS\TD Browser"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.exe"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\*.html"
  Delete "$INSTDIR\*.txt"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.yml"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${INSTALL_KEY}"
  RMDir "$INSTDIR"
SectionEnd
