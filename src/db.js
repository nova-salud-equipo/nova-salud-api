import pg from 'pg'

pg.types.setTypeParser(1700, (v) => Number(v)) // NUMERIC -> number
pg.types.setTypeParser(1082, (v) => v) // DATE -> 'YYYY-MM-DD'

export const ZONA = process.env.TZ_NEGOCIO || 'America/Lima'
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c TimeZone=${ZONA}`, // fechas en hora de Lima (boletas, vencimientos, reportes)
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
})

export const hoy = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(d)
}

export const query = (text, params) => pool.query(text, params)

// Ejecuta fn dentro de una transacción: si algo falla, no se guarda nada.
export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await fn(client)
    await client.query('COMMIT')
    return r
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
