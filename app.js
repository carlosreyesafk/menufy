'use strict';
/* =====================================================================
   menufy — Generador de menús QR para restaurantes.
   100% cliente: sin backend, sin API keys.
   Las funciones puras de esta sección son testeables en Node (ver test).
   ===================================================================== */

/* ---------------- Constantes ---------------- */
const CANONICAL_BASE = 'https://carlosreyesafk.github.io/menufy/';
const PAYPAL_EMAIL = 'chachiafk@gmail.com';
const USDT_BSC_ADDRESS = '0xb2a38e074808f0c0d4ee9c13f5894c6c601fb172';
const USDT_CONTRACT = '0x55d398326f99059ff775485246999027b3197955'; // USDT oficial en BSC
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // keccak256("Transfer(address,address,uint256)")
const PRO_PRICE_USDT = 29n;
const PRO_PRICE_DECIMALS = 18n;
const BSC_RPCS = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
  'https://bsc.publicnode.com'
];
const LS_PRO = 'menufy_pro';
const LS_DRAFT = 'menufy_draft';
const LS_SAVED = 'menufy_saved';
const THEME_DEFAULT = { bg: '#faf6ef', ink: '#1c1917', accent: '#b45309' };

/* ---------------- Funciones puras (sin DOM) ---------------- */

