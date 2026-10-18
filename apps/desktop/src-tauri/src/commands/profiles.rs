//! Profile commands. Storage rules live in `platform::ProfileStore` (BE-001 Q-10), the
//! Modbus Master schema (v2, migration from v1, checks) in `platform::mm_profile`.
//! File I/O runs on the blocking pool so it never stalls the async workers.

use platform::mm_profile::{check_profile, decode_profile, encode_profile, MODBUS_MASTER_TOOL_ID};
use platform::ProfileStore;
use shared_types::{AppErrorCode, Profile, ProfileSummary};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::windows::find_tool;

/// Only Modbus Master has profiles so far; its documents are `shared_types::Profile`.
fn store_for(state: &AppState, tool_id: &str) -> AppResult<ProfileStore> {
    match find_tool(tool_id) {
        Some(t) if t.id == MODBUS_MASTER_TOOL_ID => state.profiles(),
        _ => Err(AppError::new(
            AppErrorCode::UnknownTool,
            format!("Unknown tool \"{tool_id}\"."),
        )),
    }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::new(AppErrorCode::Internal, e.to_string()))?
}

/// Unreadable files (newer schema, damaged, more than 16 polls, invalid aliases or
/// `minimizedOrder`) are listed with `readable: false` and the problem as summary.
#[tauri::command]
pub async fn profiles_list(
    state: State<'_, AppState>,
    tool_id: String,
) -> AppResult<Vec<ProfileSummary>> {
    let store = store_for(&state, &tool_id)?;
    blocking(move || {
        Ok(store
            .list_with(&tool_id, decode_profile)?
            .into_iter()
            .map(|e| {
                let (connection_summary, readable) = match &e.document {
                    Ok(p) => (p.connection.summary(), true),
                    Err(err) => (err.to_string(), false),
                };
                ProfileSummary {
                    name: e.name,
                    modified_at: e.modified_at_ms,
                    connection_summary,
                    readable,
                }
            })
            .collect())
    })
    .await
}

/// Schema 1 files come back migrated (`migratedFrom: 1`); the file is not changed.
#[tauri::command]
pub async fn profiles_get(
    state: State<'_, AppState>,
    tool_id: String,
    name: String,
) -> AppResult<Profile> {
    let store = store_for(&state, &tool_id)?;
    blocking(move || Ok(store.get_with(&tool_id, &name, decode_profile)?)).await
}

/// Saves under `profile.name` as schema 2 (`migratedFrom` is not written). `overwrite =
/// false` fails with `profileExists` when a profile with that name (ignoring case) exists.
#[tauri::command]
pub async fn profiles_save(
    state: State<'_, AppState>,
    tool_id: String,
    profile: Profile,
    overwrite: bool,
) -> AppResult<()> {
    let store = store_for(&state, &tool_id)?;
    // Permissive for the connection (a half-edited form can be saved); the poll list, names,
    // aliases and minimizedOrder must be valid.
    check_profile(&profile)
        .map_err(|p| AppError::new(AppErrorCode::Validation, p.message).with_field(p.field))?;
    let document =
        encode_profile(&profile).map_err(|e| AppError::new(AppErrorCode::Internal, e))?;
    blocking(move || {
        let name = profile.name.clone();
        Ok(store.save(&tool_id, &name, &document, overwrite)?)
    })
    .await
}

#[tauri::command]
pub async fn profiles_rename(
    state: State<'_, AppState>,
    tool_id: String,
    old_name: String,
    new_name: String,
) -> AppResult<()> {
    let store = store_for(&state, &tool_id)?;
    blocking(move || Ok(store.rename(&tool_id, &old_name, &new_name)?)).await
}

#[tauri::command]
pub async fn profiles_delete(
    state: State<'_, AppState>,
    tool_id: String,
    name: String,
) -> AppResult<()> {
    let store = store_for(&state, &tool_id)?;
    blocking(move || Ok(store.delete(&tool_id, &name)?)).await
}
