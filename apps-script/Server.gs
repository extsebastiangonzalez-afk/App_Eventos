/**
 * Server.gs — Web App (Apps Script) del Lector de Ventas de Eventos.
 *
 * Funciones llamables desde la página (google.script.run): api_*
 * Funciones para el editor (ejecutar a mano): setup, refreshMasters, setClaudeKey
 * Las funciones terminadas en "_" son internas.
 */

// ===================================================================== Web App

function doGet() {
  var user;
  try { user = authorize_(); }
  catch (e) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 16px">' +
      '<h2>Acceso no autorizado</h2><p>' + escapeHtml_(e.message) + '</p></div>')
      .setTitle('Lector de Ventas de Eventos');
  }
  var t = HtmlService.createTemplateFromFile('Index');
  t.userEmail = user.email;
  return t.evaluate()
    .setTitle('Lector de Ventas de Eventos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Incluye otro archivo HTML del proyecto en la plantilla (Identidad.html, Logo.html: manual de identidad ISDIN). */
function incluir_(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

// ===================================================================== Acceso

function ss_() { return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }

function authorize_() {
  var email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) throw new Error('No se pudo identificar tu cuenta de Google. Entra con tu cuenta ISDIN.');
  var sh = ss_().getSheetByName(CONFIG.TAB_USUARIOS);
  if (!sh) throw new Error('No existe la pestaña "' + CONFIG.TAB_USUARIOS + '".');
  var vals = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), 2).getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim().toLowerCase() === email) return { email: email, role: String(vals[i][1] || 'Usuario').trim() };
  }
  throw new Error('Tu cuenta (' + email + ') no está en la pestaña "Usuarios". Pide a un administrador que te agregue.');
}

// ===================================================================== Master (solo lectura) y caché

function findMasterFile_(name, propKey) {
  var id = PropertiesService.getScriptProperties().getProperty(propKey);
  if (id) return DriveApp.getFileById(id);
  var root = DriveApp.getFolderById(CONFIG.MASTERS_FOLDER_ID);
  var folders = root.getFoldersByName(CONFIG.MASTERS_SUBFOLDER);
  var folder = folders.hasNext() ? folders.next() : root;
  var files = folder.getFilesByName(name);
  if (!files.hasNext()) throw new Error('No se encontró "' + name + '" en la carpeta ' + CONFIG.MASTERS_SUBFOLDER + '.');
  var f = files.next();
  PropertiesService.getScriptProperties().setProperty(propKey, f.getId());
  return f;
}

/**
 * Lee hojas de un .xlsx descomprimiéndolo en memoria. El archivo original no se toca
 * y no se crea ninguna copia (así la hoja "Control" con contraseñas nunca se duplica).
 */
function readXlsxSheets_(file, sheetCols) {
  var parts = Utilities.unzip(file.getBlob().setContentType('application/zip'));
  var byName = {};
  parts.forEach(function (b) { byName[b.getName()] = b; });
  var txt = function (n) { return byName[n] ? byName[n].getDataAsString('UTF-8') : ''; };
  var paths = Core.xlsxSheetPaths(txt('xl/workbook.xml'), txt('xl/_rels/workbook.xml.rels'));
  var shared = Core.xlsxSharedStrings(txt('xl/sharedStrings.xml'));
  var out = {};
  Object.keys(sheetCols).forEach(function (name) {
    var p = paths[name];
    if (!p || !byName[p]) throw new Error('El archivo ' + file.getName() + ' no tiene la hoja "' + name + '".');
    out[name] = Core.xlsxSheetRows(txt(p), shared, sheetCols[name]);
  });
  return out;
}

/** Relee los Master y guarda una caché compacta. Se ejecuta a diario (trigger) o desde la página. */
function refreshMasters() {
  var ean = readXlsxSheets_(findMasterFile_(CONFIG.EAN_MASTER_NAME, 'EAN_MASTER_ID'), CONFIG.EAN_SHEETS);
  var pdv = readXlsxSheets_(findMasterFile_(CONFIG.PDV_MASTER_NAME, 'PDV_MASTER_ID'), CONFIG.PDV_SHEETS);
  var cache = Core.buildMasterCache({ Master_EAN: ean.Master_EAN, Master_Puntos: pdv.Master_Puntos, BD: pdv.BD, MAESTRO_PDV: pdv.MAESTRO_PDV });
  if (cache.ean.length < 1000 || cache.puntos.length < 1000) {
    throw new Error('Lectura de Master sospechosa (EAN: ' + cache.ean.length + ', PDV: ' + cache.puntos.length + '). No se actualizó la caché.');
  }
  saveCache_(cache);
  return { ean: cache.ean.length, puntos: cache.puntos.length, refreshedAt: cache.refreshedAt };
}

function saveCache_(cache) {
  var json = JSON.stringify(cache);
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CACHE_FILE_ID');
  var file = null;
  if (id) { try { file = DriveApp.getFileById(id); if (file.isTrashed()) file = null; } catch (e) { file = null; } }
  if (file) file.setContent(json);
  else {
    file = DriveApp.createFile(CONFIG.CACHE_FILE_NAME, json, MimeType.PLAIN_TEXT);
    props.setProperty('CACHE_FILE_ID', file.getId());
  }
  putChunked_('masters', json);
}

var CHUNK = 45000;
function putChunked_(key, json) {
  var c = CacheService.getScriptCache(), obj = {}, n = Math.ceil(json.length / CHUNK);
  for (var i = 0; i < n; i++) obj[key + '_' + i] = json.substr(i * CHUNK, CHUNK);
  obj[key + '_n'] = String(n);
  try { c.putAll(obj, 21600); } catch (e) { /* la caché es solo una optimización */ }
}
function getChunked_(key) {
  var c = CacheService.getScriptCache(), n = +(c.get(key + '_n') || 0);
  if (!n) return null;
  var keys = []; for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = c.getAll(keys), parts = [];
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; parts.push(got[keys[j]]); }
  return parts.join('');
}

