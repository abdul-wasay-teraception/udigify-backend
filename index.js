import './dotenv-init.js';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import resourceRoutes from './routes/resources.js';
import categoryRoutes from './routes/categories.js';
import publerRoutes from './routes/publer.js';
import snovRoutes from './routes/snov.js';
import agencyAnalyticsRoutes from './routes/agencyanalytics.js';
import stripeRoutes from './routes/stripe.js';
import templateRoutes from './routes/templates.js';
import powerToolsRoutes from './routes/powertools.js';
import aiRoutes from './routes/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

// ─── Stripe webhook needs raw body BEFORE express.json() ─────────────────────
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Serve uploaded media files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/publer', publerRoutes);
app.use('/api/snov', snovRoutes);
app.use('/api/agencyanalytics', agencyAnalyticsRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/powertools', powerToolsRoutes);
app.use('/api/ai', aiRoutes);

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB connection error:', err));

// Basic Route
app.get('/', (req, res) => {
    res.send('Agency API is running');
});

// Handle oversized payloads from editors sending base64 media.
app.use((err, _req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        return res.status(413).json({ message: 'Uploaded image payload is too large. Please use a smaller image.' });
    }
    return next(err);
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
