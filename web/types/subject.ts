export type Subject = "liberal_arts" | "science" | "engineering";

export type TeacherPageMode = "explain-first" | "solve-first";

export interface SubjectKnowledgeBase {
  name: string;
  subject: Subject;
  is_default: boolean;
  statistics?: Record<string, unknown>;
}

export interface TeacherResponse {
  success: boolean;
  session_id: string;
  subject: Subject;
  kb_name: string;
  response: string;
  teaching_mode: "teach" | "solve";
  topic: string;
  step_plan: string[];
  socratic_questions: string[];
  current_step: number;
  awaiting_student_response: boolean;
  session_state: {
    topic: string;
    preferred_mode: TeacherPageMode;
    subject: Subject;
  };
  teacher_state: TeacherSessionState;
}

export interface TeacherSessionState {
  teaching_mode: "teach" | "solve";
  step_plan: string[];
  current_step: number;
  active_step_index: number;
  awaiting_student_response: boolean;
  pending_prompt: string;
  socratic_questions: string[];
  student_responses: string[];
  turn_kind: string;
  mastery_signals: Record<string, unknown>;
  topic: string;
  solve_explanation?: string;
}

export interface TeacherSessionSummary {
  session_id: string;
  title: string;
  subject: Subject;
  kb_name: string;
  preferred_mode: TeacherPageMode;
  message_count: number;
  last_message: string;
  created_at: number;
  updated_at: number;
}

export interface TeacherSessionMessage {
  role: "user" | "assistant";
  content: string;
  created_at: number;
  metadata?: Record<string, unknown>;
}

export interface TeacherSessionDetail extends TeacherSessionSummary {
  topic: string;
  teacher_state: TeacherSessionState;
  settings: Record<string, unknown>;
  messages: TeacherSessionMessage[];
}

export const DEFAULT_SUBJECT: Subject = "science";

export const SUBJECT_OPTIONS: Array<{
  value: Subject;
  labelKey: string;
}> = [
  { value: "liberal_arts", labelKey: "Liberal Arts" },
  { value: "science", labelKey: "Science" },
  { value: "engineering", labelKey: "Engineering" },
];
