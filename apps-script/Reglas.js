// Reglas de negocio: validaciones, etapas, cerrados, onboarding, bitácora y vistas.
// Portadas de la versión local (server.js, db.js y auth.js).

const ESTADOS = ['Contactado', 'Seguimiento documentos', 'Firma de contrato', 'Operando'];
const ROLES = { admin: 'Administrador', reclutador: 'Reclutador' };

// --- Validación de entrada ---

function texto_(valor, etiqueta, obligatorio) {
  const s = valor === null || valor === undefined ? '' : String(valor).trim();
  if (obligatorio && !s) throw new Error(`${etiqueta} es obligatorio`);
  return s || null;
}

function entero_(valor, etiqueta, opciones) {
  const { min = 0, max = Infinity, obligatorio = false } = opciones || {};
  if (valor === null || valor === undefined || valor === '') {
    if (obligatorio) throw new Error(`${etiqueta} es obligatorio`);
    return null;
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) {
    const rango = max === Infinity ? `mayor o igual a ${min}` : `entre ${min} y ${max}`;
    throw new Error(`${etiqueta} debe ser un número entero ${rango}`);
  }
  return n;
}

function decimal_(valor, etiqueta) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${etiqueta} debe ser un número mayor o igual a 0`);
  return n;
}

function fecha_(valor, etiqueta, obligatorio) {
  if (!valor) {
    if (obligatorio) throw new Error(`${etiqueta} es obligatoria`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new Error(`${etiqueta} no es una fecha válida`);
  return valor;
}

const id_ = (valor, etiqueta) => entero_(valor, etiqueta || 'id', { min: 1, obligatorio: true });

// --- Usuario que entra (cuenta de Google del dominio) ---

function usuarioActual_() {
  const correo = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!correo) throw new Error('SIN_ACCESO:No se pudo identificar tu cuenta de Google.');
  const usuarios = leer_('Usuarios');
  let u = usuarios.find(x => String(x.correo).toLowerCase() === correo);
  // El dueño del proyecto entra como primer administrador
  if (!u && !usuarios.length && correo === String(Session.getEffectiveUser().getEmail()).toLowerCase()) {
    insertar_('Usuarios', { correo, nombre: correo.split('@')[0], rol: 'admin', activo: 1, ultimo_acceso: ahora_() });
    u = leer_('Usuarios').find(x => String(x.correo).toLowerCase() === correo);
  }
  if (!u || !u.activo) throw new Error(`SIN_ACCESO:${correo}`);
  return vistaUsuario_(u);
}

function requerirAdmin_(usuario) {
  if (usuario.rol !== 'admin') throw new Error('Solo un administrador puede hacer esto');
}

// --- Bitácora, etapas, onboarding y cerrados ---

function registrar_(usuario, tipo, refs, descripcion) {
  const r = refs || {};
  insertar_('Bitacora', {
    fecha: ahora_(), usuario: usuario ? usuario.nombre : null, tipo,
    vacante_id: r.vacante_id || null, asignacion_id: r.asignacion_id || null, reclutador_id: r.reclutador_id || null,
    descripcion, estado_anterior: r.ant || null, estado_nuevo: r.nuevo || null,
  });
}

// Cierra el tramo de la etapa actual y abre el de la nueva
function cambiarTramo_(asignacionId, etapa, momento) {
  const cuando = momento || ahora_();
  leer_('Etapas').filter(t => t.asignacion_id === asignacionId && !t.hasta)
    .forEach(t => actualizar_('Etapas', t.id, { hasta: cuando }));
  insertar_('Etapas', { asignacion_id: asignacionId, etapa, desde: cuando, hasta: null });
}

// Al pasar a Operando el proveedor entra a onboarding (se conserva si ya existía)
function asegurarOnboarding_(asignacionId, datos) {
  if (datos.estado !== 'Operando' || buscar_('Onboarding', asignacionId)) return;
  const ingreso = datos.fecha_disponibilidad && datos.fecha_disponibilidad <= dia_() ? datos.fecha_disponibilidad : dia_();
  insertar_('Onboarding', { asignacion_id: asignacionId, fecha_ingreso: ingreso });
}

// Los cerrados de la vacante suman las unidades de sus proveedores en Operando
function ajustarCerrados_(vacanteId, delta) {
  if (!vacanteId || !delta) return;
  const v = buscar_('Vacantes', vacanteId);
  if (v) actualizar_('Vacantes', vacanteId, { cerrados: Math.max(0, (v.cerrados || 0) + delta) });
}

const aporte_ = a => (a && a.estado === 'Operando' ? a.unidades : 0);

const diasDesde_ = desde => Math.max(0, Math.round((new Date(dia_()) - new Date(String(desde).slice(0, 10))) / 86400000));

// --- Vistas (lo que antes hacían los SELECT con JOIN) ---

const porId_ = tabla => new Map(leer_(tabla).map(r => [r.id, r]));
const nombreDe_ = (mapa, id) => (mapa.get(id) ? mapa.get(id).nombre : null);
const porNombre_ = (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es');

function catalogo_(tabla) {
  return leer_(tabla).slice().sort(porNombre_);
}

function vistaVacantes_() {
  const clientes = porId_('Clientes'), localidades = porId_('Localidades'), tipos = porId_('TiposVehiculo'), recs = porId_('Reclutadores');
  const asignaciones = leer_('Proveedores');
  return leer_('Vacantes').map(v => {
    const suyas = asignaciones.filter(a => a.vacante_id === v.id);
    return Object.assign({}, v, {
      cerrados: v.cerrados || 0, tentativo: v.tentativo || 0, inicio_inmediato: v.inicio_inmediato || 0,
      cliente: nombreDe_(clientes, v.cliente_id), localidad: nombreDe_(localidades, v.localidad_id),
      tipo_vehiculo: nombreDe_(tipos, v.tipo_vehiculo_id), reclutador: nombreDe_(recs, v.reclutador_id),
      unidades_operativas: suyas.filter(a => a.estado === 'Operando').reduce((t, a) => t + a.unidades, 0),
      unidades_en_proceso: suyas.filter(a => a.estado !== 'Operando').reduce((t, a) => t + a.unidades, 0),
      proveedores: suyas.length,
    });
  }).sort((a, b) =>
    (a.reclutador === null) - (b.reclutador === null) ||
    String(a.reclutador || '').localeCompare(String(b.reclutador || ''), 'es') ||
    String(a.localidad).localeCompare(String(b.localidad), 'es') ||
    String(a.cliente).localeCompare(String(b.cliente), 'es'));
}

function vistaAsignacion_(a, ctx) {
  const v = ctx.vacantes.get(a.vacante_id) || {};
  const abierto = ctx.tramos.filter(t => t.asignacion_id === a.id && !t.hasta).sort((x, y) => y.id - x.id)[0];
  return Object.assign({}, a, {
    reclutador: nombreDe_(ctx.recs, a.reclutador_id), cliente_id: v.cliente_id,
    cliente: nombreDe_(ctx.clientes, v.cliente_id), localidad: nombreDe_(ctx.localidades, v.localidad_id),
    tipo_vehiculo: nombreDe_(ctx.tipos, v.tipo_vehiculo_id), cantidad_vacante: v.cantidad, fecha_arranque: v.fecha_arranque,
    etapa_desde: abierto ? abierto.desde : null,
  });
}

function contexto_() {
  return {
    vacantes: porId_('Vacantes'), clientes: porId_('Clientes'), localidades: porId_('Localidades'),
    tipos: porId_('TiposVehiculo'), recs: porId_('Reclutadores'), tramos: leer_('Etapas'),
  };
}

function vistaAsignaciones_() {
  const ctx = contexto_();
  return leer_('Proveedores').filter(a => ctx.vacantes.has(a.vacante_id)).map(a => vistaAsignacion_(a, ctx))
    .sort((x, y) => String(y.actualizado_en).localeCompare(String(x.actualizado_en)) || y.id - x.id);
}

function vistaOnboarding_() {
  const ctx = contexto_();
  const asignaciones = porId_('Proveedores');
  return leer_('Onboarding').map(o => {
    const a = asignaciones.get(o.asignacion_id);
    if (!a || a.estado !== 'Operando' || !ctx.vacantes.has(a.vacante_id)) return null;
    const va = vistaAsignacion_(a, ctx);
    return Object.assign({}, o, {
      proveedor: a.proveedor, unidades: a.unidades, reclutador_id: a.reclutador_id, reclutador: va.reclutador,
      cliente: va.cliente, localidad: va.localidad, tipo_vehiculo: va.tipo_vehiculo,
    });
  }).filter(Boolean).sort((x, y) => String(y.fecha_ingreso).localeCompare(String(x.fecha_ingreso)));
}

function vistaEtapas_() {
  const asignaciones = porId_('Proveedores');
  return leer_('Etapas').filter(t => asignaciones.has(t.asignacion_id))
    .map(t => Object.assign({}, t, { reclutador_id: asignaciones.get(t.asignacion_id).reclutador_id }))
    .sort((x, y) => x.asignacion_id - y.asignacion_id || x.id - y.id);
}

function vistaProspectos_() {
  const recs = porId_('Reclutadores');
  return leer_('Prospectos').map(p => Object.assign({}, p, { reclutador: nombreDe_(recs, p.reclutador_id) }))
    .sort((x, y) => String(y.creado_en).localeCompare(String(x.creado_en)) || y.id - x.id);
}

function vistaUsuario_(u) {
  return Object.assign({}, u, { activo: u.activo ? 1 : 0, reclutador: nombreDe_(porId_('Reclutadores'), u.reclutador_id) });
}

function vistaUsuarios_() {
  return leer_('Usuarios').map(vistaUsuario_).sort((a, b) => b.activo - a.activo || porNombre_(a, b));
}
