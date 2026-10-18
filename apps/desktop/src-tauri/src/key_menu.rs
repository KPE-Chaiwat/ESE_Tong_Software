//! Lone Alt never opens the OS window menu (DES-002 3.1, D-002-25, REPORT-006 defect D2),
//! behind a trait with per-OS implementations (CLAUDE.md rule 4).
//!
//! What happens on Windows without this: WebView2 hands keys the page does not consume as
//! accelerators to its host window. For a lone Alt (and for F10) `DefWindowProc` answers
//! `WM_SYSKEYUP VK_MENU` by sending `WM_SYSCOMMAND(SC_KEYMENU, lParam 0)` to the top-level
//! window, which enters the modal menu loop of the window menu (ESEfact windows have no
//! menu bar, so nothing is drawn). Until the next Alt or Esc that loop owns the keyboard:
//! the page and its shortcuts appear frozen. REPORT-006 reproduced it 5/5 with hardware
//! input, also after an Alt-drag; synthetic CDP key events never reach the OS and miss it.
//!
//! Fix: every ESEfact window (launcher, W1, W2) and its child windows of the UI thread
//! (the WebView2 container `WRY_WEBVIEW`) are subclassed (`SetWindowSubclass`), and the
//! subclass procedure swallows `WM_SYSCOMMAND(SC_KEYMENU)` unless it comes from
//! `Alt+Space` ([`decide`]). Choices:
//! - **Swallowed:** lone Alt (lParam 0), F10 (lParam 0), Alt+letter (lParam = the
//!   character: there is no menu bar to match a mnemonic, so the OS would only beep or enter
//!   menu mode). The key events still reach the page: only the OS menu step is skipped.
//! - **Kept:** `Alt+Space` (lParam `' '`) still opens the window menu (Restore, Move, Size,
//!   Minimize, Maximize, Close): DES-002 keeps the OS behaviour, and keyboard users rely on
//!   it to move a window. Its Close sends `WM_CLOSE`, i.e. the close-confirm flow.
//! - **Untouched:** `Alt+F4` is `WM_SYSKEYDOWN VK_F4` -> `WM_SYSCOMMAND(SC_CLOSE)` ->
//!   `WM_CLOSE`, never `SC_KEYMENU`: it still closes through the close-confirm flow (W1
//!   "Save changes?", W2 S6). Every other message goes to the next procedure unchanged.
//!
//! The guard is installed when a window gains focus (a window is focused before it can get
//! a key) and again on every later focus, which is idempotent (`SetWindowSubclass` with the
//! same procedure and id only updates its data) and also covers a child window created
//! after the first install. The subclass removes itself on `WM_NCDESTROY`.
//!
//! Other systems: a no-op (no Alt menu mode).

/// `WM_SYSCOMMAND`.
pub const WM_SYSCOMMAND: u32 = 0x0112;
/// `SC_KEYMENU` (the low four bits of `wParam` are used by the system and are masked).
pub const SC_KEYMENU: usize = 0xF100;
/// `lParam` of `SC_KEYMENU` for `Alt+Space`: the space character.
const ALT_SPACE: isize = 0x20;

/// What the subclass procedure does with a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyMenuDecision {
    /// Return 0 without calling the next procedure: the OS menu mode does not start.
    Swallow,
    /// Hand the message on unchanged.
    Pass,
}

/// The pure rule of the subclass procedure (see the module docs).
#[must_use]
pub fn decide(msg: u32, wparam: usize, lparam: isize) -> KeyMenuDecision {
    if msg == WM_SYSCOMMAND && (wparam & 0xFFF0) == SC_KEYMENU && lparam != ALT_SPACE {
        KeyMenuDecision::Swallow
    } else {
        KeyMenuDecision::Pass
    }
}

/// Keeps a window out of the OS key menu mode.
pub trait KeyMenuGuard {
    /// Installs the guard on `window` and its child windows. Idempotent.
    fn guard(&self, window: &tauri::Window);
}

/// The guard for the current operating system.
pub struct SystemKeyMenuGuard;

#[cfg(windows)]
impl KeyMenuGuard for SystemKeyMenuGuard {
    fn guard(&self, window: &tauri::Window) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        // The HWND as an integer so the closure is `Send`; subclassing must happen on the
        // thread that owns the window (the main thread).
        let hwnd = hwnd.0 as isize;
        let _ = window.run_on_main_thread(move || win::install(hwnd));
    }
}

#[cfg(not(windows))]
impl KeyMenuGuard for SystemKeyMenuGuard {
    fn guard(&self, _window: &tauri::Window) {}
}

