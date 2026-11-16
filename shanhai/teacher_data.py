"""教师工作台与札记分析；只读取学习事实，不另存一套统计状态。"""
import json
import re
import time
from collections import Counter, defaultdict
from copy import deepcopy

from . import neural_analysis, worksheets
from .courses import COURSE_VOLUMES
from .database import connect

def structured_answer(value, q):
    """教学表格使用同一展示入口，教师端无需阅读序列化原文。"""
    table = q.get('record_table', {})
    if table.get('kind') == 'animal_predictions' and table.get('columns') and value:
        # 固定四类表按题目快照还原，避免套用2.2的九图布局。
        values = dict(line.split('：', 1) for line in str(value).splitlines() if '：' in line)
        labels = {field['key']: field['label'] for field in table['fields']}
        rows = []
        for row in table['rows']:
            cells = [{'text': f"图{row['number']}·{row['label']}", 'tone': ''}]
            for c in range(1, len(table['columns']) + 1):
                number = values.get(labels[f"{row['key']}-class-{c}"], '')
                cells.append({'text': number + '%' if number else '—', 'tone': ''})
            rows.append(cells)
        return {'headers': ['测试图片', *table['columns']], 'rows': rows}
    if q.get('record_table', {}).get('kind') == 'knn_votes':
        values = dict(line.split('：', 1) for line in str(value or '').splitlines() if '：' in line)
        if not values:
            return None
        return {'headers': ['K', '金丝猴邻居数', '雪豹邻居数'], 'rows': [
            [{'text': str(k), 'tone': ''}, *[{'text': values.get(f'K={k}·{name}', '') or '—', 'tone': ''}
                                          for name in ('金丝猴', '雪豹')]] for k in (1, 3, 5, 7, 9)]}
    return neural_analysis.structured_answer(value, q)


def percent(value, total):
    return round(value / total * 100, 1) if total else None


_CATALOG_CACHE = {}


def catalog():
    """只把已有札记纳入统计，尚未开发的活动不进入完成率分母。"""
    cache_key = str(worksheets.WORKSHEET_DIR)
    if cache_key in _CATALOG_CACHE:
        return _CATALOG_CACHE[cache_key]
    lessons = []
    for volume in COURSE_VOLUMES:
        for lesson in volume["lessons"]:
            activities = []
            for activity in lesson["activities"]:
                path = worksheets.WORKSHEET_DIR / f"{activity['id']}.json"
                if path.is_file():
                    definition = json.loads(path.read_text(encoding="utf-8"))
                    worksheets.validate_definition(definition, activity["id"])
                    activities.append({**activity, "definition": definition})
            if activities:
                lessons.append({**lesson, "volume": volume["title"], "volume_id": volume["id"],
                                "volume_number": volume["number"], "activities": activities})
    _CATALOG_CACHE[cache_key] = lessons
    return lessons


def _prepare_record(record):
    """一次性缓存单条作答记录的常用派生字段，避免后续统计和逐题分析重复解析。"""
    if "_progress" not in record:
        record["_progress"] = worksheets.progress(record)
    if "_first_answers" not in record:
        record["_first_answers"] = json.loads(record["first_answers"]) if record["first_answers"] else {}
    if "_has_pending" not in record:
        record["_has_pending"] = record["status"] == "pending" or bool(worksheets._pending_reviewable_ids(record))
    return record


def load_scope(class_id=None):
    """班级名单和札记各查询一次；不向浏览器发送设备凭据。"""
    condition = " WHERE s.class_id=?" if class_id is not None else ""
    params = (class_id,) if class_id is not None else ()
    with connect() as db:
        students = [dict(row) for row in db.execute(
            "SELECT s.id, s.name, s.class_id, c.name AS class_name, "
            "(s.device_token IS NOT NULL AND s.locked_until>?) AS bound "
            "FROM students s JOIN classes c ON c.id=s.class_id" + condition +
            " ORDER BY c.id DESC, s.id", (int(time.time()), *params))]
        records = [_prepare_record(worksheets.sync_live_answers(db, worksheets.decode(row))) for row in db.execute(
            "SELECT w.* FROM worksheet_records w JOIN students s ON s.id=w.student_id" + condition,
            params)]
    indexed = {(r["student_id"], r["activity_id"]): r for r in records}
    by_student = defaultdict(list)
    for r in records:
        by_student[r["student_id"]].append(r)
    lessons = catalog()
    # 选做仍出现在矩阵与逐题分析中，但不进入全班基础完成率的分母。
    activity_ids = {a["id"] for lesson in lessons for a in lesson["activities"] if not a.get("optional")}
    for student in students:
        all_own = by_student.get(student["id"], ())
        own = [r for r in all_own if r["activity_id"] in activity_ids]
        states = [r["_progress"] for r in own]
        student.update(pending=sum(r["_has_pending"] for r in all_own),
                       completed=sum(s["completed"] for s in states),
                       excellent=sum(s["excellent"] for s in states))
    return {"students": students, "records": indexed, "lessons": lessons,
            "summary": summarize(students, records, activity_ids)}


