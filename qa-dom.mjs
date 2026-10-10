// QA DOM con jsdom: prueba las rutas de render del navegador sin Chromium.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import assert from 'assert';

const DIR = '/home/hatch/workspace/goals/us-1-000-month-in-extra-income/hidden_files/mision-millonario/negocios-100-oleada4/menufy/';
const htmlRaw = readFileSync(DIR + 'index.html', 'utf8');
const jsRaw = readFileSync(DIR + 'app.js', 'utf8');
const html = htmlRaw.replace('<script src="app.js"></script>', () => '<script>' + jsRaw + '</script>');

let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ✓', name); }

function bootDom(url, seedPro = false) {
  const errors = [];
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.addEventListener('error', (e) => errors.push(e.message || String(e.error)));
      if (seedPro) window.localStorage.setItem('menufy_pro', '1');
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
    }
  });
  const doc = dom.window.document;
  const ready = new Promise((resolve) => {
    if (doc.readyState === 'complete') resolve();
    else dom.window.addEventListener('load', () => resolve());
    setTimeout(resolve, 3000); // seguridad
  });
  return ready.then(() => ({ dom, errors, doc }));
}

console.log('menufy — pruebas DOM (jsdom)\n');

// ---------- 1. Landing ----------
{
  const { doc, errors } = await bootDom('http://localhost/');
  ok('landing visible y builder oculto al cargar', () => {
    assert.strictEqual(doc.getElementById('view-landing').hidden, false);
    assert.strictEqual(doc.getElementById('view-builder').hidden, true);
    assert.strictEqual(doc.getElementById('view-public').hidden, true);
  });
  ok('hero con el titular correcto', () => {
    assert.match(doc.querySelector('.hero h1').textContent, /Convierte tu menú en un QR en 5 minutos/);
  });
  ok('rieles de cobro con valores exactos en landing', () => {
    assert.strictEqual(doc.getElementById('paypal-email').textContent.trim(), 'chachiafk@gmail.com');
    assert.strictEqual(doc.getElementById('usdt-address').textContent.trim(), '0xb2a38e074808f0c0d4ee9c13f5894c6c601fb172');
  });
  ok('footer firma Chachi © 2026', () => {
    assert.match(doc.querySelector('.footer').textContent, /© 2026 Chachi/);
  });
  ok('sin errores JS en landing', () => {
    assert.deepStrictEqual(errors, []);
  });
}

// ---------- 2. Constructor ----------
{
  const { doc, errors, dom } = await bootDom('http://localhost/');
  doc.querySelector('[data-nav="builder"]').click();
  ok('navega al constructor', () => {
    assert.strictEqual(doc.getElementById('view-builder').hidden, false);
    assert.strictEqual(doc.getElementById('view-landing').hidden, true);
  });
  ok('4 categorías de ejemplo renderizadas', () => {
    assert.strictEqual(doc.querySelectorAll('#cats .cat').length, 4);
  });
  ok('vista previa muestra el restaurante de ejemplo', () => {
    const p = doc.getElementById('preview').textContent;
    assert.match(p, /Sazón Criolla/);
    assert.match(p, /La Bandera/);
    assert.match(p, /RD\$ 350/);
  });
  ok('badge "Creado con Menufy by Chachi" visible en plan gratis', () => {
    assert.match(doc.getElementById('preview').textContent, /Creado con Menufy by Chachi/);
  });
  // editar nombre y ver que el preview se actualiza
  const nameInput = doc.getElementById('f-name');
  nameInput.value = 'El Fogóncito';
  nameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  ok('editar el nombre actualiza la vista previa en vivo', () => {
    assert.match(doc.getElementById('preview').textContent, /El Fogóncito/);
  });
  // generar link + QR
  doc.getElementById('btn-generate').click();
  ok('generar muestra link canónico', () => {
    const link = doc.getElementById('f-link').value;
    assert.ok(link.startsWith('https://carlosreyesafk.github.io/menufy/#m='));
    assert.strictEqual(doc.getElementById('output-card').hidden, false);
  });
  ok('QR apunta a api.qrserver.com con la URL codificada', () => {
    const src = doc.getElementById('qr-img').getAttribute('src');
    assert.ok(src.startsWith('https://api.qrserver.com/v1/create-qr-code/'));
    assert.ok(src.includes(encodeURIComponent(doc.getElementById('f-link').value).slice(0, 40)));
  });
  ok('el link generado se decodifica al menú editado', async () => {
    const { createRequire } = await import('module');
    const M = createRequire(import.meta.url)(DIR + 'app.js');
    const m = M.decodeMenu(doc.getElementById('f-link').value.split('#m=')[1]);
    assert.strictEqual(m.name, 'El Fogóncito');
  });
  ok('sin errores JS en el constructor', () => {
    assert.deepStrictEqual(errors, []);
  });
}

