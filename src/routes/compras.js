import { Router } from 'express'
import { hoy as hoyLima, query, tx } from '../db.js'
import { requiere } from '../middlewares/auth.js'
import { badRequest } from '../errors.js'
import { decimal, entero, fecha, texto } from '../validar.js'

const r = Router()

r.post('/', requiere('Administrador', 'Almacén'), async (req, res) => {
  const b = req.body
  const proveedorId = entero(b.proveedorId, 'proveedorId', 1)
  const factura = texto(b.factura, 'El N° de factura', 3, 30)
  const fechaIngreso = fecha(b.fecha, 'La fecha')
  if (!Array.isArray(b.lineas) || !b.lineas.length) throw badRequest('Agrega al menos un producto a la compra.')
  const lineas = b.lineas.map((l, i) => ({
    productoId: entero(l.productoId, `Línea ${i + 1}: producto`, 1),
    numero: texto(l.lote, `Línea ${i + 1}: lote`, 2, 30),
    vence: fecha(l.vence, `Línea ${i + 1}: vencimiento`),
    cantidad: entero(l.cantidad, `Línea ${i + 1}: cantidad`, 1),
    costo: decimal(l.costo, `Línea ${i + 1}: costo`),
  }))
  const hoy = hoyLima()
  const vencida = lineas.find((l) => l.vence <= hoy)
  if (vencida) throw badRequest(`El lote ${vencida.numero} ya está vencido o vence hoy. No se puede ingresar.`)

  const compra = await tx(async (db) => {
    const total = Math.round(lineas.reduce((t, l) => t + l.cantidad * l.costo, 0) * 100) / 100
    const { rows: [c] } = await db.query(
      'INSERT INTO compras (proveedor_id, numero_factura, fecha, total, usuario_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [proveedorId, factura, fechaIngreso, total, req.user.id])
    for (const l of lineas) {
      // Si el lote ya existe se suma; si no, se crea.
      const { rows: [lote] } = await db.query(
        `INSERT INTO lotes (producto_id, numero, fecha_vencimiento, stock) VALUES ($1,$2,$3,$4)
         ON CONFLICT (producto_id, numero) DO UPDATE SET stock = lotes.stock + EXCLUDED.stock RETURNING id`,
        [l.productoId, l.numero, l.vence, l.cantidad])
      await db.query('INSERT INTO detalle_compras (compra_id, lote_id, cantidad, costo_unitario) VALUES ($1,$2,$3,$4)', [c.id, lote.id, l.cantidad, l.costo])
      await db.query("INSERT INTO movimientos_inventario (lote_id, tipo, cantidad, motivo, usuario_id) VALUES ($1,'ENTRADA',$2,$3,$4)", [lote.id, l.cantidad, 'Compra ' + factura, req.user.id])
    }
    return c
  })
  res.status(201).json(compra)
})

r.get('/', requiere('Administrador', 'Almacén'), async (_req, res) => {
  const { rows } = await query(`
    SELECT c.id, c.numero_factura, c.fecha, c.total, pr.razon_social AS proveedor, u.nombre AS usuario,
      json_agg(json_build_object('producto', p.nombre, 'lote', l.numero, 'cantidad', d.cantidad, 'costo', d.costo_unitario)) AS lineas
    FROM compras c JOIN proveedores pr ON pr.id = c.proveedor_id JOIN usuarios u ON u.id = c.usuario_id
    JOIN detalle_compras d ON d.compra_id = c.id JOIN lotes l ON l.id = d.lote_id JOIN productos p ON p.id = l.producto_id
    GROUP BY c.id, pr.razon_social, u.nombre ORDER BY c.id DESC LIMIT 50`)
  res.json(rows)
})

r.get('/proveedores', requiere(), async (_req, res) => {
  const { rows } = await query('SELECT id, razon_social, ruc FROM proveedores ORDER BY razon_social')
  res.json(rows)
})

export default r
