import express from 'express';
import OpenAI from 'openai';
import { protect, admin } from '../middleware/auth.js';
import { PLANS } from '../config/plans.js';
import PowerToolsUsage from '../models/PowerToolsUsage.js';
import BrandVoice from '../models/BrandVoice.js';
import HealthCheckLog from '../models/HealthCheckLog.js';
import PowerToolsSettings from '../models/PowerToolsSettings.js';

const router = express.Router();

// ─── OpenAI lazy client ───────────────────────────────────────────────────────
let _openai = null;
function getOpenAI() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set. Please add it to your server/.env file.');
    }
    if (!_openai) {
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}

// ─── Plan limits ──────────────────────────────────────────────────────────────
// Pull defaults from unified plans config; admin override stored in DB
const DEFAULT_PLAN_LIMITS = {
    starter: PLANS.starter.powerToolsQueries,   // 10
    growth:  PLANS.growth.powerToolsQueries,    // 50
    agency:  PLANS.agency.powerToolsQueries,    // 200
};
const BRAND_VOICE_PLAN_LIMITS = { starter: 2, growth: 5, agency: 20 };

function getUserPlan(user) {
    if (user.role === 'admin') return 'agency';
    return user.subscription?.plan || 'starter';
}

function getCurrentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function getActivePlanLimits() {
    const doc = await PowerToolsSettings.findOne({ key: 'powertools-plan-limits' });
    return doc?.value || DEFAULT_PLAN_LIMITS;
}

async function checkAndIncrementUsage(userId, tool, plan) {
    const limits = await getActivePlanLimits();
    const limit = limits[plan] ?? limits.starter ?? 20;
    const isUnlimited = limit === null || limit === Infinity;

    const month = getCurrentMonth();
    const usageRecords = await PowerToolsUsage.find({ userId, month });
    const totalUsed = usageRecords.reduce((a, r) => a + r.count, 0);

    if (!isUnlimited && totalUsed >= limit) {
        return { allowed: false, used: totalUsed, limit };
    }

    await PowerToolsUsage.findOneAndUpdate(
        { userId, tool, month },
        { $inc: { count: 1 } },
        { upsert: true, new: true }
    );

    return { allowed: true, used: totalUsed + 1, limit: isUnlimited ? null : limit };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cleanJSON(raw) {
    return raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/powertools/usage
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/usage', protect, async (req, res) => {
    try {
        const month = getCurrentMonth();
        const plan = getUserPlan(req.user);
        const limits = await getActivePlanLimits();
        const limit = limits[plan] ?? limits.starter;
        const isUnlimited = limit === null || limit === Infinity;

        const records = await PowerToolsUsage.find({ userId: req.user._id, month });
        const used = records.reduce((a, r) => a + r.count, 0);
        const byTool = {};
        records.forEach(r => { byTool[r.tool] = r.count; });

        res.json({
            plan,
            used,
            limit: isUnlimited ? null : limit,
            remaining: isUnlimited ? null : Math.max(0, limit - used),
            byTool,
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL 1 — Cold Outreach Personalizer
// POST /api/powertools/cold-outreach
// Body: { leads: [{ name, company, website, role, industry }] }
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/cold-outreach', protect, async (req, res) => {
    try {
        const plan = getUserPlan(req.user);
        const usage = await checkAndIncrementUsage(req.user._id, 'cold-outreach', plan);
        if (!usage.allowed) {
            return res.status(403).json({
                message: `Monthly AI query limit reached (${usage.limit} on ${plan} plan). Upgrade to continue.`,
                upgradeRequired: true,
            });
        }

        const { leads } = req.body;
        if (!Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ message: 'leads array is required (max 50 leads per batch).' });
        }
        if (leads.length > 50) {
            return res.status(400).json({ message: 'Maximum 50 leads per batch.' });
        }

        const openai = getOpenAI();

        // Build a single batch prompt to reduce API calls
        const leadDescriptions = leads.map((l, i) =>
            `${i + 1}. ${l.name || '?'} | ${l.role || '?'} | ${l.company || '?'} | ${l.industry || '?'} | ${l.website || '?'}`
        ).join('\n');

        const prompt = `Cold email copywriter. For each lead write ONE ice-breaker line (max 20 words). Genuine, specific, no clichés. Return JSON array: [{"index":1,"line":"..."}]\n\n${leadDescriptions}\n\nJSON only.`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: Math.min(leads.length * 55, 2000),
            temperature: 0.82,
        });

        let parsed = [];
        try {
            parsed = JSON.parse(cleanJSON(completion.choices[0]?.message?.content || '[]'));
        } catch { /* ignore parse errors - return empty lines */ }

        const results = leads.map((lead, i) => ({
            ...lead,
            iceBreakerLine: parsed.find(p => p.index === i + 1)?.line || '',
        }));

        res.json({ results, usage: { used: usage.used, limit: usage.limit } });
    } catch (err) {
        console.error('[cold-outreach]', err.message);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL 2 — Brand Voice CRUD
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/brand-voices', protect, async (req, res) => {
    try {
        const voices = await BrandVoice.find({ userId: req.user._id }).sort({ updatedAt: -1 });
        res.json(voices);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/brand-voices', protect, async (req, res) => {
    try {
        const { name, mission, targetAudience, tone, keywords } = req.body;
        if (!name) return res.status(400).json({ message: 'Brand name is required.' });

        const plan = getUserPlan(req.user);
        const limit = BRAND_VOICE_PLAN_LIMITS[plan] ?? 2;
        const count = await BrandVoice.countDocuments({ userId: req.user._id });
        if (count >= limit) {
            return res.status(403).json({ message: `Brand Voice limit reached (${limit} on ${plan} plan). Upgrade to create more.` });
        }

        // Generate AI persona
        const openai = getOpenAI();
        const personaPrompt = `Brand Persona JSON:\nMission: ${mission || '?'} | Audience: ${targetAudience || '?'} | Tone: ${tone || '?'} | Keywords: ${(keywords || []).join(', ') || 'none'}\nReturn JSON: {writingStyle,vocabulary(4 words),thingsToAvoid(3),samplePhrases(3),emojiUsage,communityLanguage}. JSON only.`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: personaPrompt }],
            max_tokens: 420,
            temperature: 0.7,
        });

        let persona = {};
        try { persona = JSON.parse(cleanJSON(completion.choices[0]?.message?.content || '{}')); } catch { /* ignore */ }

        await checkAndIncrementUsage(req.user._id, 'brand-voice', plan);

        const voice = await BrandVoice.create({
            userId: req.user._id,
            name, mission: mission || '', targetAudience: targetAudience || '',
            tone: tone || '', keywords: keywords || [], persona,
        });

        res.status(201).json(voice);
    } catch (err) {
        console.error('[brand-voice create]', err.message);
        res.status(500).json({ message: err.message });
    }
});