def summarize(students, records, activity_ids):
    all_pending = sum((r["_has_pending"] if "_has_pending" in r else (r["status"] == "pending" or bool(worksheets._pending_reviewable_ids(r)))) for r in records)
    records = [r for r in records if r["activity_id"] in activity_ids]
    states = [r.get("_progress") or worksheets.progress(r) for r in records]
    first_correct = first_total = 0
    for record in records:
        first = record["_first_answers"] if "_first_answers" in record else (json.loads(record["first_answers"]) if record["first_answers"] else {})
        for q in worksheets.objective_questions(record["definition"]):
            if q["id"] in first:
                first_total += 1
                first_correct += worksheets.answer_correct(q, first[q["id"]])
    return {"students": len(students), "bound": sum(s["bound"] for s in students),
            "expected": len(students) * len(activity_ids), "started": len(records),
            "submitted": sum(bool(r["first_answers"]) for r in records),
            "fully_submitted": sum(all(sec["submitted"] for sec in s["flow"]["sections"]
                                       if not sec["optional"]) for s in states),
            "pending": all_pending,
            "correction": sum(any(s["status"] == "correction" for s in r["stage_states"].values()) for r in records),
            "returned": sum(r["status"] == "returned" for r in records),
            "completed": sum(s["completed"] for s in states),
            "excellent": sum(s["excellent"] for s in states),
            "first_total": first_total, "first_correct": first_correct,
            "first_rate": percent(first_correct, first_total)}


def _section_cell(record, activity_id, section, activity_title, code):
    if not record:
        return {
            "activity_id": activity_id, "section_id": section["id"], "section_title": section["title"],
            "code": code, "title": activity_title, "record_id": None,
            "status": "unstarted", "matrix_state": "red", "ring": "red", "label": "未填写",
        }
    sec_state = record["stage_states"].get(section["id"])
    sec_status = sec_state["status"] if sec_state else "unstarted"
    if sec_status == "pending":
        matrix_state, ring, label = "pending", "red", "待教师审核"
    elif sec_status == "completed":
        rec_sec = next((s for s in record["definition"]["sections"] if s["id"] == section["id"]), section)
        obj_total = sum(1 for q in rec_sec["questions"] if q["type"] != "text")
        if obj_total:
            excellent = (sec_state.get("first_correct", 0) * 100) >= (obj_total * 85)
        else:
            excellent = bool(record.get("teacher_excellent"))
        if excellent:
            matrix_state, ring, label = "gold", "gold", "优秀"
        else:
            matrix_state, ring, label = "green", "green", "已完成"
    else:
        matrix_state = "red"
        ring = "red"
        label = worksheets.STATUS_LABELS.get(sec_status, "未填写")
    return {
        "activity_id": activity_id, "section_id": section["id"], "section_title": section["title"],
        "code": code, "title": activity_title, "record_id": record["id"],
        "status": sec_status, "matrix_state": matrix_state, "ring": ring, "label": label,
    }


def matrix(scope):
    rows = []
    for student in scope["students"]:
        cells = []
        for lesson in scope["lessons"]:
            for activity in lesson["activities"]:
                record = scope["records"].get((student["id"], activity["id"]))
                for idx, section in enumerate(activity["definition"]["sections"], 1):
                    cells.append(_section_cell(record, activity["id"], section, activity["title"], f"T{idx}"))
        rows.append({**student, "cells": cells})
    return rows


def overview_columns(scope, rows):
    columns = []
    col_index = 0
    for lesson in scope["lessons"]:
        for activity in lesson["activities"]:
            for idx, section in enumerate(activity["definition"]["sections"], 1):
                states = [row["cells"][col_index]["matrix_state"] for row in rows]
                gold = sum(s == "gold" for s in states)
                green = sum(s == "green" for s in states)
                pending = sum(s == "pending" for s in states)
                incomplete = sum(s == "red" for s in states)
                columns.append({
                    "activity_id": activity["id"], "activity_title": activity["title"],
                    "section_id": section["id"], "section_title": section["title"],
                    "code": f"T{idx}", "optional": bool(section.get("optional")),
                    "total": len(states), "gold": gold, "green": green,
                    "done": gold + green, "pending": pending, "incomplete": incomplete,
                })
                col_index += 1
    return columns


