import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
    },
    resetPasswordToken: {
        type: String,
        default: null,
    },
    resetPasswordExpires: {
        type: Date,
        default: null,
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
    },
    accessGiven: {
        type: Boolean,
        default: false,
    },
    servicePlan: {
        type: String,
        default: 'Standard',
    },
    systemeCreds: {
        email: { type: String },
        password: { type: String },
        loginUrl: { type: String, default: 'https://systeme.io/dashboard' }
    },
    // ─── Publer / Social Media ────────────────────────────────────────────────
    publerPlan: {
        type: String,
        enum: ['none', 'starter', 'growth', 'agency'],
        default: 'none',
    },
    publerCreds: {
        apiKey:      { type: String, default: '' },
        workspaceId: { type: String, default: '' },
        loginUrl:    { type: String, default: 'https://app.publer.io' },
    },
    // ─── Snov.io / Lead Generation ────────────────────────────────────────────
    snovPlan: {
        type: String,
        enum: ['none', 'starter', 'growth', 'agency'],
        default: 'none',
    },
    snovUsage: {
        leadsThisMonth:      { type: Number, default: 0 },
        emailFindsThisMonth: { type: Number, default: 0 },
        resetDate:           { type: Date, default: () => {
            const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return d;
        }},
    },
    // Per-user custom limits — when enabled, these override the plan defaults
    snovCustomLimits: {
        enabled:            { type: Boolean, default: false },
        leadsPerMonth:      { type: Number,  default: 0 },
        emailFindsPerMonth: { type: Number,  default: 0 },
    },
    // ─── Stripe Subscription ─────────────────────────────────────────────────
    subscription: {
        plan:                 { type: String, enum: ['none', 'starter', 'growth', 'agency'], default: 'none' },
        stripeCustomerId:     { type: String, default: null },
        stripeSubscriptionId: { type: String, default: null },
        stripePriceId:        { type: String, default: null },
        status:               { type: String, enum: ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'inactive'], default: 'inactive' },
        currentPeriodEnd:     { type: Date,   default: null },
    },
    // ─── Per-service monthly credits (reset on subscription renewal) ──────────
    credits: {
        publer:    { type: Number, default: 0 },
        snov:      { type: Number, default: 0 },
        resetDate: { type: Date,   default: null },
    },
    createdAt: {
        type: Date,
        default: Date.now,
    }
});

const User = mongoose.model('User', userSchema);
export default User;
