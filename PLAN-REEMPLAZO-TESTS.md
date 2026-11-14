# Plan de reemplazo integral de tests — Ferchu Modas

Fecha original: 11/11/2026. Revisión: 13/11/2026. Estado: brechas de la auditoría corregidas y verificadas localmente; 342 pruebas + build, sensibilidad 3/3. El cierre corresponde al alcance local auditado y sus equivalencias, con las excepciones de método y límites descritos en sección 9; no certifica cobertura exhaustiva ni producción. Ver `REGISTRO-REEMPLAZO-TESTS.md` para evidencia vigente y resultados históricos.

## 1. Objetivo y conclusión

Retirar los **30 archivos de tests actuales** (12 raíz y 18 backend) y sustituir su cobertura útil por pruebas de comportamiento. Eliminar pruebas de texto fuente, detalles privados, decisiones visuales y dependencias ajenas. El reemplazo se hace por bloques: cada archivo antiguo sale cuando sus riesgos útiles están cubiertos o su descarte está justificado.

**El problema no es solamente la cantidad:** hay comprobaciones de escaso valor y, al mismo tiempo, faltan interacciones esenciales del checkout, sesiones, gestión y uploads. No prometo que cubrir esos huecos reduzca el número total de casos. Sí debe reducir duplicación, fixtures ficticios, fragilidad y mantenimiento. Una tabla con 12 filas no significa que hayamos reducido 12 comportamientos a uno.

La lista de la sección 6 es el inventario completo de comportamientos que propongo automatizar para la aplicación actual. No implica un test por función, componente, campo o línea de código.

## 2. Lectura realizada y base observada

Se leyeron completos:

- `src/`: las cuatro páginas, todos los componentes, hooks, contextos, rutas, servicios, utilidades, configuración de medios, entradas y las 3323 líneas de CSS.
- `server/src/`: composición HTTP, proceso, configuración, todos los routers, middlewares, schemas, controladores, servicios, utilidades y acceso a datos.
- Los 30 archivos actuales de tests y `server/test-support/security-http-worker.js`.
- `server/prisma/schema.prisma`, las cinco migraciones activas, el historial MySQL, seed y manifiesto de imágenes.
- Los dos scripts operativos de `server/scripts/`, ambos `package.json`, ejemplos de entorno, configuración de proxy/despliegue, `index.html`, instrucciones del repositorio, manual HTML e informe `CAMBIOS-REVISION.md`.

El alcance es el código propio y sus contratos. `node_modules`, `dist`, `.git` y configuración de agentes no son código fuente de la aplicación a reescribir; no se inspeccionaron secretos locales. Los lockfiles son artefactos de resolución, no una segunda implementación que deba tener tests línea por línea.

### Ejecución de referencia de esta revisión

| Comando | Resultado observado |
| --- | --- |
| `npm test` en raíz | 40 aprobados, 0 fallos; aproximadamente 23,7 s |
| `npm test` en `server/` | 110 aprobados, 1 fallo; aproximadamente 64,3 s |
| `node --version` | v22.11.0; backend declara >=22.23.4 <23 |

Fallo: `server/test/http-security.test.js`, test `security regressions run in a disposable HTTP process with no real persistence`: `worker did not send ready`. Sus subtests no llegaron a ejecutarse. No está demostrado si se debe a versión, carga, arranque u otra causa. Hubo también avisos `ExperimentalWarning` de módulos JSON y salida de logs de pruebas de pedidos. No es una suite backend verde ni una ejecución de salida limpia.

Estas pruebas utilizan dobles y PostgreSQL en memoria; no certifican producción, bloqueos concurrentes reales ni la integración desplegada. No se ejecutó build ni navegador para elaborar este plan.

## 3. Aplicación honesta de la skill TDD

Se leyó la skill `test-driven-development` y su referencia completa `writing-good-tests.md` desde el directorio temporal de supporting files.

### Para cada cambio de comportamiento o corrección

1. Escribir qué error real detectará el caso y cuál será su resultado observable.
2. Escribir un test pequeño que reproduzca ese error con el código real.
3. Ejecutarlo y comprobar **RED por la razón esperada**, no por imports, falta de base o fixtures rotos.
4. Implementar lo mínimo para obtener GREEN.
5. Refactorizar manteniendo GREEN; ejecutar la suite completa de ambos paquetes al cerrar cada bloque integrado.
6. Registrar test, causa del fallo inicial, cambio mínimo y comandos/resultados finales.

No calcular el esperado con los mismos helpers que se están probando. Usar importes y estados calculados a mano. No afirmar rollback o concurrencia de PostgreSQL con un objeto JavaScript que imita transacciones.

### Particularidad: estamos reemplazando tests de código que ya existe

Un test nuevo de comportamiento correcto existente puede pasar de inmediato: eso es **caracterización**, no TDD retroactivo. No se borrará implementación correcta para inventar un RED.

Para ejecutar este plan se debe acordar una excepción acotada a la regla estricta de la skill: permitir caracterización del legado, verificando su sensibilidad con una mutación temporal controlada en una copia de trabajo y restaurándola. Ese experimento prueba la capacidad de detectar una regresión; **no se presentará como haber desarrollado el código original con TDD**. El código nuevo, los defectos y las modificaciones de comportamiento sí siguen RED → GREEN → REFACTOR. Esta distinción debe quedar en el registro de ejecución.

### Filtro para admitir una prueba

- ¿Qué rama, dato, efecto o autorización incorrecta la haría fallar?
- ¿Ese cambio sería un bug o solamente una decisión de diseño?
- ¿Observa UI, HTTP, estado persistido o salida real de nuestro código?
- ¿Otra prueba del mismo nivel ya detecta exactamente ese fallo?
- ¿Puede ejecutarse de forma aislada, con entradas y tiempos controlados?

Si solo detecta un cambio de redacción, selector CSS, estructura privada o versión de paquete, se descarta. Si el mock contiene la lógica que se quiere verificar, se reemplaza por integración.

## 4. Destino de TODOS los archivos actuales

“Reemplazar” significa eliminar el archivo actual cuando estén verificados los casos de destino; los nombres nuevos se organizan por responsabilidad. No se conservará una copia ejecutable de la suite anterior.

### Raíz — 12 archivos

