// ==========================================================
//  SISTEM TOKO SEIKO ALBA SIDOARJO 108  (versi rapi + perbaikan)
//  Catatan: pengecekan role di sisi browser hanya mengatur TAMPILAN.
//  Pengamanan sebenarnya harus lewat Row Level Security (RLS) di Supabase.
// ==========================================================

// === STATE GLOBAL ===
let db = { produk: [], jual: [], servis: [], baterai: [], stokBaterai: [], sparePart: [], supplier: [], pembelian: [], kas: [], pelanggan: [], bank: [], auditBarang: [], settings: {}, auditLog: [] };
let cart = [], cartServis = [], cartBaterai = [], cartBateraiServis = [], cartServisGabungan = [];
let filterServisStatus = '', filterKasJenis = '', filterAuditUser = '';
let tempFotoBase64 = '', tempAuditData = {};
let statusKlaimAktif = { multiplier: 1, tipe: 'Normal' };
let modeKlaimProdukJualId = '';
db.bebanTetap = [];
let scanStream = null, scanTarget = null, scanInterval = null, scanMode = 'input';
let isProcessingPayment = false, isSavingServis = false, isSavingBaterai = false;
let realtimeChannel = null, refreshTimer = null;

// === KONSTANTA (ubah di sini bila aturan berubah) ===
const GARANSI_BATERAI_PENUH_BULAN = 6;     // <= 6 bulan: gratis
const GARANSI_BATERAI_SETENGAH_BULAN = 9;  // 7-9 bulan: bayar 50%, lebih dari itu bayar penuh
const MAX_KLAIM_SERVIS = 2;
const NILAI_POIN = 100;                    // 1 poin = Rp 100
const TRACK_URL = 'https://servicejamsidoarjo108-commits.github.io/seikoalbasidoarjo108/track.html';

const TOKO_DEFAULT = {
  nama: 'Toko Seiko Alba Sidoarjo 108',
  telp: '081331939397',
  alamat: 'Jl Gajah Mada No 108',
  footer: 'Terima kasih telah berbelanja',
  syarat: 'PEMBELIAN PRODUK:\n1. Pembeli wajib memeriksa kondisi fisik, kelengkapan, dan fungsi barang sebelum meninggalkan toko.\n2. Barang yang telah dibeli tidak dapat ditukar atau dikembalikan, kecuali terdapat cacat produksi dari pabrik.\n3. Garansi mesin berlaku sesuai dengan ketentuan yang tertera pada nota. Garansi tidak berlaku untuk aksesoris (tali, kaca, baterai) kecuali disepakati lain.\n\nGARANSI PRODUK:\n1. Klaim garansi produk wajib menyertakan nota pembelian asli atau kartu garansi.\n2. Garansi produk TIDAK BERLAKU apabila: (a) Kerusakan akibat kelalaian pengguna (terjatuh, terbentur, tergores); (b) Jam kemasukan air di luar spesifikasi; (c) Segel rusak atau pernah dibongkar oleh pihak lain.\n3. Waktu pengerjaan klaim garansi produk berkisar 7-14 hari kerja.\n\nGARANSI SERVIS (3 BULAN):\n1. Setiap servis yang telah selesai diberikan garansi pekerjaan selama 3 (tiga) bulan sejak tanggal servis selesai, kecuali dinyatakan lain pada nota.\n2. Garansi servis mencakup jaminan pekerjaan teknisi atas kerusakan yang SAMA pada bagian yang telah diservis.\n3. Garansi servis TIDAK BERLAKU apabila: (a) Kerusakan akibat kelalaian pengguna (jam terjatuh, terbentur, tergores, kemasukan air); (b) Jam pernah dibuka/diperbaiki oleh pihak lain di luar toko kami; (c) Kerusakan pada bagian yang berbeda dari yang diservis sebelumnya.\n4. Garansi servis berlaku hanya jika pelanggan dapat menunjukkan nota servis asli.\n5. Garansi servis berakhir pada pukul 23:59 WIB di tanggal terakhir masa berlaku. Klaim yang diajukan pada atau sebelum waktu tersebut tetap sah dan belum daluwarsa.\n\nKLAIM GARANSI SERVIS:\n1. Klaim garansi servis hanya dapat dilakukan selama masa garansi masih aktif (lihat tanggal garansi pada nota).\n2. Biaya jasa teknisi GRATIS (Rp 0) untuk semua klaim garansi dalam masa berlaku.\n3. Penggantian spare part atau baterai (jika diperlukan) TETAP DIKENAKAN BIAYA sesuai harga yang berlaku.\n4. Klaim garansi maksimal 2 (dua) kali per nota servis. Klaim ke-3 dan seterusnya dikenakan biaya normal.\n5. Setiap perbaikan ulang dalam rangka klaim garansi diberikan garansi baru 3 (tiga) bulan untuk pekerjaan tersebut.\n6. Keputusan teknisi mengenai penyebab kerusakan dan perlu-tidaknya penggantian spare part adalah mutlak.\n7. Waktu pengerjaan klaim garansi berkisar 3-7 hari kerja tergantung antrian.',
  syaratSingkat: 'S&K PEMBELIAN:\n1. Barang yang telah dibeli tidak dapat ditukar/dikembalikan, kecuali cacat produksi pabrik.\n2. Pembeli wajib memeriksa kondisi barang sebelum bertransaksi.\n\nS&K GARANSI PRODUK:\n1. Wajib menunjukkan nota asli saat klaim.\n2. Garansi HANGUS apabila: Jam kemasukan air, terjatuh, atau segel rusak.\n\nS&K GARANSI SERVIS:\n1. Garansi servis 3 bulan sejak tanggal selesai (s/d 23:59 tanggal terakhir).\n2. Klaim: Jasa GRATIS, spare part/baterai tetap berbayar.\n3. Klaim maksimal 2x per nota. Klaim ke-3+ dikenakan biaya normal.\n4. Garansi HANGUS jika jam dibuka/diperbaiki pihak lain.\n5. Wajib menunjukkan nota servis asli saat klaim.'
};

const DAFTAR_METODE = { '1': 'tunai', '2': 'transfer', '3': 'qris', '4': 'edc_cc_bca', '5': 'edc_cc_vm', '6': 'edc_cc_amex', '7': 'edc_dc_bca', '8': 'edc_dc_lain', '9': 'edc_dc_maestro' };
const SUMBER_KAS = ['jual','servis','baterai','manual','kas_kecil','pembelian','rekonsiliasi','pelunasan_hutang','beban_bulanan','mdr'];

const SEMUA_MENU = ['kasir', 'servis', 'baterai', 'produk', 'sparepart', 'laporan', 'pelanggan', 'kas', 'supplier', 'keuangan', 'semua_stok', 'laporan_audit', 'setting'];
const MENU_BY_ROLE = {
  kasir: ['kasir', 'baterai', 'pelanggan'],
  admin: ['kasir', 'baterai', 'pelanggan', 'servis', 'produk', 'sparepart', 'kas', 'supplier'],
  pemilik: SEMUA_MENU
};

// === HELPER UMUM ===
const $ = id => document.getElementById(id);
const num = id => +($(id)?.value) || 0;
const txt = id => ($(id)?.value || '').trim();
const rp = n => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');
const nowISO = () => new Date().toISOString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const genId = prefix => prefix + Date.now() + Math.random().toString(36).substring(2, 6);
const escapeLike = s => String(s ?? '').replace(/[\\%_]/g, '\\$&');
const waPhone = hp => (hp || '').replace(/\D/g, '').replace(/^0/, '62');
const tglLokal = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const tambahBulan = (tglStr, n) => { const d = new Date(tglStr + 'T00:00:00'); d.setMonth(d.getMonth() + n); return tglLokal(d); };
const linkLacak = (param, nilai) => `${TRACK_URL}?${param}=${encodeURIComponent(nilai)}`;
const qrUrl = link => `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(link)}`;

function formatNama(str) {
  if (!str) return '';
  return str.trim().toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
}

function flash(text, type = 'ok') {
  const el = $('msg'); if (!el) return;
  el.textContent = text; el.className = 'msg ' + type;
  clearTimeout(window.__msgT);
  window.__msgT = setTimeout(() => { el.className = 'msg'; el.textContent = ''; }, 3500);
}

function checkRequired(ids) {
  let valid = true;
  ids.forEach(id => {
    const el = $(id); if (!el) return;
    if (!el.value.trim()) { el.classList.add('input-error'); valid = false; }
    else el.classList.remove('input-error');
  });
  return valid;
}
document.addEventListener('input', e => { if (e.target && e.target.classList) e.target.classList.remove('input-error'); });

// Jalankan query Supabase; lempar error bila gagal (supaya masuk ke catch)
async function dbOk(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Ubah stok secara aman (cek stok terkini + kunci optimis), delta negatif = mengurangi
async function ubahStok(tabel, id, delta) {
  for (let i = 0; i < 3; i++) {
    const { data: cur, error } = await supabaseClient.from(tabel).select('stok').eq('id', id).single();
    if (error) throw error;
    const baru = (cur.stok || 0) + delta;
    if (baru < 0) throw new Error('Stok tidak cukup (' + id + ')');
    const { data: upd, error: e2 } = await supabaseClient.from(tabel).update({ stok: baru }).eq('id', id).eq('stok', cur.stok).select('id');
    if (e2) throw e2;
    if (upd && upd.length) return baru;
  }
  throw new Error('Stok sedang berubah, coba lagi');
}

async function catatKas(o) {
  await dbOk(supabaseClient.from('kas').insert([{ id: genId('KAS'), waktu: nowISO(), ...o }]));
}
async function catatMDR(mdr, metode, ket, refId, bankId = null) {
  if (mdr > 0) await catatKas({ jenis: 'keluar', metode, nominal: mdr, keterangan: ket, sumber: 'mdr', ref_id: refId, bank_id: bankId });
}
const normText = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

function getBankId(selectId, metode) {
  if (!metode || metode === 'tunai' || metode === 'hutang') return null;
  const el = $(selectId);
  if (el && el.value) return el.value;
  if (db.bank.length === 1) return db.bank[0].id; // otomatis pakai satu-satunya rekening
  return null;
}

function wajibBankNonTunai(selectId, metode) {
  if (!metode || metode === 'tunai' || metode === 'hutang') return { ok: true, bankId: null };
  const bankId = getBankId(selectId, metode);
  if (db.bank.length > 0 && !bankId) {
    flash('Pilih rekening bank tujuan terlebih dahulu untuk transaksi non-tunai', 'err');
    return { ok: false, bankId: null };
  }
  return { ok: true, bankId };
}

// Modal pembayaran aman (menggantikan prompt() angka 1-9 yang rawan salah ketik)
function pilihPembayaranModal({ judul, defaultNominal = null, maxNominal = null, labelNominal = 'Nominal (Rp)' }) {
  return new Promise(resolve => {
    let ov = $('modalBayarAman');
    if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'modalBayarAman';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.78);z-index:9700;display:flex;align-items:center;justify-content:center;padding:16px;';
    const gaya = 'width:100%;box-sizing:border-box;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f8fafc;font-size:14px;margin-bottom:10px;';
    const optBank = (db.bank || []).map(b => `<option value="${esc(b.id)}">${esc(b.nama)}${b.no ? ' (' + esc(b.no) + ')' : ''}</option>`).join('');
    ov.innerHTML = `
      <div style="background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:12px;max-width:420px;width:100%;padding:16px;box-shadow:0 12px 30px rgba(0,0,0,.5);">
        <h3 style="margin:0 0 10px;color:#fbbf24;font-size:14px;">💳 ${esc(judul)}</h3>
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">Metode Pembayaran</label>
        <select id="mbaMetode" style="${gaya}">
          <option value="tunai">Tunai</option>
          <option value="transfer">Transfer</option>
          <option value="qris">QRIS</option>
          <option value="edc_cc_bca">BCA Card (1,5%)</option>
          <option value="edc_cc_vm">Visa/Master/JCB (2%)</option>
          <option value="edc_cc_amex">Amex (3,25%)</option>
          <option value="edc_dc_bca">Debit BCA (0,15%)</option>
          <option value="edc_dc_lain">Debit Bank Lain (1%)</option>
          <option value="edc_dc_maestro">Maestro (2%)</option>
        </select>
        <div id="mbaWrapBank" style="display:none;">
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">Rekening Bank</label>
          <select id="mbaBank" style="${gaya}">${optBank || '<option value="">(Belum ada rekening)</option>'}</select>
        </div>
        ${defaultNominal !== null ? `
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">${esc(labelNominal)}</label>
          <input id="mbaNominal" type="number" min="1" ${maxNominal ? `max="${maxNominal}"` : ''} value="${defaultNominal}" style="${gaya}">
        ` : ''}
        <div style="display:flex;gap:8px;margin-top:6px;">
          <button id="mbaBatal" style="flex:1;padding:10px;border:none;border-radius:8px;background:#334155;color:#e2e8f0;font-weight:700;cursor:pointer;">Batal</button>
          <button id="mbaOk" style="flex:1;padding:10px;border:none;border-radius:8px;background:#16a34a;color:#fff;font-weight:700;cursor:pointer;">Lanjutkan</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const selM = $('mbaMetode'), wrapB = $('mbaWrapBank'), selB = $('mbaBank');
    const syncBank = () => { wrapB.style.display = (selM.value !== 'tunai' && db.bank.length > 0) ? 'block' : 'none'; };
    selM.onchange = syncBank;
    syncBank();
    const selesai = val => { ov.remove(); resolve(val); };
    $('mbaBatal').onclick = () => selesai(null);
    $('mbaOk').onclick = () => {
      const metode = selM.value;
      const bankId = metode === 'tunai' ? null : (selB.value || null);
      if (metode !== 'tunai' && db.bank.length > 0 && !bankId) return flash('Pilih rekening bank terlebih dahulu', 'err');
      let nominal = defaultNominal;
      if (defaultNominal !== null) {
        nominal = +($('mbaNominal').value) || 0;
        if (nominal <= 0) return flash('Nominal harus lebih dari 0', 'err');
      }
      selesai({ metode, bankId, nominal });
    };
  });
}

// Poin pelanggan: tambah / pakai. Otomatis mendaftarkan pelanggan baru.
async function updatePoin({ nama, telp, tambah = 0, pakai = 0 }) {
  const hp = (telp || '').trim(); const adaHp = hp && hp !== '-';
  if (!nama && !adaHp) return;
  let q = supabaseClient.from('pelanggan').select('*');
  q = adaHp ? q.eq('telp', hp) : q.ilike('nama', escapeLike(nama));
  const { data: ex, error } = await q.limit(1).maybeSingle();
  if (error) throw error;
  if (ex) {
    await dbOk(supabaseClient.from('pelanggan').update({ poin: Math.max(0, (ex.poin || 0) - pakai + tambah), terakhir_transaksi: nowISO() }).eq('id', ex.id));
  } else {
    await dbOk(supabaseClient.from('pelanggan').insert([{ id: genId('CUST'), nama: nama || 'Tanpa Nama', telp: adaHp ? hp : '-', poin: Math.max(0, tambah - pakai), terakhir_transaksi: nowISO() }]));
  }
}

function cariPelangganLokal(nama, telp) {
  let p = null;
  if (telp) p = db.pelanggan.find(x => x.telp === telp);
  if (!p && nama) p = db.pelanggan.find(x => (x.nama || '').toLowerCase() === nama.toLowerCase());
  return p || null;
}

// Identitas toko: pengaturan dari database, dilengkapi nilai bawaan bila kolom kosong
function getToko() {
  const s = db.settings || {};
  const t = { ...TOKO_DEFAULT, syarat_singkat: TOKO_DEFAULT.syaratSingkat };
  Object.keys(s).forEach(k => { if (s[k] !== null && s[k] !== undefined && s[k] !== '') t[k] = s[k]; });
  return t;
}

// === ROLE ===
const getRole = () => sessionStorage.getItem('ta_role');
const isPemilik = () => getRole() === 'pemilik';
const isAdmin = () => ['admin', 'pemilik'].includes(getRole());
const isKasir = () => getRole() === 'kasir';

function tentukanRole(authUser, username) {
  const meta = authUser?.app_metadata?.role;
  if (['pemilik', 'admin', 'kasir'].includes(meta)) return meta;
  if (username === 'pemilik') return 'pemilik';
  if (username === 'admin') return 'admin';
  return 'kasir';
}

function applyRoleUI() {
  const r = getRole();
  pasangUIHitungStok();
  aturTombolHitungStok();
  if (isAdmin()) pasangUIPembelian();
  if (isAdmin()) pasangUIBebanBulanan();
  const boleh = MENU_BY_ROLE[r] || [];
  SEMUA_MENU.forEach(m => {
    const b = document.querySelector(`button[onclick="bukaMenu('${m}')"]`);
    if (b) b.style.display = boleh.includes(m) ? 'flex' : 'none';
  });
  const tampil = (id, kondisi) => { const el = $(id); if (el) el.style.display = kondisi ? 'block' : 'none'; };
  tampil('cardAuditTrail', r === 'pemilik');
  ['wrapHargaBeliProduk', 'wrapHargaBeliBaterai', 'wrapHargaBeliRestock'].forEach(id => tampil(id, r === 'pemilik'));
  ['cardTambahBaterai', 'cardTambahSparePart'].forEach(id => tampil(id, r !== 'kasir'));
  document.body.classList.toggle('role-kasir', r === 'kasir');
  document.body.classList.toggle('role-admin', r === 'admin' || r === 'pemilik');
}

// Otorisasi admin/pemilik: meminta username+password, lalu MENJALANKAN RPC yang
// butuh hak admin/pemilik lewat sesi login admin yang sesungguhnya (bukan sekadar
// menandai boolean di browser). Ini penting karena RPC di server memeriksa role dari
// JWT pemanggil -- menyetujui secara lokal tidak akan mengubah apa pun di server.
function mintaOtorisasiModal(alasan) {
  return new Promise(resolve => {
    let ov = $('modalOtorisasi');
    if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'modalOtorisasi';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.82);z-index:9800;display:flex;align-items:center;justify-content:center;padding:16px;';
    const gaya = 'width:100%;box-sizing:border-box;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f8fafc;font-size:14px;margin-bottom:10px;';
    ov.innerHTML = `
      <div style="background:#1e293b;color:#f8fafc;border:1px solid #fbbf24;border-radius:12px;max-width:380px;width:100%;padding:16px;box-shadow:0 12px 30px rgba(0,0,0,.6);">
        <h3 style="margin:0 0 6px;color:#fbbf24;font-size:14px;">🔒 OTORISASI ADMIN / PEMILIK</h3>
        <div style="font-size:12px;color:#cbd5e1;margin-bottom:12px;line-height:1.4;">${esc(alasan)}</div>
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">Username</label>
        <input id="otoUser" placeholder="admin / pemilik" autocomplete="off" autocapitalize="none" style="${gaya}">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">Password (tersembunyi)</label>
        <input id="otoPass" type="password" placeholder="••••••••" autocomplete="new-password" style="${gaya}">
        <div style="display:flex;gap:8px;margin-top:6px;">
          <button id="otoBatal" style="flex:1;padding:10px;border:none;border-radius:8px;background:#334155;color:#e2e8f0;font-weight:700;cursor:pointer;">Batal</button>
          <button id="otoOk" style="flex:1;padding:10px;border:none;border-radius:8px;background:#fbbf24;color:#0f172a;font-weight:700;cursor:pointer;">Verifikasi</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const selesai = val => { ov.remove(); resolve(val); };
    const kirim = () => {
      const u = ($('otoUser').value || '').trim().toLowerCase();
      const p = $('otoPass').value || '';
      if (!u || !p) return flash('Username dan password wajib diisi', 'err');
      selesai({ u, p });
    };
    $('otoBatal').onclick = () => selesai(null);
    $('otoOk').onclick = kirim;
    $('otoPass').addEventListener('keypress', e => { if (e.key === 'Enter') kirim(); });
    $('otoUser').focus();
  });
}

async function panggilRpcDenganOtorisasi(alasan, rpcName, args) {
  const kred = await mintaOtorisasiModal(alasan);
  if (!kred) return { data: null, error: { message: 'Dibatalkan' } };
  const { u, p } = kred;

  const lib = window.supabase;
  if (!lib || !lib.createClient) return { data: null, error: { message: 'Library Supabase tidak ditemukan' } };
  const tmp = lib.createClient(supabaseClient.supabaseUrl, supabaseClient.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const { data: sesi, error: loginErr } = await tmp.auth.signInWithPassword({ email: u + '@tokoseiko.com', password: p });
    if (loginErr) return { data: null, error: { message: 'Login otorisasi gagal: ' + loginErr.message } };
    const role = tentukanRole(sesi.user, u);
    if (role !== 'admin' && role !== 'pemilik') return { data: null, error: { message: u + ' bukan Admin/Pemilik' } };

    const hasil = await tmp.rpc(rpcName, args);
    await catatLog('OTORISASI', `${alasan} - diproses oleh ${u}`);
    return hasil;
  } finally {
    try { await tmp.auth.signOut({ scope: 'local' }); } catch (_) { }
  }
}




// Mengisi field harga_beli pada db.produk/db.sparePart/db.stokBaterai dari tabel
// modal_barang, HANYA untuk admin/pemilik (get_modal_batch menolak role lain).
async function muatModalBarang() {
  try {
    const [p, sp, sb] = await Promise.all([
      supabaseClient.rpc('get_modal_batch', { p_tipe: 'produk' }),
      supabaseClient.rpc('get_modal_batch', { p_tipe: 'sparepart' }),
      supabaseClient.rpc('get_modal_batch', { p_tipe: 'stok_baterai' })
    ]);
    const map = rows => { const m = {}; (rows || []).forEach(r => { m[r.item_id] = r.harga_beli; }); return m; };
    const mp = map(p.data), msp = map(sp.data), msb = map(sb.data);
    db.produk.forEach(x => { x.harga_beli = mp[x.id] || 0; });
    db.sparePart.forEach(x => { x.harga_beli = msp[x.id] || 0; });
    db.stokBaterai.forEach(x => { x.harga_beli = msb[x.id] || 0; });
  } catch (e) { console.error('Gagal memuat modal barang:', e); }
}

// Simpan satu nilai modal lewat RPC (hanya admin/pemilik, lihat migrasi_1_modal_barang.sql)
async function simpanModal(tipe, itemId, hargaBeli) {
  const { error } = await supabaseClient.rpc('set_modal', { p_tipe: tipe, p_item_id: itemId, p_harga_beli: hargaBeli });
  if (error) throw error;
}

// Hitungan stok yang dikirim kasir hari ini (khusus admin/pemilik),
// dipakai renderAuditGlobal() untuk cross-check Sistem vs Kasir vs Admin.
db.auditDraftHariIni = {};
async function muatAuditDraftHariIni() {
  try {
    const { data, error } = await supabaseClient.rpc('get_audit_draft_hari_ini');
    if (error) throw error;
    const map = {};
    (data || []).forEach(r => { map[`${r.tipe}_${r.item_id}`] = r; });
    db.auditDraftHariIni = map;
  } catch (e) { console.error('Gagal memuat hitungan kasir:', e); db.auditDraftHariIni = {}; }
}
// 'baterai' dipakai sebagai kunci tampilan lama di renderAuditGlobal, tapi di
// database (audit_draft/modal_barang) tipe baterai selalu 'stok_baterai'.
const tipeDb = t => t === 'baterai' ? 'stok_baterai' : t;

// === CACHE FOTO PRODUK (agar tidak ditarik ulang tiap refresh & hemat egress) ===
let produkFotoCache = {};
let fotoSudahDimuat = false;

// Helper paginasi otomatis agar >1.000 baris tetap terambil penuh
async function ambilSemuaHalaman(tabel, select = '*', urut = null, asc = true, pageSize = 1000) {
  let semua = [], from = 0;
  while (true) {
    let q = supabaseClient.from(tabel).select(select).range(from, from + pageSize - 1);
    if (urut) q = q.order(urut, { ascending: asc });
    const { data, error } = await q;
    if (error) return { data: null, error };
    const rows = data || [];
    semua = semua.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return { data: semua, error: null };
}

// === AMBIL DATA DARI CLOUD (HEMAT EGRESS + DUKUNG >1.000 PRODUK) ===
async function tarikSemuaData(muatFoto = false) {
  if (!supabaseClient) return;
  try {
    const ambil = (tabel, select = '*', urut, asc = true, limit) => {
      let q = supabaseClient.from(tabel).select(select);
      if (urut) q = q.order(urut, { ascending: asc });
      if (limit) q = q.limit(limit);
      return q;
    };
    const perluFoto = muatFoto || !fotoSudahDimuat;
    const KOLOM_PRODUK = perluFoto
      ? 'id,nama,merek,barcode,harga_jual,stok,foto,updated_at'
      : 'id,nama,merek,barcode,harga_jual,stok,updated_at';
    const KOLOM_SPAREPART = 'id,nama,kategori,harga_jual,stok,min_stok,updated_at';
    const KOLOM_BATERAI = 'id,tipe,harga_jual,stok,min_stok,updated_at';
    const hasil = await Promise.all([
      supabaseClient.from('settings').select('*').eq('id', 'toko').maybeSingle(),
      ambilSemuaHalaman('produk', KOLOM_PRODUK, 'nama'),
      ambilSemuaHalaman('sparepart', KOLOM_SPAREPART, 'nama'),
      ambilSemuaHalaman('stok_baterai', KOLOM_BATERAI, 'tipe'),
      ambil('jual', '*, jual_items(*)', 'waktu', false, 500),
      ambil('servis', '*, servis_parts(*), servis_baterai(*)', 'waktu', false, 500),
      ambil('baterai', '*', 'waktu', false, 500),
      ambil('kas', '*', 'waktu', false, 1000),
      ambilSemuaHalaman('pelanggan', '*', 'nama'),
      ambil('bank'), ambil('supplier'),
      ambil('pembelian', '*', 'waktu', false, 300),
      ambil('audit_barang', '*', 'waktu', false, 300),
      ambil('audit_log', '*', 'waktu', false, 500),
      ambil('beban_tetap', '*', 'nama')
    ]);
    hasil.forEach(r => { if (r.error) console.error('Gagal tarik data:', r.error.message); });
    const [set, p, sp, sb, j, s, b, k, pel, bnk, sup, pem, aud, alog, bbt] = hasil;
    const pakai = (r, lama) => (r.error ? lama : (r.data || []));

    if (set.data) db.settings = set.data;
    const prodBaru = pakai(p, db.produk);
    if (perluFoto && !p.error) {
      fotoSudahDimuat = true;
      prodBaru.forEach(x => { if (x.foto) produkFotoCache[x.id] = x.foto; });
    } else {
      prodBaru.forEach(x => { if (!x.foto && produkFotoCache[x.id]) x.foto = produkFotoCache[x.id]; });
    }
    db.produk = prodBaru;
    db.sparePart = pakai(sp, db.sparePart);
    db.stokBaterai = pakai(sb, db.stokBaterai);
    db.jual = j.error ? db.jual : (j.data || []).map(x => ({ ...x, items: x.jual_items || [] }));
    db.servis = s.error ? db.servis : (s.data || []).map(x => ({ ...x, parts: x.servis_parts || [], baterai: x.servis_baterai || [] }));
    db.baterai = pakai(b, db.baterai);
    db.kas = pakai(k, db.kas);
    db.pelanggan = pakai(pel, db.pelanggan);
    db.bank = pakai(bnk, db.bank);
    db.supplier = pakai(sup, db.supplier);
    db.pembelian = pakai(pem, db.pembelian);
    db.auditBarang = pakai(aud, db.auditBarang);
    db.auditLog = pakai(alog, db.auditLog);
    db.bebanTetap = pakai(bbt, db.bebanTetap);
    if (isAdmin()) { await muatModalBarang(); await muatAuditDraftHariIni(); }
    render();
  } catch (e) { console.error('Gagal tarik data:', e); }
}

// === REAL-TIME SYNC ===
function jadwalRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(tarikSemuaData, 800); }

async function daftarkanSesiTunggal(userId) {
  if (!userId || !supabaseClient) return;
  try {
    // Cabut refresh token di perangkat lain (bawaan Supabase v2)
    await supabaseClient.auth.signOut({ scope: 'others' });
  } catch (_) { }
  const token = genId('SES');
  sessionStorage.setItem('ta_session_token', token);
  sessionStorage.setItem('ta_uid', userId);
  try {
    await supabaseClient.from('sesi_aktif').upsert({
      user_id: userId,
      session_token: token,
      device_info: (navigator.userAgent || '').slice(0, 120),
      updated_at: nowISO()
    });
  } catch (e) { console.warn('Tabel sesi_aktif belum dibuat (jalankan migrasi_sesi_aktif.sql):', e.message); }
}

function setupRealtime() {
  if (!supabaseClient) return;
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel = supabaseClient.channel('realtime-db');
  ['produk', 'sparepart', 'stok_baterai', 'jual', 'servis', 'baterai', 'kas', 'pelanggan'].forEach(t => {
    realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table: t }, jadwalRefresh);
  });
  // Pantau sesi_aktif: jika perangkat lain login dengan akun ini, langsung tendang!
  const uid = sessionStorage.getItem('ta_uid');
  if (uid) {
    realtimeChannel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'sesi_aktif', filter: `user_id=eq.${uid}`
    }, payload => {
      const baru = payload?.new?.session_token;
      const lokal = sessionStorage.getItem('ta_session_token');
      if (baru && lokal && baru !== lokal) {
        alert('⚠️ Akun ini baru saja login di perangkat lain.\nAnda akan dikeluarkan demi keamanan.');
        logout(true);
      }
    });
  }
  realtimeChannel.subscribe();
}

// === LOGIN & LOGOUT ===
async function login() {
  const btn = document.querySelector('#loginOverlay button');
  const setErr = m => { const el = $('loginErr'); if (el) el.textContent = m; };
  setErr('');
  if (typeof supabaseClient === 'undefined' || !supabaseClient) return setErr('Koneksi database belum siap. Muat ulang halaman.');

  const user = txt('loginUser').toLowerCase();
  const pass = $('pinInput')?.value || '';
  if (!user || !pass) return setErr('Username dan Password wajib diisi!');

  if (btn) { btn.disabled = true; btn.textContent = 'Memeriksa...'; }
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email: user + '@tokoseiko.com', password: pass });
    if (error) throw error;

    sessionStorage.setItem('ta_logged', '1');
    sessionStorage.setItem('ta_user', user);
    sessionStorage.setItem('ta_role', tentukanRole(data.user, user));
    await daftarkanSesiTunggal(data.user?.id);

    if (btn) btn.textContent = 'Memuat Data...';
    fotoSudahDimuat = false;
    await tarikSemuaData(true);
    setupRealtime();
    await catatLog('LOGIN', 'Berhasil masuk sistem');

    $('loginOverlay').classList.add('hidden');
    applyRoleUI();
    bukaMenu('home');
    flash('Login Berhasil!');
  } catch (e) {
    console.error('Gagal login:', e);
    setErr(e.message || 'Login gagal');
  } finally {
    if (btn) { btn.textContent = 'Masuk'; btn.disabled = false; }
  }
}

async function logout(paksa = false) {
  if (supabaseClient) {
    if (!paksa) await catatLog('LOGOUT', 'User keluar dari sistem');
    fotoSudahDimuat = false; produkFotoCache = {};
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
    await supabaseClient.auth.signOut();
  }
  sessionStorage.clear();
  cart = []; cartServis = []; cartBaterai = []; cartBateraiServis = []; cartServisGabungan = [];
  tempAuditData = {}; modeKlaimProdukJualId = ''; statusKlaimAktif = { multiplier: 1, tipe: 'Normal' };
  db = { produk: [], jual: [], servis: [], baterai: [], stokBaterai: [], sparePart: [], supplier: [], pembelian: [], kas: [], pelanggan: [], bank: [], auditBarang: [], settings: {}, auditLog: [], bebanTetap: [], auditDraftHariIni: {} };
  ['btnHitungStok', 'overlayHitungStok', 'overlayPembelian', 'kartuBebanBulanan', 'kartuLogoToko', 'modalOtorisasi', 'modalBayarAman'].forEach(id => { const el = $(id); if (el) el.remove(); });
  const btnPB = $('btnCatatPembelian'); if (btnPB && btnPB.parentElement) btnPB.parentElement.remove();
  if ($('userInfo')) $('userInfo').textContent = '👤';
  document.body.classList.remove('role-admin', 'role-kasir');
  $('loginOverlay').classList.remove('hidden');
  $('loginUser').value = '';
  $('pinInput').value = '';
}

function bukaMenu(tabId) {
  if (SEMUA_MENU.includes(tabId) && !(MENU_BY_ROLE[getRole()] || []).includes(tabId)) return flash('Akses ditolak.', 'err');
  document.querySelectorAll('section').forEach(x => x.classList.remove('active'));
  const target = $(tabId);
  if (target) target.classList.add('active');
  const btnBack = document.querySelector('main > div > button[onclick="bukaMenu(\'home\')"]');
  if (btnBack) btnBack.parentElement.style.display = (tabId === 'home') ? 'none' : 'block';
  window.scrollTo(0, 0);
  aturTombolHitungStok(tabId);
  render();
  if (tabId === 'setting') { isiFormSetting(true); muatPrefApiSetting(); if (isPemilik()) { pasangUILogoSetting(); renderPreviewLogo(); } }
}

