// Funciones que la página llama con google.script.run. Cada una identifica a
// quien entra por su cuenta de Google y revisa su rol antes de actuar.

function cargarTodo() {
  const usuario = usuarioActual_();
  // Último acceso, sin escribir en cada refresco automático
  if (!usuario.ultimo_acceso || usuario.ultimo_acceso < Utilities.formatDate(new Date(Date.now() - 600000), ZONA, 'yyyy-MM-dd HH:mm:ss')) {
    actualizar_('Usuarios', usuario.id, { ultimo_acceso: ahora_() });
  }
  return {
    usuario,
    clientes: catalogo_('Clientes'),
    localidades: catalogo_('Localidades'),
    tiposVehiculo: catalogo_('TiposVehiculo'),
    reclutadores: catalogo_('Reclutadores'),
    vacantes: vistaVacantes_(),
    asignaciones: vistaAsignaciones_(),
    onboarding: vistaOnboarding_(),
    etapas: vistaEtapas_(),
    prospectos: vistaProspectos_(),
    usuarios: usuario.rol === 'admin' ? vistaUsuarios_() : [],
  };
}

// --- Catálogos ---

const CATALOGOS_ = {
  clientes: { tabla: 'Clientes', campos: { nombre: 'Nombre', contacto: 'Contacto', telefono: 'Teléfono' }, uso: ['cliente_id'] },
  localidades: { tabla: 'Localidades', campos: { nombre: 'Nombre', estado: 'Estado' }, uso: ['localidad_id'] },
  'tipos-vehiculo': { tabla: 'TiposVehiculo', campos: { nombre: 'Nombre', descripcion: 'Descripción' }, uso: ['tipo_vehiculo_id'] },
  reclutadores: { tabla: 'Reclutadores', campos: { nombre: 'Nombre', email: 'Correo' }, uso: ['reclutador_id'] },
};

function catalogoDe_(ruta) {
  const c = CATALOGOS_[ruta];
  if (!c) throw new Error('Catálogo no encontrado');
  return c;
}

function guardarCatalogo(ruta, datos, id) {
  return conCandado_(() => {
    usuarioActual_();
    const { tabla, campos } = catalogoDe_(ruta);
    const nombres = Object.keys(campos);
    const registro = {};
    nombres.forEach((c, i) => { registro[c] = texto_(datos[c], campos[c], i === 0); });
    const duplicado = leer_(tabla).find(r => String(r.nombre).toLowerCase() === registro.nombre.toLowerCase() && r.id !== Number(id));
    if (duplicado) throw new Error('Ya existe un registro con ese nombre.');
    if (id) {
      if (!actualizar_(tabla, id_(id), registro)) throw new Error('Registro no encontrado');
      return buscar_(tabla, id);
    }
    return buscar_(tabla, insertar_(tabla, registro));
  });
}

function borrarCatalogo(ruta, id) {
  return conCandado_(() => {
    usuarioActual_();
    const { tabla } = catalogoDe_(ruta);
    const n = id_(id);
    const campo = catalogoDe_(ruta).uso[0];
    const enUso = leer_('Vacantes').some(v => v[campo] === n) || (ruta === 'reclutadores' && leer_('Proveedores').some(a => a.reclutador_id === n));
    if (enUso) throw new Error('No se puede eliminar: el registro está en uso por vacantes o proveedores.');
    if (!borrar_(tabla, n)) throw new Error('Registro no encontrado');
    if (ruta === 'reclutadores') {
      leer_('Usuarios').filter(u => u.reclutador_id === n).forEach(u => actualizar_('Usuarios', u.id, { reclutador_id: null }));
      leer_('Prospectos').filter(p => p.reclutador_id === n).forEach(p => actualizar_('Prospectos', p.id, { reclutador_id: null }));
    }
    return true;
  });
}

// --- Vacantes ---

