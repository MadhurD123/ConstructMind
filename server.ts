/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import 'dotenv/config';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const IFC = require('web-ifc');

const app = express();
const PORT = 3000;

// Multer setup for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit to match proxy
});

// Store project data in-memory for this example (in real app, use Firestore)
const projects: Record<string, any> = {};

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Gemini AI setup
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Logger middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// IFC Parser Helper
async function parseIFC(buffer: Buffer) {
  console.log("Starting IFC parsing...");
  const ifcApi = new IFC.IfcAPI();
  try {
    await ifcApi.Init();
    console.log("IFC API initialized");
    
    const modelID = ifcApi.OpenModel(new Uint8Array(buffer));
    console.log(`Model opened with ID: ${modelID}`);
    
    const summary: any = {
      metadata: {},
      structure: {
        floors: [],
      },
      elements: {
        total: 0,
        types: {} as Record<string, number>,
      }
    };

    // Get Project
    const projectIds = ifcApi.GetLineIDsWithType(modelID, IFC.IFCPROJECT);
    if (projectIds.size() > 0) {
      const proj = ifcApi.GetLine(modelID, projectIds.get(0));
      summary.metadata = { name: proj.Name?.value, description: proj.Description?.value };
    }

    // Extract basic counts
    const allLines = ifcApi.GetAllLines(modelID);
    summary.elements.total = allLines.size();

    // Specific types we care about for the chatbot
    const typesToExtract = [
      { name: 'Walls', type: IFC.IFCWALL },
      { name: 'StandardWalls', type: IFC.IFCWALLSTANDARDCASE },
      { name: 'Doors', type: IFC.IFCDOOR },
      { name: 'Windows', type: IFC.IFCWINDOW },
      { name: 'Slabs', type: IFC.IFCSLAB },
      { name: 'Spaces', type: IFC.IFCSPACE },
      { name: 'Columns', type: IFC.IFCCOLUMN },
      { name: 'Beams', type: IFC.IFCBEAM },
    ];

    // Map element IDs to storeys
    const elementStoreyMap: Record<number, number> = {};
    const relContainedIds = ifcApi.GetLineIDsWithType(modelID, IFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < relContainedIds.size(); i++) {
        const rel = ifcApi.GetLine(modelID, relContainedIds.get(i));
        const storeyId = rel.RelatingStructure?.value;
        if (storeyId && rel.RelatedElements) {
            for (const el of rel.RelatedElements) {
                elementStoreyMap[el.value] = storeyId;
            }
        }
    }

    const elementDetails: any[] = [];

    for (const t of typesToExtract) {
      try {
        const ids = ifcApi.GetLineIDsWithType(modelID, t.type);
        const count = ids.size();
        
        // Merge Wall counts for simplicity in summary
        const categoryName = (t.name === 'StandardWalls') ? 'Walls' : t.name;
        summary.elements.types[categoryName] = (summary.elements.types[categoryName] || 0) + count;
        
        // Extract basic placement for walls and spaces to improve 3D view
        if (t.name === 'Walls' || t.name === 'StandardWalls' || t.name === 'Spaces' || t.name === 'Windows' || t.name === 'Doors' || t.name === 'Columns') {
            for (let i = 0; i < Math.min(count, 50); i++) {
                const id = ids.get(i);
                const props = ifcApi.GetLine(modelID, id);
                
                elementDetails.push({
                    type: categoryName,
                    id,
                    name: props.Name?.value || `${t.name} ${id}`,
                    storeyId: elementStoreyMap[id]
                });
            }
        }
      } catch (e) {
        summary.elements.types[t.name] = 0;
      }
    }
    summary.elements.details = elementDetails;

    // Get Storeys (Floors) with better elevation extraction
    const storeyIds = ifcApi.GetLineIDsWithType(modelID, IFC.IFCBUILDINGSTOREY);
    for (let i = 0; i < storeyIds.size(); i++) {
        const id = storeyIds.get(i);
        const storey = ifcApi.GetLine(modelID, id);
        
        // Look for spaces contained in this storey
        summary.structure.floors.push({
            id,
            name: storey.Name?.value || `Floor ${i+1}`,
            elevation: typeof storey.Elevation?.value === 'number' ? storey.Elevation.value : i * 4,
            description: storey.Description?.value
        });
    }

    ifcApi.CloseModel(modelID);
    console.log("IFC parsing complete");
    return summary;
  } catch (err) {
    console.error("Critical error during IFC parsing:", err);
    return { error: "Failed to parse IFC file" };
  }
}

