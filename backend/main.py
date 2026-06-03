from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select
from typing import Optional, List
from contextlib import asynccontextmanager
import uuid
import json
import os
from dotenv import load_dotenv

load_dotenv()

from database import create_db_and_tables, get_session, engine
from models import User, Room, Round, Submission, Score, RoomParticipant
from socket_manager import manager
from gemini_worker import process_submission

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    yield

app = FastAPI(lifespan=lifespan)

# Allow CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic schemas for requests
from pydantic import BaseModel

class AuthRequest(BaseModel):
    username: str

class CreateRoomRequest(BaseModel):
    total_rounds: int = 3

class JoinRequest(BaseModel):
    username: str

class StartRoundRequest(BaseModel):
    theme_prompt: str

class SubmitPromptRequest(BaseModel):
    user_prompt: str

class ScoreRequest(BaseModel):
    submission_id: int
    points_assigned: Optional[int] = None
    is_eliminated: bool = False

def get_current_user(session_token: str = Header(None), session: Session = Depends(get_session)):
    if not session_token:
        raise HTTPException(status_code=401, detail="Missing session token")
    user = session.exec(select(User).where(User.session_token == session_token)).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session token")
    return user

@app.post("/auth")
def authenticate(req: AuthRequest, session: Session = Depends(get_session)):
    # Very simple auth: just create a user with a unique session token
    user = User(username=req.username, session_token=str(uuid.uuid4()))
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"id": user.id, "username": user.username, "session_token": user.session_token}