// SHA-256 en JS puro (síncrono; funciona en cualquier contexto, sin crypto.subtle).
function sha256Hex(ascii) {
  function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
  var maxWord = Math.pow(2, 32), result = '';
  var words = [], bitLen = ascii.length * 8;
  var hash = sha256Hex.h = sha256Hex.h || [];
  var k = sha256Hex.k = sha256Hex.k || [];
  var primeCounter = k.length, isComposite = {};
  for (var candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (var i = 0; i < ascii.length; i++) {
    var j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (bitLen / maxWord) | 0;
  words[words.length] = bitLen;
  for (var j = 0; j < words.length;) {
    var w = words.slice(j, j += 16), oldHash = hash;
    hash = hash.slice(0, 8);
    for (var i = 0; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
      var t1 = hash[7]
        + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25))
        + ((e & hash[5]) ^ (~e & hash[6]))
        + k[i]
        + (w[i] = i < 16 ? w[i] : (w[i - 16]
          + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3))
          + w[i - 7]
          + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10)) | 0));
      var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(t1 + t2) | 0].concat(hash);
      hash[4] = (hash[4] + t1) | 0;
    }
    for (var i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (var i = 0; i < 8; i++) {
    for (var j = 3; j + 1; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

function utf8Bytes(str) { return unescape(encodeURIComponent(str)); }

// Código PRO de PayPal: primeros 16 hex de SHA-256("CHACHI-PRO-" + email limpio).
function proCodeForEmail(email) {
  var clean = String(email || '').toLowerCase().replace(/\s+/g, '');
  if (!clean || clean.indexOf('@') < 0) return '';
  return sha256Hex(utf8Bytes('CHACHI-PRO-' + clean)).slice(0, 16);
}

// Menú -> base64url (UTF-8 seguro) y viceversa.
function encodeMenu(menu) {
  var json = JSON.stringify(menu);
  var bytes = (typeof TextEncoder !== 'undefined')
    ? new TextEncoder().encode(json)
    : Array.from(utf8Bytes(json)).map(function (c) { return c.charCodeAt(0); });
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeMenu(hash) {
  var s = String(hash || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  var bin = atob(s);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var json = (typeof TextDecoder !== 'undefined')
    ? new TextDecoder().decode(bytes)
    : decodeURIComponent(escape(String.fromCharCode.apply(null, bytes)));
  var menu = JSON.parse(json);
  if (!menu || typeof menu !== 'object' || !Array.isArray(menu.cats)) {
    throw new Error('menu inválido');
  }
  return menu;
}

function buildMenuUrl(menu) {
  return CANONICAL_BASE + '#m=' + encodeMenu(menu);
}

// Valida un receipt de eth_getTransactionReceipt contra el pago PRO en USDT/BSC.
// Devuelve { ok, reason, total } donde total es el string en wei (para debug).
function parseBscReceipt(receipt, opts) {
  opts = opts || {};
  var usdt = (opts.usdtContract || USDT_CONTRACT).toLowerCase();
  var dest = (opts.destAddress || USDT_BSC_ADDRESS).toLowerCase();
  var minWei = (opts.minUsdtWei !== undefined)
    ? BigInt(opts.minUsdtWei)
    : PRO_PRICE_USDT * (10n ** PRO_PRICE_DECIMALS);

  if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'sin-receipt' };
  if (String(receipt.status).toLowerCase() !== '0x1') return { ok: false, reason: 'tx-fallida' };

  var total = 0n;
  var logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  for (var i = 0; i < logs.length; i++) {
    var log = logs[i] || {};
    if (!log.address || String(log.address).toLowerCase() !== usdt) continue;
    var topics = Array.isArray(log.topics) ? log.topics : [];
    if (topics.length < 3 || String(topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
    var to = '0x' + String(topics[2]).slice(-40).toLowerCase();
    if (to !== dest) continue;
    if (!log.data || log.data === '0x') continue;
    try { total += BigInt(log.data); } catch (e) { /* dato malformado: se ignora */ }
  }
  if (total >= minWei) return { ok: true, reason: 'ok', total: total.toString() };
  return { ok: false, reason: total > 0n ? 'monto-insuficiente' : 'sin-pago', total: total.toString() };
}

function uid() {
  return 'id-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isPro() {
  try { return localStorage.getItem(LS_PRO) === '1'; } catch (e) { return false; }
}

/* ---------------- Menú de ejemplo ---------------- */
function sampleMenu() {
  var cat = function (es, en, items) {
    return {
      id: uid(), es: es, en: en,
      items: items.map(function (it) {
        return { id: uid(), es: { name: it[0], desc: it[1] }, en: { name: it[2], desc: it[3] }, price: it[4] };
      })
    };
  };
  return {
    v: 1,
    name: 'Sazón Criolla',
    desc: 'Comida típica dominicana hecha con amor',
    currency: 'RD$',
    lang: 'es',
    logo: '',
    theme: Object.assign({}, THEME_DEFAULT),
    pro: false,
    cats: [
      cat('Entradas', 'Starters', [
        ['Quipes (3 uds.)', 'Crujientes, con su salsita agria', 'Quipes (3 pcs.)', 'Crispy, with tangy sauce', '200'],
        ['Empanadas de queso', 'Rellenas de queso derretido', 'Cheese empanadas', 'Filled with melted cheese', '150']
      ]),
      cat('Platos Fuertes', 'Main Dishes', [
        ['La Bandera', 'Arroz, habichuelas, carne y tostones', 'La Bandera', 'Rice, beans, meat & tostones', '350'],
        ['Mofongo de camarones', 'Con caldo de la casa', 'Shrimp mofongo', 'With house broth', '550'],
        ['Pechuga a la plancha', 'Con ensalada verde y batata', 'Grilled chicken breast', 'With green salad & sweet potato', '400']
      ]),
      cat('Bebidas', 'Drinks', [
        ['Morir soñando', 'El clásico bien frío', 'Morir soñando', 'The classic, ice cold', '150'],
        ['Jugo de chinola', 'Natural, hecho en casa', 'Passion fruit juice', 'Natural, homemade', '125']
      ]),
      cat('Postres', 'Desserts', [
        ['Flan de coco', 'Cremoso, receta de la abuela', 'Coconut flan', 'Creamy, grandma’s recipe', '175'],
        ['Tres leches', 'Esponjoso y bien mojadito', 'Tres leches', 'Spongy and milky', '200']
      ])
    ]
  };
}

function blankMenu() {
  var m = sampleMenu();
  m.name = ''; m.desc = '';
  m.cats = [];
  return m;
}

/* =====================================================================
   Todo lo que sigue solo corre en el navegador.
   ===================================================================== */
if (typeof document !== 'undefined') {

var menu = sampleMenu();
var editLang = 'es';   // idioma que se está editando en el formulario
var viewLang = 'es';   // idioma de la vista previa
var publicLang = 'es';
var saveTimer = null;

/* ---------- Utilidades DOM ---------- */
function $(id) { return document.getElementById(id); }
function el(tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function money(price, currency) {
  var p = String(price === undefined || price === null ? '' : price).trim();
  if (!p) return '';
  return escapeHtml(currency ? currency + ' ' : '') + escapeHtml(p);
}
function catName(c, lang) { return (lang === 'en' && c.en) ? c.en : c.es; }
function itemName(it, lang) {
  var o = lang === 'en' ? it.en : it.es;
  return (o && o.name) ? o.name : (it.es && it.es.name) || (it.en && it.en.name) || '';
}
function itemDesc(it, lang) {
  var o = lang === 'en' ? it.en : it.es;
  return (o && o.desc) ? o.desc : (it.es && it.es.desc) || (it.en && it.en.desc) || '';
}
function hasEnglish(m) {
  return m.cats.some(function (c) {
    if (c.en) return true;
    return c.items.some(function (it) { return it.en && (it.en.name || it.en.desc); });
  });
}

/* ---------- Navegación entre vistas ---------- */
function showView(name) {
  $('view-landing').hidden = name !== 'landing';
  $('view-builder').hidden = name !== 'builder';
  $('view-public').hidden = name !== 'public';
  window.scrollTo(0, 0);
  if (name !== 'public' && location.hash && location.hash.indexOf('#m=') === 0) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

document.addEventListener('click', function (ev) {
  var t = ev.target.closest('[data-nav]');
  if (t) {
    ev.preventDefault();
    showView(t.getAttribute('data-nav'));
    if (t.getAttribute('data-goto') === 'pro') {
      setTimeout(function () { $('pro-panel').scrollIntoView({ behavior: 'smooth' }); }, 60);
    }
    return;
  }
  var c = ev.target.closest('[data-copy]');
  if (c) {
    var src = $(c.getAttribute('data-copy'));
    copyText(src ? src.textContent.trim() : '', c);
    return;
  }
  var ca = ev.target.closest('[data-copy-addr]');
  if (ca) { copyText(ca.getAttribute('data-copy-addr'), ca); }
});

function copyText(text, btn) {
  function done() {
    if (!btn) return;
    var old = btn.textContent;
    btn.textContent = '¡Copiado!';
    setTimeout(function () { btn.textContent = old; }, 1600);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
  } else fallback();
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); done();
  }
}

/* ---------- Render del menú (preview + público + print) ---------- */
function menuHtml(m, lang) {
  var theme = m.theme || THEME_DEFAULT;
  var style = ' style="--mbg:' + escapeHtml(theme.bg) + ';--mink:' + escapeHtml(theme.ink) +
    ';--maccent:' + escapeHtml(theme.accent) + ';"';
  var h = '<div class="menu-paper"' + style + '>';
  if (m.pro && m.logo) {
    h += '<div style="text-align:center"><img class="m-logo" src="' + escapeHtml(m.logo) +
      '" alt="Logo" onerror="this.style.display=\'none\'"></div>';
  }
  h += '<p class="m-kicker">MENÚ · MENU</p>';
  h += '<h2 class="m-name">' + escapeHtml(m.name || 'Mi restaurante') + '</h2>';
  if (m.desc) h += '<p class="m-desc">' + escapeHtml(m.desc) + '</p>';
  h += '<div class="m-rule">◈</div>';
  var anyItem = false;
  (m.cats || []).forEach(function (c) {
    if (!c.items || !c.items.length) return;
    anyItem = true;
    h += '<div class="m-cat">' + escapeHtml(catName(c, lang) || 'Categoría') + '</div>';
    c.items.forEach(function (it) {
      var nm = itemName(it, lang);
      if (!nm) return;
      h += '<div class="m-item"><div class="m-item-top"><span class="m-item-name">' + escapeHtml(nm) +
        '</span><span class="m-dots"></span><span class="m-item-price">' + money(it.price, m.currency) + '</span></div>';
      var d = itemDesc(it, lang);
      if (d) h += '<p class="m-item-desc">' + escapeHtml(d) + '</p>';
      h += '</div>';
    });
  });
  if (!anyItem) h += '<p class="m-empty">Agrega categorías y platos para ver tu menú aquí.</p>';
  if (!m.pro) h += '<p class="m-badge">Creado con Menufy by Chachi</p>';
  h += '</div>';
  return h;
}

function renderPreview() {
  menu.pro = isPro(); // el preview siempre refleja el estado PRO real
  viewLang = menu.lang || 'es';
  document.querySelectorAll('[data-viewlang]').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-viewlang') === viewLang);
  });
  $('preview').innerHTML = menuHtml(menu, viewLang);
}

/* ---------- Formulario del constructor ---------- */
function renderForm() {
  $('f-name').value = menu.name || '';
  $('f-desc').value = menu.desc || '';
  var sel = $('f-currency');
  var cur = menu.currency || 'RD$';
  var found = Array.prototype.some.call(sel.options, function (o) { return o.value === cur; });
  sel.value = found ? cur : 'custom';
  $('f-currency-custom').hidden = found;
  if (!found) $('f-currency-custom').value = cur;
  $('f-lang').value = menu.lang || 'es';
  $('f-logo').value = menu.logo || '';
  var th = menu.theme || THEME_DEFAULT;
  $('f-c-bg').value = th.bg; $('f-c-ink').value = th.ink; $('f-c-accent').value = th.accent;
}

function renderCats() {
  var box = $('cats');
  box.innerHTML = '';
  menu.cats.forEach(function (c, ci) {
    var card = el('div', 'cat');
    var head = el('div', 'cat-head');
    var nameInput = el('input');
    nameInput.type = 'text';
    nameInput.placeholder = editLang === 'en' ? 'Category name' : 'Nombre de la categoría';
    nameInput.value = editLang === 'en' ? (c.en || '') : (c.es || '');
    nameInput.setAttribute('data-cat', ci);
    nameInput.setAttribute('data-field', 'catname');
    head.appendChild(nameInput);
    var del = el('button', 'btn-icon', '🗑');
    del.title = 'Eliminar categoría';
    del.setAttribute('data-cat', ci);
    del.setAttribute('data-action', 'del-cat');
    head.appendChild(del);
    card.appendChild(head);

    c.items.forEach(function (it, ii) {
      var langObj = editLang === 'en' ? it.en : it.es;
      var item = el('div', 'item');
      var grid = el('div', 'item-grid');
      grid.innerHTML =
        '<label class="full">' + (editLang === 'en' ? 'Dish name' : 'Nombre del plato') +
          '<input type="text" data-cat="' + ci + '" data-item="' + ii + '" data-field="name" value="' + escapeHtml(langObj.name || '') + '"></label>' +
        '<label>' + (editLang === 'en' ? 'Price' : 'Precio') +
          '<input type="text" data-cat="' + ci + '" data-item="' + ii + '" data-field="price" value="' + escapeHtml(it.price || '') + '" placeholder="250"></label>' +
        '<label class="full">' + (editLang === 'en' ? 'Description (optional)' : 'Descripción (opcional)') +
          '<input type="text" data-cat="' + ci + '" data-item="' + ii + '" data-field="desc" value="' + escapeHtml(langObj.desc || '') + '"></label>';
      item.appendChild(grid);
      var actions = el('div', 'item-actions');
      var delItem = el('button', 'btn-icon', '🗑 Quitar');
      delItem.setAttribute('data-cat', ci);
      delItem.setAttribute('data-item', ii);
      delItem.setAttribute('data-action', 'del-item');
      actions.appendChild(delItem);
      item.appendChild(actions);
      card.appendChild(item);
    });

    var addBtn = el('button', 'btn btn-sm btn-ghost', '+ ' + (editLang === 'en' ? 'Add dish' : 'Agregar plato'));
    addBtn.setAttribute('data-cat', ci);
    addBtn.setAttribute('data-action', 'add-item');
    card.appendChild(addBtn);
    box.appendChild(card);
  });
  if (!menu.cats.length) {
    box.innerHTML = '<p class="muted">Todavía no tienes categorías. Agrega la primera con el botón de arriba.</p>';
  }
}

$('cats').addEventListener('input', function (ev) {
  var t = ev.target;
  var ci = parseInt(t.getAttribute('data-cat'), 10);
  if (isNaN(ci) || !menu.cats[ci]) return;
  var field = t.getAttribute('data-field');
  if (field === 'catname') {
    if (editLang === 'en') menu.cats[ci].en = t.value; else menu.cats[ci].es = t.value;
  } else {
    var ii = parseInt(t.getAttribute('data-item'), 10);
    var it = menu.cats[ci].items[ii];
    if (!it) return;
    var o = editLang === 'en' ? it.en : it.es;
    if (field === 'name') o.name = t.value;
    else if (field === 'desc') o.desc = t.value;
    else if (field === 'price') it.price = t.value;
  }
  queueAutosave();
  renderPreview();
});

$('cats').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-action]');
  if (!b) return;
  var ci = parseInt(b.getAttribute('data-cat'), 10);
  var action = b.getAttribute('data-action');
  if (action === 'add-item') {
    menu.cats[ci].items.push({ id: uid(), es: { name: '', desc: '' }, en: { name: '', desc: '' }, price: '' });
  } else if (action === 'del-item') {
    var ii = parseInt(b.getAttribute('data-item'), 10);
    menu.cats[ci].items.splice(ii, 1);
  } else if (action === 'del-cat') {
    if (confirm('¿Eliminar esta categoría con todos sus platos?')) menu.cats.splice(ci, 1);
    else return;
  }
  renderCats(); renderPreview(); queueAutosave();
});

$('btn-add-cat').addEventListener('click', function () {
  menu.cats.push({ id: uid(), es: 'Nueva categoría', en: 'New category', items: [] });
  renderCats(); renderPreview(); queueAutosave();
});

[['f-name', 'name'], ['f-desc', 'desc']].forEach(function (pair) {
  $(pair[0]).addEventListener('input', function (ev) {
    menu[pair[1]] = ev.target.value;
    queueAutosave(); renderPreview();
  });
});
$('f-currency').addEventListener('change', function (ev) {
  if (ev.target.value === 'custom') { $('f-currency-custom').hidden = false; $('f-currency-custom').focus(); }
  else { $('f-currency-custom').hidden = true; menu.currency = ev.target.value; queueAutosave(); renderPreview(); }
});
$('f-currency-custom').addEventListener('input', function (ev) {
  menu.currency = ev.target.value || 'RD$';
  queueAutosave(); renderPreview();
});
$('f-lang').addEventListener('change', function (ev) {
  menu.lang = ev.target.value; viewLang = menu.lang;
  queueAutosave(); renderPreview();
});

// Tabs de idioma (edición y vista previa)
document.querySelectorAll('[data-editlang]').forEach(function (b) {
  b.addEventListener('click', function () {
    editLang = b.getAttribute('data-editlang');
    document.querySelectorAll('[data-editlang]').forEach(function (x) {
      x.classList.toggle('active', x === b);
    });
    renderCats();
  });
});
document.querySelectorAll('[data-viewlang]').forEach(function (b) {
  b.addEventListener('click', function () {
    viewLang = b.getAttribute('data-viewlang');
    renderPreview();
  });
});

// PRO: logo y colores
$('f-logo').addEventListener('input', function (ev) {
  menu.logo = ev.target.value.trim();
  queueAutosave(); renderPreview();
});
[['f-c-bg', 'bg'], ['f-c-ink', 'ink'], ['f-c-accent', 'accent']].forEach(function (pair) {
  $(pair[0]).addEventListener('input', function (ev) {
    menu.theme = menu.theme || Object.assign({}, THEME_DEFAULT);
    menu.theme[pair[1]] = ev.target.value;
    queueAutosave(); renderPreview();
  });
});
$('btn-theme-reset').addEventListener('click', function () {
  menu.theme = Object.assign({}, THEME_DEFAULT);
  renderForm(); renderPreview(); queueAutosave();
});

/* ---------- Autoguardado ---------- */
function queueAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try { localStorage.setItem(LS_DRAFT, JSON.stringify(menu)); } catch (e) {}
  }, 600);
}
function loadDraft() {
  try {
    var raw = localStorage.getItem(LS_DRAFT);
    if (!raw) return false;
    var m = JSON.parse(raw);
    if (m && typeof m === 'object' && Array.isArray(m.cats)) { menu = m; return true; }
  } catch (e) {}
  return false;
}

