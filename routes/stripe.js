/**
 * Stripe billing routes
 *
 * POST  /api/stripe/checkout          – Create a Checkout Session (subscription)
 * POST  /api/stripe/webhook           – Stripe webhook handler (raw body required)
 * GET   /api/stripe/subscription      – Get current user's subscription + credits
 * POST  /api/stripe/portal            – Create a Stripe Customer Portal session
 * POST  /api/stripe/cancel            – Cancel active subscription at period end
 * GET   /api/stripe/plans             – Return available plans (no auth needed)
 * GET   /api/stripe/payments          – User's own payment history
 * GET   /api/stripe/admin/payments    – All payments (admin only)
 */

import express from 'express';
import Stripe from 'stripe';
import User from '../models/User.js';
import PaymentHistory from '../models/PaymentHistory.js';
import { protect, admin } from '../middleware/auth.js';
import { PLANS, planFromPriceId } from '../config/plans.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET, { apiVersion: '2023-10-16' });

// ─── Public: return available plans ──────────────────────────────────────────
router.get('/plans', (req, res) => {
    res.json(Object.values(PLANS));
});

// ─── Create Stripe Checkout Session ──────────────────────────────────────────
// POST /api/stripe/checkout
// Body: { planId: 'starter' | 'growth' | 'agency' }
router.post('/checkout', protect, async (req, res) => {
    try {
        const { planId } = req.body;
        const plan = PLANS[planId];
        if (!plan) return res.status(400).json({ message: 'Invalid plan selected.' });

        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        // Prevent duplicate active subscriptions for the same plan
        if (
            user.subscription?.status === 'active' &&
            user.subscription?.plan === planId
        ) {
            return res.status(400).json({ message: 'You already have this plan active.' });
        }

        // Reuse or create Stripe customer
        let customerId = user.subscription?.stripeCustomerId;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                name:  user.name,
                metadata: { userId: String(user._id) },
            });
            customerId = customer.id;
            user.subscription = user.subscription || {};
            user.subscription.stripeCustomerId = customerId;
            await user.save();
        }

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        const session = await stripe.checkout.sessions.create({
            customer:     customerId,
            mode:         'subscription',
            payment_method_types: ['card'],
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency:    'usd',
                        unit_amount: plan.stripePriceCents,
                        recurring:   { interval: 'month' },
                        product_data: {
                            name:        `Udigify ${plan.name} Plan`,
                            description: plan.description,
                            metadata:    { planId: plan.id },
                        },
                    },
                },
            ],
            subscription_data: {
                metadata: {
                    userId: String(user._id),
                    planId: plan.id,
                },
            },
            success_url: `${frontendUrl}/dashboard/billing?session_id={CHECKOUT_SESSION_ID}&plan=${plan.id}`,
            cancel_url:  `${frontendUrl}/pricing?canceled=1`,
            client_reference_id: String(user._id),
            metadata: {
                userId: String(user._id),
                planId: plan.id,
            },
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('[Stripe] checkout error:', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── Stripe Webhook ───────────────────────────────────────────────────────────
// POST /api/stripe/webhook  (raw body – configured in index.js)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
        if (webhookSecret && sig) {
            event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } else {
            // Dev mode without webhook secret – parse raw body manually
            event = JSON.parse(req.body.toString());
            console.warn('[Stripe] Webhook secret not set – skipping signature verification (dev only)');
        }
    } catch (err) {
        console.error('[Stripe] Webhook signature verification failed:', err.message);
        return res.status(400).json({ message: `Webhook Error: ${err.message}` });
    }

    try {
        await handleStripeEvent(event);
    } catch (err) {
        console.error('[Stripe] Webhook handler error:', err);
        return res.status(500).json({ message: 'Webhook handler failed.' });
    }

    res.json({ received: true });
});

