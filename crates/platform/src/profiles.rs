//! Profile storage (BE-001 Q-10).
//!
//! - One JSON file per profile: `<root>/<toolId>/<name>.json`.
//! - Names: at most 64 characters, none of `\ / : * ? " < > |`, unique per tool ignoring case.
//!   Additionally rejected because Windows cannot store them as file names: control
//!   characters, leading/trailing spaces, a trailing dot, and reserved device names (CON, NUL, COM1...).
//! - Documents are JSON objects with `schemaVersion` (number) and `name` (string). The file
//!   name is authoritative for `name`. A `schemaVersion` above the supported one is rejected
//!   with [`ProfileError::UnsupportedSchema`].
//! - Writes are atomic: a temporary file in the same directory, then a rename.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

pub const MAX_PROFILE_NAME_CHARS: usize = 64;
const FORBIDDEN: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
const EXTENSION: &str = "json";

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProfileError {
    /// The message is user-facing.
    #[error("{0}")]
    InvalidName(String),
    #[error("Invalid tool id \"{0}\".")]
    InvalidToolId(String),
    #[error("A profile named \"{0}\" already exists.")]
    Exists(String),
    #[error("Profile \"{0}\" was not found.")]
    NotFound(String),
    #[error("Profile \"{name}\" was saved by a newer version of ESEfact (profile version {found}, supported {supported}).")]
    UnsupportedSchema {
        name: String,
        found: u64,
        supported: u32,
    },
    #[error("Profile \"{name}\" cannot be read: {detail}")]
    Invalid { name: String, detail: String },
    #[error("{0}")]
    Io(String),
}

impl From<std::io::Error> for ProfileError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

/// One listed profile. `document` holds the parsed profile or why it cannot be opened.
#[derive(Debug, Clone, PartialEq)]
pub struct ProfileEntry<T> {
    pub name: String,
    /// File modification time, ms since the Unix epoch.
    pub modified_at_ms: u64,
    pub document: Result<T, ProfileError>,
}

/// Validates a profile name (Q-10 rules plus Windows file-name limits).
///
/// # Errors
/// [`ProfileError::InvalidName`] with a user-facing message.
pub fn validate_profile_name(name: &str) -> Result<(), ProfileError> {
    let err = |m: &str| Err(ProfileError::InvalidName(m.to_owned()));
    if name.trim().is_empty() {
        return err("Enter a profile name.");
    }
    if name.chars().count() > MAX_PROFILE_NAME_CHARS {
        return err("Profile name must be at most 64 characters.");
    }
    if name.contains(FORBIDDEN) {
        return err("Profile name cannot contain \\ / : * ? \" < > |");
    }
    if name.chars().any(char::is_control) {
        return err("Profile name cannot contain control characters.");
    }
    if name.trim() != name {
        return err("Profile name cannot start or end with a space.");
    }
    if name.starts_with('.') {
        // Hidden-file style names; also keeps `.` and `..` out (REV-001 F3).
        return err("Profile name cannot start with a dot.");
    }
    if name.ends_with('.') {
        return err("Profile name cannot end with a dot.");
    }
    let stem = name.split('.').next().unwrap_or(name).trim_end();
    let upper = stem.to_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL") || {
        // COM1-9 and LPT1-9, plus the superscript digits Windows also reserves (REV-001 N1).
        let chars: Vec<char> = upper.chars().collect();
        chars.len() == 4
            && (upper.starts_with("COM") || upper.starts_with("LPT"))
            && matches!(chars[3], '1'..='9' | '\u{00B9}' | '\u{00B2}' | '\u{00B3}')
    };
    if reserved {
        return Err(ProfileError::InvalidName(format!(
            "\"{stem}\" is reserved by Windows and cannot be used as a profile name."
        )));
    }
    Ok(())
}

fn validate_tool_id(tool_id: &str) -> Result<(), ProfileError> {
    let ok = !tool_id.is_empty()
        && tool_id.len() <= 64
        && tool_id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !tool_id.starts_with('-');
    if ok {
        Ok(())
    } else {
        Err(ProfileError::InvalidToolId(tool_id.to_owned()))
    }
}

