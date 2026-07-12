/* TOKEN WAR — 3D drone view. Reads the sim's globals (grid, tokens, fx arrays)
   and renders them with three.js; the political map canvas (terr) drapes the terrain. */
'use strict';
(function(){
const V={ready:false,auto:true};
window.V3D=V;
const AMP=7;
let R,SC,CAMR,terrMesh,tex;
let tankMesh,infMesh,jetMesh,batMesh,shellMesh,sparkPts,sparkGeo,debPts,debGeo,traLines,traGeo;
let smokePool=[],burstPool=[],flamePool=[],ringPool=[],bombPool=[];
let fireTex,coreTex,smokeTex;
let dummy;
const rig={focus:null,yaw:.85,pitch:.62,dist:120,distT:120,strikeT:0,driftT:3,target:null};
const keys=new Set();
let ray,mouseNDC,lastPick=0;

function hAt(gx,gy){
  gx=clamp(gx,0,GW-1.001); gy=clamp(gy,0,GH-1.001);
  const x0=gx|0,y0=gy|0,x1=Math.min(GW-1,x0+1),y1=Math.min(GH-1,y0+1);
  const fx=gx-x0,fy=gy-y0,h=(x,y)=>height[y*GW+x];
  return (h(x0,y0)*(1-fx)*(1-fy)+h(x1,y0)*fx*(1-fy)+h(x0,y1)*(1-fx)*fy+h(x1,y1)*fx*fy)*AMP;
}
const wX=gx=>gx-GW/2, wZ=gy=>gy-GH/2;

/* low-poly unit models built in code — grayscale tones baked as vertex colors,
   faction color applied per instance (finalColor = vertexTone × instanceColor) */
function mkM(x,y,z,rx,ry,rz,sx,sy,sz){
  const m=new THREE.Matrix4();
  m.compose(new THREE.Vector3(x||0,y||0,z||0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx||0,ry||0,rz||0)),
    new THREE.Vector3(sx||1,sy||1,sz||1));
  return m;
}
function mergeGeoms(parts){
  const pos=[],nor=[],col=[];
  for(const p of parts){
    const g=p.g.toNonIndexed();
    if(p.m)g.applyMatrix4(p.m);
    g.computeVertexNormals();
    const pa=g.attributes.position, na=g.attributes.normal;
    for(let i=0;i<pa.count;i++){
      pos.push(pa.getX(i),pa.getY(i),pa.getZ(i));
      nor.push(na.getX(i),na.getY(i),na.getZ(i));
      col.push(p.t,p.t,p.t);
    }
    g.dispose();
  }
  const out=new THREE.BufferGeometry();
  out.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  out.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
  out.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  return out;
}
const B=(w,h,d)=>new THREE.BoxGeometry(w,h,d);
function buildTank(){ // faces +X
  return mergeGeoms([
    {g:B(1.5,.3,.3),  m:mkM(0,.15,.44),  t:.25},   // tracks
    {g:B(1.5,.3,.3),  m:mkM(0,.15,-.44), t:.25},
    {g:B(1.4,.32,.78),m:mkM(0,.42,0),    t:1.0},   // hull
    {g:B(.4,.2,.78),  m:mkM(.8,.36,0,0,0,-.35),t:.85}, // glacis
    {g:B(.66,.3,.54), m:mkM(-.1,.72,0),  t:.8},    // turret
    {g:new THREE.CylinderGeometry(.05,.06,1.05,6), m:mkM(.62,.74,0,0,0,-Math.PI/2), t:.3}, // barrel
    {g:B(.2,.1,.2),   m:mkM(-.22,.92,.1),t:.3},    // cupola
  ]);
}
function buildSoldier(){ // faces +X
  return mergeGeoms([
    {g:B(.13,.34,.11), m:mkM(0,.17,.08), t:.5},    // legs
    {g:B(.13,.34,.11), m:mkM(0,.17,-.08),t:.5},
    {g:B(.2,.4,.3),    m:mkM(0,.54,0),   t:1.0},   // torso
    {g:B(.34,.09,.09), m:mkM(.14,.6,0),  t:.2},    // rifle
    {g:new THREE.SphereGeometry(.1,6,5), m:mkM(0,.85,0), t:.85}, // head
    {g:new THREE.SphereGeometry(.12,6,4),m:mkM(0,.88,0,0,0,0,1,.62,1), t:.3}, // helmet
  ]);
}
function buildJet(){ // F-35-ish, faces +X, wingspan ~2.4
  return mergeGeoms([
    {g:B(1.9,.24,.36), m:mkM(0,.0,0),    t:.55},   // fuselage
    {g:new THREE.ConeGeometry(.17,.6,8), m:mkM(1.2,0,0,0,0,-Math.PI/2), t:.55}, // nose
    {g:new THREE.SphereGeometry(.15,7,5),m:mkM(.5,.14,0,0,0,0,1.5,.66,.8), t:.14}, // canopy
    {g:B(.95,.05,2.4), m:mkM(-.1,0,0),   t:.5},    // delta wings
    {g:B(.5,.04,1.05), m:mkM(-.85,.02,0),t:.5},    // tailplane
    {g:B(.42,.5,.05),  m:mkM(-.8,.26,.3,.35,0,0),  t:.45}, // canted tails
    {g:B(.42,.5,.05),  m:mkM(-.8,.26,-.3,-.35,0,0),t:.45},
    {g:new THREE.CylinderGeometry(.11,.13,.25,8), m:mkM(-1.0,0,0,0,0,-Math.PI/2), t:.2}, // nozzle
  ]);
}

function buildBattery(){ // S-400 TEL: truck + 4 raised launch tubes, faces +X
  const parts=[
    {g:B(1.5,.28,.7), m:mkM(0,.28,0),   t:.35},   // chassis
    {g:B(.4,.34,.66), m:mkM(.62,.5,0),  t:.9},    // cab
    {g:B(.16,.18,.7), m:mkM(-.6,.14,0), t:.2},    // rear axle block
    {g:B(1.0,.14,.66),m:mkM(-.1,.46,0), t:.6},    // erector base
  ];
  // four tubes tilted up ~55° pointing +X/up
  for(let k=0;k<4;k++){
    const z=(k-1.5)*.16;
    parts.push({g:new THREE.CylinderGeometry(.07,.07,1.0,7),
      m:mkM(-.35,.85,z, 0,0,-0.95, 1,1,1), t:k%2?.5:.85});
    parts.push({g:new THREE.ConeGeometry(.075,.16,7),
      m:mkM(0.1,1.2,z, 0,0,-0.95, 1,1,1), t:1.15}); // warhead tips (brighten)
  }
  return mergeGeoms(parts);
}

V.init=function(){
  if(V.ready)return true;
  if(!window.THREE)return false;
  try{ R=new THREE.WebGLRenderer({canvas:glC,antialias:true,preserveDrawingBuffer:true}); }
  catch(e){ return false; }
  dummy=new THREE.Object3D();
  R.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
  R.setSize(W,H);
  R.outputEncoding=THREE.sRGBEncoding;
  SC=new THREE.Scene();
  SC.background=new THREE.Color(0x070b0a);
  SC.fog=new THREE.FogExp2(0x070b0a,0.0075);
  CAMR=new THREE.PerspectiveCamera(55,W/H,.1,900);
  rig.focus=new THREE.Vector3(0,0,0);

  // terrain draped with the live political map
  const geo=new THREE.PlaneGeometry(GW,GH,GW-1,GH-1);
  const pos=geo.attributes.position;
  for(let iy=0;iy<GH;iy++)for(let ix=0;ix<GW;ix++)
    pos.setZ(iy*GW+ix,height[iy*GW+ix]*AMP);
  geo.rotateX(-Math.PI/2);
  geo.computeVertexNormals();
  tex=new THREE.CanvasTexture(terr);
  tex.magFilter=THREE.NearestFilter; tex.minFilter=THREE.LinearFilter; tex.generateMipmaps=false;
  tex.encoding=THREE.sRGBEncoding;
  terrMesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({map:tex}));
  SC.add(terrMesh);
  const under=new THREE.Mesh(new THREE.BoxGeometry(GW,8,GH),
    new THREE.MeshBasicMaterial({color:0x05100c}));
  under.position.y=-4.2; SC.add(under);

  SC.add(new THREE.HemisphereLight(0xbfe8c8,0x0a0e0d,.95));
  const sun=new THREE.DirectionalLight(0xfff0d0,.85);
  sun.position.set(70,110,-50); SC.add(sun);

  fireTex=new THREE.CanvasTexture(SPR_FIRE);
  coreTex=new THREE.CanvasTexture(SPR_CORE);
  smokeTex=new THREE.CanvasTexture(SPR_SMOKE);

  tankMesh=new THREE.InstancedMesh(buildTank(),new THREE.MeshLambertMaterial({vertexColors:true}),90);
  infMesh=new THREE.InstancedMesh(buildSoldier(),new THREE.MeshLambertMaterial({vertexColors:true}),240);
  jetMesh=new THREE.InstancedMesh(buildJet(),new THREE.MeshLambertMaterial({vertexColors:true}),8);
  batMesh=new THREE.InstancedMesh(buildBattery(),new THREE.MeshLambertMaterial({vertexColors:true}),110);
  shellMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(.17,6,6),
    new THREE.MeshBasicMaterial({color:0xffe2a6}),96);
  for(const m of [tankMesh,infMesh,jetMesh,batMesh,shellMesh]){ m.frustumCulled=false; SC.add(m); }

  sparkGeo=new THREE.BufferGeometry();
  sparkGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(900*3),3));
  sparkGeo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(900*3),3));
  sparkPts=new THREE.Points(sparkGeo,new THREE.PointsMaterial({size:.5,vertexColors:true,
    transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false}));
  sparkPts.frustumCulled=false; SC.add(sparkPts);

  debGeo=new THREE.BufferGeometry();
  debGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(250*3),3));
  debPts=new THREE.Points(debGeo,new THREE.PointsMaterial({size:.4,color:0x40342a,
    transparent:true,opacity:.9,depthWrite:false}));
  debPts.frustumCulled=false; SC.add(debPts);

  traGeo=new THREE.BufferGeometry();
  traGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(200*2*3),3));
  traLines=new THREE.LineSegments(traGeo,new THREE.LineBasicMaterial({color:0xffdf90,
    transparent:true,opacity:.6,blending:THREE.AdditiveBlending,depthWrite:false}));
  traLines.frustumCulled=false; SC.add(traLines);

  const mkSprite=(map,blend)=>{ const s=new THREE.Sprite(new THREE.SpriteMaterial({map,
    transparent:true,depthWrite:false,blending:blend||THREE.NormalBlending}));
    s.visible=false; s.frustumCulled=false; SC.add(s); return s; };
  for(let i=0;i<300;i++)smokePool.push(mkSprite(smokeTex));
  for(let i=0;i<160;i++)burstPool.push(mkSprite(fireTex,THREE.AdditiveBlending));
  for(let i=0;i<140;i++)flamePool.push(mkSprite(fireTex,THREE.AdditiveBlending));
  const ringGeo=new THREE.RingGeometry(.88,1,48); ringGeo.rotateX(-Math.PI/2);
  for(let i=0;i<24;i++){ const m=new THREE.Mesh(ringGeo,
    new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide}));
    m.visible=false; m.frustumCulled=false; SC.add(m); ringPool.push(m); }
  // missile body: nose cone points -Z so lookAt() aims it along travel
  const mslGeo=mergeGeoms([
    {g:new THREE.CylinderGeometry(.12,.12,1.1,8), m:mkM(0,0,0,Math.PI/2,0,0), t:.85},
    {g:new THREE.ConeGeometry(.12,.4,8),          m:mkM(0,0,-.72,-Math.PI/2,0,0), t:1.15},
    {g:B(.5,.03,.24),                             m:mkM(0,0,.5),  t:.5},
    {g:B(.03,.5,.24),                             m:mkM(0,0,.5),  t:.5},
  ]);
  for(let i=0;i<4;i++){ const b=new THREE.Mesh(mslGeo,
    new THREE.MeshBasicMaterial({color:0xd8dce0}));
    b.visible=false; b.frustumCulled=false; SC.add(b); bombPool.push(b); }

  ray=new THREE.Raycaster(); mouseNDC=new THREE.Vector2();
  hookInput();
  V.ready=true;
  return true;
};

