/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo, Component } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser,
  signInWithRedirect,
  getRedirectResult
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc,
  collection, 
  query, 
  where, 
  onSnapshot,
  serverTimestamp,
  getDocFromServer,
  deleteDoc
} from 'firebase/firestore';
import { db, auth, testConnection } from './firebase';
import firebaseConfig from '../firebase-applet-config.json';
import { 
  Building2, 
  Upload, 
  MessageSquare, 
  LayoutDashboard, 
  Settings, 
  FileText, 
  Send,
  Loader2,
  Menu,
  X,
  ChevronRight,
  Info,
  Clock,
  Layers,
  Compass,
  Maximize2,
  RefreshCw,
  Eye,
  Crosshair,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { EnergyAnalysisView } from './components/EnergyAnalysisView';
import { ReportsView } from './components/ReportsView';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Stars, Center, Html } from '@react-three/drei';
import { IFCLoader } from 'web-ifc-three';
import * as THREE from 'three';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Safe global overrides for iframe environments to prevent sandbox crashes
if (typeof window !== 'undefined') {
  try {
    window.alert = function(message) {
      console.warn("Blocked native alert() inside sandboxed iframe:", message);
    };
    window.confirm = function(message) {
      console.warn("Blocked native confirm() inside sandboxed iframe:", message);
      return true;
    };
    window.prompt = function(message) {
      console.warn("Blocked native prompt() inside sandboxed iframe:", message);
      return null;
    };
  } catch (e) {
    console.warn("Failed to set window global overrides:", e);
  }
}



enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous
    },
    operationType,
    path
  };
  console.error('[Firestore Error Details]: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Types ---
interface Project {
  id: string;
  name: string;
  uploadedAt: string;
  summary: {
    metadata: any;
    structure: { floors: any[] };
    elements: { 
      total: number; 
      types: Record<string, number>;
      details?: any[];
    };
  };
}

interface ChatMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

// --- Components ---

const isCookieCheckHtml = (text: string): boolean => {
  return typeof text === 'string' && (
    text.includes('Cookie check') || 
    text.includes('aistudio_auth_flow_may_set_cookies') || 
    text.includes('Authenticate in new window') ||
    text.includes('Action required to load your app')
  );
};

export default function App() {
  const [currentPage, setCurrentPage] = useState<'landing' | 'dashboard' | 'project'>('landing');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cookieCheckFailed, setCookieCheckFailed] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);

  // Set up Firebase Auth listener
  useEffect(() => {
    testConnection();
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      
      if (currentUser) {
        // Automatically save/update user credentials in Firestore on first sign in
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userDocRef);
          if (!userSnap.exists()) {
            await setDoc(userDocRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName || 'Anonymous User',
              createdAt: serverTimestamp()
            });
          }
        } catch (err) {
          console.error("Failed to persist user credentials:", err);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen to the user's projects real-time in Firestore if authenticated
  useEffect(() => {
    if (!user) {
      setProjects([]);
      return;
    }

    const q = query(collection(db, 'projects'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded: Project[] = [];
      snapshot.forEach((docSnap) => {
        const item = docSnap.data();
        loaded.push({
          id: docSnap.id,
          name: item.name,
          uploadedAt: item.uploadedAt?.toDate?.()?.toISOString() || item.uploadedAt || new Date().toISOString(),
          summary: item.summary
        } as Project);
      });
      setProjects(loaded);
    }, (error) => {
      // Gracefully handle permission errors
      try {
        handleFirestoreError(error, OperationType.LIST, 'projects');
      } catch (e) {
        console.error("Projects watch rejected or forbidden:", e);
      }
    });

    return () => unsubscribe();
  }, [user]);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const [authError, setAuthError] = useState<string | null>(null);
  const [showAuthErrorModal, setShowAuthErrorModal] = useState(false);

  // Handle redirect result on component mount/load
  useEffect(() => {
    // Skip if running inside an iframe, as getRedirectResult is not supported and throws security errors
    let isInIframe = false;
    try {
      isInIframe = window.self !== window.top;
    } catch (e) {
      isInIframe = true;
    }
    
    if (isInIframe) {
      console.log("Running inside iframe, skipping getRedirectResult.");
      return;
    }

    try {
      getRedirectResult(auth)
        .then((result) => {
          if (result?.user) {
            console.log("Successful redirect login: ", result.user);
            setCurrentPage('dashboard');
          }
        })
        .catch((err) => {
          console.error("Error retrieving redirect result:", err);
          setAuthError(err.message || String(err));
          setShowAuthErrorModal(true);
        });
    } catch (err: any) {
      console.error("Synchronous error during getRedirectResult:", err);
    }
  }, []);

  // Authentication actions
  const handleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
      setCurrentPage('dashboard');
    } catch (err: any) {
      console.error("Sign-in popup error details:", err);
      // If the user cancelled or another popup request was cancelled, we don't need to show a huge info modal.
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        return;
      }
      setAuthError(err.message || String(err));
      setShowAuthErrorModal(true);
    }
  };

  const handleSignInRedirect = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithRedirect(auth, provider);
    } catch (err: any) {
      console.error("Sign-in redirect error details:", err);
      setAuthError(err.message || String(err));
      setShowAuthErrorModal(true);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setCurrentPage('landing');
      setSelectedProjectId(null);
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    setDeletionError(null);
    try {
      // 1. Delete document from Firestore
      const projectDocRef = doc(db, 'projects', projectId);
      await deleteDoc(projectDocRef);
      
      // 2. Unset active project selection if that project was deleted
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
      }
      
      // 3. Request server to clean up static IFC files
      try {
        await fetch(`/api/projects/${projectId}`, {
          method: 'DELETE'
        });
      } catch (err) {
        console.error("Failed to delete IFC file from backend disk:", err);
      }
    } catch (err: any) {
      console.error("Failed to delete project document from firestore:", err);
      let errorText = err.message || String(err);
      try {
        handleFirestoreError(err, OperationType.DELETE, `projects/${projectId}`);
      } catch (fError: any) {
        errorText = fError.message;
      }
      setDeletionError(errorText);
      throw err;
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950">
        <Loader2 className="w-10 h-10 animate-spin text-[var(--accent)]" />
        <span className="text-sm font-bold text-zinc-500 mt-4 uppercase tracking-widest font-mono">ConstructMind loader...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 selection:bg-orange-500 selection:text-white">
      <Navbar 
        onNavigate={setCurrentPage} 
        user={user} 
        onSignIn={handleSignIn} 
        onSignOut={handleSignOut} 
      />
      
      <main className="flex-1 flex flex-col">
        {currentPage === 'landing' && (
          <LandingPage 
            onGetStarted={() => {
              if (user) {
                setCurrentPage('dashboard');
              } else {
                handleSignIn();
              }
            }} 
            user={user}
          />
        )}
        {currentPage === 'dashboard' && (
          <Dashboard 
            projects={projects} 
            onProjectAdded={(p) => {
              setSelectedProjectId(p.id);
              setCurrentPage('project');
            }} 
            onSelectProject={(id) => {
              setSelectedProjectId(id);
              setCurrentPage('project');
            }}
            onDeleteProject={(p) => setProjectToDelete(p)}
            setCookieCheckFailed={setCookieCheckFailed}
          />
        )}
        {currentPage === 'project' && selectedProject && (
          <ProjectView 
            project={selectedProject} 
            onBack={() => setCurrentPage('dashboard')} 
            setCookieCheckFailed={setCookieCheckFailed} 
          />
        )}
      </main>

      {/* Custom Delete Confirmation Modal */}
      <AnimatePresence>
        {projectToDelete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[99999] flex items-center justify-center p-4 text-left"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-2xl relative overflow-hidden text-zinc-100"
            >
              <div className="flex items-start gap-4 mb-6">
                <div className="bg-red-950/50 border border-red-900/30 p-3 rounded-2xl text-red-400 shrink-0">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="font-sans font-black text-white text-lg leading-snug">
                    Delete Project?
                  </h3>
                  <p className="text-zinc-400 text-xs mt-1 leading-relaxed">
                    Are you sure you want to permanently delete <strong className="text-zinc-200">{projectToDelete.name}</strong>?
                  </p>
                </div>
              </div>

              <div className="bg-zinc-950/80 border border-zinc-850 rounded-2xl p-4 mb-6 text-xs text-zinc-400 space-y-2">
                <p className="font-semibold text-zinc-300">This action is irreversible and will delete:</p>
                <ul className="list-disc pl-4 space-y-1 text-zinc-400">
                  <li>The uploaded 3D BIM IFC model file</li>
                  <li>All stored project structures and floor levels</li>
                  <li>All associated AI conversation histories</li>
                </ul>
              </div>

              {deletionError && (
                <div className="bg-red-950/40 border border-red-900/40 p-3 rounded-2xl mb-6 text-[11px] text-red-300 font-mono leading-relaxed max-h-28 overflow-y-auto whitespace-pre-wrap">
                  Failed to delete: {deletionError}
                </div>
              )}

              <div className="flex items-center gap-3 justify-end border-t border-zinc-800/60 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setProjectToDelete(null);
                    setDeletionError(null);
                  }}
                  disabled={isDeleting}
                  className="px-4 py-2.5 rounded-xl bg-zinc-850 hover:bg-zinc-800 text-zinc-300 hover:text-white font-semibold text-xs transition-all cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setIsDeleting(true);
                    try {
                      await handleDeleteProject(projectToDelete.id);
                      setProjectToDelete(null);
                    } catch (err) {
                      console.error("Delete operation failed in handler:", err);
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                  disabled={isDeleting}
                  className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-red-950/30 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Delete Permanently
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Troubleshooting and Redirect Fallback Modal */}
      <AnimatePresence>
        {showAuthErrorModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[9999] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl relative overflow-hidden border border-gray-100"
            >
              <div className="flex items-start gap-4">
                <div className="bg-amber-100 p-3 rounded-full text-amber-600 shrink-0">
                  <Info className="w-6 h-6 animate-pulse" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-gray-900 text-lg leading-snug">
                    Google Sign-In Help & Troubleshooting
                  </h3>
                  <p className="text-gray-500 text-xs mt-1 mb-4 leading-relaxed">
                    Firebase Authentication handles popup authentication securely, but browser blocks or local environment restrictions can prevent popups from opening.
                  </p>

                  {/* Raw Error Details */}
                  {authError && (
                    <div className="mb-4">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1">Raw Error Message:</span>
                      <div className="bg-red-50 text-red-700 text-xs font-mono p-3 rounded-lg border border-red-100 whitespace-pre-wrap max-h-28 overflow-y-auto">
                        {authError}
                      </div>
                    </div>
                  )}

                  {/* Actionable Checklist */}
                  <div className="space-y-3 mb-6">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">Localhost Debug Checklist:</span>
                    
                    <div className="flex items-start gap-2.5 text-sm">
                      <div className="bg-[#121316] text-white w-5 h-5 rounded-full flex items-center justify-center text-xs font-mono shrink-0 mt-0.5">1</div>
                      <div>
                        <strong className="text-gray-800 font-medium">Bypass with Redirect (Easiest)</strong>
                        <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">Click the button below to sign in using full-page redirection instead of a popup window. This completely bypasses popup blockers!</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 text-sm">
                      <div className="bg-[#121316] text-white w-5 h-5 rounded-full flex items-center justify-center text-xs font-mono shrink-0 mt-0.5">2</div>
                      <div>
                        <strong className="text-gray-800 font-medium">Enable Browser Popups</strong>
                        <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">Look at the right side of your browser address bar for a "Popup blocked" icon. Click it and choose "Always allow popups from localhost".</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 text-sm">
                      <div className="bg-[#121316] text-white w-5 h-5 rounded-full flex items-center justify-center text-xs font-mono shrink-0 mt-0.5">3</div>
                      <div>
                        <strong className="text-gray-800 font-medium">Add Localhost as Authorized Domain</strong>
                        <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">In your Firebase Console, navigate to <strong className="text-gray-700">Authentication &gt; Settings &gt; Authorized domains</strong> and ensure <code className="bg-gray-100 text-gray-800 px-1 rounded font-mono text-xs">localhost</code> is listed.</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 text-sm">
                      <div className="bg-[#121316] text-white w-5 h-5 rounded-full flex items-center justify-center text-xs font-mono shrink-0 mt-0.5">4</div>
                      <div>
                        <strong className="text-gray-800 font-medium">Enable Google Provider</strong>
                        <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">Confirm Google is enabled as a Provider under <strong className="text-gray-700">Authentication &gt; Sign-in method</strong> in your Firebase project.</p>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAuthErrorModal(false);
                        handleSignInRedirect();
                      }}
                      className="flex-1 bg-black text-white hover:opacity-90 py-2.5 px-4 rounded-xl font-bold text-xs inline-flex items-center justify-center gap-2 cursor-pointer transition-opacity"
                    >
                      Use Redirect Login
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAuthErrorModal(false)}
                      className="border border-gray-200 hover:bg-gray-50 text-gray-600 py-2.5 px-4 rounded-xl font-bold text-xs inline-flex items-center justify-center cursor-pointer transition-colors"
                    >
                      Dismiss / Retry Popup
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cookie / Sandbox Blocker Guidance Modal */}
      <AnimatePresence>
        {cookieCheckFailed && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-[99999] flex items-center justify-center p-4 text-left"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl relative overflow-hidden border border-amber-100"
            >
              {/* Top Amber Accented Info/Warning Badge */}
              <div className="flex items-start gap-4 mb-6">
                <div className="bg-amber-100 p-3 rounded-full text-amber-600 shrink-0">
                  <Upload className="w-6 h-6 animate-pulse" />
                </div>
                <div className="flex-1">
                  <h3 className="font-sans font-bold text-gray-900 text-base leading-snug">
                    Iframe Security Cookie Blocked
                  </h3>
                  <p className="text-gray-500 text-xs mt-1 leading-relaxed">
                    The AI Studio developmental preview relies on cookies to secure your backend uploads and dynamic chat channels.
                  </p>
                </div>
              </div>

              {/* Core issue details */}
              <div className="bg-amber-50/40 border border-amber-100 rounded-2xl p-4 mb-6">
                <h4 className="font-bold text-amber-800 text-[10px] uppercase tracking-wider mb-2">Why am I seeing this?</h4>
                <p className="text-gray-600 text-xs leading-relaxed mb-3">
                  Modern browsers (Safari, Firefox, Brave, Chrome Incognito) automatically block sandbox third-party cookies inside embedded iframes.
                </p>
                <h4 className="font-bold text-amber-800 text-[10px] uppercase tracking-wider mb-2">Instant Walkthrough:</h4>
                <ol className="list-decimal pl-4 text-gray-600 text-xs space-y-1">
                  <li>Click <strong>Open app in new tab</strong> below.</li>
                  <li>In the direct view window, click standard prompt authorization if requested.</li>
                  <li>Upload files and run conversations with zero cookie constraints!</li>
                </ol>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2">
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white py-3 px-4 rounded-xl font-bold text-xs inline-flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-lg shadow-amber-600/10 text-center"
                >
                  <Upload className="w-3.5 h-3.5" />
                  OPEN APP IN NEW TAB
                </a>
                <button
                  type="button"
                  onClick={() => setCookieCheckFailed(false)}
                  className="w-full border border-gray-200 hover:bg-gray-50 text-gray-600 py-2.5 px-4 rounded-xl font-bold text-xs inline-flex items-center justify-center cursor-pointer transition-colors"
                >
                  Dismiss / Standard CAD schematic
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Navbar({ 
  onNavigate, 
  user, 
  onSignIn, 
  onSignOut 
}: { 
  onNavigate: (page: 'landing' | 'dashboard') => void,
  user: FirebaseUser | null,
  onSignIn: () => void,
  onSignOut: () => void
}) {
  return (
    <nav className="bg-zinc-950/80 backdrop-blur-md border-b border-zinc-850 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => onNavigate('landing')}>
        <div className="bg-[var(--accent)] p-2 rounded-xl shadow-lg shadow-orange-500/20">
          <Building2 className="w-5 h-5 text-white animate-pulse" />
        </div>
        <span className="font-bold text-xl tracking-tight text-white bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">ConstructMind AI</span>
      </div>
      
      <div className="hidden md:flex items-center gap-8 text-sm font-bold">
        <button onClick={() => onNavigate('landing')} className="text-zinc-400 hover:text-[var(--accent)] transition-all cursor-pointer">How it works</button>
        {user && (
          <button onClick={() => onNavigate('dashboard')} className="text-zinc-400 hover:text-[var(--accent)] transition-all cursor-pointer">My Projects</button>
        )}
        {user ? (
          <div className="flex items-center gap-4">
            <span className="text-orange-200 font-bold bg-orange-950/40 px-3.5 py-1.5 rounded-xl border border-orange-900/40 max-w-[200px] truncate">{user.displayName || user.email}</span>
            <button 
              onClick={onSignOut}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-4 py-2 rounded-xl transition-all cursor-pointer text-xs font-bold border border-zinc-700"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <button 
            onClick={onSignIn}
            className="bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-xl shadow-orange-600/15 px-5 py-2.5 rounded-xl hover:opacity-90 active:scale-95 transition-all cursor-pointer text-xs font-bold"
          >
            Sign In with Google
          </button>
        )}
      </div>
    </nav>
  );
}

function LandingPage({ onGetStarted, user }: { onGetStarted: () => void, user: FirebaseUser | null }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 overflow-hidden py-24 relative bg-zinc-950">
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-4xl text-center space-y-8 relative z-10"
      >
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-orange-950/40 text-[var(--accent)] border border-orange-900/30 text-xs font-bold uppercase tracking-wider mb-2">
          <Building2 className="w-3.5 h-3.5 animate-pulse" />
          The Future of BIM Analysis
        </div>
        
        <h1 className="text-6xl md:text-8xl font-black tracking-tight leading-[0.85] text-zinc-50">
          YOUR BUILDING <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-amber-500">DEMANDS ANSWERS</span>
        </h1>
        
        <p className="text-xl text-zinc-400 max-w-2xl mx-auto font-medium leading-relaxed">
          Upload your IFC files and interact with your construction project in natural language. Powered by Gemini AI.
        </p>
        
        <div className="flex items-center justify-center gap-4 pt-4">
          <button 
            onClick={onGetStarted}
            className="group relative bg-white text-zinc-950 px-8 py-4 rounded-2xl text-lg font-black hover:bg-orange-500 hover:text-white hover:shadow-2xl hover:shadow-orange-500/20 active:scale-95 transition-all overflow-hidden cursor-pointer flex items-center gap-2.5"
          >
            {user ? "Launch Assistant" : "Sign In to Start"} <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </motion.div>

      {/* Decorative Grid */}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:40px_40px] opacity-40"></div>
    </div>
  );
}

