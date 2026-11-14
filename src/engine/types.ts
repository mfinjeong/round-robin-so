// Gilir engine contract — FROZEN by software-architect (ADR-001..003, local docs/adr/, not pushed).
// This file is the pushed source of truth for those ADRs. Changes: requester writes need →
// software-architect decides → backend-engineer edits → qa-engineer updates tests → frontend consumes.
//
// ── Time model (ADR-002) ──────────────────────────────────────────────────────────────────────
// T1  Ticks are 0-based. createWorld() = state before tick 0, world.tick = 0. step() processes
//     tick = world.tick and returns state with world.tick + 1. Shift processes 0..scenario.ticks-1.
// T2  Window reset (SIM-10.1) for account a at tick t iff t > 0 && t % a.window === 0.
//     Emits WINDOW_RESET, then ACCOUNT_STATUS(SEHAT) if it was LIMIT. MATI stays MATI.
//     Quota-cut incident lasts until the next reset of that account.
// T3  Step-1 order: window resets (account order), then incident END, then incident START
//     (scenario.incidents order).
// T4  Accepted at tick t with effective latency L (>= 1): startTick = t, doneTick = t + L,
//     COMPLETE in step 2 of tick doneTick. Latency incident affects only sends after it starts.
// T5  Expiry (SIM-10.6): in step 6 of tick t, queued request expires iff t - enqueuedTick >= patience.
//     patience = 0 means "route on the tick it (re)entered the queue or expire".
//     enqueuedTick = tick it last entered the queue (new arrival or retry); arrivalTick never changes.
// T6  Failed delivery (429 or MATI abort) at tick t: attempts += 1 immediately. If
//     attempts > scenario.maxAttempts → FAIL at tick t. Else request re-enters in step 3 of t+1
//     (retries before new arrivals, each group ascending numeric id).
//     attempts = count of failed deliveries; maxAttempts = 0 → first 429 is final.
// T7  429 order of events: ROUTE then REJECT_429 then ACCOUNT_STATUS(LIMIT). Quota unchanged.
//     After a 429 the request leaves the queue for this tick; routing continues with the next one.
// T8  MATI start: in-flight requests on that account emit ABORT (T6 applies), quota not refunded,
//     slots freed. MATI end → SEHAT regardless of quota.
//
// ── Routing (ADR-002) ─────────────────────────────────────────────────────────────────────────
// R1  Tier ring = scenario.accounts filtered by tier, array order. Disabled accounts stay in ring.
// R2  Skip precedence when several apply: DISABLED > DOWN > LIMIT > NO_SLOT > RESERVE.
// R3  Reserve (SIM-21), integer math only: threshold = Math.floor((reservePct * effectiveQuota + 99) / 100).
//     reservePct > 0: eligible needs remaining - cost >= threshold. reservePct = 0: no quota check.
//     Vectors: (20%,10)→2  (7%,100)→7  (50%,1)→1  (1%,1)→1.  Never Math.ceil(float).
// R4  WEIGHTED (SIM-32): on each pick, ineligible accounts' `current` is frozen (unchanged).
//     considered = all tier accounts in ring order. Weights integer 1..100, default 1.
// R5  STICKY (SIM-33): memory is global sessionId→accountId, written only by routes via STICKY.
//     Remembered account checked first only if it belongs to the tier being tried; then RR
//     from that tier's pointer. Remembered account is not re-listed in the RR part of considered.
// R6  MANUAL (SIM-34): step 5 never auto-routes through a MANUAL tier (it is skipped in fallback).
//     ROUTE action valid iff requestId is the queue head at the moment it is applied (step 4,
//     actions in array order), target tier strategy is MANUAL, status SEHAT, not disabled, free
//     slot. Reserve ignored; remaining < cost → 429 (SIM-22). Invalid → ACTION_REJECTED, no-op.
//     WorldState.manual is a post-tick hint for UI only; step 4 re-validates.
// R7  No eligible account in any tier → NO_ROUTE event (per request per tick) and it stays queued.
// R8  SET_POLICY at tick t applies in step 4 and governs step 5 of tick t. Pointers, `current`
//     and sticky memory survive policy changes.
//
// ── Metrics (ADR-003) — all integers ──────────────────────────────────────────────────────────
// M1  successBp = ended === 0 ? 0 : Math.floor(10000 * success / ended); ended = success+expired+failed.
// M2  waitP95 = nearest rank over completed requests of (completeTick - arrivalTick), ascending,
//     rank k = Math.floor((95 * n + 99) / 100), value = sorted[k - 1]; n === 0 → 0.
// M3  cost = Σ over accepted sends of cost * account.rate.
// M4  fairness: per tier with n >= 2 accounts, x_i = units accepted on account i (disabled included),
//     S = Σx, Q = Σx². Q === 0 → 100, else floor(100 * (S*S - Q) / ((n - 1) * Q)) (normalised Jain).
//     Result = floor(mean over such tiers); no such tier → 100. All equal → 100; one takes all → 0.
// M5  sessionSwitches = accepted sends whose account differs from that session's previous accepted send.
// M6  errors429 = count of REJECT_429.