const CAMPOS_VACANTE_ = ['cliente_id', 'localidad_id', 'tipo_vehiculo_id', 'reclutador_id', 'esquema', 'cantidad', 'tentativo',
  'cerrados', 'tarifa_min', 'tarifa_max', 'direccion_origen', 'km_diario', 'tipo_ruta', 'horario', 'dias_operacion',
  'fecha_arranque', 'inicio_inmediato', 'fecha_termino', 'notas', 'seguimiento', 'solicitud_usuario', 'usuario_activo',
  'capacitacion_lp', 'capacitacion_conciliacion'];

function leerVacante_(b) {
  const datos = {
    cliente_id: entero_(b.cliente_id, 'Cliente', { min: 1, obligatorio: true }),
    localidad_id: entero_(b.localidad_id, 'Localidad', { min: 1, obligatorio: true }),
    tipo_vehiculo_id: entero_(b.tipo_vehiculo_id, 'Tipo de vehículo', { min: 1, obligatorio: true }),
    reclutador_id: entero_(b.reclutador_id, 'Reclutador', { min: 1 }),
    esquema: texto_(b.esquema, 'Esquema'),
    cantidad: entero_(b.cantidad, 'Objetivo', { min: 1, obligatorio: true }),
    tentativo: entero_(b.tentativo, 'Tentativo de cierre') || 0,
    cerrados: entero_(b.cerrados, 'Cerrados') || 0,
    tarifa_min: decimal_(b.tarifa_min, 'Tarifa mínima'),
    tarifa_max: decimal_(b.tarifa_max, 'Tarifa máxima'),
    direccion_origen: texto_(b.direccion_origen, 'Dirección origen'),
    km_diario: texto_(b.km_diario, 'Km diario'),
    tipo_ruta: texto_(b.tipo_ruta, 'Tipo de ruta'),
    horario: texto_(b.horario, 'Horario'),
    dias_operacion: entero_(b.dias_operacion, 'Días de operación'),
    fecha_arranque: fecha_(b.fecha_arranque, 'Inicio de vigencia'),
    inicio_inmediato: b.inicio_inmediato === true || b.inicio_inmediato === 'on' || String(b.inicio_inmediato) === '1' ? 1 : 0,
    fecha_termino: fecha_(b.fecha_termino, 'Término de vigencia'),
    notas: texto_(b.notas, 'Comentarios'),
    seguimiento: texto_(b.seguimiento, 'Seguimiento'),
    solicitud_usuario: texto_(b.solicitud_usuario, 'Solicitud de usuario'),
    usuario_activo: texto_(b.usuario_activo, 'Usuario activo'),
    capacitacion_lp: texto_(b.capacitacion_lp, 'Capacitación LP'),
    capacitacion_conciliacion: texto_(b.capacitacion_conciliacion, 'Capacitación conciliación'),
  };
  const existe = (tabla, valor) => valor === null || buscar_(tabla, valor);
  if (!existe('Clientes', datos.cliente_id) || !existe('Localidades', datos.localidad_id) ||
      !existe('TiposVehiculo', datos.tipo_vehiculo_id) || !existe('Reclutadores', datos.reclutador_id)) {
    throw new Error('Alguno de los registros seleccionados ya no existe.');
  }
  return datos;
}

const vacantePorId_ = id => vistaVacantes_().find(v => v.id === Number(id));
const nombreVacante_ = v => `${v.cliente} · ${v.localidad} · ${v.tipo_vehiculo}`;

