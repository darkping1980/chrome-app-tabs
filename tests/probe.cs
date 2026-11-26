// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// probe.exe - test helper: inspects / drives windows so the PoC can be verified with real Win32 state.
// Every input-injecting command requires --fg <hwnd> and aborts if that window is not in the foreground,
// so keystrokes can never land in an unrelated window.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class P
{
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public KI ki; public long pad; }
    [StructLayout(LayoutKind.Sequential)] struct KI { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MI { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MINPUT { public uint type; public MI mi; }
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
    [DllImport("user32.dll", EntryPoint = "SendInput")] static extern uint SendMouse(uint n, MINPUT[] i, int size);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
    // a real mouse-move input event (like a physical mouse), absolute on the virtual desktop. Some title bars
    // (e.g. WinUI apps such as Windows 11 Notepad) start a window move only from real pointer input, not SetCursorPos.
    static void MoveInput(int x, int y)
    {
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
        var m = new MINPUT[1]; m[0].type = 0;
        m[0].mi.dx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1)); m[0].mi.dy = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
        m[0].mi.flags = 0x0001 | 0x8000 | 0x4000; // MOVE | ABSOLUTE | VIRTUALDESK
        SendMouse(1, m, Marshal.SizeOf(typeof(MINPUT)));
        Point c; GetCursorPos(out c);
        if (c.X != x || c.Y != y) SetCursorPos(x, y); // rounding of the normalized coordinates
    }
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool at);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int rop);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetParent(IntPtr c, IntPtr p);
    [DllImport("user32.dll")] static extern long GetWindowLongPtr(IntPtr h, int i);
    [DllImport("user32.dll")] static extern long SetWindowLongPtr(IntPtr h, int i, long v);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);


    static string Txt(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
    static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
    static string R(IntPtr h) { RECT r; GetWindowRect(h, out r); return "[" + r.L + "," + r.T + "," + r.R + "," + r.B + "]"; }
    static IntPtr H(string s) { return new IntPtr(long.Parse(s)); }
    static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }

    static int Main(string[] a)
    {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        Console.OutputEncoding = new UTF8Encoding(false);
        switch (a[0])
        {
            case "info":
                {
                    var h = H(a[1]); uint pid; GetWindowThreadProcessId(h, out pid);
                    Console.WriteLine("{\"exists\":" + (IsWindow(h) ? "true" : "false") + ",\"rect\":" + R(h) + ",\"iconic\":" + (IsIconic(h) ? "true" : "false") +
                        ",\"zoomed\":" + (IsZoomed(h) ? "true" : "false") + ",\"visible\":" + (IsWindowVisible(h) ? "true" : "false") + ",\"dpi\":" + GetDpiForWindow(h) +
                        ",\"pid\":" + pid + ",\"title\":\"" + Esc(Txt(h)) + "\"}");
                    return 0;
                }
            case "content":
                {
                    string best = "null"; long area = -1;
                    EnumChildWindows(H(a[1]), (h, l) => { if (Cls(h) == "Chrome_RenderWidgetHostHWND") { RECT r; GetWindowRect(h, out r); long ar = (long)(r.R - r.L) * (r.B - r.T) + (IsWindowVisible(h) ? (1L << 40) : 0); if (ar > area) { area = ar; best = R(h); } } return true; }, IntPtr.Zero);
                    Console.WriteLine(best); return 0;
                }
            case "fg": { var f = GetForegroundWindow(); Console.WriteLine("{\"hwnd\":" + f.ToInt64() + ",\"title\":\"" + Esc(Txt(f)) + "\"}"); return 0; }
            case "above": // is a above b in z-order?
                {
                    IntPtr x = H(a[1]), y = H(a[2]);
                    for (var h = GetWindow(y, 3 /*GW_HWNDPREV*/); h != IntPtr.Zero; h = GetWindow(h, 3)) if (h == x) { Console.WriteLine("true"); return 0; }
                    Console.WriteLine("false"); return 0;
                }
            case "at": // top-level window under a screen point
                {
                    var h = GetAncestor(WindowFromPoint(new Point(int.Parse(a[1]), int.Parse(a[2]))), 2);
                    Console.WriteLine("{\"hwnd\":" + h.ToInt64() + ",\"title\":\"" + Esc(Txt(h)) + "\"}"); return 0;
                }
            case "find": // find <class> <titleContains> [pid]
                {
                    var o = new List<string>();
                    EnumWindows((h, l) => { if (IsWindowVisible(h) && (a[1] == "*" || Cls(h) == a[1]) && Txt(h).Contains(a[2])) { uint p; GetWindowThreadProcessId(h, out p); if (a.Length < 4 || p.ToString() == a[3]) o.Add("{\"hwnd\":" + h.ToInt64() + ",\"pid\":" + p + ",\"title\":\"" + Esc(Txt(h)) + "\"}"); } return true; }, IntPtr.Zero);
                    Console.WriteLine("[" + string.Join(",", o) + "]"); return 0;
                }
            case "setpos": SetWindowPos(H(a[1]), IntPtr.Zero, int.Parse(a[2]), int.Parse(a[3]), int.Parse(a[4]), int.Parse(a[5]), 0x4 | 0x10); return 0;
            case "show": ShowWindow(H(a[1]), int.Parse(a[2])); return 0;
            case "close": PostMessage(H(a[1]), 0x0010 /*WM_CLOSE*/, IntPtr.Zero, IntPtr.Zero); return 0; // polite close (the app may ask to save)
            case "nchit": // nchit hwnd x y : WM_NCHITTEST answer at a screen point (2 = caption)
                {
                    IntPtr r; var l = new IntPtr(((int.Parse(a[3]) & 0xFFFF) << 16) | (int.Parse(a[2]) & 0xFFFF));
                    if (SendMessageTimeout(H(a[1]), 0x0084, IntPtr.Zero, l, 2, 500, out r) == IntPtr.Zero) { Console.WriteLine("-1"); return 0; }
                    Console.WriteLine((short)(r.ToInt64() & 0xFFFF)); return 0;
                }
            case "sysclose": PostMessage(H(a[1]), 0x0112 /*WM_SYSCOMMAND*/, new IntPtr(0xF060) /*SC_CLOSE*/, IntPtr.Zero); return 0; // like the X button (Windows 11 Notepad ignores WM_CLOSE)
            case "focus":
                {
                    var h = H(a[1]); var fg = GetForegroundWindow(); uint d; uint t = GetWindowThreadProcessId(fg, out d);
                    AttachThreadInput(GetCurrentThreadId(), t, true); SetForegroundWindow(h); AttachThreadInput(GetCurrentThreadId(), t, false);
                    if (GetForegroundWindow() != h) { keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); SetForegroundWindow(h); }
                    Console.WriteLine(GetForegroundWindow() == h ? "true" : "false"); return 0;
                }
            case "click": // click x y --fg-any <h1,h2> : only if the top-level under the point is one of the allowed windows
                {
                    int x = int.Parse(a[1]), y = int.Parse(a[2]);
                    var under = GetAncestor(WindowFromPoint(new Point(x, y)), 2);
                    if (!Allowed(under, a[3])) { Console.WriteLine("ABORT: point is over " + under + " '" + Txt(under) + "'"); return 2; }
                    SetCursorPos(x, y);
                    var m = new MINPUT[2]; m[0].type = 0; m[0].mi.flags = 2; m[1].type = 0; m[1].mi.flags = 4;
                    SendMouse(2, m, Marshal.SizeOf(typeof(MINPUT)));
                    Console.WriteLine("clicked " + under); return 0;
                }
            case "drag": // drag x1 y1 x2 y2 steps allowedHwnds : real left-button drag (e.g. a window by its tab strip)
                {
                    int x1 = int.Parse(a[1]), y1 = int.Parse(a[2]), x2 = int.Parse(a[3]), y2 = int.Parse(a[4]), n = int.Parse(a[5]);
                    var under = GetAncestor(WindowFromPoint(new Point(x1, y1)), 2);
                    if (!Allowed(under, a[6])) { Console.WriteLine("ABORT: point is over " + under + " '" + Txt(under) + "'"); return 2; }
                    SetCursorPos(x1, y1);
                    var m = new MINPUT[1]; m[0].type = 0; m[0].mi.flags = 2; SendMouse(1, m, Marshal.SizeOf(typeof(MINPUT)));
                    Thread.Sleep(80);
                    for (int i = 1; i <= n; i++) { SetCursorPos(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n); Thread.Sleep(16); }
                    Thread.Sleep(a.Length > 7 ? int.Parse(a[7]) : 80); // optional hold before release
                    if (a.Length > 8 && a[8] == "esc") { Key(0x1B, (char)0, 0); Key(0x1B, (char)0, 2); Thread.Sleep(150); } // cancel the move loop
                    m[0].mi.flags = 4; SendMouse(1, m, Marshal.SizeOf(typeof(MINPUT)));
                    Console.WriteLine("dragged"); return 0;
                }
            case "dragpath": // dragpath stepMs holdMs allowedHwnds x1 y1 x2 y2 [x3 y3 ...] [esc] : real drag through waypoints (~12 px per step)
                {
                    int stepMs = int.Parse(a[1]), hold = int.Parse(a[2]);
                    bool esc = a[a.Length - 1] == "esc"; int nArgs = a.Length - 4 - (esc ? 1 : 0);
                    var pts = new List<Point>();
                    for (int i = 0; i + 1 < nArgs; i += 2) pts.Add(new Point(int.Parse(a[4 + i]), int.Parse(a[5 + i])));
                    var under = GetAncestor(WindowFromPoint(pts[0]), 2);
                    if (!Allowed(under, a[3])) { Console.WriteLine("ABORT: point is over " + under + " '" + Txt(under) + "'"); return 2; }
                    SetCursorPos(pts[0].X, pts[0].Y); MoveInput(pts[0].X, pts[0].Y);
                    var m = new MINPUT[1]; m[0].type = 0; m[0].mi.flags = 2; SendMouse(1, m, Marshal.SizeOf(typeof(MINPUT)));
                    Thread.Sleep(80);
                    for (int k = 1; k < pts.Count; k++)
                    {
                        Point f = pts[k - 1], t = pts[k];
                        int n = Math.Max(1, (int)(Math.Sqrt((t.X - f.X) * (t.X - f.X) + (t.Y - f.Y) * (t.Y - f.Y)) / 12));
                        for (int i = 1; i <= n; i++) { MoveInput(f.X + (t.X - f.X) * i / n, f.Y + (t.Y - f.Y) * i / n); if (stepMs > 0) Thread.Sleep(stepMs); }
                    }
                    Thread.Sleep(hold);
                    if (esc) { Key(0x1B, (char)0, 0); Key(0x1B, (char)0, 2); Thread.Sleep(150); }
                    m[0].mi.flags = 4; SendMouse(1, m, Marshal.SizeOf(typeof(MINPUT)));
                    Console.WriteLine("dragged"); return 0;
                }
            case "setparent": // setparent child parent|0 x y w h : experiment for method A (cross-process re-parenting)
                {
                    IntPtr c = H(a[1]), par = H(a[2]);
                    long st = GetWindowLongPtr(c, -16);
                    if (par != IntPtr.Zero) st = (st | 0x40000000L) & ~0x80000000L & ~0x00C00000L & ~0x00040000L; // +WS_CHILD -WS_POPUP -WS_CAPTION -WS_THICKFRAME
                    else st = (st & ~0x40000000L) | 0x00C00000L | 0x00040000L;
                    SetWindowLongPtr(c, -16, st);
                    var old = SetParent(c, par);
                    int err = Marshal.GetLastWin32Error();
                    SetWindowPos(c, IntPtr.Zero, int.Parse(a[3]), int.Parse(a[4]), int.Parse(a[5]), int.Parse(a[6]), 0x4 | 0x20 | 0x40);
                    Console.WriteLine("{\"oldParent\":" + old.ToInt64() + ",\"err\":" + err + "}"); return 0;
                }
            case "responsive": // responsive hwnd timeoutMs
                {
                    IntPtr r; var t0 = DateTime.Now;
                    var ok = SendMessageTimeout(H(a[1]), 0, IntPtr.Zero, IntPtr.Zero, 2 /*SMTO_ABORTIFHUNG*/, uint.Parse(a[2]), out r) != IntPtr.Zero;
                    Console.WriteLine("{\"ok\":" + (ok ? "true" : "false") + ",\"ms\":" + (int)(DateTime.Now - t0).TotalMilliseconds + "}"); return 0;
                }
            case "type": // type <hwnd-that-must-be-foreground> <text>
                {
                    if (!Guard(a[1])) return 2;
                    foreach (char c in a[2]) { Key(0, c, 4); Key(0, c, 4 | 2); Thread.Sleep(5); }
                    return 0;
                }
            case "keys": // keys <hwnd> ctrl+shift+P | enter | ctrl+` ...
                {
                    if (!Guard(a[1])) return 2;
                    var parts = a[2].ToLower().Split('+'); var vks = new List<ushort>();
                    foreach (var p in parts) vks.Add(Vk(p));
                    foreach (var v in vks) Key(v, (char)0, 0);
                    for (int i = vks.Count - 1; i >= 0; i--) Key(vks[i], (char)0, 2);
                    return 0;
                }
            case "shot": // shot path x y w h
                {
                    int x = int.Parse(a[2]), y = int.Parse(a[3]), w = int.Parse(a[4]), hh = int.Parse(a[5]);
                    using (var bmp = new Bitmap(w, hh)) using (var g = Graphics.FromImage(bmp))
                    {   // GDI BitBlt with CAPTUREBLT so layered windows (e.g. the drop highlight) are captured too
                        IntPtr dst = g.GetHdc(), src = GetDC(IntPtr.Zero);
                        BitBlt(dst, 0, 0, w, hh, src, x, y, 0x00CC0020 | 0x40000000);
                        ReleaseDC(IntPtr.Zero, src); g.ReleaseHdc(dst);
                        bmp.Save(a[1], ImageFormat.Png);
                    }
                    return 0;
                }
        }
        Console.WriteLine("unknown"); return 1;
    }

    static bool Allowed(IntPtr h, string list) { foreach (var s in list.Split(',')) if (h.ToInt64().ToString() == s) return true; return false; }
    static bool Guard(string hwnd)
    {
        var fg = GetForegroundWindow();
        if (fg.ToInt64().ToString() != hwnd) { Console.WriteLine("ABORT: foreground is " + fg + " '" + Txt(fg) + "'"); return false; }
        return true;
    }
    static ushort Vk(string k)
    {
        switch (k)
        {
            case "ctrl": return 0x11; case "shift": return 0x10; case "alt": return 0x12; case "enter": return 0x0D; case "esc": return 0x1B;
            case "tab": return 0x09; case "`": return 0xC0; case "pgup": return 0x21; case "pgdn": return 0x22; case "f4": return 0x73; case "win": return 0x5B; case "left": return 0x25; case "right": return 0x27; case "up": return 0x26; case "down": return 0x28;
            default: return (ushort)char.ToUpper(k[0]);
        }
    }
    static void Key(ushort vk, char c, uint flags)
    {
        var i = new INPUT[1]; i[0].type = 1; i[0].ki.vk = vk; i[0].ki.scan = c; i[0].ki.flags = flags;
        SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
    }
}
