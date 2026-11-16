"""学习札记：JSON 管题目，SQLite 管作答；成绩和状态统一由服务端决定。"""
import json
import math
import time
from copy import deepcopy
from pathlib import Path
from flask import current_app, has_app_context

from .courses import COURSE_VOLUMES
from .database import connect

WORKSHEET_DIR = Path(__file__).resolve().parents[1] / "worksheets"
STATUS_LABELS = {
    "unstarted": "未填写", "draft": "已暂存", "in_progress": "进行中", "correction": "待订正",
    "pending": "待教师审核", "returned": "已驳回", "completed": "已完成",
}


class WorksheetError(Exception):
    """可直接展示给学生或教师的提示。"""

    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


def progress_locks_enabled():
    """测试只放开访问顺序，不修改真实提交、成绩与完成状态。"""
    return current_app.config.get("PROGRESS_LOCKS_ENABLED", True) if has_app_context() else True


def questions(definition):
    return [q for section in definition["sections"] for q in section["questions"]]


def progress_nodes():
    """按课程顺序展开所有可设卡点的节点（精确到子活动，无札记的活动保留活动本身）。"""
    nodes = []
    for volume in COURSE_VOLUMES:
        for lesson in volume["lessons"]:
            if not lesson["available"]:
                continue
            for act_idx, activity in enumerate(lesson["activities"], start=1):
                path = WORKSHEET_DIR / f"{activity['id']}.json"
                if path.is_file():
                    definition = json.loads(path.read_text(encoding="utf-8"))
                    for sec_idx, section in enumerate(definition.get("sections", []), start=1):
                        nodes.append({
                            "key": f"{activity['id']}:{section['id']}",
                            "lesson_number": lesson["number"],
                            "lesson_id": lesson["id"],
                            "lesson_title": lesson["title"],
                            "activity_index": act_idx,
                            "activity_id": activity["id"],
                            "activity_title": activity["title"],
                            "section_index": sec_idx,
                            "section_id": section["id"],
                            "section_title": section["title"],
                        })
                else:
                    nodes.append({
                        "key": activity["id"],
                        "lesson_number": lesson["number"],
                        "lesson_id": lesson["id"],
                        "lesson_title": lesson["title"],
                        "activity_index": act_idx,
                        "activity_id": activity["id"],
                        "activity_title": activity["title"],
                        "section_index": None,
                        "section_id": None,
                        "section_title": None,
                    })
    return nodes


def progress_cap_lessons():
    """按课时分组的卡点选项，供教师端下拉选择。"""
    groups = []
    by_lesson = {}
    for node in progress_nodes():
        lid = node["lesson_id"]
        if lid not in by_lesson:
            by_lesson[lid] = {"lesson_id": lid, "lesson_number": node["lesson_number"],
                              "lesson_title": node["lesson_title"], "options": []}
            groups.append(by_lesson[lid])
        act_part = f"活动 {node['activity_index']}（{node['activity_title']}）"
        label = (f"{act_part} · 子活动 {node['section_index']}（{node['section_title']}）"
                 if node["section_title"] else act_part)
        by_lesson[lid]["options"].append({"key": node["key"], "label": label})
    return groups


def progress_cap_label(cap):
    if not cap:
        return "全部开放"
    node = next((n for n in progress_nodes() if n["key"] == cap), None)
    if not node:
        return "全部开放"
    base = f"第 {node['lesson_number']} 课 · 活动 {node['activity_index']}（{node['activity_title']}）"
    return f"{base} · 子活动 {node['section_index']}（{node['section_title']}）" if node["section_title"] else base


def class_progress_cap(student_id=None, class_id=None):
    if not has_app_context() or (student_id is None and class_id is None):
        return ""
    with connect() as db:
        if class_id is not None:
            row = db.execute("SELECT progress_cap FROM classes WHERE id=?", (class_id,)).fetchone()
        else:
            row = db.execute("SELECT c.progress_cap FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=?", (student_id,)).fetchone()
    return row["progress_cap"] if row else ""


def cap_limit(progress_cap):
    if not progress_cap or not progress_locks_enabled():
        return None
    nodes = progress_nodes()
    key_to_idx = {node["key"]: idx for idx, node in enumerate(nodes)}
    cap_idx = key_to_idx.get(progress_cap)
    if cap_idx is None:
        return None
    return cap_idx, key_to_idx


def activity_allowed_by_cap(activity_id, limit):
    if limit is None:
        return True
    cap_idx, key_to_idx = limit
    prefix = f"{activity_id}:"
    return any(idx <= cap_idx for key, idx in key_to_idx.items() if key == activity_id or key.startswith(prefix))


def definition_for(activity_id, student_id=None, class_id=None):
    # 先匹配课程中的固定 ID，不能把用户输入直接拼成任意文件路径。
    for volume in COURSE_VOLUMES:
        for lesson in volume["lessons"]:
            for activity in lesson["activities"]:
                if activity["id"] != activity_id:
                    continue
                if progress_locks_enabled() and not all(item["available"] for item in (volume, lesson, activity)):
                    raise WorksheetError("这个活动尚未开放。", 403)
                if progress_locks_enabled() and (student_id is not None or class_id is not None):
                    limit = cap_limit(class_progress_cap(student_id=student_id, class_id=class_id))
                    if not activity_allowed_by_cap(activity_id, limit):
                        raise WorksheetError("这个活动教师暂未开放。", 403)
                path = WORKSHEET_DIR / f"{activity_id}.json"
                if not path.is_file():
                    raise WorksheetError("这个活动的学习札记尚未准备好。", 404)
                definition = json.loads(path.read_text(encoding="utf-8"))
                validate_definition(definition, activity_id)
                return definition
    raise WorksheetError("活动不存在。", 404)


