// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// v0.3.3 drag-to-add decisions, free of Win32 calls so they can be unit tested (tests\unit\drop_logic_test.cs).
// All coordinates are physical screen pixels (the host is per-monitor-v2 DPI aware); s = DPI / 96 of the relevant window/monitor.
using System;

namespace AppTabs
{
    enum DragKind { Unknown, Move, Resize }

    // the answer to "may a drop happen at this point?"
    struct ZoneHit
    {
        public bool Ok;
        public IntPtr Chrome;
        public N.RECT Zone;
        public string Reason;
        public static ZoneHit No(string reason) { return new ZoneHit { Ok = false, Reason = reason }; }
    }

    static class DropLogic
    {
        // Windows Snap: the top edge of a monitor belongs to Windows (maximize / Snap layouts bar)
        public const int SnapEdgeDip = 8;
        // after the cursor touched the top edge, the Snap layouts bar may be open below it: stay out of this depth
        // until the cursor has left it once (tunable; see docs/drag-drop-analysis.md)
        public const int SnapBarDepthDip = 120;
        // the drop band must look like Chrome's own UI (tab strip + toolbar + bookmarks bar), never like a web page
        public const int MinBandDip = 24, MaxBandDip = 220, FallbackBandDip = 41;
        // caption buttons (minimize / maximize / close) on the right of the tab strip row
        public const int CaptionButtonsDip = 150, SideMarginDip = 8;

        public static int Px(double dip, double s) { return (int)Math.Round(dip * s); }

        public static bool Contains(N.RECT r, N.POINT p) { return p.X >= r.L && p.X < r.R && p.Y >= r.T && p.Y < r.B; }

        public static bool SameRect(N.RECT a, N.RECT b) { return a.L == b.L && a.T == b.T && a.R == b.R && a.B == b.B; }

        public static string Str(N.RECT r) { return "[" + r.L + "," + r.T + "," + r.R + "," + r.B + "]"; }

        // WM_NCHITTEST result at the grab point: HTCAPTION = move; HTLEFT..HTBOTTOMRIGHT = resize; anything else
        // (HTCLIENT for apps that start the move themselves, no answer, ...) is decided from how the window behaves
        public static DragKind KindFromHitTest(long ht)
        {
            if (ht == 2) return DragKind.Move;
            if (ht >= 10 && ht <= 17) return DragKind.Resize;
            return DragKind.Unknown;
        }

        // The drop zone of a Chrome browser window: its own UI above the web page, i.e. from the top of the window
        // (of the monitor, when maximized: the frame hangs off-screen) down to the top of the web content.
        // content = the Chrome_RenderWidgetHostHWND rect (null if unknown); a value that does not look like a band
        // of browser UI is ignored and a tab-strip-only band is used instead. Returns null if there is no usable band.
        public static N.RECT? Band(N.RECT win, N.RECT? content, bool zoomed, N.RECT monitor, double s)
        {
            var inner = win;
            if (zoomed)
            {
                inner.L = Math.Max(win.L, monitor.L); inner.T = Math.Max(win.T, monitor.T);
                inner.R = Math.Min(win.R, monitor.R); inner.B = Math.Min(win.B, monitor.B);
            }
            int top = inner.T, bottom = top + Px(FallbackBandDip, s);
            if (content.HasValue)
            {
                var c = content.Value; int band = c.T - top;
                if (band >= Px(MinBandDip, s) && band <= Px(MaxBandDip, s) && c.L >= inner.L - 1 && c.R <= inner.R + 1) bottom = c.T;
            }
            var z = new N.RECT { L = inner.L + Px(SideMarginDip, s), T = top, R = inner.R - Px(CaptionButtonsDip, s), B = Math.Min(bottom, inner.B) };
            if (z.W < Px(100, s) || z.H < Px(16, s)) return null;
            return z;
        }

        public static bool InSnapEdge(N.POINT p, N.RECT monitor, double s) { return p.Y < monitor.T + Math.Max(SnapEdgeDip, Px(SnapEdgeDip, s)); }

