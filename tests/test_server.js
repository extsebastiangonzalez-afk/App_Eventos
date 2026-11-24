/**
 * Prueba de integración de Server.gs con servicios de Apps Script simulados (en memoria).
 * Uso: node tests/test_server.js <carpeta_con_xml_extraido>
 * No toca ningún archivo real: el Sheet, Drive y los Master son simulaciones en memoria
 * (los Master se leen desde el XML extraído en modo lectura).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const xmlDir = process.argv[2];
const ROOT = path.join(__dirname, '..', 'apps-script');
let pass = 0, fail = 0;
function check(name, fn) { try { fn(); pass++; console.log('  OK  ', name); } catch (e) { fail++; console.log('  FAIL', name, '\n       ', e.stack.split('\n').slice(0, 3).join('\n        ')); } }

// ------------------------------------------------------------ Sheets simulado
function colToIdx(c) { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
class FakeRange {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = (this.sh.data[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v == null ? '' : v); } out.push(row); } return out; }
  setValues(v) {
    assert.strictEqual(v.length, this.nr, 'setValues filas'); v.forEach(r => assert.strictEqual(r.length, this.nc, 'setValues columnas'));
    if (this.r - 1 + this.nr > this.sh.maxRows) throw new Error('Rango fuera de la hoja');
    v.forEach((row, i) => { const t = this.sh.data[this.r - 1 + i] = this.sh.data[this.r - 1 + i] || []; row.forEach((x, j) => { t[this.c - 1 + j] = x; }); });
    return this;
  }
  setFontWeight() { return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) { const t = this.sh.data[this.r - 1 + i]; if (t) for (let j = 0; j < this.nc; j++) t[this.c - 1 + j] = ''; } return this; }
}
class FakeSheet {
  constructor(name, data, maxRows) { this.name = name; this.data = data || []; this.maxRows = maxRows || Math.max(1000, this.data.length); }
  getName() { return this.name; }
  getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i] && this.data[i].some(v => v !== '' && v != null)) return i + 1; return 0; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r ? r.length : 0), 0); }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_, n) { this.maxRows += n; }
  setFrozenRows() { }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(a);
      const c1 = colToIdx(m[1]), r1 = +m[2], c2 = colToIdx(m[3]), r2 = +m[4];
      return new FakeRange(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new FakeRange(this, a, b, c || 1, d || 1);
  }
}
class FakeSS {
  constructor(sheets) { this.sheets = sheets; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { return (this.sheets[n] = new FakeSheet(n, [])); }
}

// ------------------------------------------------------------ Datos del Sheet (fixtures)
const H = ['ID RESUMEN', 'ID EVENTO', 'SOLICITANTE', 'FECHA SOLICITUD', 'MES', 'FECHA INICIO', 'FECHA FIN', 'KAM', 'SAP ID', 'DIAS', 'CLIENTE', 'DESTINO', 'ID PDV', 'PDV', 'PDV MANUAL', 'DIRECCION', 'CIUDAD', 'TIPO EVENTO', 'HORA INICIO', 'HORA FIN ', 'MATERIAL', 'MATERIAL LIMPIEZA', 'ESTADO', 'COMENTARIO ESTADO', 'TIPO DE DERMO ', 'NOMBRE DERMO'];
const ev = o => H.map(h => o[h] != null ? o[h] : '');
const D = (y, m, d) => new Date(y, m - 1, d);
const eventos = [H,
  ev({ 'ID RESUMEN': 'EVT-0004', SOLICITANTE: 'sandra.runza@isdin.com', MES: 'enero', 'FECHA INICIO': D(2026, 1, 30), 'FECHA FIN': D(2026, 1, 31), 'SAP ID': 11049529, DIAS: 2, CLIENTE: 'FARMATODO COLOMBIA S.A.', PDV: '1061 - FARMATODO ATLANTIS', 'TIPO EVENTO': 'TOMA PDV', ESTADO: 'APROBADO' }),
  // FICTICIO para la prueba: evento DERMORIENTE con SAP real (11026941) en las fechas de la foto
  ev({ 'ID RESUMEN': 'ACT-9001', 'ID EVENTO': 'EVT-9001', SOLICITANTE: 'prueba@isdin.com', MES: 'agosto', 'FECHA INICIO': D(2026, 8, 27), 'FECHA FIN': D(2026, 8, 29), 'SAP ID': 11026941, DIAS: 3, CLIENTE: 'DERMORIENTE S.A.S', PDV: 'DERMORIENTE CENTRO (FICTICIO)', 'TIPO EVENTO': 'PDV', ESTADO: 'APROBADO', 'NOMBRE DERMO': 'DERMO FICTICIA' }),
  // FICTICIOS para la bandeja: otro evento DERMORIENTE (sin cargas) y el ACT-0791 que ya está en la PLANTILLA
  ev({ 'ID RESUMEN': 'ACT-9005', 'ID EVENTO': 'EVT-9005', SOLICITANTE: 'prueba@isdin.com', MES: 'septiembre', 'FECHA INICIO': D(2026, 9, 10), 'FECHA FIN': D(2026, 9, 11), 'SAP ID': 11026941, DIAS: 2, CLIENTE: 'DERMORIENTE S.A.S', PDV: 'DERMORIENTE SUR (FICTICIO)', 'TIPO EVENTO': 'PDV', ESTADO: 'APROBADO' }),
  ev({ 'ID RESUMEN': 'ACT-0791', 'ID EVENTO': 'EVT-0791', SOLICITANTE: 'x@isdin.com', MES: 'septiembre', 'FECHA INICIO': D(2026, 9, 1), 'FECHA FIN': D(2026, 9, 1), CLIENTE: 'CIRUDERMA S.A.S.', PDV: 'EDIFICIO HDI SEGURO', 'TIPO EVENTO': 'EMPRESARIAL', ESTADO: 'APROBADO' })
];
const buRows = [['SUB FAMILIA', 'NUEVA REF.', 'ANTERIOR REF.', 'ISDIN EAN'], ['PLAT. WATER', 'FP FUSION WATER MAGIC SPF50 50ML', 'FOTOPROTECTOR FUSION MAGIC', 8429420248977], ['OTRO', 'ISDIN REPARADOR LABIAL STICK GRANATE 4G', '', 8429420292901]]
  .map(r => { const x = new Array(18).fill(''); return x.concat(r); });
const PL_H = ['MES', 'DIAS', 'ID RESUMEN', 'SOLICITANTE', 'CLIENTE', 'ISDIN PDV', 'TIPO DE EVENTO', 'EAN', 'PRODUCTO', 'UNITS', 'BU', 'DERMO'];
const ss = new FakeSS({
  'PLANTILLA VENTAS EVENTOS': new FakeSheet('PLANTILLA VENTAS EVENTOS', [PL_H, ['SEPTIEMBRE', 1, 'ACT-0791', 'x@isdin.com', 'CIRUDERMA S.A.S.', 'EDIFICIO HDI SEGURO', 'EMPRESARIAL', 8429420113374, 'K-OX EYES 15GR (A)', 1, 'ISDINCEUTICS', '']], 2),
  'Detalle eventos': new FakeSheet('Detalle eventos', eventos),
  'Usuarios': new FakeSheet('Usuarios', [['Correo', 'Rol'], ['admin@isdin.com', 'Admin'], ['user@isdin.com', 'Usuario']]),
  'PLANTILLA VENTAS EVENTOS_Backup': new FakeSheet('PLANTILLA VENTAS EVENTOS_Backup', buRows)
});

// ------------------------------------------------------------ Drive / Utilities / etc. simulados
const files = {};
let nextId = 1;
const blobOf = (name, getStr) => ({ getName: () => name, getDataAsString: getStr, setContentType() { return this; }, getBytes: () => Buffer.from(getStr()) });
function mkFile(name, content) { const id = 'f' + (nextId++); files[id] = { id, name, content, trashed: false }; return fileApi(id); }
function fileApi(id) { const f = files[id]; return { getId: () => id, getName: () => f.name, isTrashed: () => f.trashed, setContent: c => { f.content = c; }, setTrashed: t => { f.trashed = t; }, getBlob: () => blobOf(f.name, () => f.content) }; }
const eanFile = mkFile('EAN MASTER Master.xlsx', 'ZIP:ean');
const pdvFile = mkFile('PDV MASTER Master.xlsx', 'ZIP:pdv');
const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
const sellOut = { getFilesByName: n => iter(Object.keys(files).filter(k => files[k].name === n).map(fileApi)), getFoldersByName: () => iter([]) };
const ventas = { getFoldersByName: n => iter(n === 'SELL-OUT' ? [sellOut] : []), getFilesByName: () => iter([]) };

// ------------------------------------------------------------ Carpeta de ventas simulada (Drive API v3)
const FOLDER = 'application/vnd.google-apps.folder';
const OCR_TXT = fs.readFileSync(path.join(__dirname, 'test_core.js'), 'utf8').match(/const OCR_ROWS = `([\s\S]*?)`;/)[1];
const drive = {};
const addItem = (id, name, mimeType, parent, content) => { drive[id] = { id, name, mimeType, parent, content: content || '', md5: content ? crypto.createHash('md5').update(content).digest('hex') : '' }; };
addItem('ROOTFOLDER01', 'VENTAS EVENTOS', FOLDER, null);
addItem('SUB1', 'ACT-9005', FOLDER, 'ROOTFOLDER01');
addItem('IMAGEFILE001', 'IMG_2045.jpg', 'image/jpeg', 'SUB1', OCR_TXT);
addItem('IMG2', 'IMG_2046.jpg', 'image/jpeg', 'SUB1', OCR_TXT + '\n');
addItem('CSV1', 'ACT-0791 ventas.csv', 'text/csv', 'ROOTFOLDER01', 'Articulo;Nombre;Cantidad\nN81105;ISDINCEUTICS ESSENTIAL CLEASING X 200 ML;2');
addItem('NOID', 'foto sin id.png', 'image/png', 'ROOTFOLDER01', OCR_TXT);
addItem('DOCX', 'notas.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'ROOTFOLDER01', 'x');
let tmpN = 0;
const driveBlob = it => ({ getName: () => it.name, getDataAsString: () => it.content, getContentType: () => it.mimeType, setContentType() { return this; }, setName() { return this; }, getBytes: () => Buffer.from(it.content) });
const Drive = { Files: {
  list: p => { const parent = /'([^']+)' in parents/.exec(p.q)[1]; return { files: Object.values(drive).filter(x => x.parent === parent).map(x => ({ id: x.id, name: x.name, mimeType: x.mimeType, md5Checksum: x.md5 || undefined, modifiedTime: '2026-11-12T10:00:00Z', size: String(x.content.length), webViewLink: 'https://drive/' + x.id })) }; },
  get: (id) => { const x = drive[id]; if (!x) throw new Error('404'); return { id, name: x.name, mimeType: x.mimeType, size: String(x.content.length) }; },
  create: (res, blob) => { const id = 'TMP' + (++tmpN); drive[id] = { id, name: res.name, mimeType: res.mimeType, parent: null, content: blob.getDataAsString() }; return { id }; },
  remove: id => { delete drive[id]; }
} };
const DocumentApp = { openById: id => ({ getBody: () => ({ getText: () => drive[id].content }) }) };
const triggers = [];

let currentUser = 'admin@isdin.com';
const props = {}, cache = {};
const unzipped = [];
const ctx = {
  console,
  Session: { getActiveUser: () => ({ getEmail: () => currentUser }), getEffectiveUser: () => ({ getEmail: () => 'admin@isdin.com' }) },
  SpreadsheetApp: { openById: () => ss },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, getAll: ks => Object.fromEntries(ks.filter(k => k in cache).map(k => [k, cache[k]])), putAll: o => Object.assign(cache, o), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  DriveApp: { getFileById: id => { if (drive[id]) return { getId: () => id, getBlob: () => driveBlob(drive[id]), setTrashed() { } }; if (!files[id]) throw new Error('no file'); return fileApi(id); }, getFolderById: () => ventas, createFile: (n, c) => mkFile(n, c) },
  Drive, DocumentApp,
  MimeType: { PLAIN_TEXT: 'text/plain', GOOGLE_DOCS: 'application/vnd.google-apps.document' },
  LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
  ScriptApp: {
    getProjectTriggers: () => triggers.slice(), deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
    newTrigger: fn => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create() { triggers.push({ getHandlerFunction: () => fn }); } }) }), everyHours: () => ({ create() { triggers.push({ getHandlerFunction: () => fn }); } }) }) })
  },
  Logger: { log: () => { } },
  Utilities: {
    unzip: blob => {
      const which = blob.getDataAsString().split(':')[1];
      unzipped.push(which);
      const pre = which + '__';
      return fs.readdirSync(xmlDir).filter(f => f.startsWith(pre)).map(f => {
        const name = f.slice(pre.length).replace(/^xl__rels_/, 'xl/_rels/').replace(/^xl_worksheets_/, 'xl/worksheets/').replace(/^xl_/, 'xl/');
        return blobOf(name, () => fs.readFileSync(path.join(xmlDir, f), 'utf8'));
      });
    },
    formatDate: (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 8) + '-' + d.toISOString().slice(11, 19).replace(/:/g, ''),
    computeDigest: (alg, s) => Array.from(crypto.createHash('md5').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { MD5: 'MD5' }, Charset: { UTF_8: 'UTF-8' },
    parseCsv: (t, d) => t.split(/\r?\n/).filter(Boolean).map(l => l.split(d)),
    base64Decode: s => Buffer.from(s, 'base64'), base64Encode: b => Buffer.from(b).toString('base64'), newBlob: () => ({})
  }
};
vm.createContext(ctx);
['Core.gs', 'Config.gs', 'Server.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
const fresh = () => vm.runInContext('_idx = null; _masters = null;', ctx);

const OCR = fs.readFileSync(path.join(__dirname, 'test_core.js'), 'utf8').match(/const OCR_ROWS = `([\s\S]*?)`;/)[1];

console.log('\n[1] setup(): pestañas LV_*, lectura de Master por unzip, caché');
check('setup crea pestañas y caché', () => {
  ctx.setup();
  ['LV_Alias', 'LV_Eventos_Manuales', 'LV_Cargas'].forEach(t => assert.ok(ss.getSheetByName(t), t));
  assert.ok(props.CACHE_FILE_ID && files[props.CACHE_FILE_ID].content.length > 1e6);
  assert.deepStrictEqual(unzipped, ['ean', 'pdv']);
});
check('Archivos Master intactos (contenido simulado sin cambios)', () => { assert.strictEqual(files[eanFile.getId()].content, 'ZIP:ean'); assert.strictEqual(files[pdvFile.getId()].content, 'ZIP:pdv'); });

console.log('\n[2] Acceso');
check('Usuario fuera de "Usuarios" es rechazado', () => { currentUser = 'otro@gmail.com'; assert.throws(() => ctx.api_bootstrap(), /no está en la pestaña/); currentUser = 'user@isdin.com'; });
check('Usuario no admin no puede actualizar Master', () => assert.throws(() => ctx.api_refreshMasters(), /administrador/));

console.log('\n[3] bootstrap / extract / match');
fresh();
const boot = ctx.api_bootstrap();
check('Catálogo y clientes', () => { assert.ok(boot.catalog.length >= 160); assert.strictEqual(boot.origins.length, 39); assert.strictEqual(boot.claude, false); });
const ext = ctx.api_extract({ kind: 'text', text: OCR });
check('Extrae 23 filas y fechas', () => { assert.strictEqual(ext.rows.length, 23); assert.strictEqual(ext.dates.from, '2026-08-27'); });
const m = ctx.api_match({ rows: ext.rows, from: ext.dates.from, to: ext.dates.to, text: ext.text });
check('Cliente DERMORIENTE y evento ACT-9001 por SAP', () => {
  assert.strictEqual(m.client.selected, 'DERMORIENTE S.A.S');
  assert.strictEqual(m.groups.length, 1);
  assert.strictEqual(m.groups[0].candidates[0].idResumen, 'ACT-9001');
  assert.strictEqual(m.groups[0].candidates[0].clientScore, 1);
});
check('Sin nombres juntos: no reacomoda nada', () => assert.strictEqual(m.realigned, 0));
// Caso real: 1.ª fila con 3 nombres juntos y el resto corridos (las 2 últimas sin nombre)
const shiftedRows = ext.rows.map(r => ({ ...r }));
const allDescs = ext.rows.map(r => r.desc);
const flowD = [allDescs.slice(0, 3).join(' ')].concat(allDescs.slice(3));
shiftedRows.forEach((r, i) => { r.desc = flowD[i] || ''; });
const mS = ctx.api_match({ rows: shiftedRows, from: ext.dates.from, to: ext.dates.to, text: ext.text });
check('Nombres juntos y corridos → api_match los reacomoda fila a fila', () => {
  assert.ok(mS.realigned > 0);
  mS.products.forEach((p, i) => assert.strictEqual(p.desc, allDescs[i], 'fila ' + (i + 1)));
  assert.strictEqual(mS.products.filter(p => p.status === 'ok').length, 22);
});
const mr = ctx.api_matchRows([{ code: '', desc: 'UREADIN HAND CREAM REPAIR PLUS X 50 ML', qty: 1 }], 'DERMORIENTE S.A.S');
check('api_matchRows cruza una fila separada a mano por nombre', () => { assert.strictEqual(mr.length, 1); assert.ok(mr[0].ean); });
// ID RESUMEN en el nombre: sin fechas en el archivo, el evento da cliente, PDV y fechas
const noDates = ext.rows.map(r => ({ ...r }));
const mId = ctx.api_match({ rows: noDates, from: '', to: '', text: '', idHint: 'ACT-9001/IMG_2045.jpg' });
check('Carpeta ACT-9001 → evento preseleccionado, cliente por SAP, fechas del evento', () => {
  assert.strictEqual(mId.idFromName.idResumen, 'ACT-9001');
  assert.strictEqual(mId.idFromName.origin, 'DERMORIENTE S.A.S');
  assert.ok(/SAP/.test(mId.idFromName.originMethod));
  assert.strictEqual(mId.idFromName.pdv, 'DERMORIENTE CENTRO (FICTICIO)');
  assert.strictEqual(mId.client.selected, 'DERMORIENTE S.A.S');
  assert.strictEqual(mId.from, '2026-08-27'); assert.strictEqual(mId.to, '2026-08-29');
  assert.strictEqual(mId.groups[0].fromName, 'ACT-9001');
  assert.strictEqual(mId.groups[0].candidates[0].idResumen, 'ACT-9001');
  assert.strictEqual(mId.products.filter(p => p.status === 'ok').length, 22);
  assert.strictEqual(mId.idFromName.conflict, false);
});
const mConf = ctx.api_match({ rows: noDates, from: '', to: '', text: '', idHint: 'EVT-0004.jpg' });
check('ID de otro cliente → avisa que los códigos apuntan a otro cliente', () => {
  assert.strictEqual(mConf.idFromName.idResumen, 'EVT-0004');
  assert.strictEqual(mConf.idFromName.conflict, true);
  assert.strictEqual(mConf.idFromName.codesOrigin, 'DERMORIENTE S.A.S');
});
const mMiss = ctx.api_match({ rows: noDates, from: '', to: '', text: '', idHint: 'ACT-5555.jpg' });
check('ID inexistente → notFound, sigue por códigos', () => { assert.strictEqual(mMiss.idFromName.notFound, 'ACT-5555'); assert.strictEqual(mMiss.client.selected, 'DERMORIENTE S.A.S'); });
// Consolidado: ACT-9001 y ACT-9005 en el mismo archivo; la columna del evento trae el ID (o solo el número)
const cons = ext.rows.map((r, i) => ({ ...r, eventId: i === 0 ? 'ACT-9001' : (i === 12 ? '9005' : '') }));
cons.forEach((r, i) => { r.pdvText = i < 12 ? 'CENTRO' : 'SUR'; });
const mC = ctx.api_match({ rows: cons, from: '', to: '', text: '', idHint: 'Consolidado ACT-9001 ACT-9005.xlsx' });
check('Consolidado → un grupo por evento, cada uno con su evento preseleccionado', () => {
  assert.strictEqual(mC.groups.length, 2);
  const J = x => JSON.stringify(x);
  assert.strictEqual(J(mC.groups.map(g => g.eventId)), J(['ACT-9001', 'ACT-9005']));
  assert.strictEqual(J(mC.groups.map(g => g.fromName)), J(['ACT-9001', 'ACT-9005']));
  assert.strictEqual(J(mC.groups.map(g => g.rows.length)), J([12, ext.rows.length - 12]));
  assert.strictEqual(mC.groups[1].candidates[0].idResumen, 'ACT-9005');
  assert.strictEqual(mC.client.selected, 'DERMORIENTE S.A.S');
  assert.ok(/Consolidado de 2 eventos/.test(ctx.Core.autoDecision(mC, {}).reason));
});
const mU = ctx.api_match({ rows: ext.rows.map(r => ({ ...r, eventId: 'ACT-7777' })), from: '', to: '', text: '', idHint: '' });
check('Consolidado con un ID que no existe → grupo con notFoundId', () => { assert.strictEqual(mU.groups.length, 1); assert.strictEqual(mU.groups[0].notFoundId, 'ACT-7777'); });
const rowsFor = (prods, learnFn) => prods.map(p => ({ code: p.code, desc: p.desc, qty: p.qty, ean: p.ean, omit: p.omit || !p.ean, learn: learnFn ? learnFn(p) : false }));

console.log('\n[4] commit a evento programado');
const pl = ss.getSheetByName('PLANTILLA VENTAS EVENTOS');
const before = pl.getLastRow();
const r1 = ctx.api_commit({ fileName: 'foto.png', origin: m.client.selected, groups: [{ mode: 'evento', idResumen: 'ACT-9001', rows: rowsFor(m.products) }] });
check('22 filas escritas justo debajo (crece la hoja)', () => {
  assert.ok(r1.ok); assert.strictEqual(r1.filas, 22);
  assert.strictEqual(r1.rango, 'A' + (before + 1) + ':L' + (before + 22));
  assert.strictEqual(pl.getLastRow(), before + 22);
});
check('Fila escrita con tipos correctos', () => {
  const row = pl.data[before];
  assert.deepStrictEqual(row.slice(0, 7), ['AGOSTO', 3, 'ACT-9001', 'prueba@isdin.com', 'DERMORIENTE S.A.S', 'DERMORIENTE CENTRO (FICTICIO)', 'PDV']);
  assert.strictEqual(typeof row[7], 'number'); assert.strictEqual(row[11], 'DERMO FICTICIA');
});
check('Fila original de la PLANTILLA intacta', () => assert.strictEqual(pl.data[1][2], 'ACT-0791'));
check('LV_Cargas registra la carga', () => { const c = ss.getSheetByName('LV_Cargas'); assert.strictEqual(c.getLastRow(), 2); assert.strictEqual(c.data[1][5], 'ACT-9001'); assert.strictEqual(c.data[1][7], 36); });
check('Repetir la misma carga → aviso de duplicado, no escribe', () => {
  const r = ctx.api_commit({ fileName: 'foto.png', origin: m.client.selected, groups: [{ mode: 'evento', idResumen: 'ACT-9001', rows: rowsFor(m.products) }] });
  assert.ok(r.duplicate); assert.strictEqual(pl.getLastRow(), before + 22);
});

console.log('\n[5] Evento no programado e ID manual inexistente');
const r2 = ctx.api_commit({ fileName: 'foto.png', origin: m.client.selected, groups: [{ mode: 'no_programado', manual: { nombre: 'FERIA COLEGIO X', tipo: 'FERIA', from: '2026-08-27', to: '2026-08-29' }, rows: rowsFor(m.products.slice(0, 3)) }] });
check('Genera MAN-0001 y lo registra', () => {
  assert.strictEqual(r2.eventos[0].id, 'MAN-0001');
  const man = ss.getSheetByName('LV_Eventos_Manuales');
  assert.deepStrictEqual(man.data[1].slice(0, 4), ['MAN-0001', 'FERIA COLEGIO X', 'DERMORIENTE S.A.S', 'FERIA']);
  const row = pl.data[pl.getLastRow() - 1];
  assert.deepStrictEqual(row.slice(0, 7), ['AGOSTO', 3, 'MAN-0001', 'user@isdin.com', 'DERMORIENTE S.A.S', 'FERIA COLEGIO X', 'FERIA']);
});
const r3 = ctx.api_commit({ fileName: 'foto2.png', origin: m.client.selected, groups: [{ mode: 'no_programado', manual: { nombre: 'OTRA', tipo: 'PDV', from: '2026-08-27', to: '2026-08-27' }, rows: rowsFor(m.products.slice(3, 4)) }] });
check('Siguiente ID artificial = MAN-0002', () => assert.strictEqual(r3.eventos[0].id, 'MAN-0002'));
check('ID manual que no existe sin nombre → error claro', () => assert.throws(() => ctx.api_commit({ origin: 'X', groups: [{ mode: 'id_manual', idResumen: 'ACT-7777', rows: rowsFor(m.products.slice(0, 1)) }] }), /no está en "Detalle eventos"/));
const r4 = ctx.api_commit({ fileName: 'f', origin: m.client.selected, groups: [{ mode: 'id_manual', idResumen: 'ACT-7777', manual: { nombre: 'EVENTO VIEJO', tipo: 'PDV', from: '2026-08-01', to: '2026-08-01' }, rows: rowsFor(m.products.slice(4, 5)) }] });
check('ID manual inexistente + nombre → se usa ese ID', () => { assert.strictEqual(r4.eventos[0].id, 'ACT-7777'); assert.strictEqual(pl.data[pl.getLastRow() - 1][2], 'ACT-7777'); });
check('EAN fuera del catálogo → error', () => assert.throws(() => ctx.api_commit({ origin: 'X', groups: [{ mode: 'evento', idResumen: 'ACT-9001', rows: [{ code: '', desc: 'x', qty: 1, ean: '123' }] }] }), /no está en el catálogo/));

console.log('\n[6] Aprendizaje');
fresh();
const ext2 = ctx.api_extract({ kind: 'text', text: 'BLOQ. MAGIC FW 50 TONO MEDIO 2\nLABIAL GRANATE ISDIN 1' });
const m2 = ctx.api_match({ rows: ext2.rows, origin: 'BELLA PIEL', from: '2026-08-27', to: '2026-08-27' });
console.log('  antes:', m2.products.map(p => `${p.desc} → ${p.producto || '-'} [${p.status}]`).join(' | '));
// el usuario corrige/confirma
m2.products[0].ean = '8429420285637';   // FP FWATER MAGIC COLOR MEDIUM
m2.products[1].ean = '8429420292901';   // REPARADOR LABIAL GRANATE
ctx.api_commit({ fileName: 'wa.txt', origin: 'BELLA PIEL', force: true, groups: [{ mode: 'no_programado', manual: { nombre: 'X', tipo: 'PDV', from: '2026-08-27', to: '2026-08-27' }, rows: rowsFor(m2.products, () => true) }] });
fresh();
const m3 = ctx.api_match({ rows: ext2.rows, origin: 'BELLA PIEL', from: '2026-08-27', to: '2026-08-27' });
console.log('  después:', m3.products.map(p => `${p.desc} → ${p.producto} [${p.method}]`).join(' | '));
check('Segunda vez se cruza solo con lo aprendido', () => m3.products.forEach(p => { assert.strictEqual(p.method, 'Aprendido (nombre)'); assert.strictEqual(p.status, 'ok'); }));
check('Alias en LV_Alias', () => assert.strictEqual(ss.getSheetByName('LV_Alias').getLastRow(), 3));

console.log('\n[7] Tabla Excel');
fresh();
const tbl = [['Fecha', 'Articulo', 'Nombre', 'Cantidad'], ['28/08/2026', 'N81123', 'FUSION WATER MAGIC SPF 50+ POR 50ML', '6'], ['28/08/2026', 'N8199', 'FUSION WATER MAGIC COLOR LIGHT SPF 50 50 ML', '3']];
const et = ctx.api_extract({ kind: 'table', rows: tbl, name: 'v.xlsx' });
check('Columnas y filas de Excel', () => { assert.strictEqual(et.rows.length, 2); assert.strictEqual(et.rows[0].code, 'N81123'); assert.strictEqual(et.rows[0].qty, 6); assert.strictEqual(et.dates.from, '2026-08-28'); });

require(process.argv[3] || path.join(__dirname, 'test_inbox.js'))({ ctx, check, assert, fresh, ss, pl, drive, addItem, OCR_TXT, triggers, crypto, setUser: u => { currentUser = u; } });

console.log(`\nResultado: ${pass} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
