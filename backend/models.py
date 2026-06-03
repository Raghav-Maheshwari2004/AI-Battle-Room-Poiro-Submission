from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship
from datetime import datetime

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True)
    session_token: str = Field(unique=True, index=True)

class Room(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    room_code: str = Field(unique=True, index=True)
    host_id: int = Field(foreign_key="user.id")
    status: str = Field(default="lobby") # lobby, active, completed
    total_rounds: int = Field(default=3)

class RoomParticipant(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    room_id: int = Field(foreign_key="room.id")
    user_id: int = Field(foreign_key="user.id")

class Round(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    room_id: int = Field(foreign_key="room.id")
    theme_prompt: str
    round_number: int = Field(default=1)

class Submission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    round_id: int = Field(foreign_key="round.id")
    participant_id: int = Field(foreign_key="user.id")
    user_prompt: str
    ai_output: Optional[str] = None
    job_status: str = Field(default="queued") # queued, running, completed, failed
    error_message: Optional[str] = None

class Score(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    submission_id: int = Field(foreign_key="submission.id")
    points_assigned: Optional[int] = None
    is_eliminated: bool = Field(default=False)
