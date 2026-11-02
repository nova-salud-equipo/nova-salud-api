import jwt from 'jsonwebtoken'
import { HttpError } from '../errors.js'

export function firmar(usuario) {
  return jwt.sign({ id: usuario.id, nombre: usuario.nombre, rol: usuario.rol }, process.env.JWT_SECRET, { expiresIn: '8h' })
}

// Exige un token válido y, si se indican, uno de los roles permitidos.
export const requiere = (...roles) => (req, _res, next) => {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return next(new HttpError(401, 'Inicia sesión para continuar.'))
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return next(new HttpError(401, 'Tu sesión expiró. Vuelve a iniciar sesión.'))
  }
  if (roles.length && !roles.includes(req.user.rol)) return next(new HttpError(403, 'Tu rol no tiene permiso para esta acción.'))
  next()
}
