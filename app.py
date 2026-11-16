"""课堂平台的启动入口（发布版）。"""
import os
from shanhai import create_app


def _env_bool(name, default=True):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


# 启动方式：课堂使用 "waitress"，本机调试可改为 "dev"。
RUN_MODE = os.environ.get("SHANHAI_RUN_MODE", "waitress")

# 正常课堂模式开启进度解锁；如需自由访问全部课程，可改为 False 或在启动器取消勾选。
PROGRESS_LOCKS_ENABLED = _env_bool("SHANHAI_PROGRESS_LOCKS", True)

app = create_app({"PROGRESS_LOCKS_ENABLED": PROGRESS_LOCKS_ENABLED})

if __name__ == "__main__":
    port = int(os.environ.get("SHANHAI_PORT", "5000"))
    threads = max(1, int(os.environ.get("SHANHAI_THREADS", "8")))
    use_https = _env_bool("SHANHAI_HTTPS", False)
    if RUN_MODE == "dev":
        app.run(host="127.0.0.1", port=port, debug=True)
    elif RUN_MODE == "waitress":
        app.debug = False
        if use_https:
            from cheroot.ssl.builtin import BuiltinSSLAdapter
            from cheroot.wsgi import Server as CherootServer

            cert_path = os.environ.get("SHANHAI_SSL_CERT")
            key_path = os.environ.get("SHANHAI_SSL_KEY")
            if not cert_path or not key_path:
                from pathlib import Path
                from shanhai.certs import ensure_lan_cert

                cert_dir = os.environ.get("SHANHAI_CERTS_DIR", str(Path(__file__).resolve().parent / "certs"))
                c, k, _, _ = ensure_lan_cert(cert_dir)
                cert_path, key_path = str(c), str(k)

            server = CherootServer(("0.0.0.0", port), app, numthreads=threads)
            server.ssl_adapter = BuiltinSSLAdapter(cert_path, key_path)
            print(f"山海AI课堂服务已启动（HTTPS）：https://0.0.0.0:{port} (threads={threads}, locks={PROGRESS_LOCKS_ENABLED})", flush=True)
            try:
                server.start()
            except KeyboardInterrupt:
                pass
            finally:
                server.stop()
        else:
            from waitress import serve

            # 课堂模式监听所有网卡，供学生通过教师机的局域网 IP 访问。
            print(f"山海AI课堂服务已启动：http://0.0.0.0:{port} (threads={threads}, locks={PROGRESS_LOCKS_ENABLED})", flush=True)
            serve(app, host="0.0.0.0", port=port, threads=threads)
    else:
        raise ValueError('RUN_MODE 只能设为 "dev" 或 "waitress"')
