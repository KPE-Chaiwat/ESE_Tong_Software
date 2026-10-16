param(
  [Parameter(Mandatory = $true)][int]$ProcId,
  [string]$Action = "list",
  [long]$Hwnd = 0,
  [int]$X = 0, [int]$Y = 0, [int]$W = 0, [int]$H = 0
)
# Native window helper for the integration tests: lists the top-level windows of a process
# (title, rectangle, visibility) and can post WM_CLOSE to one of them (a real close request).
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<string> List(uint pid) {
    var res = new List<string>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid) return true;
      var t = new StringBuilder(GetWindowTextLength(h) + 2); GetWindowText(h, t, t.Capacity);
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      RECT r; GetWindowRect(h, out r);
      res.Add(h.ToInt64() + "\t" + t + "\t" + c + "\t" + IsWindowVisible(h) + "\t" + r.Left + "\t" + r.Top + "\t" + (r.Right - r.Left) + "\t" + (r.Bottom - r.Top));
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
"@
[W]::SetProcessDPIAware() | Out-Null
if ($Action -eq "move") {
  [W]::SetWindowPos([IntPtr]$Hwnd, [IntPtr]::Zero, $X, $Y, $W, $H, 0x0014) | Out-Null
  "moved"
} elseif ($Action -eq "close") {
  [W]::PostMessage([IntPtr]$Hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  "posted"
} else {
  $out = @()
  foreach ($line in [W]::List([uint32]$ProcId)) {
    $f = $line -split "`t"
    $out += [pscustomobject]@{ hwnd = [long]$f[0]; title = $f[1]; cls = $f[2]; visible = ($f[3] -eq "True"); x = [int]$f[4]; y = [int]$f[5]; w = [int]$f[6]; h = [int]$f[7] }
  }
  if ($out.Count -eq 0) { "[]" } else { ConvertTo-Json -InputObject @($out) -Compress }
}
