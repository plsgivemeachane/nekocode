#!/bin/sh
set -eu

app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
helper="$app_dir/chrome-sandbox"

# AppImage mounts cannot repair the bundled SUID helper in place. Match the
# development launcher's fallback only when this helper is misconfigured.
if [ -n "${APPIMAGE:-}" ] && [ -e "$helper" ]; then
  helper_permissions=$(stat -Lc '%u:%a' -- "$helper")
  if [ "$helper_permissions" != '0:4755' ]; then
    has_sandbox_override=0
    for arg in "$@"; do
      case "$arg" in
        --no-sandbox|--disable-setuid-sandbox) has_sandbox_override=1 ;;
      esac
    done
    if [ "$has_sandbox_override" -eq 0 ]; then
      # Prefer Chromium's namespace sandbox. AppArmor and kernel policy can
      # block it even when unprivileged_userns_clone is enabled.
      if command -v unshare >/dev/null 2>&1 && unshare -Urn -- true 2>/dev/null; then
        set -- --disable-setuid-sandbox "$@"
      else
        echo '[NekoCode] AppImage SUID helper is misconfigured and user namespaces are unavailable; disabling Chromium sandboxing for this run.' >&2
        set -- --no-sandbox "$@"
      fi
    fi
  fi
fi

exec "$app_dir/nekocode.bin" "$@"
