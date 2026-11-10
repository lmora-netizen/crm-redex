'use strict';

// Plantilla de Excel para capturar vacantes, proveedores y onboarding, y su importación.
// La importación nunca borra: crea lo nuevo y actualiza lo que ya existe.

const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { ESTADOS, dia } = require('./db');
const { limpio, dinero, entero, fecha, avance, tipoVehiculo, capitalizar } = require('./importar-hoja');

const MARCA_EJEMPLO = 'EJEMPLO';
const FILAS_CAPTURA = 200;

const COLORES = {
  encabezado: 'FF262223', textoEncabezado: 'FFFFFFFF', captura: 'FFFFF8D6',
  ejemplo: 'FFF1EDEC', textoEjemplo: 'FF7D7473', marca: 'FFD2392D', borde: 'FFE3DCDA',
};

const VACANTES = [
  ['Fila', 8, 'Escribe EJEMPLO para que la fila no se importe'],
  ['Cliente', 18, 'Obligatorio'],
  ['Localidades', 20, 'Ciudad o estación. Obligatorio'],
  ['Tipo de Vehículo', 16, 'Obligatorio'],
  ['Asignado', 14, 'Reclutador; "Todos" = todo el equipo'],
  ['Esquema', 12, 'Temporada, SDD o Spot'],
  ['Objetivo', 10, 'Unidades requeridas. Obligatorio para vacantes nuevas'],
  ['Tentativo de Cierre', 12, 'Unidades que se espera cerrar'],
  ['Cerrados', 10, 'Déjalo vacío si capturas los proveedores: el tablero los suma al pasar a Operando'],
  ['% Efectividad', 12, 'Se calcula solo (Cerrados / Objetivo)'],
  ['Tarifa Min', 12, 'En pesos'],
  ['Tarifa Max', 12, 'En pesos'],
  ['Inicio Vigencia', 13, 'Fecha, o "Inmediato"'],
  ['Término Vigencia', 13, 'Fecha'],
  ['Días de Operación', 11, 'Número'],
  ['Dirección Origen', 34, ''],
  ['Km Diario Local por Unidad', 14, ''],
  ['Tipo de Ruta', 12, ''],
  ['Horario Laboral (Hrs)', 12, ''],
  ['Comentarios', 30, ''],
  ['Seguimiento Proveedor', 30, 'Texto libre; para el seguimiento por etapa usa la hoja Proveedores'],
  ['Solicitud de creación de usuario', 14, 'Pendiente o Completado'],
  ['Usuario activo', 12, 'Pendiente o Completado'],
  ['Capacitación LP', 12, 'Pendiente o Completado'],
  ['Capacitación conciliación', 14, 'Pendiente o Completado'],
];

const PROVEEDORES = [
  ['Fila', 8, 'Escribe EJEMPLO para que la fila no se importe'],
  ['Reclutador', 14, 'Quién da el seguimiento'],
  ['Cliente', 18, 'Igual que en la hoja Vacantes'],
  ['Ciudad', 20, 'Igual que en la hoja Vacantes'],
  ['Tipo de vehículo', 16, 'Ayuda a elegir la vacante si el cliente tiene varias en la ciudad'],
  ['Proveedor', 28, 'Nombre del proveedor u operador. Obligatorio'],
  ['Unidades', 10, 'Número de unidades'],
  ['Etapa', 22, ESTADOS.join(' → ')],
  ['Fecha de la etapa', 14, 'Cuándo entró a esta etapa; sirve para medir el tiempo. Vacío = hoy'],
  ['Fecha de disponibilidad', 14, 'Cuándo puede iniciar'],
  ['Notas', 34, ''],
];

const ONBOARDING = [
  ['Fila', 8, 'Escribe EJEMPLO para que la fila no se importe'],
  ['Proveedor', 28, 'Debe estar en Operando en la hoja Proveedores o en el tablero'],
  ['Cliente', 18, ''],
  ['Ciudad', 20, ''],
  ['Fecha de ingreso', 14, 'Inicio de la semana 1'],
  ['Semana 1 · Rendimiento (%)', 14, '0 a 100'],
  ['Semana 1 · Evaluación (1-5)', 14, '1 a 5'],
  ['Semana 1 · Comentario', 30, ''],
  ['Semana 2 · Rendimiento (%)', 14, '0 a 100'],
  ['Semana 2 · Evaluación (1-5)', 14, '1 a 5'],
  ['Semana 2 · Comentario', 30, ''],
];

