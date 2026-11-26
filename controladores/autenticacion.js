const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const router = express.Router();
const db = require('../modelos/autenticacion');
const {
    rolDesdeEmpleado, existe, hashPassword, verificarPassword, esHash, httpStatus
} = require('../modelos/auxiliares');

const codigosRecuperacion = new Map(); // correo -> { codigo, expira }

// Abre sesión en Supabase Auth; si la cuenta no existe o está desincronizada, la crea/alinea.
// Solo se llama DESPUÉS de verificar la contraseña contra la tabla usuario.
async function abrirSesion(email, password, nombre) {
    try {
        return await db.auth.passwordLogin(email, password);
    } catch (e) {
        if (![400, 401].includes(e.status)) throw e;
        let cuenta = await db.auth.findUserByEmail(email);
        if (cuenta) await db.auth.updateUser(cuenta.id, { password, email_confirm: true });
        else cuenta = await db.auth.createUser(email, password, { nombre });
        if (!cuenta?.id) throw new Error('No se pudo enlazar la cuenta de acceso del empleado.');
        return db.auth.passwordLogin(email, password);
    }
}

// ---------------- REGISTRO: usuario -> empresa -> empleado ----------------
router.post('/register', async (req, res) => {
    const { empresa = {}, admin = {} } = req.body || {};
    const cedula = String(admin.cedula || admin.cc || '').trim();
    const correo = String(admin.correo || '').trim();
    const telefonoEmpresa = String(empresa.telefono || '').trim();
    const telefonoAdministrador = String(admin.telefono || '').trim();

    if (!correo || !admin.contraseña || !admin.nombre || !cedula || !telefonoEmpresa || !telefonoAdministrador ||
        !empresa.nit || !(empresa.codigo_municipio || empresa.cod_municipio) || !empresa.tipo_organizacion ||
        !(empresa.nombre_comercial || empresa.nombre_empresa || empresa.nom_comercial) ||
        !(empresa.razon_social || empresa.nom_dueno || admin.nombre) || !empresa.direccion ||
        !(empresa.act_economica || empresa.actividad_economica) || !empresa.responsabilidades_fiscales) {
        return res.status(400).json({ success: false, message: 'Completa los datos obligatorios de la empresa y del administrador, incluyendo sus teléfonos separados.' });
    }

    try {
        if (await existe('usuario', 'correo', correo, { ilike: true }))
            return res.status(409).json({ success: false, message: 'Ese correo ya está registrado.' });
        if (await existe('empleado', 'cedula', cedula))
            return res.status(409).json({ success: false, message: 'Esa cédula ya está registrada.' });
        if (await existe('empresa', 'nit', empresa.nit))
            return res.status(409).json({ success: false, message: 'Ese NIT ya está registrado.' });

        const registro = await db.registrarEmpresaAdministrador({
            correo,
            password: await hashPassword(admin.contraseña),
            nombre: admin.nombre,
            telefono: telefonoAdministrador,
            cedula,
            empresa: {
                nit: empresa.nit,
                tipo_organizacion: empresa.tipo_organizacion,
                razon_social: empresa.razon_social || empresa.nom_dueno || admin.nombre,
                nom_comercial: empresa.nom_comercial || empresa.nombre_comercial || empresa.nombre_empresa,
                nom_dueno: empresa.nom_dueno || admin.nombre,
                cod_registro_mercantil: empresa.cod_registro_mercantil || empresa.codigo_registro_mercantil || null,
                act_economica: empresa.act_economica || empresa.actividad_economica,
                telefono: telefonoEmpresa,
                correo: empresa.correo || empresa.correo_electronico || correo,
                direccion: empresa.direccion,
                cod_tributo: empresa.cod_tributo || empresa.codigo_tributo || 'ZZ',
                cod_municipio: empresa.cod_municipio || empresa.codigo_municipio,
                responsabilidades_fiscales: empresa.responsabilidades_fiscales
            }
        });

        return res.status(201).json({
            success: true,
            message: 'Empresa y administrador creados correctamente',
            id_empresa: registro.empresa.id_empresa,
            id_empleado: registro.empleado.id_empleado
        });
    } catch (error) {
        return res.status(httpStatus(error)).json({ success: false, message: error.message || 'No se pudo crear la cuenta.' });
    }
});