def validate_definition(definition, activity_id):
    """尽早指出维护 JSON 时的常见错误，不引入额外的配置依赖。"""
    if definition.get("activity_id") != activity_id or not isinstance(definition.get("version"), int):
        raise ValueError(f"{activity_id} 的活动 ID 或版本无效")
    items = questions(definition)
    if not items or len({q["id"] for q in items}) != len(items):
        raise ValueError(f"{activity_id} 的题目为空或 ID 重复")
    sections = definition["sections"]
    if (len({s["id"] for s in sections}) != len(sections)
            or [s["step"] for s in sections] != list(range(len(sections)))
            or not any(not s.get("optional") for s in sections)):
        raise ValueError(f"{activity_id} 的分段 ID、实验顺序或必做配置无效")
    for section in sections:
        if section.get("optional") and any(q["type"] != "text" or q.get("review", True) for q in section["questions"]):
            raise ValueError("选做分段仅记录自主观察，不参与判分或审核")
    for q in items:
        if q.get('decision_tree') and (q['type'] != 'text' or q['decision_tree'].get('stage') not in (1, 2)):
            raise ValueError('决策树快照须使用文字题并指定四动物或六动物阶段')
        if q.get('record_form') and (q['type'] != 'text' or q['record_form'] not in {'recognition','original','original_upload','original_rating','draft','draft_upload','draft_rating','portfolio','portfolio_upload','portfolio_reflection','favorites','pixel','training_evidence'}):
            raise ValueError('创作记录须使用已支持的文字表单')
        if q["type"] not in {"single", "multiple", "number", "text"}:
            raise ValueError(f"未知题型：{q['id']}")
        if q["type"] != "text" and ("answer" not in q or not q.get("required")):
            raise ValueError(f"固定答案题须必填并设置答案：{q['id']}")
        if q["type"] in {"single", "multiple"}:
            values = [option["value"] for option in q["options"]]
            expected = q["answer"] if q["type"] == "multiple" else [q["answer"]]
            if len(values) != len(set(values)) or not expected or any(v not in values for v in expected):
                raise ValueError(f"选项或答案无效：{q['id']}")


def decode(row):
    record = dict(row)
    for key in ("definition", "answers", "results", "returned_questions", "stage_states"):
        record[key] = json.loads(record[key])
    raw_reviews = record.get("question_reviews")
    record["question_reviews"] = json.loads(raw_reviews) if raw_reviews else {}
    if not record["stage_states"]:
        upgrade_legacy_record(record)
    if record['activity_id'] == 'lesson-2-task-1' and record['definition']['version'] < 2:
        # 2.1改为提交即完成；旧草稿、首答和教师反馈保留，统一解除审核门槛。
        record['definition']['version'] = 2
        for question in questions(record['definition']):
            question['review'] = False
        for stage in record['stage_states'].values():
            if stage['submitted']:
                stage['status'] = 'completed'
        record['returned_questions'] = []
        refresh_record_status(record)
    return record


def upgrade_legacy_record(record):
    """一次性承接旧版整张作答；保留原题、首次成绩和已获得的解锁，不让学生重填。"""
    definition = record["definition"]
    if not all("id" in section and "step" in section for section in definition["sections"]):
        original = {q["id"]: q for q in questions(definition)}
        path = WORKSHEET_DIR / f"{record['activity_id']}.json"
        layout = json.loads(path.read_text(encoding="utf-8"))["sections"] if path.is_file() else []
        # 只借用新分组，不替换旧快照中的题干、答案或评分规则。
        sections = []
        remaining = set(original)
        for section in layout:
            ids = [q["id"] for q in section["questions"] if q["id"] in original]
            if not ids:
                continue
            sections.append({**{k: section[k] for k in ("id", "title", "step", "optional")},
                             "questions": [original[key] for key in ids]})
            remaining.difference_update(ids)
        if remaining or not sections:
            sections.append({"id": "previous-notes", "step": len(sections), "title": "既有记录",
                             "optional": False, "questions": [q for key, q in original.items() if key in remaining]})
        definition["sections"] = sections
    first = json.loads(record["first_answers"]) if record["first_answers"] else None
    for section in definition["sections"]:
        submitted = first is not None and (not section.get("optional") or any(record["answers"].get(q["id"]) for q in section["questions"]))
        status = "draft"
        if submitted:
            if any(q["id"] in record["returned_questions"] for q in section["questions"]):
                status = "returned"
            elif any(not record["results"].get(q["id"], {}).get("correct", True)
                     and record["results"][q["id"]]["attempts"] == 1 for q in section["questions"]):
                status = "correction"
            elif record["status"] != "completed" and section_needs_review(section, record["answers"]):
                status = "pending"
            else:
                status = "completed"
        first_correct = sum(answer_correct(q, first[q["id"]]) for q in section["questions"]
                            if first and q["type"] != "text" and q["id"] in first)
        record["stage_states"][section["id"]] = {"submitted": submitted, "status": status, "first_correct": first_correct}


