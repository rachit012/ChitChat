import React, { useState, useEffect } from 'react';
import { getSocket } from '../utils/socket';
import VideoCall from './VideoCall';
import { useCallContext } from '../contexts/CallContext';

const CallManager = ({ currentUser }) => {
  const [incomingCall, setIncomingCall] = useState(null);
  const [socket, setSocket] = useState(null);
  const { isCallActive, startCall, endCall } = useCallContext();

  useEffect(() => {
    const initializeCallManager = async () => {
      try {
        const socketInstance = await getSocket();
        setSocket(socketInstance);

        console.log('CallManager: Setting up global call event listeners');

        // Global call event listeners
        socketInstance.on('callRequest', (data) => {
          console.log('CallManager: Received callRequest event:', data);
          if (!isCallActive) {
            setIncomingCall({
              caller: data.caller,
              type: data.type,
              isIncoming: true
            });
          } else {
            // Send busy signal if already in a call
            socketInstance.emit('userBusy', {
              to: data.from,
              from: currentUser._id
            });
          }
        });

        socketInstance.on('callAccepted', (data) => {
          console.log('CallManager: Received callAccepted event:', data);
          startCall('video'); // or get the actual call type from data
        });

        socketInstance.on('callRejected', (data) => {
          console.log('CallManager: Received callRejected event:', data);
          setIncomingCall(null);
        });

        socketInstance.on('callEnded', (data) => {
          console.log('CallManager: Received callEnded event:', data);
          setIncomingCall(null);
          endCall();
        });

        console.log('CallManager: Global call event listeners set up successfully');

        return () => {
          console.log('CallManager: Cleaning up global call event listeners');
          socketInstance.off('callRequest');
          socketInstance.off('callAccepted');
          socketInstance.off('callRejected');
          socketInstance.off('callEnded');
        };
      } catch (err) {
        console.error('CallManager: Failed to initialize:', err);
      }
    };

    if (currentUser) {
      initializeCallManager();
    }
  }, [currentUser]);

  const handleIncomingCallClose = () => {
    setIncomingCall(null);
    endCall();
  };

  if (!incomingCall) {
    return null;
  }

  return (
    <VideoCall
      currentUser={currentUser}
      otherUser={incomingCall.caller}
      callType={incomingCall.type}
      onClose={handleIncomingCallClose}
      isIncomingCallProp={true}
    />
  );
};

export default CallManager; 