| Archivo actual en `test/` | Acción y destino |
| --- | --- |
| `cart.test.js` | Reemplazar por C: conservar corrupción, cantidades, stock, precios y limpieza parcial; separar comportamientos mezclados y deduplicar datos inválidos. |
| `checkout-header.test.js` | Eliminar regex JSX/CSS; E2 verifica que volver/editar sea operable en móvil y escritorio. |
| `documentation.test.js` | Eliminar sin sustituto unitario. La prosa y la obligación de tener exactamente un HTML no son contratos comerciales. Enlaces se revisan al editar documentación. |
| `http.test.js` | Reemplazar por H; conservar pruebas del adaptador real, ampliar cancelación y matriz de métodos, separar casos mezclados. |
| `management.test.js` | Integrar validación de cantidades en G1/G2; evitar mantener toda la matriz del parser y repetirla íntegra en UI. |
| `media.test.js` | Reemplazar por I1/I2 más fallback real I3; sacar dependencia de un hostname real del proyecto. |
| `mobile-layout.test.js` | Eliminar medidas y fuentes exactas por regex. E2 cubre controles visibles, acceso y overflow. |
| `proxy-middleware.test.js` | Reemplazar por P1/P2, conservando sobrescritura upstream y rechazo cerrado; no confundir headers sintéticos con verificación real de plataforma. |
| `render-blueprint.test.js` | Eliminar fijación del plan Free y versión exacta. Validar receta/configuración en el proceso de entrega, no con snapshots textuales. |
| `storefront-loading.test.js` | Reemplazar por V2–V5 e I3: temporizadores, desbloqueo, error y retry reales. Eliminar animaciones, color vino y mensajes exactos. |
| `vercel-config.test.js` | Reemplazar por P3: ejecutar la función y verificar contrato de routing/secretos; no la forma interna completa del objeto. |
| `whatsapp.test.js` | Reemplazar por W: datos y codificación; eliminar igualdad de todo el texto decorativo. |

### Backend — 18 archivos

| Archivo actual en `server/test/` | Acción y destino |
| --- | --- |
| `admin-audit.test.js` | Reemplazar por A con base real; eliminar adapter que implementa su propio commit/rollback. |
| `catalog.test.js` | Reemplazar por K y A; insertar relaciones activas/inactivas y observar respuestas, no igualar objetos `where/include`. |
| `database-config.test.js` | Integrar en P4: arranque válido/inválido y diagnóstico sin credenciales; reducir casos equivalentes. |
| `express-errors.test.js` | Integrar en H8/L6: contrato JSON y traza de nuestra API, no “Express sabe rechazar promises”. |
| `http-deployment.test.js` | Distribuir entre S, P y H8; fixtures de sesión reales y setup común. |
| `http-security.test.js` | Reemplazar por H9/U5/A2. Conservar límites y aborto utilizados por la app. Eliminar reproducción de `fileFilter` asíncrono inexistente en producción. |
| `images.test.js` | Reemplazar por U1 con imágenes reales pequeñas; ampliar formatos, animación y decodificación completa. |
| `logger-lifecycle.test.js` | Fusionar con `logger.test.js` en L; factory por test, reloj/control de promesas, sin singleton compartido. |
| `logger.test.js` | Fusionar en L; quitar inspección de `__testing.buffer` y repetición de redacción/flush. |
| `logs-sql.test.js` | Integrar en D/L; conservar permisos, escritura y mantenimiento, eliminar número exacto de particiones e índice BRIN como fin en sí mismo. |
| `order-minimum.test.js` | Integrar en O1/O6; eliminar “acepta 15” cuyo mock retorna `accepted` sin ejecutar creación. |
| `order-safety.test.js` | Reemplazar por O; conservar invariantes, desbordes y archivo, ahora con persistencia real. Concurrencia en PostgreSQL multi-conexión. |
| `postgresql.test.js` | Integrar en D/O/U; quitar conteos exactos de tablas/enums, igualdad de literales de timestamps de PostgreSQL y lectura trivial de datos recién insertados. |
| `prisma-config.test.js` | Eliminar tests del merger de terceros y versión exacta del lock. Usar validate/generate/deploy sobre el schema real en verificación. |
| `shutdown.test.js` | Reemplazar por L7; conservar drenaje, orden e idempotencia y deadline. |
| `transaction.test.js` | Reemplazar por O11; tabla breve de códigos recuperables/no recuperables y límite, más concurrencia real O10. |
| `upload-capacity.test.js` | Integrar en U5: ejercer recepción/procesamiento real y bloqueo de siguiente upload, no solo contador. |
| `validation-security.test.js` | Integrar límites en O2/A2/H8/L8. Eliminar getter artificial y aserciones del algoritmo interno de Zod. |

`server/test-support/security-http-worker.js` se elimina o reemplaza al migrar sus pruebas útiles. Las utilidades nuevas viven en soporte de tests, no en módulos de producción.

## 5. Organización y entorno de la nueva suite

### Niveles

- **Unitario:** reglas puras con muchas fronteras (carrito, transporte, envío, transformaciones de imágenes, reintento transaccional y cola de logging).
- **UI integrada:** componentes, providers y router reales; interceptar solamente la frontera HTTP. Interactuar por roles/labels y comprobar resultados visibles. No mockear `useCart`, `useAuth` ni toda la página que se pretende comprobar.
- **API + base:** Express y Prisma reales con datos mínimos en PostgreSQL descartable. HTTP para contratos, servicios públicos para combinaciones de dominio que no necesitan repetir la capa HTTP.
- **E2E:** unos pocos recorridos navegador → API → base; no repetir todas las matrices unitarias en el navegador.

### Herramientas propuestas, no instaladas en esta revisión

- Mantener `node:test` para backend y unidades JavaScript existentes.
- Incorporar un runner compatible con el Vite/React instalado y Testing Library + entorno DOM para interacciones. Resolver versiones compatibles al implementarlo; no actualizar React/Vite para acomodar tests.
- Un runner de navegador para los recorridos E2E y geometría real. La elección/instalación se realiza al ejecutar el plan.
- Conservar PGlite solo si aporta una suite SQL rápida diferenciada; no duplicar en PGlite y PostgreSQL todas las verificaciones. La suite de Prisma/concurrencia necesita un servidor PostgreSQL real multi-conexión, local o de CI, descartable.
- Fixtures de Storage en la frontera de red: bytes reales de imágenes y respuestas controladas, sin subir basura al bucket productivo.

### Requisitos del harness

