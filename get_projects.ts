import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function main() {
  console.log("Fetching projects...");
  const querySnapshot = await getDocs(collection(db, "projects"));
  console.log(`Found ${querySnapshot.size} projects:`);
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    console.log("- ID:", doc.id);
    console.log("  Name:", data.name);
    console.log("  UploadedAt:", data.uploadedAt);
    if (data.summary) {
      console.log("  Summary keys:", Object.keys(data.summary));
      if (data.summary.metadata) {
        console.log("  Metadata:", data.summary.metadata);
      }
      if (data.summary.structure) {
        console.log("  Floors:", data.summary.structure.floors);
      }
      if (data.summary.elements) {
        console.log("  Elements Types:", data.summary.elements.types);
        if (data.summary.elements.details) {
          const spaces = data.summary.elements.details.filter((d: any) => d.type === 'Spaces');
          console.log(`  Spaces count: ${spaces.length}`);
          console.log(`  First 3 spaces:`, spaces.slice(0, 3));
        }
      }
    }
  });
  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
