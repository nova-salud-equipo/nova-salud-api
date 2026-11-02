// Datos de demostración. Las fechas se calculan desde HOY para que las alertas siempre tengan sentido.
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { pool, hoy as dia } from '../src/db.js'

const ROLES = ['Administrador', 'Cajero', 'Almacén']
const USUARIOS = [
  ['Admin Nova', 'admin@novasalud.pe', 'admin123', 'Administrador'],
  ['Rosa Quispe', 'cajero@novasalud.pe', 'cajero123', 'Cajero'],
  ['Luis Ramos', 'almacen@novasalud.pe', 'almacen123', 'Almacén'],
]
const CATEGORIAS = ['Analgésicos', 'Antibióticos', 'Antialérgicos', 'Gastro', 'Vitaminas', 'Respiratorio', 'Hidratación', 'Cuidado personal']
const PROVEEDORES = [
  ['Droguería Perú SAC', '20512345671'], ['Distribuidora Andina', '20498765432'],
  ['Farmacéutica Lima SA', '20345678901'], ['Importadora Salud Total', '20601122334'],
]
// [nombre, categoría, presentación, precio, mínimo, receta, proveedor, [[lote, díasParaVencer, stock], ...]]
const PRODUCTOS = [
  ['Paracetamol 500 mg', 0, 'Caja x 20 tabletas', 6.5, 40, false, 0, [['L2408-A', 648, 120]]],
  ['Ibuprofeno 400 mg', 0, 'Caja x 10 tabletas', 8.9, 20, false, 0, [['L2407-C', 541, 8]]],
  ['Amoxicilina 500 mg', 1, 'Caja x 21 cápsulas', 14.5, 25, true, 2, [['A2391', 12, 45]]],
  ['Loratadina 10 mg', 2, 'Caja x 10 tabletas', 7.0, 20, false, 1, [['L2409-B', 827, 60]]],
  ['Omeprazol 20 mg', 3, 'Caja x 14 cápsulas', 11.8, 15, false, 1, [['O2406-A', 594, 5]]],
  ['Vitamina C 1 g', 4, 'Tubo x 10 efervescentes', 9.5, 30, false, 3, [['V2410-D', 699, 90]]],
  ['Alcohol 70° 250 ml', 7, 'Frasco 250 ml', 4.2, 15, false, 3, [['AL2405', 768, 34]]],
  ['Jarabe para la tos', 5, 'Frasco 120 ml', 12.5, 10, false, 2, [['J0458', 25, 18]]],
  ['Suero oral', 6, 'Sobre 27.9 g', 3.5, 50, false, 0, [['S2411-A', 674, 150]]],
  ['Diclofenaco gel 30 g', 0, 'Tubo 30 g', 10.9, 12, false, 0, [['D2406-B', 694, 9]]],
  ['Aspirina 100 mg', 0, 'Caja x 30 tabletas', 9.9, 10, false, 2, [['AS2312', -8, 6], ['AS2503', 846, 20]]],
  ['Naproxeno 550 mg', 0, 'Caja x 10 tabletas', 12.9, 15, true, 1, [['N2501-A', 806, 40]]],
  ['Cetirizina 10 mg', 2, 'Caja x 10 tabletas', 6.5, 20, false, 1, [['C2502-A', 920, 55]]],
  ['Hidrocortisona crema 1%', 7, 'Tubo 15 g', 13.9, 8, false, 2, [['H2412-A', 391, 14]]],
  ['Vitamina B12', 4, 'Caja x 10 ampollas', 24.9, 10, false, 3, [['B2407-A', 609, 16]]],
  ['Clorfenamina 4 mg', 2, 'Caja x 20 tabletas', 4.9, 20, false, 0, [['CL2503-A', 819, 70]]],
  ['Mascarillas descartables', 7, 'Caja x 50 unidades', 14.0, 10, false, 3, [['MS2506-A', 968, 28]]],
  ['Alcohol en gel 500 ml', 7, 'Frasco 500 ml', 11.5, 12, false, 3, [['AG2504-A', 881, 30]]],
  ['Termómetro digital', 7, 'Unidad', 19.9, 5, false, 1, [['T2301-A', 788, 12]]],
  ['Multivitamínico adulto', 4, 'Frasco x 60 tabletas', 29.9, 8, false, 3, [['MV2509-A', 665, 25]]],
]

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const db = await pool.connect()
try {
  await db.query('BEGIN')
  await db.query('TRUNCATE detalle_pedidos, pedidos_web, movimientos_inventario, detalle_ventas, ventas, detalle_compras, compras, lotes, productos, clientes, proveedores, categorias, usuarios, roles RESTART IDENTITY CASCADE')
  await db.query("SELECT setval('boleta_seq', 1, false)")
  for (const r of ROLES) await db.query('INSERT INTO roles (nombre) VALUES ($1)', [r])
  for (const [nombre, email, pass, rol] of USUARIOS) {
    await db.query('INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES ($1,$2,$3,$4)', [nombre, email, await bcrypt.hash(pass, 10), ROLES.indexOf(rol) + 1])
  }
  for (const c of CATEGORIAS) await db.query('INSERT INTO categorias (nombre) VALUES ($1)', [c])
  for (const [rs, ruc] of PROVEEDORES) await db.query('INSERT INTO proveedores (razon_social, ruc, telefono) VALUES ($1,$2,$3)', [rs, ruc, '01' + ruc.slice(-7)])
  const loteDe = {}
  for (const [i, [nombre, cat, pres, precio, min, receta, prov, lotes]] of PRODUCTOS.entries()) {
    const codigo = 'MED-' + String(i + 1).padStart(4, '0')
    const { rows: [p] } = await db.query(
      'INSERT INTO productos (codigo, nombre, categoria_id, proveedor_id, presentacion, precio, stock_minimo, requiere_receta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [codigo, nombre, cat + 1, prov + 1, pres, precio, min, receta])
    for (const [num, d, stock] of lotes) {
      const { rows: [l] } = await db.query('INSERT INTO lotes (producto_id, numero, fecha_vencimiento, stock) VALUES ($1,$2,$3,$4) RETURNING id', [p.id, num, dia(d), stock])
      await db.query("INSERT INTO movimientos_inventario (lote_id, tipo, cantidad, motivo, usuario_id, fecha) VALUES ($1,'ENTRADA',$2,'Inventario inicial',3, now() - interval '8 days')", [l.id, stock])
      loteDe[p.id] ??= l.id
    }
  }

  // Historial de ventas de los últimos 7 días (para dashboard y reportes).
  const r = rng(7)
  const metodos = ['Efectivo', 'Efectivo', 'Yape / Plin', 'Tarjeta']
  const clientes = [null, null, null, 'María Quispe', 'Carlos Rojas', 'Ana Torres', 'Jorge Salas']
  let n = 0
  for (let d = -6; d <= 0; d++) {
    const cnt = d === 0 ? 18 : 52 + Math.floor(r() * 18)
    const lista = []
    for (let i = 0; i < cnt; i++) {
      const items = new Map()
      const k = 1 + Math.floor(r() * 3)
      for (let j = 0; j < k; j++) items.set(1 + Math.floor(r() * PRODUCTOS.length), 1 + Math.floor(r() * 3))
      lista.push({ items, min: 8 * 60 + Math.floor((i / cnt) * (d === 0 ? 2.5 : 12) * 60) + Math.floor(r() * 5) })
    }
    for (const v of lista.sort((a, b) => a.min - b.min)) {
      const total = Math.round([...v.items].reduce((t, [pid, c]) => t + c * PRODUCTOS[pid - 1][3], 0) * 100) / 100
      const sub = Math.round((total / 1.18) * 100) / 100
      const nombre = clientes[Math.floor(r() * clientes.length)]
      let clienteId = null
      if (nombre) clienteId = (await db.query('INSERT INTO clientes (nombre) VALUES ($1) RETURNING id', [nombre])).rows[0].id
      const fecha = `${dia(d)} ${String(Math.floor(v.min / 60)).padStart(2, '0')}:${String(v.min % 60).padStart(2, '0')}:00-05`
      const { rows: [venta] } = await db.query(
        `INSERT INTO ventas (numero, cliente_id, usuario_id, metodo_pago, subtotal, igv, total, estado, segundos_atencion, fecha)
         VALUES ($1,$2,2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        ['B001-' + String(++n).padStart(6, '0'), clienteId, metodos[Math.floor(r() * metodos.length)], sub, Math.round((total - sub) * 100) / 100, total,
          r() < 0.02 ? 'Anulada' : 'Pagada', 80 + Math.floor(r() * 70), fecha])
      for (const [pid, c] of v.items) {
        await db.query('INSERT INTO detalle_ventas (venta_id, producto_id, lote_id, cantidad, precio_unitario) VALUES ($1,$2,$3,$4,$5)', [venta.id, pid, loteDe[pid], c, PRODUCTOS[pid - 1][3]])
      }
    }
  }
  await db.query("SELECT setval('boleta_seq', $1)", [n])
  await db.query('COMMIT')
  console.log(`Datos de prueba cargados: ${PRODUCTOS.length} productos, ${n} ventas, ${USUARIOS.length} usuarios.`)
} catch (e) {
  await db.query('ROLLBACK')
  throw e
} finally {
  db.release()
  await pool.end()
}
