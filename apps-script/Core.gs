/**
 * Core.gs — Lógica pura del Lector de Ventas de Eventos.
 * No usa ninguna API de Google: se puede probar localmente con Node (ver tests/).
 * Todas las funciones públicas cuelgan del objeto Core.
 */
var Core = (function () {
  'use strict';

  // =====================================================================
  // 1. TEXTO: normalización y similitud
  // =====================================================================

  function str(v) { return v == null ? '' : String(v); }

  function stripAccents(s) {
    return str(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /** Clave de código de producto/PDV: mayúsculas, sin espacios, sin ".0", sin ceros a la izquierda. */
  function canonCode(c) {
    var s = stripAccents(c).toUpperCase().replace(/\s+/g, '');
    s = s.replace(/\.0+$/, '');
    s = s.replace(/^0+(?=[0-9A-Z])/, '');
    return s;
  }

  var SYNONYMS = [
    [/\bFOTOPROTECTOR(ES)?\b/g, 'FP'],
    [/\bFOTOPROT\b/g, 'FP'],
    [/\bFOTO\s?ULTRA\b/g, 'FU'],
    [/\bFUSION\s?WATER\b/g, 'FW'],
    [/\bFWATER\b/g, 'FW'],
    [/\bPEDIATRIC\w*\b/g, 'PEDIATRICS'],
    [/\bPEDIATRICO\w*\b/g, 'PEDIATRICS'],
    [/\bCLEASING\b/g, 'CLEANSING'],
    [/\bGRS?\b/g, 'G'],
    [/\bGRAMOS?\b/g, 'G'],
    [/\bMLS?\b/g, 'ML'],
    [/\bLIPSTICK\b/g, 'LABIAL'],
    [/\bBATH\b/g, 'GEL'],
    [/\bSHOWER\b/g, 'GEL']
  ];
  var STOP = { X: 1, POR: 1, DE: 1, DEL: 1, LA: 1, EL: 1, LOS: 1, LAS: 1, CON: 1, Y: 1, EN: 1, ISDIN: 1, PARA: 1, UND: 1, UNID: 1 };

  /** Normaliza una descripción de producto/PDV para compararla. */
  function normText(s) {
    var t = stripAccents(s).toUpperCase().replace(/_/g, ' ');
    t = t.replace(/SPF\s*(\d+)\s*\+?/g, ' SPF$1 ');
    t = t.replace(/(\d)\+/g, '$1 ');
    t = t.replace(/(\d+)[,.](\d+)/g, '$1P$2');          // 2,5ML -> 2P5ML (protege decimales)
    t = t.replace(/[^A-Z0-9]+/g, ' ');
    t = t.replace(/(\d+)\s+(ML|G|GR|GRS|L|U|UN|MG|OZ)\b/g, '$1$2');
    for (var i = 0; i < SYNONYMS.length; i++) t = t.replace(SYNONYMS[i][0], SYNONYMS[i][1]);
    t = t.replace(/(\d+)(GR|GRS)\b/g, '$1G');
    var toks = t.split(/\s+/).filter(function (w) {
      if (!w) return false;
      if (STOP[w]) return false;
      if (w.length === 1 && !/\d/.test(w)) return false;
      return true;
    });
    return toks.join(' ');
  }

  function trigrams(s) {
    var t = ' ' + s.replace(/\s+/g, ' ') + ' ';
    var set = {};
    for (var i = 0; i < t.length - 2; i++) set[t.substr(i, 3)] = 1;
    return set;
  }

  function setSize(o) { var n = 0; for (var k in o) n++; return n; }

  /** Pre-calcula lo necesario para comparar un texto muchas veces. */
  function prep(s) {
    var n = normText(s);
    var toks = n ? n.split(' ') : [];
    var tset = {};
    var nums = {};
    toks.forEach(function (w) { tset[w] = 1; if (/\d/.test(w)) nums[w] = 1; });
    var tri = trigrams(n.replace(/ /g, ''));
    return { norm: n, toks: toks, tset: tset, nums: nums, tri: tri, triN: setSize(tri) };
  }

  function tokenMatch(a, b) {
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return true;
    return false;
  }

  /** Similitud 0..1 entre dos textos pre-calculados con prep(). */
  function similarityP(pa, pb) {
    if (!pa.norm || !pb.norm) return 0;
    if (pa.norm === pb.norm) return 1;
    // Dice de tokens con coincidencia por prefijo
    var hit = 0;
    var used = {};
    for (var i = 0; i < pa.toks.length; i++) {
      for (var j = 0; j < pb.toks.length; j++) {
        if (!used[j] && tokenMatch(pa.toks[i], pb.toks[j])) { hit++; used[j] = 1; break; }
      }
    }
    var tokDice = (2 * hit) / (pa.toks.length + pb.toks.length);
    // Dice de trigramas de caracteres (tolera errores de OCR y palabras pegadas)
    var inter = 0;
    for (var k in pa.tri) if (pb.tri[k]) inter++;
    var triDice = (2 * inter) / ((pa.triN + pb.triN) || 1);
    var score = 0.55 * tokDice + 0.45 * triDice;
    // Penaliza si los números (tamaño, SPF, tono) no coinciden en nada
    var na = Object.keys(pa.nums), nb = Object.keys(pb.nums);
    if (na.length && nb.length) {
      var shared = na.some(function (x) { return pb.nums[x]; });
      if (!shared) score *= 0.6;
      else {
        // tonos/tamaños distintos con la misma base (COVERAGE 2 vs 3): penaliza números no compartidos
        var extraA = na.filter(function (x) { return !pb.nums[x]; }).length;
        var extraB = nb.filter(function (x) { return !pa.nums[x]; }).length;
        if (extraA && extraB) score *= 0.85;
      }
    }
    return Math.min(1, score);
  }

  function similarity(a, b) { return similarityP(prep(a), prep(b)); }

  // ---------------------------------------------------------------------
  // Fuzzy Lookup por palabras: compara TODAS las palabras de los dos nombres, una a una.
  // Cada palabra pesa según qué tan rara es en el catálogo (WETSKIN, HYDROOIL pesan más que ISDIN, FP, 50ML),
  // y dos palabras se parecen si son iguales, una es recorte de la otra (TRANSP → TRANSPARENT),
  // una es sigla de la otra (WS → WETSKIN) o difieren en pocas letras (MICELAR ↔ MICELLAR).
  // Las palabras que sobran en cualquiera de los dos nombres bajan el puntaje.
  // ---------------------------------------------------------------------
  function lev(a, b) {
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  function isSubseq(s, l) { var k = 0; for (var i = 0; i < l.length && k < s.length; i++) if (l[i] === s[k]) k++; return k === s.length; }
  var SIZE_TOK = /^\d+(P\d+)?(ML|G|L|MG|OZ|U|UN)$/;

  /** Parecido 0..1 entre dos palabras ya normalizadas. */
  function tokSim(a, b) {
    if (a === b) return 1;
    if (/\d/.test(a) || /\d/.test(b)) return 0;          // tamaños, SPF y tonos: o son iguales o no cuentan
    var s = a.length <= b.length ? a : b, l = s === a ? b : a;
    if (s.length >= 3 && l.indexOf(s) === 0) return 0.9;                       // recorte: TRANSP / TRANSPARENT
    if (s.length <= 3 && l.length >= 2 * s.length && s[0] === l[0] && isSubseq(s, l)) return 0.6;   // sigla: WS / WETSKIN
    if (s.length >= 4) {
      var r = 1 - lev(a, b) / l.length;
      if (r >= 0.75) return r;                                                  // errores de OCR o digitación
      if (s.length >= 5 && isSubseq(s, l) && s[0] === l[0]) return 0.7;        // abreviatura sin vocales: CONCNTR / CONCENTRATE
    }
    return 0;
  }

  function fuzzyToks(p) {
    if (!p.ft) p.ft = p.toks.map(function (t) { return t.replace(/^X(?=\d)/, ''); }).filter(Boolean);
    return p.ft;
  }

  /** Fuzzy Lookup 0..1 entre dos textos de prep(). w(token) = peso de la palabra (IDF del catálogo). */
  function fuzzyP(pa, pb, w) {
    var A = fuzzyToks(pa), B = fuzzyToks(pb);
    if (!A.length || !B.length) return 0;
    var pairs = [];
    for (var i = 0; i < A.length; i++) for (var j = 0; j < B.length; j++) {
      var s = tokSim(A[i], B[j]);
      if (s > 0) pairs.push([s, i, j]);
    }
    pairs.sort(function (x, y) { return y[0] - x[0]; });
    var ua = {}, ub = {}, matched = 0, wa = 0, wb = 0;
    pairs.forEach(function (p) {
      if (ua[p[1]] || ub[p[2]]) return;
      ua[p[1]] = ub[p[2]] = 1;
      matched += p[0] * (w(A[p[1]]) + w(B[p[2]]));
    });
    A.forEach(function (t) { wa += w(t); });
    B.forEach(function (t) { wb += w(t); });
    var score = matched / (wa + wb);
    // Tamaño distinto (50ML vs 250ML) o SPF distinto: es otro producto
    var sa = A.filter(function (t) { return SIZE_TOK.test(t); }), sb = B.filter(function (t) { return SIZE_TOK.test(t); });
    if (sa.length && sb.length && !sa.some(function (t) { return sb.indexOf(t) >= 0; })) score *= 0.5;
    var fa = A.filter(function (t) { return /^SPF\d/.test(t); }), fb = B.filter(function (t) { return /^SPF\d/.test(t); });
    if (fa.length && fb.length && !fa.some(function (t) { return fb.indexOf(t) >= 0; })) score *= 0.7;
    return score;
  }

  // =====================================================================
  // 2. LECTURA DE .XLSX (XML interno) — sin convertir el archivo
  // =====================================================================

  function decodeXml(s) {
    return str(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&amp;/g, '&');
  }

  /** Devuelve {nombreHoja: 'xl/worksheets/sheetN.xml'}. */
  function xlsxSheetPaths(workbookXml, relsXml) {
    var rels = {};
    var re = /<Relationship\b([^>]*)\/?>/g, m;
    while ((m = re.exec(relsXml))) {
      var id = (/\bId="([^"]+)"/.exec(m[1]) || [])[1];
      var tg = (/\bTarget="([^"]+)"/.exec(m[1]) || [])[1];
      if (id && tg) rels[id] = tg.charAt(0) === '/' ? tg.substr(1) : 'xl/' + tg;
    }
    var out = {};
    var rs = /<sheet\b([^>]*)\/?>/g;
    while ((m = rs.exec(workbookXml))) {
      var name = (/\bname="([^"]+)"/.exec(m[1]) || [])[1];
      var rid = (/\br:id="([^"]+)"/.exec(m[1]) || [])[1];
      if (name && rid && rels[rid]) out[decodeXml(name)] = rels[rid];
    }
    return out;
  }

  function xlsxSharedStrings(xml) {
    var out = [];
    if (!xml) return out;
    var re = /<si>([\s\S]*?)<\/si>/g, m;
    while ((m = re.exec(xml))) {
      var parts = [], rt = /<t\b[^>]*>([\s\S]*?)<\/t>/g, t;
      while ((t = rt.exec(m[1]))) parts.push(t[1]);
      out.push(decodeXml(parts.join('')));
    }
    return out;
  }

  function colIndex(ref) {
    var letters = /^[A-Z]+/.exec(ref)[0], n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  function numToString(v) {
    if (/^-?\d+(\.\d+)?E[+-]?\d+$/i.test(v)) {
      var n = Number(v);
      if (isFinite(n) && Math.abs(n) < 9e15 && Math.round(n) === n) return n.toFixed(0);
      return String(n);
    }
    return v;
  }

  /**
   * Convierte el XML de una hoja en una matriz de strings.
   * maxCols limita columnas leídas (ahorra memoria en hojas anchas).
   */
  function xlsxSheetRows(sheetXml, shared, maxCols) {
    var rows = [];
    var rr = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g, m;
    var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    var autoRow = 0;
    while ((m = rr.exec(sheetXml))) {
      var attrs = m[1] || m[3] || '';
      var rNum = (/\br="(\d+)"/.exec(attrs) || [])[1];
      var ri = rNum ? (+rNum - 1) : autoRow;
      autoRow = ri + 1;
      var row = [];
      var body = m[2] || '';
      cellRe.lastIndex = 0;
      var c, autoCol = 0;
      while ((c = cellRe.exec(body))) {
        var ca = c[1], inner = c[2] || '';
        var ref = (/\br="([A-Z]+)\d+"/.exec(ca) || [])[1];
        var ci = ref ? colIndex(ref) : autoCol;
        autoCol = ci + 1;
        if (maxCols && ci >= maxCols) continue;
        var type = (/\bt="([^"]+)"/.exec(ca) || [])[1] || 'n';
        var val = '';
        if (type === 'inlineStr') {
          var parts = [], rt = /<t\b[^>]*>([\s\S]*?)<\/t>/g, t;
          while ((t = rt.exec(inner))) parts.push(t[1]);
          val = decodeXml(parts.join(''));
        } else {
          var v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
          if (v == null) val = '';
          else if (type === 's') val = shared[+v] != null ? shared[+v] : '';
          else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
          else if (type === 'str' || type === 'e') val = decodeXml(v);
          else val = numToString(v);
        }
        row[ci] = val;
      }
      for (var k = 0; k < row.length; k++) if (row[k] == null) row[k] = '';
      rows[ri] = row;
    }
    for (var i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  function normHeader(h) { return stripAccents(h).toUpperCase().replace(/[^A-Z0-9]+/g, ''); }

  /** Busca columnas por nombre de encabezado (insensible a tildes/espacios). */
  function headerIndex(headerRow, names) {
    var hn = headerRow.map(normHeader);
    var out = {};
    names.forEach(function (n) { out[n] = hn.indexOf(normHeader(n)); });
    return out;
  }

  /**
   * Extrae los datos compactos de los Master a partir de las filas de cada hoja.
   * sheets: { Master_EAN: rows, Master_Puntos: rows, BD: rows, MAESTRO_PDV: rows }
   * NUNCA se recibe ni procesa la hoja "Control".
   */
  function buildMasterCache(sheets) {
    var out = { ean: [], puntos: [], clientesSap: [], maestroPdv: [], refreshedAt: new Date().toISOString() };

    var e = sheets.Master_EAN || [];
    if (e.length) {
      var h = headerIndex(e[0], ['Origin', 'Codigo_prod_cliente', 'Descripcion_producto_cliente', 'Ean_isdin', 'Ean_description', 'BU']);
      for (var i = 1; i < e.length; i++) {
        var r = e[i]; if (!r || !r[h.Origin]) continue;
        out.ean.push([str(r[h.Origin]).trim(), str(r[h.Codigo_prod_cliente]).trim(), str(r[h.Descripcion_producto_cliente]).trim(),
          str(r[h.Ean_isdin]).trim(), str(r[h.Ean_description]).trim(), str(r[h.BU]).trim()]);
      }
    }

    var p = sheets.Master_Puntos || [];
    if (p.length) {
      var hp = headerIndex(p[0], ['Origin', 'Código_local_cliente', 'Descripcion_local_cliente', 'Ciudad_cliente', 'ISDIN_PDV_DESC', 'SF_ID']);
      for (var j = 1; j < p.length; j++) {
        var q = p[j]; if (!q || !q[hp.Origin]) continue;
        out.puntos.push([str(q[hp.Origin]).trim(), str(q[hp['Código_local_cliente']]).trim(), str(q[hp.Descripcion_local_cliente]).trim(),
          str(q[hp.Ciudad_cliente]).trim(), str(q[hp.ISDIN_PDV_DESC]).trim(), str(q[hp.SF_ID]).trim()]);
      }
    }

    var bd = sheets.BD || [];
    if (bd.length) {
      var hb = headerIndex(bd[0], ['Origin', 'Sold To ID']);
      var seen = {};
      for (var b = 1; b < bd.length; b++) {
        var x = bd[b]; if (!x) continue;
        var o = str(x[hb.Origin]).trim(), s = canonCode(x[hb['Sold To ID']]);
        if (o && s && !seen[o + '|' + s]) { seen[o + '|' + s] = 1; out.clientesSap.push([o, s]); }
      }
    }

    var mp = sheets.MAESTRO_PDV || [];
    if (mp.length) {
      var hm = headerIndex(mp[0], ['Id cuenta 18', 'Nº Oficina Farmacia', 'Nombre de la cuenta', 'Ubicación: Población']);
      for (var a = 1; a < mp.length; a++) {
        var y = mp[a]; if (!y || !y[hm['Id cuenta 18']]) continue;
        out.maestroPdv.push([str(y[hm['Id cuenta 18']]).trim(), str(y[hm['Nº Oficina Farmacia']]).trim(),
          str(y[hm['Nombre de la cuenta']]).trim(), str(y[hm['Ubicación: Población']]).trim()]);
      }
    }
    return out;
  }

  // =====================================================================
  // 3. ÍNDICE de productos / PDV
  // =====================================================================

  var BU_FALLBACK = { FOTO: 'FOTO', DERMA: 'DERMA', ISDINCEUTICS: 'ISDINCEUTICS' };

  /**
   * cache: salida de buildMasterCache
   * buTable: [[subFamilia, nuevaRef, anteriorRef, ean], ...] (pestaña PLANTILLA..._Backup S:V)
   * aliases: [[tipo, origin, clave, valor, descripcion], ...] (pestaña LV_Alias)
   */
  function buildIndex(cache, buTable, aliases) {
    var idx = {
      byOriginCode: {}, byCode: {}, products: {}, origins: {}, originRows: {},
      buByEan: {}, puntosByOriginCode: {}, puntosByOrigin: {}, sapByOrigin: {}, cuentaByOficina: {},
      alias: {}, nameCands: []
    };

    (buTable || []).forEach(function (r) {
      var ean = canonCode(r[3]);
      if (ean && r[0] && !idx.buByEan[ean]) idx.buByEan[ean] = str(r[0]).trim();
    });

    function addProduct(ean, name, bu) {
      if (!ean || ean === 'OMITIR' || !/^\d{6,14}$/.test(ean)) return null;
      var p = idx.products[ean];
      if (!p) p = idx.products[ean] = { ean: ean, name: '', bu: '', names: {} };
      if (name && !p.name) p.name = name;
      if (bu && !p.bu) p.bu = bu;
      return p;
    }

    (cache.ean || []).forEach(function (r) {
      var origin = r[0], code = canonCode(r[1]), cdesc = r[2], ean = canonCode(r[3]), edesc = r[4], bu = r[5];
      idx.origins[origin] = 1;
      var omit = /OMITIR/i.test(r[3]);
      var entry = { origin: origin, code: r[1], clientDesc: cdesc, ean: omit ? 'OMITIR' : ean, omit: omit };
      if (code) {
        idx.byOriginCode[origin + '|' + code] = entry;
        (idx.byCode[code] = idx.byCode[code] || []).push(entry);
      }
      (idx.originRows[origin] = idx.originRows[origin] || []).push(entry);
      var p = addProduct(ean, edesc, bu);
      if (p) {
        if (cdesc) p.names[cdesc] = 1;
        if (edesc) p.names[edesc] = 1;
      }
    });

    (buTable || []).forEach(function (r) {
      var ean = canonCode(r[3]);
      var p = addProduct(ean, str(r[1]).trim(), '');
      if (p) { if (r[1]) p.names[str(r[1]).trim()] = 1; if (r[2]) p.names[str(r[2]).trim()] = 1; }
    });

    // Candidatos para búsqueda por nombre (deduplicados por texto normalizado)
    var seenNorm = {};
    Object.keys(idx.products).forEach(function (ean) {
      var p = idx.products[ean];
      p.bu = idx.buByEan[ean] || BU_FALLBACK[str(p.bu).toUpperCase()] || (p.bu ? 'OTRO' : '');
      Object.keys(p.names).forEach(function (nm) {
        var pp = prep(nm);
        var key = ean + '|' + pp.norm;
        if (!pp.norm || seenNorm[key]) return;
        seenNorm[key] = 1;
        idx.nameCands.push({ ean: ean, text: nm, p: pp });
      });
    });

    (cache.puntos || []).forEach(function (r) {
      var o = r[0];
      var pt = { origin: o, code: r[1], desc: r[2], ciudad: r[3], isdinDesc: r[4], sfId: r[5] };
      if (r[1]) idx.puntosByOriginCode[o + '|' + canonCode(r[1])] = pt;
      (idx.puntosByOrigin[o] = idx.puntosByOrigin[o] || []).push(pt);
    });
    (cache.clientesSap || []).forEach(function (r) { (idx.sapByOrigin[r[0]] = idx.sapByOrigin[r[0]] || []).push(r[1]); });
    (cache.maestroPdv || []).forEach(function (r) { if (r[1]) idx.cuentaByOficina[str(r[1]).trim().toUpperCase()] = { id: r[0], nombre: r[2], ciudad: r[3] }; });

    (aliases || []).forEach(function (a) {
      if (!a || !a[0]) return;
      idx.alias[str(a[0]).toUpperCase() + '|' + str(a[1]) + '|' + str(a[2])] = { valor: str(a[3]), desc: str(a[4]) };
    });

    idx.originList = Object.keys(idx.origins).sort();
    return idx;
  }

  function aliasKeyProduct(code, desc) {
    if (code) return 'COD:' + canonCode(code);
    return 'TXT:' + normText(desc);
  }

  // =====================================================================
  // 4. EXTRACCIÓN: texto OCR y tablas
  // =====================================================================

  var CODE_RE = /^(?=[A-Z0-9\-]*\d)[A-Z]{0,5}[0-9][A-Z0-9\-]{1,19}$/i;   // tiene al menos un dígito
  var QTY_RE = /^\d{1,6}(?:[.,]\d{1,3})?$/;

  function parseQty(s) {
    var t = str(s).trim().replace(/\s/g, '');
    if (!t) return null;
    if (/^\d{1,3}([.,]\d{3})+$/.test(t) && !/^\d+[.,]\d{1,2}$/.test(t)) return Number(t.replace(/[.,]/g, ''));
    var n = Number(t.replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  /** Interpreta fechas: Date, serial de Sheets/Excel, yyyy-mm-dd, dd/mm/yyyy. */
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    var s = str(v).trim(), m;
    if (/^\d{5}(\.\d+)?$/.test(s)) { var d0 = new Date(1899, 11, 30); d0.setDate(d0.getDate() + Math.floor(+s)); return d0; }
    if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/.exec(s))) {
      var y = +m[3]; if (y < 100) y += 2000;
      return new Date(y, +m[2] - 1, +m[1]);
    }
    return null;
  }

  function findDates(text) {
    var re = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g, m, ds = [];
    while ((m = re.exec(str(text)))) { var d = parseDate(m[1]); if (d && d.getFullYear() > 2000) ds.push(d); }
    if (!ds.length) return { from: '', to: '' };
    ds.sort(function (a, b) { return a - b; });
    return { from: isoDate(ds[0]), to: isoDate(ds[ds.length - 1]) };
  }

  var SKIP_LINE = /^(TOTAL|SUBTOTAL|ARTICULO|NOMBRE|CANTIDAD|FILTRO|PAGINA|PAG\b|FECHA|CODIGO|DESCRIPCION)/i;

  /**
   * Convierte texto OCR (o pegado) en filas {code, desc, qty}.
   * Soporta: (a) una fila por línea "CODIGO DESCRIPCION CANTIDAD";
   *          (b) OCR por columnas: bloque de códigos, bloque de nombres, bloque de cantidades.
   */
  // Google Docs (OCR de Drive) devuelve los saltos de línea "suaves" como \r o \u000b: todos cuentan como fila nueva.
  var LINE_SPLIT = /\r\n|[\r\n\u000b\u000c\u2028\u2029]/;
  var DATE_TOKEN = /^\d{1,4}[-\/.]\d{1,2}[-\/.]\d{1,4}$/;
  var HAS_WORD = /[A-Z]{3,}/i;

  // ---------------------------------------------------------------------
  // Estructura de la imagen: encabezados, columnas repetidas y códigos numéricos cortos
  // ---------------------------------------------------------------------
  // Palabras típicas de encabezado (también recortadas por la captura: "Ite", "Cantidad in", "Desc. item")
  var HEADER_WORDS = ['CODIGO', 'COD', 'ITEM', 'ITEMS', 'ARTICULO', 'ARTICULOS', 'REFERENCIA', 'REF', 'SKU', 'PLU', 'EAN', 'BARRAS',
    'DESCRIPCION', 'DESC', 'DESCR', 'DESCUENTO', 'DCTO', 'DTO', 'NOMBRE', 'PRODUCTO', 'PRODUCTOS', 'MATERIAL',
    'CANTIDAD', 'CANT', 'UNIDADES', 'UNIDAD', 'UNDS', 'UND', 'UDS', 'QTY', 'INVENTARIO', 'INV', 'EXISTENCIA', 'STOCK', 'SALDO',
    'VENTA', 'VENTAS', 'VENDIDAS', 'VALOR', 'PRECIO', 'TOTAL', 'SUBTOTAL', 'COSTO', 'NETO', 'BRUTO', 'IVA', 'PORCENTAJE',
    'FECHA', 'MES', 'DIA', 'TIENDA', 'SUCURSAL', 'PDV', 'LOCAL', 'BODEGA', 'ALMACEN', 'MARCA', 'LINEA', 'CATEGORIA', 'GRUPO',
    'PROVEEDOR', 'CLIENTE', 'NIT', 'VR', 'VLR', 'UNIT', 'UNITARIO'];
  // Palabras que siguen a un número sin que ese número sea un código ("250 ML", "30 TABLETAS")
  var AFTER_NUM_NOT_PRODUCT = { UNIDADES: 1, UNIDAD: 1, GRAMOS: 1, MILILITROS: 1, CAPSULAS: 1, TABLETAS: 1, SOBRES: 1, AMPOLLAS: 1,
    PIEZAS: 1, PZAS: 1, MESES: 1, DIAS: 1, HORAS: 1, ANOS: 1, SPF: 1, FPS: 1, MAS: 1, PLUS: 1 };

  /** Línea de encabezado: todas sus palabras (de 3+ letras) son vocabulario de encabezado o un recorte de él. */
  function isHeaderLine(line) {
    var words = stripAccents(line).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(' ').filter(Boolean);
    if (!words.length || words.some(function (w) { return /^\d{3,}$/.test(w); })) return false;
    var alpha = words.filter(function (w) { return /^[A-Z]{3,}$/.test(w); });
    if (!alpha.length) return false;
    return alpha.every(function (w) {
      return HEADER_WORDS.some(function (h) { return h === w || h.indexOf(w) === 0 || (h.length >= 4 && w.indexOf(h) === 0); });
    });
  }

  /** ¿El token empieza un nombre de producto? (palabra de 3+ letras que no es unidad ni "SPF"…) */
  function startsProductName(tok) {
    var t = stripAccents(str(tok)).toUpperCase().replace(/[.,;:]+$/, '');
    return /^[A-Z][A-Z\-]{2,}/.test(t) && !UNIT_WORDS[t] && !AFTER_NUM_NOT_PRODUCT[t] && !NOT_START[t];
  }

  /**
   * Deduce si el cliente usa códigos numéricos cortos (3–6 dígitos, p. ej. "2395 FOTOP ISDIN…"), que de otro modo
   * se confundirían con cantidades. Devuelve la longitud del código o 0.
   */
  function inferNumericCodeLen(lines) {
    var byLen = {}, wordLines = 0;
    lines.forEach(function (l) {
      var toks = l.split(' ');
      if (HAS_WORD.test(l)) wordLines++;
      for (var i = 0; i < toks.length - 1; i++) {
        if (/^\d{3,6}$/.test(toks[i]) && startsProductName(toks[i + 1])) byLen[toks[i].length] = (byLen[toks[i].length] || 0) + 1;
      }
    });
    var best = 0, bestN = 0;
    Object.keys(byLen).forEach(function (L) { if (byLen[L] > bestN) { best = +L; bestN = byLen[L]; } });
    if (bestN >= 2 && bestN >= 0.3 * wordLines) return best;
    // Columnas en bloques: una lista de números largos (códigos) y otra de números pequeños (cantidades)
    var solo = {}, small = 0, descLines = lines.filter(function (l) { return HAS_WORD.test(l); }).length;
    lines.forEach(function (l) {
      if (/^\d{4,6}$/.test(l)) solo[l.length] = (solo[l.length] || 0) + 1;
      else if (/^\d{1,3}$/.test(l)) small++;
    });
    best = 0; bestN = 0;
    Object.keys(solo).forEach(function (L) { if (solo[L] > bestN) { best = +L; bestN = solo[L]; } });
    if (bestN >= 2 && small >= bestN * 0.8 && bestN >= descLines * 0.8 && bestN <= descLines * 1.25 + 1) return best;
    return 0;
  }

  /**
   * Parte una línea donde el OCR juntó varias filas ("2395 FOTOP … 50 ML 3102 FOTOP … 4144 FOTOP …"):
   * corta antes de cada código numérico de la longitud deducida seguido de un nombre.
   * Lo que va antes del primer código sin dígitos (p. ej. una columna "ISDIN TENNIS") se descarta.
   */
  function splitAtCodes(line, codeLen) {
    if (!codeLen) return [line];
    var toks = line.split(' '), cuts = [];
    for (var i = 0; i < toks.length - 1; i++) {
      if (toks[i].length === codeLen && /^\d+$/.test(toks[i]) && startsProductName(toks[i + 1])) {
        var prev = i > 0 ? stripAccents(toks[i - 1]).toUpperCase() : '';
        if (prev === 'X' || prev === 'POR' || prev === 'SPF' || prev === 'FPS' || prev === 'N' || prev === 'NO') continue;
        cuts.push(i);
      }
    }
    if (!cuts.length) return [line];
    var out = [], pre = toks.slice(0, cuts[0]), prefix = pre.join(' ');
    if (prefix && /\d/.test(prefix)) out.push(prefix);   // sin dígitos = columna de texto (marca, tienda…): fuera
    cuts.forEach(function (c, k) {
      var piece = toks.slice(c, k + 1 < cuts.length ? cuts[k + 1] : toks.length);
      // la misma columna de texto repetida antes del siguiente código ("… 50 ML 2 ISDIN TENNIS 3102 …")
      if (prefix && !/\d/.test(prefix) && piece.length > pre.length + 1 &&
          normText(piece.slice(-pre.length).join(' ')) === normText(prefix)) piece = piece.slice(0, -pre.length);
      out.push(piece.join(' '));
    });
    return out;
  }

  /** Quita columnas de texto que se repiten igual en muchas filas (marca, tienda, descuento: "ISDIN TENNIS"). */
  function dropRepeated(lines) {
    var rep = {}, short = function (l) { return !/\d/.test(l) && l.split(' ').length <= 4; };
    lines.forEach(function (l) { if (short(l)) { var k = normText(l); rep[k] = (rep[k] || 0) + 1; } });
    return lines.filter(function (l) { return !short(l) || rep[normText(l)] < 3; });
  }

  /** Separa una línea en {code, desc, qty}; cualquiera puede faltar. null = línea a ignorar. */
  function splitOcrLine(line, numCodeLen) {
    var plain = stripAccents(line);
    if (SKIP_LINE.test(plain) || /\d+\.\d+\.\d+/.test(line)) return null;   // encabezados, cuentas tipo 4.1.35.38.155
    var toks = line.split(' '), code = '', qty = null;
    if (numCodeLen && toks[0].length === numCodeLen && /^\d+$/.test(toks[0])) code = toks.shift();   // código numérico corto
    else if (CODE_RE.test(toks[0]) && !QTY_RE.test(toks[0]) && !DATE_TOKEN.test(toks[0])) code = toks.shift();
    if (toks.length) {
      var last = toks[toks.length - 1], prev = toks.length > 1 ? stripAccents(toks[toks.length - 2]).toUpperCase() : '';
      // "X 50" / "POR 50" es presentación, no cantidad
      if (QTY_RE.test(last) && (toks.length === 1 || (HAS_WORD.test(toks.slice(0, -1).join(' ')) && prev !== 'X' && prev !== 'POR'))) {
        qty = parseQty(toks.pop());
      }
    }
    var desc = toks.join(' ');
    if (!HAS_WORD.test(desc)) desc = '';
    if (!code && !desc && qty == null) return null;
    return { code: code, desc: desc, qty: qty };
  }

  /**
   * Convierte texto OCR (o pegado) en filas {code, desc, qty}, una por producto.
   * Soporta cualquier mezcla de:
   *   (a) una fila por línea "CODIGO DESCRIPCION CANTIDAD";
   *   (b) OCR por columnas: bloque de códigos, bloque de nombres, bloque de cantidades;
   *   (c) mixto: algunas filas completas y el resto en columnas, o código/nombre/cantidad en líneas alternas.
   * En (b) y (c) se rearma por posición: el i-ésimo código va con el i-ésimo nombre y la i-ésima cantidad.
   */
  function parseOcrText(text) {
    var allLines = str(text).split(LINE_SPLIT).map(function (l) {
      // Borde de la celda leído como letra pegada al nombre: "OISDIN", "|ISDIN", "lISDIN" → "ISDIN"
      return l.replace(/\s+/g, ' ').trim().replace(/(^|\s)[O0Il|\[\]]{1,2}(?=ISDIN)/g, '$1');
    }).filter(Boolean);
    // 0) IDs de evento (consolidados de varios eventos): se quitan de la línea y se recuerdan
    var tagged = allLines.map(function (l) {
      var ids = eventTokens(l), rest = ids.length ? stripEventTokens(l) : l;
      return { rest: rest, ids: ids, solo: ids.length > 0 && !/\d/.test(rest) };
    });
    // 1) fuera encabezados ("Descuento 1 desc", "Ite", "Desc. item", "Cantidad inv"…) y columnas de texto repetidas
    tagged = tagged.filter(function (t) { return t.ids.length || (t.rest && !isHeaderLine(t.rest)); });
    var keep = dropRepeated(tagged.map(function (t) { return t.rest; }));
    var keepCount = {}; keep.forEach(function (l) { keepCount[l] = (keepCount[l] || 0) + 1; });
    tagged = tagged.filter(function (t) { if (t.ids.length) return true; if (keepCount[t.rest]) { keepCount[t.rest]--; return true; } return false; });
    // 2) códigos numéricos cortos (se deducen con todo el texto)
    var numCodeLen = inferNumericCodeLen(tagged.filter(function (t) { return !t.solo; }).map(function (t) { return t.rest; }));
    var dates = findDates(text), header = allLines.slice(0, 3).join(' | ');

    var withId = tagged.filter(function (t) { return t.ids.length === 1; });
    if (!withId.length) return { rows: rowsFromLines(tagged.map(function (t) { return t.rest; }), numCodeLen), dates: dates, header: header };

    // a) Columna de IDs leída en bloque aparte (líneas con solo el ID, seguidas): se reparte por posición
    var onlyId = function (t) { return t.ids.length === 1 && !t.rest; };
    var firstId = tagged.indexOf(withId[0]), lastId = tagged.indexOf(withId[withId.length - 1]);
    if (withId.length >= 2 && withId.every(onlyId) && lastId - firstId + 1 === withId.length) {
      var plain = rowsFromLines(tagged.filter(function (t) { return !t.ids.length; }).map(function (t) { return t.rest; }), numCodeLen);
      if (plain.length === withId.length) {
        plain.forEach(function (r, k) { r.eventId = withId[k].ids[0]; });
        return { rows: plain, dates: dates, header: header };
      }
    }
    // b) Secciones: una línea "ACT-0123 …" sin cantidades abre la sección; una fila con su ID va a ese evento
    //    y las filas sin ID siguen al último ID leído
    var segs = [], cur = null;
    tagged.forEach(function (t) {
      if (t.ids.length > 1) return;                       // título con varios IDs: solo informativo
      if (t.ids.length === 1) {
        if (!cur || cur.id !== t.ids[0]) { cur = { id: t.ids[0], lines: [] }; segs.push(cur); }
        if (!t.solo && t.rest) cur.lines.push(t.rest);
        return;
      }
      if (!cur) { cur = { id: '', lines: [] }; segs.push(cur); }
      cur.lines.push(t.rest);
    });
    var rows = [];
    segs.forEach(function (s) {
      rowsFromLines(s.lines, numCodeLen).forEach(function (r) { if (s.id) r.eventId = s.id; rows.push(r); });
    });
    return { rows: rows, dates: dates, header: header };
  }

  /** Palabra con la que empieza la mayoría de los nombres (p. ej. "ISDIN" en ISDIN…/ISDINCEUTICS…/ISDINCEU…), o ''. */
  function leadWord(descs) {
    var cnt = {}, n = 0;
    descs.forEach(function (d) {
      var t = stripAccents(str(d).split(' ')[0]).toUpperCase().replace(/[^A-Z]/g, '');
      if (t.length < 4) return;
      n++; cnt[t.slice(0, 5)] = (cnt[t.slice(0, 5)] || 0) + 1;
    });
    var best = '', bn = 0;
    Object.keys(cnt).forEach(function (k) { if (cnt[k] > bn) { bn = cnt[k]; best = k; } });
    return bn >= 2 && bn >= 0.5 * descs.length ? best : '';
  }
  /** Separa un texto donde el OCR juntó varios nombres, cortando antes de cada palabra que empieza con lead. */
  function splitAtLead(desc, lead) {
    if (!lead) return [desc];
    var toks = desc.split(' '), out = [], cur = [];
    toks.forEach(function (t, i) {
      var u = stripAccents(t).toUpperCase();
      if (i > 0 && cur.length >= 2 && u.indexOf(lead) === 0) { out.push(cur.join(' ')); cur = []; }
      cur.push(t);
    });
    out.push(cur.join(' '));
    return out;
  }

  /** Filas {code, desc, qty} de un grupo de líneas ya limpias (sin encabezados ni columnas repetidas). */
  function rowsFromLines(lines, numCodeLen) {
    lines = dropRepeated([].concat.apply([], lines.map(function (l) { return splitAtCodes(l, numCodeLen); })));
    var items = lines.map(function (l) { return splitOcrLine(l, numCodeLen); }).filter(Boolean);
    var codeOnly = items.filter(function (i) { return i.code && !i.desc; }).length;
    var qtyOnly = items.filter(function (i) { return !i.code && !i.desc; }).map(function (i) { return i.qty; });
    var rows = [];

    if (codeOnly === 0) {
      // Fila por línea: cada línea con código es un producto; sin código, solo si trae cantidad.
      rows = items.filter(function (i) { return i.code || (i.desc && i.qty != null); })
        .map(function (i) { return { code: i.code, desc: i.desc, qty: i.qty }; });
      // Cantidades en un bloque aparte, en el mismo orden
      var need = rows.filter(function (r) { return r.qty == null; });
      if (need.length && qtyOnly.length >= need.length) need.forEach(function (r, k) { r.qty = qtyOnly[k]; });
      // Sin códigos: nombres + cantidades. Si el OCR juntó varios nombres en una línea ("…X50ML ISDIN FOT…"),
      // se separan antes de cada palabra con la que empiezan los productos (ISDIN…) y, si aún faltan, por la presentación.
      var descItems = items.filter(function (i) { return i.desc; });
      var lead = leadWord(descItems.map(function (i) { return i.desc; }));
      var parts = [];
      descItems.forEach(function (d) {
        var ps = splitAtLead(d.desc, lead);
        ps.forEach(function (p, k) { parts.push({ desc: p, qty: k === ps.length - 1 ? d.qty : null }); });
      });
      var allQty = items.filter(function (i) { return i.qty != null; }).map(function (i) { return i.qty; });
      var anyCode = items.some(function (i) { return i.code; });
      if (!anyCode && (parts.length > descItems.length || !rows.length)) {
        if (parts.length < allQty.length) {
          var exp = expandDescs(parts.map(function (p) { return p.desc; }), allQty.length);
          if (exp.length !== parts.length) parts = exp.map(function (d) { return { desc: d, qty: null }; });
        }
        if (parts.length === allQty.length) rows = parts.map(function (p, k) { return { code: '', desc: p.desc, qty: allQty[k] }; });
        else rows = parts.map(function (p, k) { return { code: '', desc: p.desc, qty: p.qty != null ? p.qty : (qtyOnly[k] != null ? qtyOnly[k] : null) }; });
      }
    } else {
      // Columnas o mezcla: tres listas ordenadas que se rearman por posición
      var codes = [], descList = [], qtys = [];
      items.forEach(function (i) {
        if (i.code) codes.push(i.code);
        if (i.desc) descList.push(i.desc);
        if (i.qty != null) qtys.push(i.qty);
      });
      // Si el OCR juntó varios nombres en una línea, hay menos nombres que códigos: separarlos por presentación
      if (descList.length < codes.length) descList = expandDescs(descList, codes.length);
      var n = Math.max(codes.length, descList.length);
      for (var k = 0; k < n; k++) {
        rows.push({ code: codes[k] || '', desc: descList[k] || '', qty: qtys[k] != null ? qtys[k] : null });
      }
    }
    return rows;
  }

  // ---------------------------------------------------------------------
  // Separar nombres concatenados ("...X 200 ML UREADIN HAND CREAM ... 50 ML FP GEL ...")
  // ---------------------------------------------------------------------
  var UNIT_WORDS = { ML: 1, G: 1, GR: 1, GRS: 1, GRAMOS: 1, MG: 1, KG: 1, L: 1, LT: 1, OZ: 1, CC: 1, UND: 1, UNDS: 1, UN: 1, CAPS: 1, TAB: 1, AMP: 1 };
  var UNIT_GLUED = /\d(ML|G|GR|GRS|MG|KG|LT|OZ|CC|UND|CAPS)\.?$/i;
  // Palabras que suelen ir DESPUÉS de la presentación sin empezar otro producto
  var NOT_START = { X: 1, POR: 1, DE: 1, CON: 1, Y: 1, PARA: 1, EN: 1, CU: 1, PACK: 1, KIT: 1, DUO: 1, TRIO: 1, TUBO: 1, FRASCO: 1, SACHET: 1,
    REPUESTO: 1, REFILL: 1, RECARGA: 1, GRATIS: 1, OBSEQUIO: 1, PROMO: 1, OFERTA: 1, UNIDADES: 1, UNIDAD: 1, PRECIO: 1, ESPECIAL: 1, MAS: 1, PLUS: 1,
    COLOR: 1, TONO: 1, LIGHT: 1, MEDIUM: 1, DARK: 1, SAND: 1, BRONZE: 1, NUDE: 1, IVORY: 1, BEIGE: 1, CF: 1, SC: 1, FPS: 1, SPF: 1 };

  /** Parte un texto en productos cuando una presentación ("200 ML", "X400ML", "30G") va seguida de otro nombre. */
  function splitByUnits(desc) {
    var toks = str(desc).replace(/\s+/g, ' ').trim().split(' ');
    if (toks.length < 4) return [toks.join(' ')];
    var parts = [], start = 0;
    for (var i = 0; i < toks.length - 1; i++) {
      var t = stripAccents(toks[i]).toUpperCase().replace(/[.,;]+$/, ''), prev = i > 0 ? toks[i - 1] : '';
      var endsUnit = UNIT_GLUED.test(t) || (UNIT_WORDS[t] && /\d$/.test(prev));
      if (!endsUnit) continue;
      var next = stripAccents(toks[i + 1]).toUpperCase();
      if (!/^[A-Z][A-Z\-]+$/.test(next) || NOT_START[next.replace(/-/g, '')]) continue;
      var piece = toks.slice(start, i + 1), rest = toks.slice(i + 1);
      // cada parte debe parecer un producto: ≥ 2 palabras y alguna palabra de ≥ 3 letras
      if (piece.length < 2 || rest.length < 2 || !HAS_WORD.test(piece.join(' ')) || !HAS_WORD.test(rest.join(' '))) continue;
      parts.push(piece.join(' '));
      start = i + 1;
    }
    parts.push(toks.slice(start).join(' '));
    return parts;
  }

  /** Divide los nombres concatenados hasta alcanzar `target` nombres (sin pasarse). Si no se puede, los deja igual. */
  function expandDescs(descs, target) {
    var need = target - descs.length;
    var splits = descs.map(splitByUnits);
    var extra = splits.reduce(function (s, p) { return s + p.length - 1; }, 0);
    if (!extra) return descs;
    var useAll = extra <= need;
    var out = [];
    descs.forEach(function (d, k) {
      var p = splits[k];
      if (p.length > 1 && (useAll || p.length - 1 <= need)) { out.push.apply(out, p); need -= p.length - 1; }
      else out.push(d);
    });
    return out;
  }

  /**
   * Reacomoda las descripciones cuando el OCR juntó varios nombres en una fila (y corrió las siguientes),
   * usando la descripción del cliente que el EAN Master tiene para cada código.
   * Devuelve { rows (copias), changed: nº de filas cuya descripción cambió }. Solo aplica si mejora el cuadre.
   */
  function realignDescs(rows, origin, idx) {
    var expected = rows.map(function (r) {
      if (!r.code || !origin) return '';
      var vs = codeVariants(r.code);
      for (var v = 0; v < vs.length; v++) { var e = idx.byOriginCode[origin + '|' + vs[v]]; if (e && e.clientDesc) return e.clientDesc; }
      return '';
    });
    var copy = rows.map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
    if (!expected.some(Boolean)) return { rows: copy, changed: 0 };
    var GOOD = 0.6;
    var fits = function (descs) { return descs.reduce(function (s, d, k) { return s + (expected[k] && d && similarity(d, expected[k]) >= GOOD ? 1 : 0); }, 0); };
    var before = rows.map(function (r) { return r.desc || ''; });
    var fitBefore = fits(before);
    if (fitBefore === expected.filter(Boolean).length) return { rows: copy, changed: 0 };

    // Corriente de nombres en orden; cada fila toma el prefijo que mejor coincide con su descripción esperada
    var stream = before.filter(Boolean), si = 0, cur = null, after = [];
    for (var k = 0; k < rows.length; k++) {
      if (!cur) { if (si >= stream.length) { after.push(''); continue; } cur = stream[si++].split(' '); }
      var whole = cur.join(' ');
      if (!expected[k] || cur.length < 2) { after.push(whole); cur = null; continue; }
      var sw = similarity(whole, expected[k]), best = { len: 0, s: -1, tot: -1 };
      var nextExp = expected[k + 1] || '';
      for (var L = 1; L < cur.length; L++) {
        var s = similarity(cur.slice(0, L).join(' '), expected[k]);
        if (s < GOOD) continue;
        // mirar una fila adelante: el resto debe empezar con el nombre de la siguiente
        var ahead = 0, rest = cur.slice(L);
        if (nextExp) for (var L2 = 1; L2 <= rest.length; L2++) ahead = Math.max(ahead, similarity(rest.slice(0, L2).join(' '), nextExp));
        if (s + ahead > best.tot) best = { len: L, s: s, tot: s + ahead };
      }
      if (best.s >= GOOD && best.s >= sw + 0.15) { after.push(cur.slice(0, best.len).join(' ')); cur = cur.slice(best.len); }
      else { after.push(whole); cur = null; }
    }
    var leftover = (cur ? 1 : 0) + (stream.length - si);
    if (leftover || fits(after) <= fitBefore) return { rows: copy, changed: 0 };
    var changed = 0;
    copy.forEach(function (r, k) { if ((r.desc || '') !== after[k]) { r.desc = after[k]; changed++; } });
    return { rows: copy, changed: changed };
  }

  var KW = {
    code: ['CODIGO', 'COD', 'ARTICULO', 'PLU', 'SKU', 'REFERENCIA', 'REF', 'EAN', 'ITEM', 'MATERIAL', 'CODPRODUCTO', 'CODIGOPRODUCTO', 'CODARTICULO'],
    desc: ['DESCRIPCION', 'NOMBRE', 'PRODUCTO', 'NOMBREPRODUCTO', 'DESCRIPCIONPRODUCTO', 'DESCARTICULO', 'DESC'],
    qty: ['CANTIDAD', 'UNIDADES', 'UNDS', 'UND', 'UNID', 'QTY', 'CANT', 'UNIDADESVENDIDAS', 'VENTAUNIDADES', 'UDS'],
    pdv: ['PDV', 'TIENDA', 'SUCURSAL', 'LOCAL', 'PUNTO', 'PUNTODEVENTA', 'ALMACEN', 'DROGUERIA', 'FARMACIA', 'NOMBRESUCURSAL', 'NOMBRETIENDA', 'NOMBRELOCAL', 'PUNTOVENTANOMBRE'],
    pdvCode: ['CODTIENDA', 'CODSUCURSAL', 'CODLOCAL', 'CODIGOTIENDA', 'CODIGOSUCURSAL', 'CODIGOLOCAL', 'IDTIENDA', 'CODPDV', 'IDPDV', 'CODDROGUERIA', 'CODALMACEN'],
    date: ['FECHA', 'DIA', 'DATE', 'FECHAVENTA'],
    evento: ['IDRESUMEN', 'RESUMEN', 'CODEVENTO', 'CODIGOEVENTO', 'IDEVENTO', 'NOEVENTO', 'NROEVENTO', 'NUMEVENTO', 'NUMEROEVENTO', 'EVENTO',
      'ACTIVIDAD', 'IDACTIVIDAD', 'CODACTIVIDAD', 'ACTIVACION']
  };

  function kwScore(h, list) {
    var n = normHeader(h);
    if (!n) return 0;
    for (var i = 0; i < list.length; i++) { if (n === list[i]) return 2; }
    for (var j = 0; j < list.length; j++) { if (list[j].length >= 3 && n.indexOf(list[j]) === 0) return 1; }
    return 0;
  }

  /**
   * Detecta fila de encabezado y columnas de una tabla (Excel/CSV).
   * Usa el índice para elegir la columna de código con más coincidencias reales.
   */
  function detectTable(table, idx, forceHeaderRow) {
    var best = { row: -1, hits: 0 };
    for (var r = 0; r < Math.min(table.length, 20); r++) {
      var row = table[r] || [], hits = 0;
      row.forEach(function (h) { for (var k in KW) if (kwScore(h, KW[k])) { hits++; break; } });
      if (hits > best.hits) best = { row: r, hits: hits };
    }
    var hr = best.hits >= 2 ? best.row : -1;
    // Encabezados mal leídos (foto): la primera fila sin números, seguida de filas con números, es el encabezado
    if (forceHeaderRow != null && forceHeaderRow >= -1 && forceHeaderRow < table.length) hr = forceHeaderRow;
    else if (hr < 0) {
      var digitCells = function (r) { return (r || []).filter(function (c) { return /\d/.test(str(c)); }).length; };
      var filled = function (r) { return (r || []).filter(function (c) { return str(c).trim() !== ''; }).length; };
      for (var r0 = 0; r0 < Math.min(table.length - 1, 5); r0++) {
        var f0 = filled(table[r0]);
        if (f0 >= 2 && digitCells(table[r0]) <= f0 * 0.25 && digitCells(table[r0 + 1]) >= 2) { hr = r0; break; }
      }
    }
    var headers = hr >= 0 ? table[hr].map(str) : [];
    var data = table.slice(hr + 1).filter(function (r) { return r && r.some(function (c) { return str(c).trim() !== ''; }); });
    var ncols = data.reduce(function (m, r) { return Math.max(m, r.length); }, headers.length);

    var map = { code: -1, ean: -1, desc: -1, qty: -1, pdv: -1, pdvCode: -1, date: -1, evento: -1 };
    // Qué tan "nombre de producto" es una columna: valores distintos y textos largos (una columna repetida
    // como "ISDIN TENNIS" en todas las filas puntúa bajo)
    var textScore = function (c) {
      var seen = {}, n = 0, len = 0;
      data.slice(0, 300).forEach(function (r) { var v = str(r[c]).trim(); if (!/[A-Z]{3,}/i.test(v)) return; n++; len += v.length; seen[v.toUpperCase()] = 1; });
      return n ? (Object.keys(seen).length / n) * (len / n) : 0;
    };
    // Columna del evento: sus valores son IDs ("ACT-0123") o números de evento; las vacías (celdas combinadas) no cuentan
    var eventShare = function (c, numbersOk) {
      var n = 0, ok = 0;
      data.slice(0, 300).forEach(function (r) { var v = str(r[c]).trim(); if (!v) return; n++; if (EVENT_CELL.test(v) || (numbersOk && /^\d{1,7}$/.test(v))) ok++; });
      return n ? ok / n : 0;
    };
    ['evento', 'pdvCode', 'qty', 'date', 'pdv', 'desc'].forEach(function (k) {
      var bestC = -1, bs = 0;
      headers.forEach(function (h, c) {
        if (Object.keys(map).some(function (kk) { return map[kk] === c; })) return;
        if (k === 'desc' && /^(DESCUENTO|DCTO|DTO)/.test(normHeader(h))) return;   // "Descuento 1 desc" no es la descripción
        var s = kwScore(h, KW[k]);
        if (s && k === 'desc') s += textScore(c) / 1000;   // empate entre "Desc…" → la de nombres más variados y largos
        if (s && k === 'evento' && eventShare(c, true) < 0.5) s = 0;   // "EVENTO" con nombres de evento, no IDs
        if (s > bs) { bs = s; bestC = c; }
      });
      map[k] = bestC;
    });
    if (map.evento < 0) {
      for (var ce = 0; ce < ncols; ce++) {
        if (Object.keys(map).some(function (kk) { return map[kk] === ce; })) continue;
        if (eventShare(ce, false) >= 0.6) { map.evento = ce; break; }
      }
    }
    // Columnas de código: la del EAN ISDIN (EAN-13 del catálogo) y la del código del cliente (PLU, SKU…),
    // cada una la que más valores encuentra en el EAN Master. Pueden venir las dos ("PLU" y "EAN13").
    var sample = data.slice(0, 300), minHits = Math.max(1, Math.min(sample.length * 0.2, 3));
    var stats = [];
    for (var c = 0; c < ncols; c++) {
      if (c === map.qty || c === map.date || c === map.evento) { stats.push(null); continue; }
      // Solo cuentan valores distintos: una columna con el mismo valor en todas las filas (NIT, código del proveedor) no es de productos
      var st = { ean: 0, code: 0, n: 0 }, seenV = {};
      sample.forEach(function (r) {
        var v = canonCode(r[c]); if (!v) return; st.n++;
        if (seenV[v]) return; seenV[v] = 1;
        if (idx && idx.products[v]) st.ean++;
        if (idx && idx.byCode[v]) st.code++;
      });
      if (st.n >= 3 && Object.keys(seenV).length === 1) st.ean = st.code = 0;
      stats.push(st);
    }
    var bestOf = function (k, skip) {
      var b = -1, bh = 0;
      stats.forEach(function (st, c) { if (st && c !== skip && st[k] > bh) { bh = st[k]; b = c; } });
      return bh >= minHits ? b : -1;
    };
    map.ean = bestOf('ean', -1);
    map.code = bestOf('code', map.ean);
    // Sin otra columna de códigos del cliente: la del EAN también sirve para detectar el cliente
    if (map.code < 0 && map.ean >= 0 && stats[map.ean].code >= minHits) { map.code = map.ean; map.ean = -1; }
    if (map.code < 0) headers.forEach(function (hh, c) { if (map.code < 0 && kwScore(hh, KW.code) && c !== map.desc && c !== map.qty && c !== map.evento && c !== map.ean) map.code = c; });
    if (map.code === map.desc || map.ean === map.desc) map.desc = -1;
    // Descripción: si no hay encabezado, la columna de texto más larga
    if (map.desc < 0) {
      var bestLen = 0;
      for (var d = 0; d < ncols; d++) {
        if (d === map.code || d === map.ean || d === map.qty || d === map.pdv || d === map.evento) continue;
        var tot = 0; sample.forEach(function (r) { var v = str(r[d]); if (/[A-Z]{3,}/i.test(v)) tot += v.length; });
        if (tot > bestLen) { bestLen = tot; map.desc = d; }
      }
    }
    // Cantidad: si no hay encabezado, la columna numérica de enteros pequeños más a la derecha
    if (map.qty < 0) {
      for (var q = ncols - 1; q >= 0; q--) {
        if (q === map.code || q === map.ean || q === map.evento) continue;
        var nums = 0, cnt = 0;
        sample.forEach(function (r) { var v = str(r[q]).trim(); if (!v) return; cnt++; if (QTY_RE.test(v) && parseQty(v) < 10000) nums++; });
        if (cnt && nums / cnt > 0.8) { map.qty = q; break; }
      }
    }
    return { headerRow: hr, headers: headers, map: map, ncols: ncols };
  }

  /** Aplica el mapeo de columnas y devuelve filas genéricas. */
  function tableToRows(table, det) {
    var m = det.map, out = [], dates = [];
    var ec = m.evento != null && m.evento >= 0 ? m.evento : -1, cur = '';
    // IDs en el título, encima de los encabezados ("Ventas ACT-0123 y ACT-0124")
    var titleIds = [];
    table.slice(0, Math.max(0, det.headerRow)).forEach(function (r) {
      eventTokens((r || []).map(str).join(' ')).forEach(function (t) { if (titleIds.indexOf(t) < 0) titleIds.push(t); });
    });
    var data = table.slice(det.headerRow + 1);
    data.forEach(function (r) {
      if (!r || !r.some(function (c) { return str(c).trim() !== ''; })) return;
      var code = m.code >= 0 ? str(r[m.code]).trim() : '';
      var desc = m.desc >= 0 ? str(r[m.desc]).trim() : '';
      var ean = m.ean != null && m.ean >= 0 ? str(r[m.ean]).trim() : '';
      var qty = m.qty >= 0 ? parseQty(r[m.qty]) : null;
      // Columna del evento: si viene vacía (celdas combinadas por PDV) sigue el ID de la fila de arriba
      if (ec >= 0) { var ev = str(r[ec]).trim(); if (ev) cur = ev; }
      else if (qty == null && (!code || eventTokens(code).length)) {
        // Fila-título de sección: "ACT-0123 · DROGUERÍA CENTRO" → las filas de abajo son de ese evento
        var t = eventTokens(r.map(str).join(' '));
        if (t.length === 1) { cur = t[0]; return; }
      }
      if (!code && !desc && !ean) return;
      if (/^TOTAL/i.test(stripAccents(code + ' ' + desc))) return;
      var row = { code: code, desc: desc, qty: qty };
      if (ean) row.ean = ean;
      if (cur) row.eventId = cur;
      if (m.pdv >= 0) row.pdvText = str(r[m.pdv]).trim();
      if (m.pdvCode >= 0) row.pdvCode = str(r[m.pdvCode]).trim();
      if (m.date >= 0) { var d = parseDate(r[m.date]); if (d) { row.date = isoDate(d); dates.push(d); } }
      out.push(row);
    });
    dates.sort(function (a, b) { return a - b; });
    return { rows: out, dates: dates.length ? { from: isoDate(dates[0]), to: isoDate(dates[dates.length - 1]) } : { from: '', to: '' }, titleIds: titleIds };
  }

  // =====================================================================
  // 5. DETECCIÓN DE CLIENTE y CRUCE DE PRODUCTOS
  // =====================================================================

  function codeVariants(code) {
    var c = canonCode(code), v = [c];
    var fixed = c.replace(/(?<=\d)O|O(?=\d)/g, '0').replace(/(?<=\d)[IL]|[IL](?=\d)/g, '1');
    if (fixed !== c) v.push(fixed);
    return v;
  }

  /** Ranking de clientes (Origin) según cuántos códigos del archivo existen para cada uno. */
  function detectClient(rows, idx, text) {
    var votes = {}, total = 0;
    rows.forEach(function (r) {
      if (!r.code) return;
      var vs = codeVariants(r.code), entries = null;
      for (var i = 0; i < vs.length && !entries; i++) entries = idx.byCode[vs[i]];
      total++;
      if (!entries) return;
      var origins = {};
      entries.forEach(function (e) { origins[e.origin] = 1; });
      var ks = Object.keys(origins);
      ks.forEach(function (o) { votes[o] = (votes[o] || 0) + 1 / ks.length; });
    });
    var normT = ' ' + normText(text || '') + ' ';
    idx.originList.forEach(function (o) {
      var on = normText(o.replace(/\b(S\.?A\.?S?|LTDA|S\.?A)\b\.?/gi, ''));
      if (on.length >= 5 && normT.indexOf(' ' + on + ' ') >= 0) votes[o] = (votes[o] || 0) + 3;
    });
    var ranking = Object.keys(votes).map(function (o) { return { origin: o, score: votes[o], coverage: total ? Math.min(1, votes[o] / total) : 0 }; })
      .sort(function (a, b) { return b.score - a.score; });
    return { best: ranking.length ? ranking[0].origin : '', ranking: ranking.slice(0, 8), totalCodes: total };
  }

  function productInfo(idx, ean) {
    var p = idx.products[ean];
    return p ? { ean: ean, producto: p.name, bu: p.bu || 'OTRO' } : { ean: ean, producto: '', bu: '' };
  }

  /** Peso de una palabra según qué tan rara es en los nombres del catálogo (se calcula una vez por índice). */
  function wordWeight(idx) {
    if (idx._w) return idx._w;
    var df = {}, n = idx.nameCands.length || 1;
    idx.nameCands.forEach(function (c) {
      var seen = {};
      fuzzyToks(c.p).forEach(function (t) { if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; } });
    });
    var maxW = Math.log(n + 1) + 1;
    idx._w = function (t) { return df[t] ? Math.log((n + 1) / (df[t] + 1)) + 1 : (/\d/.test(t) ? 1.5 : maxW); };
    return idx._w;
  }

  function searchByName(desc, idx, origin, limit) {
    var pq = prep(desc);
    if (!pq.norm) return [];
    // 1) preselección rápida (trigramas + palabras) sobre todo el catálogo
    var pool = [];
    (idx.originRows[origin] || []).forEach(function (e) {
      if (!e.clientDesc || e.omit || !idx.products[e.ean]) return;
      e._p = e._p || prep(e.clientDesc);
      pool.push({ ean: e.ean, p: e._p, text: e.clientDesc, k: 1, s0: similarityP(pq, e._p) });
    });
    idx.nameCands.forEach(function (c) { pool.push({ ean: c.ean, p: c.p, text: c.text, k: 0.97, s0: similarityP(pq, c.p) }); });
    pool.sort(function (a, b) { return b.s0 - a.s0; });
    // 2) Fuzzy Lookup con todas las palabras sobre los mejores 80
    var w = wordWeight(idx), best = {};
    pool.slice(0, 80).forEach(function (c) {
      var s = c.s0 >= 1 ? 1 : 0.4 * c.s0 + 0.6 * fuzzyP(pq, c.p, w);
      s *= c.k;
      if (!best[c.ean] || s > best[c.ean].score) best[c.ean] = { ean: c.ean, score: s, via: c.text };
    });
    return Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, limit || 5)
      .map(function (c) { var pi = productInfo(idx, c.ean); return { ean: c.ean, producto: pi.producto, bu: pi.bu, score: Math.round(c.score * 100) / 100, via: c.via }; });
  }

  /**
   * Cruza una fila contra los Master. Devuelve la fila enriquecida con:
   * ean, producto, bu, method, confidence (0..1), status ('ok'|'revisar'|'sin_cruce'|'omitido'), candidates.
   */
  /** ¿EAN-13 con dígito verificador correcto? */
  function eanValid(s) {
    if (!/^\d{13}$/.test(s)) return false;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    return (10 - sum % 10) % 10 === Number(s[12]);
  }
  /** Variantes de un código con un error de lectura: un dígito cambiado, uno de más, uno de menos o dos vecinos invertidos. */
  function oneDigitVariants(s) {
    var out = {}, i, d;
    for (i = 0; i < s.length; i++) {
      for (d = 0; d <= 9; d++) if (String(d) !== s[i]) out[s.slice(0, i) + d + s.slice(i + 1)] = 'sub';
      if (s.length >= 7) out[s.slice(0, i) + s.slice(i + 1)] = 'del';
      if (i < s.length - 1 && s[i] !== s[i + 1]) out[s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2)] = 'swap';
    }
    if (s.length >= 6 && s.length < 13) for (i = 0; i <= s.length; i++) for (d = 0; d <= 9; d++) out[s.slice(0, i) + d + s.slice(i)] = 'ins';
    return out;
  }
  /**
   * El OCR leyó mal un dígito del código o del EAN: si una sola variante existe en el EAN Master, es ese producto.
   * Con varias posibles, decide la descripción. Confianza alta si el EAN leído es inválido y el corregido válido,
   * o si la descripción se parece al producto.
   */
  function fixMisreadCode(row, origin, idx) {
    var hits = {};
    [['ean', row.ean], ['code', row.code]].forEach(function (pair) {
      var s = canonCode(pair[1]);
      if (!/^\d{6,14}$/.test(s)) return;
      var vs = oneDigitVariants(s);
      Object.keys(vs).forEach(function (v) {
        var e = idx.byOriginCode[origin + '|' + v];
        if (e && !e.omit && idx.products[e.ean]) hits[e.ean] = hits[e.ean] || { ean: e.ean, via: 'Código cliente (corrección OCR)', from: s, to: v, clientDesc: e.clientDesc };
        if (idx.products[v]) hits[v] = hits[v] || { ean: v, via: 'EAN ISDIN (corrección OCR)', from: s, to: v, checksum: s.length === 13 && !eanValid(s) && eanValid(v) };
      });
    });
    var list = Object.keys(hits).map(function (k) { return hits[k]; });
    if (!list.length) return null;
    list.forEach(function (h) {
      var pi = productInfo(idx, h.ean);
      h.sim = row.desc ? Math.max(similarity(row.desc, pi.producto), h.clientDesc ? similarity(row.desc, h.clientDesc) : 0) : 0;
    });
    list.sort(function (a, b) { return b.sim - a.sim; });
    var top = list[0];
    if (list.length > 1 && !(top.sim >= 0.5 && top.sim - list[1].sim >= 0.15)) {
      return { ean: top.ean, method: top.via + ' · revisar', conf: 0.6, candidates: list.slice(0, 5).map(candOf) };
    }
    var conf = (top.checksum || top.sim >= 0.4) ? 0.9 : 0.75;
    return { ean: top.ean, method: top.via + ' (' + top.from + ' → ' + top.to + ')', conf: conf, candidates: list.slice(0, 5).map(candOf) };
    function candOf(h) { var pi = productInfo(idx, h.ean); return { ean: h.ean, producto: pi.producto, bu: pi.bu, score: Math.round((h.sim || 0.6) * 100) / 100, via: h.via + ' ' + h.to }; }
  }

  function matchProduct(row, origin, idx) {
    var res = { code: row.code || '', desc: row.desc || '', qty: row.qty, ean: '', producto: '', bu: '', method: '', confidence: 0, status: 'sin_cruce', candidates: [], omit: false };
    if (row.pdvText) res.pdvText = row.pdvText;
    if (row.pdvCode) res.pdvCode = row.pdvCode;
    if (row.date) res.date = row.date;

    function accept(ean, method, conf) {
      var pi = productInfo(idx, ean);
      res.ean = ean; res.producto = pi.producto; res.bu = pi.bu; res.method = method; res.confidence = conf;
      res.status = conf >= 0.85 ? 'ok' : 'revisar';
    }

    // a) código exacto del cliente
    if (row.code) {
      var vs = codeVariants(row.code);
      for (var i = 0; i < vs.length; i++) {
        var e = idx.byOriginCode[origin + '|' + vs[i]];
        if (e) {
          if (e.omit) { res.omit = true; res.status = 'omitido'; res.method = 'Master: OMITIR'; return res; }
          if (idx.products[e.ean]) { accept(e.ean, i === 0 ? 'Código cliente' : 'Código cliente (corrección OCR)', i === 0 ? 1 : 0.9); return res; }
        }
      }
      // b) el código es un EAN ISDIN
      if (idx.products[vs[0]]) { accept(vs[0], 'EAN ISDIN', 1); return res; }
      // c) alias aprendido por código
      var al = idx.alias['PRODUCTO|' + origin + '|' + aliasKeyProduct(row.code, '')];
      if (al && idx.products[al.valor]) { accept(al.valor, 'Aprendido (código)', 0.98); return res; }
      // d) el código existe pero en otro cliente
      var other = idx.byCode[vs[0]];
      if (other && other.length) {
        var ok = other.filter(function (x) { return !x.omit && idx.products[x.ean]; });
        if (ok.length) {
          accept(ok[0].ean, 'Código de otro cliente (' + ok[0].origin + ')', 0.7);
          res.candidates = ok.slice(0, 5).map(function (x) { var pi = productInfo(idx, x.ean); return { ean: x.ean, producto: pi.producto, bu: pi.bu, score: 0.7, via: x.origin + ': ' + x.clientDesc }; });
        }
      }
    }
    // d2) columna EAN del archivo (además del código del cliente)
    if (row.ean) {
      var ev13 = canonCode(row.ean);
      if (!res.code) res.code = row.ean;
      if (idx.products[ev13]) { accept(ev13, 'EAN ISDIN', 1); return res; }
    }
    // d3) código o EAN con un dígito mal leído por el OCR (8429420200885 → 8429420280885, 12073241 → 1273241)
    if (!res.ean && (row.code || row.ean)) {
      var fix = fixMisreadCode(row, origin, idx);
      if (fix) {
        accept(fix.ean, fix.method, fix.conf);
        res.candidates = fix.candidates;
        if (fix.conf >= 0.85) return res;
      }
    }
    // e) alias aprendido por descripción
    if (row.desc) {
      var al2 = idx.alias['PRODUCTO|' + origin + '|' + aliasKeyProduct('', row.desc)];
      if (al2 && idx.products[al2.valor]) { accept(al2.valor, 'Aprendido (nombre)', 0.98); return res; }
      if (res.ean && res.confidence >= 0.85) return res;
      // f) similitud de nombre
      var cands = searchByName(row.desc, idx, origin, 5);
      if (cands.length) {
        var top = cands[0], second = cands[1] ? cands[1].score : 0;
        if (!res.ean || top.score > res.confidence) {
          var conf = top.score;
          if (top.score >= 0.8 && top.score - second >= 0.08) conf = Math.max(conf, 0.86);
          else if (top.score - second < 0.03) conf = Math.min(conf, 0.7);
          accept(top.ean, 'Nombre aproximado', Math.round(conf * 100) / 100);
          if (top.score < 0.45) {
            // Demasiado débil: no se precarga ningún producto; el usuario debe elegir
            res.ean = ''; res.producto = ''; res.bu = ''; res.status = 'sin_cruce'; res.method = 'Sin cruce';
          }
        }
        if (!res.candidates.length) res.candidates = cands;
      }
    }
    return res;
  }

  // =====================================================================
  // 6. EVENTOS (pestaña "Detalle eventos")
  // =====================================================================

  var MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

  /** Convierte las filas de "Detalle eventos" (con encabezado) en objetos. */
  function parseEvents(values) {
    if (!values || !values.length) return [];
    var h = headerIndex(values[0], ['ID RESUMEN', 'ID EVENTO', 'SOLICITANTE', 'MES', 'FECHA INICIO', 'FECHA FIN', 'SAP ID', 'DIAS', 'CLIENTE', 'ID PDV', 'PDV', 'PDV MANUAL', 'CIUDAD', 'TIPO EVENTO', 'ESTADO', 'NOMBRE DERMO']);
    var out = [];
    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      var id = str(r[h['ID RESUMEN']]).trim();
      if (!id) continue;
      var ini = parseDate(r[h['FECHA INICIO']]), fin = parseDate(r[h['FECHA FIN']]);
      out.push({
        row: i + 1, idResumen: id, idEvento: str(r[h['ID EVENTO']]).trim(), solicitante: str(r[h.SOLICITANTE]).trim(),
        mes: str(r[h.MES]).trim(), inicio: ini ? isoDate(ini) : '', fin: fin ? isoDate(fin) : (ini ? isoDate(ini) : ''),
        sap: canonCode(r[h['SAP ID']]), dias: str(r[h.DIAS]).trim(), cliente: str(r[h.CLIENTE]).trim(),
        idPdv: str(r[h['ID PDV']]).trim(), pdv: str(r[h.PDV]).trim(), pdvManual: str(r[h['PDV MANUAL']]).trim(),
        ciudad: str(r[h.CIUDAD]).trim(), tipo: str(r[h['TIPO EVENTO']]).trim(), estado: str(r[h.ESTADO]).trim(),
        dermo: str(r[h['NOMBRE DERMO']]).trim()
      });
    }
    return out;
  }

  function cleanCompany(s) {
    return normText(str(s).replace(/\(.*?\)/g, ' ').replace(/\b(S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?|LTDA\.?|SAS)\b/gi, ' '));
  }

  function dayDiff(a, b) { return Math.round((parseDate(a) - parseDate(b)) / 86400000); }

  /**
   * Busca eventos candidatos.
   * q: { origin, from, to, pdvText, pdvIds:[], clienteAlias }
   */
  function matchEvents(q, events, idx, limit) {
    var saps = {};
    (idx.sapByOrigin[q.origin] || []).forEach(function (s) { saps[s] = 1; });
    var originName = q.origin || '';
    var originInner = (/\(([^)]+)\)/.exec(originName) || [])[1] || '';
    var pClient = prep(cleanCompany(originName));
    var pInner = originInner ? prep(cleanCompany(originInner)) : null;
    var aliasName = q.clienteAlias ? prep(cleanCompany(q.clienteAlias)) : null;
    var pPdv = q.pdvText ? prep(q.pdvText) : null;
    var pdvIds = {}; (q.pdvIds || []).forEach(function (x) { if (x) pdvIds[x] = 1; });

    var out = [];
    events.forEach(function (ev) {
      var cs = 0;
      if (!q.origin) cs = 0.5;
      else if (ev.sap && saps[ev.sap]) cs = 1;
      else {
        var pe = prep(cleanCompany(ev.cliente));
        cs = similarityP(pClient, pe);
        if (pInner) cs = Math.max(cs, similarityP(pInner, pe));
        if (aliasName) cs = Math.max(cs, similarityP(aliasName, pe) >= 0.95 ? 1 : 0);
      }
      if (q.origin && cs < 0.6) return;

      var ds = 0.5;
      if (q.from && ev.inicio) {
        var from = q.from, to = q.to || q.from;
        var overlap = !(to < ev.inicio || from > ev.fin);
        if (overlap) ds = 1;
        else {
          var gap = Math.min(Math.abs(dayDiff(from, ev.fin)), Math.abs(dayDiff(to, ev.inicio)));
          ds = Math.max(0, 1 - gap / 20);
        }
      }
      if (q.from && ds === 0) return;

      var ps = 0.5;
      if (ev.idPdv && pdvIds[ev.idPdv]) ps = 1;
      else if (pPdv) ps = Math.max(similarityP(pPdv, prep(ev.pdv)), ev.pdvManual ? similarityP(pPdv, prep(ev.pdvManual)) : 0);

      var est = /RECHAZ|CANCEL/i.test(ev.estado) ? 0.5 : 1;
      var score = (0.35 * cs + 0.4 * ds + 0.25 * ps) * est;
      out.push({ ev: ev, score: Math.round(score * 100) / 100, clientScore: Math.round(cs * 100) / 100, dateScore: Math.round(ds * 100) / 100, pdvScore: Math.round(ps * 100) / 100 });
    });
    out.sort(function (a, b) { return b.score - a.score || (a.ev.inicio < b.ev.inicio ? 1 : -1); });
    return out.slice(0, limit || 15);
  }

  // ---------------------------------------------------------------------
  // ID RESUMEN en el nombre del archivo o de la carpeta ("ACT-0123.jpg", "act 123/foto.png", "EVT_0004 ventas.xlsx")
  // ---------------------------------------------------------------------
  var ID_IN_NAME = /(?<![A-Z])([A-Z]{2,6})[\s_\-.#]*(\d{1,7})(?!\d)/g;
  function idKey(prefix, num) { return prefix.toUpperCase() + '-' + String(Number(num)); }

  /**
   * Busca en la ruta (carpeta/archivo) un ID RESUMEN que exista en "Detalle eventos".
   * Prioriza el nombre del archivo y luego las carpetas, de la más cercana a la más lejana.
   * Devuelve { ev, id, others:[ids], notFound: 'ACT-9999' } o null si no hay nada parecido a un ID.
   */
  function findIdInName(name, events) {
    var byKey = {}, prefixes = {};
    (events || []).forEach(function (ev) {
      var m = /^([A-Z]{2,6})[\s_\-.#]*0*(\d{1,7})$/i.exec(str(ev.idResumen).trim());
      if (!m) return;
      var k = idKey(m[1], m[2]);
      if (!byKey[k]) byKey[k] = ev;
      prefixes[m[1].toUpperCase()] = 1;
    });
    var parts = stripAccents(str(name)).toUpperCase().split(/[\/\\]/).filter(Boolean).reverse();
    var found = [], missing = '';
    parts.forEach(function (p) {
      var base = p.replace(/\.[A-Z0-9]{2,5}$/, ''), m;
      ID_IN_NAME.lastIndex = 0;
      while ((m = ID_IN_NAME.exec(base))) {
        var k = idKey(m[1], m[2]);
        if (byKey[k]) { if (found.indexOf(byKey[k]) < 0) found.push(byKey[k]); }
        else if (prefixes[m[1]] && !missing) { var n = String(Number(m[2])); while (n.length < 4) n = '0' + n; missing = m[1] + '-' + n; }
      }
    });
    if (!found.length) return missing ? { ev: null, id: '', others: [], evs: [], notFound: missing } : null;
    return { ev: found[0], id: found[0].idResumen, others: found.slice(1).map(function (e) { return e.idResumen; }), evs: found, notFound: '' };
  }

  // ---------------------------------------------------------------------
  // Consolidados: varios eventos en un mismo archivo (columna con el ID por PDV, filas-título o líneas del OCR)
  // ---------------------------------------------------------------------
  var EVENT_TOKEN = /(?<![A-Z0-9])(ACT|EVT)[\s_\-.#]*(\d{1,7})(?!\d)/gi;
  var EVENT_CELL = /^\s*(ACT|EVT|MAN)[\s_\-.#]*\d{1,7}\s*$/i;
  function pad4(n) { n = String(Number(n)); while (n.length < 4) n = '0' + n; return n; }

  /** IDs de evento que aparecen en un texto, normalizados ("act 123" → "ACT-0123"). */
  function eventTokens(s) {
    var out = [], m, t = stripAccents(str(s)).toUpperCase();
    EVENT_TOKEN.lastIndex = 0;
    while ((m = EVENT_TOKEN.exec(t))) { var k = m[1] + '-' + pad4(m[2]); if (out.indexOf(k) < 0) out.push(k); }
    return out;
  }
  function stripEventTokens(s) { EVENT_TOKEN.lastIndex = 0; return str(s).replace(EVENT_TOKEN, ' ').replace(/\s+/g, ' ').trim(); }

  /**
   * Devuelve una función que traduce lo que trae una fila ("ACT-0123", "act 123", "123", "EVT-0004") al evento de
   * "Detalle eventos": { id, ev } (ev = null si no existe). nameEvs = eventos del nombre del archivo, para los
   * números sueltos ("123" en la columna EVENTO de un archivo llamado "ACT-0123 ACT-0124.xlsx").
   */
  function eventResolver(events, nameEvs) {
    var byKey = {}, byEvt = {};
    (events || []).forEach(function (ev) {
      var m = /^([A-Z]{2,6})[\s_\-.#]*0*(\d{1,7})$/i.exec(str(ev.idResumen).trim());
      if (m && !byKey[idKey(m[1], m[2])]) byKey[idKey(m[1], m[2])] = ev;
      var e = /^([A-Z]{2,6})[\s_\-.#]*0*(\d{1,7})$/i.exec(str(ev.idEvento).trim());
      if (e && !byEvt[idKey(e[1], e[2])]) byEvt[idKey(e[1], e[2])] = ev;
    });
    var cache = {};
    return function (raw) {
      raw = str(raw).trim();
      if (!raw) return null;
      if (cache[raw] !== undefined) return cache[raw];
      var res = null, toks = eventTokens(raw);
      if (toks.length) {
        var p = /^([A-Z]+)-(\d+)$/.exec(toks[0]), k = idKey(p[1], p[2]);
        var ev = byKey[k] || byEvt[k] || null;
        res = { id: ev ? ev.idResumen : toks[0], ev: ev };
      } else if (/^\d{1,7}$/.test(raw)) {
        var hits = (nameEvs || []).filter(function (e) { var m = /(\d+)\s*$/.exec(str(e.idResumen)); return m && Number(m[1]) === Number(raw); });
        res = hits.length === 1 ? { id: hits[0].idResumen, ev: hits[0] } : null;
      } else {
        var f = findIdInName(raw, events);
        if (f && f.ev) res = { id: f.ev.idResumen, ev: f.ev };
        else if (f && f.notFound) res = { id: f.notFound, ev: null };
      }
      cache[raw] = res;
      return res;
    };
  }

  // ---------------------------------------------------------------------
  // Carpeta de ventas: qué ya está cargado y qué se puede cargar solo
  // ---------------------------------------------------------------------

  /** Filas y unidades que ya hay en la PLANTILLA por ID RESUMEN. values: [[ID RESUMEN, UNITS], ...] */
  function plantillaStats(values) {
    var out = {};
    (values || []).forEach(function (r) {
      var id = str(r[0]).trim().toUpperCase();
      if (!id) return;
      var s = out[id] || (out[id] = { filas: 0, unidades: 0 });
      s.filas++;
      var u = Number(r[1]); if (isFinite(u)) s.unidades += u;
    });
    return out;
  }

  /** ID de carpeta de Drive a partir de un enlace o del ID suelto. */
  function folderIdFromUrl(s) {
    s = str(s).trim();
    var m = /\/folders\/([A-Za-z0-9_\-]{10,})/.exec(s) || /[?&]id=([A-Za-z0-9_\-]{10,})/.exec(s) || /^([A-Za-z0-9_\-]{10,})$/.exec(s);
    return m ? m[1] : '';
  }

  // Cruces que son seguros para cargar sin revisión humana (por código o confirmados antes por un usuario)
  var AUTO_METHODS = { 'Código cliente': 1, 'Código cliente (corrección OCR)': 1, 'EAN ISDIN': 1, 'Aprendido (código)': 1, 'Aprendido (nombre)': 1 };

  /**
   * ¿Se puede cargar este archivo sin revisión? m = resultado de api_match; stats = plantillaStats.
   * Devuelve { ok, reason }.
   */
  function autoDecision(m, stats) {
    var no = function (r) { return { ok: false, reason: r }; };
    var f = m.idFromName;
    var evs = (m.groups || []).filter(function (g) { return g.eventId; }).map(function (g) { return g.eventId; });
    if (evs.length > 1) return no('Consolidado de ' + evs.length + ' eventos (' + evs.join(', ') + '): revísalo y cárgalo desde la página');
    if (!f) return no('Sin ID RESUMEN en el nombre del archivo o carpeta');
    if (f.notFound) return no('El ID ' + f.notFound + ' no está en "Detalle eventos"');
    if (/RECHAZ|CANCEL/i.test(f.estado || '')) return no('El evento está ' + f.estado);
    if (!f.origin) return no('El cliente del evento no está en el EAN Master');
    if (f.conflict) return no('Los códigos del archivo coinciden con otro cliente (' + f.codesOrigin + ')');
    var st = stats && stats[str(f.idResumen).toUpperCase()];
    if (st) return no('El evento ya tiene ' + st.filas + ' filas (' + st.unidades + ' unidades) en la PLANTILLA');
    if (m.groups.length !== 1) return no('El archivo trae varios puntos de venta');
    var act = m.products.filter(function (p) { return !p.omit; });
    if (!act.length) return no('No se encontraron productos en el archivo');
    var rev = act.filter(function (p) { return p.status !== 'ok' || !p.ean || !AUTO_METHODS[p.method]; }).length;
    if (rev) return no(rev + ' de ' + act.length + ' productos necesitan revisión');
    var nq = act.filter(function (p) { return p.qty == null || p.qty === '' || !isFinite(Number(p.qty)); }).length;
    if (nq) return no(nq + ' productos sin cantidad');
    return { ok: true, reason: act.length + ' productos cruzados por código' };
  }

  /** Cliente del EAN Master (Origin) que corresponde a un evento: por SAP ID (PDV Master BD) o por nombre. */
  function originForEvent(ev, idx) {
    if (!ev) return { origin: '', method: '' };
    var pe = prep(cleanCompany(ev.cliente));
    var byName = function (list) {
      var best = { origin: '', s: 0 };
      list.forEach(function (o) {
        var inner = (/\(([^)]+)\)/.exec(o) || [])[1] || '';
        var s = Math.max(similarityP(prep(cleanCompany(o)), pe), inner ? similarityP(prep(cleanCompany(inner)), pe) : 0);
        if (s > best.s) best = { origin: o, s: s };
      });
      return best;
    };
    if (ev.sap) {
      var bySap = Object.keys(idx.sapByOrigin).filter(function (o) { return idx.origins[o] && idx.sapByOrigin[o].indexOf(ev.sap) >= 0; });
      if (bySap.length === 1) return { origin: bySap[0], method: 'SAP ID ' + ev.sap };
      if (bySap.length > 1) return { origin: byName(bySap).origin || bySap[0], method: 'SAP ID ' + ev.sap };
    }
    var b = byName(idx.originList);
    return b.s >= 0.6 ? { origin: b.origin, method: 'Nombre del cliente' } : { origin: '', method: '' };
  }

  /** Resuelve el PDV de una fila (código o nombre del cliente) contra el PDV Master. */
  function resolvePdv(origin, pdvCode, pdvText, idx) {
    var res = { isdinDesc: '', sfId: '', cuentaId: '', method: '' };
    if (pdvCode) {
      var pt = idx.puntosByOriginCode[origin + '|' + canonCode(pdvCode)];
      if (pt) { res.isdinDesc = pt.isdinDesc; res.sfId = pt.sfId; res.method = 'Código PDV'; }
    }
    if (!res.isdinDesc && pdvText) {
      var al = idx.alias['PDV|' + origin + '|' + normText(pdvText)];
      if (al) { res.isdinDesc = al.desc || al.valor; res.sfId = al.valor; res.method = 'Aprendido'; }
    }
    if (!res.isdinDesc && pdvText) {
      var pq = prep(pdvText), best = null, bs = 0;
      (idx.puntosByOrigin[origin] || []).forEach(function (p) {
        p._p = p._p || prep(p.desc);
        p._p2 = p._p2 || prep(p.isdinDesc);
        var s = Math.max(similarityP(pq, p._p), similarityP(pq, p._p2));
        if (s > bs) { bs = s; best = p; }
      });
      if (best && bs >= 0.75) { res.isdinDesc = best.isdinDesc; res.sfId = best.sfId; res.method = 'Nombre aproximado (' + Math.round(bs * 100) + '%)'; }
    }
    if (res.sfId) {
      var c = idx.cuentaByOficina[res.sfId.toUpperCase()];
      if (c) res.cuentaId = c.id;
    }
    return res;
  }

  // =====================================================================
  // 7. SALIDA a la PLANTILLA (A:L)
  // =====================================================================

  function mesDe(iso) { var d = parseDate(iso); return d ? MESES[d.getMonth()] : ''; }

  function diasEntre(a, b) {
    if (!a) return '';
    var d = dayDiff(b || a, a);
    return isNaN(d) ? '' : String(d + 1);
  }

  /**
   * ev: evento de Detalle eventos (o null)
   * manual: { id, nombre, tipo, from, to, cliente, solicitante, dermo }
   * Columnas: MES, DIAS, ID RESUMEN, SOLICITANTE, CLIENTE, ISDIN PDV, TIPO DE EVENTO, EAN, PRODUCTO, UNITS, BU, DERMO
   */
  function toNum(v) { var s = str(v).trim(); return /^\d+(\.\d+)?$/.test(s) ? Number(s) : s; }

  function buildTemplateRows(products, ev, manual) {
    var head;
    if (ev) {
      head = [str(ev.mes).toUpperCase() || mesDe(ev.inicio), toNum(ev.dias || diasEntre(ev.inicio, ev.fin)), ev.idResumen, ev.solicitante,
        ev.cliente, ev.pdv || ev.pdvManual, ev.tipo];
    } else {
      head = [mesDe(manual.from), toNum(diasEntre(manual.from, manual.to)), manual.id || '', manual.solicitante || '',
        manual.cliente || '', manual.nombre || '', manual.tipo || ''];
    }
    var dermo = ev ? ev.dermo : (manual.dermo || '');
    // Mismos tipos que la PLANTILLA existente: DIAS, EAN y UNITS como número
    return products.filter(function (p) { return !p.omit && p.ean && p.qty != null && p.qty !== ''; })
      .map(function (p) {
        var units = Number(p.qty);
        return head.concat([toNum(p.ean), p.producto, isFinite(units) ? units : p.qty, p.bu || 'OTRO', dermo]);
      });
  }

  /**
   * Eventos de un mes (por FECHA INICIO; si no tiene fecha, por la columna MES) con su estado de carga.
   * ym: 'YYYY-MM'. stats: plantillaStats. opts.incluirCancelados: también RECHAZADO/CANCELADO.
   * No quita los ya cargados: los marca con cargado = true.
   */
  function monthReport(events, stats, ym, opts) {
    opts = opts || {};
    var m = /^(\d{4})-(\d{1,2})$/.exec(str(ym).trim());
    if (!m) throw new Error('Mes no válido: ' + ym);
    var y = +m[1], mo = +m[2], mesName = MESES[mo - 1];
    var rows = (events || []).filter(function (ev) {
      if (!opts.incluirCancelados && /RECHAZ|CANCEL/i.test(ev.estado)) return false;
      if (ev.inicio) return +ev.inicio.slice(0, 4) === y && +ev.inicio.slice(5, 7) === mo;
      return normText(ev.mes) === mesName;
    }).map(function (ev) {
      var s = stats && stats[str(ev.idResumen).toUpperCase()];
      return {
        mes: ev.mes ? stripAccents(ev.mes).toUpperCase() : mesName,
        dias: toNum(ev.dias || diasEntre(ev.inicio, ev.fin)),
        idResumen: ev.idResumen, solicitante: ev.solicitante, cliente: ev.cliente, pdv: ev.pdv || ev.pdvManual,
        tipo: ev.tipo, dermo: ev.dermo, estado: ev.estado, inicio: ev.inicio, fin: ev.fin,
        cargado: !!s, filas: s ? s.filas : 0, unidades: s ? s.unidades : 0
      };
    }).sort(function (a, b) {
      return (a.inicio || '9') < (b.inicio || '9') ? -1 : (a.inicio || '9') > (b.inicio || '9') ? 1 : (a.idResumen < b.idResumen ? -1 : 1);
    });
    var cargados = rows.filter(function (r) { return r.cargado; }).length;
    return { ym: y + '-' + (mo < 10 ? '0' : '') + mo, mes: mesName, anio: y, rows: rows, total: rows.length, cargados: cargados, faltan: rows.length - cargados };
  }

  /** Siguiente ID artificial: MAN-0001, MAN-0002... */
  function nextManualId(existingIds, prefix) {
    prefix = prefix || 'MAN-';
    var max = 0;
    (existingIds || []).forEach(function (id) {
      var m = new RegExp('^' + prefix + '(\\d+)$').exec(str(id).trim());
      if (m) max = Math.max(max, +m[1]);
    });
    var n = String(max + 1); while (n.length < 4) n = '0' + n;
    return prefix + n;
  }

  return {
    stripAccents: stripAccents, canonCode: canonCode, normText: normText, similarity: similarity,
    xlsxSheetPaths: xlsxSheetPaths, xlsxSharedStrings: xlsxSharedStrings, xlsxSheetRows: xlsxSheetRows,
    buildMasterCache: buildMasterCache, buildIndex: buildIndex, aliasKeyProduct: aliasKeyProduct,
    parseQty: parseQty, parseDate: parseDate, isoDate: isoDate, findDates: findDates,
    parseOcrText: parseOcrText, isHeaderLine: isHeaderLine, inferNumericCodeLen: inferNumericCodeLen, splitAtCodes: splitAtCodes, detectTable: detectTable, tableToRows: tableToRows,
    splitByUnits: splitByUnits, realignDescs: realignDescs,
    detectClient: detectClient, matchProduct: matchProduct, searchByName: searchByName, productInfo: productInfo,
    parseEvents: parseEvents, matchEvents: matchEvents, resolvePdv: resolvePdv,
    findIdInName: findIdInName, eventTokens: eventTokens, eventResolver: eventResolver, originForEvent: originForEvent,
    plantillaStats: plantillaStats, folderIdFromUrl: folderIdFromUrl, autoDecision: autoDecision, monthReport: monthReport,
    buildTemplateRows: buildTemplateRows, nextManualId: nextManualId, mesDe: mesDe, diasEntre: diasEntre, MESES: MESES
  };
})();

if (typeof module !== 'undefined') module.exports = Core;