1. Lanzar procesos con entorno de test explícito, sin heredar `.env` de desarrollo; establecer URLs descartables antes de importar `env.js`/Prisma. No basar el aislamiento únicamente en “el cliente es lazy”.
2. Migrar con usuario de instalación y ejecutar negocio con un LOGIN miembro de `ferchu_backend`. Aislar por base/worker; fixtures mínimas, no seed comercial para cada caso.
3. Aplicar las cinco migraciones como se despliegan. Historial MySQL queda como registro, no se ejecuta.
4. Si falta la base de integración requerida, fallar con diagnóstico de setup, no omitir silenciosamente la suite para obtener verde.
5. Para provocar fallo de auditoría usar un mecanismo de fallo restringido a la base de test; mantener transacción y persistencia reales. No reimplementar transacciones en el fixture.
6. Relojes controlados para loading/polling/expiración/flush; promesas controladas y barreras para carreras. Evitar sleeps de 25/50/100 ms como evidencia de sincronización.
7. Inicializar/cerrar servidor, conexiones, logger y browser por fixture. Limitar paralelismo de suites pesadas según medición, no alargar todos los timeouts.
8. Retirar `__testing`, `clear`, `setSink`, `setDeadSink` del logger si quedan sin consumidor productivo; usar la factory y dependencias legítimas. Hacer esa refactorización después de proteger su comportamiento.

## 6. Catálogo completo de pruebas propuestas

Cada ID identifica una responsabilidad verificable. Las variantes enumeradas pueden ser filas parametrizadas con nombre propio; no deben esconderse en un único test gigante. **P0** protege pedidos, inventario, acceso y datos; **P1** completa la experiencia y operación. Todos los casos de esta sección forman parte del plan; P1 no significa “opcional”.

### C — Carrito y selección (P0)

Código: `utils/cart.js`, `domainFunctions.js`, `hooks/useCart.js`, `CartContext`, `BuilderModalButton`, `Counter`, `Cart`.

| ID / nivel | Casos y resultado esperado | Regresión que detecta |
| --- | --- | --- |
| C1 / unidad | Contenedor persistido inválido, líneas corruptas y duplicadas: conservar las válidas una vez; cantidades positivas enteras seguras, importes/pesos finitos no negativos. | Un carrito corrupto rompe la tienda o genera NaN. |
| C2 / unidad | Agregar combina solo la misma variante; separa colores/talles; limita por stock ya descontado del carrito, ignora variantes inexistentes y cantidades inválidas; no muta entrada. | Sobreventa visual, mezcla de variantes o suma de strings. |
| C3 / unidad | Precio de variante distinto y cero prevalecen; null/ausente usa base; re-agregar actualiza precio/disponibilidad. | Cobrar/mostrar precio base incorrecto. |
| C4 / unidad | Editar a cero elimina; entrada inválida conserva línea; exceso se limita; edición de una línea conserva las otras. | Vaciar accidentalmente una línea o superar stock. |
| C5 / unidad | Confirmación descuenta cantidades enviadas: conserva incrementos posteriores y otras variantes; si se redujo/eliminó una línea no genera cantidades negativas ni la recrea. | Borrar compras agregadas mientras llega la respuesta. |
| C6 / UI | Recargar restaura carrito y totales de piezas/importe/peso; JSON roto o Storage que lanza no impide usar la tienda; fallo de escritura no impide agregar. | Persistencia inutiliza la aplicación. |
| C7 / UI | Reconciliar imágenes cambia solo presentación; fallo/variante retirada conserva cantidades; otra pantalla que se desmonta no cancela la carga compartida. | Pérdida de carrito por disponibilidad de catálogo. |
| C8 / UI | Builder ofrece talles recibidos (incluido uno fuera de P/M/G/GG), respeta disponibilidad restante; cambiar color reinicia selección; sin opciones/stock no agrega. | Talles ocultos o adición de variante equivocada. |
| C9 / UI | Botones e ingreso directo del Counter respetan mínimo/máximo; agregar actualiza carrito y selección; cerrar modal por botón/Escape no elimina carrito. | Handler diferente según modo de ingreso. |
| C10 / UI | Con 14 piezas no se continúa; con 15 sí; quitar una pieza actualiza estado del botón y totales. | Mínimo solo decorativo o desincronizado. |

No agregar tests independientes para wrappers de contexto, sumas triviales y `getVariant` si C2/C6/C8 ya detectan sus errores.

### V — Catálogo y disponibilidad visual (P1)

Código: `Home`, `useCatalog`, `useStorefrontLoading`, `StorefrontLoading`, `StorefrontNotice`, tarjetas/hero.

| ID / nivel | Casos y resultado esperado | Regresión que detecta |
| --- | --- | --- |
| V1 / UI | Respuesta API realista se muestra en BRL/kg, con variantes/precios/imágenes; combinar categoría y búsqueda sin distinguir mayúsculas devuelve solo coincidencias; limpiar recupera catálogo. | Mapeo incorrecto de unidades o filtros combinados. |
| V2 / UI | Diferenciar cargando, catálogo vacío válido y error; reintentar recupera productos; respuesta inválida no se convierte en tienda vacía exitosa. | Errores ocultos como ausencia de productos. |
| V3 / UI | Loading se retira al resolver catálogo y banner; también si no hay banner, si falla o si vence su espera de 2,5 s. | Imagen lenta bloquea compra. |
| V4 / UI | Catálogo atascado libera overlay a 12 s; error lo libera antes; recuperar/reintentar no reabre introducción; desmontar restaura overflow. | Página permanentemente bloqueada o scroll perdido. |
| V5 / UI | Errores iguales de sesión/catálogo generan un aviso; cerrar lo oculta; retry dispara recuperación, bloquea repetición mientras carga y un error distinto se vuelve visible. | Avisos duplicados o botón inútil. |
| V6 / UI | Banners vacío/error mantienen contenido utilizable; siguiente/anterior eligen banner correcto; favicon válido se aplica sin bloquear catálogo. | Fallos opcionales tumban la tienda. |

### Q — Checkout (P0)

Código: `Checkout.jsx`, contexto real de carrito y adaptador API.

| ID / nivel | Casos y resultado esperado | Regresión que detecta |
| --- | --- | --- |
| Q1 / UI | Entrada directa con carrito <15 vuelve a tienda; cambios de cantidad durante montaje no rompen hooks. | Saltarse mínimo por URL o fallo de render. |
| Q2 / UI | Nombre vacío/corto, WhatsApp insuficiente, email inválido y falta de entrega impiden POST; email vacío válido se omite. | Formulario envía pedido inválido. |
| Q3 / UI | Correios exige CEP/estimación; cambiar CEP o peso invalida cotización; Excursão funciona sin CEP y presenta flete pendiente. | Envío calculado con datos anteriores. |
| Q4 / UI | Enviar genera payload con cliente, método/CEP e IDs/cantidades correctos, sin usar precio/total del navegador como autoridad. | Adaptador conecta mal UI y contrato de pedido. |
| Q5 / UI | Doble interacción durante POST pendiente produce una sola creación; éxito muestra número y enlace, descuenta piezas y mantiene confirmación aunque quede carrito vacío. | Pedidos duplicados o confirmación perdida. |
| Q6 / UI | Error/timeout conserva carrito y muestra error; no abre WhatsApp ni reintenta automáticamente. Una respuesta exitosa posterior usa su snapshot de envío, no otro carrito. | Pedido perdido/duplicado por resultado incierto. |
| Q7 / E2E | Abrir/reabrir enlace WhatsApp desde confirmación no crea otro pedido; volver a editar antes de enviar conserva selección. | Navegación vuelve a ejecutar mutación. |

