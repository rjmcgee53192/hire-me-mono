# Interview Prep — Hire-Me Monorepo

How to use this: each project has a 60-second narrative (say it out loud, time yourself), five deep-dive Q&As interviewers actually ask about portfolio projects, and three scaling follow-ups. Answers are in first person and describe the architecture as designed — defend decisions, name trade-offs, never bluff about code you didn't write. The behavioral section at the end uses frameworks tied to building this portfolio.

---

## 1. ASTRA TELEMETRY — `/demos/astra` (`packages/astra-core`)

### 60-second narrative

"I built Astra Telemetry, a mission-control-style dashboard for a simulated rocket flight. The interesting part isn't the UI — it's the simulation engine in `packages/astra-core`. It's a deterministic, phase-based flight model: prelaunch, liftoff, Max-Q, MECO, stage separation, second-stage burn. Each phase has parametric curves for altitude, velocity, dynamic pressure, and fuel, and the engine emits telemetry ticks against a simulation clock that's decoupled from wall-clock time.

On the frontend I render high-frequency time series on canvas using ring buffers, so React never re-renders per tick — the charts update imperatively inside a requestAnimationFrame loop. You can play, pause, and scrub the entire flight because the sim is seeded and deterministic: scrubbing just re-simulates from t0. There's also an anomaly-injection control that perturbs the model mid-flight, and a threshold detector that raises alerts into an event feed. I built it to prove I can model a stateful real-time domain and render it performantly in the browser."

### Deep-dive questions

**Q1: Why simulate client-side instead of building a real backend with WebSockets?**
"Two reasons: deployability and determinism. The demo deploys as a static Next.js app with zero infrastructure, and a seeded client-side engine is perfectly deterministic, which makes scrubbing, testing, and anomaly injection trivial to reason about. The honest trade-off: there's no persistence and no multi-user. If this were a real product, the engine would move server-side behind a pub/sub fan-out, and the client would stay nearly identical — I designed the engine's tick interface so it could be fed by a socket instead of a local loop."

**Q2: How does the engine model flight phases?**
"It's a finite state machine. Each phase defines entry conditions, parametric curves for the telemetry channels, and exit events — for example, Max-Q is derived from the dynamic-pressure curve peaking, MECO fires when first-stage fuel hits zero. The mission event timeline is derived from phase transitions, not hardcoded timestamps, so if I tune a curve, the events move with it. That was a deliberate choice: derive events from state, don't script them."

**Q3: How do you keep the charts smooth at high tick rates?**
"Three things. First, telemetry goes into fixed-size ring buffers, not React state — no re-render per tick. Second, canvas rendering happens in a single rAF loop that draws all charts, with decimation: if there are more points than pixels, I min/max-bin them per pixel column. Third, the only React state updates are low-frequency: current phase, alert list, and the scrubber position, throttled. The result is the UI stays at 60fps regardless of tick rate."

**Q4: How does anomaly injection and alerting work?**
"Injecting an anomaly flips a fault function into the engine — say, a fuel-leak perturbation that changes the fuel curve's derivative. A separate detector module watches the streams against thresholds and rate-of-change limits; when one trips, it emits an alert object into the event feed with the channel, value, and threshold. I kept detection decoupled from the engine on purpose — that's how real observability works: the thing being observed doesn't know it's being watched."

**Q5: Why does scrubbing work — isn't time-based simulation hard to rewind?**
"It would be if the sim depended on wall-clock time or unseeded randomness. Mine doesn't. The engine advances on an explicit simulation clock, and all randomness comes from a seeded PRNG. Scrubbing to time T just means resetting to t0 and fast-forwarding the engine to T, which is cheap because ticks are pure functions of (state, dt). Determinism is the whole trick — and it's also what makes the engine unit-testable: I can assert exact telemetry values at exact mission times."

### Scaling follow-ups

**"How would you rebuild this for 1M concurrent viewers of a real launch?"**
"One simulation instance publishes ticks to a pub/sub backbone — Kafka or Redis Streams — and a fleet of stateless WebSocket gateways fan out to viewers. Clients subscribe to channels, and I'd add adaptive downsampling: send 10Hz to everyone, full-rate only on drill-down. Static assets on CDN, historical telemetry in a columnar store. The key insight is the sim runs once; scale is purely a fan-out problem."

