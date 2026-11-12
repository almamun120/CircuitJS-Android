package com.circuitjs.android

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.webkit.WebViewAssetLoader
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.snackbar.Snackbar
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File

/**
 * Hosts the CircuitJS web simulator (assets/www) in a WebView and surrounds it with
 * native Android UI: a Material toolbar (run/pause, reset, undo, redo, file actions),
 * system file pickers, native dialogs, edge-to-edge layout and back-button handling.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var toolbar: MaterialToolbar
    private lateinit var progress: LinearProgressIndicator

    private val prefs by lazy { getSharedPreferences("settings", Context.MODE_PRIVATE) }
    private val autosaveFile by lazy { File(filesDir, "autosave.circuitjs.txt") }

    private var simLoaded = false
    private var fullscreen = false
    private var backArmed = false
    private val handler = Handler(Looper.getMainLooper())

    private var pendingSave: ByteArray? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    // ---------------------------------------------------------------- file pickers

    private class CreateDoc : ActivityResultContract<Pair<String, String>, Uri?>() {
        override fun createIntent(context: Context, input: Pair<String, String>) =
            Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(input.second)
                .putExtra(Intent.EXTRA_TITLE, input.first)

        override fun parseResult(resultCode: Int, intent: Intent?): Uri? =
            if (resultCode == android.app.Activity.RESULT_OK) intent?.data else null
    }

    private val openDocument =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) importFromUri(uri)
        }

    private val createDocument = registerForActivityResult(CreateDoc()) { uri ->
        val bytes = pendingSave
        pendingSave = null
        if (uri != null && bytes != null) {
            val ok = runCatching {
                contentResolver.openOutputStream(uri, "wt")!!.use { it.write(bytes) }
            }.isSuccess
            toast(if (ok) R.string.saved else R.string.save_failed)
        }
    }

    private val webFileChooser =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            fileChooserCallback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            )
            fileChooserCallback = null
        }

    // ------------------------------------------------------------------ lifecycle

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        toolbar = findViewById(R.id.toolbar)
        progress = findViewById(R.id.progress)
        webView = findViewById(R.id.webView)

        // Respect system bars / display cutout / keyboard.
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime()
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        setupToolbar()
        setupWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = onBack()
        })

        applyKeepScreenOn(prefs.getBoolean("keep_on", true))

        webView.loadUrl("$ASSET_ORIGIN/assets/www/circuitjs.html")
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        fileChooserCallback?.onReceiveValue(null)
        webView.apply {
            stopLoading()
            (parent as? ViewGroup)?.removeView(this)
            destroy()
        }
        super.onDestroy()
    }

    // -------------------------------------------------------------------- toolbar

    private fun setupToolbar() {
        toolbar.inflateMenu(R.menu.main_menu)
        toolbar.menu.findItem(R.id.action_keep_on).isChecked = prefs.getBoolean("keep_on", true)
        toolbar.setOnMenuItemClickListener(::onMenuItem)
    }

    private fun onMenuItem(item: MenuItem): Boolean {
        when (item.itemId) {
            R.id.action_run -> js("CircuitJS1.setSimRunning(!CircuitJS1.isRunning())")
            R.id.action_reset -> js("CircuitJS1.resetSim()")
            R.id.action_undo -> js("CircuitJS1.undo()")
            R.id.action_redo -> js("CircuitJS1.redo()")
            R.id.action_open -> openDocument.launch(arrayOf("*/*"))
            R.id.action_save -> withCircuitText { text ->
                pendingSave = text.toByteArray()
                createDocument.launch("circuit.circuitjs.txt" to "text/plain")
            }
            R.id.action_share -> withCircuitText { text ->
                val send = Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, text)
                startActivity(Intent.createChooser(send, getString(R.string.share_circuit)))
            }
            R.id.action_keep_on -> {
                item.isChecked = !item.isChecked
                prefs.edit().putBoolean("keep_on", item.isChecked).apply()
                applyKeepScreenOn(item.isChecked)
            }
            R.id.action_fullscreen -> setFullscreen(true)
            R.id.action_about -> MaterialAlertDialogBuilder(this)
                .setTitle(R.string.app_name)
                .setMessage(R.string.about_message)
                .setPositiveButton(R.string.ok, null)
                .show()
            else -> return false
        }
        return true
    }

    private fun updateRunIcon(running: Boolean) {
        toolbar.menu.findItem(R.id.action_run)?.apply {
            setIcon(if (running) R.drawable.ic_pause else R.drawable.ic_play)
            setTitle(if (running) R.string.pause else R.string.run)
        }
    }

    private fun applyKeepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun setFullscreen(on: Boolean) {
        fullscreen = on
        toolbar.isVisible = !on
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        if (on) {
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
            Snackbar.make(webView, R.string.exit_fullscreen_hint, Snackbar.LENGTH_SHORT).show()
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun onBack() {
        when {
            fullscreen -> setFullscreen(false)
            backArmed -> finish()
            else -> {
                backArmed = true
                toast(R.string.back_again)
                handler.postDelayed({ backArmed = false }, 2000)
            }
        }
    }

    // -------------------------------------------------------------------- WebView

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
            WebView.setWebContentsDebuggingEnabled(true)

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // simulator options are kept in localStorage
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)             // the simulator handles pinch-zoom itself
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100                    // ignore system font scale inside the canvas UI
        }
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isLongClickable = false
        webView.setOnLongClickListener { false }
        webView.addJavascriptInterface(Bridge(), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView, request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView, request: WebResourceRequest
            ): Boolean {
                if (request.url.host == ASSET_HOST) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: ActivityNotFoundException) {
                }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                if (newProgress >= 100 && simLoaded) progress.hide()
            }

            override fun onJsAlert(
                view: WebView, url: String, message: String, result: JsResult
            ): Boolean {
                MaterialAlertDialogBuilder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton(R.string.ok) { _, _ -> result.confirm() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }

            override fun onJsConfirm(
                view: WebView, url: String, message: String, result: JsResult
            ): Boolean {
                MaterialAlertDialogBuilder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton(R.string.ok) { _, _ -> result.confirm() }
                    .setNegativeButton(R.string.cancel) { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }

            override fun onJsPrompt(
                view: WebView, url: String, message: String, defaultValue: String?,
                result: JsPromptResult
            ): Boolean {
                val input = EditText(this@MainActivity).apply { setText(defaultValue ?: "") }
                MaterialAlertDialogBuilder(this@MainActivity)
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton(R.string.ok) { _, _ -> result.confirm(input.text.toString()) }
                    .setNegativeButton(R.string.cancel) { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }

            // <input type="file"> used by the simulator's own "Open File..." menu item.
            override fun onShowFileChooser(
                view: WebView, callback: ValueCallback<Array<Uri>>,
                params: WebChromeClient.FileChooserParams
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = callback
                return try {
                    webFileChooser.launch(params.createIntent())
                    true
                } catch (_: ActivityNotFoundException) {
                    fileChooserCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }
        }
    }

    /** Called from JavaScript (android-bridge.js) on a background thread. */
    inner class Bridge {
        @JavascriptInterface
        fun onSimLoaded() {
            runOnUiThread {
                simLoaded = true
                progress.hide()
            }
        }

        /** Current circuit, written by android-bridge.js whenever it changes. */
        @JavascriptInterface
        fun autosave(text: String) {
            runCatching {
                val tmp = File(filesDir, "autosave.tmp")
                tmp.writeText(text)
                tmp.renameTo(autosaveFile)
            }
        }

        /** Read synchronously by android-bridge.js before the simulator starts. */
        @JavascriptInterface
        fun getAutosave(): String =
            runCatching { if (autosaveFile.exists()) autosaveFile.readText() else "" }.getOrDefault("")

        @JavascriptInterface
        fun onRunState(running: Boolean) {
            runOnUiThread { updateRunIcon(running) }
        }

        @JavascriptInterface
        fun saveBase64(name: String, mime: String, base64: String) {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            runOnUiThread {
                pendingSave = bytes
                createDocument.launch(name to mime.ifBlank { "*/*" })
            }
        }
    }

    // ------------------------------------------------------------------- helpers

    private fun importFromUri(uri: Uri) {
        val text = runCatching {
            contentResolver.openInputStream(uri)!!.bufferedReader().use { it.readText() }
        }.getOrNull()
        if (text == null) {
            toast(R.string.open_failed)
            return
        }
        js("CircuitJS1.importCircuit(${jsString(text)}, false)")
    }

    private fun withCircuitText(block: (String) -> Unit) {
        webView.evaluateJavascript("(window.CircuitJS1 ? CircuitJS1.exportCircuit() : null)") { r ->
            decodeJsString(r)?.let(block)
        }
    }

    private fun js(code: String) {
        webView.evaluateJavascript(
            "(function(){try{if(window.CircuitJS1){$code}}catch(e){}})()", null
        )
    }

    private fun jsString(s: String): String =
        JSONObject.quote(s).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

    /** evaluateJavascript returns its result JSON-encoded; this unwraps a string result. */
    private fun decodeJsString(raw: String?): String? {
        if (raw == null || raw == "null") return null
        return runCatching { JSONTokener(raw).nextValue() as? String }.getOrNull()
    }

    private fun toast(res: Int) = Toast.makeText(this, res, Toast.LENGTH_SHORT).show()

    private companion object {
        const val ASSET_HOST = "appassets.androidplatform.net"
        const val ASSET_ORIGIN = "https://$ASSET_HOST"
    }
}