Q6 no promete idempotencia entre recargas ni conciliación durable: eso no está implementado y requiere decisión de producto.

### W — WhatsApp (P1)

- **W1 / unidad:** mensaje conserva cada producto/talle/color/cantidad, total, entrega y número; carrito vacío produce mensaje vacío. Verificar contenido significativo y agrupación, no emoji, separadores ni toda la frase literal. Incluir `__proto__`/`constructor` como datos normales.
- **W2 / HTTP:** enlace generado llega a `/api/v1/whatsapp`; endpoint usa exclusivamente número configurado y codifica acentos, `&`, saltos y `+`; sin número devuelve 503; query repetida/no string o texto >20.000 devuelve 400. No permitir que parámetros del visitante cambien destino. Comprobar `Location` sin navegar a una conversación real.

### H — Transporte y contrato HTTP (P0)

| ID / nivel | Casos y resultado esperado | Regresión que detecta |
| --- | --- | --- |
| H1 / unidad | URL base local/producción correcta; rechaza credenciales, protocolos no HTTP(S), query/hash y localhost inseguro en producción. | Bundle llama al backend incorrecto o transporta credenciales en URL. |
| H2 / transporte | Peticiones incluyen cookie y trace; JSON tiene Content-Type; FormData conserva boundary del transporte; 204/HEAD exitoso no intenta parsear JSON. | Login/upload/logout rotos por headers o parsing. |
| H3 / transporte | GET/HEAD reintentan una vez ante red/timeout/502–504; GET también ante HTML transitorio. HEAD exitoso no tiene body que validar y no se repite por su Content-Type. Agotamiento conserva error; 4xx de validación no se repite. | Ocultar errores o bucle de solicitudes. |
| H4 / transporte | POST/PATCH/DELETE no se repiten ante fallo de red, timeout ni 503. | Duplicar pedido, ajuste o upload. |
| H5 / transporte | HTML 200, JSON malformado, null/primitivo producen INVALID_RESPONSE; error JSON conserva status/code/trace sin inventar catálogo vacío. | Respuesta inválida se acepta como negocio válido. |
| H6 / transporte | Abort previo, durante fetch, lectura de body y espera entre retries evita siguiente intento y devuelve cancelación; timeout se distingue de cancelación. | Trabajo sigue después de abandonar pantalla. |
| H7 / unidad | Lecturas concurrentes comparten trabajo; siguiente lectura tras éxito o fallo consulta de nuevo; rechazo síncrono también libera estado. | Stock congelado en caché o promise fallida permanente. |
| H8 / API | JSON inválido→400; oversized→413; schema inválido→422 sin valores sensibles; no encontrado→404 JSON; duplicado→409; error inesperado→500 sanitizado con trace. | API entrega HTML, secretos o códigos incoherentes. |
| H9 / API proceso | Límite JSON se aplica después de descomprimir; bytes comprimidos dañados no derriban proceso y una solicitud válida posterior funciona. | Consumo desmedido/crash en nuestra entrada HTTP. |

H9 es una caracterización acotada de un incidente previamente documentado. No recrear toda la suite de body-parser/Multer ni aceptar cualquier respuesta sin comprobar que el proceso sigue disponible.

### S — Sesión y autorización (P0)

| ID / nivel | Casos y resultado esperado | Regresión que detecta |
| --- | --- | --- |
| S1 / API+DB | Registro normaliza email, crea CUSTOMER incluso si payload pide ADMIN; persiste hash verificable, nunca contraseña/token en claro en respuesta; email duplicado con distinta capitalización→409. | Escalada de rol o credenciales expuestas. |
| S2 / API+DB | Login correcto crea sesión y cookie; password incorrecto, cuenta inexistente/inactiva devuelven mismo error público y no crean sesión. | Autenticación falsa o enumeración explícita. |
| S3 / API+DB | Cookie HttpOnly, SameSite=Lax, path=/, Secure en modo productivo y sin Domain; token guardado como hash; cookie vuelve a identificar usuario vía /me. | Sesión no persiste o se expone. |
| S4 / API+DB | Ausente, inventada, vencida, revocada o usuario desactivado dan user:null y niegan ruta protegida; logout revoca y borra cookie, repetir logout no falla. | Acceso después de expiración/logout. |
| S5 / API+DB | Matriz rutas×roles: invitado compra y lee público; /orders/me exige sesión; CUSTOMER no administra; STAFF usa pedidos/stock pero no catálogo/staff/media/logs; ADMIN accede. Probar todas las rutas montadas mediante tabla, con fixture válida para verificar también autorización positiva. | Una ruta nueva queda antes del guard equivocado. |
| S6 / API+DB | /orders/me muestra solo pedidos de ese CUSTOMER, no archivados ni de otra cuenta; email igual de invitado no vincula pedido. | Fuga de pedidos por filtrado incorrecto. |
| S7 / UI | Refresh pendiente no pisa login/register/logout posterior; fallo de red conserva usuario y ofrece retry; /management muestra carga/error antes de decidir y solo admite ADMIN. | Respuesta vieja cierra sesión o concede acceso visual. |
| S8 / UI | AuthDialog ejecuta login/registro real vía transporte, muestra fallo recuperable y evita envío duplicado pendiente; cuenta muestra totalCents/100 y número público de la respuesta real, y logout navega tras éxito. | Contrato de cuenta roto o formulario desconectado. |

STAFF tiene permisos de API pero no de página Management: conservar esa diferencia hasta que se decida cambiarla. No escribir una prueba que dé por existente un panel STAFF.

### O — Pedidos, inventario y transacciones (P0)

Código: `order.service.js`, `shipping.service.js`, `inventory.js`, `transaction.js`, controladores/schemas de pedido y ajuste.