**"How would you persist every tick for post-flight analysis?"**
"Downsample on ingest: keep raw 100Hz for a short hot window, then roll up to 1Hz aggregates plus preserve every detected event marker. Store in a time-series database like TimescaleDB or ClickHouse with hot/warm/cold tiering. The event timeline becomes a first-class queryable index, not just a UI feature."

**"What changes with real hardware in the loop?"**
"The engine becomes a digital twin: ingest adapters with schema validation, backpressure, and clock synchronization, because real sensors lie — they drop packets, drift, and spike. I'd add a data-quality layer between ingest and the phase machine, and the anomaly detector would need baselining per vehicle instead of fixed thresholds."

---

## 2. VOLT FLEET — `/demos/volt` (`packages/volt-core`)

### 60-second narrative

"Volt Fleet is an EV fleet-operations dashboard. There's a stylized live map with vehicles moving between depot and routes, per-vehicle panels showing battery state of charge, health, and status, a trip planner with range estimation, and the centerpiece: a smart charging scheduler.

The scheduler lives in `packages/volt-core`. It takes a time-of-use electricity price curve and per-vehicle constraints — departure time, target state of charge, max charge rate, and a battery-health cap — and allocates charging into the cheapest available slots. The UI shows the optimized schedule next to a naive 'plug in and charge immediately' baseline with the dollar savings. I used a stylized SVG map instead of a real map SDK deliberately: no API keys, works fully offline, and it's honest about being a simulation. I built this to show optimization thinking and operations-dashboard craft — the kind of thing a fleet or energy company actually uses."

### Deep-dive questions

**Q1: How does the charging optimizer actually work?**
"I discretize the overnight window into time slots, each with a price from the time-of-use curve. Every vehicle declares constraints: must reach target SoC by departure, can't exceed its max kW, and respects a health cap — I default to 80% unless the trip needs more, since holding at 100% degrades lithium batteries. Then it's a greedy allocation: sort slots by price, fill each vehicle's required energy into its cheapest feasible slots. Greedy is near-optimal here because the price curve is convex-ish and constraints are per-vehicle independent. The production upgrade would be a MILP solver for shared constraints like depot power limits — and I say that in the README."

**Q2: Why not use a real map SDK?**
"API keys and honesty. A Google Maps key would break the zero-config deploy and add nothing to what the demo proves — vehicle positions are simulated anyway. The stylized schematic map communicates 'this is a simulation' instead of faking real geography. Trade-off acknowledged: no real geocoding or routing. If it were real, vehicle positions would come over MQTT and I'd swap the map layer without touching the scheduler."

**Q3: How is vehicle state modeled?**
"Each vehicle is a small state machine: driving, charging, idle, maintenance. Battery is modeled with state of charge plus a degradation curve — capacity fades with cycle count and time spent at high SoC, which is why the optimizer's health cap matters. The tick loop advances all vehicles, and the map, panels, and scheduler all read from the same state — single source of truth, no duplicated vehicle objects drifting out of sync."

**Q4: How does the trip planner estimate range?**
"A consumption model: base Wh/mile adjusted by average speed, a temperature factor for battery efficiency, and a payload constant. It computes required energy for the route, compares against usable capacity minus a safety margin, and inserts charging stops if needed. It's simplified — no elevation or traffic — but the structure is right: estimate, margin, fallback plan."

**Q5: How do you keep the UI smooth with many moving vehicles?**
"One rAF loop drives the map layer on canvas; vehicle markers are drawn imperatively, not as React components. Panels subscribe only to their selected vehicle. The scheduler runs in a memoized computation, not on every tick — it only recomputes when constraints or the price curve change."

### Scaling follow-ups

