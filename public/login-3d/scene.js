/* Real mesh geometry, physically based materials and lighting.
   The model origin is the midpoint of each bottle's longitudinal axis.
   +Z points out of the screen. Motion is strictly in the YZ plane about X.
   The bottle center X and its rotation Z remain locked: no sideways swinging.
   Three.js r160 is vendored locally; no network requests are made at runtime. */
(() => {
  'use strict';
  const host = document.getElementById('stage');
  const canvas = document.getElementById('scene');
  const fallback = document.getElementById('fallback');
  const loading = document.getElementById('loading');
  function showSceneFailure(error){
    loading.hidden=true;
    fallback.hidden=false;
    host.classList.remove('is-ready');
    console.warn('立体商品场景暂不可用：',error?.message || error);
  }
  let renderer;
  try {
    if (!window.THREE) throw new Error('Three.js is unavailable');
    renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true, powerPreference: 'high-performance'});
  } catch (error) {
    showSceneFailure(error);
    return;
  }
  try {
  const T = THREE;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.setClearColor(0xe5eee6, 0);

  const scene = new T.Scene();
  const water = window.createUnderwaterWorld(T, renderer, scene);
  const camera = new T.PerspectiveCamera(32, 1, .1, 80);
  camera.position.set(0, .2, 14);
  camera.lookAt(0, 0, 0);
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedQuery.matches;
  reducedQuery.addEventListener('change', event => { reduced = event.matches; });

  // A procedural photography studio, prefiltered into a real reflection map.
  // The white cards become highlights that wrap around the curved bottle walls.
  const studio = new T.Scene();
  studio.background = new T.Color('#52695b');
  function lightCard(w, h, color, energy, position) {
    const card = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({color, side: T.DoubleSide}));
    card.material.color.multiplyScalar(energy);
    card.position.set(...position);
    card.lookAt(0, 0, 0);
    studio.add(card);
  }
  lightCard(2.3, 10, '#ffffff', 4.6, [-4.5, 3, 5]);
  lightCard(.65, 9, '#f4fff9', 3.5, [5, 1, 3]);
  lightCard(9, 5, '#ffffff', 2.4, [0, 7, -3]);
  lightCard(6, 8, '#eef5e5', .8, [-2, 0, -7]);
  lightCard(4, 9, '#142b20', .3, [6, 0, -2]);
  const pmrem = new T.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, .035, .1, 30);
  scene.environment = environment.texture;
  pmrem.dispose();
  studio.traverse(object => { if (object.isMesh) {object.geometry.dispose(); object.material.dispose();} });

  scene.add(new T.HemisphereLight('#efffff', '#527a62', .62));
  const key = new T.DirectionalLight('#fbfff9', 3.3);
  key.position.set(-4, 7, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {left: -6, right: 6, top: 6, bottom: -6, near: .5, far: 24});
  key.shadow.bias = -.0006;
  key.shadow.normalBias = .02;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new T.DirectionalLight('#f4fff2', 3.0);
  rim.position.set(4, 3, -4); scene.add(rim);
  const fill = new T.DirectionalLight('#d7f5e5', .32);
  fill.position.set(-2, -1, 5); scene.add(fill);

  const floor = new T.Mesh(new T.PlaneGeometry(30, 30), new T.ShadowMaterial({color: '#648477', opacity: .035}));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.06; floor.receiveShadow = true; scene.add(floor);

  // Fine manufacturing grain: subtle roughness modulation, not a noisy texture.
  const microData=new Uint8Array(128*128*4);
  let microSeed=9241;
  for(let i=0;i<microData.length;i+=4){microSeed=(microSeed*1664525+1013904223)>>>0;
    const v=218+(microSeed>>>27);microData[i]=microData[i+1]=microData[i+2]=v;microData[i+3]=255;}
  const microSurface=new T.DataTexture(microData,128,128,T.RGBAFormat);
  microSurface.wrapS=microSurface.wrapT=T.RepeatWrapping;microSurface.repeat.set(7,11);
  microSurface.magFilter=T.LinearFilter;microSurface.needsUpdate=true;
  const material = (color, props = {}) => water.lightMaterial(new T.MeshPhysicalMaterial({
    color, roughness:.22, metalness:0, envMapIntensity:.88,
    clearcoat:.72, clearcoatRoughness:.12,roughnessMap:microSurface,...props
  }));

  function lathe(profile, mat, parent) {
    const mesh = new T.Mesh(new T.LatheGeometry(profile.map(p => new T.Vector2(...p)), 128), mat);
    mesh.castShadow = mat.transmission < .45;
    mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  function cylinder(radius, height, y, mat, parent, radiusBottom = radius) {
    const mesh = new T.Mesh(new T.CylinderGeometry(radius, radiusBottom, height, 80), mat);
    mesh.position.y = y; mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  function ring(radius, thickness, y, mat, parent) {
    const mesh = new T.Mesh(new T.TorusGeometry(radius, thickness, 12, 96), mat);
    mesh.rotation.x = Math.PI / 2; mesh.position.y = y; parent.add(mesh); return mesh;
  }

  // A simplified vector rendering of the shared smiling-cart mark stays sharp on the curved bottle.
  function drawCartMark(c, ink) {
    // Keep the wheel bottoms above the brand text's cap-height box; the previous 238px origin
    // put them roughly 22px into “海淘集市”.
    c.save(); c.translate(384, 190); c.fillStyle = ink; c.strokeStyle = ink;
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.lineWidth = 27; c.beginPath(); c.moveTo(-104, -76); c.lineTo(-67, -76); c.quadraticCurveTo(-45, -74, -37, -42); c.stroke();
    c.beginPath(); c.moveTo(-55, -35); c.quadraticCurveTo(-5, -17, 52, -31); c.lineTo(101, -44);
    c.quadraticCurveTo(113, -47, 108, -29); c.lineTo(77, 66); c.quadraticCurveTo(70, 88, 43, 91);
    c.lineTo(-36, 91); c.quadraticCurveTo(-63, 88, -71, 64); c.lineTo(-96, -11); c.quadraticCurveTo(-103, -34, -79, -37); c.closePath(); c.fill();
    c.beginPath(); c.arc(-43, 125, 17, 0, Math.PI * 2); c.arc(48, 125, 17, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.ellipse(-31, 18, 9, 15, 0, 0, Math.PI * 2); c.ellipse(29, 18, 9, 15, 0, 0, Math.PI * 2); c.fill();
    c.lineWidth = 10; c.beginPath(); c.arc(0, 29, 42, .25, Math.PI - .25); c.stroke();
    c.restore();
  }

  // Printing is wrapped onto a curved 3D cylinder, never a screen-facing image.
  function printTexture(ink, volumeOnly = false) {
    const image = document.createElement('canvas'); image.width = 768; image.height = 768;
    const c = image.getContext('2d');
    c.fillStyle = ink; c.strokeStyle = ink; c.textAlign = 'center';
    if (volumeOnly) {
      c.font = '500 58px Microsoft YaHei'; c.fillText('45毫升', 384, 490);
    } else {
      drawCartMark(c, ink);
      c.font = '600 66px Microsoft YaHei'; c.fillText('海淘集市', 384, 424);
      c.fillRect(191, 451, 386, 2);
      c.font = '30px Microsoft YaHei'; c.fillText('证据驱动 · 智能上新', 384, 492);
      c.font = '25px Microsoft YaHei'; c.fillText('资料可追溯 · 内容可审核', 384, 539);
    }
    const texture = new T.CanvasTexture(image);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }
  function addPrint(parent, texture, radius, y, height, angle = 1.85) {
    const geometry = new T.CylinderGeometry(radius, radius, height, 72, 1, true, -angle / 2, angle);
    const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({
      map: texture, transparent: true, roughness: .65, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1
    }));
    mesh.position.y = y; mesh.renderOrder = 4; parent.add(mesh);
  }

  function createBottle(isRight) {
    const group = new T.Group();
    group.name = isRight ? 'bottle-right' : 'bottle-left';
    const glass = material(isRight ? '#d4dfcb' : '#f1f2ee', {
      transmission: .97, thickness: .12, ior: 1.46, roughness: isRight ? .075 : .145,
      attenuationColor: new T.Color(isRight ? '#d1e1c8' : '#f0ecf3'), attenuationDistance: 4.2,
      clearcoat: 1, envMapIntensity: 1.05
    });
    const plastic = material(isRight ? '#bac8ad' : '#e5e5e4', {roughness: .26, transmission: .08});
    const satin = material(isRight ? '#d1dcc3' : '#edf0e7', {roughness: .32, transmission: .42, thickness: .025, clearcoat: .3});
    const metal = material(isRight ? '#879b77' : '#aeb5a4', {roughness: .26, metalness: .45});
    const inner = material(isRight ? '#dce6cb' : '#eff0ee', {roughness:.07,transmission:.86,thickness:.8,ior:1.335,clearcoat:.15,attenuationDistance:3.5});

    lathe([[0,-2.31],[.38,-2.31],[.55,-2.29],[.64,-2.23],[.68,-2.12],
      [.69,-1.99],[.69,.65],[.68,.82],[.63,.99],[.52,1.12],[.45,1.17],[.45,1.33],
      [.40,1.33],[.40,1.19],[.48,1.13],[.57,1.00],[.62,.80],[.63,.60],[.63,-1.95],
      [.60,-2.12],[.49,-2.20],[0,-2.20]], glass, group);
    // Visible liquid volume, a meniscus and a real dip tube behind the printed sleeve.
    cylinder(.526,2.57,-.57,inner,group);
    ring(.509,.013,.715,material('#edf7e9',{transmission:.78,roughness:.035,ior:1.335}),group);
    cylinder(.037,3.05,-.26,material('#e2e7df',{transmission:.35,roughness:.20}),group);
    cylinder(.081,.07,-1.77,plastic,group);
    cylinder(.55, .14, -1.95, plastic, group);
    cylinder(.56, .025, -2.04, metal, group);
    lathe([[0,-2.33],[.46,-2.33],[.61,-2.28],[.67,-2.17],[.675,-2.00],
      [.625,-2.00],[.59,-2.14],[0,-2.20]], material(isRight?'#d4dfc8':'#eeedf0',{transmission:.83,thickness:.28,roughness:.09,ior:1.48}), group);
    ring(.658, .012, -2.10, metal, group);

    const sleeve = new T.Mesh(new T.CylinderGeometry(.697, .697, 1.89, 96, 1, true), satin);
    sleeve.position.y = -.38; group.add(sleeve);
    addPrint(group, printTexture(isRight ? '#f6f9ec' : '#78866a'), .702, -.37, 1.6);
    addPrint(group, printTexture(isRight ? '#f4f8ed' : '#a2a7a2', true), .704, -1.68, .33, 1.25);

    cylinder(.447, .19, 1.23, plastic, group);
    ring(.454, .023, 1.29, metal, group);
    ring(.454, .013, 1.19, metal, group);
    ring(.43,.018,1.13,material('#708778',{roughness:.68,clearcoat:0}),group);
    for(let i=0;i<4;i++)ring(.448,.004,1.20+i*.021,plastic,group);
    // Tiny internal spring is revealed when the protective cap opens.
    const coils=[];
    for(let i=0;i<=128;i++){const a=i/128*Math.PI*10;coils.push(new T.Vector3(Math.cos(a)*.116,1.41+i/128*.24,Math.sin(a)*.116));}
    group.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(coils),128,.008,6,false),metal));
    cylinder(.24, .21, 1.49, plastic, group);
    cylinder(.105, .36, 1.75, material('#d9e0cb', {roughness:.25}), group);
    lathe([[0,1.70],[.25,1.70],[.29,1.75],[.29,2.02],[.25,2.08],[0,2.08]], plastic, group);
    const spout = new T.Mesh(new T.CylinderGeometry(.09, .115, .39, 40), plastic);
    spout.rotation.x = Math.PI / 2; spout.position.set(0,1.97,.37); group.add(spout);
    const nozzleHole = new T.Mesh(new T.CircleGeometry(.052, 32), material('#354638',{roughness:.85}));
    nozzleHole.position.set(0,1.97,.571); group.add(nozzleHole);

    // Separate lid with a real hinge pivot. Its interior remains visible when open.
    const capPivot = new T.Group(); capPivot.name='cap-hinge'; capPivot.position.set(0,1.25,-.605); group.add(capPivot);
    const capGroup = new T.Group(); capGroup.position.z = .605; capPivot.add(capGroup);
    const capMaterial = material(isRight ? '#cad7bd' : '#e1dfe7', {
      transmission: isRight ? .88 : .78, roughness: isRight ? .13 : .22,
      thickness: .11, ior: 1.45, clearcoat: 1, clearcoatRoughness: .17,
      attenuationColor: new T.Color(isRight ? '#b4c4a6' : '#e4dfeb'), attenuationDistance: 3.1
    });
    lathe([[.60,0],[.624,.025],[.63,.07],[.63,.78],[.61,.99],[.55,1.14],[.42,1.25],
      [.23,1.31],[0,1.33],[0,1.265],[.22,1.25],[.39,1.19],[.50,1.08],[.56,.93],
      [.573,.76],[.573,.07],[.573,0],[.60,0]], capMaterial, capGroup);
    ring(.605,.026,.045, material(isRight ? '#b6c5a7' : '#e2e2e0',{roughness:.3,transmission:.35}),capGroup);
    if (isRight) {
      const hinge = new T.Mesh(new T.CylinderGeometry(.068,.068,.18,32), metal);
      hinge.rotation.z = Math.PI/2; hinge.position.set(0,1.25,-.605); group.add(hinge);
    }
    // Closed assembly bounds are -2.33..2.58; center all parts about the origin.
    group.children.forEach(child => { child.position.y -= .125; });
    group.rotation.y = isRight ? -.15 : .14;
    const base = new T.Vector3(isRight ? 1.27 : -1.16, isRight ? -.02 : -.26, isRight ? .47 : -.22);
    group.position.copy(base);
    group.scale.setScalar(1.16);
    const rest = isRight ? .16 : -.16;
    group.rotation.x = rest;
    group.rotation.z = 0;
    scene.add(group);
    return {group, capPivot, base, rest, angle:rest, velocity:0, target:rest, depth:0, cap:0, near:false};
  }
  const left = createBottle(false);
  const right = createBottle(true);

  // Bubbles stay outside bottle silhouettes; vertical motion keeps them clear.
  const configs = [
    [-3.3,1.8,.3,.24,0,1],[-3.3,-1.5,.3,.18,0,-1],
    [3.3,1.8,.3,.22,0,1],[3.3,-1.5,.3,.26,0,-1],
    [-3.3,.15,.3,.15,0,1],[3.3,.1,.3,.18,0,-1]
  ];
  // Screen-relative accents frame the copy instead of clustering beside the products.
  const copyAnchors=[
    // Five large accents sit around the headline rather than over the products.
    {desktop:[.085,.25],pixels:78,large:true},
    {desktop:[.36,.15],pixels:68,large:true},
    {desktop:[.06,.66],pixels:64,large:true},
    {desktop:[.23,.85],pixels:84,large:true},
    {desktop:[.45,.80],pixels:72,large:true},
    ...Array.from({length:26},(_,i)=>({
      desktop:[.025+((i*7)%23)/23*.46,.12+((i*11)%29)/29*.79],
      pixels:7+(i%5)*2.5
    }))
  ];
  const bubbleSizeScale=1;
  const productBubbleCount=configs.length;
  copyAnchors.forEach((a,i)=>configs.push([0,0,1.1,.25,i%2?.65:-.65,i%3?.50:-.50]));
  const bubbles = configs.map(([x,y,z,r,dx,dy],index) => {
    if(index<productBubbleCount)r*=bubbleSizeScale;
    const group = new T.Group();group.name='bubble-'+index;
    group.userData.copyAccent=index>=productBubbleCount;
    group.add(new T.Mesh(new T.SphereGeometry(r,40,28),water.bubbleMaterial(r)));
    const base = new T.Vector3(x,y,z);group.position.copy(base);scene.add(group);water.register(group);
    return {group, base, radius:r, axis:new T.Vector3(dx,dy,.12).normalize(),
      elapsed:-1, sign:1, armed:true, distance:10000};
  });
  const microBubbles=new T.Group();microBubbles.name='Distant ascending air bubbles';scene.add(microBubbles);water.register(microBubbles);
  for(let i=0;i<32;i++){
    const radius=.018+(i%7)*.009;
    const mesh=new T.Mesh(new T.SphereGeometry(radius,14,10),water.bubbleMaterial(radius));
    mesh.userData={phase:i*.143,x:-3.8+((i*1.67)%7.5),z:-2.8+(i%6)*.7};microBubbles.add(mesh);
  }

  let bounds, screenWidth=1, screenHeight=1;
  function resize() {
    bounds=host.getBoundingClientRect();screenWidth=Math.max(1,bounds.width);screenHeight=Math.max(1,bounds.height);
    // Keep the two-pass refraction affordable on high-DPI / large displays.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5,Math.sqrt(3200000/(screenWidth*screenHeight))));
    renderer.setSize(screenWidth,screenHeight,false);water.resize(screenWidth,screenHeight);
    const compact=screenWidth<=700;
    const region=compact
      ? {x:0,y:screenHeight*.43,w:screenWidth,h:screenHeight*.55}
      : {x:screenWidth*.43,y:screenHeight*.055,w:screenWidth*.57,h:screenHeight*.89};
    const pixelsPerUnit=Math.max(1,Math.min(region.w/6.9,region.h/6.5));
    const viewHeight=screenHeight/pixelsPerUnit;
    const centerX=(screenWidth*.5-(region.x+region.w*.5))/pixelsPerUnit;
    const centerY=((region.y+region.h*.5)-screenHeight*.5)/pixelsPerUnit;
    camera.aspect=screenWidth/screenHeight;
    camera.fov=T.MathUtils.radToDeg(2*Math.atan(viewHeight/(2*14)));
    camera.position.set(centerX,centerY,14);camera.lookAt(centerX,centerY,0);
    camera.updateProjectionMatrix();camera.updateMatrixWorld();
    copyAnchors.forEach((anchor,i)=>{
      const b=bubbles[productBubbleCount+i],uv=anchor.desktop;
      b.group.visible=!compact;
      const unitsPerPixel=viewHeight*(14-b.base.z)/14/screenHeight;
      b.base.x=centerX+(uv[0]-.5)*screenWidth*unitsPerPixel;
      b.base.y=centerY+(.5-uv[1])*screenHeight*unitsPerPixel;
      b.radius=anchor.pixels*bubbleSizeScale*(screenWidth/1440)*unitsPerPixel;
      b.group.children[0].scale.setScalar(b.radius/.25);
      b.group.children[0].material.uniforms.uRadius.value=b.radius;
      b.group.position.copy(b.base);b.elapsed=-1;b.armed=true;
    });
  }

  new ResizeObserver(resize).observe(host);
  window.addEventListener('resize',resize,{passive:true});
  window.addEventListener('scroll',()=>{bounds=host.getBoundingClientRect();},{passive:true});
  resize();

  const pointer={x:-9999,y:-9999,active:false};
  let manualLid=false, touchLid=false, modalActive=false;
  const lidAccess=document.getElementById('lidAccess');
  function setAccessState() {lidAccess.setAttribute('aria-pressed',String(manualLid || touchLid || right.near));}
  window.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    pointer.x=event.clientX;pointer.y=event.clientY;pointer.active=true;
  },{passive:true});
  function leave(){pointer.active=false;right.near=false;setAccessState();}
  document.documentElement.addEventListener('pointerleave',leave);
  window.addEventListener('blur',leave);
  window.addEventListener('pointerout',e=>{if(!e.relatedTarget)leave();});
  window.addEventListener('scene-modal',event=>{
    modalActive=event.detail;pointer.active=false;right.near=false;touchLid=false;manualLid=false;setAccessState();
  });
  host.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch')return;
    pointer.x=event.clientX;pointer.y=event.clientY;pointer.active=true;
    // Touch toggles only the right product; movement and bubble impulses use the same coordinates.
    if(distanceToBottle(right)<85){touchLid=!touchLid;setAccessState();}
  },{passive:true});
  host.addEventListener('pointerup',event=>{if(event.pointerType==='touch')pointer.active=false;},{passive:true});
  host.addEventListener('pointercancel',leave,{passive:true});
  lidAccess.addEventListener('click',()=>{manualLid=!(manualLid||touchLid);touchLid=false;setAccessState();});
  lidAccess.addEventListener('blur',()=>{manualLid=false;setAccessState();});
  window.addEventListener('scene-reset',()=>{
    leave();manualLid=false;touchLid=false;
    [left,right].forEach(b=>{b.angle=b.rest;b.velocity=0;b.group.rotation.x=b.rest;b.group.rotation.z=0;b.depth=0;b.group.position.copy(b.base);b.cap=0;b.capPivot.rotation.x=0;});
    bubbles.forEach(b=>{b.elapsed=-1;b.armed=true;b.group.position.copy(b.base);});setAccessState();
  });

  const projected=new T.Vector3();
  function screenPoint(world){projected.copy(world).project(camera);return{x:bounds.left+(projected.x+1)*.5*screenWidth,y:bounds.top+(1-projected.y)*.5*screenHeight};}
  function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y;const q=T.MathUtils.clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(p.x-a.x-q*dx,p.y-a.y-q*dy);}
  function distanceToBottle(bottle){
    // A stable rest-pose capsule prevents proximity flicker while the bottle repels the cursor.
    const axis=new T.Vector3(0,Math.cos(bottle.rest),Math.sin(bottle.rest));
    const a=screenPoint(bottle.base.clone().addScaledVector(axis,-1.95*bottle.group.scale.y));
    const b=screenPoint(bottle.base.clone().addScaledVector(axis,2.14*bottle.group.scale.y));
    return segmentDistance(pointer,a,b);
  }
  const maxAngle=Math.PI/3;
  function updateBottle(b,attract,dt,time){
    const p=screenPoint(b.base);
    const influence=pointer.active&&!modalActive?1-T.MathUtils.smoothstep(distanceToBottle(b),8,255):0;
    // A 2D mouse supplies proximity; depth response supplies the missing Z coordinate.
    // Attract -> toward the viewer (+Z), repel -> into the water (-Z).
    const vertical=T.MathUtils.clamp((p.y-pointer.y)/230,-1,1);
    const pitch=(.86+.14*vertical)*influence*(attract?1:-1);
    b.target=T.MathUtils.clamp(b.rest+pitch,-maxAngle,maxAngle);
    if(reduced){b.angle=b.target;b.velocity=0;}else{
      b.velocity+=(48*(b.target-b.angle)-13*b.velocity)*dt;b.angle+=b.velocity*dt;
      if(Math.abs(b.angle)>maxAngle){b.angle=T.MathUtils.clamp(b.angle,-maxAngle,maxAngle);b.velocity=0;}
    }
    const targetDepth=(attract?.38:-.38)*influence;
    b.depth+=(targetDepth-b.depth)*(reduced?1:1-Math.exp(-5.5*dt));
    // Never use rotateZ for the bottle. Never translate its center along X.
    b.group.rotation.x=b.angle;b.group.rotation.z=0;
    b.group.position.x=b.base.x;b.group.position.z=b.base.z+b.depth;
    b.group.position.y=b.base.y+(reduced?0:Math.sin(time*.45+(attract?0:1.9))*.022);
  }
  function updateBubbles(dt){
    bubbles.forEach(b=>{
      const origin=screenPoint(b.base);b.distance=Math.hypot(pointer.x-origin.x,pointer.y-origin.y);
      const zone=65+b.radius*62;
      const near=pointer.active&&!modalActive&&b.distance<zone;
      if(!near&&b.elapsed<0)b.armed=true;
      if(near&&b.armed&&b.elapsed<0){
        const railEnd=screenPoint(b.base.clone().add(b.axis));
        // Choose one of the two directions on the SAME fixed rail, away from the mouse.
        b.sign=((pointer.x-origin.x)*(railEnd.x-origin.x)+(pointer.y-origin.y)*(railEnd.y-origin.y))>0?-1:1;
        b.elapsed=0;b.armed=false;
      }
      if(b.elapsed>=0){
        b.elapsed+=dt;
        const duration=reduced?.32:1.95;
        const t=Math.min(1,b.elapsed/duration);
        let progress;
        if(t<.29)progress=1-Math.pow(1-t/.29,3);
        else if(t<.40)progress=1;
        else{const q=(t-.4)/.6;progress=1-q*q*(3-2*q);}
        const travel=progress*(reduced?.22:.78)*b.sign;
        const normal=new T.Vector3(-b.axis.y,b.axis.x,0);
        b.group.position.copy(b.base).addScaledVector(b.axis,travel).addScaledVector(normal,travel*travel*.24);
        if(t>=1){b.elapsed=-1;b.group.position.copy(b.base);}
      }
    });
  }

  // Project the full moving products (including the opening cap). Keep a clear
  // gutter around their combined bounds, even while bubbles react to the pointer.
  const productBounds=new T.Box3(),bubblePoint=new T.Vector3();
  function keepBubblesClear(){
    productBounds.makeEmpty().expandByObject(left.group).expandByObject(right.group);
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const x of [productBounds.min.x,productBounds.max.x])
      for(const y of [productBounds.min.y,productBounds.max.y])
        for(const z of [productBounds.min.z,productBounds.max.z]){
          const p=screenPoint(bubblePoint.set(x,y,z));
          minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);
          minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
        }
    bubbles.forEach(b=>{
      if(!b.group.visible)return;
      const p=screenPoint(b.group.position);
      const edge=screenPoint(bubblePoint.copy(b.group.position).add(new T.Vector3(b.radius*1.08,0,0)));
      const margin=Math.abs(edge.x-p.x)+12;
      if(p.y<minY-margin||p.y>maxY+margin||p.x<minX-margin||p.x>maxX+margin)return;
      const x=p.x<(minX+maxX)/2?minX-margin:maxX+margin;
      bubblePoint.copy(b.group.position).project(camera);
      bubblePoint.x=(x-bounds.left)/screenWidth*2-1;
      b.group.position.copy(bubblePoint.unproject(camera));
    });
  }

  let previous=performance.now(),time=0,waterTime=0,frameId=0,visible=true,lost=false;
  host.addEventListener('pointerdown',event=>{
    if(!reduced&&!modalActive)water.pulse((event.clientX-bounds.left)/screenWidth,1-(event.clientY-bounds.top)/screenHeight);
  },{passive:true});
  function frame(now){
    if(!visible||lost)return;
    const dt=Math.min((now-previous)/1000,.033);previous=now;time+=dt;
    updateBottle(left,false,dt,time);updateBottle(right,true,dt,time);updateBubbles(dt);
    const before=right.near;
    const radiusPx=screenWidth/camera.aspect/7.25*.63;
    const threshold=Math.min(70,radiusPx)+(right.near?93:56);
    right.near=pointer.active&&!modalActive&&distanceToBottle(right)<threshold;
    if(before!==right.near)setAccessState();
    const target=right.near||manualLid||touchLid?-1.91:0;
    right.cap+=(target-right.cap)*(reduced?1:1-Math.exp(-7*dt));
    if(Math.abs(right.cap-target)<.0002)right.cap=target;
    right.capPivot.rotation.x=right.cap;
    scene.updateMatrixWorld();
    if(!reduced)waterTime+=dt;
    water.update(waterTime);
    microBubbles.children.forEach((mesh,i)=>{
      const d=mesh.userData;
      mesh.position.set(d.x+Math.sin(waterTime*.23+i)*.045,-3.8+((waterTime*.014+d.phase)%1)*7.6,d.z);
      mesh.scale.set(1,1.035+Math.sin(waterTime*.6+i)*.025,1);
    });
    keepBubblesClear();
    bubbles.forEach((b,i)=>{const wobble=reduced?0:Math.sin(waterTime*.7+i)*.008;b.group.scale.set(1+wobble,1-wobble*.5,1);});
    try {
      water.render(camera);
      // Hide the loader only after an actual frame call completes, not via a CSS-ready class.
      loading.hidden=true;
      host.classList.add('is-ready');
    } catch(error){
      showSceneFailure(error);
      lost=true;
      return;
    }
    frameId=requestAnimationFrame(frame);
  }
  function resume(){if(visible&&!lost){cancelAnimationFrame(frameId);previous=performance.now();frameId=requestAnimationFrame(frame);}}
  document.addEventListener('visibilitychange',()=>{visible=!document.hidden;if(!visible)cancelAnimationFrame(frameId);else resume();});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;cancelAnimationFrame(frameId);showSceneFailure(new Error('图形上下文已丢失')); });
  canvas.addEventListener('webglcontextrestored',()=>{location.reload();});
  resume();
  } catch(error){showSceneFailure(error);}
})();