var _masters = null;
function getMasters_() {
  if (_masters) return _masters;
  var json = getChunked_('masters');
  if (!json) {
    var id = PropertiesService.getScriptProperties().getProperty('CACHE_FILE_ID');
    if (id) { try { json = DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'); putChunked_('masters', json); } catch (e) { json = null; } }
  }
  if (!json) { refreshMasters(); json = getChunked_('masters') || DriveApp.getFileById(PropertiesService.getScriptProperties().getProperty('CACHE_FILE_ID')).getBlob().getDataAsString('UTF-8'); }
  _masters = JSON.parse(json);
  return _masters;
}

// ===================================================================== Datos del Sheet

function readBuTable_() {
  var sh = ss_().getSheetByName(CONFIG.TAB_BU);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(CONFIG.BU_RANGE + last).getValues().filter(function (r) { return r[3] !== '' && r[0] !== ''; });
}

function readAliases_() {
  var sh = ss_().getSheetByName(CONFIG.TAB_ALIAS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
}

function readEvents_() {
  var sh = ss_().getSheetByName(CONFIG.TAB_EVENTOS);
  var vals = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), Math.min(26, sh.getLastColumn())).getValues();
  return Core.parseEvents(vals);
}

var _idx = null;
function getIndex_() {
  if (!_idx) _idx = Core.buildIndex(getMasters_(), readBuTable_(), readAliases_());
  return _idx;
}

var LV_HEADERS = {
  LV_Alias: ['Tipo', 'Origin', 'Clave', 'Valor', 'Descripción', 'Usuario', 'Fecha', 'Texto original'],
  LV_Eventos_Manuales: ['ID_Artificial', 'Nombre evento', 'Cliente', 'Tipo evento', 'Fecha inicio', 'Fecha fin', 'Días', 'Creado por', 'Fecha creación', 'Archivo', 'ID carga'],
  LV_Cargas: ['ID carga', 'Fecha', 'Usuario', 'Archivo', 'Cliente', 'ID RESUMEN', 'Filas', 'Unidades', 'Rango PLANTILLA', 'Huella', 'ID archivo Drive', 'Versión archivo'],
  LV_Archivos: ['ID archivo Drive', 'Nombre', 'Ruta', 'Tipo', 'Versión', 'ID RESUMEN', 'Estado', 'Detalle', 'ID carga', 'Actualizado', 'Enlace']
};

function ensureTab_(name) {
  var ss = ss_(), sh = ss.getSheetByName(name), h = LV_HEADERS[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // Pestañas creadas con una versión anterior: agregar los encabezados nuevos al final
    var cur = sh.getRange(1, 1, 1, h.length).getValues()[0];
    if (cur.some(function (v, i) { return v === '' && h[i]; })) sh.getRange(1, 1, 1, h.length).setValues([h.map(function (x, i) { return cur[i] || x; })]).setFontWeight('bold');
  }
  return sh;
}

/** Filas/unidades ya cargadas en la PLANTILLA por ID RESUMEN (columna C y J). */
var _stats = null;
function plantillaStats_(fresh) {
  if (_stats && !fresh) return _stats;
  var sh = ss_().getSheetByName(CONFIG.TAB_PLANTILLA);
  var last = sh.getLastRow();
  var vals = last > 1 ? sh.getRange(2, 3, last - 1, 8).getValues().map(function (r) { return [r[0], r[7]]; }) : [];
  _stats = Core.plantillaStats(vals);
  return _stats;
}

// ===================================================================== API para la página

function api_bootstrap() {
  var user = authorize_();
  var idx = getIndex_();
  var catalog = Object.keys(idx.products).map(function (e) { var p = idx.products[e]; return { ean: e, producto: p.name, bu: p.bu || 'OTRO' }; })
    .sort(function (a, b) { return a.producto < b.producto ? -1 : 1; });
  var tipos = {};
  readEvents_().forEach(function (ev) { if (ev.tipo) tipos[ev.tipo.toUpperCase()] = 1; });
  return {
    user: user,
    catalog: catalog,
    origins: idx.originList,
    tipos: Object.keys(tipos).sort(),
    claude: !!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'),
    mastersRefreshedAt: getMasters_().refreshedAt,
    isAdmin: /admin/i.test(user.role),
    inbox: { folder: folderInfo_(), autoOn: autoTriggerOn_() }
  };
}

/**
 * Paso 1: extraer filas del archivo.
 * payload: { kind: 'image'|'pdf'|'table'|'text', name, mimeType, data(base64), rows(2D), text, map, engine }
 */
function api_extract(payload) {
  authorize_();
  return extractPayload_(payload);
}

function extractPayload_(payload) {
  var idx = getIndex_();
  if (payload.kind === 'table') {
    // headerRow elegido por el usuario: los encabezados salen de esa fila; map elegido: se respeta tal cual
    var det = Core.detectTable(payload.rows, idx, payload.headerRow != null ? Number(payload.headerRow) : null);
    if (payload.map) det.map = payload.map;
    var tr = Core.tableToRows(payload.rows, det);
    return { source: 'tabla', rows: tr.rows, dates: tr.dates, titleIds: tr.titleIds, table: { headers: det.headers, map: det.map, headerRow: det.headerRow, ncols: det.ncols }, text: '' };
  }
  if (payload.kind === 'text') {
    var p = Core.parseOcrText(payload.text || '');
    return { source: 'texto', rows: p.rows, dates: p.dates, text: payload.text };
  }
  // imagen o PDF
  var blob = payload.blob || Utilities.newBlob(Utilities.base64Decode(payload.data), payload.mimeType, payload.name);
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (key && payload.engine !== 'ocr') {
    var c = claudeExtract_(blob, key);
    return { source: 'claude', rows: c.rows, dates: c.dates, text: c.text };
  }
  var text = driveOcr_(blob);
  var parsed = Core.parseOcrText(text);
  return { source: 'ocr', rows: parsed.rows, dates: parsed.dates, text: text };
}

/** OCR gratuito de Google Drive: crea un Doc temporal, lee el texto y lo elimina. */
function driveOcr_(blob) {
  var f = Drive.Files.create({ name: 'LV_OCR_tmp_' + Date.now(), mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'es', fields: 'id' });
  try {
    return DocumentApp.openById(f.id).getBody().getText();
  } finally {
    try { Drive.Files.remove(f.id); } catch (e) { try { DriveApp.getFileById(f.id).setTrashed(true); } catch (e2) { } }
  }
}

/** Opcional: transcripción con Claude (solo si existe la propiedad ANTHROPIC_API_KEY). */
function claudeExtract_(blob, key) {
  var mime = blob.getContentType();
  var b64 = Utilities.base64Encode(blob.getBytes());
  var source = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
  var schema = {
    type: 'object', additionalProperties: false, required: ['rows', 'date_from', 'date_to'],
    properties: {
      date_from: { type: 'string', description: 'YYYY-MM-DD o vacío' },
      date_to: { type: 'string', description: 'YYYY-MM-DD o vacío' },
      rows: {
        type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['code', 'desc', 'qty', 'pdv'],
          properties: { code: { type: 'string' }, desc: { type: 'string' }, qty: { type: 'string' }, pdv: { type: 'string' } }
        }
      }
    }
  };
  var prompt = 'Transcribe la tabla de ventas de este documento. Una entrada por cada línea de producto. ' +
    'code: código de artículo del cliente tal como aparece (vacío si no hay). desc: nombre del producto tal como aparece. ' +
    'qty: unidades vendidas tal como aparecen. pdv: punto de venta/tienda de esa línea si el documento lo indica (o el general), si no vacío. ' +
    'date_from/date_to: periodo de ventas si es visible. No incluyas encabezados, líneas de grupo ni totales. No corrijas ni inventes valores.';
  var body = {
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: 8000,
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: schema } },
    messages: [{ role: 'user', content: [source, { type: 'text', text: prompt }] }]
  };
  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(body),
    headers: { 'x-api-key': key, 'anthropic-version': CONFIG.CLAUDE_API_VERSION, 'anthropic-beta': 'server-side-fallback-2026-07-01' }
  });
  var code = resp.getResponseCode();
  var json = JSON.parse(resp.getContentText());
  if (code !== 200) throw new Error('Claude respondió ' + code + ': ' + ((json.error && json.error.message) || ''));
  if (json.stop_reason === 'refusal') throw new Error('Claude no procesó este archivo. Prueba con el OCR de Google.');
  if (json.stop_reason === 'max_tokens') throw new Error('El documento es demasiado largo para una sola lectura. Divídelo en partes.');
  var textBlock = (json.content || []).filter(function (b) { return b.type === 'text'; })[0];
  var data = JSON.parse(textBlock.text);
  var rows = data.rows.map(function (r) {
    var o = { code: String(r.code || '').trim(), desc: String(r.desc || '').trim(), qty: Core.parseQty(r.qty) };
    if (r.pdv) o.pdvText = String(r.pdv).trim();
    return o;
  });
  return { rows: rows, dates: { from: data.date_from || '', to: data.date_to || '' }, text: JSON.stringify(data, null, 1) };
}