**"100,000 real vehicles streaming telemetry — what breaks first?"**
"Ingest. You move to MQTT brokers with stream processing — Kafka plus Flink or Kafka Streams — doing per-vehicle state in a keyed store. The optimizer gets partitioned by depot because charging decisions are depot-local; only grid-level capacity constraints need global coordination. The map goes to vector tiles with clustering."

**"Now the chargers are real hardware speaking OCPP — what changes?"**
"Commands become asynchronous and fallible. You need a command queue with idempotency keys, retries with backoff, and conflict resolution when a driver manually overrides a scheduled session. The scheduler's output stops being a plan and becomes a set of proposed commands that the charger layer can accept, reject, or modify — and the UI has to show all three states."

**"Multiple depots plus grid capacity limits?"**
"Hierarchical optimization: a global allocator divides grid capacity across depots by priority and price, then each depot runs its local scheduler inside its allocation. That's the standard decomposition for coupled constraints, and it's exactly where the greedy approach gets replaced by the MILP solver."

---

## 3. TENSORGRID — `/demos/tensorgrid` (`packages/tensorgrid-core`)

### 60-second narrative

"TensorGrid is a GPU cluster observability dashboard — the kind of internal tool ML platform teams live in. There's a node heatmap showing per-GPU utilization, power draw, and temperature, a training-job queue with a priority scheduler simulation, throughput charts, and an alert feed driven by real threshold rules.

The scheduler in `packages/tensorgrid-core` does bin-packing: jobs declare GPU count, priority, and estimated duration, and the scheduler places them onto nodes, queueing what doesn't fit and preempting low-priority jobs when something urgent arrives. The thermal model is coupled — temperature follows power draw with a lag, so you can watch a node heat up after a big job lands and see alerts fire when it crosses thresholds. I built it to show systems thinking: scheduling, observability, and alerting as one coherent tool, which is the Nvidia-adjacent skill set."

### Deep-dive questions

**Q1: How does the priority scheduler simulation work?**
"Jobs enter a queue with priority, GPU requirement, and estimated duration. On every scheduling tick, the scheduler sorts by priority, then first-fits each job onto nodes with enough free GPUs — tracking fragmentation. If a high-priority job arrives and nothing fits, it preempts the lowest-priority running job, which goes back to the queue with its progress checkpointed. The UI exposes the interesting metrics: queue wait time by priority class, GPU utilization, and preemption count. It's a simplified version of what Slurm and Kubernetes schedulers do."

**Q2: How is the thermal model coupled to utilization?**
"Temperature isn't random — it's a first-order lag of power draw, which itself is a function of utilization plus idle baseline. So when a training job lands on a node, you see power spike immediately and temperature climb over the next minute of sim time, then decay after the job finishes. That coupling is what makes the heatmap feel real and what makes threshold alerts meaningful rather than noise."

**Q3: Why simulate instead of scraping a real Prometheus?**
"Same zero-infrastructure principle as the other projects: the scheduling logic and the visualization are the point, not the metrics pipeline. But I designed the metrics source as an interface — the dashboard consumes a tick stream, so a Prometheus adapter could replace the simulator without touching the UI or the scheduler. I'd say that explicitly in an interview: the seam is there."

**Q4: What exactly do the throughput charts measure?**
"Aggregate cluster throughput — completed training steps per minute — plus per-job progress rates, over rolling windows. The interesting view is throughput versus GPU allocation: you can see whether adding GPUs to a job actually speeds it up, which is the scaling-efficiency question every ML team argues about."

**Q5: How does the alert feed avoid spam?**
"Rules evaluate on tick with three controls: severity levels, cooldowns per rule per node so a flapping threshold doesn't flood the feed, and deduplication — repeat firings of the same condition collapse into one alert with a count. That's a miniature version of what Alertmanager does, and I'd name that if asked."

### Scaling follow-ups

**"10,000 GPUs across three regions?"**
"Hierarchical aggregation: per-rack agents roll up to regional collectors, the dashboard queries rollups by default and drills to node level on demand. Scheduling becomes federated — each region schedules locally, with a global layer only for cross-region overflow. You never ship per-GPU metrics across regions at full rate."

