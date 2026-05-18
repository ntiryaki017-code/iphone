var CACHE_NAME = 'ciftci-takip-v4';
var URLS = [
  'index.html',
  'app.html',
  'android-bridge-shim.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

// Kurulum
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(URLS).catch(function(err) {
        console.log('Cache hatasi:', err);
      });
    })
  );
  self.skipWaiting();
});

// Aktivasyon - eski cache temizle
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Fetch - dış istekleri direkt geçir, local dosyaları cache'le
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Dış API istekleri - cache'leme, direkt network
  if (url.indexOf('script.google.com') >= 0 ||
      url.indexOf('jsonbin.io') >= 0 ||
      url.indexOf('googleapis.com') >= 0 ||
      url.indexOf('accounts.google.com') >= 0 ||
      url.indexOf('cdn.jsdelivr.net') >= 0) {
    e.respondWith(fetch(e.request).catch(function() {
      return new Response(JSON.stringify({status:'error',message:'Network error'}), {
        headers: {'Content-Type': 'application/json'}
      });
    }));
    return;
  }

  // Local dosyalar - cache-first
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match('app.html') || caches.match('index.html');
      });
    })
  );
});
