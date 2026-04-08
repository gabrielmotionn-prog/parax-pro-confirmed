#!/bin/bash
set -euo pipefail

APP_NAME="ParaX Pro"
APP_VERSION="5.7"
PKG_ID="com.paraxpro.installer"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FILES_DIR="$MAC_DIR/Files"
BUILD_DIR="$SCRIPT_DIR/.build"
ROOT_DIR="$BUILD_DIR/root"
PKG_BUILD_DIR="$BUILD_DIR/pkg"
COMPONENT_PKG="$PKG_BUILD_DIR/ParaX Pro Component.pkg"
FINAL_PKG="$MAC_DIR/ParaX-Pro-Mac-Installer-v$APP_VERSION.pkg"

PANEL_SOURCE="$FILES_DIR/ParaX Pro.jsxbin"
HEADER_LOGO_SOURCE="$FILES_DIR/ParaX Pro Header Logo.png"
PSEUDO_SOURCE="$FILES_DIR/PU_Settings_v11.xml"
README_SOURCE="$FILES_DIR/README.md"
STAGING_DIR="$ROOT_DIR/Library/Application Support/ParaX Pro Installer"

if ! command -v pkgbuild >/dev/null 2>&1; then
  echo "pkgbuild not found. Run this on macOS with Xcode Command Line Tools installed."
  exit 1
fi

[ -f "$PANEL_SOURCE" ] || { echo "Missing $PANEL_SOURCE"; exit 1; }
[ -f "$HEADER_LOGO_SOURCE" ] || { echo "Missing $HEADER_LOGO_SOURCE"; exit 1; }
[ -f "$PSEUDO_SOURCE" ] || { echo "Missing $PSEUDO_SOURCE"; exit 1; }
[ -f "$README_SOURCE" ] || { echo "Missing $README_SOURCE"; exit 1; }

rm -rf "$BUILD_DIR"
mkdir -p "$STAGING_DIR" "$PKG_BUILD_DIR"

cp "$PANEL_SOURCE" "$STAGING_DIR/ParaX Pro.jsxbin"
cp "$HEADER_LOGO_SOURCE" "$STAGING_DIR/ParaX Pro Header Logo.png"
cp "$PSEUDO_SOURCE" "$STAGING_DIR/PU_Settings_v11.xml"
cp "$README_SOURCE" "$STAGING_DIR/README.md"

chmod +x "$SCRIPT_DIR/scripts/postinstall"

pkgbuild \
  --root "$ROOT_DIR" \
  --scripts "$SCRIPT_DIR/scripts" \
  --identifier "$PKG_ID.component" \
  --version "$APP_VERSION" \
  --install-location "/" \
  "$COMPONENT_PKG"

if command -v productbuild >/dev/null 2>&1; then
  productbuild \
    --distribution "$SCRIPT_DIR/distribution.xml" \
    --resources "$SCRIPT_DIR/resources" \
    --package-path "$PKG_BUILD_DIR" \
    "$FINAL_PKG"
else
  cp "$COMPONENT_PKG" "$FINAL_PKG"
fi

echo ""
echo "Done:"
echo "  $FINAL_PKG"