export type Tier = 'LANGGANAN' | 'MURAH' | 'GRATIS';
export type Strategy = 'ROUND_ROBIN' | 'WEIGHTED' | 'STICKY' | 'MANUAL';
export type AccountStatus = 'SEHAT' | 'LIMIT' | 'MATI';
export type Control = Strategy | 'WEIGHTS' | 'RESERVE' | 'TIER_ORDER' | 'DISABLE';

/** Identifiers: /^[A-Za-z0-9_-]{1,16}$/. Request ids are numeric, assigned 1.. in arrival order. */
export type Id = string;

export interface AccountSpec {
  id: Id; tier: Tier;
  quota: number;   // 1..10000
  window: number;  // 1..2000
  slots: number;   // 1..8
  latency: number; // 1..100
  rate: number;    // 0..1000 money per unit
}

export interface Policy {
  tierOrder: Tier[];                 // permutation of exactly the tiers present in scenario
  strategy: Record<Tier, Strategy>;
  weights: Record<Id, number>;       // integer 1..100; missing → 1; unknown id → invalid
  reservePct: number;                // integer 0..50 (replaces PRD float `reserve`)
  disabled: Id[];                    // unique, known ids
}

export type Range = [min: number, max: number]; // inclusive integers, min <= max

export type TrafficSpec =
  | { kind: 'SCRIPTED'; arrivals: { tick: number; sessionId: Id; cost: number; patience: number }[] }
  | { kind: 'RANDOM'; sessions: number; cost: Range; patience: Range;
      segments: { from: number; to: number; perTick: Range }[] }; // [from, to) ticks

export type Incident =
  | { id: Id; type: 'DOWN'; accountId: Id; start: number; duration: number }
  | { id: Id; type: 'QUOTA_CUT'; accountId: Id; start: number; quota: number }
  | { id: Id; type: 'SURGE'; start: number; duration: number; extraPerTick: Range }
  | { id: Id; type: 'LATENCY'; accountId: Id; start: number; duration: number; add: number }
  | { id: Id; type: 'GREEDY'; sessionId: Id; start: number; duration: number; perTick: number; cost: number };

export type MetricKey = 'successBp' | 'waitP95' | 'errors429' | 'cost' | 'fairness' | 'sessionSwitches';
export interface Goal { metric: MetricKey; op: '>=' | '<='; value: number }

export interface Scenario {
  id: Id; ticks: number;             // 1..2000
  maxAttempts: number;               // 0..10
  accounts: AccountSpec[];           // 1..8, unique ids, 1..3 tiers
  traffic: TrafficSpec;
  incidents: Incident[];             // <= 32
  goals: Goal[];                     // exactly 3 in campaign, [] in lab
  unlocked: Control[];
}

export type PlayerAction =
  | { tick: number; type: 'SET_POLICY'; policy: Policy }
  | { tick: number; type: 'ROUTE'; requestId: number; accountId: Id };

export type SkipReason = 'RESERVE' | 'NO_SLOT' | 'LIMIT' | 'DOWN' | 'DISABLED';
export type RejectCode = 'NOT_HEAD' | 'NOT_MANUAL' | SkipReason | 'UNKNOWN_ACCOUNT' | 'BAD_POLICY';
export interface Considered { accountId: Id; tier: Tier; skipped?: SkipReason }

export type SimEvent =
  | { type: 'ARRIVE'; requestId: number; sessionId: Id; cost: number; retry: boolean }
  | { type: 'ROUTE'; requestId: number; accountId: Id; considered: Considered[];
      via: Strategy; fallbackFrom?: Tier }  // fallbackFrom = first tier tried when chosen tier differs
  | { type: 'NO_ROUTE'; requestId: number; considered: Considered[] }
  | { type: 'REJECT_429'; requestId: number; accountId: Id }
  | { type: 'ABORT'; requestId: number; accountId: Id }
  | { type: 'COMPLETE'; requestId: number; accountId: Id }
  | { type: 'EXPIRE'; requestId: number }
  | { type: 'FAIL'; requestId: number }
  | { type: 'ACCOUNT_STATUS'; accountId: Id; status: AccountStatus }
  | { type: 'WINDOW_RESET'; accountId: Id }
  | { type: 'INCIDENT'; incidentId: Id; phase: 'START' | 'END' }
  | { type: 'ACTION_REJECTED'; actionIndex: number; code: RejectCode };

