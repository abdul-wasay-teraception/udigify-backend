import mongoose from 'mongoose';

const userAssetSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        kind: {
            type: String,
            enum: ['logo', 'image', 'background'],
            default: 'image',
            index: true,
        },
        label: {
            type: String,
            default: '',
            trim: true,
        },
        url: {
            type: String,
            required: true,
        },
        storage: {
            type: String,
            enum: ['cloudinary', 'local'],
            default: 'local',
        },
        publicId: {
            type: String,
            default: '',
        },
        mimeType: {
            type: String,
            default: '',
        },
        size: {
            type: Number,
            default: 0,
        },
        width: {
            type: Number,
            default: 0,
        },
        height: {
            type: Number,
            default: 0,
        },
        tags: {
            type: [String],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

const UserAsset = mongoose.model('UserAsset', userAssetSchema);
export default UserAsset;