**"Real training workloads with NCCL collectives and checkpointing?"**
"Two additions: gang scheduling — a distributed job either gets all its GPUs or none, no partial placement — and checkpoint-aware preemption, so preempting a job resumes from its last checkpoint instead of restarting. The simulator's preemption model is the skeleton of that; the real version integrates with the orchestrator's API."

**"How would you cut the cluster's power bill?"**
"Power-aware scheduling: shift delay-tolerant jobs into low-price power windows, cap per-node power during peak pricing, and pack jobs to let idle nodes sleep instead of spreading load thin. The time-of-use price curve idea carries straight over from the Volt Fleet optimizer — same math, different domain."

---

## 4. PULSE — `/demos/pulse` (`packages/pulse-core`)

### 60-second narrative

"Pulse is a realtime collaborative whiteboard. You can draw on a canvas, and there are simulated collaborators — bots with distinct colors — drawing at the same time, with live presence cursors showing where everyone is. Underneath, edits go through a CRDT-lite merge function in `packages/pulse-core`, and there's a panel showing the merge working: concurrent strokes from different clients converging to the same final state regardless of the order operations arrive.

I call it CRDT-lite honestly: each operation carries a Lamport timestamp plus client ID for deterministic tie-breaking, so the merge is order-independent — the defining property of a CRDT. What's 'lite' about it is scoping: single document, no tombstone garbage collection, no network partitions to heal. The collaborators are simulated because a deterministic multi-user demo without a server is testable and deployable, but the merge function itself is the real algorithm and it's unit-tested. I built it to show distributed-systems thinking in a frontend context."

### Deep-dive questions

**Q1: How does the merge resolve two people drawing at once?**
"Every stroke is an operation tagged with a Lamport timestamp and the client's ID. The merge function inserts operations into a total order — timestamp first, client ID breaks ties deterministically. Because every client applies the same deterministic ordering, all replicas converge to the identical document no matter what order the operations arrived in. The demo visualizes this: you can watch two bots draw overlapping strokes and the final canvas is identical on every simulated replica. Convergence under arbitrary delivery order is the whole point of a CRDT."

**Q2: What did you leave out to earn the 'lite' label?**
"Three things a production CRDT needs: tombstones and garbage collection for deleted content, handling of network partitions and late-joining clients that missed history, and multi-document or nested-structure support. I scoped those out deliberately and documented it. In an interview I'd rather say 'here's exactly what I didn't build and why' than pretend a demo is production."

**Q3: How do presence cursors stay smooth without killing performance?**
"They're on a separate canvas layer from the drawing, updated imperatively — cursor positions never touch React state. Updates are throttled to animation frames, and remote cursors are interpolated between updates so they glide instead of jumping. Presence is ephemeral by design: if a client stops sending heartbeats, its cursor fades out. No state cleanup bugs because there's no persistent state for presence at all."

**Q4: Why simulated collaborators instead of real multi-user?**
"Determinism and deployability again. Bots with seeded behaviors give a reproducible multi-user scenario — I can write a test that replays the same concurrent edits and asserts convergence. A real server would make the demo untestable in CI and undeployable as a static site. The merge function doesn't care whether operations come from bots or sockets; that's the seam for a real backend."

**Q5: What do the ops/latency stats actually measure?**
"Operations per second through the merge function, median merge time per operation, and simulated end-to-end latency from stroke to rendered on a remote replica. The numbers are simulated, but the instrumentation pattern is real: measure the merge path because that's the hot loop in any collaborative editor."

### Scaling follow-ups

**"Real multi-user with 10,000 concurrent editors?"**
"WebSocket gateways with Redis pub/sub fanning operations out, or a dedicated CRDT sync server like the y-websocket pattern. Persistence becomes snapshots plus an operation log — new joiners load the snapshot, then replay the tail. The merge function stays exactly as is; only the transport changes, which is why I isolated it in its own package."

**"A million users on one board?"**
"You stop syncing everything to everyone. Spatial sharding: the board is partitioned into regions, clients subscribe only to their viewport plus a margin, and presence is scoped the same way. It's the same interest-management problem multiplayer games solved decades ago."

