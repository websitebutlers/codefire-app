#!/bin/bash
set -euo pipefail

# Package CodeFire as a signed and notarized macOS .app bundle
# Usage: ./scripts/package-app.sh
# Output: build/CodeFire.app + build/CodeFire.zip

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build"
APP_NAME="CodeFire"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
BUNDLE_ID="com.codefire.app"
VERSION="1.5.2"

# Signing identity and notarization profile
SIGN_IDENTITY="Developer ID Application: Nick Norris (GFH3R9N56D)"
NOTARY_PROFILE="CodeFire"

echo "=== Packaging $APP_NAME.app (v$VERSION) ==="
echo ""

# Step 1: Build universal release binaries (arm64 + x86_64)
echo "[1/7] Building universal release binaries..."
cd "$PROJECT_DIR/swift"

echo "  Building arm64..."
swift build -c release --arch arm64 2>&1 | tail -3
echo "  Building x86_64..."
swift build -c release --arch x86_64 2>&1 | tail -3

ARM_BINARY=".build/arm64-apple-macosx/release/CodeFire"
X86_BINARY=".build/x86_64-apple-macosx/release/CodeFire"
ARM_MCP=".build/arm64-apple-macosx/release/CodeFireMCP"
X86_MCP=".build/x86_64-apple-macosx/release/CodeFireMCP"

for bin in "$ARM_BINARY" "$X86_BINARY" "$ARM_MCP" "$X86_MCP"; do
    if [ ! -f "$bin" ]; then
        echo "ERROR: Binary not found at $bin"
        exit 1
    fi
done

echo "  Creating universal binaries with lipo..."
mkdir -p "$BUILD_DIR/universal"
lipo -create "$ARM_BINARY" "$X86_BINARY" -output "$BUILD_DIR/universal/CodeFire"
lipo -create "$ARM_MCP" "$X86_MCP" -output "$BUILD_DIR/universal/CodeFireMCP"

BINARY_PATH="$BUILD_DIR/universal/CodeFire"
MCP_BINARY_PATH="$BUILD_DIR/universal/CodeFireMCP"

echo "  App binary: $(du -h "$BINARY_PATH" | awk '{print $1}') (universal)"
echo "  MCP binary: $(du -h "$MCP_BINARY_PATH" | awk '{print $1}') (universal)"

# Step 2: Generate icon
echo "[2/7] Generating app icon..."
ICON_WORK="$BUILD_DIR/icon_work"
mkdir -p "$ICON_WORK"
CUSTOM_ICON="$PROJECT_DIR/assets/AppIcon1024.png"
if [ -f "$CUSTOM_ICON" ]; then
    cp "$CUSTOM_ICON" "$ICON_WORK/icon_1024.png"
    echo "  Using custom icon from assets/AppIcon1024.png"
else
    swift "$SCRIPT_DIR/generate-icon.swift" "$ICON_WORK"
    echo "  Generated programmatic icon (place assets/AppIcon1024.png to use a custom icon)"
fi

# Step 3: Create iconset
echo "[3/7] Creating iconset..."
ICONSET="$ICON_WORK/AppIcon.iconset"
mkdir -p "$ICONSET"

# macOS icon sizes
SIZES=(16 32 64 128 256 512)
for s in "${SIZES[@]}"; do
    sips -z "$s" "$s" "$ICON_WORK/icon_1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1
    d=$((s * 2))
    sips -z "$d" "$d" "$ICON_WORK/icon_1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1
done
cp "$ICON_WORK/icon_1024.png" "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$ICON_WORK/AppIcon.icns"
echo "  Icon: $(du -h "$ICON_WORK/AppIcon.icns" | awk '{print $1}')"

# Step 4: Assemble .app bundle
echo "[4/7] Assembling .app bundle..."
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Copy binaries
cp "$BINARY_PATH" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
cp "$MCP_BINARY_PATH" "$APP_BUNDLE/Contents/MacOS/CodeFireMCP"

# Copy icon
cp "$ICON_WORK/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"

