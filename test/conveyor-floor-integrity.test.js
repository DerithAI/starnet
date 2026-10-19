'use strict';
const A = require('./_assert.js');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');
function fresh() { const s=WM.create(); s.projectGeometry(); s.addRoom({kind:'hab',rect:{x1:30,y1:0,x2:120,y2:60}}); return s; }
const add=(s,t,x,y)=>s.addProp({t,x,y,w:/^(bay|intake|outbox)$/.test(t)?2:1,h:/^(bay|intake|outbox)$/.test(t)?2:1,block:/^(bay|intake|outbox)$/.test(t)}).id;
const plan=s=>P.compileRoutingPlan(s.projectGeometry());
const frozen=s=>JSON.stringify(s.serialize());
function rig(type='loop') {
 const s=fresh(), ids=[add(s,'intake',32,4),add(s,'bay',42,4),add(s,'bay',58,4),add(s,'outbox',76,4)];
 s.assignPropAgent(ids[1],'a');s.assignPropAgent(ids[2],'b');
 for(let i=1;i<ids.length;i++) A.ok(s.connectBelt(ids[i-1],ids[i]).ok,'rig connection');
 const l=s.links().find(l=>l.from.prop===ids[1]&&l.to.prop===ids[2]),t=l.path[Math.floor(l.path.length/2)];
 const j=s.junctionOnBelt(t.x,t.y,type,{}); A.ok(j.ok,'rig junction');
 return {s,I:ids[0],B1:ids[1],B2:ids[2],O:ids[3],J:j.id};
}
// A LOOP gets one back lane only, after its done lane. Preview and commit must share the refusal.
{
 const {s,I,B1,B2,O,J}=rig();
 A.ok(s.connectBelt(J,B1).ok,'first back lane remains allowed');
 const before=frozen(s),pv=s.previewBelt(J,I),r=s.connectBelt(J,I);
 A.ok(!pv.ok&&!r.ok,'cannot connect LOOP into INBOX');A.ok(frozen(s)===before,'refused LOOP->INBOX leaves floor unchanged');
 const upstream=add(s,'bay',34,15);s.assignPropAgent(upstream,'up');
 A.ok(s.connectBelt(upstream,B1).ok,'independent upstream BAY connects');
 const state=frozen(s),p=s.previewBelt(J,upstream),c=s.connectBelt(J,upstream);
 A.ok(!p.ok&&p.error==='CIRCLE'&&!c.ok&&c.error==='CIRCLE','third upstream exit is refused');
 A.ok(frozen(s)===state,'refused third lane leaves floor unchanged');
 A.ok(!plan(s).errors.some(e=>e.code==='CHAIN_CYCLE'),'no cycle introduced');
 const x=add(s,'outbox',82,18);A.ok(s.connectBelt(J,x).ok,'third downstream escape remains allowed');
 A.ok(s.isBackLink&&s.links().filter(l=>s.isBackLink(l.id)).length===1,'back-lane reader identifies just the legitimate lane');
}
// ESCAPE FIRST, BACK SECOND (final floor lane M3): a LOOP whose escape lane was laid before its back lane must still take
// that back lane. The lane-order guess read the escape as "the back lane", so the drag refused with "already has its back
// lane" while the floor's compile said LOOP_NO_BACK — the two must agree, and the order the Commander draws in must not matter.
{
 const {s,I,B1,B2,J}=rig();
 const x=add(s,'outbox',60,20);A.ok(s.connectBelt(J,x).ok,'escape lane first is allowed');
 const before=frozen(s),pv=s.previewBelt(J,B1);
 A.ok(pv.ok,'back lane after the escape lane previews green — '+JSON.stringify({error:pv.error,msg:pv.msg}));
 const r=s.connectBelt(J,B1);A.ok(r.ok,'…and commits — '+JSON.stringify({error:r.error,msg:r.msg}));
 const pl=plan(s),bad=pl.errors.filter(e=>e.code==='LOOP_NO_BACK'||e.code==='CHAIN_CYCLE');
 A.eq(bad.map(e=>e.code),[],'the compile agrees: no LOOP_NO_BACK, no CHAIN_CYCLE');
 const backs=s.links().filter(l=>s.isBackLink(l.id));
 A.ok(backs.length===1&&backs[0].from.prop===J&&backs[0].to.prop===B1,'only the LOOP → BAY1 lane reads as the back lane');
 const upstream=add(s,'bay',34,15);s.assignPropAgent(upstream,'up');A.ok(s.connectBelt(upstream,B1).ok,'independent upstream BAY connects');
 const state=frozen(s),p2=s.previewBelt(J,upstream),c2=s.connectBelt(J,upstream);
 A.ok(!p2.ok&&p2.error==='CIRCLE'&&!c2.ok&&c2.error==='CIRCLE'&&frozen(s)===state,'a second upstream lane is still a CIRCLE in preview and commit');
 const m=s.lineMembers(I),c=s.copyLines(m.ids);A.ok(c.ok,'the line copies');
 let pasted=null;for(let y=24;y<=50&&!pasted;y+=2){const q=s.pasteLines(c.clip,32,y);if(q.ok)pasted=q;}
 A.ok(!!pasted,'…and pastes');
 const s2=WM.deserialize(JSON.parse(before));A.ok(s2.connectBelt(J,B1).ok,'(a reloaded floor takes the same back lane)');
 s2.undo();A.ok(frozen(s2)===before,'one undo restores the floor exactly');
}
{
 const {s,B1,B2,J}=rig();
 const l=s.links().find(l=>l.from.prop===J);s.removeLinks([l.id],[],{});
 const before=frozen(s),p=s.previewBelt(J,B1),c=s.connectBelt(J,B1);
 A.ok(!p.ok&&!c.ok&&c.error==='CIRCLE','first lane upstream cannot masquerade as done');
 A.ok(frozen(s)===before,'first upstream refusal leaves floor unchanged');
}
// A REFUSED move or nudge changed nothing anyone saw (final floor lane M14): it must never ask for a whole-station re-bake
// (a `global` patch costs ~2.5 s on a big station). The rollback says staticBakeUnchanged; a real move is unchanged.
{
 const s=fresh(),a=[add(s,'intake',32,4),add(s,'bay',42,4),add(s,'outbox',56,4)],b=[add(s,'intake',32,30),add(s,'bay',42,30),add(s,'outbox',56,30)];
 for(const L of [a,b]) for(let i=1;i<3;i++) A.ok(s.connectBelt(L[i-1],L[i]).ok,'two-line rig');
 const seen=[];s.onChange(p=>seen.push(p));const bay=()=>s.propById(a[1]),state=frozen(s);
 const r1=s.moveProp(a[1],34-bay().x,30-bay().y);
 A.ok(!r1.ok&&r1.error==='WOULD_REWIRE'&&frozen(s)===state,'a move onto the other line is refused intact');
 A.ok(seen.length>0&&!seen.some(p=>p.global)&&seen.every(p=>p.staticBakeUnchanged),'…and its rollback asks for no re-bake — '+JSON.stringify(seen));
 seen.length=0;const r2=s.moveProps([a[1]],0,26);
 A.ok(!r2.ok&&frozen(s)===state,'a group move onto another piece is refused intact');
 A.ok(seen.length>0&&!seen.some(p=>p.global)&&seen.every(p=>p.staticBakeUnchanged),'…and its rollback asks for no re-bake either — '+JSON.stringify(seen));
 seen.length=0;A.ok(s.moveProps([a[1]],0,2).ok,'a legal move still moves');
 A.ok(seen.length===1&&!seen[0].global&&seen[0].staticBakeUnchanged,'…with its usual prop-only patch');
}
// A drag's ghost asks a move verdict on every tile it crosses (final floor lane M13): a group of plants never pays for a
// routing compile, and a conveyor piece's verdict compiles the route-before ONCE per edit (not inside every probe copy).
{
 const s=fresh(),ids=[add(s,'intake',32,4),add(s,'bay',42,4),add(s,'outbox',56,4)];
 for(let i=1;i<3;i++) A.ok(s.connectBelt(ids[i-1],ids[i]).ok,'compile-count rig');
 const pl=[add(s,'plant',40,20),add(s,'plant',41,20)];
 const real=P.compileRoutingPlan;let n=0;P.compileRoutingPlan=function(){n++;return real.apply(this,arguments);};
 try {
  s.links();n=0;
  for(let dx=1;dx<=4;dx++) A.ok(s.canMoveProps(pl,dx,0).ok,'decor group ghost verdict '+dx);
  A.eq(n,0,'a decor group\'s move verdicts compile nothing');
  n=0;A.ok(s.moveProps(pl,1,0).ok&&n===0,'…and neither does its commit');
  s.links();n=0;const v1=s.canMoveProp(ids[1],42,8);const first=n;n=0;
  const v2=s.canMoveProp(ids[1],42,9);
  A.ok(v1.ok&&v2.ok,'a BAY\'s move verdicts still judge the route');
  A.ok(n>0&&n<first,'…and the next tile of the same drag compiles the route-before no more — first '+first+', next '+n);
 } finally { P.compileRoutingPlan=real; }
}
// SELECT MOVES never means splice a selected junction into some other belt.
for (const type of ['merger','splitter','filter','loop']) {
 const {s,B1,B2,O,J}=rig(type), link=s.links().find(l=>l.from.prop===B2&&l.to.prop===O),target=link.path[Math.floor(link.path.length/2)],j=s.propById(J),state=frozen(s);
 const pv=s.canMoveProp(J,target.x,target.y); A.ok(!pv.ok&&pv.error==='ON_BELT',type+' move ghost refuses unrelated belt');
 A.ok(frozen(s)===state,type+' preview is pure');
 const r=s.moveProp(J,target.x-j.x,target.y-j.y); A.ok(!r.ok&&r.error===pv.error&&frozen(s)===state,type+' commit matches ghost without skipping BAY2');
 const group=s.canMoveProps([J],target.x-j.x,target.y-j.y),gr=s.moveProps([J],target.x-j.x,target.y-j.y);
 A.ok(!group.ok&&!gr.ok&&frozen(s)===state,type+' group move also refuses intact');
}
const LE=require('../frontend/app/lineedit.js');
function lines(n) {
 const s=fresh(),out=[];
 for(let i=0;i<n;i++) {
  const r=LE.placeBlueprint(s,'research_line',{x:50,y:8+i*14});if(!r.ok)throw Error(JSON.stringify(r));
  const of=t=>r.ids.filter(id=>s.propById(id).t===t);out.push({I:of('intake')[0],O:of('outbox')[0],B:of('bay')});
 }
 for(const p of s.props())if(p.t==='bay')s.assignPropAgent(p.id,'a'+p.id);
 return {s,L:out};
}
// A→B→C must not become a SEND TO cycle through a newly merged A/C floor component.
{
 const {s,L:[a,b,c]}=lines(3);s.setSendTo(a.O,b.I);s.setSendTo(b.O,c.I);
 const state=frozen(s),pv=s.previewBelt(c.B[c.B.length-1],a.O),r=s.connectBelt(c.B[c.B.length-1],a.O);
 A.ok(!pv.ok&&!r.ok&&r.error==='SEND_TO_CONFLICT','transitive SEND TO fusion refuses in preview and commit');
 A.ok(frozen(s)===state&&Object.keys(plan(s).sendTo).length===2,'both handoffs and floor preserved');
}
// Recover a pre-SEND TO save explicitly, one undo, and preserve it across restart.
{
 const {s,L:[a,b]}=lines(2),d=JSON.parse(frozen(s));
 for(const p of d.props)if(p.id===a.O||p.id===b.I)p.t='bay';
 const oldBuild=WM.deserialize(d);A.ok(oldBuild.connectBelt(a.O,b.I).ok,'old belt fixture');
 const saved=JSON.parse(frozen(oldBuild));for(const p of saved.props){if(p.id===a.O)p.t='outbox';if(p.id===b.I)p.t='intake';}
 const old=WM.deserialize(saved),before=frozen(old);
 A.eq(old.oldHandoffBelts(a.O).length,1,'legacy belt discoverable even in the same component');
 A.eq(old.sendToRefusal(a.O,b.I).error,'OLD_BELT','explains conversion instead of unreachable SAME LINE');
 A.ok(old.convertHandoffBelt(a.O).ok,'explicit conversion succeeds');
 A.ok(plan(old).lines.length===2&&plan(old).sendTo[a.O].intakeId===b.I,'conversion makes two separate working lines');
 const reloaded=WM.deserialize(JSON.parse(frozen(old)));A.ok(plan(reloaded).sendTo[a.O].intakeId===b.I,'converted handoff survives reload');
 old.undo();A.ok(frozen(old)===before,'one undo restores original old belt');
 old.redo();A.ok(plan(old).sendTo[a.O].intakeId===b.I,'redo restores the conversion');
}
// Separate budgets and handoffs survive editing an adjacent line.
{
 const {s,L:[a,b]}=lines(2);s.setSendTo(a.O,b.I);s.setPropLimits(a.I,{maxHops:4});s.setPropLimits(b.I,{maxHops:9});
 const before=plan(s),r=LE.run(s,b.B[0],'appendStep',{after:b.B[0],role:'WRITER'});
 A.ok(r.ok,'adding a step on clear nearby floor succeeds');
 const after=plan(s);A.ok(after.lines.length===2&&after.sendTo[a.O].intakeId===b.I,'editing B preserves two lines and A SEND TO');
 const hops=(p,id)=>(p.lines.find(l=>l.intakes.includes(id))||{}).maxHops;A.ok(hops(before,a.I)===4&&hops(before,b.I)===9&&hops(after,a.I)===4&&hops(after,b.I)===9,'each line keeps its own budget, on its own INBOX — '+JSON.stringify([hops(before,a.I),hops(before,b.I),hops(after,a.I),hops(after,b.I)]));
}
// Names persist and duplicate line labels are refused without forbidding BAY labels.
{
 const {s,L:[a,b]}=lines(2);A.ok(s.setPropLabel(a.I,'LINE RESEARCH').ok,'name first line');
 A.ok(!s.setPropLabel(b.I,' research ').ok&&!s.propById(b.I).label,'equivalent line name is refused');
 A.ok(s.setPropLabel(a.B[0],'Draft review').ok,'BAY label allowed');
 const re=WM.deserialize(JSON.parse(frozen(s)));A.eq(re.propById(a.B[0]).label,'Draft review','BAY label survives reload');
 A.eq(s.copyLines([a.B[0]]).clip.nodes[0].label,'Draft review','BAY label survives copy');
}
// A belt reshape goes through the requested waypoint, keeps its endpoints and routing, and
// previews the exact committed path. One undo also restores its original ports and tiles.
{
 const {s,B1,B2}=rig('merger'),l=s.links().find(q=>q.from.prop===B2),from=s.propById(l.from.prop),to=s.propById(l.to.prop),x=Math.round((from.x+to.x)/2),y=from.y+8;
 const before=frozen(s),pv=s.canReshapeLink(l.id,x,y);
 A.ok(pv.ok&&pv.path.some(t=>t.x===x&&t.y===y),'waypoint preview takes a real detour');
 A.ok(frozen(s)===before,'reshape preview is pure');
 const r=s.reshapeLink(l.id,x,y),nl=s.links().find(q=>q.id===l.id);
 A.ok(r.ok&&nl.from.prop===l.from.prop&&nl.to.prop===l.to.prop,'reshape preserves both endpoints and id');
 A.eq(nl.path,pv.path,'committed detour exactly matches preview');
 s.undo();A.ok(frozen(s)===before,'one undo restores unbent belt');
 const flip=s.canReshapeLink(l.id,x,y,{flip:true});
 A.ok(flip.ok&&flip.path.some(t=>t.x===x&&t.y===y),'R flip keeps waypoint constraint');
 const bad=s.canReshapeLink(l.id,from.x,from.y),refuse=s.reshapeLink(l.id,from.x,from.y);
 A.ok(!bad.ok&&!refuse.ok&&bad.error===refuse.error&&frozen(s)===before,'blocked detour preview and commit refuse unchanged');
}
{
 const {s,L:[a,b]}=lines(2),name=s.lineLetter(b.I);A.ok(/^[A-Z]+$/.test(name),'unnamed line has a derived readable letter');
 s.removeLine(a.I);A.eq(s.lineLetter(b.I),name,'deleting another line never renames this one');
 A.eq(WM.deserialize(JSON.parse(frozen(s))).lineLetter(b.I),name,'fallback line letter survives reload');
}
A.report('conveyor-floor-integrity.test');
