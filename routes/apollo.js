import express from 'express';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
const APOLLO_BASE = 'https://api.apollo.io/api/v1';

// ─── Plan definitions (monthly lead credits) ─────────────────────────────────
const PLAN_LIMITS = {
    starter: { leadsPerMonth: 50,   enrichPerMonth: 20,   bulkExport: false, advancedFilters: false },
    growth:  { leadsPerMonth: 250,  enrichPerMonth: 100,  bulkExport: false, advancedFilters: true  },
    agency:  { leadsPerMonth: 1000, enrichPerMonth: 500,  bulkExport: true,  advancedFilters: true  },
    none:    { leadsPerMonth: 0,    enrichPerMonth: 0,    bulkExport: false, advancedFilters: false },
};

// ─── Helper: call Apollo.io API from server ───────────────────────────────────
async function apolloFetch(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': process.env.APOLLO_API_KEY,
    };

    const res = await fetch(`${APOLLO_BASE}${path}`, { ...options, headers });

    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }

    if (!res.ok) {
        const msg = data.error || data.message || data.error_description || `Apollo API error (${res.status})`;
        throw new Error(msg);
    }
    return data;
}

// ─── Helper: get user's plan + reset usage if month rolled over ───────────────
async function getUserPlanData(userId) {
    const user = await User.findById(userId).select('apolloPlan apolloCreds apolloUsage');
    if (!user) throw new Error('User not found');

    // Reset usage counter if past reset date
    const now = new Date();
    if (user.apolloUsage?.resetDate && now >= new Date(user.apolloUsage.resetDate)) {
        const nextReset = new Date(now);
        nextReset.setDate(1);
        nextReset.setMonth(nextReset.getMonth() + 1);
        user.apolloUsage = { leadsThisMonth: 0, resetDate: nextReset };
        await user.save();
    }

    const plan = user.apolloPlan || 'none';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.none;
    const usage = {
        leadsThisMonth: user.apolloUsage?.leadsThisMonth || 0,
        resetDate: user.apolloUsage?.resetDate,
    };

    return { user, plan, limits, usage };
}

