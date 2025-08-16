import React, { useState, useEffect, useRef } from 'react';
import { getSocket } from '../utils/socket';

const GroupVideoCall = ({ currentUser, room, onClose, callType = 'video' }) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [isCallActive, setIsCallActive] = useState(false);
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [caller, setCaller] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [participants, setParticipants] = useState(new Set());
  const [isInitiator, setIsInitiator] = useState(false);

  const localVideoRef = useRef();
  const peerConnectionsRef = useRef(new Map());
  const socketRef = useRef();
  const pendingCandidatesRef = useRef(new Map());

  useEffect(() => {
    const initializeCall = async () => {
      try {
        const socket = await getSocket();
        socketRef.current = socket;

        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: callType === 'video',
          audio: true
        });
        setLocalStream(stream);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Socket event listeners
        socket.on('groupCallRequest', handleIncomingGroupCall);
        socket.on('groupCallAccepted', handleGroupCallAccepted);
        socket.on('groupCallRejected', handleGroupCallRejected);
        socket.on('groupCallEnded', handleGroupCallEnded);
        socket.on('groupCallSignal', handleGroupCallSignal);
        socket.on('userJoinedGroupCall', handleUserJoinedGroupCall);
        socket.on('userLeftGroupCall', handleUserLeftGroupCall);

        return () => {
          socket.off('groupCallRequest');
          socket.off('groupCallAccepted');
          socket.off('groupCallRejected');
          socket.off('groupCallEnded');
          socket.off('groupCallSignal');
          socket.off('userJoinedGroupCall');
          socket.off('userLeftGroupCall');
        };
      } catch (err) {
        setError('Failed to access camera/microphone. Please check permissions.');
        console.error('Media access error:', err);
      }
    };

    initializeCall();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      peerConnectionsRef.current.forEach(connection => connection.close());
    };
  }, [callType]);

  const createPeerConnection = (targetUserId) => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    const peerConnection = new RTCPeerConnection(configuration);
    
    // Add local stream tracks to peer connection
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    // Handle incoming streams
    peerConnection.ontrack = (event) => {
      console.log('Received remote stream from:', targetUserId);
      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        newMap.set(targetUserId, event.streams[0]);
        return newMap;
      });
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate to:', targetUserId);
        socketRef.current.emit('groupCallSignal', {
          signal: { type: 'candidate', candidate: event.candidate },
          to: targetUserId,
          roomId: room._id
        });
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state changed for', targetUserId, ':', peerConnection.connectionState);
      if (peerConnection.connectionState === 'connected') {
        setIsCallActive(true);
        setIsConnecting(false);
      } else if (peerConnection.connectionState === 'failed') {
        setError('Connection failed');
      } else if (peerConnection.connectionState === 'closed') {
        setIsCallActive(false);
        setIsConnecting(false);
      }
    };

    // Handle signaling state changes
    peerConnection.onsignalingstatechange = () => {
      console.log('Signaling state for', targetUserId, ':', peerConnection.signalingState);
    };

    peerConnectionsRef.current.set(targetUserId, peerConnection);
    return peerConnection;
  };

  const handleIncomingGroupCall = (data) => {
    console.log('Incoming group call from:', data.caller);
    setCaller(data.caller);
    setIsIncomingCall(true);
    setIsInitiator(false);
  };

  const handleGroupCallAccepted = async (data) => {
    console.log('Group call accepted by:', data.from);
    setIsConnecting(true);
    setIsInitiator(false);
    
    const peerConnection = createPeerConnection(data.from);
    
    try {
      console.log('Creating offer for group call');
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      socketRef.current.emit('groupCallSignal', {
        signal: { type: 'offer', sdp: offer.sdp },
        to: data.from,
        roomId: room._id
      });
    } catch (err) {
      console.error('Error creating offer:', err);
      setError('Failed to create call offer');
    }
  };

  const handleGroupCallRejected = () => {
    setError('Call was rejected');
    onClose();
  };

  const handleGroupCallEnded = () => {
    console.log('Group call ended');
    endCall();
  };

  const handleGroupCallSignal = async (data) => {
    const peerConnection = peerConnectionsRef.current.get(data.from);
    if (!peerConnection) {
      console.log('No peer connection available for:', data.from);
      return;
    }

    try {
      const { signal } = data;
      console.log('Received signal from', data.from, ':', signal.type);
      
      if (signal.type === 'offer') {
        console.log('Setting remote description (offer) for', data.from);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
        
        console.log('Creating answer for', data.from);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        console.log('Sending answer to', data.from);
        socketRef.current.emit('groupCallSignal', {
          signal: { type: 'answer', sdp: answer.sdp },
          to: data.from,
          roomId: room._id
        });
      } else if (signal.type === 'answer') {
        console.log('Setting remote description (answer) for', data.from);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
        
        // Add any pending candidates
        const pendingCandidates = pendingCandidatesRef.current.get(data.from) || [];
        while (pendingCandidates.length > 0) {
          const candidate = pendingCandidates.shift();
          try {
            await peerConnection.addIceCandidate(candidate);
          } catch (err) {
            console.error('Error adding pending candidate:', err);
          }
        }
        pendingCandidatesRef.current.set(data.from, pendingCandidates);
      } else if (signal.type === 'candidate') {
        console.log('Adding ICE candidate for', data.from);
        if (peerConnection.remoteDescription) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (err) {
            console.error('Error adding ICE candidate:', err);
          }
        } else {
          console.log('Storing candidate for later for', data.from);
          const pendingCandidates = pendingCandidatesRef.current.get(data.from) || [];
          pendingCandidates.push(new RTCIceCandidate(signal.candidate));
          pendingCandidatesRef.current.set(data.from, pendingCandidates);
        }
      }
    } catch (err) {
      console.error('Error handling signal:', err);
      setError('Connection error occurred');
    }
  };

  const handleUserJoinedGroupCall = (data) => {
    console.log('User joined group call:', data.userId);
    setParticipants(prev => new Set([...prev, data.userId]));
  };

  const handleUserLeftGroupCall = (data) => {
    console.log('User left group call:', data.userId);
    setParticipants(prev => {
      const newSet = new Set(prev);
      newSet.delete(data.userId);
      return newSet;
    });
    
    // Clean up peer connection
    const peerConnection = peerConnectionsRef.current.get(data.userId);
    if (peerConnection) {
      peerConnection.close();
      peerConnectionsRef.current.delete(data.userId);
      pendingCandidatesRef.current.delete(data.userId);
    }
  };

  const initiateGroupCall = async () => {
    try {
      console.log('Initiating group call in room:', room._id);
      setIsConnecting(true);
      setIsInitiator(true);
      socketRef.current.emit('groupCallRequest', {
        roomId: room._id,
        from: currentUser._id,
        type: callType
      });
    } catch (err) {
      setError('Failed to initiate group call');
      console.error('Group call initiation error:', err);
    }
  };

  const acceptGroupCall = () => {
    console.log('Accepting group call');
    setIsIncomingCall(false);
    setIsConnecting(true);
    setIsInitiator(false);
    createPeerConnection(caller._id);
    socketRef.current.emit('groupCallAccepted', {
      roomId: room._id,
      to: caller._id,
      from: currentUser._id
    });
  };

  const rejectGroupCall = () => {
    console.log('Rejecting group call');
    setIsIncomingCall(false);
    socketRef.current.emit('groupCallRejected', {
      roomId: room._id,
      to: caller._id,
      from: currentUser._id
    });
    onClose();
  };

  const endCall = () => {
    console.log('Ending group call');
    peerConnectionsRef.current.forEach(connection => connection.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    setIsCallActive(false);
    setIsConnecting(false);
    setRemoteStreams(new Map());
    setParticipants(new Set());
    
    socketRef.current.emit('groupCallEnded', {
      roomId: room._id,
      from: currentUser._id
    });
    
    onClose();
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  if (error) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 className="text-lg font-semibold mb-4">Call Error</h3>
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={onClose}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (isIncomingCall) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 text-center">
          <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold mb-2">Incoming Group {callType === 'video' ? 'Video' : 'Voice'} Call</h3>
          <p className="text-gray-600 mb-2">{caller?.username || 'Unknown'}</p>
          <p className="text-gray-500 mb-6">Room: {room?.name}</p>
          <div className="flex space-x-4">
            <button
              onClick={acceptGroupCall}
              className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
              </svg>
              Accept
            </button>
            <button
              onClick={rejectGroupCall}
              className="flex-1 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Decline
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-6xl w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold">
            {isCallActive ? `Group ${callType === 'video' ? 'Video' : 'Voice'} Call` : 'Group Call'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!isCallActive && !isConnecting && (
          <div className="text-center mb-6">
            <p className="text-gray-600 mb-4">
              Start group call in {room?.name}
            </p>
            <button
              onClick={initiateGroupCall}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 flex items-center mx-auto"
            >
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
              </svg>
              Start Group {callType === 'video' ? 'Video' : 'Voice'} Call
            </button>
          </div>
        )}

        {isConnecting && (
          <div className="text-center mb-6">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Connecting...</p>
          </div>
        )}

        {isCallActive && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {callType === 'video' && (
              <>
                <div className="relative">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-48 bg-gray-900 rounded-lg"
                  />
                  <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                    You
                  </div>
                </div>
                {Array.from(remoteStreams.entries()).map(([userId, stream]) => (
                  <div key={userId} className="relative">
                    <video
                      autoPlay
                      playsInline
                      className="w-full h-48 bg-gray-900 rounded-lg"
                      ref={(el) => {
                        if (el) el.srcObject = stream;
                      }}
                    />
                    <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                      User {userId.slice(-4)}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {isCallActive && (
          <div className="flex justify-center space-x-4">
            <button
              onClick={toggleMute}
              className={`p-3 rounded-full ${
                isMuted ? 'bg-red-600 text-white' : 'bg-gray-300 text-gray-700'
              } hover:opacity-80`}
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                {isMuted ? (
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                ) : (
                  <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217z" />
                )}
              </svg>
            </button>
            
            {callType === 'video' && (
              <button
                onClick={toggleVideo}
                className={`p-3 rounded-full ${
                  isVideoOff ? 'bg-red-600 text-white' : 'bg-gray-300 text-gray-700'
                } hover:opacity-80`}
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  {isVideoOff ? (
                    <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                  ) : (
                    <path d="M2 6a2 2 0 012-2h6l2 2h6a2 2 0 012 2v2M2 6v10a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2H4a2 2 0 00-2-2z" />
                  )}
                </svg>
              </button>
            )}
            
            <button
              onClick={endCall}
              className="p-3 rounded-full bg-red-600 text-white hover:bg-red-700"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GroupVideoCall; 