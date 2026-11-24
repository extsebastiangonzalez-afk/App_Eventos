# Lector de Ventas de Eventos

Web App de Google Apps Script que lee las ventas que comparten los clientes (fotos, PDF, Excel, CSV o texto pegado),
las cruza con el **EAN Master** y el **PDV Master**, identifica el evento en **Detalle eventos** y escribe las filas
en **PLANTILLA VENTAS EVENTOS (A:L)** del Sheet *Eventos Trade Marketing 2.0*.

## Qué hace en cada carga

1. **Lee el archivo**
   - Excel/CSV: se lee en el navegador; las columnas se detectan solas y se pueden corregir.
   - Foto (lector **"Por columnas (tabla)"**, el predeterminado): se lee **en el navegador** con Tesseract.js
     (`tesseract.js@5.1.1` desde jsDelivr; la imagen no sale del equipo). Cada palabra trae su posición, y con eso se
     rearman filas y columnas usando las líneas de la cuadrícula de las capturas de Excel o, si no hay, los espacios
     alineados. Antes se amplían las capturas pequeñas, se pasan a blanco y negro y se borra la cuadrícula.
     La tabla resultante pasa por el **mismo mapeo de columnas que un Excel**, con vista previa y fila de encabezados elegible.
     Si no se encuentra una tabla o el lector no carga, se usa el OCR de Google. El lector se elige en el paso 1
     y la elección se recuerda en ese navegador.
   - PDF, o foto con el lector "OCR de Google": OCR gratuito de Google Drive (o Claude, si se configura una clave; ver más abajo).
   - **Columnas que se detectan solas**:
     - **Código del cliente** (PLU, SKU…) y **EAN**: pueden venir las dos. Gana la columna con más valores *distintos*
       que existen en el EAN Master; una columna con el mismo valor en todas las filas, como el código del proveedor, no cuenta.
     - **Descripción**.
     - **Cantidad**: la columna "Cantidad/Unidades" o, si no, la columna de enteros pequeños más a la derecha; el COSTO con `$` no cuenta.
     - **PDV**, **Fecha** y **Evento**.
   - **Códigos mal leídos**: si un código o EAN no existe pero hay uno solo con un dígito distinto, de más, de menos o
     invertido, se usa ese. En el EAN, el dígito verificador o la descripción lo confirman (`8429420200885` → `8429420280885`).
   - Texto pegado (WhatsApp/correo).
2. **Detecta el cliente** según qué `Origin` del EAN Master tiene más códigos que coinciden
   (ejemplo: la foto de prueba da 23/23 → DERMORIENTE S.A.S).
3. **Cruza productos**, en este orden:
   código del cliente → EAN ISDIN → *alias aprendido* → nombre aproximado → revisión del usuario.
   **Nombre aproximado (Fuzzy Lookup)**: sirve también para fotos y archivos sin código, por ejemplo solo "Descripción | UDS". El nombre se compara
   contra el nombre oficial ISDIN y contra las descripciones de todos los clientes del EAN Master, **palabra por palabra y con todas las palabras**:
   - cada palabra pesa según qué tan rara es en el catálogo (WETSKIN o HYDROOIL pesan más que ISDIN o 50ML);
   - acepta recortes (`TRANSP` → TRANSPARENT), siglas (`WS` → WETSKIN) y errores de pocas letras;
   - las palabras que sobran en cualquiera de los dos nombres restan;
   - un tamaño o un SPF distinto (50ML ↔ 250ML) baja mucho el puntaje.
   Las filas `OMITIR` del Master se excluyen solas.
   En fotos y capturas, antes de armar las filas el lector entiende la estructura de la tabla:
   - descarta los **encabezados**, aunque estén recortados ("Ite", "Desc. item", "Cantidad inv");
   - descarta las **columnas de texto que se repiten** en todas las filas (p. ej. "ISDIN TENNIS");
   - reconoce **códigos numéricos cortos** (p. ej. `2395`) para no confundirlos con cantidades;
   - si el OCR juntó varias filas en una línea, **corta antes de cada código**;
   - sin códigos (solo "Descripción | UDS"), si juntó varios nombres en una línea, corta antes de la palabra con la que empiezan
     los productos (`ISDIN…`) y, si aún hay más cantidades que nombres, por la presentación ("X50ML ISDIN…").
     El borde de la celda pegado al nombre (`OISDIN`) se limpia.
   Si el OCR junta varios nombres en una fila, se separan solos: con la descripción del cliente que el EAN Master
   tiene para cada código, o, si no, por la presentación ("200 ML", "30G"). Si aun así queda alguno junto,
   el botón **✂ Separar** de la fila permite hacerlo a mano: *correr los nombres a las filas siguientes* o *crear filas nuevas*.
