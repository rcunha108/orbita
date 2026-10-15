#!/usr/bin/env bash
set -euo pipefail
# Cross-compilation tools only. Never modifies the system package database.
task_root="$(cd "$(dirname "$0")/.." && pwd)"
task_apt="$task_root/.tools/windows-apt"
task_tools="${WINDOWS_BUILD_TOOLS:-$task_root/../.tools/windows-build}"
mkdir -p "$task_apt/lists/partial" "$task_apt/cache/archives/partial" "$task_apt/packages" "$task_apt/empty" "$task_tools"
cat > "$task_apt/sources.list" <<'SOURCES'
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main
SOURCES
cat > "$task_apt/apt.conf" <<CONFIG
Dir::Etc::parts "$task_apt/empty";
Dir::Etc::main "-";
Dir::Etc::sourcelist "$task_apt/sources.list";
Dir::Etc::sourceparts "$task_apt/empty";
Dir::State::lists "$task_apt/lists";
Dir::Cache "$task_apt/cache";
Acquire::Languages "none";
APT::Update::Error-Mode "any";
CONFIG
export APT_CONFIG="$task_apt/apt.conf"
apt-get update
cd "$task_apt/packages"
apt-get download nsis=3.11-1 nsis-common=3.11-1 \
  gcc-mingw-w64-x86-64-posix=14.2.0-19+27+b1 \
  gcc-mingw-w64-x86-64-posix-runtime=14.2.0-19+27+b1 \
  gcc-mingw-w64-base=14.2.0-19+27+b1 \
  mingw-w64-x86-64-dev=12.0.0-5 mingw-w64-common=12.0.0-5 \
  binutils-mingw-w64-x86-64=2.44-3+12+b1 binutils-common=2.44-3
for task_package in ./*.deb; do dpkg-deb -x "$task_package" "$task_tools"; done
NSISDIR="$task_tools/usr/share/nsis" "$task_tools/usr/bin/makensis" -VERSION
"$task_tools/usr/bin/x86_64-w64-mingw32-gcc-posix" --version
