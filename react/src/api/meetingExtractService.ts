/**
 * AI 會議紀錄結構化解析與提交服務模組 (meetingExtractService.ts)
 * 串接 Python FastAPI 之 /extract_summary, /commit_summary 與 /activities 端點
 */

import { apiClient } from './apiClient';

/**
 * 活動項目簡要介面 (供下拉選擇)
 */
export interface BackendActivity {
  id: number;
  name: string;
  year?: number;
  status?: string;
  start_date?: string;
  end_date?: string;
  venue?: string;
}

/**
 * AI 萃取的會議主體資訊
 */
export interface ExtractedMeeting {
  name: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  participants?: string;
  content?: string;
  source_document_id?: number;
}

/**
 * AI 萃取的關鍵決策紀錄
 */
export interface ExtractedDecision {
  problem: string;
  options: string[] | string; // 容許陣列或已序列化之 JSON 字串
  final_decision: string;
  reason: string;
  source?: string;
  confirmation_status?: string;
}

/**
 * AI 萃取的待辦事項
 */
export interface ExtractedTask {
  content: string;
  assignee?: string;
  due_date?: string;
  priority?: string; // '高' | '中' | '低'
  status?: string;
}

/**
 * AI 結構化預覽資料集
 */
export interface MeetingPreviewData {
  meeting: ExtractedMeeting;
  decisions: ExtractedDecision[];
  tasks: ExtractedTask[];
}

/**
 * /extract_summary 端點回應結構
 */
export interface ExtractSummaryResponse {
  status: string;
  doc_id: number;
  preview_data: MeetingPreviewData;
}

export interface TranscribeMeetingAudioResponse {
  status: string;
  doc_id: number;
  filename: string;
  chunks_added: number;
}

/**
 * /commit_summary 請求結構
 */
export interface CommitSummaryRequest {
  activity_id: number;
  doc_id?: number;
  source_file?: string;
  meeting: ExtractedMeeting;
  decisions: ExtractedDecision[];
  tasks: ExtractedTask[];
}

/**
 * /commit_summary 端點回應結構
 */
export interface CommitSummaryResponse {
  status: string;
  message: string;
  meeting: Record<string, unknown>;
  decisions: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
}

/**
 * 取得所有活動清單 (供關聯目標活動)
 */
export async function fetchActivities(): Promise<BackendActivity[]> {
  return await apiClient.get<BackendActivity[]>('/activities');
}

/**
 * 建立新活動 Payload 介面
 */
export interface CreateActivityPayload {
  name: string;
  year: number;
  status: string;
  start_date?: string;
  end_date?: string;
  venue?: string;
  activity_type?: string;
  coordinator?: string;
  expected_attendees?: number;
  budget?: number;
}

/**
 * 建立新活動 (POST /activities)
 */
export async function createActivity(
  payload: CreateActivityPayload
): Promise<BackendActivity> {
  return await apiClient.post<BackendActivity>('/activities', payload);
}

/**
 * 依指定文件 ID 或路徑發起 AI 會議結構化抽取
 * 對應後端 main.py:470 之 @app.post("/extract_summary") 端點
 * 透過 System Prompt 將整份會議文本 1-shot 提煉為 meeting, decisions, tasks
 * @param docId 託管文件 ID (可選)
 * @param filePath 託管文件路徑 (可選)
 */
export async function extractMeetingSummary(
  docId?: number,
  filePath?: string
): Promise<ExtractSummaryResponse> {
  const payload: { doc_id?: number; file_path?: string } = {};
  if (typeof docId === 'number' && !Number.isNaN(docId)) {
    payload.doc_id = docId;
  }
  if (filePath) {
    payload.file_path = filePath;
  }

  return await apiClient.post<ExtractSummaryResponse>('/extract_summary', payload);
}

/** 上傳錄音，轉成逐字稿並存入文件紀錄庫 */
export async function transcribeMeetingAudio(
  file: File
): Promise<TranscribeMeetingAudioResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return await apiClient.upload<TranscribeMeetingAudioResponse>(
    '/meeting-audio/transcribe',
    formData,
  );
}

/**
 * 將使用者確認後的結構化會議、決策與待辦寫入活動資料庫
 * 對應後端 main.py:498 之 @app.post("/commit_summary") 端點
 * 全面遵循 test_main.py:199~290 之規範：
 * 1. options: 陣列自動 json.dumps，支援字串傳入 (test_main.py:257-259)
 * 2. source: 採納 d.source || source_file || '會議紀錄來源' (test_main.py:266)
 * 3. tasks: 預設 priority="中", status="pending" (test_main.py:278)
 * 4. meeting: 支援 source_document_id 綁定來源文檔 (test_main.py:251)
 */
export async function commitMeetingSummary(
  payload: CommitSummaryRequest
): Promise<CommitSummaryResponse> {
  const fallbackSource = payload.source_file || '會議紀錄全文';

  // 1. 標準化 decisions：完全對齊 test_main.py L256~268
  const normalizedDecisions = (payload.decisions || []).map((d) => {
    let opts = d.options;
    if (Array.isArray(opts)) {
      opts = JSON.stringify(opts);
    } else if (typeof opts !== 'string') {
      opts = JSON.stringify([]);
    }

    return {
      problem: d.problem || '',
      options: opts,
      final_decision: d.final_decision || '',
      reason: d.reason || '',
      source: (d.source && d.source.trim()) ? d.source.trim() : fallbackSource,
      confirmation_status: d.confirmation_status || 'pending',
    };
  });

  // 2. 標準化 tasks：完全對齊 test_main.py L271~281
  const normalizedTasks = (payload.tasks || []).map((t) => ({
    content: t.content || '',
    assignee: t.assignee || '',
    due_date: t.due_date || '',
    priority: t.priority || '中',
    status: t.status || 'pending',
  }));

  // 3. 標準化 meeting 欄位：完全對齊 test_main.py L241~252
  const normalizedMeeting = {
    name: payload.meeting.name || '未命名會議',
    date: payload.meeting.date || '',
    start_time: payload.meeting.start_time || '',
    end_time: payload.meeting.end_time || '',
    location: payload.meeting.location || '',
    participants: payload.meeting.participants || '',
    content: payload.meeting.content || '',
    source_document_id: payload.doc_id ?? undefined,
  };

  return await apiClient.post<CommitSummaryResponse>('/commit_summary', {
    activity_id: payload.activity_id,
    doc_id: payload.doc_id,
    source_file: payload.source_file,
    meeting: normalizedMeeting,
    decisions: normalizedDecisions,
    tasks: normalizedTasks,
  });
}

