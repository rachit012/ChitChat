// src/utils/socket.js
import { io } from 'socket.io-client';
import api from './api';

let socketInstance = null;
let connectionPromise = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

// Use environment variable or fallback to localhost
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

const createSocketInstance = (token) => {
  return io(SOCKET_URL, {
    auth: { token },
    withCredentials: true,
    autoConnect: false,
    reconnection: false, // We'll handle reconnection manually
    transports: ['websocket']
  });
};

export const isSocketConnected = () => {
  return socketInstance?.connected;
};

export const connectSocket = async (token) => {
  if (socketInstance && socketInstance.connected) {
    return socketInstance;
  }

  // Disconnect existing instance if any
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }

  socketInstance = createSocketInstance(token);
  connectionPromise = new Promise((resolve, reject) => {
    const connectTimeout = setTimeout(() => {
      reject(new Error('Socket connection timed out'));
    }, 10000); // 10 seconds timeout

    const cleanup = () => {
      clearTimeout(connectTimeout);
      socketInstance.off('connect', onConnect);
      socketInstance.off('connect_error', onError);
    };

    const onConnect = () => {
      cleanup();
      reconnectAttempts = 0; // Reset on successful connection
      resolve(socketInstance);
    };

    const onError = async (err) => {
      cleanup();
      try {
        if ((err.message.includes('unauthorized') || err.message.includes('jwt')) && 
            reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          
          // Attempt token refresh
          const { data } = await api.post('/auth/refresh');
          localStorage.setItem('accessToken', data.token);
          
          // Create new instance with fresh token
          socketInstance = createSocketInstance(data.token);
          socketInstance.connect();
        } else {
          if (err.message.includes('unauthorized')) {
            window.location.href = '/login';
          }
          reject(err);
        }
      } catch (refreshErr) {
        if (refreshErr.response?.status === 401) {
          window.location.href = '/login';
        }
        reject(refreshErr);
      }
    };

    socketInstance.once('connect', onConnect);
    socketInstance.once('connect_error', onError);
    socketInstance.connect();
  });

  return connectionPromise;
};

export const getSocket = async () => {
  if (socketInstance?.connected) {
    return socketInstance;
  }

  const token = localStorage.getItem('accessToken');
  if (!token) {
    throw new Error('No access token available');
  }

  if (!socketInstance) {
    return connectSocket(token);
  }

  try {
    return await connectionPromise;
  } catch (err) {
    console.error("Socket connection failed:", err);
    throw err;
  }
};

export const disconnectSocket = () => {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
    connectionPromise = null;
  }
};