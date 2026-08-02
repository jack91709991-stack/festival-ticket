// Service Worker registration for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => console.log('Service Worker registered with scope:', reg.scope))
      .catch(err => console.error('Service Worker registration failed:', err));
  });
}

// Global Application State
const state = {
  tickets: [],
  gasUrl: localStorage.getItem('gas_url') || '',
  activeTab: 'tab-scan',
  scanner: null,
  isScanning: false,
  isProcessingScan: false,
  selectedTicketId: null,
  selectedMaxTickets: 0,
  listFilter: 'all', // Filter status for applicant list: 'all', '未使用', '一部引換済', '引換済'
  audioCtx: null
};

// Initial Mock Data
const MOCK_DATA = [
  { id: 'FES-0001', ban: '1-1班', name: '自治会 太郎', kana: 'ジチカイ タロウ', phone: '09012345678', tickets: 2, exchanged_count: 0, status: '未使用', exchange_time: '', method: 'デジタル', notes: '引換券発送済' },
  { id: 'FES-0002', ban: '1-2班', name: '佐藤 花子', kana: 'サトウ ハナコ', phone: '08098765432', tickets: 1, exchanged_count: 1, status: '引換済', exchange_time: '2026-07-08 10:30:15', method: 'デジタル', notes: '' },
  { id: 'FES-0003', ban: '2-1班', name: '鈴木 一郎', kana: 'スズキ イチロー', phone: '09011112222', tickets: 3, exchanged_count: 1, status: '一部引換済', exchange_time: '2026-07-08 11:00:00', method: 'アナログ', notes: '3枚中1枚のみ先行引換済' },
  { id: 'FES-0004', ban: '2-2班', name: '高橋 二郎', kana: 'タカハシ ジロウ', phone: '09033334444', tickets: 1, exchanged_count: 0, status: '未使用', exchange_time: '', method: 'デジタル', notes: '' },
  { id: 'FES-0005', ban: '3-1班', name: '田中 三郎', kana: 'タナカ サブロウ', phone: '09055556666', tickets: 2, exchanged_count: 2, status: '引換済', exchange_time: '2026-07-08 09:15:00', method: 'アナログ', notes: '' },
  { id: 'FES-0006', ban: '3-2班', name: '渡辺 陽子', kana: 'ワタナベ ヨウコ', phone: '09077778888', tickets: 4, exchanged_count: 0, status: '未使用', exchange_time: '', method: 'デジタル', notes: '大人2人子供2人' },
  { id: 'FES-0007', ban: '4-1班', name: '伊藤 健', kana: 'イトウ ケン', phone: '09099990000', tickets: 1, exchanged_count: 0, status: '未使用', exchange_time: '', method: 'デジタル', notes: '' },
  { id: 'FES-0008', ban: '4-2班', name: '山本 恵', kana: 'ヤマモト メグミ', phone: '08022223333', tickets: 3, exchanged_count: 0, status: '未使用', exchange_time: '', method: 'アナログ', notes: '' },
  { id: 'FES-0009', ban: '5-1班', name: '中村 拓也', kana: 'ナカムラ タクヤ', phone: '08044445555', tickets: 2, exchanged_count: 0, status: '未使用', exchange_time: '', method: 'デジタル', notes: '' },
  { id: 'FES-0010', ban: '5-2班', name: '小林 真一', kana: 'コバヤシ シンイチ', phone: '08066667777', tickets: 1, exchanged_count: 0, status: '未使用', exchange_time: '', method: '当日手動追加', notes: '受付テントにて登録' }
];

// Initialize Audio Context on demand
function initAudio() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }
}

// Play synthesized sound effects
function playBeep(type) {
  try {
    initAudio();
    const ctx = state.audioCtx;
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    const now = ctx.currentTime;

    if (type === 'success') {
      // Success sound (ピッ): High pitched short beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, now);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'warning') {
      // Warning sound (ブー): Low pitched long buzz
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    } else if (type === 'error') {
      // Error sound (ピピッ): Double quick beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.setValueAtTime(0.3, now + 0.08);
      gain.gain.setValueAtTime(0, now + 0.08); // pause
      
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(600, now + 0.13);
      gain2.gain.setValueAtTime(0.3, now + 0.13);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.21);
      
      osc.start(now);
      osc.stop(now + 0.08);
      osc2.start(now + 0.13);
      osc2.stop(now + 0.21);
    }
  } catch (e) {
    console.error('Audio play failed:', e);
  }
}

