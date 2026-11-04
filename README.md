# CRM Redex

Tablero para registrar la capacidad requerida por vacante, el avance de los proveedores que asignan los reclutadores y el onboarding de sus primeras dos semanas.

## Secciones

- **Tablero**: vacantes (cliente, localidad, tipo de vehículo, cantidad y fecha de arranque) con su cobertura: unidades operativas, en proceso y por cubrir.
- **Proveedores**: pipeline por estado (Prospección → En documentación → Cierre de contrato → Operativo). Las tarjetas se mueven arrastrándolas o con el selector.
- **Onboarding**: proveedores en estado Operativo, con una columna por cada una de las dos semanas posteriores al ingreso para registrar rendimiento (% de cumplimiento), evaluación (1–5) y comentarios.
- **Catálogos**: alta, edición y baja de clientes, localidades, tipos de vehículo y reclutadores.
- **Usuarios** (solo administradores): alta de accesos internos, rol (Administrador o Reclutador), reclutador vinculado, activar/desactivar y restablecer contraseña.

## Usuarios y accesos

- No hay registro público. La primera vez que se abre el sistema sin usuarios aparece la pantalla **Configura el primer administrador**; después, los accesos se crean en la sección Usuarios.
- Las contraseñas se guardan cifradas (scrypt) y las sesiones duran 12 horas.
- Tras 5 intentos fallidos, el usuario queda bloqueado 15 minutos desde ese equipo.
- Al desactivar un usuario o cambiar su contraseña se cierran sus sesiones abiertas.
- El reclutador vinculado se usa como valor por defecto al asignar proveedores.

## Requisitos

- Node.js 22.13 o superior (usa el módulo SQLite integrado `node:sqlite`).

## Ejecutar en local

```bash
npm install
npm start
```

Abre http://localhost:3000. La primera vez se crea `data/crm.db` con datos demo.

Para volver a cargar los datos demo (borra lo registrado, pero conserva los usuarios):

```bash
npm run seed
```

Para que otros reclutadores de la misma red entren desde su equipo, inicia el servidor con `$env:HOST='0.0.0.0'; npm start` (PowerShell) y comparte `http://<ip-de-este-equipo>:3000`. Cada persona entra con el usuario que le creó el administrador.

## Estructura

- `server.js`: API REST (Express).
- `auth.js`: inicio de sesión, sesiones y gestión de usuarios.
- `db.js`: esquema SQLite y datos demo.
- `public/`: interfaz web (HTML, CSS y JavaScript sin compilación).
