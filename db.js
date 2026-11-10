'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DIR_DATOS = process.env.DATA_DIR || path.join(__dirname, 'data');
const ARCHIVO_DB = path.join(DIR_DATOS, 'crm.db');

const ESTADOS = ['Contactado', 'Seguimiento documentos', 'Firma de contrato', 'Operando'];

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  contacto TEXT,
  telefono TEXT
);

CREATE TABLE IF NOT EXISTS localidades (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  estado TEXT
);

CREATE TABLE IF NOT EXISTS tipos_vehiculo (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS reclutadores (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  email TEXT
);

CREATE TABLE IF NOT EXISTS vacantes (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  localidad_id INTEGER NOT NULL REFERENCES localidades(id),
  tipo_vehiculo_id INTEGER NOT NULL REFERENCES tipos_vehiculo(id),
  reclutador_id INTEGER REFERENCES reclutadores(id),  -- NULL = todo el equipo
  esquema TEXT,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),      -- objetivo de unidades
  tentativo INTEGER NOT NULL DEFAULT 0,                -- tentativo de cierre
  cerrados INTEGER NOT NULL DEFAULT 0,
  tarifa_min REAL,
  tarifa_max REAL,
  direccion_origen TEXT,
  km_diario TEXT,
  tipo_ruta TEXT,
  horario TEXT,
  dias_operacion INTEGER,
  fecha_arranque TEXT,                                 -- inicio de vigencia
  inicio_inmediato INTEGER NOT NULL DEFAULT 0,
  fecha_termino TEXT,                                  -- término de vigencia
  notas TEXT,                                          -- comentarios
  seguimiento TEXT,                                    -- seguimiento del proveedor
  solicitud_usuario TEXT,
  usuario_activo TEXT,
  capacitacion_lp TEXT,
  capacitacion_conciliacion TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS asignaciones (
  id INTEGER PRIMARY KEY,
  vacante_id INTEGER NOT NULL REFERENCES vacantes(id) ON DELETE CASCADE,
  reclutador_id INTEGER NOT NULL REFERENCES reclutadores(id),
  proveedor TEXT NOT NULL,
  unidades INTEGER NOT NULL CHECK (unidades > 0),
  fecha_disponibilidad TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('Contactado', 'Seguimiento documentos', 'Firma de contrato', 'Operando')),
  notas TEXT,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_en TEXT,       -- fecha local en que se registró el proveedor
  fecha_operativo TEXT  -- fecha local en que pasó a Operando (días de cierre)
);

-- Tramos por etapa de contratación para medir cuánto tarda cada una.
-- El tramo abierto (hasta NULL) es la etapa actual del proveedor.
CREATE TABLE IF NOT EXISTS etapas_asignacion (
  id INTEGER PRIMARY KEY,
  asignacion_id INTEGER NOT NULL REFERENCES asignaciones(id) ON DELETE CASCADE,
  etapa TEXT NOT NULL,
  desde TEXT NOT NULL,
  hasta TEXT
);
CREATE INDEX IF NOT EXISTS etapas_asignacion_id ON etapas_asignacion (asignacion_id);

-- Proveedores reportados para una vacante que aún no existe en el tablero;
-- al asignarlos a una vacante pasan a las etapas de contratación
CREATE TABLE IF NOT EXISTS prospectos (
  id INTEGER PRIMARY KEY,
  proveedor TEXT NOT NULL,
  unidades INTEGER NOT NULL DEFAULT 1 CHECK (unidades > 0),
  referencia TEXT,          -- cliente o ciudad tal como se reportó (ej. SMT2)
  tipo_vehiculo TEXT,
  reclutador_id INTEGER REFERENCES reclutadores(id),
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Bitácora de movimientos para el resumen diario. Sin llaves foráneas:
-- conserva el registro aunque se borre la vacante o el proveedor.
CREATE TABLE IF NOT EXISTS historial (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  usuario TEXT,
  tipo TEXT NOT NULL,
  vacante_id INTEGER,
  asignacion_id INTEGER,
  reclutador_id INTEGER,
  descripcion TEXT NOT NULL,
  estado_anterior TEXT,
  estado_nuevo TEXT
);
CREATE INDEX IF NOT EXISTS historial_fecha ON historial (fecha);

-- Seguimiento de las dos primeras semanas tras pasar a Operando
CREATE TABLE IF NOT EXISTS onboarding (
  asignacion_id INTEGER PRIMARY KEY REFERENCES asignaciones(id) ON DELETE CASCADE,
  fecha_ingreso TEXT NOT NULL,
  s1_rendimiento INTEGER CHECK (s1_rendimiento BETWEEN 0 AND 100),
  s1_calificacion INTEGER CHECK (s1_calificacion BETWEEN 1 AND 5),
  s1_comentario TEXT,
  s2_rendimiento INTEGER CHECK (s2_rendimiento BETWEEN 0 AND 100),
  s2_calificacion INTEGER CHECK (s2_calificacion BETWEEN 1 AND 5),
  s2_comentario TEXT
);

-- Accesos internos: los crea un administrador, no hay registro público
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin', 'reclutador')),
  reclutador_id INTEGER REFERENCES reclutadores(id) ON DELETE SET NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_acceso TEXT
);

