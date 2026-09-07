/**
 * お祭り大抽選会システム (Festival Lottery Standalone App)
 * 完全独立型JavaScriptロジック
 */

// Application State
const lotteryState = {
  pool: [],            // All registered lottery numbers ['001', '002', ...]
  activeWinners: [],   // Currently won & awaiting claim [{ id, number, prize, wonAt, status: 'active' }]
  exchangedWinners: [],// Claimed & archived [{ id, number, prize, wonAt, exchangedAt, status: 'exchanged' }]
  invalidNumbers: [],  // Absent / disqualified [{ id, number, prize, wonAt, invalidatedAt, status: 'invalid' }]
  soundTheme: 'casino',
  sheetUrl: localStorage.getItem('lottery_sheet_url') || '',
  isSpinning: false,
  spinInterval: null,
  currentPrize: '1等 🥇',
  audioCtx: null,
  pendingWinner: null  // Current winner waiting modal action
};

// Storage Keys
const STORAGE_LOTTERY_POOL = 'fes_lottery_pool';
const STORAGE_LOTTERY_ACTIVE = 'fes_lottery_active_winners';
const STORAGE_LOTTERY_EXCHANGED = 'fes_lottery_exchanged_winners';
const STORAGE_LOTTERY_INVALID = 'fes_lottery_invalid_numbers';
const STORAGE_LOTTERY_SOUND = 'fes_lottery_sound_theme';

// ==========================================================================
// Utilities & Audio Context
// ==========================================================================

function initAudio() {
  if (!lotteryState.audioCtx) {
    lotteryState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (lotteryState.audioCtx.state === 'suspended') {
    lotteryState.audioCtx.resume();
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getLotteryDatetime() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// ==========================================================================
// Web Audio API Synthesizer Sound Engine
// ==========================================================================

class LotteryAudioEngine {
  constructor() {
    this.rollInterval = null;
  }

  // Play continuous spin sound depending on theme
  startSpinSound(theme) {
    initAudio();
    const ctx = lotteryState.audioCtx;
    if (!ctx || theme === 'mute') return;

    this.stopSpinSound();

    if (theme === 'casino') {
      let count = 0;
      this.rollInterval = setInterval(() => {
        if (!lotteryState.audioCtx) return;
        const now = lotteryState.audioCtx.currentTime;
        const osc = lotteryState.audioCtx.createOscillator();
        const gain = lotteryState.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(lotteryState.audioCtx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180 + (count % 4) * 25, now);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        osc.start(now);
        osc.stop(now + 0.045);
        count++;
      }, 55);
    } else if (theme === 'festival') {
      let step = 0;
      this.rollInterval = setInterval(() => {
        if (!lotteryState.audioCtx) return;
        const now = lotteryState.audioCtx.currentTime;
        const osc = lotteryState.audioCtx.createOscillator();
        const gain = lotteryState.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(lotteryState.audioCtx.destination);

        if (step % 2 === 0) {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(110, now);
          osc.frequency.exponentialRampToValueAtTime(45, now + 0.08);
          gain.gain.setValueAtTime(0.35, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.09);
          osc.start(now);
          osc.stop(now + 0.09);
        } else {
          osc.type = 'square';
          osc.frequency.setValueAtTime(1350, now);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.005, now + 0.04);
          osc.start(now);
          osc.stop(now + 0.04);
        }
        step++;
      }, 110);
    } else if (theme === 'cyber') {
      let freq = 600;
      this.rollInterval = setInterval(() => {
        if (!lotteryState.audioCtx) return;
        const now = lotteryState.audioCtx.currentTime;
        const osc = lotteryState.audioCtx.createOscillator();
        const gain = lotteryState.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(lotteryState.audioCtx.destination);
        freq = (freq + 120) > 1400 ? 500 : freq + 120;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.005, now + 0.04);
        osc.start(now);
        osc.stop(now + 0.04);
      }, 50);
    } else if (theme === 'retro') {
      let note = 440;
      this.rollInterval = setInterval(() => {
        if (!lotteryState.audioCtx) return;
        const now = lotteryState.audioCtx.currentTime;
        const osc = lotteryState.audioCtx.createOscillator();
        const gain = lotteryState.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(lotteryState.audioCtx.destination);
        note = (note === 440) ? 587 : 440;
        osc.type = 'square';
        osc.frequency.setValueAtTime(note, now);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
        osc.start(now);
        osc.stop(now + 0.06);
      }, 70);
    }
  }

  stopSpinSound() {
    if (this.rollInterval) {
      clearInterval(this.rollInterval);
      this.rollInterval = null;
    }
  }

  // Play fanfare when winner is revealed
  playFanfare(theme) {
    initAudio();
    const ctx = lotteryState.audioCtx;
    if (!ctx || theme === 'mute') return;

    const now = ctx.currentTime;

    if (theme === 'casino' || theme === 'cyber') {
      const notes = [
        { f: 523.25, t: 0.0, d: 0.15 }, // C5
        { f: 659.25, t: 0.15, d: 0.15 }, // E5
        { f: 783.99, t: 0.30, d: 0.18 }, // G5
        { f: 1046.50, t: 0.50, d: 0.90 } // High C6
      ];

      notes.forEach(n => {
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc2.type = 'triangle';
        osc.frequency.setValueAtTime(n.f, now + n.t);
        osc2.frequency.setValueAtTime(n.f * 1.003, now + n.t);
        gain.gain.setValueAtTime(0.25, now + n.t);
        gain.gain.exponentialRampToValueAtTime(0.01, now + n.t + n.d);
        osc.start(now + n.t);
        osc.stop(now + n.t + n.d);
        osc2.start(now + n.t);
        osc2.stop(now + n.t + n.d);
      });
    } else if (theme === 'festival') {
      // Gong low crash
      const gongOsc = ctx.createOscillator();
      const gongGain = ctx.createGain();
      gongOsc.connect(gongGain);
      gongGain.connect(ctx.destination);
      gongOsc.type = 'sine';
      gongOsc.frequency.setValueAtTime(220, now);
      gongOsc.frequency.exponentialRampToValueAtTime(80, now + 1.2);
      gongGain.gain.setValueAtTime(0.4, now);
      gongGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      gongOsc.start(now);
      gongOsc.stop(now + 1.2);

      // Festive melody
      const notes = [
        { f: 587.33, t: 0.1, d: 0.18 }, // D5
        { f: 659.25, t: 0.28, d: 0.18 }, // E5
        { f: 880.00, t: 0.46, d: 0.25 }, // A5
        { f: 1174.66, t: 0.72, d: 0.85 } // D6
      ];

      notes.forEach(n => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.f, now + n.t);
        gain.gain.setValueAtTime(0.3, now + n.t);
        gain.gain.exponentialRampToValueAtTime(0.01, now + n.t + n.d);
        osc.start(now + n.t);
        osc.stop(now + n.t + n.d);
      });
    } else if (theme === 'retro') {
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const t = idx * 0.08;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, now + t);
        gain.gain.setValueAtTime(0.2, now + t);
        gain.gain.exponentialRampToValueAtTime(0.01, now + t + 0.12);
        osc.start(now + t);
        osc.stop(now + t + 0.12);
      });
    }
  }

  // Play short beeps for feedback
  playBeep(type) {
    initAudio();
    const ctx = lotteryState.audioCtx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, now);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'warning') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    }
  }
}

