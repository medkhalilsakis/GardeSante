const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const { listLeaves, getLeaveTypes, createLeave, cancelLeave } = require('./leaves.controller');

router.use(authenticate);

router.get('/', listLeaves);
router.get('/types', getLeaveTypes);
router.post('/', createLeave);
router.put('/:id/cancel', cancelLeave);

module.exports = router;
