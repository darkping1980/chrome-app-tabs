// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// Unit tests for host\DropLogic.cs (drag-to-add decisions). Pure logic: no windows, no mouse, no keyboard.
// Run: powershell -File tests\unit\run.ps1
using System;
using System.Collections.Generic;

namespace AppTabs.Tests
{
    static class DropLogicTests
    {
        static int pass, fail;
        static void Check(string name, bool ok, string detail = "")
        {
            if (ok) pass++; else fail++;
            Console.WriteLine((ok ? "PASS " : "FAIL ") + name + (ok || detail == "" ? "" : "  -> " + detail));
        }
        static N.RECT R(int l, int t, int r, int b) { return new N.RECT { L = l, T = t, R = r, B = b }; }
        static N.POINT P(int x, int y) { return new N.POINT { X = x, Y = y }; }
        static N.RECT Move(N.RECT r, int dx, int dy) { return R(r.L + dx, r.T + dy, r.R + dx, r.B + dy); }
        static string S(N.RECT? r) { return r.HasValue ? DropLogic.Str(r.Value) : "null"; }

        // a fake desktop: one Chrome window whose zone is given; hits are strict
        static Func<N.POINT, ZoneHit> Zone(N.RECT z)
        {
            return p => DropLogic.Contains(z, p) ? new ZoneHit { Ok = true, Chrome = new IntPtr(42), Zone = z, Reason = "zone" } : ZoneHit.No("outside");
        }

        static string Decide(DragTracker t, N.RECT final, N.POINT cursor, N.RECT zone, ZoneHit last, N.POINT lastP, bool zoomed = false, bool arranged = false, N.POINT? hist = null)
        {
            ZoneHit target; N.POINT at; string how;
            return DropLogic.Decide(t, final, zoomed, arranged, cursor, Zone(zone), last, lastP, hist, out target, out at, out how);
        }

        // simulate a move by its title bar: cursor grabbed at (gx,gy) of the window, moved along a path in n steps
        static DragTracker MoveAlong(N.RECT start, int gx, int gy, N.POINT to, int n, bool restAtEnd, out N.RECT final)
        {
            var c0 = P(start.L + gx, start.T + gy);
            var t = new DragTracker(start, c0, false, DragKind.Move);
            var r = start;
            for (int i = 1; i <= n; i++)
            {
                var c = P(c0.X + (to.X - c0.X) * i / n, c0.Y + (to.Y - c0.Y) * i / n);
                r = R(c.X - gx, c.Y - gy, c.X - gx + start.W, c.Y - gy + start.H);
                t.Sample(r, c);
            }
            if (restAtEnd) { t.Sample(r, to); t.Sample(r, to); }
            final = r;
            return t;
        }

