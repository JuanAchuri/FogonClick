const db = require('../modelos/autenticacion');
const { normalizarRol, rolDesdeEmpleado } = require('../modelos/auxiliares');

// Las vistas de Caja solicitan productos y categorías al mismo tiempo. Se
// reutiliza la identidad verificada durante unos segundos para no disparar
// dos validaciones externas simultáneas con el mismo token.
const sesionesVerificadas = new Map();
const verificacionesEnCurso = new Map();
const DURACION_CACHE_SESION = 10000;

async function contextoDeSesion(token) {
    const actual = sesionesVerificadas.get(token);
    if (actual && actual.expira > Date.now()) return actual.contexto;
    if (actual) sesionesVerificadas.delete(token);

    const verificacionExistente = verificacionesEnCurso.get(token);
    if (verificacionExistente) return verificacionExistente;

    const verificacion = (async () => {
        const authUser = await db.auth.getUser(token);
        if (!authUser?.id || !authUser.email) throw new Error('La sesión no es válida.');
        const usuario = await db.usuarioPorCorreo(authUser.email);
        const employee = usuario ? await db.empleadoActivoPorUsuario(usuario.id_usuario) : null;
        const contexto = { authUser, employee };
        sesionesVerificadas.set(token, { contexto, expira: Date.now() + DURACION_CACHE_SESION });
        return contexto;
    })();

    verificacionesEnCurso.set(token, verificacion);
    try {
        return await verificacion;
    } finally {
        verificacionesEnCurso.delete(token);
    }
}

async function requerirAutenticacion(req, res, next) {
    const token = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return res.status(401).json({ success: false, message: 'Inicia sesión para continuar.' });

    let authUser, employee;
    try {
        ({ authUser, employee } = await contextoDeSesion(token));
    } catch (error) {
        const status = error.status === 401 ? 401 : 503;
        return res.status(status).json({
            success: false,
            message: status === 401 ? 'La sesión expiró. Inicia sesión de nuevo.'
                                    : 'No se pudo verificar la sesión. Intenta de nuevo.'
        });
    }

    if (!employee) return res.status(403).json({ success: false, message: 'Esta cuenta no tiene un perfil de empleado activo.' });

    const rol = rolDesdeEmpleado(employee);
    if (!rol) return res.status(403).json({ success: false, message: 'El empleado no tiene un rol válido asignado.' });

    req.authUser = authUser;
    req.employee = { ...employee, rol: { ...employee.rol, rol } };
    return next();
}

requerirAutenticacion.role = (...permitidos) => (req, res, next) => {
    const lista = permitidos.map(normalizarRol).filter(Boolean);
    if (!lista.includes(normalizarRol(req.employee?.rol?.rol))) {
        return res.status(403).json({ success: false, message: 'No tienes permiso para realizar esta acción.' });
    }
    return next();
};

module.exports = requerirAutenticacion;