def find_record(db, student_id, activity_id):
    row = db.execute("SELECT * FROM worksheet_records WHERE student_id=? AND activity_id=?",
                     (student_id, activity_id)).fetchone()
    if not row:
        return None
    record = decode(row)
    if (activity_id == 'lesson-2-task-2' and record['definition']['version'] < 2
            and not any(stage['submitted'] for stage in record['stage_states'].values())):
        # 未提交旧草稿改用单张结果表，保留旧文字供历史追溯；已提交快照不替换。
        record['answers']['animal-tests-legacy'] = record['answers'].get('animal-tests', '')
        record['answers'].pop('animal-tests', None)
        record['definition'] = definition_for(activity_id)
        record['stage_states'] = empty_record(student_id, activity_id, record['definition'])['stage_states']
    if (activity_id == 'lesson-2-task-2' and record['definition']['version'] == 2
            and not any(stage['submitted'] for stage in record['stage_states'].values())):
        # 只给未提交草稿增加摄像头选填行，原图片数值与已提交历史均保留。
        record['definition'] = definition_for(activity_id)
    if (activity_id == 'lesson-1-task-2' and record['definition']['version'] < 2
            and not any(stage['submitted'] for stage in record['stage_states'].values())):
        # 未提交札记去掉命名和说明；已提交题目、作品与首次答案保留。
        record['definition'] = definition_for(activity_id)
    if activity_id == 'lesson-1-task-1' and not record['stage_states']['binary']['submitted']:
        section = next(s for s in record['definition']['sections'] if s['id'] == 'binary')
        if not any(q.get('pixel_code') for q in section['questions']):
            # 未提交的旧草稿保留文字；已提交的旧题、首答和成绩完全保留。
            latest = definition_for(activity_id)
            section['questions'] = deepcopy(next(s for s in latest['sections'] if s['id'] == 'binary')['questions'])
            record['definition']['version'] = latest['version']
    if activity_id == 'lesson-1-task-1' and not record['stage_states']['gray']['submitted']:
        section = next(s for s in record['definition']['sections'] if s['id'] == 'gray')
        if not any(q['id'] == 'gray-16-bits' for q in section['questions']):
            # 16级题使用新ID，不把旧8级题的草稿或成绩套到新题上。
            latest = definition_for(activity_id)
            updated = next(s for s in latest['sections'] if s['id'] == 'gray')
            section['title'] = updated['title']
            section['questions'] = deepcopy(updated['questions'])
            record['definition']['version'] = latest['version']
    if activity_id == 'lesson-1-task-1' and not record['stage_states']['color']['submitted']:
        section = next(s for s in record['definition']['sections'] if s['id'] == 'color')
        question = next(q for q in section['questions'] if q['id'] == 'my-rgb')
        if question.get('record_table', {}).get('kind') != 'rgb':
            # 只更新未提交的第一问表单，原文字草稿和第二问保留。
            latest = definition_for(activity_id)
            updated = next(q for q in questions(latest) if q['id'] == 'my-rgb')
            section['questions'][section['questions'].index(question)] = deepcopy(updated)
            record['definition']['version'] = latest['version']
    if (activity_id == 'lesson-8-task-1' and record['definition']['version'] < 2
            and not any(stage['submitted'] for stage in record['stage_states'].values())):
        # 未提交的旧草稿拆成四个标签；已提交版本保留原题目和首次答案。
        latest = definition_for(activity_id)
        try:
            old = json.loads(record['answers'].get('recognition-record', '{}'))
        except (ValueError, TypeError):
            old = {}
        for item in old.get('observations', []) if isinstance(old, dict) else []:
            if not isinstance(item, dict) or item.get('image_id') not in ['image-1','image-2','image-3','image-4']:
                continue
            number = item['image_id'][-1]
            record['answers'][f'ai-answer-{number}'] = item.get('ai_answer', '')
            record['answers'][f'ai-judgment-{number}'] = item.get('verification', '')
        record['definition'] = latest
        record['stage_states'] = empty_record(student_id, activity_id, latest)['stage_states']
    if (activity_id == 'lesson-8-task-2' and record['definition']['version'] < 2
            and not any(stage['submitted'] for stage in record['stage_states'].values())):
        # 旧草稿保留图片与文字；三档主观评价不擅自换算成新的0—5分。
        from .creation import record_data
        old = record_data(record['answers'].get('original-record'))
        latest = definition_for(activity_id)
        upload = {key:old[key] for key in ('schema_version','beast_id','works') if key in old}
        upload.setdefault('schema_version',1)
        rating = {'schema_version':1,'evaluation':{'detail':old.get('evaluation',{}).get('detail','')}}
        record['answers']['original-upload'] = json.dumps(upload,ensure_ascii=False)
        record['answers']['original-evaluation'] = json.dumps(rating,ensure_ascii=False)
        record['definition'] = latest
        record['stage_states'] = empty_record(student_id,activity_id,latest)['stage_states']
    if (activity_id == 'lesson-9-task-1' and record['definition']['version'] < 2
            and not any(stage['submitted'] for stage in record['stage_states'].values())):
        # 未提交的旧初稿迁入上传与自评两段；已提交版本保留原记录。
        from .creation import record_data
        old = record_data(record['answers'].get('draft-work'))
        latest = definition_for(activity_id)
        upload = {'schema_version': 1, 'works': old.get('works', [])}
        rating = {'schema_version': 1, 'evaluation': {}}
        record['answers']['draft-upload'] = json.dumps(upload, ensure_ascii=False)
        record['answers']['draft-evaluation'] = json.dumps(rating, ensure_ascii=False)
        record['definition'] = latest
        record['stage_states'] = empty_record(student_id, activity_id, latest)['stage_states']
    if (activity_id == 'lesson-9-task-3' and record['definition']['version'] < 2
            and not any(stage['submitted'] for stage in record['stage_states'].values())):
        # 未提交的旧版9.3草稿拆为上传定稿与反思两段；已提交版本保留原记录。
        from .creation import record_data
        old = record_data(record['answers'].get('final-portfolio'))
        latest = definition_for(activity_id)
        upload = {'schema_version': 1, 'works': old.get('works', [])}
        reflection = {'schema_version': 1, 'ai_review': old.get('ai_review')}
        record['answers']['final-upload'] = json.dumps(upload, ensure_ascii=False)
        record['answers']['final-reflection'] = json.dumps(reflection, ensure_ascii=False)
        record['definition'] = latest
        record['stage_states'] = empty_record(student_id, activity_id, latest)['stage_states']
    # 7.1 T3 未填且未提交的旧草稿无缝升级为手动逐次填表；已有记录与已提交快照保持原样。
    if (activity_id == "lesson-7-task-1"
            and not record["answers"].get("manual-record")
            and not record["stage_states"]["manual"]["submitted"]):
        section = next(s for s in record["definition"]["sections"] if s["id"] == "manual")
        for index, question in enumerate(section["questions"]):
            if question["id"] == "manual-record" and len(question.get("record_table", {}).get("fields", [])) != 12:
                latest = definition_for(activity_id)
                section["questions"][index] = deepcopy(next(q for q in questions(latest) if q["id"] == "manual-record"))
                record["definition"]["version"] = max(record["definition"]["version"], latest["version"])
                break
    # 只更新尚未填写、尚未提交的对照题；已有文字与首次作答快照保持原样。
    if activity_id == "lesson-7-task-2" and not record["answers"].get("ten-comparison"):
        section = next(s for s in record["definition"]["sections"] if s["id"] == "ten-compare")
        if not record["stage_states"]["ten-compare"]["submitted"]:
            latest = None
            for index, question in enumerate(section["questions"]):
                if question["id"] == "ten-comparison" and not question.get("record_table", {}).get("header_digits"):
                    latest = definition_for(activity_id)
                    section["questions"][index] = deepcopy(next(q for q in questions(latest) if q["id"] == "ten-comparison"))
            if latest:
                record["definition"]["version"] = latest["version"]
    if (activity_id == "lesson-7-task-2"
            and not record["answers"].get("handwriting-targets")
            and not record["answers"].get("handwriting-record")
            and not record["stage_states"]["handwriting"]["submitted"]):
        section = next(s for s in record["definition"]["sections"] if s["id"] == "handwriting")
        if not any(q.get("record_table", {}).get("kind") == "handwriting_results" for q in section["questions"]):
            # 未填记录更新为表格；已有文字和已提交快照保持原样。
            latest = definition_for(activity_id)
            section["questions"] = deepcopy(next(s for s in latest["sections"] if s["id"] == "handwriting")["questions"])
            record["definition"]["version"] = latest["version"]
    if activity_id == "lesson-7-task-2":
        latest = definition_for(activity_id)
        own = next(s for s in record["definition"]["sections"] if s["id"] == "own-training")
        own["sample_upload"] = True
        if (not record["stage_states"]["own-training"]["submitted"]
                and not record["answers"].get("own-comparison")):
            own["questions"] = deepcopy(next(s for s in latest["sections"] if s["id"] == "own-training")["questions"])
        if not any(s["id"] == "class-training" for s in record["definition"]["sections"]):
            # 新增选做段不改首次答案、成绩和必做完成状态，也不重新锁住旧步骤。
            record["definition"]["sections"].append(deepcopy(next(s for s in latest["sections"] if s["id"] == "class-training")))
            record["stage_states"]["class-training"] = {"submitted":False,"status":"draft","first_correct":0}
        record["definition"]["version"] = max(record["definition"]["version"], latest["version"])
    return record