/**
 * Paso 2: detectar cliente, cruzar productos y buscar eventos.
 * req: { rows, origin (opcional), from, to }
 */
function api_match(req) {
  authorize_();
  return matchCore_(req);
}

function matchCore_(req) {
  var idx = getIndex_();
  var stats = plantillaStats_();
  var client = Core.detectClient(req.rows, idx, req.text || '');
  var events = readEvents_();
  // ID RESUMEN en el nombre del archivo o de la carpeta → evento, cliente, PDV y fechas
  var hit = req.idHint ? Core.findIdInName(req.idHint, events) : null;
  var hitEv = hit && hit.ev;
  var nameEvs = (hit && hit.evs) || [];
  // Consolidado: cada fila puede traer su evento (columna, fila-título o línea del OCR)
  var resolveEv = Core.eventResolver(events, nameEvs);
  var pdvKeyOf = function (r) { return r.pdvCode ? 'C:' + Core.canonCode(r.pdvCode) : (r.pdvText ? 'T:' + Core.normText(r.pdvText) : '_'); };
  var rowEv = req.rows.map(function (r) { return r.eventId ? resolveEv(r.eventId) : null; });
  if (rowEv.some(Boolean)) {
    // filas sin ID del mismo PDV que otra que sí lo trae → mismo evento
    var evByPdv = {};
    req.rows.forEach(function (r, i) { var k = pdvKeyOf(r); if (rowEv[i] && k !== '_' && !evByPdv[k]) evByPdv[k] = rowEv[i]; });
    req.rows.forEach(function (r, i) { if (!rowEv[i]) rowEv[i] = evByPdv[pdvKeyOf(r)] || null; });
  }
  var rowEvents = [];
  rowEv.forEach(function (x) { if (x && x.ev && rowEvents.indexOf(x.ev) < 0) rowEvents.push(x.ev); });
  var mainEv = hitEv || rowEvents[0] || null;
  var evOrigin = mainEv ? Core.originForEvent(mainEv, idx) : { origin: '', method: '' };
  var origin = req.origin || evOrigin.origin || client.best;
  if (!req.from && rowEvents.length) {
    req.from = rowEvents.map(function (e) { return e.inicio; }).filter(Boolean).sort()[0] || '';
    req.to = rowEvents.map(function (e) { return e.fin || e.inicio; }).filter(Boolean).sort().pop() || req.from;
  } else if (hitEv && !req.from) { req.from = hitEv.inicio; req.to = hitEv.fin; }
  // Si el OCR juntó nombres en una fila y corrió los demás, reacomodarlos con las descripciones del EAN Master
  var ra = Core.realignDescs(req.rows, origin, idx);
  var products = ra.rows.map(function (r, i) {
    var m = Core.matchProduct(r, origin, idx);
    m.i = i;
    var parts = Core.splitByUnits(m.desc);
    if (parts.length > 1) m.descParts = parts;
    var re = rowEv[i];
    m.groupKey = re ? 'E:' + re.id : pdvKeyOf(r);
    if (re) m.eventId = re.id;
    return m;
  });
  var clienteAlias = (idx.alias['CLIENTE|' + origin + '|'] || {}).valor || '';
  var groups = {}, order = [];
  products.forEach(function (p) {
    if (!groups[p.groupKey]) {
      var re = rowEv[p.i];
      groups[p.groupKey] = { key: p.groupKey, pdvText: p.pdvText || '', pdvCode: p.pdvCode || '', rows: [], eventId: re ? re.id : '', ev: re ? re.ev : null };
      order.push(p.groupKey);
    }
    groups[p.groupKey].rows.push(p.i);
  });
  var full = { score: 1, clientScore: 1, dateScore: 1, pdvScore: 1 };
  var usedByRows = {};
  order.forEach(function (k) { if (groups[k].ev) usedByRows[groups[k].ev.idResumen] = 1; });
  var outGroups = order.map(function (k) {
    var g = groups[k], gev = g.ev;
    delete g.ev;
    var pdv = (g.pdvText || g.pdvCode) ? Core.resolvePdv(origin, g.pdvCode, g.pdvText, idx) : null;
    var cands = Core.matchEvents({
      origin: origin, from: gev ? gev.inicio : req.from, to: gev ? (gev.fin || gev.inicio) : (req.to || req.from), clienteAlias: clienteAlias,
      pdvText: pdv && pdv.isdinDesc ? pdv.isdinDesc : (g.pdvText || (gev ? gev.pdv || gev.pdvManual : '')), pdvIds: pdv && pdv.cuentaId ? [pdv.cuentaId] : []
    }, events, idx, 12);
    g.label = g.pdvText || g.pdvCode || 'Todo el archivo';
    g.pdv = pdv;
    g.candidates = cands.map(function (c) { return candOut_(c.ev, c, false, stats); });
    var first = function (ev) {
      g.candidates = [candOut_(ev, full, true, stats)].concat(g.candidates.filter(function (c) { return c.idResumen !== ev.idResumen; }));
    };
    if (g.eventId) {
      // El evento viene escrito en las filas del archivo
      if (gev) { first(gev); g.fromName = gev.idResumen; g.fromRows = true; g.evInfo = candOut_(gev, full, true, stats); }
      else g.notFoundId = g.eventId;
      var evPdv = gev ? (gev.pdv || gev.pdvManual || '') : '', filePdv = g.pdvText || g.pdvCode || '';
      g.label = g.eventId + (evPdv ? ' · ' + evPdv : '') + (filePdv && Core.normText(filePdv) !== Core.normText(evPdv) ? ' (' + filePdv + ')' : '');
    } else if (nameEvs.length) {
      // Eventos del nombre del archivo: van primero; con varios, se preselecciona el del PDV más parecido
      var pool = nameEvs.filter(function (e) { return !usedByRows[e.idResumen]; });
      if (!pool.length) pool = nameEvs;
      var pick = pool[0];
      var gp = pdv && pdv.isdinDesc ? pdv.isdinDesc : g.pdvText;
      if (pool.length > 1 && gp) {
        var bs = -1;
        pool.forEach(function (e) { var s = Core.similarity(gp, e.pdv || e.pdvManual || ''); if (s > bs) { bs = s; pick = e; } });
      }
      pool.slice().reverse().forEach(function (e) { if (e !== pick) first(e); });
      first(pick);
      g.fromName = pick.idResumen;
    }
    return g;
  });
  var idFromName = null;
  if (hitEv) {
    idFromName = { idResumen: hitEv.idResumen, cliente: hitEv.cliente, pdv: hitEv.pdv || hitEv.pdvManual, inicio: hitEv.inicio, fin: hitEv.fin,
      tipo: hitEv.tipo, estado: hitEv.estado, origin: evOrigin.origin, originMethod: evOrigin.method, others: hit.others,
      codesOrigin: client.best, conflict: !!(client.best && evOrigin.origin && client.best !== evOrigin.origin),
      enPlantilla: stats[hitEv.idResumen.toUpperCase()] || null };
  } else if (hit && hit.notFound) {
    idFromName = { notFound: hit.notFound };
  }
  return { client: { best: client.best, ranking: client.ranking, totalCodes: client.totalCodes, selected: origin }, products: products, groups: outGroups,
    realigned: ra.changed, idFromName: idFromName, from: req.from || '', to: req.to || '' };
}

