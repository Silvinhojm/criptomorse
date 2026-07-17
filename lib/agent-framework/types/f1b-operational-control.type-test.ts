import type { CommandId } from "./f1a-foundation"
import type {
  ActiveEconomicEpochProof,
  AuthorityTransitionedAt,
  BootstrapRequest,
  BootstrapRequestId,
  BootstrapResult,
  CommandOwnershipKey,
  ExistingFencingPrecondition,
  EconomicEpoch,
  EpochHistoryPreservationContract,
  ExpiredOwnershipRecord,
  FencingPrecondition,
  FencingToken,
  GenesisFencingPrecondition,
  GlobalOperationalAuthorityKey,
  LeaseId,
  LeaseRenewalResult,
  LeaseVersion,
  OperationalAuthority,
  OperationalAuthorityLogicalId,
  OperationalAuthorityProof,
  OperationalAuthorityRecord,
  OperationalAuthorityRevision,
  OperationalAuthorityState,
  OperationalAuthorityWithEconomicEpoch,
  OperationalAuthorityWithoutEconomicEpoch,
  OwnedOwnershipRecord,
  OwnerId,
  OwnershipProof,
  OwnershipReacquisitionResult,
  OwnershipVersion,
  ProcessingOwnership,
  ProcessingOwnershipState,
  ProtectedOperationalActionProof,
  ReacquireOwnershipRequest,
  ReacquisitionAtomicityContract,
  ReacquisitionNextGrant,
  RecoveryRequiredOperationalAuthority,
  RenewCurrentLeaseRequest,
  RenewedLeaseTransition,
  UnownedOwnershipRecord,
} from "./f1b-operational-control"

type Assert<Condition extends true> = Condition
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false
type IsAssignable<From, To> = [From] extends [To] ? true : false
type Not<Value extends boolean> = Value extends true ? false : true
type HasRequiredKey<Shape, Key extends keyof Shape> =
  Equal<Pick<Shape, Key>, Required<Pick<Shape, Key>>>
type FunctionKeys<Shape> = {
  [Key in keyof Shape]-?: Shape[Key] extends (...args: never[]) => unknown ? Key : never
}[keyof Shape]

// 1. Both state machines are exact closed sets.
type _OperationalAuthorityStateClosed = Assert<Equal<
  OperationalAuthorityState,
  "RECOVERY_REQUIRED" | "OPERATIONAL"
>>
type _OperationalAuthorityRecordsClosed = Assert<Equal<
  OperationalAuthority["state"],
  OperationalAuthorityState
>>
type _ProcessingOwnershipStateClosed = Assert<Equal<
  ProcessingOwnershipState,
  "UNOWNED" | "OWNED" | "RELEASED" | "EXPIRED"
>>
type _ProcessingOwnershipRecordsClosed = Assert<Equal<
  ProcessingOwnership["state"],
  ProcessingOwnershipState
>>

// 2. Global authority and per-command ownership keys are not interchangeable.
type _CanonicalGlobalKeyAccepted = Assert<IsAssignable<
  "GLOBAL_OPERATIONAL_AUTHORITY",
  GlobalOperationalAuthorityKey
>>
type _OtherGlobalKeyRejected = Assert<Not<IsAssignable<
  "ANOTHER_OPERATIONAL_AUTHORITY",
  GlobalOperationalAuthorityKey
>>>
type _GenericStringRejectedAsGlobalKey = Assert<Not<IsAssignable<string, GlobalOperationalAuthorityKey>>>
type _GlobalKeyNotOwnershipKey = Assert<Not<IsAssignable<
  GlobalOperationalAuthorityKey,
  CommandOwnershipKey
>>>
type _OwnershipKeyNotGlobalKey = Assert<Not<IsAssignable<
  CommandOwnershipKey,
  GlobalOperationalAuthorityKey
>>>
type _RawCommandIdNotOwnershipKey = Assert<Not<IsAssignable<CommandId, CommandOwnershipKey>>>