4. **Busca el evento** en *Detalle eventos*:
   - **Por el nombre del archivo o de la carpeta**, si trae el ID RESUMEN (`ACT-0123.jpg`, `act 123/IMG_2045.jpg`, `EVT_0004 ventas.xlsx`).
     El evento da el **cliente** (el Origin del EAN Master sale del SAP ID del PDV Master o, si no hay, del nombre), el **PDV** y las **fechas**,
     y queda preseleccionado. El ID se puede corregir en el paso 2. Si el nombre trae un ID que no existe, o un ID de un cliente distinto
     al de los códigos del archivo, la página avisa.
     Una carpeta puede traer varias fotos, PDF o tablas: se leen todas y se juntan las filas.
   - **Consolidados (varios eventos en un archivo)**: el ID RESUMEN de cada fila se lee de
     - una columna "ID RESUMEN" / "Evento" / "Actividad", o cualquier columna con valores `ACT-…`/`EVT-…`.
       Una celda vacía (celdas combinadas por PDV) toma el ID de la fila de arriba, y un número suelto (`123`) se cruza con los IDs del nombre del archivo;
     - filas-título "ACT-0123 · Droguería X" con sus productos debajo;
     - fotos: el ID en cada línea, como título de sección o en una columna leída aparte.
     Si una fila no trae ID, toma el de otra fila del mismo PDV. Cada evento sale en su propia tabla en el paso 3, con una fila **Total** de unidades
     para validar contra el archivo, y se carga con su propio ID. Un consolidado nunca se carga solo desde la carpeta.
   - Si no, por cliente (SAP ID del PDV Master), fechas y PDV.
   - El usuario elige entre los eventos candidatos, o
   - escribe un **ID RESUMEN** a mano, o
   - marca **evento no programado** → se genera un **ID artificial `MAN-0001`, `MAN-0002`…**
     que se registra en `LV_Eventos_Manuales`.
5. **Escribe en la PLANTILLA** las columnas
   MES, DIAS, ID RESUMEN, SOLICITANTE, CLIENTE, ISDIN PDV, TIPO DE EVENTO, EAN, PRODUCTO (nombre oficial ISDIN), UNITS, BU, DERMO.
   La BU sale de la tabla SUB FAMILIA (pestaña `PLANTILLA VENTAS EVENTOS_Backup`, columnas S:V).
6. **Aprende**: lo que el usuario corrige o confirma se guarda en `LV_Alias`, y la próxima vez se cruza solo.
   Cada carga queda registrada en `LV_Cargas`, con el rango escrito y una huella que detecta cargas duplicadas.

## Carpeta de ventas (bandeja)

Un Admin pega en la página el enlace de una carpeta de Drive donde el equipo va guardando las ventas
(fotos, PDF, Excel, CSV, Google Sheets), con el **ID RESUMEN en el nombre del archivo o de la subcarpeta**
(`ACT-0123.jpg`, `ACT-0123/IMG_2045.jpg`). La carpeta debe estar compartida con la cuenta que publicó el lector.

Al abrir la página (o con **↻ Revisar carpeta**) se lista cada archivo con su estado, guardado en `LV_Archivos`:

| Estado | Significa |
|---|---|
| PENDIENTE | Archivo nuevo, aún no procesado |
| CARGADO | Ya se cargó a la PLANTILLA desde este archivo (`LV_Cargas` guarda su ID y versión) |
| EVENTO YA CARGADO | El ID RESUMEN ya tiene filas en la PLANTILLA (por otro archivo o por una carga hecha a mano antes del lector) |
| MODIFICADO | El archivo cambió en Drive después de cargarlo |
| REVISAR / ERROR | La carga automática no lo cargó; el detalle dice por qué |
| IGNORADO / NO SOPORTADO | Marcado a mano / formato que no se puede leer (p. ej. Word, HEIC) |

- **Revisar y cargar**: abre el archivo en los pasos 1–5 de siempre.
- **⚡ Cargar automáticamente los que estén 100 % OK**: lee los PENDIENTES uno por uno y carga solos solo los que tienen
  ID RESUMEN válido, evento aprobado y **sin filas en la PLANTILLA**, cliente coherente con los códigos, un solo PDV y
  **todos los productos cruzados por código** (o aprendidos). Lo demás queda en REVISAR con el motivo.
- Un Admin puede activar **Revisar y cargar solo cada hora** (trigger), con las mismas reglas.

## Eventos del mes (tabla para el equipo)

Panel **📅 Eventos del mes**: se elige el mes y se genera una tabla con los eventos de "Detalle eventos" cuya FECHA INICIO
cae en ese mes, con las columnas MES, DIAS, ID RESUMEN, SOLICITANTE, CLIENTE, ISDIN PDV, TIPO DE EVENTO y DERMO.
Los eventos que ya tienen filas en la PLANTILLA **no se quitan: se resaltan en verde**. Por defecto no se incluyen los
RECHAZADOS ni los CANCELADOS (hay una casilla para incluirlos).
- **⬇ Descargar imagen**: PNG listo para enviar por chat o correo (`Eventos_NOVIEMBRE_2026.png`).
- **📋 Copiar imagen**: la copia al portapapeles para pegarla con Ctrl+V. Si el navegador no lo permite, la imagen
  queda en pantalla para usar clic derecho → Copiar o Guardar imagen.
- **⬇ Excel (con colores)**: `.xlsx` con los cargados en verde, columna **ESTADO** (Cargado / Falta cargar), encabezado fijo y filtros.
- **⬇ CSV**: separado por `;`. No guarda colores; el estado va en la columna ESTADO.