router.put('/brand-voices/:id', protect, async (req, res) => {
    try {
        const voice = await BrandVoice.findOne({ _id: req.params.id, userId: req.user._id });
        if (!voice) return res.status(404).json({ message: 'Brand voice not found.' });

        const { name, mission, targetAudience, tone, keywords } = req.body;
        if (name !== undefined) voice.name = name;
        if (mission !== undefined) voice.mission = mission;
        if (targetAudience !== undefined) voice.targetAudience = targetAudience;
        if (tone !== undefined) voice.tone = tone;
        if (keywords !== undefined) voice.keywords = keywords;

        await voice.save();
        res.json(voice);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/brand-voices/:id', protect, async (req, res) => {
    try {
        const voice = await BrandVoice.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!voice) return res.status(404).json({ message: 'Brand voice not found.' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL 3 — SEO Content Cluster Generator
// POST /api/powertools/seo-cluster
// Body: { keyword, brandVoiceId? }
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/seo-cluster', protect, async (req, res) => {
    try {
        const plan = getUserPlan(req.user);
        const usage = await checkAndIncrementUsage(req.user._id, 'seo-cluster', plan);
        if (!usage.allowed) {
            return res.status(403).json({ message: `Monthly AI limit reached. Upgrade to continue.`, upgradeRequired: true });
        }

        const { keyword, brandVoiceId } = req.body;
        if (!keyword) return res.status(400).json({ message: 'keyword is required.' });

        const settingsDoc = await PowerToolsSettings.findOne({ key: 'seo-system-prompt' });
        const systemPrompt = settingsDoc?.value || 'You are an expert SEO strategist. Create comprehensive topical authority content clusters that rank in Google.';

        let voiceContext = '';
        if (brandVoiceId) {
            const voice = await BrandVoice.findOne({ _id: brandVoiceId, userId: req.user._id });
            if (voice) {
                voiceContext = ` Adapt all titles to ${voice.tone || 'professional'} tone targeting ${voice.targetAudience || 'general audience'}.`;
            }
        }

        const openai = getOpenAI();
        const prompt = `${systemPrompt}${voiceContext}\n\nKeyword: "${keyword}"\n\nContent cluster:\n1. Pillar Post (title + 4 subheaders)\n2. 8 Cluster Posts (each: title + 2 subheaders)\n\nReturn JSON: {"pillar":{"title":"","subheaders":[]},"clusters":[{"title":"","subheaders":[]}]}\nJSON only.`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1100,
            temperature: 0.72,
        });

        let cluster = { pillar: {}, clusters: [] };
        try { cluster = JSON.parse(cleanJSON(completion.choices[0]?.message?.content || '{}')); } catch { /* ignore */ }

        res.json({ keyword, cluster, usage: { used: usage.used, limit: usage.limit } });
    } catch (err) {
        console.error('[seo-cluster]', err.message);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL 4 — Social Post Re-purposer
// POST /api/powertools/social-repurpose
// Body: { content, youtubeUrl?, brandVoiceId? }
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/social-repurpose', protect, async (req, res) => {
    try {
        const plan = getUserPlan(req.user);
        const usage = await checkAndIncrementUsage(req.user._id, 'social-repurpose', plan);
        if (!usage.allowed) {
            return res.status(403).json({ message: `Monthly AI limit reached. Upgrade to continue.`, upgradeRequired: true });
        }

        const { content, youtubeUrl, brandVoiceId } = req.body;
        if (!content && !youtubeUrl) {
            return res.status(400).json({ message: 'content or youtubeUrl is required.' });
        }

        const maxChars = plan === 'starter' ? 3000 : plan === 'growth' ? 8000 : 20000;
        const inputText = (content || '').substring(0, maxChars);

        let voiceContext = '';
        if (brandVoiceId) {
            const voice = await BrandVoice.findOne({ _id: brandVoiceId, userId: req.user._id });
            if (voice) {
                const phrases = voice.persona?.samplePhrases?.slice(0, 2).join(' | ') || '';
                voiceContext = `\nBrand voice: ${voice.tone || 'professional'} tone, targeting ${voice.targetAudience || 'general'}. ${phrases ? `Sample style: "${phrases}"` : ''}`;
            }
        }

        const openai = getOpenAI();
        const prompt = `Social media expert.${voiceContext}\n${youtubeUrl ? `YouTube: ${youtubeUrl}` : ''}\n${inputText ? `Content:\n${inputText}` : ''}\n\nRepurpose into:\n1. 3 tweets (under 280 chars, 2 hashtags)\n2. 1 LinkedIn post (100-150 words, hook+value+CTA)\n3. 1 TikTok script (hook→content→CTA, under 150 words)\n\nReturn JSON: {"tweets":[],"linkedinPost":"","tiktokScript":""}\nJSON only.`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 750,
            temperature: 0.78,
        });

        let output = { tweets: [], linkedinPost: '', tiktokScript: '' };
        try { output = JSON.parse(cleanJSON(completion.choices[0]?.message?.content || '{}')); } catch { /* ignore */ }

        res.json({ ...output, usage: { used: usage.used, limit: usage.limit } });
    } catch (err) {
        console.error('[social-repurpose]', err.message);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL 5 — Website Health Check
// POST /api/powertools/health-check
// Body: { url }
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/health-check', protect, async (req, res) => {
    try {
        const plan = getUserPlan(req.user);
        const usage = await checkAndIncrementUsage(req.user._id, 'health-check', plan);
        if (!usage.allowed) {
            return res.status(403).json({ message: `Monthly AI limit reached. Upgrade to continue.`, upgradeRequired: true });
        }

        let { url } = req.body;
        if (!url) return res.status(400).json({ message: 'url is required.' });

        // Normalize
        if (!url.startsWith('http')) url = `https://${url}`;
        // Block internal/private addresses
        if (/localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./.test(url)) {
            return res.status(400).json({ message: 'Private/local URLs are not allowed.' });
        }

        // ─ 1. SSL ─────────────────────────────────────────────────────────────
        let ssl = { valid: false, protocol: 'HTTP' };
        try {
            const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
            ssl = { valid: url.startsWith('https://'), protocol: url.startsWith('https://') ? 'HTTPS' : 'HTTP', statusCode: r.status };
        } catch (e) {
            ssl = { valid: false, protocol: 'Unknown', error: 'Site unreachable' };
        }

        // ─ 2. PageSpeed Insights ──────────────────────────────────────────────
        let pageSpeed = { mobile: null, desktop: null };
        try {
            const key = process.env.PAGESPEED_API_KEY ? `&key=${process.env.PAGESPEED_API_KEY}` : '';
            // No fields filter — the filter's hyphenated audit keys cause silent failures from the Google API
            const baseUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}`;
            const [mob, desk] = await Promise.allSettled([
                fetch(`${baseUrl}&strategy=mobile${key}`, { signal: AbortSignal.timeout(45000) }).then(r => r.json()),
                fetch(`${baseUrl}&strategy=desktop${key}`, { signal: AbortSignal.timeout(45000) }).then(r => r.json()),
            ]);
            const extract = (data) => {
                const cats = data?.lighthouseResult?.categories || {};
                const a = data?.lighthouseResult?.audits || {};

                // Build insight items from failed audits
                const insights = [];
                const auditKeys = [
                    'render-blocking-resources', 'uses-optimized-images', 'uses-responsive-images',
                    'unused-javascript', 'unused-css-rules', 'uses-text-compression', 'efficient-animated-content',
                ];
                for (const key of auditKeys) {
                    const audit = a[key];
                    if (!audit || audit.score === 1 || audit.score === null) continue;
                    insights.push({
                        id: key,
                        title: audit.title,
                        description: audit.description,
                        score: audit.score,
                        displayValue: audit.displayValue || null,
                        scoreDisplayMode: audit.scoreDisplayMode,
                        items: (audit.details?.items || []).slice(0, 5).map(item => ({
                            url: item.url || item.node?.snippet || item.totalBytes?.toString() || '',
                            totalBytes: item.totalBytes,
                            wastedBytes: item.wastedBytes,
                            wastedMs: item.wastedMs,
                        })),
                    });
                }

                return {
                    performance: Math.round((cats?.performance?.score ?? 0) * 100),
                    accessibility: Math.round((cats?.accessibility?.score ?? 0) * 100),
                    bestPractices: Math.round((cats?.['best-practices']?.score ?? 0) * 100),
                    seo: Math.round((cats?.seo?.score ?? 0) * 100),
                    // Core Web Vitals
                    fcp: a?.['first-contentful-paint']?.displayValue || null,
                    lcp: a?.['largest-contentful-paint']?.displayValue || null,
                    cls: a?.['cumulative-layout-shift']?.displayValue || null,
                    tbt: a?.['total-blocking-time']?.displayValue || null,
                    speedIndex: a?.['speed-index']?.displayValue || null,
                    tti: a?.['interactive']?.displayValue || null,
                    // Raw numeric values for color coding
                    fcpMs: a?.['first-contentful-paint']?.numericValue || null,
                    lcpMs: a?.['largest-contentful-paint']?.numericValue || null,
                    clsVal: a?.['cumulative-layout-shift']?.numericValue || null,
                    tbtMs: a?.['total-blocking-time']?.numericValue || null,
                    speedIndexMs: a?.['speed-index']?.numericValue || null,
                    // Screenshot
                    screenshot: a?.['final-screenshot']?.details?.data || null,
                    // Improvement opportunities
                    insights,
                    // Legacy — keep for back-compatibility
                    score: Math.round((cats?.performance?.score ?? 0) * 100),
                };
            };
            if (mob.status === 'fulfilled' && mob.value?.lighthouseResult) pageSpeed.mobile = extract(mob.value);
            if (desk.status === 'fulfilled' && desk.value?.lighthouseResult) pageSpeed.desktop = extract(desk.value);
        } catch { /* ignore */ }

        // ─ 3. Broken Links ────────────────────────────────────────────────────
        let brokenLinks = [];
        try {
            const pageRes = await fetch(url, { signal: AbortSignal.timeout(10000) });
            const html = await pageRes.text();
            const hrefRegex = /href=["']([^"'#?\s]+)["']/g;
            const links = new Set();
            let match;
            while ((match = hrefRegex.exec(html)) !== null && links.size < 30) {
                const href = match[1];
                if (href.startsWith('http') && !href.includes('javascript:')) links.add(href);
            }
            const results = await Promise.allSettled(
                [...links].slice(0, 20).map(link =>
                    fetch(link, { method: 'HEAD', signal: AbortSignal.timeout(5000), redirect: 'follow' })
                        .then(r => ({ url: link, status: r.status, ok: r.ok }))
                        .catch(() => ({ url: link, status: 0, ok: false }))
                )
            );
            brokenLinks = results
                .filter(r => r.status === 'fulfilled' && !r.value.ok)
                .map(r => ({ url: r.value.url, status: r.value.status || 'timeout' }));
        } catch { /* ignore */ }

        // ─ 4. AI Summary ──────────────────────────────────────────────────────
        let aiSummary = '';
        try {
            const openai = getOpenAI();
            const summaryPrompt = `Site: ${url}\nSSL: ${ssl.valid ? 'HTTPS✓' : 'No HTTPS✗'} | Mobile: ${pageSpeed.mobile?.score ?? 'N/A'}/100 | Desktop: ${pageSpeed.desktop?.score ?? 'N/A'}/100 | FCP: ${pageSpeed.mobile?.fcp || 'N/A'} | Broken links: ${brokenLinks.length}\n\nList Top 3 specific actionable priorities, numbered 1-3. Max 80 words.`;

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: summaryPrompt }],
                max_tokens: 160,
                temperature: 0.5,
            });
            aiSummary = completion.choices[0]?.message?.content?.trim() || '';
        } catch (e) {
            aiSummary = 'AI summary unavailable (check OPENAI_API_KEY).';
        }

        // Save log
        const log = await HealthCheckLog.create({
            userId: req.user._id,
            url, ssl, pageSpeed,
            brokenLinks: brokenLinks.map(l => l.url),
            brokenLinksCount: brokenLinks.length,
            aiSummary,
        });

        res.json({ url, ssl, pageSpeed, brokenLinks, aiSummary, reportId: log._id, usage: { used: usage.used, limit: usage.limit } });
    } catch (err) {
        console.error('[health-check]', err.message);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/admin/usage-stats', protect, admin, async (req, res) => {
    try {
        const month = getCurrentMonth();
        const stats = await PowerToolsUsage.aggregate([
            { $match: { month } },
            { $group: { _id: '$tool', total: { $sum: '$count' }, users: { $addToSet: '$userId' } } },
            { $project: { tool: '$_id', total: 1, uniqueUsers: { $size: '$users' }, _id: 0 } },
            { $sort: { total: -1 } },
        ]);
        const totalHealthChecks = await HealthCheckLog.countDocuments();
        const totalBrandVoices = await BrandVoice.countDocuments();
        res.json({ month, stats, totalHealthChecks, totalBrandVoices });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.get('/admin/health-logs', protect, admin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 50;
        const logs = await HealthCheckLog.find()
            .populate('userId', 'name email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);
        const total = await HealthCheckLog.countDocuments();
        res.json({ logs, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.get('/admin/seo-prompt', protect, admin, async (req, res) => {
    try {
        const doc = await PowerToolsSettings.findOne({ key: 'seo-system-prompt' });
        const defaultPrompt = 'You are an expert SEO strategist. Create comprehensive topical authority content clusters that rank in Google.';
        res.json({ prompt: doc?.value || defaultPrompt });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.put('/admin/seo-prompt', protect, admin, async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ message: 'prompt is required.' });
        await PowerToolsSettings.findOneAndUpdate({ key: 'seo-system-prompt' }, { value: prompt, updatedAt: new Date() }, { upsert: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.get('/admin/plan-limits', protect, admin, async (req, res) => {
    try {
        const limits = await getActivePlanLimits();
        res.json(limits);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.put('/admin/plan-limits', protect, admin, async (req, res) => {
    try {
        const { starter, growth, agency } = req.body;
        const limits = {
            starter: starter === null ? null : (parseInt(starter) || DEFAULT_PLAN_LIMITS.starter),
            growth: growth === null ? null : (parseInt(growth) || DEFAULT_PLAN_LIMITS.growth),
            agency: agency === null ? null : (parseInt(agency) || null),
        };
        await PowerToolsSettings.findOneAndUpdate(
            { key: 'powertools-plan-limits' },
            { value: limits, updatedAt: new Date() },
            { upsert: true }
        );
        res.json({ success: true, limits });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
