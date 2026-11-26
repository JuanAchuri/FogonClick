const express = require('express');
const router = express.Router();
const db = require('../modelos/caja');
const nodemailer = require('nodemailer');
const fs = require('fs/promises');
const path = require('path');

// ============================================
// CONFIGURACIÓN DE FACTUS PAY Y FACTURACIÓN
// ============================================

const FACTUS_PAY_BASE_URL = (
    process.env.FACTUS_PAY_BASE_URL ||
    'https://pay-api-sandbox.factus.com.co'
).replace(/\/$/, '');

const PRODUCTOS_PRUEBA = new Map([
    [990001, { nombre: 'GASEOSA · COPIA DE PRUEBA', precio: 2000 }],
    [990002, { nombre: 'PERRO CALIENTE · COPIA DE PRUEBA', precio: 10000 }]
]);

const MODO_PRUEBA = FACTUS_PAY_BASE_URL.includes(
    'pay-api-sandbox.factus.com.co'
);
const ESTADOS_PEDIDO = new Set(['pendiente', 'preparacion', 'completado', 'cancelado']);
// El pedido queda pendiente de pago como máximo diez minutos después de crear el QR.
const FACTUS_PAY_QR_TTL_MS = 10 * 60 * 1000;
const FACTUS_PAY_EXPIRATION_CHECK_MS = 60 * 1000;
const FACTUS_PAY_REFERENCE_OFFSET = 100;
const pagosQrPendientes = new Map();

// Normaliza las variantes de nombre que Factus Pay puede usar para enviar
// la imagen o el contenido base64 del QR.
function extraerQrFactus(value) {
    if (typeof value === 'string') return value.trim() || null;
    if (!value || typeof value !== 'object') return null;
    return value.data || value.base64 || value.image || value.url || value.qr || null;
}

function factusReferenceForOrder(orderId) {
    return `FOGON-${Number(orderId) + FACTUS_PAY_REFERENCE_OFFSET}`;
}

function orderIdFromFactusReference(referenceCode) {
    const match = /^FOGON-(\d+)$/.exec(String(referenceCode || ''));
    if (!match) return null;
    const orderId = Number(match[1]) - FACTUS_PAY_REFERENCE_OFFSET;
    return Number.isInteger(orderId) && orderId > 0 ? orderId : null;
}

async function orderIdFromAnyInvoiceReference(referenceCode) {
    const orderId = orderIdFromFactusReference(referenceCode);
    if (orderId && await db.pedidoPorId(orderId)) return orderId;

    const paymentMatch = /^PAGO-(\d+)$/i.exec(String(referenceCode || ''));
    if (paymentMatch) {
        const payment = await db.pagoPorId(Number(paymentMatch[1]));
        if (payment?.id_pedido) return Number(payment.id_pedido);
    }

    // Las referencias fiscales FOGON-3XX se calculan desde id_factura.
    const match = /^FOGON-(\d+)$/.exec(String(referenceCode || ''));
    const idFactura = match ? Number(match[1]) - 300 : 0;
    if (Number.isInteger(idFactura) && idFactura > 0) {
        return (await db.facturaPorId(idFactura))?.id_pedido || null;
    }
    return null;
}

let factusPayToken;
let factusPayAuthPromise = null;

const FACTUS_BILLING_BASE_URL = (
    process.env.FACTUS_BASE_URL || 'https://api-sandbox.factus.com.co'
).replace(/\/$/, '');
let factusBillingAccessToken;
let factusBillingRefreshToken;
let factusBillingTokenExpiresAt = 0;
let factusBillingAuthPromise = null;
const numerosFactusPorReferencia = new Map();

