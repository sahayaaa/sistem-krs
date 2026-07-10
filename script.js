const STORAGE_KEY = 'susun-jadwal-app-data-v2';
const HARI_LIST = ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const CAL_START_HOUR = 7;
const CAL_END_HOUR = 20;
const SEMESTER_NUMS = ['1','2','3','4','5','6','7','8'];
const SEMESTER_FLEX = ['ganjil','genap'];
const SEMESTER_ALL_VALUES = [...SEMESTER_NUMS, ...SEMESTER_FLEX];

let state = {
  matkul: [], kelas: [], lulus: [],
  skenario: [], activeSkenarioId: null,
  riwayat: [],
  preferensi: { hindariHari: [], jamAwal: '07:00', jamAkhir: '20:00' },
  semesterAktif: '1', darkMode: false
};
let editingKelasId = null;

// Migrasi data lama: pastikan nilai semester valid (angka 1-8 atau ganjil/genap)
function migrateSemester(val){
  if(SEMESTER_ALL_VALUES.includes(String(val))) return String(val);
  return '1';
}
// semester aktif (konteks "kamu lagi di semester berapa") harus selalu angka
function migrateActiveSemester(val){
  if(SEMESTER_NUMS.includes(String(val))) return String(val);
  if(val==='ganjil') return '1';
  if(val==='genap') return '2';
  return '1';
}
function isSemesterOdd(numStr){ return parseInt(numStr,10) % 2 === 1; }
// matkul semester 'ganjil'/'genap' otomatis muncul di semester aktif manapun yang parity-nya cocok
function semesterMatchesActive(mSemester, activeSemester){
  if(mSemester === activeSemester) return true;
  if(mSemester === 'ganjil') return isSemesterOdd(activeSemester);
  if(mSemester === 'genap') return !isSemesterOdd(activeSemester);
  return false;
}
function semesterShortLabel(sem){
  if(sem==='ganjil') return 'Ganjil';
  if(sem==='genap') return 'Genap';
  return 'Semester '+sem;
}
function semesterOptionLabel(sem){
  if(sem==='ganjil') return 'Ganjil (fleksibel, semester ganjil manapun)';
  if(sem==='genap') return 'Genap (fleksibel, semester genap manapun)';
  return 'Semester '+sem;
}

function uid(){ return Math.random().toString(36).slice(2,9); }
function timeToMin(t){ const [h,m] = t.split(':').map(Number); return h*60+m; }
function overlap(aS,aE,bS,bE){ return aS < bE && bS < aE; }

function ensureSkenario(){
  if(state.skenario.length===0){
    const s = { id: uid(), nama: 'Skenario 1', jadwal: [] };
    state.skenario.push(s);
    state.activeSkenarioId = s.id;
  }
  if(!state.skenario.some(s=>s.id===state.activeSkenarioId)){
    state.activeSkenarioId = state.skenario[0].id;
  }
}
function getActiveSkenario(){ ensureSkenario(); return state.skenario.find(s=>s.id===state.activeSkenarioId); }

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed.jadwal && !parsed.skenario){
        parsed.skenario = [{ id: uid(), nama: 'Skenario 1', jadwal: parsed.jadwal }];
        parsed.activeSkenarioId = parsed.skenario[0].id;
        delete parsed.jadwal;
      }
      state = Object.assign(state, parsed);
      state.lulus = state.lulus || [];
      state.riwayat = state.riwayat || [];
      state.preferensi = Object.assign({ hindariHari: [], jamAwal: '07:00', jamAkhir: '20:00' }, state.preferensi||{});
      state.skenario = state.skenario || [];
      state.matkul.forEach(m=>{ m.semester = migrateSemester(m.semester); });
      state.semesterAktif = migrateActiveSemester(state.semesterAktif);
    }
  }catch(e){ console.error('Gagal memuat data', e); }
  ensureSkenario();
}
function saveState(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch(e){ console.error('Gagal menyimpan data', e); }
}

function passesPreferensi(k){
  const p = state.preferensi;
  if(p.hindariHari.includes(k.hari)) return false;
  if(timeToMin(k.jamMulai) < timeToMin(p.jamAwal)) return false;
  if(timeToMin(k.jamSelesai) > timeToMin(p.jamAkhir)) return false;
  return true;
}
function prasyaratTerpenuhi(m){ return (m.prasyarat||[]).every(pid=>state.lulus.includes(pid)); }

