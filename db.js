'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DIR_DATOS = process.env.DATA_DIR || path.join(__dirname, 'data');
const ARCHIVO_DB = path.join(DIR_DATOS, 'crm.db');

const ESTADOS = ['Prospección', 'En documentación', 'Cierre de contrato', 'Operativo'];

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
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  fecha_arranque TEXT NOT NULL,
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS asignaciones (
  id INTEGER PRIMARY KEY,
  vacante_id INTEGER NOT NULL REFERENCES vacantes(id) ON DELETE CASCADE,
  reclutador_id INTEGER NOT NULL REFERENCES reclutadores(id),
  proveedor TEXT NOT NULL,
  unidades INTEGER NOT NULL CHECK (unidades > 0),
  fecha_disponibilidad TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('Prospección', 'En documentación', 'Cierre de contrato', 'Operativo')),
  notas TEXT,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seguimiento de las dos primeras semanas tras pasar a Operativo
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
`;

function abrir() {
  fs.mkdirSync(DIR_DATOS, { recursive: true });
  const db = new DatabaseSync(ARCHIVO_DB);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);
  return db;
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
      DELETE FROM onboarding; DELETE FROM asignaciones; DELETE FROM vacantes;
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

    const rec = {
      ana: insertar('reclutadores', { nombre: 'Ana Torres', email: 'ana.torres@example.com' }),
      carlos: insertar('reclutadores', { nombre: 'Carlos Méndez', email: 'carlos.mendez@example.com' }),
      sofia: insertar('reclutadores', { nombre: 'Sofía Ruiz', email: 'sofia.ruiz@example.com' }),
    };

    const vacante = (cliente_id, localidad_id, tipo_vehiculo_id, cantidad, arranque, notas = null) =>
      insertar('vacantes', { cliente_id, localidad_id, tipo_vehiculo_id, cantidad, fecha_arranque: dia(arranque), notas });

    const v = [
      vacante(cli.andina, loc.cdmx, tip.c35, 10, -20, 'Operación de última milla zona sur.'),
      vacante(cli.andina, loc.gdl, tip.rabon, 6, 10),
      vacante(cli.norte, loc.mty, tip.tracto, 8, -15, 'Ruta Monterrey – Laredo.'),
      vacante(cli.norte, loc.mty, tip.torton, 4, 25),
      vacante(cli.retail, loc.cdmx, tip.van, 12, 5, 'Temporada alta: requiere GPS y seguro de carga.'),
      vacante(cli.retail, loc.pue, tip.c35, 5, 40),
      vacante(cli.vida, loc.qro, tip.van, 6, -10, 'Unidades refrigeradas deseables.'),
      vacante(cli.vida, loc.gdl, tip.c35, 3, 60),
    ];

    const asignar = (vacante_id, reclutador_id, proveedor, unidades, disponible, estado, notas = null) =>
      insertar('asignaciones', { vacante_id, reclutador_id, proveedor, unidades, fecha_disponibilidad: dia(disponible), estado, notas });

    const onboarding = (asignacion_id, ingreso, s1 = [], s2 = []) =>
      insertar('onboarding', {
        asignacion_id, fecha_ingreso: dia(ingreso),
        s1_rendimiento: s1[0] ?? null, s1_calificacion: s1[1] ?? null, s1_comentario: s1[2] ?? null,
        s2_rendimiento: s2[0] ?? null, s2_calificacion: s2[1] ?? null, s2_comentario: s2[2] ?? null,
      });

    onboarding(asignar(v[0], rec.ana, 'Transportes Rápidos del Valle', 4, -16, 'Operativo'), -16,
      [92, 4, 'Buen arranque; dos retrasos menores en la ruta norte.'],
      [97, 5, 'Cumplimiento estable, sin incidencias.']);
    onboarding(asignar(v[0], rec.carlos, 'Logística Martínez', 3, -9, 'Operativo'), -9,
      [85, 3, 'Faltó documentación de una unidad los primeros días.']);
    asignar(v[0], rec.ana, 'Fletes Unión', 2, 3, 'Cierre de contrato', 'Contrato en revisión legal.');
    asignar(v[1], rec.sofia, 'Autotransportes Jalisco', 3, 7, 'En documentación', 'Pendientes pólizas de seguro.');
    asignar(v[1], rec.sofia, 'TransOccidente', 2, 12, 'Prospección');
    onboarding(asignar(v[2], rec.carlos, 'Carga Pesada Regio', 5, -14, 'Operativo'), -14,
      [78, 3, 'Incidencias en tiempos de carga en CEDIS.'],
      [88, 4, 'Mejoró tras el ajuste de horarios.']);
    asignar(v[2], rec.carlos, 'Fletes del Golfo', 2, 2, 'Cierre de contrato');
    asignar(v[3], rec.ana, 'Grupo Logístico Cumbres', 4, 20, 'Prospección', 'Primera llamada agendada.');
    asignar(v[4], rec.sofia, 'Envíos Urbanos CDMX', 6, 2, 'En documentación');
    asignar(v[4], rec.ana, 'Última Milla Express', 4, 4, 'Cierre de contrato');
    asignar(v[4], rec.carlos, 'Repartos Metropolitanos', 3, 6, 'Prospección');
    asignar(v[5], rec.sofia, 'Transportes Angelópolis', 2, 30, 'Prospección');
    onboarding(asignar(v[6], rec.ana, 'Logística Bajío', 4, -3, 'Operativo'), -3);
    onboarding(asignar(v[6], rec.carlos, 'Mensajería Queretana', 2, -1, 'Operativo'), -1);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { abrir, estaVacia, sembrar, dia, ESTADOS, ARCHIVO_DB };
