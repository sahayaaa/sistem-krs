const STORAGE_KEY = 'susun-jadwal-app-data-v2';
const HARI_LIST = ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const CAL_START_HOUR = 7;
const CAL_END_HOUR = 20;
const SEMESTER_NUMS = ['1','2','3','4','5','6','7','8'];
const SEMESTER_FLEX = ['ganjil','genap'];
const SEMESTER_ALL_VALUES = [...SEMESTER_NUMS, ...SEMESTER_FLEX];

// ---------- KONFIGURASI SUPABASE (isi setelah bikin project di supabase.com) ----------
// SUPABASE_URL: dari Project Settings > API > "Project URL" (bentuknya https://xxxxx.supabase.co)
// SUPABASE_ANON_KEY: dari Project Settings > API > key "anon public" / "publishable"
// !! JANGAN PERNAH taruh "service_role" / "secret" key (sb_secret_...) di sini —
// !! itu key rahasia yang bisa buka akses PENUH ke seluruh database, harus SELALU
// !! disimpan di server, tidak boleh ada di kode yang jalan di browser.
const SUPABASE_URL = 'https://cxsrjbshkdlgqaxfdbcs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_m2by4aSCwXVMXzFmw5aZcw_XMtmBsNO';
const SYNC_ENABLED = SUPABASE_URL.startsWith('http'); // otomatis nonaktif kalau belum diisi
let sb = null;
if(SYNC_ENABLED && window.supabase){
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
let currentUser = null;
let syncTimer = null;
let isSyncing = false;

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

// ---------- MODAL CUSTOM (pengganti prompt/confirm/alert native) ----------
// native dialogs suka diblokir di webview (VS Code Live Preview dll) & jelek di HP
function showModal({title='', message='', showInput=false, inputValue='', confirmText='OK', cancelText='Batal', danger=false}){
  return new Promise(resolve=>{
    const overlay = document.getElementById('modalOverlay');
    const titleEl = document.getElementById('modalTitle');
    const msgEl = document.getElementById('modalMsg');
    const input = document.getElementById('modalInput');
    const actions = document.getElementById('modalActions');
    titleEl.textContent = title; titleEl.style.display = title ? 'block' : 'none';
    msgEl.textContent = message; msgEl.style.display = message ? 'block' : 'none';
    input.style.display = showInput ? 'block' : 'none';
    input.value = inputValue;
    actions.innerHTML = '';
    function close(){ overlay.classList.remove('show'); document.removeEventListener('keydown', onKey); }
    function onKey(e){
      if(e.key==='Escape'){ close(); resolve(showInput ? null : false); }
      if(e.key==='Enter' && showInput){ okBtn.click(); }
    }
    if(cancelText){
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn ghost small';
      cancelBtn.textContent = cancelText;
      cancelBtn.addEventListener('click', ()=>{ close(); resolve(showInput ? null : false); });
      actions.appendChild(cancelBtn);
    }
    const okBtn = document.createElement('button');
    okBtn.className = 'btn small' + (danger ? ' danger' : '');
    okBtn.textContent = confirmText;
    okBtn.addEventListener('click', ()=>{ const val = showInput ? input.value : true; close(); resolve(val); });
    actions.appendChild(okBtn);
    document.addEventListener('keydown', onKey);
    overlay.classList.add('show');
    if(showInput) setTimeout(()=>{ input.focus(); input.select(); }, 30);
    else setTimeout(()=> okBtn.focus(), 30);
  });
}
function customAlert(message, title='Info'){
  return showModal({ title, message, confirmText:'OK', cancelText:null });
}
function customConfirm(message, title='Konfirmasi', danger=false){
  return showModal({ title, message, confirmText: danger ? 'Hapus' : 'Ya', cancelText:'Batal', danger });
}
function customPrompt(message, defaultValue='', title='Isi nama'){
  return showModal({ title, message, showInput:true, inputValue:defaultValue, confirmText:'Simpan', cancelText:'Batal' });
}

// Menu "Aksi" (Edit/Hapus) generik dipakai di tabel matkul & kelas
function actionMenuCell(id, extraBtnsHtml){
  return `<td class="row-actions"><div class="action-menu-wrap">
    <button class="btn ghost small action-toggle" data-menu-id="${id}">Aksi ▾</button>
    <div class="action-menu" data-menu="${id}">
      <button data-edit="${id}">Edit</button>
      <button data-del="${id}" class="danger-text">Hapus</button>
      ${extraBtnsHtml||''}
    </div>
  </div></td>`;
}
function wireActionMenus(tbody){
  tbody.querySelectorAll('.action-toggle').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      const wasOpen = menu.classList.contains('show');
      document.querySelectorAll('.action-menu.show').forEach(m=>m.classList.remove('show'));
      if(!wasOpen) menu.classList.add('show');
    });
  });
}
document.addEventListener('click', ()=> document.querySelectorAll('.action-menu.show').forEach(m=>m.classList.remove('show')) );
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
  scheduleSync();
}

