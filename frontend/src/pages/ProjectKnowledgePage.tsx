import React, { useEffect, useMemo, useState } from 'react';
import { Bookmark, BookOpen, Bot, Database, Download, Eye, FileText, Filter, FolderOpen, Image as ImageIcon, RefreshCw, Search, Send, Sparkles, Trash2, WandSparkles, X } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { ProjectKnowledgeService, type IndexFolderResult, type KnowledgeCitation, type KnowledgeDocument, type KnowledgeChatResult, type SavedEvidenceItem } from '../services/projectKnowledge';

const DEFAULT_LEARNING_FOLDER = '/Users/prashanththipparthi/Desktop/XYRA Studio/learning_review/pids_for_learning';

const projectIdFromProject = (project: Record<string, unknown>) => {
  const text = String(project?.project_no || project?.project_name || 'default').trim();
  return text.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
};

const fmtSize = (bytes?: number) => {
  if (!bytes) return '-';
  if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes > 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
};

const canPreviewCitation = (citation: KnowledgeCitation) =>
  citation.file_name?.toLowerCase().endsWith('.pdf') && citation.document_id && citation.page_number;

const CitationCard: React.FC<{
  citation: KnowledgeCitation;
  index: number;
  projectId: string;
  onUseQuestion?: (question: string) => void;
  onSave?: (citation: KnowledgeCitation) => void;
  onPreview?: (citation: KnowledgeCitation) => void;
}> = ({ citation, index, projectId, onUseQuestion, onSave, onPreview }) => (
  <div className="rounded border border-white/[0.07] bg-white/[0.025] p-3">
    <div className="flex gap-3">
      {canPreviewCitation(citation) && (
        <button
          type="button"
          onClick={() => onPreview?.(citation)}
          className="h-24 w-20 shrink-0 overflow-hidden rounded border border-white/[0.08] bg-white/[0.03]"
          title="Preview page"
        >
          <img
            src={ProjectKnowledgeService.pageImageUrl(projectId, citation.document_id, citation.page_number || 1, 0.32)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-top opacity-80"
          />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-5 w-5 rounded bg-white text-gray-950 text-[10px] font-bold flex items-center justify-center shrink-0">{index + 1}</span>
              <p className="text-xs text-gray-200 font-semibold truncate">{citation.file_name}</p>
            </div>
            <p className="mt-1 text-[10px] text-gray-600 truncate">
              {citation.document_type || 'Project document'}
              {citation.page_number ? ` · page ${citation.page_number}` : ''}
              {citation.section_title ? ` · ${citation.section_title}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {canPreviewCitation(citation) && (
              <button type="button" onClick={() => onPreview?.(citation)} className="h-6 w-6 rounded border border-white/[0.08] text-gray-500 hover:text-white flex items-center justify-center" title="Preview page">
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}
            <button type="button" onClick={() => onSave?.(citation)} className="h-6 w-6 rounded border border-white/[0.08] text-gray-500 hover:text-cyan-200 flex items-center justify-center" title="Save evidence">
              <Bookmark className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-gray-600 tabular-nums">score {citation.score}</span>
          </div>
        </div>
        {!!citation.matched_terms?.length && (
          <div className="mt-2 flex flex-wrap gap-1">
            {citation.matched_terms.slice(0, 8).map(term => (
              <button
                type="button"
                key={term}
                onClick={() => onUseQuestion?.(`Find project requirements related to ${term}.`)}
                className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[9px] text-cyan-200 hover:bg-cyan-400/20"
              >
                {term}
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400 whitespace-pre-wrap">{citation.excerpt}</p>
      </div>
    </div>
  </div>
);

const ProjectKnowledgePage: React.FC = () => {
  const { project } = useProject();
  const projectId = useMemo(() => projectIdFromProject(project as unknown as Record<string, unknown>), [project]);
  const [folderPath, setFolderPath] = useState(DEFAULT_LEARNING_FOLDER);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [docStats, setDocStats] = useState({ total: 0, chunks: 0 });
  const [indexing, setIndexing] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [indexResult, setIndexResult] = useState<IndexFolderResult | null>(null);
  const [question, setQuestion] = useState('What project standards or requirements are mentioned for P&ID and instrumentation?');
  const [chatResult, setChatResult] = useState<KnowledgeChatResult | null>(null);
  const [searchResults, setSearchResults] = useState<KnowledgeCitation[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [useModel, setUseModel] = useState(true);
  const [documentType, setDocumentType] = useState('');
  const [savedEvidence, setSavedEvidence] = useState<SavedEvidenceItem[]>([]);
  const [activePreview, setActivePreview] = useState<KnowledgeCitation | null>(null);

  const loadDocuments = async () => {
    setLoadingDocs(true);
    try {
      const res = await ProjectKnowledgeService.listDocuments(projectId);
      setDocuments(res.documents);
      setDocStats({ total: res.total, chunks: res.chunks });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not load knowledge documents.');
    } finally {
      setLoadingDocs(false);
    }
  };

  const loadSavedEvidence = async () => {
    try {
      const res = await ProjectKnowledgeService.listSavedEvidence(projectId);
      setSavedEvidence(res.items);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not load saved evidence.');
    }
  };

  useEffect(() => {
    void loadDocuments();
    void loadSavedEvidence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const indexFolder = async (force = false) => {
    if (!folderPath.trim()) return;
    setIndexing(true);
    setError('');
    setIndexResult(null);
    try {
      const res = await ProjectKnowledgeService.indexFolder({
        project_id: projectId,
        folder_path: folderPath.trim(),
        force,
        limit: 500,
      });
      setIndexResult(res);
      await loadDocuments();
    } catch (exc: any) {
      setError(exc?.response?.data?.detail || exc?.message || 'Indexing failed.');
    } finally {
      setIndexing(false);
    }
  };

  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true);
    setError('');
    try {
      const res = await ProjectKnowledgeService.chat({
        project_id: projectId,
        question: question.trim(),
        limit: 10,
        use_model: useModel,
      });
      setChatResult(res);
      setSearchResults(res.citations);
    } catch (exc: any) {
      setError(exc?.response?.data?.detail || exc?.message || 'Project Knowledge query failed.');
    } finally {
      setAsking(false);
    }
  };

  const saveCitation = async (citation: KnowledgeCitation) => {
    try {
      await ProjectKnowledgeService.saveEvidence({
        project_id: projectId,
        citation,
        question: chatResult?.question || question,
      });
      await loadSavedEvidence();
    } catch (exc: any) {
      setError(exc?.response?.data?.detail || exc?.message || 'Could not save evidence.');
    }
  };

  const removeSavedEvidence = async (savedId: string) => {
    try {
      await ProjectKnowledgeService.deleteSavedEvidence(projectId, savedId);
      setSavedEvidence(items => items.filter(item => item.id !== savedId));
    } catch (exc: any) {
      setError(exc?.response?.data?.detail || exc?.message || 'Could not remove saved evidence.');
    }
  };

  const exportAnswer = () => {
    if (!chatResult) return;
    const lines = [
      `# XYRA Project Knowledge Answer`,
      ``,
      `## Question`,
      chatResult.question,
      ``,
      `## Answer`,
      chatResult.answer,
      ``,
      `## Citations`,
      ...chatResult.citations.map((citation, index) => {
        const page = citation.page_number ? ` page ${citation.page_number}` : '';
        return `${index + 1}. ${citation.file_name}${page} - ${citation.excerpt.replace(/\s+/g, ' ').slice(0, 500)}`;
      }),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `xyra-project-knowledge-${Date.now()}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const quickQuestions = [
    'Summarize project scope and important engineering requirements.',
    'What standards, specifications, or client requirements are mentioned?',
    'Find references to P&ID symbols, instrumentation, alarms, or shutdown logic.',
    'What documents mention line list, piping class, valves, or MTO requirements?',
    'List open gaps or missing information before engineering deliverables are issued.',
    'Which cited pages should I verify first and why?',
  ];

  const documentTypes = useMemo(() => {
    const values = new Set(documents.map(doc => doc.document_type).filter(Boolean) as string[]);
    return Array.from(values).sort();
  }, [documents]);

  return (
    <div className="h-full min-h-0 bg-[#0b0b0d] text-gray-200 overflow-hidden flex flex-col">
      <div className="shrink-0 border-b border-white/[0.06] bg-[#101013] px-5 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-cyan-300" />
              <h1 className="text-sm font-bold text-white">Project Knowledge</h1>
              <span className="rounded border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-200">offline RAG</span>
            </div>
            <p className="mt-1 text-[11px] text-gray-600 truncate">Index SOW, specs, standards, datasheets, registers, and P&IDs locally with citations.</p>
          </div>
          <div className="grid grid-cols-4 gap-2 text-right">
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <p className="text-[9px] uppercase text-gray-600">Documents</p>
              <p className="text-sm font-bold tabular-nums text-white">{docStats.total}</p>
            </div>
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <p className="text-[9px] uppercase text-gray-600">Chunks</p>
              <p className="text-sm font-bold tabular-nums text-white">{docStats.chunks}</p>
            </div>
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <p className="text-[9px] uppercase text-gray-600">Saved</p>
              <p className="text-sm font-bold tabular-nums text-white">{savedEvidence.length}</p>
            </div>
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <p className="text-[9px] uppercase text-gray-600">Project</p>
              <p className="text-sm font-bold tabular-nums text-white truncate max-w-24">{projectId}</p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-3 rounded border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[360px_minmax(0,1fr)_420px] gap-0 overflow-hidden">
        <section className="min-h-0 border-r border-white/[0.06] flex flex-col">
          <div className="p-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 mb-2">
              <FolderOpen className="w-4 h-4 text-gray-500" />
              <p className="text-xs font-semibold text-gray-300">Project folder</p>
            </div>
            <textarea
              value={folderPath}
              onChange={e => setFolderPath(e.target.value)}
              rows={4}
              className="w-full resize-none rounded border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs text-gray-200 outline-none focus:border-cyan-400/35"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => indexFolder(false)}
                disabled={indexing}
                className="h-8 rounded bg-white text-gray-950 hover:bg-gray-200 disabled:opacity-40 text-xs font-bold transition-colors"
              >
                {indexing ? 'Indexing...' : 'Index Folder'}
              </button>
              <button
                onClick={() => indexFolder(true)}
                disabled={indexing}
                className="h-8 rounded border border-white/[0.1] text-gray-400 hover:text-white hover:border-white/25 disabled:opacity-40 text-xs transition-colors"
              >
                Force Reindex
              </button>
            </div>
            {indexResult && (
              <div className="mt-3 rounded border border-emerald-400/20 bg-emerald-500/10 p-2 text-[11px] text-emerald-100">
                Indexed {indexResult.indexed}, skipped {indexResult.skipped}, chunks {indexResult.chunks}, failed {indexResult.failed}
              </div>
            )}
          </div>

          <div className="px-4 py-2 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-gray-500" />
              <p className="text-xs font-semibold text-gray-300">Document register</p>
            </div>
            <button onClick={loadDocuments} disabled={loadingDocs} className="h-7 w-7 flex items-center justify-center rounded border border-white/[0.08] text-gray-500 hover:text-white">
              <RefreshCw className={`w-3.5 h-3.5 ${loadingDocs ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-3 space-y-2 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.35)_transparent]">
            {documents.length === 0 ? (
              <div className="rounded border border-white/[0.06] bg-white/[0.025] p-4 text-center">
                <FileText className="w-5 h-5 text-gray-700 mx-auto mb-2" />
                <p className="text-xs text-gray-600">No project knowledge indexed yet.</p>
              </div>
            ) : documents.map(doc => (
              <div key={doc.id} className="rounded border border-white/[0.07] bg-white/[0.025] p-3">
                <div className="flex items-start gap-2">
                  {doc.extension === '.pdf' ? (
                    <div className="h-14 w-11 overflow-hidden rounded border border-white/[0.08] bg-white/[0.03] shrink-0">
                      <img
                        src={ProjectKnowledgeService.pageImageUrl(projectId, doc.id, 1, 0.22)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover object-top opacity-75"
                      />
                    </div>
                  ) : (
                    <div className="h-14 w-11 rounded border border-white/[0.08] bg-white/[0.03] flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-gray-500" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-200 font-semibold truncate" title={doc.file_path}>{doc.file_name}</p>
                    <p className="mt-1 text-[10px] text-gray-600 truncate">{doc.document_type} · {doc.extension} · {fmtSize(doc.file_size_bytes)}</p>
                    <div className="mt-2 flex items-center gap-2 text-[10px]">
                      <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-gray-500">{doc.chunk_count || 0} chunks</span>
                      <span className={`rounded px-1.5 py-0.5 ${doc.status === 'indexed' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{doc.status}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="min-h-0 flex flex-col">
          <div className="p-4 border-b border-white/[0.06]">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-cyan-300" />
                <p className="text-xs font-semibold text-gray-300">Ask project documents</p>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-gray-500 cursor-pointer select-none">
                <input type="checkbox" checked={useModel} onChange={e => setUseModel(e.target.checked)} className="accent-cyan-300" />
                local model answer
              </label>
            </div>
            <div className="flex gap-2">
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask();
                }}
                rows={3}
                className="min-w-0 flex-1 resize-none rounded border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400/35"
              />
              <button
                onClick={ask}
                disabled={asking || !question.trim()}
                className="w-12 rounded bg-cyan-300 text-gray-950 hover:bg-cyan-200 disabled:opacity-40 flex items-center justify-center transition-colors"
                title="Ask"
              >
                {asking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {quickQuestions.map(q => (
                <button
                  key={q}
                  onClick={() => setQuestion(q)}
                  className="rounded border border-white/[0.08] px-2 py-1 text-[10px] text-gray-500 hover:text-gray-200 hover:border-white/20 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto p-5 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.35)_transparent]">
            {!chatResult ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-md">
                  <Sparkles className="w-8 h-8 text-cyan-300 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-white">Project-aware answers with citations</p>
                  <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                    Index today’s test folder, then ask about project scope, standards, instrumentation requirements, or piping/MTO references.
                  </p>
                </div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto space-y-4">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-5">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <p className="text-xs text-gray-500">Question</p>
                    <span className="text-[10px] text-gray-600">{chatResult.model_status.model} · {chatResult.model_status.status}</span>
                  </div>
                  <p className="text-sm text-gray-200">{chatResult.question}</p>
                </div>
                <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.035] p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <WandSparkles className="w-3.5 h-3.5 text-cyan-200" />
                      <p className="text-xs text-cyan-200 font-semibold">Answer</p>
                    </div>
                    <button
                      onClick={exportAnswer}
                      className="h-7 rounded border border-cyan-300/20 px-2 text-[10px] text-cyan-100 hover:bg-cyan-300/10 flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Export
                    </button>
                  </div>
                  <p className="text-sm leading-relaxed text-gray-100 whitespace-pre-wrap">{chatResult.answer}</p>
                </div>
                {!!chatResult.follow_up_questions?.length && (
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                    <p className="text-xs font-semibold text-gray-400 mb-2">Useful next questions</p>
                    <div className="flex flex-wrap gap-2">
                      {chatResult.follow_up_questions.slice(0, 6).map(item => (
                        <button
                          key={item}
                          onClick={() => setQuestion(item)}
                          className="rounded border border-white/[0.08] px-2 py-1 text-[11px] text-gray-400 hover:border-cyan-300/35 hover:text-cyan-100"
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-gray-400 mb-2">Citations</p>
                  <div className="space-y-2">
                    {chatResult.citations.map((citation, index) => (
                      <CitationCard
                        key={citation.chunk_id || index}
                        citation={citation}
                        index={index}
                        projectId={projectId}
                        onUseQuestion={setQuestion}
                        onSave={saveCitation}
                        onPreview={setActivePreview}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="min-h-0 border-l border-white/[0.06] flex flex-col">
          <div className="p-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 mb-2">
              <Search className="w-4 h-4 text-gray-500" />
              <p className="text-xs font-semibold text-gray-300">Search evidence</p>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-gray-600" />
              <select
                value={documentType}
                onChange={e => setDocumentType(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded border border-white/[0.08] bg-white/[0.04] px-2 text-xs text-gray-300 outline-none focus:border-cyan-400/35"
              >
                <option value="">All document types</option>
                {documentTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <button
              onClick={async () => {
                if (!question.trim()) return;
                const res = await ProjectKnowledgeService.search({ project_id: projectId, query: question, limit: 12, document_type: documentType });
                setSearchResults(res.results);
              }}
              className="h-8 w-full rounded border border-white/[0.08] text-xs text-gray-400 hover:text-white hover:border-white/20 transition-colors"
            >
              Search Current Question
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-3 space-y-2 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.35)_transparent]">
            <div className="rounded border border-white/[0.07] bg-white/[0.025] p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <Bookmark className="w-3.5 h-3.5 text-cyan-300" />
                  <p className="text-xs font-semibold text-gray-300">Saved evidence</p>
                </div>
                <span className="text-[10px] text-gray-600">{savedEvidence.length}</span>
              </div>
              {savedEvidence.length === 0 ? (
                <p className="text-[11px] text-gray-700">Save citations here while reviewing project docs.</p>
              ) : (
                <div className="space-y-2">
                  {savedEvidence.slice(0, 8).map((item, index) => {
                    const citation = item.citation_snapshot;
                    return (
                      <div key={item.id} className="rounded border border-white/[0.06] bg-black/20 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setActivePreview(citation)}
                            className="min-w-0 text-left"
                          >
                            <p className="truncate text-[11px] font-semibold text-gray-300">{index + 1}. {citation.file_name}</p>
                            <p className="mt-0.5 text-[10px] text-gray-600">{citation.page_number ? `page ${citation.page_number}` : citation.document_type}</p>
                          </button>
                          <button onClick={() => removeSavedEvidence(item.id)} className="h-6 w-6 rounded text-gray-600 hover:text-red-300 flex items-center justify-center">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {searchResults.length === 0 ? (
              <div className="text-center mt-8">
                <ImageIcon className="w-5 h-5 mx-auto text-gray-700 mb-2" />
                <p className="text-xs text-gray-700">No search evidence yet.</p>
              </div>
            ) : searchResults.map((citation, index) => (
              <CitationCard
                key={`${citation.chunk_id}-${index}`}
                citation={citation}
                index={index}
                projectId={projectId}
                onUseQuestion={setQuestion}
                onSave={saveCitation}
                onPreview={setActivePreview}
              />
            ))}
          </div>
        </aside>
      </div>
      {activePreview && canPreviewCitation(activePreview) && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="max-h-full w-full max-w-5xl overflow-hidden rounded border border-white/[0.12] bg-[#0b0b0d] shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{activePreview.file_name}</p>
                <p className="text-[11px] text-gray-500">Page {activePreview.page_number} · {activePreview.document_type}</p>
              </div>
              <button onClick={() => setActivePreview(null)} className="h-8 w-8 rounded border border-white/[0.08] text-gray-400 hover:text-white flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[78vh] overflow-auto bg-black p-4">
              <img
                src={ProjectKnowledgeService.pageImageUrl(projectId, activePreview.document_id, activePreview.page_number || 1, 1.2)}
                alt=""
                className="mx-auto max-w-full rounded border border-white/[0.08]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectKnowledgePage;