| ID / nivel | Casos y resultado esperado | Regresión que detecta |
| --- | --- | --- |
| O1 / servicio+DB | 14 piezas rechazadas; 15 aceptadas incluso 8+7 de misma variante; una sola línea agregada, reserva exacta, movimiento y auditoría; invitado/STAFF/ADMIN sin userId cliente, CUSTOMER asociado. | Mínimo incorrecto, duplicación de línea o propiedad equivocada. |
| O2 / API | Cantidad cero/negativa/fracción/no numérica/>999, items vacío/>80, ID inválido, datos cliente/CEP inválidos rechazados sin escrituras; coerción permitida de strings numéricos y normalización WhatsApp funcionan. | Validación desconectada de rutas reales. |
| O3 / servicio+DB | Rechazar variante inexistente o inactiva por cualquiera de sus seis niveles: categoría, producto, opción de producto, opción global, variante, talle. Sin inventario→MISSING_INVENTORY; stock insuficiente→409. | Comprar entidad retirada o reservar stock inexistente. |
| O4 / servicio+DB | Precio, peso y snapshots salen de DB; precio variante cero no cae a base; envío se calcula en servidor; payload con total/precio falso no altera lo guardado. | Manipulación comercial desde navegador. |
| O5 / unidad + contrato UI | Tabla manual de zonas CEP (límites 3/4 y 6/7), peso mínimo y salto 500/501 g, centavos redondeados; EXCURSAO amount=null. UI y API contrastadas contra los mismos valores literales independientes, no una contra el resultado de la otra. | Divergencia entre estimación mostrada y guardada. |
| O6 / servicio+DB | Tabla completa de transiciones: NOVO→CONFIRMADO consume físico/reserva; NOVO→CANCELADO libera; CONFIRMADO→CANCELADO restaura; CANCELADO→NOVO reserva si alcanza; CONFIRMADO→CONCLUIDO no vuelve a consumir. Misma transición no duplica movimiento; las restantes se rechazan sin cambios. | Corrupción de stock por cambio de estado. |
| O7 / servicio+DB | Editar aumenta/disminuye/elimina/agrega variantes: NOVO ajusta reserva, CONFIRMADO físico, CANCELADO no mueve, CONCLUIDO bloquea items; mínimo 15, snapshots existentes y flete acordado conservados; líneas nuevas usan catálogo actual. Pago/note no alteran stock; null borra note, omisión conserva. | Historial reescrito o cálculo por estado equivocado. |
| O8 / servicio+DB | Archivar cada estado conserva registro/items, actor/fecha y auditoría; cancela/libera o restaura solo estados activos; no visible en listas ni editable; no duplica movimientos al repetir. | Borrado histórico o reserva archivada. |
| O9 / servicio+DB | Fallo a mitad de varias líneas, auditoría o archivo revierte pedido/items/stock/movimientos/auditoría juntos. Matriz de puntos que separan escrituras, no un test por llamada interna. | Commit parcial real. |
| O10 / PostgreSQL concurrente | Dos pedidos compiten por stock insuficiente para ambos: uno confirma y el otro falla sin negativos; confirmar/cancelar simultáneos no duplican consumo; archivar/reabrir deja estado serializable sin reservas archivadas. | Locks/aislamiento incorrectos que el mock actual no detecta. |
| O11 / unidad | Reintenta P2034, P2010/40001 y P2010/40P01 hasta tres intentos; agota y propaga; no reintenta errores de dominio, duplicado ni conexión incierta. | Reejecutar mutación que quizá ya confirmó o no recuperar conflicto seguro. |
| O12 / servicio+DB | Límites numéricos: agregación de cantidad, precio×cantidad, subtotal, peso de línea/total, flete/total y pago no desbordan Int; caso válido cercano al límite pasa. Cubrir creación y edición donde sus caminos difieren, incluidos snapshots previos; ningún cambio persiste al rechazar. | Overflow termina en 500 o deja actualización parcial. |
| O13 / API+DB | Ajuste manual aplica delta, conserva reserva y devuelve disponibilidad vigente; 0/entrada inválida rechazados por contrato, por debajo de reservado→409, inexistente→404; movimiento/auditoría atómicos. Competencia con reserva respeta invariante. | Panel altera stock ya comprometido. |

La matriz O12 no se multiplica ciegamente por todo: mantener casos distintos solo si eliminan una validación distinta. Los estados de O6/O7 sí son reglas diferentes, no redundancias.

### K — Lecturas del catálogo (P1)

- **K1 / API+DB:** listado y detalle ocultan cada relación inactiva aplicable; detalle de producto/categoría oculta→404; listado administrativo conserva entidades inactivas. Fixtures insertadas de verdad, sin mock que devuelve siempre el mismo producto.
- **K2 / API+DB:** disponibilidad = físico−reservado (inventario ausente→0), precio variante/base/cero, orden de talles/opciones/imágenes y dimensiones/URLs; comprobar contrato consumido por Home y MediaManager. No congelar toda la respuesta con snapshot gigante.
- **K3 / API+DB:** banners activos dentro de ventana, antes/después del período y extremos inclusivos; orden correcto. Site-media devuelve favicon más reciente o null; fallos se presentan como errores, no datos inventados.

### A — Escrituras administrativas y auditoría (P0)

- **A1 / API+DB, tabla por comando:** crear/editar categoría, opción global, producto, opción de producto, variante, imagen, banner y crear STAFF persiste resultado junto con auditoría de actor/entidad/acción. Fallo real de auditoría revierte escritura. Cada handler independiente debe tener una fila porque puede omitir su propia transacción.
- **A2 / API+DB:** PATCH parcial de categoría/opción/banner conserva active=false y sortOrder anterior al editar otro campo; permite false, cero y null donde el contrato los acepta. Producto/variante conserva campos omitidos. Límites numéricos/textuales/colecciones se validan por clases de equivalencia, no cada regla estándar de Zod.
- **A3 / API+DB:** crear opción con varias variantes crea inventario e INITIAL solo donde openingStock>0; SKU o talle repetido/fallo intermedio revierte toda la opción; 80 variantes válidas aceptadas y 81 rechazadas.
- **A4 / API+DB:** opción/variante/imagen de otro producto se rechaza sin modificarlo; referencias inexistentes no dejan registros parciales. Slug/SKU duplicado responde conflicto controlado.
- **A5 / API+DB:** crear/listar staff nunca devuelve hashes; nuevo usuario es STAFF; listar metadata incluye entidades necesarias para administración. Permisos se cubren por S5, no se repiten aquí completos.

### G — Gestión interactiva (P0 salvo logs/medios en P1)

