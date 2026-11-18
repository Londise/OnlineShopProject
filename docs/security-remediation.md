# Seguridad y confirmación comercial

Rama: `security/commercial-confirmation-and-auth-hardening`.
No se aplicaron migraciones ni despliegues a la tienda de producción.

## Implementado

- `NOVO` se muestra como **EM ESPERA**. Crear, editar, cancelar o reabrir
  un pedido en espera no reserva ni descuenta stock.
- Solo `ADMIN` puede pasar de espera a confirmado. La confirmación verifica
  variantes activas y disponibilidad dentro de una transacción serializable.
  Dos pedidos pueden estar en espera por las mismas piezas; eso no garantiza
  disponibilidad. Solo la confirmación comercial compromete inventario.
- Editar cantidades de un pedido confirmado ajusta las diferencias de stock;
  cancelarlo restaura únicamente lo descontado. Los pedidos concluidos siguen
  sin admitir cambios de artículos.
- El editor permite añadir variantes, quitar artículos con cantidad cero y
  guardar observaciones del acuerdo por WhatsApp.
- `POST /api/v1/orders` requiere `Idempotency-Key` UUID. La clave se guarda
  hasheada y separada por usuario/invitado. Mismo contenido y clave reproducen
  la respuesta original; contenido diferente devuelve `409`.
  La respuesta guardada es inmutable: no expone notas o ediciones posteriores.
- El checkout conserva la clave ante una respuesta incierta, incluso al
  recargar la pestaña. En sessionStorage solo persiste UUID y digest, no datos
  de contacto. Una compra nueva reconocida obtiene otra clave.
- Login y registro tienen presupuestos IP separados. Consultar sesión o
  cerrar sesión no consume esos presupuestos ni queda bloqueado por ellos.
- El login agrega un presupuesto atómico persistente por cuenta normalizada,
  independiente de IP/proceso: 10 intentos por ventana de 15 minutos, con
  demora progresiva a partir del sexto. Un login correcto limpia su contador.
  Se purgan por lotes acotados contadores ajenos de más de un día.
- El registro pide nombre, correo y contraseña; guarda inmediatamente una cuenta
  `CUSTOMER` activa pero **sin verificar**, con Argon2id. Un registro repetido no
  sustituye nombre, contraseña ni rol de una cuenta existente.
- La respuesta pública sigue siendo `202` con el mismo mensaje, sin inicio de
  sesión automático ni revelación de si el correo ya existía. Siempre establece
  una cookie opaca de prueba de navegador (HttpOnly/SameSite Lax/Secure en HTTPS),
  distinta de la cookie de sesión; solo el creador legítimo recibe una prueba válida.
- Las cuentas no verificadas pueden iniciar sesión y preparar el carrito. La
  API impide enviar pedidos desde esas cuentas y leer su historial hasta que
  verifiquen. La interfaz replica el límite sin perder el carrito; los invitados
  conservan el flujo de pedidos existente. ADMIN/STAFF administrados no cambian.
- Un aviso compacto aparece únicamente para un CUSTOMER conectado sin verificar.
  Incluye reenvío autenticado, con un presupuesto persistente de un envío por
  minuto por cuenta, además del límite IP independiente. Cambiar de proceso/IP
  o recargar la pantalla no reinicia el presupuesto.
- El enlace dura 30 minutos y confirma solamente el correo, sin pedir nombre o
  contraseña nuevos, sin crear una sesión y sin cambiar las credenciales.
  La pantalla de éxito permanece visible. El token viaja en el fragmento y se
  retira del URL al abrir la página.
- Para evitar apropiación por pre-registro, la confirmación exige la prueba
  HttpOnly del navegador del registro o una sesión autenticada de esa misma
  cuenta. En otro navegador se pide entrar con la contraseña ya elegida, no
  restablecerla. Un correo inesperado, sin esa prueba, no confirma contraseñas
  elegidas por otra persona.
- Las solicitudes repetidas conservan el enlace vigente y usan idempotencia
  también en Resend. La base guarda un hash del token; el secreto independiente
  para reconstruirlo permanece únicamente en el servidor.
- Verificar conserva ID, nombre, contraseña y propiedad de pedidos, y revoca
  las sesiones previas salvo la sesión autenticada que confirma. No permite
  sobrescribir cuentas verificadas, reactivar deshabilitados ni modificar ADMIN/STAFF.
