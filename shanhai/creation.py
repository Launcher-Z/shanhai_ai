"""卷三的作品附件、展览与个人采集；札记仍由 worksheets 管理。"""
import io
import json
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit
from flask import current_app
from PIL import Image, ImageOps, UnidentifiedImageError
from .database import connect
from .worksheets import WorksheetError

ACTIVITIES = {'lesson-8-task-1', 'lesson-8-task-2', 'lesson-9-task-1', 'lesson-9-task-3'}
ATELIER_ACTIVITIES = (
    ('lesson-9-task-1', '9.1 灵气初创'),
    ('lesson-9-task-3', '9.3 作品定稿'),
)
ATELIER_ACTIVITY_IDS = {aid for aid, _ in ATELIER_ACTIVITIES}
GALLERY_ACTIVITIES = (
    ('lesson-9-task-1', '9.1 灵气初创'),
    ('lesson-8-task-2', '8.2 原文绘兽'),
    ('lesson-9-task-3', '9.3 作品定稿'),
)
GALLERY_ACTIVITY_IDS = {aid for aid, _ in GALLERY_ACTIVITIES}
BEASTS = [
    {'id': 'heluo', 'name': '何罗之鱼', 'text': '其中多何罗之鱼，一首而十身，其音如吠犬，食之已痈。', 'source': '北山经·谯明之山', 'features': ['一首', '十身'], 'image_id':'image-1', 'image':'/static/learning/creation/images/image-1.png'},
    {'id': 'lu', 'name': '鯥', 'text': '有鱼焉，其状如牛，陵居，蛇尾有翼，其羽在魼下，其音如留牛，其名曰鯥，冬死而夏生，食之无肿疾。', 'source': '南山经·柢山', 'features': ['状如牛', '蛇尾', '有翼'], 'image_id':'image-2', 'image':'/static/learning/creation/images/image-2.png'},
    {'id': 'tiangou', 'name': '天狗', 'text': '有兽焉，其状如狸而白首，名曰天狗，其音如榴榴，可以御凶。', 'source': '西山经·阴山', 'features': ['状如狸', '白首'], 'image_id':'image-3', 'image':'/static/learning/creation/images/image-3.png'},
    {'id': 'changyou', 'name': '长右', 'text': '有兽焉，其状如禺而四耳，其名长右，其音如吟，见则郡县大水。', 'source': '南山经·长右之山', 'features': ['状如禺', '四耳'], 'image_id':'image-4', 'image':'/static/learning/creation/images/image-4.png'},
    # 只供回看既有札记，不把无口羊原文与旧鱼图配对，也不改写历史提示词。
    {'id': 'huan', 'name': '䍺', 'text': '有兽焉，其状如羊而无口，不可杀也，其名曰䍺。', 'source': '南山经·洵山', 'features': ['状如羊', '无口'], 'selectable':False},
]
LIBRARY = [
    {'id': 'detail_compare', 'title': '灵气拆解 · 可见细节',
     'content': '少写“神秘、好看”等空泛词，把能力翻译成能画出来的形状、动作和光色。',
     'bad': '一只神秘好看的夜行猫，拥有神奇的引路能力',
     'good': '一只灰黑虎斑猫站在林间石阶上，尖耳竖起，尾尖散发柔和暖黄微光，像灯笼照亮前方小路',
     'phrases': ['尾尖发出暖色微光', '羽翼泛起朝霞红晕', '鹿角开出晶莹白花'],
     'url': 'https://open.bigmodel.cn/', 'source': '智谱·具体画面描述指南'},
    {'id': 'pose_scene', 'title': '姿态与环境', 'target': 'scene',
     'content': '先定好动物怎么站、怎么动，以及身处什么样的山海场景。',
     'phrases': [
         '静立石阶回望', '昂首啸月', '凌空振翅跃起', '伏卧松枝之上', '蜷卧花影石旁',
         '踏水泛起涟漪', '御风低空掠水', '踱步溪畔青苔', '穿行幽深竹林', '独立云雾山巅',
         '蹲坐古朴青瓦', '月夜松林石阶', '立于古寺灯下', '隐现林间雾霭',
     ],
     'url': 'https://docs.volcengine.com/docs/ark/seedream-4-0-5-0-prompt-guide?lang=zh', 'source': '火山引擎·提示词指南'},
    {'id': 'style', 'title': '风格与材质', 'target': 'visual',
     'content': '选定一种画风或传统工艺质感，不用堆砌“8K、超高清”。',
     'phrases': ['水墨画风', '工笔重彩', '青绿山水插画', '传统剪纸风格', '皮影戏风格', '敦煌壁画风格', '木刻版画风格', '像素插画', '粘土手办风格'],
     'options': [
         {'phrase': '水墨画风', 'effect': '黑白浓淡墨晕留白，虚实相生，颇具东方意境', 'preview_image': '/static/learning/creation/styles/ink.jpg'},
         {'phrase': '工笔重彩', 'effect': '勾线细腻工整、设色浓丽，古典细节丰富', 'preview_image': '/static/learning/creation/styles/gongbi.jpg'},
         {'phrase': '青绿山水插画', 'effect': '石青石绿与淡金点缀，清雅华贵如古画卷', 'preview_image': '/static/learning/creation/styles/blue-green.jpg'},
         {'phrase': '传统剪纸风格', 'effect': '红金镂空纹样叠衬，民俗装饰感强', 'preview_image': '/static/learning/creation/styles/paper-cut.jpg'},
         {'phrase': '皮影戏风格', 'effect': '半透明皮雕镂空配暖光幕布，古朴灵动', 'preview_image': '/static/learning/creation/styles/shadow-puppet.jpg'},
         {'phrase': '敦煌壁画风格', 'effect': '矿石青赭朱砂配色配飘逸纹饰，厚重神圣', 'preview_image': '/static/learning/creation/styles/dunhuang.jpg'},
         {'phrase': '木刻版画风格', 'effect': '刀刻木纹与强黑白对比，质感硬朗鲜明', 'preview_image': '/static/learning/creation/styles/woodcut.jpg'},
         {'phrase': '像素插画', 'effect': '复古点阵颗粒感，别具趣味的游戏风格', 'preview_image': '/static/learning/creation/styles/pixel.jpg'},
         {'phrase': '粘土手办风格', 'effect': '圆润微缩手作质感与柔和景深，呆萌立体', 'preview_image': '/static/learning/creation/styles/clay.jpg'},
     ],
     'url': 'https://cloud.tencent.com/document/product/1729/105846', 'source': '腾讯云·风格示例'},
    {'id': 'composition', 'title': '构图与视角', 'target': 'visual',
     'content': '近景突出细节；全景表现环境；平视、俯视、仰视改变观察角度。',
     'phrases': ['近景特写', '全身全景', '远景留白', '平视视角', '低角度仰视', '高角度俯视', '居中对称构图'],
     'url': 'https://help.aliyun.com/zh/model-studio/text-to-image-prompt', 'source': '阿里云·文生图提示词指南'},
    {'id': 'light', 'title': '光线与氛围', 'target': 'visual',
     'content': '说明光源位置与质感（如左侧窗光、林间光束、逆光轮廓），比“漂亮的光线”更稳定。',
     'phrases': ['清晨柔和侧光', '月光逆光轮廓', '林间丁达尔光束', '灯笼暖色点光', '水波微光反射', '薄雾朦胧光'],
     'url': 'https://help.aliyun.com/zh/model-studio/text-to-image-prompt', 'source': '阿里云·文生图提示词指南'},
    {'id': 'color', 'title': '色彩点睛', 'target': 'visual',
     'content': '用主色调配一处点睛亮色，避免颜色太多打架。',
     'phrases': ['冷色调为主，配一点暖金微光', '青绿配淡金', '水墨黑白配朱砂红点缀', '玄黑配赤金', '月白配青黛'],
     'options': [
         {'phrase': '冷色调为主，配一点暖金微光', 'effect': '青蓝暗夜衬托唯一暖光焦点，主次一目了然', 'preview_key': 'color_cold_gold'},
         {'phrase': '青绿配淡金', 'effect': '山水翠色中带细金勾边，雅致灵秀', 'preview_key': 'color_jade_gold'},
         {'phrase': '水墨黑白配朱砂红点缀', 'effect': '素净墨色里落一抹正红，十分醒目', 'preview_key': 'color_ink_red'},
         {'phrase': '玄黑配赤金', 'effect': '深沉夜黑与耀目金纹撞色，威严神秘', 'preview_key': 'color_black_gold'},
         {'phrase': '月白配青黛', 'effect': '淡雅清冷的浅白灰蓝，如月下仙兽', 'preview_key': 'color_moon_indigo'},
     ],
     'url': 'https://docs.volcengine.com/docs/ark/seedream-4-0-5-0-prompt-guide?lang=zh', 'source': '火山引擎·提示词指南'},
]
ANIMALS = [
    {'id': 'cat', 'name': '猫', 'image': '/static/learning/creation/animals/cat.jpg',
     'features': ['尖耳胡须', '夜视敏锐', '柔软长尾'],
     'hint': '夜行敏锐 → 为夜行者引路 → 尾尖透出暖色微光'},
    {'id': 'dog', 'name': '狗', 'image': '/static/learning/creation/animals/dog.jpg',
     'features': ['柔和垂耳', '嗅觉灵敏', '忠诚守护'],
     'hint': '嗅觉灵敏 → 追踪遗失之物 → 鼻尖与颈毛浮现金色微光'},
    {'id': 'tiger', 'name': '东北虎', 'image': '/static/learning/creation/animals/tiger.jpg',
     'features': ['额前王纹', '橙黑条纹', '健硕虎爪'],
     'hint': '威猛镇山 → 呼唤山风护林 → 黑色虎纹流动青色风纹'},
    {'id': 'panda', 'name': '大熊猫', 'image': '/static/learning/creation/animals/panda.jpg',
     'features': ['黑白毛色', '标志性黑眼圈', '爱抱竹枝'],
     'hint': '爱食翠竹 → 催生竹林新芽 → 掌心踏过之处长出嫩竹'},
    {'id': 'ibis', 'name': '朱鹮', 'image': '/static/learning/creation/animals/ibis.jpg',
     'features': ['朱红面颊', '长而弯的黑喙', '粉白羽翼'],
     'hint': '展翅报喜 → 带来晴朗与丰年 → 翼梢羽毛泛起朝霞红晕'},
    {'id': 'monkey', 'name': '金丝猴', 'image': '/static/learning/creation/animals/monkey.jpg',
     'features': ['金黄长毛', '蓝色面庞', '长尾跃枝'],
     'hint': '林间飞跃 → 采摘云雾灵草 → 长毛随风飘起金色光尘'},
    {'id': 'snow-leopard', 'name': '雪豹', 'image': '/static/learning/creation/animals/snow-leopard.jpg',
     'features': ['灰白毛色配黑斑', '粗长厚尾', '踏雪无声'],
     'hint': '踏雪攀崖 → 平息风雪迷雾 → 尾端扫过扬起星点冰晶'},
    {'id': 'deer', 'name': '梅花鹿', 'image': '/static/learning/creation/animals/deer.jpg',
     'features': ['分叉鹿角', '背生白梅花斑', '修长四肢'],
     'hint': '穿行幽谷 → 指引山林清泉 → 鹿角开出晶莹白花，花斑泛微光'},
    {'id': 'koi', 'name': '锦鲤', 'image': '/static/learning/creation/animals/koi.jpg',
     'features': ['红白金鳞片', '口角长须', '宽大尾鳍'],
     'hint': '逆流跃水 → 化雨润泽田野 → 尾鳍划过水面留下一道金涟漪'},
    {'id': 'bat', 'name': '蝙蝠', 'image': '/static/learning/creation/animals/bat.jpg',
     'features': ['宽大翼膜', '灵敏大耳', '夜飞听声辨位'],
     'hint': '听声辨路 → 听见远方呼唤 → 翼膜脉络浮现淡蓝声波微光'},
]


