// src/utils/socket.js
import { io } from 'socket.io-client';
import api from './api';

let socketInstance = null;
let connectionPromise = null;

export const isSocketConnected = () => {
  return socketInstance && socketInstance.connected;
};

export const connectSocket = async (token) => {
  if (socketInstance && socketInstance.connected) {
    return socketInstance;
  }

  if (socketInstance) {
    socketInstance.disconnect();
  }

  socketInstance = io('http://localhost:5000', {
    auth: { token },
    withCredentials: true,
    autoConnect: false
  });

  connectionPromise = new Promise((resolve, reject) => {
    const connectTimeout = setTimeout(() => {
      reject(new Error('Socket connection timed out'));
    }, 5000);

    socketInstance.once('connect', () => {
      clearTimeout(connectTimeout);
      resolve(socketInstance);
    });

    socketInstance.once('connect_error', async (err) => {
  clearTimeout(connectTimeout);
  try {
    // Only attempt refresh if the error is likely due to token expiration
    if (err.message.includes('unauthorized') || err.message.includes('jwt')) {
      const { data } = await api.post('/auth/refresh');
      localStorage.setItem('accessToken', data.token);
      await connectSocket(data.token);
      resolve(socketInstance);
    } else {
      reject(err);
    }
  } catch (refreshErr) {
    if (refreshErr.response?.status === 401) {
      window.location.href = '/login';
    }
    reject(refreshErr);
  }
});

    socketInstance.connect();
  });

  return socketInstance;
};

export const getSocket = async () => {
  if (socketInstance && socketInstance.connected) {
    return socketInstance;
  }

  if (!socketInstance) {
    const token = localStorage.getItem('accessToken');
    if (!token) return null;
    await connectSocket(token);
  }

  try {
    return await connectionPromise;
  } catch (err) {
    console.error("Socket connection failed:", err);
    // Attempt to reconnect
    const token = localStorage.getItem('accessToken');
    if (token) {
      try {
        await connectSocket(token);
        return await connectionPromise;
      } catch (retryErr) {
        console.error("Socket reconnection failed:", retryErr);
        return null;
      }
    }
    return null;
  }
};