# GardeSante 🏥

> **Plateforme expérimentale de gestion intelligente des gardes hospitalières**  
> Stack : Express.js · React · PostgreSQL · Socket.io · Recharts · Zustand

---

## 🎯 Présentation

GardeSante est une plateforme **multi-établissements** configurable, conçue pour :
- Gérer les plannings de garde (création, validation, approbation)
- Détecter automatiquement les conflits d'affectation
- Gérer les absences avec workflow de validation
- Proposer des remplaçants via un algorithme de scoring
- Générer automatiquement les plannings (Round-Robin équitable)
- Visualiser les statistiques et tableaux de bord analytiques
- Exporter en PDF et Excel
- Interface bilingue **FR / AR** avec support RTL

---

## 🏗️ Architecture

```
GardeSante/
├── backend/               # API Express.js
│   ├── src/
│   │   ├── config/        # DB Pool, constantes JWT
│   │   ├── db/
│   │   │   ├── migrations/ # 001_schema.sql (18 tables)
│   │   │   └── seeds/      # 001_demo_data.sql
│   │   ├── middleware/    # Auth JWT, RBAC dynamique, ErrorHandler
│   │   └── modules/       # auth, users, departments, schedules,
│   │                      # shifts, absences, replacements,
│   │                      # statistics, notifications
│   ├── index.js           # Serveur HTTP + Socket.io
│   └── .env
├── frontend/              # React + Vite
│   ├── src/
│   │   ├── api/           # Axios client + modules API
│   │   ├── components/    # Sidebar, Header, AppLayout
│   │   ├── pages/         # Dashboard, Schedules, Shifts, Absences,
│   │   │                  # Replacements, Statistics, Users,
│   │   │                  # Departments, Settings
│   │   ├── store/         # Zustand (auth, ui, notifications)
│   │   ├── utils/         # Traductions FR/AR, helpers, export
│   │   ├── styles/        # layout.css
│   │   └── index.css      # Design system complet
│   └── vite.config.js
└── docker-compose.yml
```

---

## 🚀 Démarrage rapide (Développement)

### Prérequis
- **Node.js** ≥ 18
- **PostgreSQL** ≥ 14 (ou Docker)
- **npm** ≥ 9

### 1. Démarrer PostgreSQL via Docker

```bash
docker-compose up postgres -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# Adapter les variables dans .env si nécessaire
npm install
npm run dev
```

Le backend démarre sur **http://localhost:5000**

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Le frontend démarre sur **http://localhost:5173**

---

## 🐳 Démarrage avec Docker Compose (Complet)

```bash
# Copier les variables d'environnement
cp backend/.env.example backend/.env

# Démarrer tous les services
docker-compose up --build

# En arrière-plan
docker-compose up -d --build
```

Services disponibles :
| Service    | URL                        |
|-----------|----------------------------|
| Frontend  | http://localhost:5173       |
| Backend   | http://localhost:5000       |
| API Health| http://localhost:5000/health|
| PostgreSQL| localhost:5432              |

---

## 🔐 Comptes de démonstration

> Mot de passe : `Admin@123` pour tous les comptes

| Rôle                | Email                     | Accès |
|--------------------|---------------------------|-------|
| Super Admin        | admin@gardesante.dz       | Total |
| Directeur          | directeur@hca.dz          | Hôpital A |
| Surveillant Général| surv.general@hca.dz       | Hôpital A |
| Chef de Service    | chef.urg@hca.dz           | Urgences |
| Médecin Senior     | dr.sofiane@hca.dz         | Urgences |
| Résident           | res.lyes@hca.dz           | Urgences |
| Admin Hôpital B    | admin@hcb.dz              | Hôpital B |
| Admin Institut     | admin@incanc.dz           | Institut |

---

## 📡 API Endpoints

### Authentification
| Méthode | Endpoint             | Description |
|---------|---------------------|-------------|
| POST    | `/api/auth/login`   | Connexion |
| POST    | `/api/auth/refresh` | Refresh token |
| GET     | `/api/auth/me`      | Profil courant |
| POST    | `/api/auth/logout`  | Déconnexion |

### Plannings
| Méthode | Endpoint                        | Description |
|---------|---------------------------------|-------------|
| GET     | `/api/schedules`               | Liste + filtres |
| POST    | `/api/schedules`               | Créer |
| POST    | `/api/schedules/generate`      | Génération auto |
| GET     | `/api/schedules/:id/conflicts` | Conflits |
| POST    | `/api/schedules/:id/submit`    | Soumettre |
| POST    | `/api/schedules/:id/approve`   | Approuver |
| POST    | `/api/schedules/:id/reject`    | Rejeter |

### Gardes · Absences · Remplacements · Statistiques
Voir la documentation complète dans `/docs/api.md` *(à venir)*

---

## 🎨 Design System

- **Thème**: Dark mode · Glassmorphism
- **Polices**: Inter (Google Fonts)  
- **Couleurs**: Palette HSL curated (#1B4FCA primaire)
- **Composants**: Cards, KPI Cards, Tables, Modals, Badges, Forms
- **Animations**: Transitions fluides, skeleton loaders, micro-animations
- **Charts**: Recharts (Area, Bar, Pie, Line)
- **RTL**: Support natif arabe avec CSS `dir="rtl"`

---

## 🔒 Sécurité

- **Authentification**: JWT RS256 avec refresh tokens
- **Autorisation**: RBAC dynamique (permissions en base)
- **Multi-tenant**: Isolation stricte par `establishment_id`
- **Rate Limiting**: 500 req/15min global, 20 req/15min sur `/auth/login`
- **Sécurité HTTP**: Helmet.js (CSP, HSTS, X-Frame-Options...)
- **Validation**: Joi + contraintes SQL CHECK

---

## 🧠 Intelligence Métier

### Génération automatique (Round-Robin)
L'algorithme `schedules.controller.js → generateSchedule()` :
1. Charge tous les médecins du service
2. Récupère leurs gardes récentes (charge équitable)
3. Pour chaque jour de la période → affecte en rotation
4. Détecte et évite les conflits (repos minimum configurable)

### Scoring des remplaçants
`replacements.controller.js → findCandidates()` :
- Score 0→100 basé sur : gardes récentes, spécialité, disponibilité
- Exclusion automatique : médecins en congé, absence approuvée
- Top 5 candidats proposés automatiquement

### Détection de conflits
`schedules.controller.js → detectConflicts()` :
- Double affectation le même jour
- Violation du repos minimum entre 2 gardes (configurable)

---

## 📊 Base de données

**18 tables PostgreSQL** :
`establishments` · `roles` · `permissions` · `role_permissions` · `users` · `user_departments` · `departments` · `shift_types` · `schedules` · `shifts` · `workflow_definitions` · `workflow_steps` · `workflow_instances` · `absence_types` · `absences` · `replacements` · `replacement_candidates` · `notifications`

---

## 🗓️ Roadmap

- [ ] Module profil médecin complet
- [ ] Notifications push (PWA)
- [ ] Module Rapport hebdomadaire automatique
- [ ] Algorithme IA avancé (ML pour prédiction d'absences)
- [ ] API publique gouvernementale (OAuth2)
- [ ] Application mobile React Native

---

## 📄 Licence

Prototype expérimental — Usage interne hospitalier.  
© 2025 GardeSante Project
