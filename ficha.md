# Ficha del negocio — menufy (negocio #25)

## Negocio
**menufy**: generador de menús QR para restaurantes. Sitio estático de una sola página
(landing + constructor funcional + menú público por URL hash + generador de QR).
100% cliente: sin backend, sin base de datos, sin API keys. El menú viaja codificado
en el propio link (`#m=<base64url>`), así que no hay nada que hostear por cliente.

## Precio
- **Gratis (US$0):** 1 menú activo guardado, link + QR, ES/EN, imprimir/PDF, con sello
  "Creado con Menufy by Chachi".
- **PRO (US$29, pago único — sin mensualidad):** sin el sello, logo propio (URL),
  colores de la marca, y guardar varios menús.

## Comprador
Dueños de restaurantes, pica-pollos, cafeterías y food trucks en RD y LATAM que hoy
tienen su menú en un PDF feo, una foto por WhatsApp o una cartelera desactualizada.
El que decide es el dueño (compra emocional, ticket bajo, sin comité): ve el QR
funcionando en su celular y entiende el valor en 30 segundos.

## Entregable
Sitio desplegado en GitHub Pages (`https://carlosreyesafk.github.io/menufy/`).
Archivos: `index.html`, `styles.css`, `app.js` (+ `test.mjs`, `qa-dom.mjs` de QA).
El cliente final (restaurante) no instala nada: arma su menú, genera su QR, lo imprime.

## Vía de cobro (rieles visibles en la landing y en el constructor)
1. **PayPal:** US$29 a `chachiafk@gmail.com`. El comprador manda el recibo a ese correo
   y recibe su código PRO manual.
2. **USDT por red BSC (BEP-20):** 29 USDT a `0xb2a38e074808f0c0d4ee9c13f5894c6c601fb172`.
   El comprador pega el hash de la transacción y el sitio lo verifica solo contra RPCs
   públicos de BSC.

### Esquema del código PRO (PayPal) — documentado para emitir códigos a mano
```
código = primeros 16 caracteres hex de SHA-256("CHACHI-PRO-" + email)
donde email = en minúsculas y sin espacios
```
Ejemplo: para `cliente@ejemplo.com`, el código es
`SHA256("CHACHI-PRO-cliente@ejemplo.com")[0:16]`.
El JS lo recalcula con su implementación SHA-256 pura (sin depender de crypto.subtle)
y lo compara con lo que pega el comprador. Coincide → `localStorage.menufy_pro=1`.

### Esquema de verificación USDT/BSC — documentado
El JS hace `eth_getTransactionReceipt` (POST JSON-RPC) probando en orden:
`https://bsc-dataseed.binance.org`, `bsc-dataseed1`, `bsc-dataseed2`, `bsc-dataseed3`,
`https://bsc.publicnode.com`. Acepta el pago solo si TODO se cumple:
1. `receipt.status == "0x1"` (transacción exitosa y minada),
2. existe un log del contrato oficial USDT-BSC `0x55d398326f99059ff775485246999027b3197955`
   con topic0 = `0xddf252ad...b3ef` (evento `Transfer(address,address,uint256)`),
3. el `to` del evento (últimos 20 bytes de `topics[2]`) es nuestra dirección
   `0xb2a38e074808f0c0d4ee9c13f5894c6c601fb172`,
4. la suma de los montos (`data`, 18 decimales, aritmética BigInt) es ≥ 29 USDT.
Éxito → `localStorage.menufy_pro=1` y se desbloquea logo + colores + sin sello.
Implementado en `parseBscReceipt()` (pura, testeada con 9 casos en `test.mjs`).

## Distribución
- **Outreach directo (principal):** restaurantes/pica-pollos de Santo Domingo con menú
  en PDF o solo por WhatsApp → email/DM con su QR de muestra ya generado
  (spec-work: les armo el demo con su nombre, el QR apunta a su menú de verdad).
- **Directorios y grupos:** listados de restaurantes RD, grupos de Facebook/WhatsApp
  de dueños de negocios de comida.
- **SEO de cola larga:** "menú QR para restaurantes", "código QR menú restaurante".
- **El propio producto vende:** cada menú público gratis lleva el sello
  "Creado con Menufy by Chachi" + link para crear el propio.

## Criterio de muerte
**0 ventas con ≥300 visitas en 60 días → se mata (fecha: 2026-12-09).**
Medición: visitas a la página (analytics al desplegar) y ventas = activaciones PRO
(reportadas por el comprador vía PayPal o verificadas en BSC hacia la dirección de cobro).
Si no convierte, se descarta sin más inversión.

## Diferencia vs. negocios existentes (verificación de no-duplicidad)
No duplica ninguno de la lista: no es tienda Gumroad, ni agencia de outreach, ni gigs
de Fiverr/SEOClerks, ni directorio, ni generador de contratos, ni Nostr/zaps,
ni pay-per-lead (dental ni bot), ni Vigía Web, ni ContractKit/PropOne/CVForge/
MetricForge (herramientas en inglés para freelancers US), ni PriceHawk/ListingKit/
ProfitStack/AgentHire/HireWire/TeardownPro, ni transcripción/email-copy/moderación
crypto, ni Superteam Earn, ni Discord Chachi Lab. Es un modelo distinto: **producto
SaaS-micro para restaurantes (menús QR), con cobro PRO de pago único (US$29) vía
PayPal + USDT/BSC** — audiencia, entregable y monetización propios.
