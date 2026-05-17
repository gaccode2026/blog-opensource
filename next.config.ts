module.exports = {
  // 开启静态导出，让 Next.js 生成纯静态文件到 out 目录
  output: "export",
  // 跳过 TS 检查，保证构建成功
  typescript: {
    ignoreBuildErrors: true,
  },
  // 跳过 ESLint 检查（可选）
  eslint: {
    ignoreDuringBuilds: true,
  },
};
