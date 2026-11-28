// ==========================================================
//  SISTEM TOKO SEIKO ALBA SIDOARJO 108  (versi rapi + perbaikan)
//  Catatan: pengecekan role di sisi browser hanya mengatur TAMPILAN.
//  Pengamanan sebenarnya harus lewat Row Level Security (RLS) di Supabase.
// ==========================================================

// === STATE GLOBAL ===
let db = { produk: [], jual: [], servis: [], baterai: [], stokBaterai: [], sparePart: [], supplier: [], pembelian: [], kas: [], pelanggan: [], bank: [], auditBarang: [], settings: {}, auditLog: [], absensi: [], komisi: [], profilKaryawan: [] };
let cart = [], cartServis = [], cartBaterai = [], cartBateraiServis = [], cartServisGabungan = [];
let filterServisStatus = '', filterKasJenis = '', filterAuditUser = '';
let tempFotoBase64 = '', tempAuditData = {};
let statusKlaimAktif = { multiplier: 1, tipe: 'Normal' };
let modeKlaimProdukJualId = '';
db.bebanTetap = [];
let scanStream = null, scanTarget = null, scanInterval = null, scanMode = 'input';
let isProcessingPayment = false, isSavingServis = false, isSavingBaterai = false;
let realtimeChannel = null, refreshTimer = null;
let currentTenant = { toko_id: null, toko: null, profil: null, pengaturan: null };

// === KONSTANTA (ubah di sini bila aturan berubah) ===
const GARANSI_BATERAI_PENUH_BULAN = 6;     // default <= 6 bulan: gratis
const GARANSI_BATERAI_SETENGAH_BULAN = 9;  // default 7-9 bulan: bayar 50%
const MAX_KLAIM_SERVIS = 2;
function getRules() {
  const s = db.settings || {};
  return {
    batPenuh: +(s.garansi_baterai_penuh_bulan ?? GARANSI_BATERAI_PENUH_BULAN),
    batSetengah: +(s.garansi_baterai_setengah_bulan ?? GARANSI_BATERAI_SETENGAH_BULAN),
    maxKlaim: +(s.max_klaim_servis ?? MAX_KLAIM_SERVIS),
    servisBulan: +(s.garansi_servis_bulan ?? 3)
  };
}
const NILAI_POIN = 100;                    // 1 poin = Rp 100
const TRACK_URL = 'https://horopos.com/track.html';

const TOKO_DEFAULT = {
  nama: 'HoroPOS',
  telp: '',
  alamat: '',
  footer: 'Terima kasih telah berbelanja',
  syarat: 'PEMBELIAN PRODUK:\n1. Pembeli wajib memeriksa kondisi fisik, kelengkapan, dan fungsi barang sebelum meninggalkan toko.\n2. Barang yang telah dibeli tidak dapat ditukar atau dikembalikan, kecuali terdapat cacat produksi dari pabrik.\n3. Garansi mesin berlaku sesuai dengan ketentuan yang tertera pada nota. Garansi tidak berlaku untuk aksesoris (tali, kaca, baterai) kecuali disepakati lain.\n\nGARANSI PRODUK:\n1. Klaim garansi produk wajib menyertakan nota pembelian asli atau kartu garansi.\n2. Garansi produk TIDAK BERLAKU apabila: (a) Kerusakan akibat kelalaian pengguna (terjatuh, terbentur, tergores); (b) Jam kemasukan air di luar spesifikasi; (c) Segel rusak atau pernah dibongkar oleh pihak lain.\n3. Waktu pengerjaan klaim garansi produk berkisar 7-14 hari kerja.\n\nGARANSI SERVIS (3 BULAN):\n1. Setiap servis yang telah selesai diberikan garansi pekerjaan selama 3 (tiga) bulan sejak tanggal servis selesai, kecuali dinyatakan lain pada nota.\n2. Garansi servis mencakup jaminan pekerjaan teknisi atas kerusakan yang SAMA pada bagian yang telah diservis.\n3. Garansi servis TIDAK BERLAKU apabila: (a) Kerusakan akibat kelalaian pengguna (jam terjatuh, terbentur, tergores, kemasukan air); (b) Jam pernah dibuka/diperbaiki oleh pihak lain di luar toko kami; (c) Kerusakan pada bagian yang berbeda dari yang diservis sebelumnya.\n4. Garansi servis berlaku hanya jika pelanggan dapat menunjukkan nota servis asli.\n5. Garansi servis berakhir pada pukul 23:59 WIB di tanggal terakhir masa berlaku. Klaim yang diajukan pada atau sebelum waktu tersebut tetap sah dan belum daluwarsa.\n\nKLAIM GARANSI SERVIS:\n1. Klaim garansi servis hanya dapat dilakukan selama masa garansi masih aktif (lihat tanggal garansi pada nota).\n2. Biaya jasa teknisi GRATIS (Rp 0) untuk semua klaim garansi dalam masa berlaku.\n3. Penggantian spare part atau baterai (jika diperlukan) TETAP DIKENAKAN BIAYA sesuai harga yang berlaku.\n4. Klaim garansi maksimal 2 (dua) kali per nota servis. Klaim ke-3 dan seterusnya dikenakan biaya normal.\n5. Setiap perbaikan ulang dalam rangka klaim garansi diberikan garansi baru 3 (tiga) bulan untuk pekerjaan tersebut.\n6. Keputusan teknisi mengenai penyebab kerusakan dan perlu-tidaknya penggantian spare part adalah mutlak.\n7. Waktu pengerjaan klaim garansi berkisar 3-7 hari kerja tergantung antrian.',
  syaratSingkat: 'S&K PEMBELIAN:\n1. Barang yang telah dibeli tidak dapat ditukar/dikembalikan, kecuali cacat produksi pabrik.\n2. Pembeli wajib memeriksa kondisi barang sebelum bertransaksi.\n\nS&K GARANSI PRODUK:\n1. Wajib menunjukkan nota asli saat klaim.\n2. Garansi HANGUS apabila: Jam kemasukan air, terjatuh, atau segel rusak.\n\nS&K GARANSI SERVIS:\n1. Garansi servis 3 bulan sejak tanggal selesai (s/d 23:59 tanggal terakhir).\n2. Klaim: Jasa GRATIS, spare part/baterai tetap berbayar.\n3. Klaim maksimal 2x per nota. Klaim ke-3+ dikenakan biaya normal.\n4. Garansi HANGUS jika jam dibuka/diperbaiki pihak lain.\n5. Wajib menunjukkan nota servis asli saat klaim.'
};

const DAFTAR_METODE = { '1': 'tunai', '2': 'transfer', '3': 'qris', '4': 'edc_cc_bca', '5': 'edc_cc_vm', '6': 'edc_cc_amex', '7': 'edc_dc_bca', '8': 'edc_dc_lain', '9': 'edc_dc_maestro' };
const SUMBER_KAS = ['jual','servis','baterai','manual','kas_kecil','pembelian','rekonsiliasi','pelunasan_hutang','beban_bulanan','mdr'];

const SEMUA_MENU = ['kasir', 'servis', 'baterai', 'produk', 'sparepart', 'laporan', 'pelanggan', 'karyawan', 'kas', 'supplier', 'keuangan', 'semua_stok', 'laporan_audit', 'setting'];
const MENU_BY_ROLE = {
  kasir: ['kasir', 'baterai', 'pelanggan', 'karyawan'],
  admin: ['kasir', 'baterai', 'pelanggan', 'karyawan', 'servis', 'produk', 'sparepart', 'kas', 'supplier'],
  pemilik: SEMUA_MENU
};

// === HELPER UMUM ===
const $ = id => document.getElementById(id);
const num = id => +($(id)?.value) || 0;
const txt = id => ($(id)?.value || '').trim();
const CURRENCY_MAP = {
  IDR: { sym: 'Rp ', locale: 'id-ID', dec: 0 },
  USD: { sym: '$',   locale: 'en-US', dec: 2 },
  CNY: { sym: '¥',   locale: 'zh-CN', dec: 2 },
  SGD: { sym: 'S$',  locale: 'en-SG', dec: 2 },
  MYR: { sym: 'RM ', locale: 'ms-MY', dec: 2 }
};

function getMataUang() {
  const c = localStorage.getItem('horopos_curr') || 'IDR';
  return CURRENCY_MAP[c] ? c : 'IDR';
}

function setMataUang(code) {
  if (!CURRENCY_MAP[code]) return;
  localStorage.setItem('horopos_curr', code);
  location.reload();
}

function rp(n) {
  const cfg = CURRENCY_MAP[getMataUang()];
  const val = Number(n) || 0;
  return cfg.sym + val.toLocaleString(cfg.locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: cfg.dec
  });
}
function terapkanMataUangUI() {
  const cur = getMataUang();
  const cfg = CURRENCY_MAP[cur];
  const symClean = cfg.sym.trim();
  const el = document.getElementById('setMataUang');
  if (el) el.value = cur;

  // 1. Tombol Cepat Diskon
  const presetDiskon = {
    IDR: [{ lbl: '10rb', val: 10000 }, { lbl: '20rb', val: 20000 }],
    USD: [{ lbl: '$5',   val: 5 },     { lbl: '$10',  val: 10 }],
    CNY: [{ lbl: '¥10',  val: 10 },    { lbl: '¥20',  val: 20 }],
    SGD: [{ lbl: 'S$5',  val: 5 },     { lbl: 'S$10', val: 10 }],
    MYR: [{ lbl: 'RM5',  val: 5 },     { lbl: 'RM10', val: 10 }]
  }[cur] || [{ lbl: '10rb', val: 10000 }, { lbl: '20rb', val: 20000 }];

  const d1 = document.getElementById('btnDiskonNom1');
  const d2 = document.getElementById('btnDiskonNom2');
  if (d1) { d1.textContent = presetDiskon[0].lbl; d1.onclick = () => setDiskonCepat('nominal', presetDiskon[0].val); }
  if (d2) { d2.textContent = presetDiskon[1].lbl; d2.onclick = () => setDiskonCepat('nominal', presetDiskon[1].val); }

  // 2. Tombol Cepat Bayar
  const presetBayar = {
    IDR: [{ lbl: '50rb', val: 50000 }, { lbl: '100rb', val: 100000 }, { lbl: '200rb', val: 200000 }, { lbl: '500rb', val: 500000 }],
    USD: [{ lbl: '$10',  val: 10 },    { lbl: '$20',   val: 20 },     { lbl: '$50',   val: 50 },     { lbl: '$100',  val: 100 }],
    CNY: [{ lbl: '¥50',  val: 50 },    { lbl: '¥100',  val: 100 },    { lbl: '¥200',  val: 200 },    { lbl: '¥500',  val: 500 }],
    SGD: [{ lbl: 'S$10', val: 10 },    { lbl: 'S$20',  val: 20 },     { lbl: 'S$50',  val: 50 },     { lbl: 'S$100', val: 100 }],
    MYR: [{ lbl: 'RM10', val: 10 },    { lbl: 'RM20',  val: 20 },     { lbl: 'RM50',  val: 50 },     { lbl: 'RM100', val: 100 }]
  }[cur] || [{ lbl: '50rb', val: 50000 }, { lbl: '100rb', val: 100000 }, { lbl: '200rb', val: 200000 }, { lbl: '500rb', val: 500000 }];

  presetBayar.forEach((p, i) => {
    const btn = document.getElementById('btnBayarNom' + (i + 1));
    if (btn) { btn.textContent = p.lbl; btn.onclick = () => setBayarCepat(p.val); }
  });

  // 3. Tombol Cepat Kas Kecil
  const _kkLang = (typeof _getWaLang === 'function') ? _getWaLang() : 'id';
  const kkText = {
    id: [
      { t: '+ Potong Rantai', d: 'Jasa potong rantai', tp: 'masuk' },
      { t: '+ Potong Rantai', d: 'Jasa potong rantai', tp: 'masuk' },
      { t: '+ Springbar',     d: 'Ganti springbar / pen', tp: 'masuk' },
      { t: '- Beli Galon',    d: 'Beli air galon', tp: 'keluar' },
      { t: '- Makan/Minum',   d: 'Beli makan/minum', tp: 'keluar' }
    ],
    en: [
      { t: '+ Link Resize',    d: 'Strap link resize', tp: 'masuk' },
      { t: '+ Link Resize',    d: 'Strap link resize', tp: 'masuk' },
      { t: '+ Springbar',      d: 'Replace springbar / pin', tp: 'masuk' },
      { t: '- Drinking Water', d: 'Buy drinking water', tp: 'keluar' },
      { t: '- Food/Drinks',    d: 'Food & drinks', tp: 'keluar' }
    ],
    zh: [
      { t: '+ 截表带', d: '截表带服务', tp: 'masuk' },
      { t: '+ 截表带', d: '截表带服务', tp: 'masuk' },
      { t: '+ 换生耳', d: '更换生耳/表针', tp: 'masuk' },
      { t: '- 桶装水', d: '购买桶装水', tp: 'keluar' },
      { t: '- 餐饮费', d: '餐饮支出', tp: 'keluar' }
    ]
  }[_kkLang] || [];

  const kkNom = {
    IDR: [{ l: '15rb', v: 15000 }, { l: '20rb', v: 20000 }, { l: '10rb', v: 10000 }, { l: '20rb', v: 20000 }, { l: '25rb', v: 25000 }],
    USD: [{ l: '$5',   v: 5 },     { l: '$10',  v: 10 },    { l: '$3',   v: 3 },     { l: '$5',   v: 5 },     { l: '$10',  v: 10 }],
    CNY: [{ l: '¥10',  v: 10 },    { l: '¥20',  v: 20 },    { l: '¥10',  v: 10 },    { l: '¥15',  v: 15 },    { l: '¥25',  v: 25 }],
    SGD: [{ l: 'S$5',  v: 5 },     { l: 'S$10', v: 10 },    { l: 'S$3',  v: 3 },     { l: 'S$5',  v: 5 },     { l: 'S$10', v: 10 }],
    MYR: [{ l: 'RM5',  v: 5 },     { l: 'RM10', v: 10 },    { l: 'RM5',  v: 5 },     { l: 'RM10', v: 10 },    { l: 'RM15', v: 15 }]
  }[cur] || [{ l: '15rb', v: 15000 }, { l: '20rb', v: 20000 }, { l: '10rb', v: 10000 }, { l: '20rb', v: 20000 }, { l: '25rb', v: 25000 }];

  kkNom.forEach((n, i) => {
    const btn = document.getElementById('btnKK' + (i + 1));
    const tx = kkText[i];
    if (btn && tx) {
      btn.textContent = `${tx.t} ${n.l}`;
      btn.onclick = () => setKasKecilCepat(tx.tp, n.v, tx.d);
    }
  });
  // 3b. Tombol Cepat Ongkos Servis (25rb - 250rb)
const presetServis = {
  IDR: [25000, 50000, 75000, 100000, 150000, 200000, 250000],
  USD: [10, 20, 30, 50, 75, 100, 150],
  CNY: [30, 50, 80, 100, 150, 200, 300],
  SGD: [10, 20, 30, 50, 75, 100, 150],
  MYR: [20, 40, 60, 80, 100, 150, 200]
}[cur];
if (cur !== 'IDR' && presetServis) {
  const srvBtns = [...document.querySelectorAll('button')].filter(b => /^(25|50|75|100|150|200|250)rb$/.test(b.textContent.trim()));
  srvBtns.forEach((b, i) => {
    if (presetServis[i] !== undefined) {
      b.textContent = symClean + presetServis[i];
      b.setAttribute('onclick', b.getAttribute('onclick').replace(/\d+/, presetServis[i]));
    }
  });
}

  // 4. Sapu otomatis sisa teks "(Rp)" dan "Rp 0" di seluruh halaman jika bukan IDR
  if (cur !== 'IDR') {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      if (node.parentElement && ['SCRIPT', 'STYLE', 'OPTION'].includes(node.parentElement.tagName)) continue;
      let t = node.nodeValue;
      if (t.includes('(Rp') || t.includes('Rp 0') || /rp\s*500[.,]000/i.test(t)) {
  node.nodeValue = t
    .replace(/\(Rp(?=\s*[\/)])/g, `(${symClean}`)
    .replace(/\bRp 0\b/g, `${cfg.sym}0`)
    .replace(/rp\s*500[.,]000/gi, `${symClean}500`);
}
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  terapkanMataUangUI();
  setTimeout(terapkanMataUangUI, 400);
  setTimeout(terapkanMataUangUI, 1200);
});

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
  const _flLang = (typeof _getWaLang === 'function') ? _getWaLang() : 'id';
  const _flDict = {
    'Lengkapi Nama dan Produk': { en: 'Please fill in Name and Product', zh: '请填写姓名和产品' },
    'Anda sudah Absen Masuk hari ini!': { en: 'You have already clocked in today!', zh: '您今天已经上班打卡了！' },
    'Anda belum Absen Masuk hari ini!': { en: 'You have not clocked in today!', zh: '您今天尚未上班打卡了！' },
    'Anda sudah Absen Pulang hari ini!': { en: 'You have already clocked out today!', zh: '您今天已经下班打卡了！' },
    '✅ Absen Masuk berhasil dicatat!': { en: '✅ Clock-in recorded!', zh: '✅ 上班打卡成功！' },
    '✅ Absen Pulang berhasil dicatat!': { en: '✅ Clock-out recorded!', zh: '✅ 下班打卡成功！' },
    'Aturan komisi disimpan!': { en: 'Commission rules saved!', zh: '提成规则已保存！' },
    'Keranjang masih kosong!': { en: 'Cart is empty!', zh: '购物车为空！' },
    'Data berhasil disimpan!': { en: 'Data saved successfully!', zh: '数据保存成功！' }
  };
  if (_flLang !== 'id') {
    if (_flDict[text] && _flDict[text][_flLang]) text = _flDict[text][_flLang];
    else if (typeof I18N_DICT !== 'undefined' && I18N_DICT[text] && I18N_DICT[text][_flLang]) text = I18N_DICT[text][_flLang];
  }
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
  const tk = currentTenant.toko || {};
  const s = db.settings || {};
  const t = { ...TOKO_DEFAULT, syarat_singkat: TOKO_DEFAULT.syaratSingkat };
  if (tk.nama_toko) t.nama = tk.nama_toko;
  if (tk.alamat) t.alamat = tk.alamat;
  if (tk.no_wa) t.telp = tk.no_wa;
  if (tk.footer_struk) t.footer = tk.footer_struk;
  if (tk.syarat_wa) t.syarat = tk.syarat_wa;
  if (tk.syarat_singkat) t.syarat_singkat = tk.syarat_singkat;
  Object.keys(s).forEach(k => { if (s[k] !== null && s[k] !== undefined && s[k] !== '') t[k] = s[k]; });
  return t;
}

function emailDariInput(input) {
  const v = (input || '').trim().toLowerCase();
  return v.includes('@') ? v : (v + '@tokoseiko.com');
}

function terapkanIdentitasToko() {
  const t = getToko();
  const nama = t.nama || 'HoroPOS';
  document.title = '⌚ ' + nama;
  if ($('hdrTokoNama')) $('hdrTokoNama').textContent = nama.toUpperCase();
}

async function muatProfilDanToko(userId) {
  const { data: profil, error: e1 } = await supabaseClient
    .from('profil_user')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (e1) throw new Error('Gagal membaca profil user: ' + e1.message);
  if (!profil) throw new Error('Akun ini belum terdaftar di tabel profil_user. Hubungi admin.');
  if (profil.aktif === false) throw new Error('Akun Anda sedang dinonaktifkan.');

  const { data: toko, error: e2 } = await supabaseClient
    .from('toko')
    .select('*')
    .eq('id', profil.toko_id)
    .single();
  if (e2 || !toko) throw new Error('Data toko tidak ditemukan.');
  if (toko.aktif === false) throw new Error('Akses toko sedang dinonaktifkan. Hubungi pengelola.');

  if (toko.masa_aktif_sampai && new Date(toko.masa_aktif_sampai) < new Date()) {
    const tglExp = new Date(toko.masa_aktif_sampai).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    throw new Error('Masa langganan toko (' + toko.nama_toko + ') berakhir pada ' + tglExp + '. Silakan perpanjang langganan.');
  }

  const { data: peng } = await supabaseClient
    .from('pengaturan_toko')
    .select('*')
    .eq('toko_id', profil.toko_id)
    .maybeSingle();

  currentTenant = { toko_id: profil.toko_id, toko, profil, pengaturan: peng || null };
  if (peng) {
    if (peng.wa_api_url) localStorage.setItem('ta_wa_api_url', peng.wa_api_url);
    if (peng.wa_api_token !== undefined && peng.wa_api_token !== null) localStorage.setItem('ta_wa_api_token', peng.wa_api_token);
    localStorage.setItem('ta_wa_api_aktif', peng.wa_api_aktif ? '1' : '0');
    if (peng.tg_bot_token !== undefined && peng.tg_bot_token !== null) localStorage.setItem('ta_tg_token', peng.tg_bot_token);
    if (peng.tg_chat_id !== undefined && peng.tg_chat_id !== null) localStorage.setItem('ta_tg_chat_id', peng.tg_chat_id);
    localStorage.setItem('ta_tg_aktif', peng.tg_aktif ? '1' : '0');
  }
  terapkanIdentitasToko();
  return currentTenant;
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
    const { data: sesi, error: loginErr } = await tmp.auth.signInWithPassword({ email: emailDariInput(u), password: p });
    if (loginErr) return { data: null, error: { message: 'Login otorisasi gagal: ' + loginErr.message } };
    const { data: profOto } = await tmp.from('profil_user').select('role, toko_id').eq('user_id', sesi.user.id).maybeSingle();
    const role = profOto?.role || tentukanRole(sesi.user, u);
    if (profOto && currentTenant.toko_id && profOto.toko_id !== currentTenant.toko_id) return { data: null, error: { message: 'Akun otorisasi bukan dari toko ini' } };
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
      ambil('beban_tetap', '*', 'nama'),
      ambil('absensi_karyawan', '*', 'tanggal', false, 300),
      ambil('komisi_karyawan', '*', 'waktu', false, 300),
      isPemilik() ? ambil('profil_user', '*', 'username', true, 100) : Promise.resolve({ data: [], error: null }),
      ambil('pemakaian_baterai_gratis', '*', 'created_at', false, 500)
    ]);
    hasil.forEach(r => { if (r.error) console.error('Gagal tarik data:', r.error.message); });
    const [set, p, sp, sb, j, s, b, k, pel, bnk, sup, pem, aud, alog, bbt, abs, kom, profKar, batGratis] = hasil;
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
    db.absensi = pakai(abs, db.absensi || []);
    db.komisi = pakai(kom, db.komisi || []);
    db.bateraiGratis = pakai(batGratis, db.bateraiGratis || []);
    db.profilKaryawan = pakai(profKar, db.profilKaryawan || []);
    if (isAdmin()) { await muatModalBarang(); await muatAuditDraftHariIni(); }
    render();
    if ($('pSerial') && !$('pId')?.value && (!$('pSerial').value || /^sas\d+$/i.test($('pSerial').value.trim()))) {
    $('pSerial').value = generateNextBarcodeSas();
    }
  } catch (e) { console.error('Gagal tarik data:', e); }
}

// === REAL-TIME SYNC ===
function jadwalRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(tarikSemuaData, 800); }

let sesiCheckTimer = null;
let sedangKickSesi = false;

async function daftarkanSesiTunggal(userId) {
  if (!userId || !supabaseClient) return;
  try {
    await supabaseClient.auth.signOut({ scope: 'others' });
  } catch (_) { }
  const token = genId('SES');
  localStorage.setItem('ta_session_token', token);
  localStorage.setItem('ta_uid', userId);
  sessionStorage.setItem('ta_session_token', token);
  sessionStorage.setItem('ta_uid', userId);
  try {
    const payloadSesi = {
      user_id: userId,
      session_token: token,
      device_info: (navigator.userAgent || '').slice(0, 120),
      updated_at: nowISO()
    };
    if (currentTenant.toko_id) payloadSesi.toko_id = currentTenant.toko_id;
    const { error } = await supabaseClient.from('sesi_aktif').upsert(payloadSesi);
    if (error) console.warn('Gagal simpan sesi_aktif:', error.message);
  } catch (e) { console.warn('Tabel sesi_aktif belum dibuat:', e.message); }
}

async function verifikasiSesiTunggal() {
  if (sedangKickSesi || !supabaseClient) return true;
  const uid = localStorage.getItem('ta_uid') || sessionStorage.getItem('ta_uid');
  const lokal = localStorage.getItem('ta_session_token') || sessionStorage.getItem('ta_session_token');
  if (!uid || !lokal) return true;
  try {
    const { data, error } = await supabaseClient.from('sesi_aktif').select('session_token').eq('user_id', uid).maybeSingle();
    if (error || !data) return true;
    if (data.session_token && data.session_token !== lokal) {
      sedangKickSesi = true;
      alert('⚠️ Akun ini baru saja login di perangkat lain.\nAnda akan dikeluarkan demi keamanan.');
      await logout(true);
      sedangKickSesi = false;
      return false;
    }
  } catch (_) { }
  return true;
}

function mulaiPantauSesi() {
  if (sesiCheckTimer) clearInterval(sesiCheckTimer);
  sesiCheckTimer = setInterval(() => {
    if (sessionStorage.getItem('ta_logged') === '1') verifikasiSesiTunggal();
  }, 10000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sessionStorage.getItem('ta_logged') === '1') {
    verifikasiSesiTunggal();
  }
});

function setupRealtime() {
  if (!supabaseClient) return;
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel = supabaseClient.channel('realtime-db');
  ['produk', 'sparepart', 'stok_baterai', 'jual', 'servis', 'baterai', 'kas', 'pelanggan'].forEach(t => {
    realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table: t }, jadwalRefresh);
  });
  // Pantau sesi_aktif secara realtime: jika perangkat lain login, langsung tendang!
  const uid = localStorage.getItem('ta_uid') || sessionStorage.getItem('ta_uid');
  if (uid) {
    realtimeChannel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'sesi_aktif', filter: `user_id=eq.${uid}`
    }, payload => {
      const baru = payload?.new?.session_token;
      const lokal = localStorage.getItem('ta_session_token') || sessionStorage.getItem('ta_session_token');
      if (baru && lokal && baru !== lokal && !sedangKickSesi) {
        sedangKickSesi = true;
        alert('⚠️ Akun ini baru saja login di perangkat lain.\nAnda akan dikeluarkan demi keamanan.');
        logout(true).finally(() => { sedangKickSesi = false; });
      }
    });
  }
  realtimeChannel.subscribe();
  mulaiPantauSesi();
}

// === LOGIN & LOGOUT ===
async function login() {
  const btn = document.querySelector('#loginOverlay button');
  const setErr = m => { const el = $('loginErr'); if (el) el.textContent = m; };
  const lang = localStorage.getItem('ta_lang') || 'id';
  const tLogin = (id, en, zh) => lang === 'en' ? en : (lang === 'zh' ? zh : id);

  setErr('');
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    return setErr(tLogin('Koneksi database belum siap. Muat ulang halaman.', 'Database connection not ready. Please reload.', '数据库连接未就绪，请刷新页面。'));
  }

  const user = txt('loginUser').toLowerCase();
  const pass = $('pinInput')?.value || '';
  if (!user || !pass) {
    return setErr(tLogin('Username dan Password wajib diisi!', 'Username and Password are required!', '请输入用户名和密码！'));
  }

  if (btn) { btn.disabled = true; btn.textContent = tLogin('Memeriksa...', 'Checking...', '正在验证...'); }
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email: emailDariInput(user), password: pass });
    if (error) throw error;

    const tenant = await muatProfilDanToko(data.user.id);
    sessionStorage.setItem('ta_logged', '1');
    sessionStorage.setItem('ta_user', tenant.profil.username || user);
    sessionStorage.setItem('ta_role', tenant.profil.role || tentukanRole(data.user, user));
    sessionStorage.setItem('ta_toko_id', tenant.toko_id);
    await daftarkanSesiTunggal(data.user?.id);

    if (btn) btn.textContent = tLogin('Memuat Data...', 'Loading Data...', '正在加载数据...');
    fotoSudahDimuat = false;
    await tarikSemuaData(true);
    setupRealtime();
    await catatLog('LOGIN', 'Berhasil masuk sistem');

    $('loginOverlay').classList.add('hidden');
    applyRoleUI();
    bukaMenu('home');
    cekBannerLangganan();
    flash(tLogin('Login Berhasil!', 'Login Successful!', '登录成功！'));
  } catch (e) {
    console.error('Gagal login:', e);
    try { await supabaseClient.auth.signOut(); } catch (_) { }
    sessionStorage.clear();
    currentTenant = { toko_id: null, toko: null, profil: null, pengaturan: null };
    setErr(e.message || tLogin('Login gagal', 'Login failed', '登录失败'));
  } finally {
    if (btn) { btn.textContent = tLogin('Masuk', 'Sign In', '登录'); btn.disabled = false; }
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
  if (sesiCheckTimer) { clearInterval(sesiCheckTimer); sesiCheckTimer = null; }
  localStorage.removeItem('ta_session_token');
  localStorage.removeItem('ta_uid');
  sessionStorage.clear();
  cart = []; cartServis = []; cartBaterai = []; cartBateraiServis = []; cartServisGabungan = [];
  tempAuditData = {}; modeKlaimProdukJualId = ''; statusKlaimAktif = { multiplier: 1, tipe: 'Normal' };
  currentTenant = { toko_id: null, toko: null, profil: null, pengaturan: null };
  document.title = '⌚ HoroPOS';
  if ($('hdrTokoNama')) $('hdrTokoNama').textContent = 'HOROPOS';
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
    if (tabId === 'setting') { isiFormSetting(true); muatPrefApiSetting(); if (isPemilik()) { pasangUILogoSetting(); renderPreviewLogo(); if (typeof tampilkanPanelAksesMenu === 'function') tampilkanPanelAksesMenu(); } if (typeof terapkanBahasa === 'function') terapkanBahasa();}
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

function generateNextBarcodeSas() {
  const list = (typeof db !== 'undefined' && Array.isArray(db.produk)) ? db.produk : [];
  let maxNum = 0;

  list.forEach(p => {
    const kode = String(p.serial || p.barcode || '').trim();
    const match = kode.match(/^sas(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  });

  return 'sas' + String(maxNum + 1).padStart(4, '0');
}

function resetFormProduk() {
  ['pId', 'pNama', 'pMerek', 'pHBeli', 'pHJual', 'pStok', 'pSerial', 'pFoto'].forEach(x => { if ($(x)) $(x).value = ''; });
  tempFotoBase64 = '';
  if ($('pSerial')) $('pSerial').value = generateNextBarcodeSas();
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
    catatKomisiOtomatis('jual', data.id, data.total, `Penjualan ${data.id}`);
    const isBonusBat = document.querySelector('input[name="optBonusBat"]:checked')?.value === 'ya';
    const selectedBateraiId = $('selectBonusBaterai')?.value;
    if (isBonusBat && selectedBateraiId) {
      try {
        const resBat = await catatBateraiGratis({
          bateraiId: selectedBateraiId,
          kategori: 'bonus_beli_jam',
          keterangan: 'Bonus pembelian jam',
          noNota: data.id
        });
        trxHeader.bonus_baterai = resBat.nama_baterai;
      } catch (errBat) {
    flash('Transaksi tersimpan, tapi baterai gratis gagal dicatat: ' + errBat.message, 'err');
      }
    }
    flash('Transaksi berhasil');
    try { cetakStruk(data.id); } catch (e) { console.error(e); flash('Transaksi tersimpan, tetapi struk gagal dicetak: ' + e.message, 'err'); }

    cart = [];
    ['custNama', 'custHp'].forEach(x => { if ($(x)) $(x).value = ''; });
    ['bayar', 'nilaiDiskon', 'tukarPoin', 'infoPoin'].forEach(x => { if ($(x)) $(x).value = 0; });
    const radioTidak = document.querySelector('input[name="optBonusBat"][value="tidak"]');
    if (radioTidak) radioTidak.checked = true;
    togglePilihBonusBaterai(false);
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
    const listKondisi = Array.from(document.querySelectorAll('.chk-kondisi:checked')).map(cb => {
    const lbl = document.querySelector(`label[for="${cb.id}"]`);
    return lbl ? lbl.textContent.trim() : cb.value;
  });
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
    if (!parent || !bisaKlaimGaransi(parent) || terpakai >= getRules().maxKlaim) return flash('Kuota klaim garansi untuk nota ini sudah habis', 'err');
  }
  if (isKlaimProduk) {
    const jualInduk = db.jual.find(x => x.id === parentJualId);
    const terpakai = db.servis.filter(s => s.parent_jual_id === parentJualId && s.is_klaim_produk).length
      + cartServisGabungan.filter(i => i.parentJualId === parentJualId).length;
    if (!jualInduk || terpakai >= getRules().maxKlaim) return flash('Kuota klaim garansi produk untuk nota ini sudah habis', 'err');
  }

  const jasa = (isKlaim || isKlaimProduk || garansi === 'garansi') ? 0 : num('sJasa');
  const totalParts = cartServis.reduce((s, c) => s + c.harga * c.qty, 0);
  const totalBaterai = cartBateraiServis.reduce((s, c) => s + c.harga * c.qty, 0);
  const biayaPelanggan = jasa + totalParts + totalBaterai;

    cartServisGabungan.push({
    customer, telp, produk, keluhan, catatan, kondisiFisik, garansi, isKlaim, parentId,
    isKlaimProduk, parentJualId,
    jasa, totalParts, totalBaterai, biayaPelanggan,
    fotoKondisi: tempFotoKondisiServis.filter(Boolean),
    parts: [...cartServis], baterai: [...cartBateraiServis]
  });

  renderKeranjangServis();

  // Reset form per-jam (nama & HP dibiarkan), termasuk mode klaim agar tidak menular ke jam berikutnya
  ['sProduk', 'sKeluhan', 'sCatatan'].forEach(x => { if ($(x)) $(x).value = ''; });
  if (typeof resetFotoKondisiServis === 'function') resetFotoKondisiServis();
  $('sJasa').value = 0;
  if (typeof sembunyikanDropdownGaransi === 'function') sembunyikanDropdownGaransi();
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
    await simpanFotoKondisiPascaRpc(data, cartServisGabungan);

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
    await tarikSemuaData();
    if (data?.paid && s.status === 'selesai') {
      if (confirm('Tagihan sudah LUNAS!\n\nApakah pelanggan langsung mengambil jam sekarang? (Lanjut ke Tanda Tangan Pengambilan)')) {
        bukaModalAmbilServis(id);
      }
    }
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
  if (nextStatus === 'diambil') {
    if (!s.paid && s.sisa > 0) return flash('Lunasi sisa tagihan dulu sebelum jam diambil.', 'err');
    return bukaModalAmbilServis(id);
  }

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
    if (nextStatus === 'selesai') catatKomisiOtomatis('servis', s.id, s.biaya_pelanggan || 0, `Servis selesai ${s.id} (${s.produk})`);
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
  if ((s.klaim_count || 0) >= getRules().maxKlaim) return false;
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
  if (!confirm(`KLAIM GARANSI\n\nPelanggan: ${s.customer}\nSisa kuota: ${getRules().maxKlaim - (s.klaim_count || 0)}x\n\nLanjut?`)) return;
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
      const hargaJual = Math.max(0, num('sbJual'));
      if (hargaJual > 0 && hargaJual !== sb.harga_jual) {
      await dbOk(supabaseClient.from('stok_baterai').update({ harga_jual: hargaJual, updated_at: nowISO() }).eq('id', sb.id));
      }

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

function buatKodeKlaim() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let kode = '';
  for (let i = 0; i < 6; i++) kode += chars[Math.floor(Math.random() * chars.length)];
  return kode;
}

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
    const adaKlaim = items.some(x => x.jenis_klaim && x.jenis_klaim !== 'Normal');
    if (adaKlaim && window._lastRefBateraiId) {
    const langAktif = localStorage.getItem('ta_lang') || 'id';
const teksPrompt = {
  id: '🔐 Minta pelanggan menyebutkan/mengetik KODE KLAIM dari WA E-Warranty:',
  en: '🔐 Ask the customer to provide/enter the CLAIM CODE from E-Warranty WA:',
  zh: '🔐 请顾客提供/输入电子保修单（WA）上的索赔码：'
}[langAktif] || '🔐 Minta pelanggan menyebutkan/mengetik KODE KLAIM dari WA E-Warranty:';
const inputKode = prompt(teksPrompt);
      if (!inputKode) {
        isSavingBaterai = false;
        return flash('Klaim dibatalkan: Kode klaim wajib diisi', 'err');
      }
    const { data: cek, error: errCek } = await supabaseClient.rpc('verifikasi_kode_klaim', {
        p_baterai_id: String(window._lastRefBateraiId),
        p_kode: inputKode.trim()
      });
      if (errCek || !cek?.ok) {
        isSavingBaterai = false;
        return flash('❌ ' + (cek?.msg || errCek?.message || 'Kode klaim tidak cocok'), 'err');
      }
      flash(`✅ Kode klaim valid! Sisa kuota: ${cek.sisa}`);
    }
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
    catatKomisiOtomatis('baterai', data.items?.[0]?.id || 'BAT', items.reduce((a, x) => a + (x.qty || 1), 0), `Ganti baterai ${nama}`);
    const listCetak = data.items.map((h, i) => ({ ...items[i], id: h.id, tgl_expired: h.tgl_expired, biaya: h.biaya }));
    try { cetakStrukGabunganBaterai(listCetak, nama, telp, data.total); } catch (e) { console.error(e); flash('Data tersimpan, tetapi struk gagal dicetak: ' + e.message, 'err'); }
        // Buat kode klaim rahasia & kirim e-warranty otomatis via Fonnte (khusus transaksi normal bergaransi)
    if (garansi > 0 && telp) {
      const daftarKode = [];
      for (const item of listCetak) {
        if (!item.jenis_klaim || item.jenis_klaim === 'Normal') {
          const kode = buatKodeKlaim();
          await supabaseClient.from('garansi_kode').insert({
            toko_id: currentTenant.toko_id,
            baterai_id: String(item.id),
            kode: kode,
            kuota: 1 // ubah ke 2 jika ingin kuota klaim 2x
          });
          daftarKode.push(`• ${item.produk}: *${kode}* (Exp: ${item.tgl_expired || '-'})`);
        }
      }
      if (daftarKode.length) {
        const pesanWA = {
  id: `Halo ${nama},\nTerima kasih telah mengganti baterai jam tangan Anda.\n\n*E-WARRANTY & KODE KLAIM*\n${daftarKode.join('\n')}\n\nSimpan pesan ini. Tunjukkan kode di atas saat melakukan klaim garansi.`,
  en: `Hello ${nama},\nThank you for replacing your watch battery with us.\n\n*E-WARRANTY & CLAIM CODE*\n${daftarKode.join('\n')}\n\nPlease save this message and show the code above when claiming your warranty.`,
  zh: `您好 ${nama}，\n感谢您在本店更换手表电池。\n\n*电子保修单与索赔码*\n${daftarKode.join('\n')}\n\n请保存此消息，申请保修时请出示以上索赔码。`
}[localStorage.getItem('ta_lang') || 'id'];
        openWA(telp, pesanWA, true);
      }
    }

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
  window._lastRefBateraiId = null;
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
  window._lastRefBateraiId = terakhir.id; 
  const sudahPernahKlaim = (terakhir.jenis_klaim && terakhir.jenis_klaim !== 'Normal') || Number(terakhir.biaya || 0) === 0;

  let pesan, warna, warnaTeks;
  if (sudahPernahKlaim) {
    statusKlaimAktif = { multiplier: 1, tipe: 'Normal' };
    pesan = `❌ SUDAH PERNAH KLAIM (${terakhir.jenis_klaim || 'Gratis'} pada ${new Date(terakhir.tgl_ganti).toLocaleDateString('id-ID')}). Klaim baterai hanya 1x & harga khusus tidak berlaku. Biaya: Full`;
    warna = '#fee2e2'; warnaTeks = '#7f1d1d';
  } else if (selisih <= getRules().batPenuh) {
    statusKlaimAktif = { multiplier: 0, tipe: 'Garansi (Gratis)' };
    pesan = `✅ MASIH GARANSI (Bulan ke-${selisih}, belum pernah klaim). Klaim 1x GRATIS: Rp 0`;
    warna = '#dcfce7'; warnaTeks = '#14532d';
  } else if (selisih <= getRules().batSetengah) {
    statusKlaimAktif = { multiplier: 0.5, tipe: 'Harga Khusus 50%' };
    pesan = `🎁 HARGA KHUSUS / DISKON 50% (Bulan ke-${selisih}, tidak ada klaim selama masa garansi). Biaya: 50%`;
    warna = '#fef3c7'; warnaTeks = '#78350f';
  } else {
    statusKlaimAktif = { multiplier: 1, tipe: 'Normal' };
    pesan = `❌ LEWAT GARANSI & HARGA KHUSUS (>${getRules().batSetengah} bulan, bulan ke-${selisih}). Biaya Baterai: Full`;
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

  // 1. Hitung total keluar hari ini (konversi ke tanggal lokal agar akurat lewat tengah malam)
    const hariIni = tglLokal();
  const totalKeluarHariIni = (db.kas || [])
    .filter(k => {
      const sumber = String(k.sumber || '').toLowerCase();
      const jenis = String(k.jenis || '').toLowerCase();
      if (sumber !== 'kas_kecil' || jenis !== 'keluar') return false;
      const rawTgl = k.waktu || k.tanggal || k.tgl || k.created_at || '';
      const tglLokalItem = String(rawTgl).includes('T')
        ? new Date(rawTgl).toLocaleDateString('en-CA')
        : String(rawTgl).slice(0, 10);
      return tglLokalItem === hariIni;
    })
    .reduce((s, k) => s + Number(k.nominal || 0), 0);

  if (jenis === 'keluar' && isKasir() && (totalKeluarHariIni + nominal) > 500000) {
    return flash(`Batas pengeluaran kas kecil harian (Rp500.000) terlampaui. Terpakai hari ini: ${rp(totalKeluarHariIni)}`, 'err');
  }

  try {
    await catatKas({ jenis, metode: 'tunai', nominal, keterangan: ket, sumber: 'kas_kecil' });
    await catatLog('KAS_KECIL', `Input ${jenis} - ${ket} (${rp(nominal)})`);

    // 2. Notifikasi instan ke Telegram Pemilik (aman tanpa ReferenceError)
    if (typeof kirimTelegram === 'function') {
      const userAktif = (typeof currentTenant !== 'undefined' && (currentTenant?.nama_user || currentTenant?.nama)) || 'Kasir';
      const icon = jenis === 'keluar' ? '💸' : '💰';
      kirimTelegram(`${icon} *KAS KECIL (${jenis.toUpperCase()})*\n👤 Oleh: ${userAktif}\n💵 Nominal: ${rp(nominal)}\n📝 Ket: ${ket}\n📊 Total keluar hari ini: ${rp(jenis === 'keluar' ? totalKeluarHariIni + nominal : totalKeluarHariIni)}`);
    }

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
    const row = { id: 'toko', ...data };
    if (currentTenant.toko_id) row.toko_id = currentTenant.toko_id;
    await dbOk(supabaseClient.from('settings').upsert(row, { onConflict: 'toko_id,id' }));
    if (aksi === 'SETTING' && currentTenant.toko_id && data.nama) {
      await dbOk(supabaseClient.from('toko').update({
        nama_toko: data.nama, alamat: data.alamat || '', no_wa: data.telp || '',
        footer_struk: data.footer || '', syarat_wa: data.syarat || '', syarat_singkat: data.syarat_singkat || ''
      }).eq('id', currentTenant.toko_id));
      if (currentTenant.toko) {
        currentTenant.toko.nama_toko = data.nama;
        currentTenant.toko.alamat = data.alamat || '';
        currentTenant.toko.no_wa = data.telp || '';
      }
      terapkanIdentitasToko();
    }
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
const simpanGaransiServis = () => simpanSetting({
  garansi_servis_bulan: num('setGaransiServisBulan'),
  max_klaim_servis: Math.max(1, num('setMaxKlaimServis') || 2),
  garansi_baterai_penuh_bulan: num('setBatPenuhBulan'),
  garansi_baterai_setengah_bulan: num('setBatSetengahBulan')
}, 'SETTING_GARANSI', 'Mengubah aturan garansi servis & baterai', 'Aturan garansi & baterai disimpan!');
const simpanAturanDiskon = () => simpanSetting({ diskon_persen: num('setDiskonPersen'), diskon_nominal: num('setDiskonNominal') }, 'SETTING_DISKON', 'Mengubah aturan diskon', 'Aturan diskon disimpan');

function isiFormSetting(paksa = false) {
  const s = db.settings;
  if (!s) return;
  const isi = (id, val) => { const el = $(id); if (el && (paksa || el !== document.activeElement)) el.value = val; };
  isi('tkNama', s.nama || ''); isi('tkTelp', s.telp || ''); isi('tkAlamat', s.alamat || ''); isi('tkFooter', s.footer || '');
  isi('tkSyarat', s.syarat || TOKO_DEFAULT.syarat); isi('tkSyaratSingkat', s.syarat_singkat || TOKO_DEFAULT.syaratSingkat);
  isi('setGaransiServisBulan', s.garansi_servis_bulan ?? 3);
  isi('setMaxKlaimServis', s.max_klaim_servis ?? 2);
  isi('setBatPenuhBulan', s.garansi_baterai_penuh_bulan ?? 6);
  isi('setBatSetengahBulan', s.garansi_baterai_setengah_bulan ?? 9);
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

function cetakViaRawBT(html) {
  try {
    const teks = htmlKeTeksStruk(html) + '\n\n\n';
    const b64 = btoa(unescape(encodeURIComponent(teks)));
    window.location.href = 'rawbt:base64,' + b64;
    flash('🖨️ Mengirim struk ke Printer Bluetooth (RawBT)...');
    return true;
  } catch (e) {
    flash('Gagal mengirim ke RawBT: ' + e.message, 'err');
    return false;
  }
}

function cetakHTML(html) {
  if (typeof trStruk === 'function') {
    const _imgs = [];
    html = html.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, m => {
      _imgs.push(m);
      return `__IMG_SAFE_${_imgs.length - 1}__`;
    });
    html = trStruk(html);
    html = html.replace(/__IMG_SAFE_(\d+)__/g, (_, i) => _imgs[i]);
  }
  // 1. Jika mode Bluetooth Web aktif & terhubung (Chrome)
  if (localStorage.getItem('ta_bt_aktif') === '1' && btCharacteristic) {
    const teks = htmlKeTeksStruk(html);
    btPrintText(teks).then(ok => {
      if (ok) flash('🖨️ Struk dicetak via Bluetooth');
      else cetakViaBrowser(html);
    }).catch(() => cetakViaBrowser(html));
    return;
  }
  // 2. Jika mode RawBT APK aktif (Android WebView)
  if (localStorage.getItem('ta_rawbt_aktif') === '1') {
    cetakViaRawBT(html);
    return;
  }
  // 3. Tampilkan Modal Preview Struk (aman di APK & Browser, selalu ada tombol Kembali)
  cetakViaBrowser(html);
}

let __lastPrintHTML = '';
function cetakViaBrowser(html) {
  __lastPrintHTML = html;
  let ov = $('modalPreviewStruk');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'modalPreviewStruk';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.88);z-index:9950;display:flex;flex-direction:column;padding:12px;';
  ov.innerHTML = `
    <div style="max-width:460px;width:100%;margin:auto;background:#ffffff;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;max-height:92vh;box-shadow:0 12px 35px rgba(0,0,0,.5);">
      <div style="background:#0f1f3d;color:#fbbf24;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <b style="font-size:15px;">🧾 Preview Nota / Struk</b>
        <button type="button" onclick="$('modalPreviewStruk').remove()" style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:800;font-size:14px;">✕ Kembali</button>
      </div>
      <iframe id="framePreviewStruk" style="width:100%;flex:1;min-height:360px;border:none;background:#fff;"></iframe>
      <div style="padding:10px 12px;background:#f8fafc;border-top:1.5px solid #cbd5e1;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button type="button" onclick="cetakViaRawBT(__lastPrintHTML)" style="background:#15803d;color:#fff;border:none;border-radius:10px;padding:12px;font-weight:800;font-size:14px;">🖨️ Bluetooth (RawBT)</button>
        <button type="button" onclick="printIframeStruk()" style="background:#2563eb;color:#fff;border:none;border-radius:10px;padding:12px;font-weight:800;font-size:14px;">🖨️ Print Browser</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const fr = $('framePreviewStruk');
  if (fr && fr.contentWindow) {
    fr.contentWindow.document.open();
    fr.contentWindow.document.write(html);
    fr.contentWindow.document.close();
  }
}

function printIframeStruk() {
  const fr = $('framePreviewStruk');
  try {
    if (fr && fr.contentWindow) {
      fr.contentWindow.focus();
      fr.contentWindow.print();
    }
  } catch (e) {
    flash('Print sistem tidak tersedia di perangkat ini. Gunakan tombol Bluetooth (RawBT).', 'err');
  }
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

function kompresFotoUntukAI(file, maxWidth = 1024) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file foto'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak valid'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function scanFotoAI() {
  const fileInput = $('pFoto');
  if (!fileInput.files || !fileInput.files.length) return flash('Pilih foto produk terlebih dahulu', 'err');

  const loading = $('loadingAI');
  if (loading) loading.style.display = 'flex';
  flash('Membaca label dengan AI Vision...', 'ok');

  try {
    const imageBase64 = await kompresFotoUntukAI(fileInput.files[0]);
    const { data, error } = await supabaseClient.functions.invoke('smooth-worker', {
      body: { imageBase64 }
    });

    if (error) throw new Error(error.message || 'Gagal menghubungi server AI');
    if (data?.error) throw new Error(data.error);

    if (data?.nama && $('pNama')) $('pNama').value = data.nama;
    if (data?.merek && $('pMerek')) $('pMerek').value = data.merek;
    if (Number(data?.harga_jual) > 0 && $('pHJual')) $('pHJual').value = Number(data.harga_jual);

    flash('AI berhasil membaca label produk!');
  } catch (e) {
    console.error('Scan AI error:', e);
    flash('Gagal scan AI: ' + e.message, 'err');
  } finally {
    if (loading) loading.style.display = 'none';
  }
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

async function openWA(hp, text, noFallback = false) {
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
  if (noFallback) return flash('❌ WA E-Warranty gagal terkirim via Fonnte (fallback diblokir demi keamanan)', 'err');
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
  const lang = _getWaLang();
  const locale = lang === 'zh' ? 'zh-CN' : (lang === 'en' ? 'en-US' : 'id-ID');

  const statusMap = {
    id: { antri: 'ANTRI', proses: 'PROSES', selesai: 'SELESAI', diambil: 'DIAMBIL' },
    en: { antri: 'RECEIVED', proses: 'IN PROGRESS', selesai: 'COMPLETED', diambil: 'PICKED UP' },
    zh: { antri: '已收件', proses: '维修中', selesai: '已完成', diambil: '已取件' }
  }[lang] || {};
  const statusTxt = statusMap[s.status] || s.status.toUpperCase();

  const T = {
    id: {
      telp: 'Telp', judul: 'UPDATE SERVIS', pelanggan: 'Pelanggan', barang: 'Barang',
      no: 'No', status: 'Status Saat Ini',
      lacak: 'Pantau status servis Anda secara real-time di sini:',
      lunas: 'Status Pembayaran: *LUNAS*', sisa: 'Sisa Tagihan',
      garansi: tgl => `Garansi servis s/d *${tgl} pukul 23:59*`,
      sk: 'SYARAT & KETENTUAN:'
    },
    en: {
      telp: 'Phone', judul: 'SERVICE UPDATE', pelanggan: 'Customer', barang: 'Item',
      no: 'No', status: 'Current Status',
      lacak: 'Track your service status in real-time here:',
      lunas: 'Payment Status: *PAID*', sisa: 'Balance Due',
      garansi: tgl => `Service warranty valid until *${tgl} at 23:59*`,
      sk: 'TERMS & CONDITIONS:'
    },
    zh: {
      telp: '电话', judul: '维修进度更新', pelanggan: '客户', barang: '手表型号',
      no: '单号', status: '当前状态',
      lacak: '点击此处实时查询您的维修进度：',
      lunas: '付款状态：*已结清*', sisa: '应付余额',
      garansi: tgl => `维修保修有效期至 *${tgl} 23:59*`,
      sk: '条款与条件：'
    }
  }[lang] || {};

  let text = `*${toko.nama.toUpperCase()}*\n${toko.alamat}\n${T.telp}: ${toko.telp}\n${garis}\n*${T.judul}*\n${garis}\n${T.pelanggan}: ${s.customer}\n${T.barang}: ${s.produk}\n*${T.no}:* ${s.id}\n${T.status}: *${statusTxt}*\n${garis}\n`;
  text += `🔍 *${T.lacak}*\n${linkLacak('id', s.id)}\n${garis}\n`;
  if (s.paid) text += `${T.lunas}\n`;
  else if (s.sisa > 0) text += `${T.sisa}: *${rp(s.sisa)}*\n`;
  if (s.status === 'selesai' && s.tgl_garansi_servis_sampai) {
    const tglExp = new Date(s.tgl_garansi_servis_sampai).toLocaleDateString(locale);
    text += `${garis}\n${T.garansi(tglExp)}\n`;
  }
  if (toko.syarat_singkat) text += `${garis}\n*${T.sk}*\n${toko.syarat_singkat}\n`;
  text += `${garis}\n${toko.footer}`;
  openWA(s.telp, text);
}

function _getWaLang() {
  if (typeof currentLang !== 'undefined' && currentLang) return currentLang;
  return localStorage.getItem('ta_lang') || localStorage.getItem('horopos_lang') || 'id';
}

function waServisMasuk(id) {
  const s = db.servis.find(x => x.id === id);
  if (!s || !s.telp) return alert('Nomor HP tidak ada');
  const toko = getToko(), garis = '=========================';
  const lang = _getWaLang();

  const T = {
    id: {
      judul: 'TANDA TERIMA SERVIS',
      halo: `Halo *${s.customer}*, jam Anda telah kami terima.`,
      no: 'No Servis', barang: 'Barang', keluhan: 'Keluhan',
      kondisiHdr: '⚠️ KONDISI AWAL (Telah Dicek):',
      kondisiDef: 'Normal / Tidak ada catatan',
      simpan: 'Mohon simpan pesan ini. Jika ada kondisi yang tidak tercatat, segera hubungi kami.',
      lacak: 'Lacak status servis:',
      sk: 'SYARAT & KETENTUAN:'
    },
    en: {
      judul: 'SERVICE RECEIPT',
      halo: `Hello *${s.customer}*, we have received your watch.`,
      no: 'Service No', barang: 'Item', keluhan: 'Issue',
      kondisiHdr: '⚠️ INITIAL CONDITION (Checked):',
      kondisiDef: 'Normal / No notes',
      simpan: 'Please keep this message. If any condition is not recorded, please contact us immediately.',
      lacak: 'Track service status:',
      sk: 'TERMS & CONDITIONS:'
    },
    zh: {
      judul: '维修收件凭证',
      halo: `您好 *${s.customer}*，我们已收到您的手表。`,
      no: '维修单号', barang: '手表型号', keluhan: '故障描述',
      kondisiHdr: '⚠️ 初始外观状况（已检查）：',
      kondisiDef: '正常 / 无备注',
      simpan: '请妥善保存此消息。如有未记录的外观状况，请立即联系我们。',
      lacak: '查询维修进度：',
      sk: '条款与条件：'
    }
  }[lang] || {};

  const text = `*${toko.nama.toUpperCase()}*\n${toko.alamat}\n${garis}\n*${T.judul}*\n${garis}\n${T.halo}\n\n*${T.no}:* ${s.id}\n*${T.barang}:* ${s.produk}\n*${T.keluhan}:* ${s.keluhan || '-'}\n\n*${T.kondisiHdr}*\n_${s.kondisi_fisik || T.kondisiDef}._\n\n${T.simpan}\n\n🔍 *${T.lacak}*\n${linkLacak('id', s.id)}\n${garis}\n${toko.syarat_singkat ? `*${T.sk}*\n` + toko.syarat_singkat + '\n' + garis + '\n' : ''}${toko.footer}`;
  openWA(s.telp, text);
}

function waReminderBaterai(id) {
  const b = db.baterai.find(x => x.id === id); if (!b || !b.telp) return;
  const toko = getToko();
  const lang = _getWaLang();
  const locale = lang === 'zh' ? 'zh-CN' : (lang === 'en' ? 'en-US' : 'id-ID');
  const sisaHari = Math.ceil((new Date(b.tgl_expired + 'T23:59:59') - new Date()) / 86400000);
  const expStr = new Date(b.tgl_expired).toLocaleDateString(locale);

  let msg = '';
  if (lang === 'en') {
    msg = `*${toko.nama.toUpperCase()}*\nBattery Warranty ${b.produk} (${b.tipe})\nExpires: ${expStr}\nStatus: ${sisaHari < 0 ? 'EXPIRED' : sisaHari + ' days left'}`;
  } else if (lang === 'zh') {
    msg = `*${toko.nama.toUpperCase()}*\n电池保修 ${b.produk} (${b.tipe})\n到期日期：${expStr}\n状态：${sisaHari < 0 ? '已过期' : '剩余 ' + sisaHari + ' 天'}`;
  } else {
    msg = `*${toko.nama.toUpperCase()}*\nGaransi Baterai ${b.produk} (${b.tipe})\nBerakhir: ${expStr}\nStatus: ${sisaHari < 0 ? 'HABIS' : 'Sisa ' + sisaHari + ' hari'}`;
  }
  openWA(b.telp, msg);
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

  const lang = _getWaLang();
  const locale = lang === 'zh' ? 'zh-CN' : (lang === 'en' ? 'en-US' : 'id-ID');
  const tgl = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const jam = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const garis = '=========================', tipis = '-------------------------';

  const T = {
    id: {
      judul: 'LAPORAN HARIAN', dikirim: 'Dikirim', omzet: 'OMZET HARI INI',
      jual: 'Penjualan Jam ', trx: 'transaksi',
      servis: 'Servis selesai', srv: 'servis',
      bat: 'Baterai       ', ganti: 'ganti',
      total: 'TOTAL', mdr: 'Biaya Bank (MDR)', net: 'Net Diterima    ',
      status: 'STATUS TOKO', aktif: 'Servis Aktif', piutang: 'Piutang Servis', nota: 'nota',
      low: '⚠️ STOK MENIPIS', prod: 'Produk', part: 'Part', batLbl: 'Baterai',
      auto: '_Laporan otomatis dari Sistem Toko_'
    },
    en: {
      judul: 'DAILY REPORT', dikirim: 'Sent', omzet: "TODAY'S REVENUE",
      jual: 'Watch Sales   ', trx: 'transactions',
      servis: 'Completed Srv ', srv: 'services',
      bat: 'Battery       ', ganti: 'replaced',
      total: 'TOTAL', mdr: 'Bank Fee (MDR)  ', net: 'Net Received    ',
      status: 'STORE STATUS', aktif: 'Active Services', piutang: 'Unpaid Services', nota: 'tickets',
      low: '⚠️ LOW STOCK', prod: 'Products', part: 'Parts', batLbl: 'Battery',
      auto: '_Automated report from Store System_'
    },
    zh: {
      judul: '每日营业报表', dikirim: '发送时间', omzet: '今日营业额',
      jual: '手表销售', trx: '笔交易',
      servis: '完成维修', srv: '单维修',
      bat: '更换电池', ganti: '次更换',
      total: '总计', mdr: '银行手续费 (MDR)', net: '实收净额',
      status: '门店状态', aktif: '进行中维修', piutang: '未结维修款', nota: '张工单',
      low: '⚠️ 库存不足', prod: '手表产品', part: '配件', batLbl: '电池',
      auto: '_系统自动生成报表_'
    }
  }[lang] || {};

  let text = `*${toko.nama.toUpperCase()}*\n${garis}\n*${T.judul}*\n${tgl}\n${T.dikirim}: ${jam}\n${garis}\n*${T.omzet}*\n${tipis}\n`;
  text += `- ${T.jual}: ${rp(omzetJual)}\n  (${trxHari.length} ${T.trx})\n`;
  text += `- ${T.servis}: ${rp(omzetServis)}\n  (${servisHari.length} ${T.srv})\n`;
  text += `- ${T.bat}: ${rp(omzetBat)}\n  (${batHari.length} ${T.ganti})\n${tipis}\n*${T.total}: ${rp(totalOmzet)}*\n`;
  if (mdrHari > 0) text += `${T.mdr}: -${rp(mdrHari)}\n${T.net}: ${rp(totalOmzet - mdrHari)}\n`;
  text += `${garis}\n*${T.status}*\n${tipis}\n${T.aktif}: ${servisAktif}\n${T.piutang}: ${rp(piutangTotal)} (${piutang.length} ${T.nota})\n${garis}\n`;
  if (prodLow.length || spLow.length || batLow.length) {
    text += `*${T.low}*\n${tipis}\n`;
    if (prodLow.length) text += `${T.prod}: ${prodLow.map(p => p.nama + ' (' + p.stok + ')').join(', ')}\n`;
    if (spLow.length) text += `${T.part}: ${spLow.map(s => s.nama + ' (' + s.stok + ')').join(', ')}\n`;
    if (batLow.length) text += `${T.batLbl}: ${batLow.map(b => b.tipe + ' (' + b.stok + ')').join(', ')}\n`;
    text += `${garis}\n`;
  }
  text += `${toko.footer}\n${T.auto}`;
  openWA(toko.telp, text);
  kirimTelegram(text);
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
  ${s.tgl_diambil ? `<div style="font-size:10px;margin:4px 0;"><b>Diambil:</b> ${new Date(s.tgl_diambil).toLocaleString('id-ID')}<br><b>Penerima:</b> ${esc(s.diambil_oleh || s.customer)}</div>` : ''}
  ${(s.ttd_ambil && LOGO_VALID.test(s.ttd_ambil)) ? `<div class="c" style="margin:4px 0;"><div style="font-size:9px;">Tanda Tangan Penerima:</div><img src="${s.ttd_ambil}" style="max-width:44mm;max-height:18mm;border:1px solid #ccc;background:#fff;margin-top:2px;"></div>` : ''}
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
      const stokLama = existing.stok || 0;
      const hppLama = existing.harga_beli || 0;
      const hargaBeli = Math.max(0, num('spBeli'));
      const hargaJual = Math.max(0, num('spJual'));
      const stokBaru = await ubahStok('sparepart', existing.id, stokInput);
      if (hargaJual > 0 && hargaJual !== existing.harga_jual) {
        await dbOk(supabaseClient.from('sparepart').update({ harga_jual: hargaJual, updated_at: nowISO() }).eq('id', existing.id));
      }
      if (isPemilik() && hargaBeli > 0) {
        const totalStok = stokLama + stokInput;
        const hppBaru = (stokInput > 0 && totalStok > 0)
          ? Math.round(((stokLama * hppLama) + (stokInput * hargaBeli)) / totalStok)
          : hargaBeli;
        await simpanModal('sparepart', existing.id, hppBaru);
      }
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
  const batGratisBln = (db.bateraiGratis || []).filter(x => bulanIni(x.created_at));
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
  const bebanBateraiGratis = jumlah(batGratisBln, x => Number(x.total_hpp || 0));

  const omzet = penJual + penServis + penBat;
  const totalPendapatan = omzet + penLain;
  const totalHpp = hppJual + hppServis + hppBat;
  const totalBeban = bebanMdr + bebanKasKecil + bebanLain + bebanBulanan + bebanBateraiGratis;
  return {
    kasBln, penJual, penServis, penBat, penLain, omzet, totalPendapatan,
    hppJual, hppServis, hppBat, totalHpp, bebanMdr, bebanKasKecil, bebanLain, bebanBulanan, bebanBateraiGratis, totalBeban,
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
  terapkanIdentitasToko();
  const today = new Date().toDateString();

  // 1. User & menu
  const uName = sessionStorage.getItem('ta_user') || 'Guest';
  const uRoleRaw = (getRole() || 'guest').toLowerCase();
  const langAktif = localStorage.getItem('ta_lang') || 'id';
  const roleMap = {
    pemilik: { id: 'PEMILIK', en: 'OWNER', zh: '店主' },
    admin: { id: 'ADMIN', en: 'ADMIN', zh: '管理员' },
    kasir: { id: 'KASIR', en: 'CASHIER', zh: '收银员' }
  };
  const uRole = (roleMap[uRoleRaw] && roleMap[uRoleRaw][langAktif]) || uRoleRaw.toUpperCase();
  const lblLoginAs = langAktif === 'en' ? 'Logged in as:' : (langAktif === 'zh' ? '当前登录：' : 'Login sebagai:');
  const homeUser = $('homeUser');
  if (homeUser) homeUser.innerHTML = `${lblLoginAs} <b>${esc(uName)}</b> (${esc(uRole)})`;
  if ($('userInfo')) $('userInfo').textContent = `${uName} (${uRole})`;
  if ($('userAvatar')) $('userAvatar').textContent = (uName || 'US').slice(0, 2).toUpperCase();
  const menuAdmin = $('menuAdmin'); if (menuAdmin) menuAdmin.style.display = isAdmin() ? 'grid' : 'none';  if (typeof terapkanAksesMenu === 'function') terapkanAksesMenu();


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
      <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
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
    }).join('') : '<div class="empty" style="grid-column:1/-1;">Belum ada produk</div>');

  // 4. Sparepart
  const cariSp = txt('cariSp').toLowerCase();
  const listSp = db.sparePart.filter(sp => !cariSp || (sp.nama || '').toLowerCase().includes(cariSp) || (sp.kategori || '').toLowerCase().includes(cariSp));
  setHTML('listSparePart', listSp.length ? listSp.map(sp => {
    const low = (sp.stok || 0) <= (sp.min_stok ?? 2);
    const id = esc(sp.id);
    return `<div class="item-card ${low ? 'low-stock' : ''}">
      <div class="ic-head">
        <div>
          <div class="ic-title">${esc(sp.nama)}</div>
          <div style="font-size:13px;color:#475569;font-weight:600;">${esc(sp.kategori || '-')}</div>
        </div>
        <div class="ic-stock ${low ? 'low' : ''}">Stok: ${sp.stok}${low ? ' ⚠️' : ''}</div>
      </div>
      <div class="ic-grid" style="margin-bottom:10px;">
        <div class="ic-cell"><span class="ic-lbl">Harga Jual</span><span class="ic-val">${rp(sp.harga_jual)}</span></div>
        ${isPemilik() ? `<div class="ic-cell"><span class="ic-lbl">Harga Beli</span><span class="ic-val">${rp(sp.harga_beli)}</span></div>` : `<div class="ic-cell"><span class="ic-lbl">Min Stok</span><span class="ic-val">${sp.min_stok ?? 0}</span></div>`}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${isAdmin() ? `<button class="btn-sm blue" onclick="editSparePart('${id}')">✏️ Edit</button>` : ''}
        ${isPemilik() ? `<button class="btn-sm danger" onclick="hapusSparePart('${id}')">🗑️ Hapus</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="empty">Belum ada sparepart</div>');

  // 5. Stok baterai
  setHTML('listStokBaterai', db.stokBaterai.length ? db.stokBaterai.map(sb => {
    const low = (sb.stok || 0) <= (sb.min_stok ?? 5);
    const id = esc(sb.id);
    return `<div class="item-card ${low ? 'low-stock' : ''}">
      <div class="ic-head">
        <div class="ic-title">🔋 ${esc(sb.tipe)}</div>
        <div class="ic-stock ${low ? 'low' : ''}">Stok: ${sb.stok}${low ? ' ⚠️' : ''}</div>
      </div>
      <div class="ic-grid" style="margin-bottom:10px;">
        <div class="ic-cell"><span class="ic-lbl">Harga Jual</span><span class="ic-val">${rp(sb.harga_jual)}</span></div>
        ${isPemilik() ? `<div class="ic-cell"><span class="ic-lbl">Harga Beli</span><span class="ic-val">${rp(sb.harga_beli)}</span></div>` : `<div class="ic-cell"><span class="ic-lbl">Min Stok</span><span class="ic-val">${sb.min_stok ?? 0}</span></div>`}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${isAdmin() ? `<button class="btn-sm blue" onclick="editStokBaterai('${id}')">✏️ Edit</button>` : ''}
        ${isPemilik() ? `<button class="btn-sm danger" onclick="hapusStokBaterai('${id}')">🗑️ Hapus</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="empty">Kosong</div>');

  // 6. Servis
  const srv = db.servis.filter(s => !filterServisStatus || s.status === filterServisStatus);
  setHTML('listServis', srv.length ? srv.map(s => {
    const id = esc(s.id);
    const btnBayar = (!s.paid && s.sisa > 0) ? `<button class="btn-sm ok" onclick="bayarSisaServis('${id}')">Bayar Sisa</button>` : '';
    const btnStruk = s.paid ? `<button class="btn-sm blue" onclick="cetakStrukServis('${id}')">Struk</button>` : '';
    const btnKartu = s.tgl_garansi_servis_sampai ? `<button class="btn-sm blue" onclick="cetakKartuGaransiServis('${id}')">Kartu</button><button class="btn-sm ok" onclick="generateDigitalWarranty('${id}', 'servis')">📸 E-Warranty</button>` : '';
    const btnKlaim = bisaKlaimGaransi(s) ? `<button class="btn-sm warn" onclick="mulaiKlaimGaransi('${id}')">Klaim (${getRules().maxKlaim - (s.klaim_count || 0)}x)</button>` : '';
    const lblStatus = { antri: '✔ Diterima', proses: '⚙️ Dikerjakan', selesai: '✅ Selesai', diambil: '📦 Sudah Diambil' }[s.status] || s.status.toUpperCase();
    const _l = (typeof _getWaLang === 'function') ? _getWaLang() : 'id';
    const _t = {
      id: { keluhan: 'Keluhan', kondisi: 'Kondisi Awal', total: 'Total', lunas: 'LUNAS', sisa: 'Sisa', garansi: 'Garansi s/d', diambil: 'Diambil' },
      en: { keluhan: 'Issue', kondisi: 'Initial Condition', total: 'Total', lunas: 'PAID', sisa: 'Balance', garansi: 'Warranty until', diambil: 'Picked up' },
      zh: { keluhan: '故障', kondisi: '初始外观', total: '总计', lunas: '已结清', sisa: '余额', garansi: '保修至', diambil: '已取件' }
    }[_l] || {};

    return `<div class="servis-item ${esc(s.status)}"><h4><span><span class="ticket-id-pill">${id}</span> <b style="margin-left:6px;color:#0f1f3d;">${esc(s.customer)}</b></span> <span class="badge ${esc(s.status)}">${lblStatus}</span></h4>
      <p><b style="color:#0f1f3d;">${esc(s.produk)}</b>${s.keluhan ? ' · ' + _t.keluhan + ': ' + esc(s.keluhan) : ''}</p>
      ${s.kondisi_fisik && s.kondisi_fisik !== '-' ? `<p style="color:#dc2626; font-size:11px; margin-top:2px;"><b>⚠️ ${_t.kondisi}:</b> ${esc(s.kondisi_fisik)}</p>` : ''}
      <p>${_t.total}: ${rp(s.biaya_pelanggan)} ${s.paid ? `<span class="badge ok">${_t.lunas}</span>` : `<span class="badge warn">${_t.sisa} ${rp(s.sisa)}</span>`}</p>
      ${s.tgl_garansi_servis_sampai ? `<p style="font-size:11px;color:#64748b">${_t.garansi} ${new Date(s.tgl_garansi_servis_sampai).toLocaleDateString('id-ID')} 23:59</p>` : ''}
      ${s.tgl_diambil ? `<p style="font-size:11px;color:#15803d;font-weight:700;">✅ ${_t.diambil}: ${new Date(s.tgl_diambil).toLocaleString('id-ID')} (${esc(s.diambil_oleh || s.customer)})</p>` : ''}
      ${Array.isArray(s.foto_kondisi) && s.foto_kondisi.length ? `<div style="display:flex;gap:6px;margin:8px 0 6px;flex-wrap:wrap;">${s.foto_kondisi.map(u => `<img src="${esc(u)}" onclick="window.open('${esc(u)}','_blank')" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #cbd5e1;cursor:pointer;" alt="Foto kondisi">`).join('')}</div>` : ''}
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        ${s.status === 'diambil'
          ? (s.ttd_ambil || s.tgl_diambil ? `<button class="btn-sm ok" onclick="lihatBuktiAmbil('${id}')">✍️ Bukti Ambil</button>` : '')
          : (s.status === 'selesai'
              ? `<button class="btn-sm ok" onclick="ubahStatusServis('${id}')">✍️ Ambil &amp; TTD</button>`
              : `<button class="btn-sm blue" onclick="ubahStatusServis('${id}')">Status →</button>`)}
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
  setHTML('tblJualHariIni', trxHariIni.length ? trxHariIni.map(t => {
    const id = esc(t.id);
    return `<div class="item-card" style="margin-bottom:8px;">
      <div class="ic-head" style="margin-bottom:6px;">
        <div>
          <div style="font-size:13px;color:#475569;font-weight:700;">🕒 ${jam(t.waktu)} · ${(t.items || []).length} item · ${esc(labelMetode(t.metode || 'tunai'))}</div>
          ${t.cust_nama ? `<div style="font-size:13px;color:#0f1f3d;font-weight:600;">👤 ${esc(t.cust_nama)}</div>` : ''}
        </div>
        <div style="font-size:16px;font-weight:900;color:#0f1f3d;white-space:nowrap;">${rp(t.total)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-sm blue" onclick="cetakStruk('${id}')">🖨️ Cetak</button>
        <button class="btn-sm ok" onclick="shareStrukDigital('${id}')">📲 WA</button>
        ${isPemilik() ? `<button class="btn-sm danger" onclick="hapusJual('${id}')">🗑️ Hapus</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="empty">Belum ada transaksi hari ini</div>');

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
  setHTML('listKas', kasList.slice(0, 50).map(k => `<div style="font-size:13px;border-bottom:1px solid #e2e8f0;padding:8px 4px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
    <div style="min-width:0;flex:1;word-break:break-word;">
      <div style="font-size:11px;color:#64748b;">${new Date(k.waktu).toLocaleDateString('id-ID')} · ${esc(labelMetode(k.metode || 'tunai'))}</div>
      <div style="color:#0f172a;font-weight:600;">${esc(k.keterangan)}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
      <b style="color:${k.jenis === 'masuk' ? '#15803d' : '#b91c1c'};white-space:nowrap;">${k.jenis === 'masuk' ? '+' : '-'}${rp(k.nominal)}</b>
      ${isAdmin() ? `<button class="btn-sm danger" onclick="hapusKas('${esc(k.id)}')" style="padding:4px 9px;min-height:28px;font-size:12px;border-radius:6px;line-height:1;">✕</button>` : ''}
    </div></div>`).join('') || '<div class="empty">Tidak ada data</div>');

  setHTML('listBank', db.bank.length ? db.bank.map(b => {
    const id = esc(b.id);
    return `<div class="item-card">
      <div class="ic-head">
        <div>
          <div class="ic-title">🏦 ${esc(b.nama)}</div>
          <div style="font-size:13px;color:#475569;font-weight:600;">No. Rek: ${esc(b.no || '-')}</div>
        </div>
      </div>
      <div class="ic-grid" style="margin-bottom:10px;">
        <div class="ic-cell"><span class="ic-lbl">Saldo Awal</span><span class="ic-val">${rp(b.saldo_awal)}</span></div>
        <div class="ic-cell"><span class="ic-lbl">Saldo Saat Ini</span><span class="ic-val" style="color:#0284c7;">${rp(saldoBankSistem(b))}</span></div>
      </div>
      ${isAdmin() ? `<div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-sm warn" onclick="rekonsiliasiBank('${id}')">🔄 Rekon</button>
        <button class="btn-sm blue" onclick="editBank('${id}')">✏️ Edit</button>
        <button class="btn-sm danger" onclick="hapusBank('${id}')">🗑️ Hapus</button>
      </div>` : ''}
    </div>`;
  }).join('') : '<div class="empty">Belum ada rekening</div>');

  // 10. Supplier & hutang
  setHTML('listSupplier', db.supplier.length ? db.supplier.map(s => {
    const id = esc(s.id);
    return `<div class="item-card">
      <div class="ic-head" style="margin-bottom:6px;">
        <div>
          <div class="ic-title">🏪 ${esc(s.nama)}</div>
          <div style="font-size:13px;color:#475569;font-weight:600;">📞 ${esc(s.hp || '-')}</div>
          ${s.alamat ? `<div style="font-size:12px;color:#64748b;">📍 ${esc(s.alamat)}</div>` : ''}
          ${s.catatan ? `<div style="font-size:12px;color:#0f1f3d;margin-top:2px;">📝 ${esc(s.catatan)}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-sm blue" onclick="editSupplier('${id}')">✏️ Edit</button>
        ${isAdmin() ? `<button class="btn-sm danger" onclick="hapusSupplier('${id}')">🗑️ Hapus</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="empty">Belum ada supplier</div>');

  const hutang = db.pembelian.filter(p => p.status === 'hutang').sort((a, b) => String(a.jatuh_tempo || '9999').localeCompare(String(b.jatuh_tempo || '9999')));
  const totalHutang = hutang.reduce((s, p) => s + (p.total || 0), 0);
  const hariIniStr = tglLokal();
  setHTML('listHutang', hutang.length
    ? `<div style="margin-bottom:10px;font-weight:800;font-size:15px;">Total Hutang Usaha: <span style="color:#dc2626">${rp(totalHutang)}</span> (${hutang.length} faktur)</div>` +
      hutang.map(p => {
        const telat = p.jatuh_tempo && p.jatuh_tempo < hariIniStr;
        const tempo = p.jatuh_tempo ? `<div style="font-size:12px;font-weight:700;color:${telat ? '#dc2626' : '#64748b'};">${telat ? '⚠️ TERLAMBAT — ' : 'Jatuh tempo: '}${new Date(p.jatuh_tempo + 'T00:00:00').toLocaleDateString('id-ID')}</div>` : '';
        return `<div class="item-card ${telat ? 'low-stock' : ''}">
          <div class="ic-head" style="margin-bottom:6px;">
            <div>
              <div class="ic-title">${esc(p.supplier_nama)}</div>
              <div style="font-size:12px;color:#475569;">Faktur: ${esc(p.no_faktur || p.id)} · ${new Date(p.waktu).toLocaleDateString('id-ID')}</div>
              ${tempo}
            </div>
            <div style="font-size:16px;font-weight:900;color:#b91c1c;white-space:nowrap;">${rp(p.total)}</div>
          </div>
          ${isAdmin() ? `<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn-sm ok" onclick="lunasiHutang('${esc(p.id)}')">✅ Lunasi Hutang</button></div>` : ''}
        </div>`;
      }).join('')
    : '<div class="empty">Tidak ada hutang</div>');

  if (isAdmin()) renderBebanTetap();

  // 11. Pelanggan
  const cariP = txt('cariPelanggan').toLowerCase();
  const listP = (db.pelanggan || []).filter(p => !cariP || (p.nama || '').toLowerCase().includes(cariP) || (p.telp || '').includes(cariP));
  setHTML('listPelanggan', listP.length ? listP.map(p => {
    const cocok = (hp, nama) => cocokPelanggan(hp, nama, p.telp, p.nama);
    const total = db.jual.filter(t => cocok(t.cust_hp, t.cust_nama)).reduce((s, t) => s + t.total, 0)
      + db.servis.filter(t => cocok(t.telp, t.customer)).reduce((s, t) => s + (t.biaya_pelanggan || 0), 0)
      + db.baterai.filter(t => cocok(t.telp, t.customer)).reduce((s, t) => s + (t.biaya || 0), 0);
    const id = esc(p.id);
    return `<div class="item-card">
      <div class="ic-head" style="margin-bottom:8px;">
        <div>
          <div class="ic-title">👤 ${esc(p.nama)}</div>
          <div style="font-size:13px;color:#475569;font-weight:600;">📞 ${esc(p.telp || '-')}</div>
        </div>
        <span class="badge warn" style="white-space:nowrap;">⭐ ${p.poin || 0} ${({ id: 'Poin', en: 'Pts', zh: '积分' })[_getWaLang()] || 'Poin'}</span>
      </div>
      <div class="ic-grid" style="margin-bottom:10px;">
        <div class="ic-cell" style="grid-column:span 2;flex-direction:row;justify-content:space-between;align-items:center;">
          <span class="ic-lbl">Total Belanja</span>
          <span class="ic-val">${rp(total)}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-sm blue" onclick="showCustomerHistoryById('${id}')">📋 Riwayat</button>
        ${p.telp && p.telp !== '-' ? `<button class="btn-sm ok" onclick="waPelanggan('${id}')">📲 WA</button>` : ''}
        ${isAdmin() ? `<button class="btn-sm danger" onclick="hapusPelanggan('${id}')">🗑️ Hapus</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="empty">Belum ada data pelanggan</div>');

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
  if ($('listAbsensi')) renderKaryawan();
  renderQuickUI();
  if (typeof terapkanBahasa === 'function') terapkanBahasa();
}

function isiHargaRestock() {
  const tipe = $('rsTipe')?.value, id = $('rsItem')?.value;
  const inputHarga = $('rsHarga');
  if (!inputHarga) return;
  const m = getMasterBarang(tipe, id);
  if (m) inputHarga.value = m.harga_beli || 0;

  let info = $('rsInfoHarga');
  if (!info && inputHarga.parentElement) {
    info = document.createElement('div');
    info.id = 'rsInfoHarga';
    info.style.cssText = 'font-size:11px;margin-top:4px;color:#64748b;';
    inputHarga.parentElement.appendChild(info);
    inputHarga.addEventListener('input', () => {
      const cur = getMasterBarang($('rsTipe')?.value, $('rsItem')?.value);
      if (cur && $('rsInfoHarga')) {
        $('rsInfoHarga').innerHTML = `Jual: <b>${rp(cur.harga_jual || 0)}</b> • ${teksMargin(num('rsHarga'), cur.harga_jual || 0)}`;
      }
    });
  }
  if (info) {
    info.innerHTML = m ? `Jual: <b>${rp(m.harga_jual || 0)}</b> • ${teksMargin(m.harga_beli || 0, m.harga_jual || 0)}` : '';
  }
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
  sel.onchange = isiHargaRestock;
  isiHargaRestock();
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
  if (klaimTerpakai >= getRules().maxKlaim) return false;
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
    const btnKlaim = bisaKlaimGaransiProduk(j) ? `<button class="btn-sm warn" onclick="mulaiKlaimGaransiProduk('${id}')">Klaim Garansi Produk (${getRules().maxKlaim - klaimTerpakai}x)</button>` : (klaimTerpakai >= getRules().maxKlaim ? `<span class="badge danger">Kuota klaim habis</span>` : '');
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

  const htmlWajib = ['loginOverlay', 'loginUser', 'pinInput', 'homeUser', 'menuAdmin', 'selProduk', 'qty', 'cartList', 'cartTotal', 'metodeBayar', 'bayar', 'custNama', 'custHp', 'infoPoin', 'tukarPoin', 'tipeDiskon', 'nilaiDiskon', 'sNama', 'sProduk', 'sGaransi', 'sJasa', 'sParentId', 'selSparePart', 'cartServisList', 'cartServisTotal', 'selBateraiServis', 'cartBateraiServisList', 'cartBateraiServisTotal', 'sDpGroup', 'metodeDpGroup', 'listServis', 'cariGaransi', 'hasilCekGaransi', 'bNama', 'bProduk', 'bTipeSel', 'cartBateraiList', 'displayTotalBaterai', 'metodeBaterai', 'listStokBaterai', 'listBaterai', 'bCari', 'sbTipe', 'sbStok', 'pNama', 'pMerek', 'pHBeli', 'pHJual', 'pStok', 'listProduk', 'spNama', 'listSparePart', 'supNama', 'listSupplier', 'listHutang', 'kasTunai', 'kasNonTunai', 'kasTotal', 'listKas', 'listBank', 'kasNominal', 'kasKet', 'listPelanggan', 'cariPelanggan', 'lapOmzet', 'lapServis', 'lapBat', 'lapLabaKotor', 'lr_laba_bersih', 'lr_total_pendapatan', 'nr_total_aset', 'ak_arus_bersih', 'tkNama', 'tkTelp', 'setMdrCcBca', 'setMdrDcBca', 'listAuditLog', 'listAuditGlobal', 'listLaporanAuditRingkas', 'auditCatatanMassal', 'msg'];
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

function getMasterBarang(tipe, id) {
  if (!id) return null;
  if (tipe === 'produk') return db.produk.find(x => String(x.id) === String(id)) || null;
  if (tipe === 'sparepart') return db.sparePart.find(x => String(x.id) === String(id)) || null;
  return db.stokBaterai.find(x => String(x.id) === String(id)) || null;
}

function teksMargin(beli, jual) {
  if (!jual) return '<span style="color:#64748b;">Harga jual belum diisi</span>';
  const untung = jual - beli;
  const persen = Math.round((untung / jual) * 100);
  const warna = untung < 0 ? '#dc2626' : (persen < 20 ? '#d97706' : '#16a34a');
  return `<span style="color:${warna};font-weight:600;">Margin: ${rp(untung)} (${persen}%)</span>`;
}

function ubahBarisPembelian(i, kolom, nilai) {
  const b = barisPembelian[i]; if (!b) return;
  if (kolom === 'tipe') {
    b.tipe = nilai; b.item_id = ''; b.harga = 0; b.harga_jual = 0; b.harga_jual_awal = 0;
    renderBarisPembelian(); return;
  }
  if (kolom === 'item_id') {
    b.item_id = nilai;
    const m = getMasterBarang(b.tipe, nilai);
    b.harga = m ? (m.harga_beli || 0) : 0;
    b.harga_jual = m ? (m.harga_jual || 0) : 0;
    b.harga_jual_awal = b.harga_jual;
    renderBarisPembelian(); return;
  }
  b[kolom] = Math.max(0, +nilai || 0);
  const elM = $(`pbMargin_${i}`);
  if (elM && b.item_id) elM.innerHTML = teksMargin(b.harga || 0, b.harga_jual || 0);
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
        <input type="number" min="1" value="${b.qty}" oninput="ubahBarisPembelian(${i},'qty',this.value)" placeholder="Qty" style="${gaya}width:20%;">
        <input type="number" min="0" value="${b.harga || ''}" oninput="ubahBarisPembelian(${i},'harga',this.value)" placeholder="Modal / unit" style="${gaya}flex:1;">
        <input type="number" min="0" value="${b.harga_jual || ''}" oninput="ubahBarisPembelian(${i},'harga_jual',this.value)" placeholder="Harga jual" style="${gaya}flex:1;">
      </div>
      ${b.item_id ? `<div id="pbMargin_${i}" style="font-size:11px;margin-top:4px;">${teksMargin(b.harga || 0, b.harga_jual || 0)}</div>` : ''}
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
    for (const b of items) {
    if (b.harga_jual > 0 && b.harga_jual !== b.harga_jual_awal) {
    const tabel = b.tipe === 'produk' ? 'produk' : (b.tipe === 'sparepart' ? 'sparepart' : 'stok_baterai');
    await dbOk(supabaseClient.from(tabel).update({ harga_jual: b.harga_jual }).eq('id', b.item_id));
    }
    }

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
  $('listBebanTetap').innerHTML = daftar.length ? daftar.map(b => {
    const bayar = kasBayar(`${b.id}@${per}`);
    const tempo = tglJatuhTempoBulanIni(b);
    const selisih = Math.round((tempo - hariIni) / 86400000);
    let status;
    totalRencana += b.nominal;
    if (bayar) { totalSudah += bayar.nominal; status = `<span style="color:#15803d;font-weight:700">✅ Sudah dibayar (${rp(bayar.nominal)} · ${new Date(bayar.waktu).toLocaleDateString('id-ID')})</span>`; }
    else if (selisih < 0) status = `<span style="color:#b91c1c;font-weight:700">⚠️ TERLAMBAT ${Math.abs(selisih)} hari (tgl ${b.tgl_jatuh_tempo})</span>`;
    else if (selisih <= 3) status = `<span style="color:#b45309;font-weight:700">⏳ ${selisih === 0 ? 'Jatuh tempo HARI INI' : 'Jatuh tempo ' + selisih + ' hari lagi'} (tgl ${b.tgl_jatuh_tempo})</span>`;
    else status = `<span style="color:#64748b">Belum dibayar · Jatuh tempo tgl ${b.tgl_jatuh_tempo}</span>`;
    const id = esc(b.id);
    return `<div class="item-card ${!bayar && selisih < 0 ? 'low-stock' : ''}">
      <div class="ic-head" style="margin-bottom:6px;">
        <div>
          <div class="ic-title">${esc(b.nama)}</div>
          <div style="font-size:12px;margin-top:2px;">${status}</div>
        </div>
        <div style="font-size:16px;font-weight:900;color:#0f1f3d;white-space:nowrap;">${rp(b.nominal)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        ${bayar ? '' : `<button class="btn-sm ok" onclick="bayarBebanTetap('${id}')">💵 Bayar</button>`}
        ${isPemilik() ? `<button class="btn-sm blue" onclick="ubahBebanTetap('${id}')">✏️ Ubah</button><button class="btn-sm danger" onclick="hapusBebanTetap('${id}')">🗑️ Hapus</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="empty">Belum ada beban tetap. Pemilik bisa menambahkannya di bawah.</div>';
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
    const rowLogo = { id: 'toko', logo_base64: dataUrl };
    if (currentTenant.toko_id) rowLogo.toko_id = currentTenant.toko_id;
    await dbOk(supabaseClient.from('settings').upsert(rowLogo, { onConflict: 'toko_id,id' }));
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
    const CLOUDINARY_CLOUD_NAME = 'sz9gm896';
  const CLOUDINARY_UPLOAD_PRESET = 'horopos_produk';

  $('pFoto')?.addEventListener('change', async e => {
    if (!e.target.files.length) { tempFotoBase64 = ''; return; }
    try {
      flash('Mengunggah foto ke Cloudinary...');
      const fd = new FormData();
      fd.append('file', e.target.files[0]);
      fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Upload gagal');

      tempFotoBase64 = data.secure_url.replace('/upload/', '/upload/w_600,c_limit,q_auto,f_auto/');
      flash('Foto siap disimpan');
    } catch (err) {
      tempFotoBase64 = '';
      flash('Gagal upload foto: ' + err.message, 'err');
    }
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
  try {
    const tenant = await muatProfilDanToko(sesi.user.id);
    const username = tenant.profil.username || (sesi.user.email || '').split('@')[0];
    sessionStorage.setItem('ta_logged', '1');
    sessionStorage.setItem('ta_user', username);
    sessionStorage.setItem('ta_role', tenant.profil.role || tentukanRole(sesi.user, username));
    sessionStorage.setItem('ta_toko_id', tenant.toko_id);
  } catch (e) {
    await supabaseClient.auth.signOut();
    sessionStorage.clear();
    $('loginOverlay')?.classList.remove('hidden');
    if ($('loginErr')) $('loginErr').textContent = e.message || 'Sesi tidak valid';
    return;
  }
  localStorage.setItem('ta_uid', sesi.user.id);
  sessionStorage.setItem('ta_uid', sesi.user.id);
  if (!localStorage.getItem('ta_session_token')) {
    await daftarkanSesiTunggal(sesi.user.id);
  } else {
    const valid = await verifikasiSesiTunggal();
    if (!valid) return;
  }
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
        <span>Kasir</span>: <b>${esc(sessionStorage.getItem('ta_user') || '-')}</b> · <span>Tanggal</span>: <b>${new Date().toLocaleDateString('id-ID')}</b><br>
        <span>Transaksi Hari Ini</span>: <b>${d.jmlJual}</b> <span>Jual</span> · <b>${d.jmlSrv}</b> <span>Servis</span> · <b>${d.jmlBat}</b> <span>Baterai</span>
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
      <p style="font-size:12px;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;padding:8px 10px;border-radius:8px;margin-top:0;margin-bottom:10px;">
        📲 Laporan hasil penjualan &amp; tutup kasir hari ini otomatis dikirim ke Pemilik saat disimpan.
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button type="button" class="btn ok" onclick="simpanShiftClosing(true, true)">💾 Simpan, Cetak &amp; Kirim</button>
        <button type="button" class="btn blue" onclick="simpanShiftClosing(false, true)">📲 Simpan &amp; Kirim</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  if (typeof terapkanBahasa === 'function') terapkanBahasa();
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
    const apiAktif = localStorage.getItem('ta_wa_api_aktif') === '1';
    if (kirimWA || apiAktif) {
      const toko = getToko();
      if (!toko.telp) {
        if (kirimWA) flash('Isi No WA Toko di Setting dulu untuk kirim laporan WA', 'err');
      } else {
        const todayStr = new Date().toDateString();
        const hariIni = w => w && new Date(w).toDateString() === todayStr;
        const trxHari = (db.jual || []).filter(t => hariIni(t.waktu));
        const omzetJual = trxHari.reduce((s, t) => s + (t.total || 0), 0);
        const srvHari = (db.servis || []).filter(s => hariIni(s.tgl_selesai));
        const omzetSrv = srvHari.reduce((s, t) => s + (t.biaya_pelanggan || 0), 0);
        const batHari = (db.baterai || []).filter(b => hariIni(b.waktu));
        const omzetBat = batHari.reduce((s, b) => s + (b.biaya || 0), 0);
        const totalOmzet = omzetJual + omzetSrv + omzetBat;
        const teks = `*LAPORAN TUTUP TOKO & PENJUALAN HARIAN*
${toko.nama}
Tgl: ${new Date().toLocaleString('id-ID')}
Kasir: *${user}*
=========================
*OMZET HARI INI*
- Penjualan Jam : ${rp(omzetJual)} (${trxHari.length} trx)
- Servis Selesai: ${rp(omzetSrv)} (${srvHari.length} srv)
- Ganti Baterai : ${rp(omzetBat)} (${batHari.length} bat)
*TOTAL OMZET    : ${rp(totalOmzet)}*
=========================
*REKAP LACI KASIR*
Tunai Masuk : ${rp(d.tunaiMasuk)}
Tunai Keluar: -${rp(d.tunaiKeluar)}
*Tunai Sistem: ${rp(d.tunaiSistem)}*
*Tunai Fisik : ${rp(fisik)}*
*Status      : ${statusTeks}*
-------------------------
Non-Tunai   : ${rp(d.nonTunaiMasuk)}
Biaya MDR   : -${rp(d.mdrHari)}
${catatan ? 'Catatan     : ' + catatan + '\n' : ''}_Laporan otomatis saat tutup kasir_`;
        await openWA(toko.telp, teks);
        await kirimTelegram(teks);
      }
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
  const slugToko = (getToko().nama || 'POS').replace(/[^a-zA-Z0-9]+/g, '_');
  unduhFile(`Backup_Lengkap_${slugToko}_${tglLokal()}.json`, JSON.stringify(payload, null, 2), 'application/json');
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
  const _lang = localStorage.getItem('ta_lang') || localStorage.getItem('horopos_lang') || 'id';
  if (_lang !== 'id' && typeof teks === 'string') {
    const _btMap = _lang === 'zh' ? [
      [/Status: Gagal menghubungkan\s*\(/g, '状态：连接失败（'],
      [/Status: Printer terputus/g, '状态：打印机已断开'],
      [/Mencari printer Bluetooth\.\.\./g, '正在搜索蓝牙打印机...'],
      [/✅ Terhubung:\s*/g, '✅ 已连接：'],
      [/✅ Mode Bluetooth APK \(RawBT\) AKTIF/g, '✅ 蓝牙 APK (RawBT) 模式已开启']
    ] : [
      [/Status: Gagal menghubungkan\s*\(/g, 'Status: Connection failed ('],
      [/Status: Printer terputus/g, 'Status: Printer disconnected'],
      [/Mencari printer Bluetooth\.\.\./g, 'Searching for Bluetooth printer...'],
      [/✅ Terhubung:\s*/g, '✅ Connected: '],
      [/✅ Mode Bluetooth APK \(RawBT\) AKTIF/g, '✅ Bluetooth APK (RawBT) Mode ON']
    ];
    for (const [r, rep] of _btMap) teks = teks.replace(r, rep);
  }
  const el = $('btStatusText'); if (!el) return;
  el.textContent = teks;
  el.style.color = ok ? '#15803d' : '#b91c1c';
}

async function btConnect() {
  if (!navigator.bluetooth) {
    const aktifkan = confirm(
      'INFO PRINTER BLUETOOTH DI APK ANDROID:\n\n' +
      'Android WebView (APK) tidak mendukung Web Bluetooth langsung.\n' +
      'Sebagai gantinya, APK mendukung cetak Bluetooth langsung lewat aplikasi gratis "RawBT Print Service" (di Play Store).\n\n' +
      'Aktifkan Mode Cetak Bluetooth APK (RawBT) sekarang?'
    );
    if (aktifkan) {
      localStorage.setItem('ta_rawbt_aktif', '1');
      updateBtStatus('✅ Mode Bluetooth APK (RawBT) AKTIF', true);
      flash('Mode Bluetooth APK (RawBT) diaktifkan! Pastikan aplikasi RawBT sudah terpasang & terhubung ke printer.');
    }
    return;
  }
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
  const toko = getToko();
  const teks = `${toko.nama}\n${toko.alamat}\n================================\nTES CETAK PRINTER BLUETOOTH\nTgl: ${new Date().toLocaleString('id-ID')}\nStatus: BERHASIL TERHUBUNG!\n================================`;
  if (localStorage.getItem('ta_rawbt_aktif') === '1' && !btCharacteristic) {
    cetakViaRawBT(`<div>${teks.replace(/\n/g, '<br>')}</div>`);
    return;
  }
  if (!btCharacteristic) return flash('Hubungkan printer Bluetooth dulu', 'err');
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
  const on = !!$('chkPakaiBT')?.checked;
  localStorage.setItem('ta_bt_aktif', on ? '1' : '0');
  if (!on) localStorage.setItem('ta_rawbt_aktif', '0');
  flash(on ? 'Mode Cetak Bluetooth AKTIF' : 'Mode Preview Struk AKTIF');
}

// 3. WHATSAPP GATEWAY API (FONNTE / CUSTOM)
function muatPrefApiSetting() {
  if ($('chkPakaiBT')) $('chkPakaiBT').checked = localStorage.getItem('ta_bt_aktif') === '1' || localStorage.getItem('ta_rawbt_aktif') === '1';
  if (localStorage.getItem('ta_rawbt_aktif') === '1' && !btCharacteristic) updateBtStatus('✅ Mode Bluetooth APK (RawBT) AKTIF', true);
  if ($('waApiUrl')) $('waApiUrl').value = localStorage.getItem('ta_wa_api_url') || 'https://api.fonnte.com/send';
  if ($('waApiToken')) $('waApiToken').value = localStorage.getItem('ta_wa_api_token') || '';
  if ($('waApiAktif')) $('waApiAktif').checked = localStorage.getItem('ta_wa_api_aktif') === '1';
  if ($('tgBotToken')) $('tgBotToken').value = localStorage.getItem('ta_tg_token') || '';
  if ($('tgChatId')) $('tgChatId').value = localStorage.getItem('ta_tg_chat_id') || '';
  if ($('tgAktif')) $('tgAktif').checked = localStorage.getItem('ta_tg_aktif') === '1';
  terapkanBahasa();
}

async function simpanWaApiConfig() {
  const url = txt('waApiUrl'), token = txt('waApiToken'), aktif = !!$('waApiAktif')?.checked;
  localStorage.setItem('ta_wa_api_url', url);
  localStorage.setItem('ta_wa_api_token', token);
  localStorage.setItem('ta_wa_api_aktif', aktif ? '1' : '0');
  if (currentTenant.toko_id && isAdmin()) {
    try {
      await dbOk(supabaseClient.from('pengaturan_toko').upsert({
        toko_id: currentTenant.toko_id, wa_api_url: url, wa_api_token: token, wa_api_aktif: aktif, updated_at: nowISO()
      }, { onConflict: 'toko_id' }));
    } catch (e) { console.warn('Gagal sinkron WA API ke cloud:', e.message); }
  }
  flash('Pengaturan WhatsApp API disimpan & disinkronkan!');
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

    const _pLang = (typeof _getWaLang === 'function') ? _getWaLang() : 'id';
  const _uTxt = ({ id: 'unit', en: 'pcs', zh: '件' })[_pLang] || 'unit';
  const _hLagi = ({ id: 'hari lagi', en: 'days left', zh: '天后售罄' })[_pLang] || 'hari lagi';
  const _h90 = ({ id: '> 90 hari', en: '> 90 days', zh: '> 90 天' })[_pLang] || '> 90 hari';
  const _habis = ({ id: 'HABIS', en: 'OUT OF STOCK', zh: '已售罄' })[_pLang] || 'HABIS';
  const _cukup = ({ id: 'Cukup', en: 'Sufficient', zh: '充足' })[_pLang] || 'Cukup';

  el.innerHTML = hasil.map(x => {
    const kritis = x.estimasiHari <= 7;
    const waspada = !kritis && x.estimasiHari <= 14;
    const badgeSt = kritis ? '<span class="badge danger">🚨 KRITIS</span>' : (waspada ? '<span class="badge warn">⚠️ SEGERA RESTOCK</span>' : '<span class="badge ok">✅ AMAN</span>');
    const teksHari = x.estimasiHari >= 999 ? _h90 : (x.stok === 0 ? _habis : `~${x.estimasiHari} ${_hLagi}`);
    return `<div class="item-card ${kritis ? 'low-stock' : ''}">
      <div class="ic-head">
        <div>
          <span class="badge ${x.cls}" style="margin-right:4px;">${x.label}</span>${badgeSt}
          <div class="ic-title" style="margin-top:4px;">${esc(x.nama)}</div>
        </div>
        <div class="ic-stock ${kritis ? 'low' : ''}">Stok: ${x.stok}</div>
      </div>
      <div class="ic-grid">
        <div class="ic-cell"><span class="ic-lbl">Keluar (30 Hari)</span><span class="ic-val">${x.keluar30} ${_uTxt}</span></div>
        <div class="ic-cell"><span class="ic-lbl">Estimasi Habis</span><span class="ic-val ${kritis ? 'danger' : ''}">${teksHari}</span></div>
        <div class="ic-cell" style="grid-column:span 2;border-top:1px dashed #cbd5e1;padding-top:6px;flex-direction:row;justify-content:space-between;align-items:center;">
          <span class="ic-lbl">Rekomendasi Beli (Stok 30 Hari)</span>
          <span class="ic-val ok">${x.saranBeli > 0 ? '+' + x.saranBeli + ' ' + _uTxt : _cukup}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ==========================================================
//  FITUR V11: TANDA TANGAN DIGITAL PENGAMBILAN SERVIS & AUTO-WA
// ==========================================================
function bukaModalAmbilServis(id) {
  const s = db.servis.find(x => x.id === id);
  if (!s) return;
  if (!s.paid && s.sisa > 0) return flash('Lunasi sisa tagihan dulu sebelum jam diambil.', 'err');

  let ov = $('modalAmbilServis'); if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'modalAmbilServis';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.82);z-index:9800;overflow-y:auto;padding:16px;';
  ov.innerHTML = `
    <div style="background:#fff;color:#0f172a;border:2px solid #0f1f3d;border-radius:14px;max-width:460px;width:100%;margin:3vh auto;padding:18px;box-shadow:0 12px 30px rgba(0,0,0,.45);">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-bottom:12px;">
        <h3 style="margin:0;border:none;padding:0;color:#0f1f3d;">✍️ Serah Terima &amp; TTD Pengambilan</h3>
        <button type="button" class="btn-sm ghost" onclick="$('modalAmbilServis').remove()">✕</button>
      </div>
      <div style="font-size:13px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:10px;margin-bottom:12px;line-height:1.5;">
        <b>No Servis:</b> ${esc(s.id)}<br>
        <b>Pelanggan:</b> ${esc(s.customer)} ${s.telp ? '(' + esc(s.telp) + ')' : ''}<br>
        <b>Barang:</b> ${esc(s.produk)}<br>
        <b>Total:</b> ${rp(s.biaya_pelanggan)} <span class="badge ok">LUNAS</span>
      </div>
      <label>Nama Penerima Barang *</label>
      <input id="ttdPenerima" value="${esc(s.customer || '')}" placeholder="Nama yang mengambil barang" style="margin-bottom:10px;">
      <label>Tanda Tangan Penerima (Goreskan di kotak bawah) *</label>
      <div style="border:2px dashed #64748b;border-radius:10px;background:#ffffff;overflow:hidden;margin-bottom:8px;">
        <canvas id="ttdCanvas" width="400" height="170" style="width:100%;height:170px;display:block;touch-action:none;cursor:crosshair;"></canvas>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:11px;color:#64748b;">Setelah disubmit, struk langsung dicetak &amp; WA konfirmasi dikirim.</span>
        <button type="button" class="btn-sm ghost" id="btnHapusTtd" style="flex-shrink:0;">🧹 Ulangi</button>
      </div>
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn ghost" onclick="$('modalAmbilServis').remove()" style="flex:0.8;">Batal</button>
        <button type="button" class="btn ok" id="btnSubmitTtd" style="flex:1.5;">✅ Konfirmasi, Cetak &amp; WA</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const canvas = $('ttdCanvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let drawing = false;
  let hasSigned = false;

  const getPos = e => {
    const rect = canvas.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    return {
      x: (pt.clientX - rect.left) * (canvas.width / rect.width),
      y: (pt.clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const startDraw = e => {
    e.preventDefault();
    drawing = true;
    hasSigned = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };
  const moveDraw = e => {
    if (!drawing) return;
    e.preventDefault();
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };
  const endDraw = e => {
    if (!drawing) return;
    e.preventDefault();
    drawing = false;
    ctx.closePath();
  };

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', moveDraw);
  window.addEventListener('mouseup', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', moveDraw, { passive: false });
  canvas.addEventListener('touchend', endDraw, { passive: false });

  $('btnHapusTtd').onclick = () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    hasSigned = false;
  };

  $('btnSubmitTtd').onclick = async () => {
    const penerima = ($('ttdPenerima')?.value || '').trim();
    if (!penerima) return flash('Nama penerima wajib diisi', 'err');
    if (!hasSigned) return flash('Pelanggan wajib tanda tangan di kotak terlebih dahulu', 'err');

    const btn = $('btnSubmitTtd');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    const ttdDataUrl = canvas.toDataURL('image/png');
    const waktuAmbil = nowISO();
    const kasir = sessionStorage.getItem('ta_user') || 'admin';

    try {
      const updateData = {
        status: 'diambil',
        tgl_diambil: waktuAmbil,
        ttd_ambil: ttdDataUrl,
        diambil_oleh: penerima,
        diserahkan_oleh: kasir
      };
      await dbOk(supabaseClient.from('servis').update(updateData).eq('id', id));
      await catatLog('AMBIL_SERVIS', `Servis ${s.id} diambil oleh ${penerima} (diserahkan ${kasir})`);

      // Perbarui cache lokal agar struk & WA langsung memuat TTD & waktu ambil terbaru
      Object.assign(s, updateData);
      $('modalAmbilServis')?.remove();
      flash('✅ Servis resmi diambil! Mencetak struk & mengirim WA...');

      try { cetakStrukServis(id); } catch (e) { console.error(e); }
      if (s.telp) {
        try { await waServisDiambil(id); } catch (e) { console.error(e); }
      }
      tarikSemuaData();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '✅ Konfirmasi, Cetak & WA';
      flash('Gagal menyimpan bukti pengambilan: ' + e.message, 'err');
    }
  };
}

async function waServisDiambil(id) {
  const s = db.servis.find(x => x.id === id);
  if (!s || !s.telp) return;
  const toko = getToko(), garis = '=========================';
  const waktu = s.tgl_diambil ? new Date(s.tgl_diambil).toLocaleString('id-ID') : new Date().toLocaleString('id-ID');
  let text = `*${toko.nama.toUpperCase()}*\n${toko.alamat}\nTelp: ${toko.telp}\n${garis}\n*BUKTI PENGAMBILAN SERVIS*\n${garis}\n`;
  text += `No Servis : *${s.id}*\n`;
  text += `Pelanggan : ${s.customer}\n`;
  text += `Barang    : ${s.produk}\n`;
  text += `Status    : *SUDAH DIAMBIL*\n`;
  text += `Diambil   : ${waktu}\n`;
  text += `Penerima  : ${s.diambil_oleh || s.customer}\n`;
  text += `Pembayaran: *LUNAS* (${rp(s.biaya_pelanggan)})\n`;
  if (s.tgl_garansi_servis_sampai) {
    text += `${garis}\nGaransi servis berlaku s/d *${new Date(s.tgl_garansi_servis_sampai).toLocaleDateString('id-ID')} pukul 23:59*\n`;
  }
  text += `${garis}\nTerima kasih telah mempercayakan jam Anda kepada kami.\n_Simpan pesan ini sebagai bukti resmi pengambilan & garansi._`;
  await openWA(s.telp, text);
  await kirimTelegram(text);
}

function lihatBuktiAmbil(id) {
  const s = db.servis.find(x => x.id === id);
  if (!s) return;
  let ov = $('modalBuktiAmbil'); if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'modalBuktiAmbil';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.82);z-index:9800;overflow-y:auto;padding:16px;';
  const ttdHtml = (s.ttd_ambil && LOGO_VALID.test(s.ttd_ambil))
    ? `<img src="${s.ttd_ambil}" style="width:100%;max-height:180px;object-fit:contain;border:1.5px solid #cbd5e1;border-radius:10px;background:#fff;">`
    : '<div class="empty">Tidak ada gambar tanda tangan.</div>';
  ov.innerHTML = `
    <div style="background:#fff;color:#0f172a;border:2px solid #15803d;border-radius:14px;max-width:440px;width:100%;margin:5vh auto;padding:18px;box-shadow:0 12px 30px rgba(0,0,0,.45);">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-bottom:12px;">
        <h3 style="margin:0;border:none;padding:0;color:#15803d;">✅ Bukti Pengambilan Servis</h3>
        <button type="button" class="btn-sm ghost" onclick="$('modalBuktiAmbil').remove()">✕</button>
      </div>
      <div style="font-size:13px;line-height:1.6;margin-bottom:12px;">
        <b>No Servis:</b> ${esc(s.id)}<br>
        <b>Pelanggan:</b> ${esc(s.customer)}<br>
        <b>Barang:</b> ${esc(s.produk)}<br>
        <b>Waktu Diambil:</b> ${s.tgl_diambil ? new Date(s.tgl_diambil).toLocaleString('id-ID') : '-'}<br>
        <b>Diterima Oleh:</b> ${esc(s.diambil_oleh || s.customer)}<br>
        <b>Diserahkan Oleh:</b> ${esc(s.diserahkan_oleh || '-')}
      </div>
      <label>Tanda Tangan Penerima:</label>
      ${ttdHtml}
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button type="button" class="btn blue" onclick="cetakStrukServis('${esc(s.id)}')">🖨️ Cetak Ulang Struk</button>
        ${s.telp ? `<button type="button" class="btn ok" onclick="waServisDiambil('${esc(s.id)}')">📲 Kirim Ulang WA</button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(ov);
}


// ==========================================================
//  FITUR V13: TAB SETTING RAPI, TELEGRAM BOT, & MULTI-BAHASA
// ==========================================================

function gantiTabSetting(tab) {
  ['identitas', 'garansi', 'notif', 'perangkat', 'sistem'].forEach(t => {
    const el = $('stab_' + t);
    if (el) el.style.display = (t === tab) ? 'block' : 'none';
  });
  document.querySelectorAll('#settingTabs .status-pill-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.stab === tab);
  });
}

async function simpanTgConfig() {
  const token = txt('tgBotToken'), chatId = txt('tgChatId'), aktif = !!$('tgAktif')?.checked;
  localStorage.setItem('ta_tg_token', token);
  localStorage.setItem('ta_tg_chat_id', chatId);
  localStorage.setItem('ta_tg_aktif', aktif ? '1' : '0');
  if (currentTenant.toko_id && isAdmin()) {
    try {
      await dbOk(supabaseClient.from('pengaturan_toko').upsert({
        toko_id: currentTenant.toko_id, tg_bot_token: token, tg_chat_id: chatId, tg_aktif: aktif, updated_at: nowISO()
      }, { onConflict: 'toko_id' }));
    } catch (e) { console.warn('Gagal sinkron Telegram ke cloud:', e.message); }
  }
  flash('Pengaturan Telegram Bot disimpan!');
}

async function kirimTelegram(text) {
  const aktif = localStorage.getItem('ta_tg_aktif') === '1';
  const token = (localStorage.getItem('ta_tg_token') || '').trim();
  const chatId = (localStorage.getItem('ta_tg_chat_id') || '').trim();
  if (!aktif || !token || !chatId || !text) return false;

  // Terjemahkan teks otomatis sesuai bahasa aktif (jika fungsi penerjemah tersedia)
  const cleanText = text.replace(/\*/g, '');
  const finalText = typeof terjemahkanTeks === 'function' ? terjemahkanTeks(cleanText) : cleanText;

  try {
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: finalText })
    });
    return res.ok;
  } catch (e) {
    console.warn('Telegram gagal:', e);
    return false;
  }
}

async function tesTgBot() {
  const token = txt('tgBotToken'), chatId = txt('tgChatId');
  if (!token || !chatId) return flash('Isi Bot Token dan Chat ID terlebih dahulu', 'err');
  const toko = getToko();
  try {
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `✈️ Tes koneksi Telegram Bot dari ${toko.nama} BERHASIL! (${new Date().toLocaleString('id-ID')})` })
    });
    if (res.ok) flash('✅ Pesan tes berhasil terkirim ke Telegram!');
    else flash('Gagal kirim Telegram. Cek Bot Token & Chat ID.', 'err');
  } catch (e) { flash('Error Telegram: ' + e.message, 'err'); }
}

// === MULTI-BAHASA MENYELURUH (INDONESIA / ENGLISH / MANDARIN) ===
const I18N_DICT = {
  // Header, Login & Navigasi
  'Masuk untuk melanjutkan': { en: 'Sign in to continue', zh: '请登录以继续' },
  'Masuk': { en: 'In', zh: '收入' },
  'Selamat Datang': { en: 'Welcome', zh: '欢迎使用' },
  'Huruf Besar': { en: 'Large Text', zh: '大字体' },
  'Logout': { en: 'Logout', zh: '退出登录' },
  'Menu Utama': { en: 'Main Menu', zh: '主菜单' },
  'Point of Sale · Watch Care Service': { en: 'Point of Sale · Watch Care Service', zh: '收银系统 · 手表维修服务' },

  // Menu Utama
  'Kasir': { en: 'POS / Cashier', zh: '收银台' },
  'Servis': { en: 'Watch Service', zh: '手表维修' },
  'Baterai': { en: 'Battery', zh: '更换电池' },
  'Produk & Stock': { en: 'Products & Stock', zh: '产品与库存' },
  'Spare Part': { en: 'Spare Parts', zh: '维修配件' },
  'Laporan': { en: 'Reports', zh: '营业报表' },
  'Pelanggan': { en: 'Customers', zh: '客户管理' },
  'Kas': { en: 'Cash & Bank', zh: '现金与银行' },
  'Supplier': { en: 'Suppliers', zh: '供应商' },
  'Laporan Keuangan': { en: 'Financial Report', zh: '财务报表' },
  'Semua Stok & Harga': { en: 'All Stock & Price', zh: '全部库存与价格' },
  'Laporan & Kartu Audit': { en: 'Audit Report & Card', zh: '盘点报告与卡片' },
  'Setting': { en: 'Settings', zh: '系统设置' },
  'Hitung Stok': { en: 'Stock Count', zh: '库存盘点' },

  // Judul Halaman & Kartu (H3)
  'Pilih Produk Jam': { en: 'Select Watch Products', zh: '选择手表产品' },
  'Keranjang / Checkout': { en: 'Cart / Checkout', zh: '购物车 / 结账' },
  'Kas Kecil (Maks. Rp500.000)': { en: 'Petty Cash (Max Rp500,000)', zh: '零用现金 (最高 Rp500,000)' },
  'Riwayat Kas Kecil Hari Ini': { en: "Today's Petty Cash History", zh: '今日零用现金记录' },
  'Transaksi Hari Ini': { en: "Today's Transactions", zh: '今日交易记录' },
  'Tambah Produk / Restock Stok': { en: 'Add Product / Restock', zh: '添加产品 / 补货' },
  'Audit Stok Global (Produk, Part, Baterai)': { en: 'Global Stock Audit (Watch, Part, Battery)', zh: '全局库存盘点 (手表/配件/电池)' },
  'Daftar Produk': { en: 'Product List', zh: '产品列表' },
  'Restock Terpadu (Produk / Spare Part / Baterai)': { en: 'Unified Restock (Watch / Part / Battery)', zh: '统一补货 (手表/配件/电池)' },
  'Form Tiket Servis Baru': { en: 'New Service Ticket Form', zh: '新建维修工单' },
  'Pakai Spare Part & Baterai (Opsional)': { en: 'Use Spare Parts & Battery (Optional)', zh: '使用配件与电池 (可选)' },
  'Ringkasan Nota Servis & DP': { en: 'Service Ticket Summary & Deposit', zh: '维修单汇总与定金' },
  'Daftar Tiket Servis': { en: 'Service Ticket List', zh: '维修工单列表' },
  'Cek Garansi Servis & Produk': { en: 'Check Service & Product Warranty', zh: '查询维修与产品保修' },
  'Tambah Spare Part': { en: 'Add Spare Part', zh: '添加维修配件' },
  'Daftar Stok Spare Part': { en: 'Spare Part Stock List', zh: '配件库存列表' },
  'Jual Baterai Eceran (Tanpa Pasang & Tanpa Garansi)': { en: 'Retail Battery Sale (No Install / No Warranty)', zh: '电池零售 (不含安装与保修)' },
  'Input Ganti Baterai (Pasang + Garansi)': { en: 'Battery Replacement (Install + Warranty)', zh: '更换电池 (含安装与保修)' },
  'Daftar Baterai & Pembayaran': { en: 'Battery Cart & Payment', zh: '电池清单与付款' },
  'Tambah Tipe Baterai': { en: 'Add Battery Type', zh: '添加电池型号' },
  'Daftar Stok Baterai': { en: 'Battery Stock List', zh: '电池库存列表' },
  'Cek Garansi Baterai': { en: 'Check Battery Warranty', zh: '查询电池保修' },
  'Tambah / Edit Supplier': { en: 'Add / Edit Supplier', zh: '添加 / 编辑供应商' },
  'Daftar Supplier': { en: 'Supplier List', zh: '供应商列表' },
  'Riwayat Hutang': { en: 'Accounts Payable History', zh: '应付账款记录' },
  'Rekening Bank & Kas Manual (Admin)': { en: 'Bank Accounts & Manual Cash (Admin)', zh: '银行账户与手动记账 (管理员)' },
  'Riwayat Kas': { en: 'Cash History', zh: '现金流水' },
  'Database Pelanggan': { en: 'Customer Database', zh: '客户资料库' },
  'Ringkasan Laporan Harian': { en: 'Daily Report Summary', zh: '每日营业汇总' },
  'Produk Terlaris': { en: 'Best Selling Products', zh: '热销产品' },
  'Spare Part Terlaris': { en: 'Most Used Spare Parts', zh: '常用维修配件' },
  'Stok Menipis': { en: 'Low Stock Alert', zh: '低库存预警' },
  'Prediksi Stok Habis (Forecasting 30 Hari)': { en: 'Stock-Out Forecast (30-Day)', zh: '库存耗尽预测 (30天)' },
  'Kirim Laporan ke WA': { en: 'Send Report to WhatsApp', zh: '发送报表至 WhatsApp' },
  'Backup & Ekspor Data ke Excel (CSV)': { en: 'Backup & Export Data to Excel (CSV)', zh: '数据备份与导出 Excel (CSV)' },
  'Pengaturan Toko & Sistem': { en: 'Store & System Settings', zh: '店铺与系统设置' },
  'Identitas Toko & Nota': { en: 'Store Identity & Receipt', zh: '店铺信息与小票' },
  'Aturan Garansi Servis & Baterai': { en: 'Service & Battery Warranty Rules', zh: '维修与电池保修规则' },
  'Aturan Diskon Kasir': { en: 'Cashier Discount Rules', zh: '收银折扣规则' },
  'Biaya Bank (MDR)': { en: 'Bank Fees (MDR)', zh: '银行手续费 (MDR)' },
  'WhatsApp Gateway API (Fonnte / Custom)': { en: 'WhatsApp Gateway API (Fonnte / Custom)', zh: 'WhatsApp 网关 API (Fonnte / 自定义)' },
  'Notifikasi Telegram Bot (Tambahan / Anti-Blokir)': { en: 'Telegram Bot Notification (Add-on / Anti-Ban)', zh: 'Telegram 机器人通知 (附加/防封号)' },
  'Bahasa Tampilan (Language / 语言)': { en: 'Display Language (Bahasa / 语言)', zh: '界面语言 (Language / Bahasa)' },
  'Printer Thermal Bluetooth (58mm ESC/POS)': { en: 'Bluetooth Thermal Printer (58mm ESC/POS)', zh: '蓝牙热敏打印机 (58mm ESC/POS)' },
  'Audit Sistem Otomatis': { en: 'Automatic System Audit', zh: '系统自动检测' },
  'Kelola User (Mode Cloud)': { en: 'User Management (Cloud Mode)', zh: '用户管理 (云端模式)' },
  'Audit Trail (Aktivitas Sistem)': { en: 'Audit Trail (System Activity)', zh: '操作日志 (系统记录)' },
  'Semua Stok, Harga Beli & Harga Jual (Pemilik)': { en: 'All Stock, Cost & Selling Price (Owner)', zh: '全部库存、成本价与售价 (店主)' },
  'Laporan Audit Ringkas & Kartu Audit (Pemilik)': { en: 'Audit Summary & Audit Card (Owner)', zh: '盘点汇总与盘点卡 (店主)' },
  'Riwayat Pelanggan': { en: 'Customer History', zh: '客户消费记录' },
  'Pengeluaran Bulanan (Sewa, Listrik, Gaji, dll.)': { en: 'Monthly Expenses (Rent, Utilities, Salary)', zh: '月度固定支出 (房租/水电/工资)' },
  
  // Master Harga Modal & Jual
  '💰 Master Harga Modal & Jual (Khusus Pemilik)': { en: '💰 Master Cost & Selling Price (Owner Only)', zh: '💰 成本价与售价主档 (仅限店主)' },
  'Master Harga Modal & Jual (Khusus Pemilik)': { en: 'Master Cost & Selling Price (Owner Only)', zh: '成本价与售价主档 (仅限店主)' },
  'Input barang baru atau ubah harga modal & jual di satu tempat. Otomatis terpanggil saat input Produk, Spare Part, Baterai, maupun Pembelian Supplier.': { en: 'Add new items or edit cost & selling prices in one place. Auto-fills when adding Products, Spare Parts, Batteries, or Supplier Purchases.', zh: '在一处新增商品或修改成本价与售价。录入商品、配件、电池或供应商采购时自动填入。' },
  '➕ Tambah Master Barang Baru (Stok Awal 0)': { en: '➕ Add New Master Item (Initial Stock 0)', zh: '➕ 新增主档商品 (初始库存为 0)' },
  'Produk (Jam)': { en: 'Products (Watches)', zh: '商品 (手表)' },
  'Nama Produk / Spare Part / Tipe Baterai *': { en: 'Product Name / Spare Part / Battery Type *', zh: '商品名称 / 配件 / 电池型号 *' },
  'Harga Modal (Rp)': { en: 'Cost Price (Rp)', zh: '成本价 (Rp)' },
  'Harga Jual (Rp)': { en: 'Selling Price (Rp)', zh: '售价 (Rp)' },
  '+ Simpan Master': { en: '+ Save Master', zh: '+ 保存主档' },
  '🔍 Cari nama barang / tipe...': { en: '🔍 Search item name / type...', zh: '🔍 搜索商品名称 / 型号...' },
  'Semua Kategori': { en: 'All Categories', zh: '全部分类' },
  'Harga Modal': { en: 'Cost Price', zh: '成本价' },
  'Barang': { en: 'Item', zh: '商品' },
  'Barang tidak ditemukan': { en: 'Item not found', zh: '未找到商品' },
  'Tambah Master Barang Baru (Stok Awal 0)': { en: 'Add New Master Item (Initial Stock 0)', zh: '新增主档商品 (初始库存为 0)' },
  'Margin': { en: 'Margin', zh: '利润率' },

  // Tab Setting & Laporan
  'Identitas': { en: 'Identity', zh: '店铺信息' },
  'Garansi & MDR': { en: 'Warranty & MDR', zh: '保修与费率' },
  'WA & Telegram': { en: 'WA & Telegram', zh: 'WA 与 Telegram' },
  'Perangkat & Bahasa': { en: 'Device & Language', zh: '设备与语言' },
  'Sistem & Audit': { en: 'System & Audit', zh: '系统与日志' },
  'Laba Rugi': { en: 'Profit & Loss', zh: '损益表' },
  'Neraca': { en: 'Balance Sheet', zh: '资产负债表' },
  'Arus Kas': { en: 'Cash Flow', zh: '现金流量表' },

  // Label Statistik & Kartu
  'Saldo Tunai': { en: 'Cash Balance', zh: '现金余额' },
  'Saldo Non-Tunai': { en: 'Non-Cash Balance', zh: '非现金余额' },
  'Masuk Hari Ini': { en: 'In Today', zh: '今日收入' },
  'Keluar Hari Ini': { en: 'Out Today', zh: '今日支出' },
  'Biaya Garansi Bln Ini': { en: 'Warranty Cost (Month)', zh: '本月保修成本' },
  'Saldo Total': { en: 'Total Balance', zh: '总余额' },
  'Saldo Kas Kecil': { en: 'Petty Cash Balance', zh: '零用金余额' },
  'Kas Masuk Hari Ini': { en: 'Cash In Today', zh: '今日实收' },
  'Omzet Bulan Ini': { en: 'Monthly Revenue', zh: '本月营业额' },
  'Laba Kotor Bulan Ini': { en: 'Monthly Gross Profit', zh: '本月毛利润' },
  'Omzet Servis': { en: 'Service Revenue', zh: '维修收入' },
  'Omzet Baterai': { en: 'Battery Revenue', zh: '电池收入' },
  'Piutang Servis': { en: 'Service Receivables', zh: '维修应收款' },
  'Total Nilai Modal (HPP)': { en: 'Total Cost Value (COGS)', zh: '总成本价值' },
  'Total Nilai Jual': { en: 'Total Retail Value', zh: '总零售价值' },
  'Potensi Laba': { en: 'Potential Profit', zh: '潜在利润' },
  'Stok Menipis / Habis': { en: 'Low / Out of Stock', zh: '低库存 / 缺货' },
  'Total Item Diaudit': { en: 'Total Audited Items', zh: '已盘点项目' },
  'Selisih Bersih (Rp)': { en: 'Net Variance (Rp)', zh: '净差异金额' },
  'Barang Kurang (-)': { en: 'Shortage (-)', zh: '盘亏 (-)' },
  'Barang Lebih (+)': { en: 'Surplus (+)', zh: '盘盈 (+)' },
  'Harga Jual': { en: 'Selling Price', zh: '售价' },
  'Harga Beli': { en: 'Cost Price', zh: '进价' },
  'Laba / Unit': { en: 'Profit / Unit', zh: '单件利润' },
  'Nilai Modal': { en: 'Cost Value', zh: '库存成本' },
  'Total Belanja': { en: 'Total Spent', zh: '累计消费' },
  'Barcode': { en: 'Barcode', zh: '条形码' },
  'Min Stok': { en: 'Min Stock', zh: '最低库存' },
  'Saldo Awal': { en: 'Opening Balance', zh: '期初余额' },
  'Saldo Saat Ini': { en: 'Current Balance', zh: '当前余额' },
  'Keluar (30 Hari)': { en: 'Out (30 Days)', zh: '30天消耗' },
  'Estimasi Habis': { en: 'Est. Days Left', zh: '预计售罄' },
  'Rekomendasi Beli (Stok 30 Hari)': { en: 'Suggested Restock (30 Days)', zh: '建议补货量 (30天)' },

  // Label Form & Input
  'Nama Produk *': { en: 'Product Name *', zh: '产品名称 *' },
  'Merek': { en: 'Brand', zh: '品牌' },
  'Harga Beli / Modal (Rp)': { en: 'Cost Price (Rp)', zh: '进货价 (Rp)' },
  'Harga Jual (Rp) *': { en: 'Selling Price (Rp) *', zh: '销售价 (Rp) *' },
  'Jumlah Masuk / Stok': { en: 'Stock Qty', zh: '库存数量' },
  'Barcode / Serial': { en: 'Barcode / Serial', zh: '条形码 / 序列号' },
  'Nama Pelanggan *': { en: 'Customer Name *', zh: '客户姓名 *' },
  'No HP / WA': { en: 'Phone / WhatsApp', zh: '手机号 / WA' },
  'Produk / Merek *': { en: 'Watch / Brand *', zh: '手表 / 品牌 *' },
  'Keluhan': { en: 'Issue / Complaint', zh: '故障描述' },
  'Catatan Teknisi': { en: 'Technician Notes', zh: '技师备注' },
  'Status Garansi': { en: 'Warranty Status', zh: '保修状态' },
  'Biaya Jasa (Rp)': { en: 'Service Fee (Rp)', zh: '维修工费 (Rp)' },
  'Total Biaya': { en: 'Total Cost', zh: '总费用' },
  'DP Diterima (Rp)': { en: 'Deposit Paid (Rp)', zh: '已付定金 (Rp)' },
  'Sisa Tagihan': { en: 'Balance Due', zh: '应付余额' },
  'Nama Pembeli': { en: 'Buyer Name', zh: '买家姓名' },
  'No HP': { en: 'Phone Number', zh: '手机号码' },
  'Uang Dibayar (Rp)': { en: 'Cash Received (Rp)', zh: '实收现金 (Rp)' },
  'Tipe Diskon': { en: 'Discount Type', zh: '折扣类型' },
  'Nilai Diskon': { en: 'Discount Value', zh: '折扣数值' },
  'Nama Toko': { en: 'Store Name', zh: '店铺名称' },
  'No WA Toko / Pemilik': { en: 'Store / Owner WA', zh: '店铺 / 店主 WA' },
  'Alamat': { en: 'Address', zh: '地址' },
  'Footer Struk': { en: 'Receipt Footer', zh: '小票页脚' },
  'Pilih Bulan': { en: 'Select Month', zh: '选择月份' },
  'Pilih Tahun': { en: 'Select Year', zh: '选择年份' },
  'Keterangan': { en: 'Description', zh: '说明' },
  'Keterangan *': { en: 'Description *', zh: '说明 *' },
  'Nominal (Rp)': { en: 'Amount (Rp)', zh: '金额 (Rp)' },
  'Nominal (Rp) *': { en: 'Amount (Rp) *', zh: '金额 (Rp) *' },
  'Tanggal': { en: 'Date', zh: '日期' },
  'Jenis': { en: 'Type', zh: '类型' },
  'Metode': { en: 'Method', zh: '方式' },

  // Tombol Aksi & Filter
  'Tutup Kasir (Shift Closing)': { en: 'Close Shift (Shift Closing)', zh: '交班结账 (日结)' },
  'BAYAR & CETAK STRUK': { en: 'PAY & PRINT RECEIPT', zh: '付款并打印小票' },
  'SIMPAN & CETAK NOTA SERVIS': { en: 'SAVE & PRINT SERVICE TICKET', zh: '保存并打印维修单' },
  'BAYAR & CETAK STRUK BATERAI': { en: 'PAY & PRINT BATTERY RECEIPT', zh: '付款并打印电池小票' },
  'Jual Baterai Eceran & Cetak Struk': { en: 'Sell Retail Battery & Print', zh: '零售电池并打印' },
  'Simpan': { en: 'Save', zh: '保存' },
  'Batal': { en: 'Cancel', zh: '取消' },
  'Edit': { en: 'Edit', zh: '编辑' },
  'Hapus': { en: 'Delete', zh: '删除' },
  'Cetak': { en: 'Print', zh: '打印' },
  'Riwayat': { en: 'History', zh: '记录' },
  'Tutup': { en: 'Close', zh: '关闭' },
  'Semua': { en: 'All', zh: '全部' },
  'Diterima': { en: 'Received', zh: '已收件' },
  'Dikerjakan': { en: 'In Progress', zh: '维修中' },
  'Selesai': { en: 'Completed', zh: '已完成' },
  'Sudah Diambil': { en: 'Picked Up', zh: '已取件' },
  'Ambil & TTD': { en: 'Pickup & Sign', zh: '取件并签名' },
  'Bukti Ambil': { en: 'Pickup Proof', zh: '取件凭证' },
  'Status →': { en: 'Next Status →', zh: '下一步状态 →' },
  'Nota': { en: 'Ticket', zh: '工单' },
  'Struk': { en: 'Receipt', zh: '小票' },
  'Kartu': { en: 'Card', zh: '保修卡' },
  'Bayar Sisa': { en: 'Pay Balance', zh: '支付余款' },
  'Bayar': { en: 'Pay', zh: '支付' },
  'Ubah': { en: 'Edit', zh: '修改' },
  'Rekon': { en: 'Reconcile', zh: '对账' },
  'Lunasi Hutang': { en: 'Pay Debt', zh: '结清欠款' },
  'Keluar': { en: 'Out', zh: '支出' },
  'Tunai': { en: 'Cash', zh: '现金' },
  'Transfer': { en: 'Transfer', zh: '转账' },
  'Uang Pas': { en: 'Exact Cash', zh: '正好现金' },
  'Simpan Kas Kecil': { en: 'Save Petty Cash', zh: '保存零用金' },
  'Simpan Kas': { en: 'Save Cash', zh: '保存现金记录' },
  'Simpan Supplier': { en: 'Save Supplier', zh: '保存供应商' },
  'Simpan Identitas': { en: 'Save Identity', zh: '保存店铺信息' },
  'Simpan Aturan Garansi & Baterai': { en: 'Save Warranty & Battery Rules', zh: '保存保修与电池规则' },
  'Simpan Aturan Diskon': { en: 'Save Discount Rules', zh: '保存折扣规则' },
  'Simpan Pengaturan MDR': { en: 'Save MDR Settings', zh: '保存费率设置' },
  'Simpan WA API': { en: 'Save WA API', zh: '保存 WA API' },
  'Simpan Telegram Bot': { en: 'Save Telegram Bot', zh: '保存 Telegram 机器人' },
  'Tes Kirim Telegram': { en: 'Test Telegram', zh: '测试发送 Telegram' },
  'Tes WA ke No Toko': { en: 'Test WA to Store', zh: '测试发送 WA' },
  'Hubungkan Printer Bluetooth': { en: 'Connect Bluetooth Printer', zh: '连接蓝牙打印机' },
  'Tes Cetak': { en: 'Test Print', zh: '测试打印' },
  'Jalankan Audit Sistem': { en: 'Run System Audit', zh: '运行系统检测' },
  'Kirim Laporan Hari Ini ke WA': { en: "Send Today's Report to WA", zh: '发送今日报表至 WA' },
  'Cetak Daftar': { en: 'Print List', zh: '打印列表' },
  'Cetak Kartu Audit': { en: 'Print Audit Card', zh: '打印盘点卡' },
  'Tambah Jam Ini ke Daftar Nota': { en: 'Add Watch to Ticket List', zh: '添加手表到工单' },
  'Tambah Baterai ke Daftar Nota': { en: 'Add Battery to List', zh: '添加电池到清单' },
  'Tambah ke Keranjang': { en: 'Add to Cart', zh: '加入购物车' },
  'Kosongkan List': { en: 'Clear List', zh: '清空列表' },
  'Scan': { en: 'Scan', zh: '扫码' },

  // Status & Empty States
  'LUNAS': { en: 'PAID', zh: '已付清' },
  'Belum ada item dipilih': { en: 'No items selected yet', zh: '尚未选择商品' },
  'Belum ada transaksi hari ini': { en: 'No transactions today', zh: '今日暂无交易' },
  'Belum ada catatan kas kecil hari ini.': { en: 'No petty cash records today.', zh: '今日暂无零用金记录' },
  'Belum ada produk': { en: 'No products yet', zh: '暂无产品' },
  'Belum ada sparepart': { en: 'No spare parts yet', zh: '暂无配件' },
  'Belum ada data': { en: 'No data yet', zh: '暂无数据' },
  'Belum ada data pelanggan': { en: 'No customer data yet', zh: '暂无客户数据' },
  'Belum ada supplier': { en: 'No suppliers yet', zh: '暂无供应商' },
  'Tidak ada hutang': { en: 'No unpaid debts', zh: '暂无欠款' },
  'Tidak ada servis': { en: 'No service tickets', zh: '暂无维修单' },
  'Tidak ada data': { en: 'No data', zh: '暂无数据' },
  'Belum ada rekening': { en: 'No bank accounts yet', zh: '暂无银行账户' },
  'Semua stok aman 👍': { en: 'All stock levels are safe 👍', zh: '所有库存充足 👍' },

  // Placeholders
  'Email / Username': { en: 'Email / Username', zh: '邮箱 / 用户名' },
  'Password': { en: 'Password', zh: '密码' },
  'Cari nama jam / merek...': { en: 'Search watch name / brand...', zh: '搜索手表名称 / 品牌...' },
  'Cari nama/merek/barcode...': { en: 'Search name / brand / barcode...', zh: '搜索名称 / 品牌 / 条码...' },
  'Cari nama atau no HP...': { en: 'Search name or phone...', zh: '搜索姓名或手机号...' },
  'Cari keterangan...': { en: 'Search description...', zh: '搜索说明...' },
  'Cari nama / no HP / no servis / produk...': { en: 'Search name / phone / ticket / watch...', zh: '搜索姓名 / 手机 / 单号 / 手表...' },
  'Cari nama barang...': { en: 'Search item name...', zh: '搜索商品名称...' },
  'Cari...': { en: 'Search...', zh: '搜索...' },

  // Tambahan v15: Laporan Keuangan, Label Form, Deskripsi, Tombol Cepat, & Opsi
  'Kasir & Penjualan Jam': { en: 'POS & Watch Sales', zh: '收银与手表销售' },
  'Watch Care Service · Tiket Servis': { en: 'Watch Care Service · Service Tickets', zh: '手表维修服务 · 维修工单' },
  'Ganti Baterai & Penjualan Eceran': { en: 'Battery Replacement & Retail Sales', zh: '更换电池与电池零售' },
  'PENDAPATAN': { en: 'REVENUE', zh: '营业收入' },
  'Penjualan Produk': { en: 'Product Sales', zh: '产品销售' },
  'Jasa Servis': { en: 'Service Fees', zh: '维修服务费' },
  'Ganti Baterai': { en: 'Battery Replacement', zh: '更换电池' },
  'Pendapatan Lain': { en: 'Other Income', zh: '其他收入' },
  'TOTAL PENDAPATAN': { en: 'TOTAL REVENUE', zh: '总收入' },
  'HARGA POKOK PENJUALAN (HPP)': { en: 'COST OF GOODS SOLD (COGS)', zh: '销售成本 (COGS)' },
  'HPP Produk': { en: 'Product COGS', zh: '产品成本' },
  'HPP Sparepart': { en: 'Spare Parts COGS', zh: '配件成本' },
  'HPP Baterai': { en: 'Battery COGS', zh: '电池成本' },
  'TOTAL HPP': { en: 'TOTAL COGS', zh: '总成本' },
  'LABA KOTOR': { en: 'GROSS PROFIT', zh: '毛利润' },
  'BEBAN OPERASIONAL': { en: 'OPERATING EXPENSES', zh: '营业费用' },
  'Biaya Kas Kecil': { en: 'Petty Cash Expenses', zh: '零用金支出' },
  'Biaya Lain (Rekonsiliasi)': { en: 'Other Expenses (Reconciliation)', zh: '其他费用 (对账调整)' },
  'Pengeluaran Bulanan (Sewa, Listrik, Gaji)': { en: 'Monthly Expenses (Rent, Utilities, Salary)', zh: '月度支出 (房租/水电/工资)' },
  'TOTAL BEBAN': { en: 'TOTAL EXPENSES', zh: '总费用' },
  'LABA BERSIH': { en: 'NET PROFIT', zh: '净利润' },
  'ASET': { en: 'ASSETS', zh: '资产' },
  'Kas Tunai': { en: 'Cash on Hand', zh: '库存现金' },
  'Saldo Bank': { en: 'Bank Balance', zh: '银行存款' },
  'Persediaan (Stok)': { en: 'Inventory (Stock)', zh: '存货 (库存)' },
  'TOTAL ASET': { en: 'TOTAL ASSETS', zh: '资产总计' },
  'KEWAJIBAN & EKUITAS': { en: 'LIABILITIES & EQUITY', zh: '负债与所有者权益' },
  'Hutang Supplier': { en: 'Supplier Payables', zh: '应付供应商账款' },
  'TOTAL KEWAJIBAN': { en: 'TOTAL LIABILITIES', zh: '负债总计' },
  'Ekuitas (Laba)': { en: 'Equity (Retained Earnings)', zh: '所有者权益 (利润)' },
  'TOTAL PASIVA': { en: 'TOTAL LIABILITIES & EQUITY', zh: '负债与权益总计' },
  'ARUS KAS MASUK': { en: 'CASH INFLOWS', zh: '现金流入' },
  'Penjualan & Servis': { en: 'Sales & Services', zh: '销售与维修收入' },
  'TOTAL MASUK': { en: 'TOTAL INFLOW', zh: '总流入' },
  'ARUS KAS KELUAR': { en: 'CASH OUTFLOWS', zh: '现金流出' },
  'Beban Kas Kecil': { en: 'Petty Cash Outflow', zh: '零用金支出' },
  'Restock Barang': { en: 'Inventory Restock', zh: '采购补货' },
  'TOTAL KELUAR': { en: 'TOTAL OUTFLOW', zh: '总流出' },
  'ARUS KAS BERSIH': { en: 'NET CASH FLOW', zh: '净现金流' },

  // Label & Opsi yang terlewat
  'Nama *': { en: 'Name *', zh: '名称 *' },
  'Kategori': { en: 'Category', zh: '分类' },
  'Stok': { en: 'Stock', zh: '库存' },
  'Metode Pembayaran (Tinggal Pencet)': { en: 'Payment Method (Tap to Select)', zh: '付款方式 (点击选择)' },
  'Metode Pembayaran DP (Tinggal Pencet)': { en: 'Deposit Payment Method (Tap)', zh: '定金付款方式 (点击选择)' },
  'Diskon Cepat': { en: 'Quick Discount', zh: '快捷折扣' },
  'Pilih Cepat Merek / Jenis Jam': { en: 'Quick Select Watch / Brand', zh: '快捷选择手表品牌' },
  'Pilih Cepat Keluhan (bisa klik lebih dari satu)': { en: 'Quick Select Issue (multi-select)', zh: '快捷选择故障 (可多选)' },
  'Pilih Cepat Biaya Jasa (otomatis set Luar Garansi)': { en: 'Quick Select Service Fee (auto Out of Warranty)', zh: '快捷选择工费 (自动设为保外)' },
  'Pilih Cepat Tipe Baterai': { en: 'Quick Select Battery Type', zh: '快捷选择电池型号' },
  'Pilih Cepat Tipe Baterai (Stok Tersedia)': { en: 'Quick Select Battery Type (In Stock)', zh: '快捷选择有货电池型号' },
  'Pilih Cepat Merek Jam': { en: 'Quick Select Watch Brand', zh: '快捷选择手表品牌' },
  'Tipe Baterai *': { en: 'Battery Type *', zh: '电池型号 *' },
  'Metode Bayar': { en: 'Payment Method', zh: '付款方式' },
  'Total Harga': { en: 'Total Price', zh: '总价' },
  'Tanggal Ganti': { en: 'Replacement Date', zh: '更换日期' },
  'Garansi (bulan)': { en: 'Warranty (months)', zh: '保修期 (月)' },
  'Stok Awal': { en: 'Initial Stock', zh: '初始库存' },
  'Tipe *': { en: 'Type *', zh: '型号 *' },
  'Stok baterai kosong': { en: 'Battery stock is empty', zh: '电池库存为空' },
  '-- pilih --': { en: '-- select --', zh: '-- 请选择 --' },
  '-- pilih rekening --': { en: '-- select bank account --', zh: '-- 请选择银行账户 --' },
  'Nominal (Rp)': { en: 'Fixed Amount (Rp)', zh: '固定金额 (Rp)' },
  'Persen (%)': { en: 'Percentage (%)', zh: '百分比 (%)' },
  'Status: Belum terhubung': { en: 'Status: Not connected', zh: '状态：未连接' },
  'Gunakan Printer Bluetooth sebagai mode cetak utama (jika terputus, otomatis kembali ke cetak browser)': {
    en: 'Use Bluetooth Printer as primary print mode (auto-fallback to browser print if disconnected)',
    zh: '将蓝牙打印机设为主要打印方式 (断开时自动切换回浏览器打印)'
  },
  'Aktifkan Kirim WA Otomatis via API': { en: 'Enable Auto WhatsApp via API', zh: '启用通过 API 自动发送 WA' },
  'Aktifkan Kirim Salinan Notifikasi ke Telegram': { en: 'Enable Copy Notifications to Telegram', zh: '启用发送通知副本至 Telegram' },

  // Tombol Cepat Keluhan & Badge
  'Jam Mati': { en: 'Watch Stopped', zh: '手表停走' },
  'Servis Total': { en: 'Full Overhaul', zh: '全面保养' },
  'Ganti Kaca': { en: 'Crystal Replace', zh: '更换表镜' },
  'Ganti Mesin': { en: 'Movement Replace', zh: '更换机芯' },
  'Kemasukan Air': { en: 'Water Damage', zh: '手表进水' },
  'Jarum Lepas': { en: 'Loose Hands', zh: '指针脱落' },
  'Potong Rantai': { en: 'Resize Strap', zh: '截表带' },
  'JAM': { en: 'WATCH', zh: '手表' },
  'PART': { en: 'PART', zh: '配件' },
  'BAT': { en: 'BATT', zh: '电池' },
  'KRITIS': { en: 'CRITICAL', zh: '库存告急' },
  'SEGERA RESTOCK': { en: 'RESTOCK SOON', zh: '尽快补货' },
  'AMAN': { en: 'SAFE', zh: '库存充足' },

  // Deskripsi Paragraf (<p>)
  'Klik untuk mengecek apakah semua fungsi dan elemen HTML berjalan normal.': {
    en: 'Click to check if all functions and HTML elements are working properly.',
    zh: '点击检测所有功能和页面元素是否正常运行。'
  },
  'Hubungkan printer thermal Bluetooth langsung dari Chrome Android / PC tanpa pop-up browser.': {
    en: 'Connect Bluetooth thermal printer directly from Chrome Android / PC without browser pop-ups.',
    zh: '通过 Android / PC 版 Chrome 直接连接蓝牙热敏打印机，无需浏览器弹窗。'
  },
  'Dihitung otomatis dari rata-rata penjualan & pemakaian 30 hari terakhir. Membantu menentukan kapan & berapa banyak harus restock.': {
    en: 'Calculated automatically from the last 30 days average sales & usage to help plan when and how much to restock.',
    zh: '根据过去30天的平均销量和用量自动计算，帮助决定补货时间与数量。'
  },
  'Ringkasan performa toko hari ini akan dikirim ke nomor WhatsApp Pemilik/Toko.': {
    en: "Today's store performance summary will be sent to the Owner/Store WhatsApp number.",
    zh: '今日店铺营业汇总将发送至店主/店铺的 WhatsApp 号码。'
  },
  'Unduh arsip data toko agar bisa dibuka di Microsoft Excel atau disimpan sebagai cadangan pribadi.': {
    en: 'Download store data archives to open in Microsoft Excel or keep as a personal backup.',
    zh: '下载店铺数据归档，可在 Excel 中打开或作为个人备份保存。'
  },
  'Ubah bahasa menu utama dan navigasi aplikasi secara instan.': {
    en: 'Switch the application interface and receipt language instantly.',
    zh: '即时切换应用程序界面与小票打印语言。'
  },
  'Pilih / ketik nama': { en: 'Select / type name', zh: '选择 / 输入姓名' },
  'Jam mati': { en: 'Watch stopped', zh: '手表停走' },
  'Kondisi awal, dsb': { en: 'Initial condition, etc.', zh: '初始外观状况等' },

  // Tambahan v16: Sisa label, opsi dropdown, kondisi fisik, kas kecil, restock & audit
  'Pilih Tipe': { en: 'Select Type', zh: '选择类型' },
  'Produk Jualan': { en: 'Watch Products', zh: '销售手表' },
  'Pilih Item': { en: 'Select Item', zh: '选择商品' },
  'Jumlah Masuk (Qty)': { en: 'Incoming Qty', zh: '入库数量' },
  'Harga Beli / Modal Baru (Rp)': { en: 'New Cost Price (Rp)', zh: '新进货价 (Rp)' },
  'Tambah Stok & Hitung Rata-rata': { en: 'Add Stock & Recalculate Avg Cost', zh: '增加库存并重算均价' },
  'Pilih Semua': { en: 'Select All', zh: '全选' },
  'Cetak Barcode Terpilih': { en: 'Print Selected Barcodes', zh: '打印所选条码' },
  'Foto Produk (Opsional)': { en: 'Product Photo (Optional)', zh: '产品照片 (可选)' },
  'Scan Teks AI': { en: 'AI Text Scan', zh: 'AI 文字识别' },
  'Ketik nama produk...': { en: 'Type product name...', zh: '输入产品名称...' },
  'Scan / ketik': { en: 'Scan / type', zh: '扫码 / 输入' },
  'Tipe': { en: 'Type', zh: '类型' },
  'Nama Barang': { en: 'Item Name', zh: '商品名称' },
  'Sistem': { en: 'System', zh: '系统库存' },
  'Fisik (Anda)': { en: 'Physical (You)', zh: '实盘 (您)' },
  'Catatan Audit (Wajib diisi)': { en: 'Audit Notes (Required)', zh: '盘点备注 (必填)' },
  'Contoh: Opname akhir bulan': { en: 'e.g. Month-end stock opname', zh: '例如：月末库存盘点' },
  'Simpan Semua Audit': { en: 'Save All Audits', zh: '保存全部盘点' },
  'Kondisi Fisik Saat Diterima (Klik jika ada)': { en: 'Physical Condition on Intake (Tap if any)', zh: '收件外观状况 (如有请点击)' },
  'Kaca Baret': { en: 'Scratched Glass', zh: '表镜划痕' },
  'Kaca Retak': { en: 'Cracked Glass', zh: '表镜裂纹' },
  'Case Lecet': { en: 'Scuffed Case', zh: '表壳磨损' },
  'Dial Noda': { en: 'Stained Dial', zh: '表盘污渍' },
  'Crown Patah': { en: 'Broken Crown', zh: '表冠断裂' },
  'Tanpa Strap': { en: 'No Strap', zh: '无表带' },
  'Mesin Mati': { en: 'Dead Movement', zh: '机芯停走' },
  'Catatan Kondisi Lainnya': { en: 'Other Condition Notes', zh: '其他外观备注' },
  'Contoh: Ada goresan di belakang': { en: 'e.g. Scratches on caseback', zh: '例如：后盖有划痕' },
  'Dalam Garansi (gratis)': { en: 'Under Warranty (Free)', zh: '保修期内 (免费)' },
  'Luar Garansi (bayar)': { en: 'Out of Warranty (Paid)', zh: '保修期外 (收费)' },
  'SALDO KAS KECIL': { en: 'PETTY CASH BALANCE', zh: '零用金余额' },
  'MASUK HARI INI': { en: 'IN TODAY', zh: '今日收入' },
  'KELUAR HARI INI': { en: 'OUT TODAY', zh: '今日支出' },
  'Catat uang masuk (potong rantai, dll) atau keluar (beli galon, dll).': {
    en: 'Record petty cash in (strap resize, etc.) or out (water, supplies, etc.).',
    zh: '记录零用金收入 (截表带等) 或支出 (买水等)。'
  },
  '+ Potong Rantai 15rb': { en: '+ Resize Strap 15k', zh: '+ 截表带 15k' },
  '+ Potong Rantai 20rb': { en: '+ Resize Strap 20k', zh: '+ 截表带 20k' },
  '+ Springbar 10rb': { en: '+ Springbar 10k', zh: '+ 表耳生耳 10k' },
  '- Beli Galon 20rb': { en: '- Water Gallon 20k', zh: '- 买桶装水 20k' },
  '- Makan/Minum 25rb': { en: '- Food/Drink 25k', zh: '- 餐饮支出 25k' },
  'Masuk (Pendapatan)': { en: 'Cash In (Income)', zh: '收入' },
  'Keluar (Pengeluaran)': { en: 'Cash Out (Expense)', zh: '支出' },
  'Contoh: Jasa potong rantai, beli air galon': { en: 'e.g. Strap resize, water refill', zh: '例如：截表带、买桶装水' },
  'Mesin / Movement': { en: 'Movement', zh: '机芯' },
  'Crystal / Kaca': { en: 'Crystal / Glass', zh: '表镜' },
  'Jarum / Hands': { en: 'Hands', zh: '指针' },
  'Strap / Band': { en: 'Strap / Band', zh: '表带' },
  'Lainnya': { en: 'Others', zh: '其他' },

  // Tambahan v17: Sisa teks di Kas, Beban Tetap, Audit, & Setting
  'Isi Saldo / Top-Up Kas Kecil': { en: 'Top-Up Petty Cash Balance', zh: '零用金充值' },
  'Khusus Admin/Pemilik — tanpa batas Rp 500.000 untuk modal awal atau isi ulang laci kas kecil.': {
    en: 'Admin/Owner only — no Rp 500,000 limit for opening balance or petty cash top-up.',
    zh: '仅限管理员/店主 — 无 Rp 500,000 限额，用于初始备用金或零用金充值。'
  },
  '+ Isi Saldo Kas Kecil': { en: '+ Top-Up Petty Cash', zh: '+ 充值零用金' },
  'Tambah Rekening Baru': { en: 'Add New Bank Account', zh: '添加新银行账户' },
  'Nama Bank *': { en: 'Bank Name *', zh: '银行名称 *' },
  'Contoh: BCA': { en: 'e.g. BCA / Mandiri', zh: '例如：BCA' },
  'No Rekening': { en: 'Account Number', zh: '银行账号' },
  'Opsional': { en: 'Optional', zh: '可选' },
  'Saldo Awal (Rp)': { en: 'Opening Balance (Rp)', zh: '期初余额 (Rp)' },
  '+ Tambah Rekening': { en: '+ Add Bank Account', zh: '+ 添加银行账户' },
  'Belum ada beban tetap. Pemilik bisa menambahkannya di bawah.': {
    en: 'No fixed monthly expenses yet. Owner can add them below.',
    zh: '暂无固定月度支出。店主可在下方添加。'
  },
  'Tambah Beban Tetap (khusus Pemilik)': { en: 'Add Fixed Expense (Owner Only)', zh: '添加固定支出 (仅店主)' },
  'Nama beban, contoh: Sewa Toko': { en: 'Expense name, e.g. Store Rent', zh: '支出名称，例如：店铺租金' },
  'Nominal per bulan (Rp)': { en: 'Monthly amount (Rp)', zh: '每月金额 (Rp)' },
  'Tanggal jatuh tempo tiap bulan (1-31)': { en: 'Monthly due date (1-31)', zh: '每月到期日 (1-31)' },
  '+ Tambah Beban': { en: '+ Add Expense', zh: '+ 添加支出' },
  'Belum ada data audit pada periode ini.': { en: 'No audit records for this period.', zh: '本周期暂无盘点记录。' },
  'Logo Toko di Nota': { en: 'Store Logo on Receipt', zh: '小票店铺标志 (Logo)' },
  'Belum ada logo': { en: 'No logo uploaded yet', zh: '尚未上传标志' },
  'Simpan Logo': { en: 'Save Logo', zh: '保存标志' },
  'Hapus Logo': { en: 'Delete Logo', zh: '删除标志' },
  'Disarankan logo sederhana hitam-putih. Ukuran otomatis diperkecil agar cocok untuk printer struk 58mm.': {
    en: 'Simple black-and-white logo recommended. Automatically resized for 58mm thermal printers.',
    zh: '建议使用简洁的黑白标志，系统会自动缩放以适配 58mm 热敏打印机。'
  },
  'Garansi Servis Default (bulan)': { en: 'Default Service Warranty (months)', zh: '默认维修保修期 (月)' },
  'Maks. Klaim Garansi Servis (kali)': { en: 'Max Service Warranty Claims (times)', zh: '最多维修保修次数' },
  'Garansi Baterai Gratis Penuh (bulan)': { en: 'Free Battery Warranty (months)', zh: '电池免费保修期 (月)' },
  'Batas Diskon Baterai 50% (bulan)': { en: '50% Battery Discount Limit (months)', zh: '电池半价优惠期限 (月)' },
  'Contoh bawaan: 0–6 bulan gratis (Rp 0), bulan ke 7–9 diskon 50%, lewat 9 bulan bayar penuh.': {
    en: 'Default: 0–6 months free (Rp 0), months 7–9 50% off, after 9 months full price.',
    zh: '默认规则：0–6个月免费，7–9个月半价，超过9个月按原价收费。'
  },
  'Maks. Diskon Tanpa Otorisasi (%)': { en: 'Max Discount Without Approval (%)', zh: '免审批最高折扣 (%)' },
  'Maks. Diskon Tanpa Otorisasi (Rp)': { en: 'Max Discount Without Approval (Rp)', zh: '免审批最高折扣 (Rp)' },
  'Jika aktif, tombol WA mengirim pesan otomatis di latar belakang. Jika nonaktif, otomatis membuka aplikasi WhatsApp (`wa.me`).': {
    en: 'When enabled, WA buttons send messages automatically in the background. When disabled, opens WhatsApp app (`wa.me`).',
    zh: '启用后，WA 按钮将在后台自动发送消息；关闭后，将自动打开 WhatsApp 应用。'
  },
  'Masukkan token Fonnte...': { en: 'Enter Fonnte API token...', zh: '输入 Fonnte API 令牌...' },
  'Berjalan berdampingan dengan WA (tidak menggantikan WA). Cocok untuk menerima salinan Laporan Tutup Kasir, Laporan Harian, & Bukti Ambil Servis ke HP/Grup Telegram Pemilik.': {
    en: 'Runs alongside WhatsApp (does not replace WA). Ideal for receiving copies of Shift Closing, Daily Reports, and Service Pickup Proofs on Owner Telegram.',
    zh: '与 WhatsApp 并行运行（不替代 WA）。适合店主在 Telegram 接收交班报表、日报与取件凭证副本。'
  },
  'Mencatat semua aktivitas penting yang dilakukan oleh Admin dan Kasir.': {
    en: 'Logs all important activities performed by Admin and Cashier.',
    zh: '记录管理员和收银员执行的所有重要操作。'
  },
  'Cari nama user / aksi...': { en: 'Search username / action...', zh: '搜索用户名 / 操作...' },

  // Tambahan v18: Finalisasi 100% sisa teks (Backup, Bulan, Periode, Kasir, MDR, Telegram, Supplier, Tabel)
  '+ Tambah Tipe': { en: '+ Add Type', zh: '+ 添加型号' },
  'Jam': { en: 'Watches', zh: '手表' },
  'Excel Pelanggan': { en: 'Excel Customers', zh: '导出客户 Excel' },
  'Excel Buku Kas': { en: 'Excel Cash Book', zh: '导出账本 Excel' },
  'Excel Penjualan': { en: 'Excel Sales', zh: '导出销售 Excel' },
  'Excel Semua Stok': { en: 'Excel All Stock', zh: '导出库存 Excel' },
  'Excel Baterai': { en: 'Excel Battery', zh: '导出电池 Excel' },
  'Excel Servis': { en: 'Excel Service', zh: '导出维修 Excel' },
  'Download Backup Penuh Semua Data (.json)': { en: 'Download Full Backup (.json)', zh: '下载全部数据完整备份 (.json)' },
  'Debit Lain': { en: 'Other Debit', zh: '其他借记卡' },
  'Proses & Cetak': { en: 'Process & Print', zh: '处理并打印' },
  'Bank Lain (%)': { en: 'Other Banks (%)', zh: '其他银行 (%)' },
  'Bot Token (dari @BotFather)': { en: 'Bot Token (from @BotFather)', zh: '机器人令牌 (来自 @BotFather)' },
  'Catatan': { en: 'Notes', zh: '备注' },
  'Chat ID Tujuan (Pemilik / Grup)': { en: 'Target Chat ID (Owner / Group)', zh: '目标 Chat ID (店主 / 群组)' },
  'Kartu Debit': { en: 'Debit Card', zh: '借记卡' },
  'Kartu Kredit': { en: 'Credit Card', zh: '信用卡' },
  'Nama Supplier *': { en: 'Supplier Name *', zh: '供应商名称 *' },
  'Periode Laporan': { en: 'Report Period', zh: '报表周期' },
  'Produk': { en: 'Product', zh: '产品' },
  'Produk / Jam *': { en: 'Product / Watch *', zh: '产品 / 手表 *' },
  'QRIS (di atas Rp100.000) (%)': { en: 'QRIS (above Rp100,000) (%)', zh: 'QRIS (超过 Rp100,000) (%)' },
  'Rekening Bank': { en: 'Bank Account', zh: '银行账户' },
  'Rekening Tujuan': { en: 'Target Bank Account', zh: '收款银行账户' },
  'Rekening Tujuan / Settlement': { en: 'Target / Settlement Account', zh: '收款 / 结算账户' },
  'Rekening Tujuan DP': { en: 'Deposit Bank Account', zh: '定金收款账户' },
  'S&K Lengkap (WA)': { en: 'Full T&C (WhatsApp)', zh: '完整条款 (WA)' },
  'S&K Singkat (Struk)': { en: 'Short T&C (Receipt)', zh: '简短条款 (小票)' },
  'Sisa Poin / Garansi (hari)': { en: 'Points / Warranty (days)', zh: '剩余积分 / 保修 (天)' },
  'Tipe Baterai': { en: 'Battery Type', zh: '电池型号' },
  'Transfer (Rp Flat)': { en: 'Transfer (Flat Rp)', zh: '转账固定手续费 (Rp)' },
  'Tukar Poin (1 Poin = Rp 100)': { en: 'Redeem Points (1 Pt = Rp 100)', zh: '积分抵扣 (1分 = Rp 100)' },
  'Bank Lain': { en: 'Other Banks', zh: '其他银行' },
  'Bank Lain (1%)': { en: 'Other Banks (1%)', zh: '其他银行 (1%)' },
  'Debit Lain (1%)': { en: 'Other Debit (1%)', zh: '其他借记卡 (1%)' },
  'Bulan Ini': { en: 'This Month', zh: '本月' },
  'Hari Ini': { en: 'Today', zh: '今天' },
  'Semua Waktu': { en: 'All Time', zh: '全部时间' },
  'Januari': { en: 'January', zh: '一月' },
  'Februari': { en: 'February', zh: '二月' },
  'Maret': { en: 'March', zh: '三月' },
  'April': { en: 'April', zh: '四月' },
  'Mei': { en: 'May', zh: '五月' },
  'Juni': { en: 'June', zh: '六月' },
  'Juli': { en: 'July', zh: '七月' },
  'Agustus': { en: 'August', zh: '八月' },
  'September': { en: 'September', zh: '九月' },
  'Oktober': { en: 'October', zh: '十月' },
  'November': { en: 'November', zh: '十一月' },
  'Desember': { en: 'December', zh: '十二月' },
  'Ketik stok fisik di kolom kanan. Kosongkan jika tidak dihitung.': {
    en: 'Enter physical stock on the right column. Leave blank if not counted.',
    zh: '在右侧栏输入实盘库存，未盘点的请留空。'
  },
  'Menampilkan Laba Rugi & Arus Kas sesuai periode terpilih (Neraca menampilkan posisi kumulatif saat ini).': {
    en: 'Displays Profit & Loss and Cash Flow for the selected period (Balance Sheet shows current cumulative position).',
    zh: '显示所选周期的损益表与现金流量表（资产负债表显示当前累计状态）。'
  },
  'Tambah Manual lewat Daftar Dropdown': { en: 'Add Manually via Dropdown', zh: '通过下拉列表手动添加' },
  'Nilai': { en: 'Value', zh: '金额' },
  'Omzet': { en: 'Revenue', zh: '营业额' },
  'Contoh: 123456789': { en: 'e.g. 123456789', zh: '例如：123456789' },
  'Contoh: Setor modal, beli galon': { en: 'e.g. Capital deposit, buy supplies', zh: '例如：存入资金、购买耗材' },
  'Mesin NH35 / IC 32kHz': { en: 'NH35 Movement / 32kHz IC', zh: 'NH35 机芯 / 32kHz 芯片' },
  'Supplier mesin ETA': { en: 'ETA movement supplier', zh: 'ETA 机芯供应商' },
  'Cari nama jam, merek, spare part, atau tipe baterai...': {
    en: 'Search watch name, brand, spare part, or battery type...',
    zh: '搜索手表名称、品牌、配件或电池型号...'
  },

  // Tambahan v19: Hasil cek 10 foto terakhir
  'Belum ada part': { en: 'No spare parts yet', zh: '暂无配件' },
  'Total Spare Part': { en: 'Total Spare Parts', zh: '配件总计' },
  'Belum ada baterai': { en: 'No battery yet', zh: '暂无电池' },
  'Total Baterai': { en: 'Total Battery', zh: '电池总计' },
  'Ketik untuk mencari garansi servis / produk': { en: 'Type to search service / product warranty', zh: '输入以查询维修 / 产品保修' },
  'Ketik untuk mencari garansi': { en: 'Type to search warranty', zh: '输入以查询保修' },
  'Kosong': { en: 'Empty', zh: '空' },
  'Catat Pembelian dari Supplier': { en: 'Record Supplier Purchase', zh: '记录供应商采购' },
  'Isi form di kiri lalu klik "+ Tambah Jam Ini ke Daftar Nota".': {
    en: 'Fill the form on the left, then click "+ Add Watch to Ticket List".',
    zh: '填写左侧表单，然后点击“+ 添加手表到工单”。'
  },
  'Pilih jam & tipe baterai di kiri lalu klik "+ Tambah Baterai ke Daftar Nota".': {
    en: 'Select watch & battery type on the left, then click "+ Add Battery to List".',
    zh: '在左侧选择手表与电池型号，然后点击“+ 添加电池到清单”。'
  },
  'Riwayat & Laporan Audit kini disatukan di menu Laporan & Kartu Audit.': {
    en: 'Audit History & Reports are now combined in the Audit Report & Card menu.',
    zh: '盘点记录与报告现已整合至“盘点报告与卡片”菜单。'
  },

  // Tambahan v20: Sisa kecil di mode Mandarin (Laporan, Neraca, & Setting Cloud Mode)
  'Belum ada pemakaian sparepart': { en: 'No spare part usage yet', zh: '暂无配件使用记录' },
  'Belum ada penjualan': { en: 'No sales yet', zh: '暂无销售记录' },
  'HABIS': { en: 'OUT OF STOCK', zh: '已售罄' },
  'Cukup': { en: 'Sufficient', zh: '库存充足' },

  // Tambahan v21: Sistem Karyawan (Absensi & Komisi)
  'Karyawan & Absensi': { en: 'Staff & Attendance', zh: '员工与考勤' },
  'Absensi Karyawan Hari Ini': { en: "Today's Staff Attendance", zh: '今日员工考勤' },
  'Absen Masuk (Clock In)': { en: 'Clock In', zh: '上班打卡' },
  'Absen Pulang (Clock Out)': { en: 'Clock Out', zh: '下班打卡' },
  'Ringkasan Komisi & Kehadiran Bulan Ini': { en: 'Monthly Commission & Attendance Summary', zh: '本月提成与出勤汇总' },
  'Hadir Bulan Ini': { en: 'Days Present (Month)', zh: '本月出勤天数' },
  'Total Komisi Bulan Ini': { en: 'Total Commission (Month)', zh: '本月提成总计' },
  'Aturan Komisi Otomatis (Khusus Pemilik)': { en: 'Auto Commission Rules (Owner Only)', zh: '自动提成规则 (仅店主)' },
  'Komisi Penjualan Jam (%)': { en: 'Watch Sales Commission (%)', zh: '手表销售提成 (%)' },
  'Komisi Servis Selesai (%)': { en: 'Completed Service Commission (%)', zh: '维修完成提成 (%)' },
  'Komisi Ganti Baterai (Rp / unit)': { en: 'Battery Replace Commission (Rp / unit)', zh: '更换电池提成 (Rp / 个)' },
  'Simpan Aturan Komisi': { en: 'Save Commission Rules', zh: '保存提成规则' },
  'Riwayat Absensi': { en: 'Attendance History', zh: '考勤记录' },
  'Riwayat Komisi Transaksi': { en: 'Transaction Commission History', zh: '交易提成记录' },
  'Catatan absensi (opsional, mis. Shift pagi)': { en: 'Attendance note (optional, e.g. Morning shift)', zh: '考勤备注 (可选，例如：早班)' },
  'Belum ada data absensi.': { en: 'No attendance records yet.', zh: '暂无考勤记录。' },
  'Belum ada data komisi.': { en: 'No commission records yet.', zh: '暂无提成记录。' },

  // Tambahan v22: Kelola Nama & Status Karyawan (Pemilik)
  'Kelola Nama & Status Karyawan (Khusus Pemilik)': { en: 'Manage Staff Names & Status (Owner Only)', zh: '管理员工姓名与状态 (仅店主)' },
  'Ubah nama tampilan karyawan di struk, header, dan absensi tanpa perlu membuka Supabase.': {
    en: 'Update staff display names on receipts, header, and attendance without opening Supabase.',
    zh: '无需打开 Supabase，直接修改员工在小票、顶部栏和考勤中的显示名称。'
  },
  'Ubah Nama': { en: 'Edit Name', zh: '修改姓名' },
  'Nonaktifkan': { en: 'Disable', zh: '停用' },
  'Aktifkan': { en: 'Enable', zh: '启用' },
  'AKTIF': { en: 'ACTIVE', zh: '启用' },
  'NONAKTIF': { en: 'INACTIVE', zh: '已停用' },
    // --- Tutup Kasir (Netral) ---
  'Laporan hasil penjualan & tutup kasir hari ini otomatis dikirim ke Pemilik saat disimpan.': {
    en: "Today's sales & closing report will be automatically sent to the Owner when saved.",
    zh: '保存后，今日销售及结账报告将自动发送给店主。'
  },
  'Simpan, Cetak & Kirim': { en: 'Save, Print & Send', zh: '保存、打印并发送' },
  'Simpan & Kirim': { en: 'Save & Send', zh: '保存并发送' },

  // --- Isi Kas Kecil (Netral) ---
  'Khusus Admin/Pemilik — tanpa batas nominal, untuk modal awal atau isi ulang kas kecil.': {
    en: 'Admin/Owner only — no amount limit, for initial float or petty cash top-up.',
    zh: '仅限管理员/店主 — 无限额，用于初始备用金或零用金充值。'
  },

  // --- Pengaturan Hak Akses Menu ---
  'PENGATURAN HAK AKSES MENU (KHUSUS PEMILIK)': {
    en: 'MENU ACCESS CONTROL (OWNER ONLY)',
    zh: '菜单访问权限设置（仅限店主）'
  },
  'Atur menu apa saja yang boleh dibuka oleh Kasir atau Admin. Akun Pemilik selalu punya akses penuh.': {
    en: 'Manage which menus Cashier or Admin can access. Owner account always has full access.',
    zh: '设置收银员或管理员可以访问的菜单。店主账号始终拥有完整权限。'
  },
  'Pilih Jabatan yang Diatur': { en: 'Select Role to Configure', zh: '选择要设置的角色' },
  'Simpan Hak Akses': { en: 'Save Access Rights', zh: '保存权限设置' },
  'Semua Stok & Harga': { en: 'All Stock & Prices', zh: '全部库存与价格' },
  'Laporan & Kartu Audit': { en: 'Reports & Audit Card', zh: '报表与审计卡' },
  'Setting (Printer/Bahasa)': { en: 'Settings (Printer/Language)', zh: '设置（打印机/语言）' },
    // --- Judul Hak Akses (Title Case) ---
  'Pengaturan Hak Akses Menu (Khusus Pemilik)': {
    en: 'Menu Access Control (Owner Only)',
    zh: '菜单访问权限设置（仅限店主）'
  },

  // --- Isi Popup Tutup Kasir ---
  'Tunai Masuk Hari Ini': { en: 'Cash In Today', zh: '今日现金收入' },
  'Tunai Keluar (Kas Kecil/dll)': { en: 'Cash Out (Petty Cash/etc)', zh: '今日现金支出（零用金等）' },
  'Seharusnya di Laci (Sistem)': { en: 'Expected in Drawer (System)', zh: '系统应有现金' },
  'Non-Tunai (QRIS/Transfer/EDC)': { en: 'Non-Cash (QRIS/Transfer/EDC)', zh: '非现金（QRIS/转账/刷卡）' },
  'Hitung Uang Tunai Fisik di Laci (Rp) *': { en: 'Count Physical Cash in Drawer (Rp) *', zh: '清点抽屉实际现金 (Rp) *' },
  'Catatan Tutup Kasir (Opsional)': { en: 'Closing Note (Optional)', zh: '结账备注（可选）' },
  'Masukkan jumlah uang fisik...': { en: 'Enter physical cash amount...', zh: '请输入实际现金金额...' },
  'Contoh: Setor ke pemilik, sisa modal laci 200rb': { en: 'e.g., Deposit to owner, keep 200k float', zh: '例如：上交店主，留存20万备用金' },
  'Tanggal': { en: 'Date', zh: '日期' },
  'Transaksi Hari Ini': { en: "Today's Transactions", zh: '今日交易' },
  'Jual': { en: 'Sales', zh: '销售' },
  'Potongan MDR Hari Ini': { en: "Today's MDR Fee", zh: '今日手续费 (MDR)' },
  'Preview Nota / Struk': { en: 'Receipt / Ticket Preview', zh: '小票 / 工单预览' },
  'Kembali': { en: 'Back', zh: '返回' },
  'WA Terima': { en: 'WA Receipt', zh: 'WA 收件通知' },
  'KARYAWAN': { en: 'STAFF', zh: '员工' },
  'HADIR': { en: 'PRESENT', zh: '出勤' },
  'KOMISI': { en: 'COMMISSION', zh: '提成' },
  'PEMILIK': { en: 'OWNER', zh: '店主' },
  'KASIR': { en: 'CASHIER', zh: '收银员' },
  'ADMIN': { en: 'ADMIN', zh: '管理员' },
  'TEKNISI': { en: 'TECHNICIAN', zh: '技师' },
  'Cash': { en: 'Cash', zh: '现金' },
  'Debit BCA': { en: 'BCA Debit', zh: 'BCA 借记卡' },
  'CC BCA': { en: 'BCA Credit Card', zh: 'BCA 信用卡' },
  'CV Jaya Arloji': { en: 'ABC Watch Supply', zh: '佳雅钟表配件行' },
  '0812...': { en: '+1 234...', zh: '138...' },
  'Jl. Pasar No.5, Jakarta': { en: '123 Market St, City', zh: '市场路5号' },
  // === TAMBAHAN KAMUS: FITUR BATERAI GRATIS / INTERNAL ===
  'Ganti baterai baru (Gratis)?': { en: 'Free new battery replacement?', zh: '更换新电池（免费）？' },
  '-- Pilih tipe baterai --': { en: '-- Select battery type --', zh: '-- 选择电池型号 --' },
  'Pilih tipe baterai': { en: 'Select battery type', zh: '选择电池型号' },
  'Bonus ganti baterai baru': { en: 'Free new battery replacement bonus', zh: '免费更换新电池' },
  'Catat Baterai Gratis': { en: 'Log Free Battery', zh: '记录免费电池' },
  'Kategori': { en: 'Category', zh: '类别' },
  'Tipe Baterai': { en: 'Battery Type', zh: '电池型号' },
  'Bonus Beli Jam': { en: 'Watch Purchase Bonus', zh: '购表赠品' },
  'Kenalan / Saudara': { en: 'Friends / Family', zh: '亲友赠送' },
  'Display / Rusak': { en: 'Display / Damaged', zh: '展示 / 损坏' },
  'Keterangan / Nama Penerima (Wajib)': { en: 'Notes / Recipient Name (Required)', zh: '备注 / 领取人姓名（必填）' },
  'Contoh: Jam Om Budi / Baterai bocor': { en: 'e.g., Uncle Budi watch / Leaking battery', zh: '例如：亲友手表 / 电池漏液' },
  'Beban Baterai Gratis / Internal': { en: 'Free / Internal Battery Expense', zh: '免费 / 内部电池费用' },
  'Tipe baterai wajib dipilih.': { en: 'Please select a battery type.', zh: '必须选择电池型号。' },
  'Keterangan / nama penerima wajib diisi.': { en: 'Notes or recipient name is required.', zh: '必须填写备注或领取人姓名。' },
  'Data baterai tidak ditemukan.': { en: 'Battery data not found.', zh: '未找到电池数据。' },
  'Stok baterai tidak mencukupi.': { en: 'Insufficient battery stock.', zh: '电池库存不足。' },
  'ALERT BATERAI GRATIS': { en: 'FREE BATTERY ALERT', zh: '免费电池提醒' },
  'Kategori:': { en: 'Category:', zh: '类别：' },
  'Baterai:': { en: 'Battery:', zh: '电池：' },
  'Keterangan:': { en: 'Notes:', zh: '备注：' },
  'Dicatat oleh:': { en: 'Logged by:', zh: '记录人：' },
  'Tidak': { en: 'No', zh: '否' },
  'Ya': { en: 'Yes', zh: '是' },
  'Stok': { en: 'Stock', zh: '库存' },
  'Scan Teks AI': { en: 'AI Text Scan', zh: 'AI 文字扫描' },
  'Pilih foto produk terlebih dahulu': { en: 'Please select a product photo first', zh: '请先选择产品照片' },
  'Membaca label dengan AI Vision...': { en: 'Reading label with AI Vision...', zh: '正在使用 AI 视觉读取标签...' },
  'AI berhasil membaca label produk!': { en: 'AI successfully read the product label!', zh: 'AI 成功读取产品标签！' },
  'Gagal scan AI': { en: 'AI scan failed', zh: 'AI 扫描失败' },

};

// Kamus khusus Struk / Nota Cetak (Browser & Bluetooth Thermal)
const STRUK_DICT = [
  ['NOTA SERVIS GABUNGAN', 'COMBINED SERVICE TICKET', '综合维修单'],
  ['NOTA SERVIS', 'SERVICE TICKET', '维修收据'],
  ['STRUK SERVIS', 'SERVICE RECEIPT', '维修结算单'],
  ['STRUK BATERAI ECERAN', 'RETAIL BATTERY RECEIPT', '电池零售小票'],
  ['STRUK BATERAI', 'BATTERY RECEIPT', '电池更换小票'],
  ['KARTU GARANSI SERVIS', 'SERVICE WARRANTY CARD', '维修保修卡'],
  ['KARTU GARANSI BATERAI', 'BATTERY WARRANTY CARD', '电池保修卡'],
  ['LAPORAN TUTUP KASIR', 'SHIFT CLOSING REPORT', '收银交班报表'],
  ['Tanda Tangan Penerima:', 'Recipient Signature:', '领取人签名:'],
  ['Tanda Tangan Kasir', 'Cashier Signature', '收银员签名'],
  ['Scan untuk lacak status & garansi:', 'Scan to track status & warranty:', '扫码查询状态与保修:'],
  ['Scan untuk lacak status servis:', 'Scan to track service status:', '扫码查询维修状态:'],
  ['Scan untuk lacak semua servis:', 'Scan to track all services:', '扫码查询全部维修:'],
  ['Pelanggan:', 'Customer:', '客户:'],
  ['Pembeli:', 'Buyer:', '买家:'],
  ['Kasir:', 'Cashier:', '收银员:'],
  ['Penerima:', 'Received by:', '领取人:'],
  ['Diambil:', 'Picked up:', '取件时间:'],
  ['Produk:', 'Product:', '产品:'],
  ['Keluhan:', 'Issue:', '故障:'],
  ['Kondisi Awal:', 'Initial Condition:', '收件外观:'],
  ['Spare Part:', 'Spare Parts:', '维修配件:'],
  ['Daftar Barang', 'Item List', '商品清单'],
  ['Tgl Ganti:', 'Replaced:', '更换日期:'],
  ['Garansi s/d:', 'Warranty until:', '保修至:'],
  ['Garansi baterai s/d', 'Battery warranty until', '电池保修至'],
  ['SISA TAGIHAN', 'BALANCE DUE', '应付余额'],
  ['TOTAL BIAYA', 'TOTAL COST', '总费用'],
  ['DP (sudah dibayar)', 'Deposit (paid)', '已付定金'],
  ['BELUM LUNAS', 'UNPAID', '未付清'],
  ['LUNAS', 'PAID', '已付清'],
  ['Subtotal', 'Subtotal', '小计'],
  ['Diskon', 'Discount', '折扣'],
  ['Kembali', 'Change', '找零'],
  ['Bayar', 'Paid', '实付'],
  ['Metode', 'Method', '方式'],
  ['Simpan nota ini', 'Please keep this ticket', '请妥善保管此单据'],
  ['Simpan kartu ini', 'Please keep this card', '请妥善保管此保修卡'],
  ['Terima kasih telah berbelanja', 'Thank you for your business', '感谢您的惠顾'],
  ['No HP:', 'Phone:', '电话:'],
  ['Tgl:', 'Date:', '日期:'],
  ['Biaya:', 'Cost:', '费用:'],
  ['DP', 'Deposit', '定金'],
  ['(tanpa spare part)', '(no spare parts)', '（无配件）'],
  ['>Jasa<', '>Service Fee<', '>维修费<'],
  ['>Spare part<', '>Spare Parts<', '>配件<'],
  ['>Baterai<', '>Battery<', '>电池<'],
  ['>SISA<', '>BALANCE<', '>余款<'],
  ['DAFTAR SEMUA STOK & HARGA', 'ALL STOCK & PRICE LIST', '全部库存与价格清单'],
  ['Dicetak:', 'Printed:', '打印时间:'],
  ['Total Nilai Modal:', 'Total Cost Value:', '总成本价值:'],
  ['Total Nilai Jual:', 'Total Retail Value:', '总零售价值:'],
  ['>Tipe<', '>Type<', '>类型<'],
  ['>Nama Barang<', '>Item Name<', '>商品名称<'],
  ['>Stok<', '>Stock<', '>库存<'],
  ['>Harga Beli<', '>Cost Price<', '>进价<'],
  ['>Harga Jual<', '>Selling Price<', '>售价<'],
  ['>JAM<', '>WATCH<', '>手表<'],
  ['>BATERAI<', '>BATTERY<', '>电池<'],
  

];

function trStruk(html) {
  const lang = localStorage.getItem('ta_lang') || 'id';
  if (lang === 'id' || !html) return html;
  const idx = lang === 'en' ? 1 : 2;
  let out = html;
  for (const row of STRUK_DICT) {
    if (out.includes(row[0])) out = out.split(row[0]).join(row[idx]);
  }
  return out;
}

function terjemahkanTeks(raw, lang) {
  if (!raw || lang === 'id') return raw;
  const trimmed = raw.trim();
  if (I18N_DICT[trimmed]?.[lang]) return I18N_DICT[trimmed][lang];
  // Pisahkan awalan emoji/simbol (mis. "💾 Simpan" -> prefix "💾 " + inti "Simpan")
  const m = trimmed.match(/^([^\w\u4e00-\u9fff]+)\s*(.+)$/);
  if (m) {
    const prefix = m[1], core = m[2].trim();
    if (I18N_DICT[core]?.[lang]) return prefix + ' ' + I18N_DICT[core][lang];
  }
  return raw;
}

async function setBahasa(lang) {
  if (!['id', 'en', 'zh'].includes(lang)) return;
  localStorage.setItem('ta_lang', lang);
  if (isPemilik() && currentTenant.toko_id) {
    try {
      await supabaseClient.from('settings').upsert(
        { toko_id: currentTenant.toko_id, id: 'toko', bahasa_default: lang },
        { onConflict: 'toko_id,id' }
      );
    } catch (e) {}
  }
  location.reload();
}

function terapkanBahasa() {
  const lang = localStorage.getItem('ta_lang') || 'id';
  ['id', 'en', 'zh'].forEach(l => {
    const b = $('btnLang_' + l);
    if (b) b.classList.toggle('active-tap', l === lang);
  });

  // 0. Khusus tombol Login agar "Masuk" -> "Sign In" (tidak bentrok dengan filter Kas "Masuk" -> "In")
  const btnLogin = document.querySelector('#loginOverlay button');
  if (btnLogin) {
    btnLogin.textContent = lang === 'en' ? 'Sign In' : (lang === 'zh' ? '登录' : 'Masuk');
  }

  // 1. Terjemahkan elemen teks daun saja (JANGAN pernah menimpa container yang berisi div/button/h3/p)
  const selectors = 'h2, h3, h4, label, label span, th, td, option, button, p, .lbl, .ic-lbl, .ic-val, .badge, .empty, .hdr-sub, summary, #btStatusText, .cart-total span:first-child, #quickBateraiBtns span, #quickBateraiEceranBtns span, #cardKasKecilKasir div > div:first-child, #cardIsiKasKecilAdmin div > div, #kartuLogoToko div, #previewLogoToko span, section > div:first-child > div:first-child, #cardAuditBarang > div:last-child, #modalShiftClosing span';
  document.querySelectorAll(selectors).forEach(el => {
    if (el.id && el.id.startsWith('btnLang_')) return;
    if (el === btnLogin) return;

    // Khusus label yang berisi checkbox + teks (mis. "Pilih Semua") atau td dengan #nr_bank_note ("Saldo Bank")
    if ((el.tagName === 'LABEL' && el.querySelector('input[type="checkbox"]')) || (el.tagName === 'TD' && el.querySelector('#nr_bank_note'))) {
      const textNode = Array.from(el.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
      if (textNode) {
        if (!el.dataset.i18nOrig) el.dataset.i18nOrig = textNode.textContent.trim();
        textNode.textContent = (el.tagName === 'LABEL' ? ' ' : '') + terjemahkanTeks(el.dataset.i18nOrig, lang);
      }
      return;
    }

    // Khusus paragraf Kelola User (Mode Cloud) di Setting
    if (el.tagName === 'P' && el.textContent.includes('Dashboard Supabase')) {
      if (!el.dataset.i18nOrigHtml) el.dataset.i18nOrigHtml = el.innerHTML;
      if (lang === 'en') {
        el.innerHTML = 'Adding or removing users (Admin, Cashier, Owner) is done via the Supabase Dashboard.<br><br>Open <b>Authentication -&gt; Users -&gt; Add User</b> in your Supabase dashboard.<br>After creating a user in Supabase Auth, link the <b>User UID</b> to the <b>profil_user</b> table with the matching <b>toko_id</b> &amp; <b>role</b> (pemilik/admin/kasir).';
      } else if (lang === 'zh') {
        el.innerHTML = '添加或删除用户（管理员、收银员、店主）请通过 Supabase 控制台进行。<br><br>在 Supabase 控制台打开 <b>Authentication -&gt; Users -&gt; Add User</b>。<br>创建用户后，将 <b>User UID</b> 关联到 <b>profil_user</b> 表，并填写对应的 <b>toko_id</b> 与 <b>role</b>（pemilik/admin/kasir）。';
      } else {
        el.innerHTML = el.dataset.i18nOrigHtml;
      }
      return;
    }

    // Khusus elemen info singkat yang hanya berisi teks + <b> (mis. #srvEmptyHint, #batEmptyHint, catatan audit)
    if (el.id === 'srvEmptyHint' || el.id === 'batEmptyHint' || el.matches('#cardAuditBarang > div:last-child')) {
      if (!el.dataset.i18nOrig) el.dataset.i18nOrig = (el.textContent || '').replace(/\s+/g, ' ').trim();
      el.textContent = terjemahkanTeks(el.dataset.i18nOrig, lang);
      return;
    }

    if (el.querySelector('div, h1, h2, h3, h4, p, button, input, select, textarea, table, span, b, strong')) {
      // Khusus tombol menu utama yang punya <i class="fa-..."></i> + teks
      const icon = el.querySelector(':scope > i');
      if (icon && el.childNodes.length <= 3) {
        if (!el.dataset.i18nOrig) {
          const textOnly = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
          if (textOnly) el.dataset.i18nOrig = textOnly;
        }
        if (el.dataset.i18nOrig) {
          const hasil = terjemahkanTeks(el.dataset.i18nOrig, lang);
          el.innerHTML = icon.outerHTML + ' ' + esc(hasil);
        }
      }
      return;
    }
    if (!el.dataset.i18nOrig) {
      const orig = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (orig) el.dataset.i18nOrig = orig;
    }
    if (el.dataset.i18nOrig) {
      el.textContent = terjemahkanTeks(el.dataset.i18nOrig, lang);
    }
  });

  // 1b. Terjemahkan label "Stok: X" pada kartu
  document.querySelectorAll('.ic-stock').forEach(el => {
    if (!el.dataset.i18nOrig) el.dataset.i18nOrig = el.textContent.trim();
    const orig = el.dataset.i18nOrig;
    if (lang === 'en') el.textContent = orig.replace(/^Stok:/i, 'Stock:');
    else if (lang === 'zh') el.textContent = orig.replace(/^Stok:/i, '库存:');
    else el.textContent = orig;
  });
    // 1c. Terjemahkan label "X item"
  if (lang === 'zh') {
    document.querySelectorAll('.kpi-val, .stat-val, .sum-val, div, span').forEach(el => {
      if (el.children.length === 0 && /^\d+\s+item$/i.test(el.textContent.trim())) {
        el.textContent = el.textContent.trim().replace(/item$/i, '项');
      }
    });
  }
    // 1d. Terjemahkan Log Aktivitas & Role "(pemilik)"
  if (lang !== 'id') {
    const logMap = lang === 'zh' ? [
      // Role & Auth
      [/\(pemilik\)/gi, '(店主)'],
      [/\(kasir\)/gi, '(收银员)'],
      [/\(admin\)/gi, '(管理员)'],
      [/Berhasil masuk sistem/g, '成功登录系统'],
      [/User keluar dari sistem/g, '用户退出系统'],
      [/\s*-\s*diproses oleh\s+/gi, ' - 处理人：'],

      // Absensi & Karyawan
      [/(.+?)\s+absen masuk/gi, '$1 上班打卡'],
      [/(.+?)\s+absen pulang/gi, '$1 下班打卡'],
      [/Ubah nama karyawan\s+(.+?)\s*->\s*(.+)/gi, '将员工姓名 $1 修改为 $2'],
      [/Aktifkan akun\s+/gi, '启用账号 '],
      [/Nonaktifkan akun\s+/gi, '停用账号 '],
      [/Mengubah hak akses menu untuk\s+([^\s(]+)\s*\((\d+)\s+menu\)/gi, '修改了 $1 的菜单权限（$2 项菜单）'],

      // Servis
      [/Menyimpan\s+(\d+)\s+servis untuk\s+/gi, '已为客户保存 $1 项维修：'],
      [/Ubah status\s+([^\s]+)\s+menjadi\s+selesai/gi, '将工单 $1 状态更改为已完成'],
      [/Ubah status\s+([^\s]+)\s+menjadi\s+proses/gi, '将工单 $1 状态更改为维修中'],
      [/Ubah status\s+([^\s]+)\s+menjadi\s+diambil/gi, '将工单 $1 状态更改为已取件'],
      [/Servis\s+([^\s]+)\s+diambil oleh\s+(.+?)\s*\(diserahkan\s+(.+?)\)/gi, '维修单 $1 已由 $2 取件（经手人：$3）'],
      [/Menghapus servis\s+(.+?),\s*(\d+)\s+baris kas\/MDR dibatalkan/gi, '删除了维修单 $1，已撤销 $2 条现金/手续费记录'],

      // Penjualan & Baterai
      [/Penjualan\s+(.+?)\s+via\s+tunai/gi, '现金销售 $1'],
      [/Penjualan\s+(.+?)\s+via\s+([^\s(]+)/gi, '销售 $1（支付方式：$2）'],
      [/Menghapus transaksi penjualan\s+/gi, '删除了销售记录 '],
      [/Ganti baterai\s+(\d+)\s+item untuk\s+/gi, '更换 $1 块电池，客户：'],
      [/Jual baterai eceran\s+(.+?)\s+via\s+/gi, '零售电池 $1，支付方式：'],
      [/Menambah stok baterai:\s*/gi, '增加电池库存：'],
      [/Mengubah data baterai:\s*/gi, '修改电池信息：'],
      [/Menghapus riwayat baterai ID:\s*/gi, '删除电池记录 ID：'],
      [/Menghapus tipe baterai ID:\s*/gi, '删除电池型号 ID：'],

      // Produk, Sparepart, Supplier, Pelanggan, Audit
      [/Tambah\/Restock produk:\s*/gi, '新增/补货商品：'],
      [/Edit produk:\s*/gi, '编辑商品：'],
      [/Menghapus produk ID:\s*/gi, '删除商品 ID：'],
      [/Restock\s+(\d+)\s+(.+?)\s*\(Modal:/gi, '补货 $1 件 $2（成本：'],
      [/Simpan sparepart:\s*/gi, '保存配件：'],
      [/Mengubah data sparepart:\s*/gi, '修改配件信息：'],
      [/Menghapus sparepart ID:\s*/gi, '删除配件 ID：'],
      [/Simpan data supplier:\s*/gi, '保存供应商：'],
      [/Hapus supplier ID:\s*/gi, '删除供应商 ID：'],
      [/Menghapus pelanggan ID:\s*/gi, '删除客户 ID：'],
      [/Audit stok:\s*(\d+)\s+barang disesuaikan\./gi, '库存盘点：已调整 $1 件商品。'],
      [/Menghapus riwayat audit\s+/gi, '删除盘点记录 '],
      [/,\s*selisih\s+/gi, '，差异 '],

      // Kas, Bank, Beban Tetap & Tutup Kasir
      [/Input kas\s+/gi, '录入现金 '],
      [/Input\s+(masuk|keluar)\s*-\s*/gi, '录入 $1 - '],
      [/Isi saldo kas kecil sebesar\s+/gi, '充值备用金 '],
      [/Menghapus kas\s+/gi, '删除现金记录 '],
      [/Menambah rekening bank:\s*/gi, '新增银行账户：'],
      [/Mengubah saldo awal\s+(.+?)\s+menjadi\s+/gi, '将 $1 的期初余额修改为 '],
      [/Menghapus rekening ID:\s*/gi, '删除银行账户 ID：'],
      [/Menambah beban tetap:\s*/gi, '新增固定支出：'],
      [/Mengubah beban tetap:\s*/gi, '修改固定支出：'],
      [/Menghapus beban tetap:\s*/gi, '删除固定支出：'],
      [/\btgl\s+/gi, '日期 '],
      [/Tutup kasir oleh\s+(.+?)\s*\|\s*Sistem:\s*(.+?)\s*\|\s*Fisik:\s*(.+?)\s*\|\s*Selisih:\s*(.+?)\s*\|\s*Non-Tunai:/gi, '结班收银：$1 | 系统：$2 | 实盘：$3 | 差异：$4 | 非现金：'],
      [/\|\s*Ket:\s*/gi, '| 备注：'],

      // Pengaturan & Backup
      [/Mengubah Identitas Toko/gi, '修改了店铺信息'],
      [/Mengubah logo toko/gi, '修改了店铺图标'],
      [/Menghapus logo toko/gi, '删除了店铺图标'],
      [/Mengubah aturan komisi karyawan/gi, '修改了员工提成规则'],
      [/Ekspor data CSV:\s*/gi, '导出 CSV 数据：'],
      [/Mengunduh backup lengkap JSON/gi, '下载了完整 JSON 备份']
    ] : [
      // Role & Auth
      [/\(pemilik\)/gi, '(owner)'],
      [/\(kasir\)/gi, '(cashier)'],
      [/\(admin\)/gi, '(admin)'],
      [/Berhasil masuk sistem/g, 'Logged into system'],
      [/User keluar dari sistem/g, 'User logged out'],
      [/\s*-\s*diproses oleh\s+/gi, ' - processed by '],

      // Absensi & Karyawan
      [/(.+?)\s+absen masuk/gi, '$1 clocked in'],
      [/(.+?)\s+absen pulang/gi, '$1 clocked out'],
      [/Ubah nama karyawan\s+(.+?)\s*->\s*(.+)/gi, 'Changed employee name $1 -> $2'],
      [/Aktifkan akun\s+/gi, 'Activated account '],
      [/Nonaktifkan akun\s+/gi, 'Deactivated account '],
      [/Mengubah hak akses menu untuk\s+([^\s(]+)\s*\((\d+)\s+menu\)/gi, 'Changed menu access for $1 ($2 menus)'],

      // Servis
      [/Menyimpan\s+(\d+)\s+servis untuk\s+/gi, 'Saved $1 service(s) for '],
      [/Ubah status\s+([^\s]+)\s+menjadi\s+selesai/gi, 'Changed status of $1 to completed'],
      [/Ubah status\s+([^\s]+)\s+menjadi\s+proses/gi, 'Changed status of $1 to in progress'],
      [/Ubah status\s+([^\s]+)\s+menjadi\s+diambil/gi, 'Changed status of $1 to picked up'],
      [/Servis\s+([^\s]+)\s+diambil oleh\s+(.+?)\s*\(diserahkan\s+(.+?)\)/gi, 'Service $1 picked up by $2 (handed over by $3)'],
      [/Menghapus servis\s+(.+?),\s*(\d+)\s+baris kas\/MDR dibatalkan/gi, 'Deleted service $1, $2 cash/MDR row(s) reversed'],

      // Penjualan & Baterai
      [/Penjualan\s+(.+?)\s+via\s+tunai/gi, 'Sale $1 via cash'],
      [/Penjualan\s+(.+?)\s+via\s+([^\s(]+)/gi, 'Sale $1 via $2'],
      [/Menghapus transaksi penjualan\s+/gi, 'Deleted sales transaction '],
      [/Ganti baterai\s+(\d+)\s+item untuk\s+/gi, 'Replaced $1 battery item(s) for '],
      [/Jual baterai eceran\s+(.+?)\s+via\s+/gi, 'Retail battery sale $1 via '],
      [/Menambah stok baterai:\s*/gi, 'Added battery stock: '],
      [/Mengubah data baterai:\s*/gi, 'Updated battery data: '],
      [/Menghapus riwayat baterai ID:\s*/gi, 'Deleted battery history ID: '],
      [/Menghapus tipe baterai ID:\s*/gi, 'Deleted battery type ID: '],

      // Produk, Sparepart, Supplier, Pelanggan, Audit
      [/Tambah\/Restock produk:\s*/gi, 'Added/Restocked product: '],
      [/Edit produk:\s*/gi, 'Edited product: '],
      [/Menghapus produk ID:\s*/gi, 'Deleted product ID: '],
      [/Restock\s+(\d+)\s+(.+?)\s*\(Modal:/gi, 'Restocked $1 $2 (Cost:'],
      [/Simpan sparepart:\s*/gi, 'Saved spare part: '],
      [/Mengubah data sparepart:\s*/gi, 'Updated spare part: '],
      [/Menghapus sparepart ID:\s*/gi, 'Deleted spare part ID: '],
      [/Simpan data supplier:\s*/gi, 'Saved supplier: '],
      [/Hapus supplier ID:\s*/gi, 'Deleted supplier ID: '],
      [/Menghapus pelanggan ID:\s*/gi, 'Deleted customer ID: '],
      [/Audit stok:\s*(\d+)\s+barang disesuaikan\./gi, 'Stock audit: $1 item(s) adjusted.'],
      [/Menghapus riwayat audit\s+/gi, 'Deleted audit history '],
      [/,\s*selisih\s+/gi, ', diff '],

      // Kas, Bank, Beban Tetap & Tutup Kasir
      [/Input kas\s+/gi, 'Cash entry '],
      [/Input\s+(masuk|keluar)\s*-\s*/gi, 'Entry $1 - '],
      [/Isi saldo kas kecil sebesar\s+/gi, 'Topped up petty cash by '],
      [/Menghapus kas\s+/gi, 'Deleted cash entry '],
      [/Menambah rekening bank:\s*/gi, 'Added bank account: '],
      [/Mengubah saldo awal\s+(.+?)\s+menjadi\s+/gi, 'Changed opening balance of $1 to '],
      [/Menghapus rekening ID:\s*/gi, 'Deleted bank account ID: '],
      [/Menambah beban tetap:\s*/gi, 'Added fixed expense: '],
      [/Mengubah beban tetap:\s*/gi, 'Updated fixed expense: '],
      [/Menghapus beban tetap:\s*/gi, 'Deleted fixed expense: '],
      [/\btgl\s+/gi, 'date '],
      [/Tutup kasir oleh\s+(.+?)\s*\|\s*Sistem:\s*(.+?)\s*\|\s*Fisik:\s*(.+?)\s*\|\s*Selisih:\s*(.+?)\s*\|\s*Non-Tunai:/gi, 'Shift closed by $1 | System: $2 | Actual: $3 | Diff: $4 | Non-Cash:'],
      [/\|\s*Ket:\s*/gi, '| Note: '],

      // Pengaturan & Backup
      [/Mengubah Identitas Toko/gi, 'Updated Store Identity'],
      [/Mengubah logo toko/gi, 'Updated store logo'],
      [/Menghapus logo toko/gi, 'Removed store logo'],
      [/Mengubah aturan komisi karyawan/gi, 'Updated employee commission rules'],
      [/Ekspor data CSV:\s*/gi, 'Exported CSV data: '],
      [/Mengunduh backup lengkap JSON/gi, 'Downloaded full JSON backup']
    ];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      if (node.parentElement && ['SCRIPT', 'STYLE'].includes(node.parentElement.tagName)) continue;
      let t = node.nodeValue;
      let changed = false;
      logMap.forEach(([rgx, rep]) => {
        if (rgx.test(t)) { t = t.replace(rgx, rep); changed = true; }
      });
      if (changed) node.nodeValue = t;
    }
  }

  // 2. Terjemahkan placeholder input
  document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
    if (!el.dataset.i18nPh) el.dataset.i18nPh = el.getAttribute('placeholder') || '';
    if (el.dataset.i18nPh) el.setAttribute('placeholder', terjemahkanTeks(el.dataset.i18nPh, lang));
  });
  if (typeof terapkanMataUangUI === 'function') terapkanMataUangUI();
  if (typeof refreshBahasaBookingOnline === 'function') refreshBahasaBookingOnline();
}
terapkanBahasa();


// ==========================================================
//  FITUR V21: SISTEM KARYAWAN (ABSENSI & KOMISI OTOMATIS)
// ==========================================================
async function catatKomisiOtomatis(tipe, refId, nilaiDasar, keterangan) {
  if (!supabaseClient) return;
  try {
    const s = db.settings || {};
    let nominal = 0;
    if (tipe === 'jual') {
      const pct = +(s.komisi_jual_persen ?? 1);
      nominal = Math.round((Number(nilaiDasar) || 0) * pct / 100);
    } else if (tipe === 'servis') {
      const pct = +(s.komisi_servis_persen ?? 5);
      nominal = Math.round((Number(nilaiDasar) || 0) * pct / 100);
    } else if (tipe === 'baterai') {
      const perUnit = +(s.komisi_baterai_nominal ?? 2000);
      nominal = Math.round((Number(nilaiDasar) || 1) * perUnit);
    }
    if (nominal <= 0) return;
    await supabaseClient.from('komisi_karyawan').insert([{
      id: genId('KOM'),
      waktu: nowISO(),
      user_name: sessionStorage.getItem('ta_user') || 'kasir',
      tipe,
      ref_id: refId,
      nilai_transaksi: Number(nilaiDasar) || 0,
      nominal_komisi: nominal,
      keterangan
    }]);
  } catch (e) { console.warn('Komisi belum tersimpan (pastikan SQL migrasi sudah dijalankan):', e.message); }
}

async function absenMasuk() {
  const user = sessionStorage.getItem('ta_user') || 'kasir';
  const today = tglLokal();
  const sudah = (db.absensi || []).find(a => a.user_name === user && a.tanggal === today);
  if (sudah) return flash('Anda sudah Absen Masuk hari ini!', 'err');
  try {
    await dbOk(supabaseClient.from('absensi_karyawan').insert([{
      id: genId('ABS'),
      user_name: user,
      role: getRole() || 'kasir',
      tanggal: today,
      jam_masuk: nowISO(),
      catatan: txt('absCatatan') || null
    }]));
    await catatLog('ABSEN_MASUK', `${user} absen masuk`);
    if ($('absCatatan')) $('absCatatan').value = '';
    flash('✅ Absen Masuk berhasil dicatat!');
    tarikSemuaData();
  } catch (e) { flash('Gagal absen masuk (pastikan SQL migrasi karyawan sudah dijalankan): ' + e.message, 'err'); }
}

async function absenPulang() {
  const user = sessionStorage.getItem('ta_user') || 'kasir';
  const today = tglLokal();
  const aktif = (db.absensi || []).find(a => a.user_name === user && a.tanggal === today);
  if (!aktif) return flash('Anda belum Absen Masuk hari ini!', 'err');
  if (aktif.jam_pulang) return flash('Anda sudah Absen Pulang hari ini!', 'err');
  try {
    const cat = txt('absCatatan');
    const upd = { jam_pulang: nowISO() };
    if (cat) upd.catatan = aktif.catatan ? (aktif.catatan + ' | ' + cat) : cat;
    await dbOk(supabaseClient.from('absensi_karyawan').update(upd).eq('id', aktif.id));
    await catatLog('ABSEN_PULANG', `${user} absen pulang`);
    if ($('absCatatan')) $('absCatatan').value = '';
    flash('✅ Absen Pulang berhasil dicatat!');
    tarikSemuaData();
  } catch (e) { flash('Gagal absen pulang: ' + e.message, 'err'); }
}

const simpanAturanKomisi = () => simpanSetting({
  komisi_jual_persen: num('setKomisiJual'),
  komisi_servis_persen: num('setKomisiServis'),
  komisi_baterai_nominal: num('setKomisiBaterai')
}, 'SETTING_KOMISI', 'Mengubah aturan komisi karyawan', 'Aturan komisi disimpan!');

function renderKaryawan() {
  const user = sessionStorage.getItem('ta_user') || 'kasir';
  const today = tglLokal();
  const bln = new Date().getMonth(), thn = new Date().getFullYear();
  const absAll = db.absensi || [];
  const komAll = db.komisi || [];

  const _l = (typeof _getWaLang === 'function') ? _getWaLang() : 'id';
  const _tk = {
    id: {
      belum: 'Belum Absen Masuk hari ini', masukJam: 'Masuk jam', blmPulang: 'Belum Pulang', selesai: 'Selesai',
      hari: 'hari', karyawan: 'Karyawan', hadir: 'Hadir', komisi: 'Komisi',
      masuk: 'Masuk', pulang: 'Pulang',
      emptyAbs: 'Belum ada data absensi.', emptyKom: 'Belum ada data komisi.',
      roles: { pemilik: 'PEMILIK', owner: 'PEMILIK', admin: 'ADMIN', kasir: 'KASIR', teknisi: 'TEKNISI' }
    },
    en: {
      belum: 'Not clocked in today', masukJam: 'Clocked in at', blmPulang: 'Not clocked out', selesai: 'Completed',
      hari: 'days', karyawan: 'Staff', hadir: 'Present', komisi: 'Commission',
      masuk: 'In', pulang: 'Out',
      emptyAbs: 'No attendance records yet.', emptyKom: 'No commission records yet.',
      roles: { pemilik: 'OWNER', owner: 'OWNER', admin: 'ADMIN', kasir: 'CASHIER', teknisi: 'TECHNICIAN' }
    },
    zh: {
      belum: '今日尚未上班打卡', masukJam: '上班打卡', blmPulang: '未下班打卡', selesai: '已完成',
      hari: '天', karyawan: '员工', hadir: '出勤', komisi: '提成',
      masuk: '上班', pulang: '下班',
      emptyAbs: '暂无考勤记录。', emptyKom: '暂无提成记录。',
      roles: { pemilik: '店主', owner: '店主', admin: '管理员', kasir: '收银员', teknisi: '技师' }
    }
  }[_l] || {};
  const trRole = r => (_tk.roles && _tk.roles[String(r || '').toLowerCase()]) || String(r || '').toUpperCase();

  // Status absensi hari ini untuk user yang login
  const hariIni = absAll.find(a => a.user_name === user && a.tanggal === today);
  const stBox = $('absensiStatusBox');
  if (stBox) {
    if (!hariIni) stBox.innerHTML = `👤 <b>${esc(user)}</b> — <span style="color:#b45309">${_tk.belum}</span>`;
    else if (!hariIni.jam_pulang) stBox.innerHTML = `👤 <b>${esc(user)}</b> — <span style="color:#15803d">✅ ${_tk.masukJam} ${jam(hariIni.jam_masuk)}</span> (${_tk.blmPulang})`;
    else stBox.innerHTML = `👤 <b>${esc(user)}</b> — <span style="color:#15803d">✅ ${_tk.selesai} (${jam(hariIni.jam_masuk)} – ${jam(hariIni.jam_pulang)})</span>`;
  }
  if ($('btnAbsenMasuk')) $('btnAbsenMasuk').disabled = !!hariIni;
  if ($('btnAbsenPulang')) $('btnAbsenPulang').disabled = !hariIni || !!hariIni.jam_pulang;

  // Kelola nama karyawan & aturan komisi khusus pemilik
  if ($('cardKelolaKaryawan')) $('cardKelolaKaryawan').style.display = isPemilik() ? 'block' : 'none';
  if (isPemilik()) renderKelolaKaryawan();
  if ($('cardAturanKomisi')) $('cardAturanKomisi').style.display = isPemilik() ? 'block' : 'none';
  if (db.settings) {
    if ($('setKomisiJual') && $('setKomisiJual') !== document.activeElement) $('setKomisiJual').value = db.settings.komisi_jual_persen ?? 1;
    if ($('setKomisiServis') && $('setKomisiServis') !== document.activeElement) $('setKomisiServis').value = db.settings.komisi_servis_persen ?? 5;
    if ($('setKomisiBaterai') && $('setKomisiBaterai') !== document.activeElement) $('setKomisiBaterai').value = db.settings.komisi_baterai_nominal ?? 2000;
  }

  // Filter data sesuai role (kasir hanya lihat miliknya, admin/pemilik lihat semua)
  const absView = isAdmin() ? absAll : absAll.filter(a => a.user_name === user);
  const komView = isAdmin() ? komAll : komAll.filter(k => k.user_name === user);

  const absBln = absView.filter(a => a.tanggal && new Date(a.tanggal + 'T00:00:00').getMonth() === bln && new Date(a.tanggal + 'T00:00:00').getFullYear() === thn);
  const komBln = komView.filter(k => k.waktu && new Date(k.waktu).getMonth() === bln && new Date(k.waktu).getFullYear() === thn);

  if ($('karHadirBln')) $('karHadirBln').textContent = `${absBln.length} ${_tk.hari}`;
  if ($('karKomisiBln')) $('karKomisiBln').textContent = rp(komBln.reduce((s, k) => s + (Number(k.nominal_komisi) || 0), 0));

  // Rekap per karyawan (khusus Admin/Pemilik)
  if ($('listRekapKaryawan')) {
    if (isAdmin()) {
      const map = {};
      absBln.forEach(a => { if (!map[a.user_name]) map[a.user_name] = { hadir: 0, komisi: 0 }; map[a.user_name].hadir++; });
      komBln.forEach(k => { if (!map[k.user_name]) map[k.user_name] = { hadir: 0, komisi: 0 }; map[k.user_name].komisi += (Number(k.nominal_komisi) || 0); });
      const rows = Object.entries(map);
      setHTML('listRekapKaryawan', rows.length ? `<table><thead><tr><th>${_tk.karyawan}</th><th>${_tk.hadir}</th><th>${_tk.komisi}</th></tr></thead><tbody>` +
        rows.map(([u, v]) => `<tr><td><b>${esc(u)}</b></td><td>${v.hadir} ${_tk.hari}</td><td style="color:#15803d;font-weight:800;">${rp(v.komisi)}</td></tr>`).join('') + '</tbody></table>' : '');
    } else {
      setHTML('listRekapKaryawan', '');
    }
  }

  setHTML('listAbsensi', absView.length ? absView.slice(0, 30).map(a => `
    <div class="item-card">
      <div class="ic-head" style="margin-bottom:4px;">
        <div><b>${esc(a.user_name)}</b> <span class="badge proses">${esc(trRole(a.role))}</span></div>
        <div style="font-size:12px;color:#475569;font-weight:700;">${esc(a.tanggal)}</div>
      </div>
      <div style="font-size:13px;color:#0f1f3d;">
        🟢 ${_tk.masuk}: <b>${a.jam_masuk ? jam(a.jam_masuk) : '-'}</b> &nbsp;|&nbsp; 🔴 ${_tk.pulang}: <b>${a.jam_pulang ? jam(a.jam_pulang) : '-'}</b>
      </div>
      ${a.catatan ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">📝 ${esc(a.catatan)}</div>` : ''}
    </div>`).join('') : `<div class="empty">${_tk.emptyAbs}</div>`);

  setHTML('listKomisi', komView.length ? komView.slice(0, 30).map(k => `
    <div style="font-size:13px;border-bottom:1px solid #e2e8f0;padding:8px 4px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div>
        <div style="font-size:11px;color:#64748b;">${new Date(k.waktu).toLocaleDateString('id-ID')} · <b>${esc(k.user_name)}</b> · ${esc((k.tipe || '').toUpperCase())}</div>
        <div style="color:#0f172a;font-weight:600;">${esc(k.keterangan || '-')}</div>
      </div>
      <b style="color:#15803d;white-space:nowrap;">+${rp(k.nominal_komisi)}</b>
    </div>`).join('') : `<div class="empty">${_tk.emptyKom}</div>`);
}

// ==========================================================
//  FITUR V22: KELOLA NAMA & STATUS KARYAWAN (KHUSUS PEMILIK)
// ==========================================================
function renderKelolaKaryawan() {
  const el = $('listKelolaKaryawan'); if (!el || !isPemilik()) return;
  const list = db.profilKaryawan || [];
  if (!list.length) {
    el.innerHTML = '<div class="empty">Belum ada data karyawan (jalankan SQL migrasi_kelola_karyawan_pemilik.sql di Supabase).</div>';
    return;
  }
  const myUid = localStorage.getItem('ta_uid') || sessionStorage.getItem('ta_uid');
  el.innerHTML = list.map(u => {
    const uid = esc(u.user_id);
    const aktif = u.aktif !== false;
    const isMe = u.user_id === myUid;
    return `<div class="item-card ${aktif ? '' : 'low-stock'}">
      <div class="ic-head" style="margin-bottom:6px;">
        <div>
          <div class="ic-title">👤 ${esc(u.nama || u.username)} <span style="font-size:13px;color:#64748b;font-weight:600;">(@${esc(u.username)})</span></div>
          <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;">
            <span class="badge ${u.role === 'pemilik' ? 'danger' : (u.role === 'admin' ? 'warn' : 'proses')}">${esc((u.role || 'kasir').toUpperCase())}</span>
            <span class="badge ${aktif ? 'ok' : 'danger'}">${aktif ? 'AKTIF' : 'NONAKTIF'}</span>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button type="button" class="btn-sm blue" onclick="ubahNamaKaryawan('${uid}')">✏️ Ubah Nama</button>
        ${!isMe ? `<button type="button" class="btn-sm ${aktif ? 'danger' : 'ok'}" onclick="toggleAktifKaryawan('${uid}')">${aktif ? '🚫 Nonaktifkan' : '✅ Aktifkan'}</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function ubahNamaKaryawan(userId) {
  if (!isPemilik()) return flash('Khusus Pemilik', 'err');
  const u = (db.profilKaryawan || []).find(x => x.user_id === userId);
  if (!u) return;
  const namaBaru = prompt((({ id: 'Nama Lengkap Karyawan:', en: 'Employee Full Name:', zh: '员工全名：' })[_getWaLang()] || 'Nama Lengkap Karyawan:'), u.nama || u.username || '');
  if (namaBaru === null) return;
  const userBaru = prompt('Nama Tampilan / Panggilan (tampil di Header, Struk & Absensi):', u.username || '');
  if (userBaru === null) return;
  const n = namaBaru.trim(), un = userBaru.trim();
  if (!n || !un) return flash('Nama tidak boleh kosong', 'err');
  try {
    await dbOk(supabaseClient.from('profil_user').update({ nama: n, username: un }).eq('user_id', userId));
    await catatLog('EDIT_KARYAWAN', `Ubah nama karyawan ${u.username} -> ${un} (${n})`);
    const myUid = localStorage.getItem('ta_uid') || sessionStorage.getItem('ta_uid');
    if (userId === myUid) sessionStorage.setItem('ta_user', un);
        flash(({ id: `✅ Nama karyawan diperbarui menjadi ${un} (${n})`, en: `✅ Employee name updated to ${un} (${n})`, zh: `✅ 员工姓名已更新为 ${un} (${n})` })[_getWaLang()] || `✅ Nama karyawan diperbarui menjadi ${un} (${n})`);
    tarikSemuaData();
  } catch (e) {
    flash((({ id: 'Gagal mengubah nama: ', en: 'Failed to update name: ', zh: '修改姓名失败：' })[_getWaLang()] || 'Gagal mengubah nama: ') + e.message, 'err');
  }
}

async function toggleAktifKaryawan(userId) {
  if (!isPemilik()) return flash('Khusus Pemilik', 'err');
  const u = (db.profilKaryawan || []).find(x => x.user_id === userId);
  if (!u) return;
  const target = u.aktif === false;
  if (!confirm(`${target ? 'Aktifkan kembali' : 'Nonaktifkan'} akun ${u.username}?`)) return;
  try {
    await dbOk(supabaseClient.from('profil_user').update({ aktif: target }).eq('user_id', userId));
    await catatLog('STATUS_KARYAWAN', `${target ? 'Aktifkan' : 'Nonaktifkan'} akun ${u.username}`);
    flash(`Status ${u.username} diubah menjadi ${target ? 'AKTIF' : 'NONAKTIF'}`);
    tarikSemuaData();
  } catch (e) { flash('Gagal mengubah status: ' + e.message, 'err'); }
}

// === PELINDUNG ANTI DOUBLE-CLICK GLOBAL ===
(function() {
  const fungsiDilindungi = [
    'simpanKasKecilKasir', 'simpanKasManual', 'simpanIsiKasKecilAdmin',
    'simpanProduk', 'prosesRestock', 'tambahSparePart', 'tambahStokBaterai',
    'simpanBaterai', 'simpanSupplier', 'simpanAuditGlobal',
    'simpanShiftClosing', 'absenMasuk', 'absenPulang',
    'bayarBebanTetap', 'tambahBebanTetap', 'kirimHitungStok'
  ];
  const sedangJalan = {};
  fungsiDilindungi.forEach(nama => {
    const asli = window[nama];
    if (typeof asli !== 'function') return;
    window[nama] = async function(...args) {
      if (sedangJalan[nama]) return;
      sedangJalan[nama] = true;
      const btn = (window.event && window.event.target && window.event.target.closest)
        ? window.event.target.closest('button') : null;
      const teksAsli = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Memproses...'; }
      try {
        return await asli.apply(this, args);
      } finally {
        sedangJalan[nama] = false;
        if (btn) { btn.disabled = false; btn.innerHTML = teksAsli; }
      }
    };
  });
})();

// === BANNER PENGINGAT LANGGANAN H-7 ===
function cekBannerLangganan() {
  const lama = document.getElementById('bannerLanggananH7');
  if (lama) lama.remove();

  const toko = currentTenant?.toko;
  if (!toko) return;

  const tglExp = toko.masa_aktif_sampai || toko.expired_at || toko.masa_aktif || toko.aktif_hingga || toko.langganan_hingga;
  if (!tglExp) return;

  const sisaHari = Math.ceil((new Date(tglExp).setHours(23,59,59,999) - Date.now()) / 86400000);
  if (sisaHari > 7 || sisaHari < 0) return;

  const lang = localStorage.getItem('ta_lang') || 'id';
  const pesan = lang === 'en'
    ? `⚠️ Subscription expires in ${sisaHari} day(s). Please renew to avoid service interruption.`
    : lang === 'zh'
    ? `⚠️ 订阅将在 ${sisaHari} 天后到期，请及时续费以免影响使用。`
    : `⚠️ Masa aktif langganan tersisa ${sisaHari} hari lagi. Segera perpanjang agar toko tidak terkunci.`;

  const banner = document.createElement('div');
  banner.id = 'bannerLanggananH7';
  banner.style.cssText = 'background:#fef3c7;color:#92400e;border-bottom:2px solid #f59e0b;padding:10px 14px;text-align:center;font-size:13px;font-weight:700;position:sticky;top:0;z-index:999;';
  banner.textContent = pesan;
  document.body.prepend(banner);
}
// === PENGATURAN HAK AKSES MENU PER ROLE (KHUSUS PEMILIK) ===
const DAFTAR_MENU_AKSES = [
  { id: 'kasir', label: 'Kasir' },
  { id: 'servis', label: 'Servis' },
  { id: 'baterai', label: 'Baterai' },
  { id: 'produk', label: 'Produk & Stock' },
  { id: 'sparepart', label: 'Spare Part' },
  { id: 'laporan', label: 'Laporan' },
  { id: 'pelanggan', label: 'Pelanggan' },
  { id: 'karyawan', label: 'Karyawan & Absensi' },
  { id: 'kas', label: 'Kas' },
  { id: 'supplier', label: 'Supplier' },
  { id: 'keuangan', label: 'Laporan Keuangan' },
  { id: 'semua_stok', label: 'Semua Stok & Harga' },
  { id: 'laporan_audit', label: 'Laporan & Kartu Audit' },
  { id: 'setting', label: 'Setting (Printer/Bahasa)' }
];

let _defaultMenuByRole = null;
let _aksesMenuLoadedTokoId = null;

function _simpanDefaultMenuRole() {
  if (!_defaultMenuByRole && typeof MENU_BY_ROLE === 'object') {
    _defaultMenuByRole = {
      kasir: [...(MENU_BY_ROLE.kasir || [])],
      admin: [...(MENU_BY_ROLE.admin || [])]
    };
  }
}

async function muatAksesMenuCloud() {
  if (!currentTenant || !currentTenant.toko_id) return;
  if (_aksesMenuLoadedTokoId === currentTenant.toko_id) return;
  _aksesMenuLoadedTokoId = currentTenant.toko_id;
  try {
    const { data } = await supabaseClient
      .from('toko')
      .select('akses_menu')
      .eq('id', currentTenant.toko_id)
      .maybeSingle();
    if (data && data.akses_menu && typeof data.akses_menu === 'object') {
      if (!currentTenant.toko) currentTenant.toko = {};
      currentTenant.toko.akses_menu = data.akses_menu;
      terapkanAksesMenu();
    }
  } catch (e) {
    console.warn('Gagal memuat akses_menu:', e);
  }
}

function terapkanAksesMenu() {
  _simpanDefaultMenuRole();
  muatAksesMenuCloud();

  const custom = (currentTenant && currentTenant.toko && currentTenant.toko.akses_menu) || {};
  if (_defaultMenuByRole) {
    MENU_BY_ROLE.kasir = Array.isArray(custom.kasir) ? custom.kasir : [..._defaultMenuByRole.kasir];
    MENU_BY_ROLE.admin = Array.isArray(custom.admin) ? custom.admin : [..._defaultMenuByRole.admin];
  }

  const role = (getRole() || '').toLowerCase();
  const allowed = MENU_BY_ROLE[role] || [];

  document.querySelectorAll('#home button[onclick^="bukaMenu("]').forEach(btn => {
    const m = (btn.getAttribute('onclick') || '').match(/bukaMenu\(['"]([^'"]+)['"]\)/);
    if (!m) return;
    const menuId = m[1];
    const boleh = isPemilik() || allowed.includes(menuId);
    btn.style.display = boleh ? 'flex' : 'none';
  });

  const menuAdmin = $('menuAdmin');
  if (menuAdmin) {
    const adaTombolAdmin = Array.from(menuAdmin.querySelectorAll('button')).some(b => b.style.display !== 'none');
    menuAdmin.style.display = (isPemilik() || adaTombolAdmin) ? 'grid' : 'none';
  }
    // Rapikan grid menu agar dinamis (tombol ganjil melebar penuh, blok kosong disembunyikan)
  const wadahMenu = new Set();
  document.querySelectorAll('#home button[onclick*="bukaMenu"]').forEach(btn => {
    if (btn.parentElement) wadahMenu.add(btn.parentElement);
  });

  wadahMenu.forEach(box => {
    const semuaTombol = Array.from(box.children).filter(el => el.matches('button[onclick*="bukaMenu"]'));
    semuaTombol.forEach(el => { el.style.gridColumn = ''; });

    const tombolAktif = semuaTombol.filter(el => el.style.display !== 'none');
    if (tombolAktif.length === 0) {
      box.style.display = 'none';
    } else {
      box.style.display = 'grid';
      if (tombolAktif.length % 2 === 1) {
        tombolAktif[tombolAktif.length - 1].style.gridColumn = '1 / -1';
      }
    }
  });
}

function tampilkanPanelAksesMenu() {
  const card = $('cardHakAksesMenu');
  if (!card) return;
  if (!isPemilik()) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  renderCheckboxAksesMenu();
  if (typeof terapkanBahasa === 'function') terapkanBahasa();
}

function renderCheckboxAksesMenu() {
  _simpanDefaultMenuRole();
  const container = $('listCheckboxAksesMenu');
  const selRole = $('aksesRolePilih');
  if (!container || !selRole) return;

  const role = selRole.value;
  const custom = (currentTenant && currentTenant.toko && currentTenant.toko.akses_menu) || {};
  const aktif = Array.isArray(custom[role])
    ? custom[role]
    : ((_defaultMenuByRole && _defaultMenuByRole[role]) || MENU_BY_ROLE[role] || []);

  container.innerHTML = DAFTAR_MENU_AKSES.map(m => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;cursor:pointer;margin:0;font-weight:600;font-size:13px;">
      <input type="checkbox" class="chk-akses-menu" value="${m.id}" ${aktif.includes(m.id) ? 'checked' : ''} style="width:18px;height:18px;flex-shrink:0;">
      <span>${m.label}</span>
    </label>
  `).join('');
}

async function simpanAksesMenu() {
  if (!isPemilik()) return flash('Hanya Pemilik yang bisa mengubah hak akses.', 'err');
  const role = $('aksesRolePilih') ? $('aksesRolePilih').value : 'kasir';
  const terpilih = Array.from(document.querySelectorAll('.chk-akses-menu:checked')).map(el => el.value);

  try {
    const aksesLama = (currentTenant && currentTenant.toko && currentTenant.toko.akses_menu) || {};
    const aksesBaru = { ...aksesLama, [role]: terpilih };

    await dbOk(supabaseClient.from('toko').update({ akses_menu: aksesBaru }).eq('id', currentTenant.toko_id));
    if (currentTenant.toko) currentTenant.toko.akses_menu = aksesBaru;

    terapkanAksesMenu();
    await catatLog('AKSES_MENU', `Mengubah hak akses menu untuk ${role.toUpperCase()} (${terpilih.length} menu)`);
    flash(`Hak akses menu ${role.toUpperCase()} berhasil disimpan!`);
  } catch (e) {
    flash('Gagal menyimpan hak akses: ' + e.message, 'err');
  }
}

// === AUTO-TRANSLATE SEMUA POP-UP (alert, confirm, prompt) ===
(function () {
  const _alert = window.alert.bind(window);
  const _confirm = window.confirm.bind(window);
  const _prompt = window.prompt.bind(window);

  function trPopup(msg) {
    if (typeof msg !== 'string') return msg;
    const lang = localStorage.getItem('ta_lang') || localStorage.getItem('horopos_lang') || 'id';
    if (lang === 'id') return msg;

    const map = lang === 'zh' ? [
      // Sesi & Sistem
      [/⚠️ Akun ini baru saja login di perangkat lain\.\nAnda akan dikeluarkan demi keamanan\./g, '⚠️ 此账号刚在其他设备登录。\n为保障安全，您将被强制退出。'],
      [/Browser tidak mendukung scan kamera\. Gunakan Chrome Android\./g, '当前浏览器不支持摄像头扫码，请使用 Android Chrome。'],
      [/Tidak bisa akses kamera:\s*/g, '无法访问摄像头：'],
      [/Pop-up diblokir browser\. Izinkan pop-up untuk mencetak barcode\./g, '弹窗被浏览器拦截，请允许弹窗以打印条码。'],
      [/Pilih minimal 1 produk dengan mencentang kotaknya!/g, '请至少勾选 1 件商品！'],
      [/Nomor HP tidak valid\./g, '手机号码无效。'],
      [/Nomor HP tidak ada/g, '没有手机号码'],

      // Karyawan
      [/Nama Tampilan \/ Panggilan \(tampil di Header, Struk & Absensi\):/g, '显示名称/昵称（显示于顶部、小票和考勤）：'],
      [/Aktifkan kembali akun\s+(.+?)\?/g, '重新启用账号 $1 吗？'],
      [/Nonaktifkan akun\s+(.+?)\?/g, '停用账号 $1 吗？'],

      // Konfirmasi Hapus & Kosongkan
      [/Hapus produk ini\?/g, '确定删除此商品吗？'],
      [/Kosongkan semua list servis\?/g, '确定清空所有维修列表吗？'],
      [/Kosongkan list baterai\?/g, '确定清空电池列表吗？'],
      [/Hapus data riwayat baterai ini\?/g, '确定删除此电池更换记录吗？'],
      [/Hapus tipe baterai ini\?/g, '确定删除此电池型号吗？'],
      [/Hapus rekening bank ini\?/g, '确定删除此银行账户吗？'],
      [/Hapus pelanggan ini\?/g, '确定删除此客户吗？'],
      [/Hapus sparepart ini\?/g, '确定删除此配件吗？'],
      [/Hapus supplier ini\?/g, '确定删除此供应商吗？'],
      [/Hapus logo dari semua nota\?/g, '确定从所有小票中删除店铺图标吗？'],
      [/Hapus servis ini\?\n\nStok part\/baterai akan dikembalikan, catatan kas\/MDR servis ini ikut dibatalkan, dan kuota klaim \(jika ada\) dikembalikan\./g, '确定删除此维修单吗？\n\n配件/电池库存将退回，相关现金/手续费记录将撤销，保修次数（如有）也将退回。'],
      [/⚠️ Hapus transaksi penjualan ini\?\n\nStok produk akan dikembalikan, dan catatan kas terkait ikut terhapus\./g, '⚠️ 确定删除此销售记录吗？\n\n商品库存将退回，相关现金记录也将被删除。'],
      [/⚠️ Yakin ingin menghapus riwayat kas ini\?\n\nTindakan ini menghapus data secara permanen dan mempengaruhi total saldo\./g, '⚠️ 确定永久删除此现金记录吗？\n\n此操作不可恢复，且会影响总余额。'],
      [/Hapus beban "(.+?)" dari daftar\?\n\nRiwayat pembayaran yang sudah tercatat di kas TIDAK ikut terhapus\./g, '确定从列表中删除固定支出“$1”吗？\n\n已记录在现金账中的历史付款不会被删除。'],
      [/Hapus riwayat audit "(.+?)"\?\n\nCatatan: Ini hanya menghapus baris riwayat audit, tidak mengubah stok barang saat ini\./g, '确定删除盘点记录“$1”吗？\n\n注意：仅删除盘点记录，不会修改当前库存数量。'],

      // Servis & Garansi
      [/Tagihan sudah LUNAS!\n\nApakah pelanggan langsung mengambil jam sekarang\? \(Lanjut ke Tanda Tangan Pengambilan\)/g, '账单已结清！\n\n客户现在直接取表吗？（继续前往取件签名）'],
      [/KLAIM GARANSI\n\nPelanggan:\s*(.+?)\nSisa kuota:\s*(\d+)x\n\nLanjut\?/g, '保修申请\n\n客户：$1\n剩余次数：$2次\n\n是否继续？'],
      [/⚠️ PERINGATAN GARANSI HABIS\n\nGaransi nota\s+(.+?)\s+sudah lewat\s+(\d+)\s+hari\.\nJangan janjikan gratis sebelum disetujui Admin\/Pemilik \(wajib otorisasi saat simpan\)\.\n\nLanjutkan\?/g, '⚠️ 保修已过期提醒\n\n单号 $1 的保修已过期 $2 天。\n未经管理员/店主批准请勿承诺免费（保存时需授权）。\n\n是否继续？'],
      [/Nota ini berisi beberapa barang, pilih yang diklaim:/g, '此单据包含多件商品，请选择需要保修的商品：'],

      // Input Prompt (Stok, Bank, Beban)
      [/^Min Stok:$/g, '最低库存：'],
      [/^Harga Beli:$/g, '进货价：'],
      [/^Harga Jual:$/g, '销售价：'],
      [/^Nama Sparepart:$/g, '配件名称：'],
      [/^Nama beban:$/g, '固定支出名称：'],
      [/^Nominal per bulan \(Rp\):$/g, '每月金额：'],
      [/^Tanggal jatuh tempo \(1-31\):$/g, '每月到期日 (1-31)：'],
      [/Masukkan Saldo Awal baru untuk\s+(.+?)\s*\(Rp\):/g, '请输入 $1 的新期初余额：'],
      [/REKONSILIASI BANK\s+(.+?)\n\nSaldo Sistem:\s*(.+?)\n\nMasukkan Saldo Aktual \(sesuai m-banking\/ATM\):/g, '银行对账 $1\n\n系统余额：$2\n\n请输入实际余额（按网银/ATM）：'],
      [/Selisih:\s*(.+?)\n\nMasukkan alasan penyesuaian \(contoh: Bunga Bank, Biaya Admin, Koreksi Transfer\):/g, '差异：$1\n\n请输入调整原因（例如：银行利息、手续费、转账更正）：']
    ] : [
      // Session & System (EN)
      [/⚠️ Akun ini baru saja login di perangkat lain\.\nAnda akan dikeluarkan demi keamanan\./g, '⚠️ This account was just logged in on another device.\nYou will be signed out for security.'],
      [/Browser tidak mendukung scan kamera\. Gunakan Chrome Android\./g, 'Browser does not support camera scanning. Please use Chrome Android.'],
      [/Tidak bisa akses kamera:\s*/g, 'Cannot access camera: '],
      [/Pop-up diblokir browser\. Izinkan pop-up untuk mencetak barcode\./g, 'Pop-up blocked by browser. Please allow pop-ups to print barcodes.'],
      [/Pilih minimal 1 produk dengan mencentang kotaknya!/g, 'Please select at least 1 product by checking its box!'],
      [/Nomor HP tidak valid\./g, 'Invalid phone number.'],
      [/Nomor HP tidak ada/g, 'No phone number found'],

      // Employees
      [/Nama Tampilan \/ Panggilan \(tampil di Header, Struk & Absensi\):/g, 'Display Name / Nickname (shown in Header, Receipts & Attendance):'],
      [/Aktifkan kembali akun\s+(.+?)\?/g, 'Reactivate account $1?'],
      [/Nonaktifkan akun\s+(.+?)\?/g, 'Deactivate account $1?'],

      // Delete & Clear Confirmations
      [/Hapus produk ini\?/g, 'Delete this product?'],
      [/Kosongkan semua list servis\?/g, 'Clear all items in the service list?'],
      [/Kosongkan list baterai\?/g, 'Clear the battery list?'],
      [/Hapus data riwayat baterai ini\?/g, 'Delete this battery history record?'],
      [/Hapus tipe baterai ini\?/g, 'Delete this battery type?'],
      [/Hapus rekening bank ini\?/g, 'Delete this bank account?'],
      [/Hapus pelanggan ini\?/g, 'Delete this customer?'],
      [/Hapus sparepart ini\?/g, 'Delete this spare part?'],
      [/Hapus supplier ini\?/g, 'Delete this supplier?'],
      [/Hapus logo dari semua nota\?/g, 'Remove logo from all receipts?'],
      [/Hapus servis ini\?\n\nStok part\/baterai akan dikembalikan, catatan kas\/MDR servis ini ikut dibatalkan, dan kuota klaim \(jika ada\) dikembalikan\./g, 'Delete this service?\n\nPart/battery stock will be restored, related cash/MDR records reversed, and warranty claim quota (if any) restored.'],
      [/⚠️ Hapus transaksi penjualan ini\?\n\nStok produk akan dikembalikan, dan catatan kas terkait ikut terhapus\./g, '⚠️ Delete this sales transaction?\n\nProduct stock will be restored and related cash records will be deleted.'],
      [/⚠️ Yakin ingin menghapus riwayat kas ini\?\n\nTindakan ini menghapus data secara permanen dan mempengaruhi total saldo\./g, '⚠️ Permanently delete this cash record?\n\nThis action cannot be undone and will affect the total balance.'],
      [/Hapus beban "(.+?)" dari daftar\?\n\nRiwayat pembayaran yang sudah tercatat di kas TIDAK ikut terhapus\./g, 'Remove fixed expense "$1" from the list?\n\nPast payment history recorded in cash will NOT be deleted.'],
      [/Hapus riwayat audit "(.+?)"\?\n\nCatatan: Ini hanya menghapus baris riwayat audit, tidak mengubah stok barang saat ini\./g, 'Delete audit history "$1"?\n\nNote: This only removes the audit log row and does not change current stock.'],

      // Service & Warranty
      [/Tagihan sudah LUNAS!\n\nApakah pelanggan langsung mengambil jam sekarang\? \(Lanjut ke Tanda Tangan Pengambilan\)/g, 'Invoice is PAID!\n\nIs the customer picking up the watch now? (Proceed to Pickup Signature)'],
      [/KLAIM GARANSI\n\nPelanggan:\s*(.+?)\nSisa kuota:\s*(\d+)x\n\nLanjut\?/g, 'WARRANTY CLAIM\n\nCustomer: $1\nRemaining quota: $2x\n\nContinue?'],
      [/⚠️ PERINGATAN GARANSI HABIS\n\nGaransi nota\s+(.+?)\s+sudah lewat\s+(\d+)\s+hari\.\nJangan janjikan gratis sebelum disetujui Admin\/Pemilik \(wajib otorisasi saat simpan\)\.\n\nLanjutkan\?/g, '⚠️ EXPIRED WARRANTY WARNING\n\nWarranty for receipt $1 expired $2 day(s) ago.\nDo not promise free service before Admin/Owner approval (authorization required on save).\n\nContinue?'],
      [/Nota ini berisi beberapa barang, pilih yang diklaim:/g, 'This receipt contains multiple items, choose the one to claim:'],

      // Input Prompts
      [/^Min Stok:$/g, 'Min Stock:'],
      [/^Harga Beli:$/g, 'Cost Price:'],
      [/^Harga Jual:$/g, 'Selling Price:'],
      [/^Nama Sparepart:$/g, 'Spare Part Name:'],
      [/^Nama beban:$/g, 'Expense Name:'],
      [/^Nominal per bulan \(Rp\):$/g, 'Monthly Amount:'],
      [/^Tanggal jatuh tempo \(1-31\):$/g, 'Due Date (1-31):'],
      [/Masukkan Saldo Awal baru untuk\s+(.+?)\s*\(Rp\):/g, 'Enter new Opening Balance for $1:'],
      [/REKONSILIASI BANK\s+(.+?)\n\nSaldo Sistem:\s*(.+?)\n\nMasukkan Saldo Aktual \(sesuai m-banking\/ATM\):/g, 'BANK RECONCILIATION $1\n\nSystem Balance: $2\n\nEnter Actual Balance (per m-banking/ATM):'],
      [/Selisih:\s*(.+?)\n\nMasukkan alasan penyesuaian \(contoh: Bunga Bank, Biaya Admin, Koreksi Transfer\):/g, 'Difference: $1\n\nEnter adjustment reason (e.g., Bank Interest, Admin Fee, Transfer Correction):']
    ];

    let out = msg;
    for (const [rgx, rep] of map) out = out.replace(rgx, rep);
    return out;
  }

  window.alert = (m) => _alert(trPopup(m));
  window.confirm = (m) => _confirm(trPopup(m));
  window.prompt = (m, d) => _prompt(trPopup(m), d);
})();

// === AUTO-TRANSLATE SEMUA NOTIFIKASI / WARNING (flash) ===
(function () {
  if (typeof window.flash !== 'function') return;
  const _flash = window.flash;

  function trFlash(msg) {
    if (typeof msg !== 'string') return msg;
    const lang = localStorage.getItem('ta_lang') || localStorage.getItem('horopos_lang') || 'id';
    if (lang === 'id') return msg;

    const map = lang === 'zh' ? [
      // Servis & Kas Kecil (dari screenshot)
      [/Lunasi sisa tagihan dulu sebelum jam diambil\./g, '取表前请先结清余款。'],
      [/Nominal harus antara Rp1 - Rp500\.000/g, '金额必须在 1 至 500,000 之间'],

      // Akses & Validasi Umum
      [/Akses ditolak\. Hanya Admin yang bisa mengubah produk\./g, '拒绝访问。仅管理员可修改商品。'],
      [/Akses ditolak\. Hanya Admin\/Pemilik yang bisa menghapus\./g, '拒绝访问。仅管理员/店主可删除。'],
      [/Akses ditolak\.?/g, '拒绝访问。'],
      [/Khusus Pemilik/g, '仅限店主'],
      [/Hanya Pemilik yang bisa menghapus produk/g, '仅店主可删除商品'],
      [/Hanya Pemilik yang bisa menghapus transaksi penjualan/g, '仅店主可删除销售记录'],
      [/Hanya Pemilik yang bisa mengubah pengaturan\./g, '仅店主可修改设置。'],
      [/Hanya Pemilik yang bisa mengubah hak akses\./g, '仅店主可修改权限。'],
      [/Hanya Pemilik yang bisa mengubah logo/g, '仅店主可修改图标'],
      [/Hanya Pemilik yang bisa mengatur daftar beban/g, '仅店主可管理固定支出'],
      [/Hanya Pemilik yang bisa mengubah beban/g, '仅店主可修改固定支出'],
      [/Hanya Pemilik yang bisa menghapus beban/g, '仅店主可删除固定支出'],
      [/Hanya Pemilik yang bisa menghapus riwayat audit/g, '仅店主可删除盘点记录'],
      [/Hanya Pemilik yang bisa mengekspor backup data/g, '仅店主可导出备份数据'],
      [/Hanya Pemilik yang bisa mengunduh backup penuh/g, '仅店主可下载完整备份'],
      [/Hanya Pemilik yang bisa menghapus/g, '仅店主可删除'],
      [/Hanya Admin\/Pemilik yang bisa mengisi saldo kas kecil/g, '仅管理员/店主可充值备用金'],
      [/Lengkapi kolom wajib/g, '请填写必填项'],
      [/Lengkapi Nama dan Produk/g, '请填写客户姓名和商品'],
      [/Lengkapi nominal & keterangan/g, '请填写金额和说明'],
      [/Username dan password wajib diisi/g, '请输入用户名和密码'],
      [/Nama wajib diisi/g, '请填写名称'],
      [/Nama Pelanggan wajib diisi/g, '请填写客户姓名'],
      [/Nama penerima wajib diisi/g, '请填写取件人姓名'],
      [/Nama beban wajib diisi/g, '请填写支出名称'],
      [/Nama bank wajib/g, '请填写银行名称'],
      [/Nama tidak boleh kosong/g, '名称不能为空'],
      [/Keterangan wajib diisi/g, '请填写说明'],
      [/Catatan audit wajib diisi/g, '请填写盘点备注'],
      [/Alasan penyesuaian wajib diisi/g, '请填写调整原因'],
      [/Nominal tidak valid/g, '金额无效'],
      [/Nominal harus lebih dari 0/g, '金额必须大于 0'],
      [/Data tidak valid/g, '数据无效'],
      [/Qty tidak valid/g, '数量无效'],
      [/Harga\/stok tidak boleh negatif/g, '价格/库存不能为负数'],
      [/Pilih rekening bank tujuan terlebih dahulu untuk transaksi non-tunai/g, '非现金交易请先选择收款银行账户'],
      [/Pilih rekening bank terlebih dahulu/g, '请先选择银行账户'],

      // Kasir, Stok, Servis & Baterai
      [/Keranjang kosong/g, '购物车为空'],
      [/Keranjang baterai masih kosong/g, '电池列表为空'],
      [/Uang kurang/g, '收款金额不足'],
      [/Pilih produk/g, '请选择商品'],
      [/Stok tidak cukup/g, '库存不足'],
      [/Stok tidak mencukupi!/g, '库存不足！'],
      [/Stok habis/g, '已售罄'],
      [/Stok baterai habis!/g, '电池库存不足！'],
      [/Stok baterai tidak mencukupi!/g, '电池库存不足！'],
      [/Transaksi sedang diproses, mohon tunggu\.\.\./g, '交易处理中，请稍候...'],
      [/Transaksi berhasil/g, '交易成功'],
      [/List kosong\. Klik "Tambah Jam Ini ke List"\./g, '列表为空，请先点击“添加手表到工单”。'],
      [/Jam berhasil ditambahkan ke list/g, '手表已添加到列表'],
      [/Semua servis berhasil disimpan!/g, '所有维修单已保存！'],
      [/Servis sudah diambil, status tidak bisa diubah kembali\./g, '该维修单已取件，无法再次更改状态。'],
      [/Pelanggan wajib tanda tangan di kotak terlebih dahulu/g, '请先让客户在方框内签名'],
      [/Isi Nama Produk \/ Jam terlebih dahulu!/g, '请先填写商品/手表名称！'],
      [/Pilih Tipe Baterai terlebih dahulu!/g, '请先选择电池型号！'],
      [/Baterai berhasil ditambahkan ke list/g, '电池已添加到列表'],
      [/Kas kecil dicatat/g, '零用现金已记录'],
      [/Kas dicatat/g, '现金记录已保存'],
      [/Produk diperbarui/g, '商品已更新'],
      [/Produk baru ditambahkan/g, '新商品已添加'],
      [/Disimpan/g, '已保存'],
      [/Dihapus/g, '已删除'],
      [/Tipe wajib/gi, '电池型号为必填项'],
      [/Pilih tipe baterai terlebih dahulu!?/gi, '请先选择电池型号！'],
      [/📤 Mengirim pesan WA via API\.\.\./g, '📤 正在通过 API 发送 WhatsApp 消息...'],
      [/✅ Pesan WA terkirim otomatis via API!/g, '✅ WhatsApp 消息已通过 API 自动发送！'],
      [/Membuat kartu digital\.\.\./g, '正在生成电子保修卡...'],
      [/Kartu digital berhasil dibuat!/g, '电子保修卡已生成！'],
      [/Gagal membuat gambar/g, '生成图片失败'],
      [/Garansi servis tidak valid/g, '维修保修无效'],
      [/Servis dihapus & stok\/kas dikembalikan secara atomik/gi, '维修单已删除，库存与现金已自动回滚'],
      [/Data baterai tidak valid/g, '电池数据无效'],
      [/Library html2canvas belum dimuat/g, 'html2canvas 组件未加载'],

      // Absensi & Tampilan
      [/Anda sudah Absen Masuk hari ini!/g, '您今天已经上班打卡了！'],
      [/Anda belum Absen Masuk hari ini!/g, '您今天尚未上班打卡！'],
      [/Anda sudah Absen Pulang hari ini!/g, '您今天已经下班打卡了！'],
      [/✅ Absen Masuk berhasil dicatat!/g, '✅ 上班打卡成功！'],
      [/✅ Absen Pulang berhasil dicatat!/g, '✅ 下班打卡成功！'],
      [/Mode Huruf Besar AKTIF/g, '大字体模式已开启'],
      [/Mode Huruf Normal/g, '标准字体模式'],
      [/Pengaturan MDR disimpan!?/gi, '费率规则已保存！'],
      [/Aturan diskon disimpan!?/gi, '折扣规则已保存！'],
      [/Aturan garansi & baterai disimpan!?/gi, '保修与电池规则已保存！'],
      [/Identitas disimpan!?/gi, '店铺信息已保存！'],
      [/Pengaturan WhatsApp API disimpan & disinkronkan!?/gi, 'WhatsApp API 设置已保存并同步！'],
      [/Pengaturan Telegram Bot disimpan!?/gi, 'Telegram 机器人设置已保存！'],
      [/Logo disimpan, akan tampil di nota/gi, '图标已保存，将显示在小票上'],
      [/Logo dihapus/gi, '图标已删除'],
      [/Mode Bluetooth APK \(RawBT\) diaktifkan! Pastikan aplikasi RawBT sudah terpasang & terhubung ke printer\./g, '蓝牙 APK (RawBT) 模式已开启！请确保已安装 RawBT 并连接打印机。'],
      [/Printer Bluetooth terhubung!/g, '蓝牙打印机已连接！'],
      [/✅ Tes cetak dikirim ke printer!/g, '✅ 测试打印已发送至打印机！'],
      [/Mode Cetak Bluetooth AKTIF/g, '蓝牙打印模式已开启'],
      [/Mode Preview Struk AKTIF/g, '小票预览模式已开启'],
      [/Gagal konek Bluetooth:\s*/g, '蓝牙连接失败：'],
      [/Hubungkan printer Bluetooth dulu/g, '请先连接蓝牙打印机'],
      [/Gagal mencetak:\s*/g, '打印失败：'],
      [/Karakteristik tulis ESC\/POS tidak ditemukan pada printer ini\./g, '未在此打印机上找到 ESC/POS 写入特征。'],
      [/✅ Pesan tes berhasil terkirim ke Telegram!/g, '✅ 测试消息已发送至 Telegram！'],
      [/File Excel \(CSV\)\s+(.+?)\s+berhasil diunduh!/g, '$1 的 Excel (CSV) 文件已下载！'],
      [/Backup penuh \(\.json\) berhasil diunduh!/g, '完整备份 (.json) 已下载！'],
      [/Hak akses menu\s+(\w+)\s+berhasil disimpan!?/gi, '$1 菜单权限已保存！'],
      [/Gagal menyimpan hak akses:\s*/gi, '保存菜单权限失败：'],
      [/Pilih file logo dulu/gi, '请先选择图标文件'],


      // Prefix Error Umum
      [/^Gagal menyimpan:\s*/g, '保存失败：'],
      [/^Gagal menghapus:\s*/g, '删除失败：'],
      [/^Gagal:\s*/g, '失败：']
    ] : [
      // Service & Petty Cash (EN)
      [/Lunasi sisa tagihan dulu sebelum jam diambil\./g, 'Please settle the remaining balance before watch pickup.'],
      [/Nominal harus antara Rp1 - Rp500\.000/g, 'Amount must be between 1 and 500,000'],

      // Access & Validation
      [/Akses ditolak\. Hanya Admin yang bisa mengubah produk\./g, 'Access denied. Only Admin can edit products.'],
      [/Akses ditolak\. Hanya Admin\/Pemilik yang bisa menghapus\./g, 'Access denied. Only Admin/Owner can delete.'],
      [/Akses ditolak\.?/g, 'Access denied.'],
      [/Khusus Pemilik/g, 'Owner only'],
      [/Hanya Pemilik yang bisa menghapus produk/g, 'Only Owner can delete products'],
      [/Hanya Pemilik yang bisa menghapus transaksi penjualan/g, 'Only Owner can delete sales transactions'],
      [/Hanya Pemilik yang bisa mengubah pengaturan\./g, 'Only Owner can change settings.'],
      [/Hanya Pemilik yang bisa mengubah hak akses\./g, 'Only Owner can change menu access.'],
      [/Hanya Pemilik yang bisa mengubah logo/g, 'Only Owner can change the logo'],
      [/Hanya Pemilik yang bisa mengatur daftar beban/g, 'Only Owner can manage fixed expenses'],
      [/Hanya Pemilik yang bisa mengubah beban/g, 'Only Owner can edit fixed expenses'],
      [/Hanya Pemilik yang bisa menghapus beban/g, 'Only Owner can delete fixed expenses'],
      [/Hanya Pemilik yang bisa menghapus riwayat audit/g, 'Only Owner can delete audit history'],
      [/Hanya Pemilik yang bisa mengekspor backup data/g, 'Only Owner can export backup data'],
      [/Hanya Pemilik yang bisa mengunduh backup penuh/g, 'Only Owner can download full backup'],
      [/Hanya Pemilik yang bisa menghapus/g, 'Only Owner can delete'],
      [/Hanya Admin\/Pemilik yang bisa mengisi saldo kas kecil/g, 'Only Admin/Owner can top up petty cash'],
      [/Lengkapi kolom wajib/g, 'Please fill in all required fields'],
      [/Lengkapi Nama dan Produk/g, 'Please fill in Customer Name and Product'],
      [/Lengkapi nominal & keterangan/g, 'Please fill in amount & description'],
      [/Username dan password wajib diisi/g, 'Username and password are required'],
      [/Nama wajib diisi/g, 'Name is required'],
      [/Nama Pelanggan wajib diisi/g, 'Customer name is required'],
      [/Nama penerima wajib diisi/g, 'Recipient name is required'],
      [/Nama beban wajib diisi/g, 'Expense name is required'],
      [/Nama bank wajib/g, 'Bank name is required'],
      [/Nama tidak boleh kosong/g, 'Name cannot be empty'],
      [/Keterangan wajib diisi/g, 'Description is required'],
      [/Catatan audit wajib diisi/g, 'Audit note is required'],
      [/Alasan penyesuaian wajib diisi/g, 'Adjustment reason is required'],
      [/Nominal tidak valid/g, 'Invalid amount'],
      [/Nominal harus lebih dari 0/g, 'Amount must be greater than 0'],
      [/Data tidak valid/g, 'Invalid data'],
      [/Qty tidak valid/g, 'Invalid quantity'],
      [/Harga\/stok tidak boleh negatif/g, 'Price/stock cannot be negative'],
      [/Pilih rekening bank tujuan terlebih dahulu untuk transaksi non-tunai/g, 'Please select a destination bank account for non-cash transactions'],
      [/Pilih rekening bank terlebih dahulu/g, 'Please select a bank account first'],

      // POS, Stock, Service & Battery
      [/Keranjang kosong/g, 'Cart is empty'],
      [/Keranjang baterai masih kosong/g, 'Battery list is empty'],
      [/Uang kurang/g, 'Insufficient payment'],
      [/Pilih produk/g, 'Select a product'],
      [/Stok tidak cukup/g, 'Insufficient stock'],
      [/Stok tidak mencukupi!/g, 'Insufficient stock!'],
      [/Stok habis/g, 'Out of stock'],
      [/Stok baterai habis!/g, 'Battery out of stock!'],
      [/Stok baterai tidak mencukupi!/g, 'Insufficient battery stock!'],
      [/Transaksi sedang diproses, mohon tunggu\.\.\./g, 'Processing transaction, please wait...'],
      [/Transaksi berhasil/g, 'Transaction successful'],
      [/List kosong\. Klik "Tambah Jam Ini ke List"\./g, 'List is empty. Click "Add Watch to List".'],
      [/Jam berhasil ditambahkan ke list/g, 'Watch added to list'],
      [/Semua servis berhasil disimpan!/g, 'All services saved!'],
      [/Servis sudah diambil, status tidak bisa diubah kembali\./g, 'Service already picked up, status cannot be changed.'],
      [/Pelanggan wajib tanda tangan di kotak terlebih dahulu/g, 'Customer must sign in the box first'],
      [/Isi Nama Produk \/ Jam terlebih dahulu!/g, 'Please enter Product / Watch Name first!'],
      [/Pilih Tipe Baterai terlebih dahulu!/g, 'Please select Battery Type first!'],
      [/Baterai berhasil ditambahkan ke list/g, 'Battery added to list'],
      [/Kas kecil dicatat/g, 'Petty cash recorded'],
      [/Kas dicatat/g, 'Cash entry recorded'],
      [/Produk diperbarui/g, 'Product updated'],
      [/Produk baru ditambahkan/g, 'New product added'],
      [/Disimpan/g, 'Saved'],
      [/Dihapus/g, 'Deleted'],
      [/Tipe wajib/gi, 'Battery type is required'],
      [/Pilih tipe baterai terlebih dahulu!?/gi, 'Please select a battery type first'],
      [/📤 Mengirim pesan WA via API\.\.\./g, '📤 Sending WA message via API...'],
      [/✅ Pesan WA terkirim otomatis via API!/g, '✅ WA message sent automatically via API!'],
      [/Membuat kartu digital\.\.\./g, 'Generating digital warranty card...'],
      [/Kartu digital berhasil dibuat!/g, 'Digital warranty card created!'],
      [/Gagal membuat gambar/g, 'Failed to generate image'],
      [/Garansi servis tidak valid/g, 'Invalid service warranty'],
      [/Servis dihapus & stok\/kas dikembalikan secara atomik/gi, 'Service deleted & stock/cash atomically restored'],
      [/Data baterai tidak valid/g, 'Invalid battery data'],
      [/Library html2canvas belum dimuat/g, 'html2canvas library not loaded'],

      // Attendance & Display
      [/Anda sudah Absen Masuk hari ini!/g, 'You have already clocked in today!'],
      [/Anda belum Absen Masuk hari ini!/g, 'You have not clocked in today!'],
      [/Anda sudah Absen Pulang hari ini!/g, 'You have already clocked out today!'],
      [/✅ Absen Masuk berhasil dicatat!/g, '✅ Clock-in recorded!'],
      [/✅ Absen Pulang berhasil dicatat!/g, '✅ Clock-out recorded!'],
      [/Mode Huruf Besar AKTIF/g, 'Large Font Mode ON'],
      [/Mode Huruf Normal/g, 'Normal Font Mode'],
      [/Pengaturan MDR disimpan!?/gi, 'MDR settings saved!'],
      [/Aturan diskon disimpan!?/gi, 'Discount rules saved!'],
      [/Aturan garansi & baterai disimpan!?/gi, 'Warranty & battery rules saved!'],
      [/Identitas disimpan!?/gi, 'Store identity saved!'],
      [/Pengaturan WhatsApp API disimpan & disinkronkan!?/gi, 'WhatsApp API settings saved & synced!'],
      [/Pengaturan Telegram Bot disimpan!?/gi, 'Telegram Bot settings saved!'],
      [/Logo disimpan, akan tampil di nota/gi, 'Logo saved, it will appear on receipts'],
      [/Logo dihapus/gi, 'Logo removed'],
      [/Mode Bluetooth APK \(RawBT\) diaktifkan! Pastikan aplikasi RawBT sudah terpasang & terhubung ke printer\./g, 'Bluetooth APK (RawBT) mode enabled! Make sure RawBT is installed & connected to the printer.'],
      [/Printer Bluetooth terhubung!/g, 'Bluetooth printer connected!'],
      [/✅ Tes cetak dikirim ke printer!/g, '✅ Test print sent to printer!'],
      [/Mode Cetak Bluetooth AKTIF/g, 'Bluetooth Print Mode ON'],
      [/Mode Preview Struk AKTIF/g, 'Receipt Preview Mode ON'],
      [/Gagal konek Bluetooth:\s*/g, 'Bluetooth connection failed: '],
      [/Hubungkan printer Bluetooth dulu/g, 'Please connect Bluetooth printer first'],
      [/Gagal mencetak:\s*/g, 'Failed to print: '],
      [/Karakteristik tulis ESC\/POS tidak ditemukan pada printer ini\./g, 'ESC/POS write characteristic not found on this printer.'],
      [/✅ Pesan tes berhasil terkirim ke Telegram!/g, '✅ Test message sent to Telegram!'],
      [/File Excel \(CSV\)\s+(.+?)\s+berhasil diunduh!/g, 'Excel (CSV) file for $1 downloaded!'],
      [/Backup penuh \(\.json\) berhasil diunduh!/g, 'Full backup (.json) downloaded!'],

      [/Hak akses menu\s+(\w+)\s+berhasil disimpan!?/gi, 'Menu access for $1 saved!'],
      [/Gagal menyimpan hak akses:\s*/gi, 'Failed to save menu access: '],
      [/Pilih file logo dulu/gi, 'Please choose a logo file first'],

      
      // General Error Prefixes
      [/^Gagal menyimpan:\s*/g, 'Failed to save: '],
      [/^Gagal menghapus:\s*/g, 'Failed to delete: '],
      [/^Gagal:\s*/g, 'Failed: ']
    ];

    let out = msg;
    for (const [rgx, rep] of map) out = out.replace(rgx, rep);
    return out;
  }

    if (typeof window.flash === 'function' && !window.flash.__i18nWrapped) {
    const _flash = window.flash;
    const wrappedFlash = function (text, type) {
      return _flash.call(this, trFlash(text), type);
    };
    wrappedFlash.__i18nWrapped = true;
    window.flash = wrappedFlash;
  }
})();

// === AUTO-TRANSLATE MODAL DINAMIS (Top-Up Kas Kecil, dll.) ===
(function () {
  const modalMap = {
    en: [
      [/ISI SALDO \/ TOP-UP KAS KECIL/gi, 'TOP-UP PETTY CASH BALANCE'],
      [/Nominal Isi Kas Kecil/g, 'Petty Cash Top-Up Amount'],
      [/Contoh:\s*1000000/g, 'e.g. 1000000'],
      [/Isi Ulang \/ Saldo Awal Kas Kecil/g, 'Top-Up / Opening Petty Cash Balance'],
      [/^Keterangan$/g, 'Description'],
      [/^Batal$/g, 'Cancel'],
      [/Simpan Saldo/g, 'Save Balance'],
      [/^300rb$/g, '300k'],
      [/^500rb$/g, '500k'],
      [/^1 Juta$/g, '1M'],
      [/^2 Juta$/g, '2M'],
      [/SERAH TERIMA & TTD PENGAMBILAN/gi, 'PICKUP HANDOVER & SIGNATURE'],
      [/No Servis:/g, 'Service No:'],
      [/Pelanggan:/g, 'Customer:'],
      [/Barang:/g, 'Item:'],
      [/\bLUNAS\b/g, 'PAID'],
      [/Nama Penerima Barang/g, 'Recipient Name'],
      [/Nama yang mengambil barang/g, 'Name of person picking up'],
      [/Tanda Tangan Penerima \(Goreskan di kotak bawah\)/g, 'Recipient Signature (Sign in the box below)'],
      [/Setelah disubmit, struk langsung dicetak & WA konfirmasi dikirim\./g, 'Once submitted, receipt will print & WA confirmation will be sent.'],
      [/Ulangi/g, 'Clear'],
      [/Konfirmasi, Cetak & WA/g, 'Confirm, Print & WA'],
      [/Cari cepat(\.\.\.|…)?/gi, 'Quick search...'],
      [/\bSemua \(/g, 'All ('],
      [/\bstok (\d+)/g, 'stock $1'],
      [/Foto Kondisi Unit \(Opsional, Maks\. 3 Foto\)/g, 'Unit Condition Photos (Optional, Max. 3 Photos)'],
      [/Foto 1 \(Depan\)/g, 'Photo 1 (Front)'],
      [/Foto 2 \(Belakang\)/g, 'Photo 2 (Back)'],
      [/Foto 3 \(Detail\)/g, 'Photo 3 (Detail)'],
      [/Mengunggah\.\.\./g, 'Uploading...'],
      [/Foto kondisi (\d+) tersimpan/g, 'Condition photo $1 saved'],
      [/Gagal upload foto:/g, 'Failed to upload photo:'],

    ],
    zh: [
      [/ISI SALDO \/ TOP-UP KAS KECIL/gi, '零用现金充值'],
      [/Nominal Isi Kas Kecil/g, '零用金充值金额'],
      [/Contoh:\s*1000000/g, '例如：1000000'],
      [/Isi Ulang \/ Saldo Awal Kas Kecil/g, '零用金充值 / 期初余额'],
      [/^Keterangan$/g, '说明'],
      [/^Batal$/g, '取消'],
      [/Simpan Saldo/g, '保存余额'],
      [/^300rb$/g, '30万'],
      [/^500rb$/g, '50万'],
      [/^1 Juta$/g, '100万'],
      [/^2 Juta$/g, '200万'],
      [/SERAH TERIMA & TTD PENGAMBILAN/gi, '取件交接与签名'],
      [/No Servis:/g, '工单号：'],
      [/Pelanggan:/g, '客户：'],
      [/Barang:/g, '物品：'],
      [/\bLUNAS\b/g, '已结清'],
      [/Nama Penerima Barang/g, '取件人姓名'],
      [/Nama yang mengambil barang/g, '请输入取件人姓名'],
      [/Tanda Tangan Penerima \(Goreskan di kotak bawah\)/g, '取件人签名（请在下方框内签名）'],
      [/Setelah disubmit, struk langsung dicetak & WA konfirmasi dikirim\./g, '提交后将自动打印小票并发送 WhatsApp 确认通知。'],
      [/Ulangi/g, '重签'],
      [/Konfirmasi, Cetak & WA/g, '确认、打印并发送 WA'],
      [/Cari cepat(\.\.\.|…)?/gi, '快速搜索...'],
      [/\bSemua \(/g, '全部 ('],
      [/\bstok (\d+)/g, '库存 $1'],
      [/Foto Kondisi Unit \(Opsional, Maks\. 3 Foto\)/g, '手表外观照片（可选，最多3张）'],
      [/Foto 1 \(Depan\)/g, '照片 1（正面）'],
      [/Foto 2 \(Belakang\)/g, '照片 2（背面）'],
      [/Foto 3 \(Detail\)/g, '照片 3（细节）'],
      [/Mengunggah\.\.\./g, '上传中...'],
      [/Foto kondisi (\d+) tersimpan/g, '外观照片 $1 已保存'],
      [/Gagal upload foto:/g, '照片上传失败：'],

    ]
  };

  function translateNode(root) {
    const lang = localStorage.getItem('ta_lang') || localStorage.getItem('horopos_lang') || 'id';
    const rules = modalMap[lang];
    if (rules) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      let n;
      while ((n = walker.nextNode())) {
        let t = n.nodeValue;
        const orig = t;
        for (const [rgx, rep] of rules) t = t.replace(rgx, rep);
        if (t !== orig) n.nodeValue = t;
      }
      root.querySelectorAll('input, textarea').forEach(el => {
        if (el.placeholder) {
          let ph = el.placeholder;
          for (const [rgx, rep] of rules) ph = ph.replace(rgx, rep);
          el.placeholder = ph;
        }
        if (el.value) {
          let v = el.value;
          for (const [rgx, rep] of rules) v = v.replace(rgx, rep);
          if (v !== el.value) el.value = v;
        }
      });
    }
    if (typeof terapkanMataUangUI === 'function') terapkanMataUangUI();
  }

  new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && node.tagName === 'DIV') {
          translateNode(node);
        }
      }
    }
  }).observe(document.body, { childList: true });
})();

// === AUTO-TRANSLATE QUICK-TEXT KELUHAN & KONDISI FISIK (ID <-> EN <-> ZH) ===
(function () {
  const quickDict = [
    // [Indonesia, English, Mandarin]
    ['Mati total', 'Dead / Not running', '手表停走'],
    ['Servis lengkap', 'Full overhaul', '全面保养'],
    ['Ganti baterai', 'Battery replacement', '更换电池'],
    ['Ganti kaca', 'Crystal replacement', '更换表镜'],
    ['Ganti tali', 'Strap replacement', '更换表带'],
    ['Potong rantai', 'Bracelet resize', '截表带'],
    ['Ganti springbar', 'Springbar replacement', '换生耳'],
    ['Kemasukan air', 'Water damage', '进水'],
    ['Berembun', 'Foggy / Moisture', '起雾'],
    ['Jalan lambat', 'Running slow', '走时偏慢'],
    ['Jalan cepat', 'Running fast', '走时偏快'],
    ['Crown lepas', 'Loose crown', '表冠脱落'],
    ['Jarum lepas', 'Loose hands', '指针脱落'],
    ['Polishing', 'Polishing', '抛光翻新'],

    // Kondisi Fisik
    ['Kaca Baret', 'Scratched Crystal', '表镜划痕'],
    ['Kaca Retak', 'Cracked Crystal', '表镜裂纹'],
    ['Kaca Pecah', 'Broken Crystal', '表镜破碎'],
    ['Casing Baret', 'Scratched Case', '表壳划痕'],
    ['Rantai Baret', 'Scratched Bracelet', '表带划痕'],
    ['Mesin Mati', 'Movement Dead', '机芯停走'],
    ['Mesin Berkarat', 'Rusted Movement', '机芯生锈'],
    ['Crown Hilang', 'Missing Crown', '表冠缺失'],
    ['Tanpa Tali', 'No Strap', '无表带'],
    ['Mulus', 'Good Condition', '外观完好']
  ];

  function trQuickText(root) {
    if (!root) return;
    const lang = localStorage.getItem('ta_lang') || localStorage.getItem('horopos_lang') || 'id';
    const targetIdx = lang === 'en' ? 1 : (lang === 'zh' ? 2 : 0);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.parentElement || ['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA'].includes(n.parentElement.tagName)) continue;
      let t = n.nodeValue;
      const orig = t;
      for (const row of quickDict) {
        const target = row[targetIdx];
        for (let i = 0; i < 3; i++) {
          if (i === targetIdx) continue;
          const esc = row[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const rgx = new RegExp(esc, 'gi');
          if (rgx.test(t)) t = t.replace(rgx, target);
        }
      }
      if (t !== orig) n.nodeValue = t;
    }
  }

  const area = document.getElementById('listServis') || document.body;
  new MutationObserver(() => trQuickText(area)).observe(area, { childList: true, subtree: true });

  if (typeof window.terapkanBahasa === 'function') {
    const _orig = window.terapkanBahasa;
    window.terapkanBahasa = function () {
      _orig.apply(this, arguments);
      trQuickText(document.getElementById('listServis') || document.body);
    };
  }
})();

// === AUTO-TRANSLATE KARTU E-WARRANTY SEBELUM RENDER PNG ===
(function () {
  const cardDict = {
    en: [
      [/KARTU GARANSI SERVIS/gi, 'SERVICE E-WARRANTY CARD'],
      [/KARTU GARANSI BATERAI/gi, 'BATTERY E-WARRANTY CARD'],
      [/GARANSI SERVIS/gi, 'SERVICE WARRANTY'],
      [/GARANSI BATERAI/gi, 'BATTERY WARRANTY'],
      [/^Pelanggan$/g, 'Customer'],
      [/^Produk \/ Jam$/g, 'Product / Watch'],
      [/^Tanggal Mulai$/g, 'Start Date'],
      [/^Berlaku Sampai$/g, 'Valid Until']
    ],
    zh: [
      [/KARTU GARANSI SERVIS/gi, '手表维修电子保修卡'],
      [/KARTU GARANSI BATERAI/gi, '电池更换电子保修卡'],
      [/GARANSI SERVIS/gi, '维修保修'],
      [/GARANSI BATERAI/gi, '电池保修'],
      [/^Pelanggan$/g, '客户'],
      [/^Produk \/ Jam$/g, '商品 / 手表'],
      [/^Tanggal Mulai$/g, '开始日期'],
      [/^Berlaku Sampai$/g, '有效期至']
    ]
  };

  function patchHtml2Canvas() {
    if (typeof window.html2canvas !== 'function' || window.html2canvas.__i18nPatched) return;
    const _h2c = window.html2canvas;
    window.html2canvas = function (el, opts) {
      const lang = localStorage.getItem('ta_lang') || localStorage.getItem('horopos_lang') || 'id';
      const rules = cardDict[lang];
      if (el && rules) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        let n;
        while ((n = walker.nextNode())) {
          let t = n.nodeValue.trim();
          if (!t) continue;
          let out = n.nodeValue;
          for (const [rgx, rep] of rules) out = out.replace(rgx, rep);
          if (out !== n.nodeValue) n.nodeValue = out;
        }
      }
      return _h2c.call(this, el, opts);
    };
    window.html2canvas.__i18nPatched = true;
  }

  patchHtml2Canvas();
  window.addEventListener('load', patchHtml2Canvas);
})();

// === AUTO-TRANSLATE MODAL PELUNASAN & PREVIEW NOTA ===
(function () {
  const MAP_EN = [
    [/PELUNASAN SERVIS/g, 'SERVICE BALANCE PAYMENT'],
    [/\(SISA:/g, '(BALANCE:'],
    [/Metode Pembayaran/g, 'Payment Method'],
    [/^Tunai$/g, 'Cash'],
    [/Debit Bank Lain/g, 'Other Bank Debit'],
    [/Nominal Bayar/g, 'Payment Amount'],
    [/^Lanjutkan$/g, 'Continue'],
    [/Preview Nota \/ Struk/g, 'Receipt / Ticket Preview'],
    [/✕ Kembali/g, '✕ Back'],
    [/\bKlaim\s*\(/g, 'Claim ('],
    [/\bKeluhan:/g, 'Issue:'],
    [/\bBiaya:/g, 'Cost:'],
    [/Hitung Stok Fisik/g, 'Physical Stock Count'],
    [/Hitung barang di rak lalu isi jumlahnya di sini\./g, 'Count items on the shelf and enter the quantities here.'],
    [/Hasil ini hanya draft/g, 'This result is a draft only'],
    [/untuk dicocokkan Admin\/Pemilik — jumlahnya tidak langsung mengubah stok\./g, 'for Admin/Owner verification — quantities do not immediately change stock.'],
    [/^JAM$/g, 'WATCH'],
    [/^BATERAI$/g, 'BATTERY'],
    [/Kirim Hasil Hitung/g, 'Submit Count Result'],
    [/\bRIWAYAT:/gi, 'HISTORY:'],
    [/Belum ada riwayat\./g, 'No history yet.'],
    [/Memproses\.\.\./gi, 'Processing...'],
    [/Menyimpan\.\.\./gi, 'Saving...'],
    [/Status: Gagal menghubungkan/gi, 'Status: Connection failed'],
    [/Pop-up diblokir browser\. Izinkan pop-up untuk mencetak barcode\./gi, 'Pop-up blocked by browser. Allow pop-ups to print barcode.'],
    [/Periode Laba Rugi & Arus Kas:/g, 'Profit & Loss & Cash Flow Period:'],
    [/\(Neraca menampilkan posisi saat ini\)\./g, '(Balance Sheet shows current position).'],
    [/\bJanuari (\d{4})/g, 'January $1'],
    [/\bFebruari (\d{4})/g, 'February $1'],
    [/\bMaret (\d{4})/g, 'March $1'],
    [/\bMei (\d{4})/g, 'May $1'],
    [/\bJuni (\d{4})/g, 'June $1'],
    [/\bJuli (\d{4})/g, 'July $1'],
    [/\bAgustus (\d{4})/g, 'August $1'],
    [/\bOktober (\d{4})/g, 'October $1'],
    [/\bDesember (\d{4})/g, 'December $1'],
    [/Pilih Cepat \(Grid\)/g, 'Quick Select (Grid)'],
    [/Pilih Item/g, 'Select Item'],
    [/⚠️ Tipis/g, '⚠️ Low'],
    [/Tidak ada item cocok/g, 'No matching items'],
    [/Mengunggah foto ke Cloudinary\.\.\./g, 'Uploading photo to Cloudinary...'],
    [/Foto siap disimpan/g, 'Photo ready to save'],
    [/Gagal upload foto:/g, 'Failed to upload photo:'],
    [/Upload gagal/g, 'Upload failed'],
    [/Cari cepat\.\.\./gi, 'Quick search...'],
    [/\bSemua \(/g, 'All ('],
    [/\bstok (\d+)/g, 'stock $1'],
    [/Klaim dibatalkan: Kode klaim wajib diisi/g, 'Claim cancelled: Claim code is required'],
    [/Kode klaim tidak cocok/g, 'Invalid claim code'],
    [/Kuota klaim sudah habis/g, 'Claim quota exhausted'],
    [/Kode klaim valid! Sisa kuota:/g, 'Valid claim code! Remaining quota:'],
    [/Batas pengeluaran kas kecil harian \(Rp500\.000\) terlampaui\. Terpakai hari ini:/g, 'Daily petty cash expense limit (Rp500,000) exceeded. Used today:'],
    [/WA E-Warranty gagal terkirim via Fonnte \(fallback diblokir demi keamanan\)/g, 'E-Warranty WA failed to send via Fonnte (fallback blocked for security)'],
    [/ALERT KLAIM GARANSI \/ Rp 0/g, 'WARRANTY CLAIM / Rp 0 ALERT'],
    [/KLAIM PRODUK/g, 'PRODUCT CLAIM'],
    [/KLAIM SERVIS/g, 'SERVICE CLAIM'],
    [/SERVIS Rp 0/g, 'Rp 0 SERVICE'],
    [/Oleh:/g, 'By:'],
    [/Part\/Bat:/g, 'Parts/Batt:'],
    [/Tidak ada/g, 'None'],
    [/Keluhan:/g, 'Issue:'],
    [/KAS KECIL \(KELUAR\)/g, 'PETTY CASH (OUT)'],
    [/KAS KECIL \(MASUK\)/g, 'PETTY CASH (IN)'],
    [/Total keluar hari ini:/g, 'Total out today:'],
    [/Nominal:/g, 'Amount:'],
    [/Ket:/g, 'Note:'],

  ];

  const MAP_ZH = [
    [/PELUNASAN SERVIS/g, '维修余款结算'],
    [/\(SISA:/g, '（余款：'],
    [/Metode Pembayaran/g, '支付方式'],
    [/^Tunai$/g, '现金'],
    [/Debit Bank Lain/g, '其他银行借记卡'],
    [/Nominal Bayar/g, '支付金额'],
    [/^Lanjutkan$/g, '继续'],
    [/Preview Nota \/ Struk/g, '小票 / 工单预览'],
    [/✕ Kembali/g, '✕ 返回'],
    [/\bKlaim\s*\(/g, '保修索赔 ('],
    [/\bKeluhan:/g, '故障：'],
    [/\bBiaya:/g, '费用：'],
    [/Hitung Stok Fisik/g, '实物库存盘点'],
    [/Hitung barang di rak lalu isi jumlahnya di sini\./g, '清点货架上的商品并在此填入数量。'],
    [/Hasil ini hanya draft/g, '此结果仅为草稿'],
    [/untuk dicocokkan Admin\/Pemilik — jumlahnya tidak langsung mengubah stok\./g, '供管理员/店主核对 — 不会直接更改库存。'],
    [/^JAM$/g, '手表'],
    [/^BATERAI$/g, '电池'],
    [/Kirim Hasil Hitung/g, '提交盘点结果'],
    [/\bRIWAYAT:/gi, '历史记录：'],
    [/Belum ada riwayat\./g, '暂无历史记录。'],
    [/Memproses\.\.\./gi, '处理中...'],
    [/Menyimpan\.\.\./gi, '保存中...'],
    [/Status: Gagal menghubungkan/gi, '状态：连接失败'],
    [/Pop-up diblokir browser\. Izinkan pop-up untuk mencetak barcode\./gi, '浏览器拦截了弹窗。请允许弹窗以打印条形码。'],
    [/Periode Laba Rugi & Arus Kas:/g, '损益表及现金流量表期间：'],
    [/\(Neraca menampilkan posisi saat ini\)\./g, '（资产负债表显示当前累计位置）。'],
    [/\bJanuari (\d{4})/g, '$1年1月'],
    [/\bFebruari (\d{4})/g, '$1年2月'],
    [/\bMaret (\d{4})/g, '$1年3月'],
    [/\bApril (\d{4})/g, '$1年4月'],
    [/\bMei (\d{4})/g, '$1年5月'],
    [/\bJuni (\d{4})/g, '$1年6月'],
    [/\bJuli (\d{4})/g, '$1年7月'],
    [/\bAgustus (\d{4})/g, '$1年8月'],
    [/\bSeptember (\d{4})/g, '$1年9月'],
    [/\bOktober (\d{4})/g, '$1年10月'],
    [/\bNovember (\d{4})/g, '$1年11月'],
    [/\bDesember (\d{4})/g, '$1年12月'],
    [/Pilih Cepat \(Grid\)/g, '快速选择 (网格)'],
    [/Pilih Item/g, '选择项目'],
    [/⚠️ Tipis/g, '⚠️ 库存低'],
    [/Tidak ada item cocok/g, '没有匹配的项目'],
    [/Mengunggah foto ke Cloudinary\.\.\./g, '正在上传照片到 Cloudinary...'],
    [/Foto siap disimpan/g, '照片已准备好保存'],
    [/Gagal upload foto:/g, '照片上传失败：'],
    [/Upload gagal/g, '上传失败'],
    [/Cari cepat\.\.\./gi, '快速搜索...'],
    [/\bSemua \(/g, '全部 ('],
    [/\bstok (\d+)/g, '库存 $1'],
    [/Klaim dibatalkan: Kode klaim wajib diisi/g, '索赔已取消：必须填写索赔码'],
    [/Kode klaim tidak cocok/g, '索赔码不匹配'],
    [/Kuota klaim sudah habis/g, '索赔次数已用完'],
    [/Kode klaim valid! Sisa kuota:/g, '索赔码有效！剩余次数：'],
    [/Batas pengeluaran kas kecil harian \(Rp500\.000\) terlampaui\. Terpakai hari ini:/g, '已超出每日备用金支出限额（Rp500,000）。今日已用：'],
    [/WA E-Warranty gagal terkirim via Fonnte \(fallback diblokir demi keamanan\)/g, '电子保修单通过 Fonnte 发送 WhatsApp 失败（出于安全原因已阻止备用方式）'],
    [/ALERT KLAIM GARANSI \/ Rp 0/g, '保修索赔 / Rp 0 提醒'],
    [/KLAIM PRODUK/g, '产品保修索赔'],
    [/KLAIM SERVIS/g, '维修保修索赔'],
    [/SERVIS Rp 0/g, 'Rp 0 维修'],
    [/Oleh:/g, '操作员：'],
    [/Part\/Bat:/g, '配件/电池：'],
    [/Tidak ada/g, '无'],
    [/Keluhan:/g, '故障描述：'],
    [/KAS KECIL \(KELUAR\)/g, '备用金（支出）'],
    [/KAS KECIL \(MASUK\)/g, '备用金（收入）'],
    [/Total keluar hari ini:/g, '今日累计支出：'],
    [/Nominal:/g, '金额：'],
    [/Ket:/g, '备注：'],

  ];

    function applyRules(node, rules) {
    const orig = node.nodeValue;
    if (!orig || !/[a-zA-Z]/.test(orig)) return; // Lewati angka, spasi, & teks Mandarin
    let next = orig;
    for (let i = 0; i < rules.length; i++) {
      next = next.replace(rules[i][0], rules[i][1]);
    }
    if (next !== orig) node.nodeValue = next;
  }

  function translateNodes(root, rules) {
    if (!root) return;
    if (root.nodeType === 3) {
      applyRules(root, rules);
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const tag = n.parentNode && n.parentNode.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) applyRules(node, rules);
  }

  let queue = new Set();
  let scheduled = false;

  function flushQueue() {
    scheduled = false;
    const lang = localStorage.getItem('ta_lang') || localStorage.getItem('horopos_lang') || 'id';
    if (lang === 'id') { queue.clear(); return; }
    const rules = lang === 'zh' ? MAP_ZH : MAP_EN;

    const nodes = Array.from(queue);
    queue.clear();
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].isConnected) translateNodes(nodes[i], rules);
    }
  }

  const obs = new MutationObserver(muts => {
    for (let i = 0; i < muts.length; i++) {
      const added = muts[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        const n = added[j];
        if (n.nodeType === 1 || n.nodeType === 3) queue.add(n);
      }
    }
    if (queue.size && !scheduled) {
      scheduled = true;
      requestAnimationFrame(flushQueue);
    }
  });

  obs.observe(document.body, { childList: true, subtree: true });
  queue.add(document.body);
  flushQueue();
})();

  // === KAMUS LENGKAP POP-UP FLASH (EN & ZH) ===
(function () {
  const _prevTrFlash = typeof window.trFlash === 'function' ? window.trFlash : (s => s);

  const EXACT = {
    'Pilih rekening bank tujuan terlebih dahulu untuk transaksi non-tunai': ['Select a destination bank account first for non-cash transactions', '非现金交易请先选择收款银行账户'],
    'Pilih rekening bank terlebih dahulu': ['Select a bank account first', '请先选择银行账户'],
    'Nominal harus lebih dari 0': ['Amount must be greater than 0', '金额必须大于 0'],
    'Username dan password wajib diisi': ['Username and password are required', '用户名和密码为必填项'],
    'Akses ditolak.': ['Access denied.', '访问被拒绝。'],
    'Akses ditolak': ['Access denied', '访问被拒绝'],
    'Akses ditolak. Hanya Admin yang bisa mengubah produk.': ['Access denied. Only Admin can edit products.', '访问被拒绝。仅管理员可修改产品。'],
    'Akses ditolak. Hanya Admin/Pemilik yang bisa menghapus.': ['Access denied. Only Admin/Owner can delete.', '访问被拒绝。仅管理员/店主可删除。'],
    'Lengkapi kolom wajib': ['Please fill in all required fields', '请填写所有必填项'],
    'Harga/stok tidak boleh negatif': ['Price/stock cannot be negative', '价格/库存不能为负数'],
    'Barcode sudah dipakai produk lain': ['Barcode is already used by another product', '该条形码已被其他产品使用'],
    'Produk diperbarui': ['Product updated', '产品已更新'],
    'Produk baru ditambahkan': ['New product added', '已添加新产品'],
    'Hanya Pemilik yang bisa menghapus produk': ['Only Owner can delete products', '仅店主可删除产品'],
    'Dihapus': ['Deleted', '已删除'],
    'Data tidak valid': ['Invalid data', '数据无效'],
    'Item tidak ditemukan': ['Item not found', '未找到项目'],
    'Hutang tidak ditemukan / sudah lunas': ['Debt not found / already paid', '未找到欠款或已结清'],
    'Hutang dilunasi': ['Debt paid off', '欠款已结清'],
    'Pilih produk': ['Select a product', '请选择产品'],
    'Qty tidak valid': ['Invalid quantity', '数量无效'],
    'Stok tidak cukup': ['Insufficient stock', '库存不足'],
    'Stok tidak mencukupi!': ['Insufficient stock!', '库存不足！'],
    'Stok habis': ['Out of stock', '已售罄'],
    'Transaksi sedang diproses, mohon tunggu...': ['Processing transaction, please wait...', '正在处理交易，请稍候...'],
    'Keranjang kosong': ['Cart is empty', '购物车为空'],
    'Uang kurang': ['Insufficient payment', '支付金额不足'],
    'Transaksi berhasil': ['Transaction successful', '交易成功'],
    'Lengkapi Nama dan Produk': ['Please fill in Name and Product', '请填写姓名和产品'],
    'Kuota klaim garansi untuk nota ini sudah habis': ['Warranty claim quota for this ticket has been used up', '该维修单的保修索赔次数已用完'],
    'Kuota klaim garansi produk untuk nota ini sudah habis': ['Product warranty claim quota for this receipt has been used up', '该小票的产品保修索赔次数已用完'],
    'Jam berhasil ditambahkan ke list': ['Watch added to list', '手表已添加到列表'],
    'List kosong. Klik "Tambah Jam Ini ke List".': ['List is empty. Click "Add Watch to Ticket List".', '列表为空。请点击“添加此手表到列表”。'],
    'Semua servis berhasil disimpan!': ['All service tickets saved!', '所有维修单已保存！'],
    'Jalankan migrasi_perbaikan_keamanan.sql di Supabase terlebih dahulu.': ['Run migrasi_perbaikan_keamanan.sql in Supabase first.', '请先在 Supabase 运行安全迁移 SQL。'],
    'Servis sudah diambil, status tidak bisa diubah kembali.': ['Service already picked up, status cannot be changed.', '维修手表已取走，状态无法更改。'],
    'Lunasi sisa tagihan dulu sebelum jam diambil.': ['Please pay the remaining balance before pickup.', '取件前请先结清余款。'],
    'Servis dihapus & stok/kas dikembalikan secara atomik': ['Service deleted & stock/cash atomically restored', '维修单已删除，库存与现金已自动回滚'],
    'Tidak bisa diklaim': ['Cannot be claimed', '无法申请保修'],
    'Klaim dibatalkan': ['Claim cancelled', '索赔已取消'],
    'Tipe wajib': ['Type is required', '类型为必填项'],
    'Stok baterai berhasil ditambahkan': ['Battery stock added', '电池库存已添加'],
    'Data klaim terisi otomatis. Pastikan tipe baterai lalu klik tambah ke list.': ['Claim data auto-filled. Verify battery type then click Add to List.', '索赔信息已自动填充。请确认电池型号后点击添加到列表。'],
    'Isi Nama Produk / Jam terlebih dahulu!': ['Enter Product / Watch Name first!', '请先填写产品/手表名称！'],
    'Pilih Tipe Baterai terlebih dahulu!': ['Select Battery Type first!', '请先选择电池型号！'],
    'Pilih tipe baterai terlebih dahulu': ['Select battery type first', '请先选择电池型号'],
    'Data baterai tidak ditemukan!': ['Battery data not found!', '未找到电池数据！'],
    'Data baterai tidak ditemukan': ['Battery data not found', '未找到电池数据'],
    'Stok baterai habis!': ['Battery out of stock!', '电池已售罄！'],
    'Stok baterai tidak mencukupi!': ['Insufficient battery stock!', '电池库存不足！'],
    'Baterai berhasil ditambahkan ke list': ['Battery added to list', '电池已添加到列表'],
    'Nama Pelanggan wajib diisi': ['Customer Name is required', '客户姓名为必填项'],
    'Keranjang baterai masih kosong': ['Battery cart is empty', '电池购物车为空'],
    'Hanya Pemilik yang bisa menghapus': ['Only Owner can delete', '仅店主可删除'],
    'Data baterai diperbarui': ['Battery data updated', '电池数据已更新'],
    'Tipe baterai dihapus': ['Battery type deleted', '电池型号已删除'],
    'Lengkapi nominal & keterangan': ['Please fill in amount & description', '请填写金额和说明'],
    'Nominal tidak valid': ['Invalid amount', '金额无效'],
    'Kas dicatat': ['Cash entry recorded', '现金记录已保存'],
    'Nama bank wajib': ['Bank name is required', '银行名称为必填项'],
    'Rekening ditambahkan': ['Bank account added', '银行账户已添加'],
    'Saldo Awal berhasil diperbarui': ['Opening balance updated', '期初余额已更新'],
    'Rekening berhasil dihapus': ['Bank account deleted', '银行账户已删除'],
    'Rekonsiliasi selesai. Saldo sudah sesuai 100%.': ['Reconciliation complete. Balance matches 100%.', '对账完成。余额 100% 一致。'],
    'Alasan penyesuaian wajib diisi': ['Adjustment reason is required', '调整原因为必填项'],
    'Nominal harus antara Rp1 - Rp500.000': ['Amount must be between Rp1 - Rp500,000', '金额必须在 Rp1 - Rp500,000 之间'],
    'Keterangan wajib diisi': ['Description is required', '说明为必填项'],
    'Kas kecil dicatat': ['Petty cash recorded', '零用现金已记录'],
    'Hanya Pemilik yang bisa menghapus transaksi penjualan': ['Only Owner can delete sales transactions', '仅店主可删除销售记录'],
    'Transaksi penjualan dihapus, stok dikembalikan': ['Sales transaction deleted, stock restored', '销售记录已删除，库存已恢复'],
    'Transaksi kas berhasil dihapus': ['Cash transaction deleted', '现金记录已删除'],
    'Hanya Pemilik yang bisa mengubah pengaturan.': ['Only Owner can change settings.', '仅店主可修改设置。'],
    '🖨️ Mengirim struk ke Printer Bluetooth (RawBT)...': ['🖨️ Sending receipt to Bluetooth Printer (RawBT)...', '🖨️ 正在发送小票至蓝牙打印机 (RawBT)...'],
    '🖨️ Struk dicetak via Bluetooth': ['🖨️ Receipt printed via Bluetooth', '🖨️ 小票已通过蓝牙打印'],
    'Print sistem tidak tersedia di perangkat ini. Gunakan tombol Bluetooth (RawBT).': ['System print unavailable on this device. Use Bluetooth (RawBT).', '此设备不支持系统打印，请使用蓝牙 (RawBT)。'],
    'Catatan audit wajib diisi': ['Audit notes are required', '盘点备注为必填项'],
    'Belum ada stok fisik yang diisi': ['No physical stock entered yet', '尚未填写实际库存'],
    'Pilih foto produk terlebih dahulu': ['Select a product photo first', '请先选择产品照片'],
    'Library OCR belum dimuat': ['OCR library not loaded yet', 'OCR 组件尚未加载'],
    'Memproses gambar dengan AI...': ['Processing image with AI...', '正在使用 AI 处理图片...'],
    'AI tidak menemukan teks.': ['AI found no text.', 'AI 未识别到文字。'],
    'AI berhasil membaca teks!': ['AI read text successfully!', 'AI 文字识别成功！'],
    'Gagal memproses gambar': ['Failed to process image', '图片处理失败'],
    'Library html2canvas belum dimuat': ['html2canvas library not loaded yet', 'html2canvas 组件尚未加载'],
    'Garansi servis tidak valid': ['Invalid service warranty', '维修保修无效'],
    'Data baterai tidak valid': ['Invalid battery data', '电池数据无效'],
    'Membuat kartu digital...': ['Generating digital card...', '正在生成电子保修卡...'],
    'Kartu digital berhasil dibuat!': ['Digital card created!', '电子保修卡生成成功！'],
    'Gagal membuat gambar': ['Failed to generate image', '生成图片失败'],
    '📤 Mengirim pesan WA via API...': ['📤 Sending WhatsApp message via API...', '📤 正在通过 API 发送 WhatsApp 消息...'],
    '✅ Pesan WA terkirim otomatis via API!': ['✅ WhatsApp message sent automatically via API!', '✅ WhatsApp 消息已通过 API 自动发送！'],
    'Isi No WA Toko di menu Setting terlebih dahulu': ['Set Store WhatsApp number in Settings first', '请先在设置中填写店铺 WhatsApp 号码'],
    'Belum ada garansi': ['No warranty yet', '暂无保修'],
    'Pelanggan dihapus': ['Customer deleted', '客户已删除'],
    'Sparepart baru ditambahkan': ['New spare part added', '已添加新配件'],
    'Sparepart diperbarui': ['Spare part updated', '配件已更新'],
    'Sparepart dihapus': ['Spare part deleted', '配件已删除'],
    'Gagal menghapus! Sparepart ini mungkin sudah dipakai di transaksi servis.': ['Delete failed! This spare part may be used in a service ticket.', '删除失败！该配件可能已在维修单中使用。'],
    'Nama wajib diisi': ['Name is required', '名称为必填项'],
    'Disimpan': ['Saved', '已保存'],
    'Nota ini tidak bisa diklaim (kuota habis atau tidak ada garansi)': ['This ticket cannot be claimed (quota used up or no warranty)', '此单据无法索赔（次数已用完或无保修）'],
    'Mode klaim garansi produk aktif. Isi keluhan lalu "Tambah Jam Ini ke List".': ['Product warranty claim mode active. Enter issue then click "Add Watch to Ticket List".', '产品保修索赔模式已开启。请填写故障后点击“添加此手表到列表”。'],
    'Isi dulu minimal 1 jumlah barang': ['Enter at least 1 item quantity first', '请先填写至少 1 件商品数量'],
    'Tambahkan supplier dulu di bagian atas halaman ini': ['Add a supplier at the top of this page first', '请先在页面顶部添加供应商'],
    'Pilih minimal 1 barang': ['Select at least 1 item', '请至少选择 1 件商品'],
    'Qty harus minimal 1': ['Quantity must be at least 1', '数量至少为 1'],
    'Hanya Pemilik yang bisa mengatur daftar beban': ['Only Owner can manage expenses', '仅店主可管理费用列表'],
    'Nama beban wajib diisi': ['Expense name is required', '费用名称为必填项'],
    'Tanggal jatuh tempo harus 1-31': ['Due date must be between 1-31', '到期日必须在 1-31 之间'],
    'Beban tetap ditambahkan': ['Fixed expense added', '已添加固定费用'],
    'Hanya Pemilik yang bisa mengubah beban': ['Only Owner can edit expenses', '仅店主可修改费用'],
    'Nominal / tanggal tidak valid': ['Invalid amount / date', '金额或日期无效'],
    'Beban diperbarui': ['Expense updated', '费用已更新'],
    'Hanya Pemilik yang bisa menghapus beban': ['Only Owner can delete expenses', '仅店主可删除费用'],
    'Beban dihapus dari daftar': ['Expense removed from list', '费用已从列表中删除'],
    'Hanya Pemilik yang bisa mengubah logo': ['Only Owner can change logo', '仅店主可更改标志'],
    'File logo tidak valid (harus PNG/JPEG/WEBP)': ['Invalid logo file (must be PNG/JPEG/WEBP)', '标志文件无效（须为 PNG/JPEG/WEBP）'],
    'Logo terlalu besar, gunakan gambar yang lebih sederhana': ['Logo is too large, use a simpler image', '标志文件过大，请使用更简洁的图片'],
    'Pilih file logo dulu': ['Select a logo file first', '请先选择标志文件'],
    'Khusus Pemilik': ['Owner only', '仅限店主'],
    'Sedang mode klaim garansi (jasa otomatis Rp 0)': ['Warranty claim mode active (service fee auto Rp 0)', '保修索赔模式（维修费自动为 0）'],
    'Hanya Pemilik yang bisa menghapus riwayat audit': ['Only Owner can delete audit history', '仅店主可删除盘点记录'],
    'Riwayat audit berhasil dihapus': ['Audit history deleted', '盘点记录已删除'],
    'Produk tidak ditemukan': ['Product not found', '未找到产品'],
    'Hanya Admin/Pemilik yang bisa mengisi saldo kas kecil': ['Only Admin/Owner can top up petty cash', '仅管理员/店主可充值零用现金'],
    'Masukkan jumlah uang tunai fisik di laci': ['Enter physical cash amount in drawer', '请输入抽屉内的实际现金金额'],
    'Laporan Tutup Kasir berhasil dicatat!': ['Shift closing report recorded!', '收银交班报表已记录！'],
    'Isi No WA Toko di Setting dulu untuk kirim laporan WA': ['Set Store WhatsApp number in Settings first to send report', '请先在设置中填写店铺 WhatsApp 号码以发送报表'],
    'Hanya Pemilik yang bisa mengekspor backup data': ['Only Owner can export backup data', '仅店主可导出备份数据'],
    'Hanya Pemilik yang bisa mengunduh backup penuh': ['Only Owner can download full backup', '仅店主可下载完整备份'],
    'Backup penuh (.json) berhasil diunduh!': ['Full backup (.json) downloaded!', '完整备份 (.json) 已下载！'],
    'Mode Bluetooth APK (RawBT) diaktifkan! Pastikan aplikasi RawBT sudah terpasang & terhubung ke printer.': ['Bluetooth APK (RawBT) mode enabled! Ensure RawBT app is installed & connected.', '蓝牙 APK (RawBT) 模式已开启！请确保已安装并连接 RawBT 打印机。'],
    'Printer Bluetooth terhubung!': ['Bluetooth printer connected!', '蓝牙打印机已连接！'],
    'Hubungkan printer Bluetooth dulu': ['Connect Bluetooth printer first', '请先连接蓝牙打印机'],
    '✅ Tes cetak dikirim ke printer!': ['✅ Test print sent to printer!', '✅ 测试打印已发送至打印机！'],
    'Pengaturan WhatsApp API disimpan & disinkronkan!': ['WhatsApp API settings saved & synced!', 'WhatsApp API 设置已保存并同步！'],
    'Isi No WA Toko di Identitas Toko dulu': ['Fill in Store WhatsApp in Store Identity first', '请先在店铺信息中填写 WhatsApp 号码'],
    'Nama penerima wajib diisi': ['Recipient name is required', '领取人姓名为必填项'],
    'Pelanggan wajib tanda tangan di kotak terlebih dahulu': ['Customer must sign in the box first', '客户必须先在签名框内签名'],
    '✅ Servis resmi diambil! Mencetak struk & mengirim WA...': ['✅ Service picked up! Printing receipt & sending WA...', '✅ 维修已取件！正在打印小票并发送 WhatsApp...'],
    'Pengaturan Telegram Bot disimpan!': ['Telegram Bot settings saved!', 'Telegram 机器人设置已保存！'],
    'Isi Bot Token dan Chat ID terlebih dahulu': ['Enter Bot Token and Chat ID first', '请先填写 Bot Token 和 Chat ID'],
    '✅ Pesan tes berhasil terkirim ke Telegram!': ['✅ Test message sent to Telegram!', '✅ 测试消息已发送至 Telegram！'],
    'Gagal kirim Telegram. Cek Bot Token & Chat ID.': ['Failed to send Telegram. Check Bot Token & Chat ID.', '发送 Telegram 失败，请检查 Bot Token 和 Chat ID。'],
    'Anda sudah Absen Masuk hari ini!': ['You have already clocked in today!', '您今天已经打过上班卡了！'],
    '✅ Absen Masuk berhasil dicatat!': ['✅ Clock-in recorded!', '✅ 上班打卡成功！'],
    'Anda belum Absen Masuk hari ini!': ['You have not clocked in today!', '您今天尚未打上班卡！'],
    'Anda sudah Absen Pulang hari ini!': ['You have already clocked out today!', '您今天已经打过下班卡了！'],
    '✅ Absen Pulang berhasil dicatat!': ['✅ Clock-out recorded!', '✅ 下班打卡成功！'],
    'Nama tidak boleh kosong': ['Name cannot be empty', '名称不能为空'],
    'Hanya Pemilik yang bisa mengubah hak akses.': ['Only Owner can change access permissions.', '仅店主可修改权限。']
  };

  const REGEX_RULES = [
    // Prefix error / status dinamis
    [/^Gagal menyimpan produk:\s*/i, 'Failed to save product: ', '保存产品失败：'],
    [/^Gagal menghapus \(produk mungkin sudah ada di transaksi\):\s*/i, 'Delete failed (product may exist in transactions): ', '删除失败（产品可能已关联交易）：'],
    [/^Gagal menghapus \(mungkin sudah dipakai di transaksi\):\s*/i, 'Delete failed (may be used in transactions): ', '删除失败（可能已关联交易）：'],
    [/^Gagal restock:\s*/i, 'Restock failed: ', '补货失败：'],
    [/^Gagal melunasi hutang:\s*/i, 'Failed to pay debt: ', '结清欠款失败：'],
    [/^Transaksi tersimpan, tetapi struk gagal dicetak:\s*/i, 'Transaction saved, but receipt print failed: ', '交易已保存，但打印小票失败：'],
    [/^Servis tersimpan, tetapi nota gagal dicetak:\s*/i, 'Service saved, but ticket print failed: ', '维修单已保存，但打印失败：'],
    [/^Data tersimpan, tetapi struk gagal dicetak:\s*/i, 'Data saved, but receipt print failed: ', '数据已保存，但打印小票失败：'],
    [/^Gagal melunasi:\s*/i, 'Payment failed: ', '结算失败：'],
    [/^Gagal ubah status:\s*/i, 'Failed to update status: ', '更新状态失败：'],
    [/^Gagal menghapus:\s*/i, 'Delete failed: ', '删除失败：'],
    [/^Gagal menyimpan:\s*/i, 'Save failed: ', '保存失败：'],
    [/^Gagal mengirim ke RawBT:\s*/i, 'Failed to send to RawBT: ', '发送至 RawBT 失败：'],
    [/^Gagal audit:\s*/i, 'Audit failed: ', '盘点失败：'],
    [/^Gagal menyimpan barcode untuk (.+?):\s*/i, 'Failed to save barcode for $1: ', '保存 $1 的条形码失败：'],
    [/^Gagal menyimpan barcode:\s*/i, 'Failed to save barcode: ', '保存条形码失败：'],
    [/^Gagal mengirim:\s*/i, 'Failed to send: ', '发送失败：'],
    [/^Gagal menyimpan pembelian:\s*/i, 'Failed to save purchase: ', '保存采购记录失败：'],
    [/^Gagal menyimpan logo:\s*/i, 'Failed to save logo: ', '保存标志失败：'],
    [/^Gagal menghapus riwayat audit:\s*/i, 'Failed to delete audit history: ', '删除盘点记录失败：'],
    [/^Gagal menjual baterai eceran:\s*/i, 'Failed to sell retail battery: ', '零售电池销售失败：'],
    [/^Gagal mengisi kas kecil:\s*/i, 'Failed to top up petty cash: ', '充值零用现金失败：'],
    [/^Gagal menyimpan tutup kasir:\s*/i, 'Failed to save shift closing: ', '保存交班报表失败：'],
    [/^Gagal konek Bluetooth:\s*/i, 'Bluetooth connection failed: ', '蓝牙连接失败：'],
    [/^Gagal mencetak:\s*/i, 'Print failed: ', '打印失败：'],
    [/^Gagal menyimpan bukti pengambilan:\s*/i, 'Failed to save pickup proof: ', '保存取件凭证失败：'],
    [/^Error Telegram:\s*/i, 'Telegram Error: ', 'Telegram 错误：'],
    [/^Gagal absen masuk \(pastikan SQL migrasi karyawan sudah dijalankan\):\s*/i, 'Clock-in failed (ensure employee migration SQL is run): ', '上班打卡失败（请确保已运行员工迁移 SQL）：'],
    [/^Gagal absen pulang:\s*/i, 'Clock-out failed: ', '下班打卡失败：'],
    [/^Gagal mengubah status:\s*/i, 'Failed to change status: ', '更改状态失败：'],
    [/^Gagal menyimpan hak akses:\s*/i, 'Failed to save permissions: ', '保存权限失败：'],
    [/^Gagal:\s*/i, 'Failed: ', '失败：'],

    // Pesan dengan variabel di tengah
    [/^Stok (.+?) berhasil ditambahkan \(Total: (.+?)\)$/i, 'Stock for $1 added (Total: $2)', '已添加 $1 库存（总计：$2）'],
    [/^Stok (.+?) ditambahkan \(Total: (.+?)\)$/i, 'Stock for $1 added (Total: $2)', '已添加 $1 库存（总计：$2）'],
    [/^Berhasil restock (\d+) (.+)$/i, 'Restocked $1 $2', '成功补货 $1 件 $2'],
    [/^Poin melebihi batas \(maksimal (.+?) poin\)$/i, 'Points exceed limit (max $1 pts)', '积分超出上限（最多 $1 分）'],
    [/^Status menjadi (.+)$/i, 'Status updated to $1', '状态已更新为 $1'],
    [/^Rekonsiliasi berhasil\. Saldo disesuaikan (.+)$/i, 'Reconciliation complete. Balance adjusted by $1', '对账完成。余额已调整 $1'],
    [/^Audit selesai\. (\d+) barang disesuaikan\.$/i, 'Audit complete. $1 item(s) adjusted.', '盘点完成。已调整 $1 件商品。'],
    [/^❌ Produk dengan barcode \[(.+?)\] tidak terdaftar!$/i, '❌ Product with barcode [$1] is not registered!', '❌ 条形码 [$1] 未登记！'],
    [/^❌ Stok (.+?) habis!$/i, '❌ $1 is out of stock!', '❌ $1 已售罄！'],
    [/^✅ (.+?) dimasukkan ke keranjang$/i, '✅ $1 added to cart', '✅ $1 已加入购物车'],
    [/^✅ (.+?) ditambahkan$/i, '✅ $1 added', '✅ 已添加 $1'],
    [/^Hasil hitung (\d+) barang terkirim ke Admin\/Pemilik$/i, 'Count result for $1 item(s) sent to Admin/Owner', '已将 $1 件商品的盘点结果发送给管理员/店主'],
    [/^Pembelian (.+?) dari (.+?) tersimpan \((.+?)\)$/i, 'Purchase $1 from $2 saved ($3)', '从 $2 采购 $1 已保存（$3）'],
    [/^(.+?) bulan ini dibayar (.+)$/i, '$1 paid this month: $2', '本月已支付 $1：$2'],
    [/^Terisi: (.+?) \((.+?)\)\. Tinggal klik Simpan Kas Kecil\.$/i, 'Filled: $1 ($2). Click Save Petty Cash.', '已填入：$1（$2）。请点击保存零用现金。'],
    [/^Stok baterai (.+?) tidak cukup \(sisa (.+?)\)$/i, 'Battery $1 stock insufficient (left: $2)', '电池 $1 库存不足（剩余 $2）'],
    [/^Baterai eceran (.+?) x(\d+) terjual \((.+?)\)$/i, 'Retail battery $1 x$2 sold ($3)', '零售电池 $1 x$2 已售出（$3）'],
    [/^Stok (.+?) tidak mencukupi \(maks (.+?)\)$/i, 'Insufficient stock for $1 (max $2)', '$1 库存不足（最多 $2）'],
    [/^Stok (.+?) hanya (.+)$/i, 'Only $2 left in stock for $1', '$1 仅剩 $2 件库存'],
    [/^Saldo kas kecil berhasil ditambah (.+)$/i, 'Petty cash topped up by $1', '零用现金已充值 $1'],
    [/^File Excel \(CSV\) (.+?) berhasil diunduh!$/i, 'Excel (CSV) file $1 downloaded!', 'Excel (CSV) 文件 $1 已下载！'],
    [/^Status (.+?) diubah menjadi (AKTIF|NONAKTIF)$/i, 'Status of $1 changed to $2', '$1 的状态已更改为 $2'],
    [/^Hak akses menu (.+?) berhasil disimpan!$/i, 'Menu permissions for $1 saved!', '$1 的菜单权限已保存！']
  ];

    window.trFlash = function (msg) {
    if (typeof msg !== 'string') return msg;
    let lang = '';
    for (const k of Object.keys(localStorage)) {
      if (/lang|bahasa/i.test(k)) {
        const v = (localStorage.getItem(k) || '').toLowerCase();
        if (v === 'en' || v === 'zh' || v === 'id') { lang = v; break; }
      }
    }
    if (!lang) {
      const txt = document.body ? document.body.innerText : '';
      if (txt.includes('Main Menu') || txt.includes('Large Text')) lang = 'en';
      else if (/[\u4e00-\u9fff]{2,}/.test(txt)) lang = 'zh';
      else lang = 'id';
    }
    if (lang === 'id') return msg;
    const idx = lang === 'zh' ? 1 : 0;

    if (EXACT[msg]) return EXACT[msg][idx];

    for (const [rgx, enRep, zhRep] of REGEX_RULES) {
      if (rgx.test(msg)) return msg.replace(rgx, idx === 1 ? zhRep : enRep);
    }

    return _prevTrFlash(msg);
  };

  if (typeof window.flash === 'function' && !window.flash.__trWrapped) {
    const _origFlash = window.flash;
    const wrappedFlash = function (msg, ...rest) {
      return _origFlash.call(this, window.trFlash(msg), ...rest);
    };
    wrappedFlash.__trWrapped = true;
    window.flash = wrappedFlash;
  }
})();

// === AUTO-MUAT MODAL BARANG UNTUK NERACA (INVENTORY / STOCK) ===
(function () {
  if (typeof window.hitungLaporanKeuangan !== 'function') return;
  const _origHitungKeu = window.hitungLaporanKeuangan;
  let _loadingModal = false;

  window.hitungLaporanKeuangan = function () {
    _origHitungKeu.apply(this, arguments);

    const semuaStok = [
      ...(db.produk || []),
      ...(db.sparePart || []),
      ...(db.stokBaterai || [])
    ];
    const belumAdaModal =
      semuaStok.length > 0 &&
      !semuaStok.some(x => Number(x.harga_beli) > 0) &&
      !db.produk.__modalSynced;

    if (belumAdaModal && !_loadingModal && typeof muatModalBarang === 'function') {
      _loadingModal = true;
      muatModalBarang().then(() => {
        if (db.produk) db.produk.__modalSynced = true;
        _loadingModal = false;
        _origHitungKeu.apply(this, arguments);
      }).catch(() => {
        _loadingModal = false;
      });
    }
  };
})();

// === HOROPOS COMPACT GRID UI (3/2 KOLOM) + QUICK CHIPS + POPUP PICKER KASIR ===
(function () {
  if (window.__hpGridUiLoaded) return;
  window.__hpGridUiLoaded = true;

  // 1. INJECT CSS GRID & POPUP
  const style = document.createElement('style');
  style.textContent = `
    /* Grid 3 kolom (normal) & 2 kolom (Huruf Besar) */
    #listProduk, #listSparePart, #listStokBaterai, #listSemuaStok {
      display: grid !important;
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      gap: 8px !important;
      align-items: stretch !important;
    }
    body.hp-grid-2col #listProduk,
    body.hp-grid-2col #listSparePart,
    body.hp-grid-2col #listStokBaterai,
    body.hp-grid-2col #listSemuaStok {
      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      gap: 10px !important;
    }
    /* Pesan kosong tetap full width */
    #listProduk > .empty, #listSparePart > .empty,
    #listStokBaterai > .empty, #listSemuaStok > .empty {
      grid-column: 1 / -1 !important;
    }
    /* Buat kartu di dalam grid lebih ringkas */
    #listProduk > div:not(.empty),
    #listSparePart > div:not(.empty),
    #listStokBaterai > div:not(.empty),
    #listSemuaStok > div:not(.empty) {
      margin: 0 !important;
      padding: 8px !important;
      font-size: 11.5px !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: space-between !important;
      overflow: hidden !important;
      word-break: break-word !important;
    }
    body.hp-grid-2col #listProduk > div:not(.empty),
    body.hp-grid-2col #listSparePart > div:not(.empty),
    body.hp-grid-2col #listStokBaterai > div:not(.empty),
    body.hp-grid-2col #listSemuaStok > div:not(.empty) {
      padding: 10px !important;
      font-size: 13.5px !important;
    }
    /* Sembunyikan kartu saat difilter (spesifisitas lebih tinggi dari display:flex) */
    #listProduk > div.hp-hidden:not(.empty),
    #listSparePart > div.hp-hidden:not(.empty),
    #listStokBaterai > div.hp-hidden:not(.empty),
    #listSemuaStok > div.hp-hidden:not(.empty) {
      display: none !important;
    }
    /* Quick Filter Chips */
    .hp-chip-bar {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding: 6px 2px 10px;
      margin-bottom: 4px;
      scrollbar-width: none;
    }
    .hp-chip-bar::-webkit-scrollbar { display: none; }
    .hp-chip {
      flex: 0 0 auto;
      padding: 5px 11px;
      border-radius: 999px;
      border: 1px solid #cbd5e1;
      background: #fff;
      color: #334155;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .hp-chip.active {
      background: #0f1f3d;
      color: #fff;
      border-color: #0f1f3d;
    }
    .hp-chip.warn.active {
      background: #dc2626;
      border-color: #dc2626;
    }
    /* Tombol Pilih Cepat di Kasir/Servis */
    .hp-pick-btn {
      margin-top: 6px;
      width: 100%;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1.5px dashed #2563eb;
      background: #eff6ff;
      color: #1d4ed8;
      font-weight: 800;
      font-size: 12.5px;
      cursor: pointer;
      text-align: center;
    }
    /* Popup Picker Modal */
    #hpPickerOverlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.6);
      z-index: 99999;
      display: none;
      align-items: flex-end;
      justify-content: center;
    }
    #hpPickerOverlay.open { display: flex; }
    #hpPickerBox {
      background: #f8fafc;
      width: 100%;
      max-width: 680px;
      max-height: 85vh;
      border-radius: 16px 16px 0 0;
      padding: 14px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 -8px 30px rgba(0,0,0,0.25);
    }
    #hpPickerGrid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      overflow-y: auto;
      padding-bottom: 12px;
    }
    body.hp-grid-2col #hpPickerGrid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .hp-pcard {
      background: #fff;
      border: 1.5px solid #e2e8f0;
      border-left: 4px solid #0f1f3d;
      border-radius: 10px;
      padding: 9px 8px;
      cursor: pointer;
      text-align: left;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 4px;
    }
    .hp-pcard:active { transform: scale(0.97); border-color: #2563eb; }
    .hp-pcard-name { font-weight: 800; font-size: 12px; color: #0f172a; line-height: 1.25; }
    .hp-pcard-sub { font-size: 11px; color: #059669; font-weight: 700; }
    body.hp-grid-2col .hp-pcard-name { font-size: 14px; }
    body.hp-grid-2col .hp-pcard-sub { font-size: 13px; }
    /* Tampilan Rapi Khusus Layar HP (2 Kolom Normal / 1 Kolom Huruf Besar) */
    @media (max-width: 600px) {
      #listProduk, #listSparePart, #listStokBaterai, #listSemuaStok {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 8px !important;
      }
      body.hp-grid-2col #listProduk,
      body.hp-grid-2col #listSparePart,
      body.hp-grid-2col #listStokBaterai,
      body.hp-grid-2col #listSemuaStok {
        grid-template-columns: 1fr !important;
      }
      /* Judul & badge stok ditumpuk atas-bawah agar nama tidak pecah per huruf */
      #listProduk > div > div:first-child,
      #listSparePart > div > div:first-child,
      #listStokBaterai > div > div:first-child,
      #listSemuaStok > div > div:first-child {
        flex-direction: column !important;
        align-items: flex-start !important;
        gap: 4px !important;
      }
      /* Kotak harga ditumpuk atas-bawah agar Cost Price tidak terpotong */
      #listStokBaterai > div > div:nth-child(2),
      #listProduk > div > div:nth-child(2),
      #listSparePart > div > div:nth-child(2),
      #listSemuaStok > div > div:nth-child(2) {
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
      }
      #listProduk > div:not(.empty),
      #listSparePart > div:not(.empty),
      #listStokBaterai > div:not(.empty),
      #listSemuaStok > div:not(.empty) {
        word-break: normal !important;
        overflow-wrap: break-word !important;
      }
    }
  `;
  document.head.appendChild(style);

  // 2. SAMBUNGKAN DENGAN TOMBOL "HURUF BESAR" (toggleFontBesar)
  function syncGridCols() {
    const isLarge =
      document.body.classList.contains('font-besar') ||
      document.documentElement.classList.contains('font-besar') ||
      localStorage.getItem('ta_font_besar') === '1' ||
      localStorage.getItem('hp_grid_2col') === '1';
    document.body.classList.toggle('hp-grid-2col', isLarge);
  }
  syncGridCols();

  if (typeof window.toggleFontBesar === 'function') {
    const _origToggle = window.toggleFontBesar;
    window.toggleFontBesar = function () {
      const res = _origToggle.apply(this, arguments);
      const next = !document.body.classList.contains('hp-grid-2col');
      document.body.classList.toggle('hp-grid-2col', next);
      localStorage.setItem('hp_grid_2col', next ? '1' : '0');
      return res;
    };
  }

  // 3. QUICK FILTER CHIPS UNTUK DAFTAR STOK
  const LIST_IDS = ['listProduk', 'listSparePart', 'listStokBaterai', 'listSemuaStok'];

  function attachChipBar(listId) {
    const container = document.getElementById(listId);
    if (!container) return;

    let bar = document.getElementById('chips_' + listId);
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'chips_' + listId;
      bar.className = 'hp-chip-bar';
      container.parentNode.insertBefore(bar, container);
    }

    let activeFilter = 'ALL';

    function applyFilter() {
      const cards = [...container.children].filter(el => !el.classList.contains('empty'));
      cards.forEach(card => {
        const txt = (card.textContent || '').trim();
        let show = true;
        if (activeFilter === 'LOW') {
          show = /⚠️|tipis|habis|low/i.test(txt);
        } else if (activeFilter !== 'ALL') {
          const re = new RegExp('\\b' + activeFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          show = re.test(txt);
        }
        card.classList.toggle('hp-hidden', !show);
      });
    }

    function rebuildChips() {
      const cards = [...container.children].filter(el => !el.classList.contains('empty'));
      if (cards.length < 2) { bar.innerHTML = ''; return; }

      const counts = {};
      let lowCount = 0;
      cards.forEach(card => {
        const txt = (card.textContent || '').replace(/[^\w\s-]/g, ' ').trim();
        const words = txt.split(/\s+/).filter(w => w.length >= 2 && !/^(BATT|PART|JAM|RP|STOCK|STOK|MIN|SELLING|PRICE|COST|PROFIT)$/i.test(w));
        const key = (words[0] || '').toUpperCase();
        if (key) counts[key] = (counts[key] || 0) + 1;
        if (/⚠️|tipis|habis|low/i.test(card.textContent || '')) lowCount++;
      });

      const topKeys = Object.entries(counts)
        .filter(([, c]) => c >= 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([k]) => k);

      let html = `<button type="button" class="hp-chip ${activeFilter === 'ALL' ? 'active' : ''}" data-f="ALL">Semua (${cards.length})</button>`;
      topKeys.forEach(k => {
        html += `<button type="button" class="hp-chip ${activeFilter === k ? 'active' : ''}" data-f="${k}">${k}</button>`;
      });
      if (lowCount > 0) {
        html += `<button type="button" class="hp-chip warn ${activeFilter === 'LOW' ? 'active' : ''}" data-f="LOW">⚠️ Tipis (${lowCount})</button>`;
      }
      bar.innerHTML = html;
      bar.querySelectorAll('.hp-chip').forEach(btn => {
        btn.onclick = () => {
          activeFilter = btn.dataset.f;
          bar.querySelectorAll('.hp-chip').forEach(b => b.classList.toggle('active', b === btn));
          applyFilter();
        };
      });
      applyFilter();
    }

    let raf = null;
    new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = null; rebuildChips(); });
    }).observe(container, { childList: true });
    rebuildChips();
  }

  // 4. POPUP GRID PICKER UNTUK DROPDOWN KASIR / SERVIS / RESTOCK
  const PICKER_SELECTS = ['selProduk', 'selSparePart', 'selBateraiServis', 'bTipeSel', 'beTipeSel', 'rsItem'];

  const overlay = document.createElement('div');
  overlay.id = 'hpPickerOverlay';
  overlay.innerHTML = `
    <div id="hpPickerBox">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <b id="hpPickerTitle" style="font-size:15px;color:#0f1f3d;">Pilih Item</b>
        <button type="button" id="hpPickerClose" style="background:#ef4444;color:#fff;border:none;border-radius:8px;padding:5px 12px;font-weight:700;cursor:pointer;">Tutup</button>
      </div>
      <input id="hpPickerSearch" type="text" placeholder="Cari cepat..." style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:6px;font-size:13px;">
      <div id="hpPickerChips" class="hp-chip-bar"></div>
      <div id="hpPickerGrid"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closePicker = () => overlay.classList.remove('open');
  overlay.addEventListener('click', e => { if (e.target === overlay) closePicker(); });
  document.getElementById('hpPickerClose').onclick = closePicker;

  function openGridPicker(selectEl, title) {
    const opts = [...selectEl.options].filter(o => o.value && !o.disabled);
    const searchEl = document.getElementById('hpPickerSearch');
    const chipsEl = document.getElementById('hpPickerChips');
    const gridEl = document.getElementById('hpPickerGrid');
    document.getElementById('hpPickerTitle').textContent = title || 'Pilih Item';
    searchEl.value = '';

    let activeBrand = 'ALL';
    const brandMap = {};
    opts.forEach(o => {
      const w = (o.text.replace(/[^\w\s-]/g, ' ').trim().split(/\s+/)[0] || '').toUpperCase();
      if (w.length >= 2) brandMap[w] = (brandMap[w] || 0) + 1;
    });
    const brands = Object.entries(brandMap).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);

    function renderGrid() {
      const q = searchEl.value.trim().toLowerCase();
      const filtered = opts.filter(o => {
        const t = o.text.toLowerCase();
        if (q && !t.includes(q)) return false;
        if (activeBrand !== 'ALL' && !t.includes(activeBrand.toLowerCase())) return false;
        return true;
      });
      gridEl.innerHTML = filtered.length
        ? filtered.map(o => {
            const parts = o.text.split(/[-—|]/);
            const name = (parts[0] || o.text).trim();
            const sub = parts.slice(1).join(' • ').trim();
            return `<button type="button" class="hp-pcard" data-val="${o.value.replace(/"/g, '&quot;')}">
              <div class="hp-pcard-name">${name}</div>
              ${sub ? `<div class="hp-pcard-sub">${sub}</div>` : ''}
            </button>`;
          }).join('')
        : '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#64748b;">Tidak ada item cocok</div>';

      gridEl.querySelectorAll('.hp-pcard').forEach(btn => {
        btn.onclick = () => {
          selectEl.value = btn.dataset.val;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          closePicker();
        };
      });
    }

    chipsEl.innerHTML =
      `<button type="button" class="hp-chip active" data-b="ALL">Semua (${opts.length})</button>` +
      brands.map(b => `<button type="button" class="hp-chip" data-b="${b}">${b}</button>`).join('');

    chipsEl.querySelectorAll('.hp-chip').forEach(c => {
      c.onclick = () => {
        activeBrand = c.dataset.b;
        chipsEl.querySelectorAll('.hp-chip').forEach(x => x.classList.toggle('active', x === c));
        renderGrid();
      };
    });

    searchEl.oninput = renderGrid;
    renderGrid();
    overlay.classList.add('open');
  }

  function initAll() {
    LIST_IDS.forEach(attachChipBar);
        // Sembunyikan label & tombol hijau lama "Pilih Cepat Tipe Baterai" (ID/EN/ZH)
    document.querySelectorAll('label, div, p, span').forEach(el => {
      const txt = (el.textContent || '').trim();
      const orig = (el.getAttribute('data-i18n-orig') || '').trim();
      if (
        el.children.length === 0 &&
        /^(Pilih Cepat Tipe Baterai|Quick Select Battery Type|快[捷速]选择电池)/i.test(txt || orig)
      ) {
        el.style.display = 'none';
        const next = el.nextElementSibling;
        if (next && next.tagName === 'DIV' && !next.querySelector('select, input')) {
          next.style.display = 'none';
        }
      }
    });
    PICKER_SELECTS.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel || document.getElementById('hpBtn_' + id)) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'hpBtn_' + id;
      btn.className = 'hp-pick-btn';
      btn.textContent = '🔲 Pilih Cepat (Grid)';
      btn.onclick = () => openGridPicker(sel, 'Pilih Item');
      sel.parentNode.insertBefore(btn, sel.nextSibling);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    setTimeout(initAll, 400);
  }
})();

// =========================================================
// FITUR PEMAKAIAN BATERAI GRATIS / INTERNAL (OPSI B)
// =========================================================

async function catatBateraiGratis({ bateraiId, kategori, keterangan = '', noNota = null, qty = 1 }) {
  if (!bateraiId) throw new Error('Tipe baterai wajib dipilih.');
  if (kategori !== 'bonus_beli_jam' && !keterangan.trim()) {
    throw new Error('Keterangan / nama penerima wajib diisi.');
  }

  // 1. Ambil data baterai & cek stok (kolom asli: tipe & harga_beli)
  const { data: bat, error: errBat } = await supabaseClient
    .from('stok_baterai')
    .select('id, tipe, stok, harga_beli, toko_id')
    .eq('id', bateraiId)
    .single();

  if (errBat || !bat) throw new Error('Data baterai tidak ditemukan.');
  if ((bat.stok || 0) < qty) throw new Error(`Stok baterai ${bat.tipe} tidak mencukupi.`);

  // 2. Potong stok_baterai & perbarui updated_at
  const { error: errStok } = await supabaseClient
    .from('stok_baterai')
    .update({
      stok: bat.stok - qty,
      updated_at: new Date().toISOString()
    })
    .eq('id', bat.id);

  if (errStok) throw new Error('Gagal memotong stok baterai: ' + errStok.message);

  // 3. Simpan ke tabel beban pemakaian_baterai_gratis
  const hppSatuan = Number(bat.harga_beli || 0);
  const namaKasir = (window.currentUserProfil?.nama || localStorage.getItem('ta_user_nama') || 'Kasir');

  const { error: errIns } = await supabaseClient
    .from('pemakaian_baterai_gratis')
    .insert({
      toko_id: bat.toko_id,
      baterai_id: bat.id,
      nama_baterai: bat.tipe,
      qty: qty,
      hpp_satuan: hppSatuan,
      kategori: kategori,
      no_nota: noNota,
      keterangan: keterangan.trim(),
      dibuat_oleh: namaKasir
    });

  if (errIns) throw new Error('Gagal menyimpan catatan beban baterai: ' + errIns.message);

  // 4. Kirim notifikasi Telegram (hanya untuk Kenalan/Saudara & Display/Rusak)
  if (kategori === 'kenalan_saudara' || kategori === 'display_rusak') {
    const labelKat = kategori === 'kenalan_saudara' ? 'Kenalan / Saudara' : 'Display / Rusak';
    const pesanTg = [
      'ALERT BATERAI GRATIS',
      `Kategori: ${labelKat}`,
      `Baterai: ${bat.tipe} (${qty} pcs)`,
      `HPP: Rp ${(hppSatuan * qty).toLocaleString('id-ID')}`,
      `Keterangan: ${keterangan.trim()}`,
      `Dicatat oleh: ${namaKasir}`
    ].join('\n');

    if (typeof kirimTelegram === 'function') {
      await kirimTelegram(pesanTg);
    }
  }

  return { nama_baterai: bat.tipe, hpp_satuan: hppSatuan };
}

async function getRingkasanBebanBaterai(tglMulaiISO, tglSelesaiISO) {
  const { data, error } = await supabaseClient
    .from('pemakaian_baterai_gratis')
    .select('kategori, qty, total_hpp')
    .gte('created_at', tglMulaiISO)
    .lte('created_at', tglSelesaiISO);

  if (error || !data) return { totalHpp: 0, totalQty: 0, rincian: {} };

  const rincian = {
    bonus_beli_jam: { qty: 0, hpp: 0 },
    kenalan_saudara: { qty: 0, hpp: 0 },
    display_rusak: { qty: 0, hpp: 0 }
  };

  let totalHpp = 0;
  let totalQty = 0;

  for (const row of data) {
    const q = Number(row.qty || 0);
    const h = Number(row.total_hpp || 0);
    if (rincian[row.kategori]) {
      rincian[row.kategori].qty += q;
      rincian[row.kategori].hpp += h;
    }
    totalQty += q;
    totalHpp += h;
  }

  return { totalHpp, totalQty, rincian };
}

// --- Helper UI untuk Checkout & Modal Cepat ---

async function muatDropdownBateraiGratis(selectElementId) {
  const el = document.getElementById(selectElementId);
  if (!el) return;

  const { data, error } = await supabaseClient
    .from('stok_baterai')
    .select('id, tipe, stok')
    .gt('stok', 0)
    .order('tipe', { ascending: true });

  const langAktif = localStorage.getItem('ta_lang') || 'id';

  const labelPilih = (typeof terjemahkanTeks === 'function')
    ? terjemahkanTeks('-- Pilih tipe baterai --', langAktif)
    : '-- Pilih tipe baterai --';
  const labelStok = (typeof terjemahkanTeks === 'function')
    ? terjemahkanTeks('Stok', langAktif)
    : 'Stok';

  el.innerHTML = `<option value="">${labelPilih}</option>`;
  if (error || !data) return;


    data.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = `${b.tipe} (${labelStok}: ${b.stok})`;
    el.appendChild(opt);
  });
}

function togglePilihBonusBaterai(aktif) {
  const wrap = document.getElementById('wrapSelectBonusBat');
  if (!wrap) return;
  wrap.style.display = aktif ? 'block' : 'none';
  if (aktif) muatDropdownBateraiGratis('selectBonusBaterai');
}

function bukaModalBateraiGratis() {
  const modal = document.getElementById('modalBateraiGratis');
  if (!modal) return;
  document.getElementById('bgKeterangan').value = '';
  muatDropdownBateraiGratis('bgBateraiId');
  modal.style.display = 'flex';
}

function tutupModalBateraiGratis() {
  const modal = document.getElementById('modalBateraiGratis');
  if (modal) modal.style.display = 'none';
}

async function simpanBateraiGratisManual() {
  const kategori = document.getElementById('bgKategori')?.value;
  const bateraiId = document.getElementById('bgBateraiId')?.value;
  const keterangan = document.getElementById('bgKeterangan')?.value || '';

  try {
    const res = await catatBateraiGratis({ bateraiId, kategori, keterangan, qty: 1 });
    alert(`Berhasil dicatat: ${res.nama_baterai} (Rp 0)`);
    tutupModalBateraiGratis();
  } catch (err) {
    alert(err.message);
  }
}
// =========================================================
// TAHAP 4: PANEL BOOKING ONLINE MULTI-BAHASA (ID / EN / ZH)
// =========================================================
(function initBookingOnlinePanel() {
  const KAMUS_BOOKING = {
    id: {
      title: 'Booking Online (Menunggu Barang)',
      refresh: 'Refresh',
      tutup: 'Tutup',
      buka: 'Buka',
      memuat: 'Memuat data booking...',
      kosong: 'Belum ada antrean booking online baru.',
      gagal: 'Gagal memuat booking',
      no_client: 'Koneksi Supabase belum terdeteksi.',
      keluhan: 'Keluhan',
      terima: 'Terima Unit',
      wa: 'Chat WA',
      batal: 'Batalkan',
      konfirmasi_terima: 'Terima unit {merek} atas nama {nama} ({kode})?\nData akan otomatis diisikan ke form servis.',
      konfirmasi_batal: 'Batalkan pengajuan {kode} atas nama {nama}?',
      locale: 'id-ID'
    },
    en: {
      title: 'Online Booking (Awaiting Item)',
      refresh: 'Refresh',
      tutup: 'Hide',
      buka: 'Show',
      memuat: 'Loading bookings...',
      kosong: 'No new online bookings.',
      gagal: 'Failed to load bookings',
      no_client: 'Supabase connection not detected.',
      keluhan: 'Issue',
      terima: 'Receive Item',
      wa: 'WhatsApp',
      batal: 'Cancel',
      konfirmasi_terima: 'Receive {merek} for {nama} ({kode})?\nDetails will auto-fill the service form.',
      konfirmasi_batal: 'Cancel booking {kode} for {nama}?',
      locale: 'en-US'
    },
    zh: {
      title: '在线预约（待收件）',
      refresh: '刷新',
      tutup: '收起',
      buka: '展开',
      memuat: '正在加载预约数据...',
      kosong: '暂无新的在线预约。',
      gagal: '加载预约失败',
      no_client: '未检测到 Supabase 连接。',
      keluhan: '故障描述',
      terima: '接收手表',
      wa: 'WhatsApp',
      batal: '取消',
      konfirmasi_terima: '确认接收 {nama} 的 {merek}（{kode}）？\n信息将自动填入维修单。',
      konfirmasi_batal: '确认取消 {nama} 的预约（{kode}）？',
      locale: 'zh-CN'
    }
  };

    function getBahasaAktif() {
    const raw = (localStorage.getItem('ta_lang') || 'id').toLowerCase();
    if (raw.startsWith('zh')) return 'zh';
    if (raw.startsWith('en')) return 'en';
    return 'id';
  }

  function tBooking(key) {
    const lang = getBahasaAktif();
    return (KAMUS_BOOKING[lang] && KAMUS_BOOKING[lang][key]) || KAMUS_BOOKING.id[key];
  }

  function getSupabaseClient() {
    const kandidat = [
      typeof sb !== 'undefined' ? sb : null,
      typeof supabaseClient !== 'undefined' ? supabaseClient : null,
      typeof _supabase !== 'undefined' ? _supabase : null,
      typeof db !== 'undefined' ? db : null,
      typeof supabase !== 'undefined' ? supabase : null,
      window.sb, window.supabaseClient, window._supabase, window.db
    ];
    return kandidat.find(c => c && typeof c.from === 'function') || null;
  }

  function formatWaktuSingkat(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString(tBooking('locale'), {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  }

  function buatPanelDOM() {
    if (document.getElementById('panelBookingOnline')) return;
    const sNama = document.getElementById('sNama');
    if (!sNama) return;

    const targetContainer = sNama.closest('.card, form, section') || sNama.parentElement;
    const panel = document.createElement('div');
    panel.id = 'panelBookingOnline';
    panel.style.cssText = 'background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:14px 16px;margin-bottom:16px;';

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="toggleDaftarBooking()">
          <strong id="titleBookingOnline" style="font-size:14.5px;color:#0f2942;">${tBooking('title')}</strong>
          <span id="badgeBookingCount" style="background:#16a34a;color:#fff;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;">0</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" id="btnRefreshBooking" onclick="muatBookingOnline()" style="padding:5px 10px;font-size:12px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;color:#334155;">${tBooking('refresh')}</button>
          <button type="button" id="btnToggleBooking" onclick="toggleDaftarBooking()" style="padding:5px 10px;font-size:12px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;color:#334155;">${tBooking('tutup')}</button>
        </div>
      </div>
      <div id="daftarBookingOnline" style="margin-top:12px;display:flex;flex-direction:column;gap:10px;">
        <div style="font-size:13px;color:#64748b;">${tBooking('memuat')}</div>
      </div>
    `;

    targetContainer.insertAdjacentElement('beforebegin', panel);
  }

  function renderDaftarBooking() {
    const listEl = document.getElementById('daftarBookingOnline');
    const badgeEl = document.getElementById('badgeBookingCount');
    if (!listEl) return;

    const data = window._cacheBookingOnline || [];
    if (badgeEl) {
      badgeEl.textContent = data.length;
      badgeEl.style.background = data.length > 0 ? '#16a34a' : '#94a3b8';
    }

    if (data.length === 0) {
      listEl.innerHTML = `<div style="font-size:13px;color:#64748b;">${tBooking('kosong')}</div>`;
      return;
    }

    listEl.innerHTML = data.map((b, idx) => {
      const noWa = String(b.no_hp || '').replace(/\D/g, '').replace(/^0/, '62');
      const warnaMetode = b.metode.includes('Ekspedisi')
        ? '#0284c7'
        : (b.metode.includes('Antar-Jemput') ? '#d97706' : '#475569');

      return `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:13px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
            <div>
              <span style="font-weight:700;color:#0f2942;">${b.kode_booking}</span>
              <span style="color:#64748b;font-size:12px;margin-left:6px;">${formatWaktuSingkat(b.created_at)}</span>
            </div>
            <span style="background:${warnaMetode};color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;">${b.metode}</span>
          </div>
          <div style="color:#1e293b;margin-bottom:4px;">
            <strong>${b.nama}</strong> (${b.no_hp}) • <span style="color:#475569;">${b.domisili}</span>
          </div>
          <div style="color:#334155;margin-bottom:8px;">
            <strong>${b.merek}</strong> — ${b.jenis_service}<br>
            <span style="color:#64748b;">${tBooking('keluhan')}: ${b.keluhan}</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" onclick="terimaUnitBooking(${idx})" style="padding:6px 12px;font-size:12.5px;font-weight:600;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;">${tBooking('terima')}</button>
            <a href="https://wa.me/${noWa}" target="_blank" rel="noopener" style="padding:6px 12px;font-size:12.5px;font-weight:600;background:#0f2942;color:#fff;text-decoration:none;border-radius:6px;">${tBooking('wa')}</a>
            <button type="button" onclick="batalkanBooking(${idx})" style="padding:6px 12px;font-size:12.5px;font-weight:600;background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;border-radius:6px;cursor:pointer;">${tBooking('batal')}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  window.refreshBahasaBookingOnline = function () {
    const titleEl = document.getElementById('titleBookingOnline');
    const btnRefresh = document.getElementById('btnRefreshBooking');
    const btnToggle = document.getElementById('btnToggleBooking');
    const listEl = document.getElementById('daftarBookingOnline');

    if (titleEl) titleEl.textContent = tBooking('title');
    if (btnRefresh) btnRefresh.textContent = tBooking('refresh');
    if (btnToggle && listEl) {
      btnToggle.textContent = listEl.style.display === 'none' ? tBooking('buka') : tBooking('tutup');
    }
    if (window._cacheBookingOnline) renderDaftarBooking();
  };

  window.toggleDaftarBooking = function () {
    const list = document.getElementById('daftarBookingOnline');
    const btn = document.getElementById('btnToggleBooking');
    if (!list) return;
    const tersembunyi = list.style.display === 'none';
    list.style.display = tersembunyi ? 'flex' : 'none';
    if (btn) btn.textContent = tersembunyi ? tBooking('tutup') : tBooking('buka');
  };

  window.muatBookingOnline = async function () {
    const client = getSupabaseClient();
    const listEl = document.getElementById('daftarBookingOnline');
    if (!listEl) return;

    if (!client) {
      listEl.innerHTML = `<div style="font-size:12.5px;color:#dc2626;">${tBooking('no_client')}</div>`;
      return;
    }

    listEl.innerHTML = `<div style="font-size:13px;color:#64748b;">${tBooking('memuat')}</div>`;

    const { data, error } = await client
      .from('booking_online')
      .select('*')
      .eq('status', 'Menunggu Barang')
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<div style="font-size:12.5px;color:#dc2626;">${tBooking('gagal')}: ${error.message}</div>`;
      return;
    }

    window._cacheBookingOnline = data || [];
    renderDaftarBooking();
  };

  window.terimaUnitBooking = async function (idx) {
    const b = (window._cacheBookingOnline || [])[idx];
    if (!b) return;

    const pesan = tBooking('konfirmasi_terima')
      .replace('{merek}', b.merek)
      .replace('{nama}', b.nama)
      .replace('{kode}', b.kode_booking);
    if (!confirm(pesan)) return;

    const isi = (id, val) => {
      const el = document.getElementById(id);
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };

    isi('sNama', b.nama);
    isi('sHp', b.no_hp);
    isi('sProduk', b.merek);
    isi('sKeluhan', `[${b.jenis_service}] ${b.keluhan}`);
    isi('sCatatan', `Kode Booking: ${b.kode_booking} | Metode: ${b.metode} | Domisili: ${b.domisili}`);

    const client = getSupabaseClient();
    if (client) {
      await client.from('booking_online').update({ status: 'Diterima' }).eq('id', b.id);
    }

    await window.muatBookingOnline();
    const sNamaEl = document.getElementById('sNama');
    if (sNamaEl) sNamaEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  window.batalkanBooking = async function (idx) {
    const b = (window._cacheBookingOnline || [])[idx];
    if (!b) return;

    const pesan = tBooking('konfirmasi_batal')
      .replace('{kode}', b.kode_booking)
      .replace('{nama}', b.nama);
    if (!confirm(pesan)) return;

    const client = getSupabaseClient();
    if (client) {
      await client.from('booking_online').update({ status: 'Batal' }).eq('id', b.id);
    }
    await window.muatBookingOnline();
  };

  // Pantau perubahan bahasa otomatis
  function pasangPendengarBahasa() {
    document.querySelectorAll('select').forEach(sel => {
      if (/lang|bahasa/i.test(sel.id || sel.name || '')) {
        sel.addEventListener('change', () => setTimeout(window.refreshBahasaBookingOnline, 100));
      }
    });

    new MutationObserver(() => window.refreshBahasaBookingOnline())
      .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }

  window.addEventListener('load', () => {
    setTimeout(() => {
      buatPanelDOM();
      pasangPendengarBahasa();
      window.muatBookingOnline();
    }, 1200);
  });
})();

// === MODUL 3 FOTO KONDISI SERVIS (KOMPRESI ~150KB + CLOUDINARY) ===
let tempFotoKondisiServis = ['', '', ''];

function kompresGambarServis(file, maxDim = 1000, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else { width = Math.round((width * maxDim) / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Gagal kompres foto')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('File gambar tidak valid')); };
    img.src = url;
  });
}

async function uploadFotoKondisiSlot(idx, file) {
  if (!file) return;
  const slotEl = document.getElementById(`slotFotoKondisi_${idx}`);
  if (slotEl) slotEl.innerHTML = `<span style="font-size:11px;color:#64748b;">Mengunggah...</span>`;
  try {
    const blob = await kompresGambarServis(file, 1000, 0.8);
    const fd = new FormData();
    fd.append('file', blob, `servis_${Date.now()}_${idx}.jpg`);
    fd.append('upload_preset', 'horopos_produk');
    const res = await fetch('https://api.cloudinary.com/v1_1/sz9gm896/image/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Upload gagal');
    tempFotoKondisiServis[idx] = data.secure_url.replace('/upload/', '/upload/q_auto,f_auto/');
    renderSlotFotoKondisi();
    if (typeof flash === 'function') flash(`Foto kondisi ${idx + 1} tersimpan`);
  } catch (err) {
    renderSlotFotoKondisi();
    if (typeof flash === 'function') flash('Gagal upload foto: ' + err.message, 'err');
  }
}

function hapusFotoKondisiSlot(idx, ev) {
  if (ev) ev.stopPropagation();
  tempFotoKondisiServis[idx] = '';
  renderSlotFotoKondisi();
}

function resetFotoKondisiServis() {
  tempFotoKondisiServis = ['', '', ''];
  renderSlotFotoKondisi();
}

let lastKameraLang = '';

function getKameraLang() {
  const txt = document.body.textContent || '';
  if (/Quick Select Service Fee|USE SPARE PARTS/i.test(txt)) return 'en';
  if (/快速选择|备件|服务费/.test(txt)) return 'zh';
  const ls = (localStorage.getItem('lang') || localStorage.getItem('horopos_lang') || document.documentElement.lang || '').toLowerCase();
  if (ls.startsWith('en')) return 'en';
  if (ls.startsWith('zh')) return 'zh';
  return 'id';
}

setInterval(() => {
  const lang = getKameraLang();
  if (lang !== lastKameraLang && document.getElementById('wrapFotoKondisiServis')) {
    lastKameraLang = lang;
    renderSlotFotoKondisi();
  }
}, 500);

const TEKS_FOTO_KONDISI = {
  id: { judul: 'Foto Kondisi Unit (Opsional, Maks. 3 Foto)', slot: ['Foto 1 (Depan)', 'Foto 2 (Belakang)', 'Foto 3 (Detail)'] },
  en: { judul: 'Unit Condition Photos (Optional, Max. 3 Photos)', slot: ['Photo 1 (Front)', 'Photo 2 (Back)', 'Photo 3 (Detail)'] },
  zh: { judul: '手表外观照片（可选，最多3张）', slot: ['照片 1（正面）', '照片 2（背面）', '照片 3（细节）'] }
};


function renderSlotFotoKondisi() {
  const wrap = document.getElementById('wrapFotoKondisiServis');
  if (!wrap) return;
  const t = TEKS_FOTO_KONDISI[getKameraLang()] || TEKS_FOTO_KONDISI.id;
  const lbl = document.getElementById('labelFotoKondisiServis');
  if (lbl) lbl.textContent = t.judul;

  wrap.innerHTML = [0, 1, 2].map(i => {
    const url = tempFotoKondisiServis[i];
    if (url) {
      return `
        <div id="slotFotoKondisi_${i}" style="position:relative;height:78px;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;background:#f8fafc;">
          <img src="${url}" style="width:100%;height:100%;object-fit:cover;cursor:pointer;" onclick="window.open('${url}','_blank')">
          <button type="button" onclick="hapusFotoKondisiSlot(${i}, event)" style="position:absolute;top:4px;right:4px;width:22px;height:22px;border:none;border-radius:50%;background:rgba(220,38,38,.9);color:#fff;font-weight:bold;cursor:pointer;line-height:1;">×</button>
        </div>`;
    }
    return `
      <label id="slotFotoKondisi_${i}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:78px;border:1.5px dashed #cbd5e1;border-radius:10px;background:#f8fafc;cursor:pointer;text-align:center;padding:6px;color:#475569;font-size:12px;">
        <span style="font-size:18px;line-height:1;margin-bottom:3px;">📷</span>
        <span>${t.slot[i]}</span>
        <input type="file" accept="image/*" capture="environment" style="display:none;" onchange="uploadFotoKondisiSlot(${i}, this.files[0]); this.value='';">
      </label>`;
  }).join('');
}

function initUIFotoKondisiServis() {
  const inputLain = document.getElementById('sKondisiLain');
  if (!inputLain || document.getElementById('boxFotoKondisiServis')) return;
  const parent = inputLain.parentElement;
  inputLain.style.display = 'none';
  const oldLabel = inputLain.previousElementSibling;
  if (oldLabel && oldLabel.tagName === 'LABEL') oldLabel.style.display = 'none';

  const box = document.createElement('div');
  box.id = 'boxFotoKondisiServis';
  box.style.marginTop = '8px';
  box.innerHTML = `
    <label id="labelFotoKondisiServis" style="display:block;font-weight:600;margin-bottom:6px;"></label>
    <div id="wrapFotoKondisiServis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;"></div>
  `;
  parent.appendChild(box);
  renderSlotFotoKondisi();
}

async function simpanFotoKondisiPascaRpc(rpcData, cartItems) {
  const adaFoto = cartItems.some(it => it.fotoKondisi && it.fotoKondisi.length);
  if (!adaFoto) return;

  let ids = [];
  if (Array.isArray(rpcData)) {
    ids = rpcData.map(x => (typeof x === 'object' ? x.id : x)).filter(Boolean);
  } else if (rpcData && typeof rpcData === 'object') {
    const arr = rpcData.ids || rpcData.servis_ids || rpcData.items || [];
    ids = Array.isArray(arr) ? arr.map(x => (typeof x === 'object' ? x.id : x)).filter(Boolean) : (rpcData.id ? [rpcData.id] : []);
  }

  if (ids.length !== cartItems.length) {
    const { data: latest } = await supabaseClient
      .from('servis')
      .select('id')
      .eq('customer', cartItems[0].customer)
      .order('created_at', { ascending: false })
      .limit(cartItems.length);
    if (latest && latest.length) ids = latest.reverse().map(r => r.id);
  }

  for (let i = 0; i < cartItems.length; i++) {
    const fotos = cartItems[i].fotoKondisi || [];
    if (ids[i] && fotos.length) {
      await supabaseClient.from('servis').update({ foto_kondisi: fotos }).eq('id', ids[i]);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => setTimeout(initUIFotoKondisiServis, 400));
setTimeout(initUIFotoKondisiServis, 1000);

function sembunyikanDropdownGaransi() {
  const sel = document.getElementById('sGaransi');
  if (!sel) return;
  // Pilih otomatis opsi selain "garansi" (Luar Garansi)
  const opsiLuar = Array.from(sel.options).find(o => o.value !== 'garansi');
  if (opsiLuar && !document.getElementById('sParentId')?.value) {
    sel.value = opsiLuar.value;
  }
  // Sembunyikan kotak dropdown + labelnya, biarkan Biaya Jasa melebar rapi
  const wrap = sel.parentElement;
  if (wrap) wrap.style.display = 'none';
  if (wrap && wrap.parentElement) wrap.parentElement.style.gridTemplateColumns = '1fr';
}

document.addEventListener('DOMContentLoaded', () => setTimeout(sembunyikanDropdownGaransi, 450));
setTimeout(sembunyikanDropdownGaransi, 1050);

// === MODUL AUTO-LOGOUT SEMUA AKUN ===
(function () {
  const AUTO_LOGOUT_MENIT = 10; // Ubah angka ini (misal: 15, 30, atau 60 menit)
  const KEY_LAST_ACTIVE = 'horopos_last_active';

  function catatAktivitas() {
    localStorage.setItem(KEY_LAST_ACTIVE, String(Date.now()));
  }

  ['click', 'keydown', 'touchstart', 'scroll', 'mousemove'].forEach(ev => {
    window.addEventListener(ev, catatAktivitas, { passive: true });
  });

  catatAktivitas();

  setInterval(async () => {
    if (typeof supabaseClient === 'undefined') return;
    const last = Number(localStorage.getItem(KEY_LAST_ACTIVE) || Date.now());
    const selisihMenit = (Date.now() - last) / 60000;

    if (selisihMenit >= AUTO_LOGOUT_MENIT) {
      try {
        const { data } = await supabaseClient.auth.getSession();
        if (data && data.session) {
          localStorage.removeItem(KEY_LAST_ACTIVE);
          await supabaseClient.auth.signOut();
          location.reload();
        }
      } catch (_) {}
    }
  }, 30000); // Cek setiap 30 detik
})();

// === MODUL MASTER HARGA (SETTING), TAMBAH BARU, AUTO-FILL & NONAKTIFKAN UNIFIED RESTOCK ===
(function () {
  function pasangDatalist(inputId, listId, items, onMatch) {
    const inp = $(inputId);
    if (!inp) return;
    let dl = $(listId);
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = listId;
      document.body.appendChild(dl);
      inp.setAttribute('list', listId);
      inp.addEventListener('change', () => onMatch(inp.value.trim()));
      inp.addEventListener('input', () => onMatch(inp.value.trim()));
    }
    dl.innerHTML = items.map(nama => `<option value="${esc(nama)}"></option>`).join('');
  }

  function pasangKartuMasterHarga() {
    const secSetting = $('setting');
    if (!secSetting || !isPemilik()) return;
    if ($('cardMasterHarga')) return;

    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'cardMasterHarga';
    card.innerHTML = `
      <h3>💰 Master Harga Modal & Jual (Khusus Pemilik)</h3>
      <p style="font-size:12px;color:#64748b;margin-top:0">Input barang baru atau ubah harga modal & jual di satu tempat. Otomatis terpanggil saat input Produk, Spare Part, Baterai, maupun Pembelian Supplier.</p>

      <!-- FORM TAMBAH MASTER BARU -->
      <div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:12px;margin-bottom:14px;">
        <div style="font-weight:700;font-size:12px;color:#0f172a;margin-bottom:8px;">➕ Tambah Master Barang Baru (Stok Awal 0)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <select id="mhNewTipe" style="width:auto;min-width:135px;">
            <option value="produk">Produk (Jam)</option>
            <option value="sparepart">Spare Part</option>
            <option value="stok_baterai">Baterai</option>
          </select>
          <input id="mhNewNama" placeholder="Nama Produk / Spare Part / Tipe Baterai *" style="flex:1;min-width:180px;">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <input type="number" min="0" id="mhNewBeli" placeholder="Harga Modal (Rp)" style="flex:1;min-width:130px;">
          <input type="number" min="0" id="mhNewJual" placeholder="Harga Jual (Rp)" style="flex:1;min-width:130px;">
          <button class="btn ok" onclick="tambahMasterHargaBaru()" style="width:auto;padding:10px 18px;">+ Simpan Master</button>
        </div>
      </div>

      <!-- CARI & FILTER -->
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <input id="cariMasterHarga" placeholder="🔍 Cari nama barang / tipe..." oninput="renderMasterHarga()" style="flex:1;min-width:180px;">
        <select id="filterMasterHarga" onchange="renderMasterHarga()" style="width:auto;min-width:130px;">
          <option value="semua">Semua Kategori</option>
          <option value="produk">Produk (Jam)</option>
          <option value="sparepart">Spare Part</option>
          <option value="stok_baterai">Baterai</option>
        </select>
      </div>
      <div id="listMasterHarga" style="max-height:420px;overflow-y:auto;overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;"></div>
    `;
    secSetting.insertBefore(card, secSetting.firstChild);
  }

  window.tambahMasterHargaBaru = async function () {
    if (!isPemilik()) return flash('Hanya Pemilik yang dapat menambah Master Harga.', 'err');
    const tipe = $('mhNewTipe')?.value || 'produk';
    const nama = txt('mhNewNama');
    const beli = Math.max(0, num('mhNewBeli'));
    const jual = Math.max(0, num('mhNewJual'));
    if (!nama) return flash('Nama barang / tipe baterai wajib diisi', 'err');

    try {
      let newId, data;
      if (tipe === 'produk') {
        if ((db.produk || []).some(p => p.nama.toLowerCase() === nama.toLowerCase())) return flash('Produk ini sudah ada di Master Harga', 'err');
        newId = genId('PRD');
        data = { id: newId, nama, merek: '', barcode: '', harga_jual: jual, stok: 0, updated_at: nowISO() };
      } else if (tipe === 'sparepart') {
        if ((db.sparePart || []).some(s => s.nama.toLowerCase() === nama.toLowerCase())) return flash('Spare Part ini sudah ada di Master Harga', 'err');
        newId = genId('SP');
        data = { id: newId, nama, kategori: 'Lainnya', harga_jual: jual, stok: 0, min_stok: 2, updated_at: nowISO() };
      } else {
        const tipeBat = nama.toUpperCase();
        if ((db.stokBaterai || []).some(b => b.tipe.toUpperCase() === tipeBat)) return flash('Tipe Baterai ini sudah ada di Master Harga', 'err');
        newId = genId('SB');
        data = { id: newId, tipe: tipeBat, harga_jual: jual, stok: 0, min_stok: 5 };
      }

      await dbOk(supabaseClient.from(tipe).insert([data]));
      await simpanModal(tipe, newId, beli);
      await catatLog('MASTER_HARGA', `Tambah master ${tipe}: ${nama} (Modal ${rp(beli)}, Jual ${rp(jual)})`);
      ['mhNewNama', 'mhNewBeli', 'mhNewJual'].forEach(id => { if ($(id)) $(id).value = ''; });
      flash(`Master "${nama}" berhasil ditambahkan!`);
      tarikSemuaData();
    } catch (e) {
      flash('Gagal menambah master: ' + e.message, 'err');
    }
  };

  window.renderMasterHarga = function () {
    const el = $('listMasterHarga');
    if (!el || !isPemilik()) return;
    const q = txt('cariMasterHarga').toLowerCase();
    const f = $('filterMasterHarga')?.value || 'semua';

    const semua = [
      ...(db.produk || []).map(x => ({ tipe: 'produk', label: 'JAM', id: x.id, nama: x.nama, beli: x.harga_beli || 0, jual: x.harga_jual || 0 })),
      ...(db.sparePart || []).map(x => ({ tipe: 'sparepart', label: 'PART', id: x.id, nama: x.nama, beli: x.harga_beli || 0, jual: x.harga_jual || 0 })),
      ...(db.stokBaterai || []).map(x => ({ tipe: 'stok_baterai', label: 'BAT', id: x.id, nama: x.tipe, beli: x.harga_beli || 0, jual: x.harga_jual || 0 }))
    ].filter(x => (f === 'semua' || x.tipe === f) && (!q || x.nama.toLowerCase().includes(q)));

    if (!semua.length) {
      el.innerHTML = '<div class="empty" style="padding:16px">Barang tidak ditemukan</div>';
      return;
    }

    el.innerHTML = `<table style="margin:0;min-width:520px;">
      <thead style="position:sticky;top:0;background:#f8fafc;z-index:1;">
        <tr><th>Barang</th><th style="width:125px;">Harga Modal</th><th style="width:125px;">Harga Jual</th><th style="width:70px;">Aksi</th></tr>
      </thead>
      <tbody>` + semua.map(x => {
        const key = `${x.tipe}_${x.id}`;
        const margin = x.jual > 0 ? Math.round(((x.jual - x.beli) / x.jual) * 100) + '%' : '-';
        return `<tr>
          <td><span class="badge proses" style="font-size:9px;margin-right:4px;">${x.label}</span><strong>${esc(x.nama)}</strong><br><small style="color:#64748b;"><span>Margin</span>: ${margin}</small></td>
          <td><input type="number" min="0" id="mhBeli_${esc(key)}" value="${x.beli}" style="padding:6px;font-size:13px;"></td>
          <td><input type="number" min="0" id="mhJual_${esc(key)}" value="${x.jual}" style="padding:6px;font-size:13px;"></td>
          <td><button class="btn-sm ok" onclick="simpanSatuMasterHarga('${x.tipe}','${esc(x.id)}')">Simpan</button></td>
        </tr>`;
      }).join('') + `</tbody></table>`;
  };

  window.simpanSatuMasterHarga = async function (tipe, id) {
    if (!isPemilik()) return flash('Hanya Pemilik yang dapat mengubah Master Harga.', 'err');
    const key = `${tipe}_${id}`;
    const beli = Math.max(0, +($(`mhBeli_${key}`)?.value) || 0);
    const jual = Math.max(0, +($(`mhJual_${key}`)?.value) || 0);
    try {
      await dbOk(supabaseClient.from(tipe).update({ harga_jual: jual, updated_at: nowISO() }).eq('id', id));
      await simpanModal(tipe, id, beli);
      await catatLog('MASTER_HARGA', `Update ${tipe} (${id}): Modal ${rp(beli)}, Jual ${rp(jual)}`);
      flash('Master harga diperbarui!');
      tarikSemuaData();
    } catch (e) {
      flash('Gagal update harga: ' + e.message, 'err');
    }
  };

  function sinkronMasterHargaUI() {
    if ($('cardRestockLain')) $('cardRestockLain').style.display = 'none';
    pasangKartuMasterHarga();
    if ($('listMasterHarga')) renderMasterHarga();

    pasangDatalist('pNama', 'dlMasterProduk', (db.produk || []).map(p => p.nama), val => {
      if (txt('pId')) return;
      const p = (db.produk || []).find(x => x.nama.toLowerCase() === val.toLowerCase());
      if (!p) return;
      if ($('pMerek') && p.merek) $('pMerek').value = p.merek;
      if ($('pHBeli') && isPemilik()) $('pHBeli').value = p.harga_beli || 0;
      if ($('pHJual')) $('pHJual').value = p.harga_jual || 0;
      if ($('pSerial') && p.barcode) $('pSerial').value = p.barcode;
    });

    pasangDatalist('spNama', 'dlMasterSparepart', (db.sparePart || []).map(s => s.nama), val => {
      const sp = (db.sparePart || []).find(x => x.nama.toLowerCase() === val.toLowerCase());
      if (!sp) return;
      if ($('spKat') && sp.kategori) $('spKat').value = sp.kategori;
      if ($('spBeli') && isPemilik()) $('spBeli').value = sp.harga_beli || 0;
      if ($('spJual')) $('spJual').value = sp.harga_jual || 0;
      if ($('spMin') && sp.min_stok !== undefined) $('spMin').value = sp.min_stok;
    });

    pasangDatalist('sbTipe', 'dlMasterBaterai', (db.stokBaterai || []).map(b => b.tipe), val => {
      const sb = (db.stokBaterai || []).find(x => x.tipe.toUpperCase() === val.toUpperCase());
      if (!sb) return;
      if ($('sbBeli') && isPemilik()) $('sbBeli').value = sb.harga_beli || 0;
      if ($('sbJual')) $('sbJual').value = sb.harga_jual || 0;
      if ($('sbMin') && sb.min_stok !== undefined) $('sbMin').value = sb.min_stok;
    });
  }

  if (typeof render === 'function') {
    const origRender = render;
    render = function (...args) {
      const res = origRender.apply(this, args);
      sinkronMasterHargaUI();
      return res;
    };
  }
  setTimeout(sinkronMasterHargaUI, 500);
})();








