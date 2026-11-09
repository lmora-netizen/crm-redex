'use strict';

const ESTADOS = ['Contactado', 'Seguimiento documentos', 'Firma de contrato', 'Operando'];
const CLASE_ESTADO = {
  'Contactado': 'prospeccion',
  'Seguimiento documentos': 'documentacion',
  'Firma de contrato': 'cierre',
  'Operando': 'operativo',
};

// `uso` indica qué colección y campo referencian a cada elemento del catálogo
const CATALOGOS = [
  { ruta: 'clientes', titulo: 'Clientes', singular: 'cliente', uso: ['vacantes', 'cliente_id'],
    campos: [{ name: 'nombre', label: 'Nombre', required: true }, { name: 'contacto', label: 'Contacto' }, { name: 'telefono', label: 'Teléfono' }] },
  { ruta: 'localidades', titulo: 'Localidades', singular: 'localidad', uso: ['vacantes', 'localidad_id'],
    campos: [{ name: 'nombre', label: 'Nombre', required: true }, { name: 'estado', label: 'Estado' }] },
  { ruta: 'tipos-vehiculo', titulo: 'Tipos de vehículo', singular: 'tipo de vehículo', uso: ['vacantes', 'tipo_vehiculo_id'],
    campos: [{ name: 'nombre', label: 'Nombre', required: true }, { name: 'descripcion', label: 'Descripción' }] },
  { ruta: 'reclutadores', titulo: 'Reclutadores', singular: 'reclutador', uso: ['vacantes', 'reclutador_id'],
    extra: ['Ciudades', x => ciudadesDe(x.id).join(', ')],
    campos: [{ name: 'nombre', label: 'Nombre', required: true }, { name: 'email', label: 'Correo', type: 'email' }] },
];

const ICONO = {
  editar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  borrar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  ver: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM3 21c1.5-3.5 5-5 9-5s7.5 1.5 9 5"/></svg>',
};

const ROLES = { admin: 'Administrador', reclutador: 'Reclutador' };
const VISTAS = ['indicadores', 'tablero', 'pipeline', 'onboarding', 'catalogos', 'usuarios'];

const datos = {
  usuario: null,
  usuarios: [],
  vista: 'indicadores',
  etapas: [],
  agruparTablero: true,
  vistaPipeline: 'reclutador',
  cat: { clientes: [], localidades: [], 'tipos-vehiculo': [], reclutadores: [] },
  vacantes: [],
  asignaciones: [],
  onboarding: [],
  filtros: { cliente: '', localidad: '', reclutador: '', esquema: '' },
};

// --- Utilidades ---

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sumar = (lista, f) => lista.reduce((t, x) => t + ((typeof f === 'function' ? f(x) : x[f]) || 0), 0);

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoy = () => iso(new Date());
const aFecha = s => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };
const sumarDias = (s, n) => { const d = aFecha(s); d.setDate(d.getDate() + n); return iso(d); };
const diasEntre = (a, b) => Math.round((aFecha(b) - aFecha(a)) / 86400000);
const fmt = s => s ? aFecha(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtCorto = s => aFecha(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
const iniciales = nombre => String(nombre ?? '').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

const almacen = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

async function api(metodo, url, cuerpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const res = r.status === 204 ? null : await r.json().catch(() => null);
  if (r.status === 401 && !url.startsWith('/api/auth/')) mostrarAcceso();
  if (!r.ok) throw new Error(res?.error || `Error ${r.status}`);
  return res;
}

let temporizadorAviso;
function aviso(mensaje, error = false) {
  const el = $('#aviso');
  el.textContent = mensaje;
  el.className = error ? 'visible error' : 'visible';
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.className = ''; }, 3200);
}

// --- Carga y render ---

const esAdmin = () => datos.usuario?.rol === 'admin';

async function cargar() {
  const [clientes, localidades, tipos, reclutadores, vacantes, asignaciones, onboarding, usuarios, etapas] = await Promise.all([
    api('GET', '/api/clientes'), api('GET', '/api/localidades'), api('GET', '/api/tipos-vehiculo'),
    api('GET', '/api/reclutadores'), api('GET', '/api/vacantes'), api('GET', '/api/asignaciones'),
    api('GET', '/api/onboarding'), esAdmin() ? api('GET', '/api/usuarios') : [],
    api('GET', '/api/etapas'),
  ]);
  Object.assign(datos.cat, { clientes, localidades, 'tipos-vehiculo': tipos, reclutadores });
  Object.assign(datos, { vacantes, asignaciones, onboarding, usuarios, etapas });
  render();
}

function render() {
  if (datos.vista === 'usuarios' && !esAdmin()) datos.vista = 'tablero';
  $$('#pestanas [data-solo-admin]').forEach(b => { b.hidden = !esAdmin(); });
  $$('#pestanas button').forEach(b => b.classList.toggle('activo', b.dataset.vista === datos.vista));
  renderUsuarioActual();
  const vistas = { indicadores: renderIndicadores, tablero: renderTablero, pipeline: renderPipeline, onboarding: renderOnboarding, catalogos: renderCatalogos, usuarios: renderUsuarios };
  vistas[datos.vista]($('#vista'));
}

// Reclutador con el que se precargan los proveedores nuevos: el vinculado al usuario
const reclutadorActivo = () => datos.usuario?.reclutador_id ?? '';

function renderUsuarioActual() {
  const u = datos.usuario;
  $('#usuario-actual').innerHTML = `
    <span class="avatar">${esc(iniciales(u.nombre))}</span>
    <div class="usuario-datos"><strong>${esc(u.nombre)}</strong><small>${ROLES[u.rol]}</small></div>
    <button type="button" class="btn-sup" data-accion="password">Contraseña</button>
    <button type="button" class="btn-sup" data-accion="salir">Salir</button>`;
}

const opciones = ruta => datos.cat[ruta].map(x => ({ value: x.id, label: x.nombre }));