def workspace(student_id, activity_id=None):
    """学生切换时只返回这一名学生的详细札记。"""
    with connect() as db:
        student = db.execute(
            "SELECT s.id, s.name, s.class_id, c.name AS class_name, "
            "(s.device_token IS NOT NULL AND s.locked_until>?) AS bound "
            "FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=?",
            (int(time.time()), student_id)).fetchone()
        if not student:
            return None
        records = [worksheets.sync_live_answers(db, worksheets.decode(row)) for row in db.execute(
            "SELECT * FROM worksheet_records WHERE student_id=? ORDER BY activity_id", (student_id,))]
    for record in records:
        record["progress"] = worksheets.progress(record)
        record["has_objectives"] = bool(worksheets.objective_questions(record["definition"]))
        record["pending_review_count"] = len(worksheets._pending_reviewable_ids(record)) if record["status"] in {"pending", "in_progress", "correction", "returned"} else 0
        record["needs_review"] = record["status"] == "pending" or record["pending_review_count"] > 0
    selected = next((r for r in records if r["activity_id"] == activity_id), None)
    if not selected and activity_id is None:
        selected = next((r for r in records if r["needs_review"]), records[0] if records else None)
    current_id = selected["activity_id"] if selected else activity_id
    next_pending = next((r for r in records if r["needs_review"] and r["activity_id"] != current_id), None)
    lessons = catalog()
    by_activity = {r["activity_id"]: r for r in records}
    lesson_nav = []
    for lesson in lessons:
        activities_nav = []
        lesson_span = 0
        lesson_pending = 0
        for activity in lesson["activities"]:
            rec = by_activity.get(activity["id"])
            sections_nav = []
            for idx, section in enumerate(activity["definition"]["sections"], 1):
                cell = _section_cell(rec, activity["id"], section, activity["title"], f"T{idx}")
                cell["optional"] = bool(section.get("optional"))
                sections_nav.append(cell)
            prog = rec["progress"] if rec else worksheets.progress(None, activity["id"])
            is_pending = bool(rec and rec["needs_review"])
            if is_pending:
                lesson_pending += 1
            lesson_span += len(sections_nav)
            activities_nav.append({
                "id": activity["id"],
                "title": activity["title"],
                "sections": sections_nav,
                "colspan": len(sections_nav),
                "progress": prog,
                "is_pending": is_pending,
                "started": bool(rec),
            })
        lesson_nav.append({
            "number": lesson["number"],
            "title": lesson["title"],
            "colspan": lesson_span,
            "pending": lesson_pending,
            "activities": activities_nav,
        })
    selected_activity = next((a for lesson in lessons for a in lesson["activities"] if a["id"] == activity_id), None)
    review_progress = None
    if selected and selected["status"] in {"pending", "in_progress", "correction", "returned"}:
        pending_ids = worksheets._pending_reviewable_ids(selected)
        if pending_ids:
            q_reviews = selected.get("question_reviews") or {}
            done_ids = [qid for qid in pending_ids if qid in q_reviews]
            review_progress = {
                "total": len(pending_ids),
                "done": len(done_ids),
                "remaining": len(pending_ids) - len(done_ids),
                "has_returned": any(q_reviews[qid]["status"] == "returned" for qid in done_ids),
            }
    pending_tasks = [{
        "activity_id": r["activity_id"],
        "title": r["definition"]["title"].replace(" · 学习札记", ""),
        "count": r["pending_review_count"],
        "is_current": r["activity_id"] == current_id,
    } for r in records if r["needs_review"]]
    return {"student": dict(student), "student_records": records, "record": selected,
            "next_pending": next_pending, "selected_activity": selected_activity,
            "lesson_nav": lesson_nav, "review_progress": review_progress,
            "pending_tasks": pending_tasks}


