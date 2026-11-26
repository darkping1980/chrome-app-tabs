// Chrome App Tabs - https://github.com/darkping1980/chrome-app-tabs
// Copyright (C) 2026 darkping1980
// SPDX-License-Identifier: GPL-3.0-only
// This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License version 3 (see LICENSE).
// AppTabsHost - Chrome Native Messaging host for the "App Tabs" PoC.
// Positions a real external program window (e.g. VS Code) over the content area of a
// Chrome window while the matching extension tab is active (overlay method, "B").
// It never re-parents, never hides (SW_HIDE) and never closes the external window, so a
// crash of this host leaves the external program usable in the taskbar.
//
// Build: build.ps1 (uses the C# 5 compiler bundled with .NET Framework 4.x).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace AppTabs
{
    static class N
    {
        public delegate bool EnumProc(IntPtr h, IntPtr l);
        public delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);

        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; public int W { get { return R - L; } } public int H { get { return B - T; } } }
        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)]
        public struct WINDOWPLACEMENT { public int length, flags, showCmd; public POINT minPos, maxPos; public RECT normal; }

        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
        [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
        [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
        [DllImport("user32.dll")] public static extern long GetWindowLongPtr(IntPtr h, int i);
        [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc f, uint pid, uint tid, uint flags);
        [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
        public delegate IntPtr LowLevelProc(int code, IntPtr w, IntPtr l);
        [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetWindowsHookEx(int id, LowLevelProc f, IntPtr mod, uint tid);
        [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
        [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
        [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
        [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

        public const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40, SWP_NOOWNERZORDER = 0x200, SWP_ASYNCWINDOWPOS = 0x4000;
        public static readonly IntPtr HWND_TOP = IntPtr.Zero;
        public const int SW_RESTORE = 9, SW_SHOWNOACTIVATE = 4, SW_SHOWMINNOACTIVE = 7;
        public const uint EVENT_SYSTEM_FOREGROUND = 0x3, EVENT_SYSTEM_MINIMIZESTART = 0x16, EVENT_SYSTEM_MINIMIZEEND = 0x17,
            EVENT_OBJECT_DESTROY = 0x8001, EVENT_OBJECT_SHOW = 0x8002, EVENT_OBJECT_LOCATIONCHANGE = 0x800B, WINEVENT_OUTOFCONTEXT = 0, WINEVENT_SKIPOWNPROCESS = 2;
        public const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
        public const long WS_EX_TOOLWINDOW = 0x80;
        public const uint GW_OWNER = 4;

        public static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
        public static string Class(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
        public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
        public static RECT Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }
        public static bool Cloaked(IntPtr h) { int v; return DwmGetWindowAttribute(h, 14, out v, 4) == 0 && v != 0; }
        public static WINDOWPLACEMENT Placement(IntPtr h) { var p = new WINDOWPLACEMENT(); p.length = Marshal.SizeOf(p); GetWindowPlacement(h, ref p); return p; }
    }

    class Attachment
    {
        public string Id, Token;
        public IntPtr App;          // external program top-level window
        public uint AppPid;
        public IntPtr Chrome;       // Chrome top-level window currently hosting the tab
        public bool Active;
        public bool Peeking;        // temporarily behind Chrome because the omnibox has focus
        public DateTime ActivatedAt;
        public N.WINDOWPLACEMENT Original;
        public N.RECT OriginalRect; // snapped windows only: their actual screen rect (Original.normal is the pre-snap size)
        public bool HasOriginalRect;
        public N.RECT LastTarget;
    }

    static partial class Host
    {
        static readonly object OutLock = new object();
        static Stream stdout;
        static Control ui;
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
        static readonly Dictionary<string, Attachment> Att = new Dictionary<string, Attachment>();
        static readonly Dictionary<uint, IntPtr> LocHooks = new Dictionary<uint, IntPtr>();
        static readonly Dictionary<uint, IntPtr> ShowHooks = new Dictionary<uint, IntPtr>();
        static readonly Dictionary<string, string> IconCache = new Dictionary<string, string>();
        static N.WinEventProc hookProc; // keep delegate alive
        static System.Windows.Forms.Timer liveTimer, enforceTimer;
        static string dataDir, stateFile, logFile;
        public static string Mode = "zorder"; // how to "hide": zorder (put behind Chrome) | minimize
        public static bool PeekOnOmnibox = true; // drop the app behind Chrome while the omnibox has focus
        static int repositions, peeks;
        const string Version = "0.3.3";

        [STAThread]
        static int Main(string[] args)
        {
            N.SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: all coordinates are physical pixels
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var exePath = Process.GetCurrentProcess().MainModule.FileName;
            bool installed = exePath.StartsWith(Path.Combine(local, "ChromeAppTabs", "app") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
            dataDir = Path.Combine(local, installed ? "ChromeAppTabs" : "ChromeAppTabs-dev");
            Directory.CreateDirectory(dataDir);
            stateFile = Path.Combine(dataDir, "attached.json");
            logFile = Path.Combine(dataDir, "host.log");

            if (args.Length > 0 && args[0] == "--version") { Console.WriteLine(Version); return 0; }
            if (args.Length > 0 && args[0] == "--restore-all") { int n = RestoreFromStateFile(); Console.WriteLine("restored " + n); return 0; }
            if (args.Length > 1 && args[0] == "--watchdog") { Watchdog(int.Parse(args[1])); return 0; }

            Log("start pid=" + Process.GetCurrentProcess().Id + " args=" + string.Join(" ", args));
            int leftover = RestoreFromStateFile(); // previous host died without cleanup
            if (leftover > 0) Log("restored " + leftover + " window(s) left over by a previous host");
            StartWatchdog();

            stdout = Console.OpenStandardOutput();
            ui = new Control(); ui.CreateControl(); var h = ui.Handle;
            hookProc = OnWinEvent;
            GlobalHooks.Add(N.SetWinEventHook(N.EVENT_SYSTEM_FOREGROUND, N.EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, hookProc, 0, 0, N.WINEVENT_OUTOFCONTEXT | N.WINEVENT_SKIPOWNPROCESS));
            GlobalHooks.Add(N.SetWinEventHook(N.EVENT_SYSTEM_MINIMIZESTART, N.EVENT_SYSTEM_MINIMIZEEND, IntPtr.Zero, hookProc, 0, 0, N.WINEVENT_OUTOFCONTEXT | N.WINEVENT_SKIPOWNPROCESS));

            liveTimer = new System.Windows.Forms.Timer { Interval = 1000 };
            liveTimer.Tick += delegate { CheckAlive(); };
            liveTimer.Start();
            enforceTimer = new System.Windows.Forms.Timer { Interval = 120 };
            enforceTimer.Tick += delegate { enforceTimer.Stop(); foreach (var a in Att.Values.ToList()) if (a.Active) Place(a, false); };

            var reader = new Thread(ReadLoop) { IsBackground = true };
            reader.Start();
            StartFocusWatcher();
            StartDragWatcher();
            Application.Run();
            return 0;
        }

        // ---------------- native messaging I/O ----------------
        static void ReadLoop()
        {
            var stdin = Console.OpenStandardInput();
            var lenBuf = new byte[4];
            try
            {
                while (true)
                {
                    if (!ReadExact(stdin, lenBuf, 4)) break;
                    int len = BitConverter.ToInt32(lenBuf, 0);
                    var buf = new byte[len];
                    if (!ReadExact(stdin, buf, len)) break;
                    var msg = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(buf));
                    ui.BeginInvoke((Action)(() => Dispatch(msg)));
                }
            }
            catch (Exception e) { Log("read error " + e.Message); }
            Log("stdin closed -> restoring all and exiting");
            ui.Invoke((Action)(() => { foreach (var a in Att.Values.ToList()) Restore(a); Att.Clear(); SaveState(); UnhookAll(); Application.Exit(); }));
        }

        // Stop every callback source before the process ends: a WinEvent or UI Automation callback arriving while the
        // runtime shuts down ended the process with an unhandled exception (0xC0020001) after a clean restore.
        static readonly List<IntPtr> GlobalHooks = new List<IntPtr>();
        static void UnhookAll()
        {
            foreach (var h in GlobalHooks.Concat(LocHooks.Values).Concat(ShowHooks.Values)) if (h != IntPtr.Zero) N.UnhookWinEvent(h);
            GlobalHooks.Clear(); LocHooks.Clear(); ShowHooks.Clear();
            if (dragTimer != null) dragTimer.Stop();
            if (liveTimer != null) liveTimer.Stop();
            // UIA removes its handlers on its own threads; never wait for it for long
            var t = new Thread(() => { try { System.Windows.Automation.Automation.RemoveAllEventHandlers(); } catch { } }) { IsBackground = true };
            t.SetApartmentState(ApartmentState.MTA); t.Start(); t.Join(1500);
        }

        static bool ReadExact(Stream s, byte[] b, int n)
        {
            int off = 0;
            while (off < n) { int r = s.Read(b, off, n - off); if (r <= 0) return false; off += r; }
            return true;
        }

        static void Send(Dictionary<string, object> m)
        {
            var bytes = Encoding.UTF8.GetBytes(Json.Serialize(m));
            lock (OutLock)
            {
                stdout.Write(BitConverter.GetBytes(bytes.Length), 0, 4);
                stdout.Write(bytes, 0, bytes.Length);
                stdout.Flush();
            }
        }

        static void Dispatch(Dictionary<string, object> msg)
        {
            object rid; msg.TryGetValue("id", out rid);
            var reply = new Dictionary<string, object> { { "reply", rid }, { "ok", true } };
            try
            {
                string cmd = (string)msg["cmd"];
                switch (cmd)
                {
                    case "ping": reply["version"] = Version; reply["pid"] = Process.GetCurrentProcess().Id; break;
                    case "resume": Resume(Get(msg, "app")); break;
                    case "setOptions":
                        if (Get(msg, "mode") != null) Mode = Get(msg, "mode") == "minimize" ? "minimize" : "zorder";
                        if (Get(msg, "peek") != null) PeekOnOmnibox = Get(msg, "peek") == "True" || Get(msg, "peek") == "true";
                        if (Get(msg, "dragAdd") != null) DragAddEnabled = Get(msg, "dragAdd") == "True" || Get(msg, "dragAdd") == "true";
                        reply["mode"] = Mode; reply["peek"] = PeekOnOmnibox; reply["dragAdd"] = DragAddEnabled; break;
                    case "state":
                        reply["apps"] = Att.Values.Select(a => new Dictionary<string, object> {
                            { "app", a.Id }, { "hwnd", a.App.ToInt64() }, { "active", a.Active }, { "peeking", a.Peeking }, { "chrome", a.Chrome.ToInt64() } }).ToList();
                        break;
                    case "list": reply["windows"] = ListWindows(Get(msg, "exeFilter")); break;
                    case "attach": reply["state"] = AttachCmd(Get(msg, "app"), Get(msg, "token"), new IntPtr(Convert.ToInt64(msg["hwnd"]))); break;
                    case "activate": Activate(Get(msg, "app")); break;
                    case "deactivate": Deactivate(Get(msg, "app")); break;
                    case "detach": Detach(Get(msg, "app")); break;
                    case "setMode": Mode = Get(msg, "mode") == "minimize" ? "minimize" : "zorder"; break;
                    case "stats":
                        var p = Process.GetCurrentProcess(); p.Refresh();
                        reply["workingSetMB"] = p.WorkingSet64 / 1048576.0; reply["cpuMs"] = p.TotalProcessorTime.TotalMilliseconds;
                        reply["repositions"] = repositions; reply["peeks"] = peeks; reply["drops"] = dropsReported; reply["highlight"] = highlight != null && N.IsWindowVisible(highlight.Handle); reply["dragging"] = drag != null; reply["attached"] = Att.Count; reply["dataDir"] = dataDir; break;
                    default: throw new Exception("unknown cmd " + cmd);
                }
            }
            catch (Exception e) { reply["ok"] = false; reply["error"] = e.Message; Log("error " + e); }
            Send(reply);
        }

        static string Get(Dictionary<string, object> m, string k) { object v; return m.TryGetValue(k, out v) && v != null ? v.ToString() : null; }

        // ---------------- window enumeration ----------------
        static List<Dictionary<string, object>> ListWindows(string exeFilter)
        {
            var list = new List<Dictionary<string, object>>();
            N.EnumWindows((h, l) =>
            {
                if (!N.IsWindowVisible(h) || N.Cloaked(h)) return true;
                if (N.GetWindow(h, N.GW_OWNER) != IntPtr.Zero) return true;
                if ((N.GetWindowLongPtr(h, N.GWL_EXSTYLE) & N.WS_EX_TOOLWINDOW) != 0) return true;
                string title = N.Text(h); if (title.Length == 0) return true;
                var info = WindowInfo(h);
                string name = (string)info["process"];
                if (exeFilter != null && (name == null || !name.Equals(exeFilter, StringComparison.OrdinalIgnoreCase))) return true;
                if (name != null && name.Equals("chrome", StringComparison.OrdinalIgnoreCase)) return true; // the browser itself is the base, not a candidate
                list.Add(info);
                return true;
            }, IntPtr.Zero);
            return list;
        }

        static Dictionary<string, object> WindowInfo(IntPtr h)
        {
            uint pid = N.Pid(h);
            string exe = null, name = null;
            try { var pr = Process.GetProcessById((int)pid); name = pr.ProcessName; exe = pr.MainModule.FileName; } catch { }
            return new Dictionary<string, object> {
                { "hwnd", h.ToInt64() }, { "title", N.Text(h) }, { "pid", pid }, { "process", name }, { "exe", exe },
                { "description", DescriptionFor(exe) }, { "className", N.Class(h) }, { "icon", IconFor(exe) } };
        }

        // generic display name for any program: the executable's FileDescription (e.g. "Visual Studio Code")
        static readonly Dictionary<string, string> DescCache = new Dictionary<string, string>();
        static string DescriptionFor(string exe)
        {
            if (exe == null) return null;
            string v;
            if (DescCache.TryGetValue(exe, out v)) return v;
            try { v = FileVersionInfo.GetVersionInfo(exe).FileDescription; if (string.IsNullOrWhiteSpace(v)) v = null; } catch { v = null; }
            DescCache[exe] = v;
            return v;
        }

        static string IconFor(string exe)
        {
            if (exe == null) return null;
            string v;
            if (IconCache.TryGetValue(exe, out v)) return v;
            try
            {
                using (var ico = Icon.ExtractAssociatedIcon(exe))
                using (var bmp = ico.ToBitmap())
                using (var ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    v = "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                }
            }
            catch { v = null; }
            IconCache[exe] = v;
            return v;
        }

        // ---------------- attach / activate ----------------
        static string AttachCmd(string id, string token, IntPtr hwnd)
        {
            if (!N.IsWindow(hwnd)) throw new Exception("window not found");
            Attachment a;
            if (Att.TryGetValue(id, out a))
            {
                if (a.App == hwnd) return "already";
                Restore(a); Att.Remove(id);
            }
            foreach (var other in Att.Values.ToList())
                if (other.App == hwnd) { Restore(other); Att.Remove(other.Id); } // one tab per external window
            var orig = OriginalFor(hwnd);
            a = new Attachment { Id = id, Token = token, App = hwnd, AppPid = N.Pid(hwnd), Original = orig.Placement, OriginalRect = orig.Rect, HasOriginalRect = orig.Arranged };
            Att[id] = a;
            HookLocation(a.AppPid);
            SaveState();
            Log("attach " + id + " hwnd=" + hwnd + " '" + N.Text(hwnd) + "' original=" + DropLogic.Str(orig.Rect) + " showCmd=" + orig.Placement.showCmd + (orig.Arranged ? " snapped" : ""));
            return "attached";
        }

        static Attachment Find(string id)
        {
            Attachment a;
            if (!Att.TryGetValue(id, out a)) throw new Exception("not attached: " + id);
            return a;
        }

        static void Activate(string id)
        {
            var a = Find(id);
            // Deactivate any other attachment in the same Chrome window is the extension's job, but be defensive.
            a.Active = true; a.Peeking = false; a.ActivatedAt = DateTime.UtcNow; UpdateKeyHook();
            TryActivate(a, 0);
        }

        // Chrome updates its window title asynchronously after a tab switch, so retry briefly.
        static void TryActivate(Attachment a, int attempt)
        {
            if (!a.Active) return;
            IntPtr chrome = FindChromeByToken(a.Token);
            if (chrome == IntPtr.Zero)
            {
                if (attempt < 40) { var t = new System.Windows.Forms.Timer { Interval = 50 }; t.Tick += delegate { t.Stop(); t.Dispose(); TryActivate(a, attempt + 1); }; t.Start(); }
                else Log("activate " + a.Id + ": chrome window with token not found");
                return;
            }
            a.Chrome = chrome;
            HookLocation(N.Pid(chrome));
            HookShow(N.Pid(chrome));
            foreach (var o in Att.Values) if (o != a && o.Active && o.Chrome == chrome) { o.Active = false; SendBehind(o); }
            if (N.IsIconic(chrome)) return; // will be shown on MINIMIZEEND
            if (N.IsIconic(a.App) || N.IsZoomed(a.App)) N.ShowWindow(a.App, N.SW_RESTORE);
            Place(a, true);
            ForceForeground(a.App);
            Log("activate " + a.Id + " chrome=" + chrome + " after " + attempt + " retries");
        }

        static IntPtr FindChromeByToken(string token)
        {
            IntPtr found = IntPtr.Zero;
            N.EnumWindows((h, l) =>
            {
                if (N.Class(h) == "Chrome_WidgetWin_1" && N.IsWindowVisible(h) && N.Text(h).Contains(token)) { found = h; return false; }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        // Content area of a Chrome window = its Chrome_RenderWidgetHostHWND child (the active tab's).
        // Chrome may keep that child hidden while our overlay covers it (e.g. after restoring from minimized),
        // so a hidden one is accepted too, and as a last resort the insets measured last time are reused.
        static readonly Dictionary<string, int[]> Insets = new Dictionary<string, int[]>();
        static N.RECT ContentRect(IntPtr chrome)
        {
            N.RECT vis = new N.RECT(), any = new N.RECT(); bool hasVis = false, hasAny = false;
            N.EnumChildWindows(chrome, (h, l) =>
            {
                if (N.Class(h) == "Chrome_RenderWidgetHostHWND")
                {
                    var r = N.Rect(h);
                    if (r.W <= 0 || r.H <= 0) return true;
                    if (N.IsWindowVisible(h)) { if (!hasVis || r.W * r.H > vis.W * vis.H) { vis = r; hasVis = true; } }
                    else if (!hasAny || r.W * r.H > any.W * any.H) { any = r; hasAny = true; }
                }
                return true;
            }, IntPtr.Zero);
            var w = N.Rect(chrome);
            string key = chrome.ToInt64() + (N.IsZoomed(chrome) ? ":max" : ":normal");
            var best = hasVis ? vis : any;
            bool inside = (hasVis || hasAny) && best.L >= w.L && best.T >= w.T && best.R <= w.R && best.B <= w.B;
            if (inside) { Insets[key] = new[] { best.L - w.L, best.T - w.T, w.R - best.R, w.B - best.B }; return best; }
            int[] ins;
            if (!Insets.TryGetValue(key, out ins)) ins = new[] { 8, 120, 8, 8 }; // rough guess, only before any measurement
            var g = new N.RECT { L = w.L + ins[0], T = w.T + ins[1], R = w.R - ins[2], B = w.B - ins[3] };
            return g;
        }

        static void Place(Attachment a, bool raise)
        {
            if (a.Chrome == IntPtr.Zero || !N.IsWindow(a.Chrome) || !N.IsWindow(a.App) || N.IsIconic(a.Chrome)) return;
            var r = ContentRect(a.Chrome);
            var cur = N.Rect(a.App);
            bool moved = cur.L != r.L || cur.T != r.T || cur.R != r.R || cur.B != r.B;
            if (!moved && !raise) return;
            uint f = N.SWP_NOACTIVATE | N.SWP_SHOWWINDOW | N.SWP_NOOWNERZORDER;
            if (!raise) f |= N.SWP_NOZORDER;
            N.SetWindowPos(a.App, N.HWND_TOP, r.L, r.T, r.W, r.H, f);
            a.LastTarget = r;
            repositions++;
        }

        static void ForceForeground(IntPtr h)
        {
            if (N.SetForegroundWindow(h) && N.GetForegroundWindow() == h) return;
            // Foreground lock: borrow the foreground thread's input state, the documented-but-discouraged workaround.
            IntPtr fg = N.GetForegroundWindow();
            uint dummy; uint fgThread = N.GetWindowThreadProcessId(fg, out dummy), me = N.GetCurrentThreadId();
            N.AttachThreadInput(me, fgThread, true);
            N.BringWindowToTop(h); N.SetForegroundWindow(h);
            N.AttachThreadInput(me, fgThread, false);
            if (N.GetForegroundWindow() != h)
            {   // last resort: a synthetic ALT tap makes this process "last input" owner
                N.keybd_event(0x12, 0, 0, UIntPtr.Zero); N.keybd_event(0x12, 0, 2, UIntPtr.Zero);
                N.SetForegroundWindow(h);
            }
        }

        static void SendBehind(Attachment a)
        {
            if (!N.IsWindow(a.App)) return;
            if (Mode == "minimize") { N.ShowWindow(a.App, N.SW_SHOWMINNOACTIVE); return; }
            if (a.Chrome != IntPtr.Zero && N.IsWindow(a.Chrome))
            {
                N.SetWindowPos(a.App, a.Chrome, 0, 0, 0, 0, N.SWP_NOMOVE | N.SWP_NOSIZE | N.SWP_NOACTIVATE | N.SWP_NOOWNERZORDER);
                if (N.GetForegroundWindow() == a.App) ForceForeground(a.Chrome);
            }
        }

        static void Deactivate(string id)
        {
            Attachment a;
            if (!Att.TryGetValue(id, out a)) return;
            a.Active = false; a.Peeking = false; UpdateKeyHook();
            SendBehind(a);
            Log("deactivate " + id);
        }

        static void Detach(string id)
        {
            Attachment a;
            if (!Att.TryGetValue(id, out a)) return;
            Restore(a); Att.Remove(id); SaveState();
            Log("detach " + id);
        }

        static void Restore(Attachment a)
        {
            a.Active = false; a.Peeking = false;
            if (!N.IsWindow(a.App) || N.Pid(a.App) != a.AppPid) return;
            var p = a.Original;
            if (p.showCmd == 2 /*SW_SHOWMINIMIZED*/) p.showCmd = 1; // never leave it minimized after a detach
            N.SetWindowPlacement(a.App, ref p);
            if (a.HasOriginalRect) RestoreRect(a.App, p.showCmd, a.OriginalRect);
        }

        // A window snapped by Windows (half screen, Snap layouts) has a placement whose "normal" rect is its size from
        // BEFORE snapping. Putting back its actual rect afterwards returns it exactly where it was. Only for windows that
        // were in the normal state, and only if that rect is still on a monitor (monitors may have changed meanwhile).
        static void RestoreRect(IntPtr h, int showCmd, N.RECT r)
        {
            if (showCmd != 1 /*SW_SHOWNORMAL*/ || !N2.OnSomeMonitor(r) || DropLogic.SameRect(N.Rect(h), r)) return;
            N.SetWindowPos(h, IntPtr.Zero, r.L, r.T, r.W, r.H, N.SWP_NOZORDER | N.SWP_NOACTIVATE | N.SWP_NOOWNERZORDER);
        }

        // ---------------- WinEvent hooks: keep the overlay in sync ----------------
        static void HookLocation(uint pid)
        {
            if (LocHooks.ContainsKey(pid)) return;
            LocHooks[pid] = N.SetWinEventHook(N.EVENT_OBJECT_LOCATIONCHANGE, N.EVENT_OBJECT_LOCATIONCHANGE, IntPtr.Zero, hookProc, pid, 0, N.WINEVENT_OUTOFCONTEXT);
        }

        // Chrome's own popups (omnibox suggestions, menus, find bar...) are separate top-level windows owned by the
        // browser window. Chrome puts them just above its frame, i.e. below our overlay, so lift them on show.
        static void HookShow(uint pid)
        {
            if (ShowHooks.ContainsKey(pid)) return;
            ShowHooks[pid] = N.SetWinEventHook(N.EVENT_OBJECT_SHOW, N.EVENT_OBJECT_SHOW, IntPtr.Zero, hookProc, pid, 0, N.WINEVENT_OUTOFCONTEXT);
        }

        static void OnWinEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
        {
            if (idObject != 0 || idChild != 0 || Att.Count == 0) return;
            try
            {
                if (ev == N.EVENT_OBJECT_SHOW)
                {
                    if (N.GetAncestor(hwnd, 2 /*GA_ROOT*/) != hwnd) return; // top-level windows only
                    var owner = N.GetAncestor(hwnd, 3 /*GA_ROOTOWNER*/);
                    foreach (var a in Att.Values)
                        if (a.Active && owner == a.Chrome && hwnd != a.Chrome)
                            N.SetWindowPos(hwnd, N.HWND_TOP, 0, 0, 0, 0, N.SWP_NOMOVE | N.SWP_NOSIZE | N.SWP_NOACTIVATE | N.SWP_NOOWNERZORDER);
                    return;
                }
                foreach (var a in Att.Values.ToList())
                {
                    if (!a.Active) continue;
                    if (hwnd == a.Chrome)
                    {
                        // maximize/restore makes Chrome lift itself above the app without a foreground change
                        if (ev == N.EVENT_OBJECT_LOCATIONCHANGE) { Place(a, false); KeepAbove(a, 0); }
                        else if (ev == N.EVENT_SYSTEM_FOREGROUND)
                            // Chrome came to the front (tab strip / omnibox click): keep the app on top of it, without stealing focus.
                            KeepAbove(a, 3);
                        else if (ev == N.EVENT_SYSTEM_MINIMIZESTART) N.ShowWindow(a.App, N.SW_SHOWMINNOACTIVE);
                        else if (ev == N.EVENT_SYSTEM_MINIMIZEEND) { N.ShowWindow(a.App, N.SW_SHOWNOACTIVATE); Place(a, false); if (a.Peeking) BehindChrome(a); else KeepAbove(a, 3); }
                    }
                    else if (hwnd == a.App && ev == N.EVENT_OBJECT_LOCATIONCHANGE)
                    {
                        // The app moved itself (user drag, WM_DPICHANGED suggested rect, Aero snap...). Re-enforce after it settles.
                        var r = N.Rect(a.App);
                        if (r.L != a.LastTarget.L || r.T != a.LastTarget.T || r.R != a.LastTarget.R || r.B != a.LastTarget.B) { enforceTimer.Stop(); enforceTimer.Start(); }
                    }
                }
            }
            catch (Exception e) { Log("hook error " + e.Message); }
        }

        // Windows refuses to lift a background process' window above the foreground window, so instead of raising
        // the app we lower Chrome to sit directly below it (its own popups keep their place: NOOWNERZORDER).
        // Chrome may re-raise itself while it finishes activating, so re-check a few times.
        static void KeepAbove(Attachment a, int retries)
        {
            if (!a.Active || a.Peeking || !N.IsWindow(a.App) || !N.IsWindow(a.Chrome)) return;
            if (!IsAbove(a.App, a.Chrome))
            {
                const uint f = N.SWP_NOMOVE | N.SWP_NOSIZE | N.SWP_NOACTIVATE | N.SWP_NOOWNERZORDER;
                // 1) bring the app directly below Chrome, 2) swap: Chrome goes directly below the app.
                // Net effect: the app takes Chrome's z-position and Chrome sinks by exactly one slot
                // (lowering Chrome alone would bury it under unrelated windows when the app sits deep in the z-order).
                N.SetWindowPos(a.App, a.Chrome, 0, 0, 0, 0, f);
                N.SetWindowPos(a.Chrome, a.App, 0, 0, 0, 0, f);
            }
            if (retries > 0)
            {
                var t = new System.Windows.Forms.Timer { Interval = 60 };
                t.Tick += delegate { t.Stop(); t.Dispose(); KeepAbove(a, retries - 1); };
                t.Start();
            }
        }

        static void BehindChrome(Attachment a)
        {
            N.SetWindowPos(a.App, a.Chrome, 0, 0, 0, 0, N.SWP_NOMOVE | N.SWP_NOSIZE | N.SWP_NOACTIVATE | N.SWP_NOOWNERZORDER);
        }

        // ---------------- omnibox "peek" ----------------
        // Chrome draws the omnibox suggestion list inside its own frame, so it would stay hidden behind the overlay.
        // A UI Automation focus listener tells us when the omnibox (class OmniboxViewViews) gets keyboard focus;
        // the app is then dropped right behind Chrome until the app tab page gets focus again (Esc / click),
        // which the extension reports with "resume". UIA reports no focus event for web content, hence that path.
        static void StartFocusWatcher()
        {
            var t = new Thread(() =>
            {
                try
                {
                    System.Windows.Automation.Automation.AddAutomationFocusChangedEventHandler((s, e) =>
                    {
                        if (!PeekOnOmnibox || Att.Count == 0) return;
                        try
                        {
                            var el = s as System.Windows.Automation.AutomationElement; if (el == null) return;
                            var c = el.Current;
                            if (c.ClassName != "OmniboxViewViews") return;
                            int pid = c.ProcessId;
                            ui.BeginInvoke((Action)(() => OnOmniboxFocus(pid)));
                        }
                        catch { }
                    });
                    Log("focus watcher started");
                }
                catch (Exception e) { Log("focus watcher failed: " + e.Message); }
            });
            t.IsBackground = true;
            t.SetApartmentState(ApartmentState.MTA);
            t.Start();
        }

        static void OnOmniboxFocus(int pid)
        {
            var fg = N.GetForegroundWindow();
            foreach (var a in Att.Values)
            {
                if (!a.Active || a.Peeking || a.Chrome == IntPtr.Zero || N.Pid(a.Chrome) != pid) continue;
                if (fg != a.Chrome) continue; // only the Chrome window the user is typing in
                // Chrome may hand focus back to the omnibox right after a tab switch; that is not the user typing
                if ((DateTime.UtcNow - a.ActivatedAt).TotalMilliseconds < 600) continue;
                a.Peeking = true; peeks++;
                BehindChrome(a);
                UpdateKeyHook();
                Log("peek " + a.Id);
                Send(new Dictionary<string, object> { { "evt", "peek" }, { "app", a.Id } });
            }
        }

        // Esc in the omnibox does not move focus back to the page, so the page cannot report it.
        // While (and only while) an app is peeking, a low-level keyboard hook watches for Esc in that Chrome window.
        static IntPtr kbHook = IntPtr.Zero;
        static N.LowLevelProc kbProc;
        static void UpdateKeyHook()
        {
            bool need = Att.Values.Any(a => a.Peeking);
            if (need && kbHook == IntPtr.Zero)
            {
                kbProc = (code, w, l) =>
                {
                    if (code >= 0 && w.ToInt32() == 0x0100 /*WM_KEYDOWN*/ && Marshal.ReadInt32(l) == 0x1B /*VK_ESCAPE*/)
                    {
                        var fg = N.GetForegroundWindow();
                        foreach (var a in Att.Values)
                            if (a.Peeking && a.Chrome == fg) { var id = a.Id; ui.BeginInvoke((Action)(() => Resume(id))); }
                    }
                    return N.CallNextHookEx(IntPtr.Zero, code, w, l); // never swallow the key: Chrome still reverts the omnibox
                };
                kbHook = N.SetWindowsHookEx(13 /*WH_KEYBOARD_LL*/, kbProc, N.GetModuleHandle(null), 0);
            }
            else if (!need && kbHook != IntPtr.Zero) { N.UnhookWindowsHookEx(kbHook); kbHook = IntPtr.Zero; }
        }

        static void Resume(string id)
        {
            Attachment a;
            if (!Att.TryGetValue(id, out a) || !a.Active || !a.Peeking) return;
            a.Peeking = false;
            UpdateKeyHook();
            Place(a, true);
            KeepAbove(a, 2);
            ForceForeground(a.App);
            Log("resume " + id);
        }

        static bool IsAbove(IntPtr x, IntPtr y)
        {
            for (var h = N.GetWindow(y, 3 /*GW_HWNDPREV*/); h != IntPtr.Zero; h = N.GetWindow(h, 3)) if (h == x) return true;
            return false;
        }

        static void CheckAlive()
        {
            foreach (var a in Att.Values.ToList())
            {
                if (!N.IsWindow(a.App) || N.Pid(a.App) != a.AppPid)
                {
                    Log("lost " + a.Id);
                    Att.Remove(a.Id); SaveState();
                    Send(new Dictionary<string, object> { { "evt", "lost" }, { "app", a.Id } });
                }
                else if (a.Active && a.Chrome != IntPtr.Zero && !N.IsWindow(a.Chrome))
                {   // the Chrome window was closed under us
                    Restore(a); a.Chrome = IntPtr.Zero;
                }
            }
        }

        // ---------------- crash safety ----------------
        static void SaveState()
        {
            var list = Att.Values.Select(a => {
                var e = new Dictionary<string, object> {
                    { "hwnd", a.App.ToInt64() }, { "pid", a.AppPid }, { "showCmd", a.Original.showCmd },
                    { "l", a.Original.normal.L }, { "t", a.Original.normal.T }, { "r", a.Original.normal.R }, { "b", a.Original.normal.B } };
                if (a.HasOriginalRect) { e["sl"] = a.OriginalRect.L; e["st"] = a.OriginalRect.T; e["sr"] = a.OriginalRect.R; e["sb"] = a.OriginalRect.B; }
                return e; }).ToList();
            File.WriteAllText(stateFile, Json.Serialize(list));
        }

        static int RestoreFromStateFile()
        {
            if (!File.Exists(stateFile)) return 0;
            int n = 0;
            try
            {
                var list = Json.Deserialize<List<Dictionary<string, object>>>(File.ReadAllText(stateFile));
                foreach (var e in list)
                {
                    var h = new IntPtr(Convert.ToInt64(e["hwnd"]));
                    if (!N.IsWindow(h) || N.Pid(h) != Convert.ToUInt32(e["pid"])) continue;
                    var p = N.Placement(h);
                    p.showCmd = Convert.ToInt32(e["showCmd"]); if (p.showCmd == 2) p.showCmd = 1;
                    p.normal.L = Convert.ToInt32(e["l"]); p.normal.T = Convert.ToInt32(e["t"]); p.normal.R = Convert.ToInt32(e["r"]); p.normal.B = Convert.ToInt32(e["b"]);
                    N.SetWindowPlacement(h, ref p); n++;
                    if (e.ContainsKey("sl")) // written by v0.3.3+: the actual rect (e.g. while snapped)
                        RestoreRect(h, p.showCmd, new N.RECT { L = Convert.ToInt32(e["sl"]), T = Convert.ToInt32(e["st"]), R = Convert.ToInt32(e["sr"]), B = Convert.ToInt32(e["sb"]) });
                }
            }
            catch (Exception ex) { Log("restore error " + ex.Message); }
            File.WriteAllText(stateFile, "[]");
            return n;
        }

        // A tiny separate process that restores windows if this host is killed (e.g. Chrome crash).
        static void StartWatchdog()
        {
            try
            {
                var psi = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "--watchdog " + Process.GetCurrentProcess().Id)
                // ShellExecute => no handle inheritance, so the watchdog never keeps Chrome's stdio pipes open.
                { UseShellExecute = true, WindowStyle = ProcessWindowStyle.Hidden };
                Process.Start(psi);
            }
            catch (Exception e) { Log("watchdog start failed " + e.Message); }
        }

        static void Watchdog(int hostPid)
        {
            try { Process.GetProcessById(hostPid).WaitForExit(); } catch { }
            int n = RestoreFromStateFile();
            if (n > 0) Log("watchdog: host " + hostPid + " ended abnormally, restored " + n + " window(s)");
        }

        static void Log(string s)
        {
            try { File.AppendAllText(logFile, DateTime.Now.ToString("HH:mm:ss.fff") + " [" + Process.GetCurrentProcess().Id + "] " + s + Environment.NewLine); } catch { }
        }
    }
}
