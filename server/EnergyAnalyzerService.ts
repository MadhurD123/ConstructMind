import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

export class EnergyAnalyzerService {
  static async analyzeProject(projectSummary: any, projectName: string) {
    const floorsCount = Math.max(1, projectSummary.structure?.floors?.length || 1);
    const spaces = projectSummary.elements?.details?.filter((d: any) => d.type === 'Spaces') || [];
    const roomsCount = Math.max(spaces.length, projectSummary.elements?.types?.Spaces || projectSummary.elements?.types?.IFCSPACE || 6);
    const windowCount = projectSummary.elements?.types?.Windows || projectSummary.elements?.types?.IFCWINDOW || 12;
    const wallCount = (projectSummary.elements?.types?.Walls || 0) + (projectSummary.elements?.types?.StandardWalls || 0) || 24;
    
    // Area Estimation: Standard room average area of 22sqm + common areas
    const estimatedArea = Math.max(80, roomsCount * 22);
    
    // Natural Lighting Score (0-100) based on window-to-wall ratio (WWR)
    const wwr = windowCount / Math.max(1, wallCount);
    const naturalLightingScore = Math.min(100, Math.round(wwr * 320));
    
    // Cooling Load (kW) - base cooling + solar window gain
    const baseCoolingLoad = (estimatedArea * 85) / 1000;
    const coolingLoadEstimate = Math.round((baseCoolingLoad * (1 + (windowCount * 0.035))) * 100) / 100;
    
    // Heating Load (kW) - base heating + window ventilation loss
    const baseHeatingLoad = (estimatedArea * 95) / 1000;
    const heatingLoadEstimate = Math.round((baseHeatingLoad * (1 + (windowCount * 0.025) - (naturalLightingScore * 0.002))) * 100) / 100;
    
    // Annual Energy Consumption (kWh/yr)
    const annualCoolingHours = 1200;
    const annualHeatingHours = 1500;
    const coolingConsumption = coolingLoadEstimate * 0.42 * annualCoolingHours;
    const heatingConsumption = heatingLoadEstimate * 0.48 * annualHeatingHours;
    const electricalBaseConsumption = estimatedArea * 42; // lighting, plug loads, appliances
    const annualEnergyConsumption = Math.round(coolingConsumption + heatingConsumption + electricalBaseConsumption);
    
    // Carbon Footprint: estimated in Metric Tons of CO2/year (using general grid intensity of 0.40 kg CO2 per kWh)
    const carbonFootprint = Math.round((annualEnergyConsumption * 0.40 / 1000) * 100) / 100;

    const prompt = `
      You are a certified green-building consultant and sustainability engineer.
      Analyze the following building metrics for the project "${projectName}" and generate a professional sustainability report.
      
      Building Specifications:
      - Total Estimated Floor Area: ${estimatedArea} m²
      - Number of Floors: ${floorsCount}
      - Number of Rooms/Spaces: ${roomsCount}
      - Window Count: ${windowCount}
      - Wall Count: ${wallCount}
      - Peak Cooling Load (Calculated): ${coolingLoadEstimate} kW
      - Peak Heating Load (Calculated): ${heatingLoadEstimate} kW
      - Natural Daylighting Score: ${naturalLightingScore}/100
      - Annual Energy Consumption (Estimated): ${annualEnergyConsumption} kWh
      - Annual Carbon Footprint (Estimated): ${carbonFootprint} Metric Tons of CO2
      
      Generate a sustainability rating (energyScore: 0-100) and actionable sustainability recommendations.
      The rating must consider the design:
      - Balanced window-to-wall ratios with decent daylighting should yield scores in the 70s or 80s.
      - Extremely high windows with excessive cooling loads should degrade the score.
      - Poor ventilation or window counts should yield lower scores.
      
      The energyScore ranges:
      - 0-40 = Poor
      - 41-60 = Average
      - 61-80 = Good
      - 81-100 = Excellent

      Ensure the output strictly adheres to the JSON schema specified. Do not wrap the JSON response in backticks or markdown code fences. Return raw JSON text.
    `;

    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("Missing GEMINI_API_KEY");
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              energyScore: { type: Type.INTEGER, description: "Calculated green-building score from 0 to 100" },
              sustainabilityRating: { type: Type.STRING, description: "One of: Poor, Average, Good, Excellent" },
              sustainabilitySummary: { type: Type.STRING, description: "A detailed 3-4 sentence professional architectural sustainability summary" },
              recommendations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Array of exactly 5 actionable, structural energy efficiency improvements"
              }
            },
            required: ["energyScore", "sustainabilityRating", "sustainabilitySummary", "recommendations"]
          }
        }
      });

      const data = JSON.parse(response.text || "{}");
      return {
        energyScore: data.energyScore || 72,
        sustainabilityRating: data.sustainabilityRating || "Good",
        annualEnergyConsumption,
        carbonFootprint,
        coolingLoadEstimate,
        heatingLoadEstimate,
        naturalLightingScore,
        sustainabilitySummary: data.sustainabilitySummary || "The building exhibits moderate thermal efficiency with notable lighting gains. Insulating key window systems will significantly curtail annual cooling load peak spikes.",
        recommendations: data.recommendations || [
          "Install low-E double glazed panel systems to minimize summer solar heat gain coefficient.",
          "Incorporate external louvers or shading devices on southern and western window facades.",
          "Enhance roof cavity and wall cavity insulation with R-30 equivalent spray foam.",
          "Utilize energy recovery ventilators (ERV) to pre-condition fresh air intake drafts.",
          "Incorporate roof-mounted Solar Photovoltaic arrays to offset base grid electric consumption."
        ]
      };
    } catch (err) {
      console.warn("Failed calling Gemini for Energy Analysis, using fallback generator:", err);
      const score = Math.max(30, Math.min(95, Math.round(50 + (naturalLightingScore * 0.3) + (floorsCount * 2))));
      let rating = "Average";
      if (score > 80) rating = "Excellent";
      else if (score > 60) rating = "Good";
      else if (score < 40) rating = "Poor";

      return {
        energyScore: score,
        sustainabilityRating: rating,
        annualEnergyConsumption,
        carbonFootprint,
        coolingLoadEstimate,
        heatingLoadEstimate,
        naturalLightingScore,
        sustainabilitySummary: "The building model displays functional room layouts with moderate heat transfer boundaries. Upgrading external panels is recommended for modern sustainability compliance.",
        recommendations: [
          "Install low-E double glazed panel systems to minimize summer solar heat gain coefficient.",
          "Incorporate external louvers or shading devices on southern and western window facades.",
          "Enhance roof cavity and wall cavity insulation with R-30 equivalent spray foam.",
          "Utilize energy recovery ventilators (ERV) to pre-condition fresh air intake drafts.",
          "Incorporate roof-mounted Solar Photovoltaic arrays to offset base grid electric consumption."
        ]
      };
    }
  }
}
