'use strict';

// Sincronización automática con la hoja de Google (plantilla del tablero).
// Se conecta con una cuenta de servicio, así la hoja sigue privada: basta con
// compartirla como Lector con el correo de esa cuenta.
//
// config.local.json:
//   "sincronizacion": {
//     "hoja": "https://docs.google.com/spreadsheets/d/<id>/edit",
//     "credenciales": "credenciales/cuenta-servicio.json",
//     "minutos": 5
//   }

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { importarExcel } = require('./excel');

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HOJA_GOOGLE = 'application/vnd.google-apps.spreadsheet';

function leerConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8')).sincronizacion ?? null;
  } catch {
    return null;
  }
}

const idArchivo = hoja => String(hoja ?? '').match(/\/d\/([\w-]+)/)?.[1] ?? (/^[\w-]{20,}$/.test(hoja) ? hoja : null);

// Token de acceso de la cuenta de servicio (JWT firmado con su llave privada)
let tokenGuardado = null;
async function token(cred) {
  if (tokenGuardado && tokenGuardado.expira > Date.now() + 60000) return tokenGuardado.valor;
  const ahora = Math.floor(Date.now() / 1000);
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sinFirma = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: cred.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: cred.token_uri, iat: ahora, exp: ahora + 3600,
  })}`;
  const firma = crypto.createSign('RSA-SHA256').update(sinFirma).sign(cred.private_key, 'base64url');
  const r = await fetch(cred.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${sinFirma}.${firma}` }),
  });
  const res = await r.json();
  if (!r.ok) throw new Error(`Google rechazó la cuenta de servicio: ${res.error_description ?? res.error ?? r.status}`);
  tokenGuardado = { valor: res.access_token, expira: Date.now() + res.expires_in * 1000 };
  return tokenGuardado.valor;
}

async function drive(url, cred) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await token(cred)}` } });
  if (r.status === 404) throw new Error('La cuenta de servicio no ve la hoja: compártela con su correo como Lector.');
  if (r.status === 403) throw new Error('Google negó el acceso: revisa que la API de Google Drive esté habilitada en el proyecto.');
  if (!r.ok) throw new Error(`Error de Google Drive (HTTP ${r.status})`);
  return r;
}

function crearSincronizacion(db, dependencias) {
  let temporizador = null;
  let enCurso = null;

  const ultima = () => db.prepare('SELECT * FROM sincronizaciones ORDER BY id DESC LIMIT 1').get() ?? null;
  const ultimaModificacion = () => db.prepare("SELECT modificado FROM sincronizaciones WHERE estado IN ('ok', 'sin_cambios') ORDER BY id DESC LIMIT 1").get()?.modificado;
  // Se conserva solo el historial reciente (una revisión cada pocos minutos se acumula rápido)
  const anotar = (estado, modificado, detalle) => {
    db.prepare('INSERT INTO sincronizaciones (estado, modificado, detalle) VALUES (?, ?, ?)').run(estado, modificado ?? null, detalle);
    db.prepare('DELETE FROM sincronizaciones WHERE id <= (SELECT MAX(id) - 500 FROM sincronizaciones)').run();
  };

  function configuracion() {
    const c = leerConfig();
    if (!c?.hoja || !c?.credenciales) return { lista: false, motivo: 'Falta configurar la hoja y la cuenta de servicio en config.local.json' };
    const id = idArchivo(c.hoja);
    if (!id) return { lista: false, motivo: 'El enlace de la hoja no es válido' };
    const ruta = path.resolve(__dirname, c.credenciales);
    let cred;
    try {
      cred = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    } catch {
      return { lista: false, motivo: `No encontré el archivo de la cuenta de servicio (${c.credenciales})` };
    }
    if (!cred.client_email || !cred.private_key) return { lista: false, motivo: 'El archivo de la cuenta de servicio no es válido' };
    return { lista: true, id, cred, minutos: Math.max(1, Number(c.minutos) || 5), correo: cred.client_email };
  }

  async function sincronizar({ forzar = false } = {}) {
    if (enCurso) return enCurso;
    enCurso = (async () => {
      const cfg = configuracion();
      if (!cfg.lista) return { estado: 'sin_configurar', motivo: cfg.motivo };
      let modificado = null;
      try {
        const base = process.env.GOOGLE_DRIVE_API || 'https://www.googleapis.com/drive/v3/files';
        const meta = await (await drive(`${base}/${cfg.id}?fields=name,mimeType,modifiedTime&supportsAllDrives=true`, cfg.cred)).json();
        modificado = meta.modifiedTime;
        if (!forzar && modificado === ultimaModificacion()) {
          anotar('sin_cambios', modificado, null);
          return { estado: 'sin_cambios' };
        }
        // Hoja de cálculo de Google: se exporta a Excel. Un .xlsx subido a Drive se descarga tal cual.
        const url = meta.mimeType === HOJA_GOOGLE
          ? `${base}/${cfg.id}/export?mimeType=${encodeURIComponent(XLSX)}`
          : `${base}/${cfg.id}?alt=media&supportsAllDrives=true`;
        const archivo = Buffer.from(await (await drive(url, cfg.cred)).arrayBuffer());
        const resumen = await importarExcel(db, archivo, { ...dependencias, usuario: 'Sincronización Google', origen: 'Google Sheets', soloCambios: true });
        anotar('ok', modificado, JSON.stringify({ hoja: meta.name, ...resumen }));
        return { estado: 'ok', resumen };
      } catch (err) {
        anotar('error', modificado, err.message);
        return { estado: 'error', motivo: err.message };
      }
    })();
    try {
      return await enCurso;
    } finally {
      enCurso = null;
    }
  }

  function iniciar() {
    const cfg = configuracion();
    if (!cfg.lista) {
      console.log(`Sincronización con Google Sheets desactivada: ${cfg.motivo}`);
      return;
    }
    console.log(`Sincronización con Google Sheets cada ${cfg.minutos} min (${cfg.correo})`);
    sincronizar();
    temporizador = setInterval(() => sincronizar(), cfg.minutos * 60000);
    temporizador.unref();
  }

  function estado() {
    const cfg = configuracion();
    const u = ultima();
    const ultimaOk = db.prepare("SELECT fecha FROM sincronizaciones WHERE estado IN ('ok', 'sin_cambios') ORDER BY id DESC LIMIT 1").get()?.fecha ?? null;
    return {
      configurada: cfg.lista,
      motivo: cfg.lista ? null : cfg.motivo,
      correo: cfg.correo ?? null,
      minutos: cfg.minutos ?? null,
      ultima: u ? { fecha: u.fecha, estado: u.estado, detalle: u.estado === 'error' ? u.detalle : null } : null,
      ultimaCorrecta: ultimaOk,
    };
  }

  return { iniciar, sincronizar, estado };
}

module.exports = { crearSincronizacion };
