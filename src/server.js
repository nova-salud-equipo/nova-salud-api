import 'dotenv/config'
import { crearApp } from './app.js'

for (const v of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[v]) { console.error(`Falta la variable de entorno ${v}. Copia .env.example a .env y complétala.`); process.exit(1) }
}
const port = Number(process.env.PORT) || 3000
crearApp().listen(port, () => console.log(`API Nova Salud en http://localhost:${port}  ·  docs en /docs`))
