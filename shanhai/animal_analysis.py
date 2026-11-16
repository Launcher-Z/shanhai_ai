"""2.2、3.2与4.1正式提交结果的汇总与来源；排除标记不修改学生札记或成绩。"""
import hashlib
import json
import math
import re
import time
from pathlib import Path
from .database import connect

ACTIVITY = 'lesson-2-task-2'
IMPROVEMENT = 'lesson-3-task-2'
BEASTS = 'lesson-4-task-1'
NAMES = ('金丝猴', '雪豹')
_ROOT = Path(__file__).resolve().parents[1] / 'static/learning/animal-classifier'
DATASET = json.loads((_ROOT / 'dataset.json').read_text(encoding='utf-8-sig'))
BEAST_DATASET = json.loads((_ROOT / 'beasts/dataset.json').read_text(encoding='utf-8-sig'))
SOURCES = [(f'image-{i}', f'图{i}', next(item['file'] for item in DATASET['testing'] if item['number'] == i)) for i in range(1, 10)] + [('camera', '摄像头', None)]
BEAST_SOURCES = [(f'image-{item["number"]}', item['name'], item['file']) for item in BEAST_DATASET['testing']]
_TWO_CLASS = {
    'question_id': 'animal-tests',
    'names': NAMES,
    'sources': SOURCES,
    'tolerance': 0.11,
    'named_columns': False,
}
CONFIGS = {
    ACTIVITY: _TWO_CLASS,
    IMPROVEMENT: _TWO_CLASS,
    BEASTS: {
        'question_id': 'beast-tests',
        'names': ('短尾猴', '果子狸', '穿山甲', '章鱼'),
        'sources': BEAST_SOURCES,
        'tolerance': 0.21,
        'named_columns': True,
    },
}
ACTIVITIES = set(CONFIGS)


def submitted_value(record, question_id='animal-tests'):
    """与现有札记分析一致，首答快照参与统计，未提交的草稿不混入。"""
    for section in record['definition']['sections']:
        if (record['stage_states'].get(section['id'], {}).get('submitted')
                and any(q['id'] == question_id for q in section['questions'])):
            first = json.loads(record['first_answers']) if record['first_answers'] else {}
            value = first.get(question_id)
            return value if isinstance(value, str) and value.strip() else None
    return None


