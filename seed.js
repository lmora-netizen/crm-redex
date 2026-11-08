'use strict';

// Reinicia la base de datos con datos demo: npm run seed -- --confirmar
// Borra vacantes, proveedores y catálogos reales (conserva usuarios).
const { abrir, sembrar, ARCHIVO_DB } = require('./db');

if (!process.argv.includes('--confirmar')) {
  console.error('Esto reemplaza todos los datos por datos demo. Ejecuta: npm run seed -- --confirmar');
  process.exit(1);
}

sembrar(abrir());
console.log(`Datos demo cargados en ${ARCHIVO_DB}`);
