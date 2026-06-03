# AI Creative Battle Room

A real-time, stateful platform where users compete in an AI-powered creative challenge. Built as a vertical slice focused on clean data modeling, backend-enforced permissions, async job execution, and live updates via persistent WebSocket connections.

## 🚀 Live Demo
- **Frontend (Vercel)**: https://poiro-battle-room-six.vercel.app/
- **Backend (Render)**: https://ai-battle-room-backend-project.onrender.com/ (API Base)
- **Demo Video**: https://drive.google.com/file/d/1xJK0V5yemgoDcxWibNo8_Ob_fgVLdf5H/view?usp=sharing

## 🛠 Tech Stack
*   **Frontend**: React (Vite), TypeScript, Tailwind CSS (v4), Zustand
*   **Backend**: Python, FastAPI, SQLModel (SQLite), WebSockets
*   **AI Engine**: Google Gemini API via Async Python SDK

## 💻 Local Setup Instructions

### Backend
1. Navigate to the `backend` folder.
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   .\venv\Scripts\activate  # Windows
   # source venv/bin/activate # macOS/Linux
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Set your Gemini API Key in your `.env` file (or export it):
   ```bash
   GEMINI_API_KEY=your_api_key_here
   ```
5. Run the FastAPI server:
   ```bash
   uvicorn main:app --reload
   ```

### Frontend
1. Navigate to the `frontend` folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```
4. Access the app at `http://localhost:5173`. 
*(Note: If testing locally, update `API_BASE` in `frontend/src/App.tsx` to `http://localhost:8000`)*

## 🏗 Architecture Overview
The application follows a client-server architecture. The frontend is a React Single Page Application (SPA) that communicates with the backend via REST APIs for synchronous actions (auth, room creation, submissions) and WebSockets for real-time state updates. The backend uses FastAPI for high performance and async capabilities, with SQLModel acting as the ORM to a SQLite database. State management on the frontend is handled cleanly by Zustand, which listens to WebSocket events and patches the UI state instantaneously.

## 🗄 Database Schema (Entity Model)
*   **User**: Represents a persistent identity (`id`, `username`, `session_token`).
*   **Room**: The battle arena (`id`, `room_code`, `host_id`, `status`, `total_rounds`).
*   **RoomParticipant**: Junction table linking Users to Rooms (`room_id`, `user_id`).
*   **Round**: A specific battle round within a room (`id`, `room_id`, `round_number`, `theme_prompt`).
*   **Submission**: A participant's prompt and the AI's result (`id`, `round_id`, `participant_id`, `user_prompt`, `ai_output`, `job_status`, `error_message`).
*   **Score**: The host's evaluation of a submission (`id`, `submission_id`, `points_assigned`, `is_eliminated`).

## ⚡ Realtime Event Model
The backend pushes events to connected clients via WebSockets when state changes occur. The frontend listens to these events to update the UI without polling.
*   `USER_JOINED`: Broadcasts when a new participant enters the lobby.
*   `ROUND_STARTED`: Triggered by the host, providing the round `theme_prompt` and signaling participants to submit.
*   `SUBMISSION_ADDED`: Notifies the room that a participant submitted a prompt (status: `queued`).
*   `JOB_STATUS_CHANGED`: Pushed by the async worker as the AI generation moves between states (`running`, `completed`, `failed`).
*   `SCORE_UPDATED`: Broadcasts when the host adjusts the slider or eliminates a submission.
*   `ROOM_COMPLETED`: Signals the end of the game and displays final leaderboards.

## ⚙️ Generation Job Lifecycle
When a participant submits a prompt:
1. **Queued**: The backend creates a `Submission` record with `job_status="queued"` and immediately responds to the HTTP request. A FastAPI `BackgroundTask` is spawned.
2. **Running**: The async worker picks up the task, updates the DB to `running`, and broadcasts the status. It then calls the Gemini API.
3. **Completed**: If the API call succeeds, the AI output is saved, the status changes to `completed`, and the result is broadcasted to the room.
4. **Failed**: If the API call fails or times out, the error is caught, the status becomes `failed`, an `error_message` is recorded, and the room is notified.

## ⚖️ Judging/Scoring Mechanism
The host evaluates submissions manually in real time after the AI generation completes.

**Why this mechanism?**
I chose a 0-10 slider combined with an absolute "Eliminate" button. This gives the host granular control to reward exceptional prompts while quickly discarding off-topic ones. It feels interactive and gamified for the participants who see their scores update live.

**Weaknesses & Limitations:**
Currently, every point change on the slider triggers an HTTP request and subsequent broadcast. If scaling to many users or a very fast judging pace, this will overwhelm the server. A single host rating hundreds of entries is also unfeasible.

**Production Improvements:**
*   Implement frontend debouncing (e.g., wait 500ms after the host finishes sliding before sending the score).
*   Implement peer-to-peer voting where participants score each other's work, combined with an Elo rating system to remove the single-host bottleneck.

## 💾 Persistence: What is persisted and what is not
**Persisted (SQLite Database):**
*   Identities (session tokens allow users to refresh and stay logged in).
*   Room and Round states (active, completed).
*   Submissions and their AI-generated outputs.
*   Scores and elimination statuses.
*   Room participants (who joined which room).

**Not Persisted:**
*   Active WebSocket connections (held in-memory by the `ConnectionManager`).
*   Draft UI states (e.g., text typed in the prompt box before hitting submit).

## 🛡️ Failure Handling Strategy
*   **Job Failures**: If the Gemini API fails, the backend catches the exception and marks the job as `failed` with an error message. The UI gracefully displays the error state on the submission card instead of breaking the room.
*   **Disconnects & Desyncs**: If a user refreshes or disconnects, their `session_token` allows them to rejoin the room seamlessly. The `useEffect` hook re-fetches the entire room state on mount. Additionally, to combat WebSocket race conditions (e.g., missing a `USER_JOINED` broadcast while connecting), the frontend explicitly fetches the guaranteed final state from the database as soon as the `ROOM_COMPLETED` signal is received. This ensures final leaderboards are always perfectly synchronized across all clients.
*   **Invalid Actions**: Role-based permissions are enforced on the backend (e.g., only the host can start a round or score). Invalid requests return 403 Forbidden.

## 🚧 Known Limitations
*   **In-Memory Pub/Sub**: The WebSocket manager relies on Python dictionaries in a single process. It won't scale across multiple ASGI workers horizontally.
*   **No Reconnect Backoff**: If the WebSocket drops, the frontend currently relies on the initial mount fetch rather than a sophisticated exponential backoff reconnect strategy.
*   **Basic Auth**: The authentication is a simple mock implementation (username -> UUID session token). It is not secure for production.

## 🚀 What I would improve with more time
*   **Horizontal Scaling**: Integrate Redis Pub/Sub so that a score emitted on Worker A broadcasts to WebSockets held on Worker B.
*   **Robust Task Queue**: Move from FastAPI `BackgroundTasks` to Celery or RQ for better job persistence, retries, and rate-limiting against the AI provider.
*   **Enhanced UX**: Add micro-animations for score changes, a countdown timer for prompt submissions, and spectator mode with live emoji reactions.
*   **Automated Testing**: Write `pytest` suites for the critical backend role-enforcement logic and job state transitions.