// LOGIN
router.post('/login', async (req, res) => {
    const email = String(req.body?.email || '').trim();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) return res.status(400).json({ success: false, message: 'Ingresa correo y contraseña.' });

    const incorrecto = () => res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos.' });

    try {
        const usuario = await db.usuarioPorCorreo(email);
        if (!usuario || !(await verificarPassword(password, usuario.password))) return incorrecto();

        const employee = await db.empleadoActivoPorUsuario(usuario.id_usuario);
        if (!employee) return res.status(403).json({ success: false, message: 'La cuenta no tiene un perfil de empleado activo.' });

        // El id_rol del catálogo (1 Administrador, 2 Cocina, 3 Caja) es la fuente estable.
        const rol = rolDesdeEmpleado(employee);
        if (!rol) return res.status(403).json({ success: false, message: 'El empleado no tiene un rol de acceso válido.' });

        // Migración transparente: si seguía en texto plano, se guarda el hash.
        if (!esHash(usuario.password)) {
            await db.actualizarClavePorId(usuario.id_usuario, await hashPassword(password)).catch(() => {});
        }

        const session = await abrirSesion(usuario.correo, password, employee.nombre);
        res.json({
            success: true,
            id_empleado: employee.id_empleado,
            id_empresa: employee.id_empresa,
            rol,
            nombre: employee.nombre,
            access_token: session.access_token
        });
    } catch (error) {
        res.status(httpStatus(error)).json({ success: false, message: error.message });
    }
});

// RECUPERACIÓN:
router.post('/verify-recovery', async (req, res) => {
    const { correo, cedula, telefono } = req.body || {};
    const invalido = { success: false, message: 'Error: los datos son invalidos.' };
    if (!correo || !cedula || !telefono) return res.status(400).json(invalido);

    try {
        const empleados = await db.empleadosParaRecuperacion(String(correo).trim(), String(cedula).trim(), String(telefono).trim());
        if (!empleados.length) return res.status(404).json(invalido);

        const codigo = String(crypto.randomInt(100000, 1000000)); // CSPRNG en vez de Math.random
        codigosRecuperacion.set(String(correo).trim().toLowerCase(), { codigo, expira: Date.now() + 15 * 60 * 1000 });

        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com', port: 465, secure: true,
            auth: { user: process.env.GMAIL_EMAIL, pass: process.env.GMAIL_APP_PASSWORD }
        });
        await transporter.sendMail({
            from: `"FogonClick Soporte" <${process.env.GMAIL_EMAIL}>`,
            to: empleados[0].usuario?.correo || correo,
            subject: 'Código de Recuperación - FogonClick',
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; padding: 20px; background: #f9f9f9; border-radius: 10px;">
                    <h2 style="color: #e94560;">Código de Verificación</h2>
                    <p>Hola, <strong>${empleados[0].nombre}</strong>:</p>
                    <p>Has solicitado restablecer tu contraseña en FogonClick. Tu código de verificación es:</p>
                    <div style="background: #e94560; color: #fff; font-size: 24px; font-weight: bold; text-align: center; padding: 10px; border-radius: 5px; letter-spacing: 5px; margin: 20px 0;">${codigo}</div>
                    <p>Este código expirará en 15 minutos. Si no solicitaste este cambio, ignora este mensaje.</p>
                </div>`
        });

        return res.json({ success: true, message: `Correcto: al correo ${correo} se enviaron indicaciones de recuperacion.` });
    } catch (error) {
        console.error('Error al enviar código:', error);
        return res.status(500).json(invalido);
    }
});

router.post('/update-password-with-code', async (req, res) => {
    const { correo, codigo, nuevaPassword } = req.body || {};
    const correoKey = String(correo || '').trim().toLowerCase();

    if (!correoKey || !codigo || !nuevaPassword || nuevaPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Error: datos incompletos o contraseña muy corta.' });
    }
    const registro = codigosRecuperacion.get(correoKey);
    if (!registro || registro.codigo !== String(codigo).trim() || Date.now() > registro.expira) {
        return res.status(400).json({ success: false, message: 'Error: el código es inválido o ha expirado.' });
    }

    try {
        // La credencial ahora vive en usuario (hash), no en empleado.
        const filas = await db.actualizarClaveUsuario(correoKey, await hashPassword(nuevaPassword));
        if (!filas.length) return res.status(404).json({ success: false, message: 'No existe una cuenta con ese correo.' });

        const cuenta = await db.auth.findUserByEmail(correoKey);
        if (cuenta?.id) await db.auth.updateUser(cuenta.id, { password: nuevaPassword });

        codigosRecuperacion.delete(correoKey);
        return res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
    } catch (error) {
        console.error('Error al actualizar contraseña:', error);
        return res.status(500).json({ success: false, message: 'Error al actualizar la contraseña.' });
    }
});

module.exports = router;
