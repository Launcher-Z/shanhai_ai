"""数据库连接与课堂数据表；每次操作结束后关闭连接。"""
import sqlite3
from contextlib import contextmanager
from flask import current_app


@contextmanager
def connect():
    db = sqlite3.connect(current_app.config["DATABASE"], timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA busy_timeout = 10000")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    # 与初版表结构一致，现有班级、学生和教师密码可直接使用。
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS classes (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
            registration_open INTEGER NOT NULL DEFAULT 1,
            progress_cap TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id),
            name TEXT NOT NULL, device_token TEXT, locked_until INTEGER NOT NULL DEFAULT 0,
            UNIQUE(class_id, name)
        );
        CREATE TABLE IF NOT EXISTS worksheet_records (
            id INTEGER PRIMARY KEY,
            student_id INTEGER NOT NULL REFERENCES students(id),
            activity_id TEXT NOT NULL,
            definition TEXT NOT NULL,
            answers TEXT NOT NULL DEFAULT '{}',
            first_answers TEXT,
            first_correct INTEGER,
            results TEXT NOT NULL DEFAULT '{}',
            stage_states TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'draft',
            feedback TEXT NOT NULL DEFAULT '',
            returned_questions TEXT NOT NULL DEFAULT '[]',
            question_reviews TEXT NOT NULL DEFAULT '{}',
            teacher_excellent INTEGER NOT NULL DEFAULT 0,
            revision INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            UNIQUE(student_id, activity_id)
        );
        CREATE INDEX IF NOT EXISTS worksheet_review_queue ON worksheet_records(status, student_id);
        CREATE TABLE IF NOT EXISTS animal_analysis_exclusions (
            record_id INTEGER NOT NULL REFERENCES worksheet_records(id) ON DELETE CASCADE,
            source_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
            PRIMARY KEY(record_id, source_id, fingerprint)
        );
        CREATE TABLE IF NOT EXISTS handwriting_samples (
            id INTEGER PRIMARY KEY,
            student_id INTEGER NOT NULL REFERENCES students(id),
            pixels TEXT NOT NULL,
            original_label INTEGER NOT NULL CHECK(original_label BETWEEN 0 AND 9),
            label INTEGER NOT NULL CHECK(label BETWEEN 0 AND 9),
            included INTEGER NOT NULL DEFAULT 0 CHECK(included IN (0,1)),
            created_at INTEGER NOT NULL,
            UNIQUE(student_id, pixels)
        );
        CREATE TABLE IF NOT EXISTS handwriting_datasets (
            id INTEGER PRIMARY KEY, digest TEXT NOT NULL, payload TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        """)
        # 从整张提交升级为分段提交，只增加状态列，保留已有答案、成绩和评语。
        class_columns = {row["name"] for row in db.execute("PRAGMA table_info(classes)")}
        if "progress_cap" not in class_columns:
            db.execute("ALTER TABLE classes ADD COLUMN progress_cap TEXT NOT NULL DEFAULT ''")
        columns = {row["name"] for row in db.execute("PRAGMA table_info(worksheet_records)")}
        if "stage_states" not in columns:
            db.execute("ALTER TABLE worksheet_records ADD COLUMN stage_states TEXT NOT NULL DEFAULT '{}'")
        if "question_reviews" not in columns:
            db.execute("ALTER TABLE worksheet_records ADD COLUMN question_reviews TEXT NOT NULL DEFAULT '{}'")
        from .creation import init_tables
        init_tables(db)
