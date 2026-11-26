const baseDatos = require('./baseDatos');

async function filas(sql, parametros = []) {
    return (await baseDatos.ejecutar(sql, parametros)).rows;
}

async function registrarEmpresaAdministrador(datos) {
    return baseDatos.transaccion(async conexion => {
        const usuario = (await conexion.query(
            'INSERT INTO usuario (correo, password) VALUES ($1, $2) RETURNING id_usuario, correo',
            [datos.correo, datos.password]
        )).rows[0];
        const empresa = (await conexion.query(
            `INSERT INTO empresa (
                tipo_organizacion, razon_social, nom_comercial, nom_dueno,
                cod_registro_mercantil, act_economica, telefono, correo,
                direccion, cod_tributo, cod_municipio, responsabilidades_fiscales, nit
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id_empresa`,
            [
                datos.empresa.tipo_organizacion,
                datos.empresa.razon_social,
                datos.empresa.nom_comercial,
                datos.empresa.nom_dueno,
                datos.empresa.cod_registro_mercantil,
                datos.empresa.act_economica,
                datos.empresa.telefono,
                datos.empresa.correo,
                datos.empresa.direccion,
                datos.empresa.cod_tributo,
                datos.empresa.cod_municipio,
                datos.empresa.responsabilidades_fiscales,
                datos.empresa.nit
            ]
        )).rows[0];
        const empleado = (await conexion.query(
            `INSERT INTO empleado (
                nombre, telefono, cedula, id_rol, id_estadoemp, id_usuario, id_empresa
            )
            SELECT $1, $2, $3, r.id_rol, ee.id_estadoemp, $4, $5
            FROM rol r
            CROSS JOIN estado_empleado ee
            WHERE LOWER(TRIM(r.rol)) = LOWER(TRIM($6))
              AND LOWER(TRIM(ee.estado)) = LOWER(TRIM($7))
            RETURNING id_empleado, id_empresa`,
            [datos.nombre, datos.telefono, datos.cedula, usuario.id_usuario, empresa.id_empresa, 'Administrador', 'activo']
        )).rows[0];
        if (!empleado) throw new Error('No existen los catálogos de rol admin o estado activo.');
        return { usuario, empresa, empleado };
    });
}

async function usuarioPorCorreo(correo) {
    return (await filas(
        'SELECT id_usuario, correo, password FROM usuario WHERE correo ILIKE $1 LIMIT 1',
        [`%${String(correo).replace(/[\\%_*]/g, '\\$&')}%`]
    ))[0] || null;
}

async function empleadoActivoPorUsuario(idUsuario) {
    return (await filas(
        `SELECT e.id_empleado, e.id_empresa, e.nombre, e.id_rol, r.rol,
                e.id_usuario, u.correo
         FROM empleado e
         JOIN usuario u ON u.id_usuario = e.id_usuario
         JOIN rol r ON r.id_rol = e.id_rol
         JOIN estado_empleado ee ON ee.id_estadoemp = e.id_estadoemp
         WHERE e.id_usuario = $1 AND LOWER(TRIM(ee.estado)) = LOWER(TRIM($2))
         LIMIT 1`,
        [idUsuario, 'activo']
    ))[0] || null;
}

async function empleadosParaRecuperacion(correo, cedula, telefono) {
    return filas(
        `SELECT e.id_empleado, e.nombre, u.correo
         FROM empleado e
         JOIN usuario u ON u.id_usuario = e.id_usuario
         JOIN estado_empleado ee ON ee.id_estadoemp = e.id_estadoemp
         WHERE u.correo ILIKE $1 AND e.cedula = $2 AND e.telefono = $3 AND ee.estado = $4
         LIMIT 1`,
        [`%${String(correo).replace(/[\\%_*]/g, '\\$&')}%`, cedula, telefono, 'activo']
    );
}

async function actualizarClaveUsuario(correo, password) {
    return filas(
        'UPDATE usuario SET password = $1 WHERE correo ILIKE $2 RETURNING id_usuario, correo',
        [password, `%${String(correo).replace(/[\\%_*]/g, '\\$&')}%`]
    );
}

async function actualizarClavePorId(idUsuario, password) {
    return filas('UPDATE usuario SET password = $1 WHERE id_usuario = $2 RETURNING id_usuario', [password, idUsuario]);
}

module.exports = {
    auth: baseDatos.auth,
    registrarEmpresaAdministrador,
    usuarioPorCorreo,
    empleadoActivoPorUsuario,
    empleadosParaRecuperacion,
    actualizarClaveUsuario,
    actualizarClavePorId
};