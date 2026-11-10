'use strict';

// Importa las vacantes desde la hoja de Google (pestaña de capacidad).
//   npm run importar                       descarga la hoja compartida
//   npm run importar -- --archivo hoja.csv usa un CSV descargado
//   npm run importar -- --forzar           reemplaza aunque ya haya proveedores capturados
// Reemplaza clientes, localidades, tipos de vehículo y vacantes. Conserva usuarios y reclutadores.

const fs = require('node:fs');
const path = require('node:path');
const { abrir } = require('./db');

// El enlace de la hoja no va en el repositorio (es público): se lee de config.local.json
// ({ "hojaUrl": "https://docs.google.com/.../export?format=csv&gid=..." }) o de la variable HOJA_URL
function urlHoja() {
  if (process.env.HOJA_URL) return process.env.HOJA_URL;
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8')).hojaUrl;
  } catch {
    throw new Error('Falta el enlace de la hoja: crea config.local.json con { "hojaUrl": "…/export?format=csv&gid=…" }');
  }
}

function parsearCSV(texto) {
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

const limpio = v => {
  const s = String(v ?? '').trim();
  return s && s !== '-' ? s : null;
};

const dinero = v => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const entero = v => {
  const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

// dd/mm/aaaa o número de serie de Excel → AAAA-MM-DD
function fecha(v) {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10);
  return null;
}

// Avance de alta y capacitación: la hoja mezcla "listo", "Completo", "Activo", cantidades…
function avance(v) {
  const s = limpio(v);
  if (!s) return null;
  const t = s.toLowerCase();
  if (/^\d+$/.test(t) || ['completado', 'completo', 'listo', 'activo'].includes(t)) return 'Completado';
  if (t.startsWith('pendiente')) return 'Pendiente';
  return s;
}

const tipoVehiculo = v => {
  const s = limpio(v);
  if (!s) return 'Sin definir';
  return s === '1.5' ? '1.5 TON' : s;
};

const capitalizar = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

async function leerHoja() {
  const i = process.argv.indexOf('--archivo');
  if (i > -1) return fs.readFileSync(process.argv[i + 1], 'utf8');
  const r = await fetch(urlHoja());
  if (!r.ok || !String(r.headers.get('content-type')).includes('text/csv')) {
    throw new Error(`No se pudo descargar la hoja (HTTP ${r.status}). Revisa que esté compartida como "Cualquier persona con el enlace".`);
  }
  return r.text();
}

async function main() {
  const [encabezado, ...filas] = parsearCSV(await leerHoja());
  const col = nombre => {
    const i = encabezado.findIndex(h => h.trim().toLowerCase().startsWith(nombre.toLowerCase()));
    if (i < 0) throw new Error(`La hoja no tiene la columna "${nombre}"`);
    return i;
  };
  const C = {
    cliente: col('Cliente'), localidad: col('Localidades'), tarifaMin: col('Tarifa Min'), tarifaMax: col('Tarifa Max'),
    direccion: col('Dirección Origen'), esquema: col('Esquema'), tipo: col('Tipo de Vehículo'), km: col('Km Diario'),
    ruta: col('Tipo de Ruta'), horario: col('Horario'), inicio: col('Inicio Vigencia'), termino: col('Término Vigencia'),
    dias: col('Días de Operación'), comentarios: col('Comentarios'), seguimiento: col('Seguimiento Proveedor'),
    objetivo: col('Objetivo'), tentativo: col('Tentati'), cerrados: col('Cerrados'), asignado: col('Asignado'),
    solicitud: col('Solicitud de creación'), activo: col('Usuario activo'), lp: col('Capacitación LP'),
    conciliacion: col('Capacitación conciliación'),
  };

  const db = abrir();
  const proveedores = db.prepare('SELECT COUNT(*) AS n FROM asignaciones').get().n;
  if (proveedores && !process.argv.includes('--forzar')) {
    throw new Error(`Ya hay ${proveedores} proveedores capturados en el pipeline; importar los borraría. Usa --forzar si estás seguro.`);
  }

  const reclutadores = new Map(db.prepare('SELECT id, nombre FROM reclutadores').all().map(r => [r.nombre.toLowerCase(), r.id]));
  const catalogo = (tabla, nombre, cache) => {
    if (!cache.has(nombre)) {
      cache.set(nombre, Number(db.prepare(`INSERT INTO ${tabla} (nombre) VALUES (?)`).run(nombre).lastInsertRowid));
    }
    return cache.get(nombre);
  };
  const clientes = new Map(), localidades = new Map(), tipos = new Map();
  const insertar = db.prepare(`
    INSERT INTO vacantes (cliente_id, localidad_id, tipo_vehiculo_id, reclutador_id, esquema, cantidad, tentativo, cerrados,
      tarifa_min, tarifa_max, direccion_origen, km_diario, tipo_ruta, horario, dias_operacion,
      fecha_arranque, inicio_inmediato, fecha_termino, notas, seguimiento,
      solicitud_usuario, usuario_activo, capacitacion_lp, capacitacion_conciliacion)
    VALUES (:cliente_id, :localidad_id, :tipo_vehiculo_id, :reclutador_id, :esquema, :cantidad, :tentativo, :cerrados,
      :tarifa_min, :tarifa_max, :direccion_origen, :km_diario, :tipo_ruta, :horario, :dias_operacion,
      :fecha_arranque, :inicio_inmediato, :fecha_termino, :notas, :seguimiento,
      :solicitud_usuario, :usuario_activo, :capacitacion_lp, :capacitacion_conciliacion)`);

  const resumen = {};
  db.exec('BEGIN');
  try {
    db.exec(`DELETE FROM historial; DELETE FROM onboarding; DELETE FROM asignaciones; DELETE FROM vacantes;
      DELETE FROM clientes; DELETE FROM localidades; DELETE FROM tipos_vehiculo;`);

    for (const f of filas) {
      const cliente = limpio(f[C.cliente]);
      const localidad = limpio(f[C.localidad]);
      if (!cliente || !localidad) continue;

      // En algunas filas el nombre del reclutador quedó corrido a la última columna
      let asignado = limpio(f[C.asignado]);
      let conciliacion = f[C.conciliacion];
      if (!asignado && reclutadores.has(String(conciliacion).trim().toLowerCase())) {
        asignado = conciliacion.trim();
        conciliacion = '';
      }
      let reclutadorId = null;
      if (asignado && asignado.toLowerCase() !== 'todos') {
        const clave = asignado.toLowerCase();
        if (!reclutadores.has(clave)) {
          reclutadores.set(clave, Number(db.prepare('INSERT INTO reclutadores (nombre) VALUES (?)').run(capitalizar(asignado)).lastInsertRowid));
        }
        reclutadorId = reclutadores.get(clave);
      }

      const inicio = String(f[C.inicio] ?? '').trim();
      const dias = parseInt(f[C.dias], 10);
      insertar.run({
        cliente_id: catalogo('clientes', cliente, clientes),
        localidad_id: catalogo('localidades', localidad, localidades),
        tipo_vehiculo_id: catalogo('tipos_vehiculo', tipoVehiculo(f[C.tipo]), tipos),
        reclutador_id: reclutadorId,
        esquema: limpio(f[C.esquema]),
        cantidad: Math.max(1, entero(f[C.objetivo])),
        tentativo: entero(f[C.tentativo]),
        cerrados: entero(f[C.cerrados]),
        tarifa_min: dinero(f[C.tarifaMin]),
        tarifa_max: dinero(f[C.tarifaMax]),
        direccion_origen: limpio(f[C.direccion]),
        km_diario: limpio(f[C.km]),
        tipo_ruta: limpio(f[C.ruta]),
        horario: limpio(f[C.horario]),
        dias_operacion: dias > 0 ? dias : null,
        fecha_arranque: fecha(inicio),
        inicio_inmediato: /inmediato/i.test(inicio) ? 1 : 0,
        fecha_termino: fecha(f[C.termino]),
        notas: limpio(f[C.comentarios]),
        seguimiento: limpio(f[C.seguimiento]),
        solicitud_usuario: avance(f[C.solicitud]),
        usuario_activo: avance(f[C.activo]),
        capacitacion_lp: avance(f[C.lp]),
        capacitacion_conciliacion: avance(conciliacion),
      });
      const quien = asignado && asignado.toLowerCase() !== 'todos' ? capitalizar(asignado) : 'Todo el equipo';
      resumen[quien] = (resumen[quien] ?? 0) + 1;
    }

    const total = Object.values(resumen).reduce((a, b) => a + b, 0);
    db.prepare("INSERT INTO historial (usuario, tipo, descripcion) VALUES ('Sistema', 'importacion', ?)")
      .run(`Se importaron ${total} vacantes desde la hoja de Google`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  console.log('Vacantes importadas por reclutador:');
  for (const [quien, n] of Object.entries(resumen)) console.log(`  ${quien}: ${n}`);
  console.log(`Clientes: ${clientes.size} · Localidades: ${localidades.size} · Tipos de vehículo: ${tipos.size}`);
}

// Los formatos de la hoja también los usa la importación de Excel
module.exports = { limpio, dinero, entero, fecha, avance, tipoVehiculo, capitalizar };

if (require.main === module) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