// Obtiene y conserva el token de Factus Pay, renovándolo cuando se fuerza el refresco.
async function getFactusPayToken({ forceRefresh = false } = {}) {
    // Factus Pay indica que sus tokens no vencen por tiempo. Se reutiliza
    // el token y solo se rota cuando la API responde 401.
    if (!forceRefresh && factusPayToken) return factusPayToken;

    if (factusPayAuthPromise) return factusPayAuthPromise;

    const { FACTUS_PAY_EMAIL, FACTUS_PAY_PASSWORD } = process.env;

    if (!FACTUS_PAY_EMAIL || !FACTUS_PAY_PASSWORD) {
        throw new Error(
            'Configura FACTUS_PAY_EMAIL y FACTUS_PAY_PASSWORD en .env'
        );
    }

    factusPayAuthPromise = (async () => {
        const response = await fetch(`${FACTUS_PAY_BASE_URL}/auth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({
                email: FACTUS_PAY_EMAIL,
                password: FACTUS_PAY_PASSWORD
            })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.token) {
            const error = new Error(
                response.status === 401 || response.status === 403
                    ? 'Factus Pay rechazó el email o la contraseña configurados en .env.'
                    : (result.message || `Factus Pay rechazó la autenticación (HTTP ${response.status})`)
            );
            error.status = response.status;
            throw error;
        }

        factusPayToken = result.token;
        return factusPayToken;
    })();

    try {
        return await factusPayAuthPromise;
    } finally {
        factusPayAuthPromise = null;
    }
}

// Ejecuta una solicitud a Factus Pay y reintenta una vez si el token expiró.
async function factusPayRequest(path, options = {}, retriedAfterRefresh = false) {
    const token = await getFactusPayToken();

    const response = await fetch(`${FACTUS_PAY_BASE_URL}${path}`, {
        ...options,
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
            ...options.headers
        }
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 401 && !retriedAfterRefresh) {
        factusPayToken = null;
        await getFactusPayToken({ forceRefresh: true });
        return factusPayRequest(path, options, true);
    }

    if (!response.ok) {
        const error = new Error(
            result.message ||
            `Factus Pay respondió HTTP ${response.status}`
        );

        error.status = response.status;
        throw error;
    }

    return result;
}

// ───────── Desde aquí: integración de Factus Facturación ─────────
// Reúne y valida las credenciales OAuth de Factus Facturación.
function billingCredentials() {
    const { FACTUS_CLIENT_ID, FACTUS_CLIENT_SECRET, FACTUS_USERNAME, FACTUS_PASSWORD } = process.env;
    if (!FACTUS_CLIENT_ID || !FACTUS_CLIENT_SECRET || !FACTUS_USERNAME || !FACTUS_PASSWORD) {
        throw new Error('Faltan FACTUS_CLIENT_ID, FACTUS_CLIENT_SECRET, FACTUS_USERNAME o FACTUS_PASSWORD en .env.');
    }
    return { FACTUS_CLIENT_ID, FACTUS_CLIENT_SECRET, FACTUS_USERNAME, FACTUS_PASSWORD };
}

// Solicita a Factus el token OAuth inicial o lo renueva usando el refresh token.
async function requestFactusBillingToken(grantType = 'password') {
    const credentials = billingCredentials();
    const form = new URLSearchParams({
        grant_type: grantType,
        client_id: credentials.FACTUS_CLIENT_ID,
        client_secret: credentials.FACTUS_CLIENT_SECRET
    });
    if (grantType === 'password') {
        form.set('username', credentials.FACTUS_USERNAME);
        form.set('password', credentials.FACTUS_PASSWORD);
    } else {
        form.set('refresh_token', factusBillingRefreshToken);
    }

    const response = await fetch(`${FACTUS_BILLING_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) {
        const detail = result.message || result.error_description || result.error;
        const error = new Error(detail || `Factus Facturación respondió HTTP ${response.status} al autenticar.`);
        error.status = response.status;
        throw error;
    }

    factusBillingAccessToken = result.access_token;
    factusBillingRefreshToken = result.refresh_token || factusBillingRefreshToken;
    factusBillingTokenExpiresAt = Date.now() + (Number(result.expires_in) || 3600) * 1000;
    return factusBillingAccessToken;
}

// Reutiliza el access token mientras sirve, lo renueva al vencer y vuelve a autenticar si el refresh token ya no sirve.
async function getFactusBillingToken(forceRefresh = false) {
    if (!forceRefresh && factusBillingAccessToken && Date.now() < factusBillingTokenExpiresAt - 60000) {
        return factusBillingAccessToken;
    }
    if (factusBillingAuthPromise) return factusBillingAuthPromise;

    factusBillingAuthPromise = (async () => {
        if (factusBillingRefreshToken) {
            try {
                return await requestFactusBillingToken('refresh_token');
            } catch (error) {
                if (![400, 401, 403].includes(error.status)) throw error;
                factusBillingRefreshToken = null;
            }
        }
        return requestFactusBillingToken('password');
    })();

    try {
        return await factusBillingAuthPromise;
    } finally {
        factusBillingAuthPromise = null;
    }
}

// Envía operaciones POST de facturación electrónica y renueva el token ante 401.
async function factusBillingRequest(path, body, retry = true) {
    const token = await getFactusBillingToken();
    const response = await fetch(`${FACTUS_BILLING_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401 && retry) {
        factusBillingAccessToken = null;
        factusBillingTokenExpiresAt = 0;
        await getFactusBillingToken(true);
        return factusBillingRequest(path, body, false);
    }
    if (!response.ok) {
        const errors = formatFactusValidationErrors(
            result.errors || result.data?.errors || result.validation_errors || result.data?.validation_errors
        );
        const providerMessage = result.message || result.data?.message || result.error_description || result.error;
        const message = [providerMessage, errors && !String(providerMessage || '').includes(errors) ? errors : '']
            .filter(Boolean)
            .join(': ');
        const error = new Error(message || `Factus Facturación respondió HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
    }
    return result;
}

// Elimina únicamente la factura no validada que Factus dejó pendiente para una referencia.
async function deleteUnvalidatedFactusBill(referenceCode, retry = true) {
    const token = await getFactusBillingToken();
    const path = `/v2/bills/destroy/reference/${encodeURIComponent(referenceCode)}`;
    const response = await fetch(`${FACTUS_BILLING_BASE_URL}${path}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
        }
    });
    const responseText = await response.text();
    let result = {};
    try {
        result = responseText ? JSON.parse(responseText) : {};
    } catch {
        result = { message: responseText };
    }

    if (response.status === 401 && retry) {
        factusBillingAccessToken = null;
        factusBillingTokenExpiresAt = 0;
        await getFactusBillingToken(true);
        return deleteUnvalidatedFactusBill(referenceCode, false);
    }
    if (!response.ok) {
        const error = new Error(
            result.message || result.error ||
            `Factus no pudo eliminar la factura pendiente (HTTP ${response.status}).`
        );
        error.status = response.status;
        throw error;
    }

    const deletionStatus = String(result.status || '').toLowerCase();
    if (deletionStatus && !['ok', 'success', '200'].includes(deletionStatus)) {
        const error = new Error(result.message || result.error || 'Factus no confirmó la eliminación de la factura pendiente.');
        error.status = 502;
        throw error;
    }
    console.info(`Factus confirmó la eliminación del borrador ${referenceCode}.`);
    return result;
}

// Reconoce el 409 de Factus que se resuelve borrando el documento no validado.
function isPendingFactusBillConflict(error) {
    return error?.status === 409 &&
        /factura\s+pendiente\s+por\s+enviar\s+a\s+la\s+DIAN/i.test(error.message || '');
}

// Convierte los errores anidados de validación Factus en texto legible.
function formatFactusValidationErrors(value, prefix = '') {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') {
        return `${prefix ? `${prefix}: ` : ''}${String(value)}`;
    }
    if (Array.isArray(value)) {
        return value.map(item => formatFactusValidationErrors(item, prefix)).filter(Boolean).join('; ');
    }
    if (typeof value === 'object') {
        return Object.entries(value).map(([key, detail]) => {
            const label = prefix ? `${prefix}.${key}` : key;
            return formatFactusValidationErrors(detail, label);
        }).filter(Boolean).join('; ');
    }
    return '';
}

// Consulta endpoints Factus de facturación y renueva el token ante 401.
async function factusBillingGet(path, retry = true) {
    const token = await getFactusBillingToken();
    const response = await fetch(`${FACTUS_BILLING_BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401 && retry) {
        factusBillingAccessToken = null;
        factusBillingTokenExpiresAt = 0;
        await getFactusBillingToken(true);
        return factusBillingGet(path, false);
    }
    if (!response.ok) {
        const error = new Error(result.message || result.error || `Factus respondió HTTP ${response.status} al descargar la factura.`);
        error.status = response.status;
        throw error;
    }
    return result;
}

// Guarda el PDF en el servidor y reemplaza el blob temporal en la tabla factura.
async function saveInvoicePdf(orderId, pdfBase64) {
    const cleanBase64 = String(pdfBase64 || '')
        .replace(/^data:application\/pdf;base64,/i, '')
        .replace(/\s/g, '');
    const pdfBuffer = Buffer.from(cleanBase64, 'base64');
    if (pdfBuffer.length < 4 || pdfBuffer.subarray(0, 4).toString('ascii') !== '%PDF') {
        throw new Error('Factus no devolvió un PDF válido para guardar.');
    }

    const directory = path.join(__dirname, '..', 'vistas', 'facturas');
    const filename = `FOGON-${Number(orderId)}.pdf`;
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, filename), pdfBuffer);
    const url = `/facturas/${filename}`;
    await db.actualizarUrlFactura(Number(orderId), url);
    return { url, pdfBuffer };
}

// Normaliza la respuesta de Factus al formato de factura de la aplicación.
function buildFactusInvoiceResult(response) {
    const data = response?.data || response;
    const bill = data?.bill || data?.invoice || data?.factura || data;
    const numero = bill?.number
        || bill?.bill_number
        || bill?.invoice_number
        || bill?.consecutive
        || bill?.numbering?.number
        || bill?.numbering?.consecutive
        || data?.number
        || data?.bill_number
        || data?.invoice_number
        || data?.consecutive
        || null;
    return {
        numero: numero ? String(numero) : null,
        cufe: bill?.cufe || bill?.CUFE || bill?.cufe_dian || data?.cufe || null,
        estado: bill?.status || bill?.is_validated || response?.message || 'Factura validada',
        validada: bill?.is_validated ?? data?.is_validated,
        errores: bill?.errors || data?.errors || null,
        pdf: bill?.public_url || bill?.pdf_url || bill?.url || null,
        xml: bill?.xml_url || bill?.download_url || null,
        mensaje: response?.message || 'Factura creada y validada correctamente.'
    };
}

// ============================================
// VERIFICAR LOS DATOS ANTES DE EMITIR FACTURA
// ============================================

// Factus no acepta la descripción de la responsabilidad fiscal; exige códigos
// oficiales dentro de un arreglo de textos. Se conserva un catálogo pequeño
// de códigos usados por el formulario y se descarta cualquier texto libre.
const RESPONSABILIDADES_FACTUS_VALIDAS = new Set([
    'R-99-PN', 'O-13', 'O-15', 'O-23', 'O-47', 'O-48', 'O-49', 'O-50', 'O-51', 'O-52'
]);

function normalizarResponsabilidadesFactus(valor) {
    const valores = Array.isArray(valor)
        ? valor
        : String(valor || '').split(/[;,|]/);
    const codigos = valores
        .map(item => String(item || '').trim().toUpperCase())
        .filter(item => RESPONSABILIDADES_FACTUS_VALIDAS.has(item));
    return [...new Set(codigos)];
}

// Comprueba cliente, pago, productos y total antes de pedir la factura a Factus.
async function buildFactusInvoice(orderId, customer, paymentReference, requestedProducts) {
    // El frontend puede enviar la plantilla visual de Consumidor Final sin que
    // exista un cliente real. En ese caso la fuente de verdad es cliente.id_cliente=1.
    const clienteEnviado = customer && typeof customer === 'object' ? { ...customer } : {};
    const tieneDatosCliente = Boolean(
        clienteEnviado.identification && String(clienteEnviado.identification).trim() !== '222222222222'
        || clienteEnviado.names && String(clienteEnviado.names).trim().toLowerCase() !== 'consumidor final'
        || clienteEnviado.company
        || clienteEnviado.email
        || clienteEnviado.dv
    );
    if (!tieneDatosCliente) {
        const clienteBase = await db.clientePorId(1);
        if (!clienteBase) {
            const error = new Error('No existe el cliente base con id 1. Registra ese cliente antes de emitir facturas sin datos del comprador.');
            error.status = 409;
            throw error;
        }
        customer = {
            identification_document_code: '13',
            identification: String(clienteBase.cedula || '').trim(),
            legal_organization_code: '2',
            names: String(clienteBase.nombre || '').trim(),
            ...(clienteBase.correo ? { email: String(clienteBase.correo).trim() } : {})
        };
    } else {
        customer = clienteEnviado;
    }
    customer.identification_document_code = String(customer.identification_document_code || '13');
    customer.legal_organization_code = String(customer.legal_organization_code || '2');
    customer.identification = String(customer.identification || '').trim();
    if (!customer.identification) {
        const clienteBase = await db.clientePorId(1);
        if (!clienteBase) {
            const error = new Error('No existe el cliente base con id 1 para completar la factura.');
            error.status = 409;
            throw error;
        }
        customer.identification = String(clienteBase.cedula || '').trim();
        customer.names = String(clienteBase.nombre || '').trim();
        if (clienteBase.correo && !customer.email) customer.email = String(clienteBase.correo).trim();
    }
    if (!['1', '2'].includes(customer.legal_organization_code)) {
        const error = new Error('Selecciona si la factura es para una persona natural o jurídica.');
        error.status = 400;
        throw error;
    }
    // Factus recibe el NIT sin puntos, guion ni dígito de verificación.
    let identification = customer.identification;
    let dv = String(customer.dv || '').trim();
    if (customer.identification_document_code === '31') {
        const nitConDv = /^([\d.\s]+)\s*-\s*(\d)$/.exec(identification);
        if (nitConDv) {
            identification = nitConDv[1].replace(/\D/g, '');
            if (!dv) dv = nitConDv[2];
        } else {
            identification = identification.replace(/\D/g, '');
        }
        if (!/^\d+$/.test(identification) || (dv && !/^\d$/.test(dv))) {
            const error = new Error('Para un NIT, ingresa solo los números del NIT y el dígito de verificación en su campo.');
            error.status = 400;
            throw error;
        }
    }

    const legalOrganizationCode = customer.legal_organization_code;
    if (legalOrganizationCode === '1' && customer.identification_document_code !== '31') {
        const error = new Error('Para una persona jurídica, selecciona NIT como tipo de documento.');
        error.status = 400;
        throw error;
    }
    const customerName = String(customer.names || '').trim() || 'Consumidor Final';
    const companyName = String(customer.company || '').trim() || 'Consumidor Final';
    if (legalOrganizationCode === '1') {
        customer.company = companyName;
        delete customer.names;
    } else {
        customer.names = customerName;
        delete customer.company;
    }

    // Confirma que el pedido y el pago existen y vuelve a leer los productos guardados.
    const datosPedido = await db.datosParaFactura(orderId);
    const order = datosPedido.pedido && {
        ...datosPedido.pedido,
        cliente: {
            nombre: datosPedido.pedido.cliente_nombre,
            cedula: datosPedido.pedido.cliente_cedula,
            correo: datosPedido.pedido.cliente_correo
        }
    };
    const payment = datosPedido.pago;
    const detailRows = datosPedido.detalles;
    if (!order || !payment) {
        const error = new Error('No se encontró el pedido o el pago relacionado.');
        error.status = 404;
        throw error;
    }
    if (!(await isPaidPayment(payment))) {
        const error = new Error('Factus solo emitirá la factura cuando el pago esté confirmado.');
        error.status = 409;
        throw error;
    }
    const codigoMunicipioEmpresa = String(order.empresa_cod_municipio || '').trim();
    if (!/^\d{5}$/.test(codigoMunicipioEmpresa)) {
        const error = new Error('La empresa no tiene un código de municipio válido configurado.');
        error.status = 409;
        throw error;
    }
    // La factura siempre usa el municipio fiscal de la empresa, nunca el lugar donde vive el cliente.
    customer.municipality_code = codigoMunicipioEmpresa;
    const direccionEmpresa = String(order.empresa_direccion || '').trim();
    const correoEmpresa = String(order.empresa_correo || '').trim();
    const telefonoEmpresa = String(order.empresa_telefono || '').trim();
    if (!direccionEmpresa || !correoEmpresa) {
        const error = new Error('La empresa debe tener dirección y correo configurados para emitir facturas.');
        error.status = 409;
        throw error;
    }
    // Compara lo que solicita la pantalla con las cantidades que realmente se cobraron.
    const productsToInvoice = Array.isArray(requestedProducts) && requestedProducts.length
        ? requestedProducts
        : detailRows.map(row => ({ id: Number(row.id_producto), cantidad: Number(row.cantidad) }));
    if (!productsToInvoice.length) throw new Error('El pedido no tiene productos para facturar.');
    const savedQuantities = new Map(detailRows.map(row => [Number(row.id_producto), Number(row.cantidad)]));
    const productIds = productsToInvoice.map(item => Number(item.id));
    if (new Set(productIds).size !== productIds.length) throw new Error('El pedido contiene productos repetidos de forma inválida.');
    for (const item of productsToInvoice) {
        const id = Number(item.id);
        const quantity = Number(item.cantidad);
        if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1) throw new Error('Los productos o cantidades de la factura no son válidos.');
        if (PRODUCTOS_PRUEBA.has(id)) {
            if (!MODO_PRUEBA || Number(await companyForOrder(orderId)) !== 1) throw new Error('Los productos de prueba solo pueden facturarse en sandbox.');
        } else if (savedQuantities.get(id) !== quantity) {
            throw new Error('Los productos de la factura no coinciden con el pedido guardado.');
        }
    }
    if (detailRows.some(row => !productIds.includes(Number(row.id_producto)))) throw new Error('Faltan productos del pedido en la factura.');

    const idsBaseDatos = productIds.filter(id => !PRODUCTOS_PRUEBA.has(id));
    const rows = idsBaseDatos.length ? await db.productosPorIds(idsBaseDatos) : [];
    if (rows.length !== idsBaseDatos.length) throw new Error('No fue posible leer todos los productos del pedido para la factura.');
    const byId = new Map(rows.map(row => [Number(row.id_producto), row]));

    // Las copias de prueba solo se usan en sandbox; los productos reales salen de la base de datos.
    const products = productsToInvoice.map(item => {
        const id = Number(item.id);
        const product = byId.get(id) || PRODUCTOS_PRUEBA.get(id);
        return { id, name: product.nombre, price: Number(product.precio), quantity: Number(item.cantidad) };
    });
    const subtotal = Math.round(products.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
    const tax = Math.round(subtotal * 0.19 * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    if (Math.abs(total - Number(payment.monto)) > 0.01) {
        const error = new Error('El total del pedido ya no coincide con el monto pagado; no se emitió la factura.');
        error.status = 409;
        throw error;
    }

    const responsabilidadesCliente = normalizarResponsabilidadesFactus(customer.responsibilities);
    const responsabilidadesEmpresa = normalizarResponsabilidadesFactus(order.empresa_responsabilidades_fiscales);
    const responsabilidades = responsabilidadesCliente.length
        ? responsabilidadesCliente
        : (responsabilidadesEmpresa.length ? responsabilidadesEmpresa : ['R-99-PN']);
    const metodoPago = String(payment.metodo_pago || '').trim().toLowerCase();
    const paymentMethodCode = metodoPago === 'efectivo'
        ? '10'
        : (metodoPago === 'factus_pay_qr' || metodoPago === 'transferencia' || metodoPago === 'transferencia bancaria'
            ? '47'
            : null);
    if (!paymentMethodCode) {
        const error = new Error(`El método de pago "${payment.metodo_pago || 'desconocido'}" no tiene código Factus configurado.`);
        error.status = 409;
        throw error;
    }
    const normalizedCustomer = {
        identification_document_code: String(customer.identification_document_code),
        identification,
        legal_organization_code: legalOrganizationCode,
        tribute_code: String(customer.tribute_code || order.empresa_cod_tributo || 'ZZ'),
        responsibilities: responsabilidades,
        country_code: 'CO',
        // Factus recibe aquí los datos fiscales solicitados por este proyecto.
        // Si no hay cliente, se completa con la empresa y Consumidor Final.
        address: direccionEmpresa,
        email: String(customer.email || correoEmpresa).trim() || correoEmpresa,
        phone: telefonoEmpresa,
        municipality_code: codigoMunicipioEmpresa,
        trade_name: String(order.empresa_nom_comercial || '').trim() || undefined
    };
    for (const key of ['dv', 'names', 'company', 'email']) {
        if (customer[key]) normalizedCustomer[key] = String(customer[key]);
    }
    // Dirección, teléfono, país y municipio pertenecen siempre al establecimiento
    // configurado en empresa; no se reemplazan con datos parciales del formulario.
    normalizedCustomer.address = direccionEmpresa;
    normalizedCustomer.email = String(customer.email || '').trim() || correoEmpresa;
    normalizedCustomer.phone = telefonoEmpresa;
    normalizedCustomer.country_code = 'CO';
    normalizedCustomer.municipality_code = codigoMunicipioEmpresa;
    if (dv) normalizedCustomer.dv = dv;
    if (normalizedCustomer.names) normalizedCustomer.names = normalizedCustomer.names.trim();
    if (normalizedCustomer.company) normalizedCustomer.company = normalizedCustomer.company.trim();

    const referenciaPagoFactus = paymentMethodCode === '10'
        ? `PAGO-${payment.id_pago}`
        : String(paymentReference || `PAGO-${payment.id_pago}`);
    const facturaLocal = await db.facturaPorPedido(orderId);
    if (!facturaLocal?.id_factura) throw new Error('No existe una factura local para este pedido.');
    // reference_code ya no existe en factura: Factus recibe un código determinista
    // derivado de la llave primaria, única y generada transaccionalmente por PostgreSQL.
    const referenceCode = `FOGON-${300 + Number(facturaLocal.id_factura)}`;
    const invoice = {
        reference_code: referenceCode,
        document: '01',
        operation_type: '10',
        observation: `Pedido #${orderId} - ${String(order.empresa_nom_comercial || order.empresa_razon_social || 'Empresa')} - NIT ${String(order.empresa_nit || '').trim()}`.slice(0, 500),
        send_email: false,
        establishment: {
            name: String(order.empresa_nom_comercial || order.empresa_razon_social).trim(),
            address: direccionEmpresa,
            phone_number: telefonoEmpresa,
            email: correoEmpresa,
            municipality_code: codigoMunicipioEmpresa
        },
        payment_details: [{
            payment_form: '1',
            payment_method_code: paymentMethodCode,
            reference_code: referenciaPagoFactus,
            amount: total.toFixed(2)
        }],
        cash_rounding_amount: '0.00',
        customer: normalizedCustomer,
        items: products.map(item => ({
            code_reference: String(item.id),
            name: String(item.name).slice(0, 255),
            quantity: item.quantity.toFixed(2),
            price: item.price.toFixed(2),
            unit_measure_code: '94',
            standard_code: '999',
            taxes: [{ code: '01', rate: '19.00' }]
        }))
    };
    if (process.env.FACTUS_NUMBERING_RANGE_ID) {
        const numberingRangeId = Number(process.env.FACTUS_NUMBERING_RANGE_ID);
        if (!Number.isInteger(numberingRangeId) || numberingRangeId < 1) {
            throw new Error('FACTUS_NUMBERING_RANGE_ID debe ser un entero positivo.');
        }
        invoice.numbering_range_id = numberingRangeId;
    }

    let result;
    const pausasRecuperacion = [1200, 3000];
    let ultimoConflicto;
    for (let intento = 0; intento <= pausasRecuperacion.length; intento++) {
        try {
            result = await factusBillingRequest('/v2/bills/validate', invoice);
            break;
        } catch (error) {
            if (error.status === 422) {
                // Borra el borrador rechazado para permitir reemitir la misma referencia con los datos corregidos.
                try {
                    await deleteUnvalidatedFactusBill(invoice.reference_code);
                } catch (deleteError) {
                    if (deleteError.status !== 404) {
                        error.message += ` No se pudo limpiar el borrador pendiente en Factus: ${deleteError.message}`;
                    }
                }
                throw error;
            }
            if (!isPendingFactusBillConflict(error)) throw error;
            ultimoConflicto = error;
            if (intento === pausasRecuperacion.length) break;

            // Limpia el borrador pendiente y deja que Factus actualice su estado antes de volver a emitir.
            try {
                await deleteUnvalidatedFactusBill(invoice.reference_code);
            } catch (deleteError) {
                if (deleteError.status !== 404) {
                    const recoveryError = new Error(
                        `Factus encontró una factura pendiente, pero no confirmó que pudiera eliminarla: ${deleteError.message}`
                    );
                    recoveryError.status = deleteError.status || 502;
                    throw recoveryError;
                }
                console.info(`Factus ya no tenía el borrador ${invoice.reference_code}; se validará de nuevo.`);
            }
            await new Promise(resolve => setTimeout(resolve, pausasRecuperacion[intento]));
        }
    }
    if (!result) {
        const error = new Error(
            `Factus mantuvo la factura ${invoice.reference_code} pendiente después de dos limpiezas automáticas. Puedes reintentar más tarde. ${ultimoConflicto?.message || ''}`.trim()
        );
        error.status = 409;
        throw error;
    }
    const invoiceResult = buildFactusInvoiceResult(result);
    if (invoiceResult.validada !== true && invoiceResult.validada !== 'true') {
        const validationErrors = formatFactusValidationErrors(invoiceResult.errores);
        const factusRejected = /rechazo|rechazad/i.test(`${invoiceResult.estado || ''} ${validationErrors}`);
        if ((invoiceResult.validada === false || invoiceResult.validada === 'false') && factusRejected) {
            try {
                await deleteUnvalidatedFactusBill(invoice.reference_code);
            } catch (deleteError) {
                if (deleteError.status !== 404) {
                    console.warn(`Factus no pudo limpiar la factura no validada ${invoice.reference_code}:`, deleteError.message);
                }
            }
        }
        const error = new Error(
            validationErrors
                ? `Factus recibió la factura, pero DIAN no la validó: ${validationErrors}`
                : 'Factus recibió la factura, pero todavía no confirma su validación ante la DIAN.'
        );
        error.status = factusRejected ? 422 : 409;
        throw error;
    }

    // Al corregir datos fiscales para una factura pagada, deja el pedido alineado con el comprador facturado.
    try {
        const correctedCustomer = {
            nombre: normalizedCustomer.legal_organization_code === '1' ? normalizedCustomer.company : normalizedCustomer.names,
            cedula: normalizedCustomer.identification,
            correo: normalizedCustomer.email || null
        };
        if (order.id_cliente) await db.actualizarCliente(order.id_cliente, correctedCustomer);
    } catch (error) {
        console.warn('La factura quedó validada, pero no se pudieron guardar los datos fiscales corregidos del pedido:', error.message);
    }

    if (invoiceResult.numero) {
        try {
            const pdfResult = await factusBillingGet(`/v2/bills/${encodeURIComponent(invoiceResult.numero)}/download-pdf`);
            const pdf = pdfResult?.data || pdfResult;
            invoiceResult.pdfBase64 = pdf?.pdf_base_64_encoded || pdf?.pdf_base64 || null;
            invoiceResult.pdfName = pdf?.file_name || `${invoiceResult.numero}.pdf`;
            if (invoiceResult.pdfBase64) {
                const savedPdf = await saveInvoicePdf(orderId, invoiceResult.pdfBase64);
                invoiceResult.pdfUrl = savedPdf.url;
            }
        } catch (error) {
            console.warn('La factura se emitió, pero no se pudo cargar su PDF:', error.message);
        }
    }
    if (invoiceResult.numero) {
        [paymentReference, invoice.reference_code]
            .filter(Boolean)
            .forEach(referencia => numerosFactusPorReferencia.set(String(referencia), String(invoiceResult.numero)));
    }
    return invoiceResult;
}

// ============================================
// CARRITO: VALIDAR PRODUCTOS, STOCK Y VALORES
// ============================================

// Valida los productos del carrito y calcula subtotal, IVA y total.
async function totalProducts(products, companyId) {
    if (
        !Array.isArray(products) ||
        !products.length ||
        products.some(product =>
            !product.id ||
            !Number.isInteger(Number(product.cantidad)) ||
            Number(product.cantidad) < 1
        )
    ) {
        throw new Error(
            'El pedido debe incluir productos y cantidades válidas.'
        );
    }

    const ids = [...new Set(products.map(product => Number(product.id)))];
    const idsPrueba = ids.filter(id => PRODUCTOS_PRUEBA.has(id));

    if (
        idsPrueba.length &&
        (!MODO_PRUEBA || Number(companyId) !== 1)
    ) {
        throw new Error(
            'Los productos de prueba solo funcionan en Factus Pay sandbox para la empresa de prueba.'
        );
    }

    const idsBaseDatos = ids.filter(id => !PRODUCTOS_PRUEBA.has(id));

    const rows = idsBaseDatos.length ? await db.productosPorIds(idsBaseDatos) : [];

    if (rows.length !== idsBaseDatos.length) {
        throw new Error(
            'Uno o más productos ya no están disponibles.'
        );
    }

    const productosVencidos = idsBaseDatos.length
        ? await db.productosConInsumosVencidos(idsBaseDatos)
        : [];
    if (productosVencidos.length) {
        const nombres = [...new Set(productosVencidos.map(row => `${row.nombre} (${row.insumo_nombre})`))];
        const error = new Error(`No se puede vender porque hay insumos vencidos: ${nombres.join(', ')}.`);
        error.status = 409;
        throw error;
    }

    // Un producto normal solo puede venderse si tiene receta. La excepción
    // son los productos directos, que se identifican por el insumo homónimo.
    const recetas = idsBaseDatos.length ? await db.productosConReceta(idsBaseDatos) : [];
    const idsConReceta = new Set(recetas.map(row => Number(row.id_producto)));
    const directNames = new Set(
        (await db.nombresInsumos())
            .map(row => String(row.nombre).trim().toLocaleLowerCase('es'))
    );
    const sinReceta = rows.filter(row => !idsConReceta.has(Number(row.id_producto)) && !directNames.has(String(row.nombre).trim().toLocaleLowerCase('es')));
    if (sinReceta.length) {
        throw new Error(`No se puede vender: ${sinReceta.map(row => row.nombre).join(', ')} no tiene una receta asociada.`);
    }

    const prices = new Map(
        rows.map(row => [
            Number(row.id_producto),
            Number(row.precio)
        ])
    );

    for (const id of idsPrueba) {
        prices.set(id, PRODUCTOS_PRUEBA.get(id).precio);
    }

    const subtotal = Math.round(
        products.reduce(
            (sum, product) =>
                sum +
                prices.get(Number(product.id)) *
                Number(product.cantidad),
            0
        ) * 100
    ) / 100;

    const iva = Math.round(subtotal * 0.19 * 100) / 100;

    return {
        subtotal,
        iva,
        total: Math.round((subtotal + iva) * 100) / 100
    };
}

// ============================================
// CLIENTE Y EMPLEADO: DATOS ASOCIADOS AL PEDIDO
// ============================================

// Busca el empleado de la sesión y la empresa a la que pertenece.
async function resolveOrderActor(payload) {
    let employee = payload.id_empleado ? await db.empleadoPorId(payload.id_empleado) : null;
    if (!employee) employee = await db.primerEmpleado();

    if (!employee) {
        throw new Error(
            'Crea un empleado para poder asociar los pedidos.'
        );
    }

    const company = employee.id_empresa ? { id_empresa: employee.id_empresa } : await db.primeraEmpresa();

    if (!company) {
        throw new Error(
            'Registra una empresa antes de crear pedidos.'
        );
    }

    return {
        employeeId: employee.id_empleado,
        companyId: company.id_empresa
    };
}

// ============================================
// GUARDAR EL PEDIDO Y REGISTRAR EL PAGO
// ============================================

async function paymentMethodId(methodName) {
    const raw = String(methodName || '').toLowerCase();
    const normalized = raw === 'bre-b' || raw === 'factus_pay_qr' || raw === '47'
        ? 'factus_pay_qr'
        : (raw === '10' || raw === 'efectivo' ? 'efectivo' : raw);
    const row = await db.metodoPagoPorNombre(normalized);
    if (!row) throw new Error(`No está registrado el método de pago "${normalized}".`);
    return Number(row.id_metodo);
}

// Revisa si el pago quedó con el estado de pagado.
async function isPaidPayment(payment) {
    // El DDL no tiene estado_pago: una fila en pago representa un pago confirmado.
    return Boolean(payment?.id_pago || payment?.id_pedido);
}

// Guarda un pedido, sus productos y, si aplica, la factura o el pago asociado.
async function createOrder(payload, invoice, { payment = null } = {}) {
    const [actor, statuses] = await Promise.all([
        resolveOrderActor(payload),
        db.estadoPedidoPorNombre('pendiente').then(row => row ? [row] : [])
    ]);
    const { employeeId, companyId } = actor;

    let orderId;

    try {
        const orderStatus = statuses[0];
        if (!orderStatus) throw new Error('No está registrado el estado "pendiente" en la tabla estado.');

        let customer = null;
        if (payload.cliente_cedula || payload.cliente_correo) {
            customer = await db.clientePorDatos({ cedula: payload.cliente_cedula, correo: payload.cliente_correo });
        }
        if (!customer) {
            customer = await db.clientePorDatos({ nombre: payload.cliente_nombre || 'Consumidor final' });
        }
        if (!customer) {
            customer = await db.clientePorId(1);
        }
        if (!customer) {
            const error = new Error('No se encontró el cliente indicado ni el cliente base con id 1. Registra el cliente base antes de crear el pedido.');
            error.status = 409;
            throw error;
        }
        const details = (payload.productos || [])
            .filter(product => !PRODUCTOS_PRUEBA.has(Number(product.id)))
            .map(product => ({
                id_producto: Number(product.id),
                cantidad: Number(product.cantidad)
            }));

        const pedido = await db.crearPedidoConTransaccion({
            clienteExistente: customer,
            clienteNombre: customer.nombre,
            clienteCedula: customer.cedula,
            clienteCorreo: customer.correo || null,
            idEmpleado: employeeId,
            idEstadoPedido: orderStatus.id_estadoped,
            idEmpresa: companyId,
            detalles: details,
            total: Number(payload.total) || 0,
            factura: invoice,
            pago: payment && payment.estado === 'pagado' ? { monto: Number(payment.monto), idMetodo: await paymentMethodId(payment.metodo_pago) } : null
        });
        orderId = Number(pedido.id_pedido);
    } catch (error) {
        if (orderId) {
            const childTables = [];
            if (invoice) childTables.push('factura');
            if (payment) childTables.push('pago');
            if ((payload.productos || []).some(product => !PRODUCTOS_PRUEBA.has(Number(product.id)))) {
                childTables.push('detalle_pedido');
            }

            for (const table of childTables) {
                try {
                    if (table === 'factura') await db.eliminarFacturaPorPedido(orderId);
                    if (table === 'pago') await db.eliminarPagoPorPedido(orderId);
                    if (table === 'detalle_pedido') await db.eliminarDetallesPedido(orderId);
                } catch (rollbackError) {
                    console.error(
                        `No se pudo revertir ${table} del pedido ${orderId}:`,
                        rollbackError.message
                    );
                }
            }

            try {
                await db.eliminarPedido(orderId);
            } catch (rollbackError) {
                console.error(
                    `No se pudo revertir el pedido ${orderId}:`,
                    rollbackError.message
                );
            }
        }
        throw error;
    }

    return {
        id: orderId,
        companyId
    };
}

// Busca uno de los cuatro estados permitidos y lo asigna al pedido.
async function setOrderStatus(orderId, statusName) {
    if (!ESTADOS_PEDIDO.has(statusName)) {
        throw new Error(`El estado "${statusName}" no está permitido para un pedido.`);
    }

    await db.cambiarEstadoPedido(orderId, statusName);
}

// Obtiene la empresa asociada al empleado que registró el pedido.
async function companyForOrder(orderId) {
    const order = await db.pedidoPorId(orderId);

    if (!order) throw new Error('No se encontró el pedido del pago.');

    const employee = await db.empleadoPorId(order.id_empleado);

    if (employee?.id_empresa) return employee.id_empresa;

    const company = await db.primeraEmpresa();

    if (!company) throw new Error('No se encontró la empresa del pedido.');
    return company.id_empresa;
}

// Concilia la respuesta de Factus Pay con el pago, el pedido y la factura local.
async function closePayment(orderId, providerStatus, confirmedAmount) {
    const key = Number(orderId);
    const currentClose = paymentClosuresInProgress.get(key);
    if (currentClose) return currentClose;

    const closePromise = savePaymentClosure(key, providerStatus, confirmedAmount);
    paymentClosuresInProgress.set(key, closePromise);
    try {
        return await closePromise;
    } finally {
        if (paymentClosuresInProgress.get(key) === closePromise) {
            paymentClosuresInProgress.delete(key);
        }
    }
}

const paymentClosuresInProgress = new Map();
async function savePaymentClosure(orderId, providerStatus, confirmedAmount) {
    let payment = await db.pagoPorPedido(orderId);

    if (!payment) {
        if (providerStatus !== 'paid') {
            await setOrderStatus(orderId, 'cancelado');
            pagosQrPendientes.delete(Number(orderId));
            return;
        }
        const amount = Number(confirmedAmount ?? pagosQrPendientes.get(Number(orderId))?.amount);
        if (!Number.isFinite(amount)) throw new Error('No se encontró el monto del recaudo QR.');
        const methodId = await paymentMethodId('factus_pay_qr');
        const empresaId = await companyForOrder(orderId);
        const confirmado = await db.confirmarPagoQrConTransaccion({
            monto: amount,
            idPedido: orderId,
            idMetodo: methodId,
            idEmpresa: empresaId
        });
        payment = confirmado.pago;
        pagosQrPendientes.delete(Number(orderId));
    }

    if (providerStatus === 'paid') {
        if (Number(confirmedAmount) !== Number(payment.monto)) {
            const error = new Error(
                'El valor confirmado por Factus Pay no coincide con el pedido.'
            );
            error.status = 409;
            throw error;
        }

        await setOrderStatus(orderId, 'pendiente');

        const invoice = await db.facturaPorPedido(orderId);

        if (!invoice) {
            await db.crearFactura({ total: Number(payment.monto), idPedido: orderId, idEmpresa: await companyForOrder(orderId) });
        }
    } else if (['failed', 'rejected', 'expired'].includes(providerStatus)) {
        await setOrderStatus(orderId, 'cancelado');
    }
}

// Compara la hora de creación del recaudo con el límite de diez minutos.
function factusQrYaVencio(payment, now = Date.now()) {
    const createdAt = Date.parse(payment?.fec_creacion || '');
    return Number.isFinite(createdAt) && now - createdAt >= FACTUS_PAY_QR_TTL_MS;
}

// Cancela en segundo plano los QR sin pago, incluso si el cajero cerró la página.
let factusPayExpirationSweepRunning = false;
async function cancelarQrVencidos() {
    if (factusPayExpirationSweepRunning) return;
    factusPayExpirationSweepRunning = true;

    try {
        // Los recaudos QR pendientes no se almacenan en pago porque el DDL
        // no define un estado de pago. Factus Pay los expira durante el polling.
        const pendingPayments = [];

        for (const payment of pendingPayments) {
            if (!factusQrYaVencio(payment)) continue;

            const referenceCode = factusReferenceForOrder(payment.id_pedido);
            try {
                const response = await factusPayRequest(
                    `/v1/collections/${encodeURIComponent(referenceCode)}`
                );
                const collection = response.data || {};

                // Si alcanzó a pagarse, respetamos la confirmación de Factus.
                if (collection.status === 'paid') {
                    if (Number(collection.amount) === Number(payment.monto)) {
                        await closePayment(payment.id_pedido, 'paid', Number(collection.amount));
                    } else {
                        console.error(`El monto de Factus no coincide para ${referenceCode}; se deja pendiente de revisión.`);
                    }
                    continue;
                }

                const finalStatus = ['failed', 'rejected', 'expired'].includes(collection.status)
                    ? collection.status
                    : 'expired';
                await closePayment(payment.id_pedido, finalStatus);
            } catch (error) {
                // Si Factus ya no encuentra el QR, el pedido tampoco debe quedar pendiente.
                if (error.status === 404) {
                    await closePayment(payment.id_pedido, 'expired');
                    continue;
                }
                // Si Factus no responde, el siguiente ciclo vuelve a revisar ese recaudo.
                console.error(`No se pudo vencer el QR ${referenceCode}:`, error.message);
            }
        }
    } catch (error) {
        console.error('No se pudieron revisar los QR vencidos:', error.message);
    } finally {
        factusPayExpirationSweepRunning = false;
    }
}

// ============================================
// RUTAS DE CATÁLOGO E INVENTARIO PARA CAJA
// ============================================

// Devuelve las recetas y sus detalles que caja necesita para revisar y descontar insumos.
router.get('/recetas', async (_req, res) => {
    try {
        const rows = await db.recetasParaCaja();
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
        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudieron consultar las recetas para caja.',
            error: error.message
        });
    }
});

// Devuelve los insumos y cantidades de una receta para validar existencias y descontarlas.
router.get('/recetas/:id', async (req, res) => {
    try {
        const receta = await db.recetaParaCaja(req.params.id);
        if (!receta) return res.status(404).json({ success: false, message: 'Receta no encontrada.' });

        const detalles = await db.detallesRecetaParaCaja(req.params.id);
        res.json({
            success: true,
            receta: {
                ID: receta.id_receta,
                NOMBRE: receta.nombre,
                DESCRIPCION: receta.descripcion,
                ID_PRODUCTO: receta.id_producto,
                PRODUCTO_NOMBRE: receta.producto_nombre
            },
            detalles: detalles.map(row => ({
                ID_INSUMO: row.id_insumo,
                CANTIDAD: row.cantidad,
                INSUMO_NOMBRE: row.insumo_nombre,
                INSUMO_UNIDAD: row.unidad_abreviatura || row.unidad_nombre || ''
            }))
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudo consultar el detalle de la receta.',
            error: error.message
        });
    }
});

// Devuelve el inventario que caja consulta para validar y descontar existencias.
router.get('/insumos', async (_req, res) => {
    try {
        const rows = await db.insumosParaCaja();
        res.json({
            success: true,
            insumos: rows.map(row => ({
                ID: row.id_insumo,
                NOMBRE: row.nombre,
                UNIDAD: row.abreviatura || row.unidad || '',
                STOCK: row.stock,
                FECHA_VENCIMIENTO: row.fec_vencimiento,
                ID_PROVEEDOR: row.id_proveedor,
                PROVEEDOR: row.proveedor || '',
                COSTO_COMPRA: row.costo,
                COSTO: row.costo,
                ID_UNIDAD: row.id_unidad
            }))
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudo consultar el inventario para caja.',
            error: error.message
        });
    }
});

// Consulta el stock actual del insumo que caja va a descontar.
router.get('/insumos/:id', async (req, res) => {
    try {
        const row = await db.insumoParaCaja(req.params.id);
        if (!row) return res.status(404).json({ success: false, message: 'Insumo no encontrado.' });
        res.json({
            success: true,
            insumo: {
                ID: row.id_insumo,
                NOMBRE: row.nombre,
                UNIDAD: row.abreviatura || row.unidad || '',
                STOCK: row.stock,
                FECHA_VENCIMIENTO: row.fec_vencimiento,
                ID_PROVEEDOR: row.id_proveedor,
                PROVEEDOR: row.proveedor || '',
                COSTO_COMPRA: row.costo,
                COSTO: row.costo,
                ID_UNIDAD: row.id_unidad
            }
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudo consultar el insumo.',
            error: error.message
        });
    }
});

// Caja solo puede actualizar el stock del insumo, no sus datos administrativos.
router.put('/insumos/:id', async (req, res) => {
    try {
        const body = req.body || {};
        const stock = Number(body.stock);
        if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'stock') || !Number.isFinite(stock) || stock < 0) {
            return res.status(400).json({ success: false, message: 'Envía únicamente un stock válido mayor o igual a cero.' });
        }
        const rows = await db.actualizarStock(req.params.id, stock);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Insumo no encontrado.' });
        res.json({ success: true, message: 'Stock actualizado correctamente.' });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudo actualizar el stock del insumo.',
            error: error.message
        });
    }
});