function candOut_(e, c, fromName, stats) {
  return { idResumen: e.idResumen, idEvento: e.idEvento, pdv: e.pdv || e.pdvManual, cliente: e.cliente, inicio: e.inicio, fin: e.fin, tipo: e.tipo, estado: e.estado,
    solicitante: e.solicitante, score: c.score, clientScore: c.clientScore, dateScore: c.dateScore, pdvScore: c.pdvScore, fromName: !!fromName,
    enPlantilla: (stats && stats[String(e.idResumen).toUpperCase()]) || null };
}

/** Cruza filas sueltas (p. ej. las que el usuario separó a mano). */
function api_matchRows(rows, origin) {
  authorize_();
  var idx = getIndex_();
  return (rows || []).map(function (r) {
    var m = Core.matchProduct(r, origin || '', idx);
    var parts = Core.splitByUnits(m.desc);
    if (parts.length > 1) m.descParts = parts;
    return m;
  });
}

/** Busca un ID RESUMEN escrito a mano. */
function api_lookupEvent(id) {
  authorize_();
  id = String(id || '').trim().toUpperCase();
  var ev = readEvents_().filter(function (e) { return e.idResumen.toUpperCase() === id; })[0];
  return ev ? { found: true, ev: ev } : { found: false };
}

/** Busca productos del catálogo ISDIN por texto (para el selector de la tabla). */
function api_searchProducts(text, origin) {
  authorize_();
  return Core.searchByName(text, getIndex_(), origin || '', 8);
}

/**
 * Paso 3: escribir en la PLANTILLA y aprender.
 * req: { fileName, origin, force, groups: [{ mode: 'evento'|'id_manual'|'no_programado', idResumen, manual: {nombre, tipo, from, to},
 *        pdvText, rows: [{ code, desc, qty, ean, omit, learn }] }] }
 */
function api_commit(req) {
  var user = authorize_();
  var r = commitCore_(req, user.email);
  if (r.ok && req.driveFileId) {
    setArchivo_(req.driveFileId, { estado: 'CARGADO', detalle: r.filas + ' filas · ' + r.eventos.map(function (e) { return e.id; }).join(', ') + ' · por ' + user.email, cargaId: r.cargaId });
  }
  return r;
}

/** Escribe en la PLANTILLA. La usan la página (api_commit) y la carga automática de la carpeta. */
function commitCore_(req, email) {
  var user = { email: email };
  var idx = getIndex_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var events = readEvents_();
    var evById = {};
    events.forEach(function (e) { evById[e.idResumen.toUpperCase()] = e; });
    var cargas = ensureTab_(CONFIG.TAB_CARGAS);
    var manuales = ensureTab_(CONFIG.TAB_MANUALES);
    var cargasVals = cargas.getLastRow() > 1 ? cargas.getRange(2, 1, cargas.getLastRow() - 1, 10).getValues() : [];
    var manualIds = manuales.getLastRow() > 1 ? manuales.getRange(2, 1, manuales.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
    var cargaId = 'C-' + Utilities.formatDate(new Date(), 'America/Bogota', 'yyyyMMdd-HHmmss');
    var plan = [], warnings = [];

    req.groups.forEach(function (g, gi) {
      // Productos: se recalculan nombre y BU en el servidor desde el EAN elegido
      var prods = g.rows.map(function (r) {
        if (r.omit) return { omit: true };
        var ean = Core.canonCode(r.ean);
        if (!idx.products[ean]) throw new Error('Grupo ' + (gi + 1) + ': el EAN "' + r.ean + '" (' + (r.desc || r.code) + ') no está en el catálogo ISDIN.');
        var qty = Number(r.qty);
        if (!isFinite(qty)) throw new Error('Grupo ' + (gi + 1) + ': cantidad no válida para ' + (r.desc || r.code) + '.');
        var pi = Core.productInfo(idx, ean);
        return { ean: ean, producto: pi.producto, bu: pi.bu, qty: qty };
      });

      var ev = null, manual = null;
      if (g.mode === 'evento' || g.mode === 'id_manual') {
        var id = String(g.idResumen || '').trim().toUpperCase();
        if (!id) throw new Error('Grupo ' + (gi + 1) + ': falta el ID RESUMEN.');
        ev = evById[id] || null;
        if (!ev) {
          if (g.mode === 'evento') throw new Error('El evento ' + id + ' ya no existe en "Detalle eventos".');
          if (!g.manual || !g.manual.nombre) throw new Error('Grupo ' + (gi + 1) + ': el ID ' + id + ' no está en "Detalle eventos". Escribe el nombre del evento.');
          manual = { id: id, nombre: g.manual.nombre, tipo: g.manual.tipo, from: g.manual.from, to: g.manual.to, cliente: g.manual.cliente || req.origin, solicitante: user.email, registrar: true };
        }
      } else if (g.mode === 'no_programado') {
        if (!g.manual || !g.manual.nombre) throw new Error('Grupo ' + (gi + 1) + ': escribe el nombre del evento.');
        var newId = Core.nextManualId(manualIds, CONFIG.MANUAL_ID_PREFIX);
        manualIds.push(newId);
        manual = { id: newId, nombre: g.manual.nombre, tipo: g.manual.tipo, from: g.manual.from, to: g.manual.to, cliente: g.manual.cliente || req.origin, solicitante: user.email, registrar: true };
      } else throw new Error('Grupo ' + (gi + 1) + ': elige un evento.');

      var rows = Core.buildTemplateRows(prods, ev, manual);
      if (!rows.length) return;
      var idRes = ev ? ev.idResumen : manual.id;
      var huella = md5_(idRes + '|' + rows.map(function (r) { return r[7] + ':' + r[9]; }).sort().join(','));
      var dup = cargasVals.filter(function (c) { return c[9] === huella; })[0];
      if (dup && !req.force) warnings.push('Ya se cargaron estas mismas ventas para ' + idRes + ' (carga ' + dup[0] + ' del ' + dup[1] + ' por ' + dup[2] + ').');
      plan.push({ g: g, ev: ev, manual: manual, rows: rows, idRes: idRes, huella: huella });
    });

    if (warnings.length) return { ok: false, duplicate: true, warnings: warnings };
    if (!plan.length) throw new Error('No hay filas para cargar.');

    // Escritura en la PLANTILLA (A:L)
    var sh = ss_().getSheetByName(CONFIG.TAB_PLANTILLA);
    var all = [];
    plan.forEach(function (p) { all = all.concat(p.rows); });
    var start = sh.getLastRow() + 1;
    var need = start + all.length - 1 - sh.getMaxRows();
    if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
    sh.getRange(start, 1, all.length, 12).setValues(all);

    // Registro de cargas y eventos manuales
    var now = new Date(), r0 = start, logRows = [], manRows = [];
    plan.forEach(function (p) {
      var units = p.rows.reduce(function (s, r) { return s + (Number(r[9]) || 0); }, 0);
      logRows.push([cargaId, now, user.email, req.fileName || '', p.rows[0][4], p.idRes, p.rows.length, units, 'A' + r0 + ':L' + (r0 + p.rows.length - 1), p.huella,
        req.driveFileId || '', req.driveVersion || '']);
      r0 += p.rows.length;
      if (p.manual && p.manual.registrar) {
        manRows.push([p.manual.id, p.manual.nombre, p.manual.cliente, p.manual.tipo || '', p.manual.from || '', p.manual.to || '', Core.diasEntre(p.manual.from, p.manual.to), user.email, now, req.fileName || '', cargaId]);
      }
    });
    cargas.getRange(cargas.getLastRow() + 1, 1, logRows.length, logRows[0].length).setValues(logRows);
    if (manRows.length) manuales.getRange(manuales.getLastRow() + 1, 1, manRows.length, manRows[0].length).setValues(manRows);

    var learned = learn_(req, plan, user.email);
    _stats = null;   // la PLANTILLA cambió
    return {
      ok: true, cargaId: cargaId, filas: all.length, rango: 'A' + start + ':L' + (start + all.length - 1), aprendidos: learned,
      eventos: plan.map(function (p) { return { id: p.idRes, manual: !!(p.manual && p.manual.registrar), filas: p.rows.length }; })
    };
  } finally {
    lock.releaseLock();
  }
}