function selectFiltro(nombre, etiqueta, ruta) {
  const actual = datos.filtros[nombre];
  return `<label class="filtro"><span>${etiqueta}</span><select data-filtro="${nombre}">
    <option value="">Todos</option>
    ${datos.cat[ruta].map(x => `<option value="${x.id}" ${String(x.id) === actual ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}
  </select></label>`;
}

function kpis(lista) {
  return `<div class="kpis">${lista.map(([etiqueta, valor, nota = '', clase = '']) => `
    <div class="kpi ${clase}"><span>${etiqueta}</span><strong>${valor}</strong>${nota ? `<small>${nota}</small>` : ''}</div>`).join('')}</div>`;
}

// --- Vacantes: utilidades comunes ---

const FASES_ALTA = [
  ['solicitud_usuario', 'Solicitud de usuario'],
  ['usuario_activo', 'Usuario activo'],
  ['capacitacion_lp', 'Capacitación LP'],
  ['capacitacion_conciliacion', 'Capacitación conciliación'],
];
const SIN_RECLUTADOR = 'Todo el equipo';

const nombreReclutador = v => v.reclutador ?? SIN_RECLUTADOR;
const nombreVacante = v => `${v.cliente} · ${v.localidad} · ${v.tipo_vehiculo}`;
const dinero = n => n == null ? '—' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 });
const tarifa = v => v.tarifa_min == null && v.tarifa_max == null ? '—'
  : v.tarifa_max ? `${dinero(v.tarifa_min)} – ${dinero(v.tarifa_max)}` : dinero(v.tarifa_min);
const inicioTexto = v => v.inicio_inmediato ? 'Inmediato' : fmt(v.fecha_arranque);
const vigenciaConcluida = v => v.fecha_termino && v.fecha_termino < hoy();
const vacanteIniciada = v => v.inicio_inmediato || (v.fecha_arranque && v.fecha_arranque <= hoy());

// Ciudades donde cada reclutador tiene vacantes asignadas
function ciudadesDe(reclutadorId) {
  return [...new Set(datos.vacantes.filter(v => (v.reclutador_id ?? null) === reclutadorId).map(v => v.localidad))].sort();
}

function cobertura(v) {
  const cerr = Math.min(v.cerrados, v.cantidad);
  const proc = Math.min(v.unidades_en_proceso, v.cantidad - cerr);
  return {
    cerr, proc,
    pctCerr: cerr / v.cantidad * 100,
    pctProc: proc / v.cantidad * 100,
    faltan: v.cantidad - cerr - proc,
    efectividad: Math.round(v.cerrados / v.cantidad * 100),
  };
}

function barraCobertura(v, { leyenda = true } = {}) {
  const c = cobertura(v);
  return `<div class="barra" title="${v.cerrados} cerrados · ${c.proc} en proceso · ${c.faltan} por cubrir">
      <span class="op" style="width:${c.pctCerr}%"></span><span class="proc" style="width:${c.pctProc}%"></span>
    </div>
    ${leyenda ? `<small class="leyenda"><b>${v.cerrados}</b> cerrados · <b>${c.proc}</b> en proceso · <b>${c.faltan}</b> por cubrir</small>` : ''}`;
}

function chipArranque(v) {
  const completa = v.cerrados >= v.cantidad;
  if (vigenciaConcluida(v)) return '<span class="chip">Vigencia concluida</span>';
  if (v.inicio_inmediato) return `<span class="chip ${completa ? 'ok' : 'alerta'}">Inmediato</span>`;
  if (!v.fecha_arranque) return '<span class="chip">Sin fecha</span>';
  const d = diasEntre(hoy(), v.fecha_arranque);
  const texto = d > 0 ? `en ${plural(d, 'día', 'días')}` : d === 0 ? 'hoy' : `hace ${plural(-d, 'día', 'días')}`;
  const clase = completa ? 'ok' : d <= 0 ? 'alerta' : d <= 7 ? 'aviso' : '';
  return `<span class="chip ${clase}">${texto}</span>`;
}

function chipEfectividad(v) {
  const e = Math.round(v.cerrados / v.cantidad * 100);
  return `<span class="chip ${e >= 100 ? 'ok' : e >= 50 ? 'aviso' : 'alerta'}">${e}%</span>`;
}

// Cuatro puntos: solicitud de usuario, usuario activo y las dos capacitaciones
function puntosAlta(v) {
  return `<span class="puntos-alta">${FASES_ALTA.map(([campo, etiqueta]) => {
    const valor = v[campo];
    const clase = valor === 'Completado' ? 'hecho' : valor ? 'pendiente' : '';
    return `<i class="${clase}" title="${etiqueta}: ${esc(valor ?? 'Sin dato')}"></i>`;
  }).join('')}</span>`;
}

function valoresDistintos(campo, base = []) {
  return [...new Set([...base, ...datos.vacantes.map(v => v[campo]).filter(Boolean)])].sort();
}

function selectFiltroLista(nombre, etiqueta, valores) {
  const actual = datos.filtros[nombre];
  return `<label class="filtro"><span>${etiqueta}</span><select data-filtro="${nombre}">
    <option value="">Todos</option>
    ${valores.map(([valor, texto]) => `<option value="${esc(valor)}" ${String(valor) === actual ? 'selected' : ''}>${esc(texto)}</option>`).join('')}
  </select></label>`;
}

// Reclutadores con vacantes, en orden del catálogo, y al final las de todo el equipo
function gruposPorReclutador(lista, clave = 'reclutador_id') {
  const grupos = datos.cat.reclutadores
    .map(r => ({ id: r.id, nombre: r.nombre, items: lista.filter(x => x[clave] === r.id) }));
  grupos.push({ id: null, nombre: SIN_RECLUTADOR, items: lista.filter(x => x[clave] == null) });
  return grupos.filter(g => g.items.length);
}

// --- Tablero de vacantes ---

function filtrarVacantes() {
  const { reclutador, cliente, localidad, esquema } = datos.filtros;
  return datos.vacantes.filter(v => !vacanteCubierta(v) &&
    (!reclutador || (reclutador === 'equipo' ? v.reclutador_id == null : String(v.reclutador_id) === reclutador)) &&
    (!cliente || String(v.cliente_id) === cliente) &&
    (!localidad || String(v.localidad_id) === localidad) &&
    (!esquema || v.esquema === esquema));
}

function filaVacante(v, conReclutador) {
  return `
    <tr class="clic" data-accion="ver-vacante" data-id="${v.id}">
      ${conReclutador ? `<td>${esc(nombreReclutador(v))}</td>` : ''}
      <td><strong>${esc(v.localidad)}</strong></td>
      <td>${esc(v.cliente)}${v.notas ? `<small class="nota">${esc(v.notas)}</small>` : ''}</td>
      <td>${esc(v.tipo_vehiculo)}<small class="nota">${esc(v.esquema ?? '')}</small></td>
      <td class="nowrap">${tarifa(v)}</td>
      <td class="nowrap">${inicioTexto(v)}${v.fecha_termino ? ` – ${fmtCorto(v.fecha_termino)}` : ''}<br>${chipArranque(v)}</td>
      <td class="num"><strong>${v.cantidad}</strong></td>
      <td class="num">${v.tentativo}</td>
      <td class="num"><strong>${v.cerrados}</strong></td>
      <td class="col-efectividad">${chipEfectividad(v)}${barraCobertura(v, { leyenda: false })}</td>
      <td>${puntosAlta(v)}</td>
      <td class="acciones-fila">
        <button class="icono" data-accion="ver-vacante" data-id="${v.id}" title="Ver detalle y proveedores (${v.proveedores})">${ICONO.ver}<span class="contador">${v.proveedores}</span></button>
        <button class="icono" data-accion="editar-vacante" data-id="${v.id}" title="Editar">${ICONO.editar}</button>
        <button class="icono peligro" data-accion="borrar-vacante" data-id="${v.id}" title="Eliminar">${ICONO.borrar}</button>
      </td>
    </tr>`;
}

function tablaVacantes(lista, conReclutador) {
  return `
    <div class="tabla-scroll">
      <table class="tabla tabla-vacantes">
        <thead><tr>
          ${conReclutador ? '<th>Reclutador</th>' : ''}
          <th>Ciudad</th><th>Cliente</th><th>Vehículo / esquema</th><th>Tarifa</th><th>Vigencia</th>
          <th class="num">Objetivo</th><th class="num">Tentativo</th><th class="num">Cerrados</th><th>Efectividad</th>
          <th title="Solicitud de usuario · Usuario activo · Capacitación LP · Capacitación conciliación">Alta</th><th></th>
        </tr></thead>
        <tbody>${lista.map(v => filaVacante(v, conReclutador)).join('') || `<tr><td colspan="12" class="vacio">No hay vacantes con estos filtros.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function statsVacantes(lista) {
  const objetivo = sumar(lista, 'cantidad');
  const cerrados = sumar(lista, 'cerrados');
  return { objetivo, cerrados, tentativo: sumar(lista, 'tentativo'),
    porCubrir: sumar(lista, v => Math.max(0, v.cantidad - v.cerrados)),
    efectividad: objetivo ? Math.round(cerrados / objetivo * 100) : 0 };
}

function renderTablero(el) {
  const lista = filtrarVacantes();
  const st = statsVacantes(lista);
  const agrupar = datos.agruparTablero;

  el.innerHTML = `
    ${kpis([
      ['Vacantes', lista.length, plural(new Set(lista.map(v => v.localidad_id)).size, 'ciudad', 'ciudades')],
      ['Objetivo', st.objetivo, 'unidades'],
      ['Cerrados', st.cerrados, '', 'verde'],
      ['Tentativo de cierre', st.tentativo, '', 'ambar'],
      ['Por cubrir', st.porCubrir, 'unidades', 'rojo'],
      ['Efectividad', `${st.efectividad}%`],
    ])}
    <section class="panel">
      <div class="panel-cab">
        <div>
          <h2>Capacidad por reclutador y ciudad</h2>
          <p class="sub">Vacantes por cubrir. Haz clic en una para ver su detalle y sus proveedores.
            ${datos.vacantes.some(vacanteCubierta) ? `<button class="enlace" data-ir="onboarding">${plural(datos.vacantes.filter(vacanteCubierta).length, 'vacante cubierta pasó', 'vacantes cubiertas pasaron')} a Onboarding →</button>` : ''}</p>
        </div>
        <div class="acciones">
          ${selectFiltroLista('reclutador', 'Reclutador', [...datos.cat.reclutadores.map(r => [r.id, r.nombre]), ['equipo', SIN_RECLUTADOR]])}
          ${selectFiltro('cliente', 'Cliente', 'clientes')}
          ${selectFiltro('localidad', 'Ciudad', 'localidades')}
          ${selectFiltroLista('esquema', 'Esquema', valoresDistintos('esquema').map(e => [e, e]))}
          <div class="segmentado" role="group" aria-label="Agrupar">
            <button data-agrupar="1" class="${agrupar ? 'activo' : ''}">Por reclutador</button>
            <button data-agrupar="0" class="${agrupar ? '' : 'activo'}">Lista</button>
          </div>
          <button class="btn primario" data-accion="nueva-vacante">+ Nueva vacante</button>
        </div>
      </div>
      ${agrupar ? '' : tablaVacantes(lista, true)}
    </section>
    ${agrupar ? gruposPorReclutador(lista).map(g => {
      const s = statsVacantes(g.items);
      const ciudades = [...new Set(g.items.map(v => v.localidad))].sort();
      return `
        <section class="panel grupo">
          <div class="grupo-cab">
            <span class="avatar grande">${esc(g.id ? iniciales(g.nombre) : '★')}</span>
            <div class="grupo-titulo">
              <h2>${esc(g.nombre)}</h2>
              <div class="ciudades">${ciudades.map(c => `<span class="ciudad">${esc(c)}</span>`).join('')}</div>
            </div>
            <div class="grupo-stats">
              <div><strong>${g.items.length}</strong><span>vacantes</span></div>
              <div><strong>${s.objetivo}</strong><span>objetivo</span></div>
              <div><strong>${s.cerrados}</strong><span>cerrados</span></div>
              <div><strong>${s.porCubrir}</strong><span>por cubrir</span></div>
              <div><strong class="${s.efectividad >= 100 ? 'txt-ok' : s.efectividad >= 50 ? 'txt-aviso' : 'txt-alerta'}">${s.efectividad}%</strong><span>efectividad</span></div>
            </div>
          </div>
          ${tablaVacantes(g.items, false)}
        </section>`;
    }).join('') || '<section class="panel"><p class="vacio">No hay vacantes con estos filtros.</p></section>' : ''}`;

  el.onchange = e => {
    const f = e.target.dataset.filtro;
    if (f) { datos.filtros[f] = e.target.value; render(); }
  };
  el.onclick = e => {
    const ir = e.target.closest('[data-ir]');
    if (ir) { datos.vista = ir.dataset.ir; return render(); }
    const seg = e.target.closest('[data-agrupar]');
    if (seg) {
      datos.agruparTablero = seg.dataset.agrupar === '1';
      almacen.set('agruparTablero', seg.dataset.agrupar);
      return render();
    }
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const v = datos.vacantes.find(x => x.id === Number(b.dataset.id));
    if (b.dataset.accion === 'nueva-vacante') formVacante();
    if (b.dataset.accion === 'ver-vacante') verVacante(v.id);
    if (b.dataset.accion === 'editar-vacante') formVacante(v);
    if (b.dataset.accion === 'borrar-vacante') {
      eliminar(`/api/vacantes/${v.id}`,
        `¿Eliminar la vacante ${nombreVacante(v)}? También se eliminarán sus ${plural(v.proveedores, 'proveedor asignado', 'proveedores asignados')}.`,
        'Vacante eliminada');
    }
  };
}

function formVacante(v, despues) {
  const opcionesAlta = campo => {
    const base = ['Pendiente', 'Completado'];
    if (v?.[campo] && !base.includes(v[campo])) base.push(v[campo]);
    return base.map(x => ({ value: x, label: x }));
  };
  abrirFormulario({
    titulo: v ? `Editar vacante · ${nombreVacante(v)}` : 'Nueva vacante',
    ancho: true,
    valores: v ?? { cantidad: 1, tentativo: 0, cerrados: 0, esquema: 'Temporada', fecha_arranque: hoy() },
    campos: [
      { seccion: 'Vacante' },
      { name: 'reclutador_id', label: 'Reclutador asignado', type: 'select', vacio: SIN_RECLUTADOR, opciones: opciones('reclutadores') },
      { name: 'localidad_id', label: 'Ciudad / localidad', type: 'select', required: true, opciones: opciones('localidades') },
      { name: 'cliente_id', label: 'Cliente', type: 'select', required: true, opciones: opciones('clientes') },
      { name: 'tipo_vehiculo_id', label: 'Tipo de vehículo', type: 'select', required: true, opciones: opciones('tipos-vehiculo') },
      { name: 'esquema', label: 'Esquema', type: 'select', opciones: valoresDistintos('esquema', ['Temporada', 'SDD', 'Spot']).map(e => ({ value: e, label: e })) },
      { name: 'cantidad', label: 'Objetivo (unidades)', type: 'number', min: 1, required: true },
      { name: 'tentativo', label: 'Tentativo de cierre', type: 'number', min: 0 },
      { name: 'cerrados', label: 'Cerrados', type: 'number', min: 0 },
      { seccion: 'Tarifa y operación' },
      { name: 'tarifa_min', label: 'Tarifa mínima ($)', type: 'number', min: 0, step: '0.01' },
      { name: 'tarifa_max', label: 'Tarifa máxima ($)', type: 'number', min: 0, step: '0.01' },
      { name: 'km_diario', label: 'Km diario por unidad' },
      { name: 'tipo_ruta', label: 'Tipo de ruta' },
      { name: 'horario', label: 'Horario laboral (hrs)' },
      { name: 'dias_operacion', label: 'Días de operación', type: 'number', min: 0 },
      { name: 'direccion_origen', label: 'Dirección origen', type: 'textarea', ancho: true },
      { seccion: 'Vigencia' },
      { name: 'fecha_arranque', label: 'Inicio de vigencia', type: 'date' },
      { name: 'fecha_termino', label: 'Término de vigencia', type: 'date' },
      { name: 'inicio_inmediato', label: 'Inicio inmediato', type: 'checkbox' },
      { seccion: 'Seguimiento' },
      { name: 'notas', label: 'Comentarios', type: 'textarea', ancho: true },
      { name: 'seguimiento', label: 'Seguimiento proveedor', type: 'textarea', ancho: true },
      { seccion: 'Alta y capacitación' },
      ...FASES_ALTA.map(([name, label]) => ({ name, label, type: 'select', vacio: '—', opciones: opcionesAlta(name) })),
    ],
    guardar: d => v ? api('PUT', `/api/vacantes/${v.id}`, d) : api('POST', '/api/vacantes', d),
    exito: v ? 'Vacante actualizada' : 'Vacante creada',
    despues,
  });
}

function verVacante(id) {
  const v = datos.vacantes.find(x => x.id === id);
  if (!v) return;
  const asignados = datos.asignaciones.filter(a => a.vacante_id === id);
  const volver = () => verVacante(id);
  const dato = (etiqueta, valor) => `<div class="dato"><span>${etiqueta}</span><strong>${valor || '<span class="tenue">—</span>'}</strong></div>`;
  const modal = $('#modal');
  modal.innerHTML = `
    <div class="formulario detalle">
      <header>
        <div>
          <h3>${esc(v.cliente)} · ${esc(v.localidad)}</h3>
          <p class="sub">${esc(v.tipo_vehiculo)} · ${esc(v.esquema ?? '')} · Reclutador: <b>${esc(nombreReclutador(v))}</b> · ${chipArranque(v)}</p>
        </div>
        <button type="button" class="cerrar" aria-label="Cerrar">×</button>
      </header>
      <div class="cuerpo">
        <div class="cifras">
          <div><strong>${v.cantidad}</strong><span>Objetivo</span></div>
          <div><strong>${v.tentativo}</strong><span>Tentativo</span></div>
          <div><strong>${v.cerrados}</strong><span>Cerrados</span></div>
          <div>${chipEfectividad(v)}<span>Efectividad</span></div>
        </div>
        ${barraCobertura(v)}
        <div class="datos-grid">
          ${dato('Tarifa', tarifa(v))}
          ${dato('Vigencia', `${inicioTexto(v)}${v.fecha_termino ? ` – ${fmt(v.fecha_termino)}` : ''}`)}
          ${dato('Días de operación', v.dias_operacion ?? '')}
          ${dato('Km diario', esc(v.km_diario ?? ''))}
          ${dato('Tipo de ruta', esc(v.tipo_ruta ?? ''))}
          ${dato('Horario', esc(v.horario ?? ''))}
        </div>
        ${dato('Dirección origen', esc(v.direccion_origen ?? '').replace(/\n/g, '<br>'))}
        <div class="datos-grid dos">
          ${dato('Comentarios', esc(v.notas ?? '').replace(/\n/g, '<br>'))}
          ${dato('Seguimiento proveedor', esc(v.seguimiento ?? '').replace(/\n/g, '<br>'))}
        </div>
        <div class="alta-lista">
          ${FASES_ALTA.map(([campo, etiqueta]) => `<span class="chip ${v[campo] === 'Completado' ? 'ok' : v[campo] ? 'aviso' : ''}">${etiqueta}: ${esc(v[campo] ?? 'Sin dato')}</span>`).join('')}
        </div>
        <h4 class="seccion-form">Proveedores en pipeline</h4>
        <table class="tabla compacta">
          <thead><tr><th>Proveedor</th><th>Reclutador</th><th class="num">Unidades</th><th>Disponibilidad</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${asignados.map(a => `
              <tr>
                <td><strong>${esc(a.proveedor)}</strong>${a.notas ? `<small class="nota">${esc(a.notas)}</small>` : ''}</td>
                <td>${esc(a.reclutador)}</td>
                <td class="num">${a.unidades}</td>
                <td>${fmt(a.fecha_disponibilidad)}</td>
                <td><span class="estado ${CLASE_ESTADO[a.estado]}">${a.estado}</span></td>
                <td class="acciones-fila">
                  <button class="icono" data-accion="editar" data-id="${a.id}" title="Editar">${ICONO.editar}</button>
                  <button class="icono peligro" data-accion="borrar" data-id="${a.id}" title="Eliminar">${ICONO.borrar}</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="6" class="vacio">Aún no hay proveedores registrados en el pipeline para esta vacante.</td></tr>'}
          </tbody>
        </table>
      </div>
      <footer>
        <button type="button" class="btn" data-accion="editar-vacante">Editar vacante</button>
        <button type="button" class="btn primario" data-accion="agregar">+ Asignar proveedor</button>
      </footer>
    </div>`;
  const cont = modal.firstElementChild;
  cont.onclick = e => {
    if (e.target.closest('.cerrar')) return modal.close();
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const a = datos.asignaciones.find(x => x.id === Number(b.dataset.id));
    if (b.dataset.accion === 'editar-vacante') formVacante(v, volver);
    if (b.dataset.accion === 'agregar') formAsignacion(null, { vacanteId: id, despues: volver });
    if (b.dataset.accion === 'editar') formAsignacion(a, { despues: volver });
    if (b.dataset.accion === 'borrar') eliminar(`/api/asignaciones/${a.id}`, `¿Quitar a ${a.proveedor} de esta vacante?`, 'Proveedor eliminado', volver);
  };
  if (!modal.open) modal.showModal();
}

// --- Indicadores generales ---

const vacanteCubierta = v => v.cerrados >= v.cantidad;

// Agrupa vacantes por una clave y suma objetivo y cerrados (los cerrados no pasan del objetivo)
function sumarPor(lista, clave) {
  const mapa = new Map();
  for (const v of lista) {
    const k = clave(v);
    const g = mapa.get(k) ?? { nombre: k, objetivo: 0, cerrados: 0, vacantes: 0 };
    g.objetivo += v.cantidad;
    g.cerrados += Math.min(v.cerrados, v.cantidad);
    g.vacantes += 1;
    mapa.set(k, g);
  }
  return [...mapa.values()].sort((a, b) => b.objetivo - a.objetivo);
}

// Barra de avance: la pista gris es el objetivo y el relleno, lo cerrado
function barrasAvance(grupos) {
  return `<div class="avance-lista">${grupos.map(g => {
    const pct = g.objetivo ? Math.round(g.cerrados / g.objetivo * 100) : 0;
    return `
      <div class="avance-fila" data-tip="${esc(g.nombre)}: ${g.cerrados} de ${g.objetivo} unidades cerradas (${pct}%) · ${plural(g.vacantes, 'vacante', 'vacantes')}">
        <span class="avance-nombre">${esc(g.nombre)}</span>
        <span class="avance-pista"><i style="width:${pct}%"></i></span>
        <span class="avance-valor"><b>${g.cerrados}</b> / ${g.objetivo} · ${pct}%</span>
      </div>`;
  }).join('')}</div>`;
}

// Escala secuencial de un solo tono (rojo BDB): más oscuro = más cubierto
const ESCALA_COBERTURA = ['#fbeceb', '#f4c3bd', '#e98c82', '#d2392d', '#9e2a21'];
const tonoCobertura = pct => ESCALA_COBERTURA[Math.min(4, Math.floor(pct / 25))];

function matrizCliente(cliente, lista) {
  const ciudades = [...new Set(lista.map(v => v.localidad))].sort();
  const tipos = [...new Set(lista.map(v => v.tipo_vehiculo))].sort();
  const celda = (ciudad, tipo) => {
    const vs = lista.filter(v => v.localidad === ciudad && v.tipo_vehiculo === tipo);
    if (!vs.length) return '<td class="celda-vacia"></td>';
    const objetivo = sumar(vs, 'cantidad');
    const cerrados = sumar(vs, v => Math.min(v.cerrados, v.cantidad));
    const pct = Math.round(cerrados / objetivo * 100);
    const oscuro = pct >= 75;
    return `<td class="celda" style="background:${tonoCobertura(pct)};color:${oscuro ? '#fff' : 'var(--texto)'}"
      data-tip="${esc(cliente)} · ${esc(ciudad)} · ${esc(tipo)}: ${cerrados} de ${objetivo} unidades (${pct}%)">${cerrados}/${objetivo}</td>`;
  };
  const cubiertas = ciudades.filter(c => lista.filter(v => v.localidad === c).every(vacanteCubierta)).length;
  return `
    <section class="panel matriz-panel">
      <div class="panel-cab">
        <h2>${esc(cliente)}</h2>
        <span class="sub">${cubiertas} de ${plural(ciudades.length, 'ciudad cubierta', 'ciudades cubiertas')}</span>
      </div>
      <div class="tabla-scroll">
        <table class="matriz">
          <thead><tr><th>Ciudad</th>${tipos.map(t => `<th>${esc(t)}</th>`).join('')}</tr></thead>
          <tbody>${ciudades.map(c => `<tr><th>${esc(c)}</th>${tipos.map(t => celda(c, t)).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </section>`;
}

function renderIndicadores(el) {
  const todas = datos.vacantes;
  const cubiertas = todas.filter(vacanteCubierta);
  const objetivo = sumar(todas, 'cantidad');
  const cerrados = sumar(todas, v => Math.min(v.cerrados, v.cantidad));
  const ciudades = sumarPor(todas, v => v.localidad);
  const porEtapa = ESTADOS.map(e => ({ etapa: e, items: datos.asignaciones.filter(a => a.estado === e) }));
  const maxEtapa = Math.max(1, ...porEtapa.map(e => e.items.length));
  const clientes = [...new Set(todas.map(v => v.cliente))].sort();

  el.innerHTML = `
    ${kpis([
      ['Vacantes activas', todas.length - cubiertas.length, 'en el Tablero'],
      ['Vacantes cubiertas', cubiertas.length, 'en Onboarding', 'verde'],
      ['Objetivo', objetivo, 'unidades'],
      ['Cerrados', cerrados, 'unidades', 'verde'],
      ['Efectividad', `${objetivo ? Math.round(cerrados / objetivo * 100) : 0}%`],
      ['Ciudades cubiertas', `${ciudades.filter(c => c.cerrados >= c.objetivo).length} / ${ciudades.length}`],
    ])}
    <div class="rejilla-graficas">
      <section class="panel">
        <div class="panel-cab"><div><h2>Avance por cliente</h2><p class="sub">Unidades cerradas contra el objetivo</p></div></div>
        ${barrasAvance(sumarPor(todas, v => v.cliente))}
      </section>
      <section class="panel">
        <div class="panel-cab"><div><h2>Avance por tipo de unidad</h2><p class="sub">Unidades cerradas contra el objetivo</p></div></div>
        ${barrasAvance(sumarPor(todas, v => v.tipo_vehiculo))}
      </section>
      <section class="panel">
        <div class="panel-cab"><div><h2>Proveedores por etapa de contratación</h2><p class="sub">Cuántos proveedores hay en cada etapa</p></div></div>
        <div class="avance-lista">${porEtapa.map(e => `
          <div class="avance-fila" data-tip="${e.etapa}: ${plural(e.items.length, 'proveedor', 'proveedores')}, ${sumar(e.items, 'unidades')} unidades">
            <span class="avance-nombre">${e.etapa}</span>
            <span class="avance-pista sin-pista"><i style="width:${e.items.length / maxEtapa * 100}%"></i></span>
            <span class="avance-valor"><b>${e.items.length}</b> · ${sumar(e.items, 'unidades')} u.</span>
          </div>`).join('')}</div>
      </section>
      <section class="panel">
        <div class="panel-cab"><div><h2>Avance por reclutador</h2><p class="sub">Unidades cerradas contra el objetivo</p></div></div>
        ${barrasAvance(sumarPor(todas, nombreReclutador))}
      </section>
    </div>
    <div class="titulo-seccion">
      <h2>Ciudades cubiertas por cliente y tipo de unidad</h2>
      <div class="leyenda-escala" aria-label="Escala de cobertura">
        <span>0%</span>${ESCALA_COBERTURA.map(c => `<i style="background:${c}"></i>`).join('')}<span>100%</span>
        <small>Cada celda: unidades cerradas / objetivo</small>
      </div>
    </div>
    <div class="rejilla-matrices">${clientes.map(c => matrizCliente(c, todas.filter(v => v.cliente === c))).join('')}</div>`;

  el.onchange = null;
  el.onclick = null;
}

// Información al pasar el cursor sobre barras y celdas
const tooltip = document.createElement('div');
tooltip.className = 'tooltip';
document.body.appendChild(tooltip);
document.addEventListener('mouseover', e => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) { tooltip.classList.remove('visible'); return; }
  tooltip.textContent = t.dataset.tip;
  tooltip.classList.add('visible');
});
document.addEventListener('mousemove', e => {
  if (!tooltip.classList.contains('visible')) return;
  const x = Math.min(e.clientX + 14, window.innerWidth - tooltip.offsetWidth - 8);
  tooltip.style.transform = `translate(${x}px, ${e.clientY + 16}px)`;
});

// --- Etapas de contratación ---

function formAsignacion(a, { vacanteId, despues } = {}) {
  const vacante = datos.vacantes.find(v => v.id === vacanteId);
  abrirFormulario({
    titulo: a ? 'Editar proveedor' : 'Asignar proveedor',
    valores: a ?? {
      vacante_id: vacanteId, reclutador_id: reclutadorActivo() || vacante?.reclutador_id || '',
      unidades: 1, fecha_disponibilidad: hoy(), estado: 'Contactado',
    },
    campos: [
      { name: 'vacante_id', label: 'Vacante', type: 'select', required: true, ancho: true,
        opciones: datos.vacantes.map(v => ({ value: v.id, label: `${nombreReclutador(v)} · ${nombreVacante(v)} (${v.cantidad} u.)` })) },
      { name: 'proveedor', label: 'Proveedor', required: true },
      { name: 'reclutador_id', label: 'Reclutador', type: 'select', required: true, opciones: opciones('reclutadores') },
      { name: 'unidades', label: 'Cantidad de unidades', type: 'number', min: 1, required: true },
      { name: 'fecha_disponibilidad', label: 'Fecha de disponibilidad', type: 'date', required: true },
      { name: 'estado', label: 'Etapa', type: 'select', required: true, opciones: ESTADOS.map(e => ({ value: e, label: e })) },
      { name: 'notas', label: 'Notas', type: 'textarea' },
    ],
    guardar: d => a ? api('PUT', `/api/asignaciones/${a.id}`, d) : api('POST', '/api/asignaciones', d),
    exito: a ? 'Proveedor actualizado' : 'Proveedor asignado',
    despues,
  });
}

async function cambiarEstado(id, nuevo) {
  const a = datos.asignaciones.find(x => x.id === id);
  if (!a || a.estado === nuevo) return;
  try {
    await api('PUT', `/api/asignaciones/${id}`, { ...a, estado: nuevo });
    aviso(nuevo === 'Operando' ? `${a.proveedor} pasó a Operando: se sumó a cerrados y entró a onboarding` : `${a.proveedor} → ${nuevo}`);
    await cargar();
  } catch (err) {
    aviso(err.message, true);
  }
}

// Tiempos: cada tramo dice cuándo entró y salió un proveedor de una etapa
const aMomento = s => new Date(s.length === 10 ? `${s}T00:00:00` : s.replace(' ', 'T'));
const duracionDias = (desde, hasta) => Math.max(0, ((hasta ? aMomento(hasta) : new Date()) - aMomento(desde)) / 86400000);
const promedio = nums => nums.length ? nums.reduce((x, y) => x + y, 0) / nums.length : null;
const fmtDias = d => d == null ? '—' : d < 1 ? `${Math.round(d * 24)} h` : `${(Math.round(d * 10) / 10).toLocaleString('es-MX')} d`;

function metricasEtapas(ids) {
  const tramos = datos.etapas.filter(t => !ids || ids.has(t.asignacion_id));
  const porEtapa = Object.fromEntries(ESTADOS.map(e => {
    const deEtapa = tramos.filter(t => t.etapa === e);
    return [e, {
      cerrado: promedio(deEtapa.filter(t => t.hasta).map(t => duracionDias(t.desde, t.hasta))),
      actual: promedio(deEtapa.filter(t => !t.hasta).map(t => duracionDias(t.desde))),
      tramos: deEtapa.filter(t => t.hasta).length,
    }];
  }));
  // Ciclo: del primer tramo registrado a la entrada a Operando (solo si pasó por otra etapa)
  const ciclos = [];
  for (const id of new Set(tramos.map(t => t.asignacion_id))) {
    const suyos = tramos.filter(t => t.asignacion_id === id);
    const operando = suyos.find(t => t.etapa === 'Operando');
    if (operando && suyos[0] !== operando) ciclos.push(duracionDias(suyos[0].desde, operando.desde));
  }
  return { porEtapa, ciclo: promedio(ciclos), ciclos: ciclos.length };
}

const diasEnEtapa = a => a.etapa_desde ? duracionDias(a.etapa_desde) : null;

function tarjeta(a) {
  const enEtapa = diasEnEtapa(a);
  const clase = a.estado === 'Operando' ? 'ok' : enEtapa >= 7 ? 'alerta' : enEtapa >= 3 ? 'aviso' : '';
  return `
    <article class="tarjeta" draggable="true" data-id="${a.id}">
      <div class="tarjeta-cab"><strong>${esc(a.proveedor)}</strong>
        ${enEtapa != null ? `<span class="dias ${clase}" title="Tiempo en la etapa actual">${fmtDias(enEtapa)}</span>` : ''}</div>
      <span class="meta">${esc(a.cliente)} · ${esc(a.localidad)}</span>
      <span class="meta">${esc(a.tipo_vehiculo)}</span>
      <div class="pie">
        <span class="pastilla">${a.unidades} u.</span>
        <span class="reclutador-tarjeta"><span class="avatar">${esc(iniciales(a.reclutador))}</span>${esc(a.reclutador)}</span>
      </div>
      <select class="mover" data-id="${a.id}" aria-label="Cambiar etapa de ${esc(a.proveedor)}">
        ${ESTADOS.map(e => `<option ${e === a.estado ? 'selected' : ''}>${e}</option>`).join('')}
      </select>
    </article>`;
}

function columnasKanban(lista, compacto = false) {
  return `
    <div class="kanban ${compacto ? 'compacto' : ''}">
      ${ESTADOS.map(e => {
        const items = lista.filter(a => a.estado === e);
        return `
          <section class="columna ${CLASE_ESTADO[e]}" data-estado="${e}">
            <header><h3>${e}</h3><span>${items.length} · ${sumar(items, 'unidades')} u.</span></header>
            <div class="tarjetas">${items.map(tarjeta).join('') || '<p class="vacio">Sin proveedores</p>'}</div>
          </section>`;
      }).join('')}
    </div>`;
}

// Las cuatro etapas, siempre visibles, con cuántos hay y cuánto tardan
function pasosEtapas(lista) {
  const m = metricasEtapas(new Set(lista.map(a => a.id)));
  const masLento = lista.filter(a => a.estado !== 'Operando').sort((x, y) => (diasEnEtapa(y) ?? 0) - (diasEnEtapa(x) ?? 0))[0];
  return `
    <section class="panel etapas-panel">
      <ol class="pasos">
        ${ESTADOS.map((e, i) => {
          const items = lista.filter(a => a.estado === e);
          const t = m.porEtapa[e];
          const tiempo = e === 'Operando'
            ? 'Etapa final'
            : t.cerrado != null ? `Tarda ${fmtDias(t.cerrado)} en promedio` : t.actual != null ? `Llevan ${fmtDias(t.actual)} en promedio` : 'Sin datos aún';
          return `
            <li class="paso ${CLASE_ESTADO[e]}">
              <span class="paso-num">${i + 1}</span>
              <div class="paso-texto">
                <span class="paso-nombre">${e}</span>
                <strong>${items.length}</strong>
                <small>${sumar(items, 'unidades')} unidades</small>
                <small class="paso-tiempo">${tiempo}</small>
              </div>
            </li>`;
        }).join('')}
      </ol>
      <div class="ciclo">
        <div><span>Tiempo promedio hasta Operando</span><strong>${fmtDias(m.ciclo)}</strong>
          <small>${m.ciclos ? `de Contactado a Operando · ${plural(m.ciclos, 'proveedor', 'proveedores')}` : 'Se mide desde que se registra el proveedor hasta que pasa a Operando'}</small></div>
        <div><span>En proceso</span><strong>${lista.filter(a => a.estado !== 'Operando').length}</strong><small>proveedores aún no operan</small></div>
        <div><span>Más tiempo en su etapa</span><strong>${masLento ? fmtDias(diasEnEtapa(masLento)) : '—'}</strong>
          <small>${masLento ? `${esc(masLento.proveedor)} · ${masLento.estado}` : ''}</small></div>
      </div>
    </section>`;
}

function renderPipeline(el) {
  const { reclutador, cliente } = datos.filtros;
  const lista = datos.asignaciones.filter(a => (!reclutador || String(a.reclutador_id) === reclutador) && (!cliente || String(a.cliente_id) === cliente));
  const porReclutador = datos.vistaPipeline === 'reclutador';

  el.innerHTML = `
    <section class="panel">
      <div class="panel-cab">
        <div>
          <h2>Etapas de contratación</h2>
          <p class="sub">Contactado → Seguimiento documentos → Firma de contrato → Operando. Arrastra una tarjeta o usa el selector para cambiar de etapa; el tiempo se mide en cada cambio.</p>
        </div>
        <div class="acciones">
          ${selectFiltro('reclutador', 'Reclutador', 'reclutadores')}
          ${selectFiltro('cliente', 'Cliente', 'clientes')}
          <div class="segmentado" role="group" aria-label="Vista">
            <button data-vista-pipeline="reclutador" class="${porReclutador ? 'activo' : ''}">Por reclutador</button>
            <button data-vista-pipeline="junto" class="${porReclutador ? '' : 'activo'}">Todo junto</button>
          </div>
          <button class="btn primario" data-accion="nuevo">+ Asignar proveedor</button>
        </div>
      </div>
    </section>
    ${pasosEtapas(lista)}
    ${porReclutador
      ? gruposPorReclutador(lista).map(g => {
        const m = metricasEtapas(new Set(g.items.map(a => a.id)));
        return `
          <section class="panel carril">
            <div class="carril-cab">
              <span class="avatar grande">${esc(iniciales(g.nombre))}</span>
              <div>
                <h2>${esc(g.nombre)}</h2>
                <small>${ciudadesDe(g.id).join(' · ') || 'Sin ciudades asignadas'}</small>
              </div>
              <div class="carril-stats">
                ${ESTADOS.map(e => `<span>${e}: <b>${g.items.filter(a => a.estado === e).length}</b></span>`).join('')}
                <span class="destacado">Hasta Operando <b>${fmtDias(m.ciclo)}</b></span>
              </div>
            </div>
            ${columnasKanban(g.items, true)}
          </section>`;
      }).join('') || '<section class="panel"><p class="vacio">Aún no hay proveedores. Usa «+ Asignar proveedor» o ábrelos desde una vacante del Tablero.</p></section>'
      : columnasKanban(lista)}`;

  const limpiar = () => $$('.columna.sobre').forEach(c => c.classList.remove('sobre'));
  el.onchange = e => {
    if (e.target.dataset.filtro) { datos.filtros[e.target.dataset.filtro] = e.target.value; render(); }
    if (e.target.matches('.mover')) cambiarEstado(Number(e.target.dataset.id), e.target.value);
  };
  el.onclick = e => {
    const vista = e.target.closest('[data-vista-pipeline]');
    if (vista) {
      datos.vistaPipeline = vista.dataset.vistaPipeline;
      almacen.set('vistaPipeline', datos.vistaPipeline);
      return render();
    }
    if (e.target.closest('[data-accion="nuevo"]')) return formAsignacion();
    const t = e.target.closest('.tarjeta');
    if (t && !e.target.closest('.mover')) formAsignacion(datos.asignaciones.find(a => a.id === Number(t.dataset.id)));
  };
  el.ondragstart = e => {
    const t = e.target.closest?.('.tarjeta');
    if (!t) return;
    e.dataTransfer.setData('text/plain', t.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    t.classList.add('arrastrando');
  };
  el.ondragend = e => { e.target.closest?.('.tarjeta')?.classList.remove('arrastrando'); limpiar(); };
  el.ondragover = e => {
    const col = e.target.closest('.columna');
    if (!col) return;
    e.preventDefault();
    if (!col.classList.contains('sobre')) { limpiar(); col.classList.add('sobre'); }
  };
  el.ondrop = e => {
    const col = e.target.closest('.columna');
    if (!col) return;
    e.preventDefault();
    limpiar();
    cambiarEstado(Number(e.dataTransfer.getData('text/plain')), col.dataset.estado);
  };
}

// --- Onboarding ---

function semana(o, n) {
  const inicio = sumarDias(o.fecha_ingreso, (n - 1) * 7);
  const fin = sumarDias(inicio, 6);
  const h = hoy();
  const [texto, clase] = o[`s${n}_calificacion`] != null ? ['Evaluada', 'ok']
    : h < inicio ? ['Próxima', '']
    : h <= fin ? ['En curso', 'info']
    : ['Por evaluar', 'aviso'];
  return { inicio, fin, texto, clase };
}

function celdaSemana(o, n) {
  const s = semana(o, n);
  const p = `s${n}_`;
  return `
    <div class="semana">
      <div class="semana-cab">
        <span>${fmtCorto(s.inicio)} – ${fmtCorto(s.fin)}</span>
        <span class="chip ${s.clase}" data-semana="${n}">${s.texto}</span>
      </div>
      <div class="semana-campos">
        <label><span>Rendimiento (% cumplimiento)</span>
          <input type="number" name="${p}rendimiento" min="0" max="100" placeholder="0–100" value="${o[p + 'rendimiento'] ?? ''}"></label>
        <label><span>Evaluación</span>
          <select name="${p}calificacion">
            <option value="">Sin evaluar</option>
            ${[5, 4, 3, 2, 1].map(c => `<option value="${c}" ${o[p + 'calificacion'] === c ? 'selected' : ''}>${'★'.repeat(c)}${'☆'.repeat(5 - c)} ${c}</option>`).join('')}
          </select></label>
      </div>
      <textarea name="${p}comentario" rows="2" placeholder="Comentarios de la semana…">${esc(o[p + 'comentario'])}</textarea>
    </div>`;
}

function kpisOnboarding() {
  const lista = datos.onboarding;
  const promedio = campo => {
    const vals = lista.map(o => o[campo]).filter(v => v != null);
    return vals.length ? `${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)}%` : '—';
  };
  const pendientes = lista.reduce((t, o) => t + [1, 2].filter(n => semana(o, n).texto === 'Por evaluar').length, 0);
  return kpis([
    ['Proveedores en onboarding', lista.length, plural(sumar(lista, 'unidades'), 'unidad', 'unidades')],
    ['Rendimiento promedio S1', promedio('s1_rendimiento')],
    ['Rendimiento promedio S2', promedio('s2_rendimiento')],
    ['Semanas por evaluar', pendientes, '', pendientes ? 'ambar' : 'verde'],
  ]);
}

function renderOnboarding(el) {
  const { reclutador } = datos.filtros;
  const lista = datos.onboarding.filter(o => !reclutador || String(o.reclutador_id) === reclutador);
  const cubiertas = datos.vacantes.filter(vacanteCubierta);
  el.innerHTML = `
    <div id="kpis-onboarding">${kpisOnboarding()}</div>
    <section class="panel">
      <div class="panel-cab">
        <div>
          <h2>Vacantes cubiertas <span class="cuenta">${cubiertas.length}</span></h2>
          <p class="sub">Al completar su objetivo, la vacante sale del Tablero y sus proveedores siguen aquí sus dos primeras semanas.</p>
        </div>
      </div>
      <div class="cubiertas">
        ${cubiertas.map(v => {
          const operando = datos.asignaciones.filter(a => a.vacante_id === v.id && a.estado === 'Operando');
          return `
            <article class="cubierta" data-vacante="${v.id}">
              <div class="cubierta-cab"><strong>${esc(v.cliente)} · ${esc(v.localidad)}</strong><span class="chip ok">${v.cerrados}/${v.cantidad}</span></div>
              <span class="meta">${esc(v.tipo_vehiculo)} · ${esc(nombreReclutador(v))} · inicio ${inicioTexto(v)}</span>
              <div class="cubierta-prov">${operando.map(a => `<span class="ciudad">${esc(a.proveedor)} · ${a.unidades} u.</span>`).join('') || '<span class="tenue">Sin proveedores registrados</span>'}</div>
            </article>`;
        }).join('') || '<p class="vacio">Aún no hay vacantes cubiertas.</p>'}
      </div>
    </section>
    <section class="panel">
      <div class="panel-cab">
        <div>
          <h2>Onboarding · primeras dos semanas</h2>
          <p class="sub">Proveedores en Operando. Los cambios se guardan automáticamente.</p>
        </div>
        <div class="acciones">${selectFiltro('reclutador', 'Reclutador', 'reclutadores')}</div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla onboarding">
          <thead><tr><th>Proveedor</th><th>Semana 1</th><th>Semana 2</th></tr></thead>
          <tbody>
            ${lista.map(o => `
              <tr data-id="${o.asignacion_id}">
                <td class="prov">
                  <strong>${esc(o.proveedor)}</strong>
                  <span class="meta">${esc(o.cliente)} · ${esc(o.localidad)}</span>
                  <span class="meta">${esc(o.tipo_vehiculo)} · ${plural(o.unidades, 'unidad', 'unidades')}</span>
                  <span class="meta">Reclutador: ${esc(o.reclutador)}</span>
                  <label class="mini"><span>Fecha de ingreso</span><input type="date" name="fecha_ingreso" value="${o.fecha_ingreso}" required></label>
                </td>
                <td>${celdaSemana(o, 1)}</td>
                <td>${celdaSemana(o, 2)}</td>
              </tr>`).join('') || '<tr><td colspan="3" class="vacio">Ningún proveedor ha llegado a Operando todavía.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>`;

  el.onclick = e => {
    const c = e.target.closest('[data-vacante]');
    if (c) verVacante(Number(c.dataset.vacante));
  };
  el.onchange = async e => {
    if (e.target.dataset.filtro) { datos.filtros.reclutador = e.target.value; return render(); }
    const fila = e.target.closest('tr[data-id]');
    if (!fila) return;
    const id = Number(fila.dataset.id);
    const cuerpo = Object.fromEntries($$(`tr[data-id="${id}"] [name]`).map(i => [i.name, i.value]));
    try {
      const o = await api('PUT', `/api/onboarding/${id}`, cuerpo);
      datos.onboarding[datos.onboarding.findIndex(x => x.asignacion_id === id)] = o;
      // Actualiza solo los indicadores para no perder el foco del campo siguiente
      if (e.target.name === 'fecha_ingreso') render();
      else {
        for (const n of [1, 2]) {
          const s = semana(o, n);
          const chip = fila.querySelector(`.chip[data-semana="${n}"]`);
          chip.textContent = s.texto;
          chip.className = `chip ${s.clase}`;
        }
        $('#kpis-onboarding').innerHTML = kpisOnboarding();
      }
      aviso(`Onboarding de ${o.proveedor} guardado`);
    } catch (err) {
      aviso(err.message, true);
    }
  };
}

// --- Catálogos ---

function renderCatalogos(el) {
  const enUso = (c, id) => datos[c.uso[0]].filter(x => x[c.uso[1]] === id).length;
  el.innerHTML = `
    <div class="rejilla-cat">
      ${CATALOGOS.map(c => `
        <section class="panel">
          <div class="panel-cab">
            <h2>${c.titulo} <span class="cuenta">${datos.cat[c.ruta].length}</span></h2>
            <button class="btn primario sm" data-accion="nuevo" data-ruta="${c.ruta}">+ Agregar</button>
          </div>
          <div class="tabla-scroll">
            <table class="tabla compacta">
              <thead><tr>${c.campos.map(f => `<th>${f.label}</th>`).join('')}${c.extra ? `<th>${c.extra[0]}</th>` : ''}<th class="num" title="Vacantes que lo usan">En uso</th><th></th></tr></thead>
              <tbody>
                ${datos.cat[c.ruta].map(x => `
                  <tr>
                    ${c.campos.map((f, i) => `<td>${i === 0 ? `<strong>${esc(x[f.name])}</strong>` : esc(x[f.name]) || '<span class="tenue">—</span>'}</td>`).join('')}
                    ${c.extra ? `<td>${esc(c.extra[1](x)) || '<span class="tenue">—</span>'}</td>` : ''}
                    <td class="num">${enUso(c, x.id)}</td>
                    <td class="acciones-fila">
                      <button class="icono" data-accion="editar" data-ruta="${c.ruta}" data-id="${x.id}" title="Editar">${ICONO.editar}</button>
                      <button class="icono peligro" data-accion="borrar" data-ruta="${c.ruta}" data-id="${x.id}" title="Eliminar">${ICONO.borrar}</button>
                    </td>
                  </tr>`).join('') || `<tr><td colspan="${c.campos.length + (c.extra ? 3 : 2)}" class="vacio">Sin registros.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>`).join('')}
    </div>`;

  el.onchange = null;
  el.onclick = e => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const c = CATALOGOS.find(x => x.ruta === b.dataset.ruta);
    const x = datos.cat[c.ruta].find(y => y.id === Number(b.dataset.id));
    if (b.dataset.accion === 'borrar') {
      return eliminar(`/api/${c.ruta}/${x.id}`, `¿Eliminar ${c.singular} "${x.nombre}"?`, `${c.titulo}: registro eliminado`);
    }
    abrirFormulario({
      titulo: x ? `Editar ${c.singular}` : `Nuevo ${c.singular}`,
      campos: c.campos,
      valores: x,
      guardar: d => x ? api('PUT', `/api/${c.ruta}/${x.id}`, d) : api('POST', `/api/${c.ruta}`, d),
      exito: x ? 'Cambios guardados' : 'Registro creado',
    });
  };
}

// --- Usuarios (solo administradores) ---

function formUsuario(u) {
  abrirFormulario({
    titulo: u ? `Editar usuario · ${u.nombre}` : 'Nuevo usuario',
    valores: u ?? { rol: 'reclutador', activo: 1 },
    campos: [
      { name: 'nombre', label: 'Nombre completo', required: true },
      { name: 'usuario', label: 'Usuario de acceso', required: true, autocomplete: 'off', placeholder: 'ej. nayrobis' },
      { name: 'password', label: u ? 'Nueva contraseña' : 'Contraseña', type: 'password', required: !u,
        autocomplete: 'new-password', placeholder: u ? 'Vacío = no cambiar' : 'Mínimo 8 caracteres' },
      { name: 'rol', label: 'Rol', type: 'select', required: true, opciones: Object.entries(ROLES).map(([value, label]) => ({ value, label })) },
      { name: 'reclutador_id', label: 'Reclutador vinculado', type: 'select', opciones: opciones('reclutadores') },
      ...(u ? [{ name: 'activo', label: 'Estado', type: 'select', required: true, opciones: [{ value: 1, label: 'Activo' }, { value: 0, label: 'Inactivo' }] }] : []),
    ],
    guardar: d => u ? api('PUT', `/api/usuarios/${u.id}`, d) : api('POST', '/api/usuarios', d),
    exito: u ? 'Usuario actualizado' : 'Usuario creado. Comparte el usuario y la contraseña con la persona.',
  });
}

function renderUsuarios(el) {
  el.innerHTML = `
    <section class="panel">
      <div class="panel-cab">
        <div>
          <h2>Usuarios <span class="cuenta">${datos.usuarios.length}</span></h2>
          <p class="sub">Crea aquí los accesos del equipo. Los administradores también pueden gestionar usuarios; los reclutadores no.</p>
        </div>
        <button class="btn primario" data-accion="nuevo">+ Nuevo usuario</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Reclutador vinculado</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead>
          <tbody>
            ${datos.usuarios.map(u => `
              <tr class="${u.activo ? '' : 'inactivo'}">
                <td><strong>${esc(u.nombre)}</strong>${u.id === datos.usuario.id ? ' <span class="chip info">Tú</span>' : ''}</td>
                <td>${esc(u.usuario)}</td>
                <td><span class="chip ${u.rol === 'admin' ? 'marca' : ''}">${ROLES[u.rol]}</span></td>
                <td>${esc(u.reclutador) || '<span class="tenue">—</span>'}</td>
                <td><span class="chip ${u.activo ? 'ok' : ''}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td>${u.ultimo_acceso ? new Date(u.ultimo_acceso.replace(' ', 'T') + 'Z').toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '<span class="tenue">Nunca</span>'}</td>
                <td class="acciones-fila">
                  <button class="icono" data-accion="editar" data-id="${u.id}" title="Editar">${ICONO.editar}</button>
                  ${u.id === datos.usuario.id ? '' : `<button class="icono peligro" data-accion="borrar" data-id="${u.id}" title="Eliminar">${ICONO.borrar}</button>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>`;

  el.onchange = null;
  el.onclick = e => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const u = datos.usuarios.find(x => x.id === Number(b.dataset.id));
    if (b.dataset.accion === 'nuevo') formUsuario();
    if (b.dataset.accion === 'editar') formUsuario(u);
    if (b.dataset.accion === 'borrar') eliminar(`/api/usuarios/${u.id}`, `¿Eliminar el usuario "${u.usuario}"? Perderá el acceso de inmediato.`, 'Usuario eliminado');
  };
}

function formPassword() {
  abrirFormulario({
    titulo: 'Cambiar mi contraseña',
    campos: [
      { name: 'actual', label: 'Contraseña actual', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'nueva', label: 'Nueva contraseña', type: 'password', required: true, autocomplete: 'new-password', placeholder: 'Mínimo 8 caracteres' },
      { name: 'confirmar', label: 'Confirmar nueva contraseña', type: 'password', required: true, autocomplete: 'new-password' },
    ],
    guardar: d => {
      if (d.nueva !== d.confirmar) throw new Error('Las contraseñas nuevas no coinciden');
      return api('POST', '/api/auth/password', { actual: d.actual, nueva: d.nueva });
    },
    exito: 'Contraseña actualizada',
  });
}

// --- Pantalla de acceso ---

let temporizadorRefresco;

function mostrarAcceso(necesitaConfiguracion = false) {
  datos.usuario = null;
  clearInterval(temporizadorRefresco);
  if ($('#modal').open) $('#modal').close();
  document.body.classList.add('sin-sesion');
  const configurar = necesitaConfiguracion;
  $('#acceso').innerHTML = `
    <form class="tarjeta-acceso" novalidate>
      <div class="acceso-marca"><img src="img/logo-bdb.png" alt="BDB Logística"><div><strong>CRM Redex</strong><small>Coordinación de capacidad</small></div></div>
      <h1>${configurar ? 'Configura el primer administrador' : 'Iniciar sesión'}</h1>
      <p class="sub">${configurar
        ? 'Aún no hay usuarios. Crea tu cuenta de administrador; después podrás dar de alta los accesos del equipo.'
        : 'Usa el usuario y la contraseña que te dio el administrador.'}</p>
      ${configurar ? '<label class="campo"><span>Nombre completo</span><input name="nombre" required autocomplete="name"></label>' : ''}
      <label class="campo"><span>Usuario</span><input name="usuario" required autocomplete="username" autocapitalize="none"></label>
      <label class="campo"><span>Contraseña</span><input name="password" type="password" required
        autocomplete="${configurar ? 'new-password' : 'current-password'}" ${configurar ? 'placeholder="Mínimo 8 caracteres"' : ''}></label>
      <p class="error" hidden></p>
      <button type="submit" class="btn primario">${configurar ? 'Crear administrador y entrar' : 'Entrar'}</button>
    </form>`;
  const form = $('#acceso form');
  form.onsubmit = async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const boton = form.querySelector('button');
    boton.disabled = true;
    try {
      const { usuario } = await api('POST', configurar ? '/api/auth/configurar' : '/api/auth/login', Object.fromEntries(new FormData(form)));
      await entrar(usuario);
    } catch (err) {
      const p = form.querySelector('.error');
      p.textContent = err.message;
      p.hidden = false;
      boton.disabled = false;
    }
  };
  form.querySelector('input').focus();
}

async function entrar(usuario) {
  datos.usuario = usuario;
  document.body.classList.remove('sin-sesion');
  $('#acceso').innerHTML = '';
  await cargar();
  // Refresca cada 30 s para ver lo que registran otros reclutadores, sin interrumpir la edición
  clearInterval(temporizadorRefresco);
  temporizadorRefresco = setInterval(() => {
    const editando = document.activeElement?.matches('input, select, textarea');
    if (!$('#modal').open && !editando && !document.hidden) cargar().catch(() => {});
  }, 30000);
}

// --- Formularios genéricos ---

function campoHTML(c, valor) {
  if (c.seccion) return `<h4 class="seccion-form">${esc(c.seccion)}</h4>`;
  const id = `campo-${c.name}`;
  if (c.type === 'checkbox') {
    return `<label class="campo casilla" for="${id}"><input id="${id}" type="checkbox" name="${c.name}" value="1" ${Number(valor) ? 'checked' : ''}><span>${esc(c.label)}</span></label>`;
  }
  const req = c.required ? 'required' : '';
  const v = valor ?? '';
  let control;
  if (c.type === 'select') {
    control = `<select id="${id}" name="${c.name}" ${req}>
      <option value="">${esc(c.vacio ?? (c.required ? 'Selecciona…' : 'Ninguno'))}</option>
      ${c.opciones.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  } else if (c.type === 'textarea') {
    control = `<textarea id="${id}" name="${c.name}" rows="3">${esc(v)}</textarea>`;
  } else {
    const extras = [
      c.min != null ? `min="${c.min}"` : '',
      c.step ? `step="${c.step}"` : '',
      c.autocomplete ? `autocomplete="${c.autocomplete}"` : '',
      c.placeholder ? `placeholder="${esc(c.placeholder)}"` : '',
    ].join(' ');
    control = `<input id="${id}" name="${c.name}" type="${c.type ?? 'text'}" value="${c.type === 'password' ? '' : esc(v)}" ${extras} ${req}>`;
  }
  const ancho = c.ancho || c.type === 'textarea' ? 'ancho' : '';
  return `<label class="campo ${ancho}" for="${id}"><span>${esc(c.label)}${c.required ? ' *' : ''}</span>${control}</label>`;
}

function abrirFormulario({ titulo, campos, valores = {}, guardar, exito, despues, ancho = false }) {
  const modal = $('#modal');
  modal.innerHTML = `
    <form class="formulario ${ancho ? 'amplio' : ''}" novalidate>
      <header><h3>${esc(titulo)}</h3><button type="button" class="cerrar" aria-label="Cerrar">×</button></header>
      <div class="campos">${campos.map(c => campoHTML(c, valores[c.name])).join('')}</div>
      <p class="error" hidden></p>
      <footer>
        <button type="button" class="btn" data-cancelar>Cancelar</button>
        <button type="submit" class="btn primario">Guardar</button>
      </footer>
    </form>`;
  const form = modal.querySelector('form');
  const error = form.querySelector('.error');
  const cancelar = () => (despues ? despues() : modal.close());
  form.querySelector('.cerrar').onclick = cancelar;
  form.querySelector('[data-cancelar]').onclick = cancelar;
  form.onsubmit = async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const boton = form.querySelector('[type="submit"]');
    boton.disabled = true;
    try {
      await guardar(Object.fromEntries(new FormData(form)));
      aviso(exito);
      await cargar();
      if (despues) despues(); else modal.close();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      boton.disabled = false;
    }
  };
  if (!modal.open) modal.showModal();
  form.querySelector('input, select, textarea')?.focus();
}

async function eliminar(url, pregunta, exito, despues) {
  if (!confirm(pregunta)) return;
  try {
    await api('DELETE', url);
    aviso(exito);
    await cargar();
    despues?.();
  } catch (err) {
    aviso(err.message, true);
  }
}

// --- Inicio ---

$('#pestanas').addEventListener('click', e => {
  const b = e.target.closest('button[data-vista]');
  if (!b) return;
  datos.vista = b.dataset.vista;
  almacen.set('vista', datos.vista);
  render();
});

$('#usuario-actual').addEventListener('click', async e => {
  const accion = e.target.closest('[data-accion]')?.dataset.accion;
  if (accion === 'password') formPassword();
  if (accion === 'salir') {
    await api('POST', '/api/auth/logout').catch(() => {});
    mostrarAcceso();
  }
});

datos.agruparTablero = almacen.get('agruparTablero') !== '0';
datos.vistaPipeline = almacen.get('vistaPipeline') === 'junto' ? 'junto' : 'reclutador';
const vistaGuardada = almacen.get('vista');
if (VISTAS.includes(vistaGuardada)) datos.vista = vistaGuardada;

fetch('/api/auth/sesion')
  .then(async r => {
    const res = await r.json();
    if (r.ok) return entrar(res.usuario);
    mostrarAcceso(res.necesitaConfiguracion);
  })
  .catch(err => {
    document.body.classList.add('sin-sesion');
    $('#acceso').innerHTML = `<p class="vacio">No se pudo conectar con el servidor: ${esc(err.message)}</p>`;
  });
