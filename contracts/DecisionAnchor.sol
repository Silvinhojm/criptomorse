// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DecisionAnchor {
    struct Report {
        bytes32 hash;
        address submitter;
        uint256 timestamp;
    }

    Report[] public reports;
    mapping(bytes32 => bool) public hashes;

    event ReportAnchored(uint256 indexed index, bytes32 indexed hash, address indexed submitter, string metadataURI);

    function anchor(bytes32 _hash, string calldata _metadataURI) external returns (uint256 index) {
        require(!hashes[_hash], "Hash already anchored");
        index = reports.length;
        reports.push(Report(_hash, msg.sender, block.timestamp));
        hashes[_hash] = true;
        emit ReportAnchored(index, _hash, msg.sender, _metadataURI);
    }

    function totalReports() external view returns (uint256) {
        return reports.length;
    }

    function getReport(uint256 _index) external view returns (bytes32 hash, address submitter, uint256 timestamp) {
        require(_index < reports.length, "Index out of bounds");
        Report memory r = reports[_index];
        return (r.hash, r.submitter, r.timestamp);
    }
}
