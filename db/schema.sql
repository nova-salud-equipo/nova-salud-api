-- Esquema de Nova Salud (mini ERP). Se puede ejecutar varias veces: borra y recrea.
DROP TABLE IF EXISTS detalle_pedidos, pedidos_web, movimientos_inventario, detalle_ventas, ventas,
  detalle_compras, compras, lotes, productos, clientes, proveedores, categorias, usuarios, roles CASCADE;
DROP SEQUENCE IF EXISTS boleta_seq;

CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(30) UNIQUE NOT NULL
);

CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  email VARCHAR(120) UNIQUE NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  rol_id INT NOT NULL REFERENCES roles(id),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categorias (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(60) UNIQUE NOT NULL
);

CREATE TABLE proveedores (
  id SERIAL PRIMARY KEY,
  razon_social VARCHAR(120) NOT NULL,
  ruc CHAR(11) UNIQUE NOT NULL,
  telefono VARCHAR(20)
);

CREATE TABLE productos (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(20) UNIQUE NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  categoria_id INT NOT NULL REFERENCES categorias(id),
  proveedor_id INT REFERENCES proveedores(id),
  presentacion VARCHAR(80) NOT NULL,
  precio NUMERIC(10,2) NOT NULL CHECK (precio > 0),
  stock_minimo INT NOT NULL DEFAULT 10 CHECK (stock_minimo >= 0),
  requiere_receta BOOLEAN NOT NULL DEFAULT FALSE,
  en_promocion BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- Cada ingreso de mercadería entra como lote con su fecha de vencimiento.
CREATE TABLE lotes (
  id SERIAL PRIMARY KEY,
  producto_id INT NOT NULL REFERENCES productos(id),
  numero VARCHAR(30) NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  stock INT NOT NULL CHECK (stock >= 0),
  UNIQUE (producto_id, numero)
);

CREATE TABLE clientes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  celular VARCHAR(15),
  documento VARCHAR(12)
);

CREATE TABLE compras (
  id SERIAL PRIMARY KEY,
  proveedor_id INT NOT NULL REFERENCES proveedores(id),
  numero_factura VARCHAR(30) NOT NULL,
  fecha DATE NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  usuario_id INT NOT NULL REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE detalle_compras (
  id SERIAL PRIMARY KEY,
  compra_id INT NOT NULL REFERENCES compras(id),
  lote_id INT NOT NULL REFERENCES lotes(id),
  cantidad INT NOT NULL CHECK (cantidad > 0),
  costo_unitario NUMERIC(10,2) NOT NULL CHECK (costo_unitario > 0)
);

CREATE SEQUENCE boleta_seq START 1;

CREATE TABLE ventas (
  id SERIAL PRIMARY KEY,
  numero VARCHAR(20) UNIQUE NOT NULL,
  canal VARCHAR(10) NOT NULL DEFAULT 'mostrador' CHECK (canal IN ('mostrador','web')),
  cliente_id INT REFERENCES clientes(id),
  usuario_id INT REFERENCES usuarios(id),
  metodo_pago VARCHAR(20) NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL,
  igv NUMERIC(12,2) NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  estado VARCHAR(10) NOT NULL DEFAULT 'Pagada' CHECK (estado IN ('Pagada','Anulada')),
  segundos_atencion INT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE detalle_ventas (
  id SERIAL PRIMARY KEY,
  venta_id INT NOT NULL REFERENCES ventas(id),
  producto_id INT NOT NULL REFERENCES productos(id),
  lote_id INT REFERENCES lotes(id),
  cantidad INT NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(10,2) NOT NULL
);

-- Kárdex: toda entrada, salida o ajuste queda registrada.
CREATE TABLE movimientos_inventario (
  id SERIAL PRIMARY KEY,
  lote_id INT NOT NULL REFERENCES lotes(id),
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('ENTRADA','SALIDA','AJUSTE','BAJA')),
  cantidad INT NOT NULL,
  motivo VARCHAR(120) NOT NULL,
  usuario_id INT REFERENCES usuarios(id),
  fecha TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pedidos de la tienda web. Reservan stock hasta que se entregan o cancelan.
CREATE TABLE pedidos_web (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(12) UNIQUE,
  cliente_id INT NOT NULL REFERENCES clientes(id),
  metodo_pago VARCHAR(20) NOT NULL,
  entrega VARCHAR(10) NOT NULL CHECK (entrega IN ('recojo','delivery')),
  direccion VARCHAR(200),
  total NUMERIC(12,2) NOT NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Preparado','Entregado','Cancelado')),
  venta_id INT REFERENCES ventas(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE detalle_pedidos (
  id SERIAL PRIMARY KEY,
  pedido_id INT NOT NULL REFERENCES pedidos_web(id),
  producto_id INT NOT NULL REFERENCES productos(id),
  cantidad INT NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(10,2) NOT NULL
);

CREATE INDEX idx_lotes_producto ON lotes(producto_id, fecha_vencimiento);
CREATE INDEX idx_ventas_fecha ON ventas(fecha);
CREATE INDEX idx_pedidos_estado ON pedidos_web(estado);