- El formato nuevo vincula token y prueba a la identidad, credenciales y nonce,
  usando HMAC con propósitos separados. Los enlaces del flujo anterior ya no
  son válidos y se recuperan desde el reenvío de la cuenta.

## Migración y compatibilidad

`20261115100000_commercial_confirmation_security` crea tablas privadas con RLS.
Además, libera y audita reservas de pedidos `NOVO` anteriores, sin borrar
pedidos, snapshots ni movimientos históricos.

**No ejecutar con una versión antigua de la API atendiendo tráfico.**
La semántica de `NOVO` cambia: detener escritores antiguos antes de migrar,
verificar la reconciliación y arrancar la API nueva antes de reabrir el tráfico.
Si las reservas no coinciden con los pedidos pendientes, la migración aborta
completa y exige revisión manual; no intenta corregir diferencias a ciegas.

Actualizar también cualquier cliente externo: sin UUID de idempotencia el
endpoint de creación devuelve `422 IDEMPOTENCY_KEY_REQUIRED`.

No aplicar esta migración a producción sin aprobación y respaldo previo.

`20261115110000_email_verification` no marca falsamente correos antiguos como
verificados y revoca sus sesiones anteriores una vez, al aplicarse.
La revisión del flujo permite entrar con la contraseña existente, pero exige
confirmación antes de consultar pedidos o enviarlos desde la cuenta. No obliga
a cambiarla y conserva los IDs/pedidos. ADMIN y STAFF no sufren ese corte.
La revisión no cambia el esquema ni modifica migraciones ya aplicadas.

## Verificación local anterior (antes de la revisión del registro)

- Unidades frontend: 67 aprobadas.
- Unidades backend, HTTP y recursos: 70 aprobadas.
- Integración completa con PostgreSQL desechable: 160 aprobadas.
- Interfaz: 107 aprobadas.
- Navegador completo, incluidos registro/verificación y edición comercial:
  20 aprobadas.
- Build aislado: aprobado; canarios de secretos ausentes del bundle.

Se observaron plazos de arranque intermitentes al competir con builds/imports
fríos en Windows. No se elevaron timeouts ni se añadieron retries para ocultar
fallos. La última ejecución E2E completa y la última de unidades backend
finalizaron correctamente. Se corrigió una dependencia de prueba: reiniciar
la API E2E debe conservar el capturador local de correo en vez de intentar
usar el proveedor real sin configurar.

## Regresiones de la revisión del registro

- Unidades frontend: 67 aprobadas.
- Unidades backend/HTTP: 70 aprobadas.
- Integración completa con PostgreSQL desechable: 163 aprobadas.
- Interfaz: 117 aprobadas (incluye header condicional, reenvío y confirmación).
- Navegador completo: 23 aprobadas. Incluye prueba HttpOnly sin login, confirmación
  desde otro navegador con la contraseña original, y recuperación de un enlace
  caducado con reenvío en la misma pestaña.
- Build aislado aprobado; sin canarios de secretos en los assets del navegador.
- No se añadieron dependencias ni cambios de esquema. Las pruebas aíslan sus
  instalaciones/Prisma en un worktree; no usan la base de producción.
- La primera ronda detectó dos navegaciones de prueba antes de completar login,
  corregidas esperando el estado autenticado. También se observó un arranque
  frío con imports locales de Vite pendientes. La segunda detectó un fallo real
  de la pantalla: un enlace reenviado por hash reutilizaba el token anterior.
  Se corrigió la captura de enlaces nuevos y se añadió regresión de interfaz.
  La última ronda completa pasó sin elevar timeouts ni añadir retries.

La instalación también detectó cinco avisos `high` de `npm audit` en dependencias
de desarrollo existentes (`picomatch`, `fdir`, `tinyglobby`, `vite`, `vitest`).
El backend no reportó avisos. Se deja constancia sin ejecutar `audit fix --force`
ni aceptar las rebajas/cambios de versión sugeridos automáticamente, fuera del
alcance de esta revisión del registro.

## Verificación remota anterior de staging (17/11/2026, hora local)

- Código desplegado: `555fb931ddf87f66a134aa437a4595ea893ba023`.
  La rama se publicó en GitHub sin modificar `main`.
