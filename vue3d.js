// 3D illustration of the forecast over the Mont-Blanc massif (Three.js), adapted from the Chaltén app.
// Loaded on demand by index.html. mount(el) builds the scene inside `el`; the returned show(f) sets the hour to display.
// Data: 3d/montblanc (scripts/build_3d.py) — Copernicus GLO-30 relief, Sentinel-2 cloudless 2023 image.
import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";

const TZ="Europe/Paris";
const SITE={lat:45.8326,lon:6.8652}; // Mont Blanc: sun position and shadow framing
const EXAG=1.0;      // Alpine relief needs no exaggeration
// Altitude bands (km): low cloud in the valleys, mid cloud above Mont Blanc, wind around the summits
const BANDS={low:[1.9,2.3],mid:[5.3,5.7],high:8.8,wind:[3.4,5.0],precipTop:6.5};
// Local wall-clock time in TZ (DST aware) → UTC milliseconds
function utcFromLocal(Y,M,D,h){
  const guess=Date.UTC(Y,M-1,D,h),p={};
  new Intl.DateTimeFormat("en-US",{timeZone:TZ,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})
    .formatToParts(new Date(guess)).forEach(x=>p[x.type]=+x.value);
  return guess-(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute)-guess);
}

// ---------- sun position (NOAA approximation) ----------
function sunPos(dateUTC,lat,lon){
  const rad=Math.PI/180,d=(dateUTC-Date.UTC(2000,0,1,12))/864e5;
  const g=(357.529+0.98560028*d)*rad,q=280.459+0.98564736*d,L=(q+1.915*Math.sin(g)+0.020*Math.sin(2*g))*rad,e=(23.439-0.00000036*d)*rad;
  const ra=Math.atan2(Math.cos(e)*Math.sin(L),Math.cos(L)),dec=Math.asin(Math.sin(e)*Math.sin(L));
  const gmst=(18.697374558+24.06570982441908*d)%24,H=(gmst*15+lon)*rad-ra;
  const alt=Math.asin(Math.sin(lat*rad)*Math.sin(dec)+Math.cos(lat*rad)*Math.cos(dec)*Math.cos(H));
  const az=Math.atan2(-Math.sin(H),Math.tan(dec)*Math.cos(lat*rad)-Math.sin(lat*rad)*Math.cos(H)); // from north, clockwise
  return {alt,az};
}
function noMip(t){t.generateMipmaps=false;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;return t}
// Cloud sheet: procedural noise in the fragment shader, no texture (sprite clouds showed coloured blotches on iPhones).
// Covered fraction of the sheet follows the forecast cloud cover; the noise drifts with the wind.
const CLOUD_VS=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const CLOUD_FS=`precision highp float;
uniform float uCov,uAlpha,uScale;uniform vec2 uOff;uniform vec3 uColor;varying vec2 vUv;
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  float n=clamp((fbm(vUv*uScale+uOff)-.5)*2.4+.5,0.,1.); // spread fbm so cover maps to area more linearly
  float thr=mix(.95,.05,uCov);                       // more cover → lower threshold → more of the sheet is cloud
  float a=smoothstep(thr-.06,thr+.14,n)*uAlpha*step(.02,uCov);
  a*=smoothstep(.5,.36,length(vUv-.5));                // soft round edge, no visible plane border
  gl_FragColor=vec4(uColor*(.82+.35*n),a);
}`;
function texDot(){const c=document.createElement("canvas");c.width=c.height=32;const x=c.getContext("2d"),g=x.createRadialGradient(16,16,0,16,16,16);
  g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(.5,"rgba(255,255,255,.6)");g.addColorStop(1,"rgba(255,255,255,0)");x.fillStyle=g;x.fillRect(0,0,32,32);return noMip(new THREE.CanvasTexture(c))}

