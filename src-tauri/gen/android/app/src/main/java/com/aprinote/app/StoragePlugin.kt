package com.aprinote.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

/**
 * The one thing the vault gate cannot do from a webview: send the user to the
 * system screen where "All files access" is switched on for aprinote.
 *
 * Registered from Rust (`src-tauri/src/storage.rs`) and reached through the
 * `vault_grant_any_path` command. It only opens the screen. Whether access was
 * granted is not reported back from here: the Settings screen returns no result,
 * and the question that matters is whether a write outside the sandbox works,
 * which `vault_any_path` answers by trying one. The gate asks again when the app
 * comes back to the foreground.
 */
@TauriPlugin
class StoragePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun openSettings(invoke: Invoke) {
    val app = Uri.fromParts("package", activity.packageName, null)

    // Android 11 and later: the per-app "All files access" toggle. Before that,
    // shared storage is the ordinary storage permission on the app's own page.
    val screens =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        listOf(
          Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, app),
          // Some vendor builds drop the per-app screen; the list of all apps
          // with the permission is the next best place to land.
          Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION),
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, app),
        )
      } else {
        listOf(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, app))
      }

    for (screen in screens) {
      try {
        activity.startActivity(screen)
        invoke.resolve()
        return
      } catch (_: ActivityNotFoundException) {
        // Try the next one.
      }
    }
    invoke.reject("This device has no settings screen for file access.")
  }
}
