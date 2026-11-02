# CRM Redex

Tablero para registrar la capacidad requerida por vacante, el avance de los proveedores que asignan los reclutadores y el onboarding de sus primeras dos semanas.

## Secciones

- **Tablero**: vacantes (cliente, localidad, tipo de vehículo, cantidad y fecha de arranque) con su cobertura: unidades operativas, en proceso y por cubrir.
- **Proveedores**: pipeline por estado (Prospección → En documentación → Cierre de contrato → Operativo). Las tarjetas se mueven arrastrándolas o con el selector.
- **Onboarding**: proveedores en estado Operativo, con una columna por cada una de las dos semanas posteriores al ingreso para registrar rendimiento (% de cumplimiento), evaluación (1–5) y comentarios.
- **Catálogos**: alta, edición y baja de clientes, localidades, tipos de vehículo y reclutadores.

## Requisitos

- Node.js 22.13 o superior (usa el módulo SQLite integrado `node:sqlite`).

## Ejecutar en local

```bash
npm install
npm start
```

Abre http://localhost:3000. La primera vez se crea `data/crm.db` con datos demo.

Para volver a cargar los datos demo (borra lo registrado):

```bash
npm run seed
```

Para que otros reclutadores de la misma red entren desde su equipo, inicia el servidor con `$env:HOST='0.0.0.0'; npm start` (PowerShell) y comparte `http://<ip-de-este-equipo>:3000`. Por ahora no hay inicio de sesión: cada persona elige su nombre en el selector "Reclutador".

## Estructura

- `server.js`: API REST (Express).
- `db.js`: esquema SQLite y datos demo.
- `public/`: interfaz web (HTML, CSS y JavaScript sin compilación).