// ---------- TABS & THEME ----------
document.getElementById('tabs').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-tab]');
  if(!btn) return;
  document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('section.panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
});
function populateSemesterSelects(){
  const semSel = document.getElementById('semSelect');
  const mkSemSel = document.getElementById('mkSemester');
  const mkFilterSel = document.getElementById('mkFilterSem');
  semSel.innerHTML = ''; mkSemSel.innerHTML = '';
  const prevFilter = mkFilterSel.value;
  mkFilterSel.innerHTML = '<option value="semua">Semua</option>';
  SEMESTER_NUMS.forEach(s=>{
    semSel.appendChild(new Option('Semester '+s, s));
  });
  SEMESTER_ALL_VALUES.forEach(s=>{
    mkSemSel.appendChild(new Option(semesterOptionLabel(s), s));
    mkFilterSel.appendChild(new Option(semesterOptionLabel(s), s));
  });
  semSel.value = state.semesterAktif;
  if(['semua',...SEMESTER_ALL_VALUES].includes(prevFilter)) mkFilterSel.value = prevFilter;
}
document.getElementById('semSelect').addEventListener('change', e=>{
  state.semesterAktif = e.target.value;
  document.getElementById('susunSemLabel').textContent = state.semesterAktif;
  document.getElementById('susunSemParity').textContent = '(' + (isSemesterOdd(state.semesterAktif) ? 'ganjil' : 'genap') + ')';
  saveState(); renderAll();
});
document.getElementById('mkJenis').addEventListener('change', e=>{
  const mkSemSel = document.getElementById('mkSemester');
  // konsisten dengan konsep: matkul pilihan biasanya fleksibel (ganjil/genap), wajib biasanya semester spesifik
  mkSemSel.value = e.target.value === 'pilihan' ? (isSemesterOdd(state.semesterAktif) ? 'ganjil' : 'genap') : state.semesterAktif;
});
document.getElementById('btnDark').addEventListener('click', ()=>{
  state.darkMode = !state.darkMode;
  document.documentElement.setAttribute('data-theme', state.darkMode ? 'dark' : 'light');
  saveState();
});

// ---------- MATA KULIAH ----------
function renderPrasyaratBox(){
  const box = document.getElementById('mkPrasyaratBox');
  box.innerHTML = '';
  if(state.matkul.length===0){ box.innerHTML = '<span style="font-size:12px;color:var(--ink-soft);">Tambahkan matkul lain dulu untuk memilih prasyarat.</span>'; return; }
  state.matkul.forEach(m=>{
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${m.id}"> ${m.kode} — ${m.nama}`;
    box.appendChild(lbl);
  });
}

document.getElementById('btnAddMk').addEventListener('click', ()=>{
  const kode = document.getElementById('mkKode').value.trim();
  const nama = document.getElementById('mkNama').value.trim();
  const sks = parseInt(document.getElementById('mkSks').value,10);
  const jenis = document.getElementById('mkJenis').value;
  const semester = document.getElementById('mkSemester').value;
  const prasyarat = [...document.querySelectorAll('#mkPrasyaratBox input:checked')].map(i=>i.value);
  if(!kode || !nama || !sks){ alert('Isi kode, nama, dan SKS dulu ya.'); return; }
  state.matkul.push({ id: uid(), kode, nama, sks, jenis, semester, prasyarat });
  document.getElementById('mkKode').value = '';
  document.getElementById('mkNama').value = '';
  document.getElementById('mkSks').value = '';
  saveState(); renderAll();
});

function deleteMatkul(id){
  if(!confirm('Hapus matkul ini? Kelas yang terkait juga akan terhapus.')) return;
  state.matkul = state.matkul.filter(m=>m.id!==id);
  state.matkul.forEach(m=>{ m.prasyarat = (m.prasyarat||[]).filter(pid=>pid!==id); });
  state.kelas = state.kelas.filter(k=>k.matkulId!==id);
  state.lulus = state.lulus.filter(lid=>lid!==id);
  state.skenario.forEach(s=>{ s.jadwal = s.jadwal.filter(kid=> state.kelas.some(k=>k.id===kid)); });
  saveState(); renderAll();
}
function toggleLulus(id){
  if(state.lulus.includes(id)) state.lulus = state.lulus.filter(x=>x!==id);
  else state.lulus.push(id);
  saveState(); renderAll();
}

