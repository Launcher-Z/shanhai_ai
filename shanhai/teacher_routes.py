"""教师登录、班级管理和名单管理。"""
from flask import Blueprint, abort, flash, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash
from . import classroom, teacher_data, worksheets
from .auth import get_teacher_password, set_initial_password, teacher_required

teacher = Blueprint("teacher", __name__, url_prefix="/teacher")


@teacher.route('/animal-analysis', methods=['GET', 'POST'])
@teacher_required
def animal_analysis():
    from . import animal_analysis as analysis_module, worksheets
    try:
        payload = request.get_json(silent=True) if request.method == 'POST' else None
        if request.method == 'POST' and not isinstance(payload, dict):
            raise worksheets.WorksheetError('操作数据格式不正确。')
        selected = payload.get('class_id') if payload else request.args.get('class_id', '')
        if selected is None or selected == '':
            class_id = None
        else:
            try:
                class_id = int(selected)
            except (ValueError, TypeError):
                raise worksheets.WorksheetError('班级编号不正确。')
            if not any(item['id'] == class_id for item in classroom.list_classes()):
                raise worksheets.WorksheetError('班级不存在。', 404)
        scope = teacher_data.load_scope(class_id)
        activity_id = payload.get('activity_id', analysis_module.ACTIVITY) if payload else request.args.get('activity_id', analysis_module.ACTIVITY)
        if activity_id not in analysis_module.ACTIVITIES:
            raise worksheets.WorksheetError('活动不存在。', 404)
        if request.method == 'POST':
            analysis_module.set_exclusion(scope, payload)
        return jsonify(analysis_module.build(scope, activity_id))
    except worksheets.WorksheetError as error:
        return jsonify(error=str(error)), error.code


@teacher.route("/login", methods=["GET", "POST"])
def login():
    stored = get_teacher_password()
    if request.method == "POST":
        password = request.form.get("password", "")
        if not stored:
            if len(password) < 8 or password != request.form.get("confirm", ""):
                flash("密码至少 8 位，且两次输入需要一致。", "error")
            elif set_initial_password(password):
                session.clear()
                session["teacher"] = True
                return redirect(url_for("teacher.dashboard"))
            else:
                flash("教师密码已设置，请使用已设置的密码登录。", "error")
        elif check_password_hash(stored, password):
            session.clear()
            session["teacher"] = True
            return redirect(url_for("teacher.dashboard"))
        else:
            flash("密码不正确，请重试。", "error")
    return render_template("teacher_login.html", setup=not stored)


@teacher.get("")
@teacher_required
def dashboard():
    classes = classroom.list_classes()
    chosen = request.args.get("class_id", "")
    selected = next((c for c in classes if str(c["id"]) == chosen), None)
    if chosen and selected is None:
        abort(404)
    class_id = selected["id"] if selected else None
    tab = request.args.get("tab", "members")
    if tab not in {"members", "dashboard", "analysis"}:
        abort(400)
    scope = teacher_data.load_scope(class_id)
    lesson_id = request.args.get("lesson_id", "")
    if lesson_id and not any(l["id"] == lesson_id for l in scope["lessons"]):
        abort(400)
    digit = request.args.get("digit", type=int) if tab == "analysis" else None
    if digit is not None and not 0 <= digit <= 9:
        abort(400)
    open_activity = request.args.get("open", "")
    if not open_activity and digit is not None:
        open_activity = "lesson-7-task-2"
    selected_student = request.args.get("student_id", type=int)
    if selected_student is not None and not any(s["id"] == selected_student for s in scope["students"]):
        abort(404)
    if selected_student is None and scope["students"]:
        selected_student = next((s["id"] for s in scope["students"] if s["pending"]), scope["students"][0]["id"])
    work = teacher_data.workspace(selected_student, request.args.get("activity_id")) if tab == "members" and selected_student else None
    rows = teacher_data.matrix(scope) if tab == "dashboard" else []
    overview_cols = teacher_data.overview_columns(scope, rows) if tab == "dashboard" else []
    progress_cap_groups = worksheets.progress_cap_lessons() if tab == "members" else []
    selected_cap_label = worksheets.progress_cap_label(selected["progress_cap"]) if (tab == "members" and selected) else ""
    return render_template("teacher.html", classes=classes, selected=selected,
                           selected_class_id=class_id, active_tab=tab, scope=scope,
                           selected_student_id=selected_student, work=work,
                           lesson_id=lesson_id, digit=digit, open_activity=open_activity,
                           rows=rows, overview_cols=overview_cols,
                           progress_cap_groups=progress_cap_groups,
                           selected_cap_label=selected_cap_label,
                           report=teacher_data.analysis(scope, lesson_id) if tab == "analysis" else None,
                           curations=teacher_data.curations(class_id, digit, lesson_id) if tab == "analysis" else {})


