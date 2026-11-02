import { Router } from 'express'
import { query } from '../db.js'
import { requiere } from '../middlewares/auth.js'
import { calcularAlertas } from '../services/inventario.js'
import { entero } from '../validar.js'

const r = Router()

r.get('/alertas', requiere(), async (_req, res) => res.json(await calcularAlertas({ query })))

r.get('/resumen', requiere(), async (_req, res) => {
  const { rows: [hoy] } = await query(`
    SELECT COALESCE(SUM(total),0) AS total, COUNT(*)::int AS boletas,
      COALESCE(SUM(total) FILTER (WHERE canal = 'web'),0) AS web
    FROM ventas WHERE estado = 'Pagada' AND dia_lima(fecha) = hoy_lima()`)
  const { rows: dias } = await query(`
    SELECT to_char(d, 'YYYY-MM-DD') AS fecha, COALESCE(SUM(v.total),0) AS total
    FROM generate_series(hoy_lima() - 6, hoy_lima(), interval '1 day') d
    LEFT JOIN ventas v ON dia_lima(v.fecha) = d::date AND v.estado = 'Pagada' GROUP BY d ORDER BY d`)
  const { rows: [ped] } = await query("SELECT COUNT(*)::int AS pendientes FROM pedidos_web WHERE estado IN ('Pendiente','Preparado')")
  const alertas = await calcularAlertas({ query })
  res.json({ hoy, dias, pedidosPendientes: ped.pendientes, alertas: alertas.length, stockBajo: alertas.filter((a) => a.tipo === 'Stock bajo').length, porVencer: alertas.filter((a) => a.tipo !== 'Stock bajo').length })
})

r.get('/ventas', requiere('Administrador'), async (req, res) => {
  const dias = Math.min(entero(req.query.dias ?? 7, 'dias', 1), 365)
  const desde = `hoy_lima() - (${dias} - 1)`
  const base = `FROM ventas v WHERE v.estado = 'Pagada' AND dia_lima(v.fecha) >= ${desde}`
  const [{ rows: [k] }, { rows: top }, { rows: cat }, { rows: met }, { rows: canal }] = await Promise.all([
    query(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*)::int AS boletas, COALESCE(AVG(total),0) AS ticket,
      COALESCE(AVG(segundos_atencion),0) AS segundos,
      (SELECT COUNT(*)::int FROM ventas WHERE estado = 'Anulada' AND dia_lima(fecha) >= ${desde}) AS anuladas ${base}`),
    query(`SELECT p.nombre, SUM(d.cantidad)::int AS valor FROM detalle_ventas d JOIN ventas v ON v.id = d.venta_id JOIN productos p ON p.id = d.producto_id
      WHERE v.estado = 'Pagada' AND dia_lima(v.fecha) >= ${desde} GROUP BY p.nombre ORDER BY valor DESC LIMIT 6`),
    query(`SELECT c.nombre, SUM(d.cantidad * d.precio_unitario) AS valor FROM detalle_ventas d JOIN ventas v ON v.id = d.venta_id
      JOIN productos p ON p.id = d.producto_id JOIN categorias c ON c.id = p.categoria_id
      WHERE v.estado = 'Pagada' AND dia_lima(v.fecha) >= ${desde} GROUP BY c.nombre ORDER BY valor DESC`),
    query(`SELECT metodo_pago AS nombre, SUM(total) AS valor ${base} GROUP BY metodo_pago ORDER BY valor DESC`),
    query(`SELECT canal AS nombre, SUM(total) AS valor, COUNT(*)::int AS boletas ${base} GROUP BY canal ORDER BY valor DESC`),
  ])
  res.json({ kpi: k, top, porCategoria: cat, porMetodo: met, porCanal: canal })
})

export default r
