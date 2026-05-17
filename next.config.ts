import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 关闭 TypeScript 类型检查错误
  typescript: {
    ignoreBuildErrors: true,
  },
  // 关闭 ESLint 检查错误
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
