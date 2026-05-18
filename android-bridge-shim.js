/*
 * Çiftçi Takip — Android Köprüsü Web Shim'i
 * --------------------------------------------------
 * Bu dosya, app.html'deki Android.* çağrılarına web tarayıcısında
 * çalışacak alternatif sağlar. Eğer gerçek Android WebView içindeyse
 * (window.Android tanımlıysa) bu shim hiçbir şey yapmaz.
 *
 * Çalışan özellikler (web): localStorage, fetch, Google Sign-In (GIS),
 * Drive API, BarcodeDetector ile barkod, Tesseract.js ile OCR, Excel indirme.
 */
(function(){
  'use strict';
  // Gerçek Android köprüsü varsa dokunma
  if (window.Android && typeof window.Android.loadData === 'function') return;

  // ===== Veri saklama (localStorage) =====
  var DATA_KEY = 'ciftci_veri';
  function loadData(){ try { return localStorage.getItem(DATA_KEY) || ''; } catch(e){ return ''; } }
  function saveData(json){ try { localStorage.setItem(DATA_KEY, json); } catch(e){ console.warn('saveData', e); } }

  // ===== Toast =====
  var _toastEl = null;
  function toast(msg){
    if (!_toastEl){
      _toastEl = document.createElement('div');
      _toastEl.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.85);color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;z-index:99999;pointer-events:none;transition:opacity .25s;opacity:0;max-width:90%;text-align:center';
      (document.body || document.documentElement).appendChild(_toastEl);
    }
    _toastEl.textContent = String(msg);
    _toastEl.style.opacity = '1';
    clearTimeout(_toastEl._t);
    _toastEl._t = setTimeout(function(){ if(_toastEl) _toastEl.style.opacity='0'; }, 2200);
  }

  // ===== Callback yardimcisi =====
  function fireCb(name, payload){
    if (!name) return;
    try {
      var fn = window[name];
      if (typeof fn === 'function') fn(payload);
    } catch(e){ console.warn('cb err', name, e); }
  }

  // ===== HTTP =====
  function httpGetAsync(url, callbackName){
    fetch(url, {method:'GET'})
      .then(function(r){ return r.text(); })
      .then(function(t){ fireCb(callbackName, t); })
      .catch(function(err){ fireCb(callbackName, JSON.stringify({status:'error',message:String(err)})); });
  }

  // Apps Script POST (Android tarafi 2KB chunked GET kullaniyor; web'de dogrudan POST gondermek mumkun
  // ama CORS sebebiyle bazi Apps Script dagitimlari sorun cikarir. Once POST dene, basarisiz olursa GET'e dus.)
  function driveKaydetAsync(scriptUrl, jsonData, callbackName){
    var bodyObj;
    try { bodyObj = {action:'save', payload: JSON.parse(jsonData)}; }
    catch(e){ bodyObj = {action:'save', payload: jsonData}; }
    var body = JSON.stringify(bodyObj);

    fetch(scriptUrl, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: body
    })
    .then(function(r){
      if (!r.ok) throw new Error('HTTP '+r.status);
      return r.text();
    })
    .then(function(t){ fireCb(callbackName, t); })
    .catch(function(){
      // GET'e dus
      var enc = encodeURIComponent(body);
      var u = scriptUrl + (scriptUrl.indexOf('?')<0?'?':'&') + 'data=' + enc;
      fetch(u).then(function(r){ return r.text(); })
        .then(function(t){ fireCb(callbackName, t); })
        .catch(function(err){ fireCb(callbackName, JSON.stringify({status:'error',message:String(err)})); });
    });
  }

  // ===== Google Sign-In (Google Identity Services) =====
  // VARSAYILAN: Web'de Google girisi DEVRE DISI — tipki orijinal app.html davranisi gibi
  // sadece "sadece uygulamada calisir" toast'u gosterir.
  //
  // ETKINLESTIRMEK ICIN:
  //   1. Google Cloud Console > APIs & Services > Credentials > + CREATE CREDENTIALS
  //      > OAuth client ID > Application type: Web application olusturun.
  //   2. Authorized JavaScript origins alanina sitenizin URL'sini ekleyin.
  //   3. Olusan Client ID'yi app.html'in <head>'ine su sekilde ekleyin (shim'den ONCE):
  //        <script>window.WEB_OAUTH_CLIENT_ID = 'XXXX.apps.googleusercontent.com';</script>
  //   4. Web Google girisi otomatik aktif olur.
  var WEB_CLIENT_ID = window.WEB_OAUTH_CLIENT_ID || null;
  var SCOPES = 'https://www.googleapis.com/auth/drive.file email profile openid';
  var _accessToken = null, _user = null, _gisLoaded = null;

  function loadGisScript(){
    if (_gisLoaded) return _gisLoaded;
    _gisLoaded = new Promise(function(resolve, reject){
      if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = function(){
        if (window.google && window.google.accounts && window.google.accounts.oauth2) resolve();
        else reject(new Error('GIS yuklendi ama oauth2 yok'));
      };
      s.onerror = function(){ reject(new Error('GIS scripti indirilemedi')); };
      document.head.appendChild(s);
    });
    return _gisLoaded;
  }

  function googleGirisBaslat(){
    // Web Client ID tanimli degilse: orijinal davranis - sadece toast goster
    if (!WEB_CLIENT_ID){
      toast('Google giris sadece uygulamada calisir');
      return;
    }
    loadGisScript().then(function(){
      var tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: WEB_CLIENT_ID,
        scope: SCOPES,
        callback: function(resp){
          if (resp.error){
            fireCb('_googleGirisSonuc', JSON.stringify({status:'error',message:resp.error}));
            return;
          }
          _accessToken = resp.access_token;
          fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers:{Authorization:'Bearer '+_accessToken}
          })
          .then(function(r){ return r.json(); })
          .then(function(u){
            _user = {
              uid: u.sub || '',
              name: (u.name||'').replace(/"/g, "'"),
              email: u.email || '',
              photo: u.picture || ''
            };
            fireCb('_googleGirisSonuc', JSON.stringify({status:'ok', user:_user}));
          })
          .catch(function(){
            _user = {uid:'',name:'',email:'',photo:''};
            fireCb('_googleGirisSonuc', JSON.stringify({status:'ok', user:_user}));
          });
        }
      });
      tokenClient.requestAccessToken({prompt: _user ? '' : 'consent'});
    }).catch(function(err){
      fireCb('_googleGirisSonuc', JSON.stringify({status:'error',message:String(err)}));
      toast('Google girisi yuklenemedi');
    });
  }

  function googleCikis(){
    if (_accessToken && window.google && window.google.accounts && window.google.accounts.oauth2) {
      try { window.google.accounts.oauth2.revoke(_accessToken, function(){}); } catch(e){}
    }
    _accessToken = null; _user = null;
    fireCb('_googleGirisSonuc', JSON.stringify({status:'cikis'}));
  }

  function googleKullaniciBilgi(){
    return _user ? JSON.stringify(_user) : 'null';
  }

  function getDriveAccessToken(callbackName){
    // Web Client ID tanimli degilse: Drive sadece uygulamada
    if (!WEB_CLIENT_ID){
      fireCb(callbackName, JSON.stringify({status:'error', message:'Drive sadece uygulamada calisir'}));
      return;
    }
    if (_accessToken){
      fireCb(callbackName, JSON.stringify({status:'ok', token:_accessToken}));
      return;
    }
    // Henuz token yok — login akisini baslat, sonucta token'i geri ver
    var origCb = window._googleGirisSonuc;
    window._googleGirisSonuc = function(payload){
      try { window._googleGirisSonuc = origCb; } catch(e){}
      if (typeof origCb === 'function') { try { origCb(payload); } catch(e){} }
      if (_accessToken) fireCb(callbackName, JSON.stringify({status:'ok', token:_accessToken}));
      else fireCb(callbackName, JSON.stringify({status:'error', message:'Token alinamadi'}));
    };
    googleGirisBaslat();
  }

  // ===== Barkod (BarcodeDetector + getUserMedia) =====
  function barkodTara(callbackName){
    if (!('BarcodeDetector' in window)){
      toast('Bu tarayici barkod desteklemiyor (Chrome/Edge mobile deneyin)');
      fireCb(callbackName, {status:'error', message:'BarcodeDetector yok'});
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      fireCb(callbackName, {status:'error', message:'Kamera API yok'});
      return;
    }
    var detector;
    try { detector = new window.BarcodeDetector(); }
    catch(e){ fireCb(callbackName, {status:'error', message:String(e)}); return; }

    var video = document.createElement('video');
    video.setAttribute('playsinline','');
    video.muted = true;
    video.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;background:#000;z-index:99998';
    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Kapat';
    closeBtn.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;padding:10px 16px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px';
    document.body.appendChild(video);
    document.body.appendChild(closeBtn);

    var stream = null, raf = null, done = false;
    function cleanup(){
      done = true;
      if (raf) cancelAnimationFrame(raf);
      if (stream) try { stream.getTracks().forEach(function(t){t.stop();}); } catch(e){}
      try { video.remove(); } catch(e){}
      try { closeBtn.remove(); } catch(e){}
    }
    closeBtn.onclick = function(){ cleanup(); fireCb(callbackName, {status:'cancel'}); };

    navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}})
      .then(function(s){
        stream = s; video.srcObject = s;
        return video.play();
      })
      .then(function(){
        function tick(){
          if (done) return;
          detector.detect(video).then(function(codes){
            if (codes && codes[0] && codes[0].rawValue){
              var raw = codes[0].rawValue;
              cleanup();
              fireCb(callbackName, {status:'ok', value:raw});
            } else {
              raf = requestAnimationFrame(tick);
            }
          }).catch(function(){ raf = requestAnimationFrame(tick); });
        }
        raf = requestAnimationFrame(tick);
      })
      .catch(function(err){
        cleanup();
        fireCb(callbackName, {status:'error', message:String(err && err.message || err)});
      });
  }

  // ===== Kamera (file input ile capture) =====
  function kameraAc(callbackName){
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.setAttribute('capture','environment');
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = function(){
      var f = inp.files && inp.files[0];
      try { inp.remove(); } catch(e){}
      if (!f) { fireCb(callbackName, {status:'cancel'}); return; }
      var reader = new FileReader();
      reader.onload = function(){
        var b64 = String(reader.result).split(',')[1] || '';
        ocrDataUri(b64, callbackName);
      };
      reader.readAsDataURL(f);
    };
    inp.click();
  }

  // ===== OCR (Tesseract.js dinamik yukleme) =====
  var _tessReady = null;
  function loadTesseract(){
    if (_tessReady) return _tessReady;
    _tessReady = new Promise(function(resolve, reject){
      if (window.Tesseract) return resolve();
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = function(){ window.Tesseract ? resolve() : reject(new Error('Tesseract yok')); };
      s.onerror = function(){ reject(new Error('Tesseract indirilemedi')); };
      document.head.appendChild(s);
    });
    return _tessReady;
  }
  function ocrDataUri(b64, callbackName){
    loadTesseract().then(function(){
      toast('OCR calisiyor...');
      var dataUrl = 'data:image/jpeg;base64,'+b64;
      window.Tesseract.recognize(dataUrl, 'tur+eng')
        .then(function(res){
          var t = (res && res.data && res.data.text) ? res.data.text.trim() : '';
          fireCb(callbackName, {status:'ok', text:t});
        })
        .catch(function(err){
          fireCb(callbackName, {status:'error', message:String(err)});
        });
    }).catch(function(err){
      fireCb(callbackName, {status:'error', message:String(err)});
    });
  }
  function ocrTara(uri, callbackName){
    fireCb(callbackName, {status:'error', message:'ocrTara web surumunde desteklenmiyor'});
  }

  // ===== Genel dosya kaydetme: PDF/JSON tarayici download'una donustur =====
  function saveFile(base64, filename, mimeType){
    try {
      var mime = mimeType || 'application/octet-stream';
      var bin = atob(base64 || '');
      var bytes = new Uint8Array(bin.length);
      for (var i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
      var blob = new Blob([bytes], {type: mime});
      var a = document.createElement('a');
      var url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename || 'dosya';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); try{a.remove();}catch(e){} }, 1500);
      return 'OK:' + (filename || 'dosya');
    } catch(e){ return 'HATA: '+(e.message||e); }
  }

  // ===== Excel kaydetme: tarayici download'una donustur =====
  function saveExcel(content, filename){
    try {
      var blob;
      if (content instanceof Blob) {
        blob = content;
      } else if (typeof content === 'string') {
        // base64 olabilir
        try {
          var bin = atob(content);
          var bytes = new Uint8Array(bin.length);
          for (var i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
          blob = new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        } catch(e){
          blob = new Blob([content], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        }
      } else {
        blob = new Blob([content], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      }
      var a = document.createElement('a');
      var url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename || 'rapor.xlsx';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); try{a.remove();}catch(e){} }, 1000);
      return 'OK';
    } catch(e){ return 'ERR: '+e.message; }
  }

  // ===== Bridge'i yayinla =====
  window.Android = {
    loadData: loadData,
    getData: loadData,
    saveData: saveData,
    httpGetAsync: httpGetAsync,
    driveKaydetAsync: driveKaydetAsync,
    googleGirisBaslat: googleGirisBaslat,
    googleCikis: googleCikis,
    googleKullaniciBilgi: googleKullaniciBilgi,
    getDriveAccessToken: getDriveAccessToken,
    barkodTara: barkodTara,
    kameraAc: kameraAc,
    ocrDataUri: ocrDataUri,
    ocrTara: ocrTara,
    saveFile: saveFile,
    saveExcel: saveExcel,
    isAdmin: function(){ return false; },
    getKullaniciAd: function(){ return ''; },
    toast: toast
  };

  window.WEB_MODE = true;
  console.log('[CiftciTakip] Web bridge shim aktif (Android: ' + (!!navigator.userAgent.match(/Android/i)) + ')');
})();