const lotteryAudio = new LotteryAudioEngine();

// ==========================================================================
// Confetti Animation Effect
// ==========================================================================

class ConfettiEffect {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.particles = [];
    this.animId = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  burst() {
    if (!this.canvas || !this.ctx) return;
    this.resize();
    this.particles = [];
    const colors = ['#fbbf24', '#f59e0b', '#ec4899', '#38bdf8', '#4ade80', '#c084fc', '#ffffff'];

    for (let i = 0; i < 150; i++) {
      this.particles.push({
        x: this.canvas.width / 2,
        y: this.canvas.height * 0.4,
        vx: (Math.random() - 0.5) * 22,
        vy: (Math.random() - 0.7) * 22,
        size: Math.random() * 8 + 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rSpeed: (Math.random() - 0.5) * 12,
        opacity: 1,
        shape: Math.random() > 0.3 ? 'rect' : 'circle'
      });
    }

    if (this.animId) cancelAnimationFrame(this.animId);
    this.render();
  }

  render() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    let activeCount = 0;
    this.particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.45;
      p.vx *= 0.98;
      p.rotation += p.rSpeed;
      p.opacity -= 0.007;

      if (p.opacity > 0 && p.y < this.canvas.height + 20) {
        activeCount++;
        this.ctx.save();
        this.ctx.translate(p.x, p.y);
        this.ctx.rotate((p.rotation * Math.PI) / 180);
        this.ctx.globalAlpha = Math.max(0, p.opacity);
        this.ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
          this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        } else {
          this.ctx.beginPath();
          this.ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          this.ctx.fill();
        }
        this.ctx.restore();
      }
    });

    if (activeCount > 0) {
      this.animId = requestAnimationFrame(() => this.render());
    } else {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.animId = null;
    }
  }
}

let confetti = null;

// ==========================================================================
// Data Load & Save
// ==========================================================================

