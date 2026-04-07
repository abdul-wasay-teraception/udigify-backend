/**
 * Shared plan definitions for the Stripe billing system.
 * Used by stripe.js (checkout/webhook) and the client via /api/stripe/plans.
 */

export const PLANS = {
    starter: {
        id:             'starter',
        name:           'Starter',
        priceMonthly:   29,
        stripePriceCents: 2900,
        publerCredits:  10,   // Publer posts per billing cycle
        snovCredits:    10,   // Snov.io lead credits per billing cycle
        description:    'Perfect for individuals getting started with social scheduling and lead generation.',
        color:          '#3B82F6',
        gradient:       'from-blue-500 to-cyan-400',
        popular:        false,
        features: [
            '10 Publer social posts / month',
            '10 Snov.io lead credits / month',
            'Schedule posts on 6+ platforms',
            'Basic lead search & email finder',
            'Standard analytics dashboard',
            'Email support',
        ],
    },
    growth: {
        id:             'growth',
        name:           'Growth',
        priceMonthly:   79,
        stripePriceCents: 7900,
        publerCredits:  40,
        snovCredits:    40,
        description:    'Built for growing teams that need more reach and qualified leads at scale.',
        color:          '#8B5CF6',
        gradient:       'from-violet-500 to-purple-600',
        popular:        true,
        features: [
            '40 Publer social posts / month',
            '40 Snov.io lead credits / month',
            'All Starter features',
            'Advanced lead filters (industry, seniority)',
            'Bulk scheduling & AI captions',
            'Priority email support',
        ],
    },
    agency: {
        id:             'agency',
        name:           'Agency',
        priceMonthly:   149,
        stripePriceCents: 14900,
        publerCredits:  50,
        snovCredits:    50,
        description:    'Full-power suite for agencies managing multiple clients and campaigns.',
        color:          '#F59E0B',
        gradient:       'from-amber-500 to-orange-500',
        popular:        false,
        features: [
            '50 Publer social posts / month',
            '50 Snov.io lead credits / month',
            'All Growth features',
            'Bulk lead export',
            'White-label analytics reports',
            'Advanced campaign management',
            'Priority phone & email support',
        ],
    },
};

export const PLAN_IDS = Object.keys(PLANS);

/**
 * Given a Stripe price ID stored on a subscription, find which plan it belongs to.
 * Falls back to matching by plan name in the price's product metadata.
 */
export function planFromPriceId(priceId, metadataPlanId) {
    if (metadataPlanId && PLANS[metadataPlanId]) return PLANS[metadataPlanId];
    return null;
}