# Write Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>
    <string>$APP_NAME</string>
    <key>CFBundleIdentifier</key>
    <string>$BUNDLE_ID</string>
    <key>CFBundleVersion</key>
    <string>$VERSION</string>
    <key>CFBundleShortVersionString</key>
    <string>$VERSION</string>
    <key>CFBundleExecutable</key>
    <string>$APP_NAME</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSSupportsAutomaticTermination</key>
    <false/>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>codefire</string>
            </array>
            <key>CFBundleURLName</key>
            <string>com.codefire.oauth</string>
        </dict>
    </array>
    <key>LSUIElement</key>
    <false/>
    <key>NSMicrophoneUsageDescription</key>
    <string>CodeFire needs microphone access to record meeting audio for transcription and task extraction.</string>
</dict>
</plist>
PLIST

# Write PkgInfo
echo -n "APPL????" > "$APP_BUNDLE/Contents/PkgInfo"

# Write entitlements (hardened runtime + required permissions)
ENTITLEMENTS="$BUILD_DIR/CodeFire.entitlements"
cat > "$ENTITLEMENTS" << 'ENTPLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.automation.apple-events</key>
    <true/>
</dict>
</plist>
ENTPLIST

# Step 5: Codesign with Developer ID (inside-out)
echo "[5/7] Codesigning with Developer ID..."
# Sign embedded binaries first
codesign --force --options runtime --sign "$SIGN_IDENTITY" \
    --entitlements "$ENTITLEMENTS" \
    "$APP_BUNDLE/Contents/MacOS/CodeFireMCP"
echo "  Signed CodeFireMCP"

codesign --force --options runtime --sign "$SIGN_IDENTITY" \
    --entitlements "$ENTITLEMENTS" \
    "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
echo "  Signed CodeFire"

# Sign the bundle itself
codesign --force --options runtime --sign "$SIGN_IDENTITY" \
    --entitlements "$ENTITLEMENTS" \
    "$APP_BUNDLE"
echo "  Signed $APP_NAME.app"

# Verify
codesign --verify --deep --strict "$APP_BUNDLE" 2>&1
echo "  Signature verified"

# Step 6: Create zip and notarize
echo "[6/7] Notarizing..."
ZIP_PATH="$BUILD_DIR/$APP_NAME-macOS.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$ZIP_PATH"
echo "  Archive: $(du -h "$ZIP_PATH" | awk '{print $1}')"

echo "  Submitting to Apple for notarization..."
xcrun notarytool submit "$ZIP_PATH" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait 2>&1 | tee "$BUILD_DIR/notarize.log"

# Check result
if grep -q "status: Accepted" "$BUILD_DIR/notarize.log"; then
    echo "  Notarization succeeded!"
else
    echo "  ERROR: Notarization failed. Check $BUILD_DIR/notarize.log"
    echo "  Run: xcrun notarytool log <submission-id> --keychain-profile $NOTARY_PROFILE"
    exit 1
fi

# Step 7: Staple the ticket and re-zip
echo "[7/7] Stapling notarization ticket..."
xcrun stapler staple "$APP_BUNDLE" 2>&1
echo "  Ticket stapled"

# Re-create zip with stapled app
rm -f "$ZIP_PATH"
ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$ZIP_PATH"
echo "  Final archive: $(du -h "$ZIP_PATH" | awk '{print $1}')"

# Cleanup
rm -rf "$ICON_WORK"
rm -rf "$BUILD_DIR/universal"
rm -f "$ENTITLEMENTS"
rm -f "$BUILD_DIR/notarize.log"

echo ""
echo "=== Done ==="
APP_SIZE=$(du -sh "$APP_BUNDLE" | awk '{print $1}')
echo "  $APP_BUNDLE ($APP_SIZE)"
echo "  Signed: $SIGN_IDENTITY"
echo "  Notarized and stapled"
echo ""
echo "To install:"
echo "  cp -r \"$APP_BUNDLE\" /Applications/"
echo ""
echo "Distribution zip:"
echo "  $ZIP_PATH"
