/* ═══════════════════════════════════════════════════════════════
   app.js — SmartHome Dashboard
   ─────────────────────────────────────────────────────────────
   Firebase paths (matches main.cpp exactly):

   sensors/
   ├── temperature  (float, °C)
   ├── humidity     (float, %)
   ├── gas          (int)   100 = safe, 850 = danger
   ├── ldr          (int)   0–4095 raw ADC, LOW = dark = night
   ├── rain         (bool)  true = raining
   └── human        (bool)  true = motion detected

   controls/
   ├── fan          (bool)    true = ON
   ├── fanSpeed     (int)     0–100 %
   ├── light        (bool)    true = ON
   └── awning       (string)  "open" or "closed"

   NOTE: _manual paths are NOT written to Firebase.
         Manual mode is tracked in browser memory only.
   ═══════════════════════════════════════════════════════════ */

// ─── THRESHOLDS ────────────────────────────────────────────────
const THRESH = {
  tempHot:    30,    // °C  — fan auto-on above this
  humidHigh:  80,    // %   — fan auto-on above this
  gasDanger:  400,   // ppm — fire alarm  (cpp sends 850)
  gasWarning: 200,   // ppm — warning level
  ldrNight:   500,   // ADC 0–4095: BELOW this = night (tune to your LDR)
};

// ─── STATE ─────────────────────────────────────────────────────
let sensors     = {};
// controls mirrors what is ACTUALLY in Firebase right now
let controls    = { fan: false, fanSpeed: 100, light: false, lightIntensity: 100, awning: 'open' };
// manuals tracks whether the USER has taken manual control (browser-only)
let manuals     = { fan: false, light: false, awning: false };
let alertLog    = [];
let alarmActive    = false;
let prevGasAlarm   = false;
let demoInterval = null;

// ─── CHART DATA ────────────────────────────────────────────────
const MAX_POINTS = 20;
const chartData  = {
  temp:  { labels: [], values: [] },
  humid: { labels: [], values: [] },
  gas:   { labels: [], values: [] },
};
let charts = {};

// ─── NAVIGATION ────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    if (!page) return;
    document.querySelectorAll('.nav-btn').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(page).classList.add('active');
  });
});

// ─── CLOCK ─────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('datetime').textContent =
    now.toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'short', year:'numeric' })
    + '  ·  ' + now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ─── INIT CHARTS ───────────────────────────────────────────────
function initCharts() {
  // Warm light-theme grid — visible on cream background
  const defaults = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { display: false },
      y: {
        grid:   { color: 'rgba(58,52,44,0.07)' },
        ticks:  { color: '#8a8074', font: { family: "'DM Mono'", size: 11 } },
        border: { display: false },
      }
    },
    elements: {
      line:  { tension: 0.4, borderWidth: 2 },
      point: { radius: 0, hoverRadius: 4 },
    },
    animation: { duration: 400 },
  };

  charts.temp = new Chart(document.getElementById('tempChart'), {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: '#c87d52', backgroundColor: 'rgba(200,125,82,0.08)', fill: true }] },
    options: { ...defaults, scales: { ...defaults.scales, y: { ...defaults.scales.y, min: 0, max: 60 } } }
  });

  charts.humid = new Chart(document.getElementById('humidChart'), {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: '#5b7fa6', backgroundColor: 'rgba(91,127,166,0.08)', fill: true }] },
    options: { ...defaults, scales: { ...defaults.scales, y: { ...defaults.scales.y, min: 0, max: 100 } } }
  });

  charts.gas = new Chart(document.getElementById('gasChart'), {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: '#c2604f', backgroundColor: 'rgba(194,96,79,0.08)', fill: true }] },
    options: { ...defaults, scales: { ...defaults.scales, y: { ...defaults.scales.y, min: 0, max: 1000 } } }
  });
}

