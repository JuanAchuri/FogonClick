const express = require('express');
const modeloCocina = require('../modelos/cocina');

const router = express.Router();
const estadosPermitidos = new Set(['pendiente', 'preparacion', 'completado', 'cancelado']);

router.get('/pedidos', async (_req, res) => {
    try {
        const filas = await modeloCocina.pedidosParaTablero();
        res.json(filas.map(fila => ({
            id: fila.id_pedido,
            cliente_nombre: fila.cliente_nombre,
            cliente_cedula: fila.cliente_cedula,
            estado: fila.estado,
            fecha_creacion: fila.fec_creacion,
            productos: fila.productos.map(producto => ({
                id: producto.id_producto,
                nombre: producto.nombre,
                cantidad: producto.cantidad
            }))
        })));
    } catch (error) {
        console.error('Error al consultar pedidos de cocina:', error.message);
        res.status(error.status || 500).json({ error: 'Error al consultar pedidos de cocina.' });
    }
});

router.put('/pedidos/:id/estado', async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body || {};
    if (!estadosPermitidos.has(estado)) return res.status(400).json({ error: 'El estado debe ser pendiente, preparacion, completado o cancelado.' });

    try {
        const actual = await modeloCocina.estadoPedido(id);
        if (!actual) return res.status(404).json({ error: 'Pedido no encontrado.' });
        const transiciones = { pendiente: ['preparacion', 'cancelado'], preparacion: ['completado', 'cancelado'] };
        if (!transiciones[actual.estado]?.includes(estado)) return res.status(409).json({ error: `No se puede pasar un pedido de ${actual.estado} a ${estado}.` });
        const estadoDestino = await modeloCocina.idEstado(estado);
        if (!estadoDestino) return res.status(409).json({ error: `El estado "${estado}" no está registrado en la base de datos.` });
        const actualizado = await modeloCocina.actualizarEstado(id, estadoDestino.id_estadoped);
        if (!actualizado) return res.status(404).json({ error: 'Pedido no encontrado.' });
        res.json({ mensaje: 'Estado actualizado.', id, estado });
    } catch (error) {
        console.error('Error al actualizar estado del pedido:', error.message);
        res.status(error.status || 500).json({ error: 'Error al actualizar estado del pedido.' });
    }
});

module.exports = router;
