const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const {
  uploadMiddleware,
  publishNote,
  listNotes,
  getNote,
  markNoteRead,
  listNoteReaders,
  deleteNote,
} = require('./notes.controller');

// Suivi de diffusion (Lot X5) — non-lecteurs nommés et relance tracée.
const { getDiffusion, remindUnread } = require('./notes-diffusion.controller');

router.use(authenticate);

router.post('/', uploadMiddleware, publishNote);
router.get('/', listNotes);
router.put('/:id/read', markNoteRead);
router.get('/:id/readers', listNoteReaders);
// Placées avant `/:id` par lisibilité ; Express ne confond pas deux segments
// avec un seul. Chaque handler vérifie lui-même le droit d'accès.
router.get('/:id/diffusion', getDiffusion);
router.post('/:id/remind', remindUnread);
router.get('/:id', getNote);
router.delete('/:id', deleteNote);

module.exports = router;