def objective_questions(definition):
    return [q for q in questions(definition) if q["type"] != "text"]


def section_reviewable_ids(section, answers):
    return [q["id"] for q in section["questions"]
            if q["type"] == "text" and q.get("review", True)
            and (q.get("required") or answers.get(q["id"]))]


def section_needs_review(section, answers):
    return bool(section_reviewable_ids(section, answers))


def flow(record, progress_cap=None):
    """流程进度只统计必做分段的首次提交，独立于判分、订正和教师审核。"""
    if progress_cap is None and record.get("student_id"):
        progress_cap = class_progress_cap(student_id=record["student_id"])
    limit = cap_limit(progress_cap)
    sections = []
    unlocked = True
    for section in record["definition"]["sections"]:
        state = record["stage_states"][section["id"]]
        section_allowed = (limit is None) or (limit[1].get(f"{record['activity_id']}:{section['id']}", -1) <= limit[0])
        sections.append({"id": section["id"], "step": section["step"], "title": section["title"],
                         "optional": bool(section.get("optional")),
                         "unlocked": unlocked and section_allowed,
                         "locked_by_teacher": not section_allowed,
                         "submitted": state["submitted"], "status": state["status"]})
        if progress_locks_enabled() and not section.get("optional") and not state["submitted"]:
            unlocked = False
    required = [section for section in sections if not section["optional"]]
    submitted = sum(section["submitted"] for section in required)
    total = len(required)
    return {"submitted": submitted, "total": total, "percent": round(submitted / total * 100) if total else 0,
            "sections": sections}


def refresh_record_status(record):
    required = [record["stage_states"][s["id"]] for s in record["definition"]["sections"] if not s.get("optional")]
    if not all(state["submitted"] for state in required):
        record["status"] = "in_progress" if any(state["submitted"] for state in required) else "draft"
    else:
        record["status"] = next((status for status in ("returned", "correction", "pending")
                                 if any(state["status"] == status for state in required)), "completed")
    if record["first_answers"] is not None:
        record["first_correct"] = sum(state["first_correct"] for state in record["stage_states"].values())


def progress(record, activity_id=None, progress_cap=None):
    if not record:
        return {"activity_id": activity_id, "status": "unstarted", "completed": False,
                "excellent": False, "ring": "red", "label": "未填写"}
    completed = record["status"] == "completed"
    total = len(objective_questions(record["definition"]))
    # 使用整数比较，避免四舍五入把不足 85% 的成绩提升成金圈。
    excellent = completed and (record["first_correct"] * 100 >= total * 85 if total
                               else bool(record["teacher_excellent"]))
    return {"activity_id": record["activity_id"], "status": record["status"],
            "completed": completed, "excellent": excellent,
            "ring": "gold" if excellent else "green" if completed else "red",
            "label": "优秀" if excellent else STATUS_LABELS[record["status"]],
            "revision": record["revision"], "flow": flow(record, progress_cap=progress_cap)}


def editable_ids(record):
    editable = set()
    stages = {s["id"]: s for s in flow(record)["sections"]}
    for section in record["definition"]["sections"]:
        state = stages[section["id"]]
        if not state["unlocked"]:
            continue
        for q in section["questions"]:
            result = record["results"].get(q["id"])
            if (state["status"] == "draft"
                    or state["status"] == "correction" and result and not result["correct"] and result["attempts"] == 1
                    or state["status"] == "returned" and q["id"] in record["returned_questions"]):
                editable.add(q["id"])
    return editable


def public_record(record):
    """白名单构造学生数据；首次错题不发送标准答案、解释或教师评阅提示。"""
    editable = editable_ids(record)
    definition = record["definition"]
    sections = []
    stages = {s["id"]: s for s in flow(record)["sections"]}
    visible_ids = set()
    for section in definition["sections"]:
        stage = stages[section["id"]]
        reviews = record.get("question_reviews") or {}
        items = []
        for q in section["questions"] if stage["unlocked"] else []:
            visible_ids.add(q["id"])
            item = {key: q[key] for key in ("id", "type", "prompt", "required", "options", "max_length", "experiment_record", "record_table", "record_form", "pixel_code", "pixel_context", "handwriting_context", "decision_tree", "knn_captures") if key in q}
            item["editable"] = q["id"] in editable
            result = record["results"].get(q["id"])
            if result:
                item["result"] = result
                if result["correct"] or result["attempts"] >= 2:
                    item["answer"] = q["answer"]
                    item["explanation"] = q.get("explanation", "")
            elif stage["status"] != "pending":
                if q["id"] in reviews:
                    item["review"] = reviews[q["id"]]
                elif stage["status"] == "returned" and q["id"] in record["returned_questions"]:
                    item["review"] = {"status": "returned", "feedback": record["feedback"]}
            items.append(item)
        sections.append({**stage, "sample_upload": bool(section.get("sample_upload")), "can_edit": any(q["editable"] for q in items), "questions": items})
    total = len(objective_questions(definition))
    return {"activity_id": record["activity_id"], "title": definition["title"],
            "intro": definition.get("intro", ""), "version": definition["version"],
            "sections": sections, "answers": {key: value for key, value in record["answers"].items() if key in visible_ids},
            "revision": record["revision"], "flow": flow(record),
            "first_correct": record["first_correct"], "objective_total": total,
            "feedback": record["feedback"], "progress": progress(record),
            "can_edit": bool(editable)}


def empty_record(student_id, activity_id, definition):
    return {"student_id": student_id, "activity_id": activity_id, "definition": definition,
            "answers": {}, "results": {}, "status": "draft", "feedback": "",
            "returned_questions": [], "question_reviews": {}, "first_correct": None, "first_answers": None,
            "teacher_excellent": 0, "revision": 0,
            "stage_states": {section["id"]: {"submitted": False, "status": "draft", "first_correct": 0}
                             for section in definition["sections"]}}


