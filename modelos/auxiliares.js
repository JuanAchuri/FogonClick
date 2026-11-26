const bcrypt = require('bcryptjs');
const { ejecutar } = require('./baseDatos');

// Convierte cualquier variante de nombre de rol al identificador corto de la app.
function normalizarRol(nombre) {
    const rol = String(nombre || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '');
    if (['admin', 'administrador'].includes(rol)) return 'admin';
    if (['caja', 'cajero'].includes(rol)) return 'caja';
    if (['cocina', 'cocinero'].includes(rol)) return 'cocina';
    return '';
}

// Resuelve el rol desde el catálogo oficial. El id es la fuente estable;
// el texto se conserva como respaldo para datos antiguos o migrados.
function rolDesdeEmpleado(empleado) {
    const porId = { 1: 'admin', 2: 'cocina', 3: 'caja' }[Number(empleado?.id_rol)];
    return porId || normalizarRol(empleado?.rol?.rol ?? empleado?.rol);
}

// Escapa comodines para que ilike compare el texto exacto.
const escapeLike = v => String(v).replace(/[\\%_*]/g, '\\$&');

// Catálogos: cada resolución usa SQL visible y parametrizado.
const cache = new Map();
async function idPorNombre(tabla, colId, colNombre, nombre) {
    const clave = `${tabla}:${nombre.toLowerCase()}`;
    if (cache.has(clave)) return cache.get(clave);
    const permitidos = /^(rol|estado_empleado|estado_pedido|metodo_pago)$/.test(tabla) && /^(id_rol|id_estadoemp|id_estadoped|id_metodo)$/.test(colId) && /^(rol|estado|metodo)$/.test(colNombre);
    if (!permitidos) throw new Error('Catálogo SQL no permitido.');
    let fila = (await ejecutar(`SELECT ${colId} FROM ${tabla} WHERE ${colNombre} ILIKE $1 LIMIT 1`, [`%${escapeLike(nombre)}%`])).rows[0];
    if (!fila) {
        fila = (await ejecutar(`INSERT INTO ${tabla} (${colNombre}) VALUES ($1) RETURNING ${colId}`, [nombre])).rows[0];
    }
    cache.set(clave, fila[colId]);
    return fila[colId];
}

const rolId            = n => idPorNombre('rol', 'id_rol', 'rol', n);
const estadoEmpleadoId = (n = 'activo') => idPorNombre('estado_empleado', 'id_estadoemp', 'estado', n);
const estadoPedidoId   = n => idPorNombre('estado_pedido', 'id_estadoped', 'estado', n);
const metodoPagoId     = n => idPorNombre('metodo_pago', 'id_metodo', 'metodo', n);

// Unicidad (respeta los UNIQUE del DDL y devuelve un 409 claro)
async function existe(tabla, columna, valor, { ilike = false, excluir } = {}) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(tabla) || !/^[a-z_][a-z0-9_]*$/i.test(columna)) throw new Error('Identificador SQL no permitido.');
    let sql = `SELECT 1 FROM ${tabla} WHERE ${columna} ${ilike ? 'ILIKE' : '='} $1`;
    const valores = [ilike ? `%${escapeLike(valor)}%` : String(valor)];
    if (excluir) {
        if (!/^[a-z_][a-z0-9_]*$/i.test(excluir.columna)) throw new Error('Identificador SQL no permitido.');
        sql += ` AND ${excluir.columna} <> $2`;
        valores.push(excluir.valor);
    }
    sql += ' LIMIT 1';
    return (await ejecutar(sql, valores)).rowCount > 0;
}

// Contraseñas
const hashPassword = plain => bcrypt.hash(String(plain), 10);
async function verificarPassword(plain, guardada) {
    const g = String(guardada || '');
    return g.startsWith('$2') ? bcrypt.compare(String(plain), g) : g === String(plain); // legado en texto plano
}
const esHash = g => String(g || '').startsWith('$2');

// Status HTTP coherente (23505 = violación de UNIQUE en Postgres).
const httpStatus = e => (e.code === '23505' ? 409 : e.status || 500);

module.exports = {
    normalizarRol, rolDesdeEmpleado, escapeLike, rolId, estadoEmpleadoId, estadoPedidoId,
    metodoPagoId, existe, hashPassword, verificarPassword, esHash, httpStatus
};