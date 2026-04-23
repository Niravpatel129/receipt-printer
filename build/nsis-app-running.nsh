!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    ${if} ${isUpdated}
      Sleep 300
    ${endIf}

    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      ${if} ${isUpdated}
        Sleep 1000
      ${endIf}

      DetailPrint "$(appClosing)"

      !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 0
      Sleep 300

      StrCpy $R1 0

      rp_wait_loop:
        IntOp $R1 $R1 + 1

        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 == 0
          Sleep 1000
          !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1
          !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
          ${if} $R0 == 0
            DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
            Sleep 2000
          ${else}
            Goto rp_wait_done
          ${endIf}
        ${else}
          Goto rp_wait_done
        ${endIf}

        ${if} $R1 > 40
          DetailPrint `Could not confirm "${PRODUCT_NAME}" exited; continuing setup.`
          Goto rp_wait_done
        ${endIf}
        Goto rp_wait_loop

      rp_wait_done:
    ${endIf}
  ${endIf}
!macroend
