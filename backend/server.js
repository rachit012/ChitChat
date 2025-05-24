require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketio = require('socket.io');
const jwt = require('jsonwebtoken');
const Message = require('./models/Message');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Socket.IO setup
const io = socketio(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true
  }
});

// Socket auth middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token provided'));

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) return next(new Error('Invalid token'));
    
    try {
      // Update user's online status
      await User.findByIdAndUpdate(decoded.userId, { 
        online: true,
        lastSeen: null
      });
      
      socket.userId = decoded.userId;
      socket.username = decoded.username;
      next();
    } catch (error) {
      next(new Error('User update failed'));
    }
  });
});

// Track active rooms
const activeRooms = new Map();

// Socket connection
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.userId}`);
  
  // Join user's personal room
  socket.join(socket.userId);
  
  // Notify others this user is online
  socket.broadcast.emit('userOnline', socket.userId);

  // Handle private messages
socket.on('sendMessage', async ({ receiver, text, clientMsgId }) => {
  try {
    const message = new Message({
      sender: socket.userId,
      receiver: receiver,
      text: text,
      clientMsgId
    });

    const savedMessage = await message.save();
    const populatedMessage = await Message.populate(savedMessage, [
      { path: 'sender', select: 'username avatar' },
      { path: 'receiver', select: 'username avatar' }
    ]);

    // NEW FEATURE
    
    // Emit to both parties with the same message object
    const messageToEmit = {
      ...populatedMessage.toObject(),
      clientMsgId,
      // Add flag to indicate this came from server
      fromServer: true
    };
    
    // Send to receiver
    io.to(receiver).emit('newMessage', messageToEmit);
    // Also send back to sender
    io.to(socket.userId).emit('newMessage', messageToEmit);
    
  } catch (err) {
    console.error('Message error:', err.message);
    socket.emit('messageError', { 
      error: 'Failed to send message',
      clientMsgId
    });
  }
});

  // Handle joining chat rooms
  socket.on('joinRoom', async (roomId) => {
    socket.join(roomId);
    console.log(`${socket.userId} joined room ${roomId}`);
    
    // Track room activity
    if (!activeRooms.has(roomId)) {
      activeRooms.set(roomId, new Set());
    }
    activeRooms.get(roomId).add(socket.userId);
    
    // Notify room members
    io.to(roomId).emit('userJoinedRoom', {
      userId: socket.userId,
      username: socket.username,
      roomId: roomId
    });
  });

  // Handle leaving chat rooms
  socket.on('leaveRoom', (roomId) => {
    socket.leave(roomId);
    console.log(`${socket.userId} left room ${roomId}`);
    
    if (activeRooms.has(roomId)) {
      activeRooms.get(roomId).delete(socket.userId);
      if (activeRooms.get(roomId).size === 0) {
        activeRooms.delete(roomId);
      }
    }
    
    // Notify room members
    io.to(roomId).emit('userLeftRoom', {
      userId: socket.userId,
      username: socket.username,
      roomId: roomId
    });
  });

  // Handle room messages
  socket.on('sendRoomMessage', async ({ roomId, text }) => {
    try {
      const message = {
        sender: socket.userId,
        senderName: socket.username,
        roomId: roomId,
        text: text,
        timestamp: new Date()
      };
      
      io.to(roomId).emit('newRoomMessage', message);
    } catch (err) {
      console.error('Room message error:', err);
      socket.emit('messageError', { error: 'Failed to send room message' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.userId}`);
    
    try {
      // Update user's online status
      await User.findByIdAndUpdate(socket.userId, { 
        online: false,
        lastSeen: new Date()
      });
      
      // Notify others this user went offline
      socket.broadcast.emit('userOffline', socket.userId);
      
      // Leave all rooms
      activeRooms.forEach((users, roomId) => {
        if (users.has(socket.userId)) {
          users.delete(socket.userId);
          io.to(roomId).emit('userLeftRoom', {
            userId: socket.userId,
            username: socket.username,
            roomId: roomId
          });
          
          if (users.size === 0) {
            activeRooms.delete(roomId);
          }
        }
      });
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  });
});

const roomRoutes = require('./routes/roomRoutes');

// API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/rooms', roomRoutes);

// Server start
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));