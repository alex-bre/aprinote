//! The native half of the `VaultAdapter` port.
//!
//! Every command here is one method of the TypeScript `VaultAdapter` interface,
//! so the adapter in `src/vault/adapters/tauri.ts` is a thin `invoke` wrapper and
//! nothing above it knows which backend it is talking to.
//!
//! Two rules hold throughout:
//!
//! * **Paths are vault-relative, POSIX, and never escape the root.** The frontend
//!   only ever knows relative paths; `resolve` is the single place they become
//!   real ones, and it refuses `.`, `..` and anything that would climb out.
//! * **The open vault is server-side state.** The root is set once by `vault_open`
//!   and lives in `VaultState`, so no command takes an absolute path and a
//!   compromised webview cannot point the app at `/etc`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use base64::Engine as _;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

/// The vault the app currently has open. `None` until `vault_open` succeeds.
#[derive(Default)]
pub struct VaultState {
    root: Mutex<Option<PathBuf>>,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("No vault is open")]
    NoVault,
    #[error("{0} is not a path inside the vault")]
    BadPath(String),
    #[error("{0}")]
    Io(String),
    #[error("{0} is not valid UTF-8 text")]
    NotText(String),
    #[error("{0}")]
    Other(String),
}

/// Commands reject with the message, not a tagged enum: the gate and the status
/// bar show `error.message` as-is, and the frontend has no branch to make on the
/// variant (`src/store/vaultStore.ts`).
impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Error::Io(error.to_string())
    }
}

type Result<T> = std::result::Result<T, Error>;

// ---------------------------------------------------------------- paths

/// A vault-relative path made absolute, or an error.
///
/// Rejecting `.` and `..` outright — rather than normalising them away — keeps
/// this honest: the frontend never emits them, so one showing up is a bug or an
/// attack, and quietly resolving it would hide either.
fn resolve(root: &Path, relative: &str) -> Result<PathBuf> {
    let mut path = root.to_path_buf();
    for segment in relative.split('/').filter(|part| !part.is_empty()) {
        let bad = segment == "."
            || segment == ".."
            || segment.contains('\\')
            || segment.contains('\0')
            || (cfg!(windows) && segment.contains(':'));
        if bad {
            return Err(Error::BadPath(relative.to_string()));
        }
        path.push(segment);
    }
    // Belt and braces: nothing above may have escaped the root lexically.
    if !path.starts_with(root) {
        return Err(Error::BadPath(relative.to_string()));
    }
    Ok(path)
}

fn root_of(state: &State<'_, VaultState>) -> Result<PathBuf> {
    state
        .root
        .lock()
        .map_err(|_| Error::Other("vault state is poisoned".into()))?
        .clone()
        .ok_or(Error::NoVault)
}

fn target(state: &State<'_, VaultState>, relative: &str) -> Result<PathBuf> {
    let root = root_of(state)?;
    resolve(&root, relative)
}

// ---------------------------------------------------------------- environment

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Env {
    /// `android`, `ios`, `linux`, `macos` or `windows`.
    os: String,
    mobile: bool,
    /// False on Android and iOS, where there is no native directory picker —
    /// the dialog plugin has none, and SAF hands back a tree URI this adapter
    /// could not list or write into. The vault is reached by path instead.
    can_pick_folder: bool,
    /// Where a vault goes when the user does not choose: the app's own
    /// documents directory, which on Android is its external files directory
    /// (`Android/data/<id>/files/Documents`) — visible over USB, and needing no
    /// permission at all.
    default_root: String,
    /// True when an absolute path outside the app's own directories can be
    /// reached. On Android that is the "All files access" permission, which is
    /// off until the user grants it in system settings.
    can_use_any_path: bool,
}

#[tauri::command]
pub fn vault_env(app: AppHandle) -> Env {
    let os = std::env::consts::OS;
    let mobile = matches!(os, "android" | "ios");

    // `document_dir` is the app's own documents directory on mobile and the
    // user's on desktop; `app_local_data_dir` is the always-there fallback.
    let default_root = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_local_data_dir())
        .map(|dir| dir.join("aprinote"))
        .map(|dir| dir.to_string_lossy().into_owned())
        .unwrap_or_default();

    Env {
        os: os.to_string(),
        mobile,
        can_pick_folder: !mobile,
        default_root,
        can_use_any_path: can_use_any_path(),
    }
}

