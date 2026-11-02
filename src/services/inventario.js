import { conflict, notFound } from '../errors.js'

const r2 = (n) => Math.round(n * 100) / 100
export const precioFinal = (p) => (p.en_promocion ? r2(Number(p.precio) * 0.8) : Number(p.precio))
export const DIAS_POR_VENCER = 30

// Stock por producto:
//  vigente   = unidades en lotes no vencidos
//  reservado = unidades apartadas por pedidos web pendientes o preparados
//  disponible = vigente - reservado  (lo que realmente se puede vender)
export const SQL_STOCK = `
  SELECT p.id,
    COALESCE((SELECT SUM(l.stock) FROM lotes l WHERE l.producto_id = p.id), 0)::int AS total,
    COALESCE((SELECT SUM(l.stock) FROM lotes l WHERE l.producto_id = p.id AND l.fecha_vencimiento >= hoy_lima()), 0)::int AS vigente,
    COALESCE((SELECT SUM(d.cantidad) FROM detalle_pedidos d JOIN pedidos_web w ON w.id = d.pedido_id
              WHERE d.producto_id = p.id AND w.estado IN ('Pendiente','Preparado')), 0)::int AS reservado,
    (SELECT MIN(l.fecha_vencimiento) FROM lotes l WHERE l.producto_id = p.id AND l.stock > 0) AS proximo_vencimiento
  FROM productos p`

export async function stockDe(db, ids) {
  const { rows } = await db.query(`${SQL_STOCK} WHERE p.id = ANY($1)`, [ids])
  return new Map(rows.map((r) => [r.id, { ...r, disponible: r.vigente - r.reservado }]))
}

// Bloquea los productos involucrados para que dos ventas simultáneas no vendan la misma unidad.
export async function bloquearProductos(db, ids) {
  const { rows } = await db.query('SELECT * FROM productos WHERE id = ANY($1) AND activo ORDER BY id FOR UPDATE', [ids])
  if (rows.length !== ids.length) {
    const faltan = ids.filter((id) => !rows.some((r) => r.id === id))
    throw notFound(`No existe el producto ${faltan.join(', ')}.`)
  }
  return new Map(rows.map((r) => [r.id, r]))
}

// Verifica que haya stock. reservaPropia permite usar lo que el mismo pedido ya tenía apartado.
export async function verificarStock(db, items, productos, reservaPropia = new Map()) {
  const stock = await stockDe(db, items.map((i) => i.productoId))
  const faltantes = []
  for (const it of items) {
    const s = stock.get(it.productoId)
    const puede = s.disponible + (reservaPropia.get(it.productoId) || 0)
    if (it.cantidad > puede) faltantes.push({ productoId: it.productoId, nombre: productos.get(it.productoId).nombre, pedido: it.cantidad, disponible: Math.max(0, puede) })
  }
  if (faltantes.length) {
    const txt = faltantes.map((f) => `${f.nombre} (hay ${f.disponible})`).join(', ')
    throw conflict(`No hay stock suficiente de: ${txt}.`, faltantes)
  }
}

// FEFO: descuenta primero del lote que vence antes (solo lotes vigentes).
export async function descontarFEFO(db, productoId, cantidad, motivo, usuarioId) {
  const { rows: lotes } = await db.query(
    'SELECT id, stock FROM lotes WHERE producto_id = $1 AND stock > 0 AND fecha_vencimiento >= hoy_lima() ORDER BY fecha_vencimiento, id FOR UPDATE',
    [productoId])
  let resto = cantidad
  const salidas = []
  for (const l of lotes) {
    if (resto === 0) break
    const t = Math.min(l.stock, resto)
    await db.query('UPDATE lotes SET stock = stock - $1 WHERE id = $2', [t, l.id])
    await db.query("INSERT INTO movimientos_inventario (lote_id, tipo, cantidad, motivo, usuario_id) VALUES ($1,'SALIDA',$2,$3,$4)", [l.id, -t, motivo, usuarioId])
    salidas.push({ loteId: l.id, cantidad: t })
    resto -= t
  }
  if (resto > 0) throw conflict('El stock cambió mientras se registraba la venta. Revisa las cantidades.')
  return salidas
}

// Registra una venta completa (mostrador o web): boleta, detalle por lote y kárdex.
export async function registrarVenta(db, { items, productos, canal, clienteId, usuarioId, metodoPago, segundos }) {
  const { rows: [{ n }] } = await db.query("SELECT nextval('boleta_seq') AS n")
  const numero = 'B001-' + String(n).padStart(6, '0')
  const total = r2(items.reduce((t, i) => t + i.cantidad * precioFinal(productos.get(i.productoId)), 0))
  const subtotal = r2(total / 1.18)
  const { rows: [venta] } = await db.query(
    `INSERT INTO ventas (numero, canal, cliente_id, usuario_id, metodo_pago, subtotal, igv, total, segundos_atencion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [numero, canal, clienteId, usuarioId, metodoPago, subtotal, r2(total - subtotal), total, segundos ?? null])
  for (const it of items) {
    const p = productos.get(it.productoId)
    const salidas = await descontarFEFO(db, it.productoId, it.cantidad, 'Venta ' + numero, usuarioId)
    for (const s of salidas) {
      await db.query('INSERT INTO detalle_ventas (venta_id, producto_id, lote_id, cantidad, precio_unitario) VALUES ($1,$2,$3,$4,$5)',
        [venta.id, it.productoId, s.loteId, s.cantidad, precioFinal(p)])
    }
  }
  return venta
}

export async function calcularAlertas(db) {
  const { rows: stock } = await db.query(`
    SELECT s.*, p.nombre, p.codigo, p.stock_minimo FROM (${SQL_STOCK} WHERE p.activo) s JOIN productos p ON p.id = s.id`)
  const out = []
  for (const s of stock) {
    const disp = s.vigente - s.reservado
    if (disp < s.stock_minimo) out.push({ id: 'sb-' + s.id, tipo: 'Stock bajo', productoId: s.id, producto: s.nombre, detalle: `${disp} unidades disponibles (mínimo ${s.stock_minimo})` })
  }
  const { rows: lotes } = await db.query(`
    SELECT l.*, p.nombre, (l.fecha_vencimiento - hoy_lima()) AS dias FROM lotes l JOIN productos p ON p.id = l.producto_id
    WHERE l.stock > 0 AND l.fecha_vencimiento <= hoy_lima() + $1::int ORDER BY l.fecha_vencimiento`, [DIAS_POR_VENCER])
  for (const l of lotes) {
    const vencido = l.dias < 0
    out.push({
      id: (vencido ? 'v-' : 'pv-') + l.id, tipo: vencido ? 'Vencido' : 'Por vencer', productoId: l.producto_id, loteId: l.id, producto: l.nombre,
      detalle: vencido ? `Lote ${l.numero} venció el ${l.fecha_vencimiento} (${l.stock} u.)` : `Lote ${l.numero} vence el ${l.fecha_vencimiento} (en ${l.dias} días, ${l.stock} u.)`,
    })
  }
  return out
}
