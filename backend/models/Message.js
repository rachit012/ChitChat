const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    required: true
  },
  clientMsgId: { // Add this field
    type: String,
    unique: true,
    sparse: true // Allows null values for old messages
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Add indexes for faster querying
// messageSchema.index({ sender: 1, receiver: 1 });
// messageSchema.index({ createdAt: 1 });
// Add indexes for faster querying and to prevent duplicates
messageSchema.index({ sender: 1, receiver: 1, text: 1,clientMsgId: 1, createdAt: 1 }, { unique: true });

module.exports = mongoose.model('Message', messageSchema);