| ID / nivel | Casos y resultado esperado | Regresión que detecta |
| --- | --- | --- |
| G1 / UI | Stock vacío, espacios, negativo/fracción inválidos no mutan por click ni Enter; cero explícito sí; nuevo físico <reserva se bloquea; mismo valor no envía delta. | Enter elude botón deshabilitado y pone stock en cero. |
| G2 / UI | Ajuste envía delta y muestra **inventory** devuelto por API, incluso si difiere de cálculo local por concurrencia; doble envío pendiente bloqueado; fallo conserva dato editable. | UI muestra stock ficticio tras éxito. |
| G3 / UI | Lote valida todos los talles antes de enviar; excluye delta cero; éxito parcial actualiza solo aceptados e identifica fallidos; reintento calcula diferencias desde estado actualizado. | Duplicar ajustes o fingir éxito total. |
| G4 / UI | Cambio A→B→A y dos recargas fuera de orden: solo respuesta actual actualiza datos/error/loading; mutación anterior no cierra editor ni contamina otra pestaña. | Respuesta obsoleta sustituye pantalla actual. |
| G5 / UI | Edición manda cantidades y pago en centavos (coma decimal incluida); cero quita ítem; error conserva editor; éxito actualiza listado. Archivo cancelado por usuario no envía; confirmado desaparece tras éxito. | Payload incorrecto o pérdida de edición. |
| G6 / UI | Activar/desactivar producto/banner refleja respuesta recargada y fallo visible; vista vacía difiere de fallo de carga. | Toggle visual sin persistencia. |
| G7 / UI | MediaManager cambia destino y limpia selección incompatible; envía FormData correcto para producto/opción/portada, categoría, banner nuevo/existente, favicon y biblioteca; busy evita repetir; éxito refresca, fallo permite corregir; editar portada/orden refleja resultado. | Imagen vinculada a entidad incorrecta o formulario imposible de enviar. |
| G8 / UI | Logs: aplicar nivel/servicio/búsqueda/trace, expandir detalle, quitar trace y paginar conserva consulta; iniciar/pausar/desmontar detiene polling; fallo visible permite recargar. | Panel ignora filtros o sigue consultando cerrado. |
| G9 / UI | Respuesta tardía de logs de filtro anterior y página pendiente no se mezcla con filtro actual; live + loadMore no duplica ni restaura entradas de consulta abandonada. | Resultados de logs engañosos por carreras. |

G9 se implementó con control de generación, deduplicación y polling no superpuesto; sus regresiones se cubren con promesas controladas.

### I — Presentación de imágenes (P1)

- **I1 / unidad:** transformación solo de URL pública HTTPS admitida con dimensiones válidas; conserva proporción, limita al ancho original y calidad al rango; entradas ajenas/incompletas mantienen original.
- **I2 / unidad:** srcset sin duplicados ni upscale, ordenado y con candidato original; descriptor coincide con ancho generado; metadatos inválidos no producen srcset roto.
- **I3 / UI:** fallo de imagen optimizada cambia a original y quita srcset; fallo final notifica y Hero libera carga; nueva URL vuelve a intentar optimización. No ciclos infinitos ni imagen rota bloqueando la tienda.

### U — Uploads y conservación de medios (P0)

| ID / nivel | Casos y resultado esperado | Regresión que detecta |
| --- | --- | --- |
| U1 / unidad | JPEG/PNG/WebP reales producen MIME/dimensiones/tamaño/checksum correctos; texto/SVG/truncado/animado, vacío, >5 MB y >16 MP se rechazan. Fixture de checksum literal verificado independientemente. | Extensión/MIME fingido pasa como imagen. |
| U2 / API+DB + Storage controlado | Multipart correcto crea asset con ruta nueva, bytes intactos y metadatos; enlaza cada propósito (producto/opción/portada, categoría, banner nuevo/existente, favicon, library); auditoría persistida. | Upload exitoso deja imagen inaccesible o mal asociada. |
| U3 / API+DB | Falta archivo/destino requerido, option ajena, purpose inválido, campos extra, múltiples archivos o exceso de tamaño/partes se rechazan sin asset/objeto persistido. | Input inválido consume almacenamiento o cruza entidades. |
| U4 / integración | Fallo de Storage→error sin vínculos; fallo de transacción confirmado ausente limpia **solo objeto nuevo**; commit ambiguo con asset existente o consulta fallida no borra objeto. Reemplazo/portada conserva archivos viejos y snapshots de pedido. | Pérdida irreversible de imágenes históricas. |
| U5 / HTTP proceso | Mientras un upload decodifica/escribe, otro recibe UPLOAD_BUSY + Retry-After; aborto antes de procesar libera; aborto durante procesamiento conserva cupo hasta finally; éxito y cada fallo permiten siguiente upload. | Agotamiento de memoria o slot bloqueado para siempre. |
| U6 / API+DB | Cambiar portada degrada anterior y deja exactamente una; cambiar orden no cambia tipo; parche inválido/inexistente controlado. Dos cambios concurrentes nunca dejan dos PRIMARY ni asociación parcial. | Portadas duplicadas o galerías corruptas. |

La suite no comprueba internals del SDK de Storage: comprueba ruta, bytes, opciones de no sobrescritura y efectos de nuestra integración ante éxito/error.

### L — Logs, consultas y apagado (P0/P1)

| ID / nivel | Casos y resultado esperado | Regresión que detecta |
| --- | --- | --- |
| L1 / unidad, P0 | Secretos anidados, emails/CPF/tarjeta, URL autenticada, Bearer/tokens se redactan antes de stdout/sink/dead-letter; contenido no sensible queda; ciclos, profundidad y tamaños extremos no rompen negocio. | Fuga de datos o caída por logging. |
| L2 / unidad, P1 | Mínimo de nivel y sample debug 0/1/intermedio con azar controlado; info/error no son descartados por muestreo debug. | Diagnóstico perdido o volumen incontrolable. |
| L3 / unidad, P0 | Flush por umbral y tiempo; llamadas simultáneas no duplican lote; datos llegados durante escritura se drenan; colas limitadas por entradas y bytes incluyendo lote activo. | Memoria ilimitada o duplicación de escritura. |
| L4 / unidad, P0 | Falla sink lleva lote redactado a dead-letter; falla también dead/output no lanza al negocio, cuenta descarte y emite diagnóstico sanitizado cuando posible. | Telemetría interrumpe pedidos. |
| L5 / integración SQL, P1 | Logger real escribe lote en log_entry y batch fallido en log_dead con forma legible; nombres/textos con caracteres especiales no cambian SQL. | Tests del sink pasan pero SQL productivo no funciona. |
| L6 / API concurrente, P0 | Trace válido se conserva, inválido se reemplaza; requestId distinto por request; actor/ruta/status/duración pertenecen a su solicitud aun con concurrencia; URL query no filtra secretos en log de request. | Contextos mezclados o soporte incapaz de correlacionar. |
| L7 / lifecycle, P0 | Cierre deja de aceptar trabajo, termina HTTP, espera flush activo y cola antes de desconectar; señales repetidas son idempotentes; timeout/fallo fuerza salida no exitosa y diagnóstico sin secretos. | Logs perdidos por cierre prematuro o proceso colgado. |
| L8 / API+DB, P1 | Filtros de logs individuales/combinados; level es lista exacta; q trata %, _ y barra como literales y payload de inyección no amplía resultado; fechas inclusivas y validación 422; paginar ts empatados con id sin duplicar/omitir y terminar con nextCursor=null. | Filtros inseguros o paginación pierde eventos. |
| L9 / API+DB, P1 | Trace endpoint valida UUID, ordena ascendente y limita 500; lista normal descendente; dead lista últimos 50, IDs bigint serializados como string; cursor malformado se rechaza. | Consulta falla al serializar o devuelve orden/datos equivocados. |

