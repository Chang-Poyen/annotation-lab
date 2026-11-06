const DB='annotation-lab-v1';
export class Store{
 async init(){this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{for(const name of ['tasks','blobs','settings'])r.result.createObjectStore(name,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return this}
 async run(name,mode,action){return new Promise((resolve,reject)=>{const tx=this.db.transaction(name,mode);const request=action(tx.objectStore(name));let result;request.onsuccess=()=>{result=request.result};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存已中止'))})}
 all(){return this.run('tasks','readonly',s=>s.getAll())}
 putTask(task){return this.run('tasks','readwrite',s=>s.put(task))}
 async putTasks(tasks){return new Promise((resolve,reject)=>{const tx=this.db.transaction('tasks','readwrite');for(const t of tasks)tx.objectStore('tasks').put(t);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
 async retireTasks(ids){if(!ids.length)return;return new Promise((resolve,reject)=>{const tx=this.db.transaction(['tasks','settings'],'readwrite'),tasks=tx.objectStore('tasks'),settings=tx.objectStore('settings'),key='retired-builtin-tasks',request=settings.get(key);request.onsuccess=()=>{const archived=new Map((request.result?.value||[]).map(t=>[t.id,t]));for(const id of ids){const r=tasks.get(id);r.onsuccess=()=>{const task=r.result;if(task&&!task.blobId){archived.set(task.id,task);settings.put({id:key,value:[...archived.values()]});tasks.delete(id)}}}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('旧示范归档失败'))})}
 getSetting(id){return this.run('settings','readonly',s=>s.get(id)).then(x=>x?.value)}
 setting(id,value){return this.run('settings','readwrite',s=>s.put({id,value}))}
 putBlob(id,blob){return this.run('blobs','readwrite',s=>s.put({id,blob}))}
 blob(id){return this.run('blobs','readonly',s=>s.get(id)).then(x=>x?.blob)}
 async clear(){for(const name of ['tasks','blobs','settings'])await this.run(name,'readwrite',s=>s.clear())}
}
const urls=new Map();
export async function mediaURL(task,store){if(task.blobId){if(!urls.has(task.blobId)){const blob=await store.blob(task.blobId);if(!blob)throw new Error('素材文件缺失，请重新导入原始作业包。');urls.set(task.blobId,URL.createObjectURL(blob))}return urls.get(task.blobId)}return task.src}