V.resize=function(w,h){ if(!V.ready)return; R.setSize(w,h); CAMR.aspect=w/h; CAMR.updateProjectionMatrix(); };
V.toggleAuto=function(){ V.auto=!V.auto; return V.auto; };
V.onStrike=function(gx,gy){ if(!V.ready||!V.auto)return;
  rig.strikeT=5.5; rig.target=new THREE.Vector3(wX(gx),hAt(gx,gy),wZ(gy)); rig.distT=34; };

/* ---------------- input: PAN (left-drag) · ORBIT (right/shift-drag) · zoom-to-cursor · dbl-click fly ---------------- */
let d3=null,d3moved=false;
function killAuto(){ V.auto=false; const b=document.getElementById('bCam'); if(b)b.classList.remove('on'); }
function groundPoint(px,py){
  mouseNDC.set(px/W*2-1,-(py/H)*2+1);
  ray.setFromCamera(mouseNDC,CAMR);
  const hit=ray.intersectObject(terrMesh,false)[0];
  return hit?hit.point:null;
}
function hookInput(){
  glC.addEventListener('contextmenu',e=>e.preventDefault());
  glC.addEventListener('mousedown',e=>{
    const orbit=(e.button===2)||e.shiftKey;
    d3={x:e.clientX,y:e.clientY,px:e.clientX,py:e.clientY,yaw:rig.yaw,pitch:rig.pitch,
        fx:rig.focus.x,fz:rig.focus.z,orbit}; d3moved=false;
    glC.classList.add('drag');
  });
  addEventListener('mousemove',e=>{
    if(!MODE3D)return;
    if(d3){
      const dx=e.clientX-d3.x, dy=e.clientY-d3.y;
      if(!d3moved&&Math.abs(dx)+Math.abs(dy)>4){d3moved=true; killAuto(); tip.style.display='none';}
      if(d3moved){
        if(d3.orbit){
          rig.yaw=d3.yaw-dx*.005;
          rig.pitch=clamp(d3.pitch+dy*.004,.10,1.45);
        }else{
          // pan: grab the world — move focus opposite the drag, scaled to ground distance
          const sc=(rig.dist*1.15)/H;
          const cy=Math.cos(rig.yaw), sy=Math.sin(rig.yaw);
          const mdx=e.clientX-d3.px, mdy=e.clientY-d3.py;
          // right vector (sin,cos)?; use camera-ground basis: fwd=(-sy,-cy), right=(cy,-sy)
          rig.focus.x-=(mdx*cy - mdy*sy)*sc;
          rig.focus.z-=(mdx*(-sy) - mdy*cy)*sc;
          rig.focus.x=clamp(rig.focus.x,-GW/2,GW/2);
          rig.focus.z=clamp(rig.focus.z,-GH/2,GH/2);
        }
        d3.px=e.clientX; d3.py=e.clientY;
        return;
      }
    }
    const t=performance.now(); if(t-lastPick<70)return; lastPick=t;
    const o=pick(e.clientX,e.clientY);
    if(o>=0&&tokens[o])showTip(o,e.clientX,e.clientY); else tip.style.display='none';
  });
  addEventListener('mouseup',()=>{ d3=null; glC.classList.remove('drag'); });
  glC.addEventListener('click',e=>{
    if(d3moved){d3moved=false;return;}
    if(e.detail>1)return; // second click of a dbl-click: don't toggle the intel card off
    const o=pick(e.clientX,e.clientY);
    selectToken(o>=0?o:-1);
  });
  glC.addEventListener('dblclick',e=>{  // fly straight to the point under the cursor
    const gp=groundPoint(e.clientX,e.clientY); if(!gp)return;
    killAuto();
    rig.target=new THREE.Vector3(gp.x,gp.y,gp.z);
    rig.distT=clamp(rig.dist*.5,10,60);
    setTimeout(()=>{rig.target=null;},700);
  });
  glC.addEventListener('wheel',e=>{
    e.preventDefault();
    killAuto();
    const f=Math.exp(e.deltaY*.0012);
    const nd=clamp(rig.distT*f,8,300);
    if(nd<rig.distT){ // zoom toward the ground point under the cursor
      const gp=groundPoint(e.clientX,e.clientY);
      if(gp){ const k=(rig.distT-nd)/rig.distT*.7;
        rig.focus.x+=(gp.x-rig.focus.x)*k;
        rig.focus.z+=(gp.z-rig.focus.z)*k;
        rig.focus.x=clamp(rig.focus.x,-GW/2,GW/2);
        rig.focus.z=clamp(rig.focus.z,-GH/2,GH/2);
      }
    }
    rig.distT=nd;
  },{passive:false});
  addEventListener('keydown',e=>{ if(MODE3D)keys.add(e.code); });
  addEventListener('keyup',e=>{ keys.delete(e.code); });
  // touch: 1-finger orbit, 2-finger pinch dolly
  let tt=new Map(),tp0=0,td0=0;
  glC.addEventListener('touchstart',e=>{
    for(const t of e.changedTouches)tt.set(t.identifier,{x:t.clientX,y:t.clientY});
    if(tt.size===2){const [a,b]=[...tt.values()];tp0=Math.hypot(a.x-b.x,a.y-b.y);td0=rig.distT;}
  },{passive:true});
  glC.addEventListener('touchmove',e=>{
    e.preventDefault(); killAuto();
    if(tt.size===1){ // one finger = pan the map
      const t=e.changedTouches[0],p=tt.get(t.identifier); if(!p)return;
      const sc=(rig.dist*1.15)/H, cy=Math.cos(rig.yaw), sy=Math.sin(rig.yaw);
      const mdx=t.clientX-p.x, mdy=t.clientY-p.y;
      rig.focus.x-=(mdx*cy - mdy*sy)*sc;
      rig.focus.z-=(mdx*(-sy) - mdy*cy)*sc;
      rig.focus.x=clamp(rig.focus.x,-GW/2,GW/2);
      rig.focus.z=clamp(rig.focus.z,-GH/2,GH/2);
      tt.set(t.identifier,{x:t.clientX,y:t.clientY});
    }else if(tt.size===2){
      for(const t of e.changedTouches)tt.set(t.identifier,{x:t.clientX,y:t.clientY});
      const [a,b]=[...tt.values()];
      rig.distT=clamp(td0*tp0/Math.max(20,Math.hypot(a.x-b.x,a.y-b.y)),14,280);
    }
  },{passive:false});
  glC.addEventListener('touchend',e=>{ for(const t of e.changedTouches)tt.delete(t.identifier); },{passive:true});
}
function pick(px,py){
  mouseNDC.set(px/W*2-1,-(py/H)*2+1);
  ray.setFromCamera(mouseNDC,CAMR);
  const hit=ray.intersectObject(terrMesh,false)[0];
  if(!hit)return -1;
  const gx=(hit.point.x+GW/2)|0, gy=(hit.point.z+GH/2)|0;
  if(gx<0||gy<0||gx>=GW||gy>=GH)return -1;
  return owner[gy*GW+gx];
}

