# Registro del reemplazo de tests

Base de comparación: `47ff945cd7ffd98a6bd9ea2be05c251e436417db`. La publicación posterior se identifica por su commit y por los despliegues de Vercel/Render; no cambia la evidencia histórica de las corridas locales.

## Alcance y método

**Estado actual: brechas identificadas en la auditoría corregidas y verificadas localmente (13/11/2026).** Nueva corrida completa: **342 pruebas + build**, código 0; sensibilidad 3/3. La corrida anterior de 335 pruebas fue válida, pero no demostraba cobertura completa del catálogo. El cierre se refiere al alcance local auditado y las equivalencias documentadas, no a una garantía de cobertura exhaustiva ni a certificación del despliegue. Las excepciones y límites continúan explícitos al final.

La autorización «Implementa» se aplicó al método del plan: caracterización del legado, sin borrar código correcto para fabricar RED; los primeros defectos tuvieron reproducción previa y corrección mínima. Las tandas posteriores se verificaron al final por instrucción expresa: no tienen RED intermedio retrospectivo. Las unidades útiles se conservaron/revisaron en lugar de reescribirlas artificialmente solo para cambiarles el nombre.

No se modificaron migraciones ni schema; no se usaron URLs/credenciales de desarrollo para integrar con base o Storage. No se ejecutaron operaciones remotas. `.agents/`, `.opencode/` y `skills-lock.json` ya existían y no forman parte de estos cambios.

## Entorno reproducible

1. Instalar ambos paquetes: `npm ci` en raíz y `server/`.
2. Usar Node **22.23.4 o superior dentro de 22.x**. El sistema local mantiene 22.11.0; las verificaciones usan un ejecutable temporal compatible. Esto no cambia la instalación global.
3. Instalar navegador: `npx playwright install chromium` en raíz.
4. `npm run test:all`: unidades/frontend UI → unidades API → regresiones del launcher → PostgreSQL → E2E → build aislado, en secuencia y propagando fallos. `npm --prefix server run test:harness` comprueba fallo normal, timeout de ejecución y cancelación durante arranque contra clústeres reales, incluida eliminación del directorio y cierre del puerto.
5. `npm run test:sensitivity`: tres mutaciones en una copia temporal. Nunca modifica el código de trabajo.

El harness PostgreSQL crea directorio/puerto/credenciales propios, escucha solo en `127.0.0.1`, aplica validate/generate/deploy y conecta el negocio con un LOGIN miembro de `ferchu_backend`. Storage se reemplaza únicamente en HTTP por un servidor local; Prisma, Express, decodificación, auditoría y transacciones siguen siendo reales. Docker no es necesario. No ejecutar con `sudo` ni crear usuarios del sistema. No ejecutar integración y E2E simultáneamente: generan el mismo cliente Prisma local.

Los tests UI mantienen páginas, providers, hooks y adaptadores HTTP reales; no reemplazan `useAuth`, `useCart` ni el resultado comercial de una transacción. El launcher ignora las URLs configuradas. Prisma tooling recibe URLs locales explícitas.

## RED → GREEN y caracterización

| Regresión | RED observado | Corrección |
| --- | --- | --- |
| S8: total de Account | `400,50` ausente; API entrega `totalCents`, no `total` | Convertir centavos a BRL. |
| S8: identificación de pedido | Número público ausente, se mostraba ID interno | Mostrar `publicNumber`. |
| G2: resultado de ajuste | Se mostraba placeholder `35` cuando servidor devolvía `33`, reservado `9` y disponible `24` | Reconocer `{ inventory }`. |
| G9: consultas de Logs | Respuesta anterior sustituía filtro actual; página vieja se agregaba a otra consulta | Invalidar generaciones antiguas, incluidos errores/loading y paginación. |
| G9: páginas superpuestas | Dos filas con ID `2` y warning de claves duplicadas | Deduplicar contra filas existentes. |
| G8: refresh en vivo | La consulta pendiente ocultaba los resultados actuales | Refresh de fondo sin pantalla de carga. |
| G8: backend lento durante polling | Se iniciaban 4 solicitudes en lugar de 2 con una respuesta aún pendiente | Un único poll de fondo activo, sin invalidarlo por cada tick. |
| E2: botón móvil del pedido | Playwright no encontraba el botón por nombre: CSS ocultaba su único texto descriptivo | Nombre accesible independiente del texto oculto, incluyendo piezas. |