def fingerprint(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def parse_sources(value, activity_id=ACTIVITY):
    """逐行保留原值；两类按动物名称对齐，四类异兽按固定列名读取。"""
    config = CONFIGS[activity_id]
    names_expected = config['names']
    pairs, duplicates = {}, set()
    for line in value.splitlines():
        key, separator, text = line.partition('：')
        if not separator:
            key, separator, text = line.partition(':')
        if separator:
            key = key.strip()
            if key in pairs:
                duplicates.add(key)
            pairs[key] = text.strip()
    if config['named_columns']:
        result = []
        for source_id, label, image_file in config['sources']:
            keys = [f'{label}·{name}' for name in names_expected]
            raw = [pairs.get(key, '') for key in keys]
            status, reason, normalized = 'valid', '', None
            if not any(raw):
                status, reason = 'missing', '未记录该来源'
            elif any(key in duplicates for key in keys):
                status, reason = 'invalid', '记录字段重复'
            else:
                try:
                    numbers = [float(item) for item in raw]
                    if not all(math.isfinite(number) and 0 <= number <= 100 for number in numbers):
                        raise ValueError
                    if abs(sum(numbers) - 100) > config['tolerance']:
                        status, reason = 'invalid', '四类比例合计不为100%'
                    else:
                        normalized = numbers
                except (ValueError, TypeError):
                    status, reason = 'invalid', '比例缺失或不是0—100之间的有限数值'
            result.append({'id': source_id, 'label': label, 'image_file': image_file,
                           'raw_names': list(names_expected), 'raw_values': raw, 'values': normalized,
                           'status': status, 'validation_reason': reason})
        return result
    names = [pairs.get(f'类别{c}名称', '') for c in (1, 2)]
    result = []
    for source_id, label, image_file in config['sources']:
        raw = [pairs.get(f'{label}·类别{c}', '') for c in (1, 2)]
        row_names = names[:]
        # 读取早期“图1（雪豹）：金丝猴 2.9% / 雪豹 97.1%”文字快照。
        if not any(raw) and source_id != 'camera':
            pattern = rf'^{label}(?:[（(].*?[）)])?[:：]\s*(.*?)\s+([\d.]+)%\s*/\s*(.*?)\s+([\d.]+)%\s*$'
            match = next((m for line in value.splitlines() if (m := re.match(pattern, line.strip()))), None)
            if match:
                row_names, raw = [match[1].strip(), match[3].strip()], [match[2], match[4]]
        status, reason, normalized = 'valid', '', None
        if not any(raw):
            status, reason = 'missing', '未记录该来源'
        elif any(key in duplicates for key in [f'类别{c}名称' for c in (1, 2)] + [f'{label}·类别{c}' for c in (1, 2)]):
            status, reason = 'invalid', '记录字段重复'
        elif set(re.sub(r'\s+', '', name) for name in row_names) != set(names_expected):
            status, reason = 'invalid', '类别名称不能明确对应金丝猴与雪豹'
        else:
            try:
                numbers = [float(item) for item in raw]
                if not all(math.isfinite(number) and 0 <= number <= 100 for number in numbers):
                    raise ValueError
                if abs(sum(numbers) - 100) > config['tolerance']:
                    status, reason = 'invalid', '两类比例合计不为100%'
                else:
                    mapping = dict(zip((re.sub(r'\s+', '', name) for name in row_names), numbers))
                    normalized = [mapping[name] for name in names_expected]
            except (ValueError, TypeError):
                status, reason = 'invalid', '比例缺失或不是0—100之间的有限数值'
        result.append({'id': source_id, 'label': label, 'image_file': image_file,
                       'raw_names': row_names, 'raw_values': raw, 'values': normalized,
                       'status': status, 'validation_reason': reason})
    return result


def build(scope, activity_id=ACTIVITY):
    config = CONFIGS[activity_id]
    students = {student['id']: student for student in scope['students']}
    with connect() as db:
        exclusions = {(row['record_id'], row['source_id'], row['fingerprint']): dict(row)
                      for row in db.execute('SELECT * FROM animal_analysis_exclusions')}
    rows = [{'id': key, 'label': label, 'image_file': image_file, 'sources': []} for key, label, image_file in config['sources']]
    submitted = 0
    for record in scope['records'].values():
        if record['activity_id'] != activity_id or record['student_id'] not in students:
            continue
        value = submitted_value(record, config['question_id'])
        if value is None:
            continue
        submitted += 1
        student, digest = students[record['student_id']], fingerprint(value)
        for group, source in zip(rows, parse_sources(value, activity_id)):
            excluded = exclusions.get((record['id'], source['id'], digest))
            group['sources'].append({**source, 'record_id': record['id'], 'student_id': student['id'],
                'student_name': student['name'], 'class_name': student['class_name'],
                'version': record['definition']['version'], 'fingerprint': digest,
                'excluded': bool(excluded), 'exclusion_reason': excluded['reason'] if excluded else ''})
    class_count = len(config['names'])
    for row in rows:
        valid = [item for item in row['sources'] if item['status'] == 'valid' and not item['excluded']]
        row.update(count=len(valid), excluded_count=sum(item['excluded'] for item in row['sources']),
                   invalid_count=sum(item['status'] == 'invalid' and not item['excluded'] for item in row['sources']),
                   missing_count=sum(item['status'] == 'missing' for item in row['sources']),
                   means=[round(sum(item['values'][c] for item in valid) / len(valid), 2) for c in range(class_count)] if valid else None)
    return {'rows': rows, 'submitted': submitted, 'student_count': len(students), 'names': list(config['names'])}


def student_summary(scope, activity_id=ACTIVITY):
    """学生端只下发本班汇总白名单，不能传出来源姓名、札记或操作指纹。"""
    data = build(scope, activity_id)
    public_keys = ('id', 'label', 'image_file', 'means', 'count', 'excluded_count', 'invalid_count', 'missing_count')
    return {'names': data['names'], 'submitted': data['submitted'], 'student_count': data['student_count'],
            'rows': [{key: row[key] for key in public_keys} for row in data['rows']]}


def set_exclusion(scope, payload):
    """教师仅能操作当前范围的提交行，来源指纹阻止误操作过期记录。"""
    from .worksheets import WorksheetError
    if not isinstance(payload, dict) or type(payload.get('record_id')) is not int or type(payload.get('excluded')) is not bool:
        raise WorksheetError('操作参数不正确。')
    activity_id = payload.get('activity_id', ACTIVITY)
    if activity_id not in ACTIVITIES:
        raise WorksheetError('活动不存在。', 404)
    config = CONFIGS[activity_id]
    if not isinstance(payload.get('source_id'), str) or payload['source_id'] not in {key for key, _, _ in config['sources']}:
        raise WorksheetError('数据来源不存在。', 404)
    reason = payload.get('reason', '')
    if not isinstance(reason, str) or len(reason) > 200:
        raise WorksheetError('排除原因最多200字。')
    record = next((r for r in scope['records'].values() if r['id'] == payload['record_id'] and r['activity_id'] == activity_id), None)
    value = submitted_value(record, config['question_id']) if record else None
    if value is None:
        raise WorksheetError('当前班级范围内没有这份已提交记录。', 404)
    digest = fingerprint(value)
    if payload.get('fingerprint') != digest:
        raise WorksheetError('来源记录已变化，请刷新后再操作。', 409)
    source = next(item for item in parse_sources(value, activity_id) if item['id'] == payload['source_id'])
    if source['status'] == 'missing':
        raise WorksheetError('该行没有填写数据，无需排除。')
    with connect() as db:
        if payload['excluded']:
            db.execute('INSERT INTO animal_analysis_exclusions(record_id,source_id,fingerprint,reason,created_at) VALUES(?,?,?,?,?) '
                       'ON CONFLICT(record_id,source_id,fingerprint) DO UPDATE SET reason=excluded.reason',
                       (record['id'], source['id'], digest, reason.strip(), int(time.time())))
        else:
            db.execute('DELETE FROM animal_analysis_exclusions WHERE record_id=? AND source_id=? AND fingerprint=?',
                       (record['id'], source['id'], digest))


def training_gallery(scope):
    """仅供教师分析：完整展示当前班级范围内正式首答的训练附件。"""
    students = {student['id']: student for student in scope['students']}
    groups = {name: [] for name in NAMES}
    for record in scope['records'].values():
        if record['activity_id'] != IMPROVEMENT or record['student_id'] not in students:
            continue
        submitted = any(record['stage_states'].get(section['id'], {}).get('submitted')
                        and any(q['id'] == 'training-evidence' for q in section['questions'])
                        for section in record['definition']['sections'])
        if not submitted:
            continue
        first = json.loads(record['first_answers'] or '{}')
        try:
            evidence = json.loads(first.get('training-evidence', ''))
        except (ValueError, TypeError):
            continue
        if not isinstance(evidence, dict):
            continue
        student = students[record['student_id']]
        for sample in evidence.get('samples', []):
            if sample.get('category') not in groups:
                continue
            groups[sample['category']].append({**sample, 'student_id': student['id'],
                'student_name': student['name'], 'class_name': student['class_name'],
                'round': evidence.get('round'), 'note': evidence.get('note', '')})
    return [{'name': name, 'samples': samples} for name, samples in groups.items()]


def comparison(scope):
    """每张图按同一批学生配对，任一轮无效或被排除均不参与两轮均值。"""
    before, after = build(scope), build(scope, IMPROVEMENT)
    rows = []
    for old, new in zip(before['rows'], after['rows']):
        eligible = lambda group: {s['student_id']: s for s in group['sources']
                                 if s['status'] == 'valid' and not s['excluded']}
        left, right = eligible(old), eligible(new)
        paired = left.keys() & right.keys()
        def means(items):
            return [round(sum(items[s]['values'][c] for s in paired) / len(paired), 2)
                    for c in (0, 1)] if paired else None
        rows.append({'id': old['id'], 'label': old['label'], 'image_file': old['image_file'],
                     'count': len(paired), 'before': means(left), 'after': means(right),
                     # 尚无配对时仍可回看2.2；明确与严格配对均值分开。
                     'baseline_before': old['means'], 'baseline_count': old['count']})
    return {'names': list(NAMES), 'rows': rows, 'student_count': before['student_count'],
            'before_submitted': before['submitted'], 'after_submitted': after['submitted']}
