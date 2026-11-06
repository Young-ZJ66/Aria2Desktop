; electron-builder NSIS 自定义钩子
;
; 为什么需要：应用默认 minimizeToTray=true —— 用户点窗口的 × 只是把窗口藏到托盘，
; 进程继续在后台跑。安装器默认的"关闭运行中的程序"靠给主窗口发 WM_CLOSE，
; 窗口一藏就什么也没关掉，于是卡在「Aria2Desktop 无法关闭，请手动关闭它」——
; 用户必须自己找到托盘图标退出，升级/安装体验非常差。
;
; 这里改为先礼后兵：先发普通 taskkill（不带 /F 会向窗口发 WM_CLOSE，应用有机会
; 刷盘、优雅退出），等 1.5 秒再强制结束仍残留的进程。
; 只针对本应用的可执行文件名，不影响其他程序。

!macro customCheckAppRunning
  nsExec::Exec 'taskkill /IM "Aria2Desktop.exe"'
  Pop $0
  Sleep 1500
  nsExec::Exec 'taskkill /IM "Aria2Desktop.exe" /F'
  Pop $0
  Sleep 500
!macroend
