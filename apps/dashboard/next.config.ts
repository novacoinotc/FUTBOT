import type { NextConfig } from "next";

const VPS_API = process.env.VPS_API_URL || "http://159.65.42.23:8080";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${VPS_API}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