function pushChartPoint(key, value) {
  const d  = chartData[key];
  const ts = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  d.labels.push(ts);
  d.values.push(value);
  if (d.labels.length > MAX_POINTS) { d.labels.shift(); d.values.shift(); }
  charts[key].data.labels           = [...d.labels];
  charts[key].data.datasets[0].data = [...d.values];
  charts[key].update('none');
}

// ─── UPDATE SENSOR CARD ─────────────────────────────────────────
function updateSensorCard(id, displayVal, barPct, statusText, level) {
  const valEl = document.getElementById(id + 'Val');
  const stEl  = document.getElementById(id + 'Status');
  const bar   = document.getElementById(id + 'Bar');
  const card  = document.getElementById('card-' + id);

  if (valEl) valEl.textContent = displayVal;
  if (stEl)  stEl.textContent  = statusText;
  if (bar)   bar.style.width   = Math.min(100, Math.max(0, barPct)) + '%';
  if (card) {
    card.classList.remove('alert-danger', 'alert-warning', 'active-state');
    if (level === 'danger')  card.classList.add('alert-danger');
    if (level === 'warning') card.classList.add('alert-warning');
    if (level === 'active')  card.classList.add('active-state');
  }
}

// ─── SLIDER CONTROLS ───────────────────────────────────────────
// Called while dragging — just updates the label
function updateSliderUI(device, value) {
  const valId = device === 'fan' ? 'fanSpeedVal' : 'lightIntensityVal';
  const el = document.getElementById(valId);
  if (el) el.textContent = value + '%';
}

// Called on mouseup / touchend — writes to Firebase
function changeIntensity(device, value) {
  manuals[device] = true;
  const numValue  = parseInt(value);
  const dbKey     = device === 'fan' ? 'fanSpeed' : 'lightIntensity';
  const valId     = device === 'fan' ? 'fanSpeedVal' : 'lightIntensityVal';

  const el = document.getElementById(valId);
  if (el) el.textContent = numValue + '%';

  try {
    const db = firebase.database();
    db.ref('controls/' + dbKey).set(numValue);
    
    // Nếu kéo thanh trượt > 0 mà thiết bị đang tắt -> Tự động BẬT
    if (numValue > 0 && !controls[device]) {
      remoteControl(device, true, true); // Chữ true thứ 2 để báo là từ slider
    }
    // Nếu kéo thanh trượt về 0 mà thiết bị đang bật -> Tự động TẮT
    if (numValue === 0 && controls[device]) {
      remoteControl(device, false, true); 
    }
  } catch(e) {
    console.warn('Firebase write failed:', e);
  }
}