/// Whether the app may open a vault outside its own sandbox.
///
/// Desktop can always. Android can only with "All files access", and there is no
/// API that answers that question directly — so this probes shared storage the
/// same way a vault open would, which is the thing the answer is about anyway.
fn can_use_any_path() -> bool {
    if cfg!(not(target_os = "android")) {
        return true;
    }
    ["/storage/emulated/0", "/sdcard"]
        .iter()
        .any(|dir| probe_writable(Path::new(dir)).is_ok())
}

/// `can_use_any_path`, asked again. `vault_env` is read once per launch, and this
/// answer changes while the app runs: the gate asks after the user comes back
/// from the settings screen `vault_grant_any_path` opened.
///
/// Async, like the one below, so the probe stays off the main thread.
#[tauri::command]
pub async fn vault_any_path() -> bool {
    can_use_any_path()
}

/// Send the user to the system screen where "All files access" is turned on for
/// aprinote. Android only; elsewhere there is nothing to grant.
///
/// Async on purpose: a mobile plugin call blocks until the Kotlin side answers,
/// and that side runs on the main thread — where a synchronous command would
/// already be sitting, waiting.
#[tauri::command]
pub async fn vault_grant_any_path(app: AppHandle) -> Result<()> {
    #[cfg(target_os = "android")]
    {
        app.state::<crate::storage::Storage<tauri::Wry>>()
            .open_settings()
            .map_err(Error::Other)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    exists: bool,
    /// Whether a vault could be opened here — the directory is writable, or it
    /// does not exist yet and its parent is.
    usable: bool,
    /// Why not, when `usable` is false. Shown verbatim in the gate.
    note: Option<String>,
}

/// Can a vault live at this path? Answered before opening one, so the gate can
/// explain a refusal (an ungranted permission, a typo) instead of just failing.
#[tauri::command]
pub fn vault_probe(path: String) -> Probe {
    let path = PathBuf::from(&path);
    if path.as_os_str().is_empty() || path.is_relative() {
        return Probe { exists: false, usable: false, note: Some("Enter a full path.".into()) };
    }

    if path.is_dir() {
        return match probe_writable(&path) {
            Ok(()) => Probe { exists: true, usable: true, note: None },
            Err(error) => {
                Probe { exists: true, usable: false, note: Some(refusal(&error)) }
            }
        };
    }

    if path.exists() {
        return Probe {
            exists: true,
            usable: false,
            note: Some("That path is a file, not a folder.".into()),
        };
    }

    // Not there yet — opening will create it, if its parent allows.
    match path.parent() {
        Some(parent) if parent.is_dir() => match probe_writable(parent) {
            Ok(()) => Probe { exists: false, usable: true, note: None },
            Err(error) => Probe { exists: false, usable: false, note: Some(refusal(&error)) },
        },
        _ => Probe {
            exists: false,
            usable: false,
            note: Some("That folder's parent does not exist.".into()),
        },
    }
}

/// Write a file and delete it again. Nothing else actually answers the question:
/// on Android a directory can be listable, `access(W_OK)`-positive and still
/// refuse every write until the permission is granted.
fn probe_writable(dir: &Path) -> std::io::Result<()> {
    let probe = dir.join(".aprinote-write-probe");
    fs::write(&probe, b"")?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

fn refusal(error: &std::io::Error) -> String {
    if cfg!(target_os = "android") && error.kind() == std::io::ErrorKind::PermissionDenied {
        "Android has not granted aprinote access to this folder. Turn on \"All files access\" \
         for aprinote (Settings › Apps › Special app access), then try again."
            .into()
    } else {
        error.to_string()
    }
}

// ---------------------------------------------------------------- open / close

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    root: String,
    /// What the sidebar and title show — the folder's own name.
    name: String,
}

/// The desktop folder picker. `None` when the user dismissed it — and always
/// `None` on mobile, where `pick_folder` does not exist: Android's only
/// directory picker hands back a SAF tree URI, which is not a path this
/// adapter could list or write into. `vault_env().canPickFolder` tells the
/// frontend which world it is in, and the gate asks for a path instead.
///
/// Async on purpose: the blocking variant of this dialog deadlocks when it is
/// called from the main thread, which is where a synchronous command runs.
#[tauri::command]
pub async fn vault_pick(app: AppHandle) -> Option<String> {
    #[cfg(desktop)]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        app.dialog().file().pick_folder(move |picked| {
            let _ = send.send(picked);
        });
        let picked = receive.await.ok()??;
        return Some(picked.into_path().ok()?.to_string_lossy().into_owned());
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        None
    }
}

