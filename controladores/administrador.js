const express = require('express');
const router = express.Router();
const db = require('../modelos/Admin');
const {
    normalizarRol, rolId, estadoEmpleadoId, estadoPedidoId,
    existe, hashPassword, httpStatus
} = require('../modelos/auxiliares');

// Este archivo contiene operaciones exclusivas del panel de administración.
router.use((req, res, next) => {
    if (req.employee?.rol?.rol === 'admin') return next();

    return res.status(403).json({
        success: false,
        message: 'Solo administración puede usar estas operaciones.'
    });
});

// Arma el error que verá el navegador y conserva el código que responde Supabase.
function fail(res, error, message) {
    return res.status(httpStatus(error)).json({
        success: false,
        message: message || error.message,
        error: error.message
    });
}

// Busca el ID de la categoría por nombre y la crea si todavía no existe.
async function categoryId(nombre) {
    if (!nombre) return null;

    let row = await db.categoriaPorNombre(nombre);

    if (!row) row = await db.crearCategoria(nombre);

    return row.id_categoria;
}

// Busca la unidad por nombre o abreviatura y la crea si no existe.
async function unitId(nombre) {
    if (!nombre) return null;

    let row = await db.unidadPorNombre(nombre);

    if (!row) row = await db.unidadPorAbreviatura(nombre);

    if (!row) row = await db.crearUnidad(nombre, nombre.slice(0, 10));

    return row.id_unidad;
}

// Usa solamente los roles permitidos para empleados: cocina es ID 2 y caja es ID 3.
// Acepta 'caja' | 'cocina' (o un id de la tabla rol) y devuelve el id_rol real.
async function idRolEmpleado(value) {
    const input = String(value ?? '').trim();
    let nombre = normalizarRol(input);
    if (/^\d+$/.test(input)) nombre = normalizarRol((await db.rolPorId(input))?.rol);
    if (!['caja', 'cocina'].includes(nombre)) {
        const error = new Error('El rol del empleado debe ser Caja o Cocina.');
        error.status = 400;
        throw error;
    }
    return rolId(nombre);
}

// La contraseña ya no se puede mostrar: en usuario solo existe su hash.
function vistaEmpleado(row) {
    return {
        ID: row.id_empleado,
        NOMBRE: row.nombre,
        CEDULA: row.cedula,
        CORREO: row.correo || row.usuario?.correo || '',
        CONTRASENA: '',
        TELEFONO: row.telefono,
        ID_ROL: row.id_rol,
        ROL: row.rol || row.rol?.rol || '',
        ESTADO: row.estado || row.estado_empleado?.estado || ''
    };
}

// Empleado activo de la empresa del administrador que hace la petición.
async function empleadoActivo(req) {
    return db.empleadoActivo(req.params.id, req.employee.id_empresa, await estadoEmpleadoId('activo'));
}

// Prepara el ID, la cédula, el correo, la contraseña, el rol y el teléfono para la tabla de empleados.
function vistaEmpleado(row) {
    return {
        ID: row.id_empleado,
        NOMBRE: row.nombre,
        CEDULA: row.cedula,
        CORREO: row.correo || row.usuario?.correo || '',
        CONTRASENA: '',
        TELEFONO: row.telefono,
        ID_ROL: row.id_rol,
        ROL: row.rol || row.rol?.rol || '',
        ESTADO: row.estado || row.estado_empleado?.estado || ''
    };
}

// Prepara el ID, el nombre, el correo y el teléfono para la tabla de proveedores.
function vistaProveedor(row) {
    return {
        ID: row.id_proveedor,
        NOMBRE: row.nombre,
        CORREO: row.correo,
        TELEFONO: row.telefono
    };
}

// Prepara el nombre, el precio, la categoría y la descripción para el menú y el panel de productos.
function vistaProducto(row) {
    return {
        ID: row.id_producto,
        NOMBRE: row.nombre,
        PRECIO: row.precio,
        CATEGORIA: row.categoria || row.categoria_nombre || row.categoria?.nombre || '',
        ID_CATEGORIA: row.id_categoria,
        DESCRIPCION: row.descripcion,
        FOTO: row.url_foto,
        URL_FOTO: row.url_foto
    };
}