// ---------- AUTH & SYNC (mode akun, opsional) ----------
function scheduleSync(){
  if(!currentUser || !sb) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushToCloud, 1200);
}
async function pushToCloud(){
  if(!currentUser || !sb) return;
  isSyncing = true; updateAccountLabel();
  try{
    await sb.from('user_data').upsert({ user_id: currentUser.id, data: state, updated_at: new Date().toISOString() });
  }catch(e){ console.error('Gagal sync ke cloud', e); }
  isSyncing = false; updateAccountLabel();
}
async function pullFromCloud(){
  if(!currentUser || !sb) return null;
  const { data, error } = await sb.from('user_data').select('data').eq('user_id', currentUser.id).maybeSingle();
  if(error){ console.error('Gagal ambil data cloud', error); return null; }
  return data ? data.data : null;
}
function updateAccountLabel(){
  const lbl = document.getElementById('btnAccountLabel');
  if(!lbl) return;
  if(!SYNC_ENABLED){ lbl.textContent = 'Mode Lokal'; return; }
  if(!currentUser){ lbl.textContent = 'Mode Lokal'; return; }
  lbl.textContent = isSyncing ? 'Menyinkron…' : (currentUser.email || 'Akun');
}
async function initAuth(){
  if(!SYNC_ENABLED || !sb) { updateAccountLabel(); return; }
  const { data:{ session } } = await sb.auth.getSession();
  if(session && session.user){
    currentUser = session.user;
    updateAccountLabel();
    const cloudData = await pullFromCloud();
    if(cloudData){
      applyIncomingState(cloudData);
    } else {
      await pushToCloud(); // akun baru, belum ada data di cloud -> kirim data lokal
    }
  }
  sb.auth.onAuthStateChange((event, session)=>{
    if(event==='SIGNED_OUT'){ currentUser = null; updateAccountLabel(); }
    if(event==='PASSWORD_RECOVERY'){
      // Orang klik link reset password dari email -> Supabase kasih sesi sementara di sini,
      // arahin ke form "bikin password baru" biar bisa langsung diganti.
      authView = 'reset-password';
      openAccountModal();
    }
  });
}
function applyIncomingState(data){
  if(data.jadwal && !data.skenario){
    data.skenario = [{ id: uid(), nama: 'Skenario 1', jadwal: data.jadwal }];
    data.activeSkenarioId = data.skenario[0].id;
  }
  state = Object.assign({
    matkul: [], kelas: [], lulus: [], skenario: [], activeSkenarioId: null, riwayat: [],
    preferensi: { hindariHari:[], jamAwal:'07:00', jamAkhir:'20:00' },
    semesterAktif: '1', darkMode: false
  }, data);
  state.matkul.forEach(m=>{ m.semester = migrateSemester(m.semester); });
  state.semesterAktif = migrateActiveSemester(state.semesterAktif);
  ensureSkenario();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  document.documentElement.setAttribute('data-theme', state.darkMode ? 'dark' : 'light');
  renderAll();
}