const fuente = (extra = {}) => ({ name: 'Arial', size: 10, ...extra });
const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const bordeFino = { style: 'thin', color: { argb: COLORES.borde } };
const bordes = { top: bordeFino, left: bordeFino, bottom: bordeFino, right: bordeFino };
const letra = n => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const fechaExcel = iso => { const [a, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); };

// Hoja de captura: encabezado oscuro, fila de ejemplo gris y celdas amarillas para llenar
function hojaCaptura(libro, nombre, columnas, ejemplos, { formatos = {}, listas = {}, formulas = {} } = {}) {
  const ws = libro.addWorksheet(nombre, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  ws.columns = columnas.map(([titulo, ancho]) => ({ header: titulo, width: ancho }));
  const cab = ws.getRow(1);
  cab.height = 32;
  cab.eachCell((c, n) => {
    c.font = fuente({ bold: true, color: { argb: COLORES.textoEncabezado } });
    c.fill = relleno(n === 1 ? COLORES.marca : COLORES.encabezado);
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = bordes;
    const ayuda = columnas[n - 1][2];
    if (ayuda) c.note = ayuda;
  });

  const filaFinal = 1 + ejemplos.length + FILAS_CAPTURA;
  for (let f = 2; f <= filaFinal; f++) {
    const esEjemplo = f <= 1 + ejemplos.length;
    const valores = esEjemplo ? ejemplos[f - 2] : [];
    const fila = ws.getRow(f);
    columnas.forEach(([titulo], i) => {
      const c = fila.getCell(i + 1);
      if (formulas[titulo]) {
        c.value = { formula: formulas[titulo](f), result: esEjemplo ? valores[i] : undefined };
      } else if (valores[i] != null) {
        c.value = valores[i];
      }
      c.font = fuente(esEjemplo ? { italic: true, color: { argb: COLORES.textoEjemplo } } : {});
      c.fill = relleno(esEjemplo || formulas[titulo] ? COLORES.ejemplo : COLORES.captura);
      c.border = bordes;
      c.alignment = { vertical: 'top', wrapText: true };
      if (formatos[titulo]) c.numFmt = formatos[titulo];
    });
  }

  for (const [titulo, rango] of Object.entries(listas)) {
    const col = letra(columnas.findIndex(([t]) => t === titulo));
    ws.dataValidations.add(`${col}2:${col}${filaFinal}`, {
      type: 'list', allowBlank: true, formulae: [rango], showErrorMessage: false,
    });
  }
  ws.autoFilter = { from: 'A1', to: `${letra(columnas.length - 1)}1` };
  return ws;
}

async function crearPlantilla(db) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'CRM Redex · BDB Logística';
  libro.created = new Date();

  const nombres = tabla => db.prepare(`SELECT nombre FROM ${tabla} ORDER BY nombre`).all().map(r => r.nombre);
  const catalogo = {
    Etapas: ESTADOS,
    Reclutadores: [...nombres('reclutadores'), 'Todos'],
    Clientes: nombres('clientes'),
    Ciudades: nombres('localidades'),
    'Tipos de vehículo': nombres('tipos_vehiculo'),
    Esquemas: ['Temporada', 'SDD', 'Spot'],
    Avance: ['Pendiente', 'Completado'],
  };

  // --- Instrucciones ---
  const ins = libro.addWorksheet('Instrucciones', { views: [{ showGridLines: false }] });
  ins.columns = [{ width: 4 }, { width: 30 }, { width: 90 }];
  const lineas = [
    ['titulo', 'Plantilla de captura · CRM Redex'],
    ['sub', 'Llena esta plantilla y súbela en el tablero (Tablero → «Importar Excel») para que todo se refleje.'],
    [],
    ['seccion', 'Cómo llenarla'],
    ['paso', '1. Vacantes', 'Una fila por vacante: cliente, ciudad, tipo de vehículo, reclutador asignado y objetivo. Las mismas columnas de la hoja de capacidad.'],
    ['paso', '2. Proveedores', 'Una fila por proveedor con su etapa de contratación. Cuando cambie de etapa, cambia la Etapa y la Fecha de la etapa y vuelve a importar.'],
    ['paso', '3. Onboarding', 'Solo para proveedores en Operando: rendimiento y evaluación de sus dos primeras semanas.'],
    ['paso', '4. Importar', 'En el tablero, Tablero → «Importar Excel» y elige este archivo. Verás un resumen de lo que se creó y actualizó.'],
    [],
    ['seccion', 'Reglas'],
    ['regla', 'Celdas amarillas', 'Son las que se llenan. Las grises son ejemplos o se calculan solas.'],
    ['regla', 'Filas de ejemplo', 'Las filas con EJEMPLO en la columna «Fila» no se importan. Úsalas como guía o bórralas.'],
    ['regla', 'Nada se borra', 'Importar crea lo nuevo y actualiza lo existente; las celdas vacías no borran datos del tablero.'],
    ['regla', 'Cómo se encuentran', 'Vacante = Cliente + Ciudad + Tipo de vehículo (+ Asignado). Proveedor = mismo nombre en la misma vacante.'],
    ['regla', 'Sin vacante', 'Si un proveedor no coincide con ninguna vacante, queda en «Prospectos sin vacante» para asignarlo después.'],
    ['regla', 'Cerrados', 'Si capturas proveedores, deja «Cerrados» vacío: al pasar a Operando, el tablero suma sus unidades solo.'],
    ['regla', 'Vacante cubierta', 'Cuando Cerrados llega al Objetivo, la vacante sale del Tablero y pasa a Onboarding.'],
    ['regla', 'Fechas', 'Usa formato de fecha de Excel o dd/mm/aaaa. En Inicio Vigencia también vale «Inmediato».'],
    [],
    ['seccion', 'Etapas de contratación'],
    ...ESTADOS.map((e, i) => ['regla', `${i + 1}. ${e}`, [
      'Primer contacto con el proveedor.',
      'Se están recibiendo sus documentos.',
      'Contrato enviado o en firma.',
      'Ya opera: suma a Cerrados y entra a Onboarding.',
    ][i]]),
  ];
  lineas.forEach(([tipo, a, b], i) => {
    const fila = ins.getRow(i + 1);
    if (tipo === 'titulo') { fila.getCell(2).value = a; fila.getCell(2).font = fuente({ size: 16, bold: true, color: { argb: COLORES.marca } }); fila.height = 26; }
    if (tipo === 'sub') { fila.getCell(2).value = a; fila.getCell(2).font = fuente({ color: { argb: COLORES.textoEjemplo } }); }
    if (tipo === 'seccion') {
      fila.getCell(2).value = a;
      fila.getCell(2).font = fuente({ bold: true, size: 11, color: { argb: COLORES.textoEncabezado } });
      [2, 3].forEach(n => { fila.getCell(n).fill = relleno(COLORES.encabezado); });
    }
    if (tipo === 'paso' || tipo === 'regla') {
      fila.getCell(2).value = a;
      fila.getCell(2).font = fuente({ bold: true });
      fila.getCell(3).value = b;
      fila.getCell(3).font = fuente();
      fila.getCell(3).alignment = { wrapText: true, vertical: 'top' };
      fila.getCell(2).alignment = { vertical: 'top' };
    }
  });
  const leyenda = ins.getRow(lineas.length + 2);
  leyenda.getCell(2).value = 'Celda para llenar';
  leyenda.getCell(2).fill = relleno(COLORES.captura);
  leyenda.getCell(3).value = 'Ejemplo o cálculo automático';
  leyenda.getCell(3).fill = relleno(COLORES.ejemplo);
  [2, 3].forEach(n => { leyenda.getCell(n).font = fuente(); leyenda.getCell(n).border = bordes; });

  // Rangos de la hoja Listas (se escribe al final) para los menús desplegables
  const rangos = Object.fromEntries(Object.entries(catalogo).map(([titulo, valores], i) =>
    [titulo, `Listas!$${letra(i)}$2:$${letra(i)}$${Math.max(2, valores.length + 1)}`]));

  const inicio = dia(-2), termino = dia(28), ayer = dia(-1);
  hojaCaptura(libro, 'Vacantes', VACANTES, [
    [MARCA_EJEMPLO, 'Walmart', 'Monterrey', 'LARGE VAN', catalogo.Reclutadores[0], 'Temporada', 5, 2, 1, 0.2, 3000, 3200,
      fechaExcel(inicio), fechaExcel(termino), 23, 'Av. Ejemplo 123, Parque Industrial, Escobedo, N.L.', '150 km', 'Local', '12',
      'Faltan 4 unidades', 'Proveedor Ejemplo (en documentos)', 'Pendiente', 'Pendiente', 'Pendiente', 'Pendiente'],
  ], {
    formatos: { 'Tarifa Min': '"$"#,##0.00', 'Tarifa Max': '"$"#,##0.00', 'Inicio Vigencia': 'dd/mm/yyyy', 'Término Vigencia': 'dd/mm/yyyy', '% Efectividad': '0%' },
    listas: {
      Cliente: rangos.Clientes, Localidades: rangos.Ciudades, 'Tipo de Vehículo': rangos['Tipos de vehículo'],
      Asignado: rangos.Reclutadores, Esquema: rangos.Esquemas,
      'Solicitud de creación de usuario': rangos.Avance, 'Usuario activo': rangos.Avance,
      'Capacitación LP': rangos.Avance, 'Capacitación conciliación': rangos.Avance,
    },
    formulas: { '% Efectividad': f => `IF(N(G${f})=0,"",N(I${f})/G${f})` },
  });

  const rec = catalogo.Reclutadores[0];
  hojaCaptura(libro, 'Proveedores', PROVEEDORES, [
    [MARCA_EJEMPLO, rec, 'Walmart', 'Monterrey', 'LARGE VAN', 'Transportes Ejemplo SA de CV', 2, 'Contactado', fechaExcel(ayer), fechaExcel(dia(5)), 'Primera llamada; envía cotización'],
    [MARCA_EJEMPLO, rec, 'Walmart', 'Monterrey', 'LARGE VAN', 'Fletes Muestra', 1, 'Seguimiento documentos', fechaExcel(ayer), fechaExcel(dia(3)), 'Falta póliza de seguro'],
    [MARCA_EJEMPLO, rec, 'Walmart', 'Monterrey', 'LARGE VAN', 'Logística Demo', 1, 'Operando', fechaExcel(ayer), fechaExcel(ayer), 'Inició ruta'],
  ], {
    formatos: { 'Fecha de la etapa': 'dd/mm/yyyy', 'Fecha de disponibilidad': 'dd/mm/yyyy' },
    listas: { Reclutador: rangos.Reclutadores, Cliente: rangos.Clientes, Ciudad: rangos.Ciudades, 'Tipo de vehículo': rangos['Tipos de vehículo'], Etapa: rangos.Etapas },
  });

  hojaCaptura(libro, 'Onboarding', ONBOARDING, [
    [MARCA_EJEMPLO, 'Logística Demo', 'Walmart', 'Monterrey', fechaExcel(ayer), 92, 4, 'Buen arranque; un retraso menor', null, null, ''],
  ], {
    formatos: { 'Fecha de ingreso': 'dd/mm/yyyy' },
    listas: { Cliente: rangos.Clientes, Ciudad: rangos.Ciudades },
  });

  // Las listas van al final para no estorbar
  const listas = libro.addWorksheet('Listas');
  Object.entries(catalogo).forEach(([titulo, valores], i) => {
    listas.getColumn(i + 1).width = 22;
    const cab = listas.getCell(1, i + 1);
    cab.value = titulo;
    cab.font = fuente({ bold: true });
    valores.forEach((v, j) => { const c = listas.getCell(j + 2, i + 1); c.value = v; c.font = fuente(); });
  });

  return libro.xlsx.writeBuffer();
}

