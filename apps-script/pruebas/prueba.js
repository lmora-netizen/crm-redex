'use strict';

// Pruebas del proyecto de Apps Script con la hoja simulada:
//   node apps-script/pruebas/prueba.js
// Necesita apps-script/Migracion.js (node apps-script/exportar-datos.js <correo>)
// y data/crm.db para comparar contra la versión local.

const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { crearEntorno } = require('./simulador');

const ADMIN = 'lmora@bdbcompany.com';
const local = new DatabaseSync(path.join(__dirname, '..', '..', 'data', 'crm.db'), { readOnly: true });
const app = crearEntorno({ duenio: ADMIN });
const copia = x => JSON.parse(JSON.stringify(x));
let pruebas = 0;
const prueba = (nombre, fn) => { fn(); pruebas++; console.log(`✓ ${nombre}`); };
const falla = (fn, texto) => assert.throws(fn, e => String(e.message).includes(texto), `debía fallar con «${texto}»`);

// --- Migración y lectura ---

app.comoUsuario(ADMIN);
app.llamar('migrarDatosIniciales');
let todo = copia(app.llamar('cargarTodo'));

prueba('la migración trae los mismos registros que la versión local', () => {
  assert.equal(todo.vacantes.length, local.prepare('SELECT COUNT(*) n FROM vacantes').get().n);
  assert.equal(todo.asignaciones.length, local.prepare('SELECT COUNT(*) n FROM asignaciones').get().n);
  assert.equal(todo.etapas.length, local.prepare('SELECT COUNT(*) n FROM etapas_asignacion').get().n);
  assert.equal(todo.prospectos.length, 1);
  assert.equal(todo.reclutadores.length, local.prepare('SELECT COUNT(*) n FROM reclutadores').get().n);
  assert.equal(todo.usuario.rol, 'admin');
});

prueba('vacantes cubiertas y por cubrir coinciden con la versión local', () => {
  const cubiertas = todo.vacantes.filter(v => v.cerrados >= v.cantidad).length;
  const localCubiertas = local.prepare('SELECT COUNT(*) n FROM vacantes WHERE cerrados >= cantidad').get().n;
  assert.equal(cubiertas, localCubiertas);
  console.log(`    ${todo.vacantes.length - cubiertas} por cubrir, ${cubiertas} cubiertas`);
});

prueba('cada vacante calcula igual sus proveedores y unidades en proceso', () => {
  const filas = local.prepare(`SELECT v.id, v.cerrados, COUNT(a.id) proveedores,
    COALESCE(SUM(CASE WHEN a.estado <> 'Operando' THEN a.unidades END), 0) en_proceso
    FROM vacantes v LEFT JOIN asignaciones a ON a.vacante_id = v.id GROUP BY v.id`).all();
  for (const f of filas) {
    const v = todo.vacantes.find(x => x.id === f.id);
    assert.deepEqual([v.cerrados, v.proveedores, v.unidades_en_proceso], [f.cerrados, f.proveedores, f.en_proceso], `vacante ${f.id}`);
  }
});

prueba('onboarding muestra los proveedores en Operando con sus datos', () => {
  const n = local.prepare("SELECT COUNT(*) n FROM onboarding o JOIN asignaciones a ON a.id = o.asignacion_id WHERE a.estado = 'Operando'").get().n;
  assert.equal(todo.onboarding.length, n);
  assert.ok(todo.onboarding.every(o => o.proveedor && o.cliente && o.localidad));
});

prueba('las fechas se leen como texto AAAA-MM-DD', () => {
  assert.ok(todo.vacantes.filter(v => v.fecha_arranque).every(v => /^\d{4}-\d{2}-\d{2}$/.test(v.fecha_arranque)));
});

// --- Acceso ---

prueba('una cuenta que no está en Usuarios no entra', () => {
  app.comoUsuario('alguien@bdbcompany.com');
  falla(() => app.llamar('cargarTodo'), 'SIN_ACCESO:alguien@bdbcompany.com');
});

prueba('un reclutador entra, pero no ve ni gestiona usuarios', () => {
  app.comoUsuario(ADMIN);
  const carla = todo.reclutadores.find(r => r.nombre === 'Carla');
  app.llamar('guardarUsuario', { correo: 'Carla@bdbcompany.com', nombre: 'Carla', rol: 'reclutador', reclutador_id: carla.id }, null);
  app.comoUsuario('carla@bdbcompany.com');
  const suyo = copia(app.llamar('cargarTodo'));
  assert.equal(suyo.usuario.reclutador, 'Carla');
  assert.equal(suyo.usuarios.length, 0);
  falla(() => app.llamar('guardarUsuario', { correo: 'x@bdbcompany.com', nombre: 'X', rol: 'admin' }, null), 'Solo un administrador');
});