// ─── Sync subscription from a completed Checkout Session ─────────────────────
// POST /api/stripe/sync-session
// Called by the frontend after Stripe redirects back with ?session_id=
// This is the fallback for when the webhook hasn't fired (e.g. local dev).
router.post('/sync-session', protect, async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ message: 'sessionId required' });

        // Fetch the completed session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription'],
        });

        if (session.payment_status !== 'paid') {
            return res.status(400).json({ message: 'Payment not completed yet.' });
        }

        // Only process the session once — if it already matches, skip
        const userId = session.metadata?.userId || session.client_reference_id;
        if (!userId || userId !== String(req.user._id)) {
            return res.status(403).json({ message: 'Session does not belong to this user.' });
        }

        const planId = session.metadata?.planId;
        const plan   = PLANS[planId];
        if (!plan) return res.status(400).json({ message: 'Unknown plan in session.' });

        const sub = session.subscription;
        const subId      = typeof sub === 'string' ? sub : sub?.id;
        const subObj     = typeof sub === 'object' ? sub : await stripe.subscriptions.retrieve(subId);
        const periodEnd  = new Date(subObj.current_period_end   * 1000);
        const periodStart = new Date(subObj.current_period_start * 1000);

        // Check if already provisioned (idempotent)
        const existing = await User.findById(userId).select('subscription credits accessGiven');
        const alreadyProvisioned =
            existing?.subscription?.stripeSubscriptionId === subId &&
            existing?.subscription?.status === 'active';

        let updatedUser;
        if (!alreadyProvisioned) {
            updatedUser = await User.findByIdAndUpdate(userId, {
                'subscription.plan':                 planId,
                'subscription.stripeSubscriptionId': subId,
                'subscription.stripePriceId':        subObj.items?.data[0]?.price?.id || '',
                'subscription.status':               subObj.status,
                'subscription.currentPeriodEnd':     periodEnd,
                'credits.publer':    plan.publerCredits,
                'credits.snov':      plan.snovCredits,
                'credits.resetDate': periodEnd,
                accessGiven:         true,
                snovPlan:            planId,
                publerPlan:          planId,
            }, { new: true });

            // Log payment record (skip if already exists for this session)
            const exists = await PaymentHistory.findOne({ stripeSessionId: session.id });
            if (!exists) {
                await PaymentHistory.create({
                    user:                updatedUser._id,
                    userName:            updatedUser.name,
                    userEmail:           updatedUser.email,
                    plan:                planId,
                    planName:            plan.name,
                    amount:              plan.stripePriceCents,
                    currency:            'usd',
                    status:              'succeeded',
                    type:                'new_subscription',
                    stripeSessionId:     session.id,
                    stripeSubscriptionId: subId,
                    periodStart,
                    periodEnd,
                    paidAt:              new Date(),
                });
            }

            console.log(`[Stripe] sync-session: provisioned ${planId} for user ${userId}`);
        } else {
            updatedUser = existing;
            console.log(`[Stripe] sync-session: already provisioned for user ${userId}, skipping`);
        }

        // Return fresh subscription data
        const freshPlan = PLANS[updatedUser.subscription?.plan] || null;
        res.json({
            subscription: updatedUser.subscription,
            credits:      updatedUser.credits,
            accessGiven:  updatedUser.accessGiven,
            plan:         freshPlan,
        });
    } catch (err) {
        console.error('[Stripe] sync-session error:', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── Get current subscription & credits (with Stripe auto-heal) ──────────────
// GET /api/stripe/subscription
router.get('/subscription', protect, async (req, res) => {
    try {
        let user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        const dbActive = ['active', 'trialing'].includes(user.subscription?.status);

        // ── Auto-heal: if DB shows no active plan but user has a Stripe customer,
        //    pull their latest subscription directly from Stripe and provision it.
        if (!dbActive && user.subscription?.stripeCustomerId) {
            try {
                const stripeSubs = await stripe.subscriptions.list({
                    customer: user.subscription.stripeCustomerId,
                    status:   'active',
                    limit:    1,
                    expand:   ['data.latest_invoice'],
                });

                if (stripeSubs.data.length > 0) {
                    const sub    = stripeSubs.data[0];
                    // Primary: use metadata; fallback: match by unit_amount
                    let planId = sub.metadata?.planId;
                    if (!planId || !PLANS[planId]) {
                        const unitAmount = sub.items?.data[0]?.price?.unit_amount;
                        if (unitAmount) {
                            planId = Object.values(PLANS).find(p => p.stripePriceCents === unitAmount)?.id || null;
                        }
                    }
                    const plan   = planId ? PLANS[planId] : null;

                    if (plan) {
                        const periodEnd   = new Date(sub.current_period_end   * 1000);
                        const periodStart = new Date(sub.current_period_start * 1000);

                        user = await User.findByIdAndUpdate(req.user._id, {
                            'subscription.plan':                 planId,
                            'subscription.stripeSubscriptionId': sub.id,
                            'subscription.stripePriceId':        sub.items?.data[0]?.price?.id || '',
                            'subscription.status':               sub.status,
                            'subscription.currentPeriodEnd':     periodEnd,
                            'credits.publer':    plan.publerCredits,
                            'credits.snov':      plan.snovCredits,
                            'credits.resetDate': periodEnd,
                            accessGiven:         true,
                            snovPlan:            planId,
                            publerPlan:          planId,
                        }, { new: true });

                        // Log payment record if not already logged
                        const invoiceId = typeof sub.latest_invoice === 'object'
                            ? sub.latest_invoice?.id
                            : sub.latest_invoice;
                        const exists = await PaymentHistory.findOne({
                            $or: [
                                { stripeSubscriptionId: sub.id, type: 'new_subscription' },
                                ...(invoiceId ? [{ stripeInvoiceId: invoiceId }] : []),
                            ]
                        });
                        if (!exists) {
                            await PaymentHistory.create({
                                user:                user._id,
                                userName:            user.name,
                                userEmail:           user.email,
                                plan:                planId,
                                planName:            plan.name,
                                amount:              plan.stripePriceCents,
                                currency:            'usd',
                                status:              'succeeded',
                                type:                'new_subscription',
                                stripeSubscriptionId: sub.id,
                                stripeInvoiceId:     invoiceId || null,
                                periodStart,
                                periodEnd,
                                paidAt:              new Date(sub.start_date * 1000),
                            });
                        }

                        console.log(`[Stripe] auto-heal: provisioned ${planId} for user ${req.user._id}`);
                    }
                }
            } catch (healErr) {
                // Non-fatal — log and return whatever is in DB
                console.error('[Stripe] auto-heal error:', healErr.message);
            }
        }

        const plan = PLANS[user.subscription?.plan] || null;
        res.json({
            subscription: user.subscription || {},
            credits:      user.credits      || { publer: 0, snov: 0 },
            accessGiven:  user.accessGiven,
            plan,
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── Create Customer Portal session ──────────────────────────────────────────
// POST /api/stripe/portal
router.post('/portal', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('subscription');
        const customerId = user?.subscription?.stripeCustomerId;
        if (!customerId) {
            return res.status(400).json({ message: 'No Stripe customer found. Purchase a plan first.' });
        }

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const session = await stripe.billingPortal.sessions.create({
            customer:   customerId,
            return_url: `${frontendUrl}/dashboard/billing`,
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error('[Stripe] portal error:', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── Cancel subscription ──────────────────────────────────────────────────────
// POST /api/stripe/cancel
router.post('/cancel', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('subscription');
        const subId = user?.subscription?.stripeSubscriptionId;
        if (!subId) {
            return res.status(400).json({ message: 'No active subscription found.' });
        }

        // Cancel at end of billing period instead of immediately
        const updated = await stripe.subscriptions.update(subId, {
            cancel_at_period_end: true,
        });

        await User.findByIdAndUpdate(req.user._id, {
            'subscription.status': 'canceled',
        });

        res.json({
            message: 'Subscription will be canceled at the end of the current billing period.',
            cancelAt: new Date(updated.cancel_at * 1000),
        });
    } catch (err) {
        console.error('[Stripe] cancel error:', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── Webhook event handler ────────────────────────────────────────────────────
async function handleStripeEvent(event) {
    const { type, data } = event;
    console.log(`[Stripe] Event: ${type}`);

    switch (type) {
        // ── Checkout completed → provision credits ──────────────────────────
        case 'checkout.session.completed': {
            const session = data.object;
            if (session.mode !== 'subscription') break;

            const userId = session.metadata?.userId || session.client_reference_id;
            const planId = session.metadata?.planId;
            const subId  = session.subscription;

            if (!userId || !planId || !subId) {
                console.warn('[Stripe] checkout.session.completed missing metadata:', { userId, planId, subId });
                break;
            }

            const plan = PLANS[planId];
            if (!plan) { console.warn('[Stripe] Unknown planId:', planId); break; }

            // Fetch subscription to get period end
            const sub = await stripe.subscriptions.retrieve(subId);
            const periodEnd   = new Date(sub.current_period_end   * 1000);
            const periodStart = new Date(sub.current_period_start * 1000);

            const updatedUser = await User.findByIdAndUpdate(userId, {
                'subscription.plan':                 planId,
                'subscription.stripeSubscriptionId': subId,
                'subscription.stripePriceId':        sub.items.data[0]?.price?.id || '',
                'subscription.status':               sub.status,
                'subscription.currentPeriodEnd':     periodEnd,
                // Grant fresh credits for the new billing cycle
                'credits.publer':    plan.publerCredits,
                'credits.snov':      plan.snovCredits,
                'credits.resetDate': periodEnd,
                // Auto-grant access when a valid payment comes in
                accessGiven:         true,
                // Also update legacy plan fields for backward compat
                snovPlan:            planId,
                publerPlan:          planId,
            }, { new: true });

            // Log payment record (idempotent — skip if already logged by sync-session)
            const existingPayment = await PaymentHistory.findOne({ stripeSessionId: session.id });
            if (!existingPayment) {
                await PaymentHistory.create({
                    user:                updatedUser._id,
                    userName:            updatedUser.name,
                    userEmail:           updatedUser.email,
                    plan:                planId,
                    planName:            plan.name,
                    amount:              plan.stripePriceCents,
                    currency:            'usd',
                    status:              'succeeded',
                    type:                'new_subscription',
                    stripeSessionId:     session.id,
                    stripeSubscriptionId: subId,
                    periodStart,
                    periodEnd,
                    paidAt:              new Date(),
                });
            }

            console.log(`[Stripe] Provisioned ${planId} plan for user ${userId} — access auto-granted`);
            break;
        }

        // ── Subscription renewed → reset credits ────────────────────────────
        case 'invoice.paid': {
            const invoice = data.object;
            if (invoice.billing_reason !== 'subscription_cycle') break;

            const subId = invoice.subscription;
            if (!subId) break;

            const sub = await stripe.subscriptions.retrieve(subId);
            const userId = sub.metadata?.userId;
            const planId = sub.metadata?.planId;
            if (!userId || !planId) break;

            const plan = PLANS[planId];
            if (!plan) break;

            const periodEnd   = new Date(sub.current_period_end   * 1000);
            const periodStart = new Date(sub.current_period_start * 1000);

            const renewedUser = await User.findByIdAndUpdate(userId, {
                'subscription.status':           sub.status,
                'subscription.currentPeriodEnd': periodEnd,
                'credits.publer':    plan.publerCredits,
                'credits.snov':      plan.snovCredits,
                'credits.resetDate': periodEnd,
                accessGiven:         true,
            }, { new: true });

            // Log renewal payment
            await PaymentHistory.create({
                user:                renewedUser._id,
                userName:            renewedUser.name,
                userEmail:           renewedUser.email,
                plan:                planId,
                planName:            plan.name,
                amount:              plan.stripePriceCents,
                currency:            'usd',
                status:              'succeeded',
                type:                'renewal',
                stripeInvoiceId:     invoice.id,
                stripeSubscriptionId: subId,
                periodStart,
                periodEnd,
                paidAt:              new Date(),
            });

            console.log(`[Stripe] Credits reset for user ${userId} (${planId}): ${plan.publerCredits} Publer + ${plan.snovCredits} Snov`);
            break;
        }

        // ── Subscription canceled / expired ─────────────────────────────────
        case 'customer.subscription.deleted': {
            const sub = data.object;
            const userId = sub.metadata?.userId;
            if (!userId) break;

            await User.findByIdAndUpdate(userId, {
                'subscription.status': 'inactive',
                'subscription.plan':   'none',
                'credits.publer':      0,
                'credits.snov':        0,
                snovPlan:              'none',
                publerPlan:            'none',
                accessGiven:           false,   // revoke dashboard access
            });

            console.log(`[Stripe] Subscription deleted for user ${userId} — access revoked, credits zeroed`);
            break;
        }

        // ── Payment failed → update status ──────────────────────────────────
        case 'invoice.payment_failed': {
            const invoice = data.object;
            const subId = invoice.subscription;
            if (!subId) break;

            const sub = await stripe.subscriptions.retrieve(subId);
            const userId = sub.metadata?.userId;
            const planId = sub.metadata?.planId;
            if (!userId) break;

            const failedUser = await User.findByIdAndUpdate(userId, {
                'subscription.status': 'past_due',
            }, { new: true });

            if (failedUser && planId) {
                const plan = PLANS[planId];
                await PaymentHistory.create({
                    user:                failedUser._id,
                    userName:            failedUser.name,
                    userEmail:           failedUser.email,
                    plan:                planId,
                    planName:            plan?.name || planId,
                    amount:              plan?.stripePriceCents || 0,
                    currency:            'usd',
                    status:              'failed',
                    type:                'payment_failed',
                    stripeInvoiceId:     invoice.id,
                    stripeSubscriptionId: subId,
                    paidAt:              new Date(),
                });
            }

            console.log(`[Stripe] Payment failed for user ${userId}`);
            break;
        }

        // ── Subscription updated ─────────────────────────────────────────────
        case 'customer.subscription.updated': {
            const sub = data.object;
            const userId = sub.metadata?.userId;
            if (!userId) break;

            const TERMINAL = ['canceled', 'incomplete_expired', 'unpaid'];
            const isTerminal = TERMINAL.includes(sub.status);
            const isHealthy  = ['active', 'trialing'].includes(sub.status);

            const updateFields = {
                'subscription.status':           sub.status,
                'subscription.currentPeriodEnd': new Date(sub.current_period_end * 1000),
            };

            if (isTerminal) {
                // Subscription went to a terminal state — revoke access and zero credits
                updateFields.accessGiven         = false;
                updateFields['credits.publer']   = 0;
                updateFields['credits.snov']     = 0;
                updateFields['subscription.plan'] = 'none';
                updateFields.snovPlan            = 'none';
                updateFields.publerPlan          = 'none';
                console.log(`[Stripe] Subscription terminal (${sub.status}) for user ${userId} — access revoked`);
            } else if (isHealthy) {
                // Subscription recovered (e.g. past_due → active after retry) — restore access
                const planId = sub.metadata?.planId;
                const plan   = planId ? PLANS[planId] : null;
                if (plan) {
                    updateFields.accessGiven              = true;
                    updateFields['subscription.plan']     = planId;
                    updateFields.snovPlan                 = planId;
                    updateFields.publerPlan               = planId;
                    console.log(`[Stripe] Subscription recovered (${sub.status}) for user ${userId} — access restored`);
                }
            }

            await User.findByIdAndUpdate(userId, updateFields);
            break;
        }

        default:
            break;
    }
}

// ─── User: own payment history ───────────────────────────────────────────────
// GET /api/stripe/payments
router.get('/payments', protect, async (req, res) => {
    try {
        const payments = await PaymentHistory.find({ user: req.user._id })
            .sort({ paidAt: -1 })
            .limit(50)
            .lean();
        res.json(payments);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── Admin: all payment history ──────────────────────────────────────────────
// GET /api/stripe/admin/payments
router.get('/admin/payments', protect, admin, async (req, res) => {
    try {
        const payments = await PaymentHistory.find({})
            .sort({ paidAt: -1 })
            .limit(200)
            .populate('user', 'name email')
            .lean();
        res.json(payments);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
