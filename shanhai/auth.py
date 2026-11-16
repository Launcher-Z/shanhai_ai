"""教师密码与教师会话校验。"""
from functools import wraps
from flask import redirect, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash
from .database import connect


def get_teacher_password():
    with connect() as db:
        row = db.execute("SELECT value FROM settings WHERE key = 'teacher_password'").fetchone()
    return row["value"] if row else None


def set_initial_password(password):
    with connect() as db:
        db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('teacher_password', ?)", (generate_password_hash(password),))
    return check_password_hash(get_teacher_password(), password)


def teacher_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not session.get("teacher"):
            return redirect(url_for("teacher.login"))
        return fn(*args, **kwargs)
    return wrapped