// Prepara el nombre, la unidad, el stock, el vencimiento y el proveedor para la tabla de inventario.
function vistaInsumo(row) {
    return {
        ID: row.id_insumo,
        NOMBRE: row.nombre,
        UNIDAD: row.abreviatura || row.unidad_medida?.abreviatura || row.unidad_medida?.nombre || '',
        STOCK: row.stock,
        FECHA_VENCIMIENTO: row.fec_vencimiento,
        ID_PROVEEDOR: row.id_proveedor,
        PROVEEDOR: row.proveedor || row.proveedor?.nombre || '',
        COSTO_COMPRA: row.costo,
        COSTO: row.costo,
        ID_UNIDAD: row.id_unidad
    };
}

// Prepara el número, el pedido, el total y la fecha de emisión para la tabla de facturas.
function vistaFactura(row) {
    return {
        ID_FACTURA: row.id_factura,
        ID_PEDIDO: row.id_pedido,
        TOTAL: row.total,
        // La tabla del panel todavía espera este nombre para el subtotal.
        SUBTOTAL: row.total,
        URL_FACTURA: row.url_factura,
        FECHA_EMISION: row.fec_creacion
    };
}

// Consulta pedidos, pagos, insumos y detalles para calcular los indicadores del panel.
async function datosPanel() {
    const idCompletado = await estadoPedidoId('completado');

    return db.panelDatos(idCompletado);
}

// Convierte una fecha a AAAA-MM-DD según el horario de Bogotá.
function fechaEnBogota(fecha) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(fecha));
}

// Devuelve la fecha actual del restaurante en horario de Bogotá.
function fechaHoyBogota() {
    return fechaEnBogota(new Date());
}


// ESTADÍSTICAS

// Cuenta los pedidos completados hoy según id_estado = 3 ().
router.get('/estadisticas/pedidos-hoy', async (_req, res) => {
    try {
        const resumen = await db.resumenEstadisticasHoy();
        res.json({ success: true, total: Number(resumen?.pedidos_hoy || 0) });
    } catch (error) {
        fail(res, error, 'Error al consultar pedidos');
    }
});

// Suma los pagos de hoy cuyo estado es 1 (pagado).
router.get('/estadisticas/ventas-hoy', async (_req, res) => {
    try {
        const resumen = await db.resumenEstadisticasHoy();
        res.json({ success: true, total: Number(resumen?.ventas_hoy || 0) });
    } catch (error) {
        fail(res, error, 'Error al consultar ventas');
    }
});

router.get('/estadisticas/ventas-rango', async (req, res) => {
    try {
        const periodo = String(req.query.periodo || 'diario').trim().toLowerCase();
        if (!['diario', 'semanal', 'mensual', 'anual'].includes(periodo)) {
            return res.status(400).json({ success: false, message: 'Selecciona un periodo válido.' });
        }
        const resultado = await db.estadisticasVentasPorPeriodo(periodo);
        return res.json({ success: true, periodo, ...resultado });
    } catch (error) {
        return fail(res, error, 'Error al consultar estadísticas del periodo');
    }
});


// Suma las cantidades de detalle_pedido y devuelve el producto más vendido.
router.get('/estadisticas/mas-vendido', async (_req, res) => {
    try {
        const { detalles, productos } = await datosPanel();
        const ventas = new Map();

        for (const detalle of detalles) {
            ventas.set(
                detalle.id_producto,
                (ventas.get(detalle.id_producto) || 0) + Number(detalle.cantidad)
            );
        }

        productos.sort(
            (a, b) =>
                (ventas.get(b.id_producto) || 0) -
                (ventas.get(a.id_producto) || 0)
        );

        const primero = productos[0];

        res.json({
            success: true,
            nombre: primero && ventas.has(primero.id_producto)
                ? primero.nombre
                : '-'
        });
    } catch (error) {
        fail(res, error, 'Error al consultar más vendido');
    }
});

// Suma el valor del inventario: stock de cada insumo por su costo unitario.
router.get('/estadisticas/gastos', async (_req, res) => {
    try {
        const { insumos } = await datosPanel();
        const total = insumos.reduce(
            (sum, i) => sum + Number(i.stock) * Number(i.costo),
            0
        );

        res.json({ success: true, total });
    } catch (error) {
        fail(res, error, 'Error al consultar gastos');
    }
});

// Suma todos los pagos confirmados con id_estado = 1.
router.get('/estadisticas/ingresos', async (_req, res) => {
    try {
        const { pagos } = await datosPanel();
        const total = pagos.reduce((sum, p) => sum + Number(p.monto), 0);

        res.json({ success: true, total });
    } catch (error) {
        fail(res, error, 'Error al consultar ingresos');
    }
});

