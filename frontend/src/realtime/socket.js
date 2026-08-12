/**
 * Socket.io client — connexion temps réel
 * Monte la connexion une seule fois, expose des helpers pour s'authentifier et rejoindre les rooms
 */

import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

let socket = null;

/**
 * Identité demandée par l'application, mémorisée hors de la socket.
 *
 * POURQUOI : `connect()` est asynchrone. Les appelants (`useRealtime`) appellent
 * `authenticate()` / `joinEstablishment()` / `joinDepartment()` juste après, à un
 * moment où `socket.connected` est encore `false` — les `emit` étaient alors
 * silencieusement abandonnés et AUCUNE room n'était jamais rejointe, pas même
 * `user:<id>`. Tous les `emitToUser` / `emitToDepartment` du serveur tombaient
 * dans le vide jusqu'à ce qu'un re-rendu relance l'effet socket déjà montée.
 *
 * On mémorise donc ce qui a été demandé et on le (re)joue sur l'événement
 * `connect`, ce qui couvre aussi les reconnexions après coupure réseau.
 * Les signatures publiques ne changent pas.
 */
const desired = {
  userId: null,
  establishmentId: null,
  departmentIds: new Set(),
};

/** (Re)joue l'identité mémorisée sur une socket connectée. */
const replayIdentity = (s) => {
  if (!s?.connected) return;
  if (desired.userId) s.emit('authenticate', desired.userId);
  if (desired.establishmentId) s.emit('join-establishment', desired.establishmentId);
  desired.departmentIds.forEach((id) => s.emit('join-department', id));
};

/**
 * Obtenir ou créer la socket
 */
export const getSocket = () => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    socket.on('connect', () => {
      console.log('✅ Socket.io connected');
      // Rejoindre les rooms dès que la connexion est réellement établie.
      replayIdentity(socket);
    });

    socket.on('disconnect', (reason) => {
      console.log('🔌 Socket.io disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.warn('⚠️  Socket.io connection error:', err.message);
    });
  }

  return socket;
};

/**
 * Se connecter au serveur
 */
export const connect = () => {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
};

/**
 * Se déconnecter proprement
 */
export const disconnect = () => {
  // L'identité est oubliée : à la prochaine connexion, l'appelant redéclare
  // ce qu'il veut rejoindre (le changement d'utilisateur ne doit rien traîner).
  desired.userId = null;
  desired.establishmentId = null;
  desired.departmentIds.clear();
  if (socket && socket.connected) {
    socket.disconnect();
  }
};

/**
 * S'authentifier et rejoindre la room user:${userId}
 * L'appel est mémorisé : si la socket n'est pas encore connectée, il sera rejoué
 * automatiquement sur `connect` (et à chaque reconnexion).
 * @param {string} userId
 */
export const authenticate = (userId) => {
  if (!userId) return;
  const s = getSocket();
  desired.userId = userId;
  if (s.connected) s.emit('authenticate', userId);
};

/**
 * Rejoindre la room establishment:${establishmentId}
 * @param {string} establishmentId
 */
export const joinEstablishment = (establishmentId) => {
  if (!establishmentId) return;
  const s = getSocket();
  desired.establishmentId = establishmentId;
  if (s.connected) s.emit('join-establishment', establishmentId);
};

/**
 * Rejoindre la room department:${departmentId}
 * Plusieurs services peuvent être rejoints (un acteur peut appartenir à
 * plusieurs services) : les identifiants s'accumulent.
 * @param {string} departmentId
 */
export const joinDepartment = (departmentId) => {
  if (!departmentId) return;
  const s = getSocket();
  desired.departmentIds.add(departmentId);
  if (s.connected) s.emit('join-department', departmentId);
};

/**
 * Enregistrer un listener pour un événement
 * @param {string} event
 * @param {Function} handler
 */
export const on = (event, handler) => {
  const s = getSocket();
  s.on(event, handler);
};

/**
 * Retirer un listener
 * @param {string} event
 * @param {Function} handler
 */
export const off = (event, handler) => {
  const s = getSocket();
  s.off(event, handler);
};
