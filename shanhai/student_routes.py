"""学生登录和学习首页。"""
from flask import Blueprint, flash, redirect, render_template, request, session, url_for
from . import classroom
from .courses import COURSE_VOLUMES
from .worksheets import student_catalog

student = Blueprint("student", __name__)


@student.get("/")
def index():
    return render_template("index.html", classes=classroom.list_classes())


@student.post("/login")
def login():
    device = request.form.get("device", "")
    try:
        student_id = classroom.login_student(request.form.get("class_id", ""), request.form.get("name", ""), device)
    except classroom.ClassroomError as exc:
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
        return redirect(url_for("student.index"))
    return render_template("learn.html", student=current,
                           volumes=student_catalog(session["student_id"], COURSE_VOLUMES))


@student.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("student.index"))
