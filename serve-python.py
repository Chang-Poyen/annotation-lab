#!/usr/bin/env python3
"""Dependency-free static server with byte ranges for annotation media."""
import json
import logging
import os
import re
import shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from exam_service import DEFAULT_HOME, PREFIX, Exam, ExamError

ROOT = Path(__file__).resolve().parent / 'dist'

EXAM = Exam(os.environ.get("ANNOTATION_EXAM_HOME", DEFAULT_HOME), ROOT.resolve())

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.wav': 'audio/wav'}

    def end_headers(self):
        self.send_header('Cache-Control', 'private, no-store' if self.path.startswith(PREFIX) else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def exam_json(self, data, code=200, cookie=None):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        if cookie:
            self.send_header('Set-Cookie',cookie)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def exam_request(self):
        try:
            return EXAM.handle(self,urlsplit(self.path).path[len(PREFIX):])
        except ExamError as exc:
            self.exam_json({'error':str(exc)},exc.code)
        except (ValueError, OverflowError):
            self.exam_json({'error':'请求格式不正确。'},400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            logging.exception('Exam request failed')
            self.exam_json({'error':'服务器暂时无法处理请求，请重试。'},500)

    def do_POST(self):
        if self.path.startswith(PREFIX):
            self.exam_request()
        else:
            self.send_error(405)

    def send_head(self):
        self.byte_range = None
        if self.path.startswith(PREFIX):
            return self.exam_request()
        try:
            path = (ROOT / unquote(urlsplit(self.path).path).lstrip('/')).resolve()
            if path.is_dir():
                path = (path / 'index.html').resolve()
            path.relative_to(ROOT.resolve())
            return self.file_head(path)
        except (ValueError, OSError):
            self.send_error(404)

    def file_head(self, path):
        try:
            if not path.is_file():
                self.send_error(404)
                return None
            size = path.stat().st_size
            start, end, code = 0, size - 1, 200
            requested = self.headers.get('Range')
            if requested:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested)
                if not match or not any(match.groups()) or size == 0:
                    self.send_error(416)
                    return None
                first, last = match.groups()
                if first:
                    start = int(first)
                    end = min(int(last), end) if last else end
                else:
                    start = max(0, size - int(last))
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.end_headers()
                    return None
                code = 206
                self.byte_range = (start, end)
            stream = path.open('rb')
            self.send_response(code)
            self.send_header('Content-Type', self.guess_type(str(path)))
            self.send_header('Content-Length', str(max(0, end - start + 1)))
            self.send_header('Accept-Ranges', 'bytes')
            if code == 206:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            return stream
        except (ValueError, OSError):
            self.send_error(404)
            return None

    def copyfile(self, source, output):
        try:
            if self.byte_range is None:
                shutil.copyfileobj(source, output)
                return
            start, end = self.byte_range
            source.seek(start)
            remaining = end - start + 1
            while remaining:
                data = source.read(min(65536, remaining))
                if not data:
                    break
                output.write(data)
                remaining -= len(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

if __name__ == '__main__':
    port = int(os.environ.get('PORT', '4173'))
    host = os.environ.get('HOST', '0.0.0.0')
    print(f'Local: http://localhost:{port}', flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
