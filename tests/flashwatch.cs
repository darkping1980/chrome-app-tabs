// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// flashwatch: passive observer of taskbar notifications (test tool only, changes nothing).
// Registers a hidden window as a shell hook window, the same mechanism the taskbar uses, and writes one line per
//   HSHELL_FLASH           (0x8006) a window's taskbar button is told to flash (FlashWindow(Ex) or a refused
//                                   SetForegroundWindow)
//   HSHELL_WINDOWACTIVATED (4) / HSHELL_RUDEAPPACTIVATED (0x8004) a window became the active one (clears the flash)
// Time format matches host.log (HH:mm:ss.fff) so both logs can be merged.
// Usage: flashwatch.exe <outFile>   (stop it with taskkill; every line is flushed at once)
// Build: csc /target:winexe /r:System.Windows.Forms.dll /out:tests\bin\flashwatch.exe tests\flashwatch.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

class FlashWatch : Form
{
    [DllImport("user32.dll")] static extern bool RegisterShellHookWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool DeregisterShellHookWindow(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessage(string s);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);

    readonly StreamWriter w;
    uint shellMsg;

    FlashWatch(string file)
    {
        w = new StreamWriter(file, true, new UTF8Encoding(false)) { AutoFlush = true };
        var h = Handle; // creates the (never shown) window
        shellMsg = RegisterWindowMessage("SHELLHOOK");
        bool ok = RegisterShellHookWindow(h);
        Write("START", IntPtr.Zero, "registered=" + ok + " pid=" + Process.GetCurrentProcess().Id);
    }

    void Write(string kind, IntPtr hwnd, string extra)
    {
        uint pid = 0; string name = "", title = "";
        if (hwnd != IntPtr.Zero)
        {
            GetWindowThreadProcessId(hwnd, out pid);
            try { name = Process.GetProcessById((int)pid).ProcessName; } catch { }
            var sb = new StringBuilder(256); GetWindowText(hwnd, sb, 256); title = sb.ToString().Replace('\t', ' ');
        }
        w.WriteLine(DateTime.Now.ToString("HH:mm:ss.fff") + "\t" + kind + "\t" + hwnd.ToInt64() + "\t" + pid + "\t" + name + "\t" + title + (extra != null ? "\t" + extra : ""));
    }

    protected override void WndProc(ref Message m)
    {
        if (shellMsg != 0 && m.Msg == (int)shellMsg)
        {
            int code = (int)(m.WParam.ToInt64() & 0xFFFF);
            if (code == 0x8006) Write("FLASH", m.LParam, null);
            else if (code == 4) Write("ACTIVATED", m.LParam, null);
            else if (code == 0x8004) Write("RUDEACTIVATED", m.LParam, null);
        }
        base.WndProc(ref m);
    }

    [STAThread]
    static void Main(string[] args)
    {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        var f = new FlashWatch(args.Length > 0 ? args[0] : "flashwatch.log");
        Application.Run(); // message loop without showing the window
        GC.KeepAlive(f);
    }
}
