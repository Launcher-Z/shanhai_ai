"""样本上传与发布独立于札记评分；学生身份仅取自登录会话。"""
from flask import Blueprint, jsonify, request, flash, redirect, url_for, Response
import json
from . import handwriting, worksheets
from .auth import teacher_required
from .worksheet_routes import require_student

handwriting_routes = Blueprint("handwriting", __name__)


@handwriting_routes.errorhandler(handwriting.SampleError)
@handwriting_routes.errorhandler(worksheets.WorksheetError)
def sample_error(error):
    return jsonify(error=str(error)), error.code


@handwriting_routes.get("/api/handwriting/mine")
def mine():
    return jsonify(handwriting.own_samples(require_student()))


@handwriting_routes.post("/api/handwriting/upload")
def upload():
    return jsonify(handwriting.upload(require_student(), request.get_json(silent=True)))


@handwriting_routes.get("/api/handwriting/latest")
def latest():
    require_student()
    data = handwriting.dataset()
    return jsonify(dataset={key: value for key, value in data.items() if key != "samples"} if data else None)


@handwriting_routes.get("/api/handwriting/datasets/<int:version>")
def download(version):
    require_student()
    response = jsonify(handwriting.dataset(version))
    response.headers["Cache-Control"] = "private, no-store"
    return response


def _analysis_redirect(source, default_lesson=None):
    raw_class = source.get("class_id", "")
    raw_lesson = source.get("lesson_id", "") or default_lesson or ""
    raw_digit = source.get("digit", "")
    return redirect(url_for(
        "teacher.dashboard", tab="analysis",
        class_id=raw_class or None,
        lesson_id=raw_lesson or None,
        digit=raw_digit if raw_digit != "" else None,
        open="lesson-7-task-2", _anchor="handwriting-library",
    ))


@handwriting_routes.get("/teacher/handwriting")
@teacher_required
def teacher_library():
    return _analysis_redirect(request.args, default_lesson="lesson-7")


@handwriting_routes.post("/teacher/handwriting/<int:sample_id>")
@teacher_required
def edit_sample(sample_id):
    try:
        handwriting.update_sample(sample_id, request.form.get("label", type=int), request.form.get("included") == "1")
        flash("样本已保存；已发布的版本保持原样。", "success")
    except handwriting.SampleError as error:
        flash(str(error), "error")
    return _analysis_redirect(request.form)


@handwriting_routes.post("/teacher/handwriting/batch")
@teacher_required
def batch_save():
    try:
        items = json.loads(request.form.get("changes", ""))
        count, data, warn = handwriting.save_and_publish(items)
        if warn:
            flash(f"已保存 {count} 张样本改动，但暂未生成新版本：{warn}", "error")
        else:
            flash(f"已保存 {count} 张样本改动并发布第{data['version']}版（共{data['count']}张，相同笔迹已合并）。", "success")
    except (TypeError, json.JSONDecodeError):
        flash("批量保存参数格式不正确。", "error")
    except handwriting.SampleError as error:
        flash(str(error), "error")
    return _analysis_redirect(request.form)


@handwriting_routes.post("/teacher/handwriting/publish")
@teacher_required
def publish():
    try:
        data = handwriting.publish()
        flash(f"已发布第{data['version']}版，共{data['count']}张（相同笔迹已合并）。", "success")
    except handwriting.SampleError as error:
        flash(str(error), "error")
    return _analysis_redirect(request.form)


@handwriting_routes.post("/teacher/handwriting/selection")
@teacher_required
def select_scope():
    try:
        raw_class, raw_digit = request.form.get("class_id", ""), request.form.get("digit", "")
        if (raw_class and not raw_class.isdigit()) or (raw_digit and not raw_digit.isdigit()) or request.form.get("included") not in {"0", "1"}:
            raise handwriting.SampleError("筛选范围不正确。")
        count = handwriting.select_scope(request.form["included"] == "1", int(raw_class) if raw_class else None, int(raw_digit) if raw_digit else None)
        flash(f"已更新当前范围的{count}张样本；发布后学生才能下载。", "success")
    except handwriting.SampleError as error:
        flash(str(error), "error")
    return _analysis_redirect(request.form)


@handwriting_routes.get("/teacher/handwriting/datasets/<int:version>/download")
@teacher_required
def export(version):
    return Response(json.dumps(handwriting.dataset(version), ensure_ascii=False), mimetype="application/json",
                    headers={"Content-Disposition": f'attachment; filename="handwriting-v{version}.json"'})
