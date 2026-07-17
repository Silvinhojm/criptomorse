import type { CommandId, PayloadDigest } from "./f1a-foundation"

/**
 * RI-L2 F1b is a type-only contract. It represents the inputs and evidence that
 * future authoritative persistence must validate; it does not implement time,
 * storage, compare-and-swap, singleton enforcement, or economic authority.
 */
type Nominal<Name extends string> = { readonly __f1bNominal: Name }

export type GlobalOperationalAuthorityKey = "GLOBAL_OPERATIONAL_AUTHORITY"
export type CommandOwnershipKey = CommandId & Nominal<"CommandOwnershipKey">
export type InstallationId = string & Nominal<"InstallationId">
export type OperationalAuthorityLogicalId = string & Nominal<"OperationalAuthorityLogicalId">
export type BootstrapProtocolVersion = string & Nominal<"BootstrapProtocolVersion">
export type BootstrapRequestId = string & Nominal<"BootstrapRequestId">
export type AuthenticatedBootstrapInitiatorId = string & Nominal<"AuthenticatedBootstrapInitiatorId">
export type BootstrapInitiatorEvidence = string & Nominal<"BootstrapInitiatorEvidence">
export type BootstrapPayloadDigest = PayloadDigest & Nominal<"BootstrapPayloadDigest">
export type OperationalTransitionEvidence = string & Nominal<"OperationalTransitionEvidence">
export type EconomicEpochActivationEvidence = string & Nominal<"EconomicEpochActivationEvidence">
export type OwnerId = string & Nominal<"OwnerId">
export type LeaseId = string & Nominal<"LeaseId">

export type OperationalAuthorityRevision = string & Nominal<"OperationalAuthorityRevision">
export type OwnershipVersion = string & Nominal<"OwnershipVersion">
export type LeaseVersion = string & Nominal<"LeaseVersion">
export type FencingToken = string & Nominal<"FencingToken">
export type EconomicEpoch = string & Nominal<"EconomicEpoch">

export type AuthorityCreatedAt = string & Nominal<"AuthorityCreatedAt">
export type AuthorityTransitionedAt = string & Nominal<"AuthorityTransitionedAt">
export type EconomicEpochActivatedAt = string & Nominal<"EconomicEpochActivatedAt">
export type AcquiredAt = string & Nominal<"AcquiredAt">
export type ExpiresAt = string & Nominal<"ExpiresAt">
export type RenewedAt = string & Nominal<"RenewedAt">
export type ReleasedAt = string & Nominal<"ReleasedAt">
export type ExpiredAt = string & Nominal<"ExpiredAt">

export type OperationalAuthorityState = "RECOVERY_REQUIRED" | "OPERATIONAL"
export type ProcessingOwnershipState = "UNOWNED" | "OWNED" | "RELEASED" | "EXPIRED"

export interface AuthenticatedBootstrapCeremonyInitiator {
  readonly initiatorId: AuthenticatedBootstrapInitiatorId
  readonly authenticationEvidence: BootstrapInitiatorEvidence
  readonly authenticationState: "AUTHENTICATED"
}

export interface InstallationAuthorityBinding {
  readonly installationId: InstallationId
  readonly globalAuthorityKey: GlobalOperationalAuthorityKey
  readonly logicalAuthorityId: OperationalAuthorityLogicalId
  readonly protocolVersion: BootstrapProtocolVersion
}

export interface BootstrapRequestBinding {
  readonly requestId: BootstrapRequestId
  readonly payloadDigest: BootstrapPayloadDigest
  readonly installationAuthority: InstallationAuthorityBinding
}

export interface BootstrapRequest {
  readonly operation: "BOOTSTRAP_RECOVERY_AUTHORITY"
  readonly initiator: AuthenticatedBootstrapCeremonyInitiator
  readonly binding: BootstrapRequestBinding
  readonly initialRevision: OperationalAuthorityRevision
  readonly createdAt: AuthorityCreatedAt
  readonly requestedInitialState: "RECOVERY_REQUIRED"
  readonly activatesEconomicEpoch: false
  readonly economicEpoch: null
}

