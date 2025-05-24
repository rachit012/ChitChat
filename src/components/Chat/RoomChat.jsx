import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import api from "../../utils/api";
import { getSocket } from "../../utils/socket";

const RoomChat = ({ currentUser }) => {
  const { roomId } = useParams();
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef(null);

  useEffect(() => {
  let socket;
  let isMounted = true;

  const setupSocket = async () => {
    try {
      socket = await getSocket();
      if (!socket || !isMounted) return;

      socket.emit("joinRoom", roomId);
      
      const messageHandler = (message) => {
        if (message.roomId === roomId && isMounted) {
          setMessages(prev => [...prev, message]);
        }
      };

      const joinHandler = ({ userId, username, roomId: joinedRoomId }) => {
        if (joinedRoomId === roomId && isMounted) {
          setRoom(prev => ({
            ...prev,
            members: [...prev.members, { _id: userId, username }]
          }));
        }
      };

      const leaveHandler = ({ userId, roomId: leftRoomId }) => {
        if (leftRoomId === roomId && isMounted) {
          setRoom(prev => ({
            ...prev,
            members: prev.members.filter(member => member._id !== userId)
          }));
        }
      };

      socket.on("newRoomMessage", messageHandler);
      socket.on("userJoinedRoom", joinHandler);
      socket.on("userLeftRoom", leaveHandler);

      return () => {
        socket.off("newRoomMessage", messageHandler);
        socket.off("userJoinedRoom", joinHandler);
        socket.off("userLeftRoom", leaveHandler);
      };
    } catch (err) {
      console.error("Socket setup error:", err);
    }
  };

  const fetchRoom = async () => {
    try {
      const { data } = await api.get(`/rooms/${roomId}`);
      if (isMounted) setRoom(data);
    } catch (err) {
      console.error("Failed to fetch room:", err);
    } finally {
      if (isMounted) setLoading(false);
    }
  };

  setupSocket();
  fetchRoom();

  return () => {
    isMounted = false;
    if (socket) {
      socket.emit("leaveRoom", roomId);
    }
  };
}, [roomId]);

  useEffect(() => {
  const socket = getSocket();
  if (!socket) {
    console.warn("Socket not available - realtime updates disabled");
    return;
  }

  const handleError = (err) => {
    console.error("Socket error:", err);
  };

  socket.on("connect_error", handleError);
  
  return () => {
    socket.off("connect_error", handleError);
  };
}, [roomId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;

    const socket = getSocket();
    socket.emit("sendRoomMessage", {
      roomId,
      text: newMessage
    });

    setMessages(prev => [
      ...prev,
      {
        sender: currentUser._id,
        senderName: currentUser.username,
        roomId,
        text: newMessage,
        timestamp: new Date(),
        isTemp: true
      }
    ]);

    setNewMessage("");
  };

  if (loading || !room) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p>Loading room...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold">{room.name}</h2>
        <p className="text-sm text-gray-500">{room.description}</p>
        <div className="flex items-center mt-2">
          <div className="flex -space-x-2">
            {room.members.slice(0, 5).map((member, index) => (
              <div
                key={member._id}
                className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium"
                style={{ zIndex: 5 - index }}
              >
                {member.username.charAt(0).toUpperCase()}
              </div>
            ))}
          </div>
          {room.members.length > 5 && (
            <span className="ml-2 text-sm text-gray-500">
              +{room.members.length - 5} more
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((message, index) => {
          const isSender = message.sender === currentUser._id;
          const showHeader = index === 0 || 
            messages[index - 1].sender !== message.sender ||
            new Date(message.timestamp) - new Date(messages[index - 1].timestamp) > 60000;

          return (
            <div key={index} className="space-y-1">
              {showHeader && !isSender && (
                <div className="text-xs font-medium text-gray-500">
                  {message.senderName}
                </div>
              )}
              <div className={`flex ${isSender ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${
                    isSender
                      ? "bg-blue-600 text-white rounded-br-none"
                      : "bg-gray-200 text-gray-800 rounded-bl-none"
                  }`}
                >
                  <div className="text-sm break-words">{message.text}</div>
                  <div
                    className={`text-xs mt-1 ${
                      isSender ? "text-blue-200" : "text-gray-500"
                    }`}
                  >
                    {new Date(message.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </div>
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