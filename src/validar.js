import { badRequest } from './errors.js'

export const entero = (v, campo, min = 0) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min) throw badRequest(`${campo} debe ser un número entero mayor o igual a ${min}.`)
  return n
}
export const decimal = (v, campo) => {
  const n = Number(v)
  if (!(n > 0)) throw badRequest(`${campo} debe ser mayor a 0.`)
  return Math.round(n * 100) / 100
}
export const texto = (v, campo, min = 1, max = 200) => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s.length < min || s.length > max) throw badRequest(`${campo} es obligatorio (entre ${min} y ${max} caracteres).`)
  return s
}
export const fecha = (v, campo) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`${campo} debe tener formato AAAA-MM-DD.`)
  return v
}
export const opcion = (v, campo, opciones) => {
  if (!opciones.includes(v)) throw badRequest(`${campo} debe ser uno de: ${opciones.join(', ')}.`)
  return v
}
export const items = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) throw badRequest('Agrega al menos un producto.')
  const m = new Map()
  for (const it of arr) {
    const id = entero(it.productoId, 'productoId', 1)
    m.set(id, (m.get(id) || 0) + entero(it.cantidad, 'cantidad', 1))
  }
  return [...m].map(([productoId, cantidad]) => ({ productoId, cantidad }))
}