// 3. The four revision domains are nominally distinct in both directions.
type _AuthorityRevisionNotOwnership = Assert<Not<IsAssignable<OperationalAuthorityRevision, OwnershipVersion>>>
type _OwnershipNotAuthorityRevision = Assert<Not<IsAssignable<OwnershipVersion, OperationalAuthorityRevision>>>
type _AuthorityRevisionNotLease = Assert<Not<IsAssignable<OperationalAuthorityRevision, LeaseVersion>>>
type _LeaseNotAuthorityRevision = Assert<Not<IsAssignable<LeaseVersion, OperationalAuthorityRevision>>>
type _AuthorityRevisionNotFencing = Assert<Not<IsAssignable<OperationalAuthorityRevision, FencingToken>>>
type _FencingNotAuthorityRevision = Assert<Not<IsAssignable<FencingToken, OperationalAuthorityRevision>>>
type _OwnershipNotLease = Assert<Not<IsAssignable<OwnershipVersion, LeaseVersion>>>
type _LeaseNotOwnership = Assert<Not<IsAssignable<LeaseVersion, OwnershipVersion>>>
type _OwnershipNotFencing = Assert<Not<IsAssignable<OwnershipVersion, FencingToken>>>
type _FencingNotOwnership = Assert<Not<IsAssignable<FencingToken, OwnershipVersion>>>
type _LeaseNotFencing = Assert<Not<IsAssignable<LeaseVersion, FencingToken>>>
type _FencingNotLease = Assert<Not<IsAssignable<FencingToken, LeaseVersion>>>

// OPA-004 is a fifth, independent nominal domain rather than a revision alias.
type _EpochNotAuthorityRevision = Assert<Not<IsAssignable<EconomicEpoch, OperationalAuthorityRevision>>>
type _AuthorityRevisionNotEpoch = Assert<Not<IsAssignable<OperationalAuthorityRevision, EconomicEpoch>>>
type _EpochNotOwnership = Assert<Not<IsAssignable<EconomicEpoch, OwnershipVersion>>>
type _OwnershipNotEpoch = Assert<Not<IsAssignable<OwnershipVersion, EconomicEpoch>>>
type _EpochNotLease = Assert<Not<IsAssignable<EconomicEpoch, LeaseVersion>>>
type _LeaseNotEpoch = Assert<Not<IsAssignable<LeaseVersion, EconomicEpoch>>>
type _EpochNotFencing = Assert<Not<IsAssignable<EconomicEpoch, FencingToken>>>
type _FencingNotEpoch = Assert<Not<IsAssignable<FencingToken, EconomicEpoch>>>
type _TimestampNotEpoch = Assert<Not<IsAssignable<AuthorityTransitionedAt, EconomicEpoch>>>
type _EpochNotTimestamp = Assert<Not<IsAssignable<EconomicEpoch, AuthorityTransitionedAt>>>
type _LogicalIdNotEpoch = Assert<Not<IsAssignable<OperationalAuthorityLogicalId, EconomicEpoch>>>
type _BootstrapRequestIdNotEpoch = Assert<Not<IsAssignable<BootstrapRequestId, EconomicEpoch>>>

// 4–7. Bootstrap can only create recovery, has no economic epoch, and binds an
// authenticated initiator to an installation and idempotent payload.
type _BootstrapInitialState = Assert<Equal<
  BootstrapRequest["requestedInitialState"],
  "RECOVERY_REQUIRED"
>>
type _BootstrapDoesNotActivateEpoch = Assert<Equal<
  BootstrapRequest["activatesEconomicEpoch"],
  false
