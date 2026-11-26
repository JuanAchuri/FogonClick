const URL_API = '';

// Cada función hace una petición HTTP (fetch) al backend. El backend recibe los datos, 
// revisa la BD y devuelve un JSON que decimos "respuesta".
const api = {
    
    /**
     * Envía email y contraseña al servidor para verificar si el usuario existe.
     * Si existe, el servidor devuelve el rol (admin, cocina, caja).
     */
    iniciarSesion: function(correo, contrasena) {
       
        return fetch(`${URL_API}/api/auth/login`, {
       
            method: 'POST',  
            headers: { 'Content-Type': 'application/json' }, // Le decimos al servidor que enviamos JSON
            body: JSON.stringify({ email: correo, password: contrasena }) // Convertimos el objeto a texto JSON
       
        })
        
        .then(respuesta => respuesta.json()); // Convertimos la respuesta del servidor de texto a objeto JavaScript
    },

    /**
     * Envía los datos de la empresa y del administrador para crear la cuenta.
     */
    registrar: function(datos) {
        
        return fetch(`${URL_API}/api/auth/register`, {
           
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
       
        })
       
        .then(respuesta => respuesta.json());
    },

    /**
     * Según el rol que devolvió el servidor, manda al usuario a su página correspondiente.
     * admin   → Panel de administrador.
     * cocina  → Pantalla de cocina.
     * caja    → Punto de ventas.
     */
    redirigir: function(rol) {
        
        const rutas = {
            admin: 'administrador.html',
            cocina: 'cocina.html',
            caja: 'cajero.html'
        };

        const rolNormalizado = String(rol || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\s_-]+/g, '');
        const rolCanonico = ['admin', 'administrador'].includes(rolNormalizado)
            ? 'admin'
            : ['caja', 'cajero'].includes(rolNormalizado)
                ? 'caja'
                : ['cocina', 'cocinero'].includes(rolNormalizado)
                    ? 'cocina'
                    : '';
        const destino = rutas[rolCanonico];
        if (!destino) return '';
        sessionStorage.setItem('rol', rolCanonico);
        window.location.replace(`/${destino}`);
        return destino;
    }
};

