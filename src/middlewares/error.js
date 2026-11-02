export function manejarErrores(err, _req, res, _next) {
  const status = err.status || 500
  if (status === 500) console.error(err)
  res.status(status).json({ error: status === 500 ? 'Ocurrió un error inesperado. Intenta de nuevo.' : err.message, ...(err.details ? { detalles: err.details } : {}) })
}
