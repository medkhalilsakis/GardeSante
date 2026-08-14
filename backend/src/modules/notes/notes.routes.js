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

router.use(authenticate);

router.post('/', uploadMiddleware, publishNote);
router.get('/', listNotes);
router.put('/:id/read', markNoteRead);
router.get('/:id/readers', listNoteReaders);
router.get('/:id', getNote);
router.delete('/:id', deleteNote);

module.exports = router;
