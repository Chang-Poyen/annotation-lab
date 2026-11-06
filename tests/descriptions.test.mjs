import test from 'node:test';
import assert from 'node:assert/strict';
import {blankAnnotation,validateTask,labelsForTask,MAX_DESCRIPTION,refreshBuiltinMetadata} from '../dist/core.js';
import {Editor} from '../dist/editor.js';
import {exportZip,importPackage,csv,coco,unzipStore,manifest} from '../dist/io.js';

const box={id:'roof-1',label:'building',x:.1,y:.2,w:.3,h:.2};
const task=()=>({id:'satellite-001',name:'房屋练习',project:'satellite',type:'image',width:650,height:650,status:'draft',blobId:'image',history:[],labelIds:['building'],sceneOptions:['卫星图像'],annotation:{...blankAnnotation(),scene:'卫星图像',boxes:[{...box},{...box,id:'roof-2',x:.5}]}});

test('updated built-in teaching metadata preserves learner descriptions, submission and review history',()=>{
 const existing={...task(),project:'open-scenes',blobId:undefined,status:'submitted',review:{comment:'复核记录'},history:[{action:'submit'}]};
 existing.annotation.boxes[0].description='学员自己的描述';
 const seed={...existing,name:'人物活动 01',sceneOptions:['人物活动','其他'],truth:{scene:'人物活动',boxes:[]},annotation:blankAnnotation(),status:'new',history:[]};
 const updated=refreshBuiltinMetadata(existing,seed);
 assert.equal(updated.name,'人物活动 01');assert.equal(updated.truth.scene,'人物活动');assert.equal(updated.status,'submitted');
 assert.equal(updated.annotation.boxes[0].description,'学员自己的描述');assert.deepEqual(updated.review,existing.review);assert.deepEqual(updated.history,existing.history);
 const imported={...existing,project:'imports',blobId:'own-media'};assert.equal(refreshBuiltinMetadata(imported,{...seed,project:'imports'}),imported);
});

function editorFor(t){
 const inspector={innerHTML:''},count={textContent:''},saved=[];
 const e=new Editor({querySelector:s=>s==='#inspector'?inspector:s==='#description-count'?count:null,querySelectorAll:()=>[]},t,{onChange:t=>saved.push(structuredClone(t)),toast(){}});
 e.refresh=()=>{};
 return {e,inspector,count,saved};
}

