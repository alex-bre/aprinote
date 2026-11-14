#!/usr/bin/env bash
# Installs everything `npm run android:*` needs: a Rust toolchain with the four
# Android targets, the Android SDK (platform + build-tools + NDK) and a JDK the
# Gradle plugin accepts. Idempotent — re-running it only fills in what is missing.
#
# It writes no project files. The paths it exports are the ones scripts/android-env.sh
# re-exports for every build, so the two must agree.
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
NDK_VERSION="${NDK_VERSION:-27.2.12479018}"
# The platform and build-tools the generated Gradle project asks for. Gradle
# fetches what it needs on its own, so these only decide whether the first
# build waits for a download.
PLATFORM="${PLATFORM:-android-37}"
BUILD_TOOLS="${BUILD_TOOLS:-37.0.0}"
CMDLINE_TOOLS_ZIP="commandlinetools-linux-11076708_latest.zip"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- Rust
if ! command -v rustup >/dev/null 2>&1 && [ ! -x "$HOME/.cargo/bin/rustup" ]; then
  say "Installing Rust"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal
fi
export PATH="$HOME/.cargo/bin:$PATH"

say "Adding the Android targets"
rustup target add \
  aarch64-linux-android \
  armv7-linux-androideabi \
  i686-linux-android \
  x86_64-linux-android

# ---------------------------------------------------------------- Android SDK
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  say "Installing the Android command-line tools into $ANDROID_HOME"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  tmp="$(mktemp -d)"
  curl -sSL -o "$tmp/tools.zip" "https://dl.google.com/android/repository/$CMDLINE_TOOLS_ZIP"
  unzip -q "$tmp/tools.zip" -d "$tmp"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -rf "$tmp"
fi

# sdkmanager needs a JDK of its own, and the one on PATH may be too new for it.
# ANDROID_JAVA_HOME wins, then an sdkman 21, then a JAVA_HOME that already is 21
# (what actions/setup-java leaves behind). `|| true`: finding nothing is the
# case the message below is for, not a reason for pipefail to exit silently.
jdk="${ANDROID_JAVA_HOME:-$(ls -d /usr/local/sdkman/candidates/java/21* 2>/dev/null | head -1 || true)}"
if [ -z "$jdk" ] && [ -x "${JAVA_HOME:-/nonexistent}/bin/java" ] \
  && "$JAVA_HOME/bin/java" -version 2>&1 | grep -q 'version "21'; then
  jdk="$JAVA_HOME"
fi
JAVA_HOME="$jdk"
if [ -z "$JAVA_HOME" ] || [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "No JDK 21 found. Install one (sdk install java 21.0.10-ms) or set ANDROID_JAVA_HOME." >&2
  exit 1
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

say "Installing SDK packages (this is the slow part)"
sdk="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
yes | "$sdk" --licenses >/dev/null 2>&1 || true
"$sdk" --install \
  "platform-tools" \
  "platforms;$PLATFORM" \
  "build-tools;$BUILD_TOOLS" \
  "ndk;$NDK_VERSION"

say "Done"
cat <<MSG
Toolchain is in place:
  ANDROID_HOME  $ANDROID_HOME
  NDK_HOME      $ANDROID_HOME/ndk/$NDK_VERSION
  JAVA_HOME     $JAVA_HOME

The npm scripts source scripts/android-env.sh, so no shell setup is needed.
To use the tools by hand in this shell:  source scripts/android-env.sh
MSG