function md5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** Guarda lo confirmado por el usuario para usarlo automáticamente la próxima vez. */
function learn_(req, plan, email) {
  var sh = ensureTab_(CONFIG.TAB_ALIAS);
  var existing = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues() : [];
  var pos = {};
  existing.forEach(function (r, i) { pos[r[0] + '|' + r[1] + '|' + r[2]] = i + 2; });
  var now = new Date(), toAppend = [], count = 0, origin = req.origin || '';
  var idx = getIndex_();

  function upsert(tipo, clave, valor, desc, original) {
    var k = tipo + '|' + origin + '|' + clave;
    var row = [tipo, origin, clave, valor, desc, email, now, original];
    if (pos[k]) sh.getRange(pos[k], 1, 1, row.length).setValues([row]);
    else { toAppend.push(row); pos[k] = -1; }
    count++;
  }

  plan.forEach(function (p) {
    p.g.rows.forEach(function (r) {
      if (!r.learn || r.omit || !origin) return;
      var ean = Core.canonCode(r.ean);
      var clave = Core.aliasKeyProduct(r.code, r.desc);
      if (clave === 'TXT:' || clave === 'COD:') return;
      upsert('PRODUCTO', clave, ean, Core.productInfo(idx, ean).producto, (r.code ? r.code + ' ' : '') + (r.desc || ''));
    });
    if (p.ev && p.g.pdvText && origin) upsert('PDV', Core.normText(p.g.pdvText), p.ev.idPdv || '', p.ev.pdv || p.ev.pdvManual, p.g.pdvText);
    if (p.ev && origin && Core.similarity(origin, p.ev.cliente) < 0.95) upsert('CLIENTE', '', p.ev.cliente, p.ev.cliente, origin);
  });
  if (toAppend.length) sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, toAppend[0].length).setValues(toAppend);
  return count;
}

// ===================================================================== Carpeta de ventas (bandeja)
//
// Los usuarios guardan en una carpeta de Drive las fotos, PDF y Excel de cada evento, con el ID RESUMEN
// en el nombre del archivo o de la subcarpeta. El lector revisa la carpeta archivo por archivo y sabe
// qué ya se cargó: por el archivo (LV_Cargas guarda su ID y versión) y por el evento (filas de la PLANTILLA
// con ese ID RESUMEN, también las cargadas a mano antes de existir el lector).

var FOLDER_MIME = 'application/vnd.google-apps.folder';
var SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';
var DOCS_MIME = 'application/vnd.google-apps.document';
var A = { ID: 0, NOMBRE: 1, RUTA: 2, TIPO: 3, VERSION: 4, IDRES: 5, ESTADO: 6, DETALLE: 7, CARGA: 8, ACT: 9, ENLACE: 10 };

function folderInfo_() {
  var id = PropertiesService.getScriptProperties().getProperty('VENTAS_FOLDER_ID');
  if (!id) return null;
  try {
    var f = Drive.Files.get(id, { fields: 'id,name', supportsAllDrives: true });
    return { id: id, name: f.name, url: 'https://drive.google.com/drive/folders/' + id };
  } catch (e) { return { id: id, name: '(sin acceso a la carpeta)', url: 'https://drive.google.com/drive/folders/' + id, error: true }; }
}

function autoTriggerOn_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'procesarCarpetaAuto'; });
}

/** Lista los archivos de la carpeta y sus subcarpetas (ruta relativa: "ACT-0123/foto.jpg"). */
function listFolderFiles_(rootId) {
  var out = [], queue = [{ id: rootId, path: '', depth: 0 }];
  while (queue.length && out.length < CONFIG.INBOX_MAX_FILES) {
    var q = queue.shift(), token = null;
    do {
      var res = Drive.Files.list({
        q: "'" + q.id + "' in parents and trashed = false", orderBy: 'name', pageSize: 200, pageToken: token,
        fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,size,md5Checksum,webViewLink,shortcutDetails)',
        supportsAllDrives: true, includeItemsFromAllDrives: true
      });
      (res.files || []).forEach(function (f) {
        var mime = f.mimeType, id = f.id;
        if (mime === 'application/vnd.google-apps.shortcut' && f.shortcutDetails) { id = f.shortcutDetails.targetId; mime = f.shortcutDetails.targetMimeType; }
        var p = q.path ? q.path + '/' + f.name : f.name;
        if (mime === FOLDER_MIME) { if (q.depth < CONFIG.INBOX_MAX_DEPTH) queue.push({ id: id, path: p, depth: q.depth + 1 }); return; }
        out.push({ id: id, name: f.name, path: p, mime: mime, size: Number(f.size) || 0,
          version: f.md5Checksum || f.modifiedTime || '', url: f.webViewLink || ('https://drive.google.com/file/d/' + id + '/view') });
      });
      token = res.nextPageToken;
    } while (token && out.length < CONFIG.INBOX_MAX_FILES);
  }
  return out;
}

