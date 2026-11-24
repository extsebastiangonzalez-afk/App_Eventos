/** Pruebas de la carpeta de ventas (bandeja). Se ejecuta desde test_server.js con sus simulaciones. */
module.exports = function ({ ctx, check, assert, fresh, ss, pl, drive, addItem, OCR_TXT, triggers, setUser }) {
console.log('\n[8] Carpeta de ventas (bandeja)');
fresh();
setUser('user@isdin.com');
check('Usuario no admin no puede configurar la carpeta', () => assert.throws(() => ctx.api_setFolder('https://drive.google.com/drive/folders/ROOTFOLDER01'), /administrador/));
setUser('admin@isdin.com');
check('Sin carpeta configurada: bandeja vacía', () => assert.strictEqual(ctx.api_inbox().folder, null));
check('Enlace de un archivo (no carpeta) → error', () => assert.throws(() => ctx.api_setFolder('https://drive.google.com/drive/folders/IMAGEFILE001'), /no es de una carpeta/));
const fo = ctx.api_setFolder('https://drive.google.com/drive/folders/ROOTFOLDER01?usp=sharing');
check('Carpeta configurada', () => { assert.strictEqual(fo.id, 'ROOTFOLDER01'); assert.strictEqual(fo.name, 'VENTAS EVENTOS'); });

const st = inb => Object.fromEntries(inb.files.map(f => [f.path, f.estado]));
const inb1 = ctx.api_inbox();
console.log('  ', JSON.stringify(st(inb1)));
check('Lista archivos de la carpeta y subcarpetas con su estado', () => {
  assert.deepStrictEqual(st(inb1), {
    'ACT-0791 ventas.csv': 'EVENTO YA CARGADO', 'foto sin id.png': 'PENDIENTE', 'notas.docx': 'NO SOPORTADO',
    'ACT-9005/IMG_2045.jpg': 'PENDIENTE', 'ACT-9005/IMG_2046.jpg': 'PENDIENTE'
  });
});
check('ID RESUMEN desde la subcarpeta y evento ya cargado (carga anterior al lector)', () => {
  const f = inb1.files.find(x => x.path === 'ACT-9005/IMG_2045.jpg');
  assert.strictEqual(f.idResumen, 'ACT-9005'); assert.strictEqual(f.cliente, 'DERMORIENTE S.A.S');
  const c = inb1.files.find(x => x.path === 'ACT-0791 ventas.csv');
  assert.ok(/1 filas · 1 unidades ya en la PLANTILLA \(carga anterior al lector\)/.test(c.detalle), c.detalle);
});
check('LV_Archivos guarda el estado', () => assert.strictEqual(ss.getSheetByName('LV_Archivos').getLastRow(), 6));

const plRows0 = pl.getLastRow();
const auto = ctx.api_inboxAuto();
console.log('  ', JSON.stringify(auto));
check('Carga automática: la 1.ª foto de ACT-9005 se carga sola (22 filas)', () => {
  assert.strictEqual(JSON.stringify(auto.cargados), JSON.stringify([{ name: 'ACT-9005/IMG_2045.jpg', id: 'ACT-9005', filas: 22 }]));
  assert.strictEqual(pl.getLastRow(), plRows0 + 22);
  assert.strictEqual(pl.data[pl.getLastRow() - 1][2], 'ACT-9005');
  assert.strictEqual(pl.data[pl.getLastRow() - 1][5], 'DERMORIENTE SUR (FICTICIO)');
});
check('La 2.ª foto del mismo evento queda para revisar (el evento ya tiene filas)', () => {
  const r = auto.revisar.find(x => x.name === 'ACT-9005/IMG_2046.jpg');
  assert.ok(r && /ya tiene 22 filas/.test(r.reason), JSON.stringify(auto.revisar));
});
check('Foto sin ID queda para revisar; sin errores', () => {
  assert.ok(auto.revisar.find(x => x.name === 'foto sin id.png'));
  assert.strictEqual(auto.errores.length, 0, JSON.stringify(auto.errores));
});
check('LV_Cargas guarda el ID y la versión del archivo de Drive', () => {
  const lc = ss.getSheetByName('LV_Cargas'); const last = lc.data[lc.getLastRow() - 1];
  assert.strictEqual(last[10], 'IMAGEFILE001'); assert.strictEqual(last[11], drive.IMAGEFILE001.md5); assert.ok(/autom/.test(last[2]), last[2]);
});
check('Archivo temporal del OCR borrado', () => assert.ok(!Object.keys(drive).some(k => k.startsWith('TMP'))));

const inb2 = ctx.api_inbox();
console.log('  ', JSON.stringify(st(inb2)));
check('Al volver a revisar: cargado y pendientes de revisión', () => {
  assert.strictEqual(st(inb2)['ACT-9005/IMG_2045.jpg'], 'CARGADO');
  assert.strictEqual(st(inb2)['ACT-9005/IMG_2046.jpg'], 'REVISAR');
  assert.strictEqual(st(inb2)['foto sin id.png'], 'REVISAR');
});
const auto2 = ctx.api_inboxAuto();
check('Segunda corrida automática no vuelve a cargar nada', () => { assert.strictEqual(auto2.cargados.length, 0); assert.strictEqual(pl.getLastRow(), plRows0 + 22); });

// Llega un archivo nuevo a la carpeta
addItem('NEWFILE00001', 'ACT-9001 dermoriente.jpg', 'image/jpeg', 'ROOTFOLDER01', OCR_TXT);
const inb3 = ctx.api_inbox();
check('Archivo nuevo de un evento ya cargado por el lector → "EVENTO YA CARGADO" con el origen', () => {
  const f = inb3.files.find(x => x.path === 'ACT-9001 dermoriente.jpg');
  assert.strictEqual(f.estado, 'EVENTO YA CARGADO'); assert.ok(/desde/.test(f.detalle), f.detalle);
});

// El archivo cargado cambia en Drive
const md5Orig = drive.IMAGEFILE001.md5;
drive.IMAGEFILE001.md5 = 'otro';
check('Archivo cargado que cambió después → MODIFICADO', () => assert.strictEqual(st(ctx.api_inbox())['ACT-9005/IMG_2045.jpg'], 'MODIFICADO'));
drive.IMAGEFILE001.md5 = md5Orig;

// Revisión manual desde la página
const ex = ctx.api_extractDriveFile('CSV1');
check('Abrir un CSV de la carpeta en la página', () => { assert.strictEqual(ex.rows.length, 1); assert.strictEqual(ex.rows[0].qty, 2); assert.strictEqual(ex.driveFile.path, 'ACT-0791 ventas.csv'); assert.ok(ex.tableRows); });
check('No se puede leer un archivo que no esté en la carpeta', () => assert.throws(() => ctx.api_extractDriveFile('f1'), /no está en la carpeta/));
const mx = ctx.api_match({ rows: ex.rows, from: '', to: '', text: '', idHint: ex.driveFile.path });
check('El evento muestra que ya está en la PLANTILLA', () => { assert.strictEqual(JSON.stringify(mx.idFromName.enPlantilla), JSON.stringify({ filas: 1, unidades: 1 })); assert.ok(mx.groups[0].candidates[0].enPlantilla); });
const rc = ctx.api_commit({ fileName: ex.driveFile.path, origin: 'CIRUDERMA S.A.S.', driveFileId: 'CSV1', driveVersion: ex.driveFile.version,
  groups: [{ mode: 'evento', idResumen: 'ACT-0791', rows: [{ code: 'N81105', desc: 'x', qty: 2, ean: '8429420218758', omit: false, learn: false }] }] });
check('Carga manual desde la bandeja → CARGADO', () => { assert.ok(rc.ok); assert.strictEqual(st(ctx.api_inbox())['ACT-0791 ventas.csv'], 'CARGADO'); });

ctx.api_inboxSetState('NOID', 'IGNORADO');
check('Ignorar un archivo', () => assert.strictEqual(st(ctx.api_inbox())['foto sin id.png'], 'IGNORADO'));
ctx.api_inboxSetState('NOID', 'PENDIENTE');
check('Reactivar un archivo ignorado', () => assert.strictEqual(st(ctx.api_inbox())['foto sin id.png'], 'PENDIENTE'));
check('Activar / desactivar la revisión cada hora (solo admin)', () => {
  assert.strictEqual(ctx.api_setAutoTrigger(true), true);
  assert.strictEqual(triggers.filter(t => t.getHandlerFunction() === 'procesarCarpetaAuto').length, 1);
  assert.strictEqual(ctx.api_setAutoTrigger(false), false);
});
check('El trigger horario corre sin usuario de la página', () => { const r = ctx.procesarCarpetaAuto(); assert.ok(Array.isArray(r.cargados)); });
};
