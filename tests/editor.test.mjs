import test from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '../dist/editor.js';
import {blankAnnotation} from '../dist/core.js';
import {coco} from '../dist/io.js';

function fixture(status='new'){
 const handlers={},changes=[],messages=[];
 const svg={innerHTML:'',captures:0,classList:{toggle(){}},getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000}),addEventListener:(name,fn)=>handlers[name]=fn,setPointerCapture(){this.captures++},closest:()=>null};
 const inspector={innerHTML:''},hint={textContent:''};
 const root={querySelector:selector=>({'.annotation-svg':svg,'#inspector':inspector,'#canvas-hint':hint}[selector]||null),querySelectorAll:()=>[]};
 const editor=new Editor(root,{id:'satellite-001',type:'image',project:'satellite',width:1000,height:1000,labelIds:['building'],sceneOptions:['卫星图像'],status,annotation:{...blankAnnotation(),scene:'卫星图像'},history:[]},{onChange:t=>changes.push(t),toast:m=>messages.push(m)});
 editor.mediaReady=true;editor.tool='polygon';editor.bindPointers();
 const event=(x,y,detail=1,target=svg)=>({clientX:x,clientY:y,button:0,pointerId:1,detail,target,currentTarget:svg,prevented:false,preventDefault(){this.prevented=true}});
 const click=(x,y,detail=1,target=svg)=>{const down=event(x,y,detail,target);handlers.pointerdown(down);handlers.pointerup(event(x,y,detail,target));handlers.click(event(x,y,detail,target));return down};
 const doubleClick=(x,y)=>{click(x,y,1);click(x,y,2);handlers.dblclick(event(x,y,2))};
 const key=key=>editor.hotkey({key,target:{closest:()=>null},preventDefault(){}});
 return {editor,svg,changes,messages,click,doubleClick,key,handlers,event};
}

test('native double-click closes a triangle once without duplicate final vertices',()=>{
 const f=fixture();
 assert.equal(f.click(100,100).prevented,false);
 f.click(800,100);f.doubleClick(600,700);
 assert.equal(f.svg.captures,0);
 assert.equal(f.editor.a.boxes.length,1);
 assert.deepEqual(f.editor.a.boxes[0].points,[{x:.1,y:.1},{x:.8,y:.1},{x:.6,y:.7}]);
 assert.equal(f.editor.a.boxes[0].label,'building');
 assert.equal(f.changes.length,1);assert.equal(f.editor.undoStack.length,1);assert.equal(f.editor.poly.length,0);
 assert.ok(f.svg.innerHTML.includes('<polygon '));
 const exported=coco([f.editor.task]);assert.equal(exported.annotations.length,1);assert.equal(exported.annotations[0].segmentation[0].length,6);assert.ok(exported.annotations[0].area>0);
});

test('closing on the first vertex and drawing over an existing polygon preserve both objects',()=>{
 const f=fixture();f.click(100,100);f.click(800,100);f.click(600,700);f.doubleClick(100,100);
 const first=f.editor.a.boxes[0];assert.equal(first.points.length,3);
 const target={closest:()=>({dataset:{object:first.id}})};
 f.click(300,200,1,target);assert.equal(f.editor.tool,'polygon');assert.equal(f.editor.drag,undefined);
 f.click(500,200,1,target);f.doubleClick(400,350);
 assert.equal(f.editor.a.boxes.length,2);assert.deepEqual(f.editor.a.boxes[0],first);
 f.editor.undo();assert.equal(f.editor.a.boxes.length,1);
 f.editor.undo(true);assert.equal(f.editor.a.boxes.length,2);
});

test('a valid nearby last vertex is retained, and Enter and Escape handle unfinished polygons',()=>{
 const f=fixture();f.click(100,100);f.click(800,100);f.doubleClick(799,101);
 assert.equal(f.editor.a.boxes.length,1);assert.equal(f.editor.a.boxes[0].points.length,3);
 f.click(200,200);f.click(400,200);f.click(300,400);f.key('Enter');assert.equal(f.editor.a.boxes.length,2);
 f.click(500,500);f.click(700,500);f.key('Escape');assert.equal(f.editor.poly.length,0);assert.equal(f.editor.a.boxes.length,2);
});

test('incomplete, zero-area and read-only polygons cannot be committed',()=>{
 const f=fixture();f.click(100,100);f.doubleClick(800,100);assert.equal(f.editor.a.boxes.length,0);assert.equal(f.editor.poly.length,2);
 f.click(500,100);f.key('Enter');assert.equal(f.editor.a.boxes.length,0);assert.ok(f.messages.length>=2);
 const locked=fixture('submitted');locked.click(100,100);locked.doubleClick(500,500);assert.equal(locked.editor.a.boxes.length,0);assert.equal(locked.changes.length,0);
});

test('rectangle pointer capture and drag-to-create continue to work',()=>{
 const f=fixture();f.editor.tool='box';const down=f.event(100,200);f.handlers.pointerdown(down);f.handlers.pointermove(f.event(400,600));f.handlers.pointerup(f.event(400,600));
 assert.equal(down.prevented,true);assert.equal(f.svg.captures,1);assert.equal(f.editor.a.boxes.length,1);
 const b=f.editor.a.boxes[0];assert.equal(b.points,undefined);for(const [key,value] of Object.entries({x:.1,y:.2,w:.3,h:.4}))assert.ok(Math.abs(b[key]-value)<1e-12);
});

test('large satellite roofs retain small native-pixel boxes and export pixel coordinates',()=>{
 const f=fixture();f.editor.task.width=8192;f.editor.task.height=8192;f.editor.tool='box';
 f.svg.getBoundingClientRect=()=>({left:-1000,top:-2000,width:8192,height:8192});
 f.handlers.pointerdown(f.event(100,200));f.handlers.pointermove(f.event(124,232));f.handlers.pointerup(f.event(124,232));
 assert.equal(f.editor.a.boxes.length,1);
 const b=f.editor.a.boxes[0];assert.equal(b.w*8192,24);assert.equal(b.h*8192,32);
 const out=coco([f.editor.task]);assert.deepEqual(out.annotations[0].bbox,[1100,2200,24,32]);
 f.handlers.pointerdown(f.event(200,300));f.handlers.pointermove(f.event(201,301));f.handlers.pointerup(f.event(201,301));
 assert.equal(f.editor.a.boxes.length,1);
});

test('native satellite zoom displays every source pixel and fit restores the overview',async()=>{
 const f=fixture();f.editor.task.width=8192;f.editor.task.height=8192;
 const stage={clientWidth:700,clientHeight:600,style:{}},wrap={style:{}},zoom={textContent:''};
 const original=f.editor.root.querySelector;f.editor.root.querySelector=s=>({'.work-stage':stage,'.media-wrap':wrap,'.zoom-value':zoom}[s]||original(s));
 const old=globalThis.getComputedStyle;globalThis.getComputedStyle=()=>({paddingLeft:'20px'});
 try{
  await f.editor.click({target:{closest:()=>({dataset:{ed:'native'}})}});
  assert.equal(parseFloat(wrap.style.width),8192);assert.equal(parseFloat(wrap.style.height),8192);
  assert.equal(stage.style.overflow,'auto');assert.equal(zoom.textContent,'100% 像素');
  await f.editor.click({target:{closest:()=>({dataset:{ed:'fit'}})}});
  assert.equal(parseFloat(wrap.style.width),560);
 }finally{globalThis.getComputedStyle=old}
});
