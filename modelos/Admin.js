const baseDatos = require('./baseDatos');

async function filas(sql, parametros = []) {
    return (await baseDatos.ejecutar(sql, parametros)).rows;
}

async function uno(sql, parametros = []) {
    return (await filas(sql, parametros))[0] || null;
}

async function empleadosDeEmpresa(idEmpresa, idEstado) {
    return filas(
        `SELECT e.id_empleado, e.nombre, e.telefono, e.cedula, e.id_rol,
                e.id_estadoemp, e.id_usuario, u.correo, r.rol, ee.estado
         FROM empleado e
         JOIN usuario u ON u.id_usuario = e.id_usuario
         JOIN rol r ON r.id_rol = e.id_rol
         JOIN estado_empleado ee ON ee.id_estadoemp = e.id_estadoemp
         WHERE e.id_empresa = $1 AND e.id_estadoemp = $2
         ORDER BY e.id_empleado`,
        [idEmpresa, idEstado]
    );
}

async function empleadoActivo(idEmpleado, idEmpresa, idEstado) {
    return uno(
        `SELECT e.id_empleado, e.nombre, e.telefono, e.cedula, e.id_rol,
                e.id_estadoemp, e.id_usuario, e.id_empresa, u.correo,
                r.rol, ee.estado
         FROM empleado e
         JOIN usuario u ON u.id_usuario = e.id_usuario
         JOIN rol r ON r.id_rol = e.id_rol
         JOIN estado_empleado ee ON ee.id_estadoemp = e.id_estadoemp
         WHERE e.id_empleado = $1 AND e.id_empresa = $2 AND e.id_estadoemp = $3
         LIMIT 1`,
        [idEmpleado, idEmpresa, idEstado]
    );
}

async function panelDatos(idCompletado) {
    const [pedidos, pagos, insumos, detalles, productos] = await Promise.all([
        filas('SELECT id_pedido, id_estadoped, fec_creacion FROM pedido WHERE id_estadoped = $1', [idCompletado]),
        filas('SELECT monto, fec_creacion FROM pago', []),
        filas('SELECT stock, costo FROM insumo', []),
        filas('SELECT id_producto, cantidad FROM detalle_pedido', []),
        filas('SELECT id_producto, nombre FROM producto', [])
    ]);
    return { pedidos, pagos, insumos, detalles, productos };
}

async function listarInsumosPorVencer() {
    return filas(`
        SELECT i.id_insumo, i.nombre, i.stock, i.fec_vencimiento,
               CASE
                   WHEN i.fec_vencimiento < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date THEN 'vencido'
                   ELSE 'proximo a vencer'
               END AS estado_vencimiento
        FROM insumo i
        WHERE i.fec_vencimiento <= ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date + INTERVAL '5 days')::date
        ORDER BY i.fec_vencimiento ASC, i.nombre ASC`, []);
}

async function resumenEstadisticasHoy() {
    return uno(`
        SELECT
            (SELECT COUNT(*)::int
             FROM pedido p
             JOIN estado_pedido ep ON ep.id_estadoped = p.id_estadoped
             WHERE LOWER(ep.estado) = 'completado'
               AND (p.fec_creacion AT TIME ZONE 'America/Bogota')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date) AS pedidos_hoy,
            (SELECT COALESCE(SUM(pa.monto), 0)::numeric
             FROM pago pa
             JOIN pedido p ON p.id_pedido = pa.id_pedido
             WHERE (p.fec_creacion AT TIME ZONE 'America/Bogota')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date) AS ventas_hoy`, []);
}

