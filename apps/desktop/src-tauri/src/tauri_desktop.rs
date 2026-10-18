//! [`Desktop`] backed by Tauri windows and monitors (physical pixels).

use platform::arrange::Rect;
use tauri::{
    AppHandle, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl,
    WebviewWindowBuilder,
};

use crate::desktop::{sort_monitors, Desktop, Insets, MonitorGeom, WindowGeom};
use crate::windows::POLL_WINDOW;

pub struct TauriDesktop<'a, R: Runtime> {
    pub app: &'a AppHandle<R>,
}

fn geom(m: &Monitor, primary: Option<&Monitor>, index: usize) -> MonitorGeom {
    let wa = m.work_area();
    let same = |p: &Monitor| p.position() == m.position() && p.size() == m.size();
    MonitorGeom {
        name: m
            .name()
            .cloned()
            .unwrap_or_else(|| format!("monitor-{}", index + 1)),
        primary: primary.is_some_and(same),
        work_area: Rect::new(
            i64::from(wa.position.x),
            i64::from(wa.position.y),
            i64::from(wa.size.width),
            i64::from(wa.size.height),
        ),
        scale: m.scale_factor(),
    }
}

/// The invisible resize borders (REV-008 m-5): measured on Windows 10/11, none elsewhere.
#[cfg(windows)]
fn invisible_borders(outer: Rect, inner_origin: (i64, i64), inner_size: (i64, i64)) -> Insets {
    crate::desktop::resize_border_insets(outer, inner_origin, inner_size)
}

#[cfg(not(windows))]
fn invisible_borders(_outer: Rect, _origin: (i64, i64), _size: (i64, i64)) -> Insets {
    Insets::default()
}

fn clamp_u32(v: i64) -> u32 {
    u32::try_from(v.max(1)).unwrap_or(u32::MAX)
}

fn clamp_i32(v: i64) -> i32 {
    i32::try_from(v).unwrap_or(if v < 0 { i32::MIN } else { i32::MAX })
}

impl<R: Runtime> Desktop for TauriDesktop<'_, R> {
    fn monitors(&self) -> Vec<MonitorGeom> {
        let primary = self.app.primary_monitor().ok().flatten();
        let mut list: Vec<MonitorGeom> = self
            .app
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .enumerate()
            .map(|(i, m)| geom(m, primary.as_ref(), i))
            .collect();
        if !list.iter().any(|m| m.primary) {
            if let Some(first) = list.first_mut() {
                first.primary = true;
            }
        }
        sort_monitors(&mut list);
        list
    }

    fn window(&self, label: &str) -> Option<WindowGeom> {
        let w = self.app.get_webview_window(label)?;
        let pos = w.outer_position().ok()?;
        let size = w.outer_size().ok()?;
        let inner = w.inner_position().ok()?;
        let inner_size = w.inner_size().ok()?;
        let outer = Rect::new(
            i64::from(pos.x),
            i64::from(pos.y),
            i64::from(size.width),
            i64::from(size.height),
        );
        let inner_origin = (i64::from(inner.x), i64::from(inner.y));
        let inner_size = (i64::from(inner_size.width), i64::from(inner_size.height));
        Some(WindowGeom {
            outer,
            inner_origin,
            inner_size,
            invisible: invisible_borders(outer, inner_origin, inner_size),
            scale: w.scale_factor().unwrap_or(1.0),
            minimized: w.is_minimized().unwrap_or(false),
            maximized: w.is_maximized().unwrap_or(false),
        })
    }

    fn cursor(&self) -> Option<(i64, i64)> {
        let p = self.app.cursor_position().ok()?;
        #[allow(clippy::cast_possible_truncation)]
        Some((p.x.round() as i64, p.y.round() as i64))
    }

    fn place(&self, label: &str, outer: Rect, maximized: bool) -> Result<(), String> {
        let w = self
            .app
            .get_webview_window(label)
            .ok_or_else(|| format!("window {label} not found"))?;
        let err = |e: tauri::Error| e.to_string();
        if w.is_minimized().unwrap_or(false) {
            w.unminimize().map_err(err)?;
        }
        if w.is_maximized().unwrap_or(false) {
            w.unmaximize().map_err(err)?;
        }
        w.set_position(PhysicalPosition::new(
            clamp_i32(outer.x),
            clamp_i32(outer.y),
        ))
        .map_err(err)?;
        // set_size sets the client size: subtract the frame to get the wanted outer size.
        let (frame_w, frame_h) = match (w.outer_size(), w.inner_size()) {
            (Ok(o), Ok(i)) => (
                i64::from(o.width) - i64::from(i.width),
                i64::from(o.height) - i64::from(i.height),
            ),
            _ => (0, 0),
        };
        w.set_size(PhysicalSize::new(
            clamp_u32(outer.w.saturating_sub(frame_w)),
            clamp_u32(outer.h.saturating_sub(frame_h)),
        ))
        .map_err(err)?;
        if maximized {
            w.maximize().map_err(err)?;
        }
        Ok(())
    }

    fn create_poll_window(
        &self,
        label: &str,
        route: &str,
        title: &str,
        min_inner: (f64, f64),
    ) -> Result<(), String> {
        let (connection, poll_id) = crate::windows::parse_poll_window_label(label)
            .ok_or_else(|| "Invalid native poll window label.".to_owned())?;
        let session = self
            .app
            .state::<crate::state::AppState>()
            .session(connection)
            .map_err(|e| e.to_string())?;
        let generation = session
            .native_generation(poll_id)
            .ok_or_else(|| "This poll no longer exists.".to_owned())?;
        let window = WebviewWindowBuilder::new(self.app, label, WebviewUrl::App(route.into()))
            .title(title)
            .inner_size(POLL_WINDOW.width, POLL_WINDOW.height)
            .min_inner_size(min_inner.0, min_inner.1)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let session = session.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = session
                        .native_incarnation_destroyed(poll_id, generation)
                        .await;
                });
            }
        });
        Ok(())
    }

    fn set_min_inner_size(&self, label: &str, min_inner: (f64, f64)) -> Result<(), String> {
        let w = self
            .app
            .get_webview_window(label)
            .ok_or_else(|| format!("window {label} not found"))?;
        w.set_min_size(Some(LogicalSize::new(min_inner.0, min_inner.1)))
            .map_err(|e| e.to_string())
    }

    fn exists(&self, label: &str) -> bool {
        self.app.get_webview_window(label).is_some()
    }

    fn reveal(&self, label: &str) -> bool {
        let Some(w) = self.app.get_webview_window(label) else {
            return false;
        };
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
        let _ = w.show();
        let _ = w.set_focus();
        true
    }

    fn show(&self, label: &str) {
        if let Some(w) = self.app.get_webview_window(label) {
            let _ = w.show();
        }
    }

    fn reveal_checked(&self, label: &str) -> Result<(), String> {
        let w = self
            .app
            .get_webview_window(label)
            .ok_or_else(|| "The poll window no longer exists.".to_owned())?;
        if w.is_minimized().map_err(|e| e.to_string())? {
            w.unminimize().map_err(|e| e.to_string())?;
        }
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())
    }

    fn destroy_checked(&self, label: &str) -> Result<(), String> {
        if let Some(w) = self.app.get_webview_window(label) {
            w.destroy().map_err(|e| e.to_string())?;
        }
        if self.exists(label) {
            Err("The poll window is still closing. Retry window cleanup.".into())
        } else {
            Ok(())
        }
    }

    fn destroy(&self, label: &str) {
        if let Some(w) = self.app.get_webview_window(label) {
            let _ = w.destroy();
        }
    }
}
