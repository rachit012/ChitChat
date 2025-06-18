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
    const { receiverId, roomId, text, clientMsgId } = req.body;
    
    if (!text) {
      return res.status(400).json({ message: 'Message text is required' });
    }

    const messageData = {
      sender: req.user._id,
      text,
      clientMsgId
    };

    if (receiverId) {
      messageData.receiver = receiverId;
    } else if (roomId) {
      messageData.room = roomId;
    } else {
      return res.status(400).json({ message: 'Either receiverId or roomId is required' });
    }

    const message = new Message(messageData);
    await message.save();
    
    const populatedMessage = await Message.populate(message, [
      { path: 'sender', select: 'username avatar' },
      { path: 'receiver', select: 'username avatar' },
      { path: 'room', select: 'name' }
    ]);

    res.status(201).json(populatedMessage);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/room/:roomId', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const messages = await Message.find({ room: req.params.roomId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('sender', 'username avatar');

    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
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