async function estadisticasVentasPorPeriodo(periodo) {
    const configuraciones = {
        diario: {
            inicio: `date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')`,
            fin: `date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota') + INTERVAL '1 day'`,
            paso: `INTERVAL '1 hour'`,
            agrupacion: `date_trunc('hour', p.fec_creacion AT TIME ZONE 'America/Bogota')`,
            etiqueta: `to_char(b.bloque, 'HH24:00')`
        },
        semanal: {
            inicio: `date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')`,
            fin: `date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota') + INTERVAL '1 week'`,
            paso: `INTERVAL '1 day'`,
            agrupacion: `date_trunc('day', p.fec_creacion AT TIME ZONE 'America/Bogota')`,
            etiqueta: `to_char(b.bloque, 'DD Mon')`
        },
        mensual: {
            inicio: `date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')`,
            fin: `date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota') + INTERVAL '1 month'`,
            paso: `INTERVAL '1 day'`,
            agrupacion: `date_trunc('day', p.fec_creacion AT TIME ZONE 'America/Bogota')`,
            etiqueta: `to_char(b.bloque, 'DD')`
        },
        anual: {
            inicio: `date_trunc('year', CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')`,
            fin: `date_trunc('year', CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota') + INTERVAL '1 year'`,
            paso: `INTERVAL '1 month'`,
            agrupacion: `date_trunc('month', p.fec_creacion AT TIME ZONE 'America/Bogota')`,
            etiqueta: `to_char(b.bloque, 'Mon')`
        }
    };
    const configuracion = configuraciones[periodo];
    if (!configuracion) throw new Error('El periodo estadístico no es válido.');
    const resultado = await filas(`
        WITH periodo AS (
            SELECT ${configuracion.inicio} AS inicio, ${configuracion.fin} AS fin
        ), bloques AS (
            SELECT generate_series(inicio, fin - ${configuracion.paso}, ${configuracion.paso}) AS bloque
            FROM periodo
        ), ventas AS (
            SELECT ${configuracion.agrupacion} AS bloque,
                   COUNT(DISTINCT p.id_pedido)::int AS ventas,
                   COALESCE(SUM(pa.monto), 0)::numeric AS recaudado
            FROM pago pa
            JOIN pedido p ON p.id_pedido = pa.id_pedido
            JOIN estado_pedido ep ON ep.id_estadoped = p.id_estadoped
            CROSS JOIN periodo
            WHERE LOWER(ep.estado) <> 'cancelado'
              AND (p.fec_creacion AT TIME ZONE 'America/Bogota') >= periodo.inicio
              AND (p.fec_creacion AT TIME ZONE 'America/Bogota') < periodo.fin
            GROUP BY ${configuracion.agrupacion}
        )
        SELECT ${configuracion.etiqueta} AS etiqueta,
               COALESCE(v.ventas, 0)::int AS ventas,
               COALESCE(v.recaudado, 0)::numeric AS recaudado
        FROM bloques b
        LEFT JOIN ventas v ON v.bloque = b.bloque
        ORDER BY b.bloque`, []);
    return {
        ventas_totales: resultado.reduce((total, fila) => total + Number(fila.ventas || 0), 0),
        dinero_recaudado: resultado.reduce((total, fila) => total + Number(fila.recaudado || 0), 0),
        serie: resultado.map(fila => ({
            etiqueta: fila.etiqueta,
            ventas: Number(fila.ventas || 0),
            recaudado: Number(fila.recaudado || 0)
        }))
    };
}


async function categoriaPorNombre(nombre) {
    return uno('SELECT id_categoria, nombre FROM categoria WHERE nombre = $1 LIMIT 1', [nombre]);
}

async function crearCategoria(nombre) {
    return uno('INSERT INTO categoria (nombre) VALUES ($1) RETURNING id_categoria, nombre', [nombre]);
}

async function unidadPorNombre(nombre) {
    return uno('SELECT id_unidad, nombre, abreviatura FROM unidad_medida WHERE nombre = $1 LIMIT 1', [nombre]);
}

async function unidadPorAbreviatura(abreviatura) {
    return uno('SELECT id_unidad, nombre, abreviatura FROM unidad_medida WHERE abreviatura = $1 LIMIT 1', [abreviatura]);
}

async function crearUnidad(nombre, abreviatura) {
    return uno('INSERT INTO unidad_medida (nombre, abreviatura) VALUES ($1, $2) RETURNING id_unidad, nombre, abreviatura', [nombre, abreviatura]);
}
async function listarUnidades() {
    return filas('SELECT id_unidad, nombre, abreviatura FROM unidad_medida ORDER BY nombre ASC', []);
}

