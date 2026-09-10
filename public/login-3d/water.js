/* Underwater look: a seamless caustic field and screen-space air-bubble refraction.
   The bubbles sample a fresh color pass of the actual scene (including bottles),
   rather than drawing an opaque green sphere or a CSS outline. */
window.createUnderwaterWorld = function (T, renderer, scene) {
  'use strict';
  const clock = {value:0};
  const resolution = {value:new T.Vector2(1,1)};
  const ripple = {value:[new T.Vector4(0,0,-100,0),new T.Vector4(0,0,-100,0),new T.Vector4(0,0,-100,0)]};
  let rippleIndex=0;
  const objects=[];
  const target=new T.WebGLRenderTarget(1,1,{minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:true});
  target.texture.name='Underwater scene refraction color';
  target.texture.colorSpace=T.LinearSRGBColorSpace;

  // Tileable caustics are baked once; animation uses a few texture samples, not
  // an expensive full-screen Voronoi search on every GPU frame.
  function causticTexture(){
    const size=512,cells=7,points=[];
    let seed=371;
    const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<cells*cells;i++)points.push([.18+random()*.64,.18+random()*.64]);
    const data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const px=x/size*cells,py=y/size*cells,bx=Math.floor(px),by=Math.floor(py);
      let first=100,second=100;
      for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
        const cellX=bx+i,cellY=by+j;
        const point=points[((cellY+cells)%cells)*cells+(cellX+cells)%cells];
        const d=Math.hypot(cellX+point[0]-px,cellY+point[1]-py);
        if(d<first){second=first;first=d;}else if(d<second)second=d;
      }
      const edge=second-first;
      const light=Math.exp(-Math.pow(edge*22,2))*.72+Math.exp(-Math.pow(edge*7,2))*.16;
      const k=(y*size+x)*4,v=Math.round(light*255);
      data[k]=data[k+1]=data[k+2]=v;data[k+3]=255;
    }
    const texture=new T.DataTexture(data,size,size,T.RGBAFormat);
    texture.wrapS=texture.wrapT=T.RepeatWrapping;
    texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearMipmapLinearFilter;
    texture.generateMipmaps=true;texture.needsUpdate=true;texture.name='Soft underwater light caustics';
    return texture;
  }
  const caustics={value:causticTexture()};
  const waterUniforms={uTime:clock,uResolution:resolution,uCaustics:caustics,uRipples:ripple};
  const backdropMaterial=new T.ShaderMaterial({
    name:'Submerged pearl-green background',depthWrite:false,depthTest:false,uniforms:waterUniforms,
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.9999,1.0);}',
    fragmentShader:`
      uniform float uTime;uniform vec2 uResolution;uniform sampler2D uCaustics;uniform vec4 uRipples[3];
      void main(){
        vec2 uv=gl_FragCoord.xy/uResolution;
        float aspect=uResolution.x/uResolution.y;
        vec2 p=uv*vec2(aspect,1.0);
        vec2 warp=vec2(sin(p.y*4.2+uTime*.13),cos(p.x*3.1-uTime*.09))*.026;
        vec2 q=p*.73+warp;
        float ca=texture2D(uCaustics,q+vec2(uTime*.005,-uTime*.003)).r;
        float cb=texture2D(uCaustics,q*1.31+vec2(-uTime*.003,uTime*.004)+.28).r;
        float textQuiet=mix(.32,1.0,smoothstep(.34,.70,uv.x));
        float topGlow=exp(-length((uv-vec2(.75,1.12))*vec2(1.2,.8))*2.3);
        vec3 color=mix(vec3(.13,.30,.205),vec3(.47,.66,.46),smoothstep(0.0,1.0,uv.y));
        color+=vec3(.065,.092,.060)*topGlow;
        // Pale reading zone on the left, deeper green behind the light products.
        float readingZone=1.0-smoothstep(.28,.68,uv.x);
        color=mix(color,vec3(.58,.74,.56),readingZone*.68);
        float depthShade=smoothstep(.48,1.0,uv.x)*(1.0-smoothstep(.1,.85,uv.y));
        color*=1.0-depthShade*.18;
        float shafts=pow(.5+.5*sin(p.x*6.7+p.y*2.3+sin(p.y*2.0+uTime*.045)),14.0);
        color+=vec3(.065,.10,.060)*shafts*smoothstep(.05,1.0,uv.y)*textQuiet;
        color+=(ca*.125+cb*.058)*textQuiet*vec3(.83,1.0,.9);
        // Only a soft travelling highlight, never a distracting full-screen ripple filter.
        for(int i=0;i<3;i++){
          float age=max(0.0,uTime-uRipples[i].z);
          float d=length((uv-uRipples[i].xy)*vec2(aspect,1.0));
          float ring=d-age*.12;
          float wave=sin(ring*95.0)*exp(-ring*ring*170.0)*exp(-age*1.3)*uRipples[i].w;
          color+=wave*.025;
        }
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const background=new T.Mesh(new T.PlaneGeometry(2,2),backdropMaterial);
  background.name='Underwater full-page caustics';background.frustumCulled=false;background.renderOrder=-100;
  scene.add(background);

  function bubbleMaterial(radius){
    return new T.ShaderMaterial({name:'Clear water-to-air refraction',transparent:true,depthWrite:false,depthTest:true,
      uniforms:{uScene:{value:target.texture},uResolution:resolution,uTime:clock,uRadius:{value:radius}},
      vertexShader:`
        varying vec3 vNormal;varying vec3 vView;
        void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
      fragmentShader:`
        uniform sampler2D uScene;uniform vec2 uResolution;uniform float uRadius;uniform float uTime;
        varying vec3 vNormal;varying vec3 vView;
        void main(){
          vec3 n=normalize(vNormal),v=normalize(vView);
          float facing=clamp(dot(n,v),0.0,1.0);
          float edge=pow(1.0-facing,3.4);
          vec2 uv=gl_FragCoord.xy/uResolution;
          // eta = water / air, not the optical ratio of a solid glass marble.
          vec3 transmitted=refract(-v,n,1.333);
          float critical=smoothstep(.62,.83,1.0-facing);
          vec2 offset=(transmitted.xy+v.xy)*(.006+edge*.011)*clamp(uRadius/.28,.14,1.5);
          offset=mix(offset,n.xy*.012,critical);
          offset.x*=uResolution.y/uResolution.x;
          vec3 behind=texture2D(uScene,clamp(uv+offset,vec2(.002),vec2(.998))).rgb;
          vec3 normalScene=texture2D(uScene,uv).rgb;
          // Keep the center almost perfectly transparent. Only the edge bends light strongly.
          vec3 color=mix(normalScene,behind,.30+.66*edge);
          vec3 lightA=normalize(vec3(-.65,.85,1.3));
          vec3 lightB=normalize(vec3(.85,-.48,.75));
          float glint=pow(max(dot(n,normalize(lightA+v)),0.0),125.0)*.69;
          glint+=pow(max(dot(n,normalize(lightB+v)),0.0),190.0)*.36;
          float upper=pow(max(dot(n,normalize(vec3(-.55,.86,.12))),0.0),10.0);
          color=mix(color,color*vec3(.56,.72,.62),edge*(.25+.23*max(-n.x,0.0)));
          color+=vec3(.86,1.0,.96)*(glint+upper*edge*.34+pow(edge,2.0)*.095);
          gl_FragColor=vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    });
  }

  function lightMaterial(mat){
    mat.onBeforeCompile=shader=>{
      shader.uniforms.uWaterTime=clock;shader.uniforms.uWaterCaustics=caustics;
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWaterWorld;');
      shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvWaterWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vWaterWorld;uniform float uWaterTime;uniform sampler2D uWaterCaustics;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        vec2 waterUV=vWaterWorld.xy*.14+vWaterWorld.z*.021;
        waterUV+=vec2(sin(vWaterWorld.y*.6+uWaterTime*.1),cos(vWaterWorld.x*.4-uWaterTime*.08))*.018;
        float waterLight=texture2D(uWaterCaustics,waterUV+vec2(uWaterTime*.005,-uWaterTime*.003)).r;
        outgoingLight+=waterLight*vec3(.075,.115,.08)*(.4+.6*max(normal.y,0.0));
        #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey=()=> 'underwater-material-1';
    return mat;
  }

  return {
    clock,background,target,bubbleMaterial,lightMaterial,
    register(object){objects.push(object);},
    resize(width,height){const dpr=renderer.getPixelRatio();const w=Math.max(1,Math.floor(width*dpr)),h=Math.max(1,Math.floor(height*dpr));target.setSize(w,h);resolution.value.set(w,h);},
    update(time){clock.value=time;},
    pulse(x,y){ripple.value[rippleIndex].set(x,y,clock.value,1);rippleIndex=(rippleIndex+1)%3;},
    render(camera){
      const visibility=objects.map(o=>o.visible);
      objects.forEach(o=>{o.visible=false;});
      renderer.setRenderTarget(target);renderer.render(scene,camera);
      objects.forEach((o,i)=>{o.visible=visibility[i];});
      renderer.setRenderTarget(null);renderer.render(scene,camera);
    }
  };
};
