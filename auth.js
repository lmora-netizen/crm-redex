'use strict';

const crypto = require('node:crypto');
const express = require('express');

const COOKIE = 'crm_sesion';
const HORAS_SESION = 12;
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
const ROLES = { admin: 'Administrador', reclutador: 'Reclutador' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashPassword(password) {
  const sal = crypto.randomBytes(16);
  return `scrypt:${sal.toString('hex')}:${crypto.scryptSync(password, sal, 64).toString('hex')}`;
}

function verificarPassword(password, guardado) {
  const [, sal, hash] = String(guardado).split(':');
  if (!sal || !hash) return false;
  const esperado = Buffer.from(hash, 'hex');
  return crypto.timingSafeEqual(esperado, crypto.scryptSync(password, Buffer.from(sal, 'hex'), esperado.length));
}

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

function leerCookie(req) {
  for (const parte of String(req.headers.cookie ?? '').split(';')) {
    const [clave, ...valor] = parte.trim().split('=');
    if (clave === COOKIE) return decodeURIComponent(valor.join('='));
  }
  return null;
}

function validarPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
  }
  return password;
}

function validarUsuario(valor) {
  const usuario = String(valor ?? '').trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(usuario)) {
    throw new HttpError(400, 'El usuario debe tener de 3 a 40 caracteres: letras, números, punto, guion o guion bajo');
  }
  return usuario;
}

function validarNombre(valor) {
  const nombre = String(valor ?? '').trim();
  if (!nombre) throw new HttpError(400, 'Nombre es obligatorio');
  return nombre;
}