// Calcula la ganancia restando los costos del inventario a los pagos confirmados.
router.get('/estadisticas/ganancias', async (_req, res) => {
    try {
        const { pagos, insumos } = await datosPanel();

        const ingresos = pagos.reduce(
            (sum, p) => sum + Number(p.monto),
            0
        );

        const gastos = insumos.reduce(
            (sum, i) => sum + Number(i.stock) * Number(i.costo),
            0
        );

        res.json({ success: true, total: ingresos - gastos });
    } catch (error) {
        fail(res, error, 'Error al consultar ganancias');
    }
});


// EMPLEADOS

// Crear: registra la cuenta de acceso y guarda cédula, contraseña y datos del empleado.
router.post('/empleados', async (req, res) => {
    const { nombre, cedula, correo, telefono, password, rol = 'caja' } = req.body || {};
    if (!nombre?.trim() || !cedula?.trim() || !correo?.trim() || !telefono?.trim() || !password) {
        return res.status(400).json({ success: false, message: 'Nombre, rol, cédula, teléfono, correo y contraseña son obligatorios.' });
    }

    const mail = correo.trim();
    const ced = String(cedula).trim();
    let usuario;
    try {
        if (await existe('empleado', 'cedula', ced))
            return res.status(409).json({ success: false, message: 'Ya existe un empleado con esa cédula.' });
        if (await existe('usuario', 'correo', mail, { ilike: true }))
            return res.status(409).json({ success: false, message: 'Ya existe una cuenta con ese correo.' });

        const id_rol = await idRolEmpleado(rol);
        const id_estadoemp = await estadoEmpleadoId('activo');

        // 1) credenciales  2) perfil enlazado con id_usuario
        usuario = await db.crearUsuario(mail, await hashPassword(password));
        const empleado = await db.crearEmpleado({
            nombre: nombre.trim(), telefono: telefono.trim(), cedula: ced,
            idRol: id_rol, idEstado: id_estadoemp, idUsuario: usuario.id_usuario,
            idEmpresa: req.employee.id_empresa
        });

        // La cuenta de Supabase Auth se crea/enlaza sola en el primer login.
        res.status(201).json({ success: true, message: 'Empleado creado correctamente', id: empleado.id_empleado });
    } catch (error) {
        if (usuario) await db.eliminarUsuario(usuario.id_usuario).catch(() => {});
        fail(res, error, `Error al guardar empleado: ${error.message}`);
    }
});

// Consultar por ID: carga los datos y la contraseña del empleado seleccionado.
router.get('/empleados/:id', async (req, res) => {
    try {
        const row = await empleadoActivo(req);
        if (!row) return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
        res.json({ success: true, empleado: vistaEmpleado(row) });
    } catch (error) {
        fail(res, error, 'Error al buscar empleado');
    }
})

// Editar: actualiza los datos personales y sincroniza correo o contraseña con Supabase Auth.
router.put('/empleados/:id', async (req, res) => {
    try {
        const current = await empleadoActivo(req);
        if (!current) return res.status(404).json({ success: false, message: 'Empleado no encontrado' });

        const body = req.body || {};
        const changes = {};         // tabla empleado
        const credenciales = {};    // tabla usuario

        if (body.nombre !== undefined) changes.nombre = String(body.nombre).trim();
        if (body.telefono !== undefined) {
            if (!String(body.telefono).trim()) return res.status(400).json({ success: false, message: 'El teléfono es obligatorio.' });
            changes.telefono = String(body.telefono).trim();
        }
        if (body.rol) changes.id_rol = await idRolEmpleado(body.rol);

        if (body.cedula !== undefined) {
            const ced = String(body.cedula).trim();
            if (ced !== current.cedula) {
                if (await existe('empleado', 'cedula', ced, { excluir: { columna: 'id_empleado', valor: current.id_empleado } }))
                    return res.status(409).json({ success: false, message: 'Ya existe un empleado con esa cédula.' });
                changes.cedula = ced;
            }
        }

        const correoNuevo = body.correo?.trim();
        const correoActual = current.usuario?.correo || '';
        const cambioCorreo = Boolean(correoNuevo && correoNuevo.toLowerCase() !== correoActual.toLowerCase());
        if (cambioCorreo) {
            const ocupado =
                await existe('usuario', 'correo', correoNuevo, { ilike: true, excluir: { columna: 'id_usuario', valor: current.id_usuario } });
            if (ocupado) return res.status(409).json({ success: false, message: 'Ya existe una cuenta con ese correo.' });
            credenciales.correo = correoNuevo;
        }
        if (body.password) credenciales.password = await hashPassword(body.password);

        if (!Object.keys(changes).length && !Object.keys(credenciales).length) {
            return res.status(400).json({ success: false, message: 'No hay campos para actualizar' });
        }

        // Sincroniza Supabase Auth si la cuenta ya existe (si no, se crea en el próximo login).
        if (cambioCorreo || body.password) {
            const cuenta = await db.auth.findUserByEmail(correoActual);
            if (cuenta?.id) {
                await db.auth.updateUser(cuenta.id, {
                    ...(cambioCorreo ? { email: correoNuevo } : {}),
                    ...(body.password ? { password: body.password } : {})
                });
            }
        }
        if (Object.keys(credenciales).length) await db.actualizarUsuario(current.id_usuario, credenciales);
        if (Object.keys(changes).length) await db.actualizarEmpleado(current.id_empleado, changes);

        res.json({ success: true, message: 'Empleado actualizado correctamente' });
    } catch (error) {
        fail(res, error, `Error al actualizar empleado: ${error.message}`);
    }
});


