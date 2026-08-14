const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');
const rateLimit = require('express-rate-limit');

const { errorHandler, notFound } = require('./middleware/errorHandler');
const { trackActivity }           = require('./middleware/activity');

// Routes
const authRoutes             = require('./modules/auth/auth.routes');
const userRoutes             = require('./modules/users/users.routes');
const establishmentRoutes    = require('./modules/establishments/establishments.routes');
const departmentRoutes       = require('./modules/departments/departments.routes');
const scheduleRoutes         = require('./modules/schedules/schedules.routes');
const shiftRoutes            = require('./modules/shifts/shifts.routes');
const absenceRoutes          = require('./modules/absences/absences.routes');
const replacementRoutes      = require('./modules/replacements/replacements.routes');
const statisticsRoutes       = require('./modules/statistics/statistics.routes');
const notificationRoutes     = require('./modules/notifications/notifications.routes');
const profileRoutes          = require('./modules/profile/profile.routes');
const historyRoutes          = require('./modules/history/history.routes');
const adminRoutes            = require('./modules/admin/admin.routes');
const scheduleConfigRoutes   = require('./modules/schedules/schedule-config.routes');
const scheduleBuilderRoutes  = require('./modules/schedules/schedule-builder.routes');
const portfolioRoutes        = require('./modules/portfolio/portfolio.routes');
const absencesShiftRoutes    = require('./modules/absences/absences-shift.routes');
const leavesRoutes           = require('./modules/absences/leaves.routes');
const staffLoansRoutes       = require('./modules/schedules/staff-loans.routes');
const notesRoutes            = require('./modules/notes/notes.routes');
const hospitalCalendarRoutes = require('./modules/schedules/hospital-calendar.routes');
const journalRoutes          = require('./modules/journal/journal.routes');
const supervisionRoutes      = require('./modules/supervision/supervision.routes');
const adminOversightRoutes   = require('./modules/admin/admin-oversight.routes');
const assistantRoutes        = require('./modules/schedules/assistant.routes');
const userArchiveRoutes      = require('./modules/users/user-archive.routes');
const scheduleInboxRoutes    = require('./modules/schedules/schedule-inbox.routes');

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
  windowMs: 15 * 60 * 1000,
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
// FICHIERS STATIQUES — Avatars et uploads
// ============================================================
// Le frontend et l'API peuvent être servis sur deux origines différentes
// (ex. localhost:5173 et localhost:5000). Helmet applique sinon
// `Cross-Origin-Resource-Policy: same-origin`, ce qui bloque les avatars dans
// le navigateur avec `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`.
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ============================================================
// ROUTES API
// ============================================================
app.use('/api/auth',           authRoutes);

// Tracker d'activité — appliqué à toutes les routes authentifiées
app.use('/api', trackActivity);

app.use('/api/users',          userRoutes);
app.use('/api/establishments', establishmentRoutes);
app.use('/api/departments',    departmentRoutes);
app.use('/api/schedules',      scheduleRoutes);
app.use('/api/shifts',         shiftRoutes);
app.use('/api/absences',       absenceRoutes);
app.use('/api/replacements',   replacementRoutes);
app.use('/api/statistics',     statisticsRoutes);
app.use('/api/notifications',  notificationRoutes);
app.use('/api/profile',        profileRoutes);
app.use('/api/history',        historyRoutes);
app.use('/api/admin',          adminRoutes);
app.use('/api/schedule-config',  scheduleConfigRoutes);
app.use('/api/schedule-builder', scheduleBuilderRoutes);
app.use('/api/portfolio',        portfolioRoutes);
app.use('/api/absences-shift',   absencesShiftRoutes);
app.use('/api/leaves',           leavesRoutes);
app.use('/api/staff-loans',      staffLoansRoutes);
app.use('/api/notes',            notesRoutes);
app.use('/api/hospital-calendar', hospitalCalendarRoutes);
app.use('/api/journal',           journalRoutes);
app.use('/api/supervision',       supervisionRoutes);
app.use('/api/admin-oversight',   adminOversightRoutes);
app.use('/api/assistant',         assistantRoutes);
app.use('/api/user-archive',      userArchiveRoutes);
// Espace « Planning à consulter » du surveillant de service (point 3)
app.use('/api/schedule-inbox',    scheduleInboxRoutes);


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