// Database Operations
function loadDatabase() {
  const localData = localStorage.getItem('festival_tickets_db');
  if (localData) {
    state.tickets = JSON.parse(localData);
  } else {
    // Default mock data if empty
    state.tickets = [...MOCK_DATA];
    saveDatabaseToLocalStorage();
  }
  updateDashboard();
}

function saveDatabaseToLocalStorage() {
  localStorage.setItem('festival_tickets_db', JSON.stringify(state.tickets));
}

// Convert full-width Japanese numbers to half-width
function normalizeZenToHan(str) {
  return str.replace(/[０-９]/g, function(s) {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  }).replace(/－/g, '-').replace(/ー/g, '-');
}

// Get next ID FES-XXXX
function generateNextId() {
  let maxNum = 0;
  state.tickets.forEach(t => {
    const match = t.id.match(/^FES-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });
  const nextNum = maxNum + 1;
  return `FES-${String(nextNum).padStart(4, '0')}`;
}

// Format Datetime
function getFormattedDatetime() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`;
}

// Timeout-controlled fetch helper
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 2500 } = options;
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal
  });
  clearTimeout(id);
  
  return response;
}

// Update DB status to exchanged
async function exchangeTicket(ticketId, exchangeCount) {
  const ticket = state.tickets.find(t => t.id === ticketId);
  if (!ticket) return { success: false, reason: 'not_found' };
  
  const remaining = ticket.tickets - (ticket.exchanged_count || 0);
  if (remaining <= 0) {
    return { success: false, reason: 'already_exchanged', ticket };
  }
  
  if (exchangeCount > remaining) {
    return { success: false, reason: 'exceeds_remaining', ticket };
  }

  const datetime = getFormattedDatetime();
  const newExchangedCount = (ticket.exchanged_count || 0) + exchangeCount;
  
  // Decide status
  let newStatus = '未使用';
  if (newExchangedCount === ticket.tickets) {
    newStatus = '引換済';
  } else if (newExchangedCount > 0) {
    newStatus = '一部引換済';
  }

  if (state.gasUrl) {
    updateIndicatorStatus('syncing');
    try {
      // POST with text/plain content-type avoids CORS preflight OPTIONS requests,
      // allowing standard CORS mode to read Google Apps Script redirected response.
      const response = await fetchWithTimeout(state.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'exchange',
          id: ticketId,
          exchange_count: exchangeCount,
          exchange_time: datetime
        }),
        timeout: 2500
      });
      
      const result = await response.json();
      
      if (result && !result.success) {
        if (result.reason === 'already_exchanged') {
          // Cloud database says it was already exchanged (e.g. by another client). Update local record with the cloud values.
          ticket.status = result.status || '引換済';
          ticket.exchanged_count = parseInt(result.exchanged_count, 10) || ticket.tickets;
          ticket.exchange_time = result.exchange_time || datetime;
          if (result.name) ticket.name = result.name;
          if (result.ban) ticket.ban = result.ban;
          if (result.tickets) ticket.tickets = result.tickets;
          if (result.notes) ticket.notes = result.notes;
          
          saveDatabaseToLocalStorage();
          updateDashboard();
          updateIndicatorStatus('online');
          return { success: false, reason: 'already_exchanged', ticket };
        } else if (result.reason === 'Ticket ID not found') {
          updateIndicatorStatus('online');
          return { success: false, reason: 'not_found' };
        }
      }
      
      updateIndicatorStatus('online');
    } catch (e) {
      console.error('GAS update failed or timed out:', e);
      updateIndicatorStatus('offline');
      // If offline/timeout, proceed with offline local exchange
    }
  }
  
  // Local update (falls back here if GAS request was successful or timed out/failed)
  ticket.status = newStatus;
  ticket.exchanged_count = newExchangedCount;
  ticket.exchange_time = datetime;
  saveDatabaseToLocalStorage();
  updateDashboard();
  
  return { success: true, ticket };
}

// Add new ticket record
async function registerTicket(record) {
  state.tickets.push(record);
  saveDatabaseToLocalStorage();
  updateDashboard();

  if (state.gasUrl) {
    updateIndicatorStatus('syncing');
    try {
      await fetchWithTimeout(state.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'register',
          record: record
        }),
        timeout: 3000
      });
      updateIndicatorStatus('online');
    } catch (e) {
      console.error('GAS register failed:', e);
      updateIndicatorStatus('offline');
    }
  }
  return true;
}

// Sync with GAS
async function syncWithGAS() {
  if (!state.gasUrl) return;
  
  updateIndicatorStatus('syncing');
  const syncBtn = document.getElementById('btn-sync-now');
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 同期中...';
  }

  try {
    // We do a GET request to fetch latest sheet database
    const response = await fetch(`${state.gasUrl}?action=read`);
    const data = await response.json();
    
    if (Array.isArray(data)) {
      state.tickets = data.map(row => ({
        id: row.id || '',
        ban: row.ban || '',
        name: row.name || '',
        kana: row.kana || '',
        phone: row.phone || '',
        tickets: parseInt(row.tickets, 10) || 1,
        exchanged_count: parseInt(row.exchanged_count, 10) || 0,
        status: row.status || '未使用',
        exchange_time: row.exchange_time || '',
        method: row.method || '',
        notes: row.notes || ''
      }));
      
      saveDatabaseToLocalStorage();
      updateDashboard();
      updateIndicatorStatus('online');
      alert('スプレッドシートとの同期が完了しました！');
    } else {
      throw new Error('Invalid database format returned.');
    }
  } catch (e) {
    console.error('GAS sync failed:', e);
    updateIndicatorStatus('offline');
    alert('同期に失敗しました。URLを確認するか、接続状況を確認してください。');
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> スプレッドシートと同期';
    }
  }
}

// UI Rendering & Dashboard
function updateDashboard() {
  const total = state.tickets.length;
  const exchanged = state.tickets.filter(t => t.status === '引換済').length;
  const remaining = total - exchanged;
  const percent = total > 0 ? Math.round((exchanged / total) * 100) : 0;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-exchanged').textContent = exchanged;
  document.getElementById('stat-remaining').textContent = remaining;
  document.getElementById('progress-percent').textContent = `${percent}%`;
  document.getElementById('progress-fill').style.width = `${percent}%`;
  
  // Refresh views
  if (state.activeTab === 'tab-search') {
    renderSearchResults();
  }
  renderApplicantList();
}

function renderApplicantList() {
  const tbody = document.getElementById('applicant-list-tbody');
  if (!tbody) return;

  const tickets = state.tickets;

  // Calculate summary stats
  const totalHouseholds = tickets.length;
  const totalTickets = tickets.reduce((sum, t) => sum + (t.tickets || 0), 0);
  
  let unusedCount = 0;
  let partialCount = 0;
  let completedCount = 0;

  tickets.forEach(t => {
    const exc = t.exchanged_count || 0;
    const app = t.tickets || 1;
    if (t.status === '未使用') {
      unusedCount += app;
    } else if (t.status === '一部引換済') {
      partialCount += exc;
      unusedCount += (app - exc);
    } else if (t.status === '引換済') {
      completedCount += app;
    }
  });

  const totalCountEl = document.getElementById('list-total-count');
  const unusedCountEl = document.getElementById('list-unused-count');
  const partialCountEl = document.getElementById('list-partial-count');
  const exchangedCountEl = document.getElementById('list-exchanged-count');

  if (totalCountEl) totalCountEl.textContent = `総申込: ${totalHouseholds}世帯 / ${totalTickets}枚`;
  if (unusedCountEl) unusedCountEl.textContent = `未使用: ${unusedCount}枚`;
  if (partialCountEl) partialCountEl.textContent = `一部引換: ${partialCount}枚`;
  if (exchangedCountEl) exchangedCountEl.textContent = `完了: ${completedCount}枚`;

  if (tickets.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 30px;">
          <i class="fa-solid fa-folder-open" style="font-size: 2rem; display: block; margin-bottom: 10px; opacity: 0.3;"></i>
          申込データがありません
        </td>
      </tr>
    `;
    return;
  }

  // Sort by ID (Ticket ID) ascending (safe fallback for missing IDs)
  const sortedTickets = [...tickets].sort((a, b) => (a.id || '').localeCompare(b.id || ''));

  // Filter by status criteria
  let filteredTickets = sortedTickets;
  if (state.listFilter !== 'all') {
    filteredTickets = sortedTickets.filter(t => t.status === state.listFilter);
  }

  tbody.innerHTML = '';
  if (filteredTickets.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 30px;">
          <i class="fa-solid fa-filter" style="font-size: 2rem; display: block; margin-bottom: 10px; opacity: 0.3;"></i>
          該当するステータスの申込情報がありません
        </td>
      </tr>
    `;
    return;
  }

  filteredTickets.forEach(ticket => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', ticket.id);
    
    let statusClass = '';
    if (ticket.status === '未使用') {
      statusClass = 'unused';
    } else if (ticket.status === '一部引換済') {
      statusClass = 'partial';
    }
    
    const remaining = ticket.tickets - (ticket.exchanged_count || 0);

    tr.innerHTML = `
      <td style="padding: 14px 8px;"><span class="badge badge-status ${statusClass}">${ticket.status}</span></td>
      <td style="padding: 14px 8px; font-weight: 600;">${ticket.ban}</td>
      <td style="padding: 14px 8px;">
        <div style="font-weight: 700; color: var(--text-primary);">${ticket.name}</div>
        <div style="font-size: 0.7rem; color: var(--text-secondary);">${ticket.kana}</div>
      </td>
      <td class="text-center" style="padding: 14px 8px; font-weight: 700;">${ticket.tickets}</td>
      <td class="text-center" style="padding: 14px 8px; color: var(--color-neon-green); font-weight: 700;">${ticket.exchanged_count || 0}</td>
      <td class="text-center" style="padding: 14px 8px; color: ${remaining > 0 ? 'var(--color-neon-blue)' : 'var(--text-muted)'}; font-weight: 700;">${remaining}</td>
    `;

    tr.addEventListener('click', () => {
      initAudio();
      openExchangeInput(ticket.id);
    });

    tbody.appendChild(tr);
  });
}

function updateIndicatorStatus(status) {
  const indicator = document.getElementById('db-mode-indicator');
  const dot = indicator.querySelector('.indicator-dot');
  const text = indicator.querySelector('.indicator-text');
  
  indicator.className = 'status-indicator'; // Reset classes
  
  if (!state.gasUrl) {
    dot.style.backgroundColor = '';
    text.textContent = '模擬DBモード';
  } else {
    if (status === 'online') {
      indicator.classList.add('online');
      text.textContent = 'クラウド同期中';
    } else if (status === 'syncing') {
      indicator.classList.add('online');
      text.textContent = '同期処理中...';
    } else {
      indicator.classList.add('offline');
      text.textContent = 'オフライン（ローカル保存）';
    }
  }
}

// Applicant List Status Filter UI
function initListFilters() {
  const filterButtons = document.querySelectorAll('#list-status-filters .btn-filter');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.listFilter = btn.getAttribute('data-filter');
      renderApplicantList();
    });
  });
}

// Navigation Tabs
function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

function switchTab(tabId) {
  const panels = document.querySelectorAll('.tab-panel');
  const navItems = document.querySelectorAll('.nav-item');
  
  panels.forEach(p => p.classList.remove('active'));
  navItems.forEach(i => i.classList.remove('active'));
  
  document.getElementById(tabId).classList.add('active');
  const activeNav = Array.from(navItems).find(i => i.getAttribute('data-tab') === tabId);
  if (activeNav) activeNav.classList.add('active');
  
  state.activeTab = tabId;

  // Stop camera scan if switching away from Scan tab
  if (tabId !== 'tab-scan' && state.isScanning) {
    stopScanner();
  }
  
  // Refresh search input visibility and search when entering tab
  if (tabId === 'tab-search') {
    renderSearchResults();
  } else if (tabId === 'tab-list') {
    renderApplicantList();
  }
}

// QR Scanner Logic
async function initScanner() {
  const cameraSelect = document.getElementById('camera-select');
  
  try {
    const devices = await Html5Qrcode.getCameras();
    cameraSelect.innerHTML = '';
    
    if (devices && devices.length > 0) {
      devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.id;
        option.text = device.label || `カメラ ${cameraSelect.length + 1}`;
        cameraSelect.appendChild(option);
      });
      
      // Auto select back camera if available
      const backCam = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('rear'));
      if (backCam) {
        cameraSelect.value = backCam.id;
      }
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.text = 'カメラが見つかりません';
      cameraSelect.appendChild(option);
    }
  } catch (e) {
    console.error('Camera retrieval error:', e);
    cameraSelect.innerHTML = '<option value="">カメラ使用許可がありません</option>';
  }
}

function startScanner() {
  initAudio(); // Warm up Audio Context on user tap
  const cameraSelect = document.getElementById('camera-select').value;
  if (!cameraSelect && !navigator.mediaDevices) {
    alert('カメラが見つからないか、ブラウザがサポートしていません。');
    return;
  }

  const readerDiv = document.getElementById('reader');
  readerDiv.innerHTML = ''; // Clear previous DOM elements

  state.scanner = new Html5Qrcode("reader");
  state.isScanning = true;
  document.body.classList.add('scanning');
  
  document.getElementById('btn-start-scan').disabled = true;
  document.getElementById('btn-stop-scan').disabled = false;

  const config = {
    fps: 10,
    qrbox: function(width, height) {
      const min = Math.min(width, height);
      return { width: Math.round(min * 0.7), height: Math.round(min * 0.7) };
    },
    aspectRatio: 1.333333
  };

  // Check camera constraint
  const targetCamera = cameraSelect ? cameraSelect : { facingMode: "environment" };

  state.scanner.start(
    targetCamera,
    config,
    onScanSuccess,
    onScanFailure
  ).catch(err => {
    console.error('Scanner start error:', err);
    alert('カメラの起動に失敗しました。権限設定を確認してください。');
    stopScanner();
  });
}

function stopScanner() {
  if (state.scanner) {
    state.scanner.stop().then(() => {
      state.isScanning = false;
      document.body.classList.remove('scanning');
      document.getElementById('btn-start-scan').disabled = false;
      document.getElementById('btn-stop-scan').disabled = true;
      document.getElementById('reader').innerHTML = '';
      state.scanner = null;
    }).catch(err => {
      console.error('Scanner stop error:', err);
    });
  }
}

function openExchangeInput(ticketId) {
  const ticket = state.tickets.find(t => t.id === ticketId);
  if (!ticket) return;

  const remaining = ticket.tickets - (ticket.exchanged_count || 0);
  
  state.selectedTicketId = ticketId;
  state.selectedMaxTickets = remaining;

  // Reset counter input value to remaining balance (default to fully exchange the rest)
  const counterInput = document.getElementById('counter-input');
  counterInput.value = remaining;

  // Update minus/plus buttons state
  updateCounterButtons(remaining, remaining);

  // Open overlay in 'input' mode
  showOverlay('input', '引換枚数の入力', [
    { label: 'チケットID', value: ticket.id },
    { label: '氏名', value: ticket.name },
    { label: '班名', value: ticket.ban },
    { label: '申込枚数', value: `${ticket.tickets} 枚` },
    { label: '引換済枚数', value: `${ticket.exchanged_count || 0} 枚` },
    { label: '残りの枚数', value: `${remaining} 枚` },
    { label: '備考', value: ticket.notes || 'なし' }
  ]);
}

function updateCounterButtons(currentVal, maxVal) {
  const btnMinus = document.getElementById('btn-counter-minus');
  const btnPlus = document.getElementById('btn-counter-plus');
  
  btnMinus.disabled = currentVal <= 1;
  btnPlus.disabled = currentVal >= maxVal;
}

function initOverlayControls() {
  const btnMinus = document.getElementById('btn-counter-minus');
  const btnPlus = document.getElementById('btn-counter-plus');
  const counterInput = document.getElementById('counter-input');
  const btnCancel = document.getElementById('btn-cancel-exchange');
  const btnConfirm = document.getElementById('btn-confirm-exchange');

  btnMinus.addEventListener('click', () => {
    let val = parseInt(counterInput.value, 10) || 1;
    if (val > 1) {
      val--;
      counterInput.value = val;
      updateCounterButtons(val, state.selectedMaxTickets);
    }
  });

  btnPlus.addEventListener('click', () => {
    let val = parseInt(counterInput.value, 10) || 1;
    if (val < state.selectedMaxTickets) {
      val++;
      counterInput.value = val;
      updateCounterButtons(val, state.selectedMaxTickets);
    }
  });

  btnCancel.addEventListener('click', () => {
    closeOverlay();
  });

  btnConfirm.addEventListener('click', async () => {
    const count = parseInt(counterInput.value, 10) || 1;
    if (count < 1 || count > state.selectedMaxTickets) {
      alert('無効な引換枚数です。');
      return;
    }

    // Disable buttons during transaction
    btnConfirm.disabled = true;
    btnCancel.disabled = true;

    try {
      const result = await exchangeTicket(state.selectedTicketId, count);
      
      if (result.success) {
        playBeep('success');
        showOverlay('success', '引換完了', [
          { label: 'チケットID', value: result.ticket.id },
          { label: '氏名', value: result.ticket.name },
          { label: '班名', value: result.ticket.ban },
          { label: '今回引換数', value: `${count} 枚` },
          { label: '引換済累計', value: `${result.ticket.exchanged_count} 枚 / 申込 ${result.ticket.tickets} 枚` },
          { label: '残りの枚数', value: `${result.ticket.tickets - result.ticket.exchanged_count} 枚` }
        ]);
      } else if (result.reason === 'already_exchanged') {
        playBeep('warning');
        showOverlay('warning', '重複引換（警告）', [
          { label: 'チケットID', value: result.ticket.id },
          { label: '氏名', value: result.ticket.name },
          { label: '班名', value: result.ticket.ban },
          { label: '申込枚数', value: `${result.ticket.tickets} 枚` },
          { label: '引換済累計', value: `${result.ticket.exchanged_count} 枚` },
          { label: '備考', value: 'すべてのチケットが引換済です。' }
        ]);
      } else {
        playBeep('error');
        showOverlay('error', 'エラーが発生しました', [
          { label: '理由', value: result.reason || '通信エラー' }
        ]);
      }
    } catch (e) {
      console.error(e);
      alert('引換処理中にエラーが発生しました。');
    } finally {
      btnConfirm.disabled = false;
      btnCancel.disabled = false;
    }
  });
}

async function onScanSuccess(decodedText, decodedResult) {
  // Ignore scans if we are already processing a scan or if the overlay is visible
  if (state.isProcessingScan || !document.getElementById('scan-overlay').classList.contains('hidden')) {
    return;
  }

  state.isProcessingScan = true; // Lock scanning process

  const ticketId = decodedText.trim();
  const ticket = state.tickets.find(t => t.id === ticketId);

  if (!ticket) {
    playBeep('error');
    showOverlay('error', '無効なコード', [
      { label: 'スキャンデータ', value: ticketId },
      { label: '状態', value: 'スプレッドシートに登録されていません' }
    ]);
    return;
  }

  const remaining = ticket.tickets - (ticket.exchanged_count || 0);

  if (remaining <= 0 || ticket.status === '引換済') {
    // Already fully exchanged
    playBeep('warning');
    showOverlay('warning', '重複引換（警告）', [
      { label: 'チケットID', value: ticket.id },
      { label: '氏名', value: ticket.name },
      { label: '班名', value: ticket.ban },
      { label: '申込枚数', value: `${ticket.tickets} 枚` },
      { label: '引換済累計', value: `${ticket.exchanged_count || 0} 枚` },
      { label: '備考', value: 'すでにすべてのチケットの引換が完了しています。' }
    ]);
  } else {
    // Open count input modal! (No beep yet)
    openExchangeInput(ticketId);
  }
}

function onScanFailure(error) {
  // Silent scan failures to avoid logs cluttering
}

function showOverlay(type, title, details) {
  const overlay = document.getElementById('scan-overlay');
  const titleEl = document.getElementById('overlay-title');
  const detailsEl = document.getElementById('overlay-details');
  const icon = document.getElementById('overlay-icon');
  
  const counterWrapper = document.getElementById('overlay-counter-wrapper');
  const actionButtons = document.getElementById('overlay-action-buttons');
  const closeBtn = document.getElementById('btn-close-overlay');

  // Set classes
  overlay.className = `scan-overlay ${type}`;
  titleEl.textContent = title;
  
  // Set Icon
  icon.className = 'fa-solid';
  if (type === 'success') {
    icon.classList.add('fa-check');
  } else if (type === 'warning') {
    icon.classList.add('fa-triangle-exclamation');
  } else if (type === 'input') {
    icon.classList.add('fa-ticket-simple');
  } else {
    icon.classList.add('fa-xmark');
  }

  // Populate Details
  detailsEl.innerHTML = '';
  details.forEach(item => {
    const div = document.createElement('div');
    div.className = 'overlay-detail-item';
    div.innerHTML = `
      <span class="overlay-detail-label">${item.label}</span>
      <span class="overlay-detail-value">${item.value}</span>
    `;
    detailsEl.appendChild(div);
  });

  // Toggle Visibility based on state
  if (type === 'input') {
    counterWrapper.style.display = 'flex';
    actionButtons.style.display = 'flex';
    closeBtn.style.display = 'none';
  } else {
    counterWrapper.style.display = 'none';
    actionButtons.style.display = 'none';
    closeBtn.style.display = 'block';
  }

  overlay.classList.remove('hidden');

  // Auto close success overlay after 4 seconds to ease flow
  if (type === 'success') {
    if (state.overlayTimer) clearTimeout(state.overlayTimer);
    state.overlayTimer = setTimeout(closeOverlay, 4000);
  }
}

function closeOverlay() {
  const overlay = document.getElementById('scan-overlay');
  overlay.classList.add('hidden');
  if (state.overlayTimer) clearTimeout(state.overlayTimer);
  
  // Unlock scanning process when overlay is closed
  state.isProcessingScan = false;
}

// Manual Search & Exchange Logic
function initSearch() {
  const searchInput = document.getElementById('search-input');
  const btnClear = document.getElementById('btn-clear-search');

  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    btnClear.style.display = val ? 'block' : 'none';
    renderSearchResults();
  });

  btnClear.addEventListener('click', () => {
    searchInput.value = '';
    btnClear.style.display = 'none';
    searchInput.focus();
    renderSearchResults();
  });
}

function renderSearchResults() {
  const searchInput = document.getElementById('search-input');
  const container = document.getElementById('search-results');
  const query = searchInput.value.trim().toLowerCase();

  if (!query) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-users"></i>
        <p>氏名、フリガナ、電話番号、または班名を入力してください</p>
      </div>
    `;
    return;
  }

  // Normalize search numbers
  const normalizedQuery = normalizeZenToHan(query);

  const matches = state.tickets.filter(t => {
    const nameMatch = t.name.toLowerCase().includes(query);
    const kanaMatch = t.kana.toLowerCase().includes(query);
    const phoneMatch = t.phone.replace(/-/g, '').includes(query);
    const banMatch = normalizeZenToHan(t.ban).toLowerCase().includes(normalizedQuery);
    return nameMatch || kanaMatch || phoneMatch || banMatch;
  });

  if (matches.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-face-frown"></i>
        <p>該当する参加者が見つかりません</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  matches.forEach(ticket => {
    const card = document.createElement('div');
    card.className = 'result-card';

    const isExchangeable = ticket.status !== '引換済' && (ticket.tickets - (ticket.exchanged_count || 0)) > 0;
    
    let badgeStatusClass = '';
    if (ticket.status === '未使用') {
      badgeStatusClass = 'unused';
    } else if (ticket.status === '一部引換済') {
      badgeStatusClass = 'partial';
    }
    
    const badgeStatusText = ticket.status;

    card.innerHTML = `
      <div class="result-info">
        <div class="result-header-row">
          <span class="result-name">${ticket.name}</span>
          <span class="badge badge-ban">${ticket.ban}</span>
          <span class="badge badge-status ${badgeStatusClass}">${badgeStatusText}</span>
        </div>
        <div class="result-kana">${ticket.kana}</div>
        <div class="result-details-row">
          <span><i class="fa-solid fa-ticket"></i> 申込: ${ticket.tickets}枚</span>
          <span><i class="fa-solid fa-check"></i> 引換済: ${ticket.exchanged_count || 0}枚</span>
          <span><i class="fa-solid fa-clock-rotate-left"></i> 残数: ${ticket.tickets - (ticket.exchanged_count || 0)}枚</span>
        </div>
        <div class="result-details-row">
          <span><i class="fa-solid fa-phone"></i> ${ticket.phone}</span>
          <span><i class="fa-solid fa-id-card"></i> ${ticket.id}</span>
        </div>
        ${ticket.notes ? `<div class="result-notes">備考: ${ticket.notes}</div>` : ''}
        ${ticket.exchange_time ? `<div class="result-notes text-success"><i class="fa-solid fa-clock"></i> 最終引換: ${ticket.exchange_time}</div>` : ''}
      </div>
      <div class="result-action">
        ${isExchangeable ? `<button class="btn btn-primary btn-exchange-direct" data-id="${ticket.id}"><i class="fa-solid fa-check"></i> 引換</button>` : ''}
      </div>
    `;

    // Hook click event to open quantity selector overlay
    if (isExchangeable) {
      card.querySelector('.btn-exchange-direct').addEventListener('click', (e) => {
        e.stopPropagation();
        initAudio(); // Initialize audio context on click
        const tId = e.currentTarget.getAttribute('data-id');
        openExchangeInput(tId);
      });
    }

    container.appendChild(card);
  });
}

