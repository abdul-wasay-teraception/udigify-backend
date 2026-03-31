import express from 'express';
import Resource from '../models/Resource.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

// @desc    Get all resources
// @route   GET /api/resources
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        // If user is admin, return all. If user, return only active.
        const filter = req.user.role === 'admin' ? {} : { active: true };
        const resources = await Resource.find(filter).sort({ createdAt: -1 });
        res.json(resources);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Create a resource
// @route   POST /api/resources
// @access  Private/Admin
router.post('/', protect, admin, async (req, res) => {
    const { title, description, url, type } = req.body;

    try {
        const resource = await Resource.create({
            title,
            description,
            url,
            type,
        });
        res.status(201).json(resource);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// @desc    Delete a resource
// @route   DELETE /api/resources/:id
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const resource = await Resource.findById(req.params.id);

        if (resource) {
            await resource.deleteOne();
            res.json({ message: 'Resource removed' });
        } else {
            res.status(404).json({ message: 'Resource not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;
