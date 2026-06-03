import { create } from 'zustand'

export interface User {
  id: number;
  username: string;
  session_token: string;
}

export interface Room {
  room_code: string;
  host_id: number;
  status: string; // lobby, active, completed
  total_rounds: number;
}

export interface Round {
  id: number;
  theme_prompt: string;
  round_number: number;
}

export interface Submission {
  id: number;
  round_id: number;
  participant_id: number;
  user_prompt: string;
  ai_output?: string;
  job_status: string; // queued, running, completed, failed
  error_message?: string;
}

export interface Score {
  submission_id: number;
  points_assigned?: number;
  is_eliminated: boolean;
}

interface AppState {
  user: User | null;
  room: Room | null;
  currentRound: Round | null;
  allRounds: Round[];
  submissions: Submission[];
  scores: Score[];
  participants: User[]; // Simplification: we might just store users we know about
  
  // Actions
  setUser: (user: User) => void;
  setRoom: (room: Room) => void;
  setCurrentRound: (round: Round) => void;
  setAllRounds: (rounds: Round[]) => void;
  setSubmissions: (submissions: Submission[]) => void;
  setScores: (scores: Score[]) => void;
  
  // Real-time Updates
  addSubmission: (submission: Submission) => void;
  updateSubmissionStatus: (id: number, status: string, aiOutput?: string, errorMessage?: string) => void;
  updateScore: (score: Score) => void;
  addParticipant: (participant: User) => void;
  setParticipants: (participants: User[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  room: null,
  currentRound: null,
  allRounds: [],
  submissions: [],
  scores: [],
  participants: [],

  setUser: (user) => set({ user }),
  setRoom: (room) => set({ room }),
  setCurrentRound: (round) => set({ currentRound: round }),
  setAllRounds: (rounds) => set({ allRounds: rounds }),
  setSubmissions: (submissions) => set({ submissions }),
  setScores: (scores) => set({ scores }),

  addSubmission: (submission) => 
    set((state) => ({ submissions: [...state.submissions, submission] })),
    
  updateSubmissionStatus: (id, status, aiOutput, errorMessage) =>
    set((state) => ({
      submissions: state.submissions.map((sub) =>
        sub.id === id
          ? { ...sub, job_status: status, ai_output: aiOutput, error_message: errorMessage }
          : sub
      ),
    })),
    
  updateScore: (score) =>
    set((state) => {
      const existing = state.scores.find(s => s.submission_id === score.submission_id);
      if (existing) {
        return {
          scores: state.scores.map(s => s.submission_id === score.submission_id ? score : s)
        };
      }
      return { scores: [...state.scores, score] };
    }),

  addParticipant: (participant) =>
    set((state) => {
      if (state.participants.find(p => p.id === participant.id)) return state;
      return { participants: [...state.participants, participant] };
    }),

  setParticipants: (participants) => set({ participants })
}))