**"What about offline editing?"**
"Operations append to a local log when disconnected; on reconnect, the client sends its missed operations and receives the ones it missed, and the deterministic merge resolves everything. Offline support falls out naturally from the CRDT design — that's the deepest reason to use CRDTs over operational transform for this use case, and I'd say so."

---

## 5. TRACELENS — `/demos/tracelens` (`packages/tracelens-core`)

### 60-second narrative

"TraceLens is an API observability dashboard. A synthetic load generator in `packages/tracelens-core` hammers a set of mock endpoints with configurable request rates, latency distributions, and error injection. The dashboard shows live p50, p95, and p99 latency charts, an error-budget burn-down against a defined SLO, a trace waterfall for slow requests, and alerting rules that actually fire when conditions are met.

The piece I'm proudest of is the percentile computation: it's a streaming bucketed histogram — fixed log-scale buckets updated per request in O(1) time and memory — so percentiles stay live forever without storing individual request timings. The error budget implements the standard model: budget is one minus the SLO, burn rate is measured over multiple windows. I built it to show backend and performance-engineering instincts, even though it runs entirely in the browser."

### Deep-dive questions

**Q1: How do you compute p99 live without storing every request?**
"A bucketed histogram with log-spaced buckets. Each request increments one bucket — O(1) time, fixed memory. Percentiles are read off the cumulative distribution: find the bucket where the cumulative count crosses the 99th percentile. The trade-off is resolution: values inside a bucket are indistinguishable, so I size buckets so the error is small relative to what matters — nobody's SLO cares about the difference between 412ms and 415ms. This is the same approach as HdrHistogram and Prometheus histograms, and I'd name both."

**Q2: How does the load generator work?**
"Virtual users with a Poisson-ish arrival process against a configurable target RPS. Each mock endpoint has a latency distribution — mostly log-normal with a long tail, because real latency has a long tail — plus a configurable error rate. You can crank the RPS slider and watch p99 degrade and the error budget burn faster, which is the cause-and-effect relationship the dashboard exists to show."

**Q3: How is the error budget computed?**
"Standard SRE model. Define the SLO — say 99.9% of requests succeed and p99 stays under 500ms. The budget is the allowed failure rate: 0.1%. Burn-down tracks budget consumed over the window, and burn rate is the ratio of actual to allowed consumption. The alerting rules use multi-window burn rates — fast-burn for paging, slow-burn for tickets — which is straight out of the Google SRE workbook."

**Q4: How are the trace waterfalls generated?**
"When a request exceeds the 'slow' threshold, the generator synthesizes a span tree: a root span with child spans for simulated downstream calls — auth check, database query, cache lookup — each with durations sampled to sum plausibly to the total. It's rendered as a waterfall so you can see which child dominated. The data is synthetic, but the trace model — spans, parent-child relationships, critical path — is exactly how distributed tracing works."

**Q5: What makes the alerting rules 'real' if the data is fake?**
"The rules are real logic evaluated against the live stream: threshold rules on error rate and latency, burn-rate rules on the error budget, each with cooldowns and dedup like the TensorGrid alerts. They fire, they resolve, they show in the feed. The inputs are simulated; the evaluation machinery is genuine — and it's unit-tested with synthetic scenarios."

### Scaling follow-ups

**"A million requests per second in production — what breaks?"**
"Storing everything. You move to tail-based sampling — keep all traces for errors and slow requests, sample 1% of the rest — plus edge aggregation of the histograms so the percentile computation stays O(1) per node and merges centrally. The bucketed-histogram design already anticipates this: histograms merge by adding buckets."

**"Cardinality explosion — a thousand endpoints times a hundred regions?"**
"Bounded label sets and top-k tracking. You aggregate aggressively, keep per-endpoint detail only for the top traffic sources, and roll the long tail into an 'other' bucket. Cardinality is the silent killer of every metrics system; the defense is deciding up front what you will not store."

**"Traces across fifty microservices?"**
"Context propagation: every request carries a trace ID in headers, each service creates child spans and ships them to a collector pipeline — the OpenTelemetry model. The backend becomes a trace store like Tempo or Jaeger. My waterfall renderer already consumes the span-tree shape those systems produce, so the frontend concept transfers directly."

