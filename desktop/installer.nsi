Unicode True
!include "MUI2.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
Name "Órbita"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Orbita"
InstallDirRegKey HKCU "Software\Orbita" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "0.1.0.0"
VIAddVersionKey /LANG=1046 "ProductName" "Órbita"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador do Órbita"
VIAddVersionKey /LANG=1046 "FileVersion" "0.1.0"
VIAddVersionKey /LANG=1046 "LegalCopyright" "Órbita contributors"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Este instalador requer Windows de 64 bits."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "O Órbita requer Windows 10 ou superior."
    Abort
  ${EndIf}
FunctionEnd

Section "Órbita"
  SetShellVarContext current
  IfFileExists "$INSTDIR\node.exe" 0 install
    nsExec::ExecToStack '"$INSTDIR\node.exe" "$INSTDIR\orbita.cjs" --stop'
    Pop $0
    Pop $1
    Sleep 1500
  install:
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}/*"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "Software\Orbita" "InstallDir" "$INSTDIR"
  CreateDirectory "$SMPROGRAMS\Órbita"
  CreateShortcut "$DESKTOP\Órbita.lnk" "$INSTDIR\Orbita.exe" "" "$INSTDIR\orbita.ico"
  CreateShortcut "$SMPROGRAMS\Órbita\Órbita.lnk" "$INSTDIR\Orbita.exe" "" "$INSTDIR\orbita.ico"
  CreateShortcut "$SMPROGRAMS\Órbita\Encerrar Órbita.lnk" "$INSTDIR\Orbita.exe" "--stop" "$INSTDIR\orbita.ico"
  CreateShortcut "$SMPROGRAMS\Órbita\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbita" "DisplayName" "Órbita"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbita" "DisplayVersion" "0.1.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbita" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbita" "DisplayIcon" "$INSTDIR\orbita.ico"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbita" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbita" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  nsExec::ExecToStack '"$INSTDIR\node.exe" "$INSTDIR\orbita.cjs" --stop'
  Pop $0
  Pop $1
  Sleep 1500
  Delete "$DESKTOP\Órbita.lnk"
  RMDir /r "$SMPROGRAMS\Órbita"
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\orbita.cjs"
  Delete "$INSTDIR\orbita.ico"
  Delete "$INSTDIR\Orbita.exe"
  Delete "$INSTDIR\LEIA-ME.txt"
  Delete "$INSTDIR\THIRD-PARTY-NOTICES.txt"
  Delete "$INSTDIR\NODE-LICENSE.txt"
  RMDir /r "$INSTDIR\dist"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Orbita"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbita"
  ; Preserve %LOCALAPPDATA%\Orbita, which contains the user's database.
SectionEnd