// ─── AUTOMATION LOGIC ───────────────────────────────────────────
function runAutomation() {
  const t       = sensors.temperature ?? 0;
  const h       = sensors.humidity    ?? 0;
  const gas     = sensors.gas         ?? 0;
  const ldr     = sensors.ldr         ?? 0;
  const isNight = ldr < THRESH.ldrNight;
  const isRain  = !!sensors.rain;
  const isHuman = !!sensors.human;

  // ── Header badges ──
  const dn = document.getElementById('dayNightBadge');
  if (dn) {
    dn.innerHTML = isNight ? '<i class="ti ti-moon"></i> Night' : '<i class="ti ti-sun"></i> Day';
    dn.className = 'env-badge ' + (isNight ? 'night' : 'day');
  }
  const rb = document.getElementById('rainBadge');
  if (rb) {
    rb.innerHTML = isRain ? '<i class="ti ti-cloud-rain"></i> Raining' : '<i class="ti ti-droplet-off"></i> Dry';
    rb.className = 'env-badge ' + (isRain ? 'rain' : 'dry');
  }
  const hb = document.getElementById('humanBadge');
  if (hb) {
    hb.innerHTML = isHuman ? '<i class="ti ti-user-check"></i> Present' : '<i class="ti ti-user-off"></i> No one home';
    hb.className = 'env-badge ' + (isHuman ? 'human' : 'nohuman');
  }

  // ── FAN: hot OR humid OR someone home ──
  let fanAutoOn  = false;
  let fanReasons = [];
  if (t > THRESH.tempHot)   { fanAutoOn = true; fanReasons.push(`Temp ${t.toFixed(1)}°C > ${THRESH.tempHot}°C`); }
  if (h > THRESH.humidHigh) { fanAutoOn = true; fanReasons.push(`Humidity ${h.toFixed(0)}% > ${THRESH.humidHigh}%`); }
  if (isHuman)               { fanAutoOn = true; fanReasons.push('Someone is home'); }
  applyDevice('fan', fanAutoOn, fanReasons.join(' · ') || 'Conditions are normal');

  // ── LIGHT: night AND someone home ──
  applyDevice('light', isNight && isHuman,
    isNight ? (isHuman ? 'Night and someone is home' : 'Night, but no one home') : 'Daytime — not needed');

  // ── AWNING: close on rain, open when dry ──
  applyDevice('awning', !isRain,
    isRain ? 'Rain detected — closing to protect laundry'
           : (isNight ? 'Clear night — staying open' : 'Dry — open for drying'));

  // Notify when awning closes due to rain
  if (isRain && !notified.rain) {
    sendNotification(
      '🌧️ Awning Closed',
      'Rain detected — awning has been closed to protect your laundry.',
      'awning-rain'
    );
    notified.rain   = true;
    notified.awningOpen = false;
  }
  // Notify when awning opens again (rain stopped, daytime)
  if (!isRain && !isNight && notified.rain && !notified.awningOpen) {
    sendNotification(
      '☀️ Awning Opened',
      'Rain has stopped — awning is open again for drying.',
      'awning-sun'
    );
    notified.rain       = false;
    notified.awningOpen = true;
  }

  // ── GAS ALARM ──
  if (gas >= THRESH.gasDanger && !alarmActive) {
    triggerAlarm('Danger', `Gas level: ${gas} ppm — ventilate and check for a leak.`, 'danger');
    if (!notified.gas) {
      sendNotification(
        '⚠️ Gas / Smoke Danger!',
        `Gas level: ${gas} ppm — ventilate the area immediately!`,
        'gas-danger'
      );
      notified.gas = true;
    }
  } else if (gas >= THRESH.gasWarning && gas < THRESH.gasDanger) {
    if (!prevGasAlarm) {
      addAlert('warning', `Gas elevated: ${gas} ppm — check your appliances`);
      if (!notified.gas) {
        sendNotification(
          '⚠️ Gas Level Warning',
          `Gas: ${gas} ppm — check your appliances`,
          'gas-warning'
        );
        notified.gas = true;
      }
      prevGasAlarm = true;
    }
  } else {
    prevGasAlarm = false;
    notified.gas = false; // reset so next spike triggers again
  }
}

// ─── APPLY DEVICE (auto mode writes to Firebase so ESP32 reacts) ──
function applyDevice(device, autoOn, reason) {
  const isManual = manuals[device];
  let finalOn;
  
  if (isManual) {
    finalOn = device === 'awning' ? (controls.awning === 'open') : controls[device];
  } else {
    finalOn = autoOn;
    const newPayload = device === 'awning' ? (autoOn ? 'open' : 'closed') : autoOn;
    const currentVal = device === 'awning' ? controls.awning : controls[device];
    
    if (newPayload !== currentVal) {
      controls[device] = device === 'awning' ? newPayload : autoOn;
      
      // ÉP THANH TRƯỢT NHẢY SỐ (Không chờ Firebase)
      const numValue = autoOn ? 100 : 0;
      if (device === 'fan') {
         controls.fanSpeed = numValue;
         const fSlider = document.getElementById('fanSpeed');
         const fVal = document.getElementById('fanSpeedVal');
         if (fSlider) fSlider.value = numValue;
         if (fVal) fVal.textContent = numValue + '%';
      } else if (device === 'light') {
         controls.lightIntensity = numValue;
         const lSlider = document.getElementById('lightIntensity');
         const lVal = document.getElementById('lightIntensityVal');
         if (lSlider) lSlider.value = numValue;
         if (lVal) lVal.textContent = numValue + '%';
      }

      // Gửi lệnh lên Firebase
      try {
        const db = firebase.database();
        db.ref('controls/' + device).set(newPayload);
        if (device !== 'awning') {
           db.ref('controls/' + (device === 'fan' ? 'fanSpeed' : 'lightIntensity')).set(numValue);
        }
      } catch(e) { /* Firebase may not be ready yet */ }
    }
  }

  updateDeviceUI(device, finalOn, isManual, isManual ? 'Manual override active' : reason);
}