// --- Importación ---

const normal = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function valorCelda(c) {
  const v = c.value;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return v.result ?? null;
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text) return v.text;
    return null;
  }
  return v;
}

// Fechas de Excel (llegan como Date en UTC), texto dd/mm/aaaa o AAAA-MM-DD
function fechaCelda(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return fecha(s);
}

function leerHoja(libro, nombre) {
  const ws = libro.worksheets.find(w => normal(w.name) === normal(nombre));
  if (!ws) return null;
  const encabezados = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, n) => { encabezados[n] = normal(valorCelda(c)); });
  const filas = [];
  ws.eachRow((fila, n) => {
    if (n === 1) return;
    const datos = { _fila: n };
    encabezados.forEach((h, i) => { if (h) datos[h] = valorCelda(fila.getCell(i)); });
    if (normal(datos.fila) === normal(MARCA_EJEMPLO)) return;
    if (Object.entries(datos).every(([k, v]) => k === '_fila' || k === 'fila' || v == null || String(v).trim() === '')) return;
    filas.push(datos);
  });
  return filas;
}

// Toma la primera columna cuyo encabezado empieza con alguno de los nombres dados
const campo = (fila, ...nombres) => {
  for (const n of nombres) {
    const clave = Object.keys(fila).find(k => k.startsWith(normal(n)));
    if (clave && fila[clave] != null && String(fila[clave]).trim() !== '') return fila[clave];
  }
  return null;
};

