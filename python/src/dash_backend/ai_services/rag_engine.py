"""RAG 核心引擎模組 (RAG Engine Core)。

整合 Markdown 文件讀取與切塊、FastEmbed 繁中向量模型、
PostgreSQL 16 + pgvector 原生向量檢索 (HNSW 餘弦距離) 以及 Cross-Encoder 重排序 (Reranking)。
"""

import json
import os
from typing import Any, Dict, List, Optional
from fastembed.rerank.cross_encoder import TextCrossEncoder
from langchain_community.embeddings.fastembed import FastEmbedEmbeddings
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

import dash_backend.database as db
from dash_backend.document_processing.converter import convert_to_markdown, get_default_markdown_dir

DEFAULT_MARKDOWN_DIR = None

# ==========================================
# 1. Embedding 與 Reranker 模型載入 (Lazy Singletons)
# ==========================================

_embeddings = None
_reranker = None


def get_embeddings() -> FastEmbedEmbeddings:
    """回傳 FastEmbedEmbeddings 向量模型單例 (使用 Jina AI 中文模型 jina-embeddings-v2-base-zh，維度 768)。"""
    global _embeddings
    if _embeddings is None:
        _embeddings = FastEmbedEmbeddings(model_name="jinaai/jina-embeddings-v2-base-zh")
    return _embeddings


def get_reranker() -> TextCrossEncoder:
    """回傳 FastEmbed TextCrossEncoder 重排序模型單例 (使用 Jina AI 多語言模型 jina-reranker-v2-base-multilingual)。"""
    global _reranker
    if _reranker is None:
        _reranker = TextCrossEncoder(model_name="jinaai/jina-reranker-v2-base-multilingual")
    return _reranker


# ==========================================
# 2. Markdown 切塊與 Rerank 重排序功能
# ==========================================

def split_markdown(file_path: str) -> List[Document]:
    """讀取 Markdown 檔案並使用 RecursiveCharacterTextSplitter 進行固定長度切塊 (500 字，50 字重疊)。
    切塊 metadata 中的 source 統一存放為相對於 data/ 的相對路徑 (格式固定為 markdown/{filename})。
    """
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        print(f"[RAG Engine Error] 讀取檔案失敗 {file_path}: {e}")
        return []

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50,
        separators=["\n\n", "\n", " ", ""],
    )

    filename = os.path.basename(file_path)
    rel_source_path = f"markdown/{filename}"

    docs = text_splitter.create_documents(
        texts=[content],
        metadatas=[{"source": rel_source_path}],
    )

    return docs


def rerank_documents(query: str, documents: List[Document], top_k: int = 5) -> List[Document]:
    """使用 Cross-Encoder 對初步檢索出的文件片段與查詢問題進行交叉比對評分，回傳前 top_k 個最相關結果。"""
    if not documents:
        return []

    reranker = get_reranker()
    doc_texts = [doc.page_content for doc in documents]

    scores = list(reranker.rerank(query, doc_texts))

    scored_docs = list(zip(scores, documents))
    scored_docs.sort(key=lambda x: x[0], reverse=True)

    return [doc for score, doc in scored_docs[:top_k]]


# ==========================================
# 3. RAG 檢索與文件管理 (Retriever API)
# ==========================================

