// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// MicroPool — Constant Product AMM minimalista (tipo Uniswap V2)
// Projetado para pools USDC-stablecoin com range tight (0.98–1.02)
// Fee: 0.3% (30 bps) — padrão Uniswap V2
//
// ATENÇÃO: Este contrato é um MVP conceitual para validação da ideia.
// A matemática exposta no relatório mostra que com $100 TVL,
// trades de $1 causam ~4% de slippage — inviável para micro-trades.
// Só se torna viável com TVL >$1000 ou volume externo de terceiros.

contract MicroPool {
    address public token0;
    address public token1;
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public totalSupply;
    uint256 public constant FEE_BPS = 30; // 0.3%
    uint256 public constant FEE_DENOM = 10000;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out);
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1);

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    // ── AMM Core ──
    function _swap(uint256 amount0Out, uint256 amount1Out, address to) internal {
        require(amount0Out > 0 || amount1Out > 0, "INSUFFICIENT_OUTPUT");
        require(amount0Out < reserve0 && amount1Out < reserve1, "INSUFFICIENT_LIQUIDITY");

        if (amount0Out > 0) _safeTransfer(token0, to, amount0Out);
        if (amount1Out > 0) _safeTransfer(token1, to, amount1Out);

        uint256 balance0 = _balanceOf(token0);
        uint256 balance1 = _balanceOf(token1);
        uint256 amount0In = balance0 > reserve0 - amount0Out ? balance0 - (reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > reserve1 - amount1Out ? balance1 - (reserve1 - amount1Out) : 0;

        require(amount0In > 0 || amount1In > 0, "INSUFFICIENT_INPUT");

        // Constant product check with fee
        uint256 balance0Adj = balance0 * FEE_DENOM - amount0In * FEE_BPS;
        uint256 balance1Adj = balance1 * FEE_DENOM - amount1In * FEE_BPS;
        require(balance0Adj * balance1Adj >= reserve0 * reserve1 * FEE_DENOM * FEE_DENOM, "K");

        reserve0 = balance0;
        reserve1 = balance1;
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out);
    }

    function swap(uint256 amountIn, address tokenIn, uint256 minAmountOut, address to) external returns (uint256 amountOut) {
        bool isToken0 = tokenIn == token0;
        uint256 reserveIn = isToken0 ? reserve0 : reserve1;
        uint256 reserveOut = isToken0 ? reserve1 : reserve0;

        uint256 amountInWithFee = amountIn * (FEE_DENOM - FEE_BPS);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOM + amountInWithFee;
        amountOut = numerator / denominator;
        require(amountOut >= minAmountOut, "SLIPPAGE");

        if (isToken0) _swap(0, amountOut, to);
        else _swap(amountOut, 0, to);
    }

    // ── Liquidity ──
    function addLiquidity(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address to) external returns (uint256 amount0, uint256 amount1, uint256 liquidity) {
        if (reserve0 == 0 && reserve1 == 0) {
            amount0 = amount0Desired;
            amount1 = amount1Desired;
            liquidity = _sqrt(amount0 * amount1) - 1000;
        } else {
            uint256 amount1Optimal = (amount0Desired * reserve1) / reserve0;
            if (amount1Optimal <= amount1Desired) {
                require(amount1Optimal >= amount1Min, "INSUFFICIENT_1");
                amount0 = amount0Desired;
                amount1 = amount1Optimal;
            } else {
                uint256 amount0Optimal = (amount1Desired * reserve0) / reserve1;
                require(amount0Optimal >= amount0Min, "INSUFFICIENT_0");
                amount0 = amount0Optimal;
                amount1 = amount1Desired;
            }
            liquidity = _min((amount0 * totalSupply) / reserve0, (amount1 * totalSupply) / reserve1);
        }
        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        _safeTransferFrom(token0, msg.sender, address(this), amount0);
        _safeTransferFrom(token1, msg.sender, address(this), amount1);
        balanceOf[to] += liquidity;
        totalSupply += liquidity;
        reserve0 += amount0;
        reserve1 += amount1;
        emit Mint(msg.sender, amount0, amount1);
    }

    function removeLiquidity(uint256 liquidity, uint256 amount0Min, uint256 amount1Min, address to) external returns (uint256 amount0, uint256 amount1) {
        amount0 = (liquidity * reserve0) / totalSupply;
        amount1 = (liquidity * reserve1) / totalSupply;
        require(amount0 >= amount0Min && amount1 >= amount1Min, "SLIPPAGE");
        balanceOf[msg.sender] -= liquidity;
        totalSupply -= liquidity;
        reserve0 -= amount0;
        reserve1 -= amount1;
        _safeTransfer(token0, to, amount0);
        _safeTransfer(token1, to, amount1);
        emit Burn(msg.sender, amount0, amount1);
    }

    // ── Queries ──
    function getReserves() external view returns (uint256 _reserve0, uint256 _reserve1) {
        return (reserve0, reserve1);
    }

    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256) {
        bool isToken0 = tokenIn == token0;
        uint256 reserveIn = isToken0 ? reserve0 : reserve1;
        uint256 reserveOut = isToken0 ? reserve1 : reserve0;
        uint256 amountInWithFee = amountIn * (FEE_DENOM - FEE_BPS);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOM + amountInWithFee;
        return numerator / denominator;
    }

    function getPrice(address baseToken) external view returns (uint256) {
        if (baseToken == token0) return (reserve1 * 1e18) / reserve0;
        return (reserve0 * 1e18) / reserve1;
    }

    function getPoolImbalance() external view returns (int256) {
        // Retorna % de desequilíbrio: positivo = token0 caro, negativo = token1 caro
        if (reserve0 == 0 || reserve1 == 0) return 0;
        int256 fairRatio = 1e18; // assume 1:1 para stables
        int256 actualRatio = (int256(int256(uint256(reserve0)) * 1e18)) / int256(uint256(reserve1));
        return ((actualRatio - fairRatio) * 10000) / int256(fairRatio); // em bps
    }

    // ── Helpers ──
    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    }

    function _balanceOf(address token) internal view returns (uint256) {
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(success, "BALANCE_OF_FAILED");
        return abi.decode(data, (uint256));
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) { return a < b ? a : b; }
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } }
        else if (y != 0) { z = 1; }
    }
}
