"""创建并配置课堂平台。"""
import gzip
import os
import secrets
from pathlib import Path
from flask import Flask, abort, request, session
from . import database

ROOT = Path(__file__).resolve().parent.parent


def create_app(config=None):
    app = Flask(__name__, template_folder=str(ROOT / "templates"), static_folder=str(ROOT / "static"))
    app.config.update(DATA_DIR=os.environ.get("SHANHAI_DATA_DIR", str(ROOT / "data")),
                      SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      PROGRESS_LOCKS_ENABLED=True)
    if config:
        app.config.update(config)
    data_dir = Path(app.config["DATA_DIR"])
    data_dir.mkdir(parents=True, exist_ok=True)
    secret_file = data_dir / "session.key"
    if not secret_file.exists():
        secret_file.write_text(secrets.token_hex(32), encoding="utf-8")
    app.secret_key = secret_file.read_text(encoding="utf-8").strip()
    app.config["DATABASE"] = str(data_dir / "classroom.sqlite3")
    with app.app_context():
        database.init_db()

    @app.before_request
    def protect_forms():
        # 令牌绑定会话，所有写入表单必须携带相同令牌。
        if request.path == '/api/creation/media':
            request.max_content_length = 13 * 1024 * 1024
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(24)
        if request.method == "POST":
            token = request.headers.get("X-CSRF-Token", "") if request.is_json else request.form.get("csrf", "")
            if not secrets.compare_digest(token, session["csrf"]):
                if request.path.startswith("/api/"):
                    return {"error": "页面验证已失效，请刷新页面后重试。"}, 400
                abort(400)

    @app.after_request
    def compress_response(response):
        if (
            response.status_code != 200
            or response.direct_passthrough
            or "Content-Encoding" in response.headers
            or "gzip" not in request.headers.get("Accept-Encoding", "").lower()
        ):
            return response
        mimetype = (response.mimetype or "").lower()
        if not (mimetype.startswith("text/") or mimetype in {"application/json", "application/javascript"}):
            return response
        data = response.get_data()
        if len(data) <= 1024:
            return response
        compressed = gzip.compress(data, compresslevel=5)
        if len(compressed) >= len(data):
            return response
        response.set_data(compressed)
        response.headers["Content-Encoding"] = "gzip"
        response.headers["Content-Length"] = str(len(compressed))
        vary = response.headers.get("Vary", "")
        if "Accept-Encoding" not in vary:
            response.headers["Vary"] = f"{vary}, Accept-Encoding".strip(", ")
        return response

    @app.context_processor
    def inject_csrf():
        return {"csrf": session.get("csrf", "")}

    from .student_routes import student
    from .teacher_routes import teacher
    from .worksheet_routes import worksheet
    from .handwriting_routes import handwriting_routes
    app.register_blueprint(student)
    app.register_blueprint(teacher)
    app.register_blueprint(worksheet)
    app.register_blueprint(handwriting_routes)
    from .creation_routes import creation_routes
    app.register_blueprint(creation_routes)
    from .pixel_paint import pixel_paint
    app.register_blueprint(pixel_paint)
    from .creation import record_data, BEASTS
    app.jinja_env.filters['creation_data'] = record_data
    app.jinja_env.globals['creation_beasts'] = {beast['id']:beast for beast in BEASTS}
    from . import teacher_data
    app.jinja_env.filters['structured_answer'] = teacher_data.structured_answer
    from .classification import tree_data, knn_captures_data, ANIMALS, FEATURES
    app.jinja_env.filters['decision_tree_data'] = tree_data
    app.jinja_env.filters['knn_captures_data'] = knn_captures_data
    app.jinja_env.globals.update(decision_animals=ANIMALS, decision_features=FEATURES)
    from .creation_ai import init_ai
    init_ai(app)
    return app