def display_answer(q, value):
    if q.get('decision_tree'):
        from .classification import tree_summary
        return tree_summary(value)
    if q.get('knn_captures'):
        from .classification import knn_captures_summary
        return knn_captures_summary(value)
    if q.get('record_form') and value:
        from .creation import record_data
        data = record_data(value)
        lines = []
        for row in data.get('observations', []):
            lines.append(f"{row.get('image_id')}：观察 {row.get('features','')}；AI {row.get('ai_answer','')}；核对 {row.get('verification','')}")
        for work in data.get('works', []):
            lines.append(f"作品：{work.get('title','')}\n提示词：{work.get('prompt','')}\n图片：/api/creation/media/{work.get('media_id','')}")
            ai = work.get('ai_optimization', {})
            if ai.get('used'):
                lines.append(f"原稿：{ai.get('original_prompt','')}\nAI建议：{ai.get('suggested_prompt','')}")
        labels = {'met':'符合','partial':'部分符合','unmet':'不符合'}
        for key, label in [('evaluation','原文评价'), ('ai_review','AI复盘')]:
            values = data.get(key) or {}
            names = {'accuracy':'原文特征','spirit':'神韵氛围','expression':'画面表达',
                     'feature_keep':'动物特征保留','magical_detail':'神异细节可见','visual_harmony':'画面与风格协调',
                     'errors':'遗漏／错误','detail':'细节','change_and_choice':'变化与取舍','expectation':'预期','actual_result':'实际效果','match':'符合预期','next_adjustment':'下次调整'}
            lines.extend(f"{label}·{names[k]}：{str(v)+'/5分' if type(v) is int else labels.get(v,v) if isinstance(v,str) else '、'.join(v)}" for k,v in values.items() if k in names)
        for fav in data.get('favorites', []):
            who = f"{fav.get('source', '个人笔记')}（{fav['author']}）" if fav.get('author') else fav.get('source', '个人笔记')
            lines.append(f"[{who}] {fav.get('content', '')}")
        return '\n'.join(lines) or '未填写'
    if value is None or value == "" or value == []:
        return "未填写"
    if q["type"] in {"single", "multiple"}:
        values = value if q["type"] == "multiple" else [value]
        labels = {o["value"]: o["label"] for o in q["options"]}
        return "；".join(labels.get(v, str(v)) for v in values)
    return str(value)