/* ---------------- per-frame ---------------- */
function updateCam(now,dt){
  // auto: slow orbit, drift to the hottest front, swoop onto strikes
  if(V.auto){
    rig.yaw+=dt*.05;
    if(rig.strikeT>0){ rig.strikeT-=dt; if(rig.strikeT<=0){rig.target=null;rig.distT=110;} }
    else{
      rig.driftT-=dt;
      if(rig.driftT<=0){ rig.driftT=7;
        let bi=-1,bh=.35;
        for(let k=0;k<hotCells.length;k+=3){ const i=hotCells[k]; if(heat[i]>bh){bh=heat[i];bi=i;} }
        if(bi>=0){ rig.target=new THREE.Vector3(wX(gX(bi)),hAt(gX(bi),gY(bi)),wZ(gY(bi))); rig.distT=80; }
        else { rig.target=new THREE.Vector3(0,0,0); rig.distT=120; }
      }
    }
  }
  // WASD fly
  const spd=(rig.dist*.55+8)*dt;
  const fwd=new THREE.Vector3(-Math.sin(rig.yaw),0,-Math.cos(rig.yaw));
  const rgt=new THREE.Vector3(-fwd.z,0,fwd.x);
  if(keys.has('KeyW'))rig.focus.addScaledVector(fwd,spd),V.auto=false;
  if(keys.has('KeyS'))rig.focus.addScaledVector(fwd,-spd),V.auto=false;
  if(keys.has('KeyA'))rig.focus.addScaledVector(rgt,-spd),V.auto=false;
  if(keys.has('KeyD'))rig.focus.addScaledVector(rgt,spd),V.auto=false;
  if(rig.target)rig.focus.lerp(rig.target,1-Math.exp(-dt*2.2));
  rig.focus.x=clamp(rig.focus.x,-GW/2,GW/2);
  rig.focus.z=clamp(rig.focus.z,-GH/2,GH/2);
  rig.focus.y=hAt(rig.focus.x+GW/2,rig.focus.z+GH/2);
  rig.dist+=(rig.distT-rig.dist)*(1-Math.exp(-dt*2.5));
  const cp=Math.cos(rig.pitch),sp=Math.sin(rig.pitch);
  const px=rig.focus.x+cp*Math.sin(rig.yaw)*rig.dist;
  const pz=rig.focus.z+cp*Math.cos(rig.yaw)*rig.dist;
  let py=rig.focus.y+sp*rig.dist;
  const minY=hAt(px+GW/2,pz+GH/2)+1.2;
  if(py<minY)py=minY;
  CAMR.position.set(px+(shake?rnd(-shake,shake)*.08:0),py+(shake?rnd(-shake,shake)*.08:0),pz);
  CAMR.lookAt(rig.focus.x,rig.focus.y+1.5,rig.focus.z);
}

