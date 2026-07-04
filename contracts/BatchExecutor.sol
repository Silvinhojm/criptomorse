// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract BatchExecutor is Ownable, ReentrancyGuard {
    uint256 public constant MAX_BATCH_SIZE = 20;
    uint256 public constant MIN_DEADLINE_BUFFER = 60;

    bool public paused = false;

    event Paused(address indexed by);
    event Unpaused(address indexed by);

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    struct Order {
        address tokenIn;
        address tokenOut;
        address target;      // router or pool address
        bytes calldata;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 deadline;
        bool executed;
    }

    struct Batch {
        Order[] orders;
        uint256 submittedAt;
        address submitter;
        bool executed;
    }

    Batch[] public batches;
    mapping(uint256 => bool) public batchExists;

    event BatchSubmitted(uint256 indexed batchId, uint256 orderCount, address indexed submitter);
    event BatchExecuted(uint256 indexed batchId, uint256 successCount, uint256 failCount);
    event OrderExecuted(uint256 indexed batchId, uint256 indexed orderIndex, bool success, uint256 amountOut);

    constructor() Ownable(msg.sender) {}

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function submitBatch(
        address[] calldata tokenIns,
        address[] calldata tokenOuts,
        address[] calldata targets,
        bytes[] calldata calldatas,
        uint256[] calldata amountsIn,
        uint256[] calldata minAmountsOut,
        uint256[] calldata deadlines
    ) external whenNotPaused returns (uint256 batchId) {
        uint256 count = tokenIns.length;
        require(count > 0, "Empty batch");
        require(count <= MAX_BATCH_SIZE, "Batch too large");
        require(count == tokenOuts.length && count == targets.length, "Array length mismatch");
        require(count == calldatas.length && count == amountsIn.length, "Array length mismatch");
        require(count == minAmountsOut.length && count == deadlines.length, "Array length mismatch");

        batchId = batches.length;
        Batch storage batch = batches.push();
        batch.submittedAt = block.timestamp;
        batch.submitter = msg.sender;

        for (uint256 i = 0; i < count; i++) {
            require(deadlines[i] > block.timestamp + MIN_DEADLINE_BUFFER, "Deadline too soon");
            batch.orders.push(Order({
                tokenIn: tokenIns[i],
                tokenOut: tokenOuts[i],
                target: targets[i],
                calldata: calldatas[i],
                amountIn: amountsIn[i],
                minAmountOut: minAmountsOut[i],
                deadline: deadlines[i],
                executed: false
            }));
        }

        batchExists[batchId] = true;
        emit BatchSubmitted(batchId, count, msg.sender);
    }

    function executeBatch(uint256 batchId) external nonReentrant whenNotPaused returns (uint256 successCount, uint256 failCount) {
        require(batchExists[batchId], "Batch not found");
        Batch storage batch = batches[batchId];
        require(!batch.executed, "Already executed");
        require(batch.submitter == msg.sender || owner() == msg.sender, "Not authorized");

        uint256 count = batch.orders.length;
        for (uint256 i = 0; i < count; i++) {
            Order storage order = batch.orders[i];
            if (order.executed) continue;
            require(block.timestamp <= order.deadline, "Deadline passed");

            uint256 balanceBefore = _balanceOf(order.tokenOut, msg.sender);

            (bool success, bytes memory returnData) = order.target.call{gas: gasleft() * 9 / 10}(order.calldata);

            if (success) {
                uint256 balanceAfter = _balanceOf(order.tokenOut, msg.sender);
                uint256 amountOut = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;
                if (amountOut >= order.minAmountOut) {
                    order.executed = true;
                    successCount++;
                    emit OrderExecuted(batchId, i, true, amountOut);
                } else {
                    emit OrderExecuted(batchId, i, false, 0);
                    failCount++;
                }
            } else {
                emit OrderExecuted(batchId, i, false, 0);
                failCount++;
            }
        }

        batch.executed = true;
        emit BatchExecuted(batchId, successCount, failCount);
    }

    function estimateBatch(
        address[] calldata targets,
        bytes[] calldata calldatas
    ) external view returns (bool[] memory successes, bytes[] memory returnDatas) {
        uint256 count = targets.length;
        successes = new bool[](count);
        returnDatas = new bytes[](count);

        for (uint256 i = 0; i < count; i++) {
            (bool ok, bytes memory data) = targets[i].staticcall(calldatas[i]);
            successes[i] = ok;
            returnDatas[i] = data;
        }
    }

    function getBatchOrderCount(uint256 batchId) external view returns (uint256) {
        require(batchExists[batchId], "Batch not found");
        return batches[batchId].orders.length;
    }

    function getBatchStatus(uint256 batchId) external view returns (bool submitted, bool executed, uint256 orderCount) {
        require(batchExists[batchId], "Batch not found");
        Batch storage batch = batches[batchId];
        return (true, batch.executed, batch.orders.length);
    }

    function _balanceOf(address token, address owner) internal view returns (uint256) {
        if (token == address(0)) return owner.balance;
        return IERC20(token).balanceOf(owner);
    }

    receive() external payable {}
}