test('manual descriptions stay with each object, autosave during composition, escape HTML, and respect read-only state',()=>{
 const {e,inspector,count,saved}=editorFor(task());
 const text='左上方灰色屋顶，旁边有树。\n<img src=x onerror=alert(1)>';
 e.selected='roof-1';e.input({target:{id:'object-description',value:text},isComposing:true});
 assert.equal(saved.at(-1).annotation.boxes[0].description,text);
 assert.equal(e.a.boxes[1].description,undefined);assert.equal(count.textContent,text.length);
 e.renderInspector();assert.ok(inspector.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(!inspector.innerHTML.includes('<img src=x'));
 e.selected='roof-2';e.input({target:{id:'object-description',value:'右下方白色矩形屋顶'}});
 e.undo();assert.equal(e.a.boxes[0].description,text);assert.equal(e.a.boxes[1].description,undefined);
 e.undo(true);assert.equal(e.a.boxes[1].description,'右下方白色矩形屋顶');
 const reopened=editorFor(saved.at(-1)).e;assert.equal(reopened.a.boxes[0].description,text);
 const locked=editorFor({...saved.at(-1),status:'submitted'});locked.e.selected='roof-1';locked.e.input({target:{id:'object-description',value:'不可改写'}});
 assert.equal(locked.saved.length,0);assert.equal(locked.e.a.boxes[0].description,text);
});

test('image and video descriptions survive ZIP handoff, JSON, CSV and COCO extensions with metadata',async()=>{
 const t=task();t.annotation.boxes[0].description='=屋顶,"灰色"\n紧邻道路';t.license='CC BY-SA 4.0';t.sourceAttribution='SpaceNet Partners';t.sourceURL='https://example.org/source';
 const video={...task(),id:'video',type:'video',fps:12,annotation:{...blankAnnotation(),tracks:[{id:'track',label:'car',description:'红色汽车向右移动',keyframes:[{frame:0,box},{frame:12,box}]}]}};
 const media=new Blob([new Uint8Array([0,1,2])],{type:'image/png'});
 const zip=await exportZip([t,video],{name:'学员'},[],null,{blob:async()=>media});
 const files=unzipStore(new Uint8Array(await zip.arrayBuffer()));
 assert.ok(new TextDecoder().decode(files.get('素材来源与许可.txt')).includes('SpaceNet Partners'));
 const imported=[];
 await importPackage(new File([zip],'作业.zip'),{putBlob:async()=>{},putTasks:async rows=>imported.push(...rows)});
 assert.equal(imported[0].annotation.boxes[0].description,t.annotation.boxes[0].description);
 assert.equal(imported[1].annotation.tracks[0].description,'红色汽车向右移动');
 assert.equal(manifest([t],{},[],null).tasks[0].annotation.boxes[0].description,t.annotation.boxes[0].description);
 const table=csv([t,video]);assert.ok(table.includes('object_description'));assert.ok(table.includes("'=屋顶,"));assert.ok(table.includes('红色汽车向右移动'));
 assert.equal(coco([t]).annotations[0].attributes.description,t.annotation.boxes[0].description);
 assert.equal(coco([t]).images[0].attribution,'SpaceNet Partners');
});

test('EuroSAT classification requires a valid scene, preserves its description and cannot create boxes',()=>{
 const t={...task(),goal:'classification',sceneOptions:['森林','河流'],annotation:{...blankAnnotation(),description:'绿色密集纹理'}};
 assert.equal(validateTask(t).length,2);t.annotation.scene='森林';assert.deepEqual(validateTask(t),[]);
 const f=editorFor(t);f.e.mediaReady=true;f.e.pointerDown({button:0});f.e.tool='polygon';f.e.poly=[{x:.1,y:.1},{x:.8,y:.1},{x:.5,y:.7}];assert.equal(f.e.finishPolygon(),false);
 assert.equal(f.e.a.boxes.length,0);assert.equal(f.e.a.description,'绿色密集纹理');
 t.annotation.scene='未知';assert.ok(validateTask(t).length);
 t.annotation.scene='森林';const result=coco([t]);assert.equal(result.annotations.length,0);assert.equal(result.images[0].description,'绿色密集纹理');
});

test('description imports reject invalid or excessive values before writing any blobs or tasks, and accept old packages',async()=>{
 for(const value of [42,'x'.repeat(MAX_DESCRIPTION+1)]){
  const t=task();t.annotation.boxes[0].description=value;
  assert.ok(validateTask(t).length);
  const m=manifest([t],{},[],null);let writes=0;
  await assert.rejects(()=>importPackage(new File([JSON.stringify(m)],'作业.json'),{putBlob:async()=>writes++,putTasks:async()=>writes++}),/描述/);
  assert.equal(writes,0);
 }
 const old=task();delete old.blobId;old.src='./legacy.png';delete old.annotation.description;
 const r=await importPackage(new File([JSON.stringify(manifest([old],{},[],null))],'旧版.json'),{putTasks:async()=>{},putBlob:async()=>{}},new Set(['./legacy.png']));
 assert.equal(r.tasks[0].annotation.description,'');assert.equal(r.tasks[0].annotation.boxes[0].description,undefined);
 assert.deepEqual(labelsForTask({project:'images'}).map(l=>l.id),['bottle','cup','box']);
 assert.deepEqual(labelsForTask({labelIds:['car','person']}).map(l=>l.id),['person','car']);
});