function kindOf_(f) {
  var ext = (String(f.name).split('.').pop() || '').toLowerCase(), m = f.mime || '';
  if (m === SHEETS_MIME) return 'sheet';
  if (m === DOCS_MIME) return 'doc';
  if (/heic|heif/.test(ext) || /heic|heif/.test(m)) return '';
  if (ext === 'xlsx' || ext === 'xlsm' || /spreadsheetml/.test(m)) return 'xlsx';
  if (ext === 'xls' || m === 'application/vnd.ms-excel') return 'xls';
  if (ext === 'csv' || m === 'text/csv') return 'csv';
  if (ext === 'pdf' || m === 'application/pdf') return 'pdf';
  if (m.indexOf('image/') === 0) return 'image';
  return '';
}

/** Lee un archivo de la carpeta y devuelve filas igual que api_extract. */
function extractDriveFile_(f) {
  var kind = kindOf_(f), idx = getIndex_();
  if (!kind) throw new Error('Formato no soportado (' + (f.mime || f.name) + ')');
  if (kind === 'image' || kind === 'pdf') {
    return extractPayload_({ kind: kind, name: f.name, blob: kind === 'image' ? imageBlobForOcr_(f) : DriveApp.getFileById(f.id).getBlob() });
  }
  if (kind === 'doc') {
    var t = DocumentApp.openById(f.id).getBody().getText(), p = Core.parseOcrText(t);
    return { source: 'texto', rows: p.rows, dates: p.dates, text: t };
  }
  var sheets;
  if (kind === 'sheet') sheets = readGoogleSheet_(f.id);
  else if (kind === 'xlsx') sheets = readXlsxAll_(DriveApp.getFileById(f.id).getBlob());
  else if (kind === 'xls') {
    // .xls antiguo: conversión temporal a Google Sheets (se borra al terminar; el original no se toca)
    var tmp = Drive.Files.create({ name: 'LV_tmp_' + Date.now(), mimeType: SHEETS_MIME }, DriveApp.getFileById(f.id).getBlob(), { fields: 'id' });
    try { sheets = readGoogleSheet_(tmp.id); }
    finally { try { Drive.Files.remove(tmp.id); } catch (e) { try { DriveApp.getFileById(tmp.id).setTrashed(true); } catch (e2) { } } }
  } else {
    var txt = DriveApp.getFileById(f.id).getBlob().getDataAsString('UTF-8').replace(/^﻿/, '');
    var first = txt.split(/\r?\n/)[0] || '';
    sheets = { csv: Utilities.parseCsv(txt, first.split(';').length > first.split(',').length ? ';' : ',') };
  }
  return chooseTable_(sheets, idx);
}

