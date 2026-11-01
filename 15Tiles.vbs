Dim shell
Set shell = CreateObject("WScript.Shell")

' Open your main project window (reuses existing if already open)
shell.Run "code F:\trifoldi\projects\15tiles", 1, False
WScript.Sleep 2000

' Open a second, separate VS Code window for terminals only
shell.Run "code --new-window F:\trifoldi\projects\15tiles", 1, False
WScript.Sleep 4000

' Explicitly focus the new window before sending keys
shell.AppActivate "15tiles - Visual Studio Code"
WScript.Sleep 500

' Open first terminal and run npm run tw
shell.SendKeys "^`"
WScript.Sleep 1000
shell.SendKeys "npm run tw{ENTER}"
WScript.Sleep 500

' Open second terminal tab and run npm run dev
shell.SendKeys "^+5"
WScript.Sleep 800
shell.SendKeys "npm run dev{ENTER}"

Set shell = Nothing