// ---------- 3. Vista pública con hash ----------
{
  const { createRequire } = await import('module');
  const M = createRequire(import.meta.url)(DIR + 'app.js');
  const menu = { v: 1, name: 'Sazón Criolla', desc: 'Comida típica', currency: 'RD$', lang: 'es', logo: '', theme: { bg: '#faf6ef', ink: '#1c1917', accent: '#b45309' }, pro: false, cats: [{ id: 'a', es: 'Bebidas', en: 'Drinks', items: [{ id: 'i', es: { name: 'Morir soñando', desc: '' }, en: { name: 'Morir soñando', desc: '' }, price: '150' }] }] };
  const url = 'http://localhost/#m=' + M.encodeMenu(menu);
  const { doc, errors } = await bootDom(url);
  ok('hash válido renderiza la vista pública', () => {
    assert.strictEqual(doc.getElementById('view-public').hidden, false);
    assert.strictEqual(doc.getElementById('view-landing').hidden, true);
    assert.match(doc.getElementById('public-menu').textContent, /Sazón Criolla/);
    assert.match(doc.getElementById('public-menu').textContent, /Morir soñando/);
  });
  ok('sin errores JS en vista pública', () => {
    assert.deepStrictEqual(errors, []);
  });
  const bad = await bootDom('http://localhost/#m=esto-no-es-un-menu');
  const menuUsd = Object.assign({}, menu, { currency: 'US$' });
  const usd = await bootDom('http://localhost/#m=' + M.encodeMenu(menuUsd));
  ok('la vista pública usa la moneda del menú (US$), no la del constructor', () => {
    assert.match(usd.doc.getElementById('public-menu').textContent, /US\$ 150/);
  });
  ok('hash inválido muestra error elegante', () => {
    assert.strictEqual(bad.doc.getElementById('public-error').hidden, false);
  });
}

// ---------- 4. PRO desbloqueado ----------
{
  const { doc, errors, dom } = await bootDom('http://localhost/', true);
  doc.querySelector('[data-nav="builder"]').click();
  ok('con PRO activo se ven los badges y el panel de marca', () => {
    assert.strictEqual(doc.getElementById('pro-badge').hidden, false);
    assert.strictEqual(doc.getElementById('pro-unlocked').hidden, false);
    assert.strictEqual(doc.getElementById('pro-locked').hidden, true);
  });
  doc.getElementById('btn-generate').click();
  ok('con PRO el menú generado no trae el badge', () => {
    assert.doesNotMatch(doc.getElementById('preview').textContent, /Creado con Menufy/);
  });
  ok('sin errores JS con PRO', () => {
    assert.deepStrictEqual(errors, []);
  });
}

// ---------- 5. Código PayPal (integración DOM + función pura) ----------
{
  const { createRequire } = await import('module');
  const M = createRequire(import.meta.url)(DIR + 'app.js');
  const { doc, dom } = await bootDom('http://localhost/');
  doc.querySelector('[data-nav="builder"]').click();
  const email = 'Cliente@Ejemplo.com';
  doc.getElementById('f-pro-email').value = email;
  doc.getElementById('f-pro-code').value = M.proCodeForEmail(email);
  doc.getElementById('btn-verify-code').click();
  ok('código PayPal correcto activa PRO en el DOM', () => {
    assert.strictEqual(dom.window.localStorage.getItem('menufy_pro'), '1');
    assert.match(doc.getElementById('code-status').textContent, /PRO ya está activo/);
    assert.strictEqual(doc.getElementById('pro-unlocked').hidden, false);
  });
  // código malo
  const t2 = await bootDom('http://localhost/');
  t2.doc.querySelector('[data-nav="builder"]').click();
  t2.doc.getElementById('f-pro-email').value = email;
  t2.doc.getElementById('f-pro-code').value = '0000000000000000';
  t2.doc.getElementById('btn-verify-code').click();
  ok('código incorrecto no activa PRO', () => {
    assert.strictEqual(t2.dom.window.localStorage.getItem('menufy_pro'), null);
    assert.match(t2.doc.getElementById('code-status').textContent, /no coincide/);
  });
  // tx hash con formato inválido
  t2.doc.getElementById('f-txhash').value = '0x123';
  t2.doc.getElementById('btn-verify-tx').click();
  ok('hash BSC con formato inválido se rechaza sin llamar a la red', () => {
    assert.match(t2.doc.getElementById('tx-status').textContent, /no parece válido/);
  });
}

console.log(`\n✅ ${n} pruebas DOM pasaron.`);
