'use strict';

const path = require('node:path');
const express = require('express');
const { abrir, estaVacia, sembrar, dia, ESTADOS } = require('./db');
const { crearAuth, HttpError } = require('./auth');

const db = abrir();
if (estaVacia(db)) {
  sembrar(db);
  console.log('Base de datos nueva: se cargaron datos demo.');
}

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.body ??= {}; next(); });
app.use(express.static(path.join(__dirname, 'public')));

// --- Acceso: todo /api, salvo /api/auth, requiere sesión ---
const auth = crearAuth(db);
app.use('/api/auth', auth.acceso);
app.use('/api', auth.requerirSesion);
app.use('/api/usuarios', auth.usuarios);

// --- Validación de entrada ---

function texto(valor, etiqueta, obligatorio = false) {
  const s = valor == null ? '' : String(valor).trim();
  if (obligatorio && !s) throw new HttpError(400, `${etiqueta} es obligatorio`);
  return s || null;
}

function entero(valor, etiqueta, { min = 0, max = Infinity, obligatorio = false } = {}) {
  if (valor == null || valor === '') {
    if (obligatorio) throw new HttpError(400, `${etiqueta} es obligatorio`);
    return null;
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) {
    const rango = max === Infinity ? `mayor o igual a ${min}` : `entre ${min} y ${max}`;
    throw new HttpError(400, `${etiqueta} debe ser un número entero ${rango}`);
  }
  return n;
}