// Eliminar: borra al empleado de esta empresa y su cuenta si no tiene pedidos asociados.
router.delete('/empleados/:id', async (req, res) => {
    try {
        const row = await empleadoActivo(req);
        if (!row) return res.status(404).json({ success: false, message: 'Empleado no encontrado' });

        if (normalizarRol(row.rol?.rol) === 'admin' || Number(row.id_empleado) === Number(req.employee.id_empleado)) {
            return res.status(403).json({ success: false, message: 'No se puede eliminar un administrador' });
        }

        const pedidos = await db.pedidosDeEmpleado(row.id_empleado);
        if (pedidos.length) {
            return res.status(409).json({ success: false, message: 'No se puede eliminar: el empleado tiene pedidos asociados.' });
        }

        const cuenta = await db.auth.findUserByEmail(row.usuario?.correo || '');

        // Orden por las FK: primero empleado, luego usuario, luego Auth.
        await db.eliminarEmpleado(row.id_empleado);
        await db.eliminarUsuario(row.id_usuario);
        if (cuenta?.id) await db.auth.deleteUser(cuenta.id);

        res.json({ success: true, message: 'Empleado eliminado correctamente' });
    } catch (error) {
        fail(res, error, `Error al eliminar empleado: ${error.message}`);
    }
});

// Consultar: lista ID, nombre, cédula, correo, contraseña, rol y teléfono de cada empleado activo.
router.get('/empleados', async (req, res) => {
    try {
        const rows = await db.empleadosDeEmpresa(req.employee.id_empresa, await estadoEmpleadoId('activo'));
        res.json({ success: true, empleados: rows.map(vistaEmpleado) });
    } catch (error) {
        fail(res, error, 'Error al consultar empleados');
    }
});

// PROVEEDORES

// Crear: guarda nombre, correo y teléfono del proveedor.
router.post('/proveedores', async (req, res) => {
    try {
        if (!req.body.nombre?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'El nombre del proveedor es obligatorio.'
            });
        }

        const row = await db.crearProveedor({
            nombre: req.body.nombre.trim(),
            correo: req.body.correo || null,
            telefono: req.body.telefono || null,
            nit: req.body.nit || null
        });

        res.status(201).json({
            success: true,
            message: 'Proveedor creado correctamente',
            id: row.id_proveedor
        });
    } catch (error) {
        fail(res, error, `Error al guardar proveedor: ${error.message}`);
    }
});

// Consultar por ID: carga los datos del proveedor para el formulario de edición.
router.get('/proveedores/:id', async (req, res) => {
    try {
        const row = await db.proveedorPorId(req.params.id);

        if (!row) {
            return res.status(404).json({
                success: false,
                message: 'Proveedor no encontrado'
            });
        }

        res.json({ success: true, proveedor: vistaProveedor(row) });
    } catch (error) {
        fail(res, error, 'Error al buscar proveedor');
    }
});

