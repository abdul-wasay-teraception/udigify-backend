import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();
const PUBLER_BASE = 'https://app.publer.com/api/v1';

// ─── Multer: store uploads in server/uploads/ ─────────────────────────────────
const storage = multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
        else cb(new Error('Only images and videos are allowed'));
    },
});

// Publer API uses short provider codes — map our frontend keys to all known variants
const PROVIDER_MAP = {
    linkedin:  ['linkedin', 'li', 'linkedin_page', 'linkedin_profile', 'linkedin_company'],
    facebook:  ['facebook', 'fb', 'facebook_page', 'facebook_group'],
    instagram: ['instagram', 'ig'],
    twitter:   ['twitter', 'tw', 'x'],
    tiktok:    ['tiktok', 'tt'],
    youtube:   ['youtube', 'yt'],
    pinterest: ['pinterest', 'pin'],
    threads:   ['threads'],
    bluesky:   ['bluesky', 'bsky'],
    mastodon:  ['mastodon'],
    telegram:  ['telegram', 'tg'],
    google:    ['google', 'google_business', 'gmb'],
    wordpress: ['wordpress', 'wordpress_basic', 'wordpress_oauth', 'wp'],
};

// Check if a Publer account provider matches one of our platform keys
function platformMatches(publerProvider, ourPlatform) {
    const key = ourPlatform.toLowerCase();
    const variants = PROVIDER_MAP[key] || [key];
    return variants.includes((publerProvider || '').toLowerCase());
}

// Statuses that mean the account is usable
const ACTIVE_STATUSES = new Set(['active', 'connected', 'ok', 'enabled']);

// ─── Helper: call Publer API from server ──────────────────────────────────────
async function publerFetch(path, options = {}, workspaceId = null) {
    const headers = {
        'Authorization': `Bearer-API ${process.env.PUBLER_API_KEY}`,
        'Content-Type': 'application/json',
    };
    if (workspaceId) headers['Publer-Workspace-Id'] = workspaceId;

    const res = await fetch(`${PUBLER_BASE}${path}`, { ...options, headers });

    // Some endpoints return 204 No Content or non-JSON — handle safely
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body — ignore */ }

    if (!res.ok) throw new Error(data.errors?.[0] || data.message || `Publer API error (${res.status})`);
    return data;
}

// ─── Helper: get user's workspace id from DB ─────────────────────────────────
async function getWorkspaceId(userId) {
    const user = await User.findById(userId).select('publerCreds');
    return user?.publerCreds?.workspaceId || null;
}

