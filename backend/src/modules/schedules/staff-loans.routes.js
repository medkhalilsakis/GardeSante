const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const { requestLoan, listLoans, decideLoan } = require('./staff-loans.controller');
const { getStaffLoanStats } = require('./staff-loans-stats.controller');

router.use(authenticate);

router.post('/', requestLoan);
// Route littérale AVANT toute route paramétrée de même profondeur : sinon
// `/stats` serait capturé par un éventuel `/:id`.
router.get('/stats', getStaffLoanStats);
router.get('/', listLoans);
router.put('/:id/decide', decideLoan);

module.exports = router;
