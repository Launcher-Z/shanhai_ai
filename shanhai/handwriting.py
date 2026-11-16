"""课堂手写样本：限额上传、教师整理、不可变版本发布。"""
import hashlib
import json
import time
from .database import connect


class SampleError(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


def checked_sample(item):
    if not isinstance(item, dict):
        raise SampleError("样本格式不正确。")
    label, pixels = item.get("label"), item.get("pixels")
    if type(label) is not int or not 0 <= label <= 9:
        raise SampleError("请确认每张笔迹对应的数字0—9。")
    if (not isinstance(pixels, list) or len(pixels) != 216
            or any(type(value) is not int or value not in (0, 1) for value in pixels)
            or not any(pixels)):
        raise SampleError("手写图片须为12×18非空二值点阵。")
    return label, "".join(map(str, pixels))


def own_samples(student_id):
    with connect() as db:
        rows = db.execute("SELECT id, original_label, pixels FROM handwriting_samples WHERE student_id=? ORDER BY id", (student_id,)).fetchall()
    return {"limit": 10, "samples": [{"id": row["id"], "label": row["original_label"],
            "pixels": list(map(int, row["pixels"]))} for row in rows]}


def upload(student_id, body):
    items = body.get("samples") if isinstance(body, dict) else None
    if not isinstance(items, list) or not 1 <= len(items) <= 10:
        raise SampleError("每次选择1—10张样本，每人累计最多10张。")
    unique = {}
    for item in items:
        label, pixels = checked_sample(item)
        if pixels in unique and unique[pixels] != label:
            raise SampleError("同一张笔迹不能标注为两个数字。")
        unique[pixels] = label
    with connect() as db:
        # 限额与插入在一个写事务内，双击或并发请求也不能突破10张。
        db.execute("BEGIN IMMEDIATE")
        existing = {row["pixels"] for row in db.execute("SELECT pixels FROM handwriting_samples WHERE student_id=?", (student_id,))}
        additions = [(pixels, label) for pixels, label in unique.items() if pixels not in existing]
        if len(existing) + len(additions) > 10:
            raise SampleError(f"每人累计最多10张，你已上传{len(existing)}张。")
        db.executemany("INSERT INTO handwriting_samples(student_id,pixels,original_label,label,created_at) VALUES (?,?,?,?,?)",
                       [(student_id, pixels, label, label, int(time.time())) for pixels, label in additions])
    return {**own_samples(student_id), "added": len(additions)}


def library(class_id=None, digit=None):
    sql = """SELECT h.*,s.name AS student_name,c.name AS class_name FROM handwriting_samples h
             JOIN students s ON s.id=h.student_id JOIN classes c ON c.id=s.class_id WHERE 1=1"""
    args = []
    if class_id is not None:
        sql += " AND c.id=?"; args.append(class_id)
    if digit is not None:
        sql += " AND h.label=?"; args.append(digit)
    scope_sql = """SELECT COUNT(*) AS scope_total, COALESCE(SUM(h.included),0) AS scope_included
                   FROM handwriting_samples h JOIN students s ON s.id=h.student_id WHERE 1=1"""
    scope_args = []
    if class_id is not None:
        scope_sql += " AND s.class_id=?"; scope_args.append(class_id)
    with connect() as db:
        rows = db.execute(sql + " ORDER BY h.label,h.id", args).fetchall()
        total = db.execute("SELECT COUNT(*) AS total,COALESCE(SUM(included),0) AS included FROM handwriting_samples").fetchone()
        scope = db.execute(scope_sql, scope_args).fetchone()
    return [dict(row) for row in rows], {**dict(total), **dict(scope)}


def update_sample(sample_id, label, included):
    if type(label) is not int or not 0 <= label <= 9 or type(included) is not bool:
        raise SampleError("请填写正确的数字标签和选用状态。")
    with connect() as db:
        if not db.execute("UPDATE handwriting_samples SET label=?,included=? WHERE id=?", (label, int(included), sample_id)).rowcount:
            raise SampleError("样本不存在。", 404)


def _clean_batch_items(items):
    if not isinstance(items, list) or not items:
        raise SampleError("没有需要保存的样本改动。")
    cleaned = []
    for item in items:
        if not isinstance(item, dict):
            raise SampleError("批量保存格式不正确。")
        sample_id, label, included = item.get("id"), item.get("label"), item.get("included")
        if type(sample_id) is not int or sample_id <= 0 or type(label) is not int or not 0 <= label <= 9 or type(included) is not bool:
            raise SampleError("请填写正确的样本数字标签和选用状态。")
        cleaned.append((label, int(included), sample_id))
    return cleaned


def _apply_batch_updates(db, cleaned):
    for label, included, sample_id in cleaned:
        if not db.execute("UPDATE handwriting_samples SET label=?,included=? WHERE id=?", (label, included, sample_id)).rowcount:
            raise SampleError("样本不存在。", 404)


def batch_update(items):
    cleaned = _clean_batch_items(items)
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        _apply_batch_updates(db, cleaned)
    return len(cleaned)


def _publish_in_db(db):
    rows = db.execute("SELECT id,label,pixels FROM handwriting_samples WHERE included=1 ORDER BY id").fetchall()
    unique = {}
    first_ids = {}
    for row in rows:
        if row["pixels"] in unique and unique[row["pixels"]] != row["label"]:
            raise SampleError(f"样本{first_ids[row['pixels']]}与样本{row['id']}笔迹相同但标签不同，请修正或取消选用后发布。")
        unique[row["pixels"]] = row["label"]
        first_ids.setdefault(row["pixels"], row["id"])
    if not unique:
        raise SampleError("先选用至少一张样本，再发布。")
    canonical = sorted(unique.items())
    digest = hashlib.sha256(json.dumps(canonical).encode()).hexdigest()
    previous = db.execute("SELECT * FROM handwriting_datasets ORDER BY id DESC LIMIT 1").fetchone()
    if previous and previous["digest"] == digest:
        return json.loads(previous["payload"])
    created_at = int(time.time())
    version = db.execute("INSERT INTO handwriting_datasets(digest,payload,created_at) VALUES (?,'',?)", (digest, created_at)).lastrowid
    samples = [{"id": f"B{version}-{index+1}", "label": label, "pixels": list(map(int, pixels))}
               for index, (pixels, label) in enumerate(canonical)]
    payload = {"schema": 1, "version": version, "createdAt": created_at, "width": 12, "height": 18,
               "count": len(samples), "counts": [sum(sample["label"] == digit for sample in samples) for digit in range(10)], "samples": samples}
    db.execute("UPDATE handwriting_datasets SET payload=? WHERE id=?", (json.dumps(payload, ensure_ascii=False), version))
    return payload


def publish():
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        return _publish_in_db(db)


def save_and_publish(items):
    """保存样本勾选与数字标签修正，并在同一事务中尝试发布最新数据集版本。"""
    cleaned = _clean_batch_items(items)
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        _apply_batch_updates(db, cleaned)
        try:
            data = _publish_in_db(db)
            return len(cleaned), data, None
        except SampleError as error:
            return len(cleaned), None, str(error)


def select_scope(included, class_id=None, digit=None):
    """教师可批量选用当前筛选范围，避免逐张提交数百次。"""
    if type(included) is not bool or (digit is not None and not 0 <= digit <= 9):
        raise SampleError("筛选范围不正确。")
    sql = "UPDATE handwriting_samples SET included=? WHERE 1=1"
    args = [int(included)]
    if class_id is not None:
        sql += " AND student_id IN (SELECT id FROM students WHERE class_id=?)"; args.append(class_id)
    if digit is not None:
        sql += " AND label=?"; args.append(digit)
    with connect() as db:
        return db.execute(sql, args).rowcount


def dataset(version=None):
    with connect() as db:
        row = (db.execute("SELECT payload FROM handwriting_datasets WHERE id=?", (version,)).fetchone() if version is not None
               else db.execute("SELECT payload FROM handwriting_datasets ORDER BY id DESC LIMIT 1").fetchone())
    if not row:
        if version is not None:
            raise SampleError("数据集版本不存在。", 404)
        return None
    return json.loads(row["payload"])
