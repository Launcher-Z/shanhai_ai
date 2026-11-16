"""3.2主动提交的训练图片证据；仅复用私有附件，不加入作品展。"""
import json
from .worksheets import WorksheetError


def validate(value, db, student_id, activity_id, required=False):
    if activity_id != 'lesson-3-task-2':
        raise WorksheetError('训练附件不适用于此活动。')
    if not value and not required:
        return
    try:
        data = json.loads(value)
    except (ValueError, TypeError):
        raise WorksheetError('请确认本次训练使用的图片。')
    if not isinstance(data, dict) or set(data) - {'schema_version', 'round', 'samples', 'extra_count', 'note'} or data.get('schema_version') != 1:
        raise WorksheetError('训练附件格式无效。')
    count, samples = data.get('extra_count'), data.get('samples')
    if type(count) is not int or not 0 <= count <= 80 or not isinstance(samples, list) or len(samples) > count:
        raise WorksheetError('训练图片数量无效。')
    if type(data.get('round')) is not int or data['round'] < 1:
        raise WorksheetError('请先完成正规实验的训练，再确认附件。')
    if not isinstance(data.get('note', ''), str) or len(data.get('note', '')) > 2000:
        raise WorksheetError('图片处理说明最多2000字。')
    ids = set()
    for sample in samples:
        if not isinstance(sample, dict) or set(sample) != {'media_id', 'name', 'category'}:
            raise WorksheetError('训练图片说明无效。')
        media_id = sample['media_id']
        if not isinstance(media_id, str) or media_id in ids or sample['category'] not in {'金丝猴', '雪豹'} or not isinstance(sample['name'], str) or len(sample['name']) > 200:
            raise WorksheetError('训练图片的类别或名称无效。')
        ids.add(media_id)
        media = db.execute('SELECT student_id,activity_id FROM creation_media WHERE id=?', (media_id,)).fetchone()
        if not media or media['student_id'] != student_id or media['activity_id'] != activity_id:
            raise WorksheetError('不能引用其他学生或活动的图片。', 403)
    if any(sum(s['category'] == category for s in samples) > 40 for category in ('金丝猴', '雪豹')):
        raise WorksheetError('每个类别最多40张训练图片。')
    if required and len(samples) != count:
        raise WorksheetError('请先上传本轮额外使用的全部训练图片。')