function guardarVacante(b, id) {
  return conCandado_(() => {
    const usuario = usuarioActual_();
    const datos = leerVacante_(b);
    if (!id) {
      const nuevo = insertar_('Vacantes', Object.assign({}, datos, { creado_en: ahora_() }));
      const v = vacantePorId_(nuevo);
      registrar_(usuario, 'vacante_creada', { vacante_id: v.id, reclutador_id: v.reclutador_id }, `Nueva vacante: ${nombreVacante_(v)} (${v.cantidad} u.)`);
      return v;
    }
    const antes = vacantePorId_(id);
    if (!antes) throw new Error('Vacante no encontrada');
    actualizar_('Vacantes', antes.id, datos);
    const v = vacantePorId_(id);
    const cambios = [];
    if (antes.cerrados !== v.cerrados) cambios.push(`cerrados ${antes.cerrados} → ${v.cerrados}`);
    if (antes.cantidad !== v.cantidad) cambios.push(`objetivo ${antes.cantidad} → ${v.cantidad}`);
    if (antes.tentativo !== v.tentativo) cambios.push(`tentativo ${antes.tentativo} → ${v.tentativo}`);
    if (antes.reclutador_id !== v.reclutador_id) cambios.push(`reclutador → ${v.reclutador || 'Todo el equipo'}`);
    if (CAMPOS_VACANTE_.some(c => antes[c] !== v[c])) {
      registrar_(usuario, 'vacante_editada', { vacante_id: v.id, reclutador_id: v.reclutador_id },
        `Vacante ${nombreVacante_(v)} actualizada${cambios.length ? `: ${cambios.join(', ')}` : ''}`);
    }
    return v;
  });
}

function borrarVacante(id) {
  return conCandado_(() => {
    const usuario = usuarioActual_();
    const v = vacantePorId_(id_(id));
    if (!v) throw new Error('Vacante no encontrada');
    const suyas = leer_('Proveedores').filter(a => a.vacante_id === v.id).map(a => a.id);
    borrarDonde_('Etapas', t => suyas.includes(t.asignacion_id));
    borrarDonde_('Onboarding', o => suyas.includes(o.asignacion_id));
    borrarDonde_('Proveedores', a => a.vacante_id === v.id);
    borrar_('Vacantes', v.id);
    registrar_(usuario, 'vacante_eliminada', { vacante_id: v.id, reclutador_id: v.reclutador_id }, `Vacante eliminada: ${nombreVacante_(v)}`);
    return true;
  });
}

// --- Proveedores en etapas de contratación ---

function leerAsignacion_(b) {
  if (!ESTADOS.includes(b.estado)) throw new Error(`Etapa inválida. Usa: ${ESTADOS.join(', ')}`);
  const datos = {
    vacante_id: entero_(b.vacante_id, 'Vacante', { min: 1, obligatorio: true }),
    reclutador_id: entero_(b.reclutador_id, 'Reclutador', { min: 1, obligatorio: true }),
    proveedor: texto_(b.proveedor, 'Proveedor', true),
    unidades: entero_(b.unidades, 'Unidades', { min: 1, obligatorio: true }),
    fecha_disponibilidad: fecha_(b.fecha_disponibilidad, 'Fecha de disponibilidad', true),
    estado: b.estado,
    notas: texto_(b.notas, 'Notas'),
  };
  if (!buscar_('Vacantes', datos.vacante_id) || !buscar_('Reclutadores', datos.reclutador_id)) {
    throw new Error('Alguno de los registros seleccionados ya no existe.');
  }
  return datos;
}

const asignacionPorId_ = id => {
  const a = buscar_('Proveedores', id);
  return a ? vistaAsignacion_(a, contexto_()) : null;
};