function loadLotteryData() {
  try {
    const savedPool = localStorage.getItem(STORAGE_LOTTERY_POOL);
    const savedActive = localStorage.getItem(STORAGE_LOTTERY_ACTIVE);
    const savedExchanged = localStorage.getItem(STORAGE_LOTTERY_EXCHANGED);
    const savedInvalid = localStorage.getItem(STORAGE_LOTTERY_INVALID);
    const savedSound = localStorage.getItem(STORAGE_LOTTERY_SOUND);

    lotteryState.pool = savedPool ? JSON.parse(savedPool) : [];
    lotteryState.activeWinners = savedActive ? JSON.parse(savedActive) : [];
    lotteryState.exchangedWinners = savedExchanged ? JSON.parse(savedExchanged) : [];
    lotteryState.invalidNumbers = savedInvalid ? JSON.parse(savedInvalid) : [];
    if (savedSound) lotteryState.soundTheme = savedSound;

    // Default 100 tickets if brand new
    if (lotteryState.pool.length === 0 && lotteryState.activeWinners.length === 0) {
      const initialPool = [];
      for (let i = 1; i <= 100; i++) {
        initialPool.push(String(i).padStart(3, '0'));
      }
      lotteryState.pool = initialPool;
      saveLotteryData();
    }
  } catch (e) {
    console.error('Failed to load lottery data:', e);
    lotteryState.pool = [];
    lotteryState.activeWinners = [];
    lotteryState.exchangedWinners = [];
    lotteryState.invalidNumbers = [];
  }
}

function saveLotteryData() {
  try {
    localStorage.setItem(STORAGE_LOTTERY_POOL, JSON.stringify(lotteryState.pool));
    localStorage.setItem(STORAGE_LOTTERY_ACTIVE, JSON.stringify(lotteryState.activeWinners));
    localStorage.setItem(STORAGE_LOTTERY_EXCHANGED, JSON.stringify(lotteryState.exchangedWinners));
    localStorage.setItem(STORAGE_LOTTERY_INVALID, JSON.stringify(lotteryState.invalidNumbers));
    localStorage.setItem(STORAGE_LOTTERY_SOUND, lotteryState.soundTheme);
  } catch (e) {
    console.error('Failed to save lottery data:', e);
  }
}

function getUsedNumbersSet() {
  const set = new Set();
  lotteryState.activeWinners.forEach(w => set.add(w.number));
  lotteryState.exchangedWinners.forEach(w => set.add(w.number));
  lotteryState.invalidNumbers.forEach(w => set.add(w.number));
  return set;
}

function getAvailableLotteryNumbers() {
  const used = getUsedNumbersSet();
  return lotteryState.pool.filter(num => !used.has(num));
}

// ==========================================================================
// Initialization & Events
// ==========================================================================

