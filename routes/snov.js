import crypto from 'crypto';
import express from 'express';
import SnovCache from '../models/SnovCache.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
import { PLANS as STRIPE_PLANS } from '../config/plans.js';

const router = express.Router();
const SNOV_BASE = 'https://api.snov.io';
const MAX_MONTHLY_CREDITS = 50;
const GENERIC_CATEGORY_PATTERN = /(saas|fintech|marketing|agency|founder|startup|healthcare|hrtech|e-?commerce|ai|artificial intelligence|cybersecurity|real estate|edtech|web3|crypto|consulting|manufacturing|retail|media)/i;
const CATEGORY_COMPANY_MAP = {
    saas: ['HubSpot', 'Salesforce', 'Atlassian', 'Zendesk'],
    fintech: ['Stripe', 'Plaid', 'Wise', 'Revolut'],
    'marketing agency': ['WPP', 'Publicis Groupe', 'Ogilvy', 'Dentsu'],
    marketing: ['HubSpot', 'Mailchimp', 'Klaviyo', 'Semrush'],
    healthcare: ['Teladoc', 'Pfizer', 'Moderna', 'Cerner'],
    ecommerce: ['Shopify', 'BigCommerce', 'WooCommerce', 'Amazon'],
    'e-commerce': ['Shopify', 'BigCommerce', 'WooCommerce', 'Amazon'],
    ai: ['OpenAI', 'Anthropic', 'Databricks', 'C3 AI'],
    cybersecurity: ['CrowdStrike', 'Cloudflare', 'Okta', 'Palo Alto Networks'],
    'real estate': ['Zillow', 'Compass', 'Redfin', 'CBRE'],
    edtech: ['Coursera', 'Udemy', 'Duolingo', 'Instructure'],
};

// ─── Plan definitions (monthly lead credits) ─────────────────────────────────
const PLAN_LIMITS = {
    starter: { leadsPerMonth: MAX_MONTHLY_CREDITS,      emailFindsPerMonth: MAX_MONTHLY_CREDITS,      bulkExport: false, advancedFilters: false },
    growth:  { leadsPerMonth: MAX_MONTHLY_CREDITS,      emailFindsPerMonth: MAX_MONTHLY_CREDITS,      bulkExport: false, advancedFilters: true  },
    agency:  { leadsPerMonth: MAX_MONTHLY_CREDITS,      emailFindsPerMonth: MAX_MONTHLY_CREDITS,      bulkExport: true,  advancedFilters: true  },
    none:    { leadsPerMonth: 0,                        emailFindsPerMonth: 0,                        bulkExport: false, advancedFilters: false },
};

const CACHE_TTLS = {
    peopleSearch: 24 * 60 * 60 * 1000,
    organizationSearch: 7 * 24 * 60 * 60 * 1000,
    domainSearch: 7 * 24 * 60 * 60 * 1000,
    emailVerify: 30 * 24 * 60 * 60 * 1000,
    peopleEnrich: 30 * 24 * 60 * 60 * 1000,
    linkedinEnrich: 30 * 24 * 60 * 60 * 1000,
    techCheck: 14 * 24 * 60 * 60 * 1000,
};

// ─── OAuth2 token cache ───────────────────────────────────────────────────────
let _tokenCache = { token: null, expiresAt: 0 };