prueba('siempre queda al menos un administrador activo', () => {
  app.comoUsuario(ADMIN);
  const yo = copia(app.llamar('cargarTodo')).usuario;
  falla(() => app.llamar('guardarUsuario', { correo: ADMIN, nombre: 'Leslie', rol: 'reclutador', activo: 1 }, yo.id), 'al menos un administrador');
  falla(() => app.llamar('borrarUsuario', yo.id), 'No puedes eliminar tu propio usuario');
});

// --- Etapas, cerrados y onboarding ---

prueba('un proveedor pasa por las etapas y suma a cerrados al llegar a Operando', () => {
  app.comoUsuario(ADMIN);
  const vacante = todo.vacantes.find(v => v.cerrados < v.cantidad);
  const base = { vacante_id: vacante.id, reclutador_id: todo.reclutadores[0].id, proveedor: 'Proveedor Prueba', unidades: 2, fecha_disponibilidad: '2026-11-10' };
  const a = copia(app.llamar('guardarAsignacion', { ...base, estado: 'Contactado' }, null));
  app.llamar('guardarAsignacion', { ...base, estado: 'Seguimiento documentos' }, a.id);
  app.llamar('guardarAsignacion', { ...base, estado: 'Operando' }, a.id);
  const despues = copia(app.llamar('cargarTodo'));
  const v = despues.vacantes.find(x => x.id === vacante.id);
  assert.equal(v.cerrados, vacante.cerrados + 2);
  const tramos = despues.etapas.filter(t => t.asignacion_id === a.id);
  assert.deepEqual(tramos.map(t => t.etapa), ['Contactado', 'Seguimiento documentos', 'Operando']);
  assert.ok(tramos.slice(0, 2).every(t => t.hasta) && !tramos[2].hasta, 'solo el último tramo queda abierto');
  assert.ok(despues.onboarding.some(o => o.asignacion_id === a.id), 'entra a onboarding');
  assert.equal(despues.asignaciones.find(x => x.id === a.id).etapa_desde, tramos[2].desde);

  app.llamar('guardarOnboarding', a.id, { fecha_ingreso: '2026-11-10', s1_rendimiento: 90, s1_calificacion: 4, s1_comentario: 'Bien' });
  const o = copia(app.llamar('cargarTodo')).onboarding.find(x => x.asignacion_id === a.id);
  assert.deepEqual([o.s1_rendimiento, o.s1_calificacion, o.s1_comentario], [90, 4, 'Bien']);

  app.llamar('borrarAsignacion', a.id);
  const final = copia(app.llamar('cargarTodo'));
  assert.equal(final.vacantes.find(x => x.id === vacante.id).cerrados, vacante.cerrados);
  assert.ok(!final.etapas.some(t => t.asignacion_id === a.id) && !final.onboarding.some(x => x.asignacion_id === a.id));
});

prueba('una etapa inválida se rechaza', () => {
  const v = todo.vacantes[0];
  falla(() => app.llamar('guardarAsignacion', { vacante_id: v.id, reclutador_id: 1, proveedor: 'X', unidades: 1, fecha_disponibilidad: '2026-11-10', estado: 'Inventada' }, null), 'Etapa inválida');
});

// --- Vacantes y catálogos ---

prueba('se crea, edita y borra una vacante', () => {
  const base = { cliente_id: todo.clientes[0].id, localidad_id: todo.localidades[0].id, tipo_vehiculo_id: todo.tiposVehiculo[0].id, cantidad: 3, fecha_arranque: '2026-11-20', inicio_inmediato: '' };
  const v = copia(app.llamar('guardarVacante', base, null));
  assert.equal(v.cantidad, 3);
  const e = copia(app.llamar('guardarVacante', { ...base, cantidad: 5, inicio_inmediato: 'on' }, v.id));
  assert.deepEqual([e.cantidad, e.inicio_inmediato], [5, 1]);
  app.llamar('borrarVacante', v.id);
  assert.ok(!copia(app.llamar('cargarTodo')).vacantes.some(x => x.id === v.id));
});

prueba('los catálogos no aceptan nombres repetidos ni borrar algo en uso', () => {
  const cliente = todo.clientes[0];
  falla(() => app.llamar('guardarCatalogo', 'clientes', { nombre: cliente.nombre.toUpperCase() }, null), 'Ya existe');
  falla(() => app.llamar('borrarCatalogo', 'clientes', cliente.id), 'en uso');
  const nuevo = copia(app.llamar('guardarCatalogo', 'localidades', { nombre: 'Ciudad Prueba' }, null));
  app.llamar('borrarCatalogo', 'localidades', nuevo.id);
});

prueba('los prospectos sin vacante se crean y se borran', () => {
  const p = copia(app.llamar('guardarProspecto', { proveedor: 'Prospecto Prueba', unidades: 2, referencia: 'SMT9' }, null));
  assert.equal(p.unidades, 2);
  app.llamar('borrarProspecto', p.id);
});

prueba('la migración no se repite sobre una hoja con datos', () => {
  falla(() => app.llamar('migrarDatosIniciales'), 'ya tiene datos');
});

console.log(`\n${pruebas} pruebas en verde`);