def preview_payload(q, value):
    """为主观题与作品上传题构造浮层预览所需的精简文字和缩略图列表。"""
    if q.get('decision_tree'):
        return {'text': display_answer(q, value), 'images': [], 'has_content': bool(value)}
    if q.get('knn_captures'):
        from .classification import knn_captures_data, knn_captures_summary
        items = knn_captures_data(value)
        if not items:
            return {'text': '', 'images': [], 'has_content': False}
        images = [{
            'kind': 'knn_capture',
            'beast': item['beast'],
            'target': item['target'],
            'k': item['k'],
            'samples': [{'x': p['x'], 'y': p['y'], 'type': p['type']} for p in item['samples']],
            'neighbor_keys': [f"{p['x']},{p['y']},{p['type']}" for p in item['neighbors']],
            'radius': item['radius'],
            'caption': f"{item['beast']} ({item['target']['x']},{item['target']['y']}) K={item['k']}→{item['result_label']}",
        } for item in items if item.get('captured')]
        return {'text': knn_captures_summary(value), 'images': images, 'has_content': bool(images)}
    if q.get("id") == "handwriting-record" and value:
        items = neural_analysis.parse_handwriting_records(value)
        if items:
            ctx = q.get("handwriting_context") if isinstance(q.get("handwriting_context"), dict) else {}
            lines = []
            images = []
            for item in items:
                actual_txt = str(item["actual"]) if item["actual"] is not None else "—"
                p1_txt = f"{item['first_digit']}（{item['first_prob']:.1f}%）" if item["first_digit"] is not None and item["first_prob"] is not None else "—"
                p2_txt = f"{item['second_digit']}（{item['second_prob']:.1f}%）" if item["second_digit"] is not None and item["second_prob"] is not None else "—"
                verdict = "首位命中" if item["first_hit"] else ("第二候选命中" if item["top2_hit"] else "未命中")
                slot_ctx = ctx.get(str(item["slot"]))
                bits = slot_ctx.get("pixels") if isinstance(slot_ctx, dict) else ""
                if isinstance(bits, str) and len(bits) == 216 and set(bits) <= {"0", "1"}:
                    images.append({
                        "bits": bits,
                        "alt": f"记录{item['slot']}手写数字（实际 {actual_txt}）",
                        "caption": f"写{actual_txt}→{item['first_digit'] if item['first_digit'] is not None else '—'}",
                        "pixelated": True,
                    })
                lines.append(f"#{item['source_id'] if item['source_id'] is not None else item['slot']} 写{actual_txt}（{item['steps'] if item['steps'] is not None else '—'}次）→ {p1_txt} / {p2_txt} · {verdict}")
            return {"text": "\n".join(lines), "images": images[:3], "has_content": True}
    if q.get('record_form') == 'training_evidence' and value:
        from .creation import record_data
        data = record_data(value)
        return {'text': f"第{data.get('round', '—')}轮 · 额外训练图{data.get('extra_count', 0)}张\n{data.get('note', '')}",
                'images': [{'src': '/api/creation/media/' + s['media_id'] + '/thumbnail', 'alt': s['name'], 'caption': s['category']}
                           for s in data.get('samples', [])[:3]], 'has_content': True}
    if q.get("record_form"):
        if not value:
            return {"text": "", "images": [], "has_content": False}
        from .creation import BEASTS, record_data
        data = record_data(value)
        if not data:
            return {"text": "", "images": [], "has_content": False}
        is_pixel = data.get("kind") == "pixel"
        lines = []
        images = []
        for row in data.get("observations", []):
            parts = [p for p in (
                f"观察：{row['features']}" if row.get("features") else "",
                f"AI：{row['ai_answer']}" if row.get("ai_answer") else "",
                f"核对：{row['verification']}" if row.get("verification") else "",
            ) if p]
            if parts:
                lines.append(f"{row.get('image_id', '')}：{'；'.join(parts)}")
        for work in data.get("works", []):
            title = work.get("title") or "学生作品"
            mid = work.get("media_id")
            if mid:
                images.append({
                    "src": f"/api/creation/media/{mid}/thumbnail",
                    "alt": title,
                    "pixelated": is_pixel,
                })
            if work.get("prompt"):
                lines.append(f"{title}：{work['prompt']}")
            elif is_pixel and title:
                lines.append(f"作品：{title}")
        labels = {"met": "符合", "partial": "部分符合", "unmet": "不符合"}
        names = {
            "accuracy": "原文特征", "spirit": "神韵氛围", "expression": "画面表达",
            "feature_keep": "动物特征保留", "magical_detail": "神异细节可见",
            "visual_harmony": "画面与风格协调", "errors": "遗漏/错误", "detail": "补充说明",
            "change_and_choice": "变化与取舍", "expectation": "预期",
            "actual_result": "实际效果", "match": "符合预期", "next_adjustment": "下次调整",
        }
        if data.get("media_id") and not images:
            beast = next((b for b in BEASTS if b["id"] == data.get("beast_id")), None)
            alt = (beast or {}).get("name") or data.get("animal_name") or "评分对应作品"
            images.append({"src": f"/api/creation/media/{data['media_id']}/thumbnail", "alt": alt, "pixelated": False})
        for key, label in (("evaluation", "自评"), ("ai_review", "AI复盘")):
            values = data.get(key) or {}
            for k, v in values.items():
                if k not in names or v in (None, "", []):
                    continue
                rendered = f"{v}/5分" if type(v) is int else (labels.get(v, v) if isinstance(v, str) else "、".join(v))
                lines.append(f"{label}·{names[k]}：{rendered}")
        for fav in data.get("favorites", []):
            who = f"{fav.get('source', '个人笔记')}（{fav['author']}）" if fav.get("author") else fav.get("source", "个人笔记")
            if fav.get("content"):
                lines.append(f"[{who}] {fav['content']}")
        text = "\n".join(lines).strip()
        return {"text": text, "images": images[:3], "has_content": bool(text or images)}
    if value is None or value == "" or value == []:
        return {"text": "", "images": [], "has_content": False}
    text = str(value).strip()
    return {"text": text, "images": [], "has_content": bool(text)}


def _objective_cells(answers, eligible_students):
    by_student = {a["student"]["id"]: a for a in answers}
    roster = eligible_students if eligible_students is not None else [a["student"] for a in answers]
    cells = []
    for student in roster:
        a = by_student.get(student["id"])
        if not a:
            cells.append({
                "student_id": student["id"], "student_name": student["name"], "class_name": student["class_name"],
                "state": "unanswered", "state_label": "未回答",
                "correction_state": "unanswered", "correction_state_label": "未回答",
                "first": None, "corrected": False, "correction": None, "correction_correct": None, "status": None,
            })
            continue
        if a["correct"]:
            corr_state, corr_label = "correct", "首答正确（无需订正）"
        elif a["corrected"] and a["correction_correct"]:
            corr_state, corr_label = "correct", "已自主订正 · 正确"
        elif a["corrected"]:
            corr_state, corr_label = "wrong", "已自主订正 · 仍有错误"
        else:
            corr_state, corr_label = "wrong", "首答错误 · 尚未订正"
        cells.append({
            "student_id": student["id"], "student_name": student["name"], "class_name": student["class_name"],
            "state": "correct" if a["correct"] else "wrong",
            "state_label": "首答正确" if a["correct"] else "首答错误",
            "correction_state": corr_state, "correction_state_label": corr_label,
            "first": a["first"], "corrected": a["corrected"],
            "correction": a["correction"], "correction_correct": a["correction_correct"], "status": a["status"],
        })
    return cells