Dos fallos iniciales del harness no eran bugs comerciales: el test E3 esperaba Home después de registrar, pero la aplicación navega a Account; el test V5 esperaba un botón de retry persistente, pero Home lo retira mientras carga. Se corrigieron las expectativas, sin cambiar producto para satisfacerlas.

### Continuación: fiabilidad del harness y cobertura adicional

- El hook `beforeExit` importado por `embedded-postgres` forzaba código `0`: una integración roja permitía continuar E2E. Reproducido también con una fixture deliberadamente fallida; el launcher ahora espera el cierre del hijo y de sus recursos y sale explícitamente con el código real. La regresión comprueba exit `1` y que desaparezca el directorio de datos.
- `pg_ctl` usa `stdio: ignore` y su propio archivo de log: evita que descendientes de Windows retengan pipes del launcher. No se editaron dependencias.
- La instrumentación de commit ambiguo asigna/restaura el método del proxy Prisma, delegando primero la transacción real. No simula persistencia ni rollback. U4 ya pasa.
- E5 usa el rol/nombre accesible del combobox; no se cambió producción para satisfacer el selector.
- Al añadir un segundo archivo E2E se reprodujo contaminación entre casos: el hook registrado durante el import solo quedaba asociado al primer archivo del worker. Ahora una fixture automática por test reinicia DB/Storage y aplica la prohibición de red externa en todos los archivos.
- Una ejecución posterior pasó 114/114 integraciones pero E5 recibió HTTP 429 en `/auth/me`: reiniciar tablas no reinicia el rate limiter de la instancia Express compartida. La fixture recrea esa instancia en el mismo puerto antes de cada test; no modifica ni desactiva límites productivos. La batería conjunta posterior pasó 11/11 en 1,9 minutos, sin errores de teardown.
- jsdom considera inválido el campo file obligatorio aun después de `userEvent.upload` (archivo visible en `files`, `validity.valid=false`). Los uploads de G7 se prueban con Chromium, sin retirar `required` ni saltar validación nativa: todos los destinos, producto/opción/portada, petición pendiente, fallo y retry. Las ediciones de portada/orden y el reinicio de selección permanecen como UI DOM.
- Se amplían G4–G6 (carreras de pestaña/editor, bloqueo de recarga repetida, pago/ítems, archivo y toggles), C7 (carga compartida y reconciliación), Q3/Q6 (peso y snapshot pendiente), W2 y O7/O9/O10/O13. Los resultados definitivos se registran al terminar las ejecuciones, no por la mera existencia de estos archivos.
- El primer ensayo de W2 con texto de 20.000 caracteres llegó al endpoint, pero Fetch rechazó la cabecera Location larga. El cliente HTTP local de esa frontera ahora admite la misma cabecera que el servidor de test; los tres casos W2 pasan sin alterar los límites productivos. El mensaje histórico de WhatsApp no incluye el precio del flete: Q6 comprueba el método y las piezas capturados, no una frase o importe inexistentes.

El worker de seguridad original pasa solo y fallaba al arrancar todos los archivos simultáneamente. Limitar concurrencia de archivos hizo pasar la suite sin aumentar timeouts. Se eliminó la reproducción de `fileFilter` asíncrono que la aplicación no usa.