function guardarAsignacion(b, id) {
  return conCandado_(() => {
    const usuario = usuarioActual_();
    const datos = leerAsignacion_(b);
    if (!id) {
      const nuevo = insertar_('Proveedores', Object.assign({}, datos, {
        creado_en: dia_(), actualizado_en: ahora_(), fecha_operativo: datos.estado === 'Operando' ? dia_() : null,
      }));
      cambiarTramo_(nuevo, datos.estado);
      asegurarOnboarding_(nuevo, datos);
      ajustarCerrados_(datos.vacante_id, aporte_(datos));
      const a = asignacionPorId_(nuevo);
      registrar_(usuario, 'asignacion_creada', { vacante_id: a.vacante_id, asignacion_id: a.id, reclutador_id: a.reclutador_id, nuevo: a.estado },
        `Nuevo proveedor ${a.proveedor} (${a.unidades} u.) en ${a.estado} para ${a.cliente} · ${a.localidad}`);
      return a;
    }
    const antes = asignacionPorId_(id_(id));
    if (!antes) throw new Error('Proveedor no encontrado');
    const pasaAOperando = datos.estado === 'Operando' && antes.estado !== 'Operando';
    const fechaOperativo = datos.estado !== 'Operando' ? null : pasaAOperando ? dia_() : antes.fecha_operativo || dia_();
    actualizar_('Proveedores', antes.id, Object.assign({}, datos, { fecha_operativo: fechaOperativo, actualizado_en: ahora_() }));
    if (antes.estado !== datos.estado) cambiarTramo_(antes.id, datos.estado);
    asegurarOnboarding_(antes.id, datos);
    ajustarCerrados_(antes.vacante_id, -aporte_(antes));
    ajustarCerrados_(datos.vacante_id, aporte_(datos));
    const a = asignacionPorId_(antes.id);
    if (antes.estado !== a.estado) {
      const detalle = pasaAOperando ? ` (${a.unidades} u., cerrado en ${diasDesde_(a.creado_en || dia_())} días)` : '';
      registrar_(usuario, 'cambio_estado', { vacante_id: a.vacante_id, asignacion_id: a.id, reclutador_id: a.reclutador_id, ant: antes.estado, nuevo: a.estado },
        `${a.proveedor} pasó de ${antes.estado} a ${a.estado}${detalle}`);
    } else {
      registrar_(usuario, 'asignacion_editada', { vacante_id: a.vacante_id, asignacion_id: a.id, reclutador_id: a.reclutador_id },
        `Se actualizaron los datos de ${a.proveedor}`);
    }
    return a;
  });
}

function borrarAsignacion(id) {
  return conCandado_(() => {
    const usuario = usuarioActual_();
    const a = asignacionPorId_(id_(id));
    if (!a) throw new Error('Proveedor no encontrado');
    borrarDonde_('Etapas', t => t.asignacion_id === a.id);
    borrar_('Onboarding', a.id);
    borrar_('Proveedores', a.id);
    ajustarCerrados_(a.vacante_id, -aporte_(a));
    registrar_(usuario, 'asignacion_eliminada', { vacante_id: a.vacante_id, asignacion_id: a.id, reclutador_id: a.reclutador_id },
      `Se quitó al proveedor ${a.proveedor} de ${a.cliente} · ${a.localidad}`);
    return true;
  });
}

// --- Onboarding ---

function guardarOnboarding(id, b) {
  return conCandado_(() => {
    const usuario = usuarioActual_();
    const n = id_(id);
    const antes = vistaOnboarding_().find(o => o.asignacion_id === n);
    if (!antes) throw new Error('Registro de onboarding no encontrado');
    const datos = { fecha_ingreso: fecha_(b.fecha_ingreso, 'Fecha de ingreso', true) };
    [1, 2].forEach(s => {
      datos[`s${s}_rendimiento`] = entero_(b[`s${s}_rendimiento`], `Rendimiento semana ${s}`, { min: 0, max: 100 });
      datos[`s${s}_calificacion`] = entero_(b[`s${s}_calificacion`], `Evaluación semana ${s}`, { min: 1, max: 5 });
      datos[`s${s}_comentario`] = texto_(b[`s${s}_comentario`], `Comentario semana ${s}`);
    });
    actualizar_('Onboarding', n, datos);
    const o = vistaOnboarding_().find(x => x.asignacion_id === n);
    [1, 2].forEach(s => {
      const cal = `s${s}_calificacion`, ren = `s${s}_rendimiento`;
      if (o[cal] !== null && (antes[cal] !== o[cal] || antes[ren] !== o[ren])) {
        registrar_(usuario, 'evaluacion', { asignacion_id: n, reclutador_id: o.reclutador_id },
          `Evaluación semana ${s} de ${o.proveedor}: ${o[ren] === null ? '—' : o[ren]}% de cumplimiento, ${o[cal]} de 5`);
      }
    });
    return o;
  });
}