// Devuelve los productos registrados, con los campos que espera el cajero.
router.get('/productos', async (_req, res) => {
    try {
        const rows = await db.productosParaCaja();

        const productos = rows.map(product => ({
            ID: product.id_producto,
            NOMBRE: product.nombre,
            PRECIO: product.precio,
            DESCRIPCION: product.descripcion,
            CATEGORIA: product.categoria || '',
            FOTO: product.url_foto,
            URL_FOTO: product.url_foto,
            ID_CATEGORIA: product.id_categoria
        }));

        res.json({
            success: true,
            productos
        });
    } catch (error) {
        console.error('Error al consultar productos de Supabase:', error.message);

        res.status(error.status || 500).json({
            success: false,
            message: 'No se pudieron consultar los productos.',
            error: error.message
        });
    }
});

// Lee las categorías persistidas para que el panel no dependa de un estado local.
router.get('/categorias', async (_req, res) => {
    try {
        const categorias = await db.categoriasParaCaja();
        res.json({ success: true, categorias: categorias.map(categoria => ({ ID: categoria.id_categoria, NOMBRE: categoria.nombre })) });
    } catch (error) {
        res.status(error.status || 500).json({ success: false, message: 'No se pudieron consultar las categorías.', error: error.message });
    }
});

// Crea una categoría desde el flujo de caja y la devuelve ya persistida.
router.post('/categorias', async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre de la categoría es obligatorio.' });
    try {
        const categoria = await db.crearCategoria(nombre);
        res.status(201).json({ success: true, categoria: { ID: categoria.id_categoria, NOMBRE: categoria.nombre } });
    } catch (error) {
        res.status(error.status || 500).json({ success: false, message: error.message || 'No se pudo crear la categoría.' });
    }
});