-- Se guarda el SHA-256 del token, nunca el token de la cookie
CREATE TABLE IF NOT EXISTS sesiones (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira TEXT NOT NULL
);
`;

function abrir() {
  fs.mkdirSync(DIR_DATOS, { recursive: true });
  const db = new DatabaseSync(ARCHIVO_DB);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);
  migrar(db);
  return db;
}

// Columnas agregadas después de la primera versión
function migrar(db) {
  // La versión con columnas de la hoja de Google reemplaza las vacantes demo:
  // se reconstruyen vacantes, proveedores y onboarding (los usuarios se conservan)
  const colVacantes = db.prepare('PRAGMA table_info(vacantes)').all().map(c => c.name);
  if (!colVacantes.includes('reclutador_id')) {
    db.exec(`
      DROP TABLE IF EXISTS onboarding; DROP TABLE IF EXISTS asignaciones; DROP TABLE IF EXISTS vacantes;
      DELETE FROM historial;`);
    db.exec(ESQUEMA);
  }

  const columnas = db.prepare('PRAGMA table_info(asignaciones)').all().map(c => c.name);
  if (!columnas.includes('creado_en')) {
    db.exec('ALTER TABLE asignaciones ADD COLUMN creado_en TEXT');
    db.exec('UPDATE asignaciones SET creado_en = date(actualizado_en)');
  }
  if (!columnas.includes('fecha_operativo')) {
    db.exec('ALTER TABLE asignaciones ADD COLUMN fecha_operativo TEXT');
    db.exec(`UPDATE asignaciones SET fecha_operativo =
      (SELECT fecha_ingreso FROM onboarding WHERE asignacion_id = asignaciones.id) WHERE estado = 'Operando'`);
  }

  // Etapas renombradas: Prospección → Contactado, En documentación → Seguimiento documentos,
  // Cierre de contrato → Firma de contrato, Operativo → Operando. El CHECK obliga a reconstruir la tabla.
  const sqlAsignaciones = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'asignaciones'").get().sql;
  if (sqlAsignaciones.includes('Prospección')) {
    const crear = ESQUEMA.match(/CREATE TABLE IF NOT EXISTS asignaciones \([\s\S]*?\n\);/)[0]
      .replace('CREATE TABLE IF NOT EXISTS asignaciones', 'CREATE TABLE asignaciones_nueva');
    const columnas = 'id, vacante_id, reclutador_id, proveedor, unidades, fecha_disponibilidad, notas, actualizado_en, creado_en, fecha_operativo';
    const mapa = `CASE estado WHEN 'Prospección' THEN 'Contactado' WHEN 'En documentación' THEN 'Seguimiento documentos'
      WHEN 'Cierre de contrato' THEN 'Firma de contrato' WHEN 'Operativo' THEN 'Operando' ELSE estado END`;
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(crear);
      db.exec(`INSERT INTO asignaciones_nueva (${columnas}, estado) SELECT ${columnas}, ${mapa} FROM asignaciones`);
      db.exec('DROP TABLE asignaciones');
      db.exec('ALTER TABLE asignaciones_nueva RENAME TO asignaciones');
      for (const col of ['estado_anterior', 'estado_nuevo']) {
        db.exec(`UPDATE historial SET ${col} = ${mapa.replaceAll('estado', col)}`);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  abrirTramosFaltantes(db);
}

// Proveedores sin medición por etapa (anteriores a ella o cargados en bloque): se abre su tramo actual
function abrirTramosFaltantes(db) {
  db.exec(`
    INSERT INTO etapas_asignacion (asignacion_id, etapa, desde)
    SELECT a.id, a.estado, COALESCE(a.fecha_operativo, a.creado_en, date(a.actualizado_en)) FROM asignaciones a
    WHERE NOT EXISTS (SELECT 1 FROM etapas_asignacion e WHERE e.asignacion_id = a.id)`);
}

function estaVacia(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n === 0;
}

// Fecha local YYYY-MM-DD desplazada `dias` respecto a hoy
function dia(dias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Reemplaza todo el contenido por datos demo. Las fechas son relativas a hoy
// para que el tablero siempre muestre vacantes próximas y onboarding en curso.
function sembrar(db) {
  const insertar = (tabla, fila) => {
    const campos = Object.keys(fila);
    const sql = `INSERT INTO ${tabla} (${campos}) VALUES (${campos.map(c => ':' + c)})`;
    return Number(db.prepare(sql).run(fila).lastInsertRowid);
  };

  db.exec('BEGIN');
  try {
    db.exec(`
      DELETE FROM historial; DELETE FROM onboarding; DELETE FROM asignaciones; DELETE FROM vacantes;
      DELETE FROM reclutadores; DELETE FROM tipos_vehiculo; DELETE FROM localidades; DELETE FROM clientes;
    `);

    const cli = {
      andina: insertar('clientes', { nombre: 'Comercializadora Andina', contacto: 'Laura Gómez', telefono: '55 1234 5678' }),
      norte: insertar('clientes', { nombre: 'Distribuidora del Norte', contacto: 'Héctor Garza', telefono: '81 2345 6789' }),
      retail: insertar('clientes', { nombre: 'Retail Express MX', contacto: 'Mariana Ortiz', telefono: '55 3456 7890' }),
      vida: insertar('clientes', { nombre: 'Farmacéutica Vida Plus', contacto: 'Jorge Ramírez', telefono: '442 456 7890' }),
    };

    const loc = {
      cdmx: insertar('localidades', { nombre: 'Ciudad de México', estado: 'CDMX' }),
      mty: insertar('localidades', { nombre: 'Monterrey', estado: 'Nuevo León' }),
      gdl: insertar('localidades', { nombre: 'Guadalajara', estado: 'Jalisco' }),
      qro: insertar('localidades', { nombre: 'Querétaro', estado: 'Querétaro' }),
      pue: insertar('localidades', { nombre: 'Puebla', estado: 'Puebla' }),
    };

    const tip = {
      van: insertar('tipos_vehiculo', { nombre: 'Van de carga', descripcion: 'Hasta 1.5 t, reparto urbano' }),
      c35: insertar('tipos_vehiculo', { nombre: 'Camioneta 3.5 t', descripcion: 'Caja seca, última milla' }),
      rabon: insertar('tipos_vehiculo', { nombre: 'Rabón', descripcion: 'Hasta 8 t, un eje trasero' }),
      torton: insertar('tipos_vehiculo', { nombre: 'Torton', descripcion: 'Hasta 14 t, doble eje trasero' }),
      tracto: insertar('tipos_vehiculo', { nombre: "Tractocamión 53'", descripcion: 'Caja de 53 pies, carretera' }),
    };

    const rec = Object.fromEntries(['Nayrobis', 'Ismael', 'Mayte', 'Carla', 'Antonio']
      .map(nombre => [nombre.toLowerCase(), insertar('reclutadores', { nombre })]));

    const vacante = (cliente_id, localidad_id, tipo_vehiculo_id, reclutador_id, cantidad, arranque, notas = null) =>
      insertar('vacantes', {
        cliente_id, localidad_id, tipo_vehiculo_id, reclutador_id, cantidad, esquema: 'Temporada',
        fecha_arranque: dia(arranque), fecha_termino: dia(arranque + 60), notas,
      });

    const v = [
      vacante(cli.andina, loc.cdmx, tip.c35, rec.nayrobis, 10, -20, 'Operación de última milla zona sur.'),
      vacante(cli.andina, loc.gdl, tip.rabon, rec.mayte, 6, 10),
      vacante(cli.norte, loc.mty, tip.tracto, rec.ismael, 8, -15, 'Ruta Monterrey – Laredo.'),
      vacante(cli.norte, loc.mty, tip.torton, rec.ismael, 4, 25),
      vacante(cli.retail, loc.cdmx, tip.van, rec.carla, 12, 5, 'Temporada alta: requiere GPS y seguro de carga.'),
      vacante(cli.retail, loc.pue, tip.c35, rec.mayte, 5, 40),
      vacante(cli.vida, loc.qro, tip.van, rec.antonio, 6, -10, 'Unidades refrigeradas deseables.'),
      vacante(cli.vida, loc.gdl, tip.c35, rec.carla, 3, 60),
    ];

    // creado / movido: días respecto a hoy en que se registró y en que tuvo su último cambio
    const asignar = (vacante_id, reclutador_id, proveedor, unidades, disponible, estado, { creado, movido = creado, notas = null } = {}) =>
      insertar('asignaciones', {
        vacante_id, reclutador_id, proveedor, unidades, fecha_disponibilidad: dia(disponible), estado, notas,
        creado_en: dia(creado), actualizado_en: `${dia(movido)} 16:00:00`,
        fecha_operativo: estado === 'Operando' ? dia(disponible) : null,
      });

    const onboarding = (asignacion_id, ingreso, s1 = [], s2 = []) =>
      insertar('onboarding', {
        asignacion_id, fecha_ingreso: dia(ingreso),
        s1_rendimiento: s1[0] ?? null, s1_calificacion: s1[1] ?? null, s1_comentario: s1[2] ?? null,
        s2_rendimiento: s2[0] ?? null, s2_calificacion: s2[1] ?? null, s2_comentario: s2[2] ?? null,
      });

    const a = {};
    a.trv = asignar(v[0], rec.nayrobis, 'Transportes Rápidos del Valle', 4, -16, 'Operando', { creado: -30, movido: -16 });
    onboarding(a.trv, -16,
      [92, 4, 'Buen arranque; dos retrasos menores en la ruta norte.'],
      [97, 5, 'Cumplimiento estable, sin incidencias.']);
    a.martinez = asignar(v[0], rec.ismael, 'Logística Martínez', 3, -9, 'Operando', { creado: -21, movido: -9 });
    onboarding(a.martinez, -9, [85, 3, 'Faltó documentación de una unidad los primeros días.']);
    a.union = asignar(v[0], rec.carla, 'Fletes Unión', 2, 3, 'Firma de contrato', { creado: -12, movido: -1, notas: 'Contrato en revisión legal.' });
    a.jalisco = asignar(v[1], rec.mayte, 'Autotransportes Jalisco', 3, 7, 'Seguimiento documentos', { creado: -18, movido: -11, notas: 'Pendientes pólizas de seguro.' });
    a.occidente = asignar(v[1], rec.antonio, 'TransOccidente', 2, 12, 'Contactado', { creado: -5, movido: -5 });
    a.regio = asignar(v[2], rec.ismael, 'Carga Pesada Regio', 5, -14, 'Operando', { creado: -33, movido: -14 });
    onboarding(a.regio, -14,
      [78, 3, 'Incidencias en tiempos de carga en CEDIS.'],
      [88, 4, 'Mejoró tras el ajuste de horarios.']);
    a.golfo = asignar(v[2], rec.antonio, 'Fletes del Golfo', 2, 2, 'Firma de contrato', { creado: -16, movido: -3 });
    a.cumbres = asignar(v[3], rec.nayrobis, 'Grupo Logístico Cumbres', 4, 20, 'Contactado', { creado: -10, movido: -10, notas: 'Primera llamada agendada.' });
    a.envios = asignar(v[4], rec.mayte, 'Envíos Urbanos CDMX', 6, 2, 'Seguimiento documentos', { creado: -8, movido: -1 });
    a.ultima = asignar(v[4], rec.carla, 'Última Milla Express', 4, 4, 'Firma de contrato', { creado: -14, movido: -2 });
    a.repartos = asignar(v[4], rec.antonio, 'Repartos Metropolitanos', 3, 6, 'Contactado', { creado: -1 });
    a.angelopolis = asignar(v[5], rec.mayte, 'Transportes Angelópolis', 2, 30, 'Contactado', { creado: -4 });
    a.bajio = asignar(v[6], rec.carla, 'Logística Bajío', 4, -3, 'Operando', { creado: -15, movido: -3 });
    onboarding(a.bajio, -3);
    a.queretana = asignar(v[6], rec.nayrobis, 'Mensajería Queretana', 2, -1, 'Operando', { creado: -12, movido: -1 });
    onboarding(a.queretana, -1);

    abrirTramosFaltantes(db);

    // Los cerrados de cada vacante son las unidades de sus proveedores en Operando
    db.exec(`UPDATE vacantes SET cerrados = (SELECT COALESCE(SUM(unidades), 0) FROM asignaciones
      WHERE vacante_id = vacantes.id AND estado = 'Operando')`);

    // Bitácora: movimientos de los últimos días, sobre todo de ayer, para el resumen
    const nombreRec = Object.fromEntries(Object.entries(rec).map(([k, id]) => [id, k[0].toUpperCase() + k.slice(1)]));
    const evento = (dias, hora, tipo, { vacante_id = null, asignacion_id = null, reclutador_id = null, usuario = nombreRec[reclutador_id] ?? 'Administrador', ant = null, nuevo = null }, descripcion) =>
      insertar('historial', {
        fecha: `${dia(dias)} ${hora}:00`, usuario, tipo, vacante_id, asignacion_id, reclutador_id,
        descripcion, estado_anterior: ant, estado_nuevo: nuevo,
      });

    evento(-3, '11:20', 'cambio_estado', { vacante_id: v[2], asignacion_id: a.golfo, reclutador_id: rec.antonio, ant: 'Seguimiento documentos', nuevo: 'Firma de contrato' },
      'Fletes del Golfo pasó de Seguimiento documentos a Firma de contrato');
    evento(-2, '13:05', 'cambio_estado', { vacante_id: v[4], asignacion_id: a.ultima, reclutador_id: rec.carla, ant: 'Seguimiento documentos', nuevo: 'Firma de contrato' },
      'Última Milla Express pasó de Seguimiento documentos a Firma de contrato');
    evento(-1, '09:15', 'asignacion_creada', { vacante_id: v[4], asignacion_id: a.repartos, reclutador_id: rec.antonio, nuevo: 'Contactado' },
      'Nuevo proveedor Repartos Metropolitanos (3 u.) para Retail Express MX · Ciudad de México');
    evento(-1, '10:40', 'cambio_estado', { vacante_id: v[4], asignacion_id: a.envios, reclutador_id: rec.mayte, ant: 'Contactado', nuevo: 'Seguimiento documentos' },
      'Envíos Urbanos CDMX pasó de Contactado a Seguimiento documentos');
    evento(-1, '12:30', 'cambio_estado', { vacante_id: v[0], asignacion_id: a.union, reclutador_id: rec.carla, ant: 'Seguimiento documentos', nuevo: 'Firma de contrato' },
      'Fletes Unión pasó de Seguimiento documentos a Firma de contrato');
    evento(-1, '15:10', 'cambio_estado', { vacante_id: v[6], asignacion_id: a.queretana, reclutador_id: rec.nayrobis, ant: 'Firma de contrato', nuevo: 'Operando' },
      'Mensajería Queretana pasó de Firma de contrato a Operando (2 u.)');
    evento(-1, '17:45', 'evaluacion', { vacante_id: v[0], asignacion_id: a.martinez, reclutador_id: rec.ismael },
      'Evaluación semana 1 de Logística Martínez: 85% de cumplimiento, 3 de 5');
    evento(-1, '18:20', 'vacante_creada', { vacante_id: v[7] },
      'Nueva vacante: Farmacéutica Vida Plus · Guadalajara · Camioneta 3.5 t (3 u.)');

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { abrirTramosFaltantes, abrir, estaVacia, sembrar, dia, ESTADOS, ARCHIVO_DB };
