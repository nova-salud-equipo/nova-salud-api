import { Router } from 'express'
import { hoy as hoyLima, query, tx } from '../db.js'
import { requiere } from '../middlewares/auth.js'
import { SQL_STOCK, precioFinal } from '../services/inventario.js'
import { badRequest, notFound } from '../errors.js'
import { decimal, entero, fecha, texto } from '../validar.js'

const r = Router()
const ADMIN = 'Administrador', ALMACEN = 'Almacén'

r.get('/', requiere(), async (_req, res) => {
  const { rows } = await query(`
    SELECT p.*, c.nombre AS categoria, pr.razon_social AS proveedor, s.total, s.vigente, s.reservado, s.proximo_vencimiento,
      COALESCE((SELECT json_agg(json_build_object('id', l.id, 'numero', l.numero, 'vence', l.fecha_vencimiento, 'stock', l.stock,
        'dias', l.fecha_vencimiento - hoy_lima()) ORDER BY l.fecha_vencimiento) FROM lotes l WHERE l.producto_id = p.id), '[]') AS lotes
    FROM productos p JOIN categorias c ON c.id = p.categoria_id LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
    JOIN (${SQL_STOCK}) s ON s.id = p.id WHERE p.activo ORDER BY p.codigo`)
  res.json(rows.map((p) => ({
    id: p.id, codigo: p.codigo, nombre: p.nombre, categoria: p.categoria, categoriaId: p.categoria_id, proveedor: p.proveedor,
    presentacion: p.presentacion, precio: Number(p.precio), precioFinal: precioFinal(p), stockMinimo: p.stock_minimo,
    requiereReceta: p.requiere_receta, enPromocion: p.en_promocion,
    stockTotal: p.total, vigente: p.vigente, reservado: p.reservado, disponible: p.vigente - p.reservado,
    proximoVencimiento: p.proximo_vencimiento, lotes: p.lotes,
  })))
})

r.post('/', requiere(ADMIN, ALMACEN), async (req, res) => {
  const b = req.body
  const nombre = texto(b.nombre, 'El nombre', 3, 120)
  const categoriaId = entero(b.categoriaId, 'categoriaId', 1)
  const precio = decimal(b.precio, 'El precio')
  const stockMinimo = entero(b.stockMinimo ?? 10, 'El stock mínimo')
  const presentacion = typeof b.presentacion === 'string' && b.presentacion.trim() ? b.presentacion.trim() : 'Unidad'
  // Stock inicial opcional: entra como un lote, igual que en una compra (con vencimiento, para FEFO).
  let inicial = null
  if (b.stockInicial) {
    inicial = {
      cantidad: entero(b.stockInicial.cantidad, 'La cantidad inicial', 1),
      numero: texto(b.stockInicial.lote, 'El N° de lote', 2, 30),
      vence: fecha(b.stockInicial.vence, 'El vencimiento'),
    }
    if (inicial.vence <= hoyLima()) throw badRequest(`El lote ${inicial.numero} ya está vencido o vence hoy. No se puede ingresar.`)
  }
  const producto = await tx(async (db) => {
    const { rows: [{ n }] } = await db.query('SELECT COALESCE(MAX(id),0) + 1 AS n FROM productos')
    const { rows: [p] } = await db.query(
      `INSERT INTO productos (codigo, nombre, categoria_id, proveedor_id, presentacion, precio, stock_minimo, requiere_receta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      ['MED-' + String(n).padStart(4, '0'), nombre, categoriaId, b.proveedorId || null, presentacion, precio, stockMinimo, Boolean(b.requiereReceta)])
    if (inicial) {
      const { rows: [lote] } = await db.query(
        'INSERT INTO lotes (producto_id, numero, fecha_vencimiento, stock) VALUES ($1,$2,$3,$4) RETURNING id',
        [p.id, inicial.numero, inicial.vence, inicial.cantidad])
      await db.query("INSERT INTO movimientos_inventario (lote_id, tipo, cantidad, motivo, usuario_id) VALUES ($1,'ENTRADA',$2,'Stock inicial',$3)",
        [lote.id, inicial.cantidad, req.user.id])
    }
    return p
  })
  res.status(201).json(producto)
})

// Cambios de precio, mínimo o promoción: solo el administrador.
r.patch('/:id', requiere(ADMIN), async (req, res) => {
  const id = entero(req.params.id, 'id', 1)
  const campos = []
  const vals = []
  if (req.body.precio !== undefined) { vals.push(decimal(req.body.precio, 'El precio')); campos.push(`precio = $${vals.length}`) }
  if (req.body.stockMinimo !== undefined) { vals.push(entero(req.body.stockMinimo, 'El stock mínimo')); campos.push(`stock_minimo = $${vals.length}`) }
  if (req.body.enPromocion !== undefined) { vals.push(Boolean(req.body.enPromocion)); campos.push(`en_promocion = $${vals.length}`) }
  if (!campos.length) throw badRequest('No enviaste ningún cambio.')
  vals.push(id)
  const { rows: [p] } = await query(`UPDATE productos SET ${campos.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)
  if (!p) throw notFound('Producto no encontrado.')
  res.json(p)
})

// Ajuste de stock de un lote (conteo físico, merma, baja por vencimiento).
r.post('/lotes/:loteId/ajuste', requiere(ADMIN, ALMACEN), async (req, res) => {
  const loteId = entero(req.params.loteId, 'loteId', 1)
  const nuevo = entero(req.body.nuevoStock, 'El nuevo stock')
  const motivo = texto(req.body.motivo, 'El motivo', 3, 120)
  const tipo = req.body.tipo === 'BAJA' ? 'BAJA' : 'AJUSTE'
  const lote = await tx(async (db) => {
    const { rows: [l] } = await db.query('SELECT * FROM lotes WHERE id = $1 FOR UPDATE', [loteId])
    if (!l) throw notFound('Lote no encontrado.')
    await db.query('UPDATE lotes SET stock = $1 WHERE id = $2', [nuevo, loteId])
    await db.query('INSERT INTO movimientos_inventario (lote_id, tipo, cantidad, motivo, usuario_id) VALUES ($1,$2,$3,$4,$5)', [loteId, tipo, nuevo - l.stock, motivo, req.user.id])
    return { ...l, stock: nuevo }
  })
  res.json(lote)
})

r.get('/movimientos', requiere(), async (req, res) => {
  const limite = Math.min(entero(req.query.limite ?? 20, 'limite', 1), 200)
  const { rows } = await query(`
    SELECT m.id, m.tipo, m.cantidad, m.motivo, m.fecha, l.numero AS lote, p.nombre AS producto, u.nombre AS usuario
    FROM movimientos_inventario m JOIN lotes l ON l.id = m.lote_id JOIN productos p ON p.id = l.producto_id
    LEFT JOIN usuarios u ON u.id = m.usuario_id ORDER BY m.id DESC LIMIT $1`, [limite])
  res.json(rows)
})

export default r
