/**
 * Config.gs — Parámetros del Lector de Ventas de Eventos.
 * Los secretos (clave de Claude) NO van aquí: van en Propiedades del script.
 */
var CONFIG = {
  // Google Sheet "Eventos Trade Marketing 2.0"
  SPREADSHEET_ID: '1hvRWXpxB1hMwNC_aDGvfjmcAS-SNyB4aUl-SX7SpWAA',
  TAB_PLANTILLA: 'PLANTILLA VENTAS EVENTOS',          // se escriben columnas A:L
  TAB_EVENTOS: 'Detalle eventos',                      // fuente del ID RESUMEN (solo lectura)
  TAB_USUARIOS: 'Usuarios',                            // control de acceso (solo lectura)
  TAB_BU: 'PLANTILLA VENTAS EVENTOS_Backup',           // tabla SUB FAMILIA / ISDIN EAN (solo lectura)
  BU_RANGE: 'S2:V',

  // Pestañas propias del lector (se crean solas la primera vez)
  TAB_ALIAS: 'LV_Alias',
  TAB_MANUALES: 'LV_Eventos_Manuales',
  TAB_CARGAS: 'LV_Cargas',
  TAB_ARCHIVOS: 'LV_Archivos',                         // estado de cada archivo de la carpeta de ventas

  // Carpeta de ventas: el enlace lo configura un Admin desde la página (se guarda en Propiedades del script)
  INBOX_MAX_FILES: 1000,          // tope de archivos que se listan
  INBOX_MAX_DEPTH: 3,             // niveles de subcarpetas
  INBOX_TIME_BUDGET_MS: 270000,   // 4,5 min por corrida (Apps Script corta a los 6)
  INBOX_AUTO_EVERY_HOURS: 1,

  // Master en Google Drive — SOLO LECTURA. Nunca se modifican ni se convierten.
  // Carpeta VENTAS (G:\.shortcut-targets-by-id\1PnIjeF9jZRT5wM_yLKfPurxgz9DehHl4\VENTAS)
  MASTERS_FOLDER_ID: '1PnIjeF9jZRT5wM_yLKfPurxgz9DehHl4',
  MASTERS_SUBFOLDER: 'SELL-OUT',
  EAN_MASTER_NAME: 'EAN MASTER Master.xlsx',
  PDV_MASTER_NAME: 'PDV MASTER Master.xlsx',
  // Hojas que se leen (la hoja "Control" del EAN Master NO se lee nunca)
  EAN_SHEETS: { Master_EAN: 12 },
  PDV_SHEETS: { Master_Puntos: 20, BD: 17, MAESTRO_PDV: 23 },

  MANUAL_ID_PREFIX: 'MAN-',
  CACHE_FILE_NAME: 'LV_cache_masters.json',
  MASTERS_REFRESH_HOUR: 6,

  // Opcional: lectura de fotos con Claude si existe la propiedad ANTHROPIC_API_KEY
  CLAUDE_MODEL: 'claude-opus-5-5',
  CLAUDE_API_VERSION: '2026-10-21'
};