export interface QueuedRequest {
  id: number; sessionId: Id; cost: number; patience: number;
  arrivalTick: number; enqueuedTick: number; attempts: number;
}
export interface ActiveRequest extends QueuedRequest { accountId: Id; startTick: number; doneTick: number }

export interface AccountState {
  id: Id; status: AccountStatus;
  remaining: number; effectiveQuota: number; effectiveLatency: number;
  windowEndsAt: number;              // next tick where T2 resets this account
  busy: number;                      // slots in use
  current: number;                   // SWRR state (R4)
  downUntil?: number;                // tick when MATI ends
}

export interface WorldState {
  readonly scenario: Scenario;
  tick: number;                      // next tick to process (T1)
  policy: Policy;
  rng: number;                       // uint32 PRNG state; integer ops only (Math.imul), no floats in decisions
  nextRequestId: number;
  queue: QueuedRequest[];            // FIFO order
  retry: QueuedRequest[];            // re-enter in step 3 of next tick (T6)
  active: ActiveRequest[];
  accounts: AccountState[];          // scenario.accounts order
  pointer: Record<Tier, number>;     // RR index into tier ring (R1)
  sticky: Record<Id, Id>;            // sessionId → accountId (R5); null-prototype or Map-free plain copy
  activeIncidents: Id[];
  manual: { requestId: number; targets: { accountId: Id; blocked?: RejectCode }[] } | null; // R6 hint
}

export interface TickFrame { tick: number; events: SimEvent[]; state: WorldState }
export interface Trace { scenarioId: Id; seed: string; frames: TickFrame[] }

export type FindingCode = 'FIRST_429' | 'EXPIRED' | 'FAILED' | 'FALLBACK' | 'ABORTED' | 'SESSION_SWITCH' | 'UNEVEN';
/** Structured cause-effect fact (GD-08/09). Text is composed in src/content, never here. */
export interface Finding { code: FindingCode; tick?: number; accountId?: Id; tier?: Tier; n?: number; value?: number }

export type Metrics = Record<MetricKey, number> & { success: number; expired: number; failed: number; active: number };
export interface Report { metrics: Metrics; stars: 0 | 1 | 2 | 3; goalsMet: boolean[]; findings: Finding[] }

// ── Boundary validation (ADR-003, SEC-02/03) — owned by backend-engineer in src/codec ─────────
// Untrusted: share code, localStorage, lab editor input. Engine assumes validated input.
// Parser: length check before decode; JSON.parse only; reject unknown keys and keys
// __proto__/constructor/prototype; read via Object.hasOwn; build fresh objects; integers via
// Number.isSafeInteger; no regex with nested quantifiers. Invalid input → no partial value.
// Share code: "G1." + base64url(UTF-8 JSON of SharePayload), total <= 16384 chars.
// Limits: accounts <= 8, ticks <= 2000, actions <= 5000, incidents <= 32, seed /^[A-Za-z0-9_-]{1,64}$/.
export interface SharePayload {
  v: 1; seed: string; policy: Policy; actions: PlayerAction[];
  level?: Id; scenario?: Scenario;   // exactly one of level | scenario
}
export type ValidationCode =
  | 'TOO_LONG' | 'BAD_PREFIX' | 'BAD_ENCODING' | 'BAD_JSON' | 'UNKNOWN_VERSION'
  | 'TYPE' | 'UNKNOWN_KEY' | 'MISSING' | 'NOT_INTEGER' | 'RANGE' | 'DUPLICATE_ID' | 'UNKNOWN_REF' | 'LIMIT';
export type Result<T> = { ok: true; value: T } | { ok: false; errors: { path: string; code: ValidationCode }[] };

// ── Functions (implemented by backend-engineer) ───────────────────────────────────────────────
// Pure, never mutate arguments (INV-8). run(...) frames === successive step(...) frames (INV-7).
// Policy lives in WorldState (PRD `step(world, policy, actions)` superseded); actions = this tick's only.
export type CreateWorld = (scenario: Scenario, policy: Policy, seed: string) => WorldState;
export type Step = (world: WorldState, actions: PlayerAction[]) => TickFrame;
export type Run = (scenario: Scenario, policy: Policy, seed: string, actions: PlayerAction[]) => Trace;
export type MakeReport = (trace: Trace) => Report;