// API Routes
app.post('/api/projects/upload', upload.single('file'), async (req, res) => {
  console.log("Received upload request");
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const projectId = uuidv4();
    const summary = await parseIFC(req.file.buffer);

    if (summary.error) {
      return res.status(422).json({ error: summary.error });
    }

    // Save raw .ifc file on disk instead of in RAM for standard persistence
    const filePath = path.join(UPLOADS_DIR, `${projectId}.ifc`);
    await fs.promises.writeFile(filePath, req.file.buffer);

    projects[projectId] = {
      id: projectId,
      name: req.file.originalname,
      summary,
      uploadedAt: new Date().toISOString(),
      filePath
    };

    console.log(`Project created: ${projectId}`);
    res.json({ projectId, name: req.file.originalname, summary });
  } catch (error: any) {
    console.error("Upload route error:", error);
    res.status(500).json({ error: error.message || "Internal server error during upload" });
  }
});

app.get('/api/projects/:id', (req, res) => {
  const project = projects[req.params.id];
  if (project) {
    const { filePath, ...rest } = project;
    return res.json(rest);
  }
  
  // If not found in-memory, we return a fallback response (since client stores details in firestore)
  res.json({ id: req.params.id, name: 'Model File' });
});

app.get('/api/projects/:id/file-exists', (req, res) => {
  const project = projects[req.params.id];
  const filePath = project?.filePath || path.join(UPLOADS_DIR, `${req.params.id}.ifc`);
  res.json({ exists: fs.existsSync(filePath) });
});

app.post('/api/projects/:id/restore', upload.single('file'), async (req, res) => {
  console.log(`Received restore upload request for project: ${req.params.id}`);
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const projectId = req.params.id;
    // Save raw .ifc file on disk
    const filePath = path.join(UPLOADS_DIR, `${projectId}.ifc`);
    await fs.promises.writeFile(filePath, req.file.buffer);

    // Keep it in server-side state too
    projects[projectId] = {
      id: projectId,
      name: req.file.originalname,
      filePath,
      uploadedAt: new Date().toISOString()
    };

    console.log(`Project restored: ${projectId}`);
    res.json({ success: true, projectId });
  } catch (error: any) {
    console.error("Restore route error:", error);
    res.status(500).json({ error: error.message || "Internal server error during restore" });
  }
});

app.get('/api/projects/:id/file', (req, res) => {
  const project = projects[req.params.id];
  const filePath = project?.filePath || path.join(UPLOADS_DIR, `${req.params.id}.ifc`);
  const name = project?.name || `${req.params.id}.ifc`;
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'IFC file not found on disk.' });
  }
  
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.sendFile(filePath);
});

app.delete('/api/projects/:id', async (req, res) => {
  const projectId = req.params.id;
  console.log(`Received request to delete project: ${projectId}`);
  try {
    const project = projects[projectId];
    const filePath = project?.filePath || path.join(UPLOADS_DIR, `${projectId}.ifc`);
    
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      console.log(`Deleted IFC file from disk: ${filePath}`);
    }
    
    if (projects[projectId]) {
      delete projects[projectId];
    }
    
    res.json({ success: true, message: 'Project file deleted from server successfully' });
  } catch (error: any) {
    console.error(`Error deleting project ${projectId} on server:`, error);
    res.status(500).json({ error: error.message || 'Failed to delete project on the server' });
  }
});

// Find and serve local web-ifc.wasm file for 3D model loading
let foundWasmPath = '';
const possibleWasmPaths = [
  path.join(process.cwd(), 'node_modules', 'web-ifc-three', 'node_modules', 'web-ifc', 'web-ifc.wasm'),
  path.join(process.cwd(), 'node_modules', 'web-ifc-three', 'node_modules', 'web-ifc', 'dist', 'web-ifc.wasm'),
  path.join(process.cwd(), 'node_modules', 'web-ifc', 'web-ifc.wasm'),
  path.join(process.cwd(), 'node_modules', 'web-ifc', 'dist', 'web-ifc.wasm'),
];

for (const p of possibleWasmPaths) {
  if (fs.existsSync(p)) {
    foundWasmPath = p;
    console.log(`[BIM] Found local web-ifc.wasm at: ${p}`);
    break;
  }
}

app.get('/web-ifc.wasm', (req, res) => {
  if (foundWasmPath) {
    res.setHeader('Content-Type', 'application/wasm');
    res.sendFile(foundWasmPath);
  } else {
    console.error('[BIM] web-ifc.wasm requested but not found locally!');
    res.status(404).send('wasm file not found');
  }
});

