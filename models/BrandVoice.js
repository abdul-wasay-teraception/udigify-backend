import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name:           { type: String, required: true },
    mission:        { type: String, default: '' },
    targetAudience: { type: String, default: '' },
    tone:           { type: String, default: '' },
    keywords:       [String],
    persona:        { type: mongoose.Schema.Types.Mixed, default: {} }, // AI-generated JSON
}, { timestamps: true });

export default mongoose.model('BrandVoice', schema);
