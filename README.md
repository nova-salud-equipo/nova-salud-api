# nova-salud-api

API REST del mini ERP de la botica **Nova Salud**: inventario por lotes, ventas, compras, alertas y pedidos de la tienda web.

Es uno de los tres repositorios del proyecto:

| Repo | Qué es |
|---|---|
| **nova-salud-api** (este) | Reglas de negocio y base de datos |
| [nova-salud-erp](https://github.com/nova-salud-equipo/nova-salud-erp) | Panel interno para el personal |
| [nova-salud-tienda](https://github.com/nova-salud-equipo/nova-salud-tienda) | Tienda web pública |

## Tecnologías
Node.js 20+, Express 5, PostgreSQL, JWT, bcrypt, Swagger (OpenAPI 3).

## Cómo ejecutarlo
1. Instala dependencias: `npm install`
2. Crea una base de datos PostgreSQL vacía (local, Docker o Supabase).
3. Copia `.env.example` como `.env` y completa `DATABASE_URL` y `JWT_SECRET`.
4. Crea las tablas y carga datos de prueba: `npm run db:reset`
5. Inicia la API: `npm run dev` → http://localhost:3000
6. Documentación interactiva: http://localhost:3000/docs

Con Docker, una base local en un solo comando:
```bash
docker run --name novasalud-db -e POSTGRES_USER=nova -e POSTGRES_PASSWORD=nova123 -e POSTGRES_DB=novasalud -p 5432:5432 -d postgres:16
```
y en `.env`: `DATABASE_URL=postgres://nova:nova123@localhost:5432/novasalud`

### Usuarios de prueba
| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | admin@novasalud.pe | admin123 |
| Cajero | cajero@novasalud.pe | cajero123 |
| Almacén | almacen@novasalud.pe | almacen123 |

## Variables de entorno
| Variable | Para qué sirve |
|---|---|
| `PORT` | Puerto de la API (3000 por defecto) |
| `DATABASE_URL` | Conexión a PostgreSQL |
| `DATABASE_SSL` | `true` si la base en la nube exige SSL |
| `JWT_SECRET` | Secreto para firmar los tokens de sesión |
| `CORS_ORIGINS` | Dominios del ERP y la tienda, separados por coma |

## Reglas de negocio principales
- **Stock por lotes y FEFO:** cada compra entra como lote con fecha de vencimiento; al vender se descuenta primero el lote que vence antes. Los lotes vencidos no se venden.
- **Stock disponible = vigente − reservado.** Un pedido web reserva unidades; se descuentan al entregarlo y se liberan si se cancela.
- **Ventas seguras:** cada venta corre en una transacción y bloquea los productos involucrados, así dos cajas no venden la misma unidad.
- **Alertas automáticas:** stock bajo (bajo el mínimo), lotes por vencer (30 días) y vencidos con stock.
- **Receta médica:** en mostrador exige confirmar que se verificó; en la tienda solo se permite recojo en tienda.
- **Kárdex:** toda entrada, salida, ajuste o baja queda en `movimientos_inventario`.
- **Permisos por rol** validados en el servidor (no solo en el menú).

## Estructura
```
src/
  app.js            configuración de Express (seguridad, CORS, rutas)
  server.js         arranque
  db.js             conexión y transacciones
  routes/           endpoints por módulo
  services/         reglas de negocio de inventario
  middlewares/      autenticación JWT y manejo de errores
db/   schema.sql, migrate.js, seed.js
docs/ openapi.yaml (Swagger)
test/ pruebas de los flujos principales
```

## Pruebas
Contra una base de **prueba** (borra los datos):
```bash
npm run db:reset && npm test
```

## Despliegue sugerido
- **Base de datos:** Supabase (PostgreSQL). En *Connect* usa la cadena **Session pooler** (funciona con IPv4) y pon `DATABASE_SSL=true`.
- **API:** Render (Web Service, `npm install` / `npm start`) con las variables de entorno de arriba.
- Carga las tablas una sola vez con `npm run db:reset` apuntando a la base de Supabase.

Las fechas del negocio (boletas, vencimientos, reportes) siempre se calculan en hora de Lima con las funciones `hoy_lima()` y `dia_lima()`, sin importar la zona horaria del servidor.