---

## General behavioral questions

Answer frameworks, all tied to building this portfolio. Use STAR (Situation, Task, Action, Result) but keep each answer under 90 seconds.

**1. "Tell me about yourself."**
Framework: present → proof → future. "I'm a full-stack engineer working in React, TypeScript, and systems-oriented frontend — real-time data, simulation, observability. Most recently I designed and built a five-project engineering monorepo: a mission-control telemetry dashboard, an EV fleet optimizer, a GPU cluster scheduler, a CRDT-based collaboration demo, and an observability platform — all live, tested, and deployed. I'm looking for a senior full-stack or software engineering role, remote, where I can own meaningful systems end to end."

**2. "Tell me about a time you took ownership of something big."**
Framework: scope → decisions → delivery. "I owned this entire monorepo: architecture, all five domains, the shared design system, CI, tests, and deployment. Nobody assigned it — I defined the scope, chose the monorepo structure so the projects share code without tangling, set the quality bar of zero stubs and passing builds, and shipped it. Ownership to me means the boring parts too: CI pipelines, READMEs, and verifying the deploy actually works."

**3. "How do you deal with ambiguity?"**
Framework: vague brief → concrete scoping → shipped. "The brief for this portfolio was 'build five projects impressive enough for SpaceX, Tesla, and Nvidia.' That's maximally ambiguous. I turned it into constraints: real-time systems and engineering-tools domains, client-side simulation so everything deploys with zero infrastructure, one shared design system, every demo must have multiple working interactions. Ambiguity gets resolved by writing down constraints and checking decisions against them."

**4. "Tell me about a technical disagreement or a hard technical decision."**
Framework: the options → the trade-off → the call. "The biggest one was real backend versus client-side simulation. A backend with WebSockets would be more 'real,' but it would make every demo undeployable without infrastructure and untestable in CI. I chose deterministic client-side engines with clean seams — the tick interfaces can be fed by sockets later. I documented the trade-off in each README rather than hiding it. I'd rather defend a well-reasoned scope cut than demo something I can't explain."

**5. "How do you handle deadlines?"**
Framework: time-box → prioritize → cut scope, not quality. "Five projects is a lot, so I time-boxed each one and defined 'done' crisply: working demo, tested core logic, passing build, README. When something threatened the timeline, I cut scope — fewer chart types, simpler bot behaviors — never quality: no dead buttons, no placeholder content. A smaller thing that fully works beats a bigger thing that's half-fake."

**6. "What's the hardest technical problem you solved recently?"**
Framework: the problem → why it was hard → the solution. "Deterministic simulation for scrubbing in the telemetry project. Rewinding a time-based sim is genuinely tricky — wall-clock dependence and unseeded randomness make it impossible. The fix was architectural: decouple the sim clock from real time, route all randomness through a seeded PRNG, and make ticks pure functions of state plus dt. Then scrubbing is just fast-forward from t0, and as a bonus the engine became unit-testable with exact assertions. The same determinism made the CRDT convergence tests possible."

**7. "Tell me about a failure or mistake."**
Framework: honest mistake → what it taught → what changed. This one is real — use it. "Early on, I had agents push a batch of repos to my main GitHub that turned out to be mostly stubs — READMEs and requirements files with almost no code. I didn't verify what was actually pushed. It was embarrassing, and it's directly why this monorepo has the opposite standard: every project has tests, CI runs the build, and I verify the deploy myself. Now I never trust a green checkmark I didn't earn — I check the artifact."

**8. "Why should we hire you?" / "Why this role?"**
Framework: evidence → fit → enthusiasm. "Because I build complete systems, not demos that fall over when you click. This portfolio is five projects where the interesting logic — a flight-phase state machine, a charging optimizer, a GPU scheduler, a CRDT merge, streaming percentiles — is real, tested code, not mockups. For this role specifically: [tie to the job post — real-time data, React/TypeScript depth, systems thinking]. I want to do this kind of work at production scale, on a team I can learn from."
