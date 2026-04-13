import mongoose from 'mongoose';

const templateSchema = new mongoose.Schema(
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
        title: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: '',
            trim: true,
        },
        category: {
            type: String,
            default: 'general',
            trim: true,
        },
        content: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        design: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        thumbnailUrl: {
            type: String,
            default: '',
        },
        sourceDefaultId: {
            type: String,
            index: true,
        },
        sourceAdminTemplateId: {
            type: String,
            index: true,
        },
        importedFromDefault: {
            type: Boolean,
            default: false,
        },
        importedFromAdmin: {
            type: Boolean,
            default: false,
        },
        isFavorite: {
            type: Boolean,
            default: false,
            index: true,
        },
        tags: {
            type: [String],
            default: [],
        },
        status: {
            type: String,
            enum: ['active', 'archived'],
            default: 'active',
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

templateSchema.index(
    { user: 1, kind: 1, sourceDefaultId: 1 },
    {
        unique: true,
        partialFilterExpression: { sourceDefaultId: { $exists: true, $type: 'string', $ne: '' } },
    }
);
templateSchema.index(
    { user: 1, kind: 1, sourceAdminTemplateId: 1 },
    {
        unique: true,
        partialFilterExpression: { sourceAdminTemplateId: { $exists: true, $type: 'string', $ne: '' } },
    }
);

const Template = mongoose.model('Template', templateSchema);
export default Template;
