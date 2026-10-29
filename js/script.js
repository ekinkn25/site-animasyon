// Ekin Karıncalı · site davranışları (konuşma, etkileşimler, sesler, gece/gündüz, notlar)
(function () {
  "use strict";

  // Her konuşma bir veya birkaç sayfadan oluşur; tıklayınca sonraki sayfaya geçer.
  var TEXT = {
    welcome: ["Merhaba, hoş geldin!\nOdadaki bazı şeyler tıklanabilir, etrafı kurcala!"],
    intro: [
      "Merhaba, hoş geldin! Ben Ekin Karıncalı.\nTürk Hava Kurumu Üniversitesi'nde yazılım mühendisliği okuyorum ve yapay zekâ alanında kendimi geliştiriyorum.",
      "Stardew Valley'e olan hayranlığım yüzünden kendimi böyle tanıtmak istedim, umarım hoşuna gider.\nİyi vakitler!"
    ],
    ring: ["Rrrriiing... Rrrriiing..."],
    phone: ["Alo, Ekin ben!\nBana ulaşmak istersen mail adresim burada:"],
    coffee: ["Ohh... Kahve molası iyi geldi!"],
    dog: ["Hav hav!"]
  };
  // Konuşmanın hangi sayfasında hangi portre görünsün
  var PORTRAIT = { welcome: "wave", intro: ["smile", "wave"], ring: "phone", phone: "phone", coffee: "coffee", dog: "dog" };
  // İsim etiketinde kim yazsın (yazılmayanlar için "Ekin")
  var SPEAKER = { dog: "Köpek" };
  // Bu konuşmalar bitince kutu kendiliğinden kapanır (ms); diğerleri tıklayınca kapanır
  var AUTO_CLOSE = { welcome: 4500, coffee: 3000, dog: 2500 };

  // Laptoptaki "Projelerim" klasörü. Bağlantı eklemek için url alanını doldur.
  var PROJECTS = [
    {
      id: "nextgencv", name: "NextGenCV", icon: "cv",
      desc: "Üzerinde çalıştığım projelerden biri. Detaylar çok yakında burada olacak!",
      tags: ["Yapay zekâ"], url: ""
    },
    {
      id: "Volcanews", name: "Volcanews", icon: "globe",
      desc: "Deprem, sel, heyelan, volkan ve tsunami haberlerini kaynaklardan toplayıp editör onayıyla yayınlayan bir yer bilimleri haber platformu.",
      tags: ["Next.js", "Expo", "Python"], url: ""
    }
  ];

  var ANKARA = { lat: 39.9334, lon: 32.8597 };

  // Ziyaretçi istatistiği: hangi araç yüklüyse ona haber verir, yoksa sessizce geçer.
  function track(name) {
    try {
      if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: name, title: name, event: true });
      if (window.umami && window.umami.track) window.umami.track(name);
      if (typeof window.plausible === "function") window.plausible(name);
    } catch (e) {}
  }

  var state = { talk: "idle", page: 0, n: 0, done: false, muted: false, view: "room" };
  var full = "";
  var stepId = null, closeId = null;

  var $ = function (sel) { return document.querySelector(sel); };
  var shownEl, lh, rh, muteBtn, conds, fullLabels, speakerEl;

  // ---------------------------------------------------------------- konuşma kutusu
  function pages() { return TEXT[state.talk] || []; }
  function lastPage() { return state.page >= pages().length - 1; }

  function portrait() {
    var p = PORTRAIT[state.talk] || "smile";
    return typeof p === "string" ? p : (p[state.page] || p[p.length - 1]);
  }

  function render() {
    var talk = state.talk, p = portrait();
    var vals = {
      isTalking: talk !== "idle",
      showMail: talk === "phone" && state.done,
      showNext: talk !== "idle" && state.done && !lastPage() && talk !== "ring",
      showEnd: talk !== "idle" && talk !== "ring" && state.done && lastPage(),
      pSmile: p === "smile", pWave: p === "wave", pCoffee: p === "coffee", pPhone: p === "phone", pDog: p === "dog",
      soundOn: !state.muted,
      muted: state.muted
    };
    conds.forEach(function (el) {
      el.style.display = vals[el.getAttribute("data-if")] ? "contents" : "none";
    });
    if (shownEl) shownEl.textContent = full.slice(0, state.n);
    if (speakerEl) speakerEl.textContent = SPEAKER[talk] || "Ekin";
    fullLabels.forEach(function (el) { el.setAttribute("aria-label", full); });
    if (muteBtn) muteBtn.setAttribute("aria-label", state.muted ? "Sesi aç" : "Sesi kapat");
    // Kutu sadece biri konuşurken görünür
    if (dialog) {
      var hide = talk === "idle";
      if (dialog.hidden !== hide) {
        dialog.hidden = hide;
        if (!hide) {
          dialog.classList.remove("pop"); void dialog.offsetWidth; dialog.classList.add("pop");
        }
      }
      placeDialog();
    }
    if (vals.showMail) requestAnimationFrame(fitMail);
  }

  // Mail adresi her zaman tek satır: sığmazsa yazıyı küçült
  function fitMail() {
    var mail = $(".mailbtn");
    if (!mail || !mail.offsetParent) return;
    var avail = mail.parentElement.closest(".say").clientWidth - 70;
    mail.style.fontSize = "";
    var size = parseFloat(getComputedStyle(mail).fontSize);
    while (mail.scrollWidth > avail && size > 9) {
      size -= 0.5;
      mail.style.fontSize = size + "px";
    }
  }

  function say(talk, page) {
    if (stepId) clearTimeout(stepId);
    if (closeId) { clearTimeout(closeId); closeId = null; }
    state.talk = talk; state.page = page || 0;
    full = pages()[state.page] || "";
    state.n = 0; state.done = false;
    render();
    stepId = setTimeout(step, 200);
  }

  function step() {
    state.n++;
    var ch = full.charAt(state.n - 1);
    if (ch && ch !== " " && ch !== "\n" && state.n % 2 === 1 && state.talk !== "ring") blip();
    if (state.n >= full.length) { finish(); return; }
    render();
    var delay = 34;
    if (".!?".indexOf(ch) >= 0) delay = 280;
    else if (ch === ",") delay = 150;
    else if (ch === "\n") delay = 320;
    stepId = setTimeout(step, delay);
  }

  // Sayfa tamamen yazıldı; kısa konuşmalar bir süre sonra kendiliğinden kapanır
  function finish() {
    state.n = full.length; state.done = true;
    render();
    if (lastPage() && AUTO_CLOSE[state.talk]) {
      var talk = state.talk;
      closeId = setTimeout(function () { if (state.talk === talk) toIdle(); }, AUTO_CLOSE[talk]);
    }
  }

  function skipOrNext() {
    if (!state.done) {
      if (stepId) clearTimeout(stepId);
      finish();
      return;
    }
    if (!lastPage()) say(state.talk, state.page + 1);
    else toIdle();
  }

  function toIdle() {
    if (stepId) clearTimeout(stepId);
    if (closeId) { clearTimeout(closeId); closeId = null; }
    stopRing();
    state.talk = "idle"; state.page = 0; full = ""; state.n = 0; state.done = false;
    render();
  }

  // ---------------------------------------------------------------- ses motoru
  // Tüm sesler tek bir ana kanaldan geçer; klavye sesi ayrı ve kısık bir kanalda.
  var ac = null, master = null, kbBus = null, noiseBuf = null;
  var KB_ROOM = 0.55, KB_AWAY = 0.12;

  function audio() {
    if (!ac) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          ac = new AC();
          master = ac.createGain(); master.gain.value = state.muted ? 0 : 1; master.connect(ac.destination);
          kbBus = ac.createGain(); kbBus.gain.value = state.view === "room" ? KB_ROOM : KB_AWAY;
          var soft = ac.createBiquadFilter(); soft.type = "lowpass"; soft.frequency.value = 2400;
          kbBus.connect(soft); soft.connect(master);
        }
      } catch (e) {}
    }
    // iOS'ta durum "interrupted" da olabilir (arama, başka uygulama): her durumda yeniden başlat
    if (ac && ac.state !== "running" && ac.state !== "closed" && !document.hidden) { try { ac.resume(); } catch (e) {} }
  }
  function live() { return ac && master && ac.state === "running"; }

  // Ses motoru uyanırken (resume birkaç ms sürer) çalınmak istenen sesi kaybetme
  function soon(fn) {
    if (live()) { fn(); return; }
    if (!ac || ac.state === "closed") return;
    try { ac.resume().then(function () { if (live()) fn(); }, function () {}); } catch (e) {}
  }

  // iPhone: Safari, Web Audio seslerini telefon sessiz moddayken kısar.
  // Ses oturumunu "oynatma" türüne çeviriyoruz (iOS 17+); daha eski iOS'ta aynı işi
  // sessiz, döngüdeki küçük bir <audio> görür. İlk dokunuşta çalışır.
  var IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var silentEl = null;
  function silentWav() {
    var n = 4000, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    var w = function (o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    w(36, "data"); v.setUint32(40, n, true);
    for (var i = 0; i < n; i++) v.setUint8(44 + i, 128); // 8 bit sessizlik
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  function unlockAudio() {
    if (document.hidden) return;
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
    audio();
    if (IOS && !navigator.audioSession) {
      try {
        if (!silentEl) {
          silentEl = new Audio(silentWav());
          silentEl.loop = true;
          silentEl.setAttribute("x-webkit-airplay", "deny");
          silentEl.setAttribute("playsinline", "");
        }
        if (silentEl.paused) { var p = silentEl.play(); if (p && p.catch) p.catch(function () {}); }
      } catch (e) {}
    }
    // Safari'nin ses motorunu tamamen açması için kısacık boş bir ses
    if (ac && !unlockAudio.done) {
      try {
        var s = ac.createBufferSource(); s.buffer = ac.createBuffer(1, 1, 22050);
        s.connect(ac.destination); s.start(0);
        unlockAudio.done = true;
      } catch (e) {}
    }
  }

  function noise() {
    if (!noiseBuf) {
      var len = Math.floor(ac.sampleRate * 0.03);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 5);
    }
    return noiseBuf;
  }

  function blip() {
    if (!live()) return;
    try {
      var t = ac.currentTime;
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = "square";
      var f = 380 + Math.random() * 110;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.82, t + 0.06);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.04, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.08);
    } catch (e) {}
  }

  // Arka plandaki klavye: yumuşak, uzaktan gelen tıkırtı
  function keyClick() {
    if (!live()) return;
    try {
      var s = ac.createBufferSource();
      s.buffer = noise();
      s.playbackRate.value = 0.7 + Math.random() * 0.35;
      var flt = ac.createBiquadFilter();
      flt.type = "bandpass";
      flt.frequency.value = 1100 + Math.random() * 700;
      flt.Q.value = 0.8;
      var g = ac.createGain();
      g.gain.value = 0.16 + Math.random() * 0.08;
      s.connect(flt); flt.connect(g); g.connect(kbBus);
      s.start();
    } catch (e) {}
  }

  // Bilgisayar ekranındaki tuşlar için fare "tık"ı
  function uiTick() {
    if (!live()) return;
    try {
      [0, 0.055].forEach(function (dt, i) {
        var t = ac.currentTime + dt;
        var s = ac.createBufferSource();
        s.buffer = noise();
        s.playbackRate.value = i ? 1.4 : 1.15;
        var hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2200;
        var g = ac.createGain(); g.gain.value = i ? 0.22 : 0.32;
        s.connect(hp); hp.connect(g); g.connect(master);
        s.start(t);
      });
    } catch (e) {}
  }

  // Eski telefon zili: iki kısa "trrriiing"
  var ringNodes = [];
  function ringBell() {
    if (!live()) return;
    try {
      var t0 = ac.currentTime + 0.05;
      [0, 1.25].forEach(function (off) {
        var t = t0 + off, dur = 0.95;
        var out = ac.createGain();
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
        out.gain.setValueAtTime(0.09, t + dur - 0.08);
        out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        var trem = ac.createGain(); trem.gain.value = 0.5;
        var lfo = ac.createOscillator(); lfo.type = "square"; lfo.frequency.value = 22;
        var lfoAmt = ac.createGain(); lfoAmt.gain.value = 0.5;
        lfo.connect(lfoAmt); lfoAmt.connect(trem.gain);
        [1180, 1560, 2350].forEach(function (f, i) {
          var o = ac.createOscillator();
          o.type = i ? "sine" : "triangle";
          o.frequency.value = f;
          var g = ac.createGain(); g.gain.value = [0.7, 0.45, 0.18][i];
          o.connect(g); g.connect(trem);
          o.start(t); o.stop(t + dur + 0.02);
          ringNodes.push(o);
        });
        trem.connect(out); out.connect(master);
        lfo.start(t); lfo.stop(t + dur + 0.02);
        ringNodes.push(lfo);
      });
    } catch (e) {}
  }
  function stopRing() {
    ringNodes.forEach(function (o) { try { o.stop(); } catch (e) {} });
    ringNodes = [];
    if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
    var ph = $("#phone"); if (ph) ph.classList.remove("ringing");
  }

  function slurp() {
    if (!live()) return;
    try {
      var t = ac.currentTime;
      var s = ac.createBufferSource(); s.buffer = noise(); s.loop = true;
      var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3;
      bp.frequency.setValueAtTime(500, t); bp.frequency.linearRampToValueAtTime(1400, t + 0.35);
      var g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      s.connect(bp); bp.connect(g); g.connect(master);
      s.start(t); s.stop(t + 0.4);
    } catch (e) {}
  }

  // Büyük köpek: iki kısa, tok "hav"
  function woof() {
    if (!live()) return;
    try {
      [0, 0.26].forEach(function (dt) {
        var t = ac.currentTime + 0.02 + dt;
        var o = ac.createOscillator(); o.type = "sawtooth";
        o.frequency.setValueAtTime(330, t);
        o.frequency.linearRampToValueAtTime(420, t + 0.03);
        o.frequency.exponentialRampToValueAtTime(170, t + 0.15);
        var f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 820; f.Q.value = 1.4;
        var g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.26, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
        o.connect(f); f.connect(g); g.connect(master);
        o.start(t); o.stop(t + 0.18);
        var s = ac.createBufferSource(); s.buffer = noise(); s.playbackRate.value = 0.6;
        var nf = ac.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 1300; nf.Q.value = 0.9;
        var ng = ac.createGain(); ng.gain.value = 0.35;
        s.connect(nf); nf.connect(ng); ng.connect(master);
        s.start(t);
      });
    } catch (e) {}
  }

  function setKbLevel(v) {
    if (!kbBus) return;
    var t = ac.currentTime;
    kbBus.gain.cancelScheduledValues(t);
    kbBus.gain.setTargetAtTime(v, t, 0.25);
  }

  // Kızın klavyede yazması (eller + ses). Sekme gizliyken tamamen durur.
  var keyCount = 0, kbTimer = null;
  function kbLoop() {
    var left = 5 + Math.floor(Math.random() * 10);
    function press() {
      kbTimer = null;
      if (document.hidden) return;
      keyCount++;
      var hand = keyCount % 2 ? lh : rh;
      if (hand) {
        hand.classList.add("pressed");
        setTimeout(function () { hand.classList.remove("pressed"); }, 70);
      }
      keyClick();
      left--;
      if (left > 0) kbTimer = setTimeout(press, 95 + Math.random() * 95);
      else kbTimer = setTimeout(kbLoop, 650 + Math.random() * 1400);
    }
    press();
  }
  function kbStop() { if (kbTimer) { clearTimeout(kbTimer); kbTimer = null; } }
  function kbStart() { if (!kbTimer && !document.hidden) kbTimer = setTimeout(kbLoop, 900); }

  // Sekmeden çıkınca / ekran kilitlenince bütün sesler susar
  function onVisibility() {
    if (document.hidden) {
      kbStop();
      stopRing();
      if (ac && ac.state === "running") { try { ac.suspend(); } catch (e) {} }
      if (silentEl && !silentEl.paused) { try { silentEl.pause(); } catch (e) {} }
    } else {
      if (ac && ac.state !== "running" && ac.state !== "closed") { try { ac.resume(); } catch (e) {} }
      kbStart();
    }
  }

  // ---------------------------------------------------------------- odadaki eşyalar
  var ringTimer = null;
  function openPhone() {
    audio(); track("telefon-acildi");
    stopRing();
    var ph = $("#phone");
    ph.classList.add("ringing");
    say("ring");
    soon(ringBell);
    ringTimer = setTimeout(function () {
      ringTimer = null;
      ph.classList.remove("ringing");
      say("phone");
    }, 2500);
  }

  var coffeeClicks = [];
  function tapCoffee() {
    audio();
    var now = Date.now();
    coffeeClicks = coffeeClicks.filter(function (t) { return now - t < 900; });
    coffeeClicks.push(now);
    var cup = $("#coffee");
    cup.classList.remove("sip"); void cup.getBBox(); cup.classList.add("sip");
    if (coffeeClicks.length >= 2) {
      coffeeClicks = [];
      soon(slurp);
      stopRing();
      track("kahve-molasi");
      say("coffee");
    }
  }

  function talkToGirl() {
    audio(); stopRing();
    track("konusma-basladi");
    say("intro");
  }

  function petDog() {
    audio(); stopRing();
    soon(woof);
    var dog = $("#dog");
    dog.classList.remove("bark"); void dog.getBBox(); dog.classList.add("bark");
    track("kopek-sevildi");
    say("dog");
  }

  // ---------------------------------------------------------------- tam ekran pencereler
  var lastFocus = null;
  function openView(name) {
    audio();
    var ov = $("#ov-" + name);
    if (!ov) return;
    lastFocus = document.activeElement;
    closeViews(true);
    ov.hidden = false;
    state.view = name;
    setKbLevel(KB_AWAY);
    try { history.pushState({ ov: name }, ""); } catch (e) {}
    var f = ov.querySelector(name === "note" ? "#n-msg" : ".icon");
    if (f && window.matchMedia("(pointer:fine)").matches) f.focus(); else ov.querySelector(".back").focus();
    track(name === "pc" ? "laptop-acildi" : "defter-acildi");
  }
  function closeViews(silent) {
    var any = false;
    document.querySelectorAll(".ov").forEach(function (ov) { if (!ov.hidden) { ov.hidden = true; any = true; } });
    if (!silent && any) {
      state.view = "room";
      setKbLevel(KB_ROOM);
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    }
    return any;
  }
  function back() {
    // Tarayıcının geri tuşu ile aynı yolu kullan; geçmiş yoksa doğrudan kapat
    if (history.state && history.state.ov) history.back();
    else closeViews();
  }

  // ---------------------------------------------------------------- eski bilgisayar
  var ICONS = {
    cv: '<svg class="px" viewBox="0 0 12 14" aria-hidden="true"><rect x="0" y="0" width="9" height="14" fill="#5b2b29"></rect><rect x="9" y="3" width="3" height="11" fill="#5b2b29"></rect><rect x="1" y="1" width="8" height="12" fill="#ffffff"></rect><rect x="9" y="4" width="2" height="9" fill="#ffffff"></rect><rect x="8" y="1" width="1" height="3" fill="#c9cdd6"></rect><rect x="9" y="3" width="2" height="1" fill="#c9cdd6"></rect><rect x="2" y="2" width="3" height="3" fill="#b07ad9"></rect><rect x="6" y="3" width="3" height="1" fill="#8d93a2"></rect><rect x="2" y="7" width="8" height="1" fill="#8d93a2"></rect><rect x="2" y="9" width="7" height="1" fill="#8d93a2"></rect><rect x="2" y="11" width="8" height="1" fill="#8d93a2"></rect></svg>',
    globe: '<svg class="px" viewBox="0 0 13 13" aria-hidden="true"><rect x="4" y="0" width="5" height="1" fill="#1d4a47"></rect><rect x="2" y="1" width="9" height="1" fill="#1d4a47"></rect><rect x="1" y="2" width="11" height="9" fill="#1d4a47"></rect><rect x="0" y="4" width="13" height="5" fill="#1d4a47"></rect><rect x="2" y="11" width="9" height="1" fill="#1d4a47"></rect><rect x="4" y="12" width="5" height="1" fill="#1d4a47"></rect><rect x="4" y="1" width="5" height="1" fill="#4ba3dc"></rect><rect x="2" y="2" width="9" height="9" fill="#4ba3dc"></rect><rect x="1" y="4" width="11" height="5" fill="#4ba3dc"></rect><rect x="4" y="11" width="5" height="1" fill="#4ba3dc"></rect><rect x="3" y="3" width="3" height="2" fill="#6cc45a"></rect><rect x="2" y="5" width="3" height="2" fill="#6cc45a"></rect><rect x="7" y="6" width="3" height="3" fill="#6cc45a"></rect><rect x="8" y="3" width="2" height="1" fill="#6cc45a"></rect><rect x="5" y="9" width="2" height="1" fill="#6cc45a"></rect><rect x="9" y="7" width="1" height="1" fill="#e8484f"></rect></svg>'
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function osOpen() {
    $("#win").hidden = false;
    $(".icon").classList.add("sel");
    osList();
  }
  function osClose() {
    $("#win").hidden = true;
    $(".icon").classList.remove("sel");
  }
  function osList() {
    $("#win-title").textContent = "Projelerim";
    $("#win-path").textContent = "C:\\EKIN\\PROJELERIM";
    $("#files").hidden = false;
    $("#detail").hidden = true;
    var f = $("#files .file"); if (f && document.activeElement && document.activeElement.closest("#detail")) f.focus({ preventScroll: true });
  }
  function osShow(id) {
    var p = PROJECTS.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    track("proje-" + p.id);
    $("#win-title").textContent = p.name;
    $("#win-path").textContent = "C:\\EKIN\\PROJELERIM\\" + p.name.toUpperCase().replace(/\s+/g, "_");
    var d = $("#detail");
    d.innerHTML =
      "<h3>" + esc(p.name) + "</h3>" +
      "<p>" + esc(p.desc) + "</p>" +
      (p.tags && p.tags.length ? '<div class="tags">' + p.tags.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div>" : "") +
      '<div class="acts"><button class="opt" type="button" data-os="list">‹ Klasöre dön</button>' +
      (p.url ? '<a class="opt" href="' + esc(p.url) + '" target="_blank" rel="noopener">Projeye git ›</a>' : '<span class="tag">Bağlantı yakında</span>') +
      "</div>";
    $("#files").hidden = true;
    d.hidden = false;
    d.parentNode.scrollTop = 0;
    var b = d.querySelector("button"); if (b) b.focus({ preventScroll: true });
  }
  function buildFiles() {
    $("#files").innerHTML = PROJECTS.map(function (p) {
      return '<button class="file" type="button" data-os="show" data-id="' + esc(p.id) + '">' + (ICONS[p.icon] || ICONS.cv) + "<span>" + esc(p.name) + "</span></button>";
    }).join("");
  }

  // ---------------------------------------------------------------- defter (notlar)
  function apiUrl() {
    var m = document.querySelector('meta[name="notlar-api"]');
    return (m && m.content) || "/api/notes";
  }
  function setStatus(msg, kind) {
    var el = $("#n-status");
    el.textContent = msg;
    el.className = "nb-status" + (kind ? " " + kind : "");
  }
  function sendNote(e) {
    e.preventDefault();
    var form = e.target;
    var msg = form.message.value.trim();
    var name = form.name.value.trim();
    if (!msg) { setStatus("Önce bir şeyler yazmalısın :)", "err"); form.message.focus(); return; }
    var btn = form.querySelector(".nb-send");
    btn.disabled = true;
    setStatus("Gönderiliyor...");
    var done = false;
    var timeout = setTimeout(function () { if (!done) { done = true; btn.disabled = false; setStatus("Sunucu cevap vermedi, birazdan tekrar dener misin?", "err"); } }, 12000);
    fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, message: msg, website: form.website.value })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    }).then(function (res) {
      if (done) return; done = true; clearTimeout(timeout);
      btn.disabled = false;
      if (res.ok) {
        form.reset(); updateCount();
        setStatus("Notun deftere yazıldı, teşekkürler! ♥", "ok");
        track("not-gonderildi");
      } else if (res.status === 429) {
        setStatus("Biraz yavaş! Birkaç dakika sonra tekrar deneyebilirsin.", "err");
      } else {
        setStatus((res.j && res.j.error) || "Bir şeyler ters gitti, tekrar dener misin?", "err");
      }
    }).catch(function () {
      if (done) return; done = true; clearTimeout(timeout);
      btn.disabled = false;
      setStatus("Bağlantı kurulamadı, tekrar dener misin?", "err");
    });
  }
  function updateCount() {
    var t = $("#n-msg"), c = $("#n-count");
    if (t && c) c.textContent = t.value.length + "/1000";
  }

  // ---------------------------------------------------------------- Ankara'ya göre gece / gündüz
  // NOAA güneş hesabının sadeleştirilmiş hali: gün doğumu / batımı (UTC ms)
  function sunTimes(date, lat, lon) {
    var rad = Math.PI / 180;
    var start = Date.UTC(date.getUTCFullYear(), 0, 0);
    var doy = Math.floor((date.getTime() - start) / 864e5);
    var g = 2 * Math.PI / 365 * (doy - 1);
    var eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var cosH = (Math.cos(90.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
    cosH = Math.max(-1, Math.min(1, cosH));
    var ha = Math.acos(cosH) / rad;
    var noon = 720 - 4 * lon - eqt; // dakika, UTC
    var day0 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return { rise: day0 + (noon - 4 * ha) * 6e4, set: day0 + (noon + 4 * ha) * 6e4 };
  }

  // ?saat=22:30 ile Ankara saatini taklit edip denemek mümkün
  function nowAnkara() {
    var m = /[?&]saat=(\d{1,2})[:.](\d{2})/.exec(location.search);
    var now = new Date();
    if (m) {
      // Türkiye yıl boyu UTC+3
      var tr = new Date(now.getTime() + 3 * 36e5);
      return new Date(Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate(), +m[1] - 3, +m[2]));
    }
    return now;
  }

  function phaseFor(now) {
    var s = sunTimes(now, ANKARA.lat, ANKARA.lon), t = now.getTime(), w = 35 * 6e4;
    if (t < s.rise - w || t > s.set + w) return "night";
    if (Math.abs(t - s.rise) <= w || Math.abs(t - s.set) <= w) return "dusk";
    return "day";
  }

  var phase = null;
  function show(id, on) { var el = document.getElementById(id); if (el) el.setAttribute("display", on ? "inline" : "none"); }
  function applyPhase() {
    var p = phaseFor(nowAnkara());
    if (p === phase) return;
    phase = p;
    document.documentElement.setAttribute("data-phase", p);
    var night = p === "night", dusk = p === "dusk";
    show("nightsky", night);
    show("dusksky", dusk);
    show("roomdark", night || dusk);
    show("glow", night || dusk);
    show("bulb", night || dusk);
    var dark = $("#roomdark");
    if (dark) dark.setAttribute("fill", night ? "#5c4436" : "#c9a088");
    var glow = $("#glow");
    if (glow) glow.setAttribute("opacity", night ? "1" : "0.55");
    // Gece güneş, kuşlar ve kelebek görünmez
    document.querySelectorAll("#sun,.birds,.bigbird,.bfly").forEach(function (el) { el.setAttribute("display", night ? "none" : "inline"); });
  }

  function tickClock() {
    var el = $("#tclock");
    if (!el) return;
    var tr = new Date(nowAnkara().getTime() + 3 * 36e5);
    el.textContent = ("0" + tr.getUTCHours()).slice(-2) + ":" + ("0" + tr.getUTCMinutes()).slice(-2);
  }

  // ---------------------------------------------------------------- yerleşim
  // Oda 192×134 piksel ve ekrana sığacak kadar büyür. Konuşma kutusu odanın boyutunu
  // hiç değiştirmez: yer varsa odanın altında, yoksa odanın alt kısmının üstünde durur.
  var RH = 134, MAXVW = 272;
  var frame, svg, dialog, page, stage, gap = 12;
  function layout() {
    if (!frame) return;
    var B = 18; // çerçeve kenarlığı + iç boşluk
    var W = stage.clientWidth - B, H = stage.clientHeight - B;
    if (W < 40 || H < 40) return; // sayfa henüz ölçülemiyor (gizli/sıfır boyut)
    // Telefon / dar / dikey ekran: konuşma kutusu her zaman sahnenin altında, ona yer ayrılır
    var stack = window.matchMedia("(max-width: 699px), (orientation: portrait)").matches;
    page.classList.toggle("stack", stack);
    gap = Math.round(Math.max(8, Math.min(18, W * 0.014)));
    var fs = Math.max(14, Math.min(22, Math.min(W * 0.021, H * 0.028)));
    dialog.style.setProperty("--dlg-fs", fs.toFixed(1) + "px");
    dialog.style.setProperty("--pp-size", Math.round(Math.max(48, Math.min(132, H * 0.14))) + "px");
    var reserve = stack ? Math.round(Math.min(300, Math.max(190, H * 0.42))) : 0;
    var s = Math.max(0.5, Math.min(W / 192, (H - reserve - (stack ? gap : 0)) / RH));
    var vw = Math.min(W / s, MAXVW);
    svg.setAttribute("viewBox", ((192 - vw) / 2).toFixed(2) + " 0 " + vw.toFixed(2) + " " + RH);
    svg.style.width = Math.floor(vw * s) + "px";
    svg.style.height = Math.floor(RH * s) + "px";
    // Sahne + kutu alanı birlikte ekranda ortalansın
    stage.style.paddingTop = stack ? Math.max(0, Math.floor((H - RH * s - gap - reserve) / 2)) + "px" : "";
    placeDialog();
  }

  function placeDialog() {
    if (!dialog || dialog.hidden) return;
    // offset değerleri açılış kayma animasyonundan etkilenmez (.page tüm ekranı kaplar)
    var fr = { left: frame.offsetLeft, top: frame.offsetTop, width: frame.offsetWidth, bottom: frame.offsetTop + frame.offsetHeight };
    var w = Math.min(fr.width - 2 * gap, 1080);
    dialog.style.width = Math.floor(w) + "px";
    dialog.style.left = Math.round(fr.left + (fr.width - w) / 2) + "px";
    var say = dialog.querySelector(".say");
    if (page.classList.contains("stack")) {
      var top = fr.bottom + gap;
      dialog.style.top = Math.round(top) + "px";
      // Çok uzun metin ekrandan taşmasın: kutunun içi kayar
      say.style.maxHeight = Math.max(80, Math.floor(window.innerHeight - top - 8 - 12)) + "px";
      return;
    }
    say.style.maxHeight = "";
    var D = dialog.offsetHeight;
    var below = window.innerHeight - fr.bottom - 10;
    var t = below >= D + gap ? fr.bottom + gap : fr.bottom - 9 - gap - D;
    dialog.style.top = Math.round(Math.max(8, t)) + "px";
  }

  // ---------------------------------------------------------------- başlat
  var actions = {
    advance: function () {
      audio();
      if (state.talk === "idle" || state.talk === "ring") return;
      skipOrNext();
    },
    restart: function () { audio(); toIdle(); },
    toggleMute: function () {
      audio();
      state.muted = !state.muted;
      if (master) master.gain.setTargetAtTime(state.muted ? 0 : 1, ac.currentTime, 0.02);
      if (state.muted) { track("ses-kapatildi"); stopRing(); }
      render();
    }
  };

  function hotspot(id, fn) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", fn);
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    });
  }

  function init() {
    shownEl = $("#shown"); speakerEl = $("#speaker");
    lh = $("#lh"); rh = $("#rh");
    muteBtn = $("#mutebtn");
    frame = $(".scene-frame"); svg = $("#roomsvg"); dialog = $("#dialog"); page = $(".page"); stage = $(".stage");
    conds = [].slice.call(document.querySelectorAll("[data-if]"));
    fullLabels = [].slice.call(document.querySelectorAll("[data-full-label]"));
    document.querySelectorAll("[data-act]").forEach(function (el) {
      var fn = actions[el.getAttribute("data-act")];
      if (fn) el.addEventListener("click", fn);
    });
    var mail = $(".mailbtn");
    if (mail) mail.addEventListener("click", function () { track("mail-tiklandi"); });

    hotspot("girl", talkToGirl);
    hotspot("phone", openPhone);
    hotspot("coffee", tapCoffee);
    hotspot("laptop", function () { openView("pc"); });
    hotspot("notebook", function () { openView("note"); });
    hotspot("dog", petDog);
    // Odada boş bir yere tıklamak açık konuşmayı kapatır
    svg.addEventListener("click", function (e) {
      if (!e.target.closest(".hot") && state.talk !== "idle" && state.talk !== "ring") toIdle();
    });

    // Pencerelerdeki her tuş "tık" sesi çıkarır
    document.querySelectorAll(".ov").forEach(function (ov) {
      ov.addEventListener("click", function (e) {
        if (e.target.closest("button, a, input[type=submit]")) { audio(); soon(uiTick); }
      });
    });
    document.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", back); });
    $("#os").addEventListener("click", function (e) {
      var b = e.target.closest("[data-os]");
      if (!b) return;
      var a = b.getAttribute("data-os");
      if (a === "open") osOpen();
      else if (a === "close") osClose();
      else if (a === "list") osList();
      else if (a === "show") osShow(b.getAttribute("data-id"));
    });
    buildFiles();
    $("#noteform").addEventListener("submit", sendNote);
    $("#n-msg").addEventListener("input", updateCount);

    window.addEventListener("popstate", function () { closeViews(); });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (state.view !== "room") back();
      else if (state.talk !== "idle") toIdle();
    });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", function () { kbStop(); stopRing(); if (ac) { try { ac.suspend(); } catch (e) {} } if (silentEl) { try { silentEl.pause(); } catch (e) {} } });
    // iOS: ses motoru ancak bir dokunuşla açılabilir; tıklamadan önceki ilk temasta aç
    ["pointerdown", "touchend", "keydown"].forEach(function (ev) { document.addEventListener(ev, unlockAudio, true); });

    render();
    layout();
    if (window.ResizeObserver) {
      new ResizeObserver(function () { layout(); }).observe(stage);
      // Metin uzadıkça kutu büyür: sadece kutunun yerini güncelle, oda yerinde kalsın
      new ResizeObserver(function () { placeDialog(); }).observe(dialog);
    }
    window.addEventListener("resize", function () { layout(); fitMail(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

    applyPhase(); tickClock();
    setInterval(function () { applyPhase(); tickClock(); }, 30000);
    kbStart();
    // Açılış karşılaması (sayfa kararması bittikten sonra)
    setTimeout(function () { if (state.talk === "idle" && state.view === "room") say("welcome"); }, 1900);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
