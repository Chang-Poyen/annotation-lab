"""Private exam bank, timed attempts and teacher-side result export."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time
import unicodedata
from contextlib import closing
from http.cookies import SimpleCookie
from urllib.parse import urlsplit

PREFIX = '/api/exam/'
COOKIE = 'annotation_exam_device'
BASE = Path(__file__).resolve().parent
DEFAULT_HOME = BASE / 'exam-private'


class ExamError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


def device_cookie(handler):
    cookie = SimpleCookie()
    try:
        cookie.load(handler.headers.get('Cookie', ''))
    except ValueError:
        return None
    value = cookie[COOKIE].value if COOKIE in cookie else ''
    return value if re.fullmatch(r'[A-Za-z0-9_-]{43}', value) else None


def cookie_value(token):
    return f'{COOKIE}={token}; Path={PREFIX}; Max-Age=604800; HttpOnly; SameSite=Strict'


def answer_status(attempt, now):
    if attempt['finished'] is not None:
        return 'submitted'
    return 'expired' if now >= attempt['deadline'] else 'active'


class Exam:
    def __init__(self, home, public_root):
        self.home = Path(home).resolve()
        self.tasks = {}
        if self.home == public_root or public_root in self.home.parents:
            raise ValueError('考核目录必须位于 dist 以外')
        bank = self.home / 'bank.json'
        if not bank.exists() or not (self.home/'access.json').exists():
            return
        data = json.loads(bank.read_text(encoding='utf-8'))
        self.bank = data['edition']
        self.minutes = int(data['minutes'])
        if not 1 <= self.minutes <= 480:
            raise ValueError('考核时长超出范围')
        self.media = {}
        for item in data['tasks']:
            task = dict(item)
            key = task['id']
            if key in self.tasks or not re.fullmatch(r'[a-z][a-z0-9-]{0,50}', key):
                raise ValueError('重复或无效的题目编号')
            for field, url_field in [('file','src'), ('sensor','sensorSrc'), ('filmstrip','filmstripSrc')]:
                filename = task.pop(field, None)
                if filename:
                    path = (self.home/'media'/filename).resolve()
                    path.relative_to((self.home/'media').resolve())
                    if not path.is_file() or not re.fullmatch(r'[a-zA-Z0-9._-]+',filename):
                        raise ValueError('缺少考核素材 '+filename)
                    self.media[filename] = path
                    task[url_field] = PREFIX+'media/'+filename
            self.tasks[key] = task
        self.db = self.home/'attempts.sqlite3'
        with closing(self.connect()) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS attempts(
                    id INTEGER PRIMARY KEY, edition TEXT NOT NULL, number TEXT NOT NULL,
                    name TEXT NOT NULL, device TEXT NOT NULL, started INTEGER NOT NULL,
                    deadline INTEGER NOT NULL, finished INTEGER, UNIQUE(edition, number),
                    UNIQUE(edition, device));
                CREATE TABLE IF NOT EXISTS answers(
                    attempt INTEGER NOT NULL, task TEXT NOT NULL, revision INTEGER NOT NULL,
                    value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(attempt,task));
                CREATE TABLE IF NOT EXISTS failures(ip TEXT, at INTEGER);
                CREATE INDEX IF NOT EXISTS recent_failures ON failures(ip,at);
            """)
        if os.name != 'nt':
            self.db.chmod(0o600)

    def connect(self):
        db = sqlite3.connect(self.db, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def attempt(self, db, token):
        if not token:
            return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        return db.execute('SELECT * FROM attempts WHERE edition=? AND device=?',
                          (self.bank,digest)).fetchone()

    def state(self, db, attempt):
        now = int(time.time())
        if attempt is None:
            return dict(status='locked', minutes=self.minutes, now=now)
        rows = db.execute('SELECT * FROM answers WHERE attempt=?', (attempt['id'],)).fetchall()
        result = dict(status=answer_status(attempt,now), now=now, started=attempt['started'],
                      deadline=attempt['deadline'], finished=attempt['finished'], name=attempt['name'],
                      number=attempt['number'], answered=len(rows), total=len(self.tasks))
        if result['status'] == 'active':
            result['tasks'] = list(self.tasks.values())
            result['answers'] = {r['task']:dict(revision=r['revision'],value=json.loads(r['value'])) for r in rows}
        return result

    def start(self, db, token, data, ip):
        if not token:
            raise ExamError(400,'请启用浏览器 Cookie 并刷新考核入口。')
        attempt = self.attempt(db,token)
        if attempt:
            return self.state(db,attempt)
        now = int(time.time())
        db.execute('DELETE FROM failures WHERE at<?',(now-120,))
        if db.execute('SELECT count(*) FROM failures WHERE ip=?',(ip,)).fetchone()[0]>=20:
            raise ExamError(429,'密码尝试次数较多，请两分钟后重试。')
        auth = json.loads((self.home/'access.json').read_text(encoding='utf-8'))
        password = data.get('password')
        if not isinstance(password,str) or len(password)>256 or not hmac.compare_digest(
                password_hash(password, auth['salt']),auth['hash']):
            db.execute('INSERT INTO failures VALUES(?,?)',(ip,now))
            db.commit()
            raise ExamError(403,'考核密码不正确。')
        number, name = data.get('number'),data.get('name')
        if not isinstance(number,str) or not isinstance(name,str):
            raise ExamError(400,'请填写姓名和学号。')
        number = unicodedata.normalize('NFKC',number).strip().casefold()
        name = name.strip()
        if not (1<=len(number)<=40 and 1<=len(name)<=40):
            raise ExamError(400,'姓名和学号须为 1–40 个字符。')
        if db.execute('SELECT 1 FROM attempts WHERE edition=? AND number=?',(self.bank,number)).fetchone():
            raise ExamError(409,'此学号已开考，请用原浏览器继续。如需换机请联系监考老师。')
        db.execute('INSERT INTO attempts(edition,number,name,device,started,deadline) VALUES(?,?,?,?,?,?)',
                   (self.bank,number,name,hashlib.sha256(token.encode()).hexdigest(),now,now+self.minutes*60))
        return self.state(db,self.attempt(db,token))

    def active(self, db, token):
        attempt = self.attempt(db,token)
        if not attempt:
            raise ExamError(403,'请先输入考核密码。')
        if answer_status(attempt,time.time()) != 'active':
            raise ExamError(410,'考核已收卷。')
        return attempt

    def save(self, db, attempt, data):
        key, revision, value = data.get('task'),data.get('revision'),data.get('value')
        if not isinstance(key,str) or key not in self.tasks or type(revision) is not int:
            raise ExamError(400,'无效的题目或版本。')
        if not isinstance(value,dict) or not isinstance(value.get('annotation'),dict):
            raise ExamError(400,'作答格式不正确。')
        row = db.execute('SELECT revision,value FROM answers WHERE attempt=? AND task=?',
                         (attempt['id'],key)).fetchone()
        current = row['revision'] if row else 0
        encoded = json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':'))
        if row and row['value']==encoded:
            return dict(revision=current)
        if revision!=current:
            raise ExamError(409,'另一页面已修改此题。请刷新后核对服务器保存的版本。')
        db.execute('INSERT OR REPLACE INTO answers VALUES(?,?,?,?,?)',
                   (attempt['id'],key,current+1,encoded,int(time.time())))
        return dict(revision=current+1)

    def handle(self,h,route):
        token = device_cookie(h)
        if not self.tasks:
            if h.command in ('GET','HEAD') and route=='state':
                return h.exam_json(dict(status='unavailable'))
            raise ExamError(503,'本机尚未配置考核题库。请使用讲师提供的考核网址。')
        with closing(self.connect()) as db, db:
            if h.command in ('GET','HEAD'):
                if route=='state':
                    fresh = None if token else cookie_value(secrets.token_urlsafe(32))
                    return h.exam_json(self.state(db,self.attempt(db,token)),cookie=fresh)
                if route.startswith('media/'):
                    self.active(db,token)
                    path = self.media.get(route[6:])
                    if path is None:
                        raise ExamError(404,'素材不存在。')
                    return h.file_head(path)
                raise ExamError(404,'没有这个考核接口。')
            origin = h.headers.get('Origin')
            if (origin and urlsplit(origin).netloc != h.headers.get('Host')) or h.headers.get_content_type()!='application/json':
                raise ExamError(403,'请从本平台提交作答。')
            length = int(h.headers.get('Content-Length','0'))
            if not 0 < length <= 1024*1024:
                raise ExamError(413,'提交内容大小无效。')
            data = json.loads(h.rfile.read(length))
            if not isinstance(data,dict):
                raise ExamError(400,'提交内容格式不正确。')
            db.execute('BEGIN IMMEDIATE')
            if route=='start':
                result = self.start(db,token,data,h.client_address[0])
            elif route=='leave':
                attempt = self.attempt(db,token)
                if attempt and answer_status(attempt,time.time())=='active':
                    raise ExamError(409,'请先交卷再退出。')
                return h.exam_json(dict(status='locked'),cookie=cookie_value(secrets.token_urlsafe(32)))
            else:
                attempt = self.active(db,token)
                if route=='save':
                    result = self.save(db,attempt,data)
                elif route=='finish':
                    db.execute('UPDATE attempts SET finished=? WHERE id=?',(int(time.time()),attempt['id']))
                    result = self.state(db,self.attempt(db,token))
                else:
                    raise ExamError(404,'没有这个考核接口。')
            db.commit()
            return h.exam_json(result)

    def export(self):
        with closing(self.connect()) as db:
            db.execute('BEGIN')
            for row in db.execute('SELECT * FROM attempts WHERE edition=? ORDER BY id',(self.bank,)):
                result = self.state(db,row)
                result.pop('tasks',None)
                result['answers'] = {r['task']:dict(name=self.tasks[r['task']]['name'],updated=r['updated'],
                    **json.loads(r['value'])) for r in db.execute('SELECT * FROM answers WHERE attempt=?',(row['id'],))}
                yield result


if __name__ == '__main__':
    home = Path(os.environ.get('ANNOTATION_EXAM_HOME', DEFAULT_HOME))
    if sys.argv[1:] == ['export']:
        exam=Exam(home,(BASE/'dist').resolve())
        if not exam.tasks:
            raise SystemExit('未配置考核题库')
        print(json.dumps(list(exam.export()),ensure_ascii=False,indent=2))
    else:
        raise SystemExit('用法：python3 exam_service.py export')
