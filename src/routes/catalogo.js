// Rutas públicas para la tienda web (sin login). Nunca exponen costos ni lotes.
import { Router } from 'express'
import { query } from '../db.js'
import { SQL_STOCK, precioFinal } from '../services/inventario.js'

const r = Router()

r.get('/productos', async (_req, res) => {
  const { rows } = await query(`
    SELECT p.id, p.nombre, p.presentacion, p.precio, p.en_promocion, p.requiere_receta, p.contiene_aine, c.nombre AS categoria, s.vigente, s.reservado
    FROM productos p JOIN categorias c ON c.id = p.categoria_id JOIN (${SQL_STOCK}) s ON s.id = p.id
    WHERE p.activo ORDER BY c.nombre, p.nombre`)
  res.json(rows.map((p) => {
    const disponible = Math.max(0, p.vigente - p.reservado)
    return {
      id: p.id, nombre: p.nombre, presentacion: p.presentacion, categoria: p.categoria,
      precio: Number(p.precio), precioFinal: precioFinal(p), enPromocion: p.en_promocion, requiereReceta: p.requiere_receta,
      contieneAine: p.contiene_aine,
      disponible: Math.min(disponible, 20), // la tienda solo necesita saber si hay y un tope por pedido
      agotado: disponible === 0,
    }
  }))
})

r.get('/categorias', async (_req, res) => {
  const { rows } = await query('SELECT id, nombre FROM categorias ORDER BY nombre')
  res.json(rows)
})

export default r
