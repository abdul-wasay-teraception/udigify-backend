/**
 * Shared plan definitions for the Stripe billing system.
 * Used by stripe.js (checkout/webhook) and the client via /api/stripe/plans.
 */

export const PLANS = {
    starter: {
        id:                    'starter',
        name:                  'Starter',
        priceMonthly:          29,
        stripePriceCents:      2900,
        // ─── Service credits (per billing month) ─────────────────────────
        templateLimit:         6,
        publerCredits:         10,
        snovCredits:           10,
        agencyAnalyticsSites:  1,
        powerToolsQueries:     10,
        description:           'Perfect for individuals getting started.',
        color:                 '#3B82F6',
        gradient:              'from-blue-500 to-cyan-400',
        popular:               false,
        features: [
            '10 Publer social posts / month',
            '10 Snov.io lead credits / month',
            '6 Email & Resume templates',
            '1 AgencyAnalytics website',
            '10 AI PowerTools queries / month',
            'Schedule posts on 6+ platforms',
            'Basic lead search & email finder',
            'Standard analytics dashboard',
            'Email support',
        ],
    },
    growth: {
        id:                    'growth',
        name:                  'Growth',
        priceMonthly:          79,
        stripePriceCents:      7900,
        templateLimit:         15,
        publerCredits:         50,
        snovCredits:           50,
        agencyAnalyticsSites:  3,
        powerToolsQueries:     50,
        description:           'Built for growing teams that need more reach and qualified leads at scale.',
        color:                 '#8B5CF6',
        gradient:              'from-violet-500 to-purple-600',
        popular:               true,
        features: [
            '50 Publer social posts / month',
            '50 Snov.io lead credits / month',
            '15 Email & Resume templates',
            '3 AgencyAnalytics websites',
            '50 AI PowerTools queries / month',
            'All Starter features',
            'Advanced lead filters (industry, seniority)',
            'Bulk scheduling & AI captions',
            'Priority email support',
        ],
    },
    agency: {
        id:                    'agency',
        name:                  'Agency',
        priceMonthly:          149,
        stripePriceCents:      14900,
        templateLimit:         Number.POSITIVE_INFINITY,
        publerCredits:         200,
        snovCredits:           200,
        agencyAnalyticsSites:  null,  // unlimited
        powerToolsQueries:     200,
        description:           'Full-power suite for agencies managing multiple clients and campaigns.',
        color:                 '#F59E0B',
        gradient:              'from-amber-500 to-orange-500',
        popular:               false,
        features: [
            '200 Publer social posts / month',
            '200 Snov.io lead credits / month',
            'Unlimited Email & Resume templates',
            'Unlimited AgencyAnalytics websites',
            '200 AI PowerTools queries / month',
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