// Devuelve el resumen de productos más vendidos para recomendaciones.
router.get('/mas-vendidos', async (_req, res) => {
    try {
        const [products, details] = await Promise.all([
            db.productosParaCaja(),
            db.detallesVendidos()
        ]);

        const count = new Map();

        for (const detail of details) {
            count.set(
                detail.id_producto,
                (count.get(detail.id_producto) || 0) +
                    Number(detail.cantidad)
            );
        }

        products.sort(
            (a, b) =>
                (count.get(b.id_producto) || 0) -
                (count.get(a.id_producto) || 0)
        );

        res.json({
            success: true,
            productos: products.slice(0, 4).map(product => ({
                ID: product.id_producto,
                NOMBRE: product.nombre,
                PRECIO: product.precio,
                CATEGORIA: product.categoria || '',
                DESCRIPCION: product.descripcion,
                FOTO: product.url_foto,
                veces_vendido: count.get(product.id_producto) || 0
            }))
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'Error al consultar más vendidos',
            error: error.message
        });
    }
});

// Consulta el último número de factura local disponible para mostrar en caja.
router.get('/ultima-factura', async (_req, res) => {
    try {
        const rows = await db.ultimaFactura();

        res.json({
            success: true,
            ultimo_id: rows[0]?.id_pedido || 0
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: 'Error al consultar factura',
            error: error.message
        });
    }
});

