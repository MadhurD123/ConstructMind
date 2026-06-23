import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, 
  Download, 
  RefreshCw, 
  ShieldAlert, 
  CheckCircle, 
  Calendar, 
  Clock, 
  Database, 
  Layout, 
  ExternalLink,
  ChevronRight,
  Sparkles,
  Search,
  Eye
} from 'lucide-react';
import { collection, doc, getDoc, getDocs, setDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

interface ReportMetadata {
  reportId: string;
  generatedAt: any; // Timestamp or ISO string
  reportUrl: string;
  reportSize: number;
  reportStatus: string;
  projectId: string;
  ownerId: string;
}

interface ReportsViewProps {
  project: {
    id: string;
    name: string;
    summary: any;
    uploadedAt: string;
  };
}

export function ReportsView({ project }: ReportsViewProps) {
  const [reports, setReports] = useState<ReportMetadata[]>([]);
  const [energyAnalysis, setEnergyAnalysis] = useState<any | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportMetadata | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load history from firestore and load cached energy analysis
  const loadReportHistory = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Load cached energy analysis if it exists, to pass to the report generator
      const eaRef = doc(db, 'projects', project.id, 'energyAnalysis', 'latest');
      const eaSnap = await getDoc(eaRef);
      if (eaSnap.exists()) {
        setEnergyAnalysis(eaSnap.data());
      }

      // 2. Load report history from Firestore subcollection
      const repColl = collection(db, 'projects', project.id, 'reports');
      const repSnap = await getDocs(repColl);
      
      const loaded: ReportMetadata[] = [];
      repSnap.forEach(docSnap => {
        loaded.push(docSnap.data() as ReportMetadata);
      });

      // Sort by generatedAt (safely handling string vs firestore timestamp)
      loaded.sort((a, b) => {
        const timeA = a.generatedAt?.seconds ? a.generatedAt.seconds * 1000 : new Date(a.generatedAt).getTime();
        const timeB = b.generatedAt?.seconds ? b.generatedAt.seconds * 1000 : new Date(b.generatedAt).getTime();
        return timeB - timeA;
      });

      setReports(loaded);
      if (loaded.length > 0) {
        setSelectedReport(loaded[0]);
      }
    } catch (err: any) {
      console.error("Error loading report metadata:", err);
      // Fallback is just an empty reports list
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReportHistory();
  }, [project.id]);

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      // Trigger API endpoint on server
      const resp = await fetch(`/api/projects/${project.id}/generate-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: project.name,
          energyAnalysis: energyAnalysis // pass cached analysis if exists, otherwise server generates inline
        })
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Server returned error ${resp.status}: ${txt}`);
      }

      const result = await resp.json();

      // Write metadata to Firestore subcollection /projects/{projectId}/reports/{reportId}
      const reportPayload: ReportMetadata = {
        reportId: result.reportId,
        generatedAt: new Date().toISOString(),
        reportUrl: result.reportUrl,
        reportSize: result.reportSize,
        reportStatus: result.reportStatus,
        projectId: project.id,
        ownerId: (window as any).currentUserUid || 'guest_owner'
      };

      try {
        const docRef = doc(db, 'projects', project.id, 'reports', result.reportId);
        await setDoc(docRef, reportPayload);
      } catch (dbErr) {
        console.warn("Could not save report metadata in firestore:", dbErr);
      }

      // Update state
      setReports(prev => [reportPayload, ...prev]);
      setSelectedReport(reportPayload);
    } catch (err: any) {
      console.error("Report generation failed:", err);
      setError(err?.message || "Failed to generate professional PDF audit report.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Helper to format byte sizes elegantly
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Helper to format timestamps
  const formatTimestamp = (gen: any) => {
    if (!gen) return 'N/A';
    if (gen?.seconds) {
      return new Date(gen.seconds * 1000).toLocaleString();
    }
    return new Date(gen).toLocaleString();
  };

  return (
    <div className="flex-1 flex flex-col xl:flex-row overflow-hidden bg-zinc-950 text-zinc-300">
      
      {/* Left side: Generator panel and History list */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 border-r border-zinc-850">
        
        {/* Title Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-850 pb-5">
          <div>
            <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest font-mono">BIM ENTERPRISE REPORTS PANEL</span>
            <h2 className="text-2xl font-bold text-white mt-1">Audit Report Center</h2>
          </div>
          <button
            onClick={loadReportHistory}
            className="p-2.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl border border-zinc-800 transition-all cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Generate Card Section */}
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-orange-500/10 p-6 rounded-3xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <FileText className="w-40 h-40 text-orange-500" />
          </div>

          <div className="max-w-xl">
            <span className="text-[9px] px-2.5 py-1 bg-orange-950/40 text-orange-400 border border-orange-900/30 rounded-full font-black tracking-wider uppercase font-mono">
              AI Powered Compilation
            </span>
            <h3 className="text-lg font-bold text-white mt-3">Generate Technical BIM Audit Report</h3>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              Compile full building geometries, mapped levels elevations, parsed quantity takeoffs, thermal heating/cooling load calculations, and energy ratings into an enterprise-grade engineering PDF report complete with certifications.
            </p>

            {error && (
              <div className="bg-red-950/40 border border-red-900/30 p-3.5 rounded-2xl mt-4 text-xs text-red-300 flex items-start gap-2 leading-relaxed">
                <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">Generation Stopped:</strong> {error}
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={handleGenerateReport}
                disabled={isGenerating}
                className="px-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-800 text-white disabled:text-zinc-500 rounded-xl text-xs font-black tracking-wider uppercase flex items-center gap-2.5 transition-all shadow-lg shadow-orange-500/15 cursor-pointer disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    COMPILING DRAFT...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    COMPILE TECHNICAL REPORT
                  </>
                )}
              </button>
              
              {isGenerating && (
                <span className="text-[10px] text-zinc-400 font-mono animate-pulse">
                  Assembling quantity inventory & calling Gemini AI consultant...
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Reports History */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-sm text-zinc-200">Generated Reports History</h4>
            <span className="text-[10px] bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full text-zinc-400 font-bold">
              {reports.length} Reports
            </span>
          </div>

          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center border border-zinc-850 rounded-3xl bg-zinc-900/20 text-zinc-500 text-xs">
              <RefreshCw className="w-6 h-6 animate-spin text-orange-500 mb-2" />
              Loading history table...
            </div>
          ) : reports.length === 0 ? (
            <div className="py-16 text-center border border-dashed border-zinc-800 rounded-3xl bg-zinc-900/10 max-w-md mx-auto space-y-3">
              <FileText className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="font-bold text-zinc-400 text-xs uppercase tracking-wider font-mono">No reports compiled yet</p>
              <p className="text-[11px] text-zinc-500 max-w-xs mx-auto leading-relaxed">
                Use the compile engine above to generate and certify your first comprehensive building report.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-zinc-850 rounded-2xl bg-zinc-900/30">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-900 text-[10px] font-black text-zinc-400 uppercase tracking-wider font-mono border-b border-zinc-850">
                    <th className="py-3 px-4">Document Title</th>
                    <th className="py-3 px-4">Date Issued</th>
                    <th className="py-3 px-4">File Size</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850/60 text-xs">
                  {reports.map((rep) => {
                    const isSelected = selectedReport?.reportId === rep.reportId;
                    return (
                      <tr 
                        key={rep.reportId}
                        onClick={() => setSelectedReport(rep)}
                        className={`hover:bg-zinc-850/30 transition-colors cursor-pointer ${isSelected ? 'bg-zinc-850/20 font-medium' : ''}`}
                      >
                        <td className="py-3 px-4 flex items-center gap-2 text-zinc-100">
                          <FileText className="w-4 h-4 text-orange-500" />
                          <span className="truncate max-w-[180px] md:max-w-xs">BIM_Technical_Performance_{rep.reportId.slice(0, 6)}</span>
                        </td>
                        <td className="py-3 px-4 text-zinc-400 font-mono text-[10px]">
                          {formatTimestamp(rep.generatedAt)}
                        </td>
                        <td className="py-3 px-4 text-zinc-400 font-mono text-[10px]">
                          {formatBytes(rep.reportSize)}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 rounded-md font-bold text-[9px] uppercase font-mono">
                            {rep.reportStatus}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <a
                              href={`/api/projects/${project.id}/report`}
                              download
                              className="p-1.5 bg-zinc-800 hover:bg-orange-500 text-zinc-300 hover:text-white rounded-lg border border-zinc-700/60 transition-all"
                              title="Download Report PDF"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                            <button
                              onClick={() => setSelectedReport(rep)}
                              className="p-1.5 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 rounded-lg border border-zinc-700/60 transition-all"
                              title="Preview Report Details"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Right side: Report Preview / Dashboard Widget */}
      <div className="w-full xl:w-[400px] bg-zinc-900/60 p-6 md:p-8 flex flex-col justify-between shrink-0 overflow-y-auto max-h-screen xl:max-h-[calc(100vh-73px)] border-t xl:border-t-0 border-zinc-850">
        <AnimatePresence mode="wait">
          {selectedReport ? (
            <motion.div
              key={selectedReport.reportId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 flex-1 flex flex-col justify-between"
            >
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-orange-950/40 text-orange-400 rounded-2xl border border-orange-900/20">
                    <Layout className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-black text-orange-500 uppercase tracking-widest font-mono">DOCUMENT PREVIEW</span>
                    <h3 className="font-bold text-white text-sm">Report Specifications</h3>
                  </div>
                </div>

                {/* Mock Visual representation of PDF Cover page */}
                <div className="border border-zinc-800 rounded-3xl p-5 bg-zinc-950 shadow-inner relative overflow-hidden flex flex-col justify-between aspect-[3/4] max-w-sm mx-auto">
                  {/* Accent bar */}
                  <div className="absolute left-0 top-0 bottom-0 w-2.5 bg-orange-500"></div>

                  <div className="pl-3 space-y-1">
                    <span className="text-[7px] font-bold text-zinc-500 font-mono uppercase tracking-widest block">ConstructMind AI</span>
                    <h5 className="text-[11px] font-extrabold text-white leading-tight">BIM Performance Audit</h5>
                    <p className="text-[8px] text-zinc-400 font-medium">Project: {project.name}</p>
                  </div>

                  <div className="pl-3 my-6 space-y-1 border-l border-zinc-800">
                    <span className="text-[6px] font-bold text-orange-400 uppercase tracking-widest font-mono">AUDIT SCOPE</span>
                    <ul className="text-[6px] text-zinc-500 space-y-0.5 list-disc pl-2.5">
                      <li>BIM geometrical takeoffs</li>
                      <li>Storey elevations maps</li>
                      <li>Peak heating/cooling loads</li>
                      <li>AI sustainability optimization</li>
                    </ul>
                  </div>

                  <div className="pl-3 border-t border-zinc-900 pt-3 flex items-center justify-between">
                    <div>
                      <span className="text-[5px] text-zinc-500 uppercase font-mono block">DATE ISSUED</span>
                      <span className="text-[6px] text-zinc-400 font-medium">{formatTimestamp(selectedReport.generatedAt).split(',')[0]}</span>
                    </div>
                    <div className="px-1.5 py-0.5 bg-green-950/20 text-green-400 border border-green-900/40 rounded text-[5px] font-bold font-mono">
                      CMAI CERTIFIED
                    </div>
                  </div>
                </div>

                {/* Details list */}
                <div className="bg-zinc-950/40 border border-zinc-850/80 rounded-2xl p-4 text-xs space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-zinc-850/60">
                    <span className="text-zinc-500">ID Reference:</span>
                    <span className="font-mono text-zinc-300 font-bold">{selectedReport.reportId.slice(0, 12)}...</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-zinc-850/60">
                    <span className="text-zinc-500">Document Size:</span>
                    <span className="text-zinc-300">{formatBytes(selectedReport.reportSize)}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-zinc-850/60">
                    <span className="text-zinc-500">Compiled On:</span>
                    <span className="text-zinc-400">{formatTimestamp(selectedReport.generatedAt)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500">Format:</span>
                    <span className="text-zinc-300 font-bold flex items-center gap-1">PDF Document <ExternalLink className="w-3 h-3 text-orange-400" /></span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-zinc-850/60 mt-6">
                <a
                  href={`/api/projects/${project.id}/report`}
                  download
                  className="w-full py-3.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-black tracking-wider uppercase flex items-center justify-center gap-2 transition-all shadow-lg shadow-orange-500/15 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  DOWNLOAD PDF REPORT
                </a>
              </div>
            </motion.div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-3 py-12 text-zinc-500">
              <FileText className="w-12 h-12 text-zinc-750" />
              <p className="font-bold text-xs uppercase tracking-widest font-mono">No Report Selected</p>
              <p className="text-[11px] text-zinc-600 max-w-xs">
                Select any compiled report from the history table to view spec details, preview pages, or download files.
              </p>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
