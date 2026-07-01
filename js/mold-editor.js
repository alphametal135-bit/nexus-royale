// mold-editor.js — custom asset/mold builder (trees, rocks, weapons, custom bodies)
import { Store } from './store.js';
import { Nav, notify } from './nav.js';
import { PART_TYPES, PART_LABELS, PART_COLORS, makePartGeometry } from './parts.js';
import { CharEditor } from './character-editor.js';
import { WorldEditor } from './world-editor.js';

const MoldEditor = (()=>{
  let scene, camera, renderer, raycaster, angle=0;
  let category = 'tree';
  let parts = []; // {type,pos:{x,y,z},scale,color,isHead}
  let selectedIdx = -1;
  let returnScreen = 'screen-menu';
  let advanceScreen = null;
  let meshes = [];

  function _mkColorSwatches(){
    const el = document.getElementById('pt-color');
    el.innerHTML='';
    PART_COLORS.forEach(c=>{
      const s = document.createElement('div');
      s.className = 'sw'; s.style.background = c;
      s.addEventListener('click', ()=>{
        if(selectedIdx<0) return;
        parts[selectedIdx].color = c;
        el.querySelectorAll('.sw').forEach(x=>x.classList.remove('on'));
        s.classList.add('on');
        _rebuild();
      });
      el.appendChild(s);
    });
  }

  function _rebuild(){
    meshes.forEach(m=>scene.remove(m));
    meshes = [];
    parts.forEach((p,i)=>{
      const geo = makePartGeometry(p.type);
      const mat = new THREE.MeshStandardMaterial({color:p.color, roughness:.8, flatShading:p.type==='icosahedron',
        emissive: i===selectedIdx ? 0x00d4ff : 0x000000, emissiveIntensity: i===selectedIdx?0.35:0});
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.pos.x,p.pos.y,p.pos.z);
      m.scale.set(p.scale,p.scale,p.scale);
      m.castShadow=true; m.receiveShadow=true;
      scene.add(m); meshes.push(m);
    });
    _renderPartList();
  }
  function _renderPartList(){
    const el = document.getElementById('mold-partlist');
    el.innerHTML='';
    if(parts.length===0){ el.innerHTML = '<div class="hint-box">أضف قطعة من الأزرار فوق للبدء</div>'; return; }
    parts.forEach((p,i)=>{
      const row = document.createElement('div');
      row.className = 'part-item'+(i===selectedIdx?' sel':'');
      row.innerHTML = `<span>${PART_LABELS[p.type]||p.type} ${i+1}</span>`;
      row.addEventListener('click', ()=>{ selectedIdx=i; _syncTransformUI(); _rebuild(); });
      const del = document.createElement('span');
      del.className='pi-x'; del.textContent='✕';
      del.addEventListener('click', (ev)=>{ ev.stopPropagation(); parts.splice(i,1); if(selectedIdx>=parts.length) selectedIdx=parts.length-1; _syncTransformUI(); _rebuild(); });
      row.appendChild(del);
      el.appendChild(row);
    });
  }
  function _syncTransformUI(){
    const wrap = document.getElementById('mold-transform');
    if(selectedIdx<0 || !parts[selectedIdx]){ wrap.style.opacity=.35; wrap.style.pointerEvents='none'; return; }
    wrap.style.opacity=1; wrap.style.pointerEvents='auto';
    const p = parts[selectedIdx];
    document.getElementById('pt-x').value=p.pos.x; document.getElementById('pt-y').value=p.pos.y; document.getElementById('pt-z').value=p.pos.z; document.getElementById('pt-s').value=p.scale;
    document.querySelectorAll('#pt-color .sw').forEach((s,i)=>s.classList.toggle('on', PART_COLORS[i]===p.color));
  }

  function _mkCatTabs(){
    document.querySelectorAll('.cat-tab').forEach(tab=>{
      tab.addEventListener('click', ()=>{
        document.querySelectorAll('.cat-tab').forEach(t=>t.classList.remove('on'));
        tab.classList.add('on');
        category = tab.dataset.cat;
        document.getElementById('mold-weapon-stats').classList.toggle('hidden', category!=='weapon');
      });
    });
  }
  function _mkFiremodePills(){
    const el = document.getElementById('grp-firemode');
    el.innerHTML='';
    [['semi','آلي فردي'],['auto','آلي رشاش']].forEach(([v,label],i)=>{
      const p = document.createElement('div');
      p.className='pill'+(i===0?' on':'');
      p.textContent=label;
      p.dataset.v=v;
      p.addEventListener('click', ()=>{ el.querySelectorAll('.pill').forEach(x=>x.classList.remove('on')); p.classList.add('on'); });
      el.appendChild(p);
    });
  }

  function init(){
    const cv = document.getElementById('mold-cv');
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0e16,5,16);
    camera = new THREE.PerspectiveCamera(48, cv.clientWidth/cv.clientHeight, 0.1, 100);
    renderer = new THREE.WebGLRenderer({canvas:cv, antialias:true, alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.shadowMap.enabled = true;
    raycaster = new THREE.Raycaster();
    function resize(){ renderer.setSize(cv.clientWidth, cv.clientHeight); camera.aspect=cv.clientWidth/cv.clientHeight; camera.updateProjectionMatrix(); }
    window.addEventListener('resize', resize); resize();

    scene.add(new THREE.HemisphereLight(0x8899aa,0x111122,0.7));
    const dl = new THREE.DirectionalLight(0xffffff,1.1); dl.position.set(2,4,3); dl.castShadow=true; scene.add(dl);
    const grid = new THREE.GridHelper(6,12,0x2a3a4a,0x1a2430); scene.add(grid);

    document.querySelectorAll('.part-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        parts.push({ type:btn.dataset.part, pos:{x:0,y:0.5,z:0}, scale:0.5, color: PART_COLORS[parts.length % PART_COLORS.length] });
        selectedIdx = parts.length-1;
        _syncTransformUI(); _rebuild();
      });
    });
    ['pt-x','pt-y','pt-z','pt-s'].forEach(id=>{
      document.getElementById(id).addEventListener('input', e=>{
        if(selectedIdx<0) return;
        const p = parts[selectedIdx];
        if(id==='pt-x') p.pos.x=+e.target.value;
        if(id==='pt-y') p.pos.y=+e.target.value;
        if(id==='pt-z') p.pos.z=+e.target.value;
        if(id==='pt-s') p.scale=+e.target.value;
        _rebuild();
      });
    });
    _mkColorSwatches();
    _mkCatTabs();
    _mkFiremodePills();
    ['w-dmg','w-range','w-cd','w-recoil'].forEach(id=>{
      document.getElementById(id).addEventListener('input', e=>{
        document.getElementById('wv-'+id.split('-')[1]).textContent = e.target.value;
      });
    });

    (function loop(){
      requestAnimationFrame(loop);
      angle += 0.004;
      camera.position.x = Math.sin(angle)*3.6; camera.position.z = Math.cos(angle)*3.6; camera.position.y=1.8;
      camera.lookAt(0,0.6,0);
      renderer.render(scene,camera);
    })();
  }

  function open(cat, retScreen, nextScreen){
    category = cat || 'tree';
    returnScreen = retScreen || 'screen-menu';
    advanceScreen = nextScreen || null;
    parts = []; selectedIdx = -1;
    document.getElementById('m-name').value = 'قالبي';
    document.querySelectorAll('.cat-tab').forEach(t=>t.classList.toggle('on', t.dataset.cat===category));
    document.getElementById('mold-weapon-stats').classList.toggle('hidden', category!=='weapon');
    document.getElementById('mold-save').textContent = advanceScreen ? '✅ حفظ ومتابعة ⬅️' : '💾 حفظ القالب';
    if(!scene) init();
    _syncTransformUI(); _rebuild();
  }

  async function save(){
    if(parts.length===0){ notify('⚠️ أضف قطعة واحدة على الأقل'); return; }
    const name = document.getElementById('m-name').value || 'قالب';
    const id = 'asset_'+Date.now();
    const assetData = { id, name, category, parts: parts.map(p=>({type:p.type,pos:p.pos,scale:p.scale,color:p.color,isHead:!!p.isHead})) };
    if(category==='weapon'){
      assetData.dmg = +document.getElementById('w-dmg').value;
      assetData.range = +document.getElementById('w-range').value;
      assetData.cooldown = +document.getElementById('w-cd').value;
      assetData.recoil = +document.getElementById('w-recoil').value;
      assetData.auto = document.querySelector('#grp-firemode .pill.on').dataset.v==='auto';
    }
    if(category==='character'){
      // returned directly to character editor as an embedded custom body — no isHead tagging UI, so tag topmost part as head automatically
      let topIdx=0, topY=-999;
      parts.forEach((p,i)=>{ if(p.pos.y>topY){topY=p.pos.y; topIdx=i;} });
      assetData.parts[topIdx].isHead = true;
      await Store.set('my-pending-custom-body', assetData.parts, false);
      if(CharEditor && CharEditor.applyPendingCustomBody) await CharEditor.applyPendingCustomBody();
    } else {
      await Store.set('asset:'+id, assetData, true);
      const idx = (await Store.get('asset-index', true)) || [];
      idx.push({id,name,category});
      await Store.set('asset-index', idx, true);
    }
    notify('✅ تم حفظ القالب: '+name);
    if(WorldEditor && WorldEditor.refreshAssetIndex) WorldEditor.refreshAssetIndex();
    const dest = advanceScreen || returnScreen;
    if(dest==='screen-world' && WorldEditor && WorldEditor.start) WorldEditor.start();
    Nav.show(dest);
  }

  document.getElementById('mold-back').addEventListener('click', ()=>Nav.show(returnScreen));
  document.getElementById('mold-save').addEventListener('click', save);
  document.getElementById('card-mold').addEventListener('click', ()=>{ Nav.show('screen-mold'); open('tree','screen-menu'); });

  return { open };
})();

export { MoldEditor };
