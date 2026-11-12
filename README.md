# CircuitJS for Android (Kotlin)

Native Android shell around the CircuitJS1 circuit simulator (Paul Falstad / Iain Sharp, GPL v2).
The simulation engine is the original Java/GWT code compiled to JavaScript — rewriting ~190 classes
of simulator by hand would be error-prone — and it runs **offline** inside a WebView.
Everything around it is native Kotlin / Material 3:

* Toolbar: Run/Pause (icon follows sim state), Reset, Undo, Redo
* Overflow: Open file, Save to file, Share circuit (system pickers / share sheet), Keep screen on, Full screen, About
* Edge-to-edge layout, display-cutout and keyboard insets, light/dark system theme
* Native dialogs for JS alert/confirm/prompt, file chooser, blob downloads (Export, CSV, audio) → "Save as" picker
* Back button (exit full screen / press twice to exit), autosave & restore of the current circuit
* **Touch palette** under the toolbar: every Draw-menu component (133 items) as large scrollable chips grouped by category (Common, Passive, Sources, Outputs, Active, Blocks, Gates, Chips, Analog, Move/Select); tap to pick, then drag on the canvas to place. Collapsible with the ▲ button.
* Long-press (right-click menu) no longer gets cancelled by small finger wobble
* Pinch-zoom and drag are handled by the simulator's own touch code; viewport is mobile-sized

## Layout
```
app/                 Android app (Kotlin). MainActivity.kt is the whole shell.
android-web/         android-bridge.js (native <-> web glue)
web/                 Original CircuitJS source (src/, war/). Only change: CirSim.java gained
                     CircuitJS1.resetSim/undo/redo in the JS API (marked "added for the Android wrapper").
scripts/build_web.sh Compiles web/ with GWT and copies it to app/src/main/assets/www
```
`app/src/main/assets/www` already contains a compiled build, so you can open the project directly.

## Build
1. Open this folder in Android Studio (Ladybug or newer; JDK 17) and press Run — or `gradle assembleDebug`
   (Android Studio generates the Gradle wrapper on first sync).
2. To rebuild the simulator after editing `web/`: `scripts/build_web.sh` (JDK 11+, downloads GWT 2.11.0).

Requires Android 8.0 (API 26)+.

## GitHub Actions
`.github/workflows/android.yml` builds a debug and a signed release APK on every push/PR and
uploads them as the `CircuitJS-apks` artifact; pushing a tag like `v1.0` also attaches them to a GitHub Release.

Signing: add repository secrets `KEYSTORE_BASE64` (`base64 -w0 release.jks`), `KEYSTORE_PASSWORD`,
`KEY_ALIAS`, `KEY_PASSWORD` to use your own key (needed so updates install over older versions).
With no secrets, the workflow generates a temporary key and still signs the release APK.