_WORD_CLOUD_STOPWORDS = frozenset({
    "的", "了", "和", "是", "我", "在", "有", "就", "也", "都", "很", "把", "给",
    "这", "那", "它", "他", "她", "会", "能", "可以", "因为", "所以", "如果", "但是",
    "而且", "或者", "一个", "一些", "没有", "不是", "还是", "以及", "觉得", "感觉",
    "认为", "通过", "进行", "使用", "出来", "起来", "看到", "发现", "比较", "非常",
    "更加", "不同", "相同", "一样", "主要", "可能", "应该", "需要", "这样", "那样",
    "这个", "那个", "它们", "自己", "时候", "什么", "怎么", "为什么",
})
_WORD_RE = re.compile(r"^[A-Za-z0-9\u4e00-\u9fff]+$")


def text_word_cloud(cells, max_words=40):
    """基于 jieba 对纯文本主观题作答做词频统计，并记录提到该词的学生 ID 便于联动筛选。"""
    import jieba
    counts = Counter()
    student_map = {}
    for cell in cells:
        text = (cell.get("preview_text") or "").strip()
        if not text or cell.get("state") == "unanswered":
            continue
        seen_in_student = set()
        for token in jieba.cut(text):
            word = token.strip()
            if not word or word.isdigit() or not _WORD_RE.match(word):
                continue
            if len(word) == 1 and ord(word) > 127:
                continue
            lowered = word.lower()
            if word in _WORD_CLOUD_STOPWORDS or lowered in _WORD_CLOUD_STOPWORDS:
                continue
            counts[word] += 1
            if word not in seen_in_student:
                seen_in_student.add(word)
                student_map.setdefault(word, []).append(cell["student_id"])
    if not counts:
        return []
    top = counts.most_common(max_words)
    hi = top[0][1]
    lo = top[-1][1]
    span = max(hi - lo, 1)
    return [
        {
            "word": word,
            "count": count,
            "students": student_map[word],
            "weight": 5 if hi == lo else 1 + round((count - lo) / span * 4),
        }
        for word, count in top
    ]


def _subjective_cells(q, section, records, eligible_students):
    by_student = {r["student_id"]: r for r in records}
    roster = eligible_students if eligible_students is not None else []
    needs_review = q.get("review", True)
    cells = []
    for student in roster:
        record = by_student.get(student["id"])
        sec_info = record["stage_states"].get(section["id"], {}) if record else {}
        submitted = bool(record and sec_info.get("submitted"))
        first_map = (record["_first_answers"] if "_first_answers" in record else (json.loads(record["first_answers"]) if record["first_answers"] else {})) if record else {}
        raw_value = record["answers"].get(q["id"]) if record else None
        if raw_value in (None, "", []):
            raw_value = first_map.get(q["id"])
        payload = preview_payload(q, raw_value)
        if not submitted or not payload["has_content"]:
            cells.append({
                "student_id": student["id"], "student_name": student["name"], "class_name": student["class_name"],
                "state": "unanswered", "state_label": "没做" if needs_review else "未填写",
                "preview_text": "", "preview_images": [], "feedback": "",
            })
            continue
        if not needs_review:
            state, state_label = "correct", "已记录"
        else:
            sec_status = sec_info.get("status")
            returned_qs = set(record.get("returned_questions") or [])
            if sec_status == "returned" and q["id"] in returned_qs:
                state, state_label = "wrong", "已驳回待修改"
            elif sec_status in {"pending", "correction"}:
                state = "pending"
                state_label = "待教师审核" if sec_status == "pending" else "同段待订正（后送审）"
            else:
                state, state_label = "correct", "已通过审核"
        q_feedback = ((record.get("question_reviews") or {}).get(q["id"], {}).get("feedback") or (record.get("feedback") or "")) if record else ""
        cells.append({
            "student_id": student["id"], "student_name": student["name"], "class_name": student["class_name"],
            "state": state, "state_label": state_label,
            "preview_text": payload["text"], "preview_images": payload["images"],
            "feedback": q_feedback,
        })
    return cells