async function getSnovToken() {
    if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) {
        return _tokenCache.token;
    }
    const res = await fetch(`${SNOV_BASE}/v1/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: process.env.SNOV_CLIENT_ID,
            client_secret: process.env.SNOV_CLIENT_SECRET,
        }),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
        throw new Error(data.error_description || 'Failed to authenticate with Snov.io');
    }
    // Cache with 5-minute buffer before expiry
    _tokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + ((data.expires_in || 3600) - 300) * 1000,
    };
    return _tokenCache.token;
}

// ─── Helper: call Snov.io API with form-encoded body (v1 endpoints) ─────────────
async function snovFetchForm(path, params = {}) {
    const token = await getSnovToken();
    const body = new URLSearchParams(params).toString();
    const res = await fetch(`${SNOV_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Bearer ${token}`,
        },
        body,
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
    if (!res.ok) {
        if (res.status === 401) {
            _tokenCache = { token: null, expiresAt: 0 };
            throw new Error('Snov.io authentication failed. Please try again.');
        }
        const msg = data.error || data.message || data.error_description || `Snov.io API error (${res.status})`;
        throw new Error(msg);
    }
    return data;
}

// ─── Helper: call Snov.io API from server ─────────────────────────────────────
async function snovFetch(path, options = {}) {
    const token = await getSnovToken();
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
    const res = await fetch(`${SNOV_BASE}${path}`, { ...options, headers });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }

    if (!res.ok) {
        if (res.status === 401) {
            _tokenCache = { token: null, expiresAt: 0 };
            throw new Error('Snov.io authentication failed. Please try again.');
        }
        const msg = data.error || data.message || data.error_description || data?.errors?.title || `Snov.io API error (${res.status})`;
        throw new Error(msg);
    }
    return data;
}

async function snovFetchUrl(url, options = {}) {
    const token = await getSnovToken();
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }

    if (!res.ok) {
        if (res.status === 401) {
            _tokenCache = { token: null, expiresAt: 0 };
            throw new Error('Snov.io authentication failed. Please try again.');
        }
        const msg = data.error || data.message || data.error_description || data?.errors?.title || `Snov.io API error (${res.status})`;
        throw new Error(msg);
    }
    return data;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollSnovResult(resultUrl, attempts = 5, intervalMs = 1200) {
    let latest = null;
    for (let i = 0; i < attempts; i += 1) {
        latest = await snovFetchUrl(resultUrl);
        const status = String(latest?.status || '').toLowerCase().replace(/\s+/g, '_');
        if (!status || status === 'completed') return latest;
        if (status !== 'in_progress') return latest;
        if (i < attempts - 1) await sleep(intervalMs);
    }
    return latest || {};
}

// ─── Shared helper: fetch company info for a normalised domain ────────────────
async function getCompanyInfoForDomain(normalizedDomain, { attempts = 6, intervalMs = 1500 } = {}) {
    try {
        const startRes = await snovFetch('/v2/domain-search/start', {
            method: 'POST',
            body: JSON.stringify({ domain: normalizedDomain }),
        });
        const taskHash = startRes?.meta?.task_hash;
        if (!taskHash) return null;
        const resultUrl = `${SNOV_BASE}/v2/domain-search/result/${taskHash}`;
        const result = await pollSnovResult(resultUrl, attempts, intervalMs);
        if (!result?.data) return null;
        const d = result.data;
        return {
            name:            d.company_name || null,
            city:            d.city || null,
            founded:         d.founded || null,
            industry:        d.industry || null,
            size:            d.size || null,
            website:         d.website || normalizedDomain,
            hq_phone:        d.hq_phone || null,
            related_domains: d.related_domains || [],
            prospects_count: result.meta?.prospects_count ?? null,
            emails_count:    result.meta?.emails_count ?? null,
            generic_count:   result.meta?.generic_contacts_count ?? null,
        };
    } catch { return null; }
}

function splitCsvLike(value) {
    const raw = Array.isArray(value) ? value.join(',') : String(value || '');
    return raw
        .split(/[;,]/g)
        .map(v => v.trim().replace(/[.]+$/g, ''))
        .filter(Boolean);
}

function normalizeLocations(value) {
    return splitCsvLike(value).slice(0, 10);
}

function normalizeCacheString(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeCacheList(values, { sort = true } = {}) {
    const list = (Array.isArray(values) ? values : splitCsvLike(values))
        .map(normalizeCacheString)
        .filter(Boolean);
    const unique = Array.from(new Set(list));
    return sort ? unique.sort() : unique;
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }

    return JSON.stringify(value);
}

function buildCacheKey(type, input) {
    return crypto.createHash('sha256').update(`${type}:${stableStringify(input)}`).digest('hex');
}

async function getCachedSnovData(userId, type, input) {
    const key = buildCacheKey(type, input);
    const now = new Date();
    const entry = await SnovCache.findOne({ user: userId, type, key, expiresAt: { $gt: now } }).lean();

    if (!entry) return null;

    await SnovCache.updateOne({ _id: entry._id }, {
        $inc: { hitCount: 1 },
        $set: { lastAccessedAt: now },
    });

    return entry.data;
}

async function setCachedSnovData(userId, type, input, data) {
    const key = buildCacheKey(type, input);
    const now = new Date();
    const ttlMs = CACHE_TTLS[type] || (24 * 60 * 60 * 1000);
    const expiresAt = new Date(now.getTime() + ttlMs);

    await SnovCache.findOneAndUpdate(
        { user: userId, type, key },
        {
            user: userId,
            type,
            key,
            input,
            data,
            expiresAt,
            lastAccessedAt: now,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );
}

function expandKeywordToCompanies(value) {
    const terms = splitCsvLike(value);
    const mapped = [];

    for (const term of terms) {
        const lower = term.toLowerCase();
        for (const [category, companies] of Object.entries(CATEGORY_COMPANY_MAP)) {
            if (lower.includes(category)) mapped.push(...companies);
        }
    }

    const directCompanyNames = terms.filter((term) => {
        if (!GENERIC_CATEGORY_PATTERN.test(term)) return true;
        return /\b(inc|llc|ltd|corp|group|technologies|systems|labs|networks)\b/i.test(term);
    });

    const fallback = terms;
    return Array.from(new Set([...
        mapped,
        ...directCompanyNames,
        ...fallback,
    ])).slice(0, 10);
}

function normalizeEmailVerificationRows(statusData, requestedEmails = []) {
    if (!statusData || typeof statusData !== 'object') return [];

    // Some Snov responses use arrays.
    const arrayRows = statusData.emails || statusData.data;
    if (Array.isArray(arrayRows)) {
        const byEmail = new Map(arrayRows
            .filter(r => r && r.email)
            .map(r => [String(r.email).toLowerCase(), {
                email: r.email,
                status: String(r.status || r.emailStatus || 'unknown').toLowerCase(),
                free_email: r.freeEmail ?? r.free_email ?? null,
            }]));

        return requestedEmails.map((email) => byEmail.get(String(email).toLowerCase()) || {
            email,
            status: 'unknown',
            free_email: null,
        });
    }

    // Newer/alternate Snov response can be keyed by email address.
    const keyedRows = requestedEmails.map((email) => {
        const row = statusData[email] || statusData[String(email).toLowerCase()] || statusData[String(email).toUpperCase()];
        const identifier = row?.status?.identifier || row?.status || 'unknown';
        return {
            email,
            status: String(identifier).toLowerCase(),
            free_email: row?.freeEmail ?? row?.free_email ?? null,
        };
    });

    return keyedRows;
}

// ─── Helper: get user's plan + reset usage if month rolled over ───────────────
async function getUserPlanData(userId) {
    const user = await User.findById(userId).select('snovPlan snovUsage snovCustomLimits subscription credits');
    if (!user) throw new Error('User not found');

    // ─── Prefer new Stripe subscription credits ───────────────────────────────
    const subPlan   = user.subscription?.plan;
    const subStatus = user.subscription?.status;
    const hasActiveSub = subStatus === 'active' || subStatus === 'trialing';

    if (hasActiveSub && subPlan && STRIPE_PLANS[subPlan]) {
        const stripePlan = STRIPE_PLANS[subPlan];
        const snovCredits = user.credits?.snov ?? 0;

        // Auto-reset credits if past reset date
        const now = new Date();
        if (user.credits?.resetDate && now >= new Date(user.credits.resetDate)) {
            const nextReset = new Date(user.subscription?.currentPeriodEnd || now);
            await User.findByIdAndUpdate(userId, {
                'credits.snov':      stripePlan.snovCredits,
                'credits.publer':    stripePlan.publerCredits,
                'credits.resetDate': nextReset,
            });
            return {
                user,
                plan:   subPlan,
                limits: {
                    leadsPerMonth:      stripePlan.snovCredits,
                    emailFindsPerMonth: stripePlan.snovCredits,
                    bulkExport:         subPlan === 'agency',
                    advancedFilters:    subPlan !== 'starter',
                },
                usage: {
                    leadsThisMonth:      0,
                    emailFindsThisMonth: 0,
                    resetDate:           nextReset,
                },
            };
        }

        // leadsThisMonth = initial credits − remaining credits
        const initialCredits = stripePlan.snovCredits;
        const leadsUsed = Math.max(0, initialCredits - snovCredits);

        return {
            user,
            plan:   subPlan,
            limits: {
                leadsPerMonth:      initialCredits,
                emailFindsPerMonth: initialCredits,
                bulkExport:         subPlan === 'agency',
                advancedFilters:    subPlan !== 'starter',
            },
            usage: {
                leadsThisMonth:      leadsUsed,
                emailFindsThisMonth: leadsUsed,
                resetDate:           user.credits?.resetDate || user.subscription?.currentPeriodEnd,
            },
        };
    }

    // ─── Fall back to legacy snovPlan system ─────────────────────────────────
    const now = new Date();
    if (user.snovUsage?.resetDate && now >= new Date(user.snovUsage.resetDate)) {
        const nextReset = new Date(now);
        nextReset.setDate(1);
        nextReset.setMonth(nextReset.getMonth() + 1);
        user.snovUsage = { leadsThisMonth: 0, emailFindsThisMonth: 0, resetDate: nextReset };
        await user.save();
    }

    const plan = user.snovPlan || 'none';
    const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.none;

    let limits;
    if (user.snovCustomLimits?.enabled) {
        limits = {
            leadsPerMonth:      Math.min(user.snovCustomLimits.leadsPerMonth ?? 0, MAX_MONTHLY_CREDITS * 10),
            emailFindsPerMonth: Math.min(user.snovCustomLimits.emailFindsPerMonth ?? 0, MAX_MONTHLY_CREDITS * 10),
            bulkExport:         planLimits.bulkExport,
            advancedFilters:    planLimits.advancedFilters,
        };
    } else {
        limits = planLimits;
    }

    const usage = {
        leadsThisMonth:      user.snovUsage?.leadsThisMonth      || 0,
        emailFindsThisMonth: user.snovUsage?.emailFindsThisMonth || 0,
        resetDate:           user.snovUsage?.resetDate,
    };

    return { user, plan, limits, usage };
}

// ─── Helper: increment lead search usage ────────────────────────────────────
async function incrementUsage(userId, count = 1) {
    const user = await User.findById(userId).select('subscription credits');
    const hasActiveSub = user?.subscription?.status === 'active' || user?.subscription?.status === 'trialing';

    if (hasActiveSub && user?.credits?.snov !== undefined) {
        // Stripe-based: deduct from credits
        await User.findByIdAndUpdate(userId, {
            $inc: { 'credits.snov': -count },
        });
    } else {
        // Legacy: increment usage counter
        await User.findByIdAndUpdate(userId, {
            $inc: { 'snovUsage.leadsThisMonth': count },
        });
    }
}

// ─── Helper: increment email find usage ──────────────────────────────────────
async function incrementEmailUsage(userId, count = 1) {
    const user = await User.findById(userId).select('subscription credits');
    const hasActiveSub = user?.subscription?.status === 'active' || user?.subscription?.status === 'trialing';

    if (hasActiveSub && user?.credits?.snov !== undefined) {
        await User.findByIdAndUpdate(userId, {
            $inc: { 'credits.snov': -count },
        });
    } else {
        await User.findByIdAndUpdate(userId, {
            $inc: { 'snovUsage.emailFindsThisMonth': count },
        });
    }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// @desc  Get user's Snov.io plan, limits and usage
// @route GET /api/snov/plan
// @access Private
router.get('/plan', protect, async (req, res) => {
    try {
        const { plan, limits, usage } = await getUserPlanData(req.user._id);
        res.json({ plan, limits, usage, configured: plan !== 'none' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Get current user's Snov.io usage summary
// @route GET /api/snov/usage
// @access Private
router.get('/usage', protect, async (req, res) => {
    try {
        const { plan, limits, usage } = await getUserPlanData(req.user._id);
        res.json({ plan, limits, usage });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Search for people/leads with filters
// @route POST /api/snov/people/search
// @access Private
router.post('/people/search', protect, async (req, res) => {
    try {
        const { plan, limits, usage } = await getUserPlanData(req.user._id);

        if (plan === 'none') {
            return res.status(403).json({
                message: 'An active subscription is required for lead generation. Visit the Pricing page to get started.',
                upgradeRequired: true,
            });
        }

        const {
            q_keywords,
            person_titles,
            person_seniorities,
            organization_industries,
            organization_num_employees_ranges,
            person_locations,
            page = 1,
            per_page = 25,
        } = req.body;

        const keywordCandidates = expandKeywordToCompanies(q_keywords);
        const normalizedLocations = normalizeLocations(person_locations);
        const requestedPerPage = Math.max(1, Math.min(Number(per_page) || 25, 25));

        const peopleSearchCacheInput = {
            q_keywords: normalizeCacheList(keywordCandidates),
            person_titles: normalizeCacheList(person_titles),
            person_seniorities: normalizeCacheList(person_seniorities),
            organization_industries: normalizeCacheList(organization_industries),
            organization_num_employees_ranges: normalizeCacheList(organization_num_employees_ranges),
            person_locations: normalizeCacheList(normalizedLocations),
            page: Number(page) || 1,
            per_page: requestedPerPage,
        };

        const cachedPeopleSearch = await getCachedSnovData(req.user._id, 'peopleSearch', peopleSearchCacheInput);
        if (cachedPeopleSearch) {
            return res.json({
                ...cachedPeopleSearch,
                usage,
                limits,
                cached: true,
            });
        }

        if (usage.leadsThisMonth >= limits.leadsPerMonth) {
            return res.status(429).json({
                message: `Monthly lead limit reached (${limits.leadsPerMonth} leads). Upgrade your plan or wait for next month.`,
                usage,
                limits,
            });
        }

        const remainingLeads = Math.max((limits.leadsPerMonth || 0) - (usage.leadsThisMonth || 0), 0);
        if (remainingLeads <= 0) {
            return res.status(429).json({
                message: `Monthly lead limit reached (${limits.leadsPerMonth} leads). Upgrade your plan or wait for next month.`,
                usage,
                limits,
            });
        }

        const safePerPage = Math.max(1, Math.min(requestedPerPage, remainingLeads));

        // Advanced-filter-only fields — block if plan doesn't allow them
        if (!limits.advancedFilters && (
            organization_industries?.length ||
            organization_num_employees_ranges?.length ||
            person_seniorities?.length
        )) {
            return res.status(403).json({
                message: 'Advanced filters (industry, seniority, company size) require a Growth or Agency plan.',
            });
        }

        // Snov.io v2 API: company-domain-by-name → domain-search/prospects
        // (v1/prospector was removed from the latest Snov.io API)
        const nameCandidates = keywordCandidates;

        if (nameCandidates.length === 0) {
            return res.status(400).json({
                message: 'People Search requires keyword company names (comma-separated).',
            });
        }

        const domainStart = await snovFetch('/v2/company-domain-by-name/start', {
            method: 'POST',
            body: JSON.stringify({ names: nameCandidates }),
        });

        const domainTaskHash = domainStart?.data?.task_hash;
        const domainResultUrl = domainTaskHash ? `${SNOV_BASE}/v2/company-domain-by-name/result?task_hash=${domainTaskHash}` : null;
        const domainResult = domainResultUrl ? await pollSnovResult(domainResultUrl) : { data: [] };

        const domains = Array.from(new Set((domainResult?.data || [])
            .map(item => item?.result?.domain)
            .filter(Boolean)))
            .slice(0, 3);

        if (domains.length === 0) {
            const emptyResponse = {
                people: [],
                pagination: { total_entries: 0, total_pages: 0, current_page: page },
            };
            await setCachedSnovData(req.user._id, 'peopleSearch', peopleSearchCacheInput, emptyResponse);
            return res.json({ ...emptyResponse, usage, limits });
        }

        const prospects = [];
        for (const domain of domains) {
            const start = await snovFetch('/v2/domain-search/prospects/start', {
                method: 'POST',
                body: JSON.stringify({
                    domain,
                    page,
                    positions: person_titles?.length ? person_titles.slice(0, 10) : undefined,
                }),
            });
            const resultUrl = start?.links?.result;
            if (!resultUrl) continue;
            const result = await pollSnovResult(resultUrl);
            prospects.push(...(result?.data || []).map(p => ({ ...p, __domain: domain })));
        }

        const locationNeedles = normalizedLocations.map(v => String(v).toLowerCase());
        const filteredProspects = prospects.filter((p) => {
            if (!locationNeedles.length) return true;
            const hay = String(p.location || p.country || '').toLowerCase();
            if (!hay) return true;
            return locationNeedles.some(n => hay.includes(n));
        }).slice(0, safePerPage);

        const people = filteredProspects.map(p => ({
            id: p.id || `${p.first_name || p.firstName || ''}-${p.last_name || p.lastName || ''}-${p.__domain || ''}`,
            name: p.name || `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim(),
            first_name: p.first_name || p.firstName,
            last_name: p.last_name || p.lastName,
            title: p.position || p.title || null,
            organization_name: p.company || p.company_name || p.__domain || null,
            organization: {
                name: p.company || p.company_name || p.__domain || null,
                website_url: p.__domain ? `https://${p.__domain}` : null,
                industry: p.industry || null,
            },
            city: null,
            state: null,
            country: p.country || p.location || null,
            seniority: p.seniority || null,
            email_status: null,
            linkedin_url: p.source_page || p.linkedin_url || null,
            photo_url: null,
        }));

        const returnedCount = people.length;
        if (returnedCount > 0) await incrementUsage(req.user._id, returnedCount);

        const responsePayload = {
            people,
            pagination: {
                total_entries: people.length,
                total_pages: Math.ceil(people.length / safePerPage),
                current_page: page,
            },
        };
        await setCachedSnovData(req.user._id, 'peopleSearch', peopleSearchCacheInput, responsePayload);

        res.json({
            ...responsePayload,
            usage: { ...usage, leadsThisMonth: usage.leadsThisMonth + returnedCount },
            limits,
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Find verified email for a person by first name, last name and domain
// @route POST /api/snov/people/enrich
// @access Private
router.post('/people/enrich', protect, async (req, res) => {
    try {
        const { plan, limits, usage } = await getUserPlanData(req.user._id);

        if (plan === 'none') {
            return res.status(403).json({ message: 'Lead generation plan not configured. Contact your admin.' });
        }

        const { first_name, last_name, domain, organization_name, linkedin_url } = req.body;

        const enrichCacheInput = linkedin_url
            ? { linkedin_url: normalizeCacheString(linkedin_url) }
            : {
                first_name: normalizeCacheString(first_name),
                last_name: normalizeCacheString(last_name),
                domain: normalizeCacheString(domain),
            };

        const cachedEnrich = await getCachedSnovData(req.user._id, 'peopleEnrich', enrichCacheInput);
        if (cachedEnrich) {
            return res.json({ ...cachedEnrich, usage, limits, cached: true });
        }

        if (usage.emailFindsThisMonth >= limits.emailFindsPerMonth) {
            return res.status(429).json({
                message: `Monthly email find limit reached (${limits.emailFindsPerMonth}). Upgrade your plan.`,
                usage,
                limits,
            });
        }

        if (linkedin_url) {
            // Snov.io v2 requires https://linkedin.com/in/ (no www, no trailing slash)
            const cleanLinkedinUrl = linkedin_url.trim()
                .replace(/^(https?:\/\/)www\.linkedin\.com/i, '$1linkedin.com')
                .replace(/\/+$/, '')

            let emailResult = null;
            try {
                // Latest Snov.io API: async li-profiles-by-urls flow (returns profile + positions)
                const liStart = await snovFetch('/v2/li-profiles-by-urls/start', {
                    method: 'POST',
                    body: JSON.stringify({ urls: [cleanLinkedinUrl] }),
                });
                const liTaskHash = liStart?.data?.task_hash;
                if (liTaskHash) {
                    const liResult = await pollSnovResult(
                        `${SNOV_BASE}/v2/li-profiles-by-urls/result?task_hash=${liTaskHash}`,
                        8, 1500,
                    );
                    const profileData = liResult?.data?.[0]?.result;
                    if (profileData && (profileData.email || profileData.emails?.length)) {
                        const bestEmail = profileData.email || profileData.emails?.[0]?.email;
                        emailResult = {
                            email: bestEmail,
                            emailStatus: profileData.email_status || profileData.emails?.[0]?.smtp_status || 'guessed',
                            companyName: profileData.positions?.[0]?.name || organization_name || null,
                        };
                    }
                }
            } catch { /* fall through to legacy endpoint */ }

            // Fallback: legacy profile-emails-finder (still works on some plans)
            if (!emailResult) {
                try {
                    const legacyData = await snovFetch('/v2/profile-emails-finder', {
                        method: 'POST',
                        body: JSON.stringify({ linkedInUrl: cleanLinkedinUrl }),
                    });
                    if (legacyData?.data?.email) {
                        emailResult = {
                            email: legacyData.data.email,
                            emailStatus: legacyData.data.emailStatus || 'guessed',
                            companyName: legacyData.data.companyName || organization_name || null,
                        };
                    }
                } catch (snovErr) {
                    const msg = snovErr.message;
                    if (!/not found|entity|no email|unavailable/i.test(msg)) throw snovErr;
                }
            }

            const payload = emailResult?.email ? {
                person: {
                    email: emailResult.email,
                    email_status: emailResult.emailStatus === 'valid' ? 'verified' : (emailResult.emailStatus || 'guessed'),
                    linkedin_url,
                    organization: { name: emailResult.companyName || organization_name || null },
                },
            } : { person: null };

            if (payload.person) await incrementEmailUsage(req.user._id, 1);
            await setCachedSnovData(req.user._id, 'peopleEnrich', enrichCacheInput, payload);
            return res.json({
                ...payload,
                usage: { ...usage, emailFindsThisMonth: usage.emailFindsThisMonth + (payload.person ? 1 : 0) },
                limits,
            });
        }

        if (!domain) {
            return res.status(400).json({ message: 'Provide the company domain (e.g. company.com) or a LinkedIn URL to enrich this contact.' });
        }

        const enrichStart = await snovFetch('/v2/emails-by-domain-by-name/start', {
            method: 'POST',
            body: JSON.stringify({ rows: [{ first_name: first_name || '', last_name: last_name || '', domain }] }),
        });

        const enrichTaskHash = enrichStart?.data?.task_hash;
        let emails = [];
        if (enrichTaskHash) {
            const enrichResult = await pollSnovResult(
                `${SNOV_BASE}/v2/emails-by-domain-by-name/result?task_hash=${enrichTaskHash}`,
                8,
                1500,
            );
            emails = enrichResult?.data?.[0]?.result || [];
        }

        const bestEmail = emails.find(e => e.smtp_status === 'valid') || emails[0];

        const person = emails.length > 0 ? {
            email: bestEmail?.email || null,
            email_status: bestEmail?.smtp_status === 'valid' ? 'verified' : (bestEmail?.smtp_status === 'not_valid' ? 'invalid' : 'guessed'),
            linkedin_url: linkedin_url || null,
            organization: { name: organization_name },
        } : null;

        if (person) await incrementEmailUsage(req.user._id, 1);

        const responsePayload = { person };
        await setCachedSnovData(req.user._id, 'peopleEnrich', enrichCacheInput, responsePayload);

        res.json({
            ...responsePayload,
            usage: { ...usage, emailFindsThisMonth: usage.emailFindsThisMonth + (person ? 1 : 0) },
            limits,
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Search organisations / companies
// @route POST /api/snov/organizations/search
// @access Private
router.post('/organizations/search', protect, async (req, res) => {
    try {
        const { plan, limits } = await getUserPlanData(req.user._id);

        if (plan === 'none') {
            return res.status(403).json({ message: 'Lead generation plan not configured. Contact your admin.' });
        }

        const { q_organization_name } = req.body;

        if (!q_organization_name) {
            return res.status(400).json({ message: 'Company name or domain is required for organization search.' });
        }

        const inputTrimmed = q_organization_name.trim();
        // Detect if input is a domain (e.g. "hubspot.com") vs a company name ("HubSpot")
        const looksLikeDomain = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(inputTrimmed) && !inputTrimmed.includes(' ');

        let organizations = [];

        if (looksLikeDomain) {
            // Direct domain enrichment — no need for company-domain-by-name step
            const domain = inputTrimmed.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
            const cacheInput = { domain };
            const cached = await getCachedSnovData(req.user._id, 'organizationSearch', cacheInput);
            if (cached) return res.json({ ...cached, cached: true });

            const info = await getCompanyInfoForDomain(domain, { attempts: 6, intervalMs: 1500 });
            organizations = info ? [{ domain, ...info }] : [];

            const responsePayload = { organizations, pagination: {} };
            await setCachedSnovData(req.user._id, 'organizationSearch', cacheInput, responsePayload);
            return res.json(responsePayload);
        }

        // Company name lookup → domain → enrichment
        const names = expandKeywordToCompanies(inputTrimmed);
        const orgSearchCacheInput = { names: normalizeCacheList(names) };
        const cachedOrganizations = await getCachedSnovData(req.user._id, 'organizationSearch', orgSearchCacheInput);
        if (cachedOrganizations) {
            return res.json({ ...cachedOrganizations, cached: true });
        }

        const start = await snovFetch('/v2/company-domain-by-name/start', {
            method: 'POST',
            body: JSON.stringify({ names }),
        });

        const taskHash = start?.data?.task_hash;
        const resultUrl = taskHash ? `${SNOV_BASE}/v2/company-domain-by-name/result?task_hash=${taskHash}` : null;
        const result = resultUrl ? await pollSnovResult(resultUrl) : { data: [] };

        // Get domains from result, then enrich each with company info in parallel
        const domains = (result?.data || [])
            .map(item => item?.result?.domain)
            .filter(Boolean)
            .slice(0, 5);

        organizations = await Promise.all(
            domains.map(async (domain) => {
                const info = await getCompanyInfoForDomain(domain, { attempts: 5, intervalMs: 1200 });
                return info
                    ? { domain, ...info }
                    : { domain, name: domain, website: domain };
            })
        );

        const responsePayload = { organizations, pagination: {} };
        await setCachedSnovData(req.user._id, 'organizationSearch', orgSearchCacheInput, responsePayload);
        res.json(responsePayload);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Get saved lead lists
// @route GET /api/snov/lists
// @access Private
router.get('/lists', protect, async (req, res) => {
    try {
        const { plan } = await getUserPlanData(req.user._id);

        if (plan === 'none') {
            return res.status(403).json({ message: 'Lead generation plan not configured. Contact your admin.' });
        }

        const data = await snovFetch('/v1/get-user-lists');
        res.json({ lists: Array.isArray(data) ? data.filter(l => !l.isDeleted) : [] });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Create a new saved list
// @route POST /api/snov/lists
// @access Private
router.post('/lists', protect, async (req, res) => {
    try {
        const { plan } = await getUserPlanData(req.user._id);
        if (plan === 'none') return res.status(403).json({ message: 'Lead generation plan not configured.' });

        const { name } = req.body;
        if (!name) return res.status(400).json({ message: 'List name is required.' });

        // v1 endpoint requires form-encoded body
        const data = await snovFetchForm('/v1/lists', { name });
        // Response: [{ success: true, data: { id } }]
        const result = Array.isArray(data) ? data[0] : data;
        res.json({ list: { id: result?.data?.id, name } });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Domain search — prospects (people), personal emails, generic emails + company info
// @route POST /api/snov/domain/search
// @access Private
router.post('/domain/search', protect, async (req, res) => {
    try {
        const { plan } = await getUserPlanData(req.user._id);
        if (plan === 'none') return res.status(403).json({ message: 'Lead generation plan not configured.' });

        const { domain, type = 'all' } = req.body;
        if (!domain) return res.status(400).json({ message: 'Domain is required (e.g. company.com).' });

        const normalizedDomain = String(domain).trim()
            .replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase();

        const domainSearchCacheInput = { domain: normalizedDomain, type: normalizeCacheString(type) || 'all' };
        const cachedDomainSearch = await getCachedSnovData(req.user._id, 'domainSearch', domainSearchCacheInput);
        if (cachedDomainSearch) {
            return res.json({ ...cachedDomainSearch, cached: true });
        }

        let company      = null;
        let prospects    = [];
        const personalEmails = [];
        const genericEmails  = [];

        // Helper: fetch one async-task endpoint and collect email rows
        const fetchEmailTask = async (endpoint, bucket) => {
            try {
                const startRes = await snovFetch(endpoint, {
                    method: 'POST',
                    body: JSON.stringify({ domain: normalizedDomain }),
                });
                const resultUrl = startRes?.links?.result;
                if (!resultUrl) return;
                const result = await pollSnovResult(resultUrl, 6, 1500);
                for (const item of (result?.data || [])) {
                    if (item?.email) {
                        bucket.push({
                            value:        item.email,
                            email_status: item.email_status || item.smtp_status || 'unknown',
                            first_name:   item.first_name  || null,
                            last_name:    item.last_name   || null,
                            confidence:   item.confidence  ?? null,
                        });
                    }
                }
            } catch { /* non-fatal */ }
        };

        // Helper: fetch domain prospects (people with name + position)
        const fetchProspects = async () => {
            try {
                const startRes = await snovFetch('/v2/domain-search/prospects/start', {
                    method: 'POST',
                    body: JSON.stringify({ domain: normalizedDomain }),
                });
                const resultUrl = startRes?.links?.result;
                if (!resultUrl) return;
                const result = await pollSnovResult(resultUrl, 7, 1500);
                prospects = (result?.data || []).map(p => ({
                    id:         p.id   || null,
                    first_name: p.first_name  || p.firstName  || null,
                    last_name:  p.last_name   || p.lastName   || null,
                    name:       p.name || `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim(),
                    position:   p.position || p.title || null,
                })).filter(p => p.name?.trim());
            } catch { /* non-fatal */ }
        };

        // Run everything in parallel
        const tasks = [
            getCompanyInfoForDomain(normalizedDomain, { attempts: 6, intervalMs: 1500 }).then(info => { company = info; }).catch(() => {}),
            fetchProspects(),
        ];
        if (type === 'personal' || type === 'all') {
            tasks.push(fetchEmailTask('/v2/domain-search/domain-emails/start', personalEmails));
        }
        if (type === 'generic' || type === 'all') {
            tasks.push(fetchEmailTask('/v2/domain-search/generic-contacts/start', genericEmails));
        }
        await Promise.all(tasks);

        const responsePayload = {
            domain:         normalizedDomain,
            company,
            prospects,
            personal_emails: personalEmails,
            generic_emails:  genericEmails,
            // backward-compat combined list
            emails: [...personalEmails, ...genericEmails],
            meta: {
                total:            personalEmails.length + genericEmails.length,
                personal_count:   personalEmails.length,
                generic_count:    genericEmails.length,
                prospects_count:  prospects.length,
            },
        };
        await setCachedSnovData(req.user._id, 'domainSearch', domainSearchCacheInput, responsePayload);
        res.json(responsePayload);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Verify email deliverability status
// @route POST /api/snov/email/verify
// @access Private
router.post('/email/verify', protect, async (req, res) => {
    try {
        const { plan } = await getUserPlanData(req.user._id);
        if (plan === 'none') return res.status(403).json({ message: 'Lead generation plan not configured.' });

        const { emails } = req.body;
        if (!Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({ message: 'Provide an array of email addresses to verify.' });
        }
        if (emails.length > 10) {
            return res.status(400).json({ message: 'You can verify up to 10 emails per request.' });
        }

        const normalizedEmails = Array.from(new Set(emails.map(normalizeCacheString).filter(Boolean)));
        const cachedResults = [];
        const missingEmails = [];

        for (const email of normalizedEmails) {
            const cached = await getCachedSnovData(req.user._id, 'emailVerify', { email });
            if (cached) cachedResults.push(cached);
            else missingEmails.push(email);
        }

        if (missingEmails.length === 0) {
            return res.json({ results: normalizedEmails.map(email => cachedResults.find(r => r.email === email)).filter(Boolean), cached: true });
        }

        // Use Snov.io v2 Email Verification API (async task-based)
        const verifyStart = await snovFetch('/v2/email-verification/start', {
            method: 'POST',
            body: JSON.stringify({ emails: missingEmails }),
        });

        const verifyTaskHash = verifyStart?.data?.task_hash;
        let fetchedResults = [];
        if (verifyTaskHash) {
            const verifyResult = await pollSnovResult(
                `${SNOV_BASE}/v2/email-verification/result?task_hash=${verifyTaskHash}`,
                8,
                1500,
            );
            fetchedResults = (verifyResult?.data || []).map(item => {
                const r = item?.result || {};
                let status = 'unknown';
                if (r.smtp_status === 'valid') status = 'valid';
                else if (r.smtp_status === 'not_valid') status = 'invalid';
                else if (r.is_disposable) status = 'disposable';
                return {
                    email: item.email,
                    status,
                    free_email: r.is_webmail ?? null,
                };
            });
        } else {
            fetchedResults = missingEmails.map(email => ({ email, status: 'unknown', free_email: null }));
        }

        // Keep a consistent response shape for frontend.
        const normalised = fetchedResults.map(r => ({
            email: r.email,
            status: r.status || 'unknown',
            free_email: r.free_email ?? r.freeEmail ?? null,
        }));

        for (const row of normalised) {
            await setCachedSnovData(req.user._id, 'emailVerify', { email: normalizeCacheString(row.email) }, row);
        }

        const combinedByEmail = new Map([...cachedResults, ...normalised].map(row => [normalizeCacheString(row.email), row]));

        res.json({
            results: normalizedEmails.map(email => combinedByEmail.get(email)).filter(Boolean),
            cached: cachedResults.length > 0,
        });
    } catch (err) {
        const msg = String(err.message || '');
        if (msg.includes('permissions for this action') || msg.includes('API error (403)')) {
            return res.status(403).json({
                message: 'Email verification is not enabled for your current Snov.io account plan. Please upgrade in Snov.io to use Email Verifier.',
            });
        }
        res.status(500).json({ message: err.message });
    }
});

// @desc  Find email by LinkedIn profile URL
// @route POST /api/snov/email/find-by-linkedin
// @access Private
router.post('/email/find-by-linkedin', protect, async (req, res) => {
    try {
        const { plan, limits, usage } = await getUserPlanData(req.user._id);
        if (plan === 'none') return res.status(403).json({ message: 'Lead generation plan not configured.' });

        const { linkedin_url } = req.body;
        if (!linkedin_url) return res.status(400).json({ message: 'LinkedIn URL is required.' });

        // Snov.io v2 requires https://linkedin.com/in/ (no www, no trailing slash)
        const cleanLinkedinUrl = linkedin_url.trim()
            .replace(/^(https?:\/\/)www\.linkedin\.com/i, '$1linkedin.com')
            .replace(/\/+$/, '')

        const linkedinCacheInput = { linkedin_url: normalizeCacheString(cleanLinkedinUrl) };
        const cachedLinkedin = await getCachedSnovData(req.user._id, 'linkedinEnrich', linkedinCacheInput);
        if (cachedLinkedin) {
            return res.json({ data: cachedLinkedin, cached: true, usage, limits });
        }

        if (usage.emailFindsThisMonth >= limits.emailFindsPerMonth) {
            return res.status(429).json({ message: `Monthly email find limit reached (${limits.emailFindsPerMonth}).` });
        }

        let snovResult = null;
        try {
            // Latest Snov.io API: async li-profiles-by-urls flow
            const liStart = await snovFetch('/v2/li-profiles-by-urls/start', {
                method: 'POST',
                body: JSON.stringify({ urls: [cleanLinkedinUrl] }),
            });
            const liTaskHash = liStart?.data?.task_hash;
            if (liTaskHash) {
                const liResult = await pollSnovResult(
                    `${SNOV_BASE}/v2/li-profiles-by-urls/result?task_hash=${liTaskHash}`,
                    8, 1500,
                );
                const profileData = liResult?.data?.[0]?.result;
                if (profileData) {
                    const bestEmail = profileData.email || profileData.emails?.[0]?.email || null;
                    snovResult = { data: bestEmail ? {
                        email: bestEmail,
                        emailStatus: profileData.email_status || 'guessed',
                        companyName: profileData.positions?.[0]?.name || null,
                        name: profileData.name || null,
                        firstName: profileData.first_name || null,
                        lastName: profileData.last_name || null,
                        industry: profileData.industry || null,
                        country: profileData.country || null,
                    } : null };
                }
            }
        } catch { /* fall through to legacy endpoint */ }

        // Fallback: legacy profile-emails-finder
        if (!snovResult) {
            try {
                snovResult = await snovFetch('/v2/profile-emails-finder', {
                    method: 'POST',
                    body: JSON.stringify({ linkedInUrl: cleanLinkedinUrl }),
                });
            } catch (snovErr) {
                const msg = snovErr.message || '';
                if (/not found|entity|no email|unavailable/i.test(msg)) {
                    snovResult = { data: null };
                } else {
                    throw snovErr;
                }
            }
        }

        if (snovResult?.data?.email) await incrementEmailUsage(req.user._id, 1);
        await setCachedSnovData(req.user._id, 'linkedinEnrich', linkedinCacheInput, snovResult?.data || null);
        res.json({ data: snovResult?.data || null });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Add contacts to a Snov.io prospect list
// @route POST /api/snov/lists/:listId/contacts
// @access Private
router.post('/lists/:listId/contacts', protect, async (req, res) => {
    try {
        const { plan } = await getUserPlanData(req.user._id);
        if (plan === 'none') return res.status(403).json({ message: 'Lead generation plan not configured.' });

        const { contacts } = req.body; // array of { email, firstName, lastName, ... }
        if (!Array.isArray(contacts) || contacts.length === 0) {
            return res.status(400).json({ message: 'Provide an array of contacts.' });
        }

        const listId = req.params.listId;
        const results = [];
        for (const contact of contacts) {
            const params = { listId, ...contact };
            // remove undefined fields
            Object.keys(params).forEach(k => params[k] == null && delete params[k]);
            const r = await snovFetchForm('/v1/add-prospect-to-list', params);
            results.push(r);
        }
        res.json({ added: results.length, results });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Get contacts inside a saved list
// @route GET /api/snov/lists/:listId/contacts
// @access Private
router.get('/lists/:listId/contacts', protect, async (req, res) => {
    try {
        const { plan } = await getUserPlanData(req.user._id);
        if (plan === 'none') return res.status(403).json({ message: 'Lead generation plan not configured.' });

        const { page = 1, per_page = 50 } = req.query;
        // POST /v1/prospect-list with form params
        const data = await snovFetchForm('/v1/prospect-list', {
            listId: req.params.listId,
            page,
            perPage: per_page,
        });
        const prospects = data.prospects || [];
        res.json({ contacts: prospects, total: data.list?.contacts || prospects.length });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Technology checker — what tech stack does a domain use
// @route POST /api/snov/tech/check
// @access Private
router.post('/tech/check', protect, async (req, res) => {
    try {
        const { plan } = await getUserPlanData(req.user._id);
        if (plan === 'none') return res.status(403).json({ message: 'Lead generation plan not configured.' });

        let { url } = req.body;
        if (!url) return res.status(400).json({ message: 'Website URL is required.' });

        // Extract bare domain — Snov's technology-checker requires just the domain, not a full URL
        let raw = url.trim();
        if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
        let domain = raw;
        try { domain = new URL(raw).hostname.replace(/^www\./i, ''); } catch { /* keep */ }
        // Remove any path/query so we always send e.g. "hubspot.com"
        domain = domain.split('/')[0].toLowerCase();

        const techCacheInput = { url: domain };
        const cachedTech = await getCachedSnovData(req.user._id, 'techCheck', techCacheInput);
        if (cachedTech) {
            return res.json({ ...cachedTech, cached: true });
        }

        let data;
        try {
            // v1 endpoint uses form-encoded body; bare domain only (e.g. "hubspot.com")
            data = await snovFetchForm('/v1/technology-checker', { url: domain });
        } catch (snovErr) {
            const msg = snovErr.message || '';
            // Snov returns 404 when they have no crawl data for the domain — treat as empty result
            // Do NOT cache this so a later retry can still try the live API
            if (msg.toLowerCase().includes('url or entity not found') || msg.includes('404')) {
                return res.json({ domain, technologies: [], notInDatabase: true });
            }
            throw snovErr;
        }

        const technologies = data.data || data.technologies || [];
        const responsePayload = { domain: data.domain || domain, technologies };
        // Only cache when Snov actually returned technology data
        if (technologies.length > 0) {
            await setCachedSnovData(req.user._id, 'techCheck', techCacheInput, responsePayload);
        }
        res.json(responsePayload);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Bulk LinkedIn URL enrichment — find emails for multiple LinkedIn profiles
// @route POST /api/snov/linkedin/bulk-enrich
// @access Private
router.post('/linkedin/bulk-enrich', protect, async (req, res) => {
    try {
        const { plan, limits, usage } = await getUserPlanData(req.user._id);
        if (plan === 'none') return res.status(403).json({ message: 'Lead generation plan not configured.' });

        const { urls = [], listId } = req.body;
        if (!Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ message: 'Provide an array of LinkedIn profile URLs.' });
        }
        const MAX_URLS = 50;
        const cleanUrls = urls
            .map(u => String(u || '').trim()
                .replace(/^(https?:\/\/)www\.linkedin\.com/i, '$1linkedin.com')
                .replace(/\/+$/, ''))
            .filter(u => /linkedin\.com\/in\//i.test(u))
            .slice(0, MAX_URLS);

        if (cleanUrls.length === 0) {
            return res.status(400).json({ message: 'No valid LinkedIn profile URLs found (must contain linkedin.com/in/).' });
        }

        // Process in batches of 10 (Snov.io recommended)
        const BATCH = 10;
        const allResults = [];
        for (let i = 0; i < cleanUrls.length; i += BATCH) {
            const batch = cleanUrls.slice(i, i + BATCH);
            try {
                const liStart = await snovFetch('/v2/li-profiles-by-urls/start', {
                    method: 'POST',
                    body: JSON.stringify({ urls: batch }),
                });
                const taskHash = liStart?.data?.task_hash;
                if (!taskHash) continue;
                const liResult = await pollSnovResult(
                    `${SNOV_BASE}/v2/li-profiles-by-urls/result?task_hash=${taskHash}`,
                    10, 2000,
                );
                for (const item of (liResult?.data || [])) {
                    const p = item?.result || {};
                    const bestEmail = p.email || p.emails?.[0]?.email || null;
                    allResults.push({
                        linkedin_url: item.source || batch[allResults.length % batch.length] || null,
                        name:         p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || null,
                        first_name:   p.first_name || null,
                        last_name:    p.last_name  || null,
                        email:        bestEmail,
                        email_status: p.email_status || (bestEmail ? 'guessed' : null),
                        title:        p.positions?.[0]?.title || null,
                        company:      p.positions?.[0]?.name  || null,
                        country:      p.country || null,
                    });
                }
            } catch { /* non-fatal — continue with next batch */ }
        }

        // Auto-save to list if listId provided and emails were found
        if (listId) {
            const contactsToSave = allResults
                .filter(r => r.email)
                .map(r => ({
                    listId,
                    email:       r.email,
                    firstName:   r.first_name || '',
                    lastName:    r.last_name  || '',
                    position:    r.title      || '',
                    companyName: r.company    || '',
                    linkedIn:    r.linkedin_url || '',
                }));
            for (const contact of contactsToSave) {
                try {
                    const params = { ...contact };
                    Object.keys(params).forEach(k => params[k] == null && delete params[k]);
                    await snovFetchForm('/v1/add-prospect-to-list', params);
                } catch { /* non-fatal */ }
            }
        }

        res.json({ results: allResults, total: allResults.length, found: allResults.filter(r => r.email).length });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Get email drip campaigns with analytics
// @route GET /api/snov/campaigns
// @access Private
router.get('/campaigns', protect, async (req, res) => {
    try {
        const { plan } = await getUserPlanData(req.user._id);
        if (plan === 'none') return res.status(403).json({ message: 'Lead generation plan not configured.' });

        // GET /v1/get-user-campaigns — returns array of { id, campaign, list_id, status, created_at, updated_at, started_at, hash }
        const data = await snovFetch('/v1/get-user-campaigns');
        const raw = Array.isArray(data) ? data : (data.data || []);

        // Normalize response fields to consistent shape
        let campaigns = raw.map(c => ({
            ...c,
            name:       c.campaign || c.name || 'Untitled Campaign',
            status:     (c.status || 'Draft').toLowerCase(),
            created_at: c.created_at  ? new Date(c.created_at  * 1000).toISOString() : null,
            updated_at: c.updated_at  ? new Date(c.updated_at  * 1000).toISOString() : null,
            started_at: c.started_at  ? new Date(c.started_at  * 1000).toISOString() : null,
        }));

        // Enrich with analytics from /v2/statistics/campaign-analytics for all campaigns at once
        if (campaigns.length > 0) {
            try {
                const ids = campaigns.map(c => c.id).join(',');
                const todayStr = new Date().toISOString().slice(0, 10);
                const fromStr  = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
                const analyticsData = await snovFetch(
                    `/v2/statistics/campaign-analytics?campaign_id=${ids}&date_from=${fromStr}&date_to=${todayStr}`
                );
                // Map analytics by campaign_id if returned as array, else attach to all
                if (Array.isArray(analyticsData)) {
                    const byId = {};
                    analyticsData.forEach(a => { if (a.campaign_id) byId[a.campaign_id] = a; });
                    campaigns = campaigns.map(c => ({ ...c, stats: byId[c.id] || analyticsData[0] || null }));
                } else if (analyticsData && typeof analyticsData === 'object') {
                    // Single aggregated response — attach to all
                    const stats = {
                        sent:    analyticsData.emails_sent    ?? null,
                        opens:   analyticsData.email_opens    ?? null,
                        clicks:  analyticsData.link_clicks    ?? null,
                        replies: analyticsData.email_replies  ?? null,
                    };
                    campaigns = campaigns.map(c => ({ ...c, stats }));
                }
            } catch { /* analytics fetch failure is non-fatal */ }
        }

        res.json({ campaigns });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Get email account stats (sender reputation, sent, opens)
// @route GET /api/snov/email-accounts
// @access Private
router.get('/email-accounts', protect, async (req, res) => {
    try {
        const { plan } = await getUserPlanData(req.user._id);
        if (plan === 'none') return res.status(403).json({ message: 'Lead generation plan not configured.' });

        // /v2/email-accounts — returns email sender accounts if configured in Snov.io
        let data = { data: [] };
        try {
            data = await snovFetch('/v2/email-accounts');
        } catch {
            // endpoint may not be available on all plans — return empty
        }
        res.json({ accounts: data.data || [] });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Export leads as CSV (Agency plan only)
// @route POST /api/snov/export
// @access Private
router.post('/export', protect, async (req, res) => {
    try {
        const { limits } = await getUserPlanData(req.user._id);

        if (!limits.bulkExport) {
            return res.status(403).json({ message: 'Bulk export requires an Agency plan.' });
        }

        const { people } = req.body;
        if (!Array.isArray(people) || people.length === 0) {
            return res.status(400).json({ message: 'Provide an array of people to export.' });
        }

        const headers = ['Name', 'Title', 'Company', 'Email', 'LinkedIn', 'Location', 'Seniority'];
        const rows = people.map(p => [
            `"${(p.name || '').replace(/"/g, '""')}"`,
            `"${(p.title || '').replace(/"/g, '""')}"`,
            `"${(p.organization?.name || p.organization_name || '').replace(/"/g, '""')}"`,
            `"${(p.email || '').replace(/"/g, '""')}"`,
            `"${(p.linkedin_url || '').replace(/"/g, '""')}"`,
            `"${(p.country || p.city || '').replace(/"/g, '""')}"`,
            `"${(p.seniority || '').replace(/"/g, '""')}"`,
        ].join(','));

        const csv = [headers.join(','), ...rows].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="snov-leads.csv"');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