async function rolPorId(idRol) { return uno('SELECT id_rol, rol FROM rol WHERE id_rol = $1 LIMIT 1', [idRol]); }

async function crearEmpleado(datos) {
    return uno(
        `INSERT INTO empleado (nombre, telefono, cedula, id_rol, id_estadoemp, id_usuario, id_empresa)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id_empleado, nombre, telefono, cedula, id_rol, id_estadoemp, id_usuario, id_empresa`,
        [datos.nombre, datos.telefono, datos.cedula, datos.idRol, datos.idEstado, datos.idUsuario, datos.idEmpresa]
    );
}

async function crearUsuario(correo, password) { return uno('INSERT INTO usuario (correo, password) VALUES ($1, $2) RETURNING id_usuario, correo', [correo, password]); }
async function eliminarUsuario(idUsuario) { return filas('DELETE FROM usuario WHERE id_usuario = $1 RETURNING id_usuario', [idUsuario]); }
async function eliminarEmpleado(idEmpleado) { return filas('DELETE FROM empleado WHERE id_empleado = $1 RETURNING id_empleado', [idEmpleado]); }
async function pedidosDeEmpleado(idEmpleado) { return filas('SELECT id_pedido FROM pedido WHERE id_empleado = $1 LIMIT 1', [idEmpleado]); }

async function actualizarUsuario(idUsuario, cambios) {
    const sets = [], valores = [];
    if (cambios.correo !== undefined) { sets.push(`correo = $${valores.length + 1}`); valores.push(cambios.correo); }
    if (cambios.password !== undefined) { sets.push(`password = $${valores.length + 1}`); valores.push(cambios.password); }
    if (!sets.length) return [];
    valores.push(idUsuario);
    return filas(`UPDATE usuario SET ${sets.join(', ')} WHERE id_usuario = $${valores.length} RETURNING id_usuario, correo`, valores);
}

async function actualizarEmpleado(idEmpleado, cambios) {
    const permitidas = ['nombre', 'telefono', 'cedula', 'id_rol'];
    const sets = [], valores = [];
    for (const columna of permitidas) if (cambios[columna] !== undefined) { sets.push(`${columna} = $${valores.length + 1}`); valores.push(cambios[columna]); }
    if (!sets.length) return [];
    valores.push(idEmpleado);
    return filas(`UPDATE empleado SET ${sets.join(', ')} WHERE id_empleado = $${valores.length} RETURNING id_empleado`, valores);
}

async function crearProveedor(datos) {
    return uno('INSERT INTO proveedor (nombre, correo, telefono, nit) VALUES ($1, $2, $3, $4) RETURNING id_proveedor, nombre, correo, telefono, nit', [datos.nombre, datos.correo, datos.telefono, datos.nit]);
}
async function proveedorPorId(id) { return uno('SELECT id_proveedor, nombre, correo, telefono, nit FROM proveedor WHERE id_proveedor = $1 LIMIT 1', [id]); }
async function listarProveedores() { return filas('SELECT id_proveedor, nombre, correo, telefono, nit FROM proveedor ORDER BY id_proveedor ASC', []); }
async function actualizarProveedor(id, cambios) {
    const sets = [], valores = [];
    for (const columna of ['nombre', 'correo', 'telefono', 'nit']) if (cambios[columna] !== undefined) { sets.push(`${columna} = $${valores.length + 1}`); valores.push(cambios[columna]); }
    if (!sets.length) return [];
    valores.push(id);
    return filas(`UPDATE proveedor SET ${sets.join(', ')} WHERE id_proveedor = $${valores.length} RETURNING id_proveedor`, valores);
}
async function eliminarProveedor(id) { return filas('DELETE FROM proveedor WHERE id_proveedor = $1 RETURNING id_proveedor', [id]); }