def question_analysis(q, section, records, students, eligible, eligible_students=None):
    """首答取不可覆盖的快照；订正结果只取已正式提交的第二次判分。"""
    answers = []
    distribution = Counter()
    for record in records:
        first = record["_first_answers"] if "_first_answers" in record else (json.loads(record["first_answers"]) if record["first_answers"] else {})
        if not record["stage_states"][section["id"]]["submitted"] or q["id"] not in first:
            continue
        value = first[q["id"]]
        if value is None or value == "" or value == []:
            continue
        result = record["results"].get(q["id"], {})
        objective = q["type"] != "text"
        correct = worksheets.answer_correct(q, value) if objective else None
        corrected = objective and result.get("attempts", 0) >= 2
        student = students[record["student_id"]]
        answers.append({"student": student, "record_id": record["id"],
                        "first_raw": value, "current_raw": record['answers'].get(q['id']),
                        "first": display_answer(q, value), "correct": correct,
                        "corrected": corrected,
                        "correction": display_answer(q, record["answers"].get(q["id"])) if corrected else None,
                        "correction_correct": result.get("correct") if corrected else None,
                        "current": display_answer(q, record["answers"].get(q["id"])),
                        "status": worksheets.STATUS_LABELS[record["status"]]})
        if q["type"] in {"single", "multiple"}:
            # 多选按选项分别计人数，同一名学生可以计入多个选项。
            for option in (value if q["type"] == "multiple" else [value]):
                distribution[str(option)] += 1
        elif q["type"] == "number":
            # 数值统一格式，避免 3、3.0 被当成两种不同答案。
            distribution[format(float(value), ".12g")] += 1
    count = len(answers)
    if q["type"] in {"single", "multiple"}:
        expected = q["answer"] if q["type"] == "multiple" else [q["answer"]]
        bars = [{"label": o["label"], "count": distribution[str(o["value"])],
                 "correct": o["value"] in expected} for o in q["options"]]
    else:
        bars = [{"label": label, "count": n, "correct": worksheets.answer_correct(q, label)}
                for label, n in distribution.most_common()] if q["type"] == "number" else []
    for bar in bars:
        bar["percent"] = percent(bar["count"], count) or 0
    if q["type"] != "text":
        question_kind = "objective"
        correct_count = sum(a["correct"] is True for a in answers)
        wrong_count = count - correct_count
        pending_count = 0
        unanswered = eligible - count
        cells = _objective_cells(answers, eligible_students)
        corr_correct = sum(c["correction_state"] == "correct" for c in cells)
        corr_wrong = sum(c["correction_state"] == "wrong" for c in cells)
        correction_stats = {
            "correct_count": corr_correct, "wrong_count": corr_wrong,
            "unanswered": unanswered, "rate": percent(corr_correct, count),
        }
    else:
        question_kind = "review" if q.get("review", True) else "record"
        cells = _subjective_cells(q, section, records, eligible_students)
        correct_count = sum(c["state"] == "correct" for c in cells)
        pending_count = sum(c["state"] == "pending" for c in cells)
        wrong_count = sum(c["state"] == "wrong" for c in cells)
        unanswered = sum(c["state"] == "unanswered" for c in cells)
        count = eligible - unanswered
        correction_stats = None
    eligible_set = {s["id"] for s in (eligible_students or [])}
    tree_variants = []
    if q.get("decision_tree"):
        from .classification import question_summary as tree_question_summary, tree_variants as get_tree_variants
        summary_tables = tree_question_summary(q, records, eligible_set, students)
        tree_variants = get_tree_variants(q, records, eligible_set, students)
    else:
        summary_tables = neural_analysis.question_summary(q, records, eligible_set)
    is_plain_text = (
        q["type"] == "text"
        and not q.get("record_table")
        and not q.get("decision_tree")
        and not q.get("knn_captures")
        and not q.get("record_form")
        and not q.get("pixel_code")
        and q["id"] != "collection-notes"
    )
    return {"id": q["id"], "prompt": q["prompt"], "type": q["type"],
            "question_kind": question_kind, "record_form": q.get("record_form"),
            "options": [o["label"] for o in q.get("options", [])],
            "optional": section.get("optional", False) or not q.get("required", False),
            "count": count, "unanswered": unanswered,
            "correct_count": correct_count, "pending_count": pending_count, "wrong_count": wrong_count,
            "rate": percent(correct_count, count) if q["type"] != "text" else None,
            "corrected": sum(a["corrected"] for a in answers),
            "correction_correct": sum(a["corrected"] and a["correction_correct"] for a in answers),
            "correction_stats": correction_stats,
            "bars": bars, "cells": cells, "answers": answers,
            "summary_tables": summary_tables,
            "tree_variants": tree_variants,
            "word_cloud": text_word_cloud(cells) if is_plain_text else None,
            "standard": display_answer(q, q.get("answer")) if q["type"] != "text" else None}