// === PRODUK & STOK ===
async function simpanProduk() {
  if (!isAdmin()) return flash('Akses ditolak. Hanya Admin yang bisa mengubah produk.', 'err');
  if (!checkRequired(['pNama', 'pHJual'])) return flash('Lengkapi kolom wajib', 'err');

  const id = txt('pId'), nama = txt('pNama'), merek = txt('pMerek'), barcode = txt('pSerial');
  const hargaBeli = num('pHBeli'), hargaJual = num('pHJual'), stokInput = num('pStok');
  if (hargaBeli < 0 || hargaJual < 0 || stokInput < 0) return flash('Harga/stok tidak boleh negatif', 'err');

  const existing = id ? null : db.produk.find(p => p.nama.toLowerCase() === nama.toLowerCase() && (p.merek || '').toLowerCase() === merek.toLowerCase());
  const targetId = id || existing?.id;
  if (barcode && db.produk.some(p => p.barcode === barcode && p.id !== targetId)) return flash('Barcode sudah dipakai produk lain', 'err');

  try {
    if (id) {
      const data = { nama, merek, barcode, harga_jual: hargaJual, stok: stokInput, updated_at: nowISO() };
      if (tempFotoBase64) data.foto = tempFotoBase64;
      await dbOk(supabaseClient.from('produk').update(data).eq('id', id));
      if (isPemilik()) await simpanModal('produk', id, hargaBeli);
      flash('Produk diperbarui');
    } else if (existing) {
      const totalStok = existing.stok + stokInput;
      const hppLama = existing.harga_beli || 0;
      const hppBaru = totalStok > 0 ? Math.round(((existing.stok * hppLama) + (stokInput * hargaBeli)) / totalStok) : hargaBeli;
      const data = { stok: totalStok, harga_jual: hargaJual, updated_at: nowISO() };
      if (barcode && !existing.barcode) data.barcode = barcode;
      if (tempFotoBase64) data.foto = tempFotoBase64;
      await dbOk(supabaseClient.from('produk').update(data).eq('id', existing.id));
      if (isPemilik()) await simpanModal('produk', existing.id, hppBaru);
      flash(`Stok ${nama} berhasil ditambahkan (Total: ${totalStok})`);
    } else {
      const newId = genId('PRD');
      const data = { id: newId, nama, merek, barcode, harga_jual: hargaJual, stok: stokInput, updated_at: nowISO() };
      if (tempFotoBase64) data.foto = tempFotoBase64;
      await dbOk(supabaseClient.from('produk').insert([data]));
      if (isPemilik()) await simpanModal('produk', newId, hargaBeli);
      flash('Produk baru ditambahkan');
    }
    await catatLog('PRODUK', (id ? 'Edit' : 'Tambah/Restock') + ' produk: ' + nama);
    const adaFotoBaru = !!tempFotoBase64;
    resetFormProduk();
    tarikSemuaData(adaFotoBaru);
  } catch (e) { flash('Gagal menyimpan produk: ' + e.message, 'err'); }
}

function resetFormProduk() {
  ['pId', 'pNama', 'pMerek', 'pHBeli', 'pHJual', 'pStok', 'pSerial', 'pFoto'].forEach(x => { if ($(x)) $(x).value = ''; });
  tempFotoBase64 = '';
}

function editProduk(id) {
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  const p = db.produk.find(x => x.id === id);
  if (!p) return;
  $('pId').value = p.id; $('pNama').value = p.nama; $('pMerek').value = p.merek || '';
  $('pHBeli').value = isPemilik() ? (p.harga_beli || '') : '';
  $('pHJual').value = p.harga_jual; $('pStok').value = p.stok; $('pSerial').value = p.barcode || '';
  window.scrollTo(0, 0);
}

async function hapusProduk(id) {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa menghapus produk', 'err');
  if (!confirm('Hapus produk ini?')) return;
  try {
    await dbOk(supabaseClient.from('produk').delete().eq('id', id));
    await catatLog('HAPUS_PRODUK', 'Menghapus produk ID: ' + id);
    flash('Dihapus');
    tarikSemuaData();
  } catch (e) { flash('Gagal menghapus (produk mungkin sudah ada di transaksi): ' + e.message, 'err'); }
}

async function prosesRestock() {
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  const tipe = $('rsTipe').value, id = $('rsItem').value;
  const qty = Math.floor(num('rsQty')), hargaBaru = num('rsHarga');
  if (!id || qty < 1 || hargaBaru < 0) return flash('Data tidak valid', 'err');

  let item, tabel;
  if (tipe === 'produk') { item = db.produk.find(x => x.id == id); tabel = 'produk'; }
  else if (tipe === 'sparepart') { item = db.sparePart.find(x => x.id == id); tabel = 'sparepart'; }
  else { item = db.stokBaterai.find(x => x.id == id); tabel = 'stok_baterai'; }
  if (!item) return flash('Item tidak ditemukan', 'err');

  const namaItem = item.nama || item.tipe;
  const stokLama = item.stok || 0, hppLama = item.harga_beli || 0, totalStok = stokLama + qty;
  const hppBaru = totalStok > 0 ? Math.round((stokLama * hppLama + qty * hargaBaru) / totalStok) : hargaBaru;

  try {
    await ubahStok(tabel, id, qty);
    await simpanModal(tipeDb(tipe), id, hppBaru); // 'baterai' (dropdown) -> 'stok_baterai' (tabel modal_barang)

    const pemId = genId('BLI');
    await dbOk(supabaseClient.from('pembelian').insert([{ id: pemId, waktu: nowISO(), supplier_nama: 'Manual', total: qty * hargaBaru, status: 'lunas', metode: 'tunai' }]));
    if (qty * hargaBaru > 0) {
      await catatKas({ jenis: 'keluar', metode: 'tunai', nominal: qty * hargaBaru, keterangan: `Restock ${namaItem}`, sumber: 'pembelian', ref_id: pemId });
    }
    await catatLog('RESTOCK', `Restock ${qty} ${namaItem} (Modal: ${rp(qty * hargaBaru)})`);
    flash(`Berhasil restock ${qty} ${namaItem}`);
    $('rsQty').value = 1; $('rsHarga').value = 0;
    tarikSemuaData();
  } catch (e) { flash('Gagal restock: ' + e.message, 'err'); }
}


async function lunasiHutang(id) {
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  const p = db.pembelian.find(x => x.id === id);
  if (!p || p.status !== 'hutang') return flash('Hutang tidak ditemukan / sudah lunas', 'err');
  const bayar = await pilihPembayaranModal({ judul: `Lunasi Hutang ${p.supplier_nama} (${rp(p.total)})` });
  if (!bayar) return;
  try {
    // Atomik di server: status hutang dikunci, jadi tidak bisa dibayar dua kali
    const { error } = await supabaseClient.rpc('lunasi_hutang', { p_id: id, p_metode: bayar.metode, p_bank_id: bayar.bankId });
    if (error) throw error;
    flash('Hutang dilunasi');
    tarikSemuaData();
  } catch (e) { flash('Gagal melunasi hutang: ' + e.message, 'err'); tarikSemuaData(); }
}

// === TRANSAKSI KASIR (JUAL) ===
function addCart() {
  const id = $('selProduk').value, qty = Math.floor(num('qty'));
  const p = db.produk.find(x => x.id === id);
  if (!p) return flash('Pilih produk', 'err');
  if (qty < 1) return flash('Qty tidak valid', 'err');
  const existing = cart.find(c => c.id === id);
  if ((existing?.qty || 0) + qty > p.stok) return flash('Stok tidak cukup', 'err');
  if (existing) existing.qty += qty; else cart.push({ id, nama: p.nama, harga: p.harga_jual, qty });
  $('qty').value = 1;
  renderCart();
}
function hapusCart(i) { cart.splice(i, 1); renderCart(); }