@teacher.get("/students/<int:student_id>/workspace")
@teacher_required
def student_workspace(student_id):
    work = teacher_data.workspace(student_id, request.args.get("activity_id"))
    if work is None:
        abort(404)
    chosen = request.args.get("class_id", "")
    if chosen and chosen != str(work["student"]["class_id"]):
        abort(404)
    return render_template("teacher/workspace.html", work=work,
                           selected_class_id=int(chosen) if chosen else None)


@teacher.post("/classes")
@teacher_required
def create_class():
    try:
        class_id = classroom.create_class(request.form.get("name", ""))
        flash("班级已创建，可让学生登录或提前添加名单。", "success")
        return redirect(url_for("teacher.dashboard", class_id=class_id))
    except classroom.ClassroomError as exc:
        flash(str(exc), "error")
    return redirect(url_for("teacher.dashboard"))


@teacher.post("/classes/<int:class_id>/rename")
@teacher_required
def rename_class(class_id):
    try:
        if not classroom.rename_class(class_id, request.form.get("name", "")):
            abort(404)
        flash("班级名称已更新。", "success")
    except classroom.ClassroomError as exc:
        flash(str(exc), "error")
    return redirect(url_for("teacher.dashboard", class_id=class_id))


@teacher.post("/classes/<int:class_id>/registration")
@teacher_required
def toggle_registration(class_id):
    if not classroom.toggle_registration(class_id):
        abort(404)
    flash("班级新增账号设置已更新。", "success")
    return redirect(url_for("teacher.dashboard", class_id=class_id))


@teacher.post("/classes/<int:class_id>/progress-cap")
@teacher_required
def update_progress_cap(class_id):
    try:
        if not classroom.set_progress_cap(class_id, request.form.get("progress_cap", "")):
            abort(404)
        flash("班级进度卡点已更新。", "success")
    except classroom.ClassroomError as exc:
        flash(str(exc), "error")
    return redirect(url_for("teacher.dashboard", class_id=class_id))


@teacher.post("/classes/<int:class_id>/students")
@teacher_required
def add_students(class_id):
    try:
        count = classroom.add_students(class_id, request.form.get("names", ""))
        if count is None:
            abort(404)
        flash(f"已添加 {count} 名学生；重复姓名未重复添加。", "success")
    except classroom.ClassroomError as exc:
        flash(str(exc), "error")
    return redirect(url_for("teacher.dashboard", class_id=class_id))


@teacher.post("/students/<int:student_id>/unlock")
@teacher_required
def unlock(student_id):
    class_id = classroom.unlock_student(student_id)
    if class_id is None:
        abort(404)
    flash("终端绑定已解除。", "success")
    # 从个人工作台操作后继续停留在该生，避免教师反复查找。
    scope_id = request.form.get("scope_class_id", str(class_id))
    return redirect(url_for("teacher.dashboard", class_id=scope_id, student_id=student_id))


@teacher.post("/students/<int:student_id>/rename")
@teacher_required
def rename_student(student_id):
    scope_id = request.form.get("scope_class_id", "")
    try:
        class_id = classroom.rename_student(student_id, request.form.get("name", ""))
        if class_id is None:
            abort(404)
        flash("学生姓名已更新。", "success")
        scope_id = scope_id or str(class_id)
    except classroom.ClassroomError as exc:
        flash(str(exc), "error")
    return redirect(url_for("teacher.dashboard", class_id=scope_id, student_id=student_id))


@teacher.post("/students/<int:student_id>/delete")
@teacher_required
def delete_student(student_id):
    scope_id = request.form.get("scope_class_id", "")
    class_id = classroom.delete_student(student_id)
    if class_id is None:
        abort(404)
    flash("学生及其学习记录已删除。", "success")
    return redirect(url_for("teacher.dashboard", class_id=scope_id or class_id))