>>
type _BootstrapEpochExplicitlyNull = Assert<Equal<BootstrapRequest["economicEpoch"], null>>
type _BootstrapInitiatorRequired = Assert<HasRequiredKey<BootstrapRequest, "initiator">>
type _BootstrapBindingRequired = Assert<HasRequiredKey<BootstrapRequest, "binding">>
type _BootstrapBindingHasInstallation = Assert<HasRequiredKey<BootstrapRequest["binding"], "installationAuthority">>
type _BootstrapBindingHasRequestId = Assert<HasRequiredKey<BootstrapRequest["binding"], "requestId">>
type _BootstrapBindingHasPayload = Assert<HasRequiredKey<BootstrapRequest["binding"], "payloadDigest">>
type _BootstrapInitiatorAuthenticated = Assert<Equal<
  BootstrapRequest["initiator"]["authenticationState"],
  "AUTHENTICATED"
>>
type _BootstrapSuccessOnlyRecovery = Assert<Equal<
  Extract<BootstrapResult, { kind: "RECOVERY_AUTHORITY_CREATED" }> ["authority"]["state"],
  "RECOVERY_REQUIRED"
>>
type _RecoveryHasNoEconomicEpoch = Assert<Equal<
  RecoveryRequiredOperationalAuthority["economicEpoch"],
  null
>>
type _BootstrapCreatedAuthorityEpochNull = Assert<Equal<
  Extract<BootstrapResult, { kind: "RECOVERY_AUTHORITY_CREATED" }>["authority"]["economicEpoch"],
  null
>>
type _BootstrapReplayAuthorityEpochNull = Assert<Equal<
  Extract<BootstrapResult, { kind: "EXISTING_RECOVERY_AUTHORITY_RETURNED" }>["authority"]["economicEpoch"],
  null
>>
type _BootstrapCannotBeActiveEpochProof = Assert<Not<IsAssignable<
  RecoveryRequiredOperationalAuthority,
  ActiveEconomicEpochProof
>>>

// 5. OPERATIONAL is a separate shape with transition evidence and revisions.
type _OperationalRecordState = Assert<Equal<OperationalAuthorityRecord["state"], "OPERATIONAL">>
type _OperationalEvidenceRequired = Assert<HasRequiredKey<OperationalAuthorityRecord, "transitionEvidence">>
type _OperationalRevisionRequired = Assert<HasRequiredKey<OperationalAuthorityRecord, "revision">>
type _OperationalPreviousRevisionRequired = Assert<HasRequiredKey<OperationalAuthorityRecord, "previousRevision">>
type _OperationalEpochFieldRequired = Assert<HasRequiredKey<OperationalAuthorityRecord, "economicEpoch">>
type _OperationalEpochNullable = Assert<Equal<
  OperationalAuthorityRecord["economicEpoch"],
  EconomicEpoch | null
>>
type _RecoveryNotOperationalRecord = Assert<Not<IsAssignable<
  RecoveryRequiredOperationalAuthority,
  OperationalAuthorityRecord
>>>
type _OperationalWithoutEpochIsNull = Assert<Equal<
  OperationalAuthorityWithoutEconomicEpoch["economicEpoch"],
  null
>>
type _OperationalActiveEpochRequiresEvidence = Assert<HasRequiredKey<
  OperationalAuthorityWithEconomicEpoch,
  "economicEpochActivation"
>>
type _ActiveEpochProofRequiresEvidence = Assert<HasRequiredKey<
  ActiveEconomicEpochProof,
  "activationEvidence"
>>
type _ActiveEpochProofRequiresSeparateAct = Assert<Equal<
  ActiveEconomicEpochProof["createdBySeparatePostBootstrapAct"],
  true
>>
type _AuthorityProofMaterializesEpoch = Assert<HasRequiredKey<OperationalAuthorityProof, "economicEpoch">>
type _AuthorityProofEpochNullable = Assert<Equal<
  OperationalAuthorityProof["economicEpoch"],
  EconomicEpoch | null
>>

// F1B-COR-003 explicitly distinguishes current state from future history.
type _EpochHistoryPreservationIsFutureStorageContract = Assert<Equal<
  EpochHistoryPreservationContract["preservationAcrossRecovery"],
  "FUTURE_STORAGE_CONTRACT"
>>
type _EpochHistoryNotTypeLevelGuarantee = Assert<Equal<
  EpochHistoryPreservationContract["notATypeLevelGuarantee"],
  true
