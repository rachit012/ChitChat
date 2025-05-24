const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const authMiddleware = require('../middleware/authMiddleware');

// Get messages between two users with pagination
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const messages = await Message.find({
      $or: [
        { sender: req.user._id, receiver: req.params.userId },
        { sender: req.params.userId, receiver: req.user._id }
      ]
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'username avatar')
    .populate('receiver', 'username avatar');

    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send a message
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { receiverId, text } = req.body;
    
    const message = new Message({
      sender: req.user._id,
      receiver: receiverId,
      text
    });
    
    await message.save();
    
    // Populate sender info
    const populatedMessage = await Message.populate(message, [
      { path: 'sender', select: 'username avatar' },
      { path: 'receiver', select: 'username avatar' }
    ]);

    res.status(201).json(populatedMessage);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a message
router.delete('/:messageId', authMiddleware, async (req, res) => {
  try {
    const message = await Message.findOneAndDelete({
      _id: req.params.messageId,
      sender: req.user._id
    });

    if (!message) {
      return res.status(404).json({ message: 'Message not found or unauthorized' });
    }

    res.json({ message: 'Message deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;