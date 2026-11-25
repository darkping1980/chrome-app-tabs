// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// dragprobe.exe - feasibility experiments for v0.3 drag-to-add (no injection, official APIs only)
//   dragprobe uia <chromeHwnd>     : how fast / how exactly UI Automation reports Chrome's tab strip rectangle
//   dragprobe watch <seconds>       : log EVENT_SYSTEM_MOVESIZESTART/END (out-of-context WinEvent hook) with cursor + rects
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;
using System.Windows.Forms;

static class D
{
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc f, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    static WinEventProc keep;
    static string R(IntPtr h) { RECT r; GetWindowRect(h, out r); return "[" + r.L + "," + r.T + "," + r.R + "," + r.B + "]"; }

    [STAThread]
    static int Main(string[] a)
    {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        Console.OutputEncoding = new UTF8Encoding(false);
        if (a[0] == "uia")
        {
            var sw = Stopwatch.StartNew();
            var root = AutomationElement.FromHandle(new IntPtr(long.Parse(a[1])));
            var tab = root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Tab));
            long t1 = sw.ElapsedMilliseconds;
            if (tab == null) { Console.WriteLine("{\"found\":false,\"ms\":" + t1 + "}"); return 0; }
            var r = tab.Current.BoundingRectangle;
            Console.WriteLine("{\"found\":true,\"ms\":" + t1 + ",\"class\":\"" + tab.Current.ClassName + "\",\"rect\":[" + (int)r.Left + "," + (int)r.Top + "," + (int)r.Right + "," + (int)r.Bottom + "]}");
            // second query: is it cheaper once the tree is warm?
            sw.Restart();
            root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Tab));
            Console.WriteLine("{\"warmMs\":" + sw.ElapsedMilliseconds + "}");
            return 0;
        }
        if (a[0] == "watch")
        {
            keep = (hook, ev, hwnd, idObject, idChild, thread, time) =>
            {
                if (idObject != 0) return;
                POINT p; GetCursorPos(out p);
                var sb = new StringBuilder(256); GetWindowText(hwnd, sb, 256);
                Console.WriteLine(DateTime.Now.ToString("HH:mm:ss.fff") + (ev == 0x0A ? " MOVESIZESTART " : " MOVESIZEEND   ") + hwnd + " cursor=" + p.X + "," + p.Y + " rect=" + R(hwnd) + " '" + sb + "'");
                Console.Out.Flush();
            };
            SetWinEventHook(0x0A, 0x0B, IntPtr.Zero, keep, 0, 0, 0 /*OUTOFCONTEXT*/);
            Console.WriteLine("ready"); Console.Out.Flush();
            var t = new Timer { Interval = int.Parse(a[1]) * 1000 }; t.Tick += delegate { Application.Exit(); }; t.Start();
            Application.Run();
            return 0;
        }
        return 1;
    }
}
