import "server-only"

import { Coordinator } from "../coordinator"

import type { IAudit } from "../IAudit"
import type { ICoordinator } from "../ICoordinator"
import type { IIntentPublisher } from "../intent-types"
import type { PolicyEngine } from "../policy-engine"
import type { CoordinatorDecisionDependencies } from "../coordinator-dependencies"

// This capability-limited view removes the Coordinator's named anchor/retry
// entrypoints. It does not prove that caller-provided implementations of
// publish(), knowledge.query(), audit.record(), or agent methods are
// side-effect-free.
export type ExecutionDisabledIntentPersistence =
  Omit<IIntentPublisher, "anchorDecision"> & {
    readonly anchorDecision?: never
    readonly retryPendingProofs?: never
  }

type ExecutionDisabledCoordinatorBase = Pick<
  ICoordinator,
  | "name"
  | "registerAgent"
  | "unregisterAgent"
  | "getAgents"
  | "submitProposal"
  | "runCycle"
  | "getSafetyGuard"
  | "getAudit"
  | "getPolicyEngine"
  | "getOperationalStatus"
>

export type ExecutionDisabledCoordinator =
  ExecutionDisabledCoordinatorBase & {
    getExecutor(): null
  }

export interface CreateServerCoordinatorOptions {
  readonly name: string
  readonly minAgents?: number
  readonly dedupWindowMs?: number
  readonly audit: IAudit
  readonly intentPersistence: ExecutionDisabledIntentPersistence
  readonly policyEngine: PolicyEngine
  readonly decisionDependencies: CoordinatorDecisionDependencies
}

export interface ServerCoordinatorComposition {
  /** "disabled" means executor capability disabled, not absence of every side effect. */
  readonly executionMode: "disabled"
  readonly coordinator: ExecutionDisabledCoordinator
}

function requireFunction(
  owner: Record<string, unknown>,
  path: string,
  key: string,
): void {
  if (typeof owner[key] !== "function") {
    throw new TypeError(
      `createServerCoordinatorComposition requires ${path}.${key} to be a function`,
    )
  }
}

/**
 * Creates an executor-disabled Coordinator behind a capability-limited facade.
 *
 * Registered agents are caller-owned authorities. `runCycle()` calls their
 * `propose()` and `vote()` methods before reaching the NO_EXECUTOR gate, so this
 * factory does not isolate or disable agent side effects. Audit, PolicyEngine,
 * intent persistence, and all decision dependencies are also caller-owned.
 *
 * No settlement replay default is provided. The caller must inject a replay
 * implementation consistent with its persistence model. The factory creates no
 * registry, replay queue, or listener.
 *
 * This factory does not enforce Coordinator exclusivity. Multiple calls create
 * distinct Coordinators whose deduplication and operational state are local to
 * each instance. Injected dependencies may be shared; lifecycle, concurrency,
 * and cross-instance consistency remain the caller's responsibility.
 */
