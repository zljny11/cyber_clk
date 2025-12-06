// ==========================================
// 0. WORKER & DATA DEFINITION
// ==========================================
const workerScript = `
    self.onmessage = function(e) {
        if (e.data === 'start') {
            if (self.timer) clearInterval(self.timer);
            self.timer = setInterval(() => {
                self.postMessage('tick');
            }, 1000);
        } else if (e.data === 'stop') {
            if (self.timer) clearInterval(self.timer);
        }
    };
`;
const workerBlob = new Blob([workerScript], { type: 'application/javascript' });
const timerWorker = new Worker(URL.createObjectURL(workerBlob));

const ACH_DEFS = {
    'rookie': { icon: '🐣', title: '初出茅厕: 累计专注1小时' },
    'thinker': { icon: '🧠', title: '赛博思想家: 累计专注15小时' },
    'resilient': { icon: '🛡️', title: '百蛰不挠: 中断后仍完成任务' },
    'durable': { icon: '🔋', title: '持久还得看你: 连续7天使用' },
    'highroller': { icon: '💎', title: '高分玩家: 最近10次均分>4' }
};

let appState = {
    active: false,
    paused: false,
    mode: 'work',
    timeLeft: 25 * 60,
    endTime: 0,
    pauseEndTime: 0,
    totalTime: 25 * 60,
    currentTask: '',
    hasPausedInSession: false,
    tempRating: 3
};

let config = { work: 25, break: 5 };

// ==========================================
// 1. INITIALIZATION & EVENTS (核心修复区)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initThree();
    renderAchievements();

    // 顶部导航按钮
    document.getElementById('btn-bgm').addEventListener('click', () => document.getElementById('music-input').click());
    document.getElementById('btn-bg').addEventListener('click', () => document.getElementById('bg-input').click());
    document.getElementById('btn-sys').addEventListener('click', (e) => togglePanel('settings', e));
    document.getElementById('btn-stats').addEventListener('click', (e) => togglePanel('stats', e));

    // 主功能按钮
    document.getElementById('action-btn').addEventListener('click', handleMainAction);
    document.getElementById('pause-btn').addEventListener('click', () => {
        if (appState.paused) resumeTimer();
        else requestPause();
    });

    // 弹窗按钮
    document.getElementById('confirm-pause-btn').addEventListener('click', confirmPause);
    document.getElementById('cancel-pause-btn').addEventListener('click', cancelPauseRequest);
    document.getElementById('submit-rating-btn').addEventListener('click', submitRating);
    document.getElementById('purge-btn').addEventListener('click', purgeData);
    document.getElementById('save-cfg-btn').addEventListener('click', saveSettings);

    // 星星评分逻辑
    document.querySelectorAll('.star-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const val = parseInt(e.target.dataset.v);
            setRating(val);
        });
    });

    // 关闭面板按钮
    document.querySelectorAll('.close-panel-btn').forEach(btn => {
        btn.addEventListener('click', closeAllPanels);
    });

    // 文件上传监听
    document.getElementById('bg-input').addEventListener('change', function () { loadBackground(this) });
    document.getElementById('music-input').addEventListener('change', function () { loadMusic(this) });

    // 点击背景关闭面板
    document.addEventListener('click', (e) => {
        const isClickInsidePanel = e.target.closest('.slide-panel');
        const isClickButton = e.target.closest('.nav-btn');
        const isPurgeButton = e.target.closest('.purge-btn');
        if (!isClickInsidePanel && !isClickButton && !isPurgeButton) {
            closeAllPanels();
        }
    });

    // 加载配置
    const savedCfg = localStorage.getItem('cp_config');
    if (savedCfg) config = JSON.parse(savedCfg);
    document.getElementById('cfg-work').value = config.work;
    document.getElementById('cfg-break').value = config.break;

    updateTimerDisplay();

    timerWorker.onmessage = (e) => {
        if (e.data === 'tick') {
            if (appState.active && !appState.paused) {
                tick();
            } else if (appState.paused) {
                pauseTick();
            }
        }
    };
});

// ==========================================
// 2. CORE TIMER LOGIC
// ==========================================
function handleMainAction() {
    if (appState.active) {
        if (confirm('警告：强行中止连接会导致数据丢失（任务失败）。确认？')) {
            failTask('主动放弃');
        }
    } else {
        if (appState.mode === 'work' && !document.getElementById('task-input').value.trim()) {
            alert('错误：必须指定任务目标');
            return;
        }
        startTimer();
    }
}