/**
 * `economicEpoch: null` describes only the authority's current epoch binding;
 * it does not prove that no economic epoch existed previously. Epoch IDs,
 * activation evidence, revocations, and transitions must be retained by a
 * future append-only journal/log. F1b does not implement that history store.
 * D1B-INV-032 remains a future storage and recovery-runtime requirement:
 * entering recovery may not rewrite or delete historical facts.
 */
export interface EpochHistoryPreservationContract {
  readonly preservationAcrossRecovery: "FUTURE_STORAGE_CONTRACT"
  readonly notATypeLevelGuarantee: true
  readonly currentNullEpochDoesNotProveNoHistoricalEpoch: true
  readonly recoveryMayNotDeleteHistoricalEpochEvidence: true
  readonly f1bImplementsHistoryStorage: false
}

export interface RecoveryRequiredOperationalAuthority {
  readonly state: "RECOVERY_REQUIRED"
  readonly globalAuthorityKey: GlobalOperationalAuthorityKey
  readonly logicalAuthorityId: OperationalAuthorityLogicalId
  readonly revision: OperationalAuthorityRevision
  readonly installationId: InstallationId
  readonly bootstrapRequestId: BootstrapRequestId
  readonly bootstrapPayloadDigest: BootstrapPayloadDigest
  readonly createdAt: AuthorityCreatedAt
  readonly economicEpoch: null
}

interface OperationalAuthorityRecordBase {
  readonly state: "OPERATIONAL"
  readonly globalAuthorityKey: GlobalOperationalAuthorityKey
  readonly logicalAuthorityId: OperationalAuthorityLogicalId
  readonly previousRevision: OperationalAuthorityRevision
  readonly revision: OperationalAuthorityRevision
  readonly transitionEvidence: OperationalTransitionEvidence
  readonly transitionedAt: AuthorityTransitionedAt
}

export interface EconomicEpochActivation {
  readonly act: "SEPARATE_POST_BOOTSTRAP_EPOCH_ACT"
  readonly globalAuthorityKey: GlobalOperationalAuthorityKey
  readonly logicalAuthorityId: OperationalAuthorityLogicalId
  readonly economicEpoch: EconomicEpoch
  readonly activationEvidence: EconomicEpochActivationEvidence
  readonly activatedAt: EconomicEpochActivatedAt
  readonly bootstrapSideEffect: false
  readonly inferredFromAuthorityRevision: false
  readonly inferredFromWallTime: false
}

export interface OperationalAuthorityWithoutEconomicEpoch extends OperationalAuthorityRecordBase {
  readonly economicEpoch: null
}

export interface OperationalAuthorityWithEconomicEpoch extends OperationalAuthorityRecordBase {
  readonly economicEpoch: EconomicEpoch
  readonly economicEpochActivation: EconomicEpochActivation
}

export type OperationalAuthorityRecord =
  | OperationalAuthorityWithoutEconomicEpoch
  | OperationalAuthorityWithEconomicEpoch

export type OperationalAuthority =
  | RecoveryRequiredOperationalAuthority
  | OperationalAuthorityRecord

interface OperationalAuthorityProofBase {
  readonly proofKind: "OPERATIONAL_AUTHORITY_PROOF"
  readonly state: "OPERATIONAL"
  readonly globalAuthorityKey: GlobalOperationalAuthorityKey
  readonly logicalAuthorityId: OperationalAuthorityLogicalId
  readonly revision: OperationalAuthorityRevision
  readonly transitionEvidence: OperationalTransitionEvidence
}

export interface ActiveEconomicEpochProof {
  readonly proofKind: "ACTIVE_ECONOMIC_EPOCH_PROOF"
  readonly globalAuthorityKey: GlobalOperationalAuthorityKey
  readonly logicalAuthorityId: OperationalAuthorityLogicalId
  readonly economicEpoch: EconomicEpoch
  readonly activationEvidence: EconomicEpochActivationEvidence
  readonly activatedAt: EconomicEpochActivatedAt
  readonly createdBySeparatePostBootstrapAct: true
  readonly runtimeValidationProvided: false
}