function cellStr_(v) {
  if (v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? '' : Core.isoDate(v);
  return String(v);
}

function readGoogleSheet_(id) {
  var out = {};
  SpreadsheetApp.openById(id).getSheets().forEach(function (s) {
    if (s.getLastRow() < 1) return;
    out[s.getName()] = s.getRange(1, 1, Math.min(s.getLastRow(), 5000), Math.min(Math.max(1, s.getLastColumn()), 40)).getValues();
  });
  return out;
}

/** Todas las hojas de un .xlsx, descomprimiendo en memoria (sin convertir ni copiar el archivo). */
function readXlsxAll_(blob) {
  var parts = Utilities.unzip(blob.setContentType('application/zip')), byName = {};
  parts.forEach(function (b) { byName[b.getName()] = b; });
  var txt = function (n) { return byName[n] ? byName[n].getDataAsString('UTF-8') : ''; };
  var paths = Core.xlsxSheetPaths(txt('xl/workbook.xml'), txt('xl/_rels/workbook.xml.rels'));
  var shared = Core.xlsxSharedStrings(txt('xl/sharedStrings.xml')), out = {};
  Object.keys(paths).forEach(function (n) { if (byName[paths[n]]) out[n] = Core.xlsxSheetRows(txt(paths[n]), shared, 40); });
  return out;
}

/** Elige la hoja con más códigos que existen en el EAN Master. */
function chooseTable_(sheets, idx) {
  var best = null;
  Object.keys(sheets || {}).forEach(function (name) {
    var rows = (sheets[name] || []).slice(0, 5000).map(function (r) { return r.map(cellStr_); });
    if (!rows.some(function (r) { return r.some(function (c) { return c !== ''; }); })) return;
    var det = Core.detectTable(rows, idx), tr = Core.tableToRows(rows, det);
    var hits = tr.rows.filter(function (r) { return r.code && idx.byCode[Core.canonCode(r.code)]; }).length;
    var score = hits * 10 + tr.rows.length;
    if (!best || score > best.score) best = { score: score, name: name, rows: rows, det: det, tr: tr };
  });
  if (!best) throw new Error('El archivo no tiene hojas con datos.');
  return { source: 'tabla', rows: best.tr.rows, dates: best.tr.dates, sheet: best.name, tableRows: best.rows, text: '',
    table: { headers: best.det.headers, map: best.det.map, headerRow: best.det.headerRow, ncols: best.det.ncols } };
}

/** Fotos grandes: se pide a Drive una versión de 2400 px para el OCR (si falla, se usa la original). */
function imageBlobForOcr_(f) {
  if (f.size > 3 * 1024 * 1024) {
    try {
      var meta = Drive.Files.get(f.id, { fields: 'thumbnailLink', supportsAllDrives: true });
      if (meta.thumbnailLink) {
        var resp = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s2400'), { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
        if (resp.getResponseCode() === 200) return resp.getBlob().setName(f.name);
      }
    } catch (e) { /* se usa el original */ }
  }
  return DriveApp.getFileById(f.id).getBlob();
}

/** Última carga de cada archivo de Drive y de cada evento, según LV_Cargas. */
function readCargas_() {
  var sh = ensureTab_(CONFIG.TAB_CARGAS), byFile = {}, byEvent = {};
  if (sh.getLastRow() < 2) return { byFile: byFile, byEvent: byEvent };
  sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues().forEach(function (r) {
    var c = { cargaId: r[0], fecha: r[1], usuario: r[2], archivo: r[3], idRes: String(r[5]), filas: r[6], version: String(r[11] || '') };
    if (r[10]) byFile[r[10]] = c;
    (byEvent[c.idRes.toUpperCase()] = byEvent[c.idRes.toUpperCase()] || []).push(c);
  });
  return { byFile: byFile, byEvent: byEvent };
}

function fmtFecha_(d) {
  return Object.prototype.toString.call(d) === '[object Date]' ? Utilities.formatDate(d, CONFIG_TZ_(), 'dd/MM/yyyy HH:mm') : String(d || '');
}
function CONFIG_TZ_() { return 'America/Bogota'; }

/** Recorre la carpeta, calcula el estado de cada archivo y lo guarda en LV_Archivos. */
function inboxScan_() {
  var folder = folderInfo_();
  if (!folder) return null;
  if (folder.error) throw new Error('No hay acceso a la carpeta de ventas configurada. Revisa que esté compartida con la cuenta que publicó el lector.');
  var files = listFolderFiles_(folder.id);
  var events = readEvents_(), stats = plantillaStats_(true), cargas = readCargas_();
  var sh = ensureTab_(CONFIG.TAB_ARCHIVOS), prev = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues().forEach(function (r) { if (r[A.ID]) prev[r[A.ID]] = r; });
  var now = new Date();

  var out = files.map(function (f) {
    var hit = Core.findIdInName(f.path, events), ev = hit && hit.ev;
    var idRes = ev ? ev.idResumen : '', key = idRes.toUpperCase();
    var p = prev[f.id], pEstado = p ? p[A.ESTADO] : '', pVersion = p ? String(p[A.VERSION]) : '';
    var c = cargas.byFile[f.id], kind = kindOf_(f), st, det = '', cargaId = '';
    if (c) {
      cargaId = c.cargaId;
      if (c.version && f.version && c.version !== f.version) { st = 'MODIFICADO'; det = 'El archivo cambió después de cargarlo (' + c.cargaId + '). Revísalo antes de volver a cargarlo.'; }
      else { st = 'CARGADO'; det = c.filas + ' filas · ' + c.idRes + ' · ' + fmtFecha_(c.fecha) + ' · ' + c.usuario; }
    } else if (pEstado === 'IGNORADO') { st = 'IGNORADO'; det = p[A.DETALLE]; }
    else if (!kind) { st = 'NO SOPORTADO'; det = 'Formato no soportado (' + f.mime + ')'; }
    else if ((pEstado === 'REVISAR' || pEstado === 'ERROR') && pVersion === f.version) { st = pEstado; det = p[A.DETALLE]; }
    else if (key && stats[key]) {
      var s = stats[key], by = (cargas.byEvent[key] || []).map(function (x) { return x.archivo; }).filter(Boolean);
      st = 'EVENTO YA CARGADO';
      det = s.filas + ' filas · ' + s.unidades + ' unidades ya en la PLANTILLA' + (by.length ? ' (desde ' + by.join(', ') + ')' : ' (carga anterior al lector)');
    } else {
      st = 'PENDIENTE';
      det = idRes ? '' : (hit && hit.notFound ? 'El ID ' + hit.notFound + ' no está en "Detalle eventos"' : 'Sin ID RESUMEN en el nombre');
    }
    return { id: f.id, name: f.name, path: f.path, mime: f.mime, kind: kind, version: f.version, size: f.size, url: f.url,
      idResumen: idRes, cliente: ev ? ev.cliente : '', pdv: ev ? (ev.pdv || ev.pdvManual) : '', estadoEvento: ev ? ev.estado : '',
      estado: st, detalle: det, cargaId: cargaId };
  });

  var vals = out.map(function (o) { return [o.id, o.name, o.path, o.mime, o.version, o.idResumen, o.estado, o.detalle, o.cargaId, now, o.url]; });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 11).clearContent();
  if (vals.length) {
    var need = vals.length + 1 - sh.getMaxRows();
    if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
    sh.getRange(2, 1, vals.length, 11).setValues(vals);
  }
  var counts = {};
  out.forEach(function (o) { counts[o.estado] = (counts[o.estado] || 0) + 1; });
  return { folder: folder, files: out, counts: counts, scannedAt: now.toISOString(), autoOn: autoTriggerOn_() };
}

/** Actualiza el estado de un archivo en LV_Archivos. */
function setArchivo_(fileId, f) {
  var sh = ensureTab_(CONFIG.TAB_ARCHIVOS);
  if (sh.getLastRow() < 2) return false;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] !== fileId) continue;
    var row = sh.getRange(i + 2, 1, 1, 11).getValues()[0];
    if (f.estado != null) row[A.ESTADO] = f.estado;
    if (f.detalle != null) row[A.DETALLE] = f.detalle;
    if (f.cargaId != null) row[A.CARGA] = f.cargaId;
    row[A.ACT] = new Date();
    sh.getRange(i + 2, 1, 1, 11).setValues([row]);
    return true;
  }
  return false;
}

/** Datos de un archivo listado en LV_Archivos (solo se leen archivos de la carpeta configurada). */
function archivo_(fileId) {
  var sh = ensureTab_(CONFIG.TAB_ARCHIVOS);
  if (sh.getLastRow() < 2) return null;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r[A.ID] === fileId) return { id: r[A.ID], name: r[A.NOMBRE], path: r[A.RUTA], mime: r[A.TIPO], version: String(r[A.VERSION]), url: r[A.ENLACE], size: 0 };
  }
  return null;
}

function autoCommitReq_(m, f) {
  return {
    fileName: f.path, origin: m.client.selected, driveFileId: f.id, driveVersion: f.version,
    groups: m.groups.map(function (g) {
      return { mode: 'evento', idResumen: g.fromName, pdvText: g.pdvText, rows: g.rows.map(function (i) {
        var p = m.products[i];
        return { code: p.code, desc: p.desc, qty: p.qty, ean: p.ean, omit: p.omit || !p.ean, learn: false };
      }) };
    })
  };
}

/**
 * Carga automática: procesa los archivos PENDIENTES uno por uno. Solo carga sin revisión los que
 * tienen ID RESUMEN válido, evento sin filas en la PLANTILLA y todos los productos cruzados por código;
 * los demás quedan "REVISAR" con el motivo.
 */
