import { useEffect, useState, useMemo } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import { wsService } from './services/websocket';
import { Copy, Check, Users } from 'lucide-react';

const API_BASE = 'http://localhost:8000';

function Login() {
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [totalRounds, setTotalRounds] = useState(3);
  const navigate = useNavigate();
  const setUser = useAppStore(state => state.setUser);
  const setRoom = useAppStore(state => state.setRoom);

  const handleLoginAndCreate = async () => {
    if (!username) return;
    const authRes = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const userData = await authRes.json();
    setUser(userData);

    const roomRes = await fetch(`${API_BASE}/rooms`, {
      method: 'POST',
      headers: { 
        'session-token': userData.session_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ total_rounds: totalRounds })
    });
    const roomData = await roomRes.json();
    setRoom(roomData);
    navigate(`/room/${roomData.room_code}`);
  };

  const handleLoginAndJoin = async () => {
    if (!username || !roomCode) return;
    const authRes = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const userData = await authRes.json();
    setUser(userData);

    await fetch(`${API_BASE}/rooms/${roomCode}/join`, {
      method: 'POST',
      headers: { 'session-token': userData.session_token }
    });
    navigate(`/room/${roomCode}`);
  };

  return (
    <div className="layout-container">
      <div className="login-card">
        <h1 className="app-title">AI Battle Room</h1>
        
        <div className="action-section">
          <h3>Create a new Room</h3>
          <div className="input-group">
            <input 
              type="text" 
              placeholder="Enter Username" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <select value={totalRounds} onChange={(e) => setTotalRounds(Number(e.target.value))} title="Total Rounds">
              <option value={1}>1 Round</option>
              <option value={3}>3 Rounds</option>
              <option value={5}>5 Rounds</option>
              <option value={10}>10 Rounds</option>
            </select>
            <button onClick={handleLoginAndCreate}>
              Create Room (Host)
            </button>
          </div>
        </div>

        <div className="divider" />

        <div className="action-section">
          <h3>Join an Existing Room</h3>
          <div className="input-group">
            <input 
              type="text" 
              placeholder="Room Code" 
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
            />
            <button onClick={handleLoginAndJoin}>
              Join Room
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Room() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, room, currentRound, allRounds, submissions, scores, participants, setRoom, setCurrentRound, setAllRounds, setSubmissions, setScores, setParticipants } = useAppStore();
  const [themePrompt, setThemePrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [draftScores, setDraftScores] = useState<Record<number, number>>({});

  useEffect(() => {
    if (!user || !code) {
      navigate('/');
      return;
    }

    const fetchState = async () => {
      const res = await fetch(`${API_BASE}/rooms/${code}`, {
        headers: { 'session-token': user.session_token }
      });
      if (res.ok) {
        const data = await res.json();
        setRoom(data.room);
        setCurrentRound(data.current_round);
        setAllRounds(data.all_rounds || []);
        setSubmissions(data.submissions || []);
        setScores(data.scores || []);
        if (data.participants) {
          setParticipants(data.participants);
        }
        wsService.connect(code);
      } else {
        navigate('/');
      }
    };

    fetchState();
    return () => wsService.disconnect();
  }, [code, user, navigate, setRoom, setCurrentRound, setSubmissions, setScores]);

  const isHost = user?.id === room?.host_id;

  const handleStartRound = async () => {
    if (!themePrompt) return;
    await fetch(`${API_BASE}/rooms/${code}/start`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'session-token': user!.session_token 
      },
      body: JSON.stringify({ theme_prompt: themePrompt })
    });
    setThemePrompt('');
  };

  const handleCompleteRoom = async () => {
    await fetch(`${API_BASE}/rooms/${code}/complete`, {
      method: 'POST',
      headers: { 
        'session-token': user!.session_token 
      }
    });
  };

  const handleCopyCode = () => {
    if (room?.room_code) {
      navigator.clipboard.writeText(room.room_code);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const handleSubmitPrompt = async () => {
    if (!userPrompt) return;
    await fetch(`${API_BASE}/rooms/${code}/submit`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'session-token': user!.session_token 
      },
      body: JSON.stringify({ user_prompt: userPrompt })
    });
    setUserPrompt('');
  };

  const handleScore = async (submissionId: number, points: number, eliminated: boolean) => {
    await fetch(`${API_BASE}/rooms/${code}/score`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'session-token': user!.session_token 
      },
      body: JSON.stringify({ 
        submission_id: submissionId,
        points_assigned: points,
        is_eliminated: eliminated
      })
    });
  };

  const handleDraftScoreChange = (subId: number, value: number) => {
    setDraftScores(prev => ({ ...prev, [subId]: value }));
  };

  const handleMarkAndNext = async (subId: number, index: number) => {
    const points = draftScores[subId] !== undefined ? draftScores[subId] : (scores.find(s => s.submission_id === subId)?.points_assigned || 5);
    await handleScore(subId, points, false);
    
    const nextSub = submissions[index + 1];
    if (nextSub) {
      document.getElementById(`submission-${nextSub.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const leaderboard = useMemo(() => {
    const allUsers = [...participants];
    if (user && user.id !== room?.host_id && !allUsers.find(p => p.id === user.id)) {
      allUsers.push(user);
    }
    return allUsers.filter(p => p.id !== room?.host_id).map(p => {
      const userSubs = submissions.filter(s => s.participant_id === p.id);
      let total = 0;
      userSubs.forEach(sub => {
        const score = scores.find(s => s.submission_id === sub.id);
        if (score && score.points_assigned && !score.is_eliminated) {
          total += score.points_assigned;
        }
      });
      return { ...p, totalScore: total };
    }).sort((a, b) => b.totalScore - a.totalScore);
  }, [participants, user, submissions, scores]);

  const liveSubmissions = submissions.filter(s => s.round_id === currentRound?.id);
  const pastRounds = allRounds.filter(r => currentRound && r.id !== currentRound.id);
  
  const hasSubmittedCurrentRound = useMemo(() => {
    return currentRound && submissions.some(s => s.round_id === currentRound.id && s.participant_id === user?.id);
  }, [currentRound, submissions, user]);

  const highestScore = leaderboard.length > 0 ? leaderboard[0].totalScore : 0;
  const isWinner = !isHost && leaderboard.find(p => p.id === user?.id)?.totalScore === highestScore;

  if (!room) return <div>Loading...</div>;

  return (
    <div className="game-wrapper">
      <div className="game-layout">
        
        {/* LEFT PANEL */}
        <div className="left-panel">
          <div className="room-info dashboard-card" style={{ marginBottom: 0 }}>
            <h2>Room: {room.room_code}</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '0.5rem' }}>
              <button className="copy-button" onClick={handleCopyCode} title="Copy Room ID" style={{ padding: '4px 8px', border: '1px solid #ccc' }}>
                {isCopied ? <Check size={14} /> : <Copy size={14} />} Copy Code
              </button>
              <span className="badge">{room.status}</span>
            </div>
            <div className="user-info" style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
              Logged in as: <strong>{user?.username}</strong> {isHost && <span className="badge">Host</span>}
            </div>
          </div>

          <div className="participants-card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={20} /> Participants ({leaderboard.length})
            </h3>
            <ul className="participant-list">
              {!isHost && (
                <li className="participant-item">
                  <strong>{user?.username} (You)</strong>
                </li>
              )}
              {leaderboard.filter(p => p.id !== user?.id).map(p => (
                <li key={p.id} className="participant-item">
                  {p.username}
                </li>
              ))}
            </ul>
          </div>

          <div className="participants-card">
            <h3>Leaderboard</h3>
            <ul className="participant-list">
              {isHost || room.status === 'completed' ? (
                leaderboard.map((p, idx) => (
                  <li key={p.id} className="participant-item" style={{ justifyContent: 'space-between' }}>
                    <span>{idx + 1}. {p.username} {p.id === user?.id && '(You)'}</span>
                    <strong>{p.totalScore} pts</strong>
                  </li>
                ))
              ) : (
                leaderboard.filter(p => p.id === user?.id).map(p => (
                  <li key={p.id} className="participant-item" style={{ justifyContent: 'space-between' }}>
                    <span>Your Total Score:</span>
                    <strong>{p.totalScore} pts</strong>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        {/* CENTER PANEL */}
        <main className="center-panel">
          <section className="top-section">
            {isHost && (
              <div className="dashboard-card">
                <h3>Host Dashboard</h3>
                {room.status === 'completed' ? (
                  <div style={{ color: 'green', fontWeight: 'bold' }}>Game Finished! Final Results Declared.</div>
                ) : (
                  <div className="input-group">
                    {room.status === 'active' && currentRound?.round_number === room.total_rounds ? (
                      <button onClick={handleCompleteRoom} style={{ backgroundColor: '#c62828', color: 'white', width: '100%' }}>
                        Finish Game
                      </button>
                    ) : (
                      <>
                        <input 
                          type="text" 
                          placeholder="Enter challenge theme" 
                          value={themePrompt}
                          onChange={(e) => setThemePrompt(e.target.value)}
                        />
                        <button onClick={handleStartRound}>
                          {room.status === 'lobby' ? 'Start Round' : 'Next Round'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {room.status === 'completed' && (
              <div className="challenge-card" style={{ textAlign: 'center', borderColor: 'green' }}>
                <h2 style={{ color: 'green' }}>Game Finished!</h2>
                {!isHost && (
                  isWinner ? (
                    <h3 style={{ color: '#2e7d32', margin: '15px 0' }}>🎉 Victory! You won the game! 🎉</h3>
                  ) : (
                    <h3 style={{ color: '#c62828', margin: '15px 0' }}>Better luck next time!</h3>
                  )
                )}
                <p style={{ marginTop: '10px' }}>Check the leaderboard for final results.</p>
              </div>
            )}

            {room.status === 'active' && currentRound && (
              <div className="challenge-card">
                <h3>Round {currentRound.round_number} / {room.total_rounds} Challenge</h3>
                <p className="challenge-prompt">{currentRound.theme_prompt}</p>
              </div>
            )}

            {!isHost && room.status === 'active' && (
              hasSubmittedCurrentRound ? (
                <div className="dashboard-card" style={{ textAlign: 'center' }}>
                  <h3>Submission Received</h3>
                  <p style={{ marginTop: '0.5rem', color: '#666' }}>Waiting for the host to review and start the next round...</p>
                </div>
              ) : (
                <div className="submission-section dashboard-card">
                  <h3>Your Submission</h3>
                  <div className="input-group-vertical">
                    <textarea 
                      rows={4}
                      placeholder="Type your prompt here..." 
                      value={userPrompt}
                      onChange={(e) => setUserPrompt(e.target.value)}
                    />
                    <button onClick={handleSubmitPrompt}>
                      Submit Prompt
                    </button>
                  </div>
                </div>
              )
            )}
          </section>

          {(room.status === 'active' || room.status === 'completed') && (
            <section className="submissions-section">
              <h3>Live Submissions</h3>
              <div className="submissions-grid">
                {liveSubmissions.map((sub, index) => {
                  const score = scores.find(s => s.submission_id === sub.id);
                  const currentDraft = draftScores[sub.id] !== undefined ? draftScores[sub.id] : (score?.points_assigned || 5);
                  
                  return (
                    <div key={sub.id} id={`submission-${sub.id}`} className="submission-card">
                      <header className="sub-header">
                        <span className="participant-id">Participant: {sub.participant_id}</span>
                        <span className={`status-badge status-${sub.job_status}`}>{sub.job_status}</span>
                      </header>
                      
                      <div className="sub-content">
                        <div className="prompt-section">
                          <strong>Prompt</strong>
                          <p>{sub.user_prompt}</p>
                        </div>

                        {sub.job_status === 'completed' && sub.ai_output && (
                          <div className="output-section">
                            <strong>AI Output</strong>
                            <pre className="ai-output">{sub.ai_output}</pre>
                          </div>
                        )}

                        {sub.job_status === 'failed' && (
                          <div className="error-section">
                            <strong>Error:</strong> {sub.error_message}
                          </div>
                        )}
                      </div>

                      <footer className="sub-footer">
                        {isHost && sub.job_status === 'completed' && room.status === 'active' && (
                          <div className="score-controls">
                            <div className="score-input-group" style={{ flex: 1 }}>
                              <label style={{ whiteSpace: 'nowrap' }}>Score (0-10): </label>
                              <input 
                                type="range" min="0" max="10" step="1"
                                value={currentDraft}
                                onChange={(e) => handleDraftScoreChange(sub.id, parseInt(e.target.value))}
                                style={{ flex: 1, margin: '0 8px', cursor: 'pointer' }}
                              />
                              <span style={{ fontWeight: 'bold', minWidth: '24px', textAlign: 'right' }}>{currentDraft}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button style={{ flex: 1 }} onClick={() => handleMarkAndNext(sub.id, index)}>
                                Mark & Next
                              </button>
                              <button style={{ flex: 1 }} onClick={() => handleScore(sub.id, 0, true)}>
                                {score?.is_eliminated ? 'Eliminated' : 'Eliminate'}
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {!isHost && score && sub.participant_id === user?.id && (
                          <div className="score-display">
                            {score.is_eliminated ? (
                              <strong className="status-failed">ELIMINATED</strong>
                            ) : (
                              <strong>Score: {score.points_assigned} / 10</strong>
                            )}
                          </div>
                        )}
                      </footer>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </main>

        {/* RIGHT PANEL */}
        <aside className="right-panel">
          <h3>Past Rounds</h3>
          {pastRounds.length === 0 && <p style={{ color: '#666', fontSize: '0.9rem' }}>No past rounds yet.</p>}
          
          {pastRounds.map(r => {
            const roundSubs = submissions.filter(s => s.round_id === r.id);
            const displaySubs = isHost ? roundSubs : roundSubs.filter(s => s.participant_id === user?.id);
            
            if (displaySubs.length === 0) return null;

            return (
              <div key={r.id} className="minimized-round">
                <h4>Round {r.round_number}</h4>
                {displaySubs.map(sub => {
                  const score = scores.find(s => s.submission_id === sub.id);
                  return (
                    <div key={sub.id} className="minimized-submission">
                      <strong>{isHost ? `Participant: ${sub.participant_id}` : 'Your Submission'}</strong>
                      <p>{sub.user_prompt}</p>
                      {sub.ai_output && (
                        <div className="minimized-output">
                          {sub.ai_output}
                        </div>
                      )}
                      {isHost && score && (
                        <div style={{ marginTop: '0.5rem', fontWeight: 'bold', color: score.is_eliminated ? '#c62828' : '#2e7d32' }}>
                          {score.is_eliminated ? 'Eliminated' : `Score: ${score.points_assigned}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </aside>

      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/room/:code" element={<Room />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
