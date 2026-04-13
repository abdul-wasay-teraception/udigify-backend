import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    url:              { type: String, required: true },
    ssl:              { type: mongoose.Schema.Types.Mixed, default: {} },
    pageSpeed:        { type: mongoose.Schema.Types.Mixed, default: {} },
    brokenLinks:      [String],
    brokenLinksCount: { type: Number, default: 0 },
    aiSummary:        { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('HealthCheckLog', schema);
