// Sistema único de notificaciones visuales para todas las vistas del frontend.
function mostrarNotificacion(mensaje, tipo) {
    let contenedor = document.getElementById('toast-container');
    if (!contenedor) {
        contenedor = document.createElement('div');
        contenedor.id = 'toast-container';
        document.body.appendChild(contenedor);
    }

    const texto = String(mensaje);
    const tipoDetectado = tipo || (/éxito|correcto|exitoso|enviado|creado|actualizado|eliminado/i.test(texto) ? 'success' : 'error');
    const toast = document.createElement('div');
    toast.className = `toast-notification ${tipoDetectado}`;
    const iconoClase = tipoDetectado === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill';
    const icono = `<i class="bi ${iconoClase}" style="font-size: 18px;"></i>`;
    toast.innerHTML = `${icono} <span style="flex: 1;"></span>`;
    toast.querySelector('span').textContent = texto;
    contenedor.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    }, 10);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Confirmación visual reutilizable para acciones destructivas o cambios sensibles.
function confirmarNotificacion(mensaje, titulo = 'Confirmar acción') {
    return new Promise((resolver) => {
        const capa = document.createElement('div');
        capa.className = 'confirmacion-notificacion';
        capa.setAttribute('role', 'dialog');
        capa.setAttribute('aria-modal', 'true');

        const panel = document.createElement('div');
        panel.className = 'confirmacion-notificacion-panel';
        const encabezado = document.createElement('h3');
        encabezado.textContent = titulo;
        const texto = document.createElement('p');
        texto.textContent = mensaje;
        const acciones = document.createElement('div');
        acciones.className = 'confirmacion-notificacion-acciones';

        const cancelar = document.createElement('button');
        cancelar.type = 'button';
        cancelar.className = 'btn-secondary';
        cancelar.textContent = 'Cancelar';
        const aceptar = document.createElement('button');
        aceptar.type = 'button';
        aceptar.className = 'btn-primary confirmacion-notificacion-aceptar';
        aceptar.textContent = 'Confirmar';

        const cerrar = (resultado) => {
            capa.remove();
            document.removeEventListener('keydown', manejarTecla);
            resolver(resultado);
        };
        const manejarTecla = (evento) => {
            if (evento.key === 'Escape') cerrar(false);
            if (evento.key === 'Enter') cerrar(true);
        };

        cancelar.addEventListener('click', () => cerrar(false));
        aceptar.addEventListener('click', () => cerrar(true));
        capa.addEventListener('click', (evento) => {
            if (evento.target === capa) cerrar(false);
        });
        acciones.append(cancelar, aceptar);
        panel.append(encabezado, texto, acciones);
        capa.appendChild(panel);
        document.body.appendChild(capa);
        document.addEventListener('keydown', manejarTecla);
        aceptar.focus();
    });
}
