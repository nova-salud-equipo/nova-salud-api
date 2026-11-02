import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import fs from 'node:fs'
import YAML from 'yaml'
import swaggerUi from 'swagger-ui-express'
import auth from './routes/auth.js'
import catalogo from './routes/catalogo.js'
import productos from './routes/productos.js'
import ventas from './routes/ventas.js'
import compras from './routes/compras.js'
import pedidos from './routes/pedidos.js'
import reportes from './routes/reportes.js'
import { manejarErrores } from './middlewares/error.js'

export function crearApp() {
  const app = express()
  const origenes = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  app.use(helmet())
  // Solo el ERP y la tienda (dominios en CORS_ORIGINS) pueden llamar a la API desde el navegador.
  app.use(cors({ origin: origenes.length ? origenes : false }))
  app.use(express.json({ limit: '100kb' }))

  const spec = YAML.parse(fs.readFileSync(new URL('../docs/openapi.yaml', import.meta.url), 'utf8'))
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'API Nova Salud' }))

  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', auth)
  app.use('/api/catalogo', catalogo)
  app.use('/api/productos', productos)
  app.use('/api/ventas', ventas)
  app.use('/api/compras', compras)
  app.use('/api/pedidos', pedidos)
  app.use('/api/reportes', reportes)
  app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }))
  app.use(manejarErrores)
  return app
}
