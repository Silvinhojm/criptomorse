// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract JobProof {
    string public robotName;
    uint256 public jobNumber;
    uint256 public timestamp;
    address public deployer;

    event JobDeployed(string robotName, uint256 jobNumber, address indexed deployer);

    constructor(string memory _robotName, uint256 _jobNumber) {
        robotName = _robotName;
        jobNumber = _jobNumber;
        timestamp = block.timestamp;
        deployer = msg.sender;
        emit JobDeployed(_robotName, _jobNumber, msg.sender);
    }
}
