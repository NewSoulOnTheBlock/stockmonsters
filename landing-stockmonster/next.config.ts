import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // every sprite is pre-processed pixel art; the optimizer would smooth it
    unoptimized: true,
  },
};

export default nextConfig;