// ============================================
// RUTAS PARA CREAR PEDIDOS Y COBRAR CON FACTUS PAY
// ============================================

// Registra un pedido pagado por un medio distinto al QR de Factus Pay.
router.post('/pedidos', async (req, res) => {
    try {
        const payload = req.body || {};

        Object.assign(
            payload,
            await totalProducts(
                payload.productos,
                payload.id_empresa || 1
            )
        );

        const created = await createOrder(
            payload,
            true,
            {
                payment: {
                    estado: 'pagado',
                    monto: payload.total,
                    metodo_pago: payload.factus?.payment_details?.[0]?.payment_method_code || 'efectivo'
                }
            }
        );

        const invoice = await db.facturaPorPedido(created.id);
        const payment = await db.pagoPorPedido(created.id);
        const invoiceFactus = await buildFactusInvoice(
            created.id,
            payload.factus?.customer,
            payload.factus?.payment_details?.[0]?.reference_code,
            payload.productos
        );

        res.status(201).json({
            success: true,
            message: 'Pedido y factura creados correctamente',
            id_pedido: created.id,
            id_factura: invoice?.id_factura || null,
            payment_reference: payment ? `PAGO-${payment.id_pago}` : null,
            invoice: invoiceFactus
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: `Error al crear pedido: ${error.message}`
        });
    }
});