window.addEventListener('DOMContentLoaded', () => {
  loadLotteryData();
  confetti = new ConfettiEffect('confetti-canvas');

  // DOM Elements
  const topNavButtons = document.querySelectorAll('.nav-tab-btn');
  const btnStart = document.getElementById('btn-lottery-start');
  const btnStop = document.getElementById('btn-lottery-stop');
  const prizeSelect = document.getElementById('lottery-prize-select');
  const prizeCustom = document.getElementById('lottery-prize-custom');
  const soundSelect = document.getElementById('lottery-sound-theme');
  const btnTestSound = document.getElementById('btn-test-sound');
  const btnFullscreen = document.getElementById('btn-toggle-fullscreen');

  // Winner Modal Elements
  const btnModalClaim = document.getElementById('btn-modal-claim');
  const btnModalKeep = document.getElementById('btn-modal-keep');
  const btnModalAbsent = document.getElementById('btn-modal-absent');

  // Data Section Elements
  const btnSyncSheet = document.getElementById('btn-sync-lottery-sheet');
  const btnSaveSheetUrl = document.getElementById('btn-save-lottery-url');
  const sheetUrlInput = document.getElementById('lottery-sheet-url');
  const btnQuickAdd = document.getElementById('btn-lottery-quick-add');
  const quickAddInput = document.getElementById('lottery-quick-add-input');
  const btnGen = document.getElementById('btn-lottery-gen');
  const genStart = document.getElementById('lottery-gen-start');
  const genEnd = document.getElementById('lottery-gen-end');
  const genDigits = document.getElementById('lottery-gen-digits');
  const btnBulkImport = document.getElementById('btn-lottery-bulk-import');
  const btnBulkReplace = document.getElementById('btn-lottery-bulk-replace');
  const bulkText = document.getElementById('lottery-bulk-paste-text');
  const btnClearPool = document.getElementById('btn-clear-lottery-pool');
  const poolSearchInput = document.getElementById('pool-search-input');
  const btnExport = document.getElementById('btn-export-lottery');

  // Subtabs (Active, Exchanged, Invalid)
  const subtabButtons = document.querySelectorAll('.sub-tab-btn');

  // Set initial UI
  soundSelect.value = lotteryState.soundTheme;
  sheetUrlInput.value = lotteryState.sheetUrl;

  updateLotteryStats();
  renderWinnerLists();
  renderPoolPreview();

  // Navigation Tab Switching
  topNavButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      topNavButtons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.lottery-panel').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const target = document.getElementById(btn.getAttribute('data-tab'));
      if (target) target.classList.add('active');
    });
  });

  // Prize Selector
  prizeSelect.addEventListener('change', () => {
    if (prizeSelect.value === 'custom') {
      prizeCustom.classList.remove('hidden');
      prizeCustom.focus();
      lotteryState.currentPrize = prizeCustom.value.trim() || '特別賞';
    } else {
      prizeCustom.classList.add('hidden');
      lotteryState.currentPrize = prizeSelect.value;
    }
    document.getElementById('lottery-display-prize').textContent = `${lotteryState.currentPrize} 抽選中`;
  });

  prizeCustom.addEventListener('input', () => {
    lotteryState.currentPrize = prizeCustom.value.trim() || '特別賞';
    document.getElementById('lottery-display-prize').textContent = `${lotteryState.currentPrize} 抽選中`;
  });

  // Sound Theme
  soundSelect.addEventListener('change', () => {
    lotteryState.soundTheme = soundSelect.value;
    saveLotteryData();
  });

  btnTestSound.addEventListener('click', () => {
    lotteryAudio.playFanfare(lotteryState.soundTheme);
  });

  document.querySelectorAll('.btn-play-sample').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme');
      lotteryAudio.playFanfare(theme);
    });
  });

  // Fullscreen Mode
  btnFullscreen.addEventListener('click', () => {
    document.body.classList.toggle('fullscreen-lottery');
    const isFull = document.body.classList.contains('fullscreen-lottery');
    btnFullscreen.innerHTML = isFull ?
      '<i class="fa-solid fa-compress"></i> 通常モード' :
      '<i class="fa-solid fa-expand"></i> 大画面モード';
    
    // Switch to stage tab
    document.querySelector('.nav-tab-btn[data-tab="tab-stage"]').click();
  });

  // Management Subtabs
  subtabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      subtabButtons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.lottery-subtab-panel').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(btn.getAttribute('data-subtab'));
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // Lottery Spin Start / Stop
  btnStart.addEventListener('click', startLotterySpin);
  btnStop.addEventListener('click', stopLotterySpin);

  // Winner Modal Actions
  btnModalClaim.addEventListener('click', () => {
    if (lotteryState.pendingWinner) {
      claimWinner(lotteryState.pendingWinner.id);
      closeWinnerModal();
    }
  });

  btnModalKeep.addEventListener('click', () => {
    closeWinnerModal();
  });

  btnModalAbsent.addEventListener('click', () => {
    if (lotteryState.pendingWinner) {
      invalidateWinner(lotteryState.pendingWinner.id);
      closeWinnerModal();
    }
  });

  // Data Section: Spreadsheet
  btnSaveSheetUrl.addEventListener('click', () => {
    lotteryState.sheetUrl = sheetUrlInput.value.trim();
    localStorage.setItem('lottery_sheet_url', lotteryState.sheetUrl);
    alert('スプレッドシートURLを保存しました。');
  });

  btnSyncSheet.addEventListener('click', syncLotteryFromSheet);

  // Data Section: Quick Add
  btnQuickAdd.addEventListener('click', () => {
    const val = quickAddInput.value.trim();
    if (!val) return;
    const added = addLotteryNumbersFromExpression(val);
    if (added > 0) {
      quickAddInput.value = '';
      saveLotteryData();
      updateLotteryStats();
      renderPoolPreview();
      lotteryAudio.playBeep('success');
      alert(`${added} 件の抽選番号を追加しました！`);
    } else {
      alert('有効な番号が見つからなかったか、既に登録されています。');
    }
  });

  // Data Section: Generate
  btnGen.addEventListener('click', () => {
    const start = parseInt(genStart.value, 10);
    const end = parseInt(genEnd.value, 10);
    const digits = parseInt(genDigits.value, 10) || 1;

    if (isNaN(start) || isNaN(end) || start > end) {
      alert('正しい開始・終了番号を入力してください。');
      return;
    }

    let addedCount = 0;
    const currentSet = new Set(lotteryState.pool);
    for (let i = start; i <= end; i++) {
      const numStr = String(i).padStart(digits, '0');
      if (!currentSet.has(numStr)) {
        lotteryState.pool.push(numStr);
        currentSet.add(numStr);
        addedCount++;
      }
    }

    saveLotteryData();
    updateLotteryStats();
    renderPoolPreview();
    lotteryAudio.playBeep('success');
    alert(`${addedCount} 件の連番を登録しました！（重複除外済）`);
  });

  // Data Section: Bulk Import / Replace
  btnBulkImport.addEventListener('click', () => {
    const text = bulkText.value.trim();
    if (!text) return;
    const added = parseAndAddBulkNumbers(text, false);
    if (added > 0) {
      bulkText.value = '';
      saveLotteryData();
      updateLotteryStats();
      renderPoolPreview();
      lotteryAudio.playBeep('success');
      alert(`${added} 件の番号を追加しました！`);
    } else {
      alert('有効な新しい番号が見つかりませんでした。');
    }
  });

  btnBulkReplace.addEventListener('click', () => {
    const text = bulkText.value.trim();
    if (!text) {
      alert('番号リストを入力してください。');
      return;
    }
    if (confirm('既存の番号プールをすべて置き換えますか？')) {
      parseAndAddBulkNumbers(text, true);
      bulkText.value = '';
      saveLotteryData();
      updateLotteryStats();
      renderPoolPreview();
      lotteryAudio.playBeep('success');
      alert('抽選プールを置き換えました！');
    }
  });

  // Clear Pool
  btnClearPool.addEventListener('click', () => {
    if (confirm('登録されているすべての抽選番号および当選・引換・無効履歴を初期化しますか？')) {
      lotteryState.pool = [];
      lotteryState.activeWinners = [];
      lotteryState.exchangedWinners = [];
      lotteryState.invalidNumbers = [];
      saveLotteryData();
      updateLotteryStats();
      renderWinnerLists();
      renderPoolPreview();
      alert('抽選データを初期化しました。');
    }
  });

  // Pool Search Filter
  poolSearchInput.addEventListener('input', () => {
    renderPoolPreview(poolSearchInput.value.trim());
  });

  // Export Results
  btnExport.addEventListener('click', exportLotteryResults);
});

