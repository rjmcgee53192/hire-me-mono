export interface Project {
  slug: string;
  title: string;
  tagline: string;
  proves: string;
  tags: string[];
  demoPath: string;
  codeUrl: string;
}

const REPO = "https://github.com/rjmcgee53192-prog/hire-me-mono";

export const PROJECTS: Project[] = [
  {
    slug: "astra",
    title: "Astra Telemetry",
    tagline: "Mission-control dashboard streaming live rocket telemetry.",
    proves:
      "Real-time data pipelines, canvas visualization, and state machines under pressure.",
    tags: ["TypeScript", "Canvas", "Real-time sim"],
    demoPath: "/demos/astra",
    codeUrl: `${REPO}/tree/main/packages/astra-core`,
  },
  {
    slug: "volt",
    title: "Volt Fleet",
    tagline: "EV fleet operations with cost-optimized smart charging.",
    proves: "Optimization algorithms, geospatial UI, and cost-aware scheduling.",
    tags: ["TypeScript", "Optimization", "Scheduling"],
    demoPath: "/demos/volt",
    codeUrl: `${REPO}/tree/main/packages/volt-core`,
  },
  {
    slug: "tensorgrid",
    title: "TensorGrid",
    tagline: "GPU cluster observability for ML training workloads.",
    proves: "Infra monitoring, queue scheduling theory, and alerting design.",
    tags: ["TypeScript", "Heatmaps", "Observability"],
    demoPath: "/demos/tensorgrid",
    codeUrl: `${REPO}/tree/main/packages/tensorgrid-core`,
  },
  {
    slug: "pulse",
    title: "Pulse",
    tagline: "Realtime collaborative whiteboard with CRDT conflict resolution.",
    proves:
      "Distributed-systems fundamentals: presence, operations, deterministic merge.",
    tags: ["TypeScript", "CRDT", "Canvas"],
    demoPath: "/demos/pulse",
    codeUrl: `${REPO}/tree/main/packages/pulse-core`,
  },
  {
    slug: "tracelens",
    title: "TraceLens",
    tagline: "API observability with synthetic load generation.",
    proves:
      "Performance engineering: streaming percentiles, error budgets, tracing.",
    tags: ["TypeScript", "Statistics", "Load testing"],
    demoPath: "/demos/tracelens",
    codeUrl: `${REPO}/tree/main/packages/tracelens-core`,
  },
];
