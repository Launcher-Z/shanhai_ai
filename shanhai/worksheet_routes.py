"""学生札记接口与教师评阅页面。"""
from flask import Blueprint, abort, flash, jsonify, redirect, render_template, request, session, url_for

from . import classroom, worksheets, teacher_data
from .auth import teacher_required

worksheet = Blueprint("worksheet", __name__)


@worksheet.errorhandler(worksheets.WorksheetError)
def worksheet_error(error):
    return jsonify(error=str(error)), error.code


def require_student():
    student_id = session.get("student_id")
    if not classroom.current_student(student_id, session.get("device")):
        raise worksheets.WorksheetError("登录已失效，请重新登录后继续。", 401)
    return student_id


@worksheet.get("/api/worksheets/<activity_id>")
def read(activity_id):
    return jsonify(worksheets.read_student(require_student(), activity_id))


@worksheet.post("/api/worksheets/<activity_id>/<action>")
def write(activity_id, action):
    student_id = require_student()
    if action not in {"save", "submit"}:
        abort(404)
    return jsonify(worksheets.write_student(student_id, activity_id, request.get_json(silent=True), action == "submit"))


@worksheet.get("/api/learning/progress")
def learning_progress():
    return jsonify(activities=worksheets.student_progress(require_student()))


@worksheet.get('/api/learning/animal-summary')
def animal_summary():
    from .animal_analysis import ACTIVITY, BEASTS, student_summary
    student_id = require_student()
    source_activity = request.args.get('activity_id', ACTIVITY)
    if source_activity not in {ACTIVITY, BEASTS}:
        return jsonify(error='活动不存在。'), 404
    gate_activity = 'lesson-4-task-2' if source_activity == BEASTS else 'lesson-3-task-1'
    worksheets.definition_for(gate_activity, student_id=student_id)
    current = classroom.current_student(student_id, session.get('device'))
    # 班级由已验证的登录身份决定，不接受客户端传入的 class_id。
    result = student_summary(teacher_data.load_scope(current['class_id']), source_activity)
    result['class_name'] = current['class_name']
    response = jsonify(result)
    response.headers['Cache-Control'] = 'no-store'
    return response


@worksheet.get('/api/learning/animal-comparison')
def animal_comparison():
    from .animal_analysis import comparison
    student_id = require_student()
    worksheets.definition_for('lesson-3-task-2', student_id=student_id)
    current = classroom.current_student(student_id, session.get('device'))
    result = comparison(teacher_data.load_scope(current['class_id']))
    result['class_name'] = current['class_name']
    response = jsonify(result)
    response.headers['Cache-Control'] = 'no-store'
    return response


@worksheet.get("/teacher/worksheets")
@teacher_required
def queue():
    classes = classroom.list_classes()
    chosen = request.args.get("class_id", type=int) or (classes[0]["id"] if classes else None)
    selected, _ = classroom.class_roster(chosen)
    state = request.args.get("status", "pending")
    if state not in {"pending", "returned", "completed", "all"}:
        abort(400)
    return render_template("worksheet_queue.html", classes=classes, selected=selected,
                           selected_class_id=chosen, active_tab="members", state=state,
                           records=worksheets.review_queue(chosen, state), labels=worksheets.STATUS_LABELS)


@worksheet.get("/teacher/worksheets/<int:record_id>")
@teacher_required
def detail(record_id):
    record = worksheets.teacher_record(record_id)
    return render_template("worksheet_review.html", record=record,
                           selected_class_id=record["class_id"], active_tab="members")


def _review_response(record_id, message, **extra):
    asynchronous = request.accept_mimetypes.best == "application/json"
    record = worksheets.teacher_record(record_id)
    if asynchronous and request.form.get("return_to") == "analysis":
        return jsonify(
            ok=True,
            record_id=record_id,
            activity_id=record["activity_id"],
            revision=record["revision"],
            status=record["status"],
            stage_states=record["stage_states"],
            question_reviews=record.get("question_reviews") or {},
            teacher_excellent=bool(record.get("teacher_excellent")),
            feedback=record.get("feedback") or "",
            **extra,
        )
    if asynchronous:
        scope_id = request.form.get("scope_class_id", "")
        work = teacher_data.workspace(record["student_id"], record["activity_id"])
        html = render_template("teacher/workspace.html", work=work,
                               selected_class_id=int(scope_id) if scope_id.isdigit() else None)
        return jsonify(html=html, student_id=record["student_id"],
                       pending=sum(r["status"] == "pending" for r in work["student_records"]), **extra)
    flash(message, "success")
    if request.form.get("return_to") == "analysis":
        anchor = (f"pixel-gallery-{record['activity_id']}"
                  if record["activity_id"] in {"lesson-1-task-2", "lesson-1-task-3"}
                  else f"creation-works-{record['activity_id']}")
        return redirect(url_for("teacher.dashboard", tab="analysis",
                                class_id=request.form.get("scope_class_id") or None,
                                lesson_id=request.form.get("lesson_id") or None,
                                open=record["activity_id"], _anchor=anchor))
    if request.form.get("return_to") == "workbench":
        return redirect(url_for("teacher.dashboard", student_id=record["student_id"],
                                activity_id=record["activity_id"],
                                class_id=request.form.get("scope_class_id", "")))
    return redirect(url_for("worksheet.queue", class_id=record["class_id"]))


@worksheet.post("/teacher/worksheets/<int:record_id>/review")
@teacher_required
def review(record_id):
    asynchronous = request.accept_mimetypes.best == "application/json"
    try:
        worksheets.review(record_id, request.form.get("revision"), request.form.get("decision"),
                          request.form.get("feedback", ""), request.form.getlist("returned_questions"))
    except worksheets.WorksheetError as error:
        if asynchronous:
            return jsonify(error=str(error)), error.code
        flash(str(error), "error")
        return redirect(url_for("worksheet.detail", record_id=record_id))
    return _review_response(record_id, "评阅已保存，学生端将自动更新。")


@worksheet.post("/teacher/worksheets/<int:record_id>/review-question")
@teacher_required
def review_question(record_id):
    asynchronous = request.accept_mimetypes.best == "application/json"
    try:
        outcome = worksheets.review_question(
            record_id, request.form.get("revision"),
            request.form.get("question_id", ""), request.form.get("decision", ""),
            request.form.get("feedback", ""))
    except worksheets.WorksheetError as error:
        if asynchronous:
            return jsonify(error=str(error)), error.code
        flash(str(error), "error")
        return redirect(url_for("worksheet.detail", record_id=record_id))
    return _review_response(record_id, "题目批阅已保存。", **outcome)


@worksheet.post("/teacher/worksheets/<int:record_id>/excellent")
@teacher_required
def toggle_excellent(record_id):
    asynchronous = request.accept_mimetypes.best == "application/json"
    try:
        worksheets.set_excellent(record_id, request.form.get("revision"),
                                 request.form.get("excellent") == "1")
    except worksheets.WorksheetError as error:
        if asynchronous:
            return jsonify(error=str(error)), error.code
        flash(str(error), "error")
        return redirect(url_for("worksheet.detail", record_id=record_id))
    return _review_response(record_id, "优秀评定已更新。")
