/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc,
  collection, 
  query, 
  where, 
  onSnapshot,
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
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
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Connection test on app start
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

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

export default function App() {
  const [currentPage, setCurrentPage] = useState<'landing' | 'dashboard' | 'project'>('landing');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Set up Firebase Auth listener
  useEffect(() => {
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
          id: item.id,
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

  // Authentication actions
  const handleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setCurrentPage('dashboard');
    } catch (err: any) {
      alert("Sign-in failed. Please ensure third-party popup blockers are allowed/disabled.");
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

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F0F1F3]">
        <Loader2 className="w-10 h-10 animate-spin text-[var(--accent)]" />
        <span className="text-sm font-medium text-gray-500 mt-4 uppercase tracking-widest">ConstructMind loader...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F0F1F3]">
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
          />
        )}
        {currentPage === 'project' && selectedProject && (
          <ProjectView project={selectedProject} onBack={() => setCurrentPage('dashboard')} />
        )}
      </main>
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
    <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => onNavigate('landing')}>
        <div className="bg-[var(--accent)] p-1.5 rounded-lg">
          <Building2 className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-xl tracking-tight">ConstructMind AI</span>
      </div>
      
      <div className="hidden md:flex items-center gap-8 text-sm font-medium">
        <button onClick={() => onNavigate('landing')} className="hover:text-[var(--accent)] transition-colors cursor-pointer">How it works</button>
        {user && (
          <button onClick={() => onNavigate('dashboard')} className="hover:text-[var(--accent)] transition-colors cursor-pointer">My Projects</button>
        )}
        {user ? (
          <div className="flex items-center gap-4">
            <span className="text-gray-700 font-bold bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100 max-w-[200px] truncate">{user.displayName || user.email}</span>
            <button 
              onClick={onSignOut}
              className="bg-black text-white px-4 py-2 rounded-full hover:opacity-80 transition-opacity cursor-pointer text-xs font-bold"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <button 
            onClick={onSignIn}
            className="bg-black text-white px-5 py-2 rounded-full hover:opacity-80 transition-opacity cursor-pointer text-xs font-bold"
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
    <div className="flex-1 flex flex-col items-center justify-center px-4 overflow-hidden py-20">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl text-center space-y-8"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-100 text-[var(--accent)] text-xs font-bold uppercase tracking-wider mb-2">
          <Building2 className="w-3 h-3" />
          The Future of BIM Analysis
        </div>
        
        <h1 className="text-6xl md:text-8xl font-black tracking-tight leading-[0.9] text-gray-900">
          YOUR BUILDING <br />
          <span className="text-[var(--accent)]">DEMANDS ANSWERS</span>
        </h1>
        
        <p className="text-xl text-gray-600 max-w-2xl mx-auto font-medium">
          Upload your IFC files and interact with your construction project in natural language. Powered by Gemini AI.
        </p>
        
        <div className="flex items-center justify-center gap-4 pt-4">
          <button 
            onClick={onGetStarted}
            className="group relative bg-black text-white px-8 py-4 rounded-full text-lg font-bold hover:scale-105 transition-all overflow-hidden cursor-pointer"
          >
            <span className="relative z-10 flex items-center gap-2">
              {user ? "Launch Assistant" : "Sign In to Start"} <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </span>
          </button>
        </div>
      </motion.div>

      {/* Decorative Grid */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(#d1d5db_1px,transparent_1px)] [background-size:40px_40px] opacity-20"></div>
    </div>
  );
}

function Dashboard({ projects, onProjectAdded, onSelectProject }: { 
  projects: Project[], 
  onProjectAdded: (p: Project) => void,
  onSelectProject: (id: string) => void
}) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      alert('File is too large. Maximum size is 50MB due to network constraints.');
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
      try {
        data = await resp.json();
      } catch (e) {
        throw new Error('Failed to parse upload response. The server may be under heavy load.');
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
      alert(err.message || 'Upload failed. Ensure you select a valid IFC file.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex-1 p-8 max-w-7xl mx-auto w-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Project Dashboard</h2>
          <p className="text-gray-500 font-medium">Manage your building analysis projects</p>
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

      {projects.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 rounded-3xl p-20 flex flex-col items-center justify-center text-center space-y-4">
          <div className="bg-gray-100 p-4 rounded-full">
            <Building2 className="w-12 h-12 text-gray-400" />
          </div>
          <h3 className="text-xl font-bold">No projects yet</h3>
          <p className="text-gray-500 max-w-xs">Upload your first building model (.ifc) to start the AI analysis.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((p) => (
            <motion.div 
              key={p.id} 
              layoutId={p.id}
              whileHover={{ y: -5 }}
              onClick={() => onSelectProject(p.id)}
              className="card cursor-pointer group"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="bg-orange-50 p-3 rounded-2xl">
                    <FileText className="w-6 h-6 text-[var(--accent)]" />
                  </div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">{p.id.slice(0,8)}</span>
                </div>
                <div>
                  <h4 className="font-bold text-lg leading-tight group-hover:text-[var(--accent)] transition-colors">{p.name}</h4>
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                    <Clock className="w-3 h-3" />
                    {new Date(p.uploadedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-4">
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <div className="text-[10px] uppercase font-bold text-gray-400">Elements</div>
                    <div className="text-base font-bold">{p.summary.elements.total}</div>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <div className="text-[10px] uppercase font-bold text-gray-400">Floors</div>
                    <div className="text-base font-bold">{p.summary.structure.floors.length}</div>
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

import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Stars, Center } from '@react-three/drei';
import { IFCLoader } from 'web-ifc-three/IFCLoader';
import * as THREE from 'three';

function BIMPreview({ project }: { project: Project }) {
  const [model, setModel] = useState<THREE.Object3D | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadModel() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const loader = new IFCLoader();
        // Serve web-ifc.wasm locally from the app server to prevent third-party constraints, CORS, or sandbox errors
        loader.ifcManager.setWasmPath(window.location.origin + '/');
        
        loader.load(
          `/api/projects/${project.id}/file`,
          (ifcModel) => {
            if (active) {
              // Standard materials for better visibility
              ifcModel.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                  const mesh = child as THREE.Mesh;
                  // If no material or default, give it something nice
                  if (!mesh.material || (Array.isArray(mesh.material) && mesh.material.length === 0)) {
                    mesh.material = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
                  }
                  mesh.castShadow = true;
                  mesh.receiveShadow = true;
                }
              });
              setModel(ifcModel);
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
      } catch (err) {
        console.error("Loader Init Error:", err);
        if (active) {
          setLoadError("3D Engine init failed.");
          setIsLoading(false);
        }
      }
    }

    loadModel();
    return () => { active = false; };
  }, [project.id]);

  const floors = project.summary.structure.floors;
  const elementDetails = project.summary.elements.details || [];
  
  // Group elements by floor
  const elementsPerFloor = floors.reduce((acc: any, floor: any) => {
    acc[floor.id] = elementDetails.filter((el: any) => el.storeyId === floor.id);
    return acc;
  }, {});

  // For elements without a specific floor, assign to first floor
  const orphanedElements = elementDetails.filter((el: any) => !el.storeyId);
  if (floors.length > 0) {
    const baseFloorId = floors[0].id;
    elementsPerFloor[baseFloorId] = [...(elementsPerFloor[baseFloorId] || []), ...orphanedElements];
  }

  const storyHeight = 3.5;
  const houseWidth = 10;
  const houseDepth = 8;

  return (
    <div className="w-full h-full bg-[#f3f4f6] rounded-3xl overflow-hidden relative border border-gray-200 shadow-2xl">
      <div className="absolute top-4 left-4 z-10">
        <div className="bg-white/95 backdrop-blur-md border border-gray-200 rounded-2xl p-4 text-[11px] text-gray-800 font-sans shadow-xl min-w-[220px]">
          <div className="flex items-center gap-2 mb-3 border-b border-gray-100 pb-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse"></div>
            <span className="font-bold tracking-tight uppercase text-gray-500">Structural Assembly</span>
          </div>
          <div className="space-y-2 opacity-90">
            <div className="flex justify-between font-medium"><span>Levels Detected</span> <span className="text-blue-600 font-bold">{floors.length}</span></div>
            <div className="flex justify-between font-medium"><span>Total Elements</span> <span className="text-gray-900">{project.summary.elements.total}</span></div>
            <div className="flex justify-between font-medium"><span>Walls Map</span> <span className="text-gray-900">{project.summary.elements.types.Walls || 0}</span></div>
          </div>
        </div>
      </div>

      <Canvas shadows gl={{ antialias: true }} camera={{ position: [20, 20, 20], fov: 40 }}>
        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
        
        {/* Higher fidelity lighting */}
        <ambientLight intensity={0.8} />
        <directionalLight 
          position={[30, 40, 30]} 
          intensity={1.5} 
          castShadow 
          shadow-mapSize={[2048, 2048]}
        />
        <pointLight position={[-20, 20, -20]} intensity={0.5} />
        
        {/* Environment - Site Base */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.25, 0]} receiveShadow>
          <boxGeometry args={[100, 100, 0.5]} />
          <meshStandardMaterial color="#3a5a40" roughness={0.9} />
        </mesh>
        
        <Grid 
          infiniteGrid 
          fadeDistance={100} 
          cellColor="#d1d5db" 
          sectionColor="#9ca3af" 
          cellSize={1} 
          sectionSize={10}
        />

        {model ? (
          <Center top>
            <primitive object={model} />
          </Center>
        ) : (
          /* Fallback Building Reconstruction */
          <group>
            {floors.length > 0 ? (
              floors.map((floor: any, i: number) => {
                const elev = floor.elevation || i * storyHeight;
                return (
                  <group key={floor.id} position={[0, elev, 0]}>
                    <mesh position={[0, -0.1, 0]} receiveShadow castShadow>
                      <boxGeometry args={[houseWidth, 0.2, houseDepth]} />
                      <meshStandardMaterial color="#f9fafb" />
                    </mesh>
                    <group position={[0, storyHeight/2, 0]}>
                       <mesh position={[0, 0, houseDepth/2]}><boxGeometry args={[houseWidth, storyHeight, 0.2]} /><meshStandardMaterial color="#ffffff" /></mesh>
                       <mesh position={[0, 0, -houseDepth/2]}><boxGeometry args={[houseWidth, storyHeight, 0.2]} /><meshStandardMaterial color="#ffffff" /></mesh>
                       <mesh position={[houseWidth/2, 0, 0]} rotation={[0, Math.PI/2, 0]}><boxGeometry args={[houseDepth, storyHeight, 0.2]} /><meshStandardMaterial color="#ffffff" /></mesh>
                       <mesh position={[-houseWidth/2, 0, 0]} rotation={[0, Math.PI/2, 0]}><boxGeometry args={[houseDepth, storyHeight, 0.2]} /><meshStandardMaterial color="#ffffff" /></mesh>
                    </group>
                    {i === floors.length - 1 && (
                      <mesh position={[0, storyHeight, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
                        <coneGeometry args={[houseWidth * 0.75, 4, 4]} />
                        <meshStandardMaterial color="#c2410c" />
                      </mesh>
                    )}
                  </group>
                );
              })
            ) : (
              <Center top>
                <mesh castShadow><boxGeometry args={[houseWidth, 5, houseDepth]} /><meshStandardMaterial color="#ffffff" /></mesh>
                <mesh position={[0, 4, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[8.5, 4, 4]} /><meshStandardMaterial color="#c2410c" /></mesh>
              </Center>
            )}
          </group>
        )}
      </Canvas>
      
      <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-2">
        {isLoading && (
          <div className="bg-white/90 backdrop-blur-md border border-blue-100 rounded-full px-4 py-1.5 flex items-center gap-2 text-[10px] font-bold text-blue-600 shadow-lg">
             <Loader2 className="w-3 h-3 animate-spin" />
             PARSING ACCURATE GEOMETRY...
          </div>
        )}
        {loadError && (
          <div className="bg-orange-50 border border-orange-100 rounded-lg px-3 py-1.5 text-[9px] font-bold text-orange-600 shadow-md">
             {loadError}
          </div>
        )}
      </div>

      <div className="absolute bottom-4 right-4 z-10 flex flex-col items-end gap-1">
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest bg-white/70 px-4 py-1.5 rounded-full backdrop-blur-md border border-gray-100 shadow-sm">
          {model ? "BIM Fidelity Render: High" : "BIM Fidelity Render: Schematic"}
        </div>
      </div>
    </div>
  );
}

function ProjectView({ project, onBack }: { project: Project, onBack: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'chat' | 'split'>('split');

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

      if (!resp.ok) {
        const errorText = await resp.text();
        throw new Error(`Chat error: ${resp.status} - ${errorText.slice(0, 100)}`);
      }

      let data;
      try {
        data = await resp.json();
      } catch (e) {
        throw new Error('Failed to parse chat response.');
      }
      setMessages(prev => [...prev, { role: 'model', parts: [{ text: data.text }] }]);
    } catch (err: any) {
       console.error(err);
       setMessages(prev => [...prev, { role: 'model', parts: [{ text: `Sorry, I encountered an error: ${err.message}` }] }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex-1 flex h-[calc(100vh-64px)] overflow-hidden">
      {/* Sidebar - Project Info */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col hidden lg:flex shrink-0">
        <div className="p-6 border-b border-gray-200">
          <button onClick={onBack} className="text-xs font-bold text-gray-500 flex items-center gap-1 mb-4 hover:text-black">
            <LayoutDashboard className="w-3 h-3" />
            BACK TO DASHBOARD
          </button>
          <h3 className="text-xl font-bold truncate">{project.name}</h3>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex flex-col gap-2">
            <button 
              onClick={() => setViewMode('split')}
              className={cn("w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2", viewMode === 'split' ? "bg-black text-white" : "bg-gray-100 text-gray-600")}
            >
              <LayoutDashboard className="w-4 h-4" />
              ANALYSIS VIEW
            </button>
            <button 
               onClick={() => setViewMode('chat')}
               className={cn("w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2", viewMode === 'chat' ? "bg-black text-white" : "bg-gray-100 text-gray-600")}
            >
              <MessageSquare className="w-4 h-4" />
              FULL CHAT
            </button>
          </div>

          <div>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Model Statistics</h4>
            <div className="space-y-2">
              {project.summary && project.summary.elements ? Object.entries(project.summary.elements.types).map(([type, count]) => (
                <div key={type} className="flex justify-between text-sm py-1 border-b border-gray-50">
                  <span className="text-gray-600">{type}</span>
                  <span className="font-mono font-bold">{count}</span>
                </div>
              )) : <div className="text-xs text-gray-400 italic">No element data available</div>}
            </div>
          </div>

          <div>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Spatial Hierarchy</h4>
            <div className="space-y-2">
              {project.summary && project.summary.structure && project.summary.structure.floors && project.summary.structure.floors.length > 0 ? project.summary.structure.floors.map((f, i) => (
                <div key={i} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-sm font-medium">
                  <Layers className="w-4 h-4 text-gray-400" />
                  {f.name}
                </div>
              )) : <div className="text-xs text-gray-400 italic">No floor data available</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className={cn("flex-1 flex", viewMode === 'split' ? "flex-col md:flex-row" : "flex-col")}>
        {/* 3D Viewer / Data Panel */}
        {viewMode === 'split' && (
          <div className="flex-1 min-h-[300px] p-6 bg-gray-50 flex flex-col gap-4">
             <BIMPreview project={project} />
          </div>
        )}

        {/* Chat Area */}
        <div className={cn("flex flex-col bg-white border-l border-gray-200", viewMode === 'split' ? "w-full md:w-[450px]" : "flex-1")}>
          <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 max-w-sm mx-auto opacity-50 pt-20">
                <div className="bg-orange-50 p-4 rounded-3xl">
                  <MessageSquare className="w-8 h-8 text-[var(--accent)]" />
                </div>
                <p className="font-medium text-gray-600">Ask anything about the building model.</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {["How many windows?", "Floor details?", "Materials?"].map(q => (
                    <button 
                      key={q} 
                      onClick={() => setInput(q)}
                      className="text-[10px] px-3 py-1 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors font-bold uppercase tracking-tight"
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
                    "flex flex-col gap-1",
                    m.role === 'user' ? "items-end" : "items-start"
                  )}
                >
                  <div className={cn(
                    "max-w-[90%] rounded-2xl p-4 text-sm leading-relaxed",
                    m.role === 'user' ? "bg-black text-white" : "bg-gray-100 text-gray-800 shadow-sm"
                  )}>
                    {m.parts[0].text}
                  </div>
                  <span className="text-[10px] font-bold text-gray-300 uppercase px-1">
                    {m.role === 'user' ? 'Me' : 'Mind AI'}
                  </span>
                </div>
              ))
            )}
            {isTyping && (
              <div className="flex flex-col items-start gap-1">
                <div className="bg-gray-100 rounded-2xl p-4">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                </div>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-gray-100">
            <div className="relative">
                <input 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Query building data..."
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-6 pr-14 py-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition-all font-medium text-sm"
                />
                <button 
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="absolute right-2 top-2 bottom-2 bg-[var(--accent)] text-white p-3 rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  <Send className="w-5 h-5" />
                </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
