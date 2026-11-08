'use strict';

const ESTADOS = ['Prospección', 'En documentación', 'Cierre de contrato', 'Operativo'];
const CLASE_ESTADO = {
  'Prospección': 'prospeccion',
  'En documentación': 'documentacion',
  'Cierre de contrato': 'cierre',
  'Operativo': 'operativo',
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
const VISTAS = ['resumen', 'tablero', 'pipeline', 'onboarding', 'catalogos', 'usuarios'];

const datos = {
  usuario: null,
  usuarios: [],
  vista: 'resumen',
  historial: [],
  resumenFecha: null,
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
  const [clientes, localidades, tipos, reclutadores, vacantes, asignaciones, onboarding, usuarios, historial] = await Promise.all([
    api('GET', '/api/clientes'), api('GET', '/api/localidades'), api('GET', '/api/tipos-vehiculo'),
    api('GET', '/api/reclutadores'), api('GET', '/api/vacantes'), api('GET', '/api/asignaciones'),
    api('GET', '/api/onboarding'), esAdmin() ? api('GET', '/api/usuarios') : [],
    api('GET', `/api/historial?desde=${datos.resumenFecha}`),
  ]);
  Object.assign(datos.cat, { clientes, localidades, 'tipos-vehiculo': tipos, reclutadores });
  Object.assign(datos, { vacantes, asignaciones, onboarding, usuarios, historial });
  render();
}

function render() {
  if (datos.vista === 'usuarios' && !esAdmin()) datos.vista = 'tablero';
  $$('#pestanas [data-solo-admin]').forEach(b => { b.hidden = !esAdmin(); });
  $$('#pestanas button').forEach(b => b.classList.toggle('activo', b.dataset.vista === datos.vista));
  renderUsuarioActual();
  const vistas = { resumen: renderResumen, tablero: renderTablero, pipeline: renderPipeline, onboarding: renderOnboarding, catalogos: renderCatalogos, usuarios: renderUsuarios };
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
  return datos.vacantes.filter(v =>
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
          <p class="sub">Haz clic en una vacante para ver su detalle, la dirección y los proveedores asignados.</p>
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

// --- Resumen del día anterior ---

const TIPOS_EVENTO = {
  asignacion_creada: ['Nuevo proveedor', 'info'],
  cambio_estado: ['Cambio de etapa', 'marca'],
  asignacion_editada: ['Proveedor actualizado', ''],
  asignacion_eliminada: ['Proveedor eliminado', 'alerta'],
  vacante_creada: ['Nueva vacante', 'info'],
  vacante_editada: ['Vacante actualizada', ''],
  vacante_eliminada: ['Vacante eliminada', 'alerta'],
  evaluacion: ['Evaluación', 'ok'],
  importacion: ['Importación', ''],
};

function prioridades() {
  const h = hoy();
  const lista = [];
  for (const v of datos.vacantes) {
    const faltan = v.cantidad - v.cerrados;
    if (faltan <= 0 || vigenciaConcluida(v)) continue;
    const dias = v.fecha_arranque ? diasEntre(h, v.fecha_arranque) : null;
    const sinLeads = v.cerrados === 0 && v.tentativo === 0 && !v.proveedores;
    const extra = sinLeads ? ' · sin leads ni proveedores' : '';
    const base = { titulo: nombreVacante(v), quien: nombreReclutador(v), vacante: v.id };
    if (vacanteIniciada(v)) {
      lista.push({ ...base, nivel: 3, peso: faltan * 10 + (dias != null ? -dias : 30),
        detalle: `${v.inicio_inmediato ? 'Inicio inmediato' : dias === 0 ? 'Arrancó hoy' : `Arrancó hace ${plural(-dias, 'día', 'días')}`}: faltan ${faltan} de ${v.cantidad} unidades${extra}` });
    } else if (dias != null && dias <= 7) {
      lista.push({ ...base, nivel: 2, peso: faltan * 10 - dias,
        detalle: `Arranca en ${plural(dias, 'día', 'días')}: faltan ${faltan} de ${v.cantidad} unidades${extra}` });
    } else if (sinLeads) {
      lista.push({ ...base, nivel: 2, peso: v.cantidad, detalle: `Sin leads ni proveedores; objetivo de ${v.cantidad} unidades` });
    }
  }
  for (const v of datos.vacantes) {
    if (!v.cerrados || vigenciaConcluida(v)) continue;
    const pendientes = FASES_ALTA.filter(([campo]) => v[campo] === 'Pendiente').map(([, etiqueta]) => etiqueta);
    if (pendientes.length) {
      lista.push({ nivel: 1, peso: pendientes.length * v.cerrados, titulo: nombreVacante(v), quien: nombreReclutador(v), vacante: v.id,
        detalle: `${plural(v.cerrados, 'cerrado', 'cerrados')} con alta pendiente: ${pendientes.join(', ')}` });
    }
  }
  for (const a of datos.asignaciones) {
    if (a.estado === 'Operativo') continue;
    const d = diasEntre(String(a.actualizado_en).slice(0, 10), h);
    if (d >= 5) lista.push({ nivel: 1, peso: d, titulo: a.proveedor, quien: a.reclutador, vacante: a.vacante_id, detalle: `${d} días sin movimiento en ${a.estado}` });
  }
  for (const o of datos.onboarding) {
    for (const n of [1, 2]) {
      if (semana(o, n).texto === 'Por evaluar') {
        lista.push({ nivel: 1, peso: 1, titulo: o.proveedor, quien: o.reclutador, detalle: `Falta evaluar la semana ${n} de onboarding` });
      }
    }
  }
  return lista.sort((a, b) => b.nivel - a.nivel || b.peso - a.peso);
}

function focos(clave) {
  const mapa = new Map();
  for (const v of datos.vacantes) {
    if (vigenciaConcluida(v)) continue;
    const nombre = clave === 'ciudad' ? v.localidad : nombreReclutador(v);
    const f = mapa.get(nombre) ?? { nombre, objetivo: 0, cerrados: 0, faltan: 0 };
    f.objetivo += v.cantidad;
    f.cerrados += Math.min(v.cerrados, v.cantidad);
    f.faltan += Math.max(0, v.cantidad - v.cerrados);
    mapa.set(nombre, f);
  }
  return [...mapa.values()].filter(f => f.faltan > 0).sort((a, b) => b.faltan - a.faltan);
}

function barrasFoco(lista, max = 6) {
  const tope = Math.max(1, ...lista.map(f => f.faltan));
  return lista.slice(0, max).map(f => `
    <div class="foco">
      <span class="foco-nombre">${esc(f.nombre)}</span>
      <span class="foco-barra"><i style="width:${f.faltan / tope * 100}%"></i></span>
      <span class="foco-num"><b>${f.faltan}</b> por cubrir</span>
    </div>`).join('') || '<p class="vacio">Sin unidades por cubrir.</p>';
}

function renderResumen(el) {
  const fecha = datos.resumenFecha;
  const eventos = datos.historial;
  const cuenta = tipo => eventos.filter(e => e.tipo === tipo).length;
  const operativos = eventos.filter(e => e.tipo === 'cambio_estado' && e.estado_nuevo === 'Operativo');
  const avances = eventos.filter(e => e.tipo === 'cambio_estado' && e.estado_nuevo !== 'Operativo' &&
    ESTADOS.indexOf(e.estado_nuevo) > ESTADOS.indexOf(e.estado_anterior));
  const lista = prioridades();
  const porCiudad = focos('ciudad');
  const porReclutador = focos('reclutador');
  const etiquetaDia = fecha === sumarDias(hoy(), -1) ? 'Ayer' : fecha === hoy() ? 'Hoy' : 'El';
  const fechaLarga = aFecha(fecha).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

  const frases = [];
  frases.push(eventos.length
    ? `${etiquetaDia} ${fechaLarga} hubo <b>${plural(eventos.length, 'movimiento', 'movimientos')}</b>: ${cuenta('asignacion_creada')} proveedores nuevos, ${avances.length} avances de etapa y <b>${operativos.length} cierres a Operativo</b>${cuenta('evaluacion') ? `, además de ${cuenta('evaluacion')} evaluaciones de onboarding` : ''}.`
    : `${etiquetaDia} ${fechaLarga} no se registraron movimientos en el tablero.`);
  if (lista[0]) frases.push(`Lo primero que hay que atacar: <b>${esc(lista[0].titulo)}</b> (${esc(lista[0].quien)}): ${esc(lista[0].detalle)}.`);
  if (porCiudad[0]) {
    frases.push(`Donde más nos necesitan: ${porCiudad.slice(0, 3).map(f => `<b>${esc(f.nombre)}</b> (${f.faltan} u.)`).join(', ')}.`);
  }

  el.innerHTML = `
    <section class="panel resumen-cab">
      <div class="panel-cab">
        <div>
          <h2>Resumen del día</h2>
          <p class="sub">Lo que pasó el día anterior y dónde concentrarnos hoy.</p>
        </div>
        <label class="filtro"><span>Día a revisar</span><input type="date" id="fecha-resumen" value="${fecha}" max="${hoy()}"></label>
      </div>
      <div class="resumen-texto">${frases.map(f => `<p>${f}</p>`).join('')}</div>
    </section>
    ${kpis([
      ['Movimientos', eventos.length, fechaLarga],
      ['Proveedores nuevos', cuenta('asignacion_creada')],
      ['Avances de etapa', avances.length, '', 'ambar'],
      ['Cierres a Operativo', operativos.length, '', 'verde'],
      ['Evaluaciones', cuenta('evaluacion')],
      ['Prioridades abiertas', lista.length, '', lista.length ? 'rojo' : 'verde'],
    ])}
    <div class="rejilla-resumen">
      <section class="panel">
        <div class="panel-cab"><h2>Prioridades para hoy</h2><span class="cuenta">${lista.length}</span></div>
        <ol class="prioridades">
          ${lista.slice(0, 12).map(p => `
            <li class="nivel-${p.nivel} ${p.vacante ? 'clic' : ''}" ${p.vacante ? `data-vacante="${p.vacante}"` : ''}>
              <span class="nivel">${p.nivel === 3 ? 'Urgente' : p.nivel === 2 ? 'Alta' : 'Seguimiento'}</span>
              <div><strong>${esc(p.titulo)}</strong><small>${esc(p.detalle)}</small></div>
              <span class="quien">${esc(p.quien)}</span>
            </li>`).join('') || '<li class="vacio">Sin prioridades abiertas. ¡Todo cubierto!</li>'}
        </ol>
        ${lista.length > 12 ? `<p class="sub pie-panel">Y ${lista.length - 12} más de menor prioridad.</p>` : ''}
      </section>
      <div class="columna-resumen">
        <section class="panel">
          <div class="panel-cab"><h2>Dónde concentrarnos · por ciudad</h2></div>
          <div class="focos">${barrasFoco(porCiudad)}</div>
        </section>
        <section class="panel">
          <div class="panel-cab"><h2>Por reclutador</h2></div>
          <div class="focos">${barrasFoco(porReclutador, 8)}</div>
        </section>
      </div>
    </div>
    <section class="panel">
      <div class="panel-cab"><h2>Lo que pasó · ${fechaLarga}</h2><span class="cuenta">${eventos.length}</span></div>
      <ul class="bitacora">
        ${eventos.map(e => {
          const [etiqueta, clase] = TIPOS_EVENTO[e.tipo] ?? [e.tipo, ''];
          return `
            <li>
              <span class="hora">${String(e.fecha).slice(11, 16)}</span>
              <span class="chip ${clase}">${etiqueta}</span>
              <span class="desc">${esc(e.descripcion)}</span>
              <span class="quien">${esc(e.usuario ?? '')}</span>
            </li>`;
        }).join('') || '<li class="vacio">No hay movimientos registrados ese día.</li>'}
      </ul>
    </section>`;

  el.onchange = async e => {
    if (e.target.id !== 'fecha-resumen' || !e.target.value) return;
    datos.resumenFecha = e.target.value;
    datos.historial = await api('GET', `/api/historial?desde=${datos.resumenFecha}`).catch(() => []);
    render();
  };
  el.onclick = e => {
    const li = e.target.closest('[data-vacante]');
    if (li) verVacante(Number(li.dataset.vacante));
  };
}

// --- Pipeline de proveedores ---

function formAsignacion(a, { vacanteId, despues } = {}) {
  const vacante = datos.vacantes.find(v => v.id === vacanteId);
  abrirFormulario({
    titulo: a ? 'Editar proveedor' : 'Asignar proveedor',
    valores: a ?? {
      vacante_id: vacanteId, reclutador_id: reclutadorActivo() || vacante?.reclutador_id || '',
      unidades: 1, fecha_disponibilidad: hoy(), estado: 'Prospección',
    },
    campos: [
      { name: 'vacante_id', label: 'Vacante', type: 'select', required: true, ancho: true,
        opciones: datos.vacantes.map(v => ({ value: v.id, label: `${nombreReclutador(v)} · ${nombreVacante(v)} (${v.cantidad} u.)` })) },
      { name: 'proveedor', label: 'Proveedor', required: true },
      { name: 'reclutador_id', label: 'Reclutador', type: 'select', required: true, opciones: opciones('reclutadores') },
      { name: 'unidades', label: 'Cantidad de unidades', type: 'number', min: 1, required: true },
      { name: 'fecha_disponibilidad', label: 'Fecha de disponibilidad', type: 'date', required: true },
      { name: 'estado', label: 'Estado', type: 'select', required: true, opciones: ESTADOS.map(e => ({ value: e, label: e })) },
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
    aviso(nuevo === 'Operativo' ? `${a.proveedor} pasó a Operativo: se sumó a cerrados y entró a onboarding` : `${a.proveedor} → ${nuevo}`);
    await cargar();
  } catch (err) {
    aviso(err.message, true);
  }
}

// Días desde que se registró el proveedor hasta que pasó a Operativo
const diasCierre = a => a.estado === 'Operativo' && a.fecha_operativo && a.creado_en ? Math.max(0, diasEntre(a.creado_en.slice(0, 10), a.fecha_operativo)) : null;
const diasAbierto = a => a.creado_en ? Math.max(0, diasEntre(a.creado_en.slice(0, 10), hoy())) : null;
const promedio = nums => nums.length ? Math.round(nums.reduce((x, y) => x + y, 0) / nums.length * 10) / 10 : null;

function tiemposCierre(lista) {
  const cierres = lista.map(diasCierre).filter(d => d != null);
  const abiertos = lista.filter(a => a.estado !== 'Operativo').map(diasAbierto).filter(d => d != null);
  return { cierres, abiertos, promCierre: promedio(cierres), promAbierto: promedio(abiertos) };
}

function tarjeta(a) {
  const cierre = diasCierre(a);
  const abierto = diasAbierto(a);
  const dias = a.estado === 'Operativo'
    ? (cierre != null ? `<span class="dias ok" title="Días desde que se registró hasta Operativo">Cerró en ${plural(cierre, 'día', 'días')}</span>` : '')
    : (abierto != null ? `<span class="dias ${abierto >= 14 ? 'alerta' : abierto >= 7 ? 'aviso' : ''}" title="Días desde que se registró">Día ${abierto}</span>` : '');
  return `
    <article class="tarjeta" draggable="true" data-id="${a.id}">
      <div class="tarjeta-cab"><strong>${esc(a.proveedor)}</strong>${dias}</div>
      <span class="meta">${esc(a.cliente)} · ${esc(a.localidad)}</span>
      <span class="meta">${esc(a.tipo_vehiculo)}</span>
      <div class="pie">
        <span class="pastilla">${a.unidades} u.</span>
        <span class="meta">Disp. ${fmtCorto(a.fecha_disponibilidad)}</span>
        <span class="reclutador-tarjeta"><span class="avatar">${esc(iniciales(a.reclutador))}</span>${esc(a.reclutador)}</span>
      </div>
      <select class="mover" data-id="${a.id}" aria-label="Cambiar estado de ${esc(a.proveedor)}">
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

function franjaCierre(lista) {
  const t = tiemposCierre(lista);
  const masAntiguo = lista.filter(a => a.estado !== 'Operativo').sort((x, y) => (diasAbierto(y) ?? 0) - (diasAbierto(x) ?? 0))[0];
  const porReclutador = gruposPorReclutador(lista).map(g => ({ nombre: g.nombre, ...tiemposCierre(g.items) }));
  return `
    <section class="panel franja-cierre">
      <div class="cierre-principal">
        <span>Promedio de cierre</span>
        <strong>${t.promCierre != null ? `${t.promCierre} días` : '—'}</strong>
        <small>${t.cierres.length ? `de registro a Operativo · ${plural(t.cierres.length, 'cierre', 'cierres')}` : 'Aún no hay cierres registrados'}</small>
      </div>
      <div class="cierre-dato"><span>En proceso</span><strong>${t.abiertos.length}</strong><small>${t.promAbierto != null ? `llevan ${t.promAbierto} días en promedio` : 'sin proveedores abiertos'}</small></div>
      <div class="cierre-dato"><span>Más antiguo abierto</span><strong>${masAntiguo ? `${diasAbierto(masAntiguo) ?? 0} d` : '—'}</strong><small>${masAntiguo ? esc(masAntiguo.proveedor) : ''}</small></div>
      <div class="cierre-reclutadores">
        ${porReclutador.map(r => `
          <span class="cierre-chip" title="${esc(r.nombre)}: ${r.cierres.length} cierres, ${r.abiertos.length} en proceso">
            <b>${esc(r.nombre)}</b> ${r.promCierre != null ? `${r.promCierre} d` : '—'}
            <small>${r.cierres.length} cierres · ${r.abiertos.length} abiertos</small>
          </span>`).join('') || '<small class="tenue">Cuando los reclutadores registren proveedores verás aquí sus días de cierre.</small>'}
      </div>
    </section>`;
}

function renderPipeline(el) {
  const { reclutador, cliente } = datos.filtros;
  const lista = datos.asignaciones.filter(a => (!reclutador || String(a.reclutador_id) === reclutador) && (!cliente || String(a.cliente_id) === cliente));
  const porReclutador = datos.vistaPipeline === 'reclutador';

  el.innerHTML = `
    ${franjaCierre(lista)}
    <section class="panel">
      <div class="panel-cab">
        <div>
          <h2>Pipeline de proveedores</h2>
          <p class="sub">Arrastra una tarjeta a otra columna o usa el selector. Al pasar a Operativo, sus unidades se suman a los cerrados de la vacante.</p>
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
    ${porReclutador
      ? gruposPorReclutador(lista).map(g => {
        const t = tiemposCierre(g.items);
        return `
          <section class="panel carril">
            <div class="carril-cab">
              <span class="avatar grande">${esc(iniciales(g.nombre))}</span>
              <div>
                <h2>${esc(g.nombre)}</h2>
                <small>${ciudadesDe(g.id).join(' · ') || 'Sin ciudades asignadas'}</small>
              </div>
              <div class="carril-stats">
                <span><b>${t.abiertos.length}</b> en proceso</span>
                <span><b>${g.items.filter(a => a.estado === 'Operativo').length}</b> operativos</span>
                <span class="destacado">Cierre prom. <b>${t.promCierre != null ? `${t.promCierre} d` : '—'}</b></span>
              </div>
            </div>
            ${columnasKanban(g.items, true)}
          </section>`;
      }).join('') || '<section class="panel"><p class="vacio">Aún no hay proveedores en el pipeline. Usa «+ Asignar proveedor» o ábrelos desde una vacante del Tablero.</p></section>'
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
  el.innerHTML = `
    <div id="kpis-onboarding">${kpisOnboarding()}</div>
    <section class="panel">
      <div class="panel-cab">
        <div>
          <h2>Onboarding · primeras dos semanas</h2>
          <p class="sub">Proveedores en estado Operativo. Los cambios se guardan automáticamente.</p>
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
              </tr>`).join('') || '<tr><td colspan="3" class="vacio">Ningún proveedor ha llegado a Operativo todavía.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>`;

  el.onclick = null;
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

datos.resumenFecha = sumarDias(hoy(), -1);
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