function renderMatkulTable(){
  const search = document.getElementById('mkSearch').value.toLowerCase();
  const fSem = document.getElementById('mkFilterSem').value;
  const fJenis = document.getElementById('mkFilterJenis').value;
  const tbody = document.querySelector('#mkTable tbody');
  tbody.innerHTML = '';
  const filtered = state.matkul.filter(m=>{
    if(fSem!=='semua' && m.semester!==fSem) return false;
    if(fJenis!=='semua' && m.jenis!==fJenis) return false;
    if(search && !(m.kode.toLowerCase().includes(search) || m.nama.toLowerCase().includes(search))) return false;
    return true;
  });
  document.getElementById('mkEmpty').style.display = state.matkul.length===0 ? 'block' : 'none';
  filtered.forEach(m=>{
    const prasyaratKode = (m.prasyarat||[]).map(pid=>{
      const pm = state.matkul.find(x=>x.id===pid); return pm ? pm.kode : null;
    }).filter(Boolean).join(', ') || '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="kode-cell">${m.kode}</td>
      <td>${m.nama}</td>
      <td>${m.sks}</td>
      <td><span class="tag ${m.jenis}">${m.jenis}</span></td>
      <td>${semesterShortLabel(m.semester)}</td>
      <td style="font-size:12px;">${prasyaratKode}</td>
      <td><input type="checkbox" data-lulus="${m.id}" ${state.lulus.includes(m.id)?'checked':''} style="width:auto;"></td>
      <td class="row-actions"><button class="btn ghost small" data-del="${m.id}">Hapus</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click',()=>deleteMatkul(b.dataset.del)) );
  tbody.querySelectorAll('[data-lulus]').forEach(cb=> cb.addEventListener('change',()=>toggleLulus(cb.dataset.lulus)) );
}
['mkSearch','mkFilterSem','mkFilterJenis'].forEach(id=> document.getElementById(id).addEventListener('input', renderMatkulTable) );

// ---------- KELAS ----------
function populateMatkulSelects(){
  const klSel = document.getElementById('klMatkul');
  const filterSel = document.getElementById('klFilterMatkul');
  const prevKl = klSel.value, prevFilter = filterSel.value;
  klSel.innerHTML = ''; filterSel.innerHTML = '<option value="semua">Semua matkul</option>';
  // matkul yang lagi diedit selalu ikut ditampilkan meski beda semester dari yang aktif,
  // supaya form edit nggak kehilangan pilihan matkulnya
  const editingKl = editingKelasId ? state.kelas.find(k=>k.id===editingKelasId) : null;
  const editingMatkulId = editingKl ? editingKl.matkulId : null;
  const scoped = state.matkul.filter(m=> semesterMatchesActive(m.semester, state.semesterAktif) || m.id===editingMatkulId);
  scoped.forEach(m=>{
    const label = `${m.kode} — ${m.nama}`;
    klSel.appendChild(new Option(label, m.id));
  });
  state.matkul.forEach(m=>{
    const label = `${m.kode} — ${m.nama}`;
    filterSel.appendChild(new Option(label, m.id));
  });
  if(scoped.some(m=>m.id===prevKl)) klSel.value = prevKl;
  else if(editingMatkulId) klSel.value = editingMatkulId;
  if(state.matkul.some(m=>m.id===prevFilter)) filterSel.value = prevFilter;
  if(scoped.length===0){
    klSel.appendChild(new Option('Tidak ada matkul di semester ini', ''));
  }
}

function getDosenNames(){
  return [...new Set(state.kelas.map(k=>k.dosen).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}
function renderDosenSuggestions(filterText){
  const box = document.getElementById('klDosenSuggest');
  const names = getDosenNames().filter(n=> n.toLowerCase().includes((filterText||'').toLowerCase()));
  box.innerHTML = '';
  if(names.length===0){ box.classList.remove('show'); return; }
  names.slice(0,8).forEach(n=>{
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.textContent = n;
    item.addEventListener('mousedown', e=>{
      e.preventDefault();
      document.getElementById('klDosen').value = n;
      box.classList.remove('show');
    });
    box.appendChild(item);
  });
  box.classList.add('show');
}
document.getElementById('klDosen').addEventListener('input', e=> renderDosenSuggestions(e.target.value) );
document.getElementById('klDosen').addEventListener('focus', e=> renderDosenSuggestions(e.target.value) );
document.getElementById('klDosen').addEventListener('blur', ()=>{
  setTimeout(()=> document.getElementById('klDosenSuggest').classList.remove('show'), 120);
});

function resetKelasForm(){
  editingKelasId = null;
  document.getElementById('klFormTitle').textContent = 'Tambah kelas (Jadwal Dosen)';
  document.getElementById('btnAddKl').textContent = '+ Tambah kelas';
  document.getElementById('btnCancelEditKl').style.display = 'none';
  document.getElementById('klDosen').value = '';
  document.getElementById('klRuang').value = '';
  document.getElementById('klHari').value = 'Senin';
  document.getElementById('klMulai').value = '08:00';
  document.getElementById('klSelesai').value = '09:40';
  populateMatkulSelects();
}
function startEditKelas(id){
  const k = state.kelas.find(x=>x.id===id);
  if(!k) return;
  editingKelasId = id;
  populateMatkulSelects();
  document.getElementById('klFormTitle').textContent = 'Edit kelas';
  document.getElementById('btnAddKl').textContent = 'Simpan perubahan';
  document.getElementById('btnCancelEditKl').style.display = 'inline-block';
  document.getElementById('klMatkul').value = k.matkulId;
  document.getElementById('klDosen').value = k.dosen;
  document.getElementById('klHari').value = k.hari;
  document.getElementById('klMulai').value = k.jamMulai;
  document.getElementById('klSelesai').value = k.jamSelesai;
  document.getElementById('klRuang').value = k.ruang || '';
  document.getElementById('panel-kelas').scrollIntoView({ behavior:'smooth', block:'start' });
}
document.getElementById('btnCancelEditKl').addEventListener('click', resetKelasForm);
document.getElementById('btnAddKl').addEventListener('click', ()=>{
  const matkulId = document.getElementById('klMatkul').value;
  const dosen = document.getElementById('klDosen').value.trim();
  const hari = document.getElementById('klHari').value;
  const jamMulai = document.getElementById('klMulai').value;
  const jamSelesai = document.getElementById('klSelesai').value;
  const ruang = document.getElementById('klRuang').value.trim();
  if(!matkulId){ alert('Tambahkan mata kuliah dulu di tab pertama.'); return; }
  if(!dosen || !jamMulai || !jamSelesai){ alert('Isi dosen dan jam dulu ya.'); return; }
  if(timeToMin(jamMulai) >= timeToMin(jamSelesai)){ alert('Jam selesai harus setelah jam mulai.'); return; }
  if(editingKelasId){
    const k = state.kelas.find(x=>x.id===editingKelasId);
    if(k){ Object.assign(k, { matkulId, dosen, hari, jamMulai, jamSelesai, ruang }); }
    resetKelasForm();
  } else {
    state.kelas.push({ id: uid(), matkulId, dosen, hari, jamMulai, jamSelesai, ruang });
    document.getElementById('klDosen').value = ''; document.getElementById('klRuang').value = '';
  }
  saveState(); renderAll();
});
function deleteKelas(id){
  if(!confirm('Hapus kelas ini?')) return;
  state.kelas = state.kelas.filter(k=>k.id!==id);
  state.skenario.forEach(s=>{ s.jadwal = s.jadwal.filter(kid=>kid!==id); });
  if(editingKelasId===id) resetKelasForm();
  saveState(); renderAll();
}
function renderKelasTable(){
  const fMatkul = document.getElementById('klFilterMatkul').value;
  const tbody = document.querySelector('#klTable tbody');
  tbody.innerHTML = '';
  const filtered = state.kelas.filter(k=> fMatkul==='semua' || k.matkulId===fMatkul);
  document.getElementById('klEmpty').style.display = state.kelas.length===0 ? 'block' : 'none';
  filtered.forEach(k=>{
    const m = state.matkul.find(x=>x.id===k.matkulId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="kode-cell">${m ? m.kode : '—'}</td>
      <td>${k.dosen}</td>
      <td>${k.hari}</td>
      <td style="font-family:'IBM Plex Mono',monospace;">${k.jamMulai}–${k.jamSelesai}</td>
      <td>${k.ruang || '—'}</td>
      <td class="row-actions"><button class="btn ghost small" data-edit="${k.id}">Edit</button><button class="btn ghost small" data-del="${k.id}">Hapus</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click',()=>deleteKelas(b.dataset.del)) );
  tbody.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click',()=>startEditKelas(b.dataset.edit)) );
}
document.getElementById('klFilterMatkul').addEventListener('change', renderKelasTable);

// ---------- SKENARIO ----------
function renderSkenarioSelect(){
  const sel = document.getElementById('skenarioSelect');
  sel.innerHTML = '';
  state.skenario.forEach(s=> sel.appendChild(new Option(s.nama, s.id)) );
  sel.value = state.activeSkenarioId;
}
document.getElementById('skenarioSelect').addEventListener('change', e=>{
  state.activeSkenarioId = e.target.value; saveState(); renderSusunViews();
});
document.getElementById('btnSkenarioNew').addEventListener('click', ()=>{
  const nama = prompt('Nama skenario baru:', 'Skenario '+(state.skenario.length+1));
  if(!nama) return;
  const s = { id: uid(), nama, jadwal: [] };
  state.skenario.push(s); state.activeSkenarioId = s.id;
  saveState(); renderSkenarioSelect(); renderSusunViews();
});
document.getElementById('btnSkenarioRename').addEventListener('click', ()=>{
  const active = getActiveSkenario();
  const nama = prompt('Nama baru untuk skenario ini:', active.nama);
  if(!nama) return;
  active.nama = nama; saveState(); renderSkenarioSelect();
});
document.getElementById('btnSkenarioDuplicate').addEventListener('click', ()=>{
  const active = getActiveSkenario();
  const s = { id: uid(), nama: active.nama+' (salinan)', jadwal: [...active.jadwal] };
  state.skenario.push(s); state.activeSkenarioId = s.id;
  saveState(); renderSkenarioSelect(); renderSusunViews();
});
document.getElementById('btnSkenarioDelete').addEventListener('click', ()=>{
  if(state.skenario.length<=1){ alert('Minimal harus ada satu skenario.'); return; }
  if(!confirm('Hapus skenario aktif?')) return;
  state.skenario = state.skenario.filter(s=>s.id!==state.activeSkenarioId);
  state.activeSkenarioId = state.skenario[0].id;
  saveState(); renderSkenarioSelect(); renderSusunViews();
});

// ---------- SUSUN JADWAL ----------
function showMsg(text, type){
  const el = document.getElementById('susunMsg');
  el.textContent = text; el.className = 'msg show ' + type;
  setTimeout(()=>{ el.className = 'msg'; }, 3200);
}
function findConflict(newKelas, excludeMatkulId, jadwalArr){
  for(const kid of jadwalArr){
    const k = state.kelas.find(x=>x.id===kid);
    if(!k || k.matkulId===excludeMatkulId) continue;
    if(k.hari === newKelas.hari && overlap(timeToMin(newKelas.jamMulai), timeToMin(newKelas.jamSelesai), timeToMin(k.jamMulai), timeToMin(k.jamSelesai))) return k;
  }
  return null;
}
function toggleKelasInJadwal(kelasId){
  const kelas = state.kelas.find(k=>k.id===kelasId);
  if(!kelas) return;
  const active = getActiveSkenario();
  const already = active.jadwal.includes(kelasId);
  if(already){ active.jadwal = active.jadwal.filter(id=>id!==kelasId); saveState(); renderSusunViews(); return; }
  const conflict = findConflict(kelas, kelas.matkulId, active.jadwal);
  if(conflict){
    const cm = state.matkul.find(m=>m.id===conflict.matkulId);
    showMsg(`Bentrok dengan ${cm ? cm.kode : 'kelas lain'} (${conflict.hari} ${conflict.jamMulai}–${conflict.jamSelesai}). Kelas tidak ditambahkan.`, 'warn');
    return;
  }
  const mk = state.matkul.find(m=>m.id===kelas.matkulId);
  if(mk && !prasyaratTerpenuhi(mk)){
    showMsg(`Perhatian: prasyarat ${mk.kode} belum ditandai lulus. Kelas tetap ditambahkan.`, 'warn');
  }
  active.jadwal = active.jadwal.filter(id=>{ const k = state.kelas.find(x=>x.id===id); return !(k && k.matkulId===kelas.matkulId); });
  active.jadwal.push(kelasId);
  saveState(); renderSusunViews();
}

function renderPrefBoxes(){
  const box = document.getElementById('prefHariBoxes');
  box.innerHTML = '';
  HARI_LIST.forEach(h=>{
    const pill = document.createElement('label');
    pill.className = 'checkbox-pill';
    pill.innerHTML = `<input type="checkbox" value="${h}" ${state.preferensi.hindariHari.includes(h)?'checked':''}> ${h}`;
    box.appendChild(pill);
  });
  box.querySelectorAll('input').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      if(cb.checked) state.preferensi.hindariHari.push(cb.value);
      else state.preferensi.hindariHari = state.preferensi.hindariHari.filter(x=>x!==cb.value);
      saveState(); renderMkList();
    });
  });
  document.getElementById('prefJamAwal').value = state.preferensi.jamAwal;
  document.getElementById('prefJamAkhir').value = state.preferensi.jamAkhir;
}
document.getElementById('prefJamAwal').addEventListener('change', e=>{ state.preferensi.jamAwal = e.target.value; saveState(); renderMkList(); });
document.getElementById('prefJamAkhir').addEventListener('change', e=>{ state.preferensi.jamAkhir = e.target.value; saveState(); renderMkList(); });

function renderMkList(){
  const search = document.getElementById('susunSearch').value.toLowerCase();
  const fJenis = document.getElementById('susunFilterJenis').value;
  const container = document.getElementById('mkList');
  const active = getActiveSkenario();
  container.innerHTML = '';
  const filtered = state.matkul.filter(m=>{
    if(!semesterMatchesActive(m.semester, state.semesterAktif)) return false;
    if(fJenis!=='semua' && m.jenis!==fJenis) return false;
    if(search && !(m.kode.toLowerCase().includes(search) || m.nama.toLowerCase().includes(search))) return false;
    return true;
  });
  if(filtered.length===0){
    container.innerHTML = `<div class="empty"><b>Tidak ada matkul</b>Sesuaikan filter atau tambah matkul semester ${state.semesterAktif} dulu.</div>`;
    return;
  }
  filtered.forEach(m=>{
    const kelasOptions = state.kelas.filter(k=>k.matkulId===m.id);
    const item = document.createElement('div');
    item.className = 'mk-item';
    const chips = kelasOptions.map(k=>{
      const selected = active.jadwal.includes(k.id);
      const violate = !passesPreferensi(k);
      return `<div class="chip ${selected?'selected':''} ${violate?'pref-violate':''}" data-kelas="${k.id}" title="${violate?'Di luar preferensi jadwal':''}">
        <b style="font-weight:600;">${k.hari.slice(0,3)} ${k.jamMulai}–${k.jamSelesai}</b>
        ${k.dosen}${k.ruang ? ' · '+k.ruang : ''}
      </div>`;
    }).join('') || `<span style="color:var(--ink-soft);font-size:12px;">Belum ada kelas untuk matkul ini.</span>`;
    const prereqWarn = !prasyaratTerpenuhi(m) ? `<span class="tag warn">prasyarat belum lulus</span>` : '';
    item.innerHTML = `
      <div class="mk-item-head">
        <div><span class="nm">${m.nama}</span> <span class="kd">${m.kode}</span></div>
        <div style="display:flex;gap:6px;"><span class="tag ${m.jenis}">${m.jenis}</span>${prereqWarn}</div>
      </div>
      <div class="chip-row">${chips}</div>
    `;
    container.appendChild(item);
  });
  container.querySelectorAll('.chip[data-kelas]').forEach(chip=> chip.addEventListener('click', ()=> toggleKelasInJadwal(chip.dataset.kelas) ) );
}
['susunSearch','susunFilterJenis'].forEach(id=> document.getElementById(id).addEventListener('input', renderMkList) );

document.getElementById('btnClearJadwal').addEventListener('click', ()=>{
  if(!confirm('Kosongkan jadwal skenario aktif?')) return;
  getActiveSkenario().jadwal = []; saveState(); renderSusunViews();
});

function el(tag,cls,text){ const d=document.createElement(tag); d.className=cls; d.textContent=text; return d; }
function renderCalendar(){
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  grid.appendChild(el('div','cal-head',''));
  HARI_LIST.forEach(h=> grid.appendChild(el('div','cal-head',h)) );
  const timeCol = document.createElement('div');
  for(let h=CAL_START_HOUR; h<CAL_END_HOUR; h++) timeCol.appendChild(el('div','cal-time', String(h).padStart(2,'0')+':00'));
  grid.appendChild(timeCol);
  const active = getActiveSkenario();
  const kelasByJadwal = active.jadwal.map(id=>state.kelas.find(k=>k.id===id)).filter(Boolean);
  HARI_LIST.forEach(hari=>{
    const col = document.createElement('div'); col.className = 'cal-col';
    for(let h=CAL_START_HOUR; h<CAL_END_HOUR; h++) col.appendChild(el('div','hourline',''));
    kelasByJadwal.filter(k=>k.hari===hari).forEach(k=>{
      const m = state.matkul.find(mm=>mm.id===k.matkulId);
      const startMin = timeToMin(k.jamMulai) - CAL_START_HOUR*60;
      const endMin = timeToMin(k.jamSelesai) - CAL_START_HOUR*60;
      const pxPerMin = 44/60;
      const top = startMin*pxPerMin;
      const height = Math.max((endMin-startMin)*pxPerMin, 26);
      const block = document.createElement('div');
      block.className = 'cal-block' + (m && m.jenis==='pilihan' ? ' pilihan' : '');
      block.style.top = top+'px'; block.style.height = height+'px';
      block.innerHTML = `<b>${m ? m.kode : '—'}</b>${k.jamMulai}–${k.jamSelesai}${height>40 ? '<br>'+k.dosen : ''}<button data-remove="${k.id}" title="Hapus dari jadwal">✕</button>`;
      col.appendChild(block);
    });
    grid.appendChild(col);
  });
  grid.querySelectorAll('[data-remove]').forEach(b=> b.addEventListener('click', e=>{ e.stopPropagation(); toggleKelasInJadwal(b.dataset.remove); }) );
}
function renderStats(){
  const active = getActiveSkenario();
  const kelasByJadwal = active.jadwal.map(id=>state.kelas.find(k=>k.id===id)).filter(Boolean);
  const matkulIds = new Set(kelasByJadwal.map(k=>k.matkulId));
  const totalSks = [...matkulIds].reduce((sum,id)=>{ const m = state.matkul.find(mm=>mm.id===id); return sum + (m ? m.sks : 0); },0);
  document.getElementById('statMatkul').textContent = matkulIds.size;
  document.getElementById('statSks').textContent = totalSks;
  document.getElementById('statKelas').textContent = kelasByJadwal.length;
}
function renderSusunViews(){ renderSkenarioSelect(); renderMkList(); renderCalendar(); renderStats(); }

// ---------- REKOMENDASI OTOMATIS ----------
document.getElementById('btnToggleAutoGen').addEventListener('click', (e)=>{
  const body = document.getElementById('autoGenBody');
  const open = body.style.display === 'block';
  body.style.display = open ? 'none' : 'block';
  e.target.textContent = open ? 'Buka' : 'Tutup';
  if(!open) renderAutoGenMatkulList();
});
function renderAutoGenMatkulList(){
  const box = document.getElementById('autoGenMatkulList');
  box.innerHTML = '';
  const list = state.matkul.filter(m=>semesterMatchesActive(m.semester, state.semesterAktif));
  if(list.length===0){ box.innerHTML = '<span style="font-size:12px;color:var(--ink-soft);">Tidak ada matkul di semester ini.</span>'; return; }
  list.forEach(m=>{
    const pill = document.createElement('label');
    pill.className = 'checkbox-pill';
    pill.innerHTML = `<input type="checkbox" value="${m.id}"> ${m.nama}`;
    box.appendChild(pill);
  });
}
function generateCombinations(matkulIds, maxResults){
  const optionsByMatkul = matkulIds.map(mid=>({
    matkulId: mid,
    options: state.kelas.filter(k=>k.matkulId===mid).filter(passesPreferensi)
  }));
  const blocked = optionsByMatkul.filter(o=>o.options.length===0).map(o=>o.matkulId);
  if(blocked.length>0) return { results: [], blocked };
  optionsByMatkul.sort((a,b)=>a.options.length-b.options.length);
  const results = [];
  let steps = 0;
  function backtrack(idx, chosen){
    if(results.length>=maxResults || steps>200000) return;
    if(idx===optionsByMatkul.length){ results.push([...chosen]); return; }
    for(const opt of optionsByMatkul[idx].options){
      steps++;
      if(results.length>=maxResults || steps>200000) return;
      const conflict = chosen.some(c=> c.hari===opt.hari && overlap(timeToMin(c.jamMulai),timeToMin(c.jamSelesai),timeToMin(opt.jamMulai),timeToMin(opt.jamSelesai)));
      if(conflict) continue;
      chosen.push(opt); backtrack(idx+1, chosen); chosen.pop();
    }
  }
  backtrack(0, []);
  return { results, blocked: [] };
}
document.getElementById('btnGenerate').addEventListener('click', ()=>{
  const ids = [...document.querySelectorAll('#autoGenMatkulList input:checked')].map(i=>i.value);
  const resultsBox = document.getElementById('autoGenResults');
  resultsBox.innerHTML = '';
  if(ids.length===0){ resultsBox.innerHTML = '<p style="font-size:12.5px;color:var(--ink-soft);">Centang minimal satu matkul dulu.</p>'; return; }
  const { results, blocked } = generateCombinations(ids, 3);
  if(blocked.length>0){
    const namaList = blocked.map(id=>{ const m = state.matkul.find(x=>x.id===id); return m?m.nama:id; }).join(', ');
    resultsBox.innerHTML = `<p style="font-size:12.5px;color:var(--coral-ink);">Tidak ada kelas yang sesuai preferensi untuk: ${namaList}. Longgarkan preferensi jam/hari dulu.</p>`;
    return;
  }
  if(results.length===0){
    resultsBox.innerHTML = `<p style="font-size:12.5px;color:var(--coral-ink);">Tidak ditemukan kombinasi tanpa bentrok. Coba kurangi jumlah matkul atau longgarkan preferensi.</p>`;
    return;
  }
  results.forEach((combo,idx)=>{
    const sks = combo.reduce((s,k)=>{ const m = state.matkul.find(mm=>mm.id===k.matkulId); return s+(m?m.sks:0); },0);
    const card = document.createElement('div');
    card.className = 'result-card';
    const items = combo.map(k=>{
      const m = state.matkul.find(mm=>mm.id===k.matkulId);
      return `<li>${m?m.nama:'—'} — ${k.hari} ${k.jamMulai}–${k.jamSelesai} (${k.dosen})</li>`;
    }).join('');
    card.innerHTML = `<b>Kombinasi ${idx+1}</b> · ${sks} SKS<ul>${items}</ul><button class="btn small" data-apply="${idx}">Gunakan sebagai skenario baru</button>`;
    resultsBox.appendChild(card);
    card.querySelector('[data-apply]').addEventListener('click', ()=>{
      const s = { id: uid(), nama: 'Rekomendasi '+(idx+1)+' — '+new Date().toLocaleDateString('id-ID'), jadwal: combo.map(k=>k.id) };
      state.skenario.push(s); state.activeSkenarioId = s.id;
      saveState(); renderSusunViews();
      showMsg(`Skenario "${s.nama}" dibuat dan diaktifkan.`, 'ok');
    });
  });
});

// ---------- EXPORT PNG/PDF ----------
document.getElementById('btnPNG').addEventListener('click', ()=>{
  const target = document.querySelector('.calendar');
  html2canvas(target, { backgroundColor:'#ffffff', scale:2 }).then(canvas=>{
    const a = document.createElement('a');
    a.download = 'jadwal.png'; a.href = canvas.toDataURL('image/png'); a.click();
  });
});
document.getElementById('btnPDF').addEventListener('click', ()=>{
  const target = document.querySelector('.calendar');
  html2canvas(target, { backgroundColor:'#ffffff', scale:2 }).then(canvas=>{
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation:'landscape', unit:'pt', format:[canvas.width/2, canvas.height/2] });
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,canvas.width/2, canvas.height/2);
    pdf.save('jadwal.pdf');
  });
});