export interface OperationalAuthorityWithoutEconomicEpochProof extends OperationalAuthorityProofBase {
  readonly economicEpoch: null
}

export interface OperationalAuthorityWithEconomicEpochProof extends OperationalAuthorityProofBase {
  readonly economicEpoch: EconomicEpoch
  readonly activeEconomicEpoch: ActiveEconomicEpochProof
}

export type OperationalAuthorityProof =
  | OperationalAuthorityWithoutEconomicEpochProof
  | OperationalAuthorityWithEconomicEpochProof

export type BootstrapResult =
  | {
      readonly kind: "RECOVERY_AUTHORITY_CREATED"
      readonly authority: RecoveryRequiredOperationalAuthority
      readonly idempotentReplay: false
    }
  | {
      readonly kind: "EXISTING_RECOVERY_AUTHORITY_RETURNED"
      readonly authority: RecoveryRequiredOperationalAuthority
      readonly idempotentReplay: true
      readonly binding: BootstrapRequestBinding
    }
  | {
      readonly kind: "BOOTSTRAP_PAYLOAD_CONFLICT"
      readonly authorityCreated: false
      readonly failClosed: true
    }
  | {
      readonly kind: "INITIATOR_NOT_AUTHENTICATED"
      readonly authorityCreated: false
      readonly failClosed: true
    }
  | {
      readonly kind: "ERROR_FAIL_CLOSED"
      readonly authorityCreated: false
      readonly failClosed: true
    }

export interface UnownedOwnershipRecord {
  readonly state: "UNOWNED"
  readonly ownershipKey: CommandOwnershipKey
}

export interface OwnedOwnershipRecord {
  readonly state: "OWNED"
  readonly ownershipKey: CommandOwnershipKey
  readonly ownerId: OwnerId
  readonly leaseId: LeaseId
  readonly ownershipVersion: OwnershipVersion
  readonly leaseVersion: LeaseVersion
  readonly fencingToken: FencingToken
  readonly acquiredAt: AcquiredAt
  readonly expiresAt: ExpiresAt
  readonly leaseInterval: "[acquiredAt, expiresAt)"
}

export interface ReleasedOwnershipRecord {
  readonly state: "RELEASED"
  readonly ownershipKey: CommandOwnershipKey
  readonly previousOwnerId: OwnerId
  readonly previousLeaseId: LeaseId
  readonly ownershipVersion: OwnershipVersion
  readonly leaseVersion: LeaseVersion
  readonly fencingToken: FencingToken
  readonly releasedAt: ReleasedAt
  readonly terminal: true
}

export interface ExpiredOwnershipRecord {
  readonly state: "EXPIRED"
  readonly ownershipKey: CommandOwnershipKey
  readonly previousOwnerId: OwnerId
  readonly previousLeaseId: LeaseId
  readonly ownershipVersion: OwnershipVersion
  readonly leaseVersion: LeaseVersion
  readonly fencingToken: FencingToken
  readonly expiredAt: ExpiredAt
  readonly terminal: true
  readonly revivable: false
}

export type ProcessingOwnership =
  | UnownedOwnershipRecord
  | OwnedOwnershipRecord
  | ReleasedOwnershipRecord
  | ExpiredOwnershipRecord

export interface GenesisFencingPrecondition {
  readonly kind: "GENESIS_FENCING_ABSENCE"
  readonly ownershipKey: CommandOwnershipKey
  readonly noPreviousFencingToken: true
}

export interface ExistingFencingPrecondition {
  readonly kind: "EXISTING_FENCING_MATCH"
  readonly ownershipKey: CommandOwnershipKey
  readonly expectedOwnershipVersion: OwnershipVersion
  readonly expectedLeaseVersion: LeaseVersion
  readonly expectedFencingToken: FencingToken
}

