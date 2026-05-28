import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const IFC = require('web-ifc');

async function parseIFC(buffer: Buffer) {
  const ifcApi = new IFC.IfcAPI();
  await ifcApi.Init();
  const modelID = ifcApi.OpenModel(new Uint8Array(buffer));
  
  const summary: any = {
    metadata: {},
    structure: { floors: [] },
    elements: { total: 0, types: {} }
  };

  // Get Project
  const projectIds = ifcApi.GetLineIDsWithType(modelID, IFC.IFCPROJECT);
  if (projectIds.size() > 0) {
    const proj = ifcApi.GetLine(modelID, projectIds.get(0));
    summary.metadata = { name: proj.Name?.value, description: proj.Description?.value };
  }

  const storeyIds = ifcApi.GetLineIDsWithType(modelID, IFC.IFCBUILDINGSTOREY);
  for (let i = 0; i < storeyIds.size(); i++) {
    const id = storeyIds.get(i);
    const storey = ifcApi.GetLine(modelID, id);
    summary.structure.floors.push({
      id,
      name: storey.Name?.value || `Floor ${i+1}`,
      elevation: typeof storey.Elevation?.value === 'number' ? storey.Elevation.value : i * 4,
    });
  }

  const spaceIds = ifcApi.GetLineIDsWithType(modelID, IFC.IFCSPACE);
  summary.spaces = [];
  for (let i = 0; i < spaceIds.size(); i++) {
    const id = spaceIds.get(i);
    const space = ifcApi.GetLine(modelID, id);
    summary.spaces.push({
      id,
      name: space.Name?.value || `Space ${id}`,
      longName: space.LongName?.value
    });
  }

  ifcApi.CloseModel(modelID);
  return summary;
}

async function main() {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    console.log("Uploads directory does not exist.");
    return;
  }
  const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.ifc'));
  console.log(`Found ${files.length} IFC files:`, files);
  for (const f of files) {
    const filePath = path.join(uploadsDir, f);
    const buffer = fs.readFileSync(filePath);
    console.log(`\nParsing ${f} (${(buffer.length/1024/1024).toFixed(2)} MB)...`);
    try {
      const summary = await parseIFC(buffer);
      console.log(`Name: ${summary.metadata.name}`);
      console.log(`Description: ${summary.metadata.description}`);
      console.log(`Floors:`, summary.structure.floors);
      console.log(`Spaces count: ${summary.spaces.length}`);
      console.log(`Spaces details (all):`, summary.spaces);
    } catch (e: any) {
      console.error(`Error parsing ${f}:`, e.message || e);
    }
  }
}

main().catch(console.error);