def init_tables(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS creation_media (
      id TEXT PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id),
      activity_id TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
      size INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS gallery_entries (
      id TEXT PRIMARY KEY, record_id INTEGER NOT NULL REFERENCES worksheet_records(id),
      student_id INTEGER NOT NULL REFERENCES students(id), work_key TEXT NOT NULL,
      media_id TEXT NOT NULL REFERENCES creation_media(id), snapshot TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, staged INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      UNIQUE(record_id, work_key));
    CREATE TABLE IF NOT EXISTS prompt_favorites (
      id TEXT PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id),
      source_type TEXT NOT NULL, source_id TEXT NOT NULL, snapshot TEXT NOT NULL,
      content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS favorites_owner ON prompt_favorites(student_id, updated_at);
    ''')
    cols = {row['name'] for row in db.execute("PRAGMA table_info(gallery_entries)").fetchall()}
    if 'staged' not in cols:
        db.execute("ALTER TABLE gallery_entries ADD COLUMN staged INTEGER NOT NULL DEFAULT 1")
        db.execute("UPDATE gallery_entries SET staged = active")


def media_path(media_id, thumbnail=False):
    # ID 不来自文件路径，读取前还必须核对数据库及权限。
    extension = '.png' if media_id.startswith('p_') else '.jpg'
    return Path(current_app.config['DATA_DIR']) / 'creation' / ('thumbnails' if thumbnail else 'media') / (media_id + extension)


def upload(student_id, activity_id, file):
    if activity_id not in (ACTIVITIES | {'lesson-3-task-2'}) or activity_id == 'lesson-8-task-1' or file is None:
        raise WorksheetError('请选择需要提交的作品图片。')
    raw = file.stream.read(12 * 1024 * 1024 + 1)
    if len(raw) > 12 * 1024 * 1024:
        raise WorksheetError('图片请控制在12MB以内。')
    try:
        with Image.open(io.BytesIO(raw)) as original:
            if original.format not in {'PNG', 'JPEG', 'WEBP'} or original.width * original.height > 25000000 or getattr(original, 'n_frames', 1) != 1:
                raise ValueError()
            image = ImageOps.exif_transpose(original)
            # 先缩小再补白底，避免同时上传大照片时分配多份全尺寸像素。
            image.thumbnail((1600, 1600))
            image = image.convert('RGBA')
            background = Image.new('RGB', image.size, 'white')
            background.paste(image, mask=image.getchannel('A'))
            background.thumbnail((1600, 1600))
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise WorksheetError('请选择静态PNG、JPEG或WebP图片，像素总数不超过2500万。')
    media_id = 'm_' + uuid.uuid4().hex
    path, thumb = media_path(media_id), media_path(media_id, True)
    path.parent.mkdir(parents=True, exist_ok=True)
    thumb.parent.mkdir(parents=True, exist_ok=True)
    try:
        background.save(path, quality=85, optimize=True)
        width, height = background.size
        background.thumbnail((360, 360))
        background.save(thumb, quality=82, optimize=True)
        with connect() as db:
            db.execute('INSERT INTO creation_media VALUES (?,?,?,?,?,?,?)', (media_id, student_id, activity_id, width, height, path.stat().st_size, int(time.time())))
    except Exception:
        path.unlink(missing_ok=True)
        thumb.unlink(missing_ok=True)
        raise
    return {'media_id': media_id, 'activity_id': activity_id, 'width': width, 'height': height,
            'image_url': '/api/creation/media/' + media_id, 'thumbnail_url': '/api/creation/media/' + media_id + '/thumbnail'}


def can_read_media(db, media_id, student_id=None, teacher=False):
    row = db.execute('SELECT * FROM creation_media WHERE id=?', (media_id,)).fetchone()
    if not row:
        return False
    if teacher or row['student_id'] == student_id:
        return True
    if row['activity_id'] == 'lesson-3-task-2':
        return False  # 优化实验的证据只允许作者与教师读取，不进入展览。
    if not student_id:
        return False
    if row['activity_id'] in {'lesson-1-task-2', 'lesson-1-task-3'}:
        from .pixel_paint import approved_media
        # 1.2 与 1.3 像素画未入展前仅作者和教师可见；教师选中发布后开放跨班观摩。
        return approved_media(db, media_id, student_id)
    # 9.2 已入展作品允许全校有效学生跨班浏览；未发布或已撤下的媒体仍仅作者和教师可见。
    return bool(db.execute('''SELECT 1 FROM gallery_entries g
        JOIN students viewer ON viewer.id=? WHERE g.media_id=? AND g.active=1''', (student_id, media_id)).fetchone())


def validate_record(kind, value, db, student_id, activity_id, required=False):
    """暂存允许缺项，提交校验业务字段；任何阶段都禁止越权引用附件。"""
    if kind == 'training_evidence':
        from .training_evidence import validate
        return validate(value, db, student_id, activity_id, required)
    if kind == 'pixel':
        from .pixel_paint import validate_work
        return validate_work(value, db, student_id, activity_id, required)
    if not value:
        if required:
            raise WorksheetError('请填写创作记录。')
        return
    try:
        data = json.loads(value)
    except (ValueError, TypeError):
        raise WorksheetError('创作记录格式无效，请重新打开札记。')
    if not isinstance(data, dict) or type(data.get('schema_version')) is not int or data.get('schema_version') != 1:
        raise WorksheetError('创作记录版本无效。')

    def fields(obj, allowed):
        if not isinstance(obj, dict) or set(obj) - set(allowed.split()):
            raise WorksheetError('创作记录包含不支持的字段。')

    allowed = ('schema_version observations' if kind == 'recognition' else
               'schema_version evaluation media_id beast_id' if kind == 'original_rating' else
               'schema_version evaluation media_id animal_name' if kind == 'draft_rating' else
               'schema_version beast_id works' if kind == 'original_upload' else
               'schema_version animal_id animal_name works' if kind == 'draft_upload' else
               'schema_version works' if kind == 'portfolio_upload' else
               'schema_version ai_review' if kind == 'portfolio_reflection' else
               'schema_version works ai_review beast_id evaluation')
    fields(data, allowed)

    def text(obj, key, needed=False, limit=12000):
        result = obj.get(key, '')
        if not isinstance(result, str) or len(result) > limit or (needed and not result.strip()):
            raise WorksheetError('请补全记录中的文字，且不要超过字段长度。')
        return result

    def validate_rating(score_keys, upload_qid, prompt_error, missing_upload_error, match_field=None):
        evaluation = data.get('evaluation', {})
        fields(evaluation, ' '.join(score_keys) + ' detail')
        for key in score_keys:
            score = evaluation.get(key)
            if score is None and not required:
                continue
            if type(score) is not int or not 0 <= score <= 5:
                raise WorksheetError('请为三个维度各选择0—5分，0分也可以。')
        text(evaluation, 'detail', required, 2000)
        # 评分始终对应已提交的上传部分，不接受客户端另传其他图片。
        row = db.execute('SELECT answers,stage_states FROM worksheet_records WHERE student_id=? AND activity_id=?', (student_id, activity_id)).fetchone()
        if not row or not json.loads(row['stage_states']).get('upload', {}).get('submitted'):
            raise WorksheetError(missing_upload_error)
        upload = record_data(json.loads(row['answers']).get(upload_qid))
        media_id = text(data, 'media_id', required, 80)
        if match_field:
            text(data, match_field, required, 80)
        mismatch = not upload.get('works') or upload['works'][0]['media_id'] != media_id
        if match_field and upload.get(match_field) != data.get(match_field):
            mismatch = True
        if required and mismatch:
            raise WorksheetError(prompt_error)
        if media_id and not db.execute('SELECT 1 FROM creation_media WHERE id=? AND student_id=? AND activity_id=?', (media_id, student_id, activity_id)).fetchone():
            raise WorksheetError('评分对应的作品无权访问。', 403)

    if kind == 'original_rating':
        validate_rating(
            ('accuracy', 'spirit', 'expression'),
            'original-upload',
            '上传作品已更新，请重新评价当前上传的作品。',
            '请先提交“上传作品”，再给这张作品打分。',
            match_field='beast_id',
        )
        return

    if kind == 'draft_rating':
        validate_rating(
            ('feature_keep', 'magical_detail', 'visual_harmony'),
            'draft-upload',
            '上传作品已更新，请重新评价当前上传的初稿。',
            '请先提交“上传初稿与提示词”，再完成自评。',
        )
        return

    if kind == 'portfolio_reflection':
        row = db.execute('SELECT answers,stage_states FROM worksheet_records WHERE student_id=? AND activity_id=?', (student_id, activity_id)).fetchone()
        if not row or not json.loads(row['stage_states']).get('upload', {}).get('submitted'):
            raise WorksheetError('请先提交“上传定稿作品”，再完成反思。')
        upload = record_data(json.loads(row['answers']).get('final-upload'))
        works = upload.get('works', [])
        optimized = [w['key'] for w in works if w.get('ai_optimization', {}).get('used')]
        allowed_keys = optimized if optimized else [w['key'] for w in works]
        review = data.get('ai_review')
        if review is None:
            if required:
                raise WorksheetError('请选择实际效果是否符合预期，并填写一次复盘反思。')
            return
        if not isinstance(review, dict):
            raise WorksheetError('反思格式无效。')
        fields(review, 'work_key change_and_choice expectation actual_result match next_adjustment')
        wkey = review.get('work_key', '')
        if wkey and wkey not in allowed_keys:
            raise WorksheetError('反思需要对应一份使用过AI优化的作品。' if optimized else '反思需要对应一份已提交的作品。')
        if required and not wkey:
            raise WorksheetError('请选择本次反思对应的作品。')
        text(review, 'change_and_choice', required, 4000)
        for key in ('expectation', 'actual_result', 'next_adjustment'):
            text(review, key, False, 4000)
        if review.get('match', '') not in ('', 'met', 'partial', 'unmet') or (required and not review.get('match')):
            raise WorksheetError('请选择实际效果是否符合预期。')
        return

    if kind == 'draft_upload':
        text(data, 'animal_id', False, 80)
        text(data, 'animal_name', False, 80)

    if kind == 'recognition':
        rows = data.get('observations', [])
        if not isinstance(rows, list) or len(rows) > 4:
            raise WorksheetError('识图记录格式无效。')
        ids = []
        for row in rows:
            if not isinstance(row, dict) or row.get('image_id') not in ['image-1','image-2','image-3','image-4']:
                raise WorksheetError('请选择编号图片。')
            fields(row, 'image_id features ai_answer verification')
            ids.append(row['image_id'])
            text(row, 'features')
            for key in ('ai_answer','verification'):
                text(row, key, required)
        if len(ids) != len(set(ids)) or (required and len(ids) != 4):
            raise WorksheetError('请完成四张编号图片的核对记录。')
        return
    works = data.get('works', [])
    maximum = 3 if kind in {'portfolio', 'portfolio_upload'} else 1
    if not isinstance(works, list) or len(works) > maximum or (required and not works):
        raise WorksheetError(f'请提交1—{maximum}份图词对应的作品。')
    keys, optimized = [], []
    for work in works:
        if not isinstance(work, dict):
            raise WorksheetError('作品格式无效。')
        fields(work, 'key title media_id prompt tool ai_optimization')
        keys.append(text(work, 'key', True, 80))
        for key in ('title', 'prompt'):
            text(work, key, required)
        mid = text(work, 'media_id', required, 80)
        if mid and not db.execute('SELECT 1 FROM creation_media WHERE id=? AND student_id=? AND activity_id=?', (mid, student_id, activity_id)).fetchone():
            raise WorksheetError('作品图片不属于当前学生或活动，请重新选择。', 403)
        tool = work.get('tool', {})
        if not isinstance(tool, dict) or tool.get('mode', 'external') not in ('external','internal'):
            raise WorksheetError('工具信息无效。')
        fields(tool, 'mode name model')
        text(tool, 'name', required, 200)
        text(tool, 'model', False, 200)
        ai = work.get('ai_optimization', {'used': False})
        if not isinstance(ai, dict) or type(ai.get('used')) is not bool:
            raise WorksheetError('请选择是否使用过AI优化提示词。')
        fields(ai, 'used mode tool_name original_prompt suggested_prompt')
        for key in ('tool_name','original_prompt','suggested_prompt'):
            text(ai, key)
        if ai['used']:
            optimized.append(work['key'])
            text(ai, 'tool_name', False, 200)
            for key in ('original_prompt','suggested_prompt'):
                text(ai, key, required)
            if ai.get('mode', 'external') not in ('external','internal'):
                raise WorksheetError('优化工具模式无效。')
    if len(keys) != len(set(keys)):
        raise WorksheetError('作品编号不能重复。')
    if kind in {'original','original_upload'}:
        beast = next((b for b in BEASTS if b['id'] == data.get('beast_id')), None)
        if not beast and required:
            raise WorksheetError('请选择本次使用的原文。')
        if beast and works and required and works[0].get('prompt') != beast['text']:
            raise WorksheetError('原文直出任务请使用平台提供的完整原文。')
        if kind == 'original_upload':
            if any(w.get('ai_optimization', {}).get('used') for w in works):
                raise WorksheetError('原文直出不经过AI改写。')
            return
        evaluation = data.get('evaluation', {})
        if not isinstance(evaluation, dict):
            raise WorksheetError('评价格式无效。')
        fields(evaluation, 'accuracy spirit expression detail errors')
        for key in ('accuracy','spirit','expression'):
            if evaluation.get(key, '') not in ('', 'met','partial','unmet') or (required and not evaluation.get(key)):
                raise WorksheetError('请完成三项结构化简评。')
        text(evaluation, 'detail', required, 2000)
        errors = evaluation.get('errors', [])
        if not isinstance(errors, list) or any(not beast or e not in beast['features'] for e in errors):
            raise WorksheetError('请核对遗漏或错误特征。')
    review = data.get('ai_review')
    if review is not None:
        if not isinstance(review, dict) or review.get('work_key') not in optimized:
            raise WorksheetError('反思需要对应一份使用过AI优化的作品。')
        fields(review, 'work_key change_and_choice expectation actual_result match next_adjustment')
        text(review, 'change_and_choice', required, 4000)
        for key in ('expectation','actual_result','next_adjustment'):
            text(review, key, False, 4000)
        if review.get('match', '') not in ('', 'met','partial','unmet'):
            raise WorksheetError('请选择实际效果是否符合预期。')
    if required and kind == 'portfolio' and optimized and (not review or not review.get('match') or not review.get('change_and_choice', '').strip()):
        raise WorksheetError('使用过AI优化，请完成一次轻量使用反思；舍弃建议也需要记录。')


def record_data(value):
    try:
        data = json.loads(value)
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}


def gallery(student_id, offset=0, class_id=None, activity_id=None):
    if activity_id and activity_id not in GALLERY_ACTIVITY_IDS:
        raise WorksheetError('任务标签不存在。')
    # 8.2 展示区独立位于 8.2 活动下方；9.2 展台仅展示 9.1 与 9.3。
    scoped_activities = (('lesson-8-task-2', '8.2 原文绘兽'),) if activity_id == 'lesson-8-task-2' else ATELIER_ACTIVITIES
    scoped_ids = tuple(aid for aid, _ in scoped_activities)
    placeholders = ','.join('?' for _ in scoped_ids)
    with connect() as db:
        params = [student_id, *scoped_ids]
        filters = ["g.active=1", "substr(g.media_id,1,2)!='p_'", f"r.activity_id IN ({placeholders})"]
        if class_id is not None:
            filters.append('c.id=?')
            params.append(class_id)
        if activity_id:
            filters.append('r.activity_id=?')
            params.append(activity_id)
        where_sql = ' AND '.join(filters)
        params.append(offset)
        rows = db.execute(f'''SELECT g.*, r.activity_id, s.name, c.id class_id, c.name class_name
          FROM gallery_entries g
          JOIN worksheet_records r ON r.id=g.record_id
          JOIN students s ON s.id=g.student_id
          JOIN classes c ON c.id=s.class_id
          JOIN students viewer ON viewer.id=?
          WHERE {where_sql}
          ORDER BY g.created_at DESC, g.id LIMIT 24 OFFSET ?''', params).fetchall()
        cls_filters = ["g.active=1", "substr(g.media_id,1,2)!='p_'", f"r.activity_id IN ({placeholders})"]
        cls_params = [student_id, *scoped_ids]
        if activity_id:
            cls_filters.append('r.activity_id=?')
            cls_params.append(activity_id)
        class_rows = db.execute(f'''SELECT DISTINCT c.id, c.name
          FROM gallery_entries g
          JOIN worksheet_records r ON r.id=g.record_id
          JOIN students s ON s.id=g.student_id
          JOIN classes c ON c.id=s.class_id
          JOIN students viewer ON viewer.id=?
          WHERE {' AND '.join(cls_filters)}
          ORDER BY c.id''', cls_params).fetchall()
        act_rows = db.execute(f'''SELECT DISTINCT r.activity_id
          FROM gallery_entries g
          JOIN worksheet_records r ON r.id=g.record_id
          JOIN students viewer ON viewer.id=?
          WHERE g.active=1 AND substr(g.media_id,1,2)!='p_' AND r.activity_id IN ({placeholders})''',
          (student_id, *scoped_ids)).fetchall()
    entries = [
        dict(id=r['id'], author=r['name'], class_id=r['class_id'], class_name=r['class_name'],
             activity_id=r['activity_id'], **json.loads(r['snapshot']))
        for r in rows
    ]
    classes = [{'id': r['id'], 'name': r['name']} for r in class_rows]
    active_ids = {r['activity_id'] for r in act_rows}
    activities = [{'id': aid, 'label': label} for aid, label in scoped_activities if aid in active_ids]
    return {'entries': entries, 'classes': classes, 'activities': activities}


def approved_work_snapshot(db, record_id, work_key, expected_activity_id=None):
    row = db.execute('SELECT * FROM worksheet_records WHERE id=?', (record_id,)).fetchone()
    if not row:
        raise WorksheetError('札记不存在。', 404)
    record = dict(row)
    if expected_activity_id and record['activity_id'] != expected_activity_id:
        raise WorksheetError('所选作品不属于当前活动。')
    definition, stages, answers = (json.loads(record[k]) for k in ('definition', 'stage_states', 'answers'))
    selected = None
    for section in definition['sections']:
        # 先由教师审核通过，再选入/发布；待审与驳回的作品不能入展。
        if stages.get(section['id'], {}).get('status') != 'completed':
            continue
        for q in section['questions']:
            if q.get('record_form'):
                selected = next((w for w in record_data(answers.get(q['id'])).get('works', []) if w['key'] == work_key), selected)
    if not selected or not selected.get('media_id'):
        raise WorksheetError('请先审核通过作品所在的札记分段，再发布展览。')
    snapshot = {k: selected.get(k, '') for k in ('key', 'title', 'media_id', 'prompt', 'tool')}
    return record, snapshot


def publish(record_id, work_key):
    with connect() as db:
        record, snapshot = approved_work_snapshot(db, record_id, work_key)
        db.execute('''INSERT INTO gallery_entries(id,record_id,student_id,work_key,media_id,snapshot,active,staged,created_at)
          VALUES(?,?,?,?,?,?,1,1,?) ON CONFLICT(record_id,work_key) DO UPDATE SET media_id=excluded.media_id,
          snapshot=excluded.snapshot,active=1,staged=1,created_at=excluded.created_at''',
          ('g_'+uuid.uuid4().hex, record_id, record['student_id'], work_key, snapshot['media_id'], json.dumps(snapshot,ensure_ascii=False), int(time.time())))


def save_selection(activity_id, items):
    if activity_id not in GALLERY_ACTIVITY_IDS:
        raise WorksheetError('活动标识不正确。')
    if not isinstance(items, list) or not items:
        raise WorksheetError('没有需要保存的作品改动。')
    cleaned = []
    for item in items:
        if not isinstance(item, dict):
            raise WorksheetError('批量保存格式不正确。')
        record_id, work_key, included = item.get('record_id'), item.get('work_key'), item.get('included')
        if type(record_id) is not int or record_id <= 0 or not isinstance(work_key, str) or not work_key or type(included) is not bool:
            raise WorksheetError('作品入选参数不正确。')
        cleaned.append((record_id, work_key, included))
    now = int(time.time())
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        for record_id, work_key, included in cleaned:
            if included:
                record, snapshot = approved_work_snapshot(db, record_id, work_key, expected_activity_id=activity_id)
                db.execute('''INSERT INTO gallery_entries(id,record_id,student_id,work_key,media_id,snapshot,active,staged,created_at)
                  VALUES(?,?,?,?,?,?,1,1,?) ON CONFLICT(record_id,work_key) DO UPDATE SET
                  media_id=excluded.media_id,snapshot=excluded.snapshot,staged=1,active=1,
                  created_at=CASE WHEN gallery_entries.active=0 THEN excluded.created_at ELSE gallery_entries.created_at END''',
                  ('g_'+uuid.uuid4().hex, record_id, record['student_id'], work_key, snapshot['media_id'], json.dumps(snapshot, ensure_ascii=False), now))
            else:
                db.execute('UPDATE gallery_entries SET staged=0,active=0 WHERE record_id=? AND work_key=?', (record_id, work_key))
        # 若历史上存在已选中但尚未发布的作品，保存时一并对齐。
        db.execute('''UPDATE gallery_entries
          SET active=staged, created_at=CASE WHEN staged=1 AND active=0 THEN ? ELSE created_at END
          WHERE substr(media_id,1,2)!='p_' AND active!=staged
            AND record_id IN (SELECT id FROM worksheet_records WHERE activity_id=?)''', (now, activity_id))
        active_count = db.execute('''SELECT COUNT(*) FROM gallery_entries g
          JOIN worksheet_records r ON r.id=g.record_id
          WHERE g.active=1 AND substr(g.media_id,1,2)!='p_' AND r.activity_id=?''', (activity_id,)).fetchone()[0]
    return len(cleaned), active_count


def publish_activity(activity_id):
    if activity_id not in GALLERY_ACTIVITY_IDS:
        raise WorksheetError('活动标识不正确。')
    now = int(time.time())
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('''UPDATE gallery_entries
          SET active=1, created_at=CASE WHEN active=0 THEN ? ELSE created_at END
          WHERE staged=1 AND substr(media_id,1,2)!='p_'
            AND record_id IN (SELECT id FROM worksheet_records WHERE activity_id=?)''', (now, activity_id))
        db.execute('''UPDATE gallery_entries
          SET active=0
          WHERE staged=0 AND active=1 AND substr(media_id,1,2)!='p_'
            AND record_id IN (SELECT id FROM worksheet_records WHERE activity_id=?)''', (activity_id,))
        count = db.execute('''SELECT COUNT(*) FROM gallery_entries g
          JOIN worksheet_records r ON r.id=g.record_id
          WHERE g.active=1 AND substr(g.media_id,1,2)!='p_' AND r.activity_id=?''', (activity_id,)).fetchone()[0]
    return count


def favorites(student_id):
    with connect() as db:
        rows = db.execute('SELECT * FROM prompt_favorites WHERE student_id=? ORDER BY updated_at DESC,id', (student_id,)).fetchall()
    return [dict(r, snapshot=json.loads(r['snapshot'])) for r in rows]


def favorites_payload(db, student_id):
    rows = db.execute('SELECT snapshot, content FROM prompt_favorites WHERE student_id=? ORDER BY updated_at DESC, id', (student_id,)).fetchall()
    items = []
    for r in rows:
        snap = json.loads(r['snapshot'])
        items.append({'source': snap.get('title') or snap.get('source') or '个人笔记',
                      'author': snap.get('author', ''), 'content': r['content']})
    return json.dumps({'schema_version': 1, 'favorites': items}, ensure_ascii=False)


def sync_collection_worksheet(db, student_id, now):
    """9.2 收藏即自动等待教师查看；已通过/优秀后允许学生继续增改，圈色保持不变。"""
    from .worksheets import definition_for
    row = db.execute("SELECT id, status, revision FROM worksheet_records WHERE student_id=? AND activity_id='lesson-9-task-2'", (student_id,)).fetchone()
    if row and row['status'] == 'completed':
        return
    count = db.execute('SELECT COUNT(*) FROM prompt_favorites WHERE student_id=?', (student_id,)).fetchone()[0]
    if count > 0:
        stages = json.dumps({'favorites': {'submitted': True, 'status': 'pending', 'first_correct': 0}})
        first_answers = json.dumps({'collection-notes': 'favorites'})
        if not row:
            definition = json.dumps(definition_for('lesson-9-task-2', student_id=student_id), ensure_ascii=False)
            db.execute('''INSERT INTO worksheet_records
                (student_id, activity_id, definition, answers, first_answers, first_correct, results,
                 stage_states, status, feedback, returned_questions, teacher_excellent, revision, updated_at)
                VALUES (?, 'lesson-9-task-2', ?, '{}', ?, 0, '{}', ?, 'pending', '', '[]', 0, 1, ?)''',
                (student_id, definition, first_answers, stages, now))
        elif row['status'] != 'pending':
            db.execute("UPDATE worksheet_records SET status='pending', first_answers=?, stage_states=?, revision=revision+1, updated_at=? WHERE id=?",
                (first_answers, stages, now, row['id']))
        else:
            db.execute('UPDATE worksheet_records SET updated_at=? WHERE id=?', (now, row['id']))
    elif row and row['status'] != 'draft':
        stages = json.dumps({'favorites': {'submitted': False, 'status': 'draft', 'first_correct': 0}})
        db.execute("UPDATE worksheet_records SET status='draft', first_answers=NULL, stage_states=?, revision=revision+1, updated_at=? WHERE id=?",
            (stages, now, row['id']))


def save_favorite(student_id, payload, item_id=None, delete=False):
    if not isinstance(payload, dict):
        raise WorksheetError('笔记格式无效。')
    now = int(time.time())
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        if item_id:
            row = db.execute('SELECT * FROM prompt_favorites WHERE id=? AND student_id=?', (item_id,student_id)).fetchone()
            if not row:
                raise WorksheetError('笔记不存在。',404)
            if payload.get('revision') != row['revision']:
                raise WorksheetError('笔记已更新，请刷新后再编辑。',409)
            if delete:
                db.execute('DELETE FROM prompt_favorites WHERE id=?', (item_id,))
                sync_collection_worksheet(db, student_id, now)
                return
        content = payload.get('content')
        if not isinstance(content, str) or not content.strip() or len(content)>12000:
            raise WorksheetError('请输入需要保存的内容（最多12000字）。')
        if item_id:
            db.execute('UPDATE prompt_favorites SET content=?,revision=revision+1,updated_at=? WHERE id=?', (content.strip(),now,item_id))
            sync_collection_worksheet(db, student_id, now)
            return
        kind, source = payload.get('source_type','manual'), payload.get('source_id','')
        if not isinstance(kind,str) or not isinstance(source,str) or len(source)>100:
            raise WorksheetError('收藏来源无效。')
        snapshot = {}
        if kind == 'gallery':
            r = db.execute('''SELECT g.snapshot, s.name, c.name class_name
              FROM gallery_entries g
              JOIN students s ON s.id=g.student_id
              JOIN classes c ON c.id=s.class_id
              WHERE g.id=? AND g.active=1 AND substr(g.media_id,1,2)!='p_'
              ''', (source,)).fetchone()
            if not r:
                raise WorksheetError('来源作品已撤下或无权访问。', 404)
            snapshot = dict(json.loads(r['snapshot']), author=r['name'], class_name=r['class_name'])
        elif kind == 'library':
            snapshot = next((item for item in LIBRARY if item['id']==source), None)
            if not snapshot:
                raise WorksheetError('参考来源不存在。')
        elif kind != 'manual' or not isinstance(source,str):
            raise WorksheetError('收藏来源无效。')
        db.execute('INSERT INTO prompt_favorites VALUES(?,?,?,?,?,?,1,?,?)',
          ('f_'+uuid.uuid4().hex,student_id,kind,source,json.dumps(snapshot,ensure_ascii=False),content.strip(),now,now))
        sync_collection_worksheet(db, student_id, now)


def tool_settings():
    """读取卷三外部工具入口与服务器AI能力状态；密钥不返回浏览器。"""
    defaults = {
        'recognize': 'https://wenxin.baidu.com/',
        'optimize': 'https://wenxin.baidu.com/',
        'generate': 'https://wenxin.baidu.com/',
    }
    with connect() as db:
        row = db.execute("SELECT value FROM settings WHERE key='creation_tools'").fetchone()
    urls = json.loads(row['value']) if row else defaults
    for key in ('recognize', 'generate', 'optimize'):
        if urlsplit(urls.get(key, '')).hostname in {'doubao.com', 'www.doubao.com', 'chat.deepseek.com'}:
            urls[key] = defaults[key]
    from .creation_ai import capability
    return {key: {'mode': 'internal' if capability(key) else 'external', 'external_url': urls.get(key, defaults[key])} for key in defaults}


def teacher_works(class_id=None):
    """按活动聚合卷三已提交作品（含待审、已审与驳回）、暂存入选状态及当前展项，支持按班级过滤。"""
    creation_activities = ('lesson-8-task-2', 'lesson-9-task-1', 'lesson-9-task-3')
    works_by_activity = {aid: [] for aid in creation_activities}
    entries_by_activity = {aid: [] for aid in creation_activities}
    stats_by_activity = {
        aid: {
            'scope_total': 0, 'scope_staged': 0, 'scope_pending': 0, 'scope_returned': 0,
            'scope_submitted': 0, 'total': 0, 'staged': 0, 'active': 0,
        }
        for aid in creation_activities
    }
    gallery_total_active = 0
    with connect() as db:
        records = db.execute('''SELECT r.*,s.name,s.class_id,c.name class_name FROM worksheet_records r
          JOIN students s ON s.id=r.student_id JOIN classes c ON c.id=s.class_id
          WHERE r.activity_id IN ('lesson-8-task-2','lesson-9-task-1','lesson-9-task-3')
          ORDER BY r.updated_at DESC''').fetchall()
        entries = db.execute('''SELECT g.*, r.activity_id, s.class_id, s.name AS student_name, c.name AS class_name
          FROM gallery_entries g
          JOIN worksheet_records r ON r.id=g.record_id
          JOIN students s ON s.id=g.student_id
          JOIN classes c ON c.id=s.class_id
          WHERE substr(g.media_id,1,2)!='p_'
          ORDER BY g.created_at DESC, g.id''').fetchall()
    state_map = {}
    for row in entries:
        state_map[(row['record_id'], row['work_key'])] = {
            'staged': bool(row['staged']),
            'active': bool(row['active']),
        }
        aid = row['activity_id']
        if aid in stats_by_activity and row['active']:
            stats_by_activity[aid]['active'] += 1
            if aid in ATELIER_ACTIVITY_IDS:
                gallery_total_active += 1
            if class_id is None or row['class_id'] == class_id:
                entries_by_activity[aid].append(dict(row))
    for row in records:
        aid = row['activity_id']
        stats = stats_by_activity[aid]
        in_scope = class_id is None or row['class_id'] == class_id
        stages, answers, definition = (json.loads(row[k]) for k in ('stage_states', 'answers', 'definition'))
        q_reviews = json.loads(row['question_reviews']) if row['question_reviews'] else {}
        for section in definition['sections']:
            sec_state = stages.get(section['id'], {})
            if not sec_state.get('submitted'):
                continue
            stage_status = sec_state.get('status')
            if stage_status not in {'pending', 'returned', 'completed'}:
                continue
            is_approved = stage_status == 'completed'
            for q in section['questions']:
                if not q.get('record_form'):
                    continue
                works = record_data(answers.get(q['id'])).get('works', [])
                if not works:
                    continue
                q_feedback = (q_reviews.get(q['id']) or {}).get('feedback') or row['feedback'] or ''
                for work in works:
                    state = state_map.get((row['id'], work['key']), {'staged': False, 'active': False})
                    if is_approved:
                        stats['total'] += 1
                        if state['staged']:
                            stats['staged'] += 1
                    if in_scope:
                        stats['scope_submitted'] += 1
                        if stage_status == 'pending':
                            stats['scope_pending'] += 1
                        elif stage_status == 'returned':
                            stats['scope_returned'] += 1
                        else:
                            stats['scope_total'] += 1
                            if state['staged']:
                                stats['scope_staged'] += 1
                        works_by_activity[aid].append(
                            dict(work, record_id=row['id'], student_id=row['student_id'],
                                 student_name=row['name'], class_name=row['class_name'],
                                 revision=row['revision'], section_id=section['id'], question_id=q['id'],
                                 stage_status=stage_status, record_status=row['status'],
                                 can_excellent=(row['status'] == 'completed'),
                                 teacher_excellent=bool(row['teacher_excellent']),
                                 feedback=q_feedback,
                                 staged=(state['staged'] if is_approved else False),
                                 active=(state['active'] if is_approved else False))
                        )
    order = {'pending': 0, 'completed': 1, 'returned': 2}
    for aid in creation_activities:
        works_by_activity[aid].sort(key=lambda w: order.get(w['stage_status'], 3))
    return {
        'works': works_by_activity,
        'entries': entries_by_activity,
        'stats': stats_by_activity,
        'gallery_total_active': gallery_total_active,
        'labels': dict(GALLERY_ACTIVITIES),
        'tools': tool_settings(),
    }