/* ---------- Generar link + QR ---------- */
var lastQrUrl = '';
$('btn-generate').addEventListener('click', function () {
  menu.pro = isPro();
  var url;
  try { url = buildMenuUrl(menu); }
  catch (e) { alert('No se pudo generar el link. Revisa tu menú e inténtalo de nuevo.'); return; }
  queueAutosave();
  $('output-card').hidden = false;
  $('f-link').value = url;
  loadQr(url);
  $('output-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

function loadQr(menuUrl) {
  lastQrUrl = menuUrl;
  var img = $('qr-img');
  $('qr-error').hidden = true;
  img.hidden = false;
  img.onerror = function () {
    img.hidden = true;
    $('qr-error').hidden = false;
  };
  img.onload = function () { $('qr-error').hidden = true; img.hidden = false; };
  img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=12&data=' +
    encodeURIComponent(menuUrl);
}
$('btn-qr-retry').addEventListener('click', function () { if (lastQrUrl) loadQr(lastQrUrl); });
$('btn-copy-link').addEventListener('click', function () {
  copyText($('f-link').value, $('btn-copy-link'));
});

/* ---------- Impresión ---------- */
function doPrint(html) {
  $('print-root').innerHTML = html;
  setTimeout(function () { window.print(); }, 60);
}
$('btn-print-menu').addEventListener('click', function () {
  doPrint(menuHtml(menu, viewLang));
});
$('btn-print-qr').addEventListener('click', function () {
  var url = $('f-link').value || buildMenuUrl(menu);
  var qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=12&data=' + encodeURIComponent(url);
  doPrint(
    '<div class="qr-flyer"><h1>' + escapeHtml(menu.name || 'Nuestro menú') + '</h1>' +
    '<p>Escanea el código para ver el menú</p>' +
    '<img src="' + qrSrc + '" alt="QR del menú"><p>' + escapeHtml(url) + '</p></div>'
  );
});

/* ---------- PRO: verificación USDT/BSC ---------- */
function setStatus(id, msg, cls) {
  var p = $(id);
  p.textContent = msg;
  p.className = 'status' + (cls ? ' ' + cls : '');
}
function activatePro() {
  try { localStorage.setItem(LS_PRO, '1'); } catch (e) {}
  menu.pro = true;
  applyProUI();
  renderPreview();
  queueAutosave();
}
function applyProUI() {
  var pro = isPro();
  $('pro-badge').hidden = !pro;
  $('pro-badge-2').hidden = !pro;
  $('pro-locked').hidden = pro;
  $('pro-unlocked').hidden = !pro;
  $('saved-note').textContent = pro
    ? 'Plan PRO: guarda todos los menús que quieras.'
    : 'Plan gratis: 1 menú guardado. Con PRO guardas varios.';
}
$('btn-verify-tx').addEventListener('click', function () {
  var tx = $('f-txhash').value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) {
    setStatus('tx-status', 'Ese hash no parece válido. Debe empezar con 0x y tener 64 caracteres.', 'err');
    return;
  }
  setStatus('tx-status', 'Verificando tu pago en la red BSC… esto toma unos segundos.', 'busy');
  verifyBscTx(tx).then(function (res) {
    if (res.ok) {
      activatePro();
      setStatus('tx-status', '✅ ¡Pago confirmado! Tu plan PRO ya está activo.', 'ok');
    } else {
      var msgs = {
        'tx-fallida': 'La transacción existe pero falló en la red. Revisa el hash.',
        'sin-pago': 'No encontramos 29 USDT hacia nuestra dirección en esa transacción.',
        'monto-insuficiente': 'Llegó un pago, pero es menor a 29 USDT.',
        'no-encontrada': 'No encontramos esa transacción todavía. Espera unos minutos a que se confirme e inténtalo de nuevo.',
        'red': 'No pudimos hablar con la red BSC ahora mismo. Revisa tu internet e inténtalo de nuevo.'
      };
      setStatus('tx-status', '😕 ' + (msgs[res.reason] || 'No se pudo verificar el pago.'), 'err');
    }
  });
});

function rpcCall(rpc, txHash) {
  return fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] })
  }).then(function (r) {
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }).then(function (j) {
    if (j.error) throw new Error(j.error.message || 'rpc error');
    return j.result || null;
  });
}
function verifyBscTx(txHash) {
  // Intenta los RPC públicos en orden hasta que uno responda.
  var chain = Promise.resolve(null);
  BSC_RPCS.forEach(function (rpc) {
    chain = chain.then(function (receipt) {
      if (receipt) return receipt;
      return rpcCall(rpc, txHash).catch(function () { return null; });
    });
  });
  return chain.then(function (receipt) {
    if (!receipt) return { ok: false, reason: 'red' };
    // null result = transacción aún no minada o hash inexistente
    if (receipt === null) return { ok: false, reason: 'no-encontrada' };
    return parseBscReceipt(receipt);
  }).catch(function () {
    return { ok: false, reason: 'red' };
  });
}