export type FencingPrecondition = GenesisFencingPrecondition | ExistingFencingPrecondition

export interface OwnershipProof {
  readonly proofKind: "COMMAND_OWNERSHIP_PROOF"
  readonly ownershipKey: CommandOwnershipKey
  readonly ownerId: OwnerId
  readonly leaseId: LeaseId
  readonly ownershipVersion: OwnershipVersion
  readonly leaseVersion: LeaseVersion
  readonly fencingToken: FencingToken
  readonly leaseValidity: "VALID_AT_AUTHORITATIVE_COMMIT"
}

export interface ProtectedOperationalActionProof {
  readonly proofKind: "PROTECTED_OPERATIONAL_ACTION_PROOF"
  readonly operationalAuthority: OperationalAuthorityProof
  readonly ownership: OwnershipProof
  readonly fencingPrecondition: ExistingFencingPrecondition
  readonly economicActionAuthorized: false
}

export interface RenewCurrentLeaseRequest {
  readonly operation: "RENEW_CURRENT_LEASE"
  readonly authority: OperationalAuthorityProof
  readonly current: OwnedOwnershipRecord
  readonly fencingPrecondition: ExistingFencingPrecondition
  readonly nextLeaseVersion: LeaseVersion
  readonly renewedAt: RenewedAt
  readonly nextExpiresAt: ExpiresAt
  readonly preserveOwnerId: OwnerId
  readonly preserveLeaseId: LeaseId
  readonly preserveOwnershipVersion: OwnershipVersion
  readonly preserveFencingToken: FencingToken
  readonly validityDecisionPoint: "AUTHORITATIVE_COMMIT"
}

export interface RenewedLeaseTransition {
  readonly previous: OwnedOwnershipRecord
  readonly current: OwnedOwnershipRecord
  readonly changedDomain: "LEASE_VERSION_AND_EXPIRY_ONLY"
  readonly authoritativeCommitBeforePreviousExpiry: true
}

export type LeaseRenewalResult =
  | { readonly kind: "RENEWED"; readonly transition: RenewedLeaseTransition }
  | { readonly kind: "LEASE_EXPIRED_REACQUISITION_REQUIRED"; readonly renewed: false; readonly reacquisitionRequired: true }
  | { readonly kind: "STALE_LEASE_VERSION"; readonly renewed: false }
  | { readonly kind: "STALE_OWNERSHIP_VERSION"; readonly renewed: false }
  | { readonly kind: "STALE_FENCING_TOKEN"; readonly renewed: false }
  | { readonly kind: "AUTHORITY_NOT_OPERATIONAL"; readonly renewed: false }
  | {
      readonly kind: "OUTCOME_UNKNOWN_REQUIRES_READBACK"
      readonly renewed: false
      readonly ownershipProven: false
      readonly mutatingActionAllowed: false
      readonly authoritativeReadbackRequired: true
      readonly blindRetryAllowed: false
    }

export interface ReacquisitionAtomicityContract {
  readonly mustBeAtomic: true
  readonly duplicateConcurrentReacquisitionsMayBothSucceed: false
  readonly atomicityKey: "CommandOwnershipKey"
  readonly decisionPoint: "AUTHORITATIVE_COMMIT"
  readonly storageVendor: "UNSPECIFIED"
  readonly futureStorageConformanceRequired: true
  readonly f1bTypesProvideAtomicity: false
  readonly localMemoryMayActAsAuthority: false
}

export interface ReacquisitionNextGrant {
  readonly ownerId: OwnerId
  readonly newLeaseId: LeaseId
  readonly newOwnershipVersion: OwnershipVersion
  readonly initialLeaseVersion: LeaseVersion
  readonly newFencingToken: FencingToken
  readonly acquiredAt: AcquiredAt
  readonly expiresAt: ExpiresAt
  readonly reusesPreviousLease: false
  readonly revivesExpiredLease: false
}

