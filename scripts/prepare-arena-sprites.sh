#!/usr/bin/env bash
#
# prepare-arena-sprites.sh
# Copies and organizes sprite assets for the Agent Arena campfire visualization.
#
# Source: assets/character-pack-full_version/
# Output: shared/agent-arena/sprites/
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC_SPRITE="$ROOT_DIR/assets/character-pack-full_version/sprite"
SRC_SPLIT="$ROOT_DIR/assets/character-pack-full_version/sprite_split"
OUT_DIR="$ROOT_DIR/shared/agent-arena/sprites"

# Selected characters for the arena (diverse set from the 32 available)
CHARACTERS=(1 3 5 7 9 12 15 17 20 22 25 28)

# --- Validation ---

if [ ! -d "$SRC_SPRITE" ]; then
    echo "ERROR: Source sprite directory not found: $SRC_SPRITE"
    echo "Make sure assets/character-pack-full_version/ exists at the project root."
    exit 1
fi

if [ ! -d "$SRC_SPLIT" ]; then
    echo "ERROR: Source sprite_split directory not found: $SRC_SPLIT"
    exit 1
fi

# --- Setup ---

mkdir -p "$OUT_DIR"

COPIED=0
SKIPPED=0

# --- Copy campfire sprite ---

CAMPFIRE_SRC="$SRC_SPRITE/free_campfire.png"
if [ -f "$CAMPFIRE_SRC" ]; then
    cp "$CAMPFIRE_SRC" "$OUT_DIR/campfire.png"
    echo "  [OK] campfire.png"
    ((COPIED++))
else
    echo "  [SKIP] campfire sprite not found: $CAMPFIRE_SRC"
    ((SKIPPED++))
fi

# --- Copy character sprites (32x32 versions) ---

for N in "${CHARACTERS[@]}"; do
    CHAR_SRC="$SRC_SPLIT/character_${N}/character_${N}_frame32x32.png"
    if [ -f "$CHAR_SRC" ]; then
        cp "$CHAR_SRC" "$OUT_DIR/char_${N}.png"
        echo "  [OK] char_${N}.png"
        ((COPIED++))
    else
        echo "  [SKIP] character $N not found: $CHAR_SRC"
        ((SKIPPED++))
    fi
done

# --- Summary ---

echo ""
echo "=== Sprite Preparation Complete ==="
echo "  Output:  $OUT_DIR"
echo "  Copied:  $COPIED"
echo "  Skipped: $SKIPPED"
echo "  Total:   $((COPIED + SKIPPED))"
echo ""

ls -la "$OUT_DIR"

# --- Helper: Generate base64 data URIs ---
# Uncomment and run to produce base64-encoded data URIs for embedding in HTML.
#
# echo ""
# echo "=== Base64 Data URIs ==="
# for f in "$OUT_DIR"/*.png; do
#     NAME="$(basename "$f")"
#     B64="$(base64 < "$f")"
#     echo "/* $NAME */"
#     echo "data:image/png;base64,$B64"
#     echo ""
# done