fn same_name(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// File-based profile store rooted at `<data dir>/profiles`.
#[derive(Debug, Clone)]
pub struct ProfileStore {
    root: PathBuf,
    schema_version: u32,
}

impl ProfileStore {
    /// `schema_version` is the version this build writes and the highest it reads.
    #[must_use]
    pub fn new(root: impl Into<PathBuf>, schema_version: u32) -> Self {
        Self {
            root: root.into(),
            schema_version,
        }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    fn tool_dir(&self, tool_id: &str) -> Result<PathBuf, ProfileError> {
        validate_tool_id(tool_id)?;
        Ok(self.root.join(tool_id))
    }

    /// Profile files of a tool as `(name, path)`. A missing directory is empty.
    fn files(&self, tool_id: &str) -> Result<Vec<(String, PathBuf)>, ProfileError> {
        let dir = self.tool_dir(tool_id)?;
        let read = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut out = Vec::new();
        for entry in read {
            let path = entry?.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some(EXTENSION) {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            // Temporary files end in `.part` and are already excluded by the extension.
            // Every other `*.json` is listed, so list/get/delete agree (REV-001 F3).
            out.push((stem.to_owned(), path));
        }
        out.sort_by_key(|(name, _)| name.to_lowercase());
        Ok(out)
    }

    fn find(&self, tool_id: &str, name: &str) -> Result<Option<(String, PathBuf)>, ProfileError> {
        Ok(self
            .files(tool_id)?
            .into_iter()
            .find(|(n, _)| same_name(n, name)))
    }

    /// Lists every profile of a tool, sorted by name (case-insensitive).
    ///
    /// # Errors
    /// [`ProfileError::InvalidToolId`] or [`ProfileError::Io`].
    pub fn list<T: DeserializeOwned>(
        &self,
        tool_id: &str,
    ) -> Result<Vec<ProfileEntry<T>>, ProfileError> {
        self.list_with(tool_id, decode_serde)
    }

    /// Like [`ProfileStore::list`], decoding each document with `decode` (for example a
    /// schema migration). `decode` gets the JSON object with `name` set from the file name
    /// and a `schemaVersion` no higher than the supported one.
    ///
    /// # Errors
    /// [`ProfileError::InvalidToolId`] or [`ProfileError::Io`].
    pub fn list_with<T>(
        &self,
        tool_id: &str,
        decode: impl Fn(Value) -> Result<T, String>,
    ) -> Result<Vec<ProfileEntry<T>>, ProfileError> {
        Ok(self
            .files(tool_id)?
            .into_iter()
            .map(|(name, path)| {
                let modified_at_ms = fs::metadata(&path)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
                let document = self.read(&name, &path, &decode);
                ProfileEntry {
                    name,
                    modified_at_ms,
                    document,
                }
            })
            .collect())
    }

    /// Reads one profile (name matched ignoring case).
    ///
    /// # Errors
    /// `NotFound`, `UnsupportedSchema`, `Invalid`, `InvalidToolId`, `Io`.
    pub fn get<T: DeserializeOwned>(&self, tool_id: &str, name: &str) -> Result<T, ProfileError> {
        self.get_with(tool_id, name, decode_serde)
    }

    /// Like [`ProfileStore::get`], decoding the document with `decode`.
    ///
    /// # Errors
    /// `NotFound`, `UnsupportedSchema`, `Invalid` (also when `decode` fails),
    /// `InvalidToolId`, `Io`.
    pub fn get_with<T>(
        &self,
        tool_id: &str,
        name: &str,
        decode: impl Fn(Value) -> Result<T, String>,
    ) -> Result<T, ProfileError> {
        let (stored, path) = self
            .find(tool_id, name)?
            .ok_or_else(|| ProfileError::NotFound(name.to_owned()))?;
        self.read(&stored, &path, &decode)
    }

    fn read<T>(
        &self,
        name: &str,
        path: &Path,
        decode: &impl Fn(Value) -> Result<T, String>,
    ) -> Result<T, ProfileError> {
        let invalid = |detail: String| ProfileError::Invalid {
            name: name.to_owned(),
            detail,
        };
        let text = fs::read_to_string(path)?;
        let mut value: Value = serde_json::from_str(&text).map_err(|e| invalid(e.to_string()))?;
        let obj = value
            .as_object_mut()
            .ok_or_else(|| invalid("not a JSON object".into()))?;
        let version = obj
            .get("schemaVersion")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("missing schemaVersion".into()))?;
        if version > u64::from(self.schema_version) {
            return Err(ProfileError::UnsupportedSchema {
                name: name.to_owned(),
                found: version,
                supported: self.schema_version,
            });
        }
        obj.insert("name".into(), Value::String(name.to_owned()));
        decode(value).map_err(invalid)
    }

    /// Saves `document` as `name`. With `overwrite = false` an existing profile with the
    /// same name (ignoring case) is an error; with `true` it is replaced (and renamed to
    /// the new spelling). `schemaVersion` and `name` are set by the store.
    ///
    /// # Errors
    /// `InvalidName`, `Exists`, `Invalid` (document is not an object), `InvalidToolId`, `Io`.
    pub fn save<T: Serialize>(
        &self,
        tool_id: &str,
        name: &str,
        document: &T,
        overwrite: bool,
    ) -> Result<(), ProfileError> {
        validate_profile_name(name)?;
        let dir = self.tool_dir(tool_id)?;
        let mut value =
            serde_json::to_value(document).map_err(|e| ProfileError::Io(e.to_string()))?;
        let obj = value.as_object_mut().ok_or_else(|| ProfileError::Invalid {
            name: name.to_owned(),
            detail: "not a JSON object".into(),
        })?;
        obj.insert("schemaVersion".into(), Value::from(self.schema_version));
        obj.insert("name".into(), Value::String(name.to_owned()));

        let existing = self.find(tool_id, name)?;
        if existing.is_some() && !overwrite {
            return Err(ProfileError::Exists(
                existing.map_or_else(|| name.to_owned(), |e| e.0),
            ));
        }
        fs::create_dir_all(&dir)?;
        let target = dir.join(format!("{name}.{EXTENSION}"));
        let text =
            serde_json::to_string_pretty(&value).map_err(|e| ProfileError::Io(e.to_string()))?;
        match existing {
            Some((_, old_path)) => {
                write_atomic(&dir, &old_path, text.as_bytes())?;
                if old_path != target {
                    fs::rename(&old_path, &target)?; // spelling (case) change
                }
            }
            None if overwrite => write_atomic(&dir, &target, text.as_bytes())?,
            // Another window may create the same name between `find` and here (REV-001
            // N2): create without replacing, so only one of them succeeds.
            None => write_new(&dir, &target, text.as_bytes()).map_err(|e| match e {
                CreateError::Exists => self.exists_error(tool_id, name),
                CreateError::Io(e) => e,
            })?,
        }
        Ok(())
    }

    fn exists_error(&self, tool_id: &str, name: &str) -> ProfileError {
        let stored = self
            .find(tool_id, name)
            .ok()
            .flatten()
            .map_or_else(|| name.to_owned(), |(n, _)| n);
        ProfileError::Exists(stored)
    }

    /// Renames a profile. Renaming to a different spelling of the same name is allowed.
    ///
    /// # Errors
    /// `InvalidName`, `NotFound`, `Exists`, `Invalid`, `InvalidToolId`, `Io`.
    pub fn rename(
        &self,
        tool_id: &str,
        old_name: &str,
        new_name: &str,
    ) -> Result<(), ProfileError> {
        validate_profile_name(new_name)?;
        let dir = self.tool_dir(tool_id)?;
        let (stored, old_path) = self
            .find(tool_id, old_name)?
            .ok_or_else(|| ProfileError::NotFound(old_name.to_owned()))?;
        if !same_name(&stored, new_name) {
            if let Some((other, _)) = self.find(tool_id, new_name)? {
                return Err(ProfileError::Exists(other));
            }
        }
        let text = fs::read_to_string(&old_path)?;
        let mut value: Value = serde_json::from_str(&text).map_err(|e| ProfileError::Invalid {
            name: stored.clone(),
            detail: e.to_string(),
        })?;
        if let Some(obj) = value.as_object_mut() {
            obj.insert("name".into(), Value::String(new_name.to_owned()));
        }
        let text =
            serde_json::to_string_pretty(&value).map_err(|e| ProfileError::Io(e.to_string()))?;
        write_atomic(&dir, &old_path, text.as_bytes())?;
        let target = dir.join(format!("{new_name}.{EXTENSION}"));
        if old_path == target {
            return Ok(());
        }
        if same_name(&stored, new_name) {
            fs::rename(&old_path, &target)?; // spelling (case) change of the same file
            return Ok(());
        }
        // Move without replacing a profile created meanwhile by another window.
        match link_new(&old_path, &target) {
            Ok(()) => fs::remove_file(&old_path)?,
            Err(CreateError::Exists) => return Err(self.exists_error(tool_id, new_name)),
            Err(CreateError::Io(e)) => return Err(e),
        }
        Ok(())
    }

    /// Deletes a profile (name matched ignoring case).
    ///
    /// # Errors
    /// `NotFound`, `InvalidToolId`, `Io`.
    pub fn delete(&self, tool_id: &str, name: &str) -> Result<(), ProfileError> {
        let (_, path) = self
            .find(tool_id, name)?
            .ok_or_else(|| ProfileError::NotFound(name.to_owned()))?;
        fs::remove_file(path)?;
        Ok(())
    }
}

fn decode_serde<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| e.to_string())
}