function startTimer() {
    appState.active = true;
    appState.paused = false;
    appState.hasPausedInSession = false;
    appState.currentTask = document.getElementById('task-input').value;
    appState.totalTime = (appState.mode === 'work' ? config.work : config.break) * 60;

    appState.endTime = Date.now() + appState.totalTime * 1000;
    appState.timeLeft = appState.totalTime;

    document.getElementById('task-input').disabled = true;
    document.getElementById('action-btn').innerText = "中止入侵";
    document.getElementById('action-btn').style.background = "var(--cp-red)";
    document.getElementById('pause-btn').style.display = appState.mode === 'work' ? 'block' : 'none';

    const badge = document.getElementById('status-badge');
    badge.innerText = appState.mode === 'work' ? "BREACH IN PROGRESS" : "SYSTEM REBOOTING";
    badge.style.color = appState.mode === 'work' ? "var(--cp-red)" : "var(--cp-blue)";

    updateTimerDisplay();

    const bgm = document.getElementById('bgm-player');
    if (bgm.src) bgm.play().catch(() => { });

    timerWorker.postMessage('start');
}

function tick() {
    const now = Date.now();
    const remaining = Math.round((appState.endTime - now) / 1000);

    appState.timeLeft = remaining;

    if (appState.timeLeft <= 0) {
        appState.timeLeft = 0;
        updateTimerDisplay();
        updateProgressBar();
        completeSession();
    } else {
        updateTimerDisplay();
        updateProgressBar();
    }
}

// ==========================================
// 3. PAUSE PROTOCOL
// ==========================================
function requestPause() {
    document.getElementById('pause-modal').style.display = 'flex';
    document.getElementById('pause-reason-input').value = '';
    document.getElementById('confirm-pause-btn').disabled = false;
}

function cancelPauseRequest() {
    document.getElementById('pause-modal').style.display = 'none';
}

function confirmPause() {
    const btn = document.getElementById('confirm-pause-btn');
    btn.disabled = true;

    const reason = document.getElementById('pause-reason-input').value.trim();
    if (reason.length < 10) {
        alert('理由不够充分 (至少10字)');
        btn.disabled = false;
        return;
    }

    document.getElementById('pause-modal').style.display = 'none';
    appState.paused = true;
    appState.hasPausedInSession = true;

    appState.pauseEndTime = Date.now() + 600 * 1000;

    document.getElementById('status-badge').innerText = "CONNECTION SUSPENDED";
    document.getElementById('pause-btn').innerText = "恢复连接";

    document.getElementById('bgm-player').pause();
}

function pauseTick() {
    const pNow = Date.now();
    const pRem = Math.round((appState.pauseEndTime - pNow) / 1000);

    document.title = `${formatTime(pRem)} | ⚠️ PAUSED`;

    if (pRem <= 0) {
        failTask('暂停超时 (神经连接断开)');
    }
}

function resumeTimer() {
    appState.paused = false;
    appState.endTime = Date.now() + appState.timeLeft * 1000;

    document.getElementById('status-badge').innerText = "BREACH IN PROGRESS";
    document.getElementById('pause-btn').innerText = "// 申请挂起";

    const bgm = document.getElementById('bgm-player');
    if (bgm.src) bgm.play().catch(() => { });

    updateTimerDisplay();
}

// ==========================================
// 4. COMPLETION & FAIL
// ==========================================
function completeSession() {
    timerWorker.postMessage('stop');
    playBeep();

    if (appState.mode === 'work') {
        document.getElementById('rating-modal').style.display = 'flex';
        document.getElementById('submit-rating-btn').disabled = false;
        setRating(3);
    } else {
        alert("系统冷却完毕。");
        appState.mode = 'work';
        resetUI();
    }
}

function failTask(reason) {
    timerWorker.postMessage('stop');
    saveRecord(appState.currentTask, (appState.totalTime - appState.timeLeft) / 60, 0, false, reason);
    alert(`任务失败: ${reason}`);
    resetUI();
}

function submitRating() {
    const btn = document.getElementById('submit-rating-btn');
    btn.disabled = true;

    document.getElementById('rating-modal').style.display = 'none';
    saveRecord(appState.currentTask, config.work, appState.tempRating, true);

    checkHealth();

    if (confirm('数据上传完毕。进入冷却模式？')) {
        appState.mode = 'break';
        startTimer();
    } else {
        resetUI();
    }
}

