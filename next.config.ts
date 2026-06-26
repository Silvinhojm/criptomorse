import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.gradual.com" },
      { protocol: "https", hostname: "mintcdn.com" },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback as Record<string, boolean | string>),
        fs: false,
        os: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
  devIndicators: false,
};

export default nextConfig;
