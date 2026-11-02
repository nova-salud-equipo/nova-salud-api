import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { query } from '../db.js'
import { firmar, requiere } from '../middlewares/auth.js'
import { HttpError } from '../errors.js'
import { texto } from '../validar.js'

const r = Router()

r.post('/login', async (req, res) => {
  const email = texto(req.body.email, 'El correo', 3, 120).toLowerCase()
  const password = texto(req.body.password, 'La contraseña', 1, 100)
  const { rows: [u] } = await query(
    'SELECT u.id, u.nombre, u.email, u.password_hash, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.email = $1 AND u.activo', [email])
  // Mismo mensaje si falla el correo o la contraseña: no revela qué cuentas existen.
  if (!u || !(await bcrypt.compare(password, u.password_hash))) throw new HttpError(401, 'Correo o contraseña incorrectos.')
  const usuario = { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol }
  res.json({ token: firmar(usuario), usuario })
})

r.get('/me', requiere(), (req, res) => res.json({ usuario: req.user }))

export default r
