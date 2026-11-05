import { Router } from 'express'
import { query, tx } from '../db.js'
import { requiere } from '../middlewares/auth.js'
import { bloquearProductos, precioFinal, registrarVenta, verificarStock } from '../services/inventario.js'
import { HttpError, badRequest, notFound } from '../errors.js'
import { entero, items as validarItems, opcion, texto } from '../validar.js'

const r = Router()
const METODOS_WEB = ['Yape / Plin', 'Tarjeta', 'Contra entrega']
const TRANSICIONES = { Pendiente: ['Preparado', 'Cancelado'], Preparado: ['Entregado', 'Cancelado'], Entregado: [], Cancelado: [] }

// PÚBLICO: la tienda crea un pedido. El pago es simulado; el stock queda reservado.
r.post('/', async (req, res) => {
  const items = validarItems(req.body.items)
  const nombre = texto(req.body.cliente?.nombre, 'Tu nombre', 2, 120)
  const celular = String(req.body.cliente?.celular || '').replace(/\D/g, '')
  if (!/^9\d{8}$/.test(celular)) throw badRequest('Ingresa un celular válido de 9 dígitos que empiece con 9.')
  const metodoPago = opcion(req.body.metodoPago, 'metodoPago', METODOS_WEB)
  const entrega = opcion(req.body.entrega, 'entrega', ['recojo', 'delivery'])
  const direccion = entrega === 'delivery' ? texto(req.body.direccion, 'La dirección', 5, 200) : null
  if (req.body.simularFallo === true && metodoPago !== 'Contra entrega') throw new HttpError(402, 'El pago fue rechazado por el banco (simulación). No se te cobró nada.')

  const pedido = await tx(async (db) => {
    const productos = await bloquearProductos(db, items.map((i) => i.productoId))
    const conReceta = items.filter((i) => productos.get(i.productoId).requiere_receta)
    if (conReceta.length && entrega !== 'recojo') throw badRequest('Los productos con receta solo se pueden recoger en tienda, presentando la receta.')
    await verificarStock(db, items, productos)
    const { rows: [c] } = await db.query('INSERT INTO clientes (nombre, celular) VALUES ($1,$2) RETURNING id', [nombre, celular])
    const total = Math.round(items.reduce((t, i) => t + i.cantidad * precioFinal(productos.get(i.productoId)), 0) * 100) / 100
    const { rows: [p] } = await db.query(
      'INSERT INTO pedidos_web (cliente_id, metodo_pago, entrega, direccion, total) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [c.id, metodoPago, entrega, direccion, total])
    const codigo = 'NS-' + (1000 + p.id)
    await db.query('UPDATE pedidos_web SET codigo = $1 WHERE id = $2', [codigo, p.id])
    for (const it of items) {
      await db.query('INSERT INTO detalle_pedidos (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1,$2,$3,$4)',
        [p.id, it.productoId, it.cantidad, precioFinal(productos.get(it.productoId))])
    }
    return { ...p, codigo }
  })
  res.status(201).json(await detallePedido(pedido.id))
})

// PÚBLICO: seguimiento. Pide código y celular para que nadie vea pedidos ajenos.
r.get('/seguimiento/:codigo', async (req, res) => {
  const celular = String(req.query.celular || '').replace(/\D/g, '')
  const { rows: [p] } = await query(
    'SELECT w.id FROM pedidos_web w JOIN clientes c ON c.id = w.cliente_id WHERE upper(w.codigo) = upper($1) AND c.celular = $2', [req.params.codigo, celular])
  if (!p) throw notFound('No encontramos un pedido con ese código y celular. Revisa los datos.')
  const d = await detallePedido(p.id)
  delete d.direccion
  res.json(d)
})

// ERP: lista y gestión de pedidos web.
r.get('/', requiere(), async (req, res) => {
  const estado = req.query.estado
  const { rows } = await query(`
    SELECT w.id FROM pedidos_web w ${estado ? 'WHERE w.estado = $1' : ''} ORDER BY w.id DESC LIMIT 100`, estado ? [estado] : [])
  res.json(await Promise.all(rows.map((r) => detallePedido(r.id))))
})

r.patch('/:id/estado', requiere('Administrador', 'Cajero'), async (req, res) => {
  const id = entero(req.params.id, 'id', 1)
  const nuevo = opcion(req.body.estado, 'estado', ['Preparado', 'Entregado', 'Cancelado'])
  await tx(async (db) => {
    const { rows: [p] } = await db.query('SELECT * FROM pedidos_web WHERE id = $1 FOR UPDATE', [id])
    if (!p) throw notFound('Pedido no encontrado.')
    if (!TRANSICIONES[p.estado].includes(nuevo)) throw badRequest(`Un pedido ${p.estado.toLowerCase()} no puede pasar a ${nuevo.toLowerCase()}.`)
    let ventaId = null
    if (nuevo === 'Entregado') {
      // Al entregar se convierte en venta: descuenta por FEFO y genera boleta.
      const { rows: det } = await db.query('SELECT producto_id, cantidad, precio_unitario FROM detalle_pedidos WHERE pedido_id = $1', [id])
      const items = det.map((d) => ({ productoId: d.producto_id, cantidad: d.cantidad }))
      const productos = await bloquearProductos(db, items.map((i) => i.productoId))
      // Se cobra el precio con el que el cliente hizo el pedido, aunque luego cambie.
      for (const d of det) productos.set(d.producto_id, { ...productos.get(d.producto_id), precio: d.precio_unitario, en_promocion: false })
      await verificarStock(db, items, productos, new Map(items.map((i) => [i.productoId, i.cantidad])))
      const venta = await registrarVenta(db, { items, productos, canal: 'web', clienteId: p.cliente_id, usuarioId: req.user.id, metodoPago: p.metodo_pago === 'Contra entrega' ? 'Efectivo' : p.metodo_pago })
      ventaId = venta.id
    }
    await db.query('UPDATE pedidos_web SET estado = $1, venta_id = COALESCE($2, venta_id), actualizado_en = now() WHERE id = $3', [nuevo, ventaId, id])
  })
  res.json(await detallePedido(id))
})

async function detallePedido(id) {
  const { rows: [p] } = await query(`
    SELECT w.id, w.codigo, w.metodo_pago, w.entrega, w.direccion, w.total, w.estado, w.creado_en, w.actualizado_en,
      c.nombre AS cliente, c.celular, v.numero AS boleta
    FROM pedidos_web w JOIN clientes c ON c.id = w.cliente_id LEFT JOIN ventas v ON v.id = w.venta_id WHERE w.id = $1`, [id])
  const { rows: items } = await query(`
    SELECT d.producto_id AS "productoId", p.nombre, d.cantidad, d.precio_unitario AS precio, p.requiere_receta AS "requiereReceta", p.contiene_aine AS "contieneAine"
    FROM detalle_pedidos d JOIN productos p ON p.id = d.producto_id WHERE d.pedido_id = $1 ORDER BY d.id`, [id])
  return { ...p, items }
}

export default r