>>
type _CurrentNullDoesNotProveNoHistoricalEpoch = Assert<Equal<
  EpochHistoryPreservationContract["currentNullEpochDoesNotProveNoHistoricalEpoch"],
  true
>>
type _RecoveryMayNotDeleteHistoricalEvidence = Assert<Equal<
  EpochHistoryPreservationContract["recoveryMayNotDeleteHistoricalEpochEvidence"],
  true
>>
type _F1bDoesNotImplementHistoryStorage = Assert<Equal<
  EpochHistoryPreservationContract["f1bImplementsHistoryStorage"],
  false
>>
type _EpochHistoryContractExactKeys = Assert<Equal<
  keyof EpochHistoryPreservationContract,
  | "preservationAcrossRecovery"
  | "notATypeLevelGuarantee"
  | "currentNullEpochDoesNotProveNoHistoricalEpoch"
  | "recoveryMayNotDeleteHistoricalEpochEvidence"
  | "f1bImplementsHistoryStorage"
>>
type _EpochHistoryContractHasNoMethods = Assert<Equal<
  FunctionKeys<EpochHistoryPreservationContract>,
  never
>>
type _EpochHistoryContractIsNotActiveEpochProof = Assert<Not<IsAssignable<
  EpochHistoryPreservationContract,
  ActiveEconomicEpochProof
>>>

// 8. Local ownership proof and global operational proof cannot substitute one another.
type _OwnershipProofNotAuthorityProof = Assert<Not<IsAssignable<OwnershipProof, OperationalAuthorityProof>>>
type _AuthorityProofNotOwnershipProof = Assert<Not<IsAssignable<OperationalAuthorityProof, OwnershipProof>>>
type _ProtectedProofRequiresAuthority = Assert<HasRequiredKey<ProtectedOperationalActionProof, "operationalAuthority">>
type _ProtectedProofRequiresOwnership = Assert<HasRequiredKey<ProtectedOperationalActionProof, "ownership">>
type _ProtectedProofDoesNotAuthorizeEconomics = Assert<Equal<
  ProtectedOperationalActionProof["economicActionAuthorized"],
  false
>>

// 9–10. Fencing is mandatory, key-scoped, and genesis absence is explicit.
type _RenewalFencingRequired = Assert<HasRequiredKey<RenewCurrentLeaseRequest, "fencingPrecondition">>
type _ReacquisitionFencingRequired = Assert<HasRequiredKey<ReacquireOwnershipRequest, "fencingPrecondition">>
type _ProtectedFencingRequired = Assert<HasRequiredKey<ProtectedOperationalActionProof, "fencingPrecondition">>
type _GenesisCaseExplicit = Assert<Equal<
  Extract<FencingPrecondition, { kind: "GENESIS_FENCING_ABSENCE" }>,
  GenesisFencingPrecondition
>>
type _ExistingCaseExplicit = Assert<Equal<
  Extract<FencingPrecondition, { kind: "EXISTING_FENCING_MATCH" }>,
  ExistingFencingPrecondition
>>
type _GenesisCarriesKey = Assert<HasRequiredKey<GenesisFencingPrecondition, "ownershipKey">>
type _ExistingCarriesKey = Assert<HasRequiredKey<ExistingFencingPrecondition, "ownershipKey">>

// 11–15. Renewal is only for OWNED and cannot revive a terminal lease.
type _RenewalAcceptsOwned = Assert<Equal<RenewCurrentLeaseRequest["current"], OwnedOwnershipRecord>>
type _RenewalRejectsExpired = Assert<Not<IsAssignable<ExpiredOwnershipRecord, RenewCurrentLeaseRequest["current"]>>>
type _RenewalPreservesOwner = Assert<Equal<RenewCurrentLeaseRequest["preserveOwnerId"], OwnerId>>
type _RenewalPreservesLease = Assert<Equal<RenewCurrentLeaseRequest["preserveLeaseId"], LeaseId>>
type _RenewalPreservesOwnership = Assert<Equal<RenewCurrentLeaseRequest["preserveOwnershipVersion"], OwnershipVersion>>
type _RenewalPreservesFencing = Assert<Equal<RenewCurrentLeaseRequest["preserveFencingToken"], FencingToken>>
type _RenewalChangesLeaseDomainOnly = Assert<Equal<
  RenewedLeaseTransition["changedDomain"],
  "LEASE_VERSION_AND_EXPIRY_ONLY"