async function proveedorExiste(id) { return uno('SELECT id_proveedor FROM proveedor WHERE id_proveedor = $1 LIMIT 1', [id]); }
async function crearInsumo(datos) {
    return uno(
        'INSERT INTO insumo (nombre, stock, fec_vencimiento, costo, id_proveedor, id_unidad) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_insumo, nombre, stock, fec_vencimiento, costo, id_proveedor, id_unidad',
        [datos.nombre, datos.stock, datos.fecVencimiento, datos.costo, datos.idProveedor, datos.idUnidad]
    );
}
async function crearProducto(datos) {
    return uno('INSERT INTO producto (nombre, precio, descripcion, url_foto, id_categoria) VALUES ($1, $2, $3, $4, $5) RETURNING id_producto, nombre, precio, descripcion, url_foto, id_categoria', [datos.nombre, datos.precio, datos.descripcion, datos.urlFoto, datos.idCategoria]);
}
async function crearInsumoDirectoTransaccional(datos) {
    return baseDatos.transaccion(async conexion => {
        const insumo = (await conexion.query(
            'INSERT INTO insumo (nombre, stock, fec_vencimiento, costo, id_proveedor, id_unidad) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_insumo, nombre, stock, fec_vencimiento, costo, id_proveedor, id_unidad',
            [datos.nombre, datos.stock, datos.fecVencimiento, datos.costo, datos.idProveedor, datos.idUnidad]
        )).rows[0];
        const producto = (await conexion.query(
            'INSERT INTO producto (nombre, precio, descripcion, url_foto, id_categoria) VALUES ($1, $2, $3, $4, $5) RETURNING id_producto, nombre, precio, descripcion, url_foto, id_categoria',
            [datos.nombre, datos.precio, datos.descripcion, datos.urlFoto, datos.idCategoria]
        )).rows[0];
        const receta = (await conexion.query(
            'INSERT INTO receta (nombre, descripcion, id_producto) VALUES ($1, $2, $3) RETURNING id_receta, nombre, descripcion, id_producto',
            [datos.nombre, datos.descripcion, producto.id_producto]
        )).rows[0];
        await conexion.query(
            'INSERT INTO detalle_receta (id_insumo, id_receta, cantidad) VALUES ($1, $2, $3)',
            [insumo.id_insumo, receta.id_receta, 1]
        );
        return { insumo, producto, receta };
    });
}
async function insumoPorId(id) {
    return uno(
        `SELECT i.id_insumo, i.nombre, i.stock, i.fec_vencimiento,
                i.costo, i.id_proveedor, i.id_unidad,
                p.nombre AS proveedor, u.nombre AS unidad, u.abreviatura
         FROM insumo i
         LEFT JOIN proveedor p ON p.id_proveedor = i.id_proveedor
         JOIN unidad_medida u ON u.id_unidad = i.id_unidad
         WHERE i.id_insumo = $1 LIMIT 1`,
        [id]
    );
}
async function listarInsumos() {
    return filas(
        `SELECT i.id_insumo, i.nombre, i.stock, i.fec_vencimiento,
                i.costo, i.id_proveedor, i.id_unidad,
                p.nombre AS proveedor, u.nombre AS unidad, u.abreviatura
         FROM insumo i
         LEFT JOIN proveedor p ON p.id_proveedor = i.id_proveedor
         JOIN unidad_medida u ON u.id_unidad = i.id_unidad
         ORDER BY i.id_insumo`, []
    );
}
async function actualizarInsumo(id, cambios) {
    const permitidas = ['nombre', 'stock', 'fec_vencimiento', 'costo', 'id_proveedor', 'id_unidad'];
    const sets = [], valores = [];
    for (const columna of permitidas) if (cambios[columna] !== undefined) { sets.push(`${columna} = $${valores.length + 1}`); valores.push(cambios[columna]); }
    if (!sets.length) return [];
    valores.push(id);
    return filas(`UPDATE insumo SET ${sets.join(', ')} WHERE id_insumo = $${valores.length} RETURNING id_insumo`, valores);
}
async function reabastecerInsumo(id, fecVencimiento, stock) {
    return filas(
        'UPDATE insumo SET fec_vencimiento = $1, stock = $2 WHERE id_insumo = $3 RETURNING id_insumo, fec_vencimiento, stock',
        [fecVencimiento, stock, id]
    );
}
async function actualizarStock(id, stock) { return filas('UPDATE insumo SET stock = $1 WHERE id_insumo = $2 RETURNING id_insumo, stock', [stock, id]); }

