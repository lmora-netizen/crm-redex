// Capa de datos: cada tabla es una pestaña de la hoja ligada al proyecto.
// La fila 1 tiene los encabezados; cada registro tiene un `id` numérico
// (Onboarding usa `asignacion_id`).

const ZONA = 'America/Mexico_City';

const ESQUEMA = {
  Clientes: ['id', 'nombre', 'contacto', 'telefono'],
  Localidades: ['id', 'nombre', 'estado'],
  TiposVehiculo: ['id', 'nombre', 'descripcion'],
  Reclutadores: ['id', 'nombre', 'email'],
  Vacantes: ['id', 'cliente_id', 'localidad_id', 'tipo_vehiculo_id', 'reclutador_id', 'esquema', 'cantidad', 'tentativo',
    'cerrados', 'tarifa_min', 'tarifa_max', 'direccion_origen', 'km_diario', 'tipo_ruta', 'horario', 'dias_operacion',
    'fecha_arranque', 'inicio_inmediato', 'fecha_termino', 'notas', 'seguimiento', 'solicitud_usuario', 'usuario_activo',
    'capacitacion_lp', 'capacitacion_conciliacion', 'creado_en'],
  Proveedores: ['id', 'vacante_id', 'reclutador_id', 'proveedor', 'unidades', 'fecha_disponibilidad', 'estado', 'notas',
    'actualizado_en', 'creado_en', 'fecha_operativo'],
  Etapas: ['id', 'asignacion_id', 'etapa', 'desde', 'hasta'],
  Onboarding: ['asignacion_id', 'fecha_ingreso', 's1_rendimiento', 's1_calificacion', 's1_comentario',
    's2_rendimiento', 's2_calificacion', 's2_comentario'],
  Prospectos: ['id', 'proveedor', 'unidades', 'referencia', 'tipo_vehiculo', 'reclutador_id', 'notas', 'creado_en'],
  Bitacora: ['id', 'fecha', 'usuario', 'tipo', 'vacante_id', 'asignacion_id', 'reclutador_id', 'descripcion',
    'estado_anterior', 'estado_nuevo'],
  Usuarios: ['id', 'correo', 'nombre', 'rol', 'reclutador_id', 'activo', 'ultimo_acceso'],
};

const LLAVE = { Onboarding: 'asignacion_id' };

// Columnas que se leen como número; el resto se lee como texto
const NUMERICAS = new Set(['id', 'cliente_id', 'localidad_id', 'tipo_vehiculo_id', 'reclutador_id', 'vacante_id',
  'asignacion_id', 'cantidad', 'tentativo', 'cerrados', 'tarifa_min', 'tarifa_max', 'dias_operacion', 'inicio_inmediato',
  'unidades', 's1_rendimiento', 's1_calificacion', 's2_rendimiento', 's2_calificacion', 'activo']);

// Columnas con fecha y hora (las demás fechas se guardan como AAAA-MM-DD)
const CON_HORA = new Set(['creado_en', 'actualizado_en', 'desde', 'hasta', 'fecha', 'ultimo_acceso']);

let cache_ = {};

function libro_() {
  const activo = SpreadsheetApp.getActive();
  if (activo) return activo;
  const id = PropertiesService.getScriptProperties().getProperty('HOJA_ID');
  if (!id) throw new Error('El proyecto no está ligado a una hoja: configura la propiedad HOJA_ID.');
  return SpreadsheetApp.openById(id);
}

// Devuelve la pestaña; si no existe la crea con encabezados y formato de texto
function pestana_(nombre) {
  const libro = libro_();
  let hoja = libro.getSheetByName(nombre);
  if (!hoja) {
    const columnas = ESQUEMA[nombre];
    hoja = libro.insertSheet(nombre);
    hoja.getRange(1, 1, 1, columnas.length).setValues([columnas]).setFontWeight('bold');
    hoja.getRange(1, 1, hoja.getMaxRows(), columnas.length).setNumberFormat('@');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function aTexto_(valor, columna) {
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, ZONA, CON_HORA.has(columna) ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
  }
  return valor;
}

function leer_(nombre) {
  if (cache_[nombre]) return cache_[nombre];
  const valores = pestana_(nombre).getDataRange().getValues();
  const encabezados = valores[0].map(String);
  const filas = valores.slice(1)
    .filter(fila => fila.some(v => v !== '' && v !== null))
    .map(fila => {
      const obj = {};
      encabezados.forEach((col, i) => {
        if (!col) return;
        const v = aTexto_(fila[i], col);
        if (v === '' || v === null || v === undefined) obj[col] = null;
        else if (NUMERICAS.has(col)) obj[col] = Number(v);
        else obj[col] = String(v);
      });
      return obj;
    });
  cache_[nombre] = filas;
  return filas;
}

function limpiarCache_() {
  cache_ = {};
}

function filaDe_(nombre, id) {
  const llave = LLAVE[nombre] || 'id';
  const hoja = pestana_(nombre);
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(String);
  const col = encabezados.indexOf(llave);
  const ultima = hoja.getLastRow();
  if (ultima < 2) return { hoja, encabezados, fila: -1 };
  const ids = hoja.getRange(2, col + 1, ultima - 1, 1).getValues();
  const i = ids.findIndex(r => Number(r[0]) === Number(id));
  return { hoja, encabezados, fila: i < 0 ? -1 : i + 2 };
}

const valorCelda_ = v => (v === null || v === undefined ? '' : v);

function insertar_(nombre, obj) {
  const llave = LLAVE[nombre] || 'id';
  const registro = Object.assign({}, obj);
  if (llave === 'id') registro.id = leer_(nombre).reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
  const hoja = pestana_(nombre);
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(String);
  hoja.appendRow(encabezados.map(c => valorCelda_(registro[c])));
  delete cache_[nombre];
  return registro[llave];
}

function actualizar_(nombre, id, cambios) {
  const { hoja, encabezados, fila } = filaDe_(nombre, id);
  if (fila < 0) return false;
  const actual = hoja.getRange(fila, 1, 1, encabezados.length).getValues()[0];
  const nueva = encabezados.map((c, i) => (c in cambios ? valorCelda_(cambios[c]) : actual[i]));
  hoja.getRange(fila, 1, 1, encabezados.length).setValues([nueva]);
  delete cache_[nombre];
  return true;
}

function borrar_(nombre, id) {
  const { hoja, fila } = filaDe_(nombre, id);
  if (fila < 0) return false;
  hoja.deleteRow(fila);
  delete cache_[nombre];
  return true;
}

// Borra todos los registros que cumplan la condición
function borrarDonde_(nombre, condicion) {
  const llave = LLAVE[nombre] || 'id';
  const ids = leer_(nombre).filter(condicion).map(f => f[llave]);
  return ids.filter(id => borrar_(nombre, id)).length;
}

function buscar_(nombre, id) {
  const llave = LLAVE[nombre] || 'id';
  return leer_(nombre).find(r => r[llave] === Number(id)) || null;
}

// Escrituras de a una: evita que dos personas se pisen
function conCandado_(fn) {
  const candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    limpiarCache_();
    return fn();
  } finally {
    SpreadsheetApp.flush();
    candado.releaseLock();
  }
}

function ahora_() {
  return Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd HH:mm:ss');
}

function dia_(desplazamiento) {
  const d = new Date(Date.now() + (desplazamiento || 0) * 86400000);
  return Utilities.formatDate(d, ZONA, 'yyyy-MM-dd');
}

// Crea todas las pestañas que falten (se puede ejecutar desde el editor)
function prepararHoja() {
  Object.keys(ESQUEMA).forEach(pestana_);
}