>>
type _RenewalCommitBeforeExpiry = Assert<Equal<
  RenewedLeaseTransition["authoritativeCommitBeforePreviousExpiry"],
  true
>>
type _ExpiredResultRequiresReacquisition = Assert<Equal<
  Extract<LeaseRenewalResult, { kind: "LEASE_EXPIRED_REACQUISITION_REQUIRED" }>["reacquisitionRequired"],
  true
>>

// 12–14. Reacquisition excludes OWNED and requires a wholly new grant even for
// the same OwnerId. Equality and monotonicity are future storage checks.
type ReacquisitionCurrent = ReacquireOwnershipRequest["current"]
type _ReacquisitionRejectsOwned = Assert<Not<IsAssignable<OwnedOwnershipRecord, ReacquisitionCurrent>>>
type _ReacquisitionAcceptsUnowned = Assert<IsAssignable<UnownedOwnershipRecord, ReacquisitionCurrent>>
type _ReacquisitionRequiresNewLease = Assert<HasRequiredKey<ReacquisitionNextGrant, "newLeaseId">>
type _ReacquisitionRequiresNewOwnership = Assert<HasRequiredKey<ReacquisitionNextGrant, "newOwnershipVersion">>
type _ReacquisitionRequiresInitialLeaseVersion = Assert<HasRequiredKey<ReacquisitionNextGrant, "initialLeaseVersion">>
type _ReacquisitionRequiresNewFencing = Assert<HasRequiredKey<ReacquisitionNextGrant, "newFencingToken">>
type _ReacquisitionNeverRevives = Assert<Equal<ReacquisitionNextGrant["revivesExpiredLease"], false>>
type _TerminalLeaseNotRenewalInput = Assert<Not<IsAssignable<
  Extract<ProcessingOwnership, { state: "RELEASED" | "EXPIRED" }>,
  RenewCurrentLeaseRequest["current"]
>>>

// 16. Authority revision is not present in local grant transition fields.
type _NextGrantHasNoAuthorityRevision = Assert<Not<
  "operationalAuthorityRevision" extends keyof ReacquisitionNextGrant ? true : false
>>
type _RenewalNextLeaseVersionIndependent = Assert<Not<IsAssignable<
  RenewCurrentLeaseRequest["nextLeaseVersion"],
  OperationalAuthorityRevision
>>>

// 17–18. Unknown and fail-closed results cannot prove success or permit mutation.
type UnknownReacquisition = Extract<
  OwnershipReacquisitionResult,
  { kind: "OUTCOME_UNKNOWN_REQUIRES_READBACK" }
>
type _UnknownHasNoOwnershipProof = Assert<Not<
  "ownershipProof" extends keyof UnknownReacquisition ? true : false
>>
type _UnknownRequiresReadback = Assert<Equal<UnknownReacquisition["authoritativeReadbackRequired"], true>>
type _UnknownForbidsBlindRetry = Assert<Equal<UnknownReacquisition["blindRetryAllowed"], false>>
type _UnknownForbidsMutation = Assert<Equal<UnknownReacquisition["mutatingActionAllowed"], false>>
type BootstrapFailure = Exclude<BootstrapResult, { kind: "RECOVERY_AUTHORITY_CREATED" | "EXISTING_RECOVERY_AUTHORITY_RETURNED" }>
type _BootstrapFailureCannotBeSuccess = Assert<Not<IsAssignable<
  BootstrapFailure["kind"],
  "RECOVERY_AUTHORITY_CREATED" | "EXISTING_RECOVERY_AUTHORITY_RETURNED"