// Espera a que el HTML esté completamente cargado
// antes de intentar buscar botones y formularios.
document.addEventListener('DOMContentLoaded', function() {

    // PESTAÑAS (Login / Registro)
    // Busca todos los elementos con clase "tab".
    // Al hacer clic, oculta la sección anterior y muestra la nueva.
    document.querySelectorAll('.tab').forEach(pestana => {
        
        pestana.addEventListener('click', function() {
            
            // Quita la clase "active" de TODAS las pestañas y secciones
            document.querySelectorAll('.tab, .form-section').forEach(el => el.classList.remove('active'));
            
            // Activa solo la pestaña que se clickeó
            this.classList.add('active');
            
            // Muestra la sección correspondiente 
            document.getElementById(`${this.dataset.tab}-section`).classList.add('active');
        });

    });

    // Al hacer clic en estos links, simula un clic en la pestaña correspondiente.
    document.querySelectorAll('a[data-switch]').forEach(enlace => {
       
        enlace.addEventListener('click', function(evento) {
            
            evento.preventDefault(); // Evita que el navegador recargue la página
            document.querySelector(`.tab[data-tab="${this.dataset.switch}"]`).click();
        
        });

    });

    // FORMULARIO DE LOGIN
    // Cuando el usuario hace clic en "Iniciar sesión":
    // 1. Evita que el formulario recargue la página (preventDefault)
    // 2. Toma los valores de los campos
    // 3. Llama a api.iniciarSesion()
    // 4. Si el servidor dice success=true, redirige según el rol
    // 5. Si dice success=false, muestra el error
    const formularioLogin = document.getElementById('login-form');
    
    if (formularioLogin) {
    
        formularioLogin.addEventListener('submit', function(evento) {
    
            evento.preventDefault(); // Detiene el envío normal del formulario

            // Obtiene los valores que el usuario escribió
            const correo = document.getElementById('login-email').value;
            const contrasena = document.getElementById('login-password').value;

            // Envía al servidor
            api.iniciarSesion(correo, contrasena)
            .then(datos => {
                if (datos.success) {
    
                    // El servidor confirmó: usuario válido
                    ['supabase_access_token', 'id_empleado', 'id_empresa', 'nombre', 'rol', 'panel_admin_activo', 'panel_caja_activo', 'panel_cocina_activo'].forEach(clave => sessionStorage.removeItem(clave));
                    sessionStorage.setItem('id_empleado', datos.id_empleado);
                    sessionStorage.setItem('id_empresa', datos.id_empresa);
                    sessionStorage.setItem('nombre', datos.nombre);
                    sessionStorage.setItem('supabase_access_token', datos.access_token);
                    if (!api.redirigir(datos.rol)) {
                        ['supabase_access_token', 'id_empleado', 'id_empresa', 'nombre', 'rol']
                            .forEach(clave => sessionStorage.removeItem(clave));
                        mostrarNotificacion('Tu cuenta no tiene un rol de acceso válido. Pídele al administrador que lo revise.');
                    }
    
                } else {
    
                    // El servidor dijo: usuario no encontrado o contraseña incorrecta
                    mostrarNotificacion(datos.message);
    
                }
            })
    
            .catch(() => mostrarNotificacion('Error de conexión. ¿El servidor está encendido?'));
        });
    }

    // FORMULARIO DE REGISTRO
    // Cuando el usuario hace clic en "Registrarse":
    // 1. Recolecta los datos de EMPRESA y ADMIN
    // 2. Los empaqueta en un solo objeto
    // 3. Llama a api.registrar()
    // 4. Si funciona, muestra alerta y cambia a la pestaña de login
    const formularioRegistro = document.getElementById('register-form');

    const tipoOrganizacion = document.getElementById('reg-tipo-organizacion');
    const grupoRazonSocial = document.getElementById('grupo-razon-social');
    const grupoNombrePersona = document.getElementById('grupo-nombre-persona');

    function actualizarCamposTipoOrganizacion() {
        if (!tipoOrganizacion || !grupoRazonSocial || !grupoNombrePersona) return;

        const esPersonaJuridica = tipoOrganizacion.value === '1';
        grupoRazonSocial.hidden = false;
        grupoNombrePersona.hidden = esPersonaJuridica;
        document.getElementById('reg-razon-social').required = true;
        document.getElementById('reg-nombres').required = !esPersonaJuridica;
        document.getElementById('reg-apellidos').required = !esPersonaJuridica;
    }

    if (tipoOrganizacion) {
        tipoOrganizacion.addEventListener('change', actualizarCamposTipoOrganizacion);
        actualizarCamposTipoOrganizacion();
    }
   
    if (formularioRegistro) {
   
        formularioRegistro.addEventListener('submit', function(evento) {
            evento.preventDefault();

            // VALIDACIÓN DE CONTRASEÑAS
            // Compara lo que escribió en "Contraseña" con "Confirmar".
            // Si no son iguales, muestra alerta y DETIENE el envío (return).
            // El backend nunca se entera de que intentó registrar algo.
            const contrasena = document.getElementById('reg-password').value;
            const confirmar  = document.getElementById('reg-password-confirm').value;

            if (contrasena !== confirmar) {
                mostrarNotificacion('Las contraseñas no coinciden');
                return; // Detiene la función. No llega al fetch.
            }

            // Empaqueta los datos locales en español y el perfil con los nombres
            // exactos que acepta Factus en PUT /v2/companies.
            const esPersonaJuridica = tipoOrganizacion.value === '1';
            const razonSocial = document.getElementById('reg-razon-social').value.trim();
            const nombres = document.getElementById('reg-nombres').value.trim();
            const apellidos = document.getElementById('reg-apellidos').value.trim();
            const nombreComercial = document.getElementById('reg-nombre-empresa').value.trim();
            const nit = document.getElementById('reg-nit').value.trim();
            const telefonoEmpresa = document.getElementById('reg-telefono-local').value.trim();
            const telefonoAdministrador = document.getElementById('reg-telefono-admin').value.trim();
            const correoEmpresa = document.getElementById('reg-correo-empresa').value.trim();
            const direccion = document.getElementById('reg-direccion').value.trim();
            const actividadEconomica = document.getElementById('reg-actividad-economica').value.trim();
            const codigoMunicipio = document.getElementById('reg-codigo-municipio').value.trim();
            const codigoTributo = document.getElementById('reg-codigo-tributo').value;
            const responsabilidades = document.getElementById('reg-responsabilidades').value.trim();
            const codigoRegistroMercantil = document.getElementById('reg-registro-mercantil').value.trim();
            const nombreDueno = `${nombres} ${apellidos}`.trim() || document.getElementById('reg-nombre-admin').value.trim();

            if (!/^\d+$/.test(nit)) {
                mostrarNotificacion('Ingresa el NIT solo con números.');
                document.getElementById('reg-nit').focus();
                return;
            }

            if (!razonSocial || !nombreComercial || !nombreDueno || !actividadEconomica || !telefonoEmpresa || !telefonoAdministrador || !correoEmpresa || !direccion || !codigoMunicipio || !responsabilidades) {
                mostrarNotificacion('Completa todos los datos obligatorios de la empresa.');
                return;
            }

            const datos = {
                
                empresa: {
                    nit,
                    direccion,
                    telefono: telefonoEmpresa,
                    tipo_organizacion: tipoOrganizacion.value,
                    razon_social: razonSocial,
                    nom_comercial: nombreComercial,
                    nom_dueno: nombreDueno,
                    cod_registro_mercantil: codigoRegistroMercantil || null,
                    act_economica: actividadEconomica,
                    correo: correoEmpresa,
                    cod_tributo: codigoTributo || 'ZZ',
                    cod_municipio: codigoMunicipio,
                    responsabilidades_fiscales: responsabilidades,
                },

                admin: {
                    cc: document.getElementById('reg-cedula').value,
                    nombre: document.getElementById('reg-nombre-admin').value,
                    correo: document.getElementById('reg-email').value,
                    telefono: telefonoAdministrador,
                    contraseña: contrasena  // ← AGREGADO: usa la variable ya leída arriba
                }
            };

            // Envía al servidor
            api.registrar(datos)
            .then(datosRespuesta => {
               
                if (datosRespuesta.success) {
               
                    mostrarNotificacion('Registro exitoso. Ahora inicia sesión.');
                
                    // Simula un clic en la pestaña "login" para cambiar de vista
                    document.querySelector('.tab[data-tab="login"]').click();
               
                } else {
               
                    mostrarNotificacion(datosRespuesta.message);
                }
            })
            .catch(() => mostrarNotificacion('Error de conexión. ¿El servidor está encendido?'));
        });
    }

});