def sync_live_answers(db, record):
    """9.2 札记实时读取提示词收藏本，允许学生评阅后继续增改而不落回待审。"""
    if record["activity_id"] != "lesson-9-task-2":
        return record
    from .creation import favorites_payload
    record["answers"]["collection-notes"] = favorites_payload(db, record["student_id"])
    return record


def read_student(student_id, activity_id):
    definition = definition_for(activity_id, student_id=student_id)
    with connect() as db:
        record = find_record(db, student_id, activity_id)
        resolved = sync_live_answers(db, record or empty_record(student_id, activity_id, definition))
    result = public_record(resolved)
    if not record:
        result["progress"].update(status="unstarted", label="未填写")
    return result


def record_table_values(q, value, required=False):
    """实验表按固定行保存为可读文字；暂存允许空格，提交须完整填写。"""
    fields = {field["label"]: field for field in q["record_table"]["fields"]}
    values = {}
    for line in value.splitlines():
        label, separator, number = line.partition("：")
        if not separator or label not in fields or label in values:
            raise WorksheetError("实验表的格式不正确，请重新填写。")
        number = number.strip()
        if number:
            field = fields[label]
            if q['record_table'].get('kind') == 'animal_predictions' and field.get('text'):
                if len(number) > 12:
                    raise WorksheetError('类别名称最多12个字。')
                values[label] = number
                continue
            if field.get("options"):
                if number not in field["options"]:
                    raise WorksheetError("请选择表格提供的选项。")
                values[label] = number
                continue
            try:
                numeric = float(number)
                valid = math.isfinite(numeric) and field["min"] <= numeric <= field["max"]
                valid = valid and (not field.get("integer") or numeric.is_integer())
            except ValueError:
                valid = False
            if not valid:
                if q['record_table'].get('kind') == 'rgb':
                    raise WorksheetError('RGB数值须为0—255之间的整数。')
                raise WorksheetError("请检查表格数值的范围，比例须在0至100之间，数字和次数须为整数。")
        values[label] = number
    if required and any(field.get('required', True) and not values.get(label) for label, field in fields.items()):
        raise WorksheetError("请填完整实验表格，再提交。")
    if q['record_table'].get('kind') == 'animal_predictions':
        # 四类异兽表的行列由题目快照提供；旧两类札记仍使用原名称字段。
        table = q['record_table']
        if table.get('columns'):
            by_key = {field['key']: field['label'] for field in table['fields']}
            for row in table['rows']:
                numbers = [values.get(by_key[f"{row['key']}-class-{c}"])
                           for c in range(1, len(table['columns']) + 1)]
                if all(v is not None and v != '' for v in numbers):
                    if abs(sum(float(v) for v in numbers) - 100) > table['sum_tolerance'] + 1e-9:
                        raise WorksheetError(f"{row['label']}的预测比例之和应为100%。")
            return values
        names = [values.get(f'类别{i}名称') for i in (1, 2)]
        if all(names) and names[0] == names[1]:
            raise WorksheetError('两个类别名称不能相同。')
        row_names = [f'图{i}' for i in range(1, 10)]
        if '摄像头·类别1' in fields:
            row_names.append('摄像头')
        for name in row_names:
            pair = [values.get(f'{name}·类别{c}') for c in (1, 2)]
            if required and any(v is not None and v != '' for v in pair) and any(v is None or v == '' for v in pair):
                raise WorksheetError(f'请把{name}的两类预测比例填写完整。')
            if all(v is not None and v != '' for v in pair) and abs(sum(float(v) for v in pair) - 100) > 0.11:
                raise WorksheetError(f'{name}的两类预测比例之和应为100%。')
    if q['record_table'].get('kind') == 'knn_votes':
        from .classification import fixed_votes
        for k in (1, 3, 5, 7, 9):
            pair = [values.get(f'K={k}·{name}') for name in ('金丝猴', '雪豹')]
            if all(item != '' and item is not None for item in pair) and sum(float(item) for item in pair) != k:
                raise WorksheetError(f'K={k}时，两类邻居的票数之和应为{k}。')
            if required and any(float(values[f'K={k}·{name}']) != count for name, count in fixed_votes(k).items()):
                raise WorksheetError(f'K={k}的邻居记录与固定图不一致，请回活动核对连线和票数。')
    if q["record_table"].get("kind") == "digit_comparison":
        image_fields = [field for field in fields.values() if field["key"].startswith("image-")]
        selected = [values.get(field["label"]) for field in image_fields]
        selected = [float(item) if q["record_table"].get("header_digits") else item for item in selected if item]
        if len(selected) != len(set(selected)):
            raise WorksheetError("请填写五个不同的测试数字。")
    if q["record_table"].get("kind") == "handwriting_results":
        ids = [(values.get(f"记录{i}·手写编号"), values.get(f"记录{i}·累计训练次数")) for i in range(1, 4)]
        ids = [(float(image),float(steps)) for image,steps in ids if image and steps]
        if len(ids) != len(set(ids)):
            raise WorksheetError("请选择三条不同的手写尝试，同一笔迹可比较不同训练次数。")
    return values


def normalized_answer(q, value):
    if q["type"] == "multiple":
        if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
            raise WorksheetError("多选题的回答格式不正确。")
        allowed = {option["value"] for option in q["options"]}
        if len(value) != len(set(value)) or any(v not in allowed for v in value):
            raise WorksheetError("请选择题目提供的选项。")
        return value
    if not isinstance(value, str) or len(value) > q.get("max_length", 1200):
        raise WorksheetError("回答过长或格式不正确。")
    value = value.strip()
    if q.get('decision_tree'):
        from .classification import validate_tree
        try:
            validate_tree(value, stage=q['decision_tree']['stage'])
        except ValueError as error:
            raise WorksheetError(str(error)) from None
    if q.get('knn_captures'):
        from .classification import validate_knn_captures
        try:
            validate_knn_captures(value)
        except ValueError as error:
            raise WorksheetError(str(error)) from None
    if q.get("record_table"):
        record_table_values(q, value)
    if q["type"] == "single" and value and value not in {o["value"] for o in q["options"]}:
        raise WorksheetError("请选择题目提供的选项。")
    if q["type"] == "number" and value:
        try:
            valid = math.isfinite(float(value))
        except ValueError:
            valid = False
        if not valid:
            raise WorksheetError("数值题请填写有效的数字。")
    return value


