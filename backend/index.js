require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const app = require('./src/app');
const { initializeDatabase } = require('./src/config/database');

const PORT = process.env.PORT || 5000;

// Créer le serveur HTTP
const server = http.createServer(app);

// Socket.io pour les notifications temps réel
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Map userId -> socketId pour les notifications ciblées
const userSockets = new Map();

io.on('connection', (socket) => {
  console.log(`🔌 Socket connecté: ${socket.id}`);

  socket.on('authenticate', (userId) => {
    userSockets.set(userId, socket.id);
    socket.join(`user:${userId}`);
    console.log(`👤 User ${userId} authentifié sur socket ${socket.id}`);
  });

  socket.on('join-establishment', (establishmentId) => {
    socket.join(`establishment:${establishmentId}`);
  });

  socket.on('join-department', (departmentId) => {
    socket.join(`department:${departmentId}`);
  });

  socket.on('disconnect', () => {
    for (const [userId, sid] of userSockets.entries()) {
      if (sid === socket.id) userSockets.delete(userId);
    }
    console.log(`🔌 Socket déconnecté: ${socket.id}`);
  });
});

// Exposer io pour l'utiliser dans les controllers
app.set('io', io);
app.set('userSockets', userSockets);

// Démarrage
const start = async () => {
  try {
    await initializeDatabase();
    server.listen(PORT, () => {
      console.log(`\n🚀 GardeSante API démarrée sur le port ${PORT}`);
      console.log(`📡 Socket.io actif`);
      console.log(`🔗 http://localhost:${PORT}`);
      console.log(`❤️  Health: http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error('❌ Impossible de démarrer:', err.message);
    process.exit(1);
  }
};

start();
