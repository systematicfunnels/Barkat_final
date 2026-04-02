!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifdef BUILD_UNINSTALLER
Var KeepBarkatAppData

!macro BarkatRemoveGeneratedData basePath
  RMDir /r "${basePath}\maintenance-letters"
  RMDir /r "${basePath}\receipts"
  RMDir /r "${basePath}\invoices"
  RMDir /r "${basePath}\pdfs"
!macroend

!macro BarkatRemoveAllData basePath
  Delete "${basePath}\barkat.db"
  Delete "${basePath}\barkat.db-wal"
  Delete "${basePath}\barkat.db-shm"
  RMDir /r "${basePath}"
!macroend

!macro customUnInstall
  StrCpy $KeepBarkatAppData "1"

  ${GetParameters} $R0

  ClearErrors
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    StrCpy $KeepBarkatAppData "0"
    Goto BarkatUninstallChoiceDone
  ${EndIf}

  ClearErrors
  ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
  ${IfNot} ${Errors}
    StrCpy $KeepBarkatAppData "1"
    Goto BarkatUninstallChoiceDone
  ${EndIf}

  ${If} ${Silent}
    StrCpy $KeepBarkatAppData "1"
    Goto BarkatUninstallChoiceDone
  ${EndIf}

  ${If} ${isUpdated}
    StrCpy $KeepBarkatAppData "1"
    Goto BarkatUninstallChoiceDone
  ${EndIf}

  MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "Keep Barkat local data for future use?$\n$\nYes: Keep database, assets, and backups.$\nNo: Remove all Barkat local data.$\nCancel: Stop uninstall." IDYES BarkatKeepData IDNO BarkatDeleteData
  Goto BarkatCancelUninstall

  BarkatKeepData:
    StrCpy $KeepBarkatAppData "1"
    Goto BarkatUninstallChoiceDone

  BarkatDeleteData:
    StrCpy $KeepBarkatAppData "0"
    Goto BarkatUninstallChoiceDone

  BarkatCancelUninstall:
    Abort

  BarkatUninstallChoiceDone:
!macroend

!macro customRemoveFiles
  SetShellVarContext current

  ${If} $KeepBarkatAppData == "1"
    !insertmacro BarkatRemoveGeneratedData "$APPDATA\Barkat"
    !insertmacro BarkatRemoveGeneratedData "$APPDATA\barkat"
  ${Else}
    !insertmacro BarkatRemoveAllData "$APPDATA\Barkat"
    !insertmacro BarkatRemoveAllData "$APPDATA\barkat"
  ${EndIf}

  RMDir /r "$LOCALAPPDATA\barkat-updater"
  RMDir /r "$LOCALAPPDATA\Barkat-updater"
!macroend
!endif