function resetUI() {
    appState.active = false;
    appState.paused = false;
    appState.hasPausedInSession = false;
    timerWorker.postMessage('stop');

    document.getElementById('task-input').disabled = false;
    document.getElementById('action-btn').innerText = "开始入侵";
    document.getElementById('action-btn').style.background = "var(--cp-yellow)";
    document.getElementById('pause-btn').style.display = 'none';
    document.getElementById('status-badge').innerText = "READY TO BREACH";
    document.getElementById('status-badge').style.color = "var(--cp-blue)";

    document.getElementById('progress-bar').style.width = '0%';

    appState.timeLeft = (appState.mode === 'work' ? config.work : config.break) * 60;
    updateTimerDisplay();

    document.getElementById('bgm-player').pause();
}

// ==========================================
// 5. DATA, ACHIEVEMENTS & PURGE
// ==========================================
function purgeData() {
    if (confirm("⚠️ 严重警告 ⚠️\n\n您正在执行数据库清洗操作。\n这将永久删除所有历史记录、成就和统计数据。\n\n是否继续？")) {
        localStorage.removeItem('cp_logs');
        localStorage.removeItem('cp_achievements');
        renderStats();
        renderAchievements();
        alert(">> 系统格式化完成。\n>> 所有数据已清除。");
    }
}

function saveRecord(task, duration, rating, success, failReason = '') {
    const records = JSON.parse(localStorage.getItem('cp_logs') || '[]');
    const now = new Date();
    const record = {
        date: now.toISOString(),
        dayStr: now.toISOString().split('T')[0],
        task, duration: Math.floor(duration), rating, success, failReason,
        interrupted: appState.hasPausedInSession
    };
    records.push(record);
    localStorage.setItem('cp_logs', JSON.stringify(records));

    checkAchievements(records);
}

function checkAchievements(records) {
    let unlocked = JSON.parse(localStorage.getItem('cp_achievements') || '[]');
    const totalMinutes = records.filter(r => r.success).reduce((acc, cur) => acc + cur.duration, 0);

    if (totalMinutes >= 60 && !unlocked.includes('rookie')) unlocked.push('rookie');
    if (totalMinutes >= 900 && !unlocked.includes('thinker')) unlocked.push('thinker');
    if (records.some(r => r.success && r.interrupted) && !unlocked.includes('resilient')) unlocked.push('resilient');

    const last10 = records.filter(r => r.success).slice(-10);
    if (last10.length >= 10) {
        const avg = last10.reduce((a, b) => a + b.rating, 0) / 10;
        if (avg >= 4 && !unlocked.includes('highroller')) unlocked.push('highroller');
    }

    const uniqueDays = [...new Set(records.filter(r => r.success).map(r => r.dayStr))].sort();
    let streak = 0;
    for (let i = 0; i < uniqueDays.length - 1; i++) {
        const d1 = new Date(uniqueDays[i]);
        const d2 = new Date(uniqueDays[i + 1]);
        const diffTime = Math.abs(d2 - d1);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 1) streak++; else streak = 0;
        if (streak >= 6 && !unlocked.includes('durable')) { unlocked.push('durable'); break; }
    }

    localStorage.setItem('cp_achievements', JSON.stringify(unlocked));
    renderAchievements();
}

function renderAchievements() {
    const list = JSON.parse(localStorage.getItem('cp_achievements') || '[]');
    const container = document.getElementById('ach-container');
    const descBox = document.getElementById('ach-desc');
    container.innerHTML = '';

    Object.keys(ACH_DEFS).forEach(key => {
        const div = document.createElement('div');
        div.className = 'ach-badge ' + (list.includes(key) ? 'unlocked' : '');
        div.innerText = ACH_DEFS[key].icon;
        div.onmouseenter = () => { descBox.innerText = ACH_DEFS[key].title; descBox.style.color = list.includes(key) ? 'var(--cp-green)' : 'var(--cp-blue)'; };
        div.onmouseleave = () => { descBox.innerText = "HOVER ICON FOR DETAILS"; descBox.style.color = "var(--cp-blue)"; };
        container.appendChild(div);
    });
}

function checkHealth() {
    const records = JSON.parse(localStorage.getItem('cp_logs') || '[]');
    const todayStr = new Date().toISOString().split('T')[0];
    const todayMins = records.filter(r => r.dayStr === todayStr && r.success).reduce((a, b) => a + b.duration, 0);

    if (todayMins >= 180 && todayMins < 180 + config.work) {
        alert("⚠️ 警告：突触压力过大 \n今日已接入超3小时。建议断开连接，前往夜之城进行肉体活动。");
    }
}

// ==========================================
// 6. UTILS & VISUALS
// ==========================================
function updateTimerDisplay() {
    const m = Math.floor(appState.timeLeft / 60).toString().padStart(2, '0');
    const s = (appState.timeLeft % 60).toString().padStart(2, '0');
    const str = `${m}:${s}`;
    document.getElementById('timer').innerText = str;

    if (appState.active && !appState.paused) {
        document.title = `${str} | ACTIVE`;
    } else if (!appState.active) {
        document.title = `${str} | READY`;
    }
}