async function eliminarInsumoCompleto(id) {
    return baseDatos.transaccion(async conexion => {
        const productos = (await conexion.query('SELECT id_producto FROM producto WHERE lower(nombre) = lower((SELECT nombre FROM insumo WHERE id_insumo = $1))', [id])).rows;
        await conexion.query('DELETE FROM detalle_receta WHERE id_insumo = $1', [id]);
        for (const producto of productos) {
            const usado = (await conexion.query('SELECT id_pedido FROM detalle_pedido WHERE id_producto = $1 LIMIT 1', [producto.id_producto])).rowCount > 0;
            if (!usado) {
                await conexion.query('DELETE FROM receta WHERE id_producto = $1', [producto.id_producto]);
                await conexion.query('DELETE FROM producto WHERE id_producto = $1', [producto.id_producto]);
            }
        }
        return conexion.query('DELETE FROM insumo WHERE id_insumo = $1 RETURNING id_insumo', [id]).then(resultado => resultado.rows);
    });
}

async function productoPorId(id) { return uno('SELECT p.id_producto, p.nombre, p.precio, p.descripcion, p.url_foto, p.id_categoria, c.nombre AS categoria FROM producto p LEFT JOIN categoria c ON c.id_categoria = p.id_categoria WHERE p.id_producto = $1 LIMIT 1', [id]); }
async function listarProductos() { return filas('SELECT p.id_producto, p.nombre, p.precio, p.descripcion, p.url_foto, p.id_categoria, c.nombre AS categoria FROM producto p LEFT JOIN categoria c ON c.id_categoria = p.id_categoria ORDER BY p.id_producto', []); }
async function actualizarProducto(id, cambios) {
    const permitidas = ['nombre', 'precio', 'descripcion', 'url_foto', 'id_categoria'];
    const sets = [], valores = [];
    for (const columna of permitidas) if (cambios[columna] !== undefined) { sets.push(`${columna} = $${valores.length + 1}`); valores.push(cambios[columna]); }
    if (!sets.length) return [];
    valores.push(id);
    return filas(`UPDATE producto SET ${sets.join(', ')} WHERE id_producto = $${valores.length} RETURNING id_producto`, valores);
}
async function eliminarProducto(id) { return filas('DELETE FROM producto WHERE id_producto = $1 RETURNING id_producto', [id]); }

