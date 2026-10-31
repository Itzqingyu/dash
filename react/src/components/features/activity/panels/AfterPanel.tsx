import React, { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { activityApi } from '../../../../api/activityApi';
import './AfterPanel.css';

// 在 Props 裡接收 schedules 和 decisions
export default function AfterPanel({ currentView, activityId, scheduleVersion, onOpenHandover }: any) {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [decisions, setDecisions] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  // 新增：控制流程檢討的編輯狀態
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState('');
  // 新增：控制決策結果的編輯狀態
  const [editingDecisionId, setEditingDecisionId] = useState<string | null>(null);
  const [decisionDraft, setDecisionDraft] = useState('');

  // 幫忙把時間變漂亮的格式化小幫手
  const formatTime = (timeStr?: string | null) => {
    if (!timeStr) return '時間未定';
    return timeStr.substring(5, 16).replace('T', ' ');
  };

  // 確保流程檢討的順序跟 Schedule 面板一樣 (依照時間排序)
  const sortedSchedules = [...schedules].sort((a, b) => {
    const startA = new Date(a.start_time || '').getTime() || Infinity;
    const startB = new Date(b.start_time || '').getTime() || Infinity;
    return startA - startB;
  });

  useEffect(() => {
    if (!activityId) return;
    let active = true;

    Promise.all([
      activityApi.listSchedules(activityId),
      activityApi.listDecisions(activityId),
      activityApi.listIncidents(activityId) // 👈 新增這行，把 API 加上去
    ])
    .then(([scheduleRows, decisionRows, incidentRows]) => {
      if (!active) return;
      setSchedules(scheduleRows || []);
      setDecisions(decisionRows || []);
      setIncidents(incidentRows || []); // 👈 把抓到的資料存進狀態
    })
    .catch((err) => console.error("抓取資料失敗:", err));

    return () => { active = false; };
  }, [activityId, scheduleVersion]);

  useEffect(() => {
    if (!activityId) return; // 如果還沒拿到活動 ID 就先不抓
    
    let active = true;
    // 同時去抓「流程」跟「決策」的資料
    // (💡 假設你的決策 API 叫做 activityApi.listDecisions)
    Promise.all([
      activityApi.listSchedules(activityId),
      activityApi.listDecisions(activityId) 
    ])
    .then(([scheduleRows, decisionRows]) => {
      if (!active) return;
      setSchedules(scheduleRows);
      setDecisions(decisionRows);
    })
    .catch((err) => {
      console.error("抓取資料失敗:", err);
    });
    return () => { active = false; };
  }, [activityId, scheduleVersion]);

// 儲存流程檢討的函式
  const handleSaveSchedule = async (id: number) => {
    try {
      // 建構一個只包含 outcome_note 的 payload
      const payload = {
        outcome_note: scheduleDraft 
      };

      await activityApi.updateSchedule(id, payload);
      
      setSchedules(prev => prev.map(s => s.id === id ? { ...s, outcome_note: scheduleDraft } : s));
      setEditingScheduleId(null); 
    } catch (error) {
      console.error("儲存流程檢討失敗:", error);
    }
  };

  // 儲存決策結果的函式
  const handleSaveDecision = async (id: number) => {
    try {
      // 建構一個只包含 outcome_note 的 payload
      const payload = {
        outcome_note: decisionDraft
      };

      await activityApi.updateDecision(id, payload);
      
      setDecisions(prev => prev.map(d => d.id === id ? { ...d, outcome_note: decisionDraft } : d));
      setEditingDecisionId(null);
    } catch (error) {
      console.error("儲存決策結果失敗:", error);
    }
  };

  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const handleGenerateClick = async () => {
    setGenerateError(null);
    setIsGenerating(true);
    try {
      // 把目前的流程與決策資料，丟給你的 Python API
      const data = await activityApi.generateHandover(schedules, decisions);
      
      // 把拿到的 AI 摘要，透過 Prop 傳給 App.tsx，並打開 Modal
      onOpenHandover(data.summary); 
    } catch (error) {
      setGenerateError('AI 生成失敗，請確認後端伺服器有開啟！');
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const totalSchedules = schedules.length;
  const reviewedSchedules = schedules.filter(s => s.outcome_note != null && s.outcome_note.trim() !== '').length; 
  const pendingSchedules = totalSchedules - reviewedSchedules;

  const totalDecisions = decisions.length;
  const evaluatedDecisions = decisions.filter(d => d.outcome_note != null && d.outcome_note.trim() !== '').length;
  const pendingDecisions = totalDecisions - evaluatedDecisions;

  const totalIncidents = incidents.length;

  return (
    <section className={`view-panel ${currentView === 'after' ? 'active' : ''}`} data-panel="after">
      <div className="section-heading">
        <div><p className="eyebrow">AFTER EVENT</p><h2>成果與檢討</h2><p style = {{ marginTop: '4px', marginBottom: '4px'}}>沿用活動流程補上實際結果，形成下一屆可用的經驗。</p></div>
        <span className="status finished" style = {{ marginBottom: '4px'}}>已完成</span>
      </div>

      <div className="after-summary">
        {/* 1. 流程檢討卡片 */}
        <article>
          <span>流程檢討</span>
          <strong>{reviewedSchedules} / {totalSchedules}</strong>
          <small>
            {pendingSchedules === 0 && totalSchedules > 0 ? '已完成填寫' : `還有 ${pendingSchedules} 筆待補`}
          </small>
        </article>

        {/* 2. 決策結果卡片 */}
        <article>
          <span>決策結果</span>
          <strong>{evaluatedDecisions} / {totalDecisions}</strong>
          <small>
            {pendingDecisions === 0 && totalDecisions > 0 ? '已完成確認' : `還有 ${pendingDecisions} 筆待補`}
          </small>
        </article>

        {/* 3. 臨時紀錄卡片 */}
        <article>
          <span>臨時紀錄</span>
          <strong>{totalIncidents}</strong>
          <small>已帶入相關流程</small>
        </article>
      </div>

      {/* ==================== 流程結果區塊 ==================== */}
      <div className="section-heading compact subsection-heading">
        <div><p className="eyebrow" style={{ color: 'var(--navy)' }}>FLOW RESULTS</p><h3 style={{ color: 'var(--navy)' }}>流程結果</h3><p style = {{ marginTop: '2px', marginBottom: '10px'}}>在原本流程上補充實際時間、問題、原因與下次建議。</p></div>
      </div>
      <div className="flow-result-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {sortedSchedules.map((schedule) => {
          const isEditing = editingScheduleId === schedule.id;

          return (
            <article key={schedule.id} className="info-card" style={{ padding: '20px', marginBottom: '16px', boxShadow: 'var(--shadow-md)', border: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
                
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.05em', marginBottom: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    原訂：{formatTime(schedule.start_time)} ~ {formatTime(schedule.end_time)}
                  </div>
                  <h4 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {schedule.name}
                  </h4>
                  
                  {/* 👇 判斷：如果是編輯模式，顯示 textarea；否則顯示虛線框或已填寫的內容 */}
                  {isEditing ? (
                    <textarea
                      style={{ 
                        width: '100%', marginTop: '16px', padding: '14px 16px', 
                        borderRadius: 'var(--radius)', border: '1px solid var(--line)', 
                        background: 'var(--panel)', fontSize: '0.9rem', resize: 'vertical',
                        wordBreak: 'break-all'
                      }}
                      rows={3}
                      value={scheduleDraft}
                      onChange={(e) => setScheduleDraft(e.target.value)}
                      placeholder="請輸入實際狀況、遭遇問題與下次建議..."
                    />
                  ) : (
                    <div style={{ 
                      marginTop: '16px', padding: '14px 16px', background: schedule.outcome_note ? 'var(--canvas)' : 'var(--canvas)', 
                      border: schedule.outcome_note ? '1px solid var(--line)' : '1px dashed var(--line)', 
                      borderRadius: 'var(--radius)', fontSize: '0.9rem', color: schedule.outcome_note ? 'var(--ink-soft)' : 'var(--muted)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all'
                    }}>
                      {schedule.outcome_note || '尚未填寫實際狀況與建議...'}
                    </div>
                  )}
                </div>

                {/* 👇 判斷：按鈕區域切換 */}
                <div style={{ flexShrink: 0, marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {isEditing ? (
                    <>
                      <button className="button primary" type="button" onClick={() => handleSaveSchedule(schedule.id)}>儲存</button>
                      <button className="button secondary" type="button" onClick={() => setEditingScheduleId(null)}>取消</button>
                    </>
                  ) : (
                    <button className="button secondary" type="button" onClick={() => {
                      setEditingScheduleId(schedule.id);
                      setScheduleDraft(schedule.outcome_note || '');
                    }}>
                      {schedule.outcome_note ? '編輯檢討' : '填寫檢討'}
                    </button>
                  )}
                </div>
                
              </div>
            </article>
          );
        })}
      </div>

      {/* ==================== 決策執行結果區塊 ==================== */}
      <div className="section-heading compact subsection-heading">
        <div><p className="eyebrow" style = {{ marginTop: '8px', color: 'var(--navy)' }}>DECISION RESULTS</p><h3 style={{ color: 'var(--navy)' }}>決策執行結果</h3><p style = {{ marginTop: '2px', marginBottom: '10px'}}>確認每筆決策是否有效，補齊下一屆需要知道的結果。</p></div>
      </div>
      <div className="decision-result-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {decisions.map((decision) => {
          const isEditing = editingDecisionId === decision.id;

          return (
            <article key={decision.id} className="info-card" style={{ padding: '20px', marginBottom: '16px', boxShadow: 'var(--shadow-md)', border: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
                
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.05em', marginBottom: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {decision.problem || '未命名決策'}
                  </div>
                  <h4 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {decision.title}
                  </h4>
                  
                  {/* 👇 判斷編輯模式 */}
                  {isEditing ? (
                    <textarea
                      style={{ 
                        width: '100%', marginTop: '16px', padding: '14px 16px', 
                        borderRadius: 'var(--radius)', border: '1px solid var(--line)', 
                        background: 'var(--panel)', fontSize: '0.9rem', resize: 'vertical',
                        wordBreak: 'break-all'
                      }}
                      rows={3}
                      value={decisionDraft}
                      onChange={(e) => setDecisionDraft(e.target.value)}
                      placeholder="請輸入成效評估與後續影響..."
                    />
                  ) : (
                    <div style={{ 
                      marginTop: '16px', padding: '14px 16px', background: decision.outcome_note ? 'var(--canvas)' : 'var(--canvas)', 
                      border: decision.outcome_note ? '1px solid var(--line)' : '1px dashed var(--line)', 
                      borderRadius: 'var(--radius)', fontSize: '0.9rem', color: decision.outcome_note ? 'var(--ink-soft)' : 'var(--muted)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all'
                    }}>
                      {decision.outcome_note || '尚未填寫成效評估...'}
                    </div>
                  )}
                </div>

                {/* 👇 判斷按鈕 */}
                <div style={{ flexShrink: 0, marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {isEditing ? (
                    <>
                      <button className="button primary" type="button" onClick={() => handleSaveDecision(decision.id)}>儲存</button>
                      <button className="button secondary" type="button" onClick={() => setEditingDecisionId(null)}>取消</button>
                    </>
                  ) : (
                    <button className="button secondary" type="button" onClick={() => {
                      setEditingDecisionId(decision.id);
                      setDecisionDraft(decision.outcome_note || '');
                    }}>
                      {decision.outcome_note ? '編輯結果' : '填寫結果'}
                    </button>
                  )}
                </div>
                
              </div>
            </article>
          );
        })}
      </div>

      {/* ==================== AI 交接摘要區塊 ==================== */}
      <article className="handover-card enriched-handover" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginTop: '24px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 👇 1. 拿掉「假資料」字眼，標題改成通用的活動交接重點 */}
          <p className="eyebrow">AI 年度交接摘要</p>
          <h3 style={{ wordBreak: 'break-all' }}>活動交接重點</h3>
          <p>已根據目前填寫內容，由 AI 自動整理重大決策、問題與下次建議。</p>
          
          {/* 👇 2. 把假數字換成上方已經算好的真實狀態變數 */}
          <div className="handover-metrics" style={{ display: 'flex', gap: '16px' }}>
            <span><b>{evaluatedDecisions}</b>項決策紀錄</span>
            <span><b>{reviewedSchedules}</b>項流程檢討</span>
            <span><b>{totalIncidents}</b>筆臨時紀錄</span>
          </div>
        </div>
        
        {/* 綁定 API 呼叫函式 (handleGenerateClick) */}
        <button 
          className="button primary" 
          type="button" 
          style={{ flexShrink: 0 }} 
          onClick={handleGenerateClick}
          disabled={isGenerating}
        >
          {isGenerating ? 'AI 生成中...' : '預覽摘要'}
        </button>
      </article>

      {generateError && (
        <div className="after-error-banner" role="alert">
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div className="error-content">
            <span>{generateError}</span>
            <button type="button" className="error-dismiss" onClick={() => setGenerateError(null)}>
              關閉
            </button>
          </div>
        </div>
      )}
    </section>
  );
}