>>>

// 19. Result discriminants are exact unions, never free strings.
type _RenewalResultsClosed = Assert<Equal<
  LeaseRenewalResult["kind"],
  | "RENEWED"
  | "LEASE_EXPIRED_REACQUISITION_REQUIRED"
  | "STALE_LEASE_VERSION"
  | "STALE_OWNERSHIP_VERSION"
  | "STALE_FENCING_TOKEN"
  | "AUTHORITY_NOT_OPERATIONAL"
  | "OUTCOME_UNKNOWN_REQUIRES_READBACK"
>>
type _ReacquisitionResultsClosed = Assert<Equal<
  OwnershipReacquisitionResult["kind"],
  | "REACQUIRED"
  | "NOT_REACQUIRABLE"
  | "STALE_OWNERSHIP_VERSION"
  | "STALE_LEASE_VERSION"
  | "STALE_FENCING_TOKEN"
  | "AUTHORITY_NOT_OPERATIONAL"
  | "CONCURRENT_REACQUISITION_CONFLICT"
  | "OUTCOME_UNKNOWN_REQUIRES_READBACK"
>>
type _BootstrapResultsClosed = Assert<Equal<
  BootstrapResult["kind"],
  | "RECOVERY_AUTHORITY_CREATED"
  | "EXISTING_RECOVERY_AUTHORITY_RETURNED"
  | "BOOTSTRAP_PAYLOAD_CONFLICT"
  | "INITIATOR_NOT_AUTHENTICATED"
  | "ERROR_FAIL_CLOSED"
>>

// 20. Atomicity is an explicit future-storage contract, never a type capability.
type _AtomicityRequired = Assert<Equal<ReacquisitionAtomicityContract["mustBeAtomic"], true>>
type _ConcurrentWinnersForbidden = Assert<Equal<
  ReacquisitionAtomicityContract["duplicateConcurrentReacquisitionsMayBothSucceed"],
  false
>>
type _F1bProvidesNoAtomicity = Assert<Equal<
  ReacquisitionAtomicityContract["f1bTypesProvideAtomicity"],
  false
>>
type _LocalMemoryNotAuthority = Assert<Equal<
  ReacquisitionAtomicityContract["localMemoryMayActAsAuthority"],
  false
>>

// 21. This file has type-only direct imports and contributes no runtime emit.
export type F1bOperationalControlTypeTests =
  | _OperationalAuthorityStateClosed
  | _ProcessingOwnershipStateClosed
  | _CanonicalGlobalKeyAccepted
  | _OtherGlobalKeyRejected
  | _GenericStringRejectedAsGlobalKey
  | _GlobalKeyNotOwnershipKey
  | _AuthorityRevisionNotOwnership
  | _EpochNotAuthorityRevision
  | _EpochNotOwnership
  | _EpochNotLease
  | _EpochNotFencing
  | _BootstrapInitialState
  | _BootstrapEpochExplicitlyNull
  | _BootstrapCannotBeActiveEpochProof
  | _OperationalEvidenceRequired
  | _OperationalEpochFieldRequired
  | _OperationalActiveEpochRequiresEvidence
  | _EpochHistoryPreservationIsFutureStorageContract
  | _EpochHistoryNotTypeLevelGuarantee
  | _CurrentNullDoesNotProveNoHistoricalEpoch
  | _RecoveryMayNotDeleteHistoricalEvidence
  | _F1bDoesNotImplementHistoryStorage
  | _EpochHistoryContractExactKeys
  | _EpochHistoryContractHasNoMethods
  | _EpochHistoryContractIsNotActiveEpochProof
  | _OwnershipProofNotAuthorityProof
  | _RenewalFencingRequired
  | _RenewalRejectsExpired
  | _ReacquisitionRejectsOwned
  | _UnknownHasNoOwnershipProof
  | _AtomicityRequired
