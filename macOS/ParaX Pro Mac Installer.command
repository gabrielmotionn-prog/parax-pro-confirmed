#!/bin/bash
set -euo pipefail

APP_NAME="ParaX Pro"
APP_VERSION="v5.7"
PSEUDO_MATCH="Pseudo/PU_Settings_v11"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILES_DIR="$SCRIPT_DIR/Files"
PANEL_SOURCE="$FILES_DIR/ParaX Pro.jsxbin"
HEADER_LOGO_SOURCE="$FILES_DIR/ParaX Pro Header Logo.png"
PSEUDO_SOURCE="$FILES_DIR/PU_Settings_v11.xml"

print_line() {
  printf '%s\n' "$1"
}

fail() {
  print_line ""
  print_line "ERROR: $1"
  print_line ""
  read -r -p "Press Enter to close..."
  exit 1
}

if [ "$(uname)" != "Darwin" ]; then
  fail "This installer is only for macOS."
fi

[ -f "$PANEL_SOURCE" ] || fail "Missing file: ParaX Pro.jsxbin"
[ -f "$PSEUDO_SOURCE" ] || fail "Missing file: PU_Settings_v11.xml"
[ -f "$HEADER_LOGO_SOURCE" ] || fail "Missing file: ParaX Pro Header Logo.png"

print_line ""
print_line "$APP_NAME $APP_VERSION - Mac Installer"
print_line "----------------------------------------"
print_line ""
print_line "Close Adobe After Effects before continuing."
print_line ""

AE_APPS=()
while IFS= read -r path; do
  [ -n "$path" ] && AE_APPS+=("$path")
done < <(find /Applications -maxdepth 3 -type d -name "Adobe After Effects*.app" 2>/dev/null | sort)

if [ "${#AE_APPS[@]}" -eq 0 ]; then
  fail "No Adobe After Effects app bundle was found in /Applications."
fi

print_line "Select the Adobe After Effects version to install into:"
print_line ""
for i in "${!AE_APPS[@]}"; do
  idx=$((i + 1))
  print_line "  [$idx] ${AE_APPS[$i]}"
done
print_line ""

selection=""
while :; do
  read -r -p "Enter a number (1-${#AE_APPS[@]}): " selection
  case "$selection" in
    ''|*[!0-9]*) print_line "Invalid selection." ;;
    *)
      if [ "$selection" -ge 1 ] && [ "$selection" -le "${#AE_APPS[@]}" ]; then
        break
      fi
      print_line "Invalid selection."
      ;;
  esac
done

TARGET_APP="${AE_APPS[$((selection - 1))]}"
PANEL_DIR="$TARGET_APP/Contents/Resources/Scripts/ScriptUI Panels"
XML_PATH="$TARGET_APP/Contents/Resources/PresetEffects.xml"

[ -d "$TARGET_APP" ] || fail "Selected installation no longer exists."
[ -f "$XML_PATH" ] || fail "PresetEffects.xml was not found at: $XML_PATH"

print_line ""
print_line "Selected:"
print_line "  $TARGET_APP"
print_line ""

print_line "Administrator permission is required to install into Adobe After Effects."
sudo -v || fail "Administrator authorization was cancelled."

TMP_XML="$(mktemp "/tmp/parax_pu_settings.XXXXXX.xml")" || fail "Could not create temp file."
cp "$PSEUDO_SOURCE" "$TMP_XML" || fail "Could not prepare pseudo-effect file."

export PARAX_PANEL_SOURCE="$PANEL_SOURCE"
export PARAX_HEADER_LOGO_SOURCE="$HEADER_LOGO_SOURCE"
export PARAX_PANEL_DIR="$PANEL_DIR"
export PARAX_XML_PATH="$XML_PATH"
export PARAX_TMP_XML="$TMP_XML"
export PARAX_PSEUDO_MATCH="$PSEUDO_MATCH"

if ! sudo /bin/bash <<'ROOT_SCRIPT'
set -euo pipefail

mkdir -p "$PARAX_PANEL_DIR"
cp "$PARAX_PANEL_SOURCE" "$PARAX_PANEL_DIR/ParaX Pro.jsxbin"
cp "$PARAX_HEADER_LOGO_SOURCE" "$PARAX_PANEL_DIR/ParaX Pro Header Logo.png"

if [ ! -f "${PARAX_XML_PATH}.bak" ]; then
  cp "$PARAX_XML_PATH" "${PARAX_XML_PATH}.bak"
fi

/usr/bin/perl -0pe '
  BEGIN {
    local $/;
    open my $fh, "<", $ENV{"PARAX_TMP_XML"} or die "Unable to read pseudo XML";
    $xml = <$fh>;
    close $fh;
  }
  s#<Effect matchname="Pseudo/PU_Settings_v11".*?</Effect>\s*##sg;
  s#</Effects>#\n$xml\n</Effects>#s or die "Closing </Effects> tag not found";
' "$PARAX_XML_PATH" > "${PARAX_XML_PATH}.parax_tmp"
mv "${PARAX_XML_PATH}.parax_tmp" "$PARAX_XML_PATH"
ROOT_SCRIPT
then
  rm -f "$TMP_XML"
  fail "Installation failed while writing files into Adobe After Effects."
fi

rm -f "$TMP_XML"

print_line ""
print_line "Installation completed successfully."
print_line ""
print_line "Installed panel:"
print_line "  $PANEL_DIR/ParaX Pro.jsxbin"
print_line ""
print_line "Updated pseudo-effect file:"
print_line "  $XML_PATH"
print_line ""
print_line "Next step:"
print_line "  Reopen Adobe After Effects and open Window > ParaX Pro"
print_line ""

read -r -p "Press Enter to close..."