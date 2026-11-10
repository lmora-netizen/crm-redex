'use strict';

// Genera Migracion.js con los datos de la versión local (data/crm.db) para
// cargarlos una vez en la hoja de Google. Migracion.js no se sube a Git.
//   node apps-script/exportar-datos.js [correo del administrador]

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const raiz = path.join(__dirname, '..');
const db = new DatabaseSync(path.join(raiz, 'data', 'crm.db'), { readOnly: true });
const admin = (process.argv[2] || '').trim().toLowerCase();

// Pestaña de la hoja ← tabla local
const TABLAS = {
  Clientes: 'clientes',
  Localidades: 'localidades',
  TiposVehiculo: 'tipos_vehiculo',
  Reclutadores: 'reclutadores',
  Vacantes: 'vacantes',
  Proveedores: 'asignaciones',
  Etapas: 'etapas_asignacion',
  Onboarding: 'onboarding',
  Prospectos: 'prospectos',
  Bitacora: 'historial',
};

const datos = {};
for (const [pestana, tabla] of Object.entries(TABLAS)) {
  datos[pestana] = db.prepare(`SELECT * FROM ${tabla}`).all().map(fila => ({ ...fila }));
}
datos.Usuarios = admin ? [{ id: 1, correo: admin, nombre: 'Leslie Mora', rol: 'admin', activo: 1 }] : [];

const conteo = Object.entries(datos).map(([p, filas]) => `${p}: ${filas.length}`).join(', ');
const contenido = `// Datos de la versión local para cargar una vez en la hoja (generado por exportar-datos.js).
// Ejecuta migrarDatosIniciales() desde el editor y después borra este archivo.
// ${conteo}

const DATOS_MIGRACION = ${JSON.stringify(datos)};

function migrarDatosIniciales() {
  const libro = libro_();
  const conDatos = Object.keys(DATOS_MIGRACION)
    .filter(p => p !== 'Usuarios' && libro.getSheetByName(p) && libro.getSheetByName(p).getLastRow() > 1);
  if (conDatos.length) throw new Error('La hoja ya tiene datos en: ' + conDatos.join(', ') + '. No se migró nada.');
  Object.keys(DATOS_MIGRACION).forEach(pestana => {
    const hoja = pestana_(pestana);
    const columnas = ESQUEMA[pestana];
    const filas = DATOS_MIGRACION[pestana]
      .filter(f => pestana !== 'Usuarios' || !leer_('Usuarios').some(u => String(u.correo).toLowerCase() === f.correo))
      .map(f => columnas.map(c => (f[c] === null || f[c] === undefined ? '' : f[c])));
    if (filas.length) hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, columnas.length).setValues(filas);
  });
  limpiarCache_();
  Logger.log('Migración terminada: ${conteo}');
}
`;

fs.writeFileSync(path.join(__dirname, 'Migracion.js'), contenido);
console.log(`Migracion.js generado (${conteo})`);
