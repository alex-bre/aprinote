//! The app, shared by the desktop binary and the Android library.
//!
//! Everything the frontend can reach from here is in `vault.rs` — the native
//! `VaultAdapter` backend. The plugins cover what a webview cannot do for
//! itself: pick a folder (desktop only), hand a link to the real browser, and
//! open Android's "All files access" screen (`storage`, Android only).

#[cfg(target_os = "android")]
mod storage;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(vault::VaultState::default());

    // The folder picker, and so the plugin behind it, exists on desktop only
    // (see `vault::vault_pick`).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_dialog::init());

    // And on Android, the way to the "All files access" screen (see `storage`).
    #[cfg(target_os = "android")]
    let builder = builder.plugin(storage::init());

    builder
        .invoke_handler(tauri::generate_handler![
            vault::vault_env,
            vault::vault_probe,
            vault::vault_any_path,
            vault::vault_grant_any_path,
            vault::vault_pick,
            vault::vault_open,
            vault::vault_close,
            vault::vault_list,
            vault::vault_read,
            vault::vault_read_binary,
            vault::vault_write,
            vault::vault_write_binary,
            vault::vault_move,
            vault::vault_remove,
            vault::vault_mkdir,
            vault::vault_exists,
            vault::vault_stat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running aprinote");
}
