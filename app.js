// ================== إعداد الخريطة ==================
const map = L.map('map', { zoomControl: true }).setView([24.7136, 46.6753], 13);

// بلاطات OSM (تُخزَّن في الكاش عبر Service Worker للعمل Offline)
const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

// ================== حالة التطبيق ==================
let userMarker = null;
let userCircle = null;
let watchId = null;

let mode = null;            // 'distance' | 'area' | null
let points = [];            // نقاط القياس [latlng, ...]
let polyline = null;        // للخط
let polygon = null;         // للمساحة
let markers = [];           // علامات النقاط
let watchMovement = null;   // لوضع المشي (GPS tracking)

const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

// ================== الموقع الحالي ==================
function startLocationTracking() {
  if (!navigator.geolocation) {
    setStatus('❌ المتصفح لا يدعم تحديد الموقع');
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    pos => updateUserPosition(pos.coords),
    err => setStatus('⚠️ ' + err.message),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}

function updateUserPosition(coords) {
  const { latitude, longitude, accuracy } = coords;
  const latlng = [latitude, longitude];

  if (!userMarker) {
    // دائرة زرقاء نابضة
    const icon = L.divIcon({
      className: 'user-icon',
      html: '<div class="user-dot"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    userMarker = L.marker(latlng, { icon }).addTo(map);
    userCircle = L.circle(latlng, {
      radius: accuracy,
      color: '#4285f4',
      fillColor: '#4285f4',
      fillOpacity: 0.15,
      weight: 1
    }).addTo(map);
    map.setView(latlng, 16);
  } else {
    userMarker.setLatLng(latlng);
    userCircle.setLatLng(latlng);
    userCircle.setRadius(accuracy);
  }
}

function centerOnUser() {
  if (userMarker) {
    map.setView(userMarker.getLatLng(), 17);
    setStatus('🎯 تم التمركز على موقعك');
  } else {
    setStatus('⏳ جاري تحديد موقعك...');
  }
}

// ================== أدوات القياس ==================
function clearMeasurement() {
  if (polyline) { map.removeLayer(polyline); polyline = null; }
  if (polygon)  { map.removeLayer(polygon);  polygon  = null; }
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  points = [];
  if (watchMovement !== null) {
    navigator.geolocation.clearWatch(watchMovement);
    watchMovement = null;
  }
  resultEl.textContent = '';
}

function startDistanceManual() {
  clearMeasurement();
  mode = 'distance';
  setStatus('📏 قياس مسافة يدوي — انقر على الخريطة لإضافة نقاط');
  document.getElementById('btnStop').disabled = false;
  highlightActive('btnMeasureDist');
}

function startAreaManual() {
  clearMeasurement();
  mode = 'area';
  setStatus('📐 قياس مساحة يدوي — انقر لإضافة نقاط (3 نقاط على الأقل)');
  document.getElementById('btnStop').disabled = false;
  highlightActive('btnMeasureArea');
}

function startDistanceWalk() {
  clearMeasurement();
  mode = 'distance';
  setStatus('🚶 قياس مسافة بالمشي — تحرك وسيتم تسجيل موقعك كل 3 ثوانٍ');
  document.getElementById('btnStop').disabled = false;
  highlightActive('btnMeasureDist');
  startMovementTracking();
}

function startAreaWalk() {
  clearMeasurement();
  mode = 'area';
  setStatus('🚶 قياس مساحة بالمشي — تحرك حول المحيط');
  document.getElementById('btnStop').disabled = false;
  highlightActive('btnMeasureArea');
  startMovementTracking();
}

function startMovementTracking() {
  let lastPoint = null;
  watchMovement = navigator.geolocation.watchPosition(
    pos => {
      const latlng = [pos.coords.latitude, pos.coords.longitude];
      // إضافة نقطة كل 5 أمتار على الأقل لتجنب التكدس
      if (!lastPoint || map.distance(lastPoint, latlng) > 5) {
        addPoint(latlng);
        lastPoint = latlng;
      }
    },
    err => setStatus('⚠️ ' + err.message),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

function stopMeasurement() {
  mode = null;
  document.getElementById('btnStop').disabled = true;
  document.getElementById('btnMeasureDist').classList.remove('active');
  document.getElementById('btnMeasureArea').classList.remove('active');
  setStatus('✅ تم إيقاف القياس');
}

function addPoint(latlng) {
  points.push(latlng);
  const m = L.circleMarker(latlng, {
    radius: 5, color: '#e91e63', fillColor: '#e91e63', fillOpacity: 1
  }).addTo(map);
  markers.push(m);

  if (mode === 'distance') {
    if (polyline) map.removeLayer(polyline);
    polyline = L.polyline(points, { color: '#e91e63', weight: 4 }).addTo(map);
    const dist = calcDistance(points);
    resultEl.innerHTML = `📏 المسافة: <b>${formatDistance(dist)}</b>`;
  } else if (mode === 'area') {
    if (polygon) map.removeLayer(polygon);
    if (points.length >= 3) {
      polygon = L.polygon(points, {
        color: '#4caf50', fillColor: '#4caf50', fillOpacity: 0.3, weight: 3
      }).addTo(map);
      const area = calcArea(points);
      resultEl.innerHTML = `📐 المساحة: <b>${formatArea(area)}</b>`;
    }
  }
}

// ================== حسابات ==================
function calcDistance(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += map.distance(pts[i - 1], pts[i]);
  }
  return total;
}

// صيغة Shoelace على إحداثيات كروية (تقريب جيد)
function calcArea(pts) {
  if (pts.length < 3) return 0;
  const R = 6378137; // نصف قطر الأرض بالمتر
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    total += (p2[1] - p1[1]) * Math.PI / 180 *
             (2 + Math.sin(p1[0] * Math.PI / 180) + Math.sin(p2[0] * Math.PI / 180));
  }
  return Math.abs(total * R * R / 2);
}

function formatDistance(m) {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' كم' : m.toFixed(1) + ' م';
}
function formatArea(m2) {
  if (m2 >= 1_000_000) return (m2 / 1_000_000).toFixed(3) + ' كم²';
  if (m2 >= 10_000)    return (m2 / 10_000).toFixed(3) + ' هكتار';
  return m2.toFixed(1) + ' م²';
}

// ================== حفظ المشاريع (IndexedDB) ==================
const DB_NAME = 'MapProjectsDB';
const STORE = 'projects';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

async function saveProject() {
  if (points.length === 0) {
    alert('لا يوجد قياس للحفظ!');
    return;
  }
  const name = prompt('اسم المشروع:', 'مشروع ' + new Date().toLocaleString('ar-EG'));
  if (!name) return;

  const project = {
    name,
    mode,
    points,
    createdAt: Date.now()
  };
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).add(project);
  tx.oncomplete = () => {
    setStatus('💾 تم حفظ المشروع: ' + name);
    alert('✅ تم الحفظ بنجاح');
  };
}

async function loadProjects() {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const req = tx.objectStore(STORE).getAll();
  req.onsuccess = () => {
    const list = document.getElementById('projectsList');
    list.innerHTML = '';
    const projects = req.result;
    if (projects.length === 0) {
      list.innerHTML = '<li>لا توجد مشاريع محفوظة</li>';
    } else {
      projects.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `
          <span onclick='openProject(${p.id})'>${p.name} <br><small>${new Date(p.createdAt).toLocaleString('ar-EG')}</small></span>
          <button onclick='deleteProject(${p.id})'>🗑</button>
        `;
        list.appendChild(li);
      });
    }
    document.getElementById('projectsModal').classList.remove('hidden');
  };
}

