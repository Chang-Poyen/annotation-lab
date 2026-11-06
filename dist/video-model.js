export const ACTION_LIMIT=2000;
export const ACTION_TEXT_LIMIT=1000;
const bounded=(v,a,b)=>Math.max(a,Math.min(b,v));
export function actionRange(start,end,duration,fps=0){
 if(![start,end,duration].every(Number.isFinite)||duration<=0)return null;
 const step=fps>0?1/fps:.01,snap=x=>Math.round(x/step)*step;
 const a=bounded(snap(Math.min(start,end)),0,duration),b=bounded(snap(Math.max(start,end)),0,duration);
 return b-a>=step*.9?{start:Math.round(a*1000)/1000,end:Math.round(b*1000)/1000}:null;
}
export function moveAction(segment,kind,delta,duration,fps=0){
 const step=fps>0?1/fps:.01,span=segment.end-segment.start,snap=x=>Math.round(x/step)*step;
 let start=segment.start,end=segment.end;
 if(kind==='move'){start=bounded(snap(start+delta),0,Math.max(0,duration-span));end=start+span}
 else if(kind==='start')start=bounded(snap(start+delta),0,end-step);
 else if(kind==='end')end=bounded(snap(end+delta),start+step,duration);
 return {...segment,start:Math.round(start*1000)/1000,end:Math.round(end*1000)/1000};
}
export function actionErrors(actions,duration,tracks=[],required=false,complete=true){
 const errors=[];
 if(!Array.isArray(actions)||actions.length>ACTION_LIMIT)return ['动作片段格式不正确或超过 2000 段。'];
 if(required&&!actions.length)errors.push('请在时间轴拖动创建至少一个动作片段。');
 if(actions.some(s=>!s||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||!Number.isFinite(duration)||s.end>duration+.05))errors.push('动作片段起止时间无效或超出视频范围。');
 if(actions.some(s=>!s||typeof s.actor!=='string'||(complete&&!s.actor.trim())||s.actor.length>80||typeof s.action!=='string'||(complete&&!s.action.trim())||s.action.length>80))errors.push('请填写每段的“谁”和“做了什么”，各不超过 80 字。');
 if(actions.some(s=>!s||['object','description'].some(k=>s[k]!=null&&(typeof s[k]!=='string'||s[k].length>(k==='object'?120:ACTION_TEXT_LIMIT)))))errors.push('动作对象最多 120 字，文字描述最多 1000 字。');
 if(actions.some(s=>s?.trackId&&(typeof s.trackId!=='string'||!tracks.some(t=>t.id===s.trackId))))errors.push('关联轨迹不存在，请重新选择或取消关联。');
 return errors;
}
export function actionLanes(actions){
 const actors=[...new Set(actions.map(s=>s.actor?.trim()||'未填写人物'))];
 if(!actors.length)actors.push('人物 1');
 return actors.map((actor,index)=>{const rows=[],ends=[];
  for(const s of actions.filter(s=>(s.actor?.trim()||'未填写人物')===actor).sort((a,b)=>a.start-b.start||a.end-b.end)){
   let row=ends.findIndex(end=>end<=s.start);if(row<0){row=rows.length;rows.push([])}rows[row].push(s);ends[row]=s.end;
  }
  return {actor,index,rows:rows.length?rows:[[]]};
 });
}
export function actionSentence(s){return [s.actor?.trim(),s.action?.trim(),s.object?.trim()].filter(Boolean).join(' · ')}
function subtitleTime(seconds,vtt=false){const ms=Math.max(0,Math.round(seconds*1000)),h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${vtt?'.':','}${String(ms%1000).padStart(3,'0')}`}
export function actionSubtitles(actions,format='srt'){
 const vtt=format==='vtt',clean=s=>String(s||'').replace(/[\r\n\0]+/g,' ').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 return (vtt?'WEBVTT\n\n':'')+[...actions].sort((a,b)=>a.start-b.start||a.end-b.end).map((s,i)=>`${i+1}\n${subtitleTime(s.start,vtt)} --> ${subtitleTime(s.end,vtt)}\n${clean(actionSentence(s))}${s.description?.trim()?'\n'+clean(s.description.trim()):''}\n`).join('\n');
}
