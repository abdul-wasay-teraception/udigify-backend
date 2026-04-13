import mongoose from 'mongoose';

// Generic key→value store for admin-configurable settings
const schema = new mongoose.Schema({
    key:       { type: String, required: true, unique: true },
    value:     { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model('PowerToolsSettings', schema);
