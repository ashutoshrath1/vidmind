import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  devIndicators: false, // the dev badge would show in screen recordings of the running app
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