Las pruebas de sensibilidad detectaron realmente: precio cero reemplazado por precio base; repetición de mutaciones HTTP; upscale de imágenes. Todos los cambios se aplicaron solo a copias temporales, verificando antes baseline verde y después fallo por assertion.

## Trazabilidad de los 30 archivos originales

| Archivo original | Destino / decisión |
| --- | --- |
| `test/cart.test.js` | Conservadas unidades C1–C5 útiles; hidratación/builder/mínimo en `test/ui/cart.test.jsx`; sensibilidad comprobada. |
| `test/checkout-header.test.js` | Retirado regex; controles/geometría en E1/E2 de `test/e2e/storefront.test.js`. |
| `test/documentation.test.js` | Retirado: prosa y cantidad de HTML no son contrato comercial. |
| `test/http.test.js` | Ampliado H2/H4/H6/H7; retirado POST redundante al introducir tabla POST/PATCH/DELETE. |
| `test/management.test.js` | Retirado parser duplicado; G1/G2/G3 ejecutan entrada, Enter, stock y respuesta real en UI. |
| `test/media.test.js` | Conservadas/ampliadas transformaciones útiles, hostname de fixture; fallback real en UI I3. |
| `test/mobile-layout.test.js` | Retirados márgenes/tipografía por regex; recorrido móvil en E2. |
| `test/proxy-middleware.test.js` | Conservado contrato P1/P2; complementado con API/roles/IPs reales en integración. No certifica verificación Vercel desplegada. |
| `test/render-blueprint.test.js` | Retirado plan Free y versión exacta; receta se revisa al entregar. |
| `test/storefront-loading.test.js` | Retirado JSX/CSS/SSR textual; reloj/loading/fallback/retry en `test/ui/`. |
| `test/vercel-config.test.js` | Conservada ejecución de función/config y límites API/SPA; build aislado con canary server-only. |
| `test/whatsapp.test.js` | Eliminada igualdad decorativa completa; se verifican datos/agrupación. E1 verifica redirect local sin conversación real. |
| `server/test/admin-audit.test.js` | Retirado adapter; A1 persiste y revierte con trigger de fallo exclusivo de DB de test. |
| `server/test/catalog.test.js` | Retirados queries/dobles; `integration/catalog-admin.test.js`: relaciones activas, presentaciones, auditoría, foreign associations y banners. |
| `server/test/database-config.test.js` | `configuration.test.js` ejecuta carga real de entorno en procesos aislados. |
| `server/test/express-errors.test.js` | Contrato JSON/traza/error SQL real en integración; no test genérico de Express. |
| `server/test/http-deployment.test.js` | Reemplazado por `integration/deployment.test.js` y sesiones reales. |
| `server/test/http-security.test.js` | `http-input.test.js` + worker mínimo: compresión y aborto. PATCH en A2 real; eliminado fileFilter ajeno a producción. |
| `server/test/images.test.js` | `image-validation.test.js`: formatos, checksum literal, animación, decodificación y megapíxeles. |
| `server/test/logger-lifecycle.test.js` | Fusionado en `logging.test.js`, factory por prueba y barreras explícitas. |
| `server/test/logger.test.js` | Fusionado en factory; eliminados buffer/setters globales y `__testing` productivo. SQL real en integración. |
| `server/test/logs-sql.test.js` | Migrado a PostgreSQL real: permisos, mantenimiento, consultas/sinks y dead-letter. Sin conteos exactos de particiones ni índice decorativo. |
| `server/test/order-minimum.test.js` | Mínimo/duplicados/edición con persistencia real, no retorno mock `accepted`. |
| `server/test/order-safety.test.js` | Desbordes, estados, snapshots, archivo y rollback en PostgreSQL; competencia por stock y archivo/reapertura con barrera de locks real. |
| `server/test/postgresql.test.js` | Roles/RLS/constraints y operaciones de consumidores en DB real; retirados conteos exactos y semántica genérica de timestamps. |
| `server/test/prisma-config.test.js` | Retirado merger/versiones; validate/generate/deploy reales en cada cluster. |
| `server/test/shutdown.test.js` | Conservado L7 útil: orden/drenaje/idempotencia y deadline. |
| `server/test/transaction.test.js` | Conservado retry O11, quitada identidad de callback y validación trivial del parámetro; concurrencia real en integración. |
| `server/test/upload-capacity.test.js` | Retirado contador aislado; U5 usa recepción abortada y operación real detenida en HTTP Storage. |
| `server/test/validation-security.test.js` | Retirado getter artificial/Zod interno; límites, coerción, PATCH y errores por rutas reales. |