### D — Migraciones, integridad y permisos (P0)

- **D1:** aplicar toda la secuencia en DB vacía y poder ejecutar operaciones Prisma/SQL requeridas. No fijar “21 tablas/6 enums/4 particiones”; probar estructuras mediante sus consumidores.
- **D2:** runtime puede leer/escribir dominio y logs según grants, no puede DDL, leer `_prisma_migrations` ni ejecutar mantenimiento privilegiado; anon/authenticated no leen tablas privadas ni particiones directamente. Con grant accidental, RLS sigue sin exponer filas. Verificar por tabla/rol en matriz porque una nueva tabla puede quedar expuesta.
- **D3:** SQL directo inválido viola invariantes de stock/reserva, cantidades/importes, email case-insensitive, SKU, relaciones y unicidad de portada/asset. Comprobar constraints que protegen negocio frente a otros escritores; no volver a probar cada validación UI.
- **D4:** mantenimiento crea rangos futuros utilizables con protecciones, retira particiones antiguas elegibles y conserva recientes/default; sin pg_cron las migraciones siguen aplicando. No afirmar borrado exacto por fila a 90 días ni limpieza de dead-letter.
- **D5:** migración de medios con public_id existente aborta sin quitar la columna/datos; camino permitido conserva IDs y referencias. Es una protección nuestra de migración, no un test genérico de SQL.

Si DEFAULT ya contiene filas del rango futuro, documentar la limitación y comprobar que un fallo de mantenimiento no borra datos. Resolver reubicación automática sería un cambio independiente, no inventarlo como comportamiento existente.

### P — Proxy, arranque y entrega (P0)

- **P1:** middleware sobrescribe IP/secreto aportados por visitante únicamente en upstream; no expone secreto en respuesta. Validar IPv4/IPv6 admitidos, no cadenas múltiples.
- **P2:** falta/configuración inválida de secreto o IP verificado falla cerrado en middleware; backend distingue secreto ausente/incorrecto e IP inválida; forwarded estándar falsificado no cambia rate limit. Clientes distintos no comparten límite; IPv6 del mismo rango no lo evade. En local se usa socket.
- **P3:** ejecutar configuración con entorno controlado: rechaza origen inseguro/credenciales/config incompleta; `/api`, API válida y desconocida no caen a HTML SPA; `/checkout`, `/account`, `/management` sí; secreto ausente de artefactos serializados; respuestas API incluidas fallidas llevan no-store. Comprobar reglas generadas y un smoke desplegado separado cuando se publique; un evaluador local no certifica Vercel.
- **P4:** arrancar proceso con entorno válido/inválido: producción exige HTTPS/secreto; conexión exige schema app/TLS remoto; errores no imprimen credenciales. Variables de log/upload fuera de rango impiden arranque controladamente. No fijar versión exacta como una regla comercial.
- **P5:** `/health` funciona sin sesión/proxy cuando DB responde y falla cuando DB no responde; no convierte SELECT fallido en 200. CORS expone headers de traza y credenciales al origen configurado; mutación con Origin ajeno se rechaza. Ausencia de Origin se documenta como permitida por el middleware actual, no se inventa protección adicional.
- **P6 / verificación de entrega:** build real con variables de prueba, entrada SPA y assets utilizables, sin marcadores de secretos server-only en bundle; validar/generar Prisma y aplicar migraciones de test. Revisar receta Render y runtime compatible al desplegar; no snapshots de YAML ni plan de pago.

### T — Scripts operativos (P1)

- **T1:** `check-database.js` contra base de test: éxito presenta schema/rol/conteos sin PII; schema ausente/fallo retorna exit !=0 y diagnóstico sanitizado; cierra conexión. Ejecutar script, no buscar texto en él.
- **T2:** modo `media:migrate -- --verify` con servidor HTTP local y registros de test: bytes/checksum/registro correctos pasan; 404, checksum/tamaño distinto y asset ausente fallan con exit !=0. Verificar no escritura en este modo.
- **T3:** importación con directorio de fixtures explícito: reanudar no sobrescribe assets/galerías administradas, conflicto aborta vínculos, manifiesto solo tras éxito. Falta de originales devuelve fallo claro. Separar I/O de entrada si hace falta, con cambios mínimos y pruebas previas; no ejecutar el importador actual contra datos reales para probarlo.
- **T4:** seed en base nueva descartable crea admin utilizable y catálogo relacionado con inventario cero; credenciales inválidas fallan antes de escribir. No congelar nombres/colores/cantidad comercial completa. No reinterpretar seed como herramienta de importación o reparación de producción.

### E — Recorridos completos y presentación operable (P0/P1)

1. **E1 (P0):** invitado carga catálogo, elige variantes hasta 15 piezas, crea pedido Excursão, ve confirmación y enlace; consultar DB confirma una orden y reserva. Reabrir enlace no duplica. Una segunda variante del recorrido usa Correios y coteja total/flete.
2. **E2 (P1):** recorrido anterior en móvil estrecho y escritorio: abrir/cerrar carrito/modal, alcanzar controles y volver a editar; header y CTA no se solapan ni quedan fuera de viewport. Verificar geometría/acción real, no margen/fuente exactos ni screenshots de página completa.
3. **E3 (P0):** registro/login → pedido asociado → Account → recarga → logout; aislamiento de otro cliente y ruta admin prohibida. Reutilizar setup API para preparar usuarios, sin repetir en navegador toda la matriz S5.
4. **E4 (P0):** ADMIN ajusta stock, confirma/cancela/archiva pedido y revisa resultado coherente en panel y DB; las auditorías identifican actor y entidad.
5. **E5 (P1):** ADMIN sube una imagen de test, la vincula/cambia portada y Home recibe la nueva, mientras un pedido anterior conserva su URL snapshot. Storage aislado, nunca bucket productivo.

