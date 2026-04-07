import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Generate JWT
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '30d',
    });
};

const getMailer = () => {
    const host = process.env.EMAIL_HOST;
    const port = Number(process.env.EMAIL_PORT || 587);
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!host || !port || !user || !pass) {
        throw new Error('Email service is not configured');
    }

    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
    });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;

    try {
        const userExists = await User.findOne({ email });

        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            name,
            email,
            password: hashedPassword,
        });

        if (user) {
            res.status(201).json({
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                accessGiven: user.accessGiven,
                token: generateToken(user._id),
            });
        } else {
            res.status(400).json({ message: 'Invalid user data' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });

        if (user && (await bcrypt.compare(password, user.password))) {
            res.json({
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                accessGiven: user.accessGiven,
                publerPlan: user.publerPlan || 'none',
                publerCreds: user.publerCreds,
                publerWorkspaceId: user.publerCreds?.workspaceId || '',
                snovPlan: user.snovPlan || 'none',
                subscription: user.subscription || {},
                credits: user.credits || { publer: 0, snov: 0 },
                token: generateToken(user._id),
            });
        } else {
            res.status(401).json({ message: 'Invalid email or password' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// @desc    Request password reset email
// @route   POST /api/auth/forgot-password
// @access  Public
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    try {
        const user = await User.findOne({ email: String(email).toLowerCase().trim() });

        // Always return the same message to avoid account enumeration.
        const genericMessage = { message: 'If that email exists, a reset OTP has been sent.' };

        if (!user) {
            return res.json(genericMessage);
        }

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const hashedToken = crypto.createHash('sha256').update(otp).digest('hex');
        const expires = new Date(Date.now() + 10 * 60 * 1000);

        user.resetPasswordToken = hashedToken;
        user.resetPasswordExpires = expires;
        await user.save();

        const transporter = getMailer();

        await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
            to: user.email,
            subject: 'Your password reset OTP',
            text: `Your password reset OTP is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`,
            html: `<p>Your password reset OTP is:</p><h2 style="letter-spacing:4px;">${otp}</h2><p>This OTP expires in 10 minutes.</p><p>If you did not request this, ignore this email.</p>`,
        });

        return res.json(genericMessage);
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to process forgot password request' });
    }
});

// @desc    Reset password using token from email
// @route   POST /api/auth/reset-password
// @access  Public
router.post('/reset-password', async (req, res) => {
    const { email, otp, password } = req.body;

    if (!email || !otp || !password) {
        return res.status(400).json({ message: 'Email, OTP and new password are required' });
    }

    if (String(password).length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    try {
        const hashedToken = crypto.createHash('sha256').update(String(otp).trim()).digest('hex');

        const user = await User.findOne({
            email: String(email).toLowerCase().trim(),
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: new Date() },
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;
        await user.save();

        return res.json({ message: 'Password reset successful. You can now sign in.' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to reset password' });
    }
});

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (user) {
            res.json({
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                accessGiven: user.accessGiven,
                systemeCreds: user.systemeCreds,
                publerPlan: user.publerPlan || 'none',
                publerCreds: user.publerCreds,
                snovPlan: user.snovPlan || 'none',
                subscription: user.subscription || {},
                credits: user.credits || { publer: 0, snov: 0 },
                token: req.headers.authorization?.split(' ')[1],
            });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;