// Identidad de una fila (qué registro es) y su huella (qué contiene), para la sincronización
function claveFila(hoja, f) {
  const partes = {
    vacantes: [campo(f, 'cliente'), campo(f, 'localidad', 'ciudad'), campo(f, 'tipo de vehiculo'), campo(f, 'asignado', 'reclutador')],
    proveedores: [campo(f, 'cliente'), campo(f, 'ciudad', 'localidad'), campo(f, 'proveedor')],
    onboarding: [campo(f, 'proveedor'), campo(f, 'cliente'), campo(f, 'ciudad')],
  }[hoja];
  return partes.map(normal).join('|');
}
function huellaFila(f) {
  const datos = Object.entries(f).filter(([k]) => k !== '_fila')
    .map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]);
  return crypto.createHash('sha1').update(JSON.stringify(datos)).digest('hex');
}

async function importarExcel(db, buffer, { usuario, registrar, cambiarTramo, asegurarOnboarding, ajustarCerrados, origen = 'Excel', soloCambios = false }) {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(buffer);
  } catch {
    throw Object.assign(new Error('El archivo no es un Excel válido (.xlsx).'), { status: 400 });
  }
  const hojas = { vacantes: leerHoja(libro, 'Vacantes'), proveedores: leerHoja(libro, 'Proveedores'), onboarding: leerHoja(libro, 'Onboarding') };
  if (!hojas.vacantes && !hojas.proveedores && !hojas.onboarding) {
    throw Object.assign(new Error('No encontré las hojas Vacantes, Proveedores u Onboarding. Usa la plantilla del tablero.'), { status: 400 });
  }

  // En la sincronización solo se aplican las filas que cambiaron en la hoja desde la vez anterior,
  // así no se pisan los cambios hechos directamente en el tablero
  const huellasNuevas = [];
  if (soloCambios) {
    const guardada = db.prepare('SELECT huella FROM sincronizacion_filas WHERE hoja = ? AND clave = ?');
    for (const [hoja, filas] of Object.entries(hojas)) {
      if (!filas) continue;
      hojas[hoja] = filas.filter(f => {
        const clave = claveFila(hoja, f), huella = huellaFila(f);
        if (guardada.get(hoja, clave)?.huella === huella) return false;
        huellasNuevas.push([hoja, clave, huella]);
        return true;
      });
    }
  }

  const resumen = {
    vacantes: { creadas: 0, actualizadas: 0 },
    proveedores: { creados: 0, actualizados: 0, cambiosEtapa: 0, sinVacante: 0 },
    onboarding: { actualizados: 0 },
    avisos: [],
  };
  const aviso = (hoja, fila, texto) => resumen.avisos.push(`${hoja}, fila ${fila}: ${texto}`);
  const ahora = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');

  // Catálogos: se buscan sin importar mayúsculas ni acentos y se crean si no existen
  const cache = {};
  const idCatalogo = (tabla, nombre) => {
    if (!nombre) return null;
    cache[tabla] ??= new Map(db.prepare(`SELECT id, nombre FROM ${tabla}`).all().map(r => [normal(r.nombre), r.id]));
    const clave = normal(nombre);
    if (!cache[tabla].has(clave)) {
      cache[tabla].set(clave, Number(db.prepare(`INSERT INTO ${tabla} (nombre) VALUES (?)`).run(String(nombre).trim()).lastInsertRowid));
    }
    return cache[tabla].get(clave);
  };
  const buscarCatalogo = (tabla, nombre) => {
    if (!nombre) return null;
    cache[tabla] ??= new Map(db.prepare(`SELECT id, nombre FROM ${tabla}`).all().map(r => [normal(r.nombre), r.id]));
    return cache[tabla].get(normal(nombre)) ?? null;
  };
  const idReclutador = nombre => {
    const s = limpio(nombre);
    if (!s || normal(s) === 'todos') return null;
    return idCatalogo('reclutadores', capitalizar(s));
  };

  db.exec('BEGIN');
  try {
    // --- Vacantes ---
    for (const f of hojas.vacantes ?? []) {
      const cliente = limpio(campo(f, 'cliente')), ciudad = limpio(campo(f, 'localidad', 'ciudad'));
      const tipoTexto = limpio(campo(f, 'tipo de vehiculo'));
      if (!cliente || !ciudad || !tipoTexto) { aviso('Vacantes', f._fila, 'faltan Cliente, Localidades o Tipo de Vehículo; no se importó'); continue; }
      const cliente_id = idCatalogo('clientes', cliente);
      const localidad_id = idCatalogo('localidades', ciudad);
      const tipo_vehiculo_id = idCatalogo('tipos_vehiculo', tipoVehiculo(tipoTexto));
      const asignado = campo(f, 'asignado', 'reclutador');
      const reclutador_id = asignado == null ? undefined : idReclutador(asignado);

      const candidatas = db.prepare('SELECT * FROM vacantes WHERE cliente_id = ? AND localidad_id = ? AND tipo_vehiculo_id = ?').all(cliente_id, localidad_id, tipo_vehiculo_id);
      const existente = candidatas.find(v => reclutador_id === undefined || (v.reclutador_id ?? null) === reclutador_id) ?? (candidatas.length === 1 ? candidatas[0] : null);

      const inicio = campo(f, 'inicio vigencia');
      const datos = {
        reclutador_id,
        esquema: limpio(campo(f, 'esquema')),
        cantidad: campo(f, 'objetivo') != null ? Math.max(1, entero(campo(f, 'objetivo'))) : null,
        tentativo: campo(f, 'tentativo') != null ? entero(campo(f, 'tentativo')) : null,
        cerrados: campo(f, 'cerrados') != null ? entero(campo(f, 'cerrados')) : null,
        tarifa_min: dinero(campo(f, 'tarifa min')),
        tarifa_max: dinero(campo(f, 'tarifa max')),
        direccion_origen: limpio(campo(f, 'direccion origen')),
        km_diario: limpio(campo(f, 'km diario')),
        tipo_ruta: limpio(campo(f, 'tipo de ruta')),
        horario: limpio(campo(f, 'horario')),
        dias_operacion: entero(campo(f, 'dias de operacion')) || null,
        fecha_arranque: inicio == null ? null : fechaCelda(inicio),
        inicio_inmediato: inicio != null && /inmediato/i.test(String(inicio)) ? 1 : null,
        fecha_termino: fechaCelda(campo(f, 'termino vigencia')),
        notas: limpio(campo(f, 'comentarios')),
        seguimiento: limpio(campo(f, 'seguimiento')),
        solicitud_usuario: avance(campo(f, 'solicitud')),
        usuario_activo: avance(campo(f, 'usuario activo')),
        capacitacion_lp: avance(campo(f, 'capacitacion lp')),
        capacitacion_conciliacion: avance(campo(f, 'capacitacion conciliacion')),
      };
      // Las celdas vacías no pisan lo que ya hay en el tablero
      const conValor = Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== null && v !== undefined));

      if (existente) {
        const columnas = Object.keys(conValor);
        if (columnas.length) {
          db.prepare(`UPDATE vacantes SET ${columnas.map(c => `${c} = :${c}`)} WHERE id = :id`).run({ ...conValor, id: existente.id });
        }
        resumen.vacantes.actualizadas += 1;
      } else {
        if (!datos.cantidad) { aviso('Vacantes', f._fila, `${cliente} · ${ciudad}: falta el Objetivo para crear la vacante`); continue; }
        const fila = { cliente_id, localidad_id, tipo_vehiculo_id, tentativo: 0, cerrados: 0, inicio_inmediato: 0, ...conValor, reclutador_id: reclutador_id ?? null };
        const cols = Object.keys(fila);
        const r = db.prepare(`INSERT INTO vacantes (${cols}) VALUES (${cols.map(c => ':' + c)})`).run(fila);
        registrar({ usuario: { nombre: usuario } }, 'vacante_creada', { vacante_id: Number(r.lastInsertRowid), reclutador_id: fila.reclutador_id },
          `${origen}: nueva vacante ${cliente} · ${ciudad} · ${tipoTexto} (${fila.cantidad} u.)`);
        resumen.vacantes.creadas += 1;
      }
    }

    // --- Proveedores ---
    const vacantesDe = db.prepare(`
      SELECT v.id, v.reclutador_id, t.nombre AS tipo FROM vacantes v
      JOIN tipos_vehiculo t ON t.id = v.tipo_vehiculo_id
      WHERE v.cliente_id = ? AND v.localidad_id = ?`);
    for (const f of hojas.proveedores ?? []) {
      const proveedor = limpio(campo(f, 'proveedor'));
      if (!proveedor) { aviso('Proveedores', f._fila, 'falta el nombre del proveedor'); continue; }
      const etapaTexto = limpio(campo(f, 'etapa'));
      const etapa = ESTADOS.find(e => normal(e) === normal(etapaTexto ?? 'Contactado'));
      if (!etapa) { aviso('Proveedores', f._fila, `${proveedor}: etapa "${etapaTexto}" no válida (usa ${ESTADOS.join(', ')})`); continue; }
      const unidades = Math.max(1, entero(campo(f, 'unidades')) || 1);
      const cliente = limpio(campo(f, 'cliente')), ciudad = limpio(campo(f, 'ciudad', 'localidad'));
      const tipo = limpio(campo(f, 'tipo de vehiculo'));
      const recTexto = campo(f, 'reclutador');
      const fechaEtapa = fechaCelda(campo(f, 'fecha de la etapa'));
      const momento = fechaEtapa ? `${fechaEtapa} 12:00:00` : ahora();
      const disponibilidad = fechaCelda(campo(f, 'fecha de disponibilidad')) ?? fechaEtapa ?? dia();
      const notas = limpio(campo(f, 'notas'));

      // Vacante: mismo cliente y ciudad; el tipo de vehículo y el reclutador desempatan
      const cliId = buscarCatalogo('clientes', cliente), locId = buscarCatalogo('localidades', ciudad);
      let candidatas = cliId && locId ? vacantesDe.all(cliId, locId) : [];
      if (tipo && candidatas.length > 1) {
        const mismoTipo = candidatas.filter(v => normal(v.tipo) === normal(tipoVehiculo(tipo)));
        if (mismoTipo.length) candidatas = mismoTipo;
      }
      const recId = recTexto != null ? idReclutador(recTexto) : null;
      const vacante = candidatas.find(v => recId && v.reclutador_id === recId) ?? candidatas[0];

      if (!vacante) {
        const yaHay = db.prepare('SELECT id FROM prospectos WHERE lower(proveedor) = lower(?)').get(proveedor);
        if (!yaHay) {
          db.prepare('INSERT INTO prospectos (proveedor, unidades, referencia, tipo_vehiculo, reclutador_id, notas) VALUES (?, ?, ?, ?, ?, ?)')
            .run(proveedor, unidades, [cliente, ciudad].filter(Boolean).join(' · ') || null, tipo, recId, notas);
        }
        resumen.proveedores.sinVacante += 1;
        aviso('Proveedores', f._fila, `${proveedor}: no hay vacante de ${cliente ?? '?'} en ${ciudad ?? '?'}; quedó en «Prospectos sin vacante»`);
        continue;
      }
      if (candidatas.length > 1 && !candidatas.some(v => recId && v.reclutador_id === recId)) {
        aviso('Proveedores', f._fila, `${proveedor}: hay varias vacantes de ${cliente} en ${ciudad}; se usó la primera`);
      }
      const reclutadorId = recId ?? vacante.reclutador_id;
      if (!reclutadorId) { aviso('Proveedores', f._fila, `${proveedor}: indica el Reclutador`); continue; }

      const antes = db.prepare('SELECT * FROM asignaciones WHERE vacante_id = ? AND lower(proveedor) = lower(?)').get(vacante.id, proveedor);
      const quien = { usuario: { nombre: usuario } };
      if (!antes) {
        const r = db.prepare(`
          INSERT INTO asignaciones (vacante_id, reclutador_id, proveedor, unidades, fecha_disponibilidad, estado, notas, creado_en, fecha_operativo, actualizado_en)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(vacante.id, reclutadorId, proveedor, unidades, disponibilidad, etapa, notas, momento.slice(0, 10),
            etapa === 'Operando' ? momento.slice(0, 10) : null, momento);
        const id = Number(r.lastInsertRowid);
        cambiarTramo(id, etapa, momento);
        asegurarOnboarding(id, { estado: etapa, fecha_disponibilidad: disponibilidad });
        ajustarCerrados(vacante.id, etapa === 'Operando' ? unidades : 0);
        registrar(quien, 'asignacion_creada', { vacante_id: vacante.id, asignacion_id: id, reclutador_id: reclutadorId, nuevo: etapa },
          `${origen}: nuevo proveedor ${proveedor} (${unidades} u.) en ${etapa}`);
        resumen.proveedores.creados += 1;
      } else {
        const aporteAntes = antes.estado === 'Operando' ? antes.unidades : 0;
        const cambiaEtapa = antes.estado !== etapa;
        const fechaOperativo = etapa !== 'Operando' ? null : cambiaEtapa ? momento.slice(0, 10) : antes.fecha_operativo ?? momento.slice(0, 10);
        db.prepare(`
          UPDATE asignaciones SET reclutador_id = ?, unidades = ?, estado = ?, notas = COALESCE(?, notas),
            fecha_disponibilidad = ?, fecha_operativo = ?, actualizado_en = ? WHERE id = ?`)
          .run(reclutadorId, unidades, etapa, notas, disponibilidad, fechaOperativo, momento, antes.id);
        if (cambiaEtapa) {
          cambiarTramo(antes.id, etapa, momento);
          registrar(quien, 'cambio_estado', { vacante_id: vacante.id, asignacion_id: antes.id, reclutador_id: reclutadorId, ant: antes.estado, nuevo: etapa },
            `${origen}: ${proveedor} pasó de ${antes.estado} a ${etapa}`);
          resumen.proveedores.cambiosEtapa += 1;
        }
        asegurarOnboarding(antes.id, { estado: etapa, fecha_disponibilidad: disponibilidad });
        ajustarCerrados(vacante.id, (etapa === 'Operando' ? unidades : 0) - aporteAntes);
        resumen.proveedores.actualizados += 1;
      }
    }

    // --- Onboarding ---
    for (const f of hojas.onboarding ?? []) {
      const proveedor = limpio(campo(f, 'proveedor'));
      if (!proveedor) continue;
      const cliente = limpio(campo(f, 'cliente')), ciudad = limpio(campo(f, 'ciudad'));
      const encontrados = db.prepare(`
        SELECT o.* FROM onboarding o JOIN asignaciones a ON a.id = o.asignacion_id JOIN vacantes v ON v.id = a.vacante_id
        JOIN clientes c ON c.id = v.cliente_id JOIN localidades l ON l.id = v.localidad_id
        WHERE lower(a.proveedor) = lower(?) AND a.estado = 'Operando'`).all(proveedor)
        .filter(o => {
          const v = db.prepare('SELECT c.nombre cli, l.nombre loc FROM asignaciones a JOIN vacantes v ON v.id = a.vacante_id JOIN clientes c ON c.id = v.cliente_id JOIN localidades l ON l.id = v.localidad_id WHERE a.id = ?').get(o.asignacion_id);
          return (!cliente || normal(v.cli) === normal(cliente)) && (!ciudad || normal(v.loc) === normal(ciudad));
        });
      if (!encontrados.length) { aviso('Onboarding', f._fila, `${proveedor}: no está en Operando en el tablero`); continue; }
      const o = encontrados[0];
      const porcentaje = v => {
        if (v == null) return null;
        let n = Number(String(v).replace('%', ''));
        if (!Number.isFinite(n)) return null;
        if (n > 0 && n <= 1 && !Number.isInteger(n)) n *= 100;
        return Math.min(100, Math.max(0, Math.round(n)));
      };
      const calificacion = v => {
        const n = Math.round(Number(v));
        return v != null && n >= 1 && n <= 5 ? n : null;
      };
      const cambios = {
        fecha_ingreso: fechaCelda(campo(f, 'fecha de ingreso')),
        s1_rendimiento: porcentaje(campo(f, 'semana 1 · rendimiento', 'semana 1 rendimiento')),
        s1_calificacion: calificacion(campo(f, 'semana 1 · evaluacion', 'semana 1 evaluacion')),
        s1_comentario: limpio(campo(f, 'semana 1 · comentario', 'semana 1 comentario')),
        s2_rendimiento: porcentaje(campo(f, 'semana 2 · rendimiento', 'semana 2 rendimiento')),
        s2_calificacion: calificacion(campo(f, 'semana 2 · evaluacion', 'semana 2 evaluacion')),
        s2_comentario: limpio(campo(f, 'semana 2 · comentario', 'semana 2 comentario')),
      };
      const conValor = Object.fromEntries(Object.entries(cambios).filter(([, v]) => v != null));
      if (!Object.keys(conValor).length) continue;
      db.prepare(`UPDATE onboarding SET ${Object.keys(conValor).map(c => `${c} = :${c}`)} WHERE asignacion_id = :id`).run({ ...conValor, id: o.asignacion_id });
      resumen.onboarding.actualizados += 1;
    }

    const total = resumen.vacantes.creadas + resumen.vacantes.actualizadas + resumen.proveedores.creados + resumen.proveedores.actualizados + resumen.onboarding.actualizados;
    resumen.total = total;
    if (total) {
      registrar({ usuario: { nombre: usuario } }, 'importacion', {},
        `Importación desde ${origen}: ${total} registros (${resumen.proveedores.creados} proveedores nuevos, ${resumen.proveedores.cambiosEtapa} cambios de etapa)`);
    }
    const guardar = db.prepare('INSERT OR REPLACE INTO sincronizacion_filas (hoja, clave, huella) VALUES (?, ?, ?)');
    for (const h of huellasNuevas) guardar.run(...h);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return resumen;
}

module.exports = { crearPlantilla, importarExcel };
