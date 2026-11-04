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
  { ruta: 'reclutadores', titulo: 'Reclutadores', singular: 'reclutador', uso: ['asignaciones', 'reclutador_id'],
    campos: [{ name: 'nombre', label: 'Nombre', required: true }, { name: 'email', label: 'Correo', type: 'email' }] },
];

const ICONO = {
  editar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  borrar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  ver: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM3 21c1.5-3.5 5-5 9-5s7.5 1.5 9 5"/></svg>',
};

const ROLES = { admin: 'Administrador', reclutador: 'Reclutador' };
const VISTAS = ['tablero', 'pipeline', 'onboarding', 'catalogos', 'usuarios'];

const datos = {
  usuario: null,
  usuarios: [],
  vista: 'tablero',
  cat: { clientes: [], localidades: [], 'tipos-vehiculo': [], reclutadores: [] },
  vacantes: [],
  asignaciones: [],
  onboarding: [],
  filtros: { cliente: '', localidad: '', reclutador: '' },
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
  const [clientes, localidades, tipos, reclutadores, vacantes, asignaciones, onboarding, usuarios] = await Promise.all([
    api('GET', '/api/clientes'), api('GET', '/api/localidades'), api('GET', '/api/tipos-vehiculo'),
    api('GET', '/api/reclutadores'), api('GET', '/api/vacantes'), api('GET', '/api/asignaciones'),
    api('GET', '/api/onboarding'), esAdmin() ? api('GET', '/api/usuarios') : [],
  ]);
  Object.assign(datos.cat, { clientes, localidades, 'tipos-vehiculo': tipos, reclutadores });
  Object.assign(datos, { vacantes, asignaciones, onboarding, usuarios });
  render();
}

