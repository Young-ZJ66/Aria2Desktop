; electron-builder NSIS 自定义钩子
;
; 为什么需要：应用默认 minimizeToTray=true —— 用户点窗口的 × 只是把窗口藏到托盘，
; 进程继续在后台跑。安装器默认的"关闭运行中的程序"靠给主窗口发 WM_CLOSE，
; 窗口一藏就什么也没关掉，于是卡在「Aria2Desktop 无法关闭，请手动关闭它」——
; 用户必须自己找到托盘图标退出，升级/安装体验非常差。
;
; 这里改为先礼后兵：先发普通 taskkill（不带 /F 会向窗口发 WM_CLOSE，应用有机会
; 刷盘、优雅退出），**等它真的退出**（最多 12 秒）再强制结束残留进程。
;
; 为什么不是固定的 1.5 秒：应用的优雅关闭要走 aria2 RPC shutdown + 会话落盘，
; 实测约 4 秒（engine 退出宽限就是按这个值定的 8 秒）。等太短就 /F，会在
; 会话文件写一半时把进程打断——升级一次就丢一次"未完成任务"。
; 带上 /T 是为了连 aria2c 子进程一起结束，否则安装包替换引擎文件时会被占用。

!include "LogicLib.nsh"

!macro customCheckAppRunning
  ; 先礼：WM_CLOSE → 应用隐藏窗口、刷盘、优雅关闭引擎
  nsExec::Exec 'taskkill /IM "Aria2Desktop.exe" /T'
  Pop $0

  ; 每 500ms 查一次，最多 24 次（12 秒）。tasklist + findstr 在找不到进程时
  ; 返回非 0，正是我们要的"已退出"信号。
  StrCpy $R9 0
  ${Do}
    Sleep 500
    nsExec::Exec 'cmd /c tasklist /FI "IMAGENAME eq Aria2Desktop.exe" /NH | "%SYSDIR%\findstr.exe" /I "Aria2Desktop.exe"'
    Pop $0
    ${If} $0 != 0
      ${ExitDo}
    ${EndIf}
    IntOp $R9 $R9 + 1
  ${LoopUntil} $R9 >= 24

  ; 后兵：仍在运行（卡死、或优雅关闭没用）就强杀；已经退出时这条只是打印
  ; "没有找到进程"，无害。
  nsExec::Exec 'taskkill /IM "Aria2Desktop.exe" /F /T'
  Pop $0
  Sleep 600
!macroend