// ==========================================================================
// Parsing & Helpers
// ==========================================================================

function addLotteryNumbersFromExpression(expr) {
  const currentSet = new Set(lotteryState.pool);
  let added = 0;

  if (expr.includes('-') && /^\d+-\d+$/.test(expr)) {
    const parts = expr.split('-').map(Number);
    const min = Math.min(parts[0], parts[1]);
    const max = Math.max(parts[0], parts[1]);
    const digits = Math.max(parts[0].toString().length, parts[1].toString().length);

    for (let i = min; i <= max; i++) {
      const nStr = String(i).padStart(digits, '0');
      if (!currentSet.has(nStr)) {
        lotteryState.pool.push(nStr);
        currentSet.add(nStr);
        added++;
      }
    }
  } else {
    if (!currentSet.has(expr)) {
      lotteryState.pool.push(expr);
      added++;
    }
  }
  return added;
}

function parseAndAddBulkNumbers(text, replaceAll = false) {
  const rawList = text.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
  if (replaceAll) {
    lotteryState.pool = [];
  }
  const currentSet = new Set(lotteryState.pool);
  let added = 0;

  rawList.forEach(item => {
    if (!currentSet.has(item)) {
      lotteryState.pool.push(item);
      currentSet.add(item);
      added++;
    }
  });
  return added;
}