// Editar: actualiza los datos de contacto del proveedor seleccionado.
router.put('/proveedores/:id', async (req, res) => {
    try {
        const changes = {};

        for (const field of ['nombre', 'correo', 'telefono', 'nit']) {
            if (req.body[field] !== undefined) {
                changes[field] = req.body[field] || null;
            }
        }

        if (!Object.keys(changes).length) {
            return res.status(400).json({
                success: false,
                message: 'No hay campos para actualizar.'
            });
        }

        const rows = await db.actualizarProveedor(req.params.id, changes);

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Proveedor no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Proveedor actualizado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al actualizar proveedor: ${error.message}`);
    }
});

// Eliminar: borra el proveedor seleccionado si la base de datos no tiene insumos asociados.
router.delete('/proveedores/:id', async (req, res) => {
    try {
        const rows = await db.eliminarProveedor(req.params.id);

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Proveedor no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Proveedor eliminado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al eliminar proveedor: ${error.message}`);
    }
});

// Consultar: lista el ID, nombre, correo y teléfono de cada proveedor.
router.get('/proveedores', async (_req, res) => {
    try {
        const rows = await db.listarProveedores();

        res.json({
            success: true,
            proveedores: rows.map(vistaProveedor)
        });
    } catch (error) {
        fail(res, error, 'Error al consultar proveedores');
    }
});


// INSUMOS

// Lista las unidades persistidas para el selector del formulario de insumos.
router.get('/unidades', async (_req, res) => {
    try {
        const unidades = await db.listarUnidades();
        res.json({ success: true, unidades: unidades.map(unidad => ({
            ID: unidad.id_unidad,
            NOMBRE: unidad.nombre,
            ABREVIATURA: unidad.abreviatura
        })) });
    } catch (error) {
        fail(res, error, 'No se pudieron consultar las unidades de medida.');
    }
});

router.get('/insumos/por-vencer', async (_req, res) => {
    try {
        const filas = await db.listarInsumosPorVencer();
        return res.json({
            success: true,
            insumos: filas.map(fila => ({
                ID: fila.id_insumo,
                NOMBRE: fila.nombre,
                STOCK: fila.stock,
                FECHA_VENCIMIENTO: fila.fec_vencimiento,
                ESTADO: fila.estado_vencimiento
            }))
        });
    } catch (error) {
        return fail(res, error, 'No se pudieron consultar los insumos próximos a vencer.');
    }
});

// Crear: guarda el insumo con unidad, stock, vencimiento, costo y proveedor.
router.post('/insumos', async (req, res) => {
    const body = req.body || {};

    try {
        if (!body.nombre?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'El nombre del insumo es obligatorio.'
            });
        }

        // Si faltan estos IDs, los buscamos o creamos más abajo.
        const idProveedor = body.id_proveedor
            ? Number(body.id_proveedor)
            : null;

        if (idProveedor) {
            const supplier = await db.proveedorExiste(idProveedor);

            if (!supplier) {
                return res.status(400).json({
                    success: false,
                    message: 'El proveedor seleccionado no existe.'
                });
            }
        }

        const esDirecto = Boolean(body.es_producto_directo);
        const unidadSeleccionada = esDirecto
            ? 'unidades'
            : String(body.unidad || body.tipo_unidad || '').trim();
        const idUnidad = unidadSeleccionada
            ? await unitId(unidadSeleccionada)
            : (body.id_unidad ? Number(body.id_unidad) : null);
        if (!idUnidad) return res.status(400).json({ success: false, message: 'Selecciona un tipo de unidad.' });

        let row;
        if (esDirecto) {
            if (!Number.isFinite(Number(body.precio)) || Number(body.precio) <= 0) {
                return res.status(400).json({ success: false, message: 'El precio de venta es obligatorio para un insumo directo.' });
            }
            const idCategoria = await categoryId(body.categoria || 'General');
            const resultado = await db.crearInsumoDirectoTransaccional({
                nombre: body.nombre.trim(),
                stock: Number(body.stock) || 0,
                fecVencimiento: body.fecha_vencimiento || null,
                costo: Number(body.costo_compra ?? body.costo) || 0,
                idProveedor,
                idUnidad,
                precio: Number(body.precio) || 0,
                descripcion: body.descripcion || '',
                urlFoto: body.foto || '',
                idCategoria
            });
            row = resultado.insumo;
        } else {
            row = await db.crearInsumo({
                nombre: body.nombre.trim(),
                stock: Number(body.stock) || 0,
                fecVencimiento: body.fecha_vencimiento || null,
                costo: Number(body.costo_compra ?? body.costo) || 0,
                idProveedor,
                idUnidad
            });
        }

        res.status(201).json({
            success: true,
            message: esDirecto
                ? 'Insumo, producto y receta directa creados'
                : 'Insumo creado correctamente',
            id: row.id_insumo
        });
    } catch (error) {
        fail(res, error, `Error al guardar insumo: ${error.message}`);
    }
});

