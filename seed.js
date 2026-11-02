'use strict';

// Reinicia la base de datos con datos demo: npm run seed
const { abrir, sembrar, ARCHIVO_DB } = require('./db');

sembrar(abrir());
console.log(`Datos demo cargados en ${ARCHIVO_DB}`);
