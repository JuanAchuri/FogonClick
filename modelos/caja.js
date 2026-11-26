const baseDatos = require('./baseDatos');

// Modelo de caja: catálogo de venta y transacciones de pedido/pago/inventario.
module.exports = {
    
    async prepararEsquemaFacturas() {
        await baseDatos.ejecutar(`CREATE OR REPLACE VIEW vista_facturas_2025 AS
            SELECT id_factura, total, fec_creacion, url_factura, id_pedido, id_empresa
            FROM factura
            WHERE EXTRACT(YEAR FROM fec_creacion) = 2025`, []);
    },
    
    async actualizarUrlFactura(idPedido, url) {
        return (await baseDatos.ejecutar('UPDATE factura SET url_factura = $1 WHERE id_pedido = $2 RETURNING id_factura, url_factura', [url, idPedido])).rows;
    },
    
    async datosParaFactura(idPedido) {
        const [pedidos, pagos, detalles] = await Promise.all([
            baseDatos.ejecutar('SELECT p.id_pedido, p.id_empleado, p.id_cliente, e.id_empresa, em.razon_social AS empresa_razon_social, em.nom_comercial AS empresa_nom_comercial, em.nit AS empresa_nit, em.act_economica AS empresa_act_economica, em.direccion AS empresa_direccion, em.telefono AS empresa_telefono, em.correo AS empresa_correo, em.cod_tributo AS empresa_cod_tributo, em.cod_municipio AS empresa_cod_municipio, em.responsabilidades_fiscales AS empresa_responsabilidades_fiscales, c.nombre AS cliente_nombre, c.cedula AS cliente_cedula, c.correo AS cliente_correo FROM pedido p JOIN cliente c ON c.id_cliente = p.id_cliente JOIN empleado e ON e.id_empleado = p.id_empleado JOIN empresa em ON em.id_empresa = e.id_empresa WHERE p.id_pedido = $1 LIMIT 1', [idPedido]),
            baseDatos.ejecutar('SELECT pa.id_pedido, pa.monto, pa.id_metodo, pa.id_pago, mp.metodo AS metodo_pago FROM pago pa JOIN metodo_pago mp ON mp.id_metodo = pa.id_metodo WHERE pa.id_pedido = $1 LIMIT 1', [idPedido]),
            baseDatos.ejecutar('SELECT id_producto, cantidad FROM detalle_pedido WHERE id_pedido = $1', [idPedido])
        ]);
        return { pedido: pedidos.rows[0] || null, pago: pagos.rows[0] || null, detalles: detalles.rows };
    },
   
    async productosPorIds(ids) {
        if (!ids.length) return [];
        return (await baseDatos.ejecutar('SELECT p.id_producto, p.nombre, p.precio, p.descripcion, p.url_foto, p.id_categoria, c.nombre AS categoria FROM producto p LEFT JOIN categoria c ON c.id_categoria = p.id_categoria WHERE p.id_producto = ANY($1::int[])', [ids])).rows;
    },
   
    async productosConReceta(ids) {
        if (!ids.length) return [];
        return (await baseDatos.ejecutar('SELECT id_producto FROM receta WHERE id_producto = ANY($1::int[])', [ids])).rows;
    },
   
    async nombresInsumos() { 
        return (await baseDatos.ejecutar('SELECT nombre FROM insumo', [])).rows; 
    },
    
    async actualizarCliente(idCliente, datos) {
        return (await baseDatos.ejecutar('UPDATE cliente SET nombre = $1, cedula = $2, correo = $3 WHERE id_cliente = $4 RETURNING id_cliente', [datos.nombre, datos.cedula, datos.correo, idCliente])).rows;
    },
    
    async empleadoPorId(id) { 
        return (await baseDatos.ejecutar('SELECT id_empleado, id_empresa FROM empleado WHERE id_empleado = $1 LIMIT 1', [id])).rows[0] || null; 
    },
    
    async primerEmpleado() { 
        return (await baseDatos.ejecutar('SELECT id_empleado, id_empresa FROM empleado ORDER BY id_empleado ASC LIMIT 1', [])).rows[0] || null; 
    },
    
    async empresaPorId(id) { 
        return (await baseDatos.ejecutar('SELECT id_empresa FROM empresa WHERE id_empresa = $1 LIMIT 1', [id])).rows[0] || null; 
    },
    
    async primeraEmpresa() { 
        return (await baseDatos.ejecutar('SELECT id_empresa FROM empresa ORDER BY id_empresa ASC LIMIT 1', [])).rows[0] || null; 
    },
    
    async metodoPagoPorNombre(nombre) { 
        return (await baseDatos.ejecutar('SELECT id_metodo, metodo FROM metodo_pago WHERE metodo ILIKE $1 LIMIT 1', [`%${String(nombre).replace(/[\\%_*]/g, '\\$&')}%`])).rows[0] || null; 
    },
    
    async estadoPedidoPorNombre(nombre) { 
        return (await baseDatos.ejecutar('SELECT id_estadoped, estado FROM estado_pedido WHERE estado = $1 LIMIT 1', [nombre])).rows[0] || null; 
    },

    async clientePorDatos(datos) {
        if (datos.cedula) return (await baseDatos.ejecutar('SELECT id_cliente, nombre, cedula, correo FROM cliente WHERE cedula = $1 LIMIT 1', [datos.cedula])).rows[0] || null;
        if (datos.correo) return (await baseDatos.ejecutar('SELECT id_cliente, nombre, cedula, correo FROM cliente WHERE correo = $1 LIMIT 1', [datos.correo])).rows[0] || null;
        return (await baseDatos.ejecutar('SELECT id_cliente, nombre, cedula, correo FROM cliente WHERE nombre = $1 LIMIT 1', [datos.nombre])).rows[0] || null;
    },

    async clientePorId(id) {
        return (await baseDatos.ejecutar(
            'SELECT id_cliente, nombre, cedula, correo FROM cliente WHERE id_cliente = $1 LIMIT 1',
            [id]
        )).rows[0] || null;
    },
    
    async pedidoPorId(id) { 
        return (await baseDatos.ejecutar('SELECT id_pedido, id_empleado, id_cliente FROM pedido WHERE id_pedido = $1 LIMIT 1', [id])).rows[0] || null; 
    },
    
    async pedidoConCliente(id) { 
        return (await baseDatos.ejecutar('SELECT p.id_pedido, p.id_cliente, c.nombre AS cliente_nombre, c.cedula AS cliente_cedula, c.correo AS cliente_correo FROM pedido p JOIN cliente c ON c.id_cliente = p.id_cliente WHERE p.id_pedido = $1 LIMIT 1', [id])).rows[0] || null; 
    },
    
    async pagoPorPedido(id) { 
        return (await baseDatos.ejecutar('SELECT id_pedido, monto, id_metodo, id_pago, fec_creacion FROM pago WHERE id_pedido = $1 LIMIT 1', [id])).rows[0] || null; 
    },
    
    async pagoPorId(id) { 
        return (await baseDatos.ejecutar('SELECT id_pago, id_pedido, monto, id_metodo, fec_creacion FROM pago WHERE id_pago = $1 LIMIT 1', [id])).rows[0] || null; 
    },
    
    async facturaPorPedido(id) { 
        return (await baseDatos.ejecutar('SELECT id_factura, id_pedido, total, id_empresa FROM factura WHERE id_pedido = $1 LIMIT 1', [id])).rows[0] || null; 
    },
    
    async facturaPorId(id) { 
        return (await baseDatos.ejecutar('SELECT id_factura, id_pedido, total, id_empresa FROM factura WHERE id_factura = $1 LIMIT 1', [id])).rows[0] || null; 
    },
    
    async listarFacturas2025() { 
        return (await baseDatos.ejecutar('SELECT id_factura, total, fec_creacion, url_factura, id_pedido, id_empresa FROM vista_facturas_2025 ORDER BY fec_creacion DESC', [])).rows; 
    },
    
    async crearFactura(datos) {
        return (await baseDatos.ejecutar('INSERT INTO factura (total, id_pedido, id_empresa) VALUES ($1, $2, $3) RETURNING id_factura, id_pedido, total, id_empresa', [datos.total, datos.idPedido, datos.idEmpresa])).rows[0];
    },
    
    async eliminarFacturaPorPedido(id) { 
        return (await baseDatos.ejecutar('DELETE FROM factura WHERE id_pedido = $1 RETURNING id_factura', [id])).rows; 
    },
    
    async eliminarPagoPorPedido(id) { 
        return (await baseDatos.ejecutar('DELETE FROM pago WHERE id_pedido = $1 RETURNING id_pago', [id])).rows; 
    },
    
    async eliminarDetallesPedido(id) { 
        return (await baseDatos.ejecutar('DELETE FROM detalle_pedido WHERE id_pedido = $1 RETURNING id_pedido, id_producto', [id])).rows; 
    },

    async eliminarPedido(id) { 
        return (await baseDatos.ejecutar('DELETE FROM pedido WHERE id_pedido = $1 RETURNING id_pedido', [id])).rows; 
    },
    
    async recetasParaCaja() { 
        return (await baseDatos.ejecutar('SELECT r.id_receta, r.nombre, r.descripcion, p.id_producto AS producto_id, p.nombre AS producto_nombre, p.precio AS producto_precio, p.url_foto AS producto_foto, c.nombre AS producto_categoria FROM receta r JOIN producto p ON p.id_producto = r.id_producto LEFT JOIN categoria c ON c.id_categoria = p.id_categoria ORDER BY r.id_receta ASC', [])).rows; 
    },
    
    async recetaParaCaja(id) { 
        return (await baseDatos.ejecutar('SELECT r.id_receta, r.nombre, r.descripcion, r.id_producto, p.nombre AS producto_nombre FROM receta r JOIN producto p ON p.id_producto = r.id_producto WHERE r.id_receta = $1 LIMIT 1', [id])).rows[0] || null; 
    },
    
    async detallesRecetaParaCaja(id) { 
        return (await baseDatos.ejecutar('SELECT dr.id_insumo, dr.cantidad, i.nombre AS insumo_nombre, u.nombre AS unidad_nombre, u.abreviatura AS unidad_abreviatura FROM detalle_receta dr JOIN insumo i ON i.id_insumo = dr.id_insumo JOIN unidad_medida u ON u.id_unidad = i.id_unidad WHERE dr.id_receta = $1 ORDER BY dr.id_insumo', [id])).rows; 
    },
    
    async insumosParaCaja() { 
        return (await baseDatos.ejecutar('SELECT i.id_insumo, i.nombre, i.stock, i.fec_vencimiento, i.costo, i.id_proveedor, i.id_unidad, p.nombre AS proveedor, u.nombre AS unidad, u.abreviatura FROM insumo i LEFT JOIN proveedor p ON p.id_proveedor = i.id_proveedor JOIN unidad_medida u ON u.id_unidad = i.id_unidad ORDER BY i.id_insumo', [])).rows; 
    },
    
    async insumoParaCaja(id) { 
        return (await baseDatos.ejecutar('SELECT i.id_insumo, i.nombre, i.stock, i.fec_vencimiento, i.costo, i.id_proveedor, i.id_unidad, p.nombre AS proveedor, u.nombre AS unidad, u.abreviatura FROM insumo i LEFT JOIN proveedor p ON p.id_proveedor = i.id_proveedor JOIN unidad_medida u ON u.id_unidad = i.id_unidad WHERE i.id_insumo = $1 LIMIT 1', [id])).rows[0] || null; 
    },
    
    async productosParaCaja() { 
        return (await baseDatos.ejecutar(
        `SELECT DISTINCT p.id_producto, p.nombre, p.precio, p.descripcion, p.url_foto, p.id_categoria, COALESCE(c.nombre, '') AS categoria
        FROM producto p
        JOIN receta r ON r.id_producto = p.id_producto
        LEFT JOIN categoria c ON c.id_categoria = p.id_categoria
        WHERE NOT EXISTS (
            SELECT 1
            FROM receta r_vencida
            JOIN detalle_receta dr ON dr.id_receta = r_vencida.id_receta
            JOIN insumo i ON i.id_insumo = dr.id_insumo
            WHERE r_vencida.id_producto = p.id_producto
              AND i.fec_vencimiento < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date
        )
        ORDER BY p.id_producto ASC`, [])).rows; },
    
        async productosConInsumosVencidos(ids) {
        if (!ids.length) return [];
        return (await baseDatos.ejecutar(`
            SELECT DISTINCT p.id_producto, p.nombre, i.nombre AS insumo_nombre
            FROM producto p
            JOIN receta r ON r.id_producto = p.id_producto
            JOIN detalle_receta dr ON dr.id_receta = r.id_receta
            JOIN insumo i ON i.id_insumo = dr.id_insumo
            WHERE p.id_producto = ANY($1::int[])
              AND i.fec_vencimiento < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date`, [ids])).rows;
    },
    
    async categoriasParaCaja() { 
        return (await baseDatos.ejecutar('SELECT id_categoria, nombre FROM categoria ORDER BY nombre ASC', [])).rows; 
    },
    
    async crearCategoria(nombre) { 
        return (await baseDatos.ejecutar('INSERT INTO categoria (nombre) VALUES ($1) RETURNING id_categoria, nombre', [nombre])).rows[0]; 
    },
    
    async detallesVendidos() { 
        return (await baseDatos.ejecutar('SELECT id_producto, cantidad FROM detalle_pedido', [])).rows; 
    },
    
    async ultimaFactura() { 
        return (await baseDatos.ejecutar('SELECT id_pedido FROM factura ORDER BY id_factura DESC LIMIT 1', [])).rows; 
    },

    async descontarStockEnTransaccion(conexion, detalles) {
        for (const detalle of detalles) {
            const recetas = await conexion.query(
                'SELECT r.id_receta FROM receta r WHERE r.id_producto = $1',
                [detalle.id_producto]
            );
            for (const receta of recetas.rows) {
                const ingredientes = await conexion.query(
                    'SELECT dr.id_insumo, dr.cantidad FROM detalle_receta dr WHERE dr.id_receta = $1',
                    [receta.id_receta]
                );
                for (const ingrediente of ingredientes.rows) {
                    const insumo = await conexion.query(
                        'SELECT i.stock FROM insumo i WHERE i.id_insumo = $1 FOR UPDATE',
                        [ingrediente.id_insumo]
                    );
                    const disponible = Number(insumo.rows[0]?.stock || 0);
                    const requerido = Number(ingrediente.cantidad) * Number(detalle.cantidad);
                    if (!insumo.rows[0] || disponible < requerido) {
                        const error = new Error(`Stock insuficiente para el insumo ${ingrediente.id_insumo}.`);
                        error.status = 409;
                        throw error;
                    }
                    await conexion.query(
                        'UPDATE insumo SET stock = stock - $1 WHERE id_insumo = $2',
                        [requerido, ingrediente.id_insumo]
                    );
                }
            }
        }
    },

    async crearPedidoTransaccional(conexion, datos) {
        const cliente = datos.clienteExistente || (await conexion.query(
            'INSERT INTO cliente (nombre, cedula, correo) VALUES ($1, $2, $3) RETURNING id_cliente, nombre, cedula, correo',
            [datos.clienteNombre, datos.clienteCedula, datos.clienteCorreo]
        )).rows[0];
        const pedido = (await conexion.query(
            'INSERT INTO pedido (id_empleado, id_estadoped, id_cliente) VALUES ($1, $2, $3) RETURNING id_pedido',
            [datos.idEmpleado, datos.idEstadoPedido, cliente.id_cliente]
        )).rows[0];
        for (const detalle of datos.detalles) {
            await conexion.query(
                'INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad) VALUES ($1, $2, $3)',
                [pedido.id_pedido, detalle.id_producto, detalle.cantidad]
            );
        }
        if (datos.factura) {
            await conexion.query(
                'INSERT INTO factura (total, id_pedido, id_empresa) VALUES ($1, $2, $3)',
                [datos.total, pedido.id_pedido, datos.idEmpresa]
            );
        }
        if (datos.pago) {
            await conexion.query(
                'INSERT INTO pago (monto, id_pedido, id_metodo) VALUES ($1, $2, $3)',
                [datos.pago.monto, pedido.id_pedido, datos.pago.idMetodo]
            );
            await module.exports.descontarStockEnTransaccion(conexion, datos.detalles);
        }
        return { ...pedido, cliente };
    },

    async crearPedidoConTransaccion(datos) {
        return baseDatos.transaccion(conexion => module.exports.crearPedidoTransaccional(conexion, datos));
    },

    async confirmarPagoQrTransaccional(conexion, datos) {
        const pago = (await conexion.query(
            'INSERT INTO pago (monto, id_pedido, id_metodo) VALUES ($1, $2, $3) RETURNING id_pago, monto, id_pedido, id_metodo',
            [datos.monto, datos.idPedido, datos.idMetodo]
        )).rows[0];
        const detalles = await conexion.query(
            'SELECT id_pedido, id_producto, cantidad FROM detalle_pedido WHERE id_pedido = $1',
            [datos.idPedido]
        );
        await module.exports.descontarStockEnTransaccion(conexion, detalles.rows);
        const factura = (await conexion.query(
            'INSERT INTO factura (total, id_pedido, id_empresa) VALUES ($1, $2, $3) RETURNING id_factura, total, id_pedido, id_empresa',
            [datos.monto, datos.idPedido, datos.idEmpresa]
        )).rows[0];
        return { pago, factura };
    },

    async confirmarPagoQrConTransaccion(datos) {
        return baseDatos.transaccion(conexion => module.exports.confirmarPagoQrTransaccional(conexion, datos));
    },

    async cambiarEstadoPedido(idPedido, nombreEstado) {
        const estado = (await baseDatos.ejecutar(
            'SELECT id_estadoped FROM estado_pedido WHERE estado = $1 LIMIT 1',
            [nombreEstado]
        )).rows[0];
        if (!estado) throw new Error(`No está registrado el estado "${nombreEstado}" en la tabla estado_pedido.`);
        return baseDatos.ejecutar(
            'UPDATE pedido SET id_estadoped = $1 WHERE id_pedido = $2 RETURNING id_pedido, id_estadoped',
            [estado.id_estadoped, idPedido]
        ).then(resultado => resultado.rows[0] || null);
    }
};
