import { useAppStore } from '../store/useAppStore'

class WebSocketService {
  private socket: WebSocket | null = null;
  private roomCode: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(roomCode: string) {
    if (this.socket && this.roomCode === roomCode) return;
    
    this.roomCode = roomCode;
    const wsUrl = `wss://ai-battle-room-backend-project.onrender.com/ws/rooms/${roomCode}`;
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log('Connected to WebSocket for room:', roomCode);
      this.reconnectAttempts = 0;
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleEvent(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.socket.onclose = () => {
      console.log('WebSocket connection closed.');
      this.attemptReconnect();
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.roomCode) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
      console.log(`Attempting reconnect in ${delay}ms...`);
      setTimeout(() => {
        if (this.roomCode) this.connect(this.roomCode);
      }, delay);
    }
  }

  disconnect() {
    this.roomCode = null;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private handleEvent(data: any) {
    const store = useAppStore.getState();
    
    switch (data.type) {
      case 'USER_JOINED':
        store.addParticipant({ id: data.user_id, username: data.username, session_token: '' });
        break;
      case 'ROUND_STARTED': {
        const newRound = {
          id: data.round_id,
          theme_prompt: data.theme_prompt,
          round_number: data.round_number
        };
        store.setCurrentRound(newRound);
        store.setAllRounds([...store.allRounds, newRound]);
        if (store.room) {
          store.setRoom({ ...store.room, status: 'active' });
        }
        break;
      }
      case 'SUBMISSION_ADDED':
        store.addSubmission({
          id: data.submission_id,
          round_id: store.currentRound?.id || 0,
          participant_id: data.participant_id,
          user_prompt: data.user_prompt,
          job_status: data.job_status
        });
        break;
      case 'JOB_STATUS_CHANGED':
        store.updateSubmissionStatus(
          data.submission_id,
          data.status,
          data.ai_output,
          data.error_message
        );
        break;
      case 'SCORE_UPDATED':
        store.updateScore({
          submission_id: data.submission_id,
          points_assigned: data.points_assigned,
          is_eliminated: data.is_eliminated
        });
        break;
      case 'ROOM_COMPLETED':
        if (store.room) {
          store.setRoom({ ...store.room, status: 'completed' });
          const API_BASE = 'https://ai-battle-room-backend-project.onrender.com';
          if (store.user && store.room.room_code) {
             fetch(`${API_BASE}/rooms/${store.room.room_code}`, {
               headers: { 'session-token': store.user.session_token }
             }).then(res => res.ok ? res.json() : null).then(data => {
               if (data) {
                 store.setSubmissions(data.submissions || []);
                 store.setScores(data.scores || []);
                 if (data.participants) {
                   store.setParticipants(data.participants);
                 }
               }
             }).catch(console.error);
          }
        }
        break;
      default:
        console.warn('Unknown WebSocket event type:', data.type);
    }
  }
}

export const wsService = new WebSocketService();
