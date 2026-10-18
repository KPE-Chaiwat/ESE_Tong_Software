// Native window helper for the integration tests (REPORT-006). Compiled once with the .NET Framework
// csc.exe into a small exe (see desktop.ts: `ensureWinHelper`), so a call costs about 50 ms instead
// of the 1+ s of a PowerShell Add-Type. C# 5 syntax only.
//
//   winhelper monitors                       -> JSON [{device, primary, dpi, scale, bounds, work}] (physical px)
//   winhelper list <pid> [pid...]            -> JSON of the top-level windows of those processes
//   winhelper close <hwnd>                   -> WM_CLOSE (a real close request)
//   winhelper move <hwnd> x y w h            -> SetWindowPos (physical px, outer rectangle)
//   winhelper show <hwnd> min|restore|max|focus
//   winhelper tray                           -> JSON rectangle of the taskbar (Shell_TrayWnd)
//   winhelper key <hwnd> <sequence>          -> real keyboard input (SendInput) after focusing hwnd
//   winhelper mouse move x y | down | up | drag x1 y1 x2 y2 steps delayMs   -> real mouse input (SendInput)
//   winhelper cursor                         -> JSON cursor position
// All coordinates are physical pixels (the process is per-monitor DPI aware).
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class WinHelper
{
    delegate bool EnumProc(IntPtr h, IntPtr l);
    delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT r, IntPtr l);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MONITORINFOEX
    {
        public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct GUITHREADINFO
    {
        public int cbSize; public uint flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret;
    }
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO gi);
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public KEYBDINPUT ki; public long pad; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MINPUT { public uint type; public MOUSEINPUT mi; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr extra; }

    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc p, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFOEX mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, MINPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr hMon, int type, out uint x, out uint y);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

    static string Esc(string s)
    {
        StringBuilder b = new StringBuilder();
        foreach (char c in s)
        {
            if (c == '"') b.Append("\\\"");
            else if (c == '\\') b.Append("\\\\");
            else if (c < 32) b.Append(' ');
            else b.Append(c);
        }
        return b.ToString();
    }

    static string R(RECT r)
    {
        return "{\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"w\":" + (r.Right - r.Left) + ",\"h\":" + (r.Bottom - r.Top) + "}";
    }

    static void Monitors()
    {
        List<string> items = new List<string>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr hMon, IntPtr hdc, ref RECT r, IntPtr l)
        {
            MONITORINFOEX mi = new MONITORINFOEX();
            mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
            GetMonitorInfo(hMon, ref mi);
            uint dx = 96, dy = 96;
            GetDpiForMonitor(hMon, 0, out dx, out dy);
            items.Add("{\"device\":\"" + Esc(mi.szDevice) + "\",\"primary\":" + ((mi.dwFlags & 1) != 0 ? "true" : "false") + ",\"dpi\":" + dx + ",\"scale\":" + (dx / 96.0).ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"bounds\":" + R(mi.rcMonitor) + ",\"work\":" + R(mi.rcWork) + "}");
            return true;
        }, IntPtr.Zero);
        Console.WriteLine("[" + string.Join(",", items.ToArray()) + "]");
    }

    static void List(string[] pids)
    {
        HashSet<uint> want = new HashSet<uint>();
        foreach (string p in pids) want.Add(uint.Parse(p));
        IntPtr fg = GetForegroundWindow();
        List<string> items = new List<string>();
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (!want.Contains(pid)) return true;
            StringBuilder t = new StringBuilder(GetWindowTextLength(h) + 2);
            GetWindowText(h, t, t.Capacity);
            StringBuilder c = new StringBuilder(256);
            GetClassName(h, c, 256);
            RECT wr; GetWindowRect(h, out wr);
            RECT cr; GetClientRect(h, out cr);
            POINT co = new POINT(); ClientToScreen(h, ref co);
            RECT fr = new RECT();
            int hr = DwmGetWindowAttribute(h, 9, out fr, Marshal.SizeOf(typeof(RECT)));
            IntPtr owner = GetWindow(h, 4);
            int ex = GetWindowLong(h, -20);
            IntPtr mon = MonitorFromWindow(h, 2);
            uint dx = 96, dy = 96;
            GetDpiForMonitor(mon, 0, out dx, out dy);
            items.Add("{\"hwnd\":" + h.ToInt64() + ",\"pid\":" + pid + ",\"title\":\"" + Esc(t.ToString()) + "\",\"cls\":\"" + Esc(c.ToString()) + "\",\"visible\":" + (IsWindowVisible(h) ? "true" : "false") + ",\"iconic\":" + (IsIconic(h) ? "true" : "false") + ",\"zoomed\":" + (IsZoomed(h) ? "true" : "false") + ",\"foreground\":" + (h == fg ? "true" : "false") + ",\"owner\":" + owner.ToInt64() + ",\"exStyle\":" + ex + ",\"dpi\":" + dx + ",\"rect\":" + R(wr) + ",\"frame\":" + (hr == 0 ? R(fr) : "null") + ",\"client\":{\"x\":" + co.X + ",\"y\":" + co.Y + ",\"w\":" + (cr.Right - cr.Left) + ",\"h\":" + (cr.Bottom - cr.Top) + "}}");
            return true;
        }, IntPtr.Zero);
        Console.WriteLine("[" + string.Join(",", items.ToArray()) + "]");
    }

    static ushort Vk(string p)
    {
        if (p == "alt") return 0x12;
        if (p == "ctrl") return 0x11;
        if (p == "shift") return 0x10;
        if (p == "space") return 0x20;
        if (p == "esc") return 0x1B;
        if (p == "enter") return 0x0D;
        if (p == "tab") return 0x09;
        if (p == "backspace") return 0x08;
        if (p == "backslash") return 0xDC;
        if (p == "home") return 0x24;
        if (p == "end") return 0x23;
        if (p == "delete") return 0x2E;
        if (p == "left") return 0x25;
        if (p == "up") return 0x26;
        if (p == "right") return 0x27;
        if (p == "down") return 0x28;
        if (p.Length >= 2 && p[0] == 'f') return (ushort)(0x70 + int.Parse(p.Substring(1)) - 1);
        if (p.Length == 1) return (ushort)char.ToUpperInvariant(p[0]);
        return 0;
    }

    static void Chord(string seq)
    {
        string[] parts = seq.ToLowerInvariant().Split('+');
        List<ushort> vks = new List<ushort>();
        foreach (string p in parts) vks.Add(Vk(p));
        List<INPUT> inputs = new List<INPUT>();
        foreach (ushort vk in vks) inputs.Add(Ki(vk, 0));
        for (int i = vks.Count - 1; i >= 0; i--) inputs.Add(Ki(vks[i], 2));
        SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
    }

    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);

    // Brings h to the foreground (restores it only when minimized; a maximized window stays maximized).
    static bool ForceForeground(IntPtr h)
    {
        if (IsIconic(h)) ShowWindow(h, 9);
        for (int attempt = 0; attempt < 6; attempt++)
        {
            if (GetForegroundWindow() == h) return true;
            uint pid;
            IntPtr fg = GetForegroundWindow();
            uint fgTid = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out pid);
            uint me = GetCurrentThreadId();
            bool attached = fgTid != 0 && fgTid != me && AttachThreadInput(me, fgTid, true);
            BringWindowToTop(h);
            SetForegroundWindow(h);
            if (attached) AttachThreadInput(me, fgTid, false);
            Thread.Sleep(120);
        }
        return GetForegroundWindow() == h;
    }

    static void Key(IntPtr h, string seq)
    {
        // Sequence like "alt+space", "alt", "ctrl+shift+o", "f10". Hardware-level keyboard input. The keys are sent ONLY when h is
        // the foreground window: input must never reach another application (for example Alt+F4).
        bool fg = ForceForeground(h);
        Thread.Sleep(150);
        if (!fg || GetForegroundWindow() != h) { Console.WriteLine("refused"); return; }
        Chord(seq);
        Console.WriteLine("sent");
    }

    [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint tid);

    // Keyboard layout (HKL low word = language id) seen by the thread of the foreground window's focus window, and of the top-level window.
    static void Layout(IntPtr h)
    {
        uint pid;
        uint tid = GetWindowThreadProcessId(h, out pid);
        GUITHREADINFO gi = new GUITHREADINFO();
        gi.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
        GetGUIThreadInfo(tid, ref gi);
        uint ftid = gi.hwndFocus != IntPtr.Zero ? GetWindowThreadProcessId(gi.hwndFocus, out pid) : tid;
        IntPtr hklTop = GetKeyboardLayout(tid);
        IntPtr hklFocus = GetKeyboardLayout(ftid);
        Console.WriteLine("{\"top\":\"" + (hklTop.ToInt64() & 0xFFFFFFFF).ToString("X8") + "\",\"focus\":\"" + (hklFocus.ToInt64() & 0xFFFFFFFF).ToString("X8") + "\",\"hwndFocus\":" + gi.hwndFocus.ToInt64() + "}");
    }

    static void SetLayout(IntPtr h, string hex)
    {
        // WM_INPUTLANGCHANGEREQUEST 0x0050 to the window and to its focus window
        uint pid;
        uint tid = GetWindowThreadProcessId(h, out pid);
        GUITHREADINFO gi = new GUITHREADINFO();
        gi.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
        GetGUIThreadInfo(tid, ref gi);
        IntPtr hkl = new IntPtr(Convert.ToInt64(hex, 16));
        PostMessage(h, 0x0050, IntPtr.Zero, hkl);
        if (gi.hwndFocus != IntPtr.Zero) PostMessage(gi.hwndFocus, 0x0050, IntPtr.Zero, hkl);
        Console.WriteLine("posted");
    }

    // true when window a is above window b in the z-order (REPORT-008: W1 above the native window)
    static void Above(IntPtr a, IntPtr b)
    {
        IntPtr h = a;
        for (int i = 0; i < 5000 && h != IntPtr.Zero; i++)
        {
            h = GetWindow(h, 2);
            if (h == b) { Console.WriteLine("true"); return; }
        }
        Console.WriteLine("false");
    }

    static void MenuMode(IntPtr h)
    {
        // GetGUIThreadInfo of the thread that owns h: flags GUI_INMENUMODE 0x4, GUI_INMOVESIZE 0x2, GUI_POPUPMENUMODE 0x10, GUI_SYSTEMMENUMODE 0x8
        uint pid;
        uint tid = GetWindowThreadProcessId(h, out pid);
        GUITHREADINFO gi = new GUITHREADINFO();
        gi.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
        bool ok = GetGUIThreadInfo(tid, ref gi);
        Console.WriteLine("{\"ok\":" + (ok ? "true" : "false") + ",\"flags\":" + gi.flags + ",\"inMenuMode\":" + ((gi.flags & 4) != 0 ? "true" : "false") + ",\"inMoveSize\":" + ((gi.flags & 2) != 0 ? "true" : "false") + ",\"popupMenu\":" + ((gi.flags & 16) != 0 ? "true" : "false") + ",\"systemMenu\":" + ((gi.flags & 8) != 0 ? "true" : "false") + ",\"hwndMenuOwner\":" + gi.hwndMenuOwner.ToInt64() + ",\"hwndActive\":" + gi.hwndActive.ToInt64() + ",\"hwndFocus\":" + gi.hwndFocus.ToInt64() + "}");
    }

    static void MouseMove(int x, int y)
    {
        int w = GetSystemMetrics(0), h = GetSystemMetrics(1);
        MINPUT[] a = new MINPUT[1];
        a[0].type = 0;
        a[0].mi.dx = (int)Math.Round(x * 65535.0 / (w - 1));
        a[0].mi.dy = (int)Math.Round(y * 65535.0 / (h - 1));
        a[0].mi.dwFlags = 0x8001; // MOVE | ABSOLUTE
        SendInput(1, a, Marshal.SizeOf(typeof(MINPUT)));
    }

    static void MouseButton(bool down)
    {
        MINPUT[] a = new MINPUT[1];
        a[0].type = 0;
        a[0].mi.dwFlags = down ? 0x0002u : 0x0004u;
        SendInput(1, a, Marshal.SizeOf(typeof(MINPUT)));
    }

    static void Drag(int x1, int y1, int x2, int y2, int steps, int delayMs)
    {
        MouseMove(x1, y1);
        Thread.Sleep(delayMs);
        MouseButton(true);
        Thread.Sleep(delayMs);
        for (int i = 1; i <= steps; i++)
        {
            MouseMove(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
            Thread.Sleep(delayMs);
        }
        Thread.Sleep(delayMs * 3);
        MouseButton(false);
    }

    static void KeyHold(string name, bool down)
    {
        ushort vk = Vk(name);
        INPUT[] a = new INPUT[1];
        a[0] = Ki(vk, down ? 0u : 2u);
        SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
    }

    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);

    // A key event with a hardware scan code (as a real keyboard sends), so that the page sees KeyboardEvent.code ("KeyP") as well as key.
    static INPUT Ki(ushort vk, uint flags)
    {
        INPUT i = new INPUT();
        i.type = 1;
        i.ki = new KEYBDINPUT();
        i.ki.wVk = vk;
        i.ki.wScan = (ushort)MapVirtualKey(vk, 0);
        i.ki.dwFlags = flags;
        // extended keys: arrows, Home/End/Delete (the navigation cluster)
        if (vk >= 0x21 && vk <= 0x28 || vk == 0x2D || vk == 0x2E) i.ki.dwFlags |= 0x0001;
        return i;
    }

    public static int Main(string[] args)
    {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        if (args.Length == 0) { Console.Error.WriteLine("usage"); return 2; }
        string cmd = args[0];
        if (cmd == "monitors") Monitors();
        else if (cmd == "list")
        {
            string[] pids = new string[args.Length - 1];
            Array.Copy(args, 1, pids, 0, pids.Length);
            List(pids);
        }
        else if (cmd == "close") { PostMessage(new IntPtr(long.Parse(args[1])), 0x0010, IntPtr.Zero, IntPtr.Zero); Console.WriteLine("posted"); }
        else if (cmd == "move")
        {
            // SWP_NOZORDER | SWP_NOACTIVATE
            SetWindowPos(new IntPtr(long.Parse(args[1])), IntPtr.Zero, int.Parse(args[2]), int.Parse(args[3]), int.Parse(args[4]), int.Parse(args[5]), 0x0014);
            Console.WriteLine("moved");
        }
        else if (cmd == "show")
        {
            IntPtr h = new IntPtr(long.Parse(args[1]));
            string what = args[2];
            if (what == "focus") { bool okf = ForceForeground(h); Console.WriteLine(okf ? "ok" : "refused"); return 0; }
            if (what == "min") ShowWindow(h, 6);
            else if (what == "restore") ShowWindow(h, 9);
            else if (what == "max") ShowWindow(h, 3);
            else if (what == "focus") { ShowWindow(h, 9); SetForegroundWindow(h); }
            Console.WriteLine("ok");
        }
        else if (cmd == "tray")
        {
            IntPtr t = FindWindow("Shell_TrayWnd", null);
            RECT r; GetWindowRect(t, out r);
            Console.WriteLine(R(r));
        }
        else if (cmd == "key") Key(new IntPtr(long.Parse(args[1])), args[2]);
        else if (cmd == "rawkey") { Chord(args[1]); Console.WriteLine("sent"); }
        else if (cmd == "layout") Layout(new IntPtr(long.Parse(args[1])));
        else if (cmd == "setlayout") SetLayout(new IntPtr(long.Parse(args[1])), args[2]);
        else if (cmd == "above") Above(new IntPtr(long.Parse(args[1])), new IntPtr(long.Parse(args[2])));
        else if (cmd == "menumode") MenuMode(new IntPtr(long.Parse(args[1])));
        else if (cmd == "foreground") { IntPtr f = GetForegroundWindow(); Console.WriteLine(f.ToInt64()); }
        else if (cmd == "mouse")
        {
            if (args[1] == "move") MouseMove(int.Parse(args[2]), int.Parse(args[3]));
            else if (args[1] == "down") MouseButton(true);
            else if (args[1] == "up") MouseButton(false);
            else if (args[1] == "click")
            {
                int cx = int.Parse(args[2]), cy = int.Parse(args[3]);
                if (args.Length > 4)
                {
                    // refuse unless the top-level window under the point belongs to the given process
                    POINT pt = new POINT(); pt.X = cx; pt.Y = cy;
                    IntPtr under = GetAncestor(WindowFromPoint(pt), 2);
                    uint upid; GetWindowThreadProcessId(under, out upid);
                    if (upid != uint.Parse(args[4])) { Console.WriteLine("refused"); return 0; }
                }
                MouseMove(cx, cy); Thread.Sleep(80); MouseButton(true); Thread.Sleep(60); MouseButton(false);
            }
            else if (args[1] == "drag") Drag(int.Parse(args[2]), int.Parse(args[3]), int.Parse(args[4]), int.Parse(args[5]), int.Parse(args[6]), int.Parse(args[7]));
            Console.WriteLine("ok");
        }
        else if (cmd == "hold") { KeyHold(args[1], args[2] == "down"); Console.WriteLine("ok"); }
        else if (cmd == "cursor") { POINT p; GetCursorPos(out p); Console.WriteLine("{\"x\":" + p.X + ",\"y\":" + p.Y + "}"); }
        else { Console.Error.WriteLine("unknown command"); return 2; }
        return 0;
    }
}