// ─── UPDATE DEVICE UI ───────────────────────────────────────────
function updateDeviceUI(device, on, isManual, reason) {
  const label = device === 'awning' ? (on ? 'Open' : 'Closed') : (on ? 'On' : 'Off');

  const card     = document.getElementById('dev-' + device);
  const stateEl  = document.getElementById(device + 'State');
  const autoEl   = document.getElementById(device + 'Auto');
  const reasonEl = document.getElementById(device + 'Reason');
  const toggleEl = document.getElementById(device + 'Toggle');
  const dtState  = document.getElementById('dt-' + device + 'State');
  const dtMode   = document.getElementById('dt-' + device + 'Mode');
  const dtToggle = document.getElementById('dt-' + device + 'Toggle');

  if (card)     card.classList.toggle('on', on);
  if (stateEl)  stateEl.textContent  = label;
  if (reasonEl) reasonEl.textContent = reason;
  if (autoEl) {
    autoEl.textContent = isManual ? 'Manual' : 'Auto';
    autoEl.className   = 'device-auto' + (isManual ? ' manual' : '');
  }
  if (toggleEl && toggleEl.checked !== on) toggleEl.checked = on;
  if (dtState)  { dtState.textContent = label; dtState.className = 'state-pill' + (on ? ' on' : ''); }
  if (dtMode)   dtMode.textContent    = isManual ? 'Manual' : 'Auto';
  if (dtToggle && dtToggle.checked !== on) dtToggle.checked = on;
}

// ─── REMOTE CONTROL (user toggle → Firebase → ESP32) ───────────
function remoteControl(device, on, fromSlider = false) {
  // Đồng bộ giao diện nút gạt
  ['', 'dt-'].forEach(prefix => {
    const t = document.getElementById(prefix + device + 'Toggle');
    if (t && t.checked !== on) t.checked = on;
  });

  manuals[device] = true;
  const payload = device === 'awning' ? (on ? 'open' : 'closed') : on;
  controls[device] = device === 'awning' ? payload : on;

  // ÉP THANH TRƯỢT CHẠY THEO NGAY LẬP TỨC (Không cần chờ Firebase)
  if (!fromSlider) {
    const numValue = on ? 100 : 0; 
    if (device === 'fan') {
      controls.fanSpeed = numValue;
      const fSlider = document.getElementById('fanSpeed');
      const fVal = document.getElementById('fanSpeedVal');
      if (fSlider) fSlider.value = numValue;
      if (fVal) fVal.textContent = numValue + '%';
    } else if (device === 'light') {
      controls.lightIntensity = numValue;
      const lSlider = document.getElementById('lightIntensity');
      const lVal = document.getElementById('lightIntensityVal');
      if (lSlider) lSlider.value = numValue;
      if (lVal) lVal.textContent = numValue + '%';
    }
  }

  // Gửi lệnh lên Firebase
  try {
    const db = firebase.database();
    db.ref('controls/' + device).set(payload);
    if (!fromSlider && device !== 'awning') {
       db.ref('controls/' + (device === 'fan' ? 'fanSpeed' : 'lightIntensity')).set(on ? 100 : 0);
    }
  } catch(e) { console.warn('Firebase write failed:', e); }

  updateDeviceUI(device, on, true, 'Manual override active');
  addAlert('info', `${capitalize(device)} manually turned ${device === 'awning' ? (on ? 'open' : 'closed') : (on ? 'on' : 'off')}`);
}

// ─── RESET TO AUTO ─────────────────────────────────────────────
function resetToAuto(device) {
  manuals[device] = false;
  addAlert('info', `${capitalize(device)} returned to auto mode`);
  runAutomation(); // Immediately re-evaluate sensors
}

// ─── ALERTS ────────────────────────────────────────────────────
function addAlert(type, msg) {
  alertLog.unshift({ type, msg, time: new Date() });
  renderAlerts();
  const dot = document.getElementById('alertDot');
  if (dot) dot.classList.toggle('visible', alertLog.length > 0);
}

function renderAlerts() {
  const list = document.getElementById('alertList');
  if (!list) return;
  if (alertLog.length === 0) {
    list.innerHTML = '<p class="no-alerts">Nothing to show yet — all calm</p>';
    return;
  }
  list.innerHTML = alertLog.map(a => `
    <div class="alert-item ${a.type}">
      <div class="alert-dot"></div>
      <div class="alert-body">
        <div class="alert-msg">${a.msg}</div>
        <div class="alert-time">${a.time.toLocaleTimeString('en-GB')}</div>
      </div>
    </div>
  `).join('');
}

function clearAlerts() {
  alertLog = [];
  renderAlerts();
  const dot = document.getElementById('alertDot');
  if (dot) dot.classList.remove('visible');
}

// ─── ALARM OVERLAY ──────────────────────────────────────────────
function triggerAlarm(title, msg, type) {
  alarmActive = true;
  document.getElementById('alarmTitle').textContent = title;
  document.getElementById('alarmMsg').textContent   = msg;
  document.getElementById('alarmOverlay').classList.add('active');
  addAlert(type || 'danger', msg);
}

function dismissAlarm() {
  alarmActive = false;
  document.getElementById('alarmOverlay').classList.remove('active');
}

// ─── FIREBASE LISTENERS ─────────────────────────────────────────
function connectFirebase() {
  try {
    const db = firebase.database();

    // 1. Listen to sensor data
    db.ref('sensors').on('value', snap => {
      const data = snap.val();
      if (!data) return;
      sensors = { ...sensors, ...data };

      const t   = data.temperature ?? 0;
      const h   = data.humidity    ?? 0;
      const gas = data.gas         ?? 0;
      const ldr = data.ldr         ?? 0;  // raw ADC 0–4095

      // Temperature
      const tempLevel = t > 38 ? 'danger' : t > THRESH.tempHot ? 'warning' : 'normal';
      updateSensorCard('temp', t.toFixed(1) + '°C', (t / 50) * 100,
        t > 38 ? 'Very hot' : t > THRESH.tempHot ? 'Hot — fan on' : 'Normal', tempLevel);
      pushChartPoint('temp', t);

      // Humidity
      const humidLevel = h > 90 ? 'danger' : h > THRESH.humidHigh ? 'warning' : 'normal';
      updateSensorCard('humid', h.toFixed(0) + '%', h,
        h > THRESH.humidHigh ? 'High — fan on' : 'Normal', humidLevel);
      pushChartPoint('humid', h);

      // Gas
      const gasLevel = gas >= THRESH.gasDanger ? 'danger' : gas >= THRESH.gasWarning ? 'warning' : 'normal';
      updateSensorCard('gas', gas.toFixed(0) + ' ppm', (gas / 1000) * 100,
        gas >= THRESH.gasDanger ? 'Danger — ventilate now' : gas >= THRESH.gasWarning ? 'Warning' : 'Safe', gasLevel);
      pushChartPoint('gas', gas);

      // LDR (day/night light sensor)
      sensors.ldr = ldr;
      const isNightNow = ldr < THRESH.ldrNight;
      updateSensorCard('light', ldr + ' ADC', ((4095 - ldr) / 4095) * 100,
        isNightNow ? 'Night detected' : 'Daytime', 'normal');

      // Rain
      const isRain = !!data.rain;
      sensors.rain = isRain;
      updateSensorCard('rain', isRain ? 'Raining' : 'Dry', isRain ? 100 : 5,
        isRain ? 'Awning closing' : 'Clear', isRain ? 'warning' : 'normal');

      // Human
      const isHuman = !!data.human;
      sensors.human = isHuman;
      updateSensorCard('human', isHuman ? 'Detected' : 'Not detected', isHuman ? 100 : 5,
        isHuman ? 'Someone home' : 'No presence', isHuman ? 'active' : 'normal');

      runAutomation();
    });

    // 2. Listen to controls (ESP32 writes defaults on boot; other clients may change them)
    db.ref('controls').on('value', snap => {
      const data = snap.val();
      if (!data) return;

      // Mirror Firebase state locally
      if (data.fan      !== undefined) controls.fan      = data.fan;
      if (data.fanSpeed !== undefined) controls.fanSpeed  = data.fanSpeed;
      if (data.light    !== undefined) controls.light    = data.light;
      if (data.lightIntensity !== undefined) controls.lightIntensity = data.lightIntensity;
      if (data.awning   !== undefined) controls.awning   = data.awning; // string "open"/"closed"

      // Sync slider UI if changed from Firebase / another client
      const speedEl = document.getElementById('fanSpeed');
      const speedLbl = document.getElementById('fanSpeedVal');
      if (speedEl && data.fanSpeed !== undefined) {
        speedEl.value = data.fanSpeed;
        if (speedLbl) speedLbl.textContent = data.fanSpeed + '%';
      }
      const intensityEl = document.getElementById('lightIntensity');
      const intensityLbl = document.getElementById('lightIntensityVal');
      if (intensityEl && data.lightIntensity !== undefined) {
        intensityEl.value = data.lightIntensity;
        if (intensityLbl) intensityLbl.textContent = data.lightIntensity + '%';
      }

      runAutomation();
    });

    setConnStatus(true);
    // Tắt nút gạt Demo Mode đi khi đã vào mạng
    const switchEl = document.getElementById('demoModeSwitch');
    if (switchEl) switchEl.checked = false;
  } catch(e) {
    console.error('Firebase connection failed:', e);
    setConnStatus(false);
    startDemoMode();
  }
}

function setConnStatus(connected) {
  const dot   = document.getElementById('connStatus');
  const label = document.getElementById('connLabel');
  if (dot)   dot.className     = 'status-dot ' + (connected ? 'connected' : 'error');
  if (label) label.textContent = connected ? 'Connected' : 'Demo mode';
}

// ─── DEMO MODE ─────────────────────────────────────────────────
// Hàm xử lý sự kiện khi gạt công tắc Demo
function toggleDemoMode(enableDemo) {
  if (enableDemo) {
    startDemoMode();
  } else {
    // Tắt Demo Mode
    if (demoInterval) {
      clearInterval(demoInterval);
      demoInterval = null;
    }
    // Chờ kết nối lại Firebase thật
    document.getElementById('connLabel').textContent = 'Connecting...';
    connectFirebase();
  }
}

