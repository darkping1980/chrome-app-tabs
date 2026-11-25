// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// uiafocus.exe <seconds> : prints every UI Automation focus change (pid, control type, class, name).
// Used to learn how Chrome's omnibox focus looks to an out-of-process UIA client.
using System;
using System.Threading;
using System.Windows.Automation;

static class U
{
    static int Main(string[] a)
    {
        int secs = a.Length > 0 ? int.Parse(a[0]) : 10;
        Automation.AddAutomationFocusChangedEventHandler((s, e) =>
        {
            try
            {
                var el = s as AutomationElement; if (el == null) return;
                var c = el.Current;
                Console.WriteLine(DateTime.Now.ToString("HH:mm:ss.fff") + "\t" + c.ProcessId + "\t" + c.ControlType.ProgrammaticName + "\t" + c.ClassName + "\t" + c.AutomationId + "\t" + c.Name);
                Console.Out.Flush();
            }
            catch (Exception ex) { Console.WriteLine("err " + ex.Message); }
        });
        Console.WriteLine("ready"); Console.Out.Flush();
        Thread.Sleep(secs * 1000);
        Automation.RemoveAllEventHandlers();
        return 0;
    }
}