function crearAuth(db) {
  const SELECT_USUARIO = `
    SELECT u.id, u.nombre, u.usuario, u.rol, u.reclutador_id, u.activo, u.creado_en, u.ultimo_acceso,
      r.nombre AS reclutador
    FROM usuarios u LEFT JOIN reclutadores r ON r.id = u.reclutador_id`;
  const obtenerUsuario = id => db.prepare(`${SELECT_USUARIO} WHERE u.id = ?`).get(id);
  const hayUsuarios = () => db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n > 0;
  const adminsActivos = () => db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1").get().n;

  function iniciarSesion(req, res, usuarioId) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare("DELETE FROM sesiones WHERE expira <= datetime('now')").run();
    db.prepare(`INSERT INTO sesiones (token_hash, usuario_id, expira) VALUES (?, ?, datetime('now', '+${HORAS_SESION} hours'))`)
      .run(hashToken(token), usuarioId);
    db.prepare('UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id = ?').run(usuarioId);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: HORAS_SESION * 3600 * 1000, path: '/' });
  }

  // Cierra las sesiones del usuario, salvo la de la petición actual si se indica
  function cerrarSesiones(usuarioId, excepto = null) {
    db.prepare('DELETE FROM sesiones WHERE usuario_id = ? AND token_hash IS NOT ?').run(usuarioId, excepto);
  }

  function sesionActual(req) {
    const token = leerCookie(req);
    if (!token) return null;
    const tokenHash = hashToken(token);
    const fila = db.prepare(`
      SELECT s.usuario_id FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.expira > datetime('now') AND u.activo = 1`).get(tokenHash);
    return fila ? { usuario: obtenerUsuario(fila.usuario_id), tokenHash } : null;
  }

  function requerirSesion(req, res, next) {
    const sesion = sesionActual(req);
    if (!sesion) return res.status(401).json({ error: 'Tu sesión expiró. Vuelve a iniciar sesión.' });
    req.usuario = sesion.usuario;
    req.tokenHash = sesion.tokenHash;
    next();
  }

  function requerirAdmin(req, res, next) {
    if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede gestionar usuarios' });
    next();
  }

  // Bloqueo temporal tras varios intentos fallidos, por usuario e IP
  const intentos = new Map();
  const claveIntento = (req, usuario) => `${req.ip}|${String(usuario).toLowerCase()}`;
  function comprobarBloqueo(clave) {
    const reg = intentos.get(clave);
    if (reg && reg.bloqueadoHasta > Date.now()) {
      const minutos = Math.ceil((reg.bloqueadoHasta - Date.now()) / 60000);
      throw new HttpError(429, `Demasiados intentos fallidos. Intenta de nuevo en ${minutos} min.`);
    }
  }
  function registrarFallo(clave) {
    const reg = intentos.get(clave) ?? { fallos: 0, bloqueadoHasta: 0 };
    reg.fallos += 1;
    if (reg.fallos >= MAX_INTENTOS) Object.assign(reg, { fallos: 0, bloqueadoHasta: Date.now() + BLOQUEO_MS });
    intentos.set(clave, reg);
  }

  const leerRol = rol => {
    if (!ROLES[rol]) throw new HttpError(400, 'Rol inválido');
    return rol;
  };
  const leerReclutador = valor => (valor === '' || valor == null ? null : Number(valor));

  // --- Rutas públicas de acceso ---
  const acceso = express.Router();

  acceso.get('/sesion', (req, res) => {
    const sesion = sesionActual(req);
    if (sesion) return res.json({ usuario: sesion.usuario });
    res.status(401).json({ error: 'No autenticado', necesitaConfiguracion: !hayUsuarios() });
  });

  // Solo funciona mientras no exista ningún usuario: crea el primer administrador
  acceso.post('/configurar', (req, res) => {
    if (hayUsuarios()) throw new HttpError(403, 'El sistema ya tiene usuarios. Pide un acceso a un administrador.');
    const b = req.body;
    const r = db.prepare("INSERT INTO usuarios (nombre, usuario, hash, rol) VALUES (?, ?, ?, 'admin')")
      .run(validarNombre(b.nombre), validarUsuario(b.usuario), hashPassword(validarPassword(b.password)));
    iniciarSesion(req, res, r.lastInsertRowid);
    res.status(201).json({ usuario: obtenerUsuario(r.lastInsertRowid) });
  });

  acceso.post('/login', (req, res) => {
    const { usuario, password } = req.body;
    if (!usuario || !password) throw new HttpError(400, 'Escribe tu usuario y contraseña');
    const clave = claveIntento(req, usuario);
    comprobarBloqueo(clave);
    const fila = db.prepare('SELECT id, hash, activo FROM usuarios WHERE usuario = ?').get(String(usuario).trim());
    if (!fila || !fila.activo || !verificarPassword(String(password), fila.hash)) {
      registrarFallo(clave);
      throw new HttpError(401, 'Usuario o contraseña incorrectos');
    }
    intentos.delete(clave);
    iniciarSesion(req, res, fila.id);
    res.json({ usuario: obtenerUsuario(fila.id) });
  });

  acceso.post('/logout', (req, res) => {
    const token = leerCookie(req);
    if (token) db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(hashToken(token));
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });

  acceso.post('/password', requerirSesion, (req, res) => {
    const fila = db.prepare('SELECT hash FROM usuarios WHERE id = ?').get(req.usuario.id);
    if (!verificarPassword(String(req.body.actual ?? ''), fila.hash)) throw new HttpError(400, 'La contraseña actual no es correcta');
    db.prepare('UPDATE usuarios SET hash = ? WHERE id = ?').run(hashPassword(validarPassword(req.body.nueva)), req.usuario.id);
    cerrarSesiones(req.usuario.id, req.tokenHash);
    res.status(204).end();
  });

  // --- Gestión de usuarios (solo administradores) ---
  const usuarios = express.Router();
  usuarios.use(requerirAdmin);

  usuarios.get('/', (req, res) => {
    res.json(db.prepare(`${SELECT_USUARIO} ORDER BY u.activo DESC, u.nombre`).all());
  });

  usuarios.post('/', (req, res) => {
    const b = req.body;
    const r = db.prepare('INSERT INTO usuarios (nombre, usuario, hash, rol, reclutador_id) VALUES (?, ?, ?, ?, ?)')
      .run(validarNombre(b.nombre), validarUsuario(b.usuario), hashPassword(validarPassword(b.password)), leerRol(b.rol), leerReclutador(b.reclutador_id));
    res.status(201).json(obtenerUsuario(r.lastInsertRowid));
  });

  usuarios.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const actual = obtenerUsuario(id);
    if (!actual) throw new HttpError(404, 'Usuario no encontrado');
    const b = req.body;
    const datos = {
      id,
      nombre: validarNombre(b.nombre),
      usuario: validarUsuario(b.usuario),
      rol: leerRol(b.rol),
      reclutador_id: leerReclutador(b.reclutador_id),
      activo: String(b.activo) === '0' ? 0 : 1,
    };
    const dejaDeSerAdmin = actual.rol === 'admin' && actual.activo && (datos.rol !== 'admin' || !datos.activo);
    if (dejaDeSerAdmin && adminsActivos() <= 1) throw new HttpError(400, 'Debe quedar al menos un administrador activo');
    if (id === req.usuario.id && !datos.activo) throw new HttpError(400, 'No puedes desactivar tu propio usuario');

    db.prepare(`
      UPDATE usuarios SET nombre = :nombre, usuario = :usuario, rol = :rol, reclutador_id = :reclutador_id, activo = :activo
      WHERE id = :id`).run(datos);
    if (b.password) {
      db.prepare('UPDATE usuarios SET hash = ? WHERE id = ?').run(hashPassword(validarPassword(b.password)), id);
      cerrarSesiones(id, id === req.usuario.id ? req.tokenHash : null);
    }
    if (!datos.activo) cerrarSesiones(id);
    res.json(obtenerUsuario(id));
  });

  usuarios.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const actual = obtenerUsuario(id);
    if (!actual) throw new HttpError(404, 'Usuario no encontrado');
    if (id === req.usuario.id) throw new HttpError(400, 'No puedes eliminar tu propio usuario');
    if (actual.rol === 'admin' && actual.activo && adminsActivos() <= 1) throw new HttpError(400, 'Debe quedar al menos un administrador activo');
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    res.status(204).end();
  });

  return { acceso, usuarios, requerirSesion };
}

module.exports = { crearAuth, HttpError };