interface ReacquisitionRequestBase {
  readonly authority: OperationalAuthorityProof
  readonly nextGrant: ReacquisitionNextGrant
  readonly atomicity: ReacquisitionAtomicityContract
  readonly validityDecisionPoint: "AUTHORITATIVE_COMMIT"
}

export interface GenesisOwnershipAcquisitionRequest extends ReacquisitionRequestBase {
  readonly operation: "ACQUIRE_GENESIS_OWNERSHIP"
  readonly current: UnownedOwnershipRecord
  readonly fencingPrecondition: GenesisFencingPrecondition
}

export interface ReacquireReleasedOrExpiredOwnershipRequest extends ReacquisitionRequestBase {
  readonly operation: "REACQUIRE_OWNERSHIP"
  readonly current: ReleasedOwnershipRecord | ExpiredOwnershipRecord
  readonly fencingPrecondition: ExistingFencingPrecondition
}

export interface TakeoverExpiredOwnershipRequest extends ReacquisitionRequestBase {
  readonly operation: "TAKEOVER_EXPIRED_OWNERSHIP"
  readonly current: ExpiredOwnershipRecord
  readonly fencingPrecondition: ExistingFencingPrecondition
}

export type ReacquireOwnershipRequest =
  | GenesisOwnershipAcquisitionRequest
  | ReacquireReleasedOrExpiredOwnershipRequest
  | TakeoverExpiredOwnershipRequest

export interface ReacquiredOwnershipTransition {
  readonly previous: UnownedOwnershipRecord | ReleasedOwnershipRecord | ExpiredOwnershipRecord
  readonly current: OwnedOwnershipRecord
  readonly newOwnershipGeneration: true
  readonly newLease: true
  readonly newFencingTokenForKey: true
  readonly oldLeaseRevived: false
  readonly authoritativeAtomicCommit: true
}

export type OwnershipReacquisitionResult =
  | {
      readonly kind: "REACQUIRED"
      readonly transition: ReacquiredOwnershipTransition
      readonly ownershipProof: OwnershipProof
    }
  | { readonly kind: "NOT_REACQUIRABLE"; readonly ownershipProven: false }
  | { readonly kind: "STALE_OWNERSHIP_VERSION"; readonly ownershipProven: false }
  | { readonly kind: "STALE_LEASE_VERSION"; readonly ownershipProven: false }
  | { readonly kind: "STALE_FENCING_TOKEN"; readonly ownershipProven: false }
  | { readonly kind: "AUTHORITY_NOT_OPERATIONAL"; readonly ownershipProven: false }
  | { readonly kind: "CONCURRENT_REACQUISITION_CONFLICT"; readonly ownershipProven: false }
  | {
      readonly kind: "OUTCOME_UNKNOWN_REQUIRES_READBACK"
      readonly ownershipProven: false
      readonly mutatingActionAllowed: false
      readonly authoritativeReadbackRequired: true
      readonly blindRetryAllowed: false
    }

export interface ReleaseOwnershipTransition {
  readonly operation: "RELEASE_OWNERSHIP"
  readonly authority: OperationalAuthorityProof
  readonly current: OwnedOwnershipRecord
  readonly fencingPrecondition: ExistingFencingPrecondition
  readonly result: ReleasedOwnershipRecord
}

export interface ExpireOwnershipTransition {
  readonly operation: "EXPIRE_OWNERSHIP_AT_AUTHORITATIVE_COMMIT"
  readonly current: OwnedOwnershipRecord
  readonly fencingPrecondition: ExistingFencingPrecondition
  readonly result: ExpiredOwnershipRecord
  readonly authoritativeNowAtOrAfterExpiresAt: true
}

/**
 * Invariants intentionally left to future authoritative storage:
 * - one logical global authority record;
 * - numeric/ordered monotonicity of revisions and per-key fencing tokens;
 * - equality of every proof/precondition key with the persisted record key;
 * - lease validity at authoritative commit;
 * - atomic exclusion of duplicate concurrent reacquisitions.
 */
