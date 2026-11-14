# Exports the Android toolchain paths. Sourced by the android:* npm scripts, and
# usable by hand: `source scripts/android-env.sh`.
#
# scripts/setup-android.sh installs what this points at. Override any of the
# three in your environment and that wins.
#
# The callers run under `set -euo pipefail`, and so does this file once sourced.
# Every lookup below is allowed to find nothing — `ls` then exits 2, pipefail
# hands that to the assignment and `set -e` would end the whole build with no
# message at all — so each one ends in `|| true` and an empty result is dealt
# with by whoever needs the path.

ANDROID_SDK="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_HOME="$ANDROID_SDK"
export ANDROID_SDK_ROOT="$ANDROID_SDK"

if [ -z "${NDK_HOME:-}" ]; then
  # Whatever NDK is installed, newest first — no version pinned in two places.
  NDK_HOME="$(ls -d "$ANDROID_SDK"/ndk/* 2>/dev/null | sort -V | tail -1 || true)"
  export NDK_HOME
fi

# Gradle's Android plugin rejects a JDK newer than it knows, and the one on PATH
# in a dev container is often the newest there is. Prefer a 21 if it is around.
if [ -z "${ANDROID_JAVA_HOME:-}" ]; then
  ANDROID_JAVA_HOME="$(ls -d /usr/local/sdkman/candidates/java/21* 2>/dev/null | head -1 || true)"
fi
if [ -n "${ANDROID_JAVA_HOME:-}" ] && [ -x "$ANDROID_JAVA_HOME/bin/java" ]; then
  export JAVA_HOME="$ANDROID_JAVA_HOME"
fi

export PATH="$HOME/.cargo/bin:${JAVA_HOME:+$JAVA_HOME/bin:}$ANDROID_SDK/platform-tools:$PATH"
