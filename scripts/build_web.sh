#!/usr/bin/env bash
# Compiles the GWT/Java simulator in web/ to JavaScript and copies it into the
# Android app's assets. Needs a JDK (11+) and, unless GWT_HOME is set, internet
# access to download GWT from GitHub.
set -euo pipefail

GWT_VERSION="${GWT_VERSION:-2.11.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${GWT_CACHE:-$ROOT/.gwt-cache}"
GWT_HOME="${GWT_HOME:-$CACHE/gwt-$GWT_VERSION}"
OUT="$ROOT/app/src/main/assets/www"

if [ ! -f "$GWT_HOME/gwt-dev.jar" ]; then
  mkdir -p "$CACHE"
  echo "Downloading GWT $GWT_VERSION ..."
  curl -fSL -o "$CACHE/gwt.zip" \
    "https://github.com/gwtproject/gwt/releases/download/$GWT_VERSION/gwt-$GWT_VERSION.zip"
  unzip -q -o "$CACHE/gwt.zip" -d "$CACHE"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Compiling simulator with GWT ..."
java -Xmx2g -cp "$ROOT/web/src:$GWT_HOME/gwt-dev.jar:$GWT_HOME/gwt-user.jar:$GWT_HOME/*" \
  com.google.gwt.dev.Compiler \
  -war "$WORK/war" -workDir "$WORK/work" -localWorkers 2 -logLevel WARN \
  com.lushprojects.circuitjs1.circuitjs1

echo "Copying web files into Android assets ..."
mkdir -p "$OUT"
# static pages/fonts/etc. from the original war folder (skip server-side bits)
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$ROOT/web/war/." "$OUT/"
rm -rf "$OUT/WEB-INF" "$OUT"/*.php
# compiled simulator
cp -r "$WORK/war/circuitjs1" "$OUT/circuitjs1"
# Android-specific: native bridge script + mobile viewport in the main page
cp "$ROOT/android-web/android-bridge.js" "$OUT/android-bridge.js"
sed -i 's|<head>|<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">\n<script src="android-bridge.js"></script>|' "$OUT/circuitjs.html"
grep -q android-bridge.js "$OUT/circuitjs.html" || { echo "failed to patch circuitjs.html"; exit 1; }
echo "Done: $OUT"