def analysis(scope, lesson_id=None):
    base_lessons = [l for l in scope["lessons"] if not lesson_id or l["id"] == lesson_id]
    lessons = deepcopy(base_lessons)
    student_list = scope["students"]
    students = {s["id"]: s for s in student_list}
    by_activity = defaultdict(list)
    for r in scope["records"].values():
        by_activity[r["activity_id"]].append(r)
    selected_ids = {a["id"] for lesson in lessons for a in lesson["activities"] if not a.get("optional")}
    selected_records = [r for aid in selected_ids for r in by_activity.get(aid, ())]
    for lesson in lessons:
        lesson_ids = {a["id"] for a in lesson["activities"] if not a.get("optional")}
        lesson_records = [r for aid in lesson_ids for r in by_activity.get(aid, ())]
        lesson["summary"] = summarize(student_list, lesson_records, lesson_ids)
        for activity in lesson["activities"]:
            own = by_activity.get(activity["id"], [])
            if activity['id'] in {'lesson-2-task-2', 'lesson-3-task-2', 'lesson-4-task-1'}:
                from .animal_analysis import build
                activity['animal_chart'] = build(scope, activity['id'])
            if activity['id'] == 'lesson-3-task-2':
                from .animal_analysis import training_gallery
                activity['training_gallery'] = training_gallery(scope)
            own_ids = {r["student_id"] for r in own}
            definitions = {activity["definition"]["version"]: activity["definition"]}
            definitions.update({r["definition"]["version"]: r["definition"] for r in own})
            activity["versions"] = []
            for version, definition in sorted(definitions.items(), reverse=True):
                records = [r for r in own if r["definition"]["version"] == version]
                # 尚未建档的学生只计入当前题目版本，不能在每个旧版本重复记为未答。
                eligible_ids = {r["student_id"] for r in records}
                if version == activity["definition"]["version"]:
                    eligible_ids.update(s["id"] for s in student_list if s["id"] not in own_ids)
                eligible_students = [s for s in student_list if s["id"] in eligible_ids]
                eligible = len(eligible_students)
                sections = []
                for section in definition["sections"]:
                    sections.append({
                        "id": section["id"], "step": section.get("step", 0),
                        "optional": bool(section.get("optional")), "title": section["title"],
                        "questions": [
                            question_analysis(q, section, records, students, eligible, eligible_students)
                            for q in section["questions"]
                        ],
                    })
                activity["versions"].append({"version": version, "eligible": eligible, "sections": sections})
            activity["has_objectives"] = any(
                q["type"] != "text"
                for v in activity["versions"]
                for s in v["sections"]
                for q in s["questions"]
            )
    volumes = []
    for volume in COURSE_VOLUMES:
        v_lessons = [l for l in lessons if l["volume_id"] == volume["id"]]
        if v_lessons:
            v_ids = {a["id"] for l in v_lessons for a in l["activities"] if not a.get("optional")}
            v_records = [r for aid in v_ids for r in by_activity.get(aid, ())]
            volumes.append({
                "id": volume["id"], "number": volume["number"], "title": volume["title"],
                "lessons": v_lessons,
                "summary": summarize(student_list, v_records, v_ids),
            })
    return {"volumes": volumes, "lessons": lessons, "summary": summarize(student_list, selected_records, selected_ids)}


def curations(class_id=None, digit=None, lesson_id=None):
    """按课程活动准备作品选展与手写样本整理数据。"""
    data = {}
    if not lesson_id or lesson_id == "lesson-1":
        from . import pixel_paint
        data["pixel"] = pixel_paint.teacher_works(class_id)
    if not lesson_id or lesson_id == "lesson-7":
        from . import handwriting
        samples, totals = handwriting.library(class_id, digit)
        data["handwriting"] = {
            "samples": samples, "totals": totals,
            "latest": handwriting.dataset(), "digit": digit,
        }
    if not lesson_id or lesson_id in {"lesson-8", "lesson-9"}:
        from . import creation
        data["creation"] = creation.teacher_works(class_id)
    return data
