const express = require('express');
const requerirAutenticacion = require('../middlewares/autenticacion');

const api = express.Router();
api.use('/auth', require('../controladores/autenticacion'));
api.use('/admin', requerirAutenticacion, require('../controladores/administrador'));
api.use('/caja', requerirAutenticacion, requerirAutenticacion.role('admin', 'caja'), require('../controladores/caja'));
api.use('/cocina', requerirAutenticacion, requerirAutenticacion.role('admin', 'cocina'), require('../controladores/cocina'));

module.exports = api;
