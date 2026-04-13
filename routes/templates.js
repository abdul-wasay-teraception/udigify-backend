import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { v2 as cloudinary } from 'cloudinary';

import Template from '../models/Template.js';
import AdminTemplate from '../models/AdminTemplate.js';
import TemplateKit from '../models/TemplateKit.js';
import UserAsset from '../models/UserAsset.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads', 'templates');
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});

const DUMMY_MEDIA = {
    logos: [
        'Northstar Studio',
        'Summit Labs',
        'Apex Collective',
        'Vertex Works',
    ],
    backgrounds: [
        'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1600&q=80',
        'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1600&q=80',
        'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1600&q=80',
        'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1600&q=80',
        'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=80',
        'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=1600&q=80',
    ],
    profilePhotos: [
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80',
    ],
};

function createDummyLogoDataUri(name = 'Udigify Brand') {
    const safeName = String(name || 'Udigify Brand').replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'Udigify Brand';
    const initials = safeName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] || '')
        .join('')
        .toUpperCase();

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="64" viewBox="0 0 220 64" role="img" aria-label="${safeName}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs><rect width="220" height="64" rx="10" fill="url(#g)"/><circle cx="26" cy="32" r="16" fill="#ffffff" fill-opacity="0.18"/><text x="26" y="37" text-anchor="middle" font-size="12" font-family="Arial,Helvetica,sans-serif" font-weight="700" fill="#ffffff">${initials}</text><text x="52" y="38" font-size="13" font-family="Arial,Helvetica,sans-serif" font-weight="600" fill="#ffffff">${safeName.slice(0, 20)}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function slugify(value = '') {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

cloudinary.config({ secure: true });

const EMAIL_LAYOUT_HIGHLIGHTS = {
    metrics: ['Activation benchmarks', 'Operational gains', 'Time-to-value signals'],
    'feature-grid': ['Top 3 release benefits', 'Operational impact', 'Upgrade path details'],
    digest: ['Top story', 'Operator insight', 'Weekly action items'],
    event: ['Agenda snapshot', 'Speaker highlights', 'Q&A session details'],
    commerce: ['Limited-time offer', 'Featured collection', 'Checkout incentive'],
    story: ['Challenge context', 'Execution framework', 'Measured outcomes'],
};

const EMAIL_BLOCK_VARIANTS = [
    'scoreboard',
    'timeline',
    'checklist',
    'split-panel',
    'testimonial',
    'comparison',
    'spotlight',
    'steps',
    'faq',
    'roadmap',
];

const EMAIL_CTA_LABEL_BY_CATEGORY = {
    onboarding: 'Start Setup',
    launch: 'Explore Release',
    newsletter: 'Read Full Brief',
    webinar: 'Reserve My Seat',
    promotion: 'Shop Now',
    proof: 'Read Case Study',
    retention: 'Renew Plan',
    conversion: 'Upgrade Today',
    security: 'Review Policy',
    report: 'Open Report',
    community: 'View Update',
    event: 'Get Invite',
    company: 'Read Update',
    outreach: 'Book A Call',
};

const EMAIL_PALETTES = [
    ['#0B1020', '#2563EB', '#22D3EE'],
    ['#0F172A', '#4338CA', '#06B6D4'],
    ['#0B132B', '#4F46E5', '#34D399'],
    ['#111827', '#7C3AED', '#38BDF8'],
    ['#0F0F12', '#F97316', '#FACC15'],
    ['#111827', '#0EA5E9', '#10B981'],
    ['#0B1220', '#D946EF', '#38BDF8'],
    ['#111827', '#2563EB', '#A78BFA'],
    ['#09090B', '#DC2626', '#F59E0B'],
    ['#0A0F1F', '#0EA5E9', '#14B8A6'],
];

const EMAIL_PROVIDER_BENCHMARKS = [
    'Mailchimp playbook',
    'Klaviyo lifecycle patterns',
    'HubSpot campaign framework',
    'Braze engagement model',
    'Customer.io automation flow',
    'ActiveCampaign conversion style',
    'ConvertKit creator sequence',
    'Beehiiv newsletter format',
];

const EMAIL_TOPIC_SEEDS = [
    ['Welcome Value Activation', 'onboarding', 'Welcome aboard: your first 3 high-impact actions', 'clear', 'metrics'],
    ['Product Release Announcement', 'launch', 'Now live: speed, automation, and better reporting', 'bold', 'feature-grid'],
    ['Weekly Growth Newsletter', 'newsletter', 'This week in growth: tactics, tests, outcomes', 'editorial', 'digest'],
    ['Webinar Registration Invite', 'webinar', 'Join live: how teams scale pipeline in 2026', 'professional', 'event'],
    ['Flash Sale Promotion', 'promotion', '48-hour drop: premium plan at launch pricing', 'urgent', 'commerce'],
    ['Case Study Social Proof', 'proof', 'How one team improved conversion by 32%', 'credible', 'story'],
    ['Subscription Renewal Reminder', 'retention', 'Your renewal window closes soon - keep momentum', 'direct', 'metrics'],
    ['Free Trial Conversion', 'conversion', 'Your trial is almost done - here is your upgrade path', 'persuasive', 'feature-grid'],
    ['Community Highlights Digest', 'community', 'Top wins from your community this week', 'friendly', 'digest'],
    ['Security Incident Advisory', 'security', 'Security update: actions required from your team', 'clear', 'story'],
    ['Monthly KPI Report', 'report', 'Monthly performance report: growth, churn, ROI', 'data', 'metrics'],
    ['Founder Strategic Letter', 'company', 'A note from leadership: priorities for next quarter', 'warm', 'story'],
    ['Partner Outreach Proposal', 'outreach', 'Partnership idea tailored to your audience', 'professional', 'feature-grid'],
    ['VIP Event Invitation', 'event', 'Invite: executive roundtable for operators', 'premium', 'event'],
    ['Feature Adoption Nudge', 'onboarding', '3 advanced features to unlock this week', 'helpful', 'feature-grid'],
    ['Winback Re-Engagement', 'retention', 'We saved your data. Pick up where you left off.', 'encouraging', 'story'],
    ['Referral Rewards Campaign', 'promotion', 'Invite peers and earn premium rewards', 'friendly', 'commerce'],
    ['Quarterly Investor Update', 'company', 'Quarterly update: roadmap, milestones, outlook', 'executive', 'digest'],
    ['Demo Follow-up Sequence', 'outreach', 'Custom walkthrough based on your use case', 'consultative', 'event'],
    ['Abandoned Checkout Recovery', 'conversion', 'You are one step away from activation', 'urgent', 'commerce'],
    ['NPS & Feedback Request', 'community', 'How can we improve your experience?', 'warm', 'digest'],
    ['Course Enrollment Launch', 'onboarding', 'Enrollment open: operator certification cohort', 'educational', 'event'],
    ['Conference Recap Brief', 'newsletter', 'Top conference takeaways you can apply today', 'editorial', 'digest'],
    ['Regional Expansion Notice', 'launch', 'Now available in your region with local support', 'bold', 'feature-grid'],
    ['Education Drip Sequence', 'onboarding', '30-day playbook to maximize value', 'helpful', 'metrics'],
    ['Executive Strategy Memo', 'report', 'Strategic priorities and operating targets', 'executive', 'story'],
    ['Customer Success Playbook', 'retention', 'How top teams get more value every week', 'credible', 'feature-grid'],
    ['Premium Plan Upgrade Offer', 'promotion', 'Exclusive upgrade pricing for growth-stage teams', 'urgent', 'commerce'],
    ['Operational Bulletin', 'company', 'Platform improvements and service commitments', 'clear', 'digest'],
    ['Compliance Policy Notice', 'security', 'Updated compliance controls now available', 'professional', 'story'],
];

const EMAIL_DEFAULTS = EMAIL_TOPIC_SEEDS.map(([title, category, subject, tone, layout], idx) => {
    const preheader = `${title} template inspired by top-performing ${category} campaigns.`;
    const ctaLabel = EMAIL_CTA_LABEL_BY_CATEGORY[category] || 'Learn More';
    const inspiredBy = EMAIL_PROVIDER_BENCHMARKS[idx % EMAIL_PROVIDER_BENCHMARKS.length];
    return {
        id: `email-${slugify(title)}`,
        title,
        category,
        subject,
        tone,
        layout,
        preheader,
        inspiredBy,
        ctaLabel,
        ctaUrl: '{{cta_url}}',
        highlights: EMAIL_LAYOUT_HIGHLIGHTS[layout] || EMAIL_LAYOUT_HIGHLIGHTS.story,
        palette: EMAIL_PALETTES[idx % EMAIL_PALETTES.length],
        blockVariant: EMAIL_BLOCK_VARIANTS[idx % EMAIL_BLOCK_VARIANTS.length],
    };
});

const RESUME_NAMES = [
    'Alex Morgan', 'Jordan Blake', 'Taylor Carter', 'Morgan Ellis', 'Avery Shaw', 'Casey Harper', 'Riley Jordan', 'Parker Lee',
    'Drew Bennett', 'Skyler Quinn', 'Rowan Hayes', 'Logan Reed', 'Emerson Wells', 'Harper Stone', 'Kendall Price', 'Jamie Turner',
    'Ari Collins', 'Blake Sutton', 'Sydney Brooks', 'Cameron Miles', 'Reese Jordan', 'Dakota Flynn', 'Payton Adams', 'Finley Moore',
    'Peyton Clarke', 'River Diaz', 'Kai Bennett', 'Noel Carter', 'Shawn Riley', 'Elliot Mason',
];

const RESUME_TEMPLATE_SEEDS = [
    ['Executive Board-Ready', 'executive', 'C-level operator scaling revenue, margin, and organizational performance.', '#1E3A8A', 'professional'],
    ['Product Strategist Premium', 'product', 'Product leader translating customer insight into category-defining products.', '#6D28D9', 'modern'],
    ['Engineering Architect', 'engineering', 'Engineering leader designing resilient systems and high-performing teams.', '#0F766E', 'classic'],
    ['Growth Marketing Operator', 'marketing', 'Growth operator driving measurable pipeline through full-funnel strategy.', '#C2410C', 'modern'],
    ['Product Design Lead', 'design', 'Design leader shipping elegant, accessible products with measurable impact.', '#BE185D', 'classic'],
    ['Data Analytics Consultant', 'data', 'Analytics specialist converting complex data into executive decisions.', '#1D4ED8', 'professional'],
    ['Revenue Operations Director', 'operations', 'Operations leader aligning GTM systems, forecasting, and execution.', '#0E7490', 'professional'],
    ['Enterprise Sales Leader', 'sales', 'Sales leader building predictable pipeline and multi-segment growth.', '#B45309', 'modern'],
    ['Customer Success Strategist', 'success', 'Customer strategist improving retention, expansion, and value realization.', '#7C3AED', 'modern'],
    ['Finance Transformation Manager', 'finance', 'Finance specialist improving planning, controls, and profitability.', '#1D4ED8', 'professional'],
    ['Digital Marketing Manager', 'marketing', 'Performance marketer scaling acquisition with measurable ROI.', '#EA580C', 'modern'],
    ['Cybersecurity Program Lead', 'security', 'Security leader hardening systems and incident resilience.', '#334155', 'professional'],
    ['Cloud Platform Engineer', 'engineering', 'Cloud engineer delivering scalable and fault-tolerant infrastructure.', '#0369A1', 'classic'],
    ['Consulting Engagement Manager', 'consulting', 'Consulting manager delivering transformation outcomes across teams.', '#0E7490', 'professional'],
    ['Operations Excellence Lead', 'operations', 'Process leader improving throughput, quality, and cost efficiency.', '#0F766E', 'classic'],
    ['Business Intelligence Manager', 'data', 'BI manager driving strategic decisions through reliable insights.', '#1D4ED8', 'modern'],
    ['HR Business Partner', 'hr', 'People partner scaling hiring, performance, and organizational capability.', '#9333EA', 'classic'],
    ['Legal Compliance Counsel', 'legal', 'Legal advisor balancing risk mitigation with operational speed.', '#475569', 'professional'],
    ['Program Delivery Director', 'project', 'Program director delivering mission-critical initiatives at scale.', '#C2410C', 'professional'],
    ['Customer Experience Manager', 'success', 'Experience leader elevating loyalty through service excellence.', '#7C3AED', 'modern'],
    ['Brand Marketing Lead', 'marketing', 'Brand builder combining narrative, positioning, and demand outcomes.', '#DB2777', 'classic'],
    ['Solutions Architect', 'engineering', 'Architect translating business goals into scalable technical systems.', '#0F766E', 'professional'],
    ['Product Operations Manager', 'product', 'Product operations leader optimizing roadmap execution and rituals.', '#6D28D9', 'modern'],
    ['Commercial Strategy Analyst', 'finance', 'Strategy analyst improving revenue planning and market prioritization.', '#1E40AF', 'classic'],
    ['Healthcare Operations Manager', 'healthcare', 'Healthcare operator improving outcomes, quality, and compliance.', '#0D9488', 'professional'],
    ['Education Program Director', 'education', 'Education leader designing measurable learning outcomes.', '#2563EB', 'modern'],
    ['Research Insights Lead', 'research', 'Research specialist converting studies into strategic recommendations.', '#6366F1', 'classic'],
    ['Agency Client Partner', 'consulting', 'Client partner driving delivery excellence and account growth.', '#0891B2', 'professional'],
    ['Startup Chief of Staff', 'executive', 'Chief of Staff aligning leadership priorities and execution cadence.', '#1E3A8A', 'modern'],
    ['General Business Manager', 'general', 'Versatile business manager delivering cross-functional outcomes.', '#374151', 'classic'],
];

const RESUME_STYLE_PRESETS = ['executive', 'clinical', 'slate', 'royal', 'compact', 'minimal'];

const RESUME_DEFAULTS = RESUME_TEMPLATE_SEEDS.map(([title, category, headline, accent], idx) => ({
    id: `resume-${slugify(title)}`,
    title,
    category,
    headline,
    accent,
    fullName: RESUME_NAMES[idx % RESUME_NAMES.length],
    stylePreset: RESUME_STYLE_PRESETS[idx % RESUME_STYLE_PRESETS.length],
}));

function renderEmailHtml(item) {
    const [bg, primary, accent] = item.palette;
    const highlights = (item.highlights || []).map((line) => `<li style="margin:0 0 6px;">${line}</li>`).join('');
    const featureBlock = item.layout === 'feature-grid'
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td width="33%" style="padding:12px;border:1px solid #1f2937;border-radius:10px;color:#cbd5e1;text-align:center;">Performance</td><td width="33%" style="padding:12px;border:1px solid #1f2937;border-radius:10px;color:#cbd5e1;text-align:center;">Automation</td><td width="33%" style="padding:12px;border:1px solid #1f2937;border-radius:10px;color:#cbd5e1;text-align:center;">Insights</td></tr></table>`
        : item.layout === 'metrics'
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="padding:10px 0;color:#93c5fd;"><strong style="font-size:18px;color:#fff;">68%</strong><br/><span style="font-size:12px;">Activation rate</span></td><td style="padding:10px 0;color:#93c5fd;"><strong style="font-size:18px;color:#fff;">2.1x</strong><br/><span style="font-size:12px;">Faster onboarding</span></td><td style="padding:10px 0;color:#93c5fd;"><strong style="font-size:18px;color:#fff;">14 days</strong><br/><span style="font-size:12px;">Time to ROI</span></td></tr></table>`
            : item.layout === 'event'
                ? `<div style="margin:18px 0;padding:14px;border:1px solid #1f2937;border-radius:10px;background:#0f172a;"><p style="margin:0 0 6px;color:#cbd5e1;font-size:13px;"><strong>Date:</strong> {{event_date}}</p><p style="margin:0 0 6px;color:#cbd5e1;font-size:13px;"><strong>Time:</strong> {{event_time}}</p><p style="margin:0;color:#cbd5e1;font-size:13px;"><strong>Format:</strong> Live virtual session + Q&A</p></div>`
                : item.layout === 'commerce'
                    ? `<div style="margin:18px 0;padding:14px;border:1px solid #1f2937;border-radius:10px;background:#111827;"><p style="margin:0 0 8px;color:#fde68a;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Limited Offer</p><p style="margin:0;color:#e5e7eb;font-size:14px;line-height:1.6;">Use code <strong>{{promo_code}}</strong> before {{expiry_date}} for priority pricing.</p></div>`
                    : item.layout === 'story'
                        ? `<blockquote style="margin:18px 0;padding:14px;border-left:3px solid ${accent};background:#0f172a;color:#d1d5db;font-size:14px;line-height:1.7;">"The team improved retention by 32% after implementing this workflow in under six weeks."</blockquote>`
                        : `<div style="margin:18px 0;padding:14px;border:1px solid #1f2937;border-radius:10px;background:#0f172a;"><p style="margin:0;color:#d1d5db;font-size:14px;line-height:1.7;">Built for high-readability communication and predictable campaign performance.</p></div>`;

    const variantBlock = item.blockVariant === 'timeline'
        ? `<div style="margin:18px 0;padding:14px;border:1px solid #1f2937;border-radius:10px;background:#0b1220;"><p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#93c5fd;">Campaign Timeline</p><p style="margin:0 0 6px;color:#e5e7eb;font-size:13px;">1) Kickoff briefing</p><p style="margin:0 0 6px;color:#e5e7eb;font-size:13px;">2) Asset personalization</p><p style="margin:0 0 6px;color:#e5e7eb;font-size:13px;">3) Performance optimization sprint</p><p style="margin:0;color:#e5e7eb;font-size:13px;">4) Executive outcomes summary</p></div>`
        : item.blockVariant === 'checklist'
            ? `<div style="margin:18px 0;padding:14px;border:1px solid #1f2937;border-radius:10px;background:#111827;"><p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#86efac;">Launch Checklist</p><ul style="margin:0 0 0 18px;padding:0;color:#e5e7eb;font-size:13px;line-height:1.7;"><li>Audience segmentation complete</li><li>Brand assets aligned</li><li>Tracking and UTM plan verified</li><li>Follow-up automation enabled</li></ul></div>`
            : item.blockVariant === 'split-panel'
                ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr><td width="50%" style="padding:12px;border:1px solid #1f2937;border-radius:10px 0 0 10px;background:#0f172a;color:#dbeafe;"><p style="margin:0 0 5px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Before</p><p style="margin:0;font-size:13px;line-height:1.6;">Manual workflows, delayed handoffs, limited visibility.</p></td><td width="50%" style="padding:12px;border:1px solid #1f2937;border-left:0;border-radius:0 10px 10px 0;background:#111827;color:#dcfce7;"><p style="margin:0 0 5px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">After</p><p style="margin:0;font-size:13px;line-height:1.6;">Automated cadence, aligned owners, measurable pipeline impact.</p></td></tr></table>`
                : item.blockVariant === 'testimonial'
                    ? `<div style="margin:18px 0;padding:14px;border:1px solid #1f2937;border-radius:10px;background:#0b1220;"><p style="margin:0 0 8px;color:#fef3c7;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Customer Voice</p><blockquote style="margin:0;color:#e5e7eb;font-size:14px;line-height:1.75;">\"Implementation was smooth, and we saw stronger conversion signals within the first two weeks.\"</blockquote><p style="margin:8px 0 0;color:#93c5fd;font-size:12px;">VP Growth, Mid-market SaaS</p></div>`
                    : item.blockVariant === 'comparison'
                        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border-collapse:collapse;"><tr><th style="text-align:left;padding:10px;border:1px solid #1f2937;color:#93c5fd;font-size:12px;">Metric</th><th style="text-align:left;padding:10px;border:1px solid #1f2937;color:#93c5fd;font-size:12px;">Previous</th><th style="text-align:left;padding:10px;border:1px solid #1f2937;color:#93c5fd;font-size:12px;">Current</th></tr><tr><td style="padding:10px;border:1px solid #1f2937;color:#e5e7eb;font-size:13px;">Response Time</td><td style="padding:10px;border:1px solid #1f2937;color:#9ca3af;font-size:13px;">48h</td><td style="padding:10px;border:1px solid #1f2937;color:#dcfce7;font-size:13px;">8h</td></tr><tr><td style="padding:10px;border:1px solid #1f2937;color:#e5e7eb;font-size:13px;">Qualified Leads</td><td style="padding:10px;border:1px solid #1f2937;color:#9ca3af;font-size:13px;">112/mo</td><td style="padding:10px;border:1px solid #1f2937;color:#dcfce7;font-size:13px;">187/mo</td></tr></table>`
                        : item.blockVariant === 'spotlight'
                            ? `<div style="margin:18px 0;padding:14px;border:1px solid #1f2937;border-radius:10px;background:linear-gradient(140deg, rgba(59,130,246,.15), rgba(34,211,238,.08));"><p style="margin:0 0 6px;color:#bfdbfe;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Spotlight</p><p style="margin:0;color:#e5e7eb;font-size:14px;line-height:1.7;">This template emphasizes one strategic announcement with sharp hierarchy and a focused CTA path.</p></div>`
                            : item.blockVariant === 'steps'
                                ? `<div style="margin:18px 0;padding:14px;border:1px solid #1f2937;border-radius:10px;background:#111827;"><p style="margin:0 0 8px;color:#93c5fd;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">3-Step Action Plan</p><p style="margin:0 0 6px;color:#e5e7eb;font-size:13px;"><strong>Step 1:</strong> Review your readiness score.</p><p style="margin:0 0 6px;color:#e5e7eb;font-size:13px;"><strong>Step 2:</strong> Activate the recommended workflow.</p><p style="margin:0;color:#e5e7eb;font-size:13px;"><strong>Step 3:</strong> Track impact weekly with executive reporting.</p></div>`
                                : item.blockVariant === 'faq'
                                    ? `<div style="margin:18px 0;padding:14px;border:1px solid #1f2937;border-radius:10px;background:#0f172a;"><p style="margin:0 0 8px;color:#93c5fd;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Quick FAQ</p><p style="margin:0 0 6px;color:#e5e7eb;font-size:13px;"><strong>How long to launch?</strong> Usually in under 7 days.</p><p style="margin:0 0 6px;color:#e5e7eb;font-size:13px;"><strong>Can we customize branding?</strong> Yes, fully editable.</p><p style="margin:0;color:#e5e7eb;font-size:13px;"><strong>What support is included?</strong> Guided onboarding + best-practice playbook.</p></div>`
                                    : item.blockVariant === 'roadmap'
                                        ? `<div style="margin:18px 0;padding:14px;border:1px solid #1f2937;border-radius:10px;background:#111827;"><p style="margin:0 0 8px;color:#93c5fd;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Quarterly Roadmap</p><p style="margin:0 0 6px;color:#e5e7eb;font-size:13px;">Q1: Foundation and instrumentation</p><p style="margin:0 0 6px;color:#e5e7eb;font-size:13px;">Q2: Automation and velocity gains</p><p style="margin:0 0 6px;color:#e5e7eb;font-size:13px;">Q3: Expansion and optimization</p><p style="margin:0;color:#e5e7eb;font-size:13px;">Q4: Scale and executive reporting</p></div>`
                                        : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr><td style="padding:12px;border:1px solid #1f2937;border-radius:10px;background:#0f172a;color:#dbeafe;"><p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Scoreboard</p><p style="margin:0;color:#e5e7eb;font-size:13px;">Open rate 42% | CTR 11% | Reply rate 7.8%</p></td></tr></table>`;

    return `<!doctype html>
<html>
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${bg};font-family:Arial,Helvetica,sans-serif;color:#E5E7EB;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;border-radius:16px;overflow:hidden;background:#111827;border:1px solid #1F2937;">
        <tr>
                    <td style="padding:20px 28px 28px;background:linear-gradient(120deg, ${primary}, ${accent});">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;">
                            <img src="${item.logoUrl || ''}" alt="Brand Logo" style="height:28px;max-width:180px;object-fit:contain;" />
                            <div style="font-size:11px;letter-spacing:1.8px;text-transform:uppercase;opacity:.9;">${item.category}</div>
                        </div>
            <h1 style="margin:10px 0 6px;font-size:30px;line-height:1.2;color:white;">${item.title}</h1>
            <p style="margin:0;font-size:15px;line-height:1.6;color:rgba(255,255,255,.9);">${item.subject}</p>
          </td>
        </tr>
                <tr>
                    <td style="padding:0;background:#0B1220;">
                        <div style="background-image:linear-gradient(to right, rgba(11,18,32,.88), rgba(11,18,32,.45)),url('${item.backgroundImageUrl || ''}');background-size:cover;background-position:center;padding:18px 26px;">
                                                        <p style="margin:0;font-size:12px;color:#E2E8F0;line-height:1.65;">${item.previewText || 'Build trust fast with a premium campaign layout. Replace text, swap media, and publish in minutes.'}</p>
                        </div>
                    </td>
                </tr>
        <tr><td style="padding:26px;">
          <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#D1D5DB;">Hi {{first_name}},</p>
                                        <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#D1D5DB;">This is a premium ${item.tone} campaign framework designed for strong clarity, conversion, and brand trust.</p>
                                        ${featureBlock}
                                        ${variantBlock}
                                        <ul style="margin:0 0 18px 18px;padding:0;color:#D1D5DB;font-size:14px;line-height:1.6;">${highlights}</ul>
                    <a href="${item.ctaUrl || '{{cta_url}}'}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:${primary};color:white;text-decoration:none;font-weight:700;">${item.ctaLabel || '{{cta_text}}'}</a>
        </td></tr>
        <tr><td style="padding:22px 26px;border-top:1px solid #1F2937;color:#9CA3AF;font-size:12px;line-height:1.6;">{{company_name}} · {{company_address}} · <a href="{{unsubscribe_url}}" style="color:#9CA3AF;">Unsubscribe</a></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildEmailDefaultTemplates() {
    return EMAIL_DEFAULTS.map((item, idx) => {
        const logoSeed = DUMMY_MEDIA.logos[idx % DUMMY_MEDIA.logos.length] || item.title;
        const logoUrl = createDummyLogoDataUri(logoSeed);
        const backgroundImageUrl = DUMMY_MEDIA.backgrounds[idx % DUMMY_MEDIA.backgrounds.length];
        return {
        defaultId: item.id,
        kind: 'email',
        title: item.title,
        description: `${item.preheader} Inspired by ${item.inspiredBy}. (${item.tone})`,
        category: item.category,
        tags: [item.category, item.tone, item.layout, 'email', 'premium', slugify(item.inspiredBy || 'benchmark')],
        design: {
            palette: item.palette,
            logoUrl,
            backgroundImageUrl,
            ctaStyle: 'rounded-lg',
        },
        content: {
            subject: item.subject,
            previewText: item.preheader,
            logoUrl,
            backgroundImageUrl,
            html: renderEmailHtml({ ...item, logoUrl, backgroundImageUrl }),
        },
        };
    });
}

function buildResumeContent(item, idx) {
    const skillNamesByCategory = {
        executive: ['P&L Ownership', 'Executive Communication', 'Strategic Planning', 'Turnaround Leadership', 'Board Reporting', 'Operating Model Design', 'M&A Integration', 'Risk Governance', 'Org Design', 'Performance Management', 'Capital Planning', 'Transformation Delivery'],
        product: ['Product Strategy', 'Roadmapping', 'User Research', 'Experimentation', 'Cross-Functional Leadership', 'Analytics', 'Product Discovery', 'Prioritization', 'Go-to-Market Planning', 'Lifecycle Management', 'Stakeholder Alignment', 'Outcome Tracking'],
        engineering: ['System Architecture', 'Cloud Platforms', 'CI/CD', 'Reliability Engineering', 'Performance Tuning', 'Mentoring', 'Distributed Systems', 'API Design', 'Observability', 'Security Engineering', 'Infrastructure Automation', 'Technical Leadership'],
        marketing: ['Demand Generation', 'Lifecycle Campaigns', 'Positioning', 'Paid Acquisition', 'Attribution', 'Growth Experiments', 'Brand Strategy', 'Content Operations', 'Marketing Analytics', 'Funnel Optimization', 'CRM Workflows', 'ABM Strategy'],
        design: ['Design Strategy', 'Design Systems', 'UX Research', 'Prototyping', 'Accessibility', 'Stakeholder Facilitation', 'Interaction Design', 'Journey Mapping', 'Visual Direction', 'Usability Testing', 'Information Architecture', 'Design Operations'],
        data: ['SQL', 'Forecasting', 'Dashboarding', 'Statistical Analysis', 'Data Storytelling', 'Business Insighting', 'Python Analytics', 'KPI Modeling', 'Data Governance', 'A/B Testing', 'Scenario Analysis', 'Executive Reporting'],
        operations: ['Process Optimization', 'SOP Design', 'Resource Planning', 'Cross-Functional Coordination', 'KPI Governance', 'Capacity Planning', 'Program Execution', 'Service Quality', 'Continuous Improvement', 'Vendor Management', 'Operational Analytics', 'Budget Oversight'],
        sales: ['Pipeline Management', 'Enterprise Negotiation', 'Account Strategy', 'Sales Forecasting', 'Deal Structuring', 'Stakeholder Mapping', 'Sales Enablement', 'CRM Hygiene', 'Discovery Frameworks', 'Objection Handling', 'Value Selling', 'Renewal Expansion'],
        success: ['Customer Lifecycle', 'Onboarding Strategy', 'QBR Management', 'Health Scoring', 'Renewal Planning', 'Expansion Strategy', 'Voice of Customer', 'Escalation Management', 'Value Realization', 'Customer Education', 'Account Governance', 'Retention Analytics'],
        finance: ['Financial Modeling', 'Budget Planning', 'Variance Analysis', 'Forecast Management', 'Cash Flow Controls', 'Reporting Automation', 'Unit Economics', 'Scenario Planning', 'Compliance Controls', 'Cost Optimization', 'Board Pack Preparation', 'Capital Allocation'],
        consulting: ['Executive Facilitation', 'Diagnostic Assessment', 'Transformation Planning', 'Operating Model Design', 'PMO Governance', 'Stakeholder Advisory', 'Workshop Leadership', 'Problem Structuring', 'Business Case Development', 'Delivery Management', 'Change Enablement', 'Outcome Measurement'],
        hr: ['Talent Acquisition', 'Performance Management', 'Compensation Planning', 'People Analytics', 'Org Design', 'Leadership Coaching', 'Employee Relations', 'L&D Programs', 'Culture Initiatives', 'Succession Planning', 'Policy Governance', 'Workforce Planning'],
        legal: ['Contract Negotiation', 'Regulatory Compliance', 'Risk Assessment', 'Policy Drafting', 'Privacy Frameworks', 'Corporate Governance', 'Litigation Support', 'Stakeholder Counsel', 'Commercial Advisory', 'Due Diligence', 'Dispute Resolution', 'Compliance Audits'],
        education: ['Curriculum Design', 'Instructional Leadership', 'Assessment Strategy', 'Learner Engagement', 'Program Evaluation', 'Academic Governance', 'Faculty Development', 'Learning Analytics', 'Policy Implementation', 'Parent Stakeholder Collaboration', 'Intervention Planning', 'Outcome Reporting'],
        healthcare: ['Clinical Operations', 'Patient Outcomes', 'Compliance Management', 'Care Coordination', 'Quality Programs', 'Process Standardization', 'Healthcare Analytics', 'Regulatory Documentation', 'Service Improvement', 'Risk Mitigation', 'Capacity Planning', 'Operational Reporting'],
        security: ['Incident Response', 'Threat Modeling', 'Security Audits', 'Identity Access Management', 'Vulnerability Management', 'Security Awareness', 'Policy Governance', 'Cloud Security', 'SOC Coordination', 'Control Monitoring', 'Risk Prioritization', 'Response Playbooks'],
        research: ['Research Design', 'Hypothesis Development', 'Data Collection', 'Qualitative Analysis', 'Quantitative Analysis', 'Insight Reporting', 'Literature Review', 'Experimental Methods', 'Stakeholder Briefings', 'Publication Support', 'Research Governance', 'Recommendations Synthesis'],
        project: ['Program Planning', 'Scope Governance', 'Risk Management', 'Dependency Mapping', 'Stakeholder Communication', 'Budget Oversight', 'Milestone Tracking', 'Agile Delivery', 'Change Control', 'Issue Resolution', 'Resource Allocation', 'Executive Reporting'],
        general: ['Communication', 'Execution', 'Leadership', 'Analysis', 'Collaboration', 'Planning', 'Strategic Thinking', 'Stakeholder Management', 'Problem Solving', 'Project Coordination', 'Data Literacy', 'Adaptability'],
    };
    const skillNames = skillNamesByCategory[item.category] || skillNamesByCategory.general;
    const fullName = item.fullName || 'Professional Candidate';
    const profilePhotoUrl = DUMMY_MEDIA.profilePhotos[idx % DUMMY_MEDIA.profilePhotos.length];
    const accent = item.accent;
    const roleMap = {
        executive: ['Chief Operating Officer', 'VP Operations', 'Director, Strategic Initiatives', 'Senior Program Manager'],
        product: ['Principal Product Manager', 'Senior Product Manager', 'Product Operations Manager', 'Associate Product Manager'],
        engineering: ['Staff Software Engineer', 'Senior Software Engineer', 'Software Engineer II', 'Software Engineer I'],
        marketing: ['Growth Marketing Lead', 'Senior Performance Marketer', 'Lifecycle Marketing Manager', 'Marketing Specialist'],
        design: ['Lead Product Designer', 'Senior Product Designer', 'Product Designer', 'UX Designer'],
        data: ['Lead Data Analyst', 'Senior Data Analyst', 'Business Intelligence Analyst', 'Data Analyst'],
        operations: ['Operations Director', 'Senior Operations Manager', 'Operations Manager', 'Operations Analyst'],
        sales: ['Enterprise Sales Director', 'Senior Account Executive', 'Account Executive', 'Business Development Representative'],
        success: ['Customer Success Director', 'Senior Customer Success Manager', 'Customer Success Manager', 'Customer Success Associate'],
        finance: ['Finance Transformation Manager', 'Senior Financial Analyst', 'Financial Analyst', 'Finance Associate'],
        consulting: ['Engagement Manager', 'Senior Consultant', 'Consultant', 'Analyst'],
        hr: ['HR Business Partner', 'Senior Talent Manager', 'Talent Acquisition Manager', 'People Operations Specialist'],
        legal: ['Legal Compliance Counsel', 'Senior Legal Counsel', 'Legal Associate', 'Compliance Analyst'],
        education: ['Program Director', 'Senior Education Manager', 'Curriculum Specialist', 'Program Coordinator'],
        healthcare: ['Healthcare Operations Manager', 'Senior Program Manager', 'Clinical Operations Lead', 'Operations Coordinator'],
        security: ['Security Program Lead', 'Senior Security Analyst', 'Security Analyst', 'Security Operations Specialist'],
        research: ['Research Insights Lead', 'Senior Research Analyst', 'Research Analyst', 'Research Associate'],
        project: ['Program Delivery Director', 'Senior Project Manager', 'Project Manager', 'Project Coordinator'],
        general: ['Business Manager', 'Senior Manager', 'Manager', 'Specialist'],
    };
    const roleTrack = roleMap[item.category] || roleMap.general;

    const experiences = [
        {
            id: 1,
            title: roleTrack[0],
            company: item.category === 'executive' ? 'Northstar Group' : 'Northstar Collective',
            period: '2022 - Present',
            description: '<ul><li>Led organization-wide initiatives that improved core business KPIs by 25%+ year over year.</li><li>Built aligned operating rhythms across product, operations, finance, and leadership teams.</li><li>Established reporting and governance standards that reduced delivery risk and improved decision speed.</li></ul>',
        },
        {
            id: 2,
            title: roleTrack[1],
            company: 'Summit Ventures',
            period: '2018 - 2022',
            description: '<ul><li>Delivered multiple high-impact launches and process improvements across cross-functional teams.</li><li>Standardized planning cadences and scorecards adopted by multiple business units.</li><li>Mentored team members and built development plans tied to measurable outcomes.</li></ul>',
        },
        {
            id: 3,
            title: roleTrack[2],
            company: 'Crestline Partners',
            period: '2015 - 2018',
            description: '<ul><li>Built foundational processes and reporting that improved planning quality and execution predictability.</li><li>Collaborated with cross-functional stakeholders to define KPIs and accountability models.</li><li>Supported multiple transformation initiatives under tight timelines and resource constraints.</li></ul>',
        },
        {
            id: 4,
            title: roleTrack[3],
            company: 'Pioneer Labs',
            period: '2012 - 2015',
            description: '<ul><li>Contributed to mission-critical projects and documented best practices adopted by broader teams.</li><li>Analyzed operational data to identify opportunities for efficiency and quality gains.</li><li>Coordinated execution with senior stakeholders and delivered measurable project outcomes.</li></ul>',
        },
    ];

    const education = [
        {
            id: 1,
            degree: 'Master of Business Administration',
            school: 'Metro School of Management',
            year: '2018',
            details: '<p>Focus: strategy, leadership, and analytics.</p>',
        },
        {
            id: 2,
            degree: 'Bachelor of Science',
            school: 'State University',
            year: '2014',
            details: '<p>Graduated with honors.</p>',
        },
        {
            id: 3,
            degree: 'Professional Certification',
            school: item.category === 'engineering' ? 'Cloud Architecture Institute' : 'Global Professional Academy',
            year: '2021',
            details: '<p>Advanced coursework in leadership, execution, and domain specialization.</p>',
        },
    ];

    const skills = skillNames.map((name, skillIndex) => ({
        id: skillIndex + 1,
        name,
        proficiency: skillIndex < 2 ? 'Expert' : skillIndex < 4 ? 'Advanced' : 'Intermediate',
    }));

    const advancedSectionsByCategory = {
        executive: {
            projects: [
                { name: 'Enterprise Margin Expansion Program', year: '2025', summary: 'Re-architected operating model and improved EBITDA margin by 6.2 points.' },
                { name: 'Regional Integration Office', year: '2023', summary: 'Directed post-merger integration across 4 business units and 1,200+ staff.' },
            ],
            certifications: ['INSEAD Executive Leadership Program', 'Balanced Scorecard Professional'],
            publications: ['Board Governance in High-Growth Markets, 2024'],
            awards: ['Top 50 COO Leaders - Industry Review, 2025'],
        },
        engineering: {
            projects: [
                { name: 'Reliability Platform Overhaul', year: '2024', summary: 'Reduced incident volume by 41% through observability and service ownership standards.' },
                { name: 'Multi-Region Deployment Program', year: '2022', summary: 'Implemented resilient global deployment strategy with <99.95% uptime.' },
            ],
            certifications: ['AWS Solutions Architect Professional', 'CKA: Certified Kubernetes Administrator'],
            publications: ['Designing Fault-Tolerant Service Meshes, 2023'],
            awards: ['Engineering Excellence Award, 2024'],
        },
        product: {
            projects: [
                { name: 'Self-Serve Expansion Suite', year: '2025', summary: 'Shipped onboarding and pricing experiments that grew trial-to-paid conversion by 28%.' },
                { name: 'Customer Voice Intelligence', year: '2023', summary: 'Unified research and support signals into a product-prioritization framework.' },
            ],
            certifications: ['Pragmatic Product Management', 'Product School - Product Leadership'],
            publications: ['From Discovery to Delivery Metrics, 2024'],
            awards: ['Product Impact Award, 2025'],
        },
        marketing: {
            projects: [
                { name: 'Lifecycle Revenue Engine', year: '2025', summary: 'Built segmented lifecycle journeys that increased expansion revenue by 21%.' },
                { name: 'Brand + Demand Unification', year: '2023', summary: 'Aligned content and performance channels to improve pipeline efficiency.' },
            ],
            certifications: ['Google Ads Certification', 'HubSpot Marketing Software'],
            publications: ['Attribution That Executives Trust, 2024'],
            awards: ['Growth Campaign of the Year, 2025'],
        },
        data: {
            projects: [
                { name: 'Executive KPI Command Center', year: '2024', summary: 'Delivered standardized reporting used by leadership for weekly decision forums.' },
                { name: 'Forecast Accuracy Initiative', year: '2022', summary: 'Raised forecast precision by 19% through model and process redesign.' },
            ],
            certifications: ['Microsoft Power BI Data Analyst', 'dbt Fundamentals'],
            publications: ['Operational Analytics Playbook, 2023'],
            awards: ['Data Excellence Recognition, 2024'],
        },
        general: {
            projects: [
                { name: 'Cross-Functional Transformation Sprint', year: '2024', summary: 'Coordinated teams to improve service quality, cycle time, and stakeholder visibility.' },
                { name: 'Performance Operating System', year: '2022', summary: 'Defined cadence, scorecards, and accountability for strategic initiatives.' },
            ],
            certifications: ['Project Management Professional (PMP)', 'Lean Six Sigma Green Belt'],
            publications: ['Execution Rhythm for Growing Teams, 2024'],
            awards: ['High Impact Leader Award, 2025'],
        },
    };
    const advanced = advancedSectionsByCategory[item.category] || advancedSectionsByCategory.general;
    const stylePreset = item.stylePreset || RESUME_STYLE_PRESETS[idx % RESUME_STYLE_PRESETS.length];
    const slugName = fullName.toLowerCase().replace(/\s+/g, '.');
    const languages = [
        { name: 'English', level: 'Fluent' },
        { name: 'Spanish', level: idx % 2 === 0 ? 'Professional' : 'Intermediate' },
    ];
    const references = [
        { name: 'Estelle Darcy', role: 'VP Operations', company: 'Northstar Group', phone: '+1 (555) 321-1010', email: 'estelle.darcy@example.com' },
        { name: 'William Chen', role: 'Director', company: 'Summit Ventures', phone: '+1 (555) 443-8921', email: 'william.chen@example.com' },
    ];
    const softSkills = ['Strategic Communication', 'Stakeholder Leadership', 'Decision-Making', 'Mentoring', 'Cross-Functional Alignment', 'Conflict Resolution'];

    return {
        fullName,
        designation: roleTrack[0],
        email: `${slugName}@example.com`,
        phone: '+1 (555) 274-9981',
        location: item.category === 'data' ? 'Chicago, IL' : 'New York, NY',
        address: item.category === 'data' ? '220 Analytics Ave, Chicago, IL 60607' : '45 Madison Ave, New York, NY 10010',
        website: `www.${slugName.replace(/\./g, '')}.com`,
        linkedin: `linkedin.com/in/${slugName.replace(/\./g, '-')}`,
        nationality: 'American',
        age: 30 + (idx % 9),
        headline: item.headline,
        summary: `<p>${item.headline} 10+ years building high-performing teams, driving strategic execution, and delivering measurable commercial outcomes across complex environments.</p>`,
        profilePhotoUrl,
        experiences,
        education,
        skills,
        languages,
        references,
        softSkills,
        sections: {
            experience: experiences.map((exp) => ({
                role: exp.title,
                company: exp.company,
                period: exp.period,
                bullets: [
                    'Delivered measurable impact across critical business initiatives.',
                    'Aligned stakeholders around clear milestones and outcomes.',
                    'Implemented scalable processes and reporting standards.',
                ],
            })),
            education: education.map((edu) => ({
                school: edu.school,
                degree: edu.degree,
                year: edu.year,
            })),
            skills: skillNames,
            languages,
            references,
            softSkills,
            projects: advanced.projects,
            certifications: advanced.certifications,
            publications: advanced.publications,
            awards: advanced.awards,
        },
        designation: roleTrack[0],
        projects: advanced.projects,
        certifications: advanced.certifications,
        publications: advanced.publications,
        awards: advanced.awards,
        design: {
            accentColor: accent,
            stylePreset,
        },
        stylePreset,
    };
}

function buildResumeDefaultTemplates() {
    return RESUME_DEFAULTS.map((item, idx) => ({
        defaultId: item.id,
        kind: 'resume',
        title: item.title,
        description: item.headline,
        category: item.category,
        tags: [item.category, 'resume', 'career'],
        design: {
            accentColor: item.accent,
            layout: idx % 2 === 0 ? 'two-column' : 'single-column',
            logoUrl: DUMMY_MEDIA.profilePhotos[idx % DUMMY_MEDIA.profilePhotos.length],
            backgroundImageUrl: DUMMY_MEDIA.backgrounds[idx % DUMMY_MEDIA.backgrounds.length],
            stylePreset: item.stylePreset,
            themeVariant: item.id,
        },
        content: buildResumeContent(item, idx),
    }));
}

const DEFAULT_TEMPLATE_LIBRARY = {
    email: buildEmailDefaultTemplates(),
    resume: buildResumeDefaultTemplates(),
};

function getDefaultTemplates(kind) {
    if (kind && DEFAULT_TEMPLATE_LIBRARY[kind]) return DEFAULT_TEMPLATE_LIBRARY[kind];
    return [...DEFAULT_TEMPLATE_LIBRARY.email, ...DEFAULT_TEMPLATE_LIBRARY.resume];
}

function normalizeKind(value) {
    return value === 'resume' ? 'resume' : 'email';
}

const TEMPLATE_PLAN_LIMITS = {
    starter: 6,
    growth: 15,
    agency: Number.POSITIVE_INFINITY,
};

function resolveTemplatePlanId(user) {
    if (!user) return 'starter';
    if (user.role === 'admin') return 'agency';
    const plan = String(user?.subscription?.plan || '').trim().toLowerCase();
    if (['starter', 'growth', 'agency'].includes(plan)) return plan;
    return 'starter';
}

function getTemplateLimitForUser(user) {
    const planId = resolveTemplatePlanId(user);
    return TEMPLATE_PLAN_LIMITS[planId] ?? TEMPLATE_PLAN_LIMITS.starter;
}

function formatTemplateLimit(limit) {
    return Number.isFinite(limit) ? String(limit) : 'Unlimited';
}

function normalizeTemplatePayload(payload = {}, kind = 'email') {
    return {
        kind,
        title: String(payload.title || '').trim(),
        description: String(payload.description || '').trim(),
        category: String(payload.category || 'general').trim(),
        content: payload.content && typeof payload.content === 'object' ? payload.content : {},
        design: payload.design && typeof payload.design === 'object' ? payload.design : {},
        thumbnailUrl: String(payload.thumbnailUrl || '').trim(),
        tags: Array.isArray(payload.tags) ? payload.tags.map((t) => String(t).trim()).filter(Boolean) : [],
        isFavorite: Boolean(payload.isFavorite),
        status: payload.status === 'archived' ? 'archived' : 'active',
    };
}

async function resolveImportSource({ sourceType, sourceId, kind }) {
    const normalizedKind = normalizeKind(kind);
    if (sourceType === 'default') {
        const source = getDefaultTemplates(normalizedKind).find((item) => item.defaultId === String(sourceId));
        if (!source) return null;
        return {
            sourceType: 'default',
            source,
            metadata: {
                sourceDefaultId: source.defaultId,
                sourceAdminTemplateId: '',
                importedFromDefault: true,
                importedFromAdmin: false,
            },
        };
    }

    if (sourceType === 'admin') {
        const adminTemplate = await AdminTemplate.findOne({ _id: sourceId, kind: normalizedKind, isPublished: true }).lean();
        if (!adminTemplate) return null;
        return {
            sourceType: 'admin',
            source: {
                kind: adminTemplate.kind,
                title: adminTemplate.title,
                description: adminTemplate.description,
                category: adminTemplate.category,
                content: adminTemplate.content,
                design: adminTemplate.design,
                tags: adminTemplate.tags,
                thumbnailUrl: adminTemplate.thumbnailUrl,
            },
            metadata: {
                sourceDefaultId: '',
                sourceAdminTemplateId: String(adminTemplate._id),
                importedFromDefault: false,
                importedFromAdmin: true,
            },
        };
    }

    return null;
}

async function upsertTemplateFromSource({ userId, sourceType, sourceId, kind, allowCreate = true }) {
    const resolved = await resolveImportSource({ sourceType, sourceId, kind });
    if (!resolved) return null;

    const source = resolved.source;
    const uniqueQuery = {
        user: userId,
        kind: source.kind,
        ...(resolved.sourceType === 'default'
            ? { sourceDefaultId: resolved.metadata.sourceDefaultId }
            : { sourceAdminTemplateId: resolved.metadata.sourceAdminTemplateId }),
    };

    const exists = await Template.findOne(uniqueQuery);
    if (exists) {
        return { template: exists, created: false, skippedDueToQuota: false };
    }

    if (!allowCreate) {
        return { template: null, created: false, skippedDueToQuota: true };
    }

    const created = await Template.create({
        user: userId,
        kind: source.kind,
        title: source.title,
        description: source.description,
        category: source.category,
        content: source.content,
        design: source.design,
        tags: source.tags,
        thumbnailUrl: source.thumbnailUrl || '',
        ...resolved.metadata,
    });

    return { template: created, created: true, skippedDueToQuota: false };
}

async function saveLocalUpload(file, userId) {
    await fs.mkdir(uploadsDir, { recursive: true });
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    const safeExt = ext.length <= 5 ? ext : '.png';
    const filename = `${userId}-${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`;
    const absPath = path.join(uploadsDir, filename);
    await fs.writeFile(absPath, file.buffer);
    return {
        url: `/uploads/templates/${filename}`,
        storage: 'local',
        publicId: '',
        width: 0,
        height: 0,
    };
}

async function uploadToCloudinary(file, userId, kind) {
    const cloudinaryUrl = process.env.CLOUDINARY_URL;
    if (!cloudinaryUrl) return null;

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: `udigify/users/${userId}/${kind}`,
                resource_type: 'image',
            },
            (error, result) => {
                if (error || !result) return reject(error || new Error('Cloudinary upload failed'));
                resolve({
                    url: result.secure_url,
                    storage: 'cloudinary',
                    publicId: result.public_id,
                    width: result.width || 0,
                    height: result.height || 0,
                });
            }
        );
        stream.end(file.buffer);
    });
}