/// Open — and create, if need be — the vault at an absolute path.
#[tauri::command]
pub fn vault_open(state: State<'_, VaultState>, path: String) -> Result<Opened> {
    let root = PathBuf::from(&path);
    if root.is_relative() || root.as_os_str().is_empty() {
        return Err(Error::Other(format!("{path} is not a full path")));
    }

    fs::create_dir_all(&root).map_err(|error| Error::Io(refusal(&error)))?;
    probe_writable(&root).map_err(|error| Error::Io(refusal(&error)))?;

    let name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());

    *state.root.lock().map_err(|_| Error::Other("vault state is poisoned".into()))? =
        Some(root.clone());

    Ok(Opened { root: root.to_string_lossy().into_owned(), name })
}

#[tauri::command]
pub fn vault_close(state: State<'_, VaultState>) {
    if let Ok(mut root) = state.root.lock() {
        *root = None;
    }
}

// ---------------------------------------------------------------- files

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    /// `file` or `directory`, matching the TypeScript `Entry`.
    kind: &'static str,
}

#[tauri::command]
pub fn vault_list(state: State<'_, VaultState>, dir: String) -> Result<Vec<Entry>> {
    let base = target(&state, &dir)?;
    let mut entries = Vec::new();

    for entry in fs::read_dir(&base)? {
        let entry = entry?;
        // A name the frontend cannot round-trip is a name it could never read
        // back, so skip it rather than hand over a lossy one.
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else { continue };
        // `metadata` follows symlinks — a linked-in folder of notes should list
        // as the folder it points at.
        let Ok(meta) = entry.metadata() else { continue };

        entries.push(Entry {
            path: if dir.is_empty() { name.clone() } else { format!("{dir}/{name}") },
            name,
            kind: if meta.is_dir() { "directory" } else { "file" },
        });
    }
    Ok(entries)
}

#[tauri::command]
pub fn vault_read(state: State<'_, VaultState>, path: String) -> Result<String> {
    let file = target(&state, &path)?;
    let bytes = fs::read(&file)?;
    String::from_utf8(bytes).map_err(|_| Error::NotText(path))
}

/// Bytes straight down the raw IPC channel, not JSON.
///
/// This is the hot path — every image on a page is one call, on every page open
/// (`src/ui/DocPane.tsx`) — and a serialized `Vec<u8>` would cross as an array
/// of JSON numbers.
#[tauri::command]
pub fn vault_read_binary(state: State<'_, VaultState>, path: String) -> Result<Response> {
    let file = target(&state, &path)?;
    Ok(Response::new(fs::read(file)?))
}

#[tauri::command]
pub fn vault_write(state: State<'_, VaultState>, path: String, text: String) -> Result<()> {
    write_atomically(&target(&state, &path)?, text.as_bytes())
}

/// Base64 rather than raw bytes: a raw body would have to carry the path in an
/// IPC header, and binary writes are one-at-a-time user actions — an image
/// dropped on a page (`src/vault/vault.ts`) — so the 4/3 is paid once and never
/// in a loop. Reads, which are the hot path, use the raw channel above.
#[tauri::command]
pub fn vault_write_binary(
    state: State<'_, VaultState>,
    path: String,
    data: String,
) -> Result<()> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|error| Error::Other(format!("not valid base64: {error}")))?;
    write_atomically(&target(&state, &path)?, &bytes)
}

