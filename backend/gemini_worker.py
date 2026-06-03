import os
import asyncio
from google import genai
from sqlmodel import Session, select
from database import engine
from models import Submission
from socket_manager import manager

async def process_submission(submission_id: int, room_code: str, theme_prompt: str, user_prompt: str):
    # Transition to running
    with Session(engine) as session:
        submission = session.get(Submission, submission_id)
        if not submission:
            return
        submission.job_status = "running"
        session.add(submission)
        session.commit()
        session.refresh(submission)
    
    # Broadcast running status
    await manager.broadcast(room_code, {
        "type": "JOB_STATUS_CHANGED",
        "submission_id": submission_id,
        "status": "running"
    })

    try:
        client = genai.Client()
        # Create a combined prompt
        full_prompt = f"Theme/Objective: {theme_prompt}\nParticipant's Prompt: {user_prompt}\nGenerate the creative output for this challenge. Be concise and highly creative."
        
        response = await client.aio.models.generate_content(
            model='gemini-2.5-flash',
            contents=full_prompt,
        )
        ai_output = response.text

        # Update submission to completed
        with Session(engine) as session:
            submission = session.get(Submission, submission_id)
            submission.job_status = "completed"
            submission.ai_output = ai_output
            session.add(submission)
            session.commit()
            session.refresh(submission)

        # Broadcast completed status with output
        await manager.broadcast(room_code, {
            "type": "JOB_STATUS_CHANGED",
            "submission_id": submission_id,
            "status": "completed",
            "ai_output": ai_output
        })

    except Exception as e:
        # Update submission to failed
        with Session(engine) as session:
            submission = session.get(Submission, submission_id)
            submission.job_status = "failed"
            submission.error_message = str(e)
            session.add(submission)
            session.commit()
            session.refresh(submission)

        # Broadcast failed status
        await manager.broadcast(room_code, {
            "type": "JOB_STATUS_CHANGED",
            "submission_id": submission_id,
            "status": "failed",
            "error_message": str(e)
        })
