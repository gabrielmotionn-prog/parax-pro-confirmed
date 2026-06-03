ParaX Pro - macOS package

Included:
- ParaX Pro Mac Installer.command
- Files/ParaX Pro.jsxbin
- Files/ParaX Pro Header Logo.png
- Files/PU_Settings_v11.xml
- Files/README.md

Recommended installation:
1) Close After Effects.
2) Unzip this folder on macOS.
3) Open Terminal in this folder.
4) Run:
   chmod +x "ParaX Pro Mac Installer.command"
   ./"ParaX Pro Mac Installer.command"
5) Select your Adobe After Effects version.
6) Enter the macOS administrator password if requested.
7) Reopen After Effects.
8) Enable this option:
   After Effects > Settings > Scripting & Expressions > Allow Scripts To Write Files And Access Network
9) Open:
   Window > ParaX Pro

Important:
- Do not copy the whole Files folder into ScriptUI Panels.
- The file must be installed directly inside:
  /Applications/Adobe After Effects [version]/Scripts/ScriptUI Panels/
- If the Window menu shows Files > ParaX Pro, remove the Files folder from ScriptUI Panels and run the installer again.

Manual install, only if needed:
1) Close After Effects.
2) Copy only these two files:
   Files/ParaX Pro.jsxbin
   Files/ParaX Pro Header Logo.png
3) Paste them directly into:
   /Applications/Adobe After Effects [version]/Scripts/ScriptUI Panels/
4) Reopen After Effects.
5) Open:
   Window > ParaX Pro

If macOS blocks execution:
1) In Terminal, run:
   xattr -dr com.apple.quarantine "ParaX Pro Mac Installer.command" "Files"
2) Run installer again:
   ./"ParaX Pro Mac Installer.command"

If the activation field does not appear:
1) Confirm After Effects was fully closed before installation.
2) Confirm the panel is not inside a Files subfolder.
3) Enable Allow Scripts To Write Files And Access Network.
4) Reopen After Effects and open Window > ParaX Pro.
