import { apiClient } from './apiClient';
import type {
  Activity,
  ActivityInput,
  ActivityUpdate,
  DeleteActivityResponse,
  DeleteByIdResponse,
  Decision,
  DecisionInput,
  DecisionUpdate,
  Incident,
  IncidentInput,
  IncidentUpdate,
  Meeting,
  MeetingInput,
  MeetingUpdate,
  Task,
  TaskInput,
  TaskUpdate,
  Schedule,
  ScheduleInput,
  ScheduleUpdate,
} from '../types';

/**
 * 活動與各籌備/執行細項 API 模組 (activityApi.ts)
 * 統一透過 apiClient 發送請求，提供強型別約束
 */
export const activityApi = {
  // 活動主體
  listActivities: () => apiClient.get<Activity[]>('/activities'),
  getActivity: (activityId: number) => apiClient.get<Activity>(`/activities/${activityId}`),
  createActivity: (payload: ActivityInput) => apiClient.post<Activity>('/activities', payload),
  updateActivity: (activityId: number, payload: ActivityUpdate) =>
    apiClient.put<Activity>(`/activities/${activityId}`, payload),
  deleteActivity: (activityId: number) =>
    apiClient.delete<DeleteActivityResponse>(`/activities/${activityId}`),

  // 會議
  listMeetings: (activityId: number) =>
    apiClient.get<Meeting[]>(`/meetings?activity_id=${encodeURIComponent(activityId)}`),
  createMeeting: (payload: MeetingInput) => apiClient.post<Meeting>('/meetings', payload),
  updateMeeting: (meetingId: number, payload: MeetingUpdate) =>
    apiClient.put<Meeting>(`/meetings/${meetingId}`, payload),
  deleteMeeting: (meetingId: number) =>
    apiClient.delete<DeleteByIdResponse>(`/meetings/${meetingId}`),

  // 待辦事項
  listTasks: (activityId: number) =>
    apiClient.get<Task[]>(`/tasks?activity_id=${encodeURIComponent(activityId)}`),
  createTask: (payload: TaskInput) => apiClient.post<Task>('/tasks', payload),
  updateTask: (taskId: number, payload: TaskUpdate) =>
    apiClient.put<Task>(`/tasks/${taskId}`, payload),
  deleteTask: (taskId: number) =>
    apiClient.delete<DeleteByIdResponse>(`/tasks/${taskId}`),

  // 決策紀錄
  listDecisions: (activityId: number) =>
    apiClient.get<Decision[]>(`/decisions?activity_id=${encodeURIComponent(activityId)}`),
  createDecision: (payload: DecisionInput) => apiClient.post<Decision>('/decisions', payload),
  updateDecision: (decisionId: number, payload: DecisionUpdate) =>
    apiClient.put<Decision>(`/decisions/${decisionId}`, payload),
  deleteDecision: (decisionId: number) =>
    apiClient.delete<DeleteByIdResponse>(`/decisions/${decisionId}`),

  // 流程日程
  listSchedules: (activityId: number) =>
    apiClient.get<Schedule[]>(`/schedules?activity_id=${encodeURIComponent(activityId)}`),
  createSchedule: (payload: ScheduleInput) => apiClient.post<Schedule>('/schedules', payload),
  updateSchedule: (scheduleId: number, payload: ScheduleUpdate) =>
    apiClient.put<Schedule>(`/schedules/${scheduleId}`, payload),
  deleteSchedule: (scheduleId: number) =>
    apiClient.delete<DeleteByIdResponse>(`/schedules/${scheduleId}`),

  // 突發事件
  listIncidents: (activityId: number) =>
    apiClient.get<Incident[]>(`/incidents?activity_id=${encodeURIComponent(activityId)}`),
  createIncident: (payload: IncidentInput) => apiClient.post<Incident>('/incidents', payload),
  updateIncident: (incidentId: number, payload: IncidentUpdate) =>
    apiClient.put<Incident>(`/incidents/${incidentId}`, payload),
  deleteIncident: (incidentId: number) =>
    apiClient.delete<DeleteByIdResponse>(`/incidents/${incidentId}`),

  // 交接摘要產生與入庫
  generateHandover: (schedules: unknown[], decisions: unknown[]) =>
    apiClient.post<{ summary: string }>('/handover/generate', { schedules, decisions }),

  saveHandover: (payload: { activity_id?: number; activity_name: string; content: string }) =>
    apiClient.post<{
      status: string;
      message: string;
      filename: string;
      file_path: string;
      doc_id?: number | null;
      chunks_added: number;
    }>('/handover/save', payload),
};
