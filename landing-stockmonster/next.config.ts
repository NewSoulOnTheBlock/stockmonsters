import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // this app lives inside a larger repo; pin tracing to its own folder
  outputFileTracingRoot: __dirname,
  images: {
    // every sprite is pre-processed pixel art; the optimizer would smooth it
    unoptimized: true,
  },
};

export default nextConfig;