// Abrir el modal de recuperación al hacer clic en "¿Olvidaste tu contraseña?" y autocompletar el correo del login
function abrirModalRecuperar(e) {
    if (e) e.preventDefault();

    // 1. Reseteamos el modal al paso 1 por si quedó en el paso 2 la última vez
    const pasoDatos = document.getElementById('paso-datos-verificacion');
    const pasoPass = document.getElementById('paso-nueva-password');
    if (pasoDatos) pasoDatos.style.display = 'block';
    if (pasoPass) pasoPass.style.display = 'none';
    
    const tituloModal = document.getElementById('modal-titulo-recup');
    const subModal = document.getElementById('modal-sub-recup');
    if (tituloModal) tituloModal.textContent = 'Recuperar Contraseña';
    if (subModal) subModal.textContent = 'Ingresa tu correo, cédula y teléfono registrados para verificar tu identidad.';
    
    const formReg = document.getElementById('form-recuperar');
    if (formReg) formReg.reset();

    // 2. Buscamos el input de correo del login utilizando su ID real: 'login-email'
    const inputLoginCorreo = document.getElementById('login-email') || 
                             document.getElementById('email') || 
                             document.getElementById('correo') || 
                             document.querySelector('input[type="email"]');

    // 3. Buscamos el input del correo en el modal de recuperación
    const inputRecupCorreo = document.getElementById('recup-correo');

    // 4. Si hay un correo escrito en el login, lo pasamos automáticamente al modal
    if (inputLoginCorreo && inputRecupCorreo && inputLoginCorreo.value.trim() !== '') {
        inputRecupCorreo.value = inputLoginCorreo.value.trim();
    }

    // 5. Abrimos el modal añadiendo la clase active
    const modal = document.getElementById('modal-recuperar');
    if (modal) modal.classList.add('active');
}

// Función estándar para cerrar cualquier modal usando su ID
function cerrarModal(idModal) {
    const modal = document.getElementById(idModal);
    if (modal) {
        modal.classList.remove('active');
    }
}