/* ---------- PRO: código de PayPal ---------- */
$('btn-verify-code').addEventListener('click', function () {
  var emailAddr = $('f-pro-email').value.trim();
  var code = $('f-pro-code').value.trim().toLowerCase();
  if (!emailAddr || !code) {
    setStatus('code-status', 'Escribe tu correo y el código que te enviamos.', 'err');
    return;
  }
  var expected = proCodeForEmail(emailAddr);
  if (!expected) {
    setStatus('code-status', 'Ese correo no parece válido.', 'err');
    return;
  }
  if (code === expected) {
    activatePro();
    setStatus('code-status', '✅ ¡Código correcto! Tu plan PRO ya está activo.', 'ok');
  } else {
    setStatus('code-status', '😕 Ese código no coincide. Revisa que sea el correo con el que pagaste.', 'err');
  }
});

/* ---------- Menús guardados ---------- */
function getSaved() {
  try { return JSON.parse(localStorage.getItem(LS_SAVED) || '[]'); } catch (e) { return []; }
}
function setSaved(list) {
  try { localStorage.setItem(LS_SAVED, JSON.stringify(list)); } catch (e) {}
}
function renderSaved() {
  var list = getSaved();
  var ul = $('saved-list');
  ul.innerHTML = '';
  list.forEach(function (s) {
    var li = el('li');
    li.appendChild(el('span', '', escapeHtml(s.name)));
    var load = el('button', 'btn btn-sm btn-ghost', 'Abrir');
    load.addEventListener('click', function () {
      menu = JSON.parse(JSON.stringify(s.menu));
      renderForm(); renderCats(); renderPreview(); queueAutosave();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    var del = el('button', 'btn-icon', '🗑');
    del.title = 'Eliminar';
    del.addEventListener('click', function () {
      if (!confirm('¿Eliminar "' + s.name + '"?')) return;
      setSaved(getSaved().filter(function (x) { return x.id !== s.id; }));
      renderSaved();
    });
    li.appendChild(load); li.appendChild(del);
    ul.appendChild(li);
  });
  if (!list.length) ul.innerHTML = '<li class="muted">Aún no guardas ningún menú.</li>';
}
$('btn-save-menu').addEventListener('click', function () {
  var name = $('f-save-name').value.trim() || (menu.name || 'Mi menú');
  var list = getSaved();
  if (!isPro() && list.length >= 1) {
    alert('El plan gratis guarda 1 menú. Hazte PRO (US$29, pago único) para guardar varios.');
    $('pro-panel').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  menu.pro = isPro();
  list.push({ id: uid(), name: name, savedAt: Date.now(), menu: JSON.parse(JSON.stringify(menu)) });
  setSaved(list);
  $('f-save-name').value = '';
  renderSaved();
  queueAutosave();
});

/* ---------- Vista pública (#m=...) ---------- */
function renderPublic(m) {
  publicLang = m.lang || 'es';
  var box = $('public-menu');
  var h = '';
  if (hasEnglish(m)) {
    h += '<div class="public-topbar"><div class="lang-tabs small">' +
      '<button class="lang-tab' + (publicLang === 'es' ? ' active' : '') + '" data-publang="es">ES</button>' +
      '<button class="lang-tab' + (publicLang === 'en' ? ' active' : '') + '" data-publang="en">EN</button>' +
      '</div></div>';
  }
  h += menuHtml(m, publicLang);
  h += '<p class="public-cta">¿Tienes un restaurante? <a href="#" data-nav="builder">Crea tu menú QR gratis con menufy</a></p>';
  box.innerHTML = h;
  box.querySelectorAll('[data-publang]').forEach(function (b) {
    b.addEventListener('click', function () {
      publicLang = b.getAttribute('data-publang');
      renderPublic(m);
    });
  });
}

function boot() {
  var hash = location.hash || '';
  if (hash.indexOf('#m=') === 0) {
    try {
      var m = decodeMenu(hash.slice(3));
      showView('public');
      renderPublic(m);
      document.title = (m.name || 'Menú') + ' — menufy';
      return;
    } catch (e) {
      showView('public');
      $('public-menu').innerHTML = '';
      $('public-error').hidden = false;
      return;
    }
  }
  loadDraft();
  renderForm();
  renderCats();
  renderPreview();
  renderSaved();
  applyProUI();
  showView('landing');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

} // fin del bloque solo-navegador

/* Export para pruebas en Node */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sha256Hex: sha256Hex,
    proCodeForEmail: proCodeForEmail,
    encodeMenu: encodeMenu,
    decodeMenu: decodeMenu,
    parseBscReceipt: parseBscReceipt,
    buildMenuUrl: buildMenuUrl,
    uid: uid,
    escapeHtml: escapeHtml,
    USDT_BSC_ADDRESS: USDT_BSC_ADDRESS,
    USDT_CONTRACT: USDT_CONTRACT,
    TRANSFER_TOPIC: TRANSFER_TOPIC,
    PRO_PRICE_USDT: PRO_PRICE_USDT,
    BSC_RPCS: BSC_RPCS,
    PAYPAL_EMAIL: PAYPAL_EMAIL,
    CANONICAL_BASE: CANONICAL_BASE
  };
}
