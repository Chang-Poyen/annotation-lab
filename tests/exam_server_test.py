"""HTTP regressions for a bank that must never be public, including its media ranges."""
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from exam_service import password_hash

class ExamAccess(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.home=Path(cls.tmp.name)
        (cls.home/'media').mkdir()
        (cls.home/'media'/'sample.mp4').write_bytes(b'0123456789')
        (cls.home/'bank.json').write_text(json.dumps(dict(edition='test',minutes=3,tasks=[
            dict(id='private-task',type='video',name='secret title',file='sample.mp4')])))
        salt='0a'*16
        (cls.home/'access.json').write_text(json.dumps(dict(salt=salt,hash=password_hash('test code',salt))))
        module=importlib.util.module_from_spec(spec:=importlib.util.spec_from_file_location('web',ROOT/'serve-python.py'))
        with patch.dict(os.environ,ANNOTATION_EXAM_HOME=str(cls.home)):spec.loader.exec_module(module)
        module.Handler.log_message=lambda *args:None
        cls.server=module.ThreadingHTTPServer(('127.0.0.1',0),module.Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join();cls.tmp.cleanup()

    def request(self,method,path,cookie='',data=None,**headers):
        connection=http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        body=json.dumps(data) if data is not None else None
        connection.request(method,path,body,dict({'Content-Type':'application/json','Cookie':cookie},**headers))
        res=connection.getresponse()
        raw=res.read()
        ret=(res.status,json.loads(raw) if raw and res.getheader('Content-Type','').startswith('application/json') else raw,dict(res.getheaders()))
        connection.close()
        return ret

    def device(self):
        status,data,headers=self.request('GET','/api/exam/state')
        self.assertEqual(status,200)
        self.assertNotIn('tasks',data)
        self.assertIn('HttpOnly',headers['Set-Cookie'])
        return headers['Set-Cookie'].split(';')[0]

    def start(self,cookie,number):
        return self.request('POST','/api/exam/start',cookie,dict(name='考试学员',number=number,password='test code'))

    def test_gate_and_static_paths(self):
        token=self.device()
        self.assertEqual(self.request('POST','/api/exam/start',token,dict(password='wrong'))[0],403)
        for method in ['HEAD','GET']:
            status,body,headers=self.request(method,'/api/exam/media/sample.mp4',token,Range='bytes=2-4')
            self.assertEqual(status,403);self.assertIn('no-store',headers['Cache-Control'])
        for path in ['/bank.json','/exam-private/access.json','/%2e%2e/exam-private/media/sample.mp4']:
            self.assertEqual(self.request('GET',path)[0],404)
        self.assertEqual(self.request('POST','/api/exam/start',token,{},Origin='http://example.invalid')[0],403)

    def test_resume_ranges_partial_submission_and_isolation(self):
        token=self.device();other=self.device()
        status,start,_=self.start(token,'A01');self.assertEqual(status,200)
        self.assertEqual(self.start(other,'Ａ０１')[0],409)
        self.assertEqual(self.start(token,'A01')[1]['deadline'],start['deadline'])
        media=start['tasks'][0]['src']
        self.assertEqual(self.request('GET',media,other)[0],403)
        status,body,headers=self.request('GET',media,token,Range='bytes=2-4')
        self.assertEqual((status,body),(206,b'234'));self.assertIn('no-store',headers['Cache-Control'])
        save=dict(task='private-task',revision=0,value=dict(annotation=dict(notes='草稿')))
        for _ in range(2):
            status,data,_=self.request('POST','/api/exam/save',token,save)
            self.assertEqual((status,data['revision']),(200,1))
        save['value']['annotation']['notes']='冲突'
        self.assertEqual(self.request('POST','/api/exam/save',token,save)[0],409)
        self.assertEqual(self.request('GET','/api/exam/state',token)[1]['answers']['private-task']['value']['annotation']['notes'],'草稿')
        status,data,_=self.request('POST','/api/exam/finish',token,{})
        self.assertEqual((status,data['status'],data['answered']),(200,'submitted',1))
        self.assertNotIn('tasks',data)
        self.assertEqual(self.request('HEAD',media,token)[0],410)
        self.assertEqual(self.request('POST','/api/exam/save',token,save)[0],410)

    def test_server_deadline_expires_without_an_open_page(self):
        token=self.device();self.start(token,'B02')
        with sqlite3.connect(self.home/'attempts.sqlite3') as db:
            db.execute('UPDATE attempts SET deadline=0 WHERE device=?',(hashlib.sha256(token.split('=')[1].encode()).hexdigest(),))
        status,data,_=self.request('GET','/api/exam/state',token)
        self.assertEqual((status,data['status']),(200,'expired'))
        self.assertNotIn('tasks',data)
        self.assertEqual(self.request('POST','/api/exam/save',token,{})[0],410)
        self.assertEqual(self.request('GET','/api/exam/media/sample.mp4',token,Range='bytes=0-1')[0],410)
        self.assertEqual(self.start(self.device(),'B02')[0],409)

if __name__=='__main__':unittest.main()