**Filtros** (después de generar la tabla):
- **Mostrar**: todos (cargados en verde), solo los que faltan o solo los ya cargados.
- **Clientes**: quita la marca de un cliente para sacarlo de la tabla, la imagen, el Excel y el CSV; hay buscador y botones
  *Mostrar todos* / *Quitar todos*. Los clientes quitados se recuerdan en ese navegador para los meses siguientes.

## Identidad visual

La página, la imagen y el Excel de "Eventos del mes" usan el
[manual de identidad visual ISDIN](https://github.com/williamcorrea-hash/manual-identidad-visual-ISDIN):
paleta neutra/durazno/arena, Montserrat (sustituta de Gotham) en títulos, Arial 12 px en tablas y el logotipo en SVG.

- `apps-script/Identidad.html` y `apps-script/Logo.html` son **copias** de `identidad.html` y `logo.html` del repositorio del manual.
  No se editan aquí.
- Para traer cambios del manual:
  ```powershell
  powershell -ExecutionPolicy Bypass -File tools\sync_identidad.ps1
  clasp push --force
  ```
  Después, actualiza la implementación (ver Despliegue). El script solo copia esos dos archivos y se niega a copiarlos
  si traen código ejecutable.
- `Index.html` solo usa los tokens del manual (`--ink`, `--chrome`, `--peach-70`, `--ok-fill`…). Si el manual cambia un color, cambia también en la app.
  La imagen y el Excel no pueden leer CSS: sus colores están escritos en `drawReport` y `buildXlsx` con los mismos HEX.

## Qué NO toca

- **EAN Master y PDV Master**: se leen descomprimiendo el `.xlsx` en memoria. Nunca se modifican, convierten ni copian.
  La hoja `Control`, que contiene contraseñas, nunca se lee ni se guarda en la caché.
- En el Sheet solo escribe en `PLANTILLA VENTAS EVENTOS` (agrega filas al final) y en sus propias pestañas `LV_*`.
  *Detalle eventos*, *Usuarios* y *_Backup* solo se leen.

## Despliegue (una sola vez, lo hace el dueño: sebastian.gonzalez@isdin.com)

1. ✅ **Hecho (2026-11-12):** el proyecto existe y el código está subido.
   - Editor: https://script.google.com/d/1U8kF__WYbV6xl4xnvWDHHqUJ7-iefhPolkmzzY63i_FUuGc4GzY_HQL0/edit
   - El proyecto está vinculado al Google Sheet **"Lector Ventas Eventos"**, que solo sirve de contenedor del código
     (los datos se leen y escriben en *Eventos Trade Marketing 2.0* mediante su ID).
     Así, quien edite el Sheet de eventos no puede ver ni cambiar el código. **No borres ese Sheet**: se borraría el script.
   - Para subir cambios: `clasp push` desde esta carpeta (usa `.clasp.json`).
2. En el editor de Apps Script, elige la función **`setup`** en el desplegable, pulsa *Ejecutar* y acepta los permisos.
   Esto crea las pestañas `LV_*`, lee los Master por primera vez (1–2 min) y programa la actualización diaria a las 6 a. m.
3. *Implementar → Nueva implementación → Aplicación web*:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona de ISDIN**
4. Agregar el correo de la persona que lo va a usar en la pestaña **Usuarios** (columna Correo; Rol `Usuario` o `Admin`).
   Solo `Admin` ve el botón "Actualizar Master".
5. Compartirle la URL de la aplicación web.

## Opcional: lectura de fotos con Claude

El OCR de Google funciona bien con capturas limpias como la del ejemplo. Para fotos difíciles (torcidas, borrosas o escritas a mano)
se puede activar Claude:
1. Conseguir una clave de la API de Anthropic.
2. En el editor, pegarla en la función `setClaudeKey`, ejecutarla una vez y luego borrarla del código
   (queda guardada en *Propiedades del script*).

Al activarla, la página muestra un selector "Lector de fotos". El costo es de céntimos de dólar por foto.

## Pruebas locales

```bash
python -I tests/dump_master_xml.py <carpeta_temporal_vacia>   # extrae en modo lectura el XML de los Master
node tests/test_core.js   <carpeta_temporal>                   # lógica: lectura xlsx, OCR, cruce, eventos, plantilla
node tests/test_server.js <carpeta_temporal>                   # servidor con Sheets/Drive simulados en memoria
```

## Archivos

| Archivo | Contenido |
|---|---|
| `apps-script/Core.gs` | Lógica pura (normalización, lector xlsx, OCR→filas, cruce, eventos, filas A:L). Se prueba con Node. |
| `apps-script/Server.gs` | Web App: acceso, caché de Master, OCR, cruce, escritura, aprendizaje. |
| `apps-script/Config.gs` | IDs, nombres de pestañas y carpetas. |
| `apps-script/Index.html` | Interfaz: archivo → cliente/fechas → productos → evento → vista previa → carga. |
| `apps-script/appsscript.json` | Permisos y configuración de la Web App (dominio ISDIN). |
