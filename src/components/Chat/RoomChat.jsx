import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import api from "../../utils/api";
import { getSocket } from "../../utils/socket";

const RoomChat = ({ currentUser }) => {
  const { roomId } = useParams();
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [socketError, setSocketError] = useState(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    let isMounted = true;
    let socket;
    const cleanupFunctions = [];

    const fetchData = async () => {
      try {
        setLoading(true);
        const [roomRes, messagesRes] = await Promise.all([
          api.get(`/rooms/${roomId}`),
          api.get(`/messages/room/${roomId}`)
        ]);

        if (isMounted) {
          setRoom(roomRes.data);
          setMessages(messagesRes.data);
          setSocketError(null);
        }
      } catch (err) {
        if (isMounted) {
          setSocketError("Failed to load room data");
          console.error("Failed to fetch room:", err);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    const setupSocket = async () => {
      try {
        socket = await getSocket();
        if (!socket || !isMounted) return;

        socket.emit("joinRoom", roomId);
        
        const messageHandler = (message) => {
          if (isMounted && message.room === roomId) {
            setMessages(prev => {
              const existingIndex = prev.findIndex(msg => 
                (msg.tempId && msg.tempId === message.tempId) ||
                (msg._id && msg._id === message._id)
              );
              
              if (existingIndex >= 0) {
                const newMessages = [...prev];
                newMessages[existingIndex] = message;
                return newMessages;
              }
              return [...prev, message];
            });
          }
        };

        const removeFailedHandler = ({ tempId }) => {
          if (isMounted) {
            setMessages(prev => prev.filter(msg => msg.tempId !== tempId));
            setSocketError("Failed to send message - please try again");
          }
        };

        const messageDeletedHandler = (message) => {
          if (isMounted && message.room === roomId) {
            setMessages(prev => prev.map(msg => 
              msg._id === message._id ? message : msg
            ));
          }
        };

        const joinHandler = ({ userId, username, roomId: joinedRoomId }) => {
          if (isMounted && joinedRoomId === roomId && room) {
            setRoom(prev => ({
              ...prev,
              members: [...(prev.members || []), { _id: userId, username }]
            }));
          }
        };

        const leaveHandler = ({ userId, roomId: leftRoomId }) => {
          if (isMounted && leftRoomId === roomId && room) {
            setRoom(prev => ({
              ...prev,
              members: (prev.members || []).filter(member => member._id !== userId)
            }));
          }
        };

        const errorHandler = (err) => {
          if (isMounted) {
            setSocketError("Realtime connection issue - messages may be delayed");
            console.error("Socket error:", err);
          }
        };

        socket.on("newRoomMessage", messageHandler);
        socket.on("removeFailedMessage", removeFailedHandler);
        socket.on("roomMessageDeleted", messageDeletedHandler);
        socket.on("userJoinedRoom", joinHandler);
        socket.on("userLeftRoom", leaveHandler);
        socket.on("connect_error", errorHandler);

        cleanupFunctions.push(() => {
          socket.off("newRoomMessage", messageHandler);
          socket.off("removeFailedMessage", removeFailedHandler);
          socket.off("roomMessageDeleted", messageDeletedHandler);
          socket.off("userJoinedRoom", joinHandler);
          socket.off("userLeftRoom", leaveHandler);
          socket.off("connect_error", errorHandler);
        });

      } catch (err) {
        if (isMounted) {
          setSocketError("Failed to connect to realtime service");
          console.error("Socket setup error:", err);
        }
      }
    };

    fetchData();
    setupSocket();

    return () => {
      isMounted = false;
      cleanupFunctions.forEach(fn => fn());
      if (socket) {
        socket.emit("leaveRoom", roomId);
      }
    };
  }, [roomId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !room) return;

    try {
      const socket = await getSocket();
      if (!socket) {
        throw new Error("Socket not available");
      }

      const tempId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const tempMessage = {
        _id: tempId,
        sender: currentUser._id,
        senderName: currentUser.username,
        room: roomId,
        text: newMessage,
        createdAt: new Date(),
        tempId,
        sender: {
        _id: currentUser._id,
        username: currentUser.username
      }
      };

      setMessages(prev => [...prev, tempMessage]);
      setNewMessage("");
      scrollToBottom();

      socket.emit("sendRoomMessage", {
        roomId,
        text: newMessage,
        tempId,
        sender: currentUser._id,
        senderName: currentUser.username
      });

    } catch (err) {
      console.error("Failed to send message:", err);
      setSocketError("Failed to send message - please try again");
    }
  };

  const handleDeleteMessage = async (messageId) => {
    try {
      const socket = await getSocket();
      if (!socket) {
        throw new Error("Socket not available");
      }

      setMessages(prev => prev.map(msg => 
        msg._id === messageId 
          ? { ...msg, text: '[Message deleted]', isDeleted: true } 
          : msg
      ));

      socket.emit("deleteRoomMessage", { messageId });

    } catch (err) {
      console.error("Failed to delete message:", err);
      setSocketError("Failed to delete message - please try again");
    }
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><p>Loading room...</p></div>;
  }

  if (!room) {
    return <div className="flex-1 flex items-center justify-center text-red-500">Failed to load room data</div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold">{room.name}</h2>
        <p className="text-sm text-gray-500">{room.description}</p>
        {socketError && (
          <div className="bg-yellow-100 text-yellow-800 p-2 text-sm mt-2">
            {socketError}
          </div>
        )}
        <div className="flex items-center mt-2">
          <div className="flex -space-x-2">
            {(room.members || []).slice(0, 5).map((member, index) => (
              <div
                key={member._id}
                className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium"
                style={{ zIndex: 5 - index }}
              >
                {member.username.charAt(0).toUpperCase()}
              </div>
            ))}
          </div>
          {(room.members || []).length > 5 && (
            <span className="ml-2 text-sm text-gray-500">
              +{(room.members || []).length - 5} more
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((message, index) => {
          const isSender = message.sender?._id === currentUser._id || message.sender === currentUser._id;
          const showHeader = index === 0 || 
            messages[index - 1]?.sender !== message.sender ||
            new Date(message.createdAt) - new Date(messages[index - 1]?.createdAt || 0) > 60000;
          
          return (
            <div 
              key={message._id || message.tempId} 
              className={`flex ${isSender ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-xs lg:max-w-md ${isSender ? "" : ""}`}>
                {showHeader && !isSender && (
                  <div className="text-xs font-medium text-gray-500 mb-1">
                    {message.senderName || message.sender?.username}
                  </div>
                )}
                <div className="relative group">
                  <div
                    className={`px-4 py-2 rounded-2xl ${
                      isSender
                        ? "bg-blue-600 text-white rounded-br-none ml-auto"
                        : "bg-gray-200 text-gray-800 rounded-bl-none mr-auto"
                    } ${message.isDeleted ? "italic text-gray-500" : ""}`}
                  >
                    <div className="text-sm break-words">
                      {message.isDeleted ? '[Message deleted]' : message.text}
                    </div>
                    <div
                      className={`text-xs mt-1 ${
                        isSender ? "text-blue-200" : "text-gray-500"
                      }`}
                    >
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </div>
                  </div>
                  {isSender && !message.isDeleted && (
                    <button
                      onClick={() => handleDeleteMessage(message._id)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Delete message"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-200">
        <div className="flex">
          <input
            type="text"
            placeholder={`Message #${room.name}`}
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

export default RoomChat;