function startDemoMode() {
  // 1. Ngắt kết nối Firebase thực (nếu đang chạy)
  try {
    firebase.database().ref('sensors').off();
    firebase.database().ref('controls').off();
  } catch(e) {}

  // 2. Đổi trạng thái UI
  setConnStatus(false);
  document.getElementById('connLabel').textContent = 'Demo Mode (Testing)';
  const switchEl = document.getElementById('demoModeSwitch');
  if (switchEl) switchEl.checked = true;

  // 3. Xóa bộ đếm cũ nếu có
  if (demoInterval) clearInterval(demoInterval);

  let tick = 0;
  function demoTick() {
    tick++;
    sensors = {
      temperature: 26 + Math.sin(tick * 0.15) * 8 + (Math.random() - 0.5),
      humidity:    60 + Math.sin(tick * 0.1)  * 20 + (Math.random() - 0.5) * 2,
      gas:         tick > 40 && tick < 50 ? 850 : 100,
      ldr:         tick % 40 > 25 ? 200 : 2800, 
      rain:        tick % 30 > 20,
      human:       tick % 20 > 10,
    };
    // ... (Giữ nguyên toàn bộ các lệnh cập nhật card và automation ở bên dưới của bạn) ...
    const t   = sensors.temperature;
    const h   = sensors.humidity;
    const gas = sensors.gas;
    const ldr = sensors.ldr;
    const isNight = ldr < THRESH.ldrNight;
    const isRain  = sensors.rain;
    const isHuman = sensors.human;

    const tempLevel = t > 38 ? 'danger' : t > THRESH.tempHot ? 'warning' : 'normal';
    updateSensorCard('temp', t.toFixed(1) + '°C', (t / 50) * 100,
      t > THRESH.tempHot ? 'Hot — fan on' : 'Normal', tempLevel);
    pushChartPoint('temp', t);

    const humidLevel = h > THRESH.humidHigh ? 'warning' : 'normal';
    updateSensorCard('humid', h.toFixed(0) + '%', h,
      h > THRESH.humidHigh ? 'High' : 'Normal', humidLevel);
    pushChartPoint('humid', h);

    const gasLevel = gas >= THRESH.gasDanger ? 'danger' : gas >= THRESH.gasWarning ? 'warning' : 'normal';
    updateSensorCard('gas', gas.toFixed(0) + ' ppm', (gas / 1000) * 100,
      gas >= THRESH.gasDanger ? 'Danger' : gas >= THRESH.gasWarning ? 'Warning' : 'Safe', gasLevel);
    pushChartPoint('gas', gas);

    updateSensorCard('light', ldr + ' ADC', ((4095 - ldr) / 4095) * 100,
      isNight ? 'Night detected' : 'Daytime', 'normal');
    updateSensorCard('rain', isRain ? 'Raining' : 'Dry', isRain ? 100 : 5,
      isRain ? 'Awning closing' : 'Clear', isRain ? 'warning' : 'normal');
    updateSensorCard('human', isHuman ? 'Detected' : 'Not detected', isHuman ? 100 : 5,
      isHuman ? 'Someone home' : 'No presence', isHuman ? 'active' : 'normal');

    runAutomation();
  }
  
  // Gán vào biến demoInterval thay vì chạy vô danh
  demoInterval = setInterval(demoTick, 2000);
  demoTick();
}

// ─── HELPERS ────────────────────────────────────────────────────
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ─── NOTIFICATIONS ─────────────────────────────────────────────
// Tracks what we already notified so we don't spam the same alert
const notified = { gas: false, rain: false, awningOpen: false };
 
// Ask permission once, then send via service worker
async function requestNotifPermission() {
  if (!('Notification' in window) || !navigator.serviceWorker) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}
 
function sendNotification(title, body, tag) {
  if (Notification.permission !== 'granted') return;
  navigator.serviceWorker.ready.then(reg => {
    reg.active.postMessage({ type: 'SHOW_NOTIFICATION', title, body, tag });
  });
}