function inboxAuto_(email) {
  var cache = CacheService.getScriptCache();
  if (cache.get('inbox_auto_running')) return { busy: true };
  cache.put('inbox_auto_running', '1', 360);
  var t0 = Date.now();
  try {
    var scan = inboxScan_();
    if (!scan) throw new Error('No hay carpeta de ventas configurada.');
    var todo = scan.files.filter(function (f) { return f.estado === 'PENDIENTE'; });
    var res = { cargados: [], revisar: [], errores: [], quedan: 0 };
    for (var i = 0; i < todo.length; i++) {
      var f = todo[i];
      if (Date.now() - t0 > CONFIG.INBOX_TIME_BUDGET_MS) { res.quedan = todo.length - i; break; }
      if (!f.idResumen) {
        setArchivo_(f.id, { estado: 'REVISAR', detalle: f.detalle || 'Sin ID RESUMEN en el nombre' });
        res.revisar.push({ name: f.path, reason: f.detalle || 'Sin ID RESUMEN en el nombre' });
        continue;
      }
      try {
        var ext = extractDriveFile_(f);
        var m = matchCore_({ rows: ext.rows, from: ext.dates.from, to: ext.dates.to, text: ext.text || '', idHint: f.path });
        var d = Core.autoDecision(m, plantillaStats_(true));
        if (!d.ok) { setArchivo_(f.id, { estado: 'REVISAR', detalle: d.reason }); res.revisar.push({ name: f.path, reason: d.reason }); continue; }
        var r = commitCore_(autoCommitReq_(m, f), email);
        if (!r.ok) {
          var why = (r.warnings || []).join(' ') || 'No se cargó';
          setArchivo_(f.id, { estado: 'REVISAR', detalle: why }); res.revisar.push({ name: f.path, reason: why });
        } else {
          setArchivo_(f.id, { estado: 'CARGADO', detalle: r.filas + ' filas · ' + f.idResumen + ' · carga automática', cargaId: r.cargaId });
          res.cargados.push({ name: f.path, id: f.idResumen, filas: r.filas });
        }
      } catch (e) {
        setArchivo_(f.id, { estado: 'ERROR', detalle: String(e.message || e) });
        res.errores.push({ name: f.path, reason: String(e.message || e) });
      }
    }
    return res;
  } finally {
    cache.remove('inbox_auto_running');
  }
}

/** Trigger horario (opcional): revisa la carpeta y carga lo que esté 100 % OK. */
function procesarCarpetaAuto() {
  var who = 'automático';
  try { who = 'automático (' + Session.getEffectiveUser().getEmail() + ')'; } catch (e) { }
  var r = inboxAuto_(who);
  Logger.log(JSON.stringify(r));
  return r;
}

// ---- API de la bandeja para la página

function api_inbox() {
  authorize_();
  var info = folderInfo_();
  if (!info) return { folder: null, files: [], counts: {}, autoOn: autoTriggerOn_() };
  return inboxScan_();
}

function api_inboxAuto() {
  var user = authorize_();
  return inboxAuto_(user.email + ' (carga automática)');
}

/** Abre un archivo de la carpeta en el flujo normal (revisión en la página). */
function api_extractDriveFile(fileId) {
  authorize_();
  var f = archivo_(fileId);
  if (!f) throw new Error('Ese archivo no está en la carpeta de ventas. Pulsa "Revisar carpeta".');
  try { f.size = Number(Drive.Files.get(f.id, { fields: 'size', supportsAllDrives: true }).size) || 0; } catch (e) { }
  var ext = extractDriveFile_(f);
  ext.driveFile = { id: f.id, name: f.name, path: f.path, version: f.version, url: f.url };
  return ext;
}

/**
 * Imagen de la carpeta de ventas para leerla en el navegador por columnas.
 * Solo archivos listados en LV_Archivos; las grandes llegan reducidas (miniatura de Drive de 2400 px).
 */
function api_driveImage(fileId) {
  authorize_();
  var f = archivo_(fileId);
  if (!f) throw new Error('Ese archivo no está en la carpeta de ventas. Pulsa "Revisar carpeta".');
  if (kindOf_(f) !== 'image') return null;
  try { f.size = Number(Drive.Files.get(f.id, { fields: 'size', supportsAllDrives: true }).size) || 0; } catch (e) { }
  var blob = imageBlobForOcr_(f);
  return { data: Utilities.base64Encode(blob.getBytes()), mime: blob.getContentType(), driveFile: { id: f.id, name: f.name, path: f.path, version: f.version, url: f.url } };
}

function api_inboxSetState(fileId, estado) {
  var user = authorize_();
  if (['IGNORADO', 'PENDIENTE'].indexOf(estado) < 0) throw new Error('Estado no permitido.');
  if (!archivo_(fileId)) throw new Error('Ese archivo no está en la carpeta de ventas.');
  setArchivo_(fileId, { estado: estado, detalle: estado === 'IGNORADO' ? 'Ignorado por ' + user.email : '' });
  return true;
}

function api_setFolder(urlOrId) {
  var user = authorize_();
  if (!/admin/i.test(user.role)) throw new Error('Solo un administrador puede cambiar la carpeta de ventas.');
  var id = Core.folderIdFromUrl(urlOrId);
  if (!id) throw new Error('Pega el enlace de una carpeta de Google Drive (…/drive/folders/…).');
  var f;
  try { f = Drive.Files.get(id, { fields: 'id,name,mimeType', supportsAllDrives: true }); }
  catch (e) { throw new Error('No se puede abrir esa carpeta con la cuenta que publicó el lector. Compártela con esa cuenta.'); }
  if (f.mimeType !== FOLDER_MIME) throw new Error('El enlace no es de una carpeta.');
  PropertiesService.getScriptProperties().setProperty('VENTAS_FOLDER_ID', id);
  ensureTab_(CONFIG.TAB_ARCHIVOS);
  return folderInfo_();
}

function api_setAutoTrigger(on) {
  var user = authorize_();
  if (!/admin/i.test(user.role)) throw new Error('Solo un administrador puede activar la carga automática.');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'procesarCarpetaAuto') ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('procesarCarpetaAuto').timeBased().everyHours(CONFIG.INBOX_AUTO_EVERY_HOURS).create();
  return autoTriggerOn_();
}

// ===================================================================== Reporte de eventos del mes

/** Eventos del mes (ym 'YYYY-MM') con su estado de carga en la PLANTILLA. */
function api_monthReport(ym, incluirCancelados) {
  authorize_();
  return Core.monthReport(readEvents_(), plantillaStats_(true), ym, { incluirCancelados: !!incluirCancelados });
}

/** Botón "Actualizar Master" (solo administradores). */
function api_refreshMasters() {
  var user = authorize_();
  if (!/admin/i.test(user.role)) throw new Error('Solo un administrador puede actualizar los Master.');
  return refreshMasters();
}

// ===================================================================== Configuración (ejecutar desde el editor)

/** Ejecutar UNA vez: crea pestañas LV_*, carga la caché de Master y programa la actualización diaria. */
function setup() {
  [CONFIG.TAB_ALIAS, CONFIG.TAB_MANUALES, CONFIG.TAB_CARGAS, CONFIG.TAB_ARCHIVOS].forEach(ensureTab_);
  var r = refreshMasters();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'refreshMasters') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshMasters').timeBased().everyDays(1).atHour(CONFIG.MASTERS_REFRESH_HOUR).create();
  Logger.log('Listo. Master cargados: ' + JSON.stringify(r));
}

/** Opcional: guardar la clave de Claude en Propiedades del script (nunca en el código). */
function setClaudeKey() {
  var key = '';   // ← pega la clave aquí SOLO para ejecutar una vez, y luego bórrala del código
  if (!key) throw new Error('Pega la clave en la variable key, ejecuta, y luego bórrala.');
  PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY', key);
  Logger.log('Clave guardada. Ya puedes borrarla del código.');
}