// Crea el pedido y solicita a Factus Pay un recaudo QR para su cobro.
router.post('/factus-pay/recaudos', async (req, res) => {
    const payload = req.body || {};
    let orderId;
    let paymentSaved = false;

    try {
        Object.assign(
            payload,
            await totalProducts(
                payload.productos,
                payload.id_empresa || 1
            )
        );

        if (payload.total < 10000 || payload.total > 12000000) {
            return res.status(400).json({
                success: false,
                message:
                    'Factus Pay admite recaudos entre $10.000 y $12.000.000 COP.'
            });
        }

        // La autenticación y el guardado del pedido no dependen entre sí.
        // Se ejecutan en paralelo para que el primer pago no espere a que
        // termine toda la escritura en Supabase antes de pedir el token.
        const tokenPromise = getFactusPayToken().then(
            () => ({ success: true }),
            error => ({ success: false, error })
        );

        const createdOrder = await createOrder(
            payload,
            false,
            {
                payment: {
                    estado: 'pendiente',
                    monto: payload.total,
                    metodo_pago: 'factus_pay_qr'
                }
            }
        );

        orderId = createdOrder.id;
        paymentSaved = true;
        pagosQrPendientes.set(Number(orderId), { amount: Number(payload.total), createdAt: new Date().toISOString() });

        const referenceCode = factusReferenceForOrder(orderId);

        const tokenResult = await tokenPromise;
        if (!tokenResult.success) throw tokenResult.error;

        const created = await factusPayRequest(
            '/v1/collections',
            {
                method: 'POST',
                body: JSON.stringify({
                    reference_code: referenceCode,
                    amount: payload.total
                })
            }
        );

        let collection = created.data || {};

        if (!collection.qr) {
            try {
                const details = await factusPayRequest(
                    `/v1/collections/${encodeURIComponent(referenceCode)}`
                );

                collection = details.data || collection;
            } catch (error) {
                console.warn(
                    'No se pudo consultar el QR todavía:',
                    error.message
                );
            }
        }

        const qr = extraerQrFactus(collection.qr || collection.qr_code || collection.qrCode || collection.payment_qr);
        const status = collection.status || 'started';

        if (status === 'paid') {
            await closePayment(
                orderId,
                'paid',
                Number(collection.amount ?? payload.total)
            );
        } else if (['failed', 'rejected'].includes(status)) {
            await closePayment(orderId, status);
        }

        res.status(201).json({
            success: true,
            id_pedido: orderId,
            reference_code: referenceCode,
            amount: collection.amount ?? payload.total,
            status,
            qr,
            message: created.message || 'Recaudo creado correctamente'
        });
    } catch (error) {
        if (orderId && paymentSaved && error.status && error.status < 500) {
            await closePayment(orderId, 'failed').catch(() => {});
        } else if (orderId && !paymentSaved) {
            await db.eliminarDetallesPedido(orderId).catch(() => {});
            await db.eliminarPedido(orderId).catch(() => {});
        }

        res.status(error.status || 500).json({
            success: false,
            message:
                error.message ||
                'No se pudo crear el recaudo Factus Pay.'
        });
    }
});

