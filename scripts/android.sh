#!/usr/bin/env bash
# The Android build, with the toolchain paths already in place.
#
#   npm run android:init    one-off: generate src-tauri/gen/android
#   npm run android:dev     live reload onto a device over adb
#   npm run android:apk     a debug APK you can sideload
#
# scripts/setup-android.sh installs what scripts/android-env.sh points at. Pass
# anything else straight through: `bash scripts/android.sh build --release`.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/android-env.sh
source scripts/android-env.sh

if [ ! -d "${NDK_HOME:-/nonexistent}" ]; then
  echo "No Android NDK found. Run: bash scripts/setup-android.sh" >&2
  exit 1
fi

command="${1:-apk}"
shift || true

case "$command" in
  init)
    # --skip-targets-install: setup-android.sh already added the rustup targets,
    # and the CLI's own installer wants a writable rustup it may not have in CI.
    npx tauri android init --skip-targets-install "$@"
    ;;

  dev)
    npx tauri android dev "$@"
    ;;

  apk)
    # Release, and signed: the project signs a release APK with a real key when
    # gen/android/keystore.properties names one and with Gradle's debug key when
    # it does not, so the result installs on a phone either way. A debug APK
    # installs too but carries an unoptimised .so with full debug info — 130MB
    # of it — so it is the fallback rather than the default:
    #
    #   npm run android:apk -- --debug
    npx tauri android build --apk "$@"

    apk="$(find src-tauri/gen/android/app/build/outputs/apk -name '*.apk' -newermt '-20 minutes' 2>/dev/null | sort | head -1 || true)"
    if [ -n "$apk" ]; then
      printf '\n\033[1mAPK:\033[0m %s (%s)\n' "$apk" "$(du -h "$apk" | cut -f1)"
    fi
    ;;

  *)
    npx tauri android "$command" "$@"
    ;;
esac