// ─── Helper: increment usage ──────────────────────────────────────────────────
async function incrementUsage(userId, count = 1) {
    await User.findByIdAndUpdate(userId, {
        $inc: { 'apolloUsage.leadsThisMonth': count },
    });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// @desc  Get user's Apollo plan, limits and usage
// @route GET /api/apollo/plan
// @access Private
router.get('/plan', protect, async (req, res) => {
    try {
        const { plan, limits, usage } = await getUserPlanData(req.user._id);
        const user = await User.findById(req.user._id).select('apolloCreds');
        res.json({
            plan,
            limits,
            usage,
            configured: plan !== 'none',
            loginUrl: user?.apolloCreds?.loginUrl || 'https://app.apollo.io',
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Search for people/leads with filters
// @route POST /api/apollo/people/search
// @access Private
router.post('/people/search', protect, async (req, res) => {
    try {
        const { plan, limits, usage } = await getUserPlanData(req.user._id);

        if (plan === 'none') {
            return res.status(403).json({ message: 'Apollo.io plan not configured. Contact your admin.' });
        }

        if (usage.leadsThisMonth >= limits.leadsPerMonth) {
            return res.status(429).json({
                message: `Monthly lead limit reached (${limits.leadsPerMonth} leads). Upgrade your plan or wait for next month.`,
                usage,
                limits,
            });
        }

        const {
            q_keywords,
            person_titles,
            person_seniorities,
            organization_industry_tag_ids,
            organization_num_employees_ranges,
            person_locations,
            page = 1,
            per_page = 25,
        } = req.body;

        // Enforce per_page cap so users can't drain quota in one call
        const safePage = Math.min(per_page, 25);

        // Advanced-filter-only fields — block if plan doesn't support them
        if (!limits.advancedFilters && (
            organization_industry_tag_ids?.length ||
            organization_num_employees_ranges?.length ||
            person_seniorities?.length
        )) {
            return res.status(403).json({
                message: 'Advanced filters (industry, seniority, company size) require a Growth or Agency plan.',
            });
        }

        const payload = {
            q_keywords,
            person_titles,
            person_seniorities,
            organization_industry_tag_ids,
            organization_num_employees_ranges,
            person_locations,
            page,
            per_page: safePage,
        };

        // Strip undefined keys
        Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

        const data = await apolloFetch('/mixed_people/search', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        const returnedCount = (data.people || []).length;
        if (returnedCount > 0) await incrementUsage(req.user._id, returnedCount);

        res.json({
            people:     data.people || [],
            pagination: data.pagination || {},
            usage:      { ...usage, leadsThisMonth: usage.leadsThisMonth + returnedCount },
            limits,
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Enrich a single person by email or name+domain
// @route POST /api/apollo/people/enrich
// @access Private
router.post('/people/enrich', protect, async (req, res) => {
    try {
        const { plan, limits, usage } = await getUserPlanData(req.user._id);

        if (plan === 'none') {
            return res.status(403).json({ message: 'Apollo.io plan not configured. Contact your admin.' });
        }

        if (usage.leadsThisMonth >= limits.enrichPerMonth) {
            return res.status(429).json({
                message: `Monthly enrichment limit reached (${limits.enrichPerMonth}). Upgrade your plan.`,
                usage,
                limits,
            });
        }

        const { first_name, last_name, name, email, domain, organization_name, linkedin_url } = req.body;

        if (!email && !linkedin_url && !(first_name && (domain || organization_name))) {
            return res.status(400).json({ message: 'Provide email, LinkedIn URL, or first_name + domain/company.' });
        }

        const payload = { first_name, last_name, name, email, domain, organization_name, linkedin_url };
        Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

        const data = await apolloFetch('/people/match', {
            method: 'POST',
            body: JSON.stringify({ ...payload, reveal_personal_emails: false }),
        });

        if (data.person) await incrementUsage(req.user._id, 1);

        res.json({
            person: data.person || null,
            usage:  { ...usage, leadsThisMonth: usage.leadsThisMonth + (data.person ? 1 : 0) },
            limits,
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Search organisations / companies
// @route POST /api/apollo/organizations/search
// @access Private
router.post('/organizations/search', protect, async (req, res) => {
    try {
        const { plan, limits } = await getUserPlanData(req.user._id);

        if (plan === 'none') {
            return res.status(403).json({ message: 'Apollo.io plan not configured. Contact your admin.' });
        }

        const { q_organization_name, organization_locations, organization_industry_tag_ids,
                organization_num_employees_ranges, page = 1, per_page = 25 } = req.body;

        if (!limits.advancedFilters && (organization_industry_tag_ids?.length || organization_num_employees_ranges?.length)) {
            return res.status(403).json({ message: 'Industry & size filters require a Growth or Agency plan.' });
        }

        const payload = { q_organization_name, organization_locations, organization_industry_tag_ids,
                          organization_num_employees_ranges, page, per_page: Math.min(per_page, 25) };
        Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

        const data = await apolloFetch('/mixed_companies/search', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        res.json({
            organizations: data.organizations || data.accounts || [],
            pagination: data.pagination || {},
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Get all saved lists/sequences for the org
// @route GET /api/apollo/lists
// @access Private
router.get('/lists', protect, async (req, res) => {
    try {
        const { plan } = await getUserPlanData(req.user._id);

        if (plan === 'none') {
            return res.status(403).json({ message: 'Apollo.io plan not configured. Contact your admin.' });
        }

        const data = await apolloFetch('/labels?page=1&per_page=50');
        res.json({ lists: data.labels || [] });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Create a new saved list (label)
// @route POST /api/apollo/lists
// @access Private
router.post('/lists', protect, async (req, res) => {
    try {
        const { plan } = await getUserPlanData(req.user._id);
        if (plan === 'none') return res.status(403).json({ message: 'Apollo.io plan not configured.' });

        const { name } = req.body;
        if (!name) return res.status(400).json({ message: 'List name is required' });

        const data = await apolloFetch('/labels', {
            method: 'POST',
            body: JSON.stringify({ name }),
        });

        res.json({ list: data.label || data });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Get current user's Apollo usage summary
// @route GET /api/apollo/usage
// @access Private
router.get('/usage', protect, async (req, res) => {
    try {
        const { plan, limits, usage } = await getUserPlanData(req.user._id);
        res.json({ plan, limits, usage });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Export leads as CSV (Agency plan only)
// @route POST /api/apollo/export
// @access Private
router.post('/export', protect, async (req, res) => {
    try {
        const { plan, limits } = await getUserPlanData(req.user._id);

        if (!limits.bulkExport) {
            return res.status(403).json({ message: 'Bulk export requires an Agency plan.' });
        }

        const { people } = req.body;
        if (!Array.isArray(people) || people.length === 0) {
            return res.status(400).json({ message: 'Provide an array of people to export.' });
        }

        // Build CSV
        const headers = ['Name', 'Title', 'Company', 'Email', 'LinkedIn', 'Location', 'Seniority'];
        const rows = people.map(p => [
            `"${(p.name || '').replace(/"/g, '""')}"`,
            `"${(p.title || '').replace(/"/g, '""')}"`,
            `"${(p.organization?.name || p.organization_name || '').replace(/"/g, '""')}"`,
            `"${(p.email || p.email_status === 'verified' ? p.email : '').replace(/"/g, '""')}"`,
            `"${(p.linkedin_url || '').replace(/"/g, '""')}"`,
            `"${(p.city ? `${p.city}, ${p.state || p.country || ''}` : '').replace(/"/g, '""')}"`,
            `"${(p.seniority || '').replace(/"/g, '""')}"`,
        ].join(','));

        const csv = [headers.join(','), ...rows].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="apollo-leads.csv"');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
