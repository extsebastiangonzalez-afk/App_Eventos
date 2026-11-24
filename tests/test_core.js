/**
 * Prueba local de Core.gs con los Master reales.
 * Uso: node tests/test_core.js <carpeta_con_xml_extraido>
 * (El XML se extrae en modo lectura con tests/dump_master_xml.py; la hoja "Control" nunca se extrae.)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Core = require('../apps-script/Core.gs');

const dir = process.argv[2];
if (!dir) { console.error('Falta carpeta de XML'); process.exit(1); }
const rd = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  OK  ', name); }
  catch (e) { fail++; console.log('  FAIL', name, '\n       ', e.message); }
}

// ---------------------------------------------------------------- Masters
console.time('lectura xlsx');
const eanPaths = Core.xlsxSheetPaths(rd('ean__xl_workbook.xml'), rd('ean__xl__rels_workbook.xml.rels'));
const pdvPaths = Core.xlsxSheetPaths(rd('pdv__xl_workbook.xml'), rd('pdv__xl__rels_workbook.xml.rels'));
const file = (pfx, p) => pfx + '__' + p.replace(/\//g, '_');
const eanShared = Core.xlsxSharedStrings(rd('ean__xl_sharedStrings.xml'));
const pdvShared = Core.xlsxSharedStrings(rd('pdv__xl_sharedStrings.xml'));
const sheets = {
  Master_EAN: Core.xlsxSheetRows(rd(file('ean', eanPaths.Master_EAN)), eanShared, 12),
  Master_Puntos: Core.xlsxSheetRows(rd(file('pdv', pdvPaths.Master_Puntos)), pdvShared, 20),
  BD: Core.xlsxSheetRows(rd(file('pdv', pdvPaths.BD)), pdvShared, 17),
  MAESTRO_PDV: Core.xlsxSheetRows(rd(file('pdv', pdvPaths.MAESTRO_PDV)), pdvShared, 23)
};
const cache = Core.buildMasterCache(sheets);
console.timeEnd('lectura xlsx');
console.log('  cache:', { ean: cache.ean.length, puntos: cache.puntos.length, clientesSap: cache.clientesSap.length, maestroPdv: cache.maestroPdv.length },
  'JSON', Math.round(JSON.stringify(cache).length / 1024), 'KB');

console.log('\n[1] Lectura de Master');
check('Rutas de hojas sin tocar "Control"', () => {
  assert.strictEqual(eanPaths.Master_EAN, 'xl/worksheets/sheet2.xml');
  assert.ok(!('Control' in sheets));
});
check('Master_EAN ~5.2k filas (pandas: 5216)', () => assert.ok(Math.abs(cache.ean.length - 5216) <= 2, cache.ean.length));
check('Master_Puntos ~8.5k filas (pandas: 8538)', () => assert.ok(Math.abs(cache.puntos.length - 8538) <= 2, cache.puntos.length));
check('EAN numérico sin notación científica', () => {
  const r = cache.ean.find(x => x[1] === 'N81105');
  assert.deepStrictEqual(r.slice(0, 5), ['DERMORIENTE S.A.S', 'N81105', 'ISDINCEUTICS ESSENTIAL CLEASING X 200 ML', '8429420218758', 'ISDINCEUTICS ESSENTIAL CLEANSING 200ML']);
});

// ---------------------------------------------------------------- Índice
const buTable = [
  ['ISDINCEUTICS', 'ISDINCEUTICS ESSENTIAL CLEANSING 200ML', '', '8429420218758'], ['DERMA', 'UREADIN HAND CREAM REPAIR 50ML', 'UREADIN CREMA DE MANOS', '8429420152120'],
  ['FOTO', 'FP GEL CREAM PEDIATRICS SPF50 250ML', '', '8429420251816'], ['PLAT. WATER', 'FP FUSION WATER MAGIC SPF50 50ML', 'FOTOPROTECTOR FUSION MAGIC', '8429420248977'],
  ['DERMA', 'UREADIN BATH GEL 400ML', 'UREADIN BATH GEL', '8470001649799'], ['FOTO', 'FP INVISIBLE STICK SPF50X10G', '', '8429420280885'],
  ['PLAT. WATER', 'FP FUSION WATER MAGIC GLOW', '', '8429420307254'], ['OTRO', 'ISDIN REPARADOR LABIAL STICK GRANATE 4G', '', '8429420292901'],
  ['FOTO', 'FU ACTIVE UNIFY SPF50+ 50ML', 'act unify', '8429420160750'], ['ISDINCEUTICS', 'ISDINCEUTICS ESSENTIAL PURIFIER', '', '8429420318137'],
  ['FOTO', 'ISDIN COVERAGE 3 SAND SPF50+ 30ML', '', '8429420313736'], ['DERMA', 'UREADIN CREAM 10 300ML', 'UREADIN CREAM 10 300ML', '8429420305489'],
  ['FOTO', 'FU ACTIVE UNIFY COLOR SPF50+ 50ML', 'ACTIVE UNIFY COLOR', '8429420160668'], ['ISDINCEUTICS', 'ISDINCEUTICS FLAVO-C 30ML', 'flavo c serum', '8470001769145'],
  ['ISDINCEUTICS', 'ISDINCEUTICS K-OX EYES 15G', 'ISDINCEUTICS K-OX EYES', '8470001769183'], ['PLAT. WATER', 'FP FUSION WATER COLOR MEDIUM SPF50 50ML', '', '8429420285637'],
  ['DERMA', 'NUTRADEICA FACIAL GEL CREAM 50ML', 'Isdin Nutradeica facial', '8429420171718'], ['PLAT. WATER', 'FP FWATER MAGIC PEDIATRICS SPF50 50ML', '', '8429420285668'],
  ['ISDINCEUTICS', 'ISDINCEUTICS VITAL EYES 15G', 'ISDINCEUTICS VITAL EYES', '8429420203082'], ['ISDINCEUTICS', 'ISDINCEUTICS HYALURONIC CONCENTRATE 30ML', 'hyaluronic concentrate', '8429420200678'],
  ['PLAT. WATER', 'FP FW MAGIC REPAIR COLOR SPF50 50ML', '', '8429420244191'], ['PLAT. WATER', 'FP FUSION WATER COLOR LIGHT SPF50 50ML', '', '8429420285644']
];
console.time('índice');
const idx = Core.buildIndex(cache, buTable, []);
console.timeEnd('índice');
console.log('  productos ISDIN:', Object.keys(idx.products).length, '| nombres comparables:', idx.nameCands.length, '| clientes:', idx.originList.length);

// ---------------------------------------------------------------- Foto del ejemplo
// Transcripción de la imagen que envió el usuario (formato línea por línea).
const OCR_ROWS = `Filtro: 2026-08-27 2026-08-29 grupo:ISDIN COLOMBIA SAS CQ F conpres resumido
Articulo Nombre Cantidad
ISDIN COLOMBIA SAS ISDIN COLOMBIA SAS 4.1.35.38.155
N81105 ISDINCEUTICS ESSENTIAL CLEASING X 200 ML 1.00
N81112 UREADIN HAND CREAM REPAIR PLUS X 50 ML 1.00
N81122 FP GEL CREAM PEDIATRICSSS SPF50+250 ML 4.00
N81123 FUSION WATER MAGIC SPF 50+ POR 50ML 6.00
N8113 UREADIN BATH GEL X400ML 1.00
N81151 FP INVISIBLE STICK SPF50 X 10 G 1.00
N81162 FP FW MAGIC GLOW SPF50 50 ML 1.00
N81165 ISDIN REPARADOR LABIAL STICK GRANATE X 4 GR 3.00
N8117 FOTOULTRA ACTIVE UNIFY S/C 50 ML C/F 1.00
N81170 ISDINCEUTICS ESSENTIAL PURIFIER FOAM CLEANSER X 150 ML 1.00
N81176 ISDIN COVERAGE 3 SAND SPF50+30G 1.00
N81182 UREADIN CREAM 10 300 ML 1.00
N81183 BROCHA PERFECT COVERAGE (POR COMBRA DE BASE COVERAGE) 1.00
N8127 FOTOULTRA 100 ACTIVE UNIFY COLOR SPF50+50 ML 2.00
N8132 ISDINCEUTICS FLAVO-C SERUM X 30ML 1.00
N8133 ISDINCEUTICS REJUVENATE K-OX EYES X15ML 1.00
N8143 FP FW MAGIC COLOR MEDIUM SPF 50+50 ML 1.00
N8154 NUTRADEICA DS GEL CREMA FACIAL X50ML 1.00
N8155 FP MAGIC PEDIATRICS SPF50+50ML 1.00
N8179 ISDINCEUTICS VITAL EYES 15 GR 2.00
N8180 ISDINCEUTICS HYALURONIC CONCENTRATE 30 ML 1.00
N8182 FUSIONWATER MAGIC REPAIR COLOR SPF 50 ML 1.00
N8199 FUSION WATER MAGIC COLOR LIGHT SPF 50 50 ML 3.00`;

const EXPECTED_QTY = 37; // suma de la columna Cantidad, incluida la brocha (1)

console.log('\n[2] Foto (OCR línea por línea)');
const ext = Core.parseOcrText(OCR_ROWS);
check('23 filas extraídas', () => assert.strictEqual(ext.rows.length, 23));
check('Fechas 2026-08-27 → 2026-08-29', () => assert.deepStrictEqual(ext.dates, { from: '2026-08-27', to: '2026-08-29' }));
check('Suma de cantidades = 37', () => assert.strictEqual(ext.rows.reduce((s, r) => s + r.qty, 0), EXPECTED_QTY));
const cl = Core.detectClient(ext.rows, idx, OCR_ROWS);
check('Cliente detectado = DERMORIENTE S.A.S (23/23)', () => { assert.strictEqual(cl.best, 'DERMORIENTE S.A.S'); assert.ok(cl.ranking[0].coverage === 1, JSON.stringify(cl.ranking[0])); });
const matched = ext.rows.map(r => Core.matchProduct(r, cl.best, idx));
check('22 productos cruzados por código, 1 omitido (brocha)', () => {
  assert.strictEqual(matched.filter(m => m.status === 'ok' && m.method === 'Código cliente').length, 22);
  assert.strictEqual(matched.filter(m => m.omit).length, 1);
});
check('Cada EAN coincide con el EAN Master', () => {
  matched.filter(m => !m.omit).forEach(m => {
    const row = cache.ean.find(x => x[0] === 'DERMORIENTE S.A.S' && x[1] === m.code);
    assert.strictEqual(m.ean, row[3], m.code);
  });
});
check('BU desde la tabla SUB FAMILIA (ej. Fusion Water → PLAT. WATER)', () => {
  assert.strictEqual(matched.find(m => m.code === 'N81123').bu, 'PLAT. WATER');
  assert.strictEqual(matched.find(m => m.code === 'N81165').bu, 'OTRO');
});

console.log('\n[3] Foto (OCR por columnas: códigos, luego nombres, luego cantidades)');
const lines = OCR_ROWS.split('\n').slice(3);
const colText = ['Articulo', ...lines.map(l => l.split(' ')[0]), 'Nombre', ...lines.map(l => l.split(' ').slice(1, -1).join(' ')), 'Cantidad', ...lines.map(l => l.split(' ').slice(-1)[0])].join('\n');
const ext2 = Core.parseOcrText(colText);
check('23 filas reconstruidas por columnas', () => assert.strictEqual(ext2.rows.length, 23));
check('Mismos códigos y cantidades', () => ext2.rows.forEach((r, i) => { assert.strictEqual(r.code, ext.rows[i].code); assert.strictEqual(r.qty, ext.rows[i].qty); }));

// Caso real de Google Drive OCR: párrafos con saltos "suaves" (\r / \u000b). La 1.ª fila sale completa
// (código + nombre), los demás nombres en el mismo párrafo, y códigos y cantidades en bloques aparte.
console.log('\n[3b] Foto (OCR de Drive: saltos suaves \\r y bloques mezclados)');
const codesL = lines.map(l => l.split(' ')[0]);
const descsL = lines.map(l => l.split(' ').slice(1, -1).join(' '));
const qtysL = lines.map(l => l.split(' ').slice(-1)[0]);
const driveText = [
  'Filtro: 2026-08-27 2026-08-29 grupo:ISDIN COLOMBIA SAS CQ F conpres resumido',
  'Articulo\rNombre\rCantidad',
  'ISDIN COLOMBIA SAS ISDIN COLOMBIA SAS 4.1.35.38.155',
  codesL[0] + ' ' + descsL[0] + '\r' + descsL.slice(1, 12).join('\r'),
  descsL.slice(12).join('\u000b'),
  codesL.slice(1).join('\r'),
  qtysL.join('\r'),
].join('\n');
const ext3 = Core.parseOcrText(driveText);
check('23 filas, una por producto (sin concatenar nombres)', () => assert.strictEqual(ext3.rows.length, 23));
check('Código, nombre y cantidad de cada fila correctos', () => ext3.rows.forEach((r, i) => {
  assert.strictEqual(r.code, ext.rows[i].code); assert.strictEqual(r.desc, ext.rows[i].desc); assert.strictEqual(r.qty, ext.rows[i].qty);
}));
check('Fechas siguen detectándose', () => assert.deepStrictEqual(ext3.dates, { from: '2026-08-27', to: '2026-08-29' }));

// Caso real reportado: el OCR juntó 3 nombres en UNA línea separados solo por espacios
console.log('\n[3e] OCR con 3 nombres en una sola línea (sin salto)');
const joined = [
  'Articulo', codesL[0] + ' ' + descsL.slice(0, 3).join(' '), descsL.slice(3).join('\n'),
  codesL.slice(1).join('\n'), qtysL.join('\n'),
].join('\n');
const ext6 = Core.parseOcrText(joined);
check('23 filas y cada nombre en su fila', () => {
  assert.strictEqual(ext6.rows.length, 23);
  ext6.rows.forEach((r, i) => { assert.strictEqual(r.code, ext.rows[i].code); assert.strictEqual(r.desc, ext.rows[i].desc, 'fila ' + (i + 1)); assert.strictEqual(r.qty, ext.rows[i].qty); });
});
check('splitByUnits separa los 3 nombres', () => assert.deepStrictEqual(Core.splitByUnits(descsL.slice(0, 3).join(' ')), descsL.slice(0, 3)));
check('splitByUnits no parte nombres normales', () => {
  descsL.forEach(d => assert.strictEqual(Core.splitByUnits(d).length, 1, d));
  ['FOTOULTRA ACTIVE UNIFY S/C 50 ML C/F', 'GEL 200 ML PACK X2', 'CREMA 50ML COLOR LIGHT', 'SERUM 30 ML X 2 UNIDADES'].forEach(d => assert.strictEqual(Core.splitByUnits(d).length, 1, d));
});

console.log('\n[3f] Reacomodo con el EAN Master (nombres corridos aunque la presentación no ayude)');
// Filas con código y cantidad bien, pero la 1.ª trae 3 nombres sin unidades al final y las siguientes corridas
const shifted = ext.rows.map(r => ({ ...r }));
const descNoUnits = ['ISDINCEUTICS ESSENTIAL CLEASING', 'UREADIN HAND CREAM REPAIR PLUS', 'FP GEL CREAM PEDIATRICSSS'];
const origDescs = ext.rows.map(r => r.desc);
const flow = [descNoUnits.join(' ')].concat(origDescs.slice(3));
shifted.forEach((r, i) => { r.desc = flow[i] || ''; });
const re = Core.realignDescs(shifted, 'DERMORIENTE S.A.S', idx);
console.log('  filas cambiadas:', re.changed, '| ej.:', re.rows.slice(0, 4).map(r => r.desc));
check('Cada fila recupera su nombre', () => {
  assert.deepStrictEqual(re.rows.slice(0, 3).map(r => r.desc), descNoUnits);
  re.rows.slice(3).forEach((r, i) => assert.strictEqual(r.desc, origDescs[i + 3], 'fila ' + (i + 4)));
});
check('Si ya cuadran, no cambia nada', () => assert.strictEqual(Core.realignDescs(ext.rows, 'DERMORIENTE S.A.S', idx).changed, 0));

console.log('\n[3c] OCR intercalado (código, nombre y cantidad en líneas alternas)');
const inter = lines.map(l => { const t = l.split(' '); return [t[0], t.slice(1, -1).join(' '), t.slice(-1)[0]].join('\r'); }).join('\n');
const ext4 = Core.parseOcrText(inter);
check('23 filas bien armadas', () => { assert.strictEqual(ext4.rows.length, 23); ext4.rows.forEach((r, i) => { assert.strictEqual(r.code, ext.rows[i].code); assert.strictEqual(r.qty, ext.rows[i].qty); }); });

console.log('\n[3d] Texto pegado sin códigos y presentaciones tipo "X 50"');
const ext5 = Core.parseOcrText('UREADIN HAND CREAM REPAIR PLUS X 50\nFUSION WATER MAGIC 50ML 3\n2026-08-27 2026-08-29');
check('"X 50" no se toma como cantidad; la fecha no se toma como código', () => {
  assert.strictEqual(ext5.rows.length, 1);
  assert.deepStrictEqual(ext5.rows[0], { code: '', desc: 'FUSION WATER MAGIC 50ML', qty: 3 });
});

console.log('\n[3g] Captura de Excel con encabezados, columna repetida y códigos numéricos de 4 dígitos');
{
  const T = [
    ['2395', 'FOTOP ISDIN FUSION WATER COLOR 50 ML', 2], ['3102', 'FOTOP ISDIN GEL CREAM SPF 50+ 250 ML', 1],
    ['3339', 'FOTOP ISDIN FUSION WATERMAG REPAIR COLOR', 2], ['3638', 'ISDINCEUTICS ESSENTIAL CLEANSING 200ML', 1],
    ['3858', 'FOTOPROT ISDIN FUSION WATER MAGIC 50 ML', 3], ['4144', 'FOTOP ISDIN INVISIBLE STICK 10GR', 4],
    ['4162', 'FOTOPROT ISDIN FUSION WAT MAG BY ALCARAZ', 4], ['4250', 'ISDIN FOTOPROTECTOR PEDIATRICS STICK', 2],
    ['4265', 'FOTOP ISDIN FUSION WATER MAGIC GLOW 50ML', 1]];
  const HDR = ['Descuento 1 desc', 'Ite', 'Desc. item', 'Cantidad inv'];
  const CAT = T.map(() => 'ISDIN TENNIS');
  const layouts = {
    'fila por línea': [HDR.join(' '), ...T.map(t => 'ISDIN TENNIS ' + t[0] + ' ' + t[1] + ' ' + t[2])],
    'columnas en bloques': [...HDR, ...CAT, ...T.map(t => t[0]), ...T.map(t => t[1]), ...T.map(t => String(t[2]))],
    'código+nombre en bloque, cantidades aparte': [...HDR, ...CAT, ...T.map(t => t[0] + ' ' + t[1]), ...T.map(t => String(t[2]))],
    // lo que produjo el error reportado: 6 filas juntas en una línea, encabezados después, cantidades al final
    'filas juntas en una línea (caso real)': [T.slice(0, 6).map(t => t[0] + ' ' + t[1]).join(' '), ...HDR, ...CAT,
      ...T.slice(6).map(t => t[0] + ' ' + t[1]), ...T.map(t => String(t[2]))],
    'todo en un párrafo con saltos suaves': [HDR.join('\u000b'), CAT.join('\r'), T.map(t => t[0] + ' ' + t[1]).join(' '), T.map(t => t[2]).join('\r')],
    'fila completa en una línea y juntas': [HDR.join(' '), T.map(t => 'ISDIN TENNIS ' + t[0] + ' ' + t[1] + ' ' + t[2]).join(' ')],
  };
  Object.keys(layouts).forEach(name => {
    const e = Core.parseOcrText(layouts[name].join('\n'));
    check(name + ': 9 filas con código, nombre y cantidad', () => {
      assert.strictEqual(e.rows.length, 9, JSON.stringify(e.rows.map(r => r.code + '|' + r.desc + '|' + r.qty)));
      e.rows.forEach((r, i) => assert.deepStrictEqual([r.code, r.desc, r.qty], T[i], 'fila ' + (i + 1)));
    });
  });
  check('Encabezados reconocidos (también recortados)', () => {
    ['Descuento 1 desc', 'Ite', 'Desc. item', 'Cantidad inv', 'Cod. Art', 'Und vendidas'].forEach(h => assert.ok(Core.isHeaderLine(h), h));
    ['ISDIN TENNIS', 'FOTOP ISDIN FUSION WATER COLOR 50 ML', 'UREADIN CREAM 10 300 ML'].forEach(h => assert.ok(!Core.isHeaderLine(h), h));
  });
  check('Excel con las mismas columnas: descripción = "Desc. item", no "Descuento 1 desc"', () => {
    const tbl = [['Descuento 1 descripcion', 'Item', 'Desc. item', 'Cantidad inventario', 'Valor'], ...T.map(t => ['ISDIN TENNIS', +t[0], t[1], t[2], 99000])];
    const det = Core.detectTable(tbl, idx);
    assert.strictEqual(det.map.desc, 2); assert.strictEqual(det.map.qty, 3);
    const rows = Core.tableToRows(tbl, det).rows || Core.tableToRows(tbl, det);
    assert.strictEqual(rows[0].desc, T[0][1]);
  });
  check('Los casos anteriores no deducen códigos numéricos',() => assert.strictEqual(Core.inferNumericCodeLen(OCR_ROWS.split('\n')), 0));
}

console.log('\n[4] Sin códigos: solo nombres del cliente (prueba del cruce aproximado)');
const nameOnly = ext.rows.filter(r => r.code !== 'N81183').map(r => ({ code: '', desc: r.desc, qty: r.qty }));
const m2 = nameOnly.map(r => Core.matchProduct(r, 'DERMORIENTE S.A.S', idx));
let right = 0, autoRight = 0, autoWrong = 0;
m2.forEach((m, i) => {
  const truth = matched.filter(x => !x.omit)[i].ean;
  if (m.ean === truth) right++;
  if (m.status === 'ok') { if (m.ean === truth) autoRight++; else { autoWrong++; console.log('       auto-incorrecto:', m.desc, '→', m.producto); } }
});
console.log(`  aciertos top-1: ${right}/22 | automáticos correctos: ${autoRight} | automáticos incorrectos: ${autoWrong}`);
check('Top-1 por nombre ≥ 20/22', () => assert.ok(right >= 20, right));
check('Ningún cruce automático incorrecto', () => assert.strictEqual(autoWrong, 0));
// Mismo ejercicio con un cliente distinto (los nombres no están en su lista) → depende del catálogo ISDIN
const m3 = nameOnly.map(r => Core.matchProduct(r, 'BELLA PIEL', idx));
let right3 = 0, wrong3 = 0;
m3.forEach((m, i) => { const t = matched.filter(x => !x.omit)[i].ean; if (m.ean === t) right3++; else if (m.status === 'ok') { wrong3++; console.log('       auto-incorrecto (otro cliente):', m.desc, '→', m.producto); } });
console.log(`  con catálogo general (cliente sin esas descripciones): top-1 ${right3}/22, automáticos incorrectos ${wrong3}`);

console.log('\n[5] Aprendizaje (alias)');
const idxA = Core.buildIndex(cache, buTable, [['PRODUCTO', 'BELLA PIEL', Core.aliasKeyProduct('', 'BLOQ FUSION MAGIC 50'), '8429420248977', 'FP FUSION WATER MAGIC SPF50 50ML']]);
const ma = Core.matchProduct({ code: '', desc: 'Bloq. Fusion Magic 50', qty: 2 }, 'BELLA PIEL', idxA);
check('Una corrección guardada se aplica la próxima vez', () => { assert.strictEqual(ma.ean, '8429420248977'); assert.strictEqual(ma.method, 'Aprendido (nombre)'); });

console.log('\n[6] Eventos');
// Filas reales vistas en "Detalle eventos" + 3 filas FICTICIAS de DERMORIENTE (solo para la prueba).
const H = ['ID RESUMEN', 'ID EVENTO', 'SOLICITANTE', 'FECHA SOLICITUD', 'MES', 'FECHA INICIO', 'FECHA FIN', 'KAM', 'SAP ID', 'DIAS', 'CLIENTE', 'DESTINO', 'ID PDV', 'PDV', 'PDV MANUAL', 'DIRECCION', 'CIUDAD', 'TIPO EVENTO', 'HORA INICIO', 'HORA FIN ', 'MATERIAL', 'MATERIAL LIMPIEZA', 'ESTADO', 'COMENTARIO ESTADO', 'TIPO DE DERMO ', 'NOMBRE DERMO'];
const row = (o) => H.map(h => o[h] || '');
const evValues = [H,
  row({ 'ID RESUMEN': 'EVT-0004', 'ID EVENTO': 'EVT-0002', SOLICITANTE: 'sandra.runza@isdin.com', MES: 'enero', 'FECHA INICIO': '30/01/2026', 'FECHA FIN': '31/01/2026', 'SAP ID': '11049529', DIAS: '2', CLIENTE: 'FARMATODO COLOMBIA S.A.', 'PDV': '1061 - FARMATODO ATLANTIS', 'TIPO EVENTO': 'TOMA PDV', ESTADO: 'APROBADO', 'NOMBRE DERMO': 'PRIETO RAMIREZ VANESSA' }),
  row({ 'ID RESUMEN': 'ACT-9001', 'ID EVENTO': 'EVT-9001', SOLICITANTE: 'prueba@isdin.com', MES: 'agosto', 'FECHA INICIO': '27/08/2026', 'FECHA FIN': '29/08/2026', DIAS: '3', CLIENTE: 'DERMORIENTE S.A.S', PDV: 'DERMORIENTE CENTRO (FICTICIO)', 'TIPO EVENTO': 'PDV', ESTADO: 'APROBADO', 'NOMBRE DERMO': 'DERMO FICTICIA' }),
  row({ 'ID RESUMEN': 'ACT-9002', 'ID EVENTO': 'EVT-9002', SOLICITANTE: 'prueba@isdin.com', MES: 'julio', 'FECHA INICIO': '10/07/2026', 'FECHA FIN': '11/07/2026', DIAS: '2', CLIENTE: 'DERMORIENTE S.A.S', PDV: 'DERMORIENTE NORTE (FICTICIO)', 'TIPO EVENTO': 'PDV', ESTADO: 'APROBADO' }),
  row({ 'ID RESUMEN': 'ACT-9003', 'ID EVENTO': 'EVT-9003', SOLICITANTE: 'prueba@isdin.com', MES: 'agosto', 'FECHA INICIO': '28/08/2026', 'FECHA FIN': '28/08/2026', DIAS: '1', CLIENTE: 'DERMORIENTE S.A.S', PDV: 'FERIA (FICTICIO)', 'TIPO EVENTO': 'FERIA', ESTADO: 'CANCELADO' })
];
const events = Core.parseEvents(evValues);
check('4 eventos leídos con fechas ISO', () => { assert.strictEqual(events.length, 4); assert.strictEqual(events[1].inicio, '2026-08-27'); });
const cands = Core.matchEvents({ origin: cl.best, from: ext.dates.from, to: ext.dates.to }, events, idx);
console.log('  candidatos:', cands.map(c => `${c.ev.idResumen} ${c.score} (cli ${c.clientScore}, fecha ${c.dateScore})`).join(' | '));
check('1er candidato = ACT-9001 (mismo cliente y fechas)', () => assert.strictEqual(cands[0].ev.idResumen, 'ACT-9001'));
check('Excluye otros clientes y fechas lejanas', () => assert.ok(!cands.some(c => c.ev.idResumen === 'EVT-0004' || c.ev.idResumen === 'ACT-9002')));
check('Evento cancelado queda por debajo', () => assert.ok(cands.findIndex(c => c.ev.idResumen === 'ACT-9003') > 0));
check('Cliente con nombre distinto: "LOCATEL (BRECCIA SALUD S A S)" ↔ "BRECCIA SALUD S A S"', () => {
  const ev = Core.parseEvents([H, row({ 'ID RESUMEN': 'ACT-0906', 'FECHA INICIO': '01/10/2026', 'FECHA FIN': '01/10/2026', CLIENTE: 'BRECCIA SALUD S A S', PDV: 'AUTONIZA 170', 'TIPO EVENTO': 'EMPRESARIAL', ESTADO: 'APROBADO' })]);
  const c = Core.matchEvents({ origin: 'LOCATEL (BRECCIA SALUD S A S)', from: '2026-10-01', to: '2026-10-01' }, ev, idx);
  assert.strictEqual(c.length, 1);
});
console.log('  SAP de DERMORIENTE en PDV Master (BD):', idx.sapByOrigin['DERMORIENTE S.A.S'] || '(no está)');

console.log('\n[6b] ID RESUMEN en el nombre del archivo o carpeta');
const idOf = n => { const r = Core.findIdInName(n, events); return r && r.ev ? r.ev.idResumen : null; };
check('Variantes de escritura del ID', () => {
  ['ACT-9001.jpg', 'act 9001.png', 'ACT_9001 ventas dermoriente.xlsx', 'ACT9001.pdf', 'Ventas ACT-9001 (2).jpeg', 'ACT-09001.jpg', 'evt-4.csv']
    .forEach(n => assert.strictEqual(idOf(n), n === 'evt-4.csv' ? 'EVT-0004' : 'ACT-9001', n));
});
check('Carpeta con el ID y foto con nombre genérico', () => assert.strictEqual(idOf('ACT-9001/IMG_2045.jpg'), 'ACT-9001'));
check('El nombre del archivo pesa más que la carpeta', () => {
  const r = Core.findIdInName('ACT-9002/ACT-9001.jpg', events);
  assert.strictEqual(r.ev.idResumen, 'ACT-9001'); assert.deepStrictEqual(r.others, ['ACT-9002']);
});
check('Sin ID: no inventa (IMG_2045, WhatsApp Image 2026-08-29, FACT-9001)', () => {
  ['IMG_2045.jpg', 'WhatsApp Image 2026-08-29 at 10.15.32.jpeg', 'foto.png', 'FACT-9001.jpg', 'ACT-90011.jpg'].forEach(n => assert.strictEqual(idOf(n), null, n));
});
check('ID con formato válido pero inexistente → avisa', () => assert.strictEqual(Core.findIdInName('ACT-777.jpg', events).notFound, 'ACT-0777'));
check('Evento → cliente del EAN Master (por nombre si no hay SAP)', () => {
  const o = Core.originForEvent(events[1], idx);
  assert.strictEqual(o.origin, 'DERMORIENTE S.A.S');
});
check('Evento → cliente del EAN Master por SAP ID', () => {
  const sapEv = Object.assign({}, events[0]); // FARMATODO, SAP 11049529
  const o = Core.originForEvent(sapEv, idx);
  console.log('       FARMATODO SAP 11049529 →', o);
  assert.ok(o.origin && /FARMATODO/i.test(o.origin), JSON.stringify(o));
});

console.log('\n[6c] Carpeta de ventas: qué ya está cargado y qué se carga solo');
const stats = Core.plantillaStats([['ACT-0364', 8], ['act-0364', '6'], ['ACT-0152', 100], ['', 5], ['TRUCK MEDIPIEL', 2]]);
check('Filas y unidades por ID RESUMEN en la PLANTILLA', () => {
  assert.deepStrictEqual(stats['ACT-0364'], { filas: 2, unidades: 14 });
  assert.deepStrictEqual(stats['ACT-0152'], { filas: 1, unidades: 100 });
  assert.ok(!stats['']);
});
check('Enlace de carpeta de Drive → ID', () => {
  assert.strictEqual(Core.folderIdFromUrl('https://drive.google.com/drive/folders/1AbC_dEf-1234567890xyz?usp=sharing'), '1AbC_dEf-1234567890xyz');
  assert.strictEqual(Core.folderIdFromUrl('https://drive.google.com/drive/u/0/folders/1AbC_dEf-1234567890xyz'), '1AbC_dEf-1234567890xyz');
  assert.strictEqual(Core.folderIdFromUrl('1AbC_dEf-1234567890xyz'), '1AbC_dEf-1234567890xyz');
  assert.strictEqual(Core.folderIdFromUrl('hola'), '');
});
const okMatch = {
  idFromName: { idResumen: 'ACT-9001', estado: 'APROBADO', origin: 'DERMORIENTE S.A.S', conflict: false },
  groups: [{ rows: [] }],
  products: matched.map(m => ({ ...m }))
};
check('Auto: todo por código y evento sin cargar → se carga solo', () => assert.deepStrictEqual(Core.autoDecision(okMatch, {}), { ok: true, reason: '22 productos cruzados por código' }));
check('Auto: evento que ya tiene filas en la PLANTILLA → revisar', () => {
  const d = Core.autoDecision(okMatch, { 'ACT-9001': { filas: 22, unidades: 36 } });
  assert.strictEqual(d.ok, false); assert.ok(/ya tiene 22 filas/.test(d.reason));
});
check('Auto: un producto por nombre aproximado → revisar', () => {
  const m = { ...okMatch, products: okMatch.products.map((p, i) => i === 0 ? { ...p, method: 'Nombre aproximado' } : p) };
  assert.ok(/1 de 22 productos/.test(Core.autoDecision(m, {}).reason));
});
check('Auto: sin ID / ID inexistente / cancelado / otro cliente / varios PDV → revisar', () => {
  assert.ok(/Sin ID/.test(Core.autoDecision({ ...okMatch, idFromName: null }, {}).reason));
  assert.ok(/ACT-0777/.test(Core.autoDecision({ ...okMatch, idFromName: { notFound: 'ACT-0777' } }, {}).reason));
  assert.ok(/CANCELADO/.test(Core.autoDecision({ ...okMatch, idFromName: { ...okMatch.idFromName, estado: 'CANCELADO' } }, {}).reason));
  assert.ok(/otro cliente/.test(Core.autoDecision({ ...okMatch, idFromName: { ...okMatch.idFromName, conflict: true, codesOrigin: 'X' } }, {}).reason));
  assert.ok(/varios puntos/.test(Core.autoDecision({ ...okMatch, groups: [{}, {}] }, {}).reason));
});

console.log('\n[6d] Reporte de eventos del mes');
const rep = Core.monthReport(events, { 'ACT-9001': { filas: 22, unidades: 36 } }, '2026-08');
check('Agosto 2026: solo eventos del mes, sin cancelados, con el cargado marcado', () => {
  assert.deepStrictEqual(rep.rows.map(r => r.idResumen), ['ACT-9001']);
  assert.strictEqual(rep.rows[0].cargado, true); assert.strictEqual(rep.cargados, 1); assert.strictEqual(rep.faltan, 0);
  assert.deepStrictEqual([rep.rows[0].mes, rep.rows[0].dias, rep.rows[0].solicitante, rep.rows[0].cliente, rep.rows[0].pdv, rep.rows[0].tipo, rep.rows[0].dermo],
    ['AGOSTO', 3, 'prueba@isdin.com', 'DERMORIENTE S.A.S', 'DERMORIENTE CENTRO (FICTICIO)', 'PDV', 'DERMO FICTICIA']);
});
check('Con "incluir cancelados" aparece ACT-9003 (falta cargar), ordenado por fecha', () => {
  const r2 = Core.monthReport(events, {}, '2026-08', { incluirCancelados: true });
  assert.deepStrictEqual(r2.rows.map(r => r.idResumen + (r.cargado ? '✓' : '')), ['ACT-9001', 'ACT-9003']);
  assert.strictEqual(r2.faltan, 2);
});
check('Otro mes y mes inválido', () => {
  assert.deepStrictEqual(Core.monthReport(events, {}, '2026-07').rows.map(r => r.idResumen), ['ACT-9002']);
  assert.throws(() => Core.monthReport(events, {}, 'julio'), /Mes no válido/);
});

console.log('\n[7] Filas para la PLANTILLA (A:L)');
const out = Core.buildTemplateRows(matched, cands[0].ev, null);
check('22 filas (sin la brocha) y 12 columnas', () => { assert.strictEqual(out.length, 22); out.forEach(r => assert.strictEqual(r.length, 12)); });
check('Unidades = 36 (37 − brocha)', () => assert.strictEqual(out.reduce((s, r) => s + r[9], 0), 36));
check('Encabezado del evento', () => assert.deepStrictEqual(out[0].slice(0, 7), ['AGOSTO', 3, 'ACT-9001', 'prueba@isdin.com', 'DERMORIENTE S.A.S', 'DERMORIENTE CENTRO (FICTICIO)', 'PDV']));
console.log('  ej.:', JSON.stringify(out[3]));
const outM = Core.buildTemplateRows(matched, null, { id: Core.nextManualId(['MAN-0001', 'MAN-0007', 'ACT-1']), nombre: 'FERIA COLEGIO X', tipo: 'FERIA', from: '2026-08-27', to: '2026-08-29', cliente: 'DERMORIENTE S.A.S', solicitante: 'usuario@isdin.com' });
check('Evento no programado → MAN-0008, MES/DIAS calculados', () => assert.deepStrictEqual(outM[0].slice(0, 7), ['AGOSTO', 3, 'MAN-0008', 'usuario@isdin.com', 'DERMORIENTE S.A.S', 'FERIA COLEGIO X', 'FERIA']));

console.log('\n[8] Tabla Excel con detalle de PDV (sintética, con códigos reales de Master_Puntos)');
const pts = cache.puntos.filter(p => p[0] === 'DROGUERIAS CRUZ VERDE SAS' && p[1]).slice(0, 2);
const cvCodes = cache.ean.filter(e => e[0] === 'DROGUERIAS CRUZ VERDE SAS' && /^\d{6,14}$/.test(e[3])).slice(0, 3);
const table = [['Reporte ventas evento'], [], ['Fecha', 'Cod Sucursal', 'Nombre Sucursal', 'PLU', 'Descripción', 'Unidades'],
  ...pts.flatMap((p, i) => cvCodes.map((e, j) => ['15/09/2026', p[1], p[2], e[1], e[2], String(i + j + 1)]))];
const det = Core.detectTable(table, idx);
check('Detecta encabezado y columnas', () => {
  assert.strictEqual(det.headerRow, 2);
  assert.deepStrictEqual([det.map.code, det.map.desc, det.map.qty, det.map.pdvCode, det.map.pdv, det.map.date], [3, 4, 5, 1, 2, 0]);
});
const tr = Core.tableToRows(table, det);
check('6 filas, fecha y PDV', () => { assert.strictEqual(tr.rows.length, 6); assert.strictEqual(tr.dates.from, '2026-09-15'); assert.strictEqual(tr.rows[0].pdvCode, pts[0][1]); });
const pr = Core.resolvePdv('DROGUERIAS CRUZ VERDE SAS', pts[0][1], pts[0][2], idx);
check('PDV del cliente → ISDIN_PDV_DESC del PDV Master', () => assert.strictEqual(pr.isdinDesc, pts[0][4]));
console.log('  PDV:', pts[0][1], pts[0][2], '→', pr);
const pr2 = Core.resolvePdv('DROGUERIAS CRUZ VERDE SAS', '', pts[1][2].toLowerCase().replace(/_/g, ' '), idx);
check('PDV solo por nombre (escrito distinto) → mismo PDV', () => assert.strictEqual(pr2.isdinDesc, pts[1][4]));

console.log('\n[9] Consolidado: varios eventos en un mismo archivo');
check('Tabla con columna "ID RESUMEN" (celdas combinadas por PDV) → cada fila con su evento', () => {
  const t = [
    ['Ventas consolidadas ACT-9001 y ACT-9002'],
    ['PDV', 'ID RESUMEN', 'CODIGO', 'DESCRIPCION', 'CANTIDAD'],
    ['CENTRO', 'ACT-9001', '3855', 'ISDIN FOT WETSKIN PEDIATRIC SPRAY X250ML', '2'],
    ['CENTRO', '', '5518', 'ISDIN LAMBDAPIL SHAMPOO ANTICAIDA X200ML', '1'],
    ['TOTAL', '', '', '', '3'],
    ['NORTE', 'act 9002', '3606', 'ISDINCEUTICS FLAVO-C SERUM X 30ML', '4'],
    ['NORTE', '', '3284', 'ISDIN FOTO ACTIV UNIFY FLUID COLOR X50ML', '1']
  ];
  const det = Core.detectTable(t, idx);
  assert.strictEqual(det.map.evento, 1); assert.strictEqual(det.map.qty, 4); assert.strictEqual(det.map.desc, 3);
  const tr = Core.tableToRows(t, det);
  assert.deepStrictEqual(tr.rows.map(r => r.eventId), ['ACT-9001', 'ACT-9001', 'act 9002', 'act 9002']);
  assert.deepStrictEqual(tr.titleIds, ['ACT-9001', 'ACT-9002']);
  const res = Core.eventResolver(events, []);
  assert.strictEqual(res('act 9002').id, 'ACT-9002'); assert.strictEqual(res('EVT-9001').id, 'ACT-9001');
  assert.strictEqual(res('ACT-7777').ev, null); assert.strictEqual(res('ACT-7777').id, 'ACT-7777');
});
check('Columna "EVENTO" con nombres de evento → no se toma como ID', () => {
  const t = [['EVENTO', 'CODIGO', 'DESCRIPCION', 'CANTIDAD'], ['FERIA CENTRO', '3855', 'ISDIN FOT WETSKIN', '2'], ['FERIA CENTRO', '5518', 'LAMBDAPIL', '1']];
  assert.strictEqual(Core.detectTable(t, idx).map.evento, -1);
});
check('Número suelto en la columna → evento del nombre del archivo', () => {
  const nameEvs = Core.findIdInName('Ventas ACT-9001 ACT-9002.xlsx', events).evs;
  assert.strictEqual(nameEvs.length, 2);
  const res = Core.eventResolver(events, nameEvs);
  assert.strictEqual(res('9002').id, 'ACT-9002'); assert.strictEqual(res('1234'), null);
});
check('Tabla con filas-título por evento (sin columna)', () => {
  const t = [['CODIGO', 'DESCRIPCION', 'CANTIDAD'], ['ACT-9001 DROGUERIA CENTRO', '', ''], ['3855', 'ISDIN FOT WETSKIN', '2'],
    ['', 'Evento ACT-9002', ''], ['3606', 'FLAVO-C SERUM', '4']];
  const det = Core.detectTable(t, idx), tr = Core.tableToRows(t, det);
  assert.deepStrictEqual(tr.rows.map(r => [r.code, r.eventId]), [['3855', 'ACT-9001'], ['3606', 'ACT-9002']]);
});
check('OCR: ID en cada fila (inicio o final de la línea)', () => {
  const r = Core.parseOcrText('Codigo Descripcion Cant Evento\n3855 ISDIN FOT WETSKIN PEDIATRIC SPRAY X250ML 2 ACT-9001\n5518 ISDIN LAMBDAPIL SHAMPOO X200ML 1 ACT-9001\nACT-9002 3606 ISDINCEUTICS FLAVO-C SERUM X 30ML 4').rows;
  assert.deepStrictEqual(r.map(x => [x.code, x.qty, x.eventId]), [['3855', 2, 'ACT-9001'], ['5518', 1, 'ACT-9001'], ['3606', 4, 'ACT-9002']]);
});
check('OCR: secciones "ACT-…" con sus filas debajo', () => {
  const r = Core.parseOcrText('Ventas ACT-9001 / ACT-9002\nACT-9001 DROGUERIA CENTRO\n3855 ISDIN FOT WETSKIN X250ML 2\n5518 LAMBDAPIL SHAMPOO X200ML 1\nACT-9002 DROGUERIA NORTE\n3606 FLAVO-C SERUM X 30ML 4').rows;
  assert.deepStrictEqual(r.map(x => [x.code, x.qty, x.eventId]), [['3855', 2, 'ACT-9001'], ['5518', 1, 'ACT-9001'], ['3606', 4, 'ACT-9002']]);
});
check('OCR: columna de IDs leída en bloque aparte → por posición', () => {
  const r = Core.parseOcrText('3855 ISDIN FOT WETSKIN X250ML 2\n5518 LAMBDAPIL SHAMPOO X200ML 1\n3606 FLAVO-C SERUM X 30ML 4\nACT-9001\nACT-9001\nACT-9002').rows;
  assert.deepStrictEqual(r.map(x => x.eventId), ['ACT-9001', 'ACT-9001', 'ACT-9002']);
});
console.log('\n[10] Fotos sin código: solo Descripción y UDS → Fuzzy Lookup por nombre contra el EAN Master');
const NOCODE = [
  ['ISDINCEUTICS HYALURONIC EYES 15G', '8429420281103'], ['ISDIN FUSION WATER MEDIO SPF50+ X50ML', '8429420285637'],
  ['ISDIN FOT TRANSP WETSKIN SPRAY X250ML', '8429420187917'], ['ISDIN FOTPROTECT HYDROOIL SPF 30 X 200ML', '8429420161245'],
  ['ISDIN REPAR LABIAL FLUIDO 10ML', '8470001507983'], ['ISDINCEU MOISTURE OILY CREMA 50GR', '8429420223349'],
  ['ISDINCEUTICS ESSENTIAL SCRUB 100ML', '8429420308794'], ['ISDIN FOTOPROTE BARRA LABIAL SPF 30 X4GR', '8429420268296'],
  ['ISDIN REPARADOR LABIAL STICK GRANATE 4GR', '8429420292901'], ['ISDIN SOLUCION MICELLAR 4 IN1 X 400ML', '8429420128644'],
  ['ISDIN FOTOPROT PEDIATRIC FUSION WA X50ML', '8429420285668'], ['ISDINC HYALURONIC CONCENTRAT SERUM X30ML', '8429420200678'],
  ['ISDINCEUTICS ESSENTIAL CLEANS OIL 200ML', '8429420218758'], ['ISDIN FOTO INVISIBLE STICK SPF50 X10G', '8429420280885'],
  ['ISDIN FUSION MAGIC WATER SPF50+ X 50ML', '8429420248977'], ['ISDIN FUSION WATER LIGHT SPF50+  X50ML', '8429420285644']
];
check('OCR "Descripción | UDS" (filas y columnas) → 24 filas con su cantidad, sin juntar nada', () => {
  const names = NOCODE.map(x => x[0]).concat(NOCODE.slice(0, 8).map(x => x[0]));
  const q = names.map((_, i) => (i === 10 ? 2 : 1));
  [ 'Descripción UDS\n' + names.map((n, i) => n + ' ' + q[i]).join('\n'), 'Descripción\n' + names.join('\n') + '\nUDS\n' + q.join('\n') ].forEach(t => {
    const r = Core.parseOcrText(t).rows;
    assert.strictEqual(r.length, names.length);
    r.forEach((x, i) => { assert.strictEqual(x.qty, q[i], 'fila ' + (i + 1)); assert.strictEqual(Core.normText(x.desc), Core.normText(names[i])); });
  });
});
check('OCR real: varios nombres juntos en una línea + "OISDIN" + cantidades aparte → una fila por producto', () => {
  const N = NOCODE.map(x => x[0]);
  const t = ['Descripción', N[0], N.slice(1, 6).join(' '), N.slice(6, 8).join(' '), 'O' + N.slice(8, 11).join(' '), N.slice(11, 16).join(' '), 'UDS']
    .concat(N.map((_, i) => (i === 10 ? '2' : '1'))).join('\n');
  const r = Core.parseOcrText(t).rows;
  assert.strictEqual(r.length, 16);
  r.forEach((x, i) => { assert.strictEqual(Core.normText(x.desc), Core.normText(N[i]), 'fila ' + (i + 1)); assert.strictEqual(x.qty, i === 10 ? 2 : 1); });
  assert.strictEqual(Core.matchProduct(r[8], '', idx).ean, NOCODE[8][1]);
});
check('Fuzzy Lookup: los 16 nombres abreviados → EAN correcto', () => {
  NOCODE.forEach(([n, ean]) => assert.strictEqual(Core.matchProduct({ code: '', desc: n, qty: 1 }, '', idx).ean, ean, n));
});
check('Fuzzy Lookup pesa todas las palabras: TRANSP + WETSKIN + 250ML ganan a un 50ML parecido', () => {
  const c = Core.searchByName('ISDIN FOT TRANSP WETSKIN SPRAY X250ML', idx, '', 3);
  assert.ok(/TRANSPARENT SPRAY WS/.test(c[0].producto) && /250ML/.test(c[0].producto), c[0].producto);
});
console.log('\n[11] Foto de una tabla ancha leída por columnas (PLU, DESCRIPCIÓN, …, EAN13, …, COSTO, UNIDAD)');
// Tabla tal como la arma el lector por columnas del navegador (con sus errores de lectura reales)
const fotoGrid = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'foto_tabla_columnas.json'), 'utf8'));
const fDet = Core.detectTable(fotoGrid, idx);
const fRows = Core.tableToRows(fotoGrid, fDet).rows;
const fCli = Core.detectClient(fRows, idx, '');
check('Columnas: PLU = código del cliente, EAN13 = EAN, descripción y la última (UNIDAD) = cantidad', () => {
  const H = fotoGrid[fDet.headerRow];
  assert.ok(/DESC/i.test(H[fDet.map.desc]), H[fDet.map.desc]);
  assert.strictEqual(fotoGrid[fDet.headerRow + 1][fDet.map.code], '1302547');
  assert.strictEqual(fotoGrid[fDet.headerRow + 1][fDet.map.ean], '8429420292888');
  assert.strictEqual(fDet.map.qty, fotoGrid[fDet.headerRow + 1].length - 1);
});
check('No toma el COSTO ($ 25.681) ni una columna constante (COD PROVEE 6759) como cantidad o código', () => {
  assert.deepStrictEqual(fRows.map(r => r.qty), [2, 1, 3, 1, 1, 1, 1, 2]);
  assert.ok(fRows.every(r => r.code !== '6759'));
});
check('Cliente por PLU (CAFAM) y los 8 productos cruzados, aun con EAN y PLU mal leídos', () => {
  assert.ok(/CAFAM/.test(fCli.best), fCli.best);
  const ms = fRows.map(r => Core.matchProduct(r, fCli.best, idx));
  assert.ok(ms.every(m => m.status === 'ok'), ms.map(m => m.status + ' ' + m.method).join(' | '));
  assert.strictEqual(ms[1].ean, '8429420280885'); assert.strictEqual(ms[7].ean, '8429420160668');
});
check('EAN con un dígito mal leído → se corrige con el dígito verificador', () => {
  const m = Core.matchProduct({ code: '', ean: '8429420200885', desc: 'FOTOPROTECTOR ISDIN SFP50 INVISIBLE STIC', qty: 1 }, '', idx);
  assert.strictEqual(m.ean, '8429420280885'); assert.strictEqual(m.status, 'ok'); assert.ok(/corrección OCR/.test(m.method));
});
check('Encabezado elegido a mano → columnas recalculadas con esa fila', () => {
  const d = Core.detectTable(fotoGrid, idx, fDet.headerRow);
  assert.strictEqual(d.headerRow, fDet.headerRow); assert.strictEqual(Core.detectTable(fotoGrid, idx, -1).headerRow, -1);
});
check('Auto-carga: un consolidado nunca se carga solo', () => {
  const d = Core.autoDecision({ idFromName: { idResumen: 'ACT-9001' }, groups: [{ eventId: 'ACT-9001' }, { eventId: 'ACT-9002' }], products: [] }, {});
  assert.ok(!d.ok && /Consolidado de 2 eventos/.test(d.reason));
});

console.log(`\nResultado: ${pass} OK, ${fail} FALLAS`);
process.exit(fail ? 1 : 0);