Integrar comprobaciones de teclado, nombres accesibles, foco de diálogos y reduced-motion en los recorridos donde afectan operación. Si falta comportamiento accesible, reproducir RED y corregir con alcance explícito; no validar únicamente que existe `aria-modal`.

## 7. Defectos y decisiones que el plan debe distinguir

### Desajustes originales y su estado

1. Account usaba `order.total` en vez de `totalCents`: corregido y protegido por S8/E3, incluyendo número público.
2. Management no reconocía `{ inventory }`: corregido y protegido por G2 con valores autoritativos distintos del cálculo local.
3. LogsPanel aceptaba respuestas obsoletas: corregido y protegido por G8/G9.
4. Home dirige STAFF a Management después de login, pero el guard exige ADMIN. Decidir destino UX correcto antes de exigir acceso STAFF; S7 cubre permisos actuales.
5. AuthDialog exige minLength=10 también para login, mientras loginSchema admite desde 1. Evaluar si existen cuentas históricas afectadas; no cambiar esa política solo para hacer pasar pruebas.

### Fuera de la aplicación actual: requieren decisión antes de nuevos tests de aceptación

- Idempotencia durable y recuperación tras POST confirmado cuya respuesta se perdió.
- Vencimiento automático de reservas invitadas.
- Recotización de envío al editar pedido (hoy conserva el anterior).
- Acceso STAFF a la UI de gestión.
- Favoritos reales: ProductCard tiene un botón visual sin implementación; no escribir test que finja persistencia de favoritos.
- Pagos externos, webhooks, tracking de envíos, desarchivado y Supabase Auth no existen en este código.

## 8. Orden de ejecución y eliminación

### Fase 0 — Base y acuerdo de método

- Registrar commit base y cambios locales; conservar historial Git de la suite antigua sin crear carpetas de tests duplicados.
- Acordar la excepción de caracterización de legado de la sección 3.
- Repetir baseline bajo Node compatible; diagnosticar `worker did not send ready` con stderr/exit/ready del hijo antes de clasificar la cobertura. No atribuirlo sin evidencia al Node local.
- Registrar duración/casos/fallos. No esconder baseline rojo eliminando el test que falla.

### Fase 1 — Harness mínimo

- Aislamiento de entorno, fixture de app/DB, datos mínimos, transporte controlado y runner UI.
- Hacer funcionar una prueba real de integración y una interacción real antes de migrar todo.
- Definir scripts rápidos/integración/E2E y un comando agregador que ejecute todas las suites requeridas y propague exit !=0. Mantener comandos documentados para ambos paquetes.

### Fase 2 — Núcleo P0

- Migrar O, S, H, P, D y U; primero crear/confirmar/cancelar/archivar con efectos persistidos, luego fallos y concurrencia.
- Retirar archivos antiguos correspondientes al completar su matriz de destino.
- Conservar en una tabla de ejecución `archivo/caso antiguo → ID nuevo o motivo de eliminación` para no perder una regresión real entre nombres distintos.

### Fase 3 — Frontend real

- Migrar C/Q/G y S7/S8; corregir Account y respuesta de inventario con RED verificable.
- V/I/W y comportamiento de logs; reemplazar pruebas de HTML estático por interacción.
- Eliminar inmediatamente dentro de este bloque tests de CSS/JSX que ya no tienen propósito, sin reproducirlos con otra tecnología.

### Fase 4 — Operación e integración final

- L, K, A y T que no hayan quedado cubiertos por fases previas; E1–E5.
- Quitar dependencias/utilidades de test realmente sin consumidores, incluido el worker viejo y exports exclusivos de testing del logger después de cubrirlos.
- Actualizar AGENTS/manual/scripts para la nueva organización. No editar migraciones históricas ni schema por reorganizar tests.

### Fase 5 — Retirada completa

- Verificar que cada uno de los 30 archivos antiguos salió o fue sustituido por su implementación nueva; no conservar suite vieja en ejecución ni en carpeta de backup dentro del repo.
- Quitar tests de documentación, estructura/versión de dependencias y decisiones visuales enumerados en sección 4.
- Ejecutar todas las suites, build y verificación Prisma del entorno aislado. Reportar por nombre cualquier fallo, incluso previo.
- Entregar inventario final de pruebas y diferencias de duración/mantenimiento. No usar menor conteo ni cobertura 100% como criterio único.

## 9. Criterios de finalización

- [x] Los 30 archivos actuales tienen destino trazado y no quedan pruebas descartadas ejecutándose.
- [x] Cada caso nuevo nombra una regresión real; esperado independiente y assertion sobre comportamiento propio.
- [ ] Todo bug/cambio nuevo tiene evidencia RED → GREEN; caracterizaciones etiquetadas como tales y sensibilidad comprobada.
- [x] Fixtures no reemplazan la lógica de transacciones, autorización, filtros o cálculos que pretenden verificar.
- [x] Se ejercen sesiones/roles, pedido completo, estado/stock, auditoría, uploads/limpieza y concurrencia real.
- [x] Checkout y Management tienen interacciones automatizadas; Account y logs no dependen de contratos ficticios.
- [x] Tests de UI no inspeccionan archivos fuente y no fijan tipografía, márgenes o decoración.
- [x] Sin conexiones de tests a base/bucket productivos; temporizadores/procesos/conexiones terminan limpiamente.
- [x] Suites completas de ambos paquetes y E2E requeridos aprobados; build/Prisma verificados; avisos y fallos documentados, no silenciados.
- [x] Manual y scripts permiten reproducir la ejecución y explican qué exige PostgreSQL real.

La corrida vigente del 13/11/2026 aprobó **342 pruebas + build**, sensibilidad 3/3 y diff sin errores de whitespace, después de corregir las brechas identificadas: A1/A3, O9 de edición, C2/C3, V2/S7, E2 y cancelación del harness. La corrida de 335 del 12/11 es histórica. El criterio RED→GREEN queda sin marcar: por instrucción expresa se ejecutó solo al terminar implementación, sin inventar RED retrospectivo. Smoke desplegado y decisiones STAFF/contraseña siguen fuera del alcance autorizado. Se cubren deadlines internos/cancelación cooperativa, no muerte forzada no capturable del launcher; la causa raíz de arranques fríos no se considera resuelta. El presupuesto específico de ready del worker HTTP se ajustó con la evidencia de import-app, no se ampliaron globalmente todos los timeouts.

**Resultado buscado:** menos comprobaciones redundantes y mayor confianza en operaciones reales. Leer toda la aplicación sirve para elegir dónde una prueba aporta valor, no para crear una prueba de cada detalle que contiene.
