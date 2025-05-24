const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

// Get all users (excluding current user)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select('-password')
      .sort({ online: -1, username: 1 });
    
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// Search users
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) {
      return res.status(400).json({ message: 'Search query must be at least 2 characters' });
    }

    const users = await User.find({
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { bio: { $regex: query, $options: 'i' } },
        { interests: { $regex: query, $options: 'i' } }
      ],
      _id: { $ne: req.user._id }
    }).select('-password');

    res.json(users);
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ message: 'Search failed' });
  }
});

// Get user profile
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: 'Failed to fetch user' });
  }
});

module.exports = router;