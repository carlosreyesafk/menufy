// Pruebas de las funciones puras de app.js (QA obligatorio).
// Uso: node test.mjs
import { createRequire } from 'module';
import { createHash } from 'crypto';
import assert from 'assert';

const require = createRequire(import.meta.url);
const M = require('./app.js');

let n = 0;
function ok(name, fn) {
  fn();
  n++;
  console.log('  ✓', name);
}
console.log('menufy — pruebas de funciones puras\n');

// 1. SHA-256 puro vs implementación de referencia de Node
ok('sha256("") coincide con Node crypto', () => {
  assert.strictEqual(M.sha256Hex(''), createHash('sha256').update('').digest('hex'));
});
ok('sha256("abc") coincide (vector clásico)', () => {
  assert.strictEqual(
    M.sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});
ok('sha256 con bytes UTF-8 coincide', () => {
  const s = 'CHACHI-PRO-Test@Example.com con ñandú 🍽️';
  const ours = M.sha256Hex(unescape(encodeURIComponent(s)));
  const ref = createHash('sha256').update(s, 'utf8').digest('hex');
  assert.strictEqual(ours, ref);
});

// 2. Código PRO de PayPal
ok('proCodeForEmail = 16 hex de SHA-256("CHACHI-PRO-"+email)', () => {
  const ref = createHash('sha256').update('CHACHI-PRO-test@example.com', 'utf8').digest('hex').slice(0, 16);
  assert.strictEqual(M.proCodeForEmail('test@example.com'), ref);
});
ok('proCodeForEmail normaliza mayúsculas y espacios', () => {
  assert.strictEqual(M.proCodeForEmail('  TEST@Example.COM '), M.proCodeForEmail('test@example.com'));
});
ok('proCodeForEmail rechaza email inválido', () => {
  assert.strictEqual(M.proCodeForEmail('no-es-email'), '');
  assert.strictEqual(M.proCodeForEmail(''), '');
});
ok('código tiene 16 caracteres hexadecimales', () => {
  assert.match(M.proCodeForEmail('chachiafk@gmail.com'), /^[0-9a-f]{16}$/);
});

// 3. Encode/decode del menú en el hash
const menuSample = {
  v: 1, name: 'Sazón Criolla', desc: 'Comida típica con ñandú y sazón 🍲',
  currency: 'RD$', lang: 'es', logo: '', theme: { bg: '#faf6ef', ink: '#1c1917', accent: '#b45309' },
  pro: false,
  cats: [{ id: 'a1', es: 'Platos Fuertes', en: 'Main Dishes',
    items: [{ id: 'i1', es: { name: 'La Bandera', desc: 'Arroz, habichuelas y carne' },
      en: { name: 'La Bandera', desc: 'Rice, beans & meat' }, price: '350' }] }]
};
ok('encode/decode roundtrip conserva tildes, ñ y emojis', () => {
  const m2 = M.decodeMenu(M.encodeMenu(menuSample));
  assert.deepStrictEqual(m2, menuSample);
});
ok('el hash es base64url (sin + / ni =)', () => {
  assert.match(M.encodeMenu(menuSample), /^[A-Za-z0-9\-_]+$/);
});
ok('decodeMenu lanza error con hash corrupto', () => {
  assert.throws(() => M.decodeMenu('!!!no-es-base64!!!'), /./);
});
ok('decodeMenu lanza error si el JSON no trae menú', () => {
  const fake = Buffer.from(JSON.stringify({ hola: 1 })).toString('base64url');
  assert.throws(() => M.decodeMenu(fake), /inválido/);
});
ok('buildMenuUrl usa el formato canónico #m=', () => {
  const url = M.buildMenuUrl(menuSample);
  assert.ok(url.startsWith('https://carlosreyesafk.github.io/menufy/#m='));
  assert.deepStrictEqual(M.decodeMenu(url.split('#m=')[1]), menuSample);
});

// 4. Parseo del receipt BSC
const OUR = M.USDT_BSC_ADDRESS.toLowerCase();
const USDT = M.USDT_CONTRACT.toLowerCase();
const padAddr = (a) => '0x' + '0'.repeat(24) + a.replace('0x', '').toLowerCase();
const wei = (n) => (BigInt(n) * 10n ** 18n).toString(16).padStart(64, '0');
function receiptWith(logs, status = '0x1') { return { status, logs }; }
function transferLog(to, amountWeiHex, contract = USDT) {
  return {
    address: contract,
    topics: [M.TRANSFER_TOPIC, padAddr('0x1111111111111111111111111111111111111111'), padAddr(to)],
    data: '0x' + amountWeiHex
  };
}
ok('TRANSFER_TOPIC es el keccak de Transfer(address,address,uint256)', () => {
  assert.strictEqual(M.TRANSFER_TOPIC, '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
});
ok('acepta pago exacto de 29 USDT', () => {
  const r = parse_result(receiptWith([transferLog(OUR, wei(29))]));
  assert.strictEqual(r.ok, true);
});
ok('acepta suma de varios Transfer que llegan a 29', () => {
  const r = parse_result(receiptWith([transferLog(OUR, wei(20)), transferLog(OUR, wei(9))]));
  assert.strictEqual(r.ok, true);
});
ok('acepta pago mayor a 29 USDT', () => {
  assert.strictEqual(parse_result(receiptWith([transferLog(OUR, wei(100))])).ok, true);
});
ok('rechaza transacción con status 0x0', () => {
  const r = parse_result(receiptWith([transferLog(OUR, wei(29))], '0x0'));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'tx-fallida');
});
ok('rechaza monto insuficiente (28.99 USDT)', () => {
  const hex = (BigInt('2899') * 10n ** 16n).toString(16).padStart(64, '0'); // 28.99 * 1e18
  const r = parse_result(receiptWith([transferLog(OUR, hex)]));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'monto-insuficiente');
});
ok('ignora Transfer hacia otra dirección', () => {
  const r = parse_result(receiptWith([transferLog('0xdead000000000000000000000000000000000001', wei(50))]));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'sin-pago');
});
ok('ignora logs de otro contrato (USDT falso)', () => {
  const r = parse_result(receiptWith([transferLog(OUR, wei(29), '0xFake00000000000000000000000000000000000001')]));
  assert.strictEqual(r.ok, false);
});
ok('ignora logs que no son evento Transfer', () => {
  const log = transferLog(OUR, wei(29));
  log.topics = ['0x' + 'ab'.repeat(32), log.topics[1], log.topics[2]];
  assert.strictEqual(parse_result(receiptWith([log])).ok, false);
});
ok('no crashea con receipt malformado', () => {
  assert.strictEqual(parse_result(null).ok, false);
  assert.strictEqual(parse_result({}).ok, false);
  assert.strictEqual(parse_result({ status: '0x1', logs: [{ address: USDT, topics: [], data: '0xZZZ' }] }).ok, false);
});
function parse_result(r) { return M.parseBscReceipt(r); }

// 5. escapeHtml
ok('escapeHtml neutraliza HTML', () => {
  assert.strictEqual(M.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

// 6. Constantes de cobro exactas
ok('dirección USDT BSC exacta', () => {
  assert.strictEqual(M.USDT_BSC_ADDRESS, '0xb2a38e074808f0c0d4ee9c13f5894c6c601fb172');
});
ok('contrato USDT-BSC oficial', () => {
  assert.strictEqual(M.USDT_CONTRACT, '0x55d398326f99059ff775485246999027b3197955');
});
ok('email PayPal exacto', () => {
  assert.strictEqual(M.PAYPAL_EMAIL, 'chachiafk@gmail.com');
});
ok('5 RPCs de BSC configurados', () => {
  assert.strictEqual(M.BSC_RPCS.length, 5);
});

console.log(`\n✅ ${n} pruebas pasaron.`);