function Dashboard({ projects, onProjectAdded, onSelectProject, onDeleteProject, setCookieCheckFailed }: { 
  projects: Project[], 
  onProjectAdded: (p: Project) => void,
  onSelectProject: (id: string) => void,
  onDeleteProject: (p: Project) => void,
  setCookieCheckFailed?: (val: boolean) => void
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    if (file.size > 50 * 1024 * 1024) {
      setUploadError('File is too large. Maximum size is 50MB due to network constraints.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const resp = await fetch('/api/projects/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!resp.ok) {
        let errorMsg = 'Upload failed';
        const errorText = await resp.text();
        
        if (isCookieCheckHtml(errorText)) {
          setCookieCheckFailed?.(true);
          throw new Error('Your browser is blocking the security cookie required by the AI Studio preview environment. Please open the app in a new tab to bypass this.');
        }
        
        // Special handling for infrastructure 413 errors (Proxy limit)
        if (resp.status === 413 || errorText.includes('413 Request Entity Too Large')) {
           errorMsg = 'File is too large for the network proxy (Max 50MB). Please try a smaller IFC file.';
        } else {
            try {
              // Only try to parse if it looks like JSON
              if (errorText.trim().startsWith('{')) {
                const errData = JSON.parse(errorText);
                errorMsg = errData.error || errorMsg;
              } else {
                errorMsg = `Server error (${resp.status}): ${errorText.slice(0, 100)}`;
              }
            } catch (e) {
              errorMsg = `Error ${resp.status}: ${errorText.slice(0, 100)}`;
            }
        }
        throw new Error(errorMsg);
      }

      let data;
      const respText = await resp.text();
      if (isCookieCheckHtml(respText)) {
        setCookieCheckFailed?.(true);
        throw new Error('Your browser is blocking the security cookie required by the AI Studio preview environment. Please open the app in a new tab.');
      }
      try {
        data = JSON.parse(respText);
      } catch (e: any) {
        console.error("Failed to parse upload response JSON. Raw text:", respText, e);
        throw new Error(`Failed to parse upload response: ${e?.message || 'Invalid JSON format'}. Response started with: "${respText.slice(0, 150)}"`);
      }
      
      // Save project properties to Firestore under /projects/{projectId}
      if (auth.currentUser) {
        try {
          const projectDocRef = doc(db, 'projects', data.projectId);
          const projectPayload = {
            id: data.projectId,
            name: data.name,
            summary: data.summary,
            uploadedAt: serverTimestamp(),
            ownerId: auth.currentUser.uid
          };
          await setDoc(projectDocRef, projectPayload);
          
          const localProject: Project = {
            id: data.projectId,
            name: data.name,
            summary: data.summary,
            uploadedAt: new Date().toISOString()
          };
          onProjectAdded(localProject);
        } catch (dbErr) {
          console.error("Error setting project in firestore: ", dbErr);
          handleFirestoreError(dbErr, OperationType.CREATE, `projects/${data.projectId}`);
        }
      } else {
        throw new Error("You must be signed in to upload and save projects.");
      }
      
      // Reset input so user can upload another/same file
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      console.error(err);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadError(err.message || 'Upload failed. Ensure you select a valid IFC file.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex-1 p-8 max-w-7xl mx-auto w-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-white">Project Dashboard</h2>
          <p className="text-zinc-400 font-medium text-sm">Manage your construction engineering models and chat with AI</p>
        </div>
        <button 
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="btn-primary flex items-center gap-2"
        >
          {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Upload IFC
        </button>
        <input type="file" ref={fileInputRef} onChange={handleUpload} className="hidden" accept=".ifc" />
      </div>

      {uploadError && (
        <div className="mb-6 flex items-start justify-between p-4 bg-red-950/40 border border-red-500/20 text-red-200 rounded-2xl text-xs font-medium backdrop-blur-md animate-fade-in">
          <div className="flex gap-2 items-center">
            <span className="text-red-400">⚠️</span>
            <span>{uploadError}</span>
          </div>
          <button onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-200 ml-2 font-bold cursor-pointer">
            &times;
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="border-2 border-dashed border-zinc-800 bg-zinc-900/10 rounded-3xl p-20 flex flex-col items-center justify-center text-center space-y-4">
          <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 text-zinc-400">
            <Building2 className="w-12 h-12 text-[var(--accent)] animate-pulse" />
          </div>
          <h3 className="text-xl font-bold text-zinc-200">No projects yet</h3>
          <p className="text-zinc-500 max-w-xs text-xs font-medium leading-relaxed">Upload your first building model (.ifc) to bootstrap high-fidelity 3D renderings and chat with AI.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((p) => (
            <motion.div 
              key={p.id} 
              layoutId={p.id}
              whileHover={{ y: -5, scale: 1.01 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              onClick={() => onSelectProject(p.id)}
              className="card cursor-pointer group"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="bg-orange-950/40 border border-orange-900/30 p-3 rounded-2xl">
                    <FileText className="w-6 h-6 text-[var(--accent)]" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 tracking-wider">ID: {p.id.slice(0,8)}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProject(p);
                      }}
                      className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-950/30 rounded-xl border border-transparent hover:border-red-900/20 transition-all cursor-pointer"
                      title="Delete Project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <h4 className="font-extrabold text-xl text-zinc-100 leading-tight group-hover:text-[var(--accent)] transition-colors truncate">{p.name}</h4>
                  <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1.5 font-medium">
                    <Clock className="w-3.5 h-3.5 text-zinc-500" />
                    Uploaded: {new Date(p.uploadedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-4 border-t border-zinc-800/40">
                  <div className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-850">
                    <div className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Total Elements</div>
                    <div className="text-lg font-black text-zinc-100 mt-0.5">{p.summary.elements.total}</div>
                  </div>
                  <div className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-850">
                    <div className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Floor levels</div>
                    <div className="text-lg font-black text-zinc-100 mt-0.5">{p.summary.structure.floors.length}</div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Helper: CameraRig to smoothly position looking at target ---
function CameraRig({ viewType, cameraTarget }: { viewType: '3d' | '2d'; cameraTarget: [number, number, number] }) {
  const { camera } = useThree();
  useEffect(() => {
    if (viewType === '2d') {
      // Look straight down from above
      camera.position.set(cameraTarget[0], cameraTarget[1] + 25, cameraTarget[2]);
      camera.up.set(0, 0, -1); // North is up on grid
      camera.lookAt(new THREE.Vector3(...cameraTarget));
    } else {
      // Look from perspective angle
      camera.position.set(cameraTarget[0] + 16, cameraTarget[1] + 16, cameraTarget[2] + 16);
      camera.up.set(0, 1, 0); // Standard up vector
      camera.lookAt(new THREE.Vector3(...cameraTarget));
    }
    camera.updateProjectionMatrix();
  }, [viewType, cameraTarget, camera]);
  return null;
}

// --- Helper: TargetIndicator showing centered focus location ---
function TargetIndicator({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Horizon ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.3, 0.38, 32]} />
        <meshBasicMaterial color="#f97316" side={THREE.DoubleSide} transparent opacity={0.8} />
      </mesh>
      {/* Inner beacon point */}
      <mesh position={[0, 0.05, 0]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color="#f97316" />
      </mesh>
      {/* Light guide tower */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.8, 8]} />
        <meshBasicMaterial color="#f97316" transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

// --- Helper: IsolatedRoom3D drawing custom furnished rooms on selected floor levels ---
function getRoomType(room: any): 'living' | 'bedroom' | 'bathroom' | 'kitchen' | 'office' | 'entrance' | 'roof' | 'boardroom' | 'lobby' | 'lounge' | 'generic' {
  if (!room) return 'generic';
  const name = (room.name || '').toLowerCase();
  const id = (room.id || '').toLowerCase();
  
  if (id === 'lobby') return 'lobby';
  if (id === 'conf') return 'boardroom';
  if (id === 'work') return 'office';
  if (id === 'exec') return 'office';
  if (id === 'lounge') return 'lounge';

  if (name.includes('living') || name.includes('wohnen') || name.includes('family') || name.includes('lounge') || name.includes('sofa')) {
    return 'living';
  }
  if (name.includes('bedroom') || name.includes('schlaf') || name.includes('bed') || name.includes('zimmer')) {
    if (name.includes('buero') || name.includes('büro') || name.includes('office') || name.includes('work')) {
      return 'office';
    }
    return 'bedroom';
  }
  if (name.includes('bad') || name.includes('bathroom') || name.includes('toilet') || name.includes('restroom') || name.includes('wc') || name.includes('dusche') || name.includes('shower')) {
    return 'bathroom';
  }
  if (name.includes('kitchen') || name.includes('küche') || name.includes('pantry') || name.includes('dining') || name.includes('herd') || name.includes('essen')) {
    return 'kitchen';
  }
  if (name.includes('office') || name.includes('buero') || name.includes('büro') || name.includes('study') || name.includes('work') || name.includes('schreibtisch')) {
    return 'office';
  }
  if (name.includes('entrance') || name.includes('flur') || name.includes('hall') || name.includes('lobby') || name.includes('foyer') || name.includes('gallery') || name.includes('galerie') || name.includes('corridor') || name.includes('gang')) {
    return 'entrance';
  }
  if (name.includes('roof') || name.includes('dach') || name.includes('terrace') || name.includes('balcony') || name.includes('balkon')) {
    return 'roof';
  }
  return 'generic';
}

function IsolatedRoom3D({ room, elev, storyHeight }: { room: any; elev: number; storyHeight: number }) {
  if (!room) return null;
  const roomType = getRoomType(room);

  return (
    <group position={[room.center[0], elev, room.center[2]]}>
      {/* Floor glass-like neon boundaries */}
      <mesh receiveShadow position={[0, 0.02, 0]}>
        <boxGeometry args={[room.size[0], 0.06, room.size[1]]} />
        <meshStandardMaterial color="#18181b" roughness={0.8} metalness={0.1} />
      </mesh>

      {/* Selected zone glowing bounds indicator */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <planeGeometry args={[room.size[0], room.size[1]]} />
        <meshBasicMaterial color={room.color} wireframe transparent opacity={0.4} />
      </mesh>

      {/* Frosted Translucent Glass dividers framing isolated room space */}
      <mesh position={[0, storyHeight / 2, room.size[1] / 2]} castShadow receiveShadow>
        <boxGeometry args={[room.size[0], storyHeight, 0.06]} />
        <meshStandardMaterial color={room.color} transparent opacity={0.12} roughness={0.1} metalness={0.8} />
      </mesh>
      <mesh position={[0, storyHeight / 2, -room.size[1] / 2]} castShadow receiveShadow>
        <boxGeometry args={[room.size[0], storyHeight, 0.06]} />
        <meshStandardMaterial color={room.color} transparent opacity={0.12} roughness={0.1} metalness={0.8} />
      </mesh>
      <mesh position={[room.size[0] / 2, storyHeight / 2, 0]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[room.size[1], storyHeight, 0.06]} />
        <meshStandardMaterial color={room.color} transparent opacity={0.12} roughness={0.1} metalness={0.8} />
      </mesh>
      <mesh position={[-room.size[0] / 2, storyHeight / 2, 0]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[room.size[1], storyHeight, 0.06]} />
        <meshStandardMaterial color={room.color} transparent opacity={0.12} roughness={0.1} metalness={0.8} />
      </mesh>

      {/* 3D Room Title Tag floating overhead */}
      <Html position={[0, storyHeight + 0.6, 0]} center distanceFactor={14}>
        <div className="bg-zinc-950/95 border border-zinc-800 text-white font-mono font-black text-[9px] px-3 py-1.5 rounded-xl uppercase whitespace-nowrap shadow-2xl flex items-center gap-2 backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: room.color }}></span>
          {room.name}
        </div>
      </Html>

      {/* Interior furnishings representing functional BIM layout design */}
      {roomType === 'lobby' && (
        <group>
          {/* Main Reception Panel Desk */}
          <mesh position={[0, 0.45, 0.4]} castShadow>
            <boxGeometry args={[1.8, 0.9, 0.6]} />
            <meshStandardMaterial color="#f97316" roughness={0.3} metalness={0.2} />
          </mesh>
          {/* Lobby lounge seating units - Vibrant sky/light blue */}
          <mesh position={[-1.3, 0.25, -1.1]} castShadow>
            <boxGeometry args={[1.1, 0.5, 0.55]} />
            <meshStandardMaterial color="#38bdf8" roughness={0.6} />
          </mesh>
          <mesh position={[1.3, 0.25, -1.1]} castShadow>
            <boxGeometry args={[1.1, 0.5, 0.55]} />
            <meshStandardMaterial color="#38bdf8" roughness={0.6} />
          </mesh>
          {/* Front Welcome Column - Bright cream white */}
          <mesh position={[-1.4, 0.75, 1.2]} castShadow>
            <cylinderGeometry args={[0.15, 0.15, 1.5, 12]} />
            <meshStandardMaterial color="#f1f5f9" roughness={0.5} />
          </mesh>
        </group>
      )}

      {roomType === 'boardroom' && (
        <group>
          {/* Wood Boardroom table - Bright amber gold */}
          <mesh position={[0, 0.38, 0]} castShadow>
            <boxGeometry args={[2.5, 0.76, 1.3]} />
            <meshStandardMaterial color="#fbbf24" roughness={0.1} metalness={0.4} />
          </mesh>
          {/* Boardroom widescreen presentation monitor */}
          <mesh position={[0, 1.55, -room.size[1] / 2 + 0.1]} castShadow>
            <boxGeometry args={[1.8, 1.0, 0.08]} />
            <meshStandardMaterial color="#06b6d4" roughness={0.1} emissive="#06b6d4" emissiveIntensity={0.2} />
          </mesh>
          {/* Executive seating chairs orbiting table - Vibrant hot pink */}
          {[-0.8, 0, 0.8].map((x) => (
            <group key={x}>
              <mesh position={[x, 0.35, 0.85]} castShadow>
                <boxGeometry args={[0.4, 0.7, 0.4]} />
                <meshStandardMaterial color="#ec4899" roughness={0.6} />
              </mesh>
              <mesh position={[x, 0.35, -0.85]} castShadow>
                <boxGeometry args={[0.4, 0.7, 0.4]} />
                <meshStandardMaterial color="#ec4899" roughness={0.6} />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {roomType === 'lounge' && (
        <group>
          {/* Breakfast bar countertop - Vibrant cyan */}
          <mesh position={[0, 0.48, 0]} castShadow>
            <boxGeometry args={[3.2, 0.96, 0.65]} />
            <meshStandardMaterial color="#06b6d4" roughness={0.1} metalness={0.5} />
          </mesh>
          {/* Bar high stools - Electric hot pink */}
          {[-1.1, 0, 1.1].map((x) => (
            <mesh key={x} position={[x, 0.38, 0.65]} castShadow>
              <cylinderGeometry args={[0.18, 0.18, 0.76, 12]} />
              <meshStandardMaterial color="#ff007f" roughness={0.4} />
            </mesh>
          ))}
        </group>
      )}

      {roomType === 'living' && (
        <group>
          {/* L-shaped Indigo Sofa */}
          <mesh position={[-0.4, 0.25, 0.4]} castShadow>
            <boxGeometry args={[1.6, 0.45, 0.6]} />
            <meshStandardMaterial color="#6366f1" roughness={0.7} />
          </mesh>
          <mesh position={[0.4, 0.25, -0.2]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <boxGeometry args={[1.2, 0.45, 0.6]} />
            <meshStandardMaterial color="#6366f1" roughness={0.7} />
          </mesh>
          {/* Low wooden coffee table */}
          <mesh position={[0.1, 0.15, 0.1]} castShadow>
            <boxGeometry args={[0.8, 0.3, 0.5]} />
            <meshStandardMaterial color="#854d0e" roughness={0.5} />
          </mesh>
          {/* TV stand console and TV screen */}
          <mesh position={[0, 0.2, -0.9]} castShadow>
            <boxGeometry args={[1.5, 0.35, 0.35]} />
            <meshStandardMaterial color="#1c1917" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.75, -0.9]} castShadow>
            <boxGeometry args={[1.2, 0.7, 0.08]} />
            <meshStandardMaterial color="#09090b" roughness={0.2} metalness={0.8} />
          </mesh>
        </group>
      )}

      {roomType === 'bedroom' && (
        <group>
          {/* Cozy king size bed */}
          <group position={[0, 0.25, -0.2]}>
            {/* Wooden frame / headboard */}
            <mesh position={[0, 0.4, -0.85]} castShadow>
              <boxGeometry args={[1.6, 0.8, 0.1]} />
              <meshStandardMaterial color="#78350f" roughness={0.6} />
            </mesh>
            {/* Mattress sheets */}
            <mesh position={[0, 0.15, 0]} castShadow>
              <boxGeometry args={[1.5, 0.35, 1.6]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.9} />
            </mesh>
            {/* Pillows */}
            <mesh position={[-0.4, 0.38, -0.6]} castShadow>
              <boxGeometry args={[0.45, 0.12, 0.3]} />
              <meshStandardMaterial color="#e2e8f0" roughness={0.9} />
            </mesh>
            <mesh position={[0.4, 0.38, -0.6]} castShadow>
              <boxGeometry args={[0.45, 0.12, 0.3]} />
              <meshStandardMaterial color="#e2e8f0" roughness={0.9} />
            </mesh>
          </group>
          {/* Bedside tables with glowing lamps */}
          {[-0.9, 0.9].map((x) => (
            <group key={x} position={[x, 0, -0.95]}>
              <mesh position={[0, 0.2, 0]} castShadow>
                <boxGeometry args={[0.35, 0.4, 0.35]} />
                <meshStandardMaterial color="#78350f" roughness={0.6} />
              </mesh>
              {/* Table Lamp body */}
              <mesh position={[0, 0.48, 0]} castShadow>
                <cylinderGeometry args={[0.04, 0.04, 0.16, 8]} />
                <meshStandardMaterial color="#d97706" roughness={0.2} />
              </mesh>
              {/* Lamp shade - Glowing gold */}
              <mesh position={[0, 0.62, 0]} castShadow>
                <cylinderGeometry args={[0.1, 0.14, 0.15, 10]} />
                <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.6} />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {roomType === 'bathroom' && (
        <group>
          {/* Large pure-white bathtub unit */}
          <group position={[-0.45, 0.25, 0.2]}>
            <mesh castShadow>
              <boxGeometry args={[1.4, 0.5, 0.7]} />
              <meshStandardMaterial color="#ffffff" roughness={0.1} />
            </mesh>
            {/* Water surface */}
            <mesh position={[0, 0.21, 0]}>
              <planeGeometry args={[1.2, 0.54]} />
              <meshStandardMaterial color="#38bdf8" transparent opacity={0.7} roughness={0.1} />
            </mesh>
          </group>
          {/* Vanity with a mirror */}
          <group position={[0.55, 0, -0.5]}>
            {/* Vanity cabinet */}
            <mesh position={[0, 0.38, 0]} castShadow>
              <boxGeometry args={[0.7, 0.76, 0.55]} />
              <meshStandardMaterial color="#334155" roughness={0.5} />
            </mesh>
            {/* Sink basin */}
            <mesh position={[0, 0.76, 0]} castShadow>
              <boxGeometry args={[0.45, 0.08, 0.35]} />
              <meshStandardMaterial color="#ffffff" roughness={0.1} />
            </mesh>
            {/* Mirror on backwall */}
            <mesh position={[0, 1.4, -0.25]} castShadow>
              <boxGeometry args={[0.5, 0.7, 0.03]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.05} />
            </mesh>
          </group>
        </group>
      )}

      {roomType === 'kitchen' && (
        <group>
          {/* Countertop/Island units */}
          <mesh position={[-0.4, 0.42, 0.45]} castShadow>
            <boxGeometry args={[1.5, 0.84, 0.65]} />
            <meshStandardMaterial color="#1e293b" roughness={0.3} />
          </mesh>
          <mesh position={[0.55, 0.42, -0.2]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <boxGeometry args={[1.4, 0.84, 0.65]} />
            <meshStandardMaterial color="#1e293b" roughness={0.3} />
          </mesh>
          {/* Tall stainless steel fridge */}
          <mesh position={[-0.8, 0.8, -0.6]} castShadow>
            <boxGeometry args={[0.65, 1.6, 0.65]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Dinner table */}
          <group position={[0.4, 0, 0.7]}>
            <mesh position={[0, 0.35, 0]} castShadow>
              <cylinderGeometry args={[0.45, 0.45, 0.06, 12]} />
              <meshStandardMaterial color="#d97706" roughness={0.5} />
            </mesh>
            <mesh position={[0, 0.17, 0]} castShadow>
              <cylinderGeometry args={[0.04, 0.04, 0.34, 8]} />
              <meshStandardMaterial color="#1e293b" roughness={0.5} />
            </mesh>
          </group>
        </group>
      )}

      {roomType === 'office' && (
        <group>
          {/* Desktop workspace table */}
          <mesh position={[0, 0.38, 0]} castShadow>
            <boxGeometry args={[1.6, 0.76, 0.8]} />
            <meshStandardMaterial color="#ffffff" roughness={0.3} />
          </mesh>
          {/* Flat monitor */}
          <mesh position={[0, 0.95, 0.1]} castShadow>
            <boxGeometry args={[0.8, 0.45, 0.05]} />
            <meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={0.15} />
          </mesh>
          {/* Swivel task chair */}
          <mesh position={[0, 0.3, -0.65]} castShadow>
            <boxGeometry args={[0.5, 0.65, 0.5]} />
            <meshStandardMaterial color="#a855f7" roughness={0.5} />
          </mesh>
        </group>
      )}

      {roomType === 'entrance' && (
        <group>
          {/* Wooden entrance hall console table */}
          <mesh position={[0, 0.38, -0.7]} castShadow>
            <boxGeometry args={[1.3, 0.76, 0.4]} />
            <meshStandardMaterial color="#7c2d12" roughness={0.5} />
          </mesh>
          {/* Ceramic plant pot */}
          <group position={[-0.7, 0, 0.4]}>
            <mesh position={[0, 0.22, 0]} castShadow>
              <cylinderGeometry args={[0.2, 0.15, 0.44, 10]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.1} />
            </mesh>
            <mesh position={[0, 0.62, 0]} castShadow>
              <sphereGeometry args={[0.25, 8, 8]} />
              <meshStandardMaterial color="#16a34a" roughness={0.9} />
            </mesh>
            <mesh position={[0.1, 0.52, -0.1]} rotation={[0.4, 0, -0.5]} castShadow>
              <boxGeometry args={[0.1, 0.4, 0.2]} />
              <meshStandardMaterial color="#22c55e" roughness={0.9} />
            </mesh>
          </group>
        </group>
      )}

      {roomType === 'roof' && (
        <group>
          {/* Relaxation patio sunloungers */}
          {[-0.6, 0.6].map((x) => (
            <group key={x} position={[x, 0, -0.2]}>
              <mesh position={[0, 0.22, -0.45]} rotation={[-Math.PI / 6, 0, 0]} castShadow>
                <boxGeometry args={[0.45, 0.45, 0.08]} />
                <meshStandardMaterial color="#f97316" roughness={0.6} />
              </mesh>
              <mesh position={[0, 0.1, 0.05]} castShadow>
                <boxGeometry args={[0.45, 0.12, 0.85]} />
                <meshStandardMaterial color="#f97316" roughness={0.6} />
              </mesh>
            </group>
          ))}
          {/* Garden table */}
          <group position={[0, 0, 0.7]}>
            <mesh position={[0, 0.35, 0]} castShadow>
              <cylinderGeometry args={[0.3, 0.3, 0.04, 10]} />
              <meshStandardMaterial color="#f1f5f9" roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.8, 0]} castShadow>
              <cylinderGeometry args={[0.02, 0.02, 1.6, 6]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.8} />
            </mesh>
          </group>
        </group>
      )}

      {roomType === 'generic' && (
        <group>
          {/* Central workstation and plant */}
          <mesh position={[0, 0.38, 0]} castShadow>
            <boxGeometry args={[1.2, 0.76, 0.8]} />
            <meshStandardMaterial color="#e4e4e7" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.3, -0.6]} castShadow>
            <boxGeometry args={[0.45, 0.6, 0.45]} />
            <meshStandardMaterial color="#71717a" roughness={0.7} />
          </mesh>
        </group>
      )}
    </group>
  );
}

const storyHeight = 3.8;
const houseWidth = 10;
const houseDepth = 8;

const ROOM_DEFINITIONS = [
  { id: 'all', name: 'Show Entire Level', center: [0, 0, 0] as [number, number, number], size: [houseWidth, houseDepth] as [number, number], color: '#f97316', desc: 'Full isometric projection of the current model story level.' },
  { id: 'lobby', name: 'Reception Lobby', center: [-2.5, 0, -1.5] as [number, number, number], size: [4, 4] as [number, number], color: '#38bdf8', desc: 'Secure entrance foyer with guest lounge and front welcoming counter.' },
  { id: 'conf', name: 'Conference Boardroom', center: [2.5, 0, -1.5] as [number, number, number], size: [4.5, 4] as [number, number], color: '#fbbf24', desc: 'Central boardroom housing executive tables and dynamic media displays.' },
  { id: 'work', name: 'Open Workspaces', center: [0, 0, 2] as [number, number, number], size: [9.5, 3] as [number, number], color: '#a855f7', desc: 'High capacity operations room with four modular developer workstations.' },
  { id: 'exec', name: 'Executive Suite', center: [-3, 0, -3.2] as [number, number, number], size: [3.5, 1.4] as [number, number], color: '#f43f5e', desc: 'Private leadership office section with desks and document storage.' },
  { id: 'lounge', name: 'Pantry & Coffee Lounge', center: [2.5, 0, -3.2] as [number, number, number], size: [4.5, 1.4] as [number, number], color: '#06b6d4', desc: 'Employee refreshment space featuring high bar counters and stools.' },
];

interface BIMPreviewProps {
  project: Project;
  setCookieCheckFailed?: (val: boolean) => void;
  viewType: '3d' | '2d';
  setViewType: (v: '3d' | '2d') => void;
  selectedFloorId: string;
  setSelectedFloorId: (id: string) => void;
  selectedRoomId: string;
  setSelectedRoomId: (id: string) => void;
  cameraTarget: [number, number, number];
  setCameraTarget: (target: [number, number, number]) => void;
  roomDefinitions: any[];
}

function checkWebGLSupport() {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch (e) {
    return false;
  }
}

class CanvasErrorBoundary extends React.Component<{ children: React.ReactNode; fallback?: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("Canvas rendering failed:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-white p-6 text-center">
          <div className="max-w-md bg-slate-800/85 border border-red-500/30 rounded-3xl p-8 shadow-2xl backdrop-blur-md">
            <h3 className="text-xl font-bold text-white mb-2 font-sans">WebGL Canvas Crash</h3>
            <p className="text-slate-400 text-xs leading-relaxed mb-6 font-sans">
              Three.js / WebGL encountered a runtime rendering exception. This usually happens when the GPU runs out of memory or context is lost in the iframe.
            </p>
            <p className="text-xs text-red-400 font-mono bg-red-950/50 p-3 rounded-lg border border-red-900/30">
              {this.state.error?.message || "Unknown Canvas Error"}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function BIMPreview({
  project,
  setCookieCheckFailed,
  viewType,
  setViewType,
  selectedFloorId,
  setSelectedFloorId,
  selectedRoomId,
  setSelectedRoomId,
  cameraTarget,
  setCameraTarget,
  roomDefinitions
}: BIMPreviewProps) {
  const [webGlSupported, setWebGlSupported] = useState(() => checkWebGLSupport());

  const [model, setModel] = useState<THREE.Object3D | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileExists, setFileExists] = useState<boolean | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<string | null>(null);

  const isDraggingRef = useRef(false);



  useEffect(() => {
    let active = true;
    async function checkAndLoadModel() {
      setIsLoading(true);
      setLoadError(null);
      
      try {
        if (!webGlSupported) {
          throw new Error("WebGL is currently disabled or unsupported in this sandboxed preview context.");
        }

        console.log(`Checking if IFC model file exists for project: ${project.id}`);
        const checkResp = await fetch(`/api/projects/${project.id}/file-exists`);
        const checkText = await checkResp.text();
        
        if (isCookieCheckHtml(checkText)) {
          setCookieCheckFailed?.(true);
          throw new Error("Your browser is blocking the security cookie required by the AI Studio preview environment. Please open the app in a new tab to bypass this.");
        }
        
        if (!checkResp.ok) {
          throw new Error("Unable to check project status on server.");
        }
        const checkData = JSON.parse(checkText);
        
        if (!active) return;
        
        if (!checkData.exists) {
          setFileExists(false);
          setLoadError("Fidelity 3D cache cleared (Server restarted). Below you can re-upload your IFC file to restore 3D rendering!");
          setIsLoading(false);
          return;
        }
        
        setFileExists(true);
        const loader = new IFCLoader();
        loader.ifcManager.useWebWorkers(false);
        loader.ifcManager.setWasmPath(window.location.origin + '/');
        
        loader.load(
          `/api/projects/${project.id}/file`,
          (ifcModel) => {
            if (active) {
              ifcModel.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                  const mesh = child as THREE.Mesh;
                  if (!mesh.material || (Array.isArray(mesh.material) && mesh.material.length === 0)) {
                    mesh.material = new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.6, metalness: 0.2 });
                  }
                  mesh.castShadow = true;
                  mesh.receiveShadow = true;
                }
              });
              setModel(ifcModel);
              setLoadError(null);
              setIsLoading(false);
            }
          },
          undefined,
          (err) => {
            console.error("IFC Load Error:", err);
            if (active) {
              setLoadError("Fidelity render failed. Showing schematic instead.");
              setIsLoading(false);
            }
          }
        );
      } catch (err: any) {
        console.error("Loader/Check Error:", err);
        if (active) {
          setLoadError(err?.message || "3D Engine init failed.");
          setIsLoading(false);
        }
      }
    }

    checkAndLoadModel();
    return () => { active = false; };
  }, [project.id, fileExists]);

  const handleRestoreFile = async (file: File) => {
    if (!file) return;
    setIsRestoring(true);
    setRestoreProgress("Uploading file...");
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const resp = await fetch(`/api/projects/${project.id}/restore`, {
        method: 'POST',
        body: formData,
      });
      
      const respText = await resp.text();
      if (isCookieCheckHtml(respText)) {
        setCookieCheckFailed?.(true);
        throw new Error("Your browser is blocking the security cookie required by the AI Studio preview environment. Please open the app in a new tab.");
      }
      
      if (!resp.ok) {
        throw new Error(`Upload failed: ${resp.statusText}`);
      }
      
      const data = JSON.parse(respText);
      if (data.success) {
        setRestoreProgress("Loading 3D View...");
        setFileExists(true);
        setLoadError(null);
      } else {
        throw new Error("Unable to restore model file.");
      }
    } catch (err: any) {
      console.error("Restore failed:", err);
      setLoadError(`Re-upload failed: ${err.message || err}`);
    } finally {
      setIsRestoring(false);
      setRestoreProgress(null);
    }
  };

  const floors = project.summary?.structure?.floors || [];

  // Derive height based on the isolated floor storey index
  const isolatedFloorIndex = floors.findIndex((f: any) => f.id === selectedFloorId);
  const activeLevelElevation = isolatedFloorIndex !== -1 ? isolatedFloorIndex * storyHeight : 0;

  // Let centering focus snap nicely to either selected room or origin coordinate
  const currentIsolatedRoomObj = roomDefinitions.find(r => r.id === selectedRoomId);

  const resetCameraFocus = () => {
    if (selectedRoomId !== 'all' && currentIsolatedRoomObj) {
      setCameraTarget([currentIsolatedRoomObj.center[0], activeLevelElevation, currentIsolatedRoomObj.center[2]]);
    } else {
      setCameraTarget([0, activeLevelElevation, 0]);
    }
  };

  // Adjust camera target when room selection changes
  useEffect(() => {
    if (selectedRoomId !== 'all' && currentIsolatedRoomObj) {
      setCameraTarget([currentIsolatedRoomObj.center[0], activeLevelElevation, currentIsolatedRoomObj.center[2]]);
    }
  }, [selectedRoomId, selectedFloorId]);

  return (
    <div className="w-full h-full bg-slate-50 rounded-3xl overflow-hidden relative border border-slate-200 shadow-2xl flex flex-col">
      
      {/* Main 3D Rendering Stage Canvas relative block */}
      <div 
        className="flex-1 min-h-[350px] lg:h-full relative overflow-hidden bg-slate-50"
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault();
          }
        }}
      >
        
        {/* Floating Instruction overlay */}
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 pointer-events-none">
          <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl p-3.5 max-w-[240px] text-[10px] text-slate-700 shadow-2xl">
            <div className="flex items-center gap-2 font-black text-orange-600 mb-1 font-mono uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px_#f97316] animate-ping"></span>
              3D Workspace
            </div>
            <p className="text-slate-500 leading-normal text-[9px] font-medium font-sans">
              Left click and drag to orbit around center. Right click and drag to pan the camera view. Scroll to zoom. <span className="font-extrabold text-orange-600">Middle click anywhere on the model or ground to change the pivot target point!</span>
            </p>
          </div>
        </div>

        {/* Floating Recenter Camera option */}
        <div className="absolute bottom-4 left-4 z-10">
          <button
            onClick={resetCameraFocus}
            className="bg-white/95 backdrop-blur-md border border-slate-200 shadow-lg px-3 py-2 rounded-xl text-[9px] font-black tracking-widest uppercase text-slate-700 font-mono flex items-center gap-1.5 cursor-pointer hover:bg-orange-500 hover:text-white hover:border-orange-400 active:scale-95 transition-all"
          >
            <Crosshair className="w-3.5 h-3.5" />
            Recenter Camera Focus
          </button>
        </div>

        {webGlSupported ? (
          <CanvasErrorBoundary>
            <Canvas shadows gl={{ antialias: true }} camera={{ position: [15, 15, 15], fov: 42 }}>
            <OrbitControls 
              key={`${viewType}-${cameraTarget.join('-')}-${selectedFloorId}-${selectedRoomId}`}
              target={new THREE.Vector3(...cameraTarget)}
              makeDefault 
              enableDamping 
              dampingFactor={0.05}
              enableRotate={viewType === '3d'}
              onStart={() => {
                isDraggingRef.current = true;
              }}
              onEnd={() => {
                setTimeout(() => {
                  isDraggingRef.current = false;
                }, 120);
              }}
            />
            
            <CameraRig viewType={viewType} cameraTarget={cameraTarget} />
            
            <ambientLight intensity={0.7} />
            <directionalLight 
              position={[30, 45, 30]} 
              intensity={1.8} 
              castShadow 
              shadow-mapSize={[2048, 2048]}
            />
            <pointLight position={[-15, 15, -15]} intensity={0.6} />

            {/* Dynamic centering indicator pin */}
            <TargetIndicator position={cameraTarget} />
            
            {/* Environment - Light Kraft Base GridSlab */}
            <mesh 
              rotation={[-Math.PI / 2, 0, 0]} 
              position={[0, -0.1, 0]} 
              receiveShadow
              onPointerDown={(e) => {
                if (e.button === 1 || e.nativeEvent?.button === 1) {
                  e.stopPropagation();
                  if (e.point) {
                    setCameraTarget([e.point.x, e.point.y, e.point.z]);
                  }
                }
              }}
            >
              <boxGeometry args={[120, 120, 0.2]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.8} />
            </mesh>
            
            <Grid 
              infiniteGrid 
              fadeDistance={80} 
              cellColor="#cbd5e1" 
              sectionColor="#94a3b8" 
              cellSize={1} 
              sectionSize={10}
            />

            <group onPointerDown={(e) => {
              if (e.button === 1 || e.nativeEvent?.button === 1) {
                e.stopPropagation();
                if (e.point) {
                  setCameraTarget([e.point.x, e.point.y, e.point.z]);
                }
              }
            }}>
              {selectedRoomId !== 'all' ? (
                /* Only render the isolated room, perfectly centered with no building overlap! */
                <Center top>
                  <IsolatedRoom3D 
                    room={roomDefinitions.find(r => r.id === selectedRoomId)} 
                    elev={0} 
                    storyHeight={storyHeight} 
                  />
                </Center>
              ) : model ? (
                /* loaded full-level IFC rendering */
                <Center top>
                  <primitive object={model} />
                </Center>
              ) : (
                /* Fallback full building visualization */
                <>
                  {floors.length > 0 ? (
                    floors.map((floor: any, i: number) => {
                      const elev = floor.elevation || i * storyHeight;
                      const isCurrentFloorExempt = selectedFloorId !== 'all' && selectedFloorId !== floor.id;
                      
                      if (isCurrentFloorExempt) return null;

                      return (
                        <group 
                          key={floor.id} 
                          position={[0, elev, 0]}
                        >
                          {/* Dark Slab base */}
                          <mesh position={[0, -0.05, 0]} receiveShadow castShadow>
                            <boxGeometry args={[houseWidth, 0.12, houseDepth]} />
                            <meshStandardMaterial color="#1c1917" roughness={0.6} />
                          </mesh>

                          {/* Translucent industrial structural columns */}
                          <group position={[0, storyHeight / 2, 0]}>
                            <mesh position={[0, 0, houseDepth / 2]} castShadow receiveShadow>
                              <boxGeometry args={[houseWidth, storyHeight, 0.12]} />
                              <meshStandardMaterial color="#27272a" transparent opacity={0.6} roughness={0.5} />
                            </mesh>
                            <mesh position={[0, 0, -houseDepth / 2]} castShadow receiveShadow>
                              <boxGeometry args={[houseWidth, storyHeight, 0.12]} />
                              <meshStandardMaterial color="#27272a" transparent opacity={0.6} roughness={0.5} />
                            </mesh>
                            <mesh position={[houseWidth / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
                              <boxGeometry args={[houseDepth, storyHeight, 0.12]} />
                              <meshStandardMaterial color="#27272a" transparent opacity={0.6} roughness={0.5} />
                            </mesh>
                            <mesh position={[-houseWidth / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
                              <boxGeometry args={[houseDepth, storyHeight, 0.12]} />
                              <meshStandardMaterial color="#27272a" transparent opacity={0.6} roughness={0.5} />
                            </mesh>
                          </group>

                          {/* Roof structure mapping only on highest floor if multiple exist */}
                          {i === floors.length - 1 && selectedFloorId === 'all' && (
                            <mesh position={[0, storyHeight, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
                              <coneGeometry args={[houseWidth * 0.75, storyHeight - 1, 4]} />
                              <meshStandardMaterial color="#44403c" roughness={0.8} />
                            </mesh>
                          )}
                        </group>
                      );
                    })
                  ) : (
                    /* Base structure fallback */
                    <Center top>
                      <mesh castShadow>
                        <boxGeometry args={[houseWidth, storyHeight, houseDepth]} />
                        <meshStandardMaterial color="#27272a" roughness={0.6} />
                      </mesh>
                    </Center>
                  )}
                </>
              )}
            </group>
          </Canvas>
         </CanvasErrorBoundary>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-white p-6 text-center">
            <div className="max-w-md bg-slate-800/85 border border-orange-500/30 rounded-3xl p-8 shadow-2xl backdrop-blur-md">
              <div className="w-16 h-16 bg-orange-500/10 border border-orange-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5 text-orange-500">
                <Layers className="w-8 h-8 animate-pulse" />
              </div>
              <h3 className="text-xl font-bold tracking-tight text-white mb-2 font-sans">3D Workspace Preview Mode</h3>
              <p className="text-slate-400 text-xs leading-relaxed mb-6 font-sans">
                WebGL is currently disabled or unsupported in this sandboxed preview iframe context. 
                Don't worry! Your 3D BIM data and structural extraction are fully processed and safe.
              </p>
              <div className="flex flex-col gap-3 justify-center">
                <a 
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-orange-500/20 active:scale-95 flex items-center justify-center gap-2 font-mono uppercase tracking-wider"
                >
                  <Maximize2 className="w-4 h-4" />
                  Open App in New Tab to view 3D
                </a>
                <p className="text-[10px] text-slate-500 font-sans">
                  Opening in a new tab bypasses iframe canvas constraints and unlocks full GPU accelerated 3D rendering.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Embedded loader indicator elements */}
        <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-2 pointer-events-none">
          {isLoading && (
            <div className="bg-zinc-950/90 backdrop-blur-md border border-orange-500/20 rounded-full px-4 py-2 flex items-center gap-2.5 text-[10px] font-bold text-orange-500 shadow-xl">
               <Loader2 className="w-3.5 h-3.5 animate-spin" />
               EXTRACTING 3D GEOMETRICAL ARTIFACTS...
            </div>
          )}
          {loadError && !isRestoring && (
            <div className="bg-orange-950/80 border border-orange-800/40 rounded-xl px-4 py-2 text-[10px] font-semibold text-orange-400 shadow-xl pointer-events-auto">
               {loadError}
            </div>
          )}
        </div>

        <div className="absolute bottom-4 right-4 z-10 flex flex-col items-end gap-1 font-mono pointer-events-none">
          <div className="text-[9px] font-black text-zinc-500 uppercase tracking-widest bg-zinc-950/80 px-4 py-1.5 rounded-full backdrop-blur-md border border-zinc-900 shadow-md">
            {model ? "BIM Fidelity: High (IFC Direct)" : "BIM Fidelity: Schematic (Reconstructed)"}
          </div>
        </div>
      </div>

      {/* Embedded Restore Upload Modal */}
      {fileExists === false && (
        <div className="absolute inset-x-4 bottom-4 z-20 bg-zinc-950/95 backdrop-blur-md rounded-2xl border border-zinc-800 p-5 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="flex items-center gap-3.5 text-left">
            <div className="bg-orange-950/40 border border-orange-900/40 text-[var(--accent)] p-3 rounded-2xl shrink-0">
              <Upload className="w-5 h-5 animate-bounce text-orange-500" />
            </div>
            <div>
              <h4 className="font-extrabold text-zinc-100 text-xs tracking-tight">3D Geometry Cache Cleared</h4>
              <p className="text-zinc-500 text-[10px] mt-1 leading-normal max-w-lg">
                The server restarted. The project statistics and AI chat records are fully preserved! To restore the premium 3D view, upload the original <span className="font-mono bg-zinc-900 text-zinc-300 px-1.5 py-0.5 rounded border border-zinc-850 text-[11px] font-black">{project.name}</span> file.
              </p>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2 w-full md:w-auto">
            <label className="w-full md:w-auto bg-gradient-to-r from-orange-500 to-amber-600 hover:opacity-90 active:scale-95 text-white font-bold text-[10px] px-4.5 py-3 rounded-xl cursor-pointer transition-all inline-flex items-center justify-center gap-2 shadow-xl shadow-orange-600/10 border border-orange-500/20 select-none">
              {isRestoring ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {restoreProgress || 'UPLOADING...'}
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  RESTORE HIGH-FIDELITY 3D
                </>
              )}
              <input 
                type="file" 
                accept=".ifc" 
                disabled={isRestoring} 
                className="hidden" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleRestoreFile(file);
                }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectView({ project, onBack, setCookieCheckFailed }: { project: Project, onBack: () => void, setCookieCheckFailed?: (val: boolean) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'split' | 'chat' | 'energy' | 'reports'>('split');

  // Lifted Core BIM interactive navigation states
  const [viewType, setViewType] = useState<'3d' | '2d'>('3d');
  const [selectedFloorId, setSelectedFloorId] = useState<string>('all');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('all');
  const [cameraTarget, setCameraTarget] = useState<[number, number, number]>([0, 0, 0]);

  // Dynamic room definitions based on whether project is Wellness Center Sama or a general IFC
  const roomDefinitions = useMemo(() => {
    const isWellness = project.name?.toLowerCase().includes('wellness') || project.name?.toLowerCase().includes('sama') || false;
    if (isWellness) {
      return ROOM_DEFINITIONS;
    }
    // Extract dynamic spaces from elements details (IFCSPACE)
    const spaces = project.summary?.elements?.details?.filter((d: any) => d.type === 'Spaces') || [];
    if (spaces.length === 0) {
      // Use beautifully styled standard residential room fallbacks for this model level
      const fallbackRooms = [
        { id: 'living', name: 'Living Room', center: [-2.0, 0, 1.8] as [number, number, number], size: [4.5, 3.5] as [number, number], color: '#6366f1', desc: 'Elegant lounge and leisure space with cozy family sofas.' },
        { id: 'bedroom', name: 'Master Bedroom', center: [2.0, 0, -1.8] as [number, number, number], size: [4.0, 3.5] as [number, number], color: '#ec4899', desc: 'Cozy private master bedroom complete with king bed.' },
        { id: 'kitchen', name: 'Modern Kitchen', center: [-2.0, 0, -1.8] as [number, number, number], size: [4.0, 3.5] as [number, number], color: '#10b981', desc: 'Sleek kitchen island dining setup with designer stools.' },
        { id: 'bathroom', name: 'Spa Bathroom', center: [2.0, 0, 1.8] as [number, number, number], size: [3.5, 3.5] as [number, number], color: '#06b6d4', desc: 'Luxurious bathroom sanctuary containing premium bathtub and vanity.' },
        { id: 'office', name: 'Home Office', center: [0, 0, -3.2] as [number, number, number], size: [3.5, 1.4] as [number, number], color: '#a855f7', desc: 'Productive workstation room with custom flat screen desktops.' },
        { id: 'entrance', name: 'Entrance Hall', center: [0, 0, 1.5] as [number, number, number], size: [2.5, 2.5] as [number, number], color: '#38bdf8', desc: 'Welcoming front gallery corridor leading into the main halls.' }
      ];
      return [
        { id: 'all', name: 'Show Entire Level', center: [0, 0, 0] as [number, number, number], size: [houseWidth, houseDepth] as [number, number], color: '#f97316', desc: 'Full isometric projection of the current model story level.' },
        ...fallbackRooms
      ];
    }
    return [
      { id: 'all', name: 'Show Entire Level', center: [0, 0, 0] as [number, number, number], size: [houseWidth, houseDepth] as [number, number], color: '#f97316', desc: 'Full isometric projection of the current model story level.' },
      ...spaces.map((sp: any, idx: number) => {
        // Space rooms out in a round layout within boundaries so they have unique 3D focus centroids
        const angle = (idx / spaces.length) * Math.PI * 2;
        const radius = 2.5;
        const x = parseFloat((Math.cos(angle) * radius).toFixed(2));
        const z = parseFloat((Math.sin(angle) * radius).toFixed(2));
        const colors = ['#38bdf8', '#fbbf24', '#a855f7', '#f43f5e', '#06b6d4', '#10b981', '#ec4899', '#6366f1'];
        return {
          id: String(sp.id),
          name: sp.name || `Space ${sp.id}`,
          center: [x, 0, z] as [number, number, number],
          size: [2.5, 2.5] as [number, number],
          color: colors[idx % colors.length],
          desc: `Room space extracted directly from IFC details.`,
          storeyId: sp.storeyId
        };
      })
    ];
  }, [project]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userMessage: ChatMessage = { role: 'user', parts: [{ text: input }] };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          message: input,
          history: messages,
          summary: project.summary,
          name: project.name
        }),
      });

      const respText = await resp.text();
      if (isCookieCheckHtml(respText)) {
        setCookieCheckFailed?.(true);
        throw new Error("Your browser is blocking the security cookie required by the AI Studio preview environment. Please open the app in a new tab to bypass this.");
      }

      if (!resp.ok) {
        throw new Error(`Chat error: ${resp.status} - ${respText.slice(0, 100)}`);
      }

      const data = JSON.parse(respText);
      setMessages(prev => [...prev, { role: 'model', parts: [{ text: data.text }] }]);
    } catch (err: any) {
       console.error(err);
       setMessages(prev => [...prev, { role: 'model', parts: [{ text: `Sorry, I encountered an error: ${err.message}` }] }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex-1 flex h-[calc(100vh-73px)] overflow-hidden bg-zinc-950">
      {/* Sidebar - Project Info */}
      <div className="w-80 bg-zinc-900 border-r border-zinc-850 flex flex-col hidden lg:flex shrink-0">
        <div className="p-6 border-b border-zinc-850">
          <button onClick={onBack} className="text-xs font-black text-zinc-500 flex items-center gap-1.5 mb-4 hover:text-orange-500 transition-colors font-mono cursor-pointer">
            <LayoutDashboard className="w-3.5 h-3.5" />
            BACK TO DASHBOARD
          </button>
          <h3 className="text-xl font-bold truncate text-zinc-100">{project.name}</h3>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex flex-col gap-2">
            <button 
              onClick={() => setViewMode('split')}
              className={cn("w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-start px-4 gap-3 transition-all cursor-pointer", viewMode === 'split' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/15" : "bg-zinc-800 text-zinc-400 hover:text-white")}
            >
              <LayoutDashboard className="w-4 h-4" />
              3D PREVIEW MODEL
            </button>
            <button 
              onClick={() => setViewMode('chat')}
              className={cn("w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-start px-4 gap-3 transition-all cursor-pointer", viewMode === 'chat' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/15" : "bg-zinc-800 text-zinc-400 hover:text-white")}
            >
              <MessageSquare className="w-4 h-4" />
              AI CO-PILOT CHAT
            </button>
            <button 
              onClick={() => setViewMode('energy')}
              className={cn("w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-start px-4 gap-3 transition-all cursor-pointer", viewMode === 'energy' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/15" : "bg-zinc-800 text-zinc-400 hover:text-white")}
            >
              <Building2 className="w-4 h-4" />
              ENERGY EFFICIENCY
            </button>
            <button 
              onClick={() => setViewMode('reports')}
              className={cn("w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-start px-4 gap-3 transition-all cursor-pointer", viewMode === 'reports' ? "bg-orange-500 text-white shadow-lg shadow-orange-500/15" : "bg-zinc-800 text-zinc-400 hover:text-white")}
            >
              <FileText className="w-4 h-4" />
              TECHNICAL REPORTS
            </button>
          </div>

          {/* Section for 3D/2D View Options */}
          <div className="space-y-2 pt-2 border-t border-zinc-800/40">
            <label className="text-[9px] font-black text-[#38bdf8] uppercase tracking-widest font-mono">Perspective Aspect</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setViewType('3d'); }}
                className={cn(
                  "py-2 px-2 rounded-xl text-[9px] font-black tracking-wider uppercase border flex items-center justify-center gap-1 transition-all cursor-pointer",
                  viewType === '3d' 
                    ? "bg-orange-500 text-white border-orange-400 shadow-lg shadow-orange-500/15 font-black" 
                    : "bg-zinc-800 text-zinc-400 border-zinc-750 hover:bg-zinc-750 hover:text-zinc-200"
                )}
              >
                <Compass className="w-3 h-3" />
                3D ISOMETRIC
              </button>
              <button
                onClick={() => { setViewType('2d'); }}
                className={cn(
                  "py-2 px-2 rounded-xl text-[9px] font-black tracking-wider uppercase border flex items-center justify-center gap-1 transition-all cursor-pointer",
                  viewType === '2d' 
                    ? "bg-orange-500 text-white border-orange-400 shadow-lg shadow-orange-500/15 font-black" 
                    : "bg-zinc-800 text-zinc-400 border-zinc-750 hover:bg-zinc-750 hover:text-zinc-200"
                )}
              >
                <Maximize2 className="w-3 h-3" />
                2D PLAN VIEW
              </button>
            </div>
          </div>

          {/* Section for Floor Segregation */}
          <div className="space-y-2 pt-2 border-t border-zinc-800/40">
            <div className="flex justify-between items-center">
              <label className="text-[9px] font-black text-[#38bdf8] uppercase tracking-widest font-mono">Floor Level Segregation</label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => { setSelectedFloorId('all'); setSelectedRoomId('all'); }}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider border cursor-pointer select-none transition-all",
                  selectedFloorId === 'all'
                    ? "bg-zinc-100 text-zinc-950 border-white font-black"
                    : "bg-zinc-800 text-zinc-400 border-zinc-750 hover:text-zinc-200 hover:bg-zinc-750"
                )}
              >
                All Levels
              </button>
              {(project.summary?.structure?.floors || []).map((f: any, idx: number) => (
                <button
                  key={f.id}
                  onClick={() => { setSelectedFloorId(f.id); }}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider border cursor-pointer select-none transition-all",
                    selectedFloorId === f.id
                      ? "bg-zinc-100 text-zinc-950 border-white"
                      : "bg-zinc-800 text-zinc-400 border-zinc-750 hover:text-zinc-200 hover:bg-zinc-750"
                  )}
                >
                  Storey {idx + 1}
                </button>
              ))}
            </div>
          </div>

          {/* Section for Room options */}
          <div className="space-y-2.5 pt-2 border-t border-zinc-800/40">
            <div className="flex justify-between items-center">
              <label className="text-[9px] font-black text-[#38bdf8] uppercase tracking-widest font-mono">Room Isolation Engine</label>
              {selectedRoomId !== 'all' && (
                <button 
                  onClick={() => setSelectedRoomId('all')}
                  className="text-[8px] font-black font-mono text-orange-500 hover:underline uppercase flex items-center gap-0.5 cursor-pointer"
                >
                  <RefreshCw className="w-2 h-2" /> Reset
                </button>
              )}
            </div>
             <div className="flex flex-col gap-1.5">
              {roomDefinitions.map((r) => {
                const isSelected = selectedRoomId === r.id;
                const floorsList = project.summary?.structure?.floors || [];
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      setSelectedRoomId(r.id);
                      // Autofocus floor if room is isolated
                      if (selectedFloorId === 'all' && floorsList.length > 0) {
                        setSelectedFloorId(floorsList[0].id);
                      }
                    }}
                    className={cn(
                      "w-full text-left p-2.5 rounded-xl border flex flex-col transition-all cursor-pointer",
                      isSelected 
                        ? "bg-zinc-850 border-zinc-700 text-zinc-50 shadow-lg" 
                        : "bg-zinc-950/40 border-zinc-850/80 hover:border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: isSelected ? r.color : '#52525b' }}></span>
                      <span className="font-extrabold text-[10px] uppercase tracking-wide leading-none">{r.name}</span>
                    </div>
                    {isSelected && (
                      <span className="text-[9px] text-zinc-400 font-medium leading-normal mt-1 block">
                        {r.desc}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className={cn("flex-1 flex", viewMode === 'split' ? "flex-col md:flex-row" : "flex-col")}>
        {viewMode === 'energy' ? (
          <EnergyAnalysisView project={project} />
        ) : viewMode === 'reports' ? (
          <ReportsView project={project} />
        ) : (
          <>
            {/* 3D Viewer / Data Panel */}
            {viewMode === 'split' && (
              <div className="flex-1 min-h-[300px] p-6 bg-zinc-950 flex flex-col gap-4">
                 <BIMPreview 
                   project={project} 
                   setCookieCheckFailed={setCookieCheckFailed}
                   viewType={viewType}
                   setViewType={setViewType}
                   selectedFloorId={selectedFloorId}
                   setSelectedFloorId={setSelectedFloorId}
                   selectedRoomId={selectedRoomId}
                   setSelectedRoomId={setSelectedRoomId}
                   cameraTarget={cameraTarget}
                   setCameraTarget={setCameraTarget}
                   roomDefinitions={roomDefinitions}
                 />
              </div>
            )}

            {/* Chat Area */}
            <div className={cn("flex flex-col bg-zinc-900 border-l border-zinc-850", viewMode === 'split' ? "w-full md:w-[450px]" : "flex-1")}>
              <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 max-w-sm mx-auto pt-20">
                    <div className="bg-orange-950/40 p-4 rounded-2xl border border-orange-900/30">
                      <MessageSquare className="w-8 h-8 text-[var(--accent)]" />
                    </div>
                    <p className="font-bold text-zinc-300 text-sm">Ask anything about the building model.</p>
                    <div className="flex flex-wrap gap-2 justify-center pt-2">
                      {["How many windows?", "Floor details?", "Materials?"].map(q => (
                        <button 
                          key={q} 
                          onClick={() => setInput(q)}
                          className="text-[10px] px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-full transition-all border border-zinc-750 font-black tracking-wider uppercase font-mono cursor-pointer"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <div 
                      key={i} 
                      className={cn(
                        "flex flex-col gap-1.5",
                        m.role === 'user' ? "items-end" : "items-start"
                      )}
                    >
                      <div className={cn(
                        "max-w-[90%] rounded-2xl p-4 text-sm leading-relaxed shadow-lg",
                        m.role === 'user' ? "bg-orange-600 text-white" : "bg-zinc-800 text-zinc-200 border border-zinc-750"
                      )}>
                        {m.parts[0].text}
                      </div>
                      <span className="text-[10px] font-black text-zinc-500 uppercase px-1 font-mono">
                        {m.role === 'user' ? 'Me' : 'Mind AI'}
                      </span>
                    </div>
                  ))
                )}
                {isTyping && (
                  <div className="flex flex-col items-start gap-1">
                    <div className="bg-zinc-800 border border-zinc-750 rounded-2xl p-4 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-zinc-850 bg-zinc-950/40">
                <div className="relative">
                    <input 
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                      placeholder="Ask Gemini about the model, dimensions, materials..."
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl pl-6 pr-14 py-4 focus:outline-none focus:ring-2 focus:ring-orange-500/30 transition-all font-medium text-sm text-zinc-100 placeholder-zinc-500"
                    />
                    <button 
                      onClick={handleSend}
                      disabled={!input.trim() || isTyping}
                      className="absolute right-2 top-2 bottom-2 bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center cursor-pointer"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