// Consultar por ID: carga los datos del insumo para el formulario de edición.
router.get('/insumos/:id', async (req, res) => {
    try {
        const row = await db.insumoPorId(req.params.id);

        if (!row) {
            return res.status(404).json({
                success: false,
                message: 'Insumo no encontrado'
            });
        }

        res.json({ success: true, insumo: vistaInsumo(row) });
    } catch (error) {
        fail(res, error, 'Error al buscar insumo');
    }
});

// Editar: actualiza los datos del insumo y su producto directo cuando aplica.
router.put('/insumos/:id', async (req, res) => {
    try {
        const body = req.body || {};
        const changes = {};

        if (body.nombre !== undefined) changes.nombre = body.nombre;
        if (body.stock !== undefined) changes.stock = Number(body.stock);

        if (body.fecha_vencimiento !== undefined) {
            changes.fec_vencimiento = body.fecha_vencimiento || null;
        }

        if (body.costo_compra !== undefined || body.costo !== undefined) {
            changes.costo = Number(body.costo_compra ?? body.costo);
        }

        if (body.id_proveedor !== undefined) {
            changes.id_proveedor = body.id_proveedor
                ? Number(body.id_proveedor)
                : null;
        }

        if (body.unidad !== undefined) {
            changes.id_unidad = body.unidad
                ? await unitId(body.unidad.trim())
                : null;
        } else if (body.id_unidad !== undefined) {
            changes.id_unidad = body.id_unidad
                ? Number(body.id_unidad)
                : null;
        }

        if (!Object.keys(changes).length) {
            return res.status(400).json({
                success: false,
                message: 'No hay campos para actualizar.'
            });
        }

        const rows = await db.actualizarInsumo(req.params.id, changes);

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Insumo no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Insumo actualizado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al actualizar insumo: ${error.message}`);
    }
});

// Reabastecer: este flujo solo modifica vencimiento y stock de un insumo agotado.
router.patch('/insumos/:id/reabastecer', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const stock = Number(req.body?.stock);
        const fecha = String(req.body?.fecha_vencimiento || '').trim();
        if (!Number.isInteger(id) || id < 1 || !fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
            return res.status(400).json({ success: false, message: 'Indica una fecha de vencimiento válida.' });
        }
        const fechaValida = new Date(`${fecha}T00:00:00Z`);
        if (Number.isNaN(fechaValida.getTime()) || fechaValida.toISOString().slice(0, 10) !== fecha) {
            return res.status(400).json({ success: false, message: 'La fecha de vencimiento no existe.' });
        }
        if (!Number.isFinite(stock) || stock <= 0) {
            return res.status(400).json({ success: false, message: 'La cantidad de reabastecimiento debe ser mayor que cero.' });
        }
        const actual = await db.insumoPorId(id);
        if (!actual) return res.status(404).json({ success: false, message: 'Insumo no encontrado.' });
        if (Number(actual.stock) !== 0) {
            return res.status(409).json({ success: false, message: 'Solo se pueden reabastecer insumos con stock en 0.' });
        }
        const rows = await db.reabastecerInsumo(id, fecha, stock);
        return res.json({ success: true, insumo: rows[0] });
    } catch (error) {
        return fail(res, error, `Error al reabastecer insumo: ${error.message}`);
    }
});

// Eliminar: borra el insumo seleccionado si ninguna receta lo está usando.
router.delete('/insumos/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const insumo = await db.insumoPorId(id);
        if (!insumo) return res.status(404).json({ success: false, message: 'Insumo no encontrado' });

        const rows = await db.eliminarInsumoCompleto(id);

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Insumo no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Insumo eliminado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al eliminar insumo: ${error.message}`);
    }
});

// Consultar: lista ID, nombre, unidad, stock, fecha de vencimiento y proveedor de cada insumo.
router.get('/insumos', async (_req, res) => {
    try {
        const rows = await db.listarInsumos();

        res.json({
            success: true,
            insumos: rows.map(vistaInsumo)
        });
    } catch (error) {
        fail(res, error, 'Error al consultar insumos');
    }
});


// PRODUCTOS