        // Final decision when the move/size loop ends. Returns null when the drop is accepted (target/at are set),
        // otherwise the reason for refusing it. A drop is accepted only for a point that is strictly inside the zone:
        //  * preferably the exact release point: the cursor position at the release time from the system's mouse-move
        //    history, else final window position + grab offset measured while window and cursor were at rest, else the
        //    final position + the offset read when the loop started (a few pixels off: Windows starts the loop only
        //    after the drag threshold). All of these are independent of where the mouse went after the release.
        //  * otherwise (offset unknown, e.g. a quick drag right after Windows restored a snapped window) the cursor now
        //    AND the last sample must both be inside the same zone and the cursor must still be over the dropped window.
        //    Having passed over the zone recently is never enough on its own.
        public static string Decide(DragTracker t, N.RECT final, bool finalZoomed, bool finalArranged, N.POINT cursorNow,
                                    Func<N.POINT, ZoneHit> hitAt, ZoneHit lastSample, N.POINT lastSamplePoint, N.POINT? historyRelease,
                                    out ZoneHit target, out N.POINT at, out string how)
        {
            target = new ZoneHit(); at = cursorNow; how = "none";
            if (!t.IsMove) return "not a move (" + t.Hit + ", moves=" + t.MovePairs + ", resizes=" + t.SizePairs + ")";
            bool back = t.StartZoomed ? finalZoomed : SameRect(final, t.Start);
            if (back) return "cancelled (window back at its start position)";
            if (finalZoomed || finalArranged || final.W != t.Last.W || final.H != t.Last.H) return "Windows Snap / maximize handled the release";
            var est = t.ReleasePoint(final);
            N.POINT? rp = null;
            // the system's mouse-move history at the time the loop ended: where the button was released. Trusted only
            // when it lies on the dropped window and agrees with the offset estimate (if there is one)
            if (historyRelease.HasValue && Contains(final, historyRelease.Value) &&
                (!est.HasValue || (Math.Abs(est.Value.X - historyRelease.Value.X) <= 64 && Math.Abs(est.Value.Y - historyRelease.Value.Y) <= 64)))
            { rp = historyRelease; how = "history"; }
            if (!rp.HasValue && est.HasValue && t.OffsetExact) { rp = est; how = "offset"; }
            if (!rp.HasValue && est.HasValue) { rp = est; how = "start-offset"; }
            if (rp.HasValue)
            {
                at = rp.Value;
                var h = hitAt(at);
                if (!h.Ok) return "release point " + at.X + "," + at.Y + ": " + h.Reason;
                target = h; return null;
            }
            how = "cursor";
            if (!Contains(final, cursorNow)) return "release point unknown and the cursor left the window";
            var c = hitAt(cursorNow);
            if (!c.Ok) return "cursor " + cursorNow.X + "," + cursorNow.Y + ": " + c.Reason;
            if (!lastSample.Ok || lastSample.Chrome != c.Chrome || !Contains(c.Zone, lastSamplePoint))
                return "release point unknown and the last sample was not inside the same zone";
            target = c; return null;
        }
    }

    // Follows one move/size loop from periodic samples of (window rect, cursor).
    class DragTracker
    {
        public readonly DragKind Hit;
        public readonly N.RECT Start;
        public readonly bool StartZoomed;
        public N.RECT Last;
        public int Samples, MovePairs, SizePairs;
        // grab offset = cursor - window top-left; constant during a move as long as the size does not change
        public bool HasOffset, OffsetExact;
        public int OffX, OffY;
        N.POINT lastP;

        public DragTracker(N.RECT start, N.POINT cursor, bool zoomed, DragKind hit)
        {
            Start = start; Last = start; StartZoomed = zoomed; Hit = hit; lastP = cursor;
            // read right when the loop starts (the window has not moved yet): a good first estimate. A maximized
            // window is restored (resized) as soon as it moves, so its start offset is useless.
            if (!zoomed && DropLogic.Contains(start, cursor)) { HasOffset = true; OffX = cursor.X - start.L; OffY = cursor.Y - start.T; }
        }

        public void Sample(N.RECT r, N.POINT p)
        {
            bool sized = r.W != Last.W || r.H != Last.H;
            bool moved = r.L != Last.L || r.T != Last.T;
            if (sized) { SizePairs++; HasOffset = false; OffsetExact = false; } // Windows restored / rescaled the window: re-measure
            else if (moved) MovePairs++;
            // window and cursor both at rest between two samples: no lag between the two readings, the offset is exact.
            // Only once the window has really moved: before that the anchor of the move is not known yet (some programs,
            // e.g. SWT ones, start the move themselves after their own drag threshold, from where the cursor is then)
            if (!sized && !moved && p.X == lastP.X && p.Y == lastP.Y && DropLogic.Contains(r, p) && !DropLogic.SameRect(r, Start))
            { HasOffset = true; OffsetExact = true; OffX = p.X - r.L; OffY = p.Y - r.T; }
            Last = r; lastP = p; Samples++;
        }

        // Is this a move (and not a resize)? Hit test and behaviour together. Behaviour: a move changes the
        // position at a constant size, a resize changes the size. A few size changes are expected during a move:
        // Windows restores a snapped or maximized window when it starts moving and rescales it on a DPI change.
        public bool IsMove
        {
            get
            {
                // the behaviour wins over a contradicting hit test: the hit test may be answered for a point the cursor
                // reached a moment later (e.g. the top border just above the grabbed caption), but a window that only
                // changed its position was moved, and one whose size keeps changing is being resized
                if (Hit == DragKind.Resize) return SizePairs == 0 && MovePairs >= 2;
                bool fewResizes = SizePairs <= Math.Max(1, MovePairs / 3);
                if (Hit == DragKind.Move) return fewResizes;
                return MovePairs >= 2 && fewResizes;
            }
        }

        // where the cursor was when the button was released: the window stopped there, at the grab offset
        public N.POINT? ReleasePoint(N.RECT final)
        {
            if (!HasOffset || final.W != Last.W || final.H != Last.H) return null;
            var p = new N.POINT { X = final.L + OffX, Y = final.T + OffY };
            return DropLogic.Contains(final, p) ? p : (N.POINT?)null;
        }
    }
}
