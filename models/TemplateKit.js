import mongoose from 'mongoose';

const templateKitItemSchema = new mongoose.Schema(
    {
        kind: {
            type: String,
            enum: ['email', 'resume'],
            required: true,
        },
        sourceType: {
            type: String,
            enum: ['default', 'admin', 'user'],
            required: true,
        },
        sourceId: {
            type: String,
            required: true,
        },
        title: {
            type: String,
            default: '',
        },
        thumbnailUrl: {
            type: String,
            default: '',
        },
    },
    { _id: false }
);

const templateKitSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        kind: {
            type: String,
            enum: ['email', 'resume'],
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        items: {
            type: [templateKitItemSchema],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

templateKitSchema.index({ user: 1, kind: 1, name: 1 }, { unique: true });

const TemplateKit = mongoose.model('TemplateKit', templateKitSchema);
export default TemplateKit;
