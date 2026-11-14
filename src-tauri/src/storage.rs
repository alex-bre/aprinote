//! Android only: the bridge to `StoragePlugin.kt`, which opens the system screen
//! where "All files access" is granted.
//!
//! An inline plugin rather than a crate of its own: the Kotlin class lives in
//! the app's committed Android project (`gen/android/app/src/main/java/...`),
//! so all this side does is register it and forward one call. The frontend
//! reaches it through `vault::vault_grant_any_path`, an app command, which keeps
//! it out of the capability files — plugin commands would each need a
//! permission entry there, app commands do not.

use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

pub struct Storage<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Storage<R> {
    /// Open the settings screen. Returns once it is on screen, not once the
    /// user has decided — Settings reports nothing back.
    pub fn open_settings(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("openSettings", ())
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("storage")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.aprinote.app", "StoragePlugin")?;
            app.manage(Storage(handle));
            Ok(())
        })
        .build()
}