function fecha(valor, etiqueta, obligatorio = false) {
  if (!valor) {
    if (obligatorio) throw new HttpError(400, `${etiqueta} es obligatoria`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new HttpError(400, `${etiqueta} no es una fecha válida`);
  return valor;
}

const idParam = req => entero(req.params.id, 'id', { min: 1, obligatorio: true });

// --- Catálogos (CRUD genérico) ---

const CATALOGOS = {
  clientes: { tabla: 'clientes', campos: { nombre: 'Nombre', contacto: 'Contacto', telefono: 'Teléfono' } },
  localidades: { tabla: 'localidades', campos: { nombre: 'Nombre', estado: 'Estado' } },
  'tipos-vehiculo': { tabla: 'tipos_vehiculo', campos: { nombre: 'Nombre', descripcion: 'Descripción' } },
  reclutadores: { tabla: 'reclutadores', campos: { nombre: 'Nombre', email: 'Correo' } },
};

for (const [ruta, { tabla, campos }] of Object.entries(CATALOGOS)) {
  const nombres = Object.keys(campos);
  // El primer campo (nombre) es obligatorio
  const leer = cuerpo => Object.fromEntries(nombres.map((c, i) => [c, texto(cuerpo[c], campos[c], i === 0)]));
  const obtener = id => db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id);

  app.get(`/api/${ruta}`, (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${tabla} ORDER BY nombre`).all());
  });

  app.post(`/api/${ruta}`, (req, res) => {
    const r = db.prepare(`INSERT INTO ${tabla} (${nombres}) VALUES (${nombres.map(c => ':' + c)})`).run(leer(req.body));
    res.status(201).json(obtener(r.lastInsertRowid));
  });

  app.put(`/api/${ruta}/:id`, (req, res) => {
    const id = idParam(req);
    const r = db.prepare(`UPDATE ${tabla} SET ${nombres.map(c => `${c} = :${c}`)} WHERE id = :id`).run({ ...leer(req.body), id });
    if (!r.changes) throw new HttpError(404, 'Registro no encontrado');
    res.json(obtener(id));
  });

  app.delete(`/api/${ruta}/:id`, (req, res) => {
    const r = db.prepare(`DELETE FROM ${tabla} WHERE id = ?`).run(idParam(req));
    if (!r.changes) throw new HttpError(404, 'Registro no encontrado');
    res.status(204).end();
  });
}

// --- Bitácora de movimientos (resumen diario) ---

function registrar(req, tipo, { vacante_id = null, asignacion_id = null, reclutador_id = null, ant = null, nuevo = null }, descripcion) {
  db.prepare(`
    INSERT INTO historial (usuario, tipo, vacante_id, asignacion_id, reclutador_id, descripcion, estado_anterior, estado_nuevo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.usuario?.nombre ?? null, tipo, vacante_id, asignacion_id, reclutador_id, descripcion, ant, nuevo);
}

app.get('/api/historial', (req, res) => {
  const desde = fecha(req.query.desde, 'Desde', true);
  const hasta = fecha(req.query.hasta, 'Hasta') ?? desde;
  res.json(db.prepare('SELECT * FROM historial WHERE date(fecha) BETWEEN ? AND ? ORDER BY fecha DESC, id DESC').all(desde, hasta));
});

// --- Vacantes ---

const SELECT_VACANTES = `
  SELECT v.*, c.nombre AS cliente, l.nombre AS localidad, t.nombre AS tipo_vehiculo, r.nombre AS reclutador,
    COALESCE(SUM(CASE WHEN a.estado = 'Operando' THEN a.unidades END), 0) AS unidades_operativas,
    COALESCE(SUM(CASE WHEN a.estado <> 'Operando' THEN a.unidades END), 0) AS unidades_en_proceso,
    COUNT(a.id) AS proveedores
  FROM vacantes v
  JOIN clientes c ON c.id = v.cliente_id
  JOIN localidades l ON l.id = v.localidad_id
  JOIN tipos_vehiculo t ON t.id = v.tipo_vehiculo_id
  LEFT JOIN reclutadores r ON r.id = v.reclutador_id
  LEFT JOIN asignaciones a ON a.vacante_id = v.id`;

const obtenerVacante = id => db.prepare(`${SELECT_VACANTES} WHERE v.id = ? GROUP BY v.id`).get(id);

function decimal(valor, etiqueta) {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${etiqueta} debe ser un número mayor o igual a 0`);
  return n;
}

const CAMPOS_VACANTE = [
  'cliente_id', 'localidad_id', 'tipo_vehiculo_id', 'reclutador_id', 'esquema', 'cantidad', 'tentativo', 'cerrados',
  'tarifa_min', 'tarifa_max', 'direccion_origen', 'km_diario', 'tipo_ruta', 'horario', 'dias_operacion',
  'fecha_arranque', 'inicio_inmediato', 'fecha_termino', 'notas', 'seguimiento',
  'solicitud_usuario', 'usuario_activo', 'capacitacion_lp', 'capacitacion_conciliacion',
];

const leerVacante = b => ({
  cliente_id: entero(b.cliente_id, 'Cliente', { min: 1, obligatorio: true }),
  localidad_id: entero(b.localidad_id, 'Localidad', { min: 1, obligatorio: true }),
  tipo_vehiculo_id: entero(b.tipo_vehiculo_id, 'Tipo de vehículo', { min: 1, obligatorio: true }),
  reclutador_id: entero(b.reclutador_id, 'Reclutador', { min: 1 }),
  esquema: texto(b.esquema, 'Esquema'),
  cantidad: entero(b.cantidad, 'Objetivo', { min: 1, obligatorio: true }),
  tentativo: entero(b.tentativo, 'Tentativo de cierre') ?? 0,
  cerrados: entero(b.cerrados, 'Cerrados') ?? 0,
  tarifa_min: decimal(b.tarifa_min, 'Tarifa mínima'),
  tarifa_max: decimal(b.tarifa_max, 'Tarifa máxima'),
  direccion_origen: texto(b.direccion_origen, 'Dirección origen'),
  km_diario: texto(b.km_diario, 'Km diario'),
  tipo_ruta: texto(b.tipo_ruta, 'Tipo de ruta'),
  horario: texto(b.horario, 'Horario'),
  dias_operacion: entero(b.dias_operacion, 'Días de operación'),
  fecha_arranque: fecha(b.fecha_arranque, 'Inicio de vigencia'),
  inicio_inmediato: b.inicio_inmediato === true || b.inicio_inmediato === 'on' || String(b.inicio_inmediato) === '1' ? 1 : 0,
  fecha_termino: fecha(b.fecha_termino, 'Término de vigencia'),
  notas: texto(b.notas, 'Comentarios'),
  seguimiento: texto(b.seguimiento, 'Seguimiento'),
  solicitud_usuario: texto(b.solicitud_usuario, 'Solicitud de usuario'),
  usuario_activo: texto(b.usuario_activo, 'Usuario activo'),
  capacitacion_lp: texto(b.capacitacion_lp, 'Capacitación LP'),
  capacitacion_conciliacion: texto(b.capacitacion_conciliacion, 'Capacitación conciliación'),
});

const nombreVacante = v => `${v.cliente} · ${v.localidad} · ${v.tipo_vehiculo}`;

app.get('/api/vacantes', (req, res) => {
  res.json(db.prepare(`${SELECT_VACANTES} GROUP BY v.id ORDER BY r.nombre IS NULL, r.nombre, l.nombre, c.nombre`).all());
});

app.post('/api/vacantes', (req, res) => {
  const datos = leerVacante(req.body);
  const r = db.prepare(`INSERT INTO vacantes (${CAMPOS_VACANTE}) VALUES (${CAMPOS_VACANTE.map(c => ':' + c)})`).run(datos);
  const v = obtenerVacante(r.lastInsertRowid);
  registrar(req, 'vacante_creada', { vacante_id: v.id, reclutador_id: v.reclutador_id }, `Nueva vacante: ${nombreVacante(v)} (${v.cantidad} u.)`);
  res.status(201).json(v);
});

app.put('/api/vacantes/:id', (req, res) => {
  const id = idParam(req);
  const antes = obtenerVacante(id);
  if (!antes) throw new HttpError(404, 'Vacante no encontrada');
  const datos = leerVacante(req.body);
  db.prepare(`UPDATE vacantes SET ${CAMPOS_VACANTE.map(c => `${c} = :${c}`)} WHERE id = :id`).run({ ...datos, id });
  const v = obtenerVacante(id);
  const cambios = [];
  if (antes.cerrados !== v.cerrados) cambios.push(`cerrados ${antes.cerrados} → ${v.cerrados}`);
  if (antes.cantidad !== v.cantidad) cambios.push(`objetivo ${antes.cantidad} → ${v.cantidad}`);
  if (antes.tentativo !== v.tentativo) cambios.push(`tentativo ${antes.tentativo} → ${v.tentativo}`);
  if (antes.reclutador_id !== v.reclutador_id) cambios.push(`reclutador → ${v.reclutador ?? 'Todo el equipo'}`);
  if (CAMPOS_VACANTE.some(c => antes[c] !== v[c])) {
    registrar(req, 'vacante_editada', { vacante_id: id, reclutador_id: v.reclutador_id },
      `Vacante ${nombreVacante(v)} actualizada${cambios.length ? `: ${cambios.join(', ')}` : ''}`);
  }
  res.json(v);
});

app.delete('/api/vacantes/:id', (req, res) => {
  const id = idParam(req);
  const v = obtenerVacante(id);
  if (!v) throw new HttpError(404, 'Vacante no encontrada');
  db.prepare('DELETE FROM vacantes WHERE id = ?').run(id);
  registrar(req, 'vacante_eliminada', { vacante_id: id, reclutador_id: v.reclutador_id }, `Vacante eliminada: ${nombreVacante(v)}`);
  res.status(204).end();
});

// --- Asignaciones de proveedores ---

const SELECT_ASIGNACIONES = `
  SELECT a.*, r.nombre AS reclutador, v.cliente_id, c.nombre AS cliente, l.nombre AS localidad,
    t.nombre AS tipo_vehiculo, v.cantidad AS cantidad_vacante, v.fecha_arranque,
    (SELECT e.desde FROM etapas_asignacion e WHERE e.asignacion_id = a.id AND e.hasta IS NULL ORDER BY e.id DESC LIMIT 1) AS etapa_desde
  FROM asignaciones a
  JOIN vacantes v ON v.id = a.vacante_id
  JOIN clientes c ON c.id = v.cliente_id
  JOIN localidades l ON l.id = v.localidad_id
  JOIN tipos_vehiculo t ON t.id = v.tipo_vehiculo_id
  JOIN reclutadores r ON r.id = a.reclutador_id`;

const obtenerAsignacion = id => db.prepare(`${SELECT_ASIGNACIONES} WHERE a.id = ?`).get(id);

const leerAsignacion = b => {
  if (!ESTADOS.includes(b.estado)) throw new HttpError(400, `Estado inválido. Usa: ${ESTADOS.join(', ')}`);
  return {
    vacante_id: entero(b.vacante_id, 'Vacante', { min: 1, obligatorio: true }),
    reclutador_id: entero(b.reclutador_id, 'Reclutador', { min: 1, obligatorio: true }),
    proveedor: texto(b.proveedor, 'Proveedor', true),
    unidades: entero(b.unidades, 'Unidades', { min: 1, obligatorio: true }),
    fecha_disponibilidad: fecha(b.fecha_disponibilidad, 'Fecha de disponibilidad', true),
    estado: b.estado,
    notas: texto(b.notas, 'Notas'),
  };
};

// Al pasar a Operando el proveedor entra a onboarding (se conserva si ya existía)
function asegurarOnboarding(id, datos) {
  if (datos.estado !== 'Operando') return;
  const ingreso = datos.fecha_disponibilidad <= dia() ? datos.fecha_disponibilidad : dia();
  db.prepare('INSERT OR IGNORE INTO onboarding (asignacion_id, fecha_ingreso) VALUES (?, ?)').run(id, ingreso);
}

app.get('/api/asignaciones', (req, res) => {
  res.json(db.prepare(`${SELECT_ASIGNACIONES} ORDER BY a.actualizado_en DESC, a.id DESC`).all());
});

// Tramos de todas las etapas, para calcular el tiempo promedio en cada una
app.get('/api/etapas', (req, res) => {
  res.json(db.prepare(`
    SELECT e.*, a.reclutador_id FROM etapas_asignacion e JOIN asignaciones a ON a.id = e.asignacion_id
    ORDER BY e.asignacion_id, e.id`).all());
});

// Cierra el tramo de la etapa actual y abre el de la nueva
function cambiarTramo(id, etapa) {
  db.prepare("UPDATE etapas_asignacion SET hasta = datetime('now', 'localtime') WHERE asignacion_id = ? AND hasta IS NULL").run(id);
  db.prepare("INSERT INTO etapas_asignacion (asignacion_id, etapa, desde) VALUES (?, ?, datetime('now', 'localtime'))").run(id, etapa);
}

// Los cerrados de la vacante suman las unidades de sus proveedores en Operando
function ajustarCerrados(vacanteId, delta) {
  if (vacanteId && delta) db.prepare('UPDATE vacantes SET cerrados = MAX(0, cerrados + ?) WHERE id = ?').run(delta, vacanteId);
}
const aporte = a => (a?.estado === 'Operando' ? a.unidades : 0);
const diasDesde = desde => Math.max(0, Math.round((new Date(dia()) - new Date(desde)) / 86400000));

app.post('/api/asignaciones', (req, res) => {
  const datos = leerAsignacion(req.body);
  const r = db.prepare(`
    INSERT INTO asignaciones (vacante_id, reclutador_id, proveedor, unidades, fecha_disponibilidad, estado, notas, creado_en, fecha_operativo)
    VALUES (:vacante_id, :reclutador_id, :proveedor, :unidades, :fecha_disponibilidad, :estado, :notas, :creado_en, :fecha_operativo)`)
    .run({ ...datos, creado_en: dia(), fecha_operativo: datos.estado === 'Operando' ? dia() : null });
  const id = Number(r.lastInsertRowid);
  cambiarTramo(id, datos.estado);
  asegurarOnboarding(id, datos);
  ajustarCerrados(datos.vacante_id, aporte(datos));
  const a = obtenerAsignacion(id);
  registrar(req, 'asignacion_creada', { vacante_id: a.vacante_id, asignacion_id: id, reclutador_id: a.reclutador_id, nuevo: a.estado },
    `Nuevo proveedor ${a.proveedor} (${a.unidades} u.) en ${a.estado} para ${a.cliente} · ${a.localidad}`);
  res.status(201).json(a);
});

app.put('/api/asignaciones/:id', (req, res) => {
  const id = idParam(req);
  const antes = obtenerAsignacion(id);
  if (!antes) throw new HttpError(404, 'Asignación no encontrada');
  const datos = leerAsignacion(req.body);
  const pasaAOperativo = datos.estado === 'Operando' && antes.estado !== 'Operando';
  const fechaOperativo = datos.estado !== 'Operando' ? null : pasaAOperativo ? dia() : antes.fecha_operativo ?? dia();
  db.prepare(`
    UPDATE asignaciones SET vacante_id = :vacante_id, reclutador_id = :reclutador_id, proveedor = :proveedor,
      unidades = :unidades, fecha_disponibilidad = :fecha_disponibilidad, estado = :estado, notas = :notas,
      fecha_operativo = :fecha_operativo, actualizado_en = CURRENT_TIMESTAMP
    WHERE id = :id`).run({ ...datos, fecha_operativo: fechaOperativo, id });
  if (antes.estado !== datos.estado) cambiarTramo(id, datos.estado);
  asegurarOnboarding(id, datos);
  ajustarCerrados(antes.vacante_id, -aporte(antes));
  ajustarCerrados(datos.vacante_id, aporte(datos));
  const a = obtenerAsignacion(id);
  if (antes.estado !== a.estado) {
    const detalle = pasaAOperativo ? ` (${a.unidades} u., cerrado en ${diasDesde(a.creado_en ?? dia())} días)` : '';
    registrar(req, 'cambio_estado', { vacante_id: a.vacante_id, asignacion_id: id, reclutador_id: a.reclutador_id, ant: antes.estado, nuevo: a.estado },
      `${a.proveedor} pasó de ${antes.estado} a ${a.estado}${detalle}`);
  } else {
    registrar(req, 'asignacion_editada', { vacante_id: a.vacante_id, asignacion_id: id, reclutador_id: a.reclutador_id },
      `Se actualizaron los datos de ${a.proveedor}`);
  }
  res.json(a);
});

app.delete('/api/asignaciones/:id', (req, res) => {
  const id = idParam(req);
  const a = obtenerAsignacion(id);
  if (!a) throw new HttpError(404, 'Asignación no encontrada');
  db.prepare('DELETE FROM asignaciones WHERE id = ?').run(id);
  ajustarCerrados(a.vacante_id, -aporte(a));
  registrar(req, 'asignacion_eliminada', { vacante_id: a.vacante_id, asignacion_id: id, reclutador_id: a.reclutador_id },
    `Se quitó al proveedor ${a.proveedor} de ${a.cliente} · ${a.localidad}`);
  res.status(204).end();
});

// --- Onboarding ---

const SELECT_ONBOARDING = `
  SELECT o.*, a.proveedor, a.unidades, a.reclutador_id, r.nombre AS reclutador,
    c.nombre AS cliente, l.nombre AS localidad, t.nombre AS tipo_vehiculo
  FROM onboarding o
  JOIN asignaciones a ON a.id = o.asignacion_id
  JOIN vacantes v ON v.id = a.vacante_id
  JOIN clientes c ON c.id = v.cliente_id
  JOIN localidades l ON l.id = v.localidad_id
  JOIN tipos_vehiculo t ON t.id = v.tipo_vehiculo_id
  JOIN reclutadores r ON r.id = a.reclutador_id
  WHERE a.estado = 'Operando'`;

app.get('/api/onboarding', (req, res) => {
  res.json(db.prepare(`${SELECT_ONBOARDING} ORDER BY o.fecha_ingreso DESC`).all());
});

app.put('/api/onboarding/:id', (req, res) => {
  const id = idParam(req);
  const b = req.body;
  const datos = { id, fecha_ingreso: fecha(b.fecha_ingreso, 'Fecha de ingreso', true) };
  for (const s of [1, 2]) {
    datos[`s${s}_rendimiento`] = entero(b[`s${s}_rendimiento`], `Rendimiento semana ${s}`, { min: 0, max: 100 });
    datos[`s${s}_calificacion`] = entero(b[`s${s}_calificacion`], `Evaluación semana ${s}`, { min: 1, max: 5 });
    datos[`s${s}_comentario`] = texto(b[`s${s}_comentario`], `Comentario semana ${s}`);
  }
  const antes = db.prepare(`${SELECT_ONBOARDING} AND o.asignacion_id = ?`).get(id);
  const r = db.prepare(`
    UPDATE onboarding SET fecha_ingreso = :fecha_ingreso,
      s1_rendimiento = :s1_rendimiento, s1_calificacion = :s1_calificacion, s1_comentario = :s1_comentario,
      s2_rendimiento = :s2_rendimiento, s2_calificacion = :s2_calificacion, s2_comentario = :s2_comentario
    WHERE asignacion_id = :id`).run(datos);
  if (!r.changes) throw new HttpError(404, 'Registro de onboarding no encontrado');
  const o = db.prepare(`${SELECT_ONBOARDING} AND o.asignacion_id = ?`).get(id);
  for (const n of [1, 2]) {
    const cal = `s${n}_calificacion`, ren = `s${n}_rendimiento`;
    if (o[cal] != null && (antes?.[cal] !== o[cal] || antes?.[ren] !== o[ren])) {
      registrar(req, 'evaluacion', { asignacion_id: id, reclutador_id: o.reclutador_id },
        `Evaluación semana ${n} de ${o.proveedor}: ${o[ren] ?? '—'}% de cumplimiento, ${o[cal]} de 5`);
    }
  }
  res.json(o);
});

// --- Errores ---

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.use((err, req, res, next) => {
  if (err.status && err.expose !== false) return res.status(err.status).json({ error: err.message });
  const mensaje = String(err.message);
  if (/FOREIGN KEY/.test(mensaje)) {
    return res.status(409).json({
      error: req.method === 'DELETE'
        ? 'No se puede eliminar: el registro está en uso por vacantes o proveedores.'
        : 'Alguno de los registros seleccionados ya no existe.',
    });
  }
  if (/UNIQUE.*usuarios\.usuario/.test(mensaje)) return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
  if (/UNIQUE/.test(mensaje)) return res.status(409).json({ error: 'Ya existe un registro con ese nombre.' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PUERTO = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PUERTO, HOST, () => {
  console.log(`CRM Redex listo en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PUERTO}`);
});
