import express from 'express';
import User from '../models/User.js';
import { protect, admin } from '../middleware/auth.js';
import { PLANS as STRIPE_PLANS } from '../config/plans.js';

const router = express.Router();
const AGENCY_ANALYTICS_API_URL = 'https://apirequest.app/query';

const PLAN_LIMITS = {
    none: {
        loginGrantsPerMonth: 0,
        keywordReadsPerMonth: 0,
        backlinkReadsPerMonth: 0,
    },
    starter: {
        loginGrantsPerMonth: 30,
        keywordReadsPerMonth: 25,
        backlinkReadsPerMonth: 10,
    },
    growth: {
        loginGrantsPerMonth: 120,
        keywordReadsPerMonth: 100,
        backlinkReadsPerMonth: 50,
    },
    agency: {
        loginGrantsPerMonth: 1000,
        keywordReadsPerMonth: 500,
        backlinkReadsPerMonth: 200,
    },
};

function nextResetDate() {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() + 1);
    return date;
}

function getApiKey() {
    return process.env.AGENCYANALYTICS_API_KEY || process.env.AGENCY_ANALYTICS_API_KEY || '';
}

function getDefaultLoginUrl() {
    return process.env.AGENCYANALYTICS_LOGIN_URL || 'https://app.agencyanalytics.com/login';
}

function getAuthHeader() {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('AgencyAnalytics API key is not configured on the server');
    return `Basic ${Buffer.from(`:${apiKey}`).toString('base64')}`;
}

async function agencyAnalyticsQuery(payload) {
    const res = await fetch(AGENCY_ANALYTICS_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': getAuthHeader(),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body */ }

    if (!res.ok) {
        const message = data?.error || data?.message || data?.errors?.[0] || `AgencyAnalytics API error (${res.status})`;
        throw new Error(message);
    }

    return data;
}

async function readRemoteAsset(asset, options = {}) {
    const response = await agencyAnalyticsQuery({
        provider: 'agency-analytics-v2',
        asset,
        operation: 'read',
        sort: options.sort || [{ id: 'desc' }],
        offset: options.offset || 0,
        limit: options.limit || 50,
        ...(options.fields ? { fields: options.fields } : {}),
    });

    return {
        rows: normalizeArray(response?.data || response),
        metadata: response?.metadata || {},
    };
}

function coerceLimitValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function getPlanData(userId) {
    const user = await User.findById(userId).select([
        'accessGiven',
        'subscription',
        'agencyAnalyticsPlan',
        'agencyAnalyticsCreds',
        'agencyAnalyticsUsage',
        'agencyAnalyticsCustomLimits',
    ].join(' '));

    if (!user) throw new Error('User not found');

    const now = new Date();
    if (user.agencyAnalyticsUsage?.resetDate && now >= new Date(user.agencyAnalyticsUsage.resetDate)) {
        user.agencyAnalyticsUsage = {
            loginGrantsThisMonth: 0,
            keywordReadsThisMonth: 0,
            backlinkReadsThisMonth: 0,
            resetDate: nextResetDate(),
        };
        user.markModified('agencyAnalyticsUsage');
        await user.save();
    }

    const hasActiveSubscription = ['active', 'trialing'].includes(user.subscription?.status);
    const basePlanId = hasActiveSubscription && STRIPE_PLANS[user.subscription?.plan]
        ? user.subscription.plan
        : (user.agencyAnalyticsPlan || 'none');

    const planId = PLAN_LIMITS[basePlanId] ? basePlanId : 'none';
    const baseLimits = PLAN_LIMITS[planId];
    const custom = user.agencyAnalyticsCustomLimits || {};
    const limits = custom.enabled
        ? {
            loginGrantsPerMonth: coerceLimitValue(custom.loginGrantsPerMonth),
            keywordReadsPerMonth: coerceLimitValue(custom.keywordReadsPerMonth),
            backlinkReadsPerMonth: coerceLimitValue(custom.backlinkReadsPerMonth),
        }
        : baseLimits;

    return {
        user,
        plan: planId,
        limits,
        usage: {
            loginGrantsThisMonth: user.agencyAnalyticsUsage?.loginGrantsThisMonth || 0,
            keywordReadsThisMonth: user.agencyAnalyticsUsage?.keywordReadsThisMonth || 0,
            backlinkReadsThisMonth: user.agencyAnalyticsUsage?.backlinkReadsThisMonth || 0,
            resetDate: user.agencyAnalyticsUsage?.resetDate || nextResetDate(),
        },
    };
}

function buildStatusResponse(planData) {
    const { user, plan, limits, usage } = planData;
    const creds = user.agencyAnalyticsCreds || {};
    return {
        plan,
        limits,
        usage,
        configured: Boolean(getApiKey() && creds.agencyUserId && creds.campaignId),
        apiConfigured: Boolean(getApiKey()),
        mappingConfigured: Boolean(creds.agencyUserId && creds.campaignId),
        creds: {
            agencyUserId: creds.agencyUserId || '',
            campaignId: creds.campaignId || '',
            accountId: creds.accountId || '',
            loginUrl: creds.loginUrl || getDefaultLoginUrl(),
        },
    };
}

function normalizeString(value) {
    return value == null ? '' : String(value).trim();
}

function normalizeArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.rows)) return value.rows;
    return value ? [value] : [];
}