/// Installs the guard of this OS on `window` (see [`KeyMenuGuard`]).
pub fn guard_window(window: &tauri::Window) {
    SystemKeyMenuGuard.guard(window);
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod win {
    //! Unsafe code allowed by the workspace policy (root `Cargo.toml`, `[workspace.lints]`):
    //! comctl32 window subclassing.

    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetWindowThreadProcessId, IsWindow, WM_NCDESTROY,
    };

    use super::{decide, KeyMenuDecision};

    /// Our subclass id ("ESKM"); distinct from wry's ids (`WM_USER + 0x64..0x66`).
    const SUBCLASS_ID: usize = 0x4553_4B4D;

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if msg == WM_NCDESTROY {
            // SAFETY: called on the window's own thread while it is still valid, as the
            // SetWindowSubclass documentation requires before destruction completes.
            unsafe {
                RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
            }
        } else if decide(msg, wparam, lparam) == KeyMenuDecision::Swallow {
            return 0;
        }
        // SAFETY: forwards the unchanged message to the next procedure of this window.
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }

    /// Subclasses `hwnd` if the current thread owns it (other windows, for example the
    /// WebView2 browser-process children, are skipped: they cannot be subclassed).
    fn subclass(hwnd: HWND) {
        // SAFETY: `IsWindow` and `GetWindowThreadProcessId` accept any handle value (a
        // null out pointer is allowed); `SetWindowSubclass` is only called for a live
        // window of this thread with a procedure that lives for the whole program.
        unsafe {
            if IsWindow(hwnd) == 0
                || GetWindowThreadProcessId(hwnd, std::ptr::null_mut()) != GetCurrentThreadId()
            {
                return;
            }
            SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
        }
    }

    unsafe extern "system" fn each_child(hwnd: HWND, _: LPARAM) -> BOOL {
        subclass(hwnd);
        1
    }

    /// Guards a top-level window and all its descendants of this thread.
    pub(super) fn install(top: isize) {
        let hwnd = top as HWND;
        subclass(hwnd);
        // SAFETY: the callback only subclasses windows of this thread; lParam is unused.
        unsafe {
            EnumChildWindows(hwnd, Some(each_child), 0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SC_CLOSE: usize = 0xF060;
    const SC_MOVE: usize = 0xF010;
    const WM_SYSKEYDOWN: u32 = 0x0104;
    const WM_SYSKEYUP: u32 = 0x0105;
    const VK_MENU: usize = 0x12;
    const VK_F4: usize = 0x73;

    #[test]
    fn lone_alt_f10_and_alt_letters_do_not_enter_menu_mode() {
        // Lone Alt and F10: lParam 0.
        assert_eq!(
            decide(WM_SYSCOMMAND, SC_KEYMENU, 0),
            KeyMenuDecision::Swallow
        );
        // The low four bits are system flags.
        assert_eq!(
            decide(WM_SYSCOMMAND, SC_KEYMENU | 0x0003, 0),
            KeyMenuDecision::Swallow
        );
        // Alt+letter mnemonics (no menu bar to match).
        for c in ['f', 'E', '1', '-'] {
            assert_eq!(
                decide(WM_SYSCOMMAND, SC_KEYMENU, c as isize),
                KeyMenuDecision::Swallow,
                "{c}"
            );
        }
    }

    #[test]
    fn alt_space_alt_f4_and_everything_else_pass() {
        assert_eq!(
            decide(WM_SYSCOMMAND, SC_KEYMENU, ' ' as isize),
            KeyMenuDecision::Pass,
            "Alt+Space keeps the window menu"
        );
        // Alt+F4: the key and its SC_CLOSE pass, so WM_CLOSE (close-confirm) follows.
        assert_eq!(decide(WM_SYSKEYDOWN, VK_F4, 0), KeyMenuDecision::Pass);
        assert_eq!(decide(WM_SYSCOMMAND, SC_CLOSE, 0), KeyMenuDecision::Pass);
        assert_eq!(decide(WM_SYSCOMMAND, SC_MOVE, 0), KeyMenuDecision::Pass);
        // The Alt key events themselves still reach the window (the page gets them too).
        assert_eq!(decide(WM_SYSKEYDOWN, VK_MENU, 0), KeyMenuDecision::Pass);
        assert_eq!(decide(WM_SYSKEYUP, VK_MENU, 0), KeyMenuDecision::Pass);
        // SC_KEYMENU's value with another message is not a menu command.
        assert_eq!(decide(0x0111, SC_KEYMENU, 0), KeyMenuDecision::Pass);
    }
}
