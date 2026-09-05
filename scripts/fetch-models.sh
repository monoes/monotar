#!/usr/bin/env bash
set -euo pipefail

MODELS_DIR="${MODELS_DIR:-./models}"
mkdir -p "$MODELS_DIR/wav2lip" "$MODELS_DIR/musetalk"

echo "Model weights are intentionally NOT committed to git (spec §23)."
echo "This script documents where they must be placed; it does not download"
echo "copyrighted/gated model weights automatically without explicit user action,"
echo "since several of these require accepting upstream license terms first."
echo ""
echo "Wav2Lip: download 'wav2lip_gan.pth' from the Wav2Lip repo's documented"
echo "  release location and place it at: $MODELS_DIR/wav2lip/wav2lip_gan.pth"
echo ""
echo "MuseTalk: follow external/MuseTalk/README.md's model download instructions"
echo "  and place the resulting weights under: $MODELS_DIR/musetalk/"
echo ""
echo "After placing weights, verify with:"
echo "  test -f $MODELS_DIR/wav2lip/wav2lip_gan.pth && echo 'Wav2Lip: OK' || echo 'Wav2Lip: MISSING'"
