import test from 'node:test';
import assert from 'node:assert/strict';
import {addCustomLabel,labelsForTask,customLabelErrors,blankAnnotation,validateTask,label} from '../dist/core.js';
import {exportZip,importPackage,coco,csv,manifest} from '../dist/io.js';
import {Editor} from '../dist/editor.js';

const task=()=>({id:'custom-test',project:'satellite-large',name:'测试',type:'image',width:8192,height:8192,labelIds:['building'],sceneOptions:['卫星图像'],blobId:'media',status:'draft',history:[],annotation:{...blankAnnotation(),scene:'卫星图像'}});

test('custom category is task-local, reusable by name, and validates image and video targets',()=>{
 const t=task(),l=addCustomLabel(t,'  停车场  ');assert.equal(l.name,'停车场');assert.equal(addCustomLabel(t,'停车场').id,l.id);
 assert.equal(t.customLabels.length,1);assert.equal(labelsForTask(task()).length,1);
 t.annotation.boxes=[{id:'b',label:l.id,x:.1,y:.2,w:.01,h:.02}];assert.deepEqual(validateTask(t),[]);
 assert.equal(label(l.id,t).name,'停车场');assert.throws(()=>addCustomLabel(t,' '));assert.throws(()=>addCustomLabel(t,'a'.repeat(41)));
 assert.ok(customLabelErrors([{...l,color:'url(javascript:x)'}]).length);
 const v={...t,type:'video',goal:'actions',duration:10,fps:10,annotation:{...blankAnnotation(),actions:[],tracks:[{id:'t',label:l.id,keyframes:[{frame:0,box:{x:.1,y:.1,w:.1,h:.1}},{frame:5,box:{x:.1,y:.1,w:.1,h:.1}}]}]}};
 assert.ok(!validateTask(v).some(e=>e.includes('轨迹类别')));v.annotation.tracks[0].label='undefined';assert.ok(validateTask(v).some(e=>e.includes('轨迹类别')));
});

test('custom labels and names round-trip through ZIP/JSON/CSV/COCO without category collisions',async()=>{
 const t=task(),l=addCustomLabel(t,'道路');t.annotation.boxes=[{id:'b',label:l.id,x:.1,y:.2,w:.1,h:.1}];
 const other=structuredClone(t);other.id='other';other.customLabels[0].name='水池';
 const c=coco([t,other]);assert.notEqual(c.annotations[0].category_id,c.annotations[1].category_id);assert.ok(c.categories.some(c=>c.name==='道路'));assert.ok(c.categories.some(c=>c.name==='水池'));
 assert.ok(csv([t]).includes('label_name'));assert.ok(csv([t]).includes('道路'));assert.equal(manifest([t],{},[],null).tasks[0].customLabels[0].name,'道路');
 const zip=await exportZip([t],{name:'测试'},[],null,{blob:async()=>new Blob(['image'],{type:'image/png'})});
 const saved=[];await importPackage(new File([zip],'test.zip'),{putBlob:async()=>{},putTasks:async ts=>saved.push(...ts)});
 assert.deepEqual(saved[0].customLabels,t.customLabels);assert.equal(saved[0].annotation.boxes[0].label,l.id);
 const invalid=manifest([t],{},[],null);invalid.tasks[0].customLabels[0].id='building';let writes=0;
 await assert.rejects(()=>importPackage(new File([JSON.stringify(invalid)],'bad.json'),{putBlob:async()=>writes++,putTasks:async()=>writes++}));assert.equal(writes,0);
});

test('custom category controls escape user text and cannot mutate submitted work',async()=>{
 const t=task(),inspector={innerHTML:''},input={value:'<img src=x onerror=alert(1)>'},saved=[];
 const e=new Editor({querySelector:s=>s==='#inspector'?inspector:s==='#custom-label-name'?input:null,querySelectorAll:()=>[]},t,{onChange:t=>saved.push(t),toast(){}});
 await e.click({target:{closest:()=>({dataset:{ed:'add-custom-label'}})}});
 assert.equal(saved.length,1);assert.ok(inspector.innerHTML.includes('&lt;img'));assert.ok(!inspector.innerHTML.includes('<img src=x'));
 assert.equal(new Editor(e.root,saved[0],e.ctx).labels.at(-1).name,input.value);
 e.readOnly=true;input.value='另一个';await e.click({target:{closest:()=>({dataset:{ed:'add-custom-label'}})}});assert.equal(saved.length,1);
});