// ---------- RIWAYAT ----------
document.getElementById('btnSaveRiwayat').addEventListener('click', ()=>{
  const active = getActiveSkenario();
  if(active.jadwal.length===0){ alert('Skenario aktif masih kosong.'); return; }
  const label = prompt('Nama snapshot (misal: Semester 5 - Ganjil 2025/2026)', active.nama);
  if(!label) return;
  const items = active.jadwal.map(kid=>{
    const k = state.kelas.find(x=>x.id===kid);
    const m = k ? state.matkul.find(mm=>mm.id===k.matkulId) : null;
    if(!k||!m) return null;
    return { kode:m.kode, nama:m.nama, sks:m.sks, jenis:m.jenis, dosen:k.dosen, hari:k.hari, jamMulai:k.jamMulai, jamSelesai:k.jamSelesai, ruang:k.ruang };
  }).filter(Boolean);
  const sksTotal = items.reduce((s,i)=>s+i.sks,0);
  state.riwayat.unshift({ id: uid(), label, savedAt: new Date().toISOString(), sksTotal, items });
  saveState(); renderRiwayat();
});
function deleteRiwayat(id){
  if(!confirm('Hapus snapshot riwayat ini?')) return;
  state.riwayat = state.riwayat.filter(r=>r.id!==id);
  saveState(); renderRiwayat();
}
function renderRiwayat(){
  const list = document.getElementById('riwayatList');
  list.innerHTML = '';
  document.getElementById('riwayatEmpty').style.display = state.riwayat.length===0 ? 'block' : 'none';
  state.riwayat.forEach(r=>{
    const tanggal = new Date(r.savedAt).toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
    const items = r.items.map(i=>`<li>${i.kode} — ${i.nama} (${i.sks} sks) · ${i.hari} ${i.jamMulai}–${i.jamSelesai}, ${i.dosen}</li>`).join('');
    const card = document.createElement('div');
    card.className = 'riwayat-card';
    card.innerHTML = `
      <div class="riwayat-card-head">
        <span class="lbl">${r.label}</span>
        <span class="dt">${tanggal} · ${r.sksTotal} SKS</span>
      </div>
      <ul style="margin:6px 0;padding-left:18px;font-size:12.5px;">${items}</ul>
      <button class="btn ghost small" data-delriw="${r.id}">Hapus</button>
    `;
    list.appendChild(card);
    card.querySelector('[data-delriw]').addEventListener('click', ()=>deleteRiwayat(r.id));
  });
}

