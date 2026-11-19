"""学生登录和学习首页。"""
from flask import Blueprint, flash, redirect, render_template, request, session, url_for
from . import classroom
from .courses import COURSE_VOLUMES
from .worksheets import student_catalog

student = Blueprint("student", __name__)


@student.get("/")
def index():
    form_data = session.pop("login_form", None) or {}
    return render_template("index.html", classes=classroom.list_classes(),
                           selected_class_id=str(form_data.get("class_id", "")),
                           entered_name=str(form_data.get("name", "")))


@student.post("/login")
def login():
    device = request.form.get("device", "")
    class_id = request.form.get("class_id", "")
    name = request.form.get("name", "")
    try:
        student_id = classroom.login_student(class_id, name, device)
    except classroom.ClassroomError as exc:
        session["login_form"] = {"class_id": class_id, "name": name}
        flash(str(exc), "error")
        return redirect(url_for("student.index"))
    session.clear()
    session["student_id"] = student_id
    session["device"] = device
    return redirect(url_for("student.home"))


@student.get("/learn")
def home():
    current = classroom.current_student(session.get("student_id"), session.get("device"))
    if not current:
        if session.get("student_id"):
            session.pop("student_id", None)
            session.pop("device", None)
            flash("当前账号绑定已解除或已在另一台终端登录，请重新登录。", "error")
        return redirect(url_for("student.index"))
    return render_template("learn.html", student=current,
                           volumes=student_catalog(session["student_id"], COURSE_VOLUMES))


@student.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("student.index"))
