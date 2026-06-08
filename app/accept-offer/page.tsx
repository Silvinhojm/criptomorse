"use client";

import { useState } from "react";
import { Toaster, toast } from "react-hot-toast";

// Componente simplificado para aceitar oferta
export default function AcceptOfferPage() {
  const [offerId, setOfferId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const acceptOffer = async () => {
    if (!offerId) {
      toast.error("Digite o ID da oferta");
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      // Verificar se a wallet está conectada
      if (!window.ethereum) {
        toast.error("MetaMask não encontrado. Instale a extensão.");
        return;
      }

      // Conectar à wallet
      const accounts = await window.ethereum.request({ 
        method: "eth_requestAccounts" 
      });
      const walletAddress = accounts[0];

      // Criar mensagem para assinar
      const message = `Accept offer ${offerId} from ${walletAddress}`;
      
      // Assinar a mensagem com a wallet
      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [message, walletAddress]
      });

      // Enviar para a API (sem chave privada!)
      const response = await fetch("/api/accept-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId,
          acceptedBy: walletAddress,
          signature,
          walletAddress
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Erro ao aceitar oferta");
      }

      setResult(data.data);
      toast.success("Oferta aceita com sucesso!");
      
    } catch (error: any) {
      console.error("Erro:", error);
      toast.error(error.message || "Erro ao aceitar oferta");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ 
      minHeight: "100vh", 
      display: "flex", 
      alignItems: "center", 
      justifyContent: "center",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
    }}>
      <Toaster position="top-center" />
      
      <div style={{
        background: "white",
        borderRadius: "20px",
        padding: "40px",
        width: "450px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
      }}>
        <h1 style={{ 
          textAlign: "center", 
          color: "#333",
          marginBottom: "30px",
          fontSize: "28px"
        }}>
          Aceitar Oferta
        </h1>

        <div style={{ marginBottom: "20px" }}>
          <label style={{ 
            display: "block", 
            marginBottom: "8px", 
            fontWeight: 600,
            color: "#555"
          }}>
            ID da Oferta:
          </label>
          <input
            type="text"
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
            placeholder="Ex: offer_123456"
            style={{
              width: "100%",
              padding: "12px",
              border: "2px solid #e0e0e0",
              borderRadius: "10px",
              fontSize: "14px",
              outline: "none",
              transition: "border-color 0.3s"
            }}
            onFocus={(e) => e.target.style.borderColor = "#667eea"}
            onBlur={(e) => e.target.style.borderColor = "#e0e0e0"}
          />
        </div>

        <button
          onClick={acceptOffer}
          disabled={isLoading}
          style={{
            width: "100%",
            padding: "14px",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            border: "none",
            borderRadius: "10px",
            fontSize: "16px",
            fontWeight: 600,
            cursor: isLoading ? "not-allowed" : "pointer",
            opacity: isLoading ? 0.7 : 1,
            transition: "transform 0.2s"
          }}
          onMouseEnter={(e) => {
            if (!isLoading) e.currentTarget.style.transform = "translateY(-2px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          {isLoading ? "Processando..." : "✅ Aceitar Oferta"}
        </button>

        {result && (
          <div style={{
            marginTop: "20px",
            padding: "15px",
            background: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: "10px"
          }}>
            <h3 style={{ margin: "0 0 10px 0", color: "#166534" }}>✅ Sucesso!</h3>
            <p style={{ margin: "5px 0", fontSize: "14px", color: "#14532d" }}>
              Transação: {result.txId}
            </p>
            <p style={{ margin: "5px 0", fontSize: "14px", color: "#14532d" }}>
              Mensagem: {result.message}
            </p>
          </div>
        )}

        <div style={{
          marginTop: "20px",
          padding: "12px",
          background: "#fef9c3",
          border: "1px solid #fde047",
          borderRadius: "8px",
          fontSize: "12px",
          color: "#854d0e"
        }}>
          🔒 <strong>Segurança:</strong> Sua chave privada nunca é enviada ao servidor.
          Apenas assinaturas são usadas para autenticação.
        </div>
      </div>
    </div>
  );
}