- Frontend: https://ferchumodas-security-staging.vercel.app
  (`dpl_Cr2K2ur2pXW1t1Cq6zifpbCiroTq`, estado `READY`, Node 22.x).
  Vercel denomina `production` al primer despliegue de cada proyecto: aquí
  corresponde exclusivamente al proyecto independiente de staging, no a
  `ferchumodas.shop`.
- Backend: https://ferchumodas-security-staging-api.onrender.com
  (`srv-dbueog67bikc739o5pqg`, despliegue `dep-dbueogm7bikc739o5qf0`).
  Plan gratuito, Virginia, Node 22.23.4, auto-deploy desactivado y health check
  `/health`. Sin migraciones ni seed en el arranque.
- Cinco grupos de smoke HTTP aprobaron salud/base, autenticación del proxy,
  rechazo CSRF, permisos de administración, atributos de cookie, idempotencia
  persistente, edición sin reserva, confirmación única, cancelación/restitución,
  archivo y revocación de sesión.
- Cuatro grupos de navegador aprobaron checkout real a través de Vercel/Render,
  edición y confirmación desde la interfaz de administración, restitución y
  archivo, sesión/cookies y bloqueo de administración después del logout.
  Sin excepciones JavaScript ni respuestas API fallidas durante ese recorrido.
  Los dos pedidos sintéticos de estas pruebas quedaron cancelados y archivados;
  el producto de prueba terminó con 60 unidades físicas y cero reservadas.
- El smoke de navegador remoto espera `domcontentloaded` y luego controles
  semánticos; esperar el evento global `load` había agotado el plazo antes de
  iniciar el recorrido. No se elevaron timeouts ni se modificó la aplicación.
- Vercel no informó errores runtime en la ventana consultada de una hora.
- El registro solicitado a través del frontend respondió `202` sin cookie
  de sesión. El usuario autorizó un único envío a `ferchumodas461@gmail.com`.
  Resend informó `delivered` para `01a1ec02-d884-767d-95b9-ef182317d82e`,
  creado el `2026-11-18T00:16:12Z`, con remitente
  `noreply@send.ferchumodas.shop` y Reply-To `ferchumodas461@gmail.com`.
  Esto prueba entrega al servidor destinatario, no lectura ni ubicación en inbox.
- El acceso temporal de automatización creado por `vercel curl` se revocó
  después de las pruebas. Se verificaron cero bypasses y protección SSO `all`;
  el token revocado vuelve a recibir redirección al acceso de Vercel.
- Se eliminó el archivo temporal de conexiones owner del bootstrap. Las
  credenciales runtime permanecen privadas, fuera del repositorio y del bundle.

## Pendiente, no presentado como resuelto

- El usuario confirmó recepción del correo anterior y que el enlace había
  caducado. La pantalla y flujo anteriores se sustituyen por el registro
  convencional y confirmación sin contraseña nueva descritos arriba.
- Ejecutar las regresiones y validar remotamente esta revisión antes de dar por
  actualizado el staging. No confundir pruebas del despliegue anterior con las
  del nuevo comportamiento.
- Staging no tiene bucket de imágenes, proveedor de cotización ni destino
  WhatsApp propios configurados. Esos flujos no se presentan como validados
  remotamente; no se copiaron secretos de producción.
- Revisión final y autorización independiente para cualquier cambio en producción.

## Recursos aislados preparados

- Proyecto Vercel: `ferchumodas-security-staging`,
  `prj_5KQHSlEp8RpaQ8IWaNd5FBtTOuGD`, sin conectar el Git de producción y
  con protección Vercel para todos los despliegues.
- PostgreSQL Render: `ferchumodas-security-staging`,
  `dpg-dbt5jju7bikc73d43f70-a`, plan `free`, separado de Supabase de producción.
  Migraciones aplicadas, usuario runtime restringido y datos sintéticos mínimos
  (un administrador y un producto de prueba). Caducidad informada por API:
  `2026-12-16T01:18:07Z`.
- La única regla IP temporal `/32` del bootstrap se retiró al terminar.
  La base vuelve a tener lista externa vacía: solo acceso por red privada.
- Resend está provisionado en plan gratuito para `send.ferchumodas.shop`.
  El proveedor confirmó los tres registros DNS como `verified`.
  La clave destinada al backend está restringida a envío en ese dominio.

No se copiaron catálogos, pedidos ni credenciales de producción. Los pedidos
de prueba son sintéticos; únicamente se usó el correo real autorizado para
comprobar entrega. Frontend y backend de staging ya están desplegados.
