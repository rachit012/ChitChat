import React, { createContext, useContext, useState } from 'react';

const CallContext = createContext();

export const useCallContext = () => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCallContext must be used within a CallProvider');
  }
  return context;
};

export const CallProvider = ({ children }) => {
  const [isCallActive, setIsCallActive] = useState(false);
  const [activeCallType, setActiveCallType] = useState(null);

  const startCall = (callType) => {
    if (!isCallActive) {
      setIsCallActive(true);
      setActiveCallType(callType);
      return true;
    }
    return false;
  };

  const endCall = () => {
    setIsCallActive(false);
    setActiveCallType(null);
  };

  return (
    <CallContext.Provider value={{
      isCallActive,
      activeCallType,
      startCall,
      endCall
    }}>
      {children}
    </CallContext.Provider>
  );
}; 