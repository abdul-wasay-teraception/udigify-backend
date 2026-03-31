import mongoose from 'mongoose';

const snovCacheSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    type: {
        type: String,
        required: true,
        index: true,
    },
    key: {
        type: String,
        required: true,
    },
    input: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
    },
    hitCount: {
        type: Number,
        default: 0,
    },
    lastAccessedAt: {
        type: Date,
        default: Date.now,
    },
    expiresAt: {
        type: Date,
        required: true,
    },
}, {
    timestamps: true,
});

snovCacheSchema.index({ user: 1, type: 1, key: 1 }, { unique: true });
snovCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const SnovCache = mongoose.model('SnovCache', snovCacheSchema);
export default SnovCache;