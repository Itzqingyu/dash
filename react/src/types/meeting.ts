/**
 * 活動籌備與執行階段細項型別定義 (meeting.ts)
 * 包含會議、待辦事項、決策、日程規劃與突發事件
 */

export type TaskPriority = '高' | '中' | '低';
export type TaskStatus = 'pending' | 'completed';
export type ConfirmationStatus = 'pending' | 'confirmed';

export interface Meeting {
  id: number;
  activity_id: number;
  source_document_id: number | null;
  name: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  participants: string;
  content: string;
  created_at: string;
}

export interface MeetingInput {
  activity_id: number;
  name: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  participants: string;
  content: string;
}

export type MeetingUpdate = Partial<Omit<MeetingInput, 'activity_id'>> & {
  activity_id?: number;
};

export interface Task {
  id: number;
  activity_id: number;
  meeting_id: number | null;
  content: string;
  assignee: string;
  due_date: string;
  priority: TaskPriority;
  status: TaskStatus;
  created_at: string;
}

export interface TaskInput {
  activity_id: number;
  meeting_id: number | null;
  content: string;
  assignee: string;
  due_date: string;
  priority: TaskPriority;
  status: TaskStatus;
}

export type TaskUpdate = Partial<Omit<TaskInput, 'activity_id'>> & {
  activity_id?: number;
};

export interface Decision {
  id: number;
  activity_id: number;
  meeting_id: number | null;
  problem: string;
  options: string;
  final_decision: string;
  reason: string;
  source: string;
  confirmation_status: ConfirmationStatus;
  created_at: string;
  updated_at: string;
  state: string;
  outcome_note?: string | null;
}

export interface DecisionInput {
  activity_id: number;
  meeting_id: number | null;
  problem: string;
  options: string;
  final_decision: string;
  reason: string;
  source: string;
  confirmation_status: ConfirmationStatus;
  outcome_note?: string | null;
}

export type DecisionUpdate = Partial<Omit<DecisionInput, 'activity_id'>> & {
  activity_id?: number;
};

export interface Schedule {
  id: number;
  activity_id: number;
  meeting_id: number | null;
  name: string;
  start_time: string;
  end_time: string | null;
  location: string;
  owner: string;
  notes: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduleInput {
  activity_id: number;
  meeting_id: number | null;
  name: string;
  start_time: string;
  end_time: string | null;
  location: string;
  owner: string;
  notes: string;
  outcome_note?: string | null;
  category: string;
}

export type ScheduleUpdate = Partial<Omit<ScheduleInput, 'activity_id'>> & {
  activity_id?: number;
};

export interface Incident {
  id: number;
  activity_id: number;
  schedule_id: number | null;
  content: string;
  occurred_at: string;
  cause: string | null;
  suggestion: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentInput {
  activity_id: number;
  schedule_id: number | null;
  content: string;
  occurred_at: string;
  cause: string | null;
  suggestion: string | null;
}

export type IncidentUpdate = Partial<Omit<IncidentInput, 'activity_id'>> & {
  activity_id?: number;
};

export interface DeleteByIdResponse {
  status: string;
  deleted_id: number;
}

