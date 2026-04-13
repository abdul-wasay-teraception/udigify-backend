import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tool:   { type: String, enum: ['cold-outreach', 'brand-voice', 'seo-cluster', 'social-repurpose', 'health-check'], required: true },
    month:  { type: String, required: true }, // "YYYY-MM"
    count:  { type: Number, default: 0 },
}, { timestamps: true });

schema.index({ userId: 1, tool: 1, month: 1 }, { unique: true });

export default mongoose.model('PowerToolsUsage', schema);
