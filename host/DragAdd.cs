// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// v0.3 drag-to-add: drag a program window by its title bar onto a Chrome tab strip to add it as a tab.
//
// Only official, out-of-process mechanisms are used:
//  * SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART/END, WINEVENT_OUTOFCONTEXT): Windows tells us when ANY window
//    enters/leaves its normal move/size loop. Nothing is injected and the drag itself is never intercepted,
//    so ordinary moving and Windows Snap behave exactly as before.
//  * While (and only while) such a drag is in progress, a 30 ms timer reads the cursor position (GetCursorPos)
//    to decide whether it is over a Chrome tab strip. No timer runs otherwise.
//  * The tab strip band comes from UI Automation (Chrome's "TabContainer" element, read-only, once per window
//    per drag) with a geometric fallback.
//  * The highlight is our own click-through, non-activating, topmost window; Chrome itself is not modified.
// On release inside the zone the host reports "dropAdd" to the extension, which reuses the normal "add" path
// (duplicate check included). The placement from BEFORE the drag is kept as the program's original placement.
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
        [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
        [DllImport("user32.dll")] public static extern bool PtInRect(ref N.RECT r, N.POINT p);
        public const uint EVENT_SYSTEM_MOVESIZESTART = 0x000A, EVENT_SYSTEM_MOVESIZEEND = 0x000B;
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
        N.RECT shownAt; bool shown;
        public void ShowAt(N.RECT r, string text)
        {
            if (shown && r.L == shownAt.L && r.T == shownAt.T && r.R == shownAt.R && r.B == shownAt.B) return; // nothing to do
            if (label.Text != text) label.Text = text;
            N.SetWindowPos(Handle, new IntPtr(-1) /*HWND_TOPMOST*/, r.L, r.T, r.W, r.H, N.SWP_NOACTIVATE | N.SWP_SHOWWINDOW);
            shownAt = r; shown = true;
        }
        // shown/hidden through Win32, so do not rely on Form.Visible
        public void HideNow() { if (shown || N.IsWindowVisible(Handle)) { N.ShowWindow(Handle, 0 /*SW_HIDE*/); shown = false; } }
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
            public IntPtr Win; public N.RECT StartRect; public N.WINDOWPLACEMENT StartPlacement;
            public IntPtr Target; public N.RECT Zone; public bool Resizing; public bool WasZoomed; public string LastReason = "";
            public Dictionary<IntPtr, N.RECT?> Zones = new Dictionary<IntPtr, N.RECT?>();
            public Dictionary<uint, string> Names = new Dictionary<uint, string>(); // process names, cached for this drag
        }
        static DragState drag;
        // placement from before the drop-drag, consumed by the next attach of that window
        static readonly Dictionary<IntPtr, KeyValuePair<DateTime, N.WINDOWPLACEMENT>> PreDropPlacement = new Dictionary<IntPtr, KeyValuePair<DateTime, N.WINDOWPLACEMENT>>();

        static void StartDragWatcher()
        {
            dragHookProc = OnMoveSize;
            N.SetWinEventHook(N2.EVENT_SYSTEM_MOVESIZESTART, N2.EVENT_SYSTEM_MOVESIZEEND, IntPtr.Zero, dragHookProc, 0, 0, N.WINEVENT_OUTOFCONTEXT | N.WINEVENT_SKIPOWNPROCESS);
            dragTimer = new System.Windows.Forms.Timer { Interval = 30 };
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
                if (ev == N2.EVENT_SYSTEM_MOVESIZESTART)
                {
                    EndDrag(false);
                    if (!DragAddEnabled) return;
                    if (!IsCandidateWindow(hwnd)) { Log("drag start ignored (not a candidate) " + hwnd + " " + N.Class(hwnd)); return; }
                    if (Att.Values.Any(a => a.App == hwnd)) { Log("drag start ignored (already a tab) " + hwnd); return; } // managed by the overlay logic
                    drag = new DragState { Win = hwnd, StartRect = N.Rect(hwnd), StartPlacement = N.Placement(hwnd), WasZoomed = N.IsZoomed(hwnd) };
                    Log("drag start " + hwnd + " '" + N.Text(hwnd) + "'");
                    dragTimer.Start();
                }
                else if (ev == N2.EVENT_SYSTEM_MOVESIZEEND && drag != null && hwnd == drag.Win) EndDrag(true);
            }
            catch (Exception e) { Log("drag hook error " + e.Message); }
        }

        static void DragTick()
        {
            if (drag == null) { dragTimer.Stop(); return; }
            if (!N.IsWindow(drag.Win)) { EndDrag(false); return; }
            var r = N.Rect(drag.Win);
            // a resize, not a move: never a drop. A maximized window cannot be resized; Windows restores its size when it is dragged
if (!drag.WasZoomed && (r.W != drag.StartRect.W || r.H != drag.StartRect.H)) drag.Resizing = true;
            N.POINT p; N2.GetCursorPos(out p);
            IntPtr target = IntPtr.Zero; N.RECT zone = new N.RECT(); string reason = "resizing";
            if (!drag.Resizing && FindDropTarget(p, out target, out zone, out reason)) { drag.Target = target; drag.Zone = zone; highlight.ShowAt(zone, "여기에 놓으면 Chrome 탭으로 추가"); }
            else { drag.Target = IntPtr.Zero; highlight.HideNow(); }
            if (reason != drag.LastReason) { drag.LastReason = reason; Log("drag over: " + reason); } // logged only when it changes
        }

        // the topmost window under the cursor (ignoring the window being dragged and our highlight) must be a Chrome
        // browser window, and the cursor must be inside its tab strip band, away from the screen's top Snap edge
        static bool FindDropTarget(N.POINT p, out IntPtr target, out N.RECT zone, out string reason)
        {
            target = IntPtr.Zero; zone = new N.RECT(); reason = "";
            IntPtr found = IntPtr.Zero;
            IntPtr me = highlight.Handle, dragged = drag.Win;
            N.EnumWindows((h, l) =>
            {
                if (h == me || h == dragged || !N.IsWindowVisible(h) || N.Cloaked(h) || N.IsIconic(h)) return true;
                // click-through windows (WS_EX_TRANSPARENT) never get the mouse, e.g. the shell's Snap-layout layer
                // that covers the top of the monitor while a window is dragged: skip them like hit-testing does
                if ((N.GetWindowLongPtr(h, N.GWL_EXSTYLE) & 0x20) != 0) return true;
                var wr = N.Rect(h);
                if (!N2.PtInRect(ref wr, p)) return true;
                found = h; return false;
            }, IntPtr.Zero);
            if (found == IntPtr.Zero) { reason = "no window"; return false; }
            if (!IsChromeMain(found)) { reason = "not chrome: " + N.Class(found) + " ex=" + N.GetWindowLongPtr(found, N.GWL_EXSTYLE).ToString("X"); return false; }
            var mi = new N2.MONITORINFO(); mi.cbSize = Marshal.SizeOf(mi);
            N2.GetMonitorInfo(N2.MonitorFromPoint(p, 2), ref mi);
            if (p.Y < mi.rcMonitor.T + 8) { reason = "snap edge"; return false; } // leave the top edge to Windows Snap
            var z = TabStripZone(found);
            if (!N2.PtInRect(ref z, p)) { reason = "chrome " + found + " outside tab strip [" + z.L + "," + z.T + "," + z.R + "," + z.B + "]"; return false; }
            target = found; zone = z; reason = "TAB STRIP of chrome " + found; return true;
        }

        static N.RECT TabStripZone(IntPtr chrome)
        {
            N.RECT? cached;
            if (drag.Zones.TryGetValue(chrome, out cached) && cached.HasValue) return cached.Value;
            var w = N.Rect(chrome);
            double s = N.GetDpiForWindow(chrome) / 96.0;
            int top = N.IsZoomed(chrome) ? w.T + (int)(8 * s) : w.T, bottom = top + (int)(41 * s); // geometric fallback
            try
            {   // read-only UIA query of Chrome's tab strip ("TabContainer"); ~100 ms cold, done once per window per drag
                var root = System.Windows.Automation.AutomationElement.FromHandle(chrome);
                var tab = root.FindFirst(System.Windows.Automation.TreeScope.Descendants,
                    new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.ControlTypeProperty, System.Windows.Automation.ControlType.Tab));
                if (tab != null)
                {
                    var br = tab.Current.BoundingRectangle;
                    if (br.Height > 10 && br.Top >= w.T - 1 && br.Bottom <= w.B) { top = (int)br.Top; bottom = (int)br.Bottom; }
                }
            }
            catch { }
            int frame = N.IsZoomed(chrome) ? (int)(8 * s) : 0;
            var z = new N.RECT { L = w.L + frame + (int)(8 * s), T = top, R = w.R - frame - (int)(150 * s) /*caption buttons*/, B = bottom };
            drag.Zones[chrome] = z;
            return z;
        }

        static void EndDrag(bool released)
        {
            dragTimer.Stop();
            if (highlight != null) highlight.HideNow();
            var d = drag; drag = null;
            if (d == null || !released) return;
            N.POINT ep; N2.GetCursorPos(out ep);
            Log("drag end " + d.Win + " target=" + d.Target + " cursor " + ep.X + "," + ep.Y + " last=" + d.LastReason);
            DragTickFinal(d);
        }

        static void DragTickFinal(DragState d)
        {
            if (d.Resizing || d.Target == IntPtr.Zero || !N.IsWindow(d.Win) || !N.IsWindow(d.Target)) return;
            N.POINT p; N2.GetCursorPos(out p);
            var z = d.Zone;
            if (!N2.PtInRect(ref z, p)) return;
            var r = N.Rect(d.Win);
            if (!d.WasZoomed && (r.W != d.StartRect.W || r.H != d.StartRect.H)) return;
            // Esc during a move puts the window back where it started: that is a cancelled drag, never a drop
            bool back = d.WasZoomed ? N.IsZoomed(d.Win) : (r.L == d.StartRect.L && r.T == d.StartRect.T);
            if (back) { Log("drag cancelled (window back at its start position)"); return; }
            PreDropPlacement[d.Win] = new KeyValuePair<DateTime, N.WINDOWPLACEMENT>(DateTime.UtcNow, d.StartPlacement);
            var cr = N.Rect(d.Target); double s = N.GetDpiForWindow(d.Target) / 96.0;
            dropsReported++;
            Log("dropAdd " + d.Win + " -> chrome " + d.Target);
            Send(new Dictionary<string, object> {
                { "evt", "dropAdd" }, { "win", WindowInfo(d.Win) }, { "chromeHwnd", d.Target.ToInt64() }, { "chromeTitle", N.Text(d.Target) },
                { "chromeRectDip", new[] { (int)(cr.L / s), (int)(cr.T / s), (int)(cr.W / s), (int)(cr.H / s) } } });
        }

        // the placement to remember for a window that is being attached: the pre-drag one if it was just dropped
        static N.WINDOWPLACEMENT OriginalPlacementFor(IntPtr hwnd)
        {
            KeyValuePair<DateTime, N.WINDOWPLACEMENT> e;
            if (PreDropPlacement.TryGetValue(hwnd, out e))
            {
                PreDropPlacement.Remove(hwnd);
                if ((DateTime.UtcNow - e.Key).TotalSeconds < 30) return e.Value;
            }
            return N.Placement(hwnd);
        }
    }
}