router.get('/defaults', protect, (req, res) => {
    const kind = req.query.kind;
    if (kind && !['email', 'resume'].includes(kind)) {
        return res.status(400).json({ message: 'Invalid template kind' });
    }

    const limit = getTemplateLimitForUser(req.user);
    const visibleDefaults = getDefaultTemplates(kind);
    const defaultsData = Number.isFinite(limit) ? visibleDefaults.slice(0, limit) : visibleDefaults;

    return res.json({
        counts: {
            email: Number.isFinite(limit) ? Math.min(DEFAULT_TEMPLATE_LIBRARY.email.length, limit) : DEFAULT_TEMPLATE_LIBRARY.email.length,
            resume: Number.isFinite(limit) ? Math.min(DEFAULT_TEMPLATE_LIBRARY.resume.length, limit) : DEFAULT_TEMPLATE_LIBRARY.resume.length,
        },
        planLimit: formatTemplateLimit(limit),
        data: defaultsData,
    });
});

router.get('/library', protect, async (req, res) => {
    try {
        const kind = req.query.kind;
        if (kind && !['email', 'resume'].includes(kind)) {
            return res.status(400).json({ message: 'Invalid template kind' });
        }

        const selectedKind = kind || null;
        const [adminTemplates, userTemplates, kits] = await Promise.all([
            AdminTemplate.find({
                isPublished: true,
                ...(selectedKind ? { kind: selectedKind } : {}),
            }).sort({ updatedAt: -1 }).lean(),
            Template.find({
                user: req.user._id,
                ...(selectedKind ? { kind: selectedKind } : {}),
            }).sort({ updatedAt: -1 }).lean(),
            TemplateKit.find({
                user: req.user._id,
                ...(selectedKind ? { kind: selectedKind } : {}),
            }).sort({ updatedAt: -1 }).lean(),
        ]);

        const templateLimit = getTemplateLimitForUser(req.user);
        const rawDefaults = getDefaultTemplates(selectedKind);
        const defaults = Number.isFinite(templateLimit) ? rawDefaults.slice(0, templateLimit) : rawDefaults;

        return res.json({
            data: {
                defaults,
                adminTemplates,
                userTemplates,
                kits,
            },
            limits: {
                templates: formatTemplateLimit(templateLimit),
                templatesUsed: userTemplates.length,
                templatesRemaining: Number.isFinite(templateLimit)
                    ? Math.max(templateLimit - userTemplates.length, 0)
                    : 'Unlimited',
            },
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load template library' });
    }
});

router.get('/', protect, async (req, res) => {
    try {
        const kind = req.query.kind;
        const onlyFavorites = String(req.query.favorites || '').toLowerCase() === 'true';
        const q = String(req.query.q || '').trim();

        const query = {
            user: req.user._id,
            ...(kind && ['email', 'resume'].includes(kind) ? { kind } : {}),
            ...(onlyFavorites ? { isFavorite: true } : {}),
        };

        if (q) {
            query.$or = [
                { title: { $regex: q, $options: 'i' } },
                { description: { $regex: q, $options: 'i' } },
                { category: { $regex: q, $options: 'i' } },
                { tags: { $elemMatch: { $regex: q, $options: 'i' } } },
            ];
        }

        const templates = await Template.find(query).sort({ updatedAt: -1 });
        res.json({ data: templates });
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to load templates' });
    }
});

router.post('/import', protect, async (req, res) => {
    try {
        const { defaultIds, adminTemplateIds } = req.body || {};
        if ((!Array.isArray(defaultIds) || defaultIds.length === 0) && (!Array.isArray(adminTemplateIds) || adminTemplateIds.length === 0)) {
            return res.status(400).json({ message: 'defaultIds or adminTemplateIds is required' });
        }

        const inserted = [];
        const limit = getTemplateLimitForUser(req.user);
        let currentCount = Number.isFinite(limit)
            ? await Template.countDocuments({ user: req.user._id })
            : 0;

        const defaultItems = Array.isArray(defaultIds)
            ? defaultIds.map((id) => ({ sourceType: 'default', sourceId: String(id) }))
            : [];
        const adminItems = Array.isArray(adminTemplateIds)
            ? adminTemplateIds.map((id) => ({ sourceType: 'admin', sourceId: String(id) }))
            : [];

        for (const item of [...defaultItems, ...adminItems]) {
            const imported = await upsertTemplateFromSource({
                userId: req.user._id,
                sourceType: item.sourceType,
                sourceId: item.sourceId,
                kind: req.body?.kind || 'email',
                allowCreate: !Number.isFinite(limit) || currentCount < limit,
            });
            if (imported?.skippedDueToQuota) {
                return res.status(403).json({
                    message: `Template limit reached for your plan (${formatTemplateLimit(limit)}). Upgrade to add more templates.`,
                });
            }
            if (imported?.created) currentCount += 1;
            if (imported?.template) inserted.push(imported.template);
        }

        return res.status(201).json({ data: inserted });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to import templates' });
    }
});

router.post('/', protect, async (req, res) => {
    try {
        const kind = normalizeKind(req.body?.kind);
        const payload = normalizeTemplatePayload(req.body, kind);
        if (!payload.title) return res.status(400).json({ message: 'Template title is required' });

        const limit = getTemplateLimitForUser(req.user);
        if (Number.isFinite(limit)) {
            const currentCount = await Template.countDocuments({ user: req.user._id });
            if (currentCount >= limit) {
                return res.status(403).json({
                    message: `Template limit reached for your plan (${formatTemplateLimit(limit)}). Upgrade to add more templates.`,
                });
            }
        }

        const template = await Template.create({
            user: req.user._id,
            ...payload,
            importedFromDefault: false,
            sourceDefaultId: '',
        });
        return res.status(201).json({ data: template });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to create template' });
    }
});

router.get('/kits', protect, async (req, res) => {
    try {
        const kind = req.query.kind;
        const kits = await TemplateKit.find({
            user: req.user._id,
            ...(kind && ['email', 'resume'].includes(kind) ? { kind } : {}),
        }).sort({ updatedAt: -1 });
        return res.json({ data: kits });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load template kits' });
    }
});

router.post('/kits', protect, async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();
        const kind = normalizeKind(req.body?.kind || 'email');
        if (!name) return res.status(400).json({ message: 'Kit name is required' });

        const existing = await TemplateKit.findOne({ user: req.user._id, kind, name });
        if (existing) return res.status(409).json({ message: 'A kit with this name already exists' });

        const kit = await TemplateKit.create({ user: req.user._id, kind, name, items: [] });
        return res.status(201).json({ data: kit });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to create template kit' });
    }
});

