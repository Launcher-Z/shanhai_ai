"""卷三HTTP入口：会话身份、附件访问及教师发布。"""
import json
import io
from urllib.parse import urlsplit
from flask import Blueprint, jsonify, request, session, send_file, render_template, redirect, url_for, flash
from . import creation
from .database import connect
from .worksheet_routes import require_student
from .worksheets import WorksheetError
from .auth import teacher_required

creation_routes = Blueprint('creation', __name__)


@creation_routes.app_errorhandler(413)
def file_too_large(exc):
    return jsonify(error='图片请控制在12MB以内。'),413


def _analysis_redirect(source=None, activity_id=None, anchor=None):
    source = source or {}
    act = activity_id or source.get('activity_id') or None
    target_anchor = anchor or (f'creation-works-{act}' if act else 'analysis-lesson-8')
    return redirect(url_for(
        'teacher.dashboard', tab='analysis',
        class_id=source.get('class_id') or None,
        lesson_id=source.get('lesson_id') or None,
        open=act, _anchor=target_anchor,
    ))


@creation_routes.errorhandler(WorksheetError)
def error(exc):
    if request.path.startswith('/api/'):
        return jsonify(error=str(exc)), exc.code
    flash(str(exc), 'error')
    return _analysis_redirect(request.form)


tool_settings = creation.tool_settings


@creation_routes.get('/api/creation/tools')
def tools():
    sid = require_student()
    return jsonify(student_id=sid, tools=tool_settings(), beasts=creation.BEASTS, animals=creation.ANIMALS, library=creation.LIBRARY)


@creation_routes.post('/api/creation/media')
def upload():
    sid = require_student()
    if request.content_length and request.content_length > 13*1024*1024:
        raise WorksheetError('图片请控制在12MB以内。',413)
    return jsonify(creation.upload(sid, request.form.get('activity_id'), request.files.get('file')))


@creation_routes.get('/api/creation/media/<media_id>')
@creation_routes.get('/api/creation/media/<media_id>/thumbnail')
def media(media_id):
    teacher = bool(session.get('teacher'))
    sid = None if teacher else require_student()
    with connect() as db:
        if not creation.can_read_media(db, media_id, sid, teacher):
            raise WorksheetError('图片不存在或无权访问。',404)
    response = send_file(creation.media_path(media_id, request.path.endswith('/thumbnail')), mimetype='image/png' if media_id.startswith('p_') else 'image/jpeg')
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@creation_routes.get('/api/creation/gallery')
def gallery():
    offset = max(0, request.args.get('offset', 0, type=int))
    class_id = request.args.get('class_id', type=int)
    activity_id = request.args.get('activity_id') or None
    return jsonify(creation.gallery(require_student(), offset, class_id=class_id, activity_id=activity_id))


@creation_routes.get('/api/creation/favorites')
def favorites():
    return jsonify(items=creation.favorites(require_student()))


@creation_routes.post('/api/creation/favorites')
@creation_routes.post('/api/creation/favorites/<item_id>/<action>')
def favorite_write(item_id=None, action=None):
    if action not in {None,'save','delete'}:
        raise WorksheetError('操作不存在。',404)
    sid = require_student()
    creation.save_favorite(sid, request.get_json(silent=True), item_id, action=='delete')
    return jsonify(items=creation.favorites(sid))


@creation_routes.get('/teacher/creation')
@teacher_required
def teacher_creation():
    class_id = request.args.get('class_id', type=int)
    return redirect(url_for('teacher.dashboard', tab='analysis',
                            class_id=class_id or None,
                            open='lesson-8-task-2', _anchor='analysis-lesson-8'))


@creation_routes.post('/teacher/creation/batch')
@teacher_required
def batch_save():
    try:
        items = json.loads(request.form.get('changes', ''))
    except (TypeError, json.JSONDecodeError):
        raise WorksheetError('批量保存参数格式不正确。')
    saved_count, active_count = creation.save_selection(request.form.get('activity_id', ''), items)
    flash(f'已保存 {saved_count} 件作品选择并发布，当前学生端展出 {active_count} 件作品。', 'success')
    return _analysis_redirect(request.form)


@creation_routes.post('/teacher/creation/publish')
@teacher_required
def publish():
    record_id = request.form.get('record_id', type=int)
    work_key = request.form.get('work_key')
    if record_id and work_key:
        creation.publish(record_id, work_key)
        flash('作品已发布，图词快照已固定。', 'success')
    else:
        count = creation.publish_activity(request.form.get('activity_id', ''))
        flash(f'已发布本任务展览，学生端当前展出 {count} 件作品。', 'success')
    return _analysis_redirect(request.form)


@creation_routes.post('/teacher/creation/withdraw')
@teacher_required
def withdraw():
    with connect() as db:
        db.execute('UPDATE gallery_entries SET active=0, staged=0 WHERE id=?', (request.form.get('id'),))
    return _analysis_redirect(request.form)


@creation_routes.post('/teacher/creation/tools')
@teacher_required
def configure():
    urls = {key: request.form.get(key, '').strip() for key in ('recognize', 'optimize', 'generate')}
    for value in urls.values():
        if urlsplit(value).scheme not in {'http', 'https'} or not urlsplit(value).netloc:
            raise WorksheetError('工具入口需要填写完整的http或https网址。')
    with connect() as db:
        db.execute("INSERT INTO settings VALUES('creation_tools',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(urls),))
    flash('外部工具入口已保存。', 'success')
    return _analysis_redirect(request.form, anchor='creation-tools')


@creation_routes.post('/api/creation/ai/<kind>')
def ai_start(kind):
    from .creation_ai import start
    return jsonify(job_id=start(require_student(),kind,request.get_json(silent=True))),202


@creation_routes.get('/api/creation/ai/jobs/<job_id>')
@creation_routes.get('/api/creation/ai/jobs/<job_id>/image')
def ai_result(job_id):
    from .creation_ai import result
    data=result(require_student(),job_id)
    image=data.pop('image',None)
    if request.path.endswith('/image'):
        if image is None:
            raise WorksheetError('短期图片已失效，请使用已保存在本机的作品。',404)
        from PIL import Image
        with Image.open(io.BytesIO(image)) as picture:
            mime=Image.MIME.get(picture.format,'image/png')
        response=send_file(io.BytesIO(image),mimetype=mime)
        response.headers['Cache-Control']='private, no-store'
        return response
    if image:
        data['image_url']=request.path+'/image'
    return jsonify(data)