def answer_correct(q, value):
    if q["type"] == "multiple":
        return set(value) == set(q["answer"])
    if q["type"] == "number":
        return abs(float(value) - q["answer"]) <= q.get("tolerance", 0)
    return value == q["answer"]


def pixel_code_context(value):
    """只在学生主动暂存或提交时收取25格题面与约定，不收集实验流水。"""
    if (not isinstance(value, dict) or type(value.get('white')) is not int or value['white'] not in (0, 1)
            or not isinstance(value.get('pixels'), list) or len(value['pixels']) != 25
            or any(type(pixel) is not int or pixel not in (0, 1) for pixel in value['pixels'])):
        raise WorksheetError('请先在活动中绘制图像并选择黑白约定，再暂存或提交。')
    return {'pixels': value['pixels'][:], 'white': value['white']}


def _normalize_handwriting_pixels(raw):
    """校验并规范化 12×18 非空二值点阵为 216 位 0/1 字符串。"""
    if isinstance(raw, str):
        bits = raw.strip()
        if len(bits) == 216 and all(ch in ("0", "1") for ch in bits) and "1" in bits:
            return bits
    elif isinstance(raw, list):
        if len(raw) == 216 and all(type(v) is int and v in (0, 1) for v in raw) and any(raw):
            return "".join(map(str, raw))
    raise WorksheetError("手写尝试的笔迹图须为12×18非空二值点阵。")


def handwriting_record_context(q, answer_text, payload_context, required=False):
    """只在学生暂存或提交时收集3条手写尝试的12×18点阵，用于教师查看与回看。"""
    if payload_context is not None and not isinstance(payload_context, dict):
        raise WorksheetError("手写尝试的笔迹格式不正确。")
    kv = {}
    for line in str(answer_text or "").splitlines():
        label, sep, val = line.partition("：")
        if sep:
            kv[label.strip()] = val.strip()
    existing = q.get("handwriting_context") if isinstance(q.get("handwriting_context"), dict) else {}
    incoming = payload_context if isinstance(payload_context, dict) else {}
    resolved = {}
    for slot in ("1", "2", "3"):
        sid_raw = kv.get(f"记录{slot}·手写编号", "")
        steps_raw = kv.get(f"记录{slot}·累计训练次数", "")
        try:
            sid = int(float(sid_raw)) if sid_raw else None
        except ValueError:
            sid = None
        try:
            steps = int(float(steps_raw)) if steps_raw else None
        except ValueError:
            steps = None
        if sid is None:
            continue
        inc = incoming.get(slot)
        if isinstance(inc, dict) and "pixels" in inc:
            inc_sid = inc.get("source_id")
            if inc_sid is not None and int(inc_sid) != sid:
                raise WorksheetError("手写编号与所选笔迹图不一致，请重新选择尝试。")
            pixels = _normalize_handwriting_pixels(inc.get("pixels"))
            resolved[slot] = {"source_id": sid, "steps": steps, "pixels": pixels}
        else:
            prev = existing.get(slot)
            if isinstance(prev, dict) and prev.get("source_id") == sid and prev.get("pixels"):
                pixels = _normalize_handwriting_pixels(prev.get("pixels"))
                resolved[slot] = {"source_id": sid, "steps": steps, "pixels": pixels}
    if required and any(slot not in resolved for slot in ("1", "2", "3")):
        raise WorksheetError("请从“选择尝试”下拉框中选择3条手写尝试，确保每条均带有手写笔迹图后再提交。")
    return resolved


def validate_pixel_code(question, answer):
    """服务器复核学生输入，不能用浏览器的“验证通过”标记代替校验。"""
    context = pixel_code_context(question.get('pixel_context'))
    sequence = ''.join(answer.split())
    if len(sequence) != 25 or any(bit not in '01' for bit in sequence):
        raise WorksheetError('请在札记中填入25位0或1，可以使用空格或换行分组。')
    expected = ''.join(str(1 - context['white'] if pixel else context['white']) for pixel in context['pixels'])
    if sequence != expected:
        raise WorksheetError('札记编码与本题原图或黑白约定不一致，请核对后提交。')


