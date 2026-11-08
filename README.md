# CRM Redex

Tablero de BDB Logística para coordinar la capacidad por vacante: qué reclutador atiende cada ciudad, el avance de los proveedores y el onboarding de sus primeras dos semanas.

## Secciones

- **Resumen**: lo que pasó el día anterior (o el día que elijas), las prioridades para hoy ordenadas por urgencia y dónde concentrarse por ciudad y por reclutador.
- **Tablero**: vacantes agrupadas por reclutador con sus ciudades, con las columnas de la hoja de capacidad: cliente, ciudad, vehículo, esquema, tarifa, vigencia, objetivo, tentativo, cerrados, % de efectividad y avance de alta y capacitación. Al hacer clic en una vacante se ven dirección, operación, comentarios, seguimiento y sus proveedores.
- **Proveedores**: pipeline por estado (Prospección → En documentación → Cierre de contrato → Operativo), por reclutador o todo junto. Arriba muestra los días promedio de cierre (de registro a Operativo), en total y por reclutador. Al pasar a Operativo, las unidades se suman a los cerrados de la vacante.
- **Onboarding**: proveedores en Operativo, con una columna por cada una de las dos semanas posteriores al ingreso para registrar rendimiento (% de cumplimiento), evaluación (1–5) y comentarios.
- **Catálogos**: clientes, localidades, tipos de vehículo y reclutadores (con las ciudades que atiende cada uno).
- **Usuarios** (solo administradores): accesos internos, rol, reclutador vinculado, activar/desactivar y restablecer contraseña.

Cada alta, cambio de etapa, evaluación o edición de vacante queda en una bitácora; de ahí sale el Resumen.

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

Abre http://localhost:3000. Si la base de datos está vacía se crea `data/crm.db` con datos demo.

## Importar desde la hoja de Google

Las vacantes se cargan desde la hoja de capacidad (debe estar compartida como "Cualquier persona con el enlace"). El enlace va en `config.local.json`, que no se sube al repositorio:

```json
{ "hojaUrl": "https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<pestaña>" }
```

Luego:

```bash
npm run importar
```

Reemplaza clientes, localidades, tipos de vehículo y vacantes; conserva usuarios y reclutadores, y agrega los reclutadores nuevos que aparezcan en "Asignado". Si ya hay proveedores capturados en el pipeline se detiene, porque los borraría; para reemplazar de todos modos usa `npm run importar -- --forzar`. También acepta un CSV descargado: `npm run importar -- --archivo hoja.csv`.

Para volver a los datos demo (borra todo salvo los usuarios): `npm run seed -- --confirmar`.

## Red local

Para que otros reclutadores de la misma red entren desde su equipo, inicia el servidor con `$env:HOST='0.0.0.0'; npm start` (PowerShell) y comparte `http://<ip-de-este-equipo>:3000`. Cada persona entra con el usuario que le creó el administrador.

## Estructura

- `server.js`: API REST (Express) y bitácora de movimientos.
- `auth.js`: inicio de sesión, sesiones y gestión de usuarios.
- `db.js`: esquema SQLite, migraciones y datos demo.
- `importar-hoja.js`: importación de vacantes desde Google Sheets.
- `public/`: interfaz web (HTML, CSS y JavaScript sin compilación); `public/img/` tiene el logo y el fondo.