// Manual Registration Validation & Submission
function initRegisterForm() {
  const form = document.getElementById('register-form');
  const btnRegOnly = document.getElementById('btn-reg-only');
  const btnRegExchange = document.getElementById('btn-reg-exchange');
  
  const banInput = document.getElementById('reg-ban');
  const nameInput = document.getElementById('reg-name');
  const kanaInput = document.getElementById('reg-kana');
  const phoneInput = document.getElementById('reg-phone');
  const ticketsInput = document.getElementById('reg-tickets');
  const notesInput = document.getElementById('reg-notes');

  // Input listener for auto-normalization
  banInput.addEventListener('blur', () => {
    banInput.value = normalizeZenToHan(banInput.value.trim());
  });

  phoneInput.addEventListener('input', () => {
    // Keep only numbers
    phoneInput.value = phoneInput.value.replace(/\D/g, '');
  });

  const validateForm = () => {
    let isValid = true;

    // Reset error styling
    document.querySelectorAll('.form-group').forEach(el => el.classList.remove('has-error'));

    // Validate Ban
    const banVal = normalizeZenToHan(banInput.value.trim());
    banInput.value = banVal;
    if (!banVal || !/^\d+-\d+班$/.test(banVal)) {
      banInput.parentElement.classList.add('has-error');
      isValid = false;
    }

    // Validate Name
    if (!nameInput.value.trim()) {
      nameInput.parentElement.classList.add('has-error');
      isValid = false;
    }

    // Validate Kana
    if (!kanaInput.value.trim()) {
      kanaInput.parentElement.classList.add('has-error');
      isValid = false;
    }

    // Validate Phone (at least 10-11 digits digits)
    const phoneVal = phoneInput.value.replace(/\D/g, '');
    phoneInput.value = phoneVal;
    if (!phoneVal || phoneVal.length < 8) {
      phoneInput.parentElement.classList.add('has-error');
      isValid = false;
    }

    // Validate Tickets
    const ticketCount = parseInt(ticketsInput.value, 10);
    if (isNaN(ticketCount) || ticketCount < 1) {
      ticketsInput.parentElement.classList.add('has-error');
      isValid = false;
    }

    return isValid;
  };

  const executeRegistration = async (status) => {
    initAudio();
    if (!validateForm()) return;

    const newId = generateNextId();
    const datetime = status === '引換済' ? getFormattedDatetime() : '';

    const newRecord = {
      id: newId,
      ban: banInput.value.trim(),
      name: nameInput.value.trim(),
      kana: kanaInput.value.trim(),
      phone: phoneInput.value.trim(),
      tickets: parseInt(ticketsInput.value, 10),
      status: status,
      exchange_time: datetime,
      method: '当日手動追加',
      notes: notesInput.value.trim()
    };

    const res = await registerTicket(newRecord);
    if (res) {
      playBeep('success');
      alert(`登録しました！\nチケットID: ${newId}\nステータス: ${status}`);
      form.reset();
      ticketsInput.value = '1';
    } else {
      alert('登録に失敗しました。');
    }
  };

  btnRegOnly.addEventListener('click', () => executeRegistration('未使用'));
  btnRegExchange.addEventListener('click', () => executeRegistration('引換済'));
}