V.render=function(now,dt){
  if(!V.ready)return;
  updateCam(now,dt);
  tex.needsUpdate=true;

  // units
  let nt=0,ni=0,nj=0;
  const bobA=now/160;
  for(const u of units){
    const t=tokens[u.team]; if(!t||t.dead)continue;
    const h=hAt(u.x,u.y);
    const ddx=u.tx-u.x, ddy=u.ty-u.y;
    if(ddx*ddx+ddy*ddy>.02)u.hd=Math.atan2(ddy,ddx);   // face where you march
    const hd=u.hd||0;
    if(u.kind===1&&nt<90){
      dummy.position.set(wX(u.x),h,wZ(u.y));
      dummy.rotation.set(0,-hd,0);
      dummy.updateMatrix();
      tankMesh.setMatrixAt(nt,dummy.matrix);
      tankMesh.setColorAt(nt,new THREE.Color(t.rgb[0]/255,t.rgb[1]/255,t.rgb[2]/255));
      nt++;
    }else if(u.kind===0&&ni<240){
      dummy.position.set(wX(u.x),h+Math.abs(Math.sin(bobA*2+u.phase))*.05,wZ(u.y));
      dummy.rotation.set(0,-hd,0);
      dummy.updateMatrix();
      infMesh.setMatrixAt(ni,dummy.matrix);
      infMesh.setColorAt(ni,new THREE.Color(t.rgb[0]/255*1.25,t.rgb[1]/255*1.25,t.rgb[2]/255*1.25));
      ni++;
    }
  }
  for(const j of jets){
    if(nj>=8)break;
    const t=tokens[j.team]; if(!t)continue;
    const hd=Math.atan2(j.vy,j.vx);
    dummy.position.set(wX(j.x),11+Math.sin(now/300+j.phase)*.5,wZ(j.y));
    dummy.rotation.set(0,-hd,Math.sin(now/900+j.phase)*.12);
    dummy.scale.set(1.6,1.6,1.6);
    dummy.updateMatrix();
    dummy.scale.set(1,1,1);
    jetMesh.setMatrixAt(nj,dummy.matrix);
    jetMesh.setColorAt(nj,new THREE.Color(t.rgb[0]/255,t.rgb[1]/255,t.rgb[2]/255));
    nj++;
  }
  tankMesh.count=nt; infMesh.count=ni; jetMesh.count=nj;
  tankMesh.instanceMatrix.needsUpdate=true; infMesh.instanceMatrix.needsUpdate=true; jetMesh.instanceMatrix.needsUpdate=true;
  if(tankMesh.instanceColor)tankMesh.instanceColor.needsUpdate=true;
  if(infMesh.instanceColor)infMesh.instanceColor.needsUpdate=true;
  if(jetMesh.instanceColor)jetMesh.instanceColor.needsUpdate=true;

  // S-400 batteries at each capital
  let nb=0;
  for(const t of tokens){
    if(nb>=110)break;
    const bat=batteryOf(t); if(!bat)continue;
    dummy.position.set(wX(bat.x),hAt(bat.x,bat.y),wZ(bat.y));
    dummy.rotation.set(0,(t.batYaw||(t.batYaw=rnd(0,TAU))),0);
    dummy.scale.set(1.15,1.15,1.15); dummy.updateMatrix(); dummy.scale.set(1,1,1);
    batMesh.setMatrixAt(nb,dummy.matrix);
    batMesh.setColorAt(nb,new THREE.Color(t.rgb[0]/255,t.rgb[1]/255,t.rgb[2]/255));
    nb++;
  }
  batMesh.count=nb; batMesh.instanceMatrix.needsUpdate=true;
  if(batMesh.instanceColor)batMesh.instanceColor.needsUpdate=true;

  // shells + battery missiles (arced)
  let ns=0;
  for(const s of shells){
    if(ns>=96)break;
    const p=s.l/s.dur;
    const gx=s.x0+(s.x1-s.x0)*p, gy=s.y0+(s.y1-s.y0)*p;
    const h0=hAt(s.x0,s.y0), h1=hAt(s.x1,s.y1);
    dummy.position.set(wX(gx),h0+(h1-h0)*p+Math.sin(Math.PI*p)*s.arc*2+.4,wZ(gy));
    if(s.msl){ // orient the missile along its velocity
      const p2=Math.max(0,p-.04);
      const gx2=s.x0+(s.x1-s.x0)*p2, gy2=s.y0+(s.y1-s.y0)*p2;
      const hy2=h0+(h1-h0)*p2+Math.sin(Math.PI*p2)*s.arc*2+.4;
      const cy=h0+(h1-h0)*p+Math.sin(Math.PI*p)*s.arc*2+.4;
      dummy.rotation.set(0,-Math.atan2(gy-gy2,gx-gx2),Math.atan2(cy-hy2,Math.hypot(gx-gx2,gy-gy2)));
      dummy.scale.set(2.4,1,1);
    }else{ dummy.rotation.set(0,0,0); dummy.scale.set(1,1,1); }
    dummy.updateMatrix(); dummy.scale.set(1,1,1);
    shellMesh.setMatrixAt(ns++,dummy.matrix);
  }
  shellMesh.count=ns; shellMesh.instanceMatrix.needsUpdate=true;

  // sparks / debris points
  let pp=sparkGeo.attributes.position.array, cc=sparkGeo.attributes.color.array, np=0;
  for(const s of sparks){
    if(np>=900)break;
    const a=1-s.l/s.ttl;
    pp[np*3]=wX(s.x); pp[np*3+1]=hAt(s.x,s.y)+.5; pp[np*3+2]=wZ(s.y);
    cc[np*3]=s.rgb[0]/255*a; cc[np*3+1]=s.rgb[1]/255*a; cc[np*3+2]=s.rgb[2]/255*a;
    np++;
  }
  sparkGeo.setDrawRange(0,np);
  sparkGeo.attributes.position.needsUpdate=true; sparkGeo.attributes.color.needsUpdate=true;
  let dp=debGeo.attributes.position.array, nd=0;
  for(const d of debris){
    if(nd>=250)break;
    dp[nd*3]=wX(d.x); dp[nd*3+1]=hAt(d.x,d.y)+.4; dp[nd*3+2]=wZ(d.y);
    nd++;
  }
  debGeo.setDrawRange(0,nd); debGeo.attributes.position.needsUpdate=true;

  // tracers
  let tp=traGeo.attributes.position.array, ntr=0;
  for(const tr of tracers){
    if(ntr>=200)break;
    tp[ntr*6]=wX(tr.x1); tp[ntr*6+1]=hAt(tr.x1,tr.y1)+.55; tp[ntr*6+2]=wZ(tr.y1);
    tp[ntr*6+3]=wX(tr.x2); tp[ntr*6+4]=hAt(tr.x2,tr.y2)+.55; tp[ntr*6+5]=wZ(tr.y2);
    ntr++;
  }
  traGeo.setDrawRange(0,ntr*2); traGeo.attributes.position.needsUpdate=true;

  // smoke sprites (vy rises = altitude gain over its ground point iy)
  for(let i=0;i<smokePool.length;i++){
    const sp=smokePool[i], s=smokes[i];
    if(!s){sp.visible=false;continue;}
    const p=s.l/s.ttl, alt=Math.max(0,(s.iy-s.y))*1.5+.5+(s.a0||0);
    sp.visible=true;
    sp.position.set(wX(s.x),hAt(s.x,s.iy)+alt,wZ(s.iy));
    const sc=Math.max(.1,s.r)*2.4;
    sp.scale.set(sc,sc,1);
    sp.material.opacity=(1-p)*.42;
    sp.material.color.setScalar(s.g/110);
  }
  // fireballs
  for(let i=0;i<burstPool.length;i++){
    const sp=burstPool[i], b=bursts[i];
    if(!b){sp.visible=false;continue;}
    const p=b.l/b.ttl, sc=(.5+p*1.2)*b.s*2.6;
    sp.visible=true;
    sp.position.set(wX(b.x),hAt(b.x,b.y)+.6+b.s*.35,wZ(b.y));
    sp.scale.set(sc,sc,1);
    sp.material.opacity=Math.pow(1-p,1.25);
  }
  // burning ground
  let nf=0;
  for(let k=0;k<hotCells.length&&nf<flamePool.length;k++){
    const i=hotCells[k], h=heat[i];
    if(h<.5)continue;
    const fl=h*(.55+.45*Math.sin(now/70+i*7.3));
    const sp=flamePool[nf++];
    sp.visible=true;
    sp.position.set(wX(gX(i)),hAt(gX(i),gY(i))+.45,wZ(gY(i)));
    const sc=.8+fl;
    sp.scale.set(sc,sc,1);
    sp.material.opacity=clamp(fl*.8,0,1);
  }
  for(let k=nf;k<flamePool.length;k++)flamePool[k].visible=false;
  // rings
  for(let i=0;i<ringPool.length;i++){
    const m=ringPool[i], r=rings[i];
    if(!r){m.visible=false;continue;}
    const p=r.l/r.ttl, rad=Math.max(.1,(r.r+(r.tr-r.r)*Math.pow(p,.6)));
    m.visible=true;
    m.position.set(wX(r.x),hAt(r.x,r.y)+.18,wZ(r.y));
    m.scale.set(rad,1,rad);
    m.material.opacity=1-p;
    m.material.color.setRGB(r.rgb[0]/255,r.rgb[1]/255,r.rgb[2]/255);
  }
  // ballistic missiles (nuke): fly the arc from the launch site to the target
  for(let i=0;i<bombPool.length;i++){
    const m=bombPool[i], b=bombs[i];
    if(!b){m.visible=false;continue;}
    const p=Math.min(1,b.l/b.dur);
    const bx=b.x0+(b.x1-b.x0)*p, by=b.y0+(b.y1-b.y0)*p;
    const h0=hAt(b.x0,b.y0), h1=hAt(b.x1,b.y1);
    const arc=Math.hypot(b.x1-b.x0,b.y1-b.y0)*.55+8;
    const yy=h0+(h1-h0)*p+Math.sin(Math.PI*p)*arc+1;
    m.visible=true;
    m.position.set(wX(bx),yy,wZ(by));
    const p2=Math.max(0,p-.03);
    const bx2=b.x0+(b.x1-b.x0)*p2, by2=b.y0+(b.y1-b.y0)*p2;
    const yy2=h0+(h1-h0)*p2+Math.sin(Math.PI*p2)*arc+1;
    m.lookAt(wX(bx2),yy2,wZ(by2));
    m.scale.set(1,1,2.2);
  }

  R.render(SC,CAMR);

  /* HUD overlay: labels + floats + white flash on the 2D fx canvas */
  fctx.setTransform(DPR,0,0,DPR,0,0);
  fctx.clearRect(0,0,W,H);
  const v=new THREE.Vector3();
  fctx.textAlign='center'; fctx.textBaseline='middle';
  for(const t of tokens){
    const ln=t.labelN||0;
    if(t.dead||ln<9)continue;
    v.set(wX(t.cx+.5),hAt(t.cx+.5,t.cy+.5)+2,wZ(t.cy+.5));
    const dcam=CAMR.position.distanceTo(v);
    v.project(CAMR);
    if(v.z>1)continue;
    const px=(v.x+1)/2*W, py=(-v.y+1)/2*H;
    if(px<-90||py<-40||px>W+90||py>H+40)continue;
    const fs=clamp(Math.sqrt(ln)*140/dcam,8,26);
    if(fs<8.5&&ln<40)continue;
    const name=(t.rugged?'☠ ':'')+t.sym+(t.tag||'');
    fctx.font='800 '+fs+'px '+FONT;
    const tw=fctx.measureText(name).width;
    fctx.globalAlpha=clamp(2-dcam/160,0.25,1);
    fctx.fillStyle='rgba(5,8,7,.55)';
    fctx.fillRect(px-tw/2-4,py-fs*.62,tw+8,fs*1.24);
    fctx.strokeStyle='rgba(255,255,255,.14)';fctx.lineWidth=1;
    fctx.strokeRect(px-tw/2-4,py-fs*.62,tw+8,fs*1.24);
    fctx.fillStyle='#fff';fctx.fillText(name,px,py);
    if(fs>15){
      fctx.font='600 '+fs*.44+'px '+FONT;
      const sub=(t.count/NCELL*100).toFixed(1)+'% · '+fmtUsd(t.vol24);
      const sw=fctx.measureText(sub).width;
      fctx.fillStyle='rgba(5,8,7,.45)';
      fctx.fillRect(px-sw/2-3,py+fs*.62,sw+6,fs*.6);
      fctx.fillStyle='rgba(255,255,255,.8)';
      fctx.fillText(sub,px,py+fs*.92);
    }
    fctx.globalAlpha=1;
  }
  for(const f of floats){
    v.set(wX(f.x),hAt(f.x,f.y)+2.5+f.l*3.5,wZ(f.y));
    v.project(CAMR);
    if(v.z>1)continue;
    fctx.font='700 16px '+FONT;
    fctx.fillStyle=f.col; fctx.globalAlpha=1-f.l/f.ttl;
    fctx.fillText(f.txt,(v.x+1)/2*W,(-v.y+1)/2*H);
    fctx.globalAlpha=1;
  }
  fctx.textAlign='left';
  if(whiteFlash>.01){
    fctx.fillStyle=`rgba(255,252,240,${whiteFlash*.85})`;
    fctx.fillRect(0,0,W,H);
  }
};
})();
