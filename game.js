// FROSTBOUND — mobile-first open-world creature combat (Three.js, all-procedural art).
// File layout (search for the banner comments):
//   [CORE]    renderer, utils, shared geometry/materials, game state, hooks
//   [WORLD]   seeded terrain, water, icebergs, crystals, totems, sky/aurora, snow
//   [PLAYER]  Glacira model, movement, swimming, camera
//   [INPUT]   touch joystick, ability buttons, keyboard
//   [COMBAT]  enemies (TYPES table + AI state machine), projectiles, abilities
//   [SEA]     sea enemy types, Frost Nova, XP/leveling, saving
//   [BOSS/FX] Aurora Leviathan, particles, damage numbers, minimap, audio
// To add a zone: extend rawHeight() / zoneAt(), add entries to TYPES and call addSpawns().
import * as THREE from 'three';

// ======================= [CORE] =======================
const $ = id => document.getElementById(id);
function mulberry32(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rng = mulberry32(20261127);           // world seed: same layout every load
const rr = (a,b)=>a+rng()*(b-a);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const TAU=Math.PI*2;
function angLerp(a,b,t){const d=((b-a+Math.PI)%TAU+TAU)%TAU-Math.PI;return a+d*t}

const renderer=new THREE.WebGLRenderer({canvas:$('c'),antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
const scene=new THREE.Scene();
const SKY=0x9fd3ee;
scene.background=new THREE.Color(SKY);
scene.fog=new THREE.Fog(SKY,45,150);
const camera=new THREE.PerspectiveCamera(60,1,0.1,420);
function resize(){const w=window.innerWidth,h=window.innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
addEventListener('resize',resize);addEventListener('orientationchange',()=>setTimeout(resize,250));resize();
scene.add(new THREE.HemisphereLight(0xffffff,0x6fa8c8,1.5));
const sun=new THREE.DirectionalLight(0xfff4e0,1.6);sun.position.set(40,80,20);scene.add(sun);

// Shared geometry + material helpers (reuse everything: iPhone friendly)
const G={sph:new THREE.SphereGeometry(1,8,6),cone:new THREE.ConeGeometry(0.5,1,6),dode:new THREE.DodecahedronGeometry(1,0),
  oct:new THREE.OctahedronGeometry(1,0),ring:new THREE.RingGeometry(0.86,1,32),disc:new THREE.CircleGeometry(1,24),cyl:new THREE.CylinderGeometry(0.5,0.7,1,6)};
G.ring.rotateX(-Math.PI/2);G.disc.rotateX(-Math.PI/2);
const mat=(c,o={})=>new THREE.MeshLambertMaterial({color:c,flatShading:true,...o});
const bmat=(c,o={})=>new THREE.MeshBasicMaterial({color:c,...o});
function part(parent,geo,m,x,y,z,sx=1,sy=sx,sz=sx){const o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.userData.m=m;parent.add(o);return o;}

// Global state + extension hooks. Later sections push into `systems` and override `actions`/`fx`.
const game={started:false,paused:false,time:0,shake:0,hitstop:0,zone:''};
const systems=[];                      // per-frame updaters: fn(dt)
const onStart=[];                      // run inside the Play tap (audio unlock etc.)
const actions={attack(){},shard(){},dash(){},nova(){}};
const cds={atk:0,shard:0,dash:0,nova:0};
const cdMax={shard:1.2,dash:2,nova:6};
const cost={shard:15,dash:20,nova:35};
const fx={burst(){},number(){},sfx(){},shake(a){game.shake=Math.max(game.shake,a)},hitstop(t){game.hitstop=Math.max(game.hitstop,t)}};
let gainXP=()=>{};
function toast(t){const el=$('toast');el.textContent=t;el.classList.remove('show');void el.offsetWidth;el.classList.add('show');}

// ======================= [WORLD] =======================
const WORLD=400,HALF=200,SEG=128,CELL=WORLD/SEG,BOUND=190;
const BOSS_LAIR={x:118,z:-128};
// Ice floes: flat stepping areas out in the sea (first one is the checkpoint near the boss lair)
const floes=[{x:86,z:-94,r:9}];
for(let i=0;i<16;i++){const a=rr(0,TAU),d=rr(118,168),f={x:Math.cos(a)*d,z:Math.sin(a)*d,r:rr(6,11)};
  if(Math.hypot(f.x-BOSS_LAIR.x,f.z-BOSS_LAIR.z)>40)floes.push(f);}
// Height field: wobbly island (Iceberg Fields) → shoreline → sea bed (Polar Sea, h<0)
function rawHeight(x,z){
  const d=Math.hypot(x,z),a=Math.atan2(z,x);
  const R=95+16*Math.sin(3*a+1)+9*Math.sin(5*a+2.3);
  const base=(R-d)*0.12;let h;
  if(base>0){const n=Math.sin(x*0.13+1.7)*Math.cos(z*0.11+0.4)+0.5*Math.sin(x*0.31+z*0.27);h=Math.min(base,1.4)+(n+1.5)*0.8*Math.min(base,1);}
  else h=Math.max(base*1.4,-7);
  for(const f of floes){if(Math.hypot(x-f.x,z-f.z)<f.r)h=Math.max(h,0.5);}
  return h;
}
const N1=SEG+1,heights=new Float32Array(N1*N1);
{
  const geo=new THREE.PlaneGeometry(WORLD,WORLD,SEG,SEG);geo.rotateX(-Math.PI/2);
  const pos=geo.attributes.position,col=new Float32Array(pos.count*3),c=new THREE.Color();
  for(let i=0;i<pos.count;i++){
    const h=rawHeight(pos.getX(i),pos.getZ(i));heights[i]=h;pos.setY(i,h);
    if(h>0.35)c.setHSL(0.56,0.35,0.86+0.1*Math.sin(i*12.9898)%0.08);
    else if(h>-0.8)c.setHex(0xa9def5);else c.setHSL(0.57,0.5,clamp(0.42+h*0.04,0.15,0.5));
    col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;
  }
  geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  scene.add(new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true})));
}
// Bilinear ground sample matching the terrain mesh
function groundAt(x,z){
  const fx=clamp((x+HALF)/CELL,0,SEG-0.001),fz=clamp((z+HALF)/CELL,0,SEG-0.001),i=fx|0,j=fz|0,u=fx-i,v=fz-j,k=j*N1+i;
  return lerp(lerp(heights[k],heights[k+1],u),lerp(heights[k+N1],heights[k+N1+1],u),v);
}
// Water: translucent animated vertex-wave plane
const waterGeo=new THREE.PlaneGeometry(WORLD+60,WORLD+60,44,44);waterGeo.rotateX(-Math.PI/2);
const water=new THREE.Mesh(waterGeo,new THREE.MeshPhongMaterial({color:0x2a90c4,transparent:true,opacity:0.74,flatShading:true,shininess:60,specular:0x99ddff}));
scene.add(water);
// Icebergs (instanced, also circle colliders) + crystals (instanced, decorative glow)
const obstacles=[];
{
  const n=46,im=new THREE.InstancedMesh(G.dode,mat(0xcdeeff),n),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),s=new THREE.Vector3(),p=new THREE.Vector3();
  let k=0,guard=0;
  while(k<n&&guard++<999){const a=rr(0,TAU),d=rr(16,182),x=Math.cos(a)*d,z=Math.sin(a)*d;
    if(Math.hypot(x-BOSS_LAIR.x,z-BOSS_LAIR.z)<34||floes.some(f=>Math.hypot(x-f.x,z-f.z)<f.r+5))continue;
    const r=rr(2,5),g=groundAt(x,z);p.set(x,Math.max(g,-0.6)+r*0.5,z);e.set(rr(-.3,.3),rr(0,TAU),rr(-.3,.3));q.setFromEuler(e);s.set(r,r*rr(1.2,2.4),r);
    m4.compose(p,q,s);im.setMatrixAt(k++,m4);obstacles.push({x,z,r:r*0.9});}
  im.count=k;scene.add(im);
  const cn=70,cm=new THREE.InstancedMesh(G.oct,mat(0x6ff0ff,{emissive:0x1aa0c8}),cn);
  for(let i=0;i<cn;i++){const a=rr(0,TAU),d=rr(8,100),x=Math.cos(a)*d,z=Math.sin(a)*d,g=groundAt(x,z);
    p.set(x,g>0?g+0.6:-50,z);e.set(rr(-.4,.4),rr(0,TAU),rr(-.4,.4));q.setFromEuler(e);const r=rr(.25,.5);s.set(r,r*2.6,r);m4.compose(p,q,s);cm.setMatrixAt(i,m4);}
  scene.add(cm);
}
// Checkpoint totems (glowing ice pillars). Touch one to set respawn point + heal.
const totemOff=bmat(0x58d8ff),totemOn=bmat(0xfff2a0),totems=[];
for(const [x,z] of [[0,10],[-52,24],[44,-38],[86,-94]]){
  const g=new THREE.Group(),y=groundAt(x,z);g.position.set(x,y,z);
  part(g,G.cyl,mat(0xbfe9ff),0,1.5,0,1.1,3,1.1);const top=part(g,G.oct,totemOff,0,3.7,0,0.6,0.9,0.6);
  scene.add(g);totems.push({x,z,y,top});obstacles.push({x,z,r:0.7});
}
totems[0].top.material=totemOn;
// Sky: three soft aurora ribbons (tiny shader), snowfall points that wrap around the player
const auroraMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:false,uniforms:{t:{value:0}},
  vertexShader:`uniform float t;varying vec2 vUv;void main(){vUv=uv;vec3 p=position;p.z+=sin(p.x*0.03+t*0.6)*18.0;p.y+=sin(p.x*0.05+t*0.4)*7.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
  fragmentShader:`uniform float t;varying vec2 vUv;void main(){vec3 a=vec3(0.25,1.0,0.6),b=vec3(0.65,0.4,1.0);vec3 c=mix(a,b,0.5+0.5*sin(vUv.x*9.0+t*0.5));
    float al=pow(sin(vUv.y*3.1416),1.5)*(0.35+0.25*sin(vUv.x*40.0+t*1.3))*sin(vUv.x*3.1416);gl_FragColor=vec4(c,al);}`});
const aurora=new THREE.Group();
for(let i=0;i<3;i++){const a=i*2.1+0.4,m=new THREE.Mesh(new THREE.PlaneGeometry(330,46,48,1),auroraMat);m.position.set(Math.sin(a)*150,62+i*9,Math.cos(a)*150);m.rotation.y=a;aurora.add(m);}
scene.add(aurora);
const SNOW=320,snowPos=new Float32Array(SNOW*3);
for(let i=0;i<SNOW*3;i++)snowPos[i]=Math.random()*60;
const snowGeo=new THREE.BufferGeometry();snowGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(SNOW*3),3));
const snow=new THREE.Points(snowGeo,new THREE.PointsMaterial({color:0xffffff,size:0.22,transparent:true,opacity:0.9,depthWrite:false}));
snow.frustumCulled=false;scene.add(snow);
function zoneAt(x,z,g){
  if(Math.hypot(x-BOSS_LAIR.x,z-BOSS_LAIR.z)<42)return 'Leviathan Deep';
  return g<-0.6?'Polar Sea':'Iceberg Fields';
}
function updateWorld(dt,t){
  const wp=waterGeo.attributes.position;
  for(let i=0;i<wp.count;i++)wp.setY(i,(Math.sin(wp.getX(i)*0.16+t*1.3)+Math.cos(wp.getZ(i)*0.14+t))*0.11);
  wp.needsUpdate=true;
  auroraMat.uniforms.t.value=t;aurora.position.set(player.pos.x,0,player.pos.z);
  const sp=snowGeo.attributes.position,px=player.pos.x,pz=player.pos.z;
  for(let i=0;i<SNOW;i++){const k=i*3;snowPos[k+1]-=dt*(3+(i%5));snowPos[k]+=dt*1.2;
    sp.setXYZ(i,px+((snowPos[k]-px)%60+60)%60-30,((snowPos[k+1]%30)+30)%30,pz+((snowPos[k+2]-pz)%60+60)%60-30);}
  sp.needsUpdate=true;
  for(const tm of totems)tm.top.rotation.y=t*1.5;
}

// ======================= [PLAYER] =======================
// Glacira: seal-penguin hybrid built from primitives, faces +Z.
const player={pos:new THREE.Vector3(0,0,4),vx:0,vz:0,kx:0,kz:0,yaw:Math.PI,hp:100,maxHp:100,en:100,maxEn:100,lvl:1,xp:0,
  swim:false,iframes:0,dead:false,deadT:0,checkpoint:0,dashT:0,dvx:0,dvz:0,atkAnim:0,combo:0,lastAtk:-9,target:null,walk:0};
const pm=new THREE.Group(),pbody=new THREE.Group();pm.add(pbody);scene.add(pm);
const M={navy:mat(0x2b4f8a),white:mat(0xf4fbff),orange:mat(0xffa23a),dark:mat(0x10203a),ice:mat(0x7ff3ff,{emissive:0x1c8fb0})};
part(pbody,G.sph,M.navy,0,0.85,0,0.72,0.78,1.1);
part(pbody,G.sph,M.white,0,0.72,0.16,0.58,0.62,0.92);
part(pbody,G.sph,M.navy,0,1.38,0.72,0.47);
part(pbody,G.sph,M.white,0,1.3,0.86,0.36,0.34,0.36);
part(pbody,G.cone,M.orange,0,1.3,1.28,0.3,0.45,0.3).rotation.x=Math.PI/2;
part(pbody,G.sph,M.dark,0.24,1.5,1.02,0.07);part(pbody,G.sph,M.dark,-0.24,1.5,1.02,0.07);
part(pbody,G.cone,M.ice,0,1.95,0.6,0.3,0.6,0.3).rotation.x=-0.4;
part(pbody,G.cone,M.ice,0,1.5,-0.5,0.3,0.5,0.3).rotation.x=-0.9;
const flipL=part(pbody,G.sph,M.navy,0.78,0.85,0.1,0.13,0.5,0.32),flipR=part(pbody,G.sph,M.navy,-0.78,0.85,0.1,0.13,0.5,0.32);
const tail=part(pbody,G.cone,M.navy,0,0.6,-1.2,0.9,0.9,0.25);tail.rotation.x=-Math.PI/2;
const blob=part(scene,G.disc,bmat(0x0a2540,{transparent:true,opacity:0.28,depthWrite:false}),0,0,0,1.1);

let camYaw=0,camPitch=0.42;const camT=new THREE.Vector3(0,2,4),tmpV=new THREE.Vector3();
const input={jx:0,jy:0},keys={},held={};

function respawn(){const p=player,t=totems[p.checkpoint];p.dead=false;p.hp=p.maxHp;p.en=p.maxEn;p.pos.set(t.x,t.y,t.z+2.5);p.kx=p.kz=p.vx=p.vz=0;p.iframes=2;pm.visible=true;toast('Revived at totem');}
function updatePlayer(dt){
  const p=player;
  if(p.dead){p.deadT-=dt;if(p.deadT<=0)respawn();return;}
  let mx=input.jx+(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0),my=input.jy+(keys.KeyS||keys.ArrowDown?1:0)-(keys.KeyW||keys.ArrowUp?1:0);
  if(keys.KeyQ)camYaw+=dt*2;if(keys.KeyE)camYaw-=dt*2;
  const mag=Math.min(1,Math.hypot(mx,my));
  p.swim=groundAt(p.pos.x,p.pos.z)<-0.6;
  const speed=p.swim?7.5:9.5;let tvx=0,tvz=0;
  if(mag>0.1){
    // camera-relative move direction
    const fx_=-Math.sin(camYaw),fz=-Math.cos(camYaw),rx=Math.cos(camYaw),rz=-Math.sin(camYaw);
    let dx=fx_*-my+rx*mx,dz=fz*-my+rz*mx;const l=Math.hypot(dx,dz)||1;dx/=l;dz/=l;
    p.yaw=angLerp(p.yaw,Math.atan2(dx,dz),Math.min(1,dt*(p.swim?4.5:14)));   // swimming turns slower
    const ax=p.swim?Math.sin(p.yaw):dx,az=p.swim?Math.cos(p.yaw):dz;          // ...and moves along its heading
    tvx=ax*speed*mag;tvz=az*speed*mag;camYaw-=mx*dt*0.8;p.walk+=dt*mag;
  }
  if(p.dashT>0){p.dashT-=dt;p.vx=p.dvx;p.vz=p.dvz;}
  else{const k=Math.min(1,dt*(p.swim?5:12));p.vx=lerp(p.vx,tvx,k);p.vz=lerp(p.vz,tvz,k);}
  let nx=p.pos.x+(p.vx+p.kx)*dt,nz=p.pos.z+(p.vz+p.kz)*dt;const kd=Math.exp(-dt*9);p.kx*=kd;p.kz*=kd;
  for(const o of obstacles){const dx=nx-o.x,dz=nz-o.z,d=Math.hypot(dx,dz),m=o.r+0.7;if(d<m&&d>1e-4){nx=o.x+dx/d*m;nz=o.z+dz/d*m;}}
  const d=Math.hypot(nx,nz);if(d>BOUND){nx*=BOUND/d;nz*=BOUND/d;}
  p.pos.x=nx;p.pos.z=nz;
  const g=groundAt(nx,nz),ty=g<-0.6?-0.55+Math.sin(game.time*3)*0.08:g;
  p.pos.y=lerp(p.pos.y,ty,Math.min(1,dt*12));
  // stats
  p.en=Math.min(p.maxEn,p.en+dt*10);p.hp=Math.min(p.maxHp,p.hp+dt*1.2);p.iframes-=dt;p.atkAnim-=dt;
  for(const k in cds)cds[k]=Math.max(0,cds[k]-dt);
  for(const k in held)if(held[k])actions[k]();
  // checkpoints
  for(let i=0;i<totems.length;i++){const t=totems[i];if(i!==p.checkpoint&&Math.hypot(nx-t.x,nz-t.z)<3.5){
    totems[p.checkpoint].top.material=totemOff;p.checkpoint=i;t.top.material=totemOn;p.hp=p.maxHp;toast('Checkpoint!');fx.sfx('level');}}
  // zone toast
  const z=zoneAt(nx,nz,g);if(z!==game.zone){game.zone=z;toast(z);}
  // model animation: waddle on ice, bob + roll in water, lunge on attack
  const moving=Math.hypot(p.vx,p.vz)/speed,t=game.time;
  pm.position.copy(p.pos);pm.rotation.y=p.yaw;
  pbody.rotation.z=p.swim?Math.sin(t*2.2)*0.12:Math.sin(p.walk*13)*0.14*moving;
  pbody.rotation.x=(p.swim?0.25:0)+(p.atkAnim>0?0.5*Math.sin(p.atkAnim/0.2*Math.PI):0)+(p.dashT>0?0.6:0);
  pbody.position.z=p.atkAnim>0?0.7*Math.sin(p.atkAnim/0.2*Math.PI):0;
  const flap=p.swim?Math.sin(t*6)*0.6*(0.3+moving):Math.sin(p.walk*13)*0.4*moving;
  flipL.rotation.z=-0.3-flap;flipR.rotation.z=0.3+flap;tail.rotation.y=Math.sin(t*(p.swim?7:3))*0.3;
  pm.visible=p.iframes<=0||p.dashT>0||((t*20)|0)%2===0;
  blob.visible=!p.swim;blob.position.set(nx,g+0.06,nz);
}
function updateCamera(dt){
  const p=player.pos;camT.lerp(tmpV.set(p.x,p.y+1.7,p.z),Math.min(1,dt*8));
  const dist=11.5,cp=Math.cos(camPitch);
  const cx=camT.x+Math.sin(camYaw)*dist*cp,cz=camT.z+Math.cos(camYaw)*dist*cp;
  const cy=Math.max(camT.y+Math.sin(camPitch)*dist,groundAt(cx,cz)+1.2,1);
  const s=game.shake;game.shake=Math.max(0,s-dt*2.5);
  camera.position.set(cx+(Math.random()-.5)*s,cy+(Math.random()-.5)*s,cz+(Math.random()-.5)*s);camera.lookAt(camT);
}

// ======================= [INPUT] =======================
// Left half: floating joystick. Right half: drag to orbit camera. Buttons sit above the right zone.
{
  const stick=$('stick'),knob=stick.firstElementChild,zl=$('zoneL'),zr=$('zoneR');let jid=null,ox=0,oy=0,cid=null,lx=0,ly=0;
  const cap=(el,e)=>{try{el.setPointerCapture(e.pointerId)}catch(_){}};
  zl.addEventListener('pointerdown',e=>{if(jid!==null)return;jid=e.pointerId;ox=e.clientX;oy=e.clientY;cap(zl,e);
    stick.classList.add('act');stick.style.left=ox+'px';stick.style.top=oy+'px';});
  zl.addEventListener('pointermove',e=>{if(e.pointerId!==jid)return;let dx=(e.clientX-ox)/48,dy=(e.clientY-oy)/48;const l=Math.hypot(dx,dy);if(l>1){dx/=l;dy/=l;}
    input.jx=dx;input.jy=dy;knob.style.transform=`translate(${dx*40}px,${dy*40}px)`;});
  const jend=e=>{if(e.pointerId!==jid)return;jid=null;input.jx=input.jy=0;knob.style.transform='';stick.classList.remove('act');stick.style.left=stick.style.top='';};
  zl.addEventListener('pointerup',jend);zl.addEventListener('pointercancel',jend);
  zr.addEventListener('pointerdown',e=>{if(cid!==null)return;cid=e.pointerId;lx=e.clientX;ly=e.clientY;cap(zr,e);});
  zr.addEventListener('pointermove',e=>{if(e.pointerId!==cid)return;camYaw-=(e.clientX-lx)*0.007;camPitch=clamp(camPitch+(e.clientY-ly)*0.004,0.12,1.1);lx=e.clientX;ly=e.clientY;});
  const cend=e=>{if(e.pointerId===cid)cid=null;};zr.addEventListener('pointerup',cend);zr.addEventListener('pointercancel',cend);
  for(const [id,name] of [['bAtk','attack'],['bShard','shard'],['bDash','dash'],['bNova','nova']]){
    const b=$(id);b.addEventListener('pointerdown',e=>{e.preventDefault();cap(b,e);b.classList.add('down');if(name==='attack')held.attack=true;if(game.started&&!game.paused)actions[name]();});
    const up=()=>{b.classList.remove('down');if(name==='attack')held.attack=false;};
    b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);
  }
  const keyAct={KeyJ:'attack',KeyK:'shard',KeyL:'dash',Space:'nova'};
  addEventListener('keydown',e=>{keys[e.code]=true;const a=keyAct[e.code];if(a&&game.started&&!game.paused&&!e.repeat){e.preventDefault();if(a==='attack')held.attack=true;actions[a]();}
    if(e.code==='KeyP'||e.code==='Escape')setPaused(!game.paused);if(e.code==='Enter'&&!game.started)start();});
  addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='KeyJ')held.attack=false;});
  // Mobile Safari: kill scroll / pinch / double-tap zoom / long-press menu once playing
  const stop=e=>{if(game.started)e.preventDefault();};
  document.addEventListener('touchstart',stop,{passive:false});document.addEventListener('touchmove',stop,{passive:false});
  document.addEventListener('gesturestart',e=>e.preventDefault());document.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('dblclick',e=>e.preventDefault());
}
function setPaused(v){if(!game.started)return;game.paused=v;$('paused').classList.toggle('hidden',!v);}
function start(){if(game.started)return;game.started=true;$('title').classList.add('hidden');$('hud').classList.remove('hidden');for(const f of onStart)f();resize();}
for(const ev of ['pointerup','touchend','click'])$('play').addEventListener(ev,start);
$('pause').addEventListener('pointerdown',e=>{e.stopPropagation();setPaused(true);});
$('paused').addEventListener('pointerup',()=>setPaused(false));
document.addEventListener('visibilitychange',()=>{if(document.hidden)setPaused(true);});

// ======================= HUD + main loop =======================
const hudEl={hp:$('hp'),en:$('en'),xp:$('xp'),lvl:$('lvl'),tint:$('tint'),hurt:$('hurt')};
const abBtn={shard:$('bShard'),dash:$('bDash'),nova:$('bNova')};
let xpNeed=()=>50;
function updateHud(){
  const p=player;hudEl.hp.style.transform=`scaleX(${clamp(p.hp/p.maxHp,0,1)})`;hudEl.en.style.transform=`scaleX(${p.en/p.maxEn})`;
  hudEl.xp.style.transform=`scaleX(${clamp(p.xp/xpNeed(),0,1)})`;
  hudEl.tint.classList.toggle('on',p.swim&&game.started);
  for(const k in abBtn){abBtn[k].style.setProperty('--cd',(cds[k]/cdMax[k]).toFixed(3));abBtn[k].classList.toggle('low',p.en<cost[k]);}
}
let last=performance.now(),wt=0;
function frame(now){
  requestAnimationFrame(frame);
  let dt=Math.min(0.05,(now-last)/1000);last=now;wt+=dt;
  if(game.started&&!game.paused){
    if(game.hitstop>0){game.hitstop-=dt;}          // brief freeze on heavy hits
    else{game.time+=dt;updatePlayer(dt);for(const s of systems)s(dt);}
    updateHud();
  }else if(!game.started){camYaw+=dt*0.12;pm.position.copy(player.pos).setY(groundAt(player.pos.x,player.pos.z));pm.rotation.y=player.yaw;}
  if(!game.paused){updateWorld(dt,wt);updateCamera(dt);}
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);
