'use strict';

const path = require('node:path');
const express = require('express');
const { abrir, estaVacia, sembrar, dia, ESTADOS } = require('./db');

const db = abrir();
if (estaVacia(db)) {
  sembrar(db);
  console.log('Base de datos nueva: se cargaron datos demo.');
}

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.body ??= {}; next(); });
app.use(express.static(path.join(__dirname, 'public')));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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

// --- Vacantes ---

const SELECT_VACANTES = `
  SELECT v.*, c.nombre AS cliente, l.nombre AS localidad, t.nombre AS tipo_vehiculo,
    COALESCE(SUM(CASE WHEN a.estado = 'Operativo' THEN a.unidades END), 0) AS unidades_operativas,
    COALESCE(SUM(CASE WHEN a.estado <> 'Operativo' THEN a.unidades END), 0) AS unidades_en_proceso,
    COUNT(a.id) AS proveedores
  FROM vacantes v
  JOIN clientes c ON c.id = v.cliente_id
  JOIN localidades l ON l.id = v.localidad_id
  JOIN tipos_vehiculo t ON t.id = v.tipo_vehiculo_id
  LEFT JOIN asignaciones a ON a.vacante_id = v.id`;

const obtenerVacante = id => db.prepare(`${SELECT_VACANTES} WHERE v.id = ? GROUP BY v.id`).get(id);

const leerVacante = b => ({
  cliente_id: entero(b.cliente_id, 'Cliente', { min: 1, obligatorio: true }),
  localidad_id: entero(b.localidad_id, 'Localidad', { min: 1, obligatorio: true }),
  tipo_vehiculo_id: entero(b.tipo_vehiculo_id, 'Tipo de vehículo', { min: 1, obligatorio: true }),
  cantidad: entero(b.cantidad, 'Cantidad', { min: 1, obligatorio: true }),
  fecha_arranque: fecha(b.fecha_arranque, 'Fecha de arranque', true),
  notas: texto(b.notas, 'Notas'),
});

app.get('/api/vacantes', (req, res) => {
  res.json(db.prepare(`${SELECT_VACANTES} GROUP BY v.id ORDER BY v.fecha_arranque, v.id`).all());
});

app.post('/api/vacantes', (req, res) => {
  const r = db.prepare(`
    INSERT INTO vacantes (cliente_id, localidad_id, tipo_vehiculo_id, cantidad, fecha_arranque, notas)
    VALUES (:cliente_id, :localidad_id, :tipo_vehiculo_id, :cantidad, :fecha_arranque, :notas)`).run(leerVacante(req.body));
  res.status(201).json(obtenerVacante(r.lastInsertRowid));
});

app.put('/api/vacantes/:id', (req, res) => {
  const id = idParam(req);
  const r = db.prepare(`
    UPDATE vacantes SET cliente_id = :cliente_id, localidad_id = :localidad_id, tipo_vehiculo_id = :tipo_vehiculo_id,
      cantidad = :cantidad, fecha_arranque = :fecha_arranque, notas = :notas
    WHERE id = :id`).run({ ...leerVacante(req.body), id });
  if (!r.changes) throw new HttpError(404, 'Vacante no encontrada');
  res.json(obtenerVacante(id));
});

app.delete('/api/vacantes/:id', (req, res) => {
  const r = db.prepare('DELETE FROM vacantes WHERE id = ?').run(idParam(req));
  if (!r.changes) throw new HttpError(404, 'Vacante no encontrada');
  res.status(204).end();
});

// --- Asignaciones de proveedores ---

const SELECT_ASIGNACIONES = `
  SELECT a.*, r.nombre AS reclutador, v.cliente_id, c.nombre AS cliente, l.nombre AS localidad,
    t.nombre AS tipo_vehiculo, v.cantidad AS cantidad_vacante, v.fecha_arranque
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

// Al pasar a Operativo el proveedor entra a onboarding (se conserva si ya existía)
function asegurarOnboarding(id, datos) {
  if (datos.estado !== 'Operativo') return;
  const ingreso = datos.fecha_disponibilidad <= dia() ? datos.fecha_disponibilidad : dia();
  db.prepare('INSERT OR IGNORE INTO onboarding (asignacion_id, fecha_ingreso) VALUES (?, ?)').run(id, ingreso);
}

app.get('/api/asignaciones', (req, res) => {
  res.json(db.prepare(`${SELECT_ASIGNACIONES} ORDER BY a.actualizado_en DESC, a.id DESC`).all());
});

app.post('/api/asignaciones', (req, res) => {
  const datos = leerAsignacion(req.body);
  const r = db.prepare(`
    INSERT INTO asignaciones (vacante_id, reclutador_id, proveedor, unidades, fecha_disponibilidad, estado, notas)
    VALUES (:vacante_id, :reclutador_id, :proveedor, :unidades, :fecha_disponibilidad, :estado, :notas)`).run(datos);
  asegurarOnboarding(r.lastInsertRowid, datos);
  res.status(201).json(obtenerAsignacion(r.lastInsertRowid));
});

app.put('/api/asignaciones/:id', (req, res) => {
  const id = idParam(req);
  const datos = leerAsignacion(req.body);
  const r = db.prepare(`
    UPDATE asignaciones SET vacante_id = :vacante_id, reclutador_id = :reclutador_id, proveedor = :proveedor,
      unidades = :unidades, fecha_disponibilidad = :fecha_disponibilidad, estado = :estado, notas = :notas,
      actualizado_en = CURRENT_TIMESTAMP
    WHERE id = :id`).run({ ...datos, id });
  if (!r.changes) throw new HttpError(404, 'Asignación no encontrada');
  asegurarOnboarding(id, datos);
  res.json(obtenerAsignacion(id));
});

app.delete('/api/asignaciones/:id', (req, res) => {
  const r = db.prepare('DELETE FROM asignaciones WHERE id = ?').run(idParam(req));
  if (!r.changes) throw new HttpError(404, 'Asignación no encontrada');
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
  WHERE a.estado = 'Operativo'`;

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
  const r = db.prepare(`
    UPDATE onboarding SET fecha_ingreso = :fecha_ingreso,
      s1_rendimiento = :s1_rendimiento, s1_calificacion = :s1_calificacion, s1_comentario = :s1_comentario,
      s2_rendimiento = :s2_rendimiento, s2_calificacion = :s2_calificacion, s2_comentario = :s2_comentario
    WHERE asignacion_id = :id`).run(datos);
  if (!r.changes) throw new HttpError(404, 'Registro de onboarding no encontrado');
  res.json(db.prepare(`${SELECT_ONBOARDING} AND o.asignacion_id = ?`).get(id));
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
  if (/UNIQUE/.test(mensaje)) return res.status(409).json({ error: 'Ya existe un registro con ese nombre.' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PUERTO = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PUERTO, HOST, () => {
  console.log(`CRM Redex listo en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PUERTO}`);
});
