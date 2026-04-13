import express from 'express';
import OpenAI from 'openai';
import { protect } from '../middleware/auth.js';
import PowerToolsUsage from '../models/PowerToolsUsage.js';

const router = express.Router();

// ─── OpenAI lazy client ───────────────────────────────────────────────────────
let _openai = null;
function getOpenAI() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set in server/.env');
    }
    if (!_openai) {
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}

// ─── Plan limits (requests / month) ──────────────────────────────────────────
// starter: 0  — AI builder not included
// growth:  20 — limited AI requests
// agency:  null — unlimited
const AI_PLAN_LIMITS = { starter: 0, growth: 20, agency: null };

function getUserPlan(user) {
    if (user.role === 'admin') return 'agency';
    return user.subscription?.plan || 'starter';
}

function getCurrentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function checkAndIncrementAIUsage(userId, plan) {
    const limit = AI_PLAN_LIMITS[plan] ?? 0;
    const isUnlimited = limit === null;
    if (!isUnlimited && limit <= 0) {
        return { allowed: false, used: 0, limit };
    }

    const month = getCurrentMonth();
    const records = await PowerToolsUsage.find({ userId, tool: 'ai-builder', month });
    const totalUsed = records.reduce((a, r) => a + r.count, 0);

    if (!isUnlimited && totalUsed >= limit) {
        return { allowed: false, used: totalUsed, limit };
    }

    await PowerToolsUsage.findOneAndUpdate(
        { userId, tool: 'ai-builder', month },
        { $inc: { count: 1 } },
        { upsert: true, new: true }
    );

    return { allowed: true, used: totalUsed + 1, limit: isUnlimited ? null : limit };
}

// ─── Prompt builders ──────────────────────────────────────────────────────────
function buildPrompt(type, context) {
    switch (type) {
        case 'resume-title':
            return `You are a professional resume writer. Generate a compelling job title / professional designation for a resume.
Context provided by the user: "${context.userInput}"
Return ONLY the job title text (2-6 words), nothing else. No quotes, no explanation.`;

        case 'resume-summary':
            return `You are an expert resume writer. Write a professional summary for a resume.
Target role: ${context.targetRole || 'not specified'}
Industry: ${context.industry || 'not specified'}
Years of experience: ${context.yearsExp || 'not specified'}
Key skills / background: ${context.background || context.userInput || 'not specified'}

Write a compelling 3-4 sentence professional summary in first person. Use strong action verbs. Return only the summary text as plain text (no HTML, no bullet points).`;

        case 'resume-experience':
            return `You are a professional resume writer. Write bullet-point job description for a resume.
Job title: ${context.jobTitle || 'not specified'}
Company: ${context.company || 'not specified'}
Key responsibilities / achievements: ${context.userInput || 'not specified'}

Write 3-5 impactful bullet points that highlight achievements and responsibilities. Start each bullet with a strong action verb. Return as an HTML unordered list <ul><li>...</li></ul> — no other markup.`;

        case 'email-title':
            return `You are a marketing email strategist. Generate a concise, descriptive template title for an email template.
Email type / purpose: ${context.purpose || context.userInput || 'not specified'}
Target audience: ${context.audience || 'not specified'}

Return ONLY the template title (4-8 words), nothing else.`;

        case 'email-description':
            return `Write a brief 1-2 sentence description for an email template.
Template title: ${context.title || 'not specified'}
Email purpose: ${context.purpose || context.userInput || 'not specified'}

Return ONLY the description text, nothing else.`;

        case 'email-subject':
            return `You are a conversion-focused email marketer. Write a compelling email subject line.
Email purpose: ${context.purpose || context.userInput || 'not specified'}
Target audience: ${context.audience || 'not specified'}
Tone: ${context.tone || 'professional'}

Return ONLY the subject line text (under 60 characters ideally), nothing else.`;

        case 'email-content':
            return `You are a professional email copywriter. Write a complete, well-formatted HTML email body.
Email purpose: ${context.purpose || context.userInput || 'not specified'}
Target audience: ${context.audience || 'not specified'}
Key message / offer: ${context.keyMessage || 'not specified'}
Tone: ${context.tone || 'professional'}
Call to action: ${context.cta || 'Contact us'}

Return a complete HTML email body with proper structure: greeting, introduction, main content (2-3 paragraphs), CTA button, and sign-off. Use inline styles for basic formatting. No <html>, <head>, or <body> tags — just the inner content.`;

        default:
            throw new Error(`Unknown AI generation type: ${type}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/ai/usage  — current month AI usage for authenticated user
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/usage', protect, async (req, res) => {
    try {
        const plan = getUserPlan(req.user);
        const limit = AI_PLAN_LIMITS[plan] ?? 0;
        const month = getCurrentMonth();
        const records = await PowerToolsUsage.find({ userId: req.user._id, tool: 'ai-builder', month });
        const used = records.reduce((a, r) => a + r.count, 0);
        res.json({ used, limit, plan, unlimited: limit === null });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/ai/generate  — generate AI content
// Body: { type: string, context: object }
// Types: resume-title | resume-summary | resume-experience |
//        email-title  | email-description | email-subject | email-content
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/generate', protect, async (req, res) => {
    try {
        const plan = getUserPlan(req.user);

        // Check plan access
        if (plan === 'starter') {
            return res.status(403).json({
                message: 'AI Builder is available on Growth and Agency plans. Please upgrade to use this feature.',
                upgradeRequired: true,
            });
        }

        // Check and increment usage
        const usage = await checkAndIncrementAIUsage(req.user._id, plan);
        if (!usage.allowed) {
            return res.status(429).json({
                message: `You've used all ${usage.limit} AI requests this month. Upgrade to Agency for unlimited access.`,
                used: usage.used,
                limit: usage.limit,
            });
        }

        const { type, context } = req.body;
        if (!type) return res.status(400).json({ message: 'type is required' });
        if (!context) return res.status(400).json({ message: 'context is required' });

        const prompt = buildPrompt(type, context);
        const openai = getOpenAI();

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 600,
            temperature: 0.75,
        });

        const result = completion.choices[0]?.message?.content?.trim() || '';

        res.json({
            result,
            used: usage.used,
            limit: usage.limit,
            unlimited: usage.limit === null,
        });
    } catch (err) {
        console.error('[AI Generate]', err.message);
        res.status(500).json({ message: err.message });
    }
});

export default router;