async function crearReceta(datos) { return uno('INSERT INTO receta (nombre, descripcion, id_producto) VALUES ($1, $2, $3) RETURNING id_receta, nombre, descripcion, id_producto', [datos.nombre, datos.descripcion, datos.idProducto]); }
async function crearDetallesReceta(idReceta, insumos) {
    if (!insumos.length) return [];
    const valores = [], grupos = insumos.map((item, indice) => { valores.push(idReceta, item.id_insumo, item.cantidad); return `($${indice * 3 + 1}, $${indice * 3 + 2}, $${indice * 3 + 3})`; });
    return filas(`INSERT INTO detalle_receta (id_receta, id_insumo, cantidad) VALUES ${grupos.join(', ')} RETURNING id_receta, id_insumo, cantidad`, valores);
}
async function recetaPorId(id) { return uno('SELECT r.id_receta, r.nombre, r.descripcion, r.id_producto, p.nombre AS producto_nombre FROM receta r JOIN producto p ON p.id_producto = r.id_producto WHERE r.id_receta = $1 LIMIT 1', [id]); }
async function detallesDeReceta(id) { return filas('SELECT dr.id_insumo, dr.cantidad, i.nombre AS insumo_nombre, u.nombre AS unidad_nombre, u.abreviatura AS unidad_abreviatura FROM detalle_receta dr JOIN insumo i ON i.id_insumo = dr.id_insumo JOIN unidad_medida u ON u.id_unidad = i.id_unidad WHERE dr.id_receta = $1 ORDER BY dr.id_insumo', [id]); }
async function actualizarReceta(id, cambios) {
    const sets = [], valores = [];
    for (const columna of ['nombre', 'descripcion', 'id_producto']) if (cambios[columna] !== undefined) { sets.push(`${columna} = $${valores.length + 1}`); valores.push(cambios[columna]); }
    if (!sets.length) return [];
    valores.push(id);
    return filas(`UPDATE receta SET ${sets.join(', ')} WHERE id_receta = $${valores.length} RETURNING id_receta`, valores);
}
async function reemplazarDetallesReceta(id, insumos) {
    return baseDatos.transaccion(async conexion => {
        await conexion.query('DELETE FROM detalle_receta WHERE id_receta = $1', [id]);
        if (!insumos.length) return [];
        const valores = [], grupos = insumos.map((item, indice) => { valores.push(id, item.id_insumo, item.cantidad); return `($${indice * 3 + 1}, $${indice * 3 + 2}, $${indice * 3 + 3})`; });
        return (await conexion.query(`INSERT INTO detalle_receta (id_receta, id_insumo, cantidad) VALUES ${grupos.join(', ')} RETURNING id_receta, id_insumo, cantidad`, valores)).rows;
    });
}
async function eliminarReceta(id) { return baseDatos.transaccion(async conexion => { await conexion.query('DELETE FROM detalle_receta WHERE id_receta = $1', [id]); return (await conexion.query('DELETE FROM receta WHERE id_receta = $1 RETURNING id_receta', [id])).rows; }); }
async function listarRecetas() { return filas('SELECT r.id_receta, r.nombre, r.descripcion, p.id_producto AS producto_id, p.nombre AS producto_nombre, p.precio AS producto_precio, p.url_foto AS producto_foto, c.nombre AS producto_categoria FROM receta r JOIN producto p ON p.id_producto = r.id_producto LEFT JOIN categoria c ON c.id_categoria = p.id_categoria ORDER BY r.id_receta ASC', []); }
async function listarFacturas() { return filas('SELECT id_factura, id_pedido, total, fec_creacion, url_factura FROM factura ORDER BY fec_creacion DESC', []); }

module.exports = {
    auth: baseDatos.auth,
    empleadosDeEmpresa, empleadoActivo, panelDatos, listarInsumosPorVencer, resumenEstadisticasHoy, estadisticasVentasPorPeriodo, categoriaPorNombre, crearCategoria,
    unidadPorNombre, unidadPorAbreviatura, crearUnidad, listarUnidades, rolPorId, crearUsuario,
    crearEmpleado, eliminarUsuario, eliminarEmpleado, pedidosDeEmpleado,
    actualizarUsuario, actualizarEmpleado, crearProveedor, proveedorPorId,
    listarProveedores, actualizarProveedor, eliminarProveedor, proveedorExiste,
    crearInsumo, crearProducto, crearInsumoDirectoTransaccional, insumoPorId, listarInsumos, actualizarInsumo,
    actualizarStock, reabastecerInsumo, eliminarInsumoCompleto, productoPorId, listarProductos,
    actualizarProducto, eliminarProducto, crearReceta, crearDetallesReceta,
    recetaPorId, detallesDeReceta, actualizarReceta, reemplazarDetallesReceta,
    eliminarReceta, listarRecetas, listarFacturas,
    listarFacturas2025: async function listarFacturas2025() {
        return filas('SELECT id_factura, total, fec_creacion, url_factura, id_pedido, id_empresa FROM vista_facturas_2025 ORDER BY fec_creacion DESC', []);
    },
    listarFacturasPorDiaMes: async function listarFacturasPorDiaMes(dia, mes, anio) {
        return filas(
            `SELECT id_factura, id_pedido, total, fec_creacion, url_factura
             FROM factura
             WHERE EXTRACT(YEAR FROM fec_creacion AT TIME ZONE 'America/Bogota') = $3
               AND EXTRACT(MONTH FROM fec_creacion AT TIME ZONE 'America/Bogota') = $2
               AND EXTRACT(DAY FROM fec_creacion AT TIME ZONE 'America/Bogota') = $1
             ORDER BY fec_creacion DESC`,
            [dia, mes, anio]
        );
    }
};
