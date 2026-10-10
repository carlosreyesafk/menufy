# Pruebas — menufy (negocio #25)

Fecha: 2026-10-09. Todo pasó ✅ (51/51).

## 1. Sintaxis y servidor (`node --check` + `curl`)
- `node --check app.js` → sin errores (se corrigió 1 paréntesis de más en el SHA-256
  antes de la primera corrida verde).
- `python3 -m http.server` local + `curl -s -o /dev/null -w "%{http_code}"`:
  `index.html` → 200, `styles.css` → 200, `app.js` → 200.

## 2. Funciones puras — `node test.mjs` → 27/27 ✅
- **SHA-256 propio** vs `crypto` de Node: `""`, `"abc"` (vector clásico) y string con
  tildes/ñ/emoji → idénticos.
- **`proCodeForEmail`**: igual a los primeros 16 hex de `SHA-256("CHACHI-PRO-"+email)`;
  normaliza mayúsculas/espacios; rechaza emails inválidos; formato `/^[0-9a-f]{16}$/`.
- **Hash del menú**: roundtrip `encode→decode` conserva tildes, ñ y emojis; el hash es
  base64url (sin `+/=`); `decodeMenu` lanza error con hash corrupto y con JSON sin menú;
  `buildMenuUrl` genera `https://carlosreyesafk.github.io/menufy/#m=...` y se decodifica.
- **`parseBscReceipt`** (9 casos): acepta 29 USDT exactos, suma de varios Transfers y
  montos mayores; rechaza status `0x0`, 28.99 USDT (monto insuficiente), Transfer a otra
  dirección, logs de otro contrato, logs que no son `Transfer`, y no crashea con receipts
  malformados.
- **Constantes de cobro exactas**: `0xb2a38e074808f0c0d4ee9c13f5894c6c601fb172`,
  contrato USDT-BSC `0x55d398326f99059ff775485246999027b3197955`,
  `chachiafk@gmail.com`, 5 RPCs BSC, topic `Transfer` correcto.
- `escapeHtml` neutraliza `<script>`.

## 3. DOM en navegador simulado — `node qa-dom.mjs` (jsdom) → 24/24 ✅
Sin errores JS en ninguna vista. Cubierto:
- Landing: hero, rieles de cobro con valores exactos, firma `© 2026 Chachi`.
- Constructor: navega, renderiza las 4 categorías de ejemplo, preview en vivo
  (editar el nombre actualiza el preview), badge gratis visible, link canónico,
  QR con URL de `api.qrserver.com` + URL del menú codificada, y el link generado
  se decodifica al menú editado.
- Vista pública: hash válido renderiza el menú; **usa la moneda del menú (US$) y no
  la del constructor** (bug real encontrado y corregido); hash inválido muestra error
  elegante con CTA.
- PRO: con `menufy_pro=1` se ven badges/panel de marca y el preview **no muestra el
  sello** (bug real encontrado y corregido: el preview no leía el estado PRO);
  código PayPal correcto activa PRO en el DOM, código malo no; hash BSC con formato
  inválido se rechaza sin tocar la red.

## 4. Chequeos estáticos
- Los 42 `id` usados en `app.js` existen en `index.html` (0 faltantes).
- Sin `lorem`, sin TODO/FIXME, sin estadísticas inventadas, sin reviews falsas.
- Español dominicano natural; firma "Chachi" en el footer.

## Bugs encontrados por el QA y corregidos
1. `renderPreview()` no reflejaba el estado PRO (el sello seguía visible con PRO activo).
2. `money()` usaba la moneda global del constructor en vez de la del menú público.

## Limitaciones conocidas
- **Sin prueba en Chromium real**: el binario headless del entorno no produce salida
  (`--dump-dom`/`--screenshot` devuelven vacío); se sustituyó por jsdom, que no ejecuta
  layout/CSS. El CSS responsive y el `@media print` están escritos pero no validados
  visualmente — conviene una mirada rápida al desplegar en GitHub Pages.
- **QR**: depende de `api.qrserver.com`; si falla la red, la app muestra mensaje elegante
  con botón de reintento (probado el `onerror`, no el fallo real de red).
- **Verificación BSC**: `eth_getTransactionReceipt` solo ve transacciones ya minadas;
  un pago recién enviado tarda ~segundos en aparecer. Los RPCs públicos pueden
  limitar tasa de peticiones; se prueban 5 en cascada.
- **SHA-256 del código PayPal**: implementación pura en JS (no usa `crypto.subtle`,
  que exige contexto seguro); verificada bit a bit contra Node.
- El "1 menú gratis / varios con PRO" se controla por `localStorage` del navegador:
  es honesto para el MVP, pero un usuario avanzado podría bypassearlo (riesgo aceptado
  para el ticket de US$29).
- `qa-dom.mjs` requiere `npm install jsdom` para correrse.
