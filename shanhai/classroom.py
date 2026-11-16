"""班级、学生和设备绑定规则。"""
import sqlite3
import time
from .database import connect

LOCK_SECONDS = 2 * 60 * 60


class ClassroomError(Exception):
    """适合直接提示给课堂用户的业务错误。"""


def list_classes():
    with connect() as db:
        return db.execute("SELECT c.*, COUNT(s.id) AS student_count FROM classes c LEFT JOIN students s ON s.class_id=c.id GROUP BY c.id ORDER BY c.id DESC").fetchall()


def login_student(class_id, name, device):
    name = name.strip()
    if not name or len(name) > 30 or not str(class_id).isdigit() or not 16 <= len(device) <= 100:
        raise ClassroomError("请选择班级、填写真实姓名，并允许浏览器保存本站数据。")
    now = int(time.time())
    with connect() as db:
        # 串行化同一时刻的建档和绑定，避免并发覆盖。
        db.execute("BEGIN IMMEDIATE")
        classroom = db.execute("SELECT * FROM classes WHERE id = ?", (class_id,)).fetchone()
        if not classroom:
            raise ClassroomError("班级不存在，请重新选择。")
        student = db.execute("SELECT * FROM students WHERE class_id = ? AND name = ?", (class_id, name)).fetchone()
        if not student:
            if not classroom["registration_open"]:
                raise ClassroomError("该班级已关闭新增账号，请检查姓名或联系老师。")
            cursor = db.execute("INSERT INTO students (class_id, name, device_token, locked_until) VALUES (?, ?, ?, ?)",
                                (class_id, name, device, now + LOCK_SECONDS))
            return cursor.lastrowid
        if student["device_token"] and student["device_token"] != device and student["locked_until"] > now:
            raise ClassroomError("该姓名正在另一台终端使用，请稍后再试或联系老师解除绑定。")
        db.execute("UPDATE students SET device_token = ?, locked_until = ? WHERE id = ?",
                   (device, now + LOCK_SECONDS, student["id"]))
        return student["id"]


def current_student(student_id, device):
    with connect() as db:
        student = db.execute("SELECT s.id, s.name, s.class_id, s.device_token, c.name AS class_name FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=?", (student_id,)).fetchone()
    return student if student and student["device_token"] == device else None


def class_roster(class_id):
    with connect() as db:
        classroom = db.execute("SELECT * FROM classes WHERE id=?", (class_id,)).fetchone()
        students = db.execute("SELECT * FROM students WHERE class_id=? ORDER BY id", (class_id,)).fetchall() if classroom else []
    return classroom, students


def create_class(name):
    name = name.strip()
    if not name or len(name) > 40:
        raise ClassroomError("班级名称须为 1—40 个字符。")
    try:
        with connect() as db:
            cursor = db.execute("INSERT INTO classes (name) VALUES (?)", (name,))
            return cursor.lastrowid
    except sqlite3.IntegrityError as exc:
        raise ClassroomError("班级名称已存在。") from exc


def rename_class(class_id, name):
    name = name.strip()
    if not name or len(name) > 40:
        raise ClassroomError("班级名称须为 1—40 个字符。")
    try:
        with connect() as db:
            row = db.execute("SELECT id FROM classes WHERE id=?", (class_id,)).fetchone()
            if not row:
                return False
            db.execute("UPDATE classes SET name=? WHERE id=?", (name, class_id))
            return True
    except sqlite3.IntegrityError as exc:
        raise ClassroomError("班级名称已存在。") from exc


def toggle_registration(class_id):
    with connect() as db:
        return db.execute("UPDATE classes SET registration_open=1-registration_open WHERE id=?", (class_id,)).rowcount > 0


def set_progress_cap(class_id, cap):
    from .worksheets import progress_nodes
    cap = (cap or "").strip()
    if cap and not any(node["key"] == cap for node in progress_nodes()):
        raise ClassroomError("所选进度卡点无效。")
    with connect() as db:
        return db.execute("UPDATE classes SET progress_cap=? WHERE id=?", (cap, class_id)).rowcount > 0


def add_students(class_id, text):
    names = [name.strip() for name in text.splitlines() if name.strip()]
    if not names or len(names) > 100 or any(len(name) > 30 for name in names):
        raise ClassroomError("请逐行输入学生姓名，每次不超过 100 人，每个姓名不超过 30 字。")
    with connect() as db:
        if not db.execute("SELECT id FROM classes WHERE id=?", (class_id,)).fetchone():
            return None
        before = db.total_changes
        db.executemany("INSERT OR IGNORE INTO students (class_id, name) VALUES (?, ?)", [(class_id, name) for name in names])
        return db.total_changes - before


def unlock_student(student_id):
    with connect() as db:
        student = db.execute("SELECT class_id FROM students WHERE id=?", (student_id,)).fetchone()
        if not student:
            return None
        db.execute("UPDATE students SET device_token=NULL, locked_until=0 WHERE id=?", (student_id,))
        return student["class_id"]


def rename_student(student_id, name):
    name = name.strip()
    if not name or len(name) > 30:
        raise ClassroomError("学生姓名须为 1—30 个字符。")
    try:
        with connect() as db:
            student = db.execute("SELECT class_id FROM students WHERE id=?", (student_id,)).fetchone()
            if not student:
                return None
            db.execute("UPDATE students SET name=? WHERE id=?", (name, student_id))
            return student["class_id"]
    except sqlite3.IntegrityError as exc:
        raise ClassroomError("同班内已存在该姓名学生。") from exc


def delete_student(student_id):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        student = db.execute("SELECT class_id FROM students WHERE id=?", (student_id,)).fetchone()
        if not student:
            return None
        for table in ("gallery_entries", "prompt_favorites", "creation_media", "handwriting_samples", "worksheet_records"):
            db.execute(f"DELETE FROM {table} WHERE student_id=?", (student_id,))
        db.execute("DELETE FROM students WHERE id=?", (student_id,))
        return student["class_id"]
