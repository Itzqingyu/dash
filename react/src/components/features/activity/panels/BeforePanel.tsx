import React, { useState, useEffect } from 'react';
import './BeforePanel.css';
import { activityApi } from '../../../../api/activityApi';
import type { Meeting, Task, Decision } from '../../../../types/activity';

export default function BeforePanel({ currentActivity, currentView, setCurrentView }: any) {
  // 建立儲存資料的 state，預設為空陣列
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);

  useEffect(() => {
    if (!currentActivity?.id) return;

    const fetchPreviewData = async () => {
      try {
        const [meetingsData, tasksData, decisionsData] = await Promise.all([
          activityApi.listMeetings(currentActivity.id),
          activityApi.listTasks(currentActivity.id),
          activityApi.listDecisions(currentActivity.id)
        ]);
        
        setMeetings(meetingsData);
        setTasks(tasksData);
        setDecisions(decisionsData);
        
        // 👇 加上這兩行來印出資料 👇
        console.log("全部的決策資料：", decisionsData);
        if (decisionsData.length > 0) {
          console.log("第一筆決策的長相：", decisionsData[0]);
        }

      } catch (error) {
        console.error("取得預覽資料失敗:", error);
      }
    };

    fetchPreviewData();
  }, [currentActivity?.id]);

// ==========================================
  // 💡 在 return 之前，先根據抓回來的 API 資料計算數字
  // ==========================================
  
  const nextMeeting = meetings.length > 0 
    ? [...meetings].sort((a: any, b: any) => {
        // 將日期字串轉換為時間戳來比大小
        const dateA = new Date(a.date || a.start_time).getTime();
        const dateB = new Date(b.date || b.start_time).getTime();
        return dateA - dateB; // 升冪排序（日期近的在前面）
      })[0] 
    : null;
  
  const totalTasksCount = tasks.length;
  const completedTasksCount = tasks.filter(t => t.status === 'completed').length;
  const pendingTasksCount = totalTasksCount - completedTasksCount;
  
  const totalDecisionsCount = decisions.length;
  const pendingDecisionsCount = decisions.filter(d => d.confirmation_status === 'pending').length;
  const confirmedDecisionsCount = totalDecisionsCount - pendingDecisionsCount;

  const totalItems = totalTasksCount + totalDecisionsCount;
  const completedItems = completedTasksCount + confirmedDecisionsCount;

  const progressPercentage = totalItems === 0 
    ? 0 
    : Math.round((completedItems / totalItems) * 100);
    // 5. 計算活動天數跨度
    let durationText = '單日活動'; // 預設文字
    
    if (currentActivity?.start_date && currentActivity?.end_date) {
      const startDate = new Date(currentActivity.start_date).getTime();
      const endDate = new Date(currentActivity.end_date).getTime();
      
      // 計算相差的毫秒數，並轉換為天數 (加上 1 代表頭尾都算)
      const msPerDay = 1000 * 60 * 60 * 24;
      const diffDays = Math.round((endDate - startDate) / msPerDay) + 1;
      
      if (diffDays > 1) {
        durationText = `${diffDays}天活動`;
      } else if (diffDays === 1) {
        durationText = '單日活動';
      } else {
        durationText = '日期錯誤'; // 結束時間比開始時間早防呆
      }
    } else if (!currentActivity?.start_date && !currentActivity?.end_date) {
      durationText = '未定檔期'; 
    }

  return (
    <section className={`view-panel ${currentView === 'before' ? 'active' : ''}`} data-panel="before">
      <div className="section-heading">
        <p className="eyebrow">BEFORE EVENT</p>
        <h2>活動前</h2>
        <p style={{ marginTop: '6px', marginBottom: '12px'}}>
          集中查看籌備進度與尚未確認的事項。
        </p>
      </div>
      
      {/* 📊 頂部數據區 */}
      <div className="prep-overview">
        <article className="prep-score">
          <span>準備完成度</span>
          <strong>{progressPercentage}%</strong>
          <div className="bar">
            {/* 👇 控制進度條的藍色長度 */}
            <i style={{ width: `${progressPercentage}%` }}></i>
          </div>
          <small>{progressPercentage === 100 ? '準備就緒！' : '持續推進中'}</small>
        </article>
        <article style={{ minWidth: 0 }}>
          <span>下一場會議</span>
          {/* 👇 改用真實會議名稱 */}
          <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{nextMeeting ? nextMeeting.name : '無'}</strong> 
          <small>{nextMeeting ? nextMeeting.date : ''}</small>
        </article>
        <article>
          <span>未完成待辦</span>
          {/* 👇 改用算出來的數量 */}
          <strong>{pendingTasksCount}</strong>
          <small>請至任務追蹤查看</small>
        </article>
        <article>
          <span>待確認決策</span>
          {/* 👇 改用算出來的數量 */}
          <strong>{pendingDecisionsCount}</strong>
          <small>請盡快確認</small>
        </article>
      </div>

      {/* 🎛️ 四大模組入口 */}
      <div className="module-grid">
        <button className="module-card featured" type="button" onClick={() => setCurrentView('meeting')}>
          <span className="module-number" style={{ flexShrink: 0 }}>01</span>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <p style={{ 
              whiteSpace: 'nowrap', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis' 
            }}>
              下一場會議・{nextMeeting ? nextMeeting.date : '無'}
            </p>
            <h3 style={{ 
              margin: 0, 
              color: 'white',
              whiteSpace: 'nowrap',
              overflow: 'hidden',         
              textOverflow: 'ellipsis'    
            }}>
              {nextMeeting ? nextMeeting.name : '暫無會議'}
            </h3>
          </div>
          <b style={{ flexShrink: 0 }}>開啟 ›</b>
        </button>
        <button className="module-card" type="button" onClick={() => setCurrentView('tasks')}>
          <span className="module-number">02</span>
          <div>
            <p>任務追蹤</p>
            <h3>待辦事項</h3>
            {/* 👇 改用真實的待辦總數與完成數 */}
            <small>{totalTasksCount} 筆待辦・完成 {completedTasksCount} 筆</small>
          </div>
          <b>查看 ›</b>
        </button>
        <button className="module-card" type="button" onClick={() => setCurrentView('decisions')}>
          <span className="module-number">03</span>
          <div>
            <p>保存選擇原因</p>
            <h3>決策紀錄</h3>
            {/* 👇 改用真實的決策總數與待確認數 */}
            <small>{totalDecisionsCount} 筆決策・{pendingDecisionsCount} 筆待確認</small>
          </div>
          <b>查看 ›</b>
        </button>
        {/* 4. 流程規劃卡片 */}
        <button className="module-card" type="button" onClick={() => setCurrentView('schedule')}>
          <span className="module-number">04</span>
          <div>
            {/* 👇 把原本寫死的文字，換成大括號包住的變數 👇 */}
            <p>{durationText}</p>
            <h3>流程規劃</h3>
            <small>查看詳細時程</small>
          </div>
          <b>查看 ›</b>
        </button>
      </div>

      {/* 🚨 警報面板 */}
      {currentActivity.alert && currentActivity.alert.length > 0 && (
        <div className="alert-panel">
          <span>!</span>
          <div>
            <strong>{currentActivity.alert[0]}</strong>
            <p>{currentActivity.alert[1]}</p>
          </div>
          <button className="button secondary" type="button">加入會議</button>
        </div>
      )}
    </section>
  );
}