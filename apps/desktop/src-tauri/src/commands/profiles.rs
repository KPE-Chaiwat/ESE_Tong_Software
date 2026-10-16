//! Profile commands. Storage rules live in `platform::ProfileStore` (BE-001 Q-10).
//! File I/O runs on the blocking pool so it never stalls the async workers.

use platform::ProfileStore;
use shared_types::{AppErrorCode, Profile, ProfileSummary};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::windows::find_tool;

/// Only Modbus Master has profiles so far; its documents are `shared_types::Profile`.
fn store_for(state: &AppState, tool_id: &str) -> AppResult<ProfileStore> {
    match find_tool(tool_id) {
        Some(t) if t.id == "modbus-master" => state.profiles(),
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

#[tauri::command]
pub async fn profiles_list(
    state: State<'_, AppState>,
    tool_id: String,
) -> AppResult<Vec<ProfileSummary>> {
    let store = store_for(&state, &tool_id)?;
    blocking(move || {
        Ok(store
            .list::<Profile>(&tool_id)?
            .into_iter()
            .map(|e| {
                let (connection_summary, readable) = match &e.document {
                    Ok(p) => match p.check_shape() {
                        Ok(()) => (p.connection.summary(), true),
                        Err(problem) => (problem, false),
                    },
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

#[tauri::command]
pub async fn profiles_get(
    state: State<'_, AppState>,
    tool_id: String,
    name: String,
) -> AppResult<Profile> {
    let store = store_for(&state, &tool_id)?;
    blocking(move || {
        let profile = store.get::<Profile>(&tool_id, &name)?;
        profile.check_shape().map_err(|problem| {
            AppError::new(
                AppErrorCode::InvalidProfile,
                format!("Profile \"{}\" cannot be read: {problem}", profile.name),
            )
        })?;
        Ok(profile)
    })
    .await
}

/// Saves under `profile.name`. `overwrite = false` fails with `profileExists` when a profile
/// with that name (ignoring case) exists; the UI then asks "Replace profile?".
#[tauri::command]
pub async fn profiles_save(
    state: State<'_, AppState>,
    tool_id: String,
    profile: Profile,
    overwrite: bool,
) -> AppResult<()> {
    let store = store_for(&state, &tool_id)?;
    // Permissive on purpose (PM decision on REV-001 Q4): only what the UI cannot recover
    // from is refused. Connection and poll values are validated when used.
    profile
        .check_shape()
        .map_err(|problem| AppError::new(AppErrorCode::Validation, problem))?;
    blocking(move || {
        let name = profile.name.clone();
        Ok(store.save(&tool_id, &name, &profile, overwrite)?)
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
