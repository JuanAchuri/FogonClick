require('dotenv').config();
const { Pool } = require('pg');

const cadenaConexion = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL;
const piscina = cadenaConexion ? new Pool({
    connectionString: cadenaConexion,
    ssl: /supabase\.co/i.test(cadenaConexion) ? { rejectUnauthorized: false } : undefined
}) : null;
const urlSupabase = (process.env.SUPABASE_URL || '').replace(/\/$/, '').replace(/\/rest\/v1$/i, '');
const clavePublica = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const claveSecreta = process.env.SUPABASE_SECRET_KEY;

class ErrorBaseDatos extends Error {
    constructor(message, status = 500, code) {
        super(message);
        this.name = 'ErrorBaseDatos';
        this.status = status;
        this.code = code;
    }
}

function asegurarConexion() {
    if (!piscina) throw new ErrorBaseDatos('Configura DATABASE_URL con la cadena PostgreSQL de Supabase.', 503, 'DATABASE_URL_REQUIRED');
}

async function ejecutar(sql, parametros = []) {
    asegurarConexion();
    try {
        return await piscina.query(sql, parametros);
    } catch (error) {
        const estado = error.code === '23505' ? 409 : (error.status || 500);
        throw new ErrorBaseDatos(error.message, estado, error.code);
    }
}

async function transaccion(trabajo) {
    asegurarConexion();
    const conexion = await piscina.connect();
    try {
        await conexion.query('BEGIN');
        const resultado = await trabajo(conexion);
        await conexion.query('COMMIT');
        return resultado;
    } catch (error) {
        try {
            await conexion.query('ROLLBACK');
        } catch (_) {
            // Evita ocultar el error original si el ROLLBACK falla
        }
        const estado = error.code === '23505' ? 409 : (error.status || 500);
        throw new ErrorBaseDatos(error.message, estado, error.code);
    } finally {
        conexion.release();
    }
}

const auth = {
    async solicitar(ruta, opciones = {}, clave = claveSecreta, token) {
        if (!urlSupabase || !clave) throw new ErrorBaseDatos('Configura SUPABASE_URL y sus claves para Supabase Auth.', 503);
        const respuesta = await fetch(`${urlSupabase}${ruta}`, {
            ...opciones,
            headers: {
                apikey: clave,
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                'Content-Type': 'application/json',
                ...(opciones.headers || {})
            }
        });
        const datos = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok) throw new ErrorBaseDatos(datos.msg || datos.message || 'Supabase Auth rechazó la solicitud.', respuesta.status, datos.code);
        return datos;
    },
    passwordLogin(email, password) {
        return this.solicitar('/auth/v1/token?grant_type=password', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        }, clavePublica);
    },
    getUser(token) { return this.solicitar('/auth/v1/user', {}, clavePublica, token); },
    createUser(email, password, userMetadata = {}) {
        return this.solicitar('/auth/v1/admin/users', {
            method: 'POST',
            body: JSON.stringify({ email, password, email_confirm: true, user_metadata: userMetadata })
        });
    },
    async findUserByEmail(email) {
        const datos = await this.solicitar('/auth/v1/admin/users?page=1&per_page=1000');
        return (datos.users || []).find(usuario => usuario.email?.toLowerCase() === email.toLowerCase()) || null;
    },
    updateUser(id, valores) {
        return this.solicitar(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(valores) });
    },
    deleteUser(id) {
        return this.solicitar(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
};

module.exports = { ejecutar, transaccion, auth, ErrorBaseDatos };