def add_document(
    file_path: str,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> int:
    """解析 Markdown 檔案、文本切塊、計算 768 維向量並將切塊與 Metadata 寫入 PostgreSQL。
    系統不支援自動覆蓋；若檔案已存在於資料庫中，將拋出 FileExistsError。

    :param file_path: 實體檔案路徑 (支援 .md, .txt, .pdf, .docx)
    :param vault_name: 目標 Vault 名稱 (若未指定則使用當前啟用之 Vault)
    :return: 成功寫入的切塊數量
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"找不到檔案: {file_path}")

    source_path = os.path.abspath(file_path)

    # 1. 判斷預期的託管 Markdown 檔案路徑
    raw_name = os.path.basename(file_path)
    file_stem, ext = os.path.splitext(raw_name)
    md_dir = DEFAULT_MARKDOWN_DIR or get_default_markdown_dir()
    target_md_path = os.path.join(md_dir, f"{file_stem}.md")

    # 2. 檢查 PostgreSQL 紀錄是否存在，若已存在則拋出 FileExistsError
    existing_record = db.get_doc_by_path(target_md_path, vault_name=vault_name)
    if existing_record:
        raise FileExistsError(f"檔案已存在於資料庫中: {target_md_path}")

    # 3. 確保目標託管 Markdown 檔案存在且內容最新 (多格式轉檔 PDF/DOCX/TXT/MD)
    if source_path != os.path.abspath(target_md_path) or ext.lower() != ".md":
        target_md_path = convert_to_markdown(source_path)

    docs = split_markdown(target_md_path)
    if not docs:
        return 0

    # 4. 計算切塊向量 (Jina v2 base 繁中，維度 768)
    embeddings_service = get_embeddings()
    doc_texts = [d.page_content for d in docs]
    vectors = embeddings_service.embed_documents(doc_texts)

    # 5. 寫入 documents 主表與 document_chunks 向量切塊表
    doc_id = db.add_or_update_doc_record(
        file_path=target_md_path,
        chunk_count=len(docs),
        vault_name=vault_name,
    )

    with db.get_connection(vault_name=vault_name) as conn:
        for idx, (doc, vec) in enumerate(zip(docs, vectors)):
            meta_json = json.dumps(doc.metadata, ensure_ascii=False)
            conn.execute(
                """
                INSERT INTO document_chunks (document_id, chunk_index, content, metadata, embedding)
                VALUES (%s, %s, %s, %s, %s::vector)
                """,
                (doc_id, idx, doc.page_content, meta_json, vec),
            )

    return len(docs)


def delete_document(
    identifier: str,
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> bool:
    """根據檔案路徑或 ID 從 PostgreSQL 與實體硬碟中同步刪除文件與切塊向量紀錄。
    因資料庫外鍵設定 ON DELETE CASCADE，刪除 documents 紀錄將自動連鎖清理所有 document_chunks 向量。
    """
    record = None
    if str(identifier).isdigit():
        record = db.get_doc_by_id(int(identifier), vault_name=vault_name)
    else:
        record = db.get_doc_by_path(identifier, vault_name=vault_name)

    if not record:
        return False

    file_path = record["file_path"]
    filename = record["filename"]
    doc_id = record["id"]

    # 1. 從 PostgreSQL 刪除文件紀錄（外鍵連鎖刪除向量切塊）
    db.delete_doc_record_by_id(doc_id, vault_name=vault_name)

    # 2. 清理託管於硬碟的實體 .md 檔案
    md_dir = DEFAULT_MARKDOWN_DIR or get_default_markdown_dir()
    abs_md_path = os.path.join(md_dir, filename)
    target_to_remove = abs_md_path if os.path.exists(abs_md_path) else (file_path if os.path.exists(file_path) else None)
    if target_to_remove and os.path.exists(target_to_remove):
        try:
            os.remove(target_to_remove)
        except Exception as e:
            print(f"[Warning] 刪除硬碟實體檔案失敗: {e}")

    return True


def list_documents(
    *,
    vault_name: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """取得所有已上傳的 RAG 文件列表。"""
    return db.get_all_docs(vault_name=vault_name)


def search(
    query: str,
    top_k: int = 5,
    vault_name: Optional[str] = None,
) -> List[Document]:
    """執行完整 RAG 檢索流程：
    1. 計算問題的 768 維向量。
    2. 經由 pgvector HNSW 索引餘弦距離抓取前 top_k * 3 個最相近候選切塊。
    3. 經由 Cross-Encoder 重排序模型進行高精度語意排序，回傳前 top_k 個最相關結果。
    """
    embeddings_service = get_embeddings()
    query_vector = embeddings_service.embed_query(query)

    retrieve_k = top_k * 3

    with db.get_connection(vault_name=vault_name) as conn:
        rows = conn.execute(
            """
            SELECT content, metadata, 1 - (embedding <=> %s::vector) AS similarity
            FROM document_chunks
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (query_vector, query_vector, retrieve_k),
        ).fetchall()

    if not rows:
        return []

    initial_results: List[Document] = []
    for row in rows:
        meta = row.get("metadata")
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        elif not isinstance(meta, dict):
            meta = {}
        meta["similarity"] = float(row.get("similarity", 0.0))
        initial_results.append(Document(page_content=row["content"], metadata=meta))

    reranked_results = rerank_documents(query, initial_results, top_k=top_k)
    return reranked_results