// Consulta el recaudo, actualiza su estado y devuelve el QR mientras está pendiente.
router.get('/factus-pay/recaudos/:referenceCode', async (req, res) => {
    try {
        const referenceCode = req.params.referenceCode;
        const orderId = await orderIdFromAnyInvoiceReference(referenceCode);

        if (!orderId) {
            return res.status(400).json({
                success: false,
                message: 'La referencia del recaudo no es válida.'
            });
        }

        const pagoRegistrado = await db.pagoPorPedido(orderId);
        const rows = pagoRegistrado ? [pagoRegistrado] : [];

        const pending = pagosQrPendientes.get(Number(orderId));
        if (!rows.length && !pending) {
            return res.status(404).json({
                success: false,
                message: 'No se encontró el recaudo.'
            });
        }

        const payment = rows[0] || { id_pedido: orderId, monto: pending.amount, fec_creacion: pending.createdAt };

        const response = await factusPayRequest(
            `/v1/collections/${encodeURIComponent(referenceCode)}`
        );

        const collection = response.data || {};
        const allowedStatuses = [
            'started',
            'ready',
            'paid',
            'failed',
            'rejected',
            'expired'
        ];

        let status = allowedStatuses.includes(collection.status)
            ? collection.status
            : (rows.length ? 'paid' : 'started');

        // El estado local terminal prevalece si Factus devuelve una respuesta atrasada.
        if (rows.length) status = 'paid';
        else if (pending && factusQrYaVencio(payment) && ['started', 'ready'].includes(status)) {
            status = 'expired';
        }

        if (
            status === 'paid' &&
            Number(collection.amount) !== Number(payment.monto)
        ) {
            return res.status(409).json({
                success: false,
                message:
                    'El valor confirmado por Factus Pay no coincide con el pedido.'
            });
        }

        if (status === 'paid') {
            await closePayment(
                orderId,
                'paid',
                Number(collection.amount)
            );
        } else if (['failed', 'rejected', 'expired'].includes(status)) {
            await closePayment(orderId, status);
        }

        const qr = extraerQrFactus(collection.qr || collection.qr_code || collection.qrCode || collection.payment_qr);
        res.json({
            success: true,
            id_pedido: orderId,
            reference_code: referenceCode,
            amount: collection.amount ?? Number(payment.monto),
            status,
            qr: status === 'expired' ? null : qr,
            message: status === 'expired'
                ? 'El QR venció después de diez minutos y el pedido se canceló.'
                : undefined
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message:
                error.message ||
                'No se pudo consultar el recaudo.'
        });
    }
});

