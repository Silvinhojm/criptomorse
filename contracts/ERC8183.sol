// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./AgentIdentity.sol";

interface IERC8183 {
    struct Job {
        uint256 id;
        address creator;
        address provider;
        string description;
        uint256 budget;
        uint256 deadline;
        JobStatus status;
        string deliverableURI;
        uint256 createdAt;
    }

    enum JobStatus { Open, Funded, Submitted, Approved, Rejected, Cancelled, Paid }

    event JobCreated(uint256 indexed jobId, address indexed creator, uint256 budget);
    event JobFunded(uint256 indexed jobId, uint256 amount);
    event DeliverableSubmitted(uint256 indexed jobId, string uri);
    event JobApproved(uint256 indexed jobId);
    event JobPaid(uint256 indexed jobId, uint256 amount);
    event JobCancelled(uint256 indexed jobId);
}

contract ERC8183 is IERC8183, Ownable {
    IERC20 public usdc;
    AgentIdentity public agentIdentity;

    uint256 private _nextJobId = 1;
    mapping(uint256 => Job) public jobs;
    mapping(uint256 => mapping(address => bool)) public evaluations;

    uint256 public constant PLATFORM_FEE_BPS = 50;

    constructor(address _usdc, address _agentIdentity) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        agentIdentity = AgentIdentity(_agentIdentity);
    }

    function createJob(
        address _provider,
        string calldata _description,
        uint256 _budget,
        uint256 _deadline
    ) external returns (uint256 jobId) {
        require(_budget > 0, "Budget must be > 0");
        require(_deadline > block.timestamp, "Deadline must be future");

        jobId = _nextJobId++;
        jobs[jobId] = Job({
            id: jobId,
            creator: msg.sender,
            provider: _provider,
            description: _description,
            budget: _budget,
            deadline: _deadline,
            status: JobStatus.Open,
            deliverableURI: "",
            createdAt: block.timestamp
        });

        emit JobCreated(jobId, msg.sender, _budget);
    }

    function fundJob(uint256 _jobId) external {
        Job storage job = jobs[_jobId];
        require(job.status == JobStatus.Open, "Job not open");
        require(msg.sender == job.creator, "Only creator can fund");

        uint256 total = job.budget + (job.budget * PLATFORM_FEE_BPS / 10000);
        require(usdc.transferFrom(msg.sender, address(this), total), "Transfer failed");

        job.status = JobStatus.Funded;
        emit JobFunded(_jobId, total);
    }

    function submitDeliverable(uint256 _jobId, string calldata _uri) external {
        Job storage job = jobs[_jobId];
        require(job.status == JobStatus.Funded, "Job not funded");
        require(msg.sender == job.provider, "Only provider can submit");
        require(block.timestamp <= job.deadline, "Past deadline");

        job.deliverableURI = _uri;
        job.status = JobStatus.Submitted;
        emit DeliverableSubmitted(_jobId, _uri);
    }

    function approveJob(uint256 _jobId) external {
        Job storage job = jobs[_jobId];
        require(job.status == JobStatus.Submitted, "Job not submitted");
        require(msg.sender == job.creator, "Only creator can approve");

        job.status = JobStatus.Approved;
        emit JobApproved(_jobId);
    }

    function payJob(uint256 _jobId) external {
        Job storage job = jobs[_jobId];
        require(job.status == JobStatus.Approved, "Job not approved");

        job.status = JobStatus.Paid;
        uint256 fee = job.budget * PLATFORM_FEE_BPS / 10000;
        uint256 payment = job.budget - fee;

        require(usdc.transfer(job.provider, payment), "Payment failed");
        require(usdc.transfer(owner(), fee), "Fee failed");

        agentIdentity.incrementJobs(agentIdentity.walletToAgent(job.provider));
        emit JobPaid(_jobId, payment);
    }

    function cancelJob(uint256 _jobId) external {
        Job storage job = jobs[_jobId];
        require(job.status == JobStatus.Open || job.status == JobStatus.Funded, "Cannot cancel");
        require(msg.sender == job.creator, "Only creator can cancel");

        job.status = JobStatus.Cancelled;
        if (address(this).balance > 0) {
            require(usdc.transfer(job.creator, job.budget), "Refund failed");
        }
        emit JobCancelled(_jobId);
    }

    function getJob(uint256 _jobId) external view returns (Job memory) {
        return jobs[_jobId];
    }

    function totalJobs() external view returns (uint256) {
        return _nextJobId - 1;
    }
}
