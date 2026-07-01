// nav.js — screen navigation + toast notifications

const Nav = {
  show(id){
    document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
  }
};

function notify(msg){
  const el = document.getElementById('notif');
  el.textContent = msg; el.style.display='block';
  clearTimeout(notify._t);
  notify._t = setTimeout(()=>{ el.style.display='none'; }, 2200);
}

export { Nav, notify };