function render() {
  if (datos.vista === 'usuarios' && !esAdmin()) datos.vista = 'tablero';
  $$('#pestanas [data-solo-admin]').forEach(b => { b.hidden = !esAdmin(); });
  $$('#pestanas button').forEach(b => b.classList.toggle('activo', b.dataset.vista === datos.vista));
  renderUsuarioActual();
  const vistas = { tablero: renderTablero, pipeline: renderPipeline, onboarding: renderOnboarding, catalogos: renderCatalogos, usuarios: renderUsuarios };
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

// --- Tablero de vacantes ---

function cobertura(v) {
  const op = Math.min(v.unidades_operativas, v.cantidad);
  const proc = Math.min(v.unidades_en_proceso, v.cantidad - op);
  return { op, proc, pctOp: op / v.cantidad * 100, pctProc: proc / v.cantidad * 100, faltan: v.cantidad - op - proc };
}

function barraCobertura(v) {
  const c = cobertura(v);
  return `<div class="barra" title="${c.op} operativas · ${c.proc} en proceso · ${c.faltan} por cubrir">
      <span class="op" style="width:${c.pctOp}%"></span><span class="proc" style="width:${c.pctProc}%"></span>
    </div>
    <small class="leyenda"><b>${c.op}</b> operativas · <b>${c.proc}</b> en proceso · <b>${c.faltan}</b> por cubrir</small>`;
}

function chipArranque(v) {
  const d = diasEntre(hoy(), v.fecha_arranque);
  const texto = d > 0 ? `en ${plural(d, 'día', 'días')}` : d === 0 ? 'hoy' : `hace ${plural(-d, 'día', 'días')}`;
  const completa = v.unidades_operativas >= v.cantidad;
  const clase = completa ? 'ok' : d <= 0 ? 'alerta' : d <= 7 ? 'aviso' : '';
  return `<span class="chip ${clase}">${texto}</span>`;
}

function renderTablero(el) {
  const { cliente, localidad } = datos.filtros;
  const lista = datos.vacantes.filter(v => (!cliente || String(v.cliente_id) === cliente) && (!localidad || String(v.localidad_id) === localidad));
  const requeridas = sumar(lista, 'cantidad');
  const operativas = sumar(lista, v => cobertura(v).op);
  const enProceso = sumar(lista, v => cobertura(v).proc);
  const pct = requeridas ? Math.round(operativas / requeridas * 100) : 0;

  el.innerHTML = `
    ${kpis([
      ['Vacantes', lista.length, plural(new Set(lista.map(v => v.cliente_id)).size, 'cliente', 'clientes')],
      ['Unidades requeridas', requeridas],
      ['Operativas', operativas, '', 'verde'],
      ['En proceso', enProceso, '', 'ambar'],
      ['Por cubrir', requeridas - operativas - enProceso, '', 'rojo'],
      ['Cobertura operativa', `${pct}%`],
    ])}
    <section class="panel">
      <div class="panel-cab">
        <h2>Capacidad por vacante</h2>
        <div class="acciones">
          ${selectFiltro('cliente', 'Cliente', 'clientes')}
          ${selectFiltro('localidad', 'Localidad', 'localidades')}
          <button class="btn primario" data-accion="nueva-vacante">+ Nueva vacante</button>
        </div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr>
            <th>Cliente</th><th>Localidad</th><th>Tipo de vehículo</th><th class="num">Cantidad</th>
            <th>Fecha de arranque</th><th class="col-cobertura">Cobertura</th><th></th>
          </tr></thead>
          <tbody>
            ${lista.map(v => `
              <tr class="clic" data-accion="ver-vacante" data-id="${v.id}">
                <td><strong>${esc(v.cliente)}</strong>${v.notas ? `<small class="nota">${esc(v.notas)}</small>` : ''}</td>
                <td>${esc(v.localidad)}</td>
                <td>${esc(v.tipo_vehiculo)}</td>
                <td class="num"><strong>${v.cantidad}</strong></td>
                <td>${fmt(v.fecha_arranque)}<br>${chipArranque(v)}</td>
                <td class="col-cobertura">${barraCobertura(v)}</td>
                <td class="acciones-fila">
                  <button class="icono" data-accion="ver-vacante" data-id="${v.id}" title="Ver proveedores (${v.proveedores})">${ICONO.ver}<span class="contador">${v.proveedores}</span></button>
                  <button class="icono" data-accion="editar-vacante" data-id="${v.id}" title="Editar">${ICONO.editar}</button>
                  <button class="icono peligro" data-accion="borrar-vacante" data-id="${v.id}" title="Eliminar">${ICONO.borrar}</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="7" class="vacio">No hay vacantes con estos filtros.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>`;

  el.onchange = e => {
    const f = e.target.dataset.filtro;
    if (f) { datos.filtros[f] = e.target.value; render(); }
  };
  el.onclick = e => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const v = datos.vacantes.find(x => x.id === Number(b.dataset.id));
    if (b.dataset.accion === 'nueva-vacante') formVacante();
    if (b.dataset.accion === 'ver-vacante') verVacante(v.id);
    if (b.dataset.accion === 'editar-vacante') formVacante(v);
    if (b.dataset.accion === 'borrar-vacante') {
      eliminar(`/api/vacantes/${v.id}`,
        `¿Eliminar la vacante de ${v.cliente} en ${v.localidad}? También se eliminarán sus ${plural(v.proveedores, 'proveedor asignado', 'proveedores asignados')}.`,
        'Vacante eliminada');
    }
  };
}

function formVacante(v) {
  abrirFormulario({
    titulo: v ? 'Editar vacante' : 'Nueva vacante',
    valores: v ?? { cantidad: 1, fecha_arranque: hoy() },
    campos: [
      { name: 'cliente_id', label: 'Cliente', type: 'select', required: true, opciones: opciones('clientes') },
      { name: 'localidad_id', label: 'Localidad', type: 'select', required: true, opciones: opciones('localidades') },
      { name: 'tipo_vehiculo_id', label: 'Tipo de vehículo', type: 'select', required: true, opciones: opciones('tipos-vehiculo') },
      { name: 'cantidad', label: 'Cantidad de unidades', type: 'number', min: 1, required: true },
      { name: 'fecha_arranque', label: 'Fecha de arranque', type: 'date', required: true },
      { name: 'notas', label: 'Notas', type: 'textarea' },
    ],
    guardar: d => v ? api('PUT', `/api/vacantes/${v.id}`, d) : api('POST', '/api/vacantes', d),
    exito: v ? 'Vacante actualizada' : 'Vacante creada',
  });
}

function verVacante(id) {
  const v = datos.vacantes.find(x => x.id === id);
  if (!v) return;
  const asignados = datos.asignaciones.filter(a => a.vacante_id === id);
  const volver = () => verVacante(id);
  const modal = $('#modal');
  modal.innerHTML = `
    <div class="formulario detalle">
      <header>
        <div>
          <h3>${esc(v.cliente)} · ${esc(v.localidad)}</h3>
          <p class="sub">${esc(v.tipo_vehiculo)} · ${plural(v.cantidad, 'unidad', 'unidades')} · arranque ${fmt(v.fecha_arranque)} ${chipArranque(v)}</p>
        </div>
        <button type="button" class="cerrar" aria-label="Cerrar">×</button>
      </header>
      <div class="cuerpo">
        ${barraCobertura(v)}
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
              </tr>`).join('') || '<tr><td colspan="6" class="vacio">Aún no hay proveedores asignados a esta vacante.</td></tr>'}
          </tbody>
        </table>
      </div>
      <footer><button type="button" class="btn primario" data-accion="agregar">+ Asignar proveedor</button></footer>
    </div>`;
  const cont = modal.firstElementChild;
  cont.onclick = e => {
    if (e.target.closest('.cerrar')) return modal.close();
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const a = datos.asignaciones.find(x => x.id === Number(b.dataset.id));
    if (b.dataset.accion === 'agregar') formAsignacion(null, { vacanteId: id, despues: volver });
    if (b.dataset.accion === 'editar') formAsignacion(a, { despues: volver });
    if (b.dataset.accion === 'borrar') eliminar(`/api/asignaciones/${a.id}`, `¿Quitar a ${a.proveedor} de esta vacante?`, 'Proveedor eliminado', volver);
  };
  if (!modal.open) modal.showModal();
}

// --- Pipeline de proveedores ---

function formAsignacion(a, { vacanteId, despues } = {}) {
  abrirFormulario({
    titulo: a ? 'Editar proveedor' : 'Asignar proveedor',
    valores: a ?? { vacante_id: vacanteId, reclutador_id: reclutadorActivo(), unidades: 1, fecha_disponibilidad: hoy(), estado: 'Prospección' },
    campos: [
      { name: 'vacante_id', label: 'Vacante', type: 'select', required: true, ancho: true,
        opciones: datos.vacantes.map(v => ({ value: v.id, label: `${v.cliente} · ${v.localidad} · ${v.tipo_vehiculo} (${v.cantidad} u.)` })) },
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
    aviso(nuevo === 'Operativo' ? `${a.proveedor} pasó a Operativo y entró a onboarding` : `${a.proveedor} → ${nuevo}`);
    await cargar();
  } catch (err) {
    aviso(err.message, true);
  }
}

function tarjeta(a) {
  return `
    <article class="tarjeta" draggable="true" data-id="${a.id}">
      <strong>${esc(a.proveedor)}</strong>
      <span class="meta">${esc(a.cliente)} · ${esc(a.localidad)}</span>
      <span class="meta">${esc(a.tipo_vehiculo)}</span>
      <div class="pie">
        <span class="pastilla">${a.unidades} u.</span>
        <span class="meta">Disp. ${fmtCorto(a.fecha_disponibilidad)}</span>
        <span class="avatar" title="${esc(a.reclutador)}">${esc(iniciales(a.reclutador))}</span>
      </div>
      <select class="mover" data-id="${a.id}" aria-label="Cambiar estado de ${esc(a.proveedor)}">
        ${ESTADOS.map(e => `<option ${e === a.estado ? 'selected' : ''}>${e}</option>`).join('')}
      </select>
    </article>`;
}

function renderPipeline(el) {
  const { reclutador, cliente } = datos.filtros;
  const lista = datos.asignaciones.filter(a => (!reclutador || String(a.reclutador_id) === reclutador) && (!cliente || String(a.cliente_id) === cliente));

  el.innerHTML = `
    <section class="panel">
      <div class="panel-cab">
        <div>
          <h2>Pipeline de proveedores</h2>
          <p class="sub">Arrastra una tarjeta a otra columna o usa el selector para cambiar su estado.</p>
        </div>
        <div class="acciones">
          ${selectFiltro('reclutador', 'Reclutador', 'reclutadores')}
          ${selectFiltro('cliente', 'Cliente', 'clientes')}
          <button class="btn primario" data-accion="nuevo">+ Asignar proveedor</button>
        </div>
      </div>
    </section>
    <div class="kanban">
      ${ESTADOS.map(e => {
        const items = lista.filter(a => a.estado === e);
        return `
          <section class="columna ${CLASE_ESTADO[e]}" data-estado="${e}">
            <header><h3>${e}</h3><span>${items.length} · ${sumar(items, 'unidades')} u.</span></header>
            <div class="tarjetas">${items.map(tarjeta).join('') || '<p class="vacio">Sin proveedores</p>'}</div>
          </section>`;
      }).join('')}
    </div>`;

  const limpiar = () => $$('.columna.sobre').forEach(c => c.classList.remove('sobre'));
  el.onchange = e => {
    if (e.target.dataset.filtro) { datos.filtros[e.target.dataset.filtro] = e.target.value; render(); }
    if (e.target.matches('.mover')) cambiarEstado(Number(e.target.dataset.id), e.target.value);
  };
  el.onclick = e => {
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
              <thead><tr>${c.campos.map(f => `<th>${f.label}</th>`).join('')}<th class="num" title="${c.uso[0] === 'vacantes' ? 'Vacantes' : 'Proveedores'} que lo usan">En uso</th><th></th></tr></thead>
              <tbody>
                ${datos.cat[c.ruta].map(x => `
                  <tr>
                    ${c.campos.map((f, i) => `<td>${i === 0 ? `<strong>${esc(x[f.name])}</strong>` : esc(x[f.name]) || '<span class="tenue">—</span>'}</td>`).join('')}
                    <td class="num">${enUso(c, x.id)}</td>
                    <td class="acciones-fila">
                      <button class="icono" data-accion="editar" data-ruta="${c.ruta}" data-id="${x.id}" title="Editar">${ICONO.editar}</button>
                      <button class="icono peligro" data-accion="borrar" data-ruta="${c.ruta}" data-id="${x.id}" title="Eliminar">${ICONO.borrar}</button>
                    </td>
                  </tr>`).join('') || `<tr><td colspan="${c.campos.length + 2}" class="vacio">Sin registros.</td></tr>`}
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
      <div class="acceso-marca"><span class="logo">BDB</span><div><strong>CRM Redex</strong><small>BDB Logística</small></div></div>
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
  const id = `campo-${c.name}`;
  const req = c.required ? 'required' : '';
  const v = valor ?? '';
  let control;
  if (c.type === 'select') {
    control = `<select id="${id}" name="${c.name}" ${req}>
      <option value="">${c.required ? 'Selecciona…' : 'Ninguno'}</option>
      ${c.opciones.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  } else if (c.type === 'textarea') {
    control = `<textarea id="${id}" name="${c.name}" rows="3">${esc(v)}</textarea>`;
  } else {
    const extras = [
      c.min != null ? `min="${c.min}"` : '',
      c.autocomplete ? `autocomplete="${c.autocomplete}"` : '',
      c.placeholder ? `placeholder="${esc(c.placeholder)}"` : '',
    ].join(' ');
    control = `<input id="${id}" name="${c.name}" type="${c.type ?? 'text'}" value="${c.type === 'password' ? '' : esc(v)}" ${extras} ${req}>`;
  }
  const ancho = c.ancho || c.type === 'textarea' ? 'ancho' : '';
  return `<label class="campo ${ancho}" for="${id}"><span>${esc(c.label)}${c.required ? ' *' : ''}</span>${control}</label>`;
}

function abrirFormulario({ titulo, campos, valores = {}, guardar, exito, despues }) {
  const modal = $('#modal');
  modal.innerHTML = `
    <form class="formulario" novalidate>
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