function pickFirst(source, keys, fallback = null) {
    for (const key of keys) {
        const value = source?.[key];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
}

function parseNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) return null;
    if (['true', 'yes', '1', 'followed', 'dofollow'].includes(normalized)) return true;
    if (['false', 'no', '0', 'nofollow', 'not_followed'].includes(normalized)) return false;
    return null;
}

function valueMatches(value, candidates) {
    const normalized = normalizeString(value);
    if (!normalized) return false;
    return candidates.some((candidate) => normalizeString(candidate) === normalized);
}

function rowMatchesMapping(row, creds, asset) {
    const agencyUserId = normalizeString(creds?.agencyUserId);
    const campaignId = normalizeString(creds?.campaignId);
    const accountId = normalizeString(creds?.accountId);

    const userCandidates = agencyUserId ? [agencyUserId] : [];
    const campaignCandidates = campaignId ? [campaignId] : [];
    const accountCandidates = accountId ? [accountId] : [];

    if (asset === 'campaign' && campaignCandidates.length && valueMatches(row?.id, campaignCandidates)) {
        return true;
    }

    if (campaignCandidates.length && [row?.campaign_id, row?.campaignId, row?.campaign?.id].some((value) => valueMatches(value, campaignCandidates))) {
        return true;
    }

    if (accountCandidates.length && [row?.account_id, row?.accountId, row?.account?.id].some((value) => valueMatches(value, accountCandidates))) {
        return true;
    }

    if (userCandidates.length && [row?.user_id, row?.userId, row?.owner_id, row?.ownerId, row?.user?.id].some((value) => valueMatches(value, userCandidates))) {
        return true;
    }

    return false;
}

function normalizeCampaign(row) {
    return {
        id: normalizeString(pickFirst(row, ['id'])),
        name: pickFirst(row, ['name', 'title', 'campaign_name'], 'Untitled campaign'),
        status: pickFirst(row, ['status', 'state'], 'unknown'),
        domain: pickFirst(row, ['domain', 'website', 'url', 'target_url'], ''),
        accountId: normalizeString(pickFirst(row, ['account_id', 'accountId'])),
        updatedAt: pickFirst(row, ['updated_at', 'updatedAt', 'last_updated_at', 'created_at', 'createdAt'], null),
    };
}

function normalizeKeyword(row) {
    const ranking = parseNumber(pickFirst(row, ['ranking', 'rank', 'position', 'current_position', 'current_rank']));
    const previousRanking = parseNumber(pickFirst(row, ['previous_ranking', 'previous_rank', 'previous_position']));
    const providedChange = parseNumber(pickFirst(row, ['ranking_change', 'rank_change', 'position_change']));

    return {
        id: normalizeString(pickFirst(row, ['id'])),
        keyword: pickFirst(row, ['keyword', 'term', 'name'], 'Unknown keyword'),
        ranking,
        previousRanking,
        change: providedChange ?? (ranking !== null && previousRanking !== null ? previousRanking - ranking : null),
        location: pickFirst(row, ['location', 'search_location', 'country'], ''),
        searchEngine: pickFirst(row, ['search_engine', 'engine'], ''),
        campaignId: normalizeString(pickFirst(row, ['campaign_id', 'campaignId'])),
        landingPage: pickFirst(row, ['landing_page', 'url', 'target_url'], ''),
    };
}