Se retiró PGlite: ya no se duplica SQL en dos motores. Las dependencias nuevas son de desarrollo; React/Vite/Prisma no se actualizaron para acomodar tests.

## Cobertura incorporada antes de la auditoría

La tanda anterior incorporó transporte H1/H3–H6; C7/C8/C9, Q6, V2/V5/V6; G3/G6/G8/G9; O1/O3/O4 y tabla literal O5 compartida como datos entre UI/API/unidad; A1/A2/A4/A5 y autorización positiva STAFF/ADMIN; U3–U6; D2–D5, L8/L9; T1/T3; teclado/foco/reduced-motion y P6. I1/I2 amplían clases inválidas y descriptores de srcset. Tener pruebas de esos grupos no significa cubrir automáticamente todas sus variantes: la auditoría encontró las brechas del bloque siguiente.

Cambios funcionales acotados: base API relativa rechaza query/hash, referencias Prisma inexistentes producen 422/404 sanitizados, diálogos gestionan foco/Tab/Escape y el importador acepta I/O explícito con preflight de originales. No se modificaron migraciones aplicadas ni permisos STAFF/política de login.

**Excepción de método solicitada:** el usuario pidió terminar la implementación y ejecutar tests solo al final. Esta tanda escribió primero los casos pero no ejecutó RED/GREEN intermedio; no se atribuye evidencia RED retrospectiva. La corrida final y sensibilidad deben registrarse por separado de las 245 pruebas anteriores.

## Correcciones solicitadas tras la auditoría — 13/11/2026

| Brecha confirmada | Corrección implementada y verificada el 13/11 |
| --- | --- |
| A1: existir y auditar no demuestra guardar el valor solicitado | Cada fila contrasta campos solicitados en respuesta y DB; opción nueva comprueba variante, inventario y movimiento; STAFF verifica hash real. |
| A3: faltaba talle repetido con SKU distintos | Se rechaza el segundo conflicto y se comprueba que no deja opción, variantes, inventario ni movimientos adicionales. |
| O9: faltaba rollback de edición | Fallo de auditoría tras editar ítems/pago/nota en NOVO, CONFIRMADO y CANCELADO; comparación completa de pedidos/ítems/stock/movimientos/auditoría. |
| C2/C3: faltaban re-adición y separación de variantes | Precio cero/disponibilidad nuevos, mismo talle en otro color, otro talle y conservación de entradas ajenas/sin mutación. |
| V2/S7: faltaban estados vacíos/error del guard | Home vacío válido sin error y Management con sesión fallida → retry ADMIN, sin peticiones administrativas anticipadas. |
| E2: geometría y teclado parciales | Hit-testing y límites de controles, no solapamiento logo/volver y header/CTA; Tab recorre todos los controles y ambos modos de AuthDialog. |
| Timeout mataba al dueño del clúster | Deadline interno, cancelación IPC/señales y espera de limpieza; árbol de workers se termina antes de PostgreSQL. Cancelación de startup espera terminar el paso nativo acotado antes de limpiar. |
| Duplicación HTTP y montaje T2 innecesario | Una matriz HTML, un caso HEAD; verify usa --manifest temporal sin copiar src/package ni crear junction de node_modules. |