def write_student(student_id, activity_id, payload, submit=False):
    definition = definition_for(activity_id, student_id=student_id)
    if not isinstance(payload, dict) or not isinstance(payload.get("answers"), dict):
        raise WorksheetError("未收到有效的回答。")
    with connect() as db:
        # 同时检查版本并串行写入，防止双击提交消耗订正机会，或旧页面覆盖新答案。
        db.execute("BEGIN IMMEDIATE")
        record = find_record(db, student_id, activity_id) or empty_record(student_id, activity_id, definition)
        if type(payload.get("revision")) is not int or payload["revision"] != record["revision"]:
            raise WorksheetError("这份札记已更新，请重新打开后再操作；当前输入仍保留在页面中。", 409)
        section = next((s for s in record["definition"]["sections"] if s["id"] == payload.get("section_id")), None)
        if not section:
            raise WorksheetError("请选择需要暂存或提交的札记分段。")
        stage = next(s for s in flow(record)["sections"] if s["id"] == section["id"])
        if not stage["unlocked"]:
            if stage.get("locked_by_teacher"):
                raise WorksheetError("当前子活动教师暂未开放，请等待课堂统一解锁。", 403)
            raise WorksheetError("请先首次提交前面的必做分段，再继续这一段。", 403)
        known = {q["id"]: q for q in section["questions"]}
        editable = editable_ids(record) & known.keys()
        if not editable:
            raise WorksheetError("本段已锁定，只有待订正或教师驳回的题目可以修改。", 409)
        for q in known.values():
            if q.get('pixel_code') and q['id'] in editable:
                q['pixel_context'] = pixel_code_context(payload.get('context', q.get('pixel_context')))
        for key, value in payload["answers"].items():
            if key not in known:
                raise WorksheetError("请只提交当前分段的回答。")
            value = normalized_answer(known[key], value)
            if known[key].get('record_form'):
                from .creation import validate_record
                validate_record(known[key]['record_form'], value, db, student_id, activity_id)
            if key not in editable:
                if value != record["answers"].get(key, [] if known[key]["type"] == "multiple" else ""):
                    raise WorksheetError("已锁定的回答不能修改。", 409)
            else:
                record["answers"][key] = value
        for q in known.values():
            if q.get("record_table", {}).get("kind") == "handwriting_results" and q["id"] in editable:
                q["handwriting_context"] = handwriting_record_context(
                    q, record["answers"].get(q["id"], ""), payload.get("context"), required=submit
                )
        if submit:
            for q in known.values():
                if q.get("required") and not record["answers"].get(q["id"]):
                    raise WorksheetError("请先完成本段的必填题，再提交。")
                if q.get('pixel_code'):
                    validate_pixel_code(q, record['answers'].get(q['id'], ''))
                if q.get('decision_tree'):
                    from .classification import validate_tree
                    try:
                        validate_tree(record['answers'].get(q['id'], ''), required=True, stage=q['decision_tree']['stage'])
                    except ValueError as error:
                        raise WorksheetError(str(error)) from None
                if q.get('knn_captures'):
                    from .classification import validate_knn_captures
                    try:
                        validate_knn_captures(record['answers'].get(q['id'], ''), required=bool(q.get('required')))
                    except ValueError as error:
                        raise WorksheetError(str(error)) from None
                if q.get("record_table") and q.get("required"):
                    record_table_values(q, record["answers"].get(q["id"], ""), required=True)
                if q.get('record_form'):
                    from .creation import validate_record
                    validate_record(q['record_form'], record['answers'].get(q['id'], ''), db, student_id, activity_id, required=True)
            objectives = [q for q in known.values() if q["type"] != "text"]
            state = record["stage_states"][section["id"]]
            if not state["submitted"]:
                first = json.loads(record["first_answers"]) if record["first_answers"] else {}
                first.update({key: record["answers"].get(key, "") for key in known})
                record["first_answers"] = json.dumps(first, ensure_ascii=False)
                results = {q["id"]: {"correct": answer_correct(q, record["answers"][q["id"]]), "attempts": 1}
                           for q in objectives}
                record["results"].update(results)
                state["first_correct"] = sum(result["correct"] for result in results.values())
                # 首次提交立即记录解锁，不依赖正确率、订正结果或教师审核。
                state["submitted"] = True
                state["status"] = "correction" if any(not r["correct"] for r in results.values()) else (
                    "pending" if section_needs_review(section, record["answers"]) else "completed")
            elif state["status"] == "correction":
                for q in objectives:
                    if q["id"] in editable:
                        record["results"][q["id"]] = {"correct": answer_correct(q, record["answers"][q["id"]]), "attempts": 2}
                # 订正后仍错会展示解析，固定题学习流程至此完成，不再反复刷分。
                state["status"] = "pending" if section_needs_review(section, record["answers"]) else "completed"
            elif state["status"] == "returned":
                for key in known:
                    if key in record["returned_questions"]:
                        record["question_reviews"].pop(key, None)
                state["status"] = "pending"
                record["returned_questions"] = [key for key in record["returned_questions"] if key not in known]
        refresh_record_status(record)
        record["revision"] += 1
        db.execute("""INSERT INTO worksheet_records
            (student_id, activity_id, definition, answers, first_answers, first_correct, results,
             status, feedback, returned_questions, question_reviews, teacher_excellent, revision, updated_at, stage_states)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, activity_id) DO UPDATE SET definition=excluded.definition, answers=excluded.answers,
            first_answers=excluded.first_answers, first_correct=excluded.first_correct, results=excluded.results,
            status=excluded.status, returned_questions=excluded.returned_questions,
            question_reviews=excluded.question_reviews,
            revision=excluded.revision, updated_at=excluded.updated_at, stage_states=excluded.stage_states""",
            (student_id, activity_id, json.dumps(record["definition"], ensure_ascii=False),
             json.dumps(record["answers"], ensure_ascii=False), record["first_answers"], record["first_correct"],
             json.dumps(record["results"]), record["status"], record["feedback"],
             json.dumps(record["returned_questions"]), json.dumps(record["question_reviews"], ensure_ascii=False),
             record["teacher_excellent"], record["revision"], int(time.time()),
             json.dumps(record["stage_states"])))
    return public_record(record)


def student_progress(student_id, progress_cap=None):
    if progress_cap is None:
        progress_cap = class_progress_cap(student_id=student_id)
    with connect() as db:
        rows = db.execute("SELECT * FROM worksheet_records WHERE student_id=?", (student_id,)).fetchall()
    return [progress(decode(row), progress_cap=progress_cap) for row in rows]


def student_catalog(student_id, volumes):
    # 每次复制目录，不能把一个学生的完成情况写进全局课程对象。
    volumes = deepcopy(volumes)
    progress_cap = class_progress_cap(student_id=student_id)
    limit = cap_limit(progress_cap)
    if not progress_locks_enabled():
        for volume in volumes:
            volume["available"] = True
            for lesson in volume["lessons"]:
                lesson["available"] = True
                for activity in lesson["activities"]:
                    activity["available"] = True
    elif limit is not None:
        for volume in volumes:
            for lesson in volume["lessons"]:
                if not lesson["available"]:
                    continue
                for activity in lesson["activities"]:
                    activity["available"] = activity["available"] and activity_allowed_by_cap(activity["id"], limit)
                lesson["available"] = any(activity["available"] for activity in lesson["activities"])
            volume["available"] = any(lesson["available"] for lesson in volume["lessons"])
    states = {item["activity_id"]: item for item in student_progress(student_id, progress_cap=progress_cap)}
    for volume in volumes:
        for lesson in volume["lessons"]:
            for activity in lesson["activities"]:
                activity["worksheet_available"] = (WORKSHEET_DIR / f"{activity['id']}.json").is_file()
                activity["excellent"] = False
                if activity["id"] in states:
                    activity.update(states[activity["id"]])
                elif activity["worksheet_available"] and activity["available"]:
                    definition = definition_for(activity["id"], student_id=student_id)
                    activity["flow"] = flow(empty_record(student_id, activity["id"], definition), progress_cap=progress_cap)
            required = [a for a in lesson["activities"] if not a.get("optional")]
            lesson["excellent"] = bool(required) and all(a["excellent"] for a in required)
        volume["excellent"] = bool(volume["lessons"]) and all(l["excellent"] for l in volume["lessons"])
    return volumes


def review_queue(class_id, state="pending"):
    with connect() as db:
        rows = db.execute("""SELECT w.*, s.name AS student_name, s.class_id, c.name AS class_name
            FROM worksheet_records w JOIN students s ON s.id=w.student_id
            JOIN classes c ON c.id=s.class_id WHERE s.class_id=? AND w.first_answers IS NOT NULL
            ORDER BY w.updated_at, w.id""", (class_id,)).fetchall()
    records = [decode(row) for row in rows]
    return [r for r in records if state == "all" or r["status"] == state]


