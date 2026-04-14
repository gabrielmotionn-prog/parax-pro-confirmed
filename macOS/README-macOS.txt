ParaX Pro - macOS package

Included:
- ParaX Pro Mac Installer.command
- Files/ParaX Pro.jsxbin
- Files/ParaX Pro Header Logo.png
- Files/PU_Settings_v11.xml
- Files/README.md

Option A (recommended, fast):
1) Close After Effects.
2) Copy Files/ParaX Pro.jsxbin to:
   /Applications/Adobe After Effects [version]/Scripts/ScriptUI Panels/
3) Reopen After Effects.
4) Open: Window > ParaX Pro.jsxbin

Option B (automatic installer):
1) unzip this folder on macOS
2) open Terminal in this folder
3) chmod +x "ParaX Pro Mac Installer.command"
4) ./"ParaX Pro Mac Installer.command"
5) reopen After Effects and open Window > ParaX Pro.jsxbin

If macOS blocks execution:
1) In Terminal, run:
   xattr -dr com.apple.quarantine "ParaX Pro Mac Installer.command" "Files"
2) Run installer again:
   ./"ParaX Pro Mac Installer.command"

If panel does not appear:
1) Confirm the file exists in ScriptUI Panels.
2) Confirm you copied to the same After Effects version you are opening.
3) Fully close and reopen After Effects.