// PASO 1: Lógica al enviar el formulario de recuperación para validar datos y enviar código
async function procesarRecuperacion(event) {
    if (event) event.preventDefault();
    
    const correoInput = document.getElementById('recup-correo');
    const cedulaInput = document.getElementById('recup-cedula');
    const telefonoInput = document.getElementById('recup-telefono');

    if (!correoInput || !cedulaInput || !telefonoInput) {
        mostrarNotificacion('Error: No se encuentran los campos del formulario.');
        return;
    }

    const correo = correoInput.value.trim();
    const cedula = cedulaInput.value.trim();
    const telefono = telefonoInput.value.trim();

    if (!correo || !cedula || !telefono) {
        mostrarNotificacion('Por favor completa todos los campos.');
        return;
    }

    try {
        // Petición al endpoint del controlador de autenticación (/api/auth/verify-recovery)
        const response = await fetch('/api/auth/verify-recovery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo, cedula, telefono })
        });

        const data = await response.json();

        if (data.success) {
            // Guardamos el correo validado en el campo oculto
            const tokenInput = document.getElementById('token-correo-verificado');
            if (tokenInput) tokenInput.value = correo;

            // Cambiamos la vista del modal al Paso 2 (Código y nueva contraseña)
            const pasoDatos = document.getElementById('paso-datos-verificacion');
            const pasoPass = document.getElementById('paso-nueva-password');
            if (pasoDatos) pasoDatos.style.display = 'none';
            if (pasoPass) pasoPass.style.display = 'block';
            
            const tituloModal = document.getElementById('modal-titulo-recup');
            const subModal = document.getElementById('modal-sub-recup');
            if (tituloModal) tituloModal.textContent = 'Ingresa el código';
            if (subModal) subModal.textContent = `Se ha enviado un código de 6 dígitos al correo ${correo}. Ingrésalo junto con tu nueva contraseña.`;

            // Notificación de éxito con el correo dinámico
            mostrarNotificacion(`Correcto: al correo ${correo} se enviaron indicaciones y el código de recuperación.`);
        } else {
            // Notificación de error solicitada
            mostrarNotificacion('Error: los datos son invalidos.');
        }
    } catch (error) {
        console.error('Error de red:', error);
        mostrarNotificacion('Error: no se pudo conectar con el servidor.');
    }
}

// PASO 2: Enviar el código de 6 dígitos y la nueva contraseña al servidor
async function cambiarContraseñaFinal() {
    const tokenInput = document.getElementById('token-correo-verificado');
    const correo = tokenInput ? tokenInput.value : '';
    const codigoInput = document.getElementById('recup-codigo');
    const codigo = codigoInput ? codigoInput.value.trim() : '';
    const nuevaPassword = document.getElementById('recup-new-pass').value;
    const confirmarPassword = document.getElementById('recup-confirm-pass').value;

    if (!codigo || codigo.length !== 6) {
        mostrarNotificacion('Error: ingresa un código de verificación válido de 6 dígitos.');
        return;
    }

    if (!nuevaPassword || nuevaPassword.length < 6) {
        mostrarNotificacion('Error: la contraseña debe tener al menos 6 caracteres.');
        return;
    }

    if (nuevaPassword !== confirmarPassword) {
        mostrarNotificacion('Error: las contraseñas no coinciden.');
        return;
    }

    try {
        const response = await fetch('/api/auth/update-password-with-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo, codigo, nuevaPassword })
        });

        const data = await response.json();

        if (data.success) {
            mostrarNotificacion('¡Contraseña actualizada con éxito! Ya puedes iniciar sesión con tu nueva clave.');
            cerrarModal('modal-recuperar');
            const formRecup = document.getElementById('form-recuperar');
            if (formRecup) formRecup.reset();
        } else {
            mostrarNotificacion(data.message || 'Error: el código es inválido o ha expirado.');
        }
    } catch (error) {
        console.error('Error:', error);
        mostrarNotificacion('Ocurrió un error al conectar con el servidor.');
    }
}

// Vincular automáticamente al enlace de "¿Olvidaste tu contraseña?" cuando cargue la página
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a').forEach(enlace => {
        if (enlace.textContent.includes('¿Olvidaste tu contraseña?')) {
            enlace.addEventListener('click', abrirModalRecuperar);
        }
    });
});

