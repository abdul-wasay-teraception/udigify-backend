import mongoose from 'mongoose';

const paymentHistorySchema = new mongoose.Schema({
    user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName:    { type: String, default: '' },
    userEmail:   { type: String, default: '' },
    plan:        { type: String, required: true },          // 'starter' | 'growth' | 'agency'
    planName:    { type: String, default: '' },             // 'Starter' | 'Growth' | 'Agency'
    amount:      { type: Number, required: true },          // cents  e.g. 2900
    currency:    { type: String, default: 'usd' },
    status:      { type: String, enum: ['succeeded', 'failed', 'refunded'], default: 'succeeded' },
    type:        { type: String, enum: ['new_subscription', 'renewal', 'payment_failed'], default: 'new_subscription' },
    stripeSessionId:      { type: String, default: null },
    stripeInvoiceId:      { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    periodStart: { type: Date, default: null },
    periodEnd:   { type: Date, default: null },
    paidAt:      { type: Date, default: Date.now },
});

const PaymentHistory = mongoose.model('PaymentHistory', paymentHistorySchema);
export default PaymentHistory;