// Spreadsheet Sync
async function syncLotteryFromSheet() {
  const url = lotteryState.sheetUrl || document.getElementById('lottery-sheet-url').value.trim();
  if (!url) {
    alert('GoogleスプレッドシートのCSVエクスポートURL、またはWebアプリURLを入力してください。');
    return;
  }

  const btnSync = document.getElementById('btn-sync-lottery-sheet');
  const originalText = btnSync.innerHTML;
  btnSync.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 読込中...';
  btnSync.disabled = true;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const text = await res.text();

    let parsedNumbers = [];
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json)) {
        parsedNumbers = json.map(item => typeof item === 'object' ? (item.number || item.id || Object.values(item)[0]) : item);
      } else if (json.numbers && Array.isArray(json.numbers)) {
        parsedNumbers = json.numbers;
      }
    } catch {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      lines.forEach((line, idx) => {
        const cols = line.split(',').map(c => c.replace(/^["']|["']$/g, '').trim());
        if (cols[0]) {
          if (idx === 0 && (cols[0].includes('番号') || cols[0].includes('ID') || cols[0].includes('Number'))) {
            return;
          }
          parsedNumbers.push(cols[0]);
        }
      });
    }

    if (parsedNumbers.length === 0) {
      alert('スプレッドシートから抽選番号を取得できませんでした。形式をご確認ください。');
      return;
    }

    const currentSet = new Set(lotteryState.pool);
    let added = 0;
    parsedNumbers.forEach(n => {
      const numStr = String(n).trim();
      if (numStr && !currentSet.has(numStr)) {
        lotteryState.pool.push(numStr);
        currentSet.add(numStr);
        added++;
      }
    });

    saveLotteryData();
    updateLotteryStats();
    renderPoolPreview();
    lotteryAudio.playBeep('success');
    alert(`スプレッドシートから読み込み完了！\n取得総数: ${parsedNumbers.length} 件\n新規追加: ${added} 件`);
  } catch (err) {
    console.error('Spreadsheet sync error:', err);
    alert(`スプレッドシートの取得に失敗しました。\nURLが公開されているか、またはCORS設定をご確認ください。\n\n詳細: ${err.message}`);
  } finally {
    btnSync.innerHTML = originalText;
    btnSync.disabled = false;
  }
}

// ==========================================================================
// Lottery Spin Execution
// ==========================================================================

function startLotterySpin() {
  const available = getAvailableLotteryNumbers();
  if (available.length === 0) {
    alert('抽選可能な番号がありません！\n番号を追加するか、プールを確認してください。');
    return;
  }

  lotteryState.isSpinning = true;
  const btnStart = document.getElementById('btn-lottery-start');
  const btnStop = document.getElementById('btn-lottery-stop');
  const reelNumber = document.getElementById('reel-number');
  const statusMsg = document.getElementById('lottery-status-msg');

  btnStart.classList.add('hidden');
  btnStop.classList.remove('hidden');
  reelNumber.classList.add('spinning');
  reelNumber.classList.remove('winner-reveal');
  statusMsg.textContent = '抽選中... ドキドキ！';

  lotteryAudio.startSpinSound(lotteryState.soundTheme);

  lotteryState.spinInterval = setInterval(() => {
    const randIdx = Math.floor(Math.random() * available.length);
    reelNumber.textContent = available[randIdx];
  }, 45);
}

function stopLotterySpin() {
  if (!lotteryState.isSpinning) return;
  lotteryState.isSpinning = false;

  const btnStart = document.getElementById('btn-lottery-start');
  const btnStop = document.getElementById('btn-lottery-stop');
  const reelNumber = document.getElementById('reel-number');
  const statusMsg = document.getElementById('lottery-status-msg');

  lotteryAudio.stopSpinSound();
  if (lotteryState.spinInterval) {
    clearInterval(lotteryState.spinInterval);
    lotteryState.spinInterval = null;
  }

  const available = getAvailableLotteryNumbers();
  if (available.length === 0) {
    reelNumber.textContent = '----';
    return;
  }

  const winnerNumber = available[Math.floor(Math.random() * available.length)];
  const currentPrize = lotteryState.currentPrize;
  const wonAt = getLotteryDatetime();

  const winnerRecord = {
    id: 'WIN-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    number: winnerNumber,
    prize: currentPrize,
    wonAt: wonAt,
    status: 'active'
  };

  lotteryState.activeWinners.unshift(winnerRecord);
  lotteryState.pendingWinner = winnerRecord;
  saveLotteryData();

  reelNumber.textContent = winnerNumber;
  reelNumber.classList.remove('spinning');
  reelNumber.classList.add('winner-reveal');
  statusMsg.textContent = `🎉 【${currentPrize}】 当選番号: ${winnerNumber} ！`;

  btnStop.classList.add('hidden');
  btnStart.classList.remove('hidden');

  lotteryAudio.playFanfare(lotteryState.soundTheme);
  confetti.burst();

  updateLotteryStats();
  renderWinnerLists();
  renderPoolPreview();

  setTimeout(() => {
    showWinnerModal(winnerRecord);
  }, 700);
}

function showWinnerModal(winner) {
  const modal = document.getElementById('winner-modal');
  document.getElementById('modal-prize-title').textContent = `${winner.prize} 当選！`;
  document.getElementById('modal-winner-number').textContent = winner.number;
  modal.classList.remove('hidden');
}

function closeWinnerModal() {
  const modal = document.getElementById('winner-modal');
  modal.classList.add('hidden');
  lotteryState.pendingWinner = null;
}

// Claim (引換完了 -> 引換済アーカイブへ)
function claimWinner(winnerId) {
  const idx = lotteryState.activeWinners.findIndex(w => w.id === winnerId);
  if (idx === -1) return;

  const item = lotteryState.activeWinners.splice(idx, 1)[0];
  item.status = 'exchanged';
  item.exchangedAt = getLotteryDatetime();
  lotteryState.exchangedWinners.unshift(item);

  saveLotteryData();
  updateLotteryStats();
  renderWinnerLists();
  renderPoolPreview();
  lotteryAudio.playBeep('success');
}

// Invalidate (不在・無効化 -> 再抽選プールには戻さない！)
function invalidateWinner(winnerId) {
  const idx = lotteryState.activeWinners.findIndex(w => w.id === winnerId);
  if (idx === -1) return;

  const item = lotteryState.activeWinners.splice(idx, 1)[0];
  item.status = 'invalid';
  item.invalidatedAt = getLotteryDatetime();
  lotteryState.invalidNumbers.unshift(item);

  saveLotteryData();
  updateLotteryStats();
  renderWinnerLists();
  renderPoolPreview();
  lotteryAudio.playBeep('warning');
}

// Restore
function restoreExchangedToActive(id) {
  const idx = lotteryState.exchangedWinners.findIndex(w => w.id === id);
  if (idx === -1) return;
  const item = lotteryState.exchangedWinners.splice(idx, 1)[0];
  item.status = 'active';
  delete item.exchangedAt;
  lotteryState.activeWinners.unshift(item);
  saveLotteryData();
  updateLotteryStats();
  renderWinnerLists();
  renderPoolPreview();
}

function removePoolNumber(num) {
  lotteryState.pool = lotteryState.pool.filter(n => n !== num);
  saveLotteryData();
  updateLotteryStats();
  renderPoolPreview();
}

// ==========================================================================
// Renderers
// ==========================================================================

function updateLotteryStats() {
  const total = lotteryState.pool.length;
  const available = getAvailableLotteryNumbers().length;
  const activeCount = lotteryState.activeWinners.length;
  const exchangedCount = lotteryState.exchangedWinners.length;
  const invalidCount = lotteryState.invalidNumbers.length;

  document.getElementById('lottery-total-count').textContent = total;
  document.getElementById('lottery-remaining-count').textContent = available;
  document.getElementById('lottery-won-count').textContent = activeCount;
  document.getElementById('lottery-claimed-count').textContent = exchangedCount;
  document.getElementById('lottery-invalid-count').textContent = invalidCount;

  document.getElementById('badge-nav-active').textContent = activeCount;
  document.getElementById('badge-nav-pool').textContent = total;
  document.getElementById('badge-active-count').textContent = activeCount;
  document.getElementById('badge-exchanged-count').textContent = exchangedCount;
  document.getElementById('badge-invalid-count').textContent = invalidCount;
  document.getElementById('preview-total-count').textContent = total;
}

function renderWinnerLists() {
  // Render cards for both Stage quick preview and Winners tab
  const renderCardHtml = (w) => `
    <div class="winner-card" data-id="${w.id}">
      <div class="winner-card-top">
        <span class="winner-prize-tag">${escapeHtml(w.prize)}</span>
        <span class="winner-time"><i class="fa-regular fa-clock"></i> ${escapeHtml(w.wonAt)}</span>
      </div>
      <div class="winner-card-body">
        <div class="winner-number-text">${escapeHtml(w.number)}</div>
      </div>
      <div class="winner-card-actions">
        <button class="btn-card-claim" onclick="claimWinner('${w.id}')">
          <i class="fa-solid fa-check"></i> 引換完了
        </button>
        <button class="btn-card-absent" onclick="invalidateWinner('${w.id}')" title="不在のため無効（再抽選には戻りません）">
          <i class="fa-solid fa-ban"></i> 不在・無効
        </button>
      </div>
    </div>`;

  const activeContainer = document.getElementById('winners-active-list');
  const stageActiveContainer = document.getElementById('stage-active-winners-list');

  if (lotteryState.activeWinners.length === 0) {
    const emptyHtml = `
      <div class="empty-state">
        <i class="fa-solid fa-gift"></i>
        <p>現在引換待ちの当選番号はありません。「抽選スタート」で抽選を行いましょう！</p>
      </div>`;
    activeContainer.innerHTML = emptyHtml;
    stageActiveContainer.innerHTML = emptyHtml;
  } else {
    const cardsHtml = lotteryState.activeWinners.map(renderCardHtml).join('');
    activeContainer.innerHTML = cardsHtml;
    stageActiveContainer.innerHTML = cardsHtml;
  }

  // Exchanged Table
  const exchangedTbody = document.getElementById('winners-exchanged-tbody');
  if (lotteryState.exchangedWinners.length === 0) {
    exchangedTbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 24px; color: var(--text-muted);">引換完了済の当選番号はありません</td></tr>';
  } else {
    exchangedTbody.innerHTML = lotteryState.exchangedWinners.map(w => `
      <tr>
        <td><span class="winner-prize-tag">${escapeHtml(w.prize)}</span></td>
        <td><strong class="text-neon-cyan" style="font-size: 1.15rem;">${escapeHtml(w.number)}</strong></td>
        <td>${escapeHtml(w.wonAt)}</td>
        <td><span class="text-success"><i class="fa-solid fa-circle-check"></i> ${escapeHtml(w.exchangedAt || '')}</span></td>
        <td>
          <button class="btn btn-secondary-neon btn-sm" onclick="restoreExchangedToActive('${w.id}')" title="引換待ちに戻す">
            <i class="fa-solid fa-rotate-left"></i> 戻す
          </button>
        </td>
      </tr>
    `).join('');
  }

  // Invalid Table
  const invalidTbody = document.getElementById('winners-invalid-tbody');
  if (lotteryState.invalidNumbers.length === 0) {
    invalidTbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding: 24px; color: var(--text-muted);">不在・無効化された番号はありません</td></tr>';
  } else {
    invalidTbody.innerHTML = lotteryState.invalidNumbers.map(w => `
      <tr>
        <td><span class="winner-prize-tag" style="border-color: rgba(248,113,113,0.4); color: var(--color-neon-red);">${escapeHtml(w.prize)}</span></td>
        <td><strong class="text-danger" style="font-size: 1.15rem; text-decoration: line-through;">${escapeHtml(w.number)}</strong></td>
        <td>${escapeHtml(w.wonAt)}</td>
        <td><span class="text-warning"><i class="fa-solid fa-ban"></i> ${escapeHtml(w.invalidatedAt || '')}</span></td>
        <td><span class="badge-pill" style="background: rgba(248,113,113,0.2); color: var(--color-neon-red); font-size: 0.75rem;">再抽選除外済</span></td>
      </tr>
    `).join('');
  }
}

function renderPoolPreview(filter = '') {
  const container = document.getElementById('pool-chips-list');
  const usedWon = new Set(lotteryState.activeWinners.map(w => w.number));
  const usedExchanged = new Set(lotteryState.exchangedWinners.map(w => w.number));
  const usedInvalid = new Set(lotteryState.invalidNumbers.map(w => w.number));

  let list = lotteryState.pool;
  if (filter) {
    list = list.filter(n => n.toLowerCase().includes(filter.toLowerCase()));
  }

  if (list.length === 0) {
    container.innerHTML = '<span style="color: var(--text-muted); font-size: 0.85rem; padding: 6px;">登録番号がありません</span>';
    return;
  }

  const displayList = list.slice(0, 250);
  let html = displayList.map(num => {
    let cls = 'pool-chip';
    let statusTip = '';
    if (usedWon.has(num)) {
      cls += ' won';
      statusTip = ' (当選中)';
    } else if (usedExchanged.has(num)) {
      cls += ' won';
      statusTip = ' (引換済)';
    } else if (usedInvalid.has(num)) {
      cls += ' invalid';
      statusTip = ' (不在無効)';
    }

    return `<span class="${cls}" title="${num}${statusTip}">
      ${escapeHtml(num)}
      <i class="fa-solid fa-xmark btn-remove-chip" onclick="removePoolNumber('${num}')" title="削除"></i>
    </span>`;
  }).join('');

  if (list.length > 250) {
    html += `<span style="color: var(--text-muted); font-size: 0.8rem; align-self: center;">他 ${list.length - 250} 件...</span>`;
  }

  container.innerHTML = html;
}

function exportLotteryResults() {
  let text = "【お祭り大抽選会 当選結果一覧】\n\n";
  text += "■ 当選（引換完了）:\n";
  lotteryState.exchangedWinners.forEach(w => {
    text += `${w.prize} | 番号: ${w.number} | 当選: ${w.wonAt} | 引換完了: ${w.exchangedAt}\n`;
  });

  text += "\n■ 当選中（引換待ち）:\n";
  lotteryState.activeWinners.forEach(w => {
    text += `${w.prize} | 番号: ${w.number} | 当選: ${w.wonAt}\n`;
  });

  text += "\n■ 不在・無効（再抽選除外）:\n";
  lotteryState.invalidNumbers.forEach(w => {
    text += `${w.prize} | 番号: ${w.number} | 当選: ${w.wonAt} | 無効化: ${w.invalidatedAt}\n`;
  });

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lottery_result_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
}
