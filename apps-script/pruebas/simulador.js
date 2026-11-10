'use strict';

// Simula en Node los servicios de Google que usa el proyecto (hoja de cálculo,
// sesión, candado, utilidades) y carga los archivos .js de Apps Script en un
// mismo ámbito global, como lo hace Apps Script.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function crearHoja(nombre) {
  const filas = [];
  const ancho = () => filas.reduce((m, f) => Math.max(m, f.length), 0);
  const ultimaFila = () => {
    for (let i = filas.length - 1; i >= 0; i--) if (filas[i].some(v => v !== '' && v !== null && v !== undefined)) return i + 1;
    return 0;
  };
  const rango = (fila, col, nf, nc) => ({
    getValues: () => Array.from({ length: nf }, (_, i) => Array.from({ length: nc }, (_, j) => {
      const v = (filas[fila - 1 + i] || [])[col - 1 + j];
      return v === undefined || v === null ? '' : v;
    })),
    setValues(valores) {
      valores.forEach((v, i) => {
        filas[fila - 1 + i] ??= [];
        v.forEach((x, j) => { filas[fila - 1 + i][col - 1 + j] = x; });
      });
      return this;
    },
    setNumberFormat() { return this; },
    setFontWeight() { return this; },
  });
  return {
    nombre,
    filas,
    getName: () => nombre,
    getMaxRows: () => 1000,
    getLastRow: ultimaFila,
    getLastColumn: ancho,
    getRange: rango,
    getDataRange: () => rango(1, 1, Math.max(1, ultimaFila()), Math.max(1, ancho())),
    appendRow(valores) { filas.splice(ultimaFila(), 0, valores.slice()); },
    deleteRow(n) { filas.splice(n - 1, 1); },
    setFrozenRows() {},
  };
}

function formatear(fecha, zona, formato) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha).map(p => [p.type, p.value]));
  return formato.replace('yyyy', partes.year).replace('MM', partes.month).replace('dd', partes.day)
    .replace('HH', partes.hour).replace('mm', partes.minute).replace('ss', partes.second);
}

function crearEntorno({ duenio }) {
  const hojas = new Map();
  const sesion = { correo: duenio };
  const libro = {
    getSheetByName: n => hojas.get(n) || null,
    insertSheet: n => { const h = crearHoja(n); hojas.set(n, h); return h; },
  };
  const contexto = {
    console,
    SpreadsheetApp: { getActive: () => libro, flush() {}, openById: () => libro },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Session: {
      getActiveUser: () => ({ getEmail: () => sesion.correo }),
      getEffectiveUser: () => ({ getEmail: () => duenio }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: formatear },
    Logger: { log: m => console.log(`  [Logger] ${m}`) },
    HtmlService: {},
  };
  vm.createContext(contexto);
  const carpeta = path.join(__dirname, '..');
  const archivos = fs.readdirSync(carpeta).filter(f => f.endsWith('.js') && f !== 'exportar-datos.js');
  // Apps Script comparte un solo ámbito global: se cargan todos juntos
  const codigo = archivos.map(f => fs.readFileSync(path.join(carpeta, f), 'utf8')).join('\n;\n');
  vm.runInContext(codigo, contexto, { filename: 'apps-script' });
  return {
    contexto,
    hojas,
    comoUsuario(correo) { sesion.correo = correo; },
    llamar(funcion, ...args) {
      contexto.__args = args;
      return vm.runInContext(`limpiarCache_(); ${funcion}(...__args)`, contexto);
    },
  };
}

module.exports = { crearEntorno };
