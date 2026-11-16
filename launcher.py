"""山海AI课堂平台桌面启动器。"""
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNTIME_DIR = ROOT / "runtime"

# 确保嵌入式 Python 能定位到自带的 Tcl/Tk 库。
if (RUNTIME_DIR / "tcl" / "tcl8.6").is_dir():
    os.environ.setdefault("TCL_LIBRARY", str(RUNTIME_DIR / "tcl" / "tcl8.6"))
if (RUNTIME_DIR / "tcl" / "tk8.6").is_dir():
    os.environ.setdefault("TK_LIBRARY", str(RUNTIME_DIR / "tcl" / "tk8.6"))

import tkinter as tk
from tkinter import messagebox, simpledialog, ttk
from werkzeug.security import generate_password_hash

CONFIG_FILE = ROOT / "launcher_config.json"
DEFAULT_CONFIG = {
    "port": 5000,
    "threads": 8,
    "progress_locks": True,
    "auto_open_browser": True,
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_FILE.is_file():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                cfg.update(data)
        except Exception:
            pass
    return cfg


def save_config(cfg):
    CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def _ip_priority(ip):
    """按常见真实局域网优先级排序，过滤/降权虚拟网卡地址。"""
    parts = ip.split(".")
    if len(parts) != 4:
        return (9, ip)
    a, b = int(parts[0]), int(parts[1])
    if ip.startswith("127.") or ip.startswith("169.254."):
        return (8, ip)
    # 198.18.0.0/15 常被代理软件 TUN 虚拟网卡占用，排在真实内网之后。
    if a == 198 and b in (18, 19):
        return (7, ip)
    if a == 192 and b == 168:
        return (0, ip)
    if a == 10:
        return (1, ip)
    if a == 172 and 16 <= b <= 31:
        return (2, ip)
    return (3, ip)


def get_lan_ips():
    candidates = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in candidates:
                candidates.append(ip)
    except Exception:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127.") and ip not in candidates:
                candidates.append(ip)
    except Exception:
        pass
    if not candidates:
        return ["127.0.0.1"]
    candidates.sort(key=_ip_priority)
    return candidates


def get_lan_ip():
    return get_lan_ips()[0]


def data_dir_path():
    return Path(os.environ.get("SHANHAI_DATA_DIR", str(ROOT / "data")))


def backup_data(data_dir=None):
    """将当前数据库与作品附件完整备份到 data/backups/backup_时间戳/。"""
    target_data = Path(data_dir) if data_dir else data_dir_path()
    target_data.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_root = target_data / "backups" / f"backup_{stamp}"
    backup_root.mkdir(parents=True, exist_ok=True)

    db_file = target_data / "classroom.sqlite3"
    copied = []
    if db_file.is_file():
        dst_db = backup_root / "classroom.sqlite3"
        src = sqlite3.connect(str(db_file))
        dst = sqlite3.connect(str(dst_db))
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        copied.append("classroom.sqlite3")

    creation_dir = target_data / "creation"
    if creation_dir.is_dir():
        shutil.copytree(creation_dir, backup_root / "creation", dirs_exist_ok=True)
        copied.append("creation/")

    session_key = target_data / "session.key"
    if session_key.is_file():
        shutil.copy2(session_key, backup_root / "session.key")
        copied.append("session.key")

    return backup_root, copied


def reset_and_init_database(data_dir=None):
    """先备份，再清空旧库与附件并重新初始化空数据库。"""
    target_data = Path(data_dir) if data_dir else data_dir_path()
    backup_root, copied = backup_data(target_data)

    for suffix in ("", "-wal", "-shm"):
        p = target_data / f"classroom.sqlite3{suffix}"
        if p.is_file():
            p.unlink()

    creation_dir = target_data / "creation"
    if creation_dir.is_dir():
        shutil.rmtree(creation_dir)

    # 通过 create_app() 触发 database.init_db() 生成全新空库。
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from shanhai import create_app

    create_app({"DATA_DIR": str(target_data)})
    return backup_root, copied


def reset_teacher_password(new_password=None, data_dir=None):
    """重置教师控制台密码；new_password 为空时清除密码以恢复首次设置流程。"""
    target_data = Path(data_dir) if data_dir else data_dir_path()
    db_file = target_data / "classroom.sqlite3"
    if not db_file.is_file():
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from shanhai import create_app

        create_app({"DATA_DIR": str(target_data)})

    conn = sqlite3.connect(str(db_file), timeout=10)
    try:
        with conn:
            if new_password:
                if len(new_password) < 8:
                    raise ValueError("教师密码长度不能少于 8 位。")
                hashed = generate_password_hash(new_password)
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES ('teacher_password', ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (hashed,),
                )
            else:
                conn.execute("DELETE FROM settings WHERE key = 'teacher_password'")
    finally:
        conn.close()


class LauncherApp:
    def __init__(self, root):
        self.root = root
        self.root.title("再绘山海经 · AI 课堂平台启动器 (v1.0.0)")
        self.root.geometry("620x560")
        self.root.minsize(580, 520)

        self.proc = None
        self.lan_ips = get_lan_ips()
        self.lan_ip = self.lan_ips[0]
        cfg = load_config()

        self.port_var = tk.StringVar(value=str(cfg["port"]))
        self.threads_var = tk.StringVar(value=str(cfg["threads"]))
        self.locks_var = tk.BooleanVar(value=bool(cfg["progress_locks"]))
        self.auto_open_var = tk.BooleanVar(value=bool(cfg["auto_open_browser"]))
        self.status_var = tk.StringVar(value="状态：未启动")
        self.teacher_url_var = tk.StringVar(value=f"http://127.0.0.1:{cfg['port']}/teacher")
        self.student_url_var = tk.StringVar(value=f"http://{self.lan_ip}:{cfg['port']}")

        self._build_ui()
        self.port_var.trace_add("write", lambda *_: self._refresh_urls())
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self):
        pad = {"padx": 12, "pady": 6}

        # 1. 运行配置区
        cfg_frame = ttk.LabelFrame(self.root, text="课堂服务配置", padding=10)
        cfg_frame.pack(fill="x", **pad)

        row1 = ttk.Frame(cfg_frame)
        row1.pack(fill="x", pady=3)
        ttk.Label(row1, text="服务端口：").pack(side="left")
        self.port_entry = ttk.Entry(row1, textvariable=self.port_var, width=8)
        self.port_entry.pack(side="left", padx=(0, 18))

        ttk.Label(row1, text="并发线程数：").pack(side="left")
        self.threads_spin = ttk.Spinbox(row1, from_=1, to=64, textvariable=self.threads_var, width=6)
        self.threads_spin.pack(side="left", padx=(0, 18))
        ttk.Label(row1, text="（建议课堂 50 人设为 8~16）", foreground="#666666").pack(side="left")

        row2 = ttk.Frame(cfg_frame)
        row2.pack(fill="x", pady=(6, 0))
        self.locks_chk = ttk.Checkbutton(row2, text="开启课程进度解锁（按课堂顺序解锁活动）", variable=self.locks_var)
        self.locks_chk.pack(side="left", padx=(0, 16))
        self.auto_open_chk = ttk.Checkbutton(row2, text="启动后自动打开教师端", variable=self.auto_open_var)
        self.auto_open_chk.pack(side="left")

        # 2. 服务控制与地址区
        ctrl_frame = ttk.LabelFrame(self.root, text="服务控制与访问地址", padding=10)
        ctrl_frame.pack(fill="x", **pad)

        top_bar = ttk.Frame(ctrl_frame)
        top_bar.pack(fill="x", pady=(0, 8))
        self.toggle_btn = ttk.Button(top_bar, text="▶ 启动课堂服务", command=self.toggle_server, width=18)
        self.toggle_btn.pack(side="left")
        ttk.Label(top_bar, textvariable=self.status_var, font=("Microsoft YaHei UI", 9, "bold")).pack(side="left", padx=12)

        url1 = ttk.Frame(ctrl_frame)
        url1.pack(fill="x", pady=2)
        ttk.Label(url1, text="教师控制台：", width=12).pack(side="left")
        ttk.Entry(url1, textvariable=self.teacher_url_var, state="readonly").pack(side="left", fill="x", expand=True, padx=(0, 6))
        ttk.Button(url1, text="打开", width=8, command=self.open_teacher).pack(side="left")

        url2 = ttk.Frame(ctrl_frame)
        url2.pack(fill="x", pady=2)
        ttk.Label(url2, text="学生端地址：", width=12).pack(side="left")
        self.student_url_combo = ttk.Combobox(url2, textvariable=self.student_url_var, state="readonly")
        self.student_url_combo.pack(side="left", fill="x", expand=True, padx=(0, 6))
        ttk.Button(url2, text="复制", width=8, command=self.copy_student_url).pack(side="left")
        self._refresh_urls()

        # 3. 实用维护工具区
        tool_frame = ttk.LabelFrame(self.root, text="数据与维护工具（建议先停止服务后操作）", padding=10)
        tool_frame.pack(fill="x", **pad)

        btn_row = ttk.Frame(tool_frame)
        btn_row.pack(fill="x")
        ttk.Button(btn_row, text="一键备份数据库", command=self.on_backup).pack(side="left", padx=(0, 8))
        ttk.Button(btn_row, text="备份并初始化数据库", command=self.on_reset_db).pack(side="left", padx=(0, 8))
        ttk.Button(btn_row, text="重置教师控制台密码", command=self.on_reset_pwd).pack(side="left", padx=(0, 8))
        ttk.Button(btn_row, text="打开数据目录", command=self.on_open_data).pack(side="left")

        # 4. 运行日志区
        log_frame = ttk.LabelFrame(self.root, text="运行日志", padding=8)
        log_frame.pack(fill="both", expand=True, **pad)
        self.log_text = tk.Text(log_frame, height=9, state="disabled", wrap="word", font=("Consolas", 9))
        scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scroll.set)
        self.log_text.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        self._append_log("启动器就绪。请确认配置后点击“启动课堂服务”。")

    def _refresh_urls(self):
        port = self.port_var.get().strip() or "5000"
        self.teacher_url_var.set(f"http://127.0.0.1:{port}/teacher")
        urls = [f"http://{ip}:{port}" for ip in self.lan_ips]
        self.student_url_combo["values"] = urls
        if self.student_url_var.get() not in urls:
            self.student_url_var.set(urls[0])

    def _append_log(self, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"[{ts}] {msg}\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _set_running_ui(self, running):
        state = "disabled" if running else "normal"
        self.port_entry.configure(state=state)
        self.threads_spin.configure(state=state)
        self.locks_chk.configure(state=state)
        self.auto_open_chk.configure(state=state)
        self.toggle_btn.configure(text="■ 停止课堂服务" if running else "▶ 启动课堂服务")

    def _validate_inputs(self):
        try:
            port = int(self.port_var.get().strip())
            if not (1 <= port <= 65535):
                raise ValueError
        except ValueError:
            messagebox.showerror("配置有误", "端口号必须是 1 到 65535 之间的整数。")
            return None
        try:
            threads = int(self.threads_var.get().strip())
            if not (1 <= threads <= 64):
                raise ValueError
        except ValueError:
            messagebox.showerror("配置有误", "线程数必须是 1 到 64 之间的整数。")
            return None
        return port, threads

    def toggle_server(self):
        if self.proc and self.proc.poll() is None:
            self.stop_server()
        else:
            self.start_server()

    def start_server(self):
        parsed = self._validate_inputs()
        if not parsed:
            return
        port, threads = parsed
        locks = self.locks_var.get()
        auto_open = self.auto_open_var.get()

        save_config({
            "port": port,
            "threads": threads,
            "progress_locks": locks,
            "auto_open_browser": auto_open,
        })

        py_exe = RUNTIME_DIR / "python.exe"
        if not py_exe.is_file():
            py_exe = Path(sys.executable)

        env = os.environ.copy()
        env["SHANHAI_RUN_MODE"] = "waitress"
        env["SHANHAI_PORT"] = str(port)
        env["SHANHAI_THREADS"] = str(threads)
        env["SHANHAI_PROGRESS_LOCKS"] = "1" if locks else "0"
        env["PYTHONUNBUFFERED"] = "1"

        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            self.proc = subprocess.Popen(
                [str(py_exe), str(ROOT / "app.py")],
                cwd=str(ROOT),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=creationflags,
            )
        except Exception as exc:
            messagebox.showerror("启动失败", f"无法启动服务：{exc}")
            return

        self._set_running_ui(True)
        self.status_var.set(f"状态：运行中（端口 {port}，{threads} 线程）")
        self._append_log(f"正在启动服务（端口={port}，线程={threads}，进度解锁={'开启' if locks else '关闭'}）...")

        threading.Thread(target=self._read_proc_output, daemon=True).start()
        if auto_open:
            self.root.after(1500, self.open_teacher)

    def _read_proc_output(self):
        proc = self.proc
        if not proc or not proc.stdout:
            return
        for line in proc.stdout:
            text = line.rstrip()
            if text:
                self.root.after(0, self._append_log, text)
        code = proc.wait()
        self.root.after(0, self._on_proc_exit, code)

    def _on_proc_exit(self, code):
        if self.proc is not None:
            self.proc = None
            self._set_running_ui(False)
            self.status_var.set("状态：已停止")
            self._append_log(f"服务已退出（退出码 {code}）。")

    def stop_server(self):
        if self.proc and self.proc.poll() is None:
            self._append_log("正在停止课堂服务...")
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None
        self._set_running_ui(False)
        self.status_var.set("状态：已停止")

    def open_teacher(self):
        webbrowser.open(self.teacher_url_var.get())

    def copy_student_url(self):
        url = self.student_url_var.get()
        self.root.clipboard_clear()
        self.root.clipboard_append(url)
        self._append_log(f"已复制学生端地址：{url}")

    def _ensure_stopped(self, action_name):
        if self.proc and self.proc.poll() is None:
            messagebox.showwarning("服务正在运行", f"请先点击“停止课堂服务”，再执行“{action_name}”。")
            return False
        return True

    def on_backup(self):
        if not self._ensure_stopped("一键备份数据库"):
            return
        try:
            backup_root, copied = backup_data()
            items = "、".join(copied) if copied else "（当前尚无数据文件，已创建空备份目录）"
            self._append_log(f"备份完成：{backup_root} [{items}]")
            messagebox.showinfo("备份成功", f"已备份到：\n{backup_root}\n\n包含内容：{items}")
        except Exception as exc:
            messagebox.showerror("备份失败", str(exc))

    def on_reset_db(self):
        if not self._ensure_stopped("备份并初始化数据库"):
            return
        ok = messagebox.askyesno(
            "确认备份并初始化",
            "此操作将：\n1. 自动完整备份当前数据到 data/backups/；\n2. 清空所有班级、学生、学习札记、上传作品及教师密码；\n3. 重新生成空白课堂数据库。\n\n确定继续吗？",
        )
        if not ok:
            return
        try:
            backup_root, _ = reset_and_init_database()
            self._append_log(f"已完成备份并初始化空数据库，备份位置：{backup_root}")
            messagebox.showinfo("初始化完成", f"旧数据已备份至：\n{backup_root}\n\n当前数据库已重置为空白状态。")
        except Exception as exc:
            messagebox.showerror("初始化失败", str(exc))

    def on_reset_pwd(self):
        if not self._ensure_stopped("重置教师控制台密码"):
            return
        new_pwd = simpledialog.askstring(
            "重置教师控制台密码",
            "请输入新密码（至少 8 位）；\n如果直接留空并点“确定”，将清除旧密码并恢复为首次进入时设置。",
            show="*",
            parent=self.root,
        )
        if new_pwd is None:
            return
        new_pwd = new_pwd.strip()
        try:
            reset_teacher_password(new_pwd if new_pwd else None)
            if new_pwd:
                self._append_log("教师控制台密码已更新为新密码。")
                messagebox.showinfo("重置成功", "教师控制台密码已更新，请使用新密码登录 /teacher。")
            else:
                self._append_log("教师控制台密码已清除，下次打开 /teacher 时可重新设置。")
                messagebox.showinfo("重置成功", "教师控制台密码已清除，下次打开教师控制台时将提示设置新密码。")
        except Exception as exc:
            messagebox.showerror("重置失败", str(exc))

    def on_open_data(self):
        d = data_dir_path()
        d.mkdir(parents=True, exist_ok=True)
        os.startfile(str(d))

    def _on_close(self):
        if self.proc and self.proc.poll() is None:
            if not messagebox.askyesno("确认退出", "课堂服务正在运行，关闭窗口将停止服务并断开学生连接。确定退出吗？"):
                return
            self.stop_server()
        self.root.destroy()


if __name__ == "__main__":
    try:
        root = tk.Tk()
        LauncherApp(root)
        root.mainloop()
    except Exception:
        import traceback
        err = traceback.format_exc()
        try:
            (ROOT / "launcher_error.log").write_text(err, encoding="utf-8")
        except Exception:
            pass
        try:
            messagebox.showerror("启动器异常", err)
        except Exception:
            pass
        raise
