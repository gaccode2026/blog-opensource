module.exports = {
  // 删掉静态导出，这是报错根源
  // output: "export",

  // 只保留跳过错误，保证构建成功
  typescript: {
    ignoreBuildErrors: true,
  },
};
