import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import api from "../../utils/api";
import { getSocket, isSocketConnected, connectSocket } from "../../utils/socket";
import FileIcon from "./FileIcon";

const PrivateChat = ({ currentUser }) => {
  const { userId } = useParams();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [otherUser, setOtherUser] = useState(null);
  const [socketReady, setSocketReady] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [selectedMessages, setSelectedMessages] = useState(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const messagesEndRef = useRef(null);
  let socketCleanup = () => {};

  useEffect(() => {
    let isMounted = true;

    const initializeSocket = async () => {
      try {
        if (!isSocketConnected()) {
          const token = localStorage.getItem('accessToken');
          await connectSocket(token);
        }

        const socket = await getSocket();
        if (!isMounted) return;

        setSocketReady(true);
        socket.off("newMessage");
        socket.off("messageDeleted"); // Add this line
        socket.off("messageError"); // Add this line

        const handleNewMessage = (message) => {
          setMessages(prev => {
            // Check if message already exists
            const existingIndex = prev.findIndex(msg => 
              msg._id === message._id || 
              msg.clientMsgId === message.clientMsgId
            );
            
            if (existingIndex !== -1) {
              // Update existing message
              const updated = [...prev];
              updated[existingIndex] = { ...message, fromServer: true };
              return updated;
            } else {
              // Add new message
              return [...prev, { ...message, fromServer: true }];
            }
          });
          setConnectionError(null);
        };

        const handleMessageDeleted = (deletionData) => {
          const { messageId, deleteType, message } = deletionData;
          
          setMessages(prev => prev.map(msg => {
            const msgId = msg._id || msg.clientMsgId;
            if (msgId === messageId) {
              if (deleteType === 'both') {
                return { ...msg, isDeleted: true, text: '[Message deleted]', attachments: [] };
              } else if (deleteType === 'sender') {
                return { ...msg, deletedForSender: true };
              } else if (deleteType === 'receiver') {
                return { ...msg, deletedForReceiver: true };
              }
            }
            return msg;
          }));
        };

        const handleMessageError = (error) => {
          console.error('Socket message error:', error);
          setConnectionError(error.error || 'Message error occurred');
        };

        socket.on("newMessage", handleNewMessage);
        socket.on("messageDeleted", handleMessageDeleted); // Add this line
        socket.on("messageError", handleMessageError); // Add this line
        socketCleanup = () => {
          socket.off("newMessage", handleNewMessage);
          socket.off("messageDeleted", handleMessageDeleted);
          socket.off("messageError", handleMessageError);
        };
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
        await initializeSocket();
        
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

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setConnectionError('Only JPG/JPEG images and PDF files are allowed');
      e.target.value = '';
      return;
    }

    try {
      setIsUploading(true);

      // Create preview for UI
      const previewUrl = URL.createObjectURL(file);
      setPreviewFile({
        url: previewUrl,
        type: file.type.startsWith('image/') ? 'image' : 'file',
        name: file.name,
        size: file.size
      });

      const formData = new FormData();
      formData.append('file', file);

      // Use the correct endpoint
      const { data } = await api.post('/messages/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      // Update preview file with server response
      setPreviewFile({
        url: data.url,
        type: data.type,
        name: data.originalname,
        size: data.size
      });

    } catch (err) {
      console.error('Upload failed:', err);
      setConnectionError('File upload failed');
      setPreviewFile(null);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleDownload = async (file) => {
  try {
    let blob;
    
    if (file.url.startsWith('blob:')) {
      // If it's already a blob URL
      const response = await fetch(file.url);
      blob = await response.blob();
    } else {
      // If it's a path, fetch from server
      const response = await api.get(file.url, { responseType: 'blob' });
      blob = response.data;
    }

    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', file.name);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  } catch (err) {
    console.error('Download failed:', err);
    setSocketError('Failed to download file');
  }
};

  const handleSendMessage = async () => {
    if ((!newMessage.trim() && !previewFile) || isUploading) return;

    try {
      const clientMsgId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const tempId = Date.now().toString();

      const tempMessage = {
        _id: tempId,
        clientMsgId,
        sender: { _id: currentUser._id, username: currentUser.username },
        receiver: { _id: userId },
        text: newMessage,
        attachments: previewFile ? [previewFile] : [],
        createdAt: new Date(),
        isTemp: true,
        isFailed: false
      };

      setMessages(prev => [...prev, tempMessage]);
      setNewMessage("");
      setPreviewFile(null);
      scrollToBottom();

      if (socketReady) {
        const socket = await getSocket();
        socket.emit("sendMessage", {
          receiver: userId,
          text: newMessage,
          attachments: previewFile ? [{
            url: previewFile.url,
            type: previewFile.type,
            name: previewFile.name,
            size: previewFile.size
          }] : [],
          clientMsgId
        });
      } else {
        // Fallback to API call
        const { data } = await api.post("/messages", {
          receiverId: userId,
          text: newMessage,
          attachments: previewFile ? [{
            url: previewFile.url,
            type: previewFile.type,
            name: previewFile.name,
            size: previewFile.size
          }] : [],
          clientMsgId
        });
        setMessages(prev => prev.map(msg => 
          msg.clientMsgId === clientMsgId ? data : msg
        ));
      }
    } catch (err) {
      console.error('Send message error:', err);
      setMessages(prev => 
        prev.map(msg => 
          msg._id === tempId 
            ? { ...msg, isFailed: true, error: "Failed to send" } 
            : msg
        )
      );
      setConnectionError("Failed to send message");
    }
  };

  // Test function for API endpoint
  const testApiCall = async () => {
    if (!previewFile) return;
    
    try {
      const { data } = await api.post("/messages/test-with-attachments", {
        receiverId: userId,
        text: "Test message with attachment",
        attachments: [{
          url: previewFile.url,
          type: previewFile.type,
          name: previewFile.name,
          size: previewFile.size
        }]
      });
      console.log('Test API call successful:', data);
      setConnectionError(null);
    } catch (err) {
      console.error('Test API call failed:', err);
      setConnectionError('Test API call failed: ' + err.message);
    }
  };

  // Message selection functions
  const toggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    if (isSelectionMode) {
      setSelectedMessages(new Set());
    }
  };

  const toggleMessageSelection = (messageId) => {
    const newSelected = new Set(selectedMessages);
    if (newSelected.has(messageId)) {
      newSelected.delete(messageId);
    } else {
      newSelected.add(messageId);
    }
    setSelectedMessages(newSelected);
  };

  const selectAllMessages = () => {
    const allMessageIds = messages
      .filter(msg => msg.sender._id === currentUser._id)
      .map(msg => msg._id || msg.clientMsgId);
    setSelectedMessages(new Set(allMessageIds));
  };

  const clearSelection = () => {
    setSelectedMessages(new Set());
  };

  const deleteSelectedMessages = async (deleteType) => {
    if (selectedMessages.size === 0) return;

    try {
      const socket = await getSocket();
      if (!socket) {
        throw new Error("Socket not available");
      }

      // Delete each selected message based on deleteType
      for (const messageId of selectedMessages) {
        const message = messages.find(msg => (msg._id || msg.clientMsgId) === messageId);
        if (message && message.sender._id === currentUser._id) {
          // Sender can delete for both sides or just for themselves
          socket.emit("deleteMessage", { messageId, deleteType });
        } else if (message) {
          // Receiver can only delete for themselves
          socket.emit("deleteMessage", { messageId, deleteType: 'receiver' });
        }
      }

      // Remove messages from local state based on deleteType
      setMessages(prev => prev.filter(msg => {
        const msgId = msg._id || msg.clientMsgId;
        if (!selectedMessages.has(msgId)) return true;
        
        // If deleting for everyone, remove the message completely
        if (deleteType === 'both') return false;
        
        // If deleting for sender only, keep the message but mark it as deleted for sender
        if (deleteType === 'sender') {
          return msg.sender._id !== currentUser._id; // Keep messages from others
        }
        
        // If deleting for receiver only, keep the message but mark it as deleted for receiver
        if (deleteType === 'receiver') {
          return msg.sender._id === currentUser._id; // Keep own messages
        }
        
        return true;
      }));

      // Clear selection
      setSelectedMessages(new Set());
      setIsSelectionMode(false);
      setConnectionError(null);
    } catch (err) {
      console.error("Failed to delete messages:", err);
      setConnectionError("Failed to delete messages - please try again");
    }
  };

  // Check if selected messages include receiver's messages
  const hasReceiverMessages = () => {
    return Array.from(selectedMessages).some(messageId => {
      const message = messages.find(msg => (msg._id || msg.clientMsgId) === messageId);
      return message && message.sender._id !== currentUser._id;
    });
  };

  // Check if selected messages include sender's messages
  const hasSenderMessages = () => {
    return Array.from(selectedMessages).some(messageId => {
      const message = messages.find(msg => (msg._id || msg.clientMsgId) === messageId);
      return message && message.sender._id === currentUser._id;
    });
  };

  const deleteMessage = async (messageId, deleteType) => {
    try {
      const socket = await getSocket();
      if (!socket) {
        throw new Error("Socket not available");
      }

      socket.emit("deleteMessage", { messageId, deleteType });
      
      // Update local state immediately
      setMessages(prev => prev.map(msg => {
        const msgId = msg._id || msg.clientMsgId;
        if (msgId === messageId) {
          if (deleteType === 'both') {
            return { ...msg, isDeleted: true, text: '[Message deleted]', attachments: [] };
          } else {
            return { ...msg, [`deletedFor${deleteType === 'sender' ? 'Sender' : 'Receiver'}`]: true };
          }
        }
        return msg;
      }));

      setConnectionError(null);
    } catch (err) {
      console.error("Failed to delete message:", err);
      setConnectionError("Failed to delete message - please try again");
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
          <form className="space-y-4">
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
              type="button"
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
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold mr-3">
            {otherUser?.username?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div>
            <h2 className="text-lg font-semibold">{otherUser?.username || 'Loading...'}</h2>
            <p className="text-sm text-gray-500">
              {otherUser?.online ? 'Online' : 'Offline'}
            </p>
          </div>
        </div>
        
        {/* Selection mode controls */}
        <div className="flex items-center space-x-2">
          {isSelectionMode && (
            <>
              <span className="text-sm text-gray-600">
                {selectedMessages.size} selected
              </span>
              <button
                onClick={selectAllMessages}
                className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                Select All
              </button>
              <button
                onClick={clearSelection}
                className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Clear
              </button>
              <button
                onClick={() => deleteSelectedMessages('sender')}
                disabled={selectedMessages.size === 0}
                className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Delete for me ({selectedMessages.size})
              </button>
              {hasSenderMessages() && !hasReceiverMessages() && (
                <button
                  onClick={() => deleteSelectedMessages('both')}
                  disabled={selectedMessages.size === 0}
                  className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Delete for everyone ({selectedMessages.size})
                </button>
              )}
            </>
          )}
          <button
            onClick={toggleSelectionMode}
            className={`px-3 py-1 text-sm rounded ${
              isSelectionMode
                ? 'bg-gray-600 text-white hover:bg-gray-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {isSelectionMode ? 'Cancel' : 'Select'}
          </button>
        </div>
      </div>

      {connectionError && (
        <div className="bg-yellow-100 text-yellow-800 p-2 text-sm text-center">
          {connectionError}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages
          .filter(message => {
            // Filter out messages that are deleted for the current user
            if (message.isDeleted) return false;
            if (message.deletedForSender && message.sender._id === currentUser._id) return false;
            if (message.deletedForReceiver && message.sender._id !== currentUser._id) return false;
            return true;
          })
          .map((message) => {
            const isSender = message.sender._id === currentUser._id;
            const messageId = message._id || message.clientMsgId;
            const isSelected = selectedMessages.has(messageId);
            
            return (
              <div
                key={messageId}
                className={`flex ${isSender ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${
                    isSender
                      ? "bg-blue-600 text-white rounded-br-none"
                      : "bg-gray-200 text-gray-800 rounded-bl-none"
                  } ${message.isTemp ? "opacity-80" : ""} ${
                    message.isFailed ? "border border-red-500" : ""
                  } ${isSelectionMode ? "cursor-pointer" : ""}`}
                  onClick={() => {
                    if (isSelectionMode) {
                      toggleMessageSelection(messageId);
                    }
                  }}
                >
                  {/* Selection checkbox */}
                  {isSelectionMode && (
                    <div className="flex items-center mb-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleMessageSelection(messageId)}
                        className="mr-2"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="text-xs opacity-75">Selected</span>
                    </div>
                  )}
                  
                  <div className="text-sm break-words">{message.text}</div>
                  {message.attachments?.map((file, idx) => (
                    <div key={idx} className="mt-2">
                      {file.type === 'image' ? (
                        <img 
                          src={file.url} 
                          alt={file.name} 
                          className="max-w-xs max-h-64 rounded-lg"
                        />
                      ) : (
                        <div 
                          onClick={() => handleDownload(file)}
                          className="flex items-center p-2 border rounded-lg hover:bg-gray-100 cursor-pointer"
                        >
                          <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center mr-2">
                            <FileIcon type={file.type} />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{file.name}</p>
                            <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  
                  <div
                    className={`text-xs mt-1 ${
                      isSender ? "text-blue-200" : "text-gray-500"
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
            );
          })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-gray-200">
        {previewFile && (
          <div className="mb-2 relative">
            {previewFile.type === 'image' ? (
              <img 
                src={previewFile.url} 
                alt="Preview" 
                className="max-w-xs max-h-32 rounded-lg"
              />
            ) : (
              <div className="flex items-center p-2 border rounded-lg">
                <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center mr-2">
                  <FileIcon type={previewFile.type} />
                </div>
                <div>
                  <p className="text-sm font-medium">{previewFile.name}</p>
                  <p className="text-xs text-gray-500">{formatFileSize(previewFile.size)}</p>
                </div>
              </div>
            )}
            <button 
              onClick={() => setPreviewFile(null)}
              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex">
          <label className="flex items-center justify-center p-2 rounded-lg hover:bg-gray-100 cursor-pointer mr-2">
            <input 
              type="file" 
              className="hidden" 
              onChange={handleFileUpload}
              disabled={isUploading}
              accept=".pdf,.jpg,.jpeg,image/jpeg,image/jpg,application/pdf"
            />
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </label>
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
            disabled={(!newMessage.trim() && !previewFile) || isUploading}
            className={`px-4 py-2 rounded-r-lg ${
              (newMessage.trim() || previewFile) && !isUploading
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            {isUploading ? 'Uploading...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
};

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat(bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

export default PrivateChat;