function updateProgressBar() {
    const percent = ((appState.totalTime - appState.timeLeft) / appState.totalTime) * 100;
    document.getElementById('progress-bar').style.width = percent + '%';
}

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function playBeep() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
}

function loadBackground(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => document.getElementById('bg-layer').style.backgroundImage = `url(${e.target.result})`;
        reader.readAsDataURL(input.files[0]);
    }
}

function loadMusic(input) {
    if (input.files && input.files[0]) {
        const url = URL.createObjectURL(input.files[0]);
        document.getElementById('bgm-player').src = url;
        alert("BGM 已加载");
    }
}

function setRating(v) {
    appState.tempRating = v;
    document.querySelectorAll('.star-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.v) <= v);
    });
}

function renderStats() {
    const records = JSON.parse(localStorage.getItem('cp_logs') || '[]');
    const todayStr = new Date().toISOString().split('T')[0];
    const todayMins = records.filter(r => r.dayStr === todayStr && r.success).reduce((a, b) => a + b.duration, 0);
    document.getElementById('today-total').innerText = todayMins + " MIN";

    const listEl = document.getElementById('task-list');
    listEl.innerHTML = '';
    records.slice().reverse().slice(0, 20).forEach(r => {
        const color = r.success ? 'var(--cp-blue)' : 'var(--cp-red)';
        const ratingStr = r.success ? "★".repeat(r.rating) : "失败";
        const txt = `<span>${r.task}</span> <span style="color:${color}">${ratingStr}</span>`;
        const div = document.createElement('div');
        div.style.borderBottom = "1px solid #222"; div.style.padding = "6px 0";
        div.style.display = "flex"; div.style.justifyContent = "space-between";
        div.style.color = "#ccc";
        div.innerHTML = txt;
        listEl.appendChild(div);
    });
    setTimeout(() => drawChart(records), 50);
}

function drawChart(records) {
    const canvas = document.getElementById('trendChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0, 240, 255, 0.1)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i < 5; i++) { let y = i * (h / 5); ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    const data = records.filter(r => r.success).slice(-10).map(r => r.rating);
    if (data.length === 0) return;

    ctx.strokeStyle = "#fcee0a"; ctx.lineWidth = 2; ctx.beginPath();
    if (data.length === 1) {
        const y = h - (data[0] / 5.5 * h) - 5; ctx.moveTo(0, y); ctx.lineTo(w, y);
    } else {
        const step = w / (data.length - 1);
        data.forEach((v, i) => { const x = i * step; const y = h - (v / 5.5 * h) - 5; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    }
    ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fillStyle = "rgba(252, 238, 10, 0.1)"; ctx.fill();
}

function togglePanel(id, e) {
    if (e) e.stopPropagation();
    const target = document.getElementById(id + '-panel');
    const isActive = target.classList.contains('active');
    const btn = document.getElementById('btn-' + id);
    closeAllPanels();
    if (!isActive) {
        target.classList.add('active');
        if (btn) btn.classList.add('active-btn');
        if (id === 'stats') renderStats();
    }
}

function closeAllPanels() {
    document.querySelectorAll('.slide-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active-btn'));
}

function saveSettings() {
    config.work = parseInt(document.getElementById('cfg-work').value) || 25;
    config.break = parseInt(document.getElementById('cfg-break').value) || 5;
    localStorage.setItem('cp_config', JSON.stringify(config));
    closeAllPanels();
    if (!appState.active) resetUI();
}

function initThree() {
    if (typeof THREE === 'undefined') return;
    const container = document.getElementById('canvas-container');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 2000);
    camera.position.z = 1000;
    const renderer = new THREE.WebGLRenderer({ alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);
    const geo = new THREE.BufferGeometry();
    const pos = []; const col = [];
    const pal = [new THREE.Color('#fcee0a'), new THREE.Color('#00f0ff'), new THREE.Color('#ff003c')];
    for (let i = 0; i < 1000; i++) {
        pos.push(Math.random() * 2000 - 1000, Math.random() * 2000 - 1000, Math.random() * 2000 - 1000);
        const c = pal[Math.floor(Math.random() * 3)];
        col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 3, vertexColors: true, transparent: true, opacity: 0.6 });
    const parts = new THREE.Points(geo, mat);
    scene.add(parts);
    function anim() { requestAnimationFrame(anim); parts.rotation.y += 0.0005; renderer.render(scene, camera); }
    anim();
    window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
}