/// Write to a sibling temp file, then rename over the target.
///
/// Autosave fires every 800ms and the OS can kill a phone app between any two
/// syscalls; a plain truncating write would leave a half-written note on disk,
/// and the note *is* the file. A stray `.name.tmp` left by a crash is inert —
/// the tree only ever shows `.html`.
fn write_atomically(file: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }

    let name = file.file_name().and_then(|name| name.to_str()).unwrap_or("vault-write");
    let temp = file.with_file_name(format!(".{name}.tmp"));

    fs::write(&temp, bytes)?;
    if let Err(error) = fs::rename(&temp, file) {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    Ok(())
}

#[tauri::command]
pub fn vault_move(state: State<'_, VaultState>, from: String, to: String) -> Result<()> {
    let source = target(&state, &from)?;
    let destination = target(&state, &to)?;

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }

    match fs::rename(&source, &destination) {
        Ok(()) => Ok(()),
        // Renaming across filesystems fails even on the same device — an SD card
        // vault and app storage, say. Copy and unlink instead.
        Err(_) => {
            copy_recursively(&source, &destination)?;
            remove_path(&source)
        }
    }
}

fn copy_recursively(source: &Path, destination: &Path) -> Result<()> {
    if source.is_dir() {
        fs::create_dir_all(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_recursively(&entry.path(), &destination.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(source, destination)?;
        Ok(())
    }
}

#[tauri::command]
pub fn vault_remove(state: State<'_, VaultState>, path: String) -> Result<()> {
    remove_path(&target(&state, &path)?)
}

fn remove_path(path: &Path) -> Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[tauri::command]
pub fn vault_mkdir(state: State<'_, VaultState>, path: String) -> Result<()> {
    fs::create_dir_all(target(&state, &path)?)?;
    Ok(())
}

#[tauri::command]
pub fn vault_exists(state: State<'_, VaultState>, path: String) -> Result<bool> {
    Ok(target(&state, &path)?.exists())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stat {
    /// Epoch milliseconds, like `File.lastModified` — the conflict check in
    /// `vaultStore` compares it against the mtime the page was read at.
    last_modified: f64,
    size: f64,
}

#[tauri::command]
pub fn vault_stat(state: State<'_, VaultState>, path: String) -> Result<Option<Stat>> {
    let file = target(&state, &path)?;
    // Absent is `None`, not an error: `stat` is how the app asks whether a file
    // is there and how fresh it is at once.
    let Ok(meta) = fs::metadata(&file) else { return Ok(None) };
    if meta.is_dir() {
        return Ok(None);
    }

    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as f64)
        .unwrap_or(0.0);

    Ok(Some(Stat { last_modified: modified, size: meta.len() as f64 }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_paths_under_the_root() {
        let root = Path::new("/vault");
        assert_eq!(resolve(root, "a/b.html").unwrap(), Path::new("/vault/a/b.html"));
        assert_eq!(resolve(root, "").unwrap(), root);
        // A leading or doubled slash is slack, not an escape.
        assert_eq!(resolve(root, "/a//b.html").unwrap(), Path::new("/vault/a/b.html"));
    }

    #[test]
    fn refuses_to_climb_out_of_the_vault() {
        let root = Path::new("/vault");
        for path in ["..", "../etc/passwd", "a/../../etc", "./a", "a/b/..", "a\\b", "a\0b"] {
            assert!(resolve(root, path).is_err(), "{path} should be refused");
        }
    }

    #[test]
    fn writes_land_atomically_and_leave_no_temp_file() {
        let dir = std::env::temp_dir().join(format!("aprinote-test-{}", std::process::id()));
        let file = dir.join("deep/page.html");

        write_atomically(&file, b"<p>one</p>").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "<p>one</p>");

        write_atomically(&file, b"<p>two</p>").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "<p>two</p>");

        let leftovers: Vec<_> = fs::read_dir(dir.join("deep"))
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "a temp file survived the write");

        fs::remove_dir_all(&dir).unwrap();
    }
}