        static int Main()
        {
            // ---------- hit test -> kind
            Check("HTCAPTION is a move", DropLogic.KindFromHitTest(2) == DragKind.Move);
            bool allResize = true; for (int h = 10; h <= 17; h++) allResize &= DropLogic.KindFromHitTest(h) == DragKind.Resize;
            Check("HTLEFT..HTBOTTOMRIGHT are resizes", allResize);
            Check("HTCLIENT / no answer are unknown", DropLogic.KindFromHitTest(1) == DragKind.Unknown && DropLogic.KindFromHitTest(-1) == DragKind.Unknown && DropLogic.KindFromHitTest(0) == DragKind.Unknown);

            // ---------- band (drop zone)
            var mon1 = R(0, 0, 1920, 1080);
            var b1 = DropLogic.Band(R(100, 100, 1500, 1000), R(101, 187, 1499, 999), false, mon1, 1.0);
            Check("normal Chrome: band = window top .. content top", b1.HasValue && DropLogic.SameRect(b1.Value, R(108, 100, 1350, 187)), S(b1));
            var b2 = DropLogic.Band(R(-8, -8, 1928, 1040), R(0, 80, 1920, 1032), true, mon1, 1.0);
            Check("maximized Chrome: band clipped to the monitor, includes the toolbar", b2.HasValue && DropLogic.SameRect(b2.Value, R(8, 0, 1770, 80)), S(b2));
            var b3 = DropLogic.Band(R(100, 100, 1500, 1000), R(101, 600, 1499, 999), false, mon1, 1.0);
            Check("content top far down (not browser UI) -> tab-strip-only fallback", b3.HasValue && b3.Value.T == 100 && b3.Value.B == 141, S(b3));
            var b4 = DropLogic.Band(R(100, 100, 1500, 1000), null, false, mon1, 1.0);
            Check("no content rect -> tab-strip-only fallback", b4.HasValue && b4.Value.B == 141, S(b4));
            var b5 = DropLogic.Band(R(100, 100, 1500, 1000), R(101, 110, 1499, 999), false, mon1, 1.0);
            Check("content top too close (fullscreen-like) -> fallback, never a sliver", b5.HasValue && b5.Value.B == 141, S(b5));
            var b6 = DropLogic.Band(R(1920, 6, 3840, 1038), R(1920, 140, 3840, 1038), false, R(1920, 6, 3840, 1086), 1.5);
            Check("150% DPI on a second monitor: scaled margins", b6.HasValue && DropLogic.SameRect(b6.Value, R(1932, 6, 3615, 140)), S(b6));
            var b7 = DropLogic.Band(R(-1928, -8, 8, 1040), R(-1920, 80, 0, 1032), true, R(-1920, 0, 0, 1080), 1.0);
            Check("maximized on a monitor left of the primary (negative coordinates)", b7.HasValue && DropLogic.SameRect(b7.Value, R(-1912, 0, -150, 80)), S(b7));
            var b8 = DropLogic.Band(R(100, 100, 300, 400), R(101, 187, 299, 399), false, mon1, 1.0);
            Check("tiny Chrome window -> no band", !b8.HasValue, S(b8));
            var b9 = DropLogic.Band(R(100, 100, 1500, 1000), R(101, 330, 1499, 999), false, mon1, 1.0);
            Check("very tall top UI (>220 DIP) is not trusted", b9.HasValue && b9.Value.B == 141, S(b9));

            // ---------- snap edge
            Check("snap edge at 100%: y < top+8", DropLogic.InSnapEdge(P(500, 7), mon1, 1.0) && !DropLogic.InSnapEdge(P(500, 8), mon1, 1.0));
            Check("snap edge at 150%: y < top+12", DropLogic.InSnapEdge(P(500, 11), mon1, 1.5) && !DropLogic.InSnapEdge(P(500, 12), mon1, 1.5));
            Check("snap edge on an offset monitor (top=6)", DropLogic.InSnapEdge(P(2500, 13), R(1920, 6, 3840, 1086), 1.0) && !DropLogic.InSnapEdge(P(2500, 14), R(1920, 6, 3840, 1086), 1.0));

            // ---------- decisions
            var zone = R(8, 0, 1770, 80);
            var start = R(400, 500, 1100, 950);
            N.RECT final;

            var t1 = MoveAlong(start, 250, 12, P(700, 30), 20, true, out final);
            Check("plain move released on the zone -> drop", Decide(t1, final, P(700, 30), zone, ZoneHit.No("x"), P(0, 0)) == null);
            var t1b = MoveAlong(start, 250, 12, P(700, 30), 20, true, out final);
            Check("release point comes from the window, not from the cursor that moved on afterwards",
                  Decide(t1b, final, P(700, 600), zone, ZoneHit.No("x"), P(0, 0)) == null);

            var t2 = MoveAlong(start, 250, 12, P(700, 200), 20, true, out final);
            var inZone = new ZoneHit { Ok = true, Chrome = new IntPtr(42), Zone = zone };
            string r2 = Decide(t2, final, P(700, 30), zone, inZone, P(700, 30));
            Check("released BELOW the zone, cursor/last sample in the zone afterwards -> no drop (exact release point wins)", r2 != null, r2 ?? "accepted");

            var t3 = MoveAlong(start, 250, 12, P(700, 30), 3, false, out final); // fast flick: 3 samples, no rest
            Check("fast flick, no rest: start offset still gives the release point -> drop", Decide(t3, final, P(700, 30), zone, ZoneHit.No("x"), P(0, 0)) == null);

            var t3b = new DragTracker(start, P(650, 512), false, DragKind.Move); // released before any sample
            var f3b = Move(start, 50, -480);
            Check("release before the first sample (window moved, size same) -> judged from start offset",
                  Decide(t3b, f3b, P(0, 0), zone, ZoneHit.No("x"), P(0, 0)) == null);

            // passed over the zone, then released lower: never accepted
            var t4 = new DragTracker(start, P(650, 512), false, DragKind.Move);
            var rr = start;
            foreach (var c in new[] { P(650, 400), P(660, 40), P(670, 35), P(680, 120), P(690, 160) })
            { rr = R(c.X - 250, c.Y - 12, c.X - 250 + start.W, c.Y - 12 + start.H); t4.Sample(rr, c); }
            string r4 = Decide(t4, rr, P(690, 160), zone, ZoneHit.No("outside"), P(690, 160));
            Check("passed over the zone within the last samples but released outside -> no drop", r4 != null, r4 ?? "accepted");

            // snapped window: Windows restores its size when it starts moving (one size change), hit test unknown
            var snapped = R(0, 0, 960, 1032);
            var t5 = new DragTracker(snapped, P(480, 12), false, DragKind.Unknown);
            var restored = R(130, 0, 830, 450); // restored size, cursor kept proportionally
            t5.Sample(restored, P(480, 12));
            var pos = restored;
            for (int i = 1; i <= 6; i++) { pos = Move(restored, 20 * i, 3 * i); t5.Sample(pos, P(480 + 20 * i, 12 + 3 * i)); }
            Check("snapped window drag (size restored once, then moving) is a move", t5.IsMove, "moves=" + t5.MovePairs + " sizes=" + t5.SizePairs);
            t5.Sample(pos, P(600, 30)); t5.Sample(pos, P(600, 30)); // rest
            Check("snapped window released on the zone after a rest -> drop", Decide(t5, pos, P(600, 30), zone, ZoneHit.No("x"), P(0, 0)) == null);

            // snapped window released fast (no rest after the restore): no exact release point
            var t6 = new DragTracker(snapped, P(480, 12), false, DragKind.Move);
            t6.Sample(restored, P(480, 40));
            var p6 = Move(restored, 100, 10); t6.Sample(p6, P(590, 30));
            var last6 = new ZoneHit { Ok = true, Chrome = new IntPtr(42), Zone = zone };
            Check("fast snapped drag: cursor now + last sample both in zone, cursor over the window -> drop",
                  Decide(t6, p6, P(590, 30), zone, last6, P(590, 30)) == null);
            Check("fast snapped drag: last sample outside the zone -> no drop",
                  Decide(t6, p6, P(590, 30), zone, ZoneHit.No("outside"), P(590, 120)) != null);
            Check("fast snapped drag: cursor already left the dropped window -> no drop",
                  Decide(t6, p6, P(1500, 30), zone, last6, P(590, 30)) != null);

            // real resize with unknown hit test: size changes repeatedly
            var t7 = new DragTracker(start, P(1099, 700), false, DragKind.Unknown);
            for (int i = 1; i <= 8; i++) t7.Sample(R(400, 500, 1100 + 30 * i, 950), P(1099 + 30 * i, 700));
            Check("resize (right edge, unknown hit test) is not a move", !t7.IsMove);
            var t7b = new DragTracker(start, P(400, 520), false, DragKind.Unknown); // top-left edge: position and size change together
            for (int i = 1; i <= 8; i++) t7b.Sample(R(400 - 20 * i, 500 - 50 * i, 1100, 950), P(400 - 20 * i, 520 - 50 * i));
            Check("resize (top-left edge, unknown hit test) is not a move", !t7b.IsMove);
            var t7c = new DragTracker(start, P(650, 500), false, DragKind.Resize); // top edge by hit test
            for (int i = 1; i <= 8; i++) t7c.Sample(R(400, 500 - 55 * i, 1100, 950), P(650, 500 - 55 * i));
            Check("resize from the top edge into the zone -> no drop", Decide(t7c, R(400, 60, 1100, 950), P(650, 60), zone, ZoneHit.No("x"), P(0, 0)) != null);

            // hit test answered for a point the cursor reached a moment later (top border just above the caption): the
            // window only changed its position, so it is a move after all
            var th = new DragTracker(start, P(650, 501), false, DragKind.Resize);
            var ph = start;
            for (int i = 1; i <= 6; i++) { ph = Move(start, 30 * i, -40 * i); th.Sample(ph, P(650 + 30 * i, 512 - 40 * i)); }
            Check("hit test said HTTOP but the window only moved -> it is a move", th.IsMove, "moves=" + th.MovePairs + " sizes=" + th.SizePairs);
            var th2 = new DragTracker(start, P(650, 501), false, DragKind.Resize);
            th2.Sample(Move(start, 30, -40), P(680, 472));
            Check("...but not on a single sample", !th2.IsMove);

            // release point from the mouse-move history: the start offset is read after the drag threshold, here
            // 21,-11 px away from the real grab point (250,12); no rest, so no exact offset
            var tq = new DragTracker(start, P(671, 501), false, DragKind.Move);
            var fq = R(500, 60, 1200, 510);   // real release (750,72); start-offset estimate (771,61)
            Check("released just BELOW the zone: the late start offset would accept it, the history point rejects it",
                  Decide(tq, fq, P(750, 300), R(8, 0, 1770, 70), ZoneHit.No("x"), P(0, 0), false, false, P(750, 72)) != null);
            var fq2 = R(500, 50, 1200, 500);  // real release (750,62); estimate (771,51)
            Check("released just inside the zone's top: the history point accepts it",
                  Decide(tq, fq2, P(750, 300), R(8, 55, 1770, 120), ZoneHit.No("x"), P(0, 0), false, false, P(750, 62)) == null);
            Check("history point not on the dropped window is ignored (start offset decides)",
                  Decide(tq, fq2, P(750, 300), R(8, 55, 1770, 120), ZoneHit.No("x"), P(0, 0), false, false, P(150, 40)) != null);
            Check("history point far from the start-offset estimate is ignored",
                  Decide(tq, fq2, P(750, 300), R(8, 55, 1770, 120), ZoneHit.No("x"), P(0, 0), false, false, P(1150, 62)) != null);

            // Windows Snap took over at release
            var t8 = MoveAlong(start, 250, 12, P(700, 30), 20, true, out final);
            Check("size changed at release (Snap layout) -> no drop", Decide(t8, R(0, 0, 960, 1032), P(700, 30), zone, inZone, P(700, 30)) != null);
            Check("maximized at release (top-edge Snap) -> no drop", Decide(t8, final, P(700, 30), zone, inZone, P(700, 30), true) != null);
            Check("arranged at release -> no drop", Decide(t8, final, P(700, 30), zone, inZone, P(700, 30), false, true) != null);

            // Esc: Windows puts the window back
            var t9 = MoveAlong(start, 250, 12, P(700, 30), 20, true, out final);
            Check("Esc (window back at its start rect) -> cancelled", Decide(t9, start, P(700, 30), zone, inZone, P(700, 30)) != null);
            var tz = new DragTracker(R(-8, -8, 1928, 1040), P(900, 10), true, DragKind.Move);
            Check("maximized window, Esc / plain click (still maximized) -> cancelled", Decide(tz, R(-8, -8, 1928, 1040), P(900, 10), zone, inZone, P(900, 10), true) != null);

            // maximized source window: restored when moved; offset unknown until the window rests
            var tm = new DragTracker(R(-8, -8, 1928, 1040), P(900, 10), true, DragKind.Move);
            var rm = R(550, 0, 1250, 450); tm.Sample(rm, P(900, 10));
            var rm2 = Move(rm, 0, 20); tm.Sample(rm2, P(900, 30)); tm.Sample(rm2, P(900, 30)); tm.Sample(rm2, P(900, 30));
            Check("maximized window dragged onto the zone after a rest -> drop", Decide(tm, rm2, P(900, 300), zone, ZoneHit.No("x"), P(0, 0)) == null);

            // a grab offset that would put the release point outside the window is not trusted
            var tb = new DragTracker(start, P(10, 10), false, DragKind.Move); // cursor not on the window at start (late event)
            Check("start cursor outside the window -> no start offset", !tb.HasOffset);

            // a rest BEFORE the window moved does not give an exact offset (the program may anchor the move later)
            var tr = new DragTracker(start, P(650, 512), false, DragKind.Unknown);
            tr.Sample(start, P(650, 512)); tr.Sample(start, P(650, 512));
            Check("rest before the window moved -> offset not exact", !tr.OffsetExact);
            var fr = Move(start, 309, -486); // program anchored its move 9 px right / 9 px down of the press point
            for (int i = 1; i <= 4; i++) tr.Sample(Move(start, 77 * i, -121 * i), P(650 + 77 * i + 9, 512 - 121 * i + 9));
            tr.Sample(fr, P(968, 35)); tr.Sample(fr, P(968, 35));
            Check("rest after the move -> exact offset at the program's real anchor", tr.OffsetExact && tr.OffX == 968 - fr.L && tr.OffY == 35 - fr.T, tr.OffX + "," + tr.OffY);
            Check("history point wins over the offset", Decide(tr, fr, P(0, 0), R(8, 0, 1770, 80), ZoneHit.No("x"), P(0, 0), false, false, P(968, 35)) == null);

            // DPI change while crossing monitors: one rescale during the move does not make it a resize
            var td = new DragTracker(start, P(650, 512), false, DragKind.Unknown);
            var q = start;
            for (int i = 1; i <= 4; i++) { q = Move(start, 40 * i, 0); td.Sample(q, P(650 + 40 * i, 512)); }
            var scaled = R(q.L, q.T, q.L + start.W * 3 / 2, q.T + start.H * 3 / 2); td.Sample(scaled, P(q.L + 375, 512));
            for (int i = 1; i <= 4; i++) { q = Move(scaled, 40 * i, 0); td.Sample(q, P(scaled.L + 375 + 40 * i, 512)); }
            Check("move across monitors with one DPI rescale is still a move", td.IsMove, "moves=" + td.MovePairs + " sizes=" + td.SizePairs);

            Console.WriteLine();
            Console.WriteLine("unit tests: " + pass + " passed, " + fail + " failed");
            return fail == 0 ? 0 : 1;
        }
    }
}