export function createServerCoordinatorComposition(
  options: CreateServerCoordinatorOptions,
): ServerCoordinatorComposition {
  if (!options || typeof options !== "object") {
    throw new TypeError(
      "createServerCoordinatorComposition requires options to be an object",
    )
  }

  const runtimeOptions = options as unknown as Record<string, unknown>
  if (
    "executor" in runtimeOptions ||
    "safetyGuard" in runtimeOptions ||
    "recoveryAuthorizer" in runtimeOptions
  ) {
    throw new TypeError(
      "createServerCoordinatorComposition forbids executor, safetyGuard, and recoveryAuthorizer capabilities",
    )
  }

  if (typeof options.name !== "string" || options.name.trim().length === 0) {
    throw new TypeError(
      "createServerCoordinatorComposition requires options.name to be a non-empty string",
    )
  }

  if (!options.audit || typeof options.audit !== "object") {
    throw new TypeError(
      "createServerCoordinatorComposition requires options.audit to be an object",
    )
  }
  const audit = options.audit as unknown as Record<string, unknown>
  requireFunction(audit, "options.audit", "record")
  requireFunction(audit, "options.audit", "updateEntry")
  requireFunction(audit, "options.audit", "getRecent")
  requireFunction(audit, "options.audit", "getByAgent")
  requireFunction(audit, "options.audit", "getReport")
  requireFunction(audit, "options.audit", "clear")

  if (!options.intentPersistence || typeof options.intentPersistence !== "object") {
    throw new TypeError(
      "createServerCoordinatorComposition requires options.intentPersistence to be an object",
    )
  }
  const persistence = options.intentPersistence as unknown as Record<string, unknown>
  if ("anchorDecision" in persistence || "retryPendingProofs" in persistence) {
    throw new TypeError(
      "createServerCoordinatorComposition forbids anchoring and pending-proof retry capabilities",
    )
  }
  requireFunction(persistence, "options.intentPersistence", "publish")
  requireFunction(persistence, "options.intentPersistence", "getRecord")
  requireFunction(persistence, "options.intentPersistence", "list")
  requireFunction(persistence, "options.intentPersistence", "updateStatus")
  requireFunction(persistence, "options.intentPersistence", "recordVote")
  requireFunction(persistence, "options.intentPersistence", "recordResult")
  requireFunction(persistence, "options.intentPersistence", "setDecisionReport")
  requireFunction(persistence, "options.intentPersistence", "subscribe")

  if (!options.policyEngine || typeof options.policyEngine !== "object") {
    throw new TypeError(
      "createServerCoordinatorComposition requires options.policyEngine to be an object",
    )
  }
  requireFunction(
    options.policyEngine as unknown as Record<string, unknown>,
    "options.policyEngine",
    "isAllowed",
  )

  const intentPersistence = options.intentPersistence
  const intentPublisher = Object.freeze({
    publish: intentPersistence.publish.bind(intentPersistence),
    getRecord: intentPersistence.getRecord.bind(intentPersistence),
    list: intentPersistence.list.bind(intentPersistence),
    updateStatus: intentPersistence.updateStatus.bind(intentPersistence),
    recordVote: intentPersistence.recordVote.bind(intentPersistence),
    recordResult: intentPersistence.recordResult.bind(intentPersistence),
    setDecisionReport: intentPersistence.setDecisionReport.bind(intentPersistence),
    subscribe: intentPersistence.subscribe.bind(intentPersistence),
  }) satisfies IIntentPublisher

  const internalCoordinator = new Coordinator(
    {
      name: options.name,
      minAgents: options.minAgents,
      dedupWindowMs: options.dedupWindowMs,
      audit: options.audit,
      intentPublisher,
      policyEngine: options.policyEngine,
    },
    options.decisionDependencies,
  )

  if (internalCoordinator.getExecutor() !== null) {
    throw new Error(
      "createServerCoordinatorComposition invariant failed: executor must be null",
    )
  }

  const coordinator: ExecutionDisabledCoordinator = Object.freeze({
    name: internalCoordinator.name,
    registerAgent: internalCoordinator.registerAgent.bind(internalCoordinator),
    unregisterAgent: internalCoordinator.unregisterAgent.bind(internalCoordinator),
    getAgents: internalCoordinator.getAgents.bind(internalCoordinator),
    submitProposal: internalCoordinator.submitProposal.bind(internalCoordinator),
    runCycle: internalCoordinator.runCycle.bind(internalCoordinator),
    getExecutor: () => null,
    getSafetyGuard: internalCoordinator.getSafetyGuard.bind(internalCoordinator),
    getAudit: internalCoordinator.getAudit.bind(internalCoordinator),
    getPolicyEngine: internalCoordinator.getPolicyEngine.bind(internalCoordinator),
    getOperationalStatus: internalCoordinator.getOperationalStatus.bind(internalCoordinator),
  })

  return Object.freeze({
    executionMode: "disabled",
    coordinator,
  })
}