// ---------- MODAL AKUN (penjelasan mode lokal vs akun + form login/daftar) ----------
let authTab = 'login';
let authView = 'form'; // 'form' | 'check-email'
let pendingEmail = '';
function openAccountModal(){
  authView = 'form';
  renderAccountModalBody();
  document.getElementById('accountModalOverlay').classList.add('show');
}
function closeAccountModal(){
  document.getElementById('accountModalOverlay').classList.remove('show');
}
function renderAccountModalBody(){
  const box = document.getElementById('accountModalBody');

  if(!SYNC_ENABLED){
    box.innerHTML = `
      <div class="acc-info"><b>Sinkronisasi cloud belum diaktifkan</b> di app ini (butuh setup Supabase dulu oleh pembuat app). Untuk sekarang, data kamu tersimpan lokal di device/browser ini aja. Pakai tombol "Ekspor data" di bagian bawah buat pindahin data ke device lain.</div>
      <div class="modal-actions"><button class="btn small" id="accCloseBtn">Oke, mengerti</button></div>
    `;
    document.getElementById('accCloseBtn').addEventListener('click', closeAccountModal);
    return;
  }

  // -------- sudah login --------
  if(currentUser){
    const initial = (currentUser.email||'?').charAt(0).toUpperCase();
    box.innerHTML = `
      <div class="acc-info">Data kamu otomatis kesinkron ke cloud tiap ada perubahan, dan bisa dibuka di device manapun tinggal login pakai akun ini.</div>
      <div class="acc-user-card">
        <div class="acc-avatar">${initial}</div>
        <div class="acc-user-body">
          <div class="acc-user-email">${currentUser.email}</div>
          <div class="acc-sync-row" id="accSyncStatus">
            <span class="acc-sync-dot ${isSyncing?'syncing':''}"></span>
            ${isSyncing ? 'Lagi menyinkron…' : 'Tersinkron'}
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn ghost btn-danger small" id="accLogoutBtn">Keluar (logout)</button>
        <button class="btn small" id="accCloseBtn">Tutup</button>
      </div>
    `;
    document.getElementById('accCloseBtn').addEventListener('click', closeAccountModal);
    document.getElementById('accLogoutBtn').addEventListener('click', async ()=>{
      if(!await customConfirm('Keluar dari akun? Data tetap ada di cloud, dan device ini balik ke Mode Lokal.', 'Keluar akun?')) return;
      await sb.auth.signOut();
      currentUser = null;
      updateAccountLabel();
      renderAccountModalBody();
    });
    return;
  }

  // -------- lupa password: minta email buat dikirimin link reset --------
  if(authView==='forgot'){
    box.innerHTML = `
      <div class="acc-info"><b>Lupa password?</b> Masukin email akun kamu, nanti kami kirim link buat bikin password baru.</div>
      <div class="auth-error" id="authError"></div>
      <div class="auth-field"><label for="forgotEmail">Email</label><input type="email" id="forgotEmail" placeholder="nama@email.com" value="${pendingEmail||''}"></div>
      <div class="modal-actions">
        <button class="btn ghost small" id="forgotBackBtn">Kembali</button>
        <button class="btn small" id="forgotSubmitBtn">Kirim link reset</button>
      </div>
    `;
    document.getElementById('forgotBackBtn').addEventListener('click', ()=>{ authView='form'; renderAccountModalBody(); });
    document.getElementById('forgotSubmitBtn').addEventListener('click', handleForgotSubmit);
    document.getElementById('forgotEmail').addEventListener('keydown', e=>{ if(e.key==='Enter') handleForgotSubmit(); });
    return;
  }

  // -------- link reset udah dikirim --------
  if(authView==='forgot-sent'){
    box.innerHTML = `
      <div class="check-email-box">
        <div class="check-email-icon">🔑</div>
        <div class="title">Link reset terkirim</div>
        <p>Kami sudah kirim link buat bikin password baru ke email di bawah ini. Buka email kamu ya.</p>
        <div class="check-email-addr">${pendingEmail}</div>
      </div>
      <p class="check-email-hint">Nggak ketemu emailnya? Cek folder Spam. Kalo tetep ga muncul wasap saya aja.</p>
      <div class="modal-actions" style="margin-top:14px;">
        <button class="btn small" id="forgotDoneBtn">Kembali ke login</button>
      </div>
    `;
    document.getElementById('forgotDoneBtn').addEventListener('click', ()=>{ authView='form'; authTab='login'; renderAccountModalBody(); });
    return;
  }

  // -------- orang klik link reset dari email -> bikin password baru --------
  if(authView==='reset-password'){
    box.innerHTML = `
      <div class="acc-info"><b>Bikin password baru</b><br>Masukin password baru buat akun kamu. Setelah disimpan, kamu langsung masuk pakai password ini.</div>
      <div class="auth-error" id="authError"></div>
      <div class="auth-field"><label for="newPassword">Password baru</label><input type="password" id="newPassword" placeholder="minimal 6 karakter"></div>
      <div class="modal-actions">
        <button class="btn small" id="newPasswordSubmitBtn">Simpan password baru</button>
      </div>
    `;
    document.getElementById('newPasswordSubmitBtn').addEventListener('click', handleNewPasswordSubmit);
    document.getElementById('newPassword').addEventListener('keydown', e=>{ if(e.key==='Enter') handleNewPasswordSubmit(); });
    return;
  }

  // -------- baru daftar, nunggu konfirmasi email --------
  if(authView==='check-email'){
    box.innerHTML = `
      <div class="check-email-box">
        <div class="check-email-icon">✉️</div>
        <div class="title">Cek email kamu</div>
        <p>Kami sudah kirim link konfirmasi ke email di bawah ini. Tolong cek email yaaa</p>
        <div class="check-email-addr">${pendingEmail}</div>
      </div>
      <p class="check-email-hint">Nggak ketemu emailnya? Cek folder Spam. Kalo tetep ga muncul wasap saya aja.</p>
      <div class="modal-actions" style="margin-top:14px;">
        <button class="btn ghost small" id="chkCloseBtn">Tutup</button>
        <button class="btn small" id="chkTryLoginBtn">Sudah konfirmasi, masuk</button>
      </div>
    `;
    document.getElementById('chkCloseBtn').addEventListener('click', closeAccountModal);
    document.getElementById('chkTryLoginBtn').addEventListener('click', ()=>{
      authView = 'form'; authTab = 'login';
      renderAccountModalBody();
      const emailInp = document.getElementById('authEmail');
      if(emailInp) emailInp.value = pendingEmail;
    });
    return;
  }

  // -------- form login / daftar --------
  box.innerHTML = `
    <div class="acc-info">
      <b>Mode Lokal (default):</b> data cuma tersimpan di browser & device ini. Kalau ganti device/browser datanya nggak ikut kecuali ekspor-impor manual.<br><br>
      <b>Mode Akun (opsional):</b> login/daftar pakai email, data otomatis kesinkron ke cloud dan bisa dibuka di device manapun tinggal login.
    <div class="auth-tabs">
      <button data-authtab="login" class="${authTab==='login'?'active':''}">Masuk</button>
      <button data-authtab="signup" class="${authTab==='signup'?'active':''}">Daftar</button>
    </div>
    <div class="auth-error" id="authError"></div>
    <div class="auth-field"><label for="authEmail">Email</label><input type="email" id="authEmail" placeholder="nama@email.com"></div>
    <div class="auth-field"><label for="authPassword">Password</label><input type="password" id="authPassword" placeholder="minimal 6 karakter"></div>
    ${authTab==='login' ? '<div class="auth-forgot"><button type="button" id="authForgotBtn" class="link-btn">Lupa password?</button></div>' : ''}
    <div class="modal-actions">
      <button class="btn ghost small" id="accSkipBtn">Lanjut tanpa login</button>
      <button class="btn small" id="authSubmitBtn">${authTab==='login' ? 'Masuk' : 'Daftar'}</button>
    </div>
  `;
  document.querySelectorAll('[data-authtab]').forEach(b=>{
    b.addEventListener('click', ()=>{ authTab = b.dataset.authtab; renderAccountModalBody(); });
  });
  document.getElementById('accSkipBtn').addEventListener('click', closeAccountModal);
  document.getElementById('authSubmitBtn').addEventListener('click', handleAuthSubmit);
  [document.getElementById('authEmail'), document.getElementById('authPassword')].forEach(inp=>{
    inp.addEventListener('keydown', e=>{ if(e.key==='Enter') handleAuthSubmit(); });
  });
  const forgotBtn = document.getElementById('authForgotBtn');
  if(forgotBtn){
    forgotBtn.addEventListener('click', ()=>{
      pendingEmail = document.getElementById('authEmail').value.trim();
      authView = 'forgot';
      renderAccountModalBody();
    });
  }
}
async function handleAuthSubmit(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errBox = document.getElementById('authError');
  errBox.classList.remove('show');
  if(!email || !password){ errBox.textContent = 'Isi email dan password dulu ya.'; errBox.classList.add('show'); return; }
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true; btn.textContent = 'Memproses…';
  try{
    if(authTab==='signup'){
      const { data, error } = await sb.auth.signUp({ email, password });
      if(error) throw error;
      if(data.user && !data.session){
        pendingEmail = email;
        authView = 'check-email';
        renderAccountModalBody();
        return;
      }
      currentUser = data.user;
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if(error) throw error;
      currentUser = data.user;
    }
    updateAccountLabel();
    const cloudData = await pullFromCloud();
    if(cloudData) applyIncomingState(cloudData);
    else await pushToCloud();
    closeAccountModal();
  }catch(e){
    errBox.textContent = e.message || 'Gagal memproses. Coba lagi.';
    errBox.classList.add('show');
    btn.disabled = false; btn.textContent = authTab==='login' ? 'Masuk' : 'Daftar';
  }
}
async function handleForgotSubmit(){
  const email = document.getElementById('forgotEmail').value.trim();
  const errBox = document.getElementById('authError');
  errBox.classList.remove('show');
  if(!email){ errBox.textContent = 'Isi email dulu ya.'; errBox.classList.add('show'); return; }
  const btn = document.getElementById('forgotSubmitBtn');
  btn.disabled = true; btn.textContent = 'Mengirim…';
  try{
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
    if(error) throw error;
    pendingEmail = email;
    authView = 'forgot-sent';
    renderAccountModalBody();
  }catch(e){
    errBox.textContent = e.message || 'Gagal mengirim link reset. Coba lagi.';
    errBox.classList.add('show');
    btn.disabled = false; btn.textContent = 'Kirim link reset';
  }
}
async function handleNewPasswordSubmit(){
  const password = document.getElementById('newPassword').value;
  const errBox = document.getElementById('authError');
  errBox.classList.remove('show');
  if(!password || password.length < 6){ errBox.textContent = 'Password minimal 6 karakter ya.'; errBox.classList.add('show'); return; }
  const btn = document.getElementById('newPasswordSubmitBtn');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  try{
    const { data, error } = await sb.auth.updateUser({ password });
    if(error) throw error;
    currentUser = data.user;
    updateAccountLabel();
    closeAccountModal();
    authView = 'form';
    const cloudData = await pullFromCloud();
    if(cloudData) applyIncomingState(cloudData);
    else await pushToCloud();
    await customAlert('Password baru berhasil disimpan. Kamu sudah masuk pakai password ini.', 'Berhasil');
  }catch(e){
    errBox.textContent = e.message || 'Gagal menyimpan password. Coba lagi.';
    errBox.classList.add('show');
    btn.disabled = false; btn.textContent = 'Simpan password baru';
  }
}
document.getElementById('btnAccount').addEventListener('click', openAccountModal);
document.getElementById('accountModalX').addEventListener('click', closeAccountModal);
document.getElementById('accountModalOverlay').addEventListener('click', e=>{
  if(e.target.id==='accountModalOverlay') closeAccountModal();
});

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
  document.getElementById('mkFilterSem').value = state.semesterAktif;
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
function renderPrasyaratBox(excludeId){
  const box = document.getElementById('mkPrasyaratBox');
  box.innerHTML = '';
  const opts = state.matkul.filter(m=> m.id!==excludeId);
  if(opts.length===0){ box.innerHTML = '<span style="font-size:12px;color:var(--ink-soft);">Tambahkan matkul lain dulu untuk memilih prasyarat.</span>'; return; }
  opts.forEach(m=>{
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" value="${m.id}"> ${m.kode} — ${m.nama}`;
    box.appendChild(lbl);
  });
}