def teacher_record(record_id):
    with connect() as db:
        row = db.execute("""SELECT w.*, s.name AS student_name, s.class_id, c.name AS class_name
            FROM worksheet_records w JOIN students s ON s.id=w.student_id
            JOIN classes c ON c.id=s.class_id WHERE w.id=?""", (record_id,)).fetchone()
        if not row:
            raise WorksheetError("札记不存在。", 404)
        record = sync_live_answers(db, decode(row))
    record["progress"] = progress(record)
    record["has_objectives"] = bool(objective_questions(record["definition"]))
    return record


def _pending_reviewable_ids(record):
    return [qid for section in record["definition"]["sections"]
            if record["stage_states"][section["id"]]["status"] == "pending"
            for qid in section_reviewable_ids(section, record["answers"])]


def _settle_pending_sections(record):
    """当待审题都有了批阅结果时，自动结算分段及整份状态。"""
    reviews = record.setdefault("question_reviews", {})
    pending_ids = _pending_reviewable_ids(record)
    if any(qid not in reviews for qid in pending_ids):
        return False
    returned_all = set(record.get("returned_questions") or [])
    for section in record["definition"]["sections"]:
        state = record["stage_states"][section["id"]]
        if state["status"] != "pending":
            continue
        sec_qids = section_reviewable_ids(section, record["answers"])
        sec_returned = [qid for qid in sec_qids if reviews.get(qid, {}).get("status") == "returned"]
        if sec_returned:
            state["status"] = "returned"
            returned_all.update(sec_returned)
        else:
            state["status"] = "completed"
    record["returned_questions"] = sorted(returned_all)
    refresh_record_status(record)
    return True


def review_question(record_id, revision, question_id, decision, feedback):
    """单题批阅；全部待审题均批完后自动结算整份记录。"""
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM worksheet_records WHERE id=?", (record_id,)).fetchone()
        if not row:
            raise WorksheetError("札记不存在。", 404)
        record = decode(row)
        if record["status"] not in {"pending", "in_progress", "correction", "returned"} or str(record["revision"]) != str(revision):
            raise WorksheetError("这份札记的状态已变化，请刷新后再审核。", 409)
        if decision not in {"approve", "return"} or len(feedback) > 2000:
            raise WorksheetError("批阅选项或评语长度不正确。")
        if decision == "return" and record["activity_id"] == "lesson-9-task-2":
            raise WorksheetError("9.2 收藏本札记仅支持通过或标为优秀。")
        if decision == "return" and not feedback.strip():
            raise WorksheetError("驳回这道题时，请填写修改建议。")
        if question_id not in _pending_reviewable_ids(record):
            raise WorksheetError("这道题当前不在待审核范围中。", 400)
        reviews = record.setdefault("question_reviews", {})
        reviews[question_id] = {
            "status": "approved" if decision == "approve" else "returned",
            "feedback": feedback.strip(),
        }
        settled = _settle_pending_sections(record)
        db.execute("""UPDATE worksheet_records SET status=?, returned_questions=?, question_reviews=?,
            revision=revision+1, updated_at=?, stage_states=?, definition=? WHERE id=?""",
            (record["status"], json.dumps(record["returned_questions"]),
             json.dumps(reviews, ensure_ascii=False), int(time.time()),
             json.dumps(record["stage_states"]),
             json.dumps(record["definition"], ensure_ascii=False), record_id))
        return {"settled": settled, "question_id": question_id}


def set_excellent(record_id, revision, excellent):
    """已完成且无客观题的札记可切换优秀标定。"""
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM worksheet_records WHERE id=?", (record_id,)).fetchone()
        if not row:
            raise WorksheetError("札记不存在。", 404)
        record = decode(row)
        if record["status"] != "completed" or str(record["revision"]) != str(revision):
            raise WorksheetError("这份札记的状态已变化，请刷新后再操作。", 409)
        if objective_questions(record["definition"]):
            raise WorksheetError("含固定答案题的金圈由首次正确率决定。")
        db.execute("UPDATE worksheet_records SET teacher_excellent=?, revision=revision+1, updated_at=? WHERE id=?",
                   (int(bool(excellent)), int(time.time()), record_id))


def review(record_id, revision, decision, feedback, returned):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM worksheet_records WHERE id=?", (record_id,)).fetchone()
        if not row:
            raise WorksheetError("札记不存在。", 404)
        record = decode(row)
        if record["status"] != "pending" or str(record["revision"]) != str(revision):
            raise WorksheetError("这份札记的状态已变化，请刷新后再审核。", 409)
        if decision not in {"approve", "excellent", "return"} or len(feedback) > 2000:
            raise WorksheetError("审核选项或评语长度不正确。")
        if decision == "return" and record["activity_id"] == "lesson-9-task-2":
            raise WorksheetError("9.2 收藏本札记仅支持通过或标为优秀。")
        if decision == "excellent" and objective_questions(record["definition"]):
            raise WorksheetError("含固定答案题的金圈由首次正确率决定，请选择通过。")
        pending_ids = _pending_reviewable_ids(record)
        reviews = record.setdefault("question_reviews", {})
        if decision == "return":
            allowed = set(pending_ids)
            if not returned or not set(returned) <= allowed or not feedback.strip():
                raise WorksheetError("驳回时请选择需要修改的主观题，并写明修改建议。")
            returned_set = set(returned)
            for qid in pending_ids:
                if qid in returned_set:
                    reviews[qid] = {"status": "returned", "feedback": reviews.get(qid, {}).get("feedback") or feedback.strip()}
                elif qid not in reviews:
                    reviews[qid] = {"status": "approved", "feedback": ""}
            _settle_pending_sections(record)
        else:
            if decision == "excellent" and any(reviews.get(qid, {}).get("status") == "returned" for qid in pending_ids):
                raise WorksheetError("已有题目被标为驳回，不能评定为优秀；请先改回通过。")
            for qid in pending_ids:
                if qid not in reviews:
                    reviews[qid] = {"status": "approved", "feedback": ""}
            _settle_pending_sections(record)
        next_feedback = feedback.strip() if feedback.strip() else record["feedback"]
        db.execute("""UPDATE worksheet_records SET status=?, feedback=?, returned_questions=?, question_reviews=?,
            teacher_excellent=?, revision=revision+1, updated_at=?, stage_states=?, definition=? WHERE id=?""",
            (record["status"], next_feedback,
             json.dumps(record["returned_questions"]),
             json.dumps(reviews, ensure_ascii=False),
             int(decision == "excellent"), int(time.time()), json.dumps(record["stage_states"]),
             json.dumps(record["definition"], ensure_ascii=False), record_id))
