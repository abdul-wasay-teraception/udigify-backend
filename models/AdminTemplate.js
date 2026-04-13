import mongoose from 'mongoose';

const adminTemplateSchema = new mongoose.Schema(
    {
        createdBy: {
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
        tags: {
            type: [String],
            default: [],
        },
        versionLabel: {
            type: String,
            default: 'v1',
            trim: true,
        },
        isPublished: {
            type: Boolean,
            default: true,
            index: true,
        },
        approvalState: {
            type: String,
            enum: ['draft', 'review', 'approved', 'published'],
            default: 'draft',
            index: true,
        },
        approvalNotes: {
            type: String,
            default: '',
            trim: true,
        },
        revisionHistory: [
            {
                _id: {
                    type: mongoose.Schema.Types.ObjectId,
                    auto: true,
                },
                version: {
                    type: String,
                    required: true,
                },
                timestamp: {
                    type: Date,
                    default: Date.now,
                },
                author: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'User',
                    required: true,
                },
                authorName: {
                    type: String,
                    default: 'Unknown',
                },
                changes: {
                    type: String,
                    default: 'Initial version',
                },
                approver: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'User',
                    default: null,
                },
                approverName: {
                    type: String,
                    default: '',
                },
                approvalNotes: {
                    type: String,
                    default: '',
                },
                approvalState: {
                    type: String,
                    enum: ['draft', 'review', 'approved', 'published'],
                    default: 'draft',
                },
            },
        ],
        nextReviewerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

const AdminTemplate = mongoose.model('AdminTemplate', adminTemplateSchema);
export default AdminTemplate;
