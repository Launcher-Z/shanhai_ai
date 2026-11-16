"""可选AI调用：固定供应商、有限并发、持久用量，候选结果仅短期保留。"""
import base64
import hashlib
import io
import json
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from urllib.request import Request, urlopen
from flask import current_app
from PIL import Image
from .creation import ACTIVITIES, BEASTS
from .database import connect
from .worksheets import WorksheetError


def setting(name, default=''):
    return current_app.config.get(name, os.environ.get(name, default))


def capability(kind):
    prefix = {'recognize':'DEEPSEEK_VISION','optimize':'DEEPSEEK_TEXT','generate':'VOLCENGINE_IMAGE'}[kind]
    key = 'VOLCENGINE_API_KEY' if kind == 'generate' else 'DEEPSEEK_API_KEY'
    return bool(setting(prefix+'_ENABLED') in {'1',True} and setting(prefix+'_MODEL') and setting(key))


def init_ai(app):
    with app.app_context(), connect() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS creation_ai_calls (
          id TEXT PRIMARY KEY,student_id INTEGER NOT NULL REFERENCES students(id),
          request_id TEXT NOT NULL,kind TEXT NOT NULL,digest TEXT NOT NULL,
          day TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,
          UNIQUE(student_id,request_id))''')
        # 重启后不重放可能已经计费的请求。
        db.execute("UPDATE creation_ai_calls SET status='failed' WHERE status IN ('queued','running')")
    app.extensions['creation_ai']={'pool':ThreadPoolExecutor(max_workers=2,thread_name_prefix='creation-ai'),
                                    'lock':threading.Lock(),'results':{}}


def post_json(url, key, payload):
    request = Request(url, data=json.dumps(payload,ensure_ascii=False).encode('utf-8'),
                      headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    with urlopen(request,timeout=120) as response:
        raw = response.read(24*1024*1024+1)
    if len(raw)>24*1024*1024:
        raise ValueError('结果过大')
    return json.loads(raw)


def provider(kind, payload):
    if kind == 'generate':
        result=post_json('https://ark.cn-beijing.volces.com/api/v3/images/generations', setting('VOLCENGINE_API_KEY'),
          {'model':setting('VOLCENGINE_IMAGE_MODEL'),'prompt':payload['prompt'],'size':'2K',
           'response_format':'b64_json','sequential_image_generation':'disabled','watermark':True})
        raw=base64.b64decode(result['data'][0]['b64_json'],validate=True)
        with Image.open(io.BytesIO(raw)) as image:
            if image.width*image.height>25000000:
                raise ValueError('图片过大')
            image.verify()
        return {'image':raw}
    if kind == 'recognize':
        path=current_app.static_folder+'/learning/creation/images/'+payload['beast_id']+'.png'
        with Image.open(path) as image:
            image.thumbnail((1400,1400))
            buffer=io.BytesIO();image.save(buffer,format='PNG')
        content=[{'type':'text','text':'图中有什么特征？你认为它是什么？哪些地方不能确定？请依据图像回答，不要编造出处。'},
                 {'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode('ascii')}}]
        model=setting('DEEPSEEK_VISION_MODEL')
    else:
        content='请保留学生动物的真实特点、神异设定和创作意图，优化文生图提示词。不要擅自添加器官或改变设定。先给建议稿，再简要说明变化，供学生自行取舍。\n原稿：'+payload['original_prompt']
        model=setting('DEEPSEEK_TEXT_MODEL')
    result=post_json('https://api.deepseek.com/chat/completions',setting('DEEPSEEK_API_KEY'),
      {'model':model,'messages':[{'role':'user','content':content}],'max_tokens':2400,'stream':False})
    text=result['choices'][0]['message']['content']
    if not isinstance(text,str) or not text.strip():
        raise ValueError('没有返回文字')
    return {'text':text[:16000]}


def start(student_id, kind, body):
    if kind not in {'recognize','optimize','generate'} or not capability(kind):
        raise WorksheetError('这项内部能力尚未启用，请使用外部应用。',409)
    if not isinstance(body,dict) or not isinstance(body.get('activity_id'),str) or body.get('activity_id') not in ACTIVITIES:
        raise WorksheetError('活动无效。')
    activity=body['activity_id']
    if (kind=='recognize' and activity!='lesson-8-task-1') or (kind=='optimize' and activity!='lesson-9-task-3') or (kind=='generate' and activity=='lesson-8-task-1'):
        raise WorksheetError('当前活动不支持这项操作。')
    rid=body.get('request_id')
    if not isinstance(rid,str) or not 8<=len(rid)<=100:
        raise WorksheetError('请求编号无效。')
    payload={}
    if kind=='recognize':
        if body.get('beast_id') not in ['image-1','image-2','image-3','image-4']:
            raise WorksheetError('请选择编号图片。')
        payload['beast_id']=body['beast_id']
    elif activity=='lesson-8-task-2':
        beast=next((b for b in BEASTS if b['id']==body.get('beast_id')),None)
        if not beast:
            raise WorksheetError('请选择原文。')
        payload['prompt']=beast['text']
    else:
        key='original_prompt' if kind=='optimize' else 'prompt'
        text=body.get(key)
        if not isinstance(text,str) or not text.strip() or len(text)>12000:
            raise WorksheetError('请填写12000字以内的提示词。')
        payload[key]=text.strip()
    digest=hashlib.sha256(json.dumps([activity,kind,payload],sort_keys=True).encode()).hexdigest()
    runtime=current_app.extensions['creation_ai']
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        old=db.execute('SELECT * FROM creation_ai_calls WHERE student_id=? AND request_id=?',(student_id,rid)).fetchone()
        if old:
            if old['digest']!=digest:
                raise WorksheetError('该请求编号已用于另一项操作。',409)
            return old['id']
        day=datetime.now().strftime('%Y-%m-%d')
        limit=int(setting('CREATION_AI_DAILY_LIMIT',8))
        used=db.execute('SELECT count(*) FROM creation_ai_calls WHERE student_id=? AND kind=? AND day=?',(student_id,kind,day)).fetchone()[0]
        if used>=limit:
            raise WorksheetError('今天这项能力的调用次数已用完，可用外部应用继续。',429)
        active=db.execute("SELECT count(*) FROM creation_ai_calls WHERE status IN ('queued','running')").fetchone()[0]
        own=db.execute("SELECT count(*) FROM creation_ai_calls WHERE student_id=? AND status IN ('queued','running')",(student_id,)).fetchone()[0]
        if active>=8 or own:
            raise WorksheetError('有任务正在等待，请稍后再试；也可使用外部应用。',429)
        job='j_'+uuid.uuid4().hex
        db.execute('INSERT INTO creation_ai_calls VALUES(?,?,?,?,?,?,?,?)',(job,student_id,rid,kind,digest,day,'queued',int(time.time())))
    app=current_app._get_current_object()
    def run():
        with app.app_context():
            with connect() as db:
                db.execute("UPDATE creation_ai_calls SET status='running' WHERE id=?",(job,))
            try:
                result=provider(kind,payload)
                status='succeeded'
            except Exception:
                # 不回传供应商原始错误，以免带出密钥或敏感配置；不自动重试计费请求。
                result={'error':'AI调用未完成或等待超时，状态可能已在供应商端计费。可保留输入并使用外部应用继续。'}
                status='failed'
            with runtime['lock']:
                now=time.time()
                runtime['results']={k:v for k,v in runtime['results'].items() if now-v[0]<1800}
                if len(runtime['results'])>=64:
                    runtime['results'].pop(next(iter(runtime['results'])))
                runtime['results'][job]=(now,result)
            with connect() as db:
                db.execute('UPDATE creation_ai_calls SET status=? WHERE id=?',(status,job))
    runtime['pool'].submit(run)
    return job


def result(student_id, job):
    with connect() as db:
        row=db.execute('SELECT * FROM creation_ai_calls WHERE id=? AND student_id=?',(job,student_id)).fetchone()
    if not row:
        raise WorksheetError('任务不存在。',404)
    runtime=current_app.extensions['creation_ai']
    with runtime['lock']:
        stored=runtime['results'].get(job)
    value=stored[1] if stored and time.time()-stored[0]<1800 else {}
    status=row['status']
    if status in {'succeeded','failed'} and not value:
        return {'status':'failed','error':'服务已重启或短期结果已过期。已下载的本地作品仍可继续使用。'}
    return dict(value,status=status)
