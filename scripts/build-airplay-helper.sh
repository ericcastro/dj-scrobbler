#!/bin/bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
source_file="$project_dir/native/airplay-helper.swift"
output_file="${1:-$project_dir/native/bin/dj-scrobbler-airplay}"
output_dir="$(dirname "$output_file")"
swiftc_path="$(xcrun --find swiftc)"
sdk_path="$(xcrun --show-sdk-path)"
module_cache="$(mktemp -d /private/tmp/dj-scrobbler-swift-cache.XXXXXX)"

cleanup() {
  rm -rf "$module_cache"
}
trap cleanup EXIT

mkdir -p "$output_dir"

if [[ "${2:-}" == "--universal" ]]; then
  arm_file="$output_file.arm64"
  intel_file="$output_file.x86_64"
  "$swiftc_path" -module-cache-path "$module_cache" -sdk "$sdk_path" -O -target arm64-apple-macosx11.0 -framework AppKit -framework AVKit -framework AVFoundation "$source_file" -o "$arm_file"
  "$swiftc_path" -module-cache-path "$module_cache" -sdk "$sdk_path" -O -target x86_64-apple-macosx11.0 -framework AppKit -framework AVKit -framework AVFoundation "$source_file" -o "$intel_file"
  xcrun lipo -create "$arm_file" "$intel_file" -output "$output_file"
  rm -f "$arm_file" "$intel_file"
else
  "$swiftc_path" -module-cache-path "$module_cache" -sdk "$sdk_path" -O -framework AppKit -framework AVKit -framework AVFoundation "$source_file" -o "$output_file"
fi

chmod +x "$output_file"
echo "Built $output_file"
