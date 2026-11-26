require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const modeloCaja = require('./modelos/caja');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'vistas')));
app.use('/reportes', express.static(path.join(__dirname, 'Reportes')));

// Entrega la vista de acceso en la ruta raíz.
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'vistas', 'index.html')));

app.use('/api', require('./rutas/api'));

app.use((error, _req, res, _next) => {
    console.error('Error no controlado:', error);
    res.status(error.status || 500).json({ success: false, message: 'Error interno del servidor.' });
});

// SOCKET.IO - CHAT
io.on('connection', (socket) => {
    const rol = socket.handshake.auth.rol || "Usuario";
    socket.data.rol = rol;

    console.log(`🟢 ${rol} conectado al chat.`);

    socket.on('chat message', (msg) => {
        console.log(`📨 ${rol} envió:`, msg); 
        io.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log(`🔴 ${socket.data.rol} desconectado del chat.`);
    });
});

// ARRANQUE
const PORT = process.env.PORT || 3000;
async function iniciarServidor() {
    try {
        await modeloCaja.prepararEsquemaFacturas();
    } catch (error) {
        console.warn('No se pudo preparar la vista de facturas 2025:', error.message);
    }
    server.listen(PORT, () => {
        console.log('🔥 FogonClick servidor corriendo en http://localhost:' + PORT);
    });
}
iniciarServidor();
