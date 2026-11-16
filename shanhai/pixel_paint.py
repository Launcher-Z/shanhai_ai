"""1.2／1.3像素画：独立本机绘画、已审首稿跨班观摩、主动提交无损附件。"""
import json
import re
import time
import uuid
from functools import lru_cache
from pathlib import Path

from flask import Blueprint, flash, jsonify, redirect, request, url_for
from PIL import Image

from .auth import teacher_required
from .creation import media_path, publish
from .database import connect
from .worksheet_routes import require_student
from .worksheets import WorksheetError, definition_for

ACTIVITY = 'lesson-1-task-2'
REDRAW_ACTIVITY = 'lesson-1-task-3'
WORK_KEYS = {ACTIVITY: 'first', REDRAW_ACTIVITY: 'second'}
SECTION_IDS = {ACTIVITY: 'first-design', REDRAW_ACTIVITY: 'second-design'}
pixel_paint = Blueprint('pixel_paint', __name__)


@lru_cache(maxsize=1)
def base_image():
    return json.loads((Path(__file__).resolve().parents[1] / 'static/learning/pixel-paint/panda.json').read_text(encoding='utf-8'))


def checked_edits(value):
    """按底图尺寸接收全画布改色，校验索引、颜色和重复格子。"""
    base = base_image()
    limit = base['width'] * base['height']
    if not isinstance(value, list) or len(value) > limit:
        raise WorksheetError('作品像素格式不正确，请重新提交。')
    seen, edits = set(), []
    for cell in value:
        if (not isinstance(cell, list) or len(cell) != 2 or type(cell[0]) is not int
                or not 0 <= cell[0] < limit or cell[0] in seen
                or not isinstance(cell[1], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', cell[1])):
            raise WorksheetError('作品像素超出画布或颜色格式不正确，请重新提交。')
        seen.add(cell[0])
        if cell[1].lower() != base['palette'][base['pixels'][cell[0]]]:
            edits.append((cell[0], cell[1].lower()))
    if not edits:
        raise WorksheetError('先给小熊猫画上礼帽，再提交作品。')
    return edits


def capture(student_id, payload):
    activity_id = payload.get('activity_id', ACTIVITY) if isinstance(payload, dict) else None
    if not isinstance(activity_id, str) or activity_id not in WORK_KEYS:
        raise WorksheetError('像素绘画活动不存在。')
    definition_for(activity_id, student_id=student_id)
    base = base_image()
    if not isinstance(payload, dict) or payload.get('base_id') != base['id']:
        raise WorksheetError('底图版本已变化，请刷新后再提交作品。')
    edits = checked_edits(payload.get('edits'))
    colors = [base['palette'][index] for index in base['pixels']]
    for index, color in edits:
        colors[index] = color
    image = Image.new('RGB', (base['width'], base['height']))
    image.putdata([tuple(bytes.fromhex(color[1:])) for color in colors])
    media_id = 'p_' + uuid.uuid4().hex
    full, thumb = media_path(media_id), media_path(media_id, True)
    full.parent.mkdir(parents=True, exist_ok=True)
    thumb.parent.mkdir(parents=True, exist_ok=True)
    # 整数倍最近邻与PNG保留每个像素的真实颜色，便于后续比较第一、二稿。
    full_size=(base['width']*10,base['height']*10)
    thumb_size=(base['width']*6,base['height']*6)
    try:
        image.resize(full_size, Image.Resampling.NEAREST).save(full, format='PNG', optimize=True)
        image.resize(thumb_size, Image.Resampling.NEAREST).save(thumb, format='PNG', optimize=True)
        with connect() as db:
            db.execute('INSERT INTO creation_media VALUES (?,?,?,?,?,?,?)',
                       (media_id, student_id, activity_id, *full_size, full.stat().st_size, int(time.time())))
    except Exception:
        full.unlink(missing_ok=True)
        thumb.unlink(missing_ok=True)
        raise
    return {'media_id': media_id, 'image_url': '/api/creation/media/' + media_id}


def validate_work(value, db, student_id, activity_id, required=False):
    if not value and not required:
        return
    try:
        data = json.loads(value)
    except (ValueError, TypeError):
        raise WorksheetError('作品记录格式不正确，请重新提交。')
    if (activity_id not in WORK_KEYS or not isinstance(data, dict) or data.get('schema_version') != 1
            or data.get('kind') != 'pixel' or set(data) - {'schema_version', 'kind', 'works'}):
        raise WorksheetError('像素作品记录格式不正确。')
    works = data.get('works', [])
    if not isinstance(works, list) or len(works) > 1 or (required and not works):
        raise WorksheetError('请提交当前作品。')
    for work in works:
        if not isinstance(work, dict) or set(work) - {'key', 'title', 'media_id'} or work.get('key') != WORK_KEYS[activity_id]:
            raise WorksheetError('作品编号或记录格式不正确。')
        title, media_id = work.get('title', ''), work.get('media_id', '')
        if not isinstance(title, str) or len(title) > 80 or (required and not title.strip()):
            raise WorksheetError('请为作品起一个名称，最多80字。')
        if not isinstance(media_id, str) or (required and not media_id):
            raise WorksheetError('请提交当前作品。')
        if media_id and (not media_id.startswith('p_') or not db.execute(
                'SELECT 1 FROM creation_media WHERE id=? AND student_id=? AND activity_id=?',
                (media_id, student_id, activity_id)).fetchone()):
            raise WorksheetError('作品不属于当前学生或活动，请重新提交。', 403)


def first_work(answers):
    """提取像素作品回答中的当前作品快照（1.2 或 1.3）。"""
    data = json.loads(answers or '{}')
    work = json.loads(data.get('pixel-work') or '{}').get('works', [])
    return work[0] if work else None


def approved_media(db, media_id, student_id):
    """跨班图片权限与观摩列表一致：仅开放当前已审核通过且已入选发布的1.2/1.3像素画。"""
    row = db.execute('''SELECT r.answers FROM gallery_entries g
      JOIN creation_media m ON m.id=g.media_id
      JOIN worksheet_records r ON r.id=g.record_id
      JOIN students viewer ON viewer.id=?
      WHERE g.media_id=? AND g.active=1 AND m.activity_id IN (?,?) AND r.status='completed' ''',
                     (student_id, media_id, ACTIVITY, REDRAW_ACTIVITY)).fetchone()
    work = first_work(row['answers']) if row else None
    return bool(work and work.get('media_id') == media_id)


def gallery_works(class_id=None, activity_id=ACTIVITY):
    """按全校与当前筛选班级聚合指定像素画活动（1.2 或 1.3）的作品及展项状态。"""
    if activity_id not in WORK_KEYS:
        raise WorksheetError('像素绘画活动不存在。')
    section_id = SECTION_IDS[activity_id]
    work_key = WORK_KEYS[activity_id]
    stats = {
        'scope_total': 0, 'scope_staged': 0, 'scope_pending': 0, 'scope_returned': 0,
        'scope_submitted': 0, 'total': 0, 'staged': 0, 'active': 0,
    }
    with connect() as db:
        rows = db.execute('''SELECT r.*,s.name,s.class_id,c.name class_name FROM worksheet_records r
          JOIN students s ON s.id=r.student_id JOIN classes c ON c.id=s.class_id
          WHERE r.activity_id=? ORDER BY r.updated_at DESC''', (activity_id,)).fetchall()
        entries = db.execute('''SELECT g.id,g.record_id,g.active,g.staged FROM gallery_entries g
          JOIN creation_media m ON m.id=g.media_id WHERE m.activity_id=? AND g.work_key=?''',
          (activity_id, work_key)).fetchall()
    entry_map = {row['record_id']: dict(row) for row in entries}
    works = []
    for row in rows:
        stages = json.loads(row['stage_states'])
        if not stages.get(section_id, {}).get('submitted'):
            continue
        work = first_work(row['answers'])
        if not work:
            continue
        q_reviews = json.loads(row['question_reviews']) if row['question_reviews'] else {}
        is_approved = row['status'] == 'completed'
        entry = entry_map.get(row['id'])
        is_included = bool(is_approved and entry and entry['active'])
        if is_approved:
            stats['total'] += 1
            if entry and entry['staged']:
                stats['staged'] += 1
            if entry and entry['active']:
                stats['active'] += 1
        in_scope = class_id is None or row['class_id'] == class_id
        if in_scope:
            stats['scope_submitted'] += 1
            if row['status'] == 'pending':
                stats['scope_pending'] += 1
            elif row['status'] == 'returned':
                stats['scope_returned'] += 1
            else:
                stats['scope_total'] += 1
                if is_included:
                    stats['scope_staged'] += 1
            works.append(dict(
                work,
                record_id=row['id'],
                work_key=work_key,
                revision=row['revision'],
                student_id=row['student_id'],
                student_name=row['name'],
                class_name=row['class_name'],
                question_id='pixel-work',
                status=row['status'],
                teacher_excellent=bool(row['teacher_excellent']),
                feedback=(q_reviews.get('pixel-work') or {}).get('feedback') or row['feedback'] or '',
                included=is_included,
                entry_id=entry['id'] if is_included else None,
            ))
    order = {'pending': 0, 'completed': 1, 'returned': 2}
    works.sort(key=lambda w: order.get(w['status'], 3))
    return {'works': works, 'stats': stats}


def teacher_works(class_id=None):
    """返回教师端 1.2 与 1.3 两个像素活动的作品列表与统计。"""
    return {aid: gallery_works(class_id, aid) for aid in (ACTIVITY, REDRAW_ACTIVITY)}


def save_selection(items, activity_id=ACTIVITY):
    """批量保存 1.2 或 1.3 像素画入选状态并立即同步发布到 1.3 跨班观摩区。"""
    if activity_id not in WORK_KEYS:
        raise WorksheetError('像素绘画活动不存在。')
    expected_key = WORK_KEYS[activity_id]
    if not isinstance(items, list) or not items:
        raise WorksheetError('没有需要保存的作品改动。')
    cleaned = []
    for item in items:
        if not isinstance(item, dict):
            raise WorksheetError('批量保存格式不正确。')
        record_id, included = item.get('record_id'), item.get('included')
        work_key = item.get('work_key', expected_key)
        if type(record_id) is not int or record_id <= 0 or work_key != expected_key or type(included) is not bool:
            raise WorksheetError('作品入选参数不正确。')
        cleaned.append((record_id, included))
    now = int(time.time())
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        for record_id, included in cleaned:
            if included:
                row = db.execute('SELECT * FROM worksheet_records WHERE id=? AND activity_id=?', (record_id, activity_id)).fetchone()
                work = first_work(row['answers']) if row and row['status'] == 'completed' else None
                if not row or row['status'] != 'completed' or not work or not work.get('media_id'):
                    raise WorksheetError('请先审核通过这份像素作品札记。')
                snapshot = {'key': expected_key, 'title': work.get('title') or '小熊猫礼帽', 'media_id': work['media_id']}
                db.execute('''INSERT INTO gallery_entries(id,record_id,student_id,work_key,media_id,snapshot,active,staged,created_at)
                  VALUES(?,?,?,?,?,?,1,1,?) ON CONFLICT(record_id,work_key) DO UPDATE SET
                  media_id=excluded.media_id,snapshot=excluded.snapshot,staged=1,active=1,
                  created_at=CASE WHEN gallery_entries.active=0 THEN excluded.created_at ELSE gallery_entries.created_at END''',
                  ('g_'+uuid.uuid4().hex, record_id, row['student_id'], expected_key, work['media_id'], json.dumps(snapshot, ensure_ascii=False), now))
            else:
                db.execute('UPDATE gallery_entries SET staged=0,active=0 WHERE record_id=? AND work_key=?', (record_id, expected_key))
        db.execute('''UPDATE gallery_entries
          SET active=staged, created_at=CASE WHEN staged=1 AND active=0 THEN ? ELSE created_at END
          WHERE active!=staged AND work_key=? AND media_id IN (SELECT id FROM creation_media WHERE activity_id=?)''',
          (now, expected_key, activity_id))
        active_count = db.execute('''SELECT COUNT(*) FROM gallery_entries g
          JOIN creation_media m ON m.id=g.media_id
          JOIN worksheet_records r ON r.id=g.record_id
          WHERE g.active=1 AND m.activity_id=? AND r.status='completed' ''', (activity_id,)).fetchone()[0]
    return len(cleaned), active_count


def _analysis_redirect(source=None, activity_id=None):
    source = source or {}
    act = activity_id or source.get('activity_id') or ACTIVITY
    if act not in WORK_KEYS:
        act = ACTIVITY
    return redirect(url_for(
        'teacher.dashboard', tab='analysis',
        class_id=source.get('class_id') or None,
        lesson_id=source.get('lesson_id') or None,
        open=act, _anchor=f'pixel-gallery-{act}',
    ))


@pixel_paint.errorhandler(WorksheetError)
def error(exc):
    if request.path.startswith('/api/'):
        return jsonify(error=str(exc)), exc.code
    flash(str(exc), 'error')
    return _analysis_redirect(request.form)


@pixel_paint.post('/api/pixel-paint/capture')
def capture_route():
    student_id = require_student()
    base=base_image()
    if request.content_length and request.content_length > base['width']*base['height']*24+1024:
        raise WorksheetError('作品像素数量超出范围。', 413)
    return jsonify(capture(student_id, request.get_json(silent=True)))


@pixel_paint.get('/api/pixel-paint/gallery')
def student_gallery():
    student_id = require_student()
    activity_id = request.args.get('activity_id') or ACTIVITY
    if activity_id not in WORK_KEYS:
        raise WorksheetError('像素绘画活动不存在。')
    with connect() as db:
        rows = db.execute('''SELECT g.media_id,g.snapshot,s.name,c.name class_name FROM gallery_entries g
          JOIN creation_media m ON m.id=g.media_id
          JOIN worksheet_records r ON r.id=g.record_id
          JOIN students s ON s.id=r.student_id JOIN classes c ON c.id=s.class_id
          WHERE g.active=1 AND m.activity_id=? AND r.status='completed' AND r.student_id!=?
          ORDER BY g.created_at DESC,g.id''', (activity_id, student_id)).fetchall()
    entries = []
    for row in rows:
        snap = json.loads(row['snapshot']) if row['snapshot'] else {}
        entries.append(dict(media_id=row['media_id'], title=snap.get('title', '小熊猫礼帽'),
                            author=row['name'], class_name=row['class_name']))
    return jsonify(activity_id=activity_id, entries=entries)


@pixel_paint.get('/api/pixel-paint/first-work')
def own_first_work():
    student_id = require_student()
    with connect() as db:
        row = db.execute('SELECT first_answers FROM worksheet_records WHERE student_id=? AND activity_id=?',
                         (student_id, ACTIVITY)).fetchone()
    # 用首次提交快照作对照，1.2被驳回后重新提交也不替换原稿。
    return jsonify(work=first_work(row['first_answers']) if row else None)


@pixel_paint.get('/teacher/pixel-paint')
@teacher_required
def teacher_gallery():
    class_id = request.args.get('class_id', type=int)
    return redirect(url_for('teacher.dashboard', tab='analysis',
                            class_id=class_id or None, lesson_id='lesson-1',
                            open=ACTIVITY, _anchor=f'pixel-gallery-{ACTIVITY}'))


@pixel_paint.post('/teacher/pixel-paint/batch')
@teacher_required
def batch_save():
    activity_id = request.form.get('activity_id') or ACTIVITY
    if activity_id not in WORK_KEYS:
        raise WorksheetError('像素绘画活动不存在。')
    try:
        items = json.loads(request.form.get('changes', ''))
    except (TypeError, json.JSONDecodeError):
        raise WorksheetError('批量保存参数格式不正确。')
    saved_count, active_count = save_selection(items, activity_id)
    flash(f'已保存 {saved_count} 件像素作品选择并发布，当前学生端展出 {active_count} 件作品。', 'success')
    return _analysis_redirect(request.form, activity_id=activity_id)


@pixel_paint.post('/teacher/pixel-paint/publish')
@teacher_required
def publish_work():
    record_id = request.form.get('record_id', type=int)
    activity_id = request.form.get('activity_id') or ACTIVITY
    if activity_id not in WORK_KEYS:
        raise WorksheetError('像素绘画活动不存在。')
    work_key = WORK_KEYS[activity_id]
    with connect() as db:
        row = db.execute('SELECT status FROM worksheet_records WHERE id=? AND activity_id=?', (record_id, activity_id)).fetchone()
    if not row or row['status'] != 'completed':
        raise WorksheetError('请先审核通过这份像素作品札记。')
    publish(record_id, work_key)
    flash('已选入像素作品展示。', 'success')
    return _analysis_redirect(request.form, activity_id=activity_id)


@pixel_paint.post('/teacher/pixel-paint/withdraw')
@teacher_required
def withdraw_work():
    activity_id = request.form.get('activity_id') or ACTIVITY
    if activity_id not in WORK_KEYS:
        raise WorksheetError('像素绘画活动不存在。')
    with connect() as db:
        db.execute('''UPDATE gallery_entries SET active=0,staged=0 WHERE id=? AND media_id IN
          (SELECT id FROM creation_media WHERE activity_id=?)''', (request.form.get('id'), activity_id))
    flash('已撤下像素作品。', 'success')
    return _analysis_redirect(request.form, activity_id=activity_id)
