/* Çiftçi Takip — Service Worker (PWA offline destek)
   Cache stratejisi:
   - App shell (HTML, JS, ikonlar): cache-first → değiştiğinde güncelle
   - CDN scriptleri (jsPDF, Tesseract, Google GIS): cache-first
   - Hava durumu API'leri (Open-Meteo, BigDataCloud): network-first, fallback cache
*/

const CACHE_VERSION = 'ciftci-v6.1';
const APP_SHELL = [
  './',
  './app.html',
  './manifest.json',
  './android-bridge-shim.js',
  './icon-192.png',
  './icon-512.png'
];

const CDN_SCRIPTS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.0/jspdf.plugin.autotable.min.js'
];

// ─── Install: app shell'i cache'le ───
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      // Hata olursa diğerlerini yine de cache'le
      return Promise.all(
        APP_SHELL.concat(CDN_SCRIPTS).map(function(url){
          return cache.add(url).catch(function(){ /* hata yutma */ });
        })
      );
    }).then(function(){ return self.skipWaiting(); })
  );
});

// ─── Activate: eski cache'leri sil ───
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if (k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// ─── Fetch: hibrit strateji ───
self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = req.url;

  // Hava durumu API'leri: network-first, fallback cache (en güncel veri tercih)
  if (url.indexOf('api.open-meteo.com') >= 0 ||
      url.indexOf('bigdatacloud.net') >= 0 ||
      url.indexOf('geocoding-api.open-meteo.com') >= 0) {
    e.respondWith(
      fetch(req).then(function(resp){
        var clone = resp.clone();
        caches.open(CACHE_VERSION).then(function(c){ c.put(req, clone); }).catch(function(){});
        return resp;
      }).catch(function(){
        return caches.match(req);
      })
    );
    return;
  }

  // Google Sign-In ve API'ler: sadece network (cache'lemez)
  if (url.indexOf('accounts.google.com') >= 0 ||
      url.indexOf('googleapis.com') >= 0 ||
      url.indexOf('apis.google.com') >= 0) {
    return; // varsayılan fetch
  }

  // Diğer her şey: cache-first, sonra network (offline destek için)
  e.respondWith(
    caches.match(req).then(function(cached){
      if (cached) return cached;
      return fetch(req).then(function(resp){
        // Başarılı GET sonuçlarını cache'le
        if (resp && resp.status === 200 && resp.type === 'basic') {
          var clone = resp.clone();
          caches.open(CACHE_VERSION).then(function(c){ c.put(req, clone); }).catch(function(){});
        }
        return resp;
      }).catch(function(){
        // Çevrimdışı ve cache yoksa: app.html'i dön (SPA fallback)
        if (req.mode === 'navigate') return caches.match('./app.html');
      });
    })
  );
});

// ─── Mesaj: ana sayfadan "skip" komutu ───
self.addEventListener('message', function(e){
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
