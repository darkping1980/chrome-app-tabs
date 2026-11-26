// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// Drag-to-add: drag a program window by its title bar onto the top of a Chrome window (tab strip / toolbar) to add it as a tab.
//
// Only official, out-of-process mechanisms are used:
//  * SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART/END, WINEVENT_OUTOFCONTEXT): Windows tells us when ANY window
//    enters/leaves its normal move/size loop. Nothing is injected and the drag itself is never intercepted,
//    so ordinary moving and Windows Snap behave exactly as before.
//  * At the start, one WM_NCHITTEST (SendMessageTimeout) asks the window whether the grab point is its caption
//    (a move) or a border (a resize).
//  * While (and only while) such a drag is in progress, a 15 ms timer samples the cursor and the window rect.
//  * The drop zone is Chrome's own UI above the web page: from the top of the window down to the top of the
//    Chrome_RenderWidgetHostHWND child (plain window geometry; no UI Automation, so a web page can never be
//    mistaken for the tab strip and Chrome's accessibility mode is not switched on by us).
//  * The highlight is our own click-through, non-activating, topmost window; Chrome itself is not modified.
// On release inside the zone the host reports "dropAdd" to the extension, which reuses the normal "add" path
// (duplicate check included). The position from BEFORE the drag is kept as the program's original position.
// The decisions themselves live in DropLogic.cs (unit tested). Analysis: docs/drag-drop-analysis.md.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace AppTabs
{
    static class N2
    {
        [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public N.RECT rcMonitor, rcWork; public int dwFlags; }
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out N.POINT p);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(N.POINT p, uint flags);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromRect(ref N.RECT r, uint flags);
        [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
        [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr m, int type, out uint x, out uint y);
        [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr result);
        [DllImport("user32.dll")] static extern bool PhysicalToLogicalPointForPerMonitorDPI(IntPtr h, ref N.POINT p);
        [DllImport("user32.dll", EntryPoint = "IsWindowArranged")] static extern bool IsWindowArrangedNative(IntPtr h);
        [StructLayout(LayoutKind.Sequential)] struct MOUSEMOVEPOINT { public int x, y; public uint time; public IntPtr extra; }
        [DllImport("user32.dll", SetLastError = true)] static extern int GetMouseMovePointsEx(uint cb, ref MOUSEMOVEPOINT pt, [Out] MOUSEMOVEPOINT[] buf, int n, uint resolution);
        public const uint EVENT_SYSTEM_CAPTURESTART = 0x0008, EVENT_SYSTEM_CAPTUREEND = 0x0009, EVENT_SYSTEM_MOVESIZESTART = 0x000A, EVENT_SYSTEM_MOVESIZEEND = 0x000B;
        public const uint MONITOR_DEFAULTTONULL = 0, MONITOR_DEFAULTTONEAREST = 2;

        public static N.RECT MonitorRect(IntPtr mon)
        {
            var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(mi);
            GetMonitorInfo(mon, ref mi); return mi.rcMonitor;
        }

        public static double MonitorScale(IntPtr mon)
        {
            try { uint x, y; if (GetDpiForMonitor(mon, 0 /*MDT_EFFECTIVE_DPI*/, out x, out y) == 0 && x > 0) return x / 96.0; } catch { }
            return 1.0;
        }

        public static bool OnSomeMonitor(N.RECT r) { return r.W > 0 && r.H > 0 && MonitorFromRect(ref r, MONITOR_DEFAULTTONULL) != IntPtr.Zero; }

        // WM_NCHITTEST at a screen point. The message is not DPI-translated across processes, so the point is
        // converted to the window's own coordinate space first (identity for per-monitor aware windows).
        public static long HitTest(IntPtr h, N.POINT screen)
        {
            try
            {
                var p = screen; PhysicalToLogicalPointForPerMonitorDPI(h, ref p);
                var l = new IntPtr((long)(((p.Y & 0xFFFF) << 16) | (p.X & 0xFFFF)));
                IntPtr r;
                if (SendMessageTimeout(h, 0x0084 /*WM_NCHITTEST*/, IntPtr.Zero, l, 0x0002 /*SMTO_ABORTIFHUNG*/, 50, out r) == IntPtr.Zero) return -1;
                return (short)(r.ToInt64() & 0xFFFF);
            }
            catch { return -1; }
        }

        // Where the cursor was at a given input time (e.g. the WinEvent time of MOVESIZESTART = when the button went
        // down on the caption), from the system's mouse-move history. Our event handler runs a little later, when the
        // cursor may already have moved on. Falls back to the current position.
        public static N.POINT CursorAt(uint time, out bool fromHistory)
        {
            N.POINT now; GetCursorPos(out now); fromHistory = false;
            try
            {
                var cur = new MOUSEMOVEPOINT { x = now.X & 0xFFFF, y = now.Y & 0xFFFF };
                var buf = new MOUSEMOVEPOINT[64];
                int n = GetMouseMovePointsEx((uint)Marshal.SizeOf(typeof(MOUSEMOVEPOINT)), ref cur, buf, 64, 1 /*GMMP_USE_DISPLAY_POINTS*/);
                for (int i = 0; i < n; i++) // newest first
                {
                    if (unchecked((int)(buf[i].time - time)) > 0) continue;
                    int x = buf[i].x, y = buf[i].y;
                    if (x > 32767) x -= 65536; if (y > 32767) y -= 65536; // monitors left of / above the primary
                    fromHistory = true;
                    return new N.POINT { X = x, Y = y };
                }
            }
            catch { }
            return now;
        }

        // snapped / arranged by Windows Snap (its rect is not the "normal" rect of its placement)
        public static bool IsArranged(IntPtr h)
        {
            try { return IsWindowArrangedNative(h); }
            catch (EntryPointNotFoundException) { }
            if (N.IsZoomed(h) || N.IsIconic(h)) return false;
            var r = N.Rect(h); var p = N.Placement(h);
            return r.W != p.normal.W || r.H != p.normal.H;
        }

        // Snap settings of the current user (Settings > System > Multitasking)
        public static void SnapSettings(out bool snap, out bool snapBar)
        {
            snap = true; snapBar = true;
            try
            {
                using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Control Panel\Desktop"))
                    if (k != null && Convert.ToString(k.GetValue("WindowArrangementActive", "1")) == "0") snap = false;
                using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"))
                    if (k != null && Convert.ToInt32(k.GetValue("EnableSnapBar", 1)) == 0) snapBar = false;
            }
            catch { }
            if (!snap) snapBar = false;
        }
    }

    // our highlight: never activates, never takes the mouse (WS_EX_TRANSPARENT), always on top
    class DropHighlight : Form
    {
        readonly Label label;
        public DropHighlight()
        {
            FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true; StartPosition = FormStartPosition.Manual;
            BackColor = Color.FromArgb(26, 115, 232); Opacity = 0.45;
            label = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.White,
                                Font = new Font("Malgun Gothic", 10f, FontStyle.Bold), Text = "여기에 놓으면 Chrome 탭으로 추가" };
            Controls.Add(label);
        }
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x00080000 /*LAYERED*/ | 0x00000020 /*TRANSPARENT*/ | 0x00000080 /*TOOLWINDOW*/ | 0x08000000 /*NOACTIVATE*/ | 0x00000008 /*TOPMOST*/;
                return cp;
            }
        }
        // the zone is given in physical pixels: when the highlight moves to a monitor with another DPI, Windows'
        // suggested resize would move/scale it away from the zone, so WM_DPICHANGED is ignored
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x02E0 /*WM_DPICHANGED*/) { m.Result = IntPtr.Zero; return; }
            base.WndProc(ref m);
        }
        N.RECT shownAt; bool shown;
        public void ShowAt(N.RECT r)
        {
            if (shown && DropLogic.SameRect(r, shownAt)) return; // nothing to do
            N.SetWindowPos(Handle, new IntPtr(-1) /*HWND_TOPMOST*/, r.L, r.T, r.W, r.H, N.SWP_NOACTIVATE | N.SWP_SHOWWINDOW);
            shownAt = r; shown = true;
        }
        // shown/hidden through Win32, so do not rely on Form.Visible
        public void HideNow() { if (shown || N.IsWindowVisible(Handle)) { N.ShowWindow(Handle, 0 /*SW_HIDE*/); shown = false; } }
    }

    // where a program window was before it became a tab, restored when the tab is closed
    class OriginalPos
    {
        public DateTime At;
        public N.WINDOWPLACEMENT Placement;
        // Its actual screen rect, used only for windows snapped by Windows (their Placement.normal is the size from
        // before snapping). Other windows are restored from Placement alone: Windows starts the move loop after the
        // drag threshold and moves the window at once, so a rect read in the start event may already be a few pixels
        // off, while Placement.normal still holds the position from before the move.
        public N.RECT Rect;
        public bool Arranged;
        public static OriginalPos Of(IntPtr h)
        {
            return new OriginalPos { At = DateTime.UtcNow, Placement = N.Placement(h), Rect = N.Rect(h), Arranged = N2.IsArranged(h) };
        }
    }

    static partial class Host
    {
        public static bool DragAddEnabled = true;
        static N.WinEventProc dragHookProc;
        static System.Windows.Forms.Timer dragTimer;
        static DropHighlight highlight;
        static int dropsReported;

        class DragState
        {
            public IntPtr Win; public OriginalPos Before; public DragTracker Track;
            public bool Snap, SnapBar;
            public IntPtr ArmedMonitor; public N.RECT ArmedRect; public double ArmedScale; // Snap layouts bar may be open there
            public ZoneHit LastHit; public N.POINT LastPoint; public string LastReason = "";
            public IntPtr Shown; public N.RECT ShownZone; public int Misses;
            public Dictionary<IntPtr, KeyValuePair<N.RECT, N.RECT?>> Zones = new Dictionary<IntPtr, KeyValuePair<N.RECT, N.RECT?>>(); // chrome -> (its rect, band)
            public Dictionary<uint, string> Names = new Dictionary<uint, string>(); // process names, cached for this drag
        }
        static DragState drag;
        // The last mouse press that captured the mouse (EVENT_SYSTEM_CAPTURESTART): fired when the button goes down,
        // BEFORE Windows starts the move loop. Windows starts that loop only after the drag threshold and moves the
        // window at once, so by the time MOVESIZESTART is handled the window (and its placement) has already moved.
        // The press gives the exact grab point and the window's real position from before the drag.
        // A press that ended without a move (a click, or a press on a resize border that captures nothing) must not be
        // used for a later drag: Windows ends the press capture right before it starts the move loop, so only a press
        // whose capture ended moments before MOVESIZESTART belongs to that drag.
        class Press { public IntPtr Win; public uint Time; public N.POINT At; public OriginalPos Before; public bool Zoomed; public uint EndTime; public bool Ended; }
        static Press lastPress;
        // position from before the drop-drag, consumed by the next attach of that window
        static readonly Dictionary<IntPtr, OriginalPos> PreDropPlacement = new Dictionary<IntPtr, OriginalPos>();

        static void StartDragWatcher()
        {
            dragHookProc = OnMoveSize;
            GlobalHooks.Add(N.SetWinEventHook(N2.EVENT_SYSTEM_CAPTURESTART, N2.EVENT_SYSTEM_MOVESIZEEND, IntPtr.Zero, dragHookProc, 0, 0, N.WINEVENT_OUTOFCONTEXT | N.WINEVENT_SKIPOWNPROCESS));
            dragTimer = new System.Windows.Forms.Timer { Interval = 15 };
            dragTimer.Tick += delegate { DragTick(); };
            highlight = new DropHighlight();
            highlight.CreateControl(); var h = highlight.Handle;
        }

        static bool IsCandidateWindow(IntPtr h)
        {
            if (!N.IsWindowVisible(h) || N.Cloaked(h)) return false;
            if (N.GetWindow(h, N.GW_OWNER) != IntPtr.Zero) return false;
            if ((N.GetWindowLongPtr(h, N.GWL_EXSTYLE) & N.WS_EX_TOOLWINDOW) != 0) return false;
            if (N.Text(h).Length == 0) return false;
            string name = ProcessName(N.Pid(h));
            return name != null && !name.Equals("chrome", StringComparison.OrdinalIgnoreCase);
        }

        static string ProcessName(uint pid)
        {
            try { return Process.GetProcessById((int)pid).ProcessName; } catch { return null; }
        }

        static bool IsChromeMain(IntPtr h)
        {
            if (N.Class(h) != "Chrome_WidgetWin_1" || !N.IsWindowVisible(h) || N.Cloaked(h) || N.IsIconic(h)) return false;
            if (N.GetWindow(h, N.GW_OWNER) != IntPtr.Zero || N.Text(h).Length == 0) return false;
            uint pid = N.Pid(h); string name;
            if (drag == null || !drag.Names.TryGetValue(pid, out name)) { name = ProcessName(pid); if (drag != null) drag.Names[pid] = name; }
            return name != null && name.Equals("chrome", StringComparison.OrdinalIgnoreCase);
        }

        static void OnMoveSize(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
        {
            if (idObject != 0 || idChild != 0) return;
            try
            {
                if (ev == N2.EVENT_SYSTEM_CAPTURESTART)
                {   // only a snapshot of the pressed top-level window (cheap; nothing else happens on a click)
                    if (!DragAddEnabled || drag != null) return;
                    var top = N.GetAncestor(hwnd, 2 /*GA_ROOT*/);
                    if (top == IntPtr.Zero) return;
                    bool h0; var at = N2.CursorAt(time, out h0);
                    lastPress = new Press { Win = top, Time = time, At = at, Before = OriginalPos.Of(top), Zoomed = N.IsZoomed(top) };
                    return;
                }
                if (ev == N2.EVENT_SYSTEM_CAPTUREEND)
                {
                    var lp = lastPress;
                    if (lp != null && !lp.Ended && N.GetAncestor(hwnd, 2 /*GA_ROOT*/) == lp.Win) { lp.Ended = true; lp.EndTime = time; }
                    return;
                }
                if (ev == N2.EVENT_SYSTEM_MOVESIZESTART)
                {
                    EndDrag(false, 0);
                    if (!DragAddEnabled) return;
                    if (!IsCandidateWindow(hwnd)) { Log("drag start ignored (not a candidate) " + hwnd + " " + N.Class(hwnd)); return; }
                    if (Att.Values.Any(a => a.App == hwnd)) { Log("drag start ignored (already a tab) " + hwnd); return; } // managed by the overlay logic
                    var pr = lastPress; lastPress = null;
                    int since = pr == null ? -1 : unchecked((int)(time - pr.Time));
                    N.POINT p; OriginalPos before; bool zoomed; string src;
                    int afterEnd = pr != null && pr.Ended ? unchecked((int)(time - pr.EndTime)) : 0;
                    if (pr != null && pr.Win == hwnd && since >= 0 && since < 10000 && afterEnd >= 0 && afterEnd < 500) { p = pr.At; before = pr.Before; zoomed = pr.Zoomed; src = "press"; }
                    else
                    {   // no press seen (e.g. keyboard move via Alt+Space): best effort from the current state
                        bool hist; p = N2.CursorAt(time, out hist); before = OriginalPos.Of(hwnd); zoomed = N.IsZoomed(hwnd); src = hist ? "history" : "now";
                    }
                    var ht = N2.HitTest(hwnd, p);
                    var d = new DragState { Win = hwnd, Before = before, Track = new DragTracker(before.Rect, p, zoomed, DropLogic.KindFromHitTest(ht)) };
                    N2.SnapSettings(out d.Snap, out d.SnapBar);
                    drag = d;
                    Log("drag start " + hwnd + " hit=" + ht + " (" + d.Track.Hit + ")" + (d.Track.StartZoomed ? " maximized" : "") + (before.Arranged ? " snapped" : "") +
                        " rect=" + DropLogic.Str(before.Rect) + " grab " + p.X + "," + p.Y + " (" + src + ")" + (d.Snap ? "" : " snap=off") + (d.SnapBar ? "" : " snapBar=off"));
                    dragTimer.Start();
                }
                else if (ev == N2.EVENT_SYSTEM_MOVESIZEEND && drag != null && hwnd == drag.Win) EndDrag(true, time);
            }
            catch (Exception e) { Log("drag hook error " + e.Message); }
        }

        static void DragTick()
        {
            var d = drag;
            if (d == null) { dragTimer.Stop(); return; }
            if (!N.IsWindow(d.Win)) { EndDrag(false, 0); return; }
            N.POINT p; N2.GetCursorPos(out p);
            d.Track.Sample(N.Rect(d.Win), p);
            UpdateSnapArm(d, p);
            var h = d.Track.IsMove ? HitAt(d, p) : ZoneHit.No(d.Track.SizePairs > 0 ? "resizing" : "not a move yet");
            d.LastHit = h; d.LastPoint = p;
            if (h.Ok)
            {
                d.Misses = 0; d.Shown = h.Chrome; d.ShownZone = h.Zone;
                highlight.ShowAt(h.Zone);
            }
            else if (d.Shown != IntPtr.Zero)
            {
                // hysteresis: a single miss right at the edge of the shown zone does not hide it (no flicker); a
                // release there is still judged strictly by DropLogic.Decide
                var near = d.ShownZone; int m = DropLogic.Px(12, N.GetDpiForWindow(d.Shown) / 96.0);
                near.L -= m; near.T -= m; near.R += m; near.B += m;
                if (++d.Misses >= 2 || !DropLogic.Contains(near, p) || h.Reason.StartsWith("snap") || h.Reason == "resizing")
                { d.Shown = IntPtr.Zero; d.Misses = 0; highlight.HideNow(); }
            }
            string reason = h.Ok ? "ZONE of chrome " + h.Chrome + " " + DropLogic.Str(h.Zone) : h.Reason;
            if (reason != d.LastReason) { d.LastReason = reason; Log("drag over: " + reason); } // logged only when it changes
        }

        // The Snap layouts bar opens when a window is dragged to the top edge of a monitor and stays open while the
        // cursor is near it: from that moment until the cursor leaves that area, no drop zone is offered there.
        static void UpdateSnapArm(DragState d, N.POINT p)
        {
            if (!d.SnapBar) return;
            var mon = N2.MonitorFromPoint(p, N2.MONITOR_DEFAULTTONEAREST);
            var mr = N2.MonitorRect(mon); double s = N2.MonitorScale(mon);
            if (DropLogic.InSnapEdge(p, mr, s))
            {
                if (d.ArmedMonitor != mon) Log("drag over: snap bar area armed");
                d.ArmedMonitor = mon; d.ArmedRect = mr; d.ArmedScale = s; return;
            }
            if (d.ArmedMonitor != IntPtr.Zero && (!DropLogic.Contains(d.ArmedRect, p) || p.Y >= d.ArmedRect.T + DropLogic.Px(DropLogic.SnapBarDepthDip, d.ArmedScale)))
                d.ArmedMonitor = IntPtr.Zero;
        }

        // Would a release at p be a drop? The topmost window at p (ignoring the dragged window and our highlight)
        // must be a Chrome browser window and p must be inside its band, outside the areas Windows Snap uses.
        static ZoneHit HitAt(DragState d, N.POINT p)
        {
            var mon = N2.MonitorFromPoint(p, N2.MONITOR_DEFAULTTONEAREST);
            var mr = N2.MonitorRect(mon);
            if (d.Snap && DropLogic.InSnapEdge(p, mr, N2.MonitorScale(mon))) return ZoneHit.No("snap edge");
            if (d.ArmedMonitor != IntPtr.Zero && DropLogic.Contains(d.ArmedRect, p) && p.Y < d.ArmedRect.T + DropLogic.Px(DropLogic.SnapBarDepthDip, d.ArmedScale))
                return ZoneHit.No("snap bar area (move down once to leave it)");
            IntPtr found = IntPtr.Zero;
            IntPtr me = highlight.Handle, dragged = d.Win;
            N.EnumWindows((h, l) =>
            {
                if (h == me || h == dragged || !N.IsWindowVisible(h) || N.Cloaked(h) || N.IsIconic(h)) return true;
                // click-through windows (WS_EX_TRANSPARENT) never get the mouse, e.g. the shell's Snap-layout layer
                // that covers the top of the monitor while a window is dragged: skip them like hit-testing does
                if ((N.GetWindowLongPtr(h, N.GWL_EXSTYLE) & 0x20) != 0) return true;
                var wr = N.Rect(h);
                if (!DropLogic.Contains(wr, p)) return true;
                found = h; return false;
            }, IntPtr.Zero);
            if (found == IntPtr.Zero) return ZoneHit.No("no window");
            if (!IsChromeMain(found)) return ZoneHit.No("not chrome: " + N.Class(found));
            var band = BandOf(d, found);
            if (!band.HasValue) return ZoneHit.No("chrome " + found + " has no usable band");
            if (!DropLogic.Contains(band.Value, p)) return ZoneHit.No("chrome " + found + " outside band " + DropLogic.Str(band.Value));
            return new ZoneHit { Ok = true, Chrome = found, Zone = band.Value, Reason = "zone" };
        }

        // Chrome's UI band (tab strip, toolbar, bookmarks bar), cached per drag as long as the Chrome window keeps its rect
        static N.RECT? BandOf(DragState d, IntPtr chrome)
        {
            var w = N.Rect(chrome);
            KeyValuePair<N.RECT, N.RECT?> c;
            if (d.Zones.TryGetValue(chrome, out c) && DropLogic.SameRect(c.Key, w)) return c.Value;
            bool zoomed = N.IsZoomed(chrome);
            var mon = N2.MonitorRect(N2.MonitorFromWindow(chrome, N2.MONITOR_DEFAULTTONEAREST));
            double s = N.GetDpiForWindow(chrome) / 96.0; if (s <= 0) s = 1;
            var band = DropLogic.Band(w, ContentRect(chrome), zoomed, mon, s);
            d.Zones[chrome] = new KeyValuePair<N.RECT, N.RECT?>(w, band);
            return band;
        }

        static void EndDrag(bool released, uint time)
        {
            dragTimer.Stop();
            if (highlight != null) highlight.HideNow();
            var d = drag; drag = null;
            if (d == null || !released || !N.IsWindow(d.Win)) return;
            N.POINT cur; N2.GetCursorPos(out cur);
            bool hist; var released_at = N2.CursorAt(time, out hist);
            var final = N.Rect(d.Win);
            ZoneHit target; N.POINT at; string how;
            string why = DropLogic.Decide(d.Track, final, N.IsZoomed(d.Win), N2.IsArranged(d.Win), cur, p => HitAt(d, p), d.LastHit, d.LastPoint, hist ? released_at : (N.POINT?)null, out target, out at, out how);
            Log("drag end " + d.Win + " rect=" + DropLogic.Str(final) + " release " + at.X + "," + at.Y + " (" + how + ") cursor " + cur.X + "," + cur.Y +
                " samples=" + d.Track.Samples + " -> " + (why ?? "DROP on chrome " + target.Chrome));
            if (why != null || !N.IsWindow(target.Chrome)) return;
            PreDropPlacement[d.Win] = d.Before;
            var cr = N.Rect(target.Chrome); double s = N.GetDpiForWindow(target.Chrome) / 96.0; if (s <= 0) s = 1;
            dropsReported++;
            Log("dropAdd " + d.Win + " -> chrome " + target.Chrome);
            Send(new Dictionary<string, object> {
                { "evt", "dropAdd" }, { "win", WindowInfo(d.Win) }, { "chromeHwnd", target.Chrome.ToInt64() }, { "chromeTitle", N.Text(target.Chrome) },
                { "chromeRectDip", new[] { (int)(cr.L / s), (int)(cr.T / s), (int)(cr.W / s), (int)(cr.H / s) } } });
        }

        // the position to remember for a window that is being attached: the pre-drag one if it was just dropped
        static OriginalPos OriginalFor(IntPtr hwnd)
        {
            OriginalPos e;
            if (PreDropPlacement.TryGetValue(hwnd, out e))
            {
                PreDropPlacement.Remove(hwnd);
                if ((DateTime.UtcNow - e.At).TotalSeconds < 30) return e;
            }
            return OriginalPos.Of(hwnd);
        }
    }
}
