# AI Creative Battle Room

A real-time, stateful platform where users compete in an AI-powered creative challenge. Built as a vertical slice focused on clean data modeling, backend-enforced permissions, async job execution, and live updates via persistent WebSocket connections.

## Tech Stack
*   **Frontend**: React (Vite), TypeScript, Tailwind CSS (v4), Zustand
*   **Backend**: Python, FastAPI, SQLModel (SQLite), WebSockets
*   **AI Engine**: Google Gemini API via Async Python SDK

## Setup & Running Locally

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
   *(Note: if `requirements.txt` is missing, run `pip install "fastapi[all]" sqlmodel google-genai websockets uvicorn`)*
4. Set your Gemini API Key in your environment:
   ```bash
   set GEMINI_API_KEY=your_api_key_here
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

## Architecture & Data Flow
*   **Identity Initialization**: A user is assigned a unique `session_token` upon entering an arbitrary username. This token acts as a persistent identifier.
*   **State Tracking**: State is tracked in a local SQLite database using SQLModel. The `Room`, `Round`, `Submission`, and `Score` entities manage the relations.
*   **Asynchronous AI Processing**: When a participant submits a prompt, the backend inserts a `queued` job into the database and spawns a FastAPI `BackgroundTask`. This task asynchronously calls the Gemini API so the main thread is not blocked. As it progresses, it broadcasts `JOB_STATUS_CHANGED` via WebSockets.
*   **Real-time Lifecycle**: A custom WebSocket manager handles room-based broadcasting. The frontend React app leverages a Zustand store directly hooked up to incoming socket messages, seamlessly driving UI state transitions (`Queued` -> `Running` -> `Completed`).

## Judging & Scoring Mechanism Design
The host evaluates submissions manually in real time after the AI generation completes.

**Logic Pattern:**
1. Only the user with `host_id == current_user.id` is allowed to call the `/score` endpoint (enforced server-side).
2. The host UI reveals a slider (1-10) and an "Eliminate" button for completed submissions.
3. Every score adjustment triggers an API call that saves to the SQLite `Score` table and broadcasts a `SCORE_UPDATED` WebSocket event.
4. Participants see their scores update live or their card dim if eliminated.

**Limitations & Scaling Improvements:**
*   **Limitation (High Latency/Overhead)**: Currently, every single point change on the slider can trigger an HTTP request and subsequent broadcast. If scaling to many users or a very fast judging pace, this will overwhelm the server.
    *   *Improvement*: Implement debouncing on the frontend (e.g., wait 500ms after the host finishes sliding before sending the score).
*   **Limitation (In-Memory Pub/Sub)**: The `ConnectionManager` relies on Python dictionaries holding active WebSocket references in a single process.
    *   *Improvement*: For horizontal scaling across multiple ASGI workers, integrate a message broker like Redis Pub/Sub so that a score emitted on Worker A broadcasts to WebSockets held on Worker B.
*   **Limitation (Single Host Bottleneck)**: A single host rating thousands of entries is unfeasible.
    *   *Improvement*: Implement peer-to-peer voting where participants score each other's work, combined with an Elo rating system.