window.openProject = async function(id) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readonly');
  const req = tx.objectStore(STORE).get(id);
  req.onsuccess = () => {
    const p = req.result;
    clearMeasurement();
    mode = p.mode;
    points = p.points;
    points.forEach(pt => addPoint(pt));
    if (points.length) map.fitBounds(L.polyline(points).getBounds(), { padding: [40, 40] });
    document.getElementById('projectsModal').classList.add('hidden');
    setStatus('📂 تم تحميل: ' + p.name);
  };
};

window.deleteProject = async function(id) {
  if (!confirm('حذف المشروع؟')) return;
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(id);
  tx.oncomplete = () => loadProjects();
};

// ================== أحداث الأزرار ==================
document.getElementById('btnCenter').addEventListener('click', centerOnUser);

// قائمة منسدلة بسيطة للقياس: نقرة = يدوي، نقرة مطولة = مشي
function setupMeasureButton(btnId, manualFn, walkFn) {
  const btn = document.getElementById(btnId);
  let pressTimer;
  btn.addEventListener('mousedown', () => { pressTimer = setTimeout(walkFn, 600); });
  btn.addEventListener('touchstart', () => { pressTimer = setTimeout(walkFn, 600); });
  btn.addEventListener('mouseup',  () => clearTimeout(pressTimer));
  btn.addEventListener('mouseleave', () => clearTimeout(pressTimer));
  btn.addEventListener('touchend', () => clearTimeout(pressTimer));
  btn.addEventListener('click', e => {
    // click fires after mouseup — نستخدم علم للتمييز
    if (!btn.dataset.walked) manualFn();
    btn.dataset.walked = '';
  });
  // عند التشغيل المطوّل نمنع click
  btn.addEventListener('contextmenu', e => e.preventDefault());
}

// تبسيط: نستخدم نقرة عادية للقياس اليدوي، وزر منفصل للمشي عبر قائمة
// لتبسيط الكود: نستخدم prompt عند النقر لاختيار النوع
document.getElementById('btnMeasureDist').addEventListener('click', () => {
  const choice = confirm('OK = قياس يدوي (نقر على الخريطة)\nCancel = قياس بالمشي (GPS)');
  if (choice) startDistanceManual(); else startDistanceWalk();
});
document.getElementById('btnMeasureArea').addEventListener('click', () => {
  const choice = confirm('OK = قياس يدوي (نقر على الخريطة)\nCancel = قياس بالمشي (GPS)');
  if (choice) startAreaManual(); else startAreaWalk();
});

document.getElementById('btnStop').addEventListener('click', stopMeasurement);
document.getElementById('btnSave').addEventListener('click', saveProject);
document.getElementById('btnLoad').addEventListener('click', loadProjects);
document.getElementById('closeModal').addEventListener('click', () => {
  document.getElementById('projectsModal').classList.add('hidden');
});

// النقر على الخريطة لإضافة نقاط في الوضع اليدوي
map.on('click', e => {
  if (mode && watchMovement === null) {
    addPoint(e.latlng);
  }
});

function setStatus(msg) { statusEl.textContent = msg; }
function highlightActive(id) {
  document.getElementById('btnMeasureDist').classList.remove('active');
  document.getElementById('btnMeasureArea').classList.remove('active');
  document.getElementById(id).classList.add('active');
}

// ================== بدء التشغيل ==================
startLocationTracking();
setStatus('🟢 التطبيق جاهز — في انتظار تحديد الموقع');