// ============================================
// RUTAS PARA REVISAR, EMITIR Y RECUPERAR FACTURAS
// ============================================

// Recupera los datos fiscales guardados para volver a emitir una factura pendiente.
router.get('/factus-pay/recaudos/:referenceCode/factura-info', async (req, res) => {
    try {
        const referenceCode = req.params.referenceCode;
        const orderId = await orderIdFromAnyInvoiceReference(referenceCode);
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'La referencia del recaudo no es válida.' });
        }
        const datosPedido = await db.datosParaFactura(orderId);
        const order = datosPedido.pedido && {
            ...datosPedido.pedido,
            cliente: {
                nombre: datosPedido.pedido.cliente_nombre,
                cedula: datosPedido.pedido.cliente_cedula,
                correo: datosPedido.pedido.cliente_correo
            }
        };
        const payment = datosPedido.pago;
        if (!order || !payment) {
            return res.status(404).json({ success: false, message: 'No se encontró el pedido o el recaudo.' });
        }
        if (!(await isPaidPayment(payment))) {
            return res.status(409).json({ success: false, message: 'Solo puedes recuperar la factura de un pago confirmado.' });
        }

        res.json({
            success: true,
            payment: {
                id_pedido: orderId,
                reference_code: referenceCode,
                amount: Number(payment.monto)
            },
            customer: {
                identification: order.cliente?.cedula || '',
                names: order.cliente?.nombre || '',
                email: order.cliente?.correo || '',
                municipality_code: order.empresa_cod_municipio
            }
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.message || 'No se pudo recuperar el pedido pagado.'
        });
    }
});

// Emite o reintenta la factura electrónica asociada al recaudo pagado.
router.post('/factus-pay/recaudos/:referenceCode/factura', async (req, res) => {
    try {
        const referenceCode = req.params.referenceCode;
        const orderId = await orderIdFromAnyInvoiceReference(referenceCode);
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'La referencia del recaudo no es válida.' });
        }

        const invoice = await buildFactusInvoice(
            orderId,
            req.body?.customer,
            referenceCode,
            req.body?.productos
        );
        res.json({ success: true, invoice });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.message || 'No se pudo crear la factura electrónica en Factus.'
        });
    }
});


// Envía por Gmail la factura PDF de un recaudo pagado y verificado.
router.post('/factus-pay/recaudos/:referenceCode/factura/enviar-correo', async (req, res) => {
    try {
        const referenceCode = req.params.referenceCode;
        const orderId = await orderIdFromAnyInvoiceReference(referenceCode);
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'La referencia del recaudo no es válida.' });
        }
        const number = String(req.body?.number || numerosFactusPorReferencia.get(referenceCode) || '').trim();
        const email = String(req.body?.email || '').trim();
        if (!/^[A-Za-z0-9-]+$/.test(number)) {
            return res.status(400).json({ success: false, message: 'El número de la factura no es válido.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, message: 'Ingresa una dirección de correo válida.' });
        }
        const gmailEmail = process.env.GMAIL_EMAIL;
        const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');
        if (!gmailEmail || !gmailAppPassword) {
            return res.status(503).json({
                success: false,
                message: 'El envío está pendiente de configuración: agrega GMAIL_EMAIL y GMAIL_APP_PASSWORD al archivo .env y reinicia el servidor.'
            });
        }
        if (gmailAppPassword.length !== 16) {
            return res.status(503).json({
                success: false,
                message: 'La contraseña de aplicación de Gmail debe tener 16 caracteres. Cópiala completa en GMAIL_APP_PASSWORD y reinicia el servidor.'
            });
        }

        const payment = await db.pagoPorPedido(orderId);
        const payments = payment ? [payment] : [];
        if (!payments[0]) return res.status(404).json({ success: false, message: 'No se encontró el recaudo asociado.' });
        if (!(await isPaidPayment(payments[0]))) {
            return res.status(409).json({ success: false, message: 'Solo puedes enviar por correo una factura de un pago confirmado.' });
        }
        const order = await db.pedidoConCliente(orderId);
        const customerName = String(order?.cliente_nombre || 'cliente').trim() || 'cliente';
        const safeCustomerName = customerName
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const response = await factusBillingGet(`/v2/bills/${encodeURIComponent(number)}`);
        const data = response?.data || response;
        const bill = data?.bill || data?.invoice || data;
        const billReference = bill?.reference_code || bill?.referenceCode || data?.reference_code || data?.referenceCode;
        const facturaLocal = await db.facturaPorPedido(orderId);
        const referenciaFiscal = facturaLocal?.id_factura
            ? `FOGON-${300 + Number(facturaLocal.id_factura)}`
            : null;
        const referenciasValidas = new Set([referenceCode, referenciaFiscal].filter(Boolean).map(String));
        if (!referenciasValidas.has(String(billReference || ''))) {
            return res.status(409).json({ success: false, message: 'La factura no corresponde a este pedido.' });
        }

        const pdfResponse = await factusBillingGet(`/v2/bills/${encodeURIComponent(number)}/download-pdf`);
        const pdf = pdfResponse?.data || pdfResponse;
        const pdfBase64 = String(pdf?.pdf_base_64_encoded || pdf?.pdf_base64 || '')
            .replace(/^data:application\/pdf;base64,/i, '')
            .replace(/\s/g, '');
        if (!pdfBase64) {
            const error = new Error('Factus no devolvió el PDF de la factura para adjuntarlo al correo.');
            error.status = 502;
            throw error;
        }
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        if (pdfBuffer.length < 4 || pdfBuffer.subarray(0, 4).toString('ascii') !== '%PDF') {
            const error = new Error('Factus devolvió un PDF inválido; no se envió el correo.');
            error.status = 502;
            throw error;
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmailEmail, pass: gmailAppPassword }
        });
        let sent;
        try {
            sent = await transporter.sendMail({
                from: { name: 'FogónClick', address: gmailEmail },
                to: email,
                subject: `Tu factura electrónica ${number} - FogónClick`,
                text: `Hola ${customerName},\n\nAdjuntamos tu factura electrónica ${number} de FogónClick.\n\nGracias por tu compra.`,
                html: `<div style="font-family:Arial,sans-serif;color:#242936;line-height:1.6"><h2 style="color:#e94560">Hola ${safeCustomerName}</h2><p>Adjuntamos tu factura electrónica <strong>${number}</strong> de FogónClick.</p><p>Gracias por tu compra.</p><p>Conserva este correo y el PDF adjunto para tus registros.</p></div>`,
                attachments: [{
                    filename: `Factura-${number}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }]
            });
        } finally {
            transporter.close();
        }

        res.json({
            success: true,
            message: `Factura enviada a ${email}.`,
            emailId: sent.messageId
        });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            message: error.code === 'EAUTH'
                ? 'Gmail rechazó la autenticación. Usa una contraseña de aplicación de Google y verifica el correo configurado.'
                : (error.message || 'No se pudo enviar la factura por correo.')
        });
    }
});

// Revisa periódicamente los recaudos que vencen aunque el cajero cierre la página.
const factusPayExpirationTimer = setInterval(
    cancelarQrVencidos,
    FACTUS_PAY_EXPIRATION_CHECK_MS
);
factusPayExpirationTimer.unref?.();

module.exports = router;