enum CreateError {
    Exists,
    Io(ProfileError),
}

/// Makes `target` refer to `src` only if `target` does not exist yet. Uses a hard link,
/// which fails atomically when the name exists (case-insensitively on Windows). On file
/// systems without hard links it falls back to check-then-rename (small race window).
fn link_new(src: &Path, target: &Path) -> Result<(), CreateError> {
    match fs::hard_link(src, target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(CreateError::Exists),
        Err(_) if target.exists() => Err(CreateError::Exists),
        Err(_) => fs::rename(src, target).map_err(|e| CreateError::Io(e.into())),
    }
}

/// Like [`write_atomic`] but fails with [`CreateError::Exists`] instead of replacing.
fn write_new(dir: &Path, target: &Path, bytes: &[u8]) -> Result<(), CreateError> {
    let tmp = temp_path(dir);
    let written = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()
    })();
    let result = match written {
        Ok(()) => link_new(&tmp, target),
        Err(e) => Err(CreateError::Io(e.into())),
    };
    let _ = fs::remove_file(&tmp); // gone already if `link_new` fell back to a rename
    result
}

fn temp_path(dir: &Path) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    dir.join(format!(".tmp-{}-{n}.{EXTENSION}.part", std::process::id()))
}

/// Writes `bytes` to a temporary file in `dir`, flushes it to disk, then renames it over
/// `target` (replacing it atomically on Windows and Unix).
fn write_atomic(dir: &Path, target: &Path, bytes: &[u8]) -> Result<(), ProfileError> {
    let tmp = temp_path(dir);
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Doc {
        schema_version: u32,
        name: String,
        value: u32,
    }

    fn doc(name: &str, value: u32) -> Doc {
        Doc {
            schema_version: 1,
            name: name.into(),
            value,
        }
    }

    const TOOL: &str = "modbus-master";

    fn store() -> (tempfile::TempDir, ProfileStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(dir.path().join("profiles"), 1);
        (dir, store)
    }

    #[test]
    fn name_rules() {
        let msg = |n: &str| validate_profile_name(n).unwrap_err().to_string();
        assert!(validate_profile_name("Boiler-PLC").is_ok());
        assert!(validate_profile_name(&"a".repeat(64)).is_ok());
        assert!(validate_profile_name("Pump 2 (old).v1").is_ok());
        assert_eq!(msg(""), "Enter a profile name.");
        assert_eq!(msg("   "), "Enter a profile name.");
        assert_eq!(
            msg(&"a".repeat(65)),
            "Profile name must be at most 64 characters."
        );
        for bad in [
            "a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b",
        ] {
            assert_eq!(
                msg(bad),
                "Profile name cannot contain \\ / : * ? \" < > |",
                "{bad}"
            );
        }
        assert!(validate_profile_name("a\tb").is_err());
        assert!(validate_profile_name(" a").is_err());
        assert!(validate_profile_name("a.").is_err());
        for reserved in ["CON", "con", "nul.cfg", "COM1", "lpt9"] {
            assert!(validate_profile_name(reserved).is_err(), "{reserved}");
        }
        assert!(validate_profile_name("COM10").is_ok());
        assert!(validate_profile_name("Console").is_ok());
    }

    #[test]
    fn leading_dot_and_superscript_device_names() {
        let msg = |n: &str| validate_profile_name(n).unwrap_err().to_string();
        // REV-001 F3
        assert_eq!(msg(".hidden"), "Profile name cannot start with a dot.");
        assert_eq!(msg("."), "Profile name cannot start with a dot.");
        assert_eq!(msg(".."), "Profile name cannot start with a dot.");
        assert!(validate_profile_name("a.b").is_ok());
        // REV-001 N1
        for reserved in ["COM\u{00B9}", "com\u{00B2}", "LPT\u{00B3}", "lpt\u{00B9}.x"] {
            assert!(validate_profile_name(reserved).is_err(), "{reserved}");
        }
        assert!(validate_profile_name("COM\u{2074}").is_ok()); // superscript 4 is not reserved
    }

    #[test]
    fn dot_files_on_disk_are_listed_consistently() {
        let (_tmp, s) = store();
        assert!(matches!(
            s.save(TOOL, ".hidden", &doc("x", 1), false).unwrap_err(),
            ProfileError::InvalidName(_)
        ));
        // A file placed by hand is visible to list, get and delete alike; temp files are not.
        let dir = s.root().join(TOOL);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(".manual.json"),
            r#"{"schemaVersion":1,"name":"x","value":4}"#,
        )
        .unwrap();
        fs::write(dir.join(".tmp-1-1.json.part"), "partial").unwrap();
        let list = s.list::<Doc>(TOOL).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, ".manual");
        assert_eq!(s.get::<Doc>(TOOL, ".manual").unwrap().value, 4);
        s.delete(TOOL, ".manual").unwrap();
        assert!(s.list::<Doc>(TOOL).unwrap().is_empty());
    }

    #[test]
    fn create_never_replaces_an_existing_file() {
        // REV-001 N2: the create step itself refuses an existing name.
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("Boiler.json");
        assert!(write_new(tmp.path(), &target, b"one").is_ok());
        assert!(matches!(
            write_new(tmp.path(), &target, b"two"),
            Err(CreateError::Exists)
        ));
        if cfg!(windows) {
            let other_case = tmp.path().join("boiler.json");
            assert!(matches!(
                write_new(tmp.path(), &other_case, b"three"),
                Err(CreateError::Exists)
            ));
        }
        assert_eq!(fs::read(&target).unwrap(), b"one");
        // No temporary files are left behind.
        assert_eq!(fs::read_dir(tmp.path()).unwrap().count(), 1);
    }
    #[test]
    fn save_list_get_round_trip() {
        let (_tmp, s) = store();
        assert!(s.list::<Doc>(TOOL).unwrap().is_empty());
        s.save(TOOL, "Pump-RTU", &doc("x", 2), false).unwrap();
        s.save(TOOL, "boiler", &doc("x", 1), false).unwrap();
        let list = s.list::<Doc>(TOOL).unwrap();
        let names: Vec<_> = list.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["boiler", "Pump-RTU"]);
        assert!(list[0].modified_at_ms > 0);
        assert_eq!(list[1].document.as_ref().unwrap(), &doc("Pump-RTU", 2));
        // Name lookup ignores case; the stored name wins.
        assert_eq!(s.get::<Doc>(TOOL, "PUMP-rtu").unwrap(), doc("Pump-RTU", 2));
        // No temporary files are left behind.
        let files = fs::read_dir(s.root().join(TOOL)).unwrap().count();
        assert_eq!(files, 2);
    }

    #[test]
    fn save_without_overwrite_rejects_case_insensitive_duplicate() {
        let (_tmp, s) = store();
        s.save(TOOL, "Boiler", &doc("x", 1), false).unwrap();
        assert_eq!(
            s.save(TOOL, "BOILER", &doc("x", 2), false).unwrap_err(),
            ProfileError::Exists("Boiler".into())
        );
        s.save(TOOL, "BOILER", &doc("x", 3), true).unwrap();
        let list = s.list::<Doc>(TOOL).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "BOILER");
        assert_eq!(list[0].document.as_ref().unwrap().value, 3);
    }

    #[test]
    fn rename_rules() {
        let (_tmp, s) = store();
        s.save(TOOL, "A", &doc("x", 1), false).unwrap();
        s.save(TOOL, "B", &doc("x", 2), false).unwrap();
        assert_eq!(
            s.rename(TOOL, "A", "b").unwrap_err(),
            ProfileError::Exists("B".into())
        );
        assert_eq!(
            s.rename(TOOL, "missing", "C").unwrap_err(),
            ProfileError::NotFound("missing".into())
        );
        assert!(matches!(
            s.rename(TOOL, "A", "C/D").unwrap_err(),
            ProfileError::InvalidName(_)
        ));
        s.rename(TOOL, "A", "C").unwrap();
        assert_eq!(s.get::<Doc>(TOOL, "C").unwrap(), doc("C", 1));
        assert!(matches!(
            s.get::<Doc>(TOOL, "A"),
            Err(ProfileError::NotFound(_))
        ));
        // Case-only rename.
        s.rename(TOOL, "c", "c").unwrap();
        let names: Vec<_> = s
            .list::<Doc>(TOOL)
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, ["B", "c"]);
    }

    #[test]
    fn delete() {
        let (_tmp, s) = store();
        s.save(TOOL, "A", &doc("x", 1), false).unwrap();
        s.delete(TOOL, "a").unwrap();
        assert!(s.list::<Doc>(TOOL).unwrap().is_empty());
        assert_eq!(
            s.delete(TOOL, "a").unwrap_err(),
            ProfileError::NotFound("a".into())
        );
    }

    #[test]
    fn schema_version_handling() {
        let (_tmp, s) = store();
        let dir = s.root().join(TOOL);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("Future.json"),
            r#"{"schemaVersion": 2, "name": "Future", "value": 1, "newField": true}"#,
        )
        .unwrap();
        fs::write(dir.join("Broken.json"), "{ not json").unwrap();
        fs::write(dir.join("NoVersion.json"), r#"{"name": "x", "value": 1}"#).unwrap();
        fs::write(dir.join("notes.txt"), "ignored").unwrap();

        assert!(matches!(
            s.get::<Doc>(TOOL, "future").unwrap_err(),
            ProfileError::UnsupportedSchema {
                found: 2,
                supported: 1,
                ..
            }
        ));
        assert!(matches!(
            s.get::<Doc>(TOOL, "Broken").unwrap_err(),
            ProfileError::Invalid { .. }
        ));
        assert!(matches!(
            s.get::<Doc>(TOOL, "NoVersion").unwrap_err(),
            ProfileError::Invalid { .. }
        ));
        // Listing still shows them, with the problem attached.
        let list = s.list::<Doc>(TOOL).unwrap();
        assert_eq!(list.len(), 3);
        assert!(list.iter().all(|e| e.document.is_err()));
    }

    #[test]
    fn invalid_tool_id() {
        let (_tmp, s) = store();
        for bad in ["", "../x", "Modbus", "a/b", "-x"] {
            assert!(matches!(
                s.list::<Doc>(bad).unwrap_err(),
                ProfileError::InvalidToolId(_)
            ));
        }
    }
}
