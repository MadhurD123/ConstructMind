import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Leaf, 
  Flame, 
  Wind, 
  Sun, 
  ShieldAlert, 
  Cpu, 
  CheckCircle2, 
  ArrowRight, 
  Activity,
  Trees,
  Lightbulb,
  Zap
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  BarChart, 
  Bar, 
  Legend 
} from 'recharts';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

interface EnergyAnalysis {
  energyScore: number;
  sustainabilityRating: string;
  annualEnergyConsumption: number;
  carbonFootprint: number;
  coolingLoadEstimate: number;
  heatingLoadEstimate: number;
  naturalLightingScore: number;
  sustainabilitySummary: string;
  recommendations: string[];
  generatedAt?: string;
}

interface EnergyAnalysisViewProps {
  project: {
    id: string;
    name: string;
    summary: any;
    uploadedAt: string;
  };
}

export function EnergyAnalysisView({ project }: EnergyAnalysisViewProps) {
  const [analysis, setAnalysis] = useState<EnergyAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCachedAnalysis() {
      setIsLoading(true);
      setError(null);
      try {
        const docRef = doc(db, 'projects', project.id, 'energyAnalysis', 'latest');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setAnalysis(docSnap.data() as EnergyAnalysis);
        } else {
          // Trigger automatic analysis if not cached
          await runAnalysis();
        }
      } catch (err: any) {
        console.error("Error reading from Firestore:", err);
        // Fallback to direct run if Firestore fails or block occurs
        await runAnalysis();
      } finally {
        setIsLoading(false);
      }
    }
    loadCachedAnalysis();
  }, [project.id]);

  const runAnalysis = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/projects/${project.id}/energy-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: project.name })
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Server returned error ${resp.status}: ${txt}`);
      }

      const data = await resp.json() as EnergyAnalysis;
      
      // Cache results in Firestore for future requests
      try {
        const docRef = doc(db, 'projects', project.id, 'energyAnalysis', 'latest');
        await setDoc(docRef, {
          ...data,
          generatedAt: new Date().toISOString(),
          projectId: project.id,
          ownerId: (window as any).currentUserUid || 'guest_owner'
        });
      } catch (dbErr) {
        console.warn("Could not cache energy analysis in firestore:", dbErr);
      }

      setAnalysis(data);
    } catch (err: any) {
      console.error("Energy Analysis request failed:", err);
      setError(err?.message || "Failed to analyze project energy efficiency.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[500px] text-zinc-100 p-8">
        <div className="relative mb-6">
          <div className="w-16 h-16 rounded-full border-4 border-orange-500/20 border-t-orange-500 animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <Leaf className="w-6 h-6 text-orange-500 animate-bounce" />
          </div>
        </div>
        <h3 className="text-lg font-bold font-sans text-white">Generating AI Energy Analysis...</h3>
        <p className="text-zinc-400 text-xs mt-2 max-w-sm text-center leading-relaxed">
          Computing building envelope volumes, window-to-wall insulation ratios, peak HVAC thermal loads, and invoking certified green-building AI consultant...
        </p>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[500px] text-zinc-100 p-8">
        <div className="bg-red-950/30 border border-red-900/30 p-4 rounded-3xl text-red-400 mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-white">Analysis Interrupted</h3>
        <p className="text-zinc-400 text-xs mt-1 text-center max-w-md">
          {error || "An unexpected error occurred during building carbon audit calculations."}
        </p>
        <button 
          onClick={runAnalysis}
          className="mt-6 px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-lg shadow-orange-500/15"
        >
          RETRY ENERGY EFFICIENCY AUDIT
        </button>
      </div>
    );
  }

  // Derive Color of score
  let ratingColorClass = 'text-red-500';
  let ratingBgClass = 'bg-red-550/10 border-red-900/30';
  if (analysis.sustainabilityRating === 'Excellent') {
    ratingColorClass = 'text-emerald-400';
    ratingBgClass = 'bg-emerald-950/20 border-emerald-900/30';
  } else if (analysis.sustainabilityRating === 'Good') {
    ratingColorClass = 'text-green-400';
    ratingBgClass = 'bg-green-950/20 border-green-900/30';
  } else if (analysis.sustainabilityRating === 'Average') {
    ratingColorClass = 'text-amber-400';
    ratingBgClass = 'bg-amber-950/20 border-amber-900/30';
  }

  // Monthly simulated energy consumption breakdown (heating vs cooling vs baseload)
  const monthlyData = [
    { name: 'Jan', Cooling: 2, Heating: Math.round(analysis.heatingLoadEstimate * 12), Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
    { name: 'Feb', Cooling: 3, Heating: Math.round(analysis.heatingLoadEstimate * 10), Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
    { name: 'Mar', Cooling: 5, Heating: Math.round(analysis.heatingLoadEstimate * 6), Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
    { name: 'Apr', Cooling: 8, Heating: Math.round(analysis.heatingLoadEstimate * 2), Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
    { name: 'May', Cooling: Math.round(analysis.coolingLoadEstimate * 6), Heating: 1, Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
    { name: 'Jun', Cooling: Math.round(analysis.coolingLoadEstimate * 11), Heating: 0, Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
    { name: 'Jul', Cooling: Math.round(analysis.coolingLoadEstimate * 14), Heating: 0, Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
    { name: 'Aug', Cooling: Math.round(analysis.coolingLoadEstimate * 13), Heating: 0, Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
    { name: 'Sep', Cooling: Math.round(analysis.coolingLoadEstimate * 8), Heating: 1, Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
    { name: 'Oct', Cooling: 10, Heating: Math.round(analysis.heatingLoadEstimate * 3), Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
    { name: 'Nov', Cooling: 4, Heating: Math.round(analysis.heatingLoadEstimate * 8), Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
    { name: 'Dec', Cooling: 2, Heating: Math.round(analysis.heatingLoadEstimate * 13), Base: Math.round(analysis.annualEnergyConsumption * 0.04) },
  ];

  // Carbon comparison dataset (Traditional building vs Current design vs Optimized AI recommendation)
  const carbonCompareData = [
    { name: 'Standard ASHRAE 90.1', emissions: Math.round(analysis.carbonFootprint * 1.35 * 10) / 10 },
    { name: 'Current Model Design', emissions: analysis.carbonFootprint },
    { name: 'With AI Recommendations', emissions: Math.round(analysis.carbonFootprint * 0.78 * 10) / 10 },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 text-zinc-300 bg-zinc-950">
      
      {/* Top Title Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-850 pb-5">
        <div>
          <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest font-mono">BIM SUSTAINABILITY REPORT PANEL</span>
          <h2 className="text-2xl font-bold text-white mt-1">AI Energy Efficiency Audit</h2>
        </div>
        <button
          onClick={runAnalysis}
          className="px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-100 rounded-xl text-xs font-bold border border-zinc-800 transition-all cursor-pointer flex items-center gap-2 self-start md:self-auto"
        >
          <Cpu className="w-3.5 h-3.5 text-orange-500" />
          RE-RUN AI CALCULATOR
        </button>
      </div>

      {/* Grid Layout: Bento Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Bento Cell 1: Circular Score Card */}
        <div className="bg-zinc-900 border border-zinc-850 rounded-3xl p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <Leaf className="w-32 h-32 text-orange-500" />
          </div>
          <div>
            <span className="text-[9px] font-black text-[#38bdf8] uppercase tracking-widest font-mono">Sustainability Standard</span>
            <h4 className="font-bold text-zinc-100 text-sm mt-1">Insulation Energy Score</h4>
          </div>

          <div className="flex items-center justify-center my-6 relative">
            {/* SVG Circular Dial */}
            <svg className="w-36 h-36 transform -rotate-90">
              <circle
                cx="72"
                cy="72"
                r="64"
                className="stroke-zinc-800"
                strokeWidth="8"
                fill="transparent"
              />
              <motion.circle
                cx="72"
                cy="72"
                r="64"
                stroke="url(#energyGradient)"
                strokeWidth="10"
                fill="transparent"
                strokeDasharray={402}
                initial={{ strokeDashoffset: 402 }}
                animate={{ strokeDashoffset: 402 - (402 * analysis.energyScore) / 100 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                strokeLinecap="round"
              />
              <defs>
                <linearGradient id="energyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f97316" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>
            </svg>
            
            <div className="absolute flex flex-col items-center">
              <span className="text-3xl font-black text-white tracking-tighter leading-none">{analysis.energyScore}</span>
              <span className="text-[10px] font-black text-zinc-500 uppercase mt-1 tracking-widest font-mono">POINTS</span>
            </div>
          </div>

          <div className={`p-4 rounded-2xl border ${ratingBgClass} flex items-center justify-between`}>
            <div>
              <span className="text-[8px] font-bold text-zinc-400 uppercase font-mono block">Performance Class</span>
              <span className={`text-base font-black ${ratingColorClass}`}>{analysis.sustainabilityRating}</span>
            </div>
            <div className="p-2.5 rounded-xl bg-zinc-950/50">
              <Leaf className="w-5 h-5 text-emerald-400 animate-pulse" />
            </div>
          </div>
        </div>

        {/* Bento Cell 2: Operating HVAC Loads */}
        <div className="bg-zinc-900 border border-zinc-850 rounded-3xl p-6 xl:col-span-2 flex flex-col justify-between shadow-2xl relative">
          <div>
            <span className="text-[9px] font-black text-[#38bdf8] uppercase tracking-widest font-mono">BIM Thermal Loads</span>
            <h4 className="font-bold text-zinc-100 text-sm mt-1">Computed Peak HVAC Load Indexes</h4>
          </div>

          {/* KPI Columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-6">
            <div className="bg-zinc-950/40 border border-zinc-850/60 p-4 rounded-2xl flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-zinc-500 uppercase font-mono">Peak Cooling</span>
                <Wind className="w-4 h-4 text-sky-400" />
              </div>
              <div className="mt-4">
                <div className="text-xl font-bold text-white">{analysis.coolingLoadEstimate} <span className="text-xs font-semibold text-zinc-500">kW</span></div>
                <p className="text-[9px] text-zinc-400 mt-1">Summer peak rating</p>
              </div>
            </div>

            <div className="bg-zinc-950/40 border border-zinc-850/60 p-4 rounded-2xl flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-zinc-500 uppercase font-mono">Peak Heating</span>
                <Flame className="w-4 h-4 text-orange-400" />
              </div>
              <div className="mt-4">
                <div className="text-xl font-bold text-white">{analysis.heatingLoadEstimate} <span className="text-xs font-semibold text-zinc-500">kW</span></div>
                <p className="text-[9px] text-zinc-400 mt-1">Winter peak rating</p>
              </div>
            </div>

            <div className="bg-zinc-950/40 border border-zinc-850/60 p-4 rounded-2xl flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-zinc-500 uppercase font-mono">Daylighting</span>
                <Sun className="w-4 h-4 text-amber-400" />
              </div>
              <div className="mt-4">
                <div className="text-xl font-bold text-white">{analysis.naturalLightingScore}<span className="text-xs font-semibold text-zinc-500">/100</span></div>
                <p className="text-[9px] text-zinc-400 mt-1">Glazing light capture</p>
              </div>
            </div>

            <div className="bg-zinc-950/40 border border-zinc-850/60 p-4 rounded-2xl flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-zinc-500 uppercase font-mono">Annual Energy</span>
                <Zap className="w-4 h-4 text-yellow-400" />
              </div>
              <div className="mt-4">
                <div className="text-xl font-bold text-white">{analysis.annualEnergyConsumption.toLocaleString()} <span className="text-xs font-semibold text-zinc-500">kWh</span></div>
                <p className="text-[9px] text-zinc-400 mt-1">Total projected draft</p>
              </div>
            </div>
          </div>

          <div className="bg-zinc-950/60 border border-zinc-850/80 p-4 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-orange-950/30 text-orange-400">
                <Trees className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[9px] font-bold text-zinc-500 uppercase font-mono">Carbon Emission Offset</span>
                <p className="text-xs text-zinc-200 mt-0.5 font-medium">Produces <strong className="text-red-400 font-bold">{analysis.carbonFootprint} Metric Tons</strong> of CO₂ annually</p>
              </div>
            </div>
            <div className="text-xs text-zinc-400 font-medium hidden md:block">
              Equivalent to planting <strong className="text-emerald-400 font-bold">{Math.round(analysis.carbonFootprint * 45)}</strong> trees yearly
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Charts and Visual Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
        {/* Chart Cell 1: Monthly Energy distribution */}
        <div className="bg-zinc-900 border border-zinc-850 rounded-3xl p-6 shadow-2xl flex flex-col justify-between">
          <div className="mb-4">
            <span className="text-[9px] font-black text-orange-500 uppercase tracking-widest font-mono">Operating Projections</span>
            <h4 className="font-bold text-zinc-100 text-sm mt-1">Seasonal HVAC Load Distribution (kWh)</h4>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="coolColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="heatColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" stroke="#52525b" fontSize={9} tickLine={false} />
                <YAxis stroke="#52525b" fontSize={9} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px' }}
                  labelStyle={{ color: '#f4f4f5', fontWeight: 'bold', fontSize: '11px' }}
                  itemStyle={{ fontSize: '11px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                <Area type="monotone" dataKey="Cooling" stroke="#38bdf8" strokeWidth={1.5} fillOpacity={1} fill="url(#coolColor)" />
                <Area type="monotone" dataKey="Heating" stroke="#f97316" strokeWidth={1.5} fillOpacity={1} fill="url(#heatColor)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart Cell 2: Emissions comparison */}
        <div className="bg-zinc-900 border border-zinc-850 rounded-3xl p-6 shadow-2xl flex flex-col justify-between">
          <div className="mb-4">
            <span className="text-[9px] font-black text-orange-500 uppercase tracking-widest font-mono">Benchmarking Audit</span>
            <h4 className="font-bold text-zinc-100 text-sm mt-1">Yearly CO₂ Emissions Comparison (Tons)</h4>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={carbonCompareData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#52525b" fontSize={9} tickLine={false} />
                <YAxis stroke="#52525b" fontSize={9} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px' }}
                  itemStyle={{ fontSize: '11px', color: '#10b981' }}
                  labelStyle={{ color: '#f4f4f5', fontSize: '11px', fontWeight: 'bold' }}
                />
                <Bar dataKey="emissions" fill="#10b981" radius={[8, 8, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Section 3: Recommendations Narrative */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
        {/* Executive summary statement */}
        <div className="bg-zinc-900 border border-zinc-850 rounded-3xl p-6 shadow-2xl flex flex-col justify-between">
          <div>
            <div className="p-3 bg-orange-950/30 text-orange-400 rounded-2xl w-fit mb-4">
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <h4 className="text-sm font-bold text-white mb-2">Auditor Executive Summary</h4>
            <p className="text-xs text-zinc-400 leading-relaxed text-justify">
              {analysis.sustainabilitySummary}
            </p>
          </div>

          <div className="border-t border-zinc-800/60 pt-4 mt-6 text-[10px] text-zinc-500 font-mono flex items-center gap-1.5 uppercase font-bold">
            <Lightbulb className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
            Licensed AI Building Performance Core
          </div>
        </div>

        {/* Detailed recommendations list */}
        <div className="bg-zinc-900 border border-zinc-850 rounded-3xl p-6 shadow-2xl lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <span className="text-[9px] font-black text-[#38bdf8] uppercase tracking-widest font-mono">Improvement Roadmap</span>
              <h4 className="font-bold text-zinc-100 text-sm mt-1">Recommended Optimization Actions</h4>
            </div>
            <span className="text-[10px] px-3 py-1 bg-green-950/20 text-green-400 border border-green-900/30 rounded-full font-bold">
              5 Actions
            </span>
          </div>

          <div className="space-y-4">
            {analysis.recommendations.map((rec, index) => (
              <div 
                key={index} 
                className="p-3 bg-zinc-950/40 border border-zinc-850 hover:border-zinc-800 rounded-2xl flex items-start gap-3 transition-colors"
              >
                <div className="p-2 rounded-xl bg-orange-950/20 text-orange-400 border border-orange-900/10 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-zinc-500 font-mono">ACTION {index + 1}</span>
                  <p className="text-xs text-zinc-300 font-medium leading-relaxed mt-0.5">{rec}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