// ---------- EXPORT / IMPORT / RESET DATA ----------
document.getElementById('btnExport').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'data-jadwal.json'; a.click();
  URL.revokeObjectURL(url);
});
document.getElementById('btnImport').addEventListener('click', ()=> document.getElementById('fileImport').click());
document.getElementById('fileImport').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const parsed = JSON.parse(reader.result);
      if(!parsed.matkul || !parsed.kelas) throw new Error('format tidak sesuai');
      if(parsed.jadwal && !parsed.skenario){
        parsed.skenario = [{ id: uid(), nama:'Skenario 1', jadwal: parsed.jadwal }];
        parsed.activeSkenarioId = parsed.skenario[0].id;
      }
      state = {
        matkul: parsed.matkul||[], kelas: parsed.kelas||[], lulus: parsed.lulus||[],
        skenario: parsed.skenario||[], activeSkenarioId: parsed.activeSkenarioId||null,
        riwayat: parsed.riwayat||[],
        preferensi: Object.assign({ hindariHari:[], jamAwal:'07:00', jamAkhir:'20:00' }, parsed.preferensi||{}),
        semesterAktif: migrateActiveSemester(parsed.semesterAktif), darkMode: parsed.darkMode||false
      };
      state.matkul.forEach(m=>{ m.semester = migrateSemester(m.semester); });
      ensureSkenario();
      saveState();
      document.documentElement.setAttribute('data-theme', state.darkMode ? 'dark' : 'light');
      renderAll();
      alert('Data berhasil diimpor.');
    }catch(err){ alert('Gagal impor: file JSON tidak valid.'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});
document.getElementById('btnResetAll').addEventListener('click', ()=>{
  if(!confirm('Ini akan menghapus SEMUA data (matkul, kelas, skenario, riwayat). Yakin?')) return;
  state = { matkul:[], kelas:[], lulus:[], skenario:[], activeSkenarioId:null, riwayat:[], preferensi:{hindariHari:[],jamAwal:'07:00',jamAkhir:'20:00'}, semesterAktif: state.semesterAktif, darkMode: state.darkMode };
  ensureSkenario(); saveState(); renderAll();
});

function renderAll(){
  populateSemesterSelects();
  document.getElementById('mkSemester').value = state.semesterAktif;
  document.getElementById('susunSemLabel').textContent = state.semesterAktif;
  document.getElementById('susunSemParity').textContent = '(' + (isSemesterOdd(state.semesterAktif) ? 'ganjil' : 'genap') + ')';
  populateMatkulSelects();
  renderPrasyaratBox();
  renderMatkulTable();
  renderKelasTable();
  renderPrefBoxes();
  renderAutoGenMatkulList();
  renderSusunViews();
  renderRiwayat();
}

loadState();
document.documentElement.setAttribute('data-theme', state.darkMode ? 'dark' : 'light');
renderAll();