function normalizeBacklink(row) {
    return {
        id: normalizeString(pickFirst(row, ['id'])),
        sourceUrl: pickFirst(row, ['source_url', 'referring_url', 'url', 'from_url'], ''),
        targetUrl: pickFirst(row, ['target_url', 'landing_page', 'to_url'], ''),
        anchorText: pickFirst(row, ['anchor_text', 'anchor'], ''),
        status: pickFirst(row, ['status', 'state', 'link_type'], 'unknown'),
        domainAuthority: parseNumber(pickFirst(row, ['domain_authority', 'authority', 'domain_rating'])),
        followed: normalizeBoolean(pickFirst(row, ['followed', 'dofollow', 'is_followed'])),
        campaignId: normalizeString(pickFirst(row, ['campaign_id', 'campaignId'])),
    };
}

function normalizeRemoteUser(row) {
    return {
        id: normalizeString(pickFirst(row, ['id'])),
        email: pickFirst(row, ['email', 'username'], ''),
        firstName: pickFirst(row, ['first_name', 'firstName'], ''),
        lastName: pickFirst(row, ['last_name', 'lastName'], ''),
        role: pickFirst(row, ['role'], ''),
        status: pickFirst(row, ['status'], ''),
        campaignId: normalizeString(pickFirst(row, ['campaign_id', 'campaignId'])),
        accountId: normalizeString(pickFirst(row, ['account_id', 'accountId'])),
        campaignAccess: pickFirst(row, ['campaign_access', 'campaignAccess'], ''),
    };
}

function buildSearchFilter(query) {
    return normalizeString(query).toLowerCase();
}

function matchesSearch(value, needle) {
    if (!needle) return true;
    return normalizeString(value).toLowerCase().includes(needle);
}

function filterCampaigns(campaigns, websiteNeedle) {
    return campaigns.filter((campaign) => (
        matchesSearch(campaign.name, websiteNeedle) ||
        matchesSearch(campaign.domain, websiteNeedle)
    ));
}

function filterKeywords(keywords, keywordNeedle, websiteNeedle) {
    return keywords.filter((keyword) => (
        matchesSearch(keyword.keyword, keywordNeedle) &&
        (
            !websiteNeedle ||
            matchesSearch(keyword.landingPage, websiteNeedle) ||
            matchesSearch(keyword.location, websiteNeedle) ||
            matchesSearch(keyword.campaignId, websiteNeedle)
        )
    ));
}

function filterBacklinks(backlinks, keywordNeedle, websiteNeedle) {
    return backlinks.filter((backlink) => (
        (!keywordNeedle || matchesSearch(backlink.anchorText, keywordNeedle)) &&
        (
            !websiteNeedle ||
            matchesSearch(backlink.sourceUrl, websiteNeedle) ||
            matchesSearch(backlink.targetUrl, websiteNeedle) ||
            matchesSearch(backlink.campaignId, websiteNeedle)
        )
    ));
}

async function readMappedAsset(asset, creds, { limit = 50, sort = [{ id: 'desc' }] } = {}) {
    const response = await agencyAnalyticsQuery({
        provider: 'agency-analytics-v2',
        asset,
        operation: 'read',
        sort,
        offset: 0,
        limit,
    });

    return normalizeArray(response?.data || response)
        .filter((row) => rowMatchesMapping(row, creds, asset));
}

function buildDashboardResponse(planData, data = {}) {
    const status = buildStatusResponse(planData);
    const campaigns = data.campaigns || [];
    const keywords = data.keywords || [];
    const backlinks = data.backlinks || [];
    const keywordsWithRanking = keywords.filter((row) => typeof row.ranking === 'number');

    return {
        ...status,
        nativeMode: true,
        summary: {
            campaignsTotal: campaigns.length,
            activeCampaigns: campaigns.filter((row) => normalizeString(row.status).toLowerCase() === 'active').length,
            keywordsTracked: keywords.length,
            keywordsTopTen: keywordsWithRanking.filter((row) => row.ranking <= 10).length,
            backlinksTotal: backlinks.length,
            followedBacklinks: backlinks.filter((row) => row.followed === true).length,
        },
        campaigns,
        keywords,
        backlinks,
        errors: data.errors || {},
        keywordLimitReached: Boolean(data.keywordLimitReached),
        backlinkLimitReached: Boolean(data.backlinkLimitReached),
    };
}