let editingMatkulId = null;
function resetMatkulForm(){
  editingMatkulId = null;
  document.getElementById('mkFormTitle').textContent = 'Tambah mata kuliah';
  document.getElementById('btnAddMk').textContent = '+ Tambah matkul';
  document.getElementById('btnCancelEditMk').style.display = 'none';
  document.getElementById('mkKode').value = '';
  document.getElementById('mkNama').value = '';
  document.getElementById('mkSks').value = '';
  document.getElementById('mkJenis').value = 'wajib';
  document.getElementById('mkSemester').value = state.semesterAktif;
  renderPrasyaratBox();
}
function startEditMatkul(id){
  const m = state.matkul.find(x=>x.id===id);
  if(!m) return;
  editingMatkulId = id;
  document.getElementById('mkFormTitle').textContent = 'Edit mata kuliah';
  document.getElementById('btnAddMk').textContent = 'Simpan perubahan';
  document.getElementById('btnCancelEditMk').style.display = 'inline-block';
  document.getElementById('mkKode').value = m.kode;
  document.getElementById('mkNama').value = m.nama;
  document.getElementById('mkSks').value = m.sks;
  document.getElementById('mkJenis').value = m.jenis;
  document.getElementById('mkSemester').value = m.semester;
  renderPrasyaratBox(id);
  (m.prasyarat||[]).forEach(pid=>{
    const cb = document.querySelector(`#mkPrasyaratBox input[value="${pid}"]`);
    if(cb) cb.checked = true;
  });
  document.getElementById('panel-matkul').scrollIntoView({ behavior:'smooth', block:'start' });
}
document.getElementById('btnCancelEditMk').addEventListener('click', resetMatkulForm);

