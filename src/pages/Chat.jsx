import { useState, useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import api from "../utils/api";
import Sidebar from "../components/Chat/Sidebar";
import PrivateChat from "../components/Chat/PrivateChat";
import RoomChat from "../components/Chat/RoomChat";

const Chat = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("users");
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
  const fetchCurrentUser = async () => {
    try {
      const { data } = await api.get("/auth/me");
      setCurrentUser(data);
      
      if (location.pathname.includes("/room/")) {
        setActiveTab("rooms");
      } else if (location.pathname.includes("/chat/")) {
        setActiveTab("users");
      }
    } catch (err) {
      if (err.response?.status === 401) {
        // The api.js interceptor should handle redirecting to login
        console.error("Authentication failed:", err);
      } else {
        console.error("Failed to fetch user:", err);
      }
    } finally {
      setLoading(false);
    }
  };

  fetchCurrentUser();
}, [navigate, location.pathname]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        currentUser={currentUser} 
      />
      
      <Routes>
        <Route path="/chat/:userId" element={<PrivateChat currentUser={currentUser} />} />
        <Route path="/room/:roomId" element={<RoomChat currentUser={currentUser} />} />
        <Route path="*" element={
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center p-8 max-w-md">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Welcome to WireChat</h2>
              <p className="text-gray-600 mb-6">
                {activeTab === "users" 
                  ? "Select a user to start a private conversation" 
                  : "Join a room to start chatting with the community"}
              </p>
            </div>
          </div>
        } />
      </Routes>
    </div>
  );
};

export default Chat;