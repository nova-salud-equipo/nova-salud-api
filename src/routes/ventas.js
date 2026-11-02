import { Router } from 'express'
import { query, tx } from '../db.js'
import { requiere } from '../middlewares/auth.js'
import { bloquearProductos, registrarVenta, verificarStock } from '../services/inventario.js'
import { badRequest, notFound } from '../errors.js'
import { entero, items as validarItems, opcion } from '../validar.js'

const r = Router()
export const METODOS = ['Efectivo', 'Yape / Plin', 'Tarjeta']

async function clientePorNombre(db, nombre) {
  if (!nombre) return null
  const { rows: [c] } = await db.query('INSERT INTO clientes (nombre) VALUES ($1) RETURNING id', [nombre])
  return c.id
}

// Venta de mostrador (punto de venta).
r.post('/', requiere('Administrador', 'Cajero'), async (req, res) => {
  const items = validarItems(req.body.items)
  const metodoPago = opcion(req.body.metodoPago, 'metodoPago', METODOS)
  const nombre = typeof req.body.cliente === 'string' ? req.body.cliente.trim().slice(0, 120) : ''
  const segundos = req.body.segundosAtencion != null ? entero(req.body.segundosAtencion, 'segundosAtencion') : null
  const venta = await tx(async (db) => {
    const productos = await bloquearProductos(db, items.map((i) => i.productoId))
    const conReceta = items.filter((i) => productos.get(i.productoId).requiere_receta)
    if (conReceta.length && req.body.recetaVerificada !== true) throw badRequest('Hay productos que requieren receta. Confirma que la verificaste.')
    await verificarStock(db, items, productos)
    const clienteId = await clientePorNombre(db, nombre)
    return registrarVenta(db, { items, productos, canal: 'mostrador', clienteId, usuarioId: req.user.id, metodoPago, segundos })
  })
  res.status(201).json(await detalleVenta(venta.id))
})

r.get('/', requiere('Administrador', 'Cajero'), async (req, res) => {
  const dias = Math.min(entero(req.query.dias ?? 7, 'dias', 1), 365)
  const { rows } = await query(`
    SELECT v.id, v.numero, v.canal, v.metodo_pago, v.total, v.estado, v.fecha, COALESCE(c.nombre, 'Público general') AS cliente, u.nombre AS usuario
    FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id LEFT JOIN usuarios u ON u.id = v.usuario_id
    WHERE dia_lima(v.fecha) >= hoy_lima() - ($1::int - 1) ORDER BY v.fecha DESC`, [dias])
  res.json(rows)
})

r.get('/:id', requiere('Administrador', 'Cajero'), async (req, res) => {
  res.json(await detalleVenta(entero(req.params.id, 'id', 1)))
})

r.post('/:id/anular', requiere('Administrador'), async (req, res) => {
  const id = entero(req.params.id, 'id', 1)
  await tx(async (db) => {
    const { rows: [v] } = await db.query('SELECT * FROM ventas WHERE id = $1 FOR UPDATE', [id])
    if (!v) throw notFound('Venta no encontrada.')
    if (v.estado === 'Anulada') throw badRequest('La venta ya estaba anulada.')
    const { rows: det } = await db.query('SELECT * FROM detalle_ventas WHERE venta_id = $1', [id])
    for (const d of det) { // devuelve las unidades a su lote original
      await db.query('UPDATE lotes SET stock = stock + $1 WHERE id = $2', [d.cantidad, d.lote_id])
      await db.query("INSERT INTO movimientos_inventario (lote_id, tipo, cantidad, motivo, usuario_id) VALUES ($1,'ENTRADA',$2,$3,$4)", [d.lote_id, d.cantidad, 'Anulación ' + v.numero, req.user.id])
    }
    await db.query("UPDATE ventas SET estado = 'Anulada' WHERE id = $1", [id])
  })
  res.json(await detalleVenta(id))
})

export async function detalleVenta(id) {
  const { rows: [v] } = await query(`
    SELECT v.*, COALESCE(c.nombre, 'Público general') AS cliente, u.nombre AS usuario
    FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id LEFT JOIN usuarios u ON u.id = v.usuario_id WHERE v.id = $1`, [id])
  if (!v) throw notFound('Venta no encontrada.')
  const { rows: items } = await query(`
    SELECT p.nombre, SUM(d.cantidad)::int AS cantidad, d.precio_unitario FROM detalle_ventas d JOIN productos p ON p.id = d.producto_id
    WHERE d.venta_id = $1 GROUP BY p.nombre, d.precio_unitario, d.producto_id ORDER BY MIN(d.id)`, [id])
  return { ...v, items }
}

export default r
