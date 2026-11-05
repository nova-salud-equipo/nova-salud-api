// Pruebas de los flujos principales contra una base de datos de PRUEBA.
// Ejecuta: npm run db:reset && npm test   (¡no lo corras contra la base de producción!)
import 'dotenv/config'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { crearApp } from '../src/app.js'
import { pool } from '../src/db.js'

let server, base
const tokens = {}
const api = async (metodo, ruta, body, rol) => {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(rol ? { authorization: 'Bearer ' + tokens[rol] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, body: await r.json() }
}
const producto = async (nombre) => (await api('GET', '/productos', null, 'admin')).body.find((p) => p.nombre === nombre)

before(async () => {
  server = crearApp().listen(0)
  base = `http://localhost:${server.address().port}/api`
  for (const [rol, email, password] of [['admin', 'admin@novasalud.pe', 'admin123'], ['cajero', 'cajero@novasalud.pe', 'cajero123'], ['almacen', 'almacen@novasalud.pe', 'almacen123']]) {
    tokens[rol] = (await api('POST', '/auth/login', { email, password })).body.token
  }
})
after(async () => { server.close(); await pool.end() })

test('login incorrecto no revela si el correo existe', async () => {
  const r = await api('POST', '/auth/login', { email: 'admin@novasalud.pe', password: 'mala' })
  assert.equal(r.status, 401)
  assert.equal(r.body.error, 'Correo o contraseña incorrectos.')
})

test('el almacén no puede vender y el cajero no puede comprar', async () => {
  assert.equal((await api('POST', '/ventas', { items: [{ productoId: 1, cantidad: 1 }], metodoPago: 'Efectivo' }, 'almacen')).status, 403)
  assert.equal((await api('GET', '/compras', null, 'cajero')).status, 403)
})

test('venta de mostrador descuenta stock y no permite vender de más', async () => {
  const antes = await producto('Paracetamol 500 mg')
  const v = await api('POST', '/ventas', { items: [{ productoId: antes.id, cantidad: 3 }], metodoPago: 'Efectivo' }, 'cajero')
  assert.equal(v.status, 201)
  assert.match(v.body.numero, /^B001-\d{6}$/)
  assert.equal((await producto('Paracetamol 500 mg')).disponible, antes.disponible - 3)
  const mucho = await api('POST', '/ventas', { items: [{ productoId: antes.id, cantidad: 9999 }], metodoPago: 'Efectivo' }, 'cajero')
  assert.equal(mucho.status, 409)
})

test('el lote vencido no se vende (FEFO solo con lotes vigentes)', async () => {
  const a = await producto('Aspirina 100 mg') // 6 vencidas + 20 vigentes
  assert.equal(a.disponible, 20)
  const r = await api('POST', '/ventas', { items: [{ productoId: a.id, cantidad: 21 }], metodoPago: 'Efectivo' }, 'cajero')
  assert.equal(r.status, 409)
})

test('producto con receta exige confirmación', async () => {
  const amox = await producto('Amoxicilina 500 mg')
  assert.equal((await api('POST', '/ventas', { items: [{ productoId: amox.id, cantidad: 1 }], metodoPago: 'Efectivo' }, 'cajero')).status, 400)
  assert.equal((await api('POST', '/ventas', { items: [{ productoId: amox.id, cantidad: 1 }], metodoPago: 'Efectivo', recetaVerificada: true }, 'cajero')).status, 201)
})

test('pedido web reserva stock y al entregarlo se vuelve venta', async () => {
  const antes = await producto('Vitamina C 1 g')
  const ped = await api('POST', '/pedidos', { items: [{ productoId: antes.id, cantidad: 4 }], cliente: { nombre: 'Ana Web', celular: '987654321' }, metodoPago: 'Yape / Plin', entrega: 'recojo' })
  assert.equal(ped.status, 201)
  assert.match(ped.body.codigo, /^NS-\d+$/)
  let p = await producto('Vitamina C 1 g')
  assert.equal(p.reservado, 4)
  assert.equal(p.disponible, antes.disponible - 4)
  assert.equal(p.stockTotal, antes.stockTotal) // todavía no sale del almacén

  const seg = await api('GET', `/pedidos/seguimiento/${ped.body.codigo}?celular=987654321`)
  assert.equal(seg.body.estado, 'Pendiente')
  assert.equal((await api('GET', `/pedidos/seguimiento/${ped.body.codigo}?celular=900000000`)).status, 404)

  assert.equal((await api('PATCH', `/pedidos/${ped.body.id}/estado`, { estado: 'Entregado' }, 'cajero')).status, 400) // primero se prepara
  await api('PATCH', `/pedidos/${ped.body.id}/estado`, { estado: 'Preparado' }, 'cajero')
  const ent = await api('PATCH', `/pedidos/${ped.body.id}/estado`, { estado: 'Entregado' }, 'cajero')
  assert.equal(ent.body.estado, 'Entregado')
  assert.match(ent.body.boleta, /^B001-/)
  p = await producto('Vitamina C 1 g')
  assert.equal(p.reservado, 0)
  assert.equal(p.stockTotal, antes.stockTotal - 4)
})

test('pedido cancelado libera la reserva', async () => {
  const antes = await producto('Suero oral')
  const ped = await api('POST', '/pedidos', { items: [{ productoId: antes.id, cantidad: 5 }], cliente: { nombre: 'Luis', celular: '912345678' }, metodoPago: 'Contra entrega', entrega: 'delivery', direccion: 'Av. Lima 123' })
  await api('PATCH', `/pedidos/${ped.body.id}/estado`, { estado: 'Cancelado' }, 'admin')
  assert.equal((await producto('Suero oral')).disponible, antes.disponible)
})

test('la tienda no permite delivery de productos con receta ni pagos fallidos', async () => {
  const amox = await producto('Amoxicilina 500 mg')
  const cli = { nombre: 'Test', celular: '999888777' }
  assert.equal((await api('POST', '/pedidos', { items: [{ productoId: amox.id, cantidad: 1 }], cliente: cli, metodoPago: 'Tarjeta', entrega: 'delivery', direccion: 'Calle 1 234' })).status, 400)
  assert.equal((await api('POST', '/pedidos', { items: [{ productoId: 1, cantidad: 1 }], cliente: cli, metodoPago: 'Tarjeta', entrega: 'recojo', simularFallo: true })).status, 402)
})

test('los productos con AINE llegan marcados a la tienda y al ERP', async () => {
  const catalogo = (await api('GET', '/catalogo/productos')).body
  assert.equal(catalogo.find((p) => p.nombre === 'Ibuprofeno 400 mg').contieneAine, true)
  assert.equal(catalogo.find((p) => p.nombre === 'Paracetamol 500 mg').contieneAine, false)
  const lora = await producto('Loratadina 10 mg')
  assert.equal(lora.contieneAine, false)
  assert.equal((await api('PATCH', `/productos/${lora.id}`, { contieneAine: true }, 'almacen')).status, 403)
  assert.equal((await api('PATCH', `/productos/${lora.id}`, { contieneAine: true }, 'admin')).status, 200)
  assert.equal((await producto('Loratadina 10 mg')).contieneAine, true)
  await api('PATCH', `/productos/${lora.id}`, { contieneAine: false }, 'admin')
})

test('una compra crea el lote y sube el stock', async () => {
  const ibu = await producto('Ibuprofeno 400 mg')
  const r = await api('POST', '/compras', { proveedorId: 1, factura: 'F001-TEST', fecha: '2026-11-02', lineas: [{ productoId: ibu.id, lote: 'NUEVO-1', vence: '2028-01-01', cantidad: 50, costo: 5.2 }] }, 'almacen')
  assert.equal(r.status, 201)
  assert.equal((await producto('Ibuprofeno 400 mg')).disponible, ibu.disponible + 50)
  const vencido = await api('POST', '/compras', { proveedorId: 1, factura: 'F001-TEST2', fecha: '2026-11-02', lineas: [{ productoId: ibu.id, lote: 'VIEJO', vence: '2020-01-01', cantidad: 5, costo: 5 }] }, 'almacen')
  assert.equal(vencido.status, 400)
})