Límites explícitos del launcher: un SIGKILL, cierre forzado del sistema o TerminateProcess al proceso dueño no puede ejecutar finally. Se cubren deadlines internos y cancelación cooperativa (IPC en Windows, señales manejadas en POSIX), no se promete recuperación automática tras una muerte no capturable. El presupuesto de startup sigue siendo 110 s; la ventana exterior de la regresión incluye el tiempo adicional de limpieza, ya no es un hard-kill a los 110 s.

La causa de los arranques fríos intermitentes de Windows/OneDrive no se considera resuelta por una corrida verde. Una nueva corrida localizó el retraso en `import-app`, antes de escuchar HTTP. Se midieron importaciones de unos 1,5–5,9 s en pruebas diagnósticas y también se observó que pipes podían retener la espera de `close` tras `exit`. El worker ahora desconecta Prisma y el padre libera sus pipes tras exit; la regresión del launcher también espera exit y libera sus pipes. El presupuesto específico de importación/ready del worker HTTP pasa de 10 a 30 s (test completo 60 s); sus peticiones conservan 5 s y los demás presupuestos no se aumentan globalmente. El diagnóstico conserva etapa y tiempo transcurrido. Esto no demuestra la causa raíz de toda variación de arranque.

## Historial de verificación — no valida modificaciones posteriores

Hubo una corrida anterior de 245 pruebas + build, con sensibilidad 3/3 (11/11/2026). La siguiente corrida, del 12/11/2026, terminó con los resultados de esta tabla:

`npm run test:all`, bajo Node 22.23.4: **código 0**, completo y secuencial; anterior a las correcciones de la auditoría.

| Nivel | Resultado de la corrida del 12/11 |
| --- | --- |
| Unidades frontend | 64/64 |
| Interacciones React | 78/78, 11 archivos |
| Unidades/HTTP aislado API | 36/36 (incluidos subtests HTTP) |
| Regresión del launcher | 1/1 |
| Express/Prisma/PostgreSQL | 144/144 |
| Chromium | 12/12 |
| Build aislado | Aprobado; referencias JS/CSS utilizables y ambos canaries server-only ausentes |

**Total: 335 pruebas**, ninguna omitida/cancelada, más build. Cada launcher de base ejecutó Prisma validate/generate/deploy. Sensibilidad posterior: **3/3 regresiones detectadas**, con baseline verde en copia temporal. La comprobación final de procesos no encontró Node/PostgreSQL/initdb residuales. El resultado supera las 245 pruebas anteriores por clases de comportamiento nuevas, no por reintroducir snapshots decorativos.

### Fallos encontrados durante la verificación (no ocultados)

- HEAD exitoso no tiene contrato de body JSON: la nueva matriz errónea esperaba retry de HTML en HEAD. Se separó de GET y se verifica que HEAD no consuma body ni repita.
- El test UI de timeout mezclaba user-event con fake timers y agotaba 5 s. La entrada usa interacción real antes de activar el reloj; el click final y el plazo HTTP se controlan explícitamente.
- O5 esperaba un campo de peso agregado inexistente: se contrasta la suma de snapshots por ítem tanto en respuesta como en DB. Archivo responde 200 con la orden, no 204; la fixture T3 requería `type: SECONDARY`. No se cambió producción para satisfacer estas expectativas.
- Hubo arranques fríos intermitentes: un proceso de configuración agotó su timeout y el worker HTTP no llegó a ready en 10 s; luego pasaron aisladamente y en el agregador final. Se añadieron etapas de arranque, PID/exit y stderr a diagnóstico, sin ampliar plazos ni desactivar controles. Esto no demuestra ausencia de intermitencia futura en este Windows/OneDrive.
- Una corrida del launcher agotó 110 s antes de la fixture. Se detuvo con pg_ctl y eliminó exclusivamente su clúster propio `ferchu-pg-PPnnjx`; reejecución aislada aprobó en 37 s y final en 66 s. El intento no se contó como aprobado.
- `npm exec` quedó detenido antes de iniciar suites: se terminó solo ese proceso y se usó el Node 22.23.4 ya cacheado. Un intento con plazo global insuficiente también se descartó; no había procesos residuales antes de reiniciar.