// Crear: guarda nombre, precio y descripción y busca o crea la categoría.
router.post('/productos', async (req, res) => {
    try {
        const body = req.body || {};

        if (!body.nombre?.trim() || !Number.isFinite(Number(body.precio))) {
            return res.status(400).json({
                success: false,
                message: 'Nombre y precio válido son obligatorios.'
            });
        }

        const idCategoria = await categoryId(body.categoria || 'General');

        const row = await db.crearProducto({
            nombre: body.nombre.trim(),
            precio: Number(body.precio),
            descripcion: body.descripcion || '',
            urlFoto: body.foto || body.url_foto || '',
            idCategoria
        });

        res.status(201).json({
            success: true,
            message: 'Producto creado correctamente',
            id: row.id_producto
        });
    } catch (error) {
        fail(res, error, `Error al guardar producto: ${error.message}`);
    }
});

// Consultar por ID: carga los datos del producto para el formulario de edición.
router.get('/productos/:id', async (req, res) => {
    try {
        const row = await db.productoPorId(req.params.id);

        if (!row) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        res.json({ success: true, producto: vistaProducto(row) });
    } catch (error) {
        fail(res, error, 'Error al buscar producto');
    }
});

// Editar: actualiza nombre, precio, categoría, foto y descripción del producto.
router.put('/productos/:id', async (req, res) => {
    try {
        const body = req.body || {};
        const changes = {};

        if (body.nombre !== undefined) changes.nombre = body.nombre;
        if (body.precio !== undefined) changes.precio = Number(body.precio);
        if (body.descripcion !== undefined) changes.descripcion = body.descripcion || '';

        if (body.foto !== undefined || body.url_foto !== undefined) {
            changes.url_foto = body.foto || body.url_foto || '';
        }

        if (body.categoria !== undefined) {
            changes.id_categoria = body.categoria
                ? await categoryId(body.categoria)
                : null;
        }

        if (!Object.keys(changes).length) {
            return res.status(400).json({
                success: false,
                message: 'No hay campos para actualizar.'
            });
        }

        const rows = await db.actualizarProducto(req.params.id, changes);

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Producto actualizado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al actualizar producto: ${error.message}`);
    }
});

// Eliminar: borra el producto seleccionado si no aparece en pedidos ni recetas.
router.delete('/productos/:id', async (req, res) => {
    try {
        const rows = await db.eliminarProducto(req.params.id);

        if (!rows.length) {
            return res.status(404).json({
                success: false,
                message: 'Producto no encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Producto eliminado correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al eliminar producto: ${error.message}`);
    }
});

// Consultar: lista ID, nombre, precio, categoría y descripción de los productos del menú.
router.get('/productos', async (_req, res) => {
    try {
        const rows = await db.listarProductos();

        res.json({
            success: true,
            productos: rows.map(vistaProducto)
        });
    } catch (error) {
        fail(res, error, 'Error al consultar productos');
    }
});


// RECETAS

// Combina filas repetidas del mismo insumo antes de guardarlas.
function combinarInsumosReceta(insumos) {
    const cantidades = new Map();

    for (const item of insumos) {
        const idInsumo = Number(item.id_insumo);
        const cantidad = Number(item.cantidad);
        cantidades.set(idInsumo, (cantidades.get(idInsumo) || 0) + cantidad);
    }

    return Array.from(cantidades, ([id_insumo, cantidad]) => ({ id_insumo, cantidad }));
}

// Crear: guarda el nombre, producto, descripción y los insumos usados por la receta.
router.post('/recetas', async (req, res) => {
    let receta;

    try {
        const body = req.body || {};

        if (!body.nombre || !body.id_producto || !Array.isArray(body.insumos) || !body.insumos.length) {
            return res.status(400).json({
                success: false,
                message: 'Nombre, producto y al menos un insumo son obligatorios.'
            });
        }

        receta = await db.crearReceta({
            nombre: body.nombre,
            descripcion: body.descripcion || '',
            idProducto: Number(body.id_producto)
        });

        if (Array.isArray(body.insumos) && body.insumos.length) {
            const insumos = combinarInsumosReceta(body.insumos);
            await db.crearDetallesReceta(receta.id_receta, insumos);
        }

        res.status(201).json({
            success: true,
            message: 'Receta creada correctamente',
            id: receta.id_receta
        });
    } catch (error) {
        if (receta?.id_receta) {
            await db.eliminarReceta(receta.id_receta).catch(() => {});
        }

        fail(res, error, `Error al crear receta: ${error.message}`);
    }
});

