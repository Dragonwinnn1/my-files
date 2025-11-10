// ================= CONFIG (TIDAK BERUBAH) =================
const API_URL = "https://script.google.com/macros/s/AKfycbxhQtVRPcVhdD7i7QCMIleYwp3wqudygiDmed9Y7LPn-FOKv5SzuzTqXjYS8fFCkogv/exec";

let currentUser = null;
let currentRole = null;
let dashboardInterval = null; 

// Variabel Global untuk Paginasi & Pencarian
let allContacts = []; // Menyimpan semua data kontak (Original)
let filteredContacts = []; // Menyimpan data kontak setelah disaring/dicari
let currentPage = 1;
let rowsPerPage = 10; // Default

// Variabel untuk mengontrol proses Blast
let isBlasting = false;
let blastIndex = 0;
let blastTimer = null;

// Set untuk melacak nomor WA yang dipilih (persisten antar halaman)
let selectedWAs = new Set(); 

window.onload = function () {
  const u = localStorage.getItem("wa_user");
  const r = localStorage.getItem("wa_role");
  if (u && r) {
    currentUser = u;
    currentRole = r;
    showDashboard();
    startDashboardPolling(); 
  } else {
    showLogin();
  }
};

/* ================= HELPERS ================= */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}
function escapeJs(str) {
  if (str == null) return "";
  return String(str)
    .replace(/\\/g,"\\\\").replace(/'/g,"\\'")
    .replace(/"/g,'\\"').replace(/\n/g,'\\n');
}

/** * Format angka menjadi format Rupiah Indonesia (e.g., 1.234.567) 
 */
function formatRupiah(number) {
    if (number == null || number === '') return "0";
    let num = String(number).replace(/[^0-9\.]/g, ''); 
    num = parseFloat(num);
    if (isNaN(num)) return "0";
    
    // Menggunakan toLocaleString untuk format IDR
    return num.toLocaleString('id-ID', { maximumFractionDigits: 0 }); 
}

/** * Format Date ke waktu lokal Indonesia (WIB)
 */
function formatTimeWIB(dateString) {
    if (!dateString) return "";
    try {
        const date = new Date(dateString);
        // Menggunakan id-ID dan Asia/Jakarta untuk format WIB
        return date.toLocaleString('id-ID', { 
            timeZone: 'Asia/Jakarta', 
            year: 'numeric', month: '2-digit', day: '2-digit', 
            hour: '2-digit', minute: '2-digit', second: '2-digit' 
        }).replace(/\//g, '-'); // Mengubah format tanggal agar lebih mudah dibaca
    } catch (e) {
        return dateString;
    }
}


/* ================= LOGIN & LOGOUT (TIDAK BERUBAH) ================= */
async function doLogin() {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value.trim();
  if (!u || !p) return showLoginMsg("Isi username & password");

  try {
    const res = await fetch(API_URL + `?action=login&username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`);
    const data = await res.json();
    if (data.success) {
      currentUser = data.username;
      currentRole = data.role;
      localStorage.setItem("wa_user", currentUser);
      localStorage.setItem("wa_role", currentRole);
      showDashboard();
      startDashboardPolling(); 
    } else showLoginMsg(data.message || "Login gagal");
  } catch (err) {
    showLoginMsg("Error: " + err.message);
  }
}
function showLoginMsg(t) {
  const el = document.getElementById("loginMsg");
  if (el) el.innerText = t;
}

function logout() {
  localStorage.removeItem("wa_user");
  localStorage.removeItem("wa_role");
  currentUser = null;
  currentRole = null;
  stopDashboardPolling(); 
  showLogin();
}

/* ================= DASHBOARD (TIDAK BERUBAH) ================= */
function startDashboardPolling() {
  stopDashboardPolling(); 
  loadDashboard(); 
  dashboardInterval = setInterval(loadDashboard, 10000); 
}

function stopDashboardPolling() {
  if (dashboardInterval) {
    clearInterval(dashboardInterval);
    dashboardInterval = null;
  }
}

async function loadDashboard() {
  const div = document.getElementById("page_dashboard");
  if (!div) return;
  if (div.innerHTML.trim() === "" || div.innerHTML.includes("Gagal")) {
      div.innerHTML = "Loading...";
  } 
  
  try {
    const res = await fetch(API_URL + `?action=dashboard&username=${encodeURIComponent(currentUser)}&role=${encodeURIComponent(currentRole)}`);
    const data = await res.json();
    if (data.success) {
      div.innerHTML = `
        <h2>📊 Dashboard ${currentRole === 'superadmin' ? '(Global)' : '(Pribadi)'}</h2>
        <div class="metrics">
          <div class="card">Total Kontak: <b>${data.totalKontak}</b></div>
          <div class="card">Total Terkirim: <b>${data.totalSent}</b></div>
          <div class="card">Total Deposit: <b>Rp ${formatRupiah(data.totalDeposit)}</b></div>
          <div class="card">Aktivitas Terakhir: <b>${data.lastActivity}</b></div>
        </div>`;
      document.getElementById("welcomeUser").textContent = currentUser;
      document.getElementById("welcomeRole").textContent = currentRole;
    } else {
      div.innerText = "Gagal ambil data dashboard";
    }
  } catch (err) {
    div.innerText = "Error: " + err.message;
  }
}

/* ================= SEND BLAST (REVISI: CHECKBOX, BLAST, REFRESH) ================= */
async function loadContacts() {
  const container = document.getElementById("page_send");
  if (!container) return;
  container.innerHTML = "Loading...";
  
  // Hentikan blast jika masih berjalan saat load/refresh
  if (isBlasting) stopBlast(false); 

  try {
    const res = await fetch(API_URL + `?action=contacts&username=${encodeURIComponent(currentUser)}`);
    const data = await res.json();
    if (!data.success) {
      container.innerHTML = "<p>Gagal ambil kontak</p>";
      return;
    }
    
    allContacts = data.contacts; 
    
    // Inisialisasi selectedWAs: Hanya lakukan auto-select jika selectedWAs kosong saat pertama load
    // Jika tidak, biarkan selectedWAs yang sudah ada (dari klik user sebelumnya)
    if (selectedWAs.size === 0) {
        allContacts.filter(c => Number(c.sent) !== 1).forEach(c => selectedWAs.add(String(c.wa)));
    }
    
    filteredContacts = [...allContacts]; 
    
    let html = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2>📱 Send Blast</h2>
        <button onclick="loadContacts()" style="background: #10b981; color: #1e1e2d; padding: 10px 15px; border-radius: 8px;">
          🔄 Refresh Data
        </button>
      </div>

      <div id="search-filter-row" style="display:flex; gap:10px; margin-bottom: 20px;">
        <input type="text" id="searchInput" placeholder="Cari Nama/WA/Username..." onkeyup="searchContacts(this.value)" style="flex-grow:1; padding: 10px; border-radius: 8px; border: 1px solid #36365a; background: #1e1e2d; color:#fff;">
        <select id="statusFilter" onchange="searchContacts(document.getElementById('searchInput').value)" style="padding: 10px; border-radius: 8px; border: 1px solid #36365a; background: #1e1e2d; color:#fff;">
          <option value="all">Semua Status</option>
          <option value="unsent">❌ Belum Terkirim</option>
          <option value="sent">✅ Terkirim</option>
        </select>
      </div>

      <div id="template-row">
        <span style="white-space: nowrap;">Pilih Template:</span>
        <select id="templateSelect"></select>
        <button onclick="addTemplate()">+ Tambah Template</button>
      </div>
      
      <div id="blast-controls" style="display: flex; flex-wrap: wrap; justify-content: flex-start; align-items: center; gap: 15px; margin: 20px 0; padding: 15px; background: #36365a; border-radius: 8px;">
        <button id="blastBtn" onclick="sendBlast()" style="background: #4f46e5; color: #fff;">
          Mulai Kirim Massal (${selectedWAs.size})
        </button>
        <button id="stopBlastBtn" onclick="stopBlast()" style="background: #ef4444; color: #fff; display: none;">
          Stop Blast
        </button>
        <button onclick="toggleSelectAll(true)" style="background: #34d399; color: #1e1e2d;">Pilih Belum Terkirim</button>
        <button onclick="toggleSelectAll(false)" style="background: #fbb623; color: #1e1e2d;">Batalkan Semua</button>
        
        <span style="white-space: nowrap;">Jeda (detik):</span>
        <input type="number" id="blastDelay" value="5" min="1" style="width: 80px; padding: 8px; border-radius: 6px; border: 1px solid #1e1e2d; background: #27293d; color: #fff;">
        <span id="blastInfo" style="color: #10b981; font-weight: 600;"></span>
      </div>
      <div id="contact-table-container"></div>
      
      <div id="pagination-controls" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; color: #a0a3a7; font-size: 14px;">
        <div class="filter-per-page">
          Tampilkan: 
          <select id="rowsPerPageSelect" onchange="changeRowsPerPage(this.value)" style="background: #1e1e2d; color: #fff; border: 1px solid #36365a; padding: 8px; border-radius: 6px;">
            <option value="5">5</option>
            <option value="10" selected>10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="${allContacts.length}">Semua (${allContacts.length})</option>
          </select>
        </div>
        <div class="pagination-buttons">
          <button id="prevBtn" onclick="prevPage()" disabled style="background: #36365a; color: #fff; padding: 8px 12px; border-radius: 6px;">← Prev</button>
          <span id="pageInfo"></span>
          <button id="nextBtn" onclick="nextPage()" style="background: #36365a; color: #fff; padding: 8px 12px; border-radius: 6px;">Next →</button>
        </div>
      </div>`;
      
    container.innerHTML = html;
    await loadTemplates();
    
    // Tampilkan data pertama kali
    displayContacts(currentPage); 
    updateBlastButtonCount();

  } catch (err) {
    container.innerHTML = "Error: " + err.message;
  }
}

// Fungsi untuk memilih/membatalkan semua checkbox
function toggleSelectAll(select) {
    // Jika select=true, hanya pilih kontak yang BELUM terkirim
    // Jika select=false, batalkan semua pilihan
    allContacts.forEach(c => {
        const wa = String(c.wa);
        const isUnsent = Number(c.sent) !== 1;
        if (select && isUnsent) {
            selectedWAs.add(wa);
        } else if (!select) {
            selectedWAs.delete(wa);
        }
    });

    // Update tampilan checkbox di halaman saat ini
    document.querySelectorAll('#contact-table-container input[type="checkbox"]').forEach(cb => {
        const wa = cb.value;
        const contact = allContacts.find(c => String(c.wa) === wa);
        const isUnsent = contact ? Number(contact.sent) !== 1 : false;
        
        if (select && isUnsent) {
            cb.checked = true;
        } else if (!select) {
            cb.checked = false;
        }
        // Catatan: Jika isUnsent=false, checkbox tetap disabled dan tidak akan tercentang/terhapus dari Set (karena tidak masuk loop di atas)
    });
    
    updateBlastButtonCount();
}

// Fungsi untuk melacak pilihan checkbox
function trackSelection(checkbox) {
    const wa = checkbox.value;
    if (checkbox.checked) {
        selectedWAs.add(wa);
    } else {
        selectedWAs.delete(wa);
    }
    updateBlastButtonCount();
}

// Update jumlah kontak di tombol Blast
function updateBlastButtonCount() {
    const blastBtn = document.getElementById('blastBtn');
    if (blastBtn) {
        blastBtn.textContent = `Mulai Kirim Massal (${selectedWAs.size})`;
    }
}


// Fungsi Mencari dan Memfilter Kontak (TIDAK BERUBAH)
function searchContacts(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    const statusFilter = document.getElementById("statusFilter").value;

    filteredContacts = allContacts.filter(c => {
        const matchSearch = 
            (c.username || '').toLowerCase().includes(term) ||
            (c.nama || '').toLowerCase().includes(term) ||
            (c.wa || '').toString().includes(term);

        if (!matchSearch) return false;

        const isSent = Number(c.sent) === 1;
        if (statusFilter === 'sent') {
            return isSent;
        } else if (statusFilter === 'unsent') {
            return !isSent;
        }
        return true; // statusFilter === 'all'
    });

    currentPage = 1; // Reset ke halaman 1 setelah filter/search
    displayContacts(currentPage);
    updateBlastButtonCount(); // Tetap panggil agar jumlah di tombol konsisten
}


// Fungsi untuk mengganti jumlah baris per halaman (TIDAK BERUBAH)
function changeRowsPerPage(value) {
    rowsPerPage = parseInt(value);
    currentPage = 1; // Reset ke halaman 1
    displayContacts(currentPage);
}

// Fungsi utama untuk menampilkan data kontak (TIDAK BERUBAH LOGIKNYA)
function displayContacts(page) {
    const tableContainer = document.getElementById("contact-table-container");
    const pageInfoSpan = document.getElementById("pageInfo");
    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    
    if (!tableContainer) return;

    const totalRows = filteredContacts.length;
    const totalPages = Math.ceil(totalRows / rowsPerPage);
    
    if (page < 1) page = 1;
    if (page > totalPages && totalPages > 0) page = totalPages;
    if (totalRows === 0) page = 0; 

    currentPage = page;

    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const contactsOnPage = filteredContacts.slice(start, end);

    if (totalRows === 0) {
        tableContainer.innerHTML = "<p style='padding:20px; text-align:center;'>Tidak ada data kontak yang ditemukan.</p>";
        pageInfoSpan.textContent = "0 dari 0";
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }

    // Bangun Tabel HTML
    let tableHtml = `
      <div style="overflow:auto">
      <table>
        <thead><tr>
          <th>#</th> <th>Username</th>
          <th>Nama</th>
          <th>WA</th>
          <th>Status</th>
          <th>Deposit</th>
          <th>Noted</th>
          <th>No Pengirim</th>
          <th>Sent</th>
          <th>SentAt (WIB)</th>
          <th>Aksi</th>
        </tr></thead><tbody>`;

    contactsOnPage.forEach(c => {
      const rawWa = (c.wa || "").toString().trim();
      let waDisplay = rawWa;

      if (currentRole === "staff") {
        if (waDisplay.length > 6) {
          waDisplay = waDisplay.substring(0, 4) + "****" + waDisplay.slice(-2);
        } else {
          waDisplay = "****";
        }
      }

      const rawDeposit = c.deposit == null || isNaN(parseFloat(c.deposit)) ? "" : String(c.deposit).trim();
      const formattedDeposit = formatRupiah(rawDeposit);
      
      const noted = c.noted == null ? "" : c.noted;
      const noPengirim = c.noPengirim || "-";
      const sentFlag = Number(c.sent) === 1;
      
      const isSelected = selectedWAs.has(rawWa);
      const checkboxDisabled = sentFlag;
      
      // Checkbox untuk memilih/membatalkan
      const checkboxHtml = `<input type="checkbox" value="${escapeJs(rawWa)}" 
                            ${isSelected ? 'checked' : ''} 
                            ${checkboxDisabled ? 'disabled' : ''}
                            onchange="trackSelection(this)">`;


      tableHtml += `<tr id="row_${escapeJs(rawWa)}">
        <td>${checkboxHtml}</td> <td>${escapeHtml(c.username || "")}</td>
        <td>${escapeHtml(c.nama || "")}</td>
        <td>${escapeHtml(waDisplay)}</td>

        <td contenteditable="${!sentFlag}" 
             onblur="updateContact('${escapeJs(rawWa)}','Status',this.innerText)">
             ${escapeHtml(c.status || "")}
        </td>

        <td contenteditable="true" 
             data-old-value="${escapeHtml(rawDeposit)}" 
             onblur="updateContact('${escapeJs(rawWa)}','Deposit',this.innerText, this)">
             Rp ${escapeHtml(formattedDeposit)}
        </td>

        <td contenteditable="true" 
             onblur="updateContact('${escapeJs(rawWa)}','Noted',this.innerText)">
             ${escapeHtml(noted)}
        </td>

        <td contenteditable="true" 
             onblur="updateContact('${escapeJs(rawWa)}','No Pengirim',this.innerText)">
             ${escapeHtml(noPengirim)}
        </td>

        <td id="sentFlag_${escapeJs(rawWa)}">${sentFlag ? "✅" : "❌"}</td>
        <td id="sentAt_${escapeJs(rawWa)}">${formatTimeWIB(c.sentAt) || ""}</td>
        <td id="aksi_${escapeJs(rawWa)}">
          ${sentFlag ? "<span style='color:green'>✅ Terkirim</span>" :
          `<button onclick="sendWA('${escapeJs(rawWa)}','${escapeJs(c.nama||"")}','${escapeJs(rawDeposit||"")}','${escapeJs(c.username||"")}')">Kirim</button>`}
        </td>
      </tr>`;
    });

    tableHtml += `</tbody></table></div>`;
    tableContainer.innerHTML = tableHtml;

    const endCount = Math.min(end, totalRows);
    const startCount = totalRows > 0 ? start + 1 : 0;
    pageInfoSpan.textContent = `Halaman ${currentPage} dari ${totalPages} (${startCount} - ${endCount} dari ${totalRows})`;
    
    prevBtn.disabled = currentPage === 1 || totalPages === 0;
    nextBtn.disabled = currentPage === totalPages || totalPages === 0;
}

function nextPage() {
    if (currentPage < Math.ceil(filteredContacts.length / rowsPerPage)) {
        displayContacts(currentPage + 1);
    }
}

function prevPage() {
    if (currentPage > 1) {
        displayContacts(currentPage - 1);
    }
}


// FUNGSI sendWA YANG DIREVISI FINAL UNTUK MENGATASI CHAT BARU KOSONG
function sendWA(wa, nama, deposit, usernameFromSheet) { 
  if (!wa) {
    alert("Nomor tujuan kosong!");
    return;
  }
  let cleanWa = String(wa).replace(/\s+/g, '');
  if (cleanWa.startsWith('+')) cleanWa = cleanWa.slice(1);

  const sel = document.getElementById("templateSelect");
  // Pastikan Anda memilih template yang benar
  const tmpl = sel && sel.value ? sel.value : "Halo {NAMAMEMBER}";
  
  let pesan = tmpl.replace(/{NAMAMEMBER}/g, nama||"")
    .replace(/{USERNAME}/g, usernameFromSheet || "") 
    .replace(/{NO_WA}/g, cleanWa)
    .replace(/{DEPOSIT}/g, deposit||"")
    .replace(/{SHEET_USERNAME}/g, currentUser||""); 
    
  // *** PENTING: Ganti {LINEBREAK} menjadi %0A (URL encoded newline) ***
  pesan = pesan.replace(/{LINEBREAK}/g, '%0A');

  // === DEBUGGING: Tampilkan pesan di konsol ===
  console.log(`[WA DEBUG] Mencoba mengirim ke ${cleanWa}. Pesan:`, pesan); 
  // ===========================================

  if (!pesan.trim()) {
      console.error("[WA ERROR] Pesan yang dihasilkan kosong.");
      alert("Template atau data isian kosong. Pesan tidak terkirim.");
      return;
  }

  try {
    // KEMBALI KE PROTOKOL HTTPS (wa.me) yang lebih stabil di PC
    const url = `https://wa.me/${cleanWa}?text=${encodeURIComponent(pesan)}`;
    
    // Gunakan window.open untuk membuka di tab baru, lebih baik untuk blast
    const newWindow = window.open(url, '_blank'); 
    
    // Coba fokuskan window baru, membantu agar browser memprioritaskan tab ini
    if (newWindow) newWindow.focus(); 
    
  } catch (e) {
    console.error("Error opening WhatsApp link:", e);
  }
  
  // Mark Sent tetap dijalankan setelah jeda (simulasi pengiriman berhasil)
  setTimeout(() => {
    markSent(cleanWa, tmpl, deposit); 
  }, 1000); 
}

// FUNGSI BARU: Logic Kirim Massal (TIDAK BERUBAH)
function sendBlast() {
  if (isBlasting) {
    stopBlast();
    return;
  }

  const delay = parseInt(document.getElementById('blastDelay').value) || 5;
  if (delay < 1) {
    alert("Jeda minimal 1 detik.");
    return;
  }
  
  const waToBlast = Array.from(selectedWAs);
  
  const contactsToBlast = allContacts
    .filter(c => waToBlast.includes(String(c.wa)) && Number(c.sent) !== 1)
    .map(c => ({
        wa: String(c.wa),
        nama: c.nama,
        deposit: c.deposit,
        username: c.username
    }));

  
  if (contactsToBlast.length === 0) {
    alert("Tidak ada kontak yang terpilih atau kontak yang terpilih sudah terkirim.");
    return;
  }
  
  if (!confirm(`Anda akan mengirim ${contactsToBlast.length} pesan dengan jeda ${delay} detik. Lanjutkan?`)) {
    return;
  }

  isBlasting = true;
  blastIndex = 0;
  
  const blastBtn = document.getElementById('blastBtn');
  const stopBtn = document.getElementById('stopBlastBtn');
  const blastInfo = document.getElementById('blastInfo');
  
  blastBtn.style.display = 'none';
  stopBtn.style.display = 'inline-block';
  blastInfo.textContent = `Blast dimulai. Sisa: ${contactsToBlast.length}`;
  
  function sendNext() {
    if (!isBlasting || blastIndex >= contactsToBlast.length) {
      stopBlast(true);
      return;
    }
    
    const contact = contactsToBlast[blastIndex];
    
    const total = contactsToBlast.length;
    const sisa = total - blastIndex;
    blastInfo.textContent = `Mengirim ke: ${contact.nama} (${blastIndex + 1}/${total}). Sisa: ${sisa}`;
    
    sendWA(contact.wa, contact.nama, contact.deposit, contact.username);
    
    selectedWAs.delete(contact.wa); 
    
    blastIndex++;
    
    blastTimer = setTimeout(sendNext, delay * 1000);
  }

  sendNext();
}

/**
 * FUNGSI INI SUDAH DIPERBARUI
 * Memuat ulang data kontak dari sheet jika blast selesai (isFinished=true)
 */
function stopBlast(isFinished = false) {
  isBlasting = false;
  if (blastTimer) {
    clearTimeout(blastTimer);
    blastTimer = null;
  }

  const blastBtn = document.getElementById('blastBtn');
  const stopBtn = document.getElementById('stopBlastBtn');
  const blastInfo = document.getElementById('blastInfo');

  if (blastBtn) blastBtn.style.display = 'inline-block';
  if (stopBtn) stopBtn.style.display = 'none';
  if (blastInfo) blastInfo.textContent = isFinished ? "✅ Blast Selesai. Memuat ulang data..." : "❌ Blast Dihentikan.";
  
  loadDashboard();
  updateBlastButtonCount();

  // 💡 PERBAIKAN: Jika blast selesai, panggil loadContacts() untuk me-refresh data dari Sheet
  if (isFinished) {
      loadContacts(); 
  } else {
      displayContacts(currentPage); // Jika dihentikan, cukup refresh tampilan halaman saat ini
  }
}


async function markSent(wa, template, deposit) {
  try {
    const res = await fetch(API_URL + 
      `?action=markSent&username=${encodeURIComponent(currentUser)}` +
      `&wa=${encodeURIComponent(wa)}` +
      `&template=${encodeURIComponent(template||"")}` +
      `&deposit=${encodeURIComponent(deposit||"")}`); 
    
    const data = await res.json();
    if (data.success) {
      const flag = document.getElementById("sentFlag_" + wa);
      if (flag) flag.textContent = "✅";

      const ts = document.getElementById("sentAt_" + wa);
      if (ts) ts.textContent = formatTimeWIB(data.sentAt || new Date()); 

      const aksi = document.getElementById("aksi_" + wa);
      if (aksi) aksi.innerHTML = "<span style='color:green'>✅ Terkirim</span>";
      
      [allContacts, filteredContacts].forEach(list => {
          const index = list.findIndex(c => c.wa === wa);
          if (index !== -1) {
              list[index].sent = 1;
              list[index].sentAt = data.sentAt || new Date().toLocaleString();
          }
      });
      
      const checkbox = document.querySelector(`#row_${wa} input[type="checkbox"]`);
      if (checkbox) {
          checkbox.checked = false;
          checkbox.disabled = true;
      }
      selectedWAs.delete(wa);
      updateBlastButtonCount();

      if(dashboardInterval) loadDashboard();
    }
  } catch(e){
    console.error("markSent error:", e);
  }
}

async function updateContact(wa, field, value, element = null) {
  const clean = value==null?"":String(value).trim();
  let finalValue = clean; 
  let oldDepositValue = null;
  
  if (field.toLowerCase() === 'deposit') {
      oldDepositValue = element.getAttribute('data-old-value') || '0';
      finalValue = String(clean).replace(/[^\d]/g, ''); 
      if(finalValue === '') finalValue = '0';
  }
  
  try {
    const updateRes = await fetch(API_URL+`?action=updateContact&username=${encodeURIComponent(currentUser)}&wa=${encodeURIComponent(wa)}&field=${encodeURIComponent(field)}&value=${encodeURIComponent(finalValue)}`);
    
    const updateData = await updateRes.json();
    if (!updateData.success) throw new Error(updateData.message || "Gagal update kontak");
    
    if (field.toLowerCase() === 'deposit') {
        await fetch(API_URL+
            `?action=updateReportDeposit&username=${encodeURIComponent(currentUser)}` +
            `&wa=${encodeURIComponent(wa)}` + 
            `&oldDepositValue=${encodeURIComponent(oldDepositValue)}` + 
            `&newDepositValue=${encodeURIComponent(finalValue)}`); 
        
        if(element) {
            element.innerHTML = `Rp ${formatRupiah(finalValue)}`;
            element.setAttribute('data-old-value', finalValue);
        }
    } 

    const fieldKey = field === 'No Pengirim' ? 'noPengirim' : field.toLowerCase();
    [allContacts, filteredContacts].forEach(list => {
        const index = list.findIndex(c => c.wa === wa);
        if (index !== -1) {
            list[index][fieldKey] = finalValue;
            if (field.toLowerCase() === 'deposit') {
                 list[index].deposit = finalValue; 
            }
        }
    });

    if (typeof loadDashboard === 'function') {
        loadDashboard();
    }

  } catch(e){
    console.error("updateContact error:", e);
    if (element && field.toLowerCase() === 'deposit') {
         const originalValue = oldDepositValue;
         element.innerHTML = `Rp ${formatRupiah(originalValue)}`;
    }
  }
}

/* ================= TEMPLATES, REPORT, USER MGMT, PAGE SWITCH (TIDAK BERUBAH) ================= */
async function loadTemplates() {
  const sel=document.getElementById("templateSelect"); if(!sel)return;
  try {
    const res=await fetch(API_URL+`?action=templates&username=${encodeURIComponent(currentUser)}`);
    const data=await res.json();
    sel.innerHTML="";
    if(data.success && data.templates && data.templates.length){
      data.templates.forEach(t=>{
        const opt=document.createElement("option");
        opt.value=t;
        opt.textContent=t;
        sel.appendChild(opt);
      });
    } else {
      const opt=document.createElement("option");
      opt.value="Halo {NAMAMEMBER}";
      opt.textContent="(default) Halo {NAMAMEMBER}";
      sel.appendChild(opt);
    }
  } catch(err){
    console.error("loadTemplates:", err);
  }
}
async function addTemplate(){
  const text=prompt("Masukkan template baru: Gunakan {LINEBREAK} untuk baris baru.");
  if(!text)return;
  try {
    await fetch(API_URL+`?action=addTemplate&username=${encodeURIComponent(currentUser)}&text=${encodeURIComponent(text)}`);
    await loadTemplates();
  } catch(e){console.error(e);}
}

async function loadReport(){
  const div=document.getElementById("page_report");
  if (!div) return;
  div.innerHTML = "Loading..."; 
  try {
    const res=await fetch(API_URL+`?action=report&username=${encodeURIComponent(currentUser)}&role=${encodeURIComponent(currentRole)}`);
    const data=await res.json();
    if(!data.success){div.innerHTML="Gagal ambil report";return;}
    let html=`<h2>📑 Report</h2>
      <p>Menampilkan data ${currentRole === 'superadmin' ? 'semua staff' : 'pribadi'}</p>
      <table>
        <thead>
        <tr>
          <th>Username</th>
          <th>Total Kontak</th>
          <th>Terkirim</th>
          <th>Belum</th>
          <th>Last (WIB)</th>
        </tr>
        </thead>
        <tbody>`;
    data.reports.forEach(r=>{
      html+=`<tr>
        <td>${escapeHtml(r.username)}</td>
        <td>${r.totalKontak}</td>
        <td>${r.totalSent}</td>
        <td>${r.totalUnsent}</td>
        <td>${r.lastActivity}</td>
      </tr>`;
    });
    div.innerHTML=html+"</tbody></table>";
  } catch (err) {
    div.innerHTML = "Error: " + err.message;
  }
}

async function loadUsers(){
  const div=document.getElementById("page_setting");
  if (!div) return;
  div.innerHTML = "Loading...";
  try {
    const res=await fetch(API_URL+`?action=users`);
    const data=await res.json();
    if(!data.success){div.innerHTML="Gagal ambil user";return;}
    let html=`<h2>⚙️ Users</h2><button onclick="addUserPrompt()">+Tambah</button>
      <table>
        <thead>
        <tr>
          <th>User</th>
          <th>Role</th>
          <th>Active</th>
          <th>Aksi</th>
        </tr>
        </thead>
        <tbody>`;
    data.users.forEach(u=>{
      html+=`<tr>
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.role)}</td>
        <td>${escapeHtml(u.active)}</td>
        <td>
          <button onclick="toggleUser('${escapeJs(u.username)}','${u.active==='yes'?'no':'yes'}')">
            ${u.active==='yes'?'Nonaktif':'Aktifkan'}
          </button>
          <button onclick="deleteUser('${escapeJs(u.username)}')">🗑</button>
        </td>
      </tr>`;
    });
    div.innerHTML=html+"</tbody></table>";
  } catch(err){
    div.innerHTML = "Error: " + err.message;
  }
}
async function addUserPrompt(){
  const u=prompt("Username?"); if(!u)return;
  const p=prompt("Password?"); if(!p)return;
  const r=prompt("Role (staff/superadmin)","staff");
  try {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: JSON.stringify({action: 'addUser', username: u, password: p, role: r})
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Gagal menambahkan user');
    loadUsers();
  } catch(e){console.error(e);}
}
async function toggleUser(u,a){try{await fetch(API_URL+`?action=toggleUser&username=${encodeURIComponent(u)}&active=${encodeURIComponent(a)}`);loadUsers();}catch(e){console.error(e);}}
async function deleteUser(u){if(confirm("Hapus "+u+" ?")){try{await fetch(API_URL+`?action=deleteUser&username=${encodeURIComponent(u)}`);loadUsers();}catch(e){console.error(e);}}}

function switchPage(btn){
  document.querySelectorAll("aside.sidebar nav button").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  const page=btn.getAttribute("data-page");
  document.querySelectorAll(".page-content").forEach(p=>p.classList.add("hidden"));
  const el = document.getElementById("page_"+page);
  if (el) el.classList.remove("hidden");
  
  const sidebar = document.getElementById("sidebarMenu");
  if (window.innerWidth <= 768) {
      sidebar.classList.remove("open");
  }
  
  if(page==="dashboard"){
      startDashboardPolling();
  } else {
      stopDashboardPolling();
  }
  
  if(page==="send"){
      // Hentikan blast jika pindah ke halaman lain
      if (isBlasting) stopBlast(false);
      loadContacts();
  }
  if(page==="report")loadReport();
  if(page==="setting")loadUsers();
}
function showLogin(){document.getElementById("loginPage").classList.remove("hidden");document.getElementById("dashboardPage").classList.add("hidden");stopDashboardPolling();}
function showDashboard(){document.getElementById("loginPage").classList.add("hidden");document.getElementById("dashboardPage").classList.remove("hidden");if(currentRole==="superadmin"){document.getElementById("btnSetting").classList.remove("hidden");} startDashboardPolling();}




