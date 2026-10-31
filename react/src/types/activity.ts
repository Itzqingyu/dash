/**
 * 活動主體資料結構型別定義 (activity.ts)
 */

export type ActivityStatus = '未開始' | '準備中' | '進行中' | '已完成' | string;

export interface Activity {
  id: number;
  name: string;
  year: number;
  status: ActivityStatus;
  start_date: string | null;
  end_date: string | null;
  venue: string | null;
  activity_type: string | null;
  coordinator: string | null;
  expected_attendees: number | null;
  budget: number | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityInput {
  name: string;
  year: number;
  status: ActivityStatus;
  start_date: string | null;
  end_date: string | null;
  venue: string | null;
  activity_type: string | null;
  coordinator: string | null;
  expected_attendees: number | null;
  budget: number | null;
}

export type ActivityUpdate = Partial<ActivityInput>;

export interface DeleteActivityResponse {
  status: string;
  deleted: Activity;
}

// 重新匯出籌備與執行階段細項型別，確保向後相容
export * from './meeting';
