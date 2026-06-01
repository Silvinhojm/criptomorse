// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AgentIdentity
 * @notice ERC-8004 Identity Registry para agentes do CriptoMorse-Arc
 * @dev Implementa ERC-721 + registry de identidade de agentes autônomos
 *      Compatível com a spec oficial: https://eips.ethereum.org/EIPS/eip-8004
 */

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// ─────────────────────────────────────────────
//  Interface ERC-8004 (Identity Registry)
// ─────────────────────────────────────────────
interface IERC8004IdentityRegistry {
    /// @notice Registra um novo agente e minta um NFT de identidade
    function registerAgent(string calldata agentURI) external returns (uint256 agentId);

    /// @notice Atualiza o URI de um agente (somente owner/operator)
    function setAgentURI(uint256 agentId, string calldata agentURI) external;

    /// @notice Retorna o URI do agent card (JSON off-chain)
    function getAgentURI(uint256 agentId) external view returns (string memory);

    /// @notice Retorna o operador atual de um agente
    function getOperator(uint256 agentId) external view returns (address);

    /// @notice Define um operador para gerenciar o agente
    function setOperator(uint256 agentId, address operator) external;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI);
    event AgentURIUpdated(uint256 indexed agentId, string newURI);
    event OperatorSet(uint256 indexed agentId, address indexed operator);
}

// ─────────────────────────────────────────────
//  Contrato Principal
// ─────────────────────────────────────────────
contract AgentIdentity is ERC721URIStorage, Ownable, IERC8004IdentityRegistry {

    // ── Storage ──────────────────────────────
    uint256 private _nextAgentId = 1;

    // agentId → operador delegado
    mapping(uint256 => address) private _operators;

    // agentId → wallet de pagamento do agente
    mapping(uint256 => address) public agentPaymentAddress;

    // agentId → trust level (0=unverified, 1=verified, 2=trusted)
    mapping(uint256 => uint8) public trustLevel;

    // agentId → jobs concluídos (integração com ERC-8183)
    mapping(uint256 => uint256) public completedJobs;

    // wallet → agentId (lookup reverso)
    mapping(address => uint256) public walletToAgent;

    // ── Structs ───────────────────────────────
    struct AgentInfo {
        uint256 agentId;
        address owner;
        address operator;
        address paymentAddress;
        uint8   trustLevel;
        uint256 completedJobs;
        string  agentURI;
    }

    // ── Constructor ───────────────────────────
    constructor() ERC721("CriptoMorse AgentIdentity", "CMAI") Ownable(msg.sender) {}

    // ─────────────────────────────────────────
    //  IERC8004IdentityRegistry
    // ─────────────────────────────────────────

    /// @notice Registra um novo agente.
    ///         agentURI deve apontar para um JSON no formato ERC-8004 registration-v1
    function registerAgent(string calldata agentURI)
        external
        override
        returns (uint256 agentId)
    {
        require(bytes(agentURI).length > 0, "AgentIdentity: URI vazio");

        agentId = _nextAgentId++;
        _mint(msg.sender, agentId);
        _setTokenURI(agentId, agentURI);

        agentPaymentAddress[agentId] = msg.sender;
        walletToAgent[msg.sender]    = agentId;

        emit AgentRegistered(agentId, msg.sender, agentURI);
    }

    /// @notice Atualiza o agent card URI
    function setAgentURI(uint256 agentId, string calldata agentURI)
        external
        override
    {
        require(_isAuthorized(agentId), "AgentIdentity: sem permissao");
        require(bytes(agentURI).length > 0, "AgentIdentity: URI vazio");

        _setTokenURI(agentId, agentURI);
        emit AgentURIUpdated(agentId, agentURI);
    }

    function getAgentURI(uint256 agentId)
        external
        view
        override
        returns (string memory)
    {
        return tokenURI(agentId);
    }

    function getOperator(uint256 agentId)
        external
        view
        override
        returns (address)
    {
        return _operators[agentId];
    }

    /// @notice Owner do agente pode delegar operações para outro endereço
    function setOperator(uint256 agentId, address operator)
        external
        override
    {
        require(ownerOf(agentId) == msg.sender, "AgentIdentity: nao e owner");
        _operators[agentId] = operator;
        emit OperatorSet(agentId, operator);
    }

    // ─────────────────────────────────────────
    //  CriptoMorse Extensions
    // ─────────────────────────────────────────

    /// @notice Define o endereço de pagamento do agente (pode ser diferente do owner)
    function setPaymentAddress(uint256 agentId, address paymentAddr) external {
        require(_isAuthorized(agentId), "AgentIdentity: sem permissao");
        agentPaymentAddress[agentId] = paymentAddr;
    }

    /// @notice Incrementa jobs concluídos — chamado pelo contrato ArcFlow (ERC-8183)
    function incrementJobs(uint256 agentId) external {
        // Em produção: adicionar role JOBS_CONTRACT
        completedJobs[agentId]++;
        // Auto-upgrade trust level
        _updateTrust(agentId);
    }

    /// @notice Retorna informações completas do agente
    function getAgentInfo(uint256 agentId)
        external
        view
        returns (AgentInfo memory info)
    {
        info = AgentInfo({
            agentId:        agentId,
            owner:          ownerOf(agentId),
            operator:       _operators[agentId],
            paymentAddress: agentPaymentAddress[agentId],
            trustLevel:     trustLevel[agentId],
            completedJobs:  completedJobs[agentId],
            agentURI:       tokenURI(agentId)
        });
    }

    /// @notice Total de agentes registrados
    function totalAgents() external view returns (uint256) {
        return _nextAgentId - 1;
    }

    // ─────────────────────────────────────────
    //  Internal
    // ─────────────────────────────────────────

    function _isAuthorized(uint256 agentId) internal view returns (bool) {
        return ownerOf(agentId) == msg.sender || _operators[agentId] == msg.sender;
    }

    /// @dev Trust auto-upgrade baseado em jobs concluídos
    function _updateTrust(uint256 agentId) internal {
        uint256 jobs = completedJobs[agentId];
        if (jobs >= 50 && trustLevel[agentId] < 2) {
            trustLevel[agentId] = 2; // trusted
        } else if (jobs >= 5 && trustLevel[agentId] < 1) {
            trustLevel[agentId] = 1; // verified
        }
    }
}