Avisos no bloqueantes: MockTimers experimental, directivas `use client` de React Router y comentarios PURE de Zod/Rollup. PowerShell presenta stderr como `NativeCommandError` aun para esos warnings; el código real del agregador fue 0. Log local completo: `C:/Users/londa/AppData/Local/Temp/opencode/ferchu-final-tests.log`.

## Verificación vigente — 13/11/2026, después de las correcciones

`npm run test:all` con el ejecutable cacheado de Node 22.23.4 y su directorio primero en PATH: **código 0**, suites secuenciales. No hubo omitidas ni canceladas.

| Nivel | Resultado | Duración observada |
| --- | --- | --- |
| Unidades frontend | 64/64 | 1,3 s |
| Interacciones React | 80/80, 11 archivos | 69,6 s |
| Unidades/HTTP aislado API | 36/36 | 8,8 s |
| Regresiones del launcher | 3/3 | 78,4 s |
| Express/Prisma/PostgreSQL | 147/147 | 168,0 s |
| Chromium | 12/12 | 1,4 min |
| Build aislado | Aprobado | 7,4 s |

Total **342 pruebas + build**. Los launchers validaron/generaron Prisma y aplicaron las migraciones reales en clústeres nuevos. Las regresiones de cancelación comprueban salida no exitosa, directorio eliminado y puerto cerrado; el caso de timeout comprueba también que el coordinador de tests terminó. Sensibilidad posterior: 3/3, con baseline verde en cada copia. `git diff --check`: limpio. Comprobación final: sin procesos Node/PostgreSQL/initdb residuales.

Fallos de esta tanda: (1) worker HTTP excedió el antiguo presupuesto de ready durante import-app; se aplicaron los cambios acotados de diagnóstico/teardown/presupuesto descritos arriba, no cambios al negocio; (2) E2 resolvía dos logos (header y footer): se acotó al banner semántico, sin cambiar producción. Una corrida E2E posterior pasó 12/12 y después pasó el agregador completo. No se presenta ninguno de esos intentos fallidos como aprobado.

Comparación de mantenimiento/duración: el baseline original era 40 unidades frontend y 110 API aprobadas con 1 fallo, sin UI integrada/E2E/PostgreSQL real; sus ~23,7 s / ~64,3 s no son comparables con la confianza o los niveles nuevos. Frente a la corrida de 335, el total sube solo 7: se añadió cobertura específica y se quitó un caso HTTP duplicado. T2 ya no copia src/package ni crea junctions. Se conservan el aislamiento real, las fixtures comunes y una única suite SQL; no se afirma que la suite completa sea más rápida que la original ni que estas mediciones eliminen la variabilidad de Windows/OneDrive.

Log vigente: `C:/Users/londa/AppData/Local/Temp/opencode/ferchu-audit-fixes-tests.log`. Las duraciones son observaciones de esta ejecución, no umbrales de aceptación.

### Límites del cierre

- No se ejecutó smoke remoto ni se certificó el comportamiento desplegado de Vercel/Render; corresponde a una entrega autorizada.
- No se amplió acceso STAFF a Management ni se cambió la política de contraseña histórica. Tampoco se añadieron idempotencia durable, expiración de reservas u otras funciones excluidas por el plan.
- RED/GREEN intermedio de la tanda final no existe por la instrucción de ejecutar solo al final; la sensibilidad 3/3 no se presenta como sustituto de ese historial.
- Durante la implementación y verificación local no se hicieron commit, push, despliegues, migraciones remotas ni acceso a bucket/base reales. La publicación autorizada posteriormente es una operación separada; no incluye migraciones ni seed.
