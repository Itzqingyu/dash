import React from 'react';
import './SourceRecordPanel.css';

export default function SourceRecordPanel({ currentView, setCurrentView }: any) {
  return (
    <section className="view-panel source-record-panel" data-panel="source-record" hidden={currentView !== 'source-record'}>
      <div className="detail-toolbar">
        {/* 點擊返回鍵，回到決策列表 */}
        <button className="back-link" type="button" onClick={() => setCurrentView('decisions')}>← 回到上一頁</button>
      </div>
      <article className="source-record-page">
        <div className="source-record-title">
          <div>
            <p className="eyebrow">ARCHIVED DECISION・PROTOTYPE</p>
            <h2>歷史完整決策紀錄</h2>
            <p>此頁使用假資料展示完整紀錄的閱讀方式。</p>
          </div>
          <span className="status completed">已歸檔</span>
        </div>
        <dl className="source-record-meta">
          <div><dt>所屬活動</dt><dd>2025 迎新宿營</dd></div>
          <div><dt>資料來源</dt><dd>2025 三籌會議紀錄</dd></div>
          <div><dt>紀錄日期</dt><dd>2025/09/20</dd></div>
          <div><dt>紀錄人</dt><dd>活動組・林同學</dd></div>
        </dl>
        <div className="source-record-grid">
          <section><span>當時的問題</span><h3>如何降低假日交通造成的延誤？</h3></section>
          <section><span>最終決定</span><h3>發車提前 30 分鐘，並於前一日晚間再次確認路況</h3></section>
        </div>
        <section className="source-record-section">
          <span>考慮過的選項</span><ol><li>維持原發車時間</li><li>發車提前 30 分鐘</li><li>維持時間但縮短第一段流程</li></ol>
        </section>
        <section className="source-record-section">
          <span>決定原因</span><p>前一年曾因週末車潮延誤，提前發車能保留行程緩衝，也不需要刪減活動內容。</p>
        </section>
        <section className="source-record-section">
          <span>執行結果</span><p>活動組在出發前一晚完成路況確認；當天仍有約 10 分鐘車流延遲，但沒有影響開幕流程。</p>
        </section>
        <section className="source-record-section excerpt">
          <span>原始紀錄摘錄</span><p>交通組建議將發車時間提前，並在出發前再次向車公司確認路線與即時路況。</p>
        </section>
      </article>
    </section>
  );
}