// --- Prospectos sin vacante ---

function leerProspecto_(b) {
  return {
    proveedor: texto_(b.proveedor, 'Proveedor', true),
    unidades: entero_(b.unidades, 'Unidades', { min: 1 }) || 1,
    referencia: texto_(b.referencia, 'Vacante reportada'),
    tipo_vehiculo: texto_(b.tipo_vehiculo, 'Tipo de vehículo'),
    reclutador_id: entero_(b.reclutador_id, 'Reclutador', { min: 1 }),
    notas: texto_(b.notas, 'Notas'),
  };
}

function guardarProspecto(b, id) {
  return conCandado_(() => {
    const usuario = usuarioActual_();
    const datos = leerProspecto_(b);
    if (id) {
      if (!actualizar_('Prospectos', id_(id), datos)) throw new Error('Prospecto no encontrado');
      return vistaProspectos_().find(p => p.id === Number(id));
    }
    const nuevo = insertar_('Prospectos', Object.assign({}, datos, { creado_en: ahora_() }));
    const p = vistaProspectos_().find(x => x.id === nuevo);
    registrar_(usuario, 'prospecto_creado', { reclutador_id: p.reclutador_id },
      `Prospecto sin vacante: ${p.proveedor} (${p.unidades} u.)${p.referencia ? ` para ${p.referencia}` : ''}`);
    return p;
  });
}

function borrarProspecto(id) {
  return conCandado_(() => {
    usuarioActual_();
    if (!borrar_('Prospectos', id_(id))) throw new Error('Prospecto no encontrado');
    return true;
  });
}

// --- Usuarios (solo administradores) ---

function leerUsuario_(b) {
  const correo = String(b.correo || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new Error('Escribe un correo válido');
  if (!ROLES[b.rol]) throw new Error('Rol inválido');
  return {
    correo,
    nombre: texto_(b.nombre, 'Nombre', true),
    rol: b.rol,
    reclutador_id: entero_(b.reclutador_id, 'Reclutador', { min: 1 }),
    activo: String(b.activo) === '0' ? 0 : 1,
  };
}

const adminsActivos_ = () => leer_('Usuarios').filter(u => u.rol === 'admin' && u.activo).length;

function guardarUsuario(b, id) {
  return conCandado_(() => {
    const yo = usuarioActual_();
    requerirAdmin_(yo);
    const datos = leerUsuario_(b);
    const duplicado = leer_('Usuarios').find(u => String(u.correo).toLowerCase() === datos.correo && u.id !== Number(id));
    if (duplicado) throw new Error('Ese correo ya tiene acceso.');
    if (!id) return vistaUsuario_(buscar_('Usuarios', insertar_('Usuarios', datos)));
    const actual = buscar_('Usuarios', id_(id));
    if (!actual) throw new Error('Usuario no encontrado');
    const dejaDeSerAdmin = actual.rol === 'admin' && actual.activo && (datos.rol !== 'admin' || !datos.activo);
    if (dejaDeSerAdmin && adminsActivos_() <= 1) throw new Error('Debe quedar al menos un administrador activo');
    if (actual.id === yo.id && !datos.activo) throw new Error('No puedes desactivar tu propio usuario');
    actualizar_('Usuarios', actual.id, datos);
    return vistaUsuario_(buscar_('Usuarios', actual.id));
  });
}

function borrarUsuario(id) {
  return conCandado_(() => {
    const yo = usuarioActual_();
    requerirAdmin_(yo);
    const actual = buscar_('Usuarios', id_(id));
    if (!actual) throw new Error('Usuario no encontrado');
    if (actual.id === yo.id) throw new Error('No puedes eliminar tu propio usuario');
    if (actual.rol === 'admin' && actual.activo && adminsActivos_() <= 1) throw new Error('Debe quedar al menos un administrador activo');
    borrar_('Usuarios', actual.id);
    return true;
  });
}