function renderCart() {
  $('cartList').innerHTML = cart.length
    ? cart.map((c, i) => {
        const p = db.produk.find(x => x.id === c.id);
        const thumb = p && p.foto
          ? `<img src="${p.foto}" style="width:44px;height:44px;object-fit:contain;border-radius:8px;border:1px solid #cbd5e1;background:#f8fafc;flex-shrink:0;">`
          : `<div style="width:44px;height:44px;border-radius:8px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">⌚</div>`;
        return `<div class="cart-item" style="gap:10px;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
            ${thumb}
            <div style="min-width:0;">
              <strong style="font-size:15px;color:#0f1f3d;display:block;">${esc(c.nama)}</strong>
              <small style="color:#475569;font-weight:600;">${c.qty} × ${rp(c.harga)} = <b style="color:#b45309">${rp(c.harga * c.qty)}</b></small>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
            <button type="button" class="btn-sm ghost" onclick="ubahQtyCart(${i},-1)" style="padding:4px 10px;min-height:34px;">−</button>
            <button type="button" class="btn-sm ghost" onclick="ubahQtyCart(${i},1)" style="padding:4px 10px;min-height:34px;">+</button>
            <button type="button" class="btn-sm danger" onclick="hapusCart(${i})" style="padding:4px 10px;min-height:34px;">✕</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">Belum ada item dipilih</div>';
  updateTotalKasir();
}

// Satu sumber perhitungan untuk tampilan & pembayaran
function hitungTotalKasir() {
  const subtotal = cart.reduce((s, c) => s + c.harga * c.qty, 0);
  const tipe = $('tipeDiskon')?.value || 'nominal';
  const nilai = Math.max(0, num('nilaiDiskon'));
  let potongan = tipe === 'nominal' ? nilai : subtotal * Math.min(nilai, 100) / 100;
  potongan = Math.min(Math.round(potongan), subtotal);
  const setelahDiskon = subtotal - potongan;
  const pel = cariPelangganLokal(txt('custNama'), txt('custHp'));
  const saldo = pel ? (pel.poin || 0) : 0;
  const maxPoin = Math.min(saldo, Math.floor(setelahDiskon / NILAI_POIN));
  const tukarInput = Math.max(0, Math.floor(num('tukarPoin')));
  const tukarPoin = Math.min(tukarInput, maxPoin);
  const potonganPoin = tukarPoin * NILAI_POIN;
  return { subtotal, tipe, nilai, potongan, saldo, maxPoin, tukarInput, tukarPoin, potonganPoin, total: setelahDiskon - potonganPoin };
}

function updateTotalKasir() {
  const h = hitungTotalKasir();
  const metode = $('metodeBayar')?.value || 'tunai';
  const mdr = hitungMDR(h.total, metode);
  $('cartTotal').innerHTML = `
    <div class="cs-row"><span>Subtotal</span><b>${rp(h.subtotal)}</b></div>
    ${h.potongan > 0 ? `<div class="cs-row" style="color:#b91c1c;"><span>Diskon</span><b>-${rp(h.potongan)}</b></div>` : ''}
    ${h.potonganPoin > 0 ? `<div class="cs-row" style="color:#b45309;"><span>Tukar Poin</span><b>-${rp(h.potonganPoin)}</b></div>` : ''}
    <div class="cs-row total"><span>TOTAL BAYAR</span><span>${rp(h.total)}</span></div>`;
  const el = $('mdrInfo'), netEl = $('netTerimaInfo');
  if (el) {
    if (mdr > 0) {
      el.style.display = 'flex'; $('mdrValue').textContent = '-' + rp(mdr);
      if (netEl) { netEl.style.display = 'flex'; $('netTerimaValue').textContent = rp(Math.max(0, h.total - mdr)); }
    } else {
      el.style.display = 'none';
      if (netEl) netEl.style.display = 'none';
    }
  }
  const wrapTunai = $('wrapTunaiKasir');
  if (wrapTunai) wrapTunai.style.display = metode === 'tunai' ? 'block' : 'none';
}

async function prosesBayar() {
  if (isProcessingPayment) return flash('Transaksi sedang diproses, mohon tunggu...', 'err');
  if (!cart.length) return flash('Keranjang kosong', 'err');

  const h = hitungTotalKasir();
  const metode = $('metodeBayar').value;
  const bayar = num('bayar');
  if (h.tukarInput > h.maxPoin) return flash(`Poin melebihi batas (maksimal ${h.maxPoin} poin)`, 'err');
  if (metode === 'tunai' && bayar < h.total) return flash('Uang kurang', 'err');

  const cekBank = wajibBankNonTunai('bankKasir', metode);
  if (!cekBank.ok) return;

  isProcessingPayment = true;
  const btn = document.querySelector('button[onclick="prosesBayar()"]');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Memproses...'; }

  try {
    const bankId = cekBank.bankId;
    const cNama = formatNama(txt('custNama')), cHp = txt('custHp');
    const items = cart.map(c => ({ produk_id: c.id, qty: c.qty }));

    // Satu panggilan atomik: harga, stok, diskon, poin, dan MDR semua dihitung ULANG
    // di server (lihat rpc_penjualan.sql), bukan dipercaya dari browser.
    const rpcArgs = {
      p_items: items, p_metode: metode, p_bayar: metode === 'tunai' ? bayar : h.total,
      p_diskon_tipe: h.tipe, p_diskon_nilai: h.nilai, p_tukar_poin: h.tukarPoin,
      p_cust_nama: cNama || null, p_cust_hp: cHp || null, p_bank_id: bankId,
      p_garansi_hari: num('garansiHari')
    };
    const rpcResult = await supabaseClient.rpc('proses_penjualan', rpcArgs);
    let data = rpcResult.data, error = rpcResult.error;
    if (error && /melebihi batas kasir/i.test(error.message) && isKasir()) {
      // Diskon di atas batas: kasir tidak bisa memprosesnya sendiri. Admin/pemilik
      // memasukkan password, dan transaksi BENAR-BENAR dijalankan oleh RPC sebagai admin.
      const ulang = await panggilRpcDenganOtorisasi(error.message, 'proses_penjualan', rpcArgs);
      data = ulang.data; error = ulang.error;
    }
    if (error) throw error;

    const trxHeader = {
      id: data.id, waktu: nowISO(), subtotal: data.subtotal, diskon: data.diskon, total: data.total,
      bayar: metode === 'tunai' ? bayar : data.total, kembali: metode === 'tunai' ? (bayar - data.total) : 0,
      metode, cust_nama: cNama, cust_hp: cHp, poin_dipakai: h.tukarPoin, poin_didapat: data.poin_didapat,
      items: data.items.map(i => ({ jual_id: data.id, produk_id: i.produk_id, nama: i.nama, harga: i.harga, qty: i.qty }))
    };
    db.jual.unshift(trxHeader);
    flash('Transaksi berhasil');
    try { cetakStruk(data.id); } catch (e) { console.error(e); flash('Transaksi tersimpan, tetapi struk gagal dicetak: ' + e.message, 'err'); }

    cart = [];
    ['custNama', 'custHp'].forEach(x => { if ($(x)) $(x).value = ''; });
    ['bayar', 'nilaiDiskon', 'tukarPoin', 'infoPoin'].forEach(x => { if ($(x)) $(x).value = 0; });
    renderCart();
    tarikSemuaData();
  } catch (e) {
    flash('Gagal: ' + e.message, 'err');
  } finally {
    isProcessingPayment = false;
    if (btn) { btn.disabled = false; btn.innerHTML = 'Proses & Cetak Struk'; }
  }
}

function cetakStruk(trxId) {
  const t = db.jual.find(x => x.id === trxId);
  if (!t) return;
  const toko = getToko();
  const itemsHTML = (t.items || []).map(i => `<tr>
      <td style="font-size:10px">${esc(i.nama)}<br>${i.qty} x ${(i.harga || 0).toLocaleString('id-ID')}</td>
      <td style="text-align:right; font-size:10px">${(i.qty * i.harga).toLocaleString('id-ID')}</td></tr>`).join('');
  const poinRow = t.poin_dipakai > 0 ? `<tr><td>Tukar Poin (${t.poin_dipakai})</td><td style="text-align:right">-${(t.poin_dipakai * NILAI_POIN).toLocaleString('id-ID')}</td></tr>` : '';

  cetakHTML(`<html><head><meta charset="UTF-8"><style>@page{margin:0}body{font-family:'Courier New',monospace;font-size:11px;width:58mm;margin:auto;padding:4px}.c{text-align:center}.b{font-weight:bold}hr{border:none;border-top:1px dashed #000;margin:4px 0}table{width:100%}</style></head><body>
    ${headerLogo(toko)}<div class="c b" style="font-size:12px">${esc(toko.nama)}</div>
    <div class="c">${esc(toko.alamat)}</div><hr>
    <div>No: ${esc(t.id)}</div>
    <div>Tgl: ${new Date(t.waktu).toLocaleString('id-ID')}</div>
    <div>Kasir: ${esc(sessionStorage.getItem('ta_user') || 'Admin')}</div>
    <div>Pembeli: ${esc(t.cust_nama || '-')}</div><hr>
    <table>${itemsHTML}</table><hr>
    <table>
      <tr><td>Subtotal</td><td style="text-align:right">${(t.subtotal || 0).toLocaleString('id-ID')}</td></tr>
      <tr><td>Diskon</td><td style="text-align:right">-${(t.diskon || 0).toLocaleString('id-ID')}</td></tr>
      ${poinRow}
      <tr><td class="b">TOTAL</td><td class="b" style="text-align:right">${(t.total || 0).toLocaleString('id-ID')}</td></tr>
      <tr><td>Bayar (${esc(labelMetode(t.metode))})</td><td style="text-align:right">${(t.bayar || 0).toLocaleString('id-ID')}</td></tr>
      <tr><td>Kembali</td><td style="text-align:right">${(t.kembali || 0).toLocaleString('id-ID')}</td></tr>
    </table><hr>
    <div class="c" style="font-size:9px;">${esc(toko.footer)}</div>
  </body></html>`);
}

function cekPoinPelanggan(nama) {
  const info = $('infoPoin'), inputPoin = $('tukarPoin');
  if (!info) return;
  const telp = txt('custHp');
  const p = cariPelangganLokal(nama, telp);
  if (p) {
    info.value = p.poin || 0;
    if (inputPoin) inputPoin.max = p.poin || 0;
    if (nama && !telp && p.telp && /\d/.test(p.telp)) $('custHp').value = p.telp;
  } else {
    info.value = 0;
    if (inputPoin) { inputPoin.value = 0; inputPoin.max = 0; }
  }
  updateTotalKasir();
}

// === SERVIS ===
function addPartServis() {
  const id = $('selSparePart').value, qty = Math.floor(num('qtyPart'));
  const sp = db.sparePart.find(x => x.id === id);
  if (!sp || qty < 1) return flash('Data tidak valid', 'err');
  const existing = cartServis.find(c => c.id === id);
  if ((existing?.qty || 0) + qty > sp.stok) return flash('Stok tidak cukup', 'err');
  if (existing) existing.qty += qty; else cartServis.push({ id: sp.id, nama: sp.nama, harga: sp.harga_jual, qty });
  $('qtyPart').value = 1;
  renderServisCart(); hitungTotalServis();
}
function hapusPartServis(i) { cartServis.splice(i, 1); renderServisCart(); hitungTotalServis(); }

function renderServisCart() {
  $('cartServisList').innerHTML = cartServis.length
    ? cartServis.map((c, i) => `<div class="cart-item"><div><strong>${esc(c.nama)}</strong> x${c.qty}<br><small>${rp(c.harga * c.qty)}</small></div><button class="btn-sm danger" onclick="hapusPartServis(${i})">Batal</button></div>`).join('')
    : '<div class="empty">Belum ada part</div>';
  $('cartServisTotal').textContent = rp(cartServis.reduce((s, c) => s + c.harga * c.qty, 0));
}

function addBateraiServis() {
  const id = $('selBateraiServis').value, qty = Math.floor(num('qtyBaterai'));
  const sb = db.stokBaterai.find(x => x.id === id);
  if (!sb || qty < 1) return flash('Data tidak valid', 'err');
  const existing = cartBateraiServis.find(c => c.id === id);
  if ((existing?.qty || 0) + qty > sb.stok) return flash('Stok tidak cukup', 'err');
  if (existing) existing.qty += qty; else cartBateraiServis.push({ id: sb.id, nama: sb.tipe, harga: sb.harga_jual, qty });
  $('qtyBaterai').value = 1;
  renderBateraiServisCart(); hitungTotalServis();
}
function hapusBateraiServis(i) { cartBateraiServis.splice(i, 1); renderBateraiServisCart(); hitungTotalServis(); }

function renderBateraiServisCart() {
  const el = $('cartBateraiServisList'), totalEl = $('cartBateraiServisTotal');
  if (el) {
    el.innerHTML = cartBateraiServis.length
      ? cartBateraiServis.map((c, i) => `<div class="cart-item"><div><strong>${esc(c.nama)}</strong> x${c.qty}<br><small>${rp(c.harga * c.qty)}</small></div><button class="btn-sm danger" onclick="hapusBateraiServis(${i})">Batal</button></div>`).join('')
      : '<div class="empty">Belum ada baterai</div>';
  }
  if (totalEl) totalEl.textContent = rp(cartBateraiServis.reduce((s, c) => s + c.harga * c.qty, 0));
}

function hitungTotalServis() {
  const isKlaim = !!txt('sParentId');
  const garansi = $('sGaransi')?.value;
  const gratisJasa = isKlaim || garansi === 'garansi';
  const jasa = gratisJasa ? 0 : num('sJasa');
  const totalParts = cartServis.reduce((s, c) => s + c.harga * c.qty, 0);
  const totalBaterai = cartBateraiServis.reduce((s, c) => s + c.harga * c.qty, 0);
  const totalBiaya = jasa + totalParts + totalBaterai;
  const label = isKlaim ? `${rp(totalBiaya)} (Klaim)` : (gratisJasa ? `${rp(totalBiaya)} (Jasa Gratis)` : rp(totalBiaya));
  const dp = num('sDp');
  if ($('sTotalBiaya')) $('sTotalBiaya').value = label;
  if ($('sSisa')) $('sSisa').value = rp(Math.max(0, totalBiaya - dp));
  if ($('sTotalBiayaDisplay')) $('sTotalBiayaDisplay').innerText = label;
}

// 1. Masukkan jam ke list keranjang
function tambahKeKeranjangServis() {
  if (!checkRequired(['sNama', 'sProduk'])) return flash('Lengkapi Nama dan Produk', 'err');

  const customer = formatNama($('sNama').value), telp = txt('sHp');
  const listKondisi = Array.from(document.querySelectorAll('.chk-kondisi:checked')).map(cb => cb.value);
  const kondisiLain = txt('sKondisiLain');
  if (kondisiLain) listKondisi.push(kondisiLain);
  const kondisiFisik = listKondisi.length ? listKondisi.join(', ') : '-';

  const produk = txt('sProduk'), keluhan = txt('sKeluhan'), catatan = txt('sCatatan');
  const garansi = $('sGaransi').value;
  const parentId = txt('sParentId');
  const isKlaim = !!parentId;
  const isKlaimProduk = !!modeKlaimProdukJualId;
  const parentJualId = modeKlaimProdukJualId;

  if (isKlaim) {
    const parent = db.servis.find(x => x.id === parentId);
    const terpakai = (parent?.klaim_count || 0) + cartServisGabungan.filter(i => i.parentId === parentId).length;
    if (!parent || !bisaKlaimGaransi(parent) || terpakai >= MAX_KLAIM_SERVIS) return flash('Kuota klaim garansi untuk nota ini sudah habis', 'err');
  }
  if (isKlaimProduk) {
    const jualInduk = db.jual.find(x => x.id === parentJualId);
    const terpakai = db.servis.filter(s => s.parent_jual_id === parentJualId && s.is_klaim_produk).length
      + cartServisGabungan.filter(i => i.parentJualId === parentJualId).length;
    if (!jualInduk || terpakai >= MAX_KLAIM_SERVIS) return flash('Kuota klaim garansi produk untuk nota ini sudah habis', 'err');
  }

  const jasa = (isKlaim || isKlaimProduk || garansi === 'garansi') ? 0 : num('sJasa');
  const totalParts = cartServis.reduce((s, c) => s + c.harga * c.qty, 0);
  const totalBaterai = cartBateraiServis.reduce((s, c) => s + c.harga * c.qty, 0);
  const biayaPelanggan = jasa + totalParts + totalBaterai;

  cartServisGabungan.push({
    customer, telp, produk, keluhan, catatan, kondisiFisik, garansi, isKlaim, parentId,
    isKlaimProduk, parentJualId,
    jasa, totalParts, totalBaterai, biayaPelanggan,
    parts: [...cartServis], baterai: [...cartBateraiServis]
  });

  renderKeranjangServis();

  // Reset form per-jam (nama & HP dibiarkan), termasuk mode klaim agar tidak menular ke jam berikutnya
  ['sProduk', 'sKeluhan', 'sCatatan'].forEach(x => { if ($(x)) $(x).value = ''; });
  $('sJasa').value = 0;
  $('sGaransi').value = 'garansi';
  resetModeKlaim();
  if (isKlaimProduk) { modeKlaimProdukJualId = ''; const b = $('klaimBanner'); if (b) b.style.display = 'none'; }
  document.querySelectorAll('.chk-kondisi').forEach(cb => cb.checked = false);
  if ($('sKondisiLain')) $('sKondisiLain').value = '';

  cartServis = []; cartBateraiServis = [];
  renderServisCart(); renderBateraiServisCart(); hitungTotalServis();
  window.scrollTo(0, 0);
  flash('Jam berhasil ditambahkan ke list');
}

// 2. Tampilkan list
function renderKeranjangServis() {
  const card = $('cardKeranjangServis'), cardBayar = $('cardPembayaranServis'), list = $('listKeranjangServis');
  if (!cartServisGabungan.length) {
    if (card) card.style.display = 'none';
    if (cardBayar) cardBayar.style.display = 'none';
    if ($('srvEmptyHint')) $('srvEmptyHint').style.display = 'block';
    if ($('sTotalBiayaDisplay')) $('sTotalBiayaDisplay').innerText = 'Rp 0';
    return;
  }
  if ($('srvEmptyHint')) $('srvEmptyHint').style.display = 'none';
  if (card) card.style.display = 'block';
  if (cardBayar) cardBayar.style.display = 'block';
  if (list) {
    list.innerHTML = cartServisGabungan.map((item, index) => `
      <div class="item-servis-cart">
        <div class="info">
          <strong>${index + 1}. ${esc(item.produk)}${item.isKlaim ? ' (Klaim)' : ''}</strong><br>
          Keluhan: ${esc(item.keluhan || '-')} | Biaya: ${rp(item.biayaPelanggan)}
        </div>
        <button class="btn-sm danger" onclick="hapusItemKeranjangServis(${index})">X</button>
      </div>`).join('');
  }
  updateTotalGroupServis();
}

// 3. Total & DP gabungan
function updateTotalGroupServis() {
  const grandTotal = cartServisGabungan.reduce((s, item) => s + item.biayaPelanggan, 0);
  const dpGroup = Math.min(Math.max(0, num('sDpGroup')), grandTotal);
  if ($('sTotalBiayaGroup')) $('sTotalBiayaGroup').value = rp(grandTotal);
  if ($('sSisaGroup')) $('sSisaGroup').value = rp(Math.max(0, grandTotal - dpGroup));
  if ($('sTotalBiayaDisplay')) $('sTotalBiayaDisplay').innerText = rp(grandTotal);

  const metodeDp = $('metodeDpGroup')?.value || 'tunai';
  const mdrDp = hitungMDR(dpGroup, metodeDp);
  const elMdr = $('mdrDpInfo');
  if (elMdr) {
    if (mdrDp > 0) { elMdr.style.display = 'flex'; $('mdrDpValue').textContent = '-' + rp(mdrDp); }
    else elMdr.style.display = 'none';
  }
}

function hapusItemKeranjangServis(index) { cartServisGabungan.splice(index, 1); renderKeranjangServis(); }

// Kosongkan list TANPA konfirmasi (dipakai setelah simpan berhasil)
function resetKeranjangServis() {
  cartServisGabungan = [];
  if ($('sDpGroup')) $('sDpGroup').value = 0;
  renderKeranjangServis();
}
function batalKeranjangServis() {
  if (!confirm('Kosongkan semua list servis?')) return;
  resetKeranjangServis();
}

// 6. Simpan semua servis ke database & cetak nota
async function simpanSemuaServis() {
  if (isSavingServis) return;
  if (!cartServisGabungan.length) return flash('List kosong. Klik "Tambah Jam Ini ke List".', 'err');

  const btn = document.querySelector('.sticky-bottom-bar .btn-simpan');
  isSavingServis = true;
  if (btn) { btn.innerHTML = 'Memproses...'; btn.disabled = true; }

  const grandTotal = cartServisGabungan.reduce((s, item) => s + item.biayaPelanggan, 0);
  const dpGroup = Math.min(Math.max(0, num('sDpGroup')), grandTotal);
  const metodeDp = $('metodeDpGroup')?.value || 'tunai';
  let bankId = null;
  if (dpGroup > 0) {
    const cekBank = wajibBankNonTunai('bankDp', metodeDp);
    if (!cekBank.ok) { isSavingServis = false; if (btn) { btn.innerHTML = '💾 Proses & Cetak'; btn.disabled = false; } return; }
    bankId = cekBank.bankId;
  }

  const items = cartServisGabungan.map(item => ({
    customer: item.customer, telp: item.telp, produk: item.produk, keluhan: item.keluhan,
    catatan: item.catatan, kondisi_fisik: item.kondisiFisik, garansi: item.garansi,
    is_klaim: item.isKlaim, parent_id: item.parentId || null, jasa: item.jasa,
    is_klaim_produk: !!item.isKlaimProduk, parent_jual_id: item.parentJualId || null,
    parts: item.parts.map(c => ({ id: c.id, nama: c.nama, harga: c.harga, qty: c.qty })),
    baterai: item.baterai.map(c => ({ id: c.id, nama: c.nama, harga: c.harga, qty: c.qty }))
  }));

  try {
    // Satu panggilan atomik: insert servis + parts + baterai, potong stok,
    // catat DP & MDR, tambah poin, dan cek kuota klaim -- lihat rpc_servis.sql
    const rpcArgs = { p_items: items, p_dp: dpGroup, p_metode_dp: metodeDp, p_bank_id: bankId };
    let { data, error } = await supabaseClient.rpc('proses_simpan_servis', rpcArgs);
    if (error && /persetujuan Admin\/Pemilik/i.test(error.message) && isKasir()) {
      // Klaim garansi produk yang sudah lewat tanggal: RPC menolak kasir.
      // Admin/pemilik memasukkan password, transaksi BENAR-BENAR diproses
      // lewat sesi admin (bukan sekadar ditandai di browser).
      const ulang = await panggilRpcDenganOtorisasi(error.message, 'proses_simpan_servis', rpcArgs);
      data = ulang.data; error = ulang.error;
    }
    if (error) throw error;

    await catatLog('SERVIS_GABUNGAN', `Menyimpan ${items.length} servis untuk ${items[0].customer}`);
    flash('Semua servis berhasil disimpan!');
    const hasilCetak = data.items.map((h, i) => ({ ...items[i], srvId: h.id, dpAlokasi: h.dp, sisaAlokasi: h.sisa, biayaPelanggan: h.biaya_pelanggan }));
    try { cetakNotaGabunganServisByData(hasilCetak, data.group_id, dpGroup); } catch (e) { console.error(e); flash('Servis tersimpan, tetapi nota gagal dicetak: ' + e.message, 'err'); }
    resetKeranjangServis();
    ['sNama', 'sHp'].forEach(x => { if ($(x)) $(x).value = ''; });
    tarikSemuaData();
  } catch (e) {
    flash('Gagal: ' + e.message, 'err');
  } finally {
    isSavingServis = false;
    if (btn) { btn.innerHTML = '💾 Simpan Servis'; btn.disabled = false; }
  }
}


// 7. Nota gabungan dari data keranjang
function cetakNotaGabunganServisByData(listData, groupId, dpGroup = 0) {
  const toko = getToko();
  const customer = listData[0].customer, telp = listData[0].telp;
  const totalBiaya = listData.reduce((s, x) => s + x.biayaPelanggan, 0);
  const totalSisa = listData.reduce((s, x) => s + (x.sisaAlokasi ?? x.biayaPelanggan), 0);
  const link = linkLacak('group_id', groupId);

  const itemsHTML = listData.map((s, idx) => `
      <div style="margin-bottom:6px; font-size:10px; border-bottom:1px dotted #ccc; padding-bottom:4px;">
        <b>${idx + 1}. ${esc(s.produk)}</b><br>
        Keluhan: ${esc(s.keluhan || '-')}<br>
        Biaya: Rp ${(s.biayaPelanggan || 0).toLocaleString('id-ID')}
      </div>`).join('');

  cetakHTML(`<html><head><meta charset="UTF-8"><style>@page{margin:0}body{font-family:'Courier New',monospace;font-size:11px;width:58mm;margin:auto;padding:4px}.c{text-align:center}.b{font-weight:bold}hr{border:none;border-top:1px dashed #000;margin:4px 0}</style></head><body>
  ${headerLogo(toko)}<div class="c b" style="font-size:12px">${esc(toko.nama)}</div>
  <div class="c b">NOTA SERVIS GABUNGAN</div><hr>
  <div>Pelanggan: ${esc(customer)}</div>
  <div>No HP: ${esc(telp)}</div>
  <div>Tgl: ${new Date().toLocaleString('id-ID')}</div><hr>
  <div class="b">Daftar Barang (${listData.length} item):</div>
  ${itemsHTML}<hr>
  <table style="width:100%">
    <tr><td class="b">TOTAL BIAYA</td><td class="b" style="text-align:right">Rp ${totalBiaya.toLocaleString('id-ID')}</td></tr>
    <tr><td>DP</td><td style="text-align:right">Rp ${dpGroup.toLocaleString('id-ID')}</td></tr>
    <tr><td class="b">SISA TAGIHAN</td><td class="b" style="text-align:right">Rp ${totalSisa.toLocaleString('id-ID')}</td></tr>
  </table><hr>
  <div class="c" style="margin-top: 8px;">
    <div style="font-size:9px;">Scan untuk lacak status servis:</div>
    <img src="${qrUrl(link)}" width="80" height="80">
  </div>
  <div class="c" style="font-size:9px; margin-top:4px; word-break:break-all;">${esc(link)}</div>
  <div class="c" style="margin-top:6px">Simpan nota ini</div></body></html>`);
}

async function bayarSisaServis(id) {
  const s = db.servis.find(x => x.id === id);
  if (!s || s.sisa <= 0) return;

  const res = await pilihPembayaranModal({
    judul: `Pelunasan Servis ${s.id} (Sisa: ${rp(s.sisa)})`,
    defaultNominal: s.sisa,
    maxNominal: s.sisa,
    labelNominal: 'Nominal Bayar (Rp)'
  });
  if (!res) return;

  try {
    const { data, error } = await supabaseClient.rpc('bayar_sisa_servis_aman', {
      p_id: id, p_nominal: res.nominal, p_metode: res.metode, p_bank_id: res.bankId
    });
    if (error) throw error;
    flash(data?.paid ? 'LUNAS' : `Sisa ${rp(data?.sisa ?? 0)}`);
    tarikSemuaData();
  } catch (e) {
    if (/bayar_sisa_servis_aman/i.test(e.message || '')) {
      return flash('Jalankan migrasi_perbaikan_keamanan.sql di Supabase terlebih dahulu.', 'err');
    }
    flash('Gagal melunasi: ' + e.message, 'err');
    tarikSemuaData();
  }
}

async function ubahStatusServis(id) {
  const s = db.servis.find(x => x.id === id);
  if (!s) return;
  if (s.status === 'diambil') return flash('Servis sudah diambil, status tidak bisa diubah kembali.', 'err');

  const flow = ['antri', 'proses', 'selesai', 'diambil'];
  const nextStatus = flow[flow.indexOf(s.status) + 1];
  if (nextStatus === 'diambil' && !s.paid && s.sisa > 0) return flash('Lunasi sisa tagihan dulu sebelum jam diambil.', 'err');

  const updateData = { status: nextStatus };
  if (nextStatus === 'selesai' && !s.tgl_selesai) {
    const bulan = +(db.settings.garansi_servis_bulan ?? 3);
    updateData.tgl_selesai = nowISO();
    updateData.garansi_servis_bulan = bulan;
    updateData.tgl_garansi_servis_sampai = tambahBulan(tglLokal(), bulan);
  }
  try {
    await dbOk(supabaseClient.from('servis').update(updateData).eq('id', id));
    await catatLog('STATUS_SERVIS', `Ubah status ${s.id} menjadi ${nextStatus}`);
    flash(`Status menjadi ${nextStatus}`);
    tarikSemuaData();
  } catch (e) { flash('Gagal ubah status: ' + e.message, 'err'); }
}

async function hapusServis(id) {
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  const s = db.servis.find(x => x.id === id);
  if (!s) return;
  if (!confirm('Hapus servis ini?\n\nStok part/baterai akan dikembalikan, catatan kas/MDR servis ini ikut dibatalkan, dan kuota klaim (jika ada) dikembalikan.')) return;
  try {
    const { error } = await supabaseClient.rpc('hapus_servis_aman', { p_id: id });
    if (error) throw error;
    flash('Servis dihapus & stok/kas dikembalikan secara atomik');
    tarikSemuaData();
  } catch (e) {
    if (/hapus_servis_aman/i.test(e.message || '')) {
      return flash('Jalankan migrasi_perbaikan_keamanan.sql di Supabase terlebih dahulu.', 'err');
    }
    flash('Gagal menghapus: ' + e.message, 'err');
    tarikSemuaData();
  }
}

// === KLAIM GARANSI SERVIS ===
function bisaKlaimGaransi(s) {
  if (!s || s.is_klaim || !s.tgl_garansi_servis_sampai || s.status !== 'diambil') return false;
  if (new Date() > new Date(s.tgl_garansi_servis_sampai + 'T23:59:59')) return false;
  if ((s.klaim_count || 0) >= MAX_KLAIM_SERVIS) return false;
  return true;
}

function resetModeKlaim() {
  if ($('sParentId')) $('sParentId').value = '';
  if ($('sJasa')) $('sJasa').readOnly = false;
  if ($('sGaransi')) $('sGaransi').disabled = false;
  const banner = $('klaimBanner');
  if (banner) banner.style.display = 'none';
}

function mulaiKlaimGaransi(id) {
  const s = db.servis.find(x => x.id === id);
  if (!s || !bisaKlaimGaransi(s)) return flash('Tidak bisa diklaim', 'err');
  if (!confirm(`KLAIM GARANSI\n\nPelanggan: ${s.customer}\nSisa kuota: ${MAX_KLAIM_SERVIS - (s.klaim_count || 0)}x\n\nLanjut?`)) return;
  $('sNama').value = s.customer; $('sHp').value = s.telp || ''; $('sProduk').value = s.produk;
  $('sGaransi').value = 'luar'; $('sGaransi').disabled = true;
  $('sJasa').value = 0; $('sJasa').readOnly = true; $('sParentId').value = s.id;
  const banner = $('klaimBanner');
  if (banner) { banner.style.display = 'block'; banner.innerHTML = `<b>MODE KLAIM GARANSI</b> - Dari: ${esc(s.id)}<br><button class="btn-sm danger" onclick="batalKlaimGaransi()">Batal Klaim</button>`; }
  bukaMenu('servis'); window.scrollTo(0, 0); hitungTotalServis();
}

function batalKlaimGaransi() {
  resetModeKlaim();
  $('sJasa').value = 0; $('sGaransi').value = 'garansi';
  ['sNama', 'sHp', 'sProduk', 'sKeluhan'].forEach(x => { if ($(x)) $(x).value = ''; });
  hitungTotalServis(); flash('Klaim dibatalkan');
}

// === BATERAI ===
async function tambahStokBaterai() {
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  const tipe = txt('sbTipe').toUpperCase();
  if (!tipe) return flash('Tipe wajib', 'err');
  const stokInput = Math.max(0, Math.floor(num('sbStok')));
  const hargaBeli = Math.max(0, num('sbBeli'));
  const sb = db.stokBaterai.find(x => x.tipe.toUpperCase() === tipe);
  try {
    if (sb) {
      const stokLama = sb.stok || 0;
      const hppLama = sb.harga_beli || 0;
      await ubahStok('stok_baterai', sb.id, stokInput);
      if (isPemilik() && stokInput > 0 && hargaBeli > 0) {
        const totalStok = stokLama + stokInput;
        const hppBaru = totalStok > 0 ? Math.round(((stokLama * hppLama) + (stokInput * hargaBeli)) / totalStok) : hargaBeli;
        await simpanModal('stok_baterai', sb.id, hppBaru);
      }
    } else {
      const newId = genId('SB');
      await dbOk(supabaseClient.from('stok_baterai').insert([{ id: newId, tipe, min_stok: num('sbMin'), harga_jual: num('sbJual'), stok: stokInput }]));
      if (isPemilik()) await simpanModal('stok_baterai', newId, hargaBeli);
    }
    await catatLog('TAMBAH_BATERAI', 'Menambah stok baterai: ' + tipe);
    flash('Stok baterai berhasil ditambahkan');
    ['sbTipe', 'sbBeli', 'sbJual'].forEach(id => { if ($(id)) $(id).value = ''; });
    $('sbStok').value = 0;
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}


function pilihBaterai() {
  const sb = db.stokBaterai.find(x => x.id === $('bTipeSel').value);
  const info = $('bStokInfo');
  if (!sb) { if (info) info.value = '-'; return; }
  if (info) info.value = `${sb.stok} unit (min ${sb.min_stok})`;
  cekKlaimBaterai(txt('bNama'));
}

// Klaim garansi baterai: isi form otomatis dari riwayat (nama, HP, nama jam persis sama),
// supaya sistem bisa mengenali riwayat & menghitung garansi 0% / 50% / penuh sendiri.
function mulaiKlaimBaterai(id) {
  const b = db.baterai.find(x => x.id === id); if (!b) return;
  bukaMenu('baterai');
  $('bNama').value = b.customer || ''; $('bHp').value = b.telp || ''; $('bProduk').value = b.produk || '';
  $('bTgl').value = tglLokal();
  const sbCocok = db.stokBaterai.find(x => x.id === b.sb_id || (x.tipe || '').toUpperCase() === (b.tipe || '').toUpperCase());
  if (sbCocok && sbCocok.stok > 0 && $('bTipeSel')) $('bTipeSel').value = sbCocok.id;
  cekKlaimBaterai(txt('bNama'));
  window.scrollTo(0, 0);
  flash('Data klaim terisi otomatis. Pastikan tipe baterai lalu klik tambah ke list.');
}

function addBateraiCart() {
  const produk = txt('bProduk'), sbId = $('bTipeSel').value;
  if (!produk) return flash('Isi Nama Produk / Jam terlebih dahulu!', 'err');
  if (!sbId) return flash('Pilih Tipe Baterai terlebih dahulu!', 'err');
  const sb = db.stokBaterai.find(x => x.id === sbId);
  if (!sb) return flash('Data baterai tidak ditemukan!', 'err');
  if (sb.stok < 1) return flash('Stok baterai habis!', 'err');

  // Hitung ulang status garansi tepat sebelum masuk keranjang agar tidak pernah stale
  cekKlaimBaterai(txt('bNama'));

  const existing = cartBaterai.find(c => normText(c.produk) === normText(produk) && c.sbId === sbId);
  if (existing) {
    if (existing.qty + 1 > sb.stok) return flash('Stok baterai tidak mencukupi!', 'err');
    existing.qty += 1;
  } else {
    cartBaterai.push({ produk, sbId, tipe: sb.tipe, harga: Math.round((sb.harga_jual || 0) * statusKlaimAktif.multiplier), qty: 1, jenisKlaim: statusKlaimAktif.tipe });
  }
  $('bProduk').value = ''; $('bTipeSel').value = '';
  renderBateraiCart();
  flash('Baterai berhasil ditambahkan ke list');
}

function renderBateraiCart() {
  const listEl = $('cartBateraiList'), cardList = $('cardListBaterai'), cardBayar = $('cardPembayaranBaterai'), stickyBar = $('stickyBaterai');
  if (!cartBaterai.length) {
    if (cardList) cardList.style.display = 'none';
    if (cardBayar) cardBayar.style.display = 'none';
    if (stickyBar) stickyBar.style.display = 'none';
    if ($('batEmptyHint')) $('batEmptyHint').style.display = 'block';
    return;
  }
  if ($('batEmptyHint')) $('batEmptyHint').style.display = 'none';
  if (cardList) cardList.style.display = 'block';
  if (cardBayar) cardBayar.style.display = 'block';
  if (stickyBar) stickyBar.style.display = 'flex';
  if (listEl) {
    listEl.innerHTML = cartBaterai.map((c, i) => `
      <div class="item-servis-cart">
        <div class="info">
          <strong>${i + 1}. ${esc(c.produk)} (${esc(c.tipe)}) x${c.qty}</strong><br>
          Harga: ${rp(c.harga)} | Subtotal: ${rp(c.harga * c.qty)}
        </div>
        <button type="button" class="btn-sm danger" onclick="hapusBateraiCart(${i})">X</button>
      </div>`).join('');
  }
  updateTotalBaterai();
}

function updateTotalBaterai() {
  const total = cartBaterai.reduce((s, c) => s + (c.harga * c.qty), 0);
  if ($('displayTotalBaterai')) $('displayTotalBaterai').innerText = rp(total);
  const mdr = hitungMDR(total, $('metodeBaterai')?.value);
  const elMdr = $('mdrBateraiInfo');
  if (elMdr) {
    if (mdr > 0) { elMdr.style.display = 'flex'; $('mdrBateraiValue').textContent = '-' + rp(mdr); }
    else elMdr.style.display = 'none';
  }
}

function batalKeranjangBaterai() {
  if (!confirm('Kosongkan list baterai?')) return;
  cartBaterai = [];
  renderBateraiCart();
}
function hapusBateraiCart(i) { cartBaterai.splice(i, 1); renderBateraiCart(); }

async function simpanBaterai() {
  if (isSavingBaterai) return;
  if (!checkRequired(['bNama'])) return flash('Nama Pelanggan wajib diisi', 'err');
  if (!cartBaterai.length) return flash('Keranjang baterai masih kosong', 'err');

  const nama = formatNama($('bNama').value), telp = txt('bHp');
  const metode = $('metodeBaterai').value;
  const garansi = num('bGaransi');
  const tglGanti = $('bTgl').value || tglLokal();
  const cekBank = wajibBankNonTunai('bankBaterai', metode);
  if (!cekBank.ok) return;
  const bankId = cekBank.bankId;

  const totalBiaya = cartBaterai.reduce((s, c) => s + (c.harga * c.qty), 0);
  const totalHargaNormal = cartBaterai.reduce((s, c) => {
    const sb = db.stokBaterai.find(x => x.id === c.sbId);
    return s + ((sb ? sb.harga_jual : 0) * c.qty);
  }, 0);

  isSavingBaterai = true;
  try {
    const items = cartBaterai.map(c => ({ produk: c.produk, sb_id: c.sbId, harga: c.harga, qty: c.qty, jenis_klaim: c.jenisKlaim }));
    const rpcArgs = {
      p_items: items, p_customer: nama, p_telp: telp || null, p_tgl_ganti: tglGanti,
      p_garansi_bulan: garansi, p_metode: metode, p_bank_id: bankId
    };
    let { data, error } = await supabaseClient.rpc('proses_ganti_baterai', rpcArgs);
    if (error && /diproses oleh Admin atau Pemilik/i.test(error.message) && isKasir()) {
      // Harga di bawah normal (klaim/garansi): RPC menolak kasir. Admin/pemilik
      // memasukkan password, dan transaksi BENAR-BENAR dijalankan oleh RPC sebagai admin.
      const ulang = await panggilRpcDenganOtorisasi(
        `Klaim baterai ${nama}: normal ${rp(totalHargaNormal)}, dibayar ${rp(totalBiaya)}`,
        'proses_ganti_baterai', rpcArgs
      );
      data = ulang.data; error = ulang.error;
    }
    if (error) throw error;

    await catatLog('BATERAI', `Ganti baterai ${items.length} item untuk ${nama} (${rp(data.total)})`);
    const listCetak = data.items.map((h, i) => ({ ...items[i], id: h.id, tgl_expired: h.tgl_expired, biaya: h.biaya }));
    try { cetakStrukGabunganBaterai(listCetak, nama, telp, data.total); } catch (e) { console.error(e); flash('Data tersimpan, tetapi struk gagal dicetak: ' + e.message, 'err'); }

    cartBaterai = [];
    renderBateraiCart();
    ['bNama', 'bHp', 'bProduk'].forEach(id => { if ($(id)) $(id).value = ''; });
    statusKlaimAktif = { multiplier: 1, tipe: 'Normal' };
    if ($('infoKlaimBaterai')) $('infoKlaimBaterai').style.display = 'none';
    tarikSemuaData();
  } catch (e) {
    flash('Gagal: ' + e.message, 'err');
    tarikSemuaData();
  } finally { isSavingBaterai = false; }
}


async function hapusBaterai(id) {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa menghapus', 'err');
  if (!confirm('Hapus data riwayat baterai ini?')) return;
  try {
    await dbOk(supabaseClient.from('baterai').delete().eq('id', id));
    await catatLog('HAPUS_BATERAI', 'Menghapus riwayat baterai ID: ' + id);
    flash('Dihapus');
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

async function editStokBaterai(id) {
  if (!isAdmin()) return flash('Akses ditolak', 'err');
  const sb = db.stokBaterai.find(x => x.id === id);
  if (!sb) return;
  const min = prompt('Min Stok:', sb.min_stok); if (min === null) return;
  const beli = prompt('Harga Beli:', sb.harga_beli); if (beli === null) return;
  const jual = prompt('Harga Jual:', sb.harga_jual); if (jual === null) return;
  try {
    await dbOk(supabaseClient.from('stok_baterai').update({ min_stok: +min || 0, harga_jual: +jual || 0 }).eq('id', id));
    if (isPemilik()) await simpanModal('stok_baterai', id, +beli || 0);
    await catatLog('EDIT_BATERAI', 'Mengubah data baterai: ' + sb.tipe);
    flash('Data baterai diperbarui');
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}


async function hapusStokBaterai(id) {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa menghapus', 'err');
  if (!confirm('Hapus tipe baterai ini?')) return;
  try {
    await dbOk(supabaseClient.from('stok_baterai').delete().eq('id', id));
    await catatLog('HAPUS_STOK_BATERAI', 'Menghapus tipe baterai ID: ' + id);
    flash('Tipe baterai dihapus');
    tarikSemuaData();
  } catch (e) { flash('Gagal menghapus (mungkin sudah dipakai di transaksi): ' + e.message, 'err'); }
}

function cekKlaimBaterai(nama) {
  const infoKlaim = $('infoKlaimBaterai');
  const reset = () => { statusKlaimAktif = { multiplier: 1, tipe: 'Normal' }; if (infoKlaim) infoKlaim.style.display = 'none'; };

  const produkInput = normText(txt('bProduk'));
  const namaNorm = normText(nama);
  if (!namaNorm || !produkInput) return reset();

  const telp = txt('bHp').replace(/\D/g, '');
  const tglBaru = new Date(($('bTgl')?.value || tglLokal()) + 'T00:00:00');

  const riwayat = db.baterai
    .filter(b => (normText(b.customer) === namaNorm || (telp && (b.telp || '').replace(/\D/g, '') === telp)) && normText(b.produk) === produkInput)
    .sort((a, b) => new Date(b.tgl_ganti) - new Date(a.tgl_ganti));
  if (!riwayat.length) return reset();

  const tglLama = new Date(riwayat[0].tgl_ganti + 'T00:00:00');
  if (isNaN(tglBaru.getTime()) || isNaN(tglLama.getTime())) return reset();

  let selisih = (tglBaru.getFullYear() - tglLama.getFullYear()) * 12 + (tglBaru.getMonth() - tglLama.getMonth());
  if (tglBaru.getDate() < tglLama.getDate()) selisih--;

  const terakhir = riwayat[0];
  const sudahPernahKlaim = (terakhir.jenis_klaim && terakhir.jenis_klaim !== 'Normal') || Number(terakhir.biaya || 0) === 0;

  let pesan, warna, warnaTeks;
  if (sudahPernahKlaim) {
    statusKlaimAktif = { multiplier: 1, tipe: 'Normal' };
    pesan = `❌ SUDAH PERNAH KLAIM (${terakhir.jenis_klaim || 'Gratis'} pada ${new Date(terakhir.tgl_ganti).toLocaleDateString('id-ID')}). Klaim baterai hanya 1x & harga khusus tidak berlaku. Biaya: Full`;
    warna = '#fee2e2'; warnaTeks = '#7f1d1d';
  } else if (selisih <= GARANSI_BATERAI_PENUH_BULAN) {
    statusKlaimAktif = { multiplier: 0, tipe: 'Garansi (Gratis)' };
    pesan = `✅ MASIH GARANSI (Bulan ke-${selisih}, belum pernah klaim). Klaim 1x GRATIS: Rp 0`;
    warna = '#dcfce7'; warnaTeks = '#14532d';
  } else if (selisih <= GARANSI_BATERAI_SETENGAH_BULAN) {
    statusKlaimAktif = { multiplier: 0.5, tipe: 'Harga Khusus 50%' };
    pesan = `🎁 HARGA KHUSUS / DISKON 50% (Bulan ke-${selisih}, tidak ada klaim selama masa garansi). Biaya: 50%`;
    warna = '#fef3c7'; warnaTeks = '#78350f';
  } else {
    statusKlaimAktif = { multiplier: 1, tipe: 'Normal' };
    pesan = `❌ LEWAT GARANSI & HARGA KHUSUS (>${GARANSI_BATERAI_SETENGAH_BULAN} bulan, bulan ke-${selisih}). Biaya Baterai: Full`;
    warna = '#fee2e2'; warnaTeks = '#7f1d1d';
  }
  if (infoKlaim) {
    infoKlaim.style.display = 'block';
    infoKlaim.textContent = pesan;
    infoKlaim.style.background = warna;
    infoKlaim.style.color = warnaTeks;
    infoKlaim.style.border = '1.5px solid ' + warnaTeks;
  }
}

// === KAS & KEUANGAN ===
async function simpanKasManual() {
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  if (!checkRequired(['kasNominal', 'kasKet'])) return flash('Lengkapi nominal & keterangan', 'err');
  const nominal = num('kasNominal'), ket = txt('kasKet');
  const metode = $('kasMetode').value, jenis = $('kasJenis').value;
  const tgl = $('kasTgl')?.value || tglLokal();
  if (nominal <= 0) return flash('Nominal tidak valid', 'err');
  try {
    // waktu mengikuti tanggal yang dipilih agar masuk laporan bulan yang benar
    const cekBank = wajibBankNonTunai('kasBank', metode);
    if (!cekBank.ok) return;
    const waktu = tgl === tglLokal() ? nowISO() : new Date(tgl + 'T12:00:00').toISOString();
    await catatKas({ waktu, jenis, metode, nominal, keterangan: ket, sumber: 'manual', bank_id: cekBank.bankId });
    await catatLog('KAS_MANUAL', `Input kas ${jenis} - ${ket} (${rp(nominal)})`);
    flash('Kas dicatat');
    ['kasNominal', 'kasKet'].forEach(x => { $(x).value = ''; });
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

async function tambahBank() {
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  if (!checkRequired(['bankNama'])) return flash('Nama bank wajib', 'err');
  try {
    await dbOk(supabaseClient.from('bank').insert([{ id: genId('BNK'), nama: txt('bankNama'), no: txt('bankNo'), saldo_awal: num('bankSaldoAwal') }]));
    await catatLog('TAMBAH_REKENING', 'Menambah rekening bank: ' + txt('bankNama'));
    flash('Rekening ditambahkan');
    ['bankNama', 'bankNo', 'bankSaldoAwal'].forEach(x => { if ($(x)) $(x).value = ''; });
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

async function editBank(id) {
  if (!isAdmin()) return flash('Akses ditolak', 'err');
  const b = db.bank.find(x => x.id === id);
  if (!b) return;
  const input = prompt(`Masukkan Saldo Awal baru untuk ${b.nama} (Rp):`, b.saldo_awal);
  if (input === null) return;
  const saldo = +input;
  if (isNaN(saldo)) return flash('Nominal tidak valid', 'err');
  try {
    await dbOk(supabaseClient.from('bank').update({ saldo_awal: saldo }).eq('id', id));
    await catatLog('EDIT_BANK', `Mengubah saldo awal ${b.nama} menjadi ${rp(saldo)}`);
    flash('Saldo Awal berhasil diperbarui');
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

async function hapusBank(id) {
  if (!isAdmin() || !confirm('Hapus rekening bank ini?')) return;
  try {
    await dbOk(supabaseClient.from('bank').delete().eq('id', id));
    await catatLog('HAPUS_BANK', 'Menghapus rekening ID: ' + id);
    flash('Rekening berhasil dihapus');
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

const saldoBankSistem = b => {
  const masuk = db.kas.filter(k => k.bank_id === b.id && k.jenis === 'masuk').reduce((s, k) => s + k.nominal, 0);
  const keluar = db.kas.filter(k => k.bank_id === b.id && k.jenis === 'keluar').reduce((s, k) => s + k.nominal, 0);
  return (b.saldo_awal || 0) + masuk - keluar;
};

async function rekonsiliasiBank(id) {
  if (!isAdmin()) return flash('Akses ditolak', 'err');
  const b = db.bank.find(x => x.id === id);
  if (!b) return;
  const saldoSistem = saldoBankSistem(b);
  const inputSaldo = prompt(`REKONSILIASI BANK ${b.nama}\n\nSaldo Sistem: ${rp(saldoSistem)}\n\nMasukkan Saldo Aktual (sesuai m-banking/ATM):`);
  if (inputSaldo === null) return;
  const saldoAktual = +inputSaldo;
  if (isNaN(saldoAktual)) return flash('Nominal tidak valid', 'err');
  const selisih = saldoAktual - saldoSistem;
  if (selisih === 0) return flash('Rekonsiliasi selesai. Saldo sudah sesuai 100%.', 'ok');

  const alasan = prompt(`Selisih: ${selisih > 0 ? '+' : ''}${rp(selisih)}\n\nMasukkan alasan penyesuaian (contoh: Bunga Bank, Biaya Admin, Koreksi Transfer):`);
  if (!alasan) return flash('Alasan penyesuaian wajib diisi', 'err');
  const jenis = selisih > 0 ? 'masuk' : 'keluar', nominal = Math.abs(selisih);
  try {
    await catatKas({ jenis, metode: 'transfer', nominal, keterangan: `Penyesuaian Rekonsiliasi ${b.nama}: ${alasan}`, sumber: 'rekonsiliasi', bank_id: b.id });
    await catatLog('REKONSILIASI_BANK', `${b.nama}: ${jenis} ${rp(nominal)} - ${alasan}`);
    flash(`Rekonsiliasi berhasil. Saldo disesuaikan ${selisih > 0 ? '+' : ''}${rp(selisih)}`, 'ok');
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

async function simpanKasKecilKasir() {
  const jenis = $('kkJenis').value, nominal = num('kkNominal'), ket = txt('kkKet');
  if (nominal <= 0 || nominal > 500000) return flash('Nominal harus antara Rp1 - Rp500.000', 'err');
  if (!ket) return flash('Keterangan wajib diisi', 'err');
  try {
    await catatKas({ jenis, metode: 'tunai', nominal, keterangan: ket, sumber: 'kas_kecil' });
    await catatLog('KAS_KECIL', `Input ${jenis} - ${ket} (${rp(nominal)})`);
    flash('Kas kecil dicatat');
    ['kkNominal', 'kkKet'].forEach(x => { $(x).value = ''; });
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}


async function hapusJual(id) {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa menghapus transaksi penjualan', 'err');
  if (!confirm('⚠️ Hapus transaksi penjualan ini?\n\nStok produk akan dikembalikan, dan catatan kas terkait ikut terhapus.')) return;
  try {
    const { error } = await supabaseClient.rpc('hapus_jual', { p_id: id });
    if (error) throw error;
    flash('Transaksi penjualan dihapus, stok dikembalikan');
    tarikSemuaData();
  } catch (e) { flash('Gagal menghapus: ' + e.message, 'err'); }
}

async function hapusKas(id) {
  if (!isAdmin()) return flash('Akses ditolak. Hanya Admin/Pemilik yang bisa menghapus.', 'err');
  if (!confirm('⚠️ Yakin ingin menghapus riwayat kas ini?\n\nTindakan ini menghapus data secara permanen dan mempengaruhi total saldo.')) return;
  try {
    const k = db.kas.find(x => x.id === id);
    await dbOk(supabaseClient.from('kas').delete().eq('id', id));
    await catatLog('HAPUS_KAS', `Menghapus kas ${id}${k ? ` (${k.jenis} ${rp(k.nominal)} - ${k.keterangan})` : ''}`);
    flash('Transaksi kas berhasil dihapus');
    tarikSemuaData();
  } catch (e) { flash('Gagal menghapus: ' + e.message, 'err'); }
}

// === SETTINGS ===
async function simpanSetting(data, aksi, detail, pesan) {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa mengubah pengaturan.', 'err');
  try {
    await dbOk(supabaseClient.from('settings').upsert({ id: 'toko', ...data }));
    await catatLog(aksi, detail);
    flash(pesan);
    tarikSemuaData();
  } catch (e) { flash('Gagal menyimpan: ' + e.message, 'err'); }
}
const simpanToko = () => simpanSetting({ nama: txt('tkNama'), telp: txt('tkTelp'), alamat: txt('tkAlamat'), footer: txt('tkFooter'), syarat: txt('tkSyarat'), syarat_singkat: txt('tkSyaratSingkat') }, 'SETTING', 'Mengubah Identitas Toko', 'Identitas disimpan');
const simpanMDR = () => simpanSetting({
  mdr_cc_bca: num('setMdrCcBca'), mdr_cc_vm: num('setMdrCcVm'), mdr_cc_amex: num('setMdrCcAmex'),
  mdr_dc_bca: num('setMdrDcBca'), mdr_dc_lain: num('setMdrDcLain'), mdr_dc_maestro: num('setMdrDcMaestro'),
  mdr_qris_besar: num('setMdrQrisBesar'), mdr_transfer: num('setMdrTransfer')
}, 'SETTING_MDR', 'Mengubah pengaturan MDR', 'Pengaturan MDR disimpan');
const simpanGaransiServis = () => simpanSetting({ garansi_servis_bulan: num('setGaransiServisBulan') }, 'SETTING_GARANSI', 'Mengubah garansi servis default', 'Garansi servis disimpan');
const simpanAturanDiskon = () => simpanSetting({ diskon_persen: num('setDiskonPersen'), diskon_nominal: num('setDiskonNominal') }, 'SETTING_DISKON', 'Mengubah aturan diskon', 'Aturan diskon disimpan');

function isiFormSetting(paksa = false) {
  const s = db.settings;
  if (!s) return;
  const isi = (id, val) => { const el = $(id); if (el && (paksa || el !== document.activeElement)) el.value = val; };
  isi('tkNama', s.nama || ''); isi('tkTelp', s.telp || ''); isi('tkAlamat', s.alamat || ''); isi('tkFooter', s.footer || '');
  isi('tkSyarat', s.syarat || TOKO_DEFAULT.syarat); isi('tkSyaratSingkat', s.syarat_singkat || TOKO_DEFAULT.syaratSingkat);
  isi('setGaransiServisBulan', s.garansi_servis_bulan ?? 3);
  isi('setMdrCcBca', s.mdr_cc_bca ?? 1.5); isi('setMdrCcVm', s.mdr_cc_vm ?? 2); isi('setMdrCcAmex', s.mdr_cc_amex ?? 3.25);
  isi('setMdrDcBca', s.mdr_dc_bca ?? 0.15); isi('setMdrDcLain', s.mdr_dc_lain ?? 1); isi('setMdrDcMaestro', s.mdr_dc_maestro ?? 2);
  isi('setMdrQrisBesar', s.mdr_qris_besar ?? 0.7); isi('setMdrTransfer', s.mdr_transfer ?? 0);
  isi('setDiskonPersen', s.diskon_persen ?? 10); isi('setDiskonNominal', s.diskon_nominal ?? 20000);
}

// === LABEL & MDR ===
function labelMetode(m) {
  const labels = {
    tunai: 'Tunai', transfer: 'Transfer', qris: 'QRIS', hutang: 'Hutang',
    edc_cc_bca: 'BCA Card', edc_cc_vm: 'Visa/Master/JCB', edc_cc_amex: 'Amex',
    edc_dc_bca: 'Debit BCA', edc_dc_lain: 'Debit Bank Lain', edc_dc_maestro: 'Maestro'
  };
  return labels[m] || m;
}

function hitungMDR(total, metode) {
  if (!metode || metode === 'tunai' || metode === 'hutang') return 0;
  const s = db.settings || {};
  const v = (k, def) => (s[k] === null || s[k] === undefined || s[k] === '') ? def : +s[k];   // nilai 0 tetap dihormati
  const pct = (k, def) => Math.round(total * v(k, def) / 100);
  switch (metode) {
    case 'transfer': return v('mdr_transfer', 0);
    case 'qris': return total <= 100000 ? 0 : pct('mdr_qris_besar', 0.7);
    case 'edc_cc_bca': return pct('mdr_cc_bca', 1.5);
    case 'edc_cc_vm': return pct('mdr_cc_vm', 2);
    case 'edc_cc_amex': return pct('mdr_cc_amex', 3.25);
    case 'edc_dc_bca': return pct('mdr_dc_bca', 0.15);
    case 'edc_dc_lain': return pct('mdr_dc_lain', 1);
    case 'edc_dc_maestro': return pct('mdr_dc_maestro', 2);
    default: return 0;
  }
}

function cetakHTML(html) {
  // Jika mode Printer Thermal Bluetooth aktif & terhubung, cetak langsung via ESC/POS
  if (localStorage.getItem('ta_bt_aktif') === '1' && btCharacteristic) {
    const teks = htmlKeTeksStruk(html);
    btPrintText(teks).then(ok => {
      if (ok) flash('🖨️ Struk dicetak via Bluetooth');
      else cetakViaBrowser(html);
    }).catch(() => cetakViaBrowser(html));
    return;
  }
  cetakViaBrowser(html);
}

function cetakViaBrowser(html) {
  const win = window.open('', '_blank');
  if (!win) return alert('BROWSER MEMBLOKIR POP-UP!\n\nSilakan izinkan pop-up (Always allow pop-ups) di pengaturan browser untuk situs ini.');
  win.document.open(); win.document.write(html); win.document.close();
  let sudah = false;
  const mulaiCetak = () => { if (sudah) return; sudah = true; try { win.focus(); win.print(); } catch (_) { } };
  win.onload = () => setTimeout(mulaiCetak, 300);
  setTimeout(mulaiCetak, 1500);
}

// === AUDIT LOG & AUDIT STOK ===
async function catatLog(aksi, detail) {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from('audit_log').insert([{
    id: genId('LOG'), waktu: nowISO(),
    user_name: sessionStorage.getItem('ta_user') || 'guest',
    role: sessionStorage.getItem('ta_role') || 'guest', aksi, detail
  }]);
  if (error) console.error('❌ GAGAL SIMPAN AUDIT LOG:', error.message);
}

function renderAuditLog() {
  const el = $('listAuditLog'); if (!el) return;
  const q = txt('cariAuditLog').toLowerCase();
  let list = db.auditLog || [];
  if (q) list = list.filter(l => (l.user_name || '').toLowerCase().includes(q) || (l.aksi || '').toLowerCase().includes(q));
  if (filterAuditUser === 'admin') list = list.filter(l => l.role === 'admin' || l.role === 'pemilik');
  else if (filterAuditUser === 'kasir') list = list.filter(l => l.role === 'kasir');
  el.innerHTML = list.length ? list.map(l => `
    <div style="font-size:12px; border-bottom:1px solid #eee; padding:8px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <strong>${new Date(l.waktu).toLocaleString('id-ID')}</strong>
        <span class="badge ${l.role === 'admin' || l.role === 'pemilik' ? 'danger' : 'proses'}">${esc(l.user_name)} (${esc(l.role)})</span>
      </div>
      <span style="color:#0284c7; font-weight:bold;">${esc(l.aksi)}</span>: ${esc(l.detail)}
    </div>`).join('') : '<div class="empty">Belum ada aktivitas.</div>';
}

function renderAuditGlobal() {
  const el = $('listAuditGlobal'); if (!el) return;
  const q = txt('cariAudit').toLowerCase();
  const all = [
    ...db.produk.map(p => ({ tipe: 'produk', id: p.id, nama: p.nama, sistem: p.stok })),
    ...db.sparePart.map(s => ({ tipe: 'sparepart', id: s.id, nama: s.nama, sistem: s.stok })),
    ...db.stokBaterai.map(b => ({ tipe: 'baterai', id: b.id, nama: b.tipe, sistem: b.stok }))
  ];
  const filtered = all.filter(x => !q || x.nama.toLowerCase().includes(q));
  if (!filtered.length) { el.innerHTML = '<div class="empty" style="padding:20px">Barang tidak ditemukan</div>'; return; }

  const badgeOf = t => t === 'produk' ? '<span class="badge proses" style="font-size:9px">JAM</span>' : (t === 'sparepart' ? '<span class="badge warn" style="font-size:9px">PART</span>' : '<span class="badge ok" style="font-size:9px">BAT</span>');
  el.innerHTML = `<table style="margin:0;"><thead style="position:sticky;top:0;z-index:1;background:#f8fafc"><tr><th>Tipe</th><th>Nama Barang</th><th>Sistem</th><th style="width:70px">Kasir</th><th style="width:80px">Fisik (Anda)</th></tr></thead><tbody>` +
    filtered.map(item => {
      const key = `${item.tipe}_${item.id}`;
      const val = tempAuditData[key] !== undefined ? tempAuditData[key] : '';
      const draft = (db.auditDraftHariIni || {})[`${tipeDb(item.tipe)}_${item.id}`];
      const kasirHTML = draft
        ? `<span style="font-weight:bold">${draft.stok_fisik}</span><br><small style="color:#64748b">${esc((draft.user_name||'').split('@')[0])}</small>`
        : '<span style="color:#cbd5e1">-</span>';
      const beda = draft && val !== '' && +val !== draft.stok_fisik;
      return `<tr><td>${badgeOf(item.tipe)}</td><td><strong>${esc(item.nama)}</strong></td><td style="text-align:center; font-weight:bold;">${item.sistem}</td>
        <td style="text-align:center">${kasirHTML}</td>
        <td><input type="number" min="0" id="auditFisik_${esc(key)}" value="${val}" placeholder="-" oninput="updateAuditGlobal('${esc(key)}', this.value)" style="width:100%;padding:6px;text-align:center;font-weight:bold;border:1px solid ${beda ? '#f59e0b' : '#cbd5e1'};border-radius:4px;">
        ${beda ? '<small style="color:#d97706">⚠️ beda dgn kasir</small>' : ''}</td></tr>`;
    }).join('') + '</tbody></table>';
}

function updateAuditGlobal(key, val) {
  if (val === '') delete tempAuditData[key]; else tempAuditData[key] = +val;
}

async function simpanAuditGlobal() {
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  const catatan = txt('auditCatatanMassal');
  if (!catatan) return flash('Catatan audit wajib diisi', 'err');
  const keys = Object.keys(tempAuditData);
  if (!keys.length) return flash('Belum ada stok fisik yang diisi', 'err');

  let itemBerubah = 0;
  try {
    for (const key of keys) {
      const i = key.indexOf('_');
      const tipe = key.slice(0, i), id = key.slice(i + 1);
      const fisik = Math.floor(tempAuditData[key]);
      if (isNaN(fisik) || fisik < 0) throw new Error('Stok fisik tidak valid pada ' + key);

      let item, tabel;
      if (tipe === 'produk') { item = db.produk.find(x => x.id === id); tabel = 'produk'; }
      else if (tipe === 'sparepart') { item = db.sparePart.find(x => x.id === id); tabel = 'sparepart'; }
      else { item = db.stokBaterai.find(x => x.id === id); tabel = 'stok_baterai'; }
      if (!item) continue;

      const sistem = item.stok, hargaBeli = item.harga_beli || 0, selisih = fisik - sistem;
      if (selisih === 0) continue;
      itemBerubah++;
      await dbOk(supabaseClient.from(tabel).update({ stok: fisik }).eq('id', id));
      await dbOk(supabaseClient.from('audit_barang').insert([{
        id: genId('AUD'), waktu: nowISO(), tipe, nama_produk: item.nama || item.tipe,
        stok_sistem: sistem, stok_fisik: fisik, selisih, harga_beli: hargaBeli, nilai_selisih: selisih * hargaBeli,
        catatan, user_name: sessionStorage.getItem('ta_user') || 'admin'
      }]));
    }
    await catatLog('AUDIT_STOK', `Audit stok: ${itemBerubah} barang disesuaikan. ${catatan}`);
    flash(`Audit selesai. ${itemBerubah} barang disesuaikan.`, 'ok');
    tempAuditData = {};
    $('auditCatatanMassal').value = ''; $('cariAudit').value = '';
    tarikSemuaData();
  } catch (e) { flash('Gagal audit: ' + e.message, 'err'); tarikSemuaData(); }
}

function filterKas(v) { filterKasJenis = v; render(); }
function filterServis(v) {
  filterServisStatus = v;
  document.querySelectorAll('#srvFilterPills .status-pill-btn').forEach(b => b.classList.toggle('active', b.dataset.st === v));
  render();
}
function filterAudit(v) { filterAuditUser = v; render(); }

// === SCAN BARCODE, FOTO, CETAK BARCODE ===
function playBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(800, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
    osc.onended = () => ctx.close();
  } catch (e) { console.log('Audio error:', e); }
}

async function scanBarcode(targetId, mode = 'input') {
  scanTarget = targetId; scanMode = mode;
  if (!('BarcodeDetector' in window)) return alert('Browser tidak mendukung scan kamera. Gunakan Chrome Android.');
  try {
    stopScan();
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('scanVideo');
    video.srcObject = scanStream;
    await video.play();
    $('scanArea').style.display = 'flex';
    const detector = new BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e'] });
    scanInterval = setInterval(async () => {
      try {
        const codes = await detector.detect(video);
        if (!codes.length) return;
        playBeep();
        const nilai = codes[0].rawValue;
        stopScan();
        if (scanMode === 'kasir') prosesBarcodeKasir(nilai);
        else { $(scanTarget).value = nilai; flash('Barcode: ' + nilai); }
      } catch (e) { }
    }, 500);
  } catch (e) { stopScan(); alert('Tidak bisa akses kamera: ' + e.message); }
}

function stopScan() {
  if (scanInterval) clearInterval(scanInterval);
  if (scanStream) scanStream.getTracks().forEach(t => t.stop());
  const area = $('scanArea'); if (area) area.style.display = 'none';
  scanStream = null; scanInterval = null;
}

function prosesBarcodeKasir(barcode) {
  const p = db.produk.find(x => x.barcode === barcode);
  if (!p) return flash(`❌ Produk dengan barcode [${barcode}] tidak terdaftar!`, 'err');
  if (p.stok < 1) return flash(`❌ Stok ${p.nama} habis!`, 'err');
  const existing = cart.find(c => c.id === p.id);
  if (existing) {
    if (existing.qty + 1 > p.stok) return flash('Stok tidak mencukupi!', 'err');
    existing.qty += 1;
  } else cart.push({ id: p.id, nama: p.nama, harga: p.harga_jual, qty: 1 });
  renderCart();
  flash(`✅ ${p.nama} dimasukkan ke keranjang`);
}

function resizeImage(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas'); const MAX = 200;
        let w = img.width, h = img.height;
        if (w > h && w > MAX) { h *= MAX / w; w = MAX; } else if (h > MAX) { w *= MAX / h; h = MAX; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.5));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function scanFotoAI() {
  const fileInput = $('pFoto');
  if (!fileInput.files || !fileInput.files.length) return flash('Pilih foto produk terlebih dahulu', 'err');
  if (typeof Tesseract === 'undefined') return flash('Library OCR belum dimuat', 'err');
  const loading = $('loadingAI');
  if (loading) loading.style.display = 'flex';
  flash('Memproses gambar dengan AI...', 'ok');
  try {
    const worker = await Tesseract.createWorker('ind+eng');
    const ret = await worker.recognize(fileInput.files[0]);
    const text = ret.data.text.trim();
    await worker.terminate();
    if (!text) return flash('AI tidak menemukan teks.', 'err');
    const lines = text.split('\n').filter(l => l.trim().length > 2);
    if (lines.length) $('pNama').value = lines[0].substring(0, 50);
    const merek = ['SEIKO', 'CASIO', 'ALBA', 'ROLEX', 'G-SHOCK', 'TISSOT', 'FOSSIL', 'CURREN', 'ORIENT', 'CITIZEN'].find(m => text.toUpperCase().includes(m));
    if (merek) $('pMerek').value = merek;
    flash('AI berhasil membaca teks!');
  } catch (e) { flash('Gagal memproses gambar', 'err'); }
  finally { if (loading) loading.style.display = 'none'; }
}

const labelBarcodeScript = nilai => JSON.stringify(nilai).replace(/</g, '\\u003c');

async function cetakBarcode(id) {
  const p = db.produk.find(x => x.id === id); if (!p) return;
  let nilai = p.barcode;
  if (!nilai) {
    // Belum ada barcode tersimpan: buat satu, SIMPAN ke database dulu,
    // baru dicetak -- supaya stiker yang keluar sama dengan yang ada di sistem
    // dan bisa dikenali saat discan di kasir.
    nilai = 'PRD' + p.id;
    try { await dbOk(supabaseClient.from('produk').update({ barcode: nilai }).eq('id', p.id)); p.barcode = nilai; }
    catch (e) { flash('Gagal menyimpan barcode: ' + e.message, 'err'); return; }
  }
  const win = window.open('', '_blank');
  if (!win) return alert('Pop-up diblokir browser. Izinkan pop-up untuk mencetak barcode.');
  win.document.write(`<html><head><title>Print Barcode</title>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
    <style>@page{size:50mm 30mm;margin:2mm}body{text-align:center;font-family:sans-serif;padding:0;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}h4{margin:0;font-size:10px;white-space:nowrap;overflow:hidden}p{margin:2px 0;font-size:9px}</style>
    </head><body>
      <h4>${esc(p.nama)}</h4><p>Rp ${(p.harga_jual || 0).toLocaleString('id-ID')}</p><svg id="barcode"></svg>
      <script>
        JsBarcode("#barcode", ${labelBarcodeScript(nilai)}, { format: "CODE128", width: 1.2, height: 35, displayValue: true, fontSize: 10, margin: 0 });
        window.onload = function() { setTimeout(function() { window.print(); window.close(); }, 500); }
      <\/script></body></html>`);
  win.document.close();
}

function toggleAllProduk(source) { document.querySelectorAll('.chk-barcode').forEach(cb => cb.checked = source.checked); }

async function cetakBarcodeMassal() {
  const ids = Array.from(document.querySelectorAll('.chk-barcode:checked')).map(cb => cb.value);
  if (!ids.length) return alert('Pilih minimal 1 produk dengan mencentang kotaknya!');

  // Produk yang belum punya barcode: buat & SIMPAN dulu, supaya stiker yang
  // dicetak sama dengan yang tersimpan di sistem (bisa dikenali saat discan).
  const perluSimpan = ids.map(id => db.produk.find(x => x.id === id)).filter(p => p && !p.barcode);
  for (const p of perluSimpan) {
    const nilai = 'PRD' + p.id;
    try { await dbOk(supabaseClient.from('produk').update({ barcode: nilai }).eq('id', p.id)); p.barcode = nilai; }
    catch (e) { flash(`Gagal menyimpan barcode untuk ${p.nama}: ` + e.message, 'err'); return; }
  }

  const labels = ids.map(id => {
    const p = db.produk.find(x => x.id === id); if (!p) return '';
    return `<div class="label-box">
      <div style="font-size:10px;font-weight:bold;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;width:100%;text-align:center;">${esc(p.nama)}</div>
      <div style="font-size:9px;margin-bottom:2px;">Rp ${(p.harga_jual || 0).toLocaleString('id-ID')}</div>
      <svg class="barcode-svg" data-value="${esc(p.barcode)}"></svg></div>`;
  }).join('');
  const win = window.open('', '_blank');
  if (!win) return alert('Pop-up diblokir browser. Izinkan pop-up untuk mencetak barcode.');
  win.document.write(`<html><head><title>Cetak Barcode Massal</title>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
    <style>@page{size:A4;margin:5mm}body{margin:0;padding:0;display:flex;flex-wrap:wrap;align-content:flex-start;gap:2mm}.label-box{width:50mm;height:30mm;border:1px dashed #ccc;display:flex;flex-direction:column;align-items:center;justify-content:center;page-break-inside:avoid;box-sizing:border-box;padding:2mm}</style>
    </head><body>${labels}
    <script>
      document.querySelectorAll('.barcode-svg').forEach(function(svg) {
        JsBarcode(svg, svg.getAttribute('data-value'), { format: "CODE128", width: 1.2, height: 35, displayValue: true, fontSize: 10, margin: 0 });
      });
      window.onload = function() { setTimeout(function() { window.print(); window.close(); }, 500); }
    <\/script></body></html>`);
  win.document.close();
}

// === E-WARRANTY & WHATSAPP ===
async function generateDigitalWarranty(id, tipe) {
  if (typeof html2canvas === 'undefined') return flash('Library html2canvas belum dimuat', 'err');
  const toko = getToko();
  let expiryDate, title, customer, productName, serviceId, startDate;
  const fmt = d => new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  if (tipe === 'servis') {
    const data = db.servis.find(x => x.id === id);
    if (!data || !data.tgl_garansi_servis_sampai) return flash('Garansi servis tidak valid', 'err');
    expiryDate = fmt(data.tgl_garansi_servis_sampai);
    startDate = new Date(data.tgl_selesai || data.waktu).toLocaleDateString('id-ID');
    title = data.is_klaim ? 'KLAIM GARANSI SERVIS' : 'GARANSI SERVIS';
    customer = data.customer; productName = data.produk; serviceId = data.id;
  } else {
    const data = db.baterai.find(x => x.id === id);
    if (!data) return flash('Data baterai tidak valid', 'err');
    expiryDate = fmt(data.tgl_expired);
    startDate = new Date(data.tgl_ganti).toLocaleDateString('id-ID');
    title = 'GARANSI BATERAI'; customer = data.customer; productName = data.produk; serviceId = data.id;
  }
  const cardHTML = `<div class="warranty-card" id="warrantyCardRender"><div class="wc-header"><div><h3 class="wc-title">${esc(title)}</h3><div style="font-size:16px;font-weight:700;margin-top:4px;color:#fff;">${esc(toko.nama)}</div></div><div class="wc-id">${esc(serviceId)}</div></div><div class="wc-body"><div class="wc-row"><span class="wc-label">Pelanggan</span><span class="wc-value">${esc(customer)}</span></div><div class="wc-row"><span class="wc-label">Produk / Jam</span><span class="wc-value">${esc(productName)}</span></div><div class="wc-row"><span class="wc-label">Tanggal Mulai</span><span class="wc-value">${esc(startDate)}</span></div><div class="wc-expiry"><div class="wc-expiry-label">Berlaku Sampai</div><div class="wc-expiry-date">${esc(expiryDate)}</div></div></div><div class="wc-footer"><div>${esc(toko.alamat)}</div><div>WA: ${esc(toko.telp)}</div></div></div>`;
  let wrapper = $('premiumCardWrapper');
  if (!wrapper) { wrapper = document.createElement('div'); wrapper.id = 'premiumCardWrapper'; document.body.appendChild(wrapper); }
  wrapper.innerHTML = cardHTML;
  try {
    flash('Membuat kartu digital...', 'ok');
    const canvas = await html2canvas(wrapper.firstElementChild, { scale: 2, backgroundColor: null, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const link = document.createElement('a'); link.download = `Garansi_${serviceId}.png`; link.href = imgData; link.click();
    const win = window.open();
    if (win) {
      win.document.write(`<body style="margin:0;display:flex;justify-content:center;align-items:center;background:#1e293b;height:100vh;flex-direction:column;"><img src="${imgData}" style="max-width:90%;max-height:80vh;border-radius:12px;"><p style="color:#fff;font-family:sans-serif;margin-top:20px;">Gambar otomatis terunduh.</p></body>`);
      win.document.close();
    }
    flash('Kartu digital berhasil dibuat!', 'ok');
  } catch (e) { flash('Gagal membuat gambar', 'err'); }
}

async function openWA(hp, text) {
  let phone = waPhone(hp);
  if (phone.startsWith('8')) phone = '62' + phone;
  if (!phone || phone === '62' || phone.length < 9) return alert('Nomor HP tidak valid.');

  // Jika WhatsApp Gateway API (Fonnte/Custom) aktif & token terisi, kirim otomatis di latar belakang
  const apiAktif = localStorage.getItem('ta_wa_api_aktif') === '1';
  const apiUrl = (localStorage.getItem('ta_wa_api_url') || '').trim();
  const apiToken = (localStorage.getItem('ta_wa_api_token') || '').trim();
  if (apiAktif && apiUrl && apiToken && text) {
    try {
      flash('📤 Mengirim pesan WA via API...', 'ok');
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Authorization': apiToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: phone, message: text })
      });
      if (res.ok) {
        flash('✅ Pesan WA terkirim otomatis via API!');
        return;
      }
    } catch (e) {
      console.warn('WA API gagal, fallback ke wa.me:', e);
    }
  }
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text || '')}`, '_blank');
}

function shareStrukDigital(trxId) {
  const t = db.jual.find(x => x.id === trxId); if (!t) return;
  const toko = getToko(), garis = '=========================';
  let text = `*${toko.nama.toUpperCase()}*\n${toko.alamat}\nTelp: ${toko.telp}\n${garis}\n*NOTA PENJUALAN*\n${garis}\n*No:* ${t.id}\nTanggal: ${new Date(t.waktu).toLocaleString('id-ID')}\nPembeli: ${t.cust_nama || '-'}\n${garis}\n*DAFTAR BELANJA*\n`;
  (t.items || []).forEach(i => { text += `- ${i.nama}\n  ${i.qty} x ${rp(i.harga)} = ${rp(i.qty * i.harga)}\n`; });
  text += `${garis}\nSubtotal : ${rp(t.subtotal)}\n`;
  if (t.diskon > 0) text += `Diskon   : -${rp(t.diskon)}\n`;
  if (t.poin_dipakai > 0) text += `Tukar Poin: -${rp(t.poin_dipakai * NILAI_POIN)}\n`;
  text += `*TOTAL    : ${rp(t.total)}*\nBayar    : ${rp(t.bayar)}\nKembali  : ${rp(t.kembali)}\n${garis}\n`;
  if (toko.syarat_singkat) text += `*SYARAT & KETENTUAN:*\n${toko.syarat_singkat}\n${garis}\n`;
  text += `${toko.footer}\n_Simpan pesan ini sebagai bukti pembelian_`;
  openWA(t.cust_hp, text);
}

function waServisSelesai(id) {
  const s = db.servis.find(x => x.id === id); if (!s || !s.telp) return;
  const toko = getToko(), garis = '=========================';
  let text = `*${toko.nama.toUpperCase()}*\n${toko.alamat}\nTelp: ${toko.telp}\n${garis}\n*UPDATE SERVIS*\n${garis}\nPelanggan: ${s.customer}\nBarang: ${s.produk}\n*No:* ${s.id}\nStatus Saat Ini: *${s.status.toUpperCase()}*\n${garis}\n`;
  text += `🔍 *Pantau status servis Anda secara real-time di sini:*\n${linkLacak('id', s.id)}\n${garis}\n`;
  if (s.paid) text += 'Status Pembayaran: *LUNAS*\n';
  else if (s.sisa > 0) text += `Sisa Tagihan: *${rp(s.sisa)}*\n`;
  if (s.status === 'selesai' && s.tgl_garansi_servis_sampai) {
    text += `${garis}\nGaransi servis s/d *${new Date(s.tgl_garansi_servis_sampai).toLocaleDateString('id-ID')} pukul 23:59*\n`;
  }
  if (toko.syarat_singkat) text += `${garis}\n*SYARAT & KETENTUAN:*\n${toko.syarat_singkat}\n`;
  text += `${garis}\n${toko.footer}`;
  openWA(s.telp, text);
}

function waServisMasuk(id) {
  const s = db.servis.find(x => x.id === id);
  if (!s || !s.telp) return alert('Nomor HP tidak ada');
  const toko = getToko(), garis = '=========================';
  const text = `*${toko.nama.toUpperCase()}*\n${toko.alamat}\n${garis}\n*TANDA TERIMA SERVIS*\n${garis}\nHalo *${s.customer}*, jam Anda telah kami terima.\n\n*No Servis:* ${s.id}\n*Barang:* ${s.produk}\n*Keluhan:* ${s.keluhan || '-'}\n\n*⚠️ KONDISI AWAL (Telah Dicek):*\n_${s.kondisi_fisik || 'Normal / Tidak ada catatan'}._\n\nMohon simpan pesan ini. Jika ada kondisi yang tidak tercatat, segera hubungi kami.\n\n🔍 *Lacak status servis:*\n${linkLacak('id', s.id)}\n${garis}\n${toko.syarat_singkat ? '*SYARAT & KETENTUAN:*\n' + toko.syarat_singkat + '\n' + garis + '\n' : ''}${toko.footer}`;
  openWA(s.telp, text);
}

function waReminderBaterai(id) {
  const b = db.baterai.find(x => x.id === id); if (!b || !b.telp) return;
  const toko = getToko();
  const sisaHari = Math.ceil((new Date(b.tgl_expired + 'T23:59:59') - new Date()) / 86400000);
  openWA(b.telp, `*${toko.nama.toUpperCase()}*\nGaransi Baterai ${b.produk} (${b.tipe})\nBerakhir: ${new Date(b.tgl_expired).toLocaleDateString('id-ID')}\nStatus: ${sisaHari < 0 ? 'HABIS' : 'Sisa ' + sisaHari + ' hari'}`);
}

function waAdminLaporan() {
  const toko = getToko();
  if (!toko.telp) return flash('Isi No WA Toko di menu Setting terlebih dahulu', 'err');
  const today = new Date().toDateString();
  const hariIni = w => w && new Date(w).toDateString() === today;

  const trxHari = db.jual.filter(t => hariIni(t.waktu));
  const omzetJual = trxHari.reduce((s, t) => s + t.total, 0);
  const servisHari = db.servis.filter(s => hariIni(s.tgl_selesai));
  const omzetServis = servisHari.reduce((s, t) => s + (t.biaya_pelanggan || 0), 0);
  const batHari = db.baterai.filter(b => hariIni(b.waktu));
  const omzetBat = batHari.reduce((s, b) => s + (b.biaya || 0), 0);
  const totalOmzet = omzetJual + omzetServis + omzetBat;
  const mdrHari = db.kas.filter(k => k.sumber === 'mdr' && hariIni(k.waktu)).reduce((s, k) => s + (k.nominal || 0), 0);

  const piutang = db.servis.filter(s => !s.paid && s.sisa > 0);
  const piutangTotal = piutang.reduce((s, t) => s + t.sisa, 0);
  const servisAktif = db.servis.filter(s => s.status === 'antri' || s.status === 'proses').length;
  const prodLow = db.produk.filter(p => p.stok <= 2);
  const spLow = db.sparePart.filter(s => s.stok <= s.min_stok);
  const batLow = db.stokBaterai.filter(b => b.stok <= b.min_stok);

  const tgl = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const jam = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const garis = '=========================', tipis = '-------------------------';

  let text = `*${toko.nama.toUpperCase()}*\n${garis}\n*LAPORAN HARIAN*\n${tgl}\nDikirim: ${jam}\n${garis}\n*OMZET HARI INI*\n${tipis}\n`;
  text += `- Penjualan Jam : ${rp(omzetJual)}\n  (${trxHari.length} transaksi)\n`;
  text += `- Servis selesai: ${rp(omzetServis)}\n  (${servisHari.length} servis)\n`;
  text += `- Baterai       : ${rp(omzetBat)}\n  (${batHari.length} ganti)\n${tipis}\n*TOTAL: ${rp(totalOmzet)}*\n`;
  if (mdrHari > 0) text += `Biaya Bank (MDR): -${rp(mdrHari)}\nNet Diterima    : ${rp(totalOmzet - mdrHari)}\n`;
  text += `${garis}\n*STATUS TOKO*\n${tipis}\nServis Aktif: ${servisAktif}\nPiutang Servis: ${rp(piutangTotal)} (${piutang.length} nota)\n${garis}\n`;
  if (prodLow.length || spLow.length || batLow.length) {
    text += `*⚠️ STOK MENIPIS*\n${tipis}\n`;
    if (prodLow.length) text += `Produk: ${prodLow.map(p => p.nama + ' (' + p.stok + ')').join(', ')}\n`;
    if (spLow.length) text += `Part: ${spLow.map(s => s.nama + ' (' + s.stok + ')').join(', ')}\n`;
    if (batLow.length) text += `Baterai: ${batLow.map(b => b.tipe + ' (' + b.stok + ')').join(', ')}\n`;
    text += `${garis}\n`;
  }
  text += `${toko.footer}\n_Laporan otomatis dari Sistem Toko_`;
  openWA(toko.telp, text);
}

// === NOTA & KARTU ===
const CSS_STRUK = `@page{margin:0}body{font-family:'Courier New',monospace;font-size:11px;width:58mm;margin:auto;padding:4px}.c{text-align:center}.b{font-weight:bold}hr{border:none;border-top:1px dashed #000;margin:4px 0}table{width:100%}`;
const blokQR = (link, label) => `<div class="c" style="margin-top:8px;"><div style="font-size:9px;margin-bottom:2px;">${label}</div><img src="${qrUrl(link)}" width="80" height="80" alt="QR Code"></div><div class="c" style="font-size:9px;margin-top:5px;word-break:break-all;"><b>${esc(link)}</b></div>`;

function cetakNotaServis(id) {
  const s = db.servis.find(x => x.id === id); if (!s) return;
  const toko = getToko();
  const partsList = [
    ...(s.parts || []).map(p => `- ${esc(p.nama)} x${p.qty} = ${rp(p.harga * p.qty)}`),
    ...(s.baterai || []).map(b => `- ${esc(b.nama)} x${b.qty} = ${rp(b.harga * b.qty)}`)
  ].join('<br>') || '<i>(tanpa spare part)</i>';
  const kondisiHTML = (s.kondisi_fisik && s.kondisi_fisik !== '-') ? `<div style="font-size:9px;margin:2px 0;"><b>Kondisi Awal:</b> ${esc(s.kondisi_fisik)}</div>` : '';

  cetakHTML(`<html><head><meta charset="UTF-8"><style>${CSS_STRUK}</style></head><body>
  ${headerLogo(toko)}<div class="c b" style="font-size:12px">${esc(toko.nama)}</div><div class="c">${esc(toko.alamat)}</div><div class="c b">NOTA SERVIS</div><hr>
  <div>No: ${esc(s.id)}</div><div>${new Date(s.waktu).toLocaleString('id-ID')}</div><div>Pelanggan: ${esc(s.customer)}</div><hr>
  <div>Produk: ${esc(s.produk)}</div><div>Keluhan: ${esc(s.keluhan || '-')}</div>${kondisiHTML}<hr>
  <div class="b">Spare Part:</div><div>${partsList}</div><hr>
  <table><tr><td>Jasa</td><td style="text-align:right">${rp(s.jasa || 0)}</td></tr><tr><td>Spare part</td><td style="text-align:right">${rp(s.total_parts || 0)}</td></tr><tr><td>Baterai</td><td style="text-align:right">${rp(s.total_baterai || 0)}</td></tr><tr><td class="b">TOTAL</td><td class="b" style="text-align:right">${rp(s.biaya_pelanggan)}</td></tr>${(s.dp||0) > 0 ? `<tr><td>DP (sudah dibayar)</td><td style="text-align:right">${rp(s.dp)}</td></tr><tr><td class="b">SISA</td><td class="b" style="text-align:right">${rp(s.sisa||0)}</td></tr>` : ''}</table><hr>
  ${blokQR(linkLacak('id', s.id), 'Scan untuk lacak status servis:')}
  <div class="c" style="margin-top:4px">Simpan nota ini</div></body></html>`);
}

function cetakNotaGabunganServis(groupId) {
  const toko = getToko();
  const list = db.servis.filter(s => s.group_id === groupId);
  if (!list.length) return;
  const totalBiaya = list.reduce((s, x) => s + (x.biaya_pelanggan || 0), 0);
  const totalSisa = list.reduce((s, x) => s + (x.sisa || 0), 0);
  const itemsHTML = list.map((s, idx) => `
      <div style="margin-bottom:6px;font-size:10px;border-bottom:1px dotted #ccc;padding-bottom:4px;">
        <b>${idx + 1}. ${esc(s.produk)}</b><br>No: ${esc(s.id)} | Keluhan: ${esc(s.keluhan || '-')}<br>
        Biaya: Rp ${(s.biaya_pelanggan || 0).toLocaleString('id-ID')}</div>`).join('');

  cetakHTML(`<html><head><meta charset="UTF-8"><style>${CSS_STRUK}</style></head><body>
  ${headerLogo(toko)}<div class="c b" style="font-size:12px">${esc(toko.nama)}</div><div class="c b">NOTA SERVIS GABUNGAN</div><hr>
  <div>Pelanggan: ${esc(list[0].customer)}</div><div>No HP: ${esc(list[0].telp)}</div><div>Tgl: ${new Date().toLocaleString('id-ID')}</div><hr>
  <div class="b">Daftar Barang (${list.length} item):</div>${itemsHTML}<hr>
  <table><tr><td class="b">TOTAL BIAYA</td><td class="b" style="text-align:right">Rp ${totalBiaya.toLocaleString('id-ID')}</td></tr>
  <tr><td class="b">SISA TAGIHAN</td><td class="b" style="text-align:right">Rp ${totalSisa.toLocaleString('id-ID')}</td></tr></table><hr>
  ${blokQR(linkLacak('group_id', groupId), 'Scan untuk lacak semua servis:')}
  <div class="c" style="margin-top:6px">Simpan nota ini</div></body></html>`);
}

function cetakStrukGabunganBaterai(listData, nama, telp, totalBiaya) {
  const toko = getToko();
  const itemsHTML = listData.map((b, idx) => `<tr>
        <td style="font-size:10px;padding:2px 0;">${idx + 1}. ${esc(b.produk)}</td>
        <td style="font-size:10px;text-align:center;">${esc(b.tipe)}</td>
        <td style="font-size:10px;text-align:right;">${(b.biaya || 0).toLocaleString('id-ID')}</td></tr>`).join('');
  cetakHTML(`<html><head><meta charset="UTF-8"><style>${CSS_STRUK}</style></head><body>
  ${headerLogo(toko)}<div class="c b" style="font-size:12px">${esc(toko.nama)}</div><div class="c b">STRUK BATERAI</div><hr>
  <div>Pelanggan: ${esc(nama)}</div><div>Tgl: ${new Date().toLocaleDateString('id-ID')}</div><hr>
  <table><tr><th style="text-align:left;font-size:10px">Jam</th><th style="font-size:10px">Baterai</th><th style="text-align:right;font-size:10px">Harga</th></tr>${itemsHTML}</table><hr>
  <table><tr><td class="b">TOTAL (${listData.length} item)</td><td class="b" style="text-align:right">Rp ${totalBiaya.toLocaleString('id-ID')}</td></tr></table><hr>
  <div class="c" style="font-size:9px;">Garansi baterai s/d ${new Date(listData[0].tgl_expired).toLocaleDateString('id-ID')}<br><br>${esc(toko.footer)}</div></body></html>`);
}

function cetakKartuBaterai(id) {
  const b = db.baterai.find(x => x.id === id);
  if (!b) return flash('Data baterai tidak ditemukan', 'err');
  const toko = getToko();
  cetakHTML(`<html><head><meta charset="UTF-8"><style>${CSS_STRUK}body{text-align:center}</style></head><body>
  ${headerLogo(toko)}<div class="b" style="font-size:12px">KARTU GARANSI BATERAI</div><div class="b">${esc(toko.nama)}</div><hr>
  <div style="text-align:left">No: ${esc(b.id)}<br>Pelanggan: ${esc(b.customer)}<br>Jam: ${esc(b.produk)}<br>Baterai: ${esc(b.tipe)}<br>Tgl Ganti: ${new Date(b.tgl_ganti).toLocaleDateString('id-ID')}<br><span class="b">Garansi s/d: ${new Date(b.tgl_expired).toLocaleDateString('id-ID')}</span></div><hr>
  <div class="b">Simpan kartu ini</div></body></html>`);
}

function cetakKartuGaransiServis(id) {
  const s = db.servis.find(x => x.id === id);
  if (!s || !s.tgl_garansi_servis_sampai) return flash('Belum ada garansi', 'err');
  const toko = getToko();
  cetakHTML(`<html><head><meta charset="UTF-8"><style>${CSS_STRUK}body{text-align:center}</style></head><body>
  ${headerLogo(toko)}<div class="b" style="font-size:12px">KARTU GARANSI SERVIS</div><div class="b">${esc(toko.nama)}</div><hr>
  <div style="text-align:left">No: ${esc(s.id)}<br>Pelanggan: ${esc(s.customer)}<br>Jam: ${esc(s.produk)}<br>Selesai: ${new Date(s.tgl_selesai || s.waktu).toLocaleDateString('id-ID')}<br><span class="b">Garansi s/d: ${new Date(s.tgl_garansi_servis_sampai).toLocaleDateString('id-ID')}</span></div><hr>
  <div class="b">Simpan kartu ini</div></body></html>`);
}

function cetakStrukServis(id) {
  const s = db.servis.find(x => x.id === id); if (!s) return;
  const toko = getToko();
  const partsHTML = [
    ...(s.parts || []).map(p => `<tr><td>${esc(p.nama)} x${p.qty}</td><td style="text-align:right">${(p.qty * p.harga).toLocaleString('id-ID')}</td></tr>`),
    ...(s.baterai || []).map(b => `<tr><td>Baterai ${esc(b.nama)} x${b.qty}</td><td style="text-align:right">${(b.qty * b.harga).toLocaleString('id-ID')}</td></tr>`)
  ].join('') || '<tr><td colspan="2"><i>-</i></td></tr>';

  cetakHTML(`<html><head><meta charset="UTF-8"><style>${CSS_STRUK}table{font-size:11px}</style></head><body>
  ${headerLogo(toko)}<div class="c b">${esc(toko.nama)}</div><div class="c b">STRUK SERVIS</div><hr>
  <div>No: ${esc(s.id)}</div><div>${new Date(s.waktu).toLocaleString('id-ID')}</div><div>Pelanggan: ${esc(s.customer)}</div><hr>
  <div>${esc(s.produk)}</div><hr>
  <table><tr><td>Jasa</td><td style="text-align:right">${(s.jasa || 0).toLocaleString('id-ID')}</td></tr>${partsHTML}</table><hr>
  <table><tr><td class="b">TOTAL</td><td class="b" style="text-align:right">${(s.biaya_pelanggan || 0).toLocaleString('id-ID')}</td></tr>${(s.dp||0) > 0 ? `<tr><td>DP (sudah dibayar)</td><td style="text-align:right">${(s.dp).toLocaleString('id-ID')}</td></tr>` : ''}<tr><td class="b">SISA</td><td class="b" style="text-align:right">${(s.sisa || 0).toLocaleString('id-ID')}</td></tr></table><hr>
  ${blokQR(linkLacak('id', s.id), 'Scan untuk lacak status & garansi:')}
  <div class="c" style="margin-top:6px">${s.paid ? 'LUNAS' : 'BELUM LUNAS'}<br><br>${esc(toko.footer)}</div></body></html>`);
}

// === PELANGGAN ===
function showCustomerHistoryById(id) {
  const p = db.pelanggan.find(x => x.id === id);
  if (p) showCustomerHistory(p.nama, p.telp);
}

const cocokPelanggan = (hp, nama, telp, namaCari) => (hp && telp && telp !== '-' && hp === telp) || (nama && nama.toLowerCase() === (namaCari || '').toLowerCase());

function showCustomerHistory(nama, telp) {
  $('modalCustName').textContent = `Riwayat: ${nama}`;
  const el = $('modalCustContent');
  const allTrx = [
    ...db.jual.filter(t => cocokPelanggan(t.cust_hp, t.cust_nama, telp, nama)).map(t => ({ tgl: t.waktu, tipe: 'Jual', ket: `${(t.items || []).length} item`, total: t.total })),
    ...db.servis.filter(t => cocokPelanggan(t.telp, t.customer, telp, nama)).map(t => ({ tgl: t.waktu, tipe: 'Servis', ket: t.keluhan || t.produk, total: t.biaya_pelanggan })),
    ...db.baterai.filter(t => cocokPelanggan(t.telp, t.customer, telp, nama)).map(t => ({ tgl: t.waktu, tipe: 'Baterai', ket: t.produk, total: t.biaya }))
  ].sort((a, b) => new Date(b.tgl) - new Date(a.tgl));
  el.innerHTML = allTrx.length
    ? `<table><thead><tr><th>Tanggal</th><th>Transaksi</th><th>Total</th></tr></thead><tbody>` + allTrx.map(t => `<tr><td>${new Date(t.tgl).toLocaleDateString('id-ID')}</td><td><b>${t.tipe}</b><br><small>${esc(t.ket)}</small></td><td>${rp(t.total)}</td></tr>`).join('') + '</tbody></table>'
    : '<div class="empty">Belum ada riwayat.</div>';
  $('customerModal').style.display = 'block';
}

function waPelanggan(id) {
  const p = db.pelanggan.find(x => x.id === id);
  if (p) openWA(p.telp, '');
}

async function hapusPelanggan(id) {
  if (!isAdmin() || !confirm('Hapus pelanggan ini?')) return;
  try {
    await dbOk(supabaseClient.from('pelanggan').delete().eq('id', id));
    await catatLog('HAPUS_PELANGGAN', 'Menghapus pelanggan ID: ' + id);
    flash('Pelanggan dihapus');
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

// === SPAREPART ===
async function tambahSparePart() {
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  if (!checkRequired(['spNama'])) return flash('Lengkapi kolom wajib', 'err');
  const nama = txt('spNama'), kategori = $('spKat').value, stokInput = Math.max(0, Math.floor(num('spStok')));
  const existing = db.sparePart.find(sp => sp.nama.toLowerCase() === nama.toLowerCase());
  try {
    if (existing) {
      const stokBaru = await ubahStok('sparepart', existing.id, stokInput);
      flash(`Stok ${nama} ditambahkan (Total: ${stokBaru})`);
    } else {
      const newId = genId('SP');
      await dbOk(supabaseClient.from('sparepart').insert([{
        id: newId, nama, kategori, harga_jual: num('spJual'),
        stok: stokInput, min_stok: num('spMin'), updated_at: nowISO()
      }]));
      await simpanModal('sparepart', newId, num('spBeli'));
      flash('Sparepart baru ditambahkan');
    }
    await catatLog('TAMBAH_SPAREPART', 'Simpan sparepart: ' + nama);
    ['spNama', 'spBeli', 'spJual'].forEach(id => { $(id).value = ''; });
    $('spStok').value = 0;
    tarikSemuaData();
  } catch (e) { flash('Gagal menyimpan: ' + e.message, 'err'); }
}


async function editSparePart(id) {
  if (!isAdmin()) return flash('Akses ditolak', 'err');
  const sp = db.sparePart.find(x => x.id === id); if (!sp) return;
  const nama = prompt('Nama Sparepart:', sp.nama); if (nama === null) return;
  const beli = prompt('Harga Beli:', sp.harga_beli); if (beli === null) return;
  const jual = prompt('Harga Jual:', sp.harga_jual); if (jual === null) return;
  const min = prompt('Min Stok:', sp.min_stok); if (min === null) return;
  try {
    await dbOk(supabaseClient.from('sparepart').update({ nama: nama.trim() || sp.nama, harga_jual: +jual || 0, min_stok: +min || 0 }).eq('id', id));
    await simpanModal('sparepart', id, +beli || 0);
    await catatLog('EDIT_SPAREPART', 'Mengubah data sparepart: ' + (nama.trim() || sp.nama));
    flash('Sparepart diperbarui');
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}


async function hapusSparePart(id) {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa menghapus', 'err');
  if (!confirm('Hapus sparepart ini?')) return;
  try {
    await dbOk(supabaseClient.from('sparepart').delete().eq('id', id));
    await catatLog('HAPUS_SPAREPART', 'Menghapus sparepart ID: ' + id);
    flash('Sparepart dihapus');
    tarikSemuaData();
  } catch (e) { flash('Gagal menghapus! Sparepart ini mungkin sudah dipakai di transaksi servis.', 'err'); }
}

// === SUPPLIER ===
async function simpanSupplier() {
  if (!isAdmin()) return flash('Akses ditolak', 'err');
  if (!checkRequired(['supNama'])) return flash('Nama wajib diisi', 'err');
  const id = txt('supId');
  const data = { nama: txt('supNama'), hp: txt('supHp'), alamat: txt('supAlamat'), catatan: txt('supCatatan') };
  try {
    if (id) await dbOk(supabaseClient.from('supplier').update(data).eq('id', id));
    else await dbOk(supabaseClient.from('supplier').insert([{ id: genId('SUP'), ...data }]));
    await catatLog('SUPPLIER', 'Simpan data supplier: ' + data.nama);
    ['supId', 'supNama', 'supHp', 'supAlamat', 'supCatatan'].forEach(x => { $(x).value = ''; });
    flash('Disimpan');
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

function editSupplier(id) {
  if (!isAdmin()) return flash('Akses ditolak', 'err');
  const s = db.supplier.find(x => x.id === id); if (!s) return;
  $('supId').value = s.id; $('supNama').value = s.nama; $('supHp').value = s.hp || '';
  $('supAlamat').value = s.alamat || ''; $('supCatatan').value = s.catatan || '';
  window.scrollTo(0, 0);
}

async function hapusSupplier(id) {
  if (!isAdmin() || !confirm('Hapus supplier ini?')) return;
  try {
    await dbOk(supabaseClient.from('supplier').delete().eq('id', id));
    await catatLog('HAPUS_SUPPLIER', 'Hapus supplier ID: ' + id);
    flash('Dihapus');
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

// === LAPORAN ===
function hitungLaporan(blnParam = null, thnParam = null) {
  const now = new Date();
  const bln = blnParam !== null ? Number(blnParam) : now.getMonth();
  const thn = thnParam !== null ? Number(thnParam) : now.getFullYear();
  const bulanIni = w => { if (!w) return false; const d = new Date(w); return d.getMonth() === bln && d.getFullYear() === thn; };
  const jualBln = db.jual.filter(t => bulanIni(t.waktu));
  const servisBln = db.servis.filter(s => bulanIni(s.tgl_selesai));
  const batBln = db.baterai.filter(b => bulanIni(b.tgl_ganti));
  const kasBln = db.kas.filter(k => bulanIni(k.waktu));
  const jumlah = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

  const penJual = jumlah(jualBln, t => t.total);
  const penServis = jumlah(servisBln, s => s.biaya_pelanggan);
  const penBat = jumlah(batBln, b => b.biaya);
  const penLain = jumlah(kasBln.filter(k => ['kas_kecil', 'rekonsiliasi'].includes(k.sumber) && k.jenis === 'masuk'), k => k.nominal);

  let hppJual = 0, hppServis = 0, hppBat = 0;
  jualBln.forEach(t => (t.items || []).forEach(i => { const p = db.produk.find(x => x.id === i.produk_id); if (p) hppJual += (p.harga_beli || 0) * i.qty; }));
  servisBln.forEach(s => {
    (s.parts || []).forEach(p => { const sp = db.sparePart.find(x => x.id === p.part_id); if (sp) hppServis += (sp.harga_beli || 0) * p.qty; });
    (s.baterai || []).forEach(b => { const sb = db.stokBaterai.find(x => x.id === b.baterai_id); if (sb) hppServis += (sb.harga_beli || 0) * b.qty; });
  });
  batBln.forEach(b => { const sb = db.stokBaterai.find(x => x.id === b.sb_id); if (sb) hppBat += (sb.harga_beli || 0); });

  const bebanMdr = jumlah(kasBln.filter(k => k.sumber === 'mdr'), k => k.nominal);
  const bebanKasKecil = jumlah(kasBln.filter(k => k.sumber === 'kas_kecil' && k.jenis === 'keluar'), k => k.nominal);
  const bebanLain = jumlah(kasBln.filter(k => k.sumber === 'rekonsiliasi' && k.jenis === 'keluar'), k => k.nominal);
  const bebanBulanan = jumlah(kasBln.filter(k => k.sumber === 'beban_bulanan' && k.jenis === 'keluar'), k => k.nominal);

  const omzet = penJual + penServis + penBat;
  const totalPendapatan = omzet + penLain;
  const totalHpp = hppJual + hppServis + hppBat;
  const totalBeban = bebanMdr + bebanKasKecil + bebanLain + bebanBulanan;
  return {
    kasBln, penJual, penServis, penBat, penLain, omzet, totalPendapatan,
    hppJual, hppServis, hppBat, totalHpp, bebanMdr, bebanKasKecil, bebanLain, bebanBulanan, totalBeban,
    labaKotorOmzet: omzet - totalHpp, labaKotor: totalPendapatan - totalHpp, labaBersih: totalPendapatan - totalHpp - totalBeban
  };
}

function gantiTabLaporan(tab) {
  ['laba_rugi', 'neraca', 'arus_kas'].forEach(t => {
    if ($('konten_' + t)) $('konten_' + t).style.display = (t === tab) ? 'block' : 'none';
    if ($('tab_' + t)) $('tab_' + t).className = (t === tab) ? 'btn-sm blue' : 'btn-sm ghost';
  });
}

function initFilterKeuangan() {
  const selB = $('keuFilterBulan'), selT = $('keuFilterTahun');
  if (!selB || !selT) return;
  const now = new Date();
  if (!selT.options.length) {
    const tahunSet = new Set([now.getFullYear(), now.getFullYear() - 1]);
    [...db.jual, ...db.kas, ...db.servis, ...db.baterai].forEach(x => {
      if (x.waktu) { const y = new Date(x.waktu).getFullYear(); if (!isNaN(y)) tahunSet.add(y); }
    });
    const sorted = Array.from(tahunSet).sort((a, b) => b - a);
    selT.innerHTML = sorted.map(y => `<option value="${y}">${y}</option>`).join('');
    selB.value = String(now.getMonth());
    selT.value = String(now.getFullYear());
  }
}

function hitungLaporanKeuangan() {
  initFilterKeuangan();
  const bln = $('keuFilterBulan') ? Number($('keuFilterBulan').value) : new Date().getMonth();
  const thn = $('keuFilterTahun') ? Number($('keuFilterTahun').value) : new Date().getFullYear();
  const namaBulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'][bln] || '';
  if ($('keuPeriodeInfo')) $('keuPeriodeInfo').textContent = `Periode Laba Rugi & Arus Kas: ${namaBulan} ${thn} (Neraca menampilkan posisi saat ini).`;
  const L = hitungLaporan(bln, thn);
  const set = (id, val) => { const el = $(id); if (el) el.textContent = rp(val); };

  // Laba Rugi
  set('lr_pen_jual', L.penJual); set('lr_pen_servis', L.penServis); set('lr_pen_baterai', L.penBat); set('lr_pen_lain', L.penLain);
  set('lr_total_pendapatan', L.totalPendapatan);
  set('lr_hpp_produk', L.hppJual); set('lr_hpp_part', L.hppServis); set('lr_hpp_baterai', L.hppBat);
  set('lr_total_hpp', L.totalHpp); set('lr_laba_kotor', L.labaKotor);
  pastikanBarisBebanBulanan(); set('lr_beban_bulanan', L.bebanBulanan);
  set('lr_beban_mdr', L.bebanMdr); set('lr_beban_kas_kecil', L.bebanKasKecil); set('lr_beban_lain', L.bebanLain);
  set('lr_total_beban', L.totalBeban); set('lr_laba_bersih', L.labaBersih);

  // Neraca
  const net = f => db.kas.filter(f).reduce((s, k) => s + (k.jenis === 'masuk' ? k.nominal : -k.nominal), 0);
  const kasTunai = net(k => k.metode === 'tunai');
  const saldoBankTercatat = db.bank.reduce((s, b) => s + saldoBankSistem(b), 0);
  const nonTunaiTanpaBank = net(k => k.metode !== 'tunai' && !k.bank_id);
  const saldoBank = saldoBankTercatat + nonTunaiTanpaBank;
  const noteBank = $('nr_bank_note');
  if (noteBank) {
    if (nonTunaiTanpaBank !== 0) {
      noteBank.style.display = 'block';
      noteBank.textContent = `⚠️ Termasuk ${rp(nonTunaiTanpaBank)} non-tunai belum terikat rekening`;
    } else {
      noteBank.style.display = 'none';
    }
  }
  const piutang = db.servis.filter(s => !s.paid && s.sisa > 0).reduce((s, t) => s + t.sisa, 0);
  let persediaan = 0;
  db.produk.forEach(p => persediaan += p.stok * (p.harga_beli || 0));
  db.sparePart.forEach(sp => persediaan += sp.stok * (sp.harga_beli || 0));
  db.stokBaterai.forEach(sb => persediaan += sb.stok * (sb.harga_beli || 0));
  const totalAset = kasTunai + saldoBank + piutang + persediaan;
  const hutang = db.pembelian.filter(p => p.status === 'hutang').reduce((s, p) => s + p.total, 0);
  // Ekuitas = Aset - Kewajiban (modal awal belum dicatat terpisah, jadi neraca selalu seimbang secara otomatis)
  const ekuitas = totalAset - hutang;
  set('nr_kas_tunai', kasTunai); set('nr_saldo_bank', saldoBank); set('nr_piutang', piutang); set('nr_persediaan', persediaan);
  set('nr_total_aset', totalAset); set('nr_hutang', hutang); set('nr_total_kewajiban', hutang);
  set('nr_ekuitas', ekuitas); set('nr_total_pasiva', hutang + ekuitas);

  // Arus Kas (berdasarkan uang yang benar-benar masuk/keluar bulan ini)
  const sum = f => L.kasBln.filter(f).reduce((s, k) => s + k.nominal, 0);
  const sumberOps = ['jual', 'servis', 'baterai'], sumberRestock = ['pembelian', 'pelunasan_hutang'];
  const masukOps = sum(k => k.jenis === 'masuk' && sumberOps.includes(k.sumber));
  const masukLain = sum(k => k.jenis === 'masuk' && !sumberOps.includes(k.sumber));
  const keluarMdr = sum(k => k.jenis === 'keluar' && k.sumber === 'mdr');
  const keluarRestock = sum(k => k.jenis === 'keluar' && sumberRestock.includes(k.sumber));
  const keluarOps = sum(k => k.jenis === 'keluar' && k.sumber !== 'mdr' && !sumberRestock.includes(k.sumber));
  const totalMasuk = masukOps + masukLain, totalKeluar = keluarMdr + keluarRestock + keluarOps;
  set('ak_masuk_operasional', masukOps); set('ak_masuk_lain', masukLain); set('ak_total_masuk', totalMasuk);
  set('ak_keluar_mdr', keluarMdr); set('ak_keluar_operasional', keluarOps); set('ak_keluar_restock', keluarRestock);
  set('ak_total_keluar', totalKeluar); set('ak_arus_bersih', totalMasuk - totalKeluar);
}

// === RENDER UI ===
function setSelect(id, html) {
  const el = $(id); if (!el) return;
  const prev = el.value;
  el.innerHTML = html;
  if (prev && Array.from(el.options).some(o => o.value === prev && !o.disabled)) el.value = prev;
}
const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
const setVal = (id, val) => { const el = $(id); if (el) el.value = val; };
const jam = w => new Date(w).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

function render() {
  if (!$('selProduk')) return;
  const today = new Date().toDateString();

  // 1. User & menu
  const uName = sessionStorage.getItem('ta_user') || 'Guest';
  const uRole = (getRole() || 'guest').toUpperCase();
  const homeUser = $('homeUser');
  if (homeUser) homeUser.innerHTML = `Login sebagai: <b>${esc(uName)}</b> (${esc(uRole)})`;
  if ($('userInfo')) $('userInfo').textContent = `${uName} (${uRole})`;
  if ($('userAvatar')) $('userAvatar').textContent = (uName || 'US').slice(0, 2).toUpperCase();
  const menuAdmin = $('menuAdmin'); if (menuAdmin) menuAdmin.style.display = isAdmin() ? 'grid' : 'none';

  // 2. Dropdown
  const optBank = '<option value="">-- pilih rekening --</option>' + (db.bank || []).map(b => `<option value="${esc(b.id)}">${esc(b.nama)}${b.no ? ' (' + esc(b.no) + ')' : ''}</option>`).join('');
  ['kasBank', 'bankKasir', 'bankDp', 'bankBaterai', 'beBank'].forEach(id => setSelect(id, optBank));
  setSelect('selProduk', db.produk.filter(p => p.stok > 0).map(p => `<option value="${esc(p.id)}">${esc(p.nama)} (stok ${p.stok}) - ${rp(p.harga_jual)}</option>`).join('') || '<option value="">Tidak ada stok</option>');
  setSelect('selSparePart', '<option value="">-- pilih --</option>' + db.sparePart.map(sp => `<option value="${esc(sp.id)}" ${sp.stok === 0 ? 'disabled' : ''}>${esc(sp.nama)} - stok ${sp.stok}</option>`).join(''));
  const optBat = '<option value="">-- pilih --</option>' + db.stokBaterai.map(sb => `<option value="${esc(sb.id)}" ${sb.stok === 0 ? 'disabled' : ''}>${esc(sb.tipe)} - stok ${sb.stok}</option>`).join('');
  setSelect('selBateraiServis', optBat);
  setSelect('bTipeSel', optBat);
  setSelect('beTipeSel', optBat);
  if ($('rsItem')) updateRsItem();

  // 3. Produk (dengan filter cariProduk)
  const qProd = txt('cariProduk').toLowerCase();
  const listProd = db.produk.filter(p => !qProd || (p.nama || '').toLowerCase().includes(qProd) || (p.merek || '').toLowerCase().includes(qProd) || (p.barcode || '').toLowerCase().includes(qProd));
  setHTML('listProduk', listProd.length ? `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      <label style="display:flex;align-items:center;gap:8px;margin:0;cursor:pointer;font-size:15px;">
        <input type="checkbox" id="checkAllProduk" onclick="toggleAllProduk(this)" style="width:20px;height:20px;"> Pilih Semua
      </label>
      <button class="btn-sm ok" onclick="cetakBarcodeMassal()">🖨️ Cetak Barcode Terpilih</button>
    </div>` +
    listProd.map(p => {
      const low = (p.stok || 0) <= 2;
      return `<div class="item-card ${low ? 'low-stock' : ''}">
        <div class="ic-head">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <input type="checkbox" class="chk-barcode" value="${esc(p.id)}" style="width:20px;height:20px;margin-top:2px;flex-shrink:0;">
            <div>
              <div class="ic-title">${esc(p.nama)}</div>
              ${p.merek ? `<div style="font-size:13px;color:#475569;font-weight:600;">${esc(p.merek)}</div>` : ''}
            </div>
          </div>
          <div class="ic-stock ${low ? 'low' : ''}">Stok: ${p.stok}${low ? ' ⚠️' : ''}</div>
        </div>
        <div class="ic-grid" style="margin-bottom:10px;">
          <div class="ic-cell"><span class="ic-lbl">Harga Jual</span><span class="ic-val">${rp(p.harga_jual)}</span></div>
          <div class="ic-cell"><span class="ic-lbl">Barcode</span><span class="ic-val" style="font-size:13px;font-weight:600;color:#475569;">${esc(p.barcode || '-')}</span></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-sm blue" onclick="editProduk('${esc(p.id)}')">✏️ Edit</button>
          <button class="btn-sm warn" onclick="cetakBarcode('${esc(p.id)}')">🏷️ Barcode</button>
          ${isPemilik() ? `<button class="btn-sm danger" onclick="hapusProduk('${esc(p.id)}')">🗑️ Hapus</button>` : ''}
        </div>
      </div>`;
    }).join('') : '<div class="empty">Belum ada produk</div>');

  // 4. Sparepart
  const cariSp = txt('cariSp').toLowerCase();
  const listSp = db.sparePart.filter(sp => !cariSp || (sp.nama || '').toLowerCase().includes(cariSp) || (sp.kategori || '').toLowerCase().includes(cariSp));
  setHTML('listSparePart', listSp.length ? `<table><thead><tr><th>Nama</th><th>Stok</th><th>Harga</th><th>Aksi</th></tr></thead><tbody>` +
    listSp.map(sp => `<tr>
      <td><strong>${esc(sp.nama)}</strong><br><small style="color:#64748b">${esc(sp.kategori)}</small></td>
      <td style="color:${sp.stok <= sp.min_stok ? '#dc2626' : 'inherit'}; font-weight:${sp.stok <= sp.min_stok ? '700' : '400'};">${sp.stok}</td>
      <td>${rp(sp.harga_jual)}${isPemilik() ? `<br><small style="color:#64748b">beli ${rp(sp.harga_beli)}</small>` : ''}</td>
      <td style="white-space:nowrap">
        ${isAdmin() ? `<button class="btn-sm blue" onclick="editSparePart('${esc(sp.id)}')">Edit</button>` : ''}
        ${isPemilik() ? `<button class="btn-sm danger" onclick="hapusSparePart('${esc(sp.id)}')">Hapus</button>` : ''}
      </td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Belum ada sparepart</div>');

  // 5. Stok baterai
  setHTML('listStokBaterai', db.stokBaterai.length ? `<table><thead><tr><th>Tipe</th><th>Stok</th><th>Harga</th><th>Aksi</th></tr></thead><tbody>` +
    db.stokBaterai.map(sb => `<tr><td>${esc(sb.tipe)}</td><td>${sb.stok}</td><td>${rp(sb.harga_jual)}</td>
      <td style="white-space:nowrap"><button class="btn-sm blue" onclick="editStokBaterai('${esc(sb.id)}')">Edit</button>
      ${isPemilik() ? `<button class="btn-sm danger" onclick="hapusStokBaterai('${esc(sb.id)}')">Hapus</button>` : ''}</td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Kosong</div>');

  // 6. Servis
  const srv = db.servis.filter(s => !filterServisStatus || s.status === filterServisStatus);
  setHTML('listServis', srv.length ? srv.map(s => {
    const id = esc(s.id);
    const btnBayar = (!s.paid && s.sisa > 0) ? `<button class="btn-sm ok" onclick="bayarSisaServis('${id}')">Bayar Sisa</button>` : '';
    const btnStruk = s.paid ? `<button class="btn-sm blue" onclick="cetakStrukServis('${id}')">Struk</button>` : '';
    const btnKartu = s.tgl_garansi_servis_sampai ? `<button class="btn-sm blue" onclick="cetakKartuGaransiServis('${id}')">Kartu</button><button class="btn-sm ok" onclick="generateDigitalWarranty('${id}', 'servis')">📸 E-Warranty</button>` : '';
    const btnKlaim = bisaKlaimGaransi(s) ? `<button class="btn-sm warn" onclick="mulaiKlaimGaransi('${id}')">Klaim (${MAX_KLAIM_SERVIS - (s.klaim_count || 0)}x)</button>` : '';
    const lblStatus = { antri: '✔ Diterima', proses: '⚙️ Dikerjakan', selesai: '✅ Selesai', diambil: '📦 Sudah Diambil' }[s.status] || s.status.toUpperCase();
    return `<div class="servis-item ${esc(s.status)}"><h4><span><span class="ticket-id-pill">${id}</span> <b style="margin-left:6px;color:#0f1f3d;">${esc(s.customer)}</b></span> <span class="badge ${esc(s.status)}">${lblStatus}</span></h4>
      <p><b style="color:#0f1f3d;">${esc(s.produk)}</b>${s.keluhan ? ' · Keluhan: ' + esc(s.keluhan) : ''}</p>
      ${s.kondisi_fisik && s.kondisi_fisik !== '-' ? `<p style="color:#dc2626; font-size:11px; margin-top:2px;"><b>⚠️ Kondisi Awal:</b> ${esc(s.kondisi_fisik)}</p>` : ''}
      <p>Total: ${rp(s.biaya_pelanggan)} ${s.paid ? '<span class="badge ok">LUNAS</span>' : `<span class="badge warn">Sisa ${rp(s.sisa)}</span>`}</p>
      ${s.tgl_garansi_servis_sampai ? `<p style="font-size:11px;color:#64748b">Garansi s/d ${new Date(s.tgl_garansi_servis_sampai).toLocaleDateString('id-ID')} 23:59</p>` : ''}
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-sm blue" onclick="ubahStatusServis('${id}')">Status</button>
        <button class="btn-sm ghost" onclick="cetakNotaServis('${id}')">Nota</button>
        ${s.telp ? `<button class="btn-sm ok" onclick="waServisMasuk('${id}')">WA Terima</button>` : ''}
        ${btnBayar}${btnStruk}${btnKartu}${btnKlaim}
        ${s.telp ? `<button class="btn-sm warn" onclick="waServisSelesai('${id}')">WA</button>` : ''}
        ${isAdmin() ? `<button class="btn-sm danger" onclick="hapusServis('${id}')">Hapus</button>` : ''}
      </div></div>`;
  }).join('') : '<div class="empty">Tidak ada servis</div>');
  if ($('hasilCekGaransi')) renderCekGaransi();

  // 7. Riwayat baterai
  const cariB = txt('bCari').toLowerCase();
  const listB = db.baterai.filter(b => !cariB || (b.customer || '').toLowerCase().includes(cariB) || (b.telp || '').includes(cariB) || (b.produk || '').toLowerCase().includes(cariB))
    .sort((a, b) => new Date(a.tgl_expired) - new Date(b.tgl_expired));
  setHTML('listBaterai', listB.length ? listB.map(b => {
    const sisa = Math.ceil((new Date(b.tgl_expired + 'T23:59:59') - new Date()) / 86400000);
    let cls = 'ok', label = 'AKTIF';
    if (sisa < 0) { cls = 'danger'; label = 'EXPIRED'; } else if (sisa <= 30) { cls = 'warn'; label = 'HAMPIR HABIS'; }
    const id = esc(b.id);
    return `<div class="bat-item ${cls}">
      <div style="display:flex;justify-content:space-between;align-items:center"><strong>${esc(b.customer)}</strong><span class="badge ${cls}">${label}${sisa >= 0 ? ' (' + sisa + ' hr)' : ''}</span></div>
      <div style="font-size:12px;color:#475569;margin-top:2px">Barang: ${esc(b.produk)} - Baterai: ${esc(b.tipe)}<br>Tgl: ${new Date(b.tgl_ganti).toLocaleDateString('id-ID')} s/d ${new Date(b.tgl_expired).toLocaleDateString('id-ID')}<br>Biaya: ${rp(b.biaya)} ${b.telp ? '- Telp: ' + esc(b.telp) : ''}</div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        ${b.telp ? `<button class="btn-sm warn" onclick="waReminderBaterai('${id}')">WA</button>` : ''}
        <button class="btn-sm blue" onclick="cetakKartuBaterai('${id}')">Kartu</button>
        <button class="btn-sm warn" onclick="mulaiKlaimBaterai('${id}')">Klaim / Ganti Lagi</button>
        <button class="btn-sm ok" onclick="generateDigitalWarranty('${id}', 'baterai')">📸 E-Warranty</button>
        ${isPemilik() ? `<button class="btn-sm danger" onclick="hapusBaterai('${id}')">Hapus</button>` : ''}
      </div></div>`;
  }).join('') : '<div class="empty">Belum ada data</div>');

  // 8. Transaksi & kas kecil hari ini
  const trxHariIni = db.jual.filter(t => new Date(t.waktu).toDateString() === today);
  setHTML('tblJualHariIni', trxHariIni.length ? trxHariIni.map(t => `<tr><td>${jam(t.waktu)}</td><td>${(t.items || []).length} item<br><small>${esc(labelMetode(t.metode || 'tunai'))}</small></td><td>${rp(t.total)}</td><td style="white-space:nowrap"><button class="btn-sm blue" onclick="cetakStruk('${esc(t.id)}')">Cetak</button><button class="btn-sm ok" onclick="shareStrukDigital('${esc(t.id)}')">WA</button>${isPemilik() ? `<button class="btn-sm danger" onclick="hapusJual('${esc(t.id)}')">Hapus</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">Belum ada transaksi</td></tr>');

  const semuaKK = db.kas.filter(k => k.sumber === 'kas_kecil');
  const saldoKK = semuaKK.reduce((s, k) => s + (k.jenis === 'masuk' ? (k.nominal || 0) : -(k.nominal || 0)), 0);
  const kkHari = semuaKK.filter(k => k.waktu && new Date(k.waktu).toDateString() === today);
  const kkMasuk = kkHari.filter(k => k.jenis === 'masuk').reduce((s, k) => s + (k.nominal || 0), 0);
  const kkKeluar = kkHari.filter(k => k.jenis === 'keluar').reduce((s, k) => s + (k.nominal || 0), 0);
  if ($('kkSaldoTotal')) $('kkSaldoTotal').textContent = rp(saldoKK);
  if ($('kkMasukHari')) $('kkMasukHari').textContent = rp(kkMasuk);
  if ($('kkKeluarHari')) $('kkKeluarHari').textContent = rp(kkKeluar);
  if ($('kasSaldoKecil')) $('kasSaldoKecil').textContent = rp(saldoKK);
  const listKK = kkHari.slice(0, 10);
  setHTML('listKasKecilKasir', listKK.length ? `<table><thead><tr><th>Jam</th><th>Keterangan</th><th>Nominal</th></tr></thead><tbody>` +
    listKK.map(k => `<tr><td>${jam(k.waktu)}</td><td>${esc(k.keterangan)}</td><td style="color:${k.jenis === 'masuk' ? '#16a34a' : '#dc2626'};font-weight:bold;">${k.jenis === 'masuk' ? '📥' : '📤'} ${rp(k.nominal)}</td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Belum ada catatan kas kecil hari ini.</div>');

  // 9. Kas & bank
  const net = f => db.kas.filter(f).reduce((s, k) => s + (k.jenis === 'masuk' ? k.nominal : -k.nominal), 0);
  const saldoTunai = net(k => k.metode === 'tunai'), saldoTotal = net(() => true);
  const kasHariIni = db.kas.filter(k => k.waktu && new Date(k.waktu).toDateString() === today);
  const masukHari = kasHariIni.filter(k => k.jenis === 'masuk').reduce((s, k) => s + (k.nominal || 0), 0);
  const keluarHari = kasHariIni.filter(k => k.jenis === 'keluar').reduce((s, k) => s + (k.nominal || 0), 0);
  const nowBln = new Date().getMonth(), nowThn = new Date().getFullYear();
  const biayaGaransiBln = db.servis
    .filter(s => (s.is_klaim || s.is_klaim_produk || s.garansi === 'garansi') && s.waktu && new Date(s.waktu).getMonth() === nowBln && new Date(s.waktu).getFullYear() === nowThn)
    .reduce((s, x) => {
      const hPart = (x.parts || []).reduce((a, p) => a + ((db.sparePart.find(sp => sp.id === p.part_id)?.harga_beli || 0) * p.qty), 0);
      const hBat = (x.baterai || []).reduce((a, b) => a + ((db.stokBaterai.find(sb => sb.id === b.baterai_id)?.harga_beli || 0) * b.qty), 0);
      return s + hPart + hBat;
    }, 0);
  if ($('kasTunai')) {
    $('kasTunai').textContent = rp(saldoTunai);
    $('kasNonTunai').textContent = rp(saldoTotal - saldoTunai);
    $('kasTotal').textContent = rp(saldoTotal);
  }
  if ($('kasMasukHari')) $('kasMasukHari').textContent = rp(masukHari);
  if ($('kasKeluarHari')) $('kasKeluarHari').textContent = rp(keluarHari);
  if ($('kasGaransi')) $('kasGaransi').textContent = rp(biayaGaransiBln);
  if ($('lapKasHari')) $('lapKasHari').textContent = rp(masukHari);
  // Cocokkan tanpa peduli huruf besar/kecil atau spasi, supaya tombol filter di HTML
  // (mis. "Transfer", "MDR") tetap kena biarpun penulisannya beda dari nilai internal.
  let kasList = db.kas;
  const fk = (filterKasJenis || '').toLowerCase().trim();
  if (fk === 'masuk' || fk === 'keluar') kasList = db.kas.filter(k => k.jenis === fk);
  else if (fk === 'mdr') {
    // Tampilkan biaya MDR-nya SEKALIGUS transaksi pembayaran yang memicunya
    // (dicocokkan lewat ref_id), supaya kelihatan nominal pembayaran aslinya juga.
    const refMdr = new Set(db.kas.filter(k => k.sumber === 'mdr').map(k => k.ref_id));
    kasList = db.kas.filter(k => k.sumber === 'mdr' || refMdr.has(k.ref_id));
  }
  else if (fk && Object.values(DAFTAR_METODE).includes(fk)) kasList = db.kas.filter(k => (k.metode || '').toLowerCase() === fk);
  else if (fk && SUMBER_KAS.includes(fk)) kasList = db.kas.filter(k => (k.sumber || '').toLowerCase() === fk);
  else if (fk) kasList = []; // filter tidak dikenal -> kosongkan, jangan diam-diam tampilkan semua
  const qKas = txt('cariKas').toLowerCase();
  if (qKas) kasList = kasList.filter(k => (k.keterangan || '').toLowerCase().includes(qKas) || (k.metode || '').toLowerCase().includes(qKas) || (k.sumber || '').toLowerCase().includes(qKas));
  setHTML('listKas', kasList.slice(0, 50).map(k => `<div style="font-size:12px;border-bottom:1px solid #eee;padding:4px;display:flex;justify-content:space-between;align-items:center;">
    <div>${new Date(k.waktu).toLocaleDateString('id-ID')} - ${esc(k.keterangan)}</div>
    <div><b style="color:${k.jenis === 'masuk' ? 'green' : 'red'}; margin-right:10px;">${rp(k.nominal)}</b>
    ${isAdmin() ? `<button class="btn-sm danger" onclick="hapusKas('${esc(k.id)}')" style="padding:2px 6px;font-size:10px;">X</button>` : ''}</div></div>`).join('') || '<div class="empty">Tidak ada data</div>');

  setHTML('listBank', db.bank.length ? `<table><thead><tr><th>Bank</th><th>No. Rek</th><th>Saldo Awal</th><th>Saldo Saat Ini</th><th>Aksi</th></tr></thead><tbody>` +
    db.bank.map(b => `<tr><td><strong>${esc(b.nama)}</strong></td><td>${esc(b.no || '-')}</td><td>${rp(b.saldo_awal)}</td>
      <td style="font-weight:bold;color:#0284c7">${rp(saldoBankSistem(b))}</td>
      <td><div style="display:flex; flex-wrap:wrap; gap:5px;">${isAdmin() ? `
        <button class="btn-sm warn" onclick="rekonsiliasiBank('${esc(b.id)}')" style="font-size:11px;">🔄 Rekon</button>
        <button class="btn-sm blue" onclick="editBank('${esc(b.id)}')" style="font-size:11px;">Edit</button>
        <button class="btn-sm danger" onclick="hapusBank('${esc(b.id)}')" style="font-size:11px;">Hapus</button>` : ''}</div></td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Belum ada rekening</div>');

  // 10. Supplier & hutang
  setHTML('listSupplier', db.supplier.length ? `<table><thead><tr><th>Nama</th><th>Kontak</th><th>Aksi</th></tr></thead><tbody>` +
    db.supplier.map(s => `<tr><td><strong>${esc(s.nama)}</strong><br><small>${esc(s.catatan || '')}</small></td><td>${esc(s.hp || '-')}<br><small>${esc(s.alamat || '')}</small></td>
      <td style="white-space:nowrap"><button class="btn-sm blue" onclick="editSupplier('${esc(s.id)}')">Edit</button>${isAdmin() ? `<button class="btn-sm danger" onclick="hapusSupplier('${esc(s.id)}')">Hapus</button>` : ''}</td></tr>`).join('') + '</tbody></table>' : '<div class="empty">Belum ada supplier</div>');

  const hutang = db.pembelian.filter(p => p.status === 'hutang').sort((a, b) => String(a.jatuh_tempo || '9999').localeCompare(String(b.jatuh_tempo || '9999')));
  const totalHutang = hutang.reduce((s, p) => s + (p.total || 0), 0);
  const hariIniStr = tglLokal();
  setHTML('listHutang', hutang.length
    ? `<div style="margin-bottom:8px;font-weight:700;">Total Hutang Usaha: <span style="color:#dc2626">${rp(totalHutang)}</span> (${hutang.length} faktur)</div>` +
      `<table><thead><tr><th>Faktur</th><th>Supplier</th><th>Total</th><th>Aksi</th></tr></thead><tbody>` +
      hutang.map(p => {
        const telat = p.jatuh_tempo && p.jatuh_tempo < hariIniStr;
        const tempo = p.jatuh_tempo ? `<br><small style="color:${telat ? '#dc2626' : '#64748b'}">${telat ? '⚠️ TERLAMBAT - ' : 'Jatuh tempo '}${new Date(p.jatuh_tempo + 'T00:00:00').toLocaleDateString('id-ID')}</small>` : '';
        return `<tr><td>${esc(p.no_faktur || p.id)}<br><small>${new Date(p.waktu).toLocaleDateString('id-ID')}</small></td><td>${esc(p.supplier_nama)}${tempo}</td><td>${rp(p.total)}</td>
      <td>${isAdmin() ? `<button class="btn-sm ok" onclick="lunasiHutang('${esc(p.id)}')">Lunas</button>` : ''}</td></tr>`;
      }).join('') + '</tbody></table>'
    : '<div class="empty">Tidak ada hutang</div>');

  if (isAdmin()) renderBebanTetap();

  // 11. Pelanggan
  const cariP = txt('cariPelanggan').toLowerCase();
  const listP = (db.pelanggan || []).filter(p => !cariP || (p.nama || '').toLowerCase().includes(cariP) || (p.telp || '').includes(cariP));
  setHTML('listPelanggan', listP.length ? `<table><thead><tr><th>Nama</th><th>No HP</th><th>Total Belanja</th><th></th></tr></thead><tbody>` +
    listP.map(p => {
      const cocok = (hp, nama) => cocokPelanggan(hp, nama, p.telp, p.nama);
      const total = db.jual.filter(t => cocok(t.cust_hp, t.cust_nama)).reduce((s, t) => s + t.total, 0)
        + db.servis.filter(t => cocok(t.telp, t.customer)).reduce((s, t) => s + (t.biaya_pelanggan || 0), 0)
        + db.baterai.filter(t => cocok(t.telp, t.customer)).reduce((s, t) => s + (t.biaya || 0), 0);
      return `<tr><td><strong>${esc(p.nama)}</strong></td><td>${esc(p.telp || '-')}</td><td>${rp(total)}<br><small style="color:#f59e0b">⭐ ${p.poin || 0} Poin</small></td>
        <td style="white-space:nowrap"><button class="btn-sm blue" onclick="showCustomerHistoryById('${esc(p.id)}')">Riwayat</button>
        ${p.telp && p.telp !== '-' ? `<button class="btn-sm ok" onclick="waPelanggan('${esc(p.id)}')">WA</button>` : ''}
        ${isAdmin() ? `<button class="btn-sm danger" onclick="hapusPelanggan('${esc(p.id)}')">Hapus</button>` : ''}</td></tr>`;
    }).join('') + '</tbody></table>' : '<div class="empty">Belum ada data pelanggan</div>');

  // 12. Laporan
  const L = hitungLaporan();
  if ($('lapOmzet')) {
    $('lapOmzet').textContent = rp(L.omzet); $('lapServis').textContent = rp(L.penServis);
    $('lapBat').textContent = rp(L.penBat); $('lapLabaKotor').textContent = rp(L.labaKotorOmzet);
    $('lapPiutang').textContent = rp(db.servis.filter(s => !s.paid && s.sisa > 0).reduce((s, t) => s + t.sisa, 0));
  }
  if ($('tblLaris')) {
    const mapP = {};
    db.jual.forEach(t => (t.items || []).forEach(i => {
      if (!mapP[i.nama]) mapP[i.nama] = { qty: 0, omzet: 0 };
      mapP[i.nama].qty += (i.qty || 0); mapP[i.nama].omzet += (i.qty || 0) * (i.harga || 0);
    }));
    const topP = Object.entries(mapP).sort((a, b) => b[1].qty - a[1].qty).slice(0, 10);
    setHTML('tblLaris', topP.length ? topP.map(([nama, v]) => `<tr><td>${esc(nama)}</td><td>${v.qty}</td><td>${rp(v.omzet)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">Belum ada penjualan</td></tr>');
  }
  if ($('tblLarisSp')) {
    const mapSp = {};
    db.servis.forEach(s => (s.parts || []).forEach(p => {
      if (!mapSp[p.nama]) mapSp[p.nama] = { qty: 0, nilai: 0 };
      mapSp[p.nama].qty += (p.qty || 0); mapSp[p.nama].nilai += (p.qty || 0) * (p.harga || 0);
    }));
    const topSp = Object.entries(mapSp).sort((a, b) => b[1].qty - a[1].qty).slice(0, 10);
    setHTML('tblLarisSp', topSp.length ? topSp.map(([nama, v]) => `<tr><td>${esc(nama)}</td><td>${v.qty}</td><td>${rp(v.nilai)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">Belum ada pemakaian sparepart</td></tr>');
  }
  if ($('stokAlert')) {
    const low = [
      ...db.produk.filter(p => p.stok <= 2).map(p => `<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:13px;"><span class="badge proses">JAM</span> <b>${esc(p.nama)}</b> — sisa <b style="color:#f87171">${p.stok}</b></div>`),
      ...db.sparePart.filter(sp => sp.stok <= sp.min_stok).map(sp => `<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:13px;"><span class="badge warn">PART</span> <b>${esc(sp.nama)}</b> — sisa <b style="color:#f87171">${sp.stok}</b> (min ${sp.min_stok})</div>`),
      ...db.stokBaterai.filter(sb => sb.stok <= sb.min_stok).map(sb => `<div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:13px;"><span class="badge ok">BAT</span> <b>${esc(sb.tipe)}</b> — sisa <b style="color:#f87171">${sb.stok}</b> (min ${sb.min_stok})</div>`)
    ];
    setHTML('stokAlert', low.length ? low.join('') : '<div class="empty">Semua stok aman 👍</div>');
  }
  setVal('lrOmzet', rp(L.omzet)); setVal('lrHpp', '-' + rp(L.totalHpp)); setVal('lrLabaKotor', rp(L.labaKotorOmzet));
  setVal('lrBebanKasKecil', '-' + rp(L.bebanKasKecil)); setVal('lrBebanMdr', '-' + rp(L.bebanMdr));
  setVal('lrPendapatanLain', '+' + rp(L.penLain)); setVal('lrLabaBersih', rp(L.labaBersih));
  if ($('lr_laba_bersih')) hitungLaporanKeuangan();

  // 13. Setting, audit
  isiFormSetting();
  if ($('listAuditGlobal')) renderAuditGlobal();
  const elAudit = $('listAuditBarang');
  if (elAudit) {
    elAudit.innerHTML = (db.auditBarang || []).slice(0, 15).map(a => `
      <div style="font-size:12px; border-bottom:1px solid #eee; padding:8px 0;">
        <div style="display:flex; justify-content:space-between;"><b>${new Date(a.waktu).toLocaleDateString('id-ID')}</b>
        <span class="badge ${a.user_name === 'admin' || a.user_name === 'pemilik' ? 'danger' : 'proses'}">${esc((a.user_name || 'user').toUpperCase())}</span></div>
        ${esc(a.tipe ? a.tipe.toUpperCase() : 'ITEM')} - ${esc(a.nama_produk)}<br>
        Sistem: ${a.stok_sistem} | Fisik: ${a.stok_fisik} | <span style="color:${a.selisih < 0 ? '#dc2626' : '#16a34a'};font-weight:bold;">Selisih: ${a.selisih} Qty</span><br>
        <span style="font-size:11px; color:${a.nilai_selisih < 0 ? '#dc2626' : '#16a34a'};">Nilai: ${a.nilai_selisih < 0 ? '- ' : '+ '}${rp(Math.abs(a.nilai_selisih || 0))} (HPP: ${rp(a.harga_beli || 0)})</span><br>
        <small>Ket: ${esc(a.catatan)}</small></div>`).join('') || '<div class="empty">Belum ada riwayat audit.</div>';
  }
  if ($('listAuditLog')) renderAuditLog();
  if ($('listSemuaStok') && isPemilik()) renderSemuaStok();
  if ($('listLaporanAuditRingkas') && isPemilik()) renderLaporanAuditRingkas();
  if ($('listForecastStok')) renderForecastStok();
  renderQuickUI();
}

function updateRsItem() {
  const tipe = $('rsTipe').value, sel = $('rsItem');
  if (!sel) return;
  const prev = sel.value;
  let opts = '<option value="">-- pilih --</option>';
  if (tipe === 'produk') opts += db.produk.map(p => `<option value="${esc(p.id)}">${esc(p.nama)}</option>`).join('');
  if (tipe === 'sparepart') opts += db.sparePart.map(p => `<option value="${esc(p.id)}">${esc(p.nama)}</option>`).join('');
  if (tipe === 'baterai') opts += db.stokBaterai.map(p => `<option value="${esc(p.id)}">${esc(p.tipe)}</option>`).join('');
  sel.innerHTML = opts;
  if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
}

const toggleWrap = (wrapId, selectId, kecuali = ['tunai']) => { const w = $(wrapId), s = $(selectId); if (w && s) w.style.display = kecuali.includes(s.value) ? 'none' : 'grid'; };
function toggleKasBank() { toggleWrap('wrapKasBank', 'kasMetode'); }
function toggleBankKasir() { toggleWrap('wrapBankKasir', 'metodeBayar'); }
function toggleBankDp() { toggleWrap('wrapBankDp', $('metodeDpGroup') ? 'metodeDpGroup' : 'metodeDp'); }
function toggleBankBaterai() { toggleWrap('wrapBankBaterai', 'metodeBaterai', ['tunai', 'hutang']); }

function statusGaransiServis(s) {
  if (!s.tgl_garansi_servis_sampai) return null;
  const sisa = Math.ceil((new Date(s.tgl_garansi_servis_sampai + 'T23:59:59') - new Date()) / 86400000);
  if (sisa < 0) return { cls: 'danger', label: 'GARANSI HABIS', sisa };
  if (sisa <= 14) return { cls: 'warn', label: `GARANSI ${sisa}hr`, sisa };
  return { cls: 'ok', label: `GARANSI ${sisa}hr`, sisa };
}

// === GARANSI PRODUK (klaim dari nota pembelian) ===
function tglExpiredJual(j) {
  if (!j.garansi_hari || j.garansi_hari <= 0) return null;
  const d = new Date(j.waktu); d.setDate(d.getDate() + j.garansi_hari); return d;
}
function statusGaransiProduk(j) {
  const exp = tglExpiredJual(j); if (!exp) return null;
  const sisa = Math.ceil((exp - new Date()) / 86400000);
  if (sisa < 0) return { cls: 'danger', label: 'GARANSI HABIS', sisa, exp };
  if (sisa <= 3) return { cls: 'warn', label: `GARANSI ${sisa}hr`, sisa, exp };
  return { cls: 'ok', label: `GARANSI ${sisa}hr`, sisa, exp };
}
function bisaKlaimGaransiProduk(j) {
  const st = statusGaransiProduk(j);
  if (!st) return false;
  const klaimTerpakai = db.servis.filter(s => s.parent_jual_id === j.id && s.is_klaim_produk).length;
  if (klaimTerpakai >= MAX_KLAIM_SERVIS) return false;
  // Kalau sudah lewat tanggal garansi, kasir tidak bisa klaim sendiri (lihat mulaiKlaimGaransiProduk)
  return true;
}

function mulaiKlaimGaransiProduk(jualId) {
  const j = db.jual.find(x => x.id === jualId); if (!j) return;
  if (!bisaKlaimGaransiProduk(j)) return flash('Nota ini tidak bisa diklaim (kuota habis atau tidak ada garansi)', 'err');

  const st = statusGaransiProduk(j);
  if (st.sisa < 0) {
    if (!confirm(`⚠️ PERINGATAN GARANSI HABIS\n\nGaransi nota ${j.id} sudah lewat ${Math.abs(st.sisa)} hari.\nJangan janjikan gratis sebelum disetujui Admin/Pemilik (wajib otorisasi saat simpan).\n\nLanjutkan?`)) return;
  }

  let namaBarang = j.items?.[0]?.nama || '-';
  if ((j.items || []).length > 1) {
    const pilihan = j.items.map((it, i) => `${i + 1}. ${it.nama}`).join('\n');
    const idx = prompt(`Nota ini berisi beberapa barang, pilih yang diklaim:\n${pilihan}`, '1');
    if (idx === null) return;
    const i = (+idx || 1) - 1;
    if (j.items[i]) namaBarang = j.items[i].nama;
  }

  resetModeKlaim(); // bersihkan dulu sisa mode klaim SERVIS sebelumnya (kalau ada)
  $('sNama').value = j.cust_nama || ''; $('sHp').value = j.cust_hp || ''; $('sProduk').value = namaBarang;
  $('sGaransi').value = 'luar'; $('sGaransi').disabled = true;
  $('sJasa').value = 0; $('sJasa').readOnly = true;
  modeKlaimProdukJualId = j.id;
  const banner = $('klaimBanner');
  if (banner) { banner.style.display = 'block'; banner.innerHTML = `<b>MODE KLAIM GARANSI PRODUK</b> - Dari nota: ${esc(j.id)}<br><button class="btn-sm danger" onclick="batalKlaimGaransiProduk()">Batal Klaim</button>`; }
  bukaMenu('servis'); window.scrollTo(0, 0); hitungTotalServis();
  flash('Mode klaim garansi produk aktif. Isi keluhan lalu "Tambah Jam Ini ke List".');
}
function batalKlaimGaransiProduk() {
  modeKlaimProdukJualId = '';
  $('sJasa').value = 0; $('sJasa').readOnly = false; $('sGaransi').value = 'garansi'; $('sGaransi').disabled = false;
  ['sNama', 'sHp', 'sProduk', 'sKeluhan'].forEach(x => { if ($(x)) $(x).value = ''; });
  const banner = $('klaimBanner'); if (banner) banner.style.display = 'none';
  hitungTotalServis(); flash('Klaim dibatalkan');
}

function renderCekGaransi() {
  const el = $('hasilCekGaransi'); if (!el) return;
  const q = txt('cariGaransi').toLowerCase();
  if (!q) { el.innerHTML = '<div class="empty">Ketik untuk mencari garansi servis / produk</div>'; return; }

  const listServis = db.servis.filter(s => s.tgl_garansi_servis_sampai && (s.id.toLowerCase().includes(q) || (s.customer || '').toLowerCase().includes(q) || (s.telp || '').includes(q) || (s.produk || '').toLowerCase().includes(q)))
    .sort((a, b) => new Date(b.tgl_garansi_servis_sampai) - new Date(a.tgl_garansi_servis_sampai));
  const htmlServis = listServis.map(s => {
    const st = statusGaransiServis(s), id = esc(s.id);
    const klaimInfo = s.klaim_count > 0 ? ` - ${s.klaim_count}x klaim` : '';
    return `<div class="bat-item ${st.cls}" style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;align-items:center"><strong>${esc(s.customer)}</strong><span class="badge ${st.cls}">${st.label}</span></div>
      <div style="font-size:12px;color:#475569;margin-top:2px">${id} - ${esc(s.produk)} <span style="color:#94a3b8">(garansi servis)</span><br>Selesai: ${new Date(s.tgl_selesai || s.waktu).toLocaleDateString('id-ID')} - <b>Garansi s/d: ${new Date(s.tgl_garansi_servis_sampai).toLocaleDateString('id-ID')}</b>${klaimInfo}<br>Telp: ${esc(s.telp || '-')}</div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn-sm blue" onclick="cetakKartuGaransiServis('${id}')">Kartu</button><button class="btn-sm ok" onclick="generateDigitalWarranty('${id}', 'servis')">📸 E-Warranty</button>${s.telp ? `<button class="btn-sm warn" onclick="waServisSelesai('${id}')">WA</button>` : ''}</div></div>`;
  }).join('');

  const listProduk = db.jual.filter(j => tglExpiredJual(j) && (j.id.toLowerCase().includes(q) || (j.cust_nama || '').toLowerCase().includes(q) || (j.cust_hp || '').includes(q) || (j.items || []).some(i => i.nama.toLowerCase().includes(q))))
    .sort((a, b) => tglExpiredJual(b) - tglExpiredJual(a));
  const htmlProduk = listProduk.map(j => {
    const st = statusGaransiProduk(j), id = esc(j.id);
    const klaimTerpakai = db.servis.filter(s => s.parent_jual_id === j.id && s.is_klaim_produk).length;
    const namaBarang = (j.items || []).map(i => i.nama).join(', ') || '-';
    const btnKlaim = bisaKlaimGaransiProduk(j) ? `<button class="btn-sm warn" onclick="mulaiKlaimGaransiProduk('${id}')">Klaim Garansi Produk (${MAX_KLAIM_SERVIS - klaimTerpakai}x)</button>` : (klaimTerpakai >= MAX_KLAIM_SERVIS ? `<span class="badge danger">Kuota klaim habis</span>` : '');
    return `<div class="bat-item ${st.cls}" style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;align-items:center"><strong>${esc(j.cust_nama || '-')}</strong><span class="badge ${st.cls}">${st.label}</span></div>
      <div style="font-size:12px;color:#475569;margin-top:2px">${id} - ${esc(namaBarang)} <span style="color:#94a3b8">(garansi produk)</span><br>Tgl beli: ${new Date(j.waktu).toLocaleDateString('id-ID')} - <b>Garansi s/d: ${st.exp.toLocaleDateString('id-ID')}</b>${klaimTerpakai > 0 ? ` - ${klaimTerpakai}x klaim` : ''}<br>Telp: ${esc(j.cust_hp || '-')}</div>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${btnKlaim}</div></div>`;
  }).join('');

  el.innerHTML = (htmlServis + htmlProduk) || '<div class="empty">Tidak ditemukan</div>';
}

// === DIAGNOSA SISTEM (jalankan: auditSistem() di Console) ===
async function auditSistem() {
  const laporan = { fungsiHilang: [], htmlHilang: [], tabelError: [] };
  const fungsiWajib = ['login', 'logout', 'bukaMenu', 'flash', 'render', 'tarikSemuaData', 'catatLog', 'simpanProduk', 'hapusProduk', 'editProduk', 'prosesRestock', 'addCart', 'hapusCart', 'prosesBayar', 'renderCart', 'addPartServis', 'hapusPartServis', 'renderServisCart', 'addBateraiServis', 'hapusBateraiServis', 'renderBateraiServisCart', 'simpanSemuaServis', 'bayarSisaServis', 'ubahStatusServis', 'hapusServis', 'addBateraiCart', 'hapusBateraiCart', 'renderBateraiCart', 'simpanBaterai', 'pilihBaterai', 'tambahStokBaterai', 'hapusBaterai', 'simpanKasManual', 'simpanKasKecilKasir', 'tambahBank', 'simpanToko', 'simpanMDR', 'simpanGaransiServis', 'simpanAturanDiskon', 'renderAuditGlobal', 'simpanAuditGlobal', 'renderAuditLog', 'filterKas', 'filterServis', 'filterAudit', 'waAdminLaporan', 'formatNama', 'cekPoinPelanggan', 'hitungMDR', 'labelMetode', 'cetakKartuBaterai', 'lunasiHutang'];
  fungsiWajib.forEach(f => { try { if (typeof eval(f) !== 'function') laporan.fungsiHilang.push(f); } catch (e) { laporan.fungsiHilang.push(f); } });

  const htmlWajib = ['loginOverlay', 'loginUser', 'pinInput', 'homeUser', 'menuAdmin', 'selProduk', 'qty', 'cartList', 'cartTotal', 'metodeBayar', 'bayar', 'custNama', 'custHp', 'infoPoin', 'tukarPoin', 'tipeDiskon', 'nilaiDiskon', 'sNama', 'sProduk', 'sGaransi', 'sJasa', 'sParentId', 'selSparePart', 'cartServisList', 'cartServisTotal', 'selBateraiServis', 'cartBateraiServisList', 'cartBateraiServisTotal', 'sDpGroup', 'metodeDpGroup', 'listServis', 'cariGaransi', 'hasilCekGaransi', 'bNama', 'bProduk', 'bTipeSel', 'cartBateraiList', 'displayTotalBaterai', 'metodeBaterai', 'listStokBaterai', 'listBaterai', 'bCari', 'sbTipe', 'sbStok', 'pNama', 'pMerek', 'pHBeli', 'pHJual', 'pStok', 'listProduk', 'spNama', 'listSparePart', 'supNama', 'listSupplier', 'listHutang', 'kasTunai', 'kasNonTunai', 'kasTotal', 'listKas', 'listBank', 'kasNominal', 'kasKet', 'listPelanggan', 'cariPelanggan', 'lapOmzet', 'lapServis', 'lapBat', 'lapLabaKotor', 'lr_laba_bersih', 'lr_total_pendapatan', 'nr_total_aset', 'ak_arus_bersih', 'tkNama', 'tkTelp', 'setMdrCcBca', 'setMdrDcBca', 'listAuditLog', 'listAuditGlobal', 'listAuditBarang', 'auditCatatanMassal', 'msg'];
  htmlWajib.forEach(id => { if (!$(id)) laporan.htmlHilang.push(id); });

  const tabelWajib = ['settings', 'produk', 'sparepart', 'stok_baterai', 'jual', 'jual_items', 'servis', 'servis_parts', 'servis_baterai', 'baterai', 'kas', 'pelanggan', 'bank', 'supplier', 'pembelian', 'audit_barang', 'audit_log'];
  for (const tabel of tabelWajib) {
    try {
      const { error } = await supabaseClient.from(tabel).select('id').limit(1);
      if (error) laporan.tabelError.push(`${tabel}: ${error.message}`);
    } catch (e) { laporan.tabelError.push(`${tabel}: Gagal akses`); }
  }
  console.log('=== HASIL AUDIT SISTEM ===');
  console.log('Fungsi hilang:', laporan.fungsiHilang.length ? laporan.fungsiHilang : 'aman');
  console.log('Elemen HTML hilang:', laporan.htmlHilang.length ? laporan.htmlHilang : 'aman');
  console.log('Tabel error:', laporan.tabelError.length ? laporan.tabelError : 'aman');
  alert(`=== AUDIT SISTEM ===\n\nFungsi hilang: ${laporan.fungsiHilang.length}\nElemen HTML hilang: ${laporan.htmlHilang.length}\nTabel error: ${laporan.tabelError.length}\n\nBuka Console (F12) untuk detail.`);
}


// === HITUNG STOK (Opsi B: kasir menghitung BUTA, admin cross-check) ===
// Dibuat lewat JS saat login, tidak tergantung elemen HTML yang mungkin belum
// ada di index.html -- supaya fitur ini langsung aktif tanpa perlu ubah HTML.
let dataHitungStok = []; // [{tipe, id, nama}] hanya nama, TANPA angka stok sistem

function pasangUIHitungStok() {
  if ($('btnHitungStok')) return; // sudah terpasang, jangan dobel

  const btn = document.createElement('button');
  btn.id = 'btnHitungStok';
  btn.innerText = '📋 Hitung Stok';
  btn.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:900;padding:10px 14px;border-radius:999px;background:#0284c7;color:#fff;border:none;font-weight:700;font-size:13px;box-shadow:0 4px 10px rgba(0,0,0,.25);display:none;';
  btn.onclick = bukaHitungStok;
  document.body.appendChild(btn);

  // Semua warna ditulis eksplisit (bukan mewarisi tema gelap aplikasi),
  // supaya teks selalu terbaca di kartu putih ini.
  const ov = document.createElement('div');
  ov.id = 'overlayHitungStok';
  ov.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:9100;';
  ov.innerHTML = `
    <div style="background:#ffffff;color:#0f172a;max-width:480px;width:calc(100% - 24px);margin:5vh auto;border-radius:12px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;">
      <div style="padding:14px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
        <b style="color:#0f172a;font-size:16px;">📋 Hitung Stok Fisik</b>
        <button onclick="tutupHitungStok()" style="border:none;background:#f1f5f9;color:#0f172a;font-size:16px;cursor:pointer;width:32px;height:32px;border-radius:8px;">✕</button>
      </div>
      <div style="padding:10px 16px;font-size:12px;color:#475569;">
        Hitung barang di rak lalu isi jumlahnya di sini. <b style="color:#0f172a">Hasil ini hanya draft</b>
        untuk dicocokkan Admin/Pemilik &mdash; jumlahnya tidak langsung mengubah stok.
      </div>
      <div style="padding:0 16px 10px;">
        <input id="cariHitungStok" placeholder="Cari nama barang..." oninput="renderHitungStokInput()"
          style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:8px;background:#ffffff;color:#0f172a;font-size:14px;">
      </div>
      <div id="listHitungStokInput" style="flex:1;overflow-y:auto;padding:0 16px;"></div>
      <div style="padding:12px 16px;border-top:1px solid #e2e8f0;">
        <button onclick="kirimHitungStok()" style="width:100%;padding:12px;background:#16a34a;color:#ffffff;border:none;border-radius:8px;font-weight:700;font-size:15px;">Kirim Hasil Hitung</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
}

// Tombol mengambang hanya tampil di Menu Utama supaya tidak menutupi
// tombol lain (mis. "Simpan Servis" di bagian bawah layar).
function aturTombolHitungStok(tabId) {
  const btn = $('btnHitungStok'); if (!btn) return;
  const aktif = tabId !== undefined ? tabId === 'home' : !!$('home')?.classList.contains('active');
  btn.style.display = (aktif && ['kasir', 'admin', 'pemilik'].includes(getRole())) ? 'block' : 'none';
}

function bukaHitungStok() {
  dataHitungStok = [
    ...db.produk.map(p => ({ tipe: 'produk', id: p.id, nama: p.nama })),
    ...db.sparePart.map(s => ({ tipe: 'sparepart', id: s.id, nama: s.nama })),
    ...db.stokBaterai.map(b => ({ tipe: 'stok_baterai', id: b.id, nama: b.tipe }))
  ];
  $('cariHitungStok').value = '';
  renderHitungStokInput();
  $('overlayHitungStok').style.display = 'block';
  if ($('btnHitungStok')) $('btnHitungStok').style.display = 'none';
}
function tutupHitungStok() { $('overlayHitungStok').style.display = 'none'; aturTombolHitungStok(); }

function renderHitungStokInput() {
  const q = txt('cariHitungStok').toLowerCase();
  const list = dataHitungStok.filter(x => !q || x.nama.toLowerCase().includes(q));
  const label = t => t === 'produk' ? ['JAM', '#dbeafe', '#1e40af'] : (t === 'sparepart' ? ['PART', '#fef3c7', '#92400e'] : ['BAT', '#dcfce7', '#166534']);
  $('listHitungStokInput').innerHTML = list.length ? list.map(x => {
    const [teks, bg, fg] = label(x.tipe);
    return `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9;">
      <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;background:${bg};color:${fg};">${teks}</span>
      <div style="flex:1;font-size:13px;color:#0f172a;">${esc(x.nama)}</div>
      <input type="number" min="0" placeholder="-" data-tipe="${x.tipe}" data-id="${esc(x.id)}"
        style="width:70px;padding:6px;text-align:center;border:1px solid #cbd5e1;border-radius:6px;background:#ffffff;color:#0f172a;font-size:14px;">
    </div>`;
  }).join('') : '<div style="padding:16px;color:#64748b;text-align:center;">Tidak ditemukan</div>';
}

async function kirimHitungStok() {
  const entries = Array.from(document.querySelectorAll('#listHitungStokInput input'))
    .filter(el => el.value !== '')
    .map(el => ({ tipe: el.dataset.tipe, item_id: el.dataset.id, stok_fisik: Math.max(0, Math.floor(+el.value)) }));
  if (!entries.length) return flash('Isi dulu minimal 1 jumlah barang', 'err');
  try {
    const { error } = await supabaseClient.rpc('submit_audit_draft_batch', { p_entries: entries });
    if (error) throw error;
    flash(`Hasil hitung ${entries.length} barang terkirim ke Admin/Pemilik`);
    tutupHitungStok();
  } catch (e) { flash('Gagal mengirim: ' + e.message, 'err'); }
}


// === PEMBELIAN DARI SUPPLIER & HUTANG USAHA ===
// Form dibuat lewat JS (tidak perlu ubah index.html). Satu faktur bisa berisi banyak barang.
let barisPembelian = [];   // [{ tipe, item_id, qty, harga }]

function pasangUIPembelian() {
  if ($('btnCatatPembelian') || !$('listHutang')) return;
  const kartuHutang = $('listHutang').parentElement;
  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.innerHTML = '<button id="btnCatatPembelian" class="btn" onclick="bukaFormPembelian()">🧾 Catat Pembelian dari Supplier</button>';
  kartuHutang.parentElement.insertBefore(wrap, kartuHutang);

  const ov = document.createElement('div');
  ov.id = 'overlayPembelian';
  ov.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:9100;overflow-y:auto;';
  const gaya = 'width:100%;box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;font-size:14px;margin-bottom:8px;';
  ov.innerHTML = `
    <div style="background:#fff;color:#0f172a;max-width:520px;width:calc(100% - 24px);margin:3vh auto;border-radius:12px;box-sizing:border-box;padding:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <b style="font-size:16px">🧾 Catat Pembelian dari Supplier</b>
        <button onclick="tutupFormPembelian()" style="border:none;background:#f1f5f9;color:#0f172a;width:32px;height:32px;border-radius:8px;font-size:16px;">✕</button>
      </div>
      <label style="font-size:12px;color:#475569">Supplier *</label>
      <select id="pbSupplier" style="${gaya}"></select>
      <label style="font-size:12px;color:#475569">No. Faktur / Nota Supplier</label>
      <input id="pbFaktur" placeholder="Opsional" style="${gaya}">
      <label style="font-size:12px;color:#475569">Pembayaran *</label>
      <select id="pbStatus" onchange="aturFormPembelian()" style="${gaya}">
        <option value="lunas">Lunas (bayar sekarang)</option>
        <option value="hutang">Hutang (bayar nanti)</option>
      </select>
      <div id="pbWrapLunas">
        <label style="font-size:12px;color:#475569">Metode bayar</label>
        <select id="pbMetode" onchange="aturFormPembelian()" style="${gaya}">
          <option value="tunai">Tunai</option><option value="transfer">Transfer</option><option value="qris">QRIS</option>
        </select>
        <div id="pbWrapBank"><label style="font-size:12px;color:#475569">Dari rekening</label><select id="pbBank" style="${gaya}"></select></div>
      </div>
      <div id="pbWrapHutang" style="display:none">
        <label style="font-size:12px;color:#475569">Jatuh tempo pembayaran</label>
        <input id="pbTempo" type="date" style="${gaya}">
      </div>
      <b style="font-size:13px">Barang yang dibeli</b>
      <div id="pbBaris" style="margin:6px 0"></div>
      <button onclick="tambahBarisPembelian()" style="padding:8px 12px;border:1px dashed #94a3b8;background:#f8fafc;color:#0f172a;border-radius:8px;margin-bottom:10px;">+ Tambah Barang</button>
      <div style="font-size:15px;font-weight:700;margin-bottom:10px;">Total: <span id="pbTotal">Rp 0</span></div>
      <button id="btnKirimPembelian" onclick="kirimPembelian()" style="width:100%;padding:12px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:15px;">Simpan Pembelian</button>
      <div style="font-size:11px;color:#64748b;margin-top:8px;">Barang yang belum terdaftar harus dibuat dulu di menu Produk / Sparepart / Baterai (stok 0). Stok &amp; harga modal rata-rata diperbarui otomatis.</div>
    </div>`;
  document.body.appendChild(ov);
}

const OPSI_TIPE_BELI = [['produk', 'Jam'], ['sparepart', 'Sparepart'], ['stok_baterai', 'Baterai']];
function daftarBarangUntukBeli(tipe) {
  if (tipe === 'produk') return db.produk.map(x => ({ id: x.id, nama: x.nama }));
  if (tipe === 'sparepart') return db.sparePart.map(x => ({ id: x.id, nama: x.nama }));
  return db.stokBaterai.map(x => ({ id: x.id, nama: x.tipe }));
}

function bukaFormPembelian() {
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  if (!db.supplier.length) return flash('Tambahkan supplier dulu di bagian atas halaman ini', 'err');
  $('pbSupplier').innerHTML = db.supplier.map(s => `<option value="${esc(s.id)}">${esc(s.nama)}</option>`).join('');
  $('pbBank').innerHTML = (db.bank || []).map(b => `<option value="${esc(b.id)}">${esc(b.nama)}${b.no ? ' (' + esc(b.no) + ')' : ''}</option>`).join('');
  $('pbFaktur').value = ''; $('pbStatus').value = 'lunas'; $('pbMetode').value = 'tunai'; $('pbTempo').value = '';
  barisPembelian = [{ tipe: 'produk', item_id: '', qty: 1, harga: 0 }];
  aturFormPembelian(); renderBarisPembelian();
  $('overlayPembelian').style.display = 'block';
}
function tutupFormPembelian() { $('overlayPembelian').style.display = 'none'; }

function aturFormPembelian() {
  const lunas = $('pbStatus').value === 'lunas';
  $('pbWrapLunas').style.display = lunas ? 'block' : 'none';
  $('pbWrapHutang').style.display = lunas ? 'none' : 'block';
  $('pbWrapBank').style.display = (lunas && $('pbMetode').value !== 'tunai') ? 'block' : 'none';
}

function tambahBarisPembelian() { barisPembelian.push({ tipe: 'produk', item_id: '', qty: 1, harga: 0 }); renderBarisPembelian(); }
function hapusBarisPembelian(i) { barisPembelian.splice(i, 1); if (!barisPembelian.length) tambahBarisPembelian(); else renderBarisPembelian(); }
function ubahBarisPembelian(i, kolom, nilai) {
  const b = barisPembelian[i]; if (!b) return;
  if (kolom === 'tipe') { b.tipe = nilai; b.item_id = ''; renderBarisPembelian(); return; }
  if (kolom === 'item_id') b.item_id = nilai;
  else b[kolom] = Math.max(0, +nilai || 0);
  hitungTotalPembelian();
}
function hitungTotalPembelian() {
  const total = barisPembelian.reduce((s, b) => s + (b.qty || 0) * (b.harga || 0), 0);
  if ($('pbTotal')) $('pbTotal').textContent = rp(total);
  return total;
}
function renderBarisPembelian() {
  const gaya = 'padding:7px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#0f172a;font-size:13px;box-sizing:border-box;';
  $('pbBaris').innerHTML = barisPembelian.map((b, i) => `
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px;margin-bottom:6px;">
      <div style="display:flex;gap:6px;margin-bottom:6px;">
        <select onchange="ubahBarisPembelian(${i},'tipe',this.value)" style="${gaya}width:32%;">
          ${OPSI_TIPE_BELI.map(([v, l]) => `<option value="${v}" ${b.tipe === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select onchange="ubahBarisPembelian(${i},'item_id',this.value)" style="${gaya}flex:1;min-width:0;">
          <option value="">-- pilih barang --</option>
          ${daftarBarangUntukBeli(b.tipe).map(x => `<option value="${esc(x.id)}" ${b.item_id === x.id ? 'selected' : ''}>${esc(x.nama)}</option>`).join('')}
        </select>
        <button onclick="hapusBarisPembelian(${i})" style="border:none;background:#fee2e2;color:#b91c1c;border-radius:6px;width:32px;">✕</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <input type="number" min="1" value="${b.qty}" oninput="ubahBarisPembelian(${i},'qty',this.value)" placeholder="Qty" style="${gaya}width:28%;">
        <input type="number" min="0" value="${b.harga || ''}" oninput="ubahBarisPembelian(${i},'harga',this.value)" placeholder="Harga beli / unit" style="${gaya}flex:1;">
      </div>
    </div>`).join('');
  hitungTotalPembelian();
}

let sedangSimpanPembelian = false;
async function kirimPembelian() {
  if (sedangSimpanPembelian) return;
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  const items = barisPembelian.filter(b => b.item_id);
  if (!items.length) return flash('Pilih minimal 1 barang', 'err');
  if (items.some(b => !(b.qty >= 1))) return flash('Qty harus minimal 1', 'err');
  const status = $('pbStatus').value, metode = $('pbMetode').value;
  const bankId = (status === 'lunas' && metode !== 'tunai') ? ($('pbBank').value || null) : null;

  sedangSimpanPembelian = true;
  const btn = $('btnKirimPembelian'); if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }
  try {
    const { data, error } = await supabaseClient.rpc('proses_pembelian_supplier', {
      p_supplier_id: $('pbSupplier').value, p_no_faktur: txt('pbFaktur') || null,
      p_items: items.map(b => ({ tipe: b.tipe, item_id: b.item_id, qty: b.qty, harga: b.harga })),
      p_status: status, p_metode: status === 'lunas' ? metode : 'tunai', p_bank_id: bankId,
      p_jatuh_tempo: status === 'hutang' ? ($('pbTempo').value || null) : null
    });
    if (error) throw error;
    flash(`Pembelian ${rp(data.total)} dari ${data.supplier} tersimpan (${status === 'hutang' ? 'masuk hutang usaha' : 'lunas'})`);
    tutupFormPembelian();
    tarikSemuaData();
  } catch (e) { flash('Gagal menyimpan pembelian: ' + e.message, 'err'); }
  finally { sedangSimpanPembelian = false; if (btn) { btn.disabled = false; btn.textContent = 'Simpan Pembelian'; } }
}


// === PENGELUARAN BULANAN (sewa, listrik, gaji, dll.) ===
function pasangUIBebanBulanan() {
  if ($('kartuBebanBulanan') || !$('listKas')) return;
  const kartuKas = $('listKas').parentElement;
  const kartu = document.createElement('div');
  kartu.className = 'card';
  kartu.id = 'kartuBebanBulanan';
  kartu.innerHTML = `
    <h3>Pengeluaran Bulanan (Sewa, Listrik, Gaji, dll.)</h3>
    <div id="ringkasBebanTetap" style="margin-bottom:8px;font-size:13px;"></div>
    <div id="listBebanTetap"></div>
    <div id="formBebanTetap" style="display:none;margin-top:10px;border-top:1px dashed #475569;padding-top:10px;">
      <label>Tambah Beban Tetap (khusus Pemilik)</label>
      <input id="bbNama" placeholder="Nama beban, contoh: Sewa Toko">
      <input id="bbNominal" type="number" min="0" placeholder="Nominal per bulan (Rp)">
      <input id="bbTgl" type="number" min="1" max="31" placeholder="Tanggal jatuh tempo tiap bulan (1-31)">
      <button class="btn" onclick="tambahBebanTetap()">+ Tambah Beban</button>
    </div>`;
  kartuKas.parentElement.insertBefore(kartu, kartuKas);
}

const periodeSekarang = () => tglLokal().slice(0, 7);
function tglJatuhTempoBulanIni(b) {
  const [th, bl] = periodeSekarang().split('-').map(Number);
  const hariTerakhir = new Date(th, bl, 0).getDate();
  return new Date(th, bl - 1, Math.min(b.tgl_jatuh_tempo || 1, hariTerakhir));
}

function renderBebanTetap() {
  if (!$('listBebanTetap')) return;
  const per = periodeSekarang();
  const daftar = (db.bebanTetap || []).filter(b => b.aktif);
  const kasBayar = ref => db.kas.find(k => k.sumber === 'beban_bulanan' && k.ref_id === ref);
  const hariIni = new Date(); hariIni.setHours(0, 0, 0, 0);
  let totalRencana = 0, totalSudah = 0;

  $('formBebanTetap').style.display = isPemilik() ? 'block' : 'none';
  $('listBebanTetap').innerHTML = daftar.length ? `<table><thead><tr><th>Beban</th><th>Nominal</th><th>Status ${esc(per)}</th><th>Aksi</th></tr></thead><tbody>` +
    daftar.map(b => {
      const bayar = kasBayar(`${b.id}@${per}`);
      const tempo = tglJatuhTempoBulanIni(b);
      const selisih = Math.round((tempo - hariIni) / 86400000);
      let status;
      totalRencana += b.nominal;
      if (bayar) { totalSudah += bayar.nominal; status = `<span style="color:#16a34a;font-weight:700">✅ Sudah dibayar</span><br><small>${rp(bayar.nominal)} - ${new Date(bayar.waktu).toLocaleDateString('id-ID')}</small>`; }
      else if (selisih < 0) status = `<span style="color:#dc2626;font-weight:700">⚠️ TERLAMBAT ${Math.abs(selisih)} hari</span><br><small>Jatuh tempo tgl ${b.tgl_jatuh_tempo}</small>`;
      else if (selisih <= 3) status = `<span style="color:#d97706;font-weight:700">⏳ ${selisih === 0 ? 'Jatuh tempo HARI INI' : 'Jatuh tempo ' + selisih + ' hari lagi'}</span><br><small>tgl ${b.tgl_jatuh_tempo}</small>`;
      else status = `<span style="color:#64748b">Belum dibayar</span><br><small>Jatuh tempo tgl ${b.tgl_jatuh_tempo}</small>`;
      const id = esc(b.id);
      return `<tr><td><strong>${esc(b.nama)}</strong></td><td>${rp(b.nominal)}</td><td>${status}</td>
        <td style="white-space:nowrap">${bayar ? '' : `<button class="btn-sm ok" onclick="bayarBebanTetap('${id}')">Bayar</button>`}
        ${isPemilik() ? `<button class="btn-sm blue" onclick="ubahBebanTetap('${id}')">Ubah</button><button class="btn-sm danger" onclick="hapusBebanTetap('${id}')">Hapus</button>` : ''}</td></tr>`;
    }).join('') + '</tbody></table>' : '<div class="empty">Belum ada beban tetap. Pemilik bisa menambahkannya di bawah.</div>';
  $('ringkasBebanTetap').innerHTML = daftar.length
    ? `Rencana bulan ini: <b>${rp(totalRencana)}</b> &nbsp;|&nbsp; Sudah dibayar: <b style="color:#16a34a">${rp(totalSudah)}</b> &nbsp;|&nbsp; Sisa: <b style="color:#dc2626">${rp(Math.max(0, totalRencana - totalSudah))}</b>` : '';
}

async function tambahBebanTetap() {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa mengatur daftar beban', 'err');
  const nama = txt('bbNama'), nominal = num('bbNominal'), tgl = Math.floor(num('bbTgl')) || 1;
  if (!nama) return flash('Nama beban wajib diisi', 'err');
  if (nominal <= 0) return flash('Nominal harus lebih dari 0', 'err');
  if (tgl < 1 || tgl > 31) return flash('Tanggal jatuh tempo harus 1-31', 'err');
  try {
    await dbOk(supabaseClient.from('beban_tetap').insert([{ id: genId('BBN'), nama, nominal, tgl_jatuh_tempo: tgl, aktif: true }]));
    await catatLog('BEBAN_TETAP', `Menambah beban tetap: ${nama} ${rp(nominal)} tgl ${tgl}`);
    ['bbNama', 'bbNominal', 'bbTgl'].forEach(x => { $(x).value = ''; });
    flash('Beban tetap ditambahkan');
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

async function ubahBebanTetap(id) {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa mengubah beban', 'err');
  const b = (db.bebanTetap || []).find(x => x.id === id); if (!b) return;
  const nama = prompt('Nama beban:', b.nama); if (nama === null) return;
  const nominal = prompt('Nominal per bulan (Rp):', b.nominal); if (nominal === null) return;
  const tgl = prompt('Tanggal jatuh tempo (1-31):', b.tgl_jatuh_tempo); if (tgl === null) return;
  if (!(+nominal > 0) || !(+tgl >= 1 && +tgl <= 31)) return flash('Nominal / tanggal tidak valid', 'err');
  try {
    await dbOk(supabaseClient.from('beban_tetap').update({ nama: nama.trim() || b.nama, nominal: +nominal, tgl_jatuh_tempo: Math.floor(+tgl) }).eq('id', id));
    await catatLog('BEBAN_TETAP', `Mengubah beban tetap: ${b.nama} -> ${nama} ${rp(+nominal)}`);
    flash('Beban diperbarui'); tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

async function hapusBebanTetap(id) {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa menghapus beban', 'err');
  const b = (db.bebanTetap || []).find(x => x.id === id); if (!b) return;
  if (!confirm(`Hapus beban "${b.nama}" dari daftar?\n\nRiwayat pembayaran yang sudah tercatat di kas TIDAK ikut terhapus.`)) return;
  try {
    await dbOk(supabaseClient.from('beban_tetap').delete().eq('id', id));
    await catatLog('BEBAN_TETAP', `Menghapus beban tetap: ${b.nama}`);
    flash('Beban dihapus dari daftar'); tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); }
}

async function bayarBebanTetap(id) {
  if (!isAdmin()) return flash('Akses ditolak.', 'err');
  const b = (db.bebanTetap || []).find(x => x.id === id); if (!b) return;
  const res = await pilihPembayaranModal({
    judul: `Bayar ${b.nama} (${periodeSekarang()})`,
    defaultNominal: b.nominal,
    labelNominal: 'Nominal Dibayar (Rp) — ubah bila tagihan berbeda'
  });
  if (!res) return;
  try {
    const { error } = await supabaseClient.rpc('bayar_beban_bulanan', { p_beban_id: id, p_metode: res.metode, p_bank_id: res.bankId, p_nominal: res.nominal, p_periode: periodeSekarang() });
    if (error) throw error;
    flash(`${b.nama} bulan ini dibayar ${rp(res.nominal)}`);
    tarikSemuaData();
  } catch (e) { flash('Gagal: ' + e.message, 'err'); tarikSemuaData(); }
}

// Baris khusus di Laba Rugi (HTML lama belum punya baris ini, jadi disisipkan lewat JS)
function pastikanBarisBebanBulanan() {
  if ($('lr_beban_bulanan')) return;
  const asal = $('lr_beban_lain'); const tr = asal && asal.closest && asal.closest('tr');
  if (!tr) return;
  const klon = tr.cloneNode(true);
  klon.cells[0].textContent = 'Pengeluaran Bulanan (Sewa, Listrik, Gaji)';
  klon.cells[1].id = 'lr_beban_bulanan';
  tr.parentElement.insertBefore(klon, tr);
}


// === LOGO TOKO DI NOTA ===
// Hanya data-URL gambar (png/jpeg/webp) yang boleh dicetak; apa pun selain itu diabaikan
// (mencegah isi settings yang dimanipulasi disisipkan ke halaman cetak).
const LOGO_VALID = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
function headerLogo(toko) {
  const src = toko && toko.logo_base64;
  return (src && LOGO_VALID.test(src))
    ? `<img src="${src}" alt="logo" style="display:block;margin:0 auto 4px;max-width:44mm;max-height:18mm;object-fit:contain;">`
    : '';
}

function resizeLogo(file, maks = 240) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('File bukan gambar yang valid'));
      img.onload = () => {
        let w = img.width, h = img.height;
        const skala = Math.min(1, maks / Math.max(w, h));
        w = Math.round(w * skala); h = Math.round(h * skala);
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); // latar putih (struk thermal hitam-putih)
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function pasangUILogoSetting() {
  if ($('kartuLogoToko') || !$('tkNama')) return;
  const kartuIdentitas = $('tkNama').closest ? $('tkNama').closest('.card') : null;
  if (!kartuIdentitas) return;
  const kartu = document.createElement('div');
  kartu.className = 'card'; kartu.id = 'kartuLogoToko';
  kartu.innerHTML = `
    <h3>Logo Toko di Nota</h3>
    <div id="previewLogoToko" style="margin-bottom:8px;"></div>
    <input type="file" id="fileLogoToko" accept="image/png,image/jpeg,image/webp">
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button class="btn" onclick="simpanLogoToko()">Simpan Logo</button>
      <button class="btn-sm danger" onclick="hapusLogoToko()">Hapus Logo</button>
    </div>
    <div style="font-size:11px;color:#94a3b8;margin-top:6px;">Disarankan logo sederhana hitam-putih. Ukuran otomatis diperkecil agar cocok untuk printer struk 58mm.</div>`;
  kartuIdentitas.parentElement.insertBefore(kartu, kartuIdentitas);
}
function renderPreviewLogo() {
  const el = $('previewLogoToko'); if (!el) return;
  const logo = headerLogo(getToko());
  el.innerHTML = logo ? `<div style="background:#fff;padding:8px;border-radius:8px;display:inline-block;">${logo}</div>` : '<span style="color:#94a3b8">Belum ada logo</span>';
}

async function simpanLogoData(dataUrl) {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa mengubah logo', 'err');
  if (dataUrl !== null && !LOGO_VALID.test(dataUrl)) return flash('File logo tidak valid (harus PNG/JPEG/WEBP)', 'err');
  if (dataUrl && dataUrl.length > 400000) return flash('Logo terlalu besar, gunakan gambar yang lebih sederhana', 'err');
  try {
    await dbOk(supabaseClient.from('settings').update({ logo_base64: dataUrl }).eq('id', 'toko'));
    await catatLog('SETTING', dataUrl ? 'Mengubah logo toko' : 'Menghapus logo toko');
    flash(dataUrl ? 'Logo disimpan, akan tampil di nota' : 'Logo dihapus');
    await tarikSemuaData();
  } catch (e) { flash('Gagal menyimpan logo: ' + e.message, 'err'); }
}
async function simpanLogoToko() {
  const f = $('fileLogoToko')?.files?.[0];
  if (!f) return flash('Pilih file logo dulu', 'err');
  try { await simpanLogoData(await resizeLogo(f)); if ($('fileLogoToko')) $('fileLogoToko').value = ''; }
  catch (e) { flash(e.message, 'err'); }
}
function hapusLogoToko() { if (confirm('Hapus logo dari semua nota?')) simpanLogoData(null); }

// === INISIALISASI ===
async function inisialisasi() {
  $('pinInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
  if ($('loadingAI')) $('loadingAI').style.display = 'none';
  $('pFoto')?.addEventListener('change', async e => {
    tempFotoBase64 = e.target.files.length ? await resizeImage(e.target.files[0]) : '';
  });
  // Hitung ulang klaim baterai saat data pelanggan/produk/tanggal berubah
  ['bNama', 'bProduk', 'bHp', 'bTgl'].forEach(id => $(id)?.addEventListener('change', () => cekKlaimBaterai(txt('bNama'))));
  // Total kasir & poin diperbarui saat input berubah
  ['tipeDiskon', 'nilaiDiskon', 'tukarPoin', 'metodeBayar'].forEach(id => $(id)?.addEventListener('input', updateTotalKasir));

  if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
  // Sesi dicek ke server; role dibentuk ulang dari akun yang sedang login (bukan dari sessionStorage)
  const { data } = await supabaseClient.auth.getSession();
  const sesi = data?.session;
  if (!sesi) { sessionStorage.clear(); $('loginOverlay')?.classList.remove('hidden'); return; }
  const username = (sesi.user.email || '').split('@')[0];
  sessionStorage.setItem('ta_logged', '1');
  sessionStorage.setItem('ta_user', username);
  sessionStorage.setItem('ta_role', tentukanRole(sesi.user, username));
  $('loginOverlay')?.classList.add('hidden');
  applyRoleUI();
  await tarikSemuaData();
  setupRealtime();
}
inisialisasi();


// === RAMAH ORANG TUA: TOGGLE HURUF BESAR ===
function toggleFontBesar() {
  const aktif = document.body.classList.toggle('font-xl');
  localStorage.setItem('ta_font_xl', aktif ? '1' : '0');
  flash(aktif ? 'Mode Huruf Besar AKTIF' : 'Mode Huruf Normal');
}
if (localStorage.getItem('ta_font_xl') === '1') document.body.classList.add('font-xl');

// === MENU 1 PINTU PEMILIK: SEMUA STOK, HARGA BELI & HARGA JUAL ===
let filterSemuaStokMode = 'semua';
function setFilterSemuaStok(mode) {
  filterSemuaStokMode = mode;
  renderSemuaStok();
}

function kumpulkanSemuaStok() {
  return [
    ...db.produk.map(p => ({
      kat: 'produk', label: 'JAM', nama: p.nama + (p.merek ? ` (${p.merek})` : ''),
      barcode: p.barcode || '', stok: p.stok || 0, min: 2,
      beli: p.harga_beli || 0, jual: p.harga_jual || 0
    })),
    ...db.sparePart.map(sp => ({
      kat: 'sparepart', label: 'PART', nama: sp.nama + (sp.kategori ? ` (${sp.kategori})` : ''),
      barcode: '', stok: sp.stok || 0, min: sp.min_stok ?? 2,
      beli: sp.harga_beli || 0, jual: sp.harga_jual || 0
    })),
    ...db.stokBaterai.map(sb => ({
      kat: 'baterai', label: 'BAT', nama: `Baterai ${sb.tipe}`,
      barcode: '', stok: sb.stok || 0, min: sb.min_stok ?? 5,
      beli: sb.harga_beli || 0, jual: sb.harga_jual || 0
    }))
  ];
}

function renderSemuaStok() {
  if (!isPemilik()) return;
  const all = kumpulkanSemuaStok();
  const totalModal = all.reduce((s, x) => s + (x.stok * x.beli), 0);
  const totalJual = all.reduce((s, x) => s + (x.stok * x.jual), 0);
  const menipis = all.filter(x => x.stok <= x.min).length;

  if ($('ssTotalModal')) $('ssTotalModal').textContent = rp(totalModal);
  if ($('ssTotalJual')) $('ssTotalJual').textContent = rp(totalJual);
  if ($('ssPotensiLaba')) $('ssPotensiLaba').textContent = rp(totalJual - totalModal);
  if ($('ssJumlahMenipis')) $('ssJumlahMenipis').textContent = `${menipis} item`;

  const q = txt('cariSemuaStok').toLowerCase();
  let list = all;
  if (filterSemuaStokMode === 'menipis') list = list.filter(x => x.stok <= x.min);
  else if (filterSemuaStokMode !== 'semua') list = list.filter(x => x.kat === filterSemuaStokMode);
  if (q) list = list.filter(x => x.nama.toLowerCase().includes(q) || x.barcode.toLowerCase().includes(q));

  setHTML('listSemuaStok', list.length ? list.map(x => {
    const low = x.stok <= x.min;
    const margin = x.jual - x.beli;
    const cls = x.kat === 'produk' ? 'proses' : (x.kat === 'sparepart' ? 'warn' : 'ok');
    return `
      <div class="item-card ${low ? 'low-stock' : ''}">
        <div class="ic-head">
          <div>
            <span class="badge ${cls}" style="margin-bottom:4px;">${x.label}</span>
            <div class="ic-title">${esc(x.nama)}</div>
          </div>
          <div class="ic-stock ${low ? 'low' : ''}">Stok: ${x.stok}${low ? ' ⚠️' : ''}</div>
        </div>
        <div class="ic-grid">
          <div class="ic-cell"><span class="ic-lbl">Harga Beli</span><span class="ic-val">${rp(x.beli)}</span></div>
          <div class="ic-cell"><span class="ic-lbl">Harga Jual</span><span class="ic-val">${rp(x.jual)}</span></div>
          <div class="ic-cell"><span class="ic-lbl">Laba / Unit</span><span class="ic-val ${margin >= 0 ? 'ok' : 'danger'}">${rp(margin)}</span></div>
          <div class="ic-cell"><span class="ic-lbl">Nilai Modal</span><span class="ic-val">${rp(x.stok * x.beli)}</span></div>
        </div>
      </div>`;
  }).join('') : '<div class="empty">Tidak ada barang ditemukan.</div>');
}

function cetakSemuaStok() {
  if (!isPemilik()) return flash('Khusus Pemilik', 'err');
  const toko = getToko();
  const list = kumpulkanSemuaStok();
  const totalModal = list.reduce((s, x) => s + (x.stok * x.beli), 0);
  const totalJual = list.reduce((s, x) => s + (x.stok * x.jual), 0);
  const rows = list.map((x, i) => `<tr>
    <td>${i + 1}</td><td>${x.label}</td><td>${esc(x.nama)}</td>
    <td style="text-align:center">${x.stok}</td>
    <td style="text-align:right">${rp(x.beli)}</td>
    <td style="text-align:right">${rp(x.jual)}</td>
  </tr>`).join('');
  cetakHTML(`<html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#000;padding:16px}
    h2{margin:0 0 4px} table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{border:1px solid #333;padding:6px} th{background:#eee}
  </style></head><body>
    <h2>${esc(toko.nama)} — DAFTAR SEMUA STOK & HARGA</h2>
    <div>Dicetak: ${new Date().toLocaleString('id-ID')} | Total Nilai Modal: <b>${rp(totalModal)}</b> | Total Nilai Jual: <b>${rp(totalJual)}</b></div>
    <table><thead><tr><th>No</th><th>Tipe</th><th>Nama Barang</th><th>Stok</th><th>Harga Beli</th><th>Harga Jual</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`);
}

// === LAPORAN AUDIT RINGKAS & KARTU AUDIT (PEMILIK) ===
function ambilDataAuditPeriode() {
  const mode = $('filterPeriodeAudit')?.value || 'bulan';
  const now = new Date();
  const todayStr = now.toDateString();
  const bln = now.getMonth(), thn = now.getFullYear();
  return (db.auditBarang || []).filter(a => {
    if (!a.waktu) return false;
    const d = new Date(a.waktu);
    if (mode === 'hari') return d.toDateString() === todayStr;
    if (mode === 'bulan') return d.getMonth() === bln && d.getFullYear() === thn;
    return true;
  });
}

function renderLaporanAuditRingkas() {
  if (!isPemilik()) return;
  const list = ambilDataAuditPeriode();
  const totalNilai = list.reduce((s, a) => s + (a.nilai_selisih || 0), 0);
  const kurangQty = list.filter(a => a.selisih < 0).reduce((s, a) => s + Math.abs(a.selisih), 0);
  const lebihQty = list.filter(a => a.selisih > 0).reduce((s, a) => s + a.selisih, 0);

  if ($('audRingkasJumlah')) $('audRingkasJumlah').textContent = `${list.length} item`;
  if ($('audRingkasNilai')) {
    $('audRingkasNilai').textContent = (totalNilai < 0 ? '-' : '+') + rp(Math.abs(totalNilai));
    $('audRingkasNilai').style.color = totalNilai < 0 ? '#b91c1c' : '#15803d';
  }
  if ($('audRingkasKurang')) $('audRingkasKurang').textContent = `-${kurangQty} qty`;
  if ($('audRingkasLebih')) $('audRingkasLebih').textContent = `+${lebihQty} qty`;

  setHTML('listLaporanAuditRingkas', list.length ? list.map(a => {
    const minus = a.selisih < 0;
    const nilaiMinus = (a.nilai_selisih || 0) < 0;
    return `
      <div class="item-card ${minus ? 'audit-minus' : 'audit-plus'}">
        <div class="ic-head">
          <div>
            <div style="font-size:12px;color:#475569;font-weight:600;">${new Date(a.waktu).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            <div class="ic-title">${esc(a.nama_produk)}</div>
          </div>
          <span class="badge ${a.user_name === 'admin' || a.user_name === 'pemilik' ? 'danger' : 'proses'}">${esc((a.user_name || '-').toUpperCase())}</span>
        </div>
        <div class="ic-grid">
          <div class="ic-cell"><span class="ic-lbl">Sistem → Fisik</span><span class="ic-val">${a.stok_sistem} → ${a.stok_fisik}</span></div>
          <div class="ic-cell"><span class="ic-lbl">Selisih</span><span class="ic-val ${minus ? 'danger' : 'ok'}">${a.selisih > 0 ? '+' : ''}${a.selisih} qty</span></div>
          <div class="ic-cell" style="grid-column:span 2;"><span class="ic-lbl">Nilai Selisih</span><span class="ic-val ${nilaiMinus ? 'danger' : 'ok'}">${nilaiMinus ? '-' : '+'}${rp(Math.abs(a.nilai_selisih || 0))}</span></div>
        </div>
        <div class="ic-note"><b>Catatan:</b> ${esc(a.catatan || '-')}</div>
        ${isPemilik() ? `<div style="margin-top:8px;text-align:right;"><button class="btn-sm danger" onclick="hapusAuditBarang('${esc(a.id)}')">🗑️ Hapus Riwayat Ini</button></div>` : ''}
      </div>`;
  }).join('') : '<div class="empty">Belum ada data audit pada periode ini.</div>');
}

function cetakKartuAudit() {
  if (!isPemilik()) return flash('Khusus Pemilik', 'err');
  const toko = getToko();
  const mode = $('filterPeriodeAudit')?.value || 'bulan';
  const labelPeriode = mode === 'hari' ? 'Hari Ini' : (mode === 'bulan' ? 'Bulan Ini' : 'Semua Waktu');
  const list = ambilDataAuditPeriode();
  const totalNilai = list.reduce((s, a) => s + (a.nilai_selisih || 0), 0);
  const kurangQty = list.filter(a => a.selisih < 0).reduce((s, a) => s + Math.abs(a.selisih), 0);
  const lebihQty = list.filter(a => a.selisih > 0).reduce((s, a) => s + a.selisih, 0);

  const rows = list.length ? list.map((a, i) => `<tr>
    <td>${i + 1}</td>
    <td>${new Date(a.waktu).toLocaleDateString('id-ID')}</td>
    <td>${esc(a.nama_produk)}</td>
    <td style="text-align:center">${a.stok_sistem}</td>
    <td style="text-align:center">${a.stok_fisik}</td>
    <td style="text-align:center;font-weight:bold">${a.selisih > 0 ? '+' : ''}${a.selisih}</td>
    <td style="text-align:right">${(a.nilai_selisih || 0) < 0 ? '-' : '+'}${rp(Math.abs(a.nilai_selisih || 0))}</td>
    <td>${esc(a.catatan || '-')}</td>
  </tr>`).join('') : '<tr><td colspan="8" style="text-align:center">Tidak ada selisih audit pada periode ini.</td></tr>';

  cetakHTML(`<html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;font-size:13px;color:#000;padding:20px}
    .hdr{border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px}
    .box{display:flex;gap:12px;margin-bottom:14px}
    .box div{flex:1;border:1px solid #333;padding:8px;text-align:center}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{border:1px solid #333;padding:6px} th{background:#eee}
    .ttd{display:flex;justify-content:space-between;margin-top:36px;text-align:center}
    .ttd div{width:40%}
  </style></head><body>
    <div class="hdr">
      <h2 style="margin:0">KARTU AUDIT STOK — ${esc(toko.nama)}</h2>
      <div>Periode: <b>${labelPeriode}</b> | Dicetak: ${new Date().toLocaleString('id-ID')}</div>
    </div>
    <div class="box">
      <div>Total Item Diaudit<br><b>${list.length} item</b></div>
      <div>Barang Kurang<br><b>-${kurangQty} qty</b></div>
      <div>Barang Lebih<br><b>+${lebihQty} qty</b></div>
      <div>Selisih Bersih (Rp)<br><b>${totalNilai < 0 ? '-' : '+'}${rp(Math.abs(totalNilai))}</b></div>
    </div>
    <table>
      <thead><tr><th>No</th><th>Tanggal</th><th>Nama Barang</th><th>Sistem</th><th>Fisik</th><th>Selisih</th><th>Nilai (Rp)</th><th>Catatan</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="ttd">
      <div>Diperiksa Oleh (Admin/Kasir),<br><br><br><br>( ______________________ )</div>
      <div>Disetujui Oleh (Pemilik),<br><br><br><br>( ______________________ )</div>
    </div>
  </body></html>`);
}


// === UI TINGGAL PENCET (TAP-FIRST / MINIM KETIK) ===
function ubahQty(id, delta) {
  const el = $(id); if (!el) return;
  const val = Math.max(1, (parseInt(el.value, 10) || 1) + delta);
  el.value = val;
}

function setDiskonCepat(tipe, nilai) {
  if ($('tipeDiskon')) $('tipeDiskon').value = tipe;
  if ($('nilaiDiskon')) $('nilaiDiskon').value = nilai;
  updateTotalKasir();
}

function setBayarCepat(nilai) {
  const el = $('bayar'); if (!el) return;
  if (nilai === 'pas') {
    const h = hitungTotalKasir();
    el.value = h.total;
  } else {
    el.value = nilai;
  }
}

function setKasKecilCepat(jenis, nominal, ket) {
  if ($('kkJenis')) $('kkJenis').value = jenis;
  if ($('kkNominal')) $('kkNominal').value = nominal;
  if ($('kkKet')) $('kkKet').value = ket;
  flash(`Terisi: ${ket} (${rp(nominal)}). Tinggal klik Simpan Kas Kecil.`);
}

function isiTeks(id, teks) {
  const el = $(id); if (!el) return;
  el.value = teks;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function tambahKeluhan(teks) {
  const el = $('sKeluhan'); if (!el) return;
  const cur = el.value.trim();
  if (!cur) el.value = teks;
  else if (!cur.toLowerCase().includes(teks.toLowerCase())) el.value = cur + ', ' + teks;
}

function setJasaCepat(nominal) {
  if (txt('sParentId') || modeKlaimProdukJualId) return flash('Sedang mode klaim garansi (jasa otomatis Rp 0)', 'err');
  if ($('sGaransi')) $('sGaransi').value = 'luar';
  if ($('sJasa')) $('sJasa').value = nominal;
  hitungTotalServis();
}

function isiJamBaterai(merek) {
  if ($('bProduk')) $('bProduk').value = merek;
  cekKlaimBaterai(txt('bNama'));
}

function pilihBateraiCepat(sbId) {
  const sel = $('bTipeSel'); if (!sel) return;
  sel.value = sbId;
  pilihBaterai();
  renderQuickBateraiBtns();
  renderKasirProdukGrid();
}

function isiHpPelanggan(namaId, hpId) {
  const nama = txt(namaId);
  if (!nama) return;
  const p = (db.pelanggan || []).find(x => (x.nama || '').toLowerCase() === nama.toLowerCase());
  if (p && p.telp && p.telp !== '-' && $(hpId)) {
    $(hpId).value = p.telp.replace(/[^0-9]/g, '');
  }
}

function renderQuickBateraiBtns() {
  const list = (db.stokBaterai || []).filter(sb => (sb.stok || 0) > 0);
  const el = $('quickBateraiBtns');
  if (el) {
    const aktifId = $('bTipeSel')?.value || '';
    el.innerHTML = list.length ? list.map(sb => `
      <button type="button" class="tap-btn ${sb.id === aktifId ? 'active-tap' : 'ok-tap'}" onclick="pilihBateraiCepat('${esc(sb.id)}')">
        ${esc(sb.tipe)} <small>(${sb.stok})</small>
      </button>`).join('') : '<span style="font-size:13px;color:#64748b">Stok baterai kosong</span>';
  }
  const elE = $('quickBateraiEceranBtns');
  if (elE) {
    const aktifE = $('beTipeSel')?.value || '';
    elE.innerHTML = list.length ? list.map(sb => `
      <button type="button" class="tap-btn ${sb.id === aktifE ? 'active-tap' : 'ok-tap'}" onclick="pilihBateraiEceranCepat('${esc(sb.id)}')">
        ${esc(sb.tipe)} <small>(${sb.stok})</small>
      </button>`).join('') : '<span style="font-size:13px;color:#64748b">Stok baterai kosong</span>';
  }
  updateTotalBateraiEceran();
}

function renderQuickUI() {
  const dl = $('dlPelanggan');
  if (dl) {
    dl.innerHTML = (db.pelanggan || []).map(p => `<option value="${esc(p.nama)}">${esc(p.telp && p.telp !== '-' ? p.telp : '')}</option>`).join('');
  }
  renderQuickBateraiBtns();
}


async function hapusAuditBarang(id) {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa menghapus riwayat audit', 'err');
  const a = (db.auditBarang || []).find(x => x.id === id);
  if (!confirm(`Hapus riwayat audit "${a ? a.nama_produk : id}"?\n\nCatatan: Ini hanya menghapus baris riwayat audit, tidak mengubah stok barang saat ini.`)) return;
  try {
    await dbOk(supabaseClient.from('audit_barang').delete().eq('id', id));
    await catatLog('HAPUS_AUDIT', `Menghapus riwayat audit ${id}${a ? ` (${a.nama_produk}, selisih ${a.selisih})` : ''}`);
    flash('Riwayat audit berhasil dihapus');
    tarikSemuaData();
  } catch (e) { flash('Gagal menghapus riwayat audit: ' + e.message, 'err'); }
}


// === JUAL BATERAI ECERAN TANPA PASANG (TANPA GARANSI) ===
function toggleBankEceran() { toggleWrap('wrapBankEceran', 'beMetode', ['tunai', 'hutang']); }

function pilihBateraiEceranCepat(sbId) {
  const sel = $('beTipeSel'); if (!sel) return;
  sel.value = sbId;
  renderQuickBateraiBtns();
}

function updateTotalBateraiEceran() {
  const sbId = $('beTipeSel')?.value;
  const qty = Math.max(1, Math.floor(num('beQty')) || 1);
  const sb = db.stokBaterai.find(x => x.id === sbId);
  const total = sb ? (sb.harga_jual || 0) * qty : 0;
  if ($('beTotal')) $('beTotal').value = rp(total);
}

let sedangJualEceran = false;
async function simpanBateraiEceran() {
  if (sedangJualEceran) return;
  const sbId = $('beTipeSel')?.value;
  const qty = Math.max(1, Math.floor(num('beQty')) || 1);
  if (!sbId) return flash('Pilih tipe baterai terlebih dahulu', 'err');
  const sb = db.stokBaterai.find(x => x.id === sbId);
  if (!sb) return flash('Data baterai tidak ditemukan', 'err');
  if (qty > (sb.stok || 0)) return flash(`Stok baterai ${sb.tipe} tidak cukup (sisa ${sb.stok})`, 'err');

  const metode = $('beMetode')?.value || 'tunai';
  const cekBank = wajibBankNonTunai('beBank', metode);
  if (!cekBank.ok) return;

  sedangJualEceran = true;
  const btn = $('btnJualBateraiEceran');
  if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
  try {
    const harga = sb.harga_jual || 0;
    const rpcArgs = {
      p_items: [{ produk: 'Baterai Eceran (Tanpa Pasang)', sb_id: sb.id, harga, qty, jenis_klaim: 'Eceran' }],
      p_customer: 'Pembeli Eceran',
      p_telp: null,
      p_tgl_ganti: tglLokal(),
      p_garansi_bulan: 0,
      p_metode: metode,
      p_bank_id: cekBank.bankId
    };
    const { data, error } = await supabaseClient.rpc('proses_ganti_baterai', rpcArgs);
    if (error) throw error;

    await catatLog('BATERAI_ECERAN', `Jual baterai eceran ${sb.tipe} x${qty} (${rp(data.total)}) via ${labelMetode(metode)}`);
    flash(`Baterai eceran ${sb.tipe} x${qty} terjual (${rp(data.total)})`);
    try { cetakStrukBateraiEceran(sb.tipe, qty, harga, data.total, metode); } catch (e) { console.error(e); }

    if ($('beTipeSel')) $('beTipeSel').value = '';
    if ($('beQty')) $('beQty').value = 1;
    updateTotalBateraiEceran();
    tarikSemuaData();
  } catch (e) {
    flash('Gagal menjual baterai eceran: ' + e.message, 'err');
  } finally {
    sedangJualEceran = false;
    if (btn) { btn.disabled = false; btn.textContent = '💾 Jual Baterai Eceran & Cetak Struk'; }
  }
}

function cetakStrukBateraiEceran(tipe, qty, harga, total, metode) {
  const toko = getToko();
  cetakHTML(`<html><head><meta charset="UTF-8"><style>${CSS_STRUK}</style></head><body>
  ${headerLogo(toko)}<div class="c b" style="font-size:12px">${esc(toko.nama)}</div>
  <div class="c">${esc(toko.alamat)}</div><div class="c b">STRUK BATERAI ECERAN</div><hr>
  <div>Tgl: ${new Date().toLocaleString('id-ID')}</div>
  <div>Kasir: ${esc(sessionStorage.getItem('ta_user') || 'Admin')}</div><hr>
  <table>
    <tr><td>Baterai ${esc(tipe)}<br>${qty} x ${harga.toLocaleString('id-ID')}</td><td style="text-align:right">${total.toLocaleString('id-ID')}</td></tr>
  </table><hr>
  <table>
    <tr><td class="b">TOTAL</td><td class="b" style="text-align:right">Rp ${total.toLocaleString('id-ID')}</td></tr>
    <tr><td>Metode</td><td style="text-align:right">${esc(labelMetode(metode))}</td></tr>
  </table><hr>
  <div class="c" style="font-size:9px;">Baterai eceran tanpa pasang (tanpa garansi).<br><br>${esc(toko.footer)}</div></body></html>`);
}


// ==========================================================
//  FITUR V8: POS KATALOG, ISI KAS KECIL, SHIFT CLOSING, BACKUP
// ==========================================================

// 1. JAM REAL-TIME DI HEADER
function updateLiveClock() {
  const el = $('liveClock'); if (!el) return;
  const now = new Date();
  const tgl = now.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const jamStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  el.textContent = `${tgl} • ${jamStr} WIB`;
}
updateLiveClock();
setInterval(updateLiveClock, 30000);

// 2. POS KASIR: KATALOG KARTU PRODUK BERGAMBAR & GRID METODE BAYAR
function renderKasirProdukGrid() {
  const el = $('kasirProdukGrid'); if (!el) return;
  const q = txt('cariKasirProduk').toLowerCase();
  const list = (db.produk || []).filter(p => (p.stok || 0) > 0 && (!q || (p.nama || '').toLowerCase().includes(q) || (p.merek || '').toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q)));
  if (!list.length) {
    el.innerHTML = '<div class="empty" style="grid-column:1/-1;">Tidak ada produk tersedia.</div>';
    return;
  }
  el.innerHTML = list.map(p => {
    const imgHTML = p.foto
      ? `<img src="${p.foto}" alt="${esc(p.nama)}" class="pos-prod-img">`
      : `<div class="pos-prod-placeholder">⌚</div>`;
    return `<div class="pos-prod-card">
      <div>
        ${imgHTML}
        <div class="pos-prod-name">${esc(p.nama)}</div>
        <div class="pos-prod-merek">${esc(p.merek || 'Jam Tangan')} · Stok ${p.stok}</div>
        <div class="pos-prod-price">${rp(p.harga_jual)}</div>
      </div>
      <button type="button" class="pos-prod-btn" onclick="tambahProdukKeCartCepat('${esc(p.id)}')">+ Tambah ke Keranjang</button>
    </div>`;
  }).join('');
}

function tambahProdukKeCartCepat(id) {
  const p = db.produk.find(x => x.id === id);
  if (!p) return flash('Produk tidak ditemukan', 'err');
  if ((p.stok || 0) < 1) return flash('Stok habis', 'err');
  const existing = cart.find(c => c.id === id);
  if ((existing?.qty || 0) + 1 > p.stok) return flash(`Stok ${p.nama} tidak mencukupi (maks ${p.stok})`, 'err');
  if (existing) existing.qty += 1;
  else cart.push({ id: p.id, nama: p.nama, harga: p.harga_jual, qty: 1 });
  renderCart();
  flash(`✅ ${p.nama} ditambahkan`);
}

function ubahQtyCart(i, delta) {
  const c = cart[i]; if (!c) return;
  const p = db.produk.find(x => x.id === c.id);
  const baru = c.qty + delta;
  if (baru <= 0) { cart.splice(i, 1); }
  else if (p && baru > p.stok) { return flash(`Stok ${p.nama} hanya ${p.stok}`, 'err'); }
  else { c.qty = baru; }
  renderCart();
}

function pilihMetodeKasir(metode) {
  const sel = $('metodeBayar');
  if (sel) sel.value = metode;
  syncTombolMetodeKasir();
  toggleBankKasir();
  updateTotalKasir();
}

function syncTombolMetodeKasir() {
  const aktif = $('metodeBayar')?.value || 'tunai';
  document.querySelectorAll('#payMethodGrid .pay-btn').forEach(b => b.classList.toggle('active', b.dataset.metode === aktif));
}

// 3. TOMBOL KHUSUS ISI SALDO KAS KECIL (ADMIN / PEMILIK, TANPA BATAS RP 500.000)
function bukaIsiKasKecilModal() {
  if (!isAdmin()) return flash('Hanya Admin/Pemilik yang bisa mengisi saldo kas kecil', 'err');
  let ov = $('modalIsiKasKecil'); if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'modalIsiKasKecil';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.75);z-index:9700;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.innerHTML = `
    <div style="background:#fff;color:#0f172a;border:2px solid #f59e0b;border-radius:14px;max-width:440px;width:100%;padding:18px;box-shadow:0 12px 30px rgba(0,0,0,.35);">
      <h3 style="margin:0 0 10px;color:#0f1f3d;border-bottom:2px solid #fef3c7;padding-bottom:6px;">💰 Isi Saldo / Top-Up Kas Kecil</h3>
      <label>Nominal Isi Kas Kecil (Rp)</label>
      <input id="ikkNominal" type="number" min="1" placeholder="Contoh: 1000000" style="margin-bottom:8px;font-size:18px;font-weight:800;">
      <div class="tap-group">
        <button type="button" class="tap-btn ok-tap" onclick="$('ikkNominal').value=300000">300rb</button>
        <button type="button" class="tap-btn ok-tap" onclick="$('ikkNominal').value=500000">500rb</button>
        <button type="button" class="tap-btn ok-tap" onclick="$('ikkNominal').value=1000000">1 Juta</button>
        <button type="button" class="tap-btn ok-tap" onclick="$('ikkNominal').value=2000000">2 Juta</button>
      </div>
      <label>Keterangan</label>
      <input id="ikkKet" value="Isi Ulang / Saldo Awal Kas Kecil" style="margin-bottom:14px;">
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn ghost" onclick="$('modalIsiKasKecil').remove()">Batal</button>
        <button type="button" class="btn ok" onclick="simpanIsiKasKecilAdmin()">💾 Simpan Saldo</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  $('ikkNominal').focus();
}

async function simpanIsiKasKecilAdmin() {
  const nominal = +($('ikkNominal')?.value) || 0;
  const ket = ($('ikkKet')?.value || '').trim() || 'Isi Saldo Kas Kecil';
  if (nominal <= 0) return flash('Nominal harus lebih dari 0', 'err');
  try {
    await catatKas({ jenis: 'masuk', metode: 'tunai', nominal, keterangan: ket, sumber: 'kas_kecil' });
    await catatLog('ISI_KAS_KECIL', `Isi saldo kas kecil sebesar ${rp(nominal)} - ${ket}`);
    $('modalIsiKasKecil')?.remove();
    flash(`Saldo kas kecil berhasil ditambah ${rp(nominal)}`);
    tarikSemuaData();
  } catch (e) { flash('Gagal mengisi kas kecil: ' + e.message, 'err'); }
}

// 4. SHIFT CLOSING (TUTUP KASIR HARIAN)
function hitungDataShiftHariIni() {
  const today = new Date().toDateString();
  const hariIni = w => w && new Date(w).toDateString() === today;
  const kasHari = (db.kas || []).filter(k => hariIni(k.waktu));

  const tunaiMasuk = kasHari.filter(k => k.metode === 'tunai' && k.jenis === 'masuk').reduce((s, k) => s + (k.nominal || 0), 0);
  const tunaiKeluar = kasHari.filter(k => k.metode === 'tunai' && k.jenis === 'keluar').reduce((s, k) => s + (k.nominal || 0), 0);
  const tunaiSistem = tunaiMasuk - tunaiKeluar;

  const nonTunaiMasuk = kasHari.filter(k => k.metode !== 'tunai' && k.jenis === 'masuk').reduce((s, k) => s + (k.nominal || 0), 0);
  const mdrHari = kasHari.filter(k => k.sumber === 'mdr').reduce((s, k) => s + (k.nominal || 0), 0);
  const jmlJual = (db.jual || []).filter(t => hariIni(t.waktu)).length;
  const jmlBat = (db.baterai || []).filter(b => hariIni(b.waktu)).length;
  const jmlSrv = (db.servis || []).filter(s => hariIni(s.waktu)).length;

  return { tunaiMasuk, tunaiKeluar, tunaiSistem, nonTunaiMasuk, mdrHari, jmlJual, jmlBat, jmlSrv };
}

function bukaShiftClosing() {
  const d = hitungDataShiftHariIni();
  let ov = $('modalShiftClosing'); if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'modalShiftClosing';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.78);z-index:9700;overflow-y:auto;padding:16px;';
  ov.innerHTML = `
    <div style="background:#fff;color:#0f172a;border:2px solid #0f1f3d;border-radius:14px;max-width:480px;width:100%;margin:3vh auto;padding:18px;box-shadow:0 12px 30px rgba(0,0,0,.4);">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-bottom:12px;">
        <h3 style="margin:0;border:none;padding:0;color:#0f1f3d;">🔐 Tutup Kasir (Shift Closing)</h3>
        <button type="button" class="btn-sm ghost" onclick="$('modalShiftClosing').remove()">✕</button>
      </div>
      <div style="font-size:13px;color:#475569;margin-bottom:10px;">
        Kasir: <b>${esc(sessionStorage.getItem('ta_user') || '-')}</b> · Tanggal: <b>${new Date().toLocaleDateString('id-ID')}</b><br>
        Transaksi Hari Ini: <b>${d.jmlJual}</b> Jual · <b>${d.jmlSrv}</b> Servis · <b>${d.jmlBat}</b> Baterai
      </div>
      <div class="checkout-summary" style="margin-bottom:12px;">
        <div class="cs-row"><span>Tunai Masuk Hari Ini</span><b style="color:#15803d;">+${rp(d.tunaiMasuk)}</b></div>
        <div class="cs-row"><span>Tunai Keluar (Kas Kecil/dll)</span><b style="color:#b91c1c;">-${rp(d.tunaiKeluar)}</b></div>
        <div class="cs-row total"><span>Seharusnya di Laci (Sistem)</span><span>${rp(d.tunaiSistem)}</span></div>
        <div class="cs-row" style="margin-top:8px;padding-top:6px;border-top:1px solid #e2e8f0;"><span>Non-Tunai (QRIS/Transfer/EDC)</span><b>${rp(d.nonTunaiMasuk)}</b></div>
        ${d.mdrHari > 0 ? `<div class="cs-row" style="color:#b91c1c;"><span>Potongan MDR Hari Ini</span><b>-${rp(d.mdrHari)}</b></div>` : ''}
      </div>
      <label>Hitung Uang Tunai Fisik di Laci (Rp) *</label>
      <input id="scFisik" type="number" min="0" placeholder="Masukkan jumlah uang fisik..." oninput="hitungSelisihShift(${d.tunaiSistem})" style="font-size:18px;font-weight:800;margin-bottom:8px;">
      <div id="scSelisihBox" style="display:none;padding:10px;border-radius:10px;font-weight:800;font-size:15px;text-align:center;margin-bottom:10px;"></div>
      <label>Catatan Tutup Kasir (Opsional)</label>
      <input id="scCatatan" placeholder="Contoh: Setor ke pemilik, sisa modal laci 200rb" style="margin-bottom:12px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button type="button" class="btn ok" onclick="simpanShiftClosing(true)">💾 Simpan &amp; Cetak</button>
        <button type="button" class="btn blue" onclick="simpanShiftClosing(false, true)">📲 Simpan &amp; WA</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  $('scFisik').focus();
}

function hitungSelisihShift(tunaiSistem) {
  const val = $('scFisik')?.value;
  const box = $('scSelisihBox'); if (!box) return;
  if (val === '' || val === undefined) { box.style.display = 'none'; return; }
  const fisik = Number(val) || 0;
  const selisih = fisik - tunaiSistem;
  box.style.display = 'block';
  if (selisih === 0) {
    box.style.background = '#dcfce7'; box.style.color = '#14532d'; box.style.border = '1.5px solid #16a34a';
    box.textContent = '✅ COCOK 100% (Selisih Rp 0)';
  } else if (selisih < 0) {
    box.style.background = '#fee2e2'; box.style.color = '#7f1d1d'; box.style.border = '1.5px solid #dc2626';
    box.textContent = `⚠️ KURANG ${rp(Math.abs(selisih))}`;
  } else {
    box.style.background = '#dbeafe'; box.style.color = '#1e3a8a'; box.style.border = '1.5px solid #2563eb';
    box.textContent = `ℹ️ LEBIH +${rp(selisih)}`;
  }
}

async function simpanShiftClosing(cetak = false, kirimWA = false) {
  const fisikRaw = $('scFisik')?.value;
  if (fisikRaw === '' || fisikRaw === undefined) return flash('Masukkan jumlah uang tunai fisik di laci', 'err');
  const fisik = Math.max(0, Number(fisikRaw) || 0);
  const catatan = ($('scCatatan')?.value || '').trim();
  const d = hitungDataShiftHariIni();
  const selisih = fisik - d.tunaiSistem;
  const user = sessionStorage.getItem('ta_user') || 'kasir';
  const statusTeks = selisih === 0 ? 'COCOK' : (selisih < 0 ? `KURANG ${rp(Math.abs(selisih))}` : `LEBIH +${rp(selisih)}`);

  try {
    await catatLog('SHIFT_CLOSING', `Tutup kasir oleh ${user} | Sistem: ${rp(d.tunaiSistem)} | Fisik: ${rp(fisik)} | Selisih: ${statusTeks} | Non-Tunai: ${rp(d.nonTunaiMasuk)}${catatan ? ' | Ket: ' + catatan : ''}`);
    flash('Laporan Tutup Kasir berhasil dicatat!');
    $('modalShiftClosing')?.remove();

    if (cetak) {
      const toko = getToko();
      cetakHTML(`<html><head><meta charset="UTF-8"><style>${CSS_STRUK}</style></head><body>
        ${headerLogo(toko)}<div class="c b" style="font-size:12px">${esc(toko.nama)}</div>
        <div class="c b">LAPORAN TUTUP KASIR</div><hr>
        <div>Tgl: ${new Date().toLocaleString('id-ID')}</div>
        <div>Kasir: ${esc(user)}</div><hr>
        <table>
          <tr><td>Tunai Masuk</td><td style="text-align:right">${rp(d.tunaiMasuk)}</td></tr>
          <tr><td>Tunai Keluar</td><td style="text-align:right">-${rp(d.tunaiKeluar)}</td></tr>
          <tr><td class="b">Tunai Sistem</td><td class="b" style="text-align:right">${rp(d.tunaiSistem)}</td></tr>
          <tr><td class="b">Tunai Fisik</td><td class="b" style="text-align:right">${rp(fisik)}</td></tr>
          <tr><td class="b">Selisih</td><td class="b" style="text-align:right">${statusTeks}</td></tr>
        </table><hr>
        <table>
          <tr><td>Non-Tunai</td><td style="text-align:right">${rp(d.nonTunaiMasuk)}</td></tr>
          <tr><td>MDR</td><td style="text-align:right">-${rp(d.mdrHari)}</td></tr>
        </table><hr>
        ${catatan ? `<div>Ket: ${esc(catatan)}</div><hr>` : ''}
        <div class="c" style="margin-top:16px">Tanda Tangan Kasir<br><br><br>( ${esc(user)} )</div>
      </body></html>`);
    }
    if (kirimWA) {
      const toko = getToko();
      if (!toko.telp) return flash('Isi No WA Toko di Setting dulu', 'err');
      const teks = `*LAPORAN TUTUP KASIR (SHIFT CLOSING)*
${toko.nama}
Tgl: ${new Date().toLocaleString('id-ID')}
Kasir: *${user}*
-------------------------
Tunai Masuk : ${rp(d.tunaiMasuk)}
Tunai Keluar: -${rp(d.tunaiKeluar)}
*Tunai Sistem: ${rp(d.tunaiSistem)}*
*Tunai Fisik : ${rp(fisik)}*
*Status      : ${statusTeks}*
-------------------------
Non-Tunai   : ${rp(d.nonTunaiMasuk)}
Biaya MDR   : -${rp(d.mdrHari)}
${catatan ? 'Catatan     : ' + catatan + '\n' : ''}_Tercatat otomatis di Audit Log_`;
      openWA(toko.telp, teks);
    }
    tarikSemuaData();
  } catch (e) { flash('Gagal menyimpan tutup kasir: ' + e.message, 'err'); }
}

// 5. BACKUP DATA (CSV EXCEL-READY & FULL JSON)
function unduhFile(namaFile, isi, mime) {
  const blob = new Blob([isi], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = namaFile; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function keCSV(headers, rows) {
  const escCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '\uFEFF' + [headers.map(escCsv).join(','), ...rows.map(r => r.map(escCsv).join(','))].join('\n');
}

function exportCSV(modul) {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa mengekspor backup data', 'err');
  const tgl = tglLokal();
  if (modul === 'jual') {
    const rows = (db.jual || []).map(t => [t.id, t.waktu, t.cust_nama || '-', t.cust_hp || '-', t.metode, t.subtotal, t.diskon, t.total, (t.items || []).map(i => `${i.nama} x${i.qty}`).join('; ')]);
    unduhFile(`Backup_Penjualan_${tgl}.csv`, keCSV(['ID', 'Waktu', 'Pembeli', 'HP', 'Metode', 'Subtotal', 'Diskon', 'Total', 'Item'], rows), 'text/csv;charset=utf-8;');
  } else if (modul === 'servis') {
    const rows = (db.servis || []).map(s => [s.id, s.waktu, s.customer, s.telp || '-', s.produk, s.keluhan || '-', s.status, s.biaya_pelanggan, s.dp || 0, s.sisa || 0, s.paid ? 'LUNAS' : 'BELUM', s.tgl_garansi_servis_sampai || '-']);
    unduhFile(`Backup_Servis_${tgl}.csv`, keCSV(['ID', 'Waktu', 'Pelanggan', 'HP', 'Produk', 'Keluhan', 'Status', 'Total', 'DP', 'Sisa', 'Lunas', 'Garansi s/d'], rows), 'text/csv;charset=utf-8;');
  } else if (modul === 'baterai') {
    const rows = (db.baterai || []).map(b => [b.id, b.tgl_ganti, b.customer, b.telp || '-', b.produk, b.tipe, b.biaya, b.jenis_klaim || 'Normal', b.tgl_expired]);
    unduhFile(`Backup_Baterai_${tgl}.csv`, keCSV(['ID', 'Tgl Ganti', 'Pelanggan', 'HP', 'Jam', 'Tipe Baterai', 'Biaya', 'Status', 'Garansi s/d'], rows), 'text/csv;charset=utf-8;');
  } else if (modul === 'kas') {
    const rows = (db.kas || []).map(k => [k.id, k.waktu, k.jenis, k.metode, k.sumber, k.nominal, k.keterangan || '-', k.ref_id || '-']);
    unduhFile(`Backup_Kas_${tgl}.csv`, keCSV(['ID', 'Waktu', 'Jenis', 'Metode', 'Sumber', 'Nominal', 'Keterangan', 'Ref ID'], rows), 'text/csv;charset=utf-8;');
  } else if (modul === 'stok') {
    const rows = kumpulkanSemuaStok().map(x => [x.label, x.nama, x.barcode, x.stok, x.beli, x.jual, x.jual - x.beli, x.stok * x.beli]);
    unduhFile(`Backup_Stok_Harga_${tgl}.csv`, keCSV(['Kategori', 'Nama Barang', 'Barcode', 'Stok', 'Harga Beli', 'Harga Jual', 'Laba/Unit', 'Nilai Modal'], rows), 'text/csv;charset=utf-8;');
  } else if (modul === 'pelanggan') {
    const rows = (db.pelanggan || []).map(p => [p.id, p.nama, p.telp || '-', p.poin || 0, p.terakhir_transaksi || '-']);
    unduhFile(`Backup_Pelanggan_${tgl}.csv`, keCSV(['ID', 'Nama', 'HP', 'Poin', 'Transaksi Terakhir'], rows), 'text/csv;charset=utf-8;');
  }
  catatLog('BACKUP_CSV', `Ekspor data CSV: ${modul}`);
  flash(`File Excel (CSV) ${modul} berhasil diunduh!`);
}

function backupSemuaJSON() {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa mengunduh backup penuh', 'err');
  const payload = { exported_at: nowISO(), toko: getToko().nama, data: db };
  unduhFile(`Backup_Lengkap_TokoSeiko108_${tglLokal()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  catatLog('BACKUP_FULL', 'Mengunduh backup lengkap JSON');
  flash('Backup penuh (.json) berhasil diunduh!');
}


// ==========================================================
//  FITUR V9: POS SERVIS/BATERAI, BLUETOOTH PRINTER, WA API, FORECASTING
// ==========================================================

// 1. GRID METODE PEMBAYARAN SERVIS & BATERAI
function pilihMetodeServis(metode) {
  const sel = $('metodeDpGroup'); if (sel) sel.value = metode;
  document.querySelectorAll('#payMethodGridServis .pay-btn').forEach(b => b.classList.toggle('active', b.dataset.metode === metode));
  toggleBankDp(); updateTotalGroupServis();
}

function pilihMetodeBaterai(metode) {
  const sel = $('metodeBaterai'); if (sel) sel.value = metode;
  document.querySelectorAll('#payMethodGridBaterai .pay-btn').forEach(b => b.classList.toggle('active', b.dataset.metode === metode));
  toggleBankBaterai(); updateTotalBaterai();
}

// 2. WEB BLUETOOTH THERMAL PRINTER (58mm ESC/POS)
let btDevice = null, btCharacteristic = null;
const BT_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455'
];

function updateBtStatus(teks, ok = false) {
  const el = $('btStatusText'); if (!el) return;
  el.textContent = teks;
  el.style.color = ok ? '#15803d' : '#b91c1c';
}

async function btConnect() {
  if (!navigator.bluetooth) return alert('Browser tidak mendukung Web Bluetooth. Gunakan Google Chrome di Android atau PC.');
  try {
    updateBtStatus('Mencari printer Bluetooth...', false);
    btDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BT_SERVICE_UUIDS
    });
    btDevice.addEventListener('gattserverdisconnected', () => {
      btCharacteristic = null;
      updateBtStatus('Status: Printer terputus', false);
    });
    const server = await btDevice.gatt.connect();
    let foundChar = null;
    for (const svcUuid of BT_SERVICE_UUIDS) {
      try {
        const svc = await server.getPrimaryService(svcUuid);
        const chars = await svc.getCharacteristics();
        foundChar = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
        if (foundChar) break;
      } catch (_) { }
    }
    if (!foundChar) throw new Error('Karakteristik tulis ESC/POS tidak ditemukan pada printer ini.');
    btCharacteristic = foundChar;
    updateBtStatus(`✅ Terhubung: ${btDevice.name || 'Printer Thermal'}`, true);
    flash('Printer Bluetooth terhubung!');
  } catch (e) {
    updateBtStatus('Status: Gagal menghubungkan (' + e.message + ')', false);
    flash('Gagal konek Bluetooth: ' + e.message, 'err');
  }
}

async function btPrintText(text) {
  if (!btCharacteristic) return false;
  const enc = new TextEncoder();
  const initCmd = new Uint8Array([0x1B, 0x40]); // ESC @ (reset printer)
  const body = enc.encode(text + '\n\n\n');
  const full = new Uint8Array(initCmd.length + body.length);
  full.set(initCmd, 0); full.set(body, initCmd.length);

  // Kirim per potongan 100 byte agar buffer Bluetooth tidak meluap
  const CHUNK = 100;
  for (let i = 0; i < full.length; i += CHUNK) {
    const slice = full.slice(i, i + CHUNK);
    if (btCharacteristic.properties.writeWithoutResponse) {
      await btCharacteristic.writeValueWithoutResponse(slice);
    } else {
      await btCharacteristic.writeValue(slice);
    }
  }
  return true;
}

async function btTestPrint() {
  if (!btCharacteristic) return flash('Hubungkan printer Bluetooth dulu', 'err');
  const toko = getToko();
  const teks = `${toko.nama}\n${toko.alamat}\n================================\nTES CETAK PRINTER BLUETOOTH\nTgl: ${new Date().toLocaleString('id-ID')}\nStatus: BERHASIL TERHUBUNG!\n================================`;
  try {
    await btPrintText(teks);
    flash('✅ Tes cetak dikirim ke printer!');
  } catch (e) { flash('Gagal mencetak: ' + e.message, 'err'); }
}

function htmlKeTeksStruk(html) {
  const div = document.createElement('div');
  div.innerHTML = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<hr[^>]*>/gi, '\n--------------------------------\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>|<\/tr>|<\/p>/gi, '\n').replace(/<\/td>/gi, '  ');
  return (div.textContent || div.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
}

function simpanPrefBT() {
  localStorage.setItem('ta_bt_aktif', $('chkPakaiBT')?.checked ? '1' : '0');
  flash($('chkPakaiBT')?.checked ? 'Mode Cetak Bluetooth AKTIF' : 'Mode Cetak Browser AKTIF');
}

// 3. WHATSAPP GATEWAY API (FONNTE / CUSTOM)
function muatPrefApiSetting() {
  if ($('chkPakaiBT')) $('chkPakaiBT').checked = localStorage.getItem('ta_bt_aktif') === '1';
  if ($('waApiUrl')) $('waApiUrl').value = localStorage.getItem('ta_wa_api_url') || 'https://api.fonnte.com/send';
  if ($('waApiToken')) $('waApiToken').value = localStorage.getItem('ta_wa_api_token') || '';
  if ($('waApiAktif')) $('waApiAktif').checked = localStorage.getItem('ta_wa_api_aktif') === '1';
}

function simpanWaApiConfig() {
  localStorage.setItem('ta_wa_api_url', txt('waApiUrl'));
  localStorage.setItem('ta_wa_api_token', txt('waApiToken'));
  localStorage.setItem('ta_wa_api_aktif', $('waApiAktif')?.checked ? '1' : '0');
  flash('Pengaturan WhatsApp API disimpan!');
}

async function tesWaApi() {
  const toko = getToko();
  if (!toko.telp) return flash('Isi No WA Toko di Identitas Toko dulu', 'err');
  await openWA(toko.telp, `Tes koneksi WA API dari *${toko.nama}* berhasil! (${new Date().toLocaleString('id-ID')})`);
}

// 4. FORECASTING STOK (PREDIKSI STOK HABIS 30 HARI TERAKHIR)
function renderForecastStok() {
  const el = $('listForecastStok'); if (!el) return;
  const batas30 = Date.now() - (30 * 86400000);
  const keluarMap = {}; // key: tipe_id -> qty keluar 30 hari terakhir
  const addKeluar = (key, qty) => { keluarMap[key] = (keluarMap[key] || 0) + (Number(qty) || 0); };

  (db.jual || []).filter(t => t.waktu && new Date(t.waktu).getTime() >= batas30).forEach(t => {
    (t.items || []).forEach(i => addKeluar('produk_' + i.produk_id, i.qty));
  });
  (db.servis || []).filter(s => s.waktu && new Date(s.waktu).getTime() >= batas30).forEach(s => {
    (s.parts || []).forEach(p => addKeluar('sparepart_' + p.part_id, p.qty));
    (s.baterai || []).forEach(b => addKeluar('baterai_' + b.baterai_id, b.qty));
  });
  (db.baterai || []).filter(b => b.waktu && new Date(b.waktu).getTime() >= batas30).forEach(b => {
    if (b.sb_id) addKeluar('baterai_' + b.sb_id, 1);
  });

  const semua = [
    ...db.produk.map(p => ({ key: 'produk_' + p.id, label: 'JAM', cls: 'proses', nama: p.nama, stok: p.stok || 0, min: 2 })),
    ...db.sparePart.map(sp => ({ key: 'sparepart_' + sp.id, label: 'PART', cls: 'warn', nama: sp.nama, stok: sp.stok || 0, min: sp.min_stok ?? 2 })),
    ...db.stokBaterai.map(sb => ({ key: 'baterai_' + sb.id, label: 'BAT', cls: 'ok', nama: 'Baterai ' + sb.tipe, stok: sb.stok || 0, min: sb.min_stok ?? 5 }))
  ];

  const hasil = semua.map(item => {
    const keluar30 = keluarMap[item.key] || 0;
    const perHari = keluar30 / 30;
    const estimasiHari = perHari > 0 ? Math.floor(item.stok / perHari) : (item.stok <= item.min ? 0 : 999);
    const targetStok30 = Math.max(item.min * 2, Math.ceil(keluar30 * 1.2));
    const saranBeli = Math.max(0, targetStok30 - item.stok);
    return { ...item, keluar30, estimasiHari, saranBeli };
  })
  .filter(x => x.keluar30 > 0 || x.stok <= x.min)
  .sort((a, b) => a.estimasiHari - b.estimasiHari)
  .slice(0, 15);

  if (!hasil.length) {
    el.innerHTML = '<div class="empty">Belum cukup data transaksi 30 hari terakhir untuk prediksi stok.</div>';
    return;
  }

  el.innerHTML = hasil.map(x => {
    const kritis = x.estimasiHari <= 7;
    const waspada = !kritis && x.estimasiHari <= 14;
    const badgeSt = kritis ? '<span class="badge danger">🚨 KRITIS</span>' : (waspada ? '<span class="badge warn">⚠️ SEGERA RESTOCK</span>' : '<span class="badge ok">✅ AMAN</span>');
    const teksHari = x.estimasiHari >= 999 ? '> 90 hari' : (x.stok === 0 ? 'HABIS' : `~${x.estimasiHari} hari lagi`);
    return `<div class="item-card ${kritis ? 'low-stock' : ''}">
      <div class="ic-head">
        <div>
          <span class="badge ${x.cls}" style="margin-right:4px;">${x.label}</span>${badgeSt}
          <div class="ic-title" style="margin-top:4px;">${esc(x.nama)}</div>
        </div>
        <div class="ic-stock ${kritis ? 'low' : ''}">Stok: ${x.stok}</div>
      </div>
      <div class="ic-grid">
        <div class="ic-cell"><span class="ic-lbl">Keluar (30 Hari)</span><span class="ic-val">${x.keluar30} unit</span></div>
        <div class="ic-cell"><span class="ic-lbl">Estimasi Habis</span><span class="ic-val ${kritis ? 'danger' : ''}">${teksHari}</span></div>
        <div class="ic-cell" style="grid-column:span 2;border-top:1px dashed #cbd5e1;padding-top:6px;flex-direction:row;justify-content:space-between;align-items:center;">
          <span class="ic-lbl">Rekomendasi Beli (Stok 30 Hari)</span>
          <span class="ic-val ok">${x.saranBeli > 0 ? '+' + x.saranBeli + ' unit' : 'Cukup'}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}
