import express from 'express';
import SnovCache from '../models/SnovCache.js';
import User from '../models/User.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
router.get('/users', protect, admin, async (req, res) => {
    try {
        const users = await User.find({});
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Update user access & credentials
// @route   PUT /api/admin/users/:id/access
// @access  Private/Admin
router.put('/users/:id/access', protect, admin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (user) {
            user.accessGiven = req.body.accessGiven;

            // Systeme.io credentials
            if (req.body.systemeCreds) {
                user.systemeCreds = {
                    ...(user.systemeCreds || {}),
                    ...req.body.systemeCreds
                };
                user.markModified('systemeCreds');
            }

            // Publer plan assignment
            if (req.body.publerPlan !== undefined) {
                user.publerPlan = req.body.publerPlan;
            }

            // Publer credentials (apiKey, workspaceId, loginUrl)
            if (req.body.publerCreds) {
                user.publerCreds = {
                    ...(user.publerCreds || {}),
                    ...req.body.publerCreds
                };
                user.markModified('publerCreds');
            }

            // Snov.io plan assignment
            if (req.body.snovPlan !== undefined) {
                user.snovPlan = req.body.snovPlan;
            }

            const updatedUser = await user.save();
            res.json(updatedUser);
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Update user Publer plan only
// @route   PUT /api/admin/users/:id/publer
// @access  Private/Admin
router.put('/users/:id/publer', protect, admin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (req.body.publerPlan !== undefined) user.publerPlan = req.body.publerPlan;

        if (req.body.publerCreds) {
            user.publerCreds = { ...(user.publerCreds || {}), ...req.body.publerCreds };
            user.markModified('publerCreds');
        }

        const updated = await user.save();
        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Update user Snov.io plan and/or custom limits
// @route   PUT /api/admin/users/:id/snov
// @access  Private/Admin
router.put('/users/:id/snov', protect, admin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (req.body.snovPlan !== undefined) user.snovPlan = req.body.snovPlan;

        if (req.body.snovCustomLimits !== undefined) {
            user.snovCustomLimits = {
                ...(user.snovCustomLimits || {}),
                ...req.body.snovCustomLimits,
            };
            user.markModified('snovCustomLimits');
        }

        if (req.body.resetUsage) {
            const nextReset = new Date();
            nextReset.setDate(1);
            nextReset.setMonth(nextReset.getMonth() + 1);
            user.snovUsage = { leadsThisMonth: 0, emailFindsThisMonth: 0, resetDate: nextReset };
            user.markModified('snovUsage');
        }

        if (req.body.clearCache) {
            await SnovCache.deleteMany({ user: user._id });
        }

        const updated = await user.save();
        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Reset Snov.io usage counters for a user
// @route   PUT /api/admin/users/:id/snov/reset-usage
// @access  Private/Admin
router.put('/users/:id/snov/reset-usage', protect, admin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const nextReset = new Date();
        nextReset.setDate(1);
        nextReset.setMonth(nextReset.getMonth() + 1);
        user.snovUsage = { leadsThisMonth: 0, emailFindsThisMonth: 0, resetDate: nextReset };
        user.markModified('snovUsage');

        const updated = await user.save();
        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Edit user (name, email, role, password)
// @route   PUT /api/admin/users/:id
// @access  Private/Admin
router.put('/users/:id', protect, admin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (req.body.name  !== undefined) user.name  = req.body.name.trim();
        if (req.body.email !== undefined) user.email = req.body.email.trim().toLowerCase();
        if (req.body.role  !== undefined) user.role  = req.body.role;
        if (req.body.password && req.body.password.length >= 6) {
            const bcrypt = await import('bcryptjs');
            user.password = await bcrypt.default.hash(req.body.password, 10);
        }

        const updated = await user.save();
        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
router.delete('/users/:id', protect, admin, async (req, res) => {
    try {
        // Prevent admin from deleting themselves
        if (req.params.id === req.user._id.toString()) {
            return res.status(400).json({ message: 'You cannot delete your own account' });
        }
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Manually adjust user credits (publer + snov)
// @route   PUT /api/admin/users/:id/credits
// @access  Private/Admin
router.put('/users/:id/credits', protect, admin, async (req, res) => {
    try {
        const { publer, snov } = req.body;
        const updated = await User.findByIdAndUpdate(
            req.params.id,
            {
                ...(publer !== undefined && { 'credits.publer': Number(publer) }),
                ...(snov   !== undefined && { 'credits.snov':   Number(snov)   }),
            },
            { new: true }
        );
        if (!updated) return res.status(404).json({ message: 'User not found' });
        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;
