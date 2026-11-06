import {spawn} from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const examHome=process.env.ANNOTATION_EXAM_HOME||path.join(path.dirname(root),'exam-private');
if(fs.existsSync(path.join(examHome,'bank.json'))){
  const windows=process.platform==='win32';
  const python=process.env.ANNOTATION_PYTHON||(windows?'py':'python3');
  const args=windows&&!process.env.ANNOTATION_PYTHON?['-3']:[];
  const child=spawn(python,[...args,path.join(path.dirname(root),'serve-python.py')],{stdio:'inherit'});
  child.on('error',err=>{console.error('考核服务需要 Python 3：',err.message);process.exitCode=1});
  child.on('exit',(code,signal)=>{process.exitCode=code??(signal==='SIGTERM'?0:1)});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
}else{
const port=Number(process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.mp4':'video/mp4','.wav':'audio/wav','.webm':'video/webm','.mp3':'audio/mpeg','.md':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{
  let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400).end();return}
  if(name==='/api/exam/state'){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({status:'unavailable'}));return
  }
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
  fs.stat(file,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404).end('Not found');return}
    const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
    let start=0,end=stat.size-1,status=200;
    if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416).end();return}start=+m[1];if(m[2])end=Math.min(+m[2],end);if(start>end){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return}status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`}
    headers['Content-Length']=end-start+1;res.writeHead(status,headers);if(req.method==='HEAD')res.end();else fs.createReadStream(file,{start,end}).pipe(res);
  });
});
server.listen(port,'0.0.0.0',()=>console.log(`Local: http://localhost:${port}`));
}
