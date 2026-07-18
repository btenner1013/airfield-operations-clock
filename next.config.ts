import type { NextConfig } from "next";
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] || "";
const isPages = process.env.GITHUB_ACTIONS === "true";
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: isPages ? `/${repo}` : "",
  assetPrefix: isPages ? `/${repo}/` : "",
};
export default nextConfig;
