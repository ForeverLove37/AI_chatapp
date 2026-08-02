#!/usr/bin/env bash

# Source this file from the repository root before running Android or Gradle commands.
set -euo pipefail

ENV_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${ENV_SCRIPT_DIR}/.." && pwd)"

export JAVA_HOME="${PROJECT_ROOT}/.tooling/jdk"
export ANDROID_SDK_ROOT="${PROJECT_ROOT}/.tooling/android-sdk"
export ANDROID_HOME="${ANDROID_SDK_ROOT}"
export ANDROID_USER_HOME="${PROJECT_ROOT}/.tooling/android-user-home"
export ANDROID_AVD_HOME="${ANDROID_USER_HOME}/avd"
export GRADLE_USER_HOME="${PROJECT_ROOT}/.tooling/gradle-user-home"
export PATH="${JAVA_HOME}/bin:${ANDROID_SDK_ROOT}/platform-tools:${ANDROID_SDK_ROOT}/emulator:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${PATH}"
export GRADLE_OPTS="${GRADLE_OPTS:--Xmx2048m -Dfile.encoding=UTF-8}"