// ─── BOOT ───────────────────────────────────────────────────────
// Use window 'load' instead of 'DOMContentLoaded' — guarantees all
// scripts (including firebase-config.js) have fully executed before
// we check firebase.apps.length. Safest approach for scripts at the
// bottom of <body>.
window.addEventListener('load', () => {

  // ── Theme colors: must match --bg in :root and [data-theme="dark"] in style.css ──
  const THEME_COLORS = { light: '#faf7f2', dark: '#181a1b' };

  function applyTheme(dark) {
    const root      = document.documentElement;
    const themeMeta = document.getElementById('themeMetaColor');
    const themeImg  = document.getElementById('themeImg');
    const bg        = dark ? THEME_COLORS.dark : THEME_COLORS.light;

    if (dark) {
      root.setAttribute('data-theme', 'dark');
      if (themeImg) themeImg.src = 'img/moon-icon.png';
      localStorage.setItem('smartHomeTheme', 'dark');
    } else {
      root.removeAttribute('data-theme');
      if (themeImg) themeImg.src = 'img/sun-icon.png';
      localStorage.setItem('smartHomeTheme', 'light');
    }

    // Belt-and-suspenders: set <html> background INLINE too, not just via
    // the CSS var. iOS Safari/PWA sometimes paints the safe-area strip
    // behind the status bar from the computed style at the moment of the
    // attribute change, and inline style guarantees zero lag vs. the CSS
    // var + transition resolving on the next frame.
    root.style.background = bg;

    // Android Chrome: update the status bar color to match.
    if (themeMeta) themeMeta.setAttribute('content', bg);
  }

  // Apply saved theme on first load
  applyTheme(localStorage.getItem('smartHomeTheme') === 'dark');

  // Toggle on button click
  const themeToggleBtn = document.getElementById('themeToggle');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      applyTheme(document.documentElement.getAttribute('data-theme') !== 'dark');
    });
  }

  // Request notification permission on first load
  requestNotifPermission();

  // Charts and Firebase
  initCharts();

  if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
    connectFirebase();
  } else {
    console.warn('Firebase not initialized — starting demo mode');
    setConnStatus(false);
    startDemoMode();
  }
});

// ─── CẢM ỨNG VUỐT (SWIPE) TRÊN ĐIỆN THOẠI ────────────────────────
let touchStartX = 0;
let touchEndX = 0;
let touchStartY = 0;
let touchEndY = 0;

// Thứ tự các trang từ trái qua phải (khớp với thanh điều hướng của bạn)
const pageOrder = ['dashboard', 'control', 'history', 'settings'];

// Bắt đầu chạm tay vào màn hình
document.addEventListener('touchstart', e => {
  // Bỏ qua nếu người dùng đang kéo thanh trượt (slider) quạt/đèn
  if (e.target.tagName.toLowerCase() === 'input') return;
  touchStartX = e.changedTouches[0].screenX;
  touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

// Rút tay khỏi màn hình
document.addEventListener('touchend', e => {
  if (e.target.tagName.toLowerCase() === 'input') return;
  touchEndX = e.changedTouches[0].screenX;
  touchEndY = e.changedTouches[0].screenY;
  handleSwipe();
}, { passive: true });

function handleSwipe() {
  const swipeDistanceX = touchEndX - touchStartX;
  const swipeDistanceY = touchEndY - touchStartY;

  // Điều kiện: Phải vuốt ngang một đoạn đủ dài (>50px) và không bị vuốt dọc quá nhiều
  if (Math.abs(swipeDistanceX) > 50 && Math.abs(swipeDistanceX) > Math.abs(swipeDistanceY)) {
    
    // Tìm trang đang được mở
    const currentActiveBtn = document.querySelector('.nav-btn.active');
    if (!currentActiveBtn) return;
    
    const currentPage = currentActiveBtn.dataset.page;
    const currentIndex = pageOrder.indexOf(currentPage);

    if (swipeDistanceX < 0) {
      // Vuốt sang TRÁI (Tiến tới trang tiếp theo)
      if (currentIndex < pageOrder.length - 1) {
        document.querySelector(`.nav-btn[data-page="${pageOrder[currentIndex + 1]}"]`).click();
      }
    } else {
      // Vuốt sang PHẢI (Quay lại trang trước đó)
      if (currentIndex > 0) {
        document.querySelector(`.nav-btn[data-page="${pageOrder[currentIndex - 1]}"]`).click();
      }
    }
  }
}