// Agrega la marca "contiene AINE" a una base que ya está en uso, SIN borrar datos.
// Ejecuta: npm run db:aine   (se puede correr varias veces sin problema)
import 'dotenv/config'
import { pool } from '../src/db.js'

// Principios activos AINE más comunes. Se marcan los productos cuyo nombre los contenga.
const AINES = ['ibuprofeno', 'naproxeno', 'aspirina', 'ácido acetilsalicílico', 'acido acetilsalicilico', 'diclofenaco', 'ketorolaco', 'meloxicam', 'piroxicam', 'indometacina', 'ketoprofeno', 'celecoxib', 'metamizol', 'dexketoprofeno', 'nimesulida']

await pool.query('ALTER TABLE productos ADD COLUMN IF NOT EXISTS contiene_aine BOOLEAN NOT NULL DEFAULT FALSE')
const { rows } = await pool.query(
  `UPDATE productos SET contiene_aine = TRUE
   WHERE NOT contiene_aine AND lower(nombre) LIKE ANY ($1) RETURNING nombre`,
  [AINES.map((a) => `%${a}%`)])
console.log('Columna contiene_aine lista.')
console.log(rows.length ? 'Marcados como AINE: ' + rows.map((r) => r.nombre).join(', ') : 'No había productos nuevos por marcar.')
await pool.end()