document.getElementById('btnAddMk').addEventListener('click', async ()=>{
  const kode = document.getElementById('mkKode').value.trim();
  const nama = document.getElementById('mkNama').value.trim();
  const sks = parseInt(document.getElementById('mkSks').value,10);
  const jenis = document.getElementById('mkJenis').value;
  const semester = document.getElementById('mkSemester').value;
  const prasyarat = [...document.querySelectorAll('#mkPrasyaratBox input:checked')].map(i=>i.value);
  if(!kode || !nama || !sks){ await customAlert('Isi kode, nama, dan SKS dulu ya.'); return; }
  if(editingMatkulId){
    const m = state.matkul.find(x=>x.id===editingMatkulId);
    if(m){ Object.assign(m, { kode, nama, sks, jenis, semester, prasyarat }); }
    resetMatkulForm();
  } else {
    state.matkul.push({ id: uid(), kode, nama, sks, jenis, semester, prasyarat });
    document.getElementById('mkKode').value = '';
    document.getElementById('mkNama').value = '';
    document.getElementById('mkSks').value = '';
  }
  saveState(); renderAll();
});

async function deleteMatkul(id){
  if(!await customConfirm('Hapus matkul ini? Kelas yang terkait juga akan terhapus.', 'Hapus matkul?', true)) return;
  state.matkul = state.matkul.filter(m=>m.id!==id);
  state.matkul.forEach(m=>{ m.prasyarat = (m.prasyarat||[]).filter(pid=>pid!==id); });
  state.kelas = state.kelas.filter(k=>k.matkulId!==id);
  state.lulus = state.lulus.filter(lid=>lid!==id);
  state.skenario.forEach(s=>{ s.jadwal = s.jadwal.filter(kid=> state.kelas.some(k=>k.id===kid)); });
  if(editingMatkulId===id) resetMatkulForm();
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
      ${actionMenuCell(m.id)}
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click',()=>deleteMatkul(b.dataset.del)) );
  tbody.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click',()=>startEditMatkul(b.dataset.edit)) );
  tbody.querySelectorAll('[data-lulus]').forEach(cb=> cb.addEventListener('change',()=>toggleLulus(cb.dataset.lulus)) );
  wireActionMenus(tbody);
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
document.getElementById('btnAddKl').addEventListener('click', async ()=>{
  const matkulId = document.getElementById('klMatkul').value;
  const dosen = document.getElementById('klDosen').value.trim();
  const hari = document.getElementById('klHari').value;
  const jamMulai = document.getElementById('klMulai').value;
  const jamSelesai = document.getElementById('klSelesai').value;
  const ruang = document.getElementById('klRuang').value.trim();
  if(!matkulId){ await customAlert('Tambahkan mata kuliah dulu di tab pertama.'); return; }
  if(!dosen || !jamMulai || !jamSelesai){ await customAlert('Isi dosen dan jam dulu ya.'); return; }
  if(timeToMin(jamMulai) >= timeToMin(jamSelesai)){ await customAlert('Jam selesai harus setelah jam mulai.'); return; }
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
async function deleteKelas(id){
  if(!await customConfirm('Hapus kelas ini?', 'Hapus kelas?', true)) return;
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
      ${actionMenuCell(k.id)}
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click',()=>deleteKelas(b.dataset.del)) );
  tbody.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click',()=>startEditKelas(b.dataset.edit)) );
  wireActionMenus(tbody);
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
document.getElementById('btnSkenarioNew').addEventListener('click', async ()=>{
  const nama = await customPrompt('Nama untuk skenario baru:', 'Skenario '+(state.skenario.length+1), 'Skenario baru');
  if(!nama) return;
  const s = { id: uid(), nama, jadwal: [] };
  state.skenario.push(s); state.activeSkenarioId = s.id;
  saveState(); renderSkenarioSelect(); renderSusunViews();
});
document.getElementById('btnSkenarioRename').addEventListener('click', async ()=>{
  const active = getActiveSkenario();
  const nama = await customPrompt('Nama baru untuk skenario ini:', active.nama, 'Ganti nama skenario');
  if(!nama) return;
  active.nama = nama; saveState(); renderSkenarioSelect();
});
document.getElementById('btnSkenarioDuplicate').addEventListener('click', ()=>{
  const active = getActiveSkenario();
  const s = { id: uid(), nama: active.nama+' (salinan)', jadwal: [...active.jadwal] };
  state.skenario.push(s); state.activeSkenarioId = s.id;
  saveState(); renderSkenarioSelect(); renderSusunViews();
});
document.getElementById('btnSkenarioDelete').addEventListener('click', async ()=>{
  if(state.skenario.length<=1){ await customAlert('Minimal harus ada satu skenario.'); return; }
  if(!await customConfirm('Hapus skenario aktif?', 'Hapus skenario?', true)) return;
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

document.getElementById('btnClearJadwal').addEventListener('click', async ()=>{
  if(!await customConfirm('Kosongkan jadwal skenario aktif?', 'Kosongkan jadwal?', true)) return;
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
document.getElementById('btnSaveRiwayat').addEventListener('click', async ()=>{
  const active = getActiveSkenario();
  if(active.jadwal.length===0){ await customAlert('Skenario aktif masih kosong.'); return; }
  const label = await customPrompt('Nama snapshot (misal: Semester 5 - Ganjil 2025/2026)', active.nama, 'Simpan ke riwayat');
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
async function deleteRiwayat(id){
  if(!await customConfirm('Hapus snapshot riwayat ini?', 'Hapus riwayat?', true)) return;
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
  reader.onload = async () => {
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
      await customAlert('Data berhasil diimpor.', 'Impor sukses');
    }catch(err){ await customAlert('Gagal impor: file JSON tidak valid.', 'Impor gagal'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});
document.getElementById('btnResetAll').addEventListener('click', async ()=>{
  if(!await customConfirm('Ini akan menghapus SEMUA data (matkul, kelas, skenario, riwayat). Yakin?', 'Reset semua data?', true)) return;
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
initAuth();
