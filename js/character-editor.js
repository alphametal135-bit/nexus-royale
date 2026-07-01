// character-editor.js — character creation screen
import { Store } from './store.js';
import { Nav, notify } from './nav.js';
import { CharOptions, defaultCharData, charStats, buildCharacterMesh } from './character-builder.js';
import { WorldEditor } from './world-editor.js';
import { MoldEditor } from './mold-editor.js';

const CharEditor = (()=>{
  let scene, camera, renderer, mesh, angle=0;
  let CH = defaultCharData();

  function _mkSwatches(containerId, colors, prop){
    const el = document.getElementById(containerId);
    el.innerHTML='';
    colors.forEach((c,i)=>{
      const s = document.createElement('div');
      s.className = 'sw'+(i===0?' on':'');
      s.style.background = c;
      s.addEventListener('click', ()=>{
        el.querySelectorAll('.sw').forEach(x=>x.classList.remove('on'));
        s.classList.add('on');
        CH[prop] = c;
        _rebuild();
      });
      el.appendChild(s);
    });
  }
  function _mkPills(containerId, values, prop, labels){
    const el = document.getElementById(containerId);
    el.innerHTML='';
    values.forEach((v,i)=>{
      const p = document.createElement('div');
      p.className = 'pill'+(i===0?' on':'');
      p.textContent = labels ? labels[i] : v;
      p.addEventListener('click', ()=>{
        el.querySelectorAll('.pill').forEach(x=>x.classList.remove('on'));
        p.classList.add('on');
        CH[prop] = v;
        _rebuild();
      });
      el.appendChild(p);
    });
  }
  function _rebuild(){
    if(mesh) scene.remove(mesh);
    mesh = buildCharacterMesh(CH);
    scene.add(mesh);
    const st = charStats(CH);
    document.getElementById('st-speed').style.width = st.speed+'%'; document.getElementById('stv-speed').textContent = st.speed;
    document.getElementById('st-armor').style.width = st.armor+'%'; document.getElementById('stv-armor').textContent = st.armor;
    document.getElementById('st-hp').style.width = Math.round(st.hp/150*100)+'%'; document.getElementById('stv-hp').textContent = st.hp;
  }

  function init(){
    const cv = document.getElementById('char-cv');
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0e16, 4, 12);
    camera = new THREE.PerspectiveCamera(45, cv.clientWidth/cv.clientHeight, 0.1, 100);
    camera.position.set(0,1.3,3.2);
    renderer = new THREE.WebGLRenderer({canvas:cv, antialias:true, alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.shadowMap.enabled = true;
    function resize(){ renderer.setSize(cv.clientWidth, cv.clientHeight); camera.aspect = cv.clientWidth/cv.clientHeight; camera.updateProjectionMatrix(); }
    window.addEventListener('resize', resize);

    scene.add(new THREE.HemisphereLight(0x8899aa,0x111122,0.7));
    const dl = new THREE.DirectionalLight(0xffffff,1.1); dl.position.set(2,4,3); dl.castShadow=true; scene.add(dl);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.1,0.1,32), new THREE.MeshStandardMaterial({color:0x14202e}));
    plat.position.y=-0.05; plat.receiveShadow=true; scene.add(plat);

    _mkSwatches('grp-skin', CharOptions.skin, 'skin');
    _mkPills('grp-hairstyle', CharOptions.hairstyle, 'hairstyle', ['قصير','طويل','موهوك','أصلع','ذيل حصان']);
    _mkSwatches('grp-hair', CharOptions.hair, 'hair');
    _mkPills('grp-outfit', CharOptions.outfit, 'outfit', ['استطلاع','ثقيل','خفي','طبي']);
    _mkSwatches('grp-outfitcolor', CharOptions.outfitColor, 'outfitColor');

    document.getElementById('c-name').addEventListener('input', e=>{ CH.name = e.target.value || 'لاعب'; });
    document.getElementById('s-height').addEventListener('input', e=>{ CH.height=+e.target.value; document.getElementById('v-height').textContent=e.target.value; _rebuild(); });
    document.getElementById('s-build').addEventListener('input', e=>{ CH.build=+e.target.value; document.getElementById('v-build').textContent=e.target.value; _rebuild(); });

    resize();
    _rebuild();
    (function loop(){
      requestAnimationFrame(loop);
      angle += 0.006;
      if(mesh){ camera.position.x = Math.sin(angle)*3.2; camera.position.z = Math.cos(angle)*3.2; camera.lookAt(0, (mesh.userData.eyeHeight||1.5)*0.75, 0); }
      renderer.render(scene, camera);
    })();
  }

  async function loadExisting(){
    const saved = await Store.get('my-active-character', false);
    if(saved){
      CH = Object.assign(defaultCharData(), saved);
      document.getElementById('c-name').value = CH.name;
      document.getElementById('s-height').value = CH.height; document.getElementById('v-height').textContent = CH.height;
      document.getElementById('s-build').value = CH.build; document.getElementById('v-build').textContent = CH.build;
      _applyCustomBodyUI();
      _rebuild();
    }
    const pending = await Store.get('my-pending-custom-body', false);
    if(pending){
      CH.customBody = pending;
      await Store.delete('my-pending-custom-body', false);
      _applyCustomBodyUI();
      _rebuild();
      notify('✅ تم تطبيق الشكل المخصص على الشخصية');
    }
  }
  function _applyCustomBodyUI(){
    document.getElementById('char-clear-body').classList.toggle('hidden', !(CH.customBody && CH.customBody.length));
  }

  async function save(){
    const id = CH.id || ('char_'+Date.now());
    CH.id = id;
    await Store.set('my-active-character', CH, false);
    await Store.set('char:'+id, CH, false);
    const idx = (await Store.get('char-index', false)) || [];
    if(!idx.find(x=>x.id===id)) idx.push({id, name:CH.name});
    else idx.find(x=>x.id===id).name = CH.name;
    await Store.set('char-index', idx, false);
    notify('✅ تم حفظ الشخصية: '+CH.name);
  }

  async function applyPendingCustomBody(){
    const pending = await Store.get('my-pending-custom-body', false);
    if(pending){
      CH.customBody = pending;
      await Store.delete('my-pending-custom-body', false);
      _applyCustomBodyUI();
      if(scene) _rebuild();
    }
    await save();
  }

  function getData(){ return CH; }
  function start(){ if(!scene) init(); else loadExisting(); }

  document.getElementById('char-back').addEventListener('click', ()=>Nav.show('screen-menu'));
  document.getElementById('char-save').addEventListener('click', save);
  document.getElementById('char-next-world').addEventListener('click', async ()=>{
    await save();
    Nav.show('screen-world');
    WorldEditor.start();
  });
  document.getElementById('char-custom-body').addEventListener('click', async ()=>{
    await Store.set('my-active-character', CH, false);
    Nav.show('screen-mold');
    MoldEditor.open('character', 'screen-char', 'screen-world');
  });
  document.getElementById('char-clear-body').addEventListener('click', ()=>{
    CH.customBody = null; _applyCustomBodyUI(); _rebuild(); notify('↩️ رجعت للشكل الافتراضي');
  });
  document.getElementById('card-char') && document.getElementById('card-char').addEventListener('click', ()=>{ Nav.show('screen-char'); start(); loadExisting(); });

  return { getData, start, applyPendingCustomBody };
})();

export { CharEditor };