@app.post("/rooms")
def create_room(req: CreateRoomRequest, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    room_code = str(uuid.uuid4())[:6].upper()
    room = Room(room_code=room_code, host_id=user.id, status="lobby", total_rounds=req.total_rounds)
    session.add(room)
    session.commit()
    session.refresh(room)
    return {"room_code": room.room_code, "host_id": room.host_id, "status": room.status, "total_rounds": room.total_rounds}

@app.post("/rooms/{room_code}/join")
async def join_room(room_code: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    room = session.exec(select(Room).where(Room.room_code == room_code)).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
        
    if room.status != "lobby":
        raise HTTPException(status_code=400, detail="Cannot join room that is already in progress or completed")
    
    # Check if user is already a participant
    participant = session.exec(select(RoomParticipant).where(RoomParticipant.room_id == room.id, RoomParticipant.user_id == user.id)).first()
    if not participant and room.host_id != user.id:
        participant = RoomParticipant(room_id=room.id, user_id=user.id)
        session.add(participant)
        session.commit()

    # Broadcast that someone joined the lobby.
    await manager.broadcast(room_code, {
        "type": "USER_JOINED",
        "user_id": user.id,
        "username": user.username
    })
    
    return {"message": "Joined room", "room_code": room_code}

@app.get("/rooms/{room_code}")
def get_room_state(room_code: str, session: Session = Depends(get_session)):
    room = session.exec(select(Room).where(Room.room_code == room_code)).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    rounds = session.exec(select(Round).where(Round.room_id == room.id)).all()
    current_round = rounds[-1] if rounds else None
    
    submissions = []
    scores = []
    if rounds:
        round_ids = [r.id for r in rounds]
        submissions = session.exec(select(Submission).where(Submission.round_id.in_(round_ids))).all()
        sub_ids = [s.id for s in submissions]
        if sub_ids:
            scores = session.exec(select(Score).where(Score.submission_id.in_(sub_ids))).all()

    participants = []
    room_participants = session.exec(select(RoomParticipant).where(RoomParticipant.room_id == room.id)).all()
    if room_participants:
        user_ids = [rp.user_id for rp in room_participants]
        participants = session.exec(select(User).where(User.id.in_(user_ids))).all()

    return {
        "room": room,
        "current_round": current_round,
        "all_rounds": rounds,
        "submissions": submissions,
        "scores": scores,
        "participants": participants
    }

@app.post("/rooms/{room_code}/start")
async def start_round(room_code: str, req: StartRoundRequest, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    room = session.exec(select(Room).where(Room.room_code == room_code)).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    if room.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only the host can start the round")
        
    existing_rounds = session.exec(select(Round).where(Round.room_id == room.id)).all()
    if len(existing_rounds) >= room.total_rounds:
        raise HTTPException(status_code=400, detail="Maximum rounds already reached")
    
    room.status = "active"
    session.add(room)
    
    # Create new round
    round_number = 1
    existing_rounds = session.exec(select(Round).where(Round.room_id == room.id)).all()
    if existing_rounds:
        round_number = len(existing_rounds) + 1
        
    new_round = Round(room_id=room.id, theme_prompt=req.theme_prompt, round_number=round_number)
    session.add(new_round)
    session.commit()
    session.refresh(new_round)
    
    await manager.broadcast(room_code, {
        "type": "ROUND_STARTED",
        "round_id": new_round.id,
        "theme_prompt": new_round.theme_prompt,
        "round_number": new_round.round_number
    })
    
    return {"message": "Round started", "round_id": new_round.id}

@app.post("/rooms/{room_code}/complete")
async def complete_room(room_code: str, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    room = session.exec(select(Room).where(Room.room_code == room_code)).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    if room.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only the host can complete the room")
    
    room.status = "completed"
    session.add(room)
    session.commit()
    
    await manager.broadcast(room_code, {
        "type": "ROOM_COMPLETED"
    })
    
    return {"message": "Room completed"}

@app.post("/rooms/{room_code}/submit")
async def submit_prompt(room_code: str, req: SubmitPromptRequest, background_tasks: BackgroundTasks, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    room = session.exec(select(Room).where(Room.room_code == room_code)).first()
    if not room or room.status != "active":
        raise HTTPException(status_code=400, detail="Room not active")
        
    rounds = session.exec(select(Round).where(Round.room_id == room.id)).all()
    if not rounds:
        raise HTTPException(status_code=400, detail="No active round")
    current_round = rounds[-1]
    
    existing_submission = session.exec(select(Submission).where(Submission.round_id == current_round.id, Submission.participant_id == user.id)).first()
    if existing_submission:
        raise HTTPException(status_code=400, detail="You have already submitted a prompt for this round")
    
    submission = Submission(
        round_id=current_round.id,
        participant_id=user.id,
        user_prompt=req.user_prompt,
        job_status="queued"
    )
    session.add(submission)
    session.commit()
    session.refresh(submission)
    
    await manager.broadcast(room_code, {
        "type": "SUBMISSION_ADDED",
        "submission_id": submission.id,
        "participant_id": user.id,
        "user_prompt": submission.user_prompt,
        "job_status": submission.job_status
    })
    
    # Enqueue async task
    background_tasks.add_task(
        process_submission, 
        submission.id, 
        room_code, 
        current_round.theme_prompt, 
        submission.user_prompt
    )
    
    return {"message": "Submission queued", "submission_id": submission.id}

@app.post("/rooms/{room_code}/score")
async def score_submission(room_code: str, req: ScoreRequest, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    room = session.exec(select(Room).where(Room.room_code == room_code)).first()
    if not room or room.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only host can score")
        
    if room.status == "completed":
        raise HTTPException(status_code=400, detail="Cannot change scores after the game has finished")
        
    if req.points_assigned is not None and (req.points_assigned < 0 or req.points_assigned > 10):
        raise HTTPException(status_code=400, detail="Score must be between 0 and 10")
        
    score = session.exec(select(Score).where(Score.submission_id == req.submission_id)).first()
    if not score:
        score = Score(submission_id=req.submission_id, points_assigned=req.points_assigned, is_eliminated=req.is_eliminated)
        session.add(score)
    else:
        score.points_assigned = req.points_assigned
        score.is_eliminated = req.is_eliminated
        
    session.commit()
    session.refresh(score)
    
    await manager.broadcast(room_code, {
        "type": "SCORE_UPDATED",
        "submission_id": score.submission_id,
        "points_assigned": score.points_assigned,
        "is_eliminated": score.is_eliminated
    })
    
    return {"message": "Score updated"}

@app.websocket("/ws/rooms/{room_code}")
async def websocket_endpoint(websocket: WebSocket, room_code: str):
    await manager.connect(websocket, room_code)
    try:
        while True:
            # We don't really expect much incoming data from WS right now,
            # but we need to keep connection open and listen for disconnects
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_code)