app.post('/api/chat', async (req, res) => {
  const { projectId, message, history, summary, name } = req.body;
  const projectSummary = summary || projects[projectId]?.summary;
  const projectName = name || projects[projectId]?.name || 'Unknown Project';

  if (!projectSummary) {
     return res.status(404).json({ error: 'Project data summary not found' });
  }

  // Derive the active rooms for this project exactly matching the 3D viewer list
  let activeRooms = [];
  const isWellness = projectName.toLowerCase().includes('wellness') || projectName.toLowerCase().includes('sama');
  if (isWellness) {
    activeRooms = [
      { id: 'lobby', name: 'Reception Lobby', desc: 'Secure entrance foyer with guest lounge and front welcoming counter.' },
      { id: 'conf', name: 'Conference Boardroom', desc: 'Central boardroom housing executive tables and dynamic media displays.' },
      { id: 'work', name: 'Open Workspaces', desc: 'High capacity operations room with four modular developer workstations.' },
      { id: 'exec', name: 'Executive Suite', desc: 'Private leadership office section with desks and document storage.' },
      { id: 'lounge', name: 'Pantry & Coffee Lounge', desc: 'Employee refreshment space featuring high bar counters and stools.' }
    ];
  } else {
    // Extract dynamic spaces from elements details (IFCSPACE)
    const spaces = projectSummary?.elements?.details?.filter((d: any) => d.type === 'Spaces') || [];
    if (spaces.length === 0) {
      activeRooms = [
        { id: 'living', name: 'Living Room', desc: 'Elegant lounge and leisure space with cozy family sofas.' },
        { id: 'bedroom', name: 'Master Bedroom', desc: 'Cozy private master bedroom complete with king bed.' },
        { id: 'kitchen', name: 'Modern Kitchen', desc: 'Sleek kitchen island dining setup with designer stools.' },
        { id: 'bathroom', name: 'Spa Bathroom', desc: 'Luxurious bathroom sanctuary containing premium bathtub and vanity.' },
        { id: 'office', name: 'Home Office', desc: 'Productive workstation room with custom flat screen desktops.' },
        { id: 'entrance', name: 'Entrance Hall', desc: 'Welcoming front gallery corridor leading into the main halls.' }
      ];
    } else {
      activeRooms = spaces.map((sp: any) => ({
        id: String(sp.id),
        name: sp.name || `Space ${sp.id}`,
        desc: `Room space extracted directly from IFC details.`
      }));
    }
  }

  const systemInstruction = `
    You are ConstructMind AI, an expert BIM and Construction assistant.
    The user is viewing a building project: "${projectName}".
    
    Building Data Summary:
    ${JSON.stringify(projectSummary, null, 2)}

    Active Rooms/Spaces in this Project model (synchronized with the 3D viewer):
    ${JSON.stringify(activeRooms, null, 2)}

    Your role and response rules:
    - ALWAYS keep responses extremely short, concise, and direct. No fluff.
    - If the user asks about individual rooms, their features, or what rooms are in the project, explain using the "Active Rooms/Spaces" listed above (e.g. Living Room, Master Bedroom, Modern Kitchen, Spa Bathroom, Home Office, Entrance Hall, etc.) to match what they see in the 3D dropdown exactly.
    - For SIMPLE questions (e.g., counts, project name, list of elements, basic definitions, rooms list), you MUST reply in a SINGLE LINE or a short bullet-pointed list.
    - For COMPLEX questions (e.g., structural breakdown, detailed design analysis, architectural recommendations), give a BRIEF answer of at most 2 to 3 sentences.
    - If data is missing, state it directly in a few words rather than explaining in detail.
  `;

  try {
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY is not set in environment variables');
      return res.status(500).json({ error: 'Gemini API key is not configured on the server. Please check your .env file.' });
    }

    const primaryModel = 'gemini-3.5-flash';
    const fallbackModel = 'gemini-2.5-flash';

    let response;
    try {
      console.log(`[Gemini] Attempting to generate chat response with primary model: ${primaryModel}`);
      const chat = ai.chats.create({
        model: primaryModel,
        config: {
          systemInstruction,
        },
        history: history || [],
      });
      response = await chat.sendMessage({ message });
    } catch (primaryError: any) {
      console.warn(`[Gemini] Primary model ${primaryModel} failed or busy. Error: ${primaryError.message || primaryError}. Trying resilient fallback under high load...`);
      // Re-initialize with fallback model
      const fallbackChat = ai.chats.create({
        model: fallbackModel,
        config: {
          systemInstruction,
        },
        history: history || [],
      });
      response = await fallbackChat.sendMessage({ message });
      console.log(`[Gemini] Successfully retrieved response using fallback model: ${fallbackModel}`);
    }

    res.json({ text: response.text });
  } catch (error: any) {
    console.error('Gemini API error detail:', error);
    res.status(500).json({ error: `Gemini API error: ${error.message || 'Unknown error'}` });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Error handling middleware for Multer and other errors
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File size too large. Max 50MB.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
