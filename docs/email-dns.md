# DNS del correo de verificación

Servicio real: Resend, plan gratuito, vinculado solo al proyecto de staging.
Dominio de envío: `send.ferchumodas.shop`.
El 16/11/2026, después de que el propietario añadiera los registros, Resend
confirmó dominio y los tres registros con estado `verified`.

La zona utiliza `dns1.registrar-servers.com` y `dns2.registrar-servers.com`.
Los registros no se administran actualmente desde Vercel.

Estos son los **tres registros nuevos devueltos por Resend para este dominio**.
Añadirlos en el proveedor DNS autoritativo, sin modificar registros existentes,
nameservers, web, MX ni configuración del dominio principal.

| Tipo | Host relativo a ferchumodas.shop | Valor | TTL |
|---|---|---|---|
| TXT | `resend._domainkey.send` | Clave pública DKIM de abajo | Automático |
| CNAME | `rsend.send` | `rsend.forge.rmta.net` | Automático |
| CNAME | `send.send` | `send.forge.rmta.net` | Automático |

Valor TXT DKIM (es **público**, no es una contraseña ni una clave privada):

```text
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgB/jTF7DZERijWr6yT/ga/unL1EmK5D3vxUh1TK2Ho1QURJGZgA5Bgd3861cs29yFM1g8bOUs2/CwuDIGbrqwvXVBRCVpvsou1FAfDX78w59P2ywHHRt30jgntYs6rwEt4MD3bmTtmYba5GSTux5ydkALBGUWSuQG/BD5j+55fwIDAQAB
```

Remitente previsto: `noreply@send.ferchumodas.shop`.
Dirección de respuesta: `ferchumodas461@gmail.com`.

No se añadieron estos registros automáticamente: los configuró el propietario.
La comprobación con Resend terminó correctamente. El 17/11/2026 (hora local),
el registro real desde staging respondió `202` y Resend confirmó `delivered`
para el único mensaje de prueba autorizado. El remitente fue
`noreply@send.ferchumodas.shop` y Reply-To `ferchumodas461@gmail.com`.
La confirmación humana de recepción y la finalización del enlace siguen
pendientes: el evento del proveedor no demuestra lectura ni ubicación en inbox.
