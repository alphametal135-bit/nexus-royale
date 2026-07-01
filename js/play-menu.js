// play-menu.js — pre-match lobby (solo / bots / online)
import { Store } from './store.js';
import { Nav, notify } from './nav.js';
import { GameEngine } from './game-engine.js';

const PlayMenu = (()=>{
  let mode = 'solo';

  async function populate(){
    const charSel = document.getElementById('p-char');
    const worldSel = document.getElementById('p-world');
    charSel.innerHTML=''; worldSel.innerHTML='';
    const chars = (await Store.get('char-index', false)) || [];
    const worlds = (await Store.get('world-index', false)) || [];
    if(chars.length===0){ charSel.innerHTML = '<option value="">لا يوجد — اذهب لمحرر الشخصية أولًا</option>'; }
    else chars.forEach(c=>{ const o=document.createElement('option'); o.value=c.id; o.textContent=c.name; charSel.appendChild(o); });
    if(worlds.length===0){ worldSel.innerHTML = '<option value="">لا يوجد — اذهب لمحرر العالم أولًا</option>'; }
    else worlds.forEach(w=>{ const o=document.createElement('option'); o.value=w.code; o.textContent=w.name+' ('+w.code+')'; worldSel.appendChild(o); });
  }

  async function preselect(charId, worldCode){
    await populate();
    if(charId){
      const charSel = document.getElementById('p-char');
      if([...charSel.options].some(o=>o.value===charId)) charSel.value = charId;
    }
    if(worldCode){
      const worldSel = document.getElementById('p-world');
      if([...worldSel.options].some(o=>o.value===worldCode)) worldSel.value = worldCode;
    }
  }

  function init(){
    document.querySelectorAll('.mode-tab').forEach(t=>{
      t.addEventListener('click', ()=>{
        document.querySelectorAll('.mode-tab').forEach(x=>x.classList.remove('on'));
        t.classList.add('on');
        mode = t.dataset.mode;
        document.getElementById('bots-opts').classList.toggle('hidden', mode!=='bots');
        document.getElementById('online-opts').classList.toggle('hidden', mode!=='online');
      });
    });

    document.getElementById('play-back').addEventListener('click', ()=>Nav.show('screen-menu'));
    document.getElementById('card-play').addEventListener('click', ()=>{ Nav.show('screen-play'); populate(); });

    document.getElementById('play-start').addEventListener('click', async ()=>{
      const charId = document.getElementById('p-char').value;
      if(!charId){ notify('⚠️ لازم تصمم شخصية أولًا'); return; }
      const charData = await Store.get('char:'+charId, false);
      if(!charData){ notify('⚠️ الشخصية غير موجودة'); return; }

      if(mode==='online'){
        const codeInput = document.getElementById('p-roomcode').value.trim().toUpperCase();
        const worldCode = document.getElementById('p-world').value;
        if(!codeInput && !worldCode){ notify('⚠️ اختر خريطة لإنشاء الغرفة، أو أدخل كود غرفة صديقك'); return; }
        GameEngine.startOnline(charData, codeInput, worldCode);
        return;
      }

      const worldCode = document.getElementById('p-world').value;
      if(!worldCode){ notify('⚠️ لازم تصمم أو تختار خريطة أولًا'); return; }
      const worldData = await Store.get('world:'+worldCode, true);
      if(!worldData){ notify('⚠️ الخريطة غير موجودة'); return; }

      if(mode==='solo') GameEngine.startSolo(charData, worldData);
      else GameEngine.startBots(charData, worldData, +document.getElementById('p-botcount').value);
    });
  }
  return { init, preselect };
})();

export { PlayMenu };