export async function mount(el,{base="3d/montblanc/"}={}){
  const phone=matchMedia("(max-width:599px)").matches;
  // Diagnostic switches for device-specific rendering bugs, e.g. ?off=clouds,shadow
  const OFF=new Set((new URLSearchParams(location.search).get("off")||"").split(",").filter(Boolean));
  const [meta,buf,peaks]=await Promise.all([fetch(base+"relief.json").then(r=>r.json()),fetch(base+"relief.bin").then(r=>r.arrayBuffer()),fetch(base+"peaks.json").then(r=>r.json())]);
  const heights=new Uint16Array(buf);
  const SX=(meta.E-meta.W)*111.32*Math.cos((meta.N+meta.S)/2*Math.PI/180), SZ=(meta.N-meta.S)*111.32; // km
  const pos=(lat,lon,altM)=>new THREE.Vector3((lon-meta.W)/(meta.E-meta.W)*SX-SX/2,altM/1000*EXAG,(meta.N-lat)/(meta.N-meta.S)*SZ-SZ/2);
  const hAt=(x,z)=>{ // terrain height (km, exaggerated) at scene x/z, bilinear
    const u=(x+SX/2)/SX*(meta.w-1),v=(z+SZ/2)/SZ*(meta.h-1);
    const i=Math.max(0,Math.min(meta.w-2,Math.floor(u))),j=Math.max(0,Math.min(meta.h-2,Math.floor(v))),fu=u-i,fv=v-j,g=(a,b)=>heights[b*meta.w+a];
    return((g(i,j)*(1-fu)+g(i+1,j)*fu)*(1-fv)+(g(i,j+1)*(1-fu)+g(i+1,j+1)*fu)*fv)/1000*EXAG};

  // ---------- renderer, camera, controls ----------
  const renderer=new THREE.WebGLRenderer({antialias:!phone,powerPreference:"high-performance",precision:"highp"});
  renderer.setPixelRatio(Math.min(devicePixelRatio,phone?1.5:2));
  renderer.shadowMap.enabled=!OFF.has("shadow");renderer.shadowMap.type=phone?THREE.PCFShadowMap:THREE.PCFSoftShadowMap;
  renderer.toneMapping=OFF.has("tone")?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;renderer.outputColorSpace=THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x8fb8dd,0.01);
  const camera=new THREE.PerspectiveCamera(45,1,0.1,400);
  // Default view: from above the Aiguilles Rouges (north-west), across the Chamonix valley to Mont Blanc and the Aiguilles
  // Solved so that Aiguille Verte, Aiguille du Midi, Mont Blanc and Chamonix land like the classic view from the Brévent
  const target=phone?new THREE.Vector3(-2.8,3.07,1.21):new THREE.Vector3(-2.12,2.77,-1.44);
  if(phone)camera.position.set(-6.25,3.26,-12.49);else camera.position.set(-10.45,4.86,-10.81);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.target.copy(target);controls.enableDamping=true;controls.zoomSpeed=2.4;controls.rotateSpeed=0.8;
  controls.minDistance=2;controls.maxDistance=60;controls.maxPolarAngle=Math.PI*0.48;
  // Touch: one finger turns, two fingers zoom; the page does not scroll while the finger is on the 3D
  controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_ROTATE};
  renderer.domElement.style.touchAction="none";

  // ---------- terrain ----------
  // HD: dense mesh and 4096 px image on desktop; lighter on phones (and on GPUs limited to 2048 px textures)
  const hd=!phone&&renderer.capabilities.maxTextureSize>=4096;
  const geo=new THREE.PlaneGeometry(SX,SZ,hd?767:319,hd?535:222);geo.rotateX(-Math.PI/2);
  const P=geo.attributes.position;for(let k=0;k<P.count;k++)P.setY(k,hAt(P.getX(k),P.getZ(k)));
  geo.computeVertexNormals();
  const sat=await new THREE.TextureLoader().loadAsync(base+(hd?"sat-4k.jpg":"sat-2k.jpg"));
  sat.colorSpace=THREE.SRGBColorSpace;sat.anisotropy=Math.min(hd?16:8,renderer.capabilities.getMaxAnisotropy());
  const terrain=new THREE.Mesh(geo,OFF.has("light")?new THREE.MeshLambertMaterial({map:sat}):new THREE.MeshStandardMaterial({map:sat,roughness:0.92,metalness:0}));
  terrain.castShadow=terrain.receiveShadow=true;scene.add(terrain);
  const skirt=new THREE.Mesh(new THREE.BoxGeometry(SX,0.3,SZ),new THREE.MeshStandardMaterial({color:0x1a2229}));skirt.position.y=-0.16;scene.add(skirt);

  // ---------- lights ----------
  const sun=new THREE.DirectionalLight(0xffffff,3);sun.castShadow=true;
  sun.shadow.mapSize.set(phone?1024:hd?4096:2048,phone?1024:hd?4096:2048);Object.assign(sun.shadow.camera,{left:-24,right:24,top:24,bottom:-24,near:1,far:120});sun.shadow.bias=-0.0006;
  scene.add(sun,sun.target);
  const hemi=new THREE.HemisphereLight(0xbfd6ff,0x3a3024,0.6);scene.add(hemi);
  const sunRef=pos(SITE.lat,SITE.lon,3000); // shadows are framed around the massif

  // ---------- clouds ----------
  // Two stacked sheets per layer give some thickness. Low sits below the summits (sea of clouds); mid sits above the default camera so it reads as a ceiling.
  const sheet=(y,scale,alpha,seed)=>{const m=new THREE.ShaderMaterial({vertexShader:CLOUD_VS,fragmentShader:CLOUD_FS,transparent:true,depthWrite:false,side:THREE.DoubleSide,
      uniforms:{uCov:{value:0},uAlpha:{value:alpha},uScale:{value:scale},uOff:{value:new THREE.Vector2(seed,seed*1.7)},uColor:{value:new THREE.Color(1,1,1)}}});
    const g=new THREE.PlaneGeometry(SX*1.7,SZ*1.7);g.rotateX(-Math.PI/2);const me=new THREE.Mesh(g,m);me.position.y=y;me.renderOrder=2;
    if(!OFF.has("clouds"))scene.add(me);return m};
  const LOW=[sheet(BANDS.low[0],7,0.8,3.1),sheet(BANDS.low[1],7,0.6,7.4)],MID=[sheet(BANDS.mid[0],5,0.75,11.2),sheet(BANDS.mid[1],5,0.55,19.8)],HIGH=[sheet(BANDS.high,3,0.4,23.5)];
  const cov={low:0,mid:0,high:0}; // eased toward the forecast so hour changes fade

  // ---------- wind streaks ----------
  // Wind: camera-facing ribbons (WebGL ignores line width), bright head fading to a transparent tail
  const NW=phone?320:500,wpos=new Float32Array(NW*12),wcol=new Float32Array(NW*16),wseed=new Float32Array(NW*4),widx=[];
  for(let k=0;k<NW;k++){wseed[k*4]=(Math.random()-.5)*SX;wseed[k*4+1]=BANDS.wind[0]+Math.random()*(BANDS.wind[1]-BANDS.wind[0]);wseed[k*4+2]=(Math.random()-.5)*SZ;wseed[k*4+3]=Math.random();
    const b=k*4;widx.push(b,b+1,b+2,b+1,b+3,b+2);
    wcol.set([1,1,1,1, 1,1,1,1, 0.6,0.8,1,0, 0.6,0.8,1,0],k*16)}
  const wgeo=new THREE.BufferGeometry();wgeo.setAttribute("position",new THREE.BufferAttribute(wpos,3));wgeo.setAttribute("color",new THREE.BufferAttribute(wcol,4));wgeo.setIndex(widx);
  const wmat=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,fog:false,toneMapped:false});
  const wmesh=new THREE.Mesh(wgeo,wmat);wmesh.frustumCulled=false;if(!OFF.has("wind"))scene.add(wmesh);
  const wdir=new THREE.Vector3(),wview=new THREE.Vector3(),wperp=new THREE.Vector3();

  // ---------- precipitation ----------
  const NP=phone?2500:4000,ppos=new Float32Array(NP*3),pcol=new Float32Array(NP*3);
  for(let k=0;k<NP;k++){ppos[k*3]=(Math.random()-.5)*SX;ppos[k*3+1]=Math.random()*BANDS.precipTop;ppos[k*3+2]=(Math.random()-.5)*SZ}
  const pgeo=new THREE.BufferGeometry();pgeo.setAttribute("position",new THREE.BufferAttribute(ppos,3));pgeo.setAttribute("color",new THREE.BufferAttribute(pcol,3));
  const pmat=new THREE.PointsMaterial({size:0.05,map:texDot(),vertexColors:true,transparent:true,opacity:0,depthWrite:false,alphaTest:0.01});if(!OFF.has("precip"))scene.add(new THREE.Points(pgeo,pmat));

  // ---------- labels ----------
  const lbox=document.createElement("div");lbox.className="v3-labels";el.appendChild(lbox);
  // Label anchors sit on the relief (the 30 m relief rounds the finest spires a little below their published height)
  const LBLS=peaks.map(p=>({t:p.town?p.name:`${p.name} ${p.alt}`,p:pos(p.lat,p.lon,(p.dem||p.alt)),v:!!p.town}));
  LBLS.forEach(l=>{l.el=document.createElement("div");l.el.className="v3-lbl"+(l.v?" v":"");l.el.textContent=l.t;lbox.appendChild(l.el)});

  // ---------- state from the forecast hour ----------
  const W={dx:0,dz:0,speed:0},C={low:0,mid:0,high:0},R={rate:0,iso:3};
  const cSky=new THREE.Color(),cTmp=new THREE.Color();
  // f: {time:"YYYY-MM-DDTHH:00" (local), w700 (wind at the summit level), dir700, low, mid, high, precip, iso}
  function show(f){
    const to=((f.dir700??270)+180)*Math.PI/180;W.speed=f.w700??0;W.dx=Math.sin(to);W.dz=-Math.cos(to);
    C.low=(f.low??0)/100;C.mid=(f.mid??0)/100;C.high=(f.high??0)/100;R.rate=f.precip??0;R.iso=(f.iso??1500)/1000*EXAG;
    const [Y,M,D]=f.time.slice(0,10).split("-").map(Number),hr=+f.time.slice(11,13);
    const s=sunPos(utcFromLocal(Y,M,D,hr),SITE.lat,SITE.lon);
    const up=Math.sin(s.alt),dayK=THREE.MathUtils.smoothstep(up,-0.08,0.15),dusk=Math.max(0,1-Math.abs(up-0.05)/0.18);
    sun.position.set(sunRef.x+Math.sin(s.az)*Math.cos(s.alt)*60,sunRef.y+Math.max(0.02,up)*60,sunRef.z-Math.cos(s.az)*Math.cos(s.alt)*60);sun.target.position.copy(sunRef);
    const overcast=Math.max(C.low*0.9,C.mid*0.8,Math.min(1,R.rate));
    sun.intensity=3.2*dayK*(1-0.75*overcast);sun.color.setRGB(1,0.82+0.18*(1-dusk),0.62+0.38*(1-dusk));
    hemi.intensity=0.08+0.65*dayK;
    cSky.set(0x0b1320).lerp(cTmp.set(0xe7a36c),dusk*dayK).lerp(cTmp.set(0x8fb8dd),dayK*(1-dusk)).lerp(cTmp.set(0x8e969c),overcast*dayK*0.85);
    scene.background=cSky.clone();scene.fog.color.copy(cSky);scene.fog.density=OFF.has("fog")?0:0.004+0.018*Math.max(C.low*C.low,Math.min(1,R.rate*1.5));
    const tint=new THREE.Color(0x2a3440).lerp(new THREE.Color(0xffffff),0.25+0.75*dayK).lerp(new THREE.Color(0xffc9a0),dusk*0.6*dayK).lerp(new THREE.Color(0x9aa3aa),overcast*0.5);
    for(const m of [...LOW,...MID,...HIGH])m.uniforms.uColor.value.copy(tint);
    return {sunAlt:s.alt*180/Math.PI};
  }

  // ---------- render loop: runs only while the panel is on screen ----------
  let visible=true,raf=0;
  const resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()};
  new ResizeObserver(resize).observe(el);resize();
  const clock=new THREE.Clock(),v3=new THREE.Vector3();
  function tick(){
    raf=0;if(!visible)return;
    const dt=Math.min(0.05,clock.getDelta()),drift=W.speed/60;
    const ease=Math.min(1,dt*2.5);cov.low+=(C.low-cov.low)*ease;cov.mid+=(C.mid-cov.mid)*ease;cov.high+=(C.high-cov.high)*ease;
    for(const [ms,c,k] of [[LOW,cov.low,1],[MID,cov.mid,1],[HIGH,cov.high*0.7,1.6]])for(const m of ms){
      m.uniforms.uCov.value=c;const sc=m.uniforms.uScale.value/(SX*1.7); // noise units per km
      m.uniforms.uOff.value.x-=W.dx*drift*dt*k*sc;m.uniforms.uOff.value.y+=W.dz*drift*dt*k*sc} // uv.y points north, scene +z south
    // more, longer and brighter streaks as the wind rises; always clearly visible from ~10 km/h
    const len=0.5+W.speed/30,active=W.speed<5?0:Math.round(NW*Math.min(1,0.15+W.speed/70));wmat.opacity=Math.min(0.95,0.55+W.speed/120);
    wdir.set(W.dx,0,W.dz);
    for(let k=0;k<NW;k++){let x=wseed[k*4],z=wseed[k*4+2];const y=wseed[k*4+1],sp=0.7+wseed[k*4+3];
      x+=W.dx*drift*3*dt*sp;z+=W.dz*drift*3*dt*sp;if(x>SX/2)x-=SX;if(x<-SX/2)x+=SX;if(z>SZ/2)z-=SZ;if(z<-SZ/2)z+=SZ;
      wseed[k*4]=x;wseed[k*4+2]=z;
      if(k>=active){wpos.fill(0,k*12,k*12+12);continue}
      const yy=Math.max(y,hAt(x,z)+0.2);
      if(Math.hypot(x-camera.position.x,yy-camera.position.y,z-camera.position.z)<3){wpos.fill(0,k*12,k*12+12);continue}
      // width grows with distance so streaks keep a few pixels on screen
      wview.set(x-camera.position.x,yy-camera.position.y,z-camera.position.z);const dist=wview.length();
      wperp.crossVectors(wdir,wview);if(wperp.lengthSq()<1e-6){wpos.fill(0,k*12,k*12+12);continue}
      wperp.normalize().multiplyScalar(Math.min(0.045,0.0028*dist*(phone?1.3:1)));
      const tx=x-W.dx*len,tz=z-W.dz*len;
      wpos.set([x+wperp.x,yy+wperp.y,z+wperp.z, x-wperp.x,yy-wperp.y,z-wperp.z, tx+wperp.x,yy+wperp.y,tz+wperp.z, tx-wperp.x,yy-wperp.y,tz-wperp.z],k*12)}
    wgeo.attributes.position.needsUpdate=true;
    const rate=Math.min(1,R.rate/1.5);pmat.opacity=rate>0.01?0.85:0;
    if(rate>0.01){const n=Math.round(NP*Math.min(1,0.15+rate));
      for(let k=0;k<NP;k++){let x=ppos[k*3],y=ppos[k*3+1],z=ppos[k*3+2];const snow=y>R.iso;
        y-=(snow?0.9:4)*dt;x+=W.dx*drift*(snow?1.2:0.4)*dt;z+=W.dz*drift*(snow?1.2:0.4)*dt;
        if(k>=n||y<hAt(x,z)){x=(Math.random()-.5)*SX;z=(Math.random()-.5)*SZ;y=k<n?BANDS.precipTop+Math.random()*1.5:-9}
        ppos[k*3]=x;ppos[k*3+1]=y;ppos[k*3+2]=z;
        if(snow){pcol[k*3]=pcol[k*3+1]=pcol[k*3+2]=1}else{pcol[k*3]=0.55;pcol[k*3+1]=0.7;pcol[k*3+2]=0.95}}
      pgeo.attributes.position.needsUpdate=true;pgeo.attributes.color.needsUpdate=true}
    controls.update();renderer.render(scene,camera);
    const w=el.clientWidth,h=el.clientHeight;
    for(const l of LBLS){v3.copy(l.p).project(camera);const on=v3.z<1&&Math.abs(v3.x)<1.05&&Math.abs(v3.y)<1.05;
      l.el.style.display=on?"block":"none";if(on){l.el.style.left=(v3.x+1)/2*w+"px";l.el.style.top=(1-v3.y)/2*h+"px"}}
    raf=requestAnimationFrame(tick);
  }
  new IntersectionObserver(e=>{visible=e[0].isIntersecting;if(visible&&!raf){clock.getDelta();raf=requestAnimationFrame(tick)}}).observe(el);
  raf=requestAnimationFrame(tick);
  return {show,camera,controls}; // camera/controls exposed for tuning the default view
}
