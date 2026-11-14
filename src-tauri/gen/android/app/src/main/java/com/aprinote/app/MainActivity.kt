package com.aprinote.app

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The window is edge to edge — Android enforces it at this target SDK — so left
 * alone it would draw aprinote's top bar under the status bar and let the soft
 * keyboard cover the line being typed.
 *
 * Both are fixed here rather than in CSS on purpose: a WebView reports
 * `env(safe-area-inset-*)` for display cutouts only, not for the system bars or
 * the IME, so the app's own stylesheet cannot see what it would need to avoid.
 * Padding the content view instead keeps the webview inside the usable window
 * and shrinks it when the keyboard opens, which is what an editor needs.
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) {
      view,
      insets ->
      // A union of the three takes the largest inset per side, so the bottom is
      // the navigation bar until the keyboard is taller than it.
      val edges =
        insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or
            WindowInsetsCompat.Type.displayCutout() or
            WindowInsetsCompat.Type.ime()
        )
      view.setPadding(edges.left, edges.top, edges.right, edges.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