router.delete('/kits/:id', protect, async (req, res) => {
    try {
        const deleted = await TemplateKit.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        if (!deleted) return res.status(404).json({ message: 'Template kit not found' });
        return res.json({ message: 'Template kit deleted' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to delete template kit' });
    }
});

router.get('/kits/:id/export', protect, async (req, res) => {
    try {
        const kit = await TemplateKit.findOne({ _id: req.params.id, user: req.user._id }).lean();
        if (!kit) return res.status(404).json({ message: 'Template kit not found' });

        return res.json({
            data: {
                version: 1,
                exportedAt: new Date().toISOString(),
                name: kit.name,
                kind: kit.kind,
                items: Array.isArray(kit.items) ? kit.items : [],
            },
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to export template kit' });
    }
});

router.post('/kits/import', protect, async (req, res) => {
    try {
        const input = req.body?.kit || req.body || {};
        const name = String(input.name || '').trim();
        const kind = normalizeKind(input.kind || 'email');
        const items = Array.isArray(input.items) ? input.items : [];

        if (!name) return res.status(400).json({ message: 'Kit name is required' });
        if (items.length === 0) return res.status(400).json({ message: 'Kit items are required' });

        const deduped = [];
        const seen = new Set();
        for (const item of items) {
            const sourceType = String(item?.sourceType || '').trim();
            const sourceId = String(item?.sourceId || '').trim();
            const itemKind = normalizeKind(item?.kind || kind);
            if (!['default', 'admin', 'user'].includes(sourceType) || !sourceId) continue;
            const key = `${sourceType}:${sourceId}:${itemKind}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push({
                sourceType,
                sourceId,
                kind: itemKind,
                title: String(item?.title || '').trim(),
                thumbnailUrl: String(item?.thumbnailUrl || '').trim(),
            });
        }

        if (deduped.length === 0) {
            return res.status(400).json({ message: 'No valid kit items to import' });
        }

        const baseName = name;
        let candidateName = baseName;
        let suffix = 2;
        while (await TemplateKit.findOne({ user: req.user._id, kind, name: candidateName })) {
            candidateName = `${baseName} (${suffix})`;
            suffix += 1;
        }

        const created = await TemplateKit.create({
            user: req.user._id,
            kind,
            name: candidateName,
            items: deduped,
        });

        return res.status(201).json({ data: created });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to import template kit' });
    }
});

router.post('/kits/:id/import-to-gallery', protect, async (req, res) => {
    try {
        const kit = await TemplateKit.findOne({ _id: req.params.id, user: req.user._id });
        if (!kit) return res.status(404).json({ message: 'Template kit not found' });

        const inserted = [];
        const limit = getTemplateLimitForUser(req.user);
        let currentCount = Number.isFinite(limit)
            ? await Template.countDocuments({ user: req.user._id })
            : 0;
        for (const item of kit.items || []) {
            if (!['default', 'admin'].includes(item.sourceType)) continue;
            const imported = await upsertTemplateFromSource({
                userId: req.user._id,
                sourceType: item.sourceType,
                sourceId: item.sourceId,
                kind: item.kind || kit.kind,
                allowCreate: !Number.isFinite(limit) || currentCount < limit,
            });
            if (imported?.skippedDueToQuota) {
                return res.status(403).json({
                    message: `Template limit reached for your plan (${formatTemplateLimit(limit)}). Upgrade to add more templates.`,
                });
            }
            if (imported?.created) currentCount += 1;
            if (imported?.template) inserted.push(imported.template);
        }

        return res.json({ data: inserted, count: inserted.length });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to import kit to gallery' });
    }
});

router.post('/kits/:id/items', protect, async (req, res) => {
    try {
        const kit = await TemplateKit.findOne({ _id: req.params.id, user: req.user._id });
        if (!kit) return res.status(404).json({ message: 'Template kit not found' });

        const sourceType = String(req.body?.sourceType || '').trim();
        const sourceId = String(req.body?.sourceId || '').trim();
        const kind = normalizeKind(req.body?.kind || kit.kind);

        if (!['default', 'admin', 'user'].includes(sourceType)) {
            return res.status(400).json({ message: 'Invalid sourceType' });
        }
        if (!sourceId) return res.status(400).json({ message: 'sourceId is required' });

        let title = '';
        let thumbnailUrl = '';

        if (sourceType === 'default') {
            const defaultTemplate = getDefaultTemplates(kind).find((item) => item.defaultId === sourceId);
            if (!defaultTemplate) return res.status(404).json({ message: 'Default template not found' });
            title = defaultTemplate.title;
        }

        if (sourceType === 'admin') {
            const adminTemplate = await AdminTemplate.findOne({ _id: sourceId, kind, isPublished: true });
            if (!adminTemplate) return res.status(404).json({ message: 'Admin template not found' });
            title = adminTemplate.title;
            thumbnailUrl = adminTemplate.thumbnailUrl || '';
        }

        if (sourceType === 'user') {
            const userTemplate = await Template.findOne({ _id: sourceId, user: req.user._id, kind });
            if (!userTemplate) return res.status(404).json({ message: 'User template not found' });
            title = userTemplate.title;
            thumbnailUrl = userTemplate.thumbnailUrl || '';
        }

        const exists = kit.items.some((item) => item.sourceType === sourceType && item.sourceId === sourceId && item.kind === kind);
        if (exists) return res.json({ data: kit });

        kit.items.push({ sourceType, sourceId, kind, title, thumbnailUrl });
        await kit.save();
        return res.json({ data: kit });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to add template to kit' });
    }
});

router.delete('/kits/:id/items', protect, async (req, res) => {
    try {
        const kit = await TemplateKit.findOne({ _id: req.params.id, user: req.user._id });
        if (!kit) return res.status(404).json({ message: 'Template kit not found' });

        const sourceType = String(req.query.sourceType || '').trim();
        const sourceId = String(req.query.sourceId || '').trim();
        const kind = normalizeKind(req.query.kind || kit.kind);

        kit.items = kit.items.filter((item) => !(item.sourceType === sourceType && item.sourceId === sourceId && item.kind === kind));
        await kit.save();
        return res.json({ data: kit });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to remove template from kit' });
    }
});

router.get('/admin/templates', protect, admin, async (req, res) => {
    try {
        const kind = req.query.kind;
        const templates = await AdminTemplate.find({
            ...(kind && ['email', 'resume'].includes(kind) ? { kind } : {}),
        }).sort({ updatedAt: -1 });
        return res.json({ data: templates });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load admin templates' });
    }
});

router.post('/admin/templates', protect, admin, async (req, res) => {
    try {
        const kind = normalizeKind(req.body?.kind || 'email');
        const payload = normalizeTemplatePayload(req.body, kind);
        if (!payload.title) return res.status(400).json({ message: 'Template title is required' });

        const versionLabel = String(req.body?.versionLabel || 'v1').trim() || 'v1';
        const approvalState = String(req.body?.approvalState || 'draft').trim() || 'draft';

        const template = await AdminTemplate.create({
            createdBy: req.user._id,
            ...payload,
            versionLabel,
            isPublished: req.body?.isPublished !== undefined ? Boolean(req.body.isPublished) : (approvalState === 'published'),
            approvalState,
            revisionHistory: [
                {
                    version: versionLabel,
                    author: req.user._id,
                    authorName: req.user.name || 'Admin',
                    changes: 'Initial version',
                    approalState: approvalState,
                    timestamp: new Date(),
                },
            ],
        });
        return res.status(201).json({ data: template });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to create admin template' });
    }
});

router.put('/admin/templates/:id', protect, admin, async (req, res) => {
    try {
        const existing = await AdminTemplate.findById(req.params.id);
        if (!existing) return res.status(404).json({ message: 'Admin template not found' });

        const kind = normalizeKind(req.body?.kind || existing.kind);
        const payload = normalizeTemplatePayload(req.body, kind);
        if (!payload.title) return res.status(400).json({ message: 'Template title is required' });

        const newVersionLabel = req.body?.versionLabel !== undefined
            ? (String(req.body.versionLabel || '').trim() || existing.versionLabel || 'v1')
            : (existing.versionLabel || 'v1');

        const versionChanged = newVersionLabel !== existing.versionLabel;

        if (versionChanged || req.body?.isNewRevision === true) {
            const revisionEntry = {
                version: newVersionLabel,
                author: req.user._id,
                authorName: req.user.name || 'Admin',
                changes: String(req.body?.changes || `Updated to ${newVersionLabel}`).trim(),
                approalState: existing.approvalState,
                timestamp: new Date(),
            };

            if (!Array.isArray(existing.revisionHistory)) {
                existing.revisionHistory = [];
            }

            existing.revisionHistory.push(revisionEntry);
        }

        Object.assign(existing, payload, {
            versionLabel: newVersionLabel,
            isPublished: req.body?.isPublished !== undefined ? Boolean(req.body.isPublished) : existing.isPublished,
            approvalState: req.body?.approvalState !== undefined 
                ? String(req.body.approvalState).trim() 
                : existing.approvalState,
        });
        await existing.save();
        return res.json({ data: existing });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to update admin template' });
    }
});

router.delete('/admin/templates/:id', protect, admin, async (req, res) => {
    try {
        const deleted = await AdminTemplate.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: 'Admin template not found' });
        return res.json({ message: 'Admin template deleted' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to delete admin template' });
    }
});

router.get('/admin/templates/:id/revisions', protect, admin, async (req, res) => {
    try {
        const template = await AdminTemplate.findById(req.params.id)
            .populate('createdBy', 'name email')
            .populate('revisionHistory.author', 'name email')
            .populate('revisionHistory.approver', 'name email');
        if (!template) return res.status(404).json({ message: 'Admin template not found' });
        return res.json({ data: template.revisionHistory || [] });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to fetch revision history' });
    }
});

router.put('/admin/templates/:id/state', protect, admin, async (req, res) => {
    try {
        const template = await AdminTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ message: 'Admin template not found' });

        const newState = String(req.body?.state || '').trim();
        if (!['draft', 'review', 'approved', 'published'].includes(newState)) {
            return res.status(400).json({ message: 'Invalid approval state' });
        }

        const oldState = template.approvalState;
        template.approvalState = newState;
        
        if (newState === 'published') {
            template.isPublished = true;
        } else if (newState === 'draft') {
            template.isPublished = false;
        }

        await template.save();
        return res.json({ data: template });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to update approval state' });
    }
});

router.put('/admin/templates/:id/approve', protect, admin, async (req, res) => {
    try {
        const template = await AdminTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ message: 'Admin template not found' });

        const currentApprovalState = template.approvalState || 'draft';
        if (currentApprovalState === 'published') {
            return res.status(400).json({ message: 'Cannot approve already published template' });
        }

        template.approvalState = 'approved';
        template.approvalNotes = String(req.body?.notes || '').trim();

        const revisionEntry = {
            version: template.versionLabel,
            author: req.user._id,
            authorName: req.user.name || 'Admin',
            changes: String(req.body?.changes || 'Template approved').trim(),
            approver: req.user._id,
            approverName: req.user.name || 'Admin',
            approvalNotes: template.approvalNotes,
            approvalState: 'approved',
            timestamp: new Date(),
        };

        if (!Array.isArray(template.revisionHistory)) {
            template.revisionHistory = [];
        }

        const existingRevision = template.revisionHistory.find((r) => r.version === template.versionLabel);
        if (existingRevision) {
            Object.assign(existingRevision, revisionEntry);
        } else {
            template.revisionHistory.push(revisionEntry);
        }

        await template.save();
        return res.json({ data: template });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to approve template' });
    }
});

router.put('/admin/templates/:id/reject', protect, admin, async (req, res) => {
    try {
        const template = await AdminTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ message: 'Admin template not found' });

        const currentApprovalState = template.approvalState || 'draft';
        if (currentApprovalState === 'published') {
            return res.status(400).json({ message: 'Cannot reject already published template' });
        }

        template.approvalState = 'draft';
        template.approvalNotes = String(req.body?.notes || 'Changes requested').trim();

        const revisionEntry = {
            version: template.versionLabel,
            author: req.user._id,
            authorName: req.user.name || 'Admin',
            changes: String(req.body?.changes || 'Template rejected').trim(),
            approver: req.user._id,
            approverName: req.user.name || 'Admin',
            approvalNotes: template.approvalNotes,
            approvalState: 'draft',
            timestamp: new Date(),
        };

        if (!Array.isArray(template.revisionHistory)) {
            template.revisionHistory = [];
        }

        template.revisionHistory.push(revisionEntry);
        await template.save();
        return res.json({ data: template });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to reject template' });
    }
});

router.post('/admin/templates/:id/rollback/:version', protect, admin, async (req, res) => {
    try {
        const template = await AdminTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ message: 'Admin template not found' });

        const targetVersion = String(req.params.version).trim();
        const revision = template.revisionHistory?.find((r) => r.version === targetVersion);
        if (!revision) return res.status(404).json({ message: 'Revision not found' });

        const currentContent = {
            content: template.content,
            design: template.design,
            title: template.title,
            description: template.description,
        };

        template.versionLabel = targetVersion;
        template.approvalState = 'draft';
        template.isPublished = false;

        const rollbackEntry = {
            version: `${targetVersion}-rollback`,
            author: req.user._id,
            authorName: req.user.name || 'Admin',
            changes: `Rolled back to ${targetVersion}`,
            approalState: 'draft',
            timestamp: new Date(),
        };

        if (!Array.isArray(template.revisionHistory)) {
            template.revisionHistory = [];
        }

        template.revisionHistory.push(rollbackEntry);
        await template.save();
        return res.json({ data: template });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to rollback template' });
    }
});

router.post('/admin/templates/:id/clone', protect, admin, async (req, res) => {
    try {
        const source = await AdminTemplate.findById(req.params.id);
        if (!source) return res.status(404).json({ message: 'Admin template not found' });

        const clonedTitle = String(req.body?.title || `${source.title} (Clone)`).trim();
        const versionLabel = String(req.body?.versionLabel || 'v1').trim() || 'v1';

        const cloned = await AdminTemplate.create({
            createdBy: req.user._id,
            kind: source.kind,
            title: clonedTitle,
            description: source.description,
            category: source.category,
            content: JSON.parse(JSON.stringify(source.content)),
            design: JSON.parse(JSON.stringify(source.design)),
            tags: [...source.tags],
            thumbnailUrl: source.thumbnailUrl,
            versionLabel,
            approvalState: 'draft',
            isPublished: false,
            revisionHistory: [
                {
                    version: versionLabel,
                    author: req.user._id,
                    authorName: req.user.name || 'Admin',
                    changes: `Cloned from ${source.title} (${source.versionLabel})`,
                    approvalState: 'draft',
                    timestamp: new Date(),
                },
            ],
        });

        return res.status(201).json({ data: cloned });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to clone template' });
    }
});

router.put('/:id', protect, async (req, res) => {
    try {
        const existing = await Template.findOne({ _id: req.params.id, user: req.user._id });
        if (!existing) return res.status(404).json({ message: 'Template not found' });

        const kind = normalizeKind(req.body?.kind || existing.kind);
        const payload = normalizeTemplatePayload(req.body, kind);
        if (!payload.title) return res.status(400).json({ message: 'Template title is required' });

        Object.assign(existing, payload);
        await existing.save();
        return res.json({ data: existing });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to update template' });
    }
});

router.patch('/:id/favorite', protect, async (req, res) => {
    try {
        const existing = await Template.findOne({ _id: req.params.id, user: req.user._id });
        if (!existing) return res.status(404).json({ message: 'Template not found' });

        existing.isFavorite = req.body?.isFavorite !== undefined ? Boolean(req.body.isFavorite) : !existing.isFavorite;
        await existing.save();
        return res.json({ data: existing });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to update favorite state' });
    }
});

router.delete('/:id', protect, async (req, res) => {
    try {
        const deleted = await Template.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        if (!deleted) return res.status(404).json({ message: 'Template not found' });
        return res.json({ message: 'Template deleted' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to delete template' });
    }
});

router.get('/assets/library', protect, async (req, res) => {
    try {
        const kind = String(req.query.kind || '').trim();
        const query = {
            user: req.user._id,
            ...(kind && ['logo', 'image', 'background'].includes(kind) ? { kind } : {}),
        };
        const assets = await UserAsset.find(query).sort({ createdAt: -1 });
        return res.json({ data: assets });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load media library' });
    }
});

router.post('/assets/upload', protect, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

        const kind = ['logo', 'image', 'background'].includes(String(req.body.kind || ''))
            ? String(req.body.kind)
            : 'image';

        let uploadResult = null;
        try {
            uploadResult = await uploadToCloudinary(req.file, String(req.user._id), kind);
        } catch {
            uploadResult = null;
        }

        if (!uploadResult) {
            uploadResult = await saveLocalUpload(req.file, String(req.user._id));
        }

        const host = `${req.protocol}://${req.get('host')}`;
        const absoluteUrl = uploadResult.url.startsWith('http') ? uploadResult.url : `${host}${uploadResult.url}`;

        const asset = await UserAsset.create({
            user: req.user._id,
            kind,
            label: String(req.body.label || req.file.originalname || '').trim(),
            url: absoluteUrl,
            storage: uploadResult.storage,
            publicId: uploadResult.publicId,
            mimeType: req.file.mimetype || '',
            size: req.file.size || 0,
            width: uploadResult.width || 0,
            height: uploadResult.height || 0,
            tags: [kind, 'template-media'],
        });

        return res.status(201).json({ data: asset });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to upload media' });
    }
});

router.get('/admin/overview', protect, admin, async (_req, res) => {
    try {
        const [total, byKind, favoriteCount, mediaCount] = await Promise.all([
            Template.countDocuments({}),
            Template.aggregate([{ $group: { _id: '$kind', count: { $sum: 1 } } }]),
            Template.countDocuments({ isFavorite: true }),
            UserAsset.countDocuments({}),
        ]);

        return res.json({
            data: {
                totalTemplates: total,
                favorites: favoriteCount,
                mediaAssets: mediaCount,
                byKind: byKind.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {}),
            },
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load admin overview' });
    }
});

export default router;
