import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import api from "../../utils/api";
import { getSocket, isSocketConnected, connectSocket } from "../../utils/socket";

const PrivateChat = ({ currentUser }) => {
  const { userId } = useParams();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [otherUser, setOtherUser] = useState(null);
  const [socketReady, setSocketReady] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
  let isMounted = true;
  let socketCleanup = () => {};

  const initializeSocket = async () => {
    try {
      if (!isSocketConnected()) {
        const token = localStorage.getItem('accessToken');
        await connectSocket(token);
      }

      const socket = await getSocket();
      if (!isMounted) return;

      setSocketReady(true);

      // Remove any existing listener first
      socket.off("newMessage");

      const handleNewMessage = (message) => {
        if (isMounted && (
          (message.sender._id === userId && message.receiver._id === currentUser._id) ||
          (message.sender._id === currentUser._id && message.receiver._id === userId)
        )) {
    setMessages(prev => {
      // Check if we already have this message (by clientMsgId or temp message)
      const isDuplicate = prev.some(msg => 
        (msg.clientMsgId && msg.clientMsgId === message.clientMsgId) ||
        (msg.isTemp && msg.text === message.text && 
         Math.abs(new Date(msg.createdAt) - new Date(message.createdAt)) < 1000)
      );
      
      return isDuplicate ? prev : [...prev, message];
            });
        }
      };

      socket.on("newMessage", handleNewMessage);
      socketCleanup = () => socket.off("newMessage", handleNewMessage);
    } catch (err) {
      if (isMounted) {
        setSocketReady(false);
        setConnectionError("Realtime updates unavailable - messages may be delayed");
        console.warn("Socket connection error:", err.message);
      }
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      await initializeSocket(); // Initialize socket first
      
      const [messagesRes, userRes] = await Promise.all([
        api.get(`/messages/${userId}`),
        api.get(`/users/${userId}`)
      ]);

      if (isMounted) {
        setMessages(messagesRes.data);
        setOtherUser(userRes.data);
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
      if (err.response?.status === 401) {
        window.location.href = '/login';
      }
    } finally {
      if (isMounted) setLoading(false);
    }
  };

  fetchData();

  return () => {
    isMounted = false;
    socketCleanup();
  };
}, [userId, currentUser._id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendMessage = async () => {
  if (!newMessage.trim()) return;

  // Generate a unique client-side ID for this message
  const clientMsgId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const tempId = Date.now().toString();

  const tempMessage = {
    _id: tempId,
    clientMsgId, // Include the client-generated ID
    sender: { _id: currentUser._id, username: currentUser.username },
    receiver: { _id: userId },
    text: newMessage,
    createdAt: new Date(),
    isTemp: true,
    isFailed: false
  };

  // Add temporary message optimistically
  setMessages(prev => [...prev, tempMessage]);
  setNewMessage("");

  try {
    if (socketReady) {
      const socket = await getSocket();
      socket.emit("sendMessage", {
        receiver: userId,
        text: newMessage,
        clientMsgId // Send the client-generated ID
      });
    } else {
      const { data } = await api.post("/messages", {
        receiverId: userId,
        text: newMessage,
        clientMsgId // Include in API call
      });
      setMessages(prev => prev.map(msg => 
        msg.clientMsgId === clientMsgId ? data : msg
      ));
    }
  } catch (err) {
    setMessages(prev => 
      prev.map(msg => 
        msg._id === tempId 
          ? { ...msg, isFailed: true, error: "Failed to send" } 
          : msg
      )
    );
  }
};

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p>Loading messages...</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">Please log in to continue</h2>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                className="w-full px-3 py-2 border rounded"
                placeholder="your@email.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input
                type="password"
                className="w-full px-3 py-2 border rounded"
                placeholder="••••••••"
                required
              />
            </div>
            {connectionError && (
              <div className="text-red-500 text-sm">{connectionError}</div>
            )}
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
            >
              Log In
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="p-4 border-b border-gray-200 flex items-center">
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-purple-500 flex items-center justify-center text-white font-bold">
            {otherUser?.username?.charAt(0).toUpperCase()}
          </div>
          <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${
            otherUser?.online ? "bg-green-500" : "bg-gray-400"
          }`}></div>
        </div>
        <div className="ml-3">
          <p className="font-medium">{otherUser?.username}</p>
          <p className="text-xs text-gray-500">
            {otherUser?.online ? "Online" : `Last seen ${new Date(otherUser?.lastSeen).toLocaleTimeString()}`}
          </p>
        </div>
      </div>

      {connectionError && (
        <div className="bg-yellow-100 text-yellow-800 p-2 text-sm text-center">
          {connectionError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((message) => (
          <div
    key={message._id || message.clientMsgId || `temp-${message._id}`}
    className={`flex ${
      message.sender._id === currentUser._id ? "justify-end" : "justify-start"
    }`}
  >
            <div
              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${
                message.sender._id === currentUser._id
                  ? "bg-blue-600 text-white rounded-br-none"
                  : "bg-gray-200 text-gray-800 rounded-bl-none"
              } ${message.isTemp ? "opacity-80" : ""} ${
                message.isFailed ? "border border-red-500" : ""
              }`}
            >
              <div className="text-sm break-words">{message.text}</div>
              <div
                className={`text-xs mt-1 ${
                  message.sender._id === currentUser._id ? "text-blue-200" : "text-gray-500"
                }`}
              >
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit"
                })}
                {message._id?.startsWith('temp-') && !message.isFailed && " (Sending...)"}
                {message.isFailed && " (Failed to send)"}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-200">
        <div className="flex">
          <input
            type="text"
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
          />
          <button
            onClick={handleSendMessage}
            disabled={!newMessage.trim()}
            className={`px-4 py-2 rounded-r-lg ${
              newMessage.trim()
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrivateChat;