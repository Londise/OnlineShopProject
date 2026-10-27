# Cambios de la revisión de Ferchu Modas

Fecha: 16 de octubre de 2026.

Este archivo reúne los cambios aplicados por el agente principal y sus subagentes. No hace falta consultar sus conversaciones: aquí se separan las modificaciones, sus motivos, las pruebas y lo que **no** se implementó.

Es un registro de esta intervención, no un reemplazo del manual del proyecto: la documentación de funcionamiento permanece en [`docs/documentacion.html`](docs/documentacion.html). Este Markdown se agrega por pedido expreso posterior a la consolidación documental.

## Índice

1. [Resumen y alcance](#1-resumen-y-alcance)
2. [Carrito](#2-carrito)
3. [Selección de variantes](#3-selección-de-variantes)
4. [Checkout y WhatsApp](#4-checkout-y-whatsapp)
5. [Administración e inventario](#5-administración-e-inventario)
6. [Pedidos y transacciones](#6-pedidos-y-transacciones)
7. [Catálogo y actividad](#7-catálogo-y-actividad)
8. [Auditoría de cambios administrativos](#8-auditoría-de-cambios-administrativos)
9. [Express y limpieza de código](#9-express-y-limpieza-de-código)
10. [Dependencias y seguridad](#10-dependencias-y-seguridad)
11. [Documentación](#11-documentación)
12. [Migraciones y restos de MySQL](#12-migraciones-y-restos-de-mysql)
13. [Pruebas y verificaciones](#13-pruebas-y-verificaciones)
14. [Propuestas y decisiones pendientes](#14-propuestas-y-decisiones-pendientes)
15. [Inventario de archivos](#15-inventario-de-archivos)
16. [Operaciones que no se realizaron](#16-operaciones-que-no-se-realizaron)

## 1. Resumen y alcance

Se revisaron frontend, backend, configuración, historial de Git, migraciones, pruebas y documentación. Se priorizaron defectos reproducibles y código sin consumidores frente a reestructuraciones amplias sin necesidad demostrada.

Los cambios principales son:

- Validación del carrito persistido y de sus cantidades.
- Uso del precio de variante, incluido el precio cero.
- Selección de talles derivada del catálogo en lugar de una lista fija.
- Confirmación del pedido separada de la apertura de WhatsApp.
- Protección contra doble envío durante el montaje de Checkout.
- Rechazo de stock vacío y de cantidades inválidas, incluso con Enter.
- Protección contra respuestas administrativas obsoletas.
- Archivo/cancelación de pedidos dentro de una única transacción Serializable.
- Rechazo de desbordes numéricos antes de escribir pedidos.
- Filtros de actividad consistentes para catálogo público y compra.
- Escrituras administrativas y sus auditorías dentro de la misma transacción.
- Eliminación del envoltorio de errores redundante en Express 5.
- Eliminación de imports, helpers, exports, estilos y una dependencia sin uso.
- Corrección acotada de una dependencia transitiva vulnerable de Prisma.
- Documentación operativa consolidada en un HTML offline con navegación.

**Resultado de verificación:** 27 tests frontend y 105 backend aprobados; build frontend y validación/generación Prisma correctos. Ambos paquetes terminaron sin avisos de `npm audit` en la consulta realizada. Esto no certifica ausencia de toda vulnerabilidad ni sustituye pruebas de producción.

## 2. Carrito

Archivos: `src/hooks/useCart.js`, `src/utils/cart.js` y `test/cart.test.js`.

### 2.1. Validación del contenido de localStorage

**Antes:** solo se comprobaba si el JSON era un array. Datos como `[null]` podían romper el render global; líneas incompletas podían producir `NaN`, y cantidades de tipo texto podían concatenarse en los totales.

**Cambio:** se agregó `sanitizeCartLines` con validación por línea:

- Identificadores y textos obligatorios no vacíos.
- `key` coherente con `variantId`.
- Cantidad positiva y entera segura.
- Precio y peso numéricos, finitos y no negativos.
- Disponibilidad ausente/nula o entera segura no negativa.
- Imagen ausente/nula o de tipo texto.
- Exclusión de líneas inválidas y variantes duplicadas; ante duplicados se conserva la primera línea válida, no se suman cantidades automáticamente.

**Justificación:** el almacenamiento del navegador no es una fuente confiable. Un dato corrupto no debe inutilizar todas las rutas que comparten el contexto del carrito.

**Compatibilidad:** se mantuvo la clave `ferchu-cart` y el formato de array para los carritos válidos. No se creó un formato versionado nuevo. Las líneas inválidas se descartan al cargar y el efecto de persistencia guarda el resultado saneado.

### 2.2. Cantidades y actualizaciones inmutables

**Cambio:** las operaciones se concentraron en funciones puras: `addCartLines` y `changeCartLine`.

- Se rechazan cantidades fraccionarias, no finitas, negativas, de tipo incorrecto o fuera del rango entero seguro.
- Cero es una operación explícita de eliminación al editar una línea.
- Una edición inválida no se convierte silenciosamente en eliminación: deja el estado sin cambios.
- Las adiciones respetan el stock informado y evitan desbordar la cantidad entera segura.
- Se mantiene el agrupamiento por variante, sin mutar el estado anterior.

**Justificación:** permite probar las mismas reglas que usa el hook sin simular React, y evita que cada consumidor tenga que conocer las defensas de cantidades.

### 2.3. Precio por variante

**Antes:** el carrito guardaba siempre `product.price`, aunque la variante tuviera un precio diferente.

**Cambio:** se usa `variant.price ?? product.price`; cero es un precio válido y no dispara el fallback. Agregar a una línea existente también actualiza su precio y disponibilidad con esos datos del catálogo.

**Justificación:** el importe mostrado debe reflejar la variante elegida, no solo el precio base del producto. El servidor sigue siendo la autoridad para el importe definitivo del pedido.

### 2.4. Menor interface pública y limpieza después de confirmar

- Se dejó de exponer `setLines`, que no tenía consumidores y permitía saltarse las reglas del carrito.
- Se conservó `clearCart`, utilizado ahora por Checkout.
- `clearCart` admite las líneas enviadas; `removeSubmittedCartLines` descuenta sus cantidades del estado vigente en vez de borrar indiscriminadamente todo el carrito.
- Si durante la espera se agregaron más unidades u otra variante, esas cantidades adicionales pueden permanecer.

**Justificación:** la confirmación de una solicitud no debe eliminar piezas agregadas posteriormente mientras se esperaba la respuesta.

**Límite conservado:** la reconciliación inicial de imágenes sigue existiendo. No se implementó una reconciliación completa de precios y stock de todos los carritos antiguos, ni una lectura única compartida del catálogo.

## 3. Selección de variantes

Archivo: `src/components/BuilderModalButton.jsx`.

### 3.1. Talles del catálogo

**Antes:** el modal generaba únicamente P/M/G/GG, aunque existieran otros talles válidos.

**Cambio:** los controles se generan desde `color.variants`; las cantidades comienzan y se reinician como un objeto vacío y se derivan de las variantes disponibles.

**Justificación:** evita ocultar PP, XG u otros talles y elimina una segunda lista fija que podía contradecir al catálogo.

### 3.2. Sincronización de cantidades

- El efecto depende también de `getAvailableToAddForVariant`, no solo del color.
- Las cantidades se limitan contra la disponibilidad actual calculada teniendo en cuenta el carrito.
- Cuando el resultado no cambió, se devuelve el mismo estado para evitar actualizaciones innecesarias.

**Justificación:** una modificación del carrito también cambia lo que todavía puede agregarse; el modal debe reaccionar a ese cambio.

### 3.3. Presentación y estados vacíos

- Se muestra el precio correspondiente a cada talle/variante.
- El importe superior se identifica como precio base, no como precio único de todas las piezas.
- Se protegen los accesos a `color.name` cuando no hay una opción seleccionable y se muestra un mensaje de ausencia de variantes.
- No se intenta agregar si falta color o cantidad seleccionada.
- Se eliminaron el import de `getVariant`, un comentario incorrecto y un `console.log` de depuración.

**Justificación:** evita fallos por ausencia de una opción y reduce ambigüedad comercial. No se agregó una validación universal para cualquier respuesta de catálogo malformada.

## 4. Checkout y WhatsApp

Archivos: `src/pages/Checkout.jsx`, `src/utils/whatsapp.js`, `test/whatsapp.test.js` y las reglas/pruebas del carrito.

### 4.1. Orden estable de hooks

**Antes:** Checkout podía retornar por cantidad insuficiente antes de ejecutar varios hooks de estado.

**Cambio:** todos los hooks se ejecutan antes de los retornos condicionales.

**Justificación:** variar la cantidad de hooks entre renders viola las reglas de React y puede romper la pantalla cuando cambia el carrito.

### 4.2. Doble envío y estado de confirmación

**Antes:** tras crear el pedido se abría WhatsApp, pero la pantalla no quedaba en un estado terminal visible. Volver a pulsar podía crear otro pedido.

**Cambio:**

- Se agregaron referencias de envío en curso y pedido creado, además del estado visual de confirmación.
- El guard de la referencia actúa inmediatamente, sin depender de que React haya renderizado `sending`.
- Después de una creación exitosa se muestra el número del pedido y una acción para continuar a WhatsApp.
- El pedido ya confirmado no se vuelve a crear desde ese montaje.
- La confirmación no redirige a Home por haber retirado las piezas enviadas del carrito.
- Se valida también dentro del handler que exista una modalidad de entrega utilizable.

**Justificación:** separa crear un pedido de contactar por WhatsApp y evita solicitudes duplicadas por interacción rápida.

**Límite importante:** no se implementó idempotencia durable. Recargar la pantalla o perder la respuesta de un POST sigue requiriendo conciliación del resultado antes de repetir una compra. Los POST no se reintentan automáticamente.

### 4.3. Enlace en lugar de popup posterior a un await

**Antes:** `window.open` se ejecutaba después de esperar la creación del pedido; el navegador podía bloquearlo por no reconocerlo como una acción directa del usuario.

**Cambio:** `buildWhatsAppUrl` construye la URL y la confirmación ofrece un enlace normal con `target="_blank"` y `rel="noopener noreferrer"`.

- El número del pedido forma parte del mensaje.
- Mensaje y teléfono se codifican con `URLSearchParams`.
- Si falta el teléfono configurado, se omite ese parámetro en vez de enviar el texto `undefined`.
- Se retiró `sendToWhatsApp`, que quedó sin consumidores.

**Justificación:** abrir o reabrir la conversación no depende de un popup asíncrono ni repite la creación del pedido.

### 4.4. Agrupación segura del mensaje

**Antes:** nombres de producto y talles se usaban como claves de objetos `{}`. Nombres como `__proto__` podían alterar el prototipo y omitir productos del mensaje.

**Cambio:** la agrupación usa `Map` anidados. Se eliminó también un formateador monetario sin uso.

**Justificación:** esos nombres deben ser datos normales, no propiedades especiales del lenguaje. La prueba incluye claves similares a propiedades del prototipo.

**Alcance:** se conserva el agrupamiento por nombre y talle; no se rediseñó la identidad de los grupos para distinguir productos diferentes con el mismo nombre.

### 4.5. Estimaciones de envío vigentes

- Cambiar el CEP elimina la estimación anterior y limpia su error.
- Cambiar el peso del carrito invalida la estimación.
- Sin estimación válida de Correios no se obtiene una entrega seleccionada utilizable para confirmar.

**Justificación:** evita seguir mostrando o aceptando una estimación calculada para otro CEP o peso.

También se eliminaron un comentario introductorio redundante y un `console.log` de Checkout.

## 5. Administración e inventario

Archivos: `src/pages/Management.jsx`, `src/utils/inventory.js` y `test/management.test.js`.

### 5.1. Stock vacío no significa cero

**Antes:** `Number("")` devuelve cero. El botón podía estar deshabilitado, pero pulsar Enter llamaba directamente al handler y podía llevar el stock físico a cero.

**Cambio:** se agregó `parseInventoryQuantity`, compartido por los handlers y las condiciones de los botones de ajuste individual y por lote.

- Rechaza vacío, solo espacios, tipos no admitidos, negativos, fracciones, valores no finitos y enteros inseguros.
- Acepta cero cuando fue ingresado explícitamente.
- La validación ocurre antes de solicitar el cambio, independientemente de si se usó el botón o Enter.

**Justificación:** una defensa visual no reemplaza la validación del comando que modifica inventario.

### 5.2. Respuestas obsoletas y cambio de pestaña

**Antes:** varias pestañas usaban el mismo `data`. Una respuesta lenta de Pedidos podía llegar después de abrir Inventario y sustituir sus datos.

**Cambio:**

- Cada visita a una pestaña tiene identidad propia, incluso al volver a una pestaña anterior.
- Cada carga tiene una generación; solo la carga vigente puede aplicar datos, error o finalización de carga.
- Cambiar de pestaña invalida la visita anterior y limpia datos, error y edición de pedido.
- Las respuestas de varias mutaciones revisan que su visita siga vigente antes de modificar datos, editor o errores.
- La limpieza del efecto invalida lecturas pendientes.

**Justificación:** el resultado de un contexto abandonado no debe contaminar el contexto actual.

**Límites:** no se aborta necesariamente la solicitud HTTP ya enviada ni se revierte una mutación que el servidor haya completado. Tampoco se reescribió el polling propio de `LogsPanel`.

## 6. Pedidos y transacciones

Archivos: `server/src/services/order.service.js` y `server/test/order-safety.test.js`.

### 6.1. Archivo y cancelación atómicos

**Antes:** archivar podía leer fuera de transacción, cancelar en una primera transacción y archivar en otra. Entre ambas confirmaciones otro operador podía reabrir el pedido y reservar stock, dejándolo finalmente archivado con reservas activas. Si fallaba el segundo paso también podía quedar una cancelación parcial respecto de la intención de archivar.

**Cambio:**

- Se extrajo `updateOrderInTransaction` como implementación interna reutilizable.
- `updateOrder` conserva su operación pública y la ejecuta dentro de `serializableTransaction`.
- `archiveOrder` consulta, cancela cuando corresponde, ajusta inventario, registra auditorías y archiva dentro de una única transacción Serializable.
- No se llama al comando público de actualización desde otra transacción ni se confirman dos pasos por separado.
- Se conservaron las transiciones y el tratamiento de pedidos NOVO, CONFIRMADO, CANCELADO y CONCLUIDO.
- Los eventos operativos de cambio de estado y archivo se emiten después de la confirmación, no dentro del callback reintentable.

**Justificación:** concentra la invariantes del pedido en una sola confirmación y permite que un conflicto Serializable se reintente sin conservar un paso intermedio.

### 6.2. Desbordes numéricos

**Antes:** cantidades y precios válidos por separado podían producir un importe que no cabe en PostgreSQL INTEGER. Por ejemplo, 999 piezas a 10.000.000 centavos producen 9.990.000.000, por encima de 2.147.483.647. Las variantes repetidas y los subtotales podían agravar el problema.

**Cambio:** se agregaron validaciones internas de enteros y totales para crear y editar pedidos:

- Cantidades agregadas de variantes repetidas.
- Precio y peso de los snapshots utilizados.
- Importe de línea y subtotal.
- Peso total utilizado por el cálculo.
- Envío y total con envío incluido.
- Importe pagado utilizado en la actualización.

Los valores deben ser enteros seguros, no negativos y no mayores que `2147483647`. Un desborde devuelve **422 `ORDER_AMOUNT_OVERFLOW`** antes de las escrituras del pedido, inventario, ítems o auditoría correspondientes.

**Justificación:** evita delegar al fallo de persistencia una combinación inválida de datos y devuelve un error de negocio controlado, sin ampliar columnas ni alterar migraciones.

**Reglas preservadas:** mínimo de 15 piezas, agregación por variante, snapshots de pedidos existentes, política de transiciones y conservación de la cotización de envío al editar artículos.

## 7. Catálogo y actividad

Archivos: `server/src/controllers/catalog.controller.js`, `server/src/services/order.service.js` y sus pruebas nuevas.

**Antes:** el listado público filtraba categorías inactivas, pero el detalle por slug y la compra no eran consistentes. Opciones globales inactivas podían publicarse/comprarse; variantes de talles inactivos podían aparecer aunque luego se rechazara la compra.

**Cambio:**

- El detalle público exige categoría activa, igual que el listado.
- Las opciones públicas exigen opción de producto y opción global activas.
- Las variantes públicas exigen variante y talle activos.
- La carga de variantes para compra/edición exige también categoría y opción global activas, además de las condiciones que ya existían.
- El listado administrativo conserva su capacidad de incluir registros inactivos.

**Justificación:** desactivar una entidad debe tener un significado consistente entre lo que la tienda muestra y lo que permite pedir, sin impedir su administración ni borrar historial.

## 8. Auditoría de cambios administrativos

Archivos: `server/src/controllers/admin.controller.js`, `server/src/controllers/catalog.controller.js`, `server/test/admin-audit.test.js` y `server/test/catalog.test.js`.

**Antes:** varias escrituras se confirmaban directamente y recién después se abría una transacción para la auditoría. Si esta fallaba, la operación respondía con error aunque el cambio principal ya se hubiera guardado.

**Cambio:** escritura y auditoría ahora comparten la misma transacción en estos comandos:

| Archivo | Comandos modificados |
| --- | --- |
| `admin.controller.js` | `createCategory`, `updateCategory`, `createVariantOption`, `updateVariantOption`, `createStaff` |
| `catalog.controller.js` | `createProduct`, `updateProduct`, `updateProductOption`, `updateProductVariant`, `addProductImage` |

- El resultado se retorna desde el callback y conserva la forma de respuesta HTTP.
- En actualización de opción/variante y creación de imagen, las comprobaciones relacionales pertinentes se realizan dentro de la transacción.
- Se preservan los includes usados para presentar resultados.
- El hash Argon2id de STAFF continúa calculándose antes de abrir la transacción; no se agregan contraseñas ni hashes a la respuesta o a la auditoría.
- No se envolvieron nuevamente operaciones que ya eran transaccionales, como creación de opción de producto o cambios de banners.
- Se corrigieron mensajes con caracteres mal decodificados en los controladores tocados.

**Justificación:** el registro de auditoría y el cambio que describe no deben tener confirmaciones independientes.

**Límite:** esto no agrega automáticamente snapshots completos de antes/después a todos los comandos. La auditoría conserva los campos que cada comando aporta; la documentación se corrigió para no prometer más.

## 9. Express y limpieza de código

### 9.1. Eliminación del envoltorio redundante

Archivo eliminado: `server/src/lib/async-handler.js`.

Se convirtieron a funciones async nativas los handlers de estos siete archivos:

- `server/src/controllers/admin.controller.js`.
- `server/src/controllers/auth.controller.js`.
- `server/src/controllers/catalog.controller.js`.
- `server/src/controllers/logs.controller.js`.
- `server/src/controllers/media.controller.js`.
- `server/src/controllers/order.controller.js`.
- `server/src/controllers/public.controller.js`.

**Justificación:** Express 5 ya envía los rechazos de promesas de sus handlers al middleware de errores. El envoltorio manual duplicaba ese comportamiento sin aportar una regla propia. Se conservaron los retornos y el manejo central de errores; los handlers de pedidos también se formatearon de forma legible.

**Verificación:** un test HTTP con el handler real y persistencia simulada comprueba respuestas 500/409, JSON, mensaje público y contexto de traza. No se eliminó el middleware de errores.

### 9.2. Exports y helpers retirados

| Archivo | Elementos retirados | Justificación |
| --- | --- | --- |
| `server/src/lib/security.js` | `digitsOnly` | No tenía consumidores. |
| `server/src/lib/logger.js` | `levelName`, `logTrace`, `logDebug`, `logFatal` | No tenían consumidores en el código revisado. |
| `src/services/api.js` | `logsByTrace`, `logsDead` | No se usaban desde el frontend. |
| `src/hooks/useCatalog.js` | Campo retornado `usingApi: true` | Era constante y nadie lo leía. |
| `src/utils/whatsapp.js` | `sendToWhatsApp` y formateador monetario local | El enlace de confirmación sustituyó el popup; el formateador no se usaba. |

**Importante:** quitar los helpers frontend de logs **no** elimina sus rutas backend. Quitar los aliases de logging **no** elimina niveles: `LOG_LEVELS` y `log` siguen admitiéndolos, y se conservan los helpers utilizados de info/warn/error.

### 9.3. Imports y lecturas innecesarias

- `src/App.jsx`: eliminado el import lateral de `domainFunctions.js`, que no aportaba efectos secundarios.
- `src/pages/Home.jsx`: retiradas desestructuraciones sin uso de `lines`, `addToCart`, `changeLine`, `removeLine`, `orderTotal` y `totalWeight`.
- `src/hooks/useCart.js` y `src/components/BuilderModalButton.jsx`: retirados imports que dejaron de ser necesarios después de concentrar las reglas.
- Checkout y Builder: retirados mensajes de depuración y comentarios redundantes o incorrectos al tocar esos bloques.

**Justificación:** reducir ruido y dependencias aparentes sin eliminar comportamiento utilizado.

### 9.4. Estilos retirados

Archivo: `src/styles.css`.

Se quitaron reglas sin clases emitidas por el código revisado:

- `.floating-cart`.
- `.account-empty`.
- `.inventory-row` y sus participaciones en selectores compartidos/responsive.
- `.order-status`.
- `.status-confirmado`, `.status-cancelado`, `.status-concluido`.
- `.stock-numbers`, `.stock-adjust` y sus reglas descendientes/responsive.

**Justificación:** eran restos de presentaciones anteriores. Se preservaron las partes de los selectores compartidos que siguen aplicándose a cuenta o administración. No se hizo una reescritura general del CSS ni se eliminaron todos los estilos sospechosos solo por parecer repetidos.

## 10. Dependencias y seguridad

### 10.1. Plugin React no configurado

Archivos: `package.json` y `package-lock.json`.

**Cambio:** se retiró `@vitejs/plugin-react` y se actualizó el lockfile, eliminando también dependencias transitivas que dejaron de ser necesarias.

**Justificación:** no había configuración Vite que importara o activara ese plugin. Mantenerlo instalado no proporcionaba su funcionalidad. Se verificó que el build existente sigue funcionando sin él.

No se agregó una configuración de Fast Refresh ni se cambió de framework.

### 10.2. Dependencia transitiva de Prisma

Archivos: `server/package.json`, `server/package-lock.json` y `server/test/prisma-config.test.js`.

**Hallazgo:** `npm audit` informaba tres entradas de severidad alta relacionadas con una misma cadena: Prisma → `@prisma/config` → `deepmerge-ts`. No eran tres exploits independientes demostrados en la aplicación.

**Cambio:** se agregó un override acotado:

```json
{
  "overrides": {
    "@prisma/config": {
      "deepmerge-ts": "8.0.2"
    }
  }
}
```

El lockfile pasó de `deepmerge-ts 7.1.5` a `8.0.2` en esa resolución.

**Justificación:** corregir el manejo vulnerable de grafos recursivos sin hacer un downgrade de Prisma ni una migración mayor del proyecto. Se revisaron los cambios publicados del paquete y el uso efectivo que hace la configuración de Prisma.

**Verificación:** carga real de configuración Prisma desde un archivo temporal, resolución de la versión fijada, mezcla de objetos circulares sin agotamiento de pila, schema válido y generación de cliente.

**Versiones preservadas:** Prisma y `@prisma/client` siguen en 6.19.3. No se usó `npm audit fix --force` ni se actualizaron indiscriminadamente las dependencias.

**Seguimiento:** revisar y eventualmente retirar el override cuando la versión de Prisma utilizada incorpore la corrección compatible.

## 11. Documentación

### 11.1. Manual único HTML

Archivo creado: [`docs/documentacion.html`](docs/documentacion.html).

Se integró el conocimiento útil de cuatro archivos y se eliminaron sus originales:

| Archivo eliminado | Contenido integrado |
| --- | --- |
| `server/README.md` | Arquitectura, conexiones, desarrollo, comandos, seguridad, medios, pedidos, logs y operación. |
| `docs/render-guia.html` | Flujo navegador/Vercel/Render/Supabase, configuración, antecedentes de despliegue y diagnóstico. |
| `docs/logs-guia.html` | Uso del panel, niveles, filtros, trazas, emisión, configuración y mantenimiento. |
| `server/prisma/history/README.md` | Distinción entre historia MySQL y migraciones activas PostgreSQL. |

**Preservación de trabajo previo:** `server/README.md` ya tenía cambios locales al comenzar. Se incorporaron sus notas útiles —incluidas las explicaciones finales de sesión y disponibilidad— en vez de descartarlas o restaurar la versión de Git.

El nuevo manual:

- Está en español y funciona offline, con estilos incluidos.
- Tiene navegación sticky, anclas, distribución responsive y estructura accesible.
- Incluye arquitectura, configuración, comandos de ambos paquetes, dominio, migraciones, imágenes, seguridad, despliegue, logs, diagnóstico y antecedentes.
- Corrige la explicación de sesión: el cookie lleva un token, no los datos del usuario.
- Distingue carrito local, disponibilidad y reserva real de stock.
- No presenta ejemplos de pagos/webhooks como una integración existente.
- No promete desarchivado disponible ni entrega durable de logs.
- Precisa el orden de trazas en la UI, el build de Render y el papel de las variables públicas frente a los secretos.
- Distingue registros históricos de pruebas remotas de las verificaciones locales realizadas en esta intervención.
- Documenta las correcciones nuevas y sus limitaciones, sin publicar credenciales.
- Explica que no todas las auditorías contienen una copia completa del antes/después.

**Justificación:** una sola fuente de documentación operativa, sin guías duplicadas que se contradigan.

### 11.2. Instrucciones del repositorio

Archivo: `AGENTS.md`.

- Se actualizaron los enlaces que apuntaban al README/guía de Render eliminados.
- Se amplió la descripción de lo que cubren los tests frontend.
- Se conservaron las instrucciones operativas y las restricciones de seguridad.

**Justificación:** `AGENTS.md` es el archivo de instrucciones para agentes, no una guía de usuario que convenga eliminar junto con los documentos consolidados.

### 11.3. Informe de arquitectura fuera del repositorio

Se creó y abrió este informe HTML de revisión:

```text
C:\Users\londa\AppData\Local\Temp\opencode\architecture-review-20261016-193907.html
```

Incluye diagramas antes/después, archivos involucrados, problemas, propuestas, beneficios, fuerza de recomendación y una recomendación principal. Fue actualizado con los hallazgos backend posteriores.

**Justificación:** separar propuestas de evolución de los cambios ya implementados y no incorporar un informe temporal al manual de funcionamiento. A diferencia del manual offline, sus diagramas/estilos avanzados usan Tailwind y Mermaid por CDN.

## 12. Migraciones y restos de MySQL

### 12.1. Migraciones activas conservadas

No se borró ni editó ninguna de las cinco migraciones PostgreSQL activas:

| Migración | Por qué sigue siendo necesaria |
| --- | --- |
| `20261012000000_postgresql_init` | Crea la estructura inicial PostgreSQL del dominio. |
| `20261012000100_backend_security` | Configura grupo técnico, permisos, RLS y restricciones de integridad. |
| `20261012000200_foreign_key_indexes` | Agrega índices de claves foráneas que PostgreSQL no crea implícitamente. |
| `20261013000000_storage_media` | Introduce la estructura/transición de medios usada por Storage y mantiene sus protecciones. |
| `20261013100000_log_system` | Crea logs operativos, particiones, permisos y mantenimiento no representados en Prisma. |

**Justificación:** sirven para reconstruir el estado actual y son historia de despliegue, no basura por haber sido aplicadas. Las pruebas existentes las aplican en PostgreSQL aislado en memoria y verifican su resultado.

### 12.2. Historial MySQL conservado, no soporte activo

Se conservaron:

- `server/prisma/history/mysql/20260810000000_init/migration.sql`.
- `server/prisma/history/mysql/migration_lock.toml`.

**Justificación:** documentan el origen y sirven para recuperación/comparación; las instrucciones del repositorio exigen preservar ese historial. No forman parte del directorio activo de migraciones ni reintroducen un cliente MySQL en el runtime.

También se conservaron referencias que cumplen una función vigente:

- Casos de prueba que verifican el rechazo de URLs MySQL.
- Redacción de credenciales en URLs MySQL dentro del logger.
- Comentarios históricos de migraciones ya aplicadas.

**Motivo:** borrar la palabra “MySQL” indiscriminadamente habría eliminado defensas o modificado historia válida, sin simplificar el runtime.

## 13. Pruebas y verificaciones

### 13.1. Nuevos archivos de tests

| Archivo | Pruebas nuevas | Qué comprueba |
| --- | ---: | --- |
| `test/cart.test.js` | 6 | Carrito corrupto, cantidades, precio de variante/cero, stock, inmutabilidad y retiro de cantidades confirmadas. |
| `test/management.test.js` | 4 | Parser de stock: vacío, cero explícito, rangos y rechazo de coerciones de tipos. |
| `test/whatsapp.test.js` | 3 | Mensaje, claves similares al prototipo y codificación de URL/teléfono. |
| `test/documentation.test.js` | 1 | Un único HTML operativo en docs, navegación válida, anclas no duplicadas, enlaces locales existentes y ausencia de scripts/dependencias de estilo remotas. |
| `server/test/admin-audit.test.js` | 5 | Cambio y auditoría juntos; fallo de auditoría no confirma el cambio; respuesta/hash de STAFF. |
| `server/test/catalog.test.js` | 15 | Filtros públicos/admin, relaciones, respuestas y coordinación transaccional de cinco escrituras. |
| `server/test/order-safety.test.js` | 28 | Archivo por estado, fallos intermedios, intercalado con reapertura, desbordes, límites válidos y filtros de compra. |
| `server/test/express-errors.test.js` | 1 | Rechazos async nativos a través de HTTP y manejo central de errores/trazas. |
| `server/test/prisma-config.test.js` | 2 | Compatibilidad de configuración Prisma y corrección de mezcla de grafos circulares. |

Son **65 pruebas nuevas**: la base pasó de 13 a 27 frontend y de 54 a 105 backend, para **132 pruebas finales** entre ambos paquetes.

### 13.2. Comandos ejecutados y entorno

- Tests de ambos paquetes desde sus directorios correspondientes.
- Build frontend con Vite.
- `npm audit --json` en ambos paquetes; resultado final sin avisos en esa consulta.
- Prisma `validate` y `generate`, con URLs de prueba sobrescritas y sin conexión a una base real.
- `git diff --check`, sin errores de whitespace; Git mostró advertencias de conversión LF/CRLF del entorno Windows.
- Repetición de tests y build con Node **22.23.3**, versión fijada para el servidor, mediante `npm exec --yes --package=node@22.23.3 -- node ...`.

**Aclaraciones de entorno:** el Node predeterminado de la máquina era 22.11.0. La ejecución temporal de 22.23.3 no actualizó la instalación global. PowerShell bloqueaba `npm.ps1`; se usó `npm.cmd`, sin cambiar la política de ejecución del sistema.

Persisten advertencias informativas ya observadas: configuración `package.json#prisma` deprecada de cara a Prisma 7 y directivas `use client` de React Router ignoradas por Vite. No impidieron las verificaciones y no se hizo una migración mayor para eliminarlas.

### 13.3. Comprobaciones en navegador local

Se inició temporalmente Vite y se probaron las interacciones con métodos de transporte simulados:

1. Dos clics rápidos en confirmar produjeron una sola llamada de creación; apareció el número del pedido y el enlace WhatsApp, y se retiraron las piezas enviadas.
2. Enter sobre campos vacíos de stock individual/lote produjo cero llamadas de ajuste.
3. Una respuesta de Pedidos resuelta después de cambiar a Inventario no sustituyó los datos de Inventario.

El servidor de desarrollo iniciado para esas comprobaciones fue detenido al terminar.

**Límites de evidencia:**

- No se crearon pedidos ni se ajustó stock en producción.
- Los tests nuevos de coordinación, rollback e intercalado usan dobles Prisma/adapters en memoria. Verifican el código y sus transacciones, no el motor real de bloqueos concurrentes de PostgreSQL.
- Las pruebas SQL existentes sí ejecutan las migraciones en PGlite aislado; no utilizan la base configurada.
- Las pruebas de navegador fueron locales y no sustituyen el recorrido desplegado completo navegador → Vercel → Render → Supabase.
- Ausencia de avisos npm no equivale a una auditoría de seguridad exhaustiva.

## 14. Propuestas y decisiones pendientes

Estas cuestiones **no se implementaron** ni deben confundirse con cambios terminados:

### 14.1. Reglas comerciales que requieren definición

1. **Recotización de envío al editar artículos.** Actualmente se conserva el envío anterior aunque cambie el peso. No se cambió porque podría ser un precio ya acordado; hay que decidir la regla.
2. **Vencimiento de reservas invitadas.** No se agregó caducidad ni cancelación automática. Requiere definir plazo, comunicación y conciliación.
3. **Idempotencia y recuperación durable.** La defensa de Checkout vale durante el montaje. No se agregó clave de idempotencia ni recuperación de un POST cuya respuesta se perdió.

### 14.2. Candidatos del informe arquitectónico

1. **Profundizar el module Carrito:** concentrar catálogo vigente, reconciliación y persistencia en una interface con mayor depth, locality y leverage; no agregar una seam o adapter hipotéticos. La validación aplicada es un avance acotado, no esa reestructuración completa.
2. **Consultas administrativas por concepto:** dar locality a cargas, errores, mutaciones y reconciliación en cada module; mantener el adapter HTTP existente y una interface clara, sin una seam genérica innecesaria. No se dividió Management por completo.
3. **Confirmación de Pedido:** profundizar el module que concentra resultado incierto y recuperación, con su interface/seam respaldada por necesidades reales y adapters existentes; buscar leverage sin introducir todavía un rediseño o schema nuevo.

No se implementaron tampoco una caché compartida del catálogo, carga diferida por rutas, reescritura del polling/paginación de LogsPanel, ni una revisión integral de accesibilidad de los diálogos. La revisión no debe interpretarse como garantía de haber corregido todo posible defecto futuro.

## 15. Inventario de archivos

Esta lista permite ubicar los cambios sin reconstruir qué subagente los realizó.

### 15.1. Archivos creados

| Archivo | Propósito |
| --- | --- |
| `docs/documentacion.html` | Manual operativo consolidado. |
| `src/utils/cart.js` | Reglas puras del carrito y retiro de cantidades confirmadas. |
| `src/utils/inventory.js` | Parser compartido de cantidades de inventario. |
| `test/cart.test.js` | Regresiones del carrito. |
| `test/documentation.test.js` | Integridad del HTML documental. |
| `test/management.test.js` | Reglas de entrada de stock. |
| `test/whatsapp.test.js` | Mensajes y URL de WhatsApp. |
| `server/test/admin-audit.test.js` | Atomicidad de cambios administrativos y auditoría. |
| `server/test/catalog.test.js` | Filtros, relaciones y escrituras del catálogo. |
| `server/test/express-errors.test.js` | Manejo de rechazos nativos en Express 5. |
| `server/test/order-safety.test.js` | Archivo atómico y límites aritméticos. |
| `server/test/prisma-config.test.js` | Compatibilidad del override transitivo. |
| `CAMBIOS-REVISION.md` | Este registro solicitado posteriormente. |

Además, el informe HTML arquitectónico se creó en la carpeta temporal indicada, fuera del repositorio.

### 15.2. Archivos modificados

| Archivo | Cambio relevante |
| --- | --- |
| `AGENTS.md` | Referencias documentales y descripción de tests. |
| `package.json` | Retiro del plugin React no configurado. |
| `package-lock.json` | Resolución tras retirar esa dependencia. |
| `server/package.json` | Override acotado de deepmerge-ts. |
| `server/package-lock.json` | Versión/resolución de la dependencia corregida. |
| `src/App.jsx` | Retiro de import lateral sin efectos. |
| `src/components/BuilderModalButton.jsx` | Talles dinámicos, precio por variante, disponibilidad y estado vacío. |
| `src/hooks/useCart.js` | Saneamiento, reglas compartidas, retiro parcial y menor interface pública. |
| `src/hooks/useCatalog.js` | Retiro del campo sin uso usingApi. |
| `src/pages/Checkout.jsx` | Hooks, confirmación, doble envío, enlace WhatsApp e invalidación de envío. |
| `src/pages/Home.jsx` | Desestructuraciones sin uso. |
| `src/pages/Management.jsx` | Validación de stock y control de respuestas obsoletas. |
| `src/services/api.js` | Retiro de dos helpers de logs sin consumidores. |
| `src/styles.css` | Retiro de selectores obsoletos. |
| `src/utils/whatsapp.js` | Map, URL pura y retiro del popup/helper antiguo. |
| `server/src/controllers/admin.controller.js` | Auditoría atómica, async nativo y mensaje corregido. |
| `server/src/controllers/auth.controller.js` | Async nativo sin wrapper. |
| `server/src/controllers/catalog.controller.js` | Actividad consistente, auditoría atómica, relaciones, async nativo y mensajes corregidos. |
| `server/src/controllers/logs.controller.js` | Async nativo sin wrapper. |
| `server/src/controllers/media.controller.js` | Async nativo; conservado finally de liberación del cupo de upload. |
| `server/src/controllers/order.controller.js` | Async nativo y formato legible. |
| `server/src/controllers/public.controller.js` | Async nativo sin wrapper. |
| `server/src/lib/logger.js` | Retiro de exports sin consumidores; conservadas reglas y destinos de logging. |
| `server/src/lib/security.js` | Retiro de digitsOnly sin consumidores. |
| `server/src/services/order.service.js` | Implementación transaccional interna, archivo atómico, límites y filtros activos. |

### 15.3. Archivos eliminados

| Archivo | Motivo |
| --- | --- |
| `docs/logs-guia.html` | Integrado en el HTML único. |
| `docs/render-guia.html` | Integrado en el HTML único. |
| `server/README.md` | Integrado, incluidas las notas locales útiles del usuario. |
| `server/prisma/history/README.md` | Explicación histórica integrada en el HTML único. |
| `server/src/lib/async-handler.js` | Redundante con Express 5; consumidores convertidos y comportamiento probado. |

## 16. Operaciones que no se realizaron

- No se aplicaron migraciones a bases remotas ni se modificó `schema.prisma`.
- No se borró ni editó ninguna migración SQL activa o histórica.
- No se ejecutaron seed, reset, db push ni migraciones de datos reales.
- No se alteraron credenciales, archivos `.env`, roles remotos o secretos de hosting.
- No se desplegó, promovió ni revirtió Vercel/Render.
- No se cambió el esquema de IP confiable ni se relajó el secreto del proxy.
- No se borraron ni sobrescribieron imágenes de Storage o snapshots de pedidos.
- No se sustituyeron sesiones propias por Supabase Auth.
- No se actualizaron Prisma, React o el framework a una nueva versión mayor.
- No se crearon commits, ni se restauraron o descartaron cambios ajenos.
- `.agents/`, `.opencode/` y `skills-lock.json` ya estaban sin seguimiento al comenzar: no son archivos de aplicación creados o limpiados por esta intervención y se dejaron intactos.

**Conclusión:** la intervención combina correcciones funcionales y de seguridad verificables, reducción de código sin uso y documentación consolidada. Las decisiones comerciales y las refactorizaciones grandes quedan explícitamente separadas para no presentarlas como resueltas.