// Settings Panel Logic
function initSettings() {
  const gasUrlInput = document.getElementById('gas-url');
  const btnSave = document.getElementById('btn-save-settings');
  const btnSync = document.getElementById('btn-sync-now');
  const btnInitMock = document.getElementById('btn-init-mock');

  gasUrlInput.value = state.gasUrl;
  btnSync.disabled = !state.gasUrl;

  btnSave.addEventListener('click', () => {
    const url = gasUrlInput.value.trim();
    state.gasUrl = url;
    localStorage.setItem('gas_url', url);
    btnSync.disabled = !url;
    updateIndicatorStatus('online');
    alert('設定を保存しました。');
  });

  btnSync.addEventListener('click', () => {
    if (state.gasUrl) {
      syncWithGAS();
    }
  });

  btnInitMock.addEventListener('click', () => {
    if (confirm('データベースを初期化し、デモ用のテストデータにリセットしますか？（ローカル保存分）')) {
      state.tickets = [...MOCK_DATA];
      saveDatabaseToLocalStorage();
      updateDashboard();
      alert('デモ用データベースを初期化しました。');
    }
  });
}

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
  loadDatabase();
  initTabs();
  initSearch();
  initRegisterForm();
  initSettings();
  initScanner();
  initOverlayControls(); // Set up counter buttons and confirm/cancel events
  initListFilters(); // Set up status filter pills for applicant list

  // Attach control events for Scanner Tab
  document.getElementById('btn-start-scan').addEventListener('click', startScanner);
  document.getElementById('btn-stop-scan').addEventListener('click', stopScanner);
  document.getElementById('btn-close-overlay').addEventListener('click', closeOverlay);
  document.getElementById('scan-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('scan-overlay')) {
      closeOverlay();
    }
  });
});
