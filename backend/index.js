require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const app = require('./src/app');
const { initializeDatabase } = require('./src/config/database');
const { startScheduleActivationJob } = require('./src/jobs/schedule-activation');

const PORT = process.env.PORT || 5000;

// Créer le serveur HTTP
const server = http.createServer(app);

// Socket.io pour les notifications temps réel.
//
// `CORS_ORIGIN` peut contenir plusieurs origines séparées par des virgules —
// c'est ce que `src/app.js` accepte et documente. Cette chaîne était passée
// telle quelle à socket.io, qui la renvoyait en un seul en-tête
// `Access-Control-Allow-Origin: http://a,http://b` : un en-tête que tous les
// navigateurs refusent. Le temps réel tombait alors pour *toutes* les origines,
// y compris la première, dès qu'une seconde était déclarée. Même découpage
// qu'ailleurs, donc même comportement.
const SOCKET_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: SOCKET_ORIGINS.length === 1 ? SOCKET_ORIGINS[0] : SOCKET_ORIGINS,
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

// Démarrage avec tentative de ports alternatifs en cas d'EADDRINUSE
const start = async () => {
  try {
    await initializeDatabase();

    // Mise en marche automatique des plannings dont la date de début est
    // atteinte : une passe immédiate, puis toutes les 30 minutes.
    startScheduleActivationJob(app);

    const maxAttempts = 5;
    let attempt = 0;
    let listeningPort = Number(PORT);

    const tryListen = () => new Promise((resolve, reject) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE') {
          server.removeListener('error', onError);
          attempt += 1;
          if (attempt >= maxAttempts) {
            return reject(new Error(`Port ${listeningPort} en cours d'utilisation et tentative maximale atteinte`));
          }
          console.warn(`⚠️  Port ${listeningPort} occupé, tentative d'écoute sur le port ${listeningPort + 1}...`);
          listeningPort += 1;
          // Réessayer avec le port suivant
          return tryListen().then(resolve).catch(reject);
        }
        // Erreur autre que EADDRINUSE
        return reject(err);
      };

      server.once('error', onError);
      server.once('listening', () => {
        // Retirer le listener d'erreur une fois qu'on écoute
        server.removeListener('error', onError);
        resolve();
      });

      server.listen(listeningPort);
    });

    await tryListen();
    console.log(`\n🚀 GardeSante API démarrée sur le port ${listeningPort}`);
    console.log(`📡 Socket.io actif`);
    console.log(`🔗 http://localhost:${listeningPort}`);
    console.log(`❤️  Health: http://localhost:${listeningPort}/health\n`);

  } catch (err) {
    console.error('❌ Impossible de démarrer:', err.message || err);
    process.exit(1);
  }
};

start();
