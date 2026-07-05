const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { errorHandler, notFound } = require('./middleware/errorHandler');

// Routes
const authRoutes = require('./modules/auth/auth.routes');
const userRoutes = require('./modules/users/users.routes');
const departmentRoutes = require('./modules/departments/departments.routes');
const scheduleRoutes = require('./modules/schedules/schedules.routes');
const shiftRoutes = require('./modules/shifts/shifts.routes');
const absenceRoutes = require('./modules/absences/absences.routes');
const replacementRoutes = require('./modules/replacements/replacements.routes');
const statisticsRoutes = require('./modules/statistics/statistics.routes');
const notificationRoutes = require('./modules/notifications/notifications.routes');

const app = express();

// ============================================================
// SÉCURITÉ
// ============================================================
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting global
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: { success: false, message: 'Trop de requêtes, réessayez plus tard' },
});

// Rate limiting strict pour l'auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Trop de tentatives de connexion' },
});

app.use('/api', limiter);
app.use('/api/auth/login', authLimiter);

// ============================================================
// MIDDLEWARES GÉNÉRAUX
// ============================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ============================================================
// ROUTES API
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/absences', absenceRoutes);
app.use('/api/replacements', replacementRoutes);
app.use('/api/statistics', statisticsRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'GardeSante API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// GESTION DES ERREURS
// ============================================================
app.use(notFound);
app.use(errorHandler);

module.exports = app;