// ─── Build Publer post payload from simplified frontend format ────────────────
// extraOptions: { youtubeTitle, youtubePrivacy, youtubeCategory, instagramType }
function buildPublerPayload(text, accounts, scheduledAt, mediaUrls = [], extraOptions = {}) {
    const {
        youtubeTitle    = null,
        youtubePrivacy  = 'public',
        youtubeCategory = '22',    // 22 = People & Blogs
        instagramType   = 'photo', // photo | video | carousel | reel | story
    } = extraOptions;

    // Use the account's actual Publer provider as the networks key
    const networks = {};
    const uniqueProviders = [...new Set(accounts.map(a => a.provider))];
    uniqueProviders.forEach(provider => {
        const lp = provider.toLowerCase();

        if (PROVIDER_MAP.youtube.includes(lp)) {
            // YouTube requires title; type is 'video' (or 'shorts' for short-form)
            const net = {
                type:     'video',
                text,
                title:    youtubeTitle || text.slice(0, 100) || 'Untitled',
                privacy:  youtubePrivacy,
                category: youtubeCategory,
            };
            if (mediaUrls.length) net.media_urls = mediaUrls;
            networks[provider] = net;
        } else if (PROVIDER_MAP.instagram.includes(lp)) {
            // Instagram: business account required; type drives carousel/reel/story behaviour
            const hasMedia = mediaUrls.length > 0;
            const igType = hasMedia && mediaUrls.length > 1 ? 'carousel' : instagramType;
            const net = { type: igType, text };
            if (mediaUrls.length) net.media_urls = mediaUrls;
            networks[provider] = net;
        } else {
            const net = { type: 'status', text };
            if (mediaUrls.length) net.media_urls = mediaUrls;
            networks[provider] = net;
        }
    });

    // Publer only accepts 'scheduled' or 'draft' on creation.
    // For "publish now": use 90 seconds from now to give Publer enough buffer to process the
    // async job and actually hit the FB API before the scheduled_at time.
    const isoTime = scheduledAt
        ? new Date(scheduledAt).toISOString().slice(0, 16) + '+00:00'
        : new Date(Date.now() + 90_000).toISOString().slice(0, 16) + '+00:00';

    return {
        bulk: {
            state: 'scheduled',
            posts: [
                {
                    networks,
                    accounts: accounts.map(a => ({
                        id: a.id,
                        scheduled_at: isoTime,
                    })),
                },
            ],
        },
    };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// @desc  List all Publer workspaces (admin uses this to pick one for a user)
// @route GET /api/publer/workspaces
// @access Private
router.get('/workspaces', protect, async (req, res) => {
    try {
        const data = await publerFetch('/workspaces');
        res.json(Array.isArray(data) ? data : []);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Get connected social accounts for the logged-in user's workspace
// @route GET /api/publer/accounts
// @access Private
router.get('/accounts', protect, async (req, res) => {
    try {
        const workspaceId = await getWorkspaceId(req.user._id);
        if (!workspaceId) return res.json({ accounts: [], configured: false });

        const data = await publerFetch('/accounts', {}, workspaceId);
        console.log('[Publer] GET /accounts raw:', JSON.stringify(data, null, 2));
        const accounts = data.accounts || data.data || data.social_accounts || (Array.isArray(data) ? data : []);
        res.json({ accounts, configured: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Get posts for current user
// @route GET /api/publer/posts
// @access Private
router.get('/posts', protect, async (req, res) => {
    try {
        const workspaceId = await getWorkspaceId(req.user._id);
        if (!workspaceId) return res.json({ posts: [], total: 0, configured: false });

        const state = req.query.state || 'scheduled';
        const [postsData, accData] = await Promise.all([
            publerFetch(`/posts?state=${state}`, {}, workspaceId),
            publerFetch('/accounts', {}, workspaceId).catch(() => ({ accounts: [] })),
        ]);

        const posts = postsData.posts || postsData.data || (Array.isArray(postsData) ? postsData : []);
        const accounts = accData.accounts || (Array.isArray(accData) ? accData : []);

        // Build account_id → provider lookup
        const accountMap = {};
        accounts.forEach(a => { accountMap[a.id] = a.provider; });

        // Inject provider + normalise analytics fields into each post so the frontend can map it
        const enriched = posts.map(p => {
            // Publer nests analytics differently depending on state — flatten to a consistent shape
            const raw = p.analytics || p.insights || p.stats || {};
            const analytics = {
                impressions:     raw.impressions      ?? raw.impressions_count     ?? null,
                reach:           raw.unique_impressions ?? raw.reach ?? raw.members_reached ?? null,
                reactions:       raw.reactions        ?? raw.likes                ?? raw.like_count   ?? null,
                comments:        raw.comments         ?? raw.comments_count       ?? null,
                reposts:         raw.reposts          ?? raw.shares               ?? raw.share_count  ?? null,
                clicks:          raw.clicks           ?? raw.click_count          ?? null,
                profileViews:    raw.profile_views    ?? raw.profile_view_count   ?? null,
                followersGained: raw.followers_gained ?? raw.new_followers         ?? null,
            };
            // Only attach analytics if at least one field is non-null
            const hasAnalytics = Object.values(analytics).some(v => v !== null);
            return {
                ...p,
                provider: p.provider || accountMap[p.account_id] || null,
                ...(hasAnalytics ? { analytics } : {}),
            };
        });

        res.json({ posts: enriched, total: postsData.total || enriched.length, configured: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Schedule / publish a post
// @route POST /api/publer/posts
// @access Private
router.post('/posts', protect, async (req, res) => {
    try {
        // ─── Credit check ─────────────────────────────────────────────────────
        const userDoc = await User.findById(req.user._id).select('subscription credits');
        const subStatus = userDoc?.subscription?.status;
        const publerCredits = userDoc?.credits?.publer ?? 0;

        if (subStatus !== 'active' && subStatus !== 'trialing') {
            return res.status(403).json({
                message: 'An active subscription is required to post. Visit the Pricing page to get started.',
                upgradeRequired: true,
            });
        }
        if (publerCredits <= 0) {
            return res.status(429).json({
                message: `You have used all your Publer post credits for this billing period. Upgrade your plan for more posts.`,
                upgradeRequired: true,
                credits: { publer: 0 },
            });
        }

        const workspaceId = await getWorkspaceId(req.user._id);
        if (!workspaceId) {
            return res.status(400).json({ message: 'Your Publer workspace has not been configured yet. Contact your admin.' });
        }

        const { text, platforms, scheduledAt, mediaUrls, youtubeTitle, youtubePrivacy, youtubeCategory, instagramType } = req.body;
        if (!text) return res.status(400).json({ message: 'Post text is required' });
        if (!platforms?.length) return res.status(400).json({ message: 'Select at least one platform' });

        // Fetch the user's connected accounts, filter to selected platforms
        const accData = await publerFetch('/accounts', {}, workspaceId);
        console.log('[Publer] Raw /accounts response:', JSON.stringify(accData, null, 2));
        const allAccounts = accData.accounts || accData.data || accData.social_accounts || (Array.isArray(accData) ? accData : []);

        // Log for easier debugging
        console.log('[Publer] All accounts in workspace:', allAccounts.map(a => ({ id: a.id, provider: a.provider, status: a.status, name: a.name })));
        console.log('[Publer] Requested platforms:', platforms);

        const selectedAccounts = allAccounts.filter(a => {
            const statusOk = ACTIVE_STATUSES.has((a.status || '').toLowerCase()) || !a.status;
            const platformOk = platforms.some(p => platformMatches(a.provider, p));
            return statusOk && platformOk;
        });

        console.log('[Publer] Matched accounts:', selectedAccounts.map(a => a.id));

        if (selectedAccounts.length === 0) {
            const available = allAccounts.map(a => `${a.provider}(${a.status})`).join(', ');
            return res.status(400).json({
                message: `None of the selected platforms match an active connected account. Available: ${available || 'none'}. Requested: ${platforms.join(', ')}.`,
            });
        }

        const payload = buildPublerPayload(text, selectedAccounts, scheduledAt, mediaUrls || [], {
            youtubeTitle,
            youtubePrivacy,
            youtubeCategory,
            instagramType,
        });
        const result = await publerFetch('/posts/schedule', {
            method: 'POST',
            body: JSON.stringify(payload),
        }, workspaceId);

        // ─── Deduct 1 Publer credit on success ────────────────────────────────
        await User.findByIdAndUpdate(req.user._id, {
            $inc: { 'credits.publer': -1 },
        });

        // Publer returns { success: true, data: { job_id: "..." } } — normalise for frontend
        res.json({ job_id: result?.data?.job_id || result?.job_id || null, raw: result });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Delete a post
// @route DELETE /api/publer/posts/:postId
// @access Private
router.delete('/posts/:postId', protect, async (req, res) => {
    try {
        const workspaceId = await getWorkspaceId(req.user._id);
        if (!workspaceId) return res.status(400).json({ message: 'Workspace not configured' });

        try {
            await publerFetch(`/posts/${req.params.postId}`, { method: 'DELETE' }, workspaceId);
        } catch (publerErr) {
            // 404/422/etc = post already deleted from platform or not in Publer — treat as success
            const msg = String(publerErr.message || '');
            const isGone = msg.includes('404') || msg.includes('422') || msg.includes('not found');
            if (!isGone) throw publerErr;
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// @desc  Upload a media file (image/video) to be attached to a post
// @route POST /api/publer/upload
// @access Private
router.post('/upload', protect, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const host = `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${host}/uploads/${req.file.filename}` });
});

// @desc  Get analytics for a single post — extracts from the posts list (no extra API call)
// @route GET /api/publer/posts/:postId/analytics
// @access Private
router.get('/posts/:postId/analytics', protect, async (req, res) => {
    try {
        const workspaceId = await getWorkspaceId(req.user._id);
        if (!workspaceId) return res.json({ analytics: null });

        // Fetch published posts (analytics only exist on published posts)
        const [postsData, accData] = await Promise.all([
            publerFetch('/posts?state=published', {}, workspaceId),
            publerFetch('/accounts', {}, workspaceId).catch(() => ({ accounts: [] })),
        ]);
        const posts = postsData.posts || postsData.data || (Array.isArray(postsData) ? postsData : []);
        const post  = posts.find(p => p.id === req.params.postId);

        if (!post) return res.json({ analytics: null, error: 'Post not found in published list' });

        const raw = post.analytics || post.insights || post.stats || {};
        const analytics = {
            impressions:     raw.impressions      ?? raw.impressions_count     ?? null,
            reach:           raw.unique_impressions ?? raw.reach ?? raw.members_reached ?? null,
            reactions:       raw.reactions        ?? raw.likes                ?? raw.like_count   ?? null,
            comments:        raw.comments         ?? raw.comments_count       ?? null,
            reposts:         raw.reposts          ?? raw.shares               ?? raw.share_count  ?? null,
            clicks:          raw.clicks           ?? raw.click_count          ?? null,
            profileViews:    raw.profile_views    ?? raw.profile_view_count   ?? null,
            followersGained: raw.followers_gained ?? raw.new_followers         ?? null,
        };

        const hasAny = Object.values(analytics).some(v => v !== null);
        res.json({ analytics: hasAny ? analytics : null, raw });
    } catch (err) {
        res.json({ analytics: null, error: err.message });
    }
});

// @desc  Get workspace-level analytics from Publer
// @route GET /api/publer/analytics
// @access Private
router.get('/analytics', protect, async (req, res) => {
    try {
        const workspaceId = await getWorkspaceId(req.user._id);
        if (!workspaceId) return res.json({ data: null });

        const data = await publerFetch('/analytics', {}, workspaceId);
        res.json({ data });
    } catch (err) {
        res.json({ data: null, error: err.message });
    }
});

// @desc  Poll async job status
// @route GET /api/publer/job/:jobId
// @access Private
router.get('/job/:jobId', protect, async (req, res) => {
    try {
        const workspaceId = await getWorkspaceId(req.user._id);
        const data = await publerFetch(`/job_status/${req.params.jobId}`, {}, workspaceId);
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
