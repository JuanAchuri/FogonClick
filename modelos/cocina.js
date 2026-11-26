const baseDatos = require('./baseDatos');

// Modelo de cocina: solo expone las columnas que necesita el tablero.
module.exports = {
    async pedidosParaTablero() {
        const pedidos = await baseDatos.ejecutar(
            'SELECT p.id_pedido, p.fec_creacion, ep.estado, c.nombre AS cliente_nombre, c.cedula AS cliente_cedula FROM pedido p JOIN estado_pedido ep ON ep.id_estadoped = p.id_estadoped JOIN cliente c ON c.id_cliente = p.id_cliente ORDER BY p.fec_creacion DESC',
            []
        );
        const resultado = [];
        for (const pedido of pedidos.rows) {
            const detalles = await baseDatos.ejecutar(
                'SELECT dp.id_producto, dp.cantidad, pr.nombre FROM detalle_pedido dp JOIN producto pr ON pr.id_producto = dp.id_producto WHERE dp.id_pedido = $1 ORDER BY pr.nombre',
                [pedido.id_pedido]
            );
            resultado.push({ ...pedido, productos: detalles.rows });
        }
        return resultado;
    },
    
    async estadoPedido(idPedido) {
        return baseDatos.ejecutar(
            'SELECT p.id_pedido, p.id_estadoped, ep.estado FROM pedido p JOIN estado_pedido ep ON ep.id_estadoped = p.id_estadoped WHERE p.id_pedido = $1',
            [idPedido]
        ).then(resultado => resultado.rows[0] || null);
    },
    
    async idEstado(nombre) {
        return baseDatos.ejecutar(
            `SELECT id_estadoped, estado
             FROM estado_pedido
             WHERE LOWER(TRIM(estado)) = LOWER(TRIM($1))
                OR ($1 = 'cancelado' AND id_estadoped = 4)
             ORDER BY CASE WHEN $1 = 'cancelado' AND id_estadoped = 4 THEN 0 ELSE 1 END
             LIMIT 1`,
            [nombre]
        ).then(resultado => resultado.rows[0] || null);
    },
    
    async actualizarEstado(idPedido, idEstado) {
        return baseDatos.ejecutar('UPDATE pedido SET id_estadoped = $1 WHERE id_pedido = $2 RETURNING id_pedido, id_estadoped', [idEstado, idPedido]).then(resultado => resultado.rows[0] || null);
    }

};