function assertConfigured(planData) {
    if (!planData.user.accessGiven) {
        throw new Error('AgencyAnalytics access has not been enabled for this user');
    }
    if (planData.plan === 'none') {
        throw new Error('AgencyAnalytics access is not enabled for this user');
    }
    if (!getApiKey()) {
        throw new Error('AgencyAnalytics API key is missing on the server');
    }
    if (!planData.user.agencyAnalyticsCreds?.agencyUserId) {
        throw new Error('AgencyAnalytics user mapping is missing. Ask your admin to configure your AgencyAnalytics user ID.');
    }
    if (!planData.user.agencyAnalyticsCreds?.campaignId) {
        throw new Error('AgencyAnalytics campaign mapping is missing. Ask your admin to assign a single website/campaign for this user.');
    }
}

function assertUsageWithinLimit(used, limit, message) {
    if (limit <= 0 || used >= limit) {
        const error = new Error(message);
        error.statusCode = 429;
        throw error;
    }
}

router.get('/plan', protect, async (req, res) => {
    try {
        const planData = await getPlanData(req.user._id);
        res.json(buildStatusResponse(planData));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get('/status', protect, async (req, res) => {
    try {
        const planData = await getPlanData(req.user._id);
        res.json(buildStatusResponse(planData));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get('/dashboard', protect, async (req, res) => {
    try {
        const planData = await getPlanData(req.user._id);
        const keywordNeedle = buildSearchFilter(req.query.keyword);
        const websiteNeedle = buildSearchFilter(req.query.website);
        const baseResponse = buildDashboardResponse(planData, {
            campaigns: [],
            keywords: [],
            backlinks: [],
            errors: {},
            keywordLimitReached: false,
            backlinkLimitReached: false,
        });

        if (!planData.user.accessGiven || planData.plan === 'none' || !getApiKey() || !planData.user.agencyAnalyticsCreds?.agencyUserId || !planData.user.agencyAnalyticsCreds?.campaignId) {
            return res.json(baseResponse);
        }

        const creds = planData.user.agencyAnalyticsCreds || {};
        const errors = {};
        let campaigns = [];
        let keywords = [];
        let backlinks = [];
        let keywordLimitReached = false;
        let backlinkLimitReached = false;
        const usageIncrements = {};

        try {
            const campaignRows = await readMappedAsset('campaign', creds, { limit: 25 });
            campaigns = campaignRows.map(normalizeCampaign);
        } catch (error) {
            errors.campaigns = error.message;
        }

        if (planData.usage.keywordReadsThisMonth >= planData.limits.keywordReadsPerMonth || planData.limits.keywordReadsPerMonth <= 0) {
            keywordLimitReached = true;
        } else {
            try {
                const keywordRows = await readMappedAsset('keyword', creds, { limit: 50 });
                keywords = keywordRows.map(normalizeKeyword);
                usageIncrements['agencyAnalyticsUsage.keywordReadsThisMonth'] = 1;
            } catch (error) {
                errors.keywords = error.message;
            }
        }

        if (planData.usage.backlinkReadsThisMonth >= planData.limits.backlinkReadsPerMonth || planData.limits.backlinkReadsPerMonth <= 0) {
            backlinkLimitReached = true;
        } else {
            try {
                const backlinkRows = await readMappedAsset('backlink', creds, { limit: 50 });
                backlinks = backlinkRows.map(normalizeBacklink);
                usageIncrements['agencyAnalyticsUsage.backlinkReadsThisMonth'] = 1;
            } catch (error) {
                errors.backlinks = error.message;
            }
        }

        if (Object.keys(usageIncrements).length > 0) {
            await User.findByIdAndUpdate(req.user._id, { $inc: usageIncrements });
        }

        campaigns = filterCampaigns(campaigns, websiteNeedle);
        keywords = filterKeywords(keywords, keywordNeedle, websiteNeedle);
        backlinks = filterBacklinks(backlinks, keywordNeedle, websiteNeedle);

        const refreshedPlanData = Object.keys(usageIncrements).length > 0
            ? await getPlanData(req.user._id)
            : planData;

        res.json(buildDashboardResponse(refreshedPlanData, {
            campaigns,
            keywords,
            backlinks,
            errors,
            keywordLimitReached,
            backlinkLimitReached,
        }));
    } catch (error) {
        res.status(error.statusCode || 500).json({ message: error.message });
    }
});

router.post('/login-grant', protect, async (req, res) => {
    try {
        const planData = await getPlanData(req.user._id);
        assertConfigured(planData);
        assertUsageWithinLimit(
            planData.usage.loginGrantsThisMonth,
            planData.limits.loginGrantsPerMonth,
            'AgencyAnalytics login limit reached for this billing period',
        );

        const response = await agencyAnalyticsQuery({
            provider: 'agency-analytics-v2',
            asset: 'login-grant',
            operation: 'create',
            rows: [
                { user_id: String(planData.user.agencyAnalyticsCreds.agencyUserId) },
            ],
        });

        const loginData = response?.data || {};
        await User.findByIdAndUpdate(req.user._id, {
            $inc: { 'agencyAnalyticsUsage.loginGrantsThisMonth': 1 },
        });

        const refreshed = await getPlanData(req.user._id);
        res.json({
            loginUrl: loginData.login_url || planData.user.agencyAnalyticsCreds?.loginUrl || getDefaultLoginUrl(),
            token: loginData.token || null,
            userId: loginData.user_id || planData.user.agencyAnalyticsCreds?.agencyUserId || null,
            usage: refreshed.usage,
            limits: refreshed.limits,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ message: error.message });
    }
});

router.post('/admin/test', protect, admin, async (req, res) => {
    try {
        const response = await agencyAnalyticsQuery({
            provider: 'agency-analytics-v2',
            asset: 'user',
            operation: 'read',
            fields: ['id', 'email', 'role', 'campaign_id', 'account_id'],
            sort: [{ id: 'desc' }],
            offset: 0,
            limit: 5,
        });

        res.json({
            ok: true,
            totalRecords: response?.metadata?.total_records ?? null,
            sample: Array.isArray(response?.data) ? response.data.slice(0, 5) : [],
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get('/admin/users', protect, admin, async (req, res) => {
    try {
        const searchNeedle = buildSearchFilter(req.query.search);
        const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
        const response = await readRemoteAsset('user', {
            limit,
            fields: ['id', 'email', 'username', 'first_name', 'last_name', 'role', 'status', 'campaign_id', 'campaign_access', 'account_id'],
        });

        let users = response.rows.map(normalizeRemoteUser);
        if (searchNeedle) {
            users = users.filter((remoteUser) => (
                matchesSearch(remoteUser.email, searchNeedle) ||
                matchesSearch(remoteUser.firstName, searchNeedle) ||
                matchesSearch(remoteUser.lastName, searchNeedle) ||
                matchesSearch(remoteUser.id, searchNeedle) ||
                matchesSearch(remoteUser.campaignId, searchNeedle)
            ));
        }

        res.json({
            data: users,
            totalRecords: response.metadata?.total_records ?? users.length,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get('/admin/campaigns', protect, admin, async (req, res) => {
    try {
        const searchNeedle = buildSearchFilter(req.query.search);
        const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
        const response = await readRemoteAsset('campaign', { limit });

        let campaigns = response.rows.map(normalizeCampaign);
        if (searchNeedle) {
            campaigns = campaigns.filter((campaign) => (
                matchesSearch(campaign.id, searchNeedle) ||
                matchesSearch(campaign.name, searchNeedle) ||
                matchesSearch(campaign.domain, searchNeedle) ||
                matchesSearch(campaign.accountId, searchNeedle)
            ));
        }

        res.json({
            data: campaigns,
            totalRecords: response.metadata?.total_records ?? campaigns.length,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;