// Consultar por ID: carga el producto y las cantidades de insumos de la receta.
router.get('/recetas/:id', async (req, res) => {
    try {
        const receta = await db.recetaPorId(req.params.id);

        if (!receta) {
            return res.status(404).json({
                success: false,
                message: 'Receta no encontrada'
            });
        }

        const rows = await db.detallesDeReceta(req.params.id);

        res.json({
            success: true,
            receta: {
                ID: receta.id_receta,
                NOMBRE: receta.nombre,
                DESCRIPCION: receta.descripcion,
                ID_PRODUCTO: receta.id_producto,
                PRODUCTO_NOMBRE: receta.producto_nombre
            },
            detalles: rows.map(row => ({
                ID_INSUMO: row.id_insumo,
                CANTIDAD: row.cantidad,
                INSUMO_NOMBRE: row.insumo_nombre,
                INSUMO_UNIDAD:
                    row.unidad_abreviatura ||
                    row.unidad_nombre ||
                    ''
            }))
        });
    } catch (error) {
        fail(res, error, 'Error al buscar receta');
    }
});

// Editar: actualiza la receta y reemplaza la lista de insumos asociados.
router.put('/recetas/:id', async (req, res) => {
    try {
        const body = req.body || {};
        const changes = {};

        for (const field of ['nombre', 'descripcion']) {
            if (body[field] !== undefined) {
                changes[field] = body[field] || null;
            }
        }

        if (body.id_producto !== undefined) {
            changes.id_producto = body.id_producto
                ? Number(body.id_producto)
                : null;
        }

        if (Object.keys(changes).length) {
            const rows = await db.actualizarReceta(req.params.id, changes);

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: 'Receta no encontrada'
                });
            }
        }

        if (Array.isArray(body.insumos)) {
            if (body.insumos.length) {
                const insumos = combinarInsumosReceta(body.insumos);
                await db.reemplazarDetallesReceta(Number(req.params.id), insumos);
            } else {
                await db.reemplazarDetallesReceta(Number(req.params.id), []);
            }
        }

        if (!Object.keys(changes).length && !Array.isArray(body.insumos)) {
            return res.status(400).json({
                success: false,
                message: 'No hay campos para actualizar.'
            });
        }

        res.json({
            success: true,
            message: 'Receta actualizada correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al actualizar receta: ${error.message}`);
    }
});

// Eliminar: borra la receta y sus relaciones con insumos.
router.delete('/recetas/:id', async (req, res) => {
    try {
        const receta = await db.recetaPorId(req.params.id);

        if (!receta) {
            return res.status(404).json({
                success: false,
                message: 'Receta no encontrada'
            });
        }

        await db.eliminarReceta(req.params.id);

        res.json({
            success: true,
            message: 'Receta eliminada correctamente'
        });
    } catch (error) {
        fail(res, error, `Error al eliminar receta: ${error.message}`);
    }
});

// Consultar: lista ID, nombre, producto asociado y descripción de cada receta.
router.get('/recetas', async (_req, res) => {
    try {
        const rows = await db.listarRecetas();

        const recetas = rows.map(row => ({
            ID: row.id_receta,
            NOMBRE: row.nombre,
            DESCRIPCION: row.descripcion,
            PRODUCTO_ID: row.producto_id,
            PRODUCTO_NOMBRE: row.producto_nombre,
            PRODUCTO_PRECIO: row.producto_precio,
            PRODUCTO_CATEGORIA: row.producto_categoria || '',
            PRODUCTO_FOTO: row.producto_foto
        }));

        res.json({ success: true, recetas });
    } catch (error) {
        fail(res, error, 'Error al consultar recetas');
    }
});


// FACTURAS

// Consultar: lista las facturas (id, total, feha y opcion de ver pdf) y permite limitar el resultado a una fecha.
router.get('/facturas', async (req, res) => {
    try {
        const dia = Number(req.query.dia);
        const mes = Number(req.query.mes);
        const anioActual = Number(new Intl.DateTimeFormat('en', {
            timeZone: 'America/Bogota',
            year: 'numeric'
        }).format(new Date()));
        let rows;
        if (req.query.anio === '2025') rows = await db.listarFacturas2025();
        else if (Number.isInteger(dia) && Number.isInteger(mes)) {
            if (dia < 1 || dia > 31 || mes < 1 || mes > 12) {
                return res.status(400).json({ success: false, message: 'El día o mes no es válido.' });
            }
            rows = await db.listarFacturasPorDiaMes(dia, mes, anioActual);
        } else rows = await db.listarFacturas();

        res.json({
            success: true,
            facturas: rows.map(vistaFactura)
        });
    } catch (error) {
        fail(res, error, 'Error al consultar facturas');
    }
});


module.exports = router;
