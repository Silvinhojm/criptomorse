import { useEffect } from "react";
import { realSwap, NETWORKS } from "./real-swap-executor";

type NetworkKey = keyof typeof NETWORKS;

/**
 * Hook para detectar mudanças de rede no MetaMask
 * Automaticamente atualiza realSwap quando a rede muda
 */
export function useNetworkDetection(onNetworkChange?: (network: NetworkKey) => void) {
  useEffect(() => {
    if (!window.ethereum) {
      console.warn("⚠️ MetaMask não detectado");
      return;
    }

    // Mapear chainId (decimal) para networkKey
    const chainIdToNetwork: Record<number, NetworkKey> = {
      5042002: "arc",      // Arc Testnet
      137: "polygon",      // Polygon Mainnet
      8453: "base",        // Base Mainnet
    };

    // Detectar mudança de rede
    const handleChainChanged = (...args: unknown[]) => {
      try {
        const chainIdHex = typeof args[0] === "string" ? args[0] : "";
        const chainId = parseInt(chainIdHex, 16);
        const networkKey = chainIdToNetwork[chainId];

        if (networkKey) {
          console.log(`🔄 Rede mudou para chainId ${chainId} (${networkKey})`);
          realSwap.switchNetwork(networkKey);
          
          // Chamar callback se fornecido
          onNetworkChange?.(networkKey);
          
          // Disparar evento customizado para outros componentes
          window.dispatchEvent(
            new CustomEvent("networkChanged", { 
              detail: { network: networkKey, chainId } 
            })
          );
        } else {
          console.warn(`⚠️ Rede chainId ${chainId} não suportada`);
        }
      } catch (error) {
        console.error("❌ Erro ao processar mudança de rede:", error);
      }
    };

    const provider = window.ethereum as typeof window.ethereum & {
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };

    // Registrar listener
    provider.on?.("chainChanged", handleChainChanged);
    console.log("✅ Listener de mudança de rede registrado");

    // Cleanup
    return () => {